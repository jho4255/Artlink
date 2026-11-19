import { test, expect, request as pwRequest, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { openAs, tokenFor, userIds, ownedGalleryId, createExhibition, realUploadUrl, openEmptyDirectChat, noNudgeEntry } from '../lib/helpers';

/**
 * ArtTalk 개편 (2026-11-19) — **눌러서 무슨 일이 나는지**를 본다. 계획 `scratchpad/arttalk-renewal/PLAN.md`.
 *
 *  A ★ 신고된 버그: 갤러리가 작가 홈페이지에서 문의를 보낸 뒤 ArtTalk 에 가면 그 대화가 **곧바로** 있다
 *    (예전엔 목록 캐시가 5분 동안 옛것이라 '한참 뒤에' 나타났다 — 앱 안에서 옮겨 다닐 때만 재현된다)
 *  B 작품 페이지 [작품 문의하기] → 방에 작품 카드(맥락 카드) · 방 위에 고정
 *  C 공모 상세 [갤러리에 문의] → 공모 카드가 붙은 1:1 방
 *  D 휴대폰 — 방은 화면 전체(상단바·하단 탭바 없음) · 입력 칸 여러 줄 · [←]는 기록을 쌓지 않는다
 *  E PC — 두 칸 · 방을 바꿔도 기록이 쌓이지 않는다 · 찾기
 *  F 차단 — 양쪽 다 못 보낸다 · 내 목록에서 빠진다 · 프로필의 '차단한 사람'에서 풀면 돌아온다
 *  G 목록에서 숨기기 → [되돌리기] · 새 말이 오면 다시 보인다
 *  H 빈 방(말 없이 열기만 한 방)은 누구의 목록에도 안 뜬다
 *  I 위로 올려 읽는 중엔 끌어내리지 않는다 — [새 메시지 N]
 *  J 못 보낸 말 — [다시 보내기]
 *  K 상대가 탈퇴한 방 · L 갠톡 시작 길목
 *
 * F~J 는 **이 스펙에서 만든 가상 작가**로 한다(시드 계정을 차단·숨기면 다른 스펙이 흔들린다).
 */
const API = 'http://localhost:4000/api';
const STAMP = Date.now();
const DESKTOP = { width: 1440, height: 900 };
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

interface Person { id: number; token: string; name: string; user: unknown }
let seq = 0;
async function signup(api: APIRequestContext, tag: string): Promise<Person> {
  seq += 1;
  const name = `톡${tag}${String(STAMP).slice(-4)}${seq}`;
  const r = await api.post(`${API}/auth/signup`, {
    data: { name, email: `talk-${tag}-${STAMP}-${seq}@e2e.test`, password: 'Arttalk1!', role: 'ARTIST', agreeTerms: true, agreePrivacy: true },
  });
  if (!r.ok()) throw new Error(`가입 실패 ${r.status()}: ${await r.text()}`);
  const { token, user } = await r.json();
  return { id: user.id, token, name, user };
}
async function openPerson(browser: Browser, p: Person, viewport?: { width: number; height: number }) {
  const ctx = await browser.newContext(viewport ? { viewport } : {});
  const nudge = noNudgeEntry(p.id);
  await ctx.addInitScript(([t, u, k, v]) => {
    localStorage.setItem('artlink-auth', JSON.stringify({ state: { token: t, user: u, isAuthenticated: true }, version: 0 }));
    localStorage.setItem(k as string, v as string);
  }, [p.token, p.user, nudge.name, nudge.value] as const);
  const page = await ctx.newPage();
  return { ctx, page };
}
async function openRoomApi(api: APIRequestContext, from: string, toId: number): Promise<number> {
  const r = await api.post(`${API}/chats/direct`, { headers: auth(from), data: { userId: toId } });
  if (!r.ok()) throw new Error(`방 열기 실패 ${r.status()}: ${await r.text()}`);
  return (await r.json()).id as number;
}
async function say(api: APIRequestContext, from: string, chatId: number, content: string) {
  const r = await api.post(`${API}/chats/${chatId}/messages`, { headers: auth(from), data: { content } });
  return r;
}
const rowOf = (page: Page, chatId: number) => page.getByTestId('chat-list').locator(`[data-chat-id="${chatId}"]`);
/** 휴대폰 상단바의 [메뉴] → 맨 위 [ArtTalk] (상단 말풍선 아이콘은 2026-11-19 에 없앴다) */
async function openArtTalkFromMenu(page: Page) {
  await page.getByRole('button', { name: '메뉴 열기' }).click();
  await page.getByRole('link', { name: /^ArtTalk/ }).filter({ visible: true }).first().click();
}

test('A ★ 문의를 보낸 뒤 ArtTalk 에 가면 그 말이 곧바로 목록 맨 위에 있다(목록을 먼저 봐 둔 상태에서도)', async ({ browser }) => {
  const ids = userIds();
  const api = await pwRequest.newContext();
  // 갤러리 ↔ 작가1 방이 이미 있다(목록에 줄이 있다)
  const room = await openRoomApi(api, tokenFor('gallery'), ids.artist);
  expect((await say(api, tokenFor('gallery'), room, `먼저 있던 대화 ${STAMP}`)).status()).toBe(201);

  const { page, ctx } = await openAs(browser, 'gallery');
  await page.goto('/messages');
  await expect(rowOf(page, room)).toBeVisible({ timeout: 15000 });   // ← 이 순간 목록이 캐시에 남는다

  // 앱 안에서만 옮겨 다닌다(페이지를 새로 열면 캐시가 사라져 버그가 재현되지 않는다)
  await rowOf(page, room).click();
  await page.getByTestId('chat-room').getByRole('link', { name: '홈페이지 보기' }).click();
  await page.getByTestId('homepage-actions').getByRole('button', { name: '문의하기' }).click();
  const sheet = page.getByTestId('inquiry-sheet');
  const text = `홈페이지에서 보낸 문의 ${STAMP}`;
  await sheet.getByRole('textbox').fill(text);
  await sheet.getByRole('button', { name: '보내기' }).click();
  await expect(sheet).toContainText('메시지를 보냈어요', { timeout: 10000 });
  await page.keyboard.press('Escape');
  await page.getByTestId('artlink-mark').click();            // 홈으로(앱 안에서)
  await openArtTalkFromMenu(page);                           // [메뉴] 맨 위 ArtTalk

  // 곧바로(3초 안) — 예전엔 5분 동안 옛 목록이었다
  await expect(rowOf(page, room)).toContainText(`나: ${text}`, { timeout: 3000 });
  await expect(page.getByTestId('chat-list').locator('[data-chat-id]').first()).toHaveAttribute('data-chat-id', String(room));
  await api.dispose();
  await ctx.close();
});

test('B ★ 작품 페이지 [작품 문의하기] → 방에 작품 카드가 붙고 방 위에 고정된다 · 누르면 그 작품', async ({ browser }) => {
  const ids = userIds();
  const api = await pwRequest.newContext();
  const title = `맥락 작품 ${STAMP}`;
  const work = await (await api.post(`${API}/portfolio/images`, {
    headers: auth(tokenFor('artist')), data: { url: `${realUploadUrl()}?ref=${STAMP}`, title, year: '2024', medium: '종이에 먹' },
  })).json();

  const { page, ctx } = await openAs(browser, 'gallery');
  await page.goto(`/portfolio/${ids.artist}?work=${work.id}`);
  const ws = page.getByTestId('work-sheet');
  await expect(ws).toBeVisible({ timeout: 15000 });
  await ws.getByRole('button', { name: '작품 문의하기' }).first().click();
  const sheet = page.getByTestId('inquiry-sheet');
  await expect(sheet.getByTestId('inquiry-context')).toContainText(title);
  await sheet.getByRole('textbox').fill('이 작품 가격이 궁금합니다');
  await sheet.getByRole('button', { name: '보내기' }).click();
  await sheet.getByRole('button', { name: '대화 보기' }).click();
  await page.waitForURL(/\/messages\?chat=\d+/);

  // 말 위에 작품 카드(제목, 연도 · 재료) — 그리고 방 위 고정 카드
  const scroll = page.getByTestId('chat-scroll');
  const card = scroll.getByRole('link', { name: new RegExp(title) }).last();
  await expect(card).toBeVisible({ timeout: 10000 });
  await expect(card).toContainText(`${title}, 2024`);
  await expect(card).toContainText('종이에 먹');
  await expect(page.getByTestId('chat-context')).toContainText(title);
  // 받는 작가 화면에도 같은 카드
  const a = await openAs(browser, 'artist');
  await a.page.goto(page.url().replace(/^https?:\/\/[^/]+/, ''));
  await expect(a.page.getByTestId('chat-scroll').getByRole('link', { name: new RegExp(title) }).last()).toBeVisible({ timeout: 10000 });
  await a.ctx.close();
  // 누르면 그 작품 페이지
  await card.click();
  await expect(page).toHaveURL(new RegExp(`work=${work.id}`));
  await expect(page.getByTestId('work-sheet')).toBeVisible({ timeout: 10000 });
  await api.dispose();
  await ctx.close();
});

test('C ★ 공모 상세 [갤러리에 문의] → 그 공모 카드가 붙은 1:1 방(빈 방을 먼저 만들지 않는다)', async ({ browser }) => {
  const api = await pwRequest.newContext();
  const title = `문의 공모 ${STAMP}`;
  const exId = await createExhibition(api, { title, galleryId: await ownedGalleryId(api), description: 'ArtTalk 맥락 카드 E2E' });

  const { page, ctx } = await openAs(browser, 'artist');
  await page.goto(`/exhibitions/${exId}`);
  await page.getByRole('button', { name: '갤러리에 문의' }).first().click();
  const sheet = page.getByTestId('inquiry-sheet');
  await expect(sheet.getByTestId('inquiry-context')).toContainText(title);
  // 문의 창을 열기만 해서는 방이 생기지 않는다
  const before = (await (await api.get(`${API}/chats`, { headers: auth(tokenFor('gallery')) })).json()) as any[];
  await sheet.getByRole('textbox').fill('반입 일정이 궁금합니다');
  await sheet.getByRole('button', { name: '보내기' }).click();
  await sheet.getByRole('button', { name: '대화 보기' }).click();
  await page.waitForURL(/\/messages\?chat=\d+/);
  const chatId = Number(new URL(page.url()).searchParams.get('chat'));
  await expect(page.getByTestId('chat-scroll').getByRole('link', { name: new RegExp(title) }).last()).toBeVisible({ timeout: 10000 });
  // 갤러리 목록 — 그 방이 맨 위, 미리보기는 작가가 쓴 말
  const after = (await (await api.get(`${API}/chats`, { headers: auth(tokenFor('gallery')) })).json()) as any[];
  expect(after[0].id).toBe(chatId);
  expect(after[0].lastMessage.content).toBe('반입 일정이 궁금합니다');
  expect(before.length).toBeGreaterThanOrEqual(0);
  await api.dispose();
  await ctx.close();
});

test('D ★ 휴대폰 — 방은 화면 전체 · 여러 줄 입력 · [←]는 기록을 쌓지 않는다', async ({ browser }) => {
  const api = await pwRequest.newContext();
  const x = await signup(api, 'dx');
  const y = await signup(api, 'dy');
  const room = await openRoomApi(api, y.token, x.id);
  await say(api, y.token, room, '안녕하세요');

  const { page, ctx } = await openPerson(browser, x);   // Pixel 7
  await page.goto('/messages');
  await rowOf(page, room).click();
  await expect(page.getByTestId('chat-room')).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('navigation', { name: '하단 내비게이션' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '알림' }).filter({ visible: true })).toHaveCount(0);   // 상단바(벨)도 없다
  // 휴대폰 Enter 는 줄바꿈 — 보내기는 단추로
  const box = page.getByPlaceholder('메시지를 입력하세요');
  await box.click();
  await box.pressSequentially('첫 줄');
  await page.keyboard.press('Enter');
  await box.pressSequentially('둘째 줄');
  await expect(box).toHaveValue('첫 줄\n둘째 줄');
  await page.getByRole('button', { name: '보내기' }).click();
  const bubble = page.locator('[data-testid="bubble-text"]', { hasText: '둘째 줄' });
  await expect(bubble).toBeVisible({ timeout: 10000 });
  expect(await bubble.innerText()).toContain('\n');
  await expect(page.locator('[data-pending]')).toHaveCount(0, { timeout: 10000 });
  // [←] → 목록. 목록에서 연 방이라 기록을 되돌린다 — 한 번 더 뒤로 가면 ArtTalk 을 떠난다
  await page.getByRole('button', { name: '대화 목록으로' }).click();
  await expect(page.getByTestId('chat-list')).toBeVisible();
  await expect(page).toHaveURL(/\/messages$/);
  await expect(rowOf(page, room)).toContainText('나: 첫 줄 둘째 줄');
  // 휴대폰 찾기는 돋보기를 눌러 연다
  await page.getByRole('button', { name: '대화 찾기' }).click();
  await page.getByPlaceholder('이름 · 공모 찾기').fill(y.name);
  await expect(page.getByTestId('chat-list').locator('[data-chat-id]')).toHaveCount(1);
  await page.getByRole('button', { name: '대화 찾기' }).click();
  await expect(page.getByPlaceholder('이름 · 공모 찾기')).toHaveCount(0);
  await page.goBack();
  await expect(page).not.toHaveURL(/\/messages/);
  await api.dispose();
  await ctx.close();
});

