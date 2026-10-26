/* =============================================================================
   ArtLook 화면 — 미리보기 + 탭 [작품 · 액자 · 매트 · 배경 · 조명 · 비율] + 저장 (2026-10-04 개편, CLAUDE.md 규칙 65)
   =============================================================================
   합성 엔진(액자·그림자·조명)은 index.html 에 있고 여기는 **화면**만 맡는다. 엔진의 전역(state · FRAMES · SCENES ·
   WALLS · RATIOS · compose · capToCanvas …)을 그대로 쓴다. 엔진 쪽에서 부르는 것만 window 에 내보낸다
   (render · requestRender · onAssetArrived) — 화질 하니스(scratchpad/vt)도 render() 를 직접 부른다.

   왜 다시 썼나(2026-10-04 조사 — 보고서 https://claude.ai/artifact/N14Ln33D4mvv7zr1gaoK4H):
     · 휴대폰에서 좁은 화면 CSS 가 죽어 있어, 설정 1,611px 를 141px 틈으로 넘기고 미리보기는 첫 화면에 0px 였다.
     · 탭을 열면 41.5MB 를 받고 미리보기를 32번 다시 그렸다(그동안 마이페이지까지 굳었다).
     · 저장해도 아무 표시가 없었고, [완료]는 탭 안에서 경고창을 띄웠다.

   그리기 규칙
     · 그릴 수 있을 때 **한 번만** 그린다 — 지금 고른 작품·액자·배경의 자산이 다 오기 전엔 compose() 를 부르지 않는다
       (예전엔 자산이 올 때마다 그렸다). 요청은 requestRender() 로 한 프레임에 하나로 모은다.
     · 끄는 동안(끌기·두 손가락·휠·조명 막대)은 state.draft — 합성 배율 1로 빠르게, 손을 떼면 원래 배율로 한 번 더.
   ============================================================================= */
