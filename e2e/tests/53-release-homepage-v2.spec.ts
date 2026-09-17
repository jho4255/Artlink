import { test, expect, request as pwRequest, type Browser, type Page } from '@playwright/test';
import { openAs, tokenFor, userIds, settle, ownedGalleryId, ensurePublicArtworks, createExhibition } from '../lib/helpers';

/**
 * 2026-09-16 배포분(작가·갤러리 홈페이지 v2 · `/@핸들` · '일반' 역할 · 포트폴리오 버전)을 **눌러서** 본다.
 *
 * 단위·API 테스트는 있었지만 화면을 거치는 스펙이 하나도 없었다(2026-09-17 배포 전 점검). 그 점검에서
 * 실제로 나온 결함 셋도 여기에 고정한다:
 *  ① 예전에 PDF 용으로만 저장된 디자인이 공개 홈페이지에 그대로 입혀진다 → **직접 고른 뒤부터만**(webTheme)
 *  ② 홈페이지를 저장하기만 해도 웹 기본 키가 designConfig 에 써져 PDF 가 조용히 바뀐다 → **안 건드렸으면 안 보낸다**
 *  ③ PDF 제작 화면이 designConfig 를 통째로 갈아끼워 대표작·표식이 사라진다 → **들고 간다**
 *
 * ⚠️ 폼이 보내는 payload 를 가로채 확인한다 — 화면과 서버가 다른 이름을 쓰는 사고가 이 저장소에서 반복됐다(51번 스펙과 같은 방식).
 */
const API = 'http://localhost:4000/api';
const DESKTOP = { width: 1440, height: 900 };
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

/** 작가 홈페이지의 테마 뿌리(=`--hp-bg` 를 든 요소)의 실제 배경색 */
const themeBg = (page: Page) => page.evaluate(() => {
  const root = document.querySelector('h1')?.closest('[style*="--hp-bg"]') as HTMLElement | null;
  return root ? getComputedStyle(root).backgroundColor.replace(/\s/g, '') : null;
});

async function putPortfolio(patch: Record<string, unknown>) {
  const api = await pwRequest.newContext();
  const cur = await (await api.get(`${API}/portfolio`, { headers: auth(tokenFor('artist')) })).json();
  const r = await api.put(`${API}/portfolio`, { headers: auth(tokenFor('artist')), data: { ...cur, ...patch } });
  expect(r.ok(), `PUT /portfolio ${r.status()}`).toBe(true);
  await api.dispose();
}
async function savedDesign(): Promise<Record<string, unknown>> {
  const api = await pwRequest.newContext();
  const cur = await (await api.get(`${API}/portfolio`, { headers: auth(tokenFor('artist')) })).json();
  await api.dispose();
  return (cur.designConfig ?? {}) as Record<string, unknown>;
}

// 시드 작가는 작품이 0점이다 — 대표작·버전·테마 미리보기는 작품이 있어야 뜬다
test.beforeAll(async () => {
  const api = await pwRequest.newContext();
  await ensurePublicArtworks(api, tokenFor('artist'), 3);
  await api.dispose();
});

test.describe('주소 — /@핸들', () => {
  const HANDLE = `e2e.artist_${Date.now() % 100000}`;

  test('★ 핸들을 정하면 숫자 주소가 /@핸들 로 갈아끼워지고, 그 주소로 바로 열린다', async ({ page }) => {
    const api = await pwRequest.newContext();
    const r = await api.put(`${API}/auth/me/handle`, { headers: auth(tokenFor('artist')), data: { handle: HANDLE } });
    expect(r.ok(), `핸들 저장 ${r.status()}`).toBe(true);
    await api.dispose();

    const ids = userIds();
    await page.goto(`/portfolio/${ids.artist}?work=0`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15000 });
    // 숫자 주소는 죽지 않고 정식 주소로 바뀐다 — 쿼리는 지킨다
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 10000 }).toBe(`/@${HANDLE}`);
    expect(new URL(page.url()).search).toContain('work=');

    await page.goto(`/@${HANDLE}`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Artist 1', { timeout: 15000 });
  });

  test('★ 작가와 갤러리는 이름공간 하나를 나눠 쓴다 — 작가가 쓴 주소를 갤러리가 못 가져간다 (409)', async () => {
    const api = await pwRequest.newContext();
    const gid = await ownedGalleryId(api);
    const r = await api.put(`${API}/galleries/${gid}/handle`, { headers: auth(tokenFor('gallery')), data: { handle: HANDLE } });
    expect(r.status()).toBe(409);

    // 다른 이름이면 되고, 그 주소로 갤러리 페이지가 열린다
    const gh = `e2e.gallery_${Date.now() % 100000}`;
    const ok = await api.put(`${API}/galleries/${gid}/handle`, { headers: auth(tokenFor('gallery')), data: { handle: gh } });
    expect(ok.ok(), `갤러리 핸들 ${ok.status()}`).toBe(true);
    const resolved = await (await api.get(`${API}/handles/${gh}`)).json();
    expect(resolved).toMatchObject({ kind: 'gallery', id: gid });
    await api.dispose();
  });

  test('없는 핸들은 빈 화면이 아니라 안내가 뜬다', async ({ page }) => {
    await page.goto('/@no.such.handle.e2e');
    await expect(page.locator('body')).toContainText(/찾을 수 없|없는 페이지|존재하지/, { timeout: 15000 });
  });
});

