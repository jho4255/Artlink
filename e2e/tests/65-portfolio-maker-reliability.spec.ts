import fs from 'fs';
import { test, expect, request as pwRequest, type APIRequestContext, type Browser, type BrowserContextOptions, type Page } from '@playwright/test';
import {
  applyTermsVersion, createExhibition, customizePanel, customizeTab, editorSave, fireConcurrently, makerBar, openCustomize,
  openHomepageEditor, openPortfolioMaker, ownedGalleryId, paperRadio, previewPage, saveDialog, solidPng, tokenFor,
} from '../lib/helpers';

/**
 * 포트폴리오 만들기 — **신뢰성**(2026-10-03, 배포 전 검사).
 *
 * 64 번 스펙이 "눌러서 무슨 일이 나는가"를 한 번씩 본다면, 여기는 **여러 번 · 빠르게 · 동시에 · 망가진 상황에서** 본다.
 * 단발 테스트가 못 잡는 것들이다:
 *   R1  빠르게 20번 바꾼 디자인 — 서버에는 마지막 값, 저장 요청이 겹치지 않는다(응답 순서가 뒤집히면 나중 선택이 사라진다)
 *   R2  저장 실패 — 오류가 보이고, [다시 시도] 로 복구된다(PC · 휴대폰)
 *   R3  바꾸자마자 떠나도 — 남은 디자인이 저장된다
 *   R4  탭 둘(만들기 · 홈페이지 편집)을 번갈아 3번 — 디자인과 글이 서로를 지우지 않는다
 *   R5  PDF 를 연달아 4번(중간에 용지 변경) — 매번 온전한 PDF, 쪽수·방향이 화면과 같고, 메모리가 계속 늘지 않는다
 *   R6  홈페이지에 3번 올리기 — 옛 파일은 지워지고 지원서가 쓰는 파일은 남는다, 그 뒤 글을 고쳐 저장해도 파일이 안 되돌아간다
 *   R7  구성 — 동시에 만들어도 12개를 넘지 않는다, 구성마다 디자인이 따로이고 오가도 섞이지 않는다
 *   R8  작품 30점 — 들어올 때 원본을 안 받고, PDF 가 한도 안에서 시간 안에 나온다
 *   R9  저장 기록 — 동시에 몰려도 하루 100줄을 넘지 않는다(그리고 저장 자체는 막지 않는다)
 *   R10 다른 탭에서 지운 구성 — 이 탭이 404 에 갇히지 않고 전체 작품으로 돌아온다
 *   R11 휴대폰 — 시트·창을 열고 닫기 반복, 스크롤 잠김이 남지 않는다
 *   R12 창 크기를 넓혔다 좁혔다 — 패널 ↔ 시트가 맞게 바뀌고 오류가 없다
 *
 * ⚠️ 실패하면 "무엇이 어긋났는지"를 남긴다(수치를 콘솔에 찍는다).
 */
const API = 'http://localhost:4000/api';
const FE = 'http://localhost:5173';
const BE = 'http://localhost:4000';
const STAMP = Date.now();
const DESKTOP = { width: 1440, height: 900 };

interface Seeded { id: number; name: string; email: string; token: string; user: Record<string, unknown> }
const auth = (a: Seeded) => ({ Authorization: `Bearer ${a.token}` });

