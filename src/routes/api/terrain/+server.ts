import { fromArrayBuffer } from 'geotiff';
import type { RequestHandler } from './$types';
import {
  TERRAIN_HEIGHT_UNIT_M,
  terrainSide,
  terrainSizeM,
  terrainZone,
  type TerrainZone
} from '$lib/game/zones';
import type { TerrainWaterBody } from '$lib/game/TerrainRegionSource';

const USGS_3DEP =
  'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage';
const USGS_3DHP_WATER = [
  'https://3dhp.nationalmap.gov/arcgis/rest/services/usgs_3dhp_all/FeatureServer/60/query',
  'https://hydro.nationalmap.gov/arcgis/rest/services/3DHP_all/FeatureServer/60/query'
];
const memoryCache = new Map<string, Uint8Array>();

export const GET: RequestHandler = async ({ fetch, url }) => {
  const zone = terrainZone(url.searchParams.get('zone'));
  if (!zone) return new Response('Unknown terrain zone', { status: 404 });

  const cached = memoryCache.get(zone.id);
  if (cached) return binaryResponse(cached, zone, true);

  try {
    const side = terrainSide(zone);
    const raw = await loadElevation(zone, fetch);
    const waterBodies = zone.hydroLakes ? await loadAndApplyLakes(zone, raw, fetch) : [];
    const terrainBytes = encodeTerrain(raw, side);
    const waterBytes = new TextEncoder().encode(JSON.stringify(waterBodies));
    const bytes = new Uint8Array(terrainBytes.byteLength + waterBytes.byteLength);
    bytes.set(terrainBytes, 0);
    bytes.set(waterBytes, terrainBytes.byteLength);
    memoryCache.set(zone.id, bytes);
    return binaryResponse(bytes, zone, false);
  } catch (error) {
    return new Response(String(error), { status: 502 });
  }
};

async function loadElevation(zone: TerrainZone, fetcher: typeof fetch): Promise<Float32Array> {
  const side = terrainSide(zone);
  const sizeM = terrainSizeM(zone);
  const half = sizeM / 2;
  const pad = zone.spacingM / 2;
  const minE = zone.originE - half - pad;
  const maxE = zone.originE + half + pad;
  const minN = zone.originN - half - pad;
  const maxN = zone.originN + half + pad;

  const requestUrl = new URL(USGS_3DEP);
  requestUrl.searchParams.set('bbox', `${minE},${minN},${maxE},${maxN}`);
  requestUrl.searchParams.set('bboxSR', String(zone.epsg));
  requestUrl.searchParams.set('imageSR', String(zone.epsg));
  requestUrl.searchParams.set('size', `${side},${side}`);
  requestUrl.searchParams.set('format', 'tiff');
  requestUrl.searchParams.set('pixelType', 'F32');
  requestUrl.searchParams.set('interpolation', 'RSP_BilinearInterpolation');
  requestUrl.searchParams.set('f', 'image');

  let upstream: Response;
  try {
    upstream = await fetcher(requestUrl.toString(), { headers: { Accept: 'image/tiff,*/*;q=0.8' } });
  } catch (error) {
    throw new Error(`Terrain request failed: ${String(error)}`);
  }

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => '');
    throw new Error(`Terrain source returned ${upstream.status}: ${detail.slice(0, 400)}`);
  }

  const tiff = await fromArrayBuffer(await upstream.arrayBuffer());
  const image = await tiff.getImage();
  if (image.getWidth() !== side || image.getHeight() !== side) {
    throw new Error(`Unexpected terrain raster ${image.getWidth()}x${image.getHeight()}; wanted ${side}x${side}`);
  }

  const raster = await image.readRasters({ interleave: true });
  const source = raster as unknown as ArrayLike<number>;
  const noData = image.getGDALNoData();
  const values = new Float32Array(side * side);
  const offset = zone.heightOffsetM ?? 0;

  for (let i = 0; i < values.length; i++) {
    const raw = Number(source[i]);
    const invalid =
      !Number.isFinite(raw) ||
      (noData !== null && Number.isFinite(noData) && Math.abs(raw - noData) < 1e-5);
    const oceanZero = zone.oceanFloorM !== undefined && Number.isFinite(raw) && Math.abs(raw) < 0.01;

    if (invalid && zone.oceanFloorM === undefined) throw new Error(`Terrain source contains invalid elevation at sample ${i}`);
    values[i] = invalid || oceanZero ? zone.oceanFloorM! : raw + offset;
  }

  return values;
}

