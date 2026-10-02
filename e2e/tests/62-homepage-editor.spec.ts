import { test, expect, request as pwRequest, type APIRequestContext, type Browser, type BrowserContextOptions, type Page } from '@playwright/test';
import { editSectionTab, editorSave, openEditSection, openHomepageEditor, settle, solidPng, PUBLIC_HOMEPAGE_URL } from '../lib/helpers';

/**
 * 작가 홈페이지 편집 화면 개편 (2026-10-02)
 *
 * 새 작가 계정으로 가입 직후부터 밟아 보니 — 첫 화면에 작품 올리기가 없고(업로드 칸이 화면 3~4장 아래),
 * 모바일에서는 [저장] 이 하단 탭바에 가려 있고, 약력을 안 쓰면 한 줄 소개조차 저장이 안 됐고,
 * 작품 정보는 한 점씩 창을 열었다 닫아야 했고, '비공개' 라 적힌 작품이 홈페이지엔 다 보였다.
 *
 *  A. 첫 화면 — 작품 0점 작가에게 [작품 사진 올리기] 가 화면 안에 있다. 그 앞에 입력칸이 없다.
 *  B. 올리기 → "방금 올린 N점을 [작가] 탭에도 소개할까요?" 한 번 묻는다 → 소개하면 작가 목록에 나온다.
 *  C. 작품 정보 — [저장하고 다음 작품] 으로 창을 닫지 않고 끝까지. 전에 쓴 재료·연도는 한 번 눌러 채운다.
 *  D. 저장 — 약력 없이도 된다 · 모바일에서 [저장] 이 눌린다(탭바에 안 가린다) · 고친 게 없으면 [저장] 이 없다.
 *  E. 길 — 완성도 줄·공개 페이지의 [수정]·빈 홈페이지의 [작품 올리기] 가 그 묶음으로 데려간다. [취소] 는 홈페이지로.
 *  F. 꾸미기 — 주소(@)를 여기서 정하고 [저장] 한 번에 글과 함께.
 *  G. 마이페이지의 완성도 안내는 [프로필] 탭의 **한 줄**뿐 — [포트폴리오]·[ArtLook] 탭 위에는 없다(로그인 팝업이 유도를 맡는다).
 *
 * ⚠️ 보이는지가 아니라 **눌러서 무슨 일이 나는지 · 무엇이 서버에 갔는지**를 본다.
 * ⚠️ 기하(가림·눌림)는 여기서 크롬으로 한 번 보고, 사파리 엔진·여러 화면은 `scratchpad/homepage-edit/walk.js` 가 잰다.
 */
const API = 'http://localhost:4000/api';
const FE = 'http://localhost:5173';
const STAMP = Date.now();
const DESKTOP = { width: 1440, height: 900 };

interface Seeded { id: number; name: string; email: string; token: string; user: Record<string, unknown> }
const auth = (a: Seeded) => ({ Authorization: `Bearer ${a.token}` });

async function signupArtist(api: APIRequestContext, key: string, slug: string): Promise<Seeded> {
  const name = `편집${key}${String(STAMP).slice(-6)}`;
  const email = `editor-${slug}-${STAMP}@e2e.test`;   // 이메일엔 한글을 못 쓴다
  const r = await api.post(`${API}/auth/signup`, {
    data: { name, email, password: 'EditorTest1!', role: 'ARTIST', agreeTerms: true, agreePrivacy: true },
  });
  if (!r.ok()) throw new Error(`작가 ${key} 준비 실패 ${r.status()}: ${await r.text()}`);
  const { token, user } = await r.json();
  return { id: user.id, name, email, token, user };
}
/** 작품 n 점(앞의 captioned 점만 정보가 있다) */
async function addWorks(api: APIRequestContext, a: Seeded, n: number, captioned = 0) {
  await api.get(`${API}/portfolio`, { headers: auth(a) });   // 없으면 만든다
  const ids: number[] = [];
  for (let i = 0; i < n; i++) {
    const meta = i < captioned ? { title: `이미 넣은 ${i + 1}`, medium: 'Oil on canvas', year: '2024' } : {};
    const r = await api.post(`${API}/portfolio/images`, { headers: auth(a), data: { url: `/uploads/art${(i % 3) + 1}.png`, ...meta } });
    if (!r.ok()) throw new Error(`작품 추가 실패 ${r.status()}: ${await r.text()}`);
    ids.push((await r.json()).id);
  }
  return ids;
}
const myPortfolio = async (api: APIRequestContext, a: Seeded) => (await api.get(`${API}/portfolio`, { headers: auth(a) })).json();
/**
 * 그 계정으로 로그인된 새 창 (세션 주입 — 로그인 팝업은 예약되지 않는다).
 * ⚠️ 뷰포트만 PC 로 넓혀도 **터치 기기 에뮬레이션은 그대로**다(이 프로젝트의 기본이 Pixel 7).
 *    마우스·키보드 화면이 필요하면 `extra` 로 `{ hasTouch: false, isMobile: false }` 를 넘긴다.
 */
