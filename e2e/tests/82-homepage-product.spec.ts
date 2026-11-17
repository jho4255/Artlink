import { test, expect, request as pwRequest, type APIRequestContext, type Browser, type BrowserContextOptions, type Page } from '@playwright/test';
import { inquireAndOpenChat, ownedGalleryId, solidPng, statePath, tokenFor } from '../lib/helpers';

/**
 * 작가·갤러리 홈페이지 개편 (2026-11-14, CLAUDE.md 규칙 82) — **눌러서 무슨 일이 나는가**.
 *  A '내 사이트' 모드 — ArtLink 상단바·하단 탭바 대신 작가 이름 머리 · 탭 줄은 표지 아래 하나(누르면 그 내용으로) · 꼬리말 Made with ArtLink · 첫 화면에 대표작과 버튼 줄
 *  B 작품을 누르면 작품 페이지(?work=) — 정보 · [작품 문의하기] · ←/→ · 뒤로가기 = 목록 · 공유 링크로 바로 열면 그 작품
 *  C [소식] 탭 — 올린 소식이 카드로(날짜) · 누르면 보기 화면 · 소식이 없으면 탭도 없다
 *  D [문의하기] — 비회원·받기 꺼짐 = 로그인 안내 / 회원 = ArtTalk 방 / 받기 켜짐 = 비회원 이름·연락처 → 주인 벨 → [받은 문의] → 삭제
 *  E 갤러리 PC — 사진 오른쪽 · 이름·버튼·방문 정보 왼쪽 · 관람 시간 · 표지 아래 탭 줄 · 꼬리말
 * 기본 화면은 휴대폰(Pixel 7). PC 확인은 PC 크기 컨텍스트를 따로 연다.
 */
const API = 'http://localhost:4000/api';
const STAMP = Date.now();
const PC: BrowserContextOptions = { viewport: { width: 1280, height: 800 }, hasTouch: false, isMobile: false, deviceScaleFactor: 1 };
interface Seeded { id: number; token: string; name: string }
let artist: Seeded;
/** 소식을 한 번도 안 올린 작가 — 시드 작가 2 는 전체 실행에서 다른 스펙(37·50·80)이 소식을 올려 두어 쓸 수 없다(실행 순서 의존) */
let quiet: Seeded;
const workIds: number[] = [];

async function signupArtist(api: APIRequestContext, tag: string): Promise<Seeded> {
  const name = `홈피${tag}${String(STAMP).slice(-5)}`;
  const r = await api.post(`${API}/auth/signup`, {
    data: { name, email: `hp-${tag}-${STAMP}@e2e.test`, password: 'Homepage1!', role: 'ARTIST', agreeTerms: true, agreePrivacy: true },
  });
  if (!r.ok()) throw new Error(`작가 준비 실패 ${r.status()}: ${await r.text()}`);
  const { token, user } = await r.json();
  return { id: user.id, token, name };
}

test.beforeAll(async () => {
  const api = await pwRequest.newContext();
  artist = await signupArtist(api, 'a');
  const headers = { Authorization: `Bearer ${artist.token}` };
  await api.get(`${API}/portfolio`, { headers });
  for (const [i, [w, h, title]] of ([[480, 600, '첫 작품'], [640, 480, '둘째 작품'], [520, 520, '셋째 작품']] as const).entries()) {
    const up = await api.post(`${API}/upload/image`, { headers, multipart: { image: { name: `hp${i}.png`, mimeType: 'image/png', buffer: solidPng(w, h, [60 + i * 40, 100, 140]) } } });
    const r = await api.post(`${API}/portfolio/images`, { headers, data: { url: (await up.json()).url, title, year: '2025', medium: '캔버스에 유채', sizeText: `${h / 10} × ${w / 10} cm` } });
    workIds.push((await r.json()).id as number);
  }
  // 소식 하나 — [소식] 탭이 생긴다(작가 계정은 하루 10개 상한이라 새 작가로)
  const s = await api.post(`${API}/stories`, { headers, data: { caption: `홈페이지 소식 확인 ${STAMP}` } });
  expect(s.status(), await s.text()).toBe(201);
  quiet = await signupArtist(api, 'q');
  await api.get(`${API}/portfolio`, { headers: { Authorization: `Bearer ${quiet.token}` } });
  await api.dispose();
});

