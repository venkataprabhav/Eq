import { extensionAlive } from "../shared/runtime";
import { loadEqState, saveTrack } from "../shared/storage";
import type { RuntimeMessage } from "../shared/types";
import { applyEqToPage, watchMedia } from "./audio-graph";
import { readTrack, tracksEqual } from "./metadata";

let lastTrack: ReturnType<typeof readTrack> = null;
let pollId = 0;
let stopWatch = () => undefined;

function alive(): boolean {
  if (extensionAlive()) return true;
  window.clearInterval(pollId);
  stopWatch();
  return false;
}

async function syncEq(): Promise<void> {
  if (!alive()) return;
  const state = await loadEqState();
  if (!alive()) return;
  const status = applyEqToPage(state);
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
  chrome.runtime
    .sendMessage({ type: "TRACK_UPDATED", track } satisfies RuntimeMessage)
    .catch(() => {
      alive();
    });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (!alive()) return;
  if (area !== "local") return;
  if (changes.enabled || changes.profile) {
    void syncEq();
  }
});

chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
  if (!alive()) return false;
  if (message.type === "GET_TRACK") {
    sendResponse({ type: "TRACK_RESPONSE", track: readTrack() } satisfies RuntimeMessage);
    return false;
  }
  if (message.type === "APPLY_EQ") {
    void syncEq().then(() => sendResponse({ ok: true }));
    return true;
  }
  return false;
});

void syncEq();
publishTrack();
stopWatch = watchMedia(() => {
  void syncEq();
  publishTrack();
});
pollId = window.setInterval(publishTrack, 2000);

for (const eventName of ["play", "playing", "seeked"]) {
  document.addEventListener(
    eventName,
    () => {
      void syncEq();
      publishTrack();
    },
    true,
  );
}