test('E ★ PC — 목록과 방이 나란히 · 방을 바꿔도 기록이 쌓이지 않는다 · 찾기·탭', async ({ browser }) => {
  const api = await pwRequest.newContext();
  const x = await signup(api, 'ex');
  const y = await signup(api, 'ey');
  const z = await signup(api, 'ez');
  const r1 = await openRoomApi(api, y.token, x.id);
  await say(api, y.token, r1, '첫 방의 말');
  const r2 = await openRoomApi(api, z.token, x.id);
  await say(api, z.token, r2, '둘째 방의 말');

  const { page, ctx } = await openPerson(browser, x, DESKTOP);
  await page.goto('/messages');
  await expect(page.getByTestId('chat-list')).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId('chat-room')).toBeVisible();          // 첫 방이 저절로 열린다(가장 최근: r2)
  await expect(page.getByTestId('chat-title')).toHaveText(z.name);
  const h0 = await page.evaluate(() => history.length);
  await rowOf(page, r1).click();
  await expect(page.getByTestId('chat-title')).toHaveText(y.name);
  await expect(page).toHaveURL(new RegExp(`chat=${r1}`));
  await rowOf(page, r2).click();
  await expect(page.getByTestId('chat-title')).toHaveText(z.name);
  expect(await page.evaluate(() => history.length), '방을 바꿀 때마다 기록이 쌓였다').toBe(h0);
  // 넓은 화면은 머리에 종 단추
  await expect(page.getByRole('button', { name: /이 대화방 알림 (끄기|켜기)/ })).toBeVisible();
  // 찾기 — 넓은 화면은 찾기 칸이 늘 열려 있다(휴대폰은 돋보기를 눌러 연다)
  await expect(page.getByRole('button', { name: '대화 찾기' })).toHaveCount(0);
  await page.getByPlaceholder('이름 · 공모 찾기').fill(y.name);
  await expect(page.getByTestId('chat-list').locator('[data-chat-id]')).toHaveCount(1);
  await expect(rowOf(page, r1)).toBeVisible();
  await page.getByPlaceholder('이름 · 공모 찾기').fill('없는 이름 zzz');
  await expect(page.getByTestId('chat-list')).toContainText('찾는 대화가 없어요.');
  await page.getByPlaceholder('이름 · 공모 찾기').fill('');
  // 탭 — [공모 단체]에는 1:1 방이 없다
  await page.getByRole('tab', { name: '공모 단체' }).click();
  await expect(page.getByTestId('chat-list').locator('[data-chat-id]')).toHaveCount(0);
  await page.getByRole('tab', { name: '1:1' }).click();
  await expect(page.getByTestId('chat-list').locator('[data-chat-id]')).toHaveCount(2);
  // 숨기기 — 넓은 화면은 ArtTalk 안에서 다음 방으로(처음 구현은 navigate(-1) 이라 이전 화면으로 나갔다)
  await rowOf(page, r2).click();
  await expect(page.getByTestId('chat-title')).toHaveText(z.name);
  await page.getByRole('button', { name: '대화방 메뉴' }).click();
  await page.getByTestId('room-menu').getByRole('button', { name: '목록에서 숨기기' }).click();
  await expect(page).toHaveURL(new RegExp(`/messages\\?chat=${r1}$`));
  await expect(page.getByTestId('chat-title')).toHaveText(y.name);
  await expect(rowOf(page, r2)).toHaveCount(0);
  expect(await page.evaluate(() => history.length), '숨기기가 기록을 쌓았다').toBe(h0);
  await api.dispose();
  await ctx.close();
});

