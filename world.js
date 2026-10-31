// world.js — 遊園地の敷地・線路・車両・お客さん・観客・飛び散るものの 3D の見た目
// 物理は sim.js が持ち、ここは毎フレームその状態を写すだけ。
import * as THREE from '../../crowded-train-3d/js/vendor/three.module.min.js';
import { FIELD, STATION, DS, F, CHUNK, MATS, mapOf, inWater } from './track.js';
import { themeLayout } from './themes.js';
import { riderSeat } from './sim.js';
import { RAIL_LOOKS, CAR_LOOKS } from './looks.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const colorCache = new Map();
function col(hex) {
  let c = colorCache.get(hex);
  if (!c) {
    c = new THREE.Color(hex);
    colorCache.set(hex, c);
  }
  return c;
}

// ---------------- 形を頂点の配列に積む道具 ----------------
// 色付きの三角形を 1 つのジオメトリにまとめる（材質 1 つ＝描画 1 回）
class Builder {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.col = [];
    this.idx = [];
  }
  get count() {
    return this.pos.length / 3;
  }
  vert(x, y, z, nx, ny, nz, c) {
    this.pos.push(x, y, z);
    this.nor.push(nx, ny, nz);
    this.col.push(c.r, c.g, c.b);
  }
  // 中心 c、軸 ax（長さ＝半分の大きさ）の箱
  box(cx, cy, cz, ax, ay, az, color) {
    const c = col(color);
    const faces = [
      [ax, ay, az, 1], [ax, ay, az, -1],
      [ay, az, ax, 1], [ay, az, ax, -1],
      [az, ax, ay, 1], [az, ax, ay, -1],
    ];
    for (const [n, u, v, sgn] of faces) {
      const nl = Math.hypot(n[0], n[1], n[2]) || 1;
      const nx = (n[0] / nl) * sgn;
      const ny = (n[1] / nl) * sgn;
      const nz = (n[2] / nl) * sgn;
      const b = this.count;
      const ox = cx + n[0] * sgn;
      const oy = cy + n[1] * sgn;
      const oz = cz + n[2] * sgn;
      const s = sgn > 0 ? 1 : -1;
      this.vert(ox - u[0] - v[0] * s, oy - u[1] - v[1] * s, oz - u[2] - v[2] * s, nx, ny, nz, c);
      this.vert(ox + u[0] - v[0] * s, oy + u[1] - v[1] * s, oz + u[2] - v[2] * s, nx, ny, nz, c);
      this.vert(ox + u[0] + v[0] * s, oy + u[1] + v[1] * s, oz + u[2] + v[2] * s, nx, ny, nz, c);
      this.vert(ox - u[0] + v[0] * s, oy - u[1] + v[1] * s, oz - u[2] + v[2] * s, nx, ny, nz, c);
      this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
  }
  // 軸に沿わない箱：a から b までの、太さ w × h の角材（up は h の向きの目安）
  beam(a, b, w, h, color, up = [0, 1, 0]) {
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const L = Math.hypot(d[0], d[1], d[2]);
    if (L < 1e-6) return;
    const t = [d[0] / L, d[1] / L, d[2] / L];
    let s = cross(t, up);
    if (Math.hypot(...s) < 0.1) s = cross(t, [1, 0, 0]);
    s = norm(s);
    const u = cross(s, t);
    this.box((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2,
      [t[0] * L / 2, t[1] * L / 2, t[2] * L / 2], [u[0] * h / 2, u[1] * h / 2, u[2] * h / 2], [s[0] * w / 2, s[1] * w / 2, s[2] * w / 2], color);
  }
  // 点の列に沿った管（rings: [[x,y,z, ux,uy,uz, rx,ry,rz]...]）
  tube(rings, r, color, seg = 6) {
    const c = col(color);
    const b0 = this.count;
    for (const q of rings) {
      for (let k = 0; k < seg; k++) {
        const a = (k / seg) * Math.PI * 2;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const nx = q[3] * ca + q[6] * sa;
        const ny = q[4] * ca + q[7] * sa;
        const nz = q[5] * ca + q[8] * sa;
        this.vert(q[0] + nx * r, q[1] + ny * r, q[2] + nz * r, nx, ny, nz, c);
      }
    }
    for (let i = 0; i < rings.length - 1; i++) {
      for (let k = 0; k < seg; k++) {
        const a = b0 + i * seg + k;
        const b = b0 + i * seg + ((k + 1) % seg);
        const c2 = a + seg;
        const d = b + seg;
        this.idx.push(a, b, c2, b, d, c2);
      }
    }
  }
  // 回転体（縦の軸。prof：[[高さ, 半径]...] を下から）
  lathe(x, y, z, prof, color, seg = 10) {
    this.tube(prof.map(([h, r]) => [x, y + h, z, r, 0, 0, 0, 0, r]), 1, color, seg);
  }
  // 円柱（a から b）
  cyl(a, b, r, color, seg = 6) {
    const d = norm([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
    let s = cross(d, [0, 1, 0]);
    if (Math.hypot(...s) < 0.1) s = cross(d, [1, 0, 0]);
    s = norm(s);
    const u = cross(s, d);
    this.tube([[...a, ...u, ...s], [...b, ...u, ...s]], r, color, seg);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.count > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    return g;
  }
}
function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function norm(a) {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

const VC = new THREE.MeshLambertMaterial({ vertexColors: true });
VC.userData.shared = true;

// ---------------- 敷地 ----------------
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// 景色ごとの色と光（looks.js の SCENE_LOOKS の id）。光・霧・背景は main.js が当てる
export const SCENES = {
  day: {
    grass: ['#6fae4a', '#69a845', '#75b54f'], path: '#d8c8a8', flowers: true, water: ['#3d8fd0', '#0a2a50'], rim: '#b8b0a0',
    crowns: ['#3f8a3a', '#4c9a40', '#357a33', '#5aa848'], hedge: '#3a7a34', mount: '#8fb8a0',
    bg: '#9fd0f5', fog: ['#cfe6f7', 140, 330], hemi: ['#ffffff', '#6a8a50', 1.6], sun: ['#fff4e0', 2.0, [60, 120, 80]], exposure: 1.1,
    sky: [[0, '#5aa8f0'], [0.75, '#bfe2ff'], [1, '#e8f4ff']], clouds: 'rgba(255,255,255,0.9)',
  },
  sunset: {
    grass: ['#6fa04a', '#69984a', '#75a850'], path: '#d8c0a0', flowers: true, water: ['#d88a70', '#402030'], rim: '#b8a898',
    crowns: ['#3f7a3a', '#4c8a40', '#356a33', '#5a9848'], hedge: '#3a6a34', mount: '#6a4a6a',
    bg: '#f4a070', fog: ['#f2b890', 130, 320], hemi: ['#ffd8b8', '#6a5040', 1.25], sun: ['#ffa060', 2.6, [-120, 40, -70]], exposure: 1.05,
    sky: [[0, '#3a3a7a'], [0.45, '#c86080'], [0.75, '#f89058'], [1, '#ffd890']], clouds: 'rgba(255,190,170,0.75)', sunDisk: '#fff0b0',
  },
  night: {
    grass: ['#40683a', '#3c6336', '#456e3e'], path: '#9a948a', flowers: false, water: ['#1a3a70', '#0a1838'], rim: '#8a8890',
    crowns: ['#2f6a2e', '#3a7a34', '#2a5a2a', '#447a3a'], hedge: '#2a5a28', mount: '#1c2640',
    bg: '#0c1634', fog: ['#101c40', 130, 330], hemi: ['#8090d0', '#2a3040', 0.85], sun: ['#c0d0ff', 0.8, [-60, 120, 40]], exposure: 1.15,
    sky: [[0, '#040820'], [0.7, '#14245a'], [1, '#2a3a78']], stars: true, moon: true, lights: true,
  },
  // ハロウィン（テーマで決まる景色）：紫の夕闇、地平線だけ赤い。大きなオレンジの月
  halloween: {
    grass: ['#4c5a36', '#475431', '#52613a'], path: '#8c7c64', flowers: false, water: ['#2e6a30', '#0e3a14'], rim: '#3a3228',
    crowns: ['#3a3a2a', '#40402e', '#363626', '#444430'], hedge: '#2c3824', mount: '#2a1838', deadTrees: true,
    bg: '#3a2050', fog: ['#4a2a5a', 120, 320], hemi: ['#c8a8ff', '#3a2a20', 1.25], sun: ['#ffa060', 1.5, [-120, 40, -70]], exposure: 1.1,
    sky: [[0, '#140a2c'], [0.5, '#44195a'], [0.8, '#b0404c'], [1, '#ff9a40']], stars: true, bigMoon: '#ffb040', lights: true,
    wheel: ['#f08020', '#7a3ab0', '#40b040', '#f08020', '#7a3ab0', '#202020'], roofs: ['#7a3ab0', '#f08020', '#202020', '#40a040'],
    hedgeLights: ['#ff8a20', '#b060ff'],
  },
  // クリスマス（テーマで決まる景色）：雪の夜。電飾と、降る雪
  xmas: {
    grass: ['#e8eef6', '#e2e9f2', '#eef3f8'], path: '#b8c0d0', flowers: false, water: ['#bcdcf0', '#1a2a3a'], rim: '#ffffff',
    crowns: ['#2f6a3a', '#3a7a44', '#2a5a34', '#447a4a'], hedge: '#2a5a34', mount: '#3a4a6a', snowCap: true, snowfall: true, firTrees: true,
    bg: '#1a2850', fog: ['#2a3a64', 120, 330], hemi: ['#c0d0ff', '#8090b0', 1.25], sun: ['#c0d0ff', 0.9, [-60, 120, 40]], exposure: 1.15,
    sky: [[0, '#060c28'], [0.7, '#1a2a60'], [1, '#3a4a88']], stars: true, moon: true, lights: true,
    wheel: ['#e8384f', '#2a9a4a', '#ffffff', '#f8c030', '#e8384f', '#2a9a4a'], roofs: ['#e8384f', '#2a9a4a', '#ffffff', '#f8c030'],
    hedgeLights: ['#ff4050', '#40d060', '#ffd040'],
  },
  // 夏のプールと花火（テーマで決まる景色）：日が沈んだあとの夏の夜。花火が上がる
  summer: {
    grass: ['#3a6a3a', '#366436', '#3e703e'], path: '#a09888', flowers: false, water: ['#30c8f0', '#0a6a90'], rim: '#e8e4d8',
    crowns: ['#2f6a2e', '#3a7a34', '#2a5a2a', '#447a3a'], hedge: '#2a5a28', mount: '#1c2a4a', palmTrees: true,
    bg: '#10204a', fog: ['#1a2a58', 130, 330], hemi: ['#a8c0ff', '#3a3040', 1.05], sun: ['#ffb080', 1.0, [-120, 30, -70]], exposure: 1.15,
    sky: [[0, '#081038'], [0.6, '#1a2a6a'], [0.85, '#6a3a6a'], [1, '#f08050']], stars: true, lights: true,
    wheel: ['#3aa0ff', '#f8d040', '#ff5a8a', '#5ad06a', '#ff9a30', '#ffffff'], roofs: ['#3aa0ff', '#f8d040', '#ff5a8a', '#5ad06a'],
    hedgeLights: ['#ffd040', '#40c0ff'],
  },
  snow: {
    grass: ['#eef2f6', '#e8edf3', '#f4f7fa'], path: '#c8ccd6', flowers: false, water: ['#cde4f2', '#203040'], rim: '#d8dce4',
    crowns: ['#2f6a3a', '#3a7a44', '#2a5a34', '#447a4a'], hedge: '#3a6a44', mount: '#e8eef6', snowCap: true,
    bg: '#c8d4e2', fog: ['#dde4ee', 100, 300], hemi: ['#ffffff', '#a8b0c0', 1.75], sun: ['#ffffff', 1.4, [60, 120, 80]], exposure: 1.05,
    sky: [[0, '#9aaabe'], [0.7, '#d8e0ea'], [1, '#eef2f6']], clouds: 'rgba(240,244,250,0.85)', snowfall: true,
  },
};

function tree(b, x, z, h, cr, snow) {
  b.cyl([x, 0, z], [x, h * 0.45, z], 0.3, '#7a5530', 5);
  b.box(x, h * 0.65, z, [h * 0.32, 0, 0], [0, h * 0.3, 0], [0, 0, h * 0.32], cr);
  b.box(x, h * 0.95, z, [h * 0.2, 0, 0], [0, h * 0.15, 0], [0, 0, h * 0.2], cr);
  if (snow) {
    // 雪：それぞれの段の上に、少し大きい白い板（上面を重ねない）
    b.box(x, h * 0.95 + 0.04, z, [h * 0.33, 0, 0], [0, 0.06, 0], [0, 0, h * 0.33], '#f6f8fc');
    b.box(x, h * 1.1 + 0.06, z, [h * 0.21, 0, 0], [0, 0.07, 0], [0, 0, h * 0.21], '#ffffff');
  }
}
// ---------------- テーマの飾り ----------------
// 枯れ木：曲がった幹から、ねじれた枝が 4〜6 本（葉のかたまりの箱を使わない）
function deadTree(b, x, z, h, rot, seed) {
  const r = mulberry(seed);
  const C = '#3a2f2b';
  const bx = Math.cos(rot) * 0.6;
  const bz = Math.sin(rot) * 0.6;
  const at = (t) => [x + bx * t * t, h * t, z + bz * t * t];
  const rings = [];
  for (let k = 0; k <= 5; k++) {
    const t = k / 5;
    const [px, py, pz] = at(t);
    const rr = 0.42 * (1 - t) + 0.08;
    rings.push([px, py, pz, rr, 0, 0, 0, 0, rr]);
  }
  b.tube(rings, 1, C, 6);
  const nb = 4 + Math.floor(r() * 3);
  for (let i = 0; i < nb; i++) {
    const t = 0.45 + (i / nb) * 0.5;
    const p0 = at(t);
    const a = rot + i * 2.3 + r() * 0.8;
    const L = h * (0.28 + r() * 0.15) * (1.1 - t * 0.5);
    const p1 = [p0[0] + Math.cos(a) * L, p0[1] + L * (0.35 + r() * 0.4), p0[2] + Math.sin(a) * L];
    b.beam(p0, p1, 0.22, 0.22, C);
    // 先で折れ曲がる小枝 2 本
    for (const da of [0.7, -0.6]) {
      const a2 = a + da;
      const L2 = L * (0.4 + r() * 0.2);
      b.beam(p1, [p1[0] + Math.cos(a2) * L2, p1[1] + L2 * (r() - 0.2), p1[2] + Math.sin(a2) * L2], 0.12, 0.12, C);
    }
  }
}
// かぼちゃ（ジャック・オー・ランタン）。顔は向き rot の側。glow に目と口の明かりを足す
function pumpkin(b, glow, x, z, s, rot) {
  const prof = [[0, 0.2], [0.08, 0.5], [0.2, 0.62], [0.36, 0.66], [0.52, 0.6], [0.66, 0.42], [0.74, 0.12]].map(([h, rr]) => [h * s, rr * s]);
  b.lathe(x, 0, z, prof, '#ee7618', 9);
  b.cyl([x, 0.7 * s, z], [x + 0.05 * s, 0.92 * s, z], 0.07 * s, '#5a6a24', 5);
  const f = [Math.cos(rot), 0, Math.sin(rot)];
  const l = [-Math.sin(rot), 0, Math.cos(rot)];
  const R = 0.645 * s;
  const face = (side, y, w, hh) => {
    const px = x + f[0] * R + l[0] * side * s;
    const pz = z + f[2] * R + l[2] * side * s;
    b.box(px, y * s, pz, [f[0] * 0.025 * s, 0, f[2] * 0.025 * s], [0, hh * s, 0], [l[0] * w * s, 0, l[2] * w * s], '#3a1806');
    glow.p.push(px + f[0] * 0.04 * s, y * s, pz + f[2] * 0.04 * s);
    glow.c.push(1, 0.5, 0.08);
  };
  face(0.2, 0.46, 0.08, 0.07);
  face(-0.2, 0.46, 0.08, 0.07);
  face(0, 0.27, 0.22, 0.045);
}
// 墓石（0：上が丸い、1：十字架、2：四角に笠）。少し傾け、手前に土を盛る
function grave(b, g) {
  const { x, z, h, tilt } = g;
  const u = [Math.sin(tilt), Math.cos(tilt), 0];
  const rgt = [Math.cos(tilt), -Math.sin(tilt), 0];
  const at = (k) => [x + u[0] * k, u[1] * k, z];
  if (g.kind === 1) {
    b.beam([x, 0, z], at(h * 1.15), 0.2, 0.2, '#b4b4bc', [0, 0, 1]);
    const c = at(h * 0.8);
    b.beam([c[0] - rgt[0] * 0.42, c[1] - rgt[1] * 0.42, z], [c[0] + rgt[0] * 0.42, c[1] + rgt[1] * 0.42, z], 0.2, 0.2, '#b4b4bc', [0, 0, 1]);
  } else if (g.kind === 2) {
    const c = at(h * 0.5);
    b.box(c[0], c[1], z, rgt.map((v) => v * 0.32), u.map((v) => v * h * 0.5), [0, 0, 0.18], '#7c7c88');
    const t = at(h + 0.06);
    b.box(t[0], t[1], z, rgt.map((v) => v * 0.4), u.map((v) => v * 0.07), [0, 0, 0.25], '#5c5c68');
  } else {
    const c = at(h * 0.5);
    b.box(c[0], c[1], z, rgt.map((v) => v * 0.45), u.map((v) => v * h * 0.5), [0, 0, 0.13], '#8c8c96');
    const t = at(h);
    b.cyl([t[0], t[1], z - 0.13], [t[0], t[1], z + 0.13], 0.45, '#8c8c96', 12);
  }
  b.box(x, 0.06, z + 1.0, [0.45, 0, 0], [0, 0.08, 0], [0, 0, 0.75], '#4a3a2a');
}
// お化け屋敷（正面は +z）。窓は明かり（夜は電球の点）
function hauntedHouse(b, x, z, bulb) {
  const W = '#3c2c4a';
  b.box(x, 5, z, [10, 0, 0], [0, 5, 0], [0, 0, 6], W);
  b.box(x - 2, 12.5, z, [7, 0, 0], [0, 2.5, 0], [0, 0, 5], '#34263f');
  // 切妻の屋根（前と後ろの 2 枚）
  for (const sg of [1, -1]) {
    const n = Math.hypot(5.6, 3.5);
    b.box(x - 2, 16.75, z + sg * 2.8, [7.8, 0, 0], [0, 1.75, -sg * 2.8], [0, (5.6 / n) * 0.25, (sg * 3.5 / n) * 0.25], '#1e1626');
  }
  // 1 階の屋根のひさし
  b.box(x, 10.15, z + 5.2, [10.4, 0, 0], [0, 0.15, 0], [0, 0, 1.4], '#1e1626');
  // 塔（左は高く、右は低く少し傾く）
  for (const [tx, tz, r, h, lean] of [[x - 11.5, z + 2, 2.2, 21, 0], [x + 9, z + 3.5, 2.6, 15, 0.4]]) {
    b.tube([[tx, 0, tz, r, 0, 0, 0, 0, r], [tx + lean, h, tz, r, 0, 0, 0, 0, r]], 1, '#30243c', 8);
    b.lathe(tx + lean, h, tz, [[0, r + 0.7], [0.4, r + 0.5], [6.5, 0.05]], '#1e1626', 8);
    for (const wy of [h * 0.45, h * 0.75]) {
      b.box(tx + lean * (wy / h), wy, tz + r + 0.02, [0.45, 0, 0], [0, 0.8, 0], [0, 0, 0.08], '#ffc040');
      bulb(tx + lean * (wy / h), wy, tz + r + 0.4, '#ffb030');
    }
  }
  // 窓（いくつかは板でふさぐ）
  const win = (wx, wy, wz, lit) => {
    b.box(wx, wy, wz, [0.9, 0, 0], [0, 1.2, 0], [0, 0, 0.08], lit ? '#ffc040' : '#1a1420');
    b.box(wx, wy, wz + 0.05, [1.05, 0, 0], [0, 0.08, 0], [0, 0, 0.08], '#5a4630');
    if (lit) bulb(wx, wy, wz + 0.5, '#ffb030');
    else b.beam([wx - 0.9, wy - 0.8, wz + 0.1], [wx + 0.9, wy + 0.6, wz + 0.1], 0.1, 0.25, '#7a6040', [0, 0, 1]);
  };
  for (const [k, wx] of [-7.5, -4, 4, 7.5].entries()) {
    win(x + wx, 3.2, z + 6.02, k !== 2);
    win(x + wx, 7.6, z + 6.02, k !== 0);
  }
  for (const [k, wx] of [-6, -2, 2].entries()) win(x + wx, 12.8, z + 5.02, k !== 1);
  // 扉と階段
  b.box(x, 2.2, z + 6.05, [1.3, 0, 0], [0, 2.2, 0], [0, 0, 0.1], '#2a1a10');
  b.box(x, 0.2, z + 7.2, [2.4, 0, 0], [0, 0.2, 0], [0, 0, 1.2], '#4a4048');
  // 曲がった煙突
  b.beam([x + 2, 14, z - 2], [x + 2.6, 20, z - 2], 1.2, 1.2, '#4a3a48');
}
// 幽霊（白い布をかぶった形。ゆらゆら浮く）
function ghostMesh() {
  const b = new Builder();
  b.lathe(0, 0, 0, [[0, 0.95], [0.12, 0.8], [0.6, 0.72], [1.2, 0.7], [1.6, 0.62], [1.9, 0.42], [2.05, 0.18], [2.1, 0.02]], '#f4f4ff', 12);
  for (const sx of [0.22, -0.22]) b.box(sx, 1.55, 0.6, [0.08, 0, 0], [0, 0.13, 0], [0, 0, 0.06], '#1a1424');
  b.box(0, 1.22, 0.66, [0.12, 0, 0], [0, 0.1, 0], [0, 0, 0.05], '#1a1424');
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.85, emissive: '#3a3a52', side: THREE.DoubleSide });
  return new THREE.Mesh(b.geometry(), mat);
}
// もみの木：枝の段（下ほど広い円すい）を 4 段重ね、段のふちに雪。lit なら電飾の点
function firTree(b, glow, x, z, h, lit, seed, snow = true) {
  const r = mulberry(seed);
  b.cyl([x, 0, z], [x, h * 0.2, z], h * 0.05, '#5a3a22', 6);
  const tiers = 4;
  for (let k = 0; k < tiers; k++) {
    const y0 = h * (0.14 + k * 0.2);
    const w = h * (0.36 - k * 0.07);
    const th = h * 0.32;
    b.lathe(x, y0, z, [[0, w * 0.55], [0.06 * th, w], [0.22 * th, w * 0.85], [th, 0.02]], k % 2 ? '#2a6a3c' : '#24603a', 9);
    if (snow) b.lathe(x, y0 + 0.06 * th, z, [[0, w * 1.01], [0.05 * th, w * 0.9], [0.08 * th, w * 0.75]], '#f4f8fc', 9);
    if (lit) {
      for (let i = 0; i < 7; i++) {
        const a = r() * 6.28;
        const t = 0.1 + r() * 0.6;
        const rr = w * (1 - t) * 0.98 + 0.05;
        glow.p.push(x + Math.cos(a) * rr, y0 + th * t, z + Math.sin(a) * rr);
        const cc = col(['#ff4050', '#ffd040', '#40a0ff', '#ffffff', '#ff80c0'][i % 5]);
        glow.c.push(cc.r, cc.g, cc.b);
      }
    }
  }
  if (lit) {
    b.box(x, h * 0.96, z, [0.18, 0, 0], [0, 0.18, 0], [0, 0, 0.18], '#ffd040');
    glow.p.push(x, h * 0.96, z);
    glow.c.push(1, 0.85, 0.3);
  }
}
const PRESENT = [['#e8384f', '#f8d040'], ['#3a8ae8', '#ffffff'], ['#f8c030', '#e8384f'], ['#2a9a4a', '#ffffff'], ['#b060e0', '#f8d040']];
function present(b, p) {
  const [c, rb] = PRESENT[p.col];
  const s = p.s;
  const ca = Math.cos(p.rot);
  const sa = Math.sin(p.rot);
  const ax = [ca * s, 0, sa * s];
  const az = [-sa * s, 0, ca * s];
  b.box(p.x, s, p.z, ax, [0, s, 0], az, c);
  // リボン（十字）と、上の結び目
  b.box(p.x, s, p.z, ax.map((v) => v * 1.02), [0, s * 1.02, 0], az.map((v) => v * 0.18), rb);
  b.box(p.x, s, p.z, ax.map((v) => v * 0.18), [0, s * 1.02, 0], az.map((v) => v * 1.02), rb);
  b.box(p.x, s * 2.12, p.z, ax.map((v) => v * 0.35), [0, s * 0.12, 0], az.map((v) => v * 0.12), rb);
  b.box(p.x, s * 2.12, p.z, ax.map((v) => v * 0.12), [0, s * 0.12, 0], az.map((v) => v * 0.35), rb);
}
// 雪だるま：3 つの玉・炭の目・にんじんの鼻・バケツの帽子・マフラー・枝の腕。顔は rot の向き（+z 基準）
function snowman(b, m) {
  const { x, z, s } = m;
  const f = [Math.sin(m.rot), 0, Math.cos(m.rot)];
  const l = [Math.cos(m.rot), 0, -Math.sin(m.rot)];
  const ball = (y, r) => b.lathe(x, y - r, z, [[0, 0.05], [r * 0.3, r * 0.75], [r, r], [r * 1.7, r * 0.75], [r * 2, 0.05]].map(([h, rr]) => [h, rr]), '#f4f8fc', 10);
  ball(0.75 * s, 0.75 * s);
  ball(1.85 * s, 0.55 * s);
  ball(2.65 * s, 0.4 * s);
  const hy = 2.7 * s;
  const fr = 0.4 * s;
  const at = (side, y, out) => [x + f[0] * out + l[0] * side, y, z + f[2] * out + l[2] * side];
  for (const sd of [0.13, -0.13]) {
    const p = at(sd * s, hy + 0.08 * s, fr * 0.92);
    b.box(...p, [0.04 * s, 0, 0], [0, 0.04 * s, 0], [0, 0, 0.04 * s], '#1e1e22');
  }
  b.beam(at(0, hy - 0.03 * s, fr * 0.9), at(0, hy - 0.05 * s, fr + 0.3 * s), 0.08 * s, 0.08 * s, '#f07818');
  b.cyl([x, hy + 0.3 * s, z], [x, hy + 0.36 * s, z], 0.36 * s, '#3a3a44', 10);
  b.cyl([x, hy + 0.36 * s, z], [x, hy + 0.7 * s, z], 0.25 * s, '#4a4a56', 10);
  b.cyl([x, 2.2 * s, z], [x, 2.32 * s, z], 0.5 * s, '#e8384f', 10);
  b.beam(at(0.28 * s, 2.25 * s, 0.35 * s), at(0.4 * s, 1.8 * s, 0.55 * s), 0.1 * s, 0.04 * s, '#e8384f');
  for (const sd of [1, -1]) {
    const p0 = at(sd * 0.5 * s, 1.9 * s, 0);
    const p1 = at(sd * 1.25 * s, 2.3 * s, 0);
    b.beam(p0, p1, 0.05 * s, 0.05 * s, '#5a3a22');
    b.beam(p1, at(sd * 1.45 * s, 2.5 * s, 0.1 * s), 0.04 * s, 0.04 * s, '#5a3a22');
  }
  for (const y of [1.5, 1.2]) b.box(...at(0, y * s, 0.74 * s), [0.05 * s, 0, 0], [0, 0.05 * s, 0], [0, 0, 0.05 * s], '#1e1e22');
}
// キャンディケイン（赤白のしま。上で曲がる）
function candyCane(b, x, z, rot) {
  const H = 3.2;
  const n = 10;
  for (let i = 0; i < n; i++) b.cyl([x, (H * i) / n, z], [x, (H * (i + 1)) / n, z], 0.16, i % 2 ? '#ffffff' : '#e8384f', 8);
  const dx = Math.cos(rot);
  const dz = Math.sin(rot);
  let prev = [x, H, z];
  for (let k = 1; k <= 7; k++) {
    const a = (k / 7) * Math.PI * 1.05;
    const p = [x + dx * (1 - Math.cos(a)) * 0.6, H + Math.sin(a) * 0.6, z + dz * (1 - Math.cos(a)) * 0.6];
    b.cyl(prev, p, 0.16, k % 2 ? '#ffffff' : '#e8384f', 8);
    prev = p;
  }
}
// 大きなツリー（敷地の奥）。てっぺんに星、玉飾りと電飾
function giantTree(b, bulb, x, z) {
  const H = 30;
  b.cyl([x, 0, z], [x, 5, z], 1.4, '#5a3a22', 8);
  for (let k = 0; k < 6; k++) {
    const y0 = 3 + k * 4.2;
    const w = 11 - k * 1.7;
    b.lathe(x, y0, z, [[0, w * 0.55], [0.4, w], [1.4, w * 0.88], [7, 0.05]], k % 2 ? '#2a6a3c' : '#24603a', 14);
    b.lathe(x, y0 + 0.4, z, [[0, w * 1.01], [0.35, w * 0.9], [0.6, w * 0.75]], '#f4f8fc', 14);
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + k * 0.6;
      const t = 0.15 + (i % 3) * 0.2;
      const rr = w * (1 - t * 0.85);
      const c = ['#e8384f', '#f8c030', '#3a8ae8', '#ffffff', '#ff80c0'][(i + k) % 5];
      if (i % 2) b.box(x + Math.cos(a) * rr, y0 + 7 * t * 0.5, z + Math.sin(a) * rr, [0.35, 0, 0], [0, 0.35, 0], [0, 0, 0.35], c);
      else bulb(x + Math.cos(a) * (rr + 0.2), y0 + 7 * t * 0.5, z + Math.sin(a) * (rr + 0.2), c);
    }
  }
  // 星（5 本のとがりを板で）
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 + Math.PI / 2;
    b.beam([x, H + 1, z], [x + Math.cos(a) * 2.2, H + 1 + Math.sin(a) * 2.2, z], 0.9, 0.5, '#ffd040', [0, 0, 1]);
  }
  bulb(x, H + 1, z + 0.5, '#fff0a0');
  // 根もとのプレゼント
  for (const [dx, dz, s, ci] of [[4, 6, 0.9, 0], [-5, 5, 1.1, 1], [1, 8, 0.7, 2], [-2, 7.5, 0.8, 3], [6, 3, 0.7, 4]]) present(b, { x: x + dx, z: z + dz, s, rot: dx * 0.2, col: ci });
}
// サンタのそり（+x が前）。トナカイ 4 頭を前に並べる
function sleighMesh() {
  const b = new Builder();
  b.box(0, 0.9, 0, [1.4, 0, 0], [0, 0.55, 0], [0, 0, 0.8], '#d8283a');
  b.box(-1.1, 1.6, 0, [0.35, 0, 0], [0, 0.5, 0], [0, 0, 0.8], '#d8283a');
  for (const z of [0.6, -0.6]) {
    b.beam([-1.6, 0.15, z], [1.6, 0.15, z], 0.12, 0.12, '#f8c030');
    b.beam([1.6, 0.15, z], [2.0, 0.7, z], 0.12, 0.12, '#f8c030');
  }
  // サンタ（座って手を振る）と、白い袋
  b.box(-0.2, 1.8, 0, [0.35, 0, 0], [0, 0.45, 0], [0, 0, 0.45], '#d8283a');
  b.box(-0.2, 2.45, 0, [0.25, 0, 0], [0, 0.25, 0], [0, 0, 0.25], '#f2c9a0');
  b.box(0.06, 2.3, 0, [0.03, 0, 0], [0, 0.18, 0], [0, 0, 0.22], '#f8f8f8');
  b.box(-0.25, 2.8, 0, [0.25, 0, 0], [0, 0.12, 0], [0, 0, 0.25], '#d8283a');
  b.box(-0.6, 1.9, 0, [0.4, 0, 0], [0, 0.5, 0], [0, 0, 0.45], '#f0ece0');
  for (let k = 0; k < 4; k++) {
    const rx = 3.4 + (k >> 1) * 2.2;
    const rz = k % 2 ? 0.55 : -0.55;
    b.box(rx, 1.0, rz, [0.6, 0, 0], [0, 0.3, 0], [0, 0, 0.22], '#8a5a30');
    b.box(rx + 0.7, 1.45, rz, [0.2, 0, 0], [0, 0.2, 0], [0, 0, 0.16], '#8a5a30');
    for (const lx of [-0.4, 0.4]) b.beam([rx + lx, 0.75, rz], [rx + lx + 0.25, 0.25, rz], 0.08, 0.08, '#6a4220');
    b.beam([rx + 0.65, 1.65, rz], [rx + 0.5, 2.1, rz - 0.15], 0.05, 0.05, '#5a3a1a');
    b.beam([rx + 0.65, 1.65, rz], [rx + 0.5, 2.1, rz + 0.15], 0.05, 0.05, '#5a3a1a');
    if (k === 2 || k === 3) b.box(rx + 0.92, 1.42, rz, [0.05, 0, 0], [0, 0.06, 0], [0, 0, 0.06], '#ff2020');
  }
  b.beam([1.6, 1.0, 0.55], [3.0, 1.0, 0.55], 0.04, 0.04, '#f8c030');
  b.beam([1.6, 1.0, -0.55], [3.0, 1.0, -0.55], 0.04, 0.04, '#f8c030');
  return new THREE.Mesh(b.geometry(), VC);
}
// スケートをする人（立った姿。マフラーと帽子）
const SKATER = [['#e8384f', '#ffffff'], ['#2a8a3a', '#e8384f'], ['#3a6ad0', '#ffffff'], ['#f8c030', '#2a8a3a'], ['#ffffff', '#e8384f'], ['#8a5ad0', '#f8c030']];
function skaterMesh(ci) {
  const [c, sc] = SKATER[ci];
  const b = new Builder();
  b.box(0, 0.4, -0.1, [0.08, 0, 0], [0, 0.4, 0], [0, 0, 0.08], '#2a2a3a');
  b.box(0, 0.4, 0.1, [0.08, 0, 0], [0, 0.4, 0], [0, 0, 0.08], '#2a2a3a');
  for (const z of [-0.1, 0.1]) b.box(0.05, 0.02, z, [0.18, 0, 0], [0, 0.02, 0], [0, 0, 0.02], '#c8d0dc');
  b.box(0, 1.1, 0, [0.2, 0, 0], [0, 0.32, 0], [0, 0, 0.25], c);
  b.box(0, 1.62, 0, [0.16, 0, 0], [0, 0.18, 0], [0, 0, 0.16], '#f2c9a0');
  b.box(0, 1.84, 0, [0.17, 0, 0], [0, 0.07, 0], [0, 0, 0.17], sc);
  b.box(0, 1.4, 0, [0.22, 0, 0], [0, 0.05, 0], [0, 0, 0.27], sc);
  for (const z of [-0.36, 0.36]) b.beam([0, 1.35, z * 0.75], [-0.05, 1.05, z * 1.4], 0.1, 0.1, c);
  return new THREE.Mesh(b.geometry(), VC);
}
// クリスマス：もみの木・プレゼント・雪だるま・キャンディケイン・リンクで滑る人・空を飛ぶそり
function christmasProps(c, lay) {
  const { group, b, glow, avoid, anims, tr, mapId } = c;
  for (const t of lay.firs) {
    if (nearTrack(tr, t.x, t.z, t.h * 0.3 + 2)) continue;
    firTree(b, glow, t.x, t.z, t.h, t.lit, t.seed);
    avoid.push([t.x, t.z, t.h * 0.3]);
  }
  for (const p of lay.presents) {
    if (nearTrack(tr, p.x, p.z, 2)) continue;
    present(b, p);
    avoid.push([p.x, p.z, p.s * 1.2]);
  }
  for (const m of lay.snowmen) {
    if (nearTrack(tr, m.x, m.z, 2.5)) continue;
    snowman(b, m);
    avoid.push([m.x, m.z, 1.2]);
  }
  for (const k of lay.canes) {
    if (nearTrack(tr, k.x, k.z, 2)) continue;
    candyCane(b, k.x, k.z, k.rot);
    avoid.push([k.x, k.z, 0.6]);
  }
  // リンクのふちの柵（白）と、滑る人
  const pk = mapOf(mapId).ponds[0];
  for (let i = 0; i < 48; i++) {
    const a0 = (i / 48) * Math.PI * 2;
    const a1 = ((i + 1) / 48) * Math.PI * 2;
    const p0 = [pk.x + Math.cos(a0) * (pk.r + 0.5), pk.z + Math.sin(a0) * (pk.r + 0.5)];
    const p1 = [pk.x + Math.cos(a1) * (pk.r + 0.5), pk.z + Math.sin(a1) * (pk.r + 0.5)];
    if (nearTrack(tr, p0[0], p0[1], 2) || nearTrack(tr, p1[0], p1[1], 2)) continue;
    b.beam([p0[0], 0.45, p0[1]], [p1[0], 0.45, p1[1]], 0.12, 0.9, i % 2 ? '#e8384f' : '#ffffff');
  }
  for (const sk of lay.skaters) {
    const m = skaterMesh(sk.col);
    group.add(m);
    anims.push((t) => {
      const a = sk.ph + t * sk.sp;
      m.position.set(pk.x + Math.cos(a) * sk.r, 0.05, pk.z + Math.sin(a) * sk.r);
      m.rotation.y = -a - (sk.sp > 0 ? 0 : Math.PI);
      m.rotation.z = Math.sin(t * 3 + sk.ph) * 0.12;
    });
  }
  // 空を回るサンタのそり
  const sl = sleighMesh();
  sl.scale.setScalar(1.6);
  group.add(sl);
  anims.push((t) => {
    const a = t * 0.12;
    sl.position.set(Math.cos(a) * 85, 42 + Math.sin(t * 0.7) * 3, Math.sin(a) * 65 - 10);
    sl.rotation.y = -Math.atan2(Math.cos(a) * 65, -Math.sin(a) * 85);
  });
}
// 丸いかたまり（球に近い回転体）
function blob(b, x, y, z, r, color, seg = 7) {
  b.lathe(x, y - r, z, [[0, 0.04], [r * 0.3, r * 0.72], [r, r], [r * 1.7, r * 0.72], [r * 2, 0.04]], color, seg);
}
// ヤシの木：しなった幹（節の色を交互に）・垂れた葉・ヤシの実
function palmTree(b, x, z, h, rot, seed) {
  const r = mulberry(seed);
  const dx = Math.cos(rot);
  const dz = Math.sin(rot);
  const bend = 0.12 * h;
  const at = (t) => [x + dx * bend * t * t, h * t, z + dz * bend * t * t];
  for (let k = 0; k < 8; k++) {
    const a = at(k / 8);
    const c = at((k + 1) / 8);
    const rr = 0.32 - k * 0.02;
    b.tube([[...a, rr, 0, 0, 0, 0, rr], [...c, rr * 0.92, 0, 0, 0, 0, rr * 0.92]], 1, k % 2 ? '#8a6a44' : '#a07a50', 7);
  }
  const top = at(1);
  // 葉：細い葉を 10 枚。根もとから先へ細くしながら、3 つに折れて垂れる
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + r() * 0.3;
    const L = h * (0.34 + r() * 0.06);
    const pts = [top, [L * 0.4, L * 0.16], [L * 0.75, L * 0.04], [L, -L * 0.3]].map((q, k) => (k ? [top[0] + Math.cos(a) * q[0], top[1] + q[1], top[2] + Math.sin(a) * q[0]] : q));
    const g = i % 2 ? '#3a9a3a' : '#2e8a34';
    for (let k = 0; k < 3; k++) b.beam(pts[k], pts[k + 1], [0.55, 0.42, 0.22][k], 0.05, g);
  }
  for (let k = 0; k < 3; k++) blob(b, top[0] + Math.cos(k * 2.1) * 0.35, top[1] - 0.3, top[2] + Math.sin(k * 2.1) * 0.35, 0.22, '#6a4a22', 6);
}
// ちょうちん（赤い玉に黒い帯）。glow があれば明かりを足す
function lantern(b, glow, x, y, z, s) {
  b.lathe(x, y - s, z, [[0, s * 0.35], [0.2 * s, s * 0.8], [s, s], [1.8 * s, s * 0.8], [2 * s, s * 0.35]], '#e8384f', 8);
  b.lathe(x, y - s - 0.06, z, [[0, s * 0.38], [0.12, s * 0.38]], '#1e1e22', 8);
  b.lathe(x, y + s - 0.06, z, [[0, s * 0.38], [0.12, s * 0.38]], '#1e1e22', 8);
  if (glow) {
    glow.p.push(x, y, z);
    glow.c.push(1, 0.45, 0.3);
  }
}
// 屋台（正面は +z）。しまの日よけ・カウンター・のれん・ちょうちん
const STALL = [['#e8384f', '#ffffff'], ['#3a8ae8', '#ffffff'], ['#f8a020', '#ffffff'], ['#2aa070', '#ffffff']];
function yatai(b, glow, q, summer) {
  const { x, z } = q;
  const f = q.fz || 1; // 正面の向き（+z なら 1、-z なら -1）
  const [c1, c2] = STALL[q.col];
  const W = 2.6;
  for (const sx of [-W, W]) for (const sz of [-1.3, 1.3]) b.beam([x + sx, 0, z + sz], [x + sx, 2.6, z + sz], 0.14, 0.14, '#8a6a44');
  b.box(x, 0.55, z + f * 1.0, [W, 0, 0], [0, 0.55, 0], [0, 0, 0.3], '#a07a50'); // カウンター
  b.box(x, 1.12, z + f * 1.0, [W + 0.1, 0, 0], [0, 0.04, 0], [0, 0, 0.4], '#c8a070');
  b.box(x, 1.3, z - f * 1.3, [W, 0, 0], [0, 1.3, 0], [0, 0, 0.06], '#d8c8a8'); // 奥の板
  // 日よけ（しま）を前へ傾ける
  const n = 8;
  for (let k = 0; k < n; k++) {
    const sx = x - W + ((k + 0.5) * 2 * W) / n;
    b.box(sx, 2.75, z + f * 0.4, [W / n, 0, 0], [0, 0.18, -0.4 * f], [0, 0.06, 0.02], k % 2 ? c2 : c1);
    b.box(sx, 2.35, z + f * 1.95, [W / n, 0, 0], [0, 0.2, 0], [0, 0, 0.03], k % 2 ? c1 : c2); // のれん
  }
  b.box(x, 2.6, z - f * 0.4, [W + 0.2, 0, 0], [0, 0.06, 0], [0, 0, 1.5], c1); // 屋根
  // 品物（かき氷の山・焼きそばの鉄板・わたあめ）
  if (summer && q.col % 2) for (let k = 0; k < 4; k++) blob(b, x - 1.8 + k * 1.2, 1.35, z + f * 0.9, 0.22, ['#ff5a7a', '#5ac8ff', '#ffe060', '#7ae07a'][k], 6);
  else if (q.col === 2) b.box(x, 1.2, z + f * 0.85, [1.6, 0, 0], [0, 0.04, 0], [0, 0, 0.35], '#3a3a40');
  else for (let k = 0; k < 3; k++) blob(b, x - 1.4 + k * 1.4, 1.75, z + f * 0.9, 0.35, ['#ffd0e8', '#ffffff', '#d0e8ff'][k], 7);
  for (const sx of [-W, W]) lantern(b, glow, x + sx, 2.2, z + f * 1.6, 0.3);
}
// ウォータースライダー（敷地の奥のやぐらから、らせんでプールへ）
function waterSlide(b, bulb, x, z) {
  const H = 16;
  for (const [sx, sz] of [[-2.5, -2.5], [2.5, -2.5], [-2.5, 2.5], [2.5, 2.5]]) b.beam([x + sx, 0, z + sz], [x + sx, H, z + sz], 0.4, 0.4, '#f0f0f4');
  for (let y = 4; y <= H; y += 4) {
    b.beam([x - 2.5, y, z - 2.5], [x + 2.5, y, z - 2.5], 0.25, 0.25, '#f0f0f4');
    b.beam([x - 2.5, y, z + 2.5], [x + 2.5, y, z + 2.5], 0.25, 0.25, '#f0f0f4');
  }
  b.box(x, H, z, [3.2, 0, 0], [0, 0.2, 0], [0, 0, 3.2], '#3a8ae8');
  b.box(x, H + 2.6, z, [3.4, 0, 0], [0, 0.15, 0], [0, 0, 3.4], '#f8d040');
  for (const [sx, sz] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) b.beam([x + sx, H, z + sz], [x + sx, H + 2.6, z + sz], 0.15, 0.15, '#f0f0f4');
  // らせんの黄色い管と、まっすぐ降りる青い管。どちらもプール（+z）の手前に出る
  const path = (pts, color) => {
    const rings = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)];
      const c = pts[Math.min(pts.length - 1, i + 1)];
      const t = norm([c[0] - a[0], c[1] - a[1], c[2] - a[2]]);
      let sd = cross(t, [0, 1, 0]);
      sd = norm(Math.hypot(...sd) < 0.1 ? [1, 0, 0] : sd);
      const u = cross(sd, t);
      rings.push([...pts[i], ...u, ...sd]);
    }
    b.tube(rings, 0.75, color, 8);
  };
  const sp = [];
  for (let k = 0; k <= 40; k++) {
    const a = (k / 40) * Math.PI * 3.2 - Math.PI / 2;
    sp.push([x + Math.cos(a) * 6, H - (k / 40) * (H - 3), z + Math.sin(a) * 6]);
  }
  const e = sp[sp.length - 1];
  for (let k = 1; k <= 10; k++) sp.push([e[0] + ((x - 6 - e[0]) * k) / 10, 3 - k * 0.25, e[2] + ((z + 27 - e[2]) * k) / 10]);
  path(sp, '#f8c030');
  const st = [];
  for (let k = 0; k <= 20; k++) {
    const t = k / 20;
    st.push([x + 3 + t * 4, H - Math.sin(t * Math.PI / 2) * (H - 1), z + 3 + t * 24]);
  }
  path(st, '#3aa0ff');
  for (let y = 4; y <= H; y += 3) bulb(x + 3.3, y, z + 3.3, '#ffe080');
}
// 浮き輪（輪の管）とビーチボール
const FLOAT = ['#ff5a7a', '#ffd040', '#40c0ff', '#7ae07a', '#ff9a30'];
function floatMesh(f) {
  const b = new Builder();
  if (f.ball) {
    blob(b, 0, 0.35, 0, 0.4, FLOAT[f.col], 8);
    b.lathe(0, 0.3, 0, [[0, 0.405], [0.1, 0.405]], '#ffffff', 8);
  } else {
    const rings = [];
    for (let k = 0; k <= 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      rings.push([Math.cos(a) * 0.7, 0.15, Math.sin(a) * 0.7, Math.cos(a), 0, Math.sin(a), 0, 1, 0]);
    }
    b.tube(rings, 0.28, FLOAT[f.col], 8);
    if (f.swim) {
      b.box(0, 0.45, 0, [0.16, 0, 0], [0, 0.18, 0], [0, 0, 0.16], '#f2c9a0');
      b.box(0, 0.62, 0, [0.17, 0, 0], [0, 0.05, 0], [0, 0, 0.17], '#2a1f17');
      for (const sz of [-0.1, 0.1]) b.box(0.165, 0.5, sz, [0.01, 0, 0], [0, 0.04, 0], [0, 0, 0.05], '#1e1e22');
    }
  }
  return new THREE.Mesh(b.geometry(), VC);
}
// パラソルとデッキチェア（チェアは rot の向き）
function parasol(b, q) {
  const [c] = STALL[q.col];
  b.cyl([q.x, 0, q.z], [q.x, 2.6, q.z], 0.06, '#e8e8e8', 5);
  for (let k = 0; k < 8; k++) {
    const a0 = (k / 8) * Math.PI * 2;
    const a1 = ((k + 1) / 8) * Math.PI * 2;
    const R = 1.8;
    const p0 = [q.x + Math.cos(a0) * R, 2.15, q.z + Math.sin(a0) * R];
    const p1 = [q.x + Math.cos(a1) * R, 2.15, q.z + Math.sin(a1) * R];
    const top = [q.x, 2.75, q.z];
    // 三角の布を、細い板 2 枚で近似する
    const mid = [(p0[0] + p1[0]) / 2, 2.15, (p0[2] + p1[2]) / 2];
    b.beam(top, mid, R * 0.75, 0.05, k % 2 ? '#ffffff' : c, [0, 1, 0]);
  }
  const ca = Math.cos(q.rot);
  const sa = Math.sin(q.rot);
  const ox = q.x + ca * 1.6;
  const oz = q.z + sa * 1.6;
  b.beam([ox - ca * 0.9, 0.35, oz - sa * 0.9], [ox + ca * 0.4, 0.35, oz + sa * 0.4], 0.6, 0.08, '#ffffff');
  b.beam([ox - ca * 0.9, 0.35, oz - sa * 0.9], [ox - ca * 1.3, 1.0, oz - sa * 1.3], 0.6, 0.08, '#ffffff');
  b.box(ox - ca * 0.3, 0.42, oz - sa * 0.3, [ca * 0.55, 0, sa * 0.55], [0, 0.03, 0], [-sa * 0.28, 0, ca * 0.28], c);
}
// 夏のプールと花火
function summerProps(c, lay) {
  const { group, b, glow, avoid, anims, tr } = c;
  for (const t of lay.palms) {
    if (nearTrack(tr, t.x, t.z, 4)) continue;
    palmTree(b, t.x, t.z, t.h, t.rot, t.seed);
    avoid.push([t.x, t.z, 0.8]);
  }
  for (const q of lay.parasols) {
    if (nearTrack(tr, q.x, q.z, 3.5)) continue;
    parasol(b, q);
    avoid.push([q.x, q.z, 2]);
  }
  for (const q of lay.stalls) {
    if (nearTrack(tr, q.x, q.z, 4.5)) continue;
    yatai(b, glow, q, true);
    avoid.push([q.x, q.z, 3]);
  }
  // 浮き輪（ぷかぷか）
  for (const f of lay.floats) {
    const m = floatMesh(f);
    group.add(m);
    anims.push((t) => {
      m.position.set(f.x + Math.sin(t * 0.3 + f.ph) * 1.5, 0.05 + Math.sin(t * 1.6 + f.ph) * 0.08, f.z + Math.cos(t * 0.25 + f.ph) * 1.2);
      m.rotation.set(Math.sin(t * 1.2 + f.ph) * 0.08, t * 0.2 + f.ph, Math.cos(t * 1.4 + f.ph) * 0.08);
    });
  }
  // 花火：敷地の奥とまわりの空で、ときどき開く。1 発 100 粒、重力で垂れて消える
  {
    const MAXP = 900;
    const pos = new Float32Array(MAXP * 3).fill(-999);
    const colr = new Float32Array(MAXP * 3);
    const vel = new Float32Array(MAXP * 3);
    const life = new Float32Array(MAXP);
    const base = new Float32Array(MAXP * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(colr, 3).setUsage(THREE.DynamicDrawUsage));
    const pts = new THREE.Points(geo, glowMat(4.2));
    pts.frustumCulled = false;
    group.add(pts);
    const r = mulberry(99);
    const COL = [[1, 0.35, 0.45], [1, 0.8, 0.3], [0.4, 0.8, 1], [0.5, 1, 0.5], [1, 0.55, 1], [1, 1, 1]];
    let next = 0;
    let head = 0;
    anims.push((t, dt) => {
      if (t >= next) {
        next = t + 0.5 + r() * 0.9;
        const a = r() * Math.PI - Math.PI;
        const cx = Math.cos(a) * (70 + r() * 25);
        const cz = Math.sin(a) * (55 + r() * 25) - 15;
        const cy = 45 + r() * 25;
        const col = COL[Math.floor(r() * COL.length)];
        const sp = 11 + r() * 7;
        for (let k = 0; k < 100; k++) {
          const i = head;
          head = (head + 1) % MAXP;
          const u = r() * 2 - 1;
          const ph = r() * 6.28;
          const q = Math.sqrt(1 - u * u);
          pos.set([cx, cy, cz], i * 3);
          vel.set([q * Math.cos(ph) * sp, u * sp, q * Math.sin(ph) * sp], i * 3);
          base.set(col, i * 3);
          life[i] = 1;
        }
      }
      for (let i = 0; i < MAXP; i++) {
        if (life[i] <= 0) continue;
        life[i] -= dt * 0.55;
        const k = i * 3;
        vel[k + 1] -= 3 * dt;
        for (let j = 0; j < 3; j++) {
          vel[k + j] *= 1 - dt * 0.9;
          pos[k + j] += vel[k + j] * dt;
        }
        const f = Math.max(0, life[i]);
        colr[k] = base[k] * f;
        colr[k + 1] = base[k + 1] * f;
        colr[k + 2] = base[k + 2] * f;
        if (life[i] <= 0) pos[k + 1] = -999;
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.color.needsUpdate = true;
    });
  }
}
// 線路のそば（上から見て m 以内）か
function nearTrack(tr, x, z, m) {
  if (!tr) return false;
  for (let i = 0; i < tr.n; i += 2) if (Math.abs(tr.px[i] - x) < m && Math.abs(tr.pz[i] - z) < m) return true;
  return false;
}
// テーマの飾り（線路ごとに作り直す。線路のそばの物は置かない）。
// 返り値：{ group, update(dt), avoid：観客を立たせない丸 [[x, z, r]...] }。飾りの無いテーマは null
export function buildTheme(sceneId, mapId, tr) {
  const lay = themeLayout(mapId);
  if (!lay) return null;
  const c = { group: new THREE.Group(), b: new Builder(), glow: { p: [], c: [] }, avoid: [], anims: [], tr, mapId, S0: SCENES[sceneId] || SCENES.day };
  ({ halloween: halloweenProps, xmas: christmasProps, summer: summerProps })[mapOf(mapId).id](c, lay);
  c.group.add(new THREE.Mesh(c.b.geometry(), VC));
  if (c.glow.p.length) c.group.add(glowPoints(c.glow.p, c.glow.c, 0.5));
  let time = 0;
  const update = (dt) => {
    time += dt;
    for (const f of c.anims) f(time, dt);
  };
  update(0);
  return { group: c.group, update, avoid: c.avoid };
}
// ハロウィン：枯れ木・かぼちゃ・墓地と柵・幽霊・沼の泡・葦・コウモリ
function halloweenProps(c, lay) {
  const { group, b, glow, avoid, anims, tr, mapId } = c;
  for (const t of lay.deadTrees) {
    if (nearTrack(tr, t.x, t.z, t.h * 0.72 + 1.5)) continue;
    deadTree(b, t.x, t.z, t.h, t.rot, t.seed);
    avoid.push([t.x, t.z, 1]);
  }
  for (const p of lay.pumpkins) {
    if (nearTrack(tr, p.x, p.z, p.s + 2)) continue;
    // 顔は駅の前（観客のいる手前）に向ける
    pumpkin(b, glow, p.x, p.z, p.s, p.big ? Math.PI / 2 : Math.atan2(STATION.z + 30 - p.z, -p.x * 0.3) + (p.rot - 3) * 0.15);
    avoid.push([p.x, p.z, p.s * 0.7 + 0.4]);
  }
  for (const g of lay.graves) {
    if (nearTrack(tr, g.x, g.z, 2.5)) continue;
    grave(b, g);
    avoid.push([g.x, g.z + 0.5, 1.3]);
  }
  // 墓地の鉄の柵（手前のまん中は門としてあける）。線路のそばは切る
  const Y = lay.yard;
  const posts = [];
  const side = (x0, z0, x1, z1) => {
    const n = Math.round(Math.hypot(x1 - x0, z1 - z0) / 2);
    const row = [];
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n;
      const z = z0 + ((z1 - z0) * i) / n;
      const gate = z === Y.z1 && Math.abs(x - (Y.x0 + Y.x1) / 2) < 2.5;
      row.push(gate || nearTrack(tr, x, z, 2.5) ? null : [x, z]);
    }
    posts.push(row);
  };
  side(Y.x0, Y.z0, Y.x1, Y.z0);
  side(Y.x1, Y.z0, Y.x1, Y.z1);
  side(Y.x1, Y.z1, Y.x0, Y.z1);
  side(Y.x0, Y.z1, Y.x0, Y.z0);
  for (const row of posts) {
    for (let i = 0; i < row.length; i++) {
      const q = row[i];
      if (!q) continue;
      b.beam([q[0], 0, q[1]], [q[0], 1.7, q[1]], 0.1, 0.1, '#26222c');
      b.lathe(q[0], 1.7, q[1], [[0, 0.09], [0.25, 0.01]], '#26222c', 4);
      const n = row[i + 1];
      if (n) for (const y of [0.45, 1.45]) b.beam([q[0], y, q[1]], [n[0], y, n[1]], 0.06, 0.06, '#26222c');
    }
  }
  // 墓地の門柱にランタン
  for (const sx of [-2.6, 2.6]) {
    const gx = (Y.x0 + Y.x1) / 2 + sx;
    if (nearTrack(tr, gx, Y.z1, 2.5)) continue;
    b.box(gx, 1.1, Y.z1, [0.3, 0, 0], [0, 1.1, 0], [0, 0, 0.3], '#4a4450');
    b.box(gx, 2.45, Y.z1, [0.18, 0, 0], [0, 0.25, 0], [0, 0, 0.18], '#ffb030');
  }
  // 沼のふちの葦（がま）と、沈みかけの切り株
  {
    const pk = mapOf(mapId).ponds[0];
    const r = mulberry(29);
    for (let i = 0; pk && i < 70; i++) {
      const a = r() * 6.28;
      const d = pk.r + 0.3 + (r() - 0.6) * 1.6;
      const x = pk.x + Math.cos(a) * d;
      const z = pk.z + Math.sin(a) * d;
      if (r() < 0.35 || nearTrack(tr, x, z, 2)) continue;
      const h = 0.9 + r() * 0.9;
      const lx = (r() - 0.5) * 0.4;
      const lz = (r() - 0.5) * 0.4;
      b.beam([x, 0, z], [x + lx, h, z + lz], 0.06, 0.06, '#2c3a22');
      if (r() < 0.5) b.box(x + lx, h - 0.15, z + lz, [0.07, 0, 0], [0, 0.17, 0], [0, 0, 0.07], '#5a3a22');
    }
    for (const [dx, dz, h] of pk ? [[3, -2, 0.7], [-4, 3, 0.5], [1, 5, 0.9]] : []) {
      const x = pk.x + dx;
      const z = pk.z + dz;
      if (nearTrack(tr, x, z, 2)) continue;
      b.cyl([x, -0.2, z], [x, h, z], 0.45, '#3a2f2b', 7);
      b.beam([x, h * 0.6, z], [x + 0.9, h + 0.5, z + 0.3], 0.12, 0.12, '#3a2f2b');
    }
  }
  // 幽霊（墓地の上をゆらゆら）
  for (const gh of lay.ghosts) {
    const m = ghostMesh();
    m.position.set(gh.x, gh.y, gh.z);
    group.add(m);
    anims.push((t) => {
      m.position.set(gh.x + Math.sin(t * 0.4 + gh.ph) * 3, gh.y + Math.sin(t * 1.3 + gh.ph) * 0.5, gh.z + Math.cos(t * 0.3 + gh.ph) * 2);
      m.rotation.y = Math.sin(t * 0.5 + gh.ph) * 0.6;
      m.rotation.z = Math.sin(t * 1.1 + gh.ph) * 0.08;
    });
  }
  // 沼の泡（緑に光って浮かんでは消える）
  const M = mapOf(mapId);
  if (M.ponds.length) {
    const r = mulberry(17);
    const n = 40;
    const pos = new Float32Array(n * 3);
    const colr = new Float32Array(n * 3);
    const life = [];
    const pk = M.ponds[0];
    const reset = (i, y) => {
      const a = r() * 6.28;
      const d = Math.sqrt(r()) * pk.r * 0.85;
      pos[i * 3] = pk.x + Math.cos(a) * d;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = pk.z + Math.sin(a) * d;
    };
    for (let i = 0; i < n; i++) {
      reset(i, r() * 1.2);
      colr.set([0.35, 0.9, 0.2], i * 3);
      life.push(0.4 + r() * 0.5);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(colr, 3));
    const pts = new THREE.Points(geo, glowMat(0.7));
    pts.frustumCulled = false;
    group.add(pts);
    anims.push((t, dt) => {
      for (let i = 0; i < n; i++) {
        pos[i * 3 + 1] += dt * life[i];
        if (pos[i * 3 + 1] > 1.2) reset(i, 0);
      }
      geo.attributes.position.needsUpdate = true;
    });
  }
  // コウモリ（3 つの群れが敷地の上を回る）。体と翼を InstancedMesh にし、翼は羽ばたく
  {
    const flocks = [[-30, 22, -10, 22], [30, 28, 10, 18], [0, 18, -30, 30]];
    const per = 7;
    const n = flocks.length * per;
    const bb = new Builder();
    bb.box(0, 0, 0, [0.12, 0, 0], [0, 0.1, 0], [0, 0, 0.22], '#1a1020');
    bb.box(0, 0.12, 0.16, [0.05, 0, 0], [0, 0.07, 0], [0, 0, 0.02], '#1a1020');
    const wb = new Builder();
    wb.box(0.38, 0, 0, [0.3, 0, 0], [0, 0.015, 0], [0, 0, 0.16], '#1a1020');
    wb.box(0.72, 0, -0.06, [0.14, 0, 0], [0, 0.015, 0], [0, 0, 0.1], '#1a1020');
    const wmat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    const body = new THREE.InstancedMesh(bb.geometry(), VC, n);
    const wing = new THREE.InstancedMesh(wb.geometry(), wmat, n * 2);
    for (const im of [body, wing]) {
      im.frustumCulled = false;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    }
    group.add(body, wing);
    const m4 = new THREE.Matrix4();
    const qh = new THREE.Quaternion();
    const qf = new THREE.Quaternion();
    const qy = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
    const ez = new THREE.Vector3(0, 0, 1);
    const ey = new THREE.Vector3(0, 1, 0);
    const v = new THREE.Vector3();
    const one = new THREE.Vector3(1.4, 1.4, 1.4);
    const qq = new THREE.Quaternion();
    anims.push((t) => {
      for (let f = 0; f < flocks.length; f++) {
        const [cx, cy, cz, R] = flocks[f];
        for (let k = 0; k < per; k++) {
          const i = f * per + k;
          const sp = (f % 2 ? -1 : 1) * (0.25 + k * 0.012);
          const a = t * sp + k * 0.55 + f * 2;
          const rr = R + Math.sin(k * 1.7 + t * 0.3) * 4;
          v.set(cx + Math.cos(a) * rr, cy + Math.sin(t * 1.3 + k) * 1.5 + (k % 3), cz + Math.sin(a) * rr);
          qh.setFromAxisAngle(ey, Math.atan2(-Math.sin(a) * sp, Math.cos(a) * sp));
          m4.compose(v, qh, one);
          body.setMatrixAt(i, m4);
          const flap = Math.sin(t * 16 + k * 1.3) * 0.75;
          qf.setFromAxisAngle(ez, flap);
          qq.copy(qh).multiply(qf);
          m4.compose(v, qq, one);
          wing.setMatrixAt(i * 2, m4);
          qq.copy(qh).multiply(qy).multiply(qf);
          m4.compose(v, qq, one);
          wing.setMatrixAt(i * 2 + 1, m4);
        }
      }
      body.instanceMatrix.needsUpdate = true;
      wing.instanceMatrix.needsUpdate = true;
    });
  }
}
export function buildPark(sceneId = 'day', mapId = 0) {
  const S0 = SCENES[sceneId] || SCENES.day;
  const M = mapOf(mapId);
  const g = new THREE.Group();
  // 地面：芝（刈り目のしま）・駅前の広場・園路
  // 拡張版では敷地に合わせて地面を広げる。テクスチャ解像度は端末負荷を抑えて固定に近づける。
  const S = Math.max(320, Math.ceil(Math.max(FIELD.x1 - FIELD.x0, FIELD.z1 - FIELD.z0) + 80));
  const PX = S > 500 ? 0.75 : 3; // 1m あたりのピクセル
  const tex = canvasTex(S * PX / 2, S * PX / 2, (x, w, h) => {
    const k = w / S;
    x.fillStyle = S0.grass[0];
    x.fillRect(0, 0, w, h);
    for (let i = 0; i < S; i += 8) {
      x.fillStyle = i % 16 ? S0.grass[1] : S0.grass[2];
      x.fillRect(0, i * k, w, 8 * k);
    }
    // 敷地（少し明るい芝）
    const fx = (v) => (v + S / 2) * k;
    x.fillStyle = 'rgba(255,255,255,0.06)';
    x.fillRect(fx(FIELD.x0), fx(FIELD.z0), (FIELD.x1 - FIELD.x0) * k, (FIELD.z1 - FIELD.z0) * k);
    // 駅前の広場
    x.fillStyle = S0.path;
    x.fillRect(fx(STATION.x0 - 8), fx(STATION.z + 3), (STATION.x1 - STATION.x0 + 16) * k, 9 * k);
    x.fillRect(fx(-3), fx(STATION.z + 3), 6 * k, (S / 2 - STATION.z) * k);
    // 外周の園路
    x.strokeStyle = S0.path;
    x.lineWidth = 5 * k;
    x.strokeRect(fx(FIELD.x0 - 6), fx(FIELD.z0 - 6), (FIELD.x1 - FIELD.x0 + 12) * k, (FIELD.z1 - FIELD.z0 + 12) * k);
    // 花壇の点々
    for (let i = 0; S0.flowers && i < 400; i++) {
      x.fillStyle = ['#f06080', '#f8d040', '#ffffff', '#b070e0'][i % 4];
      const a = (i * 137.5 * Math.PI) / 180;
      const r = 90 + (i % 7) * 6;
      x.fillRect(w / 2 + Math.cos(a) * r * k, h / 2 + Math.sin(a) * r * k * 0.8, 2, 2);
    }
  });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(S, S), new THREE.MeshLambertMaterial({ map: tex }));
  ground.rotation.x = -Math.PI / 2;
  g.add(ground);
  // 池（雪の日は凍っている）。岸を先に低く敷き、水を上に重ねる（岸が水の上に出ないように）
  const waterMat = new THREE.MeshLambertMaterial({ color: S0.water[0], emissive: S0.water[1] });
  const rimMat = new THREE.MeshLambertMaterial({ color: S0.rim });
  const flat = (geo, mat, x, y, z) => {
    const m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, y, z);
    g.add(m);
  };
  for (const p of M.ponds) {
    flat(new THREE.CircleGeometry(p.r + 1, 48), rimMat, p.x, 0.03, p.z);
    flat(new THREE.CircleGeometry(p.r, 48), waterMat, p.x, 0.05, p.z);
  }
  // 木・生け垣・遠くの観覧車と山（1 つにまとめる）
  const b = new Builder();
  const rnd = mulberry(7);
  const trees = [];
  const tg = { p: [], c: [] }; // 外周のもみの木の電飾
  for (let i = 0; i < 90; i++) {
    const a = rnd() * Math.PI * 2;
    const rx = 82 + rnd() * 50;
    const rz = 60 + rnd() * 40;
    const x = Math.cos(a) * rx;
    const z = Math.sin(a) * rz;
    if (!inWater(mapId, x, z, 3)) trees.push([x, z]);
  }
  for (const [x, z] of trees) {
    const h = 4 + rnd() * 4;
    if (S0.deadTrees) deadTree(b, x, z, h + 2, rnd() * 6.28, Math.floor(rnd() * 1e6));
    else if (S0.firTrees) firTree(b, tg, x, z, h + 3, rnd() < 0.3, Math.floor(rnd() * 1e6));
    else if (S0.palmTrees) palmTree(b, x, z, h + 3, rnd() * 6.28, Math.floor(rnd() * 1e6));
    else tree(b, x, z, h, S0.crowns[Math.floor(rnd() * 4)], S0.snowCap);
  }
  // 生け垣（敷地のまわり。駅の前はあける）
  const hl = { p: [], c: [] };
  const hedge1 = (x0, z0, x1, z1) => {
    b.beam([x0, 0.5, z0], [x1, 0.5, z1], 1.0, 1.0, S0.hedge);
    // 生け垣の上の電飾（ハロウィン）
    if (S0.hedgeLights) {
      const n = Math.floor(Math.hypot(x1 - x0, z1 - z0) / 2.5);
      for (let i = 0; i <= n; i++) {
        const cc = col(S0.hedgeLights[i % S0.hedgeLights.length]);
        hl.p.push(x0 + ((x1 - x0) * i) / Math.max(1, n), 1.15, z0 + ((z1 - z0) * i) / Math.max(1, n));
        hl.c.push(cc.r, cc.g, cc.b);
      }
    }
    if (S0.snowCap) b.beam([x0, 1.05, z0], [x1, 1.05, z1], 1.1, 0.12, '#f6f8fc');
  };
  // 水にかかる所は切る
  const hedge = (x0, z0, x1, z1) => {
    const n = Math.ceil(Math.hypot(x1 - x0, z1 - z0));
    let from = -1;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const wet = i < n && inWater(mapId, x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, 1.5);
      if (!wet && from < 0) from = i;
      if ((wet || i === n) && from >= 0) {
        const ta = from / n;
        if (i - from >= 1) hedge1(x0 + (x1 - x0) * ta, z0 + (z1 - z0) * ta, x0 + (x1 - x0) * t, z0 + (z1 - z0) * t);
        from = -1;
      }
    }
  };
  const ex = FIELD.x1 + 4;
  const ez = FIELD.z1 + 4;
  hedge(-ex, -ez, ex, -ez);
  hedge(-ex, -ez, -ex, ez);
  hedge(ex, -ez, ex, ez);
  hedge(-ex, ez, -12, ez);
  hedge(12, ez, ex, ez);
  // 観覧車（遠景）
  const fw = [-110, 0, -95];
  const R = 22;
  b.beam([fw[0] - 8, 0, fw[2]], [fw[0], R + 3, fw[2]], 1, 1, '#d8d8e0');
  b.beam([fw[0] + 8, 0, fw[2]], [fw[0], R + 3, fw[2]], 1, 1, '#d8d8e0');
  const cx = fw[0];
  const cy = R + 3;
  const lp = [];
  const lc = [];
  const bulb = (x, y, z, c) => {
    lp.push(x, y, z);
    const cc = col(c);
    lc.push(cc.r, cc.g, cc.b);
  };
  for (let k = 0; k < 24; k++) {
    const a0 = (k / 24) * Math.PI * 2;
    const a1 = ((k + 1) / 24) * Math.PI * 2;
    b.beam([cx + Math.cos(a0) * R, cy + Math.sin(a0) * R, fw[2]], [cx + Math.cos(a1) * R, cy + Math.sin(a1) * R, fw[2]], 0.5, 0.5, '#f0f0f4');
    const gc = (S0.wheel || ['#e84a5f', '#f8b800', '#3aa0ff', '#5ac85a', '#b070e0', '#ff8a3a'])[k % 6];
    if (k % 2 === 0) {
      b.beam([cx, cy, fw[2]], [cx + Math.cos(a0) * R, cy + Math.sin(a0) * R, fw[2]], 0.25, 0.25, '#e0e0e8');
      b.box(cx + Math.cos(a0) * R, cy + Math.sin(a0) * R - 1.6, fw[2], [1.1, 0, 0], [0, 1.2, 0], [0, 0, 1.1], gc);
    }
    // 夜：輪のふちと、輪の内側にも電球（観覧車より手前に 1 m 出す）
    for (let q = 0; q < 2; q++) {
      const a = a0 + (q / 2) * (a1 - a0);
      bulb(cx + Math.cos(a) * R, cy + Math.sin(a) * R, fw[2] + 1, gc);
      bulb(cx + Math.cos(a) * R * 0.5, cy + Math.sin(a) * R * 0.5, fw[2] + 1, '#fff2c0');
    }
  }
  // 遠くの建物（メリーゴーラウンドの屋根・売店）
  const roofs = S0.roofs || ['#e84a5f', '#f8b800', '#3aa0ff', '#b070e0'];
  for (const [x, z, c] of [[100, -90, roofs[0]], [120, -40, roofs[1]], [-130, 30, roofs[2]], [95, 75, roofs[3]]]) {
    b.cyl([x, 0, z], [x, 6, z], 6, '#f4ecd8', 10);
    b.beam([x, 6, z], [x, 9.5, z], 13, 3.5, c);
    if (S0.snowCap) b.beam([x, 9.45, z], [x, 9.7, z], 13.3, 3.7, '#f6f8fc');
    // 夜：屋根のふちに電球
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      bulb(x + Math.cos(a) * 7.2, 6.3, z + Math.sin(a) * 7.2, k % 2 ? '#fff2c0' : c);
    }
  }
  // お化け屋敷（ハロウィン。敷地の奥）
  if (M.id === 'halloween') hauntedHouse(b, 14, -84, bulb);
  if (M.id === 'xmas') giantTree(b, bulb, 0, -82);

  if (M.id === 'summer') waterSlide(b, bulb, -44, -72);
  // プール（四角）：まわりのデッキ・水・コースロープ・はしご
  for (const q of M.pools || []) {
    b.box((q.x0 + q.x1) / 2, 0.06, (q.z0 + q.z1) / 2, [(q.x1 - q.x0) / 2 + 3, 0, 0], [0, 0.06, 0], [0, 0, (q.z1 - q.z0) / 2 + 3], '#e8e4d8');
    const pw = new THREE.Mesh(new THREE.PlaneGeometry(q.x1 - q.x0, q.z1 - q.z0), waterMat);
    pw.rotation.x = -Math.PI / 2;
    pw.position.set((q.x0 + q.x1) / 2, 0.14, (q.z0 + q.z1) / 2);
    g.add(pw);
    for (let z = q.z0 + 4; z < q.z1 - 1; z += 4.5) {
      for (let x = q.x0; x < q.x1; x += 1) b.box(x + 0.5, 0.2, z, [0.45, 0, 0], [0, 0.08, 0], [0, 0, 0.08], Math.floor(x) % 4 < 2 ? '#e8384f' : '#ffffff');
    }
    for (const lx of [q.x0 + 4, q.x1 - 4]) for (const dz of [-0.4, 0.4]) b.beam([lx + dz, 0.14, q.z1 + 0.3], [lx + dz, 1.2, q.z1 + 0.3], 0.07, 0.07, '#d8d8e0');
    for (let k = 0; k < 8; k++) {
      // 水の中の明かり（夜）
      lp.push(q.x0 + 2 + (k % 4) * ((q.x1 - q.x0 - 4) / 3), 0.16, k < 4 ? q.z0 + 0.5 : q.z1 - 0.5);
      lc.push(0.4, 0.9, 1);
    }
  }
  const deco = new THREE.Mesh(b.geometry(), VC);
  g.add(deco);
  if (S0.lights) g.add(glowPoints(lp, lc, 2.6));
  if (hl.p.length) g.add(glowPoints(hl.p, hl.c, 1.4));
  if (tg.p.length) g.add(glowPoints(tg.p, tg.c, 0.8));
  // 空と山（遠景の円柱に描く）
  // 円柱の周り（約 1630 m）に貼るので横に引きのばされる。丸い物（月・太陽）は横を縮めて描く
  const SW = S0.stars ? 2048 : 1024;
  const SKY_RADIUS = Math.max(260, (FIELD.x1 - FIELD.x0) * 1.4);
  const sq = (w) => (140 / 256) / ((2 * Math.PI * SKY_RADIUS) / w);
  const skyTex = canvasTex(SW, 256, (x, w, h) => {
    const gr = x.createLinearGradient(0, 0, 0, h);
    for (const [t, c] of S0.sky) gr.addColorStop(t, c);
    x.fillStyle = gr;
    x.fillRect(0, 0, w, h);
    const r2 = mulberry(11);
    if (S0.stars) {
      for (let i = 0; i < 260; i++) {
        x.fillStyle = `rgba(255,255,255,${0.35 + r2() * 0.65})`;
        const s2 = r2() < 0.15 ? 2 : 1;
        x.fillRect(r2() * w, r2() * h * 0.7, s2, s2);
      }
    }
    if (S0.moon) {
      const k = sq(w);
      x.fillStyle = '#fff6d0';
      x.beginPath();
      x.ellipse(w * 0.3, 50, 16 * k, 16, 0, 0, Math.PI * 2);
      x.fill();
      x.fillStyle = S0.sky[0][1];
      x.beginPath();
      x.ellipse(w * 0.3 + 7 * k, 45, 14 * k, 14, 0, 0, Math.PI * 2);
      x.fill();
    }
    // 大きな満月（ハロウィン）。まわりをぼんやり光らせる
    if (S0.bigMoon) {
      const k = sq(w);
      const mx = w * 0.42;
      const my = 70;
      const gl = x.createRadialGradient(mx, my, 0, mx, my, 80);
      gl.addColorStop(0, 'rgba(255,190,90,0.55)');
      gl.addColorStop(1, 'rgba(255,150,60,0)');
      x.fillStyle = gl;
      x.fillRect(mx - 80, my - 80, 160, 160);
      x.fillStyle = S0.bigMoon;
      x.beginPath();
      x.ellipse(mx, my, 34 * k, 34, 0, 0, Math.PI * 2);
      x.fill();
      x.fillStyle = 'rgba(200,110,30,0.35)';
      for (const [dx, dy, rr] of [[-10, -8, 7], [8, 6, 9], [-4, 14, 5], [12, -12, 4]]) {
        x.beginPath();
        x.ellipse(mx + dx * k, my + dy, rr * k, rr, 0, 0, Math.PI * 2);
        x.fill();
      }
      // 月を横切るコウモリの影
      x.fillStyle = '#140a20';
      for (const [dx, dy, ss] of [[-20, -14, 1], [6, -24, 0.8], [22, 4, 0.7]]) {
        const bx = mx + dx * k;
        const by = my + dy;
        x.beginPath();
        x.moveTo(bx, by);
        x.quadraticCurveTo(bx - 4 * ss * k, by - 5 * ss, bx - 9 * ss * k, by - 2 * ss);
        x.quadraticCurveTo(bx - 5 * ss * k, by, bx, by + 2 * ss);
        x.quadraticCurveTo(bx + 5 * ss * k, by, bx + 9 * ss * k, by - 2 * ss);
        x.quadraticCurveTo(bx + 4 * ss * k, by - 5 * ss, bx, by);
        x.fill();
      }
    }
    if (S0.sunDisk) {
      const sx = w * 0.62;
      const sy = h * 0.72;
      const gl = x.createRadialGradient(sx, sy, 0, sx, sy, 70);
      gl.addColorStop(0, 'rgba(255,240,180,0.9)');
      gl.addColorStop(1, 'rgba(255,200,120,0)');
      x.fillStyle = gl;
      x.fillRect(sx - 70, sy - 70, 140, 140);
      x.fillStyle = S0.sunDisk;
      x.beginPath();
      x.ellipse(sx, sy, 20 * sq(w), 20, 0, 0, Math.PI * 2);
      x.fill();
    }
    // 雲
    if (S0.clouds) {
      x.fillStyle = S0.clouds;
      for (let i = 0; i < 14; i++) {
        const cx2 = (i * 173) % w;
        const cy2 = 40 + ((i * 53) % 90);
        for (let k = 0; k < 5; k++) {
          x.beginPath();
          x.arc(cx2 + k * 14, cy2 + (k % 2) * 6, 14 + (k % 3) * 5, 0, Math.PI * 2);
          x.fill();
        }
      }
    }
    // 山
    x.fillStyle = S0.mount;
    x.beginPath();
    x.moveTo(0, h);
    for (let i = 0; i <= w; i += 16) x.lineTo(i, h - 30 - Math.abs(Math.sin(i * 0.011) * 40) - Math.abs(Math.sin(i * 0.037)) * 14);
    x.lineTo(w, h);
    x.fill();
    // 夜：遠くの町の明かり
    if (S0.lights) {
      for (let i = 0; i < 160; i++) {
        x.fillStyle = ['#ffe080', '#fff4d0', '#ffb070'][i % 3];
        x.fillRect(r2() * w, h - 6 - r2() * 22, 2, 1);
      }
    }
  });
  skyTex.wrapS = THREE.RepeatWrapping;
  const sky = new THREE.Mesh(new THREE.CylinderGeometry(SKY_RADIUS, SKY_RADIUS, 140, 64, 1, true), new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false }));
  sky.position.y = 55;
  g.add(sky);
  return g;
}

