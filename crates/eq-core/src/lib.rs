use serde::{Deserialize, Serialize};
use thiserror::Error;

pub const BAND_COUNT: usize = 15;
/// ISO 2/3-octave points from sub to air.
pub const DEFAULT_FREQUENCIES: [f32; BAND_COUNT] = [
    40.0, 63.0, 100.0, 160.0, 250.0, 400.0, 630.0, 1000.0, 1600.0, 2500.0, 4000.0, 6300.0,
    10000.0, 12500.0, 16000.0,
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FilterType {
    Peaking,
    Lowshelf,
    Highshelf,
}

impl FilterType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Peaking => "peaking",
            Self::Lowshelf => "lowshelf",
            Self::Highshelf => "highshelf",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EqBand {
    pub id: String,
    #[serde(rename = "type")]
    pub filter_type: FilterType,
    pub frequency: f32,
    pub gain: f32,
    pub q: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EqProfile {
    pub id: String,
    pub name: String,
    pub preamp: f32,
    pub bands: Vec<EqBand>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct TrackInfo {
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub artist: String,
    #[serde(default)]
    pub album: String,
    #[serde(default)]
    pub source: String,
    #[serde(default)]
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SpectrumBands {
    pub sub: f32,
    pub bass: f32,
    pub low_mid: f32,
    pub mid: f32,
    pub high_mid: f32,
    pub high: f32,
    pub rms: f32,
    /// Snare / clap crack, ~2.5–5 kHz. Optional; 0 = derive from high_mid.
    #[serde(default)]
    pub crack: f32,
    /// Closed-hat tick, ~6–10 kHz. Optional; 0 = derive from high.
    #[serde(default)]
    pub hats: f32,
    /// True air, ~10–16 kHz. YouTube often empty here even when hats are loud.
    #[serde(default)]
    pub air: f32,
}

impl Default for SpectrumBands {
    fn default() -> Self {
        Self {
            sub: 0.0,
            bass: 0.0,
            low_mid: 0.0,
            mid: 0.0,
            high_mid: 0.0,
            high: 0.0,
            rms: 0.0,
            crack: 0.0,
            hats: 0.0,
            air: 0.0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RecommendRequest {
    #[serde(default)]
    pub track: Option<TrackInfo>,
    #[serde(default)]
    pub spectrum: Option<SpectrumBands>,
    /// Optional headphone / speaker target offset in dB per band.
    #[serde(default)]
    pub target_offsets_db: Option<[f32; BAND_COUNT]>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RecommendResponse {
    pub profile: EqProfile,
    pub reason: String,
    pub track_key: String,
    pub latency_ms: u64,
    pub engine: String,
}

#[derive(Debug, Error)]
pub enum EqError {
    #[error("invalid band count: expected {expected}, got {got}")]
    InvalidBandCount { expected: usize, got: usize },
}

impl EqProfile {
    pub fn flat(name: &str) -> Self {
        let bands = DEFAULT_FREQUENCIES
            .iter()
            .enumerate()
            .map(|(i, &frequency)| {
                let filter_type = match i {
                    0 => FilterType::Lowshelf,
                    n if n + 1 == BAND_COUNT => FilterType::Highshelf,
                    _ => FilterType::Peaking,
                };
                EqBand {
                    id: format!("b{}", i + 1),
                    filter_type,
                    frequency,
                    gain: 0.0,
                    q: if matches!(filter_type, FilterType::Peaking) {
                        1.0
                    } else {
                        0.7
                    },
                }
            })
            .collect();

        Self {
            id: "custom".into(),
            name: name.into(),
            preamp: 0.0,
            bands,
        }
    }
}

pub fn track_key(track: &Option<TrackInfo>) -> String {
    match track {
        Some(t) =>         format!(
            "{} | {} | {}",
            t.source.to_lowercase(),
            t.artist.to_lowercase(),
            t.title.to_lowercase()
        ),
        None => String::new(),
    }
}
