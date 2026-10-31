import { installArchitecturePack } from './coaster_architecture.js';
import { installCityFlight } from './coaster_city_flight.js';
/* Coaster Expansion v7.0
 * Loaded by the game's main.js. Adds tools inside the native editor UI.
 * GLB/glTF importer supports triangle meshes, PBR base color/metal/roughness,
 * transforms and base-color textures. Skins, morph targets and animation are not imported.
 */
export function installCoasterExpansion(api, helpers) {
  'use strict';
  if (!api || !api.editor || !api.THREE) throw new Error('Coaster Expansion: runtime API is incomplete');
  const THREE = api.THREE;
  const editor = api.editor;
  const FIELD = helpers.FIELD;
  const MAX_LEN = helpers.MAX_LEN;
  const randomStroke = helpers.randomStroke;
  const polyLen = helpers.polyLen;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const models = [];
  let selectedModel = -1;
  let presetSeed = 20261030;
  let activeTab = 'course';

  // ゲーム標準の「map-row / opt / chip / note」クラスを使い、編集ツールの流れに直接組み込む。
  const style = document.createElement('style');
  style.id = 'coaster-expansion-style';
  style.textContent = `
    .ce-integrated{width:100%;margin:10px 0 2px;padding:8px 0 2px;border-top:1px solid #d6dfdf;color:#2b3a55;font:inherit}
    .ce-integrated .ce-nav{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:0 0 7px}
    .ce-integrated .ce-nav .lab{margin-right:3px}
    .ce-integrated .ce-panel{display:grid;gap:7px}
    .ce-integrated .ce-row{display:flex;flex-wrap:wrap;align-items:center;gap:6px}
    .ce-integrated .ce-row>label{display:flex;align-items:center;gap:5px;min-width:0;font-size:12px;color:#40516b}
    .ce-integrated .ce-row select,.ce-integrated .ce-row input[type=number]{min-width:0;max-width:100%;height:32px;padding:4px 7px;border:1px solid #b9c8d2;border-radius:7px;background:#fff;color:#2b3a55;font:inherit}
    .ce-integrated .ce-row input[type=number]{width:92px}
    .ce-integrated .ce-row input[type=file]{max-width:100%;font:inherit;font-size:11px}
    .ce-integrated .ce-status{display:block;min-height:18px;padding:5px 8px;border-radius:6px;background:#edf3f5;color:#41566b;white-space:pre-wrap;overflow-wrap:anywhere}
    .ce-integrated .ce-status.bad{background:#fff0ed;color:#a83b2a}
    .ce-integrated .ce-note{display:block;font-size:11px;color:#66798a;line-height:1.45}
    .ce-integrated [hidden]{display:none!important}
    .ed-exp-viewtools{background:rgba(251,248,239,.96);border:1px solid #cfd9dd;border-radius:8px;box-shadow:0 1px 5px #25364b18;color:#2b3a55}
    .ed-exp-viewtools button{background:#fff;border:1px solid #c4d0d8;border-radius:6px;color:#2b3a55;min-height:29px;font:700 12px system-ui}
    .ce-integrated .ce-tools-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
    .ce-integrated .ce-tool-block{min-width:0;padding:8px;border:1px solid #d8e0e4;border-radius:8px;background:#f8faf9}
    .ce-integrated .ce-tool-block>b{display:block;margin-bottom:6px;font-size:12px;color:#2b3a55}
    .ce-integrated .ce-tool-block .ce-row{margin:4px 0}
    .ce-integrated .ce-tool-block button{min-height:30px;padding:5px 8px;font-size:11px}
    .ce-integrated .ce-tool-block input,.ce-integrated .ce-tool-block select{width:100%;min-width:0;max-width:100%;box-sizing:border-box}
    .ce-integrated .ce-report{display:block;min-height:38px;padding:8px;border:1px solid #d8e0e4;border-radius:8px;background:#fff;color:#41566b;font:11px/1.5 system-ui;white-space:pre-wrap;overflow-wrap:anywhere}
    #ce-ride-deck{position:fixed;z-index:2147483640;top:10px;left:10px;width:min(330px,calc(100vw - 20px));max-height:44vh;overflow:auto;box-sizing:border-box;padding:10px;border:1px solid #64748b;border-radius:12px;background:rgba(15,23,42,.94);color:#fff;box-shadow:0 5px 24px #0007;font:12px/1.4 system-ui,sans-serif}
    #ce-ride-deck[hidden]{display:none!important}#ce-ride-deck .ce-rd-title{display:flex;justify-content:space-between;align-items:center;gap:6px;font-weight:800;margin-bottom:7px}
    #ce-ride-deck .ce-rd-metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px}
    #ce-ride-deck .ce-rd-metrics span{display:block;padding:6px;border-radius:7px;background:#25364f;min-width:0}
    #ce-ride-deck .ce-rd-metrics b{display:block;font-size:16px;font-variant-numeric:tabular-nums}
    #ce-ride-deck .ce-rd-row{display:flex;flex-wrap:wrap;gap:5px;margin-top:7px}
    #ce-ride-deck button{min-height:30px;padding:5px 8px;border:1px solid #94a3b8;border-radius:7px;background:#f8fafc;color:#172033;font:700 11px system-ui}
    #ce-ride-deck button[aria-pressed=true]{background:#b7e4ff;border-color:#38a3e6}
    #ce-ride-deck .ce-rd-note{margin-top:7px;color:#cbd5e1;font-size:11px}
    @media(max-width:520px){.ce-integrated .ce-row>label{flex:1 1 130px}.ce-integrated .ce-row input[type=number]{width:100%;max-width:125px}.ce-integrated .ce-tools-grid{grid-template-columns:1fr}#ce-ride-deck{max-height:36vh}}
  `;
  document.head.appendChild(style);

  const dock = document.createElement('section');
  dock.id = 'coaster-expansion-tools';
  dock.className = 'ce-integrated';
  dock.innerHTML = `
    <div class="map-row ce-nav" role="tablist" aria-label="追加機能">
      <span class="lab">追加機能</span>
      <button type="button" class="chip on" data-tab="course" aria-selected="true">コース拡張</button>
      <button type="button" class="chip" data-tab="model" aria-selected="false">モデル配置</button>
      <button type="button" class="chip" data-tab="save" aria-selected="false">保存・出力</button>
      <button type="button" class="chip" data-tab="power" aria-selected="false">追加26機能</button>
      <button type="button" class="chip" data-tab="architecture" aria-selected="false">建築アトラクション19</button>
      <button type="button" class="chip" data-tab="cityflight" aria-selected="false">都市街区・フライト</button>
    </div>
    <div class="ce-status note" data-status role="status">準備完了。追加機能は元の編集画面に統合されています。</div>
    <div class="ce-panel" data-panel="course">
      <div class="ce-row">
        <label>コース形状<select data-preset><option value="0">大きな周回</option><option value="1">S字・くねくね</option><option value="2">交差レイアウト</option><option value="3">池を回る</option><option value="4">ヘアピン連続</option><option value="5">スパイラル</option><option value="6">クローバー</option><option value="7">星型レイアウト</option><option value="8">稲妻レイアウト</option></select></label>
        <label>サイズ<select data-size><option value="1.5">標準 ×1.5</option><option value="3" selected>広い ×3</option><option value="4.5">特大 ×4.5</option><option value="6">最大 ×6</option></select></label>
        <button type="button" class="chip" data-action="preset">形状を適用</button>
      </div>
      <div class="ce-row">
        <button type="button" class="chip" data-action="smooth">カーブを滑らかに</button>
        <button type="button" class="chip" data-action="fit">コース全体を表示</button>
        <button type="button" class="chip" data-action="fit-field">敷地全体を表示</button>
      </div>
      <div class="ce-note" data-track-stats>コース長：未作成</div>
      <small class="ce-note">敷地：1,200m × 1,200m／手描きコース上限：5,000m。表示操作は地図右上の＋／−、全体、矢印。PCはShift＋ドラッグで移動できます。</small>
    </div>
    <div class="ce-panel" data-panel="model" hidden>
      <div class="ce-row"><input type="file" data-model-file accept=".glb,.gltf,.bin,.png,.jpg,.jpeg,.webp" multiple><button type="button" class="chip" data-action="import-model">モデルを読み込む</button><button type="button" class="chip" data-action="preview">3D画面で確認</button></div>
      <div class="ce-row"><label>配置モデル<select data-model-list><option value="">モデルなし</option></select></label></div>
      <div class="ce-row">
        <label>X (m)<input type="number" step="1" data-pos="x" value="0"></label>
        <label>Y (m)<input type="number" step="1" data-pos="y" value="0"></label>
        <label>Z (m)<input type="number" step="1" data-pos="z" value="0"></label>
      </div>
      <div class="ce-row">
        <label>倍率<input type="number" min="0.001" max="1000" step="0.1" data-pos="scale" value="1"></label>
        <label>Y回転 (°)<input type="number" step="5" data-pos="yaw" value="0"></label>
      </div>
      <div class="ce-row"><button type="button" class="chip" data-action="ground-model">地面に接地</button><button type="button" class="chip" data-action="duplicate-model">複製</button><button type="button" class="chip" data-action="remove-model">削除</button><button type="button" class="chip" data-action="clear-models">全削除</button></div>
      <div class="ce-note" data-model-stats>モデルはまだありません。</div>
      <small class="ce-note">GLBは単体で読み込めます。glTFは関連する.bin・画像も同時に選択してください。モデルの配置はプロジェクトZIPに保存できます。</small>
    </div>
    <div class="ce-panel" data-panel="save" hidden>
      <div class="ce-row"><button type="button" class="chip" data-action="save-local">コースをゲーム内保存</button><button type="button" class="chip" data-action="export-json">設計JSON</button></div>
      <div class="ce-row"><input type="file" data-json-file accept=".json,application/json"><button type="button" class="chip" data-action="import-json">設計JSONを読み込む</button></div>
      <div class="ce-row"><button type="button" class="chip" data-action="project-save">プロジェクトZIPを保存</button><input type="file" data-project-file accept=".zip,application/zip"><button type="button" class="chip" data-action="project-load">プロジェクトZIPを開く</button></div>
      <div class="ce-row"><button type="button" class="chip" data-action="export-glb">現在のコース＋モデルをGLB出力</button></div>
      <small class="ce-note">プロジェクトZIPにはコース設計・配置モデル・モデル元ファイル・都市街区の生成設定を保存します。都市は同じシードで復元されます。旧GLB出力はインスタンス一括描画の都市建物を含みません。</small>
    </div>
    <div class="ce-panel" data-panel="power" hidden>
      <div class="ce-note">既存のコース拡張・モデル配置・保存機能はそのまま残し、下記26機能を追加しています。編集内容は元に戻す操作に対応します。</div>
      <div class="ce-tools-grid">
        <section class="ce-tool-block">
          <b>高さ・山の設計（1～10）</b>
          <div class="ce-row"><button type="button" class="chip" data-action="alt-preset" data-value="100">100m</button><button type="button" class="chip" data-action="alt-preset" data-value="300">300m</button><button type="button" class="chip" data-action="alt-preset" data-value="600">600m</button><button type="button" class="chip" data-action="alt-preset" data-value="1000">1000m</button></div>
          <div class="ce-row"><label>目標最高高度 (m)<input type="number" min="2" max="100000" step="10" data-alt-target value="600"></label><button type="button" class="chip" data-action="alt-exact">最高高度を設定</button></div>
          <div class="ce-row"><label>高さ倍率<input type="number" min="0.1" max="20" step="0.1" data-alt-scale value="1.5"></label><button type="button" class="chip" data-action="alt-scale">倍率適用</button></div>
          <div class="ce-row"><label>持ち上げ量 (m)<input type="number" min="-10000" max="10000" step="10" data-alt-offset value="100"></label><button type="button" class="chip" data-action="alt-offset">山を上下</button></div>
          <div class="ce-row"><button type="button" class="chip" data-action="alt-reverse">山と谷を反転</button><button type="button" class="chip" data-action="alt-smooth">高さを滑らかに</button></div>
          <div class="ce-row"><label>最大勾配<select data-alt-grade><option value="25">25%</option><option value="40" selected>40%</option><option value="60">60%</option><option value="100">100%</option></select></label><button type="button" class="chip" data-action="alt-grade">勾配を制限</button></div>
          <div class="ce-row"><label>山の数<select data-alt-peaks><option>2</option><option selected>3</option><option>4</option><option>5</option><option>6</option></select></label><button type="button" class="chip" data-action="alt-waves">連続する山を生成</button></div>
          <div class="ce-row"><button type="button" class="chip" data-action="alt-drop">超巨大ドロップ生成</button><button type="button" class="chip" data-action="alt-plateau">空中高原を生成</button></div>
          <small class="ce-note">1 高度プリセット／2 数値高度／3 高さ倍率／4 高さオフセット／5 山谷反転／6 平滑化／7 勾配制限／8 多峰型／9 巨大落下／10 高原型</small>
        </section>
        <section class="ce-tool-block">
          <b>コース形状（11～18）</b>
          <div class="ce-row"><button type="button" class="chip" data-action="mirror-x">左右反転</button><button type="button" class="chip" data-action="mirror-z">前後反転</button></div>
          <div class="ce-row"><label>回転角度 (°)<input type="number" step="5" data-path-rotation value="45"></label><button type="button" class="chip" data-action="path-rotate">角度回転</button></div>
          <div class="ce-row"><label>平面倍率<input type="number" min="0.1" max="4" step="0.1" data-path-scale value="1.2"></label><button type="button" class="chip" data-action="path-scale">コース拡大・縮小</button></div>
          <div class="ce-row"><label>X移動 (m)<input type="number" step="5" data-path-x value="20"></label><button type="button" class="chip" data-action="path-x">X方向へ移動</button></div>
          <div class="ce-row"><label>Z移動 (m)<input type="number" step="5" data-path-z value="20"></label><button type="button" class="chip" data-action="path-z">Z方向へ移動</button></div>
          <div class="ce-row"><label>簡略化誤差 (m)<input type="number" min="0.1" max="20" step="0.1" data-path-tolerance value="1"></label><button type="button" class="chip" data-action="path-simplify">点数を最適化</button></div>
          <div class="ce-row"><label>ランダム形状<select data-random-kind><option value="0">大きな周回</option><option value="1">S字</option><option value="2">交差</option><option value="3">池周回</option><option value="4">ヘアピン</option><option value="5">スパイラル</option><option value="6">クローバー</option><option value="7">星型</option><option value="8">稲妻</option></select></label><button type="button" class="chip" data-action="random-course">別バリエーション</button></div>
          <small class="ce-note">11 左右反転／12 前後反転／13 任意回転／14 平面拡縮／15 X移動／16 Z移動／17 点数最適化／18 ランダム別案</small>
        </section>
        <section class="ce-tool-block">
          <b>設計診断（19～21）</b>
          <div class="ce-row"><button type="button" class="chip" data-action="analyze-stats">コース諸元を分析</button><button type="button" class="chip" data-action="analyze-clashes">交差・接近を検査</button><button type="button" class="chip" data-action="analyze-physics">物理試走レポート</button></div>
          <div class="ce-report" data-power-report>ここに分析結果を表示します。</div>
          <small class="ce-note">19 全長・高度・勾配・範囲の諸元／20 線路の交差・接近箇所／21 物理試走と速度・G・結果のレポート</small>
        </section>
        <section class="ce-tool-block">
          <b>走行中の操作と記録（22～26）</b>
          <div class="ce-note">走行画面にも操作パネルが自動表示されます。</div>
          <div class="ce-row"><button type="button" class="chip" data-action="show-ride-deck">走行パネルを表示</button><button type="button" class="chip" data-action="show-records">自己ベストを表示</button><button type="button" class="chip" data-action="new-challenge">ミッションを変更</button></div>
          <div class="ce-report" data-record-report>走行記録はまだありません。</div>
          <small class="ce-note">22 速度・高度・G・走行時間のライブ計器／23 カメラ切替／24 再生速度／25 一時停止／26 自己ベストとランダムミッション</small>
        </section>
      </div>
    </div>
    <div class="ce-panel" data-panel="architecture" hidden></div>
    <div class="ce-panel" data-panel="cityflight" hidden></div>`;
  const $ = (selector) => dock.querySelector(selector);
  const statusEl = $('[data-status]');
  const modelFile = $('[data-model-file]');
  const architecturePack = installArchitecturePack(api, editor, $('[data-panel="architecture"]'));
  const cityFlightPack = installCityFlight(api, editor, $('[data-panel="cityflight"]'));

  function status(message, bad = false) {
    statusEl.textContent = message;
    statusEl.classList.toggle('bad', !!bad);
  }
  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.style.display = 'none';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 20000);
  }
  function safeName(s) { return String(s || 'coaster').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60) || 'coaster'; }
  function mountNativeUI() {
    const target = editor.step === 4 ? editor.opts : editor.step === 1 ? editor.tools : null;
    if (!target) { dock.remove(); return; }
    if (dock.parentElement !== target) target.appendChild(dock);
  }
  const originalBuildTools = editor.buildTools;
  editor.buildTools = function(...args) {
    const result = originalBuildTools.apply(this,args);
    mountNativeUI();
    return result;
  };

  function updateTrackStats() {
    const pts = editor.design && editor.design.pts || [];
    if (!pts.length) { $('[data-track-stats]').textContent = 'コース長：未作成'; return; }
    const l = polyLen(pts);
    const full = editor.preview && Number.isFinite(editor.preview.Lf) ? editor.preview.Lf + 24 : l;
    const xs = pts.map(p => p[0]), zs = pts.map(p => p[1]);
    const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...zs) - Math.min(...zs);
    $('[data-track-stats]').textContent = `走行ルート 約${Math.round(full).toLocaleString()}m（手描き ${Math.round(l).toLocaleString()}m）／ 使用幅 ${Math.round(w)} × ${Math.round(h)}m ／ 上限 ${MAX_LEN.toLocaleString()}m`;
  }
  const oldOnChange = editor.onChange;
  editor.onChange = (...args) => { try { oldOnChange && oldOnChange(...args); } finally { updateTrackStats(); } };
  const oldOpen = editor.open;
  editor.open = function(...args) { const result = oldOpen.apply(this,args); updateTrackStats(); mountNativeUI(); return result; };

  function applyPreset() {
    const d = editor.design;
    if (!d) { status('先にコース編集を開始してください。', true); return; }
    const kind = Number($('[data-preset]').value);
    const scale = Number($('[data-size]').value);
    const raw = randomStroke((presetSeed += 37), kind, 0);
    if (!Array.isArray(raw) || raw.length < 2) throw new Error('テンプレートを生成できませんでした');
    const xs = raw.map(p => p[0]), zs = raw.map(p => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
    const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
    const roomX = FIELD.x1 - FIELD.x0 - 48, roomZ = FIELD.z1 - FIELD.z0 - 48;
    let factor = Math.min(scale, roomX / Math.max(1, maxX - minX), roomZ / Math.max(1, maxZ - minZ));
    let pts = raw.map(([x,z]) => [clamp((x - cx) * factor, FIELD.x0 + 24, FIELD.x1 - 24), clamp((z - cz) * factor, FIELD.z0 + 24, FIELD.z1 - 24)]);
    // 駅の出口付近からコースを始められるよう、全体を敷地内で平行移動。
    const shiftX = clamp(18 - pts[0][0], FIELD.x0 + 24 - Math.min(...pts.map(p=>p[0])), FIELD.x1 - 24 - Math.max(...pts.map(p=>p[0])));
    const shiftZ = clamp(38 - pts[0][1], FIELD.z0 + 24 - Math.min(...pts.map(p=>p[1])), FIELD.z1 - 24 - Math.max(...pts.map(p=>p[1])));
    pts = pts.map(([x,z]) => [x + shiftX, z + shiftZ]);
    // 点数を安定させ、描画とURLのサイズを抑える。
    if (pts.length > 8192) pts = pts.filter((_,i) => i % Math.ceil(pts.length / 8192) === 0);
    const l = polyLen(pts);
    if (l > MAX_LEN) {
      const f = MAX_LEN / l * 0.98;
      const ox = pts[0][0], oz = pts[0][1];
      pts = pts.map(([x,z]) => [ox + (x - ox) * f, oz + (z - oz) * f]);
    }
    editor.record();
    d.pts = pts;
    // 新しい平面コースには旧コースの高さ・しかけを流用しない。次の標準ステップで高さを描き直す。
    d.hs = null;
    d.gm = [];
    editor.redraw = null;
    editor.refresh(true);
    editor.fitMapView();
    editor.onChange && editor.onChange();
    status(`テンプレートを適用しました。描画線 約${Math.round(polyLen(pts)).toLocaleString()}m。元の編集画面で形を調整できます。`);
  }

  function smoothCurrentTrack() {
    const d = editor.design;
    if (!d || !Array.isArray(d.pts) || d.pts.length < 4) { status('なめらかにするには4点以上のコースが必要です。', true); return; }
    editor.record();
    let pts = d.pts.map(p => p.slice());
    // Chaikin corner cutting: start/end stay in place; intermediate corners become a continuous curve.
    const passes = pts.length > 2000 ? 1 : 2;
    for (let pass = 0; pass < passes; pass++) {
      const out = [pts[0]];
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        out.push([0.75*a[0] + 0.25*b[0], 0.75*a[1] + 0.25*b[1]]);
        out.push([0.25*a[0] + 0.75*b[0], 0.25*a[1] + 0.75*b[1]]);
      }
      out.push(pts[pts.length - 1]);
      pts = out;
      if (pts.length > 8192) break;
    }
    const l = polyLen(pts);
    if (l > MAX_LEN || pts.length > 8192) { editor.undoStack.pop(); editor.updateUndo(); status('平滑化後の線が上限を超えるため、変更しませんでした。', true); return; }
    d.pts = pts;
    editor.refresh(true);
    editor.onChange && editor.onChange();
    status('カーブを2段階で平滑化しました。元に戻す操作にも対応しています。');
  }

  // ---------------- 新機能26個 ----------------
  const HEIGHT_COUNT = 96;
  const RECORD_KEY = 'coaster_expansion_records_v4';
  const CHALLENGE_KEY = 'coaster_expansion_challenge_v4';
  const savedRideSims = new WeakSet();
  let lastRideSim = null;
  let rideDeckManuallyHidden = false;
  let ridePoll = 0;

  function requireDesign(needsPath = false) {
    const d = editor.design;
    if (!d) throw new Error('先にコース編集を開始してください');
    if (needsPath && (!Array.isArray(d.pts) || d.pts.length < 2)) throw new Error('先にコースを描いてください');
    return d;
  }
  function readHeights(d) {
    const src = Array.isArray(d.hs) && d.hs.length >= 2 ? d.hs : [];
    return Array.from({ length: HEIGHT_COUNT }, (_, i) => {
      const u = i * (src.length - 1) / (HEIGHT_COUNT - 1);
      if (!src.length) return 2;
      const a = Math.floor(u), b = Math.min(src.length - 1, a + 1), t = u - a;
      const v = Number(src[a]) * (1 - t) + Number(src[b]) * t;
      return Number.isFinite(v) ? Math.max(2, v) : 2;
    });
  }
  function refreshEditedDesign(message, fit = false) {
    editor.redraw = null;
    editor.refresh(true);
    if (fit && typeof editor.fitMapView === 'function') editor.fitMapView();
    if (editor.onChange) editor.onChange();
    status(message);
    refreshPowerReports();
  }
  function editDesign(label, fn, needsPath = false, fit = false) {
    const d = requireDesign(needsPath);
    editor.record();
    fn(d);
    refreshEditedDesign(label, fit);
  }
  function smooth01(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
  function applyPeak(target) {
    target = clamp(Number(target) || 0, 2, 100000);
    editDesign(`高さを最高約${Math.round(target).toLocaleString()}mに設定しました。`, (d) => {
      const hs = readHeights(d);
      const current = Math.max(...hs);
      if (current <= 2.01) {
        const peaks = hs.map((_, i) => Math.pow(Math.sin(Math.PI * i / (HEIGHT_COUNT - 1)), 2));
        const peakNorm = Math.max(...peaks) || 1;
        d.hs = peaks.map(v => 2 + (target - 2) * v / peakNorm);
      } else {
        const factor = (target - 2) / (current - 2);
        d.hs = hs.map(h => 2 + (h - 2) * factor);
      }
    });
    $('[data-alt-target]').value = String(Math.round(target));
  }
  function transformPath(transform, label) {
    editDesign(label, (d) => {
      const old = d.pts.map(p => [Number(p[0]), Number(p[1])]);
      const transformed = old.map((p, i) => transform(p[0], p[1], i));
      const xs = transformed.map(p => p[0]), zs = transformed.map(p => p[1]);
      const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
      const wantX = old[0][0] - transformed[0][0], wantZ = old[0][1] - transformed[0][1];
      const dx = clamp(wantX, FIELD.x0 + 4 - minX, FIELD.x1 - 4 - maxX);
      const dz = clamp(wantZ, FIELD.z0 + 4 - minZ, FIELD.z1 - 4 - maxZ);
      const next = transformed.map(([x, z]) => [clamp(x + dx, FIELD.x0 + 2, FIELD.x1 - 2), clamp(z + dz, FIELD.z0 + 2, FIELD.z1 - 2)]);
      if (polyLen(next) > MAX_LEN + 1) throw new Error(`変形後のコース長が${MAX_LEN.toLocaleString()}mを超えます`);
      d.pts = next;
    }, true, true);
  }
  function simplifyPath(points, tolerance) {
    if (points.length < 3) return points.map(p => p.slice());
    const keep = new Uint8Array(points.length);
    keep[0] = keep[points.length - 1] = 1;
    const stack = [[0, points.length - 1]];
    while (stack.length) {
      const [a, b] = stack.pop();
      const p0 = points[a], p1 = points[b];
      const dx = p1[0] - p0[0], dz = p1[1] - p0[1];
      const len = Math.hypot(dx, dz) || 1;
      let best = -1, bestDist = tolerance;
      for (let i = a + 1; i < b; i++) {
        const p = points[i];
        const dist = Math.abs(dx * (p0[1] - p[1]) - (p0[0] - p[0]) * dz) / len;
        if (dist > bestDist) { bestDist = dist; best = i; }
      }
      if (best >= 0) { keep[best] = 1; stack.push([a, best], [best, b]); }
    }
    return points.filter((_, i) => keep[i]).map(p => p.slice());
  }
  function report(text) { $('[data-power-report]').textContent = text; }
  function getDesignStats() {
    const d = requireDesign(true), hs = readHeights(d), pts = d.pts;
    const xs = pts.map(p => p[0]), zs = pts.map(p => p[1]);
    const length = polyLen(pts);
    const maxH = Math.max(...hs), minH = Math.min(...hs);
    const ds = length / (hs.length - 1);
    let climb = 0, descent = 0, maxGrade = 0;
    for (let i = 1; i < hs.length; i++) {
      const delta = hs[i] - hs[i - 1];
      if (delta > 0) climb += delta; else descent -= delta;
      maxGrade = Math.max(maxGrade, Math.abs(delta) / Math.max(0.01, ds) * 100);
    }
    const tr = editor.preview && editor.preview.tr;
    return { length, width: Math.max(...xs) - Math.min(...xs), depth: Math.max(...zs) - Math.min(...zs), maxH, minH, drop: maxH - minH, climb, descent, maxGrade, points: pts.length, clashes: tr && tr.clashes ? tr.clashes.length : null, supports: tr && tr.supports ? tr.supports.length : null };
  }
  function refreshPowerReports() {
    try {
      const d = editor.design;
      if (!d || !Array.isArray(d.pts) || d.pts.length < 2) return;
      const s = getDesignStats();
      $('[data-power-report]').textContent = `全長 ${Math.round(s.length).toLocaleString()}m ／ 平面 ${Math.round(s.width)}×${Math.round(s.depth)}m\n高さ ${Math.round(s.minH)}～${Math.round(s.maxH)}m ／ 落差 ${Math.round(s.drop)}m\n登り合計 ${Math.round(s.climb)}m ／ 下り合計 ${Math.round(s.descent)}m ／ 最大勾配 ${s.maxGrade.toFixed(1)}%\n制御点 ${s.points.toLocaleString()}個${s.clashes == null ? '' : ` ／ 交差 ${s.clashes}か所`}`;
    } catch (_) { /* editor may be transitioning */ }
  }
  function readRideRecords() {
    try { const a = JSON.parse(localStorage.getItem(RECORD_KEY) || '[]'); return Array.isArray(a) ? a.slice(0, 40) : []; }
    catch (_) { return []; }
  }
  function writeRideRecords(records) {
    try { localStorage.setItem(RECORD_KEY, JSON.stringify(records.slice(0, 40))); } catch (_) { /* storage may be disabled */ }
  }
  const CHALLENGES = [
    { id: 'speed', title: '高速ランナー', metric: 'maxV', target: 180, unit: 'km/h', label: '最高速度180km/h以上' },
    { id: 'height', title: '天空の設計士', metric: 'maxH', target: 300, unit: 'm', label: '最高高度300m以上' },
    { id: 'drop', title: '垂直落下マスター', metric: 'drop', target: 200, unit: 'm', label: '落差200m以上' },
    { id: 'air', title: '空中散歩', metric: 'air', target: 2.5, unit: '秒', label: 'エアタイム2.5秒以上' },
    { id: 'long', title: 'ロングライド', metric: 'time', target: 90, unit: '秒', label: '走行90秒以上' },
  ];
  function getChallenge(forceNew = false) {
    const today = new Date().toISOString().slice(0, 10);
    try {
      const saved = JSON.parse(localStorage.getItem(CHALLENGE_KEY) || 'null');
      if (!forceNew && saved && saved.date === today && CHALLENGES.some(c => c.id === saved.id)) return CHALLENGES.find(c => c.id === saved.id);
    } catch (_) { /* choose a fresh challenge */ }
    const pick = CHALLENGES[Math.floor(Math.random() * CHALLENGES.length)];
    try { localStorage.setItem(CHALLENGE_KEY, JSON.stringify({ date: today, id: pick.id })); } catch (_) {}
    return pick;
  }
  function formatRecordReport() {
    const records = readRideRecords();
    if (!records.length) return '走行記録はまだありません。コースを走ると自己ベストを自動保存します。';
    const bestSpeed = Math.max(...records.map(r => r.maxV || 0));
    const bestHeight = Math.max(...records.map(r => r.maxH || 0));
    const bestDrop = Math.max(...records.map(r => r.drop || 0));
    const challenge = getChallenge();
    return `記録 ${records.length}走 ／ 最高速度 ${bestSpeed.toFixed(1)}km/h ／ 最高高度 ${bestHeight.toFixed(0)}m ／ 最大落差 ${bestDrop.toFixed(0)}m\n今日のミッション：${challenge.label}`;
  }
  function recordCompletedRide(sim, coaster) {
    if (!sim || sim.mode !== 'done' || savedRideSims.has(sim)) return;
    savedRideSims.add(sim);
    const r = sim.summary();
    const row = { date: new Date().toISOString(), result: r.result || 'unknown', maxV: Number((r.maxV * 3.6).toFixed(2)), maxH: Number((r.maxH || 0).toFixed(1)), drop: Number((r.drop || 0).toFixed(1)), air: Number((r.air || 0).toFixed(2)), time: Number((r.time || sim.t || 0).toFixed(2)), maxG: Number((r.maxG || 0).toFixed(2)), fun: r.fun || 0, safe: r.safe || 0, courseLength: coaster && coaster.tr ? Math.round(coaster.tr.L) : 0 };
    const records = [row, ...readRideRecords()].slice(0, 40);
    writeRideRecords(records);
    const challenge = getChallenge();
    const actual = challenge.metric === 'maxV' ? row.maxV : row[challenge.metric] || 0;
    const passed = actual >= challenge.target;
    const note = passed ? `ミッション達成：${challenge.label}` : `ミッション未達：${challenge.label}（今回 ${actual.toFixed(1)}${challenge.unit}）`;
    const noteEl = rideDeck.querySelector('[data-rd-challenge]');
    if (noteEl) noteEl.textContent = note;
    updateRecordReport();
  }
  function updateRecordReport() {
    const value = formatRecordReport();
    const el = $('[data-record-report]');
    if (el) el.textContent = value;
    const rideEl = rideDeck && rideDeck.querySelector('[data-rd-records]');
    if (rideEl) rideEl.textContent = value;
  }
  async function runPhysicsReport() {
    const d = requireDesign(true);
    status('物理試走を計算中…');
    const dryTrack = api.buildTrack(d, null);
    const dry = new api.Sim(dryTrack, d, { dry: true });
    // 1フレームに少しずつ進め、スマホの画面が長時間固まらないようにする。
    while (dry.mode !== 'done' && dry.t < 180) {
      for (let i = 0; i < 480 && dry.mode !== 'done' && dry.t < 180; i++) dry.step();
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
    const tr = api.buildTrack(d, dry.vEst);
    const sim = new api.Sim(tr, d);
    while (sim.mode !== 'done' && sim.t < 300) {
      for (let i = 0; i < 480 && sim.mode !== 'done' && sim.t < 300; i++) sim.step();
      report(`物理試走中… ${sim.t.toFixed(1)}秒／最大300秒。実際の走行時間には制限を加えません。`);
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
    const r = sim.summary();
    report(`試走${sim.mode === 'done' ? '完了' : '300秒時点'}：${r.result || '未完了'}\n最高速度 ${(r.maxV * 3.6).toFixed(1)}km/h ／ 最高G ${r.maxG.toFixed(2)}G ／ 横G ${r.maxLat.toFixed(2)}G\n落差 ${(r.drop || 0).toFixed(1)}m ／ エアタイム ${(r.air || 0).toFixed(2)}秒 ／ 走行時間 ${sim.t.toFixed(1)}秒\n脱落 ${r.ejected}人 ／ 交差 ${tr.clashes.length}か所`);
    status(sim.mode === 'done' ? '物理試走レポートを作成しました。' : '300秒の試算区間を終了しました。実走には時間制限はありません。');
  }

  // 走行中の計器パネル。ゲームの本来のループには介入せず、現在値を読むだけ。
  const rideDeck = document.createElement('aside');
  rideDeck.id = 'ce-ride-deck';
  rideDeck.hidden = true;
  rideDeck.innerHTML = `
    <div class="ce-rd-title"><span>COASTER LIVE PANEL</span><button type="button" data-rd-hide>閉じる</button></div>
    <div class="ce-rd-metrics">
      <span>速度<b data-rd-speed>0.0</b><small>km/h</small></span>
      <span>高度<b data-rd-height>0</b><small>m</small></span>
      <span>時間<b data-rd-time>0.0</b><small>秒</small></span>
      <span>縦G<b data-rd-g>1.00</b><small>G</small></span>
      <span>横G<b data-rd-lat>0.00</b><small>G</small></span>
      <span>落差<b data-rd-drop>0</b><small>m</small></span>
    </div>
    <div class="ce-rd-row"><button type="button" data-rd-camera="auto">中継</button><button type="button" data-rd-camera="chase">追跡</button><button type="button" data-rd-camera="pov">先頭視点</button><button type="button" data-rd-camera="free">自由カメラ</button></div>
    <div class="ce-rd-row"><button type="button" data-rd-speed="0.5">0.5倍</button><button type="button" data-rd-speed="1">1倍</button><button type="button" data-rd-speed="2">2倍</button><button type="button" data-rd-speed="4">4倍</button><button type="button" data-rd-pause>一時停止</button></div>
    <div class="ce-rd-note" data-rd-challenge></div>
    <div class="ce-rd-note" data-rd-records></div>`;
  document.body.appendChild(rideDeck);
  rideDeck.addEventListener('click', (event) => {
    const b = event.target.closest('button'); if (!b) return;
    try {
      if (b.hasAttribute('data-rd-hide')) { rideDeckManuallyHidden = true; rideDeck.hidden = true; }
      else if (b.dataset.rdCamera) { api.setCameraMode(b.dataset.rdCamera); }
      else if (b.dataset.rdSpeed) { api.setPlaybackSpeed(Number(b.dataset.rdSpeed)); }
      else if (b.hasAttribute('data-rd-pause')) { api.setPaused(!api.paused); b.textContent = api.paused ? '再生' : '一時停止'; }
    } catch (e) { console.warn('[Coaster Expansion ride panel]', e); }
  });
  function pollRidePanel() {
    const coaster = api.co, sim = coaster && coaster.sim;
    const active = api.mode === 'ride' || api.mode === 'result';
    rideDeck.hidden = !active || rideDeckManuallyHidden;
    if (!active || !sim) return;
    if (sim !== lastRideSim) { lastRideSim = sim; rideDeckManuallyHidden = false; rideDeck.hidden = false; }
    const lead = sim.cars && sim.cars[0];
    const speed = Math.abs(Number(sim.v) || 0) * 3.6;
    rideDeck.querySelector('[data-rd-speed]').textContent = speed.toFixed(1);
    rideDeck.querySelector('[data-rd-height]').textContent = lead && lead.f ? Math.round(lead.f.y).toLocaleString() : '—';
    rideDeck.querySelector('[data-rd-time]').textContent = Number(sim.t || 0).toFixed(1);
    rideDeck.querySelector('[data-rd-g]').textContent = lead ? Number(lead.gUf || 0).toFixed(2) : '—';
    rideDeck.querySelector('[data-rd-lat]').textContent = lead ? Math.abs(Number(lead.gRf || 0)).toFixed(2) : '—';
    rideDeck.querySelector('[data-rd-drop]').textContent = Math.round(sim.st && sim.st.drop || 0).toLocaleString();
    rideDeck.querySelectorAll('[data-rd-camera]').forEach(b => b.setAttribute('aria-pressed', String(api.cameraMode === b.dataset.rdCamera)));
    rideDeck.querySelectorAll('[data-rd-speed]').forEach(b => b.setAttribute('aria-pressed', String(api.playbackSpeed === Number(b.dataset.rdSpeed))));
    const pause = rideDeck.querySelector('[data-rd-pause]');
    pause.textContent = api.paused ? '再生' : '一時停止';
    const challenge = getChallenge();
    rideDeck.querySelector('[data-rd-challenge]').textContent = `今日のミッション：${challenge.label}`;
    if (sim.mode === 'done') recordCompletedRide(sim, coaster);
  }
  ridePoll = setInterval(pollRidePanel, 220);

  function decodeDataUri(uri) {
    const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(uri || '');
    if (!m) throw new Error('data URIが不正です');
    const mime = m[1] || 'application/octet-stream';
    const data = m[3];
    if (m[2]) {
      const bin = atob(data);
      const bytes = new Uint8Array(bin.length);
      for (let i=0;i<bin.length;i++) bytes[i] = bin.charCodeAt(i);
      return new Blob([bytes], { type:mime });
    }
    return new Blob([decodeURIComponent(data)], { type:mime });
  }
  function parseGlb(buffer) {
    const dv = new DataView(buffer);
    if (dv.byteLength < 20 || dv.getUint32(0,true) !== 0x46546c67) throw new Error('GLBヘッダーが正しくありません');
    const version = dv.getUint32(4,true);
    if (version !== 2) throw new Error(`GLB version ${version} は未対応です`);
    const declared = dv.getUint32(8,true);
    if (declared > buffer.byteLength || declared < 20) throw new Error('GLBサイズが不正です');
    let offset = 12, json = null, bin = null;
    while (offset + 8 <= declared) {
      const len = dv.getUint32(offset,true); offset += 4;
      const type = dv.getUint32(offset,true); offset += 4;
      if (offset + len > declared) throw new Error('GLBチャンクが範囲外です');
      const chunk = buffer.slice(offset, offset + len); offset += len;
      if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(chunk).replace(/[\u0000\u0020]+$/g,''));
      else if (type === 0x004e4942) bin = chunk;
    }
    if (!json) throw new Error('GLB内にJSONチャンクがありません');
    return { json, bin };
  }
  function componentInfo(type) {
    const map = { 5120:[1,'getInt8',true],5121:[1,'getUint8',false],5122:[2,'getInt16',true],5123:[2,'getUint16',false],5125:[4,'getUint32',false],5126:[4,'getFloat32',true] };
    const x = map[type]; if (!x) throw new Error(`componentType ${type} は未対応です`); return x;
  }
  function typeSize(type) { return ({SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT2:4,MAT3:9,MAT4:16})[type] || 0; }
  function readAccessor(gltf, buffers, accessorIndex) {
    const acc = gltf.accessors && gltf.accessors[accessorIndex];
    if (!acc) throw new Error(`accessor ${accessorIndex} がありません`);
    const count = acc.count, n = typeSize(acc.type), [bytes, getter, signed] = componentInfo(acc.componentType);
    if (!n || count > 5_000_000) throw new Error('巨大または不正なaccessorです');
    const out = new Float32Array(count * n);
    if (acc.bufferView == null) return out;
    const bv = gltf.bufferViews && gltf.bufferViews[acc.bufferView];
    if (!bv) throw new Error('bufferViewが見つかりません');
    const buf = buffers[bv.buffer == null ? 0 : bv.buffer];
    if (!buf) throw new Error('bufferが見つかりません');
    const viewOffset = bv.byteOffset || 0;
    const stride = bv.byteStride || bytes * n;
    const start = viewOffset + (acc.byteOffset || 0);
    const dv = new DataView(buf);
    for (let i=0;i<count;i++) {
      const row = start + i * stride;
      for (let j=0;j<n;j++) {
        let v = dv[getter](row + j*bytes, true);
        if (acc.normalized && acc.componentType !== 5126) {
          if (signed) v = Math.max(-1, v / (2 ** (bytes*8-1) - 1));
          else v = v / (2 ** (bytes*8) - 1);
        }
        out[i*n+j] = v;
      }
    }
    return out;
  }
  function readIndices(gltf, buffers, accessorIndex) {
    const acc = gltf.accessors[accessorIndex];
    const vals = readAccessor(gltf, buffers, accessorIndex);
    const out = new Array(vals.length);
    for (let i=0;i<vals.length;i++) out[i] = Math.max(0, Math.round(vals[i]));
    return out;
  }
  function triangulate(indices, mode) {
    if (mode === 4) return indices;
    const out = [];
    if (mode === 5) {
      for (let i=2;i<indices.length;i++) {
        if (i & 1) out.push(indices[i-1],indices[i-2],indices[i]);
        else out.push(indices[i-2],indices[i-1],indices[i]);
      }
    } else if (mode === 6) {
      for (let i=2;i<indices.length;i++) out.push(indices[0],indices[i-1],indices[i]);
    }
    return out;
  }
  async function imageTexture(gltf, buffers, files, imageIndex, cache) {
    if (cache.has(imageIndex)) return cache.get(imageIndex);
    const promise = (async () => {
      const def = gltf.images && gltf.images[imageIndex];
      if (!def) return null;
      let blob;
      if (def.uri) {
        if (def.uri.startsWith('data:')) blob = decodeDataUri(def.uri);
        else {
          const target = decodeURIComponent(def.uri.split('/').pop());
          const file = files.get(target.toLowerCase());
          if (!file) throw new Error(`画像 ${target} がありません。関連ファイルも一緒に選択してください。`);
          blob = file;
        }
      } else if (def.bufferView != null) {
        const bv = gltf.bufferViews && gltf.bufferViews[def.bufferView];
        if (!bv) throw new Error('画像bufferViewが不正です');
        const buf = buffers[bv.buffer == null ? 0 : bv.buffer];
        if (!buf) throw new Error('画像bufferが不正です');
        blob = new Blob([buf.slice(bv.byteOffset || 0, (bv.byteOffset || 0)+bv.byteLength)], {type:def.mimeType || 'image/png'});
      } else return null;
      const url = URL.createObjectURL(blob);
      try {
        const img = new Image();
        await new Promise((resolve,reject) => { img.onload=resolve; img.onerror=()=>reject(new Error('テクスチャ画像を読み込めません')); img.src=url; });
        const tex = new THREE.Texture(img);
        tex.flipY = false;
        if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
        tex.needsUpdate = true;
        return tex;
      } finally { URL.revokeObjectURL(url); }
    })();
    cache.set(imageIndex,promise);
    return promise;
  }
  async function loadGltf(file, allFiles) {
    let gltf, bin = null;
    if (file.name.toLowerCase().endsWith('.glb')) ({json:gltf,bin}=parseGlb(await file.arrayBuffer()));
    else gltf = JSON.parse(await file.text());
    const files = new Map(allFiles.map(f => [f.name.toLowerCase(), f]));
    const buffers = [];
    for (let i=0;i<(gltf.buffers || []).length;i++) {
      const b = gltf.buffers[i];
      if (!b.uri && i === 0 && bin) buffers.push(bin);
      else if (b.uri && b.uri.startsWith('data:')) buffers.push(await decodeDataUri(b.uri).arrayBuffer());
      else if (b.uri) {
        const name = decodeURIComponent(b.uri.split('/').pop());
        const f = files.get(name.toLowerCase());
        if (!f) throw new Error(`バッファ ${name} がありません。関連.binも一緒に選択してください。`);
        buffers.push(await f.arrayBuffer());
      } else throw new Error('glTFのbufferデータがありません');
    }
    const texCache = new Map();
    const materialCache = new Map();
    const materialFor = async (idx, hasColor) => {
      if (idx == null || !gltf.materials || !gltf.materials[idx]) return new THREE.MeshStandardMaterial({color:0xb9c5cf, roughness:.82, vertexColors:!!hasColor});
      const cacheKey = `${idx}:${hasColor ? 1 : 0}`;
      if (materialCache.has(cacheKey)) return materialCache.get(cacheKey);
      const def = gltf.materials[idx];
      const pbr = def.pbrMetallicRoughness || {};
      const c = pbr.baseColorFactor || [1,1,1,1];
      const mat = new THREE.MeshStandardMaterial({
        color:new THREE.Color(c[0],c[1],c[2]), opacity:c[3] == null ? 1 : c[3],
        metalness:pbr.metallicFactor == null ? 1 : pbr.metallicFactor,
        roughness:pbr.roughnessFactor == null ? 1 : pbr.roughnessFactor,
        transparent:def.alphaMode === 'BLEND' || c[3] < 1,
        alphaTest:def.alphaMode === 'MASK' ? (def.alphaCutoff == null ? .5 : def.alphaCutoff) : 0,
        side:def.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
        vertexColors:!!hasColor
      });
      if (pbr.baseColorTexture) {
        const ti = pbr.baseColorTexture.index;
        const imageIndex = gltf.textures && gltf.textures[ti] ? gltf.textures[ti].source : null;
        if (imageIndex != null) mat.map = await imageTexture(gltf,buffers,files,imageIndex,texCache);
      }
      materialCache.set(cacheKey,mat);
      return mat;
    };
    const meshDefs = gltf.meshes || [];
    async function createMesh(meshDef, nodeName) {
      const group = new THREE.Group(); group.name = nodeName || meshDef.name || 'ImportedMesh';
      for (const prim of meshDef.primitives || []) {
        if (![4,5,6].includes(prim.mode == null ? 4 : prim.mode)) continue;
        const geo = new THREE.BufferGeometry();
        const attrs = prim.attributes || {};
        const pos = attrs.POSITION == null ? null : readAccessor(gltf,buffers,attrs.POSITION);
        if (!pos || pos.length < 9) continue;
        geo.setAttribute('position',new THREE.BufferAttribute(pos,3));
        for (const [key,name,size] of [['NORMAL','normal',3],['TEXCOORD_0','uv',2],['COLOR_0','color',3]]) {
          if (attrs[key] == null) continue;
          const data=readAccessor(gltf,buffers,attrs[key]);
          const actualSize=typeSize(gltf.accessors[attrs[key]].type);
          if (actualSize === size || (key === 'COLOR_0' && actualSize === 4)) geo.setAttribute(name,new THREE.BufferAttribute(data,actualSize));
        }
        if (prim.indices != null) {
          const inds = readIndices(gltf,buffers,prim.indices);
          const tris = triangulate(inds,prim.mode == null ? 4 : prim.mode);
          if (tris.length) geo.setIndex(tris);
        } else if (prim.mode === 5 || prim.mode === 6) {
          const inds = Array.from({length:pos.length/3},(_,i)=>i);
          geo.setIndex(triangulate(inds,prim.mode));
        }
        if (!geo.getAttribute('normal')) geo.computeVertexNormals();
        geo.computeBoundingSphere();
        const mat = await materialFor(prim.material,!!geo.getAttribute('color'));
        const mesh = new THREE.Mesh(geo,mat);
        mesh.name = meshDef.name || 'ImportedPrimitive';
        mesh.castShadow = true; mesh.receiveShadow = true;
        group.add(mesh);
      }
      return group;
    }
    const nodeDefs = gltf.nodes || [];
    const nodeCache = new Map();
    async function buildNode(index) {
      if (nodeCache.has(index)) return nodeCache.get(index);
      const def = nodeDefs[index];
      if (!def) return new THREE.Group();
      const node = new THREE.Group(); node.name = def.name || `Node_${index}`;
      if (def.matrix && def.matrix.length === 16) {
        node.matrix.fromArray(def.matrix); node.matrixAutoUpdate = false;
      } else {
        if (def.translation) node.position.fromArray(def.translation);
        if (def.rotation) node.quaternion.fromArray(def.rotation);
        if (def.scale) node.scale.fromArray(def.scale);
      }
      nodeCache.set(index,node);
      if (def.mesh != null && meshDefs[def.mesh]) node.add(await createMesh(meshDefs[def.mesh],def.name));
      for (const ci of def.children || []) node.add(await buildNode(ci));
      return node;
    }
    const root = new THREE.Group(); root.name = file.name.replace(/\.(glb|gltf)$/i,'') || 'ImportedModel';
    const sceneDef = gltf.scenes && gltf.scenes[gltf.scene || 0];
    if (sceneDef && Array.isArray(sceneDef.nodes)) {
      for (const ni of sceneDef.nodes) root.add(await buildNode(ni));
    } else {
      const childSet = new Set(); for (const n of nodeDefs) for (const c of n.children || []) childSet.add(c);
      for (let i=0;i<nodeDefs.length;i++) if (!childSet.has(i)) root.add(await buildNode(i));
      if (!nodeDefs.length) for (const md of meshDefs) root.add(await createMesh(md,md.name));
    }
    root.updateMatrixWorld(true);
    return root;
  }

  function refreshModelList() {
    const select = $('[data-model-list]');
    select.innerHTML = '';
    if (!models.length) select.add(new Option('モデルなし',''));
    models.forEach((m,i) => select.add(new Option(`${i+1}. ${m.name}`,String(i))));
    select.value = selectedModel >= 0 ? String(selectedModel) : '';
    updateModelControls();
  }
  function selected() { return selectedModel >= 0 ? models[selectedModel] : null; }
  function updateModelControls() {
    const m = selected();
    for (const el of dock.querySelectorAll('[data-pos]')) el.disabled = !m;
    for (const el of dock.querySelectorAll('[data-action="duplicate-model"],[data-action="remove-model"]')) el.disabled = !m;
    if (!m) { $('[data-model-stats]').textContent = models.length ? 'モデルを選択してください。' : 'モデルはまだありません。'; return; }
    const g=m.group;
    $('[data-pos="x"]').value = g.position.x.toFixed(1);
    $('[data-pos="y"]').value = g.position.y.toFixed(1);
    $('[data-pos="z"]').value = g.position.z.toFixed(1);
    $('[data-pos="scale"]').value = g.scale.x.toFixed(3);
    $('[data-pos="yaw"]').value = (g.rotation.y*180/Math.PI).toFixed(1);
    g.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(g);
    const size = box.getSize(new THREE.Vector3());
    $('[data-model-stats]').textContent = `${m.name} ／ ${size.x.toFixed(1)} × ${size.y.toFixed(1)} × ${size.z.toFixed(1)}m`;
  }
  function applyModelInput() {
    const m=selected(); if (!m) return;
    const g=m.group;
    const num=(key)=>{const v=Number($(`[data-pos="${key}"]`).value);return Number.isFinite(v)?clamp(v,-100000,100000):0;};
    g.position.set(num('x'),num('y'),num('z'));
    const sc=clamp(Number($('[data-pos="scale"]').value)||1,.001,1000);
    g.scale.setScalar(sc);
    g.rotation.y=num('yaw')*Math.PI/180;
    g.updateMatrixWorld(true);
    updateModelControls();
  }
  async function importModels() {
    const files=Array.from(modelFile.files||[]);
    const primaries=files.filter(f=>/\.(glb|gltf)$/i.test(f.name));
    if (!primaries.length) throw new Error('GLBまたはglTFファイルを選択してください');
    for (const file of primaries) {
      const group=await loadGltf(file,files);
      group.position.set(0,0,0);
      group.scale.setScalar(1);
      api.scene3d.add(group);
      models.push({name:file.name,group,mainName:file.name,assets:files.slice()});
      selectedModel=models.length-1;
    }
    refreshModelList();
    status(`${primaries.length}個のモデルを読み込みました。X/Y/Zと倍率を調整し、「走行画面で確認」で表示を確認してください。`);
  }

  function exportDesignJSON() {
    const d=editor.design;
    if (!d || !Array.isArray(d.pts) || d.pts.length<2) throw new Error('保存するコースがありません');
    const payload={format:'coaster-expansion-design',version:1,exportedAt:new Date().toISOString(),design:d};
    const text=JSON.stringify(payload,null,2);
    download(new Blob([text],{type:'application/json'}),`coaster_design_${Date.now()}.json`);
    status(`設計JSONを出力しました（${text.length.toLocaleString()}文字）。`);
  }
  const crcTable = (() => {
    const t = new Uint32Array(256);
    for (let n=0;n<256;n++) { let c=n; for(let k=0;k<8;k++) c=(c&1)?(0xedb88320^(c>>>1)):(c>>>1); t[n]=c>>>0; }
    return t;
  })();
  function crc32(bytes) { let c=0xffffffff; for(const b of bytes)c=crcTable[(c^b)&255]^(c>>>8); return (c^0xffffffff)>>>0; }
  function u16(v) { return [v&255,(v>>>8)&255]; }
  function u32(v) { return [v&255,(v>>>8)&255,(v>>>16)&255,(v>>>24)&255]; }
  function concatBytes(parts) { const n=parts.reduce((a,b)=>a+b.length,0), out=new Uint8Array(n); let o=0; for(const b of parts){out.set(b,o);o+=b.length;} return out; }
  async function makeStoreZip(entries) {
    const enc=new TextEncoder(), local=[], central=[]; let offset=0;
    for(const entry of entries){
      const name=enc.encode(entry.name.replace(/\\/g,'/'));
      const data=entry.data instanceof Uint8Array?entry.data:new Uint8Array(entry.data);
      const crc=crc32(data), size=data.length;
      const lh=concatBytes([new Uint8Array([0x50,0x4b,0x03,0x04]),new Uint8Array(u16(20)),new Uint8Array(u16(0x0800)),new Uint8Array(u16(0)),new Uint8Array(u16(0)),new Uint8Array(u16(0)),new Uint8Array(u32(crc)),new Uint8Array(u32(size)),new Uint8Array(u32(size)),new Uint8Array(u16(name.length)),new Uint8Array(u16(0)),name,data]);
      local.push(lh);
      const ch=concatBytes([new Uint8Array([0x50,0x4b,0x01,0x02]),new Uint8Array(u16(20)),new Uint8Array(u16(20)),new Uint8Array(u16(0x0800)),new Uint8Array(u16(0)),new Uint8Array(u16(0)),new Uint8Array(u16(0)),new Uint8Array(u32(crc)),new Uint8Array(u32(size)),new Uint8Array(u32(size)),new Uint8Array(u16(name.length)),new Uint8Array(u16(0)),new Uint8Array(u16(0)),new Uint8Array(u16(0)),new Uint8Array(u16(0)),new Uint8Array(u32(0)),new Uint8Array(u32(offset)),name]);
      central.push(ch); offset+=lh.length;
    }
    const cd=concatBytes(central), body=concatBytes(local);
    const end=concatBytes([new Uint8Array([0x50,0x4b,0x05,0x06]),new Uint8Array(u16(0)),new Uint8Array(u16(0)),new Uint8Array(u16(entries.length)),new Uint8Array(u16(entries.length)),new Uint8Array(u32(cd.length)),new Uint8Array(u32(body.length)),new Uint8Array(u16(0))]);
    return concatBytes([body,cd,end]);
  }
  async function readProjectZip(file) {
    const bytes=new Uint8Array(await file.arrayBuffer()), dv=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    let eocd=-1; for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--) if(dv.getUint32(i,true)===0x06054b50){eocd=i;break;}
    if(eocd<0) throw new Error('ZIPの終了情報が見つかりません');
    const count=dv.getUint16(eocd+10,true), cdOffset=dv.getUint32(eocd+16,true);
    if(count>1000) throw new Error('ZIP内のファイル数が多すぎます');
    if(cdOffset>eocd || cdOffset<0) throw new Error('ZIPの目次位置が不正です');
    const decoder=new TextDecoder(), files=new Map(); let pos=cdOffset, totalSize=0;
    for(let i=0;i<count;i++){
      if(pos+46>bytes.length || dv.getUint32(pos,true)!==0x02014b50) throw new Error('ZIPの目次が不正です');
      const method=dv.getUint16(pos+10,true), expectedCrc=dv.getUint32(pos+16,true), compressed=dv.getUint32(pos+20,true), size=dv.getUint32(pos+24,true);
      const nameLen=dv.getUint16(pos+28,true), extraLen=dv.getUint16(pos+30,true), commentLen=dv.getUint16(pos+32,true), localOffset=dv.getUint32(pos+42,true);
      if(pos+46+nameLen+extraLen+commentLen>bytes.length) throw new Error('ZIPのファイル名または目次データが途中で終わっています');
      const name=decoder.decode(bytes.slice(pos+46,pos+46+nameLen));
      if(!name || name.startsWith('/') || name.includes('\\') || name.split('/').includes('..')) throw new Error('ZIP内に不正なパスがあります');
      if(size>250*1024*1024) throw new Error('ZIP内に250MBを超えるファイルがあります');
      totalSize+=size; if(totalSize>500*1024*1024) throw new Error('ZIPの展開サイズが500MBを超えています');
      if(localOffset+30>bytes.length || dv.getUint32(localOffset,true)!==0x04034b50) throw new Error('ZIPのデータ領域が不正です');
      const ln=dv.getUint16(localOffset+26,true), le=dv.getUint16(localOffset+28,true), dataStart=localOffset+30+ln+le;
      if(dataStart+compressed>bytes.length) throw new Error('ZIP内のファイルデータが途中で終わっています');
      let data=bytes.slice(dataStart,dataStart+compressed);
      if(method===8){
        if(typeof DecompressionStream==='undefined') throw new Error('圧縮ZIPはこのブラウザで解凍できません。ゲームから保存したZIPを使用してください');
        const ds=new DecompressionStream('deflate-raw');
        data=new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(ds)).arrayBuffer());
      } else if(method!==0) throw new Error(`ZIP圧縮方式 ${method} は未対応です`);
      if(data.length!==size) throw new Error(`ZIP内ファイルのサイズが一致しません: ${name}`);
      if(crc32(data)!==expectedCrc) throw new Error(`ZIP内ファイルの検査に失敗しました: ${name}`);
      if(files.has(name)) throw new Error(`ZIP内に同じファイル名が重複しています: ${name}`);
      files.set(name,data);
      pos+=46+nameLen+extraLen+commentLen;
    }
    return files;
  }
  async function exportProjectZip() {
    const d=editor.design;
    if(!d||!Array.isArray(d.pts)||d.pts.length<2) throw new Error('保存するコースがありません');
    const entries=[], modelData=[], assetCache=new Map();
    for(let i=0;i<models.length;i++){
      const m=models[i], assets=Array.isArray(m.assets)?m.assets:[];
      if(!assets.length) throw new Error(`${m.name}: 元モデルのファイル情報がありません。モデルをもう一度読み込んでください`);
      const assetRefs=[];
      for(let j=0;j<assets.length;j++){
        const f=assets[j], bytes=new Uint8Array(await f.arrayBuffer());
        const key=`${f.name}|${bytes.length}|${crc32(bytes)}`;
        let path=assetCache.get(key);
        if(!path){path=`assets/file_${assetCache.size}/${safeName(f.name)}`;assetCache.set(key,path);entries.push({name:path,data:bytes});}
        assetRefs.push({name:f.name,path});
      }
      const g=m.group;
      modelData.push({name:m.name,mainName:m.mainName||m.name,assets:assetRefs,transform:{position:g.position.toArray(),rotation:g.rotation.toArray(),scale:g.scale.toArray()}});
    }
    const payload={format:'coaster-expansion-project',version:4,createdAt:new Date().toISOString(),design:d,models:modelData,architecture:architecturePack.serialize(),city:cityFlightPack.serialize()};
    entries.unshift({name:'project.json',data:new TextEncoder().encode(JSON.stringify(payload,null,2))});
    const zip=await makeStoreZip(entries);
    download(new Blob([zip],{type:'application/zip'}),`coaster_project_${Date.now()}.zip`);
    const cityInfo=cityFlightPack.serialize();
    status(`プロジェクトZIPを保存しました。コース＋モデル${models.length}個＋都市街区${cityInfo?`${cityInfo.buildings}棟の設定`:'なし'}／合計 ${(zip.length/1024/1024).toFixed(1)}MB`);
  }
  async function importProjectZip() {
    const file=$('[data-project-file]').files&&$('[data-project-file]').files[0];
    if(!file) throw new Error('プロジェクトZIPを選択してください');
    const archive=await readProjectZip(file), raw=archive.get('project.json');
    if(!raw) throw new Error('project.json がありません。このZIPは対応プロジェクトではありません');
    const payload=JSON.parse(new TextDecoder().decode(raw));
    if(payload.format!=='coaster-expansion-project'||![2,3,4].includes(payload.version)) throw new Error('対応していないプロジェクト形式です');
    const d=payload.design;
    if(!d||!Array.isArray(d.pts)||d.pts.length<2||d.pts.length>8192) throw new Error('コース設計データが不正です');
    for(const p of d.pts) if(!Array.isArray(p)||!Number.isFinite(p[0])||!Number.isFinite(p[1])||p[0]<FIELD.x0||p[0]>FIELD.x1||p[1]<FIELD.z0||p[1]>FIELD.z1) throw new Error('敷地外の座標が含まれています');
    const nd=api.normalize?api.normalize(d):d;
    if(!nd) throw new Error('コース設計を現在のゲーム形式に変換できません');
    const pending=[];
    for(const item of payload.models||[]){
      const files=(item.assets||[]).map(a=>{
        const b=archive.get(a.path); if(!b) throw new Error(`モデル素材がありません: ${a.path}`);
        const ext=a.name.toLowerCase().split('.').pop();
        const mime=({png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',gif:'image/gif',svg:'image/svg+xml',glb:'model/gltf-binary',gltf:'model/gltf+json',bin:'application/octet-stream'})[ext]||'application/octet-stream';
        return new File([b],a.name,{type:mime});
      });
      const main=files.find(f=>f.name===item.mainName)||files.find(f=>/\.(glb|gltf)$/i.test(f.name));
      if(!main) throw new Error(`${item.name}: GLB/glTF本体が見つかりません`);
      const group=await loadGltf(main,files);
      const t=item.transform||{};
      if(Array.isArray(t.position)) group.position.fromArray(t.position);
      if(Array.isArray(t.rotation)) group.rotation.fromArray(t.rotation);
      if(Array.isArray(t.scale)) group.scale.fromArray(t.scale);
      pending.push({name:item.name||main.name,group,mainName:main.name,assets:files});
    }
    // すべて読み込めた後に一括で差し替える。途中失敗で元モデルを消さない。
    for(const m of models) api.scene3d.remove(m.group);
    models.splice(0,models.length,...pending);
    for(const m of models) api.scene3d.add(m.group);
    selectedModel=models.length?0:-1;
    architecturePack.restore(payload.version>=3 ? (payload.architecture||[]) : []);
    editor.open(nd,1); editor.fitMapView(); editor.onChange&&editor.onChange();
    cityFlightPack.restore(payload.version>=4 ? (payload.city||null) : null);
    refreshModelList();
    status(`プロジェクトを読み込みました。モデル ${models.length}個／コース ${Math.round(polyLen(nd.pts)).toLocaleString()}m`);
  }

  async function importDesignJSON() {
    const file=$('[data-json-file]').files && $('[data-json-file]').files[0];
    if (!file) throw new Error('JSONファイルを選択してください');
    const payload=JSON.parse(await file.text());
    const d=payload.design || payload;
    if (!d || !Array.isArray(d.pts) || d.pts.length<2 || d.pts.length>8192) throw new Error('設計データの形式または点数が不正です');
    for (const p of d.pts) if (!Array.isArray(p)||!Number.isFinite(p[0])||!Number.isFinite(p[1])||p[0]<FIELD.x0||p[0]>FIELD.x1||p[1]<FIELD.z0||p[1]>FIELD.z1) throw new Error('敷地外または不正な座標が含まれています');
    const nd=api.normalize ? api.normalize(d) : d;
    if (!nd) throw new Error('この設計データを読み込めませんでした');
    editor.open(nd, 1);
    editor.fitMapView();
    editor.onChange && editor.onChange();
    status('設計JSONを読み込みました。');
  }

  function flattenMeshes(source) {
    const out=[],seen=new Set();
    const push=(o)=>{ if(!o||seen.has(o))return; seen.add(o); if(o.isMesh&&o.geometry&&o.geometry.attributes&&o.geometry.attributes.position){out.push(o);return;} if(o.traverse)o.traverse(c=>{if(c&&c.isMesh&&c.geometry&&c.geometry.attributes&&c.geometry.attributes.position&&!seen.has(c)){seen.add(c);out.push(c);}}); };
    if (Array.isArray(source)) source.forEach(push); else push(source);
    return out;
  }
  async function canvasImageBytes(texture) {
    if(!texture||!texture.image) return null;
    const image=texture.image;
    const width=image.naturalWidth||image.videoWidth||image.width||0;
    const height=image.naturalHeight||image.videoHeight||image.height||0;
    if(!width||!height) return null;
    const canvas=document.createElement('canvas'); canvas.width=width; canvas.height=height;
    const ctx=canvas.getContext('2d');
    try {
      ctx.drawImage(image,0,0,width,height);
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
      return blob?new Uint8Array(await blob.arrayBuffer()):null;
    } catch(e) { return null; }
  }
  async function exportGLB(sourceMeshes) {
    const json={asset:{version:'2.0',generator:'Coaster Expansion 2.0'},scene:0,scenes:[{nodes:[]}],nodes:[],meshes:[],materials:[],textures:[],images:[],samplers:[{magFilter:9729,minFilter:9987,wrapS:10497,wrapT:10497}],accessors:[],bufferViews:[],buffers:[{byteLength:0}]};
    const chunks=[]; let byteLength=0; const matCache=new Map(), textureCache=new Map();
    const append=(typed)=>{const b=typed instanceof Uint8Array?typed:new Uint8Array(typed.buffer,typed.byteOffset,typed.byteLength);const pad=(4-byteLength%4)%4;if(pad){chunks.push(new Uint8Array(pad));byteLength+=pad;}const at=byteLength;const cp=new Uint8Array(b.length);cp.set(b);chunks.push(cp);byteLength+=cp.length;return {offset:at,length:cp.length};};
    const accessor=(values,type,target,minMax)=>{const a=values instanceof Float32Array?values:new Float32Array(values);const part=append(a);const vi=json.bufferViews.length;json.bufferViews.push({buffer:0,byteOffset:part.offset,byteLength:part.length,target});const count=type==='VEC4'?4:type==='VEC3'?3:type==='VEC2'?2:1;const ac={bufferView:vi,byteOffset:0,componentType:5126,count:a.length/count,type};if(minMax){ac.min=minMax.min;ac.max=minMax.max;}const id=json.accessors.length;json.accessors.push(ac);return id;};
    const addTexture=async(tex)=>{
      if(!tex||!tex.image) return null;
      if(textureCache.has(tex)) return textureCache.get(tex);
      const task=(async()=>{
        const bytes=await canvasImageBytes(tex); if(!bytes) return null;
        const part=append(bytes), view=json.bufferViews.length;
        json.bufferViews.push({buffer:0,byteOffset:part.offset,byteLength:part.length});
        const image=json.images.length; json.images.push({name:'BaseColorTexture',bufferView:view,mimeType:'image/png'});
        const ti=json.textures.length; json.textures.push({sampler:0,source:image}); return ti;
      })();
      textureCache.set(tex,task); return task;
    };
    const addMat=async(m)=>{
      if(!m) return null;
      if(matCache.has(m)) return matCache.get(m);
      const task=(async()=>{
        const c=m.color||{r:.72,g:.76,b:.8},e=m.emissive||{r:0,g:0,b:0};
        const pbr={baseColorFactor:[c.r??.72,c.g??.76,c.b??.8,m.opacity==null?1:m.opacity],metallicFactor:Number.isFinite(m.metalness)?m.metalness:0,roughnessFactor:Number.isFinite(m.roughness)?m.roughness:1};
        const tex=await addTexture(m.map); if(tex!=null)pbr.baseColorTexture={index:tex};
        const out={name:m.name||`Material_${json.materials.length}`,pbrMetallicRoughness:pbr};
        if(e.r||e.g||e.b)out.emissiveFactor=[e.r||0,e.g||0,e.b||0];
        if(m.transparent||(m.opacity!=null&&m.opacity<1))out.alphaMode='BLEND';else if(m.alphaTest>0){out.alphaMode='MASK';out.alphaCutoff=m.alphaTest;}
        if(m.side===THREE.DoubleSide)out.doubleSided=true;
        const i=json.materials.length;json.materials.push(out);return i;
      })();
      matCache.set(m,task); return task;
    };
    let nmesh=0,nprim=0,skipped=0;
    for(const obj of sourceMeshes){
      if(!obj.geometry||obj.isSkinnedMesh||obj.isInstancedMesh){skipped++;continue;}
      const geo=obj.geometry,pos=geo.attributes.position;if(!pos||pos.count<3){skipped++;continue;}
      obj.updateWorldMatrix(true,false);
      const total=geo.index?geo.index.count:pos.count;
      const start=Math.max(0,geo.drawRange&&Number.isFinite(geo.drawRange.start)?geo.drawRange.start:0);
      const count=geo.drawRange&&Number.isFinite(geo.drawRange.count)?geo.drawRange.count:total;
      const end=Math.min(total,start+count);
      const groups=geo.groups&&geo.groups.length?geo.groups:[{start:0,count:total,materialIndex:0}];
      const mats=Array.isArray(obj.material)?obj.material:[obj.material],primitives=[];
      for(const g of groups){
        const a=Math.max(start,g.start||0),b=Math.min(end,(g.start||0)+(Number.isFinite(g.count)?g.count:total));
        const usable=Math.max(0,b-a)-((Math.max(0,b-a))%3);if(usable<3)continue;
        const ids=new Array(usable);for(let i=0;i<usable;i++)ids[i]=geo.index?geo.index.getX(a+i):a+i;
        const attrs={};
        for(const [sn,gn,minSize] of [['position','POSITION',3],['normal','NORMAL',3],['uv','TEXCOORD_0',2],['color','COLOR_0',3]]){
          const at=geo.attributes[sn];if(!at||at.itemSize<minSize)continue;
          const size=gn==='COLOR_0'&&at.itemSize>=4?4:minSize,vals=new Float32Array(ids.length*size);
          for(let i=0;i<ids.length;i++){const j=ids[i];vals[i*size]=at.getX(j);if(size>1)vals[i*size+1]=at.getY(j);if(size>2)vals[i*size+2]=at.getZ(j);if(size>3)vals[i*size+3]=at.getW(j);}
          let mm=null;if(gn==='POSITION'){const mn=[Infinity,Infinity,Infinity],mx=[-Infinity,-Infinity,-Infinity];for(let i=0;i<vals.length;i+=3)for(let k=0;k<3;k++){mn[k]=Math.min(mn[k],vals[i+k]);mx[k]=Math.max(mx[k],vals[i+k]);}mm={min:mn,max:mx};}
          attrs[gn]=accessor(vals,size===4?'VEC4':size===3?'VEC3':'VEC2',34962,mm);
        }
        if(attrs.POSITION==null)continue;
        const mat=mats[g.materialIndex||0],prim={attributes:attrs,mode:4};
        if(mat){const mi=await addMat(mat);if(mi!=null)prim.material=mi;}
        primitives.push(prim);
      }
      if(!primitives.length){skipped++;continue;}
      const mi=json.meshes.length;json.meshes.push({name:obj.name||`Mesh_${mi}`,primitives});
      const node={name:obj.name||`Node_${mi}`,mesh:mi,matrix:Array.from(obj.matrixWorld.elements)};
      json.nodes.push(node);json.scenes[0].nodes.push(json.nodes.length-1);nmesh++;nprim+=primitives.length;
    }
    if(!nmesh)throw new Error('GLB化できるメッシュがありません。コースを作成し、モデルを読み込んでください。');
    while(byteLength%4){chunks.push(new Uint8Array(1));byteLength++;}
    json.buffers[0].byteLength=byteLength;
    const jr=new TextEncoder().encode(JSON.stringify(json)),jp=(4-jr.length%4)%4,jb=new Uint8Array(jr.length+jp);jb.fill(0x20);jb.set(jr);
    const bin=new Uint8Array(byteLength);let cur=0;for(const c of chunks){bin.set(c,cur);cur+=c.length;}
    const total=12+8+jb.length+8+bin.length,out=new ArrayBuffer(total),dv=new DataView(out);let o=0;
    dv.setUint32(o,0x46546c67,true);o+=4;dv.setUint32(o,2,true);o+=4;dv.setUint32(o,total,true);o+=4;
    dv.setUint32(o,jb.length,true);o+=4;dv.setUint32(o,0x4e4f534a,true);o+=4;new Uint8Array(out,o,jb.length).set(jb);o+=jb.length;
    dv.setUint32(o,bin.length,true);o+=4;dv.setUint32(o,0x004e4942,true);o+=4;new Uint8Array(out,o,bin.length).set(bin);
    download(new Blob([out],{type:'model/gltf-binary'}),`coaster_scene_${Date.now()}.glb`);
    return {meshes:nmesh,primitives:nprim,skipped,bytes:total,textures:json.textures.length};
  }

  function setTab(tab) {
    activeTab=tab;
    dock.querySelectorAll('[data-tab]').forEach(b=>{const on=b.dataset.tab===tab;b.setAttribute('aria-selected',String(on));b.classList.toggle('on',on);});
    dock.querySelectorAll('[data-panel]').forEach(p=>p.hidden=p.dataset.panel!==tab);
  }
  dock.addEventListener('click',async(event)=>{
    const tab=event.target.closest('[data-tab]');if(tab){setTab(tab.dataset.tab);return;}
    const btn=event.target.closest('button[data-action]');if(!btn)return;
    btn.disabled=true;
    try{
      const a=btn.dataset.action;
      if(a==='preset')applyPreset();
      else if(a==='smooth')smoothCurrentTrack();
      else if(a==='fit')editor.fitMapView();
      else if(a==='fit-field'){editor.mapView={cx:0,cz:0,zoom:0.105};editor.draw();}
      else if(a==='import-model')await importModels();
      else if(a==='preview'){if(!editor.design||!editor.design.pts||editor.design.pts.length<2)throw new Error('先にコースを作成してください');editor.btnRun.click();}
      else if(a==='duplicate-model'){
        const m=selected();if(!m)throw new Error('複製するモデルを選択してください');const g=m.group.clone(true);g.position.x+=8;api.scene3d.add(g);models.push({name:m.name+' copy',group:g,mainName:m.mainName,assets:m.assets});selectedModel=models.length-1;refreshModelList();status('モデルを複製しました。');
      }else if(a==='remove-model'){
        const m=selected();if(!m)throw new Error('削除するモデルを選択してください');api.scene3d.remove(m.group);models.splice(selectedModel,1);selectedModel=models.length?Math.min(selectedModel,models.length-1):-1;refreshModelList();status('選択モデルを削除しました。');
      }else if(a==='clear-models'){
        for(const m of models)api.scene3d.remove(m.group);models.length=0;selectedModel=-1;refreshModelList();status('配置モデルをすべて削除しました。');
      }else if(a==='ground-model'){
        const m=selected();if(!m)throw new Error('モデルを選択してください');m.group.updateMatrixWorld(true);const box=new THREE.Box3().setFromObject(m.group);if(!Number.isFinite(box.min.y))throw new Error('モデルの高さを取得できません');m.group.position.y-=box.min.y;updateModelControls();status('モデルの底面を地面（Y=0）に合わせました。');
      }else if(a==='save-local'){
        editor.onChange&&editor.onChange();status('コース設計をゲーム内保存しました。モデル本体はプロジェクトZIPで保存してください。');
      }else if(a==='export-json')exportDesignJSON();
      else if(a==='import-json')await importDesignJSON();
      else if(a==='project-save')await exportProjectZip();
      else if(a==='project-load')await importProjectZip();
      else if(a==='export-glb'){
        if(typeof api.createTrackExportGroup!=='function')throw new Error('現在のゲーム本体にGLB出力APIがありません');
        const built=api.createTrackExportGroup(editor.design);
        try{
          const sources=[built.group,...models.map(m=>m.group)];
          const meshes=flattenMeshes(sources);const res=await exportGLB(meshes);
          status(`GLB出力完了：メッシュ ${res.meshes}個／プリミティブ ${res.primitives}個／テクスチャ ${res.textures}枚／${(res.bytes/1024/1024).toFixed(2)}MB`);
        }finally{built.group.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material){const ms=Array.isArray(o.material)?o.material:[o.material];ms.forEach(m=>m.dispose&&m.dispose());}});}
      } else if (a === 'alt-preset') {
        applyPeak(Number(btn.dataset.value));
      } else if (a === 'alt-exact') {
        applyPeak(Number($('[data-alt-target]').value));
      } else if (a === 'alt-scale') {
        const factor = clamp(Number($('[data-alt-scale]').value) || 1, 0.1, 20);
        editDesign(`高さを最低地点基準で ${factor.toFixed(2)} 倍にしました。`, d => {
          const hs = readHeights(d), base = Math.min(...hs);
          d.hs = hs.map(h => Math.max(2, base + (h - base) * factor));
        });
        $('[data-alt-target]').value = String(Math.round(Math.max(...readHeights(editor.design))));
      } else if (a === 'alt-offset') {
        const offset = clamp(Number($('[data-alt-offset]').value) || 0, -10000, 10000);
        editDesign(`山の中央部を ${offset >= 0 ? '+' : ''}${offset}m 移動しました。`, d => {
          const hs = readHeights(d);
          d.hs = hs.map((h, i) => Math.max(2, h + offset * Math.pow(Math.sin(Math.PI * i / (HEIGHT_COUNT - 1)), 2)));
        });
      } else if (a === 'alt-reverse') {
        editDesign('山と谷の高低を反転しました。', d => {
          const hs = readHeights(d), lo = Math.min(...hs), hi = Math.max(...hs);
          d.hs = hs.map((h, i) => {
            const u = i / (HEIGHT_COUNT - 1), edge = Math.pow(Math.sin(Math.PI * u), 0.6);
            return Math.max(2, hs[i] * (1 - edge) + (lo + hi - h) * edge);
          });
        });
      } else if (a === 'alt-smooth') {
        editDesign('高さプロファイルを5点移動平均で平滑化しました。', d => {
          const hs = readHeights(d);
          d.hs = hs.map((_, i) => {
            let sum = 0, n = 0;
            for (let k = -2; k <= 2; k++) { const j = clamp(i + k, 0, hs.length - 1); sum += hs[j]; n++; }
            return sum / n;
          });
        });
      } else if (a === 'alt-grade') {
        const grade = clamp(Number($('[data-alt-grade]').value) || 40, 1, 100);
        editDesign(`最大勾配を約${grade}%以内に整えました（端点は維持）。`, d => {
          const hs = readHeights(d);
          const routeLength = editor.preview && editor.preview.Lf || polyLen(d.pts);
          const maxDelta = grade / 100 * routeLength / (HEIGHT_COUNT - 1);
          for (let pass = 0; pass < 5; pass++) {
            for (let i = 1; i < hs.length; i++) hs[i] = clamp(hs[i], hs[i - 1] - maxDelta, hs[i - 1] + maxDelta);
            for (let i = hs.length - 2; i >= 0; i--) hs[i] = clamp(hs[i], hs[i + 1] - maxDelta, hs[i + 1] + maxDelta);
          }
          d.hs = hs.map(h => Math.max(2, h));
        });
      } else if (a === 'alt-waves') {
        const peaks = clamp(Number($('[data-alt-peaks]').value) || 3, 2, 6);
        const height = clamp(Number($('[data-alt-target]').value) || 600, 10, 100000);
        editDesign(`${peaks}峰の連続コースターを生成しました（最高約${Math.round(height)}m）。`, d => {
          const raw = Array.from({ length: HEIGHT_COUNT }, (_, i) => {
            const u = i / (HEIGHT_COUNT - 1);
            let wave = 0;
            for (let k = 0; k < peaks; k++) {
              const center = 0.12 + (0.76 * k / Math.max(1, peaks - 1));
              const width = 0.12 + 0.025 * (k % 2);
              wave = Math.max(wave, Math.exp(-Math.pow((u - center) / width, 2)));
            }
            return 2 + (height - 2) * wave;
          });
          d.hs = raw;
        });
      } else if (a === 'alt-drop') {
        const height = clamp(Number($('[data-alt-target]').value) || 600, 10, 100000);
        editDesign(`最高約${Math.round(height)}mの巨大ドロップを生成しました。`, d => {
          d.hs = Array.from({ length: HEIGHT_COUNT }, (_, i) => {
            const u = i / (HEIGHT_COUNT - 1);
            const climb = smooth01((u - 0.04) / 0.28);
            const fall = 1 - smooth01((u - 0.49) / 0.16);
            return 2 + (height - 2) * climb * fall;
          });
        });
      } else if (a === 'alt-plateau') {
        const height = clamp(Number($('[data-alt-target]').value) || 600, 10, 100000);
        editDesign(`高度約${Math.round(height)}mの空中高原を生成しました。`, d => {
          d.hs = Array.from({ length: HEIGHT_COUNT }, (_, i) => {
            const u = i / (HEIGHT_COUNT - 1);
            const rise = smooth01((u - 0.06) / 0.2);
            const fall = smooth01((0.94 - u) / 0.2);
            return 2 + (height - 2) * Math.min(rise, fall);
          });
        });
      } else if (a === 'mirror-x' || a === 'mirror-z') {
        const d = requireDesign(true), xs = d.pts.map(p => p[0]), zs = d.pts.map(p => p[1]);
        const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2;
        transformPath((x, z) => a === 'mirror-x' ? [2 * cx - x, z] : [x, 2 * cz - z], a === 'mirror-x' ? 'コースを左右反転しました。' : 'コースを前後反転しました。');
      } else if (a === 'path-rotate') {
        const deg = clamp(Number($('[data-path-rotation]').value) || 0, -3600, 3600), rad = deg * Math.PI / 180;
        const d = requireDesign(true), cx = d.pts.reduce((v,p)=>v+p[0],0)/d.pts.length, cz = d.pts.reduce((v,p)=>v+p[1],0)/d.pts.length;
        transformPath((x,z) => { const dx=x-cx,dz=z-cz; return [cx+dx*Math.cos(rad)-dz*Math.sin(rad),cz+dx*Math.sin(rad)+dz*Math.cos(rad)]; }, `${deg}°回転しました。`);
      } else if (a === 'path-scale') {
        const factor = clamp(Number($('[data-path-scale]').value) || 1, 0.1, 4);
        const d = requireDesign(true), cx = d.pts.reduce((v,p)=>v+p[0],0)/d.pts.length, cz = d.pts.reduce((v,p)=>v+p[1],0)/d.pts.length;
        transformPath((x,z) => [cx+(x-cx)*factor, cz+(z-cz)*factor], `コース平面を ${factor.toFixed(2)} 倍に変更しました。`);
      } else if (a === 'path-x' || a === 'path-z') {
        const delta = clamp(Number($(a === 'path-x' ? '[data-path-x]' : '[data-path-z]').value) || 0, -600, 600);
        transformPath((x,z) => a === 'path-x' ? [x+delta,z] : [x,z+delta], `${a === 'path-x' ? 'X' : 'Z'}方向へ ${delta}m 移動しました。`);
      } else if (a === 'path-simplify') {
        const tolerance = clamp(Number($('[data-path-tolerance]').value) || 1, 0.1, 20);
        editDesign('コースの制御点を最適化しました。', d => {
          const before = d.pts.length, next = simplifyPath(d.pts, tolerance);
          if (next.length < 2) throw new Error('最適化後のコース点が不足します');
          d.pts = next;
          d._simplifyMessage = `${before}点 → ${next.length}点`;
        }, true);
        const pts = editor.design.pts.length;
        status(`制御点を ${pts.toLocaleString()} 点に最適化しました。`);
      } else if (a === 'random-course') {
        const kind = clamp(Number($('[data-random-kind]').value) || 0, 0, 8);
        const raw = randomStroke((presetSeed += 101), kind, 0);
        const xs = raw.map(p=>p[0]), zs = raw.map(p=>p[1]);
        const spanX = Math.max(1,Math.max(...xs)-Math.min(...xs)), spanZ = Math.max(1,Math.max(...zs)-Math.min(...zs));
        const factor = Math.min(2.6,(FIELD.x1-FIELD.x0-60)/spanX,(FIELD.z1-FIELD.z0-60)/spanZ);
        let pts = raw.map(([x,z])=>[(x-(Math.min(...xs)+Math.max(...xs))/2)*factor+18,(z-(Math.min(...zs)+Math.max(...zs))/2)*factor+38]);
        const length = polyLen(pts);
        if (length > MAX_LEN) { const f = MAX_LEN / length * 0.97, ox=pts[0][0],oz=pts[0][1]; pts=pts.map(([x,z])=>[ox+(x-ox)*f,oz+(z-oz)*f]); }
        editor.record(); editor.design.pts=pts; editor.design.hs=null; editor.design.gm=[];
        refreshEditedDesign('ランダム形状の別案を生成しました。', true);
      } else if (a === 'analyze-stats') {
        const s = getDesignStats();
        report(`全長 ${s.length.toFixed(1)}m
平面サイズ ${s.width.toFixed(1)} × ${s.depth.toFixed(1)}m
高さ ${s.minH.toFixed(1)}～${s.maxH.toFixed(1)}m／落差 ${s.drop.toFixed(1)}m
登り合計 ${s.climb.toFixed(1)}m／下り合計 ${s.descent.toFixed(1)}m
最大勾配 ${s.maxGrade.toFixed(1)}%／制御点 ${s.points}
支柱 ${s.supports == null ? '未計算' : s.supports}本／交差 ${s.clashes == null ? '未計算' : s.clashes}か所`);
        status('コース諸元の分析が完了しました。');
      } else if (a === 'analyze-clashes') {
        const d = requireDesign(true);
        if (!editor.preview || !editor.preview.tr) editor.refresh(true);
        const tr = editor.preview && editor.preview.tr;
        if (!tr) throw new Error('線路データを生成できませんでした');
        const ids = (tr.clashes || []).slice(0, 12);
        const lines = ids.map(i => `${i}: X${tr.px[i].toFixed(1)} / Y${tr.py[i].toFixed(1)} / Z${tr.pz[i].toFixed(1)}`);
        report(ids.length ? `交差・接近箇所 ${tr.clashes.length}件（先頭12件）\n${lines.join('\n')}` : '交差・接近は検出されませんでした。');
        status(`交差・接近検査完了：${tr.clashes.length}件`);
      } else if (a === 'analyze-physics') {
        await runPhysicsReport();
      } else if (a === 'show-ride-deck') {
        rideDeckManuallyHidden = false; rideDeck.hidden = false;
        status(api.mode === 'ride' || api.mode === 'result' ? '走行パネルを表示しました。' : '走行を開始するとライブ計器が表示されます。');
      } else if (a === 'show-records') {
        updateRecordReport();
        report(formatRecordReport());
        status('自己ベストと走行記録を表示しました。');
      } else if (a === 'new-challenge') {
        const c = getChallenge(true); updateRecordReport();
        rideDeck.querySelector('[data-rd-challenge]').textContent = `新しいミッション：${c.label}`;
        report(`新しいミッション：${c.title}
達成条件：${c.label}`);
        status(`新しいミッション「${c.title}」を設定しました。`);
      }
    }catch(e){console.error('[Coaster Expansion]',e);status(`エラー：${e&&e.message?e.message:e}`,true);}
    finally{btn.disabled=false;}
  });
  dock.addEventListener('change',(e)=>{
    if(e.target.matches('[data-model-list]')){selectedModel=e.target.value===''?-1:Number(e.target.value);updateModelControls();}
    else if(e.target.matches('[data-pos]'))applyModelInput();
    else if(e.target.matches('[data-model-file]')){const f=Array.from(e.target.files||[]);if(f.length)status(`${f.length}個のファイルを選択中。モデル読込を押してください。`);}
    else if(e.target.matches('[data-json-file]')&&e.target.files.length)status(`設計JSONを選択しました：${e.target.files[0].name}`);
    else if(e.target.matches('[data-project-file]')&&e.target.files.length)status(`プロジェクトZIPを選択しました：${e.target.files[0].name}`);
  });

  const originalBuildToolsForDestroy=originalBuildTools;
  updateTrackStats();
  refreshModelList();
  setTab('course');
  mountNativeUI();

  api.expansion={
    version:'7.0',models,architecture:architecturePack,cityFlight:cityFlightPack,
    exportGLB:async()=>{
      if(typeof api.createTrackExportGroup!=='function')throw new Error('GLB出力APIがありません');
      const built=api.createTrackExportGroup(editor.design);
      try{return await exportGLB(flattenMeshes([built.group,...models.map(m=>m.group),...architecturePack.getMeshes(),...cityFlightPack.getMeshes()]));}
      finally{built.group.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material){const ms=Array.isArray(o.material)?o.material:[o.material];ms.forEach(m=>m.dispose&&m.dispose());}});}
    },
    destroy(){
      clearInterval(ridePoll);
      architecturePack.destroy();
      cityFlightPack.destroy();
      rideDeck.remove();
      dock.remove();style.remove();editor.onChange=oldOnChange;
      editor.buildTools=originalBuildToolsForDestroy;
      editor.open=oldOpen;
      delete api.expansion;
    }
  };
  return api.expansion;
}
