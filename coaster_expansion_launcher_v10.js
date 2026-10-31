(async () => {
  'use strict';
  const ROOT='https://raw.githubusercontent.com/supermanone-boop/geofs-scripts-bookmarklet-box/refs/heads/main/';
  const FILES=['main.js','track.js','editor.js','world.js','codec.js','coaster_expansion.js','coaster_architecture.js','coaster_city_flight.js','sim.js'];
  const KEY='__coasterExpansionLauncherV100';
  function show(message,error=false){let el=document.getElementById('coaster-expansion-launcher-message');if(!el){el=document.createElement('div');el.id='coaster-expansion-launcher-message';el.style.cssText='position:fixed;z-index:2147483647;left:10px;right:10px;top:10px;padding:12px 14px;border-radius:9px;background:#152238;color:#fff;font:14px/1.5 system-ui;box-shadow:0 3px 18px #0005;white-space:pre-wrap;overflow-wrap:anywhere';document.body.appendChild(el);}el.style.background=error?'#8b2525':'#152238';el.textContent=message;}
  const blob=code=>URL.createObjectURL(new Blob([code],{type:'text/javascript'}));
  function imports(code,paths){return code.replace(/(\bfrom\s*)(["'])([^"']+)\2/g,(all,p,q,spec)=>Object.prototype.hasOwnProperty.call(paths,spec)?p+q+paths[spec]+q:all);}
  try{
    if(!location.hostname.endsWith('it-monozukuri.com')||!location.pathname.startsWith('/coaster/'))throw new Error('「ジェットコースターを作ろう！」の /coaster/ ページで実行してください。');
    if(window[KEY])throw new Error('すでにv10.0が起動しています。再読み込みしてから実行してください。');
    show('v10.0の9ファイルを取得しています…');
    const entries=await Promise.all(FILES.map(async name=>{const r=await fetch(ROOT+name,{cache:'no-store'});if(!r.ok)throw new Error(`${name} の取得に失敗しました（HTTP ${r.status}）。GitHub main直下のv10.0ファイルを確認してください。`);return[name,await r.text()];}));
    const src=Object.fromEntries(entries);
    const jsBase=new URL('js/',location.href).href,gameFile=name=>new URL(name,jsBase).href;
    const threeURL=new URL('../../crowded-train-3d/js/vendor/three.module.min.js',jsBase).href;
    const analyticsURL=new URL('../../common/analytics.js',jsBase).href;
    const bootMarker='  requestAnimationFrame(frame);\n}\nboot();';
    if(!src['main.js'].includes(bootMarker))throw new Error('main.jsの起動位置が一致しません。');
    src['main.js']=src['main.js'].replace(bootMarker,'  requestAnimationFrame(frame);\n  window.__coasterExpansionBooted=true;\n}\nwindow.__coasterExpansionFrame=frame;\nboot();');
    const urls={};
    urls.track=blob(src['track.js']);
    urls.codec=blob(imports(src['codec.js'],{'./track.js':urls.track,'./looks.js':gameFile('looks.js')}));
    urls.sim=blob(imports(src['sim.js'],{'./track.js':urls.track,'./codec.js':urls.codec}));
    urls.world=blob(imports(src['world.js'],{'../../crowded-train-3d/js/vendor/three.module.min.js':threeURL,'./track.js':urls.track,'./sim.js':urls.sim,'./themes.js':gameFile('themes.js'),'./looks.js':gameFile('looks.js')}));
    urls.editor=blob(imports(src['editor.js'],{'./track.js':urls.track,'./sim.js':urls.sim,'./fix.js':gameFile('fix.js'),'./themes.js':gameFile('themes.js'),'./audio.js':gameFile('audio.js'),'./looks.js':gameFile('looks.js')}));
    urls.architecture=blob(src['coaster_architecture.js']);
    urls.cityFlight=blob(src['coaster_city_flight.js']);
    urls.expansion=blob(imports(src['coaster_expansion.js'],{'./coaster_architecture.js':urls.architecture,'./coaster_city_flight.js':urls.cityFlight}));
    urls.main=blob(imports(src['main.js'],{'../../crowded-train-3d/js/vendor/three.module.min.js':threeURL,'./audio.js':gameFile('audio.js'),'../../common/analytics.js':analyticsURL,'./track.js':urls.track,'./sim.js':urls.sim,'./world.js':urls.world,'./looks.js':gameFile('looks.js'),'./editor.js':urls.editor,'./codec.js':urls.codec,'./fix.js':gameFile('fix.js'),'./coaster_expansion.js':urls.expansion,'./favs.js':gameFile('favs.js')}));
    const nativeRAF=window.requestAnimationFrame.bind(window);window.__coasterExpansionFrame=null;window.__coasterExpansionBooted=false;
    window.requestAnimationFrame=function(callback,...args){if(typeof callback==='function'&&callback.name==='frame'&&callback!==window.__coasterExpansionFrame)return 0;return nativeRAF(callback,...args);};
    const body=document.body;body.replaceWith(body.cloneNode(true));show('v10.0を起動しています…');
    await import(urls.main);
    await new Promise((resolve,reject)=>{const t=Date.now();const check=()=>{if(window.__coasterExpansionBooted&&document.getElementById('rc-course-mode-picker'))return resolve();if(Date.now()-t>15000)return reject(new Error('起動確認に失敗しました。ページを再読み込みしてください。'));setTimeout(check,100);};check();});
    window[KEY]={urls,version:'10.0'};const el=document.getElementById('coaster-expansion-launcher-message');if(el)el.remove();
    console.info('[Coaster Expansion] v10.0 起動完了：タイトル3モード／直交都市グリッド／連続山岳・河川');
  }catch(error){console.error('[Coaster Expansion Launcher v10.0]',error);show(`起動エラー：${error.message||error}\n\nページを再読み込みすると元のゲームに戻ります。`,true);}
})();
