# Universal EQ

Cross-platform, Rust-first equalization. See [techstack+plan.md](techstack+plan.md).

## Platform progress

Tick items in [PROGRESS.md](PROGRESS.md). The bars below are generated from those checkboxes.

<!-- progress-bars:start -->
| Platform | Progress |
| --- | --- |
| [Chrome extension](PROGRESS.md#chrome-extension) | ![](docs/progress/chrome.svg) `█████████████░░░░░░░` **63%** (15/24) |
| [Desktop app](PROGRESS.md#desktop-app) | ![](docs/progress/desktop.svg) `░░░░░░░░░░░░░░░░░░░░` **0%** (0/19) |
| [Android](PROGRESS.md#android) | ![](docs/progress/android.svg) `░░░░░░░░░░░░░░░░░░░░` **0%** (0/12) |
| [iOS](PROGRESS.md#ios) | ![](docs/progress/ios.svg) `░░░░░░░░░░░░░░░░░░░░` **0%** (0/12) |

Tick boxes in [PROGRESS.md](PROGRESS.md), then run `npm run progress` or push — CI updates these bars.
<!-- progress-bars:end -->

## What exists now

1. **Rust EQ API** (`services/api`) — custom per-track EQ recommend (not presets)
2. **Chrome extension** (`apps/chrome-extension`) — tab EQ + Auto calls the Rust API

System-wide WASAPI EQ, the Tauri desktop app, and Android / iOS are still later milestones. Desktop, Android, and iOS folders do not exist yet.

## Prerequisites

- Node 22 (`nvm use`)
- Rust (`cargo --version`)

## Run the Rust API

```bash
cargo run -p universal-eq-api
```

Listens on `http://127.0.0.1:8787`.

## Chrome extension

```bash
cd apps/chrome-extension
npm install
npm run build
```

Load `apps/chrome-extension/dist` as an unpacked extension in `chrome://extensions`.

With the API running, open YouTube, enable EQ, click **Auto**. The popup should show a custom curve from `universal-eq-rust/0.2` that follows louder/quieter sections of the song. Moving a slider turns Auto off immediately.

## Workspace layout

```text
crates/eq-core          shared EQ types
crates/dsp              custom EQ curve fitting
services/api            Axum HTTP API
apps/chrome-extension   browser EQ
PROGRESS.md             tick boxes → progress bars
```