async function signupArtist(api: APIRequestContext, key: string): Promise<Seeded> {
  const name = `신뢰${key}${String(STAMP).slice(-5)}`;
  const email = `pfrel-${key}-${STAMP}@e2e.test`;
  const r = await api.post(`${API}/auth/signup`, { data: { name, email, password: 'MakerTest1!', role: 'ARTIST', agreeTerms: true, agreePrivacy: true } });
  if (!r.ok()) throw new Error(`작가 ${key} 준비 실패 ${r.status()}: ${await r.text()}`);
  const { token, user } = await r.json();
  return { id: user.id, name, email, token, user };
}
const COLORS: [number, number, number][] = [[190, 70, 60], [60, 130, 90], [60, 80, 170], [200, 160, 60], [120, 70, 150], [70, 150, 170]];
const SIZES: [number, number][] = [[640, 480], [480, 640], [600, 600], [720, 400], [500, 700], [640, 520]];
/** 진짜 사진을 올린다(썸네일이 생겨야 '원본을 안 받는다'를 잴 수 있다) */
async function addWorks(api: APIRequestContext, a: Seeded, n: number) {
  await api.get(`${API}/portfolio`, { headers: auth(a) });
  const ids: number[] = [];
  for (let i = 0; i < n; i++) {
    const [w, h] = SIZES[i % SIZES.length]!;
    const up = await api.post(`${API}/upload/image`, { headers: auth(a), multipart: { image: { name: `w${i}.png`, mimeType: 'image/png', buffer: solidPng(w, h, COLORS[i % COLORS.length]!) } } });
    if (!up.ok()) throw new Error(`사진 올리기 실패 ${up.status()}: ${await up.text()}`);
    const r = await api.post(`${API}/portfolio/images`, { headers: auth(a), data: { url: (await up.json()).url, title: `작품 ${i + 1}`, medium: 'Oil on canvas', year: '2025', sizeText: '72.7×60.6 cm' } });
    if (!r.ok()) throw new Error(`작품 추가 실패 ${r.status()}: ${await r.text()}`);
    ids.push((await r.json()).id);
  }
  await api.put(`${API}/portfolio`, { headers: auth(a), data: { biography: '홍익대학교 회화과 졸업', statement: '첫 작가노트', career: {} } });
  return ids;
}
async function freshArtist(key: string, works: number) {
  const api = await pwRequest.newContext();
  const a = await signupArtist(api, key);
  const ids = await addWorks(api, a, works);
  await api.dispose();
  return { a, ids };
}
const myPortfolio = async (a: Seeded) => {
  const api = await pwRequest.newContext();
  const p = await (await api.get(`${API}/portfolio`, { headers: auth(a) })).json();
  await api.dispose();
  return p;
};

async function openFor(browser: Browser, a: Seeded, opts: { desktop?: boolean } = {}) {
  const extra: BrowserContextOptions = opts.desktop ? { hasTouch: false, isMobile: false, viewport: DESKTOP } : {};
  const ctx = await browser.newContext({
    ...extra,
    acceptDownloads: true,
    storageState: { cookies: [], origins: [{ origin: FE, localStorage: [{ name: 'artlink-auth', value: JSON.stringify({ state: { token: a.token, user: a.user, isAuthenticated: true }, version: 0 }) }] }] },
  });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
  return { ctx, page, errors };
}
const statusPages = async (page: Page) => Number((await page.getByTestId('maker-status').innerText()).match(/(\d+)쪽/)![1]);
const pdfPages = (buf: Buffer) => (buf.toString('latin1').match(/\/Type\s*\/Page(?![a-zA-Z])/g) ?? []).length;
/** 첫 쪽의 크기(pt) — jsPDF 는 쪽마다 MediaBox 를 적는다 */
const mediaBox = (buf: Buffer) => {
  const m = buf.toString('latin1').match(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/);
  return m ? { w: Number(m[1]), h: Number(m[2]) } : null;
};
const designStatus = (page: Page) => makerBar(page).getByRole('status');
async function downloadPdf(page: Page, opts: { upload?: boolean } = {}) {
  await makerBar(page).getByRole('button', { name: 'PDF 저장' }).click();
  const dlg = saveDialog(page);
  await expect(dlg).toBeVisible();
  if (opts.upload) await dlg.getByRole('checkbox', { name: /내 홈페이지 \[포트폴리오\] 탭에도 올리기/ }).check();
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 150_000 }),
    dlg.getByRole('button', { name: 'PDF 내려받기' }).click(),
  ]);
  const result = dlg.getByTestId('save-result');
  await expect(result).toBeVisible({ timeout: 150_000 });
  const buf = fs.readFileSync((await download.path())!);
  return { dlg, result, download, buf };
}
const closeSave = async (page: Page) => {
  await saveDialog(page).getByRole('button', { name: '닫기', exact: true }).last().click();
  await expect(saveDialog(page)).toHaveCount(0);
};
const bgSwatch = (page: Page, label: string) => customizePanel(page).getByRole('group', { name: '배경색' }).getByRole('button', { name: label, exact: true });
const BG: [string, string][] = [['아이보리', 'ivory'], ['샌드', 'sand'], ['미스트', 'mist'], ['블러시', 'blush'], ['화이트', 'white']];

// ─────────────────────────────────────────────────────────────

