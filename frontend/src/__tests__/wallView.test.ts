/**
 * 작가 홈페이지 작품 보기의 [벽에 걸어 보기] (2026-10-22, CLAUDE.md 규칙 74).
 *
 * 판단(lib/wallView.ts)은 그대로 부르고, 번들 밖 엔진(public/artlook/view.js·index.html·ui.js)과 화면 연결은 소스로 고정한다.
 * 실제로 그려지는지·잘리지 않는지·화면이 멈추지 않는지는 e2e `74-wall-view` 와 `scratchpad/wall-view/` 하니스가 본다
 * (jsdom 에는 WebGL 도 iframe 문서도 없다).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  GL_LOST, WALL_VIEW_URL, WallCache, isUnsupportedReason, readViewerMode, readWallMessage, renderRequest, saveViewerMode,
  wallJobs, wallPrefetchAllowed, wallRenderScale, wallSourceUrl, wallViewLikelySupported, type WallQuality,
} from '@/lib/wallView';

const PUB = resolve(__dirname, '../../public/artlook');
const pub = (p: string) => readFileSync(resolve(PUB, p), 'utf-8');
const src = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf-8');
const view = pub('view.js');
const html = pub('index.html');
const ui = pub('ui.js');
/** 주석을 뺀 코드 — '하지 말 것'을 설명하는 주석이 금지어를 그대로 적고 있다 */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

afterEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('보기 방식 기억 — 이 탭에서만', () => {
  it('처음엔 사진, 벽을 고르면 벽, 사진으로 돌리면 지운다', () => {
    expect(readViewerMode()).toBe('photo');
    saveViewerMode('wall');
    expect(readViewerMode()).toBe('wall');
    expect(sessionStorage.getItem('artlink-artwork-view')).toBe('wall');
    saveViewerMode('photo');
    expect(readViewerMode()).toBe('photo');
    expect(sessionStorage.getItem('artlink-artwork-view')).toBeNull();
  });

  it('저장소가 막혀도 던지지 않는다 — 늘 사진부터', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(() => saveViewerMode('wall')).not.toThrow();
    expect(readViewerMode()).toBe('photo');
  });
});

describe('되는 브라우저인가 · 미리 그려도 되는가', () => {
  it('WebGL2 가 없으면(jsdom) 토글을 감출 쪽으로', () => {
    expect(wallViewLikelySupported()).toBe(false);
  });

  it('데이터 절약·2G·3G 면 이웃을 미리 그리지 않는다', () => {
    const set = (c: unknown) => Object.defineProperty(navigator, 'connection', { value: c, configurable: true });
    set(undefined);
    expect(wallPrefetchAllowed()).toBe(true);
    set({ saveData: true, effectiveType: '4g' });
    expect(wallPrefetchAllowed()).toBe(false);
    for (const t of ['slow-2g', '2g', '3g']) { set({ effectiveType: t }); expect(wallPrefetchAllowed(), t).toBe(false); }
    set({ effectiveType: '4g' });
    expect(wallPrefetchAllowed()).toBe(true);
    set(undefined);
  });
});

describe('그릴 사진 — 초안은 t800, 완성은 원본', () => {
  it('t800 폴더를 끼운다(Thumb 와 같은 규칙) · 원본은 그대로', () => {
    expect(wallSourceUrl('https://img.artlink.cc/artlink/abc.jpg', 'draft')).toBe('https://img.artlink.cc/artlink/t800/abc.jpg');
    expect(wallSourceUrl('/uploads/abc.jpg', 'draft')).toBe('/uploads/t800/abc.jpg');
    expect(wallSourceUrl('/uploads/abc.jpg', 'full')).toBe('/uploads/abc.jpg');
  });
});

