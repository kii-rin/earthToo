export const TERRAIN_HEIGHT_UNIT_M = 0.5;

export type TerrainPalette = 'canyon' | 'island' | 'plains';

export type TerrainZone = {
  id: string;
  label: string;
  start: { lat: number; lon: number };
  utmZone: number;
  epsg: number;
  originE: number;
  originN: number;
  spacingM: number;
  segments: number;
  palette: TerrainPalette;
  heightOffsetM?: number;
  coloradoRiver?: boolean;
  seaLevelM?: number;
  oceanFloorM?: number;
  hydroLakes?: boolean;
  syntheticWaterDepthM?: number;
  waterShoreDepthM?: number;
  waterTaperCells?: number;
  waterRenderOffsetM?: number;
  minWaterAreaKm2?: number;
  cameraAltitudeM?: number;
  cameraBackM?: number;
  cameraFarM?: number;
  fogDensity?: number;
  flySpeedMps?: number;
  flyFastSpeedMps?: number;
  flyVerticalSpeedMps?: number;
};

export const GRAND_CANYON: TerrainZone = {
  id: 'grand-canyon',
  label: 'Grand Canyon',
  start: { lat: 36.0643, lon: -112.1163 },
  utmZone: 12,
  epsg: 32612,
  originE: 399_470.30152241024,
  originN: 3_991_656.860017819,
  spacingM: 10,
  segments: 2048,
  palette: 'canyon',
  coloradoRiver: true
};

export const HAWAII_NORTH_SHORE: TerrainZone = {
  id: 'hawaii-north-shore',
  label: 'Hawaii · North Shore',
  start: { lat: 21.6417, lon: -158.065 },
  utmZone: 4,
  epsg: 32604,
  originE: 596_755.1941287329,
  originN: 2_393_460.2063752064,
  spacingM: 10,
  segments: 2048,
  palette: 'island',
  heightOffsetM: -10,
  seaLevelM: -10,
  oceanFloorM: -30
};

export const WILSON_LAKE: TerrainZone = {
  id: 'wilson-lake',
  label: 'Kansas · Wilson Lake',
  start: { lat: 38.9401464, lon: -98.5567638 },
  utmZone: 14,
  epsg: 32614,
  originE: 538_412.9959245546,
  originN: 4_310_227.983919781,
  spacingM: 10,
  segments: 2048,
  palette: 'plains',
  hydroLakes: true,
  syntheticWaterDepthM: 20,
  waterShoreDepthM: 10,
  waterTaperCells: 2,
  waterRenderOffsetM: 0.2,
  minWaterAreaKm2: 0.008,
  cameraAltitudeM: 1800,
  cameraBackM: 3600,
  cameraFarM: 45_000,
  fogDensity: 0.000055,
  flySpeedMps: 160,
  flyFastSpeedMps: 800,
  flyVerticalSpeedMps: 220
};

export const TERRAIN_ZONES = [GRAND_CANYON, HAWAII_NORTH_SHORE, WILSON_LAKE] as const;

export function terrainZone(id: string | null | undefined): TerrainZone | null {
  return TERRAIN_ZONES.find((zone) => zone.id === id) ?? null;
}

export function terrainSide(zone: TerrainZone): number {
  return zone.segments + 1;
}

export function terrainSizeM(zone: TerrainZone): number {
  return zone.segments * zone.spacingM;
}

export function terrainSourceLabel(): string {
  return 'USGS 3DEP';
}
