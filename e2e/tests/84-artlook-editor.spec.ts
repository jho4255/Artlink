import { test, expect, request as pwRequest, type APIRequestContext, type Browser, type BrowserContextOptions, type Frame, type Page } from '@playwright/test';
import { solidPng, noNudgeEntry, pickFrame, artlookSave, savedNote } from '../lib/helpers';

/**
 * ArtLook 편집 화면 개편 — 2026-11-17, CLAUDE.md 규칙 85(PLAN `scratchpad/artlook-review/PLAN.md` WP4~9). **눌러서 무슨 일이 나는가**를 본다.
 *
 *  A. 휴대폰 — 아트링크 상단바·하단 탭바 없이 화면 가득 · 미리보기 ≥ 380px · [닫기 ×] 는 이전 화면(주소로 바로 열었으면 마이페이지)
 *  B. 추천 조합 — 누르면 액자·배경·매트가 한 번에 바뀌고 그리기 +1 · 벽 사진은 그 하나만 받는다 · 새로고침 뒤 그대로
 *  C. 액자 모양 × 재질 — 모양 → 재질 → 저장 파일 이름에 액자 이름 · 모양을 바꿔도 재질 유지 · 없는 재질은 가까운 것으로 · 색 옮긴 액자
 *  D. 크기 칩 — 크기를 안 적은 작품에 10~100호 · 30호 → 100호에서 조각이 커진다 · 새로고침 뒤 그대로 · 크기 있는 작품엔 줄이 없다
 *  E. 저장 창 — [저장] → 창 → 내려받기 · 저장하기 전에도 [ArtStory에 올리기] → 사진이 실린 소식 올리기 화면
 *  F. 배경 [공간 | 벽] · [마무리] 는 비율·조명뿐(벽 캡션은 2026-11-18 에 뺐다)
 *  G. PC(1440) — 상단바 그대로 · 확대 단추는 그림 바깥 여백에(그림을 가리지 않는다)
 *
 * ⚠️ 기하(여러 화면·사파리 엔진)는 `scratchpad/artlook-ux/walk.js` · `scratchpad/artlook-review/panegeo.cjs` 가 본다.
 */
declare const state: { frameIdx: number; sceneIdx: number; matWidth: number; matteColor: string; draft?: boolean };
declare const FRAMES: { id: string; name: string }[];
declare const SCENES: { id: string; group?: string; adj: { s: number } }[];

const API = 'http://localhost:4000/api';
const FE = 'http://localhost:5173';
const STAMP = Date.now();
const PC = { width: 1440, height: 900 };

interface Seeded { id: number; token: string; user: Record<string, unknown> }
const auth = (a: Seeded) => ({ Authorization: `Bearer ${a.token}` });

async function signupArtist(api: APIRequestContext): Promise<Seeded> {
  const r = await api.post(`${API}/auth/signup`, {
    data: { name: `편집${String(STAMP).slice(-5)}`, email: `artlook-editor-${STAMP}@e2e.test`, password: 'ArtLook1!', role: 'ARTIST', agreeTerms: true, agreePrivacy: true },
  });
  if (!r.ok()) throw new Error(`작가 준비 실패 ${r.status()}: ${await r.text()}`);
  const { token, user } = await r.json();
  return { id: user.id, token, user };
}
async function addWork(api: APIRequestContext, a: Seeded, i: number, w: number, h: number, meta: Record<string, string>) {
  await api.get(`${API}/portfolio`, { headers: auth(a) });
  const up = await api.post(`${API}/upload/image`, {
    headers: auth(a),
    multipart: { image: { name: `e${i}.png`, mimeType: 'image/png', buffer: solidPng(w, h, [80 + i * 40, 100, 150 - i * 30]) } },
  });
  if (!up.ok()) throw new Error(`사진 올리기 실패 ${up.status()}`);
  const r = await api.post(`${API}/portfolio/images`, { headers: auth(a), data: { url: (await up.json()).url, ...meta } });
  if (!r.ok()) throw new Error(`작품 추가 실패 ${r.status()}`);
}

let artist: Seeded;
test.beforeAll(async () => {
  const api = await pwRequest.newContext();
  artist = await signupArtist(api);
  await addWork(api, artist, 0, 480, 600, { title: '아침 창', medium: '캔버스에 유채', year: '2025', sizeText: '72.7×60.6 cm' });
  await addWork(api, artist, 1, 480, 600, { title: '크기 없는 그림', medium: '아크릴', year: '2024' });   // D — 크기 칩
  await api.dispose();
});

