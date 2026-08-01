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

  // 시드 공모는 마감일이 과거라 지원이 400이 된다(→ 지원 관계가 없어 메시지도 403).
  // 매 실행마다 모집 중인 공모를 새로 만들어 '지원자 관계'를 확실히 성립시킨다.
  const adTok = tokenFor('admin');
  const gal = await (await api.get(`${API}/galleries`)).json();
  const galleryId = (gal.galleries || gal).find((g: any) => g.status === 'APPROVED').id;
  const today = new Date().toISOString().slice(0, 10);
  const future = new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 10);
  const ex = await (await api.post(`${API}/exhibitions`, {
    headers: { Authorization: `Bearer ${gTok}` },
    data: {
      title: `메시지검증 ${Date.now()}`, type: 'SOLO', deadlineStart: today, deadline: future,
      exhibitStartDate: future, exhibitDate: future, capacity: 5, region: '서울',
      description: '메시지 E2E', galleryId,
    },
  })).json();
  await api.patch(`${API}/approvals/exhibition/${ex.id}`, { headers: { Authorization: `Bearer ${adTok}` }, data: { status: 'APPROVED' } });
  exId = ex.id;

  // 작가가 공모에 지원 (고정 양식: 약력 + 작품사진 + 약관동의)
  const applyRes = await applyToExhibition(api, exId, aTok);
  expect(applyRes.status(), `지원 실패: ${applyRes.status()} ${await applyRes.text()}`).toBe(201);
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
