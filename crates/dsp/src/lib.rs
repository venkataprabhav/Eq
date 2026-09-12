//! Custom EQ curve fitting from track metadata + spectrum.
//!
//! Title text is only a weak hint (speech, night, etc.). The listening curve
//! comes from mix *features* any similar song can match:
//!
//! | Feature | What it means | EQ move |
//! |---|---|---|
//! | snare | energy in 2.5–5 kHz (crack) vs mids | cut 2 kHz / 4 kHz |
//! | hats | 6–10 kHz vs mids | cut 8 kHz, never invent air |
//! | grit | dense 1–4 kHz (saturation / distorted vocal) | cut 1–2 kHz, do not lift presence |
//! | crushed | loud + grit + snare/hats | extra preamp cut, keep 125 Hz body |
//! | dark_air | 10–16 kHz empty while hats still there | YouTube rolloff — do **not** boost 8 kHz |

use eq_core::{
    track_key, EqBand, EqProfile, FilterType, RecommendRequest, RecommendResponse, SpectrumBands,
    TrackInfo, BAND_COUNT, DEFAULT_FREQUENCIES,
};

const ENGINE: &str = "universal-eq-rust/0.4";

/// Relative band shape only. YouTube streams already roll off the air band,
/// so we do **not** treat missing 8 kHz as a defect to boost.
const TARGET_SHAPE: [f32; BAND_COUNT] = [1.00, 1.05, 1.02, 1.00, 1.08, 1.04, 0.98, 0.90];
const MAX_BOOST: [f32; BAND_COUNT] = [3.0, 2.5, 2.0, 2.0, 2.5, 1.6, 1.2, 0.8];
const MAX_CUT: [f32; BAND_COUNT] = [3.0, 2.5, 2.0, 2.0, 2.5, 3.5, 4.0, 4.5];

pub fn recommend(request: &RecommendRequest) -> RecommendResponse {
    let started = std::time::Instant::now();
    let spectrum = request.spectrum.as_ref();
    let track = request.track.as_ref();
    let mut meta = metadata_bias(track);
    apply_mix_policy(&mut meta, spectrum);
    let section = detect_section(spectrum);
    let measured = relative_shape(spectrum);
    let target = target_shape(request.target_offsets_db.as_ref(), &meta);

    let mut gains = [0.0_f32; BAND_COUNT];
    for i in 0..BAND_COUNT {
        let error = measured[i] - target[i];
        let mut gain = -error * (3.2 * meta.spectrum_scale) + meta.gain_bias[i];
        gain += section_bias(section, i, &meta);
        if meta.no_air_boost && gain > 0.0 && i >= 5 {
            gain = 0.0;
        }
        // Prefer cutting peaks over inventing missing YouTube treble.
        if gain > 0.0 && i >= 6 {
            gain *= 0.35;
        }
        gains[i] = gain.clamp(-MAX_CUT[i], MAX_BOOST[i]);
    }

    smooth_gains(&mut gains);
    let preamp = compute_preamp(&gains, meta.preamp_bias + section_preamp(section));
    let profile = build_profile(&gains, preamp);
    let reason = explain(track, spectrum, &gains, &meta, section);

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
    spectrum_scale: f32,
    no_air_boost: bool,
    crushed: bool,
}

