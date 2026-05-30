import { test, expect, request as pwRequest, APIRequestContext } from '@playwright/test';
import { openAs, userIds, settle } from '../lib/helpers';

/**
 * 지속 상호작용: 갤러리↔지원자(작가) 메시지를 여러 번 주고받기.
 * - 단발성이 아니라 6턴 왕복하며 매 턴마다 누적/순서/읽음상태를 검증.
 * - 갤러리는 지원자에게만 메시지 가능 → beforeAll에서 작가가 공모에 지원(API)해 관계 성립.
 */
const API = 'http://localhost:4000/api';
const SUBJECT = '협업제안';
let exId: number;
let ids: { artist: number; gallery: number };

async function token(api: APIRequestContext, userId: number) {
  const r = await api.post(`${API}/auth/dev-login`, { data: { userId } });
  return (await r.json()).token as string;
}

test.beforeAll(async () => {
  ids = userIds() as any;
  const api = await pwRequest.newContext();
  const gTok = await token(api, ids.gallery);
  const aTok = await token(api, ids.artist);

  // 갤러리의 승인된 공모 하나 선택
  const myEx = await (await api.get(`${API}/exhibitions/my-exhibitions`, { headers: { Authorization: `Bearer ${gTok}` } })).json();
  const approved = (Array.isArray(myEx) ? myEx : myEx.exhibitions || []).find((e: any) => e.status === 'APPROVED');
  if (!approved) throw new Error('승인된 시드 공모가 없습니다 — 시드 확인 필요');
  exId = approved.id;

  // 필수 커스텀필드가 있으면 채워서 작가가 지원
  const detail = await (await api.get(`${API}/exhibitions/${exId}`)).json();
  const fields: any[] = detail.customFields || [];
  const answers = fields.filter(f => f.required).map(f => ({
    fieldId: f.id,
    value: f.type === 'select' || f.type === 'multiselect' ? (f.options?.[0] ?? '') : '테스트 답변',
  }));
  const applyRes = await api.post(`${API}/exhibitions/${exId}/apply`, {
    headers: { Authorization: `Bearer ${aTok}` },
    data: { customAnswers: answers },
  });
  expect(applyRes.ok(), `지원 실패: ${applyRes.status()} ${await applyRes.text()}`).toBeTruthy();
  await api.dispose();
});

test('메시지 6턴 왕복 — 누적·순서·읽음상태 지속 검증', async ({ browser }) => {
  const artist = await openAs(browser, 'artist');
  const gallery = await openAs(browser, 'gallery');

  const artistThread = `/messages?partner=${ids.gallery}&exhibition=${exId}&subject=${encodeURIComponent(SUBJECT)}`;
  const galleryThread = `/messages?partner=${ids.artist}&exhibition=${exId}&subject=${encodeURIComponent(SUBJECT)}`;

  // 작가의 미읽음 메시지 수 (API로 신뢰성 확인)
  const api = await pwRequest.newContext();
  const aTok = await token(api, ids.artist);
  const artistUnread = async () =>
    (await (await api.get(`${API}/messages/unread-count`, { headers: { Authorization: `Bearer ${aTok}` } })).json()).count;

  // ── 턴 1: 갤러리가 지원자에게 첫 쪽지 (새 쪽지 작성 UI) ──
  await gallery.page.goto('/messages');
  await gallery.page.getByRole('button', { name: '새 쪽지' }).click();
  await gallery.page.getByRole('button', { name: /Artist 1/ }).click();
  await gallery.page.getByPlaceholder('제목을 입력해주세요').fill(SUBJECT);
  await gallery.page.getByPlaceholder('내용을 작성해주세요').fill('지원 잘 봤습니다. 포트폴리오 인상깊네요 (1)');
  await gallery.page.getByRole('button', { name: '보내기' }).click();
  await expect(gallery.page.locator('body')).toContainText('쪽지를 보냈습니다', { timeout: 8000 });

  // 신뢰성: 작가 미읽음 1 이상 (읽기 전)
  await expect.poll(artistUnread, { timeout: 8000 }).toBeGreaterThan(0);

  // 왕복 대본 (보낸 사람, 화면, 내용)
  const turns: Array<{ who: 'artist' | 'gallery'; text: string }> = [
    { who: 'artist',  text: '안녕하세요! 관심 가져주셔서 감사합니다 (2)' },
    { who: 'gallery', text: '전시 일정은 다음달 초를 생각 중입니다 (3)' },
    { who: 'artist',  text: '좋습니다. 작품 사이즈 조율 가능할까요? (4)' },
    { who: 'gallery', text: '네 가능합니다. 도면 보내드릴게요 (5)' },
    { who: 'artist',  text: '확인했습니다. 잘 부탁드립니다 (6)' },
  ];

  const seen: string[] = ['지원 잘 봤습니다. 포트폴리오 인상깊네요 (1)'];

  for (const turn of turns) {
    const actor = turn.who === 'artist' ? artist : gallery;
    const threadUrl = turn.who === 'artist' ? artistThread : galleryThread;

    await actor.page.goto(threadUrl);
    // 스레드 열릴 때까지 (회신창 등장)
    await expect(actor.page.getByPlaceholder('회신 내용을 입력하세요...')).toBeVisible({ timeout: 10000 });

    // 지금까지의 모든 메시지가 이 화면에 누적되어 보여야 함 (순서/누적 검증)
    for (const prev of seen) {
      await expect(actor.page.getByText(prev, { exact: false })).toBeVisible();
    }

    // 작가가 스레드를 열었으면 읽음 처리 → 미읽음 0
    if (turn.who === 'artist') {
      await expect.poll(artistUnread, { timeout: 8000 }).toBe(0);
    }

    // 회신 전송 (Enter 전송)
    const box = actor.page.getByPlaceholder('회신 내용을 입력하세요...');
    await box.fill(turn.text);
    await box.press('Enter');
    await expect(actor.page.getByText(turn.text, { exact: false })).toBeVisible({ timeout: 8000 });
    seen.push(turn.text);
    await settle(actor.page, 400);
  }

  // ── 최종: 양쪽 화면 모두 6개 메시지가 순서대로 보이는지 ──
  for (const [who, url] of [['artist', artistThread], ['gallery', galleryThread]] as const) {
    const actor = who === 'artist' ? artist : gallery;
    await actor.page.goto(url);
    await expect(actor.page.getByPlaceholder('회신 내용을 입력하세요...')).toBeVisible({ timeout: 10000 });
    for (const msg of seen) {
      await expect(actor.page.getByText(msg, { exact: false }), `${who} 화면에 "${msg}" 보여야 함`).toBeVisible();
    }
  }

  await api.dispose();
  await artist.ctx.close();
  await gallery.ctx.close();
});
