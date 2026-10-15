import { test, expect, devices, request as pwRequest, type APIRequestContext, type Browser, type BrowserContextOptions, type CDPSession, type Page } from '@playwright/test';
import { customizePanel, editSectionTab, editorSave, makerBar, noNudgeEntry, openCustomize, openEditSection, openHomepageEditor, openPortfolioMaker, settle } from '../lib/helpers';

/**
 * 작가 요청·신고 (2026-10-15)
 *
 *  A. 작품 가격 — 작품 정보 창에 숫자(원)로 적고, 홈페이지([꾸미기])와 PDF([작품] 탭)를 **따로** 켠다. 둘 다 기본 꺼짐.
 *     켜기 전에는 공개 화면에도 공개 API 에도 가격이 없다. 판매 완료 작품은 켜도 빠진다.
 *  B. 작품 순서 — 끌어서 옮긴다. PC 마우스는 늘, 휴대폰 손가락은 [순서 바꾸기] 를 눌렀을 때만(길게 눌러).
 *     PDF [작품 고르기] 의 '실릴 순서' 줄도 끈다.
 *     놓는 순간 다른 칸이 출렁이지 않는다(놓은 순서를 그 프레임에 바로 그린다).
 *  C. 홈페이지 [포트폴리오] 탭의 PDF — PC 에서 쪽을 크게 놓고 화면 픽셀 = 캔버스 픽셀(보간 없음), 3배 화면에서 화면 해상도대로 그리고,
 *     손가락으로 확대하면 보이는 쪽을 다시 그린다.
 *  D. PDF 내려받기의 글자 밀림(김현수 작가 "작품 이름이 잘린다") — **앱 CSS 가 깔린 실제 화면**에서 html2canvas 로 그린 제목이
 *     크롬이 그린 제목과 같은 높이에 있다(고치기 전엔 17px 제목이 9px 아래로 밀려 칸 밖으로 잘렸다).
 *
 * ⚠️ 보이는지가 아니라 눌러서·끌어서 무슨 일이 나는지, 무엇이 서버에 갔는지를 본다.
 */
const API = 'http://localhost:4000/api';
const FE = 'http://localhost:5173';
const STAMP = Date.now();
const PC: BrowserContextOptions = { viewport: { width: 1440, height: 900 }, hasTouch: false, isMobile: false, deviceScaleFactor: 1 };

interface Seeded { id: number; name: string; token: string; user: Record<string, unknown> }
const auth = (a: Seeded) => ({ Authorization: `Bearer ${a.token}` });

async function signupArtist(api: APIRequestContext, key: string): Promise<Seeded> {
  const name = `요청${key}${String(STAMP).slice(-6)}`;
  const r = await api.post(`${API}/auth/signup`, {
    data: { name, email: `req-${key}-${STAMP}@e2e.test`, password: 'Request1!', role: 'ARTIST', agreeTerms: true, agreePrivacy: true },
  });
  if (!r.ok()) throw new Error(`작가 ${key} 준비 실패 ${r.status()}: ${await r.text()}`);
  const { token, user } = await r.json();
  return { id: user.id, name, token, user };
}
async function addWork(api: APIRequestContext, a: Seeded, meta: Record<string, unknown>, url = '/uploads/art1.png'): Promise<number> {
  await api.get(`${API}/portfolio`, { headers: auth(a) });
  const r = await api.post(`${API}/portfolio/images`, { headers: auth(a), data: { url, ...meta } });
  if (!r.ok()) throw new Error(`작품 추가 실패 ${r.status()}: ${await r.text()}`);
  return (await r.json()).id;
}
/** 이 테스트에 필요한 가격을 API 로 맞춰 둔다 — 앞 테스트에 기대지 않는다(실패 뒤 작업자가 새로 뜨면 계정도 새로 만들어진다) */
async function setPrice(a: Seeded, imageId: number, price: number | null) {
  const api = await pwRequest.newContext();
  const r = await api.patch(`${API}/portfolio/images/${imageId}`, { headers: auth(a), data: { price } });
  expect(r.ok(), `가격 준비 ${r.status()}`).toBe(true);
  await api.dispose();
}
async function openFor(browser: Browser, a: Seeded, extra: BrowserContextOptions = {}) {
  const ctx = await browser.newContext({
    ...extra,
    storageState: { cookies: [], origins: [{ origin: FE, localStorage: [{ name: 'artlink-auth', value: JSON.stringify({ state: { token: a.token, user: a.user, isAuthenticated: true }, version: 0 }) }, noNudgeEntry(a.user.id)] }] },
  });
  return { ctx, page: await ctx.newPage() };
}
const metaDialog = (page: Page) => page.getByRole('dialog', { name: '작품 정보' });
const tileOrder = (page: Page) => page.locator('[data-testid="works-grid"] [data-work-id]').evaluateAll((els) => els.map((e) => Number((e as HTMLElement).dataset.workId)));
const center = async (page: Page, selector: string) => {
  const b = (await page.locator(selector).boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};
/** 손가락으로 길게 눌렀다가(0.4초) 끌어 놓는다 — 크롬 터치 이벤트(CDP) 그대로 */
async function touchDrag(page: Page, cdp: CDPSession, from: { x: number; y: number }, to: { x: number; y: number }) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y }] });
  await page.waitForTimeout(450);
  for (let i = 1; i <= 12; i++) {
    const t = i / 12;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }] });
    await page.waitForTimeout(30);
  }
  await page.waitForTimeout(150);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

