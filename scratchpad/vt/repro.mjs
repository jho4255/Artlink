import pw from '/home/jho4255/ArtLink/e2e/node_modules/playwright/index.js';
import { writeFileSync } from 'node:fs';
const URL='https://pub-e87cde18dad54847b656f80cf0ae7b28.r2.dev/artlink/1784860091710-401674586.jpg';
const b=await pw.chromium.launch({args:['--use-gl=swiftshader','--enable-unsafe-swiftshader']});
const p=await b.newPage({viewport:{width:1400,height:900}});
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
p.on('console',m=>{ if(m.type()==='error') errs.push(m.text().slice(0,120)); });
await p.goto('http://localhost:5173/artlook/index.html',{waitUntil:'networkidle'});
await p.waitForTimeout(3600);
const info=await p.evaluate(async(u)=>{
  const src='/api/upload/image-proxy?url='+encodeURIComponent(u);
  await new Promise((res,rej)=>{ const im=new Image(); im.crossOrigin='anonymous';
    im.onload=()=>{ window.__nat=[im.naturalWidth,im.naturalHeight]; state.img=capToCanvas(im); res(); };
    im.onerror=()=>rej(new Error('load fail')); im.src=src; });
  return {natural:window.__nat, capped:[state.img.width,state.img.height],
          mode:state.mode, scene:(SCENES[state.sceneIdx]||{}).id, frame:FRAMES[state.frameIdx].name, mat:state.matWidth};
}, URL);
console.log('원본', info.natural, '→ cap', info.capped, ' 비율', (info.capped[0]/info.capped[1]).toFixed(4));
console.log('기본 상태:', info.mode, info.scene, info.frame, 'mat='+info.mat);
const shots=[];
for(const [fname,mat] of [['오크',0.05],['오크',0],['블랙',0.05],['화이트',0.05]]){
  const g=await p.evaluate(async({fname,mat})=>{
    state.frameIdx=FRAMES.findIndex(f=>f.name===fname); state.matWidth=mat;
    selectedWork=null; render(); await new Promise(r=>setTimeout(r,900));
    return {png:document.getElementById('preview').toDataURL('image/png'), probe:window.__artlook};
  },{fname,mat});
  const id=`repro_${fname}_m${mat}`;
  writeFileSync(`${id}.png`, Buffer.from(g.png.split(',')[1],'base64'));
  const pr=g.probe;
  console.log(`${id}  piece=[${['x','y','w','h'].map(k=>Math.round(pr.piece[k]))}]  art=[${['x','y','w','h'].map(k=>Math.round(pr.art[k]))}]  rail=${pr.railPx.toFixed(1)} mat=${pr.matPx.toFixed(1)} framedWH=${pr.framedWH} srcWH=${pr.srcWH}`);
  shots.push(id);
}
console.log('에러:', errs.length?[...new Set(errs)].slice(0,3):'없음');
await b.close();
