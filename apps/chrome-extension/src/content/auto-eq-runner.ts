import { trackKey, type SpectrumBands } from "../shared/auto-eq";
import { recommendFromRust } from "../shared/eq-api";
import { loadEqState, saveAutoDecision, saveEqState } from "../shared/storage";
import type { AutoDecision, EqProfile, NormalizedTrack } from "../shared/types";
import { sampleSpectrum } from "./audio-graph";

const tickMs = 1000;
let samples: SpectrumBands[] = [];
let lastKey = "";
let lastApplied = "";
let inFlight = false;
let didEarlyRecommend = false;
let lastRecommendAt = 0;

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
      crack: acc.crack + item.crack,
      hats: acc.hats + item.hats,
      air: acc.air + item.air,
    }),
    {
      sub: 0,
      bass: 0,
      lowMid: 0,
      mid: 0,
      highMid: 0,
      high: 0,
      rms: 0,
      crack: 0,
      hats: 0,
      air: 0,
    },
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
    crack: total.crack / n,
    hats: total.hats / n,
    air: total.air / n,
  };
}

function resetSession(): void {
  samples = [];
  lastApplied = "";
  didEarlyRecommend = false;
  lastRecommendAt = 0;
}

async function applyCustomProfile(
  track: NormalizedTrack | null,
  profile: EqProfile,
  reason: string,
  engine: string,
  latencyMs: number,
  startedEpoch: number,
): Promise<void> {
  const key = trackKey(track);
  const fingerprint = `${key}::${profile.preamp}::${profile.bands
    .map((b) => `${b.gain}:${b.q}`)
    .join(",")}`;
  if (fingerprint === lastApplied) return;

  const state = await loadEqState();
  if (!state.auto) return;
  if (state.epoch !== startedEpoch) return;

  lastApplied = fingerprint;
  await saveEqState({
    enabled: true,
    auto: state.auto,
    profile: {
      ...profile,
      id: "custom",
      name: "Custom Auto",
      bands: profile.bands.map((band) => ({ ...band })),
    },
    epoch: state.epoch,
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
  startedEpoch: number,
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
      startedEpoch,
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
    resetSession();
    return;
  }

  const key = trackKey(track);
  if (key !== lastKey) {
    lastKey = key;
    resetSession();
  }

  const snapshot = sampleSpectrum();
  if (snapshot && snapshot.rms >= 8) {
    samples.push(snapshot);
    if (samples.length > 4) samples.shift();
  }

  if (inFlight || samples.length < 2) return;

  const now = Date.now();
  if (didEarlyRecommend && now - lastRecommendAt < tickMs) return;

  didEarlyRecommend = true;
  lastRecommendAt = now;
  await requestRecommend(track, averageSpectrum(samples), state.epoch);
}
