# Universal EQ

A cross-platform, Rust-first audio processing application designed to provide intelligent, device-aware equalization independently of individual music streaming platforms.

> **Detect the audio. Understand the output device. Apply the right EQ.**

---

## Project Status

**Early Development — M001: Real-Time Windows EQ**

The current focus is building and validating the Rust audio engine and Windows audio pipeline.

Streaming metadata, mobile applications, cloud synchronization and advanced automation will be developed only after the core audio engine is stable.

---

# Vision

Universal EQ aims to provide a single audio-processing layer across supported platforms.

Instead of modifying the EQ inside individual streaming services, Universal EQ processes audio at the operating-system/output layer where platform capabilities allow it.

```text
Music / Audio Application
          │
          ▼
    Operating System
          │
          ▼
    Universal EQ
          │
       Rust DSP
          │
          ▼
    Output Device
          │
          ▼
 Headphones / Speakers
```

The long-term goal is to automatically combine:

* Current track
* Artist
* Album
* Output device
* Device correction profile
* User EQ preferences

to produce an appropriate EQ configuration.

---

# Core Principles

## Rust First

Rust is the primary language and foundation of the application.

The audio engine, DSP, platform integrations and core application logic should use Rust wherever practical.

## Real-Time Audio

Audio processing is the most critical part of the application.

Latency, CPU usage, memory usage and stability are first-class requirements.

## Platform Native Where Necessary

The DSP should remain as portable as possible.

Platform-specific audio I/O will use the appropriate native APIs.

```text
             Rust DSP Core
                   │
       ┌───────────┼───────────┐
       │           │           │
    Windows      macOS      Mobile
    WASAPI     Core Audio   Native APIs
```

## Streaming Platform Independent

The EQ engine should not depend on modifying the internal audio processing of a specific streaming service.

Streaming platforms are metadata sources, not the foundation of the audio engine.

## Small, Modular Components

The project is being developed by a two-person team.

Every component should have a clear responsibility and avoid unnecessary dependencies.

---

# Technology Stack

## Core

* Rust
* Cargo
* Tokio where asynchronous tasks are required
* Custom Rust DSP
* Biquad filters
* Parametric EQ
* CPAL for initial audio prototyping

## Desktop

* Tauri 2
* React
* TypeScript

## Windows

* WASAPI
* Windows native audio APIs

## macOS

* Core Audio

## Android

* React Native
* Oboe
* Android native audio APIs

## iOS

* React Native
* AVAudioEngine
* Core Audio

## Backend

* Rust
* Axum
* PostgreSQL
* Redis if required later

## Development

* Git
* GitHub
* GitHub Actions
* Cargo
* pnpm
* Turborepo where useful

---

# Architecture

```text
                         UNIVERSAL EQ
                              │
                    ┌─────────▼─────────┐
                    │     Rust Core     │
                    │                   │
                    │  Audio Engine     │
                    │  DSP              │
                    │  EQ               │
                    │  Profiles         │
                    │  Device Manager   │
                    │  Core Logic       │
                    └─────────┬─────────┘
                              │
              ┌───────────────┼───────────────┐
              │               │               │
           Windows          macOS           Mobile
           WASAPI         Core Audio      Native APIs
              │               │               │
              └───────────────┼───────────────┘
                              │
                       Audio Output
                              │
                     Headphones / Speakers
```

---

# Desktop Architecture

```text
React + TypeScript
        │
        │ Tauri commands/events
        ▼
      Rust
        │
        ├── Audio Engine
        ├── DSP
        ├── Device Manager
        └── Profiles
        │
        ▼
   Native Audio API
```

React is responsible for presentation.

Rust is responsible for the application and audio processing.

---

# DSP

The initial DSP engine will support:

* Preamp
* Gain
* Biquad filters
* Peaking filters
* Low-shelf filters
* High-shelf filters
* Parametric EQ
* Limiting

Future possibilities include:

* FIR filtering
* Dynamic EQ
* Loudness compensation
* Crossfeed
* Spatial processing

---

# EQ Model

A profile will be represented as data rather than hard-coded into the UI.

Example:

```json
{
  "name": "Bass Boost",
  "preamp": -2,
  "bands": [
    {
      "frequency": 60,
      "gain": 4,
      "q": 0.7
    },
    {
      "frequency": 125,
      "gain": 2,
      "q": 0.8
    }
  ]
}
```

The React interface edits the configuration.

The Rust DSP engine applies it.

---

# Metadata Architecture

Streaming metadata will be isolated from the audio engine.

```text
Spotify ───────┐
Apple Music ───┤
YouTube ───────┤
Tidal ─────────┤
Deezer ────────┘
       │
       ▼
 Metadata Adapters
       │
       ▼
 Normalized Track
       │
       ▼
 PostgreSQL
```

The normalized model will allow the same track to be associated with provider-specific identifiers.

Example:

```text
Track
├── Spotify ID
├── Apple Music ID
├── YouTube ID
├── Tidal ID
└── ISRC
```

---

# Repository Structure