async function loadAndApplyLakes(
  zone: TerrainZone,
  values: Float32Array,
  fetcher: typeof fetch
): Promise<TerrainWaterBody[]> {
  let features: EsriFeature[];
  try {
    features = await fetchLakeFeatures(zone, fetcher);
  } catch (error) {
    console.warn(`USGS 3DHP unavailable for ${zone.id}:`, error);
    return [];
  }

  const side = terrainSide(zone);
  const sizeM = terrainSizeM(zone);
  const half = sizeM / 2;
  const west = zone.originE - half;
  const north = zone.originN + half;
  const fullDepthM = zone.syntheticWaterDepthM ?? 20;
  const shoreDepthM = Math.min(fullDepthM, zone.waterShoreDepthM ?? 10);
  const taperCells = Math.max(1, Math.round(zone.waterTaperCells ?? 2));
  const result: TerrainWaterBody[] = [];

  for (const feature of features) {
    const rings = feature.geometry?.rings;
    if (!rings?.length) continue;

    const bounds = ringBounds(rings);
    const x0 = clampIndex(Math.floor((bounds.minX - west) / zone.spacingM), side);
    const x1 = clampIndex(Math.ceil((bounds.maxX - west) / zone.spacingM), side);
    const y0 = clampIndex(Math.floor((north - bounds.maxY) / zone.spacingM), side);
    const y1 = clampIndex(Math.ceil((north - bounds.minY) / zone.spacingM), side);
    const width = x1 - x0 + 1;
    const height = y1 - y0 + 1;
    if (width <= 0 || height <= 0) continue;

    const mask = new Uint8Array(width * height);
    const surfaceSamples: number[] = [];
    let insideCount = 0;

    for (let localY = 0; localY < height; localY++) {
      const y = y0 + localY;
      const n = north - y * zone.spacingM;
      for (let localX = 0; localX < width; localX++) {
        const x = x0 + localX;
        const e = west + x * zone.spacingM;
        if (!pointInPolygon(e, n, rings)) continue;

        const localIndex = localY * width + localX;
        const terrainIndex = y * side + x;
        const h = values[terrainIndex];
        if (!Number.isFinite(h)) continue;

        mask[localIndex] = 1;
        insideCount++;
        surfaceSamples.push(h);
      }
    }

    if (insideCount < 4) continue;
    const levelM = flattenedSurfaceLevel(surfaceSamples);
    if (!Number.isFinite(levelM)) {
      console.warn(`Skipping non-flat 3DHP waterbody ${waterBodyId(feature)} in ${zone.id}`);
      continue;
    }

    const distance = inwardDistance(mask, width, height, taperCells);
    for (let localY = 0; localY < height; localY++) {
      const y = y0 + localY;
      for (let localX = 0; localX < width; localX++) {
        const localIndex = localY * width + localX;
        if (!mask[localIndex]) continue;

        const layer = distance[localIndex];
        const t = taperCells <= 1
          ? 1
          : Math.min(1, Math.max(0, (layer - 1) / (taperCells - 1)));
        const depthM = shoreDepthM + (fullDepthM - shoreDepthM) * t;
        values[y * side + x0 + localX] = levelM - depthM;
      }
    }

    const workUnit = String(feature.attributes?.workunitid ?? '');
    if (workUnit.toUpperCase().startsWith('NHD')) {
      console.warn(`3DHP waterbody ${waterBodyId(feature)} uses legacy NHD geometry`);
    }

    result.push({
      id: waterBodyId(feature),
      name: String(feature.attributes?.gnisidlabel ?? ''),
      levelM,
      rings: rings.map((ring) => ring.map((point) => [
        point[0] - zone.originE,
        zone.originN - point[1]
      ] as [number, number]))
    });
  }

  return result;
}

async function fetchLakeFeatures(zone: TerrainZone, fetcher: typeof fetch): Promise<EsriFeature[]> {
  let lastError: unknown = null;

  for (const endpoint of USGS_3DHP_WATER) {
    try {
      const all: EsriFeature[] = [];
      const pageSize = 2500;
      let offset = 0;

      while (true) {
        const sizeM = terrainSizeM(zone);
        const half = sizeM / 2;
        const requestUrl = new URL(endpoint);
        requestUrl.searchParams.set('where', 'featuretype=3');
        requestUrl.searchParams.set(
          'geometry',
          `${zone.originE - half},${zone.originN - half},${zone.originE + half},${zone.originN + half}`
        );
        requestUrl.searchParams.set('geometryType', 'esriGeometryEnvelope');
        requestUrl.searchParams.set('inSR', String(zone.epsg));
        requestUrl.searchParams.set('spatialRel', 'esriSpatialRelIntersects');
        requestUrl.searchParams.set(
          'outFields',
          'OBJECTID,id3dhp,gnisidlabel,areasqkm,workunitid'
        );
        requestUrl.searchParams.set('returnGeometry', 'true');
        requestUrl.searchParams.set('returnZ', 'false');
        requestUrl.searchParams.set('returnTrueCurves', 'false');
        requestUrl.searchParams.set('outSR', String(zone.epsg));
        requestUrl.searchParams.set('orderByFields', 'OBJECTID');
        requestUrl.searchParams.set('resultOffset', String(offset));
        requestUrl.searchParams.set('resultRecordCount', String(pageSize));
        requestUrl.searchParams.set('f', 'json');

        const response = await fetcher(requestUrl.toString(), {
          headers: { Accept: 'application/json' }
        });
        if (!response.ok) throw new Error(`USGS 3DHP returned ${response.status}`);

        const payload = await response.json() as EsriResponse;
        if (payload.error) {
          throw new Error(`USGS 3DHP error ${payload.error.code}: ${payload.error.message}`);
        }

        const page = payload.features ?? [];
        all.push(...page);
        if (!payload.exceededTransferLimit && page.length < pageSize) break;
        if (page.length === 0) break;
        offset += page.length;
      }

      const minimumArea = zone.minWaterAreaKm2 ?? 0;
      return all.filter((feature) => {
        const area = Number(feature.attributes?.areasqkm);
        return !Number.isFinite(area) || area >= minimumArea;
      });
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('USGS 3DHP unavailable');
}

function inwardDistance(
  mask: Uint8Array,
  width: number,
  height: number,
  maxDistance: number
): Uint8Array {
  const distance = new Uint8Array(mask.length);
  const queue = new Int32Array(mask.length);
  let head = 0;
  let tail = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!mask[i]) continue;
      if (
        x === 0 || y === 0 || x === width - 1 || y === height - 1 ||
        !mask[i - 1] || !mask[i + 1] || !mask[i - width] || !mask[i + width]
      ) {
        distance[i] = 1;
        queue[tail++] = i;
      }
    }
  }

  const tryEnqueue = (index: number, nextDistance: number): void => {
    if (!mask[index] || distance[index] !== 0) return;
    distance[index] = nextDistance;
    queue[tail++] = index;
  };

  while (head < tail) {
    const i = queue[head++];
    const d = distance[i];
    if (d >= maxDistance) continue;

    const x = i % width;
    const y = Math.floor(i / width);
    const next = d + 1;
    if (x > 0) tryEnqueue(i - 1, next);
    if (x + 1 < width) tryEnqueue(i + 1, next);
    if (y > 0) tryEnqueue(i - width, next);
    if (y + 1 < height) tryEnqueue(i + width, next);
  }

  for (let i = 0; i < mask.length; i++) {
    if (mask[i] && distance[i] === 0) distance[i] = maxDistance;
  }
  return distance;
}

