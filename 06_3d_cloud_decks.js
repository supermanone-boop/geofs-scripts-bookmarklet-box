/*
 * GeoFS RealWorld 7 — scenery and world traffic add-on pack
 * OpenStreetMap data © OpenStreetMap contributors (ODbL).
 * This add-on does not replace aircraft flight physics or the GeoFS terrain provider.
 */
(() => {
  'use strict';
  if (window.GRW7 && window.GRW7.version) {
    if (Array.isArray(window.GRW7.availableFeatures) && window.GRW7.availableFeatures.includes('clouds')) {
      window.GRW7.start('clouds');
    } else {
      alert('A different RealWorld standalone is already loaded. Reload GeoFS or use the integrated seven-feature dashboard.');
    }
    return;
  }

  const VERSION = '1.0.0';
  const C = window.Cesium;
  const OSM_ENDPOINTS = [
    'https://overpass.private.coffee/api/interpreter',
    'https://overpass-api.de/api/interpreter'
  ];
  const MAX_BUILDINGS = 450;
  const MAX_ROADS = 180;
  const MAX_RAILS = 90;
  const MAX_TREES = 520;

  const state = {
    viewer: null,
    host: null,
    root: null,
    statusNode: null,
    buttons: new Map(),
    active: new Map(),
    osmCache: null,
    osmRequest: null,
    lastOsmFetch: 0,
    savedTerrain: null
  };

  const FEATURE_INFO = [
    ['clouds', '3D Cloud Decks', 'Procedural layered cloud clusters with drift']
  ];
  const css = `
    :host{all:initial;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#eaf0f6}
    *{box-sizing:border-box}
    .panel{width:min(354px,calc(100vw - 22px));max-height:min(78vh,690px);overflow:auto;background:rgba(15,23,32,.96);border:1px solid rgba(180,205,226,.32);border-radius:13px;box-shadow:0 12px 40px #0008;backdrop-filter:blur(12px);color:#eaf0f6;font-size:13px}
    .head{display:flex;align-items:center;gap:8px;padding:11px 12px;border-bottom:1px solid #ffffff1e;position:sticky;top:0;background:rgba(15,23,32,.98);z-index:2}
    .mark{width:28px;height:28px;border-radius:8px;background:#1f536b;display:grid;place-items:center;font-weight:800;color:#e6f9ff;font-size:11px;letter-spacing:-.5px;flex:none}
    .brand{flex:1;min-width:0}.title{font-weight:800;letter-spacing:.3px;font-size:13px}.sub{font-size:10px;color:#9fb2c3;margin-top:2px}
    button{font:inherit;cursor:pointer;color:#eaf0f6;border:1px solid #ffffff28;background:#243442;border-radius:8px;padding:8px 9px;min-height:34px;touch-action:manipulation}
    button:active{transform:translateY(1px)}button:disabled{opacity:.45;cursor:wait}
    .head button{min-width:31px;padding:3px 7px;background:#1b2833}
    .body{padding:10px;display:block}.grid{display:grid;grid-template-columns:1fr 1fr;gap:7px}
    .feature{display:flex;flex-direction:column;align-items:flex-start;text-align:left;gap:4px;min-height:68px;background:#1a2a36}
    .feature b{font-size:12px;line-height:1.25;font-weight:750}.feature span{font-size:10px;color:#a8bbc9;line-height:1.25}
    .feature.active{border-color:#77d7bf;background:#1d423f;box-shadow:inset 0 0 0 1px #77d7bf35}.feature.active span{color:#bcebdc}
    .row{display:flex;gap:7px;margin-top:8px}.row button{flex:1}
    .primary{background:#214e67;border-color:#4f829d}.danger{background:#4a2d31;border-color:#855257}
    .status{margin-top:9px;padding:8px 9px;border-radius:7px;background:#0b131b;color:#c0cfda;line-height:1.45;font-size:11px;white-space:pre-wrap;overflow-wrap:anywhere;min-height:34px}
    .status.error{color:#ffc1ba}.status.good{color:#b3e7cf}
    .relief{margin-top:9px;padding:8px 9px;border-radius:8px;background:#1a2834;display:none}.relief.show{display:block}
    .relief-head{display:flex;justify-content:space-between;gap:10px;font-size:11px;margin-bottom:5px}.relief input{width:100%;accent-color:#75c8d5}
    .foot{padding:8px 11px;border-top:1px solid #ffffff1a;font-size:9px;line-height:1.4;color:#8da4b5}
    .collapsed .body,.collapsed .foot{display:none}
  `;

  function findViewer() {
    const candidates = [
      window.geofs && window.geofs.api && window.geofs.api.viewer,
      window.geofs && window.geofs.viewer,
      window.cesiumViewer,
      window.viewer
    ];
    return candidates.find(v => v && v.scene && v.entities && v.camera) || null;
  }

  function validLLA(lon, lat, alt) {
    return Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lon) <= 180 && Math.abs(lat) <= 90
      ? { lon, lat, alt: Number.isFinite(alt) ? alt : 0 } : null;
  }

  function parseLLA(value) {
    if (!value) return null;
    if ((Array.isArray(value) || ArrayBuffer.isView(value)) && value.length >= 2) {
      const a = Number(value[0]), b = Number(value[1]), h = Number(value[2] || 0);
      // GeoFS LLA locations are normally [longitude, latitude, altitude].
      if (Math.abs(a) > 90 && Math.abs(b) <= 90) return validLLA(a, b, h);
      if (Math.abs(b) > 90 && Math.abs(a) <= 90) return validLLA(b, a, h);
      return validLLA(a, b, h);
    }
    if (typeof value === 'object') {
      if (Number.isFinite(value.longitude) && Number.isFinite(value.latitude)) {
        let lon = value.longitude, lat = value.latitude;
        if (Math.abs(lon) <= Math.PI * 2 && Math.abs(lat) <= Math.PI / 2) { lon = lon * 180 / Math.PI; lat = lat * 180 / Math.PI; }
        return validLLA(lon, lat, Number(value.altitude ?? value.height ?? value.alt ?? 0));
      }
      if (Number.isFinite(value.lon) && Number.isFinite(value.lat)) return validLLA(value.lon, value.lat, Number(value.alt ?? value.altitude ?? 0));
    }
    return null;
  }

  function getCenter() {
    const viewer = state.viewer || findViewer();
    if (!viewer || !C) throw new Error('GeoFS Cesium viewer was not found. Open the game first.');
    state.viewer = viewer;
    const aircraft = window.geofs && window.geofs.aircraft && window.geofs.aircraft.instance;
    const candidates = [aircraft && aircraft.llaLocation, aircraft && aircraft.currentLLA, aircraft && aircraft.locationLLA, aircraft && aircraft.lla];
    for (const value of candidates) {
      const p = parseLLA(value);
      if (p) return p;
    }
    try {
      const c = viewer.scene.camera.positionCartographic || C.Cartographic.fromCartesian(viewer.scene.camera.positionWC);
      return { lon: C.Math.toDegrees(c.longitude), lat: C.Math.toDegrees(c.latitude), alt: c.height || 0 };
    } catch (_) {
      throw new Error('Could not read the current aircraft/camera location.');
    }
  }

  function addOffset(origin, eastM, northM, altitude) {
    const lat = origin.lat + northM / 111320;
    const lon = origin.lon + eastM / (111320 * Math.max(0.15, Math.cos(origin.lat * Math.PI / 180)));
    return { lon, lat, alt: altitude || 0 };
  }

  function metersBetween(a, b) {
    const rad = Math.PI / 180;
    const p1 = a.lat * rad, p2 = b.lat * rad;
    const dlat = (b.lat - a.lat) * rad, dlon = (b.lon - a.lon) * rad;
    const q = Math.sin(dlat / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dlon / 2) ** 2;
    return 6371000 * 2 * Math.atan2(Math.sqrt(q), Math.sqrt(Math.max(0, 1 - q)));
  }

  function getGround(lon, lat) {
    try {
      const h = state.viewer.scene.globe.getHeight(C.Cartographic.fromDegrees(lon, lat));
      return Number.isFinite(h) ? h : 0;
    } catch (_) { return 0; }
  }

  function setStatus(message, kind) {
    if (!state.statusNode) return;
    state.statusNode.textContent = message;
    state.statusNode.className = 'status' + (kind ? ' ' + kind : '');
  }

  function makeUI() {
    if (state.host && state.host.isConnected) return;
    const host = document.createElement('div');
    host.id = 'geofs-realworld-7-host';
    host.style.cssText = 'position:fixed;right:10px;top:78px;z-index:2147483000;pointer-events:auto;max-width:calc(100vw - 20px);';
    const root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
    root.innerHTML = `<style>${css}</style>
      <section class="panel" id="panel">
        <header class="head">
          <div class="mark">RW7</div><div class="brand"><div class="title">GEOfs REALWORLD 7</div><div class="sub">Scenery • transport • terrain</div></div>
          <button id="min" aria-label="Minimize">−</button><button id="close" aria-label="Close">×</button>
        </header>
        <div class="body">
          <div class="grid" id="features"></div>
          <div class="relief" id="relief"><div class="relief-head"><span>Terrain exaggeration</span><b id="reliefValue">1.35×</b></div><input id="reliefSlider" type="range" min="1" max="1.8" step="0.05" value="1.35" /></div>
          <div class="row"><button class="primary" id="refresh">Refresh at current location</button><button class="danger" id="clear">Clear all</button></div>
          <div class="status" id="status">Ready. Enable a feature to load nearby world detail.</div>
        </div>
        <footer class="foot">OSM data © OpenStreetMap contributors. Buildings, roads and rails follow mapped geometry. Moving vehicles and ships are simulated, not live tracking.</footer>
      </section>`;
    document.body.appendChild(host);
    state.host = host;
    state.root = root;
    const panel = root.querySelector('#panel');
    const list = root.querySelector('#features');
    FEATURE_INFO.forEach(([id, label, description]) => {
      const button = document.createElement('button');
      button.className = 'feature';
      button.dataset.feature = id;
      button.innerHTML = `<b>${label}</b><span>${description}</span>`;
      button.addEventListener('click', () => toggleFeature(id));
      list.appendChild(button);
      state.buttons.set(id, button);
    });
    state.statusNode = root.querySelector('#status');
    root.querySelector('#min').addEventListener('click', () => panel.classList.toggle('collapsed'));
    root.querySelector('#close').addEventListener('click', () => { stopAll(); host.remove(); state.host = null; state.root = null; state.statusNode = null; state.buttons.clear(); });
    root.querySelector('#clear').addEventListener('click', stopAll);
    root.querySelector('#refresh').addEventListener('click', refreshActive);
    const slider = root.querySelector('#reliefSlider');
    slider.addEventListener('input', () => {
      const x = Number(slider.value);
      root.querySelector('#reliefValue').textContent = x.toFixed(2) + '×';
      const r = state.active.get('terrain');
      if (r && state.viewer && state.viewer.scene.globe) state.viewer.scene.globe.terrainExaggeration = x;
    });
    if (window.matchMedia && window.matchMedia('(max-width: 520px)').matches) host.style.top = '66px';
  }

  function updateButton(id, on) {
    const b = state.buttons.get(id);
    if (b) b.classList.toggle('active', !!on);
    if (state.root && id === 'terrain') state.root.querySelector('#relief').classList.toggle('show', !!on);
  }

  function makeState(id) {
    return { id, cancelled: false, dataSources: [], primitives: [], timers: [], cleanupFns: [], entities: [], started: Date.now() };
  }

  async function addDataSource(s, name) {
    if (s.cancelled) throw new Error('Cancelled');
    const ds = new C.CustomDataSource('GRW7 ' + name);
    await state.viewer.dataSources.add(ds);
    if (s.cancelled) { state.viewer.dataSources.remove(ds, true); throw new Error('Cancelled'); }
    s.dataSources.push(ds);
    return ds;
  }

  function addPrimitive(s, primitive) {
    if (s.cancelled) return null;
    const p = state.viewer.scene.primitives.add(primitive);
    s.primitives.push(p);
    return p;
  }

  function clearState(s) {
    if (!s) return;
    s.cancelled = true;
    s.timers.forEach(t => { try { clearInterval(t); clearTimeout(t); } catch (_) {} });
    s.cleanupFns.forEach(fn => { try { fn(); } catch (_) {} });
    s.dataSources.forEach(ds => { try { state.viewer && state.viewer.dataSources.remove(ds, true); } catch (_) {} });
    s.primitives.forEach(p => { try { state.viewer && state.viewer.scene.primitives.remove(p); } catch (_) {} });
  }

  function stopFeature(id, silent) {
    const s = state.active.get(id);
    if (!s) return;
    state.active.delete(id);
    clearState(s);
    updateButton(id, false);
    if (!silent) setStatus(FEATURE_INFO.find(x => x[0] === id)[1] + ' removed.', 'good');
  }

  function stopAll() {
    [...state.active.keys()].forEach(id => stopFeature(id, true));
    setStatus('All RealWorld layers removed. Original GeoFS terrain settings restored.', 'good');
  }

  async function toggleFeature(id) {
    if (state.active.has(id)) { stopFeature(id); return; }
    let viewer = findViewer();
    if (!viewer || !C) { setStatus('GeoFS/Cesium is not ready. Open a flight, then try again.', 'error'); return; }
    state.viewer = viewer;
    const s = makeState(id);
    state.active.set(id, s);
    updateButton(id, true);
    const info = FEATURE_INFO.find(x => x[0] === id);
    const loadingMessage = 'Loading ' + info[1] + '…';
    setStatus(loadingMessage);
    try {
      await FEATURES[id](s);
      if (!s.cancelled && state.statusNode && state.statusNode.textContent === loadingMessage) setStatus(FEATURE_INFO.find(x => x[0] === id)[1] + ' is active.', 'good');
    } catch (e) {
      if (e && e.message === 'Cancelled') return;
      stopFeature(id, true);
      setStatus(info[1] + ' failed: ' + (e && e.message ? e.message : String(e)), 'error');
      console.error('[GRW7]', id, e);
    }
  }

  async function refreshActive() {
    const ids = [...state.active.keys()];
    if (!ids.length) { setStatus('Nothing is active. Enable any feature first.'); return; }
    ids.forEach(id => stopFeature(id, true));
    state.osmCache = null;
    state.osmRequest = null;
    setStatus('Refreshing active scenery at the current location…');
    for (const id of ids) {
      await toggleFeature(id);
      // Let the first feature populate the shared OSM cache before the others begin.
      await new Promise(resolve => setTimeout(resolve, 1200));
    }
  }

  function bboxFor(center) {
    const dLat = 0.018;
    const dLon = Math.min(0.06, 0.018 / Math.max(0.25, Math.cos(center.lat * Math.PI / 180)));
    return { s: center.lat - dLat, n: center.lat + dLat, w: center.lon - dLon, e: center.lon + dLon };
  }

  function inCachedArea(center, cache) {
    return cache && Date.now() - cache.time < 12 * 60 * 1000 && metersBetween(center, cache.center) < 1800;
  }

  async function getOSM() {
    const center = getCenter();
    if (inCachedArea(center, state.osmCache)) return state.osmCache.data;
    if (state.osmRequest) return state.osmRequest;
    const box = bboxFor(center);
    const f = n => Number(n).toFixed(5);
    const b = `(${f(box.s)},${f(box.w)},${f(box.n)},${f(box.e)})`;
    const query = `[out:json][timeout:25];(way["building"]${b};way["railway"~"^(rail|light_rail|subway|tram|narrow_gauge)$"]${b};way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service)$"]${b};way["landuse"="forest"]${b};way["natural"~"^(wood|tree_row)$"]${b};node["natural"="tree"]${b};way["route"="ferry"]${b};relation["route"="ferry"]${b};);out geom;`;
    state.osmRequest = (async () => {
      let lastError;
      for (let i = 0; i < OSM_ENDPOINTS.length; i++) {
        const endpoint = OSM_ENDPOINTS[i];
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 32000);
        try {
          const response = await fetch(endpoint, {
            method: 'POST', signal: controller.signal,
            headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
            body: 'data=' + encodeURIComponent(query), cache: 'no-store', credentials: 'omit'
          });
          if (response.status === 429) throw new Error('OpenStreetMap query limit reached (HTTP 429). Please wait before retrying.');
          if (!response.ok) throw new Error('Overpass HTTP ' + response.status);
          const data = await response.json();
          if (!data || !Array.isArray(data.elements)) throw new Error('Unexpected Overpass response.');
          state.osmCache = { center, time: Date.now(), data };
          state.lastOsmFetch = Date.now();
          return data;
        } catch (error) {
          lastError = error;
          if (error && /HTTP 429/.test(error.message)) break;
        } finally { clearTimeout(timeout); }
      }
      throw lastError || new Error('OpenStreetMap data could not be loaded.');
    })();
    try { return await state.osmRequest; }
    finally { state.osmRequest = null; }
  }

  function hasGeom(el) { return el && Array.isArray(el.geometry) && el.geometry.length >= 2; }
  function geomCoords(el) { return (el.geometry || []).filter(p => Number.isFinite(p.lon) && Number.isFinite(p.lat)).map(p => ({ lon: p.lon, lat: p.lat })); }
  function averagePoint(points) { return { lon: points.reduce((a,p)=>a+p.lon,0)/points.length, lat: points.reduce((a,p)=>a+p.lat,0)/points.length }; }
  function routeLength(points) {
    const segments = []; let total = 0;
    for (let i=1;i<points.length;i++) { const len=metersBetween({lon:points[i-1].lon,lat:points[i-1].lat},{lon:points[i].lon,lat:points[i].lat}); if (len > 0.1) { segments.push({a:points[i-1],b:points[i],start:total,len}); total += len; } }
    return { points, segments, total };
  }
  function routeAt(route, distance) {
    if (!route || !route.total || !route.segments.length) return null;
    let d = ((distance % route.total) + route.total) % route.total;
    let seg = route.segments[route.segments.length - 1];
    for (const item of route.segments) { if (d <= item.start + item.len) { seg = item; break; } }
    const t = Math.max(0, Math.min(1, (d - seg.start) / seg.len));
    const lon = seg.a.lon + (seg.b.lon - seg.a.lon) * t;
    const lat = seg.a.lat + (seg.b.lat - seg.a.lat) * t;
    const p1 = seg.a.lat * Math.PI / 180, p2 = seg.b.lat * Math.PI / 180;
    const dl = (seg.b.lon - seg.a.lon) * Math.PI / 180;
    const y = Math.sin(dl) * Math.cos(p2);
    const x = Math.cos(p1)*Math.sin(p2)-Math.sin(p1)*Math.cos(p2)*Math.cos(dl);
    return { lon, lat, heading: Math.atan2(y,x), alt: 0 };
  }
  function entityOrientation(entity, pos, heading) {
    const point = C.Cartesian3.fromDegrees(pos.lon, pos.lat, pos.alt || 0);
    entity.position = point;
    entity.orientation = C.Transforms.headingPitchRollQuaternion(point, new C.HeadingPitchRoll(heading, 0, 0));
  }
  function within(center, point, maxMeters) { return metersBetween(center, point) <= maxMeters; }
  function seeded(id, index) { let x = ((Number(id)||index||7) * 2654435761 + index * 2246822519) >>> 0; return () => { x = (x + 0x6D2B79F5) >>> 0; let t = x; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function color(hex, alpha) { const c = C.Color.fromCssColorString(hex); return alpha == null ? c : c.withAlpha(alpha); }

  async function buildings(s) {
    const center = getCenter();
    const osm = await getOSM(); if (s.cancelled) return;
    const all = osm.elements.filter(el => el.type === 'way' && el.tags && el.tags.building && hasGeom(el));
    all.sort((a,b) => metersBetween(center, averagePoint(geomCoords(a))) - metersBetween(center, averagePoint(geomCoords(b))));
    const source = await addDataSource(s, 'Buildings');
    let count = 0;
    for (const way of all) {
      if (s.cancelled || count >= MAX_BUILDINGS) break;
      const pts = geomCoords(way);
      if (pts.length < 4 || !within(center, averagePoint(pts), 2500)) continue;
      const closed = metersBetween(pts[0], pts[pts.length-1]) < 8;
      if (!closed) pts.push(pts[0]);
      if (pts.length < 4) continue;
      const tags = way.tags;
      const taggedHeight = parseFloat(String(tags.height || '').replace(',', '.'));
      const levels = parseFloat(tags['building:levels'] || tags.levels || '');
      let h = Number.isFinite(taggedHeight) && taggedHeight > 0 ? taggedHeight : Number.isFinite(levels) && levels > 0 ? levels * 3.05 : 6.5;
      if (tags.building === 'industrial' || tags.building === 'warehouse' || tags.building === 'commercial') h = Math.max(h, 8);
      if (tags.building === 'apartments' && !Number.isFinite(levels)) h = 18;
      h = Math.max(2.7, Math.min(160, h));
      const mid = averagePoint(pts); const ground = getGround(mid.lon, mid.lat);
      let baseHex = '#b8b5ac';
      if (/house|detached|residential|semidetached/.test(tags.building)) baseHex = '#c9bba2';
      else if (/industrial|warehouse|retail/.test(tags.building)) baseHex = '#8d989f';
      else if (/apartments|commercial|office|hotel/.test(tags.building)) baseHex = '#a6b3bc';
      else if (/church|cathedral|religious/.test(tags.building)) baseHex = '#b4aa9a';
      const rnd = seeded(way.id, count)();
      const base = C.Color.fromCssColorString(baseHex).withAlpha(0.96);
      const hierarchy = new C.PolygonHierarchy(C.Cartesian3.fromDegreesArray(pts.flatMap(p => [p.lon, p.lat])));
      const entity = source.entities.add({
        id: 'grw7-building-' + way.id,
        name: 'OSM building ' + way.id,
        polygon: {
          hierarchy, height: ground, extrudedHeight: ground + h,
          material: base, outline: true, outlineColor: color('#555d62', 0.9),
          closeTop: true, closeBottom: true, arcType: C.ArcType.GEODESIC
        }
      });
      count++;
      if (h > 42 && count < 50) {
        source.entities.add({ position: C.Cartesian3.fromDegrees(mid.lon, mid.lat, ground + h + 2), label: {
          text: String(tags.name || tags['name:en'] || 'Building'), font: '11px sans-serif', fillColor: color('#ffffff'), outlineColor: color('#1c2830'), outlineWidth: 2,
          style: C.LabelStyle.FILL_AND_OUTLINE, verticalOrigin: C.VerticalOrigin.BOTTOM, disableDepthTestDistance: 2000,
          distanceDisplayCondition: new C.DistanceDisplayCondition(0, 9000)
        }});
      }
    }
    setStatus(`Buildings & Houses: ${count} mapped footprints loaded. Some areas may have incomplete OSM height tags.`, 'good');
  }

  async function rail(s) {
    const center = getCenter(); const osm = await getOSM(); if (s.cancelled) return;
    const ways = osm.elements.filter(el => el.type === 'way' && el.tags && el.tags.railway && hasGeom(el) && !/abandoned|disused|razed|construction/.test(el.tags.railway));
    ways.sort((a,b) => metersBetween(center, averagePoint(geomCoords(a))) - metersBetween(center, averagePoint(geomCoords(b))));
    const source = await addDataSource(s, 'Railways and trains');
    let drawn=0;
    const routes=[];
    for (const way of ways) {
      if (s.cancelled || drawn >= MAX_RAILS) break;
      let pts=geomCoords(way); if (pts.length<2 || !pts.some(p=>within(center,p,3200))) continue;
      const route=routeLength(pts);
      const colorHex = way.tags.railway === 'tram' ? '#5a646a' : '#4b5359';
      source.entities.add({ polyline:{ positions:C.Cartesian3.fromDegreesArray(pts.flatMap(p=>[p.lon,p.lat])), width:5, material:color(colorHex,0.78), clampToGround:true } });
      source.entities.add({ polyline:{ positions:C.Cartesian3.fromDegreesArray(pts.flatMap(p=>[p.lon,p.lat])), width:1.5, material:color('#c6cbd0',0.92), clampToGround:true } });
      drawn++;
      if (route.total > 700 && !/tram/.test(way.tags.railway)) routes.push({route, id:way.id});
    }
    routes.sort((a,b)=>b.route.total-a.route.total);
    const selected = routes.slice(0, Math.min(3, routes.length));
    let trainCars=0;
    const palettes = [['#d94742','#ece8e0'],['#1685a4','#e9eef1'],['#24855a','#e6e6df']];
    selected.forEach((item, index) => {
      const palette = palettes[index % palettes.length];
      const cars=[]; const carCount=5;
      for(let j=0;j<carCount;j++) {
        const isEngine=j===0;
        const body=source.entities.add({ box:{ dimensions:new C.Cartesian3(isEngine?16:14.2, isEngine?3.0:2.85, isEngine?3.7:3.35), material:color(isEngine?palette[0]:palette[1]), outline:true, outlineColor:color('#333a3f',0.9) } });
        const glass=source.entities.add({ box:{ dimensions:new C.Cartesian3(isEngine?8.5:9.5, 2.91, 0.83), material:color('#293943',0.95), outline:false } });
        cars.push({body,glass,j}); trainCars++;
      }
      const start=index*item.route.total/selected.length;
      let distance=start;
      const update=()=>{
        if (s.cancelled) return;
        cars.forEach(car=>{
          const p=routeAt(item.route,distance-car.j*16.8);
          if(!p)return;
          const g=getGround(p.lon,p.lat);
          entityOrientation(car.body,{lon:p.lon,lat:p.lat,alt:g+2.0},p.heading);
          entityOrientation(car.glass,{lon:p.lon,lat:p.lat,alt:g+2.65},p.heading);
        });
        distance += 13.5;
      };
      update();
      const timer=setInterval(update,700); s.timers.push(timer);
    });
    if (!drawn) setStatus('No mapped railway was found in this area. Try near a railway or press Refresh after moving.', 'error');
    else setStatus(`Railways: ${drawn} mapped segments. ${selected.length} simulated trains / ${trainCars} cars follow real mapped rail geometry.`, 'good');
  }

  async function roads(s) {
    const center=getCenter(); const osm=await getOSM(); if(s.cancelled)return;
    const ways=osm.elements.filter(el=>el.type==='way'&&el.tags&&el.tags.highway&&hasGeom(el));
    ways.sort((a,b)=>metersBetween(center,averagePoint(geomCoords(a))) - metersBetween(center,averagePoint(geomCoords(b))));
    const source=await addDataSource(s,'Roads and traffic');
    let drawn=0;const routes=[];
    for(const way of ways){
      if(s.cancelled||drawn>=MAX_ROADS)break;
      const pts=geomCoords(way);if(pts.length<2||!pts.some(p=>within(center,p,2800)))continue;
      const type=way.tags.highway;
      const width=/motorway|trunk/.test(type)?3.2:/primary|secondary/.test(type)?2.4:/tertiary/.test(type)?1.7:1.0;
      source.entities.add({polyline:{positions:C.Cartesian3.fromDegreesArray(pts.flatMap(p=>[p.lon,p.lat])),width,material:color('#5a6267',0.72),clampToGround:true}});
      drawn++;
      const rt=routeLength(pts);
      if(rt.total>280&&/^(primary|secondary|tertiary|residential|unclassified|living_street)$/.test(type))routes.push({route:rt,id:way.id,type});
    }
    routes.sort((a,b)=>b.route.total-a.route.total);
    const selected=routes.slice(0,Math.min(7,routes.length));
    const paints=['#e8e7e2','#c63131','#20282d','#2968a6','#b5b8ba','#e3bb36','#f2f2f2','#337d57'];
    const vehicles=[];
    selected.forEach((r,ri)=>{
      const count=r.type==='residential'?3:2;
      for(let j=0;j<count;j++){
        const car=source.entities.add({box:{dimensions:new C.Cartesian3(4.35,1.82,1.42),material:color(paints[(ri*3+j)%paints.length]),outline:true,outlineColor:color('#111820',0.65)}});
        const roof=source.entities.add({box:{dimensions:new C.Cartesian3(2.25,1.48,0.48),material:color('#343e46',0.96),outline:false}});
        vehicles.push({car,roof,route:r.route,offset:(r.route.total/count)*j,speed:4.5+((ri+j)%4)*2.2});
      }
    });
    let d=0;
    const update=()=>{
      if(s.cancelled)return;
      vehicles.forEach(v=>{
        const p=routeAt(v.route,v.offset+d*v.speed);if(!p)return;
        const g=getGround(p.lon,p.lat);
        entityOrientation(v.car,{lon:p.lon,lat:p.lat,alt:g+0.85},p.heading);
        entityOrientation(v.roof,{lon:p.lon,lat:p.lat,alt:g+1.55},p.heading);
      });d+=1.4;
    };
    update();const timer=setInterval(update,1000);s.timers.push(timer);
    setStatus(`Road network: ${drawn} mapped roads. ${vehicles.length} simulated vehicles follow mapped road geometry; these are not live traffic data.`, 'good');
  }

  function pointInPolygon(point, polygon) {
    let inside=false;
    for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
      const xi=polygon[i].lon,yi=polygon[i].lat,xj=polygon[j].lon,yj=polygon[j].lat;
      const intersect=((yi>point.lat)!==(yj>point.lat))&&(point.lon<(xj-xi)*(point.lat-yi)/(yj-yi+1e-20)+xi);
      if(intersect)inside=!inside;
    }
    return inside;
  }

  async function forests(s) {
    const center=getCenter();const osm=await getOSM();if(s.cancelled)return;
    const areas=osm.elements.filter(el=>el.type==='way'&&el.tags&&((el.tags.landuse==='forest')||el.tags.natural==='wood')&&hasGeom(el));
    const actualTrees=osm.elements.filter(el=>el.type==='node'&&el.tags&&el.tags.natural==='tree'&&Number.isFinite(el.lon)&&Number.isFinite(el.lat));
    const trees=[];const seen=new Set();
    const addTree=(lon,lat,seed)=>{const key=lon.toFixed(5)+','+lat.toFixed(5);if(seen.has(key)||trees.length>=MAX_TREES)return;seen.add(key);trees.push({lon,lat,seed});};
    actualTrees.sort((a,b)=>metersBetween(center,{lon:a.lon,lat:a.lat})-metersBetween(center,{lon:b.lon,lat:b.lat}));
    actualTrees.slice(0,100).forEach((n,i)=>addTree(n.lon,n.lat,n.id||i));
    let generated=0;
    for(const way of areas){
      if(s.cancelled||trees.length>=MAX_TREES||generated>=470)break;
      const pts=geomCoords(way);if(pts.length<4||metersBetween(pts[0],pts[pts.length-1])>10)continue;
      const mid=averagePoint(pts);if(!within(center,mid,2800))continue;
      const minLon=Math.min(...pts.map(p=>p.lon)),maxLon=Math.max(...pts.map(p=>p.lon));
      const minLat=Math.min(...pts.map(p=>p.lat)),maxLat=Math.max(...pts.map(p=>p.lat));
      const latStep=0.00050,lonStep=latStep/Math.max(0.25,Math.cos(center.lat*Math.PI/180));
      const rng=seeded(way.id,generated);
      let local=0;
      for(let lat=minLat+latStep/2;lat<maxLat&&trees.length<MAX_TREES&&local<90;lat+=latStep){
        for(let lon=minLon+lonStep/2;lon<maxLon&&trees.length<MAX_TREES&&local<90;lon+=lonStep){
          const p={lon:lon+(rng()-.5)*lonStep*.35,lat:lat+(rng()-.5)*latStep*.35};
          if(pointInPolygon(p,pts)&&within(center,p,3000)){addTree(p.lon,p.lat,(way.id||1)+local);local++;generated++;}
        }
      }
    }
    if(!trees.length){setStatus('No mapped woodland or individual trees found nearby. Try a rural or forested area, then refresh.', 'error');return;}
    const instances=[];
    const fmt=C.PerInstanceColorAppearance.VERTEX_FORMAT;
    const trunkGeo=new C.CylinderGeometry({length:4,bottomRadius:0.18,topRadius:0.11,slices:5,vertexFormat:fmt});
    const crownGeo=new C.CylinderGeometry({length:7,bottomRadius:2.35,topRadius:0.12,slices:6,vertexFormat:fmt});
    trees.forEach((tree,i)=>{
      if(s.cancelled)return;
      const rng=seeded(tree.seed,i);const scale=0.65+rng()*0.85;const ground=getGround(tree.lon,tree.lat);
      const base=C.Cartesian3.fromDegrees(tree.lon,tree.lat,ground);
      const trunkMatrix=C.Transforms.eastNorthUpToFixedFrame(C.Cartesian3.fromDegrees(tree.lon,tree.lat,ground+2*scale));
      C.Matrix4.multiplyByScale(trunkMatrix,new C.Cartesian3(scale,scale,scale),trunkMatrix);
      const crownMatrix=C.Transforms.eastNorthUpToFixedFrame(C.Cartesian3.fromDegrees(tree.lon,tree.lat,ground+6.0*scale));
      C.Matrix4.multiplyByScale(crownMatrix,new C.Cartesian3(scale,scale,scale),crownMatrix);
      const trunkColor=C.ColorGeometryInstanceAttribute.fromColor(color('#584438'));
      const greens=['#2f6339','#3a7540','#477f45','#285b35','#56834b'];
      const crownColor=C.ColorGeometryInstanceAttribute.fromColor(color(greens[Math.floor(rng()*greens.length)]));
      instances.push(new C.GeometryInstance({geometry:trunkGeo,modelMatrix:trunkMatrix,attributes:{color:trunkColor}}));
      instances.push(new C.GeometryInstance({geometry:crownGeo,modelMatrix:crownMatrix,attributes:{color:crownColor}}));
    });
    if(s.cancelled)return;
    const primitive=new C.Primitive({geometryInstances:instances,appearance:new C.PerInstanceColorAppearance({flat:true,closed:true,translucent:false}),asynchronous:true,releaseGeometryInstances:true});
    addPrimitive(s,primitive);
    setStatus(`Forests & Trees: ${trees.length} 3D trees placed (${Math.min(100,actualTrees.length)} individual mapped tree points plus woodland fill).`, 'good');
  }

  function ferryRouteWays(elements) {
    const routes=[];
    elements.filter(el=>el.type==='way'&&el.tags&&el.tags.route==='ferry'&&hasGeom(el)).forEach(el=>routes.push({id:el.id,points:geomCoords(el)}));
    elements.filter(el=>el.type==='relation'&&el.tags&&el.tags.route==='ferry'&&Array.isArray(el.members)).forEach(rel=>{
      const members=rel.members.filter(m=>m.type==='way'&&Array.isArray(m.geometry));
      members.forEach(m=>{const pts=m.geometry.filter(p=>Number.isFinite(p.lon)&&Number.isFinite(p.lat)).map(p=>({lon:p.lon,lat:p.lat}));if(pts.length>1)routes.push({id:m.ref||rel.id,points:pts});});
    });
    const seen=new Set();
    return routes.filter(r=>{const key=r.points.length+':'+r.points[0].lon.toFixed(3)+':'+r.points[0].lat.toFixed(3);if(seen.has(key))return false;seen.add(key);return true;});
  }

  async function ships(s) {
    const center=getCenter();const osm=await getOSM();if(s.cancelled)return;
    const routes=ferryRouteWays(osm.elements).map(r=>({id:r.id,route:routeLength(r.points)})).filter(r=>r.route.total>600).sort((a,b)=>b.route.total-a.route.total);
    if(!routes.length){setStatus('No mapped ferry route was found in this area. Move near a coast/harbour (for example, a ferry terminal) and press Refresh. No fake live AIS positions are shown.', 'error');return;}
    const source=await addDataSource(s,'Ferries and ships');
    const selected=routes.slice(0,Math.min(3,routes.length));
    const shipsList=[];
    selected.forEach((item,i)=>{
      const cargo=i%2===1;
      const hull=source.entities.add({box:{dimensions:new C.Cartesian3(cargo?72:48,cargo?13:11,cargo?7:6),material:color(cargo?'#384e60':'#f0eee8'),outline:true,outlineColor:color('#1b2830')}});
      const deck=source.entities.add({box:{dimensions:new C.Cartesian3(cargo?42:28,cargo?10:8,cargo?3.5:3),material:color(cargo?'#b9c1c5':'#1f536b'),outline:false}});
      const bridge=source.entities.add({box:{dimensions:new C.Cartesian3(10,7,5),material:color('#e1e4e3'),outline:true,outlineColor:color('#53616b')}});
      const funnel=source.entities.add({box:{dimensions:new C.Cartesian3(4,3,3),material:color('#d9513d'),outline:false}});
      const itemShip={route:item.route,entities:[hull,deck,bridge,funnel],offset:(i*0.37)*item.route.total,speed:2.5+i*0.8,cargo};shipsList.push(itemShip);
    });
    let tick=0;
    const update=()=>{
      if(s.cancelled)return;
      shipsList.forEach(ship=>{
        const p=routeAt(ship.route,ship.offset+tick*ship.speed);if(!p)return;
        const pos={lon:p.lon,lat:p.lat,alt:1.2};
        entityOrientation(ship.entities[0],pos,p.heading);
        entityOrientation(ship.entities[1],{...pos,alt:5},p.heading);
        const forward=ship.cargo?-7:4;
        const bridgePos=addOffset(pos,Math.sin(p.heading)*forward,Math.cos(p.heading)*forward,8);
        entityOrientation(ship.entities[2],bridgePos,p.heading);
        const funnelPos=addOffset(pos,Math.sin(p.heading)*-3,Math.cos(p.heading)*-3,8);
        entityOrientation(ship.entities[3],funnelPos,p.heading);
      });tick+=2.6;
    };
    update();const timer=setInterval(update,1100);s.timers.push(timer);
    setStatus(`Ferries & Ships: ${shipsList.length} simulated vessels are moving along mapped OpenStreetMap ferry routes. Not live AIS tracking.`, 'good');
  }

  async function clouds(s) {
    const center=getCenter();const source=await addDataSource(s,'3D clouds');
    const rng=seeded(Math.round((center.lon+180)*1000)+Math.round((center.lat+90)*1000),17);
    const clusters=[];const entities=[];
    for(let i=0;i<17;i++){
      const angle=rng()*Math.PI*2;const dist=3500+rng()*22000;
      const cp=addOffset(center,Math.cos(angle)*dist,Math.sin(angle)*dist,0);
      const alt=1400+rng()*5700;const count=4+Math.floor(rng()*4);const puffs=[];
      for(let j=0;j<count;j++){
        const east=(rng()-.5)*900,north=(rng()-.5)*650;
        const p=addOffset(cp,east,north,alt+(rng()-.5)*220);
        const size=230+rng()*420;
        const tint=0.90+rng()*0.09;const a=0.76+rng()*0.20;
        const ent=source.entities.add({position:C.Cartesian3.fromDegrees(p.lon,p.lat,p.alt),ellipsoid:{radii:new C.Cartesian3(size*1.45,size,size*(0.38+rng()*0.26)),material:new C.Color(tint,tint+0.005,tint+0.01,a),outline:false,maximumConeDegree:90}});
        puffs.push({entity:ent,east,north,alt:p.alt,size});entities.push(ent);
      }
      clusters.push({center:cp,alt,puffs});
    }
    let driftStep=0;
    const drift=()=>{
      if(s.cancelled)return;
      driftStep++;
      clusters.forEach(cl=>{
        cl.center=addOffset(cl.center,7.5,-3.2,0);
        cl.puffs.forEach(p=>{
          const q=addOffset(cl.center,p.east,p.north,p.alt);
          p.entity.position=C.Cartesian3.fromDegrees(q.lon,q.lat,q.alt);
        });
      });
    };
    const timer=setInterval(drift,2500);s.timers.push(timer);
    setStatus(`3D Cloud Decks: ${entities.length} cloud puffs across 17 clusters created around the current area. Procedural clouds; not METAR/forecast-derived.`, 'good');
  }

  async function terrain(s) {
    const viewer=state.viewer;const globe=viewer.scene.globe;
    const old={terrainExaggeration:globe.terrainExaggeration,enableLighting:globe.enableLighting,showGroundAtmosphere:globe.showGroundAtmosphere,maximumScreenSpaceError:globe.maximumScreenSpaceError};
    state.savedTerrain=old;
    globe.terrainExaggeration=1.35;
    globe.enableLighting=true;
    globe.showGroundAtmosphere=true;
    // Mildly improve terrain tile detail without pushing mobile devices into extreme LOD.
    if(Number.isFinite(globe.maximumScreenSpaceError)) globe.maximumScreenSpaceError=Math.max(1.5,Math.min(old.maximumScreenSpaceError,1.8));
    s.cleanupFns.push(()=>{
      const g=state.viewer&&state.viewer.scene.globe;if(!g)return;
      if(old.terrainExaggeration!==undefined)g.terrainExaggeration=old.terrainExaggeration;
      if(old.enableLighting!==undefined)g.enableLighting=old.enableLighting;
      if(old.showGroundAtmosphere!==undefined)g.showGroundAtmosphere=old.showGroundAtmosphere;
      if(Number.isFinite(old.maximumScreenSpaceError))g.maximumScreenSpaceError=old.maximumScreenSpaceError;
      state.savedTerrain=null;
    });
    if(state.root){const slider=state.root.querySelector('#reliefSlider');slider.value='1.35';state.root.querySelector('#reliefValue').textContent='1.35×';}
    setStatus('Terrain relief enabled: terrain is exaggerated 1.35×, sun lighting is enabled, and terrain LOD is modestly tightened. GeoFS terrain source is unchanged.', 'good');
  }

  const FEATURES={buildings,rail,roads,forest:forests,ships,clouds,terrain};

  window.GRW7={
    version:VERSION,
    availableFeatures:FEATURE_INFO.map(x=>x[0]),
    open:()=>{makeUI();setStatus('Ready. Enable a feature to load nearby world detail.');},
    start:toggleFeature,
    stop:stopFeature,
    clear:stopAll,
    refresh:refreshActive,
    getCenter,
    get activeFeatures(){return [...state.active.keys()];}
  };
  makeUI();
  setStatus('Starting 3D Cloud Decks…');
  setTimeout(() => { if (window.GRW7) window.GRW7.start('clouds'); }, 350);
  console.info(`[GeoFS RealWorld 7 standalone: clouds] v${VERSION} loaded.`);
})();
