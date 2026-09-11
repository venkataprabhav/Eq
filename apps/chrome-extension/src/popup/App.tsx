import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { PRESETS, cloneProfile, isPresetId } from "../shared/presets";
import { scrapePageTrack, trackFromTab } from "../shared/scrape-page-track";
import { loadAudioStatus, loadAutoDecision, loadEqState, loadTrack, saveEqState } from "../shared/storage";
import type { AudioStatus, AutoDecision, EqBand, EqProfile, FilterType, NormalizedTrack } from "../shared/types";
import { EqGraph } from "./EqGraph";

function formatHz(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)} kHz` : `${Math.round(value)} Hz`;
}

function formatDb(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(1)} dB`;
}

function richerTrack(
  current: NormalizedTrack | null,
  next: NormalizedTrack | null,
): NormalizedTrack | null {
  if (!next) return current;
  if (!current) return next;
  if (next.artist && !current.artist) return next;
  if (next.album && !current.album) return next;
  return next;
}

async function refreshNowPlaying(
  setTrack: Dispatch<SetStateAction<NormalizedTrack | null>>,
): Promise<void> {
  const stored = await loadTrack();
  if (stored) setTrack(stored);

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  const fromTitle = trackFromTab(tab.title, tab.url);
  if (fromTitle) setTrack((current) => richerTrack(current, fromTitle) ?? fromTitle);

  try {
    const [injected] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: scrapePageTrack,
    });
    if (injected?.result) setTrack(injected.result);
  } catch {
    // Restricted pages (chrome://) cannot be scraped.
  }

  chrome.tabs.sendMessage(tab.id, { type: "GET_TRACK" }, (response) => {
    if (chrome.runtime.lastError) return;
    if (response?.type === "TRACK_RESPONSE" && response.track) {
      setTrack(response.track);
    }
  });
}

