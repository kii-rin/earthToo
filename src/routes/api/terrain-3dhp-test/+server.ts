import { fromArrayBuffer } from 'geotiff';
import type { RequestHandler } from './$types';

const USGS_3DEP =
  'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage';

// San Francisco / Golden Gate — UTM zone 10N.
const EPSG = 32610;
const ORIGIN_E = 545_915.8162135034;
const ORIGIN_N = 4_185_961.039087708;

const SPACING_M = 10;
const SEGMENTS = 2048;
const SIDE = SEGMENTS + 1;
const SIZE_M = SEGMENTS * SPACING_M;

let cache: ArrayBuffer | null = null;

export const GET: RequestHandler = async ({ fetch }) => {
  if (cache) return binaryResponse(cache, true);

  try {
    const half = SIZE_M / 2;
    const requestUrl = new URL(USGS_3DEP);

    requestUrl.searchParams.set(
      'bbox',
      `${ORIGIN_E - half},${ORIGIN_N - half},${ORIGIN_E + half},${ORIGIN_N + half}`
    );
    requestUrl.searchParams.set('bboxSR', String(EPSG));
    requestUrl.searchParams.set('imageSR', String(EPSG));
    requestUrl.searchParams.set('size', `${SIDE},${SIDE}`);
    requestUrl.searchParams.set('format', 'tiff');
    requestUrl.searchParams.set('pixelType', 'F32');
    requestUrl.searchParams.set('interpolation', 'RSP_BilinearInterpolation');
    requestUrl.searchParams.set('f', 'image');

    const upstream = await fetch(requestUrl.toString(), {
      headers: { Accept: 'image/tiff,*/*;q=0.8' }
    });

    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => '');
      return new Response(
        `USGS 3DEP returned ${upstream.status}: ${detail.slice(0, 300)}`,
        { status: 502 }
      );
    }

    const tiff = await fromArrayBuffer(await upstream.arrayBuffer());
    const image = await tiff.getImage();

    if (image.getWidth() !== SIDE || image.getHeight() !== SIDE) {
      return new Response(
        `Unexpected 3DEP raster ${image.getWidth()}x${image.getHeight()}, expected ${SIDE}x${SIDE}`,
        { status: 502 }
      );
    }

    const raster = await image.readRasters({ interleave: true });
    const source = raster as unknown as ArrayLike<number>;
    const noData = image.getGDALNoData();
    const heights = new Float32Array(SIDE * SIDE);

    for (let i = 0; i < heights.length; i++) {
      const value = Number(source[i]);
      const invalid =
        !Number.isFinite(value) ||
        (noData !== null &&
          Number.isFinite(noData) &&
          Math.abs(value - noData) < 1e-6);

      if (invalid) {
        return new Response(`3DEP contains invalid height at sample ${i}`, {
          status: 502
        });
      }

      // Raw 3DEP. Absolutely no water preprocessing.
      heights[i] = value;
    }

    cache = heights.slice().buffer as ArrayBuffer;
    return binaryResponse(cache, false);
  } catch (error) {
    return new Response(`3DEP request failed: ${String(error)}`, {
      status: 502
    });
  }
};

function binaryResponse(buffer: ArrayBuffer, hit: boolean): Response {
  return new Response(buffer.slice(0), {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Cache-Control': 'no-store, max-age=0',
      'X-Terrain-Source': 'USGS 3DEP raw F32',
      'X-Terrain-Format': `Float32 meters, ${SIDE}x${SIDE}`,
      'X-Terrain-LOD': 'fixed',
      'X-Memory-Cache': hit ? 'hit' : 'miss'
    }
  });
}
