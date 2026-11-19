/**
 * ArtLook 편집 화면 개편(2026-11-17, PLAN WP4~8 · CLAUDE.md 규칙 85) — 휴대폰 편집 전용 화면 · 추천 조합 · 작품 크기 칩 · 액자 모양 × 재질.
 *
 * ArtLook 은 번들 밖 정적 페이지라 순수한 부분(호수 계산·크기 얹기)은 소스에서 떼어 실제로 돌리고, 나머지는 소스로 지킨다.
 * 눌러서 무슨 일이 나는지는 e2e `84-artlook-editor`, 기하(칩 칸 176px 에 드는가)는 `scratchpad/artlook-review/panegeo.cjs` 가 본다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isArtLookEditor } from '../lib/siteMode';
import { readArtLookMessage, stageArtLookWorks, ARTLOOK_STORAGE_KEY, ARTLOOK_SIZES_KEY } from '../lib/artlook';
import { useAuthStore } from '../stores/authStore';
import { ARTLOOK_BARE_MEDIA } from '../hooks/useArtLookBare';

const PUB = resolve(__dirname, '../../public/artlook');
const read = (p: string) => readFileSync(resolve(PUB, p), 'utf-8');
const html = read('index.html');
const ui = read('ui.js');
const src = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf-8');

/** 소스에서 함수 하나를 떼어 낸다(중괄호 짝으로) */
function fnSource(s: string, name: string): string {
  const i = s.indexOf(`function ${name}(`);
  expect(i, name).toBeGreaterThanOrEqual(0);
  let depth = 0, j = s.indexOf('{', i);
  for (; j < s.length; j++) {
    if (s[j] === '{') depth++;
    else if (s[j] === '}' && --depth === 0) break;
  }
  return s.slice(i, j + 1);
}

