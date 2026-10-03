import fs from 'fs';
import { test, expect, request as pwRequest, type APIRequestContext, type Browser, type BrowserContextOptions, type Page } from '@playwright/test';
import {
  createExhibition, customizePanel, customizeTab, editorSave, makerBar, openCustomize, openHomepageEditor, openPortfolioMaker, ownedGalleryId,
  paperRadio, previewPage, previewPageOfKind, saveDialog, solidPng, statePath, tokenFor, PUBLIC_HOMEPAGE_URL,
} from '../lib/helpers';

/**
 * 포트폴리오 PDF 만들기 화면 개편 (2026-10-03)
 *
 * 새 작가 계정으로 밟아 보니 — 첫 화면에 결과물도 저장 버튼도 없고(프로필 카드 아래 y409 에서 시작), 휴대폰에서는 표지를 골라도
 * 화면 안에 미리보기가 한 장도 없고, [PDF 저장] 은 파일이 아니라 인쇄 창을 열었고(안 열려도 성공 토스트), 표지에 닉네임이·마지막 장에
 * 전화번호가 찍히는 줄은 저장한 뒤에야 알았다. 실서버: 작품 있는 작가 47명 중 디자인을 바꿔 본 사람 1명 · 버전 0개.
 *
 *  A. 첫 화면 — 들어오면 내 PDF(미리보기)와 [PDF 저장] 이 화면 안에 있다. 편집은 처음부터 보인다(PC 패널 · 휴대폰 탭 줄). 용지는 맨 위.
 *  B. 디자인 한 줄 — 누르면 한 벌로 바뀌고 바로 [되돌리기]. 디자인 저장은 **디자인만** 보낸다.
 *  C. 꾸미기 — 휴대폰에서도 고른 결과가 보인다(시트 위에 그 쪽이 통째로). 묶음을 바꾸면 미리보기가 따라온다.
 *  D. 저장 — [PDF 내려받기] 를 누르면 **파일이 내려받아진다**(인쇄 창이 아니다). 인쇄가 안 열리면 성공이라 하지 않는다.
 *  E. 이름·연락처 — 기본은 실명·전부 싣기. 고르면 미리보기·저장 창·파일 이름이 함께 바뀐다.
 *  F. 홈페이지에도 올리기 — 방문자의 [포트폴리오] 탭에 그 PDF 가 펼쳐진다. 다시 올리면 옛 파일은 지워진다.
 *  G. 작품 고르기 — 일부만 고르면 '제출용 1' 구성이 생기고 남는다. 홈페이지의 작품은 그대로.
 *  H. 알리는 곳 — 지원서의 파일 칸(새 창) · 홈페이지 편집 저장 직후 한 줄(닫으면 다시 안 뜬다).
 *  I. 관리자 통계 — 저장이 세어진다.
 *  J. 용지 — 맨 위에서 따로. 디자인 카드를 눌러도 안 바뀐다.  K. [약력] 탭 — 싣는 항목·자리·단·영문 머리말, 그 쪽만 바뀐다.
 *  (J·K·탭별 [처음 상태로] 는 2026-10-03 사용자 검토 뒤에 더했다)
 *
 * ⚠️ 보이는지가 아니라 **눌러서 무슨 일이 나는지 · 무엇이 서버에 갔는지**를 본다.
 * ⚠️ 기하(가림·눌림·넘침)는 여기서 크롬으로 한 번 보고, 사파리 엔진·여러 화면은 `scratchpad/portfolio-maker/walk.js` 가 잰다.
 */
const API = 'http://localhost:4000/api';
const FE = 'http://localhost:5173';
const STAMP = Date.now();
const DESKTOP = { width: 1440, height: 900 };
const PHONE = '010-1234-5678';

interface Seeded { id: number; name: string; email: string; token: string; user: Record<string, unknown>; nick?: string; handle?: string }
const auth = (a: Seeded) => ({ Authorization: `Bearer ${a.token}` });

async function signupArtist(api: APIRequestContext, key: string, slug: string): Promise<Seeded> {
  const name = `책${key}${String(STAMP).slice(-6)}`;
  const email = `maker-${slug}-${STAMP}@e2e.test`;   // 이메일엔 한글을 못 쓴다
  const r = await api.post(`${API}/auth/signup`, {
    data: { name, email, password: 'MakerTest1!', role: 'ARTIST', agreeTerms: true, agreePrivacy: true },
  });
  if (!r.ok()) throw new Error(`작가 ${key} 준비 실패 ${r.status()}: ${await r.text()}`);
  const { token, user } = await r.json();
  return { id: user.id, name, email, token, user };
}
const COLORS: [number, number, number][] = [[190, 70, 60], [60, 130, 90], [60, 80, 170], [200, 160, 60], [120, 70, 150], [70, 150, 170]];
const SIZES: [number, number][] = [[640, 480], [480, 640], [600, 600], [720, 400], [500, 700], [640, 520]];
/**
 * 작품 n 점 — **진짜 사진을 올린다**(없는 주소를 넣으면 저장할 때 '불러오지 못한 사진' 으로 잡힌다).
 * 앞의 captioned 점에만 작품 정보가 있다.
 */
async function addWorks(api: APIRequestContext, a: Seeded, n: number, captioned = n) {
  await api.get(`${API}/portfolio`, { headers: auth(a) });   // 없으면 만든다
  const ids: number[] = [];
  for (let i = 0; i < n; i++) {
    const [w, h] = SIZES[i % SIZES.length]!;
    const up = await api.post(`${API}/upload/image`, {
      headers: auth(a),
      multipart: { image: { name: `work${i}.png`, mimeType: 'image/png', buffer: solidPng(w, h, COLORS[i % COLORS.length]!) } },
    });
    if (!up.ok()) throw new Error(`사진 올리기 실패 ${up.status()}: ${await up.text()}`);
    const meta = i < captioned ? { title: `작품 ${i + 1}`, medium: 'Oil on canvas', year: '2025', sizeText: '72.7×60.6 cm' } : {};
    const r = await api.post(`${API}/portfolio/images`, { headers: auth(a), data: { url: (await up.json()).url, ...meta } });
    if (!r.ok()) throw new Error(`작품 추가 실패 ${r.status()}: ${await r.text()}`);
    ids.push((await r.json()).id);
  }
  return ids;
}
const myPortfolio = async (api: APIRequestContext, a: Seeded) => (await api.get(`${API}/portfolio`, { headers: auth(a) })).json();
const putTexts = (api: APIRequestContext, a: Seeded, data: Record<string, unknown>) =>
  api.put(`${API}/portfolio`, { headers: auth(a), data: { biography: '홍익대학교 회화과 졸업', career: {}, ...data } });

/** 디자인·구성·올린 파일을 비운다 — 이 스펙을 되풀이 돌려도(--repeat-each) 늘 같은 자리에서 시작하게 */
async function resetMaker(a: Seeded, opts: { file?: boolean } = {}) {
  const api = await pwRequest.newContext();
  await api.put(`${API}/portfolio/design`, { headers: auth(a), data: { designConfig: null } });
  const p = await myPortfolio(api, a);
  for (const v of p.versions ?? []) await api.delete(`${API}/portfolio/versions/${v.id}`, { headers: auth(a) });
  if (opts.file) await api.put(`${API}/portfolio`, { headers: auth(a), data: { biography: p.biography ?? '', career: p.career ?? {}, statement: p.statement ?? null, tagline: p.tagline ?? null, portfolioFileUrl: null } });
  await api.dispose();
}

