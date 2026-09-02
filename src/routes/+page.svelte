<script lang="ts">
  import { onMount } from 'svelte';
  import * as THREE from 'three';
  import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
  import Delatin from 'delatin';

  // Everything terrain-related is fixed.
  // No distance LOD, no camera-dependent rebuild.
  const SPACING_M = 10;
  const SEGMENTS = 2048;
  const SIDE = SEGMENTS + 1;
  const SIZE_M = SEGMENTS * SPACING_M;

  const MAX_ERROR_M = 8;
  const WATER_LEVEL_M = 0.05;

  let host: HTMLDivElement;
  let message = 'loading raw 3DEP + 3DHP shoreline polygons…';
  let triangles = 0;
  let vertices = 0;
  let buildMs = 0;
  let minHeight = 0;
  let maxHeight = 0;
  let waterPixels = 0;
  let waterFeatures = 0;
  let fps = 0;

  type ArcFeature = {
    attributes?: {
      featuretype?: number;
      featuretypelabel?: string;
    };
    geometry?: {
      rings?: number[][][];
    };
  };

  type WaterPayload = {
    epsg: number;
    minE: number;
    minN: number;
    maxE: number;
    maxN: number;
    exceededTransferLimit: boolean;
    features: ArcFeature[];
  };

  onMount(() => {
    let disposed = false;
    let frame = 0;

    let renderer: THREE.WebGLRenderer | null = null;
    let terrainGeometry: THREE.BufferGeometry | null = null;
    let terrainMaterial: THREE.MeshStandardMaterial | null = null;
    let waterGeometry: THREE.PlaneGeometry | null = null;
    let waterMaterial: THREE.MeshStandardMaterial | null = null;
    let waterTexture: THREE.DataTexture | null = null;
    let controls: OrbitControls | null = null;

    const start = async () => {
      const [terrainResponse, waterResponse] = await Promise.all([
        fetch('/api/terrain-3dhp-test', { cache: 'no-store' }),
        fetch('/api/water-3dhp-test', { cache: 'no-store' })
      ]);

      if (!terrainResponse.ok) {
        throw new Error(await terrainResponse.text());
      }

      if (!waterResponse.ok) {
        throw new Error(await waterResponse.text());
      }

      const terrainBuffer = await terrainResponse.arrayBuffer();
      const heights = new Float32Array(terrainBuffer);

      if (heights.length !== SIDE * SIDE) {
        throw new Error(
          `Expected ${SIDE * SIDE} 3DEP heights, got ${heights.length}`
        );
      }

      const hydro = (await waterResponse.json()) as WaterPayload;

      if (hydro.exceededTransferLimit) {
        throw new Error(
          '3DHP water query exceeded its transfer limit; shoreline payload is incomplete'
        );
      }

      minHeight = Infinity;
      maxHeight = -Infinity;

      for (let i = 0; i < heights.length; i++) {
        const h = heights[i];
        if (h < minHeight) minHeight = h;
        if (h > maxHeight) maxHeight = h;
      }

      // Rasterize official vector water polygons to a GPU mask.
      // Delatin is NOT involved in this operation.
      const waterMask = rasterizeWater(
        hydro.features,
        hydro.minE,
        hydro.minN,
        hydro.maxE,
        hydro.maxN,
        SIDE
      );

      waterFeatures = hydro.features.length;
      waterPixels = 0;

      for (let i = 0; i < waterMask.length; i++) {
        if (waterMask[i] > 127) waterPixels++;
      }

      waterTexture = new THREE.DataTexture(
        waterMask,
        SIDE,
        SIDE,
        THREE.RedFormat,
        THREE.UnsignedByteType
      );
      waterTexture.minFilter = THREE.NearestFilter;
      waterTexture.magFilter = THREE.NearestFilter;
      waterTexture.generateMipmaps = false;
      waterTexture.unpackAlignment = 1;
      waterTexture.needsUpdate = true;

      message = 'Delatin triangulating fixed 8 m mesh…';
      await new Promise(requestAnimationFrame);

      const buildStart = performance.now();

      // Pure Delatin. Same static mesh as before.
      const tin = new Delatin(heights, SIDE, SIDE);
      tin.run(MAX_ERROR_M);

      const coords = tin.coords;
      const tris = tin.triangles;

      const positions = new Float32Array(tris.length * 3);
      const half = SIZE_M / 2;

      let out = 0;

      for (let i = 0; i < tris.length; i++) {
        const vertexIndex = tris[i];
        const px = coords[vertexIndex * 2];
        const py = coords[vertexIndex * 2 + 1];

        positions[out++] = px * SPACING_M - half;
        positions[out++] = tin.heightAt(px, py);
        positions[out++] = py * SPACING_M - half;
      }

      buildMs = performance.now() - buildStart;
      triangles = tris.length / 3;
      vertices = coords.length / 2;

      terrainGeometry = new THREE.BufferGeometry();
      terrainGeometry.setAttribute(
        'position',
        new THREE.BufferAttribute(positions, 3)
      );
      terrainGeometry.computeVertexNormals();
      terrainGeometry.computeBoundingSphere();

      terrainMaterial = new THREE.MeshStandardMaterial({
        color: 0x7f9652,
        roughness: 1,
        metalness: 0,
        flatShading: true
      });

      // Same mask clips the terrain and water in opposite directions.
      // A pixel is therefore either terrain OR water, never both.
      applyWaterMask(
        terrainMaterial,
        waterTexture,
        SIZE_M,
        false
      );

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0xb7c8ce);

      const terrain = new THREE.Mesh(
        terrainGeometry,
        terrainMaterial
      );
      scene.add(terrain);

      waterGeometry = new THREE.PlaneGeometry(
        SIZE_M,
        SIZE_M,
        1,
        1
      );

      waterMaterial = new THREE.MeshStandardMaterial({
        color: 0x287f9c,
        roughness: 0.28,
        metalness: 0,
        side: THREE.DoubleSide
      });

      applyWaterMask(
        waterMaterial,
        waterTexture,
        SIZE_M,
        true
      );

      const water = new THREE.Mesh(
        waterGeometry,
        waterMaterial
      );
      water.rotation.x = -Math.PI / 2;
      water.position.y = WATER_LEVEL_M;
      scene.add(water);

      scene.add(
        new THREE.HemisphereLight(
          0xdbe8ef,
          0x5b513d,
          2.2
        )
      );

      const sun = new THREE.DirectionalLight(
        0xfff2d0,
        2.5
      );
      sun.position.set(-5000, 7000, 4000);
      scene.add(sun);

      const camera = new THREE.PerspectiveCamera(
        55,
        1,
        1,
        60_000
      );
      camera.position.set(0, 4200, 6500);

      renderer = new THREE.WebGLRenderer({
        antialias: true
      });
      renderer.setPixelRatio(
        Math.min(window.devicePixelRatio || 1, 1.5)
      );
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      host.appendChild(renderer.domElement);

      controls = new OrbitControls(
        camera,
        renderer.domElement
      );
      controls.target.set(0, 150, 0);
      controls.enableDamping = true;
      controls.maxDistance = 30_000;
      controls.update();

      const resize = () => {
        if (!renderer) return;

        const width = host.clientWidth;
        const height = host.clientHeight;

        camera.aspect =
          width / Math.max(1, height);
        camera.updateProjectionMatrix();

        renderer.setSize(width, height, false);
      };

      resize();
      window.addEventListener('resize', resize);

      message =
        '3DEP → fixed Delatin + official 3DHP water polygons';

      let fpsFrames = 0;
      let fpsStart = performance.now();

      const draw = () => {
        if (
          disposed ||
          !renderer ||
          !controls
        ) {
          return;
        }

        controls.update();
        renderer.render(scene, camera);

        fpsFrames++;

        const now = performance.now();

        if (now - fpsStart >= 500) {
          fps =
            (fpsFrames * 1000) /
            (now - fpsStart);
          fpsFrames = 0;
          fpsStart = now;
        }

        frame = requestAnimationFrame(draw);
      };

      draw();

      return () =>
        window.removeEventListener(
          'resize',
          resize
        );
    };

    let removeResize:
      | (() => void)
      | undefined;

    start()
      .then((cleanup) => {
        removeResize = cleanup;
      })
      .catch((error) => {
        console.error(error);
        message = String(error);
      });

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      removeResize?.();

      controls?.dispose();

      terrainGeometry?.dispose();
      terrainMaterial?.dispose();

      waterGeometry?.dispose();
      waterMaterial?.dispose();
      waterTexture?.dispose();

      renderer?.dispose();
      renderer?.domElement.remove();
    };
  });

  function rasterizeWater(
    features: ArcFeature[],
    minE: number,
    minN: number,
    maxE: number,
    maxN: number,
    size: number
  ): Uint8Array {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;

    const ctx = canvas.getContext('2d', {
      willReadFrequently: true
    });

    if (!ctx) {
      throw new Error('Could not create water-mask canvas');
    }

    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = '#ffffff';

    const spanE = maxE - minE;
    const spanN = maxN - minN;

    for (const feature of features) {
      const rings = feature.geometry?.rings;
      if (!rings?.length) continue;

      const path = new Path2D();

      for (const ring of rings) {
        if (ring.length < 3) continue;

        for (let i = 0; i < ring.length; i++) {
          const [e, n] = ring[i];

          const x =
            ((e - minE) / spanE) *
            (size - 1);

          // Raster row zero / terrain row zero are north.
          const y =
            ((maxN - n) / spanN) *
            (size - 1);

          if (i === 0) {
            path.moveTo(x, y);
          } else {
            path.lineTo(x, y);
          }
        }

        path.closePath();
      }

      // ArcGIS rings can contain holes.
      ctx.fill(path, 'evenodd');
    }

    const rgba = ctx.getImageData(
      0,
      0,
      size,
      size
    ).data;

    const mask = new Uint8Array(size * size);

    for (let i = 0; i < mask.length; i++) {
      mask[i] = rgba[i * 4 + 3] > 127
        ? 255
        : 0;
    }

    return mask;
  }

  function applyWaterMask(
    material: THREE.MeshStandardMaterial,
    texture: THREE.DataTexture,
    terrainSizeM: number,
    drawWater: boolean
  ) {
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uWaterMask = {
        value: texture
      };

      shader.uniforms.uTerrainSize = {
        value: terrainSizeM
      };

      shader.vertexShader =
        shader.vertexShader.replace(
          '#include <common>',
          `
#include <common>
varying vec3 vWaterMaskWorldPosition;
          `
        );

      shader.vertexShader =
        shader.vertexShader.replace(
          '#include <begin_vertex>',
          `
#include <begin_vertex>
vWaterMaskWorldPosition =
  (modelMatrix * vec4(transformed, 1.0)).xyz;
          `
        );

      shader.fragmentShader =
        shader.fragmentShader.replace(
          '#include <common>',
          `
#include <common>
uniform sampler2D uWaterMask;
uniform float uTerrainSize;
varying vec3 vWaterMaskWorldPosition;
          `
        );

      const test = drawWater
        ? 'if (waterMaskValue < 0.5) discard;'
        : 'if (waterMaskValue >= 0.5) discard;';

      shader.fragmentShader =
        shader.fragmentShader.replace(
          '#include <clipping_planes_fragment>',
          `
#include <clipping_planes_fragment>

vec2 waterMaskUv =
  (vWaterMaskWorldPosition.xz +
    vec2(uTerrainSize * 0.5)) /
  uTerrainSize;

if (
  waterMaskUv.x < 0.0 ||
  waterMaskUv.x > 1.0 ||
  waterMaskUv.y < 0.0 ||
  waterMaskUv.y > 1.0
) {
  discard;
}

float waterMaskValue =
  texture2D(
    uWaterMask,
    waterMaskUv
  ).r;

${test}
          `
        );
    };

    material.customProgramCacheKey = () =>
      drawWater
        ? '3dhp-water-mask-water-v1'
        : '3dhp-water-mask-terrain-v1';
  }
