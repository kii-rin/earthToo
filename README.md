# earthToo

**A real-world terrain exploration experiment.**

`earthToo` turns measured geographic elevation into an explorable, stylized 3D world in the browser. The current **Initial** milestone focuses only on terrain: preserve real geography, simplify it intelligently into large low-poly faces, and make the result pleasant to explore before adding vegetation, rocks, weather, multiplayer, or other simulation systems.

## Initial baseline

The current baseline is **Project Earth — Terrain v0.2**.

- **Region:** Grand Canyon test area
- **Area:** 16.384 km × 16.384 km
- **Elevation source:** USGS 3DEP
- **Source sampling:** ~8 m (2049 × 2049 height samples)
- **Mesh:** adaptive Delaunay triangulation using Delatin
- **Terrain precision:** adjustable from 0.5 m to 100 m maximum vertical approximation error
- **Rendering:** Three.js, WebGPU renderer with WebGL2 fallback
- **UI / app:** SvelteKit
- **Scale:** geographic metres; terrain height is derived from real elevation data

The precision control is intentionally expressed as **maximum vertical error**, not polygon spacing. Low values preserve more measured terrain detail; high values create fewer, larger faces while remaining bounded by the chosen approximation error.

## Core rule

> **The geometry can be simplified, but the terrain height must come from real geographic data.**

No procedural hills, fake ridges, decorative terrain noise, or invented elevation are used in the current terrain pipeline.

## Why this approach

Earlier prototypes used regular height-grid triangulation. They were geographically useful but visually repetitive: every slope contained similar triangles and obvious diagonal patterns.

The current approach instead uses an **adaptive Delaunay terrain mesh**. Flat/simple areas can collapse into very large faces, while cliffs, rims, valleys, and other complex terrain retain more geometry because more triangles are required to stay within the selected elevation-error limit.

In simplified form:

```text
USGS 3DEP elevation
        ↓
real height raster
        ↓
Delatin adaptive triangulation
        ↓
irregular low-poly terrain mesh
        ↓
flat shading + terrain palette + lighting
        ↓
first-person / developer-flight exploration
```

## Stack

- [SvelteKit](https://svelte.dev/) — application shell and HUD
- [Three.js](https://threejs.org/) — rendering and first-person scene
- [Delatin](https://github.com/mapbox/delatin) — adaptive Delaunay terrain simplification
- [GeoTIFF](https://geotiffjs.github.io/) — decoding elevation imagery returned by the server route
- [proj4](https://proj4js.org/) — geographic / UTM coordinate conversion
- [Astronomy Engine](https://github.com/cosinekitty/astronomy) — Sun/Moon positioning experiments
- USGS 3DEP — real-world elevation source for the current Grand Canyon test

## Run locally

Requirements: a recent Node.js installation.

```bash
npm install
npm run dev
```

Then open the local Vite/SvelteKit URL printed in the terminal.

Useful checks:

```bash
npm run check
npm run build
```

## Controls

| Control | Action |
| --- | --- |
| Click terrain | Capture mouse |
| Esc | Release mouse |
| WASD | Move |
| Shift | Fast movement |
| F | Toggle ground / developer flight |
| Space / Ctrl | Fly up / down |
| T | Toggle inspection-noon / real sky |
| Terrain Precision slider | Change maximum terrain approximation error |
| Maps | Open current latitude / longitude in Google Maps |

## Project structure

```text
src/
├── lib/
│   ├── game/
│   │   ├── AdaptiveTerrain.ts       # Delatin → renderable terrain mesh
│   │   ├── Game.ts                  # renderer, camera, movement, lighting, controls
│   │   ├── TerrainRegionSource.ts   # fixed real-world terrain region and sampling
│   │   ├── celestial.ts             # Sun/Moon helpers
│   │   ├── geo.ts                   # geographic types/helpers
│   │   └── utm.ts                   # local metres ↔ geographic coordinates
│   └── types/
│       └── delatin.d.ts
└── routes/
    ├── +page.svelte                 # compact HUD + terrain precision control
    └── api/usgs-region/+server.ts   # USGS 3DEP terrain fetch + compact binary response
```

## Current terrain pipeline

### 1. Fetch measured elevation

The SvelteKit server route requests a fixed Grand Canyon region from USGS 3DEP in UTM zone 12N and converts the returned GeoTIFF into compact 0.1 m quantized height samples.

### 2. Build the adaptive mesh

The browser passes the heightfield to Delatin with a requested maximum error. Delatin creates an irregular Delaunay triangulation that concentrates geometry where it is required to represent the measured terrain.

### 3. Render flat-shaded faces

The terrain is rendered as a single-piece low-poly surface. Face color currently uses a deliberately small canyon palette based on measured elevation and triangle slope. This is an art-direction layer; it does not alter elevation.

### 4. Follow the rendered surface

Ground movement samples the **actual simplified triangle mesh**, rather than the original dense raster, so the camera stays on the surface the player can see even at aggressive simplification settings.

## Development direction

For now the project is deliberately **terrain-first**. Before adding trees, rocks, procedural ecology, weather, or server world generation, the terrain should feel good to explore.

Near-term terrain work can include:

- improve face topology and silhouette quality
- improve palette / lighting / ambient occlusion
- test larger geographic areas and streaming
- evaluate chunk seams when adaptive terrain becomes streamed
- benchmark mesh build time, triangle count, memory, and rendering cost
- preserve important geographic features while simplifying aggressively

Later layers may include deterministic tree populations/genomes, rocks, biome-driven vegetation, real water boundaries, astronomical sky, real-world weather, and server-prebuilt world chunks.

## Working principles

1. **Real geography is the source of truth.**
2. **Do not add procedural height noise to make terrain look detailed.**
3. **Simplification is allowed; invented elevation is not.**
4. **Performance matters, but terrain readability and exploration quality matter too.**
5. **Prefer measurable controls** (e.g. maximum elevation error) over arbitrary visual guesses.
6. **Keep the renderer separate from world-generation logic** so the project can later move expensive generation to workers or servers without changing the geographic model.

## Status

**Initial terrain baseline — active experiment.**

The project is intentionally small at this stage. The goal is to establish the terrain language and geographic pipeline first, then grow the simulation around it.