async function openGuest(browser: Browser, opts: BrowserContextOptions = {}, path = `/portfolio/${artist.id}`) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(path);
  await expect(page.getByTestId('homepage-cover')).toBeVisible({ timeout: 20000 });
  return { ctx, page, errors };
}
const header = (page: Page) => page.getByTestId('site-header');

test('A. 내 사이트 모드 — 상단바·하단 탭 대신 작가 이름 머리 · 첫 화면에 대표작과 버튼 줄 · 꼬리말', async ({ browser }) => {
  // 휴대폰
  const m = await openGuest(browser);
  await expect(header(m.page).getByTestId('site-title')).toHaveText(artist.name);
  await expect(header(m.page).getByTestId('artlink-mark')).toBeVisible();
  await expect(m.page.getByRole('navigation', { name: '하단 내비게이션' })).toHaveCount(0);
  await expect(m.page.locator('nav a[href="/artists"]')).toHaveCount(0);   // ArtLink 가운데 메뉴가 없다
  const art = (await m.page.getByTestId('homepage-cover-art').locator('img').boundingBox())!;
  const vh = m.page.viewportSize()!.height;
  expect(art.y + art.height, '대표작이 첫 화면에').toBeLessThanOrEqual(vh);
  // 버튼 묶음 — 탭 줄 오른쪽(2026-11-15). 휴대폰은 [문의하기] + [⋯](이웃 추가·공유·QR). [문의하기]는 채움 상자가 아니라 강조색 글자
  const tablist = m.page.getByRole('tablist', { name: '홈페이지 메뉴' });
  await expect(tablist).toBeVisible();
  const row = m.page.getByTestId('homepage-actions');
  const ask = row.getByRole('button', { name: '문의하기' });
  await expect(ask).toBeVisible();
  expect(await ask.evaluate((el) => getComputedStyle(el).backgroundColor), '채움 상자가 아니다').toBe('rgba(0, 0, 0, 0)');
  const tb = (await tablist.boundingBox())!;
  const ab = (await row.boundingBox())!;
  expect(Math.abs((tb.y + tb.height / 2) - (ab.y + ab.height / 2)), '탭과 같은 줄').toBeLessThan(6);
  await row.getByRole('button', { name: '더 보기' }).click();
  for (const name of [/이웃 추가/, '공유', 'QR']) await expect(m.page.getByTestId('homepage-actions-menu').getByRole('button', { name })).toBeVisible();
  await m.page.keyboard.press('Escape');
  await expect(m.page.getByTestId('homepage-actions-menu')).toHaveCount(0);
  await expect(row.getByRole('button', { name: '메시지' })).toHaveCount(0);
  // 내려도 버튼이 보인다 — 탭 줄과 함께 머리(56px) 밑에 붙는다
  await m.page.mouse.wheel(0, 1500);
  await expect.poll(async () => Math.round((await row.boundingBox())!.y)).toBeGreaterThanOrEqual(56);
  await expect.poll(async () => Math.round((await tablist.boundingBox())!.y)).toBe(56);
  await expect(m.page.getByTestId('made-with-artlink')).toBeVisible();
  expect(await m.page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(m.page.viewportSize()!.width);
  expect(m.errors).toEqual([]);
  await m.ctx.close();

  // PC — 대표작은 오른쪽 칸. 탭 줄은 표지 아래 하나(머리에는 탭이 없다 — 2026-11-15 "우측 상단이라 잘 안 보인다")
  const p = await openGuest(browser, PC);
  const cover = (await p.page.getByTestId('homepage-cover-art').boundingBox())!;
  const h1 = (await p.page.getByRole('heading', { level: 1 }).boundingBox())!;
  expect(cover.x, '대표작이 이름 오른쪽').toBeGreaterThan(h1.x + h1.width - 1);
  expect(cover.y + cover.height, '대표작이 첫 화면에').toBeLessThanOrEqual(800);
  const tabs = p.page.getByRole('tablist', { name: '홈페이지 메뉴' });
  await expect(tabs).toHaveCount(1);
  await expect(header(p.page).getByRole('tablist')).toHaveCount(0);
  expect((await tabs.boundingBox())!.y, '탭 줄은 표지 아래').toBeGreaterThan(cover.y + cover.height - 1);
  // 누르면 그 탭 내용으로 내려간다 — 탭 줄이 머리(72px) 밑에 붙는다
  await tabs.getByRole('tab', { name: /^소식/ }).click();
  await expect(p.page).toHaveURL(/tab=news/);
  await expect.poll(async () => Math.round((await tabs.boundingBox())!.y)).toBe(72);
  expect(p.errors).toEqual([]);
  await p.ctx.close();
});

test('B. 작품을 누르면 작품 페이지 — ?work= · 정보 · ←/→ · 뒤로가기 = 목록 · 공유 링크로 바로 열면 그 작품', async ({ browser }) => {
  const { ctx, page, errors } = await openGuest(browser, PC);
  const list = page.url();
  await page.locator('[role="tabpanel"] figure button').nth(1).click();
  const sheet = page.getByTestId('work-sheet');
  await expect(sheet).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`work=${workIds[1]}`));
  await expect(sheet.getByRole('heading', { level: 1 })).toHaveText('둘째 작품');
  await expect(sheet.getByTestId('work-meta')).toContainText('캔버스에 유채');
  await expect(sheet.getByRole('button', { name: '작품 문의하기' }).first()).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(page).toHaveURL(new RegExp(`work=${workIds[2]}`));
  await expect(sheet.getByRole('heading', { level: 1 })).toHaveText('셋째 작품');
  // 넘긴 것은 기록을 쌓지 않는다 — 뒤로가기 한 번이면 목록
  await page.goBack();
  await expect(sheet).toHaveCount(0);
  expect(page.url()).toBe(list);
  // 공유 링크로 바로 들어오면 그 작품 · 닫으면 주소에서 work 를 뗀다(기록이 없으니 뒤로가 아니다)
  await page.goto(`/portfolio/${artist.id}?work=${workIds[0]}`);
  await expect(sheet.getByRole('heading', { level: 1 })).toHaveText('첫 작품', { timeout: 15000 });
  await sheet.getByRole('button', { name: '작품 목록으로' }).click();
  await expect(sheet).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get('work')).toBeNull();
  // 지운 작품 링크면 목록 그대로(빈 화면 금지)
  await page.goto(`/portfolio/${artist.id}?work=999999`);
  await expect(page.getByTestId('homepage-cover')).toBeVisible({ timeout: 15000 });
  await expect(sheet).toHaveCount(0);
  expect(errors).toEqual([]);
  await ctx.close();
});

