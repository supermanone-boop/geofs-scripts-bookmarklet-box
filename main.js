// main.js — ジェットコースターを作ろう！ 本体
// 手で描いた道と高さから線路を組み、物理シミュレーションで走らせる。失敗すると人が飛び、線路が崩れる。
// 設計は URL（?c=...）に載せてシェアでき、開いた人の画面で同じ結果が再生される。
// 3D は Three.js（満員電車ラッシュ3D に同梱のものを読む）、HUD は 2D の Canvas、設計の画面は DOM。
import * as THREE from '../../crowded-train-3d/js/vendor/three.module.min.js';
import { sound } from './audio.js';
import { track as trackRaw } from '../../common/analytics.js';
import { buildTrack, STATION, FIELD, DS, F, MATS, BARS, STARTS, BUDGET, H_SAMPLES, MAX_LEN, polyLen, defaultHeights, autoHeights, costOf, MAPS, mapOf } from './track.js';
import { Sim, DT, prepare, frameQuat, riderSeat } from './sim.js';
import { buildPark, buildStation, buildStationLights, buildTrackMeshes, makeCar, makeRider, Crowd, Particles, makeStarSprite, syncChunks, SCENES, Snowfall, buildTheme } from './world.js';
import { RAIL_LOOKS, CAR_LOOKS, RIDER_LOOKS, SCENE_LOOKS, defaultLook, cleanLook, isDefaultLook } from './looks.js';
import { Editor, randomStroke, yen } from './editor.js';
import { encode, decode, normalize, cleanMap } from './codec.js';
import { curveRadius } from './fix.js';
import { installCoasterExpansion } from './coaster_expansion.js';
import { loadFavs, saveFavs, newFavId, nextFavName, cleanName, MAX_FAVS } from './favs.js';

const QS = new URLSearchParams(location.search);
const HOST = location.hostname;
const DEBUG_OK = /^(localhost|127\.0\.0\.1)$/.test(HOST) || HOST.endsWith('.itm-games.pages.dev');
const track = (name, params = {}) => trackRaw(name, { game: 'coaster', ...params });
const GAME_URL = location.origin + location.pathname.replace(/index\.html$/, '');
const HASHTAG = 'ジェットコースターを作ろう';
const SAVE_KEY = 'rc_design';
// ゲームのバージョン（タイトル画面の右下に出す）。public/coaster/ のソースを変えるコミットごとに末尾（パッチ）を 1 つ上げる
const VERSION = '1.2.0 + 拡張4.1';
const verEl = document.getElementById('ver');
if (verEl) verEl.textContent = `ver ${VERSION}`;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt));

// ---------------- 描画の土台（3D + HUD） ----------------
let HW = 640;
let HH = 480;
let hudK = 1;
const cvs = document.getElementById('screen');
const hud = document.getElementById('hud');
const hx = hud.getContext('2d');
const renderer = new THREE.WebGLRenderer({ canvas: cvs, antialias: true });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
const camera = new THREE.PerspectiveCamera(55, 1, 0.3, 2400);
const scene3d = new THREE.Scene();
scene3d.background = new THREE.Color('#9fd0f5');
scene3d.fog = new THREE.Fog('#cfe6f7', 140, 330);
const hemi = new THREE.HemisphereLight('#ffffff', '#6a8a50', 1.6);
scene3d.add(hemi);
const sun = new THREE.DirectionalLight('#fff4e0', 2.0);
sun.position.set(60, 120, 80);
scene3d.add(sun);
const COARSE = matchMedia('(pointer: coarse)').matches;
let dprCap = 2;
function resize() {
  const r = cvs.parentElement.getBoundingClientRect();
  const w = Math.max(1, Math.round(r.width));
  const h = Math.max(1, Math.round(r.height));
  const dpr = Math.min(window.devicePixelRatio || 1, COARSE ? 1.75 : 2);
  renderer.setPixelRatio(Math.min(dpr, dprCap));
  renderer.setSize(w, h, false);
  hud.width = Math.round(w * dpr);
  hud.height = Math.round(h * dpr);
  hudK = Math.min(w, h) / 420;
  HW = w / hudK;
  HH = h / hudK;
  camera.aspect = w / h;
  camera.fov = clamp((2 * Math.atan(Math.tan((70 * Math.PI) / 360) / Math.min(1.2, camera.aspect)) * 180) / Math.PI, 50, 80);
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(cvs.parentElement);
resize();

// 敷地（ずっと置いておく。景色を変えたときだけ作り直す）
let park = buildPark('day');
scene3d.add(park);
let sceneId = 'day';
let mapId = 0;
let theme = null; // テーマの飾り（線路ごとに作り直す。{ group, update, avoid }）
let snowfall = null;
let stationLights = null;
const station = buildStation();
scene3d.add(station);
// 景色（装飾）・マップ：地面・空・水・木を作り直し、光・霧・背景の色を差しかえる
function applyScene(id, map = 0) {
  if (id === sceneId && map === mapId) return;
  sceneId = id;
  mapId = map;
  const S = SCENES[id];
  scene3d.remove(park);
  park.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material && !o.material.userData.shared) {
      if (o.material.map) o.material.map.dispose();
      o.material.dispose();
    }
  });
  park = buildPark(id, map);
  scene3d.add(park);
  scene3d.background.set(S.bg);
  scene3d.fog.color.set(S.fog[0]);
  scene3d.fog.near = S.fog[1];
  scene3d.fog.far = Math.max(S.fog[2], 1800);
  hemi.color.set(S.hemi[0]);
  hemi.groundColor.set(S.hemi[1]);
  hemi.intensity = S.hemi[2];
  sun.color.set(S.sun[0]);
  sun.intensity = S.sun[1];
  sun.position.set(...S.sun[2]);
  renderer.toneMappingExposure = S.exposure;
  // 雪・花びら（景色が変わるたびに作り直す）
  if (snowfall) {
    scene3d.remove(snowfall.points);
    snowfall.geo.dispose();
    snowfall.points.material.map.dispose();
    snowfall.points.material.dispose();
    snowfall = null;
  }
  if (S.snowfall) {
    snowfall = new Snowfall(S.snowfall === true ? {} : S.snowfall);
    scene3d.add(snowfall.points);
  }
  if (stationLights && !S.lights) {
    scene3d.remove(stationLights);
    stationLights.geometry.dispose();
    stationLights = null;
  } else if (!stationLights && S.lights) {
    stationLights = buildStationLights();
    scene3d.add(stationLights);
  }
}
const crowd = new Crowd(130);
scene3d.add(crowd.group);
const fx = new Particles(500);
scene3d.add(fx.points);
const starMat = makeStarSprite();
const stars = [];

// ---------------- コースター（線路・車両・お客さん） ----------------
let co = null; // { design, tr, meshes, group, cars: [Group], riders: [Group], sim }
function disposeCoaster() {
  if (!co) return;
  scene3d.remove(co.group);
  co.group.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
  });
  for (const r of co.riders) scene3d.remove(r);
  for (const s of stars) scene3d.remove(s.sp);
  stars.length = 0;
  co = null;
}
function setupCoaster(design, tr = null) {
  disposeCoaster();
  tr = tr || prepare(design, buildTrack);
  const look = cleanLook(design.look);
  // テーマに景色が決まっていれば、それを使う（④ の見た目の景色は、いつもの遊園地のときだけ）
  const M = mapOf(cleanMap(design.map));
  applyScene(M.scene || SCENE_LOOKS[look.scene].id, cleanMap(design.map));
  if (theme) {
    scene3d.remove(theme.group);
    theme.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
    });
  }
  theme = buildTheme(sceneId, mapId, tr);
  if (theme) scene3d.add(theme.group);
  const { group, meshes, bulbs } = buildTrackMeshes(tr, look.rail, !!SCENES[sceneId].lights);
  const cars = [];
  const riders = [];
  const kind = RIDER_LOOKS[look.rider].id;
  for (let c = 0; c < design.cars; c++) {
    const car = makeCar(c, design.bar, look.car);
    group.add(car);
    cars.push(car);
    for (let k = 0; k < 2; k++) {
      const r = makeRider(c * 2 + k + design.cars * 7, kind);
      r.position.set(0.25, 0.89, k ? 0.38 : -0.38);
      car.add(r);
      riders.push(r);
    }
  }
  scene3d.add(group);
  co = { design, tr, meshes, bulbs, group, cars, riders, sim: new Sim(tr, design) };
  crowd.place(tr, 3, mapId, theme ? theme.avoid : []);
  syncCoaster(0);
  return co;
}

const tq = new THREE.Quaternion();
// 物理の状態を見た目に写す
function syncCoaster(build = 1, t = 0) {
  if (!co) return;
  const sim = co.sim;
  syncChunks(co.meshes, sim, build, co.bulbs);
  for (let c = 0; c < co.cars.length; c++) {
    const g = co.cars[c];
    const car = sim.cars[c];
    g.visible = build >= 1;
    if (car.body) {
      g.position.set(car.body.p[0], car.body.p[1] - 0.5, car.body.p[2]);
      g.quaternion.set(...car.body.q);
    } else {
      g.position.set(car.f.x, car.f.y, car.f.z);
      g.quaternion.set(...frameQuat(car.f));
    }
  }
  for (let i = 0; i < co.riders.length; i++) {
    const g = co.riders[i];
    const r = sim.riders[i];
    const arms = g.userData.arms;
    if (r.body) {
      if (g.parent !== scene3d) {
        scene3d.attach(g);
      }
      // 目線に使っているお客さんは描かない（体がカメラをふさぐ）
      g.visible = !r.body.gone && !(cam.mode === 'pov' && cam.povBody === r.body && mode === 'ride');
      g.position.set(r.body.p[0], r.body.p[1] - 0.4, r.body.p[2]);
      if (r.body.rest) {
        // 地面に座りこんで、目を回す
        g.quaternion.setFromEuler(new THREE.Euler(0, (i * 1.7) % 6.28, 0));
        g.position.y = r.body.water ? -0.6 : 0.05;
        arms.rotation.z = Math.sin(t * 6 + i) * 0.6 - 0.4;
      } else {
        g.quaternion.set(...r.body.q);
        arms.rotation.z = Math.sin(t * 22 + i) * 1.2;
      }
    } else if (r.state === 'faint') {
      g.rotation.set(0, 0, 0.55);
      arms.rotation.z = -2.7;
    } else {
      g.rotation.set(0, 0, 0);
      arms.rotation.z = lerp(-2.0, 0.15, r.hands);
    }
  }
  // 駅の出口のゲート
  const gate = station.userData.gate;
  gate.rotation.x = -(1 - (sim ? sim.gate : 1)) * 1.5;
}

// ---------------- HUD の道具 ----------------
const F_UI = '"M PLUS 1p", "Hiragino Kaku Gothic ProN", sans-serif';
const F_BIG = '"Dela Gothic One", "M PLUS 1p", "Hiragino Kaku Gothic ProN", sans-serif';
function hudBegin() {
  const k = hud.width / HW;
  hx.setTransform(k, 0, 0, k, 0, 0);
  hx.clearRect(0, 0, HW, HH);
}
function txt(str, x, y, { size = 16, color = '#fff', align = 'left', base = 'top', outline = '#1a1a2a', ow = null, font = F_UI, weight = 800, alpha = 1 } = {}) {
  hx.globalAlpha = alpha;
  hx.font = `${weight} ${size}px ${font}`;
  hx.textAlign = align;
  hx.textBaseline = base;
  if (outline) {
    hx.lineJoin = 'round';
    hx.lineWidth = ow ?? Math.max(2, size * 0.22);
    hx.strokeStyle = outline;
    hx.strokeText(str, x, y);
  }
  hx.fillStyle = color;
  hx.fillText(str, x, y);
  hx.globalAlpha = 1;
}
// 幅 maxW（縁取りを含む）に収まる字の大きさ。実際の字の幅を測る（字数からの見積もりでは、
// 全角の多い長い文が縦長の画面で両端から切れていた。例：「お客さんが飛んでいった！（2人目）」）
function fitSize(str, size, maxW, { font = F_UI, weight = 800, ow = 0 } = {}) {
  hx.font = `${weight} ${size}px ${font}`;
  const w = hx.measureText(str).width + ow;
  return w > maxW ? (size * maxW) / w : size;
}
function rbox(x, y, w, h, r, color) {
  hx.fillStyle = color;
  hx.beginPath();
  hx.roundRect(x, y, w, h, r);
  hx.fill();
}