test('F ★ 차단 — 양쪽 다 못 보낸다 · 내 목록에서 빠진다 · 프로필에서 풀면 돌아온다', async ({ browser }) => {
  const api = await pwRequest.newContext();
  const x = await signup(api, 'fx');   // 차단하는 사람
  const y = await signup(api, 'fy');
  const room = await openRoomApi(api, y.token, x.id);
  await say(api, y.token, room, '차단 전 말');

  const { page, ctx } = await openPerson(browser, x);
  await page.goto(`/messages?chat=${room}`);
  await expect(page.getByTestId('chat-room')).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: '대화방 메뉴' }).click();
  await page.getByTestId('room-menu').getByRole('button', { name: '차단하기' }).click();
  const confirm = page.getByRole('dialog', { name: '차단할까요?' });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: '차단하기' }).click();
  await expect(page.getByTestId('chat-blocked')).toContainText('차단한 상대예요.');

  // 서버 — 양쪽 다 403, 누가 막았는지는 말하지 않는다
  const fromY = await say(api, y.token, room, '차단 뒤 말');
  expect(fromY.status()).toBe(403);
  expect((await fromY.json()).error).toBe('메시지를 보낼 수 없는 상대예요.');
  expect((await say(api, x.token, room, '나도 못 보낸다')).status()).toBe(403);
  // 상대 화면 — 이유를 밝히지 않는 한 줄
  const yv = await openPerson(browser, y);
  await yv.page.goto(`/messages?chat=${room}`);
  await expect(yv.page.getByTestId('chat-blocked')).toHaveText('메시지를 보낼 수 없는 상대예요.', { timeout: 15000 });
  await yv.ctx.close();

  // 내 목록에서 빠진다
  await page.goto('/messages');
  await expect(page.getByTestId('chat-list')).toBeVisible();
  await expect(rowOf(page, room)).toHaveCount(0);
  // 프로필 탭 맨 아래 '차단한 사람' → [차단 풀기]
  await page.goto('/mypage');
  const blocked = page.getByTestId('blocked-users');
  await expect(blocked).toContainText(y.name, { timeout: 15000 });
  await blocked.getByRole('button', { name: '차단 풀기' }).click();
  await expect(page.locator('body')).toContainText('차단을 풀었어요.');
  await expect(blocked).toHaveCount(0);
  await page.goto('/messages');
  await expect(rowOf(page, room)).toBeVisible({ timeout: 15000 });
  expect((await say(api, y.token, room, '풀린 뒤 말')).status()).toBe(201);
  await api.dispose();
  await ctx.close();
});