async function openFor(browser: Browser, opts: { pc?: boolean } = {}) {
  const extra: BrowserContextOptions = opts.pc ? { hasTouch: false, isMobile: false, viewport: PC } : {};
  const ctx = await browser.newContext({
    ...extra, acceptDownloads: true,
    storageState: { cookies: [], origins: [{ origin: FE, localStorage: [{ name: 'artlink-auth', value: JSON.stringify({ state: { token: artist.token, user: artist.user, isAuthenticated: true }, version: 0 }) }, noNudgeEntry(artist.user.id as number)] }] },
  });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const requests: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
  return { ctx, page, errors, requests };
}
async function artLookFrame(page: Page): Promise<Frame> {
  const handle = await page.waitForSelector('iframe[title="ArtLook"]', { state: 'attached', timeout: 30000 });
  const frame = (await handle.contentFrame())!;
  await frame.waitForFunction(() => ((window as any).__artlookRenders || 0) >= 1 && document.getElementById('busy')!.hidden, null, { timeout: 60000 });
  return frame;
}
async function openArtLook(page: Page): Promise<Frame> {
  await page.goto('/mypage?tab=artlook');
  return artLookFrame(page);
}
const renders = (frame: Frame) => frame.evaluate(() => (window as any).__artlookRenders || 0);
async function settled(frame: Frame, before: number) {
  await frame.waitForFunction((n) => ((window as any).__artlookRenders || 0) > n && document.getElementById('busy')!.hidden, before, { timeout: 60000 });
  await frame.waitForTimeout(300);
}
const tab = (frame: Frame, id: string) => frame.locator(`#tab-${id}`).click();
const frameId = (frame: Frame) => frame.evaluate(() => FRAMES[state.frameIdx].id);
const pieceW = (frame: Frame) => frame.evaluate(() => ((window as any).__artlook?.piece?.w as number) || 0);

test('A. ★ 휴대폰 — 상단바·하단 탭바 없이 화면 가득 · [닫기 ×] 는 이전 화면', async ({ browser }) => {
  const { ctx, page, errors } = await openFor(browser);
  // 앱 안에서 들어온다 — 홈 → [메뉴] → ArtLook
  await page.goto('/');
  await page.getByRole('button', { name: /메뉴/ }).first().click();
  await page.getByRole('link', { name: /ArtLook/ }).first().click();
  await expect(page).toHaveURL(/tab=artlook/);
  const frame = await artLookFrame(page);
  await expect(page.locator('nav[aria-label="하단 내비게이션"]')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'ArtLink' })).toHaveCount(0);           // 상단바(로고)가 없다
  const ifr = (await page.locator('iframe[title="ArtLook"]').boundingBox())!;
  const vh = page.viewportSize()!.height;
  expect(ifr.y, 'iframe 이 화면 맨 위에서 시작하지 않는다').toBeLessThanOrEqual(1);
  expect(vh - (ifr.y + ifr.height), 'iframe 아래가 비었다').toBeLessThan(2);
  const pv = await frame.locator('#preview').boundingBox();
  expect(Math.min(pv!.width, pv!.height), '미리보기').toBeGreaterThanOrEqual(380);
  // [닫기 ×] → 들어온 화면(홈)으로
  await frame.getByRole('button', { name: '닫기' }).click();
  await expect(page).toHaveURL(new RegExp(`${FE}/$`), { timeout: 15000 });
  // 주소로 바로 열었으면 → 마이페이지 첫 탭
  const frame2 = await openArtLook(page);
  await frame2.getByRole('button', { name: '닫기' }).click();
  await expect(page).toHaveURL(/\/mypage$/, { timeout: 15000 });
  expect(errors).toEqual([]);
  await ctx.close();
});