let pricer: Seeded, dragger: Seeded, toucher: Seeded, picker: Seeded, viewer: Seeded;
const W: Record<string, number> = {};

test.beforeAll(async () => {
  const api = await pwRequest.newContext();
  pricer = await signupArtist(api, 'price');
  W.avail = await addWork(api, pricer, { title: '가격 달빛', year: '2025', medium: 'Oil on canvas', status: 'AVAILABLE' });
  W.sold = await addWork(api, pricer, { title: '가격 팔린 그림', year: '2024', status: 'SOLD' }, '/uploads/art2.png');
  // 팔린 그림에도 가격이 적혀 있다 — 켜도 공개 화면엔 안 나와야 한다
  await api.patch(`${API}/portfolio/images/${W.sold}`, { headers: auth(pricer), data: { price: 3_300_000 } });

  dragger = await signupArtist(api, 'drag');
  for (const [i, k] of ['d1', 'd2', 'd3'].entries()) W[k] = await addWork(api, dragger, { title: `끌기 ${i + 1}`, year: '2025' }, `/uploads/art${i + 1}.png`);
  toucher = await signupArtist(api, 'touch');
  for (const [i, k] of ['t1', 't2', 't3'].entries()) W[k] = await addWork(api, toucher, { title: `손 ${i + 1}`, year: '2025' }, `/uploads/art${i + 1}.png`);
  picker = await signupArtist(api, 'pick');
  for (const [i, k] of ['p1', 'p2', 'p3'].entries()) W[k] = await addWork(api, picker, { title: `고르기 ${i + 1}`, year: '2025' }, `/uploads/art${i + 1}.png`);
  viewer = await signupArtist(api, 'view');
  await api.get(`${API}/portfolio`, { headers: auth(viewer) });
  await api.dispose();
});