/**
 * 그 계정으로 로그인된 새 창(세션 주입). 인쇄 창은 가짜로 바꿔 둔다 — 자동 브라우저에는 인쇄 대화상자가 없다.
 *  print: 'none'  = `print()` 가 아무 일도 하지 않는다(카카오톡·인스타 같은 앱 안 브라우저)
 *         'opens' = 인쇄 창이 열린 것처럼 `beforeprint` 를 낸다
 * ⚠️ 뷰포트만 PC 로 넓혀도 터치 기기 에뮬레이션은 그대로다(이 프로젝트의 기본이 Pixel 7) — PC 는 `extra` 로 끈다.
 */
async function openFor(browser: Browser, a: Seeded, opts: { desktop?: boolean; print?: 'none' | 'opens' } = {}) {
  const extra: BrowserContextOptions = opts.desktop ? { hasTouch: false, isMobile: false, viewport: DESKTOP } : {};
  const ctx = await browser.newContext({
    ...extra,
    acceptDownloads: true,
    storageState: { cookies: [], origins: [{ origin: FE, localStorage: [{ name: 'artlink-auth', value: JSON.stringify({ state: { token: a.token, user: a.user, isAuthenticated: true }, version: 0 }) }] }] },
  });
  await ctx.addInitScript((mode) => {
    window.print = function () {
      try { (window.top as unknown as { __prints: number }).__prints = ((window.top as unknown as { __prints?: number }).__prints ?? 0) + 1; } catch { /* 다른 출처 */ }
      if (mode === 'opens') window.dispatchEvent(new Event('beforeprint'));
    };
  }, opts.print ?? 'none');
  const page = await ctx.newPage();
  return { ctx, page };
}
const prints = (page: Page) => page.evaluate(() => (window as unknown as { __prints?: number }).__prints ?? 0);
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
const overflowX = (page: Page) => page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - window.innerWidth));
/** 이 화면이 보낸 요청 모으기 — 디자인 저장(PUT /portfolio/design) · 전체 저장(PUT /portfolio) · 저장 기록(POST /portfolio/exports) */
function watch(page: Page) {
  const seen = { design: [] as Record<string, any>[], full: [] as Record<string, any>[], exports: [] as Record<string, any>[], versions: [] as string[] };
  page.on('request', (req) => {
    const p = new URL(req.url()).pathname;
    const m = req.method();
    if (m === 'PUT' && p === '/api/portfolio/design') seen.design.push(req.postDataJSON().designConfig);
    else if (m === 'PUT' && p === '/api/portfolio') seen.full.push(req.postDataJSON());
    else if (m === 'POST' && p === '/api/portfolio/exports') seen.exports.push(req.postDataJSON());
    else if (/^\/api\/portfolio\/versions/.test(p) && m !== 'GET') seen.versions.push(`${m} ${p}`);
  });
  return seen;
}
/** PDF 파일의 쪽수 — jsPDF 는 쪽마다 `/Type /Page` 를 한 번씩 적는다(쪽 나무는 `/Pages`) */
const pdfPages = (buf: Buffer) => (buf.toString('latin1').match(/\/Type\s*\/Page(?![a-zA-Z])/g) ?? []).length;
const statusPages = async (page: Page) => Number((await page.getByTestId('maker-status').innerText()).match(/(\d+)쪽/)![1]);
/** 저장 창을 열고 [PDF 내려받기] — 내려받은 파일과 결과 문구를 돌려준다 */
async function downloadPdf(page: Page, opts: { upload?: boolean } = {}) {
  await makerBar(page).getByRole('button', { name: 'PDF 저장' }).click();
  const dlg = saveDialog(page);
  await expect(dlg).toBeVisible();
  if (opts.upload) await dlg.getByRole('checkbox', { name: /내 홈페이지 \[포트폴리오\] 탭에도 올리기/ }).check();
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 120_000 }),
    dlg.getByRole('button', { name: 'PDF 내려받기' }).click(),
  ]);
  const result = dlg.getByTestId('save-result');
  await expect(result).toBeVisible({ timeout: 120_000 });
  const file = await download.path();
  return { dlg, result, download, buf: fs.readFileSync(file!) };
}

let empty: Seeded, maker: Seeded, saver: Seeded, styler: Seeded, namer: Seeded, uploader: Seeded, picker: Seeded, applier: Seeded, hinter: Seeded, cvist: Seeded;
/** 닉네임·전화번호·인스타까지 채운 작가 — 이름을 고를 수 있고 연락처 네 가지가 다 실린다 */
async function withContacts(api: APIRequestContext, a: Seeded, nick: string) {
  a.nick = nick;
  const n = await api.put(`${API}/auth/me/nickname`, { headers: auth(a), data: { nickname: nick } });
  if (!n.ok()) throw new Error(`닉네임 ${n.status()}: ${await n.text()}`);
  const pr = await api.put(`${API}/auth/me/profile`, { headers: auth(a), data: { email: a.email, phone: PHONE, instagramUrl: 'https://instagram.com/studio_e2e' } });
  if (!pr.ok()) throw new Error(`프로필 ${pr.status()}: ${await pr.text()}`);
}

test.beforeAll(async () => {
  test.setTimeout(180_000);
  const api = await pwRequest.newContext();
  empty = await signupArtist(api, '빈', 'empty');                       // 작품 0점
  maker = await signupArtist(api, '첫', 'first');
  await addWorks(api, maker, 5, 3);                                     // 5점 중 3점만 작품 정보가 있다
  await putTexts(api, maker, { statement: '겹쳐진 색층은 한 번에 읽히지 않는다.' });
  saver = await signupArtist(api, '저장', 'save');
  await addWorks(api, saver, 4);
  await putTexts(api, saver, { statement: '작가노트' });
  styler = await signupArtist(api, '꾸밈', 'style');
  await addWorks(api, styler, 3);
  await putTexts(api, styler, {});
  await withContacts(api, styler, `sun${String(STAMP).slice(-5)}`);
  namer = await signupArtist(api, '이름', 'name');
  await addWorks(api, namer, 3);
  await putTexts(api, namer, {});
  await withContacts(api, namer, `moon${String(STAMP).slice(-5)}`);
  uploader = await signupArtist(api, '올림', 'up');
  await addWorks(api, uploader, 3);
  await putTexts(api, uploader, {});
  picker = await signupArtist(api, '고름', 'pick');
  await addWorks(api, picker, 6);
  applier = await signupArtist(api, '지원', 'apply');
  await addWorks(api, applier, 3);
  await putTexts(api, applier, {});
  hinter = await signupArtist(api, '안내', 'hint');
  await addWorks(api, hinter, 3);
  await putTexts(api, hinter, {});
  cvist = await signupArtist(api, '약력', 'cv');
  await addWorks(api, cvist, 3);
  await putTexts(api, cvist, {
    statement: '겹쳐진 색층은 한 번에 읽히지 않는다.',
    career: {
      education: [{ year: '2015', content: '한국예술종합학교 미술원 졸업' }],
      solo: [{ year: '2025', content: '개인전 〈낮은 지평〉' }],
      group: [{ year: '2024', content: '단체전 〈물의 기억〉' }],
      artFair: [],
      award: [{ year: '2023', content: '올해의 신진작가상' }],
    },
  });
  await api.dispose();
});

