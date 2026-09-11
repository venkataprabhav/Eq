//! Custom EQ curve fitting from track metadata + spectrum.
//!
//! This does **not** pick named presets. It solves per-band gains toward a
//! smooth listening target, then returns a full custom profile.

use eq_core::{
    track_key, EqBand, EqProfile, FilterType, RecommendRequest, RecommendResponse, SpectrumBands,
    TrackInfo, BAND_COUNT, DEFAULT_FREQUENCIES,
};

const ENGINE: &str = "universal-eq-rust/0.1";

/// Neutral-ish headphone listening target as relative band energy (0–1 scale).
const TARGET_SHAPE: [f32; BAND_COUNT] = [0.42, 0.48, 0.55, 0.62, 0.68, 0.64, 0.58, 0.52];

pub fn recommend(request: &RecommendRequest) -> RecommendResponse {
    let started = std::time::Instant::now();
    let spectrum = request.spectrum.as_ref();
    let track = request.track.as_ref();
    let meta = metadata_bias(track);
    let measured = spectrum_levels(spectrum);
    let target = target_levels(request.target_offsets_db.as_ref(), &meta);

    let mut gains = [0.0_f32; BAND_COUNT];
    for i in 0..BAND_COUNT {
        // Positive error => band is hot relative to target => cut.
        let error = measured[i] - target[i];
        gains[i] = (-error * 10.0 + meta.gain_bias[i]).clamp(-8.0, 8.0);
    }

    smooth_gains(&mut gains);
    let preamp = compute_preamp(&gains, meta.preamp_bias);
    let profile = build_profile(&gains, preamp);
    let reason = explain(track, spectrum, &gains, &meta);

    RecommendResponse {
        profile,
        reason,
        track_key: track_key(&request.track),
        latency_ms: started.elapsed().as_millis() as u64,
        engine: ENGINE.into(),
    }
}

struct MetaBias {
    gain_bias: [f32; BAND_COUNT],
    preamp_bias: f32,
    tags: Vec<&'static str>,
}

fn metadata_bias(track: Option<&TrackInfo>) -> MetaBias {
    let mut bias = MetaBias {
        gain_bias: [0.0; BAND_COUNT],
        preamp_bias: 0.0,
        tags: Vec::new(),
    };
    let Some(track) = track else {
        return bias;
    };
    let text = format!(
        "{} {} {}",
        track.title.to_lowercase(),
        track.artist.to_lowercase(),
        track.album.to_lowercase()
    );

    if contains_any(
        &text,
        &[
            "podcast",
            "interview",
            "audiobook",
            "speech",
            "lecture",
            "ted talk",
            "full episode",
        ],
    ) {
        bias.tags.push("speech");
        // Cut rumble, lift presence.
        bias.gain_bias[0] -= 2.5;
        bias.gain_bias[1] -= 1.5;
        bias.gain_bias[3] += 1.2;
        bias.gain_bias[4] += 2.0;
        bias.gain_bias[5] += 1.0;
        bias.gain_bias[7] -= 1.0;
        bias.preamp_bias -= 0.5;
    }

    if contains_any(
        &text,
        &[
            "808", "phonk", "drill", "trap", "dubstep", "edm", "techno", "house", "drum and bass",
            "dnb",
        ],
    ) {
        bias.tags.push("bass-heavy");
        // Control boom, keep punch.
        bias.gain_bias[0] -= 1.5;
        bias.gain_bias[1] -= 0.8;
        bias.gain_bias[2] += 0.4;
        bias.gain_bias[6] += 0.6;
        bias.preamp_bias -= 1.0;
    }

    if contains_any(
        &text,
        &[
            "acoustic",
            "unplugged",
            "session",
            "cover",
            "karaoke",
            "a cappella",
            "lyrics",
        ],
    ) {
        bias.tags.push("vocal");
        bias.gain_bias[0] -= 1.2;
        bias.gain_bias[1] -= 0.6;
        bias.gain_bias[3] += 0.8;
        bias.gain_bias[4] += 1.5;
        bias.gain_bias[5] += 1.0;
    }

    if contains_any(
        &text,
        &["lofi", "lo-fi", "chillhop", "sleep", "rain", "ambient", "night"],
    ) {
        bias.tags.push("night");
        bias.gain_bias[6] -= 1.0;
        bias.gain_bias[7] -= 1.5;
        bias.preamp_bias -= 2.0;
    }

    bias
}

fn contains_any(haystack: &str, needles: &[&str]) -> bool {
    needles.iter().any(|n| haystack.contains(n))
}

fn spectrum_levels(spectrum: Option<&SpectrumBands>) -> [f32; BAND_COUNT] {
    let Some(s) = spectrum else {
        return TARGET_SHAPE;
    };
    if s.rms < 8.0 {
        return TARGET_SHAPE;
    }

    // Map 0–255-ish analyser averages into 0–1.
    let norm = |v: f32| (v / 180.0).clamp(0.05, 1.0);
    [
        norm(s.sub),
        norm(s.bass),
        norm((s.bass + s.low_mid) * 0.5),
        norm(s.low_mid),
        norm(s.mid),
        norm((s.mid + s.high_mid) * 0.5),
        norm(s.high_mid),
        norm(s.high),
    ]
}

