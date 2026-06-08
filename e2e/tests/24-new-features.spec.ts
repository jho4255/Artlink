import { test, expect, request as pwRequest, APIRequestContext } from '@playwright/test';
import { openAs, tokenFor } from '../lib/helpers';
import { applyToExhibition } from '../lib/helpers';

/**
 * 신규 기능 E2E (기능 + 신뢰성):
 *  1) 갤러리 전화번호·주소 무승인 수정 (API 권한/검증 + UI)
 *  2) 엽서 대표작(representativeIndex) 저장/범위검증/뱃지 (API + UI)
 *  3) 운영 페이지 갤러리 다운로드 버튼(캡션 시트 / 작품 원본 ZIP / 전체 PDF) 노출 + 캡션 PDF 생성
 */
const API = 'http://localhost:4000/api';

let exId: number;
let galleryId: number;

async function ownedGalleryId(api: APIRequestContext): Promise<number> {
  const gTok = tokenFor('gallery');
  const gal = await (await api.get(`${API}/galleries?owned=true`, { headers: { Authorization: `Bearer ${gTok}` } })).json();
  return (gal.galleries || gal).find((g: any) => g.status === 'APPROVED').id;
}

// 공모 생성 → 승인 → 작가 지원 → 수락
async function setupExhibitionWithAcceptedArtist(api: APIRequestContext): Promise<number> {
  const gTok = tokenFor('gallery'); const adminTok = tokenFor('admin'); const aTok = tokenFor('artist');
  const gid = await ownedGalleryId(api);
  const future = new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 10);
  const ex = await (await api.post(`${API}/exhibitions`, {
    headers: { Authorization: `Bearer ${gTok}` },
    data: { title: '신규기능공모 ' + Date.now(), type: 'SOLO', deadlineStart: new Date().toISOString().slice(0, 10), deadline: future, exhibitStartDate: future, exhibitDate: future, capacity: 5, region: '서울', description: '신규기능', galleryId: gid },
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
  galleryId = await ownedGalleryId(api);
  exId = await setupExhibitionWithAcceptedArtist(api);
  await api.dispose();
});

// ─────────────────────────── 1) 갤러리 전화번호·주소 ───────────────────────────
test.describe('갤러리 전화번호·주소 무승인 수정', () => {
  test('오너 수정 200 + status 유지(APPROVED), 비오너 403, 빈 값 400', async () => {
    const api = await pwRequest.newContext();
    // 오너 수정
    const ok = await api.patch(`${API}/galleries/${galleryId}/detail`, {
      headers: { Authorization: `Bearer ${tokenFor('gallery')}` },
      data: { phone: '02-777-1234', address: '서울시 마포구 E2E로 1' },
    });
    expect(ok.status()).toBe(200);
    const body = await ok.json();
    expect(body.phone).toBe('02-777-1234');
    expect(body.address).toBe('서울시 마포구 E2E로 1');
    expect(body.status).toBe('APPROVED'); // 재승인 불필요

    // 비오너(작가) 403
    const forbidden = await api.patch(`${API}/galleries/${galleryId}/detail`, {
      headers: { Authorization: `Bearer ${tokenFor('artist')}` },
      data: { phone: '010-0000-0000' },
    });
    expect(forbidden.status()).toBe(403);

    // 빈 전화번호 400
    const bad = await api.patch(`${API}/galleries/${galleryId}/detail`, {
      headers: { Authorization: `Bearer ${tokenFor('gallery')}` },
      data: { phone: '   ' },
    });
    expect(bad.status()).toBe(400);
    await api.dispose();
  });

  test('UI: 오너가 상세 페이지에서 전화번호·주소 인라인 수정', async ({ browser }) => {
    const { page, ctx } = await openAs(browser, 'gallery');
    await page.goto(`/galleries/${galleryId}`);
    // 주소 줄의 [수정] 클릭
    await page.getByRole('button', { name: '수정' }).first().click();
    const newPhone = '02-555-9999';
    const newAddr = '서울시 종로구 인사동 UI테스트';
    // 폼 입력 (placeholder로 식별)
    await page.getByPlaceholder('갤러리 주소').fill(newAddr);
    await page.getByPlaceholder('예: 02-739-1212').fill(newPhone);
    await page.getByRole('button', { name: '저장' }).click();
    await expect(page.locator('body')).toContainText('연락처 정보가 수정되었습니다', { timeout: 8000 });
    await expect(page.locator('body')).toContainText(newAddr, { timeout: 8000 });
    await ctx.close();
  });
});

// ─────────────────────────── 2) 엽서 대표작 ───────────────────────────
test.describe('엽서 대표작(representativeIndex)', () => {
  test('API: 저장/조회 + 범위 밖 인덱스 null + submissions 노출', async () => {
    const api = await pwRequest.newContext();
    const aTok = tokenFor('artist');
    // 출품작 2개 + 대표작 index 1
    const put = await api.put(`${API}/operations/${exId}/me`, {
      headers: { Authorization: `Bearer ${aTok}` },
      data: {
        artworkList: [
          { title: '작품A', size: '10x10', medium: 'oil', year: '2025', price: '비매', image: '' },
          { title: '작품B', size: '20x20', medium: 'acrylic', year: '2025', price: '협의', image: '' },
        ],
        cv: null, note: null, representativeIndex: 1,
      },
    });
    expect(put.status()).toBe(200);
    const me = await (await api.get(`${API}/operations/${exId}/me`, { headers: { Authorization: `Bearer ${aTok}` } })).json();
    expect(me.representativeIndex).toBe(1);

    // 범위 밖 인덱스 → null
    const put2 = await api.put(`${API}/operations/${exId}/me`, {
      headers: { Authorization: `Bearer ${aTok}` },
      data: {
        artworkList: [
          { title: '작품A', size: '10x10', medium: 'oil', year: '2025', price: '비매', image: '' },
          { title: '작품B', size: '20x20', medium: 'acrylic', year: '2025', price: '협의', image: '' },
        ],
        cv: null, note: null, representativeIndex: 9,
      },
    });
    expect((await put2.json()).representativeIndex).toBeNull();

    // 다시 1로 복구해 두고, 갤러리 submissions에서 노출 확인
    await api.put(`${API}/operations/${exId}/me`, {
      headers: { Authorization: `Bearer ${aTok}` },
      data: {
        artworkList: [
          { title: '작품A', size: '10x10', medium: 'oil', year: '2025', price: '비매', image: '' },
          { title: '작품B', size: '20x20', medium: 'acrylic', year: '2025', price: '협의', image: '' },
        ],
        cv: null, note: null, representativeIndex: 1,
      },
    });
    const subs = await (await api.get(`${API}/operations/${exId}/submissions`, { headers: { Authorization: `Bearer ${tokenFor('gallery')}` } })).json();
    const mine = subs.find((s: any) => s.submission.artworkList.length === 2);
    expect(mine.submission.representativeIndex).toBe(1);
    await api.dispose();
  });

  test('UI: 작가가 대표작 선택→저장, 갤러리 열람뷰에 뱃지 노출', async ({ browser }) => {
    // 작가: 운영 페이지에서 대표작 선택 후 저장
    const artist = await openAs(browser, 'artist');
    await artist.page.goto(`/exhibitions/${exId}/operation`);
    await expect(artist.page.getByText('엽서 대표작', { exact: false }).first()).toBeVisible({ timeout: 10000 });
    // 대표작 후보 버튼(썸네일) 중 첫 번째 선택
    const repSection = artist.page.locator('text=엽서 대표작').first();
    await expect(repSection).toBeVisible();
    // 작품B(두번째) 라벨이 들어간 버튼 클릭
    await artist.page.getByRole('button', { name: /작품B|작품 2/ }).first().click();
    await artist.page.getByRole('button', { name: '저장', exact: true }).first().click();
    await expect(artist.page.locator('body')).toContainText('전시 정보가 저장', { timeout: 8000 });
    await artist.ctx.close();

    // 갤러리: 제출 정보 열람뷰에 '엽서 대표작' 뱃지
    const gallery = await openAs(browser, 'gallery');
    await gallery.page.goto(`/exhibitions/${exId}/operation`);
    await expect(gallery.page.getByText('작가 제출 정보', { exact: false }).first()).toBeVisible({ timeout: 10000 });
    // 작가 카드 펼치기
    await gallery.page.getByRole('button', { name: /출품 2/ }).first().click();
    await expect(gallery.page.getByText('엽서 대표작', { exact: false }).first()).toBeVisible({ timeout: 8000 });
    await gallery.ctx.close();
  });
});

// ─────────────────────────── 3) 운영 다운로드 버튼 ───────────────────────────
test.describe('운영 페이지 갤러리 다운로드', () => {
  test('UI: 캡션(한글) / 작품 원본(ZIP) / 전체 PDF 버튼 노출 + 캡션 HWP 다운로드', async ({ browser }) => {
    const { page, ctx } = await openAs(browser, 'gallery');
    await page.goto(`/exhibitions/${exId}/operation`);
    await expect(page.getByRole('button', { name: /캡션/ })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: /작품 원본/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /전체 PDF/ })).toBeVisible();

    // 캡션 한글파일(.hwp) 서버 생성 → 다운로드
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 30000 }),
      page.getByRole('button', { name: /캡션/ }).click(),
    ]);
    const fn = download.suggestedFilename();
    expect(fn).toContain('작품캡션');
    expect(fn.endsWith('.hwp')).toBeTruthy();
    await ctx.close();
  });

  test('API: 캡션 HWP는 CFB 시그니처를 가진다', async () => {
    const api = await pwRequest.newContext();
    const r = await api.get(`${API}/operations/${exId}/caption.hwp`, { headers: { Authorization: `Bearer ${tokenFor('gallery')}` } });
    expect(r.status()).toBe(200);
    const buf = await r.body();
    expect(buf.subarray(0, 8).toString('hex')).toBe('d0cf11e0a1b11ae1');
    await api.dispose();
  });

  test('UI: 작품 원본 ZIP — 이미지 없는 출품작은 안내 토스트', async ({ browser }) => {
    const { page, ctx } = await openAs(browser, 'gallery');
    await page.goto(`/exhibitions/${exId}/operation`);
    await page.getByRole('button', { name: /작품 원본/ }).click();
    // 본 공모 출품작은 image:'' 이므로 다운로드 대상 없음
    await expect(page.locator('body')).toContainText('다운로드 가능한 작품 이미지가 없습니다', { timeout: 15000 });
    await ctx.close();
  });
});

