# earthToo v0.2 — smooth shoreline mask

Base:
the ocean-only cleanup build that removed almost all major shoreline problems.

The remaining sharp square / stair-step coastline was caused by the binary water
mask being sampled with THREE.NearestFilter.

This revision changes ONLY the GPU mask texture sampling:

NearestFilter
→ LinearFilter

Why it helps:

The 3DHP polygons are vector geometry, but after rasterization the mask contains
square pixels. Nearest-neighbor filtering makes the shader cutoff follow those
pixel squares exactly.

Linear filtering interpolates between neighboring 0/1 mask texels. The existing
0.5 discard threshold therefore follows a much smoother contour between pixels
instead of a blocky staircase.

Unchanged:
- ocean-only featuretype 4 filtering
- detached-water cleanup
- small isolated land-hole cleanup
- 60 m water underlap
- water depth bias
- USGS 3DEP
- 2049 × 2049 / 10 m terrain
- Delatin maxError = 8 m
- 3DHP query
- no distance LOD
- no npm/build checks