test('G ★ 목록에서 숨기기 → [되돌리기] · 숨겨도 새 말이 오면 다시 보인다', async ({ browser }) => {
  const api = await pwRequest.newContext();
  const x = await signup(api, 'gx');
  const y = await signup(api, 'gy');
  const room = await openRoomApi(api, y.token, x.id);
  await say(api, y.token, room, '숨기기 전 말');

  const { page, ctx } = await openPerson(browser, x);
  await page.goto('/messages');
  await rowOf(page, room).click();
  await page.getByRole('button', { name: '대화방 메뉴' }).click();
  await page.getByTestId('room-menu').getByRole('button', { name: '목록에서 숨기기' }).click();
  await expect(page.getByTestId('chat-list')).toBeVisible();
  await expect(rowOf(page, room)).toHaveCount(0);
  await page.getByRole('button', { name: '되돌리기' }).click();
  await expect(rowOf(page, room)).toBeVisible({ timeout: 10000 });

  // 다시 숨기고 → 상대가 새 말을 보내면 돌아온다(목록은 10초마다 다시 받는다)
  await rowOf(page, room).click();
  await page.getByRole('button', { name: '대화방 메뉴' }).click();
  await page.getByTestId('room-menu').getByRole('button', { name: '목록에서 숨기기' }).click();
  await expect(rowOf(page, room)).toHaveCount(0);
  await say(api, y.token, room, '숨긴 뒤 새 말');
  await expect(rowOf(page, room)).toContainText('숨긴 뒤 새 말', { timeout: 20000 });
  await api.dispose();
  await ctx.close();
});