test.describe('A. 첫 화면', () => {
  for (const desktop of [false, true]) {
    test(`★ 들어오면 내 PDF(미리보기)와 [PDF 저장] 이 화면 안에 있다 (${desktop ? 'PC' : '모바일'})`, async ({ browser }) => {
      const { page, ctx } = await openFor(browser, maker, { desktop });
      await openPortfolioMaker(page);

      // 제목이 화면 맨 위에 있다 — 예전엔 프로필 카드 아래 y409 였다
      const g = await page.evaluate(() => {
        const head = document.querySelector('[data-testid="portfolio-maker"] h2')!.getBoundingClientRect();
        const first = document.querySelector('[data-book-preview] [data-page-index="0"]')!.getBoundingClientRect();
        const bar = document.querySelector('[data-maker-bar]')!.getBoundingClientRect();
        return { headTop: head.top, pageTop: first.top, barTop: bar.top, barH: bar.height, vh: window.innerHeight };
      });
      expect(g.headTop, '제목의 위치').toBeLessThan(200);
      // 미리보기 첫 쪽이 아래 바 위로 넉넉히 보인다(예전: PC y894 · 휴대폰 y1375 — 첫 화면 밖)
      expect(g.barTop - g.pageTop, '첫 화면에 보이는 미리보기 높이').toBeGreaterThan(desktop ? 250 : 150);
      // 아래 바 — PC 는 한 줄, 휴대폰은 편집 탭 줄 + 버튼 줄 두 줄(사용자가 고른 모양). 그 이상 꺾이면 미리보기를 덮는다
      expect(g.barH, '아래 바 높이').toBeLessThan(desktop ? 80 : 120);

      // ★ [PDF 저장] 이 눌린다 — 그 자리를 눌러 보면 그 버튼이 잡힌다(하단 탭바가 아니다)
      const h = await hitsItself(page, '[data-maker-bar] button.bg-gray-900');
      expect(h.inView, '[PDF 저장] 이 화면 안에 있다').toBe(true);
      expect(h.hit, `[PDF 저장] 자리를 누르면 '${h.covered}' 가 잡힌다`).toBe(true);

      await expect(page.getByTestId('maker-status')).toContainText('작품 5점');
      // ★ 편집은 처음부터 보인다(2026-10-03 사용자 지적 "표지 고치기를 못 찾을 수도") — PC 는 패널이 열려 있고, 휴대폰은 탭 줄이 있다
      if (desktop) {
        await expect(page.locator('[data-customize="panel"]')).toBeVisible();
        await expect(customizeTab(page, '표지')).toHaveAttribute('aria-selected', 'true');
      } else {
        await expect(customizePanel(page)).toHaveCount(0);   // 시트는 누를 때만 — 처음부터 덮으면 미리보기가 반 넘게 가린다
        const row = makerBar(page).getByRole('group', { name: '편집' });
        await expect(row.getByRole('button')).toHaveText(['표지', '작품', '약력', '색·글꼴', '이름·연락처']);
      }
      // ★ 디자인 여섯이 다 첫 화면에 있다(휴대폰은 3×2)
      const designs = page.locator('[data-design-row]').getByRole('button', { name: /디자인$/ });
      await expect(designs).toHaveCount(6);
      for (let i = 0; i < 6; i++) await expect(designs.nth(i)).toBeInViewport();
      // ★ 용지는 맨 위에서 따로 — 처음에는 세로 A4
      await expect(paperRadio(page, '세로 A4')).toHaveAttribute('aria-checked', 'true');
      await expect(paperRadio(page, '세로 A4')).toBeInViewport();
      // 오른쪽 위 단추는 무엇을 하는지 말한다 · 설명 줄은 없다
      await expect(page.getByRole('link', { name: /작품·글 추가·수정/ })).toBeVisible();
      // 옛 말이 없다
      const text = await page.getByTestId('portfolio-maker').innerText();
      for (const old of ['자동 편집', '버전', '판형', '이미지형', 'CV 1쪽', '포맷', '내용 고치기', '아래가 지금 만들어진 모습', '작품 쪽']) expect(text, old).not.toContain(old);
      expect(await overflowX(page), '가로로 넘친 폭').toBe(0);
      await ctx.close();
    });
  }

  test('★ 작품 정보가 없는 작품을 알려 주고, 누르면 작품 정보 입력 창으로 간다', async ({ browser }) => {
    const { page, ctx } = await openFor(browser, maker);
    await openPortfolioMaker(page);
    const line = page.getByRole('link', { name: /작품 2점이 제목·재료 없이 실려요/ });
    await expect(line).toBeVisible();
    await line.click();
    await expect(page.getByTestId('homepage-editor')).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('dialog', { name: '작품 정보' })).toBeVisible();
    await ctx.close();
  });

  test('작품이 없으면 만들 것이 없다 — [작품 올리기] 로 보낸다', async ({ browser }) => {
    const { page, ctx } = await openFor(browser, empty);
    await page.goto('/mypage?tab=portfolio');
    const box = page.getByTestId('portfolio-maker-empty');
    await expect(box).toContainText('작품을 올리면 포트폴리오 PDF 가 바로 만들어집니다.', { timeout: 15000 });
    await expect(page.locator('[data-maker-bar]')).toHaveCount(0);
    await box.getByRole('link', { name: '작품 올리기' }).click();
    await expect(page.getByRole('button', { name: '작품 사진 올리기' })).toBeVisible({ timeout: 15000 });
    await ctx.close();
  });
});

test.describe('B. 디자인 한 줄', () => {
  test('★ 누르면 한 벌로 바뀌고 [되돌리기] 로 돌아온다 — 저장은 디자인만 보낸다', async ({ browser }) => {
    const { page, ctx } = await openFor(browser, maker, { desktop: true });
    const seen = watch(page);
    await openPortfolioMaker(page);
    const row = page.locator('[data-design-row]');
    const card = row.getByRole('button', { name: /디자인$/ }).nth(1);
    const name = (await card.getAttribute('aria-label'))!.replace(' 디자인', '');
    await expect(card).toHaveAttribute('aria-pressed', 'false');
    const before = await previewPage(page, 0).innerHTML();

    await card.click();
    await expect(card).toHaveAttribute('aria-pressed', 'true');
    await expect(row.getByRole('status')).toContainText(`'${name}' 디자인으로 바꿨어요.`);
    expect(await previewPage(page, 0).innerHTML(), '표지가 바뀌었다').not.toBe(before);
    // 0.8초 모아서 보낸다 — 디자인만(PUT /portfolio/design)
    await expect.poll(() => seen.design.length, { timeout: 8000 }).toBeGreaterThan(0);
    expect(seen.design.at(-1)!.direction).toBeTruthy();
    await expect(makerBar(page).getByRole('status')).toContainText('디자인 저장됨');

    await row.getByRole('button', { name: '되돌리기' }).click();
    await expect(card).toHaveAttribute('aria-pressed', 'false');
    await expect(row.getByRole('status')).toHaveCount(0);
    expect(await previewPage(page, 0).innerHTML(), '표지가 돌아왔다').toBe(before);
    await expect.poll(() => seen.design.at(-1)?.direction ?? null, { timeout: 8000 }).toBeNull();

    // ★ 약력·경력·파일을 통째로 다시 보내는 전체 저장은 한 번도 없었다(다른 탭에서 고친 글을 되돌리던 경로)
    expect(seen.full, '전체 저장 요청').toHaveLength(0);

    // ★ 여섯 다 처음부터 보인다 — 펼치기 없이(2026-10-03 사용자 지적 "6종 중 3종밖에 안 보인다"). 넓은 화면은 한 줄, 설명 글은 없다
    await expect(row.getByRole('button', { name: /모두 보기|더 보기/ })).toHaveCount(0);
    const cards = row.getByRole('button', { name: /디자인$/ });
    expect(await cards.count()).toBe(6);
    for (let i = 0; i < 6; i++) await expect(cards.nth(i)).toBeInViewport();
    const tops = await cards.evaluateAll((els) => [...new Set(els.map((e) => Math.round(e.getBoundingClientRect().top)))]);
    expect(tops.length, '카드가 놓인 줄 수(1440px)').toBe(1);
    expect(await row.innerText(), '카드에는 이름만').not.toMatch(/구성|어울립니다|채우셨어요/);
    await ctx.close();
  });
});

