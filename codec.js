// codec.js — 設計（上から描いた道・高さ・しかけ・設定）を、URL に載せる短い文字列にする・戻す
// 同じ文字列からは同じ線路・同じ結果になる（シミュレーションは決まった種の乱数で動く）。
// 形：1 バイト目が版。数は 0.5 m 単位に丸める。点は前の点との差を可変長の整数で詰める。
// 点の後ろに装飾（見た目）の 2 バイト（線路の色・車両の色 / 乗る人・景色 を 3 ビットずつ）。
// 装飾は後から足したので、無ければ今の見た目にする（古いリンクも開け、古い版のゲームは余りを読まない）。
// その後ろにマップの 1 バイト（1.1.1 で足した。無ければいつもの遊園地）、
// さらに線路の色・車両の色・乗る人の番号の上の 2 ビットずつの 1 バイト（1.1.3。テーマの見た目で 8 個を超えたため）。
import { H_SAMPLES, H_MAX, H_MIN, FIELD, GIMMICK_KEYS, MATS, BARS, STARTS, MAX_GIMMICKS, MAX_CARS, MAPS } from './track.js';
import { cleanLook, defaultLook } from './looks.js';

const VER = 2;
const MAX_POINTS = 8192;
const MAX_CODE_LENGTH = 180000;
const OX_V1 = 80; // 旧共有URLの座標オフセット
const OX_V2 = 601; // 拡張敷地 -600..600m を収める新オフセット

function b64(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64(str) {
  const s = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
function varint(out, v) {
  v = v < 0 ? -v * 2 - 1 : v * 2; // ジグザグ
  while (v >= 0x80) {
    out.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  out.push(v);
}
function readVarint(r) {
  let v = 0;
  let sh = 0;
  for (;;) {
    if (r.i >= r.b.length) throw new Error('short');
    const b = r.b[r.i++];
    v |= (b & 0x7f) << sh;
    if (!(b & 0x80)) break;
    sh += 7;
    if (sh > 28) throw new Error('long');
  }
  return v & 1 ? -(v + 1) / 2 : v / 2;
}

// 道の点を間引く（2 m 以上離し、ほぼ直線の所は Douglas-Peucker で落とす）
export function simplify(pts, tol = 0.35) {
  if (pts.length < 3) return pts.slice();
  const a = [pts[0]];
  for (const p of pts) {
    const q = a[a.length - 1];
    if (Math.hypot(p[0] - q[0], p[1] - q[1]) >= 2) a.push(p);
  }
  const last = pts[pts.length - 1];
  if (a[a.length - 1] !== last) a.push(last);
  const keep = new Uint8Array(a.length);
  keep[0] = keep[a.length - 1] = 1;
  const stack = [[0, a.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    let best = -1;
    let bd = tol;
    const [x0, z0] = a[i];
    const [x1, z1] = a[j];
    const L = Math.hypot(x1 - x0, z1 - z0) || 1;
    for (let k = i + 1; k < j; k++) {
      const d = Math.abs((x1 - x0) * (z0 - a[k][1]) - (x0 - a[k][0]) * (z1 - z0)) / L;
      if (d > bd) {
        bd = d;
        best = k;
      }
    }
    if (best > 0) {
      keep[best] = 1;
      stack.push([i, best], [best, j]);
    }
  }
  return a.filter((_, k) => keep[k]);
}

export const cleanMap = (m) => (Number.isInteger(m) && m >= 0 && m < MAPS.length ? m : 0);

export function encode(d) {
  const out = [VER, (d.mat & 3) | ((d.bar & 3) << 2) | ((d.start & 3) << 4), d.cars & 7];
  const gm = (d.gm || []).slice(0, MAX_GIMMICKS);
  out.push(gm.length);
  for (const g of gm) {
    const u = Math.round(Math.min(1, Math.max(0, g.u)) * 4095);
    out.push(GIMMICK_KEYS.indexOf(g.t), u >> 8, u & 255);
  }
  for (let k = 0; k < H_SAMPLES; k++) out.push(Math.round(Math.min(H_MAX, Math.max(H_MIN, d.hs[k] ?? 2)) * 2));
  const pts = d.pts.slice(0, MAX_POINTS);
  out.push(pts.length >> 8, pts.length & 255);
  let px = 0;
  let pz = 0;
  for (const [x, z] of pts) {
    const qx = Math.round((x + OX_V2) * 2);
    const qz = Math.round((z + OX_V2) * 2);
    varint(out, qx - px);
    varint(out, qz - pz);
    px = qx;
    pz = qz;
  }
  const lk = cleanLook(d.look);
  out.push((lk.rail & 7) | ((lk.car & 7) << 3), (lk.rider & 7) | (lk.scene << 3));
  out.push(cleanMap(d.map));
  out.push((lk.rail >> 3) | ((lk.car >> 3) << 2) | ((lk.rider >> 3) << 4));
  return b64(out);
}

// 壊れた・いじられた文字列は null を返す
export function decode(str) {
  try {
    if (!str || str.length > MAX_CODE_LENGTH) return null;
    const b = unb64(str);
    const r = { b, i: 0 };
    const rd = () => {
      if (r.i >= b.length) throw new Error('short');
      return b[r.i++];
    };
    const version = rd();
    if (version !== 1 && version !== VER) return null;
    const offset = version === 1 ? OX_V1 : OX_V2;
    const f = rd();
    const d = { mat: f & 3, bar: (f >> 2) & 3, start: (f >> 4) & 3, cars: rd(), gm: [], hs: [], pts: [] };
    if (d.mat >= MATS.length || d.bar >= BARS.length || d.start >= STARTS.length) return null;
    if (d.cars < 1 || d.cars > MAX_CARS) return null;
    const ng = rd();
    if (ng > MAX_GIMMICKS) return null;
    for (let k = 0; k < ng; k++) {
      const t = GIMMICK_KEYS[rd()];
      const u = ((rd() << 8) | rd()) / 4095;
      if (!t) return null;
      d.gm.push({ t, u });
    }
    for (let k = 0; k < H_SAMPLES; k++) d.hs.push(Math.min(H_MAX, Math.max(H_MIN, rd() / 2)));
    const n = (rd() << 8) | rd();
    if (n < 2 || n > MAX_POINTS) return null;
    let px = 0;
    let pz = 0;
    for (let k = 0; k < n; k++) {
      px += readVarint(r);
      pz += readVarint(r);
      const x = px / 2 - offset;
      const z = pz / 2 - offset;
      if (x < FIELD.x0 - 1 || x > FIELD.x1 + 1 || z < FIELD.z0 - 1 || z > FIELD.z1 + 1) return null;
      d.pts.push([x, z]);
    }
    d.look = defaultLook();
    if (r.i + 2 <= b.length) {
      const a = b[r.i++];
      const c = b[r.i++];
      d.look = cleanLook({ rail: a & 7, car: (a >> 3) & 7, rider: c & 7, scene: (c >> 3) & 7 });
    }
    d.map = r.i < b.length ? cleanMap(b[r.i++]) : 0;
    if (r.i < b.length) {
      const e = b[r.i++];
      const l = d.look;
      d.look = cleanLook({ ...l, rail: l.rail | ((e & 3) << 3), car: l.car | (((e >> 2) & 3) << 3), rider: l.rider | (((e >> 4) & 3) << 3) });
    }
    return d;
  } catch (e) {
    return null;
  }
}

// 丸めた形にそろえる（自分の画面とシェア先で、同じ数から計算するため）
export function normalize(d) {
  return decode(encode({ ...d, pts: simplify(d.pts) }));
}