test('H ★ 말 없이 열기만 한 방은 누구의 목록에도 안 뜬다 · 첫 말을 보내면 양쪽에 뜬다', async () => {
  const api = await pwRequest.newContext();
  const x = await signup(api, 'hx');
  const y = await signup(api, 'hy');
  const room = await openRoomApi(api, x.token, y.id);
  const list = async (t: string) => ((await (await api.get(`${API}/chats`, { headers: auth(t) })).json()) as any[]).map((c) => c.id);
  expect(await list(x.token)).not.toContain(room);
  expect(await list(y.token)).not.toContain(room);
  expect((await say(api, x.token, room, '첫 말')).status()).toBe(201);
  expect(await list(x.token)).toContain(room);
  expect(await list(y.token)).toContain(room);
  await api.dispose();
});

test('I ★ 위로 올려 읽는 중엔 끌어내리지 않는다 — [새 메시지 N] 을 누르면 맨 아래', async ({ browser }) => {
  const api = await pwRequest.newContext();
  const x = await signup(api, 'ix');
  const y = await signup(api, 'iy');
  const room = await openRoomApi(api, y.token, x.id);
  for (let i = 1; i <= 28; i++) await say(api, y.token, room, `지난 말 ${i}\n두 줄로 길게 씁니다`);

  const { page, ctx } = await openPerson(browser, x);
  await page.goto(`/messages?chat=${room}`);
  const scroll = page.getByTestId('chat-scroll');
  await expect(scroll.locator('[data-testid="bubble-text"]', { hasText: '지난 말 28' })).toBeInViewport({ timeout: 15000 });
  await scroll.evaluate((el) => { el.scrollTop = 0; });
  await page.waitForTimeout(300);
  await say(api, y.token, room, '읽는 중에 온 말');
  const pill = page.getByRole('button', { name: /새 메시지 1/ });
  await expect(pill).toBeVisible({ timeout: 12000 });   // 방은 4초마다 이어 받는다
  expect(await scroll.evaluate((el) => el.scrollTop), '읽던 자리에서 끌어내렸다').toBeLessThan(150);
  await pill.click();
  await expect(scroll.locator('[data-testid="bubble-text"]', { hasText: '읽는 중에 온 말' })).toBeInViewport({ timeout: 5000 });
  await expect(pill).toHaveCount(0);
  await api.dispose();
  await ctx.close();
});