```text
universal-eq/
│
├── crates/
│   ├── eq-core/
│   ├── dsp/
│   ├── audio-engine/
│   ├── device-manager/
│   ├── profiles/
│   └── metadata/
│
├── platforms/
│   ├── windows/
│   ├── macos/
│   ├── android/
│   └── ios/
│
├── apps/
│   ├── desktop/
│   │   ├── frontend/
│   │   └── src-tauri/
│   │
│   └── mobile/
│
├── services/
│   └── api/
│
├── packages/
│   ├── types/
│   └── ui/
│
├── docs/
│   ├── architecture/
│   ├── research/
│   └── decisions/
│
├── tests/
│
├── Cargo.toml
├── package.json
├── pnpm-workspace.yaml
└── README.md
```

---

# Development Roadmap

## M000 — Architecture & Research

* [ ] Research PCM audio
* [ ] Research sample rates
* [ ] Research buffer sizes
* [ ] Research latency
* [ ] Research WASAPI
* [ ] Research CPAL
* [ ] Research real-time Rust audio
* [ ] Research biquad filters
* [ ] Research parametric EQ
* [ ] Document architecture
* [ ] Create initial ADRs

---

## M001 — Rust DSP

* [ ] PCM processing
* [ ] Gain
* [ ] Preamp
* [ ] Biquad implementation
* [ ] Peaking filter
* [ ] Low-shelf filter
* [ ] High-shelf filter
* [ ] Parametric EQ
* [ ] Limiter
* [ ] Unit tests
* [ ] Frequency-response tests

---

## M002 — Windows Audio

* [ ] Detect output devices
* [ ] Establish Windows audio pipeline
* [ ] Connect audio pipeline to Rust DSP
* [ ] Process real-time audio
* [ ] Device switching
* [ ] Sample-rate handling
* [ ] Buffer handling
* [ ] Measure latency
* [ ] Measure CPU usage
* [ ] Test Bluetooth
* [ ] Test USB audio
* [ ] Test laptop speakers

---

## M003 — Desktop Application

* [ ] Tauri 2
* [ ] React UI
* [ ] EQ graph
* [ ] EQ controls
* [ ] Device selection
* [ ] EQ enable/disable
* [ ] Presets
* [ ] Persistent configuration
* [ ] Rust ↔ React communication

---

## M004 — Device Profiles

* [ ] Device model
* [ ] Device profile model
* [ ] Manual profiles
* [ ] User profiles
* [ ] Profile persistence
* [ ] Profile switching

---

## M005 — Metadata

* [ ] Metadata abstraction
* [ ] Provider adapters
* [ ] Track normalization
* [ ] Provider-specific IDs
* [ ] ISRC support
* [ ] Track database
* [ ] Current-track detection

---

## M006 — Automatic EQ

```text
Current Track
      +
Output Device
      +
User Preferences
      ↓
EQ Configuration
      ↓
Rust DSP
```

* [ ] Track profile
* [ ] Device profile
* [ ] Profile combination
* [ ] Automatic EQ switching
* [ ] Smooth EQ transitions
* [ ] User override

---

## M007 — Android

* [ ] React Native
* [ ] Android native audio
* [ ] Oboe
* [ ] Rust integration
* [ ] Device management
* [ ] Playback compatibility testing

---

## M008 — macOS

* [ ] Core Audio research
* [ ] Native audio implementation
* [ ] Rust integration
* [ ] Device management
* [ ] Performance testing

---

## M009 — iOS

* [ ] AVAudioEngine research
* [ ] AVAudioSession
* [ ] Native audio integration
* [ ] Rust DSP integration
* [ ] Supported playback architecture
* [ ] Platform limitations

---

# Team

The project is designed for a two-person engineering team.

## Developer 1 — Audio / Platform

Primary ownership:

* Rust
* DSP
* Audio engine
* WASAPI
* Core Audio
* Android audio
* iOS audio
* Performance
* Audio testing

## Developer 2 — Application / Product

Primary ownership:

* Rust application layer
* Tauri
* React
* React Native
* Backend
* PostgreSQL
* Metadata
* Profiles
* UI/UX

Both developers should be able to work on the Rust core.

---

# Development Workflow

```text
Feature Branch
      ↓
Implementation
      ↓
Tests
      ↓
Pull Request
      ↓
Code Review
      ↓
main
```

`main` must remain buildable.

No direct pushes to `main`.

Audio changes require appropriate automated tests and manual audio testing.

Architecture-changing decisions should be documented in:

```text
docs/decisions/
```

---

# M001 Success Criteria

The first major milestone is deliberately small.

```text
Any Windows Audio
       ↓
Windows Audio Layer
       ↓
Rust Audio Engine
       ↓
Rust DSP / EQ
       ↓
Windows Output
       ↓
Headphones / Speakers
```

The user must be able to:

1. Launch Universal EQ.
2. Select an output device.
3. Enable EQ.
4. Change EQ parameters.
5. Hear the change in real time.
6. Disable EQ.
7. Return to unprocessed audio.

The system must operate without unacceptable:

* latency
* CPU usage
* memory usage
* audio glitches
* clicks
* pops
* distortion

No streaming integrations, mobile applications, accounts, cloud services or advanced automation are required for M001.

**The audio engine comes first.**