// ─────────────────────────── 4) 제출물 저장 검증 ───────────────────────────
test.describe('제출물 저장 검증(캡션 필수항목)', () => {
  test('UI: 캡션 항목(제목) 비우면 저장 차단 + 무엇이 비었는지 안내', async ({ browser }) => {
    const { page, ctx } = await openAs(browser, 'artist');
    await page.goto(`/exhibitions/${exId}/operation`);
    // 출품리스트 탭 (기본) — 첫 작품 제목 비우기
    const titleInput = page.getByPlaceholder('작품명').first();
    await expect(titleInput).toBeVisible({ timeout: 10000 });
    await titleInput.fill('');
    await page.getByRole('button', { name: '저장', exact: true }).first().click();
    // 저장 차단 + 안내 토스트
    await expect(page.locator('body')).toContainText('저장할 수 없습니다', { timeout: 8000 });
    await expect(page.locator('body')).toContainText('제목', { timeout: 8000 });
    await ctx.close();
  });

  test('API: 정상 데이터는 저장 성공(차단은 클라이언트 검증)', async () => {
    const api = await pwRequest.newContext();
    const r = await api.put(`${API}/operations/${exId}/me`, {
      headers: { Authorization: `Bearer ${tokenFor('artist')}` },
      data: {
        artworkList: [{ title: '완성작', size: '50x50', medium: 'oil', year: '2026', price: '협의', image: '' }],
        cv: null, note: null, representativeIndex: 0,
      },
    });
    expect(r.status()).toBe(200);
    await api.dispose();
  });
});