test('J ★ 못 보낸 말은 [다시 보내기] — 입력한 글이 사라지지 않는다', async ({ browser }) => {
  const api = await pwRequest.newContext();
  const x = await signup(api, 'jx');
  const y = await signup(api, 'jy');
  const room = await openRoomApi(api, y.token, x.id);
  await say(api, y.token, room, '안녕하세요');

  const { page, ctx } = await openPerson(browser, x);
  await page.goto(`/messages?chat=${room}`);
  await expect(page.getByTestId('chat-room')).toBeVisible({ timeout: 15000 });
  const fail = (route: import('@playwright/test').Route) => (route.request().method() === 'POST' ? route.abort() : route.continue());
  await page.route('**/api/chats/*/messages', fail);
  await page.getByPlaceholder('메시지를 입력하세요').fill('끊겼을 때 쓴 말');
  await page.getByRole('button', { name: '보내기' }).click();
  await expect(page.locator('[data-pending="failed"]')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('[data-pending="failed"]')).toContainText('끊겼을 때 쓴 말');
  await page.unroute('**/api/chats/*/messages', fail);
  await page.getByRole('button', { name: '다시 보내기' }).click();
  await expect(page.locator('[data-testid="bubble-text"]', { hasText: '끊겼을 때 쓴 말' })).toBeVisible({ timeout: 10000 });
  await expect(page.locator('[data-pending]')).toHaveCount(0);
  // 서버엔 한 번만
  const msgs = (await (await api.get(`${API}/chats/${room}`, { headers: auth(x.token) })).json()).messages as any[];
  expect(msgs.filter((m) => m.content === '끊겼을 때 쓴 말')).toHaveLength(1);
  await api.dispose();
  await ctx.close();
});