test.describe('작가 홈페이지 테마 — 직접 고른 뒤부터 적용', () => {
  test('★ PDF 용으로만 저장돼 있던 어두운 디자인은 공개 홈페이지에 입혀지지 않는다', async ({ page }) => {
    // 이 기능 전에 PDF 제작 화면이 자동 저장하던 모양 그대로(표식 없음)
    await putPortfolio({ designConfig: { bg: 'ink', ink: 'cream', accent: 'gold', font: 'noto', page: 'a4-portrait', coverLayout: 'fullTint' } });
    await page.goto(`/portfolio/${userIds().artist}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15000 });
    // (숫자 주소 → /@핸들 로 갈아끼우는 동안 페이지가 한 번 다시 마운트된다 — 즉시 재지 말고 기다린다)
    await expect.poll(() => themeBg(page), { timeout: 10000, message: '작가가 고른 적 없는데 홈페이지가 어두워졌다' }).toBe('rgb(255,255,255)');
    // 잠깐 흰색이었다가 어두워지는 것도 아니다
    await settle(page, 800);
    expect(await themeBg(page)).toBe('rgb(255,255,255)');
  });

  test('★ 스타일을 안 건드리고 저장하면 designConfig 를 보내지 않는다 (PDF 설정을 덮지 않는다)', async ({ browser }) => {
    const before = await savedDesign();
    const { page, ctx } = await openAs(browser, 'artist');
    await page.setViewportSize(DESKTOP);
    await page.goto('/mypage?tab=homepage-edit');
    await expect(page.getByRole('button', { name: '저장' })).toBeVisible({ timeout: 15000 });

    const sent: Record<string, unknown>[] = [];
    page.on('request', (req) => {
      if (req.method() === 'PUT' && /\/api\/portfolio$/.test(new URL(req.url()).pathname)) sent.push(req.postDataJSON());
    });
    await page.getByPlaceholder(/동심의 이면|한 줄 소개/).first().fill(`스타일 안 건드림 ${Date.now()}`);
    await page.getByRole('button', { name: '저장' }).click();
    await expect.poll(() => sent.length, { timeout: 10000 }).toBeGreaterThan(0);
    expect('designConfig' in sent[0]!, 'designConfig 가 실려 나갔다 — 웹 기본값이 PDF 로 건너간다').toBe(false);
    expect(await savedDesign()).toEqual(before);
    await ctx.close();
  });

  test('★ 배경을 고르면 본 그대로 저장되고(네 값+표식), 공개 홈페이지에 적용된다', async ({ browser }) => {
    const { page, ctx } = await openAs(browser, 'artist');
    await page.setViewportSize(DESKTOP);
    await page.goto('/mypage?tab=homepage-edit');
    await expect(page.getByRole('button', { name: '저장' })).toBeVisible({ timeout: 15000 });

    await page.getByRole('button', { name: '아이보리', exact: true }).click();
    // 미리보기에 곧바로 — 저장 전이라 표식이 없어도 보여야 한다
    await expect.poll(() => themeBg(page), { timeout: 5000 }).toBe('rgb(250,247,240)');
    await page.getByRole('button', { name: '저장' }).click();
    await page.waitForURL(/\/(portfolio\/\d+|@)/, { timeout: 15000 });
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15000 });
    await expect.poll(() => themeBg(page), { timeout: 10000 }).toBe('rgb(250,247,240)');

    const d = await savedDesign();
    // 남아 있던 PDF 값(크림색 글자·노토)이 섞이지 않는다 — 미리보기에서 본 조합이 저장된다
    expect(d).toMatchObject({ bg: 'ivory', ink: 'black', accent: 'red', font: 'gothic', webTheme: true });
    // PDF 전용 키는 그대로
    expect(d.coverLayout).toBe('fullTint');
    await ctx.close();

    // 비로그인 방문자에게도 같은 얼굴
    const anon = await browser.newPage();
    await anon.goto(`/portfolio/${userIds().artist}`);
    await expect(anon.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15000 });
    await expect.poll(() => themeBg(anon), { timeout: 10000 }).toBe('rgb(250,247,240)');
    await anon.close();
  });

  test('★ PDF 제작 화면에서 디자인을 바꿔도 대표작·웹 테마 표식이 남는다', async ({ browser }) => {
    const api = await pwRequest.newContext();
    const cur = await (await api.get(`${API}/portfolio`, { headers: auth(tokenFor('artist')) })).json();
    await api.dispose();
    const heroId = cur.images?.[1]?.id as number | undefined;
    test.skip(!heroId, '작품이 2점 미만이라 대표작을 고를 수 없다');
    await putPortfolio({ designConfig: { ...(cur.designConfig ?? {}), webTheme: true, heroImageId: heroId } });

    const { page, ctx } = await openAs(browser, 'artist');
    await page.setViewportSize(DESKTOP);
    await page.goto('/mypage?tab=portfolio');
    const sent: Record<string, any>[] = [];
    page.on('request', (req) => {
      if (req.method() === 'PUT' && /\/api\/portfolio$/.test(new URL(req.url()).pathname)) sent.push(req.postDataJSON());
    });
    // [색 · 글꼴 · 판형] 을 펴고 배경을 하나 바꾼다 — 피커는 바꾸는 즉시 저장한다
    const sand = page.getByRole('button', { name: '샌드', exact: true }).first();
    if (!(await sand.isVisible().catch(() => false))) {
      await page.getByRole('button', { name: /색 · 글꼴 · 판형/ }).first().click({ timeout: 15000 });
    }
    await sand.click({ timeout: 10000 });
    await expect.poll(() => sent.length, { timeout: 10000 }).toBeGreaterThan(0);
    const dc = sent[sent.length - 1]!.designConfig;
    expect(dc.bg).toBe('sand');
    expect(dc.heroImageId, 'PDF 저장이 홈페이지 대표작을 지웠다').toBe(heroId);
    expect(dc.webTheme, 'PDF 저장이 웹 테마 표식을 지웠다').toBe(true);
    await settle(page, 500);
    expect(await savedDesign()).toMatchObject({ bg: 'sand', heroImageId: heroId, webTheme: true });
    await ctx.close();
  });
});

test.describe('작가 홈페이지 — 방문자', () => {
  test('★ 비로그인에게도 이웃·메시지가 보이고, 누르면 로그인으로 간다', async ({ page }) => {
    await page.goto(`/portfolio/${userIds().artist}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15000 });
    const msg = page.getByRole('button', { name: '메시지' }).first();
    await expect(msg).toBeVisible();
    await msg.click();
    await page.waitForURL(/\/login/, { timeout: 10000 });
  });
});

