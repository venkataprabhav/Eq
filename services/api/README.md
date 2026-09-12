# Universal EQ API

Local Rust engine that returns a **custom** 15-band EQ curve for the current track.

The Chrome extension Auto mode calls:

`POST http://127.0.0.1:8787/v1/eq/recommend`

within a **500ms** timeout.

## Run

From the **repo root** (Rust required), not this folder:

```bash
cargo run -p universal-eq-api
```

Or:

```bash
npm run api
```

It listens on `http://127.0.0.1:8787` (HTTP only — not `https://`). Override with `UNIVERSAL_EQ_PORT`. Leave the process running; Auto in the extension calls it on that address.

Open [http://127.0.0.1:8787](http://127.0.0.1:8787) in a browser for a short status page, or `/health` for JSON.

On Windows you can install requirements, build the extension, and start this API with one command from the repo root:

```powershell
powershell -ExecutionPolicy Bypass -File .\start.ps1
```

Health check (PowerShell):

```powershell
Invoke-RestMethod http://127.0.0.1:8787/health
```

Or:

```bash
curl http://127.0.0.1:8787/health
```

## Recommend example

```bash
curl -X POST http://127.0.0.1:8787/v1/eq/recommend ^
  -H "Content-Type: application/json" ^
  -d "{\"track\":{\"title\":\"Loser\",\"artist\":\"Tame Impala\",\"source\":\"YouTube\"},\"spectrum\":{\"sub\":90,\"bass\":100,\"low_mid\":70,\"mid\":65,\"high_mid\":55,\"high\":45,\"rms\":70}}"
```

Response includes `profile` (`id: "custom"`), `reason`, `latency_ms`, and `engine`.

## Tests

```bash
cargo test -p dsp
```
