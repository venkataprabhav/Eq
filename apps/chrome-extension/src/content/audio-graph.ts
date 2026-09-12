import type { SpectrumBands } from "../shared/auto-eq";
import type { AudioStatus, EqState } from "../shared/types";
import { EQ_BAND_COUNT } from "../shared/types";

interface AttachedGraph {
  element: HTMLMediaElement;
  context: AudioContext;
  source: MediaElementAudioSourceNode;
  preamp: GainNode;
  filters: BiquadFilterNode[];
  limiter: DynamicsCompressorNode;
  analyser: AnalyserNode;
}

const attached = new WeakMap<HTMLMediaElement, AttachedGraph>();
const liveGraphs = new Set<AttachedGraph>();

function keepContextAlive(context: AudioContext): void {
  const osc = context.createOscillator();
  const silent = context.createGain();
  silent.gain.value = 0;
  osc.frequency.value = 40;
  osc.connect(silent);
  silent.connect(context.destination);
  osc.start();
  context.addEventListener("statechange", () => {
    if (context.state === "suspended") {
      void context.resume();
    }
  });
}

function createGraph(element: HTMLMediaElement): AttachedGraph | null {
  const existing = attached.get(element);
  if (existing && existing.context.state !== "closed") return existing;
  if (existing && existing.context.state === "closed") {
    liveGraphs.delete(existing);
    attached.delete(element);
  }
  if ((element as HTMLMediaElement & { __ueqAttached?: boolean }).__ueqAttached) {
    return null;
  }

  try {
    const context = new AudioContext({ latencyHint: "interactive" });
    const source = context.createMediaElementSource(element);
    const preamp = context.createGain();
    const filters = Array.from({ length: EQ_BAND_COUNT }, () => context.createBiquadFilter());
    const limiter = context.createDynamicsCompressor();
    const analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.45;

    limiter.threshold.value = -1;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.12;

    source.connect(analyser);
    let node: AudioNode = source;
    node.connect(preamp);
    node = preamp;
    for (const filter of filters) {
      node.connect(filter);
      node = filter;
    }
    node.connect(limiter);
    limiter.connect(context.destination);
    keepContextAlive(context);

    (element as HTMLMediaElement & { __ueqAttached?: boolean }).__ueqAttached =
      true;
    const graph = { element, context, source, preamp, filters, limiter, analyser };
    attached.set(element, graph);
    liveGraphs.add(graph);
    void context.resume();
    return graph;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(message);
  }
}

function applyProfileToGraph(graph: AttachedGraph, state: EqState): void {
  const { enabled, profile, auto } = state;
  const now = graph.context.currentTime;
  const tau = auto ? 0.055 : 0.015;
  const preamp = enabled ? 10 ** (profile.preamp / 20) : 1;

  graph.preamp.gain.cancelScheduledValues(now);
  graph.preamp.gain.setTargetAtTime(preamp, now, tau);

  graph.filters.forEach((filter, index) => {
    const band = profile.bands[index];
    if (!band) {
      filter.gain.cancelScheduledValues(now);
      filter.gain.setTargetAtTime(0, now, tau);
      return;
    }
    filter.type = band.type;
    filter.frequency.value = band.frequency;
    filter.Q.value = Math.max(band.q, 0.01);
    filter.gain.cancelScheduledValues(now);
    filter.gain.setTargetAtTime(enabled ? band.gain : 0, now, tau);
  });

  if (graph.context.state === "suspended") {
    void graph.context.resume();
  }
}

function bandAverage(
  data: Uint8Array,
  sampleRate: number,
  low: number,
  high: number,
): number {
  const binHz = sampleRate / (data.length * 2);
  let sum = 0;
  let count = 0;
  for (let i = 0; i < data.length; i += 1) {
    const freq = i * binHz;
    if (freq < low || freq >= high) continue;
    sum += data[i];
    count += 1;
  }
  return count ? sum / count : 0;
}

export function sampleSpectrum(): SpectrumBands | null {
  let chosen: AttachedGraph | null = null;
  for (const graph of liveGraphs) {
    if (!graph.element.isConnected) continue;
    if (!chosen || isActive(graph.element)) chosen = graph;
    if (isActive(graph.element)) break;
  }
  if (!chosen) return null;
  const data = new Uint8Array(chosen.analyser.frequencyBinCount);
  chosen.analyser.getByteFrequencyData(data);
  const rate = chosen.context.sampleRate;
  return {
    sub: bandAverage(data, rate, 20, 60),
    bass: bandAverage(data, rate, 60, 150),
    lowMid: bandAverage(data, rate, 150, 400),
    mid: bandAverage(data, rate, 400, 2000),
    highMid: bandAverage(data, rate, 2000, 6000),
    high: bandAverage(data, rate, 6000, 16000),
    rms: bandAverage(data, rate, 20, 16000),
    crack: bandAverage(data, rate, 2500, 5000),
    hats: bandAverage(data, rate, 6000, 10000),
    air: bandAverage(data, rate, 10000, 16000),
  };
}

export function resumeGraphs(): void {
  for (const graph of liveGraphs) {
    if (graph.context.state === "suspended") {
      void graph.context.resume();
    }
  }
}

export function collectMedia(): HTMLMediaElement[] {
  const nodes = document.querySelectorAll(
    "video.html5-main-video, video.video-stream, .html5-video-player video, ytd-player video, audio, video",
  );
  const seen = new Set<HTMLMediaElement>();
  const list: HTMLMediaElement[] = [];
  for (const node of nodes) {
    if (!(node instanceof HTMLMediaElement) || seen.has(node)) continue;
    seen.add(node);
    list.push(node);
  }
  return list.sort((a, b) => Number(isActive(b)) - Number(isActive(a)));
}

function isYouTubeMain(element: HTMLMediaElement): boolean {
  return (
    element.classList.contains("html5-main-video") ||
    element.classList.contains("video-stream")
  );
}

function isActive(element: HTMLMediaElement): boolean {
  return !element.paused && !element.ended && element.readyState >= 2;
}

function isAudible(element: HTMLMediaElement): boolean {
  return isActive(element) && !element.muted && element.volume > 0;
}

function shouldAttach(element: HTMLMediaElement): boolean {
  if (attached.has(element)) return true;
  if (element.muted) return false;
  if (isAudible(element)) return true;
  if (
    isYouTubeMain(element) &&
    !element.paused &&
    navigator.userActivation?.hasBeenActive === true
  ) {
    return true;
  }
  return false;
}

export function applyEqToPage(state: EqState): AudioStatus {
  resumeGraphs();
  const media = collectMedia();
  let sampleRate: number | null = null;
  let count = 0;
  let error: string | null = null;

  for (const element of media) {
    if (!shouldAttach(element)) continue;
    try {
      const graph = createGraph(element);
      if (!graph) {
        error = "This tab's audio was already captured. Refresh the page.";
        continue;
      }
      applyProfileToGraph(graph, state);
      sampleRate = graph.context.sampleRate;
      count += 1;
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }
  }

  for (const graph of liveGraphs) {
    if (!graph.element.isConnected || graph.context.state === "closed") {
      liveGraphs.delete(graph);
    }
  }

  return { attached: count, mediaFound: media.length, sampleRate, error };
}

export function watchMedia(onChange: () => void): () => void {
  let timer = 0;
  const observer = new MutationObserver(() => {
    window.clearTimeout(timer);
    timer = window.setTimeout(onChange, 200);
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  return () => {
    window.clearTimeout(timer);
    observer.disconnect();
  };
}
