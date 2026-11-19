import { test, expect, request as pwRequest, APIRequestContext } from '@playwright/test';
import { openAs, tokenFor, userIds, settle, ownedGalleryId, exhibitionDates , realUploadUrl, seedGalleryLike, openApplicantManager } from '../lib/helpers';

/**
 * 둘러보기 참여 + 초대/간편지원 (2026-08 신규 기능) E2E
 *
 *  A. 홈 ArtWorks 섹션(구 Favorites) → 작품 확대 → 좋아요 → 하트 유지
 *  B. 좋아요 알림(여러 명 집계) + 포트폴리오 좋아요 명단
 *  C. 좋아요한 작품 보드 (작품=확대 / 작가=이동)
 *  D. 갤러리 관심은 하트(공개) — [관심 작품]에는 작품과 작가 이름뿐
 *  E. 1:1 공모 초대는 없다(2026-11-19) — 초대 코드만 남았다
 *  (옛 E·F — 초대 → 간편지원 · 하루 10회 상한 · 정원 마감 시 초대 차단 — 는 기능째로 없앴다)
 */
const API = 'http://localhost:4000/api';
const auth = (tok: string) => ({ Authorization: `Bearer ${tok}` });

const aTok = () => tokenFor('artist');
const a2Tok = () => tokenFor('artist2');
const gTok = () => tokenFor('gallery');
const adTok = () => tokenFor('admin');

/** artist(1)의 포트폴리오에 둘러보기 공개 이미지 n장 확보 */
async function ensurePublicArtworks(api: APIRequestContext, tok: string, want = 3) {
  let pf = await (await api.get(`${API}/portfolio`, { headers: auth(tok) })).json();
  let images = pf.images || [];
  for (let i = images.length; i < want; i++) {
    await api.post(`${API}/portfolio/images`, { headers: auth(tok), data: { url: `/uploads/art${(i % 3) + 1}.png` } });
  }
  pf = await (await api.get(`${API}/portfolio`, { headers: auth(tok) })).json();
  images = pf.images || [];
  for (const img of images) {
    if (!img.showInExplore) {
      await api.patch(`${API}/portfolio/images/${img.id}/explore`, { headers: auth(tok) });
    }
  }
  pf = await (await api.get(`${API}/portfolio`, { headers: auth(tok) })).json();
  return pf.images as { id: number; url: string; showInExplore?: boolean }[];
}

/** 승인된 공모 1개 생성 */
async function createApprovedExhibition(api: APIRequestContext, opts: { capacity?: number; title?: string } = {}) {
  const galleryId = await ownedGalleryId(api);
  const today = new Date().toISOString().slice(0, 10);
  const future = new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 10);
  const ex = await (await api.post(`${API}/exhibitions`, {
    headers: auth(gTok()),
    data: {
      title: opts.title ?? `초대검증공모 ${Date.now()}`,
      type: 'SOLO', deadlineStart: today, deadline: future,
      exhibitStartDate: future, exhibitDate: future,
      capacity: opts.capacity ?? 5, region: 'SEOUL', description: '초대/간편지원 E2E',
      galleryId, ...exhibitionDates() },
  })).json();
  await api.patch(`${API}/approvals/exhibition/${ex.id}`, { headers: auth(adTok()), data: { status: 'APPROVED' } });
  return ex;
}