test.describe("'일반'(VISITOR) 역할", () => {
  /** 시드의 일반 계정으로 들어간 컨텍스트. dev-login 이 꺼진 환경이면 null */
  async function openVisitor(browser: Browser) {
    const api = await pwRequest.newContext();
    const r = await api.post(`${API}/auth/dev-login`, { data: { email: 'visitor@artlink.com' } });
    if (!r.ok()) { await api.dispose(); return null; }
    const { token, user } = await r.json();
    await api.dispose();
    const ctx = await browser.newContext({ viewport: DESKTOP });
    await ctx.addInitScript(([t, u]) => localStorage.setItem('artlink-auth',
      JSON.stringify({ state: { token: t, user: u, isAuthenticated: true }, version: 0 })), [token, user] as const);
    return { ctx, page: await ctx.newPage(), token: token as string };
  }

  test('★ 마이페이지에 제 메뉴만 뜨고, 이름 옆 역할은 한글 "일반"', async ({ browser }) => {
    const v = await openVisitor(browser);
    test.skip(!v, 'dev-login 이 꺼져 있다');
    await v!.page.goto('/mypage');
    await expect(v!.page.locator('body')).toContainText('일반', { timeout: 15000 });
    const side = v!.page.locator('aside, nav').filter({ hasText: 'MY PAGE' }).first();
    await expect(side).toContainText('찜 목록');
    // 작가·갤러리 전용 탭이 섞여 나오면 안 된다
    for (const no of ['포트폴리오', '내 갤러리', '내 공모']) await expect(side).not.toContainText(no);
    await v!.ctx.close();
  });

  test('★ 작가 전용 주소로 들어가도 빈 화면이 아니라 프로필로 떨어진다', async ({ browser }) => {
    const v = await openVisitor(browser);
    test.skip(!v, 'dev-login 이 꺼져 있다');
    await v!.page.goto('/mypage?tab=portfolio');
    await expect(v!.page.locator('main')).toContainText(/visitor@artlink\.com|일반 사용자/, { timeout: 15000 });
    await v!.ctx.close();
  });

  test('★ 지원·작품 등록은 서버가 403 으로 막고, 찜은 된다', async ({ browser }) => {
    const v = await openVisitor(browser);
    test.skip(!v, 'dev-login 이 꺼져 있다');
    const api = await pwRequest.newContext();
    const exId = await createExhibition(api, { title: `일반역할 공모 ${Date.now()}`, galleryId: await ownedGalleryId(api), approve: true });
    const ex = { id: exId };
    const apply = await api.post(`${API}/exhibitions/${ex.id}/apply`, { headers: auth(v!.token), data: {} });
    expect(apply.status()).toBe(403);
    const img = await api.post(`${API}/portfolio/images`, { headers: auth(v!.token), data: { url: '/uploads/x.jpg' } });
    expect(img.status()).toBe(403);
    const fav = await api.post(`${API}/favorites/toggle`, { headers: auth(v!.token), data: { exhibitionId: ex.id } });
    expect(fav.ok(), `찜 ${fav.status()}`).toBe(true);
    await api.dispose();
    await v!.ctx.close();
  });
});

