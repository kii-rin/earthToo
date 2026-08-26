import * as THREE from 'three/webgpu';
import Delatin from 'delatin';
import type { TerrainRegion } from './TerrainRegionSource';

export type TerrainMeshStats = {
  triangles: number;
  vertices: number;
  maxError: number;
  rmsd: number;
  buildMs: number;
};

export class AdaptiveTerrain {
  mesh: THREE.Mesh | null = null;
  private trianglePositions: Float32Array | null = null;
  private spatialBins: number[][] = [];
  private spatialGridSize = 96;
  private regionHalf = 0;
  private regionSize = 0;
  stats: TerrainMeshStats = {
    triangles: 0,
    vertices: 0,
    maxError: 0,
    rmsd: 0,
    buildMs: 0
  };

  constructor(private readonly scene: THREE.Scene) {}

  rebuild(region: TerrainRegion, maxErrorM: number): TerrainMeshStats {
    const start = performance.now();

    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      (this.mesh.material as THREE.Material).dispose();
      this.mesh = null;
    }

    const tin = new Delatin(region.values, region.side, region.side);
    tin.run(maxErrorM);

    const coords = tin.coords;
    const tris = tin.triangles;
    const triangleCount = tris.length / 3;
    const positions = new Float32Array(triangleCount * 9);
    const colors = new Float32Array(triangleCount * 9);

    const half = region.sizeM / 2;
    const step = region.sizeM / region.segments;
    const c = new THREE.Color();

    let out = 0;

    for (let t = 0; t < tris.length; t += 3) {
      const i0 = tris[t];
      const i1 = tris[t + 1];
      const i2 = tris[t + 2];

      const x0p = coords[i0 * 2];
      const y0p = coords[i0 * 2 + 1];
      const x1p = coords[i1 * 2];
      const y1p = coords[i1 * 2 + 1];
      const x2p = coords[i2 * 2];
      const y2p = coords[i2 * 2 + 1];

      const h0 = tin.heightAt(x0p, y0p);
      const h1 = tin.heightAt(x1p, y1p);
      const h2 = tin.heightAt(x2p, y2p);

      const ax = x0p * step - half;
      const az = y0p * step - half;
      const bx = x1p * step - half;
      const bz = y1p * step - half;
      const cx = x2p * step - half;
      const cz = y2p * step - half;

      positions[out] = ax;
      positions[out + 1] = h0;
      positions[out + 2] = az;
      positions[out + 3] = bx;
      positions[out + 4] = h1;
      positions[out + 5] = bz;
      positions[out + 6] = cx;
      positions[out + 7] = h2;
      positions[out + 8] = cz;

      const abx = bx - ax;
      const aby = h1 - h0;
      const abz = bz - az;
      const acx = cx - ax;
      const acy = h2 - h0;
      const acz = cz - az;

      const nx = aby * acz - abz * acy;
      const ny = abz * acx - abx * acz;
      const nz = abx * acy - aby * acx;
      const normalLen = Math.hypot(nx, ny, nz) || 1;
      const up = Math.abs(ny / normalLen);
      const slope = Math.acos(THREE.MathUtils.clamp(up, 0, 1));
      const avgH = (h0 + h1 + h2) / 3;

      canyonFaceColor(avgH, slope, c);

      for (let v = 0; v < 3; v++) {
        const ci = out + v * 3;
        colors[ci] = c.r;
        colors[ci + 1] = c.g;
        colors[ci + 2] = c.b;
      }

      out += 9;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();

    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      flatShading: true,
      roughness: 1.0,
      metalness: 0.0
    });
    material.dithering = true;

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'adaptive-real-earth-terrain';
    mesh.frustumCulled = true;
    mesh.castShadow = false;
    mesh.receiveShadow = false;

    this.scene.add(mesh);
    this.mesh = mesh;
    this.trianglePositions = positions;
    this.regionHalf = region.sizeM / 2;
    this.regionSize = region.sizeM;
    this.buildSpatialIndex(positions);

    this.stats = {
      triangles: triangleCount,
      vertices: coords.length / 2,
      maxError: tin.getMaxError(),
      rmsd: tin.getRMSD(),
      buildMs: performance.now() - start
    };
    return this.stats;
  }

  sampleRenderedHeight(localX: number, localZ: number): number | null {
    const positions = this.trianglePositions;
    if (!positions || this.regionSize <= 0 || this.spatialBins.length === 0) return null;

    const u = (localX + this.regionHalf) / this.regionSize;
    const v = (localZ + this.regionHalf) / this.regionSize;
    if (u < 0 || u > 1 || v < 0 || v > 1) return null;

    const gx = Math.min(this.spatialGridSize - 1, Math.max(0, Math.floor(u * this.spatialGridSize)));
    const gy = Math.min(this.spatialGridSize - 1, Math.max(0, Math.floor(v * this.spatialGridSize)));
    const bucket = this.spatialBins[gy * this.spatialGridSize + gx];
    if (!bucket) return null;

    for (const tri of bucket) {
      const o = tri * 9;
      const ax = positions[o], ay = positions[o + 1], az = positions[o + 2];
      const bx = positions[o + 3], by = positions[o + 4], bz = positions[o + 5];
      const cx = positions[o + 6], cy = positions[o + 7], cz = positions[o + 8];

      const h = barycentricHeight(localX, localZ, ax, az, ay, bx, bz, by, cx, cz, cy);
      if (h !== null) return h;
    }
    return null;
  }

  private buildSpatialIndex(positions: Float32Array): void {
    const g = this.spatialGridSize;
    this.spatialBins = Array.from({ length: g * g }, () => [] as number[]);
    const triCount = positions.length / 9;

    for (let tri = 0; tri < triCount; tri++) {
      const o = tri * 9;
      const ax = positions[o], az = positions[o + 2];
      const bx = positions[o + 3], bz = positions[o + 5];
      const cx = positions[o + 6], cz = positions[o + 8];

      const minX = Math.min(ax, bx, cx);
      const maxX = Math.max(ax, bx, cx);
      const minZ = Math.min(az, bz, cz);
      const maxZ = Math.max(az, bz, cz);

      const x0 = Math.max(0, Math.min(g - 1, Math.floor(((minX + this.regionHalf) / this.regionSize) * g)));
      const x1 = Math.max(0, Math.min(g - 1, Math.floor(((maxX + this.regionHalf) / this.regionSize) * g)));
      const y0 = Math.max(0, Math.min(g - 1, Math.floor(((minZ + this.regionHalf) / this.regionSize) * g)));
      const y1 = Math.max(0, Math.min(g - 1, Math.floor(((maxZ + this.regionHalf) / this.regionSize) * g)));

      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          this.spatialBins[y * g + x].push(tri);
        }
      }
    }
  }

  setVisible(visible: boolean): void {
    if (this.mesh) this.mesh.visible = visible;
  }

  dispose(): void {
    if (!this.mesh) return;
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh = null;
    this.trianglePositions = null;
    this.spatialBins = [];
  }
}