async function openFor(browser: Browser, a: Seeded, viewport?: { width: number; height: number }, extra: BrowserContextOptions = {}) {
  const ctx = await browser.newContext({
    ...extra,
    storageState: { cookies: [], origins: [{ origin: FE, localStorage: [{ name: 'artlink-auth', value: JSON.stringify({ state: { token: a.token, user: a.user, isAuthenticated: true }, version: 0 }) }] }] },
  });
  const page = await ctx.newPage();
  if (viewport) await page.setViewportSize(viewport);
  return { ctx, page };
}
const shots = (n: number) => [
  { name: 'a.png', mimeType: 'image/png', buffer: solidPng(600, 400, [200, 60, 60]) },
  { name: 'b.png', mimeType: 'image/png', buffer: solidPng(400, 600, [60, 160, 60]) },
  { name: 'c.png', mimeType: 'image/png', buffer: solidPng(500, 500, [60, 60, 200]) },
].slice(0, n);
/** 그 버튼의 한가운데를 눌렀을 때 정말 그 버튼이 잡히는가 */
const hitsItself = (page: Page, selector: string) => page.evaluate((sel) => {
  const el = document.querySelector(sel);
  if (!el) return { found: false, hit: false, inView: false, covered: '' };
  const r = el.getBoundingClientRect();
  const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return {
    found: true,
    hit: !!top && (top === el || el.contains(top)),
    inView: r.top >= 0 && r.bottom <= window.innerHeight,
    covered: top && !(top === el || el.contains(top)) ? (top.textContent || '').trim().slice(0, 12) : '',
  };
}, selector);
const metaDialog = (page: Page) => page.getByRole('dialog', { name: '작품 정보' });
const completeness = (page: Page) => page.getByRole('region', { name: '홈페이지 완성도' });

let fresh: Seeded, uploader: Seeded, filler: Seeded, writer: Seeded, mover: Seeded, styler: Seeded, taken: Seeded;

test.beforeAll(async () => {
  const api = await pwRequest.newContext();
  fresh = await signupArtist(api, '새작가', 'fresh');          // 작품 0점
  uploader = await signupArtist(api, '올리기', 'upload');       // 작품 0점 → 화면에서 올린다
  filler = await signupArtist(api, '정보', 'fill');
  await addWorks(api, filler, 4, 1);                            // 4점 중 1점만 정보가 있다
  writer = await signupArtist(api, '글', 'write');
  await addWorks(api, writer, 3, 3);
  mover = await signupArtist(api, '길', 'move');
  await addWorks(api, mover, 3, 3);
  await api.put(`${API}/portfolio`, { headers: auth(mover), data: { biography: '홍익대학교 회화과 졸업', statement: '' } });
  styler = await signupArtist(api, '꾸밈', 'style');
  await addWorks(api, styler, 2, 2);
  taken = await signupArtist(api, '선점', 'taken');
  await api.put(`${API}/auth/me/handle`, { headers: auth(taken), data: { handle: `taken.${STAMP % 1000000}` } });
  await api.dispose();
});

test.describe('A. 첫 화면', () => {
  for (const vp of [null, DESKTOP] as const) {
    test(`★ 작품 0점 작가 — [작품 사진 올리기] 가 화면 안에 있고 그 앞에 입력칸이 없다 (${vp ? 'PC' : '모바일'})`, async ({ browser }) => {
      const { page, ctx } = await openFor(browser, fresh, vp ?? undefined);
      await openHomepageEditor(page);
      await expect(page.getByRole('heading', { name: '작품 사진을 올리면 홈페이지가 바로 생깁니다' })).toBeVisible();
      const up = page.getByRole('button', { name: '작품 사진 올리기' });
      await expect(up).toBeInViewport({ ratio: 1 });
      const h = await hitsItself(page, '[data-testid="works-upload"] button');
      expect(h.hit, `올리기 버튼 자리를 누르면 '${h.covered}' 가 잡힌다`).toBe(true);

      // 올리기 앞에 글 입력칸이 없다(예전엔 색·약력·작가노트·한 줄 소개·경력 5칸·파일이 먼저였다)
      const before = await page.evaluate(() => {
        const top = document.querySelector('[data-testid="works-upload"]')!.getBoundingClientRect().top;
        return [...document.querySelectorAll('main input:not([type=file]):not([type=hidden]), main textarea')]
          .filter((e) => (e as HTMLElement).offsetParent && e.getBoundingClientRect().top < top).length;
      });
      expect(before).toBe(0);
      // 저장할 것도 미리 볼 것도 없다 — 바가 없다. 프로필 카드(이메일)도 이 화면엔 없다
      await expect(page.locator('[data-save-bar]')).toHaveCount(0);
      await expect(page.locator('main')).not.toContainText(fresh.email);
      await ctx.close();
    });
  }
});

