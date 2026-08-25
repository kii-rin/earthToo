<script lang="ts">
  import { onMount } from 'svelte';
  import { Game, START, type GameStatus } from '$lib/game/Game';

  let host: HTMLDivElement;
  let game: Game | null = null;
  let loading = true;
  let error = '';
  let precision = 8;

  let status: GameStatus = {
    fps: 0,
    frameMs: 0,
    lat: START.lat,
    lon: START.lon,
    groundElevation: 0,
    altitudeAgl: 0,
    triangles: 0,
    vertices: 0,
    meshError: 0,
    rmsd: 0,
    buildMs: 0,
    requestedError: precision,
    backend: '…',
    locked: false,
    flyMode: true,
    realTime: false
  };

  onMount(() => {
    const instance = new Game(host, (next) => (status = next));
    game = instance;

    instance
      .start()
      .then(() => {
        loading = false;
        precision = status.requestedError;
      })
      .catch((cause) => {
        console.error(cause);
        error = cause instanceof Error ? cause.message : String(cause);
        loading = false;
      });

    return () => instance.stop();
  });

  function changePrecision(event: Event) {
    precision = Number((event.currentTarget as HTMLInputElement).value);
    game?.setTerrainError(precision);
  }

  function openMaps() {
    window.open(
      `https://www.google.com/maps/search/?api=1&query=${status.lat.toFixed(6)},${status.lon.toFixed(6)}`,
      '_blank',
      'noopener,noreferrer'
    );
  }
</script>

<svelte:head>
  <title>Project Earth — Terrain v0.3</title>
  <meta
    name="description"
    content="Real USGS terrain converted into adaptive low-poly Delaunay geometry"
  />
</svelte:head>

