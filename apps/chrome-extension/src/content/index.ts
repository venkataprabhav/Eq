import { extensionAlive } from "../shared/runtime";
import {
  loadBrowserSinks,
  loadDeviceInventory,
  loadEqState,
  loadOutputDeviceId,
  saveTrack,
} from "../shared/storage";
import { matchSink, resolveOutput, SYSTEM_OUTPUT_ID } from "../shared/output-device";
import type { EqState, RuntimeMessage } from "../shared/types";
import {
  applyEqToPage,
  listBrowserSinks,
  resumeGraphs,
  setOutputSink,
  watchMedia,
} from "./audio-graph";
import { noteAutoSession, runAutoEq } from "./auto-eq-runner";
import { readTrack, tracksEqual } from "./metadata";

let lastTrack: ReturnType<typeof readTrack> = null;
let pollId = 0;
let stopWatch = () => undefined;
let cachedState: EqState | null = null;
let lastStatusAt = 0;

function alive(): boolean {
  if (extensionAlive()) return true;
  window.clearInterval(pollId);
  stopWatch();
  return false;
}

async function ensureState(): Promise<EqState | null> {
  if (cachedState) return cachedState;
  cachedState = await loadEqState();
  noteAutoSession(cachedState.auto, cachedState.epoch);
  return cachedState;
}

function patchCachedState(changes: { [key: string]: chrome.storage.StorageChange }): void {
  if (!cachedState) return;
  if (typeof changes.enabled?.newValue === "boolean") {
    cachedState.enabled = changes.enabled.newValue;
  }
  if (typeof changes.auto?.newValue === "boolean") {
    cachedState.auto = changes.auto.newValue;
  }
  if (typeof changes.epoch?.newValue === "number") {
    cachedState.epoch = changes.epoch.newValue;
  }
  if (changes.profile?.newValue) {
    cachedState.profile = changes.profile.newValue as EqState["profile"];
  }
  noteAutoSession(cachedState.auto, cachedState.epoch);
}

async function syncEq(forceStatus = false): Promise<void> {
  if (!alive()) return;
  const state = await ensureState();
  if (!alive() || !state) return;
  const status = applyEqToPage(state);
  const now = Date.now();
  if (!forceStatus && now - lastStatusAt < 1200) return;
  lastStatusAt = now;
  try {
    await chrome.runtime.sendMessage({
      type: "AUDIO_STATUS",
      status: { ...status, pageUrl: location.href },
    } satisfies RuntimeMessage);
  } catch {
    alive();
  }
}

function publishTrack(): void {
  if (!alive()) return;
  const track = readTrack();
  if (tracksEqual(track, lastTrack)) return;
  lastTrack = track;
  void saveTrack(track);
  void runAutoEq(track);
  chrome.runtime
    .sendMessage({ type: "TRACK_UPDATED", track } satisfies RuntimeMessage)
    .catch(() => {
      alive();
    });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (!alive()) return;
  if (area !== "local") return;
  patchCachedState(changes);
  if (changes.enabled || changes.profile) {
    resumeGraphs();
    void syncEq();
  }
  if (changes.auto || changes.epoch) {
    resumeGraphs();
    void syncEq(true).then(() => runAutoEq(readTrack(), { force: true }));
  }
  if (changes.outputDeviceId || changes.deviceInventory || changes.browserSinks) {
    void routeOutput();
    void runAutoEq(readTrack(), { force: true });
  }
});

chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
  if (!alive()) return false;
  if (message.type === "GET_TRACK") {
    sendResponse({ type: "TRACK_RESPONSE", track: readTrack() } satisfies RuntimeMessage);
    return false;
  }
  if (message.type === "APPLY_EQ") {
    resumeGraphs();
    void syncEq(true).then(() => sendResponse({ ok: true }));
    return true;
  }
  return false;
});

void syncEq(true);
publishTrack();
void routeOutput();
void publishSinks();
stopWatch = watchMedia(() => {
  void syncEq();
  publishTrack();
});
pollId = window.setInterval(() => {
  resumeGraphs();
  void syncEq();
  publishTrack();
  void runAutoEq(readTrack());
}, 180);

async function publishSinks(): Promise<void> {
  if (!alive()) return;
  try {
    const sinks = await listBrowserSinks();
    await chrome.runtime.sendMessage({
      type: "BROWSER_SINKS",
      sinks,
    } satisfies RuntimeMessage);
  } catch {
    alive();
  }
}

async function routeOutput(): Promise<void> {
  if (!alive()) return;
  const [selectedId, inventory, sinks] = await Promise.all([
    loadOutputDeviceId(),
    loadDeviceInventory(),
    listBrowserSinks().catch(async () => loadBrowserSinks()),
  ]);
  if (selectedId === SYSTEM_OUTPUT_ID) {
    await setOutputSink("");
    return;
  }
  const device = resolveOutput(inventory, selectedId);
  const match = device ? matchSink(device, sinks) : null;
  await setOutputSink(match?.sinkId ?? "");
}

navigator.mediaDevices?.addEventListener("devicechange", () => {
  void publishSinks();
  void routeOutput();
  void runAutoEq(readTrack(), { force: true });
});

const mediaEvents = [
  "play",
  "playing",
  "seeked",
  "loadstart",
  "loadeddata",
  "emptied",
  "durationchange",
];
for (const eventName of mediaEvents) {
  document.addEventListener(
    eventName,
    () => {
      resumeGraphs();
      void syncEq();
      publishTrack();
      void runAutoEq(readTrack(), { force: true });
    },
    true,
  );
}

for (const eventName of ["yt-navigate-finish", "yt-page-data-updated"]) {
  document.addEventListener(eventName, () => {
    window.setTimeout(() => {
      void syncEq();
      publishTrack();
    }, 120);
  });
}

document.addEventListener("pointerdown", resumeGraphs, true);
document.addEventListener("keydown", resumeGraphs, true);