// ---------------- カメラ ----------------
const cam = {
  pos: new THREE.Vector3(0, 40, 90), look: new THREE.Vector3(0, 5, 0), up: new THREE.Vector3(0, 1, 0),
  mode: 'auto', shot: 'chase', shotT: 0, follow: null, followT: 0, orbit: 0, fixed: null,
  povBody: null, povDir: new THREE.Vector3(1, 0, 0), // 先頭車の視点：最初に飛んでいったお客さんの目線に切り替える
};
const CAM_MODES = ['auto', 'chase', 'pov', 'free'];
const CAM_NAMES = { auto: '中継', chase: '追いかけ', pov: '先頭車', free: '自由' };
const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
function trackCenter() {
  if (co.center) return co.center;
  const tr = co.tr;
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (let i = 0; i < tr.n; i += 8) {
    x0 = Math.min(x0, tr.px[i]);
    x1 = Math.max(x1, tr.px[i]);
    z0 = Math.min(z0, tr.pz[i]);
    z1 = Math.max(z1, tr.pz[i]);
  }
  co.center = { x: (x0 + x1) / 2, z: (z0 + z1) / 2, r: Math.max(x1 - x0, z1 - z0) / 2 + 10 };
  return co.center;
}
function setCam(px, py, pz, lx, ly, lz, k, dt, ux = 0, uy = 1, uz = 0) {
  if (k >= 999) {
    cam.pos.set(px, py, pz);
    cam.look.set(lx, ly, lz);
    cam.up.set(ux, uy, uz);
  } else {
    cam.pos.x = damp(cam.pos.x, px, k, dt);
    cam.pos.y = damp(cam.pos.y, py, k, dt);
    cam.pos.z = damp(cam.pos.z, pz, k, dt);
    cam.look.x = damp(cam.look.x, lx, k * 1.5, dt);
    cam.look.y = damp(cam.look.y, ly, k * 1.5, dt);
    cam.look.z = damp(cam.look.z, lz, k * 1.5, dt);
    cam.up.x = damp(cam.up.x, ux, 6, dt);
    cam.up.y = damp(cam.up.y, uy, 6, dt);
    cam.up.z = damp(cam.up.z, uz, 6, dt);
  }
  if (cam.pos.y < 1.2) cam.pos.y = 1.2;
  const wantedFar = Math.max(2400, Math.abs(cam.pos.y) * 3 + 2400, co ? co.tr.maxH * 4 + 2400 : 2400);
  if (wantedFar > camera.far) {
    camera.far = wantedFar;
    camera.updateProjectionMatrix();
    if (scene3d.fog) scene3d.fog.far = Math.max(scene3d.fog.far, wantedFar * 0.75);
  }
  camera.position.copy(cam.pos);
  camera.up.copy(cam.up).normalize();
  camera.lookAt(cam.look);
}
// 線路の横に置くカメラの場所（ほかの線路や支柱の中に入らない所）
function fixedCamAt(i) {
  const tr = co.tr;
  let hx3 = tr.rx[i];
  let hz3 = tr.rz[i];
  const l = Math.hypot(hx3, hz3) || 1;
  hx3 /= l;
  hz3 /= l;
  for (const d of [9, -9, 13, -13, 6, -6]) {
    const x = tr.px[i] + hx3 * d;
    const z = tr.pz[i] + hz3 * d;
    const y = Math.max(2, tr.py[i] - 2);
    let ok = true;
    for (let j = 0; j < tr.n; j += 2) {
      if (Math.abs(tr.px[j] - x) < 4 && Math.abs(tr.pz[j] - z) < 4 && Math.abs(tr.py[j] - y) < 5) {
        ok = false;
        break;
      }
    }
    if (ok) return [x, y, z];
  }
  return null;
}
// 先頭車の視点で、お客さんが飛んだ・車両が線路から外れたとき：飛んでいくお客さん（いなければ先頭車）の目線
const vq = new THREE.Quaternion();
const vf = new THREE.Vector3();
const vu = new THREE.Vector3();
function povCamera(dt, lead) {
  const b = cam.povBody;
  if (b) {
    const want = vf.set(0, 0, 0);
    if (b.gone) want.set(0.2, -1, 0.3); // 遠くまで飛んでいった（キラーン）：空の高い所から見下ろす
    else if (!b.rest && Math.hypot(...b.v) > 1.5) want.set(b.v[0], b.v[1], b.v[2]); // 飛んでいく向き
    else {
      // 地面に落ちた：座りこんで、コースターのほうを見る
      const t = lead.body ? lead.body.p : lead.p;
      want.set(t[0] - b.p[0], (t[1] - b.p[1]) * 0.3, t[2] - b.p[2]);
    }
    want.normalize();
    cam.povDir.lerp(want, 1 - Math.exp(-6 * dt)).normalize();
    const y = b.rest ? Math.max(b.p[1], 0) + (b.water ? 0.4 : 0.9) : b.p[1] + 0.35;
    setCam(b.p[0], y, b.p[2], b.p[0] + cam.povDir.x * 10, y + cam.povDir.y * 10, b.p[2] + cam.povDir.z * 10, 999, dt);
    return;
  }
  // 車両ごと飛んだ：先頭車にしがみついた目線（車両の前は +X、上は +Y）
  const B = lead.body;
  vq.set(B.q[0], B.q[1], B.q[2], B.q[3]);
  vf.set(1, 0, 0).applyQuaternion(vq);
  vu.set(0, 1, 0).applyQuaternion(vq);
  const px = B.p[0] + vu.x * 1.2;
  const py = B.p[1] + vu.y * 1.2;
  const pz = B.p[2] + vu.z * 1.2;
  setCam(px, py, pz, px + vf.x * 10, py + vf.y * 10, pz + vf.z * 10, 999, dt, vu.x, vu.y, vu.z);
}
// 走っている間のカメラ
function rideCamera(dt) {
  const sim = co.sim;
  const lead = sim.cars[0];
  if (cam.mode === 'free') { updateFreeCamera(dt); return; }
  const f = lead.f;
  const p = lead.body ? lead.body.p : lead.p;
  let mode = cam.mode;
  // 飛んでいった人を追う（中継のときだけ）
  if (mode === 'auto' && cam.follow && cam.followT > 0) {
    cam.followT -= dt;
    const b = cam.follow;
    if (!b.gone) {
      setCam(b.p[0] + 14, Math.max(b.p[1] - 4, 3), b.p[2] + 14, b.p[0], b.p[1], b.p[2], 3, dt);
      return;
    }
  }
  if (mode === 'pov' && (cam.povBody || lead.body)) {
    povCamera(dt, lead);
    return;
  }
  if (sim.mode === 'crash' || sim.mode === 'done') {
    // 事故：少し離れて見回す
    const c = cam.crashAt || p;
    cam.orbit += dt * 0.15;
    const R = sim.st.collapse ? 75 : 32;
    setCam(c[0] + Math.cos(cam.orbit) * R, (sim.st.collapse ? 45 : 16), c[2] + Math.sin(cam.orbit) * R, c[0], Math.max(2, c[1] * 0.4), c[2], 1.5, dt);
    return;
  }
  if (mode === 'pov' && !lead.body) {
    const px = f.x + f.ux * 1.75 + f.tx * 0.3;
    const py = f.y + f.uy * 1.75 + f.ty * 0.3;
    const pz = f.z + f.uz * 1.75 + f.tz * 0.3;
    setCam(px, py, pz, px + f.tx * 10 + f.ux * -0.6, py + f.ty * 10 + f.uy * -0.6, pz + f.tz * 10 + f.uz * -0.6, 999, dt, f.ux, f.uy, f.uz);
    return;
  }
  if (mode === 'auto') {
    // 中継：数秒ごとにカットを切り替える
    cam.shotT -= dt;
    if (cam.shotT <= 0) {
      const sp = Math.abs(sim.v);
      const opts = sim.liftOn ? ['side', 'low'] : sp > 12 ? ['chase', 'pov', 'fixed', 'chase', 'wide'] : ['chase', 'side', 'wide'];
      let s = opts[Math.floor(Math.random() * opts.length)];
      if (s === cam.shot) s = opts[(opts.indexOf(s) + 1) % opts.length];
      cam.shot = s;
      cam.shotT = s === 'pov' ? 3.5 : 4.5 + Math.random() * 2;
      if (s === 'fixed') {
        // 少し先の線路の横に置いたカメラ（通り過ぎるのを見る）
        const ahead = co.tr.wrap(Math.round((sim.s + Math.max(12, sp * 2.2)) / DS));
        cam.fixed = fixedCamAt(ahead);
        if (!cam.fixed) cam.shot = 'chase';
      }
    }
    mode = cam.shot;
  }
  const hx2 = Math.hypot(f.tx, f.tz) || 1;
  const fx2 = f.tx / hx2;
  const fz2 = f.tz / hx2;
  if (mode === 'chase') setCam(p[0] - fx2 * 11, p[1] + 5.5, p[2] - fz2 * 11, p[0] + fx2 * 3, p[1] + 1, p[2] + fz2 * 3, 4, dt);
  else if (mode === 'pov') {
    const px = f.x + f.ux * 1.75 + f.tx * 0.3;
    const py = f.y + f.uy * 1.75 + f.ty * 0.3;
    const pz = f.z + f.uz * 1.75 + f.tz * 0.3;
    setCam(px, py, pz, px + f.tx * 10 - f.ux * 0.6, py + f.ty * 10 - f.uy * 0.6, pz + f.tz * 10 - f.uz * 0.6, 999, dt, f.ux, f.uy, f.uz);
  } else if (mode === 'side' || mode === 'low') {
    const rx = -fz2;
    const rz = fx2;
    const d = mode === 'low' ? 10 : 16;
    // 低い位置のカメラは、観客の頭より上（3.5 m）に置く
    setCam(p[0] + rx * d - fx2 * 4, mode === 'low' ? 3.5 : p[1] + 3, p[2] + rz * d - fz2 * 4, p[0], p[1] + 1, p[2], 2.5, dt);
  } else if (mode === 'fixed' && cam.fixed) {
    setCam(cam.fixed[0], cam.fixed[1], cam.fixed[2], p[0], p[1] + 1, p[2], 999, dt);
  } else {
    const c = trackCenter();
    setCam(c.x + c.r * 0.9, Math.max(35, co.tr.maxH + 18), c.z + c.r * 1.1, p[0], p[1], p[2], 2, dt);
  }
}

