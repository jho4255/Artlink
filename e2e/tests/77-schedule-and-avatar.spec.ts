import { test, expect, request as pwRequest, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { kstDay, noNudgeEntry, solidPng, statePath } from '../lib/helpers';

/**
 * 2026-10-28 사용자 요청 둘 — **눌러서 무슨 일이 나는가**를 본다.
 *
 *  A. 공모 등록 일정 달력(Skyscanner 가는 날/오는 날 방식, components/shared/SchedulePicker)
 *     지난 날은 못 고른다 · 고르면 다음 칸으로 넘어간다 · 앞 칸보다 이른 날은 못 고른다 · 앞 칸을 뒤로 옮기면 깨진 뒤 칸이 비워진다
 *  B. 휴대폰 — 달력은 아래에서 올라오는 창이고 날짜가 하단 탭바에 가리지 않는다 · Esc 로 닫힌다
 *  C. 홈페이지 이름 위 프로필 사진 — 기본 꺼짐 · [소개] 에서 사진을 올리면 켜지고 저장하면 방문자에게 보인다 · 끄면 사라진다
 */
const API = 'http://localhost:4000/api';
const FE = 'http://localhost:5173';
const STAMP = Date.now();

const field = (page: Page, id: string) => page.locator(`#${id}`);
const dayBtn = (page: Page, ymd: string) => page.locator(`[data-schedule-day="${ymd}"]`).first();
async function pick(page: Page, ymd: string) {
  for (let i = 0; i < 36; i++) {
    if (await dayBtn(page, ymd).isVisible().catch(() => false)) { await dayBtn(page, ymd).click(); return; }
    await page.getByRole('button', { name: '다음 달' }).click();
  }
  throw new Error(`달력에서 ${ymd} 를 찾지 못했다`);
}
const calendar = (page: Page, label: string) => page.locator(`[aria-label="${label} 달력"]`);

test('A. 공모 등록 일정 — 지난 날 흐림 · 다음 칸으로 · 앞 칸보다 이른 날 흐림 · 깨진 뒤 칸 비우기 (PC)', async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: statePath('gallery'), viewport: { width: 1280, height: 900 }, hasTouch: false, isMobile: false });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/exhibitions/new');
  await expect(field(page, 'ex-start')).toBeVisible({ timeout: 15000 });
  // 칸은 손으로 치는 입력이 아니라 달력을 여는 버튼이다
  await expect(page.locator('input[type="date"]')).toHaveCount(0);

  await field(page, 'ex-start').click();
  await expect(calendar(page, '공모 시작일')).toBeVisible();
  await expect(page.locator('[role="grid"]')).toHaveCount(2);   // 넓은 칸 — 두 달
  if (await dayBtn(page, kstDay(-1)).count()) await expect(dayBtn(page, kstDay(-1))).toBeDisabled();
  await expect(dayBtn(page, kstDay(0))).toBeEnabled();

  await pick(page, kstDay(1));
  await expect(calendar(page, '공모 마감일')).toBeVisible();            // 가는 날을 고르면 바로 오는 날
  await expect(dayBtn(page, kstDay(0))).toBeDisabled();                 // 시작 전날은 못 고른다
  await expect(dayBtn(page, kstDay(1))).toBeEnabled();                  // 같은 날 마감은 된다
  await pick(page, kstDay(10));
  await expect(calendar(page, '출품 자료 제출 마감일')).toBeVisible();
  await expect(dayBtn(page, kstDay(10))).toBeDisabled();                // 마감 당일은 안 된다(다음 날부터)
  await pick(page, kstDay(15));
  await pick(page, kstDay(20));
  await pick(page, kstDay(30));
  await expect(page.locator('[role="grid"]')).toHaveCount(0);           // 마지막 칸을 고르면 닫힌다

  const shown = async () => page.locator('[data-schedule-field]').allInnerTexts();
  expect((await shown()).every((t) => /\d{4}\. \d+\. \d+ \(.\)/.test(t)), (await shown()).join(' | ')).toBe(true);
  await expect(page.locator('p', { hasText: /^한눈에 · 지원 .+ · 자료 제출 ~.+ · 전시 / })).toBeVisible();

  // 시작을 자료 제출 뒤로 옮긴다 → 마감·자료 제출·전시 시작이 비워지고, 달력은 마감으로 넘어간다
  await field(page, 'ex-start').click();
  await pick(page, kstDay(25));
  await expect(calendar(page, '공모 마감일')).toBeVisible();
  const after = await shown();
  expect(after[0]).not.toContain('날짜 선택');
  expect(after.slice(1, 4).every((t) => t.includes('날짜 선택')), after.join(' | ')).toBe(true);
  expect(after[4], '전시 종료(30일)는 여전히 순서에 맞아 남는다').not.toContain('날짜 선택');

  // 바깥을 누르면 닫힌다
  await page.mouse.click(8, 450);
  await expect(page.locator('[role="grid"]')).toHaveCount(0);
  expect(errors).toEqual([]);
  await ctx.close();
});

