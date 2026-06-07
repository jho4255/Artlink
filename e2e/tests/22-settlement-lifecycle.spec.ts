import { test, expect, request as pwRequest, APIRequestContext } from '@playwright/test';
import { openAs, tokenFor, applyToExhibition } from '../lib/helpers';

/**
 * 공모 상태(모집마감/확정/전시종료) + 정산.
 */
const API = 'http://localhost:4000/api';
const gAuth = () => ({ Authorization: `Bearer ${tokenFor('gallery')}` });

async function createApprovedExhibition(api: APIRequestContext, title: string) {
  const gal = await (await api.get(`${API}/galleries?owned=true`, { headers: gAuth() })).json();
  const galleryId = (gal.galleries || gal).find((g: any) => g.status === 'APPROVED').id;
  const future = new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 10);
  const ex = await (await api.post(`${API}/exhibitions`, {
    headers: gAuth(),
    data: { title, type: 'SOLO', deadlineStart: new Date().toISOString().slice(0, 10), deadline: future, exhibitStartDate: future, exhibitDate: future, capacity: 5, region: '서울', description: 'x', galleryId },
  })).json();
  await api.patch(`${API}/approvals/exhibition/${ex.id}`, { headers: { Authorization: `Bearer ${tokenFor('admin')}` }, data: { status: 'APPROVED' } });
  return ex.id;
}
async function acceptArtist1(api: APIRequestContext, exId: number) {
  await applyToExhibition(api, exId, tokenFor('artist'));
  const apps = await (await api.get(`${API}/exhibitions/${exId}/applications`, { headers: gAuth() })).json();
  const app = (apps.applications || apps)[0];
  await api.patch(`${API}/exhibitions/${exId}/applications/${app.id}`, { headers: gAuth(), data: { status: 'ACCEPTED' } });
}

test('모집마감 → 목록 비노출 + 지원 차단', async () => {
  const api = await pwRequest.newContext();
  const exId = await createApprovedExhibition(api, '마감테스트 ' + Date.now());
  // 마감 전: 목록에 노출
  let list = await (await api.get(`${API}/exhibitions`)).json();
  expect((list.exhibitions || list).some((e: any) => e.id === exId)).toBeTruthy();
  // 모집마감
  await api.patch(`${API}/operations/${exId}/lifecycle`, { headers: gAuth(), data: { recruitmentClosed: true } });
  list = await (await api.get(`${API}/exhibitions`)).json();
  expect((list.exhibitions || list).some((e: any) => e.id === exId)).toBeFalsy();
  // 지원 차단
  const apply = await applyToExhibition(api, exId, tokenFor('artist2'));
  expect(apply.status()).toBe(400);
  await api.dispose();
});

test('확정 → 작가 전시정보 수정 잠금(403)', async () => {
  const api = await pwRequest.newContext();
  const exId = await createApprovedExhibition(api, '확정테스트 ' + Date.now());
  await acceptArtist1(api, exId);
  // 확정 전: 작가 저장 가능
  const ok = await api.put(`${API}/operations/${exId}/me`, { headers: { Authorization: `Bearer ${tokenFor('artist')}` }, data: { artworkList: [{ title: 'A', size: '', medium: '', year: '', price: '' }] } });
  expect(ok.status()).toBe(200);
  // 확정
  await api.patch(`${API}/operations/${exId}/lifecycle`, { headers: gAuth(), data: { confirmed: true } });
  const locked = await api.put(`${API}/operations/${exId}/me`, { headers: { Authorization: `Bearer ${tokenFor('artist')}` }, data: { artworkList: [] } });
  expect(locked.status()).toBe(403);
  await api.dispose();
});

test('전시종료 → 정산 계산(갤러리:작가) + 작가 본인 정산 조회', async () => {
  const api = await pwRequest.newContext();
  const exId = await createApprovedExhibition(api, '정산테스트 ' + Date.now());
  await acceptArtist1(api, exId);
  // 작가 출품작 2건 제출
  await api.put(`${API}/operations/${exId}/me`, {
    headers: { Authorization: `Bearer ${tokenFor('artist')}` },
    data: { artworkList: [
      { title: '작품A', size: '50x50', medium: 'oil', year: '2025', price: '1,000,000', image: '' },
      { title: '작품B', size: '30x30', medium: 'acrylic', year: '2024', price: '500,000', image: '' },
    ], cv: null, note: null },
  });
  // 전시종료
  const ended = await (await api.patch(`${API}/operations/${exId}/lifecycle`, { headers: gAuth(), data: { ended: true } })).json();
  expect(ended.ended).toBe(true);
  expect(ended.recruitmentClosed).toBe(true);
  // 판매작(0번) 100만 + 갤러리 30%
  await api.put(`${API}/operations/${exId}/settlement`, {
    headers: gAuth(),
    data: { sales: [{ artistUserId: 1, artworkIndex: 0, title: '작품A', soldPrice: 1000000 }], ratios: [{ artistUserId: 1, galleryRatio: 30 }] },
  });
  // 갤러리 정산 조회
  const s = await (await api.get(`${API}/operations/${exId}/settlement`, { headers: gAuth() })).json();
  const a = s.artists.find((x: any) => x.user.id === 1);
  expect(a.total).toBe(1000000);
  expect(a.galleryAmount).toBe(300000);
  expect(a.artistAmount).toBe(700000);
  expect(a.works.find((w: any) => w.index === 0).sold).toBe(true);
  expect(s.grand.total).toBe(1000000);
  // 작가 본인 정산
  const mine = await (await api.get(`${API}/operations/${exId}/my-settlement`, { headers: { Authorization: `Bearer ${tokenFor('artist')}` } })).json();
  expect(mine.artist.artistAmount).toBe(700000);
  await api.dispose();
});

test('UI: 전시종료 후 갤러리 운영 페이지에 정산 섹션 표시', async ({ browser }) => {
  const api = await pwRequest.newContext();
  const exId = await createApprovedExhibition(api, '정산UI ' + Date.now());
  await acceptArtist1(api, exId);
  await api.put(`${API}/operations/${exId}/me`, { headers: { Authorization: `Bearer ${tokenFor('artist')}` }, data: { artworkList: [{ title: '작품X', size: '', medium: '', year: '', price: '', image: '' }] } });
  await api.patch(`${API}/operations/${exId}/lifecycle`, { headers: gAuth(), data: { ended: true } });
  await api.dispose();

  const { page, ctx } = await openAs(browser, 'gallery');
  await page.goto(`/exhibitions/${exId}/operation`);
  await expect(page.getByText('정산', { exact: false }).first()).toBeVisible({ timeout: 10000 });
  await expect(page.getByText('작품X', { exact: false }).first()).toBeVisible({ timeout: 8000 });
  await ctx.close();
});
