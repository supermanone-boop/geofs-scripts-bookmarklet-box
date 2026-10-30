// track.js — 手書きの道（上から）と高さ（横から）としかけから、3D の線路を組み立てる
// THREE を使わない（node でもそのまま動き、物理の確かめに使える）。
// 座標：x が右、y が上、z が手前（上から見た図では下）。地面は y = 0。

export const G = 9.81;
// 敷地（上から見た図に描ける範囲、m）
export const FIELD = { x0: -600, x1: 600, z0: -600, z1: 600 };
// 駅：x0 → x1 の向き（右向き）に走る、まっすぐな 24 m
export const STATION = { x0: -12, x1: 12, z: 38, h: 2.0 };
export const ST_LEN = STATION.x1 - STATION.x0;
export const DS = 0.5; // 線路の点の間隔（m）
export const H_SAMPLES = 96; // 高さの手書きを何点で持つか
export const H_MIN = 1.0;
export const H_MAX = Infinity;
export const CHUNK = 20; // 線路を何点ずつのかたまりで作るか（10 m。壊れるときの単位）
export const MIN_R = 3; // 上から見たカーブの最小半径（m）。急なカーブも描いたとおりに作り、物理の結果に任せる（0.1.5 で 6 m、0.1.11 で 3 m。せまいヘアピンを描くと、半径 6 m では外にふくらんだ輪になり、となりの線路とぶつかった）
export const ST_R = 15.75; // 駅に戻るつなぎ（Dubins 曲線）の半径（m）
// 池（飾り。物が落ちると水しぶき）
export const POND = { x: -40, z: -14, r: 13 };
// マップ（テーマ。① で選ぶ。設計と一緒に URL に載る）。地面は平らで、物理で変わるのは水（池・沼）に落ちる所だけ。
// ponds：丸い池、pools：四角いプール（どちらも落ちると水しぶき）、scene：景色（world.js の SCENES。null は ④ の見た目で選ぶ）
// splash：水に落ちたときの一言と色、loopName：おまかせの型「池をぐるっと」の、このテーマでの呼び名
// 飾りの置き場所は themes.js、作りは world.js
export const MAPS = [
  {
    id: 'park', name: 'いつもの遊園地', short: 'いつもの', icon: '🎡', ponds: [POND], pondName: '池', scene: null, loopName: '池をぐるっと',
    splash: { word: 'ザブーン！', color: '#7fd8ff', fx: '#d8f0ff', quote: '池に何か落ちた！' },
  },
  {
    id: 'halloween', name: 'ハロウィン', short: 'ハロウィン', icon: '🎃', ponds: [{ x: -40, z: -14, r: 11 }], pondName: '沼', scene: 'halloween', loopName: '沼をぐるっと',
    splash: { word: 'ブクブク…', color: '#9aff6a', fx: '#7aff40', quote: '沼に何か沈んだ…！' },
  },
  {
    id: 'xmas', name: 'クリスマス', short: 'クリスマス', icon: '🎄', ponds: [{ x: -40, z: -14, r: 11 }], pondName: 'リンク', scene: 'xmas', loopName: 'リンクをぐるっと',
    splash: { word: 'ツルーン！', color: '#bfe8ff', fx: '#e8f6ff', quote: 'スケートリンクに何か落ちた！' },
  },
  {
    id: 'summer', name: '夏のプールと花火', short: 'プール', icon: '🎆', ponds: [{ x: 30, z: -32, r: 6 }], pondName: 'こども', poolName: 'プール', pools: [{ x0: -64, x1: -24, z0: -44, z1: -18 }], scene: 'summer', loopName: 'プールをぐるっと',
    splash: { word: 'バシャーン！', color: '#7fe0ff', fx: '#d8f6ff', quote: 'プールに何か落ちた！' },
  },
];
export const mapOf = (i) => MAPS[i] || MAPS[0];
// (x, z) が水の中か。pad > 0 で水のまわりも含める、< 0 で岸から内側だけ
export function inWater(map, x, z, pad = 0) {
  const M = mapOf(map);
  for (const p of M.ponds) if (Math.hypot(x - p.x, z - p.z) < p.r + pad) return true;
  for (const q of M.pools || []) if (x > q.x0 - pad && x < q.x1 + pad && z > q.z0 - pad && z < q.z1 + pad) return true;
  return false;
}

// 線路の素材：v = 上下の強さ（G）、l = 横の強さ（G）、cascade = 壊れたときに一緒に崩れる範囲（かたまりの数）、cost = 1 m あたりの費用（万円）
export const MATS = [
  { id: 'wood', name: '木製', v: 4.6, l: 2.6, cascade: 5, cost: 6 },
  { id: 'steel', name: '鉄製', v: 6.5, l: 3.8, cascade: 3, cost: 10 },
  { id: 'alloy', name: '超合金', v: 10, l: 6.5, cascade: 2, cost: 18 },
];
// 安全バー：v = どこまでの浮き上がり（マイナスの G）に耐えるか、l = 横の G、hold = 事故のとき席に残る割合、cost = 1 席あたり（万円）
export const BARS = [
  { id: 'belt', name: 'ベルトだけ', v: 0.7, l: 1.9, hold: 0.1, cost: 10 },
  { id: 'bar', name: '安全バー', v: 1.6, l: 2.7, hold: 0.5, cost: 30 },
  { id: 'harness', name: 'がっちりハーネス', v: 3.2, l: 4.5, hold: 0.85, cost: 70 },
];
// スタートのしかた：chain = 最初の坂をチェーンで巻き上げる。launch = 駅を出たところで発射
export const STARTS = [
  { id: 'chain', name: '巻き上げ', v: 0, cost: 200 },
  { id: 'l70', name: '発射 70km/h', v: 70 / 3.6, cost: 500 },
  { id: 'l100', name: '発射 100km/h', v: 100 / 3.6, cost: 800 },
  { id: 'l130', name: '発射 130km/h', v: 130 / 3.6, cost: 1200 },
];
// しかけ：len = 道の上で使う長さ（m）
export const GIMMICKS = {
  loop: { name: '宙返り', len: 0, cost: 900, color: '#e84a5f' },
  boost: { name: 'ブースター', len: 20, cost: 500, color: '#f8b800' },
  brake: { name: 'ブレーキ', len: 16, cost: 200, color: '#3aa0ff' },
  jump: { name: 'ジャンプ', len: 14, cost: 300, color: '#a14aff' },
};
export const GIMMICK_KEYS = Object.keys(GIMMICKS);
export const MAX_GIMMICKS = 8;
export const BUDGET = 10000; // 予算（万円）。0.1.10 で上限としては使わなくなった（結果の画面の「建設費」の目安だけ）
export const MAX_LEN = 5000; // 拡張版：最大 5 km。極端な負荷を避けるため、無制限にはしない
export const BASE_COST = 1000; // 駅と車両の基本（万円）
export const CAR_COST = 300;
export const MAX_CARS = 6;
export const LOOP_LEN = 80; // 宙返りの線路の長さ（m）。高さは約 17 m（時速 70km ほどで入ると、まわりきれる）
export const LOOP_W = 3.2; // 宙返りの入口と出口の横のずれ（m）
export const GAP_LEN = 14;
export const JUMP_KICK = 1.82; // 踏み切り台の高さ（10 m で 20 度まで起き上がる）

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth01 = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

// ---------------- 2D の道 ----------------
function hermite(p0, t0, p1, t1, step = 1) {
  const d = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
  const m = Math.max(6, d * 1.1);
  const n = Math.max(2, Math.ceil((d * 1.3) / step));
  const out = [];
  for (let k = 1; k < n; k++) {
    const t = k / n;
    const h00 = 2 * t ** 3 - 3 * t ** 2 + 1;
    const h10 = t ** 3 - 2 * t ** 2 + t;
    const h01 = -2 * t ** 3 + 3 * t ** 2;
    const h11 = t ** 3 - t ** 2;
    out.push([
      h00 * p0[0] + h10 * m * t0[0] + h01 * p1[0] + h11 * m * t1[0],
      h00 * p0[1] + h10 * m * t0[1] + h01 * p1[1] + h11 * m * t1[1],
    ]);
  }
  return out;
}
function dir2(a, b) {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const l = Math.hypot(dx, dz) || 1;
  return [dx / l, dz / l];
}
// 折れ線を間隔 step で打ち直す
export function resample2(pts, step) {
  const out = [pts[0].slice()];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (l < 1e-9) continue;
    let d = step - carry;
    while (d <= l) {
      const t = d / l;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      d += step;
    }
    carry = l - (d - step);
  }
  const last = pts[pts.length - 1];
  const e = out[out.length - 1];
  // 最後の点は必ず残す（近すぎるときは置きかえる。打ち直すたびに端が縮んでいかないように）
  if (Math.hypot(last[0] - e[0], last[1] - e[1]) > step * 0.3) out.push(last.slice());
  else if (out.length > 1) out[out.length - 1] = last.slice();
  return out;
}
export function polyLen(pts) {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return l;
}