// ---------------- 演出（ポップアップ・音・粒） ----------------
const popups = [];
function popup(text, color = '#ffffff', size = 30) {
  if (popups.length && popups[popups.length - 1].text === text) {
    popups[popups.length - 1].t = 0;
    return;
  }
  popups.push({ text, color, size, t: 0 });
  if (popups.length > 3) popups.shift();
}
let hype = 0;
let lastScream = -10;
let lastCreak = -10;
let ejectCount = 0;
let ejectShownT = -10;
function handleEvents(sim, now) {
  const evs = sim.events;
  while (sim.evI < evs.length) {
    const e = evs[sim.evI++];
    switch (e.type) {
      case 'lift':
        break;
      case 'airtime':
        popup('ふわっ！ エアタイム', '#7fd8ff');
        sound.sfx('airtime');
        hype += 0.3;
        break;
      case 'invert':
        popup('宙返り！', '#ffd84a', 34);
        sound.sfx('yahoo');
        sound.sfx('cheer', 0.7);
        hype += 0.5;
        break;
      case 'jump':
        popup('ジャンプ！', '#c08aff', 34);
        sound.sfx('scream', 3);
        break;
      case 'land':
        popup('着地成功！', '#7fff9a', 34);
        sound.sfx('land');
        sound.sfx('cheer', 1);
        fx.burst(e.x, e.y, e.z, 20, '#ffe080', 5, 3, 0.6);
        hype += 0.8;
        break;
      case 'miss':
        popup('着地失敗！！', '#ff6a6a', 36);
        break;
      case 'eject': {
        ejectCount++;
        if (now - ejectShownT > 1.5) {
          popup(ejectCount > 1 ? `お客さんが飛んでいった！（${ejectCount}人目）` : 'お客さんが飛んでいった！', '#ff9a4a', 28);
          ejectShownT = now;
          sound.sfx('eject');
          sound.sfx('gasp');
        }
        const b = sim.riders[e.data.id].body;
        if (b && !cam.povBody) {
          cam.povBody = b;
          cam.povDir.set(b.v[0], b.v[1], b.v[2]).normalize();
        }
        if (b && (!cam.follow || cam.followT <= 0) && sim.mode !== 'crash') {
          cam.follow = b;
          cam.followT = 2.6;
        }
        hype += 0.4;
        break;
      }
      case 'faint':
        popup('お客さんが気絶…', '#c8c8ff', 24);
        break;
      case 'break':
        popup('線路が折れた！', '#ff5050', 38);
        sound.sfx('crack');
        fx.burst(e.x, e.y, e.z, 40, '#ffd060', 8, 6, 0.8, 4);
        break;
      case 'collapse':
        popup('大崩壊！！', '#ff3030', 44);
        sound.sfx('gasp');
        break;
      case 'clash':
        popup('線路どうしがぶつかってる！', '#ff5050', 28);
        sound.sfx('crack');
        break;
      case 'overrun':
        popup('止まれない！！', '#ff5050', 38);
        sound.sfx('brake');
        break;
      case 'crash':
        sound.sfx('crash');
        sound.sfx('scream', 4);
        fx.burst(e.x, e.y, e.z, 60, '#ffb040', 10, 7, 1.0, 6);
        cam.crashAt = [e.x, e.y, e.z];
        cam.orbit = Math.atan2(cam.pos.z - e.z, cam.pos.x - e.x);
        panicAt = [e.x, 0, e.z];
        break;
      case 'crumble':
        if (now - lastCreak > 0.5) {
          sound.sfx('creak');
          lastCreak = now;
        }
        fx.burst(e.x, e.y, e.z, 6, '#b8a080', 3, 2, 0.8, 3);
        if (!panicAt) panicAt = [e.x, 0, e.z];
        break;
      case 'thud':
        sound.sfx('thud', Math.min(1, e.data.h / 15));
        fx.burst(e.x, 0.5, e.z, 26, '#c8b090', 7, 3, 1.4, 2);
        break;
      case 'bump':
        if (e.data.kind === 'car') {
          sound.sfx('thud', 0.6);
          fx.burst(e.x, 0.5, e.z, 14, '#c8b090', 5, 2, 1.0, 2);
        } else {
          sound.sfx('bump');
          fx.burst(e.x, 0.3, e.z, 5, '#c8b090', 2, 1, 0.6, 2);
        }
        break;
      case 'splash': {
        const sp = mapOf(mapId).splash;
        popup(sp.word, sp.color, 30);
        sound.sfx('splash');
        fx.burst(e.x, 0.3, e.z, 40, sp.fx, 5, 9, 1.3, 9.8);
        break;
      }
      case 'star': {
        popup('キラーン☆ 遠くまで飛んだ！', '#fff08a', 28);
        sound.sfx('star');
        const sp = new THREE.Sprite(starMat);
        sp.position.set(e.x, e.y, e.z);
        scene3d.add(sp);
        stars.push({ sp, t: 0 });
        break;
      }
      case 'stop':
        sound.sfx('cheer', 1.2);
        hype += 1;
        break;
      case 'home':
        sound.sfx('brake');
        break;
      case 'stuck':
        popup('止まっちゃった…', '#c8c8c8', 30);
        sound.sfx('gasp');
        break;
      case 'rollbackStop':
        popup('坂を登れずに戻ってきた…', '#c8c8c8', 26);
        sound.sfx('gasp');
        break;
      default:
    }
  }
}
let panicAt = null;

// ---------------- 場面 ----------------
let mode = 'title';
let modeT = 0;
let buildT = 0;
let buildDur = 3.2;
let endT = 0;
let result = null;
let chainT = 0;
let replay = false; // シェアされたコースを見ている
let lastRideCode = '';
const ui = {
  menu: document.getElementById('menu'),
  ride: document.getElementById('ride-ui'),
  result: document.getElementById('result'),
  intro: document.getElementById('intro'),
  favs: document.getElementById('favs'),
  camBtn: document.getElementById('btn-cam'),
  skipBtn: document.getElementById('btn-skip'),
  fixBtn: document.getElementById('btn-fix'),
  speedBtn: document.getElementById('btn-speed'),
  playBtn: document.getElementById('btn-play'),
  barBtn: document.getElementById('btn-bar'),
  plTrack: document.getElementById('pl-track'),
  plNow: document.getElementById('pl-now'),
  plDur: document.getElementById('pl-dur'),
  mute: document.getElementById('btn-mute'),
  editor: document.getElementById('editor'),
};

// 走行画面専用の自由カメラ。ドラッグで見回し、ボタンを押している間カメラを移動する。
const freeCamState = {
  pos: new THREE.Vector3(), yaw: 0, pitch: 0, speed: 40,
  move: { forward: false, back: false, left: false, right: false, up: false, down: false },
  drag: null,
};
const freeCamStyle = document.createElement('style');
freeCamStyle.textContent = `
#rc-free-camera{position:fixed;right:10px;bottom:max(84px,env(safe-area-inset-bottom));z-index:2147483645;width:min(264px,calc(100vw - 20px));box-sizing:border-box;padding:10px;border:1px solid #64748b;border-radius:12px;background:rgba(15,23,42,.94);color:#fff;box-shadow:0 5px 24px #0007;font:12px/1.35 system-ui,sans-serif;touch-action:manipulation}
#rc-free-camera[hidden]{display:none!important}
#rc-free-camera button{min-height:34px;border:1px solid #94a3b8;border-radius:7px;background:#f8fafc;color:#172033;font:700 12px system-ui,sans-serif;padding:5px 8px;touch-action:none}
#rc-free-camera .rc-fc-top{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:7px}
#rc-free-camera .rc-fc-look{height:52px;display:grid;place-items:center;margin-bottom:7px;border:1px dashed #94a3b8;border-radius:8px;background:rgba(148,163,184,.18);color:#fff;text-align:center;user-select:none;-webkit-user-select:none;touch-action:none}
#rc-free-camera .rc-fc-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px}
#rc-free-camera .rc-fc-grid button{width:100%}
#rc-free-camera .rc-fc-speed{display:flex;align-items:center;gap:8px;margin-top:8px}
#rc-free-camera input{width:100%;min-width:0}
#rc-free-camera .rc-fc-speed output{min-width:54px;text-align:right;font-variant-numeric:tabular-nums}
#rc-free-camera .rc-fc-help{margin:7px 0 0;color:#cbd5e1;font-size:11px}
`;
document.head.appendChild(freeCamStyle);
const freeCamPanel = document.createElement('section');
freeCamPanel.id = 'rc-free-camera';
freeCamPanel.hidden = true;
freeCamPanel.innerHTML = `
<div class="rc-fc-top"><b>自由カメラ</b><button type="button" data-fc-action="auto">自動カメラへ戻る</button></div>
<div class="rc-fc-look" data-fc-look>ここをドラッグして見回す</div>
<div class="rc-fc-grid">
  <button type="button" data-fc-move="forward">前進 ↑</button>
  <button type="button" data-fc-move="up">上昇 +</button>
  <button type="button" data-fc-move="back">後退 ↓</button>
  <button type="button" data-fc-move="left">左 ←</button>
  <button type="button" data-fc-action="reset">車両付近へ</button>
  <button type="button" data-fc-move="right">右 →</button>
  <button type="button" data-fc-move="down">下降 −</button>
</div>
<label class="rc-fc-speed">移動速度 <input type="range" min="1" max="250" value="40" data-fc-speed><output data-fc-speed-label>40 m/s</output></label>
<p class="rc-fc-help">3D画面をドラッグして見回し、ボタンを押している間移動します。</p>`;
document.body.appendChild(freeCamPanel);

function clearFreeCamMoves() {
  for (const key of Object.keys(freeCamState.move)) freeCamState.move[key] = false;
}
function activateFreeCamera() {
  const dir = cam.look.clone().sub(cam.pos).normalize();
  if (dir.lengthSq() < 0.0001) dir.set(1, 0, 0);
  freeCamState.pos.copy(cam.pos);
  freeCamState.yaw = Math.atan2(dir.z, dir.x);
  freeCamState.pitch = Math.asin(clamp(dir.y, -0.98, 0.98));
  freeCamState.drag = null;
  clearFreeCamMoves();
  freeCamPanel.hidden = mode !== 'ride';
}
function updateFreeCamera(dt) {
  const step = Math.min(0.1, Math.max(0, dt)) * freeCamState.speed;
  const yaw = freeCamState.yaw;
  const forwardX = Math.cos(yaw), forwardZ = Math.sin(yaw);
  const rightX = -Math.sin(yaw), rightZ = Math.cos(yaw);
  const m = freeCamState.move;
  const forward = Number(m.forward) - Number(m.back);
  const sideways = Number(m.right) - Number(m.left);
  const vertical = Number(m.up) - Number(m.down);
  freeCamState.pos.x += (forwardX * forward + rightX * sideways) * step;
  freeCamState.pos.z += (forwardZ * forward + rightZ * sideways) * step;
  freeCamState.pos.y += vertical * step;
  const cp = Math.cos(freeCamState.pitch);
  const dir = new THREE.Vector3(cp * Math.cos(yaw), Math.sin(freeCamState.pitch), cp * Math.sin(yaw));
  cam.pos.copy(freeCamState.pos);
  cam.look.copy(freeCamState.pos).addScaledVector(dir, 100);
  camera.position.copy(cam.pos);
  camera.up.set(0, 1, 0);
  camera.lookAt(cam.look);
  const wantedFar = Math.max(2400, Math.abs(cam.pos.y) * 3 + 2400, co ? co.tr.maxH * 4 + 2400 : 2400);
  if (wantedFar > camera.far) {
    camera.far = wantedFar;
    camera.updateProjectionMatrix();
    if (scene3d.fog) scene3d.fog.far = Math.max(scene3d.fog.far, wantedFar * 0.75);
  }
}
freeCamPanel.querySelectorAll('[data-fc-move]').forEach((button) => {
  const key = button.dataset.fcMove;
  button.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    event.stopPropagation();
    freeCamState.move[key] = true;
    try { button.setPointerCapture(event.pointerId); } catch (_) {}
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    button.addEventListener(type, (event) => {
      event.stopPropagation();
      freeCamState.move[key] = false;
    });
  }
});
document.addEventListener('pointerup', clearFreeCamMoves);
document.addEventListener('pointercancel', clearFreeCamMoves);
const freeCamLook = freeCamPanel.querySelector('[data-fc-look]');
freeCamLook.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  freeCamState.drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
  try { freeCamLook.setPointerCapture(event.pointerId); } catch (_) {}
});
freeCamLook.addEventListener('pointermove', (event) => {
  const drag = freeCamState.drag;
  if (!drag || drag.id !== event.pointerId) return;
  const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
  drag.x = event.clientX;
  drag.y = event.clientY;
  freeCamState.yaw -= dx * 0.006;
  freeCamState.pitch = clamp(freeCamState.pitch - dy * 0.006, -1.48, 1.48);
});
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  freeCamLook.addEventListener(type, () => { freeCamState.drag = null; });
}
// 自由カメラ中は3D画面そのものをドラッグして見回せる。
cvs.addEventListener('pointerdown', (event) => {
  if (mode !== 'ride' || cam.mode !== 'free') return;
  event.preventDefault();
  freeCamState.drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
  try { cvs.setPointerCapture(event.pointerId); } catch (_) {}
});
cvs.addEventListener('pointermove', (event) => {
  const drag = freeCamState.drag;
  if (mode !== 'ride' || cam.mode !== 'free' || !drag || drag.id !== event.pointerId) return;
  const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
  drag.x = event.clientX;
  drag.y = event.clientY;
  freeCamState.yaw -= dx * 0.006;
  freeCamState.pitch = clamp(freeCamState.pitch - dy * 0.006, -1.48, 1.48);
});
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  cvs.addEventListener(type, () => { freeCamState.drag = null; });
}
const freeCamSpeed = freeCamPanel.querySelector('[data-fc-speed]');
const freeCamSpeedLabel = freeCamPanel.querySelector('[data-fc-speed-label]');
freeCamSpeed.addEventListener('input', () => {
  freeCamState.speed = Number(freeCamSpeed.value);
  freeCamSpeedLabel.textContent = `${freeCamState.speed} m/s`;
});
freeCamPanel.querySelector('[data-fc-action="auto"]').addEventListener('click', () => {
  cam.mode = 'auto';
  cam.shotT = 0;
  freeCamPanel.hidden = true;
  ui.camBtn.textContent = `🎥 ${CAM_NAMES[cam.mode]}`;
  clearFreeCamMoves();
  sound.sfx('tap');
});
freeCamPanel.querySelector('[data-fc-action="reset"]').addEventListener('click', () => {
  const f = co && co.sim && co.sim.cars[0] && co.sim.cars[0].f;
  if (!f) return;
  freeCamState.pos.set(f.x - f.tx * 24 + f.rx * 10, f.y + 12, f.z - f.tz * 24 + f.rz * 10);
  const dir = new THREE.Vector3(
    f.x - freeCamState.pos.x,
    f.y + 2 - freeCamState.pos.y,
    f.z - freeCamState.pos.z
  ).normalize();
  freeCamState.yaw = Math.atan2(dir.z, dir.x);
  freeCamState.pitch = Math.asin(clamp(dir.y, -0.98, 0.98));
  sound.sfx('tap');
});

