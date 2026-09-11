import type { AudioStatus, EqState } from "../shared/types";

interface AttachedGraph {
  context: AudioContext;
  source: MediaElementAudioSourceNode;
  preamp: GainNode;
  filters: BiquadFilterNode[];
  limiter: DynamicsCompressorNode;
}

const attached = new WeakMap<HTMLMediaElement, AttachedGraph>();

function createGraph(element: HTMLMediaElement): AttachedGraph | null {
  if (attached.has(element)) return attached.get(element) ?? null;
  if ((element as HTMLMediaElement & { __ueqAttached?: boolean }).__ueqAttached) {
    return null;
  }

  try {
    const context = new AudioContext();
    const source = context.createMediaElementSource(element);
    const preamp = context.createGain();
    const filters = Array.from({ length: 8 }, () => context.createBiquadFilter());
    const limiter = context.createDynamicsCompressor();

    limiter.threshold.value = -1;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.12;

    let node: AudioNode = source;
    node.connect(preamp);
    node = preamp;
    for (const filter of filters) {
      node.connect(filter);
      node = filter;
    }
    node.connect(limiter);
    limiter.connect(context.destination);

    (element as HTMLMediaElement & { __ueqAttached?: boolean }).__ueqAttached =
      true;
    const graph = { context, source, preamp, filters, limiter };
    attached.set(element, graph);
    return graph;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(message);
  }
}

function applyProfileToGraph(graph: AttachedGraph, state: EqState): void {
  const { enabled, profile } = state;
  const now = graph.context.currentTime;
  const linear = enabled ? 10 ** (profile.preamp / 20) : 1;
  graph.preamp.gain.cancelScheduledValues(now);
  graph.preamp.gain.setValueAtTime(linear, now);

  graph.filters.forEach((filter, index) => {
    const band = profile.bands[index];
    filter.gain.cancelScheduledValues(now);
    if (!band) {
      filter.gain.setValueAtTime(0, now);
      return;
    }
    filter.type = band.type;
    filter.frequency.setValueAtTime(band.frequency, now);
    filter.Q.setValueAtTime(Math.max(band.q, 0.01), now);
    filter.gain.setValueAtTime(enabled ? band.gain : 0, now);
  });

  if (graph.context.state === "suspended") {
    void graph.context.resume();
  }
}

export function collectMedia(): HTMLMediaElement[] {
  const nodes = document.querySelectorAll(
    "video.html5-main-video, video.video-stream, .html5-video-player video, audio, video",
  );
  const seen = new Set<HTMLMediaElement>();
  const list: HTMLMediaElement[] = [];
  for (const node of nodes) {
    if (!(node instanceof HTMLMediaElement) || seen.has(node)) continue;
    seen.add(node);
    list.push(node);
  }
  return list;
}

function isYouTubeMain(element: HTMLMediaElement): boolean {
  return (
    element.classList.contains("html5-main-video") ||
    element.classList.contains("video-stream")
  );
}

function shouldAttach(element: HTMLMediaElement): boolean {
  if (attached.has(element)) return true;
  if (!element.paused && !element.ended) return true;
  if (element.currentTime > 0.2) return true;
  if (isYouTubeMain(element) && navigator.userActivation?.hasBeenActive) return true;
  return navigator.userActivation?.hasBeenActive === true;
}

export function applyEqToPage(state: EqState): AudioStatus {
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

  return { attached: count, mediaFound: media.length, sampleRate, error };
}

export function watchMedia(onChange: () => void): () => void {
  let timer = 0;
  const observer = new MutationObserver(() => {
    window.clearTimeout(timer);
    timer = window.setTimeout(onChange, 300);
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
