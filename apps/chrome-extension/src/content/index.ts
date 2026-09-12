import { extensionAlive } from "../shared/runtime";
import { loadEqState, saveTrack } from "../shared/storage";
import type { RuntimeMessage } from "../shared/types";
import { applyEqToPage, resumeGraphs, watchMedia } from "./audio-graph";
import { runAutoEq } from "./auto-eq-runner";
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
  if (changes.enabled || changes.profile) {
    resumeGraphs();
    void syncEq();
  }
  if (changes.auto) {
    void runAutoEq(readTrack());
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
pollId = window.setInterval(() => {
  resumeGraphs();
  void syncEq();
  publishTrack();
  void runAutoEq(readTrack());
}, 400);

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
    },
    true,
  );
}

for (const eventName of ["yt-navigate-finish", "yt-page-data-updated"]) {
  document.addEventListener(eventName, () => {
    window.setTimeout(() => {
      void syncEq();
      publishTrack();
    }, 250);
  });
}

document.addEventListener("pointerdown", resumeGraphs, true);
document.addEventListener("keydown", resumeGraphs, true);