function waterBodyId(feature: EsriFeature): string {
  return String(feature.attributes?.id3dhp ?? feature.attributes?.OBJECTID ?? 'unknown');
}

function encodeTerrain(values: Float32Array, side: number): Uint8Array {
  const bytes = new Uint8Array(side * side * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < values.length; i++) {
    const quantized = Math.round(values[i] / TERRAIN_HEIGHT_UNIT_M);
    if (quantized < -32768 || quantized > 32767) throw new Error(`Terrain elevation out of int16 range at sample ${i}`);
    view.setInt16(i * 2, quantized, true);
  }
  return bytes;
}

function pointInPolygon(x: number, y: number, rings: number[][][]): boolean {
  let inside = false;
  for (const ring of rings) if (pointInRing(x, y, ring)) inside = !inside;
  return inside;
}

function pointInRing(x: number, y: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    if (((yi > y) !== (yj > y)) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function ringBounds(rings: number[][][]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const ring of rings) {
    for (const point of ring) {
      minX = Math.min(minX, point[0]);
      minY = Math.min(minY, point[1]);
      maxX = Math.max(maxX, point[0]);
      maxY = Math.max(maxY, point[1]);
    }
  }
  return { minX, minY, maxX, maxY };
}

function clampIndex(value: number, side: number): number {
  return Math.max(0, Math.min(side - 1, value));
}

function flattenedSurfaceLevel(values: number[]): number {
  if (values.length < 4) return NaN;

  const bins = new Map<number, number>();
  for (const value of values) {
    const key = Math.round(value * 2);
    bins.set(key, (bins.get(key) ?? 0) + 1);
  }

  let dominantKey = 0;
  let dominantCount = -1;
  for (const [key, count] of bins) {
    if (count > dominantCount) {
      dominantKey = key;
      dominantCount = count;
    }
  }

  const dominantM = dominantKey / 2;
  const near = values.filter((value) => Math.abs(value - dominantM) <= 1);
  const minimumFlatSamples = Math.max(4, Math.ceil(values.length * 0.2));
  if (near.length < minimumFlatSamples) return NaN;

  near.sort((a, b) => a - b);
  const middle = Math.floor(near.length / 2);
  return near.length % 2
    ? near[middle]
    : (near[middle - 1] + near[middle]) / 2;
}

function binaryResponse(bytes: Uint8Array, zone: TerrainZone, hit: boolean): Response {
  return new Response(bytes.slice().buffer, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(bytes.byteLength),
      'Cache-Control': 'no-store',
      'X-Terrain-Zone': zone.id,
      'X-Terrain-Source': zone.hydroLakes ? 'USGS-3DEP+3DHP' : 'USGS-3DEP',
      'X-Terrain-Spacing-M': String(zone.spacingM),
      'X-Terrain-Height-Unit-M': String(TERRAIN_HEIGHT_UNIT_M),
      'X-Memory-Cache': hit ? 'hit' : 'miss'
    }
  });
}

type EsriResponse = {
  features?: EsriFeature[];
  exceededTransferLimit?: boolean;
  error?: { code: number; message: string };
};

type EsriFeature = {
  attributes?: Record<string, unknown>;
  geometry?: { rings?: number[][][] };
};
