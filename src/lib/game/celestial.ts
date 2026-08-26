import * as Astronomy from 'astronomy-engine';
import * as THREE from 'three/webgpu';

export type CelestialPosition = {
  altitudeDeg: number;
  azimuthDeg: number;
  direction: THREE.Vector3;
};

export function bodyPosition(
  body: Astronomy.Body,
  date: Date,
  lat: number,
  lon: number,
  elevationMeters: number
): CelestialPosition {
  const observer = new Astronomy.Observer(lat, lon, elevationMeters);
  const equ = Astronomy.Equator(body, date, observer, true, true);
  const hor = Astronomy.Horizon(date, observer, equ.ra, equ.dec, 'normal');

  const altitude = hor.altitude * Math.PI / 180;
  const azimuth = hor.azimuth * Math.PI / 180;
  const cosAlt = Math.cos(altitude);

  const direction = new THREE.Vector3(
    cosAlt * Math.sin(azimuth),
    Math.sin(altitude),
    -cosAlt * Math.cos(azimuth)
  ).normalize();

  return {
    altitudeDeg: hor.altitude,
    azimuthDeg: hor.azimuth,
    direction
  };
}