test.describe('A. 작품 가격', () => {
  test('★ 작품 정보 창에 적으면 숫자로 저장된다 — 켜기 전엔 공개 홈페이지·공개 API 어디에도 없다', async ({ browser }) => {
    const { ctx, page } = await openFor(browser, pricer, PC);
    await openHomepageEditor(page);
    await page.getByRole('button', { name: '가격 달빛, 2025 — 작품 정보 수정' }).click();
    const dlg = metaDialog(page);
    await expect(dlg).toBeVisible();
    const price = dlg.locator('#meta-price');
    await price.fill('1200000');
    await expect(price).toHaveValue('1,200,000');   // 치는 대로 쉼표가 붙는다
    await expect(dlg.getByTestId('meta-price-note')).toContainText('지금은 어디에도 보이지 않아요');
    await expect(dlg.getByTestId('meta-price-preview')).toHaveCount(0);   // 홈페이지 가격이 꺼져 있으니 캡션 미리보기에도 없다

    const sent = page.waitForRequest((r) => r.method() === 'PATCH' && new URL(r.url()).pathname === `/api/portfolio/images/${W.avail}`);
    await dlg.getByRole('button', { name: '저장', exact: true }).click();
    expect((await sent).postDataJSON().price).toBe(1_200_000);
    await expect(dlg).toHaveCount(0);

    // 공개 API — 가격 글자 자체가 없다
    const api = await pwRequest.newContext();
    const pub = await (await api.get(`${API}/portfolio/${pricer.id}`)).json();
    expect(JSON.stringify(pub)).not.toContain('"price"');
    await api.dispose();
    // 방문자 화면에도 없다
    const visitor = await browser.newPage();
    await visitor.goto(`${FE}/portfolio/${pricer.id}`);
    await expect(visitor.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15000 });
    await expect(visitor.getByText('1,200,000원')).toHaveCount(0);
    await visitor.close();
    await ctx.close();
  });

  test('★ [꾸미기] 에서 켜고 저장하면 공개 홈페이지 작품 아래에 나온다 — 판매 완료 작품의 가격은 빠진다', async ({ browser }) => {
    await setPrice(pricer, W.avail, 1_200_000);
    const { ctx, page } = await openFor(browser, pricer, PC);
    await openHomepageEditor(page, '꾸미기');
    const toggle = page.getByTestId('show-price');
    await expect(toggle).not.toBeChecked();
    await toggle.check();
    // 오른쪽 미리보기에 곧바로 나온다(저장 전)
    await expect(page.getByLabel('홈페이지 미리보기').getByText('1,200,000원').first()).toBeVisible();   // 대표작·격자 두 군데
    const sent = page.waitForRequest((r) => r.method() === 'PUT' && new URL(r.url()).pathname === '/api/portfolio');
    await editorSave(page).click();
    expect((await sent).postDataJSON().showPrice).toBe(true);
    await expect(page).toHaveURL(/\/(portfolio\/\d+|@[a-z0-9._]+)/, { timeout: 15000 });
    await ctx.close();

    const visitor = await browser.newPage();
    await visitor.goto(`${FE}/portfolio/${pricer.id}`);
    await expect(visitor.getByText('1,200,000원').first()).toBeVisible({ timeout: 15000 });
    await expect(visitor.getByText('3,300,000원')).toHaveCount(0);
    await visitor.close();

    const api = await pwRequest.newContext();
    const pub = await (await api.get(`${API}/portfolio/${pricer.id}`)).json();
    const byId = new Map((pub.images as { id: number; price?: number }[]).map((i) => [i.id, i.price]));
    expect(byId.get(W.avail)).toBe(1_200_000);
    expect(byId.get(W.sold)).toBeUndefined();
    expect(JSON.stringify(pub)).not.toContain('3300000');
    await api.dispose();
  });

  test('★ PDF — [작품] 탭의 [작품 가격 싣기] 는 기본 꺼짐, 켜면 미리보기 캡션에 실린다', async ({ browser }) => {
    await setPrice(pricer, W.avail, 1_200_000);
    const { ctx, page } = await openFor(browser, pricer, PC);
    await openPortfolioMaker(page);
    await openCustomize(page, '작품');
    const box = customizePanel(page).getByRole('checkbox', { name: /작품 가격 싣기/ });
    await expect(box).not.toBeChecked();
    await expect(page.locator('[data-book-preview]')).not.toContainText('1,200,000원');
    await box.check();
    await expect(page.locator('[data-book-preview]')).toContainText('1,200,000원', { timeout: 10000 });
    await expect(page.locator('[data-book-preview]')).not.toContainText('3,300,000');
    await ctx.close();
  });

  test('20억 원을 넘는 가격은 저장 단추가 막히고 이유가 나온다', async ({ browser }) => {
    const { ctx, page } = await openFor(browser, pricer, PC);
    await openHomepageEditor(page);
    await page.getByRole('button', { name: '가격 달빛, 2025 — 작품 정보 수정' }).click();
    const dlg = metaDialog(page);
    await dlg.locator('#meta-price').fill('2000000001');
    await expect(dlg.getByTestId('meta-price-note')).toContainText('2,000,000,000원까지');
    await expect(dlg.getByRole('button', { name: '저장', exact: true })).toBeDisabled();
    await ctx.close();
  });
});

