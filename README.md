# earthToo v0.2 — water fixed

This branch contains the current working water checkpoint.

Source snapshot:
`snapshots/earthToo-water-fixed-v0.2.zip`

Current setup:
- USGS 3DEP raw Float32 terrain
- fixed 2049 × 2049 / 10 m grid
- Delatin maxError = 8 m
- ocean-only 3DHP mask (`featuretype = 4`)
- detached-water cleanup
- isolated land-hole cleanup
- ~60 m water underlap beneath land
- water depth bias to reduce shoreline flicker
- LinearFilter on the raster water mask for smoother edges
- no distance LOD

This is the best working water checkpoint so far; minor flicker/hollows remain for later cleanup.
