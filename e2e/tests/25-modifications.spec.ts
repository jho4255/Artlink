import { test, expect, request as pwRequest, APIRequestContext } from '@playwright/test';
import { openAs, tokenFor, userIds, applyToExhibition } from '../lib/helpers';

/**
 * 2026-06-10 수정사항 검증 (항목 1·2·11·12·15·16·17 중심)
 *  - API 레벨: 빠르고 안정적인 핵심 계약 검증
 *  - UI 레벨: #16(전시 다중 사진 업로드 누락 버그), #13(아트페어 자유입력)
 */
const API = 'http://localhost:4000/api';
const gAuth = () => ({ Authorization: `Bearer ${tokenFor('gallery')}` });
const aAuth = () => ({ Authorization: `Bearer ${tokenFor('artist')}` });

async function galleryId(api: APIRequestContext): Promise<number> {
  const gal = await (await api.get(`${API}/galleries?owned=true`, { headers: gAuth() })).json();
  return (gal.galleries || gal).find((g: any) => g.status === 'APPROVED').id;
}
async function createApprovedExhibition(api: APIRequestContext, title: string) {
  const gId = await galleryId(api);
  const future = new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 10);
  const ex = await (await api.post(`${API}/exhibitions`, {
    headers: gAuth(),
    data: { title, type: 'SOLO', deadlineStart: new Date().toISOString().slice(0, 10), deadline: future, exhibitStartDate: future, exhibitDate: future, capacity: 5, region: '서울', description: 'x', galleryId: gId },
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

// ───────── #1·#2 작가 프로필(전화/이메일/인스타) ─────────
test('#1·2 작가 프로필 전화·인스타 수정 → /auth/me 반영', async () => {
  const api = await pwRequest.newContext();
  const r = await api.put(`${API}/auth/me/profile`, { headers: aAuth(), data: { phone: '010-1111-2222', instagramUrl: 'https://instagram.com/e2e_artist' } });
  expect(r.status()).toBe(200);
  const me = await (await api.get(`${API}/auth/me`, { headers: aAuth() })).json();
  expect(me.user.phone).toBe('010-1111-2222');
  expect(me.user.instagramUrl).toBe('https://instagram.com/e2e_artist');
  await api.dispose();
});

// ───────── #11 캡션 HWP 생성(만원 단위 가격) ─────────
test('#11 캡션 HWP 생성 (가격 있는 출품작)', async () => {
  const api = await pwRequest.newContext();
  const exId = await createApprovedExhibition(api, '캡션 ' + Date.now());
  await acceptArtist1(api, exId);
  await api.put(`${API}/operations/${exId}/me`, { headers: aAuth(), data: { artworkList: [{ title: '캡션작', size: '10x10', medium: 'oil', year: '2025', price: '230000', image: '' }], representativeIndex: 0 } });
  const res = await api.get(`${API}/operations/${exId}/caption.hwp`, { headers: gAuth() });
  expect(res.status()).toBe(200);
  const buf = Buffer.from(await res.body());
  expect(buf.subarray(0, 4).toString('hex')).toBe('d0cf11e0'); // CFB(OLE) 시그니처 = 한글 HWP
  await api.dispose();
});

// ───────── #12 정산 결제수단(카드/현금) ─────────
test('#12 정산 결제수단(카드/현금) 저장·조회', async () => {
  const api = await pwRequest.newContext();
  const exId = await createApprovedExhibition(api, '결제수단 ' + Date.now());
  await acceptArtist1(api, exId);
  await api.put(`${API}/operations/${exId}/me`, {
    headers: aAuth(),
    data: { artworkList: [
      { title: 'A', size: '10x10', medium: 'oil', year: '2025', price: '1000000', image: '' },
      { title: 'B', size: '20x20', medium: 'oil', year: '2025', price: '2000000', image: '' },
    ] },
  });
  await api.patch(`${API}/operations/${exId}/lifecycle`, { headers: gAuth(), data: { ended: true } });
  await api.put(`${API}/operations/${exId}/settlement`, {
    headers: gAuth(),
    data: {
      sales: [
        { artistUserId: userIds().artist, artworkIndex: 0, title: 'A', soldPrice: 1000000, paymentMethod: 'CASH' },
        { artistUserId: userIds().artist, artworkIndex: 1, title: 'B', soldPrice: 2000000, paymentMethod: 'CARD' },
      ],
      ratios: [{ artistUserId: userIds().artist, galleryRatio: 30 }],
    },
  });
  const s = await (await api.get(`${API}/operations/${exId}/settlement`, { headers: gAuth() })).json();
  const a = s.artists.find((x: any) => x.user.id === userIds().artist);
  expect(a.works.find((w: any) => w.index === 0).paymentMethod).toBe('CASH');
  expect(a.works.find((w: any) => w.index === 1).paymentMethod).toBe('CARD');
  await api.dispose();
});

// ───────── #15 지원 연락처는 '수락' 시에만 노출 ─────────
test('#15 지원자 연락처(이메일/전화)는 수락 시에만 갤러리에 노출', async () => {
  const api = await pwRequest.newContext();
  const exId = await createApprovedExhibition(api, '연락처 ' + Date.now());
  await applyToExhibition(api, exId, tokenFor('artist2'));

  let apps = await (await api.get(`${API}/exhibitions/${exId}/applications`, { headers: gAuth() })).json();
  let app = (apps.applications || apps).find((a: any) => a.user.id === userIds().artist2);
  expect(app.user.email).toBeNull();
  expect(app.user.phone).toBeNull();

  await api.patch(`${API}/exhibitions/${exId}/applications/${app.id}`, { headers: gAuth(), data: { status: 'ACCEPTED' } });
  apps = await (await api.get(`${API}/exhibitions/${exId}/applications`, { headers: gAuth() })).json();
  app = (apps.applications || apps).find((a: any) => a.user.id === userIds().artist2);
  expect(app.user.email).toBeTruthy();
  await api.dispose();
});

// ───────── #17 전시 사진 수정(추가/삭제 + 포스터 교체) ─────────
test('#17 전시 사진 추가/삭제 + 포스터 교체', async () => {
  const api = await pwRequest.newContext();
  const gId = await galleryId(api);
  const future = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
  const show = await (await api.post(`${API}/shows`, {
    headers: gAuth(),
    data: { title: '사진수정 ' + Date.now(), description: 'd', startDate: future, endDate: future, openingHours: '10:00-18:00', admissionFee: '무료', location: '서울', region: 'SEOUL', posterImage: 'https://example.com/p.jpg', galleryId: gId },
  })).json();

  const img = await (await api.post(`${API}/shows/${show.id}/images`, { headers: gAuth(), data: { url: 'https://example.com/extra.jpg' } })).json();
  let detail = await (await api.get(`${API}/shows/${show.id}`)).json();
  expect(detail.images.some((i: any) => i.url === 'https://example.com/extra.jpg')).toBeTruthy();

  await api.patch(`${API}/shows/${show.id}`, { headers: gAuth(), data: { posterImage: 'https://example.com/newposter.jpg' } });
  detail = await (await api.get(`${API}/shows/${show.id}`)).json();
  expect(detail.posterImage).toBe('https://example.com/newposter.jpg');

  await api.delete(`${API}/shows/${show.id}/images/${img.id}`, { headers: gAuth() });
  detail = await (await api.get(`${API}/shows/${show.id}`)).json();
  expect(detail.images.some((i: any) => i.id === img.id)).toBeFalsy();
  await api.dispose();
});

// ───────── #16 (UI) 전시 다중 사진 업로드 — 7장 모두 반영 ─────────
const PNG_1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

test('#16 (UI) 전시 등록 폼에 사진 7장 드롭 → 7장 모두 반영', async ({ browser }) => {
  const { page, ctx } = await openAs(browser, 'gallery');
  await page.goto('/mypage?tab=my-shows');
  await page.getByRole('button', { name: '전시 등록', exact: true }).click();

  const fileInput = page.locator('input[type="file"][multiple]');
  await expect(fileInput).toBeAttached({ timeout: 10000 });
  const files = Array.from({ length: 7 }, (_, i) => ({ name: `art${i + 1}.png`, mimeType: 'image/png', buffer: PNG_1x1 }));
  await fileInput.setInputFiles(files);

  // 7장 모두 업로드되면 추가 버튼 라벨이 "7/10" 이 된다 (stale-closure 버그면 1~2장만 반영됨)
  await expect(page.getByText('7/10')).toBeVisible({ timeout: 40000 });
  await ctx.close();
});

// ───────── #13 (UI) 아트페어 자유입력 textarea + 가이드 ─────────
test('#13 (UI) 포트폴리오 아트페어 경력은 가이드 placeholder의 textarea', async ({ browser }) => {
  const { page, ctx } = await openAs(browser, 'artist');
  await page.goto('/mypage?tab=portfolio');
  // 포트폴리오는 읽기전용 → '수정'을 눌러 편집 모드 진입 후 CareerEditor 노출
  await page.getByRole('button', { name: '수정', exact: true }).click();
  const ta = page.locator('textarea[placeholder*="아트링크 주관 아트페어"]');
  await expect(ta).toBeVisible({ timeout: 10000 });
  await ctx.close();
});

// ───────── (추가) 전시 등록 시 갤러리 선택 → 위치(주소) 자동 입력 ─────────
test('전시 등록 폼: 갤러리 선택 시 위치(주소) 자동 입력', async ({ browser }) => {
  const { page, ctx } = await openAs(browser, 'gallery');
  await page.goto('/mypage?tab=my-shows');
  await page.getByRole('button', { name: '전시 등록', exact: true }).click();

  const locInput = page.locator('input[placeholder*="자동 입력"]');
  await expect(locInput).toBeVisible({ timeout: 10000 });
  await expect(locInput).toHaveValue(''); // 선택 전 비어있음

  const gallerySelect = page.locator('select').filter({ hasText: '갤러리 선택' });
  await gallerySelect.selectOption({ index: 1 }); // 첫 승인 갤러리 선택
  await expect(locInput).toHaveValue(/.+/, { timeout: 5000 }); // 갤러리 주소가 자동 입력됨
  await ctx.close();
});
