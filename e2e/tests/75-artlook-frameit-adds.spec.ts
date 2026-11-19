import { test, expect, request as pwRequest, type APIRequestContext, type Browser, type BrowserContextOptions, type Frame, type Page } from '@playwright/test';
import { solidPng, noNudgeEntry, pickFrame, artlookSave } from '../lib/helpers';

/**
 * ArtLook — FrameIt 비교 뒤 더한 것(2026-10-25, CLAUDE.md 규칙 75). **눌러서 무슨 일이 나는가**를 본다.
 *
 *  A. 원형 액자 — 고르면 원이 걸리고(네 귀는 벽) · [원 맞추기]로 크기를 바꾸면 그 작품에 기억된다
 *  B. 액자 탭은 모양 × 재질(2026-11-17) — 모양 일곱 · 모양마다 무엇이 다른지 한 줄 · 박스 5종 · 같은 재질 유지 · 색 옮긴 액자 4종
 *  C. 리넨 매트 — 색 줄 뒤쪽 천 칩을 고르면 엔진 마감이 리넨
 *  D. 박물관 색 벽 — 네이비를 고르면 그 벽으로 그린다 · [마무리] 에 벽 캡션은 없다(2026-11-18 사용자 결정으로 뺐다)
 *  E. 여러 점 — [여러 점] → 두 점 더 → 칸 3개 · [배치 바꾸기] · [+] 로 커진다 · 저장 파일 이름 'N점' · 다시 누르면 한 점(크기 조절 초기화) (휴대폰·PC)
 *
 * ⚠️ 픽셀 품질은 하니스(세션 스크래치 frameit/ · scratchpad/vt)가 본다. 여기는 동작만.
 */
declare const state: { frameIdx: number; matTexture?: string; group?: unknown[] | null; circle?: { r: number } | null; sceneIdx: number; draft?: boolean };
declare const SCENES: { id: string; adj: { s: number } }[];
declare const FRAMES: { id: string; kind: string }[];

const API = 'http://localhost:4000/api';
const FE = 'http://localhost:5173';
const STAMP = Date.now();
const DESKTOP = { width: 1280, height: 800 };

interface Seeded { id: number; token: string; user: Record<string, unknown> }
const auth = (a: Seeded) => ({ Authorization: `Bearer ${a.token}` });

async function signupArtist(api: APIRequestContext): Promise<Seeded> {
  const r = await api.post(`${API}/auth/signup`, {
    data: { name: `프레임잇${String(STAMP).slice(-5)}`, email: `artlook-adds-${STAMP}@e2e.test`, password: 'ArtLook1!', role: 'ARTIST', agreeTerms: true, agreePrivacy: true },
  });
  if (!r.ok()) throw new Error(`작가 준비 실패 ${r.status()}: ${await r.text()}`);
  const { token, user } = await r.json();
  return { id: user.id, token, user };
}
async function addWork(api: APIRequestContext, a: Seeded, i: number, w: number, h: number, meta: Record<string, string>) {
  await api.get(`${API}/portfolio`, { headers: auth(a) });
  const up = await api.post(`${API}/upload/image`, {
    headers: auth(a),
    multipart: { image: { name: `w${i}.png`, mimeType: 'image/png', buffer: solidPng(w, h, [70 + i * 40, 110, 160 - i * 30]) } },
  });
  if (!up.ok()) throw new Error(`사진 올리기 실패 ${up.status()}`);
  const r = await api.post(`${API}/portfolio/images`, { headers: auth(a), data: { url: (await up.json()).url, ...meta } });
  if (!r.ok()) throw new Error(`작품 추가 실패 ${r.status()}`);
}

let artist: Seeded;
test.beforeAll(async () => {
  const api = await pwRequest.newContext();
  artist = await signupArtist(api);
  await addWork(api, artist, 0, 640, 480, { title: '물빛', medium: '캔버스에 유채', year: '2025', sizeText: '60.6×80.3 cm' });
  await addWork(api, artist, 1, 480, 600, { title: '창가', medium: '아크릴', year: '2024', sizeText: '72.7×60.6 cm' });
  await addWork(api, artist, 2, 500, 500, { title: '둥근 정원', medium: '종이에 과슈', year: '2023', sizeText: '50×50 cm' });
  await api.dispose();
});