describe('휴대폰 편집 전용 화면 — 상단바·하단 탭바 없이(1024px 미만 · 작가 · [ArtLook] 탭)', () => {
  it('판정 — /mypage?tab=artlook 만', () => {
    expect(isArtLookEditor('/mypage', '?tab=artlook')).toBe(true);
    expect(isArtLookEditor('/mypage/', '?tab=artlook&x=1')).toBe(true);
    expect(isArtLookEditor('/mypage', '?tab=portfolio')).toBe(false);
    expect(isArtLookEditor('/mypage', '')).toBe(false);
    expect(isArtLookEditor('/artlook', '?tab=artlook')).toBe(false);
  });

  it('★ 바깥(React)과 ArtLook 이 같은 미디어 쿼리로 가른다 — 하나만 바꾸면 머리가 둘이 되거나 없어진다', () => {
    expect(ARTLOOK_BARE_MEDIA).toBe('(min-width: 1024px)');
    expect(ui).toContain(`window.parent.matchMedia('${ARTLOOK_BARE_MEDIA}')`);
    expect(html).toContain(`window.parent.matchMedia('${ARTLOOK_BARE_MEDIA}')`);   // 첫 그림 전에 .bare 를 단다(머리가 번쩍이지 않게)
  });

  it('Layout 은 편집 화면에서 상단바·사이드바·푸터·하단 탭바를 그리지 않는다(아래 여백도)', () => {
    const lay = src('components/layout/Layout.tsx');
    // 2026-11-19 — ArtTalk 휴대폰 대화 전용 화면(useChatBare)도 같은 식으로 틀을 뺀다
    expect(lay).toMatch(/const bare = useArtLookBare\(\);[\s\S]*const chrome = !site && !bare && !chatBare;/);
    for (const part of ['{chrome && <Navbar />}', '{chrome && <MyPageSideMenu />}', '{chrome && <BottomTabBar />}']) expect(lay, part).toContain(part);
    // 푸터는 틀이 있을 때만(그리고 ArtTalk 은 화면 높이를 다 써서 빼고)
    expect(lay).toMatch(/const footer = chrome && pathname !== '\/messages';/);
    expect(lay).toContain('{footer && <footer');
    expect(lay).toMatch(/\$\{chrome \? 'pb-\[calc\(3\.5rem\+1px\+env\(safe-area-inset-bottom\)\)\] lg:pb-0' : ''\}/);
  });

  it('마이페이지 — 여백 없이 · 제목 줄은 화면 낭독기용으로만 · iframe 은 화면 바닥까지', () => {
    const my = src('pages/MyPage.tsx');
    expect(my).toMatch(/bare \? 'px-0' : fill \?/);
    const sec = my.slice(my.indexOf('function ArtLookSection'), my.indexOf('// ========== Artist: 찜 목록'));
    expect(sec).toMatch(/bare \? 'sr-only'/);
    expect(sec).toMatch(/useFillHeight\(boxRef, \{ min: 340, gap: bare \? 0 : 24 \}\)/);
    // [닫기 ×] — 앱 안에 돌아갈 기록이 있으면 뒤로, 없으면 마이페이지 첫 탭.
    // ⚠️ location.key 로 가르면 안 된다 — 탭을 바꿔 끼우면(replace) 첫 기록이어도 key 가 'default' 가 아니라 앱 밖으로 나갔다(2026-11-18 에뮬레이터).
    expect(sec).not.toMatch(/=\s*location\.key !==/);
    expect(sec).toMatch(/if \(\(window\.history\.state\?\.idx \?\? 0\) > 0\) navigate\(-1\); else navigate\('\/mypage', \{ replace: true \}\);/);
  });

  it('[닫기 ×] 메시지 — artlook:goto {to:close} 만 받는다', () => {
    expect(readArtLookMessage({ type: 'artlook:goto', to: 'close' })).toEqual({ type: 'goto', to: 'close' });
    expect(readArtLookMessage({ type: 'artlook:goto', to: 'closeAll' })).toBeNull();
    expect(ui).toMatch(/if\(EMBED\)\{ goto\(\{ to:'close' \}\); return; \}/);
  });

  it('로그아웃하면 작품 목록과 고른 크기를 함께 지운다 — 같은 컴퓨터의 다음 사람', () => {
    localStorage.setItem(ARTLOOK_STORAGE_KEY, '[]');
    localStorage.setItem(ARTLOOK_SIZES_KEY, '{"a":{"text":"53 × 45.5 cm","kind":"10호"}}');
    useAuthStore.getState().logout();
    expect(localStorage.getItem(ARTLOOK_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(ARTLOOK_SIZES_KEY)).toBeNull();
    expect(ui).toContain(`const SIZE_KEY='${ARTLOOK_SIZES_KEY}';`);   // 화면(ui.js)과 같은 키
  });

  it('★ 작품을 불러오는 동안의 빈 목록은 고른 크기를 지우지 않는다 — [ArtLook] 탭을 열 때마다 호수가 사라졌다(e2e 84 D)', () => {
    localStorage.setItem(ARTLOOK_SIZES_KEY, '{"a":{"text":"53 × 45.5 cm","kind":"10호"}}');
    expect(stageArtLookWorks([])).toBe(0);
    expect(localStorage.getItem(ARTLOOK_SIZES_KEY)).not.toBeNull();
    localStorage.removeItem(ARTLOOK_SIZES_KEY);
  });

  it('★ 모양을 바꾸면 재질 줄을 그 자리에서 다시 그린다 — 박스를 눌러도 몰딩 재질이 남았다(e2e 75 B)', () => {
    const f = fnSource(ui, 'selectShape');
    expect(f).toMatch(/const changed=curShape!==sh\.id;\n\s*curShape=sh\.id;\n\s*if\(changed\) buildFrames\(\);/);
  });

  it('저장 단추 묶음은 하나 — 좁은 편집 화면이면 저장 창 안으로 옮긴다(#dl·#toStory 를 두 벌 두지 않는다)', () => {
    expect((html.match(/id="dl"/g) || []).length).toBe(1);
    expect((html.match(/id="toStory"/g) || []).length).toBe(1);
    expect(fnSource(ui, 'placeActions')).toMatch(/saveSlot\.appendChild\(actionsEl\)/);
    expect(html).toMatch(/<div class="sheet bottom" id="saveBox" role="dialog" aria-modal="true"/);
  });

  it('확대 단추 — 손가락 화면은 [−][+] 없이 조절한 뒤에만 [처음 자리로] · 마우스 화면은 여백이 있으면 그림 바깥', () => {
    const f = fnSource(ui, 'placeZoom');
    expect(f).toMatch(/if\(COARSE\)\{/);
    expect(f).toMatch(/zoomEl\.hidden=!moved;/);
    expect(f).toMatch(/\(stage\.clientWidth-pv\.offsetWidth\)\/2>=56/);
    expect(html).toMatch(/\.zoom\.coarse #zoomIn,\.zoom\.coarse #zoomOut\{display:none\}/);
  });
});

describe('추천 조합 — 액자·매트·배경·조명을 한 번에', () => {
  const frameIds = [...html.matchAll(/\{ id:'([a-z-]+)', name:'/g)].map((m) => m[1]);
  const hidden = html.split('\n').filter((l) => /^\s*\{ id:'/.test(l) && /hidden:true/.test(l)).map((l) => l.match(/id:'([a-z-]+)'/)![1]);
  const sceneIds = (JSON.parse(read('scenes/scenes.json')).scenes as { id: string }[]).map((s) => s.id);
  const table = ui.slice(ui.indexOf('const PRESETS=['), ui.indexOf('];', ui.indexOf('const PRESETS=[')) + 2);
  const PRESETS = new Function(`${table}; return PRESETS;`)() as { id: string; frame: string; scene: string; mat: number; matColor: string | null; light: number }[];

  it('여덟 조합이 보이는 액자 · 있는 배경만 가리킨다', () => {
    expect(PRESETS).toHaveLength(8);
    for (const p of PRESETS) {
      expect(frameIds, `${p.id} 액자`).toContain(p.frame);
      expect(hidden, `${p.id} 액자는 숨긴 것이 아니어야`).not.toContain(p.frame);
      expect(sceneIds, `${p.id} 배경`).toContain(p.scene);
      expect([0, 0.05, 0.1], `${p.id} 매트`).toContain(p.mat);
      expect(p.light).toBeGreaterThanOrEqual(0); expect(p.light).toBeLessThanOrEqual(1);
    }
  });

  it('★ 누르면 그리기 한 번 — 바꾼 뒤 requestRender 하나(장면·액자를 따로 고를 때처럼 두 번 그리지 않는다)', () => {
    const f = fnSource(ui, 'applyPreset');
    expect((f.match(/requestRender\(\)/g) || []).length).toBe(1);
    expect(f).not.toMatch(/selectFrame\(|selectScene\(/);    // 고르는 함수는 각자 그린다 — 쓰지 않는다
    expect(f).toMatch(/savePrefs\(\{ frame:p\.frame, scene:p\.scene, mat:p\.mat, matColor:state\.matteColor, light:p\.light \}\);/);
  });

  it('칩 그림은 미리 구운 파일 — 내 작품으로 여덟 조합을 그 자리에서 그리지 않는다(배경 여덟 장을 다 받게 된다)', () => {
    const f = fnSource(ui, 'buildPresets');
    expect(f).toMatch(/im\.src='presets\/'\+p\.id\+'\.webp';/);
    expect(f).not.toMatch(/compose\(|ensureScene|ensurePhotoFrame/);
  });

  it('장면을 못 쓰면(WebGL2 없음 · 목록 없음) 추천 탭을 감춘다', () => {
    expect(fnSource(ui, 'useWalls')).toMatch(/hideReco\(\);/);
  });
});

describe('작품 크기 칩 — 크기를 적지 않은 작품을 호수로 그 자리에서', () => {
  const HOSU = new Function(`${ui.slice(ui.indexOf('const HOSU='), ui.indexOf(';', ui.indexOf('const HOSU=')) + 1)} return HOSU;`)() as [string, number][];
  const fmtCm = (v: number) => (Math.round(v * 10) / 10).toString();
  const hosuText = (img: { width: number; height: number }) => new Function('state', 'fmtCm', `${fnSource(ui, 'hosuText')}; return hosuText;`)({ img }, fmtCm) as (L: number) => string;

  it('호수는 긴 변(국내 F형) — 10 · 20 · 30 · 50 · 100호', () => {
    expect(HOSU).toEqual([['10호', 53.0], ['20호', 72.7], ['30호', 90.9], ['50호', 116.8], ['100호', 162.2]]);
  });

  it('짧은 변은 사진 비율 · 문자열은 세로 × 가로(규칙 54)', () => {
    expect(hosuText({ width: 800, height: 1000 })(53)).toBe('53 × 42.4 cm');      // 세로 작품
    expect(hosuText({ width: 1000, height: 800 })(53)).toBe('42.4 × 53 cm');      // 가로 작품
    expect(hosuText({ width: 900, height: 900 })(90.9)).toBe('90.9 × 90.9 cm');   // 정사각
  });

  it('진짜 크기가 있으면 그게 이긴다 · 고른 크기는 사본에만(넘겨받은 목록을 고치지 않는다)', () => {
    const body = `${ui.slice(ui.indexOf('const realSize='), ui.indexOf('\n', ui.indexOf('const realSize=')))}\n${fnSource(ui, 'workOf')}; return workOf;`;
    const parse = (t?: string) => (t && /\d/.test(t) ? [1, 1] : null);
    const run = (works: Record<string, unknown>[], saved: Record<string, unknown>) => {
      const ArtLookScene = { parseSizeCm: parse };
      return new Function('WORKS', 'savedSizes', 'window', 'ArtLookScene', body)(works, saved, { ArtLookScene }, ArtLookScene) as (i: number) => Record<string, unknown>;
    };
    const works = [{ url: 'a', title: 'A' }, { url: 'b', title: 'B', sizeText: '53 × 45.5 cm' }, { url: 'c', demo: true }];
    const saved = { a: { text: '53 × 42.4 cm', kind: '10호' }, b: { text: '1 × 1 cm', kind: 'custom' }, c: { text: '1 × 1 cm', kind: 'custom' } };
    const workOf = run(works, saved);
    expect(workOf(0)).toEqual({ url: 'a', title: 'A', sizeText: '53 × 42.4 cm', sizeChosen: '10호' });
    expect(works[0]).toEqual({ url: 'a', title: 'A' });                // 원본은 그대로
    expect(workOf(1)).toBe(works[1]);                                  // 진짜 크기 — 고른 값을 무시
    expect(workOf(2)).toBe(works[2]);                                  // 데모 작품엔 얹지 않는다
  });

  it('직접 입력은 1~1000cm · 쉼표 소수도 받는다 · 다시 누르면 고른 크기를 뺀다', () => {
    expect(ui).toMatch(/const ok=\(v\)=>Number\.isFinite\(v\) && v>=1 && v<=1000;/);
    expect(ui).toMatch(/parseFloat\(String\(el\.value\)\.replace\(',', '\.'\)\)/);
    expect(ui).toMatch(/if\(\(savedSizes\[cur\.url\]\|\|\{\}\)\.kind===label\)\{ setWorkSize\(null, null\); return; \}/);
    // 크기가 바뀌면 손으로 키운 배율을 처음대로 — 새 크기에 그대로 먹으면 엉뚱하게 커진다
    expect(fnSource(ui, 'setWorkSize')).toMatch(/resetAllAdj\(\);/);
  });

  it('★ [여러 점] 칩 이름은 상자 안 — 아래에 달면 작품 줄이 19px 높아져 휴대폰 칩 칸을 넘쳤다', () => {
    const f = fnSource(ui, 'modeChip');
    expect(f).toMatch(/<span class="mlabel">여러 점<\/span><\/span>/);
    expect(f).not.toMatch(/class="name"/);
    expect(f).toMatch(/b\.setAttribute\('aria-label', '여러 점'\);/);   // 글자가 aria-hidden 상자 안이라 이름을 따로
  });
});

describe('색 옮긴 사진 액자(WP9) — 가진 사진에서 결·명암은 그대로, 색만', () => {
  const tintTable = html.slice(html.indexOf('const PHOTO_TINTS={'), html.indexOf('};', html.indexOf('const PHOTO_TINTS={')) + 2);
  const PHOTO_TINTS = new Function(`${tintTable}; return PHOTO_TINTS;`)() as Record<string, { base: string; tint: string; kAB?: number; kL?: number }>;
  const tintedFrames = [...html.matchAll(/\{ id:'([a-z]+)', name:'[^']*',\s*kind:'photo', photo:'([a-z-]+@[a-z]+)'/g)].map((m) => ({ id: m[1], photo: m[2] }));
  const framesJson = JSON.parse(read('frames/photo/frames.json')) as Record<string, unknown>;

  it('★ 품질 관문을 통과한 4종만 — 네이비 · 포레스트 · 와인 · 티크(후보 14종 중, scratchpad/artlook-review/wp9gate.py)', () => {
    expect(tintedFrames.map((f) => f.id)).toEqual(['navy', 'forest', 'wine', 'teak']);
    expect(Object.keys(PHOTO_TINTS).sort()).toEqual(tintedFrames.map((f) => f.photo).sort());
    for (const [k, t] of Object.entries(PHOTO_TINTS)) {
      expect(k.split('@')[0], k).toBe(t.base);
      expect(framesJson[t.base], `${k} 의 원본 사진`).toBeTruthy();
      expect(t.tint).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('파일을 늘리지 않는다 — frames.json 이 오면 같은 사진·같은 치수로 열쇠만 적고, 고를 때 한 번 옮겨 보관한다', () => {
    expect(html).toMatch(/PHOTO_META = j \|\| \{\};\n\s*registerPhotoTints\(\);\n\s*PHOTO_META_READY = true;/);
    // 옮긴 **뒤에** 보정·측정 — 우리가 실제로 그리는 픽셀이 그것이다
    expect(html).toMatch(/PHOTO_FRAMES\[k\]=gradeImage\(PHOTO_META\[k\]\.tint \? tintImage\(im, PHOTO_META\[k\]\) : im, k\);/);
    for (const f of tintedFrames) expect(html, `${f.photo} 에 FRAME_GRADE 를 걸지 않는다(목표 색이 곧 최종 평균색)`).not.toContain(`'${f.photo}':[`);
  });

  it('화면 — 몰딩의 재질로 고른다 · 다른 모양으로 옮기면 블랙/가까운 나무로', () => {
    const shapes = ui.slice(ui.indexOf('const FRAME_SHAPES=['), ui.indexOf('/** 그 재질이 없는 모양으로'));
    for (const id of ['teak', 'navy', 'forest', 'wine']) expect(shapes, id).toContain(`['${id}',`);
    expect(ui).toMatch(/teak:\['walnut','oak'\], navy:\['black'\], forest:\['black'\], wine:\['black'\]/);
  });

  it('sRGB 역변환 표는 어두운 쪽에서도 반올림 오차 안 — 검정 도장(네이비·포레스트·와인)이 그 영역에 산다', () => {
    const tbl = html.slice(html.indexOf('const _L2S_N=8192'), html.indexOf('function _okLab('));
    const lin2s = new Function(`${tbl}; return _lin2s;`)() as (c: number) => number;
    const exact = (c: number) => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
    let worst = 0;
    for (let i = 0; i <= 20000; i++) { const c = (i / 20000) ** 2; worst = Math.max(worst, Math.abs(lin2s(c) - exact(c))); }
    expect(worst).toBeLessThanOrEqual(0.75);   // 정수 반올림(0.5) + 표 간격
  });

  it('OKLab — 흰색은 L 1 · a b 0, 검정은 0', () => {
    const okLab = new Function(`${fnSource(html, '_okLab')}; return _okLab;`)() as (r: number, g: number, b: number) => number[];
    const w = okLab(1, 1, 1), k = okLab(0, 0, 0);
    expect(w[0]).toBeCloseTo(1, 3); expect(Math.abs(w[1])).toBeLessThan(1e-3); expect(Math.abs(w[2])).toBeLessThan(1e-3);
    expect(k[0]).toBeCloseTo(0, 6);
  });
});

describe('공간 배경은 카메라를 당기지 않는다 — 방이 보여야 한다(2026-11-18 사용자 지적)', () => {
  const scenes = JSON.parse(read('scenes/scenes.json')).scenes as { id: string; group?: string; maxZoom?: number }[];
  const scene = read('scene.js');
  it('실내 장면은 전부 maxZoom 1 · 벽 장면엔 없다', () => {
    const space = scenes.filter((s) => s.group === 'space');
    expect(space.length).toBeGreaterThan(0);
    for (const s of space) expect(s.maxZoom, s.id).toBe(1);
    for (const s of scenes.filter((x) => x.group !== 'space')) expect(s.maxZoom, s.id).toBeUndefined();
  });
  it('자동 프레이밍의 당김이 그 값을 넘지 않는다(사용자가 키우는 [+]는 따로)', () => {
    expect(scene).toMatch(/if \(scene\.maxZoom > 0\) zoom = Math\.min\(zoom, Math\.max\(1, scene\.maxZoom\)\);/);
  });
});