test.describe('B. 올리기와 [작가] 탭 소개', () => {
  test('★ 올리면 한 번 묻는다 → [작가 탭에도 소개] → 작가 목록에 나온다 (요청 한 번, 상태를 적어 보낸다)', async ({ browser }) => {
    const api = await pwRequest.newContext();
    const listed = async () => ((await (await api.get(`${API}/explore/artists`)).json()) as { id: number }[]).some((x) => x.id === uploader.id);
    expect(await listed()).toBe(false);

    const { page, ctx } = await openFor(browser, uploader);
    await openHomepageEditor(page);
    const puts: { ids: number[]; show: boolean }[] = [];
    const toggles: string[] = [];
    page.on('request', (req) => {
      const path = new URL(req.url()).pathname;
      if (req.method() === 'PUT' && path === '/api/portfolio/images/explore') puts.push(req.postDataJSON());
      if (req.method() === 'PATCH' && /\/api\/portfolio\/images\/\d+\/explore$/.test(path)) toggles.push(path);
    });

    await page.getByTestId('works-file-input').setInputFiles(shots(3));
    const grid = page.getByTestId('works-grid');
    await expect(grid.locator('li')).toHaveCount(3, { timeout: 30000 });
    // 올린 직후: 지금은 내 홈페이지에만 보인다는 걸 알리고, [작가] 탭에도 낼지 묻는다
    await expect(page.getByText('방금 올린 3점은 지금 내 홈페이지에만 보여요')).toBeVisible();
    await expect(grid.getByRole('button', { name: /내 홈페이지에만 보임/ })).toHaveCount(3);
    await expect(grid.locator('li').first()).toContainText('홈페이지에만');
    expect(await listed()).toBe(false);   // 묻기 전에 내보내지 않는다

    await page.getByRole('button', { name: '작가 탭에도 소개', exact: true }).click();
    await expect(grid.getByRole('button', { name: /작가 탭에도 소개 중/ })).toHaveCount(3);
    await expect(page.getByText('방금 올린')).toHaveCount(0);
    await expect.poll(listed, { timeout: 10000 }).toBe(true);
    expect(puts, '한 번의 요청으로 세 점을 함께').toHaveLength(1);
    expect(puts[0]!.show).toBe(true);
    expect(puts[0]!.ids).toHaveLength(3);
    expect(toggles, '토글(PATCH)을 N번 부르지 않는다 — 두 번 눌리면 거꾸로 꺼진다').toEqual([]);

    // 작품 하나만 다시 내 홈페이지에만 — 누를 때마다 원하는 상태를 적어 보낸다
    await grid.locator('li').first().getByRole('button', { name: /작가 탭에도 소개 중/ }).click();
    await expect(grid.locator('li').first().getByRole('button', { name: /내 홈페이지에만 보임/ })).toBeVisible();
    await expect.poll(() => puts.length).toBe(2);
    expect(puts[1]).toMatchObject({ show: false });
    expect(puts[1]!.ids).toHaveLength(1);
    const pf = await myPortfolio(api, uploader);
    expect((pf.images as { showInExplore: boolean }[]).map((i) => i.showInExplore)).toEqual([false, true, true]);

    // 올린 사진은 저장을 기다리지 않는다 — 새로고침해도 그대로다
    await page.reload();
    await expect(page.getByTestId('works-grid').locator('li')).toHaveCount(3, { timeout: 15000 });
    await api.dispose();
    await ctx.close();
  });

  test('[홈페이지에만 두기] 를 고르면 곧바로 "소개한 작품이 없어요" 를 다시 들이밀지 않는다', async ({ browser }) => {
    const api = await pwRequest.newContext();
    const a = await signupArtist(api, '안냄', 'keep');
    await api.dispose();
    const { page, ctx } = await openFor(browser, a);
    await openHomepageEditor(page);
    await page.getByTestId('works-file-input').setInputFiles(shots(1));
    await expect(page.getByText('방금 올린 1점은 지금 내 홈페이지에만 보여요')).toBeVisible({ timeout: 30000 });
    await page.getByRole('button', { name: '홈페이지에만 두기' }).click();
    await expect(page.getByText('방금 올린')).toHaveCount(0);
    await expect(page.getByText('[작가] 탭에 소개한 작품이 없어요')).toHaveCount(0);
    // 다음에 들어오면 알려 준다(고를 수 있다는 걸 잊지 않게) — 한 번에 켤 수 있다
    await page.reload();
    await expect(page.getByText('[작가] 탭에 소개한 작품이 없어요')).toBeVisible({ timeout: 15000 });
    await page.getByRole('button', { name: '모두 소개하기' }).click();
    await expect(page.getByTestId('works-grid').getByRole('button', { name: /작가 탭에도 소개 중/ })).toHaveCount(1);
    await ctx.close();
  });
});

