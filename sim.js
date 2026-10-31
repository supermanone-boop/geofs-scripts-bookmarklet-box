// sim.js — ジェットコースターの物理シミュレーション（THREE を使わない。node でも動く）
// 同じ設計なら同じ結果になるよう、刻みは 1/120 秒で固定し、乱数は設計から作った種で出す。
// 列車は線路の上の 1 つの位置 s（先頭車）で動かし、後ろの車両は一定の間隔で並べる。
// 線路が耐えられない力・お客さんが耐えられない浮き上がりや横の力がかかると、壊れる・飛んでいく。
import { G, DS, F, MATS, BARS, STARTS, CHUNK, inWater, GAP_LEN, MAX_GIMMICKS, chunkOf, rng, pathOf, polyLen, placeGimmicks, launchTrims, TRIM_DV2, GIMMICKS, loopShape, turnOf } from './track.js';
import { normalize } from './codec.js';

export const DT = 1 / 120;
export const CAR_GAP = 2.7;
const LIFT_V = 4.2;
const DISPATCH_V = 2.6;
const BOOST_A = 11;
const BOOST_V = 34;
const BRAKE_A = 9;
const BRAKE_V = 9;
const ST_BRAKE_A = 12;
const FRIC = 0.12;
const DRAG = 0.0004;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// 準備計算専用の上限。実走行の時間制限には使わない。
const PREP_SIM_LIMIT = 900;

// 巻き上げは一定速度なので、バンク計算用の試走では巻き上げ区間を解析的に飛ばす。
// 高さ600m級で「準備中」のまま長時間メインスレッドを占有するのを防ぐ。
function runDryEstimate(dry, tr) {
  // 駅を出て巻き上げが始まるところまでは通常どおり計算する。
  while (dry.mode !== 'done' && dry.t < 12 && !dry.liftOn) dry.step();

  if (dry.mode !== 'done' && dry.liftOn && tr.liftEnd > 0) {
    // 巻き上げ区間の速さは LIFT_V。各点に値を埋め、バンク推定を欠かさない。
    for (let i = 0; i < tr.n; i++) {
      if (tr.fl[i] & F.LIFT) dry.vEst[i] = Math.max(dry.vEst[i], LIFT_V);
    }
    // 最後尾の車両まで巻き上げを抜けた位置へ移動する。
    const liftExit = Math.min(dry.L - 2, tr.liftEnd * DS + (dry.nCars - 1) * CAR_GAP + 1.5);
    if (liftExit > dry.s) {
      dry.s = liftExit;
      dry.v = Math.max(dry.v, LIFT_V);
      dry.left = true;
      dry.liftOn = false;
      dry.liftDone = true;
      dry.stillT = 0;
      dry.layout();
    }
  }

  // 発射式など、巻き上げを使わないコースも無限ループさせない。
  // 上限到達時は取得済みの速度推定値で線路を生成する。
  if (dry.mode !== 'done') dry.runToEnd(PREP_SIM_LIMIT);
  return dry;
}

// 線路の上の位置 s（m）の値を、隣の点との直線補間で out に入れる
export function sampleTrack(tr, s, out) {
  const x = (((s / DS) % tr.n) + tr.n) % tr.n;
  const i = Math.floor(x);
  const j = i + 1 >= tr.n ? 0 : i + 1;
  const t = x - i;
  const L = (a) => a[i] + (a[j] - a[i]) * t;
  out.i = t < 0.5 ? i : j;
  out.x = L(tr.px);
  out.y = L(tr.py);
  out.z = L(tr.pz);
  out.tx = L(tr.tx);
  out.ty = L(tr.ty);
  out.tz = L(tr.tz);
  out.ux = L(tr.ux);
  out.uy = L(tr.uy);
  out.uz = L(tr.uz);
  out.rx = L(tr.rx);
  out.ry = L(tr.ry);
  out.rz = L(tr.rz);
  out.kx = L(tr.kx);
  out.ky = L(tr.ky);
  out.kz = L(tr.kz);
  return out;
}
const mk = () => ({ i: 0, x: 0, y: 0, z: 0, tx: 1, ty: 0, tz: 0, ux: 0, uy: 1, uz: 0, rx: 0, ry: 0, rz: 1, kx: 0, ky: 0, kz: 0 });

