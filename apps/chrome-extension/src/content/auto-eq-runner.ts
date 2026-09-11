import { trackKey, type SpectrumBands } from "../shared/auto-eq";
import { recommendFromRust } from "../shared/eq-api";
import { loadEqState, saveAutoDecision, saveEqState } from "../shared/storage";
import type { AutoDecision, EqProfile, NormalizedTrack } from "../shared/types";
import { sampleSpectrum } from "./audio-graph";

const neededSamples = 6;
let samples: SpectrumBands[] = [];
let lastKey = "";
let lastApplied = "";
let pendingFrames = 0;
let inFlight = false;
let didEarlyRecommend = false;
let didSpectrumRecommend = false;

function averageSpectrum(list: SpectrumBands[]): SpectrumBands {
  const total = list.reduce(
    (acc, item) => ({
      sub: acc.sub + item.sub,
      bass: acc.bass + item.bass,
      lowMid: acc.lowMid + item.lowMid,
      mid: acc.mid + item.mid,
      highMid: acc.highMid + item.highMid,
      high: acc.high + item.high,
      rms: acc.rms + item.rms,
    }),
    { sub: 0, bass: 0, lowMid: 0, mid: 0, highMid: 0, high: 0, rms: 0 },
  );
  const n = list.length || 1;
  return {
    sub: total.sub / n,
    bass: total.bass / n,
    lowMid: total.lowMid / n,
    mid: total.mid / n,
    highMid: total.highMid / n,
    high: total.high / n,
    rms: total.rms / n,
  };
}

async function applyCustomProfile(
  track: NormalizedTrack | null,
  profile: EqProfile,
  reason: string,
  engine: string,
  latencyMs: number,
): Promise<void> {
  const key = trackKey(track);
  const fingerprint = `${key}::${profile.preamp}::${profile.bands
    .map((b) => `${b.gain}:${b.q}`)
    .join(",")}`;
  if (fingerprint === lastApplied) return;

  const state = await loadEqState();
  if (!state.auto) return;

  lastApplied = fingerprint;
  await saveEqState({
    enabled: true,
    auto: true,
    profile: {
      ...profile,
      id: "custom",
      name: "Custom Auto",
      bands: profile.bands.map((band) => ({ ...band })),
    },
  });

  const decision: AutoDecision = {
    category: "custom",
    presetId: "custom",
    reason: `${reason} (${engine}, ${latencyMs}ms)`,
    trackKey: key,
  };
  await saveAutoDecision(decision);
}

async function requestRecommend(
  track: NormalizedTrack | null,
  spectrum: SpectrumBands | null,
): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  try {
    const result = await recommendFromRust(track, spectrum);
    await applyCustomProfile(
      track,
      result.profile,
      result.reason,
      result.engine,
      result.latency_ms,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await saveAutoDecision({
      category: "error",
      presetId: "custom",
      reason: `Rust EQ API unavailable (${message}). Run: cargo run -p universal-eq-api`,
      trackKey: trackKey(track),
    });
  } finally {
    inFlight = false;
  }
}

export async function runAutoEq(track: NormalizedTrack | null): Promise<void> {
  const state = await loadEqState();
  if (!state.auto) {
    samples = [];
    return;
  }

  const key = trackKey(track);
  if (key !== lastKey) {
    lastKey = key;
    samples = [];
    pendingFrames = 0;
    lastApplied = "";
    didEarlyRecommend = false;
    didSpectrumRecommend = false;
  }

  const snapshot = sampleSpectrum();
  if (snapshot && snapshot.rms >= 10) {
    samples.push(snapshot);
    if (samples.length > 16) samples.shift();
    pendingFrames += 1;
  }

  if (!didEarlyRecommend && key) {
    didEarlyRecommend = true;
    await requestRecommend(track, null);
    return;
  }

  if (
    !didSpectrumRecommend &&
    pendingFrames >= neededSamples &&
    samples.length >= 4
  ) {
    didSpectrumRecommend = true;
    await requestRecommend(track, averageSpectrum(samples));
  }
}
