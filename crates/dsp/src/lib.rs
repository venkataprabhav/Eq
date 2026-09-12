//! Enhancement EQ — make the lead elements clearer, not flatten the mix.
//!
//! Loud bands are usually the instruments the song wants you to hear.
//! Auto enhances those, carves only when something masks the lead, and
//! tames harshness. Vocals get a living presence curve that moves with
//! the section (verse / chorus / quiet / groove) about once a second.

use eq_core::{
    track_key, EqBand, EqProfile, FilterType, RecommendRequest, RecommendResponse, SpectrumBands,
    TrackInfo, BAND_COUNT, DEFAULT_FREQUENCIES,
};

const ENGINE: &str = "universal-eq-rust/0.6";

/// 60, 125, 250, 500, 1k, 2k, 4k, 8k
const MAX_BOOST: [f32; BAND_COUNT] = [2.4, 2.0, 1.4, 2.6, 3.4, 2.8, 1.6, 0.8];
const MAX_CUT: [f32; BAND_COUNT] = [2.2, 1.6, 1.4, 1.0, 0.8, 1.0, 2.0, 2.8];

#[derive(Clone, Copy, PartialEq, Eq)]
enum Lead {
    Speech,
    Vocal,
    Bass,
    Groove,
}

impl Lead {
    fn as_str(self) -> &'static str {
        match self {
            Self::Speech => "speech",
            Self::Vocal => "vocals",
            Self::Bass => "low end",
            Self::Groove => "instruments",
        }
    }
}

pub fn recommend(request: &RecommendRequest) -> RecommendResponse {
    let started = std::time::Instant::now();
    let spectrum = request.spectrum.as_ref();
    let track = request.track.as_ref();
    let meta = metadata_hints(track);
    let mix = mix_features(spectrum);
    let section = detect_section(spectrum);
    let lead = pick_lead(&meta, mix.as_ref());

    let mut gains = enhance(lead, mix.as_ref(), &meta, section);
    apply_device_offsets(&mut gains, request.target_offsets_db.as_ref());
    if meta.no_air_boost || mix.as_ref().is_some_and(|m| m.dark_air > 0.35) {
        if gains[7] > 0.0 {
            gains[7] = 0.0;
        }
        if gains[6] > 0.6 {
            gains[6] = 0.6;
        }
    }
    clamp_gains(&mut gains);
    smooth_gains(&mut gains);

    let preamp = compute_preamp(&gains, &meta, mix.as_ref(), section);
    let profile = build_profile(&gains, preamp);
    let reason = explain(track, spectrum, &gains, &meta, section, lead);

    RecommendResponse {
        profile,
        reason,
        track_key: track_key(&request.track),
        latency_ms: started.elapsed().as_millis() as u64,
        engine: ENGINE.into(),
    }
}

struct MetaHints {
    tags: Vec<&'static str>,
    vocal: bool,
    speech: bool,
    bass_heavy: bool,
    night: bool,
    no_air_boost: bool,
}

fn metadata_hints(track: Option<&TrackInfo>) -> MetaHints {
    let mut hints = MetaHints {
        tags: Vec::new(),
        vocal: false,
        speech: false,
        bass_heavy: false,
        night: false,
        no_air_boost: false,
    };
    let Some(track) = track else {
        return hints;
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
        hints.speech = true;
        hints.tags.push("speech");
    }

    if contains_any(
        &text,
        &[
            "808", "phonk", "drill", "trap", "dubstep", "edm", "techno", "house", "drum and bass",
            "dnb",
        ],
    ) {
        hints.bass_heavy = true;
        hints.tags.push("bass-heavy");
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
            " ft.",
            " ft ",
            "feat.",
            "featuring",
        ],
    ) {
        hints.vocal = true;
        hints.tags.push("featured vocal");
    }

    if contains_any(
        &text,
        &["lofi", "lo-fi", "chillhop", "sleep", "rain", "ambient", "night"],
    ) {
        hints.night = true;
        hints.no_air_boost = true;
        hints.tags.push("night");
    }

    hints
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
    vocal: f32,
    boom: f32,
    mud: f32,
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

    let snare = unit((crack / mid - 0.62) / 0.55);
    let hats = unit((hat_energy / mid - 0.42) / 0.55);
    let grit = unit(((s.mid + s.low_mid) / 2.0 - 52.0) / 40.0) * unit((crack / mid - 0.48) / 0.4);
    let dark_air = unit((hat_energy - air) / 28.0);
    let crushed = unit((s.rms - 55.0) / 35.0) * unit((snare + hats + grit) / 1.6);
    let boom = unit(((s.sub + s.bass) / mid - 1.55) / 1.1);
    let mud = unit((s.low_mid / mid - 0.92) / 0.45);
    // 808s often out-energy the singer in a crude FFT. If mids are alive,
    // treat that as vocal/lead-instrument energy — not "no vocal".
    let vocal_energy = unit((s.mid - 44.0) / 36.0);
    let vocal_ratio = unit((s.mid / s.bass.max(1.0) - 0.48) / 0.75);
    let vocal = (0.58 * vocal_energy + 0.42 * vocal_ratio * vocal_energy).clamp(0.0, 1.0);

    Some(MixFeatures {
        snare,
        hats,
        grit,
        crushed,
        dark_air,
        vocal,
        boom,
        mud,
    })
}

