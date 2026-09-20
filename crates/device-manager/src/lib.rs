//! Playback-device detection for Universal EQ.
//!
//! Windows uses WASAPI endpoint enumeration so Bluetooth headphones and
//! speakers show up with a real product name, not just "Speakers".

use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use eq_core::{DeviceClass, OutputDeviceHint};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct OutputDevice {
    pub id: String,
    pub name: String,
    pub class: DeviceClass,
    pub transport: String,
    pub enumerator: String,
    pub form_factor: u32,
    pub active: bool,
    pub is_default: bool,
    pub bluetooth: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DeviceInventory {
    pub devices: Vec<OutputDevice>,
    pub default_id: Option<String>,
    pub output: Option<OutputDevice>,
}

impl DeviceInventory {
    pub fn empty() -> Self {
        Self {
            devices: Vec::new(),
            default_id: None,
            output: None,
        }
    }

    pub fn hint(&self) -> Option<OutputDeviceHint> {
        self.output.as_ref().map(|device| OutputDeviceHint {
            id: device.id.clone(),
            name: device.name.clone(),
            class: device.class,
        })
    }
}

pub fn list_output_devices() -> DeviceInventory {
    #[cfg(windows)]
    {
        windows_wasapi::list_output_devices().unwrap_or_else(|_| DeviceInventory::empty())
    }
    #[cfg(not(windows))]
    {
        DeviceInventory::empty()
    }
}

struct DeviceCache {
    at: Instant,
    inventory: DeviceInventory,
}

static DEVICE_CACHE: OnceLock<Mutex<Option<DeviceCache>>> = OnceLock::new();

pub fn list_output_devices_cached() -> DeviceInventory {
    let cache = DEVICE_CACHE.get_or_init(|| Mutex::new(None));
    if let Ok(guard) = cache.lock() {
        if let Some(entry) = guard.as_ref() {
            if entry.at.elapsed() < Duration::from_millis(1500) {
                return entry.inventory.clone();
            }
        }
    }
    let inventory = list_output_devices();
    if let Ok(mut guard) = cache.lock() {
        *guard = Some(DeviceCache {
            at: Instant::now(),
            inventory: inventory.clone(),
        });
    }
    inventory
}

fn display_name(friendly: &str, desc: &str, interface: &str) -> String {
    let friendly = friendly.trim();
    if !friendly.is_empty() && !is_generic_endpoint(friendly) {
        return friendly.to_string();
    }
    let interface = interface.trim();
    if !interface.is_empty() && !is_generic_host(interface) {
        return interface.to_string();
    }
    let desc = desc.trim();
    if !desc.is_empty() {
        if !interface.is_empty() && interface != desc {
            return format!("{desc} ({interface})");
        }
        return desc.to_string();
    }
    if !friendly.is_empty() {
        return friendly.to_string();
    }
    "Audio output".into()
}

fn is_generic_endpoint(name: &str) -> bool {
    matches!(
        name,
        "Speakers"
            | "Headphones"
            | "Headset"
            | "Headset Earphone"
            | "Microphone"
            | "Internal AUX Jack"
    )
}

fn is_generic_host(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.contains("smart sound technology")
        || lower.contains("high definition audio")
        || lower.contains("microsoft streaming")
}

fn is_junk(name: &str, form_factor: u32) -> bool {
    if form_factor == 10 {
        return true;
    }
    let lower = name.to_ascii_lowercase();
    lower.contains("internal aux") || lower.contains("stereo mix")
}

fn transport_of(class: DeviceClass, enumerator: &str) -> String {
    if class.is_bluetooth() {
        return "bluetooth".into();
    }
    match enumerator.to_ascii_uppercase().as_str() {
        "USB" | "USBAUDIO" => "usb".into(),
        "HDAUDIO" => "hdmi".into(),
        "INTELAUDIO" | "REALTEK" => "analog".into(),
        other if other.contains("BTH") => "bluetooth".into(),
        _ => "unknown".into(),
    }
}

fn should_keep(device: &OutputDevice) -> bool {
    if is_junk(&device.name, device.form_factor) {
        return false;
    }
    if device.class == DeviceClass::BluetoothHeadset {
        return false;
    }
    if device.active {
        return true;
    }
    device.bluetooth && device.enumerator.eq_ignore_ascii_case("BTHENUM")
}

fn finalize(mut devices: Vec<OutputDevice>, default_id: Option<String>) -> DeviceInventory {
    devices.retain(should_keep);
    devices.sort_by(|a, b| {
        b.is_default
            .cmp(&a.is_default)
            .then(b.active.cmp(&a.active))
            .then(b.bluetooth.cmp(&a.bluetooth))
            .then(a.name.to_ascii_lowercase().cmp(&b.name.to_ascii_lowercase()))
    });
    devices.dedup_by(|a, b| {
        a.bluetooth
            && b.bluetooth
            && a.name.eq_ignore_ascii_case(&b.name)
            && a.active == b.active
    });

    let default_id = default_id.filter(|id| devices.iter().any(|device| &device.id == id));
    if let Some(id) = default_id.as_deref() {
        for device in &mut devices {
            device.is_default = device.id == id;
        }
    }

    let output = resolve_output(&devices, default_id.as_deref());
    DeviceInventory {
        devices,
        default_id,
        output,
    }
}

fn resolve_output(devices: &[OutputDevice], default_id: Option<&str>) -> Option<OutputDevice> {
    let default = default_id.and_then(|id| devices.iter().find(|device| device.id == id));
    if let Some(device) = default {
        if device.bluetooth && !is_generic_endpoint(&device.name) {
            return Some(device.clone());
        }
        if device.bluetooth {
            if let Some(named) = devices.iter().find(|candidate| {
                candidate.bluetooth
                    && candidate.active
                    && !is_generic_endpoint(&candidate.name)
                    && candidate.enumerator.eq_ignore_ascii_case("BTHENUM")
            }) {
                return Some(named.clone());
            }
        }
        return Some(device.clone());
    }
    devices.iter().find(|device| device.active).cloned()
}

#[cfg(windows)]
mod windows_wasapi {
    use super::{
        display_name, finalize, transport_of, DeviceInventory, OutputDevice,
    };
    use eq_core::DeviceClass;
    use windows::core::{GUID, PWSTR};
    use windows::Win32::Devices::FunctionDiscovery::{
        PKEY_Device_DeviceDesc, PKEY_Device_EnumeratorName, PKEY_Device_FriendlyName,
    };
    use windows::Win32::Media::Audio::{
        eMultimedia, eRender, IMMDevice, IMMDeviceEnumerator, MMDeviceEnumerator,
        PKEY_AudioEndpoint_FormFactor, DEVICE_STATE, DEVICE_STATE_ACTIVE, DEVICE_STATE_UNPLUGGED,
    };
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoTaskMemFree, CLSCTX_ALL, COINIT_MULTITHREADED,
        STGM_READ,
    };
    use windows::Win32::UI::Shell::PropertiesSystem::{IPropertyStore, PROPERTYKEY};

    const PKEY_DEVICE_INTERFACE_NAME: PROPERTYKEY = PROPERTYKEY {
        fmtid: GUID::from_u128(0xb3f8fa53_0004_438e_9003_51a46e139bfc),
        pid: 6,
    };

    pub fn list_output_devices() -> windows::core::Result<DeviceInventory> {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED).ok();
            let enumerator: IMMDeviceEnumerator =
                CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;

            let default_id = enumerator
                .GetDefaultAudioEndpoint(eRender, eMultimedia)
                .ok()
                .and_then(|device| pwstr_to_string(device.GetId().ok()?));

            let mask = DEVICE_STATE(DEVICE_STATE_ACTIVE.0 | DEVICE_STATE_UNPLUGGED.0);
            let collection = enumerator.EnumAudioEndpoints(eRender, mask)?;
            let count = collection.GetCount()?;
            let mut devices = Vec::with_capacity(count as usize);
            for index in 0..count {
                let device = collection.Item(index)?;
                if let Some(parsed) = parse_device(&device, default_id.as_deref()) {
                    devices.push(parsed);
                }
            }
            Ok(finalize(devices, default_id))
        }
    }

    unsafe fn parse_device(device: &IMMDevice, default_id: Option<&str>) -> Option<OutputDevice> {
        let id = pwstr_to_string(device.GetId().ok()?)?;
        let store: IPropertyStore = device.OpenPropertyStore(STGM_READ).ok()?;
        let friendly = prop_string(&store, &PKEY_Device_FriendlyName).unwrap_or_default();
        let desc = prop_string(&store, &PKEY_Device_DeviceDesc).unwrap_or_default();
        let interface = prop_string(&store, &PKEY_DEVICE_INTERFACE_NAME).unwrap_or_default();
        let enumerator = prop_string(&store, &PKEY_Device_EnumeratorName).unwrap_or_default();
        let form_factor = prop_u32(&store, &PKEY_AudioEndpoint_FormFactor).unwrap_or(0);
        let name = display_name(&friendly, &desc, &interface);
        let class = DeviceClass::classify(&enumerator, form_factor, &name, &interface);
        let state = device.GetState().ok()?.0 & 0xF;
        Some(OutputDevice {
            id: id.clone(),
            name,
            class,
            transport: transport_of(class, &enumerator),
            enumerator,
            form_factor,
            active: state == DEVICE_STATE_ACTIVE.0,
            is_default: default_id == Some(id.as_str()),
            bluetooth: class.is_bluetooth(),
        })
    }

    unsafe fn prop_string(store: &IPropertyStore, key: &PROPERTYKEY) -> Option<String> {
        let value = store.GetValue(key).ok()?;
        let text = value.to_string();
        let trimmed = text.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    }

    unsafe fn prop_u32(store: &IPropertyStore, key: &PROPERTYKEY) -> Option<u32> {
        let value = store.GetValue(key).ok()?;
        u32::try_from(&value).ok()
    }

    unsafe fn pwstr_to_string(ptr: PWSTR) -> Option<String> {
        if ptr.is_null() {
            return None;
        }
        let text = ptr.to_string().ok();
        CoTaskMemFree(Some(ptr.0 as _));
        text.filter(|value| !value.is_empty())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use eq_core::DeviceClass;

    #[test]
    fn display_name_prefers_product() {
        assert_eq!(
            display_name("Headphones", "Headphones", "WH-1000XM6"),
            "WH-1000XM6"
        );
        assert_eq!(
            display_name("Speakers (Realtek(R) Audio)", "Speakers", "Realtek(R) Audio"),
            "Speakers (Realtek(R) Audio)"
        );
    }

    #[test]
    fn finalize_hides_hands_free_and_keeps_paired_bluetooth() {
        let inventory = finalize(
            vec![
                OutputDevice {
                    id: "bt".into(),
                    name: "WH-1000XM6".into(),
                    class: DeviceClass::BluetoothHeadphones,
                    transport: "bluetooth".into(),
                    enumerator: "BTHENUM".into(),
                    form_factor: 3,
                    active: false,
                    is_default: false,
                    bluetooth: true,
                },
                OutputDevice {
                    id: "hfp".into(),
                    name: "WH-1000XM6 Hands-Free".into(),
                    class: DeviceClass::BluetoothHeadset,
                    transport: "bluetooth".into(),
                    enumerator: "BTHENUM".into(),
                    form_factor: 5,
                    active: true,
                    is_default: false,
                    bluetooth: true,
                },
                OutputDevice {
                    id: "hdmi".into(),
                    name: "LG ULTRAGEAR".into(),
                    class: DeviceClass::Hdmi,
                    transport: "hdmi".into(),
                    enumerator: "HDAUDIO".into(),
                    form_factor: 9,
                    active: true,
                    is_default: true,
                    bluetooth: false,
                },
            ],
            Some("hdmi".into()),
        );
        assert_eq!(inventory.devices.len(), 2);
        assert!(inventory
            .devices
            .iter()
            .any(|device| device.name == "WH-1000XM6" && !device.active));
        assert!(!inventory
            .devices
            .iter()
            .any(|device| device.class == DeviceClass::BluetoothHeadset));
        assert_eq!(inventory.output.as_ref().map(|d| d.name.as_str()), Some("LG ULTRAGEAR"));
    }

    #[test]
    fn enumerates_real_windows_outputs() {
        let inventory = list_output_devices();
        assert!(
            inventory.devices.iter().any(|device| device.active),
            "expected an active output, got {:?}",
            inventory.devices
        );
        assert!(
            inventory.devices.iter().any(|device| device.bluetooth),
            "expected paired Bluetooth endpoints, got {:?}",
            inventory.devices
        );
    }
}
