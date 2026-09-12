export type FilterType = "peaking" | "lowshelf" | "highshelf";

export const EQ_BAND_COUNT = 15;
export const EQ_FREQUENCIES = [
  40, 63, 100, 160, 250, 400, 630, 1000, 1600, 2500, 4000, 6300, 10000, 12500, 16000,
] as const;

export type ThemeMode = "dark" | "light";

export interface EqBand {
  id: string;
  type: FilterType;
  frequency: number;
  gain: number;
  q: number;
}

export interface EqProfile {
  id: string;
  name: string;
  preamp: number;
  bands: EqBand[];
}

export interface NormalizedTrack {
  title: string;
  artist: string;
  album: string;
  source: string;
  url: string;
  artwork?: string;
}

export interface EqState {
  enabled: boolean;
  auto: boolean;
  profile: EqProfile;
  /** Bumps on every manual edit so in-flight Auto results cannot overwrite. */
  epoch: number;
}

export interface AutoDecision {
  category: string;
  presetId: string;
  reason: string;
  trackKey: string;
}

export interface AudioStatus {
  attached: number;
  mediaFound: number;
  sampleRate: number | null;
  error: string | null;
  tabId?: number;
  pageUrl?: string;
}

export interface SpectrumSnapshot {
  sub: number;
  bass: number;
  lowMid: number;
  mid: number;
  highMid: number;
  high: number;
  rms: number;
  crack: number;
  hats: number;
  air: number;
}

export type RuntimeMessage =
  | { type: "TRACK_UPDATED"; track: NormalizedTrack | null }
  | { type: "GET_TRACK" }
  | { type: "TRACK_RESPONSE"; track: NormalizedTrack | null }
  | { type: "AUDIO_STATUS"; status: AudioStatus }
  | { type: "APPLY_EQ" }
  | { type: "RECOMMEND_EQ"; track: NormalizedTrack | null; spectrum: SpectrumSnapshot | null };

export const STORAGE_KEYS = {
  enabled: "enabled",
  auto: "auto",
  profile: "profile",
  track: "track",
  audioStatus: "audioStatus",
  autoDecision: "autoDecision",
  epoch: "epoch",
  theme: "theme",
} as const;
