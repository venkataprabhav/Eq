import type { NormalizedTrack } from "./types";

/** Must stay self-contained: injected into the page MAIN world via executeScript. */
export function scrapePageTrack(): NormalizedTrack | null {
  const host = location.hostname.replace(/^www\./, "");
  const source = host.includes("youtu")
    ? "YouTube"
    : host.includes("spotify.com")
      ? "Spotify"
      : host.includes("music.apple.com")
        ? "Apple Music"
        : host.includes("tidal.com")
          ? "Tidal"
          : host.includes("deezer.com")
            ? "Deezer"
            : host.includes("soundcloud.com")
              ? "SoundCloud"
              : host || "Browser";

  const session = navigator.mediaSession?.metadata;
  if (session?.title) {
    return {
      title: session.title,
      artist: session.artist || "",
      album: session.album || "",
      source,
      url: location.href,
      artwork: session.artwork?.[0]?.src,
    };
  }

  const textOf = (selector: string): string =>
    document.querySelector(selector)?.textContent?.trim() ?? "";

  const attrOf = (selector: string, attr: string): string =>
    document.querySelector(selector)?.getAttribute(attr)?.trim() ?? "";

  let title =
    textOf("h1.ytd-watch-metadata yt-formatted-string") ||
    textOf("ytd-watch-metadata h1 yt-formatted-string") ||
    textOf("ytd-watch-metadata h1") ||
    textOf("#title h1 yt-formatted-string") ||
    textOf("#title h1") ||
    textOf(".ytp-title-link") ||
    textOf(".ytp-title-text") ||
    textOf('[data-testid="context-item-info-title"]') ||
    textOf('[data-testid="nowplaying-track-link"]') ||
    attrOf('meta[name="title"]', "content") ||
    attrOf('meta[property="og:title"]', "content") ||
    document.title;

  title = title.replace(/\s+-\s+YouTube$/i, "").trim();

  const artist =
    textOf("#owner #channel-name a") ||
    textOf("ytd-video-owner-renderer #channel-name a") ||
    textOf("ytd-channel-name a") ||
    textOf("#channel-name a") ||
    textOf(".ytp-title-channel") ||
    textOf('[data-testid="context-item-info-artist"]') ||
    attrOf('link[itemprop="name"]', "content");

  if (!title || title === "YouTube" || title === "Spotify") return null;

  return {
    title,
    artist,
    album: "",
    source,
    url: location.href,
  };
}

export function trackFromTab(
  title: string | undefined,
  url: string | undefined,
): NormalizedTrack | null {
  if (!title || !url) return null;
  let cleaned = title.replace(/\s+-\s+YouTube$/i, "").trim();
  cleaned = cleaned.replace(/\s+-\s+Spotify$/i, "").trim();
  if (!cleaned) return null;

  let source = "Browser";
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (host.includes("youtu")) source = "YouTube";
    else if (host.includes("spotify.com")) source = "Spotify";
    else if (host.includes("music.apple.com")) source = "Apple Music";
    else source = host;
  } catch {
    source = "Browser";
  }

  return {
    title: cleaned,
    artist: "",
    album: "",
    source,
    url,
  };
}
