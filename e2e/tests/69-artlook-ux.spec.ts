import { test, expect, request as pwRequest, type APIRequestContext, type Browser, type BrowserContextOptions, type Frame, type Page } from '@playwright/test';
import { solidPng } from '../lib/helpers';

/**
 * ArtLook(액자 걸기) 화면 개편 — 2026-10-04, CLAUDE.md 규칙 65. **눌러서 무슨 일이 나는가**를 본다.
 *
 * 고치기 전(2026-10-04 실측): 휴대폰 첫 화면에 미리보기 0px · 설정 1,611px 를 141px 틈으로 · 탭을 열면 41.5MB 를 받고
 * 32번 다시 그림 · 저장해도 표시 없음 · [완료]는 탭 안에서 경고창 · 끌면 화면이 같이 밀림.
 *
 *  A. 첫 화면에 미리보기가 통째로 보이고 [이미지 저장]이 하단 탭바 위에서 눌린다(휴대폰·PC)
 *  B. 열 때 한두 번만 그리고, 고른 배경·액자 하나만 받고, 작품 목록은 원본을 받지 않는다
 *  C. 휴대폰 — 끌면 작품이 움직이고 바깥은 안 밀린다 · 두 손가락으로 커진다 · [−][+][원위치]
 *  D. 저장 → 파일 + "저장했어요"(경고창 없음) → [ArtStory에 올리기] → 사진이 실린 글쓰기 칸
 *  E. 크기를 안 적은 작품 → [크기 입력하기] → 편집 화면에서 **그 작품**의 정보 창
 *  F. 작품 0점 → 데모 작품 + [작품 올리기] → 편집 화면
 *  G. 고른 액자·배경은 다음에 다시 열어도 그대로
 *  H. 갤러리의 판매작 홍보(새 탭) — [ArtStory에 올리기]는 없고 [닫기]가 있다
 *
 * ⚠️ 기하(여러 화면·사파리 엔진)는 `scratchpad/artlook-ux/walk.js` 가 본다. 여기는 크롬 한 엔진·두 화면이다.
 */
// ArtLook 엔진의 전역 — 정적 페이지의 최상위 let/const 라 window 속성이 아니다. 페이지 안에서 맨 이름으로 읽는다
declare const SCENES: { adj: { dx: number; dy: number; s: number } }[];
declare const state: { sceneIdx: number; draft?: boolean };
declare const lastArt: { x: number; y: number; fw: number; fh: number } | null;

const API = 'http://localhost:4000/api';
const FE = 'http://localhost:5173';
const STAMP = Date.now();
const DESKTOP = { width: 1280, height: 800 };

interface Seeded { id: number; token: string; user: Record<string, unknown> }
const auth = (a: Seeded) => ({ Authorization: `Bearer ${a.token}` });

async function signupArtist(api: APIRequestContext, slug: string): Promise<Seeded> {
  const r = await api.post(`${API}/auth/signup`, {
    data: { name: `액자${slug}${String(STAMP).slice(-5)}`, email: `artlook-${slug}-${STAMP}@e2e.test`, password: 'ArtLook1!', role: 'ARTIST', agreeTerms: true, agreePrivacy: true },
  });
  if (!r.ok()) throw new Error(`작가 준비 실패 ${r.status()}: ${await r.text()}`);
  const { token, user } = await r.json();
  return { id: user.id, token, user };
}
/** 진짜로 올린다 — 썸네일(t240·t800)이 생겨야 B(원본을 받지 않는다)를 잴 수 있다 */
async function addWork(api: APIRequestContext, a: Seeded, i: number, meta: Record<string, string>) {
  await api.get(`${API}/portfolio`, { headers: auth(a) });
  const up = await api.post(`${API}/upload/image`, {
    headers: auth(a),
    multipart: { image: { name: `w${i}.png`, mimeType: 'image/png', buffer: solidPng(600 + i * 10, 480, [60 + i * 30, 90, 150 - i * 10]) } },
  });
  if (!up.ok()) throw new Error(`사진 올리기 실패 ${up.status()}`);
  const r = await api.post(`${API}/portfolio/images`, { headers: auth(a), data: { url: (await up.json()).url, ...meta } });
  if (!r.ok()) throw new Error(`작품 추가 실패 ${r.status()}`);
  return (await r.json()).id as number;
}

