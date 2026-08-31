import pw from '/home/jho4255/ArtLink/e2e/node_modules/playwright/index.js';
const { chromium } = pw;
const b = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport:{width:1240,height:1000} });
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
p.on('console',m=>{ if(m.type()==='error') errs.push(m.text().slice(0,160)); });
await p.goto('http://localhost:5173/artlook/index.html',{waitUntil:'networkidle'});
await p.waitForTimeout(4000);
const names = await p.evaluate(()=>FRAMES.map(f=>f.name));
console.log('액자 이름:', names.join(' / '));
// 플로터를 골랐을 때 매트 줄이 켜지는가
const st = await p.evaluate(async ()=>{
  const wait=(ms)=>new Promise(r=>setTimeout(r,ms));
  const out={};
  for(const [label,idx] of [['플로터',6],['캔버스랩',17],['사진액자',0]]){
    state.frameIdx=idx; updateMatRow(); await wait(60);
    const row=document.getElementById('matRow');
    out[label]={op:row.style.opacity, pe:row.style.pointerEvents,
      hint:document.getElementById('matHint').style.display};
  }
  state.frameIdx=0; updateMatRow();
  // 조명 슬라이더
  const lo=document.getElementById('lightOp');
  out.light={min:lo.min,max:lo.max,value:lo.value, sel:!!document.getElementById('lightSel')};
  return out;
});
console.log(JSON.stringify(st,null,1));
await p.evaluate(()=>{ const lo=document.getElementById('lightOp'); lo.value=60; lo.oninput(); });
await p.waitForTimeout(600);
await p.screenshot({path:'ui_artlook.png'});
console.log('에러:', errs.length? [...new Set(errs)] : '없음');
await b.close();
