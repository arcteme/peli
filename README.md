# Peli — Plastic Model Air Combat

A browser-based WW2 dogfight game where 1:10 scale plastic model aeroplanes battle over a photorealistic 3-D reconstruction of central Kerava, Finland. The city geometry is derived from real CityGML survey data and the aerial photography is sourced from the National Land Survey of Finland.

---

## Table of Contents

- [Overview](#overview)
- [Aircraft](#aircraft)
- [Controls](#controls)
- [HUD](#hud)
- [Architecture](#architecture)
- [Data Pipeline](#data-pipeline)
- [Getting Started](#getting-started)
- [Developer Tools](#developer-tools)

---

## Overview

- **Engine** — Three.js (WebGL), written in TypeScript, bundled with Vite.
- **World scale** — The city is rendered at 1:1 real-world metres. The aircraft are 1:10 scale models, so their speeds are divided by 10 to make the buildings feel large and imposing.
- **Flight model** — Energy-based physics: throttle provides thrust, gravity exchanges potential and kinetic energy (dive = faster, climb = slower), quadratic drag, stall detection, and speed-dependent control authority.
- **AI** — Up to 6 enemy AI planes patrol, chase, attack and evade. Each has a procedurally-assigned ace pilot name displayed as a floating world-space label.
- **Combat** — Hitscan bullets with tracers. Hit markers, a kill feed, damage screen flash, and camera shake all provide feedback.

---

## Aircraft

Three flyable aircraft with distinct handling characteristics.  All stats are for the 1:10 scaled model.

| Aircraft | Country | Max Speed | Health | Fire Rate | Character |
|---|---|---|---|---|---|
| **A6M Zero** | 🇯🇵 Japan | 52 m/s | 80 HP | 14 rds/s | Light, agile, fragile |
| **Spitfire Mk.IX** | 🇬🇧 United Kingdom | 56 m/s | 100 HP | 18 rds/s | Balanced all-rounder |
| **Bf 109 G-6** | 🇩🇪 Germany | 60 m/s | 110 HP | 12 rds/s | Fast, heavy, hard-hitting |

Aircraft are selected at the main menu before entering the game.

---

## Controls

### Flight

| Input | Action |
|---|---|
| **Mouse** (pointer locked) | Pitch and roll (primary flight control) |
| **W / Arrow Up** | Pitch nose down |
| **S / Arrow Down** | Pitch nose up |
| **A / Arrow Left** | Roll left |
| **D / Arrow Right** | Roll right |
| **Q** | Rudder left (yaw) |
| **E** | Rudder right (yaw) |
| **Shift** | Increase throttle |
| **Ctrl** | Decrease throttle |

Keyboard axes are smoothed — inputs ramp up in ~0.33 s and centre in ~0.17 s for natural feel without raw snap.

### Combat

| Input | Action |
|---|---|
| **Left Mouse Button / Space** | Fire weapons |

### Camera

| Input | Action |
|---|---|
| **V** | Toggle chase camera ↔ cockpit camera |

### Gamepad

A connected gamepad is detected automatically. Left stick for pitch/roll, right stick for yaw, triggers for throttle/brake, face button for fire.

---

## HUD

The HTML overlay HUD displays:

- **Speed** (bottom-left) — current airspeed in m/s, with a STALL warning when below minimum lift speed.
- **Altitude** (bottom-right) — height above ground in metres.
- **Health bar** (bottom-centre) — current HP; flashes red when taking damage.
- **Throttle bar** — percentage of maximum thrust.
- **Crosshair** — centred aim reticle, pulses on hit.
- **Kill feed** — recent kills scroll in the top-right corner.
- **Score** — K/D counter.
- **Minimap** — top-down radar showing player position and all AI enemies within range.
- **Respawn timer** — countdown overlay when dead.
- **Message line** — transient status messages (camera hints, dev mode notices, etc.).

---

## Architecture

```
src/
├── main.ts                 Entry point — mounts canvas, shows main menu
├── game/
│   └── Game.ts             Game loop, scene setup, player update, inspector mode
├── physics/
│   └── FlightPhysics.ts    Energy-based flight model (thrust, gravity, drag, stall)
├── combat/
│   └── CombatManager.ts    Bullets, hit detection, AI state machine, kill tracking
├── entities/
│   └── AircraftModel.ts    Procedural Three.js mesh for each aircraft type
├── world/
│   ├── CityMap.ts          Loads binary geometry, builds Three.js meshes + colliders
│   └── Sky.ts              Sky dome, sun, atmospheric fog
├── camera/
│   └── CameraManager.ts    Chase and cockpit cameras with smooth transitions
├── input/
│   └── InputManager.ts     Keyboard, mouse, and gamepad abstraction
├── audio/
│   └── AudioManager.ts     Engine sound, gunfire, hit and explosion audio
├── effects/
│   └── EffectsManager.ts   Particle effects — tracer rounds, smoke, explosions
├── ui/
│   ├── HUD.ts              HTML overlay flight instruments and combat feedback
│   └── MainMenu.ts         Aircraft and pilot name selection screen
├── dev/
│   └── TextureCalibrator.ts  F4 aerial-texture alignment tool
└── shared/
    ├── constants.ts        Aircraft definitions, physics constants, spawn points
    └── types.ts            Shared TypeScript interfaces and enums
```

---

## Data Pipeline

The 3-D city is built from a one-time preprocessing step before the game is first run.

```
src/world/L4143F.gml          Raw CityGML survey (EPSG:3067 / N2000, LOD2 buildings)
       │
       ▼
scripts/process-gml.mjs       Filters buildings within 500 m of Kerava station,
                               triangulates polygon faces (earcut), writes compact
                               binary geometry to public/

       ▼
public/kerava-walls.bin        Packed Float32 vertex + Uint32 index buffers
public/kerava-roofs.bin        (same format)
public/kerava-meta.json        Per-building metadata + AABB for collision detection

       ▼ (optional)
scripts/fix-terrain-floors.mjs  Post-processes floor heights so no building floats
scripts/crop-aerial.py          Crops/tiles the aerial photo to match the map radius
```

Binary format for `.bin` files:

```
Bytes 0–3   Uint32LE  vertexCount
Bytes 4–7   Uint32LE  indexCount
Bytes 8…    Float32[] vertex positions [x, y, z, …]
Bytes …     Uint32[]  triangle indices  [i, j, k, …]
```

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 18 or later
- Python 3 (only needed for the optional aerial photo crop script)

### Install

```bash
npm install
```

### Preprocess city geometry (first run only)

This reads `src/world/L4143F.gml` and writes the binary files to `public/`.

```bash
npm run fix-terrain
```

To also fix building floor heights after the initial parse:

```bash
npm run fix-terrain
```

### Run development server

```bash
npm run dev
```

The game opens automatically at `http://localhost:5173`.

### Production build

```bash
npm run build     # outputs to dist/
npm run preview   # serve the production build locally
```

---

## Developer Tools

Two in-game tools are available during development (no build flag required — they are always compiled in).

### Inspector Mode — `F3`

A free-fly camera that decouples from the player aircraft so you can explore the city geometry.

- **WASD** — move horizontally
- **Mouse** — look around
- **Shift** — fast movement
- Press `F3` again to return to normal play

### Texture Calibrator — `F4`

Overlays the aerial photograph on the city mesh so you can nudge its UV offset until the texture aligns with the underlying buildings.

- **Arrow keys** — shift the texture offset
- Press `F4` again to deactivate

Both tools display a status message in the HUD when toggled and are mutually exclusive (activating one automatically deactivates the other).








