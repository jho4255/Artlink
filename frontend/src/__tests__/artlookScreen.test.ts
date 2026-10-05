/**
 * ArtLook 화면 개편(2026-10-04, CLAUDE.md 규칙 65) — 소스 가드.
 *
 * ArtLook 은 번들 밖 정적 페이지(`public/artlook/` index.html·ui.js·scene.js)라 타입도 import 도 없다. 되돌아오면
 * **에러 없이 조용히** 예전 문제로 돌아가는 것들(전부 받기 · 32번 다시 그리기 · 죽은 미디어 쿼리 · 1년 굳은 캐시 · 경고창)을
 * 소스와 파일로 고정한다. 눌러서 무슨 일이 나는지는 e2e `69-artlook-ux`, 기하·무게는 `scratchpad/artlook-ux/walk.js` 가 본다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const PUB = resolve(__dirname, '../../public/artlook');
const read = (p: string) => readFileSync(resolve(PUB, p), 'utf-8');
const html = read('index.html');
const ui = read('ui.js');
const scene = read('scene.js');
const src = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf-8');

describe('고른 것만 받는다 — 탭을 열 때 41.5MB·32번 다시 그리기였다', () => {
  it('장면 사진은 고를 때 받는다(목록만 먼저) — 전부 받기는 ?preload=all(하니스)일 때만', () => {
    const fn = scene.slice(scene.indexOf('function loadScenes'), scene.indexOf('function loadScenes') + 700);
    expect(fn).not.toMatch(/new Image\(\)/);                       // 목록을 받자마자 사진을 만들지 않는다
    expect(fn).toMatch(/if \(all\) list\.forEach\(\(s\) => ensureScene\(/);
    expect(scene).toMatch(/function ensureScene\(s, onEach\)/);
    expect(scene).toMatch(/ensureScene, sceneReady,/);               // 밖으로 내보낸다
  });

  it('액자 사진·결 텍스처·옛 벽은 고를 때 받는다', () => {
    expect(html).toMatch(/function ensurePhotoFrame\(k\)/);
    expect(html).toMatch(/function ensureMatTexture\(k\)/);
    expect(html).toMatch(/function ensureWall\(w\)/);
    // 예전 코드 — 목록이 오자마자 8장, 벽 17장을 전부 만들었다
    expect(html).not.toMatch(/Object\.keys\(j\)\.forEach\(k=>\{\s*const im=new Image\(\)/);
    expect(html).not.toMatch(/WALLS\.forEach\(w=>\{\s*w\.adj=\{dx:0,dy:0,s:1\};\s*w\.img=new Image\(\)/);
    expect(html).toMatch(/const PRELOAD_ALL=\/\[\?&\]preload=all/);
  });

  it('자산이 와도 바로 그리지 않는다 — 화면이 기다리던 중일 때만 한 프레임에 한 번', () => {
    expect(html).toMatch(/function assetArrived\(key\)\{ if\(typeof window\.onAssetArrived==='function'\)/);
    expect(html).not.toMatch(/raw\.onload=\(\)=>\{ m\.img=gradeImage\(raw,k\); render\(\); \}/);
    expect(html).not.toContain('buildFrameChips(); render();');
    expect(ui).toMatch(/function onAssetArrived\(key\)\{[\s\S]{0,200}if\(waitingAssets\) requestRender\(\);/);
    expect(ui).toMatch(/requestAnimationFrame\(go\)/);
    expect(ui).toMatch(/window\.__artlookRenders=composed/);    // 하니스·E2E 가 몇 번 그렸나 본다
  });

  it('칩은 미리 구운 작은 파일 — 모든 액자·배경에 파일이 있다(액자·장면을 더하면 build-artlook-thumbs.mjs)', () => {
    const ids = [...html.matchAll(/\{ id:'([a-z-]+)', name:'/g)].map((m) => m[1]);
    expect(ids.length).toBe(21);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(existsSync(resolve(PUB, 'frames/chips', `${id}.webp`)), `칩 ${id}`).toBe(true);
    const scenes = JSON.parse(read('scenes/scenes.json')).scenes as { id: string; src: string; thumb?: string }[];
    for (const s of scenes) {
      expect(s.thumb, `${s.id} 의 thumb`).toBeTruthy();
      expect(existsSync(resolve(PUB, s.thumb!)), `썸네일 ${s.thumb}`).toBe(true);
    }
    // WebGL2 가 없을 때의 옛 벽 목록도 같은 규칙(thumbs/ 아래 같은 이름)
    for (const m of html.matchAll(/src:'(walls\/[^']+\.jpg)'/g)) {
      const t = m[1].replace(/^walls\//, 'walls/thumbs/');
      expect(existsSync(resolve(PUB, t)), `썸네일 ${t}`).toBe(true);
    }
    // 화면은 칩에 원본 벽 사진을 쓰지 않는다
    expect(ui).toMatch(/im\.src='frames\/chips\/'\+f\.id\+'\.webp'/);
    expect(ui).toMatch(/s\.thumb \|\| thumbOf\(s\.src\)/);
  });

  it('작품 목록 칸은 넘겨받은 썸네일, 못 받으면 원본으로 한 번 더', () => {
    expect(ui).toMatch(/im\.src=w\.thumb && okUrl\(w\.thumb\) \? w\.thumb : resolveSrc\(w\.url\)/);
    expect(ui).toMatch(/im\.dataset\.fallback='1'; im\.src=resolveSrc\(w\.url\)/);
  });
});

describe('화면 틀 — 한 구조, 두 배치', () => {
  it('★ 좁은 칸 규칙이 먼저, 넓은 칸 미디어 쿼리가 뒤 — 예전엔 순서가 거꾸로라 좁은 화면 CSS 가 한 번도 안 먹었다', () => {
    // 주석은 뺀다 — 이 규칙을 설명하는 주석이 옛 쿼리를 그대로 적고 있다
    const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>')).replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).not.toMatch(/@media\s*\(max-width:\s*860px\)/);
    const wide = css.indexOf('@media (min-width:860px)');
    expect(wide).toBeGreaterThan(-1);
    for (const base of ['.panes{', '.pane{', '.row{', '.actions{', '.stage{']) {
      const at = css.indexOf(base);
      expect(at, base).toBeGreaterThan(-1);
      expect(at, `${base} 는 넓은 칸 쿼리보다 앞에`).toBeLessThan(wide);
    }
  });

  it('탭 여섯 — 작품 · 액자 · 매트 · 배경 · 조명 · 비율 (출력 비율 용도 설명은 두지 않는다)', () => {
    const tabs = [...html.matchAll(/role="tab" id="tab-([a-z]+)"[^>]*>([^<]+)</g)].map((m) => `${m[1]}:${m[2]}`);
    expect(tabs).toEqual(['works:작품', 'frames:액자', 'mat:매트', 'scenes:배경', 'light:조명', 'ratio:비율']);
    const ratio = html.slice(html.indexOf('id="pane-ratio"'), html.indexOf('</div>', html.indexOf('id="ratios"')));
    expect(ratio).not.toMatch(/인스타|피드|스토리/);
  });

  it('미리보기는 손가락으로 끌고 두 손가락으로 키운다 — 끌면 화면이 같이 밀리던 것', () => {
    expect(html).toMatch(/#preview\{[^}]*touch-action:none/);
    expect(ui).toMatch(/pinch=\{ d0:/);
    expect(html).toMatch(/id="zoomIn"/);
    expect(html).toMatch(/id="zoomOut"/);
    expect(html).toMatch(/id="zoomReset"/);
    expect(html).not.toContain('마우스휠');                     // 휴대폰에선 할 수 없는 안내였다
  });

  it('[완료]·경고창이 없다 — 탭 안에서 "이 탭을 닫고…" 창이 떴다', () => {
    for (const s of [html, ui]) {
      expect(s).not.toMatch(/\balert\(/);
      expect(s).not.toContain('artlook:done');
      expect(s).not.toContain('id="back"');
    }
  });

  it('낡은 안내가 없다 — 왼쪽에서 작품을 · 포트폴리오에 가로×세로 · 마이페이지 > 포트폴리오의 [ArtLook]', () => {
    for (const s of [html, ui]) {
      expect(s).not.toContain('왼쪽에서 작품을 선택하면');
      expect(s).not.toMatch(/포트폴리오에 가로×세로/);
      expect(s).not.toContain('마이페이지 &gt; 포트폴리오');
    }
  });

  it('워터마크 빨강은 사이트 빨강 하나(#c4302b, 규칙 47)', () => {
    expect(html).toContain("ctx.fillStyle='#c4302b';");
    expect(html).not.toMatch(/fillStyle='#dc3545'/);
  });
});

describe('저장 뒤', () => {
  it('휴대폰은 공유 창을 누른 그 순간에 — 비동기 toBlob 이 아니라 toDataURL', () => {
    const fn = ui.slice(ui.indexOf("dlBtn.addEventListener('click'"));
    const coarse = fn.slice(fn.indexOf('if(COARSE || IN_APP)'), fn.indexOf("if(IN_APP){ openSheet(url); return; }")).replace(/\/\/.*$/gm, '');
    expect(coarse).toMatch(/pv\.toDataURL\('image\/png'\)/);
    expect(coarse).toMatch(/navigator\.share\(\{ files:\[file\] \}\)/);
    expect(coarse).not.toMatch(/toBlob/);
  });

  it('저장하면 알린다 · 앱 안 브라우저는 길게 눌러 저장 · 저장 전 초안을 원래 배율로', () => {
    expect(ui).toMatch(/saved\('저장했어요 · '\+name\)/);
    expect(html).toMatch(/id="saveSheet"/);
    expect(ui).toMatch(/flushRender\(\);\s*const name=downloadFileName\(\);/);
  });

  it('파일 이름에 액자·배경 — 여러 장 저장하면 (1)(2) 로 겹쳤다', () => {
    expect(ui).toMatch(/\[w\.artist, w\.title, w\.exhibition, \(FRAMES\[state\.frameIdx\]\|\|\{\}\)\.name, bg\]/);
  });

  it('[ArtStory에 올리기] 는 탭 안에서만, 판매작(갤러리가 연 새 탭)에는 없다', () => {
    expect(ui).toMatch(/if\(EMBED && !IS_SOLD\) storyBtn\.hidden=false;/);
    expect(ui).toMatch(/type:'artlook:story', blob:b/);
  });
});

describe('바깥(마이페이지) · 캐시', () => {
  it('★ 마이페이지 ArtLook 탭은 화면 전체(focused + fill) · 높이는 상자 위치로 잰다', () => {
    const my = src('pages/MyPage.tsx');
    expect(my).toMatch(/currentTab === 'artlook'\) && user\.role === 'ARTIST'/);
    expect(my).toMatch(/const fill = currentTab === 'artlook'/);
    const sec = my.slice(my.indexOf('function ArtLookSection'), my.indexOf('// ========== Artist: 찜 목록'));
    expect(sec).toMatch(/useFillHeight\(boxRef/);
    expect(sec).not.toContain('새 탭에서 열기');
    // ⚠️ 보낸 쪽 확인 — 이 iframe 의 창, 같은 출처
    expect(sec).toMatch(/e\.source !== win \|\| e\.origin !== window\.location\.origin/);
    expect(sec).toMatch(/readArtLookMessage\(e\.data\)/);
    expect(sec).toMatch(/editHref\('works', \{ info: true, work: msg\.id \}\)/);
  });

  it('ArtStory 글쓰기 칸이 넘어온 사진을 한 번 받고 state 를 비운다', () => {
    const feed = src('pages/FeedPage.tsx');
    expect(feed).toMatch(/const incoming = readComposeImages\(location\.state\);/);
    expect(feed).toMatch(/navigate\(`\$\{location\.pathname\}\$\{location\.search\}`, \{ replace: true, state: null \}\)/);
    expect(feed).toMatch(/incoming\.filter\(\(u\) => !prev\.includes\(u\)\)/);   // StrictMode 두 번 실행에도 한 장
  });

  it('주소에 빌드 ID — 1년 굳은 옛 사본(scene.js 9/4 판)을 건너뛴다', () => {
    expect(html).toContain('<script src="scene.js?v=__ARTLOOK_BUILD__"></script>');
    expect(html).toContain('<script src="ui.js?v=__ARTLOOK_BUILD__"></script>');
    expect(html).toContain("fetch('frames/photo/frames.json?v='+BUILD)");
    expect(ui).toContain("ArtLookScene.loadScenes('scenes/scenes.json?v='+BUILD");
    const vite = readFileSync(resolve(__dirname, '../../vite.config.ts'), 'utf-8');
    expect(vite).toMatch(/name: 'artlook-build-id'/);
    expect(vite).toMatch(/split\('__ARTLOOK_BUILD__'\)\.join\(BUILD_ID\)/);
  });

  it('ArtLook 은 서비스워커가 미리 받지도(5.5MB) 가로채지도 않는다', () => {
    const vite = readFileSync(resolve(__dirname, '../../vite.config.ts'), 'utf-8');
    expect(vite).toMatch(/globIgnores: \[[^\]]*'artlook\/\*\*'/);
    expect(src('sw.js')).toMatch(/denylist: \[[^\]]*\/\^\\\/artlook\\\/\//);
  });
});
