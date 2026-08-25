import * as THREE from 'three/webgpu';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import * as Astronomy from 'astronomy-engine';
import { bodyPosition } from './celestial';
import { localToGeoUtm } from './utm';
import { TerrainRegionSource } from './TerrainRegionSource';
import { AdaptiveTerrain, type TerrainMeshStats } from './AdaptiveTerrain';

export const START = {
  lat: 36.0643,
  lon: -112.1163,
  elevation: 0
};

export type GameStatus = {
  fps: number;
  frameMs: number;
  lat: number;
  lon: number;
  groundElevation: number;
  altitudeAgl: number;
  triangles: number;
  vertices: number;
  meshError: number;
  rmsd: number;
  buildMs: number;
  requestedError: number;
  backend: string;
  locked: boolean;
  flyMode: boolean;
  realTime: boolean;
};

const EYE_HEIGHT = 1.72;
const WALK_SPEED = 8;
const FAST_SPEED = 85;
const FLY_SPEED = 100;
const FLY_FAST_SPEED = 500;
const FLY_VERTICAL_SPEED = 110;

export class Game {
  private renderer!: THREE.WebGPURenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(62, 1, 0.3, 30_000);
  private controls!: PointerLockControls;

  private readonly source = new TerrainRegionSource();
  private readonly adaptive = new AdaptiveTerrain(this.scene);
  private region: Awaited<ReturnType<TerrainRegionSource['load']>> | null = null;

  private readonly keys = new Set<string>();
  private readonly clock = new THREE.Clock();
  private stopped = false;
  private flyMode = true;
  private realTime = false;
  private requestedError = 8;
  private rebuildTimer: ReturnType<typeof setTimeout> | null = null;

  private fpsFrames = 0;
  private fpsWindow = 0;
  private fps = 0;
  private lastStatus = 0;

  private readonly sun = new THREE.DirectionalLight(0xffd8a2, 2.35);
  private readonly hemi = new THREE.HemisphereLight(0xbfd8e5, 0x624735, 0.9);
  private readonly fill = new THREE.DirectionalLight(0x9cb8d2, 0.18);
  private readonly sunTarget = new THREE.Object3D();

  constructor(
    private readonly host: HTMLElement,
    private readonly onStatus: (status: GameStatus) => void
  ) {}

  async start(): Promise<void> {
    this.renderer = new THREE.WebGPURenderer({ antialias: true, samples: 2 });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    await this.renderer.init();

    this.renderer.domElement.className = 'game-canvas';
    this.host.appendChild(this.renderer.domElement);

    this.controls = new PointerLockControls(this.camera, this.renderer.domElement);

    this.scene.background = new THREE.Color(0xb9cbd2);
    this.scene.fog = new THREE.FogExp2(0xb9cbd2, 0.00009);

    this.scene.add(this.camera, this.sun, this.hemi, this.fill, this.sunTarget);
    this.sun.target = this.sunTarget;
    this.fill.target = this.sunTarget;

    this.bindEvents();
    this.resize();

    this.region = await this.source.load();
    this.adaptive.rebuild(this.region, this.requestedError);

    const ground = this.source.sampleLocal(0, 0) ?? 2100;
    this.camera.position.set(0, ground + 900, 1800);
    this.camera.lookAt(0, ground, -700);

    this.updateSky();
    this.clock.start();
    requestAnimationFrame(this.frame);
  }

  lock(): void { this.controls.lock(); }

  setTerrainError(errorM: number): void {
    this.requestedError = THREE.MathUtils.clamp(errorM, 0.5, 100);
    if (!this.region) return;

    if (this.rebuildTimer) clearTimeout(this.rebuildTimer);
    this.rebuildTimer = setTimeout(() => {
      if (!this.region) return;
      this.adaptive.rebuild(this.region, this.requestedError);
      this.emitStatus();
    }, 120);
  }

  toggleFlyMode(): void {
    this.flyMode = !this.flyMode;
    this.emitStatus();
  }

  toggleTimeMode(): void {
    this.realTime = !this.realTime;
    this.updateSky();
    this.emitStatus();
  }

  private readonly frame = (): void => {
    if (this.stopped) return;
    requestAnimationFrame(this.frame);

    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.fpsFrames++;
    this.fpsWindow += dt;

    if (this.fpsWindow >= 0.5) {
      this.fps = this.fpsFrames / this.fpsWindow;
      this.fpsFrames = 0;
      this.fpsWindow = 0;
    }

    if (this.controls.isLocked) this.move(dt);

    if (!this.flyMode) {
      // Follow the actual rendered adaptive mesh, not the source raster.
      // This prevents the camera from falling inside large simplified triangles.
      const renderedGround = this.adaptive.sampleRenderedHeight(
        this.camera.position.x,
        this.camera.position.z
      );
      const fallbackGround = this.source.sampleLocal(this.camera.position.x, this.camera.position.z);
      const ground = renderedGround ?? fallbackGround;
      if (ground !== null) {
        const target = ground + EYE_HEIGHT + 0.22;
        if (target > this.camera.position.y) {
          this.camera.position.y = target; // never clip upward into the mesh
        } else {
          this.camera.position.y += (target - this.camera.position.y) * (1 - Math.exp(-12 * dt));
        }
      }
    }

    this.renderer.render(this.scene, this.camera);

    const now = performance.now();
    if (now - this.lastStatus > 250) {
      this.lastStatus = now;
      this.emitStatus();
    }
  };