let full: Seeded, empty: Seeded, titledNoSize = 0;
test.beforeAll(async () => {
  const api = await pwRequest.newContext();
  full = await signupArtist(api, 'full');
  await addWork(api, full, 0, { title: '새벽 들판', medium: 'Oil on canvas', year: '2025', sizeText: '72.7×60.6 cm' });
  await addWork(api, full, 1, { title: '겨울 창', medium: 'Acrylic', year: '2024', sizeText: '45.5×53 cm' });
  // 제목은 있고 크기만 없다 — '정보 없는 작품'이 아니므로, [크기 입력하기] 가 work 를 안 넘기면 엉뚱한 창이 열린다
  titledNoSize = await addWork(api, full, 2, { title: '여름 그늘', medium: '먹', year: '2023' });
  await addWork(api, full, 3, {});
  empty = await signupArtist(api, 'empty');
  await api.dispose();
});

async function openFor(browser: Browser, a: Seeded, opts: { desktop?: boolean } = {}) {
  const extra: BrowserContextOptions = opts.desktop ? { hasTouch: false, isMobile: false, viewport: DESKTOP } : {};
  const ctx = await browser.newContext({
    ...extra,
    acceptDownloads: true,
    storageState: { cookies: [], origins: [{ origin: FE, localStorage: [{ name: 'artlink-auth', value: JSON.stringify({ state: { token: a.token, user: a.user, isAuthenticated: true }, version: 0 }) }] }] },
  });
  const page = await ctx.newPage();
  const dialogs: string[] = [];
  page.on('dialog', async (d) => { dialogs.push(d.message()); await d.dismiss().catch(() => {}); });
  const requests: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
  return { ctx, page, dialogs, requests };
}
/** ArtLook 탭을 열고 첫 그림이 나올 때까지 */
async function openArtLook(page: Page): Promise<Frame> {
  await page.goto('/mypage?tab=artlook');
  await expect(page.getByRole('heading', { name: 'ArtLook' })).toBeVisible({ timeout: 20000 });
  const handle = await page.waitForSelector('iframe[title="ArtLook"]', { state: 'attached', timeout: 30000 });
  const frame = (await handle.contentFrame())!;
  await frame.waitForFunction(() => ((window as any).__artlookRenders || 0) >= 1 && document.getElementById('busy')!.hidden, null, { timeout: 60000 });
  return frame;
}
const tab = (frame: Frame, id: string) => frame.locator(`#tab-${id}`).click();
/** 바깥 화면 좌표로 본 iframe 안 요소의 사각형 */
async function outerRect(page: Page, frame: Frame, sel: string) {
  const f = await page.locator('iframe[title="ArtLook"]').boundingBox();
  const r = await frame.locator(sel).evaluate((el) => { const b = el.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; });
  return { x: f!.x + r.x, y: f!.y + r.y, w: r.w, h: r.h };
}
/** 하단 탭바 위쪽 끝(PC 는 화면 바닥) */
const floorY = (page: Page) => page.evaluate(() => {
  const bar = document.querySelector('nav[aria-label="하단 내비게이션"]') as HTMLElement | null;
  return bar && getComputedStyle(bar).display !== 'none' ? bar.getBoundingClientRect().top : window.innerHeight;
});