// 上から描いた線（駅の出口から始まり、入口に戻るように前後をつなぐ）→ 1 m 間隔のなめらかな道
export const leadOf = (design) => (design.start > 0 ? 36 : 12);
// 発射のあとのゆるいカーブの半径（m）。横の G を約 6 G に抑える（130 km/h で 22 m。駅を出て 36 m の直線の先から曲がると、
// ちょうど敷地の右端に収まる。0.1.24 までは 5.5 G・24 m で、敷地の外にはみ出していた）。70・100 km/h は ST_R
export const launchRadius = (v) => Math.max(ST_R, (v * v) / (6 * G));
// ゆるいカーブにする長さ（m。直線の終わりから）。70 km/h で 70 m、100 km/h で 100 m、130 km/h で 130 m
export const launchGentle = (v) => Math.max(50 * (launchRadius(v) / ST_R) ** 2, v * 3.6);
// 設計から道を作る（発射の速さも渡す）
export const pathOf = (design) => horizPath(design.pts, leadOf(design), STARTS[design.start || 0].v);
// 上から描いた線 → 1 m 間隔の道（駅の出口から、描いた線をなぞって、駅の入口へ戻る）。
// 車を運転するように、描いた線の少し先の点へ向かってハンドルを切りながら進む。切れる角度に上限があるので、
// カーブの半径は MIN_R より小さくならない。5 m 先を見るので、描いた線にほぼ沿う（手のぶれは、前後 3 m の平均でならしてから）。
// 最後は、駅の入口の手前（まっすぐな所の始まり）へ、半径 ST_R の円とまっすぐな線だけでつなぐ（Dubins 曲線）。
// lead：駅を出てからまっすぐ走る長さ（発射のときは長くする）。launchV：発射の速さ（m/s。巻き上げは 0）
export function horizPath(stroke, lead = 12, launchV = 0) {
  const E = [STATION.x1, STATION.z];
  const A = [STATION.x0, STATION.z];
  const tail = 12; // 駅に入る前のまっすぐな長さ
  const R = MIN_R;
  let s = (stroke || []).filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (s.length < 2) s = [[40, 30], [50, -20], [-50, -20], [-40, 30]];
  s = s.map((p) => [clamp(p[0], FIELD.x0 + 2, FIELD.x1 - 2), clamp(p[1], FIELD.z0 + 2, FIELD.z1 - 2)]);
  const E6 = [E[0] + lead, E[1]];
  const A6 = [A[0] - tail, A[1]];
  // 駅のすぐそばの点は使わない
  const far = (q, c, r) => Math.hypot(q[0] - c[0], q[1] - c[1]) > r;
  // 描き始めが駅の出口の後ろ（左）に向かう小さなかぎ形のときも、その点は使わない（そのままだと、Uターンのために駅の上で輪を描く）。
  // 駅を出てからの直線から 30 m 以内の点だけ。それより遠くへ後ろ向きに描いた線は、外側をまわる点をはさんでなぞる
  // 発射のときは駅を出てからの直線が 36 m と長いので、直線の終わりの点ではなく、直線（E〜E6）からの距離で見る
  // （0.1.12 までは終わりの点から測っていたので、直線の横から描き始めると後ろ向きの点が残り、外側をまわってから描き始めへ戻る輪ができた）
  const nearLead = (q) => Math.hypot(q[0] - clamp(q[0], E[0], E6[0]), q[1] - E[1]) <= 30;
  let i0 = 0;
  while (i0 < s.length - 2 && (!far(s[i0], E6, 14) || (s[i0][0] < E6[0] + 4 && nearLead(s[i0])))) i0++;
  let i1 = s.length - 1;
  while (i1 > i0 + 1 && (!far(s[i1], A6, 14) || (s[i1][0] > A6[0] - 4 && !far(s[i1], A6, 30)))) i1--;
  s = s.slice(i0, i1 + 1);
  let tg = s;
  // 駅の出口の左（後ろ）から始まる・入口の右（先）で終わる線は、駅の外側にまわりこむ点をはさむ
  if (tg[0][0] < E6[0] + 4) tg = [[Math.min(E6[0] + 16, FIELD.x1 - 12), E[1] - 14], ...tg];
  // 入口の右（先）で終わる線は、駅の左の奥をまわって南向きに下りてくる点をはさむ（駅の下側は敷地が狭く、そのままだと敷地の外で U ターンする）
  // 入口の右（先）で終わる線は、なぞり終えたら、駅の左の奥の点（W）へ南向きに入ってから駅へつなぐ
  // （駅の下側は敷地が狭いので、そのまま U ターンすると敷地の外に出る）
  const wrongEnd = tg[tg.length - 1][0] > A6[0] - 4;
  const W = [Math.max(A6[0] - 30, FIELD.x0 + 18), A6[1] - 20, Math.PI / 2];
  tg = resampleN([E6, ...tg], 1);
  // 手のぶれをならす（前後 3 m の平均。両端はそのまま）
  for (let pass = 0; pass < 2; pass++) {
    const q = tg.map((v) => v.slice());
    for (let i = 3; i < tg.length - 3; i++) {
      let x = 0;
      let z = 0;
      for (let k = -3; k <= 3; k++) {
        x += tg[i + k][0];
        z += tg[i + k][1];
      }
      q[i] = [x / 7, z / 7];
    }
    tg = q;
  }
  // なぞる（いまいる所にいちばん近い線の上の点から、12 m 先の点に向かってハンドルを切る）
  const out = [];
  for (let x = 0; x < lead; x += 1) out.push([E[0] + x, E[1]]);
  let px = E6[0];
  let pz = E6[1];
  let th = 0;
  out.push([px, pz]);
  const ths = [0]; // なぞった点ごとの向き（out の lead 番目から）
  let idx = 0;
  const LOOK = 4;
  for (let step = 0; step < tg.length * 3 + 300 && idx < tg.length - 4; step++) {
    let best = idx;
    let bd = Infinity;
    for (let j = idx; j < Math.min(tg.length, idx + 30); j++) {
      const dd = (tg[j][0] - px) ** 2 + (tg[j][1] - pz) ** 2;
      if (dd < bd) {
        bd = dd;
        best = j;
      }
    }
    idx = best;
    const t = tg[Math.min(tg.length - 1, idx + LOOK)];
    let d = Math.atan2(t[1] - pz, t[0] - px) - th;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    // 発射のときだけ、駅を出て 50 m はゆるいカーブにする（発射の直後に急に曲がると、どんな線路も壊れる）。
    // 巻き上げのときは駅を出たところはゆっくりなので、描いたとおりに曲がる（ゆるくすると外にふくらんで、ほかの線路とぶつかった）
    // ゆるくする長さと半径は、発射の速さに合わせる（0.1.22）。130 km/h は半径 ST_R でも横の G が鉄製の上限を超えて
    // 必ず折れたので、半径を広げる（横の G を約 5.5 G に抑える）。長さは 70 km/h で 70 m、100 km/h で 100 m、130 km/h で約 120 m
    // （50 m だと、星・稲妻のおまかせの道のように駅の近くで急に曲がる道は、発射の勢いのまま曲がって折れた）
    const RL = launchRadius(launchV);
    const gentle = launchGentle(launchV);
    const Rs = lead > 12 && out.length - lead < gentle ? RL : R;
    // ゆるいカーブの間は、敷地の端が近づいたら、描いた線より先に敷地のまん中の側へ曲がり始める
    // （ゆるいカーブは急には曲がれないので、端に着いてから曲がると、130 km/h では敷地から最大 16 m はみ出した。0.1.28）
    if (Rs > R) {
      const ax = px + Math.cos(th) * (Rs + 3);
      const az = pz + Math.sin(th) * (Rs + 3);
      if (ax > FIELD.x1 - 3 || ax < FIELD.x0 + 3 || az > FIELD.z1 - 3 || az < FIELD.z0 + 3) {
        let dc = Math.atan2(-pz, -px) - th;
        while (dc > Math.PI) dc -= Math.PI * 2;
        while (dc < -Math.PI) dc += Math.PI * 2;
        // 描いた線も同じ側に曲がるなら、そのまま（強く曲がるほう）。逆なら、まん中の側へ目いっぱい
        if (Math.sign(d) !== Math.sign(dc) || Math.abs(d) < 1 / Rs) d = Math.sign(dc) / Rs;
      }
    }
    th += clamp(d, -1 / Rs, 1 / Rs);
    px += Math.cos(th);
    pz += Math.sin(th);
    out.push([px, pz]);
    ths.push(th);
  }
  // 駅の入口のまっすぐな所の始まりへ。なぞった線の終わりから順にさかのぼり、
  // 輪を描かずに（まっすぐ結んだ長さの 1.3 倍以内で）つなげる所から Dubins でつなぐ
  if (wrongEnd) {
    const d1 = dubins([px, pz, th], W, ST_R);
    const d2 = dubins(W, [A6[0], A6[1], 0], ST_R);
    out.push(...d1.slice(1), ...d2.slice(1));
    for (let x = tail - 1; x >= 0; x -= 1) out.push([A[0] - x, A[1]]);
    return resampleN(out, 1);
  }
  let cut = out.length - 1;
  let link = null;
  for (let k = out.length - 1; k >= lead + 1; k--) {
    const q = out[k];
    const dist = Math.hypot(A6[0] - q[0], A6[1] - q[1]);
    if (dist < 20) continue;
    const dpath = dubins([q[0], q[1], ths[k - lead]], [A6[0], A6[1], 0], ST_R);
    // 敷地の外にはみ出すつなぎは使わない
    const inside = dpath.every((v) => v[0] > FIELD.x0 - 1 && v[0] < FIELD.x1 + 1 && v[1] > FIELD.z0 - 1 && v[1] < FIELD.z1 + 1);
    if (inside && dpath.length <= dist * 1.3 + 4) {
      cut = k;
      link = dpath;
      break;
    }
    if (out.length - 1 - k > 160) break;
  }
  if (!link) link = dubins([px, pz, th], [A6[0], A6[1], 0], ST_R);
  out.length = cut + 1;
  out.push(...link.slice(1));
  for (let x = tail - 1; x >= 0; x -= 1) out.push([A[0] - x, A[1]]);
  return resampleN(out, 1);
}

