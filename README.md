# Universal EQ

Cross-platform, Rust-first equalization. See [techstack+plan.md](techstack+plan.md).

## What exists now

1. **Rust EQ API** (`services/api`) — custom per-track EQ recommend (not presets)
2. **Chrome extension** (`apps/chrome-extension`) — tab EQ + Auto calls the Rust API

System-wide WASAPI EQ is still a later milestone.

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
crates/eq-core   shared EQ types
crates/dsp       custom EQ curve fitting
services/api     Axum HTTP API
apps/chrome-extension
```