async function openFor(browser: Browser, opts: { desktop?: boolean } = {}) {
  const extra: BrowserContextOptions = opts.desktop ? { hasTouch: false, isMobile: false, viewport: DESKTOP } : {};
  const ctx = await browser.newContext({
    ...extra, acceptDownloads: true,
    storageState: { cookies: [], origins: [{ origin: FE, localStorage: [{ name: 'artlink-auth', value: JSON.stringify({ state: { token: artist.token, user: artist.user, isAuthenticated: true }, version: 0 }) }, noNudgeEntry(artist.user.id)] }] },
  });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return { ctx, page, errors };
}
async function openArtLook(page: Page): Promise<Frame> {
  await page.goto('/mypage?tab=artlook');
  const handle = await page.waitForSelector('iframe[title="ArtLook"]', { state: 'attached', timeout: 30000 });
  const frame = (await handle.contentFrame())!;
  await frame.waitForFunction(() => ((window as any).__artlookRenders || 0) >= 1 && document.getElementById('busy')!.hidden, null, { timeout: 60000 });
  return frame;
}
/** 다시 그려질 때까지 — 고른 뒤 그린 횟수가 늘고 바쁨 표시가 사라진다 */
async function settled(frame: Frame, before: number) {
  await frame.waitForFunction((n) => ((window as any).__artlookRenders || 0) > n && document.getElementById('busy')!.hidden, before, { timeout: 60000 });
  await frame.waitForTimeout(300);
}
const renders = (frame: Frame) => frame.evaluate(() => (window as any).__artlookRenders || 0);
const tab = (frame: Frame, id: string) => frame.locator(`#tab-${id}`).click();
/** 미리보기(출력 좌표) 한 점의 색 */
const px = (frame: Frame, x: number, y: number) => frame.evaluate(([X, Y]) => Array.from((document.getElementById('preview') as HTMLCanvasElement)
  .getContext('2d')!.getImageData(Math.round(X), Math.round(Y), 1, 1).data).slice(0, 3), [x, y]);
const probe = (frame: Frame) => frame.evaluate(() => (window as any).__artlook);

test('A. 원형 액자 — 원만 걸리고 네 귀는 벽 · [원 맞추기]로 맞춘 크기는 그 작품에 기억', async ({ browser }) => {
  const { ctx, page, errors } = await openFor(browser);
  const frame = await openArtLook(page);
  const n = await renders(frame);
  await pickFrame(frame, 'round-gold');
  await settled(frame, n);
  expect(await frame.evaluate(() => FRAMES[state.frameIdx].kind)).toBe('round');
  await expect(frame.locator('#framesLine')).toContainText('사진 속 원에 테를 맞춰요');   // 모양 설명(휴대폰은 고를 때 알림, 줄은 넓은 칸에서 보인다)
  const f = (await probe(frame)).front as { x: number; y: number; w: number; h: number };
  expect(Math.abs(f.w - f.h) / f.w, '원형 판은 정사각').toBeLessThan(0.02);
  // 판의 네 귀(원 바깥) = 벽 — 바로 바깥 벽과 거의 같은 색. 가운데는 작품
  const corner = await px(frame, f.x + f.w * 0.05, f.y + f.h * 0.05);
  const wall = await px(frame, f.x - 12, f.y - 12);
  const diff = corner.reduce((s, v, i) => s + Math.abs(v - wall[i]), 0);
  expect(diff, `귀 ${corner} ↔ 벽 ${wall}`).toBeLessThan(40);
  // [원 맞추기] — 크기를 70% 로 → [완료] → 그 작품에 기억되고 다시 열어도 그대로
  await frame.getByRole('button', { name: '원 맞추기' }).click();
  await expect(frame.locator('#circleSheet')).toBeVisible();
  await frame.locator('#circleR').fill('35');
  await frame.locator('#circleR').dispatchEvent('input');
  const n2 = await renders(frame);
  await frame.getByRole('button', { name: '완료' }).click();
  await settled(frame, n2);
  await expect(frame.locator('#circleSheet')).toBeHidden();
  expect((await frame.evaluate(() => state.circle))!.r).toBeCloseTo(0.35, 2);
  const again = await openArtLook(page);
  expect((await again.evaluate(() => state.circle))!.r).toBeCloseTo(0.35, 2);
  expect(errors).toEqual([]);
  await ctx.close();
});

