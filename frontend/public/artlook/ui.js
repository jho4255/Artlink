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
const IN_APP=/KAKAOTALK|Instagram|FBAN|FBAV|Line\/|NAVER\(inapp|DaumApps|everytimeApp|BAND\/|ArtLinkApp/i.test(navigator.userAgent);
/**
 * 휴대폰 편집 전용 화면(2026-11-17, PLAN WP4) — 바깥(마이페이지)은 창 폭 1024px 미만에서 이 탭을 상단바·하단 탭바 없이 띄운다
 * (frontend Layout · lib/siteMode isArtLookEditor). 같은 출처라 **바깥 창의 같은 미디어 쿼리**를 본다(index.html 머리의 스크립트와 같은 판정).
 * 그때 이 페이지는 머리에 [닫기]·[저장]을 두고, 저장 단추 묶음은 [저장]이 여는 창 안으로 옮긴다(이 칸이 좁을 때만 — placeActions).
 */
const OUTER_WIDE=(()=>{ try{ return EMBED && window.parent.matchMedia ? window.parent.matchMedia('(min-width: 1024px)') : null; }catch(e){ return null; } })();
/** 이 칸(iframe)의 넓은 배치 — index.html 의 `@media (min-width:860px)` 와 같은 값이어야 한다 */
const WIDE=window.matchMedia ? window.matchMedia('(min-width: 860px)') : null;
const isBare=()=>!!OUTER_WIDE && !OUTER_WIDE.matches;
const isWide=()=>!!(WIDE && WIDE.matches);
/**
 * 우리 안드로이드 앱(규칙 79) — WebView 에는 navigator.share 도 내려받기도 없다. 앱 브리지(window.Capacitor)로 파일을 써서 공유 창을 연다.
 * 이 화면은 React 번들 밖이라 @capacitor/* 를 못 쓴다 — 브리지의 nativePromise 로 같은 Filesystem·Share 플러그인을 부른다(@capacitor/core 의 플러그인 래퍼도 결국 이걸 부른다).
 * ⚠️⚠️ 앱 플러그인은 **최상위 창(main frame)에서 부른 것만** 받는다 — iframe 안의 브리지로 부르면 Capacitor 가
 *    "Plugin execution is allowed in Main Frame only" 로 버리고 Promise 가 영영 끝나지 않는다(2026-11-09 에뮬레이터에서 겪음:
 *    브리지는 iframe 에도 심기므로 '있다'만 보고 쓰면 눌러도 아무 일이 없다). 마이페이지 [ArtLook] 탭은 iframe 이라 같은 출처인 최상위 창의 것을 빌린다.
 */
function nativeBridge(){
  try{
    const c=window.top && window.top.Capacitor;
    if(c && c.nativePromise && c.isNativePlatform && c.isNativePlatform()) return c;
  }catch(e){ /* 최상위가 다른 출처 — 우리 앱이 아니다 */ }
  return null;
}
async function nativeSave(cap, dataUrl, name){
  const b64=dataUrl.slice(dataUrl.indexOf(',')+1);
  const path='exports/'+Date.now()+'/'+name.replace(/[\\/:*?"<>|]+/g,'_');
  const CH=1048576; // 4 의 배수 — 앱이 base64 조각을 따로 풀어 이어 붙여도 원본과 같다(한 번에 넘기면 큰 PNG 에서 메모리를 두 배로 쓴다)
  const uri=await withTimeout((async ()=>{
    for(let i=0; i===0 || i<b64.length; i+=CH){
      const data=b64.slice(i, i+CH);
      if(i===0) await cap.nativePromise('Filesystem','writeFile',{ path, data, directory:'CACHE', recursive:true });
      else await cap.nativePromise('Filesystem','appendFile',{ path, data, directory:'CACHE' });
    }
    return (await cap.nativePromise('Filesystem','getUri',{ path, directory:'CACHE' })).uri;
  })(), 45000);
  await cap.nativePromise('Share','share',{ title:name, files:[uri], dialogTitle:'저장하거나 보낼 곳을 고르세요' });
}
/** 앱 쪽에서 답이 안 오면(위 main frame 함정 같은 것) 말없이 멈추지 않게 — 파일 쓰기에 45초면 넉넉하다. 공유 창이 떠 있는 동안은 재지 않는다 */
function withTimeout(p, ms){
  return Promise.race([p, new Promise((_, rej)=>setTimeout(()=>rej(new Error('native timeout')), ms))]);
}

const pv=$('preview'), stage=$('stage'), busyEl=$('busy'), toastEl=$('toast'), zoomEl=$('zoom');
const worksEl=$('works'), framesEl=$('frames'), scenesEl=$('scenes'), wallsEl=$('walls');
const matSel=$('matSel'), matColorsEl=$('matColors'), ratiosEl=$('ratios'), lo=$('lightOp'), lov=$('lightOpv');
const dlBtn=$('dl'), storyBtn=$('toStory'), panes=$('panes');
const saveOpenBtn=$('saveOpen'), actionsEl=$('actions'), panelEl=document.querySelector('.panel'), saveBox=$('saveBox'), saveSlot=$('saveSlot');
const shapesEl=$('shapes'), presetsEl=$('presets'), sizesEl=$('sizes'), sceneKindsEl=$('sceneKinds');

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

/* ── 작품 크기 고르기(2026-11-17, PLAN WP7) — 크기를 적지 않은 작품을 호수로 그 자리에서 걸어 본다 ──────────────────────
   10월 조사에서 작품의 83% 가 크기가 없었고, 그 작품은 늘 '높이 90cm(30호)'로 걸렸다. [크기 입력하기]는 화면을 떠나야 했다.
   고른 크기는 **이 브라우저에만** 작품 주소별로 기억한다(작품 정보에 저장하지 않는다 — 그건 지금처럼 [크기 입력하기]).
   ⚠️ 긴 변만 호수로 정하고 짧은 변은 **사진 비율**로 만든다(F·P·M 형을 고르게 하지 않는다). 문자열은 저장소 관례대로 **세로 × 가로**(규칙 54).
   ⚠️ 넘겨받은 목록(WORKS)은 고치지 않는다 — 그릴 때마다 사본에 얹는다(workOf). 진짜 크기가 있으면 그게 이긴다. */
const SIZE_KEY='artlook:sizes';
let savedSizes={};
try{ const v=JSON.parse(localStorage.getItem(SIZE_KEY)||'null'); if(v && typeof v==='object') savedSizes=v; }catch(e){ /* 막힌 환경 */ }
const HOSU=[['10호',53.0],['20호',72.7],['30호',90.9],['50호',116.8],['100호',162.2]];
const realSize=(w)=>!!(w && window.ArtLookScene && ArtLookScene.parseSizeCm(w.sizeText || w.size));
/** i 번째 작품 — 크기를 적지 않았고 이 브라우저에서 골라 둔 크기가 있으면 그 크기를 얹은 사본 */
function workOf(i){
  const w=WORKS[i];
  if(!w || w.demo || realSize(w)) return w;
  const c=savedSizes[w.url];
  return c && c.text ? Object.assign({}, w, { sizeText:c.text, sizeChosen:c.kind || 'custom' }) : w;
}

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
  pv.classList.toggle('movable', !!adjTarget());
  placeZoom();
  updateWorkLine();
  updateSceneLine();
  updatePresetLine();
}
/**
 * 확대 단추 자리(2026-11-17, PLAN WP4-D) — 미리보기 위에 얹으면 그림을 가린다.
 *  · 손가락 화면: [−][+] 는 감춘다(두 손가락으로 된다). **조절한 뒤에만** 오른쪽 위에 [처음 자리로].
 *  · 마우스 화면: 그림 옆 여백이 56px 이상이면 그림 **바깥** 왼쪽 아래에 세로로, 모자라면 예전처럼 그림 위 왼쪽 아래.
 *  · 액자가 박힌 장면(adjTarget 없음)은 전부 감춘다.
 */
function placeZoom(){
  const adj=adjTarget();
  if(!adj || pv.hidden){ zoomEl.hidden=true; return; }
  zoomEl.classList.toggle('coarse', COARSE);
  if(COARSE){
    const moved=Math.abs(adj.s-1)>1e-3 || Math.abs(adj.dx)>1e-4 || Math.abs(adj.dy)>1e-4;
    zoomEl.classList.remove('outside');
    zoomEl.hidden=!moved;
    return;
  }
  zoomEl.hidden=false;
  // 그림 옆 여백(무대 안쪽 여백 포함)이 56px 이상이면 단추(40px)를 그 여백에 — 그림을 가리지 않는다
  zoomEl.classList.toggle('outside', (stage.clientWidth-pv.offsetWidth)/2>=56);
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
  placeZoom();
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
let storyBusy=false;            // [ArtStory에 올리기] 가 바깥에 이미지를 넘기는 중
function setSaveEnabled(on){
  dlBtn.disabled=!on; saveOpenBtn.disabled=!on;
  if(!storyBusy) storyBtn.disabled=!on;
}

let toastTimer=0;
function toast(text){
  // 저장 창이 떠 있으면 그 안에 적는다 — 미리보기 위 알림은 창에 가려 안 보인다(2026-11-17, PLAN WP4-C)
  if(!saveBox.hidden){ const st=$('saveStatus'); st.textContent=text; st.hidden=false; return; }
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
// 탭 다섯(2026-11-17, PLAN WP4) — 매트는 액자 탭으로, 조명·비율·벽 캡션은 [마무리]로 모았다. 추천 조합이 첫 탭이다(장면을 못 쓰는 환경은 감춘다)
const TABS=['reco','works','frames','scenes','finish'];
let currentTab='reco';
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
const visibleTabs=()=>TABS.filter((t)=>!$('tab-'+t).hidden);
TABS.forEach((t)=>{
  const tab=$('tab-'+t);
  tab.addEventListener('click', ()=>selectTab(t));
  tab.addEventListener('keydown', (e)=>{
    const list=visibleTabs(), i=list.indexOf(t);
    let j=-1;
    if(e.key==='ArrowRight') j=(i+1)%list.length;
    else if(e.key==='ArrowLeft') j=(i-1+list.length)%list.length;
    else if(e.key==='Home') j=0;
    else if(e.key==='End') j=list.length-1;
    if(j<0) return;
    e.preventDefault();
    selectTab(list[j], true);
  });
});
/** 고른 칩이 보이게 — 좁은 칸은 칩 줄을 옆으로, 넓은 칸은 패널을 위아래로(바깥 페이지는 건드리지 않는다) */
function revealSelected(){
  const pane=$('pane-'+currentTab);
  if(!pane || pane.hidden) return;
  // 줄마다(액자 탭은 모양 줄 + 재질 줄) 고른 칩이 보이게 — 숨긴 칩(다른 무리)은 건너뛴다
  let first=null;
  pane.querySelectorAll('.row').forEach((row)=>{
    const chip=[...row.querySelectorAll('.chip[aria-pressed="true"]')].find((c)=>!c.hidden);
    if(!chip) return;
    if(!first) first=chip;
    if(row.scrollWidth>row.clientWidth+1){
      const left=chip.offsetLeft-row.offsetLeft;
      row.scrollLeft=Math.max(0, left-(row.clientWidth-chip.offsetWidth)/2);
    }
  });
  if(first && panes.scrollHeight>panes.clientHeight+1){
    const pr=panes.getBoundingClientRect(), cr=first.getBoundingClientRect();
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
  b.setAttribute('aria-label', '여러 점');
  // 액자 세 개 그림 — 사진이 아니라 기능 칩이라 선으로만. 이름은 **상자 안에** 둔다(2026-11-17) — 작품 칩엔 이름 줄이 없어서,
  // 이 칩만 아래에 이름을 달면 작품 줄이 19px 높아져 휴대폰 칩 칸(176px)을 넘쳤다(크기 칩 줄과 함께일 때)
  b.innerHTML='<span class="thumb modeicon" aria-hidden="true"><svg viewBox="0 0 48 48" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2.4">'+
    '<rect x="4" y="12" width="15" height="20" rx="1"/><rect x="22" y="9" width="22" height="16" rx="1"/><rect x="22" y="28" width="12" height="12" rx="1"/></svg>'+
    '<span class="mlabel">여러 점</span></span>';
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
  selectedWork=workOf(multi[0]);
  const missing=multi.filter((i)=>!imgCache.has(WORKS[i].url));
  if(!missing.length){
    const was=!!state.group;
    state.group=multi.length>1 ? multi.map((i)=>({ img:imgCache.get(WORKS[i].url), work:workOf(i) })) : null;
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
  selectedWork=workOf(i);
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
  updateSizes();
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
    // 칩으로 고른 크기는 이 브라우저에만 있다 — 작품 정보에 적는 길은 그대로 둔다
    if(w.sizeChosen && EMBED && w.kind!=='sold' && Number.isInteger(w.id)) act=actionButton('크기 입력하기', ()=>goto({ to:'size', id:w.id }));
  }else{
    t.appendChild(document.createTextNode(' · 크기를 적지 않아 높이 90cm(30호 정도)로 걸었어요'));
    // 크기를 적는 곳은 홈페이지 편집의 작품 정보 — 판매작(갤러리가 연 화면)은 작가 것이라 고칠 수 없다
    if(EMBED && w.kind!=='sold' && Number.isInteger(w.id)) act=actionButton('크기 입력하기', ()=>goto({ to:'size', id:w.id }));
  }
  line.appendChild(t);
  if(act) line.appendChild(act);
}
function fmtCm(v){ return (Math.round(v*10)/10).toString(); }
/** 크기 칩 줄 — 한 점 · 진짜 크기가 없는 작품에서만. 사진이 오기 전엔 누를 수 없다(짧은 변을 사진 비율로 만든다) */
function updateSizes(){
  const base=WORKS[selectedIndex];
  const show=!multi && !!base && !base.demo && !realSize(base);
  sizesEl.hidden=!show;
  if(!show) return;
  if(!sizesEl.childElementCount){
    HOSU.forEach(([label, L])=>{
      const b=document.createElement('button');
      b.type='button'; b.textContent=label; b.dataset.kind=label;
      b.addEventListener('click', ()=>{
        const cur=WORKS[selectedIndex]; if(!cur) return;
        if((savedSizes[cur.url]||{}).kind===label){ setWorkSize(null, null); return; }   // 다시 누르면 고른 크기를 뺀다(30호 가정으로)
        setWorkSize(label, hosuText(L));
      });
      sizesEl.appendChild(b);
    });
    const b=document.createElement('button');
    b.type='button'; b.textContent='직접 입력'; b.dataset.kind='custom';
    b.addEventListener('click', openSizeSheet);
    sizesEl.appendChild(b);
  }
  const kind=(savedSizes[base.url]||{}).kind;
  const ready=!!state.img && !workPending && !workError;
  sizesEl.querySelectorAll('button').forEach((b)=>{ b.setAttribute('aria-pressed', String(b.dataset.kind===kind)); b.disabled=!ready; });
}
/** 긴 변 L(cm) → '세로 × 가로 cm' — 짧은 변은 지금 사진의 비율로 */
function hosuText(L){
  const a=state.img ? state.img.width/state.img.height : 1;
  const h=a>=1 ? L/a : L, w=a>=1 ? L : L*a;
  return fmtCm(h)+' × '+fmtCm(w)+' cm';
}
function setWorkSize(kind, text){
  const base=WORKS[selectedIndex]; if(!base) return;
  if(text) savedSizes[base.url]={ text, kind }; else delete savedSizes[base.url];
  try{ localStorage.setItem(SIZE_KEY, JSON.stringify(savedSizes)); }catch(e){ /* 기억만 못 한다 */ }
  selectedWork=workOf(selectedIndex);
  resetAllAdj();                 // 크기가 바뀌었다 — 손으로 키운 배율이 새 크기에 그대로 먹으면 엉뚱하게 커진다
  updateWorkLine();
  requestRender();
}
/* 크기 직접 입력 창 */
const sizeSheet=$('sizeSheet'), sizeH=$('sizeH'), sizeW=$('sizeW'), sizeErr=$('sizeErr');
function openSizeSheet(){
  const cm=selectedWork && selectedWork.sizeChosen ? artCmOf(selectedWork) : null;
  sizeH.value=cm ? fmtCm(cm[1]) : ''; sizeW.value=cm ? fmtCm(cm[0]) : '';
  sizeErr.hidden=true; sizeSheet.hidden=false; sizeH.focus();
}
function closeSizeSheet(){ sizeSheet.hidden=true; const b=sizesEl.querySelector('[data-kind="custom"]'); if(b) b.focus(); }
$('sizeForm').addEventListener('submit', (e)=>{
  e.preventDefault();
  const num=(el)=>parseFloat(String(el.value).replace(',', '.'));
  const h=num(sizeH), w=num(sizeW);
  const ok=(v)=>Number.isFinite(v) && v>=1 && v<=1000;
  if(!ok(h) || !ok(w)){ sizeErr.textContent='세로·가로를 1~1000cm 사이로 적어 주세요'; sizeErr.hidden=false; (ok(h) ? sizeW : sizeH).focus(); return; }
  sizeSheet.hidden=true;
  setWorkSize('custom', fmtCm(h)+' × '+fmtCm(w)+' cm');
  const b=sizesEl.querySelector('[data-kind="custom"]'); if(b) b.focus();
});
$('sizeCancel').addEventListener('click', closeSizeSheet);
sizeSheet.addEventListener('click', (e)=>{ if(e.target===sizeSheet) closeSizeSheet(); });
document.addEventListener('keydown', (e)=>{ if(e.key==='Escape' && !sizeSheet.hidden) closeSizeSheet(); });
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

/* ── 액자 — 모양 × 재질 (2026-11-17, PLAN WP5) ───────────────────────────────
   예전엔 28종을 종류별 묶음으로 한 줄에 늘어놓았는데, SNS 크기로 줄이면 블랙 5종·화이트 6종이 거의 같아 보였다(리뷰 2026-11-17).
   이제 **모양**(몰딩·넓은 몰딩·슬림·플로터·박스·원형·액자 없음)을 먼저 고르고 그 모양의 **재질**을 고른다. 재질 칩은 액자 전체가 아니라
   **왼쪽 위 모서리를 크게** 보여 준다(frames/corners/<id>.webp — build-artlook-thumbs.mjs) — 살 폭·깊이·결이 한눈에 갈린다.
   ⚠️ FRAMES 의 순서(=번호)와 id 는 그대로다(하니스가 번호를, 기억이 id 를 쓴다). 여기 없는 '보이는' 액자가 생기면 테스트가 실패한다
      (artlookScreen.test.ts — 모든 보이는 액자가 정확히 한 모양에). 숨긴 액자(hidden)는 어디에도 넣지 않는다.
   ⚠️ 모양을 바꾸면 **같은 재질을 유지**한다. 없으면 가까운 재질(MAT_NEAR), 그것도 없으면 그 모양의 첫 재질. */
const FRAME_SHAPES=[
  { id:'molding', name:'몰딩', desc:'나무·도장 테를 두른 가장 기본 액자', rep:'oak',
    // 티크·네이비·포레스트·와인은 가진 사진에서 색만 옮긴 액자(2026-11-17, 엔진 PHOTO_TINTS — 품질 관문을 통과한 4종)
    items:[['oak','오크','oak'],['walnut','월넛','walnut'],['maple','메이플','maple'],['teak','티크','teak'],['black','블랙','black'],['white','화이트','white'],
           ['navy','네이비','navy'],['forest','포레스트','forest'],['wine','와인','wine'],['silver','실버','silver'],['gold','골드','gold']] },
  { id:'wide', name:'넓은 몰딩', desc:'테가 넓어 작은 작품도 무게감 있게', rep:'black-wide',
    items:[['black-wide','블랙','black'],['white-wide','화이트','white']] },
  { id:'slim', name:'슬림', desc:'테가 가늘어 작품이 가장 돋보이는 액자', rep:'oak-thin',
    items:[['oak-thin','오크','oak'],['walnut-thin','월넛','walnut'],['slim-black','블랙','black'],['slim-white','화이트','white'],['silver-thin','실버','silver'],['white-mat','화이트 매트','whitemat']] },
  { id:'floater', name:'플로터', desc:'틈을 두고 띄워 거는 캔버스용 액자', rep:'floater-oak',
    items:[['floater-oak','오크','oak'],['floater-walnut','월넛','walnut'],['floater-black','블랙','black'],['floater-white','화이트','white'],['floater-champagne','샴페인','champagne']] },
  { id:'box', name:'박스', desc:'안쪽 벽이 깊은 상자형 입체 액자', rep:'box-oak',
    items:[['box-oak','오크','oak'],['box-walnut','월넛','walnut'],['box-black','블랙','black'],['box-white','화이트','white'],['box-ivory','아이보리','ivory']] },
  { id:'round', name:'원형', desc:'둥근 작품용, 사진 속 원에 테를 맞춰요', rep:'round-black',
    items:[['round-black','블랙','black'],['round-gold','골드','gold']] },
  { id:'none', name:'액자 없음', desc:'캔버스 옆면까지 그대로 거는 방식', rep:'canvas-wrap',
    items:[['canvas-wrap','캔버스','canvas']] },
];
/** 그 재질이 없는 모양으로 옮길 때 고르는 순서 */
const MAT_NEAR={ gold:['champagne','oak'], champagne:['gold','oak'], maple:['oak'], silver:['white'], ivory:['white'], whitemat:['white'], canvas:['oak'],
  teak:['walnut','oak'], navy:['black'], forest:['black'], wine:['black'] };   // 색 옮긴 도장은 블랙 · 티크는 가까운 나무로
/** 화면에 내보일 모양들 — 없는 id·숨긴 액자는 빼고 */
function frameShapes(){
  const shown=(id)=>FRAMES.some((f)=>f.id===id && !f.hidden);
  return FRAME_SHAPES.map((sh)=>Object.assign({}, sh, { items:sh.items.filter(([id])=>shown(id)) })).filter((sh)=>sh.items.length);
}
/** 그 액자(id)가 속한 모양 · 재질 */
function shapeOf(id){ return frameShapes().find((sh)=>sh.items.some(([fid])=>fid===id)) || null; }
function matKeyOf(id){ const sh=shapeOf(id); const it=sh && sh.items.find(([fid])=>fid===id); return it ? it[2] : null; }
const cornerSrc=(id)=>'frames/corners/'+id+'.webp';
window.__artlookShapeOf=(id)=>{ const sh=shapeOf(id); return sh ? sh.id : null; };   // E2E·하니스가 액자 id 로 모양을 찾는다(e2e lib pickFrame)
function frameChip(id, label, cls){
  const b=document.createElement('button');
  b.type='button'; b.className='chip frame'+(cls?' '+cls:''); b.dataset.id=id;
  b.title=label;
  const im=document.createElement('img');
  im.className='thumb'; im.alt=''; im.loading='lazy'; im.decoding='async';
  im.src=cornerSrc(id);              // 미리 구운 모서리 칩(build-artlook-thumbs.mjs) — 액자 사진을 받지 않고도 보인다
  im.onerror=()=>{ im.remove(); };   // 못 받으면 이름만 남는다
  const s=document.createElement('span'); s.className='name'; s.textContent=label;
  b.append(im, s);
  return b;
}
let curShape=null;                   // 화면에서 펼친 모양(고른 액자의 모양과 같다)
function buildShapes(){
  shapesEl.textContent='';
  frameShapes().forEach((sh)=>{
    const b=frameChip(sh.rep, sh.name, 'shape');
    b.dataset.shape=sh.id; delete b.dataset.id;
    b.setAttribute('aria-pressed', 'false');   // setPressed 는 aria-pressed 가 있는 단추만 고친다
    b.addEventListener('click', ()=>selectShape(sh.id, true));
    shapesEl.appendChild(b);
  });
}
/** 지금 모양의 재질 칩 — 원형이면 [원 맞추기] 칩을 바로 옆에(2026-10-25 — 줄 끝의 버튼은 칩과 너무 멀었다) */
function buildFrames(){
  framesEl.textContent='';
  const sh=frameShapes().find((x)=>x.id===curShape) || frameShapes()[0];
  if(!sh) return;
  sh.items.forEach(([id, label])=>{
    const i=FRAMES.findIndex((f)=>f.id===id);
    const b=frameChip(id, label, 'corner');
    b.setAttribute('aria-pressed', String(i===state.frameIdx));
    b.setAttribute('aria-label', sh.name+' '+label);
    b.addEventListener('click', ()=>selectFrame(i));
    framesEl.appendChild(b);
  });
  if(sh.id==='round') framesEl.appendChild(circleChip());
  // 액자 없음(캔버스 랩)은 고를 재질이 하나뿐 — 칸을 차지하지 않게 줄째로 감춘다
  const solo=sh.items.length<2;
  framesEl.hidden=solo; $('framesH').hidden=solo;
}
function circleChip(){
  const b=document.createElement('button');
  b.type='button'; b.className='chip frame corner tool'; b.id='circleChip'; b.title='원 맞추기';
  b.innerHTML='<span class="thumb toolicon" aria-hidden="true"><svg viewBox="0 0 48 48" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2.2">'+
    '<circle cx="24" cy="24" r="15"/><circle cx="24" cy="24" r="9" stroke-dasharray="3 3"/><path d="M24 3v6M24 39v6M3 24h6M39 24h6"/></svg></span>'+
    '<span class="name">원 맞추기</span>';
  b.addEventListener('click', ()=>{
    if((FRAMES[state.frameIdx]||{}).kind!=='round'){ const i=FRAMES.findIndex((f)=>f.kind==='round'); if(i>=0) selectFrame(i); }
    openCircleSheet();
  });
  return b;
}
/** 모양을 고른다 — 같은 재질을 유지하고, 없으면 가까운 재질 · 그 모양의 첫 재질 */
function selectShape(id, byUser){
  const sh=frameShapes().find((x)=>x.id===id);
  if(!sh) return;
  const curMat=matKeyOf((FRAMES[state.frameIdx]||{}).id);
  const want=[curMat, ...(MAT_NEAR[curMat]||[])];
  let pick=null;
  for(const m of want){ pick=sh.items.find((it)=>it[2]===m); if(pick) break; }
  if(!pick) pick=sh.items[0];
  // ⚠️ 모양이 바뀌면 재질 줄을 **여기서** 다시 그린다 — curShape 를 먼저 바꿔 두면 syncFrameControls 는 '안 바뀜'으로 보고
  //    옛 모양의 재질을 그대로 둔다(2026-11-17 e2e 75 B · 84 C 가 잡았다: 박스를 눌러도 몰딩 재질이 보였다)
  const changed=curShape!==sh.id;
  curShape=sh.id;
  if(changed) buildFrames();
  const i=FRAMES.findIndex((f)=>f.id===pick[0]);
  if(i!==state.frameIdx) selectFrame(i);
  else { syncFrameControls(); }
  // 휴대폰(좁은 칸)은 모양 설명 줄을 둘 자리가 없다 — 고를 때 한 번 알려 준다(넓은 칸은 모양 바로 아래 줄에 늘 있다)
  if(byUser && !isWide()) toast(sh.name+' — '+sh.desc);
}
function selectFrame(i){
  state.frameIdx=i;
  newWait();
  savePrefs({ frame:FRAMES[i].id });
  syncFrameControls();
  requestRender();
}
/** 액자 탭을 지금 상태에 맞춘다 — 코드로 바꿨을 때(기억 · 추천 조합)도 모양 줄이 따라온다 */
function syncFrameControls(){
  const f=FRAMES[state.frameIdx]||{};
  const sh=shapeOf(f.id);
  if(sh && sh.id!==curShape){ curShape=sh.id; buildFrames(); }
  else if(!framesEl.childElementCount) buildFrames();
  setPressed(shapesEl, (b)=>b.dataset.shape===curShape);
  setPressed(framesEl, (b)=>b.dataset.id===f.id);
  updateFrameLine();
  updateMatRow();
  if(currentTab==='frames') revealSelected();
}
/** 넓은 칸 — 모양 바로 아래 그 모양의 설명 한 줄(좁은 칸은 CSS 로 감추고, 고를 때 알림으로) */
function updateFrameLine(){
  const line=$('framesLine'); line.textContent='';
  const sh=frameShapes().find((x)=>x.id===curShape);
  if(!sh) return;
  const t=document.createElement('span'); t.className='txt';
  const b=document.createElement('b'); b.textContent=sh.name; t.appendChild(b);
  t.appendChild(document.createTextNode(' — '+sh.desc));
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
  // 이유는 못 쓸 때만 적는다(2026-11-17 — 설명 글은 두지 않는다. 칩 칸이 세 줄이라 자리도 없다)
  const hint=$('matHint'); hint.textContent='';
  hint.classList.toggle('show', !on);
  if(!on){
    const t=document.createElement('span'); t.className='txt';
    t.textContent='캔버스 랩은 액자가 없어 매트를 쓸 수 없어요. 다른 액자를 고르면 켜져요.';
    hint.appendChild(t);
  }
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
    label.className='group'; label.textContent=g==='space' ? '공간' : '벽'; label.dataset.group=g;
    scenesEl.appendChild(label);
    SCENES.forEach((s, i)=>{
      if((s.group||'wall')!==g) return;
      const b=sceneChip(s.name, s.thumb || thumbOf(s.src), i===state.sceneIdx, ()=>selectScene(i));
      b.dataset.idx=String(i); b.dataset.group=g;
      scenesEl.appendChild(b);
    });
  });
  sceneKind=(SCENES[state.sceneIdx]||{}).group || order[0] || 'wall';
  sceneKindsEl.hidden=order.length<2;
  applySceneKind();
}
/* [공간|벽] — 좁은 칸은 고른 무리의 칩만 한 줄에(2026-11-17, PLAN WP8 · 편집 전용 화면으로 미리보기 높이가 생겨 되살렸다 — 10-04 엔 그 한 줄이
   미리보기를 먹어 무리 이름으로만 나눴다). 넓은 칸은 무리 이름을 제목으로 둘 다 보인다.
   ⚠️ state.sceneIdx 는 전체 목록 번호 그대로다(규칙 44j) — 고른 무리는 화면에서만 거른다. */
let sceneKind='space';
function applySceneKind(){
  const narrow=!isWide();
  setPressed(sceneKindsEl, (b)=>b.dataset.kind===sceneKind);
  scenesEl.querySelectorAll('[data-group]').forEach((el)=>{
    el.hidden = narrow && (el.classList.contains('group') || el.dataset.group!==sceneKind);
  });
}
sceneKindsEl.querySelectorAll('button').forEach((b)=>b.addEventListener('click', ()=>{
  sceneKind=b.dataset.kind; applySceneKind(); scenesEl.scrollLeft=0; revealSelected();
}));
function selectScene(i){
  const s=SCENES[i];
  if(s && s.failed && !s.loaded){ s._requested=false; s.failed=false; }   // 못 받은 배경을 다시 누르면 다시 받는다
  state.sceneIdx=i;
  newWait();
  syncSceneControls();
  if(s) savePrefs({ scene:s.id });
  requestRender();
}
/** 배경 탭을 지금 상태에 맞춘다 — 코드로 바꿨을 때(추천 조합)는 그 배경의 무리를 편다 */
function syncSceneControls(){
  const s=SCENES[state.sceneIdx];
  setPressed(scenesEl, (b)=>b.dataset.idx===String(state.sceneIdx));
  if(s && (s.group||'wall')!==sceneKind){ sceneKind=s.group||'wall'; applySceneKind(); }
  updateSceneLine();
  if(currentTab==='scenes') revealSelected();
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
  line.appendChild(t);
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
        buildPresets();
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
  scenesEl.hidden=true; wallsEl.hidden=false; sceneKindsEl.hidden=true;
  buildWalls();
  hideReco();
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
}
function saveFailed(){
  toast('이미지를 만들지 못했어요. 새로고침한 뒤 다시 해 보세요.');
}
dlBtn.addEventListener('click', ()=>{
  if(dlBtn.disabled) return;
  flushRender();
  const name=downloadFileName();
  const cap=nativeBridge();
  if(cap){
    let url;
    try{ url=pv.toDataURL('image/png'); }catch(e){ saveFailed(); return; }
    nativeSave(cap, url, name)
      .then(()=>saved('저장·공유했어요'))
      .catch((err)=>{ if(/cancel/i.test(String((err && err.message) || err))) return; saveFailed(); });
    return;
  }
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
  if(!saveBox.hidden) closeSaveBox(true);   // 창을 겹쳐 띄우지 않는다
  $('saveSheetImg').src=url;
  sheet.hidden=false;
  $('saveSheetClose').focus();
  savedOnce=true;
}
function closeSheet(){ sheet.hidden=true; $('saveSheetImg').removeAttribute('src'); (actionsInSheet() ? saveOpenBtn : dlBtn).focus(); }
$('saveSheetClose').addEventListener('click', closeSheet);
sheet.addEventListener('click', (e)=>{ if(e.target===sheet) closeSheet(); });
document.addEventListener('keydown', (e)=>{ if(e.key==='Escape' && !sheet.hidden) closeSheet(); });

/* ── ArtStory 에 올리기 — 이미지를 바깥(마이페이지)에 넘기면, 바깥이 올리고 사진이 실린 글쓰기 칸을 연다 ── */
const STORY_LABEL=storyBtn.textContent;
storyBtn.addEventListener('click', ()=>{
  if(!EMBED) return;
  flushRender();
  storyBusy=true; storyBtn.disabled=true; storyBtn.textContent='여는 중…';
  try{
    pv.toBlob((b)=>{
      if(!b){ resetStory(); saveFailed(); return; }
      window.parent.postMessage({ type:'artlook:story', blob:b, name:downloadFileName().replace(/\.png$/i, '.jpg') }, location.origin);
    }, 'image/jpeg', 0.92);
  }catch(e){ resetStory(); saveFailed(); }
});
function resetStory(){ storyBusy=false; storyBtn.disabled=dlBtn.disabled; storyBtn.textContent=STORY_LABEL; }
window.addEventListener('message', (e)=>{
  if(e.origin!==location.origin || e.source!==window.parent) return;
  if(e.data && e.data.type==='artlook:story-failed') resetStory();
});

/* ── 새 탭(갤러리의 판매작 홍보)에서만 — [닫기]. 스크립트로 연 탭이 아니면 닫히지 않으니 그때는 첫 화면으로 ── */
$('close').addEventListener('click', ()=>{
  window.close();
  setTimeout(()=>{ if(!window.closed) location.href='/'; }, 300);
});

/* ── 편집 전용 화면(2026-11-17, PLAN WP4) — 머리의 [닫기 ×] · [저장] · 저장 창 ─────────────────────────────
   [닫기]는 바깥(마이페이지)에 알린다 — 바깥이 이전 화면으로(없으면 마이페이지). 저장 단추 묶음은 하나뿐이고, 좁은 칸이면 저장 창 안으로 옮긴다
   (#dl·#toStory 를 두 벌 두지 않는다 — 테스트·저장 코드가 그 id 하나를 본다). */
$('closeX').addEventListener('click', ()=>{
  if(EMBED){ goto({ to:'close' }); return; }
  window.close();
  setTimeout(()=>{ if(!window.closed) location.href='/'; }, 300);
});
function actionsInSheet(){ return isBare() && !isWide(); }
function placeActions(){
  if(actionsInSheet()){ if(actionsEl.parentElement!==saveSlot) saveSlot.appendChild(actionsEl); return; }
  if(!saveBox.hidden) closeSaveBox(true);
  if(actionsEl.parentElement!==panelEl) panelEl.appendChild(actionsEl);
}
function openSaveBox(){
  if(saveOpenBtn.disabled) return;
  flushRender();
  const th=$('saveThumb'), k=Math.min(1, 96/Math.max(pv.width, pv.height)), dpr=Math.min(2, window.devicePixelRatio||1);
  const w=Math.max(1, Math.round(pv.width*k)), h=Math.max(1, Math.round(pv.height*k));
  th.width=Math.round(w*dpr); th.height=Math.round(h*dpr); th.style.width=w+'px'; th.style.height=h+'px';
  try{ th.getContext('2d').drawImage(pv, 0, 0, th.width, th.height); }catch(e){ /* 그림만 못 보인다 */ }
  $('saveName').textContent = multi && multi.length>1 ? multi.length+'점' : ((selectedWork && selectedWork.title) || '제목 없는 작품');
  $('saveDims').textContent = pv.width+' × '+pv.height+'px';
  $('saveStatus').hidden=true; $('saveStatus').textContent='';
  saveBox.hidden=false;
  dlBtn.focus();
}
function closeSaveBox(silent){ saveBox.hidden=true; if(!silent) saveOpenBtn.focus(); }
saveOpenBtn.addEventListener('click', openSaveBox);
$('saveBoxClose').addEventListener('click', ()=>closeSaveBox());
saveBox.addEventListener('click', (e)=>{ if(e.target===saveBox) closeSaveBox(); });
document.addEventListener('keydown', (e)=>{ if(e.key==='Escape' && !saveBox.hidden) closeSaveBox(); });
/** 편집 전용 화면 · 넓은 칸이 바뀌면(창 크기·기기 회전) 머리·저장 자리·배경 무리·확대 단추를 다시 맞춘다 */
function applyMode(){
  document.documentElement.classList.toggle('bare', isBare());
  placeActions(); applySceneKind(); fitPreview();
}
[OUTER_WIDE, WIDE].forEach((mq)=>{ if(mq && mq.addEventListener) mq.addEventListener('change', applyMode); });
// 바깥 창에 단 듣기는 이 문서가 떠날 때 뗀다(iframe 이 사라져도 바깥 창이 이 문서를 붙잡고 있지 않게)
window.addEventListener('pagehide', ()=>{ try{ if(OUTER_WIDE && OUTER_WIDE.removeEventListener) OUTER_WIDE.removeEventListener('change', applyMode); }catch(e){ /* */ } });

/* ── 추천 조합(2026-11-17, PLAN WP6) — 액자·매트·배경·조명을 한 번에. 비율·작품 크기·자리는 그대로 둔다 ──────────────
   칩 그림은 **미리 구운 파일**(presets/<id>.webp — build-artlook-thumbs.mjs 가 데모 그림으로 굽는다).
   ⚠️ 내 작품으로 여덟 조합을 그 자리에서 그리지 말 것 — 배경 여덟 장(장당 0.2~1.6MB)과 액자 사진을 다 받게 된다(규칙 65 '고른 것만 받는다'). */
const PRESETS=[
  { id:'charcoal', name:'차콜 조명',     frame:'floater-oak', mat:0.10, matColor:'#f5f2ea', scene:'charcoal',       light:0.35 },
  { id:'cube',     name:'화이트 큐브',   frame:'black',       mat:0.05, matColor:'#ffffff', scene:'white-cube',     light:0 },
  { id:'living',   name:'따뜻한 거실',   frame:'oak',         mat:0.05, matColor:'#f5f2ea', scene:'gallery-living', light:0 },
  { id:'plaster',  name:'흰 벽',         frame:'white',       mat:0.10, matColor:'#f5f2ea', scene:'white-plaster',  light:0 },
  { id:'burgundy', name:'버건디 골드',   frame:'gold',        mat:0.05, matColor:'#f5f2ea', scene:'burgundy',       light:0 },
  { id:'brick',    name:'흰 벽돌',       frame:'slim-black',  mat:0,    matColor:null,      scene:'white-brick',    light:0 },
  { id:'home',     name:'컬렉터 홈',     frame:'walnut',      mat:0.05, matColor:'#f5f2ea', scene:'collector-home', light:0 },
  { id:'canvas',   name:'콘크리트 캔버스', frame:'canvas-wrap', mat:0,  matColor:null,      scene:'concrete',       light:0 },
];
window.__artlookPresets=PRESETS.map((p)=>Object.assign({}, p));   // 칩 굽기(build-artlook-thumbs.mjs)가 같은 표를 읽는다
const presetOk=(p)=>FRAMES.some((f)=>f.id===p.frame && !f.hidden) && SCENES.some((x)=>x.id===p.scene);
function presetMatches(p){
  const f=FRAMES[state.frameIdx]||{}, sc=SCENES[state.sceneIdx]||{};
  return state.mode==='scene' && f.id===p.frame && sc.id===p.scene && Math.abs((state.matWidth||0)-p.mat)<1e-9 &&
    (!p.mat || state.matteColor===p.matColor) && Math.abs((state.light||0)-p.light)<1e-3;
}
function buildPresets(){
  presetsEl.textContent='';
  PRESETS.filter(presetOk).forEach((p)=>{
    const b=document.createElement('button');
    b.type='button'; b.className='chip preset'; b.dataset.preset=p.id; b.title=p.name;
    b.setAttribute('aria-pressed', 'false');
    const im=document.createElement('img');
    im.className='thumb'; im.alt=''; im.loading='lazy'; im.decoding='async'; im.src='presets/'+p.id+'.webp';
    im.onerror=()=>{ im.style.visibility='hidden'; };
    const nm=document.createElement('span'); nm.className='name'; nm.textContent=p.name;
    b.append(im, nm);
    b.addEventListener('click', ()=>applyPreset(p));
    presetsEl.appendChild(b);
  });
  updatePresetLine();
}
function applyPreset(p){
  const fi=FRAMES.findIndex((f)=>f.id===p.frame), si=SCENES.findIndex((x)=>x.id===p.scene);
  if(fi<0 || si<0) return;
  const sc=SCENES[si];
  if(sc && sc.failed && !sc.loaded){ sc._requested=false; sc.failed=false; }
  state.frameIdx=fi; state.sceneIdx=si; state.matWidth=p.mat;
  if(p.matColor){ state.matteColor=p.matColor; state.matTexture=matTextureOf(p.matColor); }
  state.light=p.light;
  newWait();
  savePrefs({ frame:p.frame, scene:p.scene, mat:p.mat, matColor:state.matteColor, light:p.light });
  syncFrameControls();
  setPressed(matColorsEl, (x)=>x.dataset.color===state.matteColor);
  syncSceneControls();
  lightUI();
  updatePresetLine();
  requestRender();
}
/** 칩 아래 한 줄 — **지금 고른 것**(조합과 무관하게 현재 상태에서 만든다) */
function updatePresetLine(){
  setPressed(presetsEl, (b)=>{ const p=PRESETS.find((x)=>x.id===b.dataset.preset); return !!p && presetMatches(p); });
  const line=$('presetLine'); line.textContent='';
  const f=FRAMES[state.frameIdx]; if(!f) return;
  const sh=shapeOf(f.id);
  const parts=[sh && sh.id!=='molding' && sh.id!=='none' && !f.name.includes(sh.name.replace('넓은 ','')) ? f.name+' '+sh.name : f.name];
  if(f.kind!=='canvas') parts.push((state.matWidth||0)<=0 ? '매트 없음' : (state.matWidth>=0.1 ? '넓은 매트' : '좁은 매트'));
  const bg=state.mode==='scene' ? (SCENES[state.sceneIdx]||{}).name : (WALLS[state.wallIdx]||{}).name;
  if(bg) parts.push(bg);
  if((state.light||0)>0) parts.push('조명 '+Math.round(state.light*100)+'%');
  const t=document.createElement('span'); t.className='txt'; t.textContent=parts.join(' · ');
  line.appendChild(t);
}
/** 장면을 못 쓰는 환경(WebGL2 없음·목록 없음) — 추천 조합은 장면을 쓰므로 탭째로 감춘다 */
function hideReco(){
  $('tab-reco').hidden=true; $('pane-reco').hidden=true;
  if(currentTab==='reco') selectTab('works');
}

/* ── 마우스로 칩 줄 넘기기 — 좁은 칸의 칩 줄은 옆으로 미는 줄인데, 마우스 휠은 위아래로만 굴러서 1024px 노트북에서
      넘길 방법이 없었다. 줄이 넘칠 때만 세로 휠을 가로로 바꾼다(넓은 칸의 격자는 넘치지 않아 그대로 지나간다) ── */
[worksEl, framesEl, scenesEl, wallsEl, shapesEl, presetsEl].forEach((row)=>{
  row.addEventListener('wheel', (e)=>{
    if(row.scrollWidth<=row.clientWidth+1 || Math.abs(e.deltaX)>Math.abs(e.deltaY)) return;
    row.scrollLeft+=e.deltaY;
    e.preventDefault();
  }, { passive:false });
});

/* ── 시작 ── */
// 휴대폰에서 공유 창이 열리는 브라우저면 단추 이름부터 그렇게 — 누르면 내려받기가 아니라 공유 창(사진에 저장·인스타그램·카카오톡)이 뜬다
if((COARSE && !IN_APP && navigator.share && navigator.canShare) || nativeBridge()) dlBtn.textContent='저장·공유';
// [ArtStory에 올리기]는 처음부터 보인다(2026-11-17 — 예전엔 저장한 뒤에야 나왔다). 판매작(갤러리가 연 화면)엔 없다
storyBtn.hidden=!(EMBED && !IS_SOLD);
buildWorks(); buildShapes(); syncFrameControls(); buildMatColors(); buildRatios(); updateMatRow(); lightUI(); updateSceneLine();
const SCENES_OK=!!(window.ArtLookScene && ArtLookScene.supported());
if(SCENES_OK) selectTab('reco'); else { hideReco(); selectTab('works'); }
applyMode();
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
