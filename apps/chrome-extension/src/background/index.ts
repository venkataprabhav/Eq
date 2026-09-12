import { fetchRecommend } from "../shared/eq-api";
import { loadAudioStatus, loadEqState, saveAudioStatus, saveTrack } from "../shared/storage";
import type { AudioStatus, NormalizedTrack, RuntimeMessage } from "../shared/types";

let lastTrack: NormalizedTrack | null = null;

async function refreshBadge(): Promise<void> {
  const { enabled, auto } = await loadEqState();
  await chrome.action.setBadgeBackgroundColor({ color: enabled ? "#E8A54B" : "#3A3A3A" });
  await chrome.action.setBadgeText({ text: enabled ? (auto ? "AUTO" : "ON") : "" });
}

chrome.runtime.onInstalled.addListener(() => {
  void refreshBadge();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.enabled || changes.profile || changes.auto)) {
    void refreshBadge();
  }
});

chrome.runtime.onMessage.addListener(
  (message: RuntimeMessage, sender, sendResponse) => {
    if (message.type === "TRACK_UPDATED") {
      lastTrack = message.track;
      void saveTrack(message.track);
      return false;
    }
    if (message.type === "GET_TRACK") {
      sendResponse({ type: "TRACK_RESPONSE", track: lastTrack } satisfies RuntimeMessage);
      return false;
    }
    if (message.type === "AUDIO_STATUS") {
      void persistAudioStatus(message.status, sender);
      return false;
    }
    if (message.type === "RECOMMEND_EQ") {
      fetchRecommend(message.track, message.spectrum)
        .then((result) => sendResponse({ ok: true, result }))
        .catch((error: unknown) => {
          const text = error instanceof Error ? error.message : String(error);
          sendResponse({ ok: false, error: text });
        });
      return true;
    }
    return false;
  },
);

function isTopFrame(sender: chrome.runtime.MessageSender): boolean {
  return sender.frameId === 0 || sender.frameId === undefined;
}

async function persistAudioStatus(
  status: AudioStatus,
  sender: chrome.runtime.MessageSender,
): Promise<void> {
  const next: AudioStatus = {
    ...status,
    tabId: sender.tab?.id,
    pageUrl: status.pageUrl ?? sender.tab?.url,
  };
  const current = await loadAudioStatus();
  const sameTab = current?.tabId == null || current.tabId === next.tabId;
  const samePage = current?.pageUrl === next.pageUrl;
  const improved = next.attached > (current?.attached ?? 0);

  if (improved || !current) {
    await saveAudioStatus(next);
    return;
  }
  if (!sameTab || !samePage) {
    await saveAudioStatus(next);
    return;
  }
  if (next.attached === 0 && !isTopFrame(sender)) return;
  if (next.attached === 0 && (current.attached ?? 0) > 0) return;
}

void refreshBadge();