function setMode(m) {
  mode = m;
  modeT = 0;
  ui.menu.hidden = m !== 'title';
  ui.ride.hidden = !(m === 'build' || m === 'ride');
  ui.result.hidden = m !== 'result';
  ui.intro.hidden = m !== 'intro';
  ui.favs.hidden = m !== 'favs';
  freeCamPanel.hidden = !(m === 'ride' && cam.mode === 'free');
  if (m !== 'ride') clearFreeCamMoves();
  if (m !== 'edit') editor.close();
  document.body.dataset.mode = m;
  // HUD を使わない場面では隠し、切り替えのたびに描き直す（全体を消しただけだと、前の絵が画面に残ることがあった）
  hud.width = hud.width;
  hud.style.visibility = m === 'title' || m === 'build' || m === 'ride' ? 'visible' : 'hidden';
}

// 設計（保存・読み込み）
// map：結果の画面の「新しく作る」では、今のマップのまま始める
function newDesign(map = 0) {
  return { pts: [], hs: null, gm: [], mat: 1, bar: 1, cars: 4, start: 0, look: defaultLook(), map };
}
function loadSaved() {
  try {
    const s = localStorage.getItem(SAVE_KEY);
    return s ? decode(s) : null;
  } catch (e) {
    return null;
  }
}
function saveDesign(d) {
  try {
    localStorage.setItem(SAVE_KEY, encode(d));
  } catch (e) { /* 保存できなくても遊べる */ }
}
// 装飾の分析用の短い名前（例：red-mix-cat-night）
function lookId(l) {
  const k = cleanLook(l);
  return `${RAIL_LOOKS[k.rail].id}-${CAR_LOOKS[k.car].id}-${RIDER_LOOKS[k.rider].id}-${SCENE_LOOKS[k.scene].id}`;
}
// タイトルの後ろで走るお手本
function demoDesign() {
  const pts = randomStroke(15);
  return normalize({ pts, hs: autoHeights({ pts }, 15, 32), gm: [{ t: 'loop', u: 0.45 }], mat: 1, bar: 1, cars: 4, start: 0 });
}

// 「なおす」で戻る段階（設計の画面から走らせたときは、最後に直した段階か、走らせた段階）
let backStep = 3;
// 設計の画面から走らせた回数（2 回目からは組み立てを短くする）
let editRuns = 0;
const editor = new Editor(ui.editor, {
  onDone: (d) => {
    backStep = editor.editStep || editor.step;
    startRide(d, false, true);
  },
  onBack: () => toTitle(),
});
editor.onChange = () => saveDesign(editor.design);

function toTitle() {
  sound.roll(0);
  setMode('title');
  replay = false;
  history.replaceState(null, '', location.pathname);
  const saved = loadSaved();
  document.getElementById('btn-continue').hidden = !saved || saved.pts.length < 2;
  const nf = loadFavs().length;
  const fb = document.getElementById('btn-favs');
  fb.hidden = !nf;
  fb.textContent = `★ お気に入り（${nf}）`;
  if (!co || !co.demo) {
    setupCoaster(demoDesign());
    co.demo = true;
  }
  resetRide();
}
function resetRide() {
  co.sim = new Sim(co.tr, co.design);
  co.sim.evI = 0;
  for (const r of co.riders) {
    const i = co.riders.indexOf(r);
    const car = co.cars[Math.floor(i / 2)];
    if (r.parent !== car) car.add(r);
    r.position.set(0.25, 0.89, i % 2 ? 0.38 : -0.38);
    r.quaternion.identity();
    r.visible = true;
  }
  for (const s of stars) scene3d.remove(s.sp);
  stars.length = 0;
  popups.length = 0;
  panicAt = null;
  hype = 0;
  ejectCount = 0;
  cam.follow = null;
  cam.povBody = null;
  cam.crashAt = null;
  cam.shotT = 0;
  crowd.place(co.tr, 3, mapId, theme ? theme.avoid : []);
}
function openEditor(design, step = 1) {
  setMode('edit');
  sound.roll(0);
  editor.open(design, step);
}
function startRide(d, fromShare = false, fromEditor = false) {
  const nd = normalize(d);
  if (!nd) return;
  if (!fromEditor) backStep = 3;
  else editRuns++;
  // 直して走らせ直すときは、組み立ての演出を短くして、すぐ走り出す
  buildDur = fromEditor && editRuns > 1 ? 1.2 : 3.2;
  if (!fromShare) {
    saveDesign(nd);
    editor.design = nd;
  }
  setupCoaster(nd);
  resetRide();
  lastRideCode = encode(nd);
  replay = fromShare;
  buildT = 0;
  endT = 0;
  result = null;
  prepPlayer();
  ui.ride.dataset.build = '1';
  ui.skipBtn.innerHTML = 'スキップ<i> ⏭</i>';
  ui.fixBtn.innerHTML = fromShare ? '<i>✏ </i>改造' : '<i>✏ </i>なおす';
  setMode('build');
  const c = trackCenter();
  cam.orbit = 0.6;
  setCam(c.x + c.r * 1.4, 60, c.z + c.r * 1.4, c.x, 5, c.z, 999, 0);
  track('level_start', { mode: fromShare ? 'shared' : 'own', cost: co.tr.cost, mat: MATS[nd.mat].id, bar: BARS[nd.bar].id, cars: nd.cars, start: STARTS[nd.start].id, gimmicks: nd.gm.length, look: lookId(nd.look), map: MAPS[cleanMap(nd.map)].id });
}

// 組み立て（線路が地面から順に伸びる）
function updateBuild(dt) {
  dt *= curSpeed();
  buildT += dt;
  const dur = buildDur;
  const k = clamp(buildT / dur, 0, 1);
  const before = Math.floor(co.meshes.length * clamp((buildT - dt) / dur, 0, 1) * 1.15);
  const after = Math.floor(co.meshes.length * k * 1.15);
  if (after > before && after % 2 === 0) sound.sfx('build');
  syncCoaster(k);
  const c = trackCenter();
  cam.orbit += dt * 0.25;
  setCam(c.x + Math.cos(cam.orbit) * c.r * 1.3, 30 + co.tr.maxH * 0.6, c.z + Math.sin(cam.orbit) * c.r * 1.3, c.x, co.tr.maxH * 0.3, c.z, 1.5, dt);
  crowd.update(dt, null, 0.2, [c.x, 0, c.z]);
  if (buildT > dur + (dur < 3 ? 0.3 : 0.6)) {
    setMode('ride');
    delete ui.ride.dataset.build;
    ui.skipBtn.innerHTML = '結果へ<i> ⏭</i>';
    sound.sfx('bell');
    if (co.design.start > 0) setTimeout(() => sound.sfx('launch'), 900);
    cam.shot = 'side';
    cam.shotT = 3;
    const f = co.sim.cars[0].f;
    setCam(f.x + 12, f.y + 4, f.z + 10, f.x, f.y + 1, f.z, 999, 0);
  }
}

let simAcc = 0;
// 再生の速さ。ボタンで 1 → 2 → 4 → 0.5 倍の設定（0.5 倍はゆっくり見る用。0.1.17）、画面を長押ししている間はさらに早送り（設定の 4 倍、最大 8 倍）。
// 物理の刻みはそのままで、1 フレームに進める回数を増やすので、結果は変わらない
const SPEEDS = [1, 2, 4, 0.5];
let speed = 1;
let holdFF = false; // 長押しの早送り中
const curSpeed = () => (holdFF ? Math.min(8, speed * 4) : speed);
function updateRide(dt) {
  // 再生バーをつまんで動かした：その時刻へ飛ぶ（1 フレームに 1 回だけ）
  if (player.pending !== null) {
    seekTo(player.pending);
    player.pending = null;
  }
  const sim = co.sim;
  // 一時停止中・バーをつまんでいる間は、物理を進めない（カメラ・観客は動く）
  const stopped = player.paused || player.scrub;
  const sp0 = curSpeed();
  simAcc += stopped ? 0 : dt * sp0;
  let n = 0;
  const maxN = 30 * sp0;
  while (simAcc >= DT && n < maxN) {
    sim.step();
    simAcc -= DT;
    n++;
  }
  if (n >= maxN) simAcc = 0;
  player.seen = Math.max(player.seen, sim.t);
  // 長いコースでは再生時間を実走に合わせて延長。180秒などの固定上限は設けない。
  if (sim.mode === 'done') player.dur = Math.max(0.1, sim.t);
  else if (sim.t >= player.dur - 25) player.dur = sim.t + Math.max(25, player.dur * 0.08);
  addPlayerMarks(sim.events);
  handleEvents(sim, sim.t);
  // チェーンの音・走る音・悲鳴
  const sp = Math.abs(sim.v);
  if (sim.liftOn && sim.mode === 'track') {
    chainT -= dt;
    if (chainT <= 0) {
      sound.sfx('chain');
      chainT = 0.12;
    }
  }
  const moving = !stopped && (sim.mode === 'track' || sim.mode === 'air');
  sound.roll(moving && sim.mode === 'track' ? sp : moving ? sp * 0.3 : 0, MATS[co.design.mat].id === 'wood' ? 1 : 0);
  if (sim.mode === 'track' && sp > 17 && sim.cars[0].f.ty < -0.3 && sim.t - lastScream > 7) {
    sound.sfx('scream', co.design.cars);
    lastScream = sim.t;
  }
  hype = clamp(damp(hype, sp / 40, 0.5, dt), 0, 1.5);
  syncCoaster(1, sim.t);
  if (mode === 'ride') rideCamera(dt);
  const lead = sim.cars[0];
  crowd.update(dt, panicAt, Math.min(1, hype), lead.p);
  for (const s of stars) {
    s.t += dt;
    const k = 1 + Math.sin(s.t * 12) * 0.3;
    s.sp.scale.set(6 * k, 6 * k, 1);
    s.sp.material.opacity = 1;
    if (s.t > 2.5) s.sp.visible = false;
  }
  if (sim.mode === 'done') {
    endT += dt;
    if (!result) {
      result = sim.summary();
      onResult(result);
    }
    // 結果の画面は、はじめて最後まで見たときだけ自動で出す（見直しているときは「結果へ」で戻る）
    if (mode === 'ride' && endT > 2.6 && !player.reviewed) showResult();
  }
}

