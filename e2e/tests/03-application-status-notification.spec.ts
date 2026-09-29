import { test, expect, request as pwRequest } from '@playwright/test';
import { openAs, userIds, tokenFor, settle, applyToExhibition, openApplicantManager, acceptApplicant, applicantRow, exhibitionDates } from '../lib/helpers';

/**
 * 멀티유저 지속 상호작용: 작가 지원 → 갤러리가 상태를 단계별로 올림 → 작가에게 알림 누적 + 상태배지 갱신.
 * + 신뢰성: 수락 후 '접수'로 되돌리기 차단(문제7 수정) UI 검증.
 */
const API = 'http://localhost:4000/api';
let exId: number;
let exTitle: string;
let ids: { artist: number; gallery: number };

test.beforeAll(async () => {
  ids = userIds() as any;
  const api = await pwRequest.newContext();
  const gTok = tokenFor('gallery');
  const aTok = tokenFor('artist');
  const adTok = tokenFor('admin');

  // 시드 공모는 마감일이 과거라 지원이 400이 된다 → 매 실행마다 모집 중인 공모를 새로 만든다
  const gal = await (await api.get(`${API}/galleries`)).json();
  const galleryId = (gal.galleries || gal).find((g: any) => g.status === 'APPROVED').id;
  const today = new Date().toISOString().slice(0, 10);
  const future = new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 10);
  exTitle = `상태변경검증 ${Date.now()}`;
  const ex = await (await api.post(`${API}/exhibitions`, {
    headers: { Authorization: `Bearer ${gTok}` },
    data: {
      title: exTitle, type: 'SOLO', deadlineStart: today, deadline: future,
      exhibitStartDate: future, exhibitDate: future, capacity: 5, region: '서울',
      description: '지원 상태 변경 E2E', galleryId, ...exhibitionDates() },
  })).json();
  await api.patch(`${API}/approvals/exhibition/${ex.id}`, { headers: { Authorization: `Bearer ${adTok}` }, data: { status: 'APPROVED' } });
  exId = ex.id;

  const r = await applyToExhibition(api, exId, aTok);
  expect(r.status(), `지원 실패 ${r.status()}`).toBe(201);
  await api.dispose();
});

test('지원 상태 단계별 변경 → 작가 알림 누적 + 상태배지 갱신 + 역행 차단', async ({ browser }) => {
  const gallery = await openAs(browser, 'gallery');
  const artist = await openAs(browser, 'artist');

  const api = await pwRequest.newContext();
  const aTok = tokenFor('artist');
  const statusNotifCount = async () => {
    const list = await (await api.get(`${API}/notifications`, { headers: { Authorization: `Bearer ${aTok}` } })).json();
    return (list.notifications || list).filter((n: any) => n.type === 'APPLICATION_STATUS').length;
  };

  // 갤러리: 마이페이지 '내 공모' → 카드의 [지원자] 펼치기
  const card = await openApplicantManager(gallery.page, exTitle);
  const row = applicantRow(card, 'Artist 1');
  await expect(row).toContainText('검토 대기', { timeout: 10000 });

  // ── 검토 대기 → 수락 — 줄을 펼쳐 [수락하기] → 확인창 (2026-09-29 전엔 줄의 <select>) ──
  const before = await statusNotifCount();
  await acceptApplicant(gallery.page, card, 'Artist 1');
  await expect.poll(statusNotifCount, { timeout: 10000 }).toBe(before + 1);

  // 작가: [내 전시] '진행 중' 탭에 들어오고, 첫 할 일은 출품 자료 제출이다
  await artist.page.goto('/mypage?tab=applications');
  await artist.page.getByRole('tab', { name: /^진행 중/ }).click();
  const artistCard = artist.page.locator('article').filter({ hasText: exTitle }).first();
  await expect(artistCard).toBeVisible({ timeout: 10000 });
  await expect(artistCard).toContainText('출품 자료를 제출해 주세요');

  // ── 신뢰성: 수락은 최종 — 줄에 [수락하기]·[거절] 대신 '수락됨' 만 남는다(되돌리기는 개발자 플래그일 때만) ──
  await settle(gallery.page, 800);
  await expect(row).toContainText('수락됨');
  await expect(row.getByRole('button', { name: '수락하기', exact: true })).toHaveCount(0);
  await expect(row.getByRole('button', { name: '거절', exact: true })).toHaveCount(0);
  // 서버 상태도 ACCEPTED 유지 + 알림도 더 늘지 않음
  const apps = await (await api.get(`${API}/exhibitions/${exId}/applications`, {
    headers: { Authorization: `Bearer ${tokenFor('gallery')}` },
  })).json();
  expect(apps.find((a: any) => a.userId === ids.artist).status).toBe('ACCEPTED');
  expect(await statusNotifCount()).toBe(before + 1);

  await api.dispose();
  await gallery.ctx.close();
  await artist.ctx.close();
});
