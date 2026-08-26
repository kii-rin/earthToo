import * as THREE from 'three/webgpu';

type ColoradoRiverPayload = {
  source: string;
  lines: [number, number][][];
};

const CENTERLINE_SPACING_M = 10;
const CENTERLINE_SMOOTH_PASSES = 2;
const MAX_CENTERLINE_SMOOTH_SHIFT_M = 10;

const CHANNEL_SEARCH_RADIUS_M = 70;
const CHANNEL_SEARCH_STEP_M = 4;
const MAX_CHANNEL_SHIFT_M = 55;
const CHANNEL_SHIFT_SMOOTH_PASSES = 3;

const BASE_WATER_STAGE_M = 0.8;
const WATER_STAGE_PER_ERROR = 1.0;
const MAX_ERROR_STAGE_M = 12.0;
const MIN_SURFACE_CLEARANCE_M = 0.18;
const CLEARANCE_PER_ERROR = 0.25;
const MAX_ERROR_CLEARANCE_M = 2.5;
const WATER_LEVEL_SMOOTH_PASSES = 3;
const MAX_WATER_LEVEL_ADJUST_M = 2.0;
const MAX_LEVEL_STEP_M = 0.28;

const BANK_SCAN_STEP_M = 3;
const MAX_HALF_WIDTH_M = 220;
const BANK_BISECTION_STEPS = 7;
const DRY_CONFIRM_SAMPLES = 2;
const WIDTH_SMOOTH_PASSES = 2;
const MAX_WIDTH_CHANGE_M = 22;