describe('iframe 과 주고받는 말', () => {
  const jpeg = (n = 10) => new Blob([new Uint8Array(n)], { type: 'image/jpeg' });

  it('준비·안 됨·그림·실패를 읽는다', () => {
    expect(readWallMessage({ type: 'artlook:view-ready' })).toEqual({ type: 'ready' });
    expect(readWallMessage({ type: 'artlook:view-unsupported', reason: 'webgl' })).toEqual({ type: 'unsupported', reason: 'webgl' });
    const b = jpeg();
    expect(readWallMessage({ type: 'artlook:rendered', req: 3, blob: b, ratio: '4:5' })).toEqual({ type: 'rendered', req: 3, blob: b, ratio: '4:5' });
    expect(readWallMessage({ type: 'artlook:render-failed', req: 4, reason: 'decode' })).toEqual({ type: 'failed', req: 4, reason: 'decode' });
  });

  it('모양이 틀리면 버린다 — 모르는 종류 · 번호 · JPEG 아닌 그림 · 빈/너무 큰 그림 · 이상한 비율', () => {
    expect(readWallMessage(null)).toBeNull();
    expect(readWallMessage('artlook:view-ready')).toBeNull();
    expect(readWallMessage({ type: 'artlook:goto', to: 'upload' })).toBeNull();
    expect(readWallMessage({ type: 'artlook:rendered', req: 0, blob: jpeg() })).toBeNull();
    expect(readWallMessage({ type: 'artlook:rendered', req: 1.5, blob: jpeg() })).toBeNull();
    expect(readWallMessage({ type: 'artlook:rendered', req: 1, blob: new Blob(['<svg/>'], { type: 'image/svg+xml' }) })).toBeNull();
    expect(readWallMessage({ type: 'artlook:rendered', req: 1, blob: new Blob([], { type: 'image/jpeg' }) })).toBeNull();
    expect(readWallMessage({ type: 'artlook:rendered', req: 1, blob: 'x' })).toBeNull();
    const big = { size: 30 * 1024 * 1024, type: 'image/jpeg' };
    Object.setPrototypeOf(big, Blob.prototype);
    expect(readWallMessage({ type: 'artlook:rendered', req: 1, blob: big })).toBeNull();
    expect((readWallMessage({ type: 'artlook:rendered', req: 1, blob: jpeg(), ratio: '<b>' }) as { ratio: string }).ratio).toBe('');
    expect(readWallMessage({ type: 'artlook:render-failed', req: -1 })).toBeNull();
  });

  it('★ 보내는 말 — 합성 배율은 초안 1 · 완성 2(ArtLook 탭 저장과 같은 화질 — 낮췄더니 "아트룩보다 개쓰레기")', () => {
    const b = jpeg();
    expect(renderRequest(7, b, 'draft')).toEqual({ type: 'artlook:render', req: 7, blob: b, ss: 1 });
    expect(renderRequest(8, b, 'full')).toEqual({ type: 'artlook:render', req: 8, blob: b, ss: 2 });
    expect(wallRenderScale('draft')).toBe(1);
    expect(wallRenderScale('full')).toBe(2);
  });

  it('이 브라우저에서 안 되는 이유만 토글을 감춘다 — 벽 사진을 못 받은 건 다시 해 볼 수 있다', () => {
    expect(isUnsupportedReason('webgl')).toBe(true);
    expect(isUnsupportedReason('frame')).toBe(true);
    expect(isUnsupportedReason('scene')).toBe(false);
    expect(isUnsupportedReason(GL_LOST)).toBe(false);   // WebGL 을 잃은 건 새로 띄우면 된다
    expect(isUnsupportedReason('boot-timeout')).toBe(false);
  });
});

describe('그릴 순서 — 지금 작품(초안 → 원본) → 이웃 초안', () => {
  const run = (o: { index: number; total: number; have?: Record<number, WallQuality>; failed?: number[]; prefetch?: boolean }) =>
    wallJobs({
      index: o.index,
      total: o.total,
      has: (i) => o.have?.[i] ?? null,
      failed: (i) => (o.failed ?? []).includes(i),
      prefetch: o.prefetch ?? true,
    }).map((j) => `${j.index}:${j.quality}`);

  it('아무것도 없으면 지금 작품 초안 → 원본 → 다음 → 이전(넘김은 고리)', () => {
    expect(run({ index: 0, total: 5 })).toEqual(['0:draft', '0:full', '1:draft', '4:draft']);
  });
  it('초안이 있으면 원본부터 · 원본이 있으면 이웃만', () => {
    expect(run({ index: 2, total: 5, have: { 2: 'draft' } })).toEqual(['2:full', '3:draft', '1:draft']);
    expect(run({ index: 2, total: 5, have: { 2: 'full', 3: 'draft' } })).toEqual(['1:draft']);
  });
  it('못 그린 작품은 건너뛴다 · 미리 그리기를 끄면 지금 작품만', () => {
    expect(run({ index: 1, total: 3, failed: [1] })).toEqual(['2:draft', '0:draft']);
    expect(run({ index: 1, total: 3, prefetch: false })).toEqual(['1:draft', '1:full']);
  });
  it('작품이 하나·둘일 때 같은 작품을 두 번 넣지 않는다 · 범위 밖이면 없음', () => {
    expect(run({ index: 0, total: 1 })).toEqual(['0:draft', '0:full']);
    expect(run({ index: 0, total: 2 })).toEqual(['0:draft', '0:full', '1:draft']);
    expect(run({ index: 5, total: 3 })).toEqual([]);
    expect(run({ index: 0, total: 0 })).toEqual([]);
  });
});

