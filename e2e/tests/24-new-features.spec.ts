import { test, expect, request as pwRequest, APIRequestContext } from '@playwright/test';
import { openAs, tokenFor, exhibitionDates, openGallerySubmissions, openArtistExhibition } from '../lib/helpers';
import { applyToExhibition } from '../lib/helpers';

/**
 * 신규 기능 E2E (기능 + 신뢰성):
 *  1) 갤러리 전화번호·주소 무승인 수정 (API 권한/검증 + UI)
 *  2) 엽서 대표작(representativeIndex) 저장/범위검증/뱃지 (API + UI)
 *  3) 운영 페이지 갤러리 다운로드 버튼(캡션 시트 / 작품 원본 ZIP / 전체 PDF) 노출 + 캡션 PDF 생성
 *
 * 2026-09-29: 옛 `/operation` 화면을 여는 UI 테스트를 새 화면으로 옮겼다 —
 *  · 작가는 운영 페이지가 아니라 **[내 전시] 카드 안**에서 낸다(`?tab=applications&ex=`). 버튼은 [임시저장]·[갤러리에 제출] 둘.
 *  · 대표작은 작품 카드의 **[☆ 대표작]** 토글(예전 '엽서 대표작' 썸네일 띠 + [저장]).
 *  · 갤러리 다운로드는 [출품 자료] 구역의 **[내려받기 ▾]** 메뉴 하나(예전 버튼 넷).
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
    data: { title: '신규기능공모 ' + Date.now(), type: 'SOLO', deadlineStart: new Date().toISOString().slice(0, 10), deadline: future, exhibitStartDate: future, exhibitDate: future, capacity: 5, region: '서울', description: '신규기능', galleryId: gid, ...exhibitionDates() },
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
    await expect(page.locator('body')).toContainText('갤러리 정보가 수정되었습니다', { timeout: 8000 });
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

  test('UI: 작가가 작품 카드의 [☆ 대표작]으로 바꿔 제출 → 갤러리 열람뷰에 대표작 표시', async ({ browser }) => {
    // 작가: [내 전시] 카드 안의 출품 자료 — API 로 작품A·B 를 넣고 대표작은 B(1) 로 둔 상태
    const artist = await openAs(browser, 'artist');
    const card = await openArtistExhibition(artist.page, exId);
    const workA = card.locator('[id$="-art-0"]');
    const workB = card.locator('[id$="-art-1"]');
    await expect(workB.getByRole('button', { name: '대표작', exact: true })).toHaveAttribute('aria-pressed', 'true', { timeout: 10000 });

    // A 로 바꾼다 — 저장 전인데도 고를 수 있다(예전엔 '저장한 작품만' 이라 비활성이었다)
    await workA.getByRole('button', { name: '대표작', exact: true }).click();
    await expect(workA.getByRole('button', { name: '대표작', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(workB.getByRole('button', { name: '대표작', exact: true })).toHaveAttribute('aria-pressed', 'false');

    // [갤러리에 제출] — 약력·작가노트가 비어 있으니 한 번 묻는다 → 출품작만 먼저 제출
    await card.getByRole('button', { name: '갤러리에 제출' }).click();
    await artist.page.getByRole('dialog').getByRole('button', { name: '출품작만 먼저 제출' }).click();
    await expect(artist.page.locator('body')).toContainText('갤러리에 제출했어요', { timeout: 8000 });
    await artist.ctx.close();

    // 서버에도 대표작 0(작품A)
    const api = await pwRequest.newContext();
    const me = await (await api.get(`${API}/operations/${exId}/me`, { headers: { Authorization: `Bearer ${tokenFor('artist')}` } })).json();
    expect(me.representativeIndex).toBe(0);
    await api.dispose();

    // 갤러리: 출품 자료에서 작가 줄을 펼치면 대표작 표시가 작품A 에 붙어 있다
    const gallery = await openAs(browser, 'gallery');
    await openGallerySubmissions(gallery.page, exId);
    await gallery.page.getByRole('button', { name: /출품작 2점/ }).first().click();
    // 열람뷰의 작품 줄은 제목 칸에 title 속성이 있다 — 그 줄에만 '대표작' 표시가 붙는다
    // 작가 줄(li)이 작품 줄(li)을 품고 있어 둘 다 걸린다 — 가장 안쪽(마지막) 것이 작품 줄
    await expect(gallery.page.locator('li:has(span[title="작품A"])').last()).toContainText('대표작', { timeout: 8000 });
    await expect(gallery.page.locator('li:has(span[title="작품B"])').last()).not.toContainText('대표작');
    await gallery.ctx.close();
  });
});

// ─────────────────────────── 3) 운영 다운로드 버튼 ───────────────────────────
test.describe('운영 페이지 갤러리 다운로드', () => {
  test('UI: [내려받기] 메뉴에 캡션(한글) / 작품 원본(ZIP) / 전체 PDF / 도록 + 캡션 HWP 다운로드', async ({ browser }) => {
    const { page, ctx } = await openAs(browser, 'gallery');
    await openGallerySubmissions(page, exId);
    await page.getByRole('button', { name: '내려받기' }).first().click();
    await expect(page.getByRole('menuitem', { name: /작품 캡션/ })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('menuitem', { name: /작품 원본/ })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /전체 출품 자료 PDF/ })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /단체전 도록/ })).toBeVisible();

    // 캡션 한글파일(.hwp) 서버 생성 → 다운로드
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 30000 }),
      page.getByRole('menuitem', { name: /작품 캡션/ }).click(),
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
    await openGallerySubmissions(page, exId);
    await page.getByRole('button', { name: '내려받기' }).first().click();
    await page.getByRole('menuitem', { name: /작품 원본/ }).click();
    // 본 공모 출품작은 image:'' 이므로 다운로드 대상 없음
    await expect(page.locator('body')).toContainText('다운로드 가능한 작품 이미지가 없습니다', { timeout: 15000 });
    await ctx.close();
  });
});

// ─────────────────────────── 4) 제출물 저장 검증 ───────────────────────────
test.describe('제출물 저장 검증(캡션 필수항목)', () => {
  test('UI: 캡션 항목(제목) 비우면 제출 차단 + 무엇이 비었는지 카드에 표시', async ({ browser }) => {
    const { page, ctx } = await openAs(browser, 'artist');
    const card = await openArtistExhibition(page, exId);
    /* 첫 작품 제목 비우기.
       ⚠️ placeholder 가 '작품명' → '예: 푸른 밤의 정원' 으로 바뀌었다(라벨이 '작품명' 을 맡는다).
       라벨로 찾으면 문구가 또 바뀌어도 안 깨진다. */
    const titleInput = card.locator('label').filter({ hasText: '작품명' }).first().locator('input');
    await expect(titleInput).toBeVisible({ timeout: 10000 });
    await titleInput.fill('');
    await card.getByRole('button', { name: '갤러리에 제출' }).click();
    // 제출 차단 + 안내 토스트 + 그 작품 카드에 빠진 칸
    await expect(page.locator('body')).toContainText('빨간 칸을 채워 주세요', { timeout: 8000 });
    await expect(card.locator('[id$="-art-0"]')).toContainText('채워 주세요: 작품명');
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