// ─────────────────────────────────────────────────────────────────────
test('A. 홈 ArtWorks — 작품 확대 → 좋아요 → 재오픈 시 하트 유지', async ({ browser }) => {
  const api = await pwRequest.newContext();
  const images = await ensurePublicArtworks(api, aTok(), 3);
  expect(images.length, '공개 작품 확보').toBeGreaterThan(0);

  /* 이 테스트만의 작품을 **실제 존재하는 이미지 파일**로 만든다.
     ① 접근성 라벨이 '<작가> 작가의 작품 — 크게 보기' 뿐이라 작품을 특정할 수 없다(한 작가의 여러 점이 같은 라벨).
     ② `SkeletonImage` 는 404 면 `<img>` 를 아예 안 그려서 src 로도 못 잡는다.
     그래서 진짜 파일을 쓰되 **?u= 로 src 를 유일하게** 만든다 —
     `realUploadUrl()` 은 같은 파일을 돌려줘서, 다른 스펙(34)이 같은 src 로 작품을 만들면
     `byImage(src).first()` 가 **엉뚱한(안 좋아요한) 작품**을 열어 재오픈 하트 검증이 깨진다.
     정적 서빙은 쿼리스트링을 무시하므로 파일은 그대로 뜬다. */
  const mine = await (await api.post(`${API}/portfolio/images`, {
    headers: auth(aTok()), data: { url: `${realUploadUrl()}?u=${Date.now()}` },
  })).json();
  await api.patch(`${API}/portfolio/images/${mine.id}/explore`, { headers: auth(aTok()) });

  // artist2(=다른 유저) 시점으로 홈 진입
  const { page, ctx } = await openAs(browser, 'artist2');
  await page.goto('/');

  // 섹션 노출 — 휴대폰 홈은 탭이라(2026-11-14) 첫 탭 ArtWorks 칸이 열려 있다(칸 제목은 탭이 대신한다)
  const section = page.getByTestId('home-panel-works');
  await section.scrollIntoViewIfNeeded();
  await expect(section).toBeVisible({ timeout: 10000 });

  /* 작품 클릭 → 확대 모달 (둘러보기와 동일).
     ⚠️ 홈 ArtWorks 는 **들어올 때마다 랜덤**이라(2026-08-27) '첫 번째 칸'을 두 번 눌러도
     같은 작품이라는 보장이 없다. 그래서 **작가 이름이 붙은 접근성 라벨로 특정**해 두고
     닫았다 여는 것도 같은 버튼으로 한다. */
  // 홈에서 확대 모달이 열리는 것 자체를 먼저 확인
  await page.getByRole('button', { name: /작가의 작품 — 크게 보기/ }).first().click();
  await expect(page.getByRole('button', { name: /^좋아요/ }).first()).toBeVisible({ timeout: 8000 });
  await page.getByRole('button', { name: '닫기' }).first().click();

  /* 좋아요 → 재오픈 검증은 **둘러보기(전체 목록)** 에서 한다.
     홈 ArtWorks 는 들어올 때마다 랜덤 8점이라 그 작품이 이번 화면에 없을 수 있다. */
  await page.goto('/artists');
  await expect(page.getByRole('heading', { name: 'ArtWorks' })).toBeVisible({ timeout: 10000 });
  const target = page.locator(`button:has(img[src="${mine.url}"])`).first();
  await expect(target, '방금 만든 작품이 둘러보기에 없다').toBeVisible({ timeout: 10000 });
  const targetSrc = mine.url as string;
  await target.click();
  const likeBtn = page.getByRole('button', { name: '좋아요', exact: true });
  await expect(likeBtn).toBeVisible({ timeout: 8000 });

  // 좋아요 → 마이크로카피
  await likeBtn.click();
  await expect(page.locator('body')).toContainText('작가에게 전달됐어요', { timeout: 8000 });

  // 하트가 '취소' 상태로 전환 = 켜짐
  await expect(page.getByRole('button', { name: '좋아요 취소' })).toBeVisible({ timeout: 8000 });

  // 모달 닫고 다시 열어도 하트 유지 (isLiked가 서버에서 내려오는지 — 개수 어긋남 회귀 방지)
  await page.getByRole('button', { name: '닫기' }).first().click();
  await settle(page, 800);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'ArtWorks' })).toBeVisible({ timeout: 10000 });
  const again = page.locator(`button:has(img[src="${targetSrc}"])`).first();
  await expect(again, '좋아요한 그 작품을 다시 찾지 못했다').toBeVisible({ timeout: 10000 });
  // 모달 열기 클릭이 부하에서 한 번 씹힐 수 있어, 하트 상태 버튼이 뜰 때까지 재시도
  const likeState = page.getByRole('button', { name: /^좋아요( 취소)?$/ }).first();
  await expect.poll(async () => {
    if (await likeState.count() > 0) return true;
    await again.click();
    await page.waitForTimeout(600);
    return likeState.count().then(c => c > 0);
  }, { timeout: 20000 }).toBe(true);
  await expect(page.getByRole('button', { name: '좋아요 취소' }), '재오픈 시 하트 유지').toBeVisible({ timeout: 8000 });

  await api.dispose();
  await ctx.close();
});

