import { test, expect, request as pwRequest } from '@playwright/test';
import { openAs, tokenFor, userIds, settle, ensurePublicArtworks, seedGalleryLike, realUploadUrl } from '../lib/helpers';

/**
 * MyPicks(찜 목록) 통합 + 관심 작품 — 2026-08-27~28 개편분.
 *
 *  · 좋아요한 작품 탭을 없애고 **찜 목록의 '작품' 필터**로 합쳤다(둘 다 '모아둔 것'이다).
 *  · '전체' 에서는 찜한 항목 아래에 좋아요한 작품을 이어 붙인다.
 *  · [내 리뷰] 탭은 없앴다 — 다만 **갤러리 상세의 수정·삭제는 그대로 열려 있어야 한다.**
 *  · 갤러리 [관심 작품]: 비공개 스크랩(북마크)을 없애고 **하트(좋아요)** 로 바꿨다(2026-08-28).
 *    하트로 담은 작품의 작가에게 그 자리에서 [전시 초대] 를 보낸다.
 */
const API = 'http://localhost:4000/api';
const DESKTOP = { width: 1440, height: 900 };

/** 둘러보기에 공개 작품이 하나는 있게 만든다 (공개 필드는 showInExplore — lib/helpers.ts 참고) */
const ensurePublicArtwork = async () => {
  const api = await pwRequest.newContext();
  await ensurePublicArtworks(api, tokenFor('artist'), 3);
  await api.dispose();
};

test.describe('MyPicks — 찜 목록', () => {
  test('★ 화면 좌측 상단 제목이 MyPicks 고 필터에 [작품] 이 있다', async ({ browser }) => {
    const { page, ctx } = await openAs(browser, 'artist');
    await page.setViewportSize(DESKTOP);
    await page.goto('/mypage?tab=favorites');

    const head = page.getByRole('heading', { name: /My\s*Picks/ });
    await expect(head).toBeVisible({ timeout: 15000 });

    // 제목은 **좌측 상단**(PortFolio 등과 동일)
    const box = await head.boundingBox();
    const main = await page.locator('main').boundingBox();
    expect(box!.x - main!.x, '제목이 좌측 상단에 있어야 한다').toBeLessThan(80);

    // 로고 색 규칙 — Picks 는 빨강
    const color = await head.locator('span').first().evaluate(el => getComputedStyle(el).color);
    expect(color.replace(/\s/g, '')).toBe('rgb(220,53,69)');

    for (const f of ['전체', '갤러리', '공모', '전시', '작품']) {
      await expect(page.getByRole('button', { name: f, exact: true })).toBeVisible();
    }
    await ctx.close();
  });

  test('★ 좋아요한 작품이 [작품] 필터와 [전체] 아래쪽에 나온다', async ({ browser }) => {
    await ensurePublicArtwork();
    const api = await pwRequest.newContext();
    const list = await (await api.get(`${API}/explore`)).json();
    const img = (list.images ?? list)[0];
    expect(img, '둘러보기에 공개 작품이 없다').toBeTruthy();
    await api.post(`${API}/explore/images/${img.id}/like`, {
      headers: { Authorization: `Bearer ${tokenFor('artist2')}` },
    });
    await api.dispose();

    const { page, ctx } = await openAs(browser, 'artist2');
    await page.setViewportSize(DESKTOP);
    await page.goto('/mypage?tab=favorites');
    await expect(page.getByRole('heading', { name: /My\s*Picks/ })).toBeVisible({ timeout: 15000 });

    // 전체 탭 아래쪽에 '좋아요한 작품' 구획
    await expect(page.locator('body')).toContainText('좋아요한 작품', { timeout: 10000 });

    // 작품 필터로 좁히면 그 격자만 남는다
    await page.getByRole('button', { name: '작품', exact: true }).click();
    await settle(page, 1200);
    await expect(page.locator('body')).not.toContainText('찜한 항목이 없습니다');
    await ctx.close();
  });

  test('★ [좋아요한 작품]·[내 리뷰] 는 이제 별도 탭이 아니다', async ({ browser }) => {
    const { page, ctx } = await openAs(browser, 'artist');
    await page.setViewportSize(DESKTOP);
    await page.goto('/mypage');
    const side = page.locator('aside nav');
    await expect(side).not.toContainText('좋아요한 작품');
    await expect(side).not.toContainText('내 리뷰');
    await ctx.close();
  });
});

test.describe('[내 리뷰] 탭은 없앴지만 리뷰 수정·삭제는 살아 있다', () => {
  test('★ 갤러리 상세에서 작성자 본인에게 수정·삭제가 열려 있다', async ({ browser }) => {
    // 리뷰를 쓰려면 수락된 지원이 필요하다 — 있으면 쓰고, 없으면 이 검증은 건너뛴다
    const api = await pwRequest.newContext();
    const tok = tokenFor('artist');
    const gs = await api.get(`${API}/galleries`);
    const gl = await gs.json();
    const gallery = (Array.isArray(gl) ? gl : gl.galleries)[0];
    const rv = await api.get(`${API}/reviews/reviewable/${gallery.id}`, { headers: { Authorization: `Bearer ${tok}` } });
    const reviewable = await rv.json();
    if (!Array.isArray(reviewable) || reviewable.length === 0) {
      await api.dispose();
      test.skip(true, '리뷰 작성 가능한 공모가 없다 (16-review 가 다루는 흐름)');
      return;
    }
    const made = await api.post(`${API}/reviews`, {
      headers: { Authorization: `Bearer ${tok}` },
      data: { galleryId: gallery.id, exhibitionId: reviewable[0].id, rating: 5, content: `E2E 리뷰 ${Date.now()}`, anonymous: false },
    });
    expect([200, 201]).toContain(made.status());
    await api.dispose();

    const { page, ctx } = await openAs(browser, 'artist');
    await page.setViewportSize(DESKTOP);
    await page.goto(`/galleries/${gallery.id}`);
    await expect(page.locator('body')).toContainText('E2E 리뷰', { timeout: 15000 });
    await expect(page.getByRole('button', { name: /수정/ }).first()).toBeVisible();
    await ctx.close();
  });
});

