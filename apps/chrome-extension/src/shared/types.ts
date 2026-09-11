export type FilterType = "peaking" | "lowshelf" | "highshelf";

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

export type RuntimeMessage =
  | { type: "TRACK_UPDATED"; track: NormalizedTrack | null }
  | { type: "GET_TRACK" }
  | { type: "TRACK_RESPONSE"; track: NormalizedTrack | null }
  | { type: "AUDIO_STATUS"; status: AudioStatus }
  | { type: "APPLY_EQ" };

export const STORAGE_KEYS = {
  enabled: "enabled",
  auto: "auto",
  profile: "profile",
  track: "track",
  audioStatus: "audioStatus",
  autoDecision: "autoDecision",
} as const;
