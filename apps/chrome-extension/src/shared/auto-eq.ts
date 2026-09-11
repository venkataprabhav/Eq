import { MUSIC_PROFILE, PRESETS, cloneProfile } from "./presets";
import type { AutoDecision, EqProfile, NormalizedTrack } from "./types";

export type AutoCategory =
  | "bass-boost"
  | "treble-boost"
  | "vocal"
  | "podcast"
  | "night"
  | "music";

export interface SpectrumBands {
  sub: number;
  bass: number;
  lowMid: number;
  mid: number;
  highMid: number;
  high: number;
  rms: number;
}

const CATEGORY_PRESETS: Record<AutoCategory, string> = {
  "bass-boost": "bass-boost",
  "treble-boost": "treble-boost",
  vocal: "vocal",
  podcast: "podcast",
  night: "night",
  music: "music",
};

const META_RULES: { category: AutoCategory; weight: number; words: string[] }[] = [
  {
    category: "podcast",
    weight: 4,
    words: [
      "podcast",
      "interview",
      "audiobook",
      "speech",
      "lecture",
      "ted talk",
      "full episode",
    ],
  },
  {
    category: "night",
    weight: 3,
    words: ["lofi", "lo-fi", "chillhop", "sleep", "rain sounds", "ambient"],
  },
  {
    category: "bass-boost",
    weight: 3,
    words: [
      "808",
      "phonk",
      "drill",
      "trap",
      "dubstep",
      "edm",
      "techno",
      "house",
      "drum and bass",
      "dnb",
      "bass boost",
    ],
  },
  {
    category: "vocal",
    weight: 2.5,
    words: ["acoustic", "unplugged", "session", "cover", "karaoke", "a cappella"],
  },
  {
    category: "vocal",
    weight: 1.5,
    words: ["lyrics", "official audio"],
  },
];

export function trackKey(track: NormalizedTrack | null): string {
  if (!track) return "";
  return [track.source, track.artist, track.title].join(" · ").toLowerCase();
}

function scoreMetadata(track: NormalizedTrack | null): Record<AutoCategory, number> {
  const scores = emptyScores();
  if (!track) return scores;
  const text = `${track.title} ${track.artist} ${track.album}`.toLowerCase();
  for (const rule of META_RULES) {
    if (rule.words.some((word) => text.includes(word))) {
      scores[rule.category] += rule.weight;
    }
  }
  return scores;
}

function scoreSpectrum(spectrum: SpectrumBands | null): Record<AutoCategory, number> {
  const scores = emptyScores();
  if (!spectrum || spectrum.rms < 10) return scores;

  const bass = spectrum.sub + spectrum.bass;
  const mid = spectrum.lowMid + spectrum.mid;
  const high = spectrum.highMid + spectrum.high;
  const bassRatio = bass / Math.max(mid + high, 1);
  const highRatio = high / Math.max(bass + mid, 1);
  const midRatio = mid / Math.max(bass + high, 1);
  const speech =
    spectrum.sub < 45 &&
    spectrum.mid > 55 &&
    spectrum.high < 70 &&
    bassRatio < 0.85;

  if (speech) scores.podcast += 3.5;
  if (bassRatio > 1.35) scores["bass-boost"] += 3;
  else if (bassRatio > 1.1) scores["bass-boost"] += 1.5;
  if (highRatio < 0.42 && spectrum.rms > 20) scores["treble-boost"] += 3;
  if (highRatio > 1.55 && bassRatio > 1.05) scores.night += 2.5;
  if (midRatio > 1.05 && bassRatio < 1.15) scores.vocal += 2.2;
  if (bassRatio >= 0.7 && bassRatio <= 1.25 && highRatio >= 0.5 && highRatio <= 1.3) {
    scores.music += 2.4;
  }
  return scores;
}

function emptyScores(): Record<AutoCategory, number> {
  return {
    "bass-boost": 0,
    "treble-boost": 0,
    vocal: 0,
    podcast: 0,
    night: 0,
    music: 0.4,
  };
}

function profileFor(category: AutoCategory): EqProfile {
  const id = CATEGORY_PRESETS[category];
  const found = PRESETS.find((preset) => preset.id === id);
  return cloneProfile(found ?? MUSIC_PROFILE);
}

const REASONS: Record<AutoCategory, string> = {
  "bass-boost": "Low end is dominant — applying a controlled bass lift.",
  "treble-boost": "The mix is dark — opening the top end.",
  vocal: "Vocals and mids sit forward — clearing bass and lifting presence.",
  podcast: "Speech-like content — cutting rumble and boosting clarity.",
  night: "Dense or late-night material — gentler highs and lower overall gain.",
  music: "Balanced mix — a mild music curve for typical headphones.",
};

export function decideAutoEq(
  track: NormalizedTrack | null,
  spectrum: SpectrumBands | null,
): AutoDecision {
  const scores = emptyScores();
  const meta = scoreMetadata(track);
  const audio = scoreSpectrum(spectrum);
  (Object.keys(scores) as AutoCategory[]).forEach((key) => {
    scores[key] = meta[key] * 1.35 + audio[key];
  });

  let category: AutoCategory = "music";
  let best = -1;
  for (const key of Object.keys(scores) as AutoCategory[]) {
    if (scores[key] > best) {
      best = scores[key];
      category = key;
    }
  }

  const profile = profileFor(category);
  return {
    category,
    presetId: profile.id,
    reason: REASONS[category],
    trackKey: trackKey(track),
  };
}

export function profileFromDecision(decision: AutoDecision): EqProfile {
  return profileFor(decision.category as AutoCategory);
}