fn pick_lead(meta: &MetaHints, mix: Option<&MixFeatures>) -> Lead {
    if meta.speech {
        return Lead::Speech;
    }
    let vocal = mix.map(|m| m.vocal).unwrap_or(0.0);
    let boom = mix.map(|m| m.boom).unwrap_or(0.0);
    // Featured singers and mid-forward mixes win over "there's also bass".
    if meta.vocal || vocal > 0.34 {
        return Lead::Vocal;
    }
    if meta.bass_heavy || boom > 0.42 {
        return Lead::Bass;
    }
    Lead::Groove
}

/// Build an enhancement curve. No inverse-EQ / flatten-to-target.
fn enhance(
    lead: Lead,
    mix: Option<&MixFeatures>,
    meta: &MetaHints,
    section: &str,
) -> [f32; BAND_COUNT] {
    let mut gains = match lead {
        Lead::Speech => speech_curve(),
        Lead::Vocal => vocal_curve(mix, meta, section),
        Lead::Bass => bass_curve(mix),
        Lead::Groove => groove_curve(mix),
    };

    if let Some(mix) = mix {
        tame_harshness(&mut gains, mix);
        if mix.mud > 0.35 && lead != Lead::Speech {
            gains[2] -= 0.6 * mix.mud;
        }
    }

    if meta.night {
        gains[6] -= 0.6;
        gains[7] -= 1.2;
    }

    // Loud / crushed masters: keep the shape, just don't slam the boosts.
    if let Some(mix) = mix {
        if mix.crushed > 0.35 {
            let scale = 1.0 - 0.22 * mix.crushed;
            for g in gains.iter_mut() {
                if *g > 0.0 {
                    *g *= scale;
                }
            }
        }
    }

    gains
}

fn speech_curve() -> [f32; BAND_COUNT] {
    [-2.2, -1.4, 0.3, 1.8, 2.8, 1.6, 0.2, -1.2]
}

/// Same idea as the Vocal preset: clear rumble a little, commit to words.
/// Bass is only carved when it is masking the singer — never flattened.
fn vocal_curve(mix: Option<&MixFeatures>, meta: &MetaHints, section: &str) -> [f32; BAND_COUNT] {
    let measured = mix.map(|m| (0.48 + 0.52 * m.vocal).clamp(0.50, 1.0)).unwrap_or(0.72);
    let v = if meta.vocal { measured.max(0.72) } else { measured };
    let boom = mix.map(|m| m.boom).unwrap_or(0.0);
    let grit = mix.map(|m| m.grit).unwrap_or(0.0);
    let hats = mix.map(|m| m.hats).unwrap_or(0.0);
    let snare = mix.map(|m| m.snare).unwrap_or(0.0);
    let sung = mix.map(|m| m.vocal).unwrap_or(0.0);

    // If the vocal is already saturated in 1–2 kHz, keep the lift but lean
    // into body (500) instead of piling more grit.
    let presence = 1.0 - 0.28 * grit;
    let air = (1.0 - 0.50 * hats) * (1.0 - 0.28 * snare);

    let mut gains = [
        -1.1 * v - 0.5 * boom * v,
        -0.55 * v,
        0.0,
        1.6 * v + 0.4 * grit,
        2.9 * v * presence,
        2.3 * v * presence,
        0.7 * v * air,
        -0.55 * v,
    ];

    match section {
        "verse" => {
            gains[3] += 0.25;
            gains[4] += 0.45;
            gains[5] += 0.55;
            gains[0] -= 0.15;
        }
        "chorus" => {
            // Keep the drop. Vocal stays forward; do not scoop the production.
            gains[0] += 0.45 * v;
            gains[1] += 0.25 * v;
            gains[4] += 0.20;
            gains[5] += 0.25;
        }
        "quiet" => {
            gains[4] += 0.55;
            gains[5] += 0.45;
            gains[0] -= 0.20;
        }
        "groove" => {
            // Bass-heavy beat under a singer is still a vocal mix.
            // Only back off words in a true instrumental pocket.
            if sung < 0.22 && !meta.vocal {
                gains[0] += 0.55 * v;
                gains[4] -= 0.25;
                gains[5] -= 0.15;
            } else {
                gains[0] += 0.40 * v;
                gains[1] += 0.15 * v;
            }
        }
        _ => {}
    }

    gains
}

