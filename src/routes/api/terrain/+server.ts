import { fromArrayBuffer } from 'geotiff';
import type { RequestHandler } from './$types';
import {
  TERRAIN_ORIGIN_E,
  TERRAIN_ORIGIN_N,
  TERRAIN_HEIGHT_UNIT_M,
  TERRAIN_SIDE,
  TERRAIN_SIZE_M,
  TERRAIN_SPACING_M
} from '$lib/game/TerrainRegionSource';

const THREE_DEP_IMAGE_SERVER =
  'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage';

let memoryCache: Uint8Array | null = null;

export const GET: RequestHandler = async ({ fetch }) => {
  if (memoryCache) return binaryResponse(memoryCache, true);

  const half = TERRAIN_SIZE_M / 2;
  const pad = TERRAIN_SPACING_M / 2;
  const minE = TERRAIN_ORIGIN_E - half - pad;
  const maxE = TERRAIN_ORIGIN_E + half + pad;
  const minN = TERRAIN_ORIGIN_N - half - pad;
  const maxN = TERRAIN_ORIGIN_N + half + pad;

  const requestUrl = new URL(THREE_DEP_IMAGE_SERVER);
  requestUrl.searchParams.set('bbox', `${minE},${minN},${maxE},${maxN}`);
  requestUrl.searchParams.set('bboxSR', '32612');
  requestUrl.searchParams.set('imageSR', '32612');
  requestUrl.searchParams.set('size', `${TERRAIN_SIDE},${TERRAIN_SIDE}`);
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
    const detail = await upstream.text().catch(() => '');
    return new Response(
      `USGS 3DEP returned ${upstream.status}: ${detail.slice(0, 400)}`,
      { status: 502 }
    );
  }

  try {
    const tiff = await fromArrayBuffer(await upstream.arrayBuffer());
    const image = await tiff.getImage();

    if (image.getWidth() !== TERRAIN_SIDE || image.getHeight() !== TERRAIN_SIDE) {
      return new Response(
        `Unexpected USGS raster ${image.getWidth()}x${image.getHeight()}; ` +
        `wanted ${TERRAIN_SIDE}x${TERRAIN_SIDE}`,
        { status: 502 }
      );
    }

    const raster = await image.readRasters({ interleave: true });
    const source = raster as unknown as ArrayLike<number>;
    const noData = image.getGDALNoData();
    const bytes = new Uint8Array(TERRAIN_SIDE * TERRAIN_SIDE * 2);
    const view = new DataView(bytes.buffer);

    for (let i = 0; i < TERRAIN_SIDE * TERRAIN_SIDE; i++) {
      const value = Number(source[i]);
      const invalid =
        !Number.isFinite(value) ||
        (noData !== null && Number.isFinite(noData) && Math.abs(value - noData) < 1e-5);

      if (invalid) {
        return new Response(`USGS 3DEP contains invalid elevation at sample ${i}`, {
          status: 502
        });
      }

      const quantized = Math.round(value / TERRAIN_HEIGHT_UNIT_M);
      if (quantized < -32768 || quantized > 32767) {
        return new Response(`USGS 3DEP elevation out of int16 range at sample ${i}`, {
          status: 502
        });
      }

      view.setInt16(i * 2, quantized, true);
    }

    memoryCache = bytes;
    return binaryResponse(bytes, false);
  } catch (error) {
    return new Response(`Unable to decode USGS 3DEP TIFF: ${String(error)}`, {
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
      'X-Terrain-Source': 'USGS-3DEP',
      'X-Terrain-Spacing-M': String(TERRAIN_SPACING_M),
      'X-Terrain-Height-Unit-M': String(TERRAIN_HEIGHT_UNIT_M),
      'X-Memory-Cache': hit ? 'hit' : 'miss'
    }
  });
}