// Dubins 曲線：向きのついた 2 点を、半径 r の円弧とまっすぐな線（3 つまで）でつなぐ、いちばん短い道（1 m ごとの点）
export function dubins(a, b, r) {
  const mod = (x) => ((x % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const D = Math.hypot(dx, dz);
  const d = D / r;
  const th = Math.atan2(dz, dx);
  const al = mod(a[2] - th);
  const be = mod(b[2] - th);
  const sa = Math.sin(al);
  const sb = Math.sin(be);
  const ca = Math.cos(al);
  const cb = Math.cos(be);
  const cab = Math.cos(al - be);
  const cands = [];
  // LSL
  let tmp = 2 + d * d - 2 * cab + 2 * d * (sa - sb);
  if (tmp >= 0) {
    const p = Math.sqrt(tmp);
    const at = Math.atan2(cb - ca, d + sa - sb);
    cands.push(['LSL', mod(-al + at), p, mod(be - at)]);
  }
  // RSR
  tmp = 2 + d * d - 2 * cab + 2 * d * (sb - sa);
  if (tmp >= 0) {
    const p = Math.sqrt(tmp);
    const at = Math.atan2(ca - cb, d - sa + sb);
    cands.push(['RSR', mod(al - at), p, mod(-be + at)]);
  }
  // LSR
  tmp = -2 + d * d + 2 * cab + 2 * d * (sa + sb);
  if (tmp >= 0) {
    const p = Math.sqrt(tmp);
    const at = Math.atan2(-ca - cb, d + sa + sb) - Math.atan2(-2, p);
    cands.push(['LSR', mod(-al + at), p, mod(-mod(be) + at)]);
  }
  // RSL
  tmp = d * d - 2 + 2 * cab - 2 * d * (sa + sb);
  if (tmp >= 0) {
    const p = Math.sqrt(tmp);
    const at = Math.atan2(ca + cb, d - sa - sb) - Math.atan2(2, p);
    cands.push(['RSL', mod(al - at), p, mod(be - at)]);
  }
  // RLR
  tmp = (6 - d * d + 2 * cab + 2 * d * (sa - sb)) / 8;
  if (Math.abs(tmp) <= 1) {
    const p = mod(2 * Math.PI - Math.acos(tmp));
    const t = mod(al - Math.atan2(ca - cb, d - sa + sb) + p / 2);
    cands.push(['RLR', t, p, mod(al - be - t + p)]);
  }
  // LRL
  tmp = (6 - d * d + 2 * cab + 2 * d * (-sa + sb)) / 8;
  if (Math.abs(tmp) <= 1) {
    const p = mod(2 * Math.PI - Math.acos(tmp));
    const t = mod(-al - Math.atan2(ca - cb, d + sa - sb) + p / 2);
    cands.push(['LRL', t, p, mod(mod(be) - al - t + p)]);
  }
  if (!cands.length) return [[a[0], a[1]], [b[0], b[1]]];
  cands.sort((u, v) => u[1] + u[2] + u[3] - (v[1] + v[2] + v[3]));
  const [type, ...lens] = cands[0];
  const out = [[a[0], a[1]]];
  let x = a[0];
  let z = a[1];
  let h = a[2];
  const STEP = 0.25;
  let acc = 0;
  for (let k = 0; k < 3; k++) {
    const L = lens[k] * r;
    const m = Math.max(1, Math.ceil(L / STEP));
    const ds = L / m;
    for (let j = 0; j < m; j++) {
      if (type[k] === 'L') h += ds / r;
      else if (type[k] === 'R') h -= ds / r;
      x += Math.cos(h) * ds;
      z += Math.sin(h) * ds;
      acc += ds;
      if (acc >= 1) {
        acc -= 1;
        out.push([x, z]);
      }
    }
  }
  out.push([b[0], b[1]]);
  return out;
}

// 折れ線を、間隔が step 以下の等間隔で打ち直す（両端の点はそのまま。最初と最後の 1 区間はもとの線の上に乗る）
export function resampleN(pts, step) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const L = cum[cum.length - 1];
  const m = Math.max(1, Math.ceil(L / step));
  const out = [];
  let j = 0;
  for (let k = 0; k <= m; k++) {
    const d = (L * k) / m;
    while (j < pts.length - 2 && cum[j + 1] < d) j++;
    const t = (d - cum[j]) / (cum[j + 1] - cum[j] || 1);
    out.push([pts[j][0] + (pts[j + 1][0] - pts[j][0]) * t, pts[j][1] + (pts[j + 1][1] - pts[j][1]) * t]);
  }
  out[0] = pts[0].slice();
  out[m] = pts[pts.length - 1].slice();
  return out;
}
function norm2(v) {
  const l = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / l, v[1] / l];
}
function circum(a, b, c) {
  const ab = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const bc = Math.hypot(c[0] - b[0], c[1] - b[1]);
  const ca = Math.hypot(a[0] - c[0], a[1] - c[1]);
  const cross = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
  if (cross < 1e-9) return Infinity;
  return (ab * bc * ca) / (2 * cross);
}

// 高さの手書き（H_SAMPLES 点）を、道の長さ L の 1 m ごとの高さにする（Catmull-Rom でなめらかに）
export function profileAt(hs, u) {
  const n = hs.length;
  const x = clamp(u, 0, 1) * (n - 1);
  const i = Math.min(n - 2, Math.floor(x));
  const t = x - i;
  const p0 = hs[Math.max(0, i - 1)];
  const p1 = hs[i];
  const p2 = hs[i + 1];
  const p3 = hs[Math.min(n - 1, i + 2)];
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
}

// 宙返りの形：曲がり方が 0 →（てっぺんで最大）→ 0 になる涙形。[前へ進む量, 高さ] を返す
let loopShapeCache = null;
export function loopShape() {
  if (loopShapeCache) return loopShapeCache;
  const N = 400;
  const pts = [[0, 0]];
  let x = 0;
  let y = 0;
  for (let k = 0; k < N; k++) {
    const t = (k + 0.5) / N;
    const ph = 2 * Math.PI * (t - Math.sin(2 * Math.PI * t) / (2 * Math.PI));
    x += (Math.cos(ph) * LOOP_LEN) / N;
    y += (Math.sin(ph) * LOOP_LEN) / N;
    pts.push([x, y]);
  }
  loopShapeCache = { pts, adv: x, top: Math.max(...pts.map((p) => p[1])) };
  return loopShapeCache;
}

// 設計のしかけを、道の上の区間（m）に直す（重なるもの・端に近すぎるものは除く）
// path（horizPath の 1 m ごとの点）を渡すと、宙返りをカーブの上に置かない
// 返り値は全部のしかけ。置けたものは ok: true、置けないものは why（near = 近すぎ、edge = 端すぎ、curve = カーブ）
export function placeGimmicks(design, Lf, path = null) {
  const out = [];
  const lead = design.start > 0 ? 40 : 14;
  const list = (design.gm || []).filter((g) => GIMMICKS[g.t]).slice(0, MAX_GIMMICKS).sort((a, b) => a.u - b.u);
  let prevEnd = lead;
  for (const g of list) {
    const len = g.t === 'loop' ? loopShape().adv : GIMMICKS[g.t].len;
    const pad = g.t === 'loop' ? 32 : g.t === 'jump' ? 18 : 4;
    const s0 = g.u * Lf;
    const e = { t: g.t, s0, s1: s0 + len, u: g.u, ok: false, why: '' };
    out.push(e);
    if (s0 - pad < prevEnd) {
      e.why = s0 - pad < lead ? 'edge' : 'near';
      continue;
    }
    if (s0 + len + pad > Lf - 16) {
      e.why = 'edge';
      continue;
    }
    // ジャンプはカーブの上にも置ける（空中はまっすぐ飛ぶので、カーブだと着地できずに事故になる。それも物理に任せる。0.1.14）
    if (path && g.t === 'loop') {
      const turn = turnOf(path, s0 - 10, s0 + len + 10);
      if (turn > 1.1) {
        e.why = 'curve';
        continue;
      }
    }
    e.ok = true;
    prevEnd = s0 + len + pad;
  }
  return out;
}
// 道の a〜b m のあいだで、向きが合計どれだけ変わるか（ラジアン）
export function turnOf(path, a, b) {
  const i0 = Math.max(1, Math.floor(a));
  const i1 = Math.min(path.length - 2, Math.ceil(b));
  let sum = 0;
  for (let i = i0; i <= i1; i++) {
    const h0 = Math.atan2(path[i][1] - path[i - 1][1], path[i][0] - path[i - 1][0]);
    const h1 = Math.atan2(path[i + 1][1] - path[i][1], path[i + 1][0] - path[i][0]);
    let d = h1 - h0;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    sum += Math.abs(d);
  }
  return sum;
}

// 費用（万円）
export function costOf(design, Lf) {
  let c = BASE_COST + (Lf + ST_LEN) * MATS[design.mat].cost;
  c += design.cars * (CAR_COST + 2 * BARS[design.bar].cost);
  c += STARTS[design.start].cost;
  for (const g of design.gm || []) c += GIMMICKS[g.t]?.cost || 0;
  return Math.round(c);
}

