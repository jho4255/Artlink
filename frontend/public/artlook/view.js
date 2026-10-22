/* =============================================================================
   ArtLook 보기 전용 — 작가 홈페이지 라이트박스의 [벽에 걸어 보기] (2026-10-22, CLAUDE.md 규칙 74)
   =============================================================================
   작가 홈페이지(PortfolioPage → components/shared/ArtworkViewer · hooks/useWallView)가 `index.html?view=1` 을
   **화면 밖 iframe** 으로 띄우면, 화면(ui.js) 대신 이 파일이 맡는다. 화면은 없다(<html class="view-only"> 가 body 를 감춘다).
   바깥이 작품 사진(Blob)을 보내면 엔진(compose)으로 차콜 벽에 오크 플로터·넓은 매트로 걸어 JPEG 로 돌려준다. 합성은 엔진 그대로다(규칙 36~44k).

   주고받는 말 — 같은 출처, 바깥 창에서 온 것만(바깥은 lib/wallView.ts 의 readWallMessage 로 읽는다)
     바깥 → 여기  artlook:render { req, blob, ss:1|2 }          ss = 합성 배율 — 1 = 초안(빨리) · 2 = 완성(ArtLook 탭 저장과 같은 화질)
     여기 → 바깥  artlook:view-ready                             벽 사진·액자 결 텍스처까지 준비됐다('처음 한 번' 비용도 미리 치렀다)
                  artlook:view-unsupported { reason }            'webgl'·'frame' = 이 브라우저에선 안 된다(바깥이 토글을 감춘다)
                                                                 'scene' = 벽 사진을 못 받았다(다시 해 볼 수 있다)
                  artlook:rendered { req, blob, ratio }
                  artlook:render-failed { req, reason }
                  (WebGL 을 잃으면 view-unsupported { reason:'gl-lost' } — 바깥이 이 iframe 을 버리고 새로 띄운다)

   그리는 규칙
     · 배경은 '차콜'(scenes.json 의 charcoal) 한 장, 액자는 '오크 플로터'(엔진이 그리는 액자 — 결 텍스처 frames/frame-oak-texture.jpg 한 장),
       매트 '넓게'(10%, 미색), 조명 없음. ArtLook 탭에서 같은 셋을 고른 것과 같은 그림이다(2026-10-23 사용자 지정 —
       처음엔 흰 회벽·캔버스 랩·매트 없음, 그다음 사진 액자 '오크'였다).
       액자 자산은 엔진의 ensureFrameAssets 로 받는다(사진 액자면 목록 frames.json → PNG, 절차적 액자면 결 텍스처) — 엔진이 자산마다
       assetArrived 를 부르므로 onAssetArrived 를 여기서 단다(화면 ui.js 는 이 모드에서 돌지 않는다). 못 받으면 엔진이 텍스처 없이 그린다(빈 그림은 없다).
     · 크기는 실치수를 쓰지 않는다(selectedWork = null → 30호 가정 + 자동 프레이밍) — 작품을 보여 주는 창이라 늘 보기 좋게 크게.
       실치수 비교는 ArtLook 탭이 한다(규칙 44c).
     · ⚠️ 출력 비율은 **작품 방향**을 따른다(ratioFor). 가로 캔버스에 세로 작품을 걸면 위아래가 잘린다 — 엔진의 상한(maxLong)이
       '조각 긴 변 ≤ 캔버스 **긴 변**의 70%' 라, 두 긴 변의 축이 같아야 캔버스 안에 든다(2026-10-22 실측: 16:9 에 세로 작품).
     · 워터마크를 찍지 않는다(state.watermark = false) — 작가의 홈페이지 안에서 작품을 보여 주는 그림이고 저장 단추가 없다.
     · ⚠️ requestAnimationFrame 을 쓰지 않는다 — 감춘 문서·화면 밖 iframe 에선 돌지 않을 수 있다. compose() 는 동기라 바로 부른다.
     · 첫 그림은 '처음 한 번' 비용이 크다(벽 사진 해독·텍스처 올리기·광원 측정 — 헤드리스 첫 장 0.6초, 둘째부터 0.2초).
       바깥은 작품 사진을 받는 동안 기다리므로 그 사이에 미리 치른다(warmUp) → 첫 장 0.3초(2026-10-22 실측, scratchpad/wall-view/warm.mjs).
     · ⚠️ **완성은 ArtLook 탭 저장과 같은 화질로** — 합성 배율 2 · 원본 2,600px 상한(엔진의 capToCanvas 그대로).
       속도를 이유로 배율 1·초안 0.6배로 낮췄더니 "아트룩에서 보던 것보다 퀄리티가 개쓰레기"라는 지적을 받았다(2026-10-23).
       액자·매트는 결과 모서리가 세밀해서 캔버스 랩 때는 안 보이던 차이가 드러난다(scratchpad/wall-view/quality.mjs).
       초안(t800·배율 1)은 빨리 보여 주는 용도이고, 그 작품에 머물면 곧 완성으로 바뀐다.
     · ⚠️ localStorage(artlook:works · artlook:prefs)를 읽지도 쓰지도 않는다 — 방문자의 브라우저에 남의 작품 목록을 남기면 안 된다.
     · 같은 출처 iframe 은 바깥 페이지와 **같은 스레드**라 compose() 가 도는 동안 바깥 화면도 멈춘다 — 그래서 바깥이 한 번에 하나만,
       지금 보는 작품을 먼저 보낸다(hooks/useWallView.ts). 여기서도 한 번에 하나만 그린다.
   ============================================================================= */