// 設計から乱数の種を作る（同じ設計なら同じ結果）
export function seedOf(design) {
  const s = JSON.stringify([design.pts, design.hs, design.gm, design.mat, design.bar, design.cars, design.start]);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export class Sim {
  constructor(tr, design, { dry = false } = {}) {
    this.tr = tr;
    this.d = design;
    this.dry = dry;
    this.mat = MATS[design.mat];
    this.bar = BARS[design.bar];
    this.launchV = STARTS[design.start].v;
    this.rand = rng(seedOf(design));
    this.t = 0;
    this.nCars = design.cars;
    this.L = tr.L;
    this.stEndS = tr.stEnd * DS;
    this.s = this.stEndS - 1.6; // 先頭車の位置（駅の出口の手前）
    this.v = 0;
    this.lap = 0;
    this.left = false; // 列車が駅を出きったか
    this.mode = 'track'; // track | air | crash | done
    this.result = null; // 'clear' | 'crash' | 'stuck' | 'rollback' | 'overrun'
    this.events = [];
    this.vEst = dry ? new Float64Array(tr.n) : null;
    this.cars = [];
    for (let c = 0; c < this.nCars; c++) {
      const car = { s: 0, p: [0, 0, 0], f: mk(), gU: 1, gR: 0, gT: 0, gUf: 1, gRf: 0, body: null, riders: [] };
      for (let k = 0; k < 2; k++) {
        car.riders.push({
          id: c * 2 + k, side: k, state: 'seat', faintT: 0, body: null, j: 0.85 + this.rand() * 0.3, hands: 0, scream: 0,
        });
      }
      this.cars.push(car);
    }
    this.riders = this.cars.flatMap((c) => c.riders);
    this.bodies = []; // 自由に飛ぶもの（車両・お客さん）
    this.chunkSt = tr.chunks.map(() => null); // 崩れる線路のかたまり { t0, th, om, ax, az, max, h, done }
    this.st = {
      maxV: 0, maxG: 1, minG: 1, maxLat: 0, air: 0, inv: 0, jumps: 0, ejected: 0, fainted: 0, stars: 0,
      broke: false, collapse: false, drop: 0, rideT: 0, maxH: tr.maxH, splash: 0, landed: 0,
    };
    this.stillT = 0;
    this.airRun = 0;
    this.inverted = false;
    this.air = null; // ジャンプ中 { p, v, trail: [[x,y,z,d]], d, gapEnd }
    this.endT = 0;
    this.crashT = 0;
    this.gate = 1; // 駅の出口のゲート（1 = 閉）
    this.lastTop = 0;
    this.dropTop = 0;
    this.tmp = mk();
    this.layout();
  }

  emit(type, x = 0, y = 0, z = 0, data = null) {
    this.events.push({ t: this.t, type, x, y, z, data });
  }

  // 車両の位置を並べ直す（線路の上・ジャンプの軌跡の上）
  layout() {
    for (let c = 0; c < this.nCars; c++) {
      const car = this.cars[c];
      if (car.body) continue;
      const back = c * CAR_GAP;
      if (this.air) this.trailPos(back, car);
      else {
        car.s = this.s - back;
        sampleTrack(this.tr, car.s, car.f);
        car.p[0] = car.f.x;
        car.p[1] = car.f.y;
        car.p[2] = car.f.z;
      }
    }
  }

  // ジャンプの軌跡の上で、先頭から back m 後ろの位置と向き
  trailPos(back, car) {
    const A = this.air;
    const want = A.d - back;
    const f = car.f;
    if (want <= 0) {
      // まだ踏み切り台の上
      sampleTrack(this.tr, A.s0 + want, f);
      car.s = A.s0 + want;
    } else {
      const tl = A.trail;
      let k = tl.length - 1;
      while (k > 0 && tl[k - 1][3] > want) k--;
      const a = tl[Math.max(0, k - 1)];
      const b = tl[k];
      const t = clamp((want - a[3]) / (b[3] - a[3] || 1), 0, 1);
      f.x = a[0] + (b[0] - a[0]) * t;
      f.y = a[1] + (b[1] - a[1]) * t;
      f.z = a[2] + (b[2] - a[2]) * t;
      let tx = b[0] - a[0];
      let ty = b[1] - a[1];
      let tz = b[2] - a[2];
      const l = Math.hypot(tx, ty, tz) || 1;
      setFrame(f, tx / l, ty / l, tz / l);
      car.s = NaN;
    }
    car.p[0] = f.x;
    car.p[1] = f.y;
    car.p[2] = f.z;
  }

  inZone(s, flag) {
    const i = ((Math.round(s / DS) % this.tr.n) + this.tr.n) % this.tr.n;
    return (this.tr.fl[i] & flag) !== 0;
  }

  step() {
    const dt = DT;
    this.t += dt;
    if (this.mode === 'track') this.stepTrack(dt);
    else if (this.mode === 'air') this.stepAir(dt);
    if (this.mode === 'crash') this.crashT += dt;
    this.stepChunks(dt);
    this.stepBodies(dt);
    this.layout();
    // 高高度・極端な加速度で数値が非有限になった場合だけ安全終了する。
    // 時間上限ではなく NaN / Infinity による無限計算を防ぐガード。
    const lead = this.cars && this.cars[0];
    if (this.mode !== 'done' && (!Number.isFinite(this.t) || !Number.isFinite(this.s) || !Number.isFinite(this.v) || (lead && (!Number.isFinite(lead.f.x) || !Number.isFinite(lead.f.y) || !Number.isFinite(lead.f.z))))) {
      this.emit('stuck', Number.isFinite(lead?.f?.x) ? lead.f.x : 0, Number.isFinite(lead?.f?.y) ? lead.f.y : 0, Number.isFinite(lead?.f?.z) ? lead.f.z : 0);
      this.finish('stuck');
    }
    if (this.mode !== 'done') {
      if (this.mode === 'crash' && this.crashT > 7 && this.settled()) this.finish();
      else if (this.mode === 'crash' && this.crashT > 14) this.finish();
    } else this.endT += dt;
  }

  finish(res) {
    if (res) this.result = res;
    if (this.mode === 'done') return;
    this.mode = 'done';
    this.emit('end');
  }

  settled() {
    for (const b of this.bodies) if (!b.rest && !b.gone) return false;
    for (const c of this.chunkSt) if (c && !c.done) return false;
    return true;
  }

  stepTrack(dt) {
    const tr = this.tr;
    const n = this.nCars;
    const lead = this.cars[0];
    // 重力（全車両の平均）・摩擦・空気
    let a = 0;
    for (const car of this.cars) a += -G * car.f.ty;
    a /= n;
    const v0 = this.v;
    a -= Math.sign(v0) * FRIC + DRAG * v0 * Math.abs(v0);
    const leadI = lead.f.i;
    const fl = tr.fl[leadI];
    let chain = false;
    for (const car of this.cars) if (this.inZone(car.s, F.LIFT) && this.lap === 0) chain = true;
    // 駅
    const inSt = (fl & F.STATION) !== 0;
    if (this.lap === 0 && !this.left && inSt) {
      // 発車：タイヤで押し出す
      this.gate = Math.max(0, this.gate - dt * 2);
      if (this.v < DISPATCH_V) a = Math.max(a, 2);
    }
    if (this.launchV && this.lap === 0 && (fl & F.LAUNCH) && this.v < this.launchV && this.v >= 0) a = Math.max(a, (this.launchV * this.launchV) / (2 * 28) + 1);
    if ((fl & F.BOOST) && this.v < BOOST_V && this.v > 0) a += BOOST_A;
    if ((fl & F.BRAKE) && this.v > BRAKE_V) a -= BRAKE_A;
    if (this.lap >= 1 && inSt) {
      // 駅に戻った：ブレーキで止める
      if (this.v > 0) a = Math.min(a, -ST_BRAKE_A);
    }
    let v = this.v + a * dt;
    if (chain && v < LIFT_V) {
      if (this.v < 0 && this.left && this.liftDone) {
        // 巻き上げの逆戻り防止の爪に引っかかった（もう一度登っても同じ）
        this.v = 0;
        this.finish('stuck');
        this.emit('stuck', lead.f.x, lead.f.y, lead.f.z);
        return;
      }
      v = Math.max(v, Math.min(LIFT_V, this.v + 3 * dt));
      if (v > 0 && !this.liftOn) {
        this.liftOn = true;
        this.emit('lift');
      }
    } else if (this.liftOn && !chain) {
      this.liftOn = false;
      this.liftDone = true;
      this.emit('liftEnd');
    }
    if (this.lap >= 1 && inSt && this.v > 0 && v <= 0) v = 0;
    // 駅に後ろ向きに戻ってきた（坂を登れなかった）
    const last = this.cars[n - 1];
    if (this.lap === 0 && this.left && v < 0 && this.inZone(last.s, F.STATION)) {
      v = Math.min(0, this.v + ST_BRAKE_A * dt);
      if (v >= -0.05) {
        this.v = 0;
        this.emit('rollbackStop', lead.f.x, lead.f.y, lead.f.z);
        this.finish('rollback');
        return;
      }
    }
    const aT = (v - this.v) / dt;
    this.v = v;
    const prevS = this.s;
    this.s += v * dt;
    if (this.s >= this.L) {
      this.s -= this.L;
      this.lap++;
      this.emit('home');
    }
    if (!this.left && this.s - (n - 1) * CAR_GAP > this.stEndS + 1) {
      this.left = true;
      this.gate = 0;
    }
    if (this.lap >= 1) this.gate = Math.min(1, this.gate + dt * 0.8);
    this.layout();
    if (this.dry) {
      const i = lead.f.i;
      this.vEst[i] = Math.max(this.vEst[i], Math.abs(v));
      for (const car of this.cars) {
        const j = car.f.i;
        this.vEst[j] = Math.max(this.vEst[j], Math.abs(v));
      }
    }
    // 駅で止まった・止まりきれなかった
    if (this.lap >= 1 && inSt) {
      if (this.v === 0) {
        this.emit('stop', lead.f.x, lead.f.y, lead.f.z);
        this.finish('clear');
        return;
      }
      if (this.s > this.stEndS - 1.2) {
        this.emit('overrun', lead.f.x, lead.f.y, lead.f.z);
        this.crash('overrun');
        return;
      }
    }
    if (this.dry) {
      if (Math.abs(this.v) < 0.1 && !chain && !inSt) this.stillT += dt;
      else this.stillT = 0;
      if (this.stillT > 2.5) this.finish('stuck');
      return;
    }
    // ジャンプの踏み切り
    if ((fl & F.GAP) && this.v > 0) {
      this.takeoff();
      return;
    }
    // 線路がぶつかる所・崩れた所に入った
    if (fl & F.CLASH) {
      this.emit('clash', lead.f.x, lead.f.y, lead.f.z);
      this.breakAt(leadI, 1.2);
      this.crash('clash');
      return;
    }
    for (const car of this.cars) {
      const c = this.chunkSt[chunkOf(car.f.i)];
      if (c && this.t >= c.t0) {
        this.crash('fall');
        return;
      }
    }
    this.forces(aT, dt);
    if (this.mode !== 'track') return;
    // 記録
    const sp = Math.abs(this.v);
    if (sp > this.st.maxV) this.st.maxV = sp;
    if (this.left && this.lap === 0) this.st.rideT += dt;
    // 落差（いちばん高い所からの下り）
    const y = lead.f.y;
    if (y > this.dropTop || lead.f.ty > 0.05) this.dropTop = y;
    else if (this.dropTop - y > this.st.drop) this.st.drop = this.dropTop - y;
    // 逆さま
    if (lead.f.uy < -0.3 && !this.inverted) {
      this.inverted = true;
      this.st.inv++;
      this.emit('invert', lead.f.x, lead.f.y, lead.f.z);
    } else if (lead.f.uy > 0.3) this.inverted = false;
    // 立ち往生（止まった・谷で行ったり来たりしはじめた）
    if (Math.abs(this.v) < 0.12 && !chain && !inSt) this.stillT += dt;
    else this.stillT = 0;
    if (this.left && Math.sign(this.v) !== Math.sign(v0) && v0 !== 0 && !chain) this.flips = (this.flips || 0) + 1;
    if (v0 > 0 && this.v <= 0 && lead.f.uy < 0) this.st.loopStall = true;
    if (this.stillT > 5 || this.flips >= 3) {
      this.emit('stuck', lead.f.x, lead.f.y, lead.f.z);
      this.finish('stuck');
    }
    void prevS;
  }

  // 車両ごとの G。線路が耐えられるか・お客さんが席に残れるか
  forces(aT, dt) {
    const k = 1 - Math.exp(-dt / 0.09);
    const v2 = this.v * this.v;
    const lead = this.cars[0];
    for (const car of this.cars) {
      const f = car.f;
      const ax = v2 * f.kx + aT * f.tx;
      const ay = v2 * f.ky + aT * f.ty + G;
      const az = v2 * f.kz + aT * f.tz;
      car.gU = (ax * f.ux + ay * f.uy + az * f.uz) / G;
      car.gR = (ax * f.rx + ay * f.ry + az * f.rz) / G;
      car.gT = (ax * f.tx + ay * f.ty + az * f.tz) / G;
      car.gUf += (car.gU - car.gUf) * k;
      car.gRf += (car.gR - car.gRf) * k;
    }
    this.checkLoads(dt);
    if (this.mode !== 'track') return;
    // 記録とエアタイム（先頭車で数える）
    const g = lead.gUf;
    if (g > this.st.maxG) this.st.maxG = g;
    if (g < this.st.minG) this.st.minG = g;
    if (Math.abs(lead.gRf) > this.st.maxLat) this.st.maxLat = Math.abs(lead.gRf);
    if (g < 0.25 && Math.abs(this.v) > 3) {
      this.st.air += dt;
      this.airRun += dt;
      if (this.airRun > 0.45 && !this.airShown) {
        this.airShown = true;
        this.emit('airtime', lead.f.x, lead.f.y, lead.f.z);
      }
    } else {
      this.airRun = 0;
      this.airShown = false;
    }
    // お客さんの手と叫び（見た目と音）
    const sp = Math.abs(this.v);
    for (const car of this.cars) {
      for (const r of car.riders) {
        if (r.state !== 'seat') continue;
        const want = sp > 14 || car.gUf < 0.4 ? 1 : 0;
        r.hands += (want - r.hands) * Math.min(1, dt * 3);
      }
    }
  }

  checkLoads(dt) {
    const m = this.mat;
    const b = this.bar;
    for (let c = 0; c < this.nCars; c++) {
      const car = this.cars[c];
      // 線路
      const over = Math.max(car.gUf / m.v, -car.gUf / (m.v * 0.7), Math.abs(car.gRf) / m.l);
      if (over > 1 && Math.abs(this.v) > 2) {
        this.st.broke = true;
        this.emit('break', car.f.x, car.f.y, car.f.z, { g: car.gUf, lat: car.gRf });
        this.breakAt(car.f.i, over);
        this.crash('break');
        return;
      }
      // お客さん
      for (const r of car.riders) {
        if (r.state === 'gone') continue;
        const up = -car.gUf;
        const side = Math.abs(car.gRf);
        if (up > b.v * r.j || side > b.l * r.j) {
          const dir = up > b.v * r.j ? [car.f.ux, car.f.uy, car.f.uz] : scale3([car.f.rx, car.f.ry, car.f.rz], -Math.sign(car.gRf));
          this.eject(car, r, dir, 3 + this.rand() * 5);
          continue;
        }
        if (r.state === 'seat') {
          if (car.gUf > 5.2) r.faintT += dt;
          else r.faintT = Math.max(0, r.faintT - dt * 0.5);
          if (r.faintT > 0.9 || car.gUf > 7.2 * r.j) {
            r.state = 'faint';
            this.st.fainted++;
            this.emit('faint', car.f.x, car.f.y, car.f.z, { id: r.id });
          }
        }
      }
    }
  }

  carVel(car) {
    if (this.air) return this.air.v.slice();
    return [car.f.tx * this.v, car.f.ty * this.v, car.f.tz * this.v];
  }

  eject(car, r, dir, kick) {
    const vel = this.carVel(car);
    const p = riderSeat(car, r);
    r.state = 'gone';
    this.st.ejected++;
    r.body = this.addBody('rider', p, [vel[0] + dir[0] * kick, vel[1] + dir[1] * kick + 2, vel[2] + dir[2] * kick], 0.35, r.id);
    this.emit('eject', p[0], p[1], p[2], { id: r.id, v: Math.hypot(...r.body.v) });
  }

  addBody(kind, p, v, rad, id = -1) {
    const r = this.rand;
    const b = {
      kind, id, p: p.slice(), v: v.slice(), q: [0, 0, 0, 1], w: [(r() - 0.5) * 8, (r() - 0.5) * 8, (r() - 0.5) * 8],
      rad, rest: false, gone: false, star: false, bounces: 0, water: false, apex: false,
    };
    this.bodies.push(b);
    return b;
  }

  // 線路が壊れた：その場所のかたまりと、まわりが順に崩れる。強く壊れたら全体が崩れる
  breakAt(i, over) {
    const nc = this.tr.chunks.length;
    const c0 = chunkOf(i);
    let K = this.mat.cascade;
    const all = over >= 1.6 || (this.mat.id === 'wood' && over >= 1.3);
    if (all) {
      K = Math.ceil(nc / 2);
      if (!this.st.collapse) {
        this.st.collapse = true;
        this.emit('collapse');
      }
    }
    for (let d = -K; d <= K; d++) {
      const c = (((c0 + d) % nc) + nc) % nc;
      if (this.chunkSt[c]) continue;
      const ch = this.tr.chunks[c];
      const delay = Math.abs(d) * (all ? 0.13 : 0.22) + (d === 0 ? 0 : this.rand() * 0.1);
      // 倒れる向き：線路の横（どちらかはランダム）
      const m = Math.min(this.tr.n - 1, (ch.a + ch.b) >> 1);
      const sgn = this.rand() < 0.5 ? -1 : 1;
      let dx = this.tr.rx[m] * sgn;
      let dz = this.tr.rz[m] * sgn;
      const l = Math.hypot(dx, dz) || 1;
      dx /= l;
      dz /= l;
      this.chunkSt[c] = {
        t0: this.t + delay, th: 0, om: 0.15 + this.rand() * 0.25,
        dx, dz, max: 1.2 + this.rand() * 0.35, h: Math.max(2.5, ch.top), drop: 0, dv: 0, done: false, hit: false,
      };
    }
  }

  stepChunks(dt) {
    for (let c = 0; c < this.chunkSt.length; c++) {
      const s = this.chunkSt[c];
      if (!s || s.done || this.t < s.t0) continue;
      if (!s.started) {
        s.started = true;
        const ch = this.tr.chunks[c];
        this.emit('crumble', ch.px, ch.top * 0.6, ch.pz, { c });
      }
      // 根元を支点に倒れる棒（θ'' = 3g / 2h · sin θ）。低いものは落ちるだけ
      s.om += ((3 * G) / (2 * s.h)) * Math.sin(s.th + 0.05) * dt;
      s.th += s.om * dt;
      s.dv += G * dt * 0.35;
      s.drop = Math.min(0.6, s.drop + s.dv * dt);
      if (s.th >= s.max) {
        s.th = s.max;
        s.done = true;
        const ch = this.tr.chunks[c];
        this.emit('thud', ch.px + s.dx * s.h * 0.7, 0, ch.pz + s.dz * s.h * 0.7, { h: s.h });
      }
    }
  }

  // 列車が線路から外れた：車両を自由な物にする
  crash(why) {
    if (this.mode === 'crash' || this.mode === 'done') return;
    this.mode = 'crash';
    this.result = 'crash';
    this.why = why;
    this.crashT = 0;
    const lead = this.cars[0];
    this.emit('crash', lead.p[0], lead.p[1], lead.p[2], { why });
    for (const car of this.cars) {
      const vel = this.carVel(car);
      if (why === 'overrun') {
        vel[0] *= 0.3;
        vel[1] += 4;
        vel[2] *= 0.3;
      }
      const body = this.addBody('car', car.p, vel, 0.9, this.cars.indexOf(car));
      body.q = frameQuat(car.f);
      const spin = Math.min(1, Math.abs(this.v) / 15) + 0.3;
      body.w = body.w.map((w) => w * spin);
      car.body = body;
      for (const r of car.riders) {
        if (r.state === 'gone') continue;
        if (this.rand() > this.bar.hold) this.eject(car, r, [car.f.ux, car.f.uy, car.f.uz], 2 + this.rand() * 4);
      }
    }
  }

  // ジャンプ：先頭車が放物線で飛ぶ。着地の坂に合えば線路に戻る
  takeoff() {
    const lead = this.cars[0];
    const f = lead.f;
    let gapEnd = f.i;
    while (this.tr.fl[gapEnd] & F.GAP) gapEnd = (gapEnd + 1) % this.tr.n;
    const p = [f.x, f.y, f.z];
    // 踏み切りの向きは、台の最後の 1.5 m の向き（すき間の点との平均にしない）
    const tr = this.tr;
    const i1 = tr.wrap(f.i - 1);
    const i0 = tr.wrap(f.i - 4);
    let dx = tr.px[i1] - tr.px[i0];
    let dy = tr.py[i1] - tr.py[i0];
    let dz = tr.pz[i1] - tr.pz[i0];
    const l = Math.hypot(dx, dy, dz) || 1;
    dx /= l;
    dy /= l;
    dz /= l;
    this.air = {
      s0: this.s, d: 0, p, v: [dx * this.v, dy * this.v, dz * this.v],
      trail: [[p[0], p[1], p[2], 0]], gapEnd, landed: false, landS: 0,
    };
    this.mode = 'air';
    this.emit('jump', p[0], p[1], p[2]);
  }

  stepAir(dt) {
    const A = this.air;
    const tr = this.tr;
    const sp = Math.hypot(...A.v);
    A.v[1] -= G * dt;
    for (let k = 0; k < 3; k++) A.v[k] -= DRAG * A.v[k] * sp * dt;
    const p0 = A.p.slice();
    for (let k = 0; k < 3; k++) A.p[k] += A.v[k] * dt;
    A.d += Math.hypot(A.p[0] - p0[0], A.p[1] - p0[1], A.p[2] - p0[2]);
    A.trail.push([A.p[0], A.p[1], A.p[2], A.d]);
    // 空中は全員エアタイム
    this.st.air += dt;
    for (const car of this.cars) {
      car.gU = 0;
      car.gUf += (0 - car.gUf) * 0.05;
    }
    // 着地の判定：着地の坂の始まりの面を越えたか
    const e = A.gapEnd;
    const ex = tr.px[e];
    const ey = tr.py[e];
    const ez = tr.pz[e];
    const d = (A.p[0] - ex) * tr.tx[e] + (A.p[2] - ez) * tr.tz[e];
    const hl = Math.hypot(tr.tx[e], tr.tz[e]) || 1;
    const along = d / hl;
    if (along >= 0 && along < 14) {
      const j = (e + Math.round(along / DS)) % tr.n;
      const rel = [A.p[0] - tr.px[j], A.p[1] - tr.py[j], A.p[2] - tr.pz[j]];
      const up = rel[0] * tr.ux[j] + rel[1] * tr.uy[j] + rel[2] * tr.uz[j];
      const lat = rel[0] * tr.rx[j] + rel[1] * tr.ry[j] + rel[2] * tr.rz[j];
      if (up < 0.3) {
        if (up > -1.6 && Math.abs(lat) < 1.6) {
          const vt = A.v[0] * tr.tx[j] + A.v[1] * tr.ty[j] + A.v[2] * tr.tz[j];
          const vn = A.v[0] * tr.ux[j] + A.v[1] * tr.uy[j] + A.v[2] * tr.uz[j];
          if (vt > 1) {
            // 着地
            this.v = vt;
            this.s = j * DS;
            this.st.jumps++;
            const impact = Math.min(12, Math.abs(vn) / (0.09 * G));
            this.emit('land', tr.px[j], tr.py[j], tr.pz[j], { g: impact });
            this.mode = 'track';
            A.landed = true;
            this.air = null;
            for (const car of this.cars) car.gUf = 1 + impact;
            this.layout();
            sampleTrack(this.tr, this.s, this.cars[0].f);
            this.checkLoads(DT);
            return;
          }
        }
        // 着地の坂にぶつかった
        this.emit('miss', A.p[0], A.p[1], A.p[2]);
        this.breakAt(e, 1.1);
        this.crash('miss');
        return;
      }
    }
    if (along >= 14 || A.p[1] < 0.3) {
      this.emit('miss', A.p[0], A.p[1], A.p[2]);
      this.crash('miss');
    }
  }

  stepBodies(dt) {
    for (const b of this.bodies) {
      if (b.rest || b.gone) continue;
      const sp = Math.hypot(...b.v);
      b.v[1] -= G * dt;
      for (let k = 0; k < 3; k++) {
        b.v[k] -= DRAG * 1.5 * b.v[k] * sp * dt;
        b.p[k] += b.v[k] * dt;
      }
      // 回転
      quatInt(b.q, b.w, dt);
      // てっぺんが高い → 遠くまで飛んでいって見えなくなる（キラーン）
      if (b.kind === 'rider' && !b.apex && b.v[1] <= 0) {
        b.apex = true;
        if (b.p[1] > 42) {
          b.star = true;
          b.gone = true;
          this.st.stars++;
          this.emit('star', b.p[0], b.p[1], b.p[2], { id: b.id });
          continue;
        }
      }
      const inPond = inWater(this.d.map, b.p[0], b.p[2], -1);
      const floor = inPond ? -0.4 : b.rad * (b.kind === 'car' ? 0.6 : 1);
      if (b.p[1] < floor) {
        if (inPond && !b.water) {
          b.water = true;
          this.st.splash++;
          this.emit('splash', b.p[0], 0, b.p[2], { kind: b.kind });
        }
        if (inPond) {
          b.p[1] = floor;
          b.v = b.v.map((v) => v * 0.2);
          b.w = b.w.map((w) => w * 0.3);
          if (Math.hypot(...b.v) < 0.5) b.rest = true;
          continue;
        }
        b.p[1] = floor;
        const hard = -b.v[1];
        if (hard > 3) this.emit('bump', b.p[0], 0, b.p[2], { kind: b.kind, v: hard });
        b.v[1] = hard * (b.kind === 'car' ? 0.25 : 0.4);
        b.v[0] *= 0.65;
        b.v[2] *= 0.65;
        b.w = b.w.map((w) => w * 0.6);
        b.bounces++;
        if (Math.hypot(...b.v) < 1.2 || b.bounces > 8) {
          b.rest = true;
          b.v = [0, 0, 0];
          if (b.kind === 'car') b.q = restQuat(b.q);
        }
      }
    }
  }

  // 最後までまとめて進める（スキップ・試算用）
  runToEnd(maxT = Infinity) {
    while (this.mode !== 'done' && this.t < maxT) this.step();
    return this.summary();
  }

  summary() {
    const st = this.st;
    const nR = this.riders.length;
    const lost = st.ejected;
    const clear = this.result === 'clear';
    // 楽しさ：速さ・G・エアタイム・宙返り・ジャンプ・落差
    let fun = 0;
    fun += clamp((st.maxV * 3.6) / 100, 0, 1) * 28;
    fun += clamp((st.maxG - 1) / 3, 0, 1) * 12;
    fun += clamp(st.air / 3, 0, 1) * 16;
    fun += Math.min(2, st.inv) * 9;
    fun += Math.min(2, st.jumps) * 10;
    fun += clamp(st.drop / 35, 0, 1) * 12;
    fun += clamp(st.rideT / 45, 0, 1) * 8;
    if (st.maxLat > 1.0) fun += 4;
    fun = Math.round(clamp(fun, 0, 100));
    // 安全
    let safe = 100;
    safe -= lost * 18;
    safe -= st.fainted * 10;
    if (st.maxG > 4.5) safe -= (st.maxG - 4.5) * 12;
    if (st.maxLat > 1.8) safe -= (st.maxLat - 1.8) * 15;
    if (this.result === 'crash') safe = 0;
    safe = Math.round(clamp(safe, 0, 100));
    let grade;
    if (this.result === 'crash' || st.collapse || lost >= nR / 2) grade = 'bigfail';
    // 気絶は失敗にしない（1.0.7。オーナーの判断：最後まで走れて誰も飛ばなければ、半分以上が気絶しても成功。結果では「成功（気絶）」と出す）
    else if (!clear || lost > 0) grade = 'fail';
    else if (fun >= 60 && safe >= 70) grade = 'great';
    else grade = 'ok';
    return { grade, fun, safe, result: this.result, why: this.why || '', riders: nR, ...st, time: this.t };
  }
}

function scale3(v, k) {
  return [v[0] * k, v[1] * k, v[2] * k];
}
export function setFrame(f, tx, ty, tz) {
  f.tx = tx;
  f.ty = ty;
  f.tz = tz;
  let ux = -ty * tx;
  let uy = 1 - ty * ty;
  let uz = -ty * tz;
  const l = Math.hypot(ux, uy, uz) || 1;
  f.ux = ux / l;
  f.uy = uy / l;
  f.uz = uz / l;
  f.rx = ty * f.uz - tz * f.uy;
  f.ry = tz * f.ux - tx * f.uz;
  f.rz = tx * f.uy - ty * f.ux;
}
// お客さんの席の位置（車両の中、左右）
export function riderSeat(car, r) {
  const f = car.f;
  const side = r.side ? 0.38 : -0.38;
  return [f.x + f.ux * 1.0 + f.rx * side, f.y + f.uy * 1.0 + f.ry * side, f.z + f.uz * 1.0 + f.rz * side];
}
// 向き（T = 前、U = 上、R = 右）を四元数に。車両の前は +X、上は +Y、右は +Z
export function frameQuat(f) {
  const m00 = f.tx, m01 = f.ux, m02 = f.rx;
  const m10 = f.ty, m11 = f.uy, m12 = f.ry;
  const m20 = f.tz, m21 = f.uz, m22 = f.rz;
  const tr = m00 + m11 + m22;
  let x, y, z, w;
  if (tr > 0) {
    const s = 0.5 / Math.sqrt(tr + 1);
    w = 0.25 / s;
    x = (m21 - m12) * s;
    y = (m02 - m20) * s;
    z = (m10 - m01) * s;
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    w = (m21 - m12) / s;
    x = 0.25 * s;
    y = (m01 + m10) / s;
    z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    w = (m02 - m20) / s;
    x = (m01 + m10) / s;
    y = 0.25 * s;
    z = (m12 + m21) / s;
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    w = (m10 - m01) / s;
    x = (m02 + m20) / s;
    y = (m12 + m21) / s;
    z = 0.25 * s;
  }
  return [x, y, z, w];
}
function quatInt(q, w, dt) {
  const [x, y, z, s] = q;
  const hx = w[0] * dt * 0.5;
  const hy = w[1] * dt * 0.5;
  const hz = w[2] * dt * 0.5;
  q[0] = x + hx * s + hy * z - hz * y;
  q[1] = y + hy * s + hz * x - hx * z;
  q[2] = z + hz * s + hx * y - hy * x;
  q[3] = s - hx * x - hy * y - hz * z;
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  for (let k = 0; k < 4; k++) q[k] /= l;
}
// 地面で止まった車両は、横倒しか、ひっくり返った姿勢にそろえる（めり込んだ角度で止まらない）
function restQuat(q) {
  return q;
}

// おまかせの高さ：一度走らせて、壊れる・飛ぶ・止まるときは、山を低くしてやり直す（おまかせは走りきれるようにする）
// 発射のおまかせの仕上げ：走らせて、事故が起きた所の少し手前（駅で止まりきれないときは駅の手前）にブレーキを、
// 勢いが足りずに止まったときは、止まった谷にブースターを足して、もう一度走らせる（あわせて 5 つまで）。
// 返すのは { gm, added, ok }（うまくいかなければ ok: false。最後に試したもの）
const AUTO_FAIL = ['break', 'overrun', 'eject', 'crash', 'clash', 'miss', 'faint'];
// gm のしかけが全部置けるか。走らせるときと同じ丸めた形（normalize）で確かめる。丸める前の形で確かめると、
// 24 m おきに並べたブレーキが、丸めたあとにわずかに近づいて「近すぎ」になり、黙って抜けていた（0.1.38 まで）
function fits(design, gm) {
  // 置けるかは道と位置だけで決まるので、高さがまだないとき（② のおまかせの途中）は仮の高さで丸める
  const d = normalize({ ...design, hs: design.hs || [], gm }) || { ...design, gm };
  const p = pathOf(d);
  return placeGimmicks(d, polyLen(p), p).every((e) => e.ok);
}
export function addBrakesUntilSafe(design, buildTrack, maxAdd = 5) {
  const path = pathOf(design);
  const Lf = polyLen(path);
  let gm = (design.gm || []).slice();
  let prevGm = gm;
  let lastT = null;
  let added = 0;
  for (;;) {
    // 走らせるときと同じ形（シェアの URL と同じに丸めた形。codec.js の normalize）で確かめる。
    // 丸める前の形で確かめると、駅で止まれるかぎりぎりのコースで、実際に走らせると止まりきれないことがあった
    const d = normalize({ ...design, gm }) || { ...design, gm };
    const tr = prepare(d, buildTrack);
    const sim = new Sim(tr, d);
    // 1 周目にいちばん先まで進んだ所（坂を登りきれずに駅まで戻ったときに使う）
    let far = 0;
    while (sim.mode !== 'done' && sim.t < PREP_SIM_LIMIT) {
      sim.step();
      if (!sim.lap && sim.s > far) far = sim.s;
    }
    if (sim.mode !== 'done') return { gm, added, ok: false };
    const r = sim.summary();
    if (r.result === 'clear' && !r.ejected) return { gm, added, ok: true };
    // ブレーキで遅くなりすぎて、坂を登れなかった：足す前に戻してやめる
    if (lastT === 'brake' && (r.result === 'rollback' || r.result === 'stuck')) return { gm: prevGm, added: added - 1, ok: false };
    // 勢いが足りずに止まった・駅まで戻った：ブースターを足す
    const stuck = r.result === 'stuck' || r.result === 'rollback';
    // 結果を決めた出来事（折れた・駅で止まりきれない など）の所に足す。最初に見つかった出来事にすると、
    // 事故の前に起きた「気を失った」の所（発射の直後など）を選んで、ブレーキを置けずにあきらめていた
    const want = r.result === 'stuck' ? 'stuck' : r.result === 'crash' && AUTO_FAIL.includes(r.why) ? r.why : r.ejected ? 'eject' : null;
    let ev = sim.events.find((e) => (want ? e.type === want : AUTO_FAIL.includes(e.type)));
    if (r.result === 'rollback') {
      const i = tr.wrap(Math.round(far / DS));
      ev = { type: 'rollback', x: tr.px[i], y: tr.py[i], z: tr.pz[i] };
    }
    if (!ev || added >= maxAdd || gm.length >= MAX_GIMMICKS) return { gm, added, ok: false };
    // 事故の場所の、道の上での位置（宙返りの間は数えない。editor.js の uOfIndex と同じ）
    let target = Lf - 36;
    if (ev.type !== 'overrun') {
      let best = tr.stEnd;
      let bd = Infinity;
      for (let i = tr.stEnd; i < tr.n; i++) {
        const dd = (tr.px[i] - ev.x) ** 2 + (tr.py[i] - ev.y) ** 2 * 0.3 + (tr.pz[i] - ev.z) ** 2;
        if (dd < bd) {
          bd = dd;
          best = i;
        }
      }
      let acc = 0;
      let all = 0;
      for (let k = tr.stEnd + 1; k < tr.n; k++) {
        if (tr.fl[k] & F.LOOP) continue;
        const l = Math.hypot(tr.px[k] - tr.px[k - 1], tr.pz[k] - tr.pz[k - 1]);
        all += l;
        if (k <= best) acc += l;
      }
      // ブレーキは事故の所の手前で終わるように、ブースター（20 m）は止まった谷のまん中に（戻ったときは登れなかった坂の手前に）
      target = Math.min(Lf - 36, (acc / (all || 1)) * Lf - (r.result === 'rollback' ? 40 : stuck ? 10 : 34));
    }
    const t = stuck ? 'boost' : 'brake';
    // 置ける所（ほかのしかけと重ならない所）を、手前・少し先の順に探す
    let next = null;
    for (const ds of [0, -12, -25, -36, 8, -50, -62, -75, -88]) {
      const cand = [...gm, { t, u: (target + ds) / Lf }];
      if (fits(design, cand)) {
        next = cand;
        break;
      }
    }
    if (!next) return { gm, added, ok: false };
    prevGm = gm;
    gm = next;
    lastT = t;
    added++;
  }
}

export function safeAutoHeights(design, seed, peak, autoHeights, buildTrack, kind = 0) {
  let hs = null;
  for (let k = 0; k < 5; k++) {
    hs = autoHeights(design, seed + k * 101, peak * (1 - k * 0.12), kind);
    const d = { mat: 1, bar: 1, cars: 4, start: 0, gm: [], ...design, hs };
    const r = new Sim(prepare(d, buildTrack), d).runToEnd(PREP_SIM_LIMIT);
    if (r.result === 'clear' && !r.ejected) break;
  }
  return hs;
}
// おまかせの高さ（設計の画面から）：巻き上げは safeAutoHeights だけ。
// 発射のときは、速さに合わせて発射の区間のすぐ先（最初のカーブの手前・上）にブレーキを置き（launchTrims）、
// 残りの勢いで高さを決める。それでも事故が起きるときは、事故の所の手前にブレーキを足す（addBrakesUntilSafe）
// 返すのは { hs, gm, added }（gm は足したブレーキを含むしかけ全部、added は足した数）
export function safeAuto(design, seed, peak, autoHeights, buildTrack, kind = 0) {
  const res = safeAutoKind(design, seed, peak, autoHeights, buildTrack, kind);
  // ブースターを使う型（5〜8）で、どうしても事故が起きるとき（曲がりの多い道で、加速した先に急なカーブが続く）は、いつもの形（型 0）にする
  if (!res.ok && kind >= 5) {
    const alt = safeAutoKind(design, seed, peak, autoHeights, buildTrack, 0);
    if (alt.ok) return { ...alt, fallback: true };
  }
  return res;
}
function safeAutoKind(design, seed, peak, autoHeights, buildTrack, kind) {
  const path = pathOf(design);
  const Lf = polyLen(path);
  // 型 5〜8 は、高さと一緒に決めた谷にブースターを置く（置けない所はとばす。足りなければ addBrakesUntilSafe が止まった所に足す）
  const withBoosts = (gm, boosts) => {
    let out = gm;
    for (const m of boosts) {
      const cand = [...out, { t: 'boost', u: m / Lf }];
      if (fits(design, cand)) out = cand;
    }
    return out;
  };
  if (!(design.start > 0)) {
    // 巻き上げ：高い山は駅で止まりきれない・最後のカーブで折れることがあるので、まず山の高さのままブレーキを足して試し、
    // だめなときだけ山を低くする（0.1.23 までは低くするだけだったので、高い山にならなかった）
    let last = null;
    for (let k = 0; k < 7; k++) {
      const extra = {};
      const hs = autoHeights(design, seed + k * 101, peak * Math.max(0.35, 1 - k * 0.12), kind, 0, extra);
      const gm0 = withBoosts(design.gm || [], extra.boosts || []);
      const res = addBrakesUntilSafe({ ...design, hs, gm: gm0 }, buildTrack, 3);
      last = { hs, gm: res.gm, added: res.added + gm0.length - (design.gm || []).length, ok: res.ok };
      if (res.ok) return last;
    }
    return last;
  }
  // 発射のすぐ先のブレーキ（置けない所にほかのしかけがあれば、置ける数だけ）。
  // それでも最初のカーブ・登りで事故が起きるときは、もう 1〜2 つ増やして、残りの勢いで高さを作り直す
  // （事故の所の手前にブレーキを足すだけだと、遅くなって最初の山を登れずに戻ってしまう）
  const base = launchTrims(STARTS[design.start].v);
  let last = null;
  const v2 = STARTS[design.start].v ** 2;
  // 増やすのは、残りの勢いで 14 m ほどの山を登れるうちだけ
  for (let want = base; want <= base + 2 && (want === base || v2 - want * TRIM_DV2 >= 2 * G * 20); want++) {
    let gm = (design.gm || []).slice();
    let trims = 0;
    for (let b = 0; b < want; b++) {
      const cand = [...gm, { t: 'brake', u: (45 + b * 25) / Lf }];
      if (!fits(design, cand)) break;
      gm = cand;
      trims++;
    }
    if (want > base && trims < want) break;
    for (let k = 0; k < 3; k++) {
      const extra = {};
      const hs = autoHeights(design, seed + k * 101, peak, kind, trims, extra);
      const gm0 = withBoosts(gm, extra.boosts || []);
      const res = addBrakesUntilSafe({ ...design, hs, gm: gm0 }, buildTrack);
      last = { hs, gm: res.gm, added: res.added + trims + gm0.length - gm.length, ok: res.ok };
      if (res.ok) return last;
    }
  }
  return last;
}

// しかけのおまかせ（③）の型。どれも走らせて、事故が起きないように置けたものだけを使う
export const GIMMICK_THEMES = [
  ['loop'],
  ['loop', 'loop'],
  ['jump'],
  ['loop', 'jump'],
  ['boost', 'loop'],
  ['boost', 'boost'],
];
// 速さの見込み（道の上の位置 m ごと、m/s）。力の確かめをしない試し走り（prepare と同じ）から
function speedAlong(design, buildTrack, Lf) {
  const tr = buildTrack(design, null);
  const dry = new Sim(tr, design, { dry: true });
  runDryEstimate(dry, tr);
  const v = new Float64Array(Math.ceil(Lf) + 2);
  let acc = 0;
  let all = 0;
  const ms = new Float64Array(tr.n);
  for (let k = tr.stEnd + 1; k < tr.n; k++) {
    if (!(tr.fl[k] & F.LOOP)) all += Math.hypot(tr.px[k] - tr.px[k - 1], tr.pz[k] - tr.pz[k - 1]);
    ms[k] = all;
  }
  for (let k = tr.stEnd + 1; k < tr.n; k++) {
    acc = Math.min(v.length - 1, Math.round((ms[k] / (all || 1)) * Lf));
    v[acc] = Math.max(v[acc], dry.vEst[k]);
  }
  for (let m = 1; m < v.length; m++) if (!v[m]) v[m] = v[m - 1];
  return v;
}
// 置ける所の候補（道の上の位置 m）。宙返り・ジャンプはまっすぐな所（③ の緑の帯と同じ決まり）で、
// 入る速さが合う所（宙返りは約 58〜94 km/h、ジャンプは約 58〜72 km/h。ブースターは 70 km/h より遅い所）。
// 速さの幅は、道 9 型 × 高さ 3 型で 9 m おきに置いて走らせた結果から決めた（遅いと止まる・着地の坂の手前に落ちる、速いと先に落ちる）
const V_RANGE = { loop: [16, 26], jump: [16, 20], boost: [0, 20], brake: [0, 99] };
function spotsFor(t, path, Lf, vAt) {
  const len = t === 'loop' ? loopShape().adv : GIMMICKS[t].len;
  const [v0, v1] = V_RANGE[t];
  const out = [];
  for (let m = 44; m + len < Lf - 40; m += 2) {
    if (t === 'loop' && turnOf(path, m - 10, m + len + 10) > 1.1) continue;
    if (t === 'jump' && turnOf(path, m - 6, m + len + 14) > 0.5) continue;
    const v = vAt[Math.min(vAt.length - 1, Math.round(m))];
    if (v < v0 || v > v1) continue;
    out.push(m);
  }
  return out;
}
// theme（GIMMICK_THEMES の番号）から始めて、うまく置けなければほかの型も試す（約 1.2 秒まで）。rnd は 0〜1 の乱数
// 返すのは { gm, theme, ok }。いま置いてあるしかけは置きかえる（発射のすぐ先のブレーキと、しかけなしで走るのに要るブレーキ・ブースターは置く）
// keep：残すしかけ（② のおまかせが高さに合わせて置いたブースター・ブレーキ。それがないと走れない形があるため）
export function autoGimmicks(design, buildTrack, theme, rnd = Math.random, tries = 5, budgetMs = 1200, keep = []) {
  const t0 = Date.now();
  const path = pathOf(design);
  const Lf = polyLen(path);
  let base = keep.slice();
  if (design.start > 0 && !base.some((g) => g.t === 'brake' && g.u * Lf < 100)) {
    for (let b = 0; b < launchTrims(STARTS[design.start].v); b++) {
      const cand = [...base, { t: 'brake', u: (45 + b * 25) / Lf }];
      if (!fits(design, cand)) break;
      base.push(cand[cand.length - 1]);
    }
  }
  // しかけなしで走れるのに要るブレーキ・ブースター（② のおまかせが足したものに当たる）を先に足しておく
  const need = addBrakesUntilSafe({ ...design, gm: base }, buildTrack, 5);
  if (need.ok) base = need.gm;
  // しかけを置く前から最後まで走れないコース（途中で止まる・事故）では、「今より悪くならない」置き方も使う。
  // 0.1.36 までは「最後まで事故なく走れる」置き方だけを使っていたので、そういうコースには何も置けなかった
  const baseSum = need.ok ? null : summaryOf({ ...design, gm: base }, buildTrack);
  const baseRank = baseSum ? rankOf(baseSum) : 0;
  const baseStuck = !!baseSum && (baseSum.result === 'stuck' || baseSum.result === 'rollback');
  let best = null;
  let trial = null;
  const v0 = speedAlong({ ...design, gm: base }, buildTrack, Lf);
  // 置けなかったときに理由を出すための、いちばん速い所（m/s）
  const maxV = Math.max(...v0);
  // 型を順に試し、どれも置けなければ最後にブースター 1 つ。それもだめなら、いまのしかけのまま（事故の起きる置き方は返さない）
  const order = [...GIMMICK_THEMES.keys()].map((n) => (theme + n) % GIMMICK_THEMES.length);
  order.push(-1);
  for (const th of order) {
    if (th >= 0 && Date.now() - t0 > budgetMs) continue;
    // ブースターを先に置き、その先の速さで宙返りなどを選ぶ
    const list = (th < 0 ? ['boost'] : GIMMICK_THEMES[th]).slice().sort((a, b) => (a === 'boost' ? -1 : 0) - (b === 'boost' ? -1 : 0));
    for (let k = 0; k < tries && (th < 0 || Date.now() - t0 < budgetMs); k++) {
      let gm = base.slice();
      let vAt = v0;
      let ok = true;
      for (const t of list) {
        const spots = spotsFor(t, path, Lf, vAt).filter((m) => placeGimmicks({ ...design, gm: [...gm, { t, u: m / Lf }] }, Lf, path).every((e) => e.ok));
        if (!spots.length) {
          ok = false;
          break;
        }
        // 線路どうしがぶつからない所を選ぶ（宙返りの輪がほかの線路にかかることがある）
        let pick = null;
        for (let q = 0; q < 6 && !pick; q++) {
          const g = { t, u: spots[Math.floor(rnd() * spots.length)] / Lf };
          if (!buildTrack({ ...design, gm: [...gm, g] }, null).clashes.length) pick = g;
        }
        if (!pick) {
          ok = false;
          break;
        }
        gm.push(pick);
        if (t === 'boost' || list.length > 1) vAt = speedAlong({ ...design, gm }, buildTrack, Lf);
      }
      if (!ok) continue;
      gm = gm.sort((a, b) => a.u - b.u);
      // 置く前から走れないコースは、ブースターで勢いを足すと駅で止まりきれなくなりやすいので、ブレーキを多めに（5 つまで）足せる
      const res = addBrakesUntilSafe({ ...design, gm }, buildTrack, 5);
      if (res.ok) return { gm: res.gm, theme: th, ok: true, fixed: baseRank > 0 };
      // 事故なく走れる置き方でなくても、宙返り・ジャンプが入るもの（か、置く前より結果がよくなるもの）は覚えておき、
      // 見つからなければいちばんましなものを置く（0.1.38 までは事故の起きる置き方は返さず、何度押しても何も置かれなかった）。
      // 途中で止まるコースは、ブースターで止まる所を越えられるなら、その先で事故が起きても置く（どこで起きるかは図に出す）。
      // それ以外で、ブースター・ブレーキだけで事故が残るものは、コースが悪くなるだけなので使わない
      const run = runOf({ ...design, gm: res.gm }, buildTrack);
      const rank = rankOf(run.r);
      const fun = res.gm.some((g) => g.t === 'loop' || g.t === 'jump');
      const pass = baseStuck && res.gm.some((g) => g.t === 'boost') && !['stuck', 'rollback'].includes(run.r.result);
      const score = rank * 2 - (fun ? 1 : 0);
      // 置く前は事故なく走れるコース（baseRank 0）には、事故の起きる置き方は置かない（押す前より悪くなるので。0.1.40）
      if (baseRank && (fun || pass || rank < baseRank) && (!best || score < best.score)) {
        const k = rank ? riskOf(run.r) : null;
        const e = k ? run.sim.events.find((x) => x.type === (k === 'crash' ? run.r.why : k)) : null;
        best = { gm: res.gm, theme: th, rank, score, r: run.r, ev: e ? { type: e.type, x: e.x, y: e.y, z: e.z } : null };
      }
      // ブースターで止まる所は越えたが、その先で事故になった：どこで何が起きたかを覚えておく（図に出す）
      if (!trial && baseRank && rank > baseRank && res.gm.some((g) => g.t === 'boost')) {
        const e = run.sim.events.find((x) => x.type === (run.r.why || 'eject'));
        if (e) trial = { type: e.type, x: e.x, y: e.y, z: e.z };
      }
    }
  }
  // 置く前に起きること（overrun は事故に含めて知らせる）
  const bf = baseSum ? riskOf(baseSum) : null;
  const why = bf === 'overrun' ? 'crash' : bf;
  // 事故なく走れる置き方は見つからなかった：いちばんましな置き方を置く。risk：置いたあとに起きること
  if (best) return { gm: best.gm, theme: best.theme, ok: true, baseFail: why, maxV, risk: best.rank ? riskOf(best.r) : null, ev: best.ev };
  return { gm: design.gm || [], theme: -1, ok: false, baseFail: why, maxV, trial };
}
// 結果から、何が起きるかの短いことば（③ のおまかせの知らせに使う）
function riskOf(r) {
  if (r.result === 'stuck' || r.result === 'rollback') return 'stuck';
  if (r.result === 'crash') return r.why === 'overrun' ? 'overrun' : 'crash';
  return 'eject';
}
// 走らせるときと同じ丸めた形で走らせた結果（runOf は出来事も見られるように物理ごと返す）
function runOf(design, buildTrack) {
  const d = normalize(design) || design;
  const sim = new Sim(prepare(d, buildTrack), d);
  return { r: sim.runToEnd(), sim };
}
const summaryOf = (design, buildTrack) => runOf(design, buildTrack).r;
// 結果の重さ：0 大成功・成功、1 失敗（止まった・飛ばされた）、2 大失敗（事故）
const rankOf = (r) => (r.grade === 'bigfail' ? 2 : r.grade === 'fail' ? 1 : 0);

// 設計をまとめて試す：予想の速さでバンクを付けた線路と、結果
export function prepare(design, buildTrack) {
  const dryTr = buildTrack(design, null);
  const dry = new Sim(dryTr, design, { dry: true });
  runDryEstimate(dry, dryTr);
  const tr = buildTrack(design, dry.vEst);
  return tr;
}
export { CHUNK, GAP_LEN };