// ---------------- 3D の線路 ----------------
// design: { pts: [[x, z], ...], hs: [H_SAMPLES の高さ(m)], gm: [{ t, u }], mat, bar, cars, start }
// vEst: 前に走らせて求めた、点ごとの速さ（バンクの角度に使う）。null ならバンクなし
export function buildTrack(design, vEst = null) {
  const path = pathOf(design);
  const Lf = polyLen(path);
  const nf = path.length;
  // 道の 2D の向き・横向き
  const dir = path.map((p, i) => dir2(path[Math.max(0, i - 1)], path[Math.min(nf - 1, i + 1)]));
  const sAt = new Float64Array(nf);
  for (let i = 1; i < nf; i++) sAt[i] = sAt[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
  const at0 = (s) => {
    // 道の上の s（m）の位置と向き
    s = clamp(s, 0, Lf);
    let lo = 0;
    let hi = nf - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (sAt[m] <= s) lo = m;
      else hi = m;
    }
    const t = (s - sAt[lo]) / (sAt[hi] - sAt[lo] || 1);
    const a = path[lo];
    const b = path[hi];
    const d = dir[lo];
    const e = dir[hi];
    const dx = d[0] + (e[0] - d[0]) * t;
    const dz = d[1] + (e[1] - d[1]) * t;
    const l = Math.hypot(dx, dz) || 1;
    return { x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, dx: dx / l, dz: dz / l };
  };
  const gms = placeGimmicks(design, Lf, path).filter((g) => g.ok);
  // 宙返りは、まっすぐな所に置く：前後 20 m を、入口から出口へのまっすぐな線に乗りかえる曲線に置きかえる
  // （カーブの上にそのまま置くと、輪がねじれて横の G が大きくなる）
  const LOOP_LEAD = 40;
  const straights = [];
  for (const g of gms) {
    if (g.t !== 'loop') continue;
    const a = Math.max(0, g.s0 - LOOP_LEAD);
    const b = Math.min(Lf, g.s1 + LOOP_LEAD);
    const A = at0(a);
    const B = at0(b);
    const Q0 = at0(g.s0);
    const Q1 = at0(g.s1);
    let Dx = Q1.x - Q0.x;
    let Dz = Q1.z - Q0.z;
    const cl = Math.hypot(Dx, Dz) || 1;
    Dx /= cl;
    Dz /= cl;
    straights.push({ g, a, b, A, B, Q0, Q1, Dx, Dz, cl });
  }
  const herm = (p0, t0, p1, t1, t) => {
    const m = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    const h00 = 2 * t ** 3 - 3 * t ** 2 + 1;
    const h10 = t ** 3 - 2 * t ** 2 + t;
    const h01 = -2 * t ** 3 + 3 * t ** 2;
    const h11 = t ** 3 - t ** 2;
    const x = h00 * p0[0] + h10 * m * t0[0] + h01 * p1[0] + h11 * m * t1[0];
    const z = h00 * p0[1] + h10 * m * t0[1] + h01 * p1[1] + h11 * m * t1[1];
    // 向き（微分）
    const d00 = 6 * t * t - 6 * t;
    const d10 = 3 * t * t - 4 * t + 1;
    const d01 = -6 * t * t + 6 * t;
    const d11 = 3 * t * t - 2 * t;
    let dx = d00 * p0[0] + d10 * m * t0[0] + d01 * p1[0] + d11 * m * t1[0];
    let dz = d00 * p0[1] + d10 * m * t0[1] + d01 * p1[1] + d11 * m * t1[1];
    const l = Math.hypot(dx, dz) || 1;
    return { x, z, dx: dx / l, dz: dz / l };
  };
  const at2 = (s) => {
    for (const o of straights) {
      if (s < o.a || s > o.b) continue;
      // 宙返りの前後 12 m は、輪と同じ向きのまっすぐな線（ここで傾きを 0 に戻す）。その外側を曲線でつなぐ
      const S = 12;
      if (s < o.g.s0 - S) return herm([o.A.x, o.A.z], [o.A.dx, o.A.dz], [o.Q0.x - o.Dx * S, o.Q0.z - o.Dz * S], [o.Dx, o.Dz], (s - o.a) / (o.g.s0 - S - o.a || 1));
      if (s < o.g.s0) return { x: o.Q0.x - o.Dx * (o.g.s0 - s), z: o.Q0.z - o.Dz * (o.g.s0 - s), dx: o.Dx, dz: o.Dz };
      if (s > o.g.s1 + S) return herm([o.Q1.x + o.Dx * S, o.Q1.z + o.Dz * S], [o.Dx, o.Dz], [o.B.x, o.B.z], [o.B.dx, o.B.dz], (s - o.g.s1 - S) / (o.b - o.g.s1 - S || 1));
      if (s > o.g.s1) return { x: o.Q1.x + o.Dx * (s - o.g.s1), z: o.Q1.z + o.Dz * (s - o.g.s1), dx: o.Dx, dz: o.Dz };
      const t = (s - o.g.s0) / (o.g.s1 - o.g.s0 || 1);
      return { x: o.Q0.x + (o.Q1.x - o.Q0.x) * t, z: o.Q0.z + (o.Q1.z - o.Q0.z) * t, dx: o.Dx, dz: o.Dz };
    }
    return at0(s);
  };
  const H0 = STATION.h;
  const hs = (design.hs && design.hs.length >= 2 ? design.hs : defaultHeights()).map((h) => clamp(h, H_MIN, H_MAX));
  // 1 m ごとの高さ
  const nh = Math.ceil(Lf) + 1;
  let hgt = new Float64Array(nh);
  for (let i = 0; i < nh; i++) hgt[i] = profileAt(hs, Math.min(i, Lf) / Lf);
  const blendTo = (from, to, len, target, rev = false) => {
    for (let i = Math.max(0, Math.floor(from)); i <= Math.min(nh - 1, Math.ceil(to)); i++) {
      const w = rev ? smooth01((to - i) / len) : smooth01((i - from) / len);
      hgt[i] = target + (hgt[i] - target) * w;
    }
  };
  // 宙返りの前後は平らに（入口・出口の高さをそろえる）。ならす前にしておき、つなぎ目の山や谷を丸める
  for (const g of gms) {
    if (g.t !== 'loop') continue;
    {
      // 宙返りは、まわりのいちばん低い所の高さに置く（丘の上に置くと、速さが足りずに登りきれない）
      let hb = Infinity;
      for (let i = Math.max(0, Math.floor(g.s0 - 10)); i <= Math.min(nh - 1, Math.ceil(g.s1 + 10)); i++) hb = Math.min(hb, hgt[i]);
      hb = Math.max(1.5, hb);
      const L0 = 30;
      for (let i = Math.max(0, Math.floor(g.s0 - L0)); i <= Math.min(nh - 1, Math.ceil(g.s1 + L0)); i++) {
        const w = i < g.s0 ? 1 - smooth01((i - (g.s0 - L0)) / 20) : i > g.s1 ? smooth01((i - g.s1 - 10) / 20) : 0;
        hgt[i] = hb + (hgt[i] - hb) * w;
      }
    }
  }
  // 発射の区間は平らにしておく（ならしたあとにもう一度平らにする）
  const launchLen = design.start > 0 ? 30 : 0;
  for (let i = 0; i <= Math.min(nh - 1, launchLen); i++) hgt[i] = H0;
  // 発射の区間の先は、描いた高さへゆっくりつなぐ（つなぐ長さは発射の速さと高さの差から決め、曲がり目の G を約 3 G 増しに抑える。
  // 0.1.11 までは、ならした後に 16 m でつないでいたので、描き始めが高いと急な坂の角ができ、どんな線路も発射の直後に折れた）
  if (launchLen) {
    let dh = 0;
    for (let i = launchLen; i <= Math.min(nh - 1, launchLen + 60); i++) dh = Math.max(dh, Math.abs(hgt[i] - H0));
    const len = Math.max(16, STARTS[design.start].v * Math.sqrt((2 * dh) / G));
    blendTo(launchLen, launchLen + len, len, H0);
  }
  // 細かいガタガタをならす（半径 8 m の平均を 3 回。手で描いた V 字の谷・山を、半径 10 m ほどの丸みにする。
  // これより鋭いと、ふつうの速さでも G が大きすぎて、どんな線路も壊れてしまう）
  for (let pass = 0; pass < 3; pass++) {
    const q = new Float64Array(nh);
    for (let i = 0; i < nh; i++) {
      let sum = 0;
      let c = 0;
      for (let k = -8; k <= 8; k++) {
        const j = i + k;
        if (j < 0 || j >= nh) continue;
        sum += hgt[j];
        c++;
      }
      q[i] = sum / c;
    }
    hgt = q;
  }
  // 宙返りの入口と出口は、ならした後にもう一度ぴったり平らにする
  for (const g of gms) {
    if (g.t !== 'loop') continue;
    const hb = hgt[Math.round(g.s0)];
    for (let i = Math.max(0, Math.floor(g.s0 - 16)); i <= Math.min(nh - 1, Math.ceil(g.s1 + 16)); i++) {
      const w = i < g.s0 - 4 ? 1 - smooth01((i - (g.s0 - 16)) / 12) : i > g.s1 + 4 ? smooth01((i - g.s1 - 4) / 12) : 0;
      hgt[i] = hb + (hgt[i] - hb) * w;
    }
  }
  // 駅の前後は駅の高さにつなぐ。発射のときは、発射の区間を平らにする
  for (let i = 0; i <= Math.min(nh - 1, launchLen); i++) hgt[i] = H0;
  if (launchLen) blendTo(launchLen, launchLen + 16, 16, H0);
  blendTo(nh - 1 - 12, nh - 1, 12, H0, true);
  // ジャンプ：手前を平らにして、上向き 20 度の踏み切り台と、12 度で下る着地の坂を作る。
  // 60km/h 前後（約 55〜70km/h）で飛び込むと着地できる形（遅いと手前の坂に、速いと坂の先に落ちる）
  for (const g of gms) {
    if (g.t !== 'jump') continue;
    const hb = Math.max(hgt[Math.max(0, Math.round(g.s0 - 10))], 3);
    const y0 = hb + JUMP_KICK;
    for (let i = Math.max(0, Math.floor(g.s0 - 30)); i <= Math.min(nh - 1, Math.ceil(g.s1 + 34)); i++) {
      if (i < g.s0 - 10) {
        const w = smooth01((i - (g.s0 - 30)) / 20);
        hgt[i] = hgt[i] + (hb - hgt[i]) * w;
      } else if (i <= g.s0) {
        const x = (i - (g.s0 - 10)) / 10;
        hgt[i] = hb + JUMP_KICK * x * x;
      } else if (i < g.s1) {
        hgt[i] = y0 + (y0 + 1 - y0) * ((i - g.s0) / (g.s1 - g.s0));
      } else if (i <= g.s1 + 14) {
        hgt[i] = y0 + 1 - Math.tan(0.21) * (i - g.s1);
      } else {
        const e = y0 + 1 - Math.tan(0.21) * 14;
        const x = (i - (g.s1 + 14)) / 20;
        // 坂の傾きのまま少し下りてから、もとの高さへ
        const lin = e - Math.tan(0.21) * 20 * x * (1 - x / 2);
        hgt[i] = lin + (hgt[i] - lin) * smooth01(x);
      }
    }
  }
  for (let i = 0; i < nh; i++) hgt[i] = clamp(hgt[i], H_MIN, H_MAX + 4);
  const hAt = (s) => {
    const x = clamp(s, 0, nh - 1);
    const i = Math.min(nh - 2, Math.floor(x));
    return hgt[i] + (hgt[i + 1] - hgt[i]) * (x - i);
  };
  const zoneOf = (s) => {
    let f = 0;
    if (s < launchLen) f |= F.LAUNCH;
    for (const g of gms) {
      if (s >= g.s0 && s < g.s1) {
        if (g.t === 'boost') f |= F.BOOST;
        else if (g.t === 'brake') f |= F.BRAKE;
        else if (g.t === 'jump') f |= F.GAP;
      }
    }
    return f;
  };

  // 細かい 3D の点の列（駅 → 道 → 駅の手前）。宙返りは差し込む
  const dense = []; // [x, y, z, flags, 宙返りの横向き x, z]
  for (let x = STATION.x0; x < STATION.x1; x += 0.5) dense.push([x, H0, STATION.z, F.STATION]);
  const latOf = (s) => {
    // 宙返りの前後の、横へのずれ
    for (const g of gms) {
      if (g.t !== 'loop') continue;
      if (s > g.s0 - 24 && s <= g.s0) return -LOOP_W / 2 * smooth01((s - (g.s0 - 24)) / 24);
      if (s >= g.s1 && s < g.s1 + 24) return LOOP_W / 2 * (1 - smooth01((s - g.s1) / 24));
    }
    return 0;
  };
  const loopAt = (s) => gms.find((g) => g.t === 'loop' && s >= g.s0 && s < g.s1);
  const LS = loopShape();
  for (let s = 0; s < Lf; s += 0.5) {
    const lp = loopAt(s);
    if (lp) {
      // 宙返り：形の点を、道の向きに沿って置く
      const hb = hAt(lp.s0);
      const o = straights.find((q) => q.g === lp);
      const sc = o.cl / LS.adv;
      for (let k = 0; k < LS.pts.length; k += 2) {
        const [fx, fy] = LS.pts[k];
        const t = k / (LS.pts.length - 1);
        const lat = -LOOP_W / 2 + LOOP_W * smooth01((t - 0.25) / 0.5);
        const x = o.Q0.x + o.Dx * fx * sc;
        const z = o.Q0.z + o.Dz * fx * sc;
        dense.push([x - o.Dz * lat, hb + fy, z + o.Dx * lat, F.LOOP, -o.Dz, o.Dx]);
      }
      s = lp.s1;
      continue;
    }
    const a = at2(s);
    const lat = latOf(s);
    dense.push([a.x - a.dz * lat, hAt(s), a.z + a.dx * lat, zoneOf(s)]);
  }
  // 3D の長さで DS ごとに打ち直す（閉じた輪）
  dense.push([dense[0][0], dense[0][1], dense[0][2], dense[0][3]]);
  const cum = [0];
  for (let i = 1; i < dense.length; i++) {
    const a = dense[i - 1];
    const b = dense[i];
    cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
  }
  const total = cum[cum.length - 1];
  const n = Math.floor(total / DS);
  const L = n * DS;
  const k = total / L; // 少し伸ばして n 等分
  const tr = {
    n, L, Lf, path,
    px: new Float64Array(n), py: new Float64Array(n), pz: new Float64Array(n),
    tx: new Float64Array(n), ty: new Float64Array(n), tz: new Float64Array(n),
    ux: new Float64Array(n), uy: new Float64Array(n), uz: new Float64Array(n),
    rx: new Float64Array(n), ry: new Float64Array(n), rz: new Float64Array(n),
    kx: new Float64Array(n), ky: new Float64Array(n), kz: new Float64Array(n),
    bank: new Float64Array(n),
    lrx: new Float32Array(n), lrz: new Float32Array(n), // 宙返りの中の右向き（輪の面に垂直）
    fl: new Uint16Array(n),
    gms, design,
  };
  let j = 0;
  for (let i = 0; i < n; i++) {
    const d = i * DS * k;
    while (j < cum.length - 2 && cum[j + 1] < d) j++;
    const t = (d - cum[j]) / (cum[j + 1] - cum[j] || 1);
    const a = dense[j];
    const b = dense[j + 1];
    tr.px[i] = a[0] + (b[0] - a[0]) * t;
    tr.py[i] = a[1] + (b[1] - a[1]) * t;
    tr.pz[i] = a[2] + (b[2] - a[2]) * t;
    const near = t < 0.5 ? a : b;
    tr.fl[i] = near[3];
    if (near[3] & F.LOOP) {
      tr.lrx[i] = near[4];
      tr.lrz[i] = near[5];
    }
  }
  tr.stEnd = Math.round(ST_LEN / (DS * k)); // 駅の終わりの点
  for (let i = 0; i < tr.stEnd; i++) tr.fl[i] |= F.STATION;
  const wrap = (i) => ((i % n) + n) % n;
  tr.wrap = wrap;
  // 接線
  for (let i = 0; i < n; i++) {
    const a = wrap(i - 1);
    const b = wrap(i + 1);
    let x = tr.px[b] - tr.px[a];
    let y = tr.py[b] - tr.py[a];
    let z = tr.pz[b] - tr.pz[a];
    const l = Math.hypot(x, y, z) || 1;
    tr.tx[i] = x / l;
    tr.ty[i] = y / l;
    tr.tz[i] = z / l;
  }
  // 曲がり方（接線の変化 / 長さ）。前後 1.5 m の差で求め、さらに前後 1 m で平均
  const KW = 3;
  const kx0 = new Float64Array(n);
  const ky0 = new Float64Array(n);
  const kz0 = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = wrap(i - KW);
    const b = wrap(i + KW);
    kx0[i] = (tr.tx[b] - tr.tx[a]) / (2 * KW * DS);
    ky0[i] = (tr.ty[b] - tr.ty[a]) / (2 * KW * DS);
    kz0[i] = (tr.tz[b] - tr.tz[a]) / (2 * KW * DS);
  }
  for (let i = 0; i < n; i++) {
    let x = 0;
    let y = 0;
    let z = 0;
    for (let q = -2; q <= 2; q++) {
      const w = wrap(i + q);
      x += kx0[w];
      y += ky0[w];
      z += kz0[w];
    }
    // 接線に垂直な成分だけ残す
    x /= 5;
    y /= 5;
    z /= 5;
    const d = x * tr.tx[i] + y * tr.ty[i] + z * tr.tz[i];
    tr.kx[i] = x - d * tr.tx[i];
    tr.ky[i] = y - d * tr.ty[i];
    tr.kz[i] = z - d * tr.tz[i];
  }
  // リフト（最初の山のてっぺんまで）
  tr.liftEnd = -1;
  if (design.start === 0) {
    let best = tr.stEnd;
    for (let i = tr.stEnd; i < n - 40; i++) {
      if (tr.fl[i] & F.LOOP) break;
      let top = true;
      for (let q = 1; q <= 24 && i + q < n; q++) if (tr.py[i + q] > tr.py[i] + 0.02) top = false;
      if (top && tr.py[i] > H0 + 3) {
        best = i;
        break;
      }
      best = i;
    }
    // チェーンは頂上の 2 m 先まで（どれかの車両がチェーンの上にいる間は引くので、最後の車両が頂上を越えるまで引く）。
    // 0.1.15 までは頂上の 3 m 手前で終わっていたので、頂上の先が平らだと、先頭が頂上にいるうちに外れ、後ろの車両に引かれて戻った
    tr.liftEnd = Math.max(tr.stEnd + 4, best + 4);
    for (let i = tr.stEnd; i < tr.liftEnd; i++) tr.fl[i] |= F.LIFT;
  }
  computeFrames(tr, vEst);
  findClashes(tr);
  makeChunks(tr);
  makeSupports(tr);
  tr.maxH = 0;
  for (let i = 0; i < n; i++) tr.maxH = Math.max(tr.maxH, tr.py[i]);
  tr.cost = costOf(design, Lf);
  return tr;
}