<div class="shell">
  <div
    class="world"
    bind:this={host}
    on:click={() => !status.locked && !loading && !error && game?.lock()}
  ></div>

  <div class="crosshair" class:hidden={!status.locked}></div>

  <header class="brand">
    <strong>PROJECT EARTH</strong>
    <span>Terrain + river study · v0.3</span>
  </header>

  <div class="backend">{status.backend}</div>

  <aside class="panel" on:mousedown|stopPropagation on:click|stopPropagation>
    <div class="headline">
      <strong>{status.fps.toFixed(0)}</strong><span>fps</span>
      <small>{Math.round(status.triangles / 1000)}k tris</small>
    </div>

    <label>
      <div>
        <span>Terrain precision</span>
        <b>± {precision.toFixed(1)} m</b>
      </div>
      <input
        type="range"
        min="0.5"
        max="100"
        step="0.5"
        bind:value={precision}
        on:input={changePrecision}
      />
      <div class="scale"><span>precise</span><span>bold low-poly</span></div>
    </label>

    <div class="detail">
      <span>actual error {status.meshError.toFixed(2)} m</span>
      <span>RMS {status.rmsd.toFixed(2)} m</span>
      <span>build {status.buildMs.toFixed(0)} ms</span>
      <span>area 16.4 × 16.4 km</span>
    </div>

    <div class="coords">
      {status.lat.toFixed(5)}°, {status.lon.toFixed(5)}°
      <button on:click={openMaps}>Maps ↗</button>
    </div>
  </aside>

  <div class="controls">
    <span><kbd>WASD</kbd></span>
    <span><kbd>⇧</kbd> fast</span>
    <button class:active={status.flyMode} on:click={() => game?.toggleFlyMode()}>
      <kbd>F</kbd> fly
    </button>
    {#if status.flyMode}<span><kbd>Space/Ctrl</kbd></span>{/if}
    <button on:click={() => game?.toggleTimeMode()}>
      <kbd>T</kbd> {status.realTime ? 'real sky' : 'noon'}
    </button>
  </div>

  {#if loading}
    <div class="gate">
      <div><small>USGS 3DEP</small><strong>Building adaptive terrain…</strong></div>
    </div>
  {:else if error}
    <div class="gate error">
      <div><small>Terrain error</small><strong>{error}</strong></div>
    </div>
  {/if}
</div>

<style>
  :global(*) { box-sizing: border-box; }
  :global(html, body) { margin: 0; width: 100%; height: 100%; overflow: hidden; background: #111; }
  :global(body) { font-family: Inter, ui-sans-serif, system-ui, sans-serif; color: #f6f4ee; }
  :global(.game-canvas) { display: block; width: 100%; height: 100%; }

  .shell, .world { position: fixed; inset: 0; }
  .world { background: #111; }

  .brand {
    position: fixed; z-index: 20; top: 16px; left: 20px;
    pointer-events: none; text-shadow: 0 1px 10px #0008;
  }
  .brand strong { display: block; font-size: 11px; letter-spacing: .17em; }
  .brand span { display: block; margin-top: 2px; font-size: 9px; color: #ffffff9c; }

  .backend {
    position: fixed; z-index: 20; top: 15px; right: 16px;
    padding: 5px 8px; border-radius: 999px;
    background: #111a; border: 1px solid #ffffff1c;
    backdrop-filter: blur(9px); font-size: 8px; color: #ffffffaa;
  }

  .panel {
    position: fixed; z-index: 24; top: 48px; left: 16px; width: 196px;
    padding: 10px; border-radius: 10px;
    background: #111c; border: 1px solid #ffffff16;
    backdrop-filter: blur(11px); box-shadow: 0 8px 26px #0003;
  }

  .headline { display: flex; align-items: baseline; gap: 4px; }
  .headline strong { font-size: 23px; line-height: 1; letter-spacing: -.04em; }
  .headline span { font-size: 8px; text-transform: uppercase; color: #ffffff7a; }
  .headline small { margin-left: auto; font-size: 8px; color: #ffffff86; }

  label { display: block; margin-top: 10px; padding-top: 8px; border-top: 1px solid #ffffff13; }
  label > div:first-child { display: flex; justify-content: space-between; font-size: 9px; }
  label span { color: #ffffff8c; }
  label b { font-weight: 600; }
  input[type="range"] { width: 100%; margin: 8px 0 2px; accent-color: #d59055; }
  .scale { display: flex; justify-content: space-between; font-size: 7px; color: #ffffff55; }

  .detail { display: flex; flex-wrap: wrap; gap: 3px 8px; margin-top: 8px; font-size: 7px; color: #ffffff68; }
  .coords {
    display: flex; align-items: center; gap: 6px; margin-top: 8px;
    padding-top: 7px; border-top: 1px solid #ffffff13;
    font-size: 8px; color: #ffffff76;
  }
  .coords button {
    margin-left: auto; border: 1px solid #ffffff1b; border-radius: 6px;
    background: #ffffff08; color: #ffffffc5; padding: 4px 6px; font: inherit; cursor: pointer;
  }

  .controls {
    position: fixed; z-index: 24; bottom: 12px; left: 50%;
    transform: translateX(-50%); display: flex; gap: 5px; align-items: center;
  }
  .controls span, .controls button {
    padding: 5px 7px; border: 1px solid #ffffff15; border-radius: 8px;
    background: #111b; color: #ffffffae; backdrop-filter: blur(8px);
    font-size: 8px; white-space: nowrap;
  }
  .controls button { font: inherit; cursor: pointer; }
  .controls button.active { background: #ffffff17; color: #fff; }
  kbd { font-family: inherit; font-weight: 700; color: #fff; }

  .crosshair {
    position: fixed; z-index: 12; top: 50%; left: 50%;
    width: 5px; height: 5px; margin: -2.5px;
    border: 1px solid #fff9; border-radius: 50%; pointer-events: none;
  }
  .crosshair.hidden { display: none; }

  .gate {
    position: fixed; z-index: 50; inset: 0; display: grid; place-items: center;
    background: #08080842;
  }
  .gate > div {
    padding: 16px 20px; border-radius: 12px; background: #111e;
    border: 1px solid #ffffff1a; text-align: center; backdrop-filter: blur(12px);
  }
  .gate small { display: block; margin-bottom: 6px; font-size: 8px; color: #ffffff6a; text-transform: uppercase; }
  .gate strong { font-size: 14px; font-weight: 560; }
  .gate.error strong { color: #efb0a0; font-size: 11px; }
</style>
