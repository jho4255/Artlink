import { test, expect, request as pwRequest } from '@playwright/test';
import { openAs, tokenFor, userIds } from '../lib/helpers';

/**
 * ArtTalk 신고 → 관리자 [신고 관리] (2026-11-19, CLAUDE.md 규칙 33 을 닫는다).
 *
 * 2026-08-28 대화 개편 뒤로 신고가 화면에서 끊겨 있었다(옛 쪽지 `Message` 만 신고 대상이었고 말풍선에 신고 버튼이 없었다).
 * 지금은:
 *   · 말풍선을 길게 누르면(마우스는 오른쪽 클릭·[⋯]) [신고하기] → 사유 하나 + 자세한 내용(선택)
 *   · 1:1 방은 방 메뉴[⋯]에서 **사람**도 신고한다
 *   · 서버(`lib/chatReport.ts`)가 그 메시지와 앞뒤 몇 줄을 **사본**으로 남긴다 — 관리자는 남의 방을 열 수 없다(404)
 *   · 관리자에게 벨 알림(`CHAT_REPORT`) → [신고 관리]에서 [처리함]·[문제없음]
 * 옛 쪽지 신고 API(`/reports`)는 서버에 남아 있지만 화면은 부르지 않는다(retiredApis.test.ts).
 */
const API = 'http://localhost:4000/api';
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

test('★ 말풍선 [신고하기] → 관리자 [신고 관리]에서 그 대화 사본을 보고 처리한다', async ({ browser }) => {
  const ids = userIds();
  const api = await pwRequest.newContext();
  // artist2 → artist 1:1 방에 앞뒤 대화 + 문제의 말
  const room = await (await api.post(`${API}/chats/direct`, { headers: auth(tokenFor('artist2')), data: { userId: ids.artist } })).json();
  const stamp = Date.now();
  const bad = `신고 대상 메시지 ${stamp}`;
  await api.post(`${API}/chats/${room.id}/messages`, { headers: auth(tokenFor('artist')), data: { content: `앞 대화 ${stamp}` } });
  const sent = await api.post(`${API}/chats/${room.id}/messages`, { headers: auth(tokenFor('artist2')), data: { content: bad } });
  expect(sent.status()).toBe(201);
  const badId = (await sent.json()).id as number;

  // 작가: 그 말을 길게 눌러(여기선 contextmenu) [신고하기]
  const a = await openAs(browser, 'artist');
  await a.page.goto(`/messages?chat=${room.id}`);
  const bubble = a.page.locator('[data-testid="bubble-text"]', { hasText: bad });
  await expect(bubble).toBeVisible({ timeout: 15000 });
  await bubble.click({ button: 'right' });
  const menu = a.page.getByTestId('message-menu');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('button', { name: '복사' })).toBeVisible();
  await menu.getByRole('button', { name: '신고하기' }).click();

  const sheet = a.page.getByTestId('report-sheet');
  await expect(sheet).toContainText(bad);
  // 사유를 고르기 전엔 보낼 수 없다
  await expect(sheet.getByRole('button', { name: '신고하기' })).toBeDisabled();
  await sheet.getByRole('radio', { name: '욕설·비방' }).check();
  await sheet.getByRole('textbox').fill('E2E 신고 — 자세한 내용');
  await sheet.getByRole('button', { name: '신고하기' }).click();
  await expect(a.page.locator('body')).toContainText('신고했어요', { timeout: 10000 });
  await expect(sheet).toHaveCount(0);

  // 같은 메시지를 또 신고하면 409(이미 신고했어요)
  const again = await api.post(`${API}/chats/${room.id}/report`, { headers: auth(tokenFor('artist')), data: { messageId: badId, reason: 'SPAM' } });
  expect(again.status()).toBe(409);
  // 내 말은 신고할 수 없고, 남의 방은 404(방이 있는지조차 알려주지 않는다)
  const mine = await api.post(`${API}/chats/${room.id}/report`, { headers: auth(tokenFor('artist2')), data: { messageId: badId, reason: 'SPAM' } });
  expect(mine.status()).toBe(400);
  const stranger = await api.post(`${API}/chats/${room.id}/report`, { headers: auth(tokenFor('gallery')), data: { messageId: badId, reason: 'SPAM' } });
  expect(stranger.status()).toBe(404);

  // 관리자: 벨 알림(CHAT_REPORT) → [신고 관리]
  const notes = await (await api.get(`${API}/notifications`, { headers: auth(tokenFor('admin')) })).json();
  const note = (Array.isArray(notes) ? notes : notes.notifications ?? []).find((n: any) => n.type === 'CHAT_REPORT' && /욕설·비방/.test(n.message));
  expect(note, '관리자에게 신고 알림이 없다').toBeTruthy();
  expect(note.linkUrl).toBe('/mypage?tab=report-manage');

  const ad = await openAs(browser, 'admin');
  await ad.page.goto('/mypage?tab=report-manage');
  const section = ad.page.getByTestId('chat-reports');
  await expect(section).toBeVisible({ timeout: 15000 });
  const item = section.locator('li', { hasText: bad }).first();
  await expect(item).toBeVisible({ timeout: 10000 });
  // 사본: 앞 대화까지 함께 · 신고한 그 줄 표시 · 신고 사유와 내용
  await expect(item).toContainText(`앞 대화 ${stamp}`);
  await expect(item).toContainText('← 신고한 메시지');
  await expect(item).toContainText('E2E 신고 — 자세한 내용');
  await item.getByRole('button', { name: '처리함' }).click();
  await expect(ad.page.locator('body')).toContainText('처리함으로 남겼어요', { timeout: 10000 });
  await section.getByRole('tab', { name: /^처리한 것/ }).click();
  const doneItem = section.locator('li', { hasText: bad }).first();
  await expect(doneItem).toContainText('처리함');
  // 신고당한 회원 → [사용자 관리]에서 그 회원을 찾은 채로(역할 탭·검색어가 채워져 있다)
  await doneItem.getByRole('link', { name: '사용자 관리에서 보기' }).click();
  await expect(ad.page).toHaveURL(/tab=user-manage/);
  await expect(ad.page.getByRole('searchbox', { name: '이름·이메일·@주소로 찾기' })).not.toHaveValue('');
  await expect(ad.page.locator('main')).toContainText('Artist 2', { timeout: 10000 });

  // 작가는 관리자 목록을 못 본다
  expect((await api.get(`${API}/chat-reports`, { headers: auth(tokenFor('artist')) })).status()).toBe(403);

  await api.dispose();
  await a.ctx.close();
  await ad.ctx.close();
});