test('★ R1 디자인을 빠르게 20번 바꿔도 서버에는 마지막 값 — 저장 요청이 겹치지 않는다', async ({ browser }) => {
  test.setTimeout(120_000);
  const { a } = await freshArtist('rapid', 3);
  const { page, ctx, errors } = await openFor(browser, a, { desktop: true });
  const flight = { now: 0, max: 0, sent: 0 };
  const isDesign = (r: { url: () => string; method: () => string }) => r.method() === 'PUT' && new URL(r.url()).pathname === '/api/portfolio/design';
  page.on('request', (r) => { if (isDesign(r)) { flight.now++; flight.sent++; flight.max = Math.max(flight.max, flight.now); } });
  page.on('requestfinished', (r) => { if (isDesign(r)) flight.now--; });
  page.on('requestfailed', (r) => { if (isDesign(r)) flight.now--; });

  await openPortfolioMaker(page);
  await openCustomize(page, '색·글꼴');
  let last = '';
  for (let i = 0; i < 20; i++) {
    const [label, key] = BG[i % BG.length]!;
    await bgSwatch(page, label).click();
    last = key;
    // 여섯 번에 한 번은 0.8초 넘게 쉰다 — 저장이 나가는 도중에 또 바꾸는 경우를 만든다
    if (i % 6 === 5) await page.waitForTimeout(900);
  }
  await expect(designStatus(page)).toContainText('디자인 저장됨', { timeout: 15_000 });
  await expect.poll(async () => (await myPortfolio(a)).designConfig?.bg, { timeout: 8000 }).toBe(last);
  console.log(`  [R1] 클릭 20 · 저장 요청 ${flight.sent} · 동시에 날아간 최대 ${flight.max}`);
  expect(flight.max, '저장 요청이 겹쳤다(응답 순서가 뒤집힐 수 있다)').toBe(1);
  expect(flight.sent, '0.8초 모아 보낸다 — 클릭마다 보내지 않는다').toBeLessThan(20);
  expect(flight.sent).toBeGreaterThan(0);
  expect(errors).toHaveLength(0);
  await ctx.close();
});

for (const desktop of [true, false]) {
  test(`★ R2 저장이 실패하면 보이고, [다시 시도] 로 복구된다 (${desktop ? 'PC' : '휴대폰'})`, async ({ browser }) => {
    test.setTimeout(90_000);
    const { a } = await freshArtist(desktop ? 'failpc' : 'failm', 2);
    const { page, ctx } = await openFor(browser, a, { desktop });
    await openPortfolioMaker(page);
    await page.route('**/api/portfolio/design', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"잠시 문제가 생겼습니다"}' }));
    await openCustomize(page, '색·글꼴');
    await bgSwatch(page, '샌드').click();
    if (!desktop) await customizePanel(page).getByRole('button', { name: '완료' }).click();   // 시트가 아래 바를 덮는다

    // 오류가 보인다 — PC 는 바의 상태 글자, 휴대폰은 바 위의 한 줄(상태 글자가 없는 폭이라 따로 둔다)
    const err = desktop ? designStatus(page) : makerBar(page).getByRole('alert');
    await expect(err).toContainText('디자인을 저장하지 못했어요', { timeout: 10_000 });
    expect((await myPortfolio(a)).designConfig?.bg ?? null, '실패했는데 서버에 들어갔다').not.toBe('sand');

    // 두 번 더 실패해도 화면이 멀쩡하다(다시 시도 → 실패)
    await err.getByRole('button', { name: '다시 시도' }).click();
    await expect(err).toContainText('디자인을 저장하지 못했어요');

    // 복구
    await page.unroute('**/api/portfolio/design');
    await err.getByRole('button', { name: '다시 시도' }).click();
    await expect.poll(async () => (await myPortfolio(a)).designConfig?.bg, { timeout: 8000 }).toBe('sand');
    if (desktop) await expect(designStatus(page)).toContainText('디자인 저장됨');
    else await expect(makerBar(page).getByRole('alert')).toHaveCount(0);
    await ctx.close();
  });
}