test('C. [소식] 탭 — 올린 소식이 카드로 · 누르면 보기 화면 · 소식 없는 작가는 탭이 없다', async ({ browser }) => {
  const { ctx, page, errors } = await openGuest(browser);
  const tab = page.getByRole('tablist', { name: '홈페이지 메뉴' }).getByRole('tab', { name: '소식' });
  await tab.click();
  await expect(page).toHaveURL(/tab=news/);
  const card = page.getByTestId('homepage-news').locator('[data-story-card]').first();
  await expect(card).toBeVisible({ timeout: 15000 });
  await expect(card.locator('[data-story-date]')).toHaveText(/\d+월 \d+일/);   // 카드 머리는 이름 대신 올린 날
  await card.click();
  await expect(page.getByRole('dialog').filter({ hasText: `홈페이지 소식 확인 ${STAMP}` }).first()).toBeVisible({ timeout: 15000 });
  await page.keyboard.press('Escape');
  // 소식 없는 작가는 [소식] 탭이 없다
  await page.goto(`/portfolio/${quiet.id}`);
  await expect(page.getByTestId('homepage-cover')).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('tab', { name: '소식' })).toHaveCount(0);
  expect(errors).toEqual([]);
  await ctx.close();
});

test('D. [문의하기] — 비회원(꺼짐)=로그인 안내 · 회원=ArtTalk · 켜면 비회원 이름·연락처 → 벨 → [받은 문의] → 삭제', async ({ browser }) => {
  // ① 비회원 · 받기 꺼짐(기본)
  const g = await openGuest(browser);
  await g.page.getByTestId('homepage-actions').getByRole('button', { name: '문의하기' }).click();
  const sheet = g.page.getByTestId('inquiry-sheet');
  await expect(sheet.getByRole('button', { name: '로그인' })).toBeVisible();
  await expect(sheet.getByRole('textbox')).toHaveCount(0);
  await g.page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);

  // ② 회원 → ArtTalk 방(첫 글이 남는다)
  const member = await browser.newContext({ storageState: statePath('artist2') });
  const mp = await member.newPage();
  await inquireAndOpenChat(mp, `/portfolio/${artist.id}`, `홈페이지 문의 확인 ${STAMP}`);
  await expect(mp.locator('body')).toContainText(`홈페이지 문의 확인 ${STAMP}`, { timeout: 10000 });
  await member.close();

  // ③ 작가가 받기를 켠다(편집 화면 [꾸미기] '문의') — 저장 요청에 실린다
  const owner = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await owner.addInitScript(([token, id]) => {
    localStorage.setItem('artlink-auth', JSON.stringify({ state: { token, user: { id, role: 'ARTIST', name: 'x' }, isAuthenticated: true }, version: 0 }));
    localStorage.setItem('artlink-homepage-nudge-snooze', JSON.stringify({ [id]: 8.64e15 }));
  }, [artist.token, artist.id] as const);
  const op = await owner.newPage();
  await op.goto('/mypage?tab=homepage-edit&section=style');
  const toggle = op.getByTestId('guest-inquiry');
  await expect(toggle).not.toBeChecked({ timeout: 15000 });
  await toggle.check();
  const saved = op.waitForRequest((r) => r.url().endsWith('/api/portfolio') && r.method() === 'PUT');
  await op.locator('[data-save-bar]').getByRole('button', { name: '저장', exact: true }).click();
  expect((await saved).postDataJSON().guestInquiry).toBe(true);

  // ④ 비회원이 이름·연락처로 보낸다 — 동의가 있어야 보내진다
  await g.page.reload();
  await g.page.getByTestId('homepage-actions').getByRole('button', { name: '문의하기' }).click();
  await sheet.getByRole('textbox', { name: '이름' }).fill('E2E 방문자');
  await sheet.getByRole('textbox', { name: /^연락처/ }).fill('e2e-visitor@example.com');
  await sheet.getByRole('textbox', { name: '내용' }).fill(`비회원 문의 ${STAMP}`);
  await sheet.getByRole('button', { name: '보내기' }).click();
  await expect(sheet.getByRole('alert')).toHaveText('개인정보 수집·이용에 동의해 주세요.');
  await sheet.getByTestId('inquiry-agree').check();
  const posted = g.page.waitForResponse((r) => r.url().endsWith('/api/homepage-inquiries') && r.request().method() === 'POST');
  await sheet.getByRole('button', { name: '보내기' }).click();
  expect((await posted).status()).toBe(201);
  await expect(sheet.getByText('문의를 보냈어요')).toBeVisible();
  await g.ctx.close();

  // ⑤ 작가 — 벨 알림 링크 → [받은 문의]가 그 문의를 펼친다 → 삭제
  const notes = await (await op.request.get(`${API}/notifications`, { headers: { Authorization: `Bearer ${artist.token}` } })).json();
  const list = Array.isArray(notes) ? notes : notes.notifications ?? notes.items ?? [];
  const note = list.find((n: { type: string }) => n.type === 'HOMEPAGE_INQUIRY');
  expect(note, '주인 벨에 홈페이지 문의 알림').toBeTruthy();
  expect(note.message).not.toContain('e2e-visitor@example.com');   // 연락처는 잠금 화면에 띄우지 않는다
  await op.goto(note.linkUrl);
  const box = op.getByTestId('received-inquiries');
  await expect(box.getByText('e2e-visitor@example.com')).toBeVisible({ timeout: 15000 });
  await expect(op).not.toHaveURL(/inquiry=/);
  await box.getByRole('button', { name: '삭제' }).click();
  await op.getByRole('dialog').getByRole('button', { name: '삭제' }).click();
  await expect(box.getByText('아직 받은 문의가 없어요.')).toBeVisible({ timeout: 10000 });
  await owner.close();
});