export const F = { STATION: 1, LIFT: 2, LAUNCH: 4, BOOST: 8, BRAKE: 16, GAP: 32, LOOP: 64, CLASH: 128 };

// 向き（上・右）。ふつうは空の向きを上にしてカーブで内側に傾け、宙返り・垂直に近い所は前の点からつなぐ
function computeFrames(tr, vEst) {
  const { n } = tr;
  // バンクの角度（予想の速さで、横の G がほぼ消える角度の 85%）
  const bank = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const tx = tr.tx[i];
    const ty = tr.ty[i];
    const tz = tr.tz[i];
    if (!vEst || (tr.fl[i] & (F.LOOP | F.STATION)) || Math.abs(ty) > 0.85) continue;
    // 空の向きを接線に垂直に
    let ux = -ty * tx;
    let uy = 1 - ty * ty;
    let uz = -ty * tz;
    const l = Math.hypot(ux, uy, uz);
    ux /= l;
    uy /= l;
    uz /= l;
    const rx = ty * uz - tz * uy;
    const ry = tz * ux - tx * uz;
    const rz = tx * uy - ty * ux;
    const v2 = vEst[i] * vEst[i];
    const fx = v2 * tr.kx[i];
    const fy = v2 * tr.ky[i] + G;
    const fz = v2 * tr.kz[i];
    const fl = fx * rx + fy * ry + fz * rz;
    const fu = fx * ux + fy * uy + fz * uz;
    bank[i] = 0.9 * Math.atan2(fl, Math.max(fu, G * 0.6));
    bank[i] = clamp(bank[i], -1.35, 1.35);
  }
  // 傾きは前後 5 m でならす（急にひねらない）
  const W = 4;
  for (let pass = 0; pass < 2; pass++) {
    const src = bank.slice();
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let q = -W; q <= W; q++) s += src[tr.wrap(i + q)];
      bank[i] = s / (2 * W + 1);
    }
  }
  for (let i = 0; i < n; i++) if (tr.fl[i] & (F.LOOP | F.STATION)) bank[i] = 0;
  // 宙返りの前後 8 m は、傾きを 0 に戻しておく（傾いたまま輪に入ると、輪の中で横の G がかかる）
  const R0 = Math.round(8 / DS);
  for (let i = 0; i < n; i++) {
    if (!(tr.fl[i] & F.LOOP)) continue;
    for (let q = 1; q <= R0; q++) {
      const k = smooth01(q / R0);
      const a = tr.wrap(i - q);
      const b = tr.wrap(i + q);
      if (!(tr.fl[a] & F.LOOP)) bank[a] *= k;
      if (!(tr.fl[b] & F.LOOP)) bank[b] *= k;
    }
  }
  tr.bank = bank;
  let pux = 0;
  let puy = 1;
  let puz = 0;
  for (let i = 0; i < n; i++) {
    const tx = tr.tx[i];
    const ty = tr.ty[i];
    const tz = tr.tz[i];
    // 前の点の上向きを、いまの接線に垂直にする（平行移動）
    let d = pux * tx + puy * ty + puz * tz;
    let ax = pux - d * tx;
    let ay = puy - d * ty;
    let az = puz - d * tz;
    let l = Math.hypot(ax, ay, az) || 1;
    ax /= l;
    ay /= l;
    az /= l;
    let w = (tr.fl[i] & F.LOOP) ? 0 : smooth01((0.97 - Math.abs(ty)) / 0.12);
    if (tr.fl[i] & F.LOOP) {
      // 宙返りの中：輪の面に垂直な右向きから、上向きを決める（上 = 右 × 前）
      const rx = tr.lrx[i];
      const rz = tr.lrz[i];
      ax = rz * ty;
      ay = rz * tx * -1 + rx * tz;
      az = -rx * ty;
      // (rx, 0, rz) × (tx, ty, tz)
      ax = 0 * tz - rz * ty;
      ay = rz * tx - rx * tz;
      az = rx * ty - 0 * tx;
      l = Math.hypot(ax, ay, az) || 1;
      ax /= l;
      ay /= l;
      az /= l;
    }
    if (w > 0) {
      // 空の向き + バンク
      let ux = -ty * tx;
      let uy = 1 - ty * ty;
      let uz = -ty * tz;
      l = Math.hypot(ux, uy, uz) || 1;
      ux /= l;
      uy /= l;
      uz /= l;
      const rx = ty * uz - tz * uy;
      const ry = tz * ux - tx * uz;
      const rz = tx * uy - ty * ux;
      const c = Math.cos(bank[i]);
      const s = Math.sin(bank[i]);
      const bx = ux * c + rx * s;
      const by = uy * c + ry * s;
      const bz = uz * c + rz * s;
      ax += (bx - ax) * w;
      ay += (by - ay) * w;
      az += (bz - az) * w;
      d = ax * tx + ay * ty + az * tz;
      ax -= d * tx;
      ay -= d * ty;
      az -= d * tz;
      l = Math.hypot(ax, ay, az) || 1;
      ax /= l;
      ay /= l;
      az /= l;
    }
    tr.ux[i] = ax;
    tr.uy[i] = ay;
    tr.uz[i] = az;
    tr.rx[i] = ty * az - tz * ay;
    tr.ry[i] = tz * ax - tx * az;
    tr.rz[i] = tx * ay - ty * ax;
    pux = ax;
    puy = ay;
    puz = az;
  }
}