test('★ R3 바꾸자마자 다른 화면으로 떠나도 그 디자인이 저장된다', async ({ browser }) => {
  const { a } = await freshArtist('leave', 2);
  const { page, ctx } = await openFor(browser, a, { desktop: true });
  await openPortfolioMaker(page);
  await openCustomize(page, '색·글꼴');
  await bgSwatch(page, '미스트').click();
  // 0.8초를 기다리지 않고 곧바로 떠난다 — 화면을 떠날 때 남은 것을 보내야 한다
  await page.getByRole('link', { name: /작품·글 추가·수정/ }).click();
  await expect(page.getByTestId('homepage-editor')).toBeVisible({ timeout: 15_000 });
  await expect.poll(async () => (await myPortfolio(a)).designConfig?.bg, { timeout: 8000 }).toBe('mist');
  await ctx.close();
});

test('★ R4 탭 둘 — 만들기(디자인)와 홈페이지 편집(글)을 번갈아 3번 저장해도 서로를 지우지 않는다', async ({ browser }) => {
  test.setTimeout(150_000);
  const { a } = await freshArtist('twotabs', 3);
  const { page: maker, ctx } = await openFor(browser, a, { desktop: true });
  const editor = await ctx.newPage();
  const fullSaves: string[] = [];
  maker.on('request', (r) => { if (r.method() === 'PUT' && new URL(r.url()).pathname === '/api/portfolio') fullSaves.push(r.url()); });
  await openPortfolioMaker(maker);
  await openCustomize(maker, '색·글꼴');

  for (let round = 0; round < 3; round++) {
    const [label, key] = BG[round]!;
    await bgSwatch(maker, label).click();
    await expect(designStatus(maker)).toContainText('디자인 저장됨', { timeout: 10_000 });

    // 편집 화면(다른 탭)에서 작가노트를 고쳐 저장 — 저장하면 공개 홈페이지로 간다
    await openHomepageEditor(editor, '소개');
    await editor.getByRole('textbox', { name: '작가노트' }).fill(`${round + 1}번째 작가노트`);
    await editorSave(editor).click();
    await expect(editor).toHaveURL(/\/(portfolio\/\d+|@[a-z0-9._]+)/, { timeout: 15_000 });

    const p = await myPortfolio(a);
    expect(p.designConfig?.bg, `${round + 1}회차: 편집 화면 저장이 디자인을 되돌렸다`).toBe(key);
    expect(p.statement, `${round + 1}회차: 디자인 저장이 글을 되돌렸다`).toBe(`${round + 1}번째 작가노트`);
  }
  expect(fullSaves, '만들기 화면이 포트폴리오 전체를 보냈다').toHaveLength(0);
  await ctx.close();
});

test('★ R5 PDF 를 연달아 4번 — 매번 온전한 PDF, 쪽수·방향이 화면과 같고, 메모리가 계속 늘지 않는다', async ({ browser }) => {
  test.setTimeout(300_000);
  const { a } = await freshArtist('repeat', 5);
  const { page, ctx, errors } = await openFor(browser, a, { desktop: true });
  const cdp = await ctx.newCDPSession(page);
  const heap = async () => { await cdp.send('HeapProfiler.collectGarbage'); return (await cdp.send('Runtime.getHeapUsage')).usedSize / 1048576; };
  await openPortfolioMaker(page);
  const heaps: number[] = [];
  for (let i = 0; i < 4; i++) {
    if (i === 2) {
      await paperRadio(page, '가로 A4').click();
      await expect(paperRadio(page, '가로 A4')).toHaveAttribute('aria-checked', 'true');
    }
    const pages = await statusPages(page);
    const { buf, download } = await downloadPdf(page);
    expect(buf.subarray(0, 5).toString('latin1'), `${i + 1}번째: PDF 머리`).toBe('%PDF-');
    expect(buf.subarray(-8).toString('latin1'), `${i + 1}번째: 파일 끝`).toContain('%%EOF');
    expect(pdfPages(buf), `${i + 1}번째: 화면(${pages}쪽)과 쪽수`).toBe(pages);
    const box = mediaBox(buf)!;
    expect(i >= 2 ? box.w > box.h : box.w < box.h, `${i + 1}번째: 용지 방향 ${box.w}×${box.h}`).toBe(true);
    expect(download.suggestedFilename()).toMatch(/_포트폴리오\.pdf$/);
    await closeSave(page);
    // 창을 닫으면 뒤 화면의 스크롤 잠금이 풀린다(겹겹이 남지 않는다)
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
    heaps.push(await heap());
  }
  console.log(`  [R5] 저장 후 힙(MB) ${heaps.map((h) => h.toFixed(1)).join(' → ')}`);
  // 같은 일을 되풀이했는데 힙이 계속 오르면 쪽 캔버스·사진이 새고 있다. 첫 저장은 라이브러리를 처음 받으므로 둘째부터 본다
  expect(heaps[3]! - heaps[1]!, '두 번 더 저장하는 동안 늘어난 힙(MB)').toBeLessThan(40);
  expect(errors).toHaveLength(0);
  await ctx.close();
});