describe('그린 그림 보관 — 작품당 가장 좋은 한 장, 오래된 것부터 놓는다', () => {
  it('원본이 오면 초안을 바꿔 끼우고 놓는다 · 늦게 온 초안은 버린다', () => {
    const revoked: string[] = [];
    const c = new WallCache(5, (u) => revoked.push(u));
    expect(c.put('a', 'draft', 'blob:d1')).toBe(true);
    expect(c.put('a', 'full', 'blob:f1')).toBe(true);
    expect(c.peek('a')).toEqual({ quality: 'full', src: 'blob:f1' });
    expect(revoked).toEqual(['blob:d1']);
    expect(c.put('a', 'draft', 'blob:d2')).toBe(false);
    expect(c.peek('a')?.src).toBe('blob:f1');
    expect(revoked).toEqual(['blob:d1', 'blob:d2']);
  });

  it('넘치면 가장 오래 안 본 것부터 — 지금 보는 것(touch)은 남는다', () => {
    const revoked: string[] = [];
    const c = new WallCache(2, (u) => revoked.push(u));
    c.put('a', 'full', 'blob:a');
    c.put('b', 'full', 'blob:b');
    c.touch('a');
    c.put('c', 'full', 'blob:c');
    expect(c.peek('b')).toBeNull();
    expect(c.peek('a')?.src).toBe('blob:a');
    expect(revoked).toEqual(['blob:b']);
    c.clear();
    expect(c.size).toBe(0);
    expect(revoked.sort()).toEqual(['blob:a', 'blob:b', 'blob:c']);
  });
});