test.describe('C. 꾸미기', () => {
  test('★ 휴대폰 — 표지를 바꾸면 시트 위의 미리보기가 바뀌고, 묶음을 바꾸면 그 쪽이 따라온다', async ({ browser }) => {
    const { page, ctx } = await openFor(browser, maker);
    await openPortfolioMaker(page);
    await openCustomize(page, '표지');
    const sheet = page.locator('[data-customize="sheet"]');
    await expect(sheet).toBeVisible();
    // 뒤 화면을 잠그지 않는다 — 미리보기를 스크롤해 볼 수 있어야 한다
    expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');

    /** 그 쪽이 상단바 아래 · 시트 위에 **통째로** 보이는가 */
    const whole = async (loc: ReturnType<typeof previewPage>) => {
      const [b, s] = [await loc.getByRole('button', { name: /크게 보기$/ }).boundingBox(), await sheet.boundingBox()];
      return !!b && !!s && b.y >= 56 && b.y + b.height <= s.y + 2;
    };
    const cover = previewPage(page, 0);
    await expect.poll(() => whole(cover), { timeout: 8000, message: '표지가 시트 위에 통째로 보인다' }).toBe(true);

    // 사진 없는 표지로 → 표지에서 그림이 사라진다(예전: 고른 뒤 화면 안에 미리보기가 한 장도 없었다)
    await sheet.getByRole('button', { name: '사진 위·이름 아래', exact: true }).click();
    await expect(cover.locator('img')).toHaveCount(1);
    await sheet.getByRole('button', { name: '가운데 정렬', exact: true }).click();
    await expect(cover.locator('img')).toHaveCount(0);
    await expect(sheet.getByRole('button', { name: '가운데 정렬', exact: true })).toHaveAttribute('aria-pressed', 'true');

    // 묶음을 바꾸면 미리보기가 그 묶음이 바꾸는 쪽으로 온다
    await customizeTab(page, '이름·연락처').click();
    await expect.poll(() => whole(previewPageOfKind(page, 'contact')), { timeout: 8000, message: '마지막 장이 시트 위로 왔다' }).toBe(true);
    await customizeTab(page, '작품').click();
    await expect.poll(() => whole(previewPageOfKind(page, 'works').first()), { timeout: 8000, message: '첫 작품 쪽이 시트 위로 왔다' }).toBe(true);
    await customizeTab(page, '약력').click();
    await expect.poll(() => whole(page.locator('[data-book-preview] [data-page-part="statement"]')), { timeout: 8000, message: '작가노트 쪽이 시트 위로 왔다' }).toBe(true);

    // 누르는 곳이 손가락에 맞다(예전: 색 28px · 표지 이름표 9px)
    await customizeTab(page, '색·글꼴').click();
    const sw = await sheet.getByRole('group', { name: '배경색' }).getByRole('button').first().boundingBox();
    expect(Math.min(sw!.width, sw!.height), '색 단추의 눌리는 크기').toBeGreaterThanOrEqual(40);
    const small = await sheet.evaluate((el) => [...el.querySelectorAll('p, span, button, label')]
      .filter((e) => e.childElementCount === 0 && (e.textContent ?? '').trim() && (e as HTMLElement).offsetParent)
      .filter((e) => !e.closest('[style*="transform"]'))                       // 축소해 그린 쪽 안의 글자는 뺀다
      .map((e) => parseFloat(getComputedStyle(e).fontSize)).filter((px) => px < 12 && px > 0).length);
    expect(small, '12px 보다 작은 글자 수').toBe(0);

    // [완료] → 시트가 닫히고 아래 바가 다시 눌린다
    await sheet.getByRole('button', { name: '완료' }).click();
    await expect(sheet).toHaveCount(0);
    expect((await hitsItself(page, '[data-maker-bar] button.bg-gray-900')).hit).toBe(true);
    expect(await overflowX(page)).toBe(0);
    await ctx.close();
  });

  test('★ PC — 꾸미기는 옆 패널이고, 한 가지 배치로 바꾸면 쪽수가 바뀌며, [처음 상태로] 는 **그 탭만** 되돌린다', async ({ browser }) => {
    await resetMaker(styler);
    const { page, ctx } = await openFor(browser, styler, { desktop: true });
    const seen = watch(page);
    await openPortfolioMaker(page);
    const pages0 = await statusPages(page);

    await openCustomize(page, '작품');
    const panel = page.locator('[data-customize="panel"]');
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('radio', { name: /알아서 배치/ })).toHaveAttribute('aria-checked', 'true');
    await panel.getByRole('radio', { name: /한 가지로/ }).click();
    await panel.getByRole('button', { name: '1점 크게', exact: true }).click();
    // 3점을 한 쪽에 한 점씩 — 표지 + 작품 3쪽 + 약력 + 마지막 장
    await expect.poll(() => statusPages(page)).toBe(6);
    expect(pages0).toBeLessThanOrEqual(6);
    // 쪽 위의 이름은 '약력' 이다 — 'CV' 는 처음 온 사람에게 설명이 필요한 말이다
    await expect(previewPageOfKind(page, 'cv')).toContainText('약력');

    // 전화번호를 끈다(이름·연락처) — 이 탭에는 [처음 상태로] 가 없다(꺼 둔 전화번호가 한 번에 다시 실리면 안 된다)
    await customizeTab(page, '이름·연락처').click();
    await panel.getByRole('checkbox', { name: /전화번호/ }).uncheck();
    await expect(panel.getByRole('button', { name: /처음 상태로/ })).toHaveCount(0);
    // [색·글꼴] 을 바꾸고 그 탭만 처음 상태로 — 작품 배치(한 가지로 · 1점 크게)·전화번호는 그대로여야 한다
    await customizeTab(page, '색·글꼴').click();
    await panel.getByRole('button', { name: '아이보리', exact: true }).click();
    await panel.getByRole('button', { name: '색·글꼴 처음 상태로' }).click();
    const confirm = page.getByRole('dialog', { name: "'색·글꼴'을 처음 상태로 돌릴까요?" });
    await expect(confirm).toContainText('용지와 각 쪽의 배치는 그대로입니다.');
    await confirm.getByRole('button', { name: '처음 상태로' }).click();
    await expect.poll(() => seen.design.at(-1)?.bg, { timeout: 8000 }).toBe('white');
    expect(seen.design.at(-1)).toMatchObject({ bg: 'white', auto: false, worksLayout: 'hero', contact: { phone: false } });
    expect(await statusPages(page), '작품 배치는 그대로 — 쪽수가 안 바뀐다').toBe(6);
    // 되돌리기는 누른 자리(패널 맨 아래)에
    await panel.getByRole('button', { name: '되돌리기' }).click();

    // 서버에도 디자인만 바뀌었다 — 약력은 그대로
    const api = await pwRequest.newContext();
    await expect.poll(async () => (await myPortfolio(api, styler)).designConfig?.bg, { timeout: 8000 }).toBe('ivory');
    const p = await myPortfolio(api, styler);
    expect(p.biography).toBe('홍익대학교 회화과 졸업');
    expect(p.designConfig).toMatchObject({ bg: 'ivory', auto: false, worksLayout: 'hero', contact: { phone: false } });
    await api.dispose();
    expect(seen.full, '전체 저장 요청').toHaveLength(0);
    await ctx.close();
  });

  test('쪽을 누르면 크게 본다 — 한 쪽씩 넘기고, 사진은 원본이다', async ({ browser }) => {
    const { page, ctx } = await openFor(browser, maker, { desktop: true });
    await openPortfolioMaker(page);
    // 미리보기는 800px 썸네일을 쓴다(탭을 열 때 원본을 전부 받지 않는다)
    const works = previewPageOfKind(page, 'works').first();
    await expect.poll(() => works.locator('img').first().getAttribute('src')).toContain('/t800/');
    const at = Number(await works.getAttribute('data-page-index'));
    await previewPage(page, at - 1).getByRole('button', { name: /크게 보기$/ }).click();
    const viewer = page.getByRole('dialog', { name: '포트폴리오 크게 보기' });
    await expect(viewer).toContainText(new RegExp(`^${at}\\s*/\\s*\\d+`));
    const w = (await viewer.locator('[style*="transform"]').first().evaluate((el) => el.parentElement!.getBoundingClientRect().width));
    expect(w, '크게 본 한 쪽의 폭(예전 전체화면 431px)').toBeGreaterThan(900);
    await viewer.getByRole('button', { name: '다음 쪽' }).click();
    await expect(viewer).toContainText(new RegExp(`^${at + 1}\\s*/\\s*\\d+`));
    const src = await viewer.locator('img').first().getAttribute('src');
    expect(src, '크게 보기의 사진').not.toContain('/t800/');
    await page.keyboard.press('ArrowLeft');
    await expect(viewer).toContainText(new RegExp(`^${at}\\s*/\\s*\\d+`));
    await page.keyboard.press('Escape');
    await expect(viewer).toHaveCount(0);
    await ctx.close();
  });
});