test('★ R6 홈페이지에 3번 올리기 — 옛 파일은 지워지고 지원서가 쓰는 파일은 남는다, 글을 고쳐 저장해도 파일은 마지막 것', async ({ browser }) => {
  test.setTimeout(300_000);
  const { a } = await freshArtist('upmany', 3);
  const api = await pwRequest.newContext();
  const exId = await createExhibition(api, { title: `신뢰성 공모 ${STAMP}`, galleryId: await ownedGalleryId(api), approve: true });
  const { page, ctx } = await openFor(browser, a, { desktop: true });
  await openPortfolioMaker(page);
  const status = async (url: string) => (await api.get(`${BE}${url}`)).status();
  const urls: string[] = [];
  for (let i = 0; i < 3; i++) {
    const { result } = await downloadPdf(page, { upload: true });
    await expect(result).toContainText('내 홈페이지 [포트폴리오] 탭에 올렸습니다.');
    await closeSave(page);
    const url = (await myPortfolio(a)).portfolioFileUrl as string;
    expect(url, `${i + 1}번째 올린 파일`).toMatch(/^\/uploads\/.+\.pdf$/);
    expect(urls, '같은 주소를 또 썼다').not.toContain(url);
    urls.push(url);
    // 공개 홈페이지가 가리키는 것 = 방금 올린 것
    const pub = await (await api.get(`${API}/portfolio/${a.id}`)).json();
    expect(pub.portfolio?.portfolioFileUrl ?? pub.portfolioFileUrl).toBe(url);
    if (i === 0) {
      // 첫 파일로 지원서를 낸다 — 지원서는 그 주소를 복사해 들고 있다
      const r = await api.post(`${API}/exhibitions/${exId}/apply`, {
        headers: auth(a),
        data: { biography: '신뢰성 약력', artworkImages: ['https://example.com/a.jpg'], portfolioFileUrl: url, termsAgreed: true, termsVersion: applyTermsVersion() },
      });
      expect(r.status(), await r.text()).toBe(201);
    } else {
      const prev = urls[i - 1]!;
      if (prev === urls[0]) expect(await status(prev), '지원서가 쓰는 파일을 지웠다').toBe(200);
      else await expect.poll(() => status(prev), { timeout: 8000, message: '옛 파일이 남았다' }).toBe(404);
    }
    expect(await status(url)).toBe(200);
  }
  // 첫 파일은 끝까지 남는다(지원서가 쓴다)
  expect(await status(urls[0]!)).toBe(200);

  // 같은 탭에서 홈페이지 편집으로 가 글만 고쳐 저장 — 파일은 마지막 것 그대로(옛 주소로 덮이지 않는다)
  await page.getByRole('link', { name: /작품·글 추가·수정/ }).click();
  await openHomepageEditor(page, '소개');
  await page.getByLabel('한 줄 소개').fill('파일을 올린 뒤 고친 소개');
  await editorSave(page).click();
  await expect(page).toHaveURL(/\/(portfolio\/\d+|@[a-z0-9._]+)/, { timeout: 15_000 });
  const p = await myPortfolio(a);
  expect(p.tagline).toBe('파일을 올린 뒤 고친 소개');
  expect(p.portfolioFileUrl, '글 저장이 파일을 되돌렸다').toBe(urls[2]);
  expect(await status(urls[2]!)).toBe(200);
  await api.dispose();
  await ctx.close();
});