test.describe('포트폴리오 버전', () => {
  test('★ [+ 버전] → 칩이 생기고, 새로고침해도 남는다', async ({ browser }) => {
    const { page, ctx } = await openAs(browser, 'artist');
    await page.setViewportSize(DESKTOP);
    await page.goto('/mypage?tab=portfolio');
    const add = page.getByRole('button', { name: /^\s*버전$/ }).first();
    await expect(add).toBeVisible({ timeout: 15000 });
    await add.click();
    await expect(page.getByRole('button', { name: /새 버전/ }).first()).toBeVisible({ timeout: 10000 });
    await page.reload();
    await expect(page.getByRole('button', { name: /새 버전/ }).first()).toBeVisible({ timeout: 15000 });

    // 홈페이지 작품 순서는 버전과 무관하다 — 버전을 만들어도 작품이 줄지 않는다
    const api = await pwRequest.newContext();
    const cur = await (await api.get(`${API}/portfolio`, { headers: auth(tokenFor('artist')) })).json();
    expect(cur.versions.length).toBeGreaterThan(0);
    expect(cur.versions[0].workIds.length).toBe(cur.images.length);
    await api.dispose();
    await ctx.close();
  });
});

test.describe('갤러리 홈페이지 — 지난 활동 기록', () => {
  test('★ 주인이 [+ 기록 추가]로 적으면 비로그인 방문자에게 보인다', async ({ browser }) => {
    const api = await pwRequest.newContext();
    const gid = await ownedGalleryId(api);
    await api.dispose();

    const title = `E2E 아트페어 ${Date.now()}`;
    const { page, ctx } = await openAs(browser, 'gallery');
    await page.setViewportSize(DESKTOP);
    await page.goto(`/galleries/${gid}`);
    await page.getByRole('button', { name: /기록 추가/ }).click({ timeout: 15000 });
    await page.getByPlaceholder('전시·행사 이름 *').fill(title);
    await page.getByPlaceholder(/^기간/).fill('2025 가을');
    await page.getByRole('button', { name: '저장', exact: true }).click();
    await expect(page.locator('body')).toContainText(title, { timeout: 10000 });
    await ctx.close();

    const anon = await browser.newPage();
    await anon.goto(`/galleries/${gid}`);
    await expect(anon.locator('body')).toContainText(title, { timeout: 15000 });
    await expect(anon.locator('body')).toContainText('2025 가을');
    // 방문자에게는 채우라는 자리·버튼이 보이지 않는다
    await expect(anon.getByRole('button', { name: /기록 추가/ })).toHaveCount(0);
    await anon.close();
  });
});
