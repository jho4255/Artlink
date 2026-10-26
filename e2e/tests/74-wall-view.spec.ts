import { test, expect, request as pwRequest, type APIRequestContext, type Browser, type BrowserContextOptions, type Page } from '@playwright/test';
import { solidPng } from '../lib/helpers';

/**
 * 작가 홈페이지 작품 보기 — [사진 | 벽에 걸어 보기] (2026-10-22, CLAUDE.md 규칙 74). **눌러서 무슨 일이 나는가**를 본다.
 *
 * 미미오 작가 페이지의 [See More] 창(회색 벽 + 그림자)과 견줘 모자랐던 것을 채웠다 — 벽 그림은 ArtLook 엔진이 화면 밖 iframe
 * (`/artlook/index.html?view=1` + view.js)에서 그린다. 비회원(로그인 없이)으로 본다 — 작가 홈페이지의 주 방문자다.
 *
 *  A. 작품을 누르면 작품 창 — 원본 사진 · 캡션 두 줄(작품명, 연도 / 재료 · 크기) · ?work= · [공유](그 작품 주소)
 *  B. [벽에 걸어 보기] → 차콜 벽에 오크 플로터·넓은 매트로 건 그림 · **작품 방향대로 비율**(세로 4:5 · 가로 5:4 · 정사각 1:1 — 가로 캔버스에 세로 작품을 걸면 잘렸다)
 *  C. 벽에서 넘기면 다음 작품도 벽 · 닫으면 iframe 을 걷는다 · 다시 열면 벽으로 바로(이 탭에서 기억) · 사진으로 돌리면 기억을 지운다
 *  D. 사진만 보면 엔진을 띄우지 않는다 · 벽을 보면 벽 사진 1장 · 액자 사진은 오크 플로터 1장(2026-10-26 사진 액자) · 결 텍스처 0 · 방문자 브라우저에 artlook:* 를 남기지 않는다
 *  E. 엔진이 안 되는 브라우저(WebGL2 없음) — 안내 한 줄 · 토글이 사라지고 · 사진은 그대로 · 페이지 오류 0
 *  F. 엔진 준비가 실패하면(벽 목록을 못 받음) [다시 시도] — 다시 하면 벽이 뜬다 · 사진 화면은 멀쩡
 *  G. 빠르게 여러 번 넘겨도 지금 작품의 벽 그림이 뜬다(옛 그림이 이기지 않는다)
 *  H. PC — 썸네일 줄로 고르기 · ←/→ · Esc
 *
 * ⚠️ 기하(6화면 × 크롬·사파리 엔진)와 시간은 `scratchpad/wall-view/walk.mjs` 가 본다. 헤드리스는 GPU 가 없어 그리기가 느리다(1~2초).
 */
const API = 'http://localhost:4000/api';
const STAMP = Date.now();
const PC: BrowserContextOptions = { viewport: { width: 1280, height: 800 }, hasTouch: false, isMobile: false, deviceScaleFactor: 1 };

interface Seeded { id: number; token: string }
interface Work { id: number; title: string; ratio: string; rgb: [number, number, number] }
/** i 번째 작품의 단색 — 벽 그림 가운데가 이 색이면 작품이 실제로 걸려 있다 */
const workRgb = (i: number): [number, number, number] => [40 + i * 35, 90 + i * 10, 160 - i * 20];
let artist: Seeded;
const works: Work[] = [];

async function signupArtist(api: APIRequestContext): Promise<Seeded> {
  const r = await api.post(`${API}/auth/signup`, {
    data: { name: `벽걸이${String(STAMP).slice(-6)}`, email: `wall-${STAMP}@e2e.test`, password: 'WallView1!', role: 'ARTIST', agreeTerms: true, agreePrivacy: true },
  });
  if (!r.ok()) throw new Error(`작가 준비 실패 ${r.status()}: ${await r.text()}`);
  const { token, user } = await r.json();
  return { id: user.id, token };
}
/** 진짜로 올린다 — 썸네일(t800)이 생겨야 초안이 그 길로 간다 */
async function addWork(api: APIRequestContext, a: Seeded, i: number, w: number, h: number, meta: Record<string, string>) {
  const headers = { Authorization: `Bearer ${a.token}` };
  await api.get(`${API}/portfolio`, { headers });
  const up = await api.post(`${API}/upload/image`, {
    headers,
    multipart: { image: { name: `wall${i}.png`, mimeType: 'image/png', buffer: solidPng(w, h, workRgb(i)) } },
  });
  if (!up.ok()) throw new Error(`사진 올리기 실패 ${up.status()}`);
  const r = await api.post(`${API}/portfolio/images`, { headers, data: { url: (await up.json()).url, ...meta } });
  if (!r.ok()) throw new Error(`작품 추가 실패 ${r.status()}: ${await r.text()}`);
  return (await r.json()).id as number;
}

