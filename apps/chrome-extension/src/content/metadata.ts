import { scrapePageTrack } from "../shared/scrape-page-track";
import type { NormalizedTrack } from "../shared/types";

export function readTrack(): NormalizedTrack | null {
  return scrapePageTrack();
}

export function tracksEqual(
  a: NormalizedTrack | null,
  b: NormalizedTrack | null,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.title === b.title &&
    a.artist === b.artist &&
    a.album === b.album &&
    a.source === b.source &&
    a.url === b.url
  );
}