test.describe('B2. 올리는 중에 묶음을 바꾼다', () => {
  test('★ 올리는 동안 [소개] 에 다녀와도 올리던 것이 이어진다 — "방금 올린 N점" 안내도, 쓰던 글도 남는다', async ({ browser }) => {
    const api = await pwRequest.newContext();
    const a = await signupArtist(api, '도중', 'mid');
    await api.dispose();
    const { page, ctx } = await openFor(browser, a);
    await openHomepageEditor(page);
    // 한 장에 1.5초씩 걸리게 한다 — 그 사이에 묶음을 바꾼다
    await page.route('**/api/upload/image', async (route) => { await new Promise((r) => setTimeout(r, 1500)); await route.continue(); });
    await page.getByTestId('works-file-input').setInputFiles(shots(2));
    await expect(page.getByRole('button', { name: /올리는 중/ })).toBeDisabled();

    await openEditSection(page, '소개');
    await page.getByLabel('한 줄 소개').fill('올리는 동안 쓴 글');
    await openEditSection(page, '작품');
    // 예전처럼 묶음을 떼어 냈다면: 돌아왔을 때 올리는 중 표시가 사라지고(버튼이 다시 눌린다) 끝나도 안내가 뜨지 않는다
    await expect(page.getByText('방금 올린 2점은 지금 내 홈페이지에만 보여요')).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId('works-grid').locator('li')).toHaveCount(2);
    await openEditSection(page, '소개');
    await expect(page.getByLabel('한 줄 소개')).toHaveValue('올리는 동안 쓴 글');
    await ctx.close();
  });
});

test.describe('C. 작품 정보를 이어서 넣는다', () => {
  test('★ [작품 정보 입력하기] → [저장하고 다음 작품] 으로 창을 닫지 않고 끝까지', async ({ browser }) => {
    const { page, ctx } = await openFor(browser, filler, DESKTOP);
    await openHomepageEditor(page);
    await expect(completeness(page)).toContainText('작품 정보');
    await expect(completeness(page).getByRole('button', { name: /작품 정보 채우기/ })).toContainText('1/4');
    // 정보 없는 작품이 남아 있으면 [작품] 탭에 ✓ 가 없다(바로 아래 할 일 줄과 다른 말을 하지 않는다)
    await expect(editSectionTab(page, '작품').getByLabel('채움')).toHaveCount(0);

    const patches: Record<string, unknown>[] = [];
    page.on('request', (req) => {
      if (req.method() === 'PATCH' && /\/api\/portfolio\/images\/\d+$/.test(new URL(req.url()).pathname)) patches.push(req.postDataJSON());
    });

    await page.getByRole('button', { name: /작품 3점에 정보가 없어요/ }).click();
    const dlg = metaDialog(page);
    await expect(dlg).toBeVisible();
    await expect(dlg.getByTestId('meta-remaining')).toContainText('정보 없는 작품 2점');
    // 넣는 대로 홈페이지 캡션이 보인다 — 칸 순서도 캡션 순서(작품명 · 연도 · 재료 · 크기)
    await dlg.getByLabel('작품명').fill('머무는 빛');
    await dlg.getByLabel('제작연도').fill('2025');
    await dlg.getByLabel('재료').fill('캔버스에 유채');
    await dlg.getByLabel('세로', { exact: true }).fill('72.7');
    await dlg.getByLabel('가로', { exact: true }).fill('60.6');
    await expect(dlg.getByTestId('meta-caption-preview')).toContainText('머무는 빛, 2025');
    await expect(dlg.getByTestId('meta-caption-preview')).toContainText('72.7×60.6 cm');

    await dlg.getByRole('button', { name: '저장하고 다음 작품' }).click();
    // 창이 닫히지 않고 다음 작품으로 넘어간다 — 폼은 비고, 남은 수가 준다
    await expect(dlg.getByTestId('meta-remaining')).toContainText('정보 없는 작품 1점');
    await expect(dlg).toBeVisible();
    await expect(dlg.getByLabel('작품명')).toHaveValue('');
    // 전에 쓴 값 — 한 번 눌러 채운다(이미 정보가 있던 작품의 값도 나온다)
    await dlg.getByRole('button', { name: '캔버스에 유채', exact: true }).click();
    await expect(dlg.getByLabel('재료')).toHaveValue('캔버스에 유채');
    await dlg.getByRole('button', { name: '2025', exact: true }).click();
    await dlg.getByLabel('작품명').fill('오후 네 시');
    // Enter 는 저장이 아니라 **다음 칸** — 작품명만 치고 Enter 를 눌러도 다음 작품으로 넘어가지 않는다
    await dlg.getByLabel('작품명').press('Enter');
    await expect(dlg.getByLabel('제작연도')).toBeFocused();
    await expect(dlg.getByLabel('작품명')).toHaveValue('오후 네 시');
    await expect(dlg.getByTestId('meta-remaining')).toContainText('정보 없는 작품 1점');
    expect(patches, 'Enter 로 저장되면 안 된다').toHaveLength(1);
    // Ctrl+Enter 는 어느 칸에서든 주 버튼(저장하고 다음 작품)
    await dlg.getByLabel('제작연도').press('Control+Enter');

    // 마지막 작품 — 더 넘어갈 곳이 없으니 [저장] 하나뿐
    await expect(dlg.getByTestId('meta-remaining')).toHaveCount(0);
    await expect(dlg.getByRole('button', { name: '저장하고 다음 작품' })).toHaveCount(0);
    await dlg.getByLabel('작품명').fill('남은 자리');
    await dlg.getByRole('button', { name: '저장', exact: true }).click();
    await expect(dlg).toHaveCount(0);

    expect(patches.map((p) => p.title)).toEqual(['머무는 빛', '오후 네 시', '남은 자리']);
    expect(patches[0]).toMatchObject({ year: '2025', medium: '캔버스에 유채', sizeText: '72.7×60.6 cm' });
    expect(patches[1]).toMatchObject({ year: '2025', medium: '캔버스에 유채' });
    // 화면: 할 일 줄과 완성도의 '작품 정보' 가 사라지고, 칸 아래에 캡션 첫 줄이 놓이고, [작품] 탭에 ✓
    await expect(page.getByRole('button', { name: /에 정보가 없어요/ })).toHaveCount(0);
    await expect(completeness(page).getByRole('button', { name: /작품 정보 채우기/ })).toHaveCount(0);
    await expect(page.getByTestId('works-grid')).toContainText('머무는 빛, 2025');
    await expect(page.getByTestId('works-grid')).not.toContainText('작품 정보 입력');
    await expect(editSectionTab(page, '작품').getByLabel('채움')).toBeVisible();
    // 미리보기(공개 페이지와 같은 컴포넌트)에도 캡션이 붙었다
    await expect(page.getByRole('complementary', { name: '홈페이지 미리보기' })).toContainText('머무는 빛, 2025');
    await ctx.close();
  });
});

