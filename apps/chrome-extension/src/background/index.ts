import { loadEqState, saveTrack } from "../shared/storage";
import type { NormalizedTrack, RuntimeMessage } from "../shared/types";

let lastTrack: NormalizedTrack | null = null;

async function refreshBadge(): Promise<void> {
  const { enabled } = await loadEqState();
  await chrome.action.setBadgeBackgroundColor({ color: enabled ? "#E8A54B" : "#3A3A3A" });
  await chrome.action.setBadgeText({ text: enabled ? "ON" : "" });
}

chrome.runtime.onInstalled.addListener(() => {
  void refreshBadge();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.enabled || changes.profile)) {
    void refreshBadge();
  }
});

chrome.runtime.onMessage.addListener(
  (message: RuntimeMessage, _sender, sendResponse) => {
    if (message.type === "TRACK_UPDATED") {
      lastTrack = message.track;
      void saveTrack(message.track);
      return false;
    }
    if (message.type === "GET_TRACK") {
      sendResponse({ type: "TRACK_RESPONSE", track: lastTrack } satisfies RuntimeMessage);
      return false;
    }
    return false;
  },
);

void refreshBadge();