test.describe('D. 저장', () => {
  test('★ [PDF 내려받기] 를 누르면 파일이 내려받아진다 — 인쇄 창을 열지 않는다', async ({ browser }) => {
    test.setTimeout(150_000);
    const { page, ctx } = await openFor(browser, saver, { desktop: true });
    const seen = watch(page);
    await openPortfolioMaker(page);
    const pages = await statusPages(page);

    await makerBar(page).getByRole('button', { name: 'PDF 저장' }).click();
    const dlg = saveDialog(page);
    // 저장하기 전에 무엇이 실리는지 보여 준다
    await expect(dlg).toContainText(`${pages}쪽 · 작품 4점 · 세로 A4`);
    await expect(dlg.getByTestId('printed-info')).toContainText(saver.name);
    await expect(dlg.getByTestId('printed-info')).toContainText('이메일');
    // 홈페이지에 올리기는 기본 꺼짐
    await expect(dlg.getByRole('checkbox', { name: /내 홈페이지/ })).not.toBeChecked();
    await page.keyboard.press('Escape');
    await expect(dlg).toHaveCount(0);

    const { result, download, buf } = await downloadPdf(page);
    expect(download.suggestedFilename()).toBe(`${saver.name}_포트폴리오.pdf`);
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdfPages(buf), '파일의 쪽수 = 화면이 말한 쪽수').toBe(pages);
    expect(buf.length, '10MB 안').toBeLessThan(10 * 1048576);
    await expect(result).toContainText('PDF 를 저장했습니다');
    await expect(result).toContainText(`${pages}쪽`);
    expect(await prints(page), '인쇄 창을 연 횟수').toBe(0);
    // 다음 할 일
    await expect(result.getByRole('link', { name: '모집공고 보러 가기' })).toHaveAttribute('href', '/exhibitions');
    // 결과를 토스트로 알리지 않는다(아래에 떠서 버튼을 가렸다)
    await expect(page.getByRole('status').filter({ hasText: /PDF|저장했습니다/ })).toHaveCount(0);

    // 기록이 한 줄 갔다
    await expect.poll(() => seen.exports.length).toBe(1);
    expect(seen.exports[0]).toEqual({ method: 'download', pages, works: 4, uploaded: false });
    // 홈페이지 파일은 건드리지 않았다
    const api = await pwRequest.newContext();
    expect((await myPortfolio(api, saver)).portfolioFileUrl ?? null).toBeNull();
    await api.dispose();
    await ctx.close();
  });

  test('★ 인쇄 창이 안 열리는 브라우저에서는 성공이라고 하지 않는다 — 열리면 순서를 안내한다', async ({ browser }) => {
    test.setTimeout(150_000);
    // 앱 안 브라우저처럼 print() 가 아무 일도 하지 않는다
    const a = await openFor(browser, saver, { print: 'none' });
    const seenA = watch(a.page);
    await openPortfolioMaker(a.page);
    await makerBar(a.page).getByRole('button', { name: 'PDF 저장' }).click();
    const dlgA = saveDialog(a.page);
    await dlgA.getByRole('button', { name: '다른 형식으로 저장' }).click();
    // 누르기 전에 순서를 보여 준다
    await expect(dlgA).toContainText("대상(프린터)을 'PDF로 저장'으로 바꿉니다.");
    await dlgA.getByRole('button', { name: '인쇄 창 열기' }).click();
    const resA = dlgA.getByTestId('save-result');
    await expect(resA).toContainText('이 브라우저에서는 인쇄 창이 열리지 않았어요', { timeout: 60_000 });
    await expect(resA).not.toContainText('인쇄 창을 열었습니다');
    expect(await prints(a.page)).toBe(1);
    expect(seenA.exports.filter((e) => e.method === 'print'), '열리지 않은 인쇄는 기록하지 않는다').toHaveLength(0);
    // 바로 내려받기로 돌아갈 수 있다
    await resA.getByRole('button', { name: 'PDF 내려받기로' }).click();
    await expect(dlgA.getByRole('button', { name: 'PDF 내려받기' })).toBeVisible();
    await a.ctx.close();

    // 인쇄 창이 열리는 브라우저
    const b = await openFor(browser, saver, { desktop: true, print: 'opens' });
    const seenB = watch(b.page);
    await openPortfolioMaker(b.page);
    await makerBar(b.page).getByRole('button', { name: 'PDF 저장' }).click();
    const dlgB = saveDialog(b.page);
    await dlgB.getByRole('button', { name: '다른 형식으로 저장' }).click();
    await dlgB.getByRole('button', { name: '인쇄 창 열기' }).click();
    await expect(dlgB.getByTestId('save-result')).toContainText('인쇄 창을 열었습니다', { timeout: 60_000 });
    await expect.poll(() => seenB.exports.filter((e) => e.method === 'print').length).toBe(1);
    await b.ctx.close();
  });
});

