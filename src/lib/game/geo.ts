export const EARTH_RADIUS_M = 6_378_137;

export type GeoPoint = {
  lat: number;
  lon: number;
  elevation?: number;
};

export type LocalPoint = {
  x: number;
  z: number;
};

export function geoToLocal(lat: number, lon: number, origin: GeoPoint): LocalPoint {
  const lat0 = origin.lat * Math.PI / 180;
  const dLat = (lat - origin.lat) * Math.PI / 180;
  const dLon = (lon - origin.lon) * Math.PI / 180;

  return {
    x: EARTH_RADIUS_M * Math.cos(lat0) * dLon,
    z: -EARTH_RADIUS_M * dLat
  };
}

export function localToGeo(x: number, z: number, origin: GeoPoint): GeoPoint {
  const lat0 = origin.lat * Math.PI / 180;
  const lat = origin.lat - (z / EARTH_RADIUS_M) * 180 / Math.PI;
  const lon = origin.lon + (x / (EARTH_RADIUS_M * Math.cos(lat0))) * 180 / Math.PI;
  return { lat, lon };
}

export function lonToTileX(lon: number, zoom: number): number {
  const n = 2 ** zoom;
  return ((lon + 180) / 360) * n;
}

export function latToTileY(lat: number, zoom: number): number {
  const n = 2 ** zoom;
  const latRad = lat * Math.PI / 180;
  return (1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2 * n;
}

export function tileXToLon(x: number, zoom: number): number {
  return x / (2 ** zoom) * 360 - 180;
}

export function tileYToLat(y: number, zoom: number): number {
  const n = Math.PI - 2 * Math.PI * y / (2 ** zoom);
  return 180 / Math.PI * Math.atan(Math.sinh(n));
}

export function tileForLatLon(lat: number, lon: number, zoom: number): { x: number; y: number } {
  return {
    x: Math.floor(lonToTileX(lon, zoom)),
    y: Math.floor(latToTileY(lat, zoom))
  };
}