// 雪：カメラのまわりの箱の中で降らせる（箱からはみ出したら反対側へ）
export class Snowfall {
  // opt：{ color, size, n, fall }（桜の花びらにも使う）
  constructor(opt = {}, R = 40, H = 30) {
    const n = opt.n || 900;
    this.fall = opt.fall || 1;
    this.n = n;
    this.R = R;
    this.H = H;
    this.pos = new Float32Array(n * 3);
    const r = mulberry(5);
    this.ph = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      this.pos[i * 3] = (r() * 2 - 1) * R;
      this.pos[i * 3 + 1] = r() * H;
      this.pos[i * 3 + 2] = (r() * 2 - 1) * R;
      this.ph[i] = r() * 6.28;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    const dot = canvasTex(16, 16, (x, w, h) => {
      const gr = x.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      gr.addColorStop(0, 'rgba(255,255,255,1)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = gr;
      x.fillRect(0, 0, w, h);
    });
    this.points = new THREE.Points(g, new THREE.PointsMaterial({ size: opt.size || 0.5, map: dot, color: opt.color || '#ffffff', transparent: true, depthWrite: false }));
    this.points.frustumCulled = false;
    this.geo = g;
    this.t = 0;
  }
  // 箱の中心をカメラに合わせ、雪は世界の座標で降る
  update(dt, cx, cy, cz) {
    const { pos, R, H, n } = this;
    this.t += dt;
    const ox = this.points.position.x;
    const oy = this.points.position.y;
    const oz = this.points.position.z;
    this.points.position.set(cx, Math.max(0, cy - H / 2), cz);
    const mx = ox - this.points.position.x;
    const my = oy - this.points.position.y;
    const mz = oz - this.points.position.z;
    const w = (v, L) => ((((v + L) % (2 * L)) + 2 * L) % (2 * L)) - L;
    for (let i = 0; i < n; i++) {
      const k = i * 3;
      pos[k] = w(pos[k] + mx + Math.sin(this.t * 0.8 + this.ph[i]) * 0.6 * dt, R);
      pos[k + 2] = w(pos[k + 2] + mz + Math.cos(this.t * 0.6 + this.ph[i]) * 0.6 * dt, R);
      pos[k + 1] = ((((pos[k + 1] + my - (1.6 + (i % 5) * 0.15) * this.fall * dt) % H) + H) % H);
    }
    this.geo.attributes.position.needsUpdate = true;
  }
}
function mulberry(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 駅（ホーム・屋根・看板・出口のゲート）
export function buildStation() {
  const g = new THREE.Group();
  const b = new Builder();
  const { x0, x1, z, h } = STATION;
  const L = x1 - x0;
  const cx = (x0 + x1) / 2;
  // ホーム（線路の手前と奥）
  b.box(cx, h / 2 - 0.3, z + 2.2, [L / 2 + 1, 0, 0], [0, h / 2 - 0.3, 0], [0, 0, 1.3], '#c8c0b0');
  b.box(cx, h / 2 - 0.3, z - 2.0, [L / 2 + 1, 0, 0], [0, h / 2 - 0.3, 0], [0, 0, 1.0], '#c8c0b0');
  b.box(cx, h - 0.35, z, [L / 2 + 1, 0, 0], [0, 0.35, 0], [0, 0, 0.9], '#8a8a90');
  // 階段（手前）
  for (let k = 0; k < 4; k++) b.box(cx, (k + 0.5) * (h - 0.6) / 4, z + 3.7 + (3 - k) * 0.5, [3, 0, 0], [0, (k + 0.5) * (h - 0.6) / 8, 0], [0, 0, 0.25], '#b8b0a0');
  // 柱と屋根
  for (const px of [x0, cx - L / 6, cx + L / 6, x1]) {
    b.cyl([px, h - 0.6, z + 3.2], [px, h + 4.2, z + 3.2], 0.18, '#f4f4f4');
    b.cyl([px, h - 0.6, z - 2.8], [px, h + 4.2, z - 2.8], 0.18, '#f4f4f4');
  }
  b.box(cx, h + 4.4, z + 0.2, [L / 2 + 1.5, 0, 0], [0, 0.25, 0], [0, 0, 4], '#e84a5f');
  b.box(cx, h + 4.75, z + 0.2, [L / 2 + 1, 0, 0], [0, 0.12, 0], [0, 0, 3.4], '#ffffff');
  // 手すり（手前の並ぶ所）
  b.beam([x0, h + 0.6, z + 3.4], [x1, h + 0.6, z + 3.4], 0.08, 0.08, '#f8b800');
  g.add(new THREE.Mesh(b.geometry(), VC));
  // 看板
  const sign = canvasTex(512, 96, (x, w, hh) => {
    x.fillStyle = '#ffffff';
    x.fillRect(0, 0, w, hh);
    x.fillStyle = '#e84a5f';
    x.fillRect(0, hh - 10, w, 10);
    x.fillStyle = '#2a2a3a';
    x.font = '800 54px "M PLUS 1p", sans-serif';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText('のりば', w / 2, hh / 2 - 4);
  });
  const sm = new THREE.Mesh(new THREE.PlaneGeometry(8, 1.5), new THREE.MeshBasicMaterial({ map: sign }));
  sm.position.set(cx, h + 5.7, z + 2.2);
  g.add(sm);
  // 出口のゲート（動く）
  const gate = new THREE.Group();
  const gb = new Builder();
  gb.box(0, 0, 1.5, [0.08, 0, 0], [0, 0.08, 0], [0, 0, 1.5], '#f8f8f8');
  for (let k = 0; k < 5; k++) gb.box(0, 0, 0.3 + k * 0.6, [0.09, 0, 0], [0, 0.09, 0], [0, 0, 0.15], '#e84a5f');
  gate.add(new THREE.Mesh(gb.geometry(), VC));
  gate.position.set(x1 + 0.4, h + 1.0, z - 1.5);
  g.add(gate);
  g.userData.gate = gate;
  return g;
}

// ---------------- 線路 ----------------
const LOOK = {
  wood: { rail: '#9a9aa2', tie: '#8a6238', spine: null, sup: '#a0743f', sup2: '#8a6238' },
  steel: { rail: '#e84a5f', tie: '#2f5fbf', spine: '#e84a5f', sup: '#f2f2f2', sup2: '#d8d8de' },
  alloy: { rail: '#f8c040', tie: '#2a2a32', spine: '#f8c040', sup: '#3a3a44', sup2: '#2a2a32' },
};
// 夜の電球（足し算で光って見える点）。点の材質は使い回す
const BULBS = ['#ffe080', '#ff8aa0', '#80d8ff', '#a0ff90'];
let glowMatCache = null;
function glowMat(size) {
  if (!glowMatCache) {
    const dot = canvasTex(32, 32, (x, w, h) => {
      const gr = x.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      gr.addColorStop(0, 'rgba(255,255,255,1)');
      gr.addColorStop(0.3, 'rgba(255,255,255,0.7)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = gr;
      x.fillRect(0, 0, w, h);
    });
    glowMatCache = new Map();
    glowMatCache.dot = dot;
  }
  let m = glowMatCache.get(size);
  if (!m) {
    m = new THREE.PointsMaterial({ size, map: glowMatCache.dot, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    m.userData.shared = true;
    glowMatCache.set(size, m);
  }
  return m;
}
function glowPoints(pos, colr, size) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
  const p = new THREE.Points(g, glowMat(size));
  p.frustumCulled = false;
  return p;
}
// 線路をかたまり（10 m）ごとのメッシュにする。支点（真下の地面）を原点にしたので、そのまま倒せる
// rail：装飾の線路の色（looks.js の RAIL_LOOKS の番号。0 は素材ごとの色）
export function buildTrackMeshes(tr, rail = 0, night = false) {
  const mat = MATS[tr.design.mat].id;
  const pick = RAIL_LOOKS[rail];
  const lk = pick && pick.rail ? { ...pick, spine: LOOK[mat].spine ? pick.spine : null } : LOOK[mat];
  const group = new THREE.Group();
  const meshes = [];
  const supByChunk = new Map();
  for (const i of tr.supports) {
    const c = Math.floor(i / CHUNK);
    if (!supByChunk.has(c)) supByChunk.set(c, []);
    supByChunk.get(c).push(i);
  }
  const gauge = 0.55;
  const bl = [];
  const bci = [];
  const bcol = [];
  for (let c = 0; c < tr.chunks.length; c++) {
    const ch = tr.chunks[c];
    const ox = ch.px;
    const oz = ch.pz;
    const b = new Builder();
    const P = (i, du = 0, dr = 0) => {
      const j = tr.wrap(i);
      return [tr.px[j] + tr.ux[j] * du + tr.rx[j] * dr - ox, tr.py[j] + tr.uy[j] * du + tr.ry[j] * dr, tr.pz[j] + tr.uz[j] * du + tr.rz[j] * dr - oz];
    };
    const frame = (i) => {
      const j = tr.wrap(i);
      return [tr.ux[j], tr.uy[j], tr.uz[j], tr.rx[j], tr.ry[j], tr.rz[j]];
    };
    // 隙間（ジャンプ）の所は描かない。かたまりの端は 1 点先までつなぐ
    const runs = [];
    let run = null;
    for (let i = ch.a; i <= ch.b; i++) {
      const j = tr.wrap(i);
      if (tr.fl[j] & F.GAP) {
        if (run) runs.push(run);
        run = null;
        continue;
      }
      if (!run) run = [];
      run.push(i);
    }
    if (run) runs.push(run);
    for (const r of runs) {
      if (r.length < 2) continue;
      for (const side of [-gauge, gauge]) {
        b.tube(r.map((i) => [...P(i, 0, side), ...frame(i)]), 0.085, lk.rail, 5);
      }
      if (lk.spine) b.tube(r.map((i) => [...P(i, -0.42, 0), ...frame(i)]), 0.2, lk.spine, 6);
      for (const i of r) {
        if (i % 2 || i === ch.b) continue;
        const j = tr.wrap(i);
        const fl = tr.fl[j];
        const t = [tr.tx[j], tr.ty[j], tr.tz[j]];
        const u = [tr.ux[j], tr.uy[j], tr.uz[j]];
        const rr = [tr.rx[j], tr.ry[j], tr.rz[j]];
        const p = P(i, -0.12, 0);
        // まくら木
        let tc = lk.tie;
        if (fl & F.LIFT) tc = '#3a3a3a';
        if (fl & F.BOOST) tc = '#f8b800';
        if (fl & F.BRAKE) tc = '#c8d0d8';
        if (fl & F.LAUNCH) tc = '#40c8f0';
        b.box(p[0], p[1], p[2], [t[0] * 0.12, t[1] * 0.12, t[2] * 0.12], [u[0] * 0.08, u[1] * 0.08, u[2] * 0.08], [rr[0] * 0.72, rr[1] * 0.72, rr[2] * 0.72], tc);
        if (lk.spine) {
          const q = P(i, -0.3, 0);
          b.box(q[0], q[1], q[2], [t[0] * 0.08, t[1] * 0.08, t[2] * 0.08], [u[0] * 0.2, u[1] * 0.2, u[2] * 0.2], [rr[0] * 0.08, rr[1] * 0.08, rr[2] * 0.08], tc);
        }
        // ブースター・ブレーキのひれ
        if ((fl & (F.BOOST | F.BRAKE | F.LAUNCH)) && i % 4 === 0) {
          const q = P(i, 0.05, 0);
          b.box(q[0], q[1], q[2], [t[0] * 0.2, t[1] * 0.2, t[2] * 0.2], [u[0] * 0.14, u[1] * 0.14, u[2] * 0.14], [rr[0] * 0.03, rr[1] * 0.03, rr[2] * 0.03], (fl & F.BRAKE) ? '#e8eef4' : '#2a2a2a');
        }
        // 巻き上げのチェーン
        if (fl & F.LIFT) {
          const q = P(i, 0.0, 0);
          b.box(q[0], q[1], q[2], [t[0] * 0.25, t[1] * 0.25, t[2] * 0.25], [u[0] * 0.04, u[1] * 0.04, u[2] * 0.04], [rr[0] * 0.07, rr[1] * 0.07, rr[2] * 0.07], '#555560');
        }
      }
      // ジャンプの踏み切り台・着地の坂の端に、黄色と黒のしま
      for (const end of [r[0], r[r.length - 1]]) {
        const j1 = tr.wrap(end + 1);
        const j0 = tr.wrap(end - 1);
        if (!((tr.fl[j1] | tr.fl[j0]) & F.GAP)) continue;
        const p = P(end, -0.3, 0);
        const j = tr.wrap(end);
        for (let k = -2; k <= 2; k++) {
          const q = [p[0] + tr.rx[j] * k * 0.3, p[1] + tr.ry[j] * k * 0.3, p[2] + tr.rz[j] * k * 0.3];
          b.box(q[0], q[1], q[2], [tr.tx[j] * 0.1, tr.ty[j] * 0.1, tr.tz[j] * 0.1], [tr.ux[j] * 0.35, tr.uy[j] * 0.35, tr.uz[j] * 0.35], [tr.rx[j] * 0.15, tr.ry[j] * 0.15, tr.rz[j] * 0.15], k % 2 ? '#1a1a1a' : '#f8d020');
        }
      }
    }
    // 支柱
    for (const i of supByChunk.get(c) || []) {
      const top = P(i, lk.spine ? -0.5 : -0.2, 0);
      const y = top[1];
      if (mat === 'wood') {
        // 木の組み（2 本の柱と、すじかい）
        const j = tr.wrap(i);
        let rx = tr.rx[j];
        let rz = tr.rz[j];
        const l = Math.hypot(rx, rz) || 1;
        rx /= l;
        rz /= l;
        // 高架は基部を広くしたテーパー支柱にする。幅と補強材数を上限付きにし、
        // 600 m 級のコースでも数十万本の小さな梁を生成しない。
        const w = Math.min(14, 0.7 + y * 0.022);
        const A = [top[0] - rx * w, 0, top[2] - rz * w];
        const B = [top[0] + rx * w, 0, top[2] + rz * w];
        const At = [top[0] - rx * 0.6, y, top[2] - rz * 0.6];
        const Bt = [top[0] + rx * 0.6, y, top[2] + rz * 0.6];
        b.beam(A, At, 0.22, 0.22, lk.sup);
        b.beam(B, Bt, 0.22, 0.22, lk.sup);
        const bracePitch = y > 300 ? 30 : y > 100 ? 18 : y > 45 ? 9 : 3;
        const steps = Math.max(1, Math.min(24, Math.ceil(y / bracePitch)));
        for (let k = 1; k <= steps; k++) {
          const f0 = (k - 1) / steps;
          const f1 = k / steps;
          const a0 = lerp3(A, At, f0);
          const b0 = lerp3(B, Bt, f0);
          const a1 = lerp3(A, At, f1);
          const b1 = lerp3(B, Bt, f1);
          b.beam(a1, b1, 0.14, 0.14, lk.sup2);
          b.beam(k % 2 ? a0 : b0, k % 2 ? b1 : a1, 0.1, 0.1, lk.sup2);
        }
      } else {
        b.cyl([top[0], 0, top[2]], top, mat === 'alloy' ? 0.36 : 0.3, lk.sup, 7);
        b.box(top[0], 0.25, top[2], [0.6, 0, 0], [0, 0.25, 0], [0, 0, 0.6], '#b8b8b8');
      }
    }
    const mesh = new THREE.Mesh(b.geometry(), VC);
    mesh.position.set(ox, 0, oz);
    mesh.userData.chunk = c;
    // 夜：線路の両わきに電球（2.5 m おき）。描く回数を増やさないよう全体で 1 つの点の集まりにし、
    // かたまりの動き（組み立て・崩れる）は syncChunks で写す
    if (night) {
      for (let i = ch.a; i <= ch.b; i++) {
        if (i % 5 || i === ch.b || (tr.fl[tr.wrap(i)] & F.GAP)) continue;
        for (const side of [-0.75, 0.75]) {
          bl.push(...P(i, 0.05, side));
          bci.push(c);
          const cc = col(BULBS[Math.floor(i / 5) % BULBS.length]);
          bcol.push(cc.r, cc.g, cc.b);
        }
      }
    }
    group.add(mesh);
    meshes.push(mesh);
  }
  let bulbs = null;
  if (bl.length) {
    const pts = glowPoints(bl, bcol, 1.1);
    group.add(pts);
    bulbs = { points: pts, local: new Float32Array(bl), ci: bci };
  }
  return { group, meshes, bulbs };
}
function lerp3(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

// ---------------- 車両とお客さん ----------------
const CAR_COLORS = ['#e84a5f', '#3aa0ff', '#f8b800', '#5ac85a', '#b070e0', '#ff8a3a'];
const SKIN = ['#f2c9a0', '#eebf94', '#f5d2ae', '#e4b48a', '#c8946a'];
// ハロウィンの仮装（かぼちゃ色・紫・黒・緑・おばけの白・ドラキュラの赤）
const COSTUME = ['#f07818', '#7a3ab0', '#1e1a22', '#3a9a3a', '#f4f4ff', '#a01a2a', '#f07818', '#1e1a22'];
// 夏の服（あざやかな色）
const SUMMER = ['#ff5a7a', '#40c0ff', '#ffd040', '#5ad06a', '#ffffff', '#ff9a30', '#3a6ad0'];
// クリスマスの冬服（赤・緑・白・紺・茶）
const WINTER = ['#d8283a', '#2a8a3a', '#f4f4f4', '#2a3a6a', '#8a5a30', '#d8283a', '#f8c030'];
const SHIRT = ['#e84a5f', '#3a6ad0', '#f8d040', '#50b060', '#ffffff', '#f080b0', '#40c0c0', '#8a5ad0', '#2a2a2a', '#f09030'];
const HAIR = ['#151515', '#3b2a1e', '#6a4a2a', '#d8b060', '#a03a2a', '#151515'];

const RAINBOW = ['#9a5ad8', '#3a8ae8', '#4ac060', '#f8d040', '#ff9a30', '#e8384f']; // 下から上へ
// look：装飾の車両の色（looks.js の CAR_LOOKS の番号。0 は車両ごとに違う色）
export function makeCar(index, barId, look = 0) {
  const g = new THREE.Group();
  const b = new Builder();
  const pick = CAR_LOOKS[look];
  const rainbow = pick && pick.id === 'rainbow';
  const c = rainbow ? '#ffffff' : (pick && pick.c) || CAR_COLORS[index % CAR_COLORS.length];
  // 台車（車輪）
  b.box(0, 0.1, 0, [1.0, 0, 0], [0, 0.12, 0], [0, 0, 0.75], '#3a3a40');
  // 車体（虹は 6 本のしまを積む。重ねずに並べるので、面どうしは重ならない）
  if (rainbow) {
    for (let k = 0; k < 6; k++) b.box(0, 0.25 + 0.05 + k * 0.1, 0, [1.15, 0, 0], [0, 0.05, 0], [0, 0, 0.8], RAINBOW[k]);
  } else b.box(0, 0.55, 0, [1.15, 0, 0], [0, 0.3, 0], [0, 0, 0.8], c);
  b.box(-0.1, 0.95, 0, [0.15, 0, 0], [0, 0.25, 0], [0, 0, 0.78], c); // 背もたれ
  b.box(0.95, 0.95, 0, [0.2, 0, 0], [0, 0.18, 0], [0, 0, 0.78], c); // 前のついたて
  b.box(0.3, 0.86, 0, [0.4, 0, 0], [0, 0.03, 0], [0, 0, 0.72], '#2a2a32'); // 座面
  if (index === 0) {
    // 先頭車の鼻先
    b.box(1.35, 0.5, 0, [0.25, 0, 0], [0, 0.25, 0], [0, 0, 0.7], rainbow ? RAINBOW[5] : c);
    b.box(1.55, 0.45, 0, [0.06, 0, 0], [0, 0.15, 0], [0, 0, 0.5], '#ffffff');
  }
  // テーマの車両：ふちの色、かぼちゃの顔（前のついたて）、クリスマスの鈴
  if (pick && pick.trim) {
    for (const z of [0.79, -0.79]) b.box(0, 0.87, z, [1.16, 0, 0], [0, 0.04, 0], [0, 0, 0.03], pick.trim);
    b.box(0.95, 1.15, 0, [0.21, 0, 0], [0, 0.03, 0], [0, 0, 0.79], pick.trim);
  }
  if (pick && pick.face) {
    for (const z of [0.32, -0.32]) b.box(1.16, 1.0, z, [0.01, 0, 0], [0, 0.07, 0], [0, 0, 0.09], '#2a1206');
    b.box(1.16, 0.86, 0, [0.01, 0, 0], [0, 0.035, 0], [0, 0, 0.4], '#2a1206');
    for (const z of [-0.2, 0.2]) b.box(1.165, 0.89, z, [0.008, 0, 0], [0, 0.02, 0], [0, 0, 0.05], c); // 歯
    b.box(0.95, 1.23, 0, [0.05, 0, 0], [0, 0.06, 0], [0, 0, 0.05], '#3a6a1a'); // へた
  }
  if (pick && pick.petals) {
    // 5 枚の花びらの桜を、横に 3 つずつ
    for (const z of [0.81, -0.81]) {
      for (const x of [-0.7, 0, 0.7]) {
        for (let k = 0; k < 5; k++) {
          const a = (k / 5) * Math.PI * 2;
          b.box(x + Math.cos(a) * 0.1, 0.55 + Math.sin(a) * 0.1, z, [0.06, 0, 0], [0, 0.06, 0], [0, 0, 0.012], '#ffffff');
        }
        b.box(x, 0.55, z * 1.01, [0.035, 0, 0], [0, 0.035, 0], [0, 0, 0.01], '#f8c030');
      }
    }
  }
  if (pick && pick.stripes) {
    // スイカの黒いしま（縦に）と、白い皮のふち
    for (const z of [0.805, -0.805]) {
      for (let x = -1.0; x <= 1.0; x += 0.33) b.box(x, 0.52, z, [0.05, 0, 0], [0, 0.26, 0], [0, 0, 0.01], '#14401a');
      b.box(0, 0.8, z, [1.15, 0, 0], [0, 0.035, 0], [0, 0, 0.012], '#e8f4d8');
    }
    for (const sx of [-0.15, 0.15, 0.45]) b.box(0.95, 1.05, sx, [0.215, 0, 0], [0, 0.03, 0], [0, 0, 0.02], '#1e1e22'); // たね
  }
  if (pick && pick.bells) {
    for (const z of [0.82, -0.82]) {
      for (const x of [-0.6, 0.6]) {
        b.box(x, 0.68, z, [0.07, 0, 0], [0, 0.07, 0], [0, 0, 0.02], '#f8c030');
        b.box(x - 0.12, 0.74, z, [0.06, 0, 0], [0, 0.03, 0], [0, 0, 0.02], '#2a8a3a'); // ひいらぎの葉
        b.box(x + 0.12, 0.74, z, [0.06, 0, 0], [0, 0.03, 0], [0, 0, 0.02], '#2a8a3a');
      }
    }
  }
  // 安全バー
  const barCol = '#f8f8f8';
  if (barId === 1) {
    for (const s of [-0.38, 0.38]) b.box(0.55, 1.15, s, [0.06, 0, 0], [0, 0.06, 0], [0, 0, 0.22], barCol);
  } else if (barId === 2) {
    for (const s of [-0.38, 0.38]) {
      b.box(0.12, 1.55, s - 0.18, [0.06, 0, 0], [0, 0.4, 0], [0, 0, 0.05], '#2a2a2a');
      b.box(0.12, 1.55, s + 0.18, [0.06, 0, 0], [0, 0.4, 0], [0, 0, 0.05], '#2a2a2a');
    }
  }
  g.add(new THREE.Mesh(b.geometry(), VC));
  return g;
}

// 動物の毛の色
const FUR = {
  cat: ['#f0a050', '#a0a0a8', '#f4f0e8', '#3a3a40', '#c88a50'],
  dog: ['#e0b070', '#f4ece0', '#8a5a30', '#3a3030', '#c8c0b0'],
  rabbit: ['#f8f6f0', '#d8c0a0', '#a8a0a0', '#8a6a50'],
};
// お客さん 1 人（体＋頭は 1 つ、腕は動かすので別）。kind は looks.js の RIDER_LOOKS の id
// 頭の箱：中心 (0, 0.86, 0)、半分の大きさ x 0.2（前が +x）・y 0.22・z 0.2。耳などは頭の面から 1 cm 以上ずらして足す
export function makeRider(id, kind = 'human') {
  const r = mulberry(id * 977 + 13);
  const skin0 = SKIN[Math.floor(r() * SKIN.length)];
  const shirt0 = SHIRT[Math.floor(r() * SHIRT.length)];
  const hair = HAIR[Math.floor(r() * HAIR.length)];
  const furs = FUR[kind];
  const fur = furs ? furs[Math.floor(r() * furs.length)] : null;
  let skin = fur || skin0;
  let shirt = shirt0;
  let pants = '#3a4a6a';
  let hand = skin;
  if (kind === 'panda') {
    skin = '#f6f6f2';
    shirt = '#f6f6f2';
    pants = '#1e1e22';
    hand = '#1e1e22';
  } else if (kind === 'robot') {
    skin = '#b8c0cc';
    shirt = ['#9aa4b4', '#c8ccd4', '#8a94a8'][Math.floor(r() * 3)];
    pants = '#6a7284';
    hand = '#6a7284';
  } else if (kind === 'jack') {
    skin = '#ee7618';
    shirt = '#1e1a22';
    pants = '#3a2a48';
    hand = '#3a8a2a';
  } else if (kind === 'ghost') {
    skin = shirt = pants = hand = '#f4f4fc';
  } else if (kind === 'santa') {
    shirt = pants = '#d8283a';
    hand = '#f4f4f4';
  } else if (kind === 'chick') {
    skin = shirt = pants = hand = '#ffd84a';
  } else if (kind === 'aloha') {
    shirt = ['#ff5a7a', '#40b0ff', '#ffb030'][Math.floor(r() * 3)];
    pants = '#f4e8c8';
  } else if (kind === 'reindeer') {
    skin = '#8a5a30';
    shirt = '#8a5a30';
    pants = '#6a4220';
    hand = '#3a2a1a';
  }
  const g = new THREE.Group();
  const b = new Builder();
  b.box(0, 0.32, 0, [0.18, 0, 0], [0, 0.3, 0], [0, 0, 0.22], shirt); // 胴
  b.box(0.28, 0.0, 0, [0.3, 0, 0], [0, 0.1, 0], [0, 0, 0.2], pants); // 太もも（座っている）
  b.box(0.55, -0.25, 0, [0.08, 0, 0], [0, 0.25, 0], [0, 0, 0.18], pants); // すね
  b.box(0, 0.86, 0, [0.2, 0, 0], [0, 0.22, 0], [0, 0, 0.2], skin); // 頭
  const eyes = (c, y = 0.9, hz = 0.03) => {
    for (const z of [0.08, -0.08]) b.box(0.2, y, z, [0.01, 0, 0], [0, 0.03, 0], [0, 0, hz], c);
  };
  if (kind === 'human') {
    b.box(-0.04, 1.06, 0, [0.21, 0, 0], [0, 0.07, 0], [0, 0, 0.21], hair); // 髪
    eyes('#151515');
  } else if (kind === 'cat') {
    for (const z of [0.12, -0.12]) {
      b.box(-0.02, 1.13, z, [0.06, 0, 0], [0, 0.06, 0], [0, 0, 0.06], fur); // 耳
      b.box(-0.02, 1.17, z, [0.035, 0, 0], [0, 0.04, 0], [0, 0, 0.035], fur); // 耳の先（細く）
      b.box(0.045, 1.13, z, [0.01, 0, 0], [0, 0.04, 0], [0, 0, 0.035], '#f4a0b0'); // 耳の内側
    }
    eyes('#2a6a2a');
    b.box(0.21, 0.82, 0, [0.012, 0, 0], [0, 0.02, 0], [0, 0, 0.03], '#f07090'); // 鼻
    for (const z of [0.17, -0.17]) b.box(0.21, 0.8, z, [0.005, 0, 0], [0, 0.006, 0], [0, 0, 0.07], '#f8f8f8'); // ひげ
  } else if (kind === 'dog') {
    const ear = fur === '#3a3030' ? '#5a4a40' : '#6a4228';
    for (const z of [0.215, -0.215]) b.box(-0.02, 0.94, z, [0.07, 0, 0], [0, 0.13, 0], [0, 0, 0.025], ear); // たれ耳
    eyes('#151515', 0.93);
    b.box(0.25, 0.79, 0, [0.06, 0, 0], [0, 0.07, 0], [0, 0, 0.11], fur === '#f4ece0' ? '#e8dcc8' : '#f4ece0'); // 口のまわり
    b.box(0.33, 0.83, 0, [0.015, 0, 0], [0, 0.03, 0], [0, 0, 0.04], '#151515'); // 鼻
    b.box(0.29, 0.705, 0, [0.03, 0, 0], [0, 0.012, 0], [0, 0, 0.035], '#e86070'); // 舌
  } else if (kind === 'rabbit') {
    for (const z of [0.09, -0.09]) {
      b.box(-0.03, 1.27, z, [0.04, 0, 0], [0, 0.2, 0], [0, 0, 0.05], fur); // 長い耳
      b.box(0.02, 1.27, z, [0.01, 0, 0], [0, 0.15, 0], [0, 0, 0.03], '#f4a0b0'); // 耳の内側
    }
    eyes('#c03040');
    b.box(0.21, 0.82, 0, [0.012, 0, 0], [0, 0.02, 0], [0, 0, 0.025], '#f07090'); // 鼻
    b.box(0.21, 0.76, 0, [0.008, 0, 0], [0, 0.03, 0], [0, 0, 0.03], '#ffffff'); // 前歯
  } else if (kind === 'panda') {
    for (const z of [0.15, -0.15]) b.box(-0.02, 1.12, z, [0.06, 0, 0], [0, 0.06, 0], [0, 0, 0.06], '#1e1e22'); // 丸い耳
    for (const z of [0.08, -0.08]) b.box(0.205, 0.89, z, [0.01, 0, 0], [0, 0.06, 0], [0, 0, 0.055], '#1e1e22'); // 目のまわり
    for (const z of [0.08, -0.08]) b.box(0.222, 0.9, z, [0.008, 0, 0], [0, 0.02, 0], [0, 0, 0.018], '#ffffff'); // 目
    b.box(0.21, 0.8, 0, [0.012, 0, 0], [0, 0.025, 0], [0, 0, 0.04], '#1e1e22'); // 鼻
  } else if (kind === 'jack') {
    // かぼちゃ頭：三角の目・ぎざぎざの口・へた
    for (const z of [0.09, -0.09]) b.box(0.205, 0.93, z, [0.01, 0, 0], [0, 0.045, 0], [0, 0, 0.045], '#2a1206');
    b.box(0.205, 0.78, 0, [0.01, 0, 0], [0, 0.03, 0], [0, 0, 0.13], '#2a1206');
    for (const z of [-0.06, 0.06]) b.box(0.212, 0.8, z, [0.008, 0, 0], [0, 0.015, 0], [0, 0, 0.025], '#ee7618'); // 歯
    for (const z of [0.1, -0.1]) b.box(0, 0.86, z * 2.04, [0.17, 0, 0], [0, 0.2, 0], [0, 0, 0.005], '#d86410'); // すじ
    b.box(0, 1.13, 0, [0.04, 0, 0], [0, 0.06, 0], [0, 0, 0.04], '#3a6a1a'); // へた
    b.box(0.0, 0.68, 0, [0.22, 0, 0], [0, 0.03, 0], [0, 0, 0.26], '#6a2a9a'); // マントのえり
  } else if (kind === 'ghost') {
    // おばけ：大きな黒い目と丸い口。頭の上をとがらせ、すそを広げる
    for (const z of [0.08, -0.08]) b.box(0.205, 0.9, z, [0.01, 0, 0], [0, 0.06, 0], [0, 0, 0.04], '#1a1424');
    b.box(0.205, 0.75, 0, [0.01, 0, 0], [0, 0.035, 0], [0, 0, 0.035], '#1a1424');
    b.box(-0.02, 1.12, 0, [0.12, 0, 0], [0, 0.04, 0], [0, 0, 0.12], '#f4f4fc');
    b.box(-0.04, 1.18, 0, [0.06, 0, 0], [0, 0.03, 0], [0, 0, 0.06], '#f4f4fc');
    b.box(0, 0.08, 0, [0.22, 0, 0], [0, 0.06, 0], [0, 0, 0.27], '#f4f4fc'); // すそ
  } else if (kind === 'santa') {
    eyes('#151515', 0.93);
    b.box(0.21, 0.74, 0, [0.03, 0, 0], [0, 0.12, 0], [0, 0, 0.19], '#f8f8f8'); // ひげ
    b.box(0.215, 0.84, 0, [0.02, 0, 0], [0, 0.03, 0], [0, 0, 0.12], '#f8f8f8'); // 口ひげ
    b.box(0.215, 0.88, 0, [0.015, 0, 0], [0, 0.025, 0], [0, 0, 0.03], '#f0a090'); // 鼻
    b.box(0, 1.1, 0, [0.22, 0, 0], [0, 0.04, 0], [0, 0, 0.22], '#f8f8f8'); // 帽子のふち
    b.box(-0.02, 1.22, 0, [0.17, 0, 0], [0, 0.08, 0], [0, 0, 0.17], '#d8283a'); // 帽子
    b.box(-0.08, 1.33, 0, [0.09, 0, 0], [0, 0.05, 0], [0, 0, 0.09], '#d8283a');
    b.box(-0.16, 1.32, 0, [0.05, 0, 0], [0, 0.05, 0], [0, 0, 0.05], '#f8f8f8'); // ぼんぼん
    b.box(0.19, 0.12, 0, [0.01, 0, 0], [0, 0.04, 0], [0, 0, 0.21], '#1e1e22'); // ベルト
    b.box(0.2, 0.12, 0, [0.008, 0, 0], [0, 0.035, 0], [0, 0, 0.04], '#f8c030');
  } else if (kind === 'chick') {
    // ひよこ：くちばし・頭の毛・小さな羽
    eyes('#151515', 0.92);
    b.box(0.25, 0.82, 0, [0.06, 0, 0], [0, 0.035, 0], [0, 0, 0.06], '#ff9a20');
    for (const [dx, dz, h] of [[0, 0, 0.1], [-0.05, 0.04, 0.07], [-0.05, -0.04, 0.07]]) b.box(dx, 1.1 + h / 2, dz, [0.015, 0, 0], [0, h / 2, 0], [0, 0, 0.015], '#ffd84a');
    for (const z of [0.12, -0.12]) b.box(0.212, 0.82, z, [0.008, 0, 0], [0, 0.03, 0], [0, 0, 0.035], '#ffa0a0'); // ほっぺ
    for (const z of [0.25, -0.25]) b.box(-0.02, 0.4, z, [0.12, 0, 0], [0, 0.16, 0], [0, 0, 0.03], '#f8c830');
  } else if (kind === 'aloha') {
    // アロハ：サングラス・麦わら帽子・シャツの花がら
    b.box(-0.04, 1.06, 0, [0.21, 0, 0], [0, 0.07, 0], [0, 0, 0.21], hair);
    b.box(0.21, 0.92, 0, [0.015, 0, 0], [0, 0.045, 0], [0, 0, 0.17], '#14141a');
    b.box(0.215, 0.95, 0, [0.012, 0, 0], [0, 0.012, 0], [0, 0, 0.19], '#2a2a32');
    b.lathe(-0.02, 1.1, 0, [[0, 0.34], [0.03, 0.34], [0.05, 0.2]], '#e8c870', 12);
    b.lathe(-0.02, 1.12, 0, [[0, 0.19], [0.06, 0.19], [0.17, 0.16], [0.21, 0.02]], '#e8c870', 10);
    for (const [y, z] of [[0.45, 0.1], [0.25, -0.12], [0.15, 0.08], [0.5, -0.06]]) b.box(0.185, y, z, [0.01, 0, 0], [0, 0.04, 0], [0, 0, 0.04], '#ffffff');
  } else if (kind === 'reindeer') {
    eyes('#151515', 0.95);
    b.box(0.26, 0.8, 0, [0.06, 0, 0], [0, 0.07, 0], [0, 0, 0.12], '#b07a48'); // 口のまわり
    b.box(0.33, 0.83, 0, [0.03, 0, 0], [0, 0.04, 0], [0, 0, 0.045], '#ff2020'); // 赤い鼻
    for (const z of [0.215, -0.215]) b.box(-0.02, 1.0, z, [0.05, 0, 0], [0, 0.03, 0], [0, 0, 0.04], '#8a5a30'); // 耳
    for (const sz of [1, -1]) {
      // 角（枝分かれ）
      b.beam([-0.02, 1.07, sz * 0.1], [-0.06, 1.3, sz * 0.18], 0.035, 0.035, '#5a3a1a');
      b.beam([-0.06, 1.3, sz * 0.18], [-0.12, 1.42, sz * 0.14], 0.03, 0.03, '#5a3a1a');
      b.beam([-0.04, 1.22, sz * 0.15], [0.04, 1.34, sz * 0.24], 0.03, 0.03, '#5a3a1a');
      b.beam([-0.06, 1.3, sz * 0.18], [-0.04, 1.42, sz * 0.27], 0.03, 0.03, '#5a3a1a');
    }
    b.box(0.0, 0.66, 0, [0.21, 0, 0], [0, 0.035, 0], [0, 0, 0.24], '#d8283a'); // マフラー
    b.box(0.19, 0.5, 0.14, [0.012, 0, 0], [0, 0.12, 0], [0, 0, 0.04], '#d8283a');
  } else if (kind === 'robot') {
    b.box(0.21, 0.9, 0, [0.012, 0, 0], [0, 0.05, 0], [0, 0, 0.16], '#1a2230'); // 目の窓
    for (const z of [0.08, -0.08]) b.box(0.227, 0.9, z, [0.008, 0, 0], [0, 0.025, 0], [0, 0, 0.04], '#40e8ff'); // 光る目
    b.box(0.21, 0.76, 0, [0.01, 0, 0], [0, 0.015, 0], [0, 0, 0.1], '#6a7284'); // 口
    for (const z of [0.215, -0.215]) b.box(0, 0.88, z, [0.06, 0, 0], [0, 0.06, 0], [0, 0, 0.02], '#6a7284'); // 耳のボルト
    b.cyl([0, 1.08, 0], [0, 1.28, 0], 0.015, '#6a7284', 5); // アンテナ
    b.box(0, 1.3, 0, [0.035, 0, 0], [0, 0.035, 0], [0, 0, 0.035], '#ff4050');
    b.box(0.185, 0.4, 0, [0.01, 0, 0], [0, 0.08, 0], [0, 0, 0.1], '#3a4250'); // 胸のパネル
  }
  const body = new THREE.Mesh(b.geometry(), VC);
  g.add(body);
  // 腕（肩を軸に回す）
  const ab = new Builder();
  for (const s of [-0.28, 0.28]) {
    ab.box(0, 0.28, s, [0.07, 0, 0], [0, 0.28, 0], [0, 0, 0.07], kind === 'panda' ? '#1e1e22' : shirt);
    ab.box(0, 0.6, s, [0.07, 0, 0], [0, 0.06, 0], [0, 0, 0.07], hand);
  }
  const arms = new THREE.Mesh(ab.geometry(), VC);
  arms.position.set(0.05, 0.55, 0);
  g.add(arms);
  g.userData.arms = arms;
  g.userData.body = body;
  return g;
}

// ---------------- 観客 ----------------
export class Crowd {
  constructor(n) {
    this.n = n;
    const b = new Builder();
    b.box(0, 0.75, 0, [0.2, 0, 0], [0, 0.45, 0], [0, 0, 0.26], '#ffffff');
    const bodyG = b.geometry();
    const hb = new Builder();
    hb.box(0, 1.42, 0, [0.17, 0, 0], [0, 0.19, 0], [0, 0, 0.17], '#f2c9a0');
    hb.box(-0.03, 1.6, 0, [0.18, 0, 0], [0, 0.06, 0], [0, 0, 0.18], '#2a1f17');
    const headG = hb.geometry();
    const lb = new Builder();
    lb.box(0, 0.15, -0.1, [0.08, 0, 0], [0, 0.15, 0], [0, 0, 0.08], '#3a4a6a');
    lb.box(0, 0.15, 0.1, [0.08, 0, 0], [0, 0.15, 0], [0, 0, 0.08], '#3a4a6a');
    const legG = lb.geometry();
    const mB = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.body = new THREE.InstancedMesh(bodyG, mB, n);
    this.head = new THREE.InstancedMesh(headG, VC, n);
    this.legs = new THREE.InstancedMesh(legG, VC, n);
    // 魔女の帽子（ハロウィンの仮装。かぶらない人は大きさ 0）
    const tb = new Builder();
    tb.cyl([0, 1.66, 0], [0, 1.69, 0], 0.34, '#1e1428', 10);
    tb.lathe(0, 1.69, 0, [[0, 0.2], [0.1, 0.19], [0.14, 0.17], [0.45, 0.07], [0.6, 0.01]], '#1e1428', 8);
    tb.lathe(0, 1.69, 0, [[0, 0.205], [0.08, 0.195]], '#a050e0', 8);
    this.witchG = tb.geometry();
    // サンタの帽子（クリスマス）
    const sb = new Builder();
    sb.lathe(0, 1.64, 0, [[0, 0.21], [0.08, 0.21]], '#f8f8f8', 10);
    sb.lathe(-0.02, 1.72, 0, [[0, 0.19], [0.2, 0.13], [0.36, 0.04]], '#d8283a', 8);
    sb.box(-0.02, 2.1, 0, [0.06, 0, 0], [0, 0.06, 0], [0, 0, 0.06], '#f8f8f8');
    this.santaG = sb.geometry();
    // 麦わら帽子（夏）
    const mb = new Builder();
    mb.lathe(0, 1.64, 0, [[0, 0.36], [0.03, 0.36], [0.05, 0.2]], '#e8c870', 12);
    mb.lathe(0, 1.66, 0, [[0, 0.19], [0.06, 0.19], [0.18, 0.16], [0.22, 0.02]], '#e8c870', 10);
    mb.lathe(0, 1.68, 0, [[0, 0.195], [0.05, 0.195]], '#e8384f', 10);
    this.strawG = mb.geometry();
    this.hat = new THREE.InstancedMesh(this.witchG, VC, n);
    this.group = new THREE.Group();
    this.group.add(this.body, this.head, this.legs, this.hat);
    for (const m of [this.body, this.head, this.legs, this.hat]) {
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    }
    this.people = [];
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.e = new THREE.Euler();
    this.v = new THREE.Vector3();
    this.s = new THREE.Vector3(1, 1, 1);
  }
  // 人を置く：駅の前の行列と、敷地のまわり（線路の下は避ける）
  setHat(tid) {
    this.hat.geometry = tid === 'xmas' ? this.santaG : tid === 'summer' ? this.strawG : this.witchG;
  }
  // mapId：テーマ（ハロウィンは仮装の色と帽子、クリスマスは冬服とサンタの帽子）、avoid：飾りのある所 [[x, z, r]...]
  place(tr, seed = 3, mapId = 0, avoid = []) {
    const r = mulberry(seed);
    const tid = mapOf(mapId).id;
    const dress = tid === 'halloween' || tid === 'xmas' || tid === 'summer';
    const palette = { halloween: COSTUME, xmas: WINTER, summer: SUMMER }[tid] || SHIRT;
    this.setHat(tid);
    this.people = [];
    const near = (x, z) => {
      if (!tr) return false;
      for (let i = 0; i < tr.n; i += 4) if (Math.abs(tr.px[i] - x) < 4 && Math.abs(tr.pz[i] - z) < 4) return true;
      return false;
    };
    const add = (x, z, face) => {
      const c = palette[Math.floor(r() * palette.length)];
      this.people.push({ x, z, x0: x, z0: z, face, phase: r() * 6, jump: 0, cheer: 0, run: 0, rvx: 0, rvz: 0, c, h: 0.85 + r() * 0.25, hat: dress && r() < 0.4 });
    };
    // 行列（駅の手前）
    for (let k = 0; k < 14; k++) add(STATION.x0 - 4 + k * 1.2 + (r() - 0.5) * 0.3, STATION.z + 7 + (k % 2) * 0.8, -Math.PI / 2);
    let tries = 0;
    while (this.people.length < this.n && tries < 3000) {
      tries++;
      const side = r();
      let x;
      let z;
      if (side < 0.45) {
        // 敷地の外周（生け垣の内側）
        const a = r() * Math.PI * 2;
        x = Math.cos(a) * (FIELD.x1 + 1 + r() * 2);
        z = Math.sin(a) * (FIELD.z1 + 1 + r() * 2);
      } else if (side < 0.7) {
        x = STATION.x0 - 10 + r() * 44;
        z = STATION.z + 6 + r() * 6;
      } else {
        x = FIELD.x0 + r() * (FIELD.x1 - FIELD.x0);
        z = FIELD.z0 + r() * (FIELD.z1 - FIELD.z0);
      }
      if (inWater(mapId, x, z, 1.5)) continue;
      if (avoid.some((t) => Math.hypot(t[0] - x, t[1] - z) < t[2] + 0.5)) continue;
      if (Math.abs(z - STATION.z) < 4.5 && x > STATION.x0 - 3 && x < STATION.x1 + 3) continue;
      if (near(x, z)) continue;
      add(x, z, Math.atan2(-x, -z) + (r() - 0.5));
    }
    for (let i = 0; i < this.people.length; i++) this.body.setColorAt(i, col(this.people[i].c));
    this.body.instanceColor.needsUpdate = true;
    this.update(0, null, 0);
  }
  // 盛り上がり（0〜1）・逃げる中心（事故の場所）
  update(dt, panicAt, hype, focus = null) {
    const { m, q, e, v, s } = this;
    const n = this.people.length;
    for (let i = 0; i < n; i++) {
      const p = this.people[i];
      p.phase += dt * (3 + hype * 6);
      if (panicAt) {
        const dx = p.x - panicAt[0];
        const dz = p.z - panicAt[2];
        const d = Math.hypot(dx, dz) || 1;
        if (d < 40) {
          const sp = (6 * (40 - d)) / 40 + 1.5;
          p.x += (dx / d) * sp * dt;
          p.z += (dz / d) * sp * dt;
          p.face = Math.atan2(dx, dz);
          p.run = 1;
        }
      } else if (focus) {
        // 列車のほうを見る
        const want = Math.atan2(focus[0] - p.x, focus[2] - p.z);
        let d = want - p.face;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        p.face += d * Math.min(1, dt * 2);
      }
      const hop = p.run ? Math.abs(Math.sin(p.phase * 2)) * 0.25 : Math.max(0, Math.sin(p.phase)) * 0.5 * hype;
      e.set(0, p.face + Math.PI / 2, p.run ? -0.25 : 0);
      q.setFromEuler(e);
      v.set(p.x, hop, p.z);
      s.set(p.h, p.h, p.h);
      m.compose(v, q, s);
      this.body.setMatrixAt(i, m);
      this.head.setMatrixAt(i, m);
      this.legs.setMatrixAt(i, m);
      if (!p.hat) m.makeScale(0, 0, 0);
      this.hat.setMatrixAt(i, m);
    }
    for (const mm of [this.body, this.head, this.legs, this.hat]) {
      mm.count = n;
      mm.instanceMatrix.needsUpdate = true;
    }
  }
}

// ---------------- 飛び散るもの（土ぼこり・水しぶき・火花・星） ----------------
export class Particles {
  constructor(max = 400) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.colr = new Float32Array(max * 3);
    this.list = [];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.colr, 3).setUsage(THREE.DynamicDrawUsage));
    const dot = canvasTex(32, 32, (x, w, h) => {
      const gr = x.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      gr.addColorStop(0, 'rgba(255,255,255,1)');
      gr.addColorStop(0.5, 'rgba(255,255,255,0.8)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = gr;
      x.fillRect(0, 0, w, h);
    });
    // 足し算で重ねる（色を暗くして消すので、黒い玉にならない）
    this.points = new THREE.Points(g, new THREE.PointsMaterial({ size: 1.4, map: dot, vertexColors: true, transparent: true, depthWrite: false, sizeAttenuation: true, blending: THREE.AdditiveBlending }));
    this.points.frustumCulled = false;
    this.geo = g;
  }
  burst(x, y, z, n, color, speed = 6, up = 4, life = 1.2, grav = 9.8) {
    const c = col(color);
    for (let k = 0; k < n; k++) {
      if (this.list.length >= this.max) this.list.shift();
      const a = Math.random() * Math.PI * 2;
      const s = Math.random() * speed;
      this.list.push({ x, y, z, vx: Math.cos(a) * s, vy: up * (0.5 + Math.random()), vz: Math.sin(a) * s, t: 0, life: life * (0.6 + Math.random() * 0.6), c, grav });
    }
  }
  update(dt) {
    const L = this.list;
    let w = 0;
    for (let i = 0; i < L.length; i++) {
      const p = L[i];
      p.t += dt;
      if (p.t > p.life) continue;
      p.vy -= p.grav * dt;
      p.x += p.vx * dt;
      p.y = Math.max(0.1, p.y + p.vy * dt);
      p.z += p.vz * dt;
      L[w++] = p;
    }
    L.length = w;
    for (let i = 0; i < w; i++) {
      const p = L[i];
      this.pos[i * 3] = p.x;
      this.pos[i * 3 + 1] = p.y;
      this.pos[i * 3 + 2] = p.z;
      const f = 1 - p.t / p.life;
      this.colr[i * 3] = p.c.r * f;
      this.colr[i * 3 + 1] = p.c.g * f;
      this.colr[i * 3 + 2] = p.c.b * f;
    }
    this.geo.setDrawRange(0, w);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }
}

export function makeStarSprite() {
  const tex = canvasTex(128, 128, (x, w, h) => {
    x.translate(w / 2, h / 2);
    x.fillStyle = '#fff6a0';
    x.beginPath();
    for (let k = 0; k < 8; k++) {
      const r = k % 2 ? 14 : 60;
      const a = (k / 8) * Math.PI * 2;
      x.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    x.closePath();
    x.fill();
  });
  const m = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false });
  return m;
}

// ---------------- 線路の見た目を、物理の状態に合わせる ----------------
const tmpQ = new THREE.Quaternion();
const tmpAx = new THREE.Vector3();
const tmpV = new THREE.Vector3();
export function syncChunks(meshes, sim, build = 1, bulbs = null) {
  for (let c = 0; c < meshes.length; c++) {
    const m = meshes[c];
    const st = sim ? sim.chunkSt[c] : null;
    if (st && st.started) {
      tmpAx.set(st.dz, 0, -st.dx);
      tmpQ.setFromAxisAngle(tmpAx, st.th);
      m.quaternion.copy(tmpQ);
      m.position.y = -st.drop;
      m.scale.set(1, 1, 1);
    } else {
      m.quaternion.identity();
      m.position.y = 0;
      // 組み立ての演出：かたまりが順に地面から伸びる
      const k = clamp(build * meshes.length * 1.15 - c, 0, 1);
      const e = 1 - (1 - k) ** 3;
      m.visible = k > 0;
      m.scale.set(1, Math.max(0.001, e), 1);
    }
  }
  if (bulbs) {
    // 電球を、のっているかたまりと同じように動かす（見えないかたまりの電球は地面の下へ）
    const pos = bulbs.points.geometry.attributes.position;
    const a = pos.array;
    const L = bulbs.local;
    for (const m of meshes) m.updateMatrix();
    for (let k = 0; k < bulbs.ci.length; k++) {
      const m = meshes[bulbs.ci[k]];
      if (!m.visible) {
        a[k * 3 + 1] = -100;
        continue;
      }
      tmpV.set(L[k * 3], L[k * 3 + 1], L[k * 3 + 2]).applyMatrix4(m.matrix);
      a[k * 3] = tmpV.x;
      a[k * 3 + 1] = tmpV.y;
      a[k * 3 + 2] = tmpV.z;
    }
    pos.needsUpdate = true;
  }
}
export { Builder, canvasTex, mulberry, CAR_COLORS, riderSeat };

// 夜：駅の屋根のふちの電球
export function buildStationLights() {
  const { x0, x1, z, h } = STATION;
  const lp = [];
  const lc = [];
  for (let x = x0 - 1.5, k = 0; x <= x1 + 1.5; x += 1, k++) {
    lp.push(x, h + 4.05, z + 4.35);
    const c = col(k % 2 ? '#fff2c0' : '#ff8aa0');
    lc.push(c.r, c.g, c.b);
  }
  return glowPoints(lp, lc, 1.4);
}
