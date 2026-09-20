import type { BrowserSink, DeviceClass, DeviceInventory, OutputDevice, OutputDeviceHint } from "./types";

export const SYSTEM_OUTPUT_ID = "system";

export function deviceClassLabel(value: DeviceClass | undefined): string {
  switch (value) {
    case "bluetooth_headphones":
      return "Bluetooth headphones";
    case "bluetooth_speaker":
      return "Bluetooth speaker";
    case "bluetooth_headset":
      return "Bluetooth headset";
    case "headphones":
      return "Headphones";
    case "headset":
      return "Headset";
    case "hdmi":
      return "Display speakers";
    case "speakers":
      return "Speakers";
    default:
      return "Output";
  }
}

export function normalizeDeviceName(value: string): string {
  return value
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/\b(bluetooth|headphones?|headset|speakers?|audio|stereo)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function namesMatch(left: string, right: string): boolean {
  const a = normalizeDeviceName(left);
  const b = normalizeDeviceName(right);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

export function matchSink(device: OutputDevice, sinks: BrowserSink[]): BrowserSink | null {
  return (
    sinks.find((sink) => namesMatch(sink.label, device.name) || namesMatch(sink.label, device.id)) ??
    null
  );
}

export function resolveOutput(
  inventory: DeviceInventory | null,
  selectedId: string,
): OutputDevice | null {
  if (!inventory) return null;
  if (!selectedId || selectedId === SYSTEM_OUTPUT_ID) {
    return inventory.output ?? inventory.devices.find((device) => device.is_default) ?? null;
  }
  return inventory.devices.find((device) => device.id === selectedId) ?? inventory.output ?? null;
}

export function toDeviceHint(device: OutputDevice | null): OutputDeviceHint | null {
  if (!device) return null;
  return { id: device.id, name: device.name, class: device.class };
}
