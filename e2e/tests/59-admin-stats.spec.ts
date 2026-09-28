import { test, expect, request as pwRequest, type Page } from '@playwright/test';
import { openAs, tokenFor } from '../lib/helpers';

/**
 * Admin [통계] 탭 — 일간 방문자(회원/비회원) (2026-09-28 사용자 요청)
 *
 * 실제 브라우저가 들어왔을 때 **그 방문이 세어지는지**를 본다(화면에 숫자가 보이는지만 보면 기록이 안 쌓여도 통과한다):
 *  ① 비회원이 들어오면 오늘 비회원 +1 · 같은 기기로 여러 화면을 다녀도 요청은 한 번
 *  ② 회원이 들어오면 오늘 회원 +1
 *  ③ 관리자 화면: KPI·막대·표가 서버 숫자와 같고, 막대에 올리면 그날 숫자가 뜬다 · 기간을 바꾸면 막대 수가 바뀐다
 *  ④ 작가에겐 탭도 API 도 없다
 * 숫자는 다른 스펙이 같은 DB 에 남긴 방문과 섞이므로 **전후 차이**로 잰다.
 */
const API = 'http://localhost:4000/api';
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

async function today() {
  const api = await pwRequest.newContext();
  const r = await api.get(`${API}/admin/stats/visitors?days=1`, { headers: auth(tokenFor('admin')) });
  expect(r.status()).toBe(200);
  const body = await r.json();
  await api.dispose();
  return body.rows[0] as { date: string; members: number; guests: number; total: number };
}

/** 페이지가 보낸 방문 기록 요청을 센다 */
function countVisits(page: Page) {
  const seen: number[] = [];
  page.on('response', (r) => { if (r.url().endsWith('/api/visits') && r.request().method() === 'POST') seen.push(r.status()); });
  return seen;
}

test('★ 비회원 방문은 오늘 비회원으로 세어지고, 같은 기기로 여러 화면을 다녀도 한 번만 보낸다', async ({ browser }) => {
  const before = await today();
  const ctx = await browser.newContext();   // 로그인 안 한 새 기기
  const page = await ctx.newPage();
  const sent = countVisits(page);
  await page.goto('/');
  await expect.poll(() => sent.length, { timeout: 15000 }).toBe(1);
  expect(sent[0]).toBe(204);
  await page.goto('/galleries');
  await page.goto('/exhibitions');
  await page.reload();
  await page.waitForTimeout(1000);
  expect(sent, '같은 날 같은 기기는 다시 보내지 않는다').toHaveLength(1);

  const after = await today();
  expect(after.guests).toBe(before.guests + 1);
  expect(after.members).toBe(before.members);
  await ctx.close();
});

test('★ 회원이 들어오면 오늘 회원 +1', async ({ browser }) => {
  const before = await today();
  const { page, ctx } = await openAs(browser, 'artist2');
  const sent = countVisits(page);
  await page.goto('/');
  await expect.poll(() => sent.length, { timeout: 15000 }).toBe(1);
  const after = await today();
  // 이 작가가 오늘 이미 다른 스펙에서 세어졌을 수 있다 — 회원은 사람 단위라 +0 또는 +1, 비회원은 늘지 않는다
  expect(after.members - before.members).toBeGreaterThanOrEqual(0);
  expect(after.members - before.members).toBeLessThanOrEqual(1);
  expect(after.guests).toBe(before.guests);
  await ctx.close();
});

test('★ 관리자 [통계] — KPI·막대·표가 서버 숫자와 같고, 막대에 올리면 그날 숫자가 뜬다', async ({ browser }) => {
  // 오늘 기록이 적어도 하나는 있게 — 비회원 한 명
  const g = await browser.newContext();
  const gp = await g.newPage();
  const sent = countVisits(gp);
  await gp.goto('/');
  await expect.poll(() => sent.length, { timeout: 15000 }).toBe(1);
  await g.close();

  const { page, ctx } = await openAs(browser, 'admin');
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/mypage?tab=stats');
  await expect(page.getByRole('heading', { name: '일간 방문자' })).toBeVisible({ timeout: 15000 });

  const t = await today();
  const kpis = page.getByTestId('visitor-kpis');
  await expect(kpis).toContainText('오늘 (지금까지)');
  await expect(kpis.locator('> div').first()).toContainText(`${t.total}명`);
  await expect(kpis.locator('> div').first()).toContainText(`회원 ${t.members}`);
  await expect(kpis.locator('> div').first()).toContainText(`비회원 ${t.guests}`);

  // 막대 — 마지막이 오늘, 올리면 그날 숫자
  const bars = page.getByTestId('visitor-bars').locator('button');
  const n = await bars.count();
  expect(n).toBeGreaterThan(0);
  await expect(bars.nth(n - 1)).toHaveAttribute('aria-label', new RegExp(`회원 ${t.members}명 · 비회원 ${t.guests}명 · 합계 ${t.total}명`));
  await bars.nth(n - 1).hover();
  await expect(page.getByRole('status')).toContainText('합계');

  // 표 — 맨 위가 오늘
  await page.getByText('표로 보기').click();
  const firstRow = page.getByTestId('visitor-table').locator('tbody tr').first();
  await expect(firstRow).toContainText(t.date);
  await expect(firstRow.locator('td').last()).toHaveText(String(t.total));

  // 기간 7일 — 막대가 7개를 넘지 않는다(집계 시작 전 날은 빠진다)
  await page.getByRole('button', { name: '7일' }).click();
  await expect.poll(async () => bars.count()).toBeLessThanOrEqual(7);
  await ctx.close();
});

test('★ 작가에겐 [통계] 탭도 통계 API 도 없다', async ({ browser }) => {
  const api = await pwRequest.newContext();
  expect((await api.get(`${API}/admin/stats/visitors`, { headers: auth(tokenFor('artist')) })).status()).toBe(403);
  expect((await api.get(`${API}/admin/stats/visitors`)).status()).toBe(401);
  await api.dispose();

  const { page, ctx } = await openAs(browser, 'artist');
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/mypage');
  await expect(page.getByRole('complementary').or(page.locator('aside')).first()).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('link', { name: '통계' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '통계' })).toHaveCount(0);
  await ctx.close();
});
