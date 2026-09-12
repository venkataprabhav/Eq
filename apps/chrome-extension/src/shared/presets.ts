import type { EqBand, EqProfile } from "./types";
import { EQ_FREQUENCIES } from "./types";

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
  return EQ_FREQUENCIES.map((frequency, i) => {
    const id = `b${i + 1}`;
    if (i === 0) return band(id, "lowshelf", frequency, 0, 0.7);
    if (i === EQ_FREQUENCIES.length - 1) return band(id, "highshelf", frequency, 0, 0.7);
    return band(id, "peaking", frequency, 0, 1.2);
  });
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
  const bands = defaultBands().map((item, i) => ({
    ...item,
    gain: gains[i] ?? 0,
    ...extra?.[item.id],
  }));
  return { id, name, preamp, bands };
}

export const MUSIC_PROFILE: EqProfile = withGains(
  "music",
  "Music",
  -1.5,
  [1.6, 2.0, 1.1, 0.5, 0, -0.2, 0.3, 0.5, 0.8, 1.4, 1.0, 0.6, 0.3, 0, 0],
);

export const PRESETS: EqProfile[] = [
  DEFAULT_PROFILE,
  MUSIC_PROFILE,
  withGains("bass-boost", "Bass Boost", -2, [3.5, 4.0, 2.2, 1.0, 0, 0, 0, 0, 0.2, 0.4, 0, 0, 0, 0, 0]),
  withGains("treble-boost", "Treble Boost", -1.5, [0, 0, 0, 0, 0, 0, 0.3, 0.5, 1.0, 1.8, 2.6, 3.2, 3.6, 2.4, 1.2]),
  withGains("vocal", "Vocal", -1, [-1.6, -2.0, -1.0, -0.4, 0, -0.3, 1.4, 3.0, 2.6, 2.0, 0.6, 0.1, -0.6, -0.8, -1.0]),
  withGains("podcast", "Podcast", -1, [-2.8, -2.4, -1.4, -0.4, 0.4, 1.0, 2.2, 3.0, 2.4, 1.4, 0.2, -0.4, -1.4, -1.8, -2.0]),
  withGains("night", "Night", -3, [1.6, 2.0, 1.0, 0.3, 0, -0.6, -1.0, -1.4, -1.2, -0.8, 0, 0.4, 0.8, 0.6, 0.4]),
];

export function cloneProfile(profile: EqProfile): EqProfile {
  return {
    ...profile,
    bands: profile.bands.map((item) => ({ ...item })),
  };
}

export function isPresetId(id: string): boolean {
  return PRESETS.some((preset) => preset.id === id);
}

/** Map an older 8-band curve onto the current 15 ISO points. */
export function normalizeProfileBands(profile: EqProfile): EqProfile {
  if (profile.bands.length === EQ_FREQUENCIES.length) return profile;
  const known = PRESETS.find((preset) => preset.id === profile.id && preset.id !== "custom");
  if (known) return cloneProfile(known);
  const bands = defaultBands().map((band) => {
    let nearest = profile.bands[0];
    let best = Number.POSITIVE_INFINITY;
    for (const old of profile.bands) {
      const delta = Math.abs(Math.log2(old.frequency / band.frequency));
      if (delta < best) {
        best = delta;
        nearest = old;
      }
    }
    return { ...band, gain: nearest?.gain ?? 0 };
  });
  return { ...profile, bands };
}