export class ColoradoRiver {
  private lines: [number, number][][] = [];
  private mesh: THREE.Mesh | null = null;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly sampleRenderedGround: (x: number, z: number) => number | null
  ) {}

  async load(terrainErrorM = 8): Promise<void> {
    const response = await fetch('/api/colorado-river', { cache: 'force-cache' });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Colorado River failed: ${response.status} ${detail}`);
    }

    const payload = await response.json() as ColoradoRiverPayload;
    this.lines = payload.lines.filter((line) => line.length >= 2);
    this.rebuild(terrainErrorM);
  }

  rebuild(terrainErrorM = 8): void {
    this.disposeMesh();
    if (this.lines.length === 0) return;

    const positions: number[] = [];
    const indices: number[] = [];
    let vertexOffset = 0;

    for (const rawLine of this.lines) {
      const guide = prepareCenterline(rawLine);
      if (guide.length < 2) continue;

      const rawShifts = guide.map((point, index) => {
        const normal = centerlineNormal(guide, index);
        return findVisibleChannelShift(point, normal, this.sampleRenderedGround);
      });
      const shifts = smoothChannelShifts(rawShifts);

      const centers = guide.map((point, index): [number, number] => {
        const normal = centerlineNormal(guide, index);
        return [
          point[0] + normal[0] * shifts[index],
          point[1] + normal[1] * shifts[index]
        ];
      });

      const channelGround = centers.map(([x, z]) => this.sampleRenderedGround(x, z));
      const waterStageM = waterStageForTerrainError(terrainErrorM);
      const surfaceClearanceM = surfaceClearanceForTerrainError(terrainErrorM);
      const waterLevels = buildWaterProfile(channelGround, waterStageM, surfaceClearanceM);

      const rawLeftWidths: number[] = [];
      const rawRightWidths: number[] = [];

      for (let i = 0; i < centers.length; i++) {
        const level = waterLevels[i];
        if (level === null) {
          rawLeftWidths.push(0);
          rawRightWidths.push(0);
          continue;
        }

        const normal = centerlineNormal(centers, i);
        rawLeftWidths.push(
          findBankDistance(centers[i], normal, 1, level, this.sampleRenderedGround)
        );
        rawRightWidths.push(
          findBankDistance(centers[i], normal, -1, level, this.sampleRenderedGround)
        );
      }

      const leftWidths = smoothWidths(rawLeftWidths);
      const rightWidths = smoothWidths(rawRightWidths);
      let previousPair: number | null = null;

      for (let i = 0; i < centers.length; i++) {
        const level = waterLevels[i];
        const ground = channelGround[i];
        if (level === null || ground === null || leftWidths[i] <= 0 || rightWidths[i] <= 0) {
          previousPair = null;
          continue;
        }

        const surfaceY = Math.max(level, ground + surfaceClearanceM);
        const normal = centerlineNormal(centers, i);
        const pair = vertexOffset;

        positions.push(
          centers[i][0] + normal[0] * leftWidths[i],
          surfaceY,
          centers[i][1] + normal[1] * leftWidths[i],
          centers[i][0] - normal[0] * rightWidths[i],
          surfaceY,
          centers[i][1] - normal[1] * rightWidths[i]
        );

        if (previousPair !== null) {
          const a = previousPair;
          const b = previousPair + 1;
          const c = pair;
          const d = pair + 1;
          indices.push(a, b, c, c, b, d);
        }

        previousPair = pair;
        vertexOffset += 2;
      }
    }

    if (indices.length === 0) return;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();

    const material = new THREE.MeshBasicMaterial({
      color: 0x2d80aa,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -2
    });
    material.dithering = true;

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'terrain-fitted-real-river-water';
    mesh.frustumCulled = true;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.renderOrder = 2;

    this.scene.add(mesh);
    this.mesh = mesh;
  }

  dispose(): void {
    this.disposeMesh();
    this.lines = [];
  }

  private disposeMesh(): void {
    if (!this.mesh) return;
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh = null;
  }
}

function findVisibleChannelShift(
  center: [number, number],
  normal: [number, number],
  sampleGround: (x: number, z: number) => number | null
): number {
  let bestShift = 0;
  let bestHeight = sampleGround(center[0], center[1]);

  for (
    let shift = -CHANNEL_SEARCH_RADIUS_M;
    shift <= CHANNEL_SEARCH_RADIUS_M;
    shift += CHANNEL_SEARCH_STEP_M
  ) {
    const x = center[0] + normal[0] * shift;
    const z = center[1] + normal[1] * shift;
    const height = sampleGround(x, z);
    if (height === null) continue;

    if (bestHeight === null || height < bestHeight) {
      bestHeight = height;
      bestShift = shift;
    }
  }

  return THREE.MathUtils.clamp(bestShift, -MAX_CHANNEL_SHIFT_M, MAX_CHANNEL_SHIFT_M);
}

function findBankDistance(
  center: [number, number],
  normal: [number, number],
  direction: 1 | -1,
  waterLevel: number,
  sampleGround: (x: number, z: number) => number | null
): number {
  const centerHeight = sampleGround(center[0], center[1]);
  if (centerHeight === null || centerHeight > waterLevel) return 0;

  let lastWet = 0;
  let firstDry = -1;
  let drySamples = 0;

  for (let distance = BANK_SCAN_STEP_M; distance <= MAX_HALF_WIDTH_M; distance += BANK_SCAN_STEP_M) {
    const height = sampleSide(center, normal, direction, distance, sampleGround);
    if (height === null) break;

    if (height <= waterLevel) {
      lastWet = distance;
      firstDry = -1;
      drySamples = 0;
      continue;
    }

    if (firstDry < 0) firstDry = distance;
    drySamples++;
    if (drySamples < DRY_CONFIRM_SAMPLES) continue;

    let wet = lastWet;
    let dry = firstDry;
    for (let i = 0; i < BANK_BISECTION_STEPS; i++) {
      const mid = (wet + dry) * 0.5;
      const midHeight = sampleSide(center, normal, direction, mid, sampleGround);
      if (midHeight !== null && midHeight <= waterLevel) wet = mid;
      else dry = mid;
    }
    return Math.max(BANK_SCAN_STEP_M, (wet + dry) * 0.5);
  }

  return Math.max(BANK_SCAN_STEP_M, lastWet);
}

function sampleSide(
  center: [number, number],
  normal: [number, number],
  direction: 1 | -1,
  distance: number,
  sampleGround: (x: number, z: number) => number | null
): number | null {
  return sampleGround(
    center[0] + normal[0] * distance * direction,
    center[1] + normal[1] * distance * direction
  );
}

function buildWaterProfile(
  channelGround: (number | null)[],
  waterStageM: number,
  surfaceClearanceM: number
): (number | null)[] {
  const anchors = channelGround.map((ground) => ground === null ? null : ground + waterStageM);
  let levels = anchors.slice();

  for (let pass = 0; pass < WATER_LEVEL_SMOOTH_PASSES; pass++) {
    const next = levels.slice();

    for (let i = 1; i < levels.length - 1; i++) {
      const anchor = anchors[i];
      if (anchor === null) continue;

      let weighted = 0;
      let weightSum = 0;
      for (let offset = -3; offset <= 3; offset++) {
        const value = levels[i + offset];
        if (value === undefined || value === null) continue;
        const weight = 4 - Math.abs(offset);
        weighted += value * weight;
        weightSum += weight;
      }

      if (weightSum > 0) {
        next[i] = THREE.MathUtils.clamp(
          weighted / weightSum,
          anchor - MAX_WATER_LEVEL_ADJUST_M,
          anchor + MAX_WATER_LEVEL_ADJUST_M
        );
      }
    }

    levels = next;
  }

  for (let i = 1; i < levels.length; i++) {
    const previous = levels[i - 1];
    const current = levels[i];
    if (previous === null || current === null) continue;
    levels[i] = THREE.MathUtils.clamp(current, previous - MAX_LEVEL_STEP_M, previous + MAX_LEVEL_STEP_M);
  }
  for (let i = levels.length - 2; i >= 0; i--) {
    const next = levels[i + 1];
    const current = levels[i];
    if (next === null || current === null) continue;
    levels[i] = THREE.MathUtils.clamp(current, next - MAX_LEVEL_STEP_M, next + MAX_LEVEL_STEP_M);
  }

  for (let i = 0; i < levels.length; i++) {
    const ground = channelGround[i];
    if (ground === null) continue;
    const minimum = ground + Math.max(MIN_SURFACE_CLEARANCE_M, surfaceClearanceM);
    levels[i] = levels[i] === null ? ground + waterStageM : Math.max(levels[i]!, minimum);
  }

  return levels;
}

function waterStageForTerrainError(terrainErrorM: number): number {
  const error = THREE.MathUtils.clamp(terrainErrorM, 0.5, 100);
  return BASE_WATER_STAGE_M + Math.min(MAX_ERROR_STAGE_M, error * WATER_STAGE_PER_ERROR);
}

function surfaceClearanceForTerrainError(terrainErrorM: number): number {
  const error = THREE.MathUtils.clamp(terrainErrorM, 0.5, 100);
  return MIN_SURFACE_CLEARANCE_M + Math.min(MAX_ERROR_CLEARANCE_M, error * CLEARANCE_PER_ERROR);
}

function smoothChannelShifts(values: number[]): number[] {
  let smoothed = values.slice();

  for (let pass = 0; pass < CHANNEL_SHIFT_SMOOTH_PASSES; pass++) {
    const next = smoothed.slice();
    for (let i = 1; i < smoothed.length - 1; i++) {
      const candidate = (smoothed[i - 1] + smoothed[i] * 2 + smoothed[i + 1]) / 4;
      next[i] = THREE.MathUtils.clamp(candidate, -MAX_CHANNEL_SHIFT_M, MAX_CHANNEL_SHIFT_M);
    }
    smoothed = next;
  }

  return smoothed;
}

function smoothWidths(values: number[]): number[] {
  let smoothed = values.slice();

  for (let pass = 0; pass < WIDTH_SMOOTH_PASSES; pass++) {
    const next = smoothed.slice();
    for (let i = 1; i < smoothed.length - 1; i++) {
      if (smoothed[i] <= 0) continue;
      const previous = smoothed[i - 1] > 0 ? smoothed[i - 1] : smoothed[i];
      const following = smoothed[i + 1] > 0 ? smoothed[i + 1] : smoothed[i];
      const average = (previous + smoothed[i] * 2 + following) / 4;
      next[i] = THREE.MathUtils.clamp(
        average,
        Math.max(BANK_SCAN_STEP_M, smoothed[i] - MAX_WIDTH_CHANGE_M),
        Math.min(MAX_HALF_WIDTH_M, smoothed[i] + MAX_WIDTH_CHANGE_M)
      );
    }
    smoothed = next;
  }

  return smoothed;
}

function centerlineNormal(line: [number, number][], index: number): [number, number] {
  const previous = line[Math.max(0, index - 1)];
  const next = line[Math.min(line.length - 1, index + 1)];
  const tangentX = next[0] - previous[0];
  const tangentZ = next[1] - previous[1];
  const length = Math.hypot(tangentX, tangentZ) || 1;
  return [tangentZ / length, -tangentX / length];
}

function prepareCenterline(line: [number, number][]): [number, number][] {
  const anchors = resampleLine(line, CENTERLINE_SPACING_M);
  if (anchors.length < 3) return anchors;

  let smoothed = anchors.map(([x, z]): [number, number] => [x, z]);

  for (let pass = 0; pass < CENTERLINE_SMOOTH_PASSES; pass++) {
    const next = smoothed.map(([x, z]): [number, number] => [x, z]);

    for (let i = 1; i < smoothed.length - 1; i++) {
      const previous = smoothed[i - 1];
      const current = smoothed[i];
      const following = smoothed[i + 1];
      const candidate: [number, number] = [
        (previous[0] + current[0] * 2 + following[0]) / 4,
        (previous[1] + current[1] * 2 + following[1]) / 4
      ];
      next[i] = clampPointToAnchor(candidate, anchors[i], MAX_CENTERLINE_SMOOTH_SHIFT_M);
    }

    smoothed = next;
  }

  return smoothed;
}

function clampPointToAnchor(
  point: [number, number],
  anchor: [number, number],
  maxShiftM: number
): [number, number] {
  const dx = point[0] - anchor[0];
  const dz = point[1] - anchor[1];
  const distance = Math.hypot(dx, dz);
  if (distance <= maxShiftM || distance < 1e-6) return point;

  const scale = maxShiftM / distance;
  return [anchor[0] + dx * scale, anchor[1] + dz * scale];
}

function resampleLine(line: [number, number][], maxSegmentM: number): [number, number][] {
  if (line.length < 2) return line.slice();

  const result: [number, number][] = [line[0]];

  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const b = line[i];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const distance = Math.hypot(dx, dz);
    const steps = Math.max(1, Math.ceil(distance / maxSegmentM));

    for (let step = 1; step <= steps; step++) {
      const t = step / steps;
      result.push([a[0] + dx * t, a[1] + dz * t]);
    }
  }

  return result;
}