fn bass_curve(mix: Option<&MixFeatures>) -> [f32; BAND_COUNT] {
    let boom = mix.map(|m| (0.55 + 0.45 * m.boom).clamp(0.55, 1.0)).unwrap_or(0.7);
    [
        1.8 * boom,
        1.15 * boom,
        0.15,
        0.0,
        0.35,
        0.85,
        0.35,
        -0.2,
    ]
}

fn groove_curve(mix: Option<&MixFeatures>) -> [f32; BAND_COUNT] {
    let boom = mix.map(|m| m.boom).unwrap_or(0.25);
    [
        1.3 + 0.5 * boom,
        0.8,
        0.0,
        0.45,
        0.7,
        1.35,
        0.75,
        0.25,
    ]
}

fn tame_harshness(gains: &mut [f32; BAND_COUNT], mix: &MixFeatures) {
    if mix.hats > 0.45 {
        gains[7] -= 1.4 * mix.hats;
        if mix.hats > 0.7 {
            gains[6] -= 0.5 * (mix.hats - 0.7);
        }
    }
    if mix.snare > 0.75 && mix.crushed > 0.45 {
        // Only when the crack is actually painful — do not suppress a healthy snare.
        gains[6] -= 0.6 * (mix.snare - 0.75);
    }
}

fn apply_device_offsets(gains: &mut [f32; BAND_COUNT], offsets: Option<&[f32; BAND_COUNT]>) {
    let Some(off) = offsets else {
        return;
    };
    for i in 0..BAND_COUNT {
        gains[i] += off[i] * 0.5;
    }
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

fn clamp_gains(gains: &mut [f32; BAND_COUNT]) {
    for i in 0..BAND_COUNT {
        gains[i] = gains[i].clamp(-MAX_CUT[i], MAX_BOOST[i]);
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
        gains[i] = (left * 0.15 + original[i] * 0.70 + right * 0.15).clamp(-MAX_CUT[i], MAX_BOOST[i]);
    }
}

fn compute_preamp(
    gains: &[f32; BAND_COUNT],
    meta: &MetaHints,
    mix: Option<&MixFeatures>,
    section: &str,
) -> f32 {
    let peak = gains.iter().cloned().fold(0.0_f32, f32::max);
    let mut bias = -0.35;
    if meta.night {
        bias -= 1.6;
    }
    if let Some(mix) = mix {
        bias -= 1.1 * mix.crushed;
    }
    bias += match section {
        "chorus" => -0.25,
        "quiet" => 0.25,
        _ => 0.0,
    };
    (-peak * 0.32 + bias).clamp(-4.5, 0.0)
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
                FilterType::Peaking => (0.75 + gains[i].abs() * 0.07).clamp(0.6, 1.6),
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
    meta: &MetaHints,
    section: &str,
    lead: Lead,
) -> String {
    let title = track
        .map(|t| t.title.as_str())
        .filter(|t| !t.is_empty())
        .unwrap_or("this track");

    let live = spectrum.map(|s| s.rms >= 8.0).unwrap_or(false);
    let source = if live {
        "live mix"
    } else if !meta.tags.is_empty() {
        "title hints"
    } else {
        "default music curve"
    };

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
        "enhancing {lead} in the {section} of {title} ({source}) — strongest {action} near {freq:.0} Hz ({g:+.1} dB).",
        lead = lead.as_str()
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use eq_core::{RecommendRequest, SpectrumBands, TrackInfo};

    #[test]
    fn heavy_low_end_without_vocal_enhances_bass() {
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
        assert!(
            response.profile.bands[0].gain > 0.4,
            "bass-led mix should get a low-end lift, got {}",
            response.profile.bands[0].gain
        );
        assert!(response.profile.bands[7].gain < 1.0);
        assert!(response.reason.contains("low end"));
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
        assert!(response.profile.bands[4].gain > 1.5);
        assert!(response.reason.contains("speech"));
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
    fn crushed_mix_keeps_presence_and_only_tames_harsh_hats() {
        let response = recommend(&RecommendRequest {
            track: Some(TrackInfo {
                title: "Any Similar Song".into(),
                artist: "Unknown".into(),
                ..Default::default()
            }),
            spectrum: Some(crushed_hot_top_spectrum()),
            target_offsets_db: None,
        });

        // Dense mix still has a vocal/mid lead — enhance it, do not scoop it.
        assert!(response.profile.bands[4].gain > 0.8);
        assert!(response.profile.bands[5].gain > 0.4);
        assert!(response.profile.bands[7].gain <= 0.2);
        assert!(response.profile.preamp < 0.0);
    }

    #[test]
    fn vocal_forward_pop_lifts_presence() {
        let response = recommend(&RecommendRequest {
            track: Some(TrackInfo {
                title: "Genius ft. Sia, Diplo, Labrinth".into(),
                artist: "LSD".into(),
                ..Default::default()
            }),
            spectrum: Some(SpectrumBands {
                sub: 72.0,
                bass: 74.0,
                low_mid: 66.0,
                mid: 80.0,
                high_mid: 72.0,
                high: 36.0,
                rms: 70.0,
                crack: 58.0,
                hats: 40.0,
                air: 18.0,
            }),
            target_offsets_db: None,
        });

        assert!(response.reason.contains("vocal"));
        assert!(
            response.profile.bands[4].gain > 1.6,
            "1 kHz should commit like Vocal, got {}",
            response.profile.bands[4].gain
        );
        assert!(response.profile.bands[5].gain > 1.2);
        assert!(response.profile.bands[3].gain > 0.6);
        // Unmask, do not flatten the 808/kick.
        assert!(response.profile.bands[0].gain > -2.3);
        assert!(response.profile.bands[0].gain < 0.8);
        assert!(response.profile.bands[6].gain > -1.2);
    }

    #[test]
    fn featured_vocal_plus_bass_does_not_flatten_the_low_end() {
        let response = recommend(&RecommendRequest {
            track: Some(TrackInfo {
                title: "Genius ft. Sia, Diplo, Labrinth".into(),
                artist: "LSD".into(),
                ..Default::default()
            }),
            spectrum: Some(SpectrumBands {
                sub: 120.0,
                bass: 110.0,
                low_mid: 70.0,
                mid: 68.0,
                high_mid: 60.0,
                high: 34.0,
                rms: 82.0,
                crack: 52.0,
                hats: 38.0,
                air: 16.0,
            }),
            target_offsets_db: None,
        });

        assert!(response.reason.contains("vocal"));
        assert!(
            response.profile.bands[0].gain > -2.2,
            "must not scoop 60 Hz just because Diplo is loud, got {}",
            response.profile.bands[0].gain
        );
        assert!(response.profile.bands[4].gain > 1.2);
        assert!(response.profile.bands[5].gain > 0.8);
    }

    #[test]
    fn same_mix_features_match_regardless_of_title() {
        let spectrum = crushed_hot_top_spectrum();
        let a = recommend(&RecommendRequest {
            track: Some(TrackInfo {
                title: "Loser".into(),
                artist: "Tame Impala".into(),
                ..Default::default()
            }),
            spectrum: Some(spectrum.clone()),
            target_offsets_db: None,
        });
        let b = recommend(&RecommendRequest {
            track: Some(TrackInfo {
                title: "Different Title".into(),
                artist: "Different Artist".into(),
                ..Default::default()
            }),
            spectrum: Some(spectrum),
            target_offsets_db: None,
        });

        for i in 0..BAND_COUNT {
            let delta = (a.profile.bands[i].gain - b.profile.bands[i].gain).abs();
            assert!(delta < 0.15, "band {i} differed by {delta}");
        }
    }
}
