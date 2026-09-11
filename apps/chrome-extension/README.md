# Universal EQ — Chrome extension

Browser companion for Universal EQ. It reads the current tab’s track metadata and applies a parametric EQ to `audio` / `video` elements through the Web Audio API.

This is not the Windows system EQ. OS-level processing still belongs to the Rust engine in later milestones.

## Features

- Enable / bypass
- Preamp plus 8 parametric bands (peak, low shelf, high shelf)
- Frequency-response graph
- Presets, including the plan’s Bass Boost example
- Persistent profile in `chrome.storage`
- Now-playing adapters for YouTube, Spotify Web, and `mediaSession`
- Toolbar badge when EQ is on

## Develop

```bash
cd apps/chrome-extension
npm install
npm run dev
```

Then load `apps/chrome-extension/dist` as an unpacked extension (CRXJS writes the unpacked build there during `vite` / `vite build`).

## Load in Chrome

1. `npm install` and `npm run build` in this folder.
2. Open `chrome://extensions`.
3. Enable Developer mode.
4. Click **Load unpacked** and select `apps/chrome-extension/dist`.
5. Open a tab with media (YouTube is a good first test), play audio, then open the extension popup.

## Limits

- Only media elements in the page can be processed. Some players (including parts of Spotify Web) already own the audio graph and cannot be re-wrapped.
- A `MediaElementSource` can be created once per element. Reload the tab if another extension already captured it.
- Cross-origin frames without permission will not be equalized.
