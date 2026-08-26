export const TERRAIN_SPACING_M = 10;
export const TERRAIN_SEGMENTS = 2048;
export const TERRAIN_SIDE = TERRAIN_SEGMENTS + 1;
export const TERRAIN_SIZE_M = TERRAIN_SEGMENTS * TERRAIN_SPACING_M;
export const TERRAIN_HEIGHT_UNIT_M = 0.5;

export const TERRAIN_ORIGIN_E = 399_470.30152241024;
export const TERRAIN_ORIGIN_N = 3_991_656.860017819;

export type TerrainRegion = {
  side: number;
  segments: number;
  spacingM: number;
  sizeM: number;
  values: Float32Array;
};

export class TerrainRegionSource {
  private loaded: TerrainRegion | null = null;

  async load(): Promise<TerrainRegion> {
    if (this.loaded) return this.loaded;

    const response = await fetch('/api/terrain', { cache: 'force-cache' });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Terrain source failed: ${response.status} ${detail}`);
    }

    const buffer = await response.arrayBuffer();
    const expectedBytes = TERRAIN_SIDE * TERRAIN_SIDE * Int16Array.BYTES_PER_ELEMENT;
    if (buffer.byteLength !== expectedBytes) {
      throw new Error(
        `Unexpected terrain payload: ${buffer.byteLength} bytes; expected ${expectedBytes}`
      );
    }

    const view = new DataView(buffer);
    const values = new Float32Array(TERRAIN_SIDE * TERRAIN_SIDE);

    for (let i = 0; i < values.length; i++) {
      values[i] = view.getInt16(i * 2, true) * TERRAIN_HEIGHT_UNIT_M;
    }

    this.loaded = {
      side: TERRAIN_SIDE,
      segments: TERRAIN_SEGMENTS,
      spacingM: TERRAIN_SPACING_M,
      sizeM: TERRAIN_SIZE_M,
      values
    };

    return this.loaded;
  }

  sampleLocal(localX: number, localZ: number): number | null {
    const region = this.loaded;
    if (!region) return null;

    const half = region.sizeM / 2;
    const u = (localX + half) / region.sizeM;
    const v = (localZ + half) / region.sizeM;
    if (u < 0 || u > 1 || v < 0 || v > 1) return null;

    const px = u * region.segments;
    const py = v * region.segments;
    const x0 = Math.floor(px);
    const y0 = Math.floor(py);
    const x1 = Math.min(region.segments, x0 + 1);
    const y1 = Math.min(region.segments, y0 + 1);
    const tx = px - x0;
    const ty = py - y0;
    const s = region.side;

    const top = region.values[y0 * s + x0] * (1 - tx)
      + region.values[y0 * s + x1] * tx;
    const bottom = region.values[y1 * s + x0] * (1 - tx)
      + region.values[y1 * s + x1] * tx;

    return top * (1 - ty) + bottom * ty;
  }
}
