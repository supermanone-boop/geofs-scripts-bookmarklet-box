/* Coaster City Grid + Terrain + Flight Simulator v4.0
 * Asphalt city ground, road traffic, close-but-clear buildings, and an original procedural jet.
 * Built for the Three.js runtime used by the original coaster game.
 */
export function installCityFlight(api, editor, panel) {
  'use strict';
  if (!api || !api.THREE || !api.scene3d || !api.camera || !editor || !panel) {
    throw new Error('City/Flight: runtime API is incomplete');
  }
  const T = api.THREE;
  const scene = api.scene3d;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const mix = (a, b, t) => a + (b - a) * t;
  const rand = (seed) => {
    let s = seed >>> 0;
    return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  };
  const unitBox = new T.BoxGeometry(1, 1, 1);
  const unitCylinder = new T.CylinderGeometry(0.5, 0.5, 1, 10);
  const materials = {
    concrete: new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.88 }),
    facade: new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.72, metalness: 0.12 }),
    glass: new T.MeshStandardMaterial({ color: 0x9fc9d8, roughness: 0.18, metalness: 0.42, emissive: 0x102634, emissiveIntensity: 0.14 }),
    glassLit: new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.24, metalness: 0.18, emissive: 0xffbd70, emissiveIntensity: 0.9 }),
    trim: new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.48, metalness: 0.62 }),
    dark: new T.MeshStandardMaterial({ color: 0x242c35, roughness: 0.7 }),
    asphalt: new T.MeshStandardMaterial({ color: 0x30363b, roughness: 0.96 }),
    ground: new T.MeshStandardMaterial({ color: 0x777d80, roughness: 0.99, metalness: 0.0 }),
    roadMark: new T.MeshStandardMaterial({ color: 0xe7e0bd, roughness: 0.8, emissive: 0x29251a, emissiveIntensity: 0.15 }),
    greenery: new T.MeshStandardMaterial({ color: 0x4b7952, roughness: 1 }),
    leaf: new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.94 }),
    warm: new T.MeshStandardMaterial({ color: 0xffd99a, emissive: 0xffa23d, emissiveIntensity: 0.8 }),
    runway: new T.MeshStandardMaterial({ color: 0x353b40, roughness: 1 }),
    roof: new T.MeshStandardMaterial({ color: 0x69757c, roughness: 0.8, metalness: 0.25 }),
  };
  const batchDefs = {
    concrete: materials.concrete, facade: materials.facade, glass: materials.glass,
    glassLit: materials.glassLit, trim: materials.trim, dark: materials.dark,
    asphalt: materials.asphalt, ground: materials.ground, roadMark: materials.roadMark, greenery: materials.greenery,
    leaf: materials.leaf, warm: materials.warm, runway: materials.runway, roof: materials.roof,
  };
  let cityRoot = null;
  let cityConfig = null;
  let mountainRoot = null;
  let mountainConfig = null;
  let mountainClock = 0;
  let routeCache = null;
  let colliders = [];
  let traffic = [];
  let cityClock = 0;
  let flight = null;
  let flightLoading = false;
  let flightLoadToken = 0;
  let previewActive = false;
  let previewAngle = 0;
  let flightUI = null;
  let previewExitUI = null;
  let previewTrackGroup = null;
  let flightKeys = Object.create(null);
  let viewEditorHidden = null;
  let oldFog = null;
  let oldFar = null;
  let cityBuildCount = 0;
  const FLIGHT_GROUND_ALT = 3.20;
  const SIGN_WORDS = ['HOTEL','MALL','PLAZA','MARKET','OFFICE','CAFE','BANK','SKY','GALLERY','ARCADE','TOWER','METRO'];
  const signTextures = new Map();
  const signMaterials = new Map();

  function makeSignTexture(word, hue) {
    hue = (Math.round(hue / 45) * 45) % 360;
    const key = `${word}|${hue}`;
    if (signTextures.has(key)) return signTextures.get(key);
    const c = document.createElement('canvas'); c.width = 256; c.height = 64;
    const ctx = c.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 256, 64);
    grad.addColorStop(0, `hsl(${hue},55%,15%)`); grad.addColorStop(1, `hsl(${hue},55%,30%)`);
    ctx.fillStyle = grad; ctx.fillRect(0, 0, 256, 64);
    ctx.strokeStyle = `hsl(${hue},90%,70%)`; ctx.lineWidth = 4; ctx.strokeRect(3, 3, 250, 58);
    ctx.fillStyle = '#f2fbff'; ctx.font = '900 32px system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = `hsl(${hue},100%,75%)`; ctx.shadowBlur = 7; ctx.fillText(word, 128, 33);
    const tex = new T.CanvasTexture(c); tex.colorSpace = T.SRGBColorSpace; tex.anisotropy = 4;
    signTextures.set(key, tex); return tex;
  }
  function addSign(root, frame, text, y, z, width, hue = 195, side = 1) {
    const tex = makeSignTexture(text, hue);
    const key = `${text}|${(Math.round(hue / 45) * 45) % 360}`;
    let mat = signMaterials.get(key);
    if (!mat) { mat = new T.MeshBasicMaterial({ map: tex, side: T.DoubleSide, toneMapped: false }); signMaterials.set(key, mat); }
    const mesh = new T.Mesh(new T.PlaneGeometry(width, width * 0.25), mat);
    const lx = 0, lz = z * side;
    const c = Math.cos(frame.yaw), s = Math.sin(frame.yaw);
    mesh.position.set(frame.x + lx * c + lz * s, y, frame.z - lx * s + lz * c);
    mesh.rotation.y = frame.yaw + (side < 0 ? Math.PI : 0);
    root.add(mesh); return mesh;
  }
  function frameAt(tr, s) {
    const step = tr.L / tr.n;
    const f = ((s % tr.L) + tr.L) % tr.L / step;
    const i = Math.floor(f), j = (i + 1) % tr.n, t = f - i;
    const L = (a) => a[i] + (a[j] - a[i]) * t;
    const tx = L(tr.tx), tz = L(tr.tz), len = Math.hypot(tx, tz) || 1;
    return { x: L(tr.px), y: L(tr.py), z: L(tr.pz), tx: tx / len, tz: tz / len, yaw: Math.atan2(tx, tz), s };
  }
  function getTrack() {
    const d = editor.design;
    if (!d || !Array.isArray(d.pts) || d.pts.length < 2) throw new Error('先にコースを作成してください。');
    if (typeof api.prepare !== 'function' || typeof api.buildTrack !== 'function') throw new Error('コース解析APIがありません。');
    // Always rebuild from the editor's current design. api.co can still point to an older route.
    return api.prepare(d, api.buildTrack);
  }
  function worldFromLocal(frame, x, z) {
    const c = Math.cos(frame.yaw), s = Math.sin(frame.yaw);
    return { x: frame.x + x * c + z * s, z: frame.z - x * s + z * c };
  }
  function makeBatchBuilder(root) {
    const batches = new Map();
    const dummy = new T.Object3D();
    function add(cat, x, y, z, w, h, d, yaw = 0, color = 0xffffff) {
      if (!batches.has(cat)) batches.set(cat, []);
      batches.get(cat).push({ x, y, z, w, h, d, yaw, color });
    }
    function local(frame, cat, x, y, z, w, h, d, color = 0xffffff, extraYaw = 0) {
      const p = worldFromLocal(frame, x, z);
      add(cat, p.x, y, p.z, w, h, d, frame.yaw + extraYaw, color);
    }
    function finish() {
      for (const [cat, items] of batches) {
        const mesh = new T.InstancedMesh(unitBox, batchDefs[cat], items.length);
        mesh.name = `CityBatch_${cat}`; mesh.instanceMatrix.setUsage(T.StaticDrawUsage);
        items.forEach((it, i) => {
          dummy.position.set(it.x, it.y, it.z); dummy.rotation.set(0, it.yaw, 0);
          dummy.scale.set(it.w, it.h, it.d); dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
          if (mesh.setColorAt) mesh.setColorAt(i, new T.Color(it.color));
        });
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.computeBoundingSphere(); mesh.frustumCulled = true; root.add(mesh);
      }
    }
    return { add, local, finish };
  }
  function addStreetTree(B, frame, x, z, h, seed, groundY = 0) {
    const r = rand(seed);
    B.local(frame, 'trim', x, groundY + h * 0.32, z, 0.65, h * 0.64, 0.65, 0x72543b);
    B.local(frame, 'leaf', x, groundY + h * 0.88, z, h * (0.58 + r() * 0.12), h * 0.9, h * (0.58 + r() * 0.12), [0x507b50,0x5e8759,0x76965c][Math.floor(r()*3)]);
  }
  function makeBuilding(B, root, frame, seed, opts = {}) {
    const r = rand(seed);
    const w = opts.w || (19 + r() * 15), d = opts.d || (22 + r() * 13);
    const h = opts.h || (21 + Math.pow(r(), 0.7) * 78);
    const baseY = opts.baseY == null ? 0 : opts.baseY;
    const floors = Math.min(32, Math.max(3, Math.floor(h / (2.9 + r() * 0.5))));
    const fh = h / floors;
    const palette = [0x89949a,0x9a9b95,0x777f88,0xb0a99e,0x685f5a,0x667f88,0x9e8878,0x7d8a92];
    const facade = palette[Math.floor(r() * palette.length)];
    const sign = SIGN_WORDS[Math.floor(r() * SIGN_WORDS.length)];
    const front = r() > 0.5 ? 1 : -1;
    const centerY = baseY + h / 2;
    B.local(frame, 'facade', opts.cx || 0, centerY, opts.cz || 0, w, h, d, facade);
    // Structural corner piers, vertical façade fins and floor bands.
    for (const x of [-w/2+0.45,w/2-0.45]) {
      B.local(frame,'trim',x,centerY,opts.cz||0,0.9,h+0.4,d+0.5,0xb7bdbe);
    }
    const finCount=Math.max(3,Math.floor(w/5.2));
    for(let fin=1;fin<finCount;fin++){
      const x=-w/2+fin*w/finCount;
      B.local(frame,'trim',(opts.cx||0)+x,centerY,(opts.cz||0)+front*(d/2+.19),.16,h*.94,.22,0xc1c9c9);
    }
    for (let floor = 1; floor < floors; floor++) {
      const y = baseY + floor * fh;
      B.local(frame,'trim',opts.cx||0,y,opts.cz||0,w+0.35,0.24,d+0.4,0x65737a);
    }
    // Windows across all four faces. The glass is batched into a small number of InstancedMeshes.
    const colsFront = Math.max(4, Math.min(8, Math.floor(w / 3.4)));
    const colsSide = Math.max(4, Math.min(8, Math.floor(d / 3.5)));
    for (let floor = 0; floor < floors; floor++) {
      const y = baseY + floor * fh + fh * 0.55;
      const wh = Math.min(4.8, Math.max(1.75, fh * 0.48));
      for (let col = 0; col < colsFront; col++) {
        const x = -w/2 + (col + 0.5) * w/colsFront;
        for (const side of [-1,1]) {
          const lit = r() < 0.18;
          B.local(frame,lit?'glassLit':'glass', (opts.cx||0)+x, y, (opts.cz||0)+side*(d/2+0.08), w/colsFront*0.62, wh, 0.15, lit?0xffffff:[0x90b4c7,0x6e93a8,0xb2cbd2][Math.floor(r()*3)]);
        }
      }
      for (let col = 0; col < colsSide; col++) {
        const z = -d/2 + (col + 0.5) * d/colsSide;
        for (const side of [-1,1]) {
          const lit = r() < 0.15;
          B.local(frame,lit?'glassLit':'glass',(opts.cx||0)+side*(w/2+0.08),y,(opts.cz||0)+z,0.15,wh,d/colsSide*0.62,lit?0xffffff:[0x7898aa,0x9cb8c4,0x527184][Math.floor(r()*3)]);
        }
      }
      // Recessed balconies on selected residential floors.
      if (floor > 1 && floor % 3 === 0 && r() > 0.35) {
        for (const side of [-1,1]) {
          const z = (opts.cz||0) + side * (d/2 + 1.0);
          B.local(frame,'trim',(opts.cx||0),baseY+floor*fh+0.12,z,w*0.68,0.22,2.1,0xb6b8b6);
          B.local(frame,'trim',(opts.cx||0),baseY+floor*fh+0.78,z+side*0.75,w*0.68,0.08,0.1,0x6a7c80);
        }
      }
    }
    // Ground-floor retail, canopy, glazing and entrance.
    B.local(frame,'dark',opts.cx||0,baseY+1.55,opts.cz||0,w+0.2,3.1,d+0.2,0x29343b);
    for (let col = 0; col < colsFront; col++) {
      const x = -w/2 + (col+0.5)*w/colsFront;
      for (const side of [-1,1]) B.local(frame,'glass',(opts.cx||0)+x,baseY+1.65,(opts.cz||0)+side*(d/2+0.2),w/colsFront*0.76,2.25,0.2,0xa5c9d0);
    }
    B.local(frame,'trim',opts.cx||0,baseY+3.4,(opts.cz||0)+front*(d/2+0.75),w+1,0.35,1.5,0x3d4f59);
    B.local(frame,'trim',opts.cx||0,baseY+0.18,opts.cz||0,w+1,0.35,d+1,0x505c62);
    // Shopfront mullions, canopy supports and illuminated entrance portals.
    for(let col=0;col<=colsFront;col++){
      const x=-w/2+col*w/colsFront;
      B.local(frame,'trim',(opts.cx||0)+x,baseY+1.55,(opts.cz||0)+front*(d/2+.31),.13,2.9,.22,0xb7c3c4);
    }
    B.local(frame,'warm',opts.cx||0,baseY+3.72,(opts.cz||0)+front*(d/2+.82),w*.72,.12,.28,0xffd58f);
    for(let x=-w/2+2;x<w/2-1;x+=Math.max(4,w/5)){
      B.local(frame,'trim',(opts.cx||0)+x,baseY+1.75,(opts.cz||0)+front*(d/2+.95),.24,3.5,.24,0x737e81);
    }
    // Roof parapet, stepped crowns and mechanical plant.
    B.local(frame,'roof',opts.cx||0,baseY+h+0.55,opts.cz||0,w+0.8,1.1,d+0.8,0x5d686d);
    for (const x of [-w/2+1,w/2-1]) for (const z of [-d/2+1,d/2-1]) B.local(frame,'trim',(opts.cx||0)+x,baseY+h+1.2,(opts.cz||0)+z,0.65,1.4,0.65,0x68767d);
    if(h>48 && r()>.28){
      const crownW=w*(.54+r()*.16), crownD=d*(.58+r()*.14), crownH=3+r()*6;
      B.local(frame,'facade',opts.cx||0,baseY+h+1.1+crownH/2,opts.cz||0,crownW,crownH,crownD,facade);
      B.local(frame,'glass',opts.cx||0,baseY+h+1.25+crownH/2,opts.cz||0,crownW*.88,crownH*.72,crownD+.08,0x89b8c8);
      B.local(frame,'trim',opts.cx||0,baseY+h+1.3+crownH,opts.cz||0,crownW+1,.35,crownD+1,0xbac5c7);
    }
    for(let i=0;i<2+Math.floor(r()*3);i++){
      const x=(r()-0.5)*w*0.55,z=(r()-0.5)*d*0.55;
      B.local(frame,'roof',(opts.cx||0)+x,baseY+h+1.4,(opts.cz||0)+z,2.2+r()*2,1.6+r()*1.2,2.4+r()*2,0x7a8589);
    }
    // A sign board facing the route.
    if (r() > 0.50) addSign(root,{...worldFromLocal(frame,opts.cx||0,(opts.cz||0)+front*(d/2+0.22)),yaw:frame.yaw},sign,baseY+5,(0),Math.min(12,w*0.72),Math.floor(r()*360),1);
    // Occasional roof antenna.
    if (r() > 0.55) {
      const p=worldFromLocal(frame,(opts.cx||0)+w*0.28,(opts.cz||0)-d*0.22);
      B.add('trim',p.x,baseY+h+4,p.z,0.28,6,0.28,frame.yaw,0xbec7cc);
      B.add('warm',p.x,baseY+h+7.2,p.z,0.75,0.75,0.75,frame.yaw,0xff6148);
    }
    if (opts.collider !== false) colliders.push({x:frame.x,z:frame.z,yaw:frame.yaw,cx:opts.cx||0,cz:opts.cz||0,halfW:w/2,halfD:d/2,minY:baseY,maxY:baseY+h,kind:'building'});
    return {w,d,h,baseY};
  }
  const CITY_ROAD_WIDTH = 9.5;
  function getRoadOffsets(rows, half) {
    const centers = rows.map(row => half * row.f);
    const offsets = [12.5];
    for (let i = 0; i < centers.length - 1; i++) {
      const mid = (centers[i] + centers[i + 1]) * 0.5;
      if (mid > 48 && mid < half - 24) offsets.push(mid);
    }
    if (centers.length && centers[centers.length - 1] < half - 80) {
      offsets.push((centers[centers.length - 1] + half - 24) * 0.5);
    }
    return [...new Set(offsets.map(v => Math.round(v / 2) * 2))].sort((a,b)=>a-b);
  }
  function buildingClearOfRoads(lateral, width, roadOffsets) {
    const pad = width * 0.5 + CITY_ROAD_WIDTH * 0.5 + 2.0;
    return roadOffsets.every(offset => Math.abs(Math.abs(lateral) - offset) >= pad);
  }
  function addRoads(B, frame, step, groundY, areaWidth, roadOffsets, crossStreet = false) {
    // Continuous matte-grey city pavement under every street and building block.
    B.local(frame, 'ground', 0, groundY - 0.35, 0, areaWidth + 160, 0.70, step + 24, 0x777d80);
    for (const side of [-1, 1]) {
      for (const offset of roadOffsets) {
        B.local(frame, 'asphalt', side * offset, groundY - 0.28, 0, CITY_ROAD_WIDTH, 0.56, step + 8, 0x30363b);
        // Concrete curb and pale edge lines.
        for (const edge of [-1, 1]) {
          B.local(frame, 'trim', side * offset + edge * (CITY_ROAD_WIDTH * 0.5 + 0.8), groundY - 0.13, 0, 0.8, 0.28, step + 9, 0x9da2a3);
          B.local(frame, 'roadMark', side * offset + edge * 4.15, groundY + 0.015, 0, 0.15, 0.05, step + 2, 0xe5e2d5);
        }
        // Broken centre line, with the same local coordinate used by traffic.
        for (let z = -step * 0.5 + 4; z < step * 0.5; z += 13) {
          B.local(frame, 'roadMark', side * offset, groundY + 0.018, z, 0.22, 0.05, 5.0, 0xe7dcae);
        }
      }
      if (crossStreet && roadOffsets.length > 1) {
        const inner = roadOffsets[0], outer = roadOffsets[roadOffsets.length - 1];
        B.local(frame, 'asphalt', side * ((inner + outer) * 0.5), groundY - 0.275, 0,
          outer - inner + CITY_ROAD_WIDTH, 0.55, 13.5, 0x30363b);
        B.local(frame, 'roadMark', side * ((inner + outer) * 0.5), groundY + 0.02, 0,
          outer - inner + CITY_ROAD_WIDTH - 2, 0.05, 0.18, 0xe5e2d5);
        // Short zebra crossing at the main boulevard.
        for (let k = -4; k <= 4; k++) {
          B.local(frame, 'roadMark', side * (inner + 9 + k * 1.6), groundY + 0.025, 0, 0.75, 0.05, 3.0, 0xf0eee4);
        }
      }
    }
  }
  function routeSamples(tr, limit = 1800) {
    const stride = Math.max(1, Math.floor(tr.n / limit));
    const out=[];
    for(let i=0;i<tr.n;i+=stride) out.push({x:tr.px[i],y:tr.py[i],z:tr.pz[i],s:i*tr.L/tr.n});
    const last=tr.n-1;
    out.push({x:tr.px[last],y:tr.py[last],z:tr.pz[last],s:last*tr.L/tr.n});
    return out;
  }
  function buildingClearOfRoute(frame,w,d,samples,clearance=8) {
    const c=Math.cos(frame.yaw),sn=Math.sin(frame.yaw),hw=w/2+clearance,hd=d/2+clearance;
    for(const p of samples){
      const dx=p.x-frame.x,dz=p.z-frame.z;
      const lx=dx*c-dz*sn,lz=dx*sn+dz*c;
      if(Math.abs(lx)<hw && Math.abs(lz)<hd) return false;
    }
    return true;
  }
  function buildingClearOfBuildings(frame,w,d) {
    const r=Math.hypot(w/2,d/2);
    for(const b of colliders){
      const dx=frame.x-b.x,dz=frame.z-b.z;
      const min=r+Math.hypot(b.halfW,b.halfD)+9;
      if(dx*dx+dz*dz<min*min) return false;
    }
    return true;
  }
  function addAirport(B, root, bounds, center) {
    const x = bounds.maxX + 450;
    const z = center.z + 110;
    // Runway and threshold, long axis is +Z.
    B.add('runway',x,-.225,z,48,.55,1800,0,0x343a3e);
    B.add('trim',x-25,.12,z,1,.14,1800,0,0x8a969b);
    B.add('trim',x+25,.12,z,1,.14,1800,0,0x8a969b);
    for(let zz=-870;zz<=870;zz+=15) B.add('roadMark',x,.095,z+zz,0.65,.08,7,0,0xf5f1df);
    for(const side of [-1,1]){
      for(let j=0;j<10;j++){
        B.add('roadMark',x+side*20,.095,z-870+j*2.2,1.4,.08,1.3,0,0xffffff);
      }
      for(let j=0;j<30;j++) B.add('warm',x+side*24,.24,z-840+j*58,.7,.5,.7,0,side<0?0x32d6ff:0xff5544);
    }
    B.add('asphalt',x-52,-.18,z+20,58,.46,110,0,0x333a40);
    // Apron and terminal.
    const terminalFrame={x:x-100,y:0,z:z+40,yaw:Math.PI/2};
    makeBuilding(B,root,terminalFrame,0x713a,{w:62,d:92,h:26,cx:0,cz:0,baseY:.05});
    const hangarFrame={x:x+65,y:0,z:z+50,yaw:Math.PI/2};
    makeBuilding(B,root,hangarFrame,0x882d,{w:58,d:70,h:22,cx:0,cz:0,baseY:.05});
    // Taxiway centerline.
    B.add('roadMark',x-56,.13,z+5,1,.08,76,Math.PI/2,0xe9dc91);
    return {x,z,runwayHalfLength:900,spawn:{x,z:z-760,y:FLIGHT_GROUND_ALT,yaw:0}};
  }
  function makeCity(config = {}) {
    if (cityRoot) disposeCity();
    const tr = getTrack();
    const root = new T.Group(); root.name = 'CoasterOrthogonalCityGrid';
    const B = makeBatchBuilder(root);
    colliders = []; traffic = [];
    const samples = routeSamples(tr, 12000);
    const total = tr.L;
    const spacing = clamp(Number(config.spacing) || 145, 100, 210);
    const density = ['normal','dense','ultra'].includes(config.density) ? config.density : 'dense';
    const areaWidth = clamp(Number(config.areaWidth) || 10000, 3000, 16000);
    const half = areaWidth * 0.5;
    const seedBase = (Number(config.seed) || 20261031) >>> 0;
    const rng = rand(seedBase);

    // Align the street grid to the principal direction of the actual coaster route.
    let mx=0,mz=0;
    for (const q of samples) { mx += q.x; mz += q.z; }
    mx /= samples.length; mz /= samples.length;
    let xx=0,zz=0,xz=0;
    for (const q of samples) { const x=q.x-mx,z=q.z-mz; xx+=x*x;zz+=z*z;xz+=x*z; }
    const theta = 0.5 * Math.atan2(2*xz, xx-zz);
    const ux=Math.cos(theta), uz=Math.sin(theta), vx=-uz, vz=ux;
    const gridYaw=Math.atan2(-uz,ux);
    const project = q => ({u:(q.x-mx)*ux+(q.z-mz)*uz, v:(q.x-mx)*vx+(q.z-mz)*vz});
    const projected=samples.map(project);
    const minU=Math.min(...projected.map(q=>q.u)), maxU=Math.max(...projected.map(q=>q.u));
    const uStart=Math.floor((minU-760)/spacing)*spacing;
    const uEnd=Math.ceil((maxU+760)/spacing)*spacing;
    const vStart=-Math.ceil(half/spacing)*spacing;
    const vEnd=Math.ceil(half/spacing)*spacing;
    const nU=Math.max(1,Math.round((uEnd-uStart)/spacing));
    const nV=Math.max(1,Math.round((vEnd-vStart)/spacing));
    const uSpan=nU*spacing, vSpan=nV*spacing;
    const midU=(uStart+uEnd)*0.5, midV=(vStart+vEnd)*0.5;
    const point=(u,v)=>({x:mx+ux*u+vx*v,z:mz+uz*u+vz*v});
    const center=point(midU,midV);
    center.y=samples.reduce((a,q)=>a+(q.y||0),0)/samples.length;
    const groundY=0.08, roadWidth=14.5, majorRoadWidth=21.5;
    const roadCounts={u:0,v:0};
    const areaColor=0x747b7e;

    // A single grey paved urban ground plane; the street grid is continuous and orthogonal.
    B.add('ground',center.x,groundY-0.42,center.z,uSpan+spacing,0.72,vSpan+spacing,gridYaw,areaColor);
    const dashStep=34;
    // Streets parallel to route's principal axis (u direction).
    for(let j=0;j<=nV;j++){
      const v=vStart+j*spacing;
      const major=(j%5===0), rw=major?majorRoadWidth:roadWidth;
      const p=point(midU,v);
      B.add('asphalt',p.x,groundY-0.025,p.z,uSpan+spacing,0.20,rw,gridYaw,0x30363a);
      for(const side of [-1,1]){
        const ep=point(midU,v+side*(rw*.5-0.65));
        B.add('roadMark',ep.x,groundY+0.085,ep.z,uSpan+spacing,0.035,0.18,gridYaw,0xe8e6dc);
      }
      if(major){
        for(let u=uStart+12;u<uEnd-5;u+=dashStep){
          const q=point(u,v); B.add('roadMark',q.x,groundY+0.09,q.z,5.2,0.035,0.22,gridYaw,0xe8d9a9);
        }
      } else {
        for(let u=uStart+spacing*.32;u<uEnd;u+=spacing*2){
          const q=point(u,v); B.add('roadMark',q.x,groundY+0.09,q.z,2.8,0.03,0.16,gridYaw,0xd8d4c5);
        }
      }
      roadCounts.u++;
    }
    // Cross streets are built from the same exact grid coordinates, so intersections line up.
    for(let i=0;i<=nU;i++){
      const u=uStart+i*spacing;
      const major=(i%5===0),rw=major?majorRoadWidth:roadWidth;
      const p=point(u,midV);
      B.add('asphalt',p.x,groundY-0.025,p.z,rw,0.20,vSpan+spacing,gridYaw,0x30363a);
      for(const side of [-1,1]){
        const ep=point(u+side*(rw*.5-0.65),midV);
        B.add('roadMark',ep.x,groundY+0.085,ep.z,0.18,0.035,vSpan+spacing,gridYaw,0xe8e6dc);
      }
      if(major){
        for(let v=vStart+10;v<vEnd-5;v+=dashStep){
          const q=point(u,v);B.add('roadMark',q.x,groundY+0.09,q.z,0.22,0.035,5.2,gridYaw,0xe8d9a9);
        }
      }
      roadCounts.v++;
    }
    // Curbs and zebra markings at major grid intersections.
    for(let i=0;i<=nU;i+=5){
      for(let j=0;j<=nV;j+=5){
        const q=point(uStart+i*spacing,vStart+j*spacing);
        for(let k=-3;k<=3;k++){
          const a=point(uStart+i*spacing+k*2.1,vStart+j*spacing+(majorRoadWidth*.28));
          B.add('roadMark',a.x,groundY+0.105,a.z,1.0,0.035,4.8,gridYaw,0xf4f1e8);
        }
      }
    }

    // Spatial bins keep route-clearance checks fast on mobile. Distant blocks do not need
    // rail tests; only cells within 340m of the route are searched and shifted toward it.
    const cityRouteSpatial=buildRouteSpatial(samples,80);
    function nearestRoute(x,z,maxDistance=340){
      const cell=cityRouteSpatial.cell,gx=Math.floor(x/cell),gz=Math.floor(z/cell),r=Math.ceil(maxDistance/cell)+1;
      let best=maxDistance*maxDistance,hit=null;
      for(let ix=-r;ix<=r;ix++)for(let iz=-r;iz<=r;iz++){
        const bucket=cityRouteSpatial.bins.get(`${gx+ix},${gz+iz}`);if(!bucket)continue;
        for(const q of bucket){const dx=q.x-x,dz=q.z-z,d=dx*dx+dz*dz;if(d<best){best=d;hit=q;}}
      }
      return hit?{point:hit,distance:Math.sqrt(best)}:null;
    }
    const desiredOccupancy=density==='normal'?0.68:density==='ultra'?0.91:0.82;
    const maxBuildings=density==='ultra'?1450:density==='normal'?760:1150;
    // Thin the grid evenly when the requested district would exceed the mobile building budget.
    const occupancy=Math.min(desiredOccupancy,maxBuildings/Math.max(1,nU*nV));
    let buildingCount=0,parkCount=0;
    for(let i=0;i<nU;i++){
      for(let j=0;j<nV;j++){
        const cellSeed=(seedBase + Math.imul(i+17,73856093) + Math.imul(j+31,19349663))>>>0;
        const r=rand(cellSeed);
        if(r()>occupancy || buildingCount>=maxBuildings) continue;
        const u=uStart+(i+.5)*spacing, v=vStart+(j+.5)*spacing;
        const base=point(u,v);
        // A few complete city blocks are plazas rather than random decoration fragments.
        if(r()<0.055){
          B.add('greenery',base.x,groundY+0.12,base.z,spacing-roadWidth-8,0.25,spacing-roadWidth-8,gridYaw,0x58744f);
          for(let t=0;t<4;t++){
            const tx=(r()-.5)*(spacing-roadWidth-22),tz=(r()-.5)*(spacing-roadWidth-22);
            const q=point(u+tx,v+tz);
            B.add('trim',q.x,groundY+3.0,q.z,.65,6,.65,gridYaw,0x72543b);
            B.add('leaf',q.x,groundY+7.2,q.z,5.0,5.4,5.0,gridYaw,[0x426d48,0x557e51,0x6b8e5a][Math.floor(r()*3)]);
          }
          parkCount++; continue;
        }
        let w=Math.min(spacing-roadWidth-16, 68+r()*20);
        let d=Math.min(spacing-roadWidth-16, 68+r()*20);
        const bx=base.x,bz=base.z;
        const nearest=nearestRoute(bx,bz);
        // Keep every building on its exact city-block centre. Near the coaster, shrink the
        // footprint symmetrically instead of sliding the building out of its orderly row.
        const frame={x:bx,y:0,z:bz,yaw:gridYaw};
        if(nearest){
          let safe=false;
          for(let scale=1;scale>=0.28;scale-=0.06){
            const testW=w*scale,testD=d*scale;
            if(buildingClearOfRoute(frame,testW,testD,samples,8)){
              w=testW;d=testD;safe=true;break;
            }
          }
          if(!safe)continue;
        }
        if(!buildingClearOfBuildings(frame,w,d))continue;
        const baseHeight=42+r()*150;
        const nearbyTrackHeight=nearest?Math.max(0,nearest.point.y||0):0;
        const h=clamp(Math.max(baseHeight,nearbyTrackHeight+35+r()*115),42,1900);
        makeBuilding(B,root,frame,cellSeed,{w,d,h,baseY:groundY,collider:true});
        buildingCount++;
      }
    }

    // Airport apron and runway are placed outside the regular city grid.
    const corners=[point(uStart-spacing,vStart-spacing),point(uEnd+spacing,vStart-spacing),point(uStart-spacing,vEnd+spacing),point(uEnd+spacing,vEnd+spacing)];
    const bounds={minX:Math.min(...corners.map(q=>q.x)),maxX:Math.max(...corners.map(q=>q.x)),minZ:Math.min(...corners.map(q=>q.z)),maxZ:Math.max(...corners.map(q=>q.z))};
    const airport=addAirport(B,root,bounds,center);
    B.finish();

    // Build detailed cars once; each vehicle follows one straight, marked street lane.
    const carPaint=[0xb93f3b,0xe3e5e2,0x3f6f9a,0xd5a849,0x2d343a,0x597d69,0x7d7194];
    const carGlass=new T.MeshStandardMaterial({color:0x54717d,roughness:.18,metalness:.2});
    const tireMat=new T.MeshStandardMaterial({color:0x171b1e,roughness:.86});
    const hubMat=new T.MeshStandardMaterial({color:0x9aa4a9,metalness:.72,roughness:.3});
    const headMat=new T.MeshBasicMaterial({color:0xfff1c8});
    const tailMat=new T.MeshBasicMaterial({color:0xff362b});
    const trafficCount=clamp(Math.round((nU+nV)*0.24),28,48);
    const usableRoadU=Array.from({length:nV+1},(_,j)=>vStart+j*spacing);
    const usableRoadV=Array.from({length:nU+1},(_,i)=>uStart+i*spacing);
    for(let i=0;i<trafficCount;i++){
      const paint=new T.MeshStandardMaterial({color:carPaint[i%carPaint.length],roughness:.48,metalness:.22});
      const car=new T.Group();car.name=`CityGridTraffic_${i+1}`;
      const van=i%7===5;
      const body=new T.Mesh(new T.BoxGeometry(van?2.45:2.25,.78,van?5.5:4.7),paint);body.position.y=.76;car.add(body);
      const hood=new T.Mesh(new T.BoxGeometry(2.12,.30,1.25),paint);hood.position.set(0,1.06,1.52);car.add(hood);
      const cabin=new T.Mesh(new T.BoxGeometry(van?2.05:1.78,van?1.05:.78,van?2.85:2.35),carGlass);cabin.position.set(0,1.42,-.28);car.add(cabin);
      const roof=new T.Mesh(new T.BoxGeometry(van?2.0:1.72,.13,van?2.65:2.15),paint);roof.position.set(0,1.98,-.32);car.add(roof);
      const wheels=[];
      for(const x of [-1.12,1.12])for(const z of [-1.52,1.52]){
        const wheel=new T.Mesh(new T.CylinderGeometry(.43,.43,.23,14),tireMat);wheel.rotation.z=Math.PI/2;wheel.position.set(x,.42,z);car.add(wheel);wheels.push(wheel);
        const hub=new T.Mesh(new T.CylinderGeometry(.19,.19,.245,12),hubMat);hub.rotation.z=Math.PI/2;hub.position.set(x*1.005,.42,z);car.add(hub);
      }
      for(const side of [-1,1])for(const z of [-1,1]){
        const lamp=new T.Mesh(new T.BoxGeometry(.10,.22,.32),z>0?headMat:tailMat);lamp.position.set(side*.94,.74,z>0?2.27:-2.27);car.add(lamp);
      }
      root.add(car);
      const axis=i%2===0?'u':'v';
      const direction=i%4<2?1:-1;
      const lane=(i%4<2?-3.6:3.6);
      const roadIndex=axis==='u'?(i*7+3)%usableRoadU.length:(i*5+1)%usableRoadV.length;
      const fixed=axis==='u'?usableRoadU[roadIndex]:usableRoadV[roadIndex];
      const start=uStart;
      const length=axis==='u'?uSpan:vSpan;
      const travel=rng()*length;
      traffic.push({group:car,wheels,axis,fixed,lane,direction,start,vStart,length,travel,speed:7.5+(i%8)*1.25,gridYaw,ux,uz,vx,vz,origin:{x:mx,z:mz},groundY});
    }
    scene.add(root);cityRoot=root;
    cityConfig={density,spacing,areaWidth,seed:seedBase,buildings:buildingCount,parks:parkCount,airport,roads:roadCounts.u+roadCounts.v,vehicles:traffic.length,ground:'orthogonal-grey-asphalt',clearance:8};
    routeCache={tr,center,bounds,airport,total,n:Math.max(nU,nV),areaWidth,roadOffsets:[],grid:{uStart,uEnd,vStart,vEnd,spacing,gridYaw}};
    cityBuildCount++;cityClock=0;
    const worldFar=Math.max(14000,areaWidth*2.8);
    if(scene.fog)scene.fog.far=Math.max(scene.fog.far||0,worldFar);
    if(api.camera.far<worldFar){api.camera.far=worldFar;api.camera.updateProjectionMatrix();}
    setStatus(`整然とした都市を生成：${buildingCount}棟／公園${parkCount}区画／格子道路${roadCounts.u+roadCounts.v}本／車両${traffic.length}台。レール周辺は8m以上を確保。`);
    return cityConfig;
  }
  function disposeCity(){
    if(!cityRoot)return;
    scene.remove(cityRoot);
    cityRoot.traverse(o=>{
      if(o.geometry && o.geometry!==unitBox && o.geometry!==unitCylinder) o.geometry.dispose();
      if(o.material && !(Array.isArray(o.material)?o.material.some(m=>[...signMaterials.values()].includes(m)):signMaterials.has(o.material)) && o.material!==materials.concrete && o.material!==materials.facade && o.material!==materials.glass && o.material!==materials.glassLit && o.material!==materials.trim && o.material!==materials.dark && o.material!==materials.asphalt && o.material!==materials.ground && o.material!==materials.roadMark && o.material!==materials.greenery && o.material!==materials.leaf && o.material!==materials.warm && o.material!==materials.runway && o.material!==materials.roof){
        const ms=Array.isArray(o.material)?o.material:[o.material];ms.forEach(m=>{if(m.map && ![...signTextures.values()].includes(m.map))m.map.dispose();m.dispose();});
      }
    });
    cityRoot=null;colliders=[];traffic=[];routeCache=null;
  }
  function updateCity(dt){
    if(!cityRoot||!routeCache)return;
    cityClock+=dt;
    for(const item of traffic){
      item.travel=(item.travel+item.speed*dt*item.direction)%item.length;
      if(item.travel<0)item.travel+=item.length;
      let u,v,yaw;
      if(item.axis==='u'){
        u=item.start+item.travel;v=item.fixed+item.lane;
        yaw=Math.atan2(item.ux,item.uz);
      }else{
        u=item.fixed+item.lane;v=item.vStart+item.travel;
        yaw=Math.atan2(item.vx,item.vz);
      }
      const x=item.origin.x+item.ux*u+item.vx*v;
      const z=item.origin.z+item.uz*u+item.vz*v;
      item.group.position.set(x,item.groundY+0.01,z);
      item.group.rotation.y=yaw+(item.direction<0?Math.PI:0);
      for(const wheel of item.wheels)wheel.rotation.x+=item.speed*dt/.43*item.direction;
    }
  }
  function clearCity(){if(flight)closeFlight();stopCityPreview();disposeCity();cityConfig=null;setStatus('街区を削除しました。コース設計はそのまま残ります。');}
  function inspectCityClearance(){
    if(!routeCache)return {buildings:0,violations:0,minClearance:null};
    const samples=routeSamples(routeCache.tr,6000);let violations=0,minClearance=Infinity;
    for(const b of colliders){
      const c=Math.cos(b.yaw),sn=Math.sin(b.yaw);
      for(const p of samples){
        const dx=p.x-b.x,dz=p.z-b.z,lx=dx*c-dz*sn-b.cx,lz=dx*sn+dz*c-b.cz;
        const gx=Math.abs(lx)-b.halfW,gz=Math.abs(lz)-b.halfD;
        if(gx<0&&gz<0)violations++;
        const gap=Math.hypot(Math.max(0,gx),Math.max(0,gz));
        minClearance=Math.min(minClearance,gap);
      }
    }
    return {buildings:colliders.length,violations,minClearance:Number.isFinite(minClearance)?minClearance:null};
  }
  // Mountain mode: separate peaks and ridges are placed outside a protected rail corridor.
  function disposeMountains(){
    if(!mountainRoot)return;
    scene.remove(mountainRoot);
    const geometries=new Set(),materialsToDispose=new Set();
    mountainRoot.traverse(o=>{
      if(o.geometry)geometries.add(o.geometry);
      if(o.material){const ms=Array.isArray(o.material)?o.material:[o.material];ms.forEach(m=>materialsToDispose.add(m));}
    });
    geometries.forEach(g=>g.dispose());materialsToDispose.forEach(m=>m.dispose&&m.dispose());
    mountainRoot=null;mountainConfig=null;mountainClock=0;
  }
  function mountainSeedNoise(seed,a,b){
    const v=Math.sin(a*12.9898+b*78.233+(seed>>>0)*0.000013)*43758.5453;
    return (v-Math.floor(v))*2-1;
  }
  function mountainSmooth(t){t=clamp(t,0,1);return t*t*(3-2*t);}
  function mountainRiverCenter(s,half,seed,side){
    return half*(.56+.045*Math.sin(s*.00135+(seed%971)*.013+side)+.018*Math.sin(s*.0031+side*2.7));
  }
  function mountainHeightAt(s,offset,side,routeY,half,peak,style,seed){
    const phase=s*.00115+(seed%997)*.017+side*.9;
    const n1=Math.sin(phase*1.7+offset*.0018),n2=Math.sin(phase*3.2-offset*.0041),n3=mountainSeedNoise(seed,Math.floor(s/23),Math.floor(offset/17));
    const river=mountainRiverCenter(s,half,seed,side);
    const riverWidth=Math.max(34,half*.035);
    const riverBlend=Math.exp(-Math.pow((offset-river)/riverWidth,2));
    const start=8;
    const wallRise=Math.max(85,routeY*.78,peak*.18);
    const inner=wallRise*mountainSmooth((offset-start)/Math.max(120,half*.045));
    const ridge1=half*(style==='canyon'?.24:style==='karst'?.20:style==='volcanic'?.34:.29)+half*.035*Math.sin(phase*1.1);
    const ridge2=half*(style==='plateau'?.79:.82)+half*.035*Math.sin(phase*.8+2.0);
    const sigma1=half*(style==='karst'?.065:style==='volcanic'?.09:style==='plateau'?.13:.15);
    const sigma2=half*.13;
    const g1=Math.exp(-Math.pow((offset-ridge1)/Math.max(1,sigma1),2));
    const g2=Math.exp(-Math.pow((offset-ridge2)/Math.max(1,sigma2),2));
    const variation=.78+.15*n1+.055*n2+.035*n3;
    let ridgeA=peak*g1*variation;
    let ridgeB=peak*.56*g2*(.82+.16*n2);
    if(style==='karst') ridgeA*=.40+.60*Math.pow(Math.abs(Math.sin(phase*4.3+offset*.006)),1.4);
    if(style==='plateau') ridgeA*=.72+.28*mountainSmooth(1-Math.abs(offset-ridge1)/(sigma1*1.05));
    if(style==='volcanic'){
      const crater=Math.exp(-Math.pow((offset-ridge1*.96)/(half*.035),2));
      ridgeA*=1-.42*crater;
      ridgeB*=.65;
    }
    if(style==='forest') {ridgeA*=.78;ridgeB*=.66;}
    if(style==='canyon') {ridgeA*=1.10;ridgeB*=.92;}
    if(style==='rugged') {ridgeA*=1.08;ridgeB*=.84;}
    const rough=peak*(style==='forest'?.012:.035)*(n1*.55+n2*.3+n3*.15);
    let height=inner+ridgeA+ridgeB+rough;
    const valleyFloor=5+2.2*Math.sin(phase*2.6)+Math.abs(n3)*1.6;
    height=height*(1-.985*riverBlend)+valleyFloor*riverBlend;
    if(style==='canyon'){
      const strata=Math.sin((height+offset*.16)*.055+phase)*7;
      height+=strata*(1-riverBlend);
    }
    if(style==='plateau'){
      const mesa=mountainSmooth((offset-ridge1+sigma1*.9)/(sigma1*.35))*mountainSmooth((ridge1+sigma1*.9-offset)/(sigma1*.35));
      height=Math.max(height,ridgeA*.78*mesa+inner);
    }
    return Math.max(0,height);
  }
  function buildRouteSpatial(samples,cell=20){
    const bins=new Map();
    for(const p of samples){const x=Math.floor(p.x/cell),z=Math.floor(p.z/cell),key=`${x},${z}`;let a=bins.get(key);if(!a)bins.set(key,a=[]);a.push(p);}
    return {bins,cell};
  }
  function isNearRoute(spatial,x,z,minDistance=7.5){
    const c=spatial.cell,gx=Math.floor(x/c),gz=Math.floor(z/c),r=Math.ceil(minDistance/c)+1,d2=minDistance*minDistance;
    for(let ix=-r;ix<=r;ix++)for(let iz=-r;iz<=r;iz++){
      const bucket=spatial.bins.get(`${gx+ix},${gz+iz}`);if(!bucket)continue;
      for(const p of bucket){const dx=p.x-x,dz=p.z-z;if(dx*dx+dz*dz<d2)return true;}
    }
    return false;
  }
  function makeMountainTerrain(config={}){
    disposeMountains();
    const tr=getTrack();
    const styles=['alpine','forest','canyon','volcanic','karst','plateau','rugged','snow'];
    const style=styles.includes(config.style)?config.style:'alpine';
    const maxHeight=clamp(Number(config.height)||900,160,1800);
    const areaWidth=clamp(Number(config.areaWidth)||10000,3000,16000),half=areaWidth*.5;
    const seed=(Number(config.seed)||((Date.now()>>>0)^0x61c88647))>>>0;
    const route=routeSamples(tr,14000),spatial=buildRouteSpatial(route,20);
    const root=new T.Group();root.name='CoasterContinuousMountainValley';
    const palettes={
      alpine:[0x354b38,0x7b817b,0xe7eceb],forest:[0x244c31,0x57734a,0x9a9d7d],canyon:[0x65483a,0xb07850,0xe3c08a],
      volcanic:[0x292c2b,0x65554d,0x9c7a59],karst:[0x365b43,0x9a9b8a,0xe1e2d8],plateau:[0x5b6043,0x9c855d,0xc4aa7d],
      rugged:[0x3d4d48,0x777b76,0xc0c4bf],snow:[0x40515d,0x9daeb7,0xf0f5f7]
    };
    const cLow=new T.Color(palettes[style][0]),cMid=new T.Color(palettes[style][1]),cHigh=new T.Color(palettes[style][2]);
    const material=new T.MeshStandardMaterial({vertexColors:true,roughness:style==='volcanic'?.96:.99,metalness:0,side:T.DoubleSide,flatShading:false});
    const waterMaterial=new T.MeshStandardMaterial({color:0x3988ad,roughness:.16,metalness:.16,transparent:true,opacity:.9,side:T.DoubleSide,emissive:0x082b3a,emissiveIntensity:.18});
    const stations=clamp(Math.ceil(tr.L/18),150,520),lateralSegments=48;
    const geometries=[];
    const routeHigh=Math.max(0,...route.map(p=>p.y||0));
    const peakBase=Math.max(maxHeight,routeHigh+Math.min(420,maxHeight*.42));
    const heightAt=(s,offset,side,routeY)=>mountainHeightAt(s,offset,side,routeY,half,peakBase,style,seed);
    for(const side of [-1,1]){
      const positions=[],colors=[],indices=[];
      for(let i=0;i<=stations;i++){
        const s=tr.L*i/stations,frame=frameAt(tr,s);
        const routeY=Math.max(0,frame.y||0);
        for(let j=0;j<=lateralSegments;j++){
          const t=j/lateralSegments;
          let offset=8+(half-8)*Math.pow(t,1.52);
          let p=worldFromLocal(frame,side*offset,0);
          // Every terrain vertex is checked against the complete route, including crossings and tight turns.
          for(let attempt=0;attempt<7&&isNearRoute(spatial,p.x,p.z,7.5);attempt++){
            offset+=7.5;p=worldFromLocal(frame,side*offset,0);
          }
          const y=heightAt(s,offset,side,routeY)-2;
          positions.push(p.x,y,p.z);
          let hNorm=clamp(y/Math.max(1,peakBase),0,1);
          let color=cLow.clone().lerp(cMid,clamp(hNorm*1.8,0,1));
          color.lerp(cHigh,clamp((hNorm-.52)*1.7,0,.92));
          const rugged=mountainSeedNoise(seed+side*31,Math.floor(s/28),Math.floor(offset/21));
          color.multiplyScalar(.94+((rugged+1)*.03));
          if((style==='alpine'||style==='snow')&&hNorm>.78)color.lerp(new T.Color(0xf3f5f5),clamp((hNorm-.78)/.18,0,1));
          if(style==='volcanic'&&rugged>.68)color.lerp(new T.Color(0x3a2b27),.28);
          colors.push(color.r,color.g,color.b);
        }
      }
      for(let i=0;i<stations;i++)for(let j=0;j<lateralSegments;j++){
        const a=i*(lateralSegments+1)+j,b=a+lateralSegments+1;
        indices.push(a,b,a+1,a+1,b,b+1);
      }
      const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(positions,3));geo.setAttribute('color',new T.Float32BufferAttribute(colors,3));geo.setIndex(indices);geo.computeVertexNormals();geo.computeBoundingSphere();
      const mesh=new T.Mesh(geo,material);mesh.name=`MountainTerrain_${side>0?'Right':'Left'}_${style}`;mesh.frustumCulled=true;root.add(mesh);geometries.push(geo);

      // A winding river occupies the low valley in each mountain flank.
      const riverPositions=[],riverIndices=[],riverWidth=clamp(areaWidth*.0014,9,22),riverSteps=stations;
      for(let i=0;i<=riverSteps;i++){
        const s=tr.L*i/riverSteps,frame=frameAt(tr,s),routeY=Math.max(0,frame.y||0);
        const centerOffset=mountainRiverCenter(s,half,seed,side);
        const floorY=heightAt(s,centerOffset,side,routeY)-2;
        for(const edge of [-.5,.5]){
          const off=centerOffset+edge*riverWidth;
          const p=worldFromLocal(frame,side*off,0);
          riverPositions.push(p.x,Math.max(1,floorY+1.1),p.z);
        }
      }
      for(let i=0;i<riverSteps;i++){const a=i*2;riverIndices.push(a,a+2,a+1,a+1,a+2,a+3);}
      const riverGeo=new T.BufferGeometry();riverGeo.setAttribute('position',new T.Float32BufferAttribute(riverPositions,3));riverGeo.setIndex(riverIndices);riverGeo.computeVertexNormals();riverGeo.computeBoundingSphere();
      const river=new T.Mesh(riverGeo,waterMaterial);river.name=`MountainRiver_${side>0?'Right':'Left'}`;root.add(river);geometries.push(riverGeo);
    }

    // Tree belts are instanced so large mountain ranges remain practical on phones.
    if(['alpine','forest','karst','rugged','snow'].includes(style)){
      const treeCount=style==='forest'?1500:style==='alpine'?1000:style==='snow'?650:850;
      const treeGeo=new T.ConeGeometry(1,1,7);
      const treeMat=new T.MeshStandardMaterial({color:style==='snow'?0x315443:0x31583a,roughness:1});
      const trees=new T.InstancedMesh(treeGeo,treeMat,treeCount);trees.name='MountainForestTreeBelt';
      const dummy=new T.Object3D(),rng=rand(seed^0x5f3759df);let placed=0;
      for(let i=0;i<treeCount;i++){
        const side=rng()<.5?-1:1,s=rng()*tr.L,frame=frameAt(tr,s);
        const off=half*(.12+rng()*.30);
        if(Math.abs(off-mountainRiverCenter(s,half,seed,side))<120)continue;
        const p=worldFromLocal(frame,side*off,0);
        if(isNearRoute(spatial,p.x,p.z,75))continue;
        const base=heightAt(s,off,side,Math.max(0,frame.y||0))-1;
        const h=(style==='snow'?5:7)+rng()*(style==='forest'?18:12),w=h*(.24+rng()*.10);
        dummy.position.set(p.x,base+h*.5,p.z);dummy.rotation.set(0,rng()*Math.PI*2,0);dummy.scale.set(w,h,w);dummy.updateMatrix();trees.setMatrixAt(placed++,dummy.matrix);
      }
      trees.count=placed;trees.instanceMatrix.needsUpdate=true;root.add(trees);
    }
    if(!root.children.length){material.dispose();waterMaterial.dispose();throw new Error('山岳メッシュを生成できませんでした。');}
    scene.add(root);mountainRoot=root;mountainClock=0;
    mountainConfig={enabled:true,style,height:maxHeight,areaWidth,seed,count:root.children.filter(o=>o.name.startsWith('MountainTerrain')).length,riverCount:2,routeClearance:7.5};
    const worldFar=Math.max(14000,areaWidth*2.8);
    if(scene.fog)scene.fog.far=Math.max(scene.fog.far||0,worldFar);
    if(api.camera.far<worldFar){api.camera.far=worldFar;api.camera.updateProjectionMatrix();}
    setStatus(`山岳地形を生成：${style}／連続山体2面・河川2本・樹林帯。線路との最小平面離隔7.5mを検査しました。`);
    return mountainConfig;
  }
  function clearMountains(){disposeMountains();setStatus('山岳地形を削除しました。コースの高さと形はそのままです。');}
  // City and mountain scenery are persisted as procedural settings in project ZIPs.
  function cityMeshes(){return [];}

  function addJetMesh(root, geometry, material, name, position = null) {
    const mesh = new T.Mesh(geometry, material); mesh.name = name;
    if (position) mesh.position.set(position[0], position[1], position[2]);
    mesh.castShadow = true; mesh.receiveShadow = true; root.add(mesh); return mesh;
  }
  function makeFuselageGeometry() {
    // Elliptical section loft: nose and tail taper continuously instead of using a box/cylinder.
    const sections = [
      [-19.2,.08,.10,.02],[-18.4,.42,.42,.02],[-16.8,.78,.72,.02],[-14.0,1.12,1.00,0],
      [-10.0,1.48,1.28,0],[-4.0,1.76,1.50,0],[4.0,1.82,1.55,0],[9.5,1.68,1.42,.02],
      [13.0,1.34,1.12,.06],[15.5,.92,.78,.10],[17.4,.42,.40,.12],[18.2,.06,.08,.12]
    ];
    const radial=40,positions=[],indices=[];
    for(const [z,rx,ry,cy] of sections){
      for(let j=0;j<radial;j++){
        const a=j/radial*Math.PI*2;
        positions.push(Math.cos(a)*rx,cy+Math.sin(a)*ry,z);
      }
    }
    for(let i=0;i<sections.length-1;i++)for(let j=0;j<radial;j++){
      const a=i*radial+j,b=i*radial+(j+1)%radial,c=(i+1)*radial+(j+1)%radial,d=(i+1)*radial+j;
      indices.push(a,b,d,b,c,d);
    }
    const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.setIndex(indices);g.computeVertexNormals();g.computeBoundingSphere();return g;
  }
  function makeAirfoilWing(sections, side, material, root, name) {
    const seg=20,positionsTop=[],positionsBottom=[],indices=[];
    for(const sec of sections){
      for(let j=0;j<=seg;j++){
        const t=j/seg;
        const thickness=5*.12*sec.chord*(.2969*Math.sqrt(Math.max(0,t))-.1260*t-.3516*t*t+.2843*t*t*t-.1015*t*t*t*t);
        const z=sec.lead+t*sec.chord;
        positionsTop.push(side*sec.span,sec.y+thickness,z);
        positionsBottom.push(side*sec.span,sec.y-thickness,z);
      }
    }
    for(let i=0;i<sections.length-1;i++)for(let j=0;j<seg;j++){
      const a=i*(seg+1)+j,b=(i+1)*(seg+1)+j,c=b+1,d=a+1;
      indices.push(a,b,d,b,c,d);
    }
    for(const [positions,suffix] of [[positionsTop,'Upper'],[positionsBottom,'Lower']]){
      const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.setIndex(indices);g.computeVertexNormals();g.computeBoundingSphere();
      addJetMesh(root,g,material,`${name}_${suffix}`);
    }
  }
  function makeProceduralJet() {
    const root=new T.Group();root.name='Coaster_Original_TwinEngine_Jet';
    const white=new T.MeshStandardMaterial({color:0xf1f2ee,roughness:.48,metalness:.16});
    const underside=new T.MeshStandardMaterial({color:0xc6cdd0,roughness:.62,metalness:.12});
    const metal=new T.MeshStandardMaterial({color:0x8d999f,roughness:.34,metalness:.72});
    const darkMetal=new T.MeshStandardMaterial({color:0x303a40,roughness:.58,metalness:.35});
    const glass=new T.MeshStandardMaterial({color:0x1e3949,roughness:.13,metalness:.28,transparent:true,opacity:.92});
    const tire=new T.MeshStandardMaterial({color:0x161a1d,roughness:.9});
    const hub=new T.MeshStandardMaterial({color:0xc2c8cb,roughness:.28,metalness:.8});
    const lightRed=new T.MeshBasicMaterial({color:0xff3028});
    const lightGreen=new T.MeshBasicMaterial({color:0x32e78c});
    const lightWhite=new T.MeshBasicMaterial({color:0xfff2d0});
    addJetMesh(root,makeFuselageGeometry(),white,'Fuselage');
    // Subtle lower belly and nose radome seam.
    const belly=addJetMesh(root,new T.SphereGeometry(1,24,16),underside,'LowerBelly',[0,-.38,-2]);belly.scale.set(1.65,.92,13.4);
    const radome=addJetMesh(root,new T.SphereGeometry(1,24,16),underside,'NoseRadome',[0,.02,17.1]);radome.scale.set(.52,.40,1.12);
    // Swept, tapered wings with a cambered airfoil section and visible wing tips.
    const wingSections=[
      {span:0,lead:2.4,chord:8.4,y:-.04},{span:4.5,lead:1.1,chord:7.45,y:.04},
      {span:10.5,lead:-.85,chord:5.45,y:.28},{span:15.2,lead:-3.15,chord:3.45,y:.68},{span:18.0,lead:-5.25,chord:2.05,y:1.02}
    ];
    makeAirfoilWing(wingSections,1,white,root,'RightWing');
    makeAirfoilWing(wingSections,-1,white,root,'LeftWing');
    // Winglets, navigation lamps and flap/aileron panels.
    for(const side of [-1,1]){
      const winglet=new T.Shape();winglet.moveTo(0,0);winglet.lineTo(0,1.0);winglet.lineTo(.18,2.8);winglet.lineTo(.82,3.8);winglet.lineTo(1.15,3.65);winglet.lineTo(.65,1.3);winglet.lineTo(.45,0);winglet.closePath();
      const wg=new T.ExtrudeGeometry(winglet,{depth:.22,bevelEnabled:true,bevelSegments:2,steps:1,bevelSize:.04,bevelThickness:.05});
      const wm=addJetMesh(root,wg,white,`Winglet_${side}`,[side*17.85,.85,-4.95]);wm.rotation.z=side*.08;
      const nav=addJetMesh(root,new T.SphereGeometry(.16,12,8),side<0?lightRed:lightGreen,`NavigationLight_${side}`,[side*18.15,1.05,-4.9]);nav.scale.set(1,.8,1.2);
      const flap=new T.Group();flap.name=`Aileron_${side}`;flap.position.set(side*11.6,-.02,-2.55);
      const panel=new T.Mesh(new T.BoxGeometry(4.7,.095,1.45),underside);panel.position.set(0,-.02,-.66);flap.add(panel);root.add(flap);
      if(!root.userData.ailerons)root.userData.ailerons=[];root.userData.ailerons.push({group:flap,side});
      const flapGroup=new T.Group();flapGroup.name=`Flap_${side}`;flapGroup.position.set(side*6.6,-.03,-1.85);
      const flapMesh=new T.Mesh(new T.BoxGeometry(4.2,.10,1.75),white);flapMesh.position.z=-.78;flapGroup.add(flapMesh);root.add(flapGroup);
      if(!root.userData.flaps)root.userData.flaps=[];root.userData.flaps.push(flapGroup);
    }
    // Horizontal stabilizer uses the same lofted airfoil treatment.
    const tailSections=[{span:0,lead:-15.0,chord:4.6,y:.65},{span:3.0,lead:-15.8,chord:3.7,y:.84},{span:7.2,lead:-17.0,chord:2.0,y:1.10}];
    makeAirfoilWing(tailSections,1,white,root,'RightTailplane');makeAirfoilWing(tailSections,-1,white,root,'LeftTailplane');
    // Vertical tail, rudder and dorsal fairing.
    const finShape=new T.Shape();finShape.moveTo(-.42,0);finShape.lineTo(.42,0);finShape.lineTo(.48,1.8);finShape.lineTo(.35,4.3);finShape.lineTo(.18,5.0);finShape.lineTo(-.40,3.1);finShape.closePath();
    const finGeo=new T.ExtrudeGeometry(finShape,{depth:.58,bevelEnabled:true,bevelSegments:2,steps:1,bevelSize:.07,bevelThickness:.07});
    addJetMesh(root,finGeo,white,'VerticalTail',[0,.85,-16.9]);
    const rudder=new T.Group();rudder.name='Rudder';rudder.position.set(0,3.0,-16.8);
    const rudderMesh=new T.Mesh(new T.BoxGeometry(.12,2.55,.10),underside);rudderMesh.position.y=.1;rudder.add(rudderMesh);root.add(rudder);
    root.userData.rudder=rudder;
    const elevatorL=addJetMesh(root,new T.BoxGeometry(3.2,.09,.78),underside,'Elevator_Left',[-3.9,1.2,-17.0]);
    const elevatorR=addJetMesh(root,new T.BoxGeometry(3.2,.09,.78),underside,'Elevator_Right',[3.9,1.2,-17.0]);
    root.userData.elevators=[elevatorL,elevatorR];
    // Two detailed turbofan nacelles, with intake lips, fan blades and exhausts.
    const engineFans=[];
    for(const side of [-1,1]){
      const eg=new T.Group();eg.name=`Turbofan_${side}`;eg.position.set(side*7.05,-1.22,.20);root.add(eg);
      const profile=[[.68,-3.05],[.82,-2.82],[.98,-2.15],[1.05,-.95],[1.12,.95],[1.20,2.15],[1.16,2.55],[1.02,2.72],[.86,2.60],[.79,2.2]];
      const lathe=new T.LatheGeometry(profile.map(v=>new T.Vector2(v[0],v[1])),32);lathe.rotateX(Math.PI/2);
      addJetMesh(eg,lathe,metal,'Nacelle');
      const intake=new T.Mesh(new T.TorusGeometry(1.06,.085,12,36),hub);intake.position.z=2.58;eg.add(intake);
      const disk=new T.Mesh(new T.CircleGeometry(.94,36),darkMetal);disk.position.z=2.61;eg.add(disk);
      const fan=new T.Group();fan.name='FanRotor';fan.position.z=2.64;eg.add(fan);
      for(let k=0;k<18;k++){
        const blade=new T.Mesh(new T.BoxGeometry(.11,.74,.055),hub);
        const a=k/18*Math.PI*2;blade.position.set(Math.cos(a)*.43,Math.sin(a)*.43,0);blade.rotation.z=a+.30;fan.add(blade);
      }
      const spinner=new T.Mesh(new T.SphereGeometry(.24,16,10),metal);spinner.scale.set(1,1,.55);spinner.position.z=.03;fan.add(spinner);
      const exhaust=new T.Mesh(new T.TorusGeometry(.79,.075,10,32),darkMetal);exhaust.position.z=-3.0;eg.add(exhaust);
      const pylon=addJetMesh(root,new T.BoxGeometry(.92,1.55,2.9),white,`EnginePylon_${side}`,[side*7.05,-.62,-.15]);pylon.rotation.x=.08;
      engineFans.push(fan);
    }
    // Passenger windows, four cockpit panes and door outlines.
    const windowGeo=new T.SphereGeometry(1,12,8);
    for(const side of [-1,1])for(let i=0;i<18;i++){
      const z=-11.0+i*1.22;
      const win=addJetMesh(root,windowGeo,glass,`CabinWindow_${side}_${i}`,[side*1.55,1.03,z]);win.scale.set(.075,.205,.30);
    }
    for(const side of [-1,1]){
      for(let i=0;i<2;i++){
        const pane=addJetMesh(root,new T.SphereGeometry(1,12,8),glass,`CockpitWindow_${side}_${i}`,[side*(.30+i*.40),.83,14.15-i*.48]);pane.scale.set(.27,.30,.09);pane.rotation.x=-.20;
      }
      for(const z of [8.4,-4.3]){
        const door=addJetMesh(root,new T.BoxGeometry(.045,1.35,.78),metal,`CabinDoorFrame_${side}_${z}`,[side*1.68,.12,z]);
      }
    }
    // Static antennas, pitot tubes, landing lights and beacon lamps.
    for(const side of [-1,1]){
      const pitot=addJetMesh(root,new T.CylinderGeometry(.025,.035,1.2,8),metal,`Pitot_${side}`,[side*1.7,.18,11.8]);pitot.rotation.z=Math.PI/2;
      const wingLight=addJetMesh(root,new T.SphereGeometry(.13,10,8),lightWhite,`WingLandingLight_${side}`,[side*9.2,-.05,-.2]);
    }
    const beacon=new T.PointLight(0xff3322,1.3,28);beacon.position.set(0,2.1,-2.8);root.add(beacon);
    const tailBeacon=addJetMesh(root,new T.SphereGeometry(.15,12,8),lightRed,'TailBeacon',[0,5.25,-16.7]);
    // Functional landing gear assemblies with twin main wheels and a steerable nose wheel.
    const gearGroup=new T.Group();gearGroup.name='landing-gear-assembly';root.add(gearGroup);
    function addGear(x,z,nose=false){
      const g=new T.Group();g.name=nose?'nose-gear':'main-gear';g.position.set(x,0,z);gearGroup.add(g);
      const strut=new T.Mesh(new T.CylinderGeometry(nose?.10:.13,nose?.14:.18,nose?1.85:2.25,12),metal);strut.position.y=nose?-1.15:-1.35;g.add(strut);
      const fork=new T.Mesh(new T.BoxGeometry(.16,.75,.16),hub);fork.position.set(0,nose?-2.42:-2.35,.03);g.add(fork);
      const wheelCount=nose?1:2;
      for(let i=0;i<wheelCount;i++){
        const wheel=new T.Mesh(new T.CylinderGeometry(nose?.36:.48,nose?.36:.48,.25,20),tire);wheel.rotation.z=Math.PI/2;
        wheel.position.set(nose?0:(i?-.30:.30),nose?-2.78:-2.67,.09);g.add(wheel);
        const rim=new T.Mesh(new T.CylinderGeometry(nose?.17:.23,nose?.17:.23,.265,16),hub);rim.rotation.z=Math.PI/2;rim.position.copy(wheel.position);g.add(rim);
      }
      const door=addJetMesh(g,new T.BoxGeometry(nose?.8:1.4,.10,nose?1.2:1.7),underside,'GearDoor',[0,-.52,-.25]);door.rotation.x=.06;
    }
    addGear(0,10.3,true);addGear(-4.25,-3.9,false);addGear(4.25,-3.9,false);
    return {root,gearParts:[gearGroup],beacon,navRed:null,navGreen:null,engineFans,ailerons:root.userData.ailerons,flaps:root.userData.flaps,elevators:root.userData.elevators,rudder:root.userData.rudder,modelStatus:'オリジナル3D旅客機（ローカル生成・通信不要）'};
  }
  async function buildAircraft(){
    // All geometry is generated locally with Three.js; no remote model fetch and no CORS dependency.
    return makeProceduralJet();
  }
  function makeFlightUI(){
    const ui=document.createElement('section');ui.id='city-flight-ui';ui.hidden=true;
    ui.innerHTML=`
      <div class="cf-head"><b>フライトシミュレーター</b><span data-f-status>RUNWAY READY</span><button type="button" data-f-action="exit">終了</button></div>
      <div class="cf-readouts"><span>速度<strong data-f-speed>0 km/h</strong></span><span>高度<strong data-f-alt>0 m</strong></span><span>方位<strong data-f-heading>000°</strong></span><span>昇降<strong data-f-vs>0 m/s</strong></span></div>
      <div class="cf-main"><div class="cf-controls">
        <div class="cf-controlrow"><button data-f-control="pitchUp">機首 ↑</button><button data-f-control="rollLeft">左傾斜</button><button data-f-control="rollRight">右傾斜</button><button data-f-control="pitchDown">機首 ↓</button></div>
        <div class="cf-controlrow"><button data-f-control="yawLeft">左ラダー</button><button data-f-control="yawRight">右ラダー</button><button data-f-action="gear" data-f-gear>脚を格納</button><button data-f-action="flaps" data-f-flaps>フラップ 20°</button></div>
      </div><div class="cf-throttle"><label>スロットル <output data-f-throttle-label>32%</output></label><input type="range" min="0" max="100" value="32" data-f-throttle><button data-f-action="throttle">最大出力</button></div></div>
      <div class="cf-foot"><button data-f-action="chase" aria-pressed="true">追従カメラ</button><button data-f-action="cockpit" aria-pressed="false">コックピット</button><button data-f-action="pause">一時停止</button><button data-f-action="reset">滑走路から再開</button><span class="cf-hint">PC：W/S 機首・A/D ロール・Q/E ラダー・Shift/Ctrl 出力｜スマホ：画面ボタン長押し</span></div>`;
    const style=document.createElement('style');style.id='city-flight-style';style.textContent=`
      #city-flight-ui{position:fixed;z-index:2147483646;left:10px;right:10px;bottom:10px;max-width:900px;margin:auto;padding:10px;border:1px solid #cfd9dd;border-radius:8px;background:rgba(251,248,239,.97);color:#2b3a55;box-shadow:0 4px 18px #25364b25;font:12px/1.35 system-ui,sans-serif;backdrop-filter:blur(8px);touch-action:pan-y}
      #city-flight-ui[hidden]{display:none!important}.cf-head{display:flex;align-items:center;gap:10px}.cf-head b{font-size:14px;letter-spacing:.08em}.cf-head span{flex:1;color:#526b80;font-weight:800}.cf-head button,.cf-foot button,.cf-controls button,.cf-throttle button{min-height:32px;padding:6px 9px;border:1px solid #c4d0d8;border-radius:6px;background:#fff;color:#2b3a55;font:700 12px system-ui}.cf-readouts{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin:9px 0}.cf-readouts span{padding:7px;border:1px solid #d8e0e4;border-radius:6px;background:#fff;color:#66798a}.cf-readouts strong{display:block;color:#2b3a55;font-size:18px;font-variant-numeric:tabular-nums}.cf-main{display:grid;grid-template-columns:1fr minmax(130px,190px);gap:9px}.cf-controls{display:grid;gap:6px}.cf-controlrow{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:5px}.cf-controls button{min-height:43px;touch-action:none;user-select:none;background:#fff}.cf-throttle{display:grid;gap:7px;align-content:center;padding:8px;border-radius:9px;background:#f8faf9;border:1px solid #d8e0e4}.cf-throttle label{display:flex;justify-content:space-between;font-weight:700}.cf-throttle input{width:100%;accent-color:#486d91}.cf-foot{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:8px}.cf-foot button[aria-pressed=true]{background:#e5edf3;border-color:#9eb1c1}.cf-hint{flex:1 1 100%;color:#66798a;font-size:10px}.cf-head button{background:#fff;border-color:#c4d0d8}
      @media(max-width:560px){#city-flight-ui{left:5px;right:5px;bottom:5px;padding:8px;max-height:52vh;overflow:auto}.cf-readouts strong{font-size:16px}.cf-main{grid-template-columns:1fr}.cf-controlrow button{padding:6px 3px;font-size:11px;min-height:40px}.cf-throttle{grid-template-columns:1fr;}.cf-foot button{flex:1 1 30%;}}
    `;
    document.head.appendChild(style);document.body.appendChild(ui);return ui;
  }
  function setStatus(text,bad=false){const el=panel.querySelector('[data-cf-status]')||panel.querySelector('[data-cf-stats]');if(el){el.textContent=text;el.classList.toggle('bad',bad);}}
  function setFlightStatus(text){if(flightUI){const el=flightUI.querySelector('[data-f-status]');if(el)el.textContent=text;}}
  function updateFlightReadouts(){
    if(!flightUI||!flight)return;
    const s=flight.speed*3.6, h=Math.max(0,flight.pos.y-FLIGHT_GROUND_ALT), hd=((flight.yaw*180/Math.PI)%360+360)%360;
    flightUI.querySelector('[data-f-speed]').textContent=`${Math.round(s)} km/h`;
    flightUI.querySelector('[data-f-alt]').textContent=`${Math.round(h)} m`;
    flightUI.querySelector('[data-f-heading]').textContent=`${String(Math.round(hd)).padStart(3,'0')}°`;
    flightUI.querySelector('[data-f-vs]').textContent=`${flight.vSpeed>=0?'+':''}${flight.vSpeed.toFixed(1)} m/s`;
    flightUI.querySelector('[data-f-throttle-label]').textContent=`${Math.round(flight.throttle*100)}%`;
  }
  function makeFlightState(aircraft){
    if(!routeCache) makeCity({density:'dense'});
    const a=routeCache.airport.spawn;
    scene.add(aircraft.root);
    const f={...aircraft,pos:new T.Vector3(a.x,a.y,a.z),speed:0,yaw:a.yaw,pitch:0,roll:0,vSpeed:0,throttle:0.32,gear:true,flaps:0.25,airborne:false,paused:false,view:'chase',crashed:false,landed:false,time:0,control:{pitch:0,roll:0,yaw:0},lastCollision:0,engineFans:aircraft.engineFans||[],ailerons:aircraft.ailerons||[],flapParts:aircraft.flaps||[],elevators:aircraft.elevators||[],rudder:aircraft.rudder||null};
    f.root.position.copy(f.pos);flight=f;return f;
  }
  function applyFlightOrientation(){
    if(!flight)return;
    flight.root.rotation.order='YXZ';flight.root.rotation.y=flight.yaw;flight.root.rotation.x=-flight.pitch;flight.root.rotation.z=flight.roll;
  }
  function checkBuildingCollision(pos){
    for(const b of colliders){
      if(pos.y<b.minY+1.2||pos.y>b.maxY+3)continue;
      const dx=pos.x-b.x,dz=pos.z-b.z,c=Math.cos(b.yaw),s=Math.sin(b.yaw);
      const lx=dx*c-dz*s-b.cx,lz=dx*s+dz*c-b.cz;
      if(Math.abs(lx)<b.halfW+2.8&&Math.abs(lz)<b.halfD+3.5)return b;
    }
    return null;
  }
  function setFlightView(view){
    if(!flight)return;flight.view=view;
    if(flightUI){flightUI.querySelector('[data-f-action="chase"]').setAttribute('aria-pressed',String(view==='chase'));flightUI.querySelector('[data-f-action="cockpit"]').setAttribute('aria-pressed',String(view==='cockpit'));}
  }
  function cameraFlight(){
    const f=flight;if(!f)return;
    const forward=new T.Vector3(Math.sin(f.yaw)*Math.cos(f.pitch),Math.sin(f.pitch),Math.cos(f.yaw)*Math.cos(f.pitch));
    if(f.view==='cockpit'){
      const eye=f.root.localToWorld(new T.Vector3(0,2.45,11.9));
      api.camera.position.copy(eye);api.camera.up.set(0,1,0);api.camera.lookAt(eye.clone().add(forward.clone().multiplyScalar(120)));
    }else{
      const eye=f.pos.clone().addScaledVector(forward,-38).add(new T.Vector3(0,12,0));
      api.camera.position.lerp(eye,0.13);api.camera.up.set(0,1,0);api.camera.lookAt(f.pos.clone().addScaledVector(forward,22).add(new T.Vector3(0,3,0)));
    }
    if(api.camera.far<Math.max(7000,(routeCache?.areaWidth||10000)*2.2)){api.camera.far=Math.max(7000,(routeCache?.areaWidth||10000)*2.2);api.camera.updateProjectionMatrix();}
  }
  function resetFlight(){
    if(!flight)return;
    const a=routeCache.airport.spawn;
    flight.pos.set(a.x,a.y,a.z);flight.root.position.copy(flight.pos);flight.root.rotation.set(0,a.yaw,0);
    flight.speed=0;flight.yaw=a.yaw;flight.pitch=0;flight.roll=0;flight.vSpeed=0;flight.throttle=.32;flight.gear=true;flight.flaps=.25;flight.airborne=false;flight.paused=false;flight.crashed=false;flight.landed=false;flight.time=0;
    flightUI.querySelector('[data-f-throttle]').value='32';flightUI.querySelector('[data-f-gear]').textContent='脚を格納';flightUI.querySelector('[data-f-flaps]').textContent='フラップ 20°';flightUI.querySelector('[data-f-action="pause"]').textContent='一時停止';
    setFlightStatus('RUNWAY READY');updateFlightReadouts();
  }
  function closeFlight(){
    if(flightLoading){flightLoadToken++;flightLoading=false;flightUI.hidden=true;removeTrackFromView();exitExternalView();}
    if(!flight)return;
    scene.remove(flight.root);flight.root.traverse(o=>{if(o.geometry)o.geometry.dispose();});
    flight.root.traverse(o=>{if(o.material){const ms=Array.isArray(o.material)?o.material:[o.material];ms.forEach(m=>m.dispose());}});
    flight=null;flightUI.hidden=true;flightKeys=Object.create(null);
    removeTrackFromView();exitExternalView();
    setStatus('フライトシムを終了しました。通常のゲーム画面に戻りました。');
  }
  function enterExternalView(){
    if(viewEditorHidden===null){
      viewEditorHidden=editor.root?!!editor.root.hidden:null;
      if(editor.root)editor.root.hidden=true;
      oldFog=scene.fog?{near:scene.fog.near,far:scene.fog.far}:null;
      oldFar=api.camera.far;
    }
    const worldFar=Math.max(12000,(routeCache?.areaWidth||10000)*2.6);
    if(scene.fog){scene.fog.near=650;scene.fog.far=worldFar;}
    if(api.camera.far<worldFar){api.camera.far=worldFar;api.camera.updateProjectionMatrix();}
  }
  function exitExternalView(){
    if(api.clearFrameHook)api.clearFrameHook();else if(api.setFrameHook)api.setFrameHook(null);
    if(viewEditorHidden!==null&&editor.root)editor.root.hidden=viewEditorHidden;
    viewEditorHidden=null;
    if(oldFog&&scene.fog){scene.fog.near=oldFog.near;scene.fog.far=oldFog.far;}
    if(oldFar!=null){api.camera.far=oldFar;api.camera.updateProjectionMatrix();}
    oldFog=null;oldFar=null;
  }
  function addTrackToView(){
    if(previewTrackGroup||typeof api.createTrackExportGroup!=='function')return;
    const built=api.createTrackExportGroup(editor.design);
    previewTrackGroup=built.group;previewTrackGroup.name='CityFlight_TrackPreview';scene.add(previewTrackGroup);
  }
  function removeTrackFromView(){
    if(!previewTrackGroup)return;
    scene.remove(previewTrackGroup);
    previewTrackGroup.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material){const ms=Array.isArray(o.material)?o.material:[o.material];ms.forEach(m=>m.dispose&&m.dispose());}});
    previewTrackGroup=null;
  }
  function startCityPreview(){
    if(flight)throw new Error('フライト中は都市プレビューを開始できません。');
    if(!routeCache)throw new Error('先に都市街区を生成してください。');
    enterExternalView();addTrackToView();
    previewActive=true;previewAngle=0;if(previewExitUI)previewExitUI.hidden=false;
    api.setFrameHook((dt)=>{
      previewAngle+=Math.min(.05,dt)*.085;
      const c=routeCache.center;
      const radius=Math.max(190,Math.max(routeCache.bounds.maxX-routeCache.bounds.minX,routeCache.bounds.maxZ-routeCache.bounds.minZ)*.72,routeCache.areaWidth*.82,Math.abs(routeCache.airport.x-c.x)*1.12);
      api.camera.position.set(c.x+Math.cos(previewAngle)*radius,c.y+110,c.z+Math.sin(previewAngle)*radius);
      api.camera.lookAt(c.x,c.y+18,c.z);
      if(api.camera.far<Math.max(7000,(routeCache?.areaWidth||10000)*2.2)){api.camera.far=Math.max(7000,(routeCache?.areaWidth||10000)*2.2);api.camera.updateProjectionMatrix();}
    });
    setStatus('都市3Dプレビュー中です。もう一度「都市を表示」を押すと編集画面に戻ります。');
  }
  function stopCityPreview(){if(previewActive){previewActive=false;if(previewExitUI)previewExitUI.hidden=true;removeTrackFromView();exitExternalView();setStatus('都市プレビューを終了しました。');}}
  async function startFlight(){
    if(flight||flightLoading)return;
    flightLoading=true;const token=++flightLoadToken;
    try{
      stopCityPreview();
      if(!routeCache)makeCity({density:'dense'});
      enterExternalView();addTrackToView();
      flightUI.hidden=false;setFlightStatus('AIRCRAFT MODEL LOADING…');
      const aircraft=await buildAircraft();
      if(token!==flightLoadToken){
        aircraft.root.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material){const ms=Array.isArray(o.material)?o.material:[o.material];ms.forEach(m=>m.dispose&&m.dispose());}});
        return;
      }
      makeFlightState(aircraft);
      api.setFrameHook((dt)=>updateFlight(dt));
      setFlightStatus('RUNWAY READY');
      setStatus(`フライトシム開始：${aircraft.modelStatus}。スロットルを上げ、速度70m/s以上で機首を引いて離陸してください。`);
      updateFlightReadouts();
    }catch(error){
      removeTrackFromView();exitExternalView();flightUI.hidden=true;
      setStatus(`フライトシム開始エラー：${error.message||error}`,true);
    }finally{flightLoading=false;}
  }
  function updateFlight(dt){
    const f=flight;if(!f)return;
    dt=clamp(dt,0,.05);f.time+=dt;updateCity(dt);
    const c=f.control;
    if(!f.paused&&!f.crashed&&!f.landed){
      const pitchInput=c.pitch+(flightKeys.KeyW?1:0)-(flightKeys.KeyS?1:0);
      const rollInput=c.roll+(flightKeys.KeyD?1:0)-(flightKeys.KeyA?1:0);
      const yawInput=c.yaw+(flightKeys.KeyE?1:0)-(flightKeys.KeyQ?1:0);
      const throttleInput=(flightKeys.ShiftLeft||flightKeys.ShiftRight?1:0)-(flightKeys.ControlLeft||flightKeys.ControlRight?1:0);
      if(throttleInput)f.throttle=clamp(f.throttle+throttleInput*.34*dt,0,1);
      f.pitch=clamp(f.pitch+pitchInput*.48*dt-f.pitch*.32*dt,-.42,.58);
      f.roll=clamp(f.roll+rollInput*1.2*dt-f.roll*1.05*dt,-.95,.95);
      f.yaw+=Math.sin(f.roll)*clamp(f.speed/70,.15,1.4)*.78*dt+yawInput*.35*dt;
      f.speed=clamp(f.speed+(f.throttle*7.4-(f.gear?1.25:.8)-f.speed*.014-f.flaps*1.0)*dt,0,225);
      const forward=new T.Vector3(Math.sin(f.yaw)*Math.cos(f.pitch),Math.sin(f.pitch),Math.cos(f.yaw)*Math.cos(f.pitch));
      if(!f.airborne){
        f.pos.x+=forward.x*f.speed*dt;f.pos.z+=forward.z*f.speed*dt;f.pos.y=FLIGHT_GROUND_ALT;
        if(f.speed>70&&f.pitch>.12){f.airborne=true;f.pos.y=FLIGHT_GROUND_ALT+.25;f.vSpeed=6.5;f.gear=true;setFlightStatus('AIRBORNE · CLIMB');}
        const ap=routeCache.airport;
        if(!f.airborne&&(Math.abs(f.pos.x-ap.x)>29||Math.abs(f.pos.z-ap.z)>885)){f.crashed=true;f.speed=0;setFlightStatus('RUNWAY OVERRUN · RESET');}
      }else{
        const liftRatio=clamp((f.speed/68)**2,0,2.1)*(0.78+f.pitch*1.85+f.flaps*.3)*Math.max(.22,Math.cos(f.roll));
        const verticalAccel=(liftRatio-1)*9.81;
        f.vSpeed=clamp(f.vSpeed+verticalAccel*dt,-32,32);
        f.pos.x+=forward.x*f.speed*dt;f.pos.z+=forward.z*f.speed*dt;
        f.pos.y+=f.vSpeed*dt;
      }
      if(f.airborne && f.time-f.lastCollision>.25){
        f.lastCollision=f.time;
        const hit=checkBuildingCollision(f.pos);
        if(hit){f.crashed=true;f.speed=0;setFlightStatus('BUILDING IMPACT · RESET');}
      }
      if(f.pos.y<=FLIGHT_GROUND_ALT&&f.airborne&&f.vSpeed<0){
        const ap=routeCache.airport;
        const onRunway=Math.abs(f.pos.x-ap.x)<25&&Math.abs(f.pos.z-ap.z)<875;
        if(onRunway&&f.gear&&f.vSpeed>-7&&f.speed<105){f.pos.y=FLIGHT_GROUND_ALT;f.vSpeed=0;f.airborne=false;f.landed=true;f.speed=Math.max(0,f.speed*.68);setFlightStatus('LANDING SUCCESS');}
        else {f.pos.y=FLIGHT_GROUND_ALT;f.crashed=true;f.speed=0;setFlightStatus(onRunway?'HARD LANDING · RESET':'OFF-RUNWAY LANDING · RESET');}
      }
      // Keep the aircraft in the playable city airspace.
      if(f.pos.y>1400){f.pos.y=1400;f.vSpeed=Math.min(0,f.vSpeed);}
      f.root.position.copy(f.pos);applyFlightOrientation();
      for(const fan of f.engineFans)fan.rotation.z+=dt*(12+f.throttle*110);
      for(const a of f.ailerons||[])a.group.rotation.x=clamp(f.roll*a.side*.22,-.24,.24);
      for(const flap of f.flapParts||[])flap.rotation.x=-(f.flaps||0)*.55;
      for(const elevator of f.elevators||[])elevator.rotation.x=-f.pitch*.32;
      if(f.rudder)f.rudder.rotation.y=clamp(f.control.yaw*.18,-.18,.18);
      if(f.gear){for(const p of f.gearParts)p.visible=true;}else{for(const p of f.gearParts)p.visible=false;}
      f.beacon.intensity=.8+Math.sin(f.time*6)*.7;
    }
    cameraFlight();updateFlightReadouts();
  }
  function bindFlightUI(){
    flightUI=makeFlightUI();
    flightUI.querySelectorAll('[data-f-control]').forEach(btn=>{
      const key=btn.dataset.fControl;
      const map={pitchUp:['pitch',1],pitchDown:['pitch',-1],rollLeft:['roll',-1],rollRight:['roll',1],yawLeft:['yaw',-1],yawRight:['yaw',1]};
      const [axis,value]=map[key];
      const down=e=>{e.preventDefault();if(flight)flight.control[axis]=value;try{btn.setPointerCapture(e.pointerId);}catch(_){}};
      const up=()=>{if(flight)flight.control[axis]=0;};
      btn.addEventListener('pointerdown',down);for(const t of ['pointerup','pointercancel','lostpointercapture','pointerleave'])btn.addEventListener(t,up);
    });
    flightUI.addEventListener('click',e=>{
      const b=e.target.closest('button');if(!b)return;
      const a=b.dataset.fAction;
      if(a==='exit')closeFlight();
      else if(a==='gear'&&flight){flight.gear=!flight.gear;b.textContent=flight.gear?'脚を格納':'脚を出す';}
      else if(a==='flaps'&&flight){flight.flaps=flight.flaps>.2?0:.25;b.textContent=flight.flaps?'フラップ 20°':'フラップ 0°';}
      else if(a==='throttle'&&flight){flight.throttle=1;flightUI.querySelector('[data-f-throttle]').value='100';}
      else if(a==='chase')setFlightView('chase');
      else if(a==='cockpit')setFlightView('cockpit');
      else if(a==='pause'&&flight){flight.paused=!flight.paused;b.textContent=flight.paused?'再開':'一時停止';setFlightStatus(flight.paused?'PAUSED':'FLIGHT ACTIVE');}
      else if(a==='reset')resetFlight();
    });
    flightUI.querySelector('[data-f-throttle]').addEventListener('input',e=>{if(flight){flight.throttle=Number(e.target.value)/100;flightUI.querySelector('[data-f-throttle-label]').textContent=`${e.target.value}%`;}});
    document.addEventListener('keydown',e=>{if(!flight)return;if(['KeyW','KeyA','KeyS','KeyD','KeyQ','KeyE','ShiftLeft','ShiftRight','ControlLeft','ControlRight'].includes(e.code)){flightKeys[e.code]=true;e.preventDefault();}});
    document.addEventListener('keyup',e=>{flightKeys[e.code]=false;});
    window.addEventListener('blur',()=>{flightKeys=Object.create(null);if(flight)flight.control={pitch:0,roll:0,yaw:0};});
  }
  function makePreviewExitUI(){
    const wrap=document.createElement('div');wrap.id='city-preview-exit';wrap.hidden=true;
    wrap.innerHTML='<button type="button">都市プレビューを終了</button>';
    wrap.style.cssText='position:fixed;z-index:2147483647;top:12px;right:12px;';
    const button=wrap.querySelector('button');
    button.style.cssText='padding:8px 12px;border:1px solid #c4d0d8;border-radius:6px;background:#fbf8ef;color:#2b3a55;font:700 12px system-ui;box-shadow:0 2px 10px #25364b25;';
    button.addEventListener('click',stopCityPreview);
    document.body.appendChild(wrap);return wrap;
  }
  function serialize(){
    if(!cityConfig&&!mountainConfig)return null;
    return {...(cityConfig||{}),mountain:mountainConfig?{...mountainConfig}:null};
  }
  function restore(config){
    if(!config||typeof config!=='object'){clearCity();clearMountains();return;}
    const city=config.city||((config.density||config.airport)?config:null);
    if(city&&city.density)makeCity(city);
    if(config.mountain&&config.mountain.enabled)makeMountainTerrain(config.mountain);
    else if(config.mountain===null)clearMountains();
  }
  function destroy(){closeFlight();stopCityPreview();removeTrackFromView();disposeCity();disposeMountains();if(flightUI)flightUI.remove();if(previewExitUI)previewExitUI.remove();const st=document.getElementById('city-flight-style');if(st)st.remove();unitBox.dispose();unitCylinder.dispose();Object.values(materials).forEach(m=>m.dispose());for(const mat of signMaterials.values())mat.dispose();signMaterials.clear();for(const tex of signTextures.values())tex.dispose();signTextures.clear();}

  panel.innerHTML=`
    <div class="cf-intro"><b>都市街区・フライト</b><span>道路を直交格子に整理し、建物は同じ街区間隔で整然と配置。コースに近い区画は建物を寄せ、レールの通過帯だけを空けます。</span></div>
    <div class="cf-options"><label>街区密度<select data-cf-density><option value="normal">標準</option><option value="dense" selected>高密度</option><option value="ultra">超高密度</option></select></label><label>街区間隔<input type="range" min="100" max="210" step="5" value="145" data-cf-spacing><output data-cf-spacing-label>145m</output></label><label>都市の横幅<input type="range" min="3000" max="16000" step="500" value="10000" data-cf-width><output data-cf-width-label>10,000m</output></label></div>
    <div class="cf-buttons"><button data-cf-action="generate">街区を生成</button><button data-cf-action="refresh">街並みを再生成</button><button data-cf-action="clear">街区を削除</button></div>
    <div class="cf-buttons"><button data-cf-action="flight">フライトシム開始</button><button data-cf-action="focus">都市プレビュー</button></div>
    <div class="cf-stats" data-cf-stats>まだ街区は生成されていません。</div>
    <div class="cf-note">街区は最大16km幅の直交グリッド。道路・交差点・車線・横断歩道を同じ格子で整列し、車は実際の道路レーンを走行します。地面は灰色舗装。建物は規則的な街区配置を保ち、コース側へ可能な範囲で寄せて、線路の通過帯は空けます。フライト機はThree.jsで生成するオリジナル旅客機で、外部通信・CORSは不要です。</div>
  `;
  const panelStyle=document.createElement('style');panelStyle.id='city-flight-panel-style';panelStyle.textContent=`
    .cf-intro{display:grid;gap:4px;padding:9px 10px;border:1px solid #d2dcdf;border-radius:7px;background:#edf3f5;color:#2b3a55;font-size:12px;line-height:1.5}.cf-intro b{font-size:14px}.cf-options{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:9px 0}.cf-options label{display:grid;gap:4px;font-size:12px;color:#40516b}.cf-options select{height:32px;border:1px solid #b9c8d2;border-radius:6px;background:#fff;color:#2b3a55;padding:4px}.cf-options input{width:100%;accent-color:#486d91}.cf-options output{font-weight:700;color:#41566b}.cf-buttons{display:flex;flex-wrap:wrap;gap:6px;margin:7px 0}.cf-buttons button{flex:1 1 135px;min-height:32px;padding:5px 8px;border:1px solid #c4d0d8;border-radius:6px;background:#fff;color:#2b3a55;font:700 12px system-ui}.cf-buttons button[data-cf-action="generate"],.cf-buttons button[data-cf-action="flight"]{background:#e5edf3;border-color:#9eb1c1}.cf-stats{margin-top:8px;padding:8px;border:1px solid #d8e0e4;border-radius:6px;background:#fff;color:#41566b;font-size:12px;white-space:pre-wrap}.cf-note{margin-top:7px;color:#66798a;font-size:11px;line-height:1.5}@media(max-width:520px){.cf-options{grid-template-columns:1fr}.cf-buttons button{flex:1 1 100%;}}
  `;document.head.appendChild(panelStyle);
  panel.querySelector('[data-cf-spacing]').addEventListener('input',e=>panel.querySelector('[data-cf-spacing-label]').textContent=`${e.target.value}m`);
  panel.querySelector('[data-cf-width]').addEventListener('input',e=>panel.querySelector('[data-cf-width-label]').textContent=`${Number(e.target.value).toLocaleString('ja-JP')}m`);
  panel.addEventListener('click',e=>{
    const b=e.target.closest('button[data-cf-action]');if(!b)return;
    const action=b.dataset.cfAction;
    try{
      if(action==='generate'||action==='refresh'){
        const config={density:panel.querySelector('[data-cf-density]').value,spacing:Number(panel.querySelector('[data-cf-spacing]').value),areaWidth:Number(panel.querySelector('[data-cf-width]').value),seed:Math.floor(Math.random()*0x7fffffff)};
        const c=makeCity(config);panel.querySelector('[data-cf-stats]').textContent=`${c.buildings}棟／街区幅${Math.round(c.areaWidth).toLocaleString('ja-JP')}m／道路${c.roads}本／車両${c.vehicles}台／${routeCache.n}区間。`;
      }else if(action==='clear'){clearCity();panel.querySelector('[data-cf-stats]').textContent='街区を削除しました。';}
      else if(action==='flight')startFlight();
      else if(action==='focus'){
        if(previewActive)stopCityPreview();else startCityPreview();
      }
    }catch(err){console.error('[City/Flight]',err);setStatus(`エラー：${err.message||err}`,true);}
  });
  bindFlightUI();
  previewExitUI=makePreviewExitUI();
  const updateTimer=setInterval(()=>{if(!flight)updateCity(.08);},80);
  const oldUpdateDestroy=destroy;
  api.cityFlight={makeCity,clearCity,makeMountainTerrain,clearMountains,serialize,restore,inspectCityClearance,getMeshes:cityMeshes,createAircraft:buildAircraft,startFlight,closeFlight,destroy(){clearInterval(updateTimer);oldUpdateDestroy();panelStyle.remove();delete api.cityFlight;}};
  return api.cityFlight;
}