// ---------------- 再生バー ----------------
// 物理は同じ設計なら毎回同じに動くので、好きな時刻へは「最初からその時刻まで一気に計算し直す」で飛ぶ（1 走で 0.1 秒ほど）。
// 飛んだときは音・ポップアップは出さず、場面だけを写す
const player = { dur: 0, marks: [], seen: 0, paused: false, scrub: false, pending: null, reviewed: false };
const MARK_ICON = { invert: '🌀', jump: '🦘', eject: '🚀', break: '💥', crash: '💥', miss: '💥', clash: '💥', overrun: '🛑', stuck: '🛑', rollbackStop: '🛑', splash: '💦', star: '⭐' };
const MARK_NAME = { invert: '宙返り', jump: 'ジャンプ', eject: 'お客さんが飛んだ', break: '線路が折れた', crash: '事故', miss: '着地失敗', clash: '線路がぶつかった', overrun: '止まれない', stuck: '止まった', rollbackStop: '戻ってきた', splash: 'ザブーン', star: '遠くまで飛んだ' };
let barPref = 'on';
try {
  barPref = localStorage.getItem('rc_bar') || 'on';
} catch (e) { /* 保存できなくても使える */ }
ui.ride.dataset.bar = barPref;
// 走行時間は概算から開始し、実走行に合わせて延長する。イベント印も実走中に追加する。
function prepPlayer() {
  // 走行開始前に最後まで同期試走すると、高高度コースで画面が固まる。
  // 初期値は概算にし、実走行中に必要なら延長、完走時に正確な時間へ確定する。
  const liftEstimate = co.design.start === 0 ? Math.max(0, co.tr.maxH - 2) / 4.2 : 0;
  player.dur = Math.max(30, co.tr.L / 18 + liftEstimate + 20);
  player.seen = 0;
  player.paused = false;
  player.scrub = false;
  player.pending = null;
  player.reviewed = false;
  player.marks = [];
  const box = ui.plTrack.querySelector('.pl-marks');
  box.innerHTML = '';
  ui.plDur.textContent = player.dur.toFixed(1);
  refreshPlay();
}
function addPlayerMarks(events) {
  const box = ui.plTrack.querySelector('.pl-marks');
  for (const e of events) {
    const icon = MARK_ICON[e.type];
    if (!icon || player.marks.length >= 14) continue;
    if (player.marks.some((m) => m.icon === icon && Math.abs(m.t - e.t) < 2.5)) continue;
    if (player.marks.some((m) => Math.abs(m.t - e.t) < 0.4)) continue;
    const m = { t: e.t, icon, name: MARK_NAME[e.type] };
    const el = document.createElement('span');
    el.textContent = m.icon;
    el.title = m.name;
    el.hidden = true;
    el.addEventListener('pointerdown', (ev) => {
      ev.stopPropagation();
      sound.sfx('tap');
      player.pending = Math.max(0, m.t - 1.5);
      player.paused = false;
    });
    m.el = el;
    player.marks.push(m);
    box.appendChild(el);
  }
}

function seekTo(t) {
  t = clamp(t, 0, player.dur);
  resetRide();
  const sim = co.sim;
  while (sim.mode !== 'done' && sim.t < t) sim.step();
  if (sim.mode === 'done') player.dur = Math.max(0.1, sim.t);
  addPlayerMarks(sim.events);
  sim.evI = sim.events.length;
  // 飛ぶ前に起きたことのうち、場面に残るもの（事故の場所・逃げる観客・飛んだ人の目線）だけを写す
  for (const e of sim.events) {
    if (e.type === 'crash') {
      cam.crashAt = [e.x, e.y, e.z];
      panicAt = [e.x, 0, e.z];
    } else if (e.type === 'crumble' && !panicAt) panicAt = [e.x, 0, e.z];
    else if (e.type === 'eject') {
      ejectCount++;
      const b = sim.riders[e.data.id].body;
      if (b && !cam.povBody) {
        cam.povBody = b;
        cam.povDir.set(b.v[0], b.v[1], b.v[2]).normalize();
      }
    }
  }
  fx.list.length = 0;
  simAcc = 0;
  endT = sim.mode === 'done' ? 2.6 : 0;
  player.seen = Math.max(player.seen, sim.t);
  syncCoaster(1, sim.t);
}
// 結果の画面の「もう一度見る」：組み立ては飛ばして、最初から再生バーつきで見る
function startReview() {
  setMode('ride');
  delete ui.ride.dataset.build;
  ui.skipBtn.innerHTML = '結果へ<i> ⏭</i>';
  player.reviewed = true;
  player.paused = false;
  seekTo(0);
  cam.shot = 'side';
  cam.shotT = 3;
  const f = co.sim.cars[0].f;
  setCam(f.x + 12, f.y + 4, f.z + 10, f.x, f.y + 1, f.z, 999, 0);
}
function refreshPlay() {
  const done = co && co.sim.mode === 'done';
  ui.playBtn.textContent = player.paused || done ? '▶' : '❚❚';
  ui.playBtn.setAttribute('aria-label', player.paused || done ? '再生' : '一時停止');
}
// 毎フレーム：つまみ・時刻・見えている印
function renderPlayer() {
  if (!co || ui.ride.hidden) return;
  const t = Math.min(co.sim.t, player.dur); // 終わったあとも物理の時刻は進むので、長さで止める
  const k = clamp(t / Math.max(0.1, player.dur), 0, 1);
  ui.plTrack.querySelector('.pl-fill').style.width = `${k * 100}%`;
  ui.plTrack.querySelector('.pl-knob').style.left = `${k * 100}%`;
  ui.plNow.textContent = t.toFixed(1);
  // はじめて見ているときは、まだ見ていない所の印は出さない（何が起きるか先に分かってしまう）
  for (const m of player.marks) {
    m.el.style.left = `${clamp(m.t / Math.max(0.1, player.dur), 0, 1) * 100}%`;
    const hide = !(player.reviewed || m.t <= player.seen + 0.05);
    if (m.el.hidden !== hide) m.el.hidden = hide;
  }
  ui.plDur.textContent = player.dur.toFixed(1);
  refreshPlay();
}
function seekFromX(clientX) {
  const r = ui.plTrack.getBoundingClientRect();
  player.pending = clamp((clientX - r.left) / Math.max(1, r.width), 0, 1) * player.dur;
}
ui.plTrack.addEventListener('pointerdown', (e) => {
  if (mode !== 'ride') return;
  player.scrub = true;
  try {
    ui.plTrack.setPointerCapture(e.pointerId);
  } catch (err) { /* つかめなくても、つまみは動く */ }
  seekFromX(e.clientX);
});
ui.plTrack.addEventListener('pointermove', (e) => {
  if (player.scrub) seekFromX(e.clientX);
});
for (const ev of ['pointerup', 'pointercancel']) {
  ui.plTrack.addEventListener(ev, () => {
    player.scrub = false;
  });
}
// キーボード：← → で 3 秒もどる・すすむ
ui.plTrack.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    player.pending = co.sim.t + (e.key === 'ArrowLeft' ? -3 : 3);
    e.preventDefault();
    e.stopPropagation();
  }
});
function togglePlay() {
  if (mode !== 'ride') return;
  sound.sfx('tap');
  if (co.sim.mode === 'done') {
    // 最後まで見たあとの ▶：最初から
    player.pending = 0;
    player.paused = false;
  } else player.paused = !player.paused;
  refreshPlay();
}
ui.playBtn.addEventListener('click', togglePlay);
ui.barBtn.addEventListener('click', () => {
  sound.sfx('tap');
  barPref = ui.ride.dataset.bar === 'off' ? 'on' : 'off';
  ui.ride.dataset.bar = barPref;
  ui.barBtn.classList.toggle('on', barPref === 'on');
  try {
    localStorage.setItem('rc_bar', barPref);
  } catch (e) { /* 保存できなくても使える */ }
});
ui.barBtn.classList.toggle('on', barPref === 'on');