test('★ R7 구성 — 동시에 만들어도 12개를 넘지 않고, 구성마다 디자인이 따로이며 오가도 섞이지 않는다', async ({ browser }) => {
  test.setTimeout(150_000);
  const { a, ids } = await freshArtist('versions', 6);
  const api = await pwRequest.newContext();
  const make = (name: string, workIds: number[], design?: Record<string, unknown>) =>
    api.post(`${API}/portfolio/versions`, { headers: auth(a), data: { name, workIds, ...(design ? { design } : {}) } });

  // 10개를 만들고, 남은 2자리에 5개를 동시에 — 정확히 12개
  for (let i = 0; i < 10; i++) expect((await make(`채움 ${i + 1}`, ids)).status()).toBe(201);
  const burst = await fireConcurrently(Array.from({ length: 5 }, (_, i) => () => make(`동시 ${i + 1}`, ids)));
  const codes = await Promise.all(burst.map(async (r) => (r.status === 'fulfilled' ? r.value.status() : 0)));
  const list = async () => ((await myPortfolio(a)).versions ?? []) as { id: number; name: string }[];
  console.log(`  [R7] 동시 5개 → ${codes.join(',')} · 남은 구성 ${(await list()).length}개`);
  expect((await list()).length, '구성이 12개를 넘었다(확인하고 만드는 경합)').toBe(12);
  expect(codes.filter((c) => c === 201)).toHaveLength(2);
  expect(codes.filter((c) => c !== 201 && c !== 400), '400 이 아닌 실패').toHaveLength(0);

  // 둘만 남기고 지운다 — A(2점·아이보리) · B(4점·미스트)
  for (const v of await list()) await api.delete(`${API}/portfolio/versions/${v.id}`, { headers: auth(a) });
  const A = await (await make('공모 A', ids.slice(0, 2), { bg: 'ivory', page: 'a4-portrait' })).json();
  const B = await (await make('갤러리 B', ids.slice(0, 4), { bg: 'mist', page: 'a4-portrait' })).json();
  await api.put(`${API}/portfolio/design`, { headers: auth(a), data: { designConfig: { bg: 'white' } } });

  const { page, ctx } = await openFor(browser, a, { desktop: true });
  await openPortfolioMaker(page);
  await openCustomize(page, '색·글꼴');
  const pick = async (label: RegExp) => {
    await page.getByRole('button', { name: /전체 작품 ·|공모 A ·|갤러리 B ·/ }).click();
    await page.getByRole('menuitem', { name: label }).click();
  };
  const expectState = async (works: number, bgLabel: string) => {
    await expect(page.getByTestId('maker-status')).toContainText(`작품 ${works}점`);
    await expect(bgSwatch(page, bgLabel)).toHaveAttribute('aria-pressed', 'true');
  };
  for (let round = 0; round < 3; round++) {
    await pick(/^공모 A/); await expectState(2, '아이보리');
    await pick(/^갤러리 B/); await expectState(4, '미스트');
    await pick(/^전체 작품/); await expectState(6, '화이트');
  }
  // A 에서 색을 바꾸면 A 만 바뀐다
  await pick(/^공모 A/);
  await bgSwatch(page, '블러시').click();
  await expect(designStatus(page)).toContainText('디자인 저장됨', { timeout: 10_000 });
  const p = await myPortfolio(a);
  const byId = (id: number) => (p.versions as { id: number; design: { bg?: string } }[]).find((v) => v.id === id)!;
  expect(byId(A.id).design.bg).toBe('blush');
  expect(byId(B.id).design.bg, 'B 가 같이 바뀌었다').toBe('mist');
  expect(p.designConfig.bg, '전체 작품이 같이 바뀌었다').toBe('white');
  await api.dispose();
  await ctx.close();
});

