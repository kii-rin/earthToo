# earthToo

Goal: build a fast, scalable 3D Earth renderer that can grow from local zones to continents and eventually the world, using real elevation/hydro data and shared global systems instead of regional hacks.

Current base:
- USGS 3DEP + Delatin terrain
- global elevation coloring
- movement + rendered-terrain collision
- global ocean / river water modes
- terrain-fitted river rendering

Exact v0.4 source snapshot: `snapshots/earthToo-v0.4-global-light-lowlands.zip`

Water works for now, but the coast/ocean rendering path is temporary technical debt.