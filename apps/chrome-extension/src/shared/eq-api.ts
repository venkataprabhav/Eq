import type { SpectrumBands } from "./auto-eq";
import {
  EQ_BAND_COUNT,
  type DeviceInventory,
  type EqProfile,
  type NormalizedTrack,
  type OutputDeviceHint,
  type RuntimeMessage,
} from "./types";

export const EQ_API_BASE = "http://127.0.0.1:8787";
export const EQ_API_TIMEOUT_MS = 350;

export interface RecommendApiResponse {
  profile: EqProfile;
  reason: string;
  track_key: string;
  latency_ms: number;
  engine: string;
}

export interface RecommendReply {
  ok: boolean;
  result?: RecommendApiResponse;
  error?: string;
}

/** Direct HTTP call. Use from the service worker, not the YouTube page. */
export async function fetchRecommend(
  track: NormalizedTrack | null,
  spectrum: SpectrumBands | null,
  device?: OutputDeviceHint | null,
): Promise<RecommendApiResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EQ_API_TIMEOUT_MS);

  try {
    const response = await fetch(`${EQ_API_BASE}/v1/eq/recommend`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        track: track
          ? {
              title: track.title,
              artist: track.artist,
              album: track.album,
              source: track.source,
              url: track.url,
            }
          : null,
        spectrum: spectrum
          ? {
              sub: spectrum.sub,
              bass: spectrum.bass,
              low_mid: spectrum.lowMid,
              mid: spectrum.mid,
              high_mid: spectrum.highMid,
              high: spectrum.high,
              rms: spectrum.rms,
              crack: spectrum.crack,
              hats: spectrum.hats,
              air: spectrum.air,
            }
          : null,
        device: device
          ? {
              id: device.id,
              name: device.name,
              class: device.class,
            }
          : null,
      }),
    });

    if (!response.ok) {
      throw new Error(`EQ API HTTP ${response.status}`);
    }

    const data = (await response.json()) as RecommendApiResponse;
    if (!data.profile?.bands || data.profile.bands.length !== EQ_BAND_COUNT) {
      throw new Error("EQ API returned invalid profile");
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchDevices(): Promise<DeviceInventory> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 900);
  try {
    const response = await fetch(`${EQ_API_BASE}/v1/devices`, {
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`EQ API HTTP ${response.status}`);
    }
    const data = (await response.json()) as DeviceInventory;
    return {
      devices: Array.isArray(data.devices) ? data.devices : [],
      default_id: data.default_id ?? null,
      output: data.output ?? null,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Content scripts go through the worker so YouTube → localhost is not the slow path. */
export async function recommendFromRust(
  track: NormalizedTrack | null,
  spectrum: SpectrumBands | null,
  device?: OutputDeviceHint | null,
): Promise<RecommendApiResponse> {
  try {
    const reply = (await Promise.race([
      chrome.runtime.sendMessage({
        type: "RECOMMEND_EQ",
        track,
        spectrum,
        device: device ?? null,
      } satisfies RuntimeMessage) as Promise<RecommendReply | undefined>,
      new Promise<never>((_, reject) => {
        window.setTimeout(() => reject(new Error("EQ API timeout")), EQ_API_TIMEOUT_MS + 80);
      }),
    ])) as RecommendReply | undefined;
    if (reply?.ok && reply.result) return reply.result;
    if (reply && !reply.ok) {
      throw new Error(reply.error ?? "EQ API failed");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("EQ API")) throw error;
  }
  return fetchRecommend(track, spectrum, device);
}
