import type { EqBand, EqProfile } from "./types";

function dbToLin(db: number): number {
  return 10 ** (db / 20);
}

/**
 * Audio EQ Cookbook magnitude for one biquad, matching Web Audio BiquadFilterNode.
 */
function bandMagnitudeDb(band: EqBand, freq: number): number {
  const w0 = (2 * Math.PI * band.frequency) / 44100;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  const A = dbToLin(band.gain);
  const alpha = sin / (2 * Math.max(band.q, 0.01));

  let b0 = 1;
  let b1 = 0;
  let b2 = 0;
  let a0 = 1;
  let a1 = 0;
  let a2 = 0;

  if (band.type === "peaking") {
    b0 = 1 + alpha * A;
    b1 = -2 * cos;
    b2 = 1 - alpha * A;
    a0 = 1 + alpha / A;
    a1 = -2 * cos;
    a2 = 1 - alpha / A;
  } else if (band.type === "lowshelf") {
    const twoSqrtAAlpha = 2 * Math.sqrt(A) * alpha;
    b0 = A * (A + 1 - (A - 1) * cos + twoSqrtAAlpha);
    b1 = 2 * A * (A - 1 - (A + 1) * cos);
    b2 = A * (A + 1 - (A - 1) * cos - twoSqrtAAlpha);
    a0 = A + 1 + (A - 1) * cos + twoSqrtAAlpha;
    a1 = -2 * (A - 1 + (A + 1) * cos);
    a2 = A + 1 + (A - 1) * cos - twoSqrtAAlpha;
  } else {
    const twoSqrtAAlpha = 2 * Math.sqrt(A) * alpha;
    b0 = A * (A + 1 + (A - 1) * cos + twoSqrtAAlpha);
    b1 = -2 * A * (A - 1 + (A + 1) * cos);
    b2 = A * (A + 1 + (A - 1) * cos - twoSqrtAAlpha);
    a0 = A + 1 - (A - 1) * cos + twoSqrtAAlpha;
    a1 = 2 * (A - 1 - (A + 1) * cos);
    a2 = A + 1 - (A - 1) * cos - twoSqrtAAlpha;
  }

  const w = (2 * Math.PI * freq) / 44100;
  const cw = Math.cos(w);
  const sw = Math.sin(w);
  const numReal = b0 / a0 + (b1 / a0) * cw + (b2 / a0) * Math.cos(2 * w);
  const numImag = (b1 / a0) * sw + (b2 / a0) * Math.sin(2 * w);
  const denReal = 1 + (a1 / a0) * cw + (a2 / a0) * Math.cos(2 * w);
  const denImag = (a1 / a0) * sw + (a2 / a0) * Math.sin(2 * w);
  const mag =
    Math.hypot(numReal, numImag) / Math.max(Math.hypot(denReal, denImag), 1e-12);
  return 20 * Math.log10(Math.max(mag, 1e-12));
}

export function logFrequencies(count = 160, min = 20, max = 20000): number[] {
  const freqs: number[] = [];
  const logMin = Math.log10(min);
  const logMax = Math.log10(max);
  for (let i = 0; i < count; i += 1) {
    const t = i / (count - 1);
    freqs.push(10 ** (logMin + t * (logMax - logMin)));
  }
  return freqs;
}

export function profileMagnitudeDb(profile: EqProfile, freqs: number[]): number[] {
  return freqs.map((freq) => {
    let db = profile.preamp;
    for (const band of profile.bands) {
      db += bandMagnitudeDb(band, freq);
    }
    return db;
  });
}