fn metadata_bias(track: Option<&TrackInfo>) -> MetaBias {
    let mut bias = MetaBias {
        gain_bias: [0.0; BAND_COUNT],
        preamp_bias: 0.0,
        tags: Vec::new(),
        spectrum_scale: 1.0,
        no_air_boost: false,
        crushed: false,
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

fn unit(value: f32) -> f32 {
    value.clamp(0.0, 1.0)
}

struct MixFeatures {
    snare: f32,
    hats: f32,
    grit: f32,
    crushed: f32,
    dark_air: f32,
}

fn mix_features(spectrum: Option<&SpectrumBands>) -> Option<MixFeatures> {
    let s = spectrum?;
    if s.rms < 8.0 {
        return None;
    }
    let mid = s.mid.max(1.0);
    let crack = if s.crack > 1.0 { s.crack } else { s.high_mid };
    let hat_energy = if s.hats > 1.0 { s.hats } else { s.high * 0.9 };
    let air = if s.air > 1.0 { s.air } else { s.high * 0.55 };

    // Strong snare/clap: crack band as hot as or hotter than the vocal mid.
    let snare = unit((crack / mid - 0.62) / 0.55);
    // Loud hats: 6–10 kHz drive, not 12 kHz air.
    let hats = unit((hat_energy / mid - 0.42) / 0.55);
    // Distorted / saturated vocal: mids are full and 2–5 kHz is not scooped.
    let grit = unit(((s.mid + s.low_mid) / 2.0 - 52.0) / 40.0)
        * unit((crack / mid - 0.48) / 0.4);
    let dark_air = unit((hat_energy - air) / 28.0);
    let crushed = unit((s.rms - 55.0) / 35.0) * unit((snare + hats + grit) / 1.6);

    Some(MixFeatures {
        snare,
        hats,
        grit,
        crushed,
        dark_air,
    })
}

fn apply_mix_policy(bias: &mut MetaBias, spectrum: Option<&SpectrumBands>) {
    let Some(mix) = mix_features(spectrum) else {
        return;
    };

    if mix.snare > 0.25 {
        bias.tags.push("hot snare");
        bias.gain_bias[5] -= 2.2 * mix.snare;
        bias.gain_bias[6] -= 3.2 * mix.snare;
    }
    if mix.hats > 0.25 {
        bias.tags.push("loud hats");
        bias.gain_bias[6] -= 1.1 * mix.hats;
        bias.gain_bias[7] -= 4.0 * mix.hats;
    }
    if mix.grit > 0.25 {
        bias.tags.push("saturated vocal");
        bias.gain_bias[4] -= 1.4 * mix.grit;
        bias.gain_bias[5] -= 1.2 * mix.grit;
    }
    if mix.dark_air > 0.35 && (mix.hats > 0.2 || mix.snare > 0.2) {
        bias.no_air_boost = true;
        bias.tags.push("stream-dark air");
    }
    if mix.crushed > 0.3 {
        bias.crushed = true;
        bias.no_air_boost = true;
        bias.spectrum_scale = (1.0 - 0.7 * mix.crushed).max(0.2);
        bias.preamp_bias -= 2.4 * mix.crushed;
        bias.gain_bias[1] += 0.7 * mix.crushed;
        bias.gain_bias[2] += 0.4 * mix.crushed;
        bias.tags.push("crushed mix");
    }
}

fn raw_bands(s: &SpectrumBands) -> [f32; BAND_COUNT] {
    [
        s.sub.max(1.0),
        s.bass.max(1.0),
        ((s.bass + s.low_mid) * 0.5).max(1.0),
        s.low_mid.max(1.0),
        s.mid.max(1.0),
        ((s.mid + s.high_mid) * 0.5).max(1.0),
        s.high_mid.max(1.0),
        s.high.max(1.0),
    ]
}

fn relative_shape(spectrum: Option<&SpectrumBands>) -> [f32; BAND_COUNT] {
    let Some(s) = spectrum else {
        return TARGET_SHAPE;
    };
    if s.rms < 8.0 {
        return TARGET_SHAPE;
    }
    let raw = raw_bands(s);
    let mean = raw.iter().sum::<f32>() / BAND_COUNT as f32;
    let mut shape = [1.0_f32; BAND_COUNT];
    for i in 0..BAND_COUNT {
        shape[i] = (raw[i] / mean.max(1.0)).clamp(0.35, 2.2);
    }
    shape
}

fn target_shape(offsets: Option<&[f32; BAND_COUNT]>, meta: &MetaBias) -> [f32; BAND_COUNT] {
    let mut target = TARGET_SHAPE;
    if let Some(off) = offsets {
        for i in 0..BAND_COUNT {
            target[i] = (target[i] + off[i] / 24.0).clamp(0.5, 1.6);
        }
    }
    if meta.tags.contains(&"speech") {
        target[0] *= 0.85;
        target[4] = (target[4] + 0.08).min(1.5);
    }
    target
}

fn detect_section(spectrum: Option<&SpectrumBands>) -> &'static str {
    let Some(s) = spectrum else {
        return "intro";
    };
    let bass = s.sub + s.bass;
    if s.rms > 88.0 && bass > 160.0 {
        "chorus"
    } else if s.rms < 32.0 {
        "quiet"
    } else if s.mid > s.bass && s.mid > 48.0 {
        "verse"
    } else {
        "groove"
    }
}

fn section_bias(section: &str, band: usize, meta: &MetaBias) -> f32 {
    if meta.crushed || meta.no_air_boost {
        return match section {
            "chorus" if band >= 5 => -0.9,
            "chorus" if band <= 1 => -0.3,
            "verse" if (4..=6).contains(&band) => -0.5,
            "quiet" if band >= 6 => 0.7,
            _ => 0.0,
        };
    }
    match section {
        "chorus" if band <= 1 => -0.8,
        "chorus" if band >= 6 => -0.4,
        "verse" if (3..=5).contains(&band) => 0.6,
        "verse" if band <= 1 => -0.4,
        "quiet" => 0.0,
        _ => 0.0,
    }
}

fn section_preamp(section: &str) -> f32 {
    match section {
        "chorus" => -0.8,
        "quiet" => 0.4,
        _ => 0.0,
    }
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
        gains[i] = (left * 0.2 + original[i] * 0.6 + right * 0.2).clamp(-MAX_CUT[i], MAX_BOOST[i]);
    }
}