for (const desktop of [false, true]) {
  test(`A. ★ 첫 화면에 미리보기가 통째로, [이미지 저장]이 탭바 위에서 눌린다 (${desktop ? 'PC' : '휴대폰'})`, async ({ browser }) => {
    const { ctx, page } = await openFor(browser, full, { desktop });
    const frame = await openArtLook(page);
    const floor = await floorY(page);
    // 프로필 카드·마이페이지 탭 줄이 없다(포트폴리오·편집 화면과 같은 focused)
    await expect(page.locator('main')).not.toContainText(String(full.user.email));
    const ifr = (await page.locator('iframe[title="ArtLook"]').boundingBox())!;
    expect(ifr.y + ifr.height, 'iframe 이 하단 탭바 밑으로 들어갔다').toBeLessThanOrEqual(floor + 1);
    expect(floor - (ifr.y + ifr.height), 'iframe 아래가 비어 있다 — 화면을 다 쓰지 않는다').toBeLessThan(30);
    const cv = await outerRect(page, frame, '#preview');
    expect(cv.y, '미리보기가 위로 잘렸다').toBeGreaterThanOrEqual(0);
    expect(cv.y + cv.h, '미리보기가 첫 화면 밖으로 내려갔다').toBeLessThanOrEqual(floor);
    expect(Math.min(cv.w, cv.h), '미리보기가 너무 작다').toBeGreaterThan(desktop ? 400 : 250);
    const dl = await outerRect(page, frame, '#dl');
    expect(dl.y + dl.h, '[이미지 저장]이 첫 화면 밖').toBeLessThanOrEqual(floor);
    // 그 자리를 누르면 정말 저장 단추가 잡힌다(바깥에선 iframe, 안에선 단추)
    const hit = await frame.evaluate(() => { const b = document.getElementById('dl')!.getBoundingClientRect(); const t = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return t?.id; });
    expect(hit).toBe('dl');
    const outerHit = await page.evaluate(([x, y]) => (document.elementFromPoint(x, y) as HTMLElement | null)?.tagName, [dl.x + dl.w / 2, dl.y + dl.h / 2]);
    expect(outerHit).toBe('IFRAME');
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), '가로로 밀린다').toBeLessThanOrEqual(0);
    await ctx.close();
  });
}

test('B. ★ 열 때 한두 번만 그리고, 고른 배경·액자만 받고, 작품 목록은 원본을 받지 않는다', async ({ browser }) => {
  const { ctx, page, requests } = await openFor(browser, full);
  const frame = await openArtLook(page);
  await page.waitForTimeout(2000);   // 늦게 오는 자산이 다시 그리게 하는지까지
  const renders = await frame.evaluate(() => (window as any).__artlookRenders);
  expect(renders, `열 때 ${renders}번 그렸다(예전 32번)`).toBeLessThanOrEqual(2);
  const art = requests.filter((u) => u.includes('/artlook/'));
  const walls = art.filter((u) => /\/artlook\/walls\/(?!thumbs\/)/.test(u));
  const photos = art.filter((u) => /\/artlook\/frames\/photo\/[^/]+\.png/.test(u));
  expect(walls.length, `벽 사진 원본 ${walls.length}장(고른 배경 하나만): ${walls.join(' ')}`).toBeLessThanOrEqual(1);
  expect(photos.length, `액자 사진 ${photos.length}장(고른 액자 하나만)`).toBeLessThanOrEqual(1);
  // 작품 목록 칸은 썸네일 — 원본(/uploads/<파일>)은 미리보기에 쓰는 고른 작품 하나뿐
  const originals = requests.filter((u) => /\/uploads\/(?!t240\/|t800\/)[^/?]+\.(jpe?g|png|webp)/i.test(u));
  expect(originals.length, `작품 원본 ${originals.length}장: ${originals.join(' ')}`).toBeLessThanOrEqual(1);
  expect(requests.filter((u) => u.includes('/uploads/t800/')).length, '목록 썸네일을 안 썼다').toBeGreaterThan(0);
  await ctx.close();
});

