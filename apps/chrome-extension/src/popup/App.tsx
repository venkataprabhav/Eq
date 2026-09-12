import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { PRESETS, cloneProfile, isPresetId } from "../shared/presets";
import { scrapePageTrack, trackFromTab } from "../shared/scrape-page-track";
import {
  loadAudioStatus,
  loadAutoDecision,
  loadEqState,
  loadTheme,
  loadTrack,
  saveEqState,
  saveTheme,
  writeSessionLock,
} from "../shared/storage";
import type { AudioStatus, AutoDecision, EqBand, EqProfile, FilterType, NormalizedTrack, ThemeMode } from "../shared/types";
import { BrandMark } from "./BrandMark";
import { EqGraph } from "./EqGraph";

function formatHz(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)} kHz` : `${Math.round(value)} Hz`;
}

function formatHzShort(value: number): string {
  if (value >= 10000) return `${Math.round(value / 1000)}k`;
  if (value >= 1000) {
    const kilo = value / 1000;
    return Number.isInteger(kilo) ? `${kilo}k` : `${kilo.toFixed(1)}k`;
  }
  return `${Math.round(value)}`;
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

function ThemeToggle({
  theme,
  onToggle,
}: {
  theme: ThemeMode;
  onToggle: () => void;
}) {
  return (
    <button
      className="theme-toggle"
      type="button"
      onClick={onToggle}
      aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      title={theme === "dark" ? "Light mode" : "Dark mode"}
    >
      {theme === "dark" ? (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="8" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.5" />
          <path
            d="M8 1.6v1.3M8 13.1v1.3M1.6 8h1.3M13.1 8h1.3M3.2 3.2l.9.9M12 12l.9.9M3.2 12.8l.9-.9M12 4.1l.9-.9"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path
            d="M13.2 10.2A5.4 5.4 0 0 1 5.8 2.8 5.5 5.5 0 1 0 13.2 10.2Z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </button>
  );
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
  const [theme, setTheme] = useState<ThemeMode>("dark");

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
    void loadTheme().then((next) => {
      setTheme(next);
      document.documentElement.dataset.theme = next;
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
      if (changes.theme?.newValue === "light" || changes.theme?.newValue === "dark") {
        const next = changes.theme.newValue as ThemeMode;
        setTheme(next);
        document.documentElement.dataset.theme = next;
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

  function toggleTheme() {
    const next: ThemeMode = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    void saveTheme(next);
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

  if (!ready || !selected) {
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
          <div className="header-actions">
            <ThemeToggle theme={theme} onToggle={toggleTheme} />
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
        <div className="header-actions">
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
          <button
            className={enabled ? "toggle on" : "toggle"}
            onClick={() => setEnabled((value) => !value)}
            type="button"
            aria-pressed={enabled}
          >
            {enabled ? "On" : "Off"}
            <span className="switch" />
          </button>
        </div>
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
          theme={theme}
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

      <section className="bands">
        <div className="section-label">
          <span>Bands</span>
          <span>
            {formatHz(selected.frequency)} · {formatDb(selected.gain)}
          </span>
        </div>
        <div className="slider-row preamp">
          <span>Preamp</span>
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
        <div className="eq-faders">
          {profile.bands.map((band) => (
            <label
              key={band.id}
              className={band.id === selected.id ? "eq-fader active" : "eq-fader"}
            >
              <output>{band.gain === 0 ? "0" : formatDb(band.gain).replace(" dB", "")}</output>
              <input
                type="range"
                min={-12}
                max={12}
                step={0.1}
                value={band.gain}
                aria-label={formatHz(band.frequency)}
                onFocus={() => setSelectedId(band.id)}
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
              <button type="button" onClick={() => setSelectedId(band.id)}>
                {formatHzShort(band.frequency)}
              </button>
            </label>
          ))}
        </div>
        <div className="band-inspector">
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
