(() => {
  'use strict';

  const DEFAULT_MODEL_URL = 'https://www.geo-fs.com/backend/aircraft/repository/CMV%20Probability_267286_5009/prob1.glb';
  const REFRESH_SECONDS = 5;
  const STALE_CYCLES = 3;
  const TAG = '[GeoFS Rail Tracker]';

  let panel, statusEl, timer = null, active = false, inFlight = false;
  let entities = new Map();
  let testEntity = null;
  let lastGoodCount = 0;

  const $ = (id) => panel.querySelector(`#${id}`);
  const setStatus = (text, bad = false) => {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.style.color = bad ? '#ff9f9f' : '#b9f4c8';
  };

  function geoReady() {
    return !!(window.geofs && window.geofs.api && window.geofs.api.viewer && window.Cesium);
  }

  function getViewer() {
    if (!geoReady()) throw new Error('GeoFSが準備できていません。シミュレーターの読み込み完了後に再試行してください。');
    return window.geofs.api.viewer;
  }

  function removeTrackedEntities() {
    if (!geoReady()) return;
    const viewer = getViewer();
    for (const entity of entities.values()) {
      try { viewer.entities.remove(entity); } catch (_) { /* ignore */ }
    }
    entities.clear();
    if (testEntity) {
      try { viewer.entities.remove(testEntity); } catch (_) { /* ignore */ }
      testEntity = null;
    }
  }

  function toNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function getPath(object, path) {
    if (!path) return undefined;
    return path.split('.').filter(Boolean).reduce((value, key) => {
      if (value === null || value === undefined) return undefined;
      if (/^\d+$/.test(key)) return value[Number(key)];
      return value[key];
    }, object);
  }

  function firstPath(object, paths) {
    for (const path of paths) {
      const value = getPath(object, path);
      if (value !== undefined && value !== null && value !== '') return value;
    }
    return undefined;
  }

  function findRecords(payload, customPath) {
    if (customPath.trim()) {
      const value = getPath(payload, customPath.trim());
      if (Array.isArray(value)) return value;
      throw new Error(`配列パス「${customPath}」が見つかりません。空欄にすると自動検出します。`);
    }
    if (Array.isArray(payload)) return payload;
    const commonPaths = [
      'data', 'vehicles', 'vehiclePositions', 'vehicle_positions', 'entities', 'entity',
      'results', 'features', 'response.data', 'data.vehicles', 'data.entity', 'data.entities'
    ];
    for (const path of commonPaths) {
      const value = getPath(payload, path);
      if (Array.isArray(value)) return value;
    }
    throw new Error('車両データの配列を見つけられません。配列パス欄に例: data / entity / features を指定してください。');
  }

  function normalizeRecord(record, fields) {
    const customLat = fields.lat.trim();
    const customLon = fields.lon.trim();
    const customBearing = fields.bearing.trim();
    const customId = fields.id.trim();
    const customAlt = fields.alt.trim();

    let lat = customLat ? getPath(record, customLat) : undefined;
    let lon = customLon ? getPath(record, customLon) : undefined;
    let bearing = customBearing ? getPath(record, customBearing) : undefined;
    let id = customId ? getPath(record, customId) : undefined;
    let altitude = customAlt ? getPath(record, customAlt) : undefined;

    if (lat === undefined) lat = firstPath(record, [
      'position.latitude', 'vehicle.position.latitude', 'latitude', 'lat',
      'properties.latitude', 'properties.lat', 'vehicle.position.lat'
    ]);
    if (lon === undefined) lon = firstPath(record, [
      'position.longitude', 'vehicle.position.longitude', 'longitude', 'lon', 'lng',
      'properties.longitude', 'properties.lon', 'properties.lng', 'vehicle.position.lon'
    ]);
    if (bearing === undefined) bearing = firstPath(record, [
      'position.bearing', 'vehicle.position.bearing', 'bearing', 'heading', 'course',
      'properties.bearing', 'properties.heading'
    ]);
    if (id === undefined) id = firstPath(record, [
      'vehicle.id', 'vehicle.label', 'id', 'vehicleId', 'vehicle_id', 'trip.tripId', 'trip_id',
      'properties.id', 'properties.vehicle_id'
    ]);
    if (altitude === undefined) altitude = firstPath(record, [
      'position.altitude', 'vehicle.position.altitude', 'altitude', 'alt', 'properties.altitude'
    ]);

    // GeoJSON point coordinates are ordered [longitude, latitude, altitude].
    const coords = getPath(record, 'geometry.coordinates');
    if ((lat === undefined || lon === undefined) && Array.isArray(coords) && coords.length >= 2) {
      lon = coords[0]; lat = coords[1]; if (altitude === undefined) altitude = coords[2];
    }

    lat = toNumber(lat); lon = toNumber(lon); bearing = toNumber(bearing); altitude = toNumber(altitude);
    if (lat === null || lon === null || lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
    return {
      id: String(id ?? `${lat.toFixed(6)},${lon.toFixed(6)}`),
      lat, lon,
      bearing: ((bearing ?? 0) + 360) % 360,
      altitude
    };
  }

  function groundAltitude(lat, lon, suppliedAltitude) {
    if (suppliedAltitude !== null && suppliedAltitude !== undefined) return suppliedAltitude;
    try {
      if (typeof window.geofs.getGroundAltitude === 'function') {
        const result = window.geofs.getGroundAltitude([lat, lon, 0]);
        const location = result && result.location;
        if (Array.isArray(location) && Number.isFinite(Number(location[2]))) return Number(location[2]) + 1;
      }
    } catch (error) {
      console.debug(TAG, 'ground elevation lookup failed; using 1 m', error);
    }
    return 1;
  }

  function orientationFor(lon, lat, bearing) {
    const Cesium = window.Cesium;
    const position = Cesium.Cartesian3.fromDegrees(lon, lat, 0);
    // Feed bearings usually use compass degrees: 0=N, 90=E. Offset helps adjust a model's forward axis.
    const offset = toNumber($('headingOffset').value) ?? 0;
    const heading = Cesium.Math.toRadians((bearing + offset + 360) % 360);
    return Cesium.Transforms.headingPitchRollQuaternion(position, new Cesium.HeadingPitchRoll(heading, 0, 0));
  }

  function upsertModel(item, modelUrl, scale) {
    const viewer = getViewer();
    const Cesium = window.Cesium;
    const alt = groundAltitude(item.lat, item.lon, item.altitude);
    const position = Cesium.Cartesian3.fromDegrees(item.lon, item.lat, alt);
    const headingOffset = toNumber($('headingOffset').value) ?? 0;
    const heading = Cesium.Math.toRadians((item.bearing + headingOffset + 360) % 360);
    const orientation = Cesium.Transforms.headingPitchRollQuaternion(
      position, new Cesium.HeadingPitchRoll(heading, 0, 0)
    );

    let entity = entities.get(item.id);
    if (!entity) {
      entity = viewer.entities.add({
        id: `rail-tracker-${item.id}`,
        name: `Rail vehicle ${item.id}`,
        position,
        orientation,
        model: { uri: modelUrl, scale, minimumPixelSize: 2 }
      });
      entities.set(item.id, entity);
    } else {
      entity.position = position;
      entity.orientation = orientation;
      if (entity.model) {
        entity.model.scale = scale;
        entity.model.uri = modelUrl;
      }
    }
    entity.__railSeenCycle = (entity.__railSeenCycle || 0) + 1;
    return entity;
  }

  async function refreshFeed() {
    if (inFlight || !active) return;
    const feedUrl = $('feedUrl').value.trim();
    if (!feedUrl) {
      setStatus('運行データURLが未設定です。テスト配置は利用できます。', true);
      return;
    }
    inFlight = true;
    try {
      const parsedUrl = new URL(feedUrl);
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error('データURLは http(s) のみ使用できます。');
      const response = await fetch(parsedUrl.href, { cache: 'no-store', credentials: 'omit' });
      if (!response.ok) throw new Error(`データ取得失敗: HTTP ${response.status}`);
      const payload = await response.json();
      const records = findRecords(payload, $('recordsPath').value);
      const fields = {
        lat: $('latPath').value, lon: $('lonPath').value,
        bearing: $('bearingPath').value, id: $('idPath').value, alt: $('altPath').value
      };
      const scale = Math.max(0.01, Math.min(100, toNumber($('modelScale').value) ?? 1));
      const modelUrl = $('modelUrl').value.trim() || DEFAULT_MODEL_URL;
      const seen = new Set();
      let updated = 0;
      for (const record of records) {
        const item = normalizeRecord(record, fields);
        if (!item) continue;
        // Duplicate IDs in a feed are ignored so a vehicle maps to only one model.
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        upsertModel(item, modelUrl, scale);
        updated++;
      }
      // Remove vehicles absent from 3 consecutive successful feed updates.
      for (const [id, entity] of entities.entries()) {
        if (!seen.has(id)) {
          entity.__railMissingCycles = (entity.__railMissingCycles || 0) + 1;
          if (entity.__railMissingCycles >= STALE_CYCLES) {
            getViewer().entities.remove(entity);
            entities.delete(id);
          }
        } else {
          entity.__railMissingCycles = 0;
        }
      }
      lastGoodCount = updated;
      setStatus(`更新成功：座標を取得した車両 ${updated} 件 / ${new Date().toLocaleTimeString()}`);
    } catch (error) {
      console.error(TAG, error);
      const corsHint = error instanceof TypeError ? '（CORS制限、または通信エラーの可能性）' : '';
      setStatus(`${error.message}${corsHint}`, true);
    } finally {
      inFlight = false;
    }
  }

  function startTracking() {
    if (!geoReady()) {
      setStatus('GeoFSの読み込み完了後に押してください。', true);
      return;
    }
    stopTracking(false);
    removeTrackedEntities();
    active = true;
    const sec = Math.max(2, Math.min(300, toNumber($('refreshSeconds').value) ?? REFRESH_SECONDS));
    refreshFeed();
    timer = window.setInterval(refreshFeed, sec * 1000);
    setStatus('追跡を開始しました。');
  }

  function stopTracking(updateStatus = true) {
    active = false;
    if (timer !== null) window.clearInterval(timer);
    timer = null;
    inFlight = false;
    if (updateStatus) setStatus('追跡停止中。表示中のモデルは残っています。');
  }

  function placeTestModel() {
    try {
      const viewer = getViewer();
      const aircraft = window.geofs.aircraft && window.geofs.aircraft.instance;
      if (!aircraft || !Array.isArray(aircraft.llaLocation)) throw new Error('機体の位置を取得できません。機体を読み込んでください。');
      if (testEntity) viewer.entities.remove(testEntity);
      const lat = Number(aircraft.llaLocation[0]);
      const lon = Number(aircraft.llaLocation[1]);
      const h = groundAltitude(lat, lon, null);
      const position = window.Cesium.Cartesian3.fromDegrees(lon, lat, h);
      const rawHeading = Number(aircraft.htr && aircraft.htr[0]);
      const bearing = Number.isFinite(rawHeading) ? (window.Cesium.Math.toDegrees(rawHeading) + 360) % 360 : 0;
      const headingOffset = toNumber($('headingOffset').value) ?? 0;
      const orientation = window.Cesium.Transforms.headingPitchRollQuaternion(
        position,
        new window.Cesium.HeadingPitchRoll(window.Cesium.Math.toRadians((bearing + headingOffset) % 360), 0, 0)
      );
      testEntity = viewer.entities.add({
        name: 'Rail Tracker test model',
        position,
        orientation,
        model: {
          uri: $('modelUrl').value.trim() || DEFAULT_MODEL_URL,
          scale: Math.max(0.01, Math.min(100, toNumber($('modelScale').value) ?? 1)),
          minimumPixelSize: 2
        }
      });
      setStatus(`テストモデルを配置しました（${lat.toFixed(5)}, ${lon.toFixed(5)}）。`);
    } catch (error) {
      console.error(TAG, error);
      setStatus(error.message, true);
    }
  }

  function makePanel() {
    panel = document.createElement('section');
    panel.id = 'geofs-rail-tracker-panel';
    panel.style.cssText = [
      'position:fixed', 'right:12px', 'bottom:12px', 'z-index:99999',
      'width:min(380px,calc(100vw - 24px))', 'max-height:80vh', 'overflow:auto',
      'box-sizing:border-box', 'padding:12px', 'border:1px solid #596579',
      'border-radius:8px', 'background:rgba(15,21,32,.96)', 'color:#f2f5f9',
      'font:12px/1.45 Arial,sans-serif', 'box-shadow:0 5px 24px rgba(0,0,0,.45)'
    ].join(';');
    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px">
        <strong style="font-size:14px">GeoFS Rail Tracker</strong>
        <button id="collapse" type="button" style="cursor:pointer">折りたたむ</button>
      </div>
      <div id="trackerBody">
        <label style="display:block;margin:7px 0 3px">3DモデルURL</label>
        <input id="modelUrl" type="url" value="${DEFAULT_MODEL_URL}" style="width:100%;box-sizing:border-box">
        <label style="display:block;margin:7px 0 3px">運行位置JSON URL</label>
        <input id="feedUrl" type="url" placeholder="https://.../vehicle-positions.json" style="width:100%;box-sizing:border-box">
        <div style="font-size:11px;color:#bdc7d8;margin-top:3px">緯度・経度を含むJSONが必要。ブラウザから取得できる（CORS許可済みの）URLを入力。</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:8px">
          <div><label>配列パス（空欄=自動）</label><input id="recordsPath" placeholder="data / entity / features" style="width:100%;box-sizing:border-box"></div>
          <div><label>更新間隔（秒）</label><input id="refreshSeconds" type="number" min="2" max="300" value="5" style="width:100%;box-sizing:border-box"></div>
          <div><label>緯度パス</label><input id="latPath" placeholder="position.latitude" style="width:100%;box-sizing:border-box"></div>
          <div><label>経度パス</label><input id="lonPath" placeholder="position.longitude" style="width:100%;box-sizing:border-box"></div>
          <div><label>方位パス（任意）</label><input id="bearingPath" placeholder="position.bearing" style="width:100%;box-sizing:border-box"></div>
          <div><label>IDパス（任意）</label><input id="idPath" placeholder="vehicle.id" style="width:100%;box-sizing:border-box"></div>
          <div><label>高度パス（任意）</label><input id="altPath" placeholder="position.altitude" style="width:100%;box-sizing:border-box"></div>
          <div><label>モデル倍率</label><input id="modelScale" type="number" min="0.01" max="100" step="0.1" value="1" style="width:100%;box-sizing:border-box"></div>
          <div><label>向き補正（度）</label><input id="headingOffset" type="number" value="0" style="width:100%;box-sizing:border-box"></div>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:10px">
          <button id="testPlace" type="button">現在位置にテスト配置</button>
          <button id="start" type="button">追跡開始</button>
          <button id="stop" type="button">停止</button>
          <button id="clear" type="button">モデル消去</button>
        </div>
        <div id="trackerStatus" role="status" style="margin-top:9px;color:#b9f4c8;overflow-wrap:anywhere">GeoFSの起動を待っています…</div>
        <details style="margin-top:8px"><summary>JSON形式のヒント</summary>
          <div style="color:#cbd4e2;margin-top:5px">標準的な例：<code>[{"id":"T1","position":{"latitude":34.7,"longitude":135.5,"bearing":90}}]</code><br>
          GTFS-Realtimeのバイナリ形式はこの試作では直接読めません。JSON変換済みデータが必要です。駅名や遅延だけの情報には座標がないので、そのままでは地図上に配置できません。</div>
        </details>
      </div>`;
    document.body.appendChild(panel);
    statusEl = $('trackerStatus');
    $('testPlace').addEventListener('click', placeTestModel);
    $('start').addEventListener('click', startTracking);
    $('stop').addEventListener('click', () => stopTracking(true));
    $('clear').addEventListener('click', () => { stopTracking(false); removeTrackedEntities(); setStatus('配置済みモデルを消去しました。'); });
    $('collapse').addEventListener('click', () => {
      const body = $('trackerBody');
      const hidden = body.style.display === 'none';
      body.style.display = hidden ? 'block' : 'none';
      $('collapse').textContent = hidden ? '折りたたむ' : '開く';
    });
  }

  function waitForGeoFS() {
    if (!document.body) {
      window.setTimeout(waitForGeoFS, 500);
      return;
    }
    if (!panel) makePanel();
    if (geoReady()) {
      setStatus('準備完了。まず「現在位置にテスト配置」でモデル表示を確認できます。');
      return;
    }
    setStatus('GeoFSのAPIを待っています…');
    window.setTimeout(waitForGeoFS, 1000);
  }

  waitForGeoFS();
  window.addEventListener('beforeunload', () => stopTracking(false));
})();