function barycentricHeight(
  x: number, z: number,
  ax: number, az: number, ay: number,
  bx: number, bz: number, by: number,
  cx: number, cz: number, cy: number
): number | null {
  const v0x = bx - ax;
  const v0z = bz - az;
  const v1x = cx - ax;
  const v1z = cz - az;
  const v2x = x - ax;
  const v2z = z - az;
  const den = v0x * v1z - v1x * v0z;
  if (Math.abs(den) < 1e-9) return null;
  const wB = (v2x * v1z - v1x * v2z) / den;
  const wC = (v0x * v2z - v2x * v0z) / den;
  const wA = 1 - wB - wC;
  const eps = -1e-5;
  if (wA < eps || wB < eps || wC < eps) return null;
  return ay * wA + by * wB + cy * wC;
}

function canyonFaceColor(height: number, slope: number, out: THREE.Color): void {
  const steep = THREE.MathUtils.smoothstep(slope, 0.32, 1.18);
  const high = THREE.MathUtils.clamp((height - 700) / 1800, 0, 1);

  const low = new THREE.Color(0x9a4529);
  const mid = new THREE.Color(0xb86437);
  const upper = new THREE.Color(0xc99058);
  const rim = new THREE.Color(0xc7a36c);
  const cliff = new THREE.Color(0x5c4938);

  if (high < 0.34) {
    out.copy(low).lerp(mid, high / 0.34);
  } else if (high < 0.72) {
    out.copy(mid).lerp(upper, (high - 0.34) / 0.38);
  } else {
    out.copy(upper).lerp(rim, (high - 0.72) / 0.28);
  }

  out.lerp(cliff, steep * 0.46);
}