export function App() {
  const [enabled, setEnabled] = useState(false);
  const [auto, setAuto] = useState(false);
  const [profile, setProfile] = useState<EqProfile>(cloneProfile(PRESETS[0]));
  const [selectedId, setSelectedId] = useState(PRESETS[0].bands[0].id);
  const [track, setTrack] = useState<NormalizedTrack | null>(null);
  const [decision, setDecision] = useState<AutoDecision | null>(null);
  const [ready, setReady] = useState(false);
  const [audioStatus, setAudioStatus] = useState<AudioStatus | null>(null);
  const [activeTabId, setActiveTabId] = useState<number | null>(null);

  const selected = useMemo(
    () => profile.bands.find((band) => band.id === selectedId) ?? profile.bands[0],
    [profile, selectedId],
  );

  useEffect(() => {
    void loadEqState().then((state) => {
      setEnabled(state.enabled);
      setAuto(state.auto);
      setProfile(state.profile);
      setSelectedId(state.profile.bands[0]?.id ?? "b1");
      setReady(true);
    });
    void loadAutoDecision().then((next) => {
      if (next) setDecision(next);
    });

    void refreshNowPlaying(setTrack);
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      setActiveTabId(tabs[0]?.id ?? null);
    });
    void loadAudioStatus().then((status) => {
      if (status) setAudioStatus(status);
    });

    const onStorage = (
      changes: { [key: string]: chrome.storage.StorageChange },
      area: string,
    ) => {
      if (area !== "local") return;
      if (changes.track) {
        const next = changes.track.newValue as NormalizedTrack | null;
        if (next?.title) setTrack(next);
      }
      if (changes.auto && typeof changes.auto.newValue === "boolean") {
        setAuto(changes.auto.newValue);
      }
      if (changes.profile?.newValue) {
        setProfile(changes.profile.newValue as EqProfile);
      }
      if (changes.autoDecision?.newValue) {
        setDecision(changes.autoDecision.newValue as AutoDecision);
      }
      if (changes.audioStatus?.newValue) {
        const next = changes.audioStatus.newValue as AudioStatus;
        setAudioStatus((current) => {
          if ((next.attached ?? 0) > 0) return next;
          if ((current?.attached ?? 0) > 0 && current?.pageUrl === next.pageUrl) {
            return current;
          }
          return next;
        });
      }
    };
    chrome.storage.onChanged.addListener(onStorage);
    return () => chrome.storage.onChanged.removeListener(onStorage);
  }, []);

  useEffect(() => {
    if (!ready) return;
    void saveEqState({ enabled, auto, profile }).then(() => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tabId = tabs[0]?.id;
        if (!tabId) return;
        chrome.tabs.sendMessage(tabId, { type: "APPLY_EQ" }, () => {
          void chrome.runtime.lastError;
        });
      });
    });
  }, [auto, enabled, profile, ready]);

  function updateProfile(next: EqProfile) {
    setAuto(false);
    setProfile({
      ...next,
      id: isPresetId(next.id) ? next.id : "custom",
      name: isPresetId(next.id) ? next.name : "Custom",
    });
  }

  function applyPreset(next: EqProfile) {
    setAuto(false);
    setProfile(cloneProfile(next));
    setSelectedId(next.bands[0].id);
  }

  function enableAuto() {
    setAuto(true);
    setEnabled(true);
  }

  function updateBand(patch: Partial<EqBand>) {
    updateProfile({
      ...profile,
      id: "custom",
      name: "Custom",
      bands: profile.bands.map((band) =>
        band.id === selected.id ? { ...band, ...patch } : band,
      ),
    });
  }

  const connected =
    (audioStatus?.attached ?? 0) > 0 &&
    (audioStatus?.tabId == null ||
      activeTabId == null ||
      audioStatus.tabId === activeTabId);

  const activePreset = PRESETS.find(
    (preset) =>
      preset.id === profile.id &&
      preset.preamp === profile.preamp &&
      preset.bands.every(
        (band, i) =>
          band.gain === profile.bands[i]?.gain &&
          band.frequency === profile.bands[i]?.frequency &&
          band.q === profile.bands[i]?.q &&
          band.type === profile.bands[i]?.type,
      ),
  );

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <strong>Universal EQ</strong>
          <span>Browser output layer</span>
        </div>
        <button
          className={enabled ? "toggle on" : "toggle"}
          onClick={() => setEnabled((value) => !value)}
          type="button"
        >
          {enabled ? "Enabled" : "Bypassed"}
          <span className="switch" />
        </button>
      </header>

      <section className="now-playing">
        <span className="meta-source">{track?.source ?? "No tab metadata"}</span>
        <h2>{track?.title ?? "Waiting for playback"}</h2>
        <p>{track ? [track.artist, track.album].filter(Boolean).join(" · ") : "Play audio in this tab to detect a track."}</p>
        {auto && decision ? (
          <p className="hint good">
            Auto · custom — {decision.reason}
          </p>
        ) : null}
        <p className={connected ? "hint good" : "hint"}>
          {connected
            ? `EQ connected to ${audioStatus?.attached} media element${audioStatus?.attached === 1 ? "" : "s"}.`
            : audioStatus?.error
              ? audioStatus.error
              : "EQ is not in the audio path yet. Play the video. If sliders stop working mid-song, click the video once."}
        </p>
      </section>

      <EqGraph
        profile={profile}
        enabled={enabled}
        selectedId={selected.id}
        onSelect={setSelectedId}
      />

      <div className="presets">
        <button
          className={auto ? "chip auto active" : "chip auto"}
          onClick={enableAuto}
          type="button"
        >
          Auto
        </button>
        {PRESETS.map((preset) => (
          <button
            key={preset.id}
            className={
              !auto && activePreset?.id === preset.id
                ? "chip active"
                : auto && profile.id === preset.id
                  ? "chip suggested"
                  : "chip"
            }
            onClick={() => applyPreset(preset)}
            type="button"
          >
            {preset.name}
          </button>
        ))}
      </div>

      <section className="preamp">
        <div className="slider-row">
          <button type="button">Preamp</button>
          <input
            type="range"
            min={-12}
            max={12}
            step={0.1}
            value={profile.preamp}
            onChange={(event) =>
              updateProfile({
                ...profile,
                id: "custom",
                name: "Custom",
                preamp: Number(event.target.value),
              })
            }
          />
          <output>{formatDb(profile.preamp)}</output>
        </div>
      </section>

      <section className="bands">
        {profile.bands.map((band) => (
          <div
            key={band.id}
            className={band.id === selected.id ? "slider-row active" : "slider-row"}
          >
            <button type="button" onClick={() => setSelectedId(band.id)}>
              {formatHz(band.frequency)}
            </button>
            <input
              type="range"
              min={-12}
              max={12}
              step={0.1}
              value={band.gain}
              onChange={(event) => {
                setSelectedId(band.id);
                updateProfile({
                  ...profile,
                  id: "custom",
                  name: "Custom",
                  bands: profile.bands.map((item) =>
                    item.id === band.id
                      ? { ...item, gain: Number(event.target.value) }
                      : item,
                  ),
                });
              }}
            />
            <output>{formatDb(band.gain)}</output>
          </div>
        ))}
      </section>

      <section className="panel band-editor">
        <div className="band-head">
          <h3>{formatHz(selected.frequency)}</h3>
          <span className="band-meta">{selected.type}</span>
        </div>
        <div className="fields">
          <label className="field">
            <span>Freq</span>
            <input
              type="number"
              min={20}
              max={20000}
              value={Math.round(selected.frequency)}
              onChange={(event) =>
                updateBand({ frequency: Number(event.target.value) })
              }
            />
          </label>
          <label className="field">
            <span>Q</span>
            <input
              type="number"
              min={0.1}
              max={8}
              step={0.1}
              value={selected.q}
              onChange={(event) => updateBand({ q: Number(event.target.value) })}
            />
          </label>
          <label className="field">
            <span>Type</span>
            <select
              value={selected.type}
              onChange={(event) =>
                updateBand({ type: event.target.value as FilterType })
              }
            >
              <option value="peaking">Peak</option>
              <option value="lowshelf">Low shelf</option>
              <option value="highshelf">High shelf</option>
            </select>
          </label>
        </div>
      </section>

      <p className="hint">
        Auto asks the local Rust engine at 127.0.0.1:8787 for a custom curve
        (not a preset). Run <code>cargo run -p universal-eq-api</code> first.
        Tab audio still uses Web Audio; system-wide EQ stays in the desktop
        engine later.
      </p>
    </div>
  );
}
