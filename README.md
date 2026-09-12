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

## One-command setup (Windows)

From the repo root this installs anything missing (Node 22, Rust, MinGW), builds the Chrome extension, then starts the backend:

```powershell
powershell -ExecutionPolicy Bypass -File .\start.ps1
```

Or `npm start`. Leave that window open. The API is **HTTP only** — open [http://127.0.0.1:8787](http://127.0.0.1:8787), not `https://`. If Chrome still shows `ERR_SSL_PROTOCOL_ERROR`, it upgraded the URL; turn off **Settings → Privacy and security → Security → Always use secure connections**.

## Prerequisites

- Node 22 (`nvm use`) — only needed for the Chrome extension
- Rust (`cargo --version`) — needed for the backend

If Cargo is missing, install [rustup](https://rustup.rs/) and reopen the terminal. `start.ps1` can install these for you.

## Run the backend

The backend is the local Rust API in `services/api`. Auto in the Chrome extension calls it. Nothing is hosted in the cloud.

1. Open a terminal in the **repo root** (`Eq`), not inside `services/api`.
2. Start it:

```bash
cargo run -p universal-eq-api
```

Or:

```bash
npm run api
```

First run will compile for a minute. After that it should print:

```text
Universal EQ API listening on http://127.0.0.1:8787
POST /v1/eq/recommend  GET /health
```

Leave that terminal open. Stop it with `Ctrl+C`.

Release build (faster, slower to compile):

```bash
npm run api:release
```

### Check it is up

PowerShell:

```powershell
Invoke-RestMethod http://127.0.0.1:8787/health
```

You should see `"ok": true`.

### Optional: change the port

```powershell
$env:UNIVERSAL_EQ_PORT = "9000"
cargo run -p universal-eq-api
```

The extension expects `8787` unless you change that too.

### If Cargo fails on Windows

This repo pins the GNU toolchain in `rust-toolchain.toml` because MSVC `link.exe` was missing. If you have Visual Studio Build Tools, you can switch later. Until then, `rustup` should install `stable-x86_64-pc-windows-gnu` automatically when you run Cargo from this folder.

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