test('E. 갤러리 PC — 사진 오른쪽 · 이름·방문 정보 왼쪽 · 관람 시간 · 표지 아래 탭 줄(오른쪽에 버튼 묶음) · 꼬리말 · 찜은 버튼 묶음', async ({ browser }) => {
  const api = await pwRequest.newContext();
  const gid = await ownedGalleryId(api);
  const r = await api.patch(`${API}/galleries/${gid}/detail`, { headers: { Authorization: `Bearer ${tokenFor('gallery')}` }, data: { openHours: '화–일 11:00–18:00 · 월 휴관' } });
  expect(r.ok(), await r.text()).toBe(true);
  await api.dispose();

  const ctx = await browser.newContext({ ...PC, storageState: statePath('artist') });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`/galleries/${gid}`);
  const cover = page.getByTestId('gallery-cover');
  await expect(cover).toBeVisible({ timeout: 20000 });
  await expect(header(page)).toBeVisible();
  await expect(page.locator('nav a[href="/artists"]')).toHaveCount(0);
  const info = page.getByTestId('gallery-visit-info');
  await expect(info).toContainText('화–일 11:00–18:00 · 월 휴관');
  await expect(info.getByRole('link', { name: '지도' })).toHaveAttribute('href', /map\.kakao\.com/);
  const row = page.getByTestId('homepage-actions');   // 탭 줄 오른쪽(2026-11-15) — PC 는 한 줄에 다 보인다
  await expect(row.getByRole('button', { name: '문의하기' })).toBeVisible();
  await expect(row.getByRole('button', { name: '찜' })).toBeVisible();   // 로그인한 작가 — 하트는 사진 위가 아니라 버튼 줄
  const carousel = page.getByRole('button', { name: '다음 사진' });
  if (await carousel.count()) {
    const photo = (await carousel.boundingBox())!;
    expect(photo.x, '사진이 오른쪽 칸').toBeGreaterThan((await cover.boundingBox())!.x + 200);
  }
  const tabs = page.getByRole('tablist', { name: '갤러리 메뉴' });
  await expect(tabs).toHaveCount(1);
  await expect(header(page).getByRole('tablist')).toHaveCount(0);   // PC 도 표지 아래 탭 줄(2026-11-15)
  const cb = (await cover.boundingBox())!;
  expect((await tabs.boundingBox())!.y, '탭 줄은 표지 아래').toBeGreaterThan(cb.y + cb.height - 1);
  await tabs.getByRole('tab', { name: /^리뷰/ }).click();
  await expect.poll(async () => Math.round((await tabs.boundingBox())!.y)).toBe(72);   // 그 탭 내용으로 내려간다
  await expect(page.getByTestId('site-footer')).toContainText('화–일 11:00–18:00');
  expect(errors).toEqual([]);
  await ctx.close();
});
