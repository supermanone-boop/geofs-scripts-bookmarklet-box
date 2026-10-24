// GeoFS GEBCO Local Terrain — standalone browser script v4
// Performance fix: read only the GeoTIFF window needed by each intersecting tile.
// Do not poll/retry unrelated terrain requests. A normal undefined/deferred return
// from the original provider is passed through unchanged outside the GEBCO area.

(async () => {
  'use strict';

  const KEY = '__geofsGebcoLocalTerrainV4';
  const PANEL_ID = 'geofs-gebco-local-panel';
  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  // Remove an earlier instance first, so its patched request function cannot stack.
  for (const oldKey of ['__geofsGebcoLocalTerrainV4', '__geofsGebcoLocalTerrainV3', '__geofsGebcoLocalTerrainV2', '__geofsGebcoLocalTerrain']) {
    const old = window[oldKey];
    if (!old) continue;
    try {
      if (typeof old.restore === 'function') old.restore(false);
      else if (old.provider && old.originalRequest) old.provider.requestTileGeometry = old.originalRequest;
      else if (old.base && old.originalRequest) old.base.requestTileGeometry = old.originalRequest;
    } catch (e) {
      console.warn('[GEBCO] Could not fully restore an older instance:', e);
    }
    try { delete window[oldKey]; } catch (_) {}
  }
  document.getElementById(PANEL_ID)?.remove();

  function loadGeoTIFFAPI() {
    return (async () => {
      const urls = [
        'https://cdn.jsdelivr.net/npm/geotiff@2.1.3/+esm',
        'https://esm.sh/geotiff@2.1.3?bundle'
      ];
      const errors = [];
      for (const url of urls) {
        try {
          const mod = await import(url);
          const candidates = [mod, mod.GeoTIFF, mod.default, mod.default?.GeoTIFF];
          const api = candidates.find(x => x && (typeof x.fromBlob === 'function' || typeof x.fromArrayBuffer === 'function'));
          if (api) return api;
          errors.push(`${url}: no fromBlob/fromArrayBuffer export`);
        } catch (e) { errors.push(`${url}: ${e?.message || e}`); }
      }
      throw new Error('GeoTIFFライブラリを読み込めませんでした。CDN接続を確認してください。\n' + errors.join('\n'));
    })();
  }

  const panel = document.createElement('div');
  panel.id = PANEL_ID;
  panel.style.cssText = [
    'position:fixed', 'z-index:2147483647', 'top:12px', 'right:12px',
    'width:330px', 'padding:12px', 'border-radius:8px',
    'background:rgba(18,22,28,.96)', 'color:#f5f7fa',
    'font:13px/1.45 Arial,sans-serif', 'box-shadow:0 3px 18px #0008'
  ].join(';');
  panel.innerHTML = `
    <div style="font-size:15px;font-weight:700;margin-bottom:8px">GEBCO local terrain (optimized)</div>
    <div style="margin-bottom:8px">Select a GEBCO GeoTIFF (.tif), then click Load & apply.</div>
    <input id="gebco-file" type="file" accept=".tif,.tiff,image/tiff" style="width:100%;margin-bottom:8px;color:#f5f7fa">
    <button id="gebco-apply" style="padding:6px 10px;cursor:pointer">Load & apply</button>
    <button id="gebco-restore" style="padding:6px 10px;margin-left:6px;cursor:pointer">Restore</button>
    <div id="gebco-status" style="margin-top:8px;white-space:pre-wrap;overflow-wrap:anywhere">Initializing GeoTIFF reader…</div>
  `;
  document.body.appendChild(panel);
  const fileInput = panel.querySelector('#gebco-file');
  const applyButton = panel.querySelector('#gebco-apply');
  const restoreButton = panel.querySelector('#gebco-restore');
  const status = panel.querySelector('#gebco-status');
  const setStatus = message => { status.textContent = message; };

  let GeoTIFFAPI;
  try {
    GeoTIFFAPI = await loadGeoTIFFAPI();
  } catch (e) {
    console.error('[GEBCO] GeoTIFF bootstrap failed:', e);
    setStatus('起動失敗: ' + (e?.message || e));
    return;
  }

  async function waitForGeoFS() {
    for (let i = 0; i < 60; i++) {
      const viewer = window.geofs?.api?.viewer;
      if (viewer?.terrainProvider && window.Cesium) return viewer;
      await sleep(500);
    }
    throw new Error('GeoFS Cesium viewer not found. Reload GeoFS and try again.');
  }

  function refreshTerrain(viewer, wrapper) {
    // Swap briefly to make Cesium discard terrain tiles built by the old method.
    viewer.terrainProvider = new Cesium.EllipsoidTerrainProvider();
    viewer.terrainProvider = wrapper;
    try { viewer.scene.requestRender(); } catch (_) {}
  }

  function pointInBounds(lon, lat, b) {
    return lon >= b.west && lon <= b.east && lat >= b.south && lat <= b.north;
  }

  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

  // readRasters() is windowed per tile; never materialize the full TIFF raster.
  function tileReadWindow(west, south, east, north, bounds, width, height) {
    const iw = Math.max(west, bounds.west);
    const ie = Math.min(east, bounds.east);
    const is = Math.max(south, bounds.south);
    const inn = Math.min(north, bounds.north);
    const dx = (bounds.east - bounds.west) / width;
    const dy = (bounds.north - bounds.south) / height;
    let x0 = clamp(Math.floor((iw - bounds.west) / dx) - 2, 0, width - 1);
    let x1 = clamp(Math.ceil((ie - bounds.west) / dx) + 2, x0 + 1, width);
    let y0 = clamp(Math.floor((bounds.north - inn) / dy) - 2, 0, height - 1);
    let y1 = clamp(Math.ceil((bounds.north - is) / dy) + 2, y0 + 1, height);
    return [x0, y0, x1, y1]; // right/bottom are exclusive
  }

  function sampleWindow(data, dataWidth, dataHeight, windowRect, fullWidth, fullHeight, bounds, noData, lon, lat) {
    const dx = (bounds.east - bounds.west) / fullWidth;
    const dy = (bounds.north - bounds.south) / fullHeight;
    // Clamp points outside the file footprint to its nearest edge pixel. This only
    // affects the small portion of a partial edge tile outside the supplied coverage.
    const px = clamp((lon - bounds.west) / dx - 0.5, 0, fullWidth - 1);
    const py = clamp((bounds.north - lat) / dy - 0.5, 0, fullHeight - 1);
    const gx0 = Math.floor(px), gy0 = Math.floor(py);
    const gx1 = Math.min(fullWidth - 1, gx0 + 1), gy1 = Math.min(fullHeight - 1, gy0 + 1);
    const x0 = gx0 - windowRect[0], x1 = gx1 - windowRect[0];
    const y0 = gy0 - windowRect[1], y1 = gy1 - windowRect[1];
    // A pixel outside the loaded window indicates a malformed GeoTIFF window, not a
    // reason to perform an expensive whole-file read as a fallback.
    if (x0 < 0 || x1 >= dataWidth || y0 < 0 || y1 >= dataHeight) return undefined;
    const fx = px - gx0, fy = py - gy0;
    const items = [
      [data[y0 * dataWidth + x0], (1 - fx) * (1 - fy)],
      [data[y0 * dataWidth + x1], fx * (1 - fy)],
      [data[y1 * dataWidth + x0], (1 - fx) * fy],
      [data[y1 * dataWidth + x1], fx * fy]
    ];
    let sum = 0, weight = 0;
    for (const [v, w] of items) {
      if (w > 0 && Number.isFinite(v) && v !== noData) { sum += v * w; weight += w; }
    }
    return weight > 0 ? sum / weight : undefined;
  }

  let activeState = null;
  function restore(refresh = true) {
    const state = activeState || window[KEY];
    if (!state) return;
    try {
      if (state.provider && state.originalRequest) state.provider.requestTileGeometry = state.originalRequest;
      if (refresh && state.viewer && state.wrapper) refreshTerrain(state.viewer, state.wrapper);
    } catch (e) { console.warn('[GEBCO] Restore warning:', e); }
    if (window[KEY] && (window[KEY] === state || window[KEY].provider === state.provider)) delete window[KEY];
    if (activeState === state) activeState = null;
    setStatus('Original terrain request method restored.');
  }
  window[KEY] = { restore };
  restoreButton.addEventListener('click', () => restore(true));

  applyButton.addEventListener('click', async () => {
    applyButton.disabled = true;
    let newState = null;
    try {
      const file = fileInput.files?.[0];
      if (!file) throw new Error('先に .tif ファイルを選択してください。');
      setStatus(`GeoTIFFヘッダーを読み込み中: ${file.name} (${(file.size / 1048576).toFixed(1)} MiB)\n全画素の一括展開は行いません。`);
      // fromBlob parses TIFF metadata without reading the entire pixel raster.
      const tiff = typeof GeoTIFFAPI.fromBlob === 'function'
        ? await GeoTIFFAPI.fromBlob(file)
        : await GeoTIFFAPI.fromArrayBuffer(await file.arrayBuffer());
      const image = await tiff.getImage();
      const width = image.getWidth(), height = image.getHeight();
      const box = image.getBoundingBox();
      if (!box || box.length !== 4 || width < 2 || height < 2) throw new Error('GeoTIFFの範囲または画素サイズを読み取れません。');
      const bounds = { west: box[0], south: box[1], east: box[2], north: box[3] };
      if (![bounds.west, bounds.south, bounds.east, bounds.north].every(Number.isFinite) || bounds.east <= bounds.west || bounds.north <= bounds.south) {
        throw new Error('GeoTIFFの地理範囲が不正です。経緯度を持つGEBCO GeoTIFFを使用してください。');
      }
      const nd = image.getGDALNoData?.();
      const noData = nd == null || nd === '' ? -32767 : Number(nd);
      setStatus(`GeoTIFF: ${width.toLocaleString()} × ${height.toLocaleString()} cells\n範囲: ${bounds.west.toFixed(3)}–${bounds.east.toFixed(3)}°E, ${bounds.south.toFixed(3)}–${bounds.north.toFixed(3)}°N\nGeoFS地形に接続中…`);
      const viewer = await waitForGeoFS();
      const wrapper = viewer.terrainProvider;
      if (!wrapper || typeof wrapper.requestTileGeometry !== 'function') throw new Error('GeoFS active terrain provider not found.');
      const provider = wrapper;
      const scheme = provider.tilingScheme || provider.baseProvider?.tilingScheme || new Cesium.GeographicTilingScheme();
      const originalRequest = provider.requestTileGeometry;
      const TILE_SIZE = 65;
      // Only replace mid/high-detail requests that intersect the selected raster.
      // Low-detail and out-of-coverage calls are passed straight to GeoFS unchanged.
      const MIN_LEVEL = 7;
      const MAX_TILE_CACHE = 48;
      const tileCache = new Map();

      async function buildTile(x, y, level, rectangle, west, south, east, north, fallbackTerrain) {
        const windowRect = tileReadWindow(west, south, east, north, bounds, width, height);
        const raw = await image.readRasters({ window: windowRect, samples: [0], interleave: true });
        const data = Array.isArray(raw) ? raw[0] : raw;
        const rasterWidth = windowRect[2] - windowRect[0];
        const rasterHeight = windowRect[3] - windowRect[1];
        if (!data || data.length !== rasterWidth * rasterHeight) throw new Error('タイル用GeoTIFF範囲の読み取りに失敗しました。');
        const buffer = new Float32Array(TILE_SIZE * TILE_SIZE);
        for (let row = 0; row < TILE_SIZE; row++) {
          const lat = north - (north - south) * row / (TILE_SIZE - 1);
          for (let col = 0; col < TILE_SIZE; col++) {
            const lon = west + (east - west) * col / (TILE_SIZE - 1);
            let value = sampleWindow(data, rasterWidth, rasterHeight, windowRect, width, height, bounds, noData, lon, lat);
            if (!Number.isFinite(value) && fallbackTerrain?.interpolateHeight && pointInBounds(lon, lat, bounds)) {
              value = fallbackTerrain.interpolateHeight(rectangle, Cesium.Math.toRadians(lon), Cesium.Math.toRadians(lat));
            }
            buffer[row * TILE_SIZE + col] = Number.isFinite(value) ? value : 0;
          }
        }
        return new Cesium.HeightmapTerrainData({
          buffer, width: TILE_SIZE, height: TILE_SIZE, childTileMask: 15,
          structure: { heightScale: 1, heightOffset: 0, elementsPerHeight: 1, stride: 1 }
        });
      }

      function cachedTile(x, y, level, rectangle, west, south, east, north, fallbackTerrain) {
        const key = `${level}/${x}/${y}`;
        if (tileCache.has(key)) {
          const saved = tileCache.get(key);
          tileCache.delete(key); tileCache.set(key, saved);
          return saved;
        }
        const promise = buildTile(x, y, level, rectangle, west, south, east, north, fallbackTerrain);
        tileCache.set(key, promise);
        while (tileCache.size > MAX_TILE_CACHE) tileCache.delete(tileCache.keys().next().value);
        promise.catch(() => { if (tileCache.get(key) === promise) tileCache.delete(key); });
        return promise;
      }

      const patchedRequest = function (x, y, level, request) {
        let rectangle;
        try { rectangle = scheme.tileXYToRectangle(x, y, level); }
        catch (_) { return originalRequest.call(provider, x, y, level, request); }
        const west = Cesium.Math.toDegrees(rectangle.west);
        const east = Cesium.Math.toDegrees(rectangle.east);
        const south = Cesium.Math.toDegrees(rectangle.south);
        const north = Cesium.Math.toDegrees(rectangle.north);
        const intersects = east > bounds.west && west < bounds.east && north > bounds.south && south < bounds.north;
        if (level < MIN_LEVEL || !intersects) {
          // Most important performance fix: no retry/polling wrapper on these requests.
          return originalRequest.call(provider, x, y, level, request);
        }
        const fullyCovered = west >= bounds.west && east <= bounds.east && south >= bounds.south && north <= bounds.north;
        if (fullyCovered) return cachedTile(x, y, level, rectangle, west, south, east, north, null);

        // Edge tiles are uncommon. Ask GeoFS for its normal terrain once so samples
        // outside the GEBCO bounds can retain the original ground where available.
        // If GeoFS defers this one request (undefined), immediately use the local
        // edge-clamped raster instead of polling/retrying and stalling every tile.
        let baseResult;
        try { baseResult = originalRequest.call(provider, x, y, level, request); }
        catch (e) { console.warn('[GEBCO] Original terrain failed on edge tile:', e); }
        if (baseResult == null) return cachedTile(x, y, level, rectangle, west, south, east, north, null);
        return Promise.resolve(baseResult).then(
          terrain => cachedTile(x, y, level, rectangle, west, south, east, north, terrain || null),
          error => {
            console.warn('[GEBCO] Using edge-clamped GEBCO data for partial tile:', error);
            return cachedTile(x, y, level, rectangle, west, south, east, north, null);
          }
        );
      };

      // Safe re-apply: restore the prior hook before installing a fresh one.
      if (activeState?.provider && activeState.originalRequest) {
        try { activeState.provider.requestTileGeometry = activeState.originalRequest; } catch (_) {}
      }
      newState = { viewer, wrapper, provider, originalRequest, installed: true };
      activeState = newState;
      window[KEY] = { ...newState, restore };
      provider.requestTileGeometry = patchedRequest;
      refreshTerrain(viewer, wrapper);

      const spacingLon = (bounds.east - bounds.west) / width;
      const spacingLat = (bounds.north - bounds.south) / height;
      setStatus(`適用しました。全画素の一括読み込みなし。\nRaster: ${width.toLocaleString()} × ${height.toLocaleString()}\nGrid: ${spacingLon.toFixed(5)}° × ${spacingLat.toFixed(5)}°\n対象範囲内の必要なタイル部分だけを読み込みます。\n詳細地形は level ${MIN_LEVEL} 以上。Restoreで元に戻せます。`);
      console.info('[GEBCO] Optimized local raster terrain enabled.', { bounds, width, height, noData, minLevel: MIN_LEVEL, tileSize: TILE_SIZE, windowedReads: true });
    } catch (e) {
      console.error('[GEBCO] Add-on failed:', e);
      if (newState?.provider && newState.originalRequest) {
        try { newState.provider.requestTileGeometry = newState.originalRequest; } catch (_) {}
        if (activeState === newState) activeState = null;
        if (window[KEY]) delete window[KEY];
      }
      setStatus(`失敗: ${e?.message || e}\n地形フックは可能な範囲で元に戻しました。コンソールを確認してください。`);
    } finally {
      applyButton.disabled = false;
    }
  });
})().catch(e => {
  console.error('[GEBCO] Unexpected startup error:', e);
  alert('[GEBCO] 起動失敗: ' + (e?.message || e));
});