// 事故の場所（設計の画面に印を出す）
let incidents = [];
function nearestIndex(tr, x, y, z) {
  let best = 0;
  let bd = Infinity;
  for (let i = 0; i < tr.n; i++) {
    const d = (tr.px[i] - x) ** 2 + (tr.py[i] - y) ** 2 * 0.3 + (tr.pz[i] - z) ** 2;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}
function collectIncidents(sim) {
  const out = [];
  const T = { break: 'break', eject: 'eject', faint: 'faint', stuck: 'stuck', rollbackStop: 'stuck', overrun: 'overrun', miss: 'miss', clash: 'clash' };
  for (const e of sim.events) {
    const type = T[e.type];
    if (!type) continue;
    // 線路から遠くへ飛んだ人は、飛んだ場所（線路の上）で数える
    if (out.some((o) => o.type === type && Math.hypot(o.x - e.x, o.z - e.z) < 8)) continue;
    const i = nearestIndex(co.tr, e.x, e.y, e.z);
    // カーブ（半径 40 m より急）で線路が折れた・飛ばされた：① で「事故が起きたカーブをゆるくする」を出す
    const curve = (type === 'break' || type === 'eject') && !(co.tr.fl[i] & F.LOOP) && curveRadius(co.tr, i) < 40;
    out.push({ type, i, x: co.tr.px[i], z: co.tr.pz[i], curve });
    if (out.length >= 12) break;
  }
  return out;
}

function onResult(r) {
  incidents = collectIncidents(co.sim);
  // 自分のコースなら、設計の画面の事故の印にもしておく（ブラウザに覚え、「つづきから」でも出す）
  if (!replay) editor.setIncidents(incidents);
  sound.roll(0);
  const sg = shownGrade(r);
  sound.sfx(sg === 'great' ? 'great' : sg === 'ok' || sg === 'faint' ? 'ok' : sg === 'fail' ? 'fail' : 'bigfail');
  if (sg === 'great' || sg === 'ok' || sg === 'faint') sound.sfx('cheer', 1.4);
  track('level_end', {
    mode: replay ? 'shared' : 'own', grade: r.grade, fainted: r.fainted, fun: r.fun, safe: r.safe, result: r.result, why: r.why,
    max_kmh: Math.round(r.maxV * 3.6), max_g: Math.round(r.maxG * 10) / 10, ejected: r.ejected, inversions: r.inv, jumps: r.jumps, collapse: r.collapse,
  });
}

// スキップ：最後までまとめて進める
function skipRide() {
  if (!co || mode !== 'ride') return;
  sound.sfx('tap');
  const sim = co.sim;
  sim.runToEnd();
  player.dur = Math.max(0.1, sim.t);
  player.seen = Math.max(player.seen, sim.t);
  addPlayerMarks(sim.events);
  sim.evI = sim.events.length;
  for (const e of sim.events) {
    if (e.type === 'crash') {
      cam.crashAt = [e.x, e.y, e.z];
      panicAt = [e.x, 0, e.z];
    }
  }
  syncCoaster(1, sim.t);
  endT = 2.6;
}

// ---------------- 結果 ----------------
const GRADE = {
  great: { text: '大成功！', color: '#ffd84a' },
  ok: { text: '成功', color: '#7fff9a' },
  fail: { text: '失敗…', color: '#c8c8ff' },
  bigfail: { text: '大失敗！！', color: '#ff4a4a' },
  faint: { text: '成功（気絶）', color: '#7fff9a' },
};
// 見せる評価：半分以上が気絶した成功は「成功（気絶）」と見せる（判定は成功。1.0.4 までは失敗だった）
const shownGrade = (r) => (r.grade === 'ok' && r.fainted >= r.riders / 2 ? 'faint' : r.grade);
function headline(r) {
  if (r.collapse) return 'ジェットコースターが まるごと崩れ落ちた…';
  if (r.why === 'overrun') return '駅で止まれずに 突っ込んだ！';
  if (r.why === 'clash') return '線路どうしが ぶつかっていた！';
  if (r.why === 'miss') return 'ジャンプの着地に 失敗した！';
  if (r.why === 'break' || r.why === 'fall') return '力に耐えきれず 線路が折れた！';
  if (r.stars) return `お客さん ${r.stars}人が 遠くまで飛んでいった！`;
  if (r.ejected) return `お客さん ${r.ejected}人が 飛んでいった…`;
  if (r.loopStall) return '宙返りの てっぺんまで 登りきれなかった…';
  if (r.result === 'rollback') return '坂を登れずに 駅へ戻ってきた…';
  if (r.result === 'stuck') return '途中で止まって お客さんは歩いて帰った…';
  if (r.fainted) return `${r.fainted}人が 気絶したけど 無事に帰ってきた`;
  if (r.grade === 'great') return 'スリル満点で 全員 無事に帰ってきた！';
  if (r.fun < 30) return '全員 無事… だけど ちょっと退屈かも';
  return '全員 無事に帰ってきた！';
}
function crowdLine(r) {
  if (r.collapse) return '観客：「えっ…」「動画とった！」';
  if (r.result === 'crash') return '観客：「うわぁぁ！」「逃げろー！」';
  if (r.stars) return '観客：「いま 空で何か光った…？」';
  if (r.ejected) return '観客：「人が飛んでる！？」';
  if (r.splash) return `観客：「${mapOf(mapId).splash.quote}」`;
  if (r.result !== 'clear') return '観客：「…まだ？」';
  if (r.grade === 'great') return '観客：「乗りたい！」「並ぶぞ！」';
  if (r.fun < 30) return '観客：「おとなしいね」';
  return '観客：「楽しそう！」';
}
const starStr = (v) => '★'.repeat(Math.round(v / 20)) + '☆'.repeat(5 - Math.round(v / 20));
function showResult() {
  setMode('result');
  player.reviewed = true;
  const r = result;
  const g = GRADE[shownGrade(r)];
  const el = ui.result;
  el.querySelector('.stamp').textContent = g.text;
  el.querySelector('.stamp').style.color = g.color;
  el.dataset.grade = shownGrade(r);
  el.querySelector('.head').textContent = headline(r);
  el.querySelector('.crowd').textContent = crowdLine(r);
  el.querySelector('.stars').innerHTML = `楽しさ <b>${starStr(r.fun)}</b>　安全 <b>${starStr(r.safe)}</b>`;
  const d = co.design;
  const stats = [
    ['最高速度', `${Math.round(r.maxV * 3.6)}km/h`],
    ['最大の G', `${r.maxG.toFixed(1)}G`],
    ['浮いた時間', `${r.air.toFixed(1)}秒`],
    ['いちばん高い所', `${Math.round(co.tr.maxH)}m`],
    ['宙返り', `${r.inv}回`],
    ['飛んだ人', `${r.ejected}人／${r.riders}人`],
    ['全長', `${Math.round(co.tr.L)}m`],
    ['建設費', yen(costOf(d, co.tr.Lf))],
  ];
  el.querySelector('.grid').innerHTML = stats.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
  document.getElementById('btn-edit').textContent = replay ? 'このコースを改造する' : 'なおす';
  document.getElementById('btn-new').textContent = replay ? '自分でも作る' : '新しく作る';
  document.getElementById('btn-native').hidden = !navigator.share;
  refreshFavRow();
}

// ---------------- お気に入り ----------------
// favId：いま見ている・直しているコースがどのお気に入りから来たか（お気に入りから開いていなければ null）
let favId = null;
const favOf = (id) => loadFavs().find((f) => f.id === id) || null;
function favMeta(d) {
  return d ? `${MATS[d.mat].name}・${STARTS[d.start].name}・${d.cars}両・しかけ ${d.gm.length}個` : '読み込めません';
}
const fmtDate = (t) => {
  const d = new Date(t);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
};
// 結果の画面のお気に入りのボタン：保存 / 保存済み / 上書き・新しく保存
function refreshFavRow() {
  const row = document.getElementById('fav-row');
  const note = document.getElementById('fav-note');
  const list = loadFavs();
  const cur = favId ? list.find((f) => f.id === favId) : null;
  if (!cur) favId = null;
  const full = list.length >= MAX_FAVS;
  const btn = (id, text, cls, disabled = false) => `<button id="${id}" class="btn ${cls}" type="button"${disabled ? ' disabled' : ''}>${text}</button>`;
  if (cur && cur.code === lastRideCode) {
    row.innerHTML = btn('btn-fav-done', `★ お気に入りに保存済み`, 'btn-fav', true);
  } else if (cur) {
    row.innerHTML = btn('btn-fav-over', '★ 上書き保存', 'btn-fav') + btn('btn-fav-new', '☆ 新しく保存', 'btn-sub2', full);
  } else {
    row.innerHTML = btn('btn-fav-new', '☆ お気に入りに保存', 'btn-fav', full);
  }
  note.textContent = full && !(cur && cur.code === lastRideCode) ? `お気に入りは ${MAX_FAVS} 個までです（タイトルの「お気に入り」から消せます）` : cur ? `お気に入り「${cur.name}」` : '';
  row.querySelector('#btn-fav-new')?.addEventListener('click', () => {
    const l = loadFavs();
    if (l.length >= MAX_FAVS) return;
    const f = { id: newFavId(), name: nextFavName(l), code: lastRideCode, at: Date.now() };
    if (!saveFavs([f, ...l])) return favFail();
    favId = f.id;
    sound.sfx('tap');
    track('favorite', { action: 'save' });
    refreshFavRow();
    note.textContent = `「${f.name}」として保存しました（タイトルの「お気に入り」から開けます）`;
  });
  row.querySelector('#btn-fav-over')?.addEventListener('click', () => {
    const l = loadFavs();
    const f = l.find((x) => x.id === favId);
    if (!f) return refreshFavRow();
    f.code = lastRideCode;
    f.at = Date.now();
    if (!saveFavs([f, ...l.filter((x) => x !== f)])) return favFail();
    sound.sfx('tap');
    track('favorite', { action: 'overwrite' });
    refreshFavRow();
    note.textContent = `「${f.name}」を上書きしました`;
  });
}
function favFail() {
  document.getElementById('fav-note').textContent = 'このブラウザでは保存できませんでした';
}
// お気に入りの一覧
function openFavs() {
  setMode('favs');
  renderFavs();
}
function renderFavs() {
  const list = loadFavs();
  const box = ui.favs.querySelector('.fav-list');
  ui.favs.querySelector('.fav-count').textContent = `${list.length} / ${MAX_FAVS}`;
  if (!list.length) {
    box.innerHTML = '<p class="fav-empty">まだありません。走らせたあとの画面の「☆ お気に入りに保存」で保存できます</p>';
    return;
  }
  box.innerHTML = '';
  for (const f of list) {
    const d = decode(f.code);
    const it = document.createElement('div');
    it.className = 'fav-item';
    it.innerHTML = `<div class="fav-name"></div><div class="fav-meta"></div>
      <div class="fav-btns">
        <button class="btn btn-main" data-a="ride" type="button">▶ 走らせる</button>
        <button class="btn btn-sub2" data-a="edit" type="button">編集</button>
        <button class="btn btn-sub2" data-a="copy" type="button">複製</button>
        <button class="btn btn-sub2" data-a="name" type="button">名前</button>
        <button class="btn btn-sub2" data-a="del" type="button">削除</button>
      </div>`;
    it.querySelector('.fav-name').textContent = f.name;
    it.querySelector('.fav-meta').textContent = `${favMeta(d)}　${fmtDate(f.at)}`;
    if (!d) it.querySelectorAll('[data-a="ride"],[data-a="edit"],[data-a="copy"]').forEach((b) => (b.disabled = true));
    if (list.length >= MAX_FAVS) it.querySelector('[data-a="copy"]').disabled = true;
    it.addEventListener('click', (e) => {
      const a = e.target.closest('button')?.dataset.a;
      if (a) favAction(a, f.id);
    });
    box.appendChild(it);
  }
}
function favAction(a, id) {
  const list = loadFavs();
  const f = list.find((x) => x.id === id);
  if (!f) return renderFavs();
  sound.sfx('tap');
  if (a === 'ride' || a === 'edit') {
    const d = decode(f.code);
    if (!d) return;
    favId = f.id;
    replay = false;
    history.replaceState(null, '', location.pathname);
    editor.setIncidents([]);
    track('favorite', { action: a });
    if (a === 'ride') startRide(d);
    else openEditor(d, 1);
  } else if (a === 'copy') {
    if (list.length >= MAX_FAVS) return;
    const c = { id: newFavId(), name: cleanName(`${f.name}のコピー`), code: f.code, at: Date.now() };
    list.splice(list.indexOf(f) + 1, 0, c);
    if (!saveFavs(list)) return;
    track('favorite', { action: 'copy' });
    renderFavs();
  } else if (a === 'name') {
    const n = cleanName(window.prompt(`新しい名前（${20} 文字まで）`, f.name));
    if (!n) return;
    f.name = n;
    saveFavs(list);
    renderFavs();
  } else if (a === 'del') {
    if (!window.confirm(`「${f.name}」を消しますか？`)) return;
    saveFavs(list.filter((x) => x !== f));
    if (favId === f.id) favId = null;
    renderFavs();
  }
}
document.getElementById('btn-favs').addEventListener('click', () => {
  sound.sfx('tap');
  openFavs();
});
document.getElementById('btn-favs-back').addEventListener('click', () => {
  sound.sfx('tap');
  toTitle();
});

function shareUrl(source) {
  return `${GAME_URL}?c=${lastRideCode}&utm_source=${source}&utm_medium=share`;
}
function shareText(r) {
  const g = GRADE[shownGrade(r)].text;
  return `【ジェットコースターを作ろう！】${g}\n${headline(r)}\n最高${Math.round(r.maxV * 3.6)}km/h・最大${r.maxG.toFixed(1)}G・宙返り${r.inv}回\n👇このリンクで同じコースが再生されます\n#${HASHTAG}`;
}
function openShare(url) {
  window.open(url, '_blank', 'noopener,noreferrer');
}
document.getElementById('btn-x').addEventListener('click', () => {
  if (!result) return;
  track('share', { method: 'x', content_type: result.grade });
  openShare(`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText(result))}&url=${encodeURIComponent(shareUrl('x'))}&via=it_monozukuri`);
});
document.getElementById('btn-line').addEventListener('click', () => {
  if (!result) return;
  track('share', { method: 'line', content_type: result.grade });
  openShare(`https://line.me/R/share?text=${encodeURIComponent(shareText(result) + '\n' + shareUrl('line'))}`);
});
document.getElementById('btn-native').addEventListener('click', async () => {
  if (!result || !navigator.share) return;
  const r = result;
  try {
    await navigator.share({ title: 'ジェットコースターを作ろう！', text: shareText(r), url: shareUrl('native') });
    track('share', { method: 'native', content_type: r.grade });
  } catch (e) { /* キャンセル */ }
});
document.getElementById('btn-copy').addEventListener('click', async () => {
  if (!result) return;
  const btn = document.getElementById('btn-copy');
  try {
    await navigator.clipboard.writeText(shareUrl('copy'));
    btn.textContent = 'コピーしました';
    track('share', { method: 'copy', content_type: result.grade });
  } catch (e) {
    btn.textContent = 'コピーできませんでした';
  }
  setTimeout(() => (btn.textContent = 'リンクをコピー'), 1800);
});
document.querySelectorAll('[data-follow]').forEach((a) => {
  a.addEventListener('click', () => track('follow', { method: a.dataset.follow }));
});
document.getElementById('btn-again').addEventListener('click', () => {
  sound.sfx('tap');
  startReview();
});
// 結果の「なおす」・走っている途中の「✏ なおす」：最後に直していた段階へ戻る（シェアされたコースの改造は ③）
function editAgain() {
  sound.sfx('tap');
  const d = decode(encode(co.design));
  const step = replay ? 3 : backStep;
  replay = false;
  history.replaceState(null, '', location.pathname);
  // 途中で戻ったときは、そこまでに起きた事故の場所を出す
  editor.setIncidents(result ? incidents : collectIncidents(co.sim));
  openEditor(d, step);
}
document.getElementById('btn-edit').addEventListener('click', editAgain);
ui.fixBtn.addEventListener('click', editAgain);
document.getElementById('btn-new').addEventListener('click', () => {
  sound.sfx('tap');
  favId = null;
  replay = false;
  history.replaceState(null, '', location.pathname);
  editor.setIncidents([]);
  openEditor(newDesign(cleanMap(co?.design.map)), 1);
});
document.getElementById('btn-totitle').addEventListener('click', () => {
  sound.sfx('tap');
  toTitle();
});
document.getElementById('btn-start').addEventListener('click', () => {
  sound.sfx('tap');
  favId = null;
  editor.setIncidents([]);
  openEditor(newDesign(), 1);
});
document.getElementById('btn-continue').addEventListener('click', () => {
  sound.sfx('tap');
  const d = loadSaved();
  favId = null;
  // 前回の事故の印も一緒に出す（つづきなので）
  editor.loadIncidents();
  if (d) openEditor(d, 1);
});
document.getElementById('btn-play-shared').addEventListener('click', () => {
  sound.sfx('tap');
  favId = null;
  if (sharedDesign) startRide(sharedDesign, true);
});
document.getElementById('btn-intro-title').addEventListener('click', () => toTitle());
ui.camBtn.addEventListener('click', () => {
  cam.mode = CAM_MODES[(CAM_MODES.indexOf(cam.mode) + 1) % CAM_MODES.length];
  if (cam.mode === 'free') activateFreeCamera();
  else freeCamPanel.hidden = true;
  ui.camBtn.textContent = `🎥 ${CAM_NAMES[cam.mode]}`;
  cam.shotT = 0;
  sound.sfx('tap');
});
function setSpeed(v) {
  speed = v;
  ui.speedBtn.textContent = `${speed}倍速`;
  ui.speedBtn.setAttribute('aria-label', `再生の速さ ${speed}倍`);
  ui.speedBtn.classList.toggle('on', speed !== 1);
}
ui.speedBtn.addEventListener('click', () => {
  setSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]);
  sound.sfx('tap');
});
// 組み立て中は「スキップ」、走っている間は「結果へ」（はじめて見ているときは最後まで進めてから、見直しているときはすぐ結果の画面へ）
ui.skipBtn.addEventListener('click', () => {
  if (mode === 'build') buildT = 99;
  else if (player.reviewed && result) {
    // 見直しの途中から結果の画面へ：最後の場面に飛んでから出す（そのまま出すと、後ろで列車が走り続けていた。0.1.34）
    sound.sfx('tap');
    player.paused = false;
    seekTo(player.dur);
    showResult();
  } else skipRide();
});
function refreshMute() {
  ui.mute.textContent = sound.muted ? '🔇' : '🔊';
}
ui.mute.addEventListener('click', () => {
  sound.setMuted(!sound.muted);
  refreshMute();
});
refreshMute();
addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'm' || e.key === 'M') {
    sound.setMuted(!sound.muted);
    refreshMute();
  } else if ((e.key === 'c' || e.key === 'C') && mode === 'ride') ui.camBtn.click();
  else if ((e.key === 'p' || e.key === 'P' || e.key === 'k' || e.key === 'K') && mode === 'ride') togglePlay();
  else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && mode === 'ride' && e.target === document.body) player.pending = co.sim.t + (e.key === 'ArrowLeft' ? -3 : 3);
  else if ((e.key === 'f' || e.key === 'F') && (mode === 'ride' || mode === 'build')) ui.speedBtn.click();
  else if (e.key === ' ' && (mode === 'ride' || mode === 'build')) {
    holdFF = true;
    e.preventDefault();
  }
});
addEventListener('keyup', (e) => {
  if (e.key === ' ') holdFF = false;
});
// 画面の長押しで早送り（0.25 秒押し続けたら。ボタンの上は除く）
let holdTimer = 0;
const wrapEl = document.getElementById('wrap');
wrapEl.addEventListener('pointerdown', () => {
  if (mode !== 'ride' && mode !== 'build') return;
  clearTimeout(holdTimer);
  holdTimer = setTimeout(() => {
    if (mode === 'ride' || mode === 'build') holdFF = true;
  }, 250);
});
for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) {
  wrapEl.addEventListener(ev, () => {
    clearTimeout(holdTimer);
    holdFF = false;
  });
}
wrapEl.addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('blur', () => {
  clearTimeout(holdTimer);
  holdFF = false;
});

