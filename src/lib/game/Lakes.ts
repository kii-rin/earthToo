import * as THREE from 'three/webgpu';
import type { TerrainWaterBody } from './TerrainRegionSource';

export class Lakes {
  private mesh: THREE.Mesh | null = null;

  constructor(scene: THREE.Scene, bodies: TerrainWaterBody[], renderOffsetM = 0.2) {
    const positions: number[] = [];
    const indices: number[] = [];
    let vertexBase = 0;

    for (const body of bodies) {
      for (const polygon of polygonsFromRings(body.rings)) {
        const contour = polygon.outer.map(([x, z]) => new THREE.Vector2(x, z));
        const holes = polygon.holes.map((ring) => ring.map(([x, z]) => new THREE.Vector2(x, z)));
        if (contour.length < 3) continue;

        const vertices = [...contour, ...holes.flat()];
        const faces = THREE.ShapeUtils.triangulateShape(contour, holes);
        for (const vertex of vertices) positions.push(vertex.x, body.levelM + renderOffsetM, vertex.y);
        for (const face of faces) indices.push(vertexBase + face[0], vertexBase + face[1], vertexBase + face[2]);
        vertexBase += vertices.length;
      }
    }

    if (positions.length === 0 || indices.length === 0) return;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    const material = new THREE.MeshStandardMaterial({
      color: 0x2d7896,
      roughness: 0.24,
      metalness: 0,
      depthTest: true,
      depthWrite: true,
      side: THREE.DoubleSide
    });

    this.mesh = new THREE.Mesh(geometry, material);
    scene.add(this.mesh);
  }

  dispose(scene: THREE.Scene): void {
    if (!this.mesh) return;
    scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh = null;
  }
}

type PolygonRings = {
  outer: [number, number][];
  holes: [number, number][][];
};

function polygonsFromRings(input: [number, number][][]): PolygonRings[] {
  const rings = input
    .map(cleanRing)
    .filter((ring) => ring.length >= 3)
    .map((ring) => ({ ring, area: Math.abs(signedArea(ring)) }))
    .sort((a, b) => b.area - a.area);

  const polygons: PolygonRings[] = [];

  for (const item of rings) {
    let owner: PolygonRings | null = null;
    let ownerArea = Infinity;
    const point = item.ring[0];

    for (const polygon of polygons) {
      const area = Math.abs(signedArea(polygon.outer));
      if (area < ownerArea && pointInRing(point[0], point[1], polygon.outer)) {
        owner = polygon;
        ownerArea = area;
      }
    }

    if (owner) owner.holes.push(item.ring);
    else polygons.push({ outer: item.ring, holes: [] });
  }

  return polygons;
}

function cleanRing(ring: [number, number][]): [number, number][] {
  if (ring.length < 2) return ring;
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) return ring.slice(0, -1);
  return ring;
}

function signedArea(ring: [number, number][]): number {
  let area = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    area += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return area / 2;
}

function pointInRing(x: number, z: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], zi = ring[i][1];
    const xj = ring[j][0], zj = ring[j][1];
    if (((zi > z) !== (zj > z)) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
