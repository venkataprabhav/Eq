import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { PRESETS, cloneProfile, isPresetId } from "../shared/presets";
import { scrapePageTrack, trackFromTab } from "../shared/scrape-page-track";
import {
  loadAudioStatus,
  loadAutoDecision,
  loadEqState,
  loadTrack,
  saveEqState,
  writeSessionLock,
} from "../shared/storage";
import type { AudioStatus, AutoDecision, EqBand, EqProfile, FilterType, NormalizedTrack } from "../shared/types";
import { BrandMark } from "./BrandMark";
import { EqGraph } from "./EqGraph";

function formatHz(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)} kHz` : `${Math.round(value)} Hz`;
}

function formatDb(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(1)} dB`;
}

function filterLabel(type: FilterType): string {
  if (type === "lowshelf") return "Low shelf";
  if (type === "highshelf") return "High shelf";
  return "Peak";
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
  const [epoch, setEpoch] = useState(0);
  const [profile, setProfile] = useState<EqProfile>(cloneProfile(PRESETS[0]));
  const autoRef = useRef(false);
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
      autoRef.current = state.auto;
      setEpoch(state.epoch);
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
        autoRef.current = changes.auto.newValue;
        setAuto(changes.auto.newValue);
      }
      if (typeof changes.epoch?.newValue === "number") {
        setEpoch(changes.epoch.newValue);
      }
      if (changes.profile?.newValue) {
        const following =
          typeof changes.auto?.newValue === "boolean"
            ? changes.auto.newValue
            : autoRef.current;
        if (following) {
          setProfile(changes.profile.newValue as EqProfile);
        }
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
    void saveEqState({ enabled, auto, profile, epoch }).then(() => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tabId = tabs[0]?.id;
        if (!tabId) return;
        chrome.tabs.sendMessage(tabId, { type: "APPLY_EQ" }, () => {
          void chrome.runtime.lastError;
        });
      });
    });
  }, [auto, enabled, epoch, profile, ready]);

  function bumpEpoch(nextAuto: boolean): void {
    if (!nextAuto && !autoRef.current) {
      setAuto(false);
      return;
    }
    autoRef.current = nextAuto;
    setAuto(nextAuto);
    setEpoch((current) => {
      const next = current + 1;
      void writeSessionLock(nextAuto, next);
      return next;
    });
  }

  function updateProfile(next: EqProfile) {
    bumpEpoch(false);
    setProfile({
      ...next,
      id: isPresetId(next.id) ? next.id : "custom",
      name: isPresetId(next.id) ? next.name : "Custom",
    });
  }

  function applyPreset(next: EqProfile) {
    bumpEpoch(false);
    setProfile(cloneProfile(next));
    setSelectedId(next.bands[0].id);
  }

  function enableAuto() {
    bumpEpoch(true);
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

  const connectionClass = connected ? "good" : audioStatus?.error ? "danger" : "warn";
  const connectionLabel = connected ? "Live" : audioStatus?.error ? "Blocked" : "Waiting";
  const curveName = auto ? "Auto" : activePreset?.name ?? "Custom";

  if (!ready) {
    return (
      <div className="app is-loading">
        <header className="header">
          <div className="brand">
            <BrandMark />
            <div className="brand-copy">
              <strong>Universal EQ</strong>
              <span>Listening layer</span>
            </div>
          </div>
        </header>
        <div className="skeleton" aria-hidden="true">
          <div className="skel title" />
          <div className="skel" />
          <div className="skel graph" />
          <div className="skel" />
          <div className="skel" />
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <BrandMark />
          <div className="brand-copy">
            <strong>Universal EQ</strong>
            <span>Listening layer</span>
          </div>
        </div>
        <button
          className={enabled ? "toggle on" : "toggle"}
          onClick={() => setEnabled((value) => !value)}
          type="button"
          aria-pressed={enabled}
        >
          {enabled ? "On" : "Off"}
          <span className="switch" />
        </button>
      </header>

      <section className={track ? "now-playing" : "now-playing empty"}>
        <div className="now-playing-top">
          <span className="meta-source">{track?.source ?? "No tab metadata"}</span>
          <div className="status-row">
            <span className={`pill ${connectionClass}`}>{connectionLabel}</span>
            <span className={auto ? "pill good" : "pill"}>{auto ? "Auto" : "Manual"}</span>
          </div>
        </div>
        <h2>{track?.title ?? "Waiting for playback"}</h2>
        <p className="artist">
          {track
            ? [track.artist, track.album].filter(Boolean).join(" · ")
            : "Play audio in this tab to detect a track."}
        </p>
        {auto && decision ? (
          <p className="auto-reason">Auto follows the song — {decision.reason}</p>
        ) : null}
        <p
          className={
            connected ? "status-copy good" : audioStatus?.error ? "status-copy danger" : "status-copy"
          }
        >
          {connected
            ? `Connected to ${audioStatus?.attached} media element${audioStatus?.attached === 1 ? "" : "s"}.`
            : audioStatus?.error
              ? audioStatus.error
              : "EQ is not in the audio path yet. Play the video. If sliders stop working mid-song, click the video once."}
        </p>
      </section>

      <section className="curve">
        <div className="section-label">
          <span>Response</span>
          <span>{curveName}</span>
        </div>
        <EqGraph
          profile={profile}
          enabled={enabled}
          selectedId={selected.id}
          onSelect={setSelectedId}
        />
      </section>

      <section>
        <div className="section-label">
          <span>Curve</span>
        </div>
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
      </section>

      <section className="sliders">
        <div className="section-label">
          <span>Bands</span>
          <span>{formatHz(selected.frequency)}</span>
        </div>
        <div className="slider-row preamp">
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

      <section className="band-editor">
        <div className="band-head">
          <h3>{formatHz(selected.frequency)}</h3>
          <span className="band-meta">{filterLabel(selected.type)}</span>
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
        Auto retunes as the mix changes. A slider or preset locks a manual curve.
        Rust engine: <code>cargo run -p universal-eq-api</code> on 127.0.0.1:8787.
      </p>
    </div>
  );
}
