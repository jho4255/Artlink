import { test, expect, request as pwRequest, type Browser, type Page } from '@playwright/test';
import { statePath, tokenFor } from '../lib/helpers';

/**
 * 1:1 문의 알림 (2026-10-31) — **벨을 눌러 어디에 도착하는지**를 본다.
 *
 *  A. 작가가 문의 → 관리자 벨 → 눌러서 그 문의가 펼쳐진 채로 → 답변 → 작가 벨 → 눌러서 답변이 보인다
 *  B. 휴대폰 · 고객센터를 열어 둔 채 — 캐시엔 '대기중'인데 답변이 보인다 · 접고 같은 알림을 다시 눌러도 열린다
 *  C. 관리자가 '답변완료'를 보던 중 — 새 문의는 그 목록에 없으므로 전체로 돌아가서 연다
 *  D. 남의 문의 번호 — 열리지 않고 주소만 정리된다
 *
 * 그냥 `/support` 로 보내면 FAQ 부터 뜨고 문의는 아래에서 다시 찾아 눌러야 했다. 그래서 FAQ 를 깔아 두고 **화면 안에 왔는지**까지 잰다.
 */
const API = 'http://localhost:4000/api';
const STAMP = Date.now();
const admin = () => ({ Authorization: `Bearer ${tokenFor('admin')}` });
const artist = () => ({ Authorization: `Bearer ${tokenFor('artist')}` });
const faqIds: number[] = [];

test.beforeAll(async () => {
  const api = await pwRequest.newContext();
  for (let i = 0; i < 8; i++) {
    const r = await api.post(`${API}/inquiries/faq`, { headers: admin(), data: { question: `E2E 자주 묻는 질문 ${STAMP}-${i}`, answer: '답', order: 900 + i } });
    if (!r.ok()) throw new Error(`FAQ 준비 실패 ${r.status()}: ${await r.text()}`);
    faqIds.push((await r.json()).id);
  }
  await api.dispose();
});

test.afterAll(async () => {
  const api = await pwRequest.newContext();
  for (const id of faqIds) await api.delete(`${API}/inquiries/faq/${id}`, { headers: admin() });
  await api.dispose();
});

async function ask(subject: string): Promise<number> {
  const api = await pwRequest.newContext();
  const r = await api.post(`${API}/inquiries`, { headers: artist(), data: { subject, content: `${subject} 내용입니다` } });
  if (!r.ok()) throw new Error(`문의 준비 실패 ${r.status()}: ${await r.text()}`);
  const { id } = await r.json();
  await api.dispose();
  return id;
}
async function answer(id: number, reply: string) {
  const api = await pwRequest.newContext();
  const r = await api.patch(`${API}/inquiries/${id}/reply`, { headers: admin(), data: { reply } });
  if (!r.ok()) throw new Error(`답변 준비 실패 ${r.status()}: ${await r.text()}`);
  await api.dispose();
}

async function openNotification(page: Page, text: string | RegExp) {
  await page.getByRole('button', { name: '알림', exact: true }).click();
  await page.getByRole('button', { name: text }).first().click();
}
const inView = (page: Page, id: number) => page.locator(`[data-inquiry="${id}"]`).evaluate((el) => {
  const r = el.getBoundingClientRect();
  return r.top >= 0 && r.top < innerHeight;
});
const settledUrl = (page: Page) => expect.poll(() => new URL(page.url()).search).toBe('');
async function open(browser: Browser, role: 'artist' | 'gallery' | 'admin', mobile = false) {
  const context = await browser.newContext({
    storageState: statePath(role),
    ...(mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false }),
  });
  return { context, page: await context.newPage() };
}

