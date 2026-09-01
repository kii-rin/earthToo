# earthToo v0.2 — water fixed

Research-driven test.

Terrain is unchanged:

USGS 3DEP raw Float32
→ fixed 2049 × 2049 / 10 m grid
→ Delatin maxError = 8 m
→ one static low-poly terrain mesh

There is NO distance LOD and NO camera-dependent triangulation.

Water boundary is no longer guessed from elevation.

USGS 3D Hydrography Program (3DHP) Waterbody FeatureServer
→ feature types 1 river, 2 canal, 3 lake, 4 ocean/great lake
→ same UTM bbox as terrain
→ vector polygons generalized only to 2 m
→ browser rasterizes them to a 2049 × 2049 binary GPU mask

Rendering:
- terrain shader discards water-mask pixels
- flat water plane shader discards land-mask pixels
- terrain and water therefore cannot occupy the same rendered pixel

This follows the core USGS hydro-flattening idea: water boundaries must be supplied
as separate shoreline/breakline information rather than inferred from unconstrained
terrain triangulation.

No npm/build checks were run.

## Cache-isolated fix

This revision uses unique API URLs so older Safari/dev-server responses cannot be reused:

- `/api/terrain-3dhp-test`
- `/api/water-3dhp-test`

Both browser requests use `cache: 'no-store'`.
Both API responses use `Cache-Control: no-store`.

Expected terrain grid is fixed at 2049 × 2049.
Delatin remains fixed at maxError = 8 m.
There is no distance LOD.

No npm/build checks were run.

## Status

Water/shoreline overlap is fixed in this checkpoint using 3DEP + Delatin terrain with an independent USGS 3DHP vector water mask. This is a working milestone, not the finished project.