(function(){
'use strict';
// 보기 전용(`?view=1` — 작가 홈페이지의 [벽에 걸어 보기], 규칙 74)이면 화면을 만들지 않는다. view.js 가 맡는다
if(typeof VIEW_ONLY!=='undefined' && VIEW_ONLY) return;
const $=(id)=>document.getElementById(id);
const Q=new URLSearchParams(location.search);
/** 마이페이지 [ArtLook] 탭 안 — 바깥(MyPage ArtLookSection)과 postMessage 로 이야기한다 */
const EMBED=Q.get('embed')==='1' && window.parent!==window;
/** 손가락으로 쓰는 화면 — 저장이 '내려받기'가 아니라 공유 창이다 */
const COARSE=!!(window.matchMedia && matchMedia('(pointer: coarse)').matches);
/** 카카오톡·인스타그램 등 앱 안 브라우저 — 내려받기가 막히는 일이 흔하다. 이미지를 띄워 길게 눌러 저장하게 한다 */
const IN_APP=/KAKAOTALK|Instagram|FBAN|FBAV|Line\/|NAVER\(inapp|DaumApps|everytimeApp|BAND\//i.test(navigator.userAgent);

const pv=$('preview'), stage=$('stage'), busyEl=$('busy'), toastEl=$('toast'), zoomEl=$('zoom');
const worksEl=$('works'), framesEl=$('frames'), scenesEl=$('scenes'), wallsEl=$('walls');
const matSel=$('matSel'), matColorsEl=$('matColors'), ratiosEl=$('ratios'), lo=$('lightOp'), lov=$('lightOpv');
const dlBtn=$('dl'), storyBtn=$('toStory'), panes=$('panes');

/* ── 마지막 선택 기억 — 이 브라우저에만(액자·매트·배경·비율·조명). 작품은 기억하지 않는다(목록이 바뀐다) ── */
const PREF_KEY='artlook:prefs';
let prefs={};
try{ const v=JSON.parse(localStorage.getItem(PREF_KEY)||'null'); if(v && typeof v==='object') prefs=v; }catch(e){ /* 막힌 환경 */ }
function savePrefs(patch){
  prefs=Object.assign({}, prefs, patch);
  try{ localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); }catch(e){ /* 기억만 못 한다 */ }
}

/* ── 매트 색 — 첫 색이 엔진 기본값(state.matteColor)과 같아야 처음 화면과 고른 칩이 맞는다 ── */
// [색, 이름, 마감] — 마감을 적지 않으면 종이. 리넨·스웨이드(2026-10-25)는 색으로 구분되므로 기억(prefs.matColor)은 색 하나로 충분하다
const MAT_COLORS=[['#f5f2ea','미색'],['#ffffff','흰색'],['#efe7d8','크림'],['#e4e0d6','웜그레이'],['#2b2b2b','차콜'],
  ['#efebe2','리넨 화이트','linen'],['#d8cfbe','리넨 내추럴','linen'],['#a39684','스웨이드 토프','suede'],['#3d3b38','스웨이드 차콜','suede']];
const matTextureOf=(c)=>{ const f=MAT_COLORS.find(([x])=>x===c); return (f && f[2]) || 'paper'; };
const MAT_WIDTHS=[0,0.05,0.10];

{ // 기억해 둔 선택 — 엔진 기본값 위에 얹는다(그림을 그리기 전에)
  // 숨긴 액자(사진 액자로 대신한 코드 액자, index.html FRAMES 의 hidden)를 골라 둔 사람은 그 대신(alias)으로 연다
  const remembered=FRAMES.find((f)=>f.id===prefs.frame);
  const want=remembered && remembered.hidden && remembered.alias ? remembered.alias : prefs.frame;
  const fi=FRAMES.findIndex((f)=>f.id===want && !f.hidden); if(fi>=0) state.frameIdx=fi;
  if(MAT_WIDTHS.some((m)=>Math.abs(m-prefs.mat)<1e-9)) state.matWidth=prefs.mat;
  if(MAT_COLORS.some(([c])=>c===prefs.matColor)){ state.matteColor=prefs.matColor; state.matTexture=matTextureOf(prefs.matColor); }
  state.caption=prefs.caption===true;
  if(RATIOS.some((r)=>r.id===prefs.ratio)) state.ratio=prefs.ratio;
  if(Number.isFinite(prefs.light) && prefs.light>=0 && prefs.light<=1) state.light=prefs.light;
}

/* ── 작품 — 마이페이지(포트폴리오)·운영 페이지(판매작)가 localStorage 로 넘긴다(lib/artlook.ts) ──
   넘어온 게 없으면(작품 0점·주소로 직접) **데모 작품**을 띄운다 — 절차적으로 그린 그림이라 개인정보가 아니고,
   크기(sizeText)가 실제 호수 규격이라 '실제 크기로 걸린다'를 바로 볼 수 있다(규칙 36). */
const DEMO_WORKS=[
  { url:'/demo-art/dawn-window.jpg',   title:'새벽의 창',   sizeText:'72.7 × 90.9 cm',   artist:'데모' },
  { url:'/demo-art/long-summer.jpg',   title:'긴 여름',     sizeText:'162.1 × 130.3 cm', artist:'데모' },
  { url:'/demo-art/square-garden.jpg', title:'사각의 정원', sizeText:'100 × 100 cm',     artist:'데모' },
  { url:'/demo-art/horizon.jpg',       title:'수평선',      sizeText:'145.5 × 60.6 cm',  artist:'데모' },
  { url:'/demo-art/small-room.jpg',    title:'작은 방',     sizeText:'24.2 × 33.4 cm',   artist:'데모' },
  { url:'/demo-art/blue-wall.jpg',     title:'푸른 벽',     sizeText:'130.3 × 162.1 cm', artist:'데모' },
];
const okUrl=(u)=>typeof u==='string' && (/^https?:\/\//i.test(u) || /^\/(?!\/)/.test(u));
let WORKS=[];
try{ WORKS=JSON.parse(localStorage.getItem('artlook:works')||'[]'); }catch(e){ WORKS=[]; }
if(!Array.isArray(WORKS)) WORKS=[];
WORKS=WORKS.filter((w)=>w && okUrl(w.url));
const IS_DEMO=WORKS.length===0;
if(IS_DEMO) WORKS=DEMO_WORKS.map((w)=>Object.assign({}, w, { kind:'portfolio', demo:true }));
/** 갤러리가 판매작으로 연 화면 — 작가의 ArtStory 로 올리는 단추를 두지 않는다 */
const IS_SOLD=WORKS.some((w)=>w.kind==='sold');

// 외부 도메인(R2) 이미지는 동일출처 프록시로 중계 → 캔버스 taint 방지(PNG 저장 가능). 상대경로는 그대로.
// `immutable=1` — 작품 주소는 `타임스탬프-난수.jpg` 라 내용이 바뀌지 않는다(작품 '정보'는 API 에서 따로 온다).
function resolveSrc(url){ return /^https?:\/\//i.test(url) ? '/api/upload/image-proxy?url='+encodeURIComponent(url)+'&immutable=1' : url; }

/* ── 상태 ── */
let selectedIndex=0;
let workPending=false, workError=false, workToken=0;
let scenesKnown=false;          // 장면 목록이 왔다(또는 장면을 못 쓰는 환경이라 벽으로 정했다)
let waitingAssets=false, waitSince=0;
let fontsOk=false, fontWaitOver=false, composedBeforeFonts=false;
let composed=0, everComposed=false, savedOnce=false;
let renderQueued=false;
const ASSET_WAIT_MAX=15000;     // 이만큼 기다려도 안 오면 있는 것으로 그린다(엔진이 폴백으로 그린다)

/* ── 그리기 ─────────────────────────────────────────────────────────────── */
function requestRender(){
  if(renderQueued) return;
  renderQueued=true;
  const go=()=>{ renderQueued=false; render(); };
  if(window.requestAnimationFrame) requestAnimationFrame(go); else setTimeout(go,16);
}
/** 저장 직전 — 그리다 만 요청·초안(draft) 그림을 원래 배율로 정리한다 */
function flushRender(){
  if(state.draft || renderQueued){ state.draft=false; renderQueued=false; render(); }
}

/** 지금 고른 액자·배경의 자산을 받기 시작한다 — 작품 사진과 **나란히** 받으려고 그리기 전에도 부른다 */
function primeAssets(){
  ensureFrameAssets(FRAMES[state.frameIdx]);
  if(!scenesKnown) return;      // 장면 목록이 오기 전엔 모드가 정해지지 않았다(엔진 기본값이 'wall' 이라 벽을 헛받는다)
  if(state.mode==='scene'){ const sc=SCENES[state.sceneIdx]; if(sc) ArtLookScene.ensureScene(sc, onSceneLayer); }
  else if(state.mode==='wall') ensureWall(WALLS[state.wallIdx]);
}
/** 지금 그리려면 무엇이 더 와야 하나(받기도 여기서 시작한다). 다 왔으면 '' */
function assetsMissing(){
  const style=FRAMES[state.frameIdx];
  ensureFrameAssets(style);
  if(state.mode==='scene'){
    const sc=SCENES[state.sceneIdx];
    if(!sc) return '배경을 불러오는 중…';
    if(!ArtLookScene.ensureScene(sc, onSceneLayer)) return '배경을 불러오는 중…';
  }else if(state.mode==='wall'){
    const w=WALLS[state.wallIdx];
    ensureWall(w);
    if(w && !(w.loaded || w.failed)) return '배경을 불러오는 중…';
  }
  // 액자 자산은 오래 걸리면 기다리지 않는다 — 엔진이 그라디언트·절차적 액자로 그린다. 배경은 끝까지 기다린다
  //   (못 받으면 onerror 가 failed 를 세운다 — 자리표시 그림이 저장되는 일은 없다)
  const gaveUp=waitSince && Date.now()-waitSince>ASSET_WAIT_MAX;
  if(!frameAssetsReady(style) && !gaveUp) return '액자를 불러오는 중…';
  return '';
}

function render(){
  primeAssets();
  if(workError){ showStageMessage('작품 이미지를 불러오지 못했어요. 다른 작품을 골라 보세요.'); setSaveEnabled(false); return; }
  // ⚠️ 기다리는 동안엔 [이미지 저장]도 막는다 — 새 배경·작품이 오기 전에 누르면 **이전 그림**이 저장된다
  if(!state.img || workPending){ setBusy(workPending ? '작품을 불러오는 중…' : '불러오는 중…'); setSaveEnabled(false); return; }
  if(!scenesKnown){ setBusy('배경을 불러오는 중…'); setSaveEnabled(false); return; }
  const missing=assetsMissing();
  if(missing){
    if(!waitingAssets){ waitingAssets=true; waitSince=Date.now(); setTimeout(requestRender, ASSET_WAIT_MAX+50); }
    setBusy(missing);
    setSaveEnabled(false);
    return;
  }
  waitingAssets=false; waitSince=0;
  const sc=state.mode==='scene' ? SCENES[state.sceneIdx] : null;
  if(sc && sc.failed && !sc.loaded){
    showStageMessage('이 배경을 불러오지 못했어요. 다른 배경을 골라 보세요.');
    setSaveEnabled(false);
    return;
  }
  // 첫 그림은 웹폰트를 기다린다(워터마크 글자가 캔버스에 박힌다 — 폴백 글꼴로 찍히면 다시 그려야 한다). 오래는 아니다.
  if(!everComposed && !fontsOk && !fontWaitOver){ setBusy('불러오는 중…'); return; }
  applyCircles();
  compose();
  composed++; everComposed=true;
  window.__artlookRenders=composed;            // 하니스·E2E 가 '몇 번 그렸나'를 본다
  if(!fontsOk) composedBeforeFonts=true;
  pv.hidden=false;
  setBusy('');
  fitPreview();
  afterCompose();
}

function afterCompose(){
  setSaveEnabled(true);
  const movable=!!adjTarget();
  zoomEl.hidden=!movable;
  pv.classList.toggle('movable', movable);
  updateWorkLine();
  updateSceneLine();
}

/** 미리보기 크기 — 칸 안에 비율 그대로 꽉(CSS 의 max-height:100% 는 높이가 정해지지 않은 부모에서 안 먹는다) */
function fitPreview(){
  if(!pv.width || !pv.height) return;
  const cs=getComputedStyle(stage);
  const aw=stage.clientWidth-parseFloat(cs.paddingLeft)-parseFloat(cs.paddingRight);
  const ah=stage.clientHeight-parseFloat(cs.paddingTop)-parseFloat(cs.paddingBottom);
  if(aw<=0 || ah<=0) return;
  const r=pv.width/pv.height;
  let w=aw, h=w/r;
  if(h>ah){ h=ah; w=h*r; }
  pv.style.width=Math.floor(w)+'px';
  pv.style.height=Math.floor(h)+'px';
}
if(window.ResizeObserver) new ResizeObserver(()=>fitPreview()).observe(stage);
else window.addEventListener('resize', fitPreview);

function setBusy(text){
  busyEl.classList.remove('warn');
  busyEl.hidden=!text;
  busyEl.textContent=text||'';
  busyEl.classList.toggle('over', !!text && !pv.hidden);
}
function showStageMessage(text){
  busyEl.hidden=false;
  busyEl.textContent=text;
  busyEl.classList.add('warn');
  busyEl.classList.toggle('over', !pv.hidden);
}
function setSaveEnabled(on){ dlBtn.disabled=!on; }

let toastTimer=0;
function toast(text){
  toastEl.textContent=text;
  toastEl.hidden=false;
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>{ toastEl.hidden=true; }, 4200);
}

/* ── 자산 도착 ── 기다리던 중일 때만 다시 그린다(관계없는 자산 — 미리 받기 등 — 으로 다시 그리지 않는다) */
function onAssetArrived(key){
  if(key==='frames.json') primeAssets();   // 목록이 와야 사진 액자를 받을 수 있다 — 작품 사진을 기다리지 말고 바로
  if(waitingAssets) requestRender();
}
function onSceneLayer(s){ if(waitingAssets && s===SCENES[state.sceneIdx]) requestRender(); }

/* ── 탭 ─────────────────────────────────────────────────────────────── */
const TABS=['works','frames','mat','scenes','light','ratio'];
let currentTab='works';
function selectTab(id, focus){
  currentTab=id;
  TABS.forEach((t)=>{
    const on=t===id, tab=$('tab-'+t);
    tab.setAttribute('aria-selected', String(on));
    tab.tabIndex=on ? 0 : -1;
    $('pane-'+t).hidden=!on;
  });
  if(focus) $('tab-'+id).focus();
  revealSelected();
}
TABS.forEach((t, i)=>{
  const tab=$('tab-'+t);
  tab.addEventListener('click', ()=>selectTab(t));
  tab.addEventListener('keydown', (e)=>{
    let j=-1;
    if(e.key==='ArrowRight') j=(i+1)%TABS.length;
    else if(e.key==='ArrowLeft') j=(i-1+TABS.length)%TABS.length;
    else if(e.key==='Home') j=0;
    else if(e.key==='End') j=TABS.length-1;
    if(j<0) return;
    e.preventDefault();
    selectTab(TABS[j], true);
  });
});
/** 고른 칩이 보이게 — 좁은 칸은 칩 줄을 옆으로, 넓은 칸은 패널을 위아래로(바깥 페이지는 건드리지 않는다) */
function revealSelected(){
  const pane=$('pane-'+currentTab);
  if(!pane || pane.hidden) return;
  const chip=pane.querySelector('.chip[aria-pressed="true"]');
  if(!chip) return;
  const row=chip.parentElement;
  if(row.scrollWidth>row.clientWidth+1){
    const left=chip.offsetLeft-row.offsetLeft;
    row.scrollLeft=Math.max(0, left-(row.clientWidth-chip.offsetWidth)/2);
  }
  if(panes.scrollHeight>panes.clientHeight+1){
    const pr=panes.getBoundingClientRect(), cr=chip.getBoundingClientRect();
    if(cr.top<pr.top || cr.bottom>pr.bottom) panes.scrollTop+=cr.top-pr.top-(pr.height-cr.height)/2;
  }
}
function setPressed(container, pick){
  container.querySelectorAll('[aria-pressed]').forEach((b)=>b.setAttribute('aria-pressed', String(!!pick(b))));
}

/* ── 작품 ─────────────────────────────────────────────────────────────── */
/* ── 여러 점 걸기(갤러리 월, 2026-10-25) — 작품 줄 맨 앞의 [여러 점] 칩으로 켠다 ──────────────────────────
   켜면 작품 칩이 '골랐다/안 골랐다' 토글이 되고(최대 GROUP_MAX 점, 고른 순서가 번호), 줄 한 줄이 [배치 바꾸기]를 준다.
   액자·매트·배경은 모두에게 같다(엔진 groupLayout 주석). 사진은 고를 때 받고(imgCache) 다 오면 한 번 그린다.
   액자 없는 벽 사진(장면)에서만 된다 — WebGL 이 없는 옛 평면 합성에서는 칩을 두지 않는다. */
let multi=null;                 // 고른 작품 번호(고른 순서) — null 이면 한 점
const imgCache=new Map();       // 원본 주소 → 캔버스(capToCanvas). 여러 점을 오가도 다시 받지 않는다
let groupToken=0;
function multiAvailable(){ return WORKS.length>=2 && !!(window.ArtLookScene && ArtLookScene.supported()); }
function modeChip(){
  const b=document.createElement('button');
  b.type='button'; b.className='chip work mode'; b.id='multiChip';
  b.setAttribute('aria-pressed', String(!!multi));
  b.title='여러 작품을 한 벽에 걸어요';
  // 액자 세 개 그림 — 사진이 아니라 기능 칩이라 선으로만
  b.innerHTML='<span class="thumb modeicon" aria-hidden="true"><svg viewBox="0 0 48 48" width="34" height="34" fill="none" stroke="currentColor" stroke-width="2.2">'+
    '<rect x="4" y="12" width="15" height="20" rx="1"/><rect x="22" y="9" width="22" height="16" rx="1"/><rect x="22" y="28" width="12" height="12" rx="1"/></svg></span>'+
    '<span class="name">여러 점</span>';
  b.addEventListener('click', toggleMultiMode);
  return b;
}
/** 크기·위치 조절을 처음대로 — 한 점 ↔ 여러 점을 오갈 때. 묶음에 맞춘 확대가 한 점에 그대로 먹으면 갑자기 커진다(2026-10-25 신고) */
function resetAllAdj(){
  SCENES.forEach((s)=>{ if(s.adj){ s.adj.dx=0; s.adj.dy=0; s.adj.s=1; } });
  WALLS.forEach((w)=>{ if(w.adj){ w.adj.dx=0; w.adj.dy=0; w.adj.s=1; } });
}
function toggleMultiMode(){
  if(multi){ const first=multi[0], was=!!state.group; multi=null; state.group=null; if(was) resetAllAdj(); newWait(); selectedIndex=-1; selectWork(first); }
  else{ multi=[Math.max(0,selectedIndex)]; syncGroup(); }
  refreshWorkChips(); updateWorkLine(); updateSceneLine();
}
function refreshWorkChips(){
  const mc=$('multiChip'); if(mc) mc.setAttribute('aria-pressed', String(!!multi));
  worksEl.querySelectorAll('.chip.work[data-i]').forEach((b)=>{
    const i=+b.dataset.i, k=multi ? multi.indexOf(i) : -1;
    b.setAttribute('aria-pressed', String(multi ? k>=0 : i===selectedIndex));
    let o=b.querySelector('.ord');
    if(k>=0){ if(!o){ o=document.createElement('span'); o.className='ord'; b.appendChild(o); } o.textContent=String(k+1); }
    else if(o) o.remove();
  });
}
function toggleInGroup(i){
  const k=multi.indexOf(i);
  if(k>=0){ if(multi.length>1) multi.splice(k,1); }
  else if(multi.length>=GROUP_MAX){ toast('한 번에 '+GROUP_MAX+'점까지 걸 수 있어요'); return; }
  else multi.push(i);
  refreshWorkChips(); syncGroup(); updateWorkLine();
}
/** 고른 작품 사진이 다 왔나 — 다 왔으면 엔진에 묶음을 넘기고, 아니면 받는다(받는 동안엔 [저장]을 막는다) */
function syncGroup(){
  if(!multi){ state.group=null; return; }
  const t=++groupToken;
  selectedWork=WORKS[multi[0]];
  const missing=multi.filter((i)=>!imgCache.has(WORKS[i].url));
  if(!missing.length){
    const was=!!state.group;
    state.group=multi.length>1 ? multi.map((i)=>({ img:imgCache.get(WORKS[i].url), work:WORKS[i] })) : null;
    if(was!==!!state.group) resetAllAdj();      // 한 점 ↔ 여러 점이 바뀌었다
    state.img=imgCache.get(WORKS[multi[0]].url);
    workPending=false; workError=false; newWait(); requestRender(); return;
  }
  workPending=true; requestRender();
  missing.forEach((i)=>{
    const w=WORKS[i], im=new Image();
    im.crossOrigin='anonymous';
    im.onload=()=>{ imgCache.set(w.url, capToCanvas(im)); if(t===groupToken) syncGroup(); };
    im.onerror=()=>{ if(t!==groupToken || !multi) return;
      toast('작품 이미지를 불러오지 못해 빼 두었어요');
      const k=multi.indexOf(i); if(k>=0 && multi.length>1) multi.splice(k,1);
      refreshWorkChips(); syncGroup(); updateWorkLine(); };
    im.src=resolveSrc(w.url);
  });
}
function cycleGroupLayout(){
  const kinds=GROUP_LAYOUTS[multi.length]||['row'];
  const cur=kinds.includes(state.groupLayout) ? state.groupLayout : kinds[0];
  state.groupLayout=kinds[(kinds.indexOf(cur)+1)%kinds.length];
  updateWorkLine(); requestRender();
}

function buildWorks(){
  worksEl.textContent='';
  if(multiAvailable()) worksEl.appendChild(modeChip());
  WORKS.forEach((w, i)=>{
    const b=document.createElement('button');
    b.type='button'; b.className='chip work'; b.dataset.i=String(i);
    b.setAttribute('aria-pressed', String(i===selectedIndex));
    b.setAttribute('aria-label', (w.title || '제목 없는 작품')+' — '+(i+1)+'번째');
    b.title=w.title || '';
    const im=document.createElement('img');
    im.className='thumb'; im.alt=''; im.loading='lazy'; im.decoding='async';
    // 칸은 68px 이다 — 넘겨받은 썸네일(t800)을 쓰고, 없거나 못 받으면 원본(프록시)으로 한 번 더(예전엔 처음부터 원본: 30점 23MB)
    im.src=w.thumb && okUrl(w.thumb) ? w.thumb : resolveSrc(w.url);
    im.onerror=()=>{
      if(!im.dataset.fallback && im.src.indexOf('image-proxy')<0 && w.thumb){ im.dataset.fallback='1'; im.src=resolveSrc(w.url); return; }
      b.classList.add('broken');
    };
    b.appendChild(im);
    b.addEventListener('click', ()=>selectWork(i));
    worksEl.appendChild(b);
  });
}
function selectWork(i){
  if(multi){ toggleInGroup(i); return; }
  if(i===selectedIndex && state.img && !workError){ return; }
  selectedIndex=i;
  selectedWork=WORKS[i];
  refreshWorkChips();
  loadWork(selectedWork);
  updateWorkLine();
}
/** 새로 골랐다 — 기다림(15초 한도)을 새로 센다. 앞 선택에서 기다리던 시간이 새 액자에 넘어오지 않게 */
function newWait(){ waitingAssets=false; waitSince=0; }
function loadWork(w){
  const t=++workToken;
  newWait();
  // 이미 받은 사진이면(여러 점을 오갔다) 다시 받지 않는다
  if(imgCache.has(w.url)){ state.img=imgCache.get(w.url); workPending=false; workError=false; requestRender(); return; }
  workPending=true; workError=false;
  const im=new Image();
  im.crossOrigin='anonymous';   // 캔버스 저장(toBlob) 위해 CORS 허용 로드 (동일 출처면 무영향)
  im.onload=()=>{ if(t!==workToken) return; state.img=capToCanvas(im); imgCache.set(w.url, state.img); workPending=false; requestRender(); };
  im.onerror=()=>{ if(t!==workToken) return; workPending=false; workError=true; requestRender(); };
  im.src=resolveSrc(w.url);
  requestRender();
}

/** 작품 탭의 한 줄 — 제목·크기, 크기를 몰라 가정했으면 그렇다고 + [크기 입력하기] */
function updateWorkLine(){
  const line=$('worksLine'), empty=$('worksEmpty');
  // 여러 점 — 데모 작품이어도 이 줄이 먼저다(배치 바꾸기가 여기 있다)
  if(multi){
    empty.hidden=true; line.hidden=false; line.textContent='';
    const t=document.createElement('span'); t.className='txt';
    const b=document.createElement('b'); b.textContent='여러 점'; t.appendChild(b);
    if(multi.length<2){ t.appendChild(document.createTextNode(' · 함께 걸 작품을 더 골라 주세요(최대 '+GROUP_MAX+'점)')); line.appendChild(t); return; }
    const kinds=GROUP_LAYOUTS[multi.length]||['row'];
    const cur=kinds.includes(state.groupLayout) ? state.groupLayout : kinds[0];
    t.appendChild(document.createTextNode(' · '+multi.length+'점 · '+GROUP_LAYOUT_NAMES[cur]+' · 실제 크기 비율로 8cm 간격'));
    line.appendChild(t);
    if(kinds.length>1) line.appendChild(actionButton('배치 바꾸기', cycleGroupLayout));
    return;
  }
  if(IS_DEMO){
    line.hidden=true;
    empty.hidden=false;
    empty.textContent='';
    const t=document.createElement('span'); t.className='txt';
    t.textContent='둘러보기용 데모 작품이에요. 작품을 올리면 내 작품으로 만들 수 있어요.';
    empty.appendChild(t);
    if(EMBED){ empty.appendChild(actionButton('작품 올리기', ()=>goto({ to:'upload' }))); }
    return;
  }
  empty.hidden=true; line.hidden=false; line.textContent='';
  const w=selectedWork || {};
  const t=document.createElement('span'); t.className='txt';
  const b=document.createElement('b'); b.textContent=w.title || '제목 없음'; t.appendChild(b);
  const cm=artCmOf(w);
  let act=null;
  if(cm){
    t.appendChild(document.createTextNode(' · 세로 '+fmtCm(cm[1])+' × 가로 '+fmtCm(cm[0])+'cm'));
    const note=fitNoteText(cm);
    if(note) t.appendChild(document.createTextNode(' · '+note));
  }else{
    t.appendChild(document.createTextNode(' · 크기를 적지 않아 높이 90cm(30호 정도)로 걸었어요'));
    // 크기를 적는 곳은 홈페이지 편집의 작품 정보 — 판매작(갤러리가 연 화면)은 작가 것이라 고칠 수 없다
    if(EMBED && w.kind!=='sold' && Number.isInteger(w.id)) act=actionButton('크기 입력하기', ()=>goto({ to:'size', id:w.id }));
  }
  line.appendChild(t);
  if(act) line.appendChild(act);
}
function fmtCm(v){ return (Math.round(v*10)/10).toString(); }
/** 실치수로 걸었을 때 덧붙일 말 — 장면 자리보다 커서 줄였거나, 너무 작아 키웠거나(키웠으면 반드시 알린다, 규칙 44c) */
function fitNoteText(cm){
  if(!cm || !lastFitNote || state.mode!=='scene') return '';
  if(lastFitNote.ok===false) return '이 배경에 걸기엔 커서 줄여 걸었어요';
  if(lastFitNote.enlarged>1.05) return '실제 크기면 너무 작아 '+lastFitNote.enlarged.toFixed(1)+'배 크게 걸었어요';
  return '';
}
function actionButton(text, onClick){
  const b=document.createElement('button');
  b.type='button'; b.className='act'; b.textContent=text;
  b.addEventListener('click', onClick);
  return b;
}
/** 바깥(마이페이지)으로 — 편집 화면 등. 같은 출처에만 보낸다 */
function goto(msg){
  if(!EMBED) return;
  try{ window.parent.postMessage(Object.assign({ type:'artlook:goto' }, msg), location.origin); }catch(e){ /* 조용히 */ }
}

/* ── 작품의 원(원형 액자, 2026-10-25) ─────────────────────────────────────────
   둥근 작품 사진에는 둘레에 여백이 있다 — 그대로 쓰면 여백까지 테 안에 들어간다. 작품마다 원을 자동으로 찾고(detectArtCircle),
   안 맞으면 [원 맞추기]로 사용자가 맞춘다. 맞춘 원은 이 브라우저에 작품 주소별로 기억한다(작품 목록과 함께 다니지 않는다). */
const CIRCLE_KEY='artlook:circles';
let savedCircles={};
try{ const v=JSON.parse(localStorage.getItem(CIRCLE_KEY)||'null'); if(v && typeof v==='object') savedCircles=v; }catch(e){ /* 막힌 환경 */ }
const autoCircles=new Map();     // 주소 → 자동으로 찾은 원(못 찾으면 null)
function circleFor(w, img){
  if(!w || !img) return null;
  if(savedCircles[w.url]) return savedCircles[w.url];
  if(!autoCircles.has(w.url)) autoCircles.set(w.url, detectArtCircle(img));
  return autoCircles.get(w.url);
}
/** 원형 액자면 그리기 직전에 작품마다 원을 붙인다(한 점 = state.circle, 여러 점 = 칸마다) */
function applyCircles(){
  const round=(FRAMES[state.frameIdx]||{}).kind==='round';
  state.circle = round ? circleFor(selectedWork, state.img) : null;
  if(state.group) state.group.forEach((g)=>{ g.circle = round ? circleFor(g.work, g.img) : null; });
}

/* ── 액자 ─────────────────────────────────────────────────────────────── */
// 고른 액자 설명 한 줄. 이름만으로는 플로터·슬림·캔버스 랩이 무엇인지 알 수 없다(2026-10-04 조사)
// 액자는 **종류별로 묶고, 묶음마다 무엇이 다른지 한 줄로** 적는다(2026-10-26 사용자: "다 비슷비슷해 보여서 종류별로 뭐가 다른지 가볍게 —
//   선택하면 맨 위에 뜨는 것 말고 '몰딩 — 어쩌고' 식으로"). 넓은 칸은 묶음 이름 옆에, 좁은 칸(칩 한 줄)은 이름이 세로라 칩 아래 줄에 고른 액자의 묶음 설명을.
// FRAMES 의 순서(=번호)는 그대로 둔다 — 하니스가 번호를 쓰고 기억(prefs.frame)은 id 로 찾는다. 여기 없는 액자는 '기타'로 간다(숨긴 액자는 어디에도 안 보인다).
// ⚠️ 설명은 **20자 안팎** — 휴대폰은 칩 아래 한 줄(이름 포함 약 26자)이라 길면 잘린다(플로터 설명이 그랬다).
const FRAME_GROUPS=[
  ['몰딩','나무·도장 테를 두른 가장 기본 액자',['oak','walnut','maple','black','white','silver','gold']],
  ['넓은 몰딩','테가 넓어 작은 작품도 무게감 있게',['black-wide','white-wide']],
  ['슬림','테가 가늘어 작품이 가장 돋보이는 액자',['oak-thin','walnut-thin','slim-black','slim-white','silver-thin']],
  ['플로터','틈을 두고 띄워 거는 캔버스용 액자',['floater-oak','floater-walnut','floater-black','floater-white','floater-champagne']],
  ['박스','안쪽 벽이 깊은 상자형 입체 액자',['box-oak','box-walnut','box-black','box-white','box-ivory']],
  ['원형','둥근 작품용, 사진 속 원에 테를 맞춰요',['round-black','round-gold']],
  ['기타','흰 대지를 두르거나 액자 없이 거는 방식',['white-mat','canvas-wrap']],
];
/** [[묶음 이름, 설명, [id…]]] — 없는 id·숨긴 액자는 빼고, 어디에도 없는 액자는 '기타'로 */
function frameGroups(){
  const shown=(id)=>FRAMES.some((f)=>f.id===id && !f.hidden);
  const seen=new Set(), out=FRAME_GROUPS.map(([name, desc, ids])=>[name, desc, ids.filter(shown)]);
  out.forEach(([, , ids])=>ids.forEach((id)=>seen.add(id)));
  const rest=FRAMES.filter((f)=>!f.hidden && !seen.has(f.id)).map((f)=>f.id);
  if(rest.length) out[out.length-1][2].push(...rest);
  return out.filter(([, , ids])=>ids.length);
}
/** 그 액자가 속한 묶음 [이름, 설명] */
function frameGroupOf(id){ return frameGroups().find(([, , ids])=>ids.includes(id)) || null; }
function buildFrames(){
  framesEl.textContent='';
  frameGroups().forEach(([gname, gdesc, ids])=>{
    const label=document.createElement('span');
    label.className='group';
    const nm=document.createElement('b'); nm.textContent=gname; label.appendChild(nm);
    // 설명은 넓은 칸에서만 보인다(좁은 칸은 이름이 세로라 칩 아래 줄 — updateFrameLine)
    const ds=document.createElement('span'); ds.className='gdesc'; ds.textContent=' — '+gdesc; label.appendChild(ds);
    framesEl.appendChild(label);
    ids.forEach((id)=>{ const i=FRAMES.findIndex((f)=>f.id===id), f=FRAMES[i];
      const b=document.createElement('button');
      b.type='button'; b.className='chip frame'; b.dataset.id=f.id;
      b.setAttribute('aria-pressed', String(i===state.frameIdx));
      b.title=f.name;
      const im=document.createElement('img');
      im.className='thumb'; im.alt=''; im.loading='lazy'; im.decoding='async';
      im.src='frames/chips/'+f.id+'.webp';          // 미리 구운 칩(build-artlook-thumbs.mjs) — 액자 사진을 받지 않고도 보인다
      im.onerror=()=>{ im.remove(); };             // 못 받으면 이름만 남는다
      const s=document.createElement('span'); s.className='name'; s.textContent=f.name;
      b.append(im, s);
      b.addEventListener('click', ()=>selectFrame(i));
      framesEl.appendChild(b);
    });
    // [원 맞추기]는 원형 칩 **바로 옆**에(2026-10-25 — 줄 끝의 버튼은 칩과 너무 멀었다). 원형이 아닐 때 누르면 블랙 원형으로 바꾸고 연다
    if(ids.some((id)=>(FRAMES.find((f)=>f.id===id)||{}).kind==='round')) framesEl.appendChild(circleChip());
  });
}
function circleChip(){
  const b=document.createElement('button');
  b.type='button'; b.className='chip frame tool'; b.id='circleChip'; b.title='원 맞추기';
  b.innerHTML='<span class="thumb toolicon" aria-hidden="true"><svg viewBox="0 0 48 48" width="34" height="34" fill="none" stroke="currentColor" stroke-width="2.2">'+
    '<circle cx="24" cy="24" r="15"/><circle cx="24" cy="24" r="9" stroke-dasharray="3 3"/><path d="M24 3v6M24 39v6M3 24h6M39 24h6"/></svg></span>'+
    '<span class="name">원 맞추기</span>';
  b.addEventListener('click', ()=>{
    if((FRAMES[state.frameIdx]||{}).kind!=='round'){ const i=FRAMES.findIndex((f)=>f.kind==='round'); if(i>=0) selectFrame(i); }
    openCircleSheet();
  });
  return b;
}
function selectFrame(i){
  state.frameIdx=i;
  newWait();
  setPressed(framesEl, (b)=>b.dataset.id===FRAMES[i].id);
  savePrefs({ frame:FRAMES[i].id });
  updateFrameLine();
  updateMatRow();
  requestRender();
}
/** 좁은 칸(칩 한 줄)에서 칩 아래 줄 — 고른 액자의 **묶음** 설명. 넓은 칸은 묶음 이름 옆에 이미 있어 이 줄을 감춘다(index.html) */
function updateFrameLine(){
  const f=FRAMES[state.frameIdx]||{};
  const line=$('framesLine'); line.textContent='';
  const g=frameGroupOf(f.id);
  if(!g) return;
  const t=document.createElement('span'); t.className='txt';
  const b=document.createElement('b'); b.textContent=g[0]; t.appendChild(b);
  t.appendChild(document.createTextNode(' — '+g[1]));
  line.appendChild(t);
}

/* ── 매트 ─────────────────────────────────────────────────────────────── */
function buildMatColors(){
  matColorsEl.textContent='';
  MAT_COLORS.forEach(([c, name, tex])=>{
    const b=document.createElement('button');
    b.type='button'; b.className='sw'; b.style.background=c; b.dataset.color=c;
    // 천 마감은 색만으로는 구분이 안 된다 — 그 결을 칩에 깐다(엔진의 같은 타일)
    if(tex){ try{ const t=(tex==='linen'?linenTile:suedeTile)(c.slice(1).match(/../g).map((h)=>parseInt(h,16)).join(','),1,tex==='linen'?30:12,tex==='linen'?5150:7171);
      b.style.backgroundImage='url('+t.toDataURL('image/png')+')'; }catch(e){ /* 색만 */ } }
    b.setAttribute('aria-label', '매트 색 '+name); b.title=name;
    b.setAttribute('aria-pressed', String(c===state.matteColor));
    b.addEventListener('click', ()=>{
      state.matteColor=c; state.matTexture=tex||'paper';
      setPressed(matColorsEl, (x)=>x.dataset.color===c);
      savePrefs({ matColor:c });
      requestRender();
    });
    matColorsEl.appendChild(b);
  });
}
matSel.querySelectorAll('button').forEach((b)=>{
  b.setAttribute('aria-pressed','false');
  b.addEventListener('click', ()=>{
    state.matWidth=parseFloat(b.dataset.mat)||0;
    savePrefs({ mat:state.matWidth });
    updateMatRow();   // '없음'이면 매트 색은 고를 게 없다 — 접는다
    requestRender();
  });
});
// 매트는 캔버스 랩만 빼고 전 스타일(규칙 44·44e). 캔버스 랩은 액자가 없어 매트를 **물리적으로 받칠 것이 없다** —
// 못 고치는 제약이라 비활성 + 이유를 적는다(줄째로 감추면 매트 기능이 있는지도 모른다).
function updateMatRow(){
  const k=(FRAMES[state.frameIdx]||{}).kind;
  const on = k !== 'canvas';
  matSel.querySelectorAll('button').forEach((b)=>{
    b.disabled=!on;
    b.setAttribute('aria-pressed', String(Math.abs(parseFloat(b.dataset.mat)-(state.matWidth||0))<1e-9));
  });
  // 매트 색은 **매트가 있을 때만** 뜻이 있다 — '없음'에서 색을 고르게 두면 아무 일도 안 하는 컨트롤이 된다
  matColorsEl.hidden = !(on && (state.matWidth||0) > 0);
  const hint=$('matHint'); hint.textContent='';
  const t=document.createElement('span'); t.className='txt';
  t.textContent = on ? '작품과 액자 사이에 두르는 여백이에요. 색 줄 뒤쪽은 리넨·스웨이드 천이에요.'
                     : '캔버스 랩은 액자가 없어 매트를 쓸 수 없어요. 다른 액자를 고르면 켜져요.';
  hint.appendChild(t);
}

/* ── 배경 ─────────────────────────────────────────────────────────────── */
// [벽]/[공간] 두 무리는 토글이 아니라 **무리 이름**으로 나눈다 — 좁은 칸은 한 줄에 이어 밀고, 넓은 칸은 제목 + 격자.
// (예전 토글은 한 줄에 16개가 많아서였다 — 칩 줄은 옆으로 밀면 되고, 토글 한 줄이 미리보기 높이를 먹는다)
function thumbOf(src){ const i=src.lastIndexOf('/'); return src.slice(0,i)+'/thumbs/'+src.slice(i+1); }
function sceneChip(name, thumb, pressed, onClick){
  const b=document.createElement('button');
  b.type='button'; b.className='chip scene';
  b.setAttribute('aria-pressed', String(pressed));
  b.title=name;
  const im=document.createElement('img');
  im.className='thumb'; im.alt=''; im.loading='lazy'; im.decoding='async'; im.src=thumb;
  im.onerror=()=>{ im.style.visibility='hidden'; };
  const s=document.createElement('span'); s.className='name'; s.textContent=name;
  b.append(im, s);
  b.addEventListener('click', onClick);
  return b;
}
function buildScenes(){
  scenesEl.textContent='';
  const order=[];
  SCENES.forEach((s)=>{ const g=s.group||'wall'; if(order.indexOf(g)<0) order.push(g); });
  order.forEach((g)=>{
    const label=document.createElement('span');
    label.className='group'; label.textContent=g==='space' ? '공간' : '벽';
    scenesEl.appendChild(label);
    SCENES.forEach((s, i)=>{
      if((s.group||'wall')!==g) return;
      const b=sceneChip(s.name, s.thumb || thumbOf(s.src), i===state.sceneIdx, ()=>selectScene(i));
      b.dataset.idx=String(i);
      scenesEl.appendChild(b);
    });
  });
}
function selectScene(i){
  const s=SCENES[i];
  if(s && s.failed && !s.loaded){ s._requested=false; s.failed=false; }   // 못 받은 배경을 다시 누르면 다시 받는다
  state.sceneIdx=i;
  newWait();
  setPressed(scenesEl, (b)=>b.dataset.idx===String(i));
  if(s) savePrefs({ scene:s.id });
  updateSceneLine();
  requestRender();
}
function buildWalls(){
  wallsEl.textContent='';
  WALLS.forEach((w, i)=>{
    const b=sceneChip(w.name, thumbOf(w.src), i===state.wallIdx, ()=>{
      state.wallIdx=i;
      setPressed(wallsEl, (x)=>x.dataset.idx===String(i));
      updateSceneLine();
      requestRender();
    });
    b.dataset.idx=String(i);
    wallsEl.appendChild(b);
  });
}
function updateSceneLine(){
  const line=$('sceneNote'); line.textContent='';
  const t=document.createElement('span'); t.className='txt';
  const name=state.mode==='scene' ? (SCENES[state.sceneIdx]||{}).name : (WALLS[state.wallIdx]||{}).name;
  if(name){ const b=document.createElement('b'); b.textContent=name; t.appendChild(b); }
  const note=fitNoteText(artCmOf(selectedWork));
  if(note){
    t.appendChild(document.createTextNode(' · '+note));
    if(lastFitNote && lastFitNote.enlarged>1.05) t.appendChild(document.createTextNode('. 벽 배경을 고르면 실제 비율에 가까워요'));
  }
  // 벽 캡션 — 장면에 붙일 수 있고(액자 없는 벽 사진) 적을 게 있을 때만 단추를 둔다
  const sc=state.mode==='scene' ? SCENES[state.sceneIdx] : null;
  const canCaption=!multi && !!(sc && sc.frameless && sc.region && sc.regionCm) && captionLines(selectedWork).length>0;
  if(canCaption && state.caption && lastLabelPlaced===false) t.appendChild(document.createTextNode(' · 작품 옆에 자리가 없어 캡션을 붙이지 못했어요'));
  line.appendChild(t);
  if(canCaption) line.appendChild(actionButton(state.caption ? '벽 캡션 빼기' : '벽 캡션 붙이기', ()=>{
    state.caption=!state.caption;
    savePrefs({ caption:state.caption });
    updateSceneLine();
    requestRender();
  }));
}

/* ── 조명 · 비율 ───────────────────────────────────────────────────────── */
function lightUI(){ const v=Math.round((state.light||0)*100); lo.value=String(v); lov.textContent=v+'%'; }
lo.addEventListener('input', ()=>{
  state.light=lo.value/100; lov.textContent=lo.value+'%';
  state.draft=true; requestRender(); finishSoon();
});
lo.addEventListener('change', ()=>{ savePrefs({ light:state.light }); finishNow(); });
function buildRatios(){
  ratiosEl.textContent='';
  RATIOS.forEach((r)=>{
    const b=document.createElement('button');
    b.type='button'; b.textContent=r.name; b.dataset.id=r.id;
    b.setAttribute('aria-pressed', String(r.id===state.ratio));
    b.addEventListener('click', ()=>{
      state.ratio=r.id;
      setPressed(ratiosEl, (x)=>x.dataset.id===r.id);
      savePrefs({ ratio:r.id });
      requestRender();
    });
    ratiosEl.appendChild(b);
  });
}

/* ── 장면 목록 ──────────────────────────────────────────────────────────
   목록이 비었거나 WebGL2 가 없으면 옛 평면 합성(벽 목록)으로 폴백한다 — 빈 탭을 보여주면 고장으로 보인다. */
if(window.ArtLookScene && ArtLookScene.supported()){
  ArtLookScene.loadScenes('scenes/scenes.json?v='+BUILD, (one, all)=>{
    if(all){
      SCENES=all.filter((s)=>s && s.src && (s.region||s.opening));
      SCENES.forEach((s)=>{ s.adj={dx:0,dy:0,s:1}; });
      if(SCENES.length){
        const si=SCENES.findIndex((s)=>s.id===prefs.scene);
        if(si>=0) state.sceneIdx=si;
        if(state.sceneIdx>=SCENES.length) state.sceneIdx=0;
        state.mode='scene';
        buildScenes();
      }else{
        useWalls();
      }
      scenesKnown=true;
      primeAssets();
      updateSceneLine();
      requestRender();
      return;
    }
    if(one) onSceneLayer(one);
  }, { preloadAll:PRELOAD_ALL });
}else{
  useWalls();
  scenesKnown=true;
}
function useWalls(){
  state.mode='wall';
  scenesEl.hidden=true; wallsEl.hidden=false;
  buildWalls();
}

/* ── 미리보기 조작 — 끌어서 옮기기 · 두 손가락으로 크기 · 휠 · [−][+][원위치] · 두 번 눌러 원위치 ── */
// 조절 대상 — 벽이면 그 벽, 장면이면 그 장면. 사진에 액자가 박힌 장면(opening)은 **움직일 수 없다**
// (액자가 고정이므로 작품만 옮기면 액자 밖으로 삐져나온다) — null 을 돌려 조작을 막고 단추도 감춘다.
function adjTarget(){
  if(!state.img) return null;
  if(state.mode==='wall') return (WALLS[state.wallIdx]||{}).adj || null;
  const s=SCENES[state.sceneIdx];
  return (s && s.region) ? s.adj : null;
}
// 드래그 한 픽셀이 몇 '단위' 인지 — 벽은 캔버스 기준, 장면은 영역 기준이라 다르다
function adjScale(){
  if(state.mode==='wall') return {x:pv.width,y:pv.height};
  const r=lastRegionPx;
  return r && r.w>4 && r.h>4 ? {x:r.w,y:r.h} : {x:pv.width,y:pv.height};
}
function canvasPoint(e){
  const r=pv.getBoundingClientRect();
  return { x:(e.clientX-r.left)*pv.width/r.width, y:(e.clientY-r.top)*pv.height/r.height };
}
const clampScale=(s)=>Math.max(.35, Math.min(2.5, s));
let finishTimer=0;
/** 손을 뗀 뒤 원래 배율로 한 번 — 휠·막대처럼 '뗐다'는 신호가 없는 조작은 잠깐 멎으면 */
function finishSoon(){ clearTimeout(finishTimer); finishTimer=setTimeout(finishNow, 220); }
function finishNow(){ clearTimeout(finishTimer); if(state.draft){ state.draft=false; requestRender(); } }

const pointers=new Map();
let drag=null, pinch=null;
pv.addEventListener('pointerdown', (e)=>{
  const adj=adjTarget(); if(!adj || !lastArt) return;
  pointers.set(e.pointerId, canvasPoint(e));
  try{ pv.setPointerCapture(e.pointerId); }catch(err){ /* 이미 놓았다 */ }
  if(pointers.size===2){
    const [a,b]=[...pointers.values()];
    pinch={ d0:Math.hypot(a.x-b.x, a.y-b.y)||1, s0:adj.s };
    drag=null;
  }else if(pointers.size===1){
    const p=pointers.get(e.pointerId), m=Math.max(20, lastArt.fw*.06);
    const onArt=!(p.x<lastArt.x-m||p.x>lastArt.x+lastArt.fw+m||p.y<lastArt.y-m||p.y>lastArt.y+lastArt.fh+m);
    if(onArt){ drag={ px:p.x, py:p.y, dx0:adj.dx, dy0:adj.dy }; pv.classList.add('dragging'); }
  }
  e.preventDefault();
});
pv.addEventListener('pointermove', (e)=>{
  if(!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, canvasPoint(e));
  const adj=adjTarget(); if(!adj) return;
  if(pinch && pointers.size>=2){
    const [a,b]=[...pointers.values()];
    adj.s=clampScale(pinch.s0*(Math.hypot(a.x-b.x, a.y-b.y)/pinch.d0));
  }else if(drag){
    const p=pointers.get(e.pointerId), k=adjScale();
    adj.dx=drag.dx0+(p.x-drag.px)/k.x;
    adj.dy=drag.dy0+(p.y-drag.py)/k.y;
  }else return;
  state.draft=true;
  requestRender();
});
function endPointer(e){
  if(!pointers.has(e.pointerId)) return;
  pointers.delete(e.pointerId);
  if(pointers.size<2) pinch=null;
  if(pointers.size===0){ drag=null; pv.classList.remove('dragging'); finishNow(); }
}
['pointerup','pointercancel','lostpointercapture'].forEach((ev)=>pv.addEventListener(ev, endPointer));
pv.addEventListener('wheel', (e)=>{
  const adj=adjTarget(); if(!adj) return;
  e.preventDefault();
  adj.s=clampScale(adj.s*(e.deltaY<0 ? 1.06 : 0.94));
  state.draft=true; requestRender(); finishSoon();
}, { passive:false });
pv.addEventListener('dblclick', ()=>resetAdj());
function resetAdj(){ const adj=adjTarget(); if(!adj) return; adj.dx=0; adj.dy=0; adj.s=1; requestRender(); }
$('zoomIn').addEventListener('click', ()=>{ const a=adjTarget(); if(!a) return; a.s=clampScale(a.s*1.12); requestRender(); });
$('zoomOut').addEventListener('click', ()=>{ const a=adjTarget(); if(!a) return; a.s=clampScale(a.s/1.12); requestRender(); });
$('zoomReset').addEventListener('click', resetAdj);

/* ── 저장 ──────────────────────────────────────────────────────────────
   PC = 바로 내려받기 → "저장했어요 · 파일 이름". 휴대폰 = 공유 창(사진에 저장·인스타그램·카카오톡).
   공유를 못 쓰는 앱 안 브라우저 = 이미지를 크게 띄워 길게 눌러 저장. 저장하고 나면 [ArtStory에 올리기](탭 안에서만). */
function sanitizeName(s){ return String(s==null?'':s).replace(/[\\/:*?"<>|]+/g,'').replace(/\s+/g,' ').trim(); }
/** 작가_작품명_[공모명]_액자_배경[_판매작].png — 여러 장을 저장해도 (1)(2) 로 겹치지 않게 액자·배경을 넣는다 */
function downloadFileName(){
  const w=selectedWork||{};
  const bg=state.mode==='scene' ? (SCENES[state.sceneIdx]||{}).name : (WALLS[state.wallIdx]||{}).name;
  // 여러 점 — 작가(서로 다르면 모두) · N점
  const many=multi && multi.length>1 ? multi.map((i)=>WORKS[i]) : null;
  const who=many ? [...new Set(many.map((x)=>x.artist).filter(Boolean))].join('·') : w.artist;
  const what=many ? many.length+'점' : w.title;
  const parts=[who, what, w.exhibition, (FRAMES[state.frameIdx]||{}).name, bg].map(sanitizeName).filter(Boolean);
  // '판매작' 접미사는 운영페이지에서 넘어온 판매작에만. 포트폴리오 작품에 붙으면 사실과 다르다.
  if(w.kind==='sold') parts.push('판매작');
  if(!parts.length) parts.push('ArtLook');
  return parts.join('_')+'.png';
}
function dataUrlToBlob(u){
  const i=u.indexOf(','), head=u.slice(0,i), mime=(head.match(/data:([^;]+)/)||[])[1]||'image/png';
  const bin=atob(u.slice(i+1)), a=new Uint8Array(bin.length);
  for(let k=0;k<bin.length;k++) a[k]=bin.charCodeAt(k);
  return new Blob([a], { type:mime });
}
function saved(text){
  savedOnce=true;
  toast(text);
  if(EMBED && !IS_SOLD) storyBtn.hidden=false;
}
function saveFailed(){
  toast('이미지를 만들지 못했어요. 새로고침한 뒤 다시 해 보세요.');
}
dlBtn.addEventListener('click', ()=>{
  if(dlBtn.disabled) return;
  flushRender();
  const name=downloadFileName();
  if(COARSE || IN_APP){
    // ⚠️ 공유 창은 **누른 그 순간에** 열어야 한다(사용자 동작이 식으면 막힌다) — 그래서 비동기 toBlob 이 아니라 toDataURL 로 바로 만든다
    let url;
    try{ url=pv.toDataURL('image/png'); }catch(e){ saveFailed(); return; }
    let file=null;
    try{
      if(navigator.share && navigator.canShare && typeof File==='function'){
        const f=new File([dataUrlToBlob(url)], name, { type:'image/png' });
        if(navigator.canShare({ files:[f] })) file=f;
      }
    }catch(e){ file=null; }
    if(file){
      navigator.share({ files:[file] })
        .then(()=>saved('저장·공유했어요'))   // 공유 창은 어디로 보냈는지 알려 주지 않는다(사진에 저장·인스타그램·카카오톡…)
        .catch((err)=>{ if(err && err.name==='AbortError') return; openSheet(url); });
      return;
    }
    if(IN_APP){ openSheet(url); return; }
  }
  try{
    pv.toBlob((b)=>{
      if(!b){ saveFailed(); return; }
      const a=document.createElement('a');
      a.href=URL.createObjectURL(b); a.download=name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(()=>URL.revokeObjectURL(a.href), 4000);
      saved('저장했어요 · '+name);
    }, 'image/png');
  }catch(e){ saveFailed(); }
});

/* ── 원 맞추기 창 ──────────────────────────────────────────────────────────
   사진 위에 원을 띄워 끌어 옮기고 막대로 크기를 바꾼다. 여러 점이면 [다음 작품]으로 차례로. [완료]를 눌러야 기억한다(바깥을 누르면 취소). */
const cSheet=$('circleSheet'), cCv=$('circleCv'), cR=$('circleR'), cRv=$('circleRv');
let cEdit=null;    // { list:[{work,img,c}], k, view:{s,w,h} }
function circleTargets(){
  if(multi && multi.length>1) return multi.map((i)=>({ work:WORKS[i], img:imgCache.get(WORKS[i].url) })).filter((x)=>x.img);
  return state.img && selectedWork ? [{ work:selectedWork, img:state.img }] : [];
}
function openCircleSheet(){
  const list=circleTargets().map((x)=>Object.assign(x, { c:clampCircle(circleFor(x.work, x.img)||{cx:.5,cy:.5,r:.5}, x.img.width, x.img.height) }));
  if(!list.length) return;
  cEdit={ list, k:0 };
  $('circleNext').hidden=list.length<2;
  cSheet.hidden=false;
  drawCircleSheet();
  cR.focus();
}
function drawCircleSheet(){
  if(!cEdit) return;
  const it=cEdit.list[cEdit.k], img=it.img, c=it.c;
  const maxW=Math.min(480, window.innerWidth-64), maxH=Math.max(160, Math.min(window.innerHeight*0.5, 480));
  const s=Math.min(maxW/img.width, maxH/img.height), w=Math.round(img.width*s), h=Math.round(img.height*s);
  const dpr=Math.min(2, window.devicePixelRatio||1);
  cCv.width=Math.round(w*dpr); cCv.height=Math.round(h*dpr); cCv.style.width=w+'px'; cCv.style.height=h+'px';
  cEdit.view={ s, w, h };
  const x=cCv.getContext('2d'); x.setTransform(dpr,0,0,dpr,0,0);
  x.drawImage(img,0,0,w,h);
  const M=Math.min(w,h), px=c.cx*w, py=c.cy*h, pr=c.r*M;
  x.save(); x.beginPath(); x.rect(0,0,w,h); x.arc(px,py,pr,0,Math.PI*2,true); x.fillStyle='rgba(17,24,39,.55)'; x.fill('evenodd'); x.restore();
  x.lineWidth=2.5; x.strokeStyle='#fff'; x.beginPath(); x.arc(px,py,pr,0,Math.PI*2); x.stroke();
  x.lineWidth=1; x.strokeStyle='rgba(0,0,0,.6)'; x.beginPath(); x.arc(px,py,pr+1.6,0,Math.PI*2); x.stroke();
  const maxR=Math.min(c.cx*img.width,(1-c.cx)*img.width,c.cy*img.height,(1-c.cy)*img.height)/Math.min(img.width,img.height);
  cR.max=String(Math.max(5, Math.round(maxR*1000)/10)); cR.value=String(Math.round(c.r*1000)/10);
  cRv.textContent=Math.round(c.r*200)+'%';
  $('circleSub').textContent=(cEdit.list.length>1 ? (cEdit.k+1)+'/'+cEdit.list.length+' · ' : '')+(it.work.title ? '「'+it.work.title+'」 ' : '')+'작품의 둥근 가장자리에 원을 맞춰 주세요. 원을 끌어 옮기고, 막대로 크기를 바꿔요.';
}
cR.addEventListener('input', ()=>{ if(!cEdit) return; const it=cEdit.list[cEdit.k];
  it.c=clampCircle(Object.assign({}, it.c, { r:parseFloat(cR.value)/100 }), it.img.width, it.img.height); drawCircleSheet(); });
let cDrag=null;
cCv.addEventListener('pointerdown', (e)=>{ if(!cEdit) return; const it=cEdit.list[cEdit.k];
  cDrag={ x:e.clientX, y:e.clientY, cx:it.c.cx, cy:it.c.cy }; try{ cCv.setPointerCapture(e.pointerId); }catch(err){ /* */ } e.preventDefault(); });
cCv.addEventListener('pointermove', (e)=>{ if(!cDrag || !cEdit) return; const it=cEdit.list[cEdit.k], v=cEdit.view;
  // 원을 옮기되 사진 밖으로는 못 나간다 — 크기는 그대로 두고 가운데만 제한한다
  const M=Math.min(it.img.width,it.img.height), rx=it.c.r*M/it.img.width, ry=it.c.r*M/it.img.height;
  const cx=Math.max(rx, Math.min(1-rx, cDrag.cx+(e.clientX-cDrag.x)/v.w)), cy=Math.max(ry, Math.min(1-ry, cDrag.cy+(e.clientY-cDrag.y)/v.h));
  it.c={ cx, cy, r:it.c.r }; drawCircleSheet(); });
['pointerup','pointercancel'].forEach((ev)=>cCv.addEventListener(ev, ()=>{ cDrag=null; }));
$('circleAuto').addEventListener('click', ()=>{ if(!cEdit) return; const it=cEdit.list[cEdit.k];
  const found=detectArtCircle(it.img);
  if(!found){ toast('사진에서 둥근 작품을 찾지 못했어요. 원을 직접 맞춰 주세요'); return; }
  it.c=clampCircle(found, it.img.width, it.img.height); drawCircleSheet(); });
$('circleNext').addEventListener('click', ()=>{ if(!cEdit) return; cEdit.k=(cEdit.k+1)%cEdit.list.length; drawCircleSheet(); });
function closeCircleSheet(save){
  if(save && cEdit){
    cEdit.list.forEach((it)=>{ savedCircles[it.work.url]={ cx:+it.c.cx.toFixed(4), cy:+it.c.cy.toFixed(4), r:+it.c.r.toFixed(4) }; });
    try{ localStorage.setItem(CIRCLE_KEY, JSON.stringify(savedCircles)); }catch(e){ /* 기억만 못 한다 */ }
    requestRender();
  }
  cEdit=null; cSheet.hidden=true;
}
$('circleDone').addEventListener('click', ()=>closeCircleSheet(true));
cSheet.addEventListener('click', (e)=>{ if(e.target===cSheet) closeCircleSheet(false); });
document.addEventListener('keydown', (e)=>{ if(e.key==='Escape' && !cSheet.hidden) closeCircleSheet(false); });

const sheet=$('saveSheet');
function openSheet(url){
  $('saveSheetImg').src=url;
  sheet.hidden=false;
  $('saveSheetClose').focus();
  savedOnce=true;
  if(EMBED && !IS_SOLD) storyBtn.hidden=false;
}
function closeSheet(){ sheet.hidden=true; $('saveSheetImg').removeAttribute('src'); dlBtn.focus(); }
$('saveSheetClose').addEventListener('click', closeSheet);
sheet.addEventListener('click', (e)=>{ if(e.target===sheet) closeSheet(); });
document.addEventListener('keydown', (e)=>{ if(e.key==='Escape' && !sheet.hidden) closeSheet(); });

/* ── ArtStory 에 올리기 — 이미지를 바깥(마이페이지)에 넘기면, 바깥이 올리고 사진이 실린 글쓰기 칸을 연다 ── */
const STORY_LABEL=storyBtn.textContent;
storyBtn.addEventListener('click', ()=>{
  if(!EMBED) return;
  flushRender();
  storyBtn.disabled=true; storyBtn.textContent='여는 중…';
  try{
    pv.toBlob((b)=>{
      if(!b){ resetStory(); saveFailed(); return; }
      window.parent.postMessage({ type:'artlook:story', blob:b, name:downloadFileName().replace(/\.png$/i, '.jpg') }, location.origin);
    }, 'image/jpeg', 0.92);
  }catch(e){ resetStory(); saveFailed(); }
});
function resetStory(){ storyBtn.disabled=false; storyBtn.textContent=STORY_LABEL; }
window.addEventListener('message', (e)=>{
  if(e.origin!==location.origin || e.source!==window.parent) return;
  if(e.data && e.data.type==='artlook:story-failed') resetStory();
});

/* ── 새 탭(갤러리의 판매작 홍보)에서만 — [닫기]. 스크립트로 연 탭이 아니면 닫히지 않으니 그때는 첫 화면으로 ── */
$('close').addEventListener('click', ()=>{
  window.close();
  setTimeout(()=>{ if(!window.closed) location.href='/'; }, 300);
});

/* ── 마우스로 칩 줄 넘기기 — 좁은 칸의 칩 줄은 옆으로 미는 줄인데, 마우스 휠은 위아래로만 굴러서 1024px 노트북에서
      넘길 방법이 없었다. 줄이 넘칠 때만 세로 휠을 가로로 바꾼다(넓은 칸의 격자는 넘치지 않아 그대로 지나간다) ── */
[worksEl, framesEl, scenesEl, wallsEl].forEach((row)=>{
  row.addEventListener('wheel', (e)=>{
    if(row.scrollWidth<=row.clientWidth+1 || Math.abs(e.deltaX)>Math.abs(e.deltaY)) return;
    row.scrollLeft+=e.deltaY;
    e.preventDefault();
  }, { passive:false });
});

/* ── 시작 ── */
// 휴대폰에서 공유 창이 열리는 브라우저면 단추 이름부터 그렇게 — 누르면 내려받기가 아니라 공유 창(사진에 저장·인스타그램·카카오톡)이 뜬다
if(COARSE && !IN_APP && navigator.share && navigator.canShare) dlBtn.textContent='저장·공유';
buildWorks(); buildFrames(); buildMatColors(); buildRatios(); updateMatRow(); lightUI(); updateFrameLine(); updateSceneLine();
selectTab('works');
// 워터마크 글꼴 — `fonts.ready` 는 그 순간 받는 중인 글꼴만 기다려서, 캔버스에만 쓰는 굵기는 안 기다릴 수 있다.
// 그 굵기·글자를 콕 집어 받는다(위 <link> 의 CSS 는 이 스크립트보다 먼저 읽혔다 — 스타일시트는 뒤의 스크립트를 막는다).
if(document.fonts && document.fonts.load){
  const fontDone=()=>{ fontsOk=true; if(composedBeforeFonts){ composedBeforeFonts=false; requestRender(); } else if(!everComposed) requestRender(); };
  document.fonts.load('700 32px "Pretendard Variable"', 'ArtLink').then(fontDone, fontDone);
  setTimeout(()=>{ fontWaitOver=true; if(!everComposed) requestRender(); }, 1500);
}else{
  fontsOk=true;
}
selectedIndex=-1;
selectWork(0);

// 엔진·하니스가 부르는 것만 내보낸다
window.render=render;
window.requestRender=requestRender;
window.onAssetArrived=onAssetArrived;
})();
