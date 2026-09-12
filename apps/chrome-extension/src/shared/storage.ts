import { DEFAULT_PROFILE, cloneProfile } from "./presets";
import { extensionAlive, isContextInvalidated } from "./runtime";
import type { AudioStatus, AutoDecision, EqProfile, EqState, NormalizedTrack } from "./types";
import { STORAGE_KEYS } from "./types";

function isBand(value: unknown): value is EqProfile["bands"][number] {
  if (!value || typeof value !== "object") return false;
  const band = value as Record<string, unknown>;
  return (
    typeof band.id === "string" &&
    (band.type === "peaking" ||
      band.type === "lowshelf" ||
      band.type === "highshelf") &&
    typeof band.frequency === "number" &&
    typeof band.gain === "number" &&
    typeof band.q === "number"
  );
}

function isProfile(value: unknown): value is EqProfile {
  if (!value || typeof value !== "object") return false;
  const profile = value as Record<string, unknown>;
  return (
    typeof profile.id === "string" &&
    typeof profile.name === "string" &&
    typeof profile.preamp === "number" &&
    Array.isArray(profile.bands) &&
    profile.bands.every(isBand)
  );
}

export async function loadEqState(): Promise<EqState> {
  const fallback = {
    enabled: false,
    auto: false,
    profile: cloneProfile(DEFAULT_PROFILE),
    epoch: 0,
  };
  if (!extensionAlive()) return fallback;
  try {
    const stored = await chrome.storage.local.get([
      STORAGE_KEYS.enabled,
      STORAGE_KEYS.auto,
      STORAGE_KEYS.profile,
      STORAGE_KEYS.epoch,
    ]);
    const enabled =
      typeof stored[STORAGE_KEYS.enabled] === "boolean"
        ? stored[STORAGE_KEYS.enabled]
        : false;
    const auto =
      typeof stored[STORAGE_KEYS.auto] === "boolean"
        ? stored[STORAGE_KEYS.auto]
        : false;
    const profile = isProfile(stored[STORAGE_KEYS.profile])
      ? cloneProfile(stored[STORAGE_KEYS.profile])
      : cloneProfile(DEFAULT_PROFILE);
    const epoch =
      typeof stored[STORAGE_KEYS.epoch] === "number" ? stored[STORAGE_KEYS.epoch] : 0;
    return { enabled, auto, profile, epoch };
  } catch (error) {
    if (isContextInvalidated(error)) return fallback;
    throw error;
  }
}

export async function saveEqState(state: EqState): Promise<void> {
  if (!extensionAlive()) return;
  try {
    const current = await loadEqState();
    const epoch = Math.max(state.epoch, current.epoch);
    const stale = epoch > state.epoch;
    await chrome.storage.local.set({
      [STORAGE_KEYS.enabled]: stale ? current.enabled : state.enabled,
      [STORAGE_KEYS.auto]: stale ? current.auto : state.auto,
      [STORAGE_KEYS.profile]: stale ? current.profile : state.profile,
      [STORAGE_KEYS.epoch]: epoch,
    });
  } catch (error) {
    if (!isContextInvalidated(error)) throw error;
  }
}

/** Write Auto + epoch immediately so in-flight Rust applies cannot win. */
export async function writeSessionLock(auto: boolean, epoch: number): Promise<void> {
  if (!extensionAlive()) return;
  try {
    await chrome.storage.local.set({
      ...(auto ? { [STORAGE_KEYS.enabled]: true } : {}),
      [STORAGE_KEYS.auto]: auto,
      [STORAGE_KEYS.epoch]: epoch,
    });
  } catch (error) {
    if (!isContextInvalidated(error)) throw error;
  }
}

function isTrack(value: unknown): value is NormalizedTrack {
  if (!value || typeof value !== "object") return false;
  const track = value as Record<string, unknown>;
  return (
    typeof track.title === "string" &&
    typeof track.artist === "string" &&
    typeof track.source === "string" &&
    typeof track.url === "string"
  );
}

export async function saveTrack(track: NormalizedTrack | null): Promise<void> {
  if (!extensionAlive()) return;
  try {
    await chrome.storage.local.set({ [STORAGE_KEYS.track]: track });
  } catch (error) {
    if (!isContextInvalidated(error)) throw error;
  }
}

export async function saveAudioStatus(status: AudioStatus): Promise<void> {
  if (!extensionAlive()) return;
  try {
    await chrome.storage.local.set({ [STORAGE_KEYS.audioStatus]: status });
  } catch (error) {
    if (!isContextInvalidated(error)) throw error;
  }
}

export async function loadAudioStatus(): Promise<AudioStatus | null> {
  if (!extensionAlive()) return null;
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEYS.audioStatus);
    const value = stored[STORAGE_KEYS.audioStatus];
    if (!value || typeof value !== "object") return null;
    const status = value as AudioStatus;
    return typeof status.attached === "number" ? status : null;
  } catch (error) {
    if (isContextInvalidated(error)) return null;
    throw error;
  }
}

export async function saveAutoDecision(decision: AutoDecision | null): Promise<void> {
  if (!extensionAlive()) return;
  try {
    await chrome.storage.local.set({ [STORAGE_KEYS.autoDecision]: decision });
  } catch (error) {
    if (!isContextInvalidated(error)) throw error;
  }
}

export async function loadAutoDecision(): Promise<AutoDecision | null> {
  if (!extensionAlive()) return null;
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEYS.autoDecision);
    const value = stored[STORAGE_KEYS.autoDecision];
    if (!value || typeof value !== "object") return null;
    const decision = value as AutoDecision;
    return typeof decision.presetId === "string" ? decision : null;
  } catch (error) {
    if (isContextInvalidated(error)) return null;
    throw error;
  }
}

export async function loadTrack(): Promise<NormalizedTrack | null> {
  if (!extensionAlive()) return null;
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEYS.track);
    return isTrack(stored[STORAGE_KEYS.track]) ? stored[STORAGE_KEYS.track] : null;
  } catch (error) {
    if (isContextInvalidated(error)) return null;
    throw error;
  }
}
