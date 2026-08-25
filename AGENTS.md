# AGENTS.md

## Project intent

`earthToo` is a real-world terrain exploration simulation. The current baseline is intentionally terrain-first: make measured geography enjoyable to explore before adding environment systems.

## Non-negotiable terrain rule

- Real elevation data is the source of truth.
- Do **not** add procedural height noise, fake hills, invented ridges, erosion displacement, or decorative elevation offsets unless the user explicitly changes this rule.
- It is acceptable to simplify measured terrain. The simplification should be measurable and bounded by a geographic error tolerance where possible.

## Current baseline

- SvelteKit application shell.
- Three.js renderer using `WebGPURenderer` with WebGL2 fallback.
- USGS 3DEP supplies Grand Canyon elevation.
- Current test region: 16.384 km × 16.384 km.
- Source grid: 2049 × 2049 (~8 m sampling).
- Delatin builds an adaptive irregular Delaunay mesh.
- Terrain precision slider: 0.5–100 m maximum vertical approximation error.
- Ground movement samples the rendered simplified mesh.

## Development priority

Until instructed otherwise, prioritize terrain work in this order:

1. Visual quality and landform readability.
2. Geographic fidelity / measurable approximation error.
3. Stable first-person and developer-flight exploration.
4. Performance instrumentation and stress testing.
5. Larger-area streaming.
6. Only after terrain direction is stable: water, rocks, trees, ecology, weather, multiplayer, server-prebuilt chunks.

## Art direction

The target is a clean, intentional low-poly landscape rather than a visible regular height-grid mesh.

Prefer:

- large irregular faces on simple landforms
- more geometry only where the real terrain needs it
- flat shading
- restrained palettes
- lighting/AO/atmosphere for depth

Avoid:

- repetitive grid diagonals
- uniformly tiny triangles
- color noise used to fake terrain detail
- photoreal textures as a substitute for good terrain topology unless explicitly requested

## Code guidance

- Keep geographic data / terrain generation separate from rendering concerns.
- Prefer deterministic generation.
- Keep local rendering coordinates in metres.
- Keep lat/lon conversion available for debugging and real-world comparison.
- Expose important visual/accuracy tradeoffs as measurable debug controls rather than hard-coded guesses.
- Preserve the compact HUD and developer flight tools unless there is a specific reason to change them.
- When changing terrain topology, ensure ground-following samples the same visible mesh the player sees.

## Before committing terrain changes

Run when possible:

```bash
npm run check
npm run build
```

Then manually verify:

- terrain loads from USGS data
- precision slider still rebuilds the mesh
- no obviously inverted/spiking triangles
- ground mode does not fall through or clip into the visible terrain
- flight mode still works
- Maps link reports the current location
- FPS / triangle count remain visible for comparison

## Commit style

Prefer small commits with a clear reason, for example:

- `Improve adaptive terrain face topology`
- `Add AO terrain lighting experiment`
- `Stream adjacent terrain regions`
- `Fix rendered-mesh ground sampling`

Keep experiments reversible and document meaningful visual or geographic tradeoffs in the README or changelog.