test('B. 액자는 모양 × 재질 — 모양 일곱 · 모양 설명 · 박스 5종 · 같은 재질 유지 · 색 옮긴 액자', async ({ browser }) => {
  const { ctx, page, errors } = await openFor(browser, { desktop: true });
  const frame = await openArtLook(page);
  await tab(frame, 'frames');
  expect(await frame.locator('#shapes .chip .name').allTextContents()).toEqual(['몰딩', '넓은 몰딩', '슬림', '플로터', '박스', '원형', '액자 없음']);
  // 재질 칩은 모서리 그림(frames/corners) — 넓은 칸은 모양 아래 줄에 그 모양의 설명
  const mats = async () => frame.evaluate(() => Array.from(document.querySelectorAll('#frames > *')).map((el) => (el as HTMLElement).dataset.id || el.id));
  expect(await mats()).toEqual(['oak', 'walnut', 'maple', 'teak', 'black', 'white', 'navy', 'forest', 'wine', 'silver', 'gold']);
  await expect(frame.locator('#frames .chip[data-id="oak"] img')).toHaveAttribute('src', 'frames/corners/oak.webp');
  await expect(frame.locator('#framesLine')).toBeVisible();
  // 숨긴 액자(사진으로 대신한 코드 액자)는 어느 모양에도 없다
  for (const id of ['slim-oak', 'slim-walnut', 'slim-silver', 'slim-champagne', 'floater-silver']) expect(await frame.evaluate((x) => (window as any).__artlookShapeOf(x), id)).toBeNull();
  // 색 옮긴 액자(네이비) — 고르면 그 액자로 그리고, 다른 모양으로 옮기면 블랙으로(그 모양엔 네이비가 없다)
  let n = await renders(frame);
  await frame.locator('#frames .chip[data-id="navy"]').click();
  await settled(frame, n);
  expect(await frame.evaluate(() => FRAMES[state.frameIdx].id)).toBe('navy');
  n = await renders(frame);
  await frame.locator('#shapes [data-shape="slim"]').click();
  await settled(frame, n);
  expect(await frame.evaluate(() => FRAMES[state.frameIdx].id)).toBe('slim-black');
  await expect(frame.locator('#framesLine')).toContainText('테가 가늘어');
  // 박스 = 5종 · 같은 재질 유지(블랙 → 블랙 박스)
  n = await renders(frame);
  await frame.locator('#shapes [data-shape="box"]').click();
  await settled(frame, n);
  expect(await mats()).toEqual(['box-oak', 'box-walnut', 'box-black', 'box-white', 'box-ivory']);
  expect(await frame.evaluate(() => FRAMES[state.frameIdx].id)).toBe('box-black');
  await expect(frame.locator('#framesLine')).toContainText('상자형 입체 액자');
  // [원 맞추기]는 원형 재질 바로 옆(줄 끝 버튼은 칩과 너무 멀었다 — 2026-10-26). 원형이 아닐 때 누르면 원형으로 바꾸고 창을 연다
  await frame.locator('#shapes [data-shape="round"]').click();
  expect(await mats()).toEqual(['round-black', 'round-gold', 'circleChip']);
  await frame.locator('#shapes [data-shape="molding"]').click();
  await pickFrame(frame, 'round-black');
  await frame.locator('#circleChip').click();
  await expect(frame.locator('#circleSheet')).toBeVisible();
  expect(await frame.evaluate(() => FRAMES[state.frameIdx].kind)).toBe('round');
  await frame.locator('body').press('Escape');
  await expect(frame.locator('#circleSheet')).toBeHidden();
  expect(errors).toEqual([]);
  await ctx.close();
});

test('C. 리넨 매트 — 색 줄 뒤쪽 천 칩', async ({ browser }) => {
  const { ctx, page, errors } = await openFor(browser, { desktop: true });
  const frame = await openArtLook(page);
  await tab(frame, 'frames');   // 매트는 [액자] 탭 안(2026-11-17)
  await frame.getByRole('button', { name: '넓게' }).click();
  const sw = frame.locator('.sw[title="리넨 내추럴"]');
  await sw.scrollIntoViewIfNeeded();
  const n = await renders(frame);
  await sw.click();
  await settled(frame, n);
  expect(await frame.evaluate(() => state.matTexture)).toBe('linen');
  await expect(sw).toHaveAttribute('aria-pressed', 'true');
  expect(errors).toEqual([]);
  await ctx.close();
});