test.describe('B. 작품 순서 — 끌어서 옮기기', () => {
  test('★ PC — 사진을 끌어 놓으면 그 자리에 끼워지고 저장된다 · 그냥 누르면 작품 정보 창', async ({ browser }) => {
    const { ctx, page } = await openFor(browser, dragger, PC);
    await openHomepageEditor(page);
    expect(await tileOrder(page)).toEqual([W.d1, W.d2, W.d3]);

    const from = await center(page, `[data-work-id="${W.d3}"] button[aria-label$="작품 정보 수정"]`);
    const to = await center(page, `[data-work-id="${W.d1}"] button[aria-label$="작품 정보 수정"]`);
    const sent = page.waitForRequest((r) => r.method() === 'PUT' && new URL(r.url()).pathname === '/api/portfolio/images/order');
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 10, from.y, { steps: 3 });
    await page.mouse.move(to.x, to.y, { steps: 15 });
    await settle(page, 200);
    // 놓는 순간부터 프레임마다 칸 위치를 적는다 — "놓는 순간 다른 그림들이 흔들린다"(2026-10-15): 비켜 섰던 칸이
    // 원래 자리로 172px 되돌아갔다가 새 순서가 오면 다시 미끄러져 왔다. 칸마다 거친 위치가 둘(놓기 전·뒤)을 넘으면 출렁인 것이다
    await page.evaluate(() => {
      const w = window as unknown as { __frames: Record<string, number>[] };
      w.__frames = [];
      const t0 = performance.now();
      const tick = () => {
        const pos: Record<string, number> = {};
        document.querySelectorAll<HTMLElement>('[data-work-id]').forEach((e) => { pos[e.dataset.workId!] = Math.round(e.getBoundingClientRect().x); });
        w.__frames.push(pos);
        if (performance.now() - t0 < 700) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await page.mouse.up();
    expect((await sent).postDataJSON().ids).toEqual([W.d3, W.d1, W.d2]);   // 맞바꾸기가 아니라 끼워 넣기
    await settle(page, 800);
    const frames = await page.evaluate(() => (window as unknown as { __frames: Record<string, number>[] }).__frames);
    // 끌고 간 칸(자리표시)도 본다 — 칸이 셋뿐이면 그 칸만 튄다(실측 48 → -268 → … → 48)
    for (const id of [W.d1, W.d2, W.d3]) {
      const seen = new Set(frames.map((f) => f[String(id)]).filter((v) => v != null));
      expect(seen.size, `작품 ${id} 이 놓는 순간 ${[...seen].join('→')} 로 움직였다`).toBeLessThanOrEqual(2);
    }
    await settle(page, 400);
    await expect(metaDialog(page)).toHaveCount(0);                         // 끌고 놓은 건 '누르기' 가 아니다

    await page.reload();
    await expect(editSectionTab(page, '작품')).toHaveAttribute('aria-selected', 'true', { timeout: 15000 });
    expect(await tileOrder(page)).toEqual([W.d3, W.d1, W.d2]);
    // 움직이지 않고 누르면 예전처럼 작품 정보
    await page.locator(`[data-work-id="${W.d2}"] button[aria-label$="작품 정보 수정"]`).click();
    await expect(metaDialog(page)).toBeVisible();
    await ctx.close();
  });

  test('★ 휴대폰 — 평소엔 길게 눌러 끌어도 그대로, [순서 바꾸기] 를 누르면 길게 눌러 옮긴다', async ({ browser }) => {
    const { ctx, page } = await openFor(browser, toucher, { ...devices['Pixel 7'] });
    await openHomepageEditor(page);
    const cdp = await ctx.newCDPSession(page);
    const orders: string[] = [];
    page.on('request', (r) => { if (r.method() === 'PUT' && new URL(r.url()).pathname === '/api/portfolio/images/order') orders.push(r.postData() ?? ''); });
    const tile = (id: number) => `[data-work-id="${id}"] button[aria-label$="작품 정보 수정"]`;
    /** 격자 맨 위를 화면 위쪽에 — 두 줄(작품 셋)이 다 화면 안에 들어온다 */
    const gridIntoView = async () => {
      await page.evaluate(() => { const g = document.querySelector('[data-testid="works-grid"]')!; window.scrollTo(0, window.scrollY + g.getBoundingClientRect().top - 140); });
      await settle(page, 300);
    };

    await gridIntoView();
    await touchDrag(page, cdp, await center(page, tile(W.t3)), await center(page, tile(W.t1)));
    await settle(page, 800);
    expect(orders, '평소 화면에서 손가락으로 순서가 바뀌면 안 된다(격자를 훑다 바뀐다)').toEqual([]);
    expect(await tileOrder(page)).toEqual([W.t1, W.t2, W.t3]);
    if (await metaDialog(page).count()) await page.keyboard.press('Escape');

    await page.getByRole('button', { name: '순서 바꾸기' }).click();
    await gridIntoView();
    await touchDrag(page, cdp, await center(page, tile(W.t3)), await center(page, tile(W.t1)));
    await expect.poll(() => orders.length, { timeout: 5000 }).toBe(1);
    expect(JSON.parse(orders[0]!).ids).toEqual([W.t3, W.t1, W.t2]);
    await expect.poll(() => tileOrder(page)).toEqual([W.t3, W.t1, W.t2]);
    // ◀ ▶ 도 그대로 있다
    await expect(page.locator(`[data-work-id="${W.t3}"]`).getByRole('button', { name: '뒤로' })).toBeVisible();
    await ctx.close();
  });

  test('PDF [작품 고르기] — 실릴 순서 줄도 끌어서 옮긴다(PC)', async ({ browser }) => {
    const { ctx, page } = await openFor(browser, picker, PC);
    await openPortfolioMaker(page);
    await makerBar(page).getByRole('button', { name: /작품 고르기/ }).click();
    const dlg = page.getByRole('dialog', { name: '작품 고르기' });
    await expect(dlg).toBeVisible();
    const strip = dlg.getByTestId('picker-order');
    const order = () => strip.locator('[data-order-id]').evaluateAll((els) => els.map((e) => Number((e as HTMLElement).dataset.orderId)));
    expect(await order()).toEqual([W.p1, W.p2, W.p3]);
    const thumb = (id: number) => strip.locator(`[data-order-id="${id}"] > div`).first();
    const a = (await thumb(W.p3).boundingBox())!, b = (await thumb(W.p1).boundingBox())!;
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(a.x + a.width / 2 - 10, a.y + a.height / 2, { steps: 3 });
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 15 });
    await settle(page, 200);
    await page.mouse.up();
    await expect.poll(order).toEqual([W.p3, W.p1, W.p2]);
    // 번호가 실릴 순서를 따라간다
    await expect(strip.locator(`[data-order-id="${W.p3}"]`)).toContainText('1');
    await ctx.close();
  });
});

