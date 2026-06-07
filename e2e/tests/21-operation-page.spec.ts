import { test, expect, request as pwRequest, APIRequestContext } from '@playwright/test';
import { openAs, tokenFor, applyToExhibition } from '../lib/helpers';

/**
 * 공모 운영 페이지: 접근권한 / 공지→수락작가 알림 / 작가 제출정보 저장 + 작가간 비공개.
 */
const API = 'http://localhost:4000/api';

let exId: number;

async function setup(api: APIRequestContext) {
  const gTok = tokenFor('gallery'); const adminTok = tokenFor('admin'); const aTok = tokenFor('artist');
  const gal = await (await api.get(`${API}/galleries?owned=true`, { headers: { Authorization: `Bearer ${gTok}` } })).json();
  const galleryId = (gal.galleries || gal).find((g: any) => g.status === 'APPROVED').id;
  const future = new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 10);
  const ex = await (await api.post(`${API}/exhibitions`, {
    headers: { Authorization: `Bearer ${gTok}` },
    data: { title: '운영테스트공모 ' + Date.now(), type: 'SOLO', deadlineStart: new Date().toISOString().slice(0, 10), deadline: future, exhibitStartDate: future, exhibitDate: future, capacity: 5, region: '서울', description: '운영', galleryId },
  })).json();
  await api.patch(`${API}/approvals/exhibition/${ex.id}`, { headers: { Authorization: `Bearer ${adminTok}` }, data: { status: 'APPROVED' } });
  await applyToExhibition(api, ex.id, aTok);
  const apps = await (await api.get(`${API}/exhibitions/${ex.id}/applications`, { headers: { Authorization: `Bearer ${gTok}` } })).json();
  const app = (apps.applications || apps)[0];
  await api.patch(`${API}/exhibitions/${ex.id}/applications/${app.id}`, { headers: { Authorization: `Bearer ${gTok}` }, data: { status: 'ACCEPTED' } });
  return ex.id;
}

test.beforeAll(async () => {
  const api = await pwRequest.newContext();
  exId = await setup(api);
  await api.dispose();
});

test('접근 권한: 수락작가/오너 허용, 미수락 작가 차단', async () => {
  const api = await pwRequest.newContext();
  const acc = async (role: any) => api.get(`${API}/operations/${exId}/access`, { headers: { Authorization: `Bearer ${tokenFor(role)}` } });
  const owner = await (await acc('gallery')).json();
  expect(owner.isOwner).toBe(true);
  const artist = await (await acc('artist')).json();
  expect(artist.isAcceptedArtist).toBe(true);
  const blocked = await acc('artist2'); // 미수락
  expect(blocked.status()).toBe(403);
  await api.dispose();
});

test('공지 등록 → 수락 작가에게 알림(OPERATION_NOTICE)', async () => {
  const api = await pwRequest.newContext();
  const post = await api.post(`${API}/operations/${exId}/notices`, { headers: { Authorization: `Bearer ${tokenFor('gallery')}` }, data: { title: 'E2E 공지', content: '설치 일정 안내' } });
  expect(post.status()).toBe(201);
  const notifs = await (await api.get(`${API}/notifications`, { headers: { Authorization: `Bearer ${tokenFor('artist')}` } })).json();
  const list = notifs.notifications || notifs;
  expect(list.some((n: any) => n.type === 'OPERATION_NOTICE' && /E2E 공지/.test(n.message))).toBeTruthy();
  await api.dispose();
});

test('작가 제출정보 저장 + 작가간 비공개', async () => {
  const api = await pwRequest.newContext();
  // 작가1 제출
  const put = await api.put(`${API}/operations/${exId}/me`, {
    headers: { Authorization: `Bearer ${tokenFor('artist')}` },
    data: { artworkList: [{ title: 'E2E작품', size: '10x10', medium: 'oil', year: '2025', price: '비매', image: '' }], cv: null, note: { statement: 'E2E 노트', sections: [] } },
  });
  expect(put.status()).toBe(200);
  // 오너는 전 작가 제출 열람
  const subs = await (await api.get(`${API}/operations/${exId}/submissions`, { headers: { Authorization: `Bearer ${tokenFor('gallery')}` } })).json();
  expect(subs.some((s: any) => s.submission.artworkList.some((w: any) => w.title === 'E2E작품'))).toBeTruthy();
  // 작가2(다른 작가)는 submissions 열람 불가
  const forbidden = await api.get(`${API}/operations/${exId}/submissions`, { headers: { Authorization: `Bearer ${tokenFor('artist2')}` } });
  expect(forbidden.status()).toBe(403);
  await api.dispose();
});

test('UI: 수락 작가가 운영 페이지에서 내 전시 정보 화면 확인', async ({ browser }) => {
  const { page, ctx } = await openAs(browser, 'artist');
  await page.goto(`/exhibitions/${exId}/operation`);
  await expect(page.getByText('운영 페이지', { exact: false }).first()).toBeVisible({ timeout: 10000 });
  await expect(page.getByText('내 전시 정보', { exact: false }).first()).toBeVisible({ timeout: 8000 });
  await expect(page.getByText('E2E 공지', { exact: false }).first()).toBeVisible({ timeout: 8000 });
  await ctx.close();
});
