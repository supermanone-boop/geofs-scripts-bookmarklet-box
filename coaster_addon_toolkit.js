/*
 * Coaster Addon Toolkit v0.1
 * Target: games.it-monozukuri.com/coaster/
 * Install: paste this file's contents into the browser DevTools Console.
 *
 * v0.1 features:
 * - Runtime/API inspection
 * - Coaster mesh inventory + world-space bounds
 * - Export current coaster mesh collection (co.meshes) to GLB 2.0
 * - Export editor design data to JSON
 *
 * Notes:
 * - Requires the game's optional window.__rc debug API.
 * - The GLB exporter writes geometry + basic PBR material values. Texture maps,
 *   skinned meshes, morph targets and instanced meshes are not included yet.
 * - This does not alter the simulation or bypass editor/build-area restrictions.
 */
(() => {
  'use strict';

  const VERSION = '0.1.0';
  const ROOT_ID = 'coaster-addon-toolkit-root';
  const OLD = window.CoasterAddonToolkit;
  if (OLD && typeof OLD.destroy === 'function') OLD.destroy();
  const oldRoot = document.getElementById(ROOT_ID);
  if (oldRoot) oldRoot.remove();

  const style = document.createElement('style');
  style.id = ROOT_ID + '-style';
  style.textContent = `
    #${ROOT_ID}{position:fixed;z-index:2147483646;top:12px;right:12px;width:min(340px,calc(100vw - 24px));max-height:calc(100dvh - 24px);overflow:auto;background:#101820;color:#edf3f7;border:1px solid #526575;border-radius:12px;box-shadow:0 10px 36px #0008;font:13px/1.45 system-ui,-apple-system,Segoe UI,sans-serif;}
    #${ROOT_ID} *{box-sizing:border-box}
    #${ROOT_ID} .cat-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:11px 12px;background:#1a2a37;border-radius:12px 12px 0 0;position:sticky;top:0}
    #${ROOT_ID} .cat-title{font-weight:750;font-size:14px}
    #${ROOT_ID} .cat-ver{color:#9db0bf;font-size:11px}
    #${ROOT_ID} .cat-body{padding:11px;display:grid;gap:9px}
    #${ROOT_ID} .cat-status{padding:8px 9px;border-radius:8px;background:#202f3b;color:#c9d7e0;white-space:pre-wrap}
    #${ROOT_ID} .cat-status.ok{border-left:3px solid #63c58b}
    #${ROOT_ID} .cat-status.bad{border-left:3px solid #e6a15c}
    #${ROOT_ID} .cat-section{border-top:1px solid #344552;padding-top:8px}
    #${ROOT_ID} .cat-section b{display:block;margin-bottom:6px;color:#b9cbd7}
    #${ROOT_ID} .cat-row{display:flex;gap:7px;flex-wrap:wrap}
    #${ROOT_ID} button{background:#28465b;color:#f4f8fb;border:1px solid #547087;border-radius:7px;padding:8px 10px;font:600 12px system-ui;cursor:pointer}
    #${ROOT_ID} button:hover{background:#35617d}
    #${ROOT_ID} button:disabled{opacity:.42;cursor:not-allowed}
    #${ROOT_ID} .cat-muted{font-size:11px;color:#9db0bf}
    #${ROOT_ID} pre{margin:0;padding:8px;background:#0b1218;border-radius:7px;color:#c7d5df;white-space:pre-wrap;overflow-wrap:anywhere;font:11px/1.4 ui-monospace,monospace;max-height:155px;overflow:auto}
    #${ROOT_ID} .cat-hide{display:none}
  `;
  document.documentElement.appendChild(style);

  const root = document.createElement('section');
  root.id = ROOT_ID;
  root.innerHTML = `
    <div class="cat-head">
      <div><div class="cat-title">Coaster Addon Toolkit</div><div class="cat-ver">v${VERSION}</div></div>
      <div class="cat-row"><button type="button" data-action="refresh">更新</button><button type="button" data-action="collapse">－</button></div>
    </div>
    <div class="cat-body" data-body>
      <div class="cat-status" data-status>ゲームAPIを確認しています…</div>
      <div class="cat-section">
        <b>モデル書き出し</b>
        <div class="cat-row"><button type="button" data-action="glb">設計したコースをGLB保存</button><button type="button" data-action="json">設計データをJSON保存</button></div>
        <div class="cat-muted">GLB対象：ゲーム内部の co.meshes。線路など、コース用メッシュを出力します。</div>
      </div>
      <div class="cat-section">
        <b>調査・診断</b>
        <div class="cat-row"><button type="button" data-action="inspect">内部構造をConsole表示</button><button type="button" data-action="report">診断レポートをコピー</button></div>
        <pre data-info>未取得</pre>
      </div>
      <div class="cat-section">
        <b>未接続の拡張ポイント</b>
        <div class="cat-muted">コースの指定全長・設計エリア拡張は、editor.design / FIELD / buildTrack の実データを確認してから接続します。現段階では安全のため変更しません。</div>
      </div>
    </div>`;
  document.body.appendChild(root);

  const $ = (s) => root.querySelector(s);
  const statusEl = $('[data-status]');
  const infoEl = $('[data-info]');
  const bodyEl = $('[data-body]');
  let lastReport = null;

  function api() {
    const r = window.__rc;
    return r && r.THREE && r.scene3d ? r : null;
  }

  function setStatus(message, good) {
    statusEl.textContent = message;
    statusEl.className = 'cat-status ' + (good ? 'ok' : 'bad');
  }

  function flattenMeshes(source, THREE) {
    const out = [];
    const seen = new Set();
    const add = (obj) => {
      if (!obj || seen.has(obj)) return;
      seen.add(obj);
      if (obj.isMesh && obj.geometry && obj.geometry.attributes && obj.geometry.attributes.position) {
        out.push(obj);
        return;
      }
      if (typeof obj.traverse === 'function') {
        obj.traverse((child) => {
          if (child && child.isMesh && child.geometry && child.geometry.attributes && child.geometry.attributes.position && !seen.has(child)) {
            seen.add(child);
            out.push(child);
          }
        });
      }
    };
    if (Array.isArray(source)) source.forEach(add);
    else add(source);
    return out;
  }

  function getMeshes(r) {
    const THREE = r.THREE;
    const source = r.co && r.co.meshes;
    return flattenMeshes(source, THREE);
  }

  function boundsFor(meshes, THREE) {
    const box = new THREE.Box3();
    box.makeEmpty();
    let vertices = 0;
    for (const mesh of meshes) {
      const geo = mesh.geometry;
      const pos = geo && geo.attributes && geo.attributes.position;
      if (!pos) continue;
      vertices += pos.count;
      if (typeof mesh.updateWorldMatrix === 'function') mesh.updateWorldMatrix(true, false);
      else if (typeof mesh.updateMatrixWorld === 'function') mesh.updateMatrixWorld(true);
      const local = geo.boundingBox || (geo.computeBoundingBox(), geo.boundingBox);
      if (local && !local.isEmpty()) {
        const worldBox = local.clone().applyMatrix4(mesh.matrixWorld);
        box.union(worldBox);
      }
    }
    const size = box.isEmpty() ? null : box.getSize(new THREE.Vector3());
    return {
      meshes: meshes.length,
      vertices,
      bounds: size ? { x: +size.x.toFixed(3), y: +size.y.toFixed(3), z: +size.z.toFixed(3) } : null,
      min: box.isEmpty() ? null : box.min.toArray().map(v => +v.toFixed(3)),
      max: box.isEmpty() ? null : box.max.toArray().map(v => +v.toFixed(3))
    };
  }

  function makeReport(r) {
    const meshes = getMeshes(r);
    const co = r.co || {};
    const editor = r.editor || {};
    const report = {
      toolkitVersion: VERSION,
      page: location.href,
      mode: r.mode,
      debugAPI: true,
      coasterKeys: Object.keys(co),
      trackKeys: co.tr && typeof co.tr === 'object' ? Object.keys(co.tr) : [],
      editorKeys: Object.keys(editor),
      designKeys: editor.design && typeof editor.design === 'object' ? Object.keys(editor.design) : [],
      meshStats: boundsFor(meshes, r.THREE),
      FIELD: r.FIELD,
      BUDGET: r.BUDGET,
      H_SAMPLES: r.H_SAMPLES,
      sceneChildren: r.scene3d && r.scene3d.children ? r.scene3d.children.length : null,
      rendererInfo: r.renderer && r.renderer.info ? {
        calls: r.renderer.info.render && r.renderer.info.render.calls,
        triangles: r.renderer.info.render && r.renderer.info.render.triangles,
        geometries: r.renderer.info.memory && r.renderer.info.memory.geometries,
        textures: r.renderer.info.memory && r.renderer.info.memory.textures
      } : null
    };
    lastReport = report;
    return report;
  }

  function update() {
    const r = api();
    if (!r) {
      setStatus('window.__rc が見つかりません。\nこのゲームは DEBUG_OK が有効な環境だけ内部APIを公開します。\n本番ページで無効なら、コースモデルへのアクセス方法を別途調べる必要があります。', false);
      infoEl.textContent = 'API unavailable';
      $('[data-action="glb"]').disabled = true;
      $('[data-action="json"]').disabled = true;
      $('[data-action="inspect"]').disabled = true;
      $('[data-action="report"]').disabled = true;
      return;
    }
    const meshes = getMeshes(r);
    const stats = boundsFor(meshes, r.THREE);
    setStatus(`内部API：利用可能\n画面モード：${r.mode}\nコースメッシュ：${meshes.length} 個\n頂点数：${stats.vertices.toLocaleString()}\n範囲：${stats.bounds ? `${stats.bounds.x} × ${stats.bounds.y} × ${stats.bounds.z}` : '計測不可'}`, true);
    infoEl.textContent = `co keys: ${Object.keys(r.co || {}).join(', ') || '(none)'}\ntrack keys: ${Object.keys(r.co?.tr || {}).join(', ') || '(none)'}\neditor keys: ${Object.keys(r.editor || {}).join(', ') || '(none)'}\nFIELD: ${JSON.stringify(r.FIELD)}`;
    $('[data-action="glb"]').disabled = meshes.length === 0;
    $('[data-action="json"]').disabled = !(r.editor && r.editor.design);
    $('[data-action="inspect"]').disabled = false;
    $('[data-action="report"]').disabled = false;
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  function safeName(s) {
    return String(s || 'coaster').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60) || 'coaster';
  }

  function exportDesignJSON(r) {
    const design = r.editor && r.editor.design;
    if (!design) throw new Error('editor.design が見つかりません');
    const payload = {
      format: 'coaster-design-json',
      version: 1,
      exportedAt: new Date().toISOString(),
      design
    };
    const text = JSON.stringify(payload, null, 2);
    downloadBlob(new Blob([text], { type: 'application/json' }), `coaster_design_${Date.now()}.json`);
    return text.length;
  }

  function exportGLB(meshes, r) {
    const THREE = r.THREE;
    const json = {
      asset: { version: '2.0', generator: `Coaster Addon Toolkit ${VERSION}` },
      scene: 0,
      scenes: [{ nodes: [] }],
      nodes: [],
      meshes: [],
      materials: [],
      accessors: [],
      bufferViews: [],
      buffers: [{ byteLength: 0 }]
    };
    const binaryParts = [];
    let byteLength = 0;
    const materialCache = new Map();

    function appendBytes(typed) {
      const bytes = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
      const pad = (4 - (byteLength % 4)) % 4;
      if (pad) {
        binaryParts.push(new Uint8Array(pad));
        byteLength += pad;
      }
      const offset = byteLength;
      const copy = new Uint8Array(bytes.length);
      copy.set(bytes);
      binaryParts.push(copy);
      byteLength += copy.length;
      return { offset, length: copy.length };
    }

    function addAccessor(values, type, target, minMax) {
      const typed = values instanceof Float32Array ? values : new Float32Array(values);
      const part = appendBytes(typed);
      const viewIndex = json.bufferViews.length;
      json.bufferViews.push({ buffer: 0, byteOffset: part.offset, byteLength: part.length, target });
      const componentCount = type === 'VEC3' ? 3 : type === 'VEC2' ? 2 : 1;
      const accessor = {
        bufferView: viewIndex,
        byteOffset: 0,
        componentType: 5126,
        count: typed.length / componentCount,
        type
      };
      if (minMax) {
        accessor.min = minMax.min;
        accessor.max = minMax.max;
      }
      const index = json.accessors.length;
      json.accessors.push(accessor);
      return index;
    }

    function addMaterial(mat) {
      if (!mat) mat = {};
      if (materialCache.has(mat)) return materialCache.get(mat);
      const c = mat.color || { r: 0.72, g: 0.76, b: 0.8 };
      const e = mat.emissive || { r: 0, g: 0, b: 0 };
      const pbr = {
        baseColorFactor: [c.r ?? 0.72, c.g ?? 0.76, c.b ?? 0.8, mat.opacity == null ? 1 : mat.opacity],
        metallicFactor: Number.isFinite(mat.metalness) ? mat.metalness : 0,
        roughnessFactor: Number.isFinite(mat.roughness) ? mat.roughness : 1
      };
      const out = { name: mat.name || 'CoasterMaterial', pbrMetallicRoughness: pbr };
      if (e.r || e.g || e.b) out.emissiveFactor = [e.r || 0, e.g || 0, e.b || 0];
      if (mat.transparent || (mat.opacity != null && mat.opacity < 1)) out.alphaMode = 'BLEND';
      else if (mat.alphaTest > 0) { out.alphaMode = 'MASK'; out.alphaCutoff = mat.alphaTest; }
      if (THREE.DoubleSide !== undefined && mat.side === THREE.DoubleSide) out.doubleSided = true;
      const idx = json.materials.length;
      json.materials.push(out);
      materialCache.set(mat, idx);
      return idx;
    }

    let exportedMeshes = 0;
    let exportedPrimitives = 0;
    let skipped = 0;

    for (const obj of meshes) {
      if (!obj || !obj.geometry || !obj.geometry.attributes || !obj.geometry.attributes.position || obj.isSkinnedMesh || obj.isInstancedMesh) {
        skipped++;
        continue;
      }
      const geo = obj.geometry;
      const position = geo.attributes.position;
      if (!position || position.count < 3) { skipped++; continue; }
      if (typeof obj.updateWorldMatrix === 'function') obj.updateWorldMatrix(true, false);
      else if (typeof obj.updateMatrixWorld === 'function') obj.updateMatrixWorld(true);

      const total = geo.index ? geo.index.count : position.count;
      const drawStart = Math.max(0, geo.drawRange && Number.isFinite(geo.drawRange.start) ? geo.drawRange.start : 0);
      const drawCount = geo.drawRange && Number.isFinite(geo.drawRange.count) ? geo.drawRange.count : total;
      const drawEnd = Math.min(total, drawStart + drawCount);
      const groups = geo.groups && geo.groups.length ? geo.groups : [{ start: 0, count: total, materialIndex: 0 }];
      const materialList = Array.isArray(obj.material) ? obj.material : [obj.material];
      const primitives = [];

      for (const group of groups) {
        const start = Math.max(drawStart, group.start || 0);
        const end = Math.min(drawEnd, (group.start || 0) + (Number.isFinite(group.count) ? group.count : total));
        const count = Math.max(0, end - start);
        const usableCount = count - (count % 3);
        if (usableCount < 3) continue;

        const sourceIndices = new Array(usableCount);
        for (let i = 0; i < usableCount; i++) {
          sourceIndices[i] = geo.index ? geo.index.getX(start + i) : start + i;
        }

        const attributes = {};
        const specs = [
          ['position', 'POSITION', 3],
          ['normal', 'NORMAL', 3],
          ['uv', 'TEXCOORD_0', 2],
          ['color', 'COLOR_0', 3]
        ];
        for (const [sourceName, gltfName, size] of specs) {
          const attr = geo.attributes[sourceName];
          if (!attr) continue;
          const values = new Float32Array(sourceIndices.length * size);
          for (let i = 0; i < sourceIndices.length; i++) {
            const vi = sourceIndices[i];
            values[i * size] = attr.getX(vi);
            if (size > 1) values[i * size + 1] = attr.getY(vi);
            if (size > 2) values[i * size + 2] = attr.getZ(vi);
          }
          let minMax = null;
          if (gltfName === 'POSITION') {
            const min = [Infinity, Infinity, Infinity];
            const max = [-Infinity, -Infinity, -Infinity];
            for (let i = 0; i < values.length; i += 3) {
              for (let k = 0; k < 3; k++) {
                if (values[i + k] < min[k]) min[k] = values[i + k];
                if (values[i + k] > max[k]) max[k] = values[i + k];
              }
            }
            minMax = { min, max };
          }
          attributes[gltfName] = addAccessor(values, size === 3 ? 'VEC3' : 'VEC2', 34962, minMax);
        }
        if (attributes.POSITION === undefined) continue;
        const mat = materialList[group.materialIndex || 0] || materialList[0];
        const primitive = { attributes, mode: 4 };
        if (mat) primitive.material = addMaterial(mat);
        primitives.push(primitive);
      }

      if (!primitives.length) { skipped++; continue; }
      const meshIndex = json.meshes.length;
      json.meshes.push({ name: obj.name || `CoasterMesh_${meshIndex}`, primitives });
      const node = { name: obj.name || `CoasterNode_${meshIndex}`, mesh: meshIndex };
      if (obj.matrixWorld && obj.matrixWorld.elements) node.matrix = Array.from(obj.matrixWorld.elements);
      json.nodes.push(node);
      json.scenes[0].nodes.push(json.nodes.length - 1);
      exportedMeshes++;
      exportedPrimitives += primitives.length;
    }

    if (!exportedMeshes) throw new Error('GLBにできるコースメッシュがありません。コースを読み込んだ状態で再試行してください。');

    while (byteLength % 4) {
      binaryParts.push(new Uint8Array(1));
      byteLength++;
    }
    json.buffers[0].byteLength = byteLength;
    const jsonBytesRaw = new TextEncoder().encode(JSON.stringify(json));
    const jsonPad = (4 - (jsonBytesRaw.length % 4)) % 4;
    const jsonBytes = new Uint8Array(jsonBytesRaw.length + jsonPad);
    jsonBytes.fill(0x20);
    jsonBytes.set(jsonBytesRaw);

    const binBytes = new Uint8Array(byteLength);
    let cursor = 0;
    for (const part of binaryParts) { binBytes.set(part, cursor); cursor += part.length; }

    const totalLength = 12 + 8 + jsonBytes.length + 8 + binBytes.length;
    const out = new ArrayBuffer(totalLength);
    const view = new DataView(out);
    let offset = 0;
    view.setUint32(offset, 0x46546c67, true); offset += 4;
    view.setUint32(offset, 2, true); offset += 4;
    view.setUint32(offset, totalLength, true); offset += 4;
    view.setUint32(offset, jsonBytes.length, true); offset += 4;
    view.setUint32(offset, 0x4e4f534a, true); offset += 4;
    new Uint8Array(out, offset, jsonBytes.length).set(jsonBytes); offset += jsonBytes.length;
    view.setUint32(offset, binBytes.length, true); offset += 4;
    view.setUint32(offset, 0x004e4942, true); offset += 4;
    new Uint8Array(out, offset, binBytes.length).set(binBytes);

    downloadBlob(new Blob([out], { type: 'model/gltf-binary' }), `coaster_model_${Date.now()}.glb`);
    return { exportedMeshes, exportedPrimitives, skipped, bytes: totalLength };
  }

  function inspect() {
    const r = api();
    if (!r) return;
    const report = makeReport(r);
    console.group('[Coaster Addon Toolkit] Runtime inspection');
    console.log('Report:', report);
    console.log('co:', r.co);
    console.log('co.tr:', r.co && r.co.tr);
    console.log('editor:', r.editor);
    console.log('editor.design:', r.editor && r.editor.design);
    console.log('FIELD:', r.FIELD, 'BUDGET:', r.BUDGET, 'H_SAMPLES:', r.H_SAMPLES);
    console.log('co.meshes:', r.co && r.co.meshes);
    console.groupEnd();
    infoEl.textContent = JSON.stringify(report, null, 2);
  }

  async function copyReport() {
    const r = api();
    if (!r) return;
    const text = JSON.stringify(makeReport(r), null, 2);
    try {
      await navigator.clipboard.writeText(text);
      setStatus('診断レポートをコピーしました。', true);
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand('copy'); ta.remove();
      setStatus(ok ? '診断レポートをコピーしました。' : 'コピーできませんでした。ConsoleのReportを確認してください。', !!ok);
    }
  }

  function onClick(event) {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const action = button.dataset.action;
    try {
      if (action === 'collapse') {
        bodyEl.classList.toggle('cat-hide');
        button.textContent = bodyEl.classList.contains('cat-hide') ? '＋' : '－';
      } else if (action === 'refresh') {
        update();
      } else if (action === 'inspect') {
        inspect();
        setStatus('内部構造をConsoleに出力しました。', true);
      } else if (action === 'report') {
        copyReport();
      } else if (action === 'json') {
        const bytes = exportDesignJSON(api());
        setStatus(`設計JSONを保存しました（${bytes.toLocaleString()}文字）。`, true);
      } else if (action === 'glb') {
        const r = api();
        if (!r) throw new Error('DEBUG APIがありません');
        const meshes = getMeshes(r);
        const result = exportGLB(meshes, r);
        setStatus(`GLBを書き出しました。\nメッシュ ${result.exportedMeshes}個／プリミティブ ${result.exportedPrimitives}個／約 ${(result.bytes / 1024 / 1024).toFixed(2)}MB\n対象外 ${result.skipped}個`, true);
      }
    } catch (error) {
      console.error('[Coaster Addon Toolkit]', error);
      setStatus(`エラー：${error && error.message ? error.message : error}`, false);
    }
  }

  root.addEventListener('click', onClick);

  const toolkit = {
    version: VERSION,
    refresh: update,
    inspect,
    getReport: () => api() ? makeReport(api()) : null,
    exportGLB: () => { const r = api(); if (!r) throw new Error('window.__rc is unavailable'); return exportGLB(getMeshes(r), r); },
    exportDesignJSON: () => { const r = api(); if (!r) throw new Error('window.__rc is unavailable'); return exportDesignJSON(r); },
    destroy: () => { root.removeEventListener('click', onClick); root.remove(); style.remove(); delete window.CoasterAddonToolkit; }
  };
  window.CoasterAddonToolkit = toolkit;
  update();
  console.info(`[Coaster Addon Toolkit] v${VERSION} loaded. Use window.CoasterAddonToolkit.inspect() for diagnostics.`);
})();
