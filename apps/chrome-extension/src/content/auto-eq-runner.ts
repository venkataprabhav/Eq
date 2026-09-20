import { trackKey, type SpectrumBands } from "../shared/auto-eq";
import { recommendFromRust } from "../shared/eq-api";
import { loadEqState, loadOutputHint, saveAutoApply, saveAutoDecision } from "../shared/storage";
import type { AutoDecision, EqProfile, EqState, NormalizedTrack } from "../shared/types";
import { applyEqToPage, sampleSpectrum } from "./audio-graph";

const tickMs = 200;
const persistMs = 280;
const emaAlpha = 0.42;
let ema: SpectrumBands | null = null;
let lastKey = "";
let lastApplied = "";
let inFlight = false;
let lastRecommendAt = 0;
let lastPersistAt = 0;
let session: Pick<EqState, "auto" | "epoch"> | null = null;

function mixSpectrum(prev: SpectrumBands, next: SpectrumBands, amount: number): SpectrumBands {
  const a = amount;
  const b = 1 - amount;
  return {
    sub: prev.sub * b + next.sub * a,
    bass: prev.bass * b + next.bass * a,
    lowMid: prev.lowMid * b + next.lowMid * a,
    mid: prev.mid * b + next.mid * a,
    highMid: prev.highMid * b + next.highMid * a,
    high: prev.high * b + next.high * a,
    rms: prev.rms * b + next.rms * a,
    crack: prev.crack * b + next.crack * a,
    hats: prev.hats * b + next.hats * a,
    air: prev.air * b + next.air * a,
  };
}

function resetSession(): void {
  ema = null;
  lastApplied = "";
  lastRecommendAt = 0;
  lastPersistAt = 0;
  inFlight = false;
}

export function noteAutoSession(auto: boolean, epoch: number): void {
  const restarted = auto && (session?.auto !== true || session.epoch !== epoch);
  session = { auto, epoch };
  if (!auto || restarted) resetSession();
}

async function readSession(): Promise<Pick<EqState, "auto" | "epoch">> {
  if (session) return session;
  const state = await loadEqState();
  session = { auto: state.auto, epoch: state.epoch };
  return session;
}

function applyNow(profile: EqProfile, epoch: number): void {
  applyEqToPage({
    enabled: true,
    auto: true,
    profile,
    epoch,
  });
}

async function persistAuto(
  track: NormalizedTrack | null,
  profile: EqProfile,
  reason: string,
  engine: string,
  tookMs: number,
): Promise<void> {
  const decision: AutoDecision = {
    category: "custom",
    presetId: "custom",
    reason: `${reason} (${engine}, ${tookMs}ms)`,
    trackKey: trackKey(track),
  };
  await saveAutoApply(
    {
      ...profile,
      id: "custom",
      name: "Custom Auto",
      bands: profile.bands.map((band) => ({ ...band })),
    },
    decision,
  );
}

async function requestRecommend(
  track: NormalizedTrack | null,
  spectrum: SpectrumBands | null,
  startedEpoch: number,
): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  const started = performance.now();
  try {
    const device = await loadOutputHint();
    const result = await recommendFromRust(track, spectrum, device);
    const current = await readSession();
    if (!current.auto || current.epoch !== startedEpoch) return;

    const profile = {
      ...result.profile,
      id: "custom",
      name: "Custom Auto",
      bands: result.profile.bands.map((band) => ({ ...band })),
    };
    const fingerprint = `${trackKey(track)}::${profile.preamp}::${profile.bands
      .map((band) => `${band.gain}:${band.q}`)
      .join(",")}`;
    if (fingerprint === lastApplied) return;

    lastApplied = fingerprint;
    applyNow(profile, startedEpoch);

    const tookMs = Math.max(result.latency_ms, Math.round(performance.now() - started));
    const now = Date.now();
    if (lastPersistAt === 0 || now - lastPersistAt >= persistMs) {
      lastPersistAt = now;
      await persistAuto(track, profile, result.reason, result.engine, tookMs);
    }
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

export async function runAutoEq(
  track: NormalizedTrack | null,
  options: { force?: boolean } = {},
): Promise<void> {
  const current = await readSession();
  if (!current.auto) {
    resetSession();
    return;
  }

  const key = trackKey(track);
  if (key !== lastKey) {
    lastKey = key;
    resetSession();
  }

  const snapshot = sampleSpectrum();
  if (snapshot && snapshot.rms >= 4) {
    ema = ema ? mixSpectrum(ema, snapshot, emaAlpha) : snapshot;
  } else if (!options.force && !ema) {
    return;
  }

  const now = Date.now();
  if (!options.force && lastRecommendAt !== 0 && now - lastRecommendAt < tickMs) return;
  if (!options.force && inFlight) return;

  lastRecommendAt = now;
  await requestRecommend(track, ema, current.epoch);
}
