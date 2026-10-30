// editor.js — 設計の 3 画面（① 上から道を描く ② 横から高さを描く ③ しかけと設定）
// 方眼紙に手で描く見た目。描き終わるたびに線路を組んで、予想の速さ・ぶつかる所・費用を出す。
import {
  FIELD, STATION, MAPS, mapOf, H_SAMPLES, H_MAX, H_MIN, GIMMICKS, GIMMICK_KEYS, MAX_GIMMICKS, MATS, BARS, STARTS,
  MAX_LEN, MAX_CARS, STROKE_KINDS, HEIGHT_KINDS, PEAK_TIERS, launchGentle, launchGuide, horizPath, pathOf, polyLen, defaultHeights, autoHeights, costOf, leadOf, loopShape, turnOf, buildTrack, placeGimmicks, randomStroke, F, ST_LEN,
} from './track.js';
import { fixCurves, smoothCurves } from './fix.js';
import { themeLayout, layoutDots } from './themes.js';
import { Sim, safeAuto, autoGimmicks, GIMMICK_THEMES } from './sim.js';
import { sound } from './audio.js';
import { RAIL_LOOKS, CAR_LOOKS, RIDER_LOOKS, SCENE_LOOKS, cleanLook } from './looks.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const PAPER = '#fbf8ef';
const GRID = '#dfe8f0';
const INK = '#2b3a55';
const PEN = '#e84a5f';
const FONT = '"M PLUS 1p", "Hiragino Kaku Gothic ProN", sans-serif';
const MIN_LEN = 80;
const INC_KEY = 'rc_incidents';
const yen = (man) => (man >= 10000 ? `${(man / 10000).toFixed(man % 10000 ? 2 : 0)}億円` : `${Math.round(man).toLocaleString()}万円`);
export { yen, randomStroke };
// 速さの色（遅い＝青 → 50 km/h＝黄 → 100 km/h 以上＝赤）
function speedColor(kmh) {
  const stops = [[0, [79, 176, 236]], [50, [246, 196, 69]], [100, [224, 80, 58]]];
  const x = clamp(kmh, 0, 100);
  const a = x < 50 ? stops[0] : stops[1];
  const b = x < 50 ? stops[1] : stops[2];
  const t = (x - a[0]) / (b[0] - a[0]);
  return `rgb(${a[1].map((v, q) => Math.round(v + (b[1][q] - v) * t)).join(',')})`;
}
// 描く前の高さ（駅の高さのまま平ら）と、山を描いたかどうか
const flatHeights = () => new Array(H_SAMPLES).fill(STATION.h);
const heightsDrawn = (d) => !!d.hs && Math.max(...d.hs) >= 6;
// おまかせの型の名前（track.js の randomStroke・defaultHeights の kind の順）
const STROKE_NAMES = ['大きな輪', 'くねくね', 'くるりん', '池をぐるっと', 'つづら折り', 'うずまき', 'ひょうたん', '星', '稲妻'];
const HEIGHT_NAMES = ['いつもの形', 'ふた山', '後半に大落下', 'ぴょんぴょん', '段々', '後半に大きな山', 'ずっと高い所を走る', 'まん中がいちばん高い', 'だんだん高くなる'];
export const INC_ICON = { break: '💥', crash: '💥', eject: '🚀', faint: '😵', stuck: '🛑', overrun: '🛑', miss: '💥', clash: '💥' };

// 点の並びのうち、w にいちばん近い点の番号と距離
function nearestPt(pts, w) {
  let bi = 0;
  let bd = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const dd = Math.hypot(pts[i][0] - w[0], pts[i][1] - w[1]);
    if (dd < bd) {
      bd = dd;
      bi = i;
    }
  }
  return [bi, bd];
}
// 線をつまんで動かす：もとの線を 1.5 m おきに並べ直し、つまんだ所から道のりで R m までを、離れるほど少なく動かす。
// 駅とつながる両はしは動かさない（はしから 12 m かけて動く量を 0 にする）
const GRAB_R = 28;
function resample(pts, step = 1.5) {
  const out = [pts[0].slice()];
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1];
    const [bx, bz] = pts[i];
    const l = Math.hypot(bx - ax, bz - az);
    let t = step - acc;
    while (t <= l) {
      out.push([ax + ((bx - ax) * t) / l, az + ((bz - az) * t) / l]);
      t += step;
    }
    acc = l - (t - step);
  }
  const last = pts[pts.length - 1];
  const q = out[out.length - 1];
  if (Math.hypot(q[0] - last[0], q[1] - last[1]) > 0.3) out.push(last.slice());
  return out;
}
function bendPts({ base, s, s0, L }, dx, dz) {
  return base.map(([x, z], i) => {
    const t = Math.abs(s[i] - s0) / GRAB_R;
    if (t >= 1) return [x, z];
    const ends = Math.min(1, s[i] / 12, (L - s[i]) / 12);
    const w = (0.5 + 0.5 * Math.cos(Math.PI * t)) * Math.max(0, ends);
    return [clamp(x + dx * w, FIELD.x0, FIELD.x1), clamp(z + dz * w, FIELD.z0, FIELD.z1)];
  });
}