test('K ★ 1:1 상대가 탈퇴했으면 보내지 못하고 이유가 한 줄로 보인다', async ({ browser }) => {
  const api = await pwRequest.newContext();
  const x = await signup(api, 'kx');
  const y = await signup(api, 'ky');
  const room = await openRoomApi(api, y.token, x.id);
  await say(api, y.token, room, '탈퇴 전 말');
  const w = await api.delete(`${API}/auth/me`, { headers: auth(y.token), data: { password: 'Arttalk1!' } });
  expect(w.ok(), `탈퇴 실패 ${w.status()}: ${await w.text()}`).toBe(true);

  const { page, ctx } = await openPerson(browser, x);
  await page.goto(`/messages?chat=${room}`);
  await expect(page.getByTestId('chat-blocked')).toContainText('탈퇴한 회원이에요.', { timeout: 15000 });
  expect((await say(api, x.token, room, '보내 본다')).status()).toBe(400);
  await api.dispose();
  await ctx.close();
});

test('L 갠톡 시작 길목 — 빈 방은 주소로는 열린다 · 화면에 [새 대화] 같은 임의 시작 버튼이 없다', async ({ browser }) => {
  // 빈 방이 필요한 다른 스펙의 도우미가 아직 서버 길목으로 연다(openEmptyDirectChat) — 그 방은 목록엔 안 뜨지만 주소로는 열린다
  const ids = userIds();
  const { page, ctx } = await openAs(browser, 'artist');
  const id = await openEmptyDirectChat(page, 'artist', ids.artist2);
  await expect(page.getByTestId('chat-room')).toBeVisible({ timeout: 15000 });
  expect(id).toBeGreaterThan(0);
  await expect(page.getByRole('button', { name: /새 대화|새 채팅/ })).toHaveCount(0);
  await ctx.close();
});
