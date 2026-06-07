import { test, expect, request as pwRequest } from '@playwright/test';
import { openAs, userIds, tokenFor, settle, applyToExhibition } from '../lib/helpers';

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
  const myEx = await (await api.get(`${API}/exhibitions/my-exhibitions`, { headers: { Authorization: `Bearer ${gTok}` } })).json();
  const approved = (Array.isArray(myEx) ? myEx : myEx.exhibitions || []).find((e: any) => e.status === 'APPROVED');
  if (!approved) throw new Error('승인된 시드 공모 없음');
  exId = approved.id; exTitle = approved.title;
  const r = await applyToExhibition(api, exId, aTok);
  // 201=새 지원, 400/409=이미 지원(다른 테스트에서) → 어느 쪽이든 "작가가 지원함" 전제 충족
  expect([200, 201, 400, 409].includes(r.status()), `지원 실패 ${r.status()}`).toBeTruthy();
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

  // 갤러리: 공모 상세 → 지원자 관리 펼치기
  await gallery.page.goto(`/exhibitions/${exId}`);
  await gallery.page.getByText('지원자 관리', { exact: false }).click();
  await expect(gallery.page.getByText('Artist 1', { exact: false }).first()).toBeVisible({ timeout: 10000 });
  const statusSelect = gallery.page.locator('select').filter({ has: gallery.page.getByRole('option', { name: '수락' }) }).first();

  // ── 단계 1: 접수 → 검토중 ──
  await statusSelect.selectOption({ value: 'REVIEWED' });
  await expect(gallery.page.locator('body')).toContainText('상태가 변경되었습니다', { timeout: 8000 });
  await expect.poll(statusNotifCount, { timeout: 8000 }).toBe(1);

  // 작가: 지원 내역에서 '검토중' 확인
  await artist.page.goto('/mypage');
  await artist.page.getByText('지원 내역', { exact: false }).first().click();
  await expect(artist.page.getByText('검토중', { exact: false }).first()).toBeVisible({ timeout: 8000 });

  // ── 단계 2: 검토중 → 수락 ──
  await statusSelect.selectOption({ value: 'ACCEPTED' });
  await expect(gallery.page.locator('body')).toContainText('상태가 변경되었습니다', { timeout: 8000 });
  await expect.poll(statusNotifCount, { timeout: 8000 }).toBe(2);

  // 작가: 다시 들어가 '수락' 확인 (재진입 시 최신 상태)
  await artist.page.goto('/mypage');
  await artist.page.getByText('지원 내역', { exact: false }).first().click();
  await expect(artist.page.getByText('수락', { exact: false }).first()).toBeVisible({ timeout: 8000 });

  // (알림 전파는 위 statusNotifCount 폴링(1→2)과 지원내역 배지로 이미 검증됨)

  // ── 신뢰성: 수락 후 '접수'로 역행 시도 → 차단(문제7) ──
  await statusSelect.selectOption({ value: 'SUBMITTED' });
  await expect(gallery.page.locator('body')).toContainText(/되돌릴 수 없습니다|실패/, { timeout: 8000 });
  await settle(gallery.page, 800);
  // 상태는 여전히 수락(ACCEPTED) 유지
  await expect(statusSelect).toHaveValue('ACCEPTED');
  // 알림도 더 안 늘어남(역행 차단되었으므로 2 유지)
  expect(await statusNotifCount()).toBe(2);

  await api.dispose();
  await gallery.ctx.close();
  await artist.ctx.close();
});