test.describe('갤러리 관심 작품 (하트로 모으고 → 초대)', () => {
  /*
    2026-08-28 개편: 갤러리의 비공개 '스크랩(북마크)'을 없앴다.
    이제 갤러리도 **하트(좋아요)** 로 작품을 모으고, 관심 작품 탭에서 그 작가에게 전시 초대를 보낸다.
  */
  test('★ 작품 모달에 관심 작품 저장(북마크) 버튼이 없다 — 하트로 대체됐다', async ({ browser }) => {
    /* 실제 이미지 파일을 쓴 작품 하나를 만들어 그 src 로 특정한다.
       SkeletonImage 는 404(더미 url) 면 <img> 를 안 그려 클릭 대상이 흔들린다(모달이 안 열림). */
    const api = await pwRequest.newContext();
    const created = await (await api.post(`${API}/portfolio/images`, {
      headers: { Authorization: `Bearer ${tokenFor('artist')}` }, data: { url: realUploadUrl() },
    })).json();
    await api.patch(`${API}/portfolio/images/${created.id}/explore`, { headers: { Authorization: `Bearer ${tokenFor('artist')}` } });
    await api.dispose();

    const { page, ctx } = await openAs(browser, 'gallery');
    await page.setViewportSize(DESKTOP);
    await page.goto('/explore');
    await expect(page.getByRole('heading', { name: 'ArtWorks' })).toBeVisible({ timeout: 15000 });
    const target = page.locator(`button:has(img[src="${created.url}"])`).first();
    await expect(target).toBeVisible({ timeout: 10000 });

    /* 모달 열기는 전체 스위트 부하에서 클릭이 한 번 씹히는 일이 있다 — 하트(모달 마커)가 뜰 때까지 재시도 */
    const likeBtn = page.getByRole('button', { name: '좋아요', exact: true }).first();
    await expect.poll(async () => {
      if (await likeBtn.count() > 0) return true;
      await target.click();
      await page.waitForTimeout(600);
      return likeBtn.count().then(c => c > 0);
    }, { timeout: 20000 }).toBe(true);

    // 모달이 열렸다 (하트가 마커) → 스크랩 버튼은 없고, 초대 버튼이 있다
    await expect(likeBtn).toBeVisible({ timeout: 8000 });
    await expect(page.getByRole('button', { name: /관심 작품 저장|관심 작품 해제/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '내 공모에 초대' })).toBeVisible();
    await ctx.close();
  });

  test('★ 하트 누른 작품이 관심 작품 탭에 뜨고, 개수·비공개 문구 대신 초대 안내가 나온다', async ({ browser }) => {
    const api = await pwRequest.newContext();
    await seedGalleryLike(api);   // 갤러리가 새 작품에 하트 (토글 취소 방지)
    await api.dispose();

    const { page, ctx } = await openAs(browser, 'gallery');
    await page.setViewportSize(DESKTOP);
    await page.goto('/mypage?tab=scraps');
    await expect(page.locator('main')).toContainText('전시 초대를 보낼 수 있습니다', { timeout: 15000 });

    // 예전의 '저장 사실은 작가에게 보이지 않습니다'·'N점' 문구는 사라졌다
    const body = await page.locator('main').innerText();
    expect(body).not.toContain('보이지 않습니다');

    // 각 카드에 [전시 초대] 버튼
    await expect(page.getByRole('button', { name: '전시 초대' }).first()).toBeVisible({ timeout: 10000 });
    await ctx.close();
  });

  test('★ 관심 작품 탭에서 [전시 초대] → 초대 모달이 열린다', async ({ browser }) => {
    const api = await pwRequest.newContext();
    await seedGalleryLike(api);
    await api.dispose();

    const { page, ctx } = await openAs(browser, 'gallery');
    await page.setViewportSize(DESKTOP);
    await page.goto('/mypage?tab=scraps');
    await page.getByRole('button', { name: '전시 초대' }).first().click();
    await expect(page.getByRole('heading', { name: '공모에 초대' })).toBeVisible({ timeout: 8000 });
    await ctx.close();
  });
});

test.describe('갤러리 계정 탭 왕복', () => {
  test('★ 프로필 ↔ 내 갤러리를 반복해도 프로필로 돌아온다', async ({ browser }) => {
    const { page, ctx } = await openAs(browser, 'gallery');
    await page.setViewportSize(DESKTOP);
    await page.goto('/mypage');
    const side = page.locator('aside nav');

    for (let i = 0; i < 3; i++) {
      await side.getByRole('link', { name: '내 갤러리' }).click();
      await page.waitForURL(/tab=my-galleries/, { timeout: 10000 });
      await expect(page.locator('aside nav [aria-current="page"]')).toContainText('내 갤러리');

      await side.getByRole('link', { name: '프로필' }).click();
      await page.waitForURL(/\/mypage$/, { timeout: 10000 });
      await expect(
        page.locator('aside nav [aria-current="page"]'),
        `${i + 1}번째 왕복에서 프로필로 안 돌아왔다`,
      ).toContainText('프로필');
    }
    await ctx.close();
  });
});
