/* Coaster Architecture & Ride-Through Pack v1.0
 * 19 detailed procedural architecture attractions for the coaster editor.
 * Every prefab has a clear train passage, interior set dressing and ride-reactive mechanics.
 */
export function installArchitecturePack(api, editor, panel) {
  'use strict';
  if (!api || !api.THREE || !api.scene3d || !editor || !panel) throw new Error('Architecture Pack: runtime API is incomplete');
  const T = api.THREE;
  const scene = api.scene3d;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const mix = (a, b, t) => a + (b - a) * t;
  const structures = [];
  const MAX_STRUCTURES = 4;
  let selectedId = null;
  let clock = 0;
  let rafTimer = 0;
  const matCache = new Map();

  const TYPES = [
    { id:'urban', name:'01 都市の複合ビル', sub:'店舗・オフィス・屋上設備を貫く街区アーケード', w:58,d:68,h:34 },
    { id:'skyscraper', name:'02 超高層ビルの吹き抜け', sub:'ガラス外壁・多層バルコニー・昇降エレベーター', w:62,d:72,h:58 },
    { id:'mall', name:'03 大型ショッピングモール', sub:'3層吹き抜け・店舗・動くエスカレーター', w:68,d:78,h:30 },
    { id:'airport', name:'04 国際空港ターミナル', sub:'出発ロビー・搭乗ゲート・手荷物コンベア', w:76,d:82,h:28 },
    { id:'metro', name:'05 地下鉄ターミナル駅', sub:'ホーム・改札・信号・昇降階段', w:58,d:78,h:24 },
    { id:'factory', name:'06 巨大自動車工場', sub:'搬送ライン・ロボットアーム・天井クレーン', w:70,d:80,h:32 },
    { id:'aquarium', name:'07 巨大水族館トンネル', sub:'透明水槽チューブ・回遊する魚群・泡', w:54,d:74,h:24 },
    { id:'greenhouse', name:'08 ガラス温室ドーム', sub:'大断面ガラスアーチ・樹木・散水装置', w:62,d:78,h:36 },
    { id:'cathedral', name:'09 大聖堂', sub:'高い身廊・尖頭アーチ・ステンドグラス', w:58,d:82,h:42 },
    { id:'haunted', name:'10 廃墟ホテル', sub:'客室廊下・自動ドア・浮遊する怪異演出', w:54,d:72,h:28 },
    { id:'parking', name:'11 立体駐車場', sub:'多層スロープ・車列・誘導灯', w:64,d:76,h:30 },
    { id:'datacenter', name:'12 データセンター', sub:'サーバー迷路・回転ファン・状態ランプ', w:54,d:70,h:26 },
    { id:'power', name:'13 発電所タービンホール', sub:'巨大発電機・回転タービン・蒸気配管', w:68,d:76,h:34 },
    { id:'ship', name:'14 大型船の機関区画', sub:'船体断面・機関室・ピストン・舷窓', w:58,d:78,h:30 },
    { id:'hangar', name:'15 大型航空機格納庫', sub:'格納庫扉・整備設備・機体展示', w:82,d:78,h:34 },
    { id:'planetarium', name:'16 プラネタリウム', sub:'巨大ドーム・惑星展示・回転する天体', w:62,d:70,h:36 },
    { id:'castle', name:'17 城塞・跳ね橋', sub:'石造りの城門・跳ね橋・上下する落とし格子', w:66,d:76,h:36 },
    { id:'mine', name:'18 巨大鉱山', sub:'岩盤トンネル・鉱石結晶・鉱山トロッコ', w:58,d:82,h:26 },
    { id:'neon', name:'19 ネオン繁華街', sub:'高層ビル谷間・空中歩道・動く交通・ネオン看板', w:78,d:84,h:38 },
  ];

  const C = {
    concrete:0x747b82, concrete2:0x9aa1a7, dark:0x252d36, steel:0x687987,
    glass:0x8dd9f0, glassDark:0x274b60, white:0xe5e9e8, warm:0xffd49a,
    wood:0x76503a, brick:0x9a5946, stone:0x77716a, gold:0xb9914e,
    blue:0x3183b7, cyan:0x36d8ee, red:0xc94b45, green:0x50bd85,
    yellow:0xe3bd58, purple:0x9461c9, water:0x167fa8, black:0x111820,
  };
  function mat(color, opt={}) {
    const key = JSON.stringify([color,opt]);
    if (matCache.has(key)) return matCache.get(key);
    const m = new T.MeshStandardMaterial({ color, roughness: opt.roughness ?? 0.78, metalness: opt.metalness ?? 0.08,
      transparent: !!opt.transparent, opacity: opt.opacity ?? 1, side: opt.double ? T.DoubleSide : T.FrontSide,
      emissive: opt.emissive || 0x000000, emissiveIntensity: opt.emissiveIntensity ?? 0,
      metalness: opt.metalness ?? 0.08, depthWrite: opt.depthWrite ?? true });
    m.userData.caShared = true; matCache.set(key,m); return m;
  }
  const M = {
    concrete:mat(C.concrete), concrete2:mat(C.concrete2), dark:mat(C.dark), steel:mat(C.steel,{metalness:.72,roughness:.4}),
    glass:mat(C.glass,{transparent:true,opacity:.28,metalness:.15,roughness:.12,depthWrite:false,double:true}),
    glassBlue:mat(C.glassDark,{transparent:true,opacity:.42,metalness:.18,roughness:.16,depthWrite:false,double:true}),
    white:mat(C.white), warm:mat(C.warm,{emissive:0x7d4612,emissiveIntensity:.25}), wood:mat(C.wood), brick:mat(C.brick),
    stone:mat(C.stone), gold:mat(C.gold,{metalness:.62,roughness:.32}), blue:mat(C.blue), cyan:mat(C.cyan,{emissive:C.cyan,emissiveIntensity:.7}),
    red:mat(C.red,{emissive:C.red,emissiveIntensity:.25}), green:mat(C.green,{emissive:C.green,emissiveIntensity:.45}),
    yellow:mat(C.yellow,{emissive:C.yellow,emissiveIntensity:.35}), purple:mat(C.purple,{emissive:C.purple,emissiveIntensity:.45}),
    water:mat(C.water,{transparent:true,opacity:.22,roughness:.1,depthWrite:false,double:true}), black:mat(C.black),
  };
  const box = (g,w,h,d,x,y,z,material,rx=0,ry=0,rz=0) => {
    const o = new T.Mesh(new T.BoxGeometry(w,h,d),material); o.position.set(x,y,z); o.rotation.set(rx,ry,rz); o.castShadow=true; o.receiveShadow=true; g.add(o); return o;
  };
  const cyl = (g,rt,rb,h,x,y,z,material,seg=16,rx=0,ry=0,rz=0) => {
    const o = new T.Mesh(new T.CylinderGeometry(rt,rb,h,seg),material); o.position.set(x,y,z); o.rotation.set(rx,ry,rz); o.castShadow=true; g.add(o); return o;
  };
  const sphere = (g,r,x,y,z,material,ws=12,hs=8) => {
    const o = new T.Mesh(new T.SphereGeometry(r,ws,hs),material); o.position.set(x,y,z); o.castShadow=true; g.add(o); return o;
  };
  const torus = (g,r,t,x,y,z,material,rx=0,ry=0,rz=0) => {
    const o = new T.Mesh(new T.TorusGeometry(r,t,8,32),material); o.position.set(x,y,z); o.rotation.set(rx,ry,rz); g.add(o); return o;
  };
  const plane = (g,w,h,x,y,z,material,ry=0,rx=0) => {
    const o = new T.Mesh(new T.PlaneGeometry(w,h),material); o.position.set(x,y,z); o.rotation.set(rx,ry,0); g.add(o); return o;
  };
  function tube(g, pts, radius, material, tubular=32, radial=6) {
    const curve = new T.CatmullRomCurve3(pts.map(p=>new T.Vector3(...p)));
    const o = new T.Mesh(new T.TubeGeometry(curve,tubular,radius,radial,false),material); g.add(o); return o;
  }
  function label(g,text,x,y,z,w=12,h=3,bg='#182735',fg='#f4fbff',ry=0) {
    const c=document.createElement('canvas'); c.width=512;c.height=128;
    const ctx=c.getContext('2d');ctx.fillStyle=bg;ctx.fillRect(0,0,c.width,c.height);
    ctx.fillStyle=fg;ctx.font='bold 54px system-ui,sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
    const s=String(text);let f=54;while(ctx.measureText(s).width>470&&f>18){f-=2;ctx.font=`bold ${f}px system-ui,sans-serif`;}
    ctx.fillText(s,256,66);
    const tex=new T.CanvasTexture(c);tex.colorSpace=T.SRGBColorSpace;
    const mm=new T.MeshBasicMaterial({map:tex,side:T.DoubleSide,transparent:true});
    const o=new T.Mesh(new T.PlaneGeometry(w,h),mm);o.position.set(x,y,z);o.rotation.y=ry;g.add(o);return o;
  }
  function pointLight(g,color,x,y,z,distance=28,intensity=1.4) {
    const l=new T.PointLight(color,intensity,distance,2);l.position.set(x,y,z);g.add(l);return l;
  }
  function autoDoor(g,z,animators,material=M.glassBlue) {
    const door=new T.Group();door.position.z=z;g.add(door);
    box(door,0.7,13,0.8,-6.2,0,0,M.steel);box(door,0.7,13,0.8,6.2,0,0,M.steel);box(door,13,0.7,0.8,0,6.5,0,M.steel);
    const a=box(door,5.9,11.5,.42,-3.05,0,0,material);const b=box(door,5.9,11.5,.42,3.05,0,0,material);
    box(door,5.4,.2,.5,-3.05,-5.7,.15,M.cyan);box(door,5.4,.2,.5,3.05,-5.7,.15,M.cyan);
    const state={a,b,open:0};
    animators.push((dt,local,active)=>{
      const near=active&&local&&Math.abs(local.x)<25&&Math.abs(local.y)<16&&local.z>z-24&&local.z<z+24;
      state.open=mix(state.open,near?1:0,1-Math.exp(-dt*3.2));
      a.position.x=-3.05-state.open*5.8;b.position.x=3.05+state.open*5.8;
    });
    return door;
  }
  function shell(g,style='modern',w=58,d=68,h=30,animators=[]) {
    const sideX=w/2, z=d/2, floorY=-4.8, roofY=h-5;
    const base=style==='industrial'?M.concrete:style==='stone'?M.stone:style==='brick'?M.brick:M.concrete2;
    const accent=style==='brick'?M.wood:style==='stone'?M.gold:M.steel;
    box(g,w,1.2,d,0,floorY,0,base);
    box(g,w,1.2,d,0,roofY,0,style==='glass'?M.glassBlue:base);
    box(g,1.1,h,d,-sideX, (floorY+roofY)/2,0,base);
    box(g,1.1,h,d, sideX, (floorY+roofY)/2,0,base);
    // Entrance/exit ends deliberately keep a full-height central passage open.
    for (const zz of [-z,z]) {
      box(g,(w-19)/2,h,1.2,-(w+19)/4,(floorY+roofY)/2,zz,base);
      box(g,(w-19)/2,h,1.2, (w+19)/4,(floorY+roofY)/2,zz,base);
      box(g,19,2.0,1.2,0,roofY-1.2,zz,accent);
      for(let x of [-w/2+2,w/2-2]) box(g,2,h,1.5,x,(floorY+roofY)/2,zz,accent);
    }
    // Visible inner passage: track is centered at y=0 with 18m width and 14m height clearance.
    box(g,18,0.7,d,0,-4.0,0,mat(0x555e66,{roughness:.92}));
    box(g,18,0.5,d,0,10.5,0,mat(0x303a43));
    for(const x of [-9.5,9.5]){
      box(g,.55,14,d,x,3,0,accent);
      for(let z0=-d/2+6;z0<d/2;z0+=12){box(g,.4,13,.5,x,3,z0,accent);}
    }
    for(let zz=-d/2+5;zz<d/2;zz+=10){
      box(g,17,.22,.32,0,9.7,zz,M.steel);
      const light=box(g,4,.16,.8,0,9.2,zz,M.warm);light.material=M.warm;
      if(zz%20===-5)pointLight(g,0xffdba5,0,8.8,zz,22,.5);
    }
    // Facade glazing and floor bands.
    for(let side of [-1,1]){
      for(let floor=0;floor<Math.max(2,Math.floor((h-9)/7));floor++){
        const yy=-1+floor*7;
        for(let k=0;k<5;k++){
          const zz=-d/2+8+k*(d-16)/4;
          box(g,.16,4.3,5.2,side*(sideX-.55),yy+1.8,zz,M.glassBlue);
          box(g,.35,.25,5.8,side*(sideX-.2),yy-0.4,zz,M.steel);
        }
      }
    }
    autoDoor(g,-z+1.2,animators);autoDoor(g,z-1.2,animators);
    // Exterior columns, parapets and rooftop plant.
    for(let x=-sideX+2;x<=sideX-2;x+=w-4){for(let zz=-z+2;zz<=z-2;zz+=d-4)cyl(g,.65,.75,h,.0+x,(floorY+roofY)/2,zz,accent,10);}
    for(let x=-sideX+4;x<=sideX-4;x+=8)box(g,.35,1,d-4,x,roofY+.7,0,accent);
    return {w,d,h,floorY,roofY,base,accent};
  }
  function makeCarShape(g,x,y,z,color=0xc74437,scale=1) {
    const bodyMat=mat(color,{roughness:.45,metalness:.28});
    const car=new T.Group();car.position.set(x,y,z);car.scale.setScalar(scale);g.add(car);
    box(car,2.7,.8,5,0,.6,0,bodyMat);box(car,2.1,.8,2.5,0,1.25,-.25,M.glassBlue);
    for(const xx of [-1.25,1.25])for(const zz of [-1.5,1.5])cyl(car,.38,.38,.3,xx,.3,zz,M.black,12,0,0,Math.PI/2);
    box(car,.45,.18,.15,-.72,.75,2.52,M.red);box(car,.45,.18,.15,.72,.75,2.52,M.red);
    return car;
  }
  function addStairs(g,x,y,z,w=8,h=8,depth=18,material=M.concrete2) {
    const steps=16;
    for(let i=0;i<steps;i++)box(g,w,h/steps,depth/steps,x,y-h/2+(i+.5)*h/steps,z-depth/2+(i+.5)*depth/steps,material);
  }
  function addPillarRows(g,xs,zs,h=16,material=M.steel) {
    for(const x of xs)for(const z of zs){cyl(g,.55,.7,h,x,h/2-3,z,material,12);cyl(g,.9,.9,.5,x,-3.2,z,material,12);}
  }
  function baseFor(id,g,anim) {
    const styles={urban:'modern',skyscraper:'glass',mall:'modern',airport:'glass',metro:'industrial',factory:'industrial',aquarium:'glass',greenhouse:'glass',cathedral:'stone',haunted:'brick',parking:'industrial',datacenter:'industrial',power:'industrial',ship:'industrial',hangar:'industrial',planetarium:'modern',castle:'stone',mine:'stone',neon:'modern'};
    const sizes=TYPES.find(x=>x.id===id);
    return shell(g,styles[id],sizes.w,sizes.d,sizes.h,anim);
  }
  function build(id) {
    const spec=TYPES.find(x=>x.id===id);if(!spec)throw new Error('施設タイプが不明です');
    const g=new T.Group();g.name='RideThrough_'+id;
    const anim=[];
    const b=baseFor(id,g,anim);
    const add=(...a)=>box(g,...a);
    const lamp=(x,y,z,col=0xffe2a8)=>pointLight(g,col,x,y,z,25,.7);
    const sign=(txt,x,y,z,w=13,h=3,bg='#142638',fg='#f6fbff',ry=0)=>label(g,txt,x,y,z,w,h,bg,fg,ry);
    if(id==='urban'){
      // Street-level arcade, retail units, upper balconies and realistic rooftop service clutter.
      for(const side of [-1,1]){
        for(let k=0;k<4;k++){const z=-24+k*16;add(8,5,1.2,side*14, -1.5,z,M.glassBlue);add(9,.5,1.7,side*14,-4,z,M.wood);add(9,.45,1,side*14,2.5,z-1,M.warm);sign(['CAFE','BOOKS','MARKET','DESIGN'][k],side*14,5,z-1,8,1.8,'#263846','#f5ddb0',side<0?Math.PI/2:-Math.PI/2);}
        for(let floor=0;floor<3;floor++){add(13,.5,64,side*15,5+floor*7,0,M.concrete2);for(let z=-27;z<30;z+=7){add(12,4,.35,side*15,7+floor*7,z,M.glassBlue);}}
        for(let z=-25;z<=25;z+=10){add(2,.5,6,side*21,4,z,M.gold);add(7,.35,2.5,side*21,8,z,M.wood);}
      }
      for(let i=0;i<8;i++){cyl(g,.18,.18,5,-25+i*7,17,-29,M.steel,8);}
      for(let i=0;i<5;i++){add(5,2.5,4,-18+i*9,19,26,M.dark);cyl(g,.8,.8,.4,-18+i*9,20,26,M.steel,12);}
      sign('CITY ARCADE',0,22,-34,20,3,'#24394b','#ffe2a0');lamp(0,8,0);
    } else if(id==='skyscraper') {
      for(const side of [-1,1]){
        for(let f=0;f<7;f++){const y=-1+f*7;add(16,.7,64,side*20,y,0,M.steel);add(1,6,64,side*28,y+3,0,M.glassBlue);}
        for(let z=-28;z<=28;z+=14){add(.6,48,.7,side*29,18,z,M.white);}
      }
      for(let f=0;f<6;f++){const y=1+f*7;for(const side of [-1,1])add(10,.7,62,side*11,y,0,M.concrete2);}
      // A visible glass elevator travels up and down in the atrium.
      const lift=new T.Group();g.add(lift);box(lift,5,4,5,0,0,-18,M.glassBlue);box(lift,5.5,.3,5.5,0,-2,-18,M.gold);
      for(let x of [-3,3])cyl(g,.12,.12,45,x,18,-18,M.steel,8);
      anim.push((dt)=>{lift.position.y=2+18+Math.sin(clock*.45)*16;});
      for(let f=0;f<6;f++){for(let side of [-1,1]){add(9,.25,2,side*14,3+f*7,26,M.gold);}}
      sign('VERTICAL CITY',0,29,-36,22,3,'#123449','#bcecff');lamp(-12,15,0,0x6fcfff);lamp(12,15,0,0x6fcfff);
    } else if(id==='mall') {
      for(let f=0;f<3;f++){
        const y=-1+f*8;
        for(const side of [-1,1]){add(16,.65,62,side*19,y,0,M.concrete2);for(let k=0;k<4;k++){const z=-24+k*16;add(9,5,.5,side*19,y+3,z,M.glassBlue);sign(['FASHION','TECH','FOOD','TOYS'][k],side*18,y+6,z,8,1.4,'#25394b','#f9e2b2',side<0?Math.PI/2:-Math.PI/2);}}
      }
      // Twin escalators beside the central void.
      const es=[];
      for(const side of [-1,1]){const eg=new T.Group();eg.position.set(side*15,-1,0);g.add(eg);addStairs(eg,0,0,0,7,9,26,M.dark);for(let i=0;i<18;i++){const st=box(eg,6,.22,.8,0,-4.1+i*.42,-12+i*1.35,M.steel);es.push({st,i});}tube(eg,[[-3,-1,-13],[-3,3,-5],[-3,6,5],[-3,8,13]],.18,M.gold,28,6);}
      anim.push((dt)=>{for(const q of es){const u=(clock*.45+q.i/18)%1;q.st.position.z=-12+u*24;q.st.position.y=-4.1+u*8;}});
      for(let z=-25;z<=25;z+=12){add(1,17,1,0,5,z,M.gold);lamp(0,8,z,0xffe1b2);}
      sign('GRAND MALL',0,23,-35,24,3,'#2d314f','#ffe4a0');
    } else if(id==='airport') {
      // Check-in islands, departure board, baggage carousel and gate bridges.
      for(let row=0;row<2;row++)for(let k=0;k<4;k++){const x=-22+k*14;add(5,3,4,x,-1,-25+row*12,M.white);add(4,.3,1,x,1,-25+row*12,M.cyan);sign(`GATE ${String.fromCharCode(65+k)}${row+1}`,x,4,-25+row*12,6,1.5,'#103954','#9ae8ff');}
      for(let k=0;k<8;k++){add(1,6,1,-26+k*7,0,16,M.steel);add(4,.4,2,-26+k*7,3,16,M.dark);}
      const belt=new T.Group();g.add(belt);torus(belt,4,.28,0,-1,2,M.black,Math.PI/2);for(let k=0;k<8;k++){const bag=box(belt,1.4,1,1.1,4*Math.cos(k*Math.PI/4),-.7,2+4*Math.sin(k*Math.PI/4),k%2?M.blue:M.red);}
      anim.push((dt)=>{belt.rotation.y+=dt*.35;});
      for(const side of [-1,1]){add(9,6,17,side*31,0,0,M.glassBlue);add(10,1,18,side*37,3,0,M.steel);for(let z=-24;z<=24;z+=12){add(2,4,2,side*29,1,z,M.white);}}
      sign('DEPARTURES  •  ON TIME',0,20,-34,30,4,'#071c35','#84e9ff');lamp(0,10,0,0xa7ddff);
    } else if(id==='metro') {
      for(const side of [-1,1]){
        add(12,1,64,side*20,-3,0,M.concrete2);add(12,.4,64,side*20,-2,0,M.yellow);
        for(let z=-27;z<=27;z+=13){cyl(g,.8,.9,17,side*13,3,z,M.steel,12);add(10,4,.5,side*20,4,z,M.glassBlue);}
        for(let k=0;k<5;k++){sign(['出口 A','出口 B','乗換','ホーム','中央口'][k],side*20,8,-26+k*13,8,2,'#183e55','#e4f7ff',side<0?Math.PI/2:-Math.PI/2);}
      }
      for(let k=0;k<5;k++){add(1,5,1,-7+k*3,0,-22+k*11,M.steel);add(2,.3,1,-7+k*3,3,-22+k*11,M.yellow);}
      const signal=cyl(g,.3,.3,.6,0,7,-29,M.red,12);const signal2=cyl(g,.3,.3,.6,0,5.8,-29,M.green,12);
      anim.push((dt)=>{signal.material= Math.sin(clock*2)>0?M.red:M.dark;signal2.material=Math.sin(clock*2)>0?M.dark:M.green;});
      addStairs(g,-24,-1,20,8,10,18,M.dark);addStairs(g,24,-1,20,8,10,18,M.dark);
      sign('METRO  •  PLATFORM 01',0,18,-35,24,3,'#082e45','#9ee8ff');lamp(0,9,0,0x9bcfff);
    } else if(id==='factory') {
      for(const side of [-1,1]){
        add(8,1.2,50,side*17,-1,0,M.dark);
        for(let z=-22;z<=22;z+=9){add(6,2,3,side*17,1,z,M.steel);cyl(g,.45,.45,6,side*17,2,z,M.gold,12,Math.PI/2);}
        for(let z=-22;z<=22;z+=12){add(2,17,2,side*25,5,z,M.yellow);}
      }
      const boxes=[];for(let k=0;k<7;k++){const q=box(g,3,2,3,-17,-.8,-20+k*6,M.red);boxes.push(q);}
      const arm=new T.Group();arm.position.set(15,-1,0);g.add(arm);cyl(arm,2.4,2.4,1,0,0,0,M.gold);const shoulder=new T.Group();shoulder.position.y=1;arm.add(shoulder);box(shoulder,1.5,9,1.5,0,4.5,0,M.red,0,0,-.25);const elbow=new T.Group();elbow.position.set(0,8,0);shoulder.add(elbow);box(elbow,1.2,7,1.2,0,3.5,0,M.red,0,0,.55);box(elbow,3,1,3,0,7,0,M.steel);
      anim.push((dt)=>{arm.rotation.y=Math.sin(clock*.8)*.8;shoulder.rotation.z=Math.sin(clock*1.2)*.35;elbow.rotation.z=Math.cos(clock*1.2)*.6;boxes.forEach((q,i)=>q.position.z=-20+((clock*4+i*6)%42));});
      // Overhead travelling crane.
      const crane=box(g,34,.8,2,0,22,0,M.yellow);anim.push((dt)=>{crane.position.z=Math.sin(clock*.25)*22;});
      sign('ASSEMBLY LINE 07',0,26,-36,22,3,'#2e3033','#ffe28e');lamp(0,13,0);
    } else if(id==='aquarium') {
      // Transparent cylindrical tunnel lets the coaster pass through a water volume.
      const waterBox=box(g,54,22,72,0,1,0,M.water);waterBox.material=mat(C.water,{transparent:true,opacity:.12,roughness:.1,depthWrite:false,double:true});
      const tubeMesh=new T.Mesh(new T.CylinderGeometry(10.2,10.2,64,40,1,true),M.glass);tubeMesh.rotation.x=Math.PI/2;tubeMesh.position.y=0;g.add(tubeMesh);
      for(const z of [-31,31]){torus(g,10,.35,0,0,z,M.steel,Math.PI/2);}
      for(const side of [-1,1]){for(let k=0;k<12;k++){const x=side*(14+Math.sin(k*1.8)*5),z=-27+k*5;const rock=sphere(g,2.3,x,-4,z,k%3?M.stone:M.wood,8,6);rock.scale.y=.7;for(let j=0;j<3;j++)cyl(g,.22,.05,3,x+j*.5,-2,z,M.green,7,0,0,(j-1)*.15);}}
      const fish=[];for(let i=0;i<12;i++){const f=new T.Group();g.add(f);const fm=mat([0xffb35c,0x63c9e8,0xffe07b,0xe08bdb][i%4]);sphere(f,.65,0,0,0,fm,8,6);const tail=box(f,.12,.05,1,0,0,-.8,fm,0,.6,0);fish.push({f,i,tail});}
      const bubbles=[];for(let i=0;i<16;i++)bubbles.push(sphere(g,.16+(i%3)*.08,-18+(i%6)*7,-2,-28+(i*7)%56,M.glass,8,6));
      anim.push((dt)=>{fish.forEach(({f,i})=>{f.position.set(Math.sin(clock*.45+i)*17,Math.sin(clock*1.4+i)*3,((clock*5+i*9)%58)-29);f.rotation.y=Math.cos(clock*.45+i)>0?Math.PI:0;});bubbles.forEach((q,i)=>{q.position.y=-5+((clock*2+i*2)%14);});});
      sign('OCEAN TUNNEL',0,13,-34,20,3,'#06466a','#a5f5ff');lamp(0,6,0,0x33baff);
    } else if(id==='greenhouse') {
      for(let z=-30;z<=30;z+=10){const pts=[];for(let j=0;j<=18;j++){const a=Math.PI*j/18;pts.push([-26*Math.cos(a),-4+31*Math.sin(a),z]);}tube(g,pts,.32,M.steel,36,6);}
      for(let x of [-25,25]){cyl(g,.6,.8,30,x,11,0,M.wood,10);}
      for(let side of [-1,1])for(let i=0;i<8;i++){const z=-28+i*8,x=side*(17+(i%2)*4);cyl(g,.65,.8,4,x,-1,z,M.wood,10);const crown=sphere(g,3.1,x,3,z,mat(i%2?0x3f8f56:0x2f7047),10,7);crown.scale.set(1,1.45,1);for(let j=0;j<3;j++)sphere(g,.55,x+(j-1)*2,5,z+(j%2?1:-1),M.yellow,8,6);}
      const sprinkler=new T.Group();sprinkler.position.set(0,17,0);g.add(sprinkler);cyl(sprinkler,.4,.4,1,0,0,0,M.steel);for(let i=0;i<6;i++)tube(sprinkler,[[0,0,0],[Math.cos(i*Math.PI/3)*4,-1,Math.sin(i*Math.PI/3)*4],[Math.cos(i*Math.PI/3)*8,-4,Math.sin(i*Math.PI/3)*8]],.08,M.cyan,10,5);
      anim.push((dt)=>{sprinkler.rotation.y+=dt*.6;});
      sign('BOTANICAL DOME',0,26,-34,22,3,'#245a3a','#d6ffc0');lamp(0,15,0,0xd5ffc8);
    } else if(id==='cathedral') {
      for(let side of [-1,1])for(let z=-30;z<=30;z+=14){cyl(g,.95,1.15,38,side*21,13,z,M.stone,14);cyl(g,1.3,1.3,1.2,side*21,-2,z,M.gold,14);cyl(g,1.25,1.25,1,side*21,31,z,M.gold,14);}
      for(let z=-30;z<=30;z+=14){tube(g,[[-21,30,z],[-13,37,z],[-7,30,z],[0,37,z],[7,30,z],[13,37,z],[21,30,z]],.55,M.stone,28,8);}
      for(let side of [-1,1])for(let z=-24;z<=24;z+=12){const panel=box(g,.4,12,7,side*28,17,z,M.glassBlue);panel.material=mat(side<0?0x4f78c8:0x9a4c9a,{emissive:side<0?0x172e80:0x52155f,emissiveIntensity:.25});}
      const chand=new T.Group();chand.position.set(0,22,0);g.add(chand);cyl(chand,.3,.3,8,0,0,0,M.gold);torus(chand,4,.3,0,-4,0,M.gold);for(let i=0;i<8;i++)sphere(chand,.5,4*Math.cos(i*Math.PI/4),-4,4*Math.sin(i*Math.PI/4),M.warm,8,6);
      sign('SANCTUARY',0,31,-35,17,3,'#352d40','#f6dfac');lamp(0,18,0,0xffd9a1);
    } else if(id==='haunted') {
      for(let side of [-1,1])for(let k=0;k<5;k++){const z=-26+k*13;add(5,10,.7,side*18,1,z,M.wood);add(4,7,.3,side*18,1,z,M.dark);torus(g,2.1,.14,side*18,2,z+.3,M.gold,0,Math.PI/2);sign(`ROOM ${2+k}0${side<0?'L':'R'}`,side*18,8,z,5,1.5,'#30242a','#d6b8a0',side<0?Math.PI/2:-Math.PI/2);}
      for(let side of [-1,1])for(let z=-28;z<=28;z+=14){const l=pointLight(g,0xff9a55,side*9,6,z,14,.6);anim.push((dt)=>{l.intensity=.35+Math.max(0,Math.sin(clock*4+z))*1.3;});}
      const ghost=new T.Group();g.add(ghost);const gh= new T.Mesh(new T.SphereGeometry(2.4,12,8),mat(0xd9f5ff,{transparent:true,opacity:.58,emissive:0x9bd6ff,emissiveIntensity:.35}));gh.scale.set(.7,1.35,.55);ghost.add(gh);for(let i=0;i<3;i++)sphere(ghost,.6,(i-1)*1.1,-2.7,0,mat(0xc8efff,{transparent:true,opacity:.5}),8,6);
      anim.push((dt,local,active)=>{const t=active&&local&&Math.abs(local.z)<20?1:0;ghost.visible=clock%18>7&&clock%18<12;ghost.position.set(mix(-18,18,(Math.sin(clock*.65)+1)/2),2+Math.sin(clock*2)*2,Math.sin(clock*.7)*14);if(t)ghost.position.y+=Math.sin(clock*9)*.8;});
      sign('ROOMS  •  NO VACANCY',0,21,-35,24,3,'#2b2028','#e7c9a6');
    } else if(id==='parking') {
      for(let floor=0;floor<3;floor++){const y=-2+floor*8;for(const x of [-24,24]){cyl(g,.9,1.1,8,x,y+4,0,M.steel,12);}
        for(const side of [-1,1])for(let k=0;k<4;k++){const z=-24+k*16;box(g,14,.25,7,side*14,y,z,M.concrete2);box(g,6,.2,.2,side*14,y+.2,z+3,M.yellow);makeCarShape(g,side*14,y+1,z,([0x447ca9,0x9a483d,0xaaaaaa,0xd3b45d][k]),.72);}}
      const ramp=box(g,13,.7,42,sideValue(-15),4,0,M.dark,0,0,-.16);const ramp2=box(g,13,.7,42,15,12,0,M.dark,0,0,.16);
      for(let side of [-1,1])for(let z=-26;z<=26;z+=13){pointLight(g,side<0?0xffc36b:0x8cd8ff,side*27,4,z,14,.5);}
      sign('PARKING  •  B3',0,23,-35,18,3,'#303a42','#ffe2a2');
    } else if(id==='datacenter') {
      const fans=[];for(let side of [-1,1])for(let z=-26;z<=26;z+=9){add(7,13,4,side*18,2,z,M.dark);for(let y=0;y<3;y++){add(6,2.5,.5,side*18,-2+y*4,z+2.1,M.steel);for(let i=0;i<3;i++){const l=box(g,.25,.25,.12,side*18-2+i*2,-2+y*4,z+2.5,[M.green,M.cyan,M.red][i]);fans.push(l);}}
        const fan=new T.Group();fan.position.set(side*18,5,z-2.2);g.add(fan);torus(fan,1.25,.15,0,0,0,M.steel);for(let a=0;a<4;a++)box(fan,.25,.2,2,Math.cos(a*Math.PI/2)*.55,Math.sin(a*Math.PI/2)*.55,0,M.cyan,0,0,a*Math.PI/2);fan.userData.spin=true;fans.push(fan);}
      anim.push((dt)=>{for(const q of fans){if(q.userData.spin)q.rotation.z+=dt*7;else q.material=Math.sin(clock*5+q.position.x)>0?M.green:M.dark;}});
      sign('DATA CENTER  •  CORE 04',0,19,-35,24,3,'#092b38','#80f4ff');lamp(0,10,0,0x75e9ff);
    } else if(id==='power') {
      for(const side of [-1,1]){for(let k=0;k<4;k++){const z=-24+k*16;const pipe=cyl(g,1.1,1.1,13,side*18,7,z,M.steel,20,Math.PI/2);torus(g,1.2,.2,side*18,7,z+6,M.gold,Math.PI/2);}}
      const gen=new T.Group();gen.position.set(0,1,0);g.add(gen);cyl(gen,6,6,16,0,1,0,M.steel,32,Math.PI/2);for(let i=0;i<12;i++){const a=i*Math.PI/6;box(gen,1,8,.8,Math.cos(a)*4,1,Math.sin(a)*4,M.gold,0,a,0);}
      const rotor=torus(g,9,.6,0,3,0,M.cyan,Math.PI/2);const core=cyl(g,3,3,2,0,3,0,M.gold,32,Math.PI/2);
      const steam=[];for(let s=0;s<3;s++){const q=sphere(g,1.8,-22+s*22,8,24,M.glass,10,7);steam.push(q);}
      anim.push((dt)=>{gen.rotation.z+=dt*1.4;rotor.rotation.z+=dt*.9;steam.forEach((q,i)=>{q.position.y=4+Math.abs(Math.sin(clock*1.5+i))*8;q.scale.setScalar(1+Math.abs(Math.sin(clock*1.5+i))*1.5);});});
      sign('POWER GENERATION',0,25,-35,22,3,'#30373b','#ffe39b');lamp(0,15,0,0xffcc79);
    } else if(id==='ship') {
      // Internal cross-section of a ship: bulkheads, portholes, engines and moving pistons.
      for(const side of [-1,1]){for(let z=-29;z<=29;z+=10){const p=torus(g,1.8,.22,side*25,7,z,M.gold,0,Math.PI/2);sphere(g,1.45,side*25,7,z,M.glassBlue,16,10);add(1,22,1,side*28,7,z,M.steel);}}
      for(let z=-25;z<=25;z+=12){tube(g,[[-25,16,z],[-20,23,z],[0,27,z],[20,23,z],[25,16,z]],.45,M.steel,28,7);}
      const engine=cyl(g,5.8,5.8,12,0,1,0,M.dark,32,Math.PI/2);const fly=torus(g,6.2,.5,0,2,0,M.gold,Math.PI/2);
      const pistons=[];for(let side of [-1,1]){const q=cyl(g,.55,.55,8,side*10,4,-8,M.steel,12);pistons.push(q);}
      anim.push((dt)=>{fly.rotation.z+=dt*2.2;pistons.forEach((q,i)=>{q.position.y=3+Math.sin(clock*4+i*Math.PI)*2;});});
      for(let z=-25;z<=25;z+=10){add(45,.6,1,0,20,z,M.wood);}
      sign('ENGINE ROOM  •  DECK 02',0,23,-35,24,3,'#293b4d','#d8efff');lamp(0,12,0);
    } else if(id==='hangar') {
      // Wide aircraft maintenance bay and sliding doors at both ends.
      const doors=[];for(const zz of [-37,37]){const door=new T.Group();door.position.z=zz;g.add(door);const left=box(door,25,25,1,-12.5,0,0,M.steel);const right=box(door,25,25,1,12.5,0,0,M.steel);doors.push({left,right});}
      anim.push((dt,local,active)=>{const open=active&&local&&Math.abs(local.z)<58?1:0;for(const d of doors){d.left.position.x=mix(-12.5,-27,open);d.right.position.x=mix(12.5,27,open);}});
      // Parked aircraft silhouette at the side, away from the central ride corridor.
      const planeG=new T.Group();planeG.position.set(-22,1,0);g.add(planeG);cyl(planeG,1.2,1.55,24,0,0,0,M.white,24,Math.PI/2);box(planeG,18,.5,5,0,.3,0,M.white);box(planeG,7,.35,3,0,.5,-9,M.steel);box(planeG,3,4,3,0,1,-10,M.white);for(let x of [-5,5])cyl(planeG,.35,.35,2,x,-1,0,M.dark,12,Math.PI/2);
      for(let x=-30;x<=30;x+=10){add(1,26,1,x,12,0,M.steel);add(2,.2,8,x,27,0,M.warm);}
      for(let side of [-1,1])for(let z=-25;z<=25;z+=15){add(9,3,5,side*31,-1,z,M.yellow);add(3,2,2,side*31,2,z,M.red);}
      sign('AIRCRAFT MAINTENANCE',0,26,-35,26,3,'#344b60','#d7efff');lamp(0,18,0);
    } else if(id==='planetarium') {
      const dome=new T.Mesh(new T.SphereGeometry(31,32,18,0,Math.PI*2,0,Math.PI/2),M.dark);dome.position.y=-4;g.add(dome);
      for(let z=-28;z<=28;z+=14){const pts=[];for(let i=0;i<=20;i++){const a=Math.PI*i/20;pts.push([-29*Math.cos(a),-4+29*Math.sin(a),z]);}tube(g,pts,.25,M.steel,30,6);}
      const planet=new T.Group();planet.position.set(0,8,0);g.add(planet);sphere(planet,6,0,0,0,mat(0x3e7eb0),24,16);torus(planet,9,.45,0,0,0,M.gold,.35,.2,0);sphere(planet,1.5,12,0,0,M.red,12,8);const orbit=new T.Group();g.add(orbit);orbit.position.set(0,7,0);for(let i=0;i<6;i++){const a=i*Math.PI/3;sphere(orbit,.42,20*Math.cos(a),10*Math.sin(a),0,M.warm,8,6);}
      anim.push((dt)=>{planet.rotation.y+=dt*.4;orbit.rotation.y+=dt*.22;});
      for(let i=0;i<48;i++){const a=i*2.4,r=24+(i%6);sphere(g,.12+(i%3)*.05,Math.cos(a)*r,5+(i%9)*2,Math.sin(a)*r,M.white,6,4);}
      sign('PLANETARIUM',0,21,-34,19,3,'#101b37','#d4d9ff');lamp(0,13,0,0xaabaff);
    } else if(id==='castle') {
      for(let side of [-1,1]){add(15,25,70,side*25,7,0,M.stone);for(let z=-30;z<=30;z+=8){add(5,4,4,side*25,22,z,M.concrete2);}
        for(let k=0;k<3;k++){const zz=-22+k*22;const tower=cyl(g,5,6,32,side*27,11,zz,M.stone,12);cyl(g,6,0,7,side*27,30,zz,M.brick,12);}}
      const gate=new T.Group();gate.position.set(0,0,-36);g.add(gate);for(let x=-8;x<=8;x+=2.5)box(gate,.6,16,.6,x,0,0,M.steel);for(let y=-6;y<=6;y+=3)box(gate,18,.6,.6,0,y,0,M.gold);
      anim.push((dt,local,active)=>{const up=active&&local&&local.z>-58&&local.z<-12?1:0;gate.position.y=mix(gate.position.y,up?18:0,1-Math.exp(-dt*1.8));});
      const bridge=box(g,18,.7,16,0,-3,29,M.wood,.35,0,0);const hinge=new T.Group();hinge.position.set(0,-3,21);g.add(hinge);g.remove(bridge);hinge.add(bridge);bridge.position.set(0,0,8);
      anim.push((dt,local,active)=>{const down=active&&local&&local.z>12&&local.z<50?1:0;hinge.rotation.x=mix(hinge.rotation.x,down?0:.65,1-Math.exp(-dt*1.2));});
      sign('FORTRESS GATE',0,26,-35,20,3,'#39352e','#f4d59a');lamp(0,12,0,0xffd49a);
    } else if(id==='mine') {
      // Rough rock tunnel envelope with timber portal frames and glowing crystal clusters.
      for(let z=-32;z<=32;z+=8){const pts=[[-23,-3,z],[-22,10,z],[-14,19,z],[0,21,z],[14,19,z],[22,10,z],[23,-3,z]];tube(g,pts,1.8,M.stone,32,8);for(let side of [-1,1]){box(g,1,13,1,side*20,4,z,M.wood);box(g,44,1.1,1,0,16,z,M.wood);}}
      for(let side of [-1,1])for(let k=0;k<7;k++){const x=side*(15+(k%2)*5),z=-27+k*9;const c=cyl(g,.3,.9,3,x,-1,z,k%2?M.cyan:M.purple,6);c.rotation.z=(k%2?1:-1)*.28;}
      const cart=new T.Group();g.add(cart);box(cart,5,2,7,0,-2,0,M.dark);for(let x of [-2,2])for(let z of [-2,2])cyl(cart,.8,.8,.7,x,-3,z,M.steel,12,Math.PI/2);for(let i=0;i<5;i++)sphere(cart,1.2,-1.5+i*.7,-.2,0,i%2?M.gold:M.concrete2,8,6);
      anim.push((dt)=>{cart.position.z=-25+((clock*5)%50);});
      sign('DEEP MINE  •  LEVEL 06',0,19,-36,22,3,'#302b27','#bceeff');lamp(0,12,0,0x6ceaff);
    } else if(id==='neon') {
      for(let side of [-1,1]){
        for(let k=0;k<5;k++){const z=-30+k*15,hh=24+(k%3)*7;add(17,hh,14,side*30,(hh-4)/2,z,k%2?M.dark:M.steel);for(let floor=0;floor<4;floor++){for(let x=0;x<3;x++)add(3,3,.25,side*(23+x*6),-1+floor*6,z+7.1,M.glassBlue);}
          sign(['NIGHT MARKET','ARCADE','RAMEN','LIVE','HOTEL'][k],side*22,7,z,11,2,'#101b36',k%2?'#55f8eb':'#ff66ce',side<0?Math.PI/2:-Math.PI/2);}
      }
      for(let z=-24;z<=24;z+=16){box(g,56,1.4,3,0,18,z,M.steel);box(g,48,.3,2,0,19,z,M.cyan);}
      const cars=[];for(let i=0;i<4;i++)cars.push(makeCarShape(g,-12+i*8,-3,-25+i*15,[0x1a98b6,0xba4b79,0xcea33a,0x4a68b3][i],.85));
      anim.push((dt)=>{cars.forEach((c,i)=>{c.position.x=-24+((clock*8+i*14)%48);c.position.z=-25+i*15;});});
      for(let x=-25;x<=25;x+=10){pointLight(g,x%2?0x21e9ff:0xff42c8,x,9,0,28,.8);}
      sign('NEON DISTRICT  •  03:17',0,26,-35,28,3,'#15112d','#ff78e6');
    }
    // Every site gets visible threshold lights and a strong architectural identity.
    for(const z of [-b.d/2+4,b.d/2-4])for(const x of [-10,10]){box(g,1,1,1,x,-3.2,z,M.cyan);pointLight(g,0x4bcfff,x,-2.5,z,9,.45);}
    g.userData.caType=id;
    return {group:g,type:id,name:spec.name,animators:anim,depth:b.d,width:b.w,created:Date.now(),frame:null};
  }
  function routeFrame(percent) {
    const d=editor.design;
    if(!d||!Array.isArray(d.pts)||d.pts.length<2)throw new Error('先にコースを描いてください');
    const pts=d.pts, cum=[0];let total=0;
    for(let i=1;i<pts.length;i++){total+=Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]);cum.push(total);}
    if(total<30)throw new Error('コースが短すぎます。30m以上のコースを作ってください');
    const target=clamp(percent,0.08,.92)*total;
    let idx=1;while(idx<cum.length-1&&cum[idx]<target)idx++;
    const seg=cum[idx]-cum[idx-1]||1,t=(target-cum[idx-1])/seg;
    const p0=pts[idx-1],p1=pts[idx];
    const x=mix(p0[0],p1[0],t),z=mix(p0[1],p1[1],t);
    let dx=p1[0]-p0[0],dz=p1[1]-p0[1],len=Math.hypot(dx,dz)||1;dx/=len;dz/=len;
    const hs=Array.isArray(d.hs)&&d.hs.length>1?d.hs:null;
    const hu=target/total*(hs?hs.length-1:0);
    const hi=hs?Math.floor(hu):0,hy=hs?mix(Number(hs[hi])||2,Number(hs[Math.min(hs.length-1,hi+1)])||2,hu-hi):2;
    let deviation=0;
    for(let k=Math.max(0,idx-4);k<Math.min(pts.length,idx+5);k++){
      const px=pts[k][0]-x,pz=pts[k][1]-z;
      deviation=Math.max(deviation,Math.abs(px*dz-pz*dx));
    }
    return {x,y:hy,z,yaw:Math.atan2(dx,dz),percent:target/total,deviation,total};
  }
  function addAtRoute(type, percent, scale=1) {
    if(structures.length>=MAX_STRUCTURES)throw new Error(`同時配置は${MAX_STRUCTURES}施設までです。不要な施設を削除してください`);
    const frame=routeFrame(percent),item=build(type);
    item.frame={x:frame.x,y:frame.y,z:frame.z,yaw:frame.yaw};
    item.group.position.set(frame.x,frame.y,frame.z);item.group.rotation.y=frame.yaw;item.group.scale.setScalar(scale);
    item.group.updateMatrixWorld(true);scene.add(item.group);structures.push(item);selectedId=item.group.uuid;
    refreshList();
    const curveMsg=frame.deviation>8?' 注意：この付近はカーブが強いため、通過位置を確認してください。':'';
    setStatus(`${item.name}をコースの${Math.round(frame.percent*100)}%地点に配置しました。標準通路幅18m・高さ14mを確保しています（サイズ倍率で変化します）。${curveMsg}`);
    return item;
  }
  function refreshList() {
    const host=panel.querySelector('[data-ca-list]');if(!host)return;
    host.innerHTML='';
    if(!structures.length){host.textContent='配置した建築物はありません。';return;}
    structures.forEach(s=>{
      const row=document.createElement('div');row.className='ca-item';
      const info=document.createElement('span');info.textContent=`${s.name} ${s.group.scale.x.toFixed(1)}×`;
      const select=document.createElement('button');select.textContent=selectedId===s.group.uuid?'選択中':'選択';select.dataset.caSelect=s.group.uuid;
      const remove=document.createElement('button');remove.textContent='削除';remove.dataset.caRemove=s.group.uuid;
      row.append(info,select,remove);host.appendChild(row);
    });
    updateControls();
  }
  function chosen(){return structures.find(s=>s.group.uuid===selectedId)||null;}
  function updateControls(){const s=chosen();const el=panel.querySelector('[data-ca-selected]');if(el)el.textContent=s?`選択：${s.name}`:'選択：なし';const del=panel.querySelector('[data-ca-delete]');if(del)del.disabled=!s;}
  function removeItem(s){if(!s)return;scene.remove(s.group);s.group.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material&&!o.material.userData.caShared){const a=Array.isArray(o.material)?o.material:[o.material];a.forEach(m=>{if(m.map)m.map.dispose();m.dispose();});}});structures.splice(structures.indexOf(s),1);selectedId=structures.length?structures[structures.length-1].group.uuid:null;refreshList();}
  function setStatus(s,bad=false){const el=panel.querySelector('[data-ca-status]');if(el){el.textContent=s;el.classList.toggle('bad',bad);}}
  function serialize(){return structures.map(s=>({type:s.type,position:s.group.position.toArray(),rotation:s.group.rotation.toArray(),scale:s.group.scale.toArray()}));}
  function restore(items){for(const s of [...structures])removeItem(s);for(const it of (Array.isArray(items)?items:[]).slice(0,MAX_STRUCTURES)){if(!TYPES.some(t=>t.id===it.type))continue;const s=build(it.type);if(Array.isArray(it.position)&&it.position.length===3)s.group.position.fromArray(it.position);if(Array.isArray(it.rotation)&&it.rotation.length===3)s.group.rotation.fromArray(it.rotation);if(Array.isArray(it.scale)&&it.scale.length===3)s.group.scale.fromArray(it.scale);s.frame={x:s.group.position.x,y:s.group.position.y,z:s.group.position.z,yaw:s.group.rotation.y};s.group.updateMatrixWorld(true);scene.add(s.group);structures.push(s);}selectedId=structures.length?structures[structures.length-1].group.uuid:null;refreshList();}

  panel.innerHTML = `
    <div class="ca-intro"><b>19種類の建築アトラクション</b><span>コースの途中に実寸感のある建築物を設置し、その内部を車両が通過します。各施設には内装・照明・専用の動く仕掛けがあります。</span></div>
    <div class="ca-grid">
      <label>施設<select data-ca-type>${TYPES.map(t=>`<option value="${t.id}">${t.name}</option>`).join('')}</select></label>
      <label>コース上の位置 <output data-ca-pos-label>55%</output><input type="range" min="8" max="92" value="55" data-ca-pos></label>
      <label>建築サイズ <output data-ca-scale-label>1.0×</output><input type="range" min="0.65" max="1.8" step="0.05" value="1" data-ca-scale></label>
    </div>
    <div class="ca-description" data-ca-description>${TYPES[0].sub}</div>
    <div class="ca-actions"><button data-ca-place>選択した施設をコースに設置</button><button data-ca-chain>コースに3施設を連続配置</button></div>
    <div class="ca-selected" data-ca-selected>選択：なし</div>
    <div class="ca-actions"><button data-ca-delete disabled>選択施設を削除</button><button data-ca-clear>建築物を全削除</button><button data-ca-run>配置を確認する（走行）</button></div>
    <div class="ca-list-title">配置済み施設 <small data-ca-count>0 / ${MAX_STRUCTURES}</small></div><div class="ca-list" data-ca-list>配置した建築物はありません。</div>
    <div class="ca-status" data-ca-status>コースを作成して施設を選択してください。</div>
    <div class="ca-small">設計上の走行ルートに沿って配置します。曲率の強い場所では建物の通路と線路がずれる場合があるため、位置スライダーを調整してください。施設はプロジェクトZIPとGLB出力に含まれます。</div>
  `;
  const style=document.createElement('style');style.id='ca-architecture-style';style.textContent=`
    .ca-intro{display:grid;gap:4px;padding:10px;border:1px solid #cbd5df;border-radius:9px;background:#f1f6f8;color:#26384a;font-size:12px;line-height:1.5}.ca-intro b{font-size:14px}
    .ca-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:9px}.ca-grid label{display:grid;gap:5px;font-size:12px;color:#40516b}.ca-grid label:first-child{grid-column:1/-1}.ca-grid select{height:36px;padding:5px;border:1px solid #b9c8d2;border-radius:7px;background:white;color:#25384a;font:inherit}.ca-grid input{width:100%;accent-color:#2682aa}.ca-grid output{font-weight:700;color:#244960}.ca-description{font-size:12px;color:#53687a;padding:5px 2px}
    .ca-actions{display:flex;flex-wrap:wrap;gap:7px;margin:8px 0}.ca-actions button,.ca-item button{min-height:35px;padding:6px 10px;border:1px solid #b7c7d1;border-radius:7px;background:#fff;color:#25384a;font:700 12px system-ui}.ca-actions button:first-child{background:#e4f3fa;border-color:#8bbbd2}.ca-actions button:disabled{opacity:.4}.ca-selected{font-weight:700;font-size:12px;padding:7px;border-radius:7px;background:#e9eef2;color:#344b5e}.ca-list-title{display:flex;justify-content:space-between;margin:12px 0 5px;font-weight:700;font-size:12px;color:#334b60}.ca-list{display:grid;gap:5px}.ca-item{display:flex;align-items:center;gap:6px;padding:6px;border:1px solid #d4dde4;border-radius:7px;background:#fff}.ca-item span{flex:1;min-width:0;font-size:11px;color:#354c60}.ca-item button{min-height:28px;padding:4px 7px;font-size:10px}.ca-status{margin-top:9px;padding:8px;border-radius:7px;background:#eaf1f5;color:#3d5669;font-size:11px;white-space:pre-wrap}.ca-status.bad{background:#fff0ed;color:#a83b2a}.ca-small{margin-top:7px;font-size:10px;line-height:1.5;color:#6a7c8c}
    @media(max-width:520px){.ca-grid{grid-template-columns:1fr}.ca-grid label:first-child{grid-column:auto}.ca-actions button{flex:1 1 140px}.ca-item{flex-wrap:wrap}}
  `;document.head.appendChild(style);
  const typeSel=panel.querySelector('[data-ca-type]'),posRange=panel.querySelector('[data-ca-pos]'),scaleRange=panel.querySelector('[data-ca-scale]');
  typeSel.addEventListener('change',()=>{const t=TYPES.find(x=>x.id===typeSel.value);panel.querySelector('[data-ca-description]').textContent=t.sub;});
  posRange.addEventListener('input',()=>panel.querySelector('[data-ca-pos-label]').textContent=`${posRange.value}%`);
  scaleRange.addEventListener('input',()=>panel.querySelector('[data-ca-scale-label]').textContent=`${Number(scaleRange.value).toFixed(2)}×`);
  panel.addEventListener('click',e=>{
    const select=e.target.closest('[data-ca-select]');if(select){selectedId=select.dataset.caSelect;refreshList();return;}
    const rem=e.target.closest('[data-ca-remove]');if(rem){removeItem(structures.find(s=>s.group.uuid===rem.dataset.caRemove));return;}
    const b=e.target.closest('button');if(!b)return;
    try{
      if(b.hasAttribute('data-ca-place')) addAtRoute(typeSel.value,Number(posRange.value)/100,Number(scaleRange.value));
      else if(b.hasAttribute('data-ca-chain')){const d=editor.design;const length=(d&&Array.isArray(d.pts)?d.pts:[]).slice(1).reduce((sum,p,i)=>sum+Math.hypot(p[0]-d.pts[i][0],p[1]-d.pts[i][1]),0);if(length<360)throw new Error('3施設連続配置には、コース長360m以上が必要です。コースを延長してください。');const ids=['urban','mall','neon'];ids.forEach((id,i)=>addAtRoute(id,[.27,.51,.75][i],.78));setStatus('3施設を連続配置しました。都市街区→モール→ネオン街の内部を順番に通過します。');}
      else if(b.hasAttribute('data-ca-delete')) removeItem(chosen());
      else if(b.hasAttribute('data-ca-clear')){for(const s of [...structures])removeItem(s);setStatus('配置した建築物をすべて削除しました。');}
      else if(b.hasAttribute('data-ca-run')){if(!editor.design||!editor.design.pts||editor.design.pts.length<2)throw new Error('先にコースを作成してください');editor.btnRun.click();}
    }catch(err){console.error('[Architecture Pack]',err);setStatus(`エラー：${err.message||err}`,true);}
  });

  function update(dt) {
    clock+=dt;
    const sim=api.co&&api.co.sim, car=sim&&sim.cars&&sim.cars[0], f=car&&car.f;
    const active=api.mode==='ride';let world=null;
    if(active&&f&&Number.isFinite(f.x)&&Number.isFinite(f.y)&&Number.isFinite(f.z))world=new T.Vector3(f.x,f.y,f.z);
    for(const s of structures){
      let local=null;if(world){s.group.updateMatrixWorld(true);local=s.group.worldToLocal(world.clone());}
      for(const fn of s.animators){try{fn(dt,local,active);}catch(err){console.warn('[Architecture animation]',s.type,err);}}
    }
  }
  rafTimer=setInterval(()=>update(.08),80);
  refreshList();
  panel.querySelector('[data-ca-count]').textContent=`${structures.length} / ${MAX_STRUCTURES}`;
  // Keep the count accurate after every add/remove/restore.
  const countTimer=setInterval(()=>{const el=panel.querySelector('[data-ca-count]');if(el)el.textContent=`${structures.length} / ${MAX_STRUCTURES}`;},500);
  api.architecturePack={structures,serialize,restore,getMeshes:()=>structures.map(s=>s.group),destroy(){clearInterval(rafTimer);clearInterval(countTimer);for(const s of [...structures])removeItem(s);style.remove();delete api.architecturePack;}};
  return api.architecturePack;
}

function sideValue(v){return v;}