test.describe('C2. 작품 정보 창의 Enter', () => {
  test('★ Enter 는 다음 칸 — 마지막 칸(가로)에서만 주 버튼이고, 휴대폰에서는 자판만 내린다', async ({ browser }) => {
    const api = await pwRequest.newContext();
    const a = await signupArtist(api, '엔터', 'enter');
    await addWorks(api, a, 2, 0);
    const titles = async () => ((await myPortfolio(api, a)).images as { title: string | null }[]).map((i) => i.title ?? '');
    const walk = async (page: Page) => {
      const dlg = metaDialog(page);
      for (const next of ['제작연도', '재료', '세로', '가로']) {
        await page.keyboard.press('Enter');
        await expect(dlg.getByLabel(next, { exact: true })).toBeFocused();
      }
    };

    // ── 휴대폰(터치): 숫자 자판의 [완료] 는 자판을 내리는 키다 — 저장하지도, 다음 작품으로 넘어가지도 않는다 ──
    const m = await openFor(browser, a);
    await openHomepageEditor(m.page);
    await m.page.getByRole('button', { name: /작품 2점에 정보가 없어요/ }).click();
    const mDlg = metaDialog(m.page);
    await expect(mDlg).toBeVisible();
    // 처음 열 때 휴대폰에서는 커서를 두지 않는다(자판이 사진·캡션을 가린다)
    expect(await m.page.evaluate(() => document.activeElement?.id ?? '')).not.toBe('meta-title');
    await mDlg.getByLabel('작품명').fill('터치로 넣는 중');
    await walk(m.page);
    await m.page.keyboard.press('Enter');
    await expect(mDlg.getByLabel('가로', { exact: true })).not.toBeFocused();
    await expect(mDlg.getByLabel('작품명')).toHaveValue('터치로 넣는 중');   // 같은 작품 그대로
    await settle(m.page, 400);
    expect(await titles(), '휴대폰에서 Enter 로 저장됐다').toEqual(['', '']);
    await m.ctx.close();

    // ── PC(마우스·키보드): 칸 → 칸으로 가다가 마지막 칸의 Enter 가 [저장하고 다음 작품] ──
    const d = await openFor(browser, a, DESKTOP, { hasTouch: false, isMobile: false });
    await openHomepageEditor(d.page);
    await d.page.getByRole('button', { name: /작품 2점에 정보가 없어요/ }).click();
    const dDlg = metaDialog(d.page);
    await expect(dDlg.getByLabel('작품명')).toBeFocused();   // PC 는 열자마자 작품명에 커서
    await d.page.keyboard.type('키보드로만');
    await walk(d.page);
    expect(await titles(), '칸을 옮기는 Enter 로 저장됐다').toEqual(['', '']);
    await d.page.keyboard.press('Enter');
    // 저장되고, 창은 닫히지 않은 채 다음 작품(마지막 한 점)으로 넘어간다
    await expect.poll(titles, { timeout: 10000 }).toEqual(['키보드로만', '']);
    await expect(dDlg.getByLabel('작품명')).toHaveValue('');
    await expect(dDlg.getByLabel('작품명')).toBeFocused();
    await expect(dDlg.getByRole('button', { name: '저장하고 다음 작품' })).toHaveCount(0);
    await api.dispose();
    await d.ctx.close();
  });
});

