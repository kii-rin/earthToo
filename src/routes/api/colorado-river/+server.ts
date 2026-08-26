import type { RequestHandler } from './$types';
import {
  TERRAIN_SIZE_M,
  TERRAIN_ORIGIN_E,
  TERRAIN_ORIGIN_N
} from '$lib/game/TerrainRegionSource';

const COLORADO_RIVER_LAYER =
  'https://grandcanyon.usgs.gov/server/rest/services/BaseLayers/GrandCanyonBaseLayers/MapServer/4/query';
const CLIP_MARGIN_M = 250;

let memoryCache: string | null = null;

type ArcGisPolyline = {
  paths?: number[][][];
};

type ArcGisFeature = {
  geometry?: ArcGisPolyline;
};

type ArcGisResponse = {
  error?: { message?: string; details?: string[] };
  features?: ArcGisFeature[];
};

export const GET: RequestHandler = async ({ fetch }) => {
  if (memoryCache) return jsonResponse(memoryCache, true);

  const half = TERRAIN_SIZE_M / 2;
  const minE = TERRAIN_ORIGIN_E - half;
  const maxE = TERRAIN_ORIGIN_E + half;
  const minN = TERRAIN_ORIGIN_N - half;
  const maxN = TERRAIN_ORIGIN_N + half;

  const url = new URL(COLORADO_RIVER_LAYER);
  url.searchParams.set('where', '1=1');
  url.searchParams.set('geometry', `${minE},${minN},${maxE},${maxN}`);
  url.searchParams.set('geometryType', 'esriGeometryEnvelope');
  url.searchParams.set('inSR', '32612');
  url.searchParams.set('spatialRel', 'esriSpatialRelIntersects');
  url.searchParams.set('outFields', 'objectid');
  url.searchParams.set('returnGeometry', 'true');
  url.searchParams.set('returnM', 'false');
  url.searchParams.set('outSR', '32612');
  url.searchParams.set('f', 'json');

  let upstream: Response;
  try {
    upstream = await fetch(url.toString(), {
      headers: { Accept: 'application/json' }
    });
  } catch (error) {
    return new Response(`USGS river request failed: ${String(error)}`, { status: 502 });
  }

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => '');
    return new Response(
      `USGS river source returned ${upstream.status}: ${text.slice(0, 300)}`,
      { status: 502 }
    );
  }

  let data: ArcGisResponse;
  try {
    data = await upstream.json() as ArcGisResponse;
  } catch (error) {
    return new Response(`Unable to decode USGS river geometry: ${String(error)}`, { status: 502 });
  }

  if (data.error) {
    const detail = [data.error.message, ...(data.error.details ?? [])].filter(Boolean).join(' ');
    return new Response(`USGS river query failed: ${detail}`, { status: 502 });
  }

  const clip = half + CLIP_MARGIN_M;
  const lines: [number, number][][] = [];

  for (const feature of data.features ?? []) {
    for (const path of feature.geometry?.paths ?? []) {
      const local = path
        .map((point): [number, number] => [
          point[0] - TERRAIN_ORIGIN_E,
          TERRAIN_ORIGIN_N - point[1]
        ])
        .filter(([x, z]) => Number.isFinite(x) && Number.isFinite(z));

      const clipped = clipLineToRegion(local, clip);
      for (const line of clipped) {
        if (line.length >= 2) lines.push(line);
      }
    }
  }

  const body = JSON.stringify({
    source: 'USGS GCMRC Colorado River centerline',
    lines
  });

  memoryCache = body;
  return jsonResponse(body, false);
};

function clipLineToRegion(
  line: [number, number][],
  halfExtent: number
): [number, number][][] {
  const output: [number, number][][] = [];
  let current: [number, number][] = [];

  for (const point of line) {
    const inside = Math.abs(point[0]) <= halfExtent && Math.abs(point[1]) <= halfExtent;
    if (inside) {
      current.push(point);
    } else if (current.length > 0) {
      if (current.length >= 2) output.push(current);
      current = [];
    }
  }

  if (current.length >= 2) output.push(current);
  return output;
}

function jsonResponse(body: string, hit: boolean): Response {
  return new Response(body, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=86400',
      'X-Water-Source': 'USGS-GCMRC',
      'X-Memory-Cache': hit ? 'hit' : 'miss'
    }
  });
}