// iPhone で連打したときのダブルタップ拡大・ピンチ拡大を止める（viewport の user-scalable=no は iOS では効かない）。
// 400 ms 以内の 2 回目のタップは touchend を止める。止めるとボタンの click が来ないので、ボタンは自分で押す（元に戻すの連打など）。
// リンクは対象外
let lastTouchEnd = 0;
document.addEventListener('touchend', (e) => {
  const t = Date.now();
  const el = e.target;
  if (t - lastTouchEnd < 400 && !(el.closest && el.closest('a'))) {
    e.preventDefault();
    const btn = el.closest && el.closest('button');
    if (btn && !btn.disabled) btn.click();
  }
  lastTouchEnd = t;
}, { passive: false });
for (const ev of ['gesturestart', 'gesturechange', 'dblclick']) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });

// ---------------- タイトル ----------------
function updateTitle(dt) {
  // お手本のコースがずっと走る（終わったらやり直し）
  const sim = co.sim;
  simAcc += dt;
  let n = 0;
  while (simAcc >= DT && n < 20) {
    sim.step();
    simAcc -= DT;
    n++;
  }
  if (n >= 20) simAcc = 0;
  sim.evI = sim.events.length;
  syncCoaster(1, sim.t);
  if (sim.mode === 'done' && sim.endT > 2) resetRide();
  const p = sim.cars[0].p;
  const c = trackCenter();
  cam.orbit += dt * 0.06;
  setCam(c.x + Math.cos(cam.orbit) * c.r * 1.1, 26, c.z + Math.sin(cam.orbit) * c.r * 1.1, lerp(c.x, p[0], 0.5), Math.max(6, p[1] * 0.5), lerp(c.z, p[2], 0.5), 1, dt);
  crowd.update(dt, null, Math.min(1, Math.abs(sim.v) / 30), p);
}
// タイトルロゴ：「ジェットコースター」を主役にして大きく、1 文字ずつ波打つ線路の上に乗せる。「を作ろう！」は下に小さく
// （0.1.29 までは「作ろう！」がいちばん大きく、ジェットコースターの方が目立たなかった。オーナーの指摘）
function drawTitleHUD() {
  const word = [...'ジェットコースター'];
  const size = Math.min(50, (HW - 28) / 9.2);
  const y0 = HH * 0.1 + size * 0.5; // 文字のまん中の高さ
  hx.font = `400 ${size}px ${F_BIG}`;
  const ws = word.map((c) => hx.measureText(c).width * 0.97);
  const total = ws.reduce((a, b) => a + b, 0);
  const x0 = HW / 2 - total / 2;
  // 線路の波（左の低い所から登って、右で一度落ちる）
  const wave = (x) => {
    const t = (x - x0) / total;
    return -Math.sin(t * Math.PI * 1.5 - 0.3) * size * 0.2;
  };
  const slope = (x) => Math.atan2(wave(x + 1) - wave(x - 1), 2);
  // レール（文字の下）：2 本のレールとまくら木
  const ry = (x) => y0 + size * 0.62 + wave(x);
  hx.lineCap = 'round';
  for (let x = x0 - 6; x <= x0 + total + 6; x += size * 0.32) {
    const a = slope(x);
    hx.strokeStyle = '#2b3a55';
    hx.lineWidth = 3;
    hx.beginPath();
    hx.moveTo(x + Math.sin(a) * 4, ry(x) - Math.cos(a) * 4 + 4);
    hx.lineTo(x - Math.sin(a) * 4, ry(x) + Math.cos(a) * 4 + 4);
    hx.stroke();
  }
  for (const [dy, w, c] of [[0, 7, '#2b3a55'], [0, 4, '#e84a5f'], [8, 4, '#e84a5f']]) {
    hx.strokeStyle = c;
    hx.lineWidth = w;
    hx.beginPath();
    for (let x = x0 - 8; x <= x0 + total + 8; x += 2) hx[x === x0 - 8 ? 'moveTo' : 'lineTo'](x, ry(x) + dy);
    hx.stroke();
  }
  // 文字：線路の傾きに合わせて 1 文字ずつ傾け、黄色のグラデーションに赤いふち
  let x = x0;
  hx.textAlign = 'center';
  hx.textBaseline = 'middle';
  hx.lineJoin = 'round';
  for (let i = 0; i < word.length; i++) {
    const cx = x + ws[i] / 2;
    const cy = y0 + wave(cx);
    hx.save();
    hx.translate(cx, cy);
    hx.rotate(slope(cx) * 0.9);
    const g = hx.createLinearGradient(0, -size / 2, 0, size / 2);
    g.addColorStop(0, '#fff3a0');
    g.addColorStop(0.55, '#ffd84a');
    g.addColorStop(1, '#ffab1f');
    hx.lineWidth = size * 0.3;
    hx.strokeStyle = '#2b3a55';
    hx.strokeText(word[i], 0, 3);
    hx.lineWidth = size * 0.2;
    hx.strokeStyle = '#e84a5f';
    hx.strokeText(word[i], 0, 0);
    hx.fillStyle = g;
    hx.fillText(word[i], 0, 0);
    hx.restore();
    x += ws[i];
  }
  // 「を作ろう！」は線路の下のまん中に（0.1.30 では右寄りで小さく、スマホで見ると片寄って見えた）
  const sy = y0 + size * 0.62 + size * 0.06 + 10; // 線路のすぐ下（0.1.31 では上の行から少し離れて見えた）
  const ss = size * 0.82;
  txt('を作ろう！', HW / 2, sy, { size: ss, font: F_BIG, weight: 400, align: 'center', color: '#ffffff', outline: '#e84a5f', ow: ss * 0.24 });
  txt('手で描いた線で物理シミュレーション', HW / 2, sy + ss + 16, { size: 14, align: 'center', color: '#ffffff', outline: '#2b3a55', ow: 4 });
}