test('B. ★ 추천 조합 — 한 번에 바뀌고 그리기 +1 · 벽 사진은 그 하나 · 새로고침 뒤 그대로', async ({ browser }) => {
  const { ctx, page, errors, requests } = await openFor(browser);
  let frame = await openArtLook(page);
  await expect(frame.locator('#tab-reco')).toHaveAttribute('aria-selected', 'true');   // 처음 여는 탭
  const chip = frame.locator('#presets .chip[data-preset="cube"]');
  await expect(chip.locator('img')).toHaveAttribute('src', 'presets/cube.webp');
  const n = await renders(frame);
  const before = requests.length;
  await chip.click();
  await settled(frame, n);
  await frame.waitForTimeout(800);
  expect(await renders(frame), '조합 하나에 여러 번 그렸다').toBe(n + 1);
  const walls = requests.slice(before).filter((u) => /\/artlook\/walls\/(?!thumbs\/)/.test(u));
  expect(walls.length, `벽 사진 ${walls.join(' ')}`).toBeLessThanOrEqual(1);
  const st = () => frame.evaluate(() => ({ frame: FRAMES[state.frameIdx].id, scene: SCENES[state.sceneIdx].id, mat: state.matWidth, color: state.matteColor }));
  expect(await st()).toEqual({ frame: 'black', scene: 'white-cube', mat: 0.05, color: '#ffffff' });
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  await expect(frame.locator('#presetLine')).toContainText('블랙');
  frame = await openArtLook(page);
  expect(await st()).toEqual({ frame: 'black', scene: 'white-cube', mat: 0.05, color: '#ffffff' });
  await expect(frame.locator('#presets .chip[data-preset="cube"]')).toHaveAttribute('aria-pressed', 'true');
  expect(errors).toEqual([]);
  await ctx.close();
});

test('C. ★ 액자 모양 × 재질 — 저장 이름 · 같은 재질 유지 · 없는 재질은 가까운 것 · 색 옮긴 액자', async ({ browser }) => {
  const { ctx, page, errors } = await openFor(browser, { pc: true });
  const frame = await openArtLook(page);
  let n = await renders(frame);
  await pickFrame(frame, 'floater-walnut');
  await settled(frame, n);
  expect(await frameId(frame)).toBe('floater-walnut');
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), artlookSave(frame)]);
  expect(dl.suggestedFilename()).toContain('월넛 플로터');
  // 같은 재질 유지 — 플로터 월넛 → 박스 월넛
  n = await renders(frame);
  await frame.locator('#shapes [data-shape="box"]').click();
  await settled(frame, n);
  expect(await frameId(frame)).toBe('box-walnut');
  // 없는 재질은 가까운 것 — 몰딩 골드 → 슬림엔 골드·샴페인이 없어 오크
  await pickFrame(frame, 'gold');
  n = await renders(frame);
  await frame.locator('#shapes [data-shape="slim"]').click();
  await settled(frame, n);
  expect(await frameId(frame)).toBe('oak-thin');
  // 색 옮긴 액자(와인) — 몰딩의 재질로 고르고 그린다(오류 없이)
  n = await renders(frame);
  await pickFrame(frame, 'wine');
  await settled(frame, n);
  expect(await frameId(frame)).toBe('wine');
  expect(await frame.evaluate(() => (window as any).__artlook?.piece?.w > 0)).toBe(true);
  expect(errors).toEqual([]);
  await ctx.close();
});

test('D. ★ 크기 칩 — 30호 → 100호에서 커진다 · 새로고침 뒤 그대로 · 크기 있는 작품엔 줄이 없다', async ({ browser }) => {
  const { ctx, page, errors } = await openFor(browser);
  let frame = await openArtLook(page);
  await tab(frame, 'works');
  const idxOf = (title: string) => frame.evaluate((t) => JSON.parse(localStorage.getItem('artlook:works')!).findIndex((w: any) => w.title === t), title);
  const sized = await idxOf('아침 창'), unsized = await idxOf('크기 없는 그림');
  let n = await renders(frame);
  await frame.locator(`#works .chip.work[data-i="${sized}"]`).click();
  await settled(frame, n).catch(() => {});
  await expect(frame.locator('#sizes')).toBeHidden();
  n = await renders(frame);
  await frame.locator(`#works .chip.work[data-i="${unsized}"]`).click();
  await settled(frame, n);
  await expect(frame.locator('#sizes')).toBeVisible();
  await expect(frame.locator('#worksLine')).toContainText('높이 90cm');
  n = await renders(frame);
  await frame.locator('#sizes button', { hasText: '30호' }).click();
  await settled(frame, n);
  const w30 = await pieceW(frame);
  n = await renders(frame);
  await frame.locator('#sizes button', { hasText: '100호' }).click();
  await settled(frame, n);
  const w100 = await pieceW(frame);
  expect(w100, `30호 ${w30} → 100호 ${w100}`).toBeGreaterThan(w30 * 1.03);
  await expect(frame.locator('#worksLine')).toContainText('162.2');
  await expect(frame.locator('#sizes button', { hasText: '100호' })).toHaveAttribute('aria-pressed', 'true');
  // 고른 크기는 작품 정보에 저장하지 않는다 — [크기 입력하기] 가 그 길로 남는다
  await expect(frame.getByRole('button', { name: '크기 입력하기' })).toBeVisible();
  frame = await openArtLook(page);
  await tab(frame, 'works');
  n = await renders(frame);
  await frame.locator(`#works .chip.work[data-i="${unsized}"]`).click();
  await settled(frame, n).catch(() => {});
  await expect(frame.locator('#sizes button', { hasText: '100호' })).toHaveAttribute('aria-pressed', 'true');
  expect(errors).toEqual([]);
  await ctx.close();
});