test('★ R8 작품 30점 — 들어올 때 원본을 받지 않고, PDF 가 한도 안에서 시간 안에 나온다', async ({ browser }) => {
  test.setTimeout(400_000);
  const { a } = await freshArtist('thirty', 30);
  const { page, ctx, errors } = await openFor(browser, a, { desktop: true });
  const originals: string[] = [];
  page.on('response', (r) => {
    const u = new URL(r.url());
    if (/^\/uploads\/[^/]+\.(jpe?g|png|webp)$/i.test(u.pathname) && r.status() < 400) originals.push(u.pathname);
  });
  await openPortfolioMaker(page);
  await expect(page.getByTestId('maker-status')).toContainText('작품 30점');
  await page.waitForLoadState('networkidle');
  // 미리보기를 끝까지 내려 본다(늦게 받는 사진까지)
  for (let y = 0; y < 30; y++) { await page.mouse.wheel(0, 1600); await page.waitForTimeout(60); }
  await page.waitForLoadState('networkidle');
  expect(originals, '미리보기가 원본 사진을 받았다').toHaveLength(0);

  const pages = await statusPages(page);
  const t0 = Date.now();
  const { buf, result } = await downloadPdf(page);
  const ms = Date.now() - t0;
  console.log(`  [R8] 30점 ${pages}쪽 · ${(buf.length / 1048576).toFixed(2)}MB · ${ms}ms`);
  expect(pdfPages(buf)).toBe(pages);
  expect(buf.length, '공모 한도 10MB').toBeLessThan(10 * 1048576);
  expect(ms, '저장 시간').toBeLessThan(120_000);
  await expect(result).toContainText(`${pages}쪽`);
  expect(errors).toHaveLength(0);
  await ctx.close();
});

test('★ R9 저장 기록 — 동시에 몰려도 하루 100줄을 넘지 않고, 기록 요청은 다 받는다', async () => {
  test.setTimeout(120_000);
  const api = await pwRequest.newContext();
  const a = await signupArtist(api, 'cap');
  const admin = { Authorization: `Bearer ${tokenFor('admin')}` };
  const saves = async () => (await (await api.get(`${API}/admin/stats/portfolio-exports?days=1`, { headers: admin })).json()).totals.saves as number;
  const before = await saves();
  const codes: number[] = [];
  for (let burst = 0; burst < 5; burst++) {
    const rs = await fireConcurrently(Array.from({ length: 26 }, () => () =>
      api.post(`${API}/portfolio/exports`, { headers: auth(a), data: { method: 'download', pages: 7, works: 5, uploaded: false } })));
    codes.push(...await Promise.all(rs.map(async (r) => (r.status === 'fulfilled' ? r.value.status() : 0))));
  }
  const added = (await saves()) - before;
  console.log(`  [R9] 요청 ${codes.length} · 204=${codes.filter((c) => c === 204).length} · 적힌 줄 ${added}`);
  expect(codes.filter((c) => c !== 204), '기록 요청이 실패했다(저장 화면은 이 응답을 기다리지 않지만 오류가 나면 안 된다)').toHaveLength(0);
  expect(added, '하루 100줄 상한을 넘었다(세고 나서 쓰는 경합)').toBe(100);
  await api.dispose();
});

test('★ R10 다른 탭에서 지운 구성 — 이 탭이 404 에 갇히지 않고 전체 작품으로 돌아온다', async ({ browser }) => {
  test.setTimeout(120_000);
  const { a, ids } = await freshArtist('gone', 4);
  const api = await pwRequest.newContext();
  await api.put(`${API}/portfolio/design`, { headers: auth(a), data: { designConfig: { bg: 'white' } } });
  const v = await (await api.post(`${API}/portfolio/versions`, { headers: auth(a), data: { name: '곧 지울 구성', workIds: ids.slice(0, 2), design: { bg: 'ivory' } } })).json();
  const { page, ctx, errors } = await openFor(browser, a, { desktop: true });
  const patches: number[] = [];
  page.on('response', (r) => { if (r.request().method() === 'PATCH' && /\/api\/portfolio\/versions\/\d+$/.test(new URL(r.url()).pathname)) patches.push(r.status()); });
  await openPortfolioMaker(page);
  await page.getByRole('button', { name: /전체 작품 ·/ }).click();
  await page.getByRole('menuitem', { name: /^곧 지울 구성/ }).click();
  await expect(page.getByTestId('maker-status')).toContainText('작품 2점');

  // 다른 곳에서 지운다
  expect((await api.delete(`${API}/portfolio/versions/${v.id}`, { headers: auth(a) })).status()).toBe(200);

  // 이 탭에서 색을 바꾼다 → 지워진 구성으로 가던 저장이 404 → 전체 작품으로 돌아온다
  await openCustomize(page, '색·글꼴');
  await bgSwatch(page, '샌드').click();
  await expect(page.getByTestId('maker-status')).toContainText('작품 4점', { timeout: 10_000 });
  await expect(page.getByText('보던 구성이 다른 곳에서 지워져 전체 작품으로 돌아왔어요.')).toBeVisible();
  await expect(designStatus(page)).not.toContainText('저장하지 못했어요');
  // 전체 작품의 디자인은 지워진 구성의 것(아이보리)으로 덮이지 않았다
  await expect(bgSwatch(page, '화이트')).toHaveAttribute('aria-pressed', 'true');
  expect((await myPortfolio(a)).designConfig.bg).toBe('white');

  // 이제 고치면 전체 작품에 정상으로 저장된다 — 404 가 되풀이되지 않는다
  await bgSwatch(page, '미스트').click();
  await expect(designStatus(page)).toContainText('디자인 저장됨', { timeout: 10_000 });
  expect((await myPortfolio(a)).designConfig.bg).toBe('mist');
  console.log(`  [R10] 지워진 구성으로 간 PATCH ${patches.join(',')}`);
  expect(patches.filter((s) => s === 404).length, '지워진 구성으로 되풀이해 보냈다').toBeLessThanOrEqual(1);
  expect(errors).toHaveLength(0);
  await api.dispose();
  await ctx.close();
});

