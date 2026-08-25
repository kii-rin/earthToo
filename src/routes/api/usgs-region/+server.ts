import { fromArrayBuffer } from 'geotiff';
import type { RequestHandler } from './$types';
import {
  REGION_SIZE_M,
  REGION_SEGMENTS,
  START_UTM_E,
  START_UTM_N
} from '$lib/game/TerrainRegionSource';

const IMAGE_SERVER =
  'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage';

let memoryCache: Uint8Array | null = null;

export const GET: RequestHandler = async ({ url, fetch }) => {
  const requestedSegments = Number(url.searchParams.get('segments') ?? REGION_SEGMENTS);
  const requestedSize = Number(url.searchParams.get('size') ?? REGION_SIZE_M);

  if (requestedSegments !== REGION_SEGMENTS || requestedSize !== REGION_SIZE_M) {
    return new Response('v0.1 uses the fixed terrain-lab region', { status: 400 });
  }

  if (memoryCache) return binaryResponse(memoryCache, true);

  const samples = REGION_SEGMENTS + 1;
  const half = REGION_SIZE_M / 2;
  const minE = START_UTM_E - half;
  const maxE = START_UTM_E + half;
  const minN = START_UTM_N - half;
  const maxN = START_UTM_N + half;
  const spacing = REGION_SIZE_M / REGION_SEGMENTS;
  const pad = spacing / 2;

  const requestUrl = new URL(IMAGE_SERVER);
  requestUrl.searchParams.set(
    'bbox',
    `${minE - pad},${minN - pad},${maxE + pad},${maxN + pad}`
  );
  requestUrl.searchParams.set('bboxSR', '32612');
  requestUrl.searchParams.set('imageSR', '32612');
  requestUrl.searchParams.set('size', `${samples},${samples}`);
  requestUrl.searchParams.set('format', 'tiff');
  requestUrl.searchParams.set('pixelType', 'F32');
  requestUrl.searchParams.set('interpolation', 'RSP_BilinearInterpolation');
  requestUrl.searchParams.set('f', 'image');

  let upstream: Response;
  try {
    upstream = await fetch(requestUrl.toString(), {
      headers: { Accept: 'image/tiff,*/*;q=0.8' }
    });
  } catch (error) {
    return new Response(`USGS 3DEP request failed: ${String(error)}`, { status: 502 });
  }

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => '');
    return new Response(
      `USGS 3DEP returned ${upstream.status}: ${text.slice(0, 400)}`,
      { status: 502 }
    );
  }

  const arrayBuffer = await upstream.arrayBuffer();

  try {
    const tiff = await fromArrayBuffer(arrayBuffer);
    const image = await tiff.getImage();
    const raster = await image.readRasters({ interleave: true });

    const width = image.getWidth();
    const height = image.getHeight();
    if (width !== samples || height !== samples) {
      return new Response(
        `Unexpected USGS raster ${width}x${height}; wanted ${samples}x${samples}`,
        { status: 502 }
      );
    }

    const noData = image.getGDALNoData();
    const source = raster as unknown as ArrayLike<number>;
    const bytes = new Uint8Array(samples * samples * 2);
    const view = new DataView(bytes.buffer);

    for (let i = 0; i < samples * samples; i++) {
      const value = Number(source[i]);
      const invalid =
        !Number.isFinite(value) ||
        (noData !== null &&
          Number.isFinite(noData) &&
          Math.abs(value - noData) < 1e-5) ||
        value < -500;

      if (invalid) {
        view.setInt16(i * 2, -32768, true);
      } else {
        view.setInt16(
          i * 2,
          Math.max(-32767, Math.min(32767, Math.round(value * 10))),
          true
        );
      }
    }

    memoryCache = bytes;
    return binaryResponse(bytes, false);
  } catch (error) {
    return new Response(`Unable to decode USGS TIFF: ${String(error)}`, {
      status: 502
    });
  }
};

function binaryResponse(bytes: Uint8Array, hit: boolean): Response {
  return new Response(bytes.slice().buffer, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(bytes.byteLength),
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Source': 'USGS-3DEP',
      'X-Memory-Cache': hit ? 'hit' : 'miss'
    }
  });
}