(function(){
'use strict';
if(typeof VIEW_ONLY==='undefined' || !VIEW_ONLY) return;

const SCENE_ID='charcoal';
const FRAME_ID='floater-oak';
const MAT_WIDTH=0.10;          // ArtLook 탭 매트 [넓게]와 같은 값(ui.js MAT_WIDTHS)
const MAT_COLOR='#f5f2ea';     // 미색 — ArtLook 탭 매트 색 첫 칸(= 엔진 기본값 state.matteColor)
const BLOB_MAX=40*1024*1024;
const parentWin=window.parent!==window ? window.parent : null;

let scene=null, ready=false, dead=null, busy=false;
const queue=[];
const frameIdx=FRAMES.findIndex((f)=>f.id===FRAME_ID);
const frameStyle=frameIdx>=0 ? FRAMES[frameIdx] : null;

function post(msg){
  if(parentWin){ try{ parentWin.postMessage(msg, location.origin); }catch(e){ /* 바깥이 이미 닫혔다 */ } }
  window.__wallViewLast=msg && msg.type;   // 하니스가 본다(주소로 직접 연 경우)
}

/** 작품 방향에 맞춘 출력 비율 — 위 '그리는 규칙' 참고. 경계는 1:1 칸이 너무 넓지 않게 ±8% */
function ratioFor(a){
  if(!(a>0)) return '4:5';
  if(a>=1.6) return '16:9';
  if(a>=1.09) return '5:4';
  if(a>0.92) return '1:1';
  if(a>0.62) return '4:5';
  return '9:16';
}

function fail(reason){
  if(dead) return;
  dead=reason;
  post({ type:'artlook:view-unsupported', reason });
  queue.splice(0).forEach((j)=>post({ type:'artlook:render-failed', req:j.req, reason }));
}

function boot(){
  if(!window.ArtLookScene || !ArtLookScene.supported()){ fail('webgl'); return; }
  if(!frameStyle){ fail('frame'); return; }
  // 액자 자산 — 지금 받기 시작한다(사진 액자는 목록이 와야 받으므로 목록이 올 때 한 번 더 — 엔진이 assetArrived('frames.json'))
  window.onAssetArrived=(key)=>{ if(key==='frames.json') ensureFrameAssets(frameStyle); check(); };
  ensureFrameAssets(frameStyle);
  ArtLookScene.loadScenes('scenes/scenes.json?v='+BUILD, (one, all)=>{
    if(!all) return;
    const base=all.find((s)=>s && s.id===SCENE_ID)
      || all.find((s)=>s && s.src && s.region && (s.group||'wall')==='wall');
    if(!base){ fail('scene'); return; }
    // 목록의 그 장면을 그대로 쓰되 따로 들고 있는다(ArtLook 탭의 사용자 조절 adj 와 섞이지 않게)
    scene=Object.assign({}, base, { adj:{ dx:0, dy:0, s:1 }, loaded:false });
    SCENES=[scene];
    if(ArtLookScene.ensureScene(scene, check)) check();
  });
}

/** 벽 사진·액자 자산이 다 왔으면(액자는 못 받은 것도 '끝남' — 엔진이 대신 그린다) 미리 치르고 준비 신호 */
let warming=false;
function check(){
  if(ready || dead || warming || !scene) return;
  if(scene.failed){ fail('scene'); return; }
  if(!(ArtLookScene.sceneReady(scene) && scene.loaded)) return;
  if(!frameAssetsReady(frameStyle)) return;
  warming=true;
  warmUp().then(()=>{
    if(dead) return;
    if(ArtLookScene.glLost && ArtLookScene.glLost()){ fail('gl-lost'); return; }
    ready=true;
    post({ type:'artlook:view-ready' });
    pump();
  });
}

/**
 * 첫 그림의 '처음 한 번' 비용을 미리 — 바깥이 작품 사진을 받는 동안(위 '그리는 규칙').
 * ①벽 사진 해독(다른 스레드에서) ②광원 측정(장면에 담아 둔다) ③벽 사진을 텍스처로 올리기(같은 열쇠면 다시 안 올린다).
 * 어느 하나가 안 돼도 그리기는 된다 — 그때 첫 장에서 치를 뿐이다.
 */
async function warmUp(){
  try{ if(scene.img && scene.img.decode) await scene.img.decode(); }catch(e){ /* 그릴 때 해독한다 */ }
  try{ ArtLookScene.sceneLightModel(scene); }catch(e){ /* 그릴 때 잰다 */ }
  try{
    // 장면 합성(composeScene)이 넘기는 것과 같은 열쇠(scene.src)로 — 그래야 첫 장에서 다시 올리지 않는다
    const dot=document.createElement('canvas'); dot.width=dot.height=2;
    const S=64;
    ArtLookScene.warp(dot, [[0,0],[S,0],[S,S],[0,S]], S, S,
      { wallAmt:1, sceneImg:scene.img, sceneKey:scene.src, fit:{ dx:0, dy:0, sw:S, sh:S } });
  }catch(e){ /* 그릴 때 올린다 */ }
}

function decode(blob){
  return new Promise((resolve, reject)=>{
    const url=URL.createObjectURL(blob);
    const im=new Image();
    im.decoding='async';
    im.onload=()=>resolve({ im, url });
    im.onerror=()=>{ URL.revokeObjectURL(url); reject(new Error('decode')); };
    im.src=url;
  });
}
function toJpeg(canvas){
  return new Promise((resolve, reject)=>{
    // 0.95 — 매트 결·액자 나뭇결이 남는다(ArtLook 탭 저장 PNG 와 평균 1~2 단계 차이). 0.9 는 결에서 덩어리가 보였다
    try{ canvas.toBlob((b)=> (b ? resolve(b) : reject(new Error('encode'))), 'image/jpeg', 0.95); }
    catch(e){ reject(e); }
  });
}

async function renderJob(job){
  const { im, url }=await decode(job.blob);
  let art;
  try{
    if(!im.naturalWidth || !im.naturalHeight) throw new Error('empty');
    art=capToCanvas(im);          // ArtLook 탭이 작품을 올릴 때와 같은 함수(긴 변 2,600px 상한) — 화질이 같아야 한다
  }finally{
    URL.revokeObjectURL(url);
  }
  const ratio=ratioFor(art.width/art.height);
  Object.assign(state, {
    img:art, mode:'scene', sceneIdx:0, frameIdx, matWidth:MAT_WIDTH, matteColor:MAT_COLOR, light:0, glass:false, weave:false,
    ratio, draft:job.ss!==2, watermark:false,
  });
  selectedWork=null;              // 실치수 없이 — 늘 보기 좋게 크게(위 '그리는 규칙')
  scene.adj={ dx:0, dy:0, s:1 };
  const out=compose();
  window.__artlookRenders=(window.__artlookRenders||0)+1;   // E2E·하니스가 몇 번 그렸나 본다(ArtLook 탭과 같은 이름)
  // WebGL 을 잃었으면 작품 없이 그림자만 남은 그림이다 — 보내지 말고 이 iframe 을 접는다(바깥이 새로 띄워 다시 그린다)
  if(ArtLookScene.glLost && ArtLookScene.glLost()){ fail('gl-lost'); throw new Error('gl-lost'); }
  if(!out || !out.width) throw new Error('compose');
  const blob=await toJpeg(out);
  return { blob, ratio, size:[out.width, out.height] };
}

async function pump(){
  if(busy || !ready || dead) return;
  const job=queue.shift();
  if(!job) return;
  busy=true;
  try{
    const r=await renderJob(job);
    post({ type:'artlook:rendered', req:job.req, blob:r.blob, ratio:r.ratio });
    if(job.done) job.done(r);
  }catch(e){
    const reason=String((e && e.message) || e || 'render').slice(0, 80);
    post({ type:'artlook:render-failed', req:job.req, reason });
    if(job.fail) job.fail(new Error(reason));
  }finally{
    busy=false;
    if(queue.length) setTimeout(pump, 0);
  }
}

function enqueue(job){
  if(dead){ post({ type:'artlook:render-failed', req:job.req, reason:dead }); if(job.fail) job.fail(new Error(dead)); return; }
  queue.push(job);
  pump();
}

window.addEventListener('message', (e)=>{
  if(!parentWin || e.source!==parentWin || e.origin!==location.origin) return;
  const d=e.data;
  if(!d || d.type!=='artlook:render') return;
  if(!Number.isInteger(d.req) || d.req<=0) return;
  const blob=d.blob;
  if(typeof Blob==='undefined' || !(blob instanceof Blob) || blob.size<=0 || blob.size>BLOB_MAX) {
    post({ type:'artlook:render-failed', req:d.req, reason:'blob' }); return;
  }
  if(blob.type && !/^image\//i.test(blob.type)){ post({ type:'artlook:render-failed', req:d.req, reason:'type' }); return; }
  enqueue({ req:d.req, blob, ss:scaleOf(d.ss) });
});

/** 합성 배율 — 2(완성 = ArtLook 탭 저장 화질) · 그 밖은 1(초안) */
function scaleOf(v){
  return v===2 ? 2 : 1;
}

// 하니스(scratchpad/wall-view)가 주소로 직접 열어 부른다 — 바깥 창 없이도 같은 길로 그린다
let ownReq=0;
window.__wallView={
  state:()=>({ ready, dead, busy, queued:queue.length }),
  render:(blob, ss)=>new Promise((done, failCb)=>enqueue({ req:1e9+(++ownReq), blob, ss:scaleOf(ss), done, fail:failCb })),
};

boot();
})();
