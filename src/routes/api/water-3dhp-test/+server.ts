import type { RequestHandler } from './$types';

const USGS_3DHP_WATERBODY =
  'https://3dhp.nationalmap.gov/arcgis/rest/services/usgs_3dhp_all/FeatureServer/60/query';

// Same exact terrain extent — UTM zone 10N.
const EPSG = 32610;
const ORIGIN_E = 545_915.8162135034;
const ORIGIN_N = 4_185_961.039087708;
const SIZE_M = 2048 * 10;

let cache: string | null = null;

export const GET: RequestHandler = async ({ fetch }) => {
  if (cache) return jsonResponse(cache, true);

  try {
    const half = SIZE_M / 2;
    const minE = ORIGIN_E - half;
    const minN = ORIGIN_N - half;
    const maxE = ORIGIN_E + half;
    const maxN = ORIGIN_N + half;

    const requestUrl = new URL(USGS_3DHP_WATERBODY);

    // 3DHP Waterbody feature types:
    // 1 river, 2 canal, 3 lake, 4 ocean / great lake.
    requestUrl.searchParams.set(
      'where',
      'featuretype IN (1,2,3,4)'
    );
    requestUrl.searchParams.set(
      'geometry',
      `${minE},${minN},${maxE},${maxN}`
    );
    requestUrl.searchParams.set(
      'geometryType',
      'esriGeometryEnvelope'
    );
    requestUrl.searchParams.set('inSR', String(EPSG));
    requestUrl.searchParams.set('outSR', String(EPSG));
    requestUrl.searchParams.set(
      'spatialRel',
      'esriSpatialRelIntersects'
    );
    requestUrl.searchParams.set(
      'outFields',
      'featuretype,featuretypelabel'
    );
    requestUrl.searchParams.set('returnGeometry', 'true');
    requestUrl.searchParams.set('returnZ', 'false');

    // Keep shoreline detail but avoid absurdly dense vector payloads.
    // 2 m is much finer than our 10 m terrain source.
    requestUrl.searchParams.set('maxAllowableOffset', '2');
    requestUrl.searchParams.set('f', 'json');

    const upstream = await fetch(requestUrl.toString(), {
      headers: { Accept: 'application/json' }
    });

    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => '');
      return new Response(
        `USGS 3DHP returned ${upstream.status}: ${detail.slice(0, 300)}`,
        { status: 502 }
      );
    }

    const data = await upstream.json();

    if (data.error) {
      return new Response(
        `USGS 3DHP error: ${JSON.stringify(data.error)}`,
        { status: 502 }
      );
    }

    const payload = JSON.stringify({
      epsg: EPSG,
      minE,
      minN,
      maxE,
      maxN,
      exceededTransferLimit: Boolean(data.exceededTransferLimit),
      features: Array.isArray(data.features) ? data.features : []
    });

    cache = payload;
    return jsonResponse(payload, false);
  } catch (error) {
    return new Response(`3DHP request failed: ${String(error)}`, {
      status: 502
    });
  }
};

function jsonResponse(text: string, hit: boolean): Response {
  return new Response(text, {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store, max-age=0',
      'X-Water-Source': 'USGS 3DHP Waterbody',
      'X-Memory-Cache': hit ? 'hit' : 'miss'
    }
  });
}