test('B. 휴대폰 — 아래에서 올라오는 창, 날짜가 탭바에 안 가린다 · Esc 로 닫힌다', async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: statePath('gallery'), viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await page.goto('/exhibitions/new');
  await field(page, 'ex-start').scrollIntoViewIfNeeded();
  await field(page, 'ex-start').click();
  const sheet = page.getByRole('dialog', { name: '공모 시작일 달력' });
  await expect(sheet).toBeVisible();
  await expect(page.locator('[role="grid"]')).toHaveCount(1);   // 좁은 화면 — 한 달
  // 이 달의 마지막 날 버튼의 한가운데를 누르면 정말 그 버튼이 잡히는가(탭바가 아니라)
  const lastDay = page.locator('[data-schedule-day]').last();
  const hit = await lastDay.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { inView: r.bottom <= innerHeight, hit: !!top && (top === el || el.contains(top)) };
  });
  expect(hit).toEqual({ inView: true, hit: true });
  await pick(page, kstDay(2));
  await expect(page.getByRole('dialog', { name: '공모 마감일 달력' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('[role="grid"]')).toHaveCount(0);
  await expect(field(page, 'ex-start')).toContainText(/\d{4}\. \d+\. \d+/);
  await ctx.close();
});

interface Seeded { id: number; token: string; user: Record<string, unknown> }
async function signupArtist(api: APIRequestContext): Promise<Seeded> {
  const r = await api.post(`${API}/auth/signup`, {
    data: { name: `사진작가${String(STAMP).slice(-6)}`, email: `avatar-${STAMP}@e2e.test`, password: 'AvatarTest1!', role: 'ARTIST', agreeTerms: true, agreePrivacy: true },
  });
  if (!r.ok()) throw new Error(`작가 준비 실패 ${r.status()}: ${await r.text()}`);
  const { token, user } = await r.json();
  const h = { Authorization: `Bearer ${token}` };
  await api.get(`${API}/portfolio`, { headers: h });   // 포트폴리오를 먼저 만든다(없으면 작품 추가가 400)
  const img = await api.post(`${API}/portfolio/images`, { headers: h, data: { url: '/uploads/art1.png' } });
  if (!img.ok()) throw new Error(`작품 추가 실패 ${img.status()}: ${await img.text()}`);
  return { id: user.id, token, user };
}
async function openFor(browser: Browser, a: Seeded) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 }, hasTouch: false, isMobile: false,
    storageState: { cookies: [], origins: [{ origin: FE, localStorage: [{ name: 'artlink-auth', value: JSON.stringify({ state: { token: a.token, user: a.user, isAuthenticated: true }, version: 0 }) }, noNudgeEntry(a.user.id as number)] }] },
  });
  return { ctx, page: await ctx.newPage() };
}

test('C. 홈페이지 프로필 사진 — 기본 꺼짐 · 올리면 켜지고 저장하면 이름 위에 · 끄면 사라진다', async ({ browser }) => {
  const api = await pwRequest.newContext();
  const a = await signupArtist(api);
  const guest = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const gp = await guest.newPage();
  const publicAvatar = () => gp.getByTestId('homepage-avatar');

  // 기본은 꺼짐 — 사진이 있어도 안 보인다(카카오 프로필 사진이 저절로 뜨지 않게)
  await api.put(`${API}/auth/me/avatar`, { headers: { Authorization: `Bearer ${a.token}` }, data: { avatar: '/uploads/art2.png' } });
  await gp.goto(`/portfolio/${a.id}`);
  await expect(gp.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15000 });
  await expect(publicAvatar()).toHaveCount(0);

  const { ctx, page } = await openFor(browser, a);
  await page.goto('/mypage?tab=homepage-edit&section=intro');
  const toggle = page.getByTestId('show-avatar');
  await expect(toggle).not.toBeChecked({ timeout: 15000 });
  // [소개] 에서 사진을 올리면 보이기가 켜지고, 미리보기에 바로 나온다
  await page.getByTestId('homepage-avatar-input').setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: solidPng(300, 300, [40, 90, 160]) });
  await expect(page.getByText('프로필 사진을 바꿨어요.')).toBeVisible({ timeout: 20000 });
  await expect(toggle).toBeChecked();
  await expect(page.getByRole('complementary', { name: '홈페이지 미리보기' }).getByTestId('homepage-avatar')).toBeVisible();

  const saved = page.waitForRequest((r) => r.url().endsWith('/api/portfolio') && r.method() === 'PUT');
  await page.locator('[data-save-bar]').getByRole('button', { name: '저장', exact: true }).click();
  expect((await saved).postDataJSON().showAvatar).toBe(true);
  await page.waitForURL(new RegExp(`/(portfolio/${a.id}|@)`), { timeout: 15000 });

  await gp.reload();
  await expect(publicAvatar()).toBeVisible({ timeout: 15000 });
  const av = (await publicAvatar().boundingBox())!;
  const h1 = (await gp.getByRole('heading', { level: 1 }).boundingBox())!;
  expect(av.y + av.height, '사진이 이름 위').toBeLessThanOrEqual(h1.y);
  expect(av.width).toBeGreaterThanOrEqual(100);   // PC 112px

  // 끄고 저장하면 사라진다
  await page.goto('/mypage?tab=homepage-edit&section=intro');
  await page.getByTestId('show-avatar').uncheck();
  await page.locator('[data-save-bar]').getByRole('button', { name: '저장', exact: true }).click();
  await page.waitForURL(new RegExp(`/(portfolio/${a.id}|@)`), { timeout: 15000 });
  await gp.reload();
  await expect(gp.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15000 });
  await expect(publicAvatar()).toHaveCount(0);

  await guest.close();
  await ctx.close();
  await api.dispose();
});
