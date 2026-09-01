# earthToo v0.2 — water fixed

This branch now contains the current working water checkpoint as a snapshot archive at:

`snapshots/earthToo-water-fixed-v0.2.zip`

Current working setup:
- USGS 3DEP raw Float32 terrain
- fixed 2049 × 2049 / 10 m grid
- Delatin maxError = 8 m
- ocean-only 3DHP water mask (`featuretype = 4`)
- detached-water cleanup
- isolated land-hole cleanup
- ~60 m water underlap beneath land
- water depth bias to reduce shoreline flicker
- LinearFilter on the raster water mask for smoother edges
- no distance LOD

This is still an experimental checkpoint, but it is the best working water build so far.