</script>

<svelte:head>
  <title>3DEP → Delatin + 3DHP shoreline</title>
</svelte:head>

<div class="viewer" bind:this={host}></div>

<div class="hud">
  <strong>{message}</strong>

  <span>
    USGS 3DEP · San Francisco · fixed {SPACING_M} m source
  </span>

  <span>
    Delatin max error: {MAX_ERROR_M} m · static mesh · NO distance LOD
  </span>

  <span>
    3DHP vector water: {waterFeatures} features · mask water {(
      (waterPixels / (SIDE * SIDE)) *
      100
    ).toFixed(1)}%
  </span>

  <span>
    {fps.toFixed(0)} fps ·
    {Math.round(triangles / 1000)}k triangles ·
    {Math.round(vertices / 1000)}k Delatin vertices
  </span>

  <span>
    height: {minHeight.toFixed(1)} to
    {maxHeight.toFixed(1)} m · build
    {buildMs.toFixed(0)} ms
  </span>
</div>

<style>
  :global(*) {
    box-sizing: border-box;
  }

  :global(html, body) {
    margin: 0;
    width: 100%;
    height: 100%;
    overflow: hidden;
  }

  :global(body) {
    font-family: system-ui, sans-serif;
    background: #111;
  }

  .viewer {
    position: fixed;
    inset: 0;
  }

  .viewer :global(canvas) {
    display: block;
    width: 100%;
    height: 100%;
  }

  .hud {
    position: fixed;
    z-index: 10;
    top: 16px;
    left: 16px;
    display: grid;
    gap: 4px;
    padding: 12px 14px;
    border-radius: 10px;
    background: #111c;
    color: white;
    font-size: 12px;
    pointer-events: none;
  }

  .hud strong {
    font-size: 13px;
  }

  .hud span {
    color: #ffffffaa;
  }
</style>