test('D. 박물관 색 벽 — 고르면 그 벽으로 그린다 · 벽 캡션은 없다', async ({ browser }) => {
  const { ctx, page, errors } = await openFor(browser, { desktop: true });
  const frame = await openArtLook(page);
  await tab(frame, 'scenes');
  const navy = frame.locator('.chip.scene', { hasText: '네이비' });
  await navy.scrollIntoViewIfNeeded();
  const n = await renders(frame);
  await navy.click();
  await settled(frame, n);
  expect(await frame.evaluate(() => SCENES[state.sceneIdx].id)).toBe('navy');
  expect((await probe(frame)).front, '작품이 걸리지 않았다').toBeTruthy();
  // 벽 캡션은 2026-11-18 에 기능째로 뺐다 — [마무리] 에 스위치가 없다
  await tab(frame, 'finish');
  await expect(frame.getByRole('switch')).toHaveCount(0);
  await expect(frame.getByText('벽 캡션')).toHaveCount(0);
  expect(errors).toEqual([]);
  await ctx.close();
});

for (const desktop of [false, true]) {
  test(`E. 여러 점 — 세 점 · 배치 바꾸기 · 저장 이름 · 한 점으로 (${desktop ? 'PC' : '휴대폰'})`, async ({ browser }) => {
    const { ctx, page, errors } = await openFor(browser, { desktop });
    const frame = await openArtLook(page);
    await tab(frame, 'works');
    await frame.locator('#multiChip').click();
    await expect(frame.locator('#worksLine')).toContainText('함께 걸 작품을 더 골라 주세요');
    const chips = frame.locator('.chip.work[data-i]');
    let n = await renders(frame);
    await chips.nth(1).click();
    await chips.nth(2).click();
    await settled(frame, n);
    await frame.waitForFunction(() => (window as any).__artlook && (window as any).__artlook.items && (window as any).__artlook.items.length === 3, null, { timeout: 30000 });
    await expect(frame.locator('#worksLine')).toContainText('3점 · 가로 한 줄');
    await expect(chips.nth(2).locator('.ord')).toHaveText('3');
    n = await renders(frame);
    await frame.getByRole('button', { name: '배치 바꾸기' }).click();
    await settled(frame, n);
    await expect(frame.locator('#worksLine')).toContainText('큰 그림 + 작은 그림');
    // [+] 를 누르면 묶음이 실제로 커진다(예전엔 벽 폭에 막혀 아무 일도 없고 확대값만 쌓였다)
    const w0 = ((await probe(frame)).piece as { w: number }).w;
    if (desktop) {
      for (let i = 0; i < 2; i++) { n = await renders(frame); await frame.locator('#zoomIn').click(); await settled(frame, n); }
    } else {
      // 손가락 화면엔 [+] 가 없다(2026-11-17) — 두 손가락으로 벌린다
      await expect(frame.locator('#zoomIn')).toBeHidden();
      const cdp = await ctx.newCDPSession(page);
      const ifr = (await page.locator('iframe[title="ArtLook"]').boundingBox())!;
      const c = await frame.evaluate(() => { const r = document.getElementById('preview')!.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
      const x0 = ifr.x + c.x, y0 = ifr.y + c.y;
      n = await renders(frame);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0 - 20, y: y0, id: 1 }, { x: x0 + 20, y: y0, id: 2 }] });
      for (let i = 1; i <= 8; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 - 20 - i * 6, y: y0, id: 1 }, { x: x0 + 20 + i * 6, y: y0, id: 2 }] }); await page.waitForTimeout(20); }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await settled(frame, n);
      await frame.waitForFunction(() => !state.draft && document.getElementById('busy')!.hidden, null, { timeout: 15000 });   // 손을 떼면 원래 배율로 한 번 더
      await frame.waitForTimeout(600);
    }
    const w1 = ((await probe(frame)).piece as { w: number }).w;
    expect(w1, `묶음 폭 ${w0} → ${w1}`).toBeGreaterThan(w0 * 1.15);
    // 저장 — 파일 이름에 'N점'(휴대폰은 머리 [저장] 의 창 안)
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }).catch(() => null), artlookSave(frame)]);
    if (!desktop) await frame.locator('body').press('Escape');
    if (dl) expect(dl.suggestedFilename()).toContain('3점');
    // 다시 누르면 한 점
    await tab(frame, 'works');
    n = await renders(frame);
    await frame.locator('#multiChip').click();
    await settled(frame, n);
    expect(await frame.evaluate(() => state.group)).toBeNull();
    expect((await probe(frame)).items).toBeFalsy();
    // 묶음에서 키운 배율이 한 점으로 넘어오지 않는다
    expect(await frame.evaluate(() => SCENES[state.sceneIdx].adj.s)).toBe(1);
    expect(errors).toEqual([]);
    await ctx.close();
  });
}