test('C. ★ 휴대폰 — 끌면 작품이 움직이고 바깥은 안 밀린다 · 두 손가락으로 커진다 · [−][+][원위치]', async ({ browser }) => {
  const { ctx, page } = await openFor(browser, full);
  const frame = await openArtLook(page);
  const cdp = await ctx.newCDPSession(page);
  const adj = () => frame.evaluate(() => { const s = SCENES[state.sceneIdx]; return s ? { ...s.adj } : null; });
  // 작품(액자) 한가운데 — lastArt 는 캔버스 좌표라 화면 비율로 환산
  const art = await frame.evaluate(() => {
    const c = document.getElementById('preview') as HTMLCanvasElement; const r = c.getBoundingClientRect(); const k = r.width / c.width;
    return { x: r.left + (lastArt!.x + lastArt!.fw / 2) * k, y: r.top + (lastArt!.y + lastArt!.fh / 2) * k };
  });
  const f = (await page.locator('iframe[title="ArtLook"]').boundingBox())!;
  const x0 = f.x + art.x, y0 = f.y + art.y;
  const sy0 = await page.evaluate(() => window.scrollY);
  const a0 = await adj();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
  for (let i = 1; i <= 8; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + i * 3, y: y0 - i * 5 }] }); await page.waitForTimeout(20); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(800);
  const a1 = await adj();
  expect(a1!.dy, '끌었는데 작품이 안 움직였다').toBeLessThan(a0!.dy - 0.02);
  expect(await page.evaluate(() => window.scrollY), '끄는 동안 바깥 페이지가 밀렸다').toBe(sy0);
  expect(await frame.evaluate(() => document.getElementById('stage')!.scrollTop + (document.scrollingElement?.scrollTop ?? 0)), 'ArtLook 안이 스크롤됐다').toBe(0);

  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0 - 20, y: y0, id: 1 }, { x: x0 + 20, y: y0, id: 2 }] });
  for (let i = 1; i <= 6; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 - 20 - i * 3, y: y0, id: 1 }, { x: x0 + 20 + i * 3, y: y0, id: 2 }] }); await page.waitForTimeout(20); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(800);
  const a2 = await adj();
  expect(a2!.s, '두 손가락으로 벌렸는데 안 커졌다').toBeGreaterThan(a1!.s * 1.2);
  expect(await frame.evaluate(() => !!state.draft), '손을 뗐는데 초안(낮은 배율) 그림으로 남았다').toBe(false);

  await frame.getByRole('button', { name: '작게' }).click();
  expect((await adj())!.s).toBeLessThan(a2!.s);
  await frame.getByRole('button', { name: '처음 자리·크기로' }).click();
  expect(await adj()).toEqual({ dx: 0, dy: 0, s: 1 });
  await ctx.close();
});

test('D. ★ 저장하면 파일과 "저장했어요"(경고창 없음) → [ArtStory에 올리기] → 사진이 실린 글쓰기 칸', async ({ browser }) => {
  const { ctx, page, dialogs } = await openFor(browser, full);
  const frame = await openArtLook(page);
  await expect(frame.locator('#toStory')).toBeHidden();               // 저장하기 전엔 없다
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), frame.locator('#dl').click()]);
  expect(dl.suggestedFilename()).toMatch(/새벽 들판_.+_.+\.png$/);     // 작가_작품명_액자_배경 — 여러 장이 (1)(2) 로 겹치지 않게
  await expect(frame.locator('#toast')).toContainText('저장했어요');
  expect(dialogs, '경고창이 떴다').toHaveLength(0);
  await expect(frame.locator('#toStory')).toBeVisible();
  await frame.locator('#toStory').click();
  await page.waitForURL(/\/feed/, { timeout: 30000 });
  const composer = page.locator('textarea').first();
  await expect(composer).toBeVisible({ timeout: 15000 });
  const box = page.locator('div').filter({ has: composer }).filter({ has: page.getByRole('button', { name: '올리기' }) }).last();
  await expect(box.locator('img[src*="/uploads/"]')).toHaveCount(1, { timeout: 15000 });
  await expect(composer).toBeFocused();
  // 새로고침해도 다시 붙지 않는다(라우터 state 를 비웠다)
  await page.reload();
  await expect(page.locator('textarea').first()).toBeVisible({ timeout: 15000 });
  await expect(page.locator('div').filter({ has: page.locator('textarea') }).filter({ has: page.getByRole('button', { name: '올리기' }) }).last().locator('img[src*="/uploads/"]')).toHaveCount(0);
  await ctx.close();
});

