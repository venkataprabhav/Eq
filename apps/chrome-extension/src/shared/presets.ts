import type { EqBand, EqProfile } from "./types";

function band(
  id: string,
  type: EqBand["type"],
  frequency: number,
  gain: number,
  q: number,
): EqBand {
  return { id, type, frequency, gain, q };
}

export function defaultBands(): EqBand[] {
  return [
    band("b1", "lowshelf", 60, 0, 0.7),
    band("b2", "peaking", 125, 0, 0.8),
    band("b3", "peaking", 250, 0, 1),
    band("b4", "peaking", 500, 0, 1),
    band("b5", "peaking", 1000, 0, 1),
    band("b6", "peaking", 2000, 0, 1),
    band("b7", "peaking", 4000, 0, 1),
    band("b8", "highshelf", 8000, 0, 0.7),
  ];
}

export const DEFAULT_PROFILE: EqProfile = {
  id: "flat",
  name: "Flat",
  preamp: 0,
  bands: defaultBands(),
};

function withGains(
  id: string,
  name: string,
  preamp: number,
  gains: number[],
  extra?: Partial<Record<string, Partial<EqBand>>>,
): EqProfile {
  const bands = defaultBands().map((b, i) => ({
    ...b,
    gain: gains[i] ?? 0,
    ...extra?.[b.id],
  }));
  return { id, name, preamp, bands };
}

export const PRESETS: EqProfile[] = [
  DEFAULT_PROFILE,
  {
    id: "bass-boost",
    name: "Bass Boost",
    preamp: -2,
    bands: [
      band("b1", "lowshelf", 60, 4, 0.7),
      band("b2", "peaking", 125, 2, 0.8),
      band("b3", "peaking", 250, 0, 1),
      band("b4", "peaking", 500, 0, 1),
      band("b5", "peaking", 1000, 0, 1),
      band("b6", "peaking", 2000, 0, 1),
      band("b7", "peaking", 4000, 0, 1),
      band("b8", "highshelf", 8000, 0, 0.7),
    ],
  },
  withGains("treble-boost", "Treble Boost", -1.5, [0, 0, 0, 0, 0.5, 1.5, 3, 4]),
  withGains("vocal", "Vocal", -1, [-2, -1, 0, 1.5, 3, 2, 0.5, -1]),
  withGains("podcast", "Podcast", -1, [-3, -1, 1, 2.5, 3, 1.5, 0, -2]),
  withGains("night", "Night", -3, [2, 1, 0, -1, -1.5, -1, 0.5, 1]),
];

export function cloneProfile(profile: EqProfile): EqProfile {
  return {
    ...profile,
    bands: profile.bands.map((band) => ({ ...band })),
  };
}

export function isPresetId(id: string): boolean {
  return PRESETS.some((preset) => preset.id === id);
}