test.describe('E. 이름 · 연락처', () => {
  test('★ 기본은 실명·전부 싣기 — 닉네임을 고르고 전화번호를 끄면 미리보기·저장 창·파일 이름이 함께 바뀐다', async ({ browser }) => {
    test.setTimeout(150_000);
    await resetMaker(namer);
    const { page, ctx } = await openFor(browser, namer, { desktop: true });
    await openPortfolioMaker(page);
    const cover = previewPage(page, 0);
    const contact = previewPageOfKind(page, 'contact');
    // 기본: 실명 · 이메일·전화번호·인스타·홈페이지
    await expect(cover).toContainText(namer.name);
    await expect(cover).not.toContainText(namer.nick!);
    await expect(contact).toContainText(namer.email);
    await expect(contact).toContainText(PHONE);
    await expect(contact).toContainText('@studio_e2e');

    await contact.getByRole('button', { name: '실리는 정보 고치기' }).click();
    const panel = customizePanel(page);
    await expect(customizeTab(page, '이름·연락처')).toHaveAttribute('aria-selected', 'true');
    await expect(panel.getByRole('radio', { name: /실명/ })).toHaveAttribute('aria-checked', 'true');
    await panel.getByRole('radio', { name: /닉네임/ }).click();
    await expect(cover).toContainText(namer.nick!);
    await expect(cover).not.toContainText(namer.name);
    await panel.getByRole('checkbox', { name: /전화번호/ }).uncheck();
    await expect(contact).not.toContainText(PHONE);
    await expect(contact).toContainText(namer.email);

    // 저장 창이 같은 말을 한다
    await makerBar(page).getByRole('button', { name: 'PDF 저장' }).click();
    const info = saveDialog(page).getByTestId('printed-info');
    await expect(info).toContainText(`${namer.nick} (닉네임)`);
    await expect(info).toContainText('이메일 · 인스타그램 · 홈페이지 주소·QR');
    await expect(info).not.toContainText('전화번호');
    // Esc 는 **맨 위의 것 하나만** 닫는다 — 저장 창이 닫히고 뒤의 꾸미기 패널은 그대로, 한 번 더 누르면 패널이 닫힌다.
    // (예전: 패널의 리스너가 먼저 불려 상태를 바꾸면 그 사이 저장 창의 리스너가 떼어졌다 다시 붙어, 창은 그대로이고 패널만 닫혔다 — `useEscapeKey`)
    await page.keyboard.press('Escape');
    await expect(saveDialog(page)).toHaveCount(0);
    await expect(panel).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);

    // 파일 이름도 닉네임
    const { download } = await downloadPdf(page);
    expect(download.suggestedFilename()).toBe(`${namer.nick}_포트폴리오.pdf`);

    // 서버에 남았다 — 다시 들어와도 그대로
    const api = await pwRequest.newContext();
    await expect.poll(async () => (await myPortfolio(api, namer)).designConfig?.nameSource, { timeout: 8000 }).toBe('nickname');
    expect((await myPortfolio(api, namer)).designConfig.contact).toMatchObject({ phone: false, email: true });
    await api.dispose();
    await page.reload();
    await expect(previewPage(page, 0)).toContainText(namer.nick!, { timeout: 20000 });
    await expect(previewPageOfKind(page, 'contact')).not.toContainText(PHONE);

    // 연락처를 전부 끄면 마지막 장이 없어진다(이름만 뜬 빈 장을 만들지 않는다)
    await openCustomize(page, '이름·연락처');
    for (const name of [/이메일/, /인스타그램/, /홈페이지 주소/]) await customizePanel(page).getByRole('checkbox', { name }).uncheck();
    await expect(previewPageOfKind(page, 'contact')).toHaveCount(0);
    await expect(customizePanel(page)).toContainText('실을 연락처가 없어 마지막 장을 만들지 않습니다.');
    await ctx.close();
  });
});