  private move(dt: number): void {
    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);

    if (this.flyMode) {
      const right = new THREE.Vector3().crossVectors(forward, this.camera.up).normalize();
      const move = new THREE.Vector3();

      if (this.keys.has('KeyW')) move.add(forward);
      if (this.keys.has('KeyS')) move.sub(forward);
      if (this.keys.has('KeyD')) move.add(right);
      if (this.keys.has('KeyA')) move.sub(right);

      if (move.lengthSq() > 0) {
        move.normalize();
        const speed =
          this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')
            ? FLY_FAST_SPEED
            : FLY_SPEED;
        this.camera.position.addScaledVector(move, speed * dt);
      }

      if (this.keys.has('Space')) this.camera.position.y += FLY_VERTICAL_SPEED * dt;
      if (this.keys.has('ControlLeft') || this.keys.has('ControlRight')) {
        this.camera.position.y -= FLY_VERTICAL_SPEED * dt;
      }
      return;
    }

    forward.y = 0;
    if (forward.lengthSq() < 1e-6) return;
    forward.normalize();

    const right = new THREE.Vector3().crossVectors(forward, this.camera.up).normalize();
    const move = new THREE.Vector3();

    if (this.keys.has('KeyW')) move.add(forward);
    if (this.keys.has('KeyS')) move.sub(forward);
    if (this.keys.has('KeyD')) move.add(right);
    if (this.keys.has('KeyA')) move.sub(right);

    if (move.lengthSq() > 0) {
      move.normalize();
      const speed =
        this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')
          ? FAST_SPEED
          : WALK_SPEED;
      this.camera.position.addScaledVector(move, speed * dt);
    }
  }

  private updateSky(): void {
    const geo = localToGeoUtm(this.camera.position.x, this.camera.position.z);
    const date = this.realTime ? new Date() : inspectionNoonUtc();
    const sun = bodyPosition(
      Astronomy.Body.Sun,
      date,
      geo.lat,
      geo.lon,
      Math.max(0, this.camera.position.y)
    );

    this.sun.position.copy(this.camera.position).addScaledVector(sun.direction, 7000);
    this.sunTarget.position.copy(this.camera.position);
    this.sunTarget.position.y -= 800;

    this.fill.position.copy(this.camera.position).addScaledVector(sun.direction, -4000);
    this.fill.position.y += 2000;

    const day = THREE.MathUtils.smoothstep(sun.altitudeDeg, -6, 20);
    this.sun.intensity = THREE.MathUtils.lerp(0.05, 2.35, day);
    this.hemi.intensity = THREE.MathUtils.lerp(0.12, 0.9, day);

    const sky = new THREE.Color(0x101825).lerp(new THREE.Color(0xb9cbd2), day);
    this.scene.background = sky;
    if (this.scene.fog instanceof THREE.FogExp2) this.scene.fog.color.copy(sky);
  }

  private emitStatus(): void {
    const geo = localToGeoUtm(this.camera.position.x, this.camera.position.z);
    const ground = this.adaptive.sampleRenderedHeight(this.camera.position.x, this.camera.position.z)
      ?? this.source.sampleLocal(this.camera.position.x, this.camera.position.z)
      ?? 0;
    const stats: TerrainMeshStats = this.adaptive.stats;

    this.onStatus({
      fps: this.fps,
      frameMs: this.fps > 0 ? 1000 / this.fps : 0,
      lat: geo.lat,
      lon: geo.lon,
      groundElevation: ground,
      altitudeAgl: Math.max(0, this.camera.position.y - ground),
      triangles: stats.triangles,
      vertices: stats.vertices,
      meshError: stats.maxError,
      rmsd: stats.rmsd,
      buildMs: stats.buildMs,
      requestedError: this.requestedError,
      backend: (navigator as Navigator & { gpu?: unknown }).gpu ? 'WebGPU' : 'WebGL2',
      locked: this.controls.isLocked,
      flyMode: this.flyMode,
      realTime: this.realTime
    });
  }

  private bindEvents(): void {
    window.addEventListener('resize', this.resize);
    window.addEventListener('keydown', this.keyDown);
    window.addEventListener('keyup', this.keyUp);
    this.controls.addEventListener('lock', this.emitStatusBound);
    this.controls.addEventListener('unlock', this.emitStatusBound);
  }

  private readonly emitStatusBound = (): void => this.emitStatus();

  private readonly keyDown = (event: KeyboardEvent): void => {
    if (this.controls.isLocked && (event.code === 'Space' || event.code.startsWith('Control'))) {
      event.preventDefault();
    }
    this.keys.add(event.code);
    if (event.code === 'KeyF' && !event.repeat) this.toggleFlyMode();
    if (event.code === 'KeyT' && !event.repeat) this.toggleTimeMode();
  };

  private readonly keyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
  };

  private readonly resize = (): void => {
    if (!this.renderer) return;
    const width = this.host.clientWidth;
    const height = this.host.clientHeight;
    this.camera.aspect = Math.max(1, width) / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  };

  stop(): void {
    this.stopped = true;
    if (this.rebuildTimer) clearTimeout(this.rebuildTimer);
    window.removeEventListener('resize', this.resize);
    window.removeEventListener('keydown', this.keyDown);
    window.removeEventListener('keyup', this.keyUp);
    this.adaptive.dispose();
    this.renderer?.dispose();
    this.renderer?.domElement.remove();
  }
}

function inspectionNoonUtc(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      19,
      0,
      0,
      0
    )
  );
}