// ---------------- 走っている間の HUD ----------------
function drawRideHUD() {
  if (!co) return;
  const sim = co.sim;
  const lead = sim.cars[0];
  const top = 8 + safeTop();
  if (mode === 'ride' && sim.mode !== 'done') {
    const kmh = Math.round(Math.abs(sim.v) * 3.6);
    rbox(10, top, 128, 62, 10, 'rgba(20,24,40,0.55)');
    txt(`${kmh}`, 70, top + 6, { size: 30, align: 'right', font: F_BIG, weight: 400, outline: null });
    txt('km/h', 74, top + 22, { size: 12, outline: null, color: '#c8d0e0' });
    const g = sim.mode === 'air' ? 0 : lead.gUf;
    const gc = g > 4.5 || g < -0.5 ? '#ff6a6a' : g > 3 || g < 0.2 ? '#ffd84a' : '#9affb0';
    txt(`${g >= 0 ? '+' : ''}${g.toFixed(1)}G`, 18, top + 42, { size: 15, outline: null, color: gc });
    txt(`${Math.round(lead.p[1])}m`, 130, top + 44, { size: 12, outline: null, color: '#c8d0e0', align: 'right' });
  }
  // 先頭車の視点で、飛んだお客さんの目線に切り替わっているとき
  if (mode === 'ride' && cam.mode === 'pov' && cam.povBody) {
    txt(cam.povBody.gone ? '☆ 遠くまで飛んでいったお客さんの目線' : '飛んでいったお客さんの目線', HW / 2, top + 72, { size: 15, align: 'center', color: '#ffd84a', ow: 4 });
  }
  // 長押しの早送り・その案内・一時停止（下の操作の帯のすぐ上に出す）
  const barTop = (ui.ride.getBoundingClientRect().top - hud.getBoundingClientRect().top) / hudK;
  const by = Math.min(HH - 60, barTop - 30);
  if (mode === 'ride' && sim.mode !== 'done') {
    if (player.paused || player.scrub) txt('一時停止中', HW / 2, by - 6, { size: 18, align: 'center', color: '#ffffff', ow: 5 });
    else if (holdFF) txt(`▶▶ 早送り中（${curSpeed()}倍）`, HW / 2, by - 10, { size: 20, align: 'center', color: '#ffffff', ow: 5 });
    else if (sim.t < 6 && !player.reviewed) txt(COARSE ? '画面を長押しで早送り' : 'スペースキー（長押し）で早送り', HW / 2, by, { size: 14, align: 'center', color: '#ffffff', ow: 4, alpha: Math.min(1, (6 - sim.t) / 1.5) });
  }
  // ポップアップ
  let py = HH * 0.3;
  for (const p of popups) {
    const a = p.t < 0.15 ? p.t / 0.15 : p.t > 1.8 ? Math.max(0, 1 - (p.t - 1.8) / 0.4) : 1;
    const s = p.t < 0.15 ? 1.4 - (p.t / 0.15) * 0.4 : 1;
    txt(p.text, HW / 2, py, { size: fitSize(p.text, p.size * s, HW - 20, { font: F_BIG, weight: 400, ow: 7 }), align: 'center', font: F_BIG, weight: 400, color: p.color, ow: 7, alpha: a });
    py += p.size + 8;
  }
  // 終わり：スタンプ
  if (result && mode === 'ride' && sim.mode === 'done') {
    const g = GRADE[shownGrade(result)];
    const k = clamp(endT / 0.25, 0, 1);
    const s = 2.2 - k * 1.2;
    hx.save();
    hx.translate(HW / 2, HH * 0.45);
    hx.rotate(-0.12);
    hx.scale(s, s);
    txt(g.text, 0, 0, { size: Math.min(64, HW / (g.text.length * 0.9)), align: 'center', base: 'middle', font: F_BIG, weight: 400, color: g.color, outline: '#1a1a2a', ow: 12, alpha: k });
    hx.restore();
  }
}
let safeCache = { t: 0, v: 0 };
function safeTop() {
  const now = performance.now();
  if (now - safeCache.t < 1000) return safeCache.v;
  let probe = document.getElementById('safe-probe');
  if (!probe) {
    probe = document.createElement('div');
    probe.id = 'safe-probe';
    document.body.appendChild(probe);
  }
  safeCache = { t: now, v: (parseFloat(getComputedStyle(probe).paddingTop) || 0) / hudK };
  return safeCache.v;
}

// ---------------- シェアされたコース ----------------
let sharedDesign = null;
function openShared(code) {
  const d = decode(code);
  if (!d) {
    toTitle();
    popup('コースを読み込めませんでした', '#ff9a9a', 22);
    return;
  }
  sharedDesign = d;
  if (!co || !co.demo) {
    setupCoaster(demoDesign());
    co.demo = true;
    resetRide();
  }
  setMode('intro');
  ui.intro.querySelector('.meta').textContent = `${MATS[d.mat].name}・${BARS[d.bar].name}・${d.cars}両・${STARTS[d.start].name}・しかけ ${d.gm.length}個` + (isDefaultLook(d.look) ? '' : `・${RIDER_LOOKS[d.look.rider].icon}${SCENE_LOOKS[d.look.scene].icon}`) + (d.map ? `・${MAPS[cleanMap(d.map)].name}` : '');
}

// ================================================================
//  メインループ
// ================================================================
let last = performance.now();
const perf = { list: [], sum: 0 };
function quality(ms) {
  if (!COARSE || dprCap <= 1) return;
  if (ms > 1000) return;
  perf.list.push(ms);
  perf.sum += ms;
  if (perf.sum < 2000) return;
  const mid = perf.list.sort((a, b) => a - b)[perf.list.length >> 1];
  perf.list.length = 0;
  perf.sum = 0;
  if (mid < 22) return;
  dprCap = Math.max(1, Math.min(dprCap, renderer.getPixelRatio()) - 0.25);
  resize();
}
function frame(now) {
  requestAnimationFrame(frame);
  // 120Hz の端末でも描くのは 60 回まで。タイトル・結果は 30 回
  const low = mode === 'title' || mode === 'result' || mode === 'intro' || mode === 'favs';
  if (now - last < (low ? 30 : 13)) return;
  if (mode !== 'edit') quality(now - last);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!window.__rc || !window.__rc.paused) tick(dt);
}
function tick(dt, render = true) {
  modeT += dt;
  for (const p of popups) p.t += dt;
  while (popups.length && popups[0].t > 2.2) popups.shift();
  fx.update(dt);
  if (snowfall) snowfall.update(dt, camera.position.x, camera.position.y, camera.position.z);
  if (theme) theme.update(dt);
  if (mode === 'title' || mode === 'intro' || mode === 'favs') updateTitle(dt);
  else if (mode === 'build') updateBuild(dt);
  else if (mode === 'ride' || mode === 'result') updateRide(dt);
  if (mode === 'result') {
    // 結果の後ろ：ゆっくり見回す
    const sim = co.sim;
    const c = cam.crashAt || [STATION.x0 + 12, 2, STATION.z];
    cam.orbit += dt * 0.12;
    const R = sim.st.collapse ? 80 : 36;
    setCam(c[0] + Math.cos(cam.orbit) * R, sim.st.collapse ? 45 : 18, c[2] + Math.sin(cam.orbit) * R, c[0], 3, c[2], 1, dt);
  }
  if (!render) return;
  if (mode !== 'edit') renderer.render(scene3d, camera);
  hudBegin();
  if (mode === 'title') drawTitleHUD();
  else if (mode === 'ride' || mode === 'build') {
    drawRideHUD();
    renderPlayer();
  }
}

// Google Fonts の日本語は文字の範囲ごとに分かれて読み込まれるので、ソースに出てくる文字をまとめて先に読み込む
async function loadFonts() {
  try {
    const get = (f) => fetch(new URL(f, import.meta.url)).then((r) => r.text()).catch(() => '');
    const src = (await get('./main.js')) + (await get('./editor.js')) + (await get('./track.js'));
    const chars = [...new Set(src.replace(/[\x00-\x7f]/g, ''))].join('') + '0123456789';
    await Promise.race([
      Promise.all([
        document.fonts.load(`400 40px "Dela Gothic One"`, chars),
        document.fonts.load(`800 20px "M PLUS 1p"`, chars),
        document.fonts.load(`500 20px "M PLUS 1p"`, chars),
      ]),
      new Promise((r) => setTimeout(r, 3000)),
    ]);
  } catch (e) { /* フォント読み込み失敗時は代替フォント */ }
}
async function boot() {
  await loadFonts();
  document.body.classList.add('ready');
  const code = QS.get('c');
  if (code) openShared(code);
  else toTitle();
  requestAnimationFrame(frame);
}
boot();

// デバッグ用（コンソールから）。__rc.step(n) でフレームを手動で進める。本番では出さない（localhost とプレビューだけ）
if (DEBUG_OK) window.__rc = {
  get co() { return co; }, get mode() { return mode; }, get result() { return result; }, editor, renderer, camera, scene3d, THREE, cam,
  step: (n = 1, dt = 1 / 60) => { for (let i = 0; i < n; i++) tick(dt, i === n - 1); },
  ride: (d) => startRide(d),
  skip: () => skipRide(),
  encode, decode, randomStroke, defaultHeights, buildTrack, Sim, prepare, H_SAMPLES, BUDGET, FIELD, F,
};

// 拡張版：本番でもアドオンが実際のゲーム内部へ接続できるよう、必要なAPIだけ公開する。
// 既存のデバッグAPIとは別名・別オブジェクトにし、ゲームの通常動作は変えない。
const coasterExpansionRuntime = {
  get editor() { return editor; },
  get co() { return co; },
  get scene3d() { return scene3d; },
  get camera() { return camera; },
  get renderer() { return renderer; },
  get THREE() { return THREE; },
  get mode() { return mode; },
  get sim() { return co ? co.sim : null; },
  get cameraMode() { return cam.mode; },
  get paused() { return !!player.paused; },
  get playbackSpeed() { return speed; },
  setCameraMode(name) {
    if (!CAM_MODES.includes(name)) throw new Error('未対応のカメラモードです');
    cam.mode = name;
    if (name === 'free') activateFreeCamera();
    else { freeCamPanel.hidden = true; clearFreeCamMoves(); }
    ui.camBtn.textContent = `🎥 ${CAM_NAMES[name]}`;
    cam.shotT = 0;
    return cam.mode;
  },
  setPlaybackSpeed(value) {
    const v = Number(value);
    if (!SPEEDS.includes(v)) throw new Error('再生速度は0.5 / 1 / 2 / 4倍から選んでください');
    setSpeed(v);
    return speed;
  },
  setPaused(value) {
    if (mode !== 'ride') return false;
    if (co && co.sim.mode === 'done' && !value) player.pending = 0;
    player.paused = !!value;
    refreshPlay();
    return player.paused;
  },
  togglePlayback() {
    if (mode !== 'ride') return false;
    togglePlay();
    return player.paused;
  },
  normalize,
  buildTrack,
  prepare,
  Sim,
  createTrackExportGroup(design = editor.design) {
    if (!design || !Array.isArray(design.pts) || design.pts.length < 2) throw new Error('書き出すコースがありません');
    const tr = prepare(design, buildTrack);
    const look = cleanLook(design.look);
    const built = buildTrackMeshes(tr, look.rail, false);
    built.group.name = 'EditedCoasterTrack';
    return { group: built.group, track: tr };
  },
};
window.__coasterExpansionRuntime = coasterExpansionRuntime;
installCoasterExpansion(coasterExpansionRuntime, { FIELD, MAX_LEN, randomStroke, polyLen });