test.describe('F. 내 홈페이지에도 올리기', () => {
  test('★ 켜고 저장하면 방문자의 [포트폴리오] 탭에 그 PDF 가 펼쳐진다 — 다시 올리면 옛 파일은 지워진다', async ({ browser }) => {
    test.setTimeout(240_000);
    const { page, ctx } = await openFor(browser, uploader, { desktop: true });
    const seen = watch(page);
    await openPortfolioMaker(page);

    const first = await downloadPdf(page, { upload: true });
    await expect(first.result).toContainText('내 홈페이지 [포트폴리오] 탭에 올렸습니다.');
    await expect.poll(() => seen.exports.at(-1)?.uploaded).toBe(true);
    // 글·디자인을 통째로 다시 보내지 않았다 — 파일만 바꿨다
    expect(seen.full).toHaveLength(0);

    const api = await pwRequest.newContext();
    const url1: string = (await myPortfolio(api, uploader)).portfolioFileUrl;
    expect(url1).toMatch(/\.pdf$/);
    const file1 = await api.get(`http://localhost:4000${url1}`);
    expect(file1.status()).toBe(200);
    expect((await file1.body()).subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect((await myPortfolio(api, uploader)).biography, '약력은 그대로').toBe('홍익대학교 회화과 졸업');

    // 결과의 [내 홈페이지에서 보기] → 공개 홈페이지의 [포트폴리오] 탭
    await first.result.getByRole('link', { name: '내 홈페이지에서 보기' }).click();
    await expect(page).toHaveURL(/tab=file/);

    // 로그인하지 않은 방문자에게도 펼쳐진다
    const anon = await browser.newPage();
    await anon.goto(`/portfolio/${uploader.id}?tab=file`);
    await expect(anon.getByRole('tablist', { name: '홈페이지 메뉴' }).getByRole('tab', { name: '포트폴리오' })).toHaveAttribute('aria-selected', 'true', { timeout: 20000 });
    await expect(anon.locator('canvas').first()).toBeVisible({ timeout: 30000 });
    await anon.close();

    // 다시 올리면 "지금 올려 둔 파일은 이 PDF 로 바뀝니다" 라고 말하고, 옛 파일은 지운다(아무 지원서도 쓰지 않는 파일)
    await openPortfolioMaker(page);
    await makerBar(page).getByRole('button', { name: 'PDF 저장' }).click();
    await expect(saveDialog(page)).toContainText('지금 올려 둔 파일은 이 PDF 로 바뀝니다.');
    await page.keyboard.press('Escape');
    await downloadPdf(page, { upload: true });
    const url2: string = (await myPortfolio(api, uploader)).portfolioFileUrl;
    expect(url2).not.toBe(url1);
    await expect.poll(async () => (await api.get(`http://localhost:4000${url1}`)).status(), { timeout: 8000 }).toBe(404);
    expect((await api.get(`http://localhost:4000${url2}`)).status()).toBe(200);
    await api.dispose();
    await ctx.close();
  });
});

test.describe('G. 작품 고르기', () => {
  test("★ 일부만 고르면 '제출용 1' 구성이 생기고, 새로고침해도 남는다 — 홈페이지의 작품은 그대로", async ({ browser }) => {
    await resetMaker(picker);
    const { page, ctx } = await openFor(browser, picker, { desktop: true });
    const seen = watch(page);
    await openPortfolioMaker(page);
    await expect(page.getByTestId('maker-status')).toContainText('작품 6점');
    // 저장해 둔 구성이 없으면 고르는 줄이 없다
    await expect(page.getByRole('button', { name: /전체 작품 ·/ })).toHaveCount(0);

    await makerBar(page).getByRole('button', { name: /작품 고르기/ }).click();
    const dlg = page.getByRole('dialog', { name: '작품 고르기' });
    // 전체를 그대로 두면 아무것도 만들지 않는다
    await expect(dlg.getByRole('button', { name: '전체 작품 그대로' })).toBeVisible();
    await expect(dlg.getByTestId('picker-count')).toContainText('6점');
    const pagesAll = Number((await dlg.getByTestId('picker-count').innerText()).match(/약 (\d+)쪽/)![1]);

    // 두 점을 뺀다 → 쪽수 어림이 줄고, 이름 칸이 나타난다
    await dlg.getByRole('button', { name: / — 1번째로 실림$/ }).click();
    await dlg.getByRole('button', { name: / — 1번째로 실림$/ }).click();
    await expect(dlg.getByTestId('picker-count')).toContainText('4점');
    expect(Number((await dlg.getByTestId('picker-count').innerText()).match(/약 (\d+)쪽/)![1])).toBeLessThanOrEqual(pagesAll);
    await expect(dlg.getByLabel(/이 구성의 이름/)).toHaveValue('제출용 1');
    // 순서 화살표가 손가락에 맞다(예전 18px)
    const arrow = await dlg.getByRole('button', { name: '1번째 작품을 뒤로' }).boundingBox();
    expect(arrow!.height).toBeGreaterThanOrEqual(44);
    await dlg.getByRole('button', { name: '1번째 작품을 뒤로' }).click();

    await dlg.getByRole('button', { name: '4점으로 만들기' }).click();
    await expect(dlg).toHaveCount(0);
    await expect(page.getByTestId('maker-status')).toContainText('작품 4점');
    await expect(page.getByRole('button', { name: /제출용 1 · 4점/ })).toBeVisible();
    await expect(makerBar(page).getByRole('button', { name: /작품 고르기/ })).toContainText('4/6');
    expect(seen.versions).toEqual(['POST /api/portfolio/versions']);

    const api = await pwRequest.newContext();
    const p = await myPortfolio(api, picker);
    expect(p.versions).toHaveLength(1);
    expect(p.versions[0]).toMatchObject({ name: '제출용 1' });
    expect(p.versions[0].workIds).toHaveLength(4);
    // 순서를 바꿨다 — 첫 두 작품이 뒤바뀌어 있다
    const order = p.images.map((i: { id: number }) => i.id).slice(2);
    expect(p.versions[0].workIds).toEqual([order[1], order[0], order[2], order[3]]);
    expect(p.images, '홈페이지의 작품은 그대로').toHaveLength(6);

    // 이 구성에서 디자인을 바꾸면 그 구성에만 저장된다(전체 작품의 디자인은 그대로)
    await openCustomize(page, '색·글꼴');
    await customizePanel(page).getByRole('button', { name: '샌드', exact: true }).click();
    await expect.poll(() => seen.versions.at(-1), { timeout: 8000 }).toBe(`PATCH /api/portfolio/versions/${p.versions[0].id}`);
    expect(seen.design).toHaveLength(0);

    // 새로고침 — 전체 작품으로 시작하고, 머리의 줄에서 다시 고를 수 있다
    await page.reload();
    await expect(page.getByTestId('maker-status')).toContainText('작품 6점', { timeout: 20000 });
    await page.getByRole('button', { name: /전체 작품 · 6점/ }).click();
    await page.getByRole('menuitem', { name: /제출용 1 · 4점/ }).click();
    await expect(page.getByTestId('maker-status')).toContainText('작품 4점');

    // 지우기 — 고르는 창 안에서, 확인을 거친다
    await makerBar(page).getByRole('button', { name: /작품 고르기/ }).click();
    await page.getByRole('dialog', { name: '작품 고르기' }).getByRole('button', { name: '이 구성 지우기' }).click();
    const confirm = page.getByRole('dialog', { name: '이 구성을 지울까요?' });
    await expect(confirm).toContainText('작품과 홈페이지는 그대로입니다.');
    await confirm.getByRole('button', { name: '지우기' }).click();
    await expect(page.getByTestId('maker-status')).toContainText('작품 6점');
    await expect(page.getByRole('button', { name: /전체 작품 ·/ })).toHaveCount(0);
    expect((await myPortfolio(api, picker)).versions).toHaveLength(0);
    await api.dispose();
    await ctx.close();
  });
});

test.describe('H. 알리는 곳', () => {
  test('★ 지원서 — 파일 칸에서 [PDF 만들기] 를 새 창으로 열고, 만든 뒤 [불러오기] 로 붙인다. 쓰던 글은 남는다', async ({ browser }) => {
    test.setTimeout(240_000);
    const api = await pwRequest.newContext();
    await resetMaker(applier, { file: true });
    const exId = await createExhibition(api, { title: `PDF 안내 공모 ${Date.now()}`, galleryId: await ownedGalleryId(api), approve: true });
    const { page, ctx } = await openFor(browser, applier, { desktop: true });
    await page.goto(`/exhibitions/${exId}/apply`);
    const hint = page.getByTestId('apply-pdf-hint');
    await expect(hint).toBeVisible({ timeout: 20000 });
    const bio = page.getByPlaceholder('작가 소개·약력을 입력하세요.');
    await bio.fill('이 공모에 맞춰 고쳐 쓴 약력');

    // 아직 올린 파일이 없으면 그렇게 말한다(조용히 실패하지 않는다)
    await hint.getByRole('button', { name: '홈페이지에 올린 파일 불러오기' }).click();
    await expect(page.getByText('홈페이지에 올린 포트폴리오 파일이 아직 없어요.')).toBeVisible();

    // [PDF 만들기] 는 새 창 — 지원서는 그대로 남는다
    const link = hint.getByRole('link', { name: /포트폴리오 PDF 만들기/ });
    await expect(link).toHaveAttribute('target', '_blank');
    const [tab] = await Promise.all([ctx.waitForEvent('page'), link.click()]);
    await expect(tab.getByTestId('portfolio-maker')).toBeVisible({ timeout: 20000 });
    await expect(tab.locator('[data-book-preview] [data-page-index="0"]')).toBeVisible({ timeout: 20000 });
    const made = await downloadPdf(tab, { upload: true });
    await expect(made.result).toContainText('내 홈페이지 [포트폴리오] 탭에 올렸습니다.');
    await tab.close();

    // 지원서로 돌아와 불러온다 — 쓰던 약력은 그대로다
    await hint.getByRole('button', { name: '홈페이지에 올린 파일 불러오기' }).click();
    await expect(hint).toHaveCount(0);
    await expect(page.locator('main').getByRole('link', { name: /\.pdf$/ })).toBeVisible();
    await expect(bio).toHaveValue('이 공모에 맞춰 고쳐 쓴 약력');
    await api.dispose();
    await ctx.close();
  });

  test('★ 홈페이지 편집을 저장한 직후에만 한 번 알린다 — 닫으면 다시 안 뜬다', async ({ browser }) => {
    const { page, ctx } = await openFor(browser, hinter, { desktop: true });
    // 평소 방문에는 없다(공개 홈페이지의 주인 화면은 조용하다)
    await page.goto(`/portfolio/${hinter.id}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('pdf-hint')).toHaveCount(0);

    await openHomepageEditor(page, '소개');
    await page.getByLabel('한 줄 소개').fill('빛이 머무는 자리');
    await editorSave(page).click();
    await page.waitForURL(PUBLIC_HOMEPAGE_URL, { timeout: 15000 });
    const line = page.getByTestId('pdf-hint');
    await expect(line).toContainText('포트폴리오 PDF');
    await expect(line.getByRole('link', { name: 'PDF 만들기' })).toHaveAttribute('href', '/mypage?tab=portfolio');
    // 탭을 바꿔도(주소가 바뀌어도) 사라지지 않는다 — 닫아야 사라진다
    await page.getByRole('tablist', { name: '홈페이지 메뉴' }).getByRole('tab', { name: '약력' }).click();
    await expect(line).toBeVisible();
    await line.getByRole('button', { name: '안내 닫기' }).click();
    await expect(line).toHaveCount(0);

    // 다시 저장해도 뜨지 않는다
    await openHomepageEditor(page, '소개');
    await page.getByLabel('한 줄 소개').fill('빛이 머무는 자리, 다시');
    await editorSave(page).click();
    await page.waitForURL(PUBLIC_HOMEPAGE_URL, { timeout: 15000 });
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByTestId('pdf-hint')).toHaveCount(0);
    await ctx.close();
  });
});

test.describe('I. 관리자 통계', () => {
  test('★ 저장이 세어진다 — [통계] 탭의 "포트폴리오 PDF 저장"', async ({ browser }) => {
    const api = await pwRequest.newContext();
    const admin = { Authorization: `Bearer ${tokenFor('admin')}` };
    const before = await (await api.get(`${API}/admin/stats/portfolio-exports?days=1`, { headers: admin })).json();
    const log = await api.post(`${API}/portfolio/exports`, { headers: auth(maker), data: { method: 'download', pages: 7, works: 5, uploaded: false } });
    expect(log.status()).toBe(204);
    const after = await (await api.get(`${API}/admin/stats/portfolio-exports?days=1`, { headers: admin })).json();
    expect(after.totals.saves).toBe(before.totals.saves + 1);
    expect(after.rows.at(-1).total).toBe(before.rows.at(-1).total + 1);
    // 작가가 아니면 기록도 통계도 볼 수 없다
    expect((await api.get(`${API}/admin/stats/portfolio-exports`, { headers: auth(maker) })).status()).toBe(403);
    await api.dispose();

    const ctx = await browser.newContext({ storageState: statePath('admin'), viewport: DESKTOP, hasTouch: false, isMobile: false });
    const page = await ctx.newPage();
    await page.goto('/mypage?tab=stats');
    await expect(page.getByRole('heading', { name: '포트폴리오 PDF 저장' })).toBeVisible({ timeout: 15000 });
    const kpis = page.getByTestId('export-kpis');
    await expect(kpis).toContainText('지금까지');
    await expect(kpis).toContainText(`${after.totals.saves}회`);
    await expect(kpis).toContainText(`저장한 작가 ${after.totals.artists}명`);
    // 기간 버튼은 하나뿐이다(방문자·저장 두 섹션이 함께 따른다)
    await expect(page.getByRole('button', { name: '7일' })).toHaveCount(1);
    await page.getByText('표로 보기').last().click();
    await expect(page.getByTestId('export-table').locator('tbody tr').first()).toContainText(String(after.rows.at(-1).total));
    await ctx.close();
  });
});

/* ── 2026-10-03 사용자 검토 뒤에 더한 것 ─────────────────────────────────── */

test.describe('J. 용지 — 맨 위에서 따로', () => {
  test('★ 고르면 모든 쪽이 그 용지로 바뀌고, 디자인 카드를 눌러도 용지는 안 바뀐다', async ({ browser }) => {
    await resetMaker(saver);
    const { page, ctx } = await openFor(browser, saver, { desktop: true });
    const seen = watch(page);
    await openPortfolioMaker(page);
    const ratio = () => previewPage(page, 0).locator('[data-scaled-page]').evaluate((el) => el.getBoundingClientRect().width / el.getBoundingClientRect().height);
    expect(await ratio(), '세로 A4').toBeLessThan(1);

    await paperRadio(page, '가로 A4').click();
    await expect(paperRadio(page, '가로 A4')).toHaveAttribute('aria-checked', 'true');
    await expect.poll(ratio).toBeGreaterThan(1);
    await expect.poll(() => seen.design.at(-1)?.page, { timeout: 8000 }).toBe('a4-landscape');

    // 세로로 되돌린 뒤, 가로 용지를 쓰는 디자인('다크 룩북')을 눌러도 세로 그대로 — 예전엔 말없이 가로로 바뀌었다
    await paperRadio(page, '세로 A4').click();
    const row = page.locator('[data-design-row]');
    await row.getByRole('button', { name: '다크 룩북 디자인' }).click();
    await expect(row.getByRole('button', { name: '다크 룩북 디자인' })).toHaveAttribute('aria-pressed', 'true');
    await expect(paperRadio(page, '세로 A4')).toHaveAttribute('aria-checked', 'true');
    expect(await ratio()).toBeLessThan(1);
    await expect.poll(() => seen.design.at(-1)?.direction, { timeout: 8000 }).toBe('dark');
    expect(seen.design.at(-1)!.page).toBe('a4-portrait');
    // [색·글꼴] 탭에는 용지가 없다
    await openCustomize(page, '색·글꼴');
    await expect(customizePanel(page).getByText('용지', { exact: true })).toHaveCount(0);
    await ctx.close();
  });
});

test.describe('K. [약력] 탭 — 그 쪽만 바뀐다', () => {
  test('★ 싣는 항목 · 약력 자리 · 경력 단 수 · 영문 머리말 · 글 정렬 — 고른 대로 미리보기와 서버가 바뀌고, [처음 상태로] 는 약력만 되돌린다', async ({ browser }) => {
    test.setTimeout(120_000);
    await resetMaker(cvist);
    const { page, ctx } = await openFor(browser, cvist, { desktop: true });
    const seen = watch(page);
    await openPortfolioMaker(page);
    await openCustomize(page, '약력');
    const panel = customizePanel(page);
    const cv = previewPageOfKind(page, 'cv').first();
    const statement = page.locator('[data-book-preview] [data-page-part="statement"]');
    // 미리보기가 작가노트 쪽으로 왔다(약력 탭이 고치는 첫 쪽)
    await expect(statement).toBeInViewport();
    await expect(cv).toContainText('올해의 신진작가상');
    await expect(cv).toContainText('EDUCATION');

    // 싣는 항목 — 수상만 끈다
    await panel.getByRole('checkbox', { name: /수상 및 선정/ }).uncheck();
    await expect(cv).not.toContainText('올해의 신진작가상');
    await expect(cv).toContainText('개인전 〈낮은 지평〉');
    // 적어 둔 게 없는 항목은 흐리고, 쓰러 가는 길이 있다
    await expect(panel.getByRole('checkbox', { name: /아트페어/ })).toBeDisabled();

    // 약력 자리 — 작품 앞으로
    const order = () => page.locator('[data-book-preview] [data-page-kind]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.pageKind));
    expect((await order()).indexOf('cv')).toBeGreaterThan((await order()).indexOf('works'));
    await panel.getByRole('button', { name: '작품 앞', exact: true }).click();
    await expect.poll(async () => { const o = await order(); return o.indexOf('cv') < o.indexOf('works'); }).toBe(true);

    // 경력 두 단 · 영문 머리말 끄기
    await panel.getByRole('button', { name: '두 단', exact: true }).click();
    await expect.poll(() => cv.locator('[style*="flex:1;min-width:0"]').count()).toBe(2);
    await panel.getByRole('checkbox', { name: /영문 머리말/ }).uncheck();
    await expect(cv).not.toContainText('EDUCATION');
    await expect(cv).toContainText('학력');

    // 글 정렬 — 작가노트·약력만 오른쪽. [작품] 탭의 글 정렬은 그대로(한 탭의 옵션은 그 쪽만)
    await panel.getByRole('group', { name: '작가노트·약력 글 정렬' }).getByRole('button', { name: '오른쪽' }).click();
    await expect.poll(() => statement.innerHTML()).toContain('text-align:right');
    await expect.poll(() => seen.design.at(-1)?.proseAlign, { timeout: 8000 }).toBe('right');
    expect(seen.design.at(-1)).toMatchObject({
      worksProseAlign: 'justify', cvPosition: 'before', cvColumns: 'two', cvEnglish: false, cvShow: { award: false, solo: true },
    });

    // 다른 탭의 값을 하나 바꿔 둔다 → [약력 처음 상태로] 뒤에도 그대로여야 한다
    await customizeTab(page, '색·글꼴').click();
    await panel.getByRole('button', { name: '아이보리', exact: true }).click();
    await customizeTab(page, '약력').click();
    await panel.getByRole('button', { name: '약력 처음 상태로' }).click();
    await page.getByRole('dialog', { name: "'약력'을 처음 상태로 돌릴까요?" }).getByRole('button', { name: '처음 상태로' }).click();
    await expect(cv).toContainText('올해의 신진작가상');
    await expect.poll(async () => { const o = await order(); return o.indexOf('cv') > o.indexOf('works'); }).toBe(true);
    await expect.poll(() => seen.design.at(-1)?.cvPosition, { timeout: 8000 }).toBe('after');
    expect(seen.design.at(-1)).toMatchObject({ bg: 'ivory', proseAlign: 'justify', cvEnglish: true, cvColumns: 'auto' });

    // 서버에 남는다 — 새로고침해도 아이보리, 약력은 처음 상태
    const api = await pwRequest.newContext();
    await expect.poll(async () => (await myPortfolio(api, cvist)).designConfig?.cvPosition, { timeout: 8000 }).toBe('after');
    expect((await myPortfolio(api, cvist)).designConfig).toMatchObject({ bg: 'ivory' });
    await api.dispose();
    expect(seen.full, '전체 저장 요청').toHaveLength(0);
    await ctx.close();
  });
});
