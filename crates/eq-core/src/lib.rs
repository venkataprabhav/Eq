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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum DeviceClass {
    #[default]
    Unknown,
    Speakers,
    Headphones,
    Headset,
    Hdmi,
    BluetoothHeadphones,
    BluetoothSpeaker,
    BluetoothHeadset,
}

impl DeviceClass {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Unknown => "unknown",
            Self::Speakers => "speakers",
            Self::Headphones => "headphones",
            Self::Headset => "headset",
            Self::Hdmi => "hdmi",
            Self::BluetoothHeadphones => "bluetooth_headphones",
            Self::BluetoothSpeaker => "bluetooth_speaker",
            Self::BluetoothHeadset => "bluetooth_headset",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::Unknown => "output",
            Self::Speakers => "speakers",
            Self::Headphones => "headphones",
            Self::Headset => "headset",
            Self::Hdmi => "display speakers",
            Self::BluetoothHeadphones => "bluetooth headphones",
            Self::BluetoothSpeaker => "bluetooth speaker",
            Self::BluetoothHeadset => "bluetooth headset",
        }
    }

    pub fn is_bluetooth(self) -> bool {
        matches!(
            self,
            Self::BluetoothHeadphones | Self::BluetoothSpeaker | Self::BluetoothHeadset
        )
    }

    /// WASAPI form factors: 1 speakers, 3 headphones, 5 headset, 9 HDMI.
    pub fn classify(enumerator: &str, form_factor: u32, name: &str, interface: &str) -> Self {
        let blob = format!("{enumerator} {name} {interface}").to_ascii_lowercase();
        let bluetooth = enumerator.eq_ignore_ascii_case("BTHENUM")
            || enumerator.eq_ignore_ascii_case("BTHHFENUM")
            || blob.contains("bthenum")
            || blob.contains("bluetooth")
            || blob.contains("a2dp")
            || blob.contains("hands-free")
            || blob.contains("handsfree");
        let speaker_product = SPEAKER_PRODUCTS
            .iter()
            .any(|needle| blob.contains(needle));

        if bluetooth {
            if form_factor == 5 || blob.contains("hands-free") || blob.contains("handsfree") {
                return Self::BluetoothHeadset;
            }
            if form_factor == 1 || speaker_product {
                return Self::BluetoothSpeaker;
            }
            return Self::BluetoothHeadphones;
        }

        match form_factor {
            3 => Self::Headphones,
            4 | 5 | 6 => Self::Headset,
            9 => Self::Hdmi,
            1 => Self::Speakers,
            _ => Self::Unknown,
        }
    }
}

const SPEAKER_PRODUCTS: &[&str] = &[
    "charge",
    "flip ",
    "flip5",
    "flip 5",
    "flip6",
    "flip 6",
    "boom",
    "partybox",
    "soundbar",
    "srs-xb",
    "srs xb",
    "xb13",
    "xb23",
    "xb33",
    "xb43",
    "clip ",
    "minirig",
    "ue boom",
    "wonderboom",
];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct OutputDeviceHint {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub class: DeviceClass,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct RecommendRequest {
    #[serde(default)]
    pub track: Option<TrackInfo>,
    #[serde(default)]
    pub spectrum: Option<SpectrumBands>,
    /// Optional headphone / speaker target offset in dB per band.
    #[serde(default)]
    pub target_offsets_db: Option<[f32; BAND_COUNT]>,
    /// Active playback device. Auto uses this for Bluetooth / speaker compensation.
    #[serde(default)]
    pub device: Option<OutputDeviceHint>,
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
        Some(t) => format!(
            "{} | {} | {}",
            t.source.to_lowercase(),
            t.artist.to_lowercase(),
            t.title.to_lowercase()
        ),
        None => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::DeviceClass;

    #[test]
    fn classifies_sony_headphones_as_bluetooth() {
        let class = DeviceClass::classify("BTHENUM", 3, "Headphones", "WH-1000XM6");
        assert_eq!(class, DeviceClass::BluetoothHeadphones);
        assert!(class.is_bluetooth());
    }

    #[test]
    fn classifies_jbl_charge_as_bluetooth_speaker() {
        let class = DeviceClass::classify("BTHENUM", 1, "Speakers", "srihaas' JBL Charge 6");
        assert_eq!(class, DeviceClass::BluetoothSpeaker);
    }

    #[test]
    fn classifies_srs_xb_as_bluetooth_speaker() {
        let class = DeviceClass::classify("BTHENUM", 1, "Speakers", "SRS-XB23");
        assert_eq!(class, DeviceClass::BluetoothSpeaker);
    }

    #[test]
    fn classifies_hdmi_monitor() {
        let class = DeviceClass::classify("HDAUDIO", 9, "LG ULTRAGEAR", "NVIDIA High Definition Audio");
        assert_eq!(class, DeviceClass::Hdmi);
        assert!(!class.is_bluetooth());
    }

    #[test]
    fn skips_calling_hands_free_as_music_headphones() {
        let class = DeviceClass::classify(
            "INTELAUDIO",
            5,
            "Headset",
            "Srihaas's Buds4 Pro Hands-Free",
        );
        assert_eq!(class, DeviceClass::BluetoothHeadset);
    }
}