fn target_levels(
    offsets: Option<&[f32; BAND_COUNT]>,
    meta: &MetaBias,
) -> [f32; BAND_COUNT] {
    let mut target = TARGET_SHAPE;
    if let Some(off) = offsets {
        for i in 0..BAND_COUNT {
            // Treat offset as preferred gain; convert roughly into energy shift.
            target[i] = (target[i] + off[i] / 20.0).clamp(0.1, 1.0);
        }
    }
    // Speech content prefers a clearer mid target.
    if meta.tags.contains(&"speech") {
        target[0] *= 0.75;
        target[4] = (target[4] + 0.08).min(1.0);
    }
    target
}

fn smooth_gains(gains: &mut [f32; BAND_COUNT]) {
    let original = *gains;
    for i in 0..BAND_COUNT {
        let left = if i == 0 { original[i] } else { original[i - 1] };
        let right = if i + 1 == BAND_COUNT {
            original[i]
        } else {
            original[i + 1]
        };
        gains[i] = (left * 0.2 + original[i] * 0.6 + right * 0.2).clamp(-8.0, 8.0);
    }
}

fn compute_preamp(gains: &[f32; BAND_COUNT], bias: f32) -> f32 {
    let peak = gains.iter().cloned().fold(0.0_f32, f32::max);
    (-peak - 0.5 + bias).clamp(-6.0, 0.0)
}

fn build_profile(gains: &[f32; BAND_COUNT], preamp: f32) -> EqProfile {
    let bands: Vec<EqBand> = DEFAULT_FREQUENCIES
        .iter()
        .enumerate()
        .map(|(i, &frequency)| {
            let filter_type = match i {
                0 => FilterType::Lowshelf,
                n if n + 1 == BAND_COUNT => FilterType::Highshelf,
                _ => FilterType::Peaking,
            };
            let q = match filter_type {
                FilterType::Peaking => {
                    // Narrower cuts/boosts when gain is large.
                    (0.7 + gains[i].abs() * 0.08).clamp(0.5, 1.8)
                }
                _ => 0.7,
            };
            EqBand {
                id: format!("b{}", i + 1),
                filter_type,
                frequency,
                gain: (gains[i] * 10.0).round() / 10.0,
                q: (q * 10.0).round() / 10.0,
            }
        })
        .collect();

    EqProfile {
        id: "custom".into(),
        name: "Custom Auto".into(),
        preamp: (preamp * 10.0).round() / 10.0,
        bands,
    }
}

fn explain(
    track: Option<&TrackInfo>,
    spectrum: Option<&SpectrumBands>,
    gains: &[f32; BAND_COUNT],
    meta: &MetaBias,
) -> String {
    let title = track
        .map(|t| t.title.as_str())
        .filter(|t| !t.is_empty())
        .unwrap_or("this track");

    let mut parts = Vec::new();
    if !meta.tags.is_empty() {
        parts.push(format!("metadata hints ({})", meta.tags.join(", ")));
    }
    if spectrum.map(|s| s.rms >= 8.0).unwrap_or(false) {
        parts.push("live spectrum fit".into());
    } else {
        parts.push("metadata-only fit".into());
    }

    let max_i = gains
        .iter()
        .enumerate()
        .max_by(|(_, a), (_, b)| a.abs().partial_cmp(&b.abs()).unwrap())
        .map(|(i, _)| i)
        .unwrap_or(4);
    let freq = DEFAULT_FREQUENCIES[max_i];
    let g = gains[max_i];
    let action = if g >= 0.0 { "lift" } else { "cut" };

    format!(
        "Custom curve for {title} via {} - strongest {action} near {freq:.0} Hz ({g:+.1} dB).",
        parts.join(" + ")
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use eq_core::{RecommendRequest, SpectrumBands, TrackInfo};

    #[test]
    fn returns_custom_not_preset_id() {
        let response = recommend(&RecommendRequest {
            track: Some(TrackInfo {
                title: "Test Song".into(),
                artist: "Artist".into(),
                ..Default::default()
            }),
            spectrum: Some(SpectrumBands {
                sub: 140.0,
                bass: 130.0,
                low_mid: 70.0,
                mid: 60.0,
                high_mid: 40.0,
                high: 30.0,
                rms: 80.0,
            }),
            target_offsets_db: None,
        });

        assert_eq!(response.profile.id, "custom");
        assert_eq!(response.profile.bands.len(), BAND_COUNT);
        assert!(response.latency_ms < 500);
        // Heavy low end should produce a low-band cut.
        assert!(response.profile.bands[0].gain < 0.0);
    }

    #[test]
    fn speech_metadata_lifts_presence() {
        let response = recommend(&RecommendRequest {
            track: Some(TrackInfo {
                title: "Long Interview Podcast Episode".into(),
                artist: "Host".into(),
                ..Default::default()
            }),
            spectrum: None,
            target_offsets_db: None,
        });

        assert!(response.profile.bands[4].gain > response.profile.bands[0].gain);
        assert!(response.reason.contains("speech") || response.reason.contains("metadata"));
    }
}