fn compute_preamp(gains: &[f32; BAND_COUNT], bias: f32) -> f32 {
    let peak = gains.iter().cloned().fold(0.0_f32, f32::max);
    (-peak * 0.7 - 0.3 + bias).clamp(-5.0, 0.0)
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
    section: &str,
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
        "{title} | {section} | {} | strongest {action} near {freq:.0} Hz ({g:+.1} dB).",
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
                ..Default::default()
            }),
            target_offsets_db: None,
        });

        assert_eq!(response.profile.id, "custom");
        assert_eq!(response.profile.bands.len(), BAND_COUNT);
        assert!(response.latency_ms < 500);
        // Heavy low end should produce a low-band cut.
        assert!(response.profile.bands[0].gain < 0.0);
        // YouTube-dark highs must not get a large air boost.
        assert!(response.profile.bands[7].gain < 2.0);
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

    fn crushed_hot_top_spectrum() -> SpectrumBands {
        SpectrumBands {
            sub: 90.0,
            bass: 85.0,
            low_mid: 78.0,
            mid: 80.0,
            high_mid: 74.0,
            high: 40.0,
            rms: 78.0,
            crack: 82.0,
            hats: 70.0,
            air: 22.0,
        }
    }

    #[test]
    fn crushed_mix_cuts_snare_hats_and_vocal_grit() {
        let response = recommend(&RecommendRequest {
            track: Some(TrackInfo {
                title: "Any Similar Song".into(),
                artist: "Unknown".into(),
                ..Default::default()
            }),
            spectrum: Some(crushed_hot_top_spectrum()),
            target_offsets_db: None,
        });

        assert!(
            response.reason.contains("hot snare")
                || response.reason.contains("loud hats")
                || response.reason.contains("saturated")
                || response.reason.contains("crushed")
        );
        assert!(response.profile.bands[5].gain < -1.5);
        assert!(response.profile.bands[6].gain < -2.5);
        assert!(response.profile.bands[7].gain <= -2.5);
        assert!(response.profile.bands[7].gain <= 0.0);
        assert!(response.profile.preamp <= -1.5);
    }

    #[test]
    fn same_mix_features_match_regardless_of_title() {
        let a = recommend(&RecommendRequest {
            track: Some(TrackInfo {
                title: "Loser".into(),
                artist: "Tame Impala".into(),
                ..Default::default()
            }),
            spectrum: Some(crushed_hot_top_spectrum()),
            target_offsets_db: None,
        });
        let b = recommend(&RecommendRequest {
            track: Some(TrackInfo {
                title: "Different Title".into(),
                artist: "Different Artist".into(),
                ..Default::default()
            }),
            spectrum: Some(crushed_hot_top_spectrum()),
            target_offsets_db: None,
        });

        for i in 0..BAND_COUNT {
            let delta = (a.profile.bands[i].gain - b.profile.bands[i].gain).abs();
            assert!(delta < 0.15, "band {i} differed by {delta}");
        }
    }
}
