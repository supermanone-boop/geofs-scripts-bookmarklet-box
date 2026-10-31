/* Coaster City District + Flight Simulator v1.0
 * Dense route-following city, drivable/ride-through architecture, and an arcade flight sim.
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
    asphalt: new T.MeshStandardMaterial({ color: 0x292f35, roughness: 0.96 }),
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
    asphalt: materials.asphalt, roadMark: materials.roadMark, greenery: materials.greenery,
    leaf: materials.leaf, warm: materials.warm, runway: materials.runway, roof: materials.roof,
  };
  let cityRoot = null;
  let cityConfig = null;
  let routeCache = null;
  let colliders = [];
  let traffic = [];
  let cityClock = 0;
  let flight = null;
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
  const SIGN_WORDS = ['HOTEL','MALL','PLAZA','MARKET','OFFICE','CAFE','BANK','SKY','GALLERY','ARCADE','TOWER','METRO'];
  const signTextures = new Map();

  function makeSignTexture(word, hue) {
    const key = `${word}|${hue}`;
    if (signTextures.has(key)) return signTextures.get(key);
    const c = document.createElement('canvas'); c.width = 512; c.height = 128;
    const ctx = c.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 512, 128);
    grad.addColorStop(0, `hsl(${hue},55%,15%)`); grad.addColorStop(1, `hsl(${hue},55%,30%)`);
    ctx.fillStyle = grad; ctx.fillRect(0, 0, 512, 128);
    ctx.strokeStyle = `hsl(${hue},90%,70%)`; ctx.lineWidth = 8; ctx.strokeRect(5, 5, 502, 118);
    ctx.fillStyle = '#f2fbff'; ctx.font = '900 66px system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = `hsl(${hue},100%,75%)`; ctx.shadowBlur = 14; ctx.fillText(word, 256, 66);
    const tex = new T.CanvasTexture(c); tex.colorSpace = T.SRGBColorSpace; tex.anisotropy = 4;
    signTextures.set(key, tex); return tex;
  }
  function addSign(root, frame, text, y, z, width, hue = 195, side = 1) {
    const tex = makeSignTexture(text, hue);
    const mat = new T.MeshBasicMaterial({ map: tex, side: T.DoubleSide, toneMapped: false });
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
    if (api.co && api.co.tr) return api.co.tr;
    if (typeof api.prepare !== 'function' || typeof api.buildTrack !== 'function') throw new Error('コース解析APIがありません。');
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
    if (r() > 0.16) addSign(root,{...worldFromLocal(frame,opts.cx||0,(opts.cz||0)+front*(d/2+0.22)),yaw:frame.yaw},sign,baseY+5,(0),Math.min(12,w*0.72),Math.floor(r()*360),1);
    // Occasional roof antenna.
    if (r() > 0.55) {
      const p=worldFromLocal(frame,(opts.cx||0)+w*0.28,(opts.cz||0)-d*0.22);
      B.add('trim',p.x,baseY+h+4,p.z,0.28,6,0.28,frame.yaw,0xbec7cc);
      B.add('warm',p.x,baseY+h+7.2,p.z,0.75,0.75,0.75,frame.yaw,0xff6148);
    }
    if (opts.collider !== false) colliders.push({x:frame.x,z:frame.z,yaw:frame.yaw,cx:opts.cx||0,cz:opts.cz||0,halfW:w/2,halfD:d/2,minY:baseY,maxY:baseY+h,kind:'building'});
    return {w,d,h,baseY};
  }
  function makePortal(B, root, frame, seed, trackClearance = 18) {
    const r = rand(seed);
    const W = 76, D = 44;
    const baseY = 0;
    const passageW = 54;
    const wingW = (W-passageW)/2;
    const h = Math.max(32, frame.y + trackClearance + 13);
    for (const side of [-1,1]) {
      const cx = side*(passageW/2+wingW/2);
      B.local(frame,'facade',cx,baseY+h/2,0,wingW,h,D,[0x647884,0x7c7771,0x8b8c87,0x63766f][Math.floor(r()*4)]);
      B.local(frame,'trim',cx,baseY+2,0,wingW+1,1.2,D+1,0x45545d);
      const atriumStep=Math.max(7,Math.ceil((h-14)/22));
      for(let level=7;level<h-4;level+=atriumStep){
        const floorY=baseY+level;
        B.local(frame,'trim',cx,floorY,0,wingW+1,.32,D+1,0xa6b5b9);
        for(let z=-D/2+5;z<D/2-3;z+=8){
          B.local(frame,'glass',cx+side*(wingW/2-.12),floorY+2,z,.18,3.5,4.5,0x86b3c6);
        }
        B.local(frame,'trim',side*(passageW/2+.8), floorY+1.05, 0, 1.8, .13, D-4, 0xb9c6c8);
      }
      B.local(frame,'trim',cx,baseY+h/2,0,.75,h,D+1,0x56636c);
      B.local(frame,'glass',cx,baseY+10,0,.45,8,D-3,0x81b9d0);
      // Interior balcony facing the vehicle corridor.
      const innerX=side*(passageW/2+.8);
      for(const level of [7,14,21]){
        B.local(frame,'roof',innerX,baseY+level,0,2.5,.35,D-4,0x8a9699);
        B.local(frame,'trim',innerX-side*.7,baseY+level+0.55,0,.12,.12,D-4,0xb9c6c8);
      }
      // Passage columns remain outside the 42m clear width.
      for(const z of [-D/2+1.2,D/2-1.2]){
        B.local(frame,'trim',side*(passageW/2+1.2),baseY+h/2,z,1.3,h,1.3,0xc1c7c5);
      }
      colliders.push({x:frame.x,z:frame.z,yaw:frame.yaw,cx,cz:0,halfW:wingW/2,halfD:D/2,minY:baseY,maxY:baseY+h,kind:'portal'});
    }
    // Upper occupied floors bridge across the passage; the lower corridor stays completely open.
    B.local(frame,'roof',0,baseY+h-1.1,0,W,.9,D,0x374955);
    B.local(frame,'glass',0,baseY+h-5,0,passageW-2,7,D-2,0x91c9d7);
    B.local(frame,'trim',0,baseY+h-9,0,W+1,.6,D+1,0x71848b);
    for(const z of [-D/2,D/2]){
      for(const side of [-1,1]) B.local(frame,'glass',side*(passageW/2+wingW/4),baseY+h-5,z,wingW*.85,6,.25,0xa8d3dd);
      B.local(frame,'trim',0,baseY+h-1,z,W,.9,1.2,0x35454c);
    }
    // Roof lettering and interior light strips.
    addSign(root,{...frame},'SKY ARCADE',baseY+h-2,D/2+0.8,26,190,1);
    for(let z=-D/2+4;z<D/2;z+=7){
      B.local(frame,'warm',0,baseY+h-11,z,passageW-3,.18,.5,0xffdd9d);
    }
    // A glass canopy and structural beams above the open passage.
    for(const z of [-D/2+3,D/2-3]) B.local(frame,'trim',0,baseY+trackClearance+3,z,passageW,.45,.7,0x93bdca);
    return {baseY,height:h,width:W,depth:D};
  }
  function addRoads(B, frame, step, groundY = 0) {
    for(const side of [-1,1]){
      const x=side*17.5;
      B.local(frame,'asphalt',x,groundY-.34,0,8.4,.55,step+2,0x30383d);
      B.local(frame,'trim',x+side*4.8,groundY-.12,0,1.2,.35,step+2,0x9b9c91);
      for(let z=-step/2+4;z<step/2;z+=10) B.local(frame,'roadMark',x,groundY-.04,z,.18,.08,4.2,0xe8dfbd);
      B.local(frame,'roadMark',x-side*2.7,groundY-.025,0,.12,.05,step,0xb3b6ad);
    }
  }
  function addSkyBridge(B, frame, height) {
    const y=frame.y+Math.max(33,height);
    B.local(frame,'roof',0,y,0,44,1.2,8,0x43545d);
    B.local(frame,'glass',0,y+2,0,42,3.5,7.4,0x8bc4d6);
    B.local(frame,'trim',0,y+4,0,44,.6,8,0x687d87);
    for(const x of [-21,21]) B.local(frame,'trim',x,y+1.9,0,.55,4.2,8,0x70828a);
  }
  function addAirport(B, root, bounds, center) {
    const x = bounds.maxX + 450;
    const z = center.z + 110;
    // Runway and threshold, long axis is +Z.
    B.add('runway',x,-.72,z,48,.55,1800,0,0x343a3e);
    B.add('trim',x-25,-.25,z,1,.45,1800,0,0x8a969b);
    B.add('trim',x+25,-.25,z,1,.45,1800,0,0x8a969b);
    for(let zz=-870;zz<=870;zz+=15) B.add('roadMark',x,-.35,z+zz,0.65,.12,7,0,0xf5f1df);
    for(const side of [-1,1]){
      for(let j=0;j<10;j++){
        B.add('roadMark',x+side*20,-.32,z-870+j*2.2,1.4,.12,1.3,0,0xffffff);
      }
      for(let j=0;j<30;j++) B.add('warm',x+side*24,-.08,z-840+j*58,.7,.5,.7,0,side<0?0x32d6ff:0xff5544);
    }
    B.add('asphalt',x-52,-.56,z+20,58,.5,110,0,0x333a40);
    // Apron and terminal.
    const terminalFrame={x:x-100,y:0,z:z+40,yaw:Math.PI/2};
    makeBuilding(B,root,terminalFrame,0x713a,{w:62,d:92,h:26,cx:0,cz:0,baseY:0});
    const hangarFrame={x:x+65,y:0,z:z+50,yaw:Math.PI/2};
    makeBuilding(B,root,hangarFrame,0x882d,{w:58,d:70,h:22,cx:0,cz:0,baseY:0});
    // Taxiway centerline.
    B.add('roadMark',x-56,-.2,z+5,1,.12,76,Math.PI/2,0xe9dc91);
    return {x,z,runwayHalfLength:900,spawn:{x,z:z-760,y:2.4,yaw:0}};
  }
  function makeCity(config = {}) {
    if (cityRoot) disposeCity();
    const tr = getTrack();
    const root = new T.Group(); root.name = 'CoasterUrbanDistrict';
    const B = makeBatchBuilder(root);
    colliders = []; traffic = [];
    const total = tr.L;
    const n = clamp(Math.ceil(total / (config.spacing || 42)), 8, 36);
    const step = total / n;
    const frames = [];
    let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;
    for(let i=0;i<n;i++){
      const f=frameAt(tr,(i+.5)*step);frames.push(f);
      minX=Math.min(minX,f.x);maxX=Math.max(maxX,f.x);minZ=Math.min(minZ,f.z);maxZ=Math.max(maxZ,f.z);
    }
    const center={x:(minX+maxX)/2,z:(minZ+maxZ)/2,y:frames.reduce((sum,f)=>sum+f.y,0)/frames.length};
    const density=config.density||'dense';
    const outer = density!=='normal';
    const ultra = density==='ultra';
    // The ride corridor becomes the main boulevard. Streets and blocks are placed on both sides.
    const portalEvery=Math.max(2,Math.floor(n/10));
    for(let i=0;i<frames.length;i++){
      const f=frames[i], seed=(config.seed||20261031)+i*179;
      const r=rand(seed);
      const isPortal=i%portalEvery===Math.floor(portalEvery/2);
      const streetY=0;
      const routeHeight=Math.max(0,f.y);
      addRoads(B,f,step,streetY);
      for(const side of [-1,1]){
        const offset=(isPortal?62:43)+r()*4;
        const bframe={...f,x:f.x+Math.cos(f.yaw)*offset*side,z:f.z-Math.sin(f.yaw)*offset*side};
        const base=streetY;
        makeBuilding(B,root,bframe,seed+side*13,{w:21+r()*13,d:step*.82,h:Math.max(24+r()*62,routeHeight+18+r()*55),baseY:base});
        if(outer && i%2===0){
          const outOffset=84+r()*10;
          const oframe={...f,x:f.x+Math.cos(f.yaw)*outOffset*side,z:f.z-Math.sin(f.yaw)*outOffset*side};
          makeBuilding(B,root,oframe,seed+side*47+9,{w:27+r()*20,d:step*.88,h:Math.max(34+r()*92,routeHeight+25+r()*105),baseY:streetY});
        } else if(i%3===0){
          const outOffset=78+r()*9;
          const oframe={...f,x:f.x+Math.cos(f.yaw)*outOffset*side,z:f.z-Math.sin(f.yaw)*outOffset*side};
          makeBuilding(B,root,oframe,seed+side*71+4,{w:20+r()*11,d:step*.78,h:Math.max(18+r()*37,routeHeight+12+r()*45),baseY:streetY});
        }
        if(ultra && i%2===0){
          const farOffset=132+r()*18;
          const farFrame={...f,x:f.x+Math.cos(f.yaw)*farOffset*side,z:f.z-Math.sin(f.yaw)*farOffset*side};
          makeBuilding(B,root,farFrame,seed+side*113+51,{w:34+r()*22,d:step*.92,h:Math.max(78+r()*150,routeHeight+30+r()*190),baseY:streetY});
        }
        // Sidewalk furniture, street trees and twin-arm streetlights.
        const sidewalk=side*29;
        for(let q=0;q<2;q++){
          const zz=(q-.5)*step*.52;
          if((i+q)%2===0) addStreetTree(B,f,sidewalk,zz,5.5,seed+q*33,streetY);
        }
        const lp=worldFromLocal(f,side*26.5,0);
        B.add('trim',lp.x,streetY+5.2,lp.z,.22,10.4,.22,f.yaw,0x56616a);
        B.add('trim',lp.x+Math.cos(f.yaw)*1.8,streetY+10.25,lp.z-Math.sin(f.yaw)*1.8,3.8,.18,.22,f.yaw,0x65717a);
        B.add('warm',lp.x+Math.cos(f.yaw)*1.8,streetY+10,lp.z-Math.sin(f.yaw)*1.8,1.4,.25,.5,f.yaw,0xffdda3);
      }
      // Through-building atrium every few blocks: an actual open corridor around the rail.
      if(isPortal){
        let nearbyTop=f.y;
        const scan=Math.max(1,Math.floor(22/(tr.L/tr.n)));
        const idx=Math.floor((f.s/tr.L)*tr.n);
        for(let j=-scan;j<=scan;j++) nearbyTop=Math.max(nearbyTop,tr.py[(idx+j+tr.n)%tr.n]);
        makePortal(B,root,f,seed+992,Math.max(18,nearbyTop-f.y+9));
      }
      if(i%4===1){
        let localTop=f.y;const scan=Math.max(1,Math.floor(28/(tr.L/tr.n)));const idx=Math.floor((f.s/tr.L)*tr.n);
        for(let j=-scan;j<=scan;j++)localTop=Math.max(localTop,tr.py[(idx+j+tr.n)%tr.n]);
        addSkyBridge(B,f,Math.max(33,localTop-f.y+12));
      }
    }
    // Plaza pads, trees and distant skyline towers fill the gaps between the route-following blocks.
    const margin=ultra?176:(outer?140:104);
    for(let i=0;i<frames.length;i+=2){
      const f=frames[i];
      for(const side of [-1,1]){
        const p=worldFromLocal(f,side*(margin+10),0);
        const streetY=0;
      const routeHeight=Math.max(0,f.y);
        B.add('greenery',p.x,streetY-.65,p.z,24,.3,step*.9,f.yaw,0x506c4c);
        for(let t=0;t<3;t++) addStreetTree(B,f,side*(margin+2+t*6),(t-1)*7,6.5,2026+i*7+t,streetY);
      }
    }
    // Airport on the edge of the generated district, shared with the flight simulator.
    const bounds={minX,minZ,maxX,maxZ};
    const airport=addAirport(B,root,bounds,center);
    B.finish();
    // Moving street traffic: cars follow the same route at a slight offset from the ride boulevard.
    for(let i=0;i<10;i++){
      const color=[0xb93f3b,0xe3e5e2,0x3f6f9a,0xd5a849,0x2d343a][i%5];
      const car=new T.Group();
      const body=new T.Mesh(new T.BoxGeometry(2.2,.75,4.6),new T.MeshStandardMaterial({color,roughness:.48,metalness:.25}));body.position.y=.8;car.add(body);
      const cabin=new T.Mesh(new T.BoxGeometry(1.7,.7,2.1),new T.MeshStandardMaterial({color:0x70909e,roughness:.16,metalness:.22}));cabin.position.set(0,1.45,-.15);car.add(cabin);
      const wheels=[];
      for(const x of [-1.05,1.05])for(const z of [-1.45,1.45]){const w=new T.Mesh(new T.CylinderGeometry(.42,.42,.24,12),new T.MeshStandardMaterial({color:0x171b1e,roughness:.8}));w.rotation.z=Math.PI/2;w.position.set(x,.42,z);car.add(w);wheels.push(w);}
      root.add(car);traffic.push({group:car,s:(i/10)*total,side:i%2?1:-1,speed:7+i%4});
    }
    scene.add(root);
    cityRoot=root;
    cityConfig={density,spacing:config.spacing||42,seed:config.seed||20261031,buildings:colliders.length,airport};
    routeCache={tr,center,bounds,airport,total,n};
    cityBuildCount++;
    cityClock=0;
    setStatus(`街区を生成しました：建物 ${colliders.length}棟／街区 ${n}ブロック。地上から伸びる高層ビル群の間と吹き抜けアトリウムをコースが通ります。`);
    return cityConfig;
  }
  function disposeCity(){
    if(!cityRoot)return;
    scene.remove(cityRoot);
    cityRoot.traverse(o=>{
      if(o.geometry && o.geometry!==unitBox && o.geometry!==unitCylinder) o.geometry.dispose();
      if(o.material && o.material!==materials.concrete && o.material!==materials.facade && o.material!==materials.glass && o.material!==materials.glassLit && o.material!==materials.trim && o.material!==materials.dark && o.material!==materials.asphalt && o.material!==materials.roadMark && o.material!==materials.greenery && o.material!==materials.leaf && o.material!==materials.warm && o.material!==materials.runway && o.material!==materials.roof){
        const ms=Array.isArray(o.material)?o.material:[o.material];ms.forEach(m=>{if(m.map && ![...signTextures.values()].includes(m.map))m.map.dispose();m.dispose();});
      }
    });
    cityRoot=null;colliders=[];traffic=[];routeCache=null;
  }
  function updateCity(dt){
    if(!cityRoot||!routeCache)return;
    cityClock+=dt;
    const tr=routeCache.tr;
    for(const item of traffic){
      item.s=(item.s+item.speed*dt)%tr.L;
      const f=frameAt(tr,item.s);
      const x=item.side*17.5;
      const p=worldFromLocal(f,x,0);
      item.group.position.set(p.x,.02,p.z);item.group.rotation.y=f.yaw;
    }
  }
  function clearCity(){if(flight)closeFlight();stopCityPreview();disposeCity();cityConfig=null;setStatus('街区を削除しました。コース設計はそのまま残ります。');}
  // GLB exporter currently serializes ordinary meshes, not InstancedMesh batches.
  // Keep the city intact in the editable project ZIP; omit it from the legacy GLB path rather than exporting a misleading partial city.
  function cityMeshes(){return [];}

  function buildAircraft(){
    const root=new T.Group();root.name='CityFlight_Airliner';
    const white=new T.MeshStandardMaterial({color:0xf0f2ed,roughness:.38,metalness:.18});
    const belly=new T.MeshStandardMaterial({color:0x475761,roughness:.5,metalness:.25});
    const wingMat=new T.MeshStandardMaterial({color:0xd7dfe1,roughness:.42,metalness:.2});
    const darkGlass=new T.MeshStandardMaterial({color:0x152b3a,roughness:.15,metalness:.32,emissive:0x081b29,emissiveIntensity:.2});
    const engineMat=new T.MeshStandardMaterial({color:0x8d9aa0,roughness:.32,metalness:.65});
    const rubber=new T.MeshStandardMaterial({color:0x15191c,roughness:.9});
    const hub=new T.MeshStandardMaterial({color:0xb9c3c5,metalness:.8,roughness:.28});
    // Smooth tapered fuselage, with the nose facing local +Z.
    const profile=[new T.Vector2(.05,-18),new T.Vector2(.75,-17),new T.Vector2(1.45,-14),new T.Vector2(1.95,-8),new T.Vector2(2.05,2),new T.Vector2(1.9,10),new T.Vector2(1.45,15),new T.Vector2(.65,18),new T.Vector2(.05,19)];
    const bodyGeo=new T.LatheGeometry(profile,32);bodyGeo.rotateX(Math.PI/2);
    const fuselage=new T.Mesh(bodyGeo,white);fuselage.position.y=1.2;root.add(fuselage);
    const bellyMesh=new T.Mesh(new T.CylinderGeometry(1.78,1.6,23,28,1,true),belly);bellyMesh.rotation.x=Math.PI/2;bellyMesh.position.set(0,.25,-1);root.add(bellyMesh);
    // Swept main wing and horizontal stabilizer.
    const wingShape=new T.Shape();wingShape.moveTo(-21,-2.5);wingShape.lineTo(-6,4.7);wingShape.lineTo(0,5.2);wingShape.lineTo(6,4.7);wingShape.lineTo(21,-2.5);wingShape.lineTo(19.8,-4);wingShape.lineTo(6,-1.1);wingShape.lineTo(-6,-1.1);wingShape.lineTo(-19.8,-4);wingShape.closePath();
    const wingGeo=new T.ExtrudeGeometry(wingShape,{depth:.6,bevelEnabled:true,bevelSegments:2,steps:1,bevelSize:.18,bevelThickness:.14});wingGeo.rotateX(Math.PI/2);wingGeo.translate(0,.2,0);
    root.add(new T.Mesh(wingGeo,wingMat));
    const tailShape=new T.Shape();tailShape.moveTo(-8,-15);tailShape.lineTo(-2.4,-11);tailShape.lineTo(0,-10.5);tailShape.lineTo(2.4,-11);tailShape.lineTo(8,-15);tailShape.lineTo(7.4,-16.4);tailShape.lineTo(2,-14.5);tailShape.lineTo(-2,-14.5);tailShape.lineTo(-7.4,-16.4);tailShape.closePath();
    const tailGeo=new T.ExtrudeGeometry(tailShape,{depth:.42,bevelEnabled:true,bevelSize:.1,bevelThickness:.1,bevelSegments:1});tailGeo.rotateX(Math.PI/2);root.add(new T.Mesh(tailGeo,wingMat));
    const finShape=new T.Shape();finShape.moveTo(0,-16);finShape.lineTo(0,0);finShape.lineTo(5,1.5);finShape.lineTo(3,-9);finShape.lineTo(.6,-16);finShape.closePath();
    const finGeo=new T.ExtrudeGeometry(finShape,{depth:.55,bevelEnabled:true,bevelSize:.12,bevelThickness:.12,bevelSegments:1});finGeo.translate(-.275,2.3,0);root.add(new T.Mesh(finGeo,white));
    // Two turbofan nacelles, pylons and dark exhaust nozzles.
    for(const x of [-7.5,7.5]){
      const engine=new T.Group();engine.position.set(x,-.25,-1);root.add(engine);
      const nacelle=new T.Mesh(new T.LatheGeometry([new T.Vector2(.85,-5),new T.Vector2(1.15,-4),new T.Vector2(1.25,-1),new T.Vector2(1.15,3),new T.Vector2(.8,4)],24),engineMat);nacelle.rotation.x=Math.PI/2;engine.add(nacelle);
      const intake=new T.Mesh(new T.TorusGeometry(.92,.12,10,28),hub);intake.position.z=4;engine.add(intake);
      const fan=new T.Mesh(new T.CircleGeometry(.78,24),darkGlass);fan.position.z=4.02;engine.add(fan);
      const pylon=new T.Mesh(new T.BoxGeometry(.75,1.9,3.3),wingMat);pylon.position.set(-x*.12,1.15,-.8);engine.add(pylon);
    }
    // Passenger windows and cockpit glazing.
    for(const side of [-1,1]){
      for(let z=-11;z<=11;z+=1.65){
        const win=new T.Mesh(new T.SphereGeometry(.17,10,8),darkGlass);win.scale.set(.25,1,1.05);win.position.set(side*1.82,1.6,z);root.add(win);
      }
      for(let k=0;k<3;k++){
        const win=new T.Mesh(new T.BoxGeometry(.54,.14,.75),darkGlass);win.position.set(side*(.55+k*.45),2.8,15.1-k*.3);win.rotation.y=side*.22;root.add(win);
      }
    }
    // Landing gear with twin wheels.
    const gearParts=[];
    for(const x of [-3.1,3.1]){
      const strut=new T.Mesh(new T.CylinderGeometry(.12,.18,2.8,10),hub);strut.position.set(x,-1.7,-2.8);root.add(strut);gearParts.push(strut);
      for(const side of [-1,1]){
        const wheel=new T.Mesh(new T.CylinderGeometry(.48,.48,.34,16),rubber);wheel.rotation.z=Math.PI/2;wheel.position.set(x+side*.35,-3,-2.8);root.add(wheel);gearParts.push(wheel);
        const cap=new T.Mesh(new T.CylinderGeometry(.2,.2,.36,12),hub);cap.rotation.z=Math.PI/2;cap.position.copy(wheel.position);root.add(cap);
      }
    }
    const noseStrut=new T.Mesh(new T.CylinderGeometry(.1,.13,1.9,10),hub);noseStrut.position.set(0,-1.7,11);root.add(noseStrut);gearParts.push(noseStrut);
    const noseWheel=new T.Mesh(new T.CylinderGeometry(.34,.34,.28,14),rubber);noseWheel.rotation.z=Math.PI/2;noseWheel.position.set(0,-2.65,11);root.add(noseWheel);gearParts.push(noseWheel);
    // Keep the landing-gear parts parented to the aircraft; visibility toggles retract them.
    const navRed=new T.PointLight(0xff3333,1.2,12);navRed.position.set(-20,.1,-2);root.add(navRed);
    const navGreen=new T.PointLight(0x33ff88,1.2,12);navGreen.position.set(20,.1,-2);root.add(navGreen);
    const beacon=new T.PointLight(0xff3322,1.5,18);beacon.position.set(0,3,-2);root.add(beacon);
    return {root,gearParts,beacon,navRed,navGreen};
  }
  function makeFlightUI(){
    const ui=document.createElement('section');ui.id='city-flight-ui';ui.hidden=true;
    ui.innerHTML=`
      <div class="cf-head"><b>URBAN FLIGHT SIM</b><span data-f-status>RUNWAY READY</span><button type="button" data-f-action="exit">終了</button></div>
      <div class="cf-readouts"><span>速度<strong data-f-speed>0 km/h</strong></span><span>高度<strong data-f-alt>0 m</strong></span><span>方位<strong data-f-heading>000°</strong></span><span>昇降<strong data-f-vs>0 m/s</strong></span></div>
      <div class="cf-main"><div class="cf-controls">
        <div class="cf-controlrow"><button data-f-control="pitchUp">機首 ↑</button><button data-f-control="rollLeft">左傾斜</button><button data-f-control="rollRight">右傾斜</button><button data-f-control="pitchDown">機首 ↓</button></div>
        <div class="cf-controlrow"><button data-f-control="yawLeft">左ラダー</button><button data-f-control="yawRight">右ラダー</button><button data-f-action="gear" data-f-gear>脚を格納</button><button data-f-action="flaps" data-f-flaps>フラップ 20°</button></div>
      </div><div class="cf-throttle"><label>スロットル <output data-f-throttle-label>32%</output></label><input type="range" min="0" max="100" value="32" data-f-throttle><button data-f-action="throttle">最大出力</button></div></div>
      <div class="cf-foot"><button data-f-action="chase" aria-pressed="true">追従カメラ</button><button data-f-action="cockpit" aria-pressed="false">コックピット</button><button data-f-action="pause">一時停止</button><button data-f-action="reset">滑走路から再開</button><span class="cf-hint">PC：W/S 機首・A/D ロール・Q/E ラダー・Shift/Ctrl 出力｜スマホ：画面ボタン長押し</span></div>`;
    const style=document.createElement('style');style.id='city-flight-style';style.textContent=`
      #city-flight-ui{position:fixed;z-index:2147483646;left:10px;right:10px;bottom:10px;max-width:900px;margin:auto;padding:10px;border:1px solid #607b8b;border-radius:14px;background:rgba(9,20,31,.94);color:#eaf6ff;box-shadow:0 8px 30px #0008;font:12px/1.35 system-ui,sans-serif;backdrop-filter:blur(8px);touch-action:pan-y}
      #city-flight-ui[hidden]{display:none!important}.cf-head{display:flex;align-items:center;gap:10px}.cf-head b{font-size:14px;letter-spacing:.12em}.cf-head span{flex:1;color:#8ee1f4;font-weight:800}.cf-head button,.cf-foot button,.cf-controls button,.cf-throttle button{min-height:36px;padding:7px 11px;border:1px solid #718798;border-radius:8px;background:#263b4c;color:#f5fbff;font:700 12px system-ui}.cf-readouts{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin:9px 0}.cf-readouts span{padding:7px;border-radius:8px;background:#172b3a;color:#a9c3d3}.cf-readouts strong{display:block;color:white;font-size:18px;font-variant-numeric:tabular-nums}.cf-main{display:grid;grid-template-columns:1fr minmax(130px,190px);gap:9px}.cf-controls{display:grid;gap:6px}.cf-controlrow{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:5px}.cf-controls button{min-height:43px;touch-action:none;user-select:none;background:#344f63}.cf-throttle{display:grid;gap:7px;align-content:center;padding:8px;border-radius:9px;background:#172b3a}.cf-throttle label{display:flex;justify-content:space-between;font-weight:700}.cf-throttle input{width:100%;accent-color:#39c5e7}.cf-foot{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:8px}.cf-foot button[aria-pressed=true]{background:#126b88;border-color:#4dd9f3}.cf-hint{flex:1 1 100%;color:#a6bac8;font-size:10px}.cf-head button{background:#8b3434;border-color:#d46a6a}
      @media(max-width:560px){#city-flight-ui{left:5px;right:5px;bottom:5px;padding:8px;max-height:52vh;overflow:auto}.cf-readouts strong{font-size:16px}.cf-main{grid-template-columns:1fr}.cf-controlrow button{padding:6px 3px;font-size:11px;min-height:40px}.cf-throttle{grid-template-columns:1fr;}.cf-foot button{flex:1 1 30%;}}
    `;
    document.head.appendChild(style);document.body.appendChild(ui);return ui;
  }
  function setStatus(text,bad=false){const el=panel.querySelector('[data-cf-status]');if(el){el.textContent=text;el.classList.toggle('bad',bad);}}
  function setFlightStatus(text){if(flightUI){const el=flightUI.querySelector('[data-f-status]');if(el)el.textContent=text;}}
  function updateFlightReadouts(){
    if(!flightUI||!flight)return;
    const s=flight.speed*3.6, h=Math.max(0,flight.pos.y-2.4), hd=((flight.yaw*180/Math.PI)%360+360)%360;
    flightUI.querySelector('[data-f-speed]').textContent=`${Math.round(s)} km/h`;
    flightUI.querySelector('[data-f-alt]').textContent=`${Math.round(h)} m`;
    flightUI.querySelector('[data-f-heading]').textContent=`${String(Math.round(hd)).padStart(3,'0')}°`;
    flightUI.querySelector('[data-f-vs]').textContent=`${flight.vSpeed>=0?'+':''}${flight.vSpeed.toFixed(1)} m/s`;
    flightUI.querySelector('[data-f-throttle-label]').textContent=`${Math.round(flight.throttle*100)}%`;
  }
  function makeFlightState(){
    if(!routeCache) makeCity({density:'dense'});
    const a=routeCache.airport.spawn;
    const aircraft=buildAircraft();scene.add(aircraft.root);
    const f={...aircraft,pos:new T.Vector3(a.x,a.y,a.z),speed:0,yaw:a.yaw,pitch:0,roll:0,vSpeed:0,throttle:0.32,gear:true,flaps:0.25,airborne:false,paused:false,view:'chase',crashed:false,landed:false,time:0,control:{pitch:0,roll:0,yaw:0},lastCollision:0};
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
      const eye=f.root.localToWorld(new T.Vector3(0,2.65,8.3));
      api.camera.position.copy(eye);api.camera.up.set(0,1,0);api.camera.lookAt(eye.clone().add(forward.clone().multiplyScalar(120)));
    }else{
      const eye=f.pos.clone().addScaledVector(forward,-38).add(new T.Vector3(0,12,0));
      api.camera.position.lerp(eye,0.13);api.camera.up.set(0,1,0);api.camera.lookAt(f.pos.clone().addScaledVector(forward,22).add(new T.Vector3(0,3,0)));
    }
    if(api.camera.far<7000){api.camera.far=7000;api.camera.updateProjectionMatrix();}
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
    if(scene.fog){scene.fog.near=650;scene.fog.far=5200;}
    if(api.camera.far<7000){api.camera.far=7000;api.camera.updateProjectionMatrix();}
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
      const radius=Math.max(190,Math.max(routeCache.bounds.maxX-routeCache.bounds.minX,routeCache.bounds.maxZ-routeCache.bounds.minZ)*.72,Math.abs(routeCache.airport.x-c.x)*1.12);
      api.camera.position.set(c.x+Math.cos(previewAngle)*radius,c.y+110,c.z+Math.sin(previewAngle)*radius);
      api.camera.lookAt(c.x,c.y+18,c.z);
      if(api.camera.far<7000){api.camera.far=7000;api.camera.updateProjectionMatrix();}
    });
    setStatus('都市3Dプレビュー中です。もう一度「都市を表示」を押すと編集画面に戻ります。');
  }
  function stopCityPreview(){if(previewActive){previewActive=false;if(previewExitUI)previewExitUI.hidden=true;removeTrackFromView();exitExternalView();setStatus('都市プレビューを終了しました。');}}
  function startFlight(){
    if(flight)return;
    stopCityPreview();
    if(!routeCache)makeCity({density:'dense'});
    enterExternalView();addTrackToView();
    flightUI.hidden=false;makeFlightState();
    api.setFrameHook((dt)=>updateFlight(dt));
    setFlightStatus('RUNWAY READY');
    setStatus('フライトシムを開始しました。スロットルを上げ、速度70m/s以上で機首を引いて離陸してください。');
    updateFlightReadouts();
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
        f.pos.x+=forward.x*f.speed*dt;f.pos.z+=forward.z*f.speed*dt;f.pos.y=2.4;
        if(f.speed>70&&f.pitch>.12){f.airborne=true;f.pos.y=2.65;f.vSpeed=6.5;f.gear=true;setFlightStatus('AIRBORNE · CLIMB');}
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
      if(f.pos.y<=2.4&&f.airborne&&f.vSpeed<0){
        const ap=routeCache.airport;
        const onRunway=Math.abs(f.pos.x-ap.x)<25&&Math.abs(f.pos.z-ap.z)<875;
        if(onRunway&&f.gear&&f.vSpeed>-7&&f.speed<105){f.pos.y=2.4;f.vSpeed=0;f.airborne=false;f.landed=true;f.speed=Math.max(0,f.speed*.68);setFlightStatus('LANDING SUCCESS');}
        else {f.pos.y=2.4;f.crashed=true;f.speed=0;setFlightStatus(onRunway?'HARD LANDING · RESET':'OFF-RUNWAY LANDING · RESET');}
      }
      // Keep the aircraft in the playable city airspace.
      if(f.pos.y>1400){f.pos.y=1400;f.vSpeed=Math.min(0,f.vSpeed);}
      f.root.position.copy(f.pos);applyFlightOrientation();
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
    button.style.cssText='padding:11px 14px;border:1px solid #7bb9cc;border-radius:9px;background:#102c3b;color:#fff;font:700 13px system-ui;box-shadow:0 3px 18px #0006;';
    button.addEventListener('click',stopCityPreview);
    document.body.appendChild(wrap);return wrap;
  }
  function serialize(){return cityConfig?{...cityConfig}:null;}
  function restore(config){if(config&&typeof config==='object')makeCity(config);else clearCity();}
  function destroy(){closeFlight();stopCityPreview();removeTrackFromView();disposeCity();if(flightUI)flightUI.remove();if(previewExitUI)previewExitUI.remove();const st=document.getElementById('city-flight-style');if(st)st.remove();unitBox.dispose();unitCylinder.dispose();Object.values(materials).forEach(m=>m.dispose());for(const tex of signTextures.values())tex.dispose();signTextures.clear();}

  panel.innerHTML=`
    <div class="cf-intro"><b>都市街区＋フライトシミュレーター</b><span>コースの両側に街区を連続生成。高層ビルの谷間、商業ビルの吹き抜け、ガラス屋根の空中通路の下を縫うように走ります。密度を上げると遠景まで街が広がります。</span></div>
    <div class="cf-options"><label>街区密度<select data-cf-density><option value="normal">標準密度</option><option value="dense" selected>高密度（推奨）</option><option value="ultra">超高密度</option></select></label><label>ブロック間隔<input type="range" min="30" max="58" value="42" data-cf-spacing><output data-cf-spacing-label>42m</output></label></div>
    <div class="cf-buttons"><button data-cf-action="generate">都市街区を生成</button><button data-cf-action="refresh">別の街並みに再生成</button><button data-cf-action="clear">街区を削除</button></div>
    <div class="cf-buttons"><button data-cf-action="flight">フライトシム開始</button><button data-cf-action="focus">都市3Dプレビュー</button></div>
    <div class="cf-stats" data-cf-stats>まだ街区は生成されていません。</div>
    <div class="cf-note">建物の棟数はコース長とブロック間隔で変わります。コースが600m級でも建物は地上から立ち上がり、走行高度に届く超高層ビルや貫通アトリウムを生成します。フライトシムは1,800m滑走路から離陸し、帰還・着陸できます。</div>
  `;
  const panelStyle=document.createElement('style');panelStyle.id='city-flight-panel-style';panelStyle.textContent=`
    .cf-intro{display:grid;gap:5px;padding:11px;border:1px solid #8da5b3;border-radius:10px;background:linear-gradient(135deg,#eaf4f7,#d9e6eb);color:#203744;font-size:12px;line-height:1.55}.cf-intro b{font-size:15px}.cf-options{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:10px 0}.cf-options label{display:grid;gap:5px;font-size:12px;color:#435c69}.cf-options select{height:35px;border:1px solid #a9bdc6;border-radius:7px;background:#fff;color:#273e49;padding:4px}.cf-options input{width:100%;accent-color:#1888a8}.cf-options output{font-weight:800;color:#17617d}.cf-buttons{display:flex;flex-wrap:wrap;gap:7px;margin:8px 0}.cf-buttons button{flex:1 1 145px;min-height:39px;border:1px solid #9db4c0;border-radius:8px;background:#edf6f8;color:#244250;font:800 12px system-ui}.cf-buttons button[data-cf-action="generate"],.cf-buttons button[data-cf-action="flight"]{background:#1c6884;color:white;border-color:#16536c}.cf-stats{margin-top:9px;padding:9px;border-radius:8px;background:#eaf0f2;color:#344d59;font-size:12px;white-space:pre-wrap}.cf-note{margin-top:7px;color:#607784;font-size:11px;line-height:1.55}@media(max-width:520px){.cf-options{grid-template-columns:1fr}.cf-buttons button{flex:1 1 100%;}}
  `;document.head.appendChild(panelStyle);
  panel.querySelector('[data-cf-spacing]').addEventListener('input',e=>panel.querySelector('[data-cf-spacing-label]').textContent=`${e.target.value}m`);
  panel.addEventListener('click',e=>{
    const b=e.target.closest('button[data-cf-action]');if(!b)return;
    const action=b.dataset.cfAction;
    try{
      if(action==='generate'||action==='refresh'){
        const config={density:panel.querySelector('[data-cf-density]').value,spacing:Number(panel.querySelector('[data-cf-spacing]').value),seed:Math.floor(Math.random()*0x7fffffff)};
        const c=makeCity(config);panel.querySelector('[data-cf-stats]').textContent=`${c.buildings}棟の建築ブロックを生成／${routeCache.n}街区／空港滑走路あり。コース沿いの建物群と貫通アトリウムが配置されました。`;
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
  api.cityFlight={makeCity,clearCity,serialize,restore,getMeshes:cityMeshes,startFlight,closeFlight,destroy(){clearInterval(updateTimer);oldUpdateDestroy();panelStyle.remove();delete api.cityFlight;}};
  return api.cityFlight;
}
