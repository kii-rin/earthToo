import proj4 from 'proj4';
import { TERRAIN_ORIGIN_E, TERRAIN_ORIGIN_N } from './TerrainRegionSource';

const WGS84 = '+proj=longlat +datum=WGS84 +no_defs +type=crs';
const UTM12N = '+proj=utm +zone=12 +datum=WGS84 +units=m +no_defs +type=crs';

export function localToGeoUtm(localX: number, localZ: number): { lat: number; lon: number } {
  const [lon, lat] = proj4(UTM12N, WGS84, [
    TERRAIN_ORIGIN_E + localX,
    TERRAIN_ORIGIN_N - localZ
  ]);

  return { lat, lon };
}
