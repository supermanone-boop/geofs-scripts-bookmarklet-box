// ==UserScript==
// @name         GeoFS GEBCO Local Terrain
// @namespace    geofs-gebco-local-terrain
// @version      0.1.0
// @description  Load a local GEBCO GeoTIFF and use it as GeoFS terrain inside its coverage.
// @match        https://www.geo-fs.com/*
// @match        https://geo-fs.com/*
// @run-at       document-idle
// @require      https://cdn.jsdelivr.net/npm/geotiff@2.1.3/dist-browser/geotiff.js
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  const KEY = '__geofsGebcoLocalTerrainV1';
  if (window[KEY]?.restore) window[KEY].restore(false);

  const panel = document.createElement('div');
  panel.id = 'geofs-gebco-local-panel';
  panel.style.cssText = [
    'position:fixed', 'z-index:2147483647', 'top:12px', 'right:12px',
    'width:320px', 'padding:12px', 'border-radius:8px',
    'background:rgba(18,22,28,.96)', 'color:#f5f7fa',
    'font:13px/1.45 Arial,sans-serif', 'box-shadow:0 3px 18px #0008'
  ].join(';');
  panel.innerHTML = `
    <div style="font-size:15px;font-weight:700;margin-bottom:8px">GEBCO local terrain</div>
    <div style="margin-bottom:8px">1) Select the GEBCO GeoTIFF (.tif). 2) Apply.</div>
    <input id="gebco-file" type="file" accept=".tif,.tiff,image/tiff" style="width:100%;margin-bottom:8px;color:#f5f7fa">
    <button id="gebco-apply" style="padding:6px 10px;cursor:pointer">Load & apply</button>
    <button id="gebco-restore" style="padding:6px 10px;margin-left:6px;cursor:pointer">Restore</button>
    <div id="gebco-status" style="margin-top:8px;white-space:pre-wrap;overflow-wrap:anywhere">Waiting for GeoFS and a TIFF file.</div>
  `;
  document.body.appendChild(panel);

  const fileInput = panel.querySelector('#gebco-file');
  const applyButton = panel.querySelector('#gebco-apply');
  const restoreButton = panel.querySelector('#gebco-restore');
  const status = panel.querySelector('#gebco-status');
  const setStatus = (message) => { status.textContent = message; };

  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  async function waitForGeoFS() {
    for (let i = 0; i < 60; i++) {
      const viewer = window.geofs?.api?.viewer;
      if (viewer?.terrainProvider && window.Cesium) return viewer;
      await sleep(500);
    }
    throw new Error('GeoFS Cesium viewer not found. Reload GeoFS and try again.');
  }

  function refreshTerrain(viewer, wrapper) {
    // Force Cesium to rebuild its cached terrain tiles after changing the provider method.
    const temporary = new Cesium.EllipsoidTerrainProvider();
    viewer.terrainProvider = temporary;
    viewer.terrainProvider = wrapper;
    viewer.scene.requestRender();
  }

  function pointInBounds(lon, lat, b) {
    return lon >= b.west && lon <= b.east && lat >= b.south && lat <= b.north;
  }

  function sampleBilinear(data, width, height, bounds, noData, lon, lat) {
    if (!pointInBounds(lon, lat, bounds)) return undefined;

    // GeoTIFF coordinates describe pixel edges; raster samples lie at pixel centers.
    const px = (lon - bounds.west) / ((bounds.east - bounds.west) / width) - 0.5;
    const py = (bounds.north - lat) / ((bounds.north - bounds.south) / height) - 0.5;
    const x = Math.max(0, Math.min(width - 1, px));
    const y = Math.max(0, Math.min(height - 1, py));
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1);
    const fx = x - x0, fy = y - y0;
    const items = [
      [data[y0 * width + x0], (1 - fx) * (1 - fy)],
      [data[y0 * width + x1], fx * (1 - fy)],
      [data[y1 * width + x0], (1 - fx) * fy],
      [data[y1 * width + x1], fx * fy]
    ];
    let weighted = 0, weightSum = 0;
    for (const [value, weight] of items) {
      if (weight > 0 && Number.isFinite(value) && value !== noData) {
        weighted += value * weight;
        weightSum += weight;
      }
    }
    return weightSum > 0 ? weighted / weightSum : undefined;
  }

  function restore(refresh = true) {
    const state = window[KEY];
    if (!state) return;
    try {
      state.base.requestTileGeometry = state.originalRequest;
      if (refresh) refreshTerrain(state.viewer, state.wrapper);
    } catch (error) {
      console.warn('[GEBCO] Restore warning:', error);
    }
    delete window[KEY];
    setStatus('Original terrain request method restored.');
  }

  window[KEY] = { restore };
  restoreButton.addEventListener('click', () => restore(true));

  applyButton.addEventListener('click', async () => {
    applyButton.disabled = true;
    try {
      const file = fileInput.files?.[0];
      if (!file) throw new Error('Select the .tif file first.');
      if (!window.GeoTIFF?.fromBlob) throw new Error('GeoTIFF library did not load. Reload the page.');

      setStatus(`Reading ${file.name} (${(file.size / 1048576).toFixed(1)} MiB)…`);
      const tiff = await GeoTIFF.fromBlob(file);
      const image = await tiff.getImage();
      const width = image.getWidth();
      const height = image.getHeight();
      const box = image.getBoundingBox(); // [west, south, east, north]
      if (!box || box.length !== 4 || width < 2 || height < 2) {
        throw new Error('Could not read the GeoTIFF bounds or raster dimensions.');
      }
      const bounds = { west: box[0], south: box[1], east: box[2], north: box[3] };
      const noDataValue = image.getGDALNoData?.();
      const noData = noDataValue == null || noDataValue === '' ? -32767 : Number(noDataValue);
      setStatus(`Decoding ${width.toLocaleString()} × ${height.toLocaleString()} cells…\nBounds: ${bounds.west.toFixed(3)}–${bounds.east.toFixed(3)}°E, ${bounds.south.toFixed(3)}–${bounds.north.toFixed(3)}°N`);
      const rasterResult = await image.readRasters({ interleave: false });
      const raster = Array.isArray(rasterResult) ? rasterResult[0] : rasterResult;
      if (!raster || raster.length !== width * height) throw new Error('Unexpected raster data size.');

      setStatus('Connecting to GeoFS terrain…');
      const viewer = await waitForGeoFS();
      const wrapper = viewer.terrainProvider;
      const base = wrapper.baseProvider;
      if (!base || typeof base.requestTileGeometry !== 'function') {
        throw new Error('GeoFS base terrain provider not found; original terrain left unchanged.');
      }
      const scheme = base.tilingScheme || wrapper.tilingScheme || new Cesium.GeographicTilingScheme();
      const originalRequest = base.requestTileGeometry;
      const TILE_SIZE = 65;
      const MIN_LEVEL = 5;

      // The raster is kept in memory; tiles are sampled only when Cesium requests them.
      const patchedRequest = function (x, y, level, request) {
        const rectangle = scheme.tileXYToRectangle(x, y, level);
        const west = Cesium.Math.toDegrees(rectangle.west);
        const east = Cesium.Math.toDegrees(rectangle.east);
        const south = Cesium.Math.toDegrees(rectangle.south);
        const north = Cesium.Math.toDegrees(rectangle.north);
        const intersects = east > bounds.west && west < bounds.east && north > bounds.south && south < bounds.north;
        if (level < MIN_LEVEL || !intersects) {
          return originalRequest.call(this, x, y, level, request);
        }

        const fullyCovered = west >= bounds.west && east <= bounds.east && south >= bounds.south && north <= bounds.north;
        const makeHeightmap = (fallbackTerrain) => {
          const buffer = new Float32Array(TILE_SIZE * TILE_SIZE);
          for (let row = 0; row < TILE_SIZE; row++) {
            const lat = north - (north - south) * row / (TILE_SIZE - 1);
            for (let col = 0; col < TILE_SIZE; col++) {
              const lon = west + (east - west) * col / (TILE_SIZE - 1);
              let value = sampleBilinear(raster, width, height, bounds, noData, lon, lat);
              if (!Number.isFinite(value) && fallbackTerrain?.interpolateHeight) {
                value = fallbackTerrain.interpolateHeight(rectangle, Cesium.Math.toRadians(lon), Cesium.Math.toRadians(lat));
              }
              // The raster has no NoData cells in the supplied GEBCO clip; this is a defensive fallback.
              buffer[row * TILE_SIZE + col] = Number.isFinite(value) ? value : 0;
            }
          }
          return new Cesium.HeightmapTerrainData({
            buffer,
            width: TILE_SIZE,
            height: TILE_SIZE,
            childTileMask: 15,
            structure: { heightScale: 1, heightOffset: 0, elementsPerHeight: 1, stride: 1 }
          });
        };

        if (fullyCovered) return Promise.resolve(makeHeightmap(null));
        const fallbackRequest = originalRequest.call(this, x, y, level, request);
        if (!fallbackRequest) return undefined; // Let Cesium retry a throttled tile request.
        return Promise.resolve(fallbackRequest).then(makeHeightmap);
      };

      if (window[KEY]?.installed) restore(false);
      base.requestTileGeometry = patchedRequest;
      window[KEY] = {
        viewer, wrapper, base, originalRequest,
        restore: (refresh = true) => {
          base.requestTileGeometry = originalRequest;
          if (refresh) refreshTerrain(viewer, wrapper);
          delete window[KEY];
          setStatus('Original terrain request method restored.');
        },
        installed: true
      };

      refreshTerrain(viewer, wrapper);
      const spacingLon = (bounds.east - bounds.west) / width;
      const spacingLat = (bounds.north - bounds.south) / height;
      setStatus(`Applied GEBCO terrain.\nRaster: ${width.toLocaleString()} × ${height.toLocaleString()}\nGrid spacing: ${spacingLon.toFixed(5)}° × ${spacingLat.toFixed(5)}°\nZoom in over the covered region. Use Restore to undo.`);
      console.info('[GEBCO] Local raster terrain enabled.', { bounds, width, height, noData, minLevel: MIN_LEVEL, tileSize: TILE_SIZE });
    } catch (error) {
      console.error('[GEBCO] Add-on failed:', error);
      const active = window[KEY];
      if (active?.installed && active.base && active.originalRequest) {
        try { active.base.requestTileGeometry = active.originalRequest; } catch (_) {}
        delete window[KEY];
      }
      setStatus(`Failed: ${error?.message || error}\nThe terrain hook was rolled back where possible. Check the console for details.`);
    } finally {
      applyButton.disabled = false;
    }
  });
})();