test('B. 좋아요 알림 집계 + 포트폴리오에서 좋아요한 사람 명단', async ({ browser }) => {
  const api = await pwRequest.newContext();
  await ensurePublicArtworks(api, aTok(), 3);

  // 다른 스펙이 먼저 좋아요를 눌러둔 이미지를 쓰면 토글이 꼬이므로 이 테스트 전용 작품을 새로 만든다
  const created = await (await api.post(`${API}/portfolio/images`, {
    headers: auth(aTok()), data: { url: `/uploads/like-agg-${Date.now()}.png` },
  })).json();
  await api.patch(`${API}/portfolio/images/${created.id}/explore`, { headers: auth(aTok()) });
  const target = created as { id: number };

  // 서로 다른 두 명(artist2, gallery)이 같은 작품에 좋아요
  await api.post(`${API}/explore/${target.id}/like`, { headers: auth(a2Tok()) });
  await api.post(`${API}/explore/${target.id}/like`, { headers: auth(gTok()) });

  // 작가 알림: 새로 쌓이지 않고 "외 1명"으로 집계
  const notis = await (await api.get(`${API}/notifications`, { headers: auth(aTok()) })).json();
  const list = Array.isArray(notis) ? notis : (notis.notifications || []);
  // 앞선 테스트가 다른 작품에 남긴 알림과 섞이지 않도록 대상 작품(refKey)만 집계
  const likeNotis = list.filter((n: any) => n.refKey === `artwork-like:${target.id}`);
  expect(likeNotis.length, '같은 작품 알림은 1건으로 집계').toBe(1);
  expect(likeNotis[0].type).toBe('ARTWORK_LIKE');
  expect(likeNotis[0].message).toContain('외 1명');
  // 마지막으로 누른 사람이 갤러리라 그 갤러리 페이지로 간다(역할별 링크 — 2026-09-19 감사 3차 `profileLinkFor`)
  expect(likeNotis[0].linkUrl, '누른 사람 프로필로 이동').toMatch(/^\/galleries\/\d+$/);

  // 작가 마이페이지 포트폴리오 → 좋아요 뱃지 → 명단 모달
  const { page, ctx } = await openAs(browser, 'artist');
  await page.goto('/mypage?tab=homepage-edit');  // 내용 편집은 homepage-edit (portfolio 탭은 PDF 포맷)
  /* ⚠️ `.first()` 로 아무 뱃지나 누르면 **다른 작품의 명단**이 열린다(앞 테스트가 남긴 좋아요).
     이 테스트의 대상은 두 명이 누른 작품이므로 '좋아요 2개' 뱃지를 콕 집는다. */
  const badge = page.getByRole('button', { name: /좋아요 2개 — 누가 눌렀는지 보기/ }).first();
  await expect(badge, '포트폴리오에 좋아요 수 뱃지').toBeVisible({ timeout: 10000 });
  await badge.click();
  await expect(page.getByRole('heading', { name: /좋아요 \d+/ })).toBeVisible({ timeout: 8000 });
  await expect(page.locator('body')).toContainText('Artist 2');

  // 명단에서 그 사람 포트폴리오로 이동
  await page.getByRole('button', { name: 'Artist 2' }).first().click();
  await expect(page).toHaveURL(new RegExp(`/portfolio/${userIds().artist2}$`), { timeout: 8000 });

  await api.dispose();
  await ctx.close();
});