export class Editor {
  constructor(root, { onDone, onBack }) {
    this.root = root;
    this.onDone = onDone;
    this.onBack = onBack;
    this.step = 1;
    this.design = null;
    this.tool = 'loop';
    this.preview = null; // { tr, vEst, path, Lf }
    this.seed = 1;
    this.cv = root.querySelector('#ed-canvas');
    this.cx = this.cv.getContext('2d');
    this.title = root.querySelector('#ed-title');
    this.steps = root.querySelectorAll('#ed-steps li');
    // 手順の印を押すと、その段階へ飛ぶ（先の段階へは、そこまでの段階を「つぎへ」で進められるときだけ）
    this.steps.forEach((li, k) => li.querySelector('button').addEventListener('click', () => this.jump(k + 1)));
    this.hint = root.querySelector('#ed-hint');
    this.legend = root.querySelector('#ed-legend');
    this.info = root.querySelector('#ed-info');
    this.tools = root.querySelector('#ed-tools');
    this.opts = root.querySelector('#ed-opts');
    this.btnNext = root.querySelector('#ed-next');
    this.btnPrev = root.querySelector('#ed-prev');
    this.btnAuto = root.querySelector('#ed-auto');
    // ①〜③ からでも、そのまま走らせる（直して走らせるのをくり返しやすくする）
    this.btnRun = root.querySelector('#ed-run');
    this.btnRun.addEventListener('click', () => {
      if (!this.canReach(4)) return;
      sound.sfx('tap');
      this.onDone(this.design);
    });
    this.btnClear = root.querySelector('#ed-clear');
    // おまかせの結果を出すカード（図の上）
    this.cvWrap = root.querySelector('.ed-canvas-wrap');
    // 拡張版：広い敷地をズーム／パンして編集する。初期表示は旧版と同じ範囲。
    this.mapView = { cx: 0, cz: 0, zoom: 1 };
    this.panning = null;
    const viewTools = document.createElement('div');
    viewTools.className = 'ed-exp-viewtools';
    viewTools.innerHTML = '<button type="button" data-map="out" aria-label="縮小">−</button><button type="button" data-map="in" aria-label="拡大">＋</button><button type="button" data-map="fit">全体</button><span data-map-label>100%</span><div class="ed-exp-pan"><button type="button" data-map="up">▲</button><div><button type="button" data-map="left">◀</button><button type="button" data-map="down">▼</button><button type="button" data-map="right">▶</button></div></div>';
    this.cvWrap.appendChild(viewTools);
    viewTools.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-map]');
      if (!b) return;
      const a = b.dataset.map;
      const v = this.mapView;
      if (a === 'in') v.zoom = clamp(v.zoom * 1.25, 0.06, 8);
      else if (a === 'out') v.zoom = clamp(v.zoom / 1.25, 0.06, 8);
      else if (a === 'fit') this.fitMapView();
      else if (a === 'up') v.cz -= 45 / v.zoom;
      else if (a === 'down') v.cz += 45 / v.zoom;
      else if (a === 'left') v.cx -= 45 / v.zoom;
      else if (a === 'right') v.cx += 45 / v.zoom;
      this.draw();
      const label = viewTools.querySelector('[data-map-label]');
      if (label) label.textContent = `${Math.round(v.zoom * 100)}%`;
    });
    this.toastEl = document.createElement('div');
    this.toastEl.className = 'ed-toast';
    this.toastEl.setAttribute('role', 'status');
    this.toastEl.addEventListener('click', () => this.hideToast());
    this.cvWrap.appendChild(this.toastEl);
    // 見た目の小窓
    this.lookSheet = root.querySelector('#ed-look');
    this.lookRows = root.querySelector('#ed-look .look-rows');
    root.querySelector('#ed-look-ok').addEventListener('click', () => this.closeLook(true));
    this.lookSheet.addEventListener('click', (e) => {
      if (e.target === this.lookSheet) this.closeLook(true);
    });
    addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.lookSheet.hidden) this.closeLook(true);
    });
    this.drawing = false;
    this.last = null;
    this.btnNext.addEventListener('click', () => this.next());
    this.btnPrev.addEventListener('click', () => this.prev());
    this.btnAuto.addEventListener('click', () => this.auto());
    this.btnClear.addEventListener('click', () => this.clear());
    // 元に戻す・やり直す（ボタンと、PC は Ctrl+Z / Ctrl+Shift+Z・Ctrl+Y）
    this.undoStack = [];
    this.redoStack = [];
    this.btnUndo = root.querySelector('#ed-undo');
    this.btnRedo = root.querySelector('#ed-redo');
    this.btnUndo.addEventListener('click', () => this.undo());
    this.btnRedo.addEventListener('click', () => this.redo());
    addEventListener('keydown', (e) => {
      if (this.root.hidden || !(e.ctrlKey || e.metaKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) this.undo();
      else if ((k === 'z' && e.shiftKey) || k === 'y') this.redo();
      else return;
      e.preventDefault();
    });
    this.cv.addEventListener('pointerdown', (e) => this.down(e));
    this.cv.addEventListener('pointermove', (e) => this.move(e));
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) this.cv.addEventListener(ev, (e) => this.up(e));
    new ResizeObserver(() => this.resize()).observe(this.cv.parentElement);
  }

  // 前に走らせたときに起きたこと（[{ i, x, z, type }]）。図に印を出す
  setIncidents(list, label = '前回の事故の場所') {
    this.incidents = list || [];
    this.incU = null;
    this.incLabel = label;
    this.saveIncidents();
  }
  // 事故の印は、ブラウザにも覚えておく（「つづきから」で開いても出す。1.0.15 までは消えていた。オーナーの指摘）
  saveIncidents() {
    try {
      localStorage.setItem(INC_KEY, JSON.stringify({ list: this.incidents, u: this.incU, label: this.incLabel }));
    } catch (e) { /* 覚えられなくても遊べる */ }
  }
  loadIncidents() {
    let o = null;
    try {
      o = JSON.parse(localStorage.getItem(INC_KEY) || 'null');
    } catch (e) { /* 読めなければ印なし */ }
    this.setIncidents(o && Array.isArray(o.list) ? o.list : [], (o && o.label) || undefined);
    if (o && Array.isArray(o.u)) this.incU = o.u;
  }

  // ---------------- 元に戻す・やり直す ----------------
  snap() {
    const { pts, hs, gm, mat, bar, cars, start, look, map } = this.design;
    return JSON.stringify({ pts, hs, gm, mat, bar, cars, start, look, map: map || 0 });
  }
  // 変える直前に呼ぶ
  record() {
    // 最後に直した段階（結果の「なおす」でそこへ戻る）
    this.editStep = this.step;
    this.undoStack.push(this.snap());
    if (this.undoStack.length > 60) this.undoStack.shift();
    this.redoStack.length = 0;
    this.updateUndo();
  }
  restore(str) {
    Object.assign(this.design, JSON.parse(str));
    this.buildTools();
    if (!this.lookSheet.hidden) this.renderLook();
    this.refresh(true);
    this.onChange?.();
    this.updateUndo();
  }
  undo() {
    if (!this.undoStack.length || this.drawing) return;
    this.redoStack.push(this.snap());
    sound.sfx('tap');
    this.restore(this.undoStack.pop());
  }
  redo() {
    if (!this.redoStack.length || this.drawing) return;
    this.undoStack.push(this.snap());
    sound.sfx('tap');
    this.restore(this.redoStack.pop());
  }
  updateUndo() {
    this.btnUndo.disabled = !this.undoStack.length;
    this.btnRedo.disabled = !this.redoStack.length;
  }

  open(design, step = 1) {
    this.design = design;
    this.mapView = { cx: 0, cz: 0, zoom: 1 };
    this.panning = null;
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.updateUndo();
    this.editStep = 0;
    this.root.hidden = false;
    this.go(step);
    if (step === 1 && this.design.pts && this.design.pts.length > 1) this.fitMapView();
  }
  close() {
    this.closeLook();
    this.root.hidden = true;
  }

  go(step) {
    this.hideToast();
    this.step = step;
    this.pid = null;
    this.drawing = false;
    this.root.dataset.step = String(step);
    const d = this.design;
    // 高さは描いていない平らな線から始める（自分で描くのが楽しいところなので、最初から山を入れておかない）
    if (step >= 2 && (!d.hs || d.hs.length !== H_SAMPLES)) d.hs = flatHeights();
    this.title.textContent = ['', '① 上から 道を描こう', '② 横から 高さを描こう', '③ しかけを 置こう', '④ 乗り物を 決めよう'][step];
    // いまどの段階か（PC の横長の画面では ② と ③ の図がほとんど同じに見えるので、手順の印と、切りかわったときの動きで分かるようにする）
    this.steps.forEach((li, k) => {
      li.className = k + 1 < step ? 'done' : k + 1 === step ? 'on' : '';
    });
    this.root.classList.remove('ed-enter');
    void this.root.offsetWidth;
    this.root.classList.add('ed-enter');
    this.btnPrev.textContent = step === 1 ? '◀ タイトル' : '◀ もどる';
    this.btnNext.textContent = step === 4 ? '完成！ 走らせる ▶' : 'つぎへ ▶';
    this.btnAuto.hidden = step >= 4;
    this.btnRun.hidden = step >= 4;
    this.btnClear.hidden = step >= 4;
    this.btnClear.textContent = 'けす';
    this.buildTools();
    this.refresh(true);
    this.resize();
  }

  pathLen() {
    return polyLen(pathOf(this.design));
  }

  // 線路を組んで、予想の速さを出す（描き終わったとき・設定を変えたとき）
  refresh(full = true) {
    const d = this.design;
    if (!d.pts || d.pts.length < 2) {
      this.preview = null;
      this.updateInfo();
      this.draw();
      return;
    }
    const path = pathOf(d);
    const Lf = polyLen(path);
    let tr = null;
    let vEst = null;
    let sum = null;
    // ① でも、高さを描いたあとは予想の速さを出す（線路を速さの色の帯で出すため。1.0.15）
    if (full && (this.step >= 2 || heightsDrawn(d))) {
      tr = buildTrack(d, null);
      const sim = new Sim(tr, d, { dry: true });
      sim.runToEnd(120);
      vEst = sim.vEst;
      sum = { result: sim.result, maxV: Math.max(...vEst), clashes: tr.clashes.length };
    }
    this.preview = { path, Lf, tr, vEst, sum };
    // 前回の印を、道の上の位置（u）に直しておく（同じ線路のときに一度だけ。あとで描き直しても、だいたいの場所に出す）
    if (tr && this.incidents && this.incidents.length && !this.incU) {
      this.incU = this.incidents.map((e) => ({ ...e, u: this.uOfIndex(Math.min(tr.n - 1, e.i)), h: tr.py[Math.min(tr.n - 1, e.i)] })).filter((e) => e.u != null);
      this.saveIncidents();
    }
    this.updateInfo();
    this.draw();
  }

  cost() {
    if (!this.preview) return 0;
    return costOf(this.design, this.preview.Lf);
  }

  updateInfo() {
    const d = this.design;
    const p = this.preview;
    const lines = [];
    if (this.step === 1) {
      const len = p ? Math.round(p.Lf + ST_LEN) : 0;
      lines.push(`全長 ${len}m`);
      this.hint.textContent = p ? '線をつまんで動かすと、その辺りだけ形が変わります。線の先からは続き、線から離れた所からは描き直し' : (this.mapXf().rot ? '駅の上の「スタート」から描きはじめて、ぐるっと回って下の「ゴール」へ戻ろう' : '駅の右の「スタート」から描きはじめて、ぐるっと回って左の「ゴール」へ戻ろう');
      this.btnNext.disabled = !p || p.Lf < MIN_LEN;
      if (this.fixSub) this.fixSub.disabled = !d.pts || d.pts.length < 2;
      if (p && p.Lf < MIN_LEN) lines.push('（もっと長く描こう）');
    } else if (this.step === 2) {
      const drawn = heightsDrawn(d);
      this.hint.textContent = !drawn ? '指で山を描こう！ 描きにくければ「おまかせ」' : d.start > 0 ? '指でなぞると高さが変わる。駅を出てすぐ発射で一気に加速します' : '指でなぞると高さが変わる。最初の坂は巻き上げ（チェーン）で登ります';
      this.btnNext.disabled = !drawn;
    } else if (this.step === 3) {
      this.hint.textContent = 'しかけを選んで、図をタップして置く（置いたものをタップで外す）。置かなくても走れます';
      this.btnNext.disabled = !p;
    } else {
      this.hint.textContent = '線路の強さ・安全バー・車両の数・スタートのしかたで、結果が大きく変わります';
    }
    if (p && p.tr && heightsDrawn(d)) {
      lines.push(`いちばん高い所 ${Math.round(p.tr.maxH)}m`);
      if (p.sum) {
        lines.push(`予想の最高速度 ${Math.round(p.sum.maxV * 3.6)}km/h`);
        if (p.sum.result === 'stuck' || p.sum.result === 'rollback') lines.push('⚠ 途中で止まりそう');
        if (p.sum.clashes) lines.push(`⚠ 線路がぶつかる所が ${p.sum.clashes} か所`);
        const back = p.vEst ? p.vEst[p.tr.n - 1] * 3.6 : 0;
        if (back > 72) lines.push(`⚠ 駅に ${Math.round(back)}km/h で戻ってくる`);
      }
    }
    if (this.step === 4) this.btnNext.disabled = !p;
    this.updateSteps();
    this.info.innerHTML = lines.join('　');
    this.updateLegend();
    void d;
  }

  // 図の凡例（線の色の意味）
  updateLegend() {
    const L = (cls, text) => `<span><i class="lg ${cls}"></i>${text}</span>`;
    const T = (mark, text) => `<span>${mark} ${text}</span>`;
    const items = [];
    if (this.step === 1) {
      items.push(L('', '描いた線'), L('red', '実際の線路'));
      if (heightsDrawn(this.design) && this.preview && this.preview.vEst) items.push(L('hgt', '予想の速さ（青＝遅い → 黄 → 赤＝速い）'), T('<b style="color:#c0392b">94km/h</b>', 'その辺りでいちばん速い所'));
      if (this.design.start > 0) items.push(L('orange', '発射のあと、急に曲がれない所（ゆるいカーブになる）'));
    }
    else if (this.step === 2 || this.step === 3) {
      items.push(L(this.step === 3 ? 'faint' : '', this.step === 3 ? '描いた高さ（② で描き直せます）' : '描いた高さ'), L('red', '実際の線路の高さ'));
      if (heightsDrawn(this.design)) {
        items.push(L('blue', '予想の速さ（数字は最高速度）'), L('box', '巻き上げ（チェーンで登る）'));
        if (this.preview && this.preview.tr && this.preview.tr.clashes.length) items.push(T('<b style="color:#d02020">✕</b>', '線路がぶつかる所'));
      }
      if (this.step === 3 && (this.tool === 'loop' || this.tool === 'jump')) items.push(L('green', this.tool === 'jump' ? 'ジャンプが着地しやすい所（まっすぐな所）' : '宙返りを置ける所'));
    }
    if (this.step <= 3 && this.incidents && this.incidents.length) {
      // 気絶は事故ではない（1.0.7 から成功）ので、事故の場所とは分けて出す
      if (this.incidents.some((e) => e.type !== 'faint')) items.push(T('💥🚀🛑', this.incLabel || '前回の事故の場所'));
      if (this.incidents.some((e) => e.type === 'faint')) items.push(T('😵', 'お客さんが気絶した所（事故ではありません）'));
    }
    this.legend.innerHTML = items.join('');
  }

  buildTools() {
    const d = this.design;
    this.tools.innerHTML = '';
    this.opts.innerHTML = '';
    if (this.step === 1) this.buildFixTools();
    if (this.step === 3) this.buildGimmickTools();
    if (this.step === 4) this.buildOptions();
  }
  // ① の道の手直しの手伝い（1.0.11。オーナーの要望：カーブの事故を何度描き直しても直せず、つまずく人が多い）
  // ・前回カーブで事故が起きたときだけ、その所をゆるくするボタンを目立たせて出す
  // ・コース全体のカーブを安全にするボタンはいつも出すが、試行錯誤を減らさないよう、小さな文字だけのボタンにする
  buildFixTools() {
    const d = this.design;
    // マップ（テーマ。いつもの遊園地・ハロウィン…）。走りで変わるのは、水に落ちる所だけ
    const mr = document.createElement('div');
    mr.className = 'map-row';
    mr.innerHTML = '<span class="lab">🗺 マップ</span>';
    MAPS.forEach((m, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip' + ((d.map || 0) === i ? ' on' : '');
      b.innerHTML = `<span class="ic">${m.icon}</span>${m.short}`;
      b.title = m.name;
      b.addEventListener('click', () => {
        if ((d.map || 0) === i) return;
        this.record();
        d.map = i;
        sound.sfx('tap');
        this.buildTools();
        this.draw();
        this.onChange?.();
        this.toast(`マップ：${m.name}`, '', 'ok', 1500);
      });
      mr.appendChild(b);
    });
    this.tools.appendChild(mr);
    // 線を描く前から出しておき（押せない）、描いたら押せるようにする（1.0.11 では、新しく描いた直後は出ず、「なおす」などで開き直したときだけ出ていた）
    const btn = (cls, html, fn) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = cls;
      b.innerHTML = html;
      b.addEventListener('click', fn);
      this.tools.appendChild(b);
      return b;
    };
    // 同じカーブで折れた・飛ばされたは 1 か所に数える
    const spots = [];
    for (const e of this.incidents || []) if (e.curve && !spots.some((q) => Math.hypot(q.x - e.x, q.z - e.z) < 15)) spots.push(e);
    const n = spots.length;
    if (n && heightsDrawn(d)) btn('chip fix-main', `🔧 事故が起きたカーブをゆるくする${n > 1 ? `（${n} か所）` : ''}`, () => this.fixCurves('accident'));
    this.fixSub = btn('fix-sub', 'カーブを安全な形に整える', () => this.fixCurves('shape'));
    this.fixSub.disabled = !d.pts || d.pts.length < 2;
  }
  // kind：'accident'（事故が起きたカーブをゆるくする）・'shape'（カーブを安全な形に整える）。
  // どちらも描いた線の形を変えるだけで、しかけは足さない。終わったら短い一言だけ出す（説明が長いと煩わしい。オーナーの指摘。1.0.14）
  fixCurves(kind) {
    if (this.busy || !this.design.pts || this.design.pts.length < 2) return;
    sound.sfx('tap');
    const d = this.design;
    const withH = heightsDrawn(d);
    this.runBusy(kind === 'accident' ? 'カーブを直し中…' : 'カーブを整え中…', () => {
      const res = kind === 'accident' ? fixCurves(d, buildTrack) : smoothCurves(d, buildTrack, withH);
      if (res.fixed) {
        this.record();
        d.pts = res.design.pts;
        d.hs = res.design.hs;
        d.gm = res.design.gm;
        // 直した所の事故の印は消す
        if (this.incidents) this.setIncidents(this.incidents.filter((e) => !res.spots.some((p) => Math.hypot(p.x - e.x, p.z - e.z) < 15)), this.incLabel);
        this.refresh(true);
        this.buildTools();
        this.onChange?.();
      }
      if (kind === 'accident') this.toast(res.fixed ? '事故が起きたカーブをゆるくしました' : 'このカーブは、形では直せませんでした', '', res.fixed ? 'ok' : 'warn', 2500);
      else this.toast(res.fixed ? 'カーブを整えました' : '整えるカーブはありませんでした', '', 'ok', 2000);
    });
  }
  buildGimmickTools() {
    for (const k of GIMMICK_KEYS) {
      const g = GIMMICKS[k];
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip tool' + (this.tool === k ? ' on' : '');
      b.innerHTML = `<i style="background:${g.color}"></i>${g.name}`;
      b.addEventListener('click', () => {
        this.tool = k;
        sound.sfx('tap');
        this.buildTools();
        this.updateLegend();
        this.draw();
      });
      this.tools.appendChild(b);
    }
  }
  // ④ 乗り物の設定（項目ごとに大きなカードにして、ひと目で全部見えるようにする）
  buildOptions() {
    const d = this.design;
    const row = (label, items, cur, set, note) => {
      const r = document.createElement('div');
      r.className = 'opt';
      r.innerHTML = `<span class="lab">${label}</span>`;
      items.forEach((it, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'chip' + (cur === i ? ' on' : '');
        b.innerHTML = it;
        b.addEventListener('click', () => {
          if (cur === i) return;
          this.record();
          set(i);
          sound.sfx('tap');
          this.buildTools();
          this.refresh(true);
        });
        r.appendChild(b);
      });
      if (note) {
        const n = document.createElement('small');
        n.className = 'note';
        n.textContent = note;
        r.appendChild(n);
      }
      this.opts.appendChild(r);
    };
    row('🛤 線路の強さ', MATS.map((m) => m.name), d.mat, (i) => (d.mat = i), ['弱い（4.6G まで）。壊れると全体が崩れやすい', 'ふつう（6.5G まで）', 'とても強い（10G まで）'][d.mat]);
    row('🦺 安全バー', BARS.map((b) => b.name), d.bar, (i) => (d.bar = i), ['浮き上がると飛ばされやすい', 'たいていは大丈夫', 'まず飛ばされない'][d.bar]);
    row('🚃 車両の数', Array.from({ length: MAX_CARS }, (_, i) => `${i + 1}両`), d.cars - 1, (i) => (d.cars = i + 1), `お客さん ${d.cars * 2}人`);
    row('🚀 スタート', STARTS.map((s) => s.name), d.start, (i) => {
      d.start = i;
      this.refitStroke();
    }, d.start ? '駅を出てすぐ発射（巻き上げなし）' : '最初の坂をチェーンでゆっくり登る');
    // 装飾の入口は小さく 1 つだけ（主な設定ではないので）
    const lb = document.createElement('button');
    lb.type = 'button';
    lb.className = 'look-btn';
    lb.addEventListener('click', () => this.openLook());
    this.opts.appendChild(lb);
    this.lookBtn = lb;
    this.updateLookBtn();
  }

  // ---------------- 見た目（装飾） ----------------
  updateLookBtn() {
    if (!this.lookBtn) return;
    const l = cleanLook(this.design.look);
    const picked = [];
    if (l.rail) picked.push(`線路 ${RAIL_LOOKS[l.rail].name}`);
    if (l.car) picked.push(`車両 ${CAR_LOOKS[l.car].name}`);
    if (l.rider) picked.push(RIDER_LOOKS[l.rider].icon + RIDER_LOOKS[l.rider].name);
    if (l.scene && !mapOf(this.design.map).scene) picked.push(SCENE_LOOKS[l.scene].icon + SCENE_LOOKS[l.scene].name);
    this.lookBtn.innerHTML = '🎨 見た目を変える' + (picked.length ? `<b>${picked.join('・')}</b>` : '<small>（走りには影響しません）</small>');
  }
  openLook() {
    sound.sfx('tap');
    this.lookSheet.hidden = false;
    this.renderLook();
  }
  closeLook(tap = false) {
    if (this.lookSheet.hidden) return;
    if (tap) sound.sfx('tap');
    this.lookSheet.hidden = true;
    this.updateLookBtn();
  }
  renderLook() {
    const d = this.design;
    d.look = cleanLook(d.look);
    this.lookRows.innerHTML = '';
    const row = (label, key, list, face) => {
      const r = document.createElement('div');
      r.className = 'opt look-opt';
      r.innerHTML = `<span class="lab">${label}</span>`;
      list.forEach((it, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'chip' + (d.look[key] === i ? ' on' : '');
        b.innerHTML = face(it);
        b.addEventListener('click', () => {
          if (d.look[key] === i) return;
          this.record();
          d.look = { ...d.look, [key]: i };
          sound.sfx('tap');
          this.renderLook();
          this.updateLookBtn();
          this.onChange?.();
        });
        r.appendChild(b);
      });
      this.lookRows.appendChild(r);
    };
    const sw = (it) => `<i class="sw" style="background:${it.sw}"></i>${it.name}`;
    const ic = (it) => `<span class="ic">${it.icon}</span>${it.name}`;
    row('🛤 線路の色', 'rail', RAIL_LOOKS, sw);
    row('🚃 車両の色', 'car', CAR_LOOKS, sw);
    row('🙋 乗る人', 'rider', RIDER_LOOKS, ic);
    // テーマで景色が決まるときは選ばせない
    const M = mapOf(d.map);
    if (M.scene) {
      const n = document.createElement('p');
      n.className = 'look-note';
      n.textContent = `🏞 景色は、マップ（${M.icon}${M.name}）で決まります`;
      this.lookRows.appendChild(n);
    } else row('🏞 景色', 'scene', SCENE_LOOKS, ic);
  }

  // ---------------- 描画 ----------------
  resize() {
    const r = this.cv.parentElement.getBoundingClientRect();
    if (r.width < 10 || r.height < 10) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.W = Math.max(10, r.width);
    this.H = Math.max(10, r.height);
    this.cv.width = Math.round(this.W * dpr);
    this.cv.height = Math.round(this.H * dpr);
    this.cv.style.width = `${this.W}px`;
    this.cv.style.height = `${this.H}px`;
    this.cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // 図の向き（縦長なら 90 度まわす）が決まってから、説明（駅の右／上）を書き直す
    if (this.design && this.step === 1 && !this.drawing) this.updateInfo();
    this.draw();
  }

  // 上から見た図の座標
  mapXf() {
    const pad = 14;
    const v = this.mapView || { cx: 0, cz: 0, zoom: 1 };
    const baseW = 140 / v.zoom;
    const baseH = 96 / v.zoom;
    // 縦長の画面では 90 度回す。表示範囲は敷地全体ではなく、ズーム倍率で決める。
    const rot = this.H > this.W * 1.15;
    if (rot) {
      const k = Math.min((this.W - pad * 2) / baseH, (this.H - pad * 2) / baseW);
      const ox = this.W / 2 - v.cz * k;
      const oy = this.H / 2 + v.cx * k;
      return { k, rot, toS: (x, z) => [ox + z * k, oy - x * k], toW: (sx, sy) => [-(sy - oy) / k, (sx - ox) / k] };
    }
    const k = Math.min((this.W - pad * 2) / baseW, (this.H - pad * 2) / baseH);
    const ox = this.W / 2 - v.cx * k;
    const oy = this.H / 2 - v.cz * k;
    return { k, rot, toS: (x, z) => [ox + x * k, oy + z * k], toW: (sx, sy) => [(sx - ox) / k, (sy - oy) / k] };
  }
  fitMapView() {
    const pts = this.design && Array.isArray(this.design.pts) ? this.design.pts : [];
    if (pts.length < 2) {
      this.mapView = { cx: 0, cz: 0, zoom: 1 };
    } else {
      const xs = pts.map(p => p[0]);
      const zs = pts.map(p => p[1]);
      const minX = Math.min(...xs), maxX = Math.max(...xs);
      const minZ = Math.min(...zs), maxZ = Math.max(...zs);
      const w = Math.max(140, maxX - minX + 80);
      const h = Math.max(96, maxZ - minZ + 60);
      this.mapView = { cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2, zoom: clamp(Math.min(140 / w, 96 / h), 0.06, 8) };
    }
    this.draw();
    const label = this.cvWrap && this.cvWrap.querySelector('[data-map-label]');
    if (label) label.textContent = `${Math.round(this.mapView.zoom * 100)}%`;
  }
  // 2 つの角から、画面の上の長方形（まわしたときも左上と大きさにする）
  rectS(toS, x0, z0, x1, z1) {
    const [ax, ay] = toS(x0, z0);
    const [bx, by] = toS(x1, z1);
    return [Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay)];
  }
  // 横から見た図の座標（横は道の長さ、縦は高さ）
  sideXf() {
    const padL = 34;
    const padR = 12;
    const padT = this.step >= 3 ? 30 : 16;
    const padB = 26;
    const w = this.W - padL - padR;
    const h = this.H - padT - padB;
    const Hmax = H_MAX;
    return {
      x0: padL, y0: padT, w, h,
      ux: (u) => padL + u * w,
      hy: (hh) => padT + h - (hh / Hmax) * h,
      toU: (sx) => clamp((sx - padL) / w, 0, 1),
      toH: (sy) => clamp(((padT + h - sy) / h) * Hmax, H_MIN, H_MAX),
    };
  }

  draw() {
    const c = this.cx;
    const mapTools = this.cvWrap && this.cvWrap.querySelector('.ed-exp-viewtools');
    if (mapTools) mapTools.hidden = this.step !== 1;
    if (!c || !this.W || this.W < 80 || this.H < 80) return;
    c.fillStyle = PAPER;
    c.fillRect(0, 0, this.W, this.H);
    if (this.step === 1) this.drawMap();
    else this.drawSide();
  }

  drawMap() {
    const c = this.cx;
    const { k, toS, rot } = this.mapXf();
    // 方眼（10 m）
    c.strokeStyle = GRID;
    c.lineWidth = 1;
    for (let x = FIELD.x0; x <= FIELD.x1; x += 10) {
      const [sx, sy0] = toS(x, FIELD.z0);
      const [, sy1] = toS(x, FIELD.z1);
      c.beginPath();
      c.moveTo(sx, sy0);
      c.lineTo(sx, sy1);
      c.stroke();
    }
    for (let z = FIELD.z0; z <= FIELD.z1; z += 10) {
      const [sx0, sy] = toS(FIELD.x0, z);
      const [sx1] = toS(FIELD.x1, z);
      c.beginPath();
      c.moveTo(sx0, sy);
      c.lineTo(sx1, sy);
      c.stroke();
    }
    // 敷地の枠（生け垣）
    const [ax, ay, aw, ah] = this.rectS(toS, FIELD.x0, FIELD.z0, FIELD.x1, FIELD.z1);
    c.strokeStyle = '#7fb069';
    c.lineWidth = 3;
    c.setLineDash([6, 4]);
    c.strokeRect(ax, ay, aw, ah);
    c.setLineDash([]);
    this.drawMapLand(toS, k);
    // 駅
    const [s0x, s0y, sw, sh] = this.rectS(toS, STATION.x0, STATION.z - 3, STATION.x1, STATION.z + 3);
    c.fillStyle = '#ffd9df';
    c.fillRect(s0x, s0y, sw, sh);
    c.strokeStyle = PEN;
    c.lineWidth = 2;
    c.strokeRect(s0x, s0y, sw, sh);
    c.fillStyle = PEN;
    c.font = `800 ${Math.max(11, 3.2 * k)}px ${FONT}`;
    c.fillText('駅', s0x + sw / 2, s0y + sh / 2);
    // スタートとゴール：駅の出口のすぐ右（ここから描く）と、駅の入口のすぐ左（ここへ戻る）に丸い印と、進む向きの矢印
    // （0.1.35 までは「ここから▶」「▶ここに戻る」の文字だけで、どこにつなげばよいかが分かりにくかった。オーナーの指摘）
    const S = [STATION.x1 + 6, STATION.z];
    const Gl = [STATION.x0 - 10, STATION.z];
    const mark = ([x, z], color, label, sub, below) => {
      const [sx, sy] = toS(x, z);
      // 線路の続き（駅から印まで）
      const [ax, ay] = toS(x === S[0] ? STATION.x1 : STATION.x0, z);
      c.strokeStyle = color;
      c.lineWidth = Math.max(3, 0.9 * k);
      c.lineCap = 'round';
      c.beginPath();
      c.moveTo(ax, ay);
      c.lineTo(sx, sy);
      c.stroke();
      // 進む向き（右向き）の矢印：線路の続きのまん中に
      const [bx, by] = toS(x + 1, z);
      const len = Math.hypot(bx - sx, by - sy) || 1;
      const ux = (bx - sx) / len;
      const uy = (by - sy) / len;
      const mx = (ax + sx) / 2;
      const my = (ay + sy) / 2;
      const r = Math.max(5, 1.6 * k);
      c.fillStyle = color;
      c.beginPath();
      c.moveTo(mx + ux * r, my + uy * r);
      c.lineTo(mx - ux * r * 0.6 - uy * r * 0.8, my - uy * r * 0.6 + ux * r * 0.8);
      c.lineTo(mx - ux * r * 0.6 + uy * r * 0.8, my - uy * r * 0.6 - ux * r * 0.8);
      c.closePath();
      c.fill();
      // 丸い印
      const R = Math.max(7, 2.2 * k);
      c.beginPath();
      c.arc(sx, sy, R, 0, Math.PI * 2);
      c.fillStyle = '#fff';
      c.fill();
      c.lineWidth = Math.max(3, 0.8 * k);
      c.strokeStyle = color;
      c.stroke();
      c.beginPath();
      c.arc(sx, sy, R * 0.45, 0, Math.PI * 2);
      c.fillStyle = color;
      c.fill();
      // 名前（横長の画面は駅の下、縦長の画面は駅の左＝敷地の内側）
      const [lx, ly] = rot ? toS(x, STATION.z - 10) : toS(x, STATION.z + (below ? 6.5 : 6.5));
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.lineJoin = 'round';
      c.font = `800 ${Math.max(11, 2.8 * k)}px ${FONT}`;
      c.lineWidth = 4;
      c.strokeStyle = 'rgba(251,248,239,0.95)';
      c.strokeText(label, lx, ly);
      c.fillStyle = color;
      c.fillText(label, lx, ly);
      c.font = `700 ${Math.max(9, 2 * k)}px ${FONT}`;
      const ly2 = ly + Math.max(12, 3 * k);
      c.strokeText(sub, lx, ly2);
      c.fillStyle = '#5a6a84';
      c.fillText(sub, lx, ly2);
    };
    mark(S, '#2a9a4a', 'スタート', 'ここから描く', true);
    mark(Gl, '#e84a5f', 'ゴール', 'ここへ戻る', true);
    // 描いた線（えんぴつ）と、なめらかにした線路
    const d = this.design;
    let bandAt = null;
    // 発射のときは、駅を出てからゆるいカーブしかできない所（発射の区間と launchGentle）を、オレンジの太い帯で出す。
    // 線がまだないときは、そこを通る目安の道すじ（launchGuide）を出す
    if (d.start > 0) {
      const v = STARTS[d.start].v;
      const zone = this.preview ? this.preview.path.slice(0, Math.round(leadOf(d) + launchGentle(v))) : [[STATION.x1, STATION.z], ...launchGuide(v)];
      c.strokeStyle = 'rgba(255,150,40,0.35)';
      c.lineWidth = Math.max(10, 3.2 * k);
      c.lineCap = 'round';
      c.lineJoin = 'round';
      this.poly(zone.map(([x, z]) => toS(x, z)));
      bandAt = zone[Math.floor(zone.length * 0.55)];
    }
    if (this.preview) {
      c.strokeStyle = 'rgba(43,58,85,0.25)';
      c.lineWidth = Math.max(3, 1.4 * k);
      c.lineCap = 'round';
      c.lineJoin = 'round';
      if (heightsDrawn(d) && this.preview.vEst) this.drawSpeedBand(toS, k);
      else this.poly(this.preview.path.map(([x, z]) => toS(x, z)));
      // 駅の中も線路でつなぐ
      c.beginPath();
      c.moveTo(...toS(STATION.x0, STATION.z));
      c.lineTo(...toS(STATION.x1, STATION.z));
      c.stroke();
      c.strokeStyle = PEN;
      c.lineWidth = Math.max(1.5, 0.45 * k);
      c.setLineDash([8, 5]);
      this.poly(this.preview.path.map(([x, z]) => toS(x, z)));
      c.setLineDash([]);
    }
    if (d.pts && d.pts.length) {
      c.strokeStyle = INK;
      c.lineWidth = Math.max(2, 0.6 * k);
      c.lineCap = 'round';
      c.lineJoin = 'round';
      this.poly(d.pts.map(([x, z]) => toS(x, z)));
      const [lx, ly] = toS(...d.pts[d.pts.length - 1]);
      c.fillStyle = INK;
      c.beginPath();
      c.arc(lx, ly, Math.max(4, k), 0, Math.PI * 2);
      c.fill();
    }
    // 帯の名前（帯の半分あたりの、敷地の内側）。線と重なっても読めるよう、線のあとに白でふちどって書く
    if (bandAt) {
      const [mx, my] = toS(bandAt[0], bandAt[1]);
      c.font = `800 ${Math.max(10, 2.4 * k)}px ${FONT}`;
      c.textAlign = rot ? 'center' : 'right';
      c.textBaseline = 'middle';
      const tx = rot ? mx : mx - Math.max(10, 3 * k);
      const ty = rot ? my + Math.max(12, 3.5 * k) : my;
      c.strokeStyle = 'rgba(251,248,239,0.95)';
      c.lineWidth = 4;
      c.strokeText('発射のあとはゆるいカーブ', tx, ty);
      c.fillStyle = '#c86400';
      c.fillText('発射のあとはゆるいカーブ', tx, ty);
    }
    // 前回の事故の印
    if (this.incidents && this.incidents.length) {
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.font = `${Math.max(14, 3.5 * k)}px ${FONT}`;
      for (const e of this.incidents) c.fillText(INC_ICON[e.type] || '❗', ...toS(e.x, e.z));
    }
    // 縮尺
    c.fillStyle = '#8090a8';
    c.font = `600 10px ${FONT}`;
    c.textAlign = 'left';
    c.fillText('1マス 10m', ax + 4, ay + 10);
    void rot;
  }

  // ① で、高さを描いたあとは、線路を予想の速さの色の帯で出し、速い所に速さを書く（1.0.15。オーナーの判断：
  // 1.0.11〜1.0.14 は高さの色だったが、カーブの事故は速さで決まるので、速さのほうが分かりやすい）
  // マップの水（池・プール）とテーマの飾り。敷地の外は描かない
  drawMapLand(toS, k) {
    const c = this.cx;
    const d = this.design;
    const M = mapOf(d.map);
    const [ax, ay, aw, ah] = this.rectS(toS, FIELD.x0, FIELD.z0, FIELD.x1, FIELD.z1);
    c.save();
    c.beginPath();
    c.rect(ax, ay, aw, ah);
    c.clip();
    const wc = M.id === 'halloween' ? '#b8dca0' : M.id === 'xmas' ? '#dcecf8' : '#bfe0f6';
    for (const q of M.pools || []) {
      const [qx, qy, qw, qh] = this.rectS(toS, q.x0, q.z0, q.x1, q.z1);
      c.fillStyle = '#9ad8f0';
      c.fillRect(qx, qy, qw, qh);
    }
    c.fillStyle = wc;
    c.strokeStyle = wc;
    for (const p of M.ponds) {
      const [px, py] = toS(p.x, p.z);
      c.beginPath();
      c.arc(px, py, p.r * k, 0, Math.PI * 2);
      c.fill();
    }
    // テーマの飾り（線の通る所の物は置かないので、薄くする）
    const lay = themeLayout(d.map);
    const pts = d.pts || [];
    const cut = (x, z, m) => pts.some((q) => Math.abs(q[0] - x) < m && Math.abs(q[1] - z) < m);
    const dot = (x, z, r, color, faint) => {
      const [tx, ty] = toS(x, z);
      c.globalAlpha = faint ? 0.2 : 1;
      c.fillStyle = color;
      c.beginPath();
      c.arc(tx, ty, Math.max(1.5, r * k), 0, Math.PI * 2);
      c.fill();
    };
    if (lay && lay.yard) {
      const Y = lay.yard;
      const [yx, yy, yw, yh] = this.rectS(toS, Y.x0, Y.z0, Y.x1, Y.z1);
      c.fillStyle = 'rgba(120,110,140,0.12)';
      c.fillRect(yx, yy, yw, yh);
      c.strokeStyle = '#8a8098';
      c.lineWidth = 1.5;
      c.setLineDash([3, 3]);
      c.strokeRect(yx, yy, yw, yh);
      c.setLineDash([]);
    }
    if (lay) {
      for (const q of layoutDots(lay)) dot(q.x, q.z, q.r, q.color, cut(q.x, q.z, q.m));
      c.globalAlpha = 1;
    }
    c.restore();
    // 名前
    c.fillStyle = '#5a8ab0';
    c.font = `700 ${Math.max(10, 3 * k)}px ${FONT}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = M.id === 'halloween' ? '#4a7a3a' : '#5a8ab0';
    for (const p of M.ponds) if (p.r >= 6) c.fillText(M.pondName || '池', ...toS(p.x, p.z));
    for (const q of M.pools || []) c.fillText(M.poolName, ...toS((q.x0 + q.x1) / 2, (q.z0 + q.z1) / 2));
    const lay2 = themeLayout(d.map);
    if (lay2 && lay2.yard) {
      c.fillStyle = '#6a6078';
      c.fillText('墓地', ...toS((lay2.yard.x0 + lay2.yard.x1) / 2, lay2.yard.z1 + 3));
    }
  }
  drawSpeedBand(toS, k) {
    const c = this.cx;
    const { path, tr, vEst } = this.preview;
    const n = path.length;
    // 道（1 m ごと）の点ごとに、線路（0.5 m ごと、宙返りの分だけ長い）のいちばん近い点を、前から順に探す
    const kmh = new Array(n).fill(0);
    let ptr = 0;
    for (let i = 0; i < n; i++) {
      let best = ptr;
      let bd = Infinity;
      for (let j = ptr; j < Math.min(tr.n, ptr + 240); j++) {
        const q = (tr.px[j] - path[i][0]) ** 2 + (tr.pz[j] - path[i][1]) ** 2 + (j - ptr) * 0.002;
        if (q < bd) {
          bd = q;
          best = j;
        }
      }
      ptr = best;
      kmh[i] = (vEst[best] || 0) * 3.6;
    }
    c.lineWidth = Math.max(9, 3 * k);
    c.lineCap = 'round';
    for (let i = 0; i < n - 1; i += 3) {
      const j = Math.min(n - 1, i + 3);
      c.strokeStyle = speedColor((kmh[i] + kmh[j]) / 2);
      c.beginPath();
      c.moveTo(...toS(path[i][0], path[i][1]));
      for (let m = i + 1; m <= j; m++) c.lineTo(...toS(path[m][0], path[m][1]));
      c.stroke();
    }
    // 速い所：前後 40 m でいちばん速く、まわりより 10 km/h 以上速い所（30 km/h 以上）
    const W = 40;
    const peaks = [];
    for (let i = 0; i < n; i++) {
      const v = kmh[i];
      if (v < 30) continue;
      let top = true;
      let low = v;
      for (let m = Math.max(0, i - W); m <= Math.min(n - 1, i + W); m++) {
        if (kmh[m] > v || (kmh[m] === v && m < i)) top = false;
        low = Math.min(low, kmh[m]);
      }
      if (top && v - low >= 10) peaks.push(i);
    }
    c.font = `800 ${Math.max(10, 2.6 * k)}px ${FONT}`;
    c.textAlign = 'center';
    c.textBaseline = 'bottom';
    c.lineJoin = 'round';
    for (const i of peaks.slice(0, 10)) {
      const [sx, sy] = toS(path[i][0], path[i][1]);
      const t = `${Math.round(kmh[i])}km/h`;
      const y = sy - Math.max(5, 1.4 * k);
      c.lineWidth = 4;
      c.strokeStyle = 'rgba(251,248,239,0.95)';
      c.strokeText(t, sx, y);
      c.fillStyle = '#c0392b';
      c.fillText(t, sx, y);
    }
  }
  poly(pts) {
    const c = this.cx;
    if (pts.length < 2) return;
    c.beginPath();
    c.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
    c.stroke();
  }

  drawSide() {
    const c = this.cx;
    const X = this.sideXf();
    const d = this.design;
    const p = this.preview;
    const Lf = p ? p.Lf : 300;
    // 方眼（高さ 10 m ごと・長さ 50 m ごと）
    c.strokeStyle = GRID;
    c.lineWidth = 1;
    c.fillStyle = '#8090a8';
    c.font = `600 10px ${FONT}`;
    c.textAlign = 'right';
    c.textBaseline = 'middle';
    for (let h = 0; h <= H_MAX; h += 10) {
      const y = X.hy(h);
      c.beginPath();
      c.moveTo(X.x0, y);
      c.lineTo(X.x0 + X.w, y);
      c.stroke();
      c.fillText(`${h}m`, X.x0 - 4, y);
    }
    for (let m = 0; m <= Lf; m += 50) {
      const x = X.ux(m / Lf);
      c.beginPath();
      c.moveTo(x, X.y0);
      c.lineTo(x, X.hy(0));
      c.stroke();
    }
    // 地面
    c.fillStyle = '#d6ecc4';
    c.fillRect(X.x0, X.hy(0), X.w, 6);
    // 予想の速さ（細い線と数字）
    const drawn = heightsDrawn(d);
    if (p && p.tr && p.vEst && drawn) {
      const tr = p.tr;
      c.strokeStyle = 'rgba(58,160,255,0.55)';
      c.lineWidth = 1.5;
      c.beginPath();
      let first = true;
      let best = { v: 0, u: 0 };
      for (let i = tr.stEnd; i < tr.n; i += 2) {
        const u = this.uOfIndex(i);
        if (u == null) continue;
        const v = p.vEst[i];
        const y = X.hy((v * 3.6) / 2.5);
        if (first) c.moveTo(X.ux(u), y);
        else c.lineTo(X.ux(u), y);
        first = false;
        if (v > best.v) best = { v, u };
      }
      c.stroke();
      c.fillStyle = '#3aa0ff';
      c.textAlign = 'center';
      c.font = `700 10px ${FONT}`;
      c.fillText(`${Math.round(best.v * 3.6)}km/h`, X.ux(best.u), X.hy((best.v * 3.6) / 2.5) - 8);
      // 止まりそうな所
      if (p.sum && (p.sum.result === 'stuck' || p.sum.result === 'rollback')) {
        let lastI = tr.stEnd;
        for (let i = tr.stEnd; i < tr.n; i++) if (p.vEst[i] > 0) lastI = i;
        const u = this.uOfIndex(lastI);
        if (u != null) {
          c.fillStyle = '#e07a00';
          c.font = `800 12px ${FONT}`;
          c.fillText('ここで止まりそう', clamp(X.ux(u), X.x0 + 50, X.x0 + X.w - 50), X.y0 + 10);
        }
      }
      // ぶつかる所
      c.fillStyle = '#d02020';
      c.font = `800 14px ${FONT}`;
      for (const i of tr.clashes) {
        const u = this.uOfIndex(i);
        if (u == null) continue;
        c.fillText('✕', X.ux(u), X.hy(tr.py[i]));
      }
    }
    // 実際の線路の高さ（なめらかにした後）
    if (p && p.tr) {
      const tr = p.tr;
      c.strokeStyle = 'rgba(232,74,95,0.9)';
      c.lineWidth = 2;
      c.setLineDash([6, 4]);
      c.beginPath();
      let first = true;
      for (let i = tr.stEnd; i < tr.n; i += 2) {
        const u = this.uOfIndex(i);
        if (u == null || (tr.fl[i] & F.LOOP)) {
          first = true;
          continue;
        }
        if (tr.fl[i] & F.GAP) {
          first = true;
          continue;
        }
        const y = X.hy(tr.py[i]);
        if (first) c.moveTo(X.ux(u), y);
        else c.lineTo(X.ux(u), y);
        first = false;
      }
      c.stroke();
      c.setLineDash([]);
    }
    // 手で描いた高さ（③ では描き直せないので薄くする）
    if (d.hs) {
      c.strokeStyle = this.step >= 3 ? 'rgba(43,58,85,0.3)' : INK;
      c.lineWidth = 3;
      c.lineCap = 'round';
      c.lineJoin = 'round';
      this.poly(d.hs.map((h, k) => [X.ux(k / (H_SAMPLES - 1)), X.hy(h)]));
    }
    // 駅（両端）
    c.fillStyle = PEN;
    c.font = `800 11px ${FONT}`;
    c.textAlign = 'left';
    c.fillText('駅を出る', X.x0 + 2, X.hy(0) + 14);
    c.textAlign = 'right';
    c.fillText('駅に戻る', X.x0 + X.w - 2, X.hy(0) + 14);
    // 巻き上げの区間
    if (p && p.tr && p.tr.liftEnd > 0 && drawn) {
      const u = this.uOfIndex(p.tr.liftEnd);
      if (u != null) {
        c.fillStyle = 'rgba(60,60,60,0.12)';
        c.fillRect(X.x0, X.y0, X.ux(u) - X.x0, X.h);
        c.fillStyle = '#555';
        c.textAlign = 'center';
        c.font = `700 10px ${FONT}`;
        c.fillText('巻き上げ', (X.x0 + X.ux(u)) / 2, X.y0 + 8);
      }
    }
    if (this.step >= 3) this.drawGimmicks(X);
    // まだ描いていないとき：描く場所の案内
    if (!drawn) {
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillStyle = '#e84a5f';
      c.font = `800 ${Math.min(26, X.w / 11)}px ${FONT}`;
      c.fillText('ここに指で 山を描こう！', X.x0 + X.w / 2, X.hy(34));
      c.fillStyle = '#5a6a84';
      c.font = `700 ${Math.min(14, X.w / 22)}px ${FONT}`;
      c.fillText('高い所から一気に下ると、速くなる', X.x0 + X.w / 2, X.hy(34) + 30);
    }
    // 前回の事故の印
    if (this.incU && this.incU.length) {
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.font = `16px ${FONT}`;
      // 図の端（駅のすぐ前など）でも切れないように、内側に寄せる
      for (const e of this.incU) c.fillText(INC_ICON[e.type] || '❗', clamp(X.ux(e.u), 16, this.W - 16), X.hy(e.h) - 12);

    }
  }

  // 線路の点の番号 → 横の図の u（駅・宙返りの中は道の位置で）
  uOfIndex(i) {
    const p = this.preview;
    if (!p || !p.tr) return null;
    if (!p.idxU) {
      // 道の長さに対する位置を、点ごとに求めておく（宙返りの間は前後の値でつなぐ）
      const tr = p.tr;
      const u = new Float32Array(tr.n);
      let acc = 0;
      for (let k = tr.stEnd; k < tr.n; k++) {
        const j = k - 1;
        if (!(tr.fl[k] & F.LOOP)) acc += Math.hypot(tr.px[k] - tr.px[j], tr.pz[k] - tr.pz[j]);
        u[k] = acc;
      }
      for (let k = tr.stEnd; k < tr.n; k++) u[k] = acc > 0 ? u[k] / acc : 0;
      p.idxU = u;
    }
    if (i < p.tr.stEnd) return null;
    return p.idxU[i];
  }

  drawGimmicks(X) {
    const c = this.cx;
    const d = this.design;
    const p = this.preview;
    // 宙返りを置ける所・ジャンプが着地しやすい所（どちらもまっすぐな所）を、地面の上に緑の帯で出す。ジャンプはほかの所にも置ける
    if (p && (this.tool === 'loop' || this.tool === 'jump')) {
      const key = `${this.tool}:${p.Lf}`;
      if (this.okKey !== key) {
        this.okKey = key;
        const len = this.tool === 'loop' ? loopShape().adv : GIMMICKS.jump.len;
        this.okBand = [];
        for (let m = 0; m < p.Lf; m += 2) {
          const t = this.tool === 'loop' ? turnOf(p.path, m - 10, m + len + 10) : turnOf(p.path, m - 6, m + len + 14);
          this.okBand.push(t <= (this.tool === 'loop' ? 1.1 : 0.5) && m > 40 && m + len < p.Lf - 40);
        }
      }
      c.fillStyle = 'rgba(80,190,90,0.45)';
      const y = X.hy(0) - 7;
      this.okBand.forEach((ok, k) => {
        if (ok) c.fillRect(X.ux((k * 2) / p.Lf), y, Math.max(1, X.ux(2 / p.Lf) - X.ux(0)) + 0.5, 6);
      });

    }
    const placed = p ? placeGimmicks(d, p.Lf, p.path) : [];
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    const whys = new Set();
    for (const g of d.gm) {
      const q = placed.find((q) => q.u === g.u && q.t === g.t);
      const ok = q && q.ok;
      if (q && !ok) whys.add(q.why);
      const G = GIMMICKS[g.t];
      const x = X.ux(g.u);
      c.globalAlpha = ok ? 1 : 0.4;
      c.fillStyle = G.color;
      c.fillRect(x - 1.5, X.y0 - 6, 3, X.h + 6);
      c.beginPath();
      c.arc(x, X.y0 - 14, 11, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#fff';
      c.font = `800 11px ${FONT}`;
      c.fillText(G.name[0], x, X.y0 - 14);
      if (!ok) {
        c.fillStyle = '#d02020';
        c.fillText('×', x + 12, X.y0 - 4);
      }
      c.globalAlpha = 1;
    }
    if (whys.size) {
      const W = { near: 'ほかのしかけに近すぎ', edge: '駅に近すぎ', curve: 'カーブの上（宙返りはまっすぐな所に）' };
      c.fillStyle = '#d02020';
      c.font = `700 11px ${FONT}`;
      c.textAlign = 'left';
      c.fillText(`× 置けない：${[...whys].map((w) => W[w]).join('・')}`, X.x0 + 4, X.hy(0) - 8);
    }
  }

  // ---------------- 入力 ----------------
  pos(e) {
    const r = this.cv.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }
  // 描くのは最初に触れた指だけ（2 本指でなぞると、2 本の指の位置が交互に線に入って、ジグザグになっていた。0.1.18）
  down(e) {
    this.hideToast();
    e.preventDefault();
    if (this.pid != null) return;
    this.pid = e.pointerId;
    this.cv.setPointerCapture?.(e.pointerId);
    const [sx, sy] = this.pos(e);
    const d = this.design;
    if (this.step === 1 && (e.shiftKey || e.button === 1)) {
      const X = this.mapXf();
      this.panning = { x: sx, y: sy, cx: this.mapView.cx, cz: this.mapView.cz, k: X.k, rot: X.rot };
      this.drawing = true;
      return;
    }
    this.record();
    if (this.step === 1) {
      const { toW, k } = this.mapXf();
      const w = toW(sx, sy);
      w[0] = clamp(w[0], FIELD.x0, FIELD.x1);
      w[1] = clamp(w[1], FIELD.z0, FIELD.z1);
      const end = d.pts && d.pts[d.pts.length - 1];
      const nd = d.pts && d.pts.length > 1 ? nearestPt(d.pts, w)[1] : Infinity;
      this.redraw = null;
      if (end && Math.hypot(end[0] - w[0], end[1] - w[1]) < Math.max(6, 18 / k)) {
        // 線の先から：続き
      } else if (nd < Math.max(5, 16 / k)) {
        // 線の途中から：つまんで動かす（その辺りだけ形が変わる。1.0.1）
        const base = resample(d.pts);
        const sArr = [0];
        for (let i = 1; i < base.length; i++) sArr.push(sArr[i - 1] + Math.hypot(base[i][0] - base[i - 1][0], base[i][1] - base[i - 1][1]));
        const [bi] = nearestPt(base, w);
        this.redraw = { orig: d.pts, base, s: sArr, s0: sArr[bi], L: sArr[sArr.length - 1], w0: w, moved: false };
      } else d.pts = [w];
      this.drawing = true;
      this.maxed = false;
      // つまんで動かすときは、もとの線路（薄い線）を残しておき、どこが変わるか分かるようにする
      if (!this.redraw) this.preview = null;
      this.draw();
    } else if (this.step === 2) {
      this.drawing = true;
      this.last = null;
      this.paintHeight(sx, sy);
    } else {
      const X = this.sideXf();
      const u = X.toU(sx);
      // 近くのしかけをタップ → 外す
      const near = d.gm.findIndex((g) => Math.abs(X.ux(g.u) - sx) < 16);
      if (near < 0 && d.gm.length >= MAX_GIMMICKS) this.undoStack.pop(); // 何も変わらない
      if (near >= 0) {
        d.gm.splice(near, 1);
        sound.sfx('erase');
      } else if (d.gm.length < MAX_GIMMICKS) {
        d.gm.push({ t: this.tool, u });
        sound.sfx('pop');
      }
      this.refresh(true);
    }
  }
  move(e) {
    if (!this.drawing || e.pointerId !== this.pid) return;
    e.preventDefault();
    const [sx, sy] = this.pos(e);
    const d = this.design;
    if (this.panning) {
      const p = this.panning;
      const dx = sx - p.x, dy = sy - p.y;
      this.mapView.cx = p.cx + (p.rot ? dy / p.k : -dx / p.k);
      this.mapView.cz = p.cz + (p.rot ? -dx / p.k : -dy / p.k);
      this.draw();
      return;
    }
    if (this.step === 1) {
      const { toW } = this.mapXf();
      const w = toW(sx, sy);
      w[0] = clamp(w[0], FIELD.x0, FIELD.x1);
      w[1] = clamp(w[1], FIELD.z0, FIELD.z1);
      if (this.redraw) {
        const r = this.redraw;
        const dx = w[0] - r.w0[0];
        const dz = w[1] - r.w0[1];
        if (Math.hypot(dx, dz) >= 0.5) r.moved = true;
        const pts = bendPts(r, dx, dz);
        // 全長の上限を超える動かし方はしない（その手前の形のまま）
        if (polyLen(pts) > MAX_LEN) return;
        d.pts = pts;
        if (Math.random() < 0.15) sound.sfx('draw');
        this.draw();
        return;
      }
      const last = d.pts[d.pts.length - 1];
      if (Math.hypot(w[0] - last[0], w[1] - last[1]) >= 0.8) {
        d.pts.push(w);
        if (d.pts.length % 6 === 0) sound.sfx('draw');
        // 全長の上限（線路が長すぎると重くなり、シェアの URL も長くなる）
        if (d.pts.length > 8192 || polyLen(d.pts) > MAX_LEN) {
          d.pts.pop();
          if (!this.maxed) {
            this.maxed = true;
            this.hint.textContent = `全長の上限（約${MAX_LEN}m）です。これ以上は描けません`;
            sound.sfx('erase');
          }
        }
        this.draw();
      }
    } else if (this.step === 2) this.paintHeight(sx, sy);
  }
  up(e) {
    if (e.pointerId !== this.pid) return;
    this.pid = null;
    if (!this.drawing) return;
    this.drawing = false;
    if (this.panning) { this.panning = null; return; }
    // 線の途中をタップしただけ（ほとんど動かしていない）：何も変えない
    const r = this.redraw;
    if (r && !r.moved) {
      this.design.pts = r.orig;
      this.undoStack.pop();
    }
    this.redraw = null;
    this.refresh(true);
    this.onChange?.();
  }
  paintHeight(sx, sy) {
    const X = this.sideXf();
    const d = this.design;
    const u = X.toU(sx);
    const h = X.toH(sy);
    const k = Math.round(u * (H_SAMPLES - 1));
    const prev = this.last;
    if (prev) {
      const a = Math.min(prev[0], k);
      const b = Math.max(prev[0], k);
      for (let i = a; i <= b; i++) {
        const t = b === a ? 1 : (i - prev[0]) / (k - prev[0]);
        d.hs[i] = Math.round((prev[1] + (h - prev[1]) * t) * 2) / 2;
      }
    } else d.hs[k] = Math.round(h * 2) / 2;
    if (Math.random() < 0.3) sound.sfx('draw');
    this.last = [k, h];
    this.preview && (this.preview.tr = this.preview.tr); // 描画だけ
    this.draw();
  }

  // ---------------- ボタン ----------------
  // ---------------- おまかせ ----------------
  // 結果は図の上にカードで大きく出す（0.1.34 までは図の下の小さな一行だけで、押しても何も変わらないように見えた）。
  // 探すのに時間がかかる ②③ は、先に「考え中」を出して図を暗くしてから探す
  auto() {
    if (this.busy) return;
    if (this.step === 1) return this.autoStroke();
    this.runBusy(this.step === 2 ? '高さを考え中…' : 'しかけの置き方を考え中…', () => (this.step === 2 ? this.autoHeights() : this.autoGimmicks()));
  }
  runBusy(text, fn) {
    const step = this.step;
    const d = this.design;
    this.busy = true;
    this.btnAuto.disabled = true;
    this.cvWrap.classList.add('ed-busy');
    this.toast(text, '', 'busy', 0);
    // 「考え中」を画面に出してから計算する（すぐ計算すると、出る前に固まる）。描かれるのを 2 フレーム待つ
    const later = (f) => requestAnimationFrame(() => requestAnimationFrame(f));
    later(() => {
      try {
        if (this.step === step && this.design === d) fn();
      } finally {
        this.busy = false;
        this.btnAuto.disabled = false;
        this.cvWrap.classList.remove('ed-busy');
        if (this.toastEl.classList.contains('busy')) this.hideToast();
      }
    });
  }
  autoStroke() {
    const d = this.design;
    this.record();
    sound.sfx('pop');
    // 発射のときは、発射のあとのゆるいカーブに合わせて描き始める。④ でスタートを変えたら描き直せるよう、種と型を覚えておく
    const seed = (Date.now() & 0xffff) + this.seed++;
    const kind = this.nextKind('stroke', STROKE_KINDS);
    d.pts = randomStroke(seed, kind, STARTS[d.start || 0].v);
    this.strokeSrc = { seed, kind, sig: JSON.stringify(d.pts) };
    d.gm = d.gm || [];
    this.refresh(true);
    this.onChange?.();
    this.toast(`おまかせ：${kind === 3 ? mapOf(d.map).loopName : STROKE_NAMES[kind]}`, d.start > 0 ? '発射のあとのゆるいカーブに合わせて描きました' : 'もう一度押すと、ちがう形になります');
  }
  autoHeights() {
    const d = this.design;
    // 発射のときは、ブレーキ・ブースターも足すことがある。前のおまかせで足したものは外してから作り直す
    const mine = this.autoGm || [];
    const base = (d.gm || []).filter((g) => !mine.some((a) => a.t === g.t && Math.abs(a.u - g.u) < 1 / 4000));
    // いちばん高い所は、低め〜とても高い（PEAK_TIERS）を押すたびに順に変える
    const [p0, p1] = PEAK_TIERS[this.nextKind('peak', PEAK_TIERS.length)];
    // 発射のときは、ずっと高い所（6）・だんだん高くなる（8）を使わない（高さが発射の速さで決まるので、ほとんど形のとおりにならない）
    let kind = this.nextKind('height', HEIGHT_KINDS);
    for (let n = 0; d.start > 0 && (kind === 6 || kind === 8) && n < 4; n++) kind = this.nextKind('height', HEIGHT_KINDS);
    const res = safeAuto({ ...d, gm: base }, (Date.now() & 0xffff) + this.seed++, p0 + Math.random() * (p1 - p0), autoHeights, buildTrack, kind);
    this.record();
    sound.sfx('pop');
    d.hs = res.hs;
    d.gm = res.gm;
    this.autoGm = res.gm.slice(base.length);
    this.refresh(true);
    this.onChange?.();
    if (!res.ok) {
      sound.sfx('erase');
      const why = d.start > 0
        ? `${MATS[d.mat].name}で ${STARTS[d.start].name} だと、駅を出てすぐのカーブなどで事故が起きます。④ で線路を強くするか、発射を遅くしてみよう`
        : 'もう一度押すか、④ で線路を強くしてみよう';
      this.toast('事故なく走れる高さが見つかりませんでした', why, 'warn', 7000);
      return;
    }
    const lines = [`いちばん高い所 ${Math.round(Math.max(...d.hs))} m`];
    if (res.fallback) lines.push('この道は加速した先に急なカーブが続くので、いつもの形にしました');
    const nb = this.autoGm.filter((g) => g.t === 'brake').length;
    const nu = this.autoGm.length - nb;
    if (this.autoGm.length) {
      // ブースターは型 5〜8 の高さに合わせたもの（勢いを足して後の山を登る）、ブレーキは勢いを落とすもの
      const why = nu && !nb ? '後の山を登れるように' : d.start > 0 ? '発射の勢いに合わせて' : '高さに合わせて';
      lines.push(`${why}、${[nb ? `ブレーキ ${nb} 個` : '', nu ? `ブースター ${nu} 個` : ''].filter(Boolean).join('と')}を置きました（③ で動かす・外せます）`);
    }
    this.toast(`おまかせ：${HEIGHT_NAMES[res.fallback ? 0 : kind]}`, lines.join('<br>'), 'ok', this.autoGm.length || res.fallback ? 5000 : 3200);
  }
  // ③ しかけのおまかせ：型（宙返り・ジャンプ・ブースターの組み合わせ）を順に選び、走らせて事故が起きない置き方にする
  autoGimmicks() {
    const d = this.design;
    // ② のおまかせが高さに合わせて置いたブースター・ブレーキは残す（それがないと登れない・止まれない形がある）
    const same = (a, g) => a.t === g.t && Math.abs(a.u - g.u) < 1 / 4000;
    const keep = (d.gm || []).filter((g) => (this.autoGm || []).some((a) => same(a, g)));
    const res = autoGimmicks(d, buildTrack, this.nextKind('gimmick', GIMMICK_THEMES.length), Math.random, 5, 1200, keep);
    if (!res.ok) {
      // 置けなかったときも一言だけ（1.0.15 までは、理由と直し方を何行も書き、ブースターを入れたときの事故の所を図に印で出していた。
      // オーナーの指摘：親切すぎる・説明しすぎ。0.1.36 までは理由が書かれず、③ のおまかせが効かないように見えたので、一言は残す）
      sound.sfx('erase');
      const kmh = Math.round(res.maxV * 3.6);
      const why = res.baseFail === 'stuck' ? '途中で止まる可能性あり' : res.baseFail ? '事故の可能性あり' : kmh < 58 ? '宙返り・ジャンプには速さが足りません' : '';
      this.toast('しかけを置けませんでした', why ? `<span class="risk">⚠ ${why}</span>` : '', 'warn', 4000);
      return;
    }
    this.record();
    sound.sfx('pop');
    d.gm = res.gm;
    this.autoGm = keep;
    this.refresh(true);
    this.onChange?.();
    const cnt = {};
    for (const g of res.gm) cnt[g.t] = (cnt[g.t] || 0) + 1;
    const placed = `${GIMMICK_KEYS.filter((k) => cnt[k]).map((k) => `${GIMMICKS[k].name} ${cnt[k]}`).join('・')} を置きました`;
    // 事故なく走れる置き方が見つからず、いちばんましなものを置いた・置く前から走りきれないコース：小さく一言だけ添える
    // （1.0.15 までは、事故の所を図に印で出し、何が起きるかと直し方を黄色のカードで長く説明していた。オーナーの指摘：親切すぎる・説明しすぎ）
    const risk = res.risk || res.baseFail;
    if (risk) this.toast(placed, `<span class="risk">⚠ ${risk === 'stuck' || risk === 'rollback' ? '途中で止まる可能性あり' : '事故の可能性あり'}</span>`, 'ok', 4000);
    else this.toast(placed, 'もう一度押すと、ちがう置き方になります');
  }
  // 図の上のカード。kind：ok（緑）・warn（黄）・busy（青、くるくる）。ms = 0 なら自分では消えない（タップで消える）
  toast(title, sub = '', kind = 'ok', ms = 3200) {
    const el = this.toastEl;
    clearTimeout(this.toastTimer);
    el.innerHTML = `<b>${kind === 'busy' ? '<i class="spin"></i>' : kind === 'warn' ? '⚠ ' : ''}${title}</b>${sub ? `<small>${sub}</small>` : ''}`;
    el.className = `ed-toast ${kind}`;
    void el.offsetWidth; // 続けて出すときも、ふわっと出し直す
    el.classList.add('show');
    if (ms) this.toastTimer = setTimeout(() => this.hideToast(), ms);
  }
  hideToast() {
    clearTimeout(this.toastTimer);
    this.toastEl.classList.remove('show');
  }

  // ④ でスタートを変えたとき、道が ① のおまかせのまま（手で描き直していない）なら、同じ形を新しいスタートに合わせて描き直す
  refitStroke() {
    const src = this.strokeSrc;
    const d = this.design;
    if (!src || JSON.stringify(d.pts) !== src.sig) return;
    d.pts = randomStroke(src.seed, src.kind, STARTS[d.start || 0].v);
    src.sig = JSON.stringify(d.pts);
  }

  // おまかせの型：全部の型をひと通り出し切るまで、同じ型を出さない（続けて押しても毎回ちがう形になる）
  nextKind(key, n) {
    this.bags = this.bags || {};
    let bag = this.bags[key];
    if (!bag || !bag.length) {
      const last = bag && bag.last;
      bag = Array.from({ length: n }, (_, i) => i);
      for (let i = n - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [bag[i], bag[j]] = [bag[j], bag[i]];
      }
      // 次に出る（配列の最後の）型が、前の袋の最後と同じなら入れかえる
      if (n > 1 && bag[n - 1] === last) [bag[0], bag[n - 1]] = [bag[n - 1], bag[0]];
      this.bags[key] = bag;
    }
    const k = bag.pop();
    bag.last = k;
    return k;
  }

  clear() {
    const d = this.design;
    if (this.step === 3 && !(d.gm || []).length) return;
    this.record();
    sound.sfx('erase');
    if (this.step === 1) {
      d.pts = [];
    } else if (this.step === 2) {
      d.hs = flatHeights();
    } else if (this.step === 3) {
      d.gm = [];
      this.autoGm = [];
    }
    this.refresh(true);
    this.onChange?.();
  }
  // その段階へ飛べるか（「つぎへ」が押せる条件を、手前の段階の分だけ満たしているか）
  canReach(step) {
    if (step <= this.step) return true;
    const d = this.design;
    const p = this.preview;
    if (step >= 2 && (!p || p.Lf < MIN_LEN)) return false;
    if (step >= 3 && !heightsDrawn(d)) return false;
    if (step >= 4 && !p) return false;
    return true;
  }
  updateSteps() {
    this.steps.forEach((li, k) => {
      li.querySelector('button').disabled = k + 1 !== this.step && !this.canReach(k + 1);
    });
    this.btnRun.disabled = !this.canReach(4);
    // カーブで事故が起きたあとは、① の印に 🔧 を付ける（① で直せることを知らせる）
    const fix = this.step !== 1 && (this.incidents || []).some((e) => e.curve) && heightsDrawn(this.design);
    this.steps[0].classList.toggle('fix', fix);
    this.steps[0].querySelector('button').title = fix ? '① で、事故が起きたカーブをゆるくできます' : '';
  }
  jump(step) {
    if (step === this.step || !this.canReach(step)) return;
    sound.sfx('tap');
    this.go(step);
  }
  next() {
    sound.sfx('tap');
    if (this.step < 4) this.go(this.step + 1);
    else this.onDone(this.design);
  }
  prev() {
    sound.sfx('tap');
    if (this.step > 1) this.go(this.step - 1);
    else this.onBack();
  }
}