test.beforeAll(async () => {
  const api = await pwRequest.newContext();
  artist = await signupArtist(api);
  const specs: [number, number, string, string][] = [
    [480, 600, '세로 작품', '4:5'],
    [640, 480, '가로 작품', '5:4'],
    [520, 520, '정사각 작품', '1:1'],
    [500, 640, '네 번째 작품', '4:5'],
    [700, 500, '다섯 번째 작품', '5:4'],
  ];
  for (const [i, [w, h, title, ratio]] of specs.entries()) {
    const id = await addWork(api, artist, i, w, h, { title, year: '2024', medium: '캔버스에 유채', sizeText: `${Math.round(h / 10)} × ${Math.round(w / 10)} cm` });
    works.push({ id, title, ratio, rgb: workRgb(i) });
  }
  await api.dispose();
});

/** 비회원으로 연다 — 로그인 없이(작가 홈페이지의 주 방문자) */
async function openGuest(browser: Browser, extra: BrowserContextOptions = {}, prep?: (ctx: import('@playwright/test').BrowserContext) => Promise<void>) {
  const ctx = await browser.newContext(extra);
  if (prep) await prep(ctx);
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const requests: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
  await page.goto(`/portfolio/${artist.id}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 20000 });
  return { ctx, page, errors, requests };
}
const viewerOf = (page: Page) => page.getByRole('dialog', { name: /작품 보기/ });
async function openFirst(page: Page) {
  await page.locator('figure button.cursor-zoom-in').first().click();   // 대표작 = 첫 작품
  await expect(viewerOf(page)).toBeVisible();
  await expect(page.locator('[data-view="photo"]')).toBeVisible();
}
const wallToggle = (page: Page) => viewerOf(page).getByRole('group', { name: '보기 방식' }).getByRole('button', { name: '벽에 걸어 보기' });
const photoToggle = (page: Page) => viewerOf(page).getByRole('group', { name: '보기 방식' }).getByRole('button', { name: '사진' });
const workParam = (page: Page) => Number(new URL(page.url()).searchParams.get('work'));
/** 지금 작품의 벽 그림 — 원본으로 다시 그린 것까지 기다린다 */
async function wallFull(page: Page) {
  const img = page.locator('[data-view="wall"][data-quality="full"]');
  await expect(img).toBeVisible({ timeout: 40000 });
  return img;
}

test('A. 작품을 누르면 작품 창 — 원본 사진 · 캡션 두 줄 · ?work= · [공유]', async ({ browser }) => {
  const { ctx, page, errors } = await openGuest(browser);
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(page.url()).origin });
  await openFirst(page);
  const v = viewerOf(page);
  expect(workParam(page)).toBe(works[0]!.id);
  // 사진은 원본(t800 아님) · 모서리를 깎지 않는다
  const photo = page.locator('[data-view="photo"]');
  expect(await photo.getAttribute('src')).not.toMatch(/\/t800\//);
  expect(await photo.evaluate((el) => getComputedStyle(el).borderRadius)).toBe('0px');
  // 캡션 두 줄 — 미술관 라벨
  const cap = page.getByTestId('artwork-caption');
  await expect(cap.locator('p').nth(0)).toHaveText('세로 작품, 2024');
  await expect(cap.locator('p').nth(1)).toHaveText('캔버스에 유채 · 60 × 48 cm');
  // 캡션은 작품 바로 아래 가운데 — 화면 구석에 두었더니 "작품 정보가 안 보인다"고 했다(2026-10-22 로컬 확인)
  const pb = (await photo.boundingBox())!, cb = (await cap.boundingBox())!;
  expect(cb.y - (pb.y + pb.height)).toBeGreaterThanOrEqual(0);
  expect(cb.y - (pb.y + pb.height)).toBeLessThan(24);
  expect(Math.abs(cb.x + cb.width / 2 - (pb.x + pb.width / 2))).toBeLessThan(2);
  await expect(v.getByText(`1 / ${works.length}`)).toBeVisible();
  // 좋아요·공유는 한 벌만 — 휴대폰은 아래 줄
  await expect(v.getByRole('button', { name: '이 작품 공유' })).toHaveCount(1);
  expect((await v.getByRole('button', { name: '이 작품 공유' }).boundingBox())!.y).toBeGreaterThan(cb.y);
  // 공유 — 그 작품의 주소(헤드리스 리눅스엔 공유 창이 없어 링크를 복사한다)
  await v.getByRole('button', { name: '이 작품 공유' }).click();
  await expect(v.getByText('링크를 복사했어요')).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(new RegExp(`/portfolio/${artist.id}\\?work=${works[0]!.id}$`));
  // 넘기면 주소가 따라가고, 닫으면 work 를 뗀다
  await v.getByRole('button', { name: '다음 작품' }).click();
  await expect.poll(() => workParam(page)).toBe(works[1]!.id);
  await expect(cap.locator('p').nth(0)).toHaveText('가로 작품, 2024');
  await v.getByRole('button', { name: '닫기' }).click();
  await expect(v).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get('work')).toBeNull();
  expect(errors).toEqual([]);
  await ctx.close();
});

test('B. [벽에 걸어 보기] — 차콜 벽에 오크 플로터·넓은 매트 · 작품 방향대로 비율(세로 4:5 · 가로 5:4 · 정사각 1:1)', async ({ browser }) => {
  const { ctx, page, errors } = await openGuest(browser);
  await openFirst(page);
  const v = viewerOf(page);
  await wallToggle(page).click();
  await expect(wallToggle(page)).toHaveAttribute('aria-pressed', 'true');
  for (const [i, w] of works.slice(0, 3).entries()) {
    if (i > 0) await v.getByRole('button', { name: '다음 작품' }).click();
    await expect.poll(() => workParam(page)).toBe(w.id);
    const img = await wallFull(page);
    await expect(img).toHaveAttribute('alt', `${w.title} — 벽에 건 모습`);
    const [nw, nh] = await img.evaluate((el: HTMLImageElement) => [el.naturalWidth, el.naturalHeight]);
    const [a, b] = w.ratio.split(':').map(Number);
    expect(Math.abs(nw / nh - a! / b!), `${w.title}: ${nw}×${nh} 는 ${w.ratio} 여야`).toBeLessThan(0.01);
    expect(Math.max(nw, nh), '출력 긴 변 — 벽 사진 2,508px ÷ 1.6').toBeGreaterThanOrEqual(1500);
    // 가장자리는 벽 색(차콜 — 무채색 어두운 회색), 가운데는 작품 — 검은 바탕만 있거나 작품이 빠진 그림이 아니다
    const px3 = await img.evaluate((el: HTMLImageElement) => {
      const c = document.createElement('canvas'); c.width = el.naturalWidth; c.height = el.naturalHeight;
      const x = c.getContext('2d')!; x.drawImage(el, 0, 0);
      const px = (u: number, w2: number) => Array.from(x.getImageData(Math.round(u * c.width), Math.round(w2 * c.height), 1, 1).data.slice(0, 3));
      return { edge: [px(0.04, 0.5), px(0.5, 0.04), px(0.96, 0.5)], mid: px(0.5, 0.48) };
    });
    for (const [r, g, bl] of px3.edge) {
      expect(Math.min(r!, g!, bl!), `벽 색 ${px3.edge}`).toBeGreaterThan(30);
      expect(Math.max(r!, g!, bl!), `벽 색 ${px3.edge}`).toBeLessThan(130);
      expect(Math.max(r!, g!, bl!) - Math.min(r!, g!, bl!), `무채색 ${px3.edge}`).toBeLessThan(16);
    }
    // 가운데는 그 작품의 색이다 — 벽 명암·톤을 조금 받을 뿐(WebGL 을 잃으면 작품 없이 그림자만 남는다 — 그런 그림은 보내지 않는다)
    expect(Math.max(...px3.mid.map((v, k) => Math.abs(v - w.rgb[k]!))), `가운데 ${px3.mid} ↔ 작품 ${w.rgb}`).toBeLessThan(30);
  }
  expect(await page.locator('iframe[data-wall-view]').count()).toBe(1);
  expect(errors).toEqual([]);
  await ctx.close();
});

test('C. 벽에서 넘기면 다음도 벽 · 닫으면 iframe 을 걷는다 · 다시 열면 벽으로 바로 · 사진으로 돌리면 기억을 지운다', async ({ browser }) => {
  const { ctx, page, errors } = await openGuest(browser);
  await openFirst(page);
  const v = viewerOf(page);
  await wallToggle(page).click();
  await wallFull(page);
  expect(await page.evaluate(() => sessionStorage.getItem('artlink-artwork-view'))).toBe('wall');
  await v.getByRole('button', { name: '다음 작품' }).click();
  await expect(page.locator('[data-view="wall"]')).toBeVisible({ timeout: 40000 });
  await expect(page.locator('[data-view="wall"]')).toHaveAttribute('alt', `${works[1]!.title} — 벽에 건 모습`);
  await v.getByRole('button', { name: '닫기' }).click();
  await expect(v).toHaveCount(0);
  await expect(page.locator('iframe[data-wall-view]')).toHaveCount(0);
  // 다시 열면 벽으로 — 그려 둔 그림이라 엔진을 다시 띄우지 않고 바로 뜬다
  await page.locator('figure button.cursor-zoom-in').first().click();
  await expect(page.locator('[data-view="wall"]')).toBeVisible({ timeout: 3000 });
  await expect(wallToggle(page)).toHaveAttribute('aria-pressed', 'true');
  // 사진으로 돌리면 사진 · 기억을 지운다
  await photoToggle(page).click();
  await expect(page.locator('[data-view="photo"]')).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('artlink-artwork-view'))).toBeNull();
  expect(errors).toEqual([]);
  await ctx.close();
});

test('D. 사진만 보면 엔진을 띄우지 않는다 · 벽 사진 1장 · 오크 플로터 사진 1장 · 결 텍스처 0 · 방문자 브라우저에 artlook:* 없음', async ({ browser }) => {
  const { ctx, page, errors, requests } = await openGuest(browser);
  await openFirst(page);
  const v = viewerOf(page);
  await v.getByRole('button', { name: '다음 작품' }).click();
  await v.getByRole('button', { name: '다음 작품' }).click();
  await page.waitForTimeout(800);
  expect(requests.filter((u) => u.includes('/artlook/')), '사진만 봤는데 엔진을 받았다').toEqual([]);
  await expect(page.locator('iframe[data-wall-view]')).toHaveCount(0);

  await wallToggle(page).click();
  await wallFull(page);
  await page.waitForTimeout(1500);   // 이웃 미리 그리기까지
  const art = requests.filter((u) => u.includes('/artlook/'));
  expect(art.filter((u) => /\/walls\//.test(u)).map((u) => u.split('/').pop()), '벽 사진은 고른 한 장').toEqual(['wall21-charcoal.jpg']);
  // 2026-10-26 부터 오크 플로터는 사진 액자 — 그 사진 한 장만 받고, 코드 플로터의 결 텍스처는 받지 않는다
  expect(art.filter((u) => /frames\/photo\/[^/?]+\.png/.test(u)).map((u) => u.split('/').pop()!.split('?')[0]), '액자 사진은 오크 플로터 한 장').toEqual(['oak-floater.png']);
  expect(art.filter((u) => /frames\/frame-[a-z]+-texture\.jpg/.test(u)), '결 텍스처는 받지 않는다').toEqual([]);
  expect(art.some((u) => /\/view\.js/.test(u))).toBe(true);
  // iframe 이 같은 출처라 localStorage 를 나눠 쓴다 — 작품 목록·선택을 남기면 안 된다
  expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('artlook:')))).toEqual([]);
  // 초안은 t800, 원본은 원본으로 그린다
  const uploads = requests.filter((u) => /\/uploads\//.test(u));
  expect(uploads.some((u) => /\/uploads\/t800\//.test(u))).toBe(true);
  expect(errors).toEqual([]);
  await ctx.close();
});

test('E. 엔진이 안 되는 브라우저(WebGL2 없음) — 안내 한 줄 · 토글 사라짐 · 사진 그대로', async ({ browser }) => {
  const { ctx, page, errors } = await openGuest(browser, {}, async (c) => {
    // 모든 창(숨은 iframe 포함)에서 WebGL2 를 막는다 — 생성자는 남아 있어 토글은 보이고, 엔진이 '안 된다'고 답한다
    await c.addInitScript(() => {
      const orig = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
        if (type === 'webgl2') return null;
        return (orig as (...a: unknown[]) => RenderingContext | null).call(this, type, ...rest);
      } as typeof orig;
    });
  });
  await openFirst(page);
  const v = viewerOf(page);
  await wallToggle(page).click();
  await expect(v.getByText('이 브라우저에서는 벽에 걸어 볼 수 없어요')).toBeVisible({ timeout: 30000 });
  await expect(v.getByRole('group', { name: '보기 방식' })).toHaveCount(0);
  await expect(page.locator('[data-view="photo"]')).toBeVisible();
  await expect(page.locator('iframe[data-wall-view]')).toHaveCount(0);
  await v.getByRole('button', { name: '다음 작품' }).click();
  await expect(page.locator('[data-view="photo"]')).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page.locator('iframe[data-wall-view]'), '넘겨도 엔진을 다시 띄우지 않는다').toHaveCount(0);
  expect(errors).toEqual([]);
  await ctx.close();
});

test('F. 엔진 준비가 실패하면 [다시 시도] — 다시 하면 벽이 뜬다', async ({ browser }) => {
  const { ctx, page, errors } = await openGuest(browser);
  await ctx.route(/\/artlook\/scenes\/scenes\.json/, (r) => r.fulfill({ status: 500, body: '' }));
  await openFirst(page);
  const v = viewerOf(page);
  await wallToggle(page).click();
  await expect(v.getByText('벽에 걸지 못했어요')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('[data-view="wall-pending"]')).toBeVisible();   // 흐린 사진은 그대로
  await expect(wallToggle(page), '안 되는 브라우저가 아니다 — 토글은 남는다').toBeVisible();
  await ctx.unroute(/\/artlook\/scenes\/scenes\.json/);
  await v.getByRole('button', { name: '다시 시도' }).click();
  await wallFull(page);
  expect(errors).toEqual([]);
  await ctx.close();
});

test('G. 빠르게 여러 번 넘겨도 지금 작품의 벽 그림이 뜬다', async ({ browser }) => {
  const { ctx, page, errors } = await openGuest(browser);
  await openFirst(page);
  const v = viewerOf(page);
  await wallToggle(page).click();
  const next = v.getByRole('button', { name: '다음 작품' });
  for (let i = 0; i < 7; i++) await next.click();
  const id = works[7 % works.length]!.id;
  await expect.poll(() => workParam(page)).toBe(id);
  const title = works.find((w) => w.id === id)!.title;
  await expect(page.locator('[data-view="wall"]')).toHaveAttribute('alt', `${title} — 벽에 건 모습`, { timeout: 40000 });
  await expect(page.getByTestId('artwork-caption').locator('p').nth(0)).toHaveText(`${title}, 2024`);
  expect(errors).toEqual([]);
  await ctx.close();
});

test('H. PC — 썸네일 줄로 고르기 · ←/→ · Esc', async ({ browser }) => {
  const { ctx, page, errors } = await openGuest(browser, PC);
  await openFirst(page);
  const v = viewerOf(page);
  const strip = v.getByRole('group', { name: '작품 목록' });
  await expect(strip).toBeVisible();
  // PC 는 좋아요·공유가 위 줄(닫기 옆) — 작품이 그만큼 커진다
  expect((await v.getByRole('button', { name: '이 작품 공유' }).boundingBox())!.y).toBeLessThan(60);
  await expect(strip.getByRole('button')).toHaveCount(works.length);
  await strip.getByRole('button', { name: /3번째 작품/ }).click();
  await expect.poll(() => workParam(page)).toBe(works[2]!.id);
  await expect(strip.getByRole('button', { name: /3번째 작품/ })).toHaveAttribute('aria-current', 'true');
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => workParam(page)).toBe(works[3]!.id);
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => workParam(page)).toBe(works[1]!.id);
  await page.keyboard.press('Escape');
  await expect(v).toHaveCount(0);
  expect(errors).toEqual([]);
  await ctx.close();
});