test('E. ★ 크기를 안 적은 작품 → [크기 입력하기] → 편집 화면에서 그 작품의 정보 창', async ({ browser }) => {
  const { ctx, page } = await openFor(browser, full, { desktop: true });
  const frame = await openArtLook(page);
  const idx = await frame.evaluate((id) => JSON.parse(localStorage.getItem('artlook:works')!).findIndex((w: any) => w.id === id), titledNoSize);
  expect(idx).toBeGreaterThanOrEqual(0);
  await frame.locator('#works button').nth(idx).click();
  await expect(frame.locator('#worksLine')).toContainText('높이 90cm', { timeout: 30000 });
  await expect(frame.locator('#worksLine')).toContainText('여름 그늘');
  await frame.getByRole('button', { name: '크기 입력하기' }).click();
  await page.waitForURL(/tab=homepage-edit/, { timeout: 15000 });
  const dialog = page.getByRole('dialog', { name: '작품 정보' });
  await expect(dialog).toBeVisible({ timeout: 15000 });
  await expect(dialog.locator('#meta-title')).toHaveValue('여름 그늘');   // 정보 없는 첫 작품(4번)이 아니라 고른 작품
  await expect(page).not.toHaveURL(/work=/);                            // 한 번 쓰고 주소에서 뗀다(새로고침에 다시 열리지 않게)
  await ctx.close();
});

test('F. 작품 0점 — 데모 작품으로 보여 주고 [작품 올리기] 는 편집 화면으로', async ({ browser }) => {
  const { ctx, page } = await openFor(browser, empty);
  const frame = await openArtLook(page);
  await expect(frame.locator('#worksEmpty')).toContainText('데모 작품');
  await expect(frame.locator('#works img')).toHaveCount(6);
  await frame.getByRole('button', { name: '작품 올리기' }).click();
  await expect(page).toHaveURL(/tab=homepage-edit&section=works/, { timeout: 15000 });
  await ctx.close();
});

test('G. 고른 액자·배경은 다음에 다시 열어도 그대로', async ({ browser }) => {
  const { ctx, page } = await openFor(browser, full, { desktop: true });
  let frame = await openArtLook(page);
  await tab(frame, 'frames');
  await frame.locator('#frames .chip[data-id="black"]').click();
  await tab(frame, 'scenes');
  const second = frame.locator('#scenes .chip').nth(1);
  const sceneName = await second.getAttribute('title');
  await second.click();
  await frame.waitForFunction(() => document.getElementById('busy')!.hidden, null, { timeout: 30000 });
  frame = await openArtLook(page);
  await tab(frame, 'frames');
  await expect(frame.locator('#frames .chip[data-id="black"]')).toHaveAttribute('aria-pressed', 'true');
  await tab(frame, 'scenes');
  await expect(frame.locator(`#scenes .chip[title="${sceneName}"]`)).toHaveAttribute('aria-pressed', 'true');
  await ctx.close();
});

test('H. 갤러리의 판매작 홍보(새 탭) — [ArtStory에 올리기]는 없고 [닫기]가 있다', async ({ browser }) => {
  const ctx = await browser.newContext({ acceptDownloads: true, hasTouch: false, isMobile: false, viewport: DESKTOP });
  await ctx.addInitScript(() => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('artlook:works', JSON.stringify([{ url: '/demo-art/dawn-window.jpg', title: '팔린 그림', artist: '작가', exhibition: '봄 공모', kind: 'sold' }]));
      sessionStorage.setItem('seeded', '1');
    }
  });
  const page = await ctx.newPage();
  await page.goto('/artlook/index.html');
  await page.waitForFunction(() => ((window as any).__artlookRenders || 0) >= 1, null, { timeout: 60000 });
  await expect(page.getByRole('heading', { name: 'ArtLook' })).toBeVisible();
  await expect(page.getByRole('button', { name: '닫기' })).toBeVisible();
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.locator('#dl').click()]);
  expect(dl.suggestedFilename()).toMatch(/^작가_팔린 그림_봄 공모_.+_판매작\.png$/);
  await expect(page.locator('#toStory')).toBeHidden();
  await ctx.close();
});
