export const REGION_SIZE_M = 16384;
export const REGION_SEGMENTS = 2048;
export const REGION_SIDE = REGION_SEGMENTS + 1;

// Yavapai Point / South Rim — same canonical UTM origin used by the earlier prototype.
export const START_UTM_E = 399_470.30152241024;
export const START_UTM_N = 3_991_656.860017819;

export type TerrainRegion = {
  side: number;
  segments: number;
  sizeM: number;
  values: Float32Array;
};

export class TerrainRegionSource {
  private loaded: TerrainRegion | null = null;

  async load(): Promise<TerrainRegion> {
    if (this.loaded) return this.loaded;

    const response = await fetch(
      `/api/usgs-region?segments=${REGION_SEGMENTS}&size=${REGION_SIZE_M}`,
      { cache: 'force-cache' }
    );

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`USGS region failed: ${response.status} ${detail}`);
    }

    const buffer = await response.arrayBuffer();
    const expected = REGION_SIDE * REGION_SIDE * 2;
    if (buffer.byteLength !== expected) {
      throw new Error(`Unexpected terrain payload: ${buffer.byteLength} bytes; expected ${expected}`);
    }

    const view = new DataView(buffer);
    const values = new Float32Array(REGION_SIDE * REGION_SIDE);

    for (let i = 0; i < values.length; i++) {
      const q = view.getInt16(i * 2, true);
      values[i] = q === -32768 ? 0 : q / 10;
    }

    this.loaded = {
      side: REGION_SIDE,
      segments: REGION_SEGMENTS,
      sizeM: REGION_SIZE_M,
      values
    };
    return this.loaded;
  }

  sampleLocal(localX: number, localZ: number): number | null {
    if (!this.loaded) return null;
    const region = this.loaded;
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

    const a = region.values[y0 * s + x0] * (1 - tx)
      + region.values[y0 * s + x1] * tx;
    const b = region.values[y1 * s + x0] * (1 - tx)
      + region.values[y1 * s + x1] * tx;

    return a * (1 - ty) + b * ty;
  }
}