test('E. ★ 저장 창 — 저장하기 전에도 [ArtStory에 올리기] · 내려받기 · 소식 올리기 화면에 사진', async ({ browser }) => {
  const { ctx, page, errors } = await openFor(browser);
  const frame = await openArtLook(page);
  await frame.locator('#saveOpen').click();
  const box = frame.getByRole('dialog', { name: '저장' });
  await expect(box).toBeVisible();
  await expect(box.locator('#toStory')).toBeVisible();
  await expect(box.locator('#toStory')).toBeEnabled();
  await expect(frame.locator('#saveName')).toHaveText(/./);
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), box.locator('#dl').click()]);
  expect(dl.suggestedFilename()).toMatch(/\.png$/);
  await expect(savedNote(frame)).toContainText('저장했어요');
  await box.locator('#toStory').click();
  await page.waitForURL(/\/story\/new/, { timeout: 30000 });
  await expect(page.getByRole('list', { name: '올릴 사진' }).locator('img[src*="/uploads/"]')).toHaveCount(1, { timeout: 15000 });
  await page.getByRole('button', { name: '닫기' }).click();
  await page.getByRole('dialog', { name: '쓰던 소식을 버릴까요?' }).getByRole('button', { name: '버리기' }).click();
  expect(errors).toEqual([]);
  await ctx.close();
});

test('F. 배경 [공간 | 벽] · [마무리] 는 비율·조명뿐', async ({ browser }) => {
  const { ctx, page, errors } = await openFor(browser);
  const frame = await openArtLook(page);
  await tab(frame, 'scenes');
  await frame.locator('#sceneKinds button[data-kind="wall"]').click();
  await expect(frame.locator('#sceneKinds button[data-kind="wall"]')).toHaveAttribute('aria-pressed', 'true');
  const visibleGroups = await frame.locator('#scenes .chip:visible').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.group));
  expect(visibleGroups.length).toBeGreaterThan(0);
  expect(new Set(visibleGroups)).toEqual(new Set(['wall']));
  const n = await renders(frame);
  await frame.locator('#scenes .chip[data-group="wall"][title="화이트 플라스터"]').click();
  await settled(frame, n);
  expect(await frame.evaluate(() => SCENES[state.sceneIdx].group)).toBe('wall');
  await tab(frame, 'finish');
  await expect(frame.locator('#ratios')).toBeVisible();
  await expect(frame.locator('#lightOp')).toBeVisible();
  // 벽 캡션은 2026-11-18 사용자 결정으로 기능째 뺐다
  await expect(frame.getByRole('switch')).toHaveCount(0);
  await expect(frame.getByText('벽 캡션')).toHaveCount(0);
  expect(errors).toEqual([]);
  await ctx.close();
});

test('G. PC(1440) — 상단바 그대로 · 확대 단추는 그림 바깥', async ({ browser }) => {
  const { ctx, page, errors } = await openFor(browser, { pc: true });
  const frame = await openArtLook(page);
  await expect(page.getByRole('link', { name: 'ArtLink' }).first()).toBeVisible();
  await expect(frame.locator('#saveOpen')).toBeHidden();      // PC 는 패널 아래 [이미지 저장]
  await expect(frame.locator('#dl')).toBeVisible();
  await expect(frame.locator('#zoom')).toBeVisible();
  const pv = (await frame.locator('#preview').boundingBox())!;
  const z = (await frame.locator('#zoom').boundingBox())!;
  expect(z.x + z.width, '확대 단추가 그림을 가린다').toBeLessThanOrEqual(pv.x + 1);
  expect(errors).toEqual([]);
  await ctx.close();
});