test('★ R11 휴대폰 — 시트·창을 5바퀴 열고 닫아도 스크롤 잠김이 남지 않고 아래 바가 눌린다', async ({ browser }) => {
  test.setTimeout(150_000);
  const { a } = await freshArtist('mobile', 4);
  const { page, ctx, errors } = await openFor(browser, a);
  await openPortfolioMaker(page);
  const row = makerBar(page).getByRole('group', { name: '편집' });
  for (let round = 0; round < 5; round++) {
    await row.getByRole('button', { name: '표지', exact: true }).click();
    await expect(page.locator('[data-customize="sheet"]')).toBeVisible();
    await customizeTab(page, '약력').click();
    await page.keyboard.press('Escape');                                    // Esc 로 시트 닫기
    await expect(page.locator('[data-customize="sheet"]')).toHaveCount(0);
    await row.getByRole('button', { name: '색·글꼴', exact: true }).click();
    await customizePanel(page).getByRole('button', { name: '완료' }).click();
    await makerBar(page).getByRole('button', { name: /작품 고르기/ }).click();
    await expect(page.getByRole('dialog', { name: '작품 고르기' })).toBeVisible();
    await page.keyboard.press('Escape');
    await makerBar(page).getByRole('button', { name: 'PDF 저장' }).click();
    await saveDialog(page).getByRole('button', { name: '닫기', exact: true }).first().click();
    await previewPage(page, 1).getByRole('button', { name: /크게 보기$/ }).click();
    await expect(page.getByTestId('page-viewer')).toBeVisible();
    await page.getByTestId('page-viewer').getByRole('button', { name: '닫기' }).click();
    expect(await page.evaluate(() => document.body.style.overflow), `${round + 1}바퀴: 스크롤 잠김이 남았다`).toBe('');
    await expect(page.locator('[role="dialog"][aria-modal="true"]')).toHaveCount(0);
  }
  // 아래 바의 [PDF 저장] 자리를 누르면 그 버튼이 잡힌다
  const hit = await page.evaluate(() => {
    const el = document.querySelector('[data-maker-bar] button.bg-gray-900')!;
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!top && (top === el || el.contains(top));
  });
  expect(hit).toBe(true);
  expect(errors).toHaveLength(0);
  await ctx.close();
});

test('★ R12 창을 넓혔다 좁혔다 3번 — 넓으면 패널이 열리고 좁으면 시트가 저절로 덮지 않는다', async ({ browser }) => {
  test.setTimeout(90_000);
  const { a } = await freshArtist('resize', 3);
  const { page, ctx, errors } = await openFor(browser, a, { desktop: true });
  await openPortfolioMaker(page);
  for (let round = 0; round < 3; round++) {
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.locator('[data-customize="panel"]')).toBeVisible();
    await page.setViewportSize({ width: 800, height: 900 });
    await expect(page.locator('[data-customize]')).toHaveCount(0);          // 좁아지면 화면 절반을 덮는 시트로 바뀌지 않는다
    await expect(makerBar(page).getByRole('group', { name: '편집' })).toBeVisible();
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.locator('[data-customize="panel"]')).toBeVisible();
  await expect(customizeTab(page, '표지')).toBeVisible();
  expect(errors).toHaveLength(0);
  await ctx.close();
});
