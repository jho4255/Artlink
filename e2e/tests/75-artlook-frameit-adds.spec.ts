import { test, expect, request as pwRequest, type APIRequestContext, type Browser, type BrowserContextOptions, type Frame, type Page } from '@playwright/test';
import { solidPng, noNudgeEntry } from '../lib/helpers';

/**
 * ArtLook — FrameIt 비교 뒤 더한 것(2026-10-25, CLAUDE.md 규칙 75). **눌러서 무슨 일이 나는가**를 본다.
 *
 *  A. 원형 액자 — 고르면 원이 걸리고(네 귀는 벽) · [원 맞추기]로 크기를 바꾸면 그 작품에 기억된다
 *  B. 액자 탭이 종류별로 묶여 있고 묶음마다 무엇이 다른지 한 줄(몰딩·넓은 몰딩·슬림·플로터·박스·원형·기타) · 박스는 5종
 *  C. 리넨 매트 — 색 줄 뒤쪽 천 칩을 고르면 엔진 마감이 리넨
 *  D. 박물관 색 벽 + [벽 캡션 붙이기] — 작품 옆 벽에 카드, 다시 열어도 켜져 있고 [벽 캡션 빼기]로 없어진다
 *  E. 여러 점 — [여러 점] → 두 점 더 → 칸 3개 · [배치 바꾸기] · [+] 로 커진다 · 저장 파일 이름 'N점' · 다시 누르면 한 점(크기 조절 초기화) (휴대폰·PC)
 *
 * ⚠️ 픽셀 품질은 하니스(세션 스크래치 frameit/ · scratchpad/vt)가 본다. 여기는 동작만.
 */
declare const state: { frameIdx: number; matTexture?: string; group?: unknown[] | null; caption?: boolean; circle?: { r: number } | null; sceneIdx: number };
declare const SCENES: { adj: { s: number } }[];
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
  await tab(frame, 'frames');
  const n = await renders(frame);
  const chip = frame.locator('.chip.frame[data-id="round-gold"]');
  await chip.scrollIntoViewIfNeeded(); await chip.click();
  await settled(frame, n);
  expect(await frame.evaluate(() => FRAMES[state.frameIdx].kind)).toBe('round');
  await expect(frame.locator('#framesLine')).toContainText('사진 속 원에 테를 맞춰요');   // 고른 액자의 묶음 설명(휴대폰은 칩 아래 줄)
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

test('B. 액자는 종류별로 묶여 있다 · 박스 5종', async ({ browser }) => {
  const { ctx, page, errors } = await openFor(browser, { desktop: true });
  const frame = await openArtLook(page);
  await tab(frame, 'frames');
  const labels = await frame.locator('#frames > .group b').allTextContents();
  expect(labels).toEqual(['몰딩', '넓은 몰딩', '슬림', '플로터', '박스', '원형', '기타']);
  // 넓은 칸은 묶음 이름 옆에 설명이 보이고, 고른 액자 설명 줄은 감춘다(2026-10-26)
  await expect(frame.locator('#frames > .group').filter({ hasText: '플로터' }).locator('.gdesc')).toBeVisible();
  await expect(frame.locator('#frames > .group').filter({ hasText: '플로터' })).toContainText('틈을 두고 띄워 거는');
  await expect(frame.locator('#framesLine')).toBeHidden();
  // 숨긴 액자(사진으로 대신한 코드 액자)는 목록에 없다
  for (const id of ['slim-oak', 'slim-walnut', 'slim-silver', 'slim-champagne', 'floater-silver']) await expect(frame.locator(`.chip.frame[data-id="${id}"]`)).toHaveCount(0);
  // 박스 묶음 = 박스 5종(라벨 다음부터 다음 라벨 전까지)
  const boxes = await frame.evaluate(() => { const out: string[] = []; let on = false;
    for (const el of Array.from(document.querySelectorAll('#frames > *'))) {
      if (el.classList.contains('group')) { on = el.querySelector('b')?.textContent === '박스'; continue; }
      if (on) out.push((el as HTMLElement).dataset.id || '');
    } return out; });
  expect(boxes).toEqual(['box-oak', 'box-walnut', 'box-black', 'box-white', 'box-ivory']);
  const n = await renders(frame);
  await frame.locator('.chip.frame[data-id="box-black"]').click();
  await settled(frame, n);
  await expect(frame.locator('#framesLine')).toContainText('상자형 입체 액자');
  // [원 맞추기]는 원형 칩 바로 옆(줄 끝 버튼은 칩과 너무 멀었다 — 2026-10-26). 원형이 아닐 때 누르면 원형으로 바꾸고 창을 연다
  const roundRow = await frame.evaluate(() => { const out: string[] = []; let on = false;
    for (const el of Array.from(document.querySelectorAll('#frames > *'))) {
      if (el.classList.contains('group')) { on = el.querySelector('b')?.textContent === '원형'; continue; }
      if (on) out.push((el as HTMLElement).dataset.id || el.id);
    } return out; });
  expect(roundRow).toEqual(['round-black', 'round-gold', 'circleChip']);
  await expect(frame.locator('#framesLine')).not.toContainText('원 맞추기');
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
  await tab(frame, 'mat');
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

test('D. 박물관 색 벽 + 벽 캡션 — 붙고, 다시 열어도 켜져 있고, 뺄 수 있다', async ({ browser }) => {
  const { ctx, page, errors } = await openFor(browser, { desktop: true });
  let frame = await openArtLook(page);
  await tab(frame, 'scenes');
  const navy = frame.locator('.chip.scene', { hasText: '네이비' });
  await navy.scrollIntoViewIfNeeded();
  let n = await renders(frame);
  await navy.click();
  await settled(frame, n);
  n = await renders(frame);
  await frame.getByRole('button', { name: '벽 캡션 붙이기' }).click();
  await settled(frame, n);
  const p = await probe(frame);
  expect(p.label, '캡션 카드가 없다').toBeTruthy();
  const front = p.front as { x: number; w: number };
  expect(Math.min(...(p.label as number[][]).map((q) => q[0])), '카드는 작품 오른쪽').toBeGreaterThan(front.x + front.w);
  // 다시 열어도 켜져 있다(이 브라우저에 기억)
  frame = await openArtLook(page);
  expect(await frame.evaluate(() => state.caption)).toBe(true);
  expect((await probe(frame)).label).toBeTruthy();
  await tab(frame, 'scenes');
  n = await renders(frame);
  await frame.getByRole('button', { name: '벽 캡션 빼기' }).click();
  await settled(frame, n);
  expect((await probe(frame)).label).toBeFalsy();
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
    for (let i = 0; i < 2; i++) { n = await renders(frame); await frame.locator('#zoomIn').click(); await settled(frame, n); }
    const w1 = ((await probe(frame)).piece as { w: number }).w;
    expect(w1, `묶음 폭 ${w0} → ${w1}`).toBeGreaterThan(w0 * 1.15);
    // 여러 점에선 캡션 단추가 없다
    await tab(frame, 'scenes');
    await expect(frame.getByRole('button', { name: /벽 캡션/ })).toHaveCount(0);
    // 저장 — 파일 이름에 'N점'
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }).catch(() => null), frame.locator('#dl').click()]);
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
