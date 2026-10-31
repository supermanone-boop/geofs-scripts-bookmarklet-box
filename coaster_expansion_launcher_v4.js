(async () => {
  'use strict';
  const ROOT = 'https://raw.githubusercontent.com/supermanone-boop/geofs-scripts-bookmarklet-box/refs/heads/main/';
  const FILES = ['main.js', 'track.js', 'editor.js', 'world.js', 'codec.js', 'coaster_expansion.js', 'sim.js'];
  const KEY = '__coasterExpansionLauncher';

  function show(message, error = false) {
    let el = document.getElementById('coaster-expansion-launcher-message');
    if (!el) {
      el = document.createElement('div');
      el.id = 'coaster-expansion-launcher-message';
      el.style.cssText = 'position:fixed;z-index:2147483647;left:10px;right:10px;top:10px;padding:12px 14px;border-radius:9px;background:#152238;color:#fff;font:14px/1.5 system-ui;box-shadow:0 3px 18px #0005;white-space:pre-wrap;overflow-wrap:anywhere';
      document.body.appendChild(el);
    }
    el.style.background = error ? '#8b2525' : '#152238';
    el.textContent = message;
  }
  const raw = (file) => ROOT + file;
  const blob = (code) => URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
  function replaceImports(code, paths) {
    return code.replace(/(\bfrom\s*)(["'])([^"']+)\2/g, (all, prefix, quote, specifier) =>
      Object.prototype.hasOwnProperty.call(paths, specifier) ? prefix + quote + paths[specifier] + quote : all
    );
  }
  function requiredReplace(code, before, after, label) {
    if (!code.includes(before)) throw new Error(`${label} が見つかりません。GitHubのファイルがv4.1のものか確認してください。`);
    return code.replace(before, after);
  }

  try {
    if (!location.hostname.endsWith('it-monozukuri.com') || !location.pathname.startsWith('/coaster/')) {
      throw new Error('「ジェットコースターを作ろう！」の /coaster/ ページで実行してください。');
    }
    if (window[KEY]) throw new Error('すでに起動しています。ページを再読み込みしてから実行してください。');

    show('拡張版ファイルを取得しています…');
    const loaded = await Promise.all(FILES.map(async (name) => {
      const response = await fetch(raw(name), { cache: 'no-store' });
      if (!response.ok) throw new Error(`${name} の取得に失敗しました（HTTP ${response.status}）。GitHubのmainブランチ直下にv4.1の7ファイルを置いてください。`);
      return [name, await response.text()];
    }));
    const src = Object.fromEntries(loaded);

    show('ゲーム本体を組み立てています…');
    const jsBase = new URL('js/', location.href).href;
    const gameFile = (name) => new URL(name, jsBase).href;
    const threeURL = new URL('../../crowded-train-3d/js/vendor/three.module.min.js', jsBase).href;
    const analyticsURL = new URL('../../common/analytics.js', jsBase).href;

    const bootMarker = '  requestAnimationFrame(frame);\n}\nboot();';
    if (!src['main.js'].includes(bootMarker)) throw new Error('main.jsの起動位置を確認できません。');
    src['main.js'] = src['main.js'].replace(
      bootMarker,
      '  requestAnimationFrame(frame);\n  window.__coasterExpansionBooted = true;\n}\nwindow.__coasterExpansionFrame = frame;\nboot();'
    );

    const urls = {};
    urls.track = blob(src['track.js']);
    urls.codec = blob(replaceImports(src['codec.js'], {
      './track.js': urls.track,
      './looks.js': gameFile('looks.js')
    }));
    urls.sim = blob(replaceImports(src['sim.js'], {
      './track.js': urls.track,
      './codec.js': urls.codec
    }));
    urls.world = blob(replaceImports(src['world.js'], {
      '../../crowded-train-3d/js/vendor/three.module.min.js': threeURL,
      './track.js': urls.track,
      './sim.js': urls.sim,
      './themes.js': gameFile('themes.js'),
      './looks.js': gameFile('looks.js')
    }));
    urls.editor = blob(replaceImports(src['editor.js'], {
      './track.js': urls.track,
      './sim.js': urls.sim,
      './fix.js': gameFile('fix.js'),
      './themes.js': gameFile('themes.js'),
      './audio.js': gameFile('audio.js'),
      './looks.js': gameFile('looks.js')
    }));
    urls.expansion = blob(src['coaster_expansion.js']);
    urls.main = blob(replaceImports(src['main.js'], {
      '../../crowded-train-3d/js/vendor/three.module.min.js': threeURL,
      './audio.js': gameFile('audio.js'),
      '../../common/analytics.js': analyticsURL,
      './track.js': urls.track,
      './sim.js': urls.sim,
      './world.js': urls.world,
      './looks.js': gameFile('looks.js'),
      './editor.js': urls.editor,
      './codec.js': urls.codec,
      './fix.js': gameFile('fix.js'),
      './coaster_expansion.js': urls.expansion,
      './favs.js': gameFile('favs.js')
    }));

    // 元ゲームの描画ループだけを止め、v4.1側のループを通す。
    const nativeRAF = window.requestAnimationFrame.bind(window);
    window.__coasterExpansionFrame = null;
    window.__coasterExpansionBooted = false;
    window.requestAnimationFrame = function (callback, ...args) {
      if (typeof callback === 'function' && callback.name === 'frame' && callback !== window.__coasterExpansionFrame) return 0;
      return nativeRAF(callback, ...args);
    };

    const oldBody = document.body;
    oldBody.replaceWith(oldBody.cloneNode(true));
    show('拡張版を起動しています…');
    await import(urls.main);
    await new Promise((resolve, reject) => {
      const started = Date.now();
      const check = () => {
        if (window.__coasterExpansionBooted && document.getElementById('rc-free-camera')) return resolve();
        if (Date.now() - started > 12000) return reject(new Error('起動完了を確認できませんでした。ページを再読み込みして再試行してください。'));
        setTimeout(check, 80);
      };
      check();
    });

    window[KEY] = { urls, version: '4.1' };
    const info = document.getElementById('coaster-expansion-launcher-message');
    if (info) info.remove();
    console.info('[Coaster Expansion] v4.1 起動完了：走行時間上限解除／高さ上限解除／自由カメラ');
  } catch (error) {
    console.error('[Coaster Expansion Launcher v4.1]', error);
    show(`起動エラー：${error && error.message ? error.message : error}\n\nページを再読み込みすると元のゲームに戻ります。`, true);
  }
})();
