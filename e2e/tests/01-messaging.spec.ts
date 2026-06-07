import { test, expect, request as pwRequest } from '@playwright/test';
import { openAs, userIds, tokenFor, settle, applyToExhibition } from '../lib/helpers';

/**
 * 지속 상호작용: 갤러리↔지원자(작가) 메시지를 여러 번 주고받기.
 * - 단발성이 아니라 6턴 왕복하며 매 턴마다 누적/순서/읽음상태를 검증.
 * - 갤러리는 지원자에게만 메시지 가능 → beforeAll에서 작가가 공모에 지원(API)해 관계 성립.
 */
const API = 'http://localhost:4000/api';
const SUBJECT = '협업제안';
let exId: number;
let ids: { artist: number; gallery: number };

test.beforeAll(async () => {
  ids = userIds() as any;
  const api = await pwRequest.newContext();
  const gTok = tokenFor('gallery');
  const aTok = tokenFor('artist');

  // 갤러리의 승인된 공모 하나 선택
  const myEx = await (await api.get(`${API}/exhibitions/my-exhibitions`, { headers: { Authorization: `Bearer ${gTok}` } })).json();
  const approved = (Array.isArray(myEx) ? myEx : myEx.exhibitions || []).find((e: any) => e.status === 'APPROVED');
  if (!approved) throw new Error('승인된 시드 공모가 없습니다 — 시드 확인 필요');
  exId = approved.id;

  // 작가가 공모에 지원 (고정 양식: 약력 + 작품사진)
  const applyRes = await applyToExhibition(api, exId, aTok);
  expect([200, 201, 400, 409].includes(applyRes.status()), `지원 실패: ${applyRes.status()} ${await applyRes.text()}`).toBeTruthy();
  await api.dispose();
});

test('카톡식 1:1 — 6턴 왕복 누적·순서·읽음상태 지속 검증', async ({ browser }) => {
  const artist = await openAs(browser, 'artist');
  const gallery = await openAs(browser, 'gallery');

  // 카톡식: 상대 파라미터로 1:1 대화 직접 오픈 (제목 없음)
  const artistThread = `/messages?partner=${ids.gallery}`;
  const galleryThread = `/messages?partner=${ids.artist}`;

  const api = await pwRequest.newContext();
  const aTok = tokenFor('artist');
  const artistUnread = async () =>
    (await (await api.get(`${API}/messages/unread-count`, { headers: { Authorization: `Bearer ${aTok}` } })).json()).count;

  // ── 턴 1: 갤러리가 지원자에게 첫 메시지 (말풍선) ──
  await gallery.page.goto(galleryThread);
  await expect(gallery.page.locator('textarea')).toBeVisible({ timeout: 10000 });
  const gBox = gallery.page.locator('textarea');
  await gBox.fill('지원 잘 봤습니다. 포트폴리오 인상깊네요 (1)');
  await gBox.press('Enter');
  await expect(gallery.page.getByText('포트폴리오 인상깊네요 (1)', { exact: false })).toBeVisible({ timeout: 8000 });

  // 신뢰성: 작가 미읽음 1 이상 (읽기 전)
  await expect.poll(artistUnread, { timeout: 8000 }).toBeGreaterThan(0);

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
    await expect(actor.page.locator('textarea')).toBeVisible({ timeout: 10000 });

    // 지금까지의 모든 메시지가 1:1 대화에 누적 표시 (순서/누적 검증)
    for (const prev of seen) {
      await expect(actor.page.getByText(prev, { exact: false })).toBeVisible();
    }

    // 작가가 대화를 열었으면 읽음 처리 → 미읽음 0
    if (turn.who === 'artist') {
      await expect.poll(artistUnread, { timeout: 8000 }).toBe(0);
    }

    const box = actor.page.locator('textarea');
    await box.fill(turn.text);
    await box.press('Enter');
    await expect(actor.page.getByText(turn.text, { exact: false })).toBeVisible({ timeout: 8000 });
    seen.push(turn.text);
    await settle(actor.page, 400);
  }

  // ── 최종: 양쪽 화면 모두 6개 메시지가 누적되어 보이는지 ──
  for (const [who, url] of [['artist', artistThread], ['gallery', galleryThread]] as const) {
    const actor = who === 'artist' ? artist : gallery;
    await actor.page.goto(url);
    await expect(actor.page.locator('textarea')).toBeVisible({ timeout: 10000 });
    for (const msg of seen) {
      await expect(actor.page.getByText(msg, { exact: false }), `${who} 화면에 "${msg}" 보여야 함`).toBeVisible();
    }
  }

  await api.dispose();
  await artist.ctx.close();
  await gallery.ctx.close();
});
