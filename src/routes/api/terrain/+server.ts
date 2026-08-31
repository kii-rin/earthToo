import { fromArrayBuffer } from 'geotiff';
import type { RequestHandler } from './$types';
import {
  TERRAIN_HEIGHT_UNIT_M,
  terrainSide,
  terrainSizeM,
  terrainZone,
  type TerrainZone
} from '$lib/game/zones';

const USGS_3DEP =
  'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage';
const memoryCache = new Map<string, Uint8Array>();

export const GET: RequestHandler = async ({ fetch, url }) => {
  const zone = terrainZone(url.searchParams.get('zone'));
  if (!zone) return new Response('Unknown terrain zone', { status: 404 });

  const cached = memoryCache.get(zone.id);
  if (cached) return binaryResponse(cached, zone, true);

  try {
    const values = await loadElevation(zone, fetch);
    const bytes = encodeTerrain(values);
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
  const requestUrl = new URL(USGS_3DEP);

  requestUrl.searchParams.set(
    'bbox',
    `${zone.originE - half - pad},${zone.originN - half - pad},${zone.originE + half + pad},${zone.originN + half + pad}`
  );
  requestUrl.searchParams.set('bboxSR', String(zone.epsg));
  requestUrl.searchParams.set('imageSR', String(zone.epsg));
  requestUrl.searchParams.set('size', `${side},${side}`);
  requestUrl.searchParams.set('format', 'tiff');
  requestUrl.searchParams.set('pixelType', 'F32');
  requestUrl.searchParams.set('interpolation', 'RSP_BilinearInterpolation');
  requestUrl.searchParams.set('f', 'image');

  const upstream = await fetcher(requestUrl.toString(), {
    headers: { Accept: 'image/tiff,*/*;q=0.8' }
  });
  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => '');
    throw new Error(`Terrain source returned ${upstream.status}: ${detail.slice(0, 400)}`);
  }

  const tiff = await fromArrayBuffer(await upstream.arrayBuffer());
  const image = await tiff.getImage();
  if (image.getWidth() !== side || image.getHeight() !== side) {
    throw new Error(
      `Unexpected terrain raster ${image.getWidth()}x${image.getHeight()}; wanted ${side}x${side}`
    );
  }

  const raster = await image.readRasters({ interleave: true });
  const source = raster as unknown as ArrayLike<number>;
  const noData = image.getGDALNoData();
  const values = new Float32Array(side * side);

  for (let i = 0; i < values.length; i++) {
    const value = Number(source[i]);
    const invalid =
      !Number.isFinite(value) ||
      (noData !== null && Number.isFinite(noData) && Math.abs(value - noData) < 1e-5);
    values[i] = invalid ? 0 : value;
  }

  return values;
}

function encodeTerrain(values: Float32Array): Uint8Array {
  const bytes = new Uint8Array(values.length * Int16Array.BYTES_PER_ELEMENT);
  const view = new DataView(bytes.buffer);
  const minimum = -32768 * TERRAIN_HEIGHT_UNIT_M;
  const maximum = 32767 * TERRAIN_HEIGHT_UNIT_M;

  for (let i = 0; i < values.length; i++) {
    const meters = Math.min(maximum, Math.max(minimum, values[i]));
    view.setInt16(i * 2, Math.round(meters / TERRAIN_HEIGHT_UNIT_M), true);
  }

  return bytes;
}

function binaryResponse(bytes: Uint8Array, zone: TerrainZone, hit: boolean): Response {
  return new Response(bytes.slice().buffer, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Cache-Control': 'public, max-age=86400',
      'X-Terrain-Source': 'USGS-3DEP',
      'X-Terrain-Zone': zone.id,
      'X-Memory-Cache': hit ? 'hit' : 'miss'
    }
  });
}