test('C. 좋아요한 작품 보드 — 작품=확대 / 작가명=포트폴리오 이동', async ({ browser }) => {
  const api = await pwRequest.newContext();
  const images = await ensurePublicArtworks(api, aTok(), 3);
  await api.post(`${API}/explore/${images[0].id}/like`, { headers: auth(a2Tok()) });

  const { page, ctx } = await openAs(browser, 'artist2');
  await page.goto('/mypage?tab=favorites');  // 좋아요한 작품은 찜 목록 안 '작품' 필터로 합쳐졌다
  await page.getByRole('button', { name: '작품', exact: true }).click();
  await expect(page.getByRole('button', { name: '작품 크게 보기' }).first()).toBeVisible({ timeout: 10000 });

  // 작품 클릭 → 확대 모달
  await page.getByRole('button', { name: '작품 크게 보기' }).first().click();
  await expect(page.getByRole('button', { name: '좋아요 취소' }), '이미 좋아요한 상태').toBeVisible({ timeout: 8000 });
  await page.getByRole('button', { name: '닫기' }).first().click();
  await settle(page, 500);

  // 작가 이름 클릭 → 포트폴리오 이동
  await page.getByRole('button', { name: 'Artist 1' }).first().click();
  await expect(page).toHaveURL(new RegExp(`/portfolio/${userIds().artist}$`), { timeout: 8000 });

  await api.dispose();
  await ctx.close();
});

test('D. 갤러리 관심은 하트(공개) — 저장(스크랩)·초대·문의 버튼은 [관심 작품]에 없다', async ({ browser }) => {
  /*
    2026-08-28 개편: 갤러리의 비공개 스크랩(북마크)을 없앴다. 갤러리도 **하트**로 작품을 모은다.
    스크랩과 달리 하트는 **작가에게 보인다**(관심을 숨길 이유가 없다는 판단) — 그 트레이드오프를 여기서 못 박는다.
    2026-11-19: 1:1 공모 초대를 통째로 없앴다(사용자 결정). [관심 작품] 카드에는 [전시 초대]도 [문의하기]도 없다 —
    문의는 작가 홈페이지에서 한다(카드의 작가 이름 → 홈페이지).
  */
  const api = await pwRequest.newContext();
  // 갤러리가 새 작품(작가 소유)에 하트 — 토글 취소 방지
  const target = await seedGalleryLike(api);

  // 갤러리: 작품 모달에 저장(북마크)·초대 버튼이 없고, 문의는 [작품 문의하기](문의 창)
  const g = await openAs(browser, 'gallery');
  await g.page.goto('/artists');
  await g.page.getByRole('button', { name: /작가의 작품 — 크게 보기/ }).first().click();
  await expect(g.page.getByRole('button', { name: /관심 작품 저장|관심 작품 해제/ }), '스크랩 버튼은 없어졌다').toHaveCount(0);
  await expect(g.page.getByRole('button', { name: /초대/ })).toHaveCount(0);
  await expect(g.page.getByRole('button', { name: '작품 문의하기' }), '문의는 남아 있다(문의 창을 연다)').toBeVisible({ timeout: 8000 });

  // 관심 작품 탭 = 하트 보드. 작품과 작가 이름뿐
  await g.page.goto('/mypage?tab=scraps');
  await expect(g.page.getByRole('button', { name: '작품 크게 보기' }).first()).toBeVisible({ timeout: 10000 });
  const main = g.page.locator('main');
  await expect(main.getByRole('button', { name: /전시 초대|문의하기|초대/ })).toHaveCount(0);
  expect(await main.innerText()).not.toContain('전시 초대를 보낼 수 있습니다');
  // 작가 이름 → 그 작가 홈페이지(문의는 거기서)
  await main.getByRole('button', { name: 'Artist 1' }).first().click();
  await expect(g.page).toHaveURL(new RegExp(`/(portfolio/${userIds().artist}|@[^/?]+)`), { timeout: 10000 });

  // ★ 트레이드오프: 갤러리의 하트는 작품 주인(작가)에게 보인다 (owner 만 조회 가능한 likers 에 잡힌다)
  const likes = await (await api.get(`${API}/explore/${target.id}/likes`, { headers: auth(aTok()) })).json();
  const galleryId = userIds().gallery;
  expect((likes.likers ?? []).some((l: any) => l.id === galleryId), '작가는 어느 갤러리가 하트했는지 볼 수 있다').toBe(true);

  // 스크랩 전용 목록은 더는 갤러리 UI가 쓰지 않는다(백엔드 라우트는 유지) — 작가는 여전히 접근 불가
  const denied = await api.get(`${API}/explore/scraps`, { headers: auth(aTok()) });
  expect(denied.status()).toBe(403);

  await api.dispose();
  await g.ctx.close();
});