test.describe('D. 저장', () => {
  test('★ 약력 없이 한 줄 소개만 저장된다 — 고친 게 없으면 [저장] 이 없다', async ({ browser }) => {
    const { page, ctx } = await openFor(browser, writer, DESKTOP);
    await openHomepageEditor(page, '소개');
    await expect(editorSave(page)).toHaveCount(0);
    await expect(page.locator('[data-save-bar]').getByRole('button', { name: '내 홈페이지 보기' })).toBeVisible();
    await expect(page.locator('[data-save-bar]')).toContainText('사진·작품 정보는 올리는 즉시 저장됩니다');

    const tagline = `빛이 머무는 자리 ${STAMP}`;
    await page.getByLabel('한 줄 소개').fill(tagline);
    await editorSave(page).click();
    // 예전엔 여기서 "작가 약력을 입력해주세요" 로 막혔다
    await page.waitForURL(PUBLIC_HOMEPAGE_URL, { timeout: 15000 });
    await expect(page.locator('body')).not.toContainText('작가 약력을 입력해주세요');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15000 });
    await expect(page.locator('main')).toContainText(tagline);
    await ctx.close();
  });

  test('★ 모바일 — [저장] 자리를 누르면 저장 버튼이 잡힌다(하단 탭바에 가리지 않는다)', async ({ browser }) => {
    const { page, ctx } = await openFor(browser, writer);   // 기본 뷰포트 = 모바일
    await openHomepageEditor(page, '약력');
    await page.getByPlaceholder('작가 소개·약력을 입력하세요.').fill('홍익대학교 회화과 졸업');
    await expect(editorSave(page)).toBeVisible();

    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    for (const [where, y] of [['맨 위', 0], ['가운데', Math.round(height / 2)], ['맨 끝', height]] as const) {
      await page.evaluate((yy) => window.scrollTo(0, yy), y);
      await settle(page, 300);
      const h = await hitsItself(page, '[data-save-bar] button.bg-gray-900');
      expect(h.found && h.inView, `${where}: 저장 버튼이 화면 밖이다`).toBe(true);
      expect(h.hit, `${where}: 저장 버튼 자리를 누르면 '${h.covered}' 가 잡힌다`).toBe(true);
    }
    // 좁은 화면의 미리보기는 저장 바의 [미리보기] — 저장하기 전 내용이 보인다
    await page.locator('[data-save-bar]').getByRole('button', { name: '미리보기' }).click();
    const sheet = page.getByTestId('preview-sheet');
    await expect(sheet.getByRole('heading', { level: 1 })).toContainText(writer.name);
    await expect(sheet).toContainText('홍익대학교 회화과 졸업');
    await sheet.getByRole('button', { name: '미리보기 닫기' }).click();
    await expect(sheet).toHaveCount(0);

    await editorSave(page).click();
    await page.waitForURL(PUBLIC_HOMEPAGE_URL, { timeout: 15000 });
    await expect(page).toHaveURL(/[?&]tab=cv/);   // 고치던 묶음의 탭으로
    await expect(page.locator('main')).toContainText('홍익대학교 회화과 졸업');
    await ctx.close();
  });
});

