import proj4 from 'proj4';
import type { TerrainZone } from './zones';

const WGS84 = '+proj=longlat +datum=WGS84 +no_defs +type=crs';

export function localToGeoUtm(
  zone: TerrainZone,
  localX: number,
  localZ: number
): { lat: number; lon: number } {
  const utm = `+proj=utm +zone=${zone.utmZone} +datum=WGS84 +units=m +no_defs +type=crs`;
  const [lon, lat] = proj4(utm, WGS84, [zone.originE + localX, zone.originN - localZ]);
  return { lat, lon };
}