test('★ 1:1 방은 사람을 신고한다(방 메뉴) — 최근 대화가 사본으로 간다 · 단톡은 방 단위 신고를 받지 않는다', async ({ browser }) => {
  const ids = userIds();
  const api = await pwRequest.newContext();
  const room = await (await api.post(`${API}/chats/direct`, { headers: auth(tokenFor('gallery')), data: { userId: ids.artist2 } })).json();
  const stamp = Date.now();
  await api.post(`${API}/chats/${room.id}/messages`, { headers: auth(tokenFor('gallery')), data: { content: `사람 신고용 대화 ${stamp}` } });

  const p = await openAs(browser, 'artist2');
  await p.page.goto(`/messages?chat=${room.id}`);
  await expect(p.page.getByTestId('chat-room')).toBeVisible({ timeout: 15000 });
  await p.page.getByRole('button', { name: '대화방 메뉴' }).click();
  await p.page.getByTestId('room-menu').getByRole('button', { name: '신고하기' }).click();
  const sheet = p.page.getByTestId('report-sheet');
  await expect(sheet).toContainText('님을 신고해요');
  await sheet.getByRole('radio', { name: '스팸·광고' }).check();
  await sheet.getByRole('button', { name: '신고하기' }).click();
  await expect(p.page.locator('body')).toContainText('신고했어요', { timeout: 10000 });

  const list = await (await api.get(`${API}/chat-reports`, { headers: auth(tokenFor('admin')) })).json();
  const mineReport = list.find((r: any) => r.chatId === room.id && r.messageId == null && r.reporter.id === ids.artist2);
  expect(mineReport, '사람 신고가 관리자 목록에 없다').toBeTruthy();
  expect(mineReport.snapshot.lines.some((l: any) => l.content === `사람 신고용 대화 ${stamp}`), '최근 대화가 사본에 없다').toBe(true);

  // 단톡(공모방)에서는 방 단위(사람) 신고를 받지 않는다 — 메시지를 골라 신고한다
  const rooms = await (await api.get(`${API}/chats`, { headers: auth(tokenFor('artist')) })).json();
  const group = rooms.find((c: any) => c.kind === 'GROUP');
  if (group) {
    const r = await api.post(`${API}/chats/${group.id}/report`, { headers: auth(tokenFor('artist')), data: { reason: 'SPAM' } });
    expect(r.status()).toBe(400);
  }
  await api.dispose();
  await p.ctx.close();
});