test('A. 작가가 문의 → 관리자 벨에서 그 문의로 → 답변 → 작가 벨에서 답변을 본다', async ({ browser }) => {
  const subject = `E2E 벨 문의 ${STAMP}`;
  const errors: string[] = [];

  const a = await open(browser, 'artist');
  a.page.on('pageerror', (e) => errors.push(e.message));
  await a.page.goto('/support');
  await a.page.getByRole('button', { name: '문의하기' }).click();
  await a.page.getByPlaceholder('문의 제목을 입력해주세요').fill(subject);
  await a.page.getByPlaceholder('문의 내용을 자세히 작성해주세요').fill('작품 사진이 안 올라가요');
  await a.page.getByRole('button', { name: '등록', exact: true }).click();
  await expect(a.page.getByText('문의가 등록되었습니다.')).toBeVisible();

  const b = await open(browser, 'admin');
  b.page.on('pageerror', (e) => errors.push(e.message));
  await b.page.goto('/');
  await openNotification(b.page, new RegExp(`새 1:1 문의가 등록되었습니다: "${subject}"`));
  await expect(b.page).toHaveURL(/\/support/);
  await expect(b.page.getByText('작품 사진이 안 올라가요')).toBeVisible();   // 눌러서 펼칠 필요 없이
  await settledUrl(b.page);
  const row = b.page.locator('[data-inquiry]', { hasText: subject });
  const id = Number(await row.getAttribute('data-inquiry'));
  await expect.poll(() => inView(b.page, id), 'FAQ 아래에 있어도 그 자리로 내려간다').toBe(true);

  await b.page.getByPlaceholder('답변을 입력해주세요').fill('파일 형식을 확인해 주세요');
  await b.page.getByRole('button', { name: '답변 등록' }).click();
  await expect(b.page.getByText('답변이 등록되었습니다.')).toBeVisible();

  await a.page.goto('/');
  await openNotification(a.page, new RegExp(`문의 "${subject}"에 답변이 등록되었습니다`));
  await expect(a.page).toHaveURL(/\/support/);
  await expect(a.page.getByText('파일 형식을 확인해 주세요')).toBeVisible();
  await expect.poll(() => inView(a.page, id)).toBe(true);

  expect(errors).toEqual([]);
  await a.context.close();
  await b.context.close();
});

test('B. 휴대폰 · 고객센터를 연 채로 — 옛 목록이 아니라 달린 답변이 보이고, 접어도 다시 열린다', async ({ browser }) => {
  const subject = `E2E 열어 둔 화면 ${STAMP}`;
  const id = await ask(subject);
  const a = await open(browser, 'artist', true);
  await a.page.goto('/support');
  const row = a.page.locator(`[data-inquiry="${id}"]`);
  await expect(row).toContainText('대기중');                  // 이 화면의 목록은 답변 전이다(캐시 5분)

  await answer(id, '열어 둔 화면에도 답변이 보입니다');
  await openNotification(a.page, new RegExp(`문의 "${subject}"에 답변이`));
  await expect(a.page.getByText('열어 둔 화면에도 답변이 보입니다')).toBeVisible();
  await expect(row).toContainText('답변완료');
  await settledUrl(a.page);
  await expect.poll(() => inView(a.page, id)).toBe(true);

  await row.getByRole('button', { name: new RegExp(subject) }).click();   // 접는다
  await expect(a.page.getByText('열어 둔 화면에도 답변이 보입니다')).toHaveCount(0);
  await openNotification(a.page, new RegExp(`문의 "${subject}"에 답변이`));
  await expect(a.page.getByText('열어 둔 화면에도 답변이 보입니다')).toBeVisible();
  await a.context.close();
});

test('C. 관리자가 답변완료 목록을 보던 중 — 새 문의 알림을 누르면 전체로 돌아가 연다', async ({ browser }) => {
  const b = await open(browser, 'admin');
  await b.page.goto('/support');
  await b.page.getByRole('button', { name: '답변완료' }).click();

  const subject = `E2E 필터 문의 ${STAMP}`;
  await ask(subject);
  await openNotification(b.page, new RegExp(`새 1:1 문의가 등록되었습니다: "${subject}"`));
  await expect(b.page.getByText(`${subject} 내용입니다`)).toBeVisible();
  await b.context.close();
});

test('D. 남의 문의 번호를 들고 와도 열리지 않고 주소만 정리된다', async ({ browser }) => {
  const id = await ask(`E2E 남의 문의 ${STAMP}`);
  const g = await open(browser, 'gallery');
  const errors: string[] = [];
  g.page.on('pageerror', (e) => errors.push(e.message));
  await g.page.goto(`/support?inquiry=${id}`);
  await settledUrl(g.page);
  await expect(g.page.getByText(`E2E 남의 문의 ${STAMP} 내용입니다`)).toHaveCount(0);
  expect(errors).toEqual([]);
  await g.context.close();
});