// 線路どうしがぶつかる所（上から見て 1.8 m 以内で、高さの差が 3 m 未満）
function findClashes(tr) {
  const { n } = tr;
  const cell = 2;
  const grid = new Map();
  const key = (x, z) => `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
  for (let i = 0; i < n; i += 2) {
    const k = key(tr.px[i], tr.pz[i]);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  }
  const gap = Math.round(14 / DS);
  tr.clashes = [];
  for (let i = 0; i < n; i += 2) {
    const cx = Math.floor(tr.px[i] / cell);
    const cz = Math.floor(tr.pz[i] / cell);
    for (let a = -1; a <= 1; a++) {
      for (let b = -1; b <= 1; b++) {
        const list = grid.get(`${cx + a},${cz + b}`);
        if (!list) continue;
        for (const j of list) {
          let d = Math.abs(i - j);
          d = Math.min(d, n - d);
          if (d < gap) continue;
          if ((tr.fl[i] & F.GAP) || (tr.fl[j] & F.GAP)) continue;
          if (Math.hypot(tr.px[i] - tr.px[j], tr.pz[i] - tr.pz[j]) < 1.8 && Math.abs(tr.py[i] - tr.py[j]) < 3) {
            if (!(tr.fl[i] & F.CLASH)) tr.clashes.push(i);
            tr.fl[i] |= F.CLASH;
            tr.fl[i + 1 < n ? i + 1 : 0] |= F.CLASH;
          }
        }
      }
    }
  }
}

// 壊れる単位（10 m ごと）。倒れるときの支点（線路の真下の地面）と、いちばん高い所
function makeChunks(tr) {
  const { n } = tr;
  tr.chunks = [];
  for (let c = 0; c * CHUNK < n; c++) {
    const a = c * CHUNK;
    const b = Math.min(n, a + CHUNK);
    const m = (a + b) >> 1;
    let top = 0;
    for (let i = a; i < b; i++) top = Math.max(top, tr.py[i]);
    tr.chunks.push({ a, b, px: tr.px[m], pz: tr.pz[m], top, station: (tr.fl[m] & F.STATION) !== 0 });
  }
}
export const chunkOf = (i) => Math.floor(i / CHUNK);

// 支柱（6 m ごと。線路が上を向いている所だけ）
function makeSupports(tr) {
  tr.supports = [];
  const step = Math.round(6 / DS);
  for (let i = 0; i < tr.n; i += step) {
    if (tr.fl[i] & (F.STATION | F.GAP)) continue;
    if (tr.uy[i] < 0.45) continue;
    const y = tr.py[i] - tr.uy[i] * 0.55;
    if (y < 0.6) continue;
    tr.supports.push(i);
  }
}

// おまかせの道（いくつかの形から選び、少しゆがめる）
// 角を丸める（Chaikin の角切りを 4 回。おまかせの道を、急カーブのない形にする）
function roundCorners(pts) {
  let p = pts;
  for (let k = 0; k < 4; k++) {
    const q = [p[0]];
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i];
      const b = p[i + 1];
      q.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    q.push(p[p.length - 1]);
    p = q;
  }
  return p;
}
// おまかせの道の型の数。kind を渡さないときは、前からある 4 つの型から選ぶ（タイトルのお手本・道具の形を変えないため）
export const STROKE_KINDS = 9;
// launchV（m/s）を渡すと、発射のときの線路と同じ曲がり方で描き始める（下の fitLaunch）
export function randomStroke(seed, kind = null, launchV = 0) {
  const raw = randomStrokeRaw(seed, kind);
  return roundCorners(launchV ? fitLaunch(raw, launchV) : raw);
}
// 発射のときは、駅を出て 36 m まっすぐ走り、その先しばらく（launchGentle）はゆるいカーブ（launchRadius）でしか曲がれない。
// おまかせの線もその間は、右端を上がり（長いときは右上の角を左へ曲がり）、それから、もとの線のいちばん近い所に合流する
// （0.1.25 までは駅のすぐ先で上へ曲がる線のままだったので、実際の線路が右へ大きくふくらんで、描いた線から最大 20 m 離れた。
// 星・稲妻のように右側がギザギザの線は、ゆるいカーブの間はギザギザをなくす）
// 発射のときの、駅を出てからゆるいカーブの終わりまでの道すじ（駅の出口の 6 m 先から。おまかせの線と、① の図の目安に使う）
export function launchGuide(v) {
  const R = launchRadius(v);
  const L = launchGentle(v) + 8;
  const x0 = STATION.x1 + 36;
  const z0 = STATION.z;
  const xr = Math.min(x0 + R, FIELD.x1 - 2);
  const zt = FIELD.z0 + 4 + R;
  const head = [[STATION.x1 + 6, z0], [x0, z0]];
  let len = 0;
  const add = (p) => {
    const q = head[head.length - 1];
    len += Math.hypot(p[0] - q[0], p[1] - q[1]);
    head.push(p);
    return len >= L;
  };
  let done = false;
  // 上へ曲がる
  for (let k = 1; k <= 8 && !done; k++) {
    const a = (k / 8) * (Math.PI / 2);
    done = add([Math.min(xr, x0 + R * Math.sin(a)), z0 - R * (1 - Math.cos(a))]);
  }
  // 右端を上がる
  for (let z = z0 - R - 4; z > zt && !done; z -= 4) done = add([xr, z]);
  // 右上の角を左へ曲がり、上の端を左へ
  for (let k = 1; k <= 8 && !done; k++) {
    const a = (k / 8) * (Math.PI / 2);
    done = add([xr - R * (1 - Math.cos(a)), zt - R * Math.sin(a)]);
  }
  for (let x = xr - R - 4; x > FIELD.x0 + 20 && !done; x -= 4) done = add([x, zt - R]);
  return head;
}
function fitLaunch(pts, v) {
  const head = launchGuide(v);
  // 合流：もとの線の前半（6 割まで）で、終わりの点より進む向きの先にある、いちばん近い点から
  // （後ろの点に合流すると、そこで急に折り返して、お客さんが飛ばされた）
  const e = head[head.length - 1];
  const f = head[head.length - 2];
  const hx = e[0] - f[0];
  const hz = e[1] - f[1];
  let j = -1;
  let bd = Infinity;
  for (let i = 1; i < pts.length * 0.6; i++) {
    if ((pts[i][0] - e[0]) * hx + (pts[i][1] - e[1]) * hz < 4 * Math.hypot(hx, hz)) continue;
    const d = Math.hypot(pts[i][0] - e[0], pts[i][1] - e[1]);
    if (d < bd) {
      bd = d;
      j = i;
    }
  }
  if (j < 0) return pts;
  return [...head, ...pts.slice(j)];
}
function randomStrokeRaw(seed, kindIn) {
  const r = rng(seed);
  const k0 = Math.floor(r() * 4);
  const kind = kindIn ?? k0;
  const W = 52 + r() * 10;
  const H = 34 + r() * 8;
  const jit = () => (r() - 0.5) * 6;
  const J = (list) => list.map(([x, z]) => [x + jit(), z + jit()]);
  if (kind === 0) {
    // 大きな輪
    return J([[18, 38], [W, 30], [W + 6, 0], [W - 4, -H + 4], [0, -H - 6], [-W + 4, -H + 4], [-W - 6, 0], [-W + 6, 28], [-20, 38]]);
  }
  if (kind === 1) {
    // くねくね（手前と奥を行ったり来たり）
    return J([[18, 38], [50, 32], [58, 10], [30, 2], [10, -10], [36, -26], [56, -38], [10, -42], [-30, -36], [-50, -20], [-30, -6], [-56, 8], [-52, 30], [-22, 38]]);
  }
  if (kind === 2) {
    // くるりん（大きな輪の上で、小さく 1 回転して交差する。交差する所は高さを変えないとぶつかる）
    // 0.1.24 までは 8 の字だったが、8 の字は駅を出た向きのまま駅に戻れない（右上から駅に下りてくる）ので、
    // 最後が描いた線を外れて大回りになった
    return J([[18, 38], [W, 30], [W + 6, 0], [W - 4, -H + 4], [24, -H - 6], [6, -36], [-6, -24], [2, -12], [14, -18], [12, -32], [0, -42], [-24, -H - 6], [-W + 4, -H + 4], [-W - 6, 0], [-W + 6, 28], [-20, 38]]);
  }
  if (kind === 3) {
    // 池をぐるっと（最後は左から駅に入る。0.1.24 までは池の下で内側にくぼんでから上から駅に下りてきたので、そこを外れて大回りした）
    return J([[18, 38], [56, 26], [60, -10], [36, -40], [-10, -40], [-26, -32], [-62, -30], [-64, 0], [-46, 6], [-34, 16], [-50, 26], [-44, 35], [-22, 38]]);
  }
  if (kind === 4) {
    // つづら折り（縦の列を、ヘアピンで行ったり来たり）
    const gap = 19 + r() * 3;
    const top = -40 + r() * 4;
    const bot = 16 + r() * 4;
    const pts = [[18, 38], [48, 36]];
    for (let i = 0; i < 6; i++) {
      const x = 58 - i * gap;
      const up = i % 2 === 0;
      pts.push([x, up ? bot + 8 : top + 6], [x, up ? top + 6 : bot]);
      pts.push([x - gap / 2, up ? top - 4 : bot + 8]);
    }
    pts.pop();
    pts.push([-30, 34], [-22, 38]);
    return pts;
  }
  if (kind === 5) {
    // うずまき（外を大きく回ってから内側をもう 1 周。出口で外の輪と 1 回交差する）
    // 内側の輪を出たら、左へふくらんでから駅に入る（0.1.24 までは上から駅に下りてきて、最後が大回りになった）
    return J([[18, 38], [56, 30], [W + 4, 0], [50, -36], [0, -H - 6], [-50, -36], [-W - 4, 0], [-50, 22], [-10, 24], [28, 16], [38, 0], [26, -22], [0, -28], [-26, -20], [-36, -2], [-46, 16], [-54, 30], [-40, 37], [-22, 38]]);
  }
  if (kind === 6) {
    // ひょうたん（左右の 2 つの輪を、まん中のくびれでつなぐ）
    const waist = -4 + r() * 8;
    return J([[18, 38], [50, 34], [64, 10], [58, -28], [32, -42], [12, -24], [0, waist], [-12, -24], [-32, -42], [-58, -34], [-66, -4], [-56, 24], [-22, 38]]);
  }
  if (kind === 7) {
    // 星（外と内を交互に回る、とがった形）
    const n = 4 + Math.floor(r() * 2); // とがりの数
    const pts = [[18, 38]];
    const steps = n * 2;
    // 最後のとがりは左下（-210 度）にして、そこから駅へ右向きに入る（0.1.24 までは駅の真上から下りてきて、最後が大回りになった）
    for (let i = 0; i <= steps; i++) {
      const a = ((60 - (270 * i) / steps) * Math.PI) / 180;
      const R = i % 2 ? 0.62 : 1;
      pts.push([Math.cos(a) * 62 * R, -4 + Math.sin(a) * 42 * R]);
    }
    pts.push([-50, 30], [-36, 37], [-22, 38]);
    return pts;
  }
  // 稲妻（右側をジグザグに登り、左側を大きく回って戻る）
  return J([[18, 38], [54, 32], [36, 14], [60, -6], [36, -26], [56, -42], [10, -42], [-30, -42], [-60, -30], [-W - 4, 0], [-56, 26], [-22, 38]]);
}

// おまかせの高さ（巻き上げ → 大きく落ちる → だんだん小さな山）
// Lf は道の長さ（m）。坂の長さは高さに合わせて決める（巻き上げは約 30 度、落ちる坂は約 45 度）。
// 山は谷と頂上がなめらかな波にし、幅は高さに合わせて広げる（谷で G がかかりすぎない、頂上でふわっと浮く程度）。
// 最後は少し登ってから駅へ下りる（速すぎて駅で止まれない、を防ぐ）
// launchV（m/s）を渡すと、発射に合わせた形（平らな発射の区間 → ゆるやかに登る高い山）にする
// kind：高さの型（HEIGHT_KINDS 個。0 が前からの形。下の heightMoves）
export const HEIGHT_KINDS = 9;
// おまかせの高さの段（いちばん高い所、m）。押すたびに順に変える（0.1.24。それまでは 24〜36 m だけで、どれも控えめに見えた）
export const PEAK_TIERS = [[22, 28], [30, 38], [40, 48], [50, 58]];
// 発射のおまかせで、発射の区間のすぐ先に置くブレーキの数。ブレーキ 1 つ（16 m・9 m/s²）で速さの 2 乗が 288 減る
// （高さにして約 15 m）。発射の勢いを、巻き上げ 30 m ほどに近づける（130 km/h は 2 つ、100 km/h は 1 つ、70 km/h は 0）
export const TRIM_DV2 = 2 * 9 * 16;
export const launchTrims = (v) => Math.max(0, Math.round(((v * v) / (2 * G) - 30) / (TRIM_DV2 / (2 * G))));
// trims：発射のあとのブレーキの数（その分だけ勢いを減らして高さを決める）
// extra を渡すと、型 5〜8 でブースターを置く所（道の上の位置 m）を extra.boosts に入れて返す
export function defaultHeights(seed = 1, peak = 30, Lf = 300, launchV = 0, kind = 0, trims = 0, extra = null) {
  const r = rng(seed);
  peak = Math.min(peak, Lf / 5.5); // 短い道でも高い山にできるように（0.1.23 までは Lf / 8。300 m の道で 37 m まで）
  if (launchV) launchV = Math.sqrt(Math.max(1, launchV * launchV - trims * TRIM_DV2));
  if (launchV) peak = Math.min((launchV * launchV) / (2 * G) * 0.7, Lf / 6);
  // 発射のときは、発射の区間（30 m）の先のつなぎ（buildTrack の 16 m）を過ぎてから登り始め、
  // 登りの坂の長さを速さに合わせて延ばす（坂の入口の曲がりで、上向きの G が約 1.5 G 増しで収まるように。
  // 0.1.21 までは 130 km/h で、発射の直後の登り口が鉄製の 6.5 G を超えて必ず折れた）
  const up0 = launchV ? 64 : 8;
  // 最初の山（巻き上げ・発射の山）の高さ。まん中が一番高い・だんだん高くなる は、最初の山を低くして、あとの山をブースターで高くする
  const top = peak * (kind === 5 ? 0.6 : kind === 7 ? 0.55 : kind === 8 ? 0.45 : 1);
  const up1 = up0 + (launchV ? Math.max(top * 2.6, Math.sqrt((6 * Math.max(0, top - STATION.h) * launchV * launchV) / (1.5 * G))) : top * 1.6);
  // 発射のときは、山の高さより勢いが大きい（山は勢いの 7 割）ので、谷に速く入る。谷の G を巻き上げのときと同じくらいに
  // するため、坂と山の幅を 1.25 倍に延ばす（0.1.28 までは同じ長さで、130 km/h では谷で鉄製の 6.5 G ぎりぎりだった。
  // シェアの URL と同じに丸めると折れることがあった）
  const k = launchV ? 1.25 : 1;
  const dn1 = up1 + 4 + peak * 1.9 * k;
  const endHill = [Lf - 70, Lf - 14, clamp(peak * 0.4, 6, 12)];
  const hills = [];
  let s = dn1;
  let amp = peak * 0.5;
  for (;;) {
    const w = (Math.max(40, Math.sqrt(300 * amp)) + r() * 8) * k;
    if (s + w > endHill[0]) break;
    hills.push([s, s + w, amp * (0.8 + 0.3 * r())]);
    s += w;
    amp *= 0.75;
  }
  // 型 1〜8：頂上のあとを「長さ・高さ」の手順でつなぐ（つなぎ目は傾き 0 のなめらかな坂）
  const boosts = [];
  const kp = kind ? heightMoves(kind, r, peak, up1 + 4, endHill[0], top, boosts, extra && extra.path, k) : null;
  if (extra) extra.boosts = boosts;
  // 最後の山まで、平らな所は低いまま
  const hs = [];
  for (let k = 0; k < H_SAMPLES; k++) {
    const m = (k / (H_SAMPLES - 1)) * Lf;
    let h = 4;
    if (m < up0) h = STATION.h;
    else if (m < up1) h = STATION.h + (top - STATION.h) * smooth01((m - up0) / (up1 - up0));
    else if (m < up1 + 4) h = top;
    else if (kp && m < endHill[0]) h = kpHeight(kp, m);
    else if (m < dn1) h = peak - (peak - 4) * smooth01((m - up1 - 4) / (dn1 - up1 - 4));
    else if (m >= endHill[0]) {
      const t = (m - endHill[0]) / (endHill[1] - endHill[0]);
      h = t < 0.6 ? 4 + (endHill[2] - 4) * smooth01(t / 0.6) : endHill[2] - (endHill[2] - STATION.h) * smooth01((t - 0.6) / 0.4);
    } else {
      for (const [a, b, A] of hills) if (m >= a && m < b) h = 4 + A * (0.5 - 0.5 * Math.cos(((m - a) / (b - a)) * Math.PI * 2));
    }
    hs.push(Math.round(clamp(h, H_MIN, H_MAX) * 2) / 2);
  }
  return hs;
}

// 最初の頂上（s0, top）から end までの高さの手順 [[m, h], ...]。坂の長さは高さの差に合わせる
// （落ちる坂は高さの差の 1.9 倍、登りは 1.6 倍。山の幅は √(300×高さ) 以上。前からの形と同じ目安）
// peak は型の中でいちばん高い山の目安。ブースターを置く所（平らな谷の始まり）を boosts に入れる
// ブースター 1 つ（20 m・11 m/s²、時速 122 km まで）で、勢いが高さ約 22 m 分増える
// path（上から見た道、1 m おき）を渡すと、ブースターはまっすぐな所に置く
// stretch：坂と山の幅を延ばす割合（発射のとき 1.25）
function heightMoves(kind, r, peak, s0, end, top = peak, boosts = [], path = null, stretch = 1) {
  const kp = [[s0, top]];
  let s = s0;
  let h = top;
  const go = (len, to) => {
    s += len;
    h = to;
    kp.push([s, h]);
  };
  // 型 5〜8 は山が多いので、坂を少し急にする（落ちる 1.7 倍・登り 1.35 倍。G は走らせて確かめる）
  const steep = kind >= 5;
  const drop = (to) => go(Math.max(14, Math.abs(h - to) * (to < h ? (steep ? 1.7 : 1.9) : steep ? 1.35 : 1.6) * stretch), to);
  const flat = (len) => go(len, h);
  const hill = (amp, narrow = false) => {
    const w = ((narrow ? Math.max(26, Math.sqrt(180 * amp)) : Math.max(36, Math.sqrt(300 * amp))) + r() * 8) * stretch;
    const base = h;
    go(w / 2, base + amp);
    go(w / 2, base);
  };
  // ブースター：平らな谷（26 m）の始まりに置く。2 つ続けて置くときは n = 2。
  // 加速した先（60 m）が急なカーブだと、時速 122 km で曲がって折れたので、まっすぐな所が来るまで（40 m まで）谷を延ばす
  const boost = (n = 1) => {
    if (path) {
      for (let t = 0; t <= 40; t += 4) {
        if (turnOf(path, s + t, s + t + 26 * n + 34) <= 0.7) {
          if (t) flat(t);
          break;
        }
      }
    }
    for (let k = 0; k < n; k++) {
      boosts.push(s + 2);
      go(26, h);
    }
  };
  // 最後は低い所（4 m）まで下りて終わる。入りきらない手順は飛ばす
  const fits = (len) => s + len + Math.max(0, h - 4) * (kind >= 5 ? 1.7 : 1.9) * stretch + 4 < end;
  const steps = [];
  if (kind === 1) {
    // ふた山：大きく落ちて、もう一度高い山（最初の 7〜8 割）に登る
    const p2 = peak * (0.7 + r() * 0.1);
    steps.push(() => drop(4), () => drop(p2), () => flat(4), () => drop(4));
    for (let a = peak * 0.3; a > 3; a *= 0.7) steps.push(((A) => () => hill(A))(a));
  } else if (kind === 2) {
    // 後半に大落下：高い所をゆるい波で走ってから、最後に大きく落ちる
    steps.push(() => drop(peak * 0.78), () => hill(peak * 0.06), () => flat(6), () => hill(peak * 0.05), () => drop(4), () => hill(peak * 0.25));
  } else if (kind === 3) {
    // ぴょんぴょん：大きく落ちたあと、同じくらいの小さな山がたくさん（ふわっと浮く）
    steps.push(() => drop(4));
    for (let k = 0; k < 12; k++) steps.push(((A) => () => hill(A, true))(peak * (0.3 - k * 0.015)));
  } else if (kind === 4) {
    // 段々：落ちて・平ら・落ちて・平ら、と階段のように下る
    steps.push(() => drop(peak * 0.62), () => flat(10 + r() * 8), () => drop(peak * 0.32), () => flat(10 + r() * 8), () => drop(4), () => hill(peak * 0.2), () => hill(peak * 0.14));
  }
  const tryStep = (st) => {
    const save = [s, h, kp.length, boosts.length];
    st();
    if (fits(0)) return true;
    [s, h] = save;
    kp.length = save[2];
    boosts.length = save[3];
    return false;
  };
  for (const st of steps) tryStep(st);
  // 型 5〜8（ブースターを使う型）：形の決め手（must）が全部入る案を、手の込んだ順に試す。
  // 入らない手順を飛ばすだけだと、道が短いときに前の小さな山だけが入って決め手が抜け、ほかの型と同じに見えた。
  // 決め手が入ったら、残りの手順（opt）は入るものだけ
  if (kind >= 5) {
    // 谷（4 m）から高さ L の山へ：ブースターで登り、頂上で少し平らにしてから谷へ下りる。差が大きいときはブースター 2 つ
    const big = (L) => () => {
      boost(L - top > 18 ? 2 : 1);
      drop(L);
      flat(4);
      drop(4);
    };
    const hl = (A) => () => hill(A);
    const variants = [];
    if (kind === 5) {
      // 後半に大きな山：巻き上げは低め（6 割）で前半は小さな山。谷でブースターをかけて、後半にいちばん高い山へ登る
      const late = Math.min(H_MAX - 4, peak);
      variants.push({ must: [() => drop(4), hl(peak * 0.25), hl(peak * 0.18), big(late)] });
      variants.push({ must: [() => drop(4), hl(peak * 0.2), big(late)] });
      for (const f of [1, 0.85, 0.7]) variants.push({ must: [() => drop(4), big(Math.max(top + 4, late * f))] });
    } else if (kind === 6) {
      // ずっと高い所を走る：高い所で上がり下がりを続け（途中でブースター）、最後に大きく落ちる
      const wave = [() => drop(peak * 0.62), () => drop(peak * 0.8), () => drop(peak * 0.6), () => {
        boost();
        drop(peak * 0.82);
      }];
      variants.push({ must: wave, opt: [() => drop(peak * 0.62), () => drop(peak * 0.76), () => drop(4), hl(peak * 0.2)] });
      variants.push({ must: [() => drop(peak * 0.65), () => {
        boost();
        drop(peak * 0.8);
      }], opt: [() => drop(peak * 0.62), () => drop(4)] });
    } else if (kind === 7) {
      // まん中がいちばん高い：低めの巻き上げのあと、谷でブースターをかけて、まん中のいちばん高い山へ。そのあとはだんだん小さな山
      const after = [];
      for (let a = peak * 0.3; a > 3; a *= 0.7) after.push(hl(a));
      for (const f of [1, 0.85, 0.72]) {
        variants.push({ must: [() => drop(4), hl(peak * 0.15), big(peak * f)], opt: after });
        variants.push({ must: [() => drop(4), big(peak * f)], opt: after });
      }
    } else {
      // だんだん高くなる：谷ごとにブースターをかけて、山を少しずつ高くする（最後の山がいちばん高い）
      const stage = (f) => () => {
        drop(4);
        boost();
        drop(peak * f);
        flat(4);
      };
      for (const fs of [[0.65, 0.85, 1], [0.75, 1], [0.7, 0.9], [0.8]]) variants.push({ must: fs.map(stage), opt: [() => drop(4)] });
    }
    for (const v of variants) {
      s = s0;
      h = top;
      kp.length = 1;
      boosts.length = 0;
      if (!v.must.every((st) => tryStep(st))) continue;
      for (const st of v.opt || []) tryStep(st);
      break;
    }
  }
  if (h > 4) drop(4);
  // あまった所は、平らなままにせず小さな山でうめる
  for (let a = peak * 0.16; a > 2.5 && tryStep(() => hill(a, true)); a *= 0.8);
  return kp;
}
function kpHeight(kp, m) {
  for (let i = 1; i < kp.length; i++) {
    if (m < kp[i][0]) {
      const [m0, h0] = kp[i - 1];
      const [m1, h1] = kp[i];
      return h0 + (h1 - h0) * smooth01((m - m0) / (m1 - m0));
    }
  }
  return kp[kp.length - 1][1];
}

// おまかせの高さ：defaultHeights に、線路が交差する所を片方だけ持ち上げる（ぶつからないように）
export function autoHeights(design, seed, peak, kind = 0, trims = 0, extra = null) {
  const path = pathOf(design);
  const Lf = polyLen(path);
  if (extra) extra.path = path;
  const hs = defaultHeights(seed, peak, Lf, STARTS[design.start || 0].v, kind, trims, extra);
  for (let round = 0; round < 5; round++) {
    const tr = buildTrack({ mat: 1, bar: 1, cars: 4, start: 0, gm: [], ...design, hs }, null);
    if (!tr.clashes.length) break;
    // 交差する所のうち、後から通るほうを持ち上げる
    const span = tr.n - tr.stEnd;
    const u = (Math.max(...tr.clashes) - tr.stEnd) / span;
    const w = 26 / Lf;
    for (let k = 0; k < hs.length; k++) {
      const x = (k / (hs.length - 1) - u) / w;
      if (Math.abs(x) < 1) hs[k] = Math.round(Math.min(H_MAX, hs[k] + 7 * (0.5 + 0.5 * Math.cos(x * Math.PI))) * 2) / 2;
    }
  }
  return hs;
}

// 決まった種から同じ並びを出す乱数
export function rng(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
