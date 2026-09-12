# Platform progress

Tick a box when something ships. Then either:

1. Run `npm run progress` (updates the bars in the README), or
2. Commit and push — GitHub Actions does the same thing.

Do not edit the generated bars in `README.md` by hand. This file is the source of truth.

---

## Chrome extension

Browser companion. Applies EQ to `audio` / `video` in the page via the Web Audio API. Not system-wide.

<!-- platform:chrome -->

- [x] Vite + CRXJS Manifest V3 scaffold
- [x] Popup, content script, and service worker
- [x] Enable / bypass EQ
- [x] Preamp + 15-band parametric EQ (peak, low shelf, high shelf)
- [x] Frequency-response graph
- [x] Built-in presets (Flat, Music, Bass Boost, Vocal, Podcast, Night)
- [x] Persistent profile in `chrome.storage`
- [x] Web Audio graph on page media elements
- [x] Limiter after the EQ chain
- [x] Spectrum analyser for Auto
- [x] Now-playing adapters (YouTube, Spotify Web, mediaSession)
- [x] Auto mode calling the local Rust recommend API
- [x] Live Auto updates as the mix changes
- [x] Toolbar badge (ON / AUTO)
- [x] Light / dark theme
- [ ] Capture players that already own the audio graph (Spotify Web, etc.)
- [ ] Cross-origin iframe EQ
- [ ] Headphone / speaker correction in the popup
- [ ] Smooth curve transitions (no zipper noise)
- [ ] Auto without a local API (bundled WASM)
- [ ] Extra site adapters (Tidal, Deezer, Apple Music web)
- [ ] Extension unit / e2e tests
- [ ] Chrome Web Store package and listing
- [ ] Firefox / Edge package

<!-- /platform:chrome -->

---

## Desktop app

Tauri + React over a native audio pipeline (WASAPI on Windows, Core Audio on macOS). This is the system-wide product from the plan. **Not started.**

<!-- platform:desktop -->

- [ ] Tauri 2 app scaffold
- [ ] React desktop shell
- [ ] EQ graph
- [ ] EQ sliders and band controls
- [ ] Enable / bypass
- [ ] Presets
- [ ] Persistent config
- [ ] Rust ↔ React commands
- [ ] Detect output devices
- [ ] Windows WASAPI loopback / process pipeline
- [ ] Connect the pipeline to Rust DSP (real PCM, not Web Audio)
- [ ] Hear EQ on system audio in real time
- [ ] Device switching without glitches
- [ ] Sample-rate and buffer handling
- [ ] Latency and CPU measurements
- [ ] Test speakers, USB, and Bluetooth
- [ ] Device / headphone profiles
- [ ] Auto EQ using the same Rust engine
- [ ] macOS Core Audio path

<!-- /platform:desktop -->

---

## Android

React Native + Oboe (or Android native audio) + Rust DSP. **Not started.**

<!-- platform:android -->

- [ ] React Native app scaffold
- [ ] EQ UI (graph, sliders, enable/bypass)
- [ ] Presets and local persistence
- [ ] Oboe / AAudio research and prototype
- [ ] Native playback or session capture path
- [ ] Rust DSP on Android (JNI / UniFFI)
- [ ] Device and output routing
- [ ] Playback compatibility (YouTube, Spotify, local files)
- [ ] Auto EQ against the shared engine
- [ ] Headphone profiles
- [ ] Acceptable latency (no obvious delay)
- [ ] Play Store package

<!-- /platform:android -->

---

## iOS

React Native + AVAudioEngine / AVAudioSession + Rust DSP. **Not started.** Platform rules are stricter than Android.

<!-- platform:ios -->

- [ ] AVAudioEngine / AVAudioSession research notes
- [ ] Document what iOS will and will not allow
- [ ] React Native iOS app scaffold
- [ ] EQ UI (graph, sliders, enable/bypass)
- [ ] Presets and local persistence
- [ ] Native audio integration
- [ ] Rust DSP on iOS
- [ ] Supported playback architecture (in-app vs system)
- [ ] Auto EQ against the shared engine
- [ ] Headphone profiles
- [ ] Acceptable latency
- [ ] App Store package

<!-- /platform:ios -->
