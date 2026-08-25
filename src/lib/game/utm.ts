import proj4 from 'proj4';
import { START_UTM_E, START_UTM_N } from './TerrainRegionSource';
import type { GeoPoint } from './geo';

const WGS84 = '+proj=longlat +datum=WGS84 +no_defs +type=crs';
const WGS84_UTM12N = '+proj=utm +zone=12 +datum=WGS84 +units=m +no_defs +type=crs';

export function localToGeoUtm(localX: number, localZ: number): GeoPoint {
  const easting = START_UTM_E + localX;
  const northing = START_UTM_N - localZ;
  const [lon, lat] = proj4(WGS84_UTM12N, WGS84, [easting, northing]);
  return { lat, lon };
}