test.describe('C. 홈페이지 [포트폴리오] 탭 PDF', () => {
  /** 2쪽짜리 진짜 PDF 를 viewer 의 홈페이지 파일로(바이너리 픽스처를 저장소에 두지 않는다 — 54번과 같은 방식) */
  let uploaded = false;
  async function ensurePdf(browser: Browser) {
    if (uploaded) return;
    const maker = await browser.newPage();
    await maker.setContent('<div style="font:28px sans-serif">작은 글씨 포트폴리오 E2E</div><p style="font:12px sans-serif">본문 12pt 글자가 화면에서 읽히는 크기인가</p><div style="break-before:page;font:28px sans-serif">둘째 쪽</div>');
    const pdf = await maker.pdf({ format: 'A4' });
    await maker.close();
    const api = await pwRequest.newContext();
    const up = await api.post(`${API}/upload/file`, { headers: auth(viewer), multipart: { file: { name: 'e2e-zoom.pdf', mimeType: 'application/pdf', buffer: pdf } } });
    expect(up.ok(), `upload ${up.status()}`).toBe(true);
    const r = await api.put(`${API}/portfolio/file`, { headers: auth(viewer), data: { portfolioFileUrl: (await up.json()).url } });
    expect(r.ok()).toBe(true);
    await api.dispose();
    uploaded = true;
  }

  test('★ PC(윈도 노트북 1.25배) — 쪽을 크게(A4 세로 ≈1000px) 놓고, 화면에 찍힌 픽셀이 캔버스 픽셀 그대로다(보간 없음)', async ({ browser }) => {
    // 2026-10-15 "글자가 뭉개지고 흐리다": ①쪽이 640px 이라 10pt 본문이 7px ②캔버스가 상자보다 1px 작아 쪽 전체를 보간 ③1.25배에서 반 픽셀 위치
    await ensurePdf(browser);
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1.25 });
    const page = await ctx.newPage();
    await page.goto(`${FE}/portfolio/${viewer.id}?tab=file`);
    const canvas = page.locator('[data-pdf-page="1"] canvas');
    await expect.poll(() => canvas.evaluate((c: HTMLCanvasElement) => c.width).catch(() => 0), { timeout: 30000 }).toBeGreaterThan(0);
    await page.evaluate(() => window.scrollTo(0, 0));
    await canvas.evaluate((c) => window.scrollBy(0, c.getBoundingClientRect().top - 140));
    await page.waitForTimeout(500);
    const g = await canvas.evaluate((c: HTMLCanvasElement) => { const r = c.getBoundingClientRect(); return { cw: c.width, ch: c.height, w: r.width, h: r.height, x: r.x, y: r.y, d: devicePixelRatio }; });
    expect(g.w).toBeGreaterThan(900);                 // 예전엔 640
    expect(g.cw).toBe(Math.round(g.w * g.d));
    expect(Math.abs(g.w * g.d - g.cw)).toBeLessThan(0.01);   // 상자 폭 × 배율이 정수 — 캔버스와 1:1
    expect(Math.abs(g.h * g.d - g.ch)).toBeLessThan(0.01);
    // 화면에 찍힌 그림 = 캔버스 그림(가장 잘 맞는 정수 위치에서 평균 차이가 거의 0) — 반 픽셀 위치면 2 이상이었다
    const shot = (await page.screenshot()).toString('base64');
    const diff = await canvas.evaluate(async (c: HTMLCanvasElement, { shot, g }) => {
      const im = new Image(); im.src = `data:image/png;base64,${shot}`; await im.decode();
      const sc = document.createElement('canvas'); sc.width = im.naturalWidth; sc.height = im.naturalHeight;
      const sx = sc.getContext('2d')!; sx.drawImage(im, 0, 0);
      const cd = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      const y0 = Math.ceil(g.y * g.d) + 4, rows = 200, x0 = Math.ceil(g.x * g.d) + 4, cols = Math.min(600, c.width - 12);
      const sd = sx.getImageData(x0 - 3, y0 - 3, cols + 6, rows + 6).data, sw = cols + 6;
      let best = 1e9;
      for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++) {
        let sum = 0;
        for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x += 2) {
          const cy = y0 + y - Math.round(g.y * g.d) + oy, cx = x0 + x - Math.round(g.x * g.d) + ox;
          if (cy < 0 || cx < 0 || cy >= c.height || cx >= c.width) { sum += 255; continue; }
          const a = (cy * c.width + cx) * 4, b = ((y + 3) * sw + (x + 3)) * 4;
          sum += Math.abs(cd[a]! - sd[b]!);
        }
        best = Math.min(best, sum / (rows * cols / 2));
      }
      return best;
    }, { shot, g });
    expect(diff).toBeLessThan(0.5);
    await ctx.close();
  });

  test('★ 3배 화면 휴대폰에서 화면 해상도대로 그리고, 손가락으로 확대하면 보이는 쪽을 더 선명하게 다시 그린다', async ({ browser }) => {
    await ensurePdf(browser);
    const ctx = await browser.newContext({ ...devices['iPhone 13'] });   // 크롬 엔진 + 390×664 · 기기 배율 3
    const page = await ctx.newPage();
    await page.goto(`${FE}/portfolio/${viewer.id}?tab=file`);
    const canvas = page.locator('[data-pdf-page="1"] canvas');
    await expect.poll(() => canvas.evaluate((c: HTMLCanvasElement) => c.width).catch(() => 0), { timeout: 30000 }).toBeGreaterThan(0);
    const base = await canvas.evaluate((c: HTMLCanvasElement) => ({ w: c.width, css: c.getBoundingClientRect().width, dpr: devicePixelRatio, zoom: c.dataset.zoom }));
    expect(base.dpr).toBe(3);
    // 예전엔 2배로 묶여 0.67 이었다(3배 화면에서 1.5배 늘려 보였다)
    expect(base.w / (base.css * base.dpr)).toBeGreaterThan(0.97);
    expect(base.zoom).toBe('1');

    // 두 손가락으로 2배 확대한 상태 — 크롬의 합성 제스처(synthesizePinchGesture)는 헤드리스에서 확대가 일어나지 않아,
    // 손가락 확대와 같은 visualViewport(scale 2)를 만드는 페이지 배율 에뮬레이션을 쓴다. 멈추면 보이는 쪽만 2배로 다시 그린다
    const cdp = await ctx.newCDPSession(page);
    await page.locator('[data-pdf-page="1"]').scrollIntoViewIfNeeded();
    await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2 });
    await expect.poll(() => page.evaluate(() => window.visualViewport?.scale ?? 1), { timeout: 5000 }).toBeGreaterThan(1.5);
    await expect.poll(() => page.locator('[data-pdf-page] canvas[data-zoom="2"]').count(), { timeout: 15000 }).toBeGreaterThan(0);
    const zoomed = await page.locator('[data-pdf-page] canvas[data-zoom="2"]').first().evaluate((c: HTMLCanvasElement) => c.width);
    expect(zoomed).toBeGreaterThan(base.w * 1.9);
    // 확대한 쪽은 둘까지 — 보이지 않는 쪽까지 크게 그려 메모리를 쓰지 않는다
    expect(await page.locator('[data-pdf-page] canvas[data-zoom="2"]').count()).toBeLessThanOrEqual(2);
    // 다시 줄이면 평소 해상도로 돌아간다(메모리를 돌려준다)
    await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });
    await expect.poll(() => page.locator('[data-pdf-page] canvas[data-zoom="2"]').count(), { timeout: 15000 }).toBe(0);
    await ctx.close();
  });
});