test.describe('E. 길', () => {
  test('★ 완성도 줄의 [작가노트] → [소개] 묶음, 그 칸에 커서 — 쓰던 글이 있어도 묻지 않는다', async ({ browser }) => {
    const { page, ctx } = await openFor(browser, mover, DESKTOP);
    let dialogs = 0;
    page.on('dialog', (d) => { dialogs += 1; d.dismiss(); });
    await openHomepageEditor(page, '약력');
    await page.getByPlaceholder('작가 소개·약력을 입력하세요.').fill('고치는 중인 약력');
    await completeness(page).getByRole('button', { name: /작가노트 쓰기/ }).click();
    await expect(editSectionTab(page, '소개')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByLabel('작가노트', { exact: true })).toBeFocused();   // 완성도 칩(이름 '작가노트 쓰기')과 구분
    expect(dialogs, '묶음만 바꾸는데 이탈 경고가 떴다').toBe(0);
    // 쓰던 약력은 그대로 남아 있다
    await openEditSection(page, '약력');
    await expect(page.getByPlaceholder('작가 소개·약력을 입력하세요.')).toHaveValue('고치는 중인 약력');
    await ctx.close();
  });

  test('★ [취소] → 확인 → 공개 홈페이지. 옛 "읽기 화면" 은 없다', async ({ browser }) => {
    const { page, ctx } = await openFor(browser, mover, DESKTOP);
    await openHomepageEditor(page, '소개');
    await page.getByLabel('한 줄 소개').fill('저장하지 않을 글');
    await page.locator('[data-save-bar]').getByRole('button', { name: '취소' }).click();
    const confirm = page.getByRole('dialog', { name: '저장하지 않고 나갈까요?' });
    await expect(confirm).toContainText('올린 사진과 작품 정보는 이미 저장되어 있어요');
    await confirm.getByRole('button', { name: '계속 편집' }).click();
    await expect(page.getByLabel('한 줄 소개')).toHaveValue('저장하지 않을 글');   // 그대로 남는다

    await page.locator('[data-save-bar]').getByRole('button', { name: '취소' }).click();
    await confirm.getByRole('button', { name: '저장하지 않고 나가기' }).click();
    await page.waitForURL(PUBLIC_HOMEPAGE_URL, { timeout: 15000 });
    await expect(page.locator('main')).not.toContainText('저장하지 않을 글');
    await expect(page.locator('body')).not.toContainText('등록된 작가노트가 없습니다');
    await ctx.close();
  });

  test('★ 공개 홈페이지 [약력] 탭의 [수정] 은 편집 화면의 [약력] 묶음을 연다', async ({ browser }) => {
    const { page, ctx } = await openFor(browser, mover, DESKTOP);
    await page.goto(`/portfolio/${mover.id}?tab=cv`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15000 });
    await page.getByRole('link', { name: '수정' }).click();
    await expect(editSectionTab(page, '약력')).toHaveAttribute('aria-selected', 'true', { timeout: 15000 });
    await expect(page.getByPlaceholder('작가 소개·약력을 입력하세요.')).toHaveValue('홍익대학교 회화과 졸업');
    await ctx.close();
  });

  test('★ 빈 홈페이지 — 주인에겐 [작품 올리기], 방문자에겐 준비 중', async ({ browser, page }) => {
    const owner = await openFor(browser, fresh, DESKTOP);
    await owner.page.goto(`/portfolio/${fresh.id}`);
    await expect(owner.page.getByText('작품 사진을 올리면 홈페이지가 바로 생깁니다.')).toBeVisible({ timeout: 15000 });
    await owner.page.getByRole('link', { name: '작품 올리기' }).click();
    await expect(editSectionTab(owner.page, '작품')).toHaveAttribute('aria-selected', 'true', { timeout: 15000 });
    await expect(owner.page.getByRole('button', { name: '작품 사진 올리기' })).toBeVisible();
    await owner.ctx.close();

    await page.goto(`/portfolio/${fresh.id}`);
    await expect(page.getByText('아직 준비 중인 홈페이지입니다.')).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('link', { name: '작품 올리기' })).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText('포트폴리오가 등록되지');
  });
});

test.describe('F. 꾸미기 — 주소(@)', () => {
  test('★ 이미 쓰는 주소면 저장이 멈추고 그 칸에 사유가 뜬다 · 쓸 수 있는 주소로 고치면 글과 함께 저장된다', async ({ browser }) => {
    const api = await pwRequest.newContext();
    const takenHandle = `taken.${STAMP % 1000000}`;
    const mine = `mine.${STAMP % 1000000}`;
    const { page, ctx } = await openFor(browser, styler, DESKTOP);
    await openHomepageEditor(page, '소개');
    const tagline = `주소와 함께 ${STAMP}`;
    await page.getByLabel('한 줄 소개').fill(tagline);

    await openEditSection(page, '꾸미기');
    await page.getByLabel('홈페이지 주소').fill(takenHandle);
    await editorSave(page).click();
    // 저장이 멈춘다 — 여전히 편집 화면이고, 글도 저장되지 않았다
    await expect(page.locator('main').getByText('이미 사용 중인 주소입니다.')).toBeVisible();
    await expect(page).toHaveURL(/tab=homepage-edit/);
    expect((await myPortfolio(api, styler)).tagline ?? null).toBeNull();

    await page.getByLabel('홈페이지 주소').fill(mine);
    await page.getByRole('button', { name: '중복확인' }).click();
    await expect(page.getByText('쓸 수 있는 주소입니다.')).toBeVisible();
    await editorSave(page).click();
    await page.waitForURL(new RegExp(`/@${mine.replace('.', '\\.')}$`), { timeout: 15000 });
    await expect(page.locator('main')).toContainText(tagline);
    expect((await myPortfolio(api, styler)).tagline).toBe(tagline);
    await api.dispose();
    await ctx.close();
  });

  test('프로필 탭의 홈페이지 주소도 같은 칸이다 — 중복확인 뒤 [주소 저장]', async ({ browser }) => {
    const handle = `prof.${STAMP % 1000000}`;
    const { page, ctx } = await openFor(browser, mover, DESKTOP);
    await page.goto('/mypage');
    await page.getByLabel('홈페이지 주소').fill(handle);
    await page.getByRole('button', { name: '중복확인' }).last().click();
    await expect(page.getByText('쓸 수 있는 주소입니다.')).toBeVisible();
    await page.getByRole('button', { name: '주소 저장' }).click();
    await expect(page.locator('body')).toContainText('홈페이지 주소가 저장되었습니다.');
    await expect(page.locator('main')).toContainText(`artlink.cc/@${handle}`);
    await ctx.close();
  });
});