describe('엔진(public/artlook) — 보기 전용(view.js)', () => {
  // view.js 의 ratioFor 를 그대로 꺼내 돌린다 — 가로 캔버스에 세로 작품을 걸면 위아래가 잘렸다(2026-10-22 실측).
  // (저장소의 우리 파일을 테스트 안에서만 평가한다 — 바깥 입력이 아니다)
  const ratioSrc = view.match(/function ratioFor\(a\)\{[\s\S]*?\n\}/)?.[0];
  const ratioFor = new Function(`${ratioSrc}; return ratioFor;`)() as (a: number) => string;

  it('★ 출력 비율은 작품 방향 — 세로 작품은 세로 캔버스, 가로 작품은 가로 캔버스', () => {
    expect(ratioSrc).toBeTruthy();
    expect(ratioFor(45.5 / 53)).toBe('4:5');
    expect(ratioFor(0.5)).toBe('9:16');
    expect(ratioFor(1)).toBe('1:1');
    expect(ratioFor(0.95)).toBe('1:1');
    expect(ratioFor(1.33)).toBe('5:4');
    expect(ratioFor(2.4)).toBe('16:9');
    expect(ratioFor(NaN)).toBe('4:5');
    for (const a of [0.3, 0.62, 0.7, 0.92, 1.0, 1.09, 1.5, 1.6, 3]) {
      const [w, h] = ratioFor(a).split(':').map(Number);
      expect(Math.sign(Math.log(w! / h!)) === Math.sign(Math.log(a)) || w === h, `${a} → ${ratioFor(a)}`).toBe(true);
    }
  });

  it('★ 방문자의 브라우저에 남의 작품 목록을 남기지 않는다 — localStorage 를 읽지도 쓰지도 않는다', () => {
    expect(code(view)).not.toMatch(/localStorage/);
    expect(code(view)).not.toMatch(/artlook:works|artlook:prefs/);
  });

  it('감춘 iframe 에선 돌지 않을 수 있는 requestAnimationFrame 을 쓰지 않는다 — compose() 를 바로 부른다', () => {
    expect(code(view)).not.toMatch(/requestAnimationFrame/);
    expect(view).toMatch(/const out=compose\(\);/);
  });

  it('차콜 벽 · 오크 플로터 · 매트 넓게(10%, 미색) · 조명 없음 · 워터마크 없음 · 실치수 없이(30호 가정 + 자동 프레이밍)', () => {
    expect(view).toMatch(/const SCENE_ID='charcoal';/);
    expect(view).toMatch(/const FRAME_ID='floater-oak';/);
    expect(view).toMatch(/const MAT_WIDTH=0\.10;/);
    expect(view).toMatch(/const MAT_COLOR='#f5f2ea';/);
    expect(view).toMatch(/FRAMES\.findIndex\(\(f\)=>f\.id===FRAME_ID\)/);
    expect(view).toMatch(/matWidth:MAT_WIDTH, matteColor:MAT_COLOR, light:0/);
    // 고른 값이 엔진 목록에 실제로 있어야 한다(이름을 바꾸면 조용히 다른 그림이 된다)
    expect(html).toMatch(/\{ id:'floater-oak', name:'오크 플로터',\s+kind:'floater', material:'wood'/);
    expect(pub('scenes/scenes.json')).toMatch(/"id": "charcoal"/);
    expect(ui).toMatch(/const MAT_WIDTHS=\[0,0\.05,0\.10\];/);
    expect(ui).toMatch(/const MAT_COLORS=\[\['#f5f2ea','미색'\]/);
    // 액자 자산(사진 액자면 목록 → PNG, 플로터면 결 텍스처)까지 와야 준비 신호
    expect(view).toMatch(/window\.onAssetArrived=\(key\)=>\{ if\(key==='frames\.json'\) ensureFrameAssets\(frameStyle\); check\(\); \};/);
    expect(view).toMatch(/if\(!frameAssetsReady\(frameStyle\)\) return;/);
    expect(view).toMatch(/watermark:false/);
    expect(view).toMatch(/selectedWork=null;/);
    expect(html).toMatch(/function drawWatermark\(ctx,W,H\)\{[\s\S]{0,400}if\(state\.watermark===false\) return;/);
  });

  it('★ 완성은 ArtLook 탭 저장과 같은 화질 — 합성 배율 2 · 작품 사진은 엔진의 capToCanvas(2,600px) 그대로', () => {
    const scaleSrc = view.match(/function scaleOf\(v\)\{[\s\S]*?\n\}/)?.[0];
    expect(scaleSrc).toBeTruthy();
    const scaleOf = new Function(`${scaleSrc}; return scaleOf;`)() as (v: unknown) => number;
    expect(scaleOf(2)).toBe(2);
    expect(scaleOf(1)).toBe(1);
    expect(scaleOf(0.6)).toBe(1);   // 출력보다 작게 그리는 초안은 없다(뭉개졌다)
    expect(scaleOf('2')).toBe(1);
    expect(view).toMatch(/draft:job\.ss!==2, watermark:false/);
    expect(view).toMatch(/art=capToCanvas\(im\);/);
    expect(code(view)).not.toMatch(/draftScale|ART_LONG/);
    // 엔진의 배율 줄은 ArtLook 탭과 같은 그대로 — 초안(끌기)은 1, 아니면 SUPERSAMPLE(2)
    expect(html).toMatch(/const SS=state\.draft \? 1 : Math\.max\(1, Math\.min\(SUPERSAMPLE, STAGE_MAX\/Math\.max\(OW,OH\)\)\);/);
    expect(html).toMatch(/const SUPERSAMPLE=2\.0/);
  });

  it('★ WebGL 을 잃으면 작품 없이 그림자만 남은 그림을 보내지 않는다 — iframe 을 접고 바깥이 새로 띄운다(두 번까지)', () => {
    expect(src('../public/artlook/scene.js')).toMatch(/const glLost = \(\) => !!\(_gl && typeof _gl\.isContextLost === 'function' && _gl\.isContextLost\(\)\);/);
    const job = view.slice(view.indexOf('async function renderJob'), view.indexOf('async function pump'));
    expect(job.indexOf("if(ArtLookScene.glLost && ArtLookScene.glLost()){ fail('gl-lost'); throw new Error('gl-lost'); }")).toBeGreaterThan(job.indexOf('const out=compose();'));
    expect(job.indexOf("fail('gl-lost')")).toBeLessThan(job.indexOf('await toJpeg(out)'));
    expect(src('hooks/useWallView.ts')).toMatch(/e\.message === GL_LOST && shared\.glRestarts < GL_RESTART_MAX/);
  });

  it("'처음 한 번' 비용을 준비 신호 전에 치른다 — 벽 사진 해독 · 광원 측정 · 텍스처(장면 합성과 같은 열쇠)", () => {
    expect(view).toMatch(/warmUp\(\)\.then\(\(\)=>\{[\s\S]{0,120}ready=true;\s*post\(\{ type:'artlook:view-ready' \}\);/);
    expect(view).toMatch(/scene\.img\.decode\(\)/);
    expect(view).toMatch(/ArtLookScene\.sceneLightModel\(scene\)/);
    expect(view).toMatch(/sceneKey:scene\.src/);
    expect(src('../public/artlook/scene.js')).toMatch(/sceneImg: scene\.img, sceneKey: scene\.src, fit,/);
  });

  it('바깥 창·같은 출처에서 온 말만 받는다 · 한 번에 하나만 그린다', () => {
    expect(view).toMatch(/if\(!parentWin \|\| e\.source!==parentWin \|\| e\.origin!==location\.origin\) return;/);
    expect(view).toMatch(/if\(busy \|\| !ready \|\| dead\) return;/);
  });

  it('?view=1 이면 화면(ui.js)은 아무것도 안 하고 body 를 감춘다(글꼴·칩을 받지 않게) · 평소엔 view.js 가 첫 줄에서 끝난다', () => {
    expect(html).toMatch(/const VIEW_ONLY=\/\[\?&\]view=1\(&\|\$\)\/\.test\(location\.search\);/);
    expect(html).toMatch(/classList\.add\('view-only'\)/);
    expect(html).toMatch(/\.view-only body\{display:none\}/);
    expect(ui.slice(0, ui.indexOf('const $='))).toMatch(/if\(typeof VIEW_ONLY!=='undefined' && VIEW_ONLY\) return;/);
    expect(view.slice(0, view.indexOf("const SCENE_ID"))).toMatch(/if\(typeof VIEW_ONLY==='undefined' \|\| !VIEW_ONLY\) return;/);
    // ui.js 다음에 싣는다 — ArtLook 탭은 ui.js 가 먼저 돈다
    expect(html.indexOf('<script src="view.js?v=__ARTLOOK_BUILD__"></script>')).toBeGreaterThan(html.indexOf('<script src="ui.js?v=__ARTLOOK_BUILD__"></script>'));
  });
});

describe('화면 연결 — 작가 홈페이지', () => {
  const viewer = src('components/shared/ArtworkViewer.tsx');
  const hook = src('hooks/useWallView.ts');
  const page = src('pages/PortfolioPage.tsx');

  it('작가 홈페이지는 작품 전용 창을 쓴다(갤러리·전시 사진의 ImageLightbox 는 그대로)', () => {
    expect(page).toMatch(/<ArtworkViewer/);
    expect(page).not.toMatch(/ImageLightbox/);
    expect(page).toMatch(/shareUrl=\{\(i\) => artistUrl\(portfolio\.user, ordered\[i\]\?\.id\)\}/);
    for (const f of ['pages/GalleryDetailPage.tsx', 'pages/ShowDetailPage.tsx', 'pages/ExhibitionDetailPage.tsx']) {
      expect(src(f), f).toMatch(/ImageLightbox/);
    }
  });

  it('★ dialog 표시 — 비회원 소개 팝업이 이 창 위로 뜨지 않는다(규칙 73 이 aria-modal 을 기다린다)', () => {
    expect(viewer).toMatch(/role="dialog"\s+aria-modal="true"/);
    expect(src('components/shared/GuestIntro.tsx')).toMatch(/\[aria-modal="true"\]/);
  });

  it('작품을 자르지도 모서리를 깎지도 않는다(규칙 18) — 썸네일 줄도 정사각 칸 + contain', () => {
    expect(code(viewer)).not.toMatch(/object-cover/);
    expect(code(viewer)).not.toMatch(/rounded-lg/);
    expect(viewer).toMatch(/max-w-full min-h-0 select-none object-contain`;/);
    expect(viewer).toMatch(/h-16 w-16 shrink-0 place-items-center/);
  });

  it('토글은 엔진이 될 때만 · 처음엔 사진 · 벽을 고르면 이 탭에서 기억한다', () => {
    expect(viewer).toMatch(/useState<ViewerMode>\(\(\) => readViewerMode\(\)\)/);
    expect(viewer).toMatch(/const showWall = mode === 'wall' && wall\.available;/);
    expect(viewer).toMatch(/\{wall\.available \? \(/);
    expect(viewer).toMatch(/saveViewerMode\(m\)/);
  });

  it('iframe — 보낸 쪽 확인 · 화면 밖(display:none 아님) · 창이 닫히면 걷는다', () => {
    expect(hook).toMatch(/if \(e\.source !== this\.frame\.contentWindow \|\| e\.origin !== window\.location\.origin\) return;/);
    expect(hook).toMatch(/f\.src = WALL_VIEW_URL;/);
    expect(WALL_VIEW_URL).toBe('/artlook/index.html?view=1');
    expect(hook).toMatch(/position:fixed;left:-10000px/);
    expect(code(hook)).not.toMatch(/display:none/);
    expect(hook).toMatch(/this\.frame\.remove\(\);/);
    expect(hook).toMatch(/frameRef\.current\?\.destroy\(\);/);
  });

  it('★ 캡션은 작품 바로 아래 가운데(사진·벽 둘 다) — 구석에 두었더니 안 보인다고 했다 · 그 자리를 남기고 작품을 줄인다', () => {
    const stage = viewer.slice(viewer.indexOf('flex flex-col items-center justify-center'), viewer.indexOf('{showWall && !wall.src'));
    expect(stage).toMatch(/\{media\}\s*\{hasCaption && \(/);
    expect(stage).toMatch(/data-testid="artwork-caption"/);
    expect(stage).toMatch(/text-center/);
    expect(viewer).toMatch(/hasCaption \? 'max-h-\[calc\(100%-6rem\)\] sm:max-h-\[calc\(100%-5rem\)\]' : 'max-h-full'/);
    // 좋아요·공유 — PC 는 위 줄, 휴대폰은 아래 줄. 한 번만 그린다(두 벌을 CSS 로 숨기면 같은 단추가 둘이 된다)
    expect(viewer).toMatch(/\{wide && actions\}/);
    expect(viewer).toMatch(/\{!wide && actions && \(/);
    expect(code(viewer).match(/\{actions\}/g)?.length).toBe(1);
  });

  it('[벽에 걸어 보기]에 마우스를 올리거나 누르기 시작하면 엔진을 미리 띄운다 · 사진 받기는 엔진 준비와 함께', () => {
    expect(viewer).toMatch(/onPointerEnter=\{wall\.warm\}/);
    expect(viewer).toMatch(/onPointerDown=\{wall\.warm\}/);
    const pump = hook.slice(hook.indexOf('const pump = useCallback'), hook.indexOf('useEffect(() => { pumpRef.current = pump; }'));
    expect(pump.indexOf('const pending = source(url, job.quality);')).toBeGreaterThan(-1);
    expect(pump.indexOf('const pending = source(url, job.quality);')).toBeLessThan(pump.indexOf('await frame.ready();'));
    expect(hook).toMatch(/sources\.clear\(\);/);
  });

  it('작품 사진은 쥐고 있지 않는 받기로(fetchImageOnce) — 넘겨 보는 동안 원본이 쌓이지 않게', () => {
    expect(hook).toMatch(/fetchImageOnce\(src\)/);
    expect(hook).not.toMatch(/\bfetchImage\(/);
    expect(src('lib/imageFetch.ts')).toMatch(/export function fetchImageOnce\(url: string\)/);
  });
});
