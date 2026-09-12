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

const ENGINE: &str = "universal-eq-rust/1.2";

/// 40, 63, 100, 160, 250, 400, 630, 1k, 1.6k, 2.5k, 4k, 6.3k, 10k, 12.5k, 16k
const I_SUB: usize = 0;
const I_KICK: usize = 1;
const I_BASS: usize = 2;
const I_BODY: usize = 3;
const I_WARM: usize = 4;
const I_MUD: usize = 5;
const I_NASAL: usize = 6;
const I_WORDS: usize = 7;
const I_PRES: usize = 8;
const I_INTEL: usize = 9;
const I_ATTACK: usize = 10;
const I_HATS: usize = 11;
const I_AIR: usize = 12;
const I_SHEEN: usize = 13;
const I_TOP: usize = 14;

const MAX_BOOST: [f32; BAND_COUNT] = [
    2.2, 2.4, 2.0, 1.6, 1.4, 1.2, 2.4, 3.4, 3.2, 3.0, 2.6, 2.8, 2.6, 2.2, 1.4,
];
const MAX_CUT: [f32; BAND_COUNT] = [
    2.0, 2.2, 1.8, 1.6, 1.6, 2.0, 1.0, 0.8, 0.8, 1.0, 1.4, 2.2, 2.4, 2.6, 2.8,
];

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
    // Only flatten true air on explicit night/lofi listening — YouTube
    // always looks "dark" at 12 kHz and must not mute snare / vocal air.
    if meta.no_air_boost {
        for i in I_SHEEN..=I_TOP {
            if gains[i] > 0.0 {
                gains[i] *= 0.35;
            }
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
        &[
            "lofi",
            "lo-fi",
            "chillhop",
            "sleep mix",
            "rain sounds",
            "ambient mix",
            "night lofi",
            "lofi night",
        ],
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
    // A singer over a beat is still a vocal record. Bass-lead is only for
    // tagged 808/EDM or a true instrumental pocket with almost no mids.
    if meta.vocal {
        return Lead::Vocal;
    }
    if (meta.bass_heavy && vocal < 0.32) || (boom > 0.75 && vocal < 0.16) {
        return Lead::Bass;
    }
    if vocal > 0.18 {
        return Lead::Vocal;
    }
    if vocal < 0.10 && boom < 0.35 {
        return Lead::Groove;
    }
    Lead::Vocal
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
        open_snare(&mut gains, mix, lead);
        tame_harshness(&mut gains, mix);
        if mix.dark_air > 0.4 {
            // YouTube often has no 16 kHz; do not invent hiss there.
            gains[I_TOP] = gains[I_TOP].min(0.35);
        }
        if mix.mud > 0.22 && lead != Lead::Speech {
            gains[I_MUD] -= 1.1 * mix.mud;
            gains[I_WARM] -= 0.65 * mix.mud;
        }
    }

    if meta.night {
        gains[I_HATS] -= 0.5;
        gains[I_AIR] -= 1.0;
        gains[I_SHEEN] -= 1.2;
        gains[I_TOP] -= 1.4;
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
    [
        -2.4, -2.0, -1.2, -0.4, 0.2, 0.5, 1.6, 2.8, 2.4, 1.6, 0.4, -0.2, -1.0, -1.2, -1.4,
    ]
}

/// Same idea as the Vocal preset: clear rumble a little, commit to words.
/// Bass is only carved when it is masking the singer — never flattened.
fn vocal_curve(mix: Option<&MixFeatures>, meta: &MetaHints, section: &str) -> [f32; BAND_COUNT] {
    let measured = mix.map(|m| (0.48 + 0.52 * m.vocal).clamp(0.50, 1.0)).unwrap_or(0.72);
    let v = if meta.vocal { measured.max(0.72) } else { measured };
    let boom = mix.map(|m| m.boom).unwrap_or(0.0);
    let grit = mix.map(|m| m.grit).unwrap_or(0.0);
    let snare = mix.map(|m| m.snare).unwrap_or(0.0);
    let sung = mix.map(|m| m.vocal).unwrap_or(0.0);

    // Match a hand-tuned vocal: peak 2.5–4 kHz, keep 6–13 kHz open.
    // 1 kHz is body, not the lead — too much sounds nasal/muffled.
    let presence = 1.0 - 0.12 * grit;

    let mut gains = [0.0_f32; BAND_COUNT];
    gains[I_SUB] = -0.6 * v - 0.25 * boom * v;
    gains[I_KICK] = -0.7 * v - 0.3 * boom * v;
    gains[I_BASS] = -0.35 * v;
    gains[I_BODY] = -0.15 * v;
    gains[I_WARM] = -0.25 * v;
    gains[I_MUD] = -0.45 * v;
    gains[I_NASAL] = 0.35 * v;
    gains[I_WORDS] = 0.9 * v * presence;
    gains[I_PRES] = 2.2 * v * presence;
    gains[I_INTEL] = 2.7 * v * presence;
    gains[I_ATTACK] = 2.3 * v + 0.7 * snare;
    gains[I_HATS] = 1.9 * v + 0.5 * snare;
    gains[I_AIR] = 1.8 * v + 0.25 * snare;
    gains[I_SHEEN] = 1.5 * v;
    gains[I_TOP] = 0.65 * v;

    match section {
        "verse" => {
            gains[I_PRES] += 0.45;
            gains[I_INTEL] += 0.55;
            gains[I_ATTACK] += 0.4;
            gains[I_HATS] += 0.25;
            gains[I_KICK] -= 0.15;
        }
        "chorus" => {
            gains[I_SUB] += 0.2 * v;
            gains[I_KICK] += 0.15 * v;
            gains[I_PRES] += 0.25;
            gains[I_INTEL] += 0.4;
            gains[I_ATTACK] += 0.45;
            gains[I_HATS] += 0.3;
            gains[I_AIR] += 0.25;
        }
        "quiet" => {
            gains[I_PRES] += 0.4;
            gains[I_INTEL] += 0.45;
            gains[I_ATTACK] += 0.25;
            gains[I_AIR] += 0.2;
            gains[I_KICK] -= 0.15;
        }
        "groove" => {
            if sung < 0.22 && !meta.vocal {
                gains[I_KICK] += 0.3 * v;
                gains[I_INTEL] += 0.3;
                gains[I_ATTACK] += 0.5;
                gains[I_HATS] += 0.35;
            } else {
                gains[I_PRES] += 0.3;
                gains[I_INTEL] += 0.5;
                gains[I_ATTACK] += 0.55;
                gains[I_HATS] += 0.5;
                gains[I_AIR] += 0.45;
                gains[I_SHEEN] += 0.35;
            }
        }
        _ => {}
    }

    gains
}

fn bass_curve(mix: Option<&MixFeatures>) -> [f32; BAND_COUNT] {
    let boom = mix.map(|m| (0.55 + 0.45 * m.boom).clamp(0.55, 1.0)).unwrap_or(0.7);
    let mut gains = [0.0_f32; BAND_COUNT];
    gains[I_SUB] = 1.6 * boom;
    gains[I_KICK] = 1.9 * boom;
    gains[I_BASS] = 1.25 * boom;
    gains[I_BODY] = 0.7 * boom;
    gains[I_WARM] = 0.15;
    gains[I_WORDS] = 0.3;
    gains[I_PRES] = 0.55;
    gains[I_INTEL] = 1.1;
    gains[I_ATTACK] = 0.9;
    gains[I_HATS] = 0.85;
    gains[I_AIR] = 0.9;
    gains[I_SHEEN] = 0.7;
    gains
}

fn groove_curve(mix: Option<&MixFeatures>) -> [f32; BAND_COUNT] {
    let boom = mix.map(|m| m.boom).unwrap_or(0.25);
    let snare = mix.map(|m| m.snare).unwrap_or(0.25);
    let mut gains = [0.0_f32; BAND_COUNT];
    gains[I_SUB] = 1.1 + 0.4 * boom;
    gains[I_KICK] = 1.4 + 0.3 * boom;
    gains[I_BASS] = 0.85;
    gains[I_BODY] = 0.4;
    gains[I_MUD] = -0.35;
    gains[I_NASAL] = 0.35;
    gains[I_WORDS] = 0.6;
    gains[I_PRES] = 0.95;
    gains[I_INTEL] = 1.5 + 0.4 * snare;
    gains[I_ATTACK] = 1.2 + 0.7 * snare;
    gains[I_HATS] = 1.35 + 0.45 * snare;
    gains[I_AIR] = 1.55;
    gains[I_SHEEN] = 1.2;
    gains
}

/// Bring back snare crack on dense / YouTube-dark mixes without making hats hiss.
fn open_snare(gains: &mut [f32; BAND_COUNT], mix: &MixFeatures, lead: Lead) {
    if mix.snare > 0.78 && mix.crushed > 0.55 {
        return;
    }
    let need = if mix.snare < 0.55 {
        0.55 + (0.55 - mix.snare)
    } else {
        0.35
    };
    let scale = if lead == Lead::Speech { 0.45 } else { 1.0 };
    gains[I_INTEL] += 0.55 * need * scale;
    gains[I_ATTACK] += 0.95 * need * scale;
    gains[I_HATS] += 0.55 * need * scale;
    gains[I_AIR] += 0.4 * need * scale;
}

fn tame_harshness(gains: &mut [f32; BAND_COUNT], mix: &MixFeatures) {
    // Only shave 16 kHz hiss. 6.3 / 10 / 12.5 kHz carry snare and air.
    if mix.hats > 0.7 {
        gains[I_TOP] -= 0.7 * (mix.hats - 0.7);
        gains[I_SHEEN] -= 0.25 * (mix.hats - 0.7);
    }
    if mix.snare > 0.82 && mix.crushed > 0.55 {
        // Only when the crack is actually painful — do not bury a healthy snare.
        gains[I_ATTACK] -= 0.35 * (mix.snare - 0.82);
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
                FilterType::Peaking => (1.15 + gains[i].abs() * 0.06).clamp(1.0, 1.8),
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
                title: "Phonk 808".into(),
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
        assert_eq!(response.profile.bands[I_WORDS].frequency, 1000.0);
        assert_eq!(response.profile.bands[I_INTEL].frequency, 2500.0);
        assert!(response.latency_ms < 500);
        assert!(
            response.profile.bands[0].gain > 0.4,
            "bass-led mix should get a low-end lift, got {}",
            response.profile.bands[0].gain
        );
        assert!(response.profile.bands[I_AIR].gain >= 0.0);
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

        assert!(response.profile.bands[I_WORDS].gain > response.profile.bands[I_KICK].gain);
        assert!(response.profile.bands[I_WORDS].gain > 1.5);
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
        assert!(response.profile.bands[I_INTEL].gain > 1.2);
        assert!(response.profile.bands[I_PRES].gain > 0.8);
        assert!(response.profile.bands[I_HATS].gain > 0.6);
        assert!(response.profile.bands[I_AIR].gain > 0.4);
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
            response.profile.bands[I_INTEL].gain > 1.8,
            "2.5 kHz should be the vocal peak, got {}",
            response.profile.bands[I_INTEL].gain
        );
        assert!(response.profile.bands[I_INTEL].gain > response.profile.bands[I_WORDS].gain);
        assert!(response.profile.bands[I_PRES].gain > 1.2);
        assert!(response.profile.bands[I_HATS].gain > 1.0);
        assert!(response.profile.bands[I_AIR].gain > 0.8);
        // Unmask, do not flatten the 808/kick.
        assert!(response.profile.bands[I_KICK].gain > -2.3);
        assert!(response.profile.bands[I_KICK].gain < 0.8);
        assert!(response.profile.bands[I_ATTACK].gain > -1.2);
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
            response.profile.bands[I_KICK].gain > -2.2,
            "must not scoop 63 Hz just because Diplo is loud, got {}",
            response.profile.bands[I_KICK].gain
        );
        assert!(response.profile.bands[I_INTEL].gain > 1.4);
        assert!(response.profile.bands[I_PRES].gain > 0.8);
    }

    #[test]
    fn rap_groove_unmuffles_vocal_and_opens_snare() {
        let response = recommend(&RecommendRequest {
            track: Some(TrackInfo {
                title: "Eminem - Houdini [Official Music Video]".into(),
                artist: "EminemVEVO".into(),
                ..Default::default()
            }),
            spectrum: Some(SpectrumBands {
                sub: 104.0,
                bass: 98.0,
                low_mid: 76.0,
                mid: 70.0,
                high_mid: 58.0,
                high: 30.0,
                rms: 78.0,
                crack: 52.0,
                hats: 34.0,
                air: 14.0,
            }),
            target_offsets_db: None,
        });

        assert!(response.reason.contains("vocal"));
        assert!(
            response.profile.bands[I_MUD].gain < 0.0,
            "400 Hz should unmuffle, got {}",
            response.profile.bands[I_MUD].gain
        );
        assert!(
            response.profile.bands[I_INTEL].gain > 1.8,
            "2.5 kHz consonants should be open, got {}",
            response.profile.bands[I_INTEL].gain
        );
        assert!(
            response.profile.bands[I_ATTACK].gain > 1.6,
            "4 kHz snare crack should be hearable, got {}",
            response.profile.bands[I_ATTACK].gain
        );
        assert!(
            response.profile.bands[I_HATS].gain > 0.8,
            "6.3 kHz should stay open, got {}",
            response.profile.bands[I_HATS].gain
        );
        assert!(
            response.profile.bands[I_AIR].gain > 0.8,
            "10 kHz should stay open, got {}",
            response.profile.bands[I_AIR].gain
        );
    }

    #[test]
    fn song_title_with_night_does_not_mute_air() {
        let response = recommend(&RecommendRequest {
            track: Some(TrackInfo {
                title: "FINNEAS - Let's Fall in Love for the Night (Official Video)".into(),
                artist: "FINNEAS".into(),
                ..Default::default()
            }),
            spectrum: Some(SpectrumBands {
                sub: 70.0,
                bass: 74.0,
                low_mid: 68.0,
                mid: 78.0,
                high_mid: 64.0,
                high: 34.0,
                rms: 72.0,
                crack: 48.0,
                hats: 32.0,
                air: 16.0,
            }),
            target_offsets_db: None,
        });

        assert!(!response.reason.contains("night"));
        assert!(response.reason.contains("vocal"));
        assert!(
            response.profile.bands[I_HATS].gain > 1.0,
            "6.3 kHz muffled, got {}",
            response.profile.bands[I_HATS].gain
        );
        assert!(
            response.profile.bands[I_AIR].gain > 1.0,
            "10 kHz muffled, got {}",
            response.profile.bands[I_AIR].gain
        );
        assert!(
            response.profile.bands[I_SHEEN].gain > 0.6,
            "12.5 kHz muffled, got {}",
            response.profile.bands[I_SHEEN].gain
        );
        assert!(response.profile.bands[I_ATTACK].gain > 1.6);
        assert!(
            response.profile.bands[I_SHEEN].gain >= 0.0,
            "must not cut 12.5 kHz on a vocal song, got {}",
            response.profile.bands[I_SHEEN].gain
        );
    }

    #[test]
    fn singer_over_bass_groove_stays_vocal_not_low_end() {
        let response = recommend(&RecommendRequest {
            track: Some(TrackInfo {
                title: "FINNEAS - Let's Fall in Love for the Night (Official Video)".into(),
                artist: "FINNEAS".into(),
                ..Default::default()
            }),
            spectrum: Some(SpectrumBands {
                sub: 110.0,
                bass: 102.0,
                low_mid: 64.0,
                mid: 56.0,
                high_mid: 48.0,
                high: 28.0,
                rms: 76.0,
                crack: 40.0,
                hats: 26.0,
                air: 12.0,
            }),
            target_offsets_db: None,
        });

        assert!(
            response.reason.contains("vocal"),
            "must not flip to low end, got {}",
            response.reason
        );
        assert!(response.profile.bands[I_INTEL].gain > response.profile.bands[I_KICK].gain);
        assert!(response.profile.bands[I_SHEEN].gain >= 0.0);
        assert!(response.profile.bands[I_AIR].gain > 0.6);
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