test.describe('D. PDF 내려받기 — 글자 기준선(앱 CSS 위의 html2canvas)', () => {
  test('★ 앱 화면에서 html2canvas 로 그린 제목이 크롬이 그린 제목과 같은 높이다 — 칸 밖으로 밀려 잘리지 않는다', async ({ page }) => {
    await page.goto(`${FE}/`);
    await page.waitForLoadState('networkidle');
    // PDF 엔진의 '제목 한 줄' 칸과 같은 모양: 17px · 한 줄 자르기 · overflow:hidden
    await page.evaluate(() => {
      const box = document.createElement('div');
      box.id = 'e2e-baseline';
      box.style.cssText = 'position:fixed;left:0;top:0;width:420px;padding:16px;background:#fff;z-index:2147483647';
      box.innerHTML = '<div style="font-size:17px;font-weight:600;font-family:\'Pretendard Variable\',Pretendard,sans-serif;color:#000;display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;overflow:hidden">변화의 한 그루, 2026</div>';
      document.body.appendChild(box);
    });
    await page.evaluate(() => document.fonts.ready);
    const shot = (await page.locator('#e2e-baseline').screenshot()).toString('base64');
    const r = await page.evaluate(async (shot) => {
      // 앱이 쓰는 html2canvas 그대로(개발 서버가 node_modules 를 그대로 내준다)
      const { default: h2c } = await import(/* @vite-ignore */ '/node_modules/html2canvas/dist/html2canvas.esm.js');
      const el = document.getElementById('e2e-baseline')!;
      const scale = devicePixelRatio;
      const c = await h2c(el, { scale, backgroundColor: '#fff', logging: false });
      const inkTop = (cv: HTMLCanvasElement) => {
        const d = cv.getContext('2d')!.getImageData(0, 0, cv.width, cv.height).data;
        for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) { const k = (y * cv.width + x) * 4; if (d[k]! + d[k + 1]! + d[k + 2]! < 300) return y / scale; }
        return -1;
      };
      const im = new Image(); im.src = `data:image/png;base64,${shot}`; await im.decode();
      const sc = document.createElement('canvas'); sc.width = im.naturalWidth; sc.height = im.naturalHeight; sc.getContext('2d')!.drawImage(im, 0, 0);
      // 측정 그림(1px GIF)이 앱 CSS 에서 inline 인가 — Tailwind 의 img{display:block} 을 이겼는가
      const probe = document.createElement('img');
      probe.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
      document.body.appendChild(probe);
      const display = getComputedStyle(probe).display;
      probe.remove();
      return { chrome: inkTop(sc), pdf: inkTop(c), display };
    }, shot);
    expect(r.chrome).toBeGreaterThan(0);
    expect(r.pdf, `html2canvas 제목 윗선 ${r.pdf}px · 크롬 ${r.chrome}px`).toBeGreaterThan(0);
    expect(Math.abs(r.pdf - r.chrome), `html2canvas 제목 윗선 ${r.pdf}px · 크롬 ${r.chrome}px`).toBeLessThan(2.5);   // 고치기 전: 약 9px 아래로 밀렸다
    expect(r.display, '측정 그림이 Tailwind 의 img{display:block} 을 받았다').toBe('inline');
  });
});