test.describe('G. 완성도 안내는 [프로필] 탭의 한 줄뿐', () => {
  // 예전엔 '홈페이지 완성도' 상자(진행 막대 + 5칸 목록)가 프로필·포트폴리오·ArtLook 세 탭 위에 붙어 있었다.
  // 로그인 팝업과 같은 말을 두 번 했고, PDF 를 만들러 온 [포트폴리오] 탭에서는 본 내용을 밀어냈다(2026-10-02 사용자 지적).
  test('★ [포트폴리오]·[ArtLook] 탭 위에는 없다 · [프로필] 탭의 칩을 누르면 편집 화면의 그 칸으로 간다', async ({ browser }) => {
    // mover: 작품 3점(정보 있음) · 약력 있음 · 작가노트 없음 · [작가] 탭에 소개한 작품 0 → 3/5
    const { page, ctx } = await openFor(browser, mover, DESKTOP);
    for (const [tab, head] of [['portfolio', 'PortFolio'], ['artlook', 'ArtLook']] as const) {
      await page.goto(`/mypage?tab=${tab}`);
      await expect(page.getByRole('heading', { name: head }).first()).toBeVisible({ timeout: 15000 });
      await expect(completeness(page), `[${tab}] 탭 위에 완성도 안내가 있다`).toHaveCount(0);
      await expect(page.locator('main')).not.toContainText('홈페이지 완성도');
    }

    await page.goto('/mypage');
    const line = completeness(page);
    await expect(line).toContainText('3/5 완료', { timeout: 15000 });
    // 상자가 아니라 한 줄이다 — 진행 막대·끝낸 항목·닫기 버튼이 없다
    expect((await line.boundingBox())!.height, '한 줄(34px)보다 높다 — 상자로 되돌아갔다').toBeLessThan(48);
    await expect(line.getByRole('button')).toHaveCount(0);
    await expect(line.getByRole('link')).toHaveCount(2);   // 남은 것만: 작가노트 · 작가 탭 소개
    await expect(line).not.toContainText('약력');          // 끝낸 항목은 늘어놓지 않는다
    await expect(line.getByRole('link', { name: /\[작가\] 탭에도 소개하기/ })).toContainText('0/3');

    await line.getByRole('link', { name: /작가노트 쓰기/ }).click();
    await expect(editSectionTab(page, '소개')).toHaveAttribute('aria-selected', 'true', { timeout: 15000 });
    await expect(page.getByLabel('작가노트', { exact: true })).toBeFocused();
    await ctx.close();
  });

  test('★ 작품 0점 작가의 [프로필] 탭 — 칩 다섯이 아니라 [작품 올리기] 한 줄 (모바일에서도 한 줄, 가로로 밀리지 않는다)', async ({ browser }) => {
    const { page, ctx } = await openFor(browser, fresh);   // 기본 뷰포트 = 모바일
    await page.goto('/mypage');
    const line = page.locator('main a[data-task-line]');
    await expect(line).toContainText('아직 올린 작품이 없어요', { timeout: 15000 });
    await expect(line).toContainText('작품 올리기');
    expect((await line.boundingBox())!.height, '두 줄로 꺾였다').toBeLessThan(52);
    await expect(completeness(page)).toHaveCount(0);
    await expect(page.getByRole('region', { name: '시작하기' })).toHaveCount(0);   // 옛 3단계 상자
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await line.click();
    await expect(editSectionTab(page, '작품')).toHaveAttribute('aria-selected', 'true', { timeout: 15000 });
    await expect(page.getByRole('button', { name: '작품 사진 올리기' })).toBeVisible();
    await ctx.close();
  });

  test('모바일 — 칩이 많아도 페이지를 가로로 밀지 않는다(넘치면 줄 안에서 옆으로 민다)', async ({ browser }) => {
    // filler: 처음엔 4점 중 1점만 정보가 있었지만 C 에서 다 채웠다 → 남은 것: 작가노트 · 약력 · 작가 탭 소개
    const { page, ctx } = await openFor(browser, filler);
    await page.goto('/mypage');
    const line = completeness(page);
    await expect(line).toContainText('완료', { timeout: 15000 });
    expect(await line.getByRole('link').count()).toBeGreaterThanOrEqual(3);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    // 글 한 줄 + 칩 한 줄 — 칩이 여러 줄로 쌓이지 않는다
    expect((await line.boundingBox())!.height).toBeLessThan(80);
    await ctx.close();
  });
});