test('E. 1:1 공모 초대는 없다(2026-11-19) — API 404 · [내 전시]에 받은 초대 탭 없음 · 공모 상세에 간편 지원 없음 · 초대 코드는 그대로', async ({ browser }) => {
  const api = await pwRequest.newContext();
  await ensurePublicArtworks(api, aTok(), 3);
  const ex = await createApprovedExhibition(api, { capacity: 3, title: `초대없음 ${Date.now()}` });

  // 서버: 초대 보내기·받은 초대·초대 수락·거절·공모별 초대 목록 — 전부 없다
  const send = await api.post(`${API}/exhibitions/${ex.id}/invite`, { headers: auth(gTok()), data: { artistId: userIds().artist } });
  expect(send.status(), '초대 보내기 라우트가 없다').toBe(404);
  expect((await api.get(`${API}/exhibitions/invites/received`, { headers: auth(aTok()) })).status()).toBe(404);
  expect((await api.get(`${API}/exhibitions/${ex.id}/invites`, { headers: auth(gTok()) })).status()).toBe(404);
  expect((await api.post(`${API}/exhibitions/invites/1/accept`, { headers: auth(aTok()) })).status()).toBe(404);

  // 공모 상세 응답에 invited 가 없다
  const detail = await (await api.get(`${API}/exhibitions/${ex.id}`, { headers: auth(aTok()) })).json();
  expect('invited' in detail, '공모 상세에 invited 필드가 남아 있다').toBe(false);

  // 갤러리 [지원자 관리]에 [작가 초대]가 없다 — 초대 **코드** 줄은 그대로(이미 선정한 작가를 옮겨 올 때)
  const g = await openAs(browser, 'gallery');
  const card = await openApplicantManager(g.page, ex.title);
  await expect(card.getByRole('button', { name: '작가 초대' })).toHaveCount(0);
  await expect(card).toContainText('초대 코드', { timeout: 10000 });

  // 초대 코드는 그대로 돈다 — 코드를 만들고 작가가 그 코드로 들어오면 바로 선정
  const code = await (await api.post(`${API}/exhibitions/${ex.id}/join-code`, { headers: auth(gTok()) })).json();
  expect(code.code, '초대 코드 발급').toBeTruthy();
  const joined = await api.post(`${API}/exhibitions/join`, { headers: auth(aTok()), data: { code: code.code } });
  expect([200, 201], '초대 코드 참여(새로 들어오면 201)').toContain(joined.status());
  const apps = await (await api.get(`${API}/exhibitions/${ex.id}/applications`, { headers: auth(gTok()) })).json();
  const app = apps.find((x: any) => x.userId === userIds().artist);
  expect(app?.status, '코드로 들어오면 바로 선정').toBe('ACCEPTED');
  expect('invited' in (app ?? {}), '지원자 목록에 invited 필드가 남아 있다').toBe(false);

  // 화면: 작가 [내 전시]에 받은 초대 탭이 없다(지원·참여가 있어야 탭이 그려진다 — 위에서 코드로 들어왔다)
  const a = await openAs(browser, 'artist');
  await a.page.goto('/mypage?tab=applications');
  await expect(a.page.getByRole('tab', { name: /^심사 중/ })).toBeVisible({ timeout: 10000 });
  await expect(a.page.getByRole('tab', { name: /받은 초대|초대받은/ })).toHaveCount(0);
  // 공모 상세 — 아직 안 들어온 작가에게는 [지원하기]뿐(간편 지원·초대 안내 없음)
  const a2 = await openAs(browser, 'artist2');
  await a2.page.goto(`/exhibitions/${ex.id}`);
  await expect(a2.page.getByRole('button', { name: '지원하기' }).first()).toBeVisible({ timeout: 10000 });
  await expect(a2.page.getByRole('button', { name: '간편 지원' })).toHaveCount(0);
  await expect(a2.page.locator('body')).not.toContainText('초대받은 공모예요');
  await a2.ctx.close();

  await api.dispose();
  await a.ctx.close();
  await g.ctx.close();
});
