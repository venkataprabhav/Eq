import type { SpectrumBands } from "./auto-eq";
import { EQ_BAND_COUNT, type EqProfile, type NormalizedTrack, type RuntimeMessage } from "./types";

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

/** Content scripts go through the worker so YouTube → localhost is not the slow path. */
export async function recommendFromRust(
  track: NormalizedTrack | null,
  spectrum: SpectrumBands | null,
): Promise<RecommendApiResponse> {
  try {
    const reply = (await chrome.runtime.sendMessage({
      type: "RECOMMEND_EQ",
      track,
      spectrum,
    } satisfies RuntimeMessage)) as RecommendReply | undefined;
    if (reply?.ok && reply.result) return reply.result;
    if (reply && !reply.ok) {
      throw new Error(reply.error ?? "EQ API failed");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("EQ API")) throw error;
  }
  return fetchRecommend(track, spectrum);
}
