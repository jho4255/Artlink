import { test, expect, request as pwRequest } from '@playwright/test';
import { openAs, userIds, tokenFor } from '../lib/helpers';

/**
 * 멀티유저 모더레이션: 갤러리가 보낸 메시지를 작가가 신고 → 관리자 제재 → 양쪽 화면에서 마스킹.
 * - 신고(작가) UI / 제재(관리자) API / 마스킹 표시(작가·갤러리) UI 로 검증.
 */
const API = 'http://localhost:4000/api';
const SUBJECT = '신고테스트케이스';
const BAD_MSG = '이건 신고 대상이 될 부적절한 테스트 메시지입니다';
let exId: number;
let ids: { artist: number; gallery: number; admin: number };

test.beforeAll(async () => {
  ids = userIds() as any;
  const api = await pwRequest.newContext();
  const gTok = tokenFor('gallery');
  const myEx = await (await api.get(`${API}/exhibitions/my-exhibitions`, { headers: { Authorization: `Bearer ${gTok}` } })).json();
  const approved = (Array.isArray(myEx) ? myEx : myEx.exhibitions || []).find((e: any) => e.status === 'APPROVED');
  exId = approved.id;
  // 갤러리 → 작가 메시지 전송 (신고 대상)
  const r = await api.post(`${API}/messages`, {
    headers: { Authorization: `Bearer ${gTok}` },
    data: { receiverId: ids.artist, subject: SUBJECT, content: BAD_MSG, exhibitionId: exId },
  });
  expect(r.ok(), `메시지 전송 실패 ${r.status()}`).toBeTruthy();
  await api.dispose();
});

test('신고 → 관리자 제재 → 작가·갤러리 양쪽에서 메시지 마스킹', async ({ browser }) => {
  const artist = await openAs(browser, 'artist');
  const gallery = await openAs(browser, 'gallery');
  const api = await pwRequest.newContext();
  const adminTok = tokenFor('admin');
  const galleryTok = tokenFor('gallery');

  const artistThread = `/messages?partner=${ids.gallery}&exhibition=${exId}&subject=${encodeURIComponent(SUBJECT)}`;
  const galleryThread = `/messages?partner=${ids.artist}&exhibition=${exId}&subject=${encodeURIComponent(SUBJECT)}`;

  // ── 1) 작가: 스레드 열고 갤러리 메시지 신고 ──
  await artist.page.goto(artistThread);
  await expect(artist.page.getByText(BAD_MSG, { exact: false })).toBeVisible({ timeout: 10000 });
  await artist.page.locator('button:has(svg.lucide-flag)').first().click(); // 신고(깃발) 버튼
  await expect(artist.page.getByText('신고하기')).toBeVisible();
  await artist.page.getByRole('button', { name: '신고하기' }).click();
  await expect(artist.page.locator('body')).toContainText('신고가 접수되었습니다', { timeout: 8000 });

  // 신고 직후 작가 화면: 본인이 신고한 메시지로 가려짐
  await artist.page.goto(artistThread);
  await expect(artist.page.getByText('신고한 메시지입니다', { exact: false })).toBeVisible({ timeout: 10000 });
  await expect(artist.page.getByText(BAD_MSG, { exact: false })).toHaveCount(0);

  // ── 2) 관리자: 신고 큐에서 제재(ACTIONED) — API ──
  const reports = await (await api.get(`${API}/reports?status=PENDING`, { headers: { Authorization: `Bearer ${adminTok}` } })).json();
  const report = (reports.reports || reports).find((r: any) => r.status === 'PENDING');
  expect(report, '대기 중 신고가 있어야 함').toBeTruthy();
  const act = await api.patch(`${API}/reports/${report.id}`, {
    headers: { Authorization: `Bearer ${adminTok}` },
    data: { status: 'ACTIONED', adminNote: 'E2E 제재' },
  });
  expect(act.ok()).toBeTruthy();

  // ── 3) 작가 화면: 제재로 가려진 메시지로 변경 ──
  await artist.page.goto(artistThread);
  await expect(artist.page.getByText('제재로 가려진 메시지입니다', { exact: false })).toBeVisible({ timeout: 10000 });

  // ── 4) 갤러리(발신자) 화면도 제재로 가려짐 ──
  await gallery.page.goto(galleryThread);
  await expect(gallery.page.getByText('제재로 가려진 메시지입니다', { exact: false })).toBeVisible({ timeout: 10000 });
  await expect(gallery.page.getByText(BAD_MSG, { exact: false })).toHaveCount(0);

  // ── 5) 발신자(갤러리)에게 제재 알림(MESSAGE_SANCTION) ──
  const gNotis = await (await api.get(`${API}/notifications`, { headers: { Authorization: `Bearer ${galleryTok}` } })).json();
  const sanction = (gNotis.notifications || gNotis).filter((n: any) => n.type === 'MESSAGE_SANCTION');
  expect(sanction.length, '갤러리에 제재 알림').toBeGreaterThan(0);

  await api.dispose();
  await artist.ctx.close();
  await gallery.ctx.close();
});
