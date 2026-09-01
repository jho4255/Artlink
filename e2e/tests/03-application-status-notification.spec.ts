import { test, expect, request as pwRequest } from '@playwright/test';
import { openAs, userIds, tokenFor, settle, applyToExhibition, openApplicantManager, exhibitionDates } from '../lib/helpers';

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

  // 갤러리: 마이페이지 '내 공모' → 지원자 관리 인라인 펼치기
  await openApplicantManager(gallery.page, exTitle);
  await expect(gallery.page.getByText('Artist 1', { exact: false }).first()).toBeVisible({ timeout: 10000 });
  const statusSelect = gallery.page.locator('select').filter({ has: gallery.page.getByRole('option', { name: '수락' }) }).first();

  // ── 접수 → 수락 (검토중 REVIEWED는 폐지됨: 접수/수락/거절 3상태) ──
  const before = await statusNotifCount();
  await statusSelect.selectOption({ value: 'ACCEPTED' });
  // 수락은 되돌릴 수 없어 확인 다이얼로그를 거친다
  const confirmBtn = gallery.page.getByRole('button', { name: /수락|확인/ }).last();
  if (await confirmBtn.isVisible().catch(() => false)) await confirmBtn.click();
  await expect.poll(statusNotifCount, { timeout: 10000 }).toBe(before + 1);

  // 작가: 지원 내역에서 '수락' 확인
  await artist.page.goto('/mypage?tab=applications');
  await expect(artist.page.getByText('수락', { exact: false }).first()).toBeVisible({ timeout: 10000 });

  // ── 신뢰성: 수락은 최종 — 갤러리 화면에서 '수락 (확정)' 잠금 배지로 바뀐다 ──
  await settle(gallery.page, 800);
  await expect(gallery.page.locator('body')).toContainText('수락 (확정)', { timeout: 10000 });
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
