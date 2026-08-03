import { test, expect, request as pwRequest, APIRequestContext } from '@playwright/test';
import { openAs, tokenFor, userIds, settle, ownedGalleryId } from '../lib/helpers';

/**
 * 둘러보기 참여 + 초대/간편지원 (2026-08 신규 기능) E2E
 *
 *  A. 홈 Favorites 섹션 → 작품 확대 → 좋아요 → 하트 유지
 *  B. 좋아요 알림(여러 명 집계) + 포트폴리오 좋아요 명단
 *  C. 좋아요한 작품 보드 (작품=확대 / 작가=이동)
 *  D. 갤러리 스크랩(비공개) + 작가에게 미노출
 *  E. 복합: 발견 → 스크랩 → 초대 → 알림 → 간편지원 → 수락 → 운영페이지
 *  F. 방어: 하루 10회 상한 / 정원 마감 시 초대 차단·목록 자동 제거 / 초대 삭제
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
      capacity: opts.capacity ?? 5, region: '서울', description: '초대/간편지원 E2E',
      galleryId,
    },
  })).json();
  await api.patch(`${API}/approvals/exhibition/${ex.id}`, { headers: auth(adTok()), data: { status: 'APPROVED' } });
  return ex;
}

// ─────────────────────────────────────────────────────────────────────
test('A. 홈 Favorites — 작품 확대 → 좋아요 → 재오픈 시 하트 유지', async ({ browser }) => {
  const api = await pwRequest.newContext();
  const images = await ensurePublicArtworks(api, aTok(), 3);
  expect(images.length, '공개 작품 확보').toBeGreaterThan(0);

  // artist2(=다른 유저) 시점으로 홈 진입
  const { page, ctx } = await openAs(browser, 'artist2');
  await page.goto('/');

  // 섹션 노출 (제목 Favorites)
  const section = page.getByRole('heading', { name: 'Favorites' });
  await section.scrollIntoViewIfNeeded();
  await expect(section).toBeVisible({ timeout: 10000 });

  // 작품 클릭 → 확대 모달 (둘러보기와 동일)
  await page.getByRole('button', { name: /작가의 작품 — 크게 보기/ }).first().click();
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
  await page.getByRole('heading', { name: 'Favorites' }).scrollIntoViewIfNeeded();
  await page.getByRole('button', { name: /작가의 작품 — 크게 보기/ }).first().click();
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
  expect(likeNotis[0].linkUrl, '누른 사람 프로필로 이동').toMatch(/^\/portfolio\/\d+$/);

  // 작가 마이페이지 포트폴리오 → 좋아요 뱃지 → 명단 모달
  const { page, ctx } = await openAs(browser, 'artist');
  await page.goto('/mypage?tab=portfolio');
  const badge = page.getByRole('button', { name: /좋아요 \d+개 — 누가 눌렀는지 보기/ }).first();
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
  await page.goto('/mypage?tab=liked-artworks');
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

test('D. 갤러리 스크랩은 비공개 — 작가 시점에 흔적이 없다', async ({ browser }) => {
  const api = await pwRequest.newContext();
  const images = await ensurePublicArtworks(api, aTok(), 3);
  const target = images[0];

  // 갤러리: 둘러보기에서 작품 확대 → 북마크
  const g = await openAs(browser, 'gallery');
  await g.page.goto('/explore');
  await g.page.getByRole('button', { name: /작가의 작품 — 크게 보기/ }).first().click();
  const bookmark = g.page.getByRole('button', { name: '관심 작품 저장' });
  await expect(bookmark).toBeVisible({ timeout: 10000 });
  await bookmark.click();
  await expect(g.page.locator('body')).toContainText('작가에게는 보이지 않습니다', { timeout: 8000 });

  // 관심 작품 탭에서 회수 + 메모 + 확대
  await g.page.goto('/mypage?tab=scraps');
  await expect(g.page.locator('body')).toContainText('저장 사실은 작가에게 보이지 않습니다', { timeout: 10000 });
  await g.page.getByRole('button', { name: '+ 메모 추가' }).first().click();
  await g.page.getByPlaceholder('메모 (나만 봅니다)').fill('가을 기획전 후보');
  await g.page.getByRole('button', { name: '저장', exact: true }).first().click();
  await expect(g.page.locator('body')).toContainText('가을 기획전 후보', { timeout: 8000 });
  await g.page.getByRole('button', { name: '작품 크게 보기' }).first().click();
  await expect(g.page.getByRole('button', { name: '관심 작품 해제' }), '보드에서도 확대 모달').toBeVisible({ timeout: 8000 });

  // 작가 시점: 스크랩 흔적 없음 (API + UI 양쪽)
  const feed = await (await api.get(`${API}/explore`, { headers: auth(aTok()) })).json();
  expect(JSON.stringify(feed), '작가 응답에 scrap 관련 필드 없음').not.toContain('scrap');
  const denied = await api.get(`${API}/explore/scraps`, { headers: auth(aTok()) });
  expect(denied.status(), '작가는 스크랩 목록 접근 불가').toBe(403);

  const a = await openAs(browser, 'artist');
  await a.page.goto('/explore');
  await a.page.getByRole('button', { name: /작가의 작품 — 크게 보기/ }).first().click();
  await expect(a.page.getByRole('button', { name: '좋아요' }).first()).toBeVisible({ timeout: 10000 });
  await expect(a.page.getByRole('button', { name: /관심 작품/ }), '작가에겐 스크랩 버튼 자체가 없음').toHaveCount(0);

  await api.dispose();
  await g.ctx.close();
  await a.ctx.close();
});

test('E. 복합 — 발견→스크랩→초대→알림→간편지원→수락→운영페이지', async ({ browser }) => {
  const api = await pwRequest.newContext();
  await ensurePublicArtworks(api, aTok(), 3);
  const ex = await createApprovedExhibition(api, { capacity: 3, title: `복합시나리오 ${Date.now()}` });

  // 1) 갤러리: 둘러보기 → 작품 확대 → 초대
  const g = await openAs(browser, 'gallery');
  await g.page.goto('/explore');
  await g.page.getByRole('button', { name: /작가의 작품 — 크게 보기/ }).first().click();
  await g.page.getByRole('button', { name: '내 공모에 초대' }).click();
  await expect(g.page.getByRole('heading', { name: '공모에 초대' })).toBeVisible({ timeout: 8000 });
  await g.page.getByRole('button', { name: new RegExp(ex.title) }).click();
  await g.page.getByPlaceholder('작품 잘 봤습니다. 함께하고 싶습니다.').fill('E2E 초대 메시지');
  await g.page.getByRole('button', { name: '초대 보내기' }).click();
  await expect(g.page.locator('body')).toContainText('초대를 보냈습니다', { timeout: 10000 });

  // 2) 작가: 알림 수신 + 받은 초대 목록
  const inv = await (await api.get(`${API}/exhibitions/invites/received`, { headers: auth(aTok()) })).json();
  const mine = inv.invites.find((i: any) => i.exhibition.id === ex.id);
  expect(mine, '받은 초대에 노출').toBeTruthy();
  expect(mine.message).toBe('E2E 초대 메시지');

  const a = await openAs(browser, 'artist');
  await a.page.goto('/mypage?tab=invites');
  await expect(a.page.locator('body')).toContainText(ex.title, { timeout: 10000 });
  await expect(a.page.locator('body')).toContainText('E2E 초대 메시지');

  // 3) 간편 지원 (지원서 작성 없이 약관만)
  await a.page.getByRole('button', { name: '간편 지원' }).first().click();
  await expect(a.page.getByRole('heading', { name: '간편 지원' })).toBeVisible({ timeout: 8000 });
  await expect(a.page.locator('body')).toContainText('지원서를 다시 작성하지 않습니다');
  await a.page.getByRole('checkbox').first().check();
  await a.page.getByRole('button', { name: '지원하기' }).click();
  await expect(a.page.locator('body')).toContainText('지원이 접수되었습니다', { timeout: 10000 });

  // 4) 지원서에 포트폴리오 내용이 자동 첨부됐는지 (빈 지원서 방지)
  const apps = await (await api.get(`${API}/exhibitions/${ex.id}/applications`, { headers: auth(gTok()) })).json();
  const app = apps.find((x: any) => x.userId === userIds().artist);
  expect(app.status, '자동 수락이 아니라 접수 상태').toBe('SUBMITTED');
  expect(app.invited, '초대 건으로 표시').toBe(true);
  expect((app.artworkImages || []).length, '포트폴리오 작품 자동 첨부').toBeGreaterThan(0);
  expect((app.biography || '').length, '약력 자동 첨부').toBeGreaterThan(0);

  // 5) 갤러리 UI(마이페이지 내 공모 → 지원자 관리 인라인): '초대한 작가' 배지 확인
  await g.page.goto('/mypage?tab=my-exhibitions');
  await expect(g.page.locator('body')).toContainText(ex.title, { timeout: 15000 });
  // 제목과 '지원자 관리' 버튼을 함께 가진 가장 안쪽 컨테이너 = 해당 공모 카드
  const card = g.page.locator('div')
    .filter({ hasText: ex.title })
    .filter({ has: g.page.getByRole('button', { name: '지원자 관리' }) })
    .last();
  await card.getByRole('button', { name: '지원자 관리' }).click();
  await expect(g.page.locator('body')).toContainText('Artist 1', { timeout: 15000 });
  await expect(g.page.locator('body'), '초대한 작가 배지').toContainText('초대한 작가');

  await api.patch(`${API}/exhibitions/${ex.id}/applications/${app.id}`, {
    headers: auth(gTok()), data: { status: 'ACCEPTED' },
  });

  // 6) 수락된 작가는 운영 페이지 접근 가능
  const access = await (await api.get(`${API}/operations/${ex.id}/access`, { headers: auth(aTok()) })).json();
  expect(access.isAcceptedArtist, '수락 작가 운영페이지 접근').toBe(true);

  await api.dispose();
  await g.ctx.close();
  await a.ctx.close();
});

test('F1. 공모 상세 — 초대받은 작가만 간편 지원 버튼', async ({ browser }) => {
  const api = await pwRequest.newContext();
  await ensurePublicArtworks(api, aTok(), 3);
  const ex = await createApprovedExhibition(api, { capacity: 3 });
  await api.post(`${API}/exhibitions/${ex.id}/invite`, {
    headers: auth(gTok()), data: { artistId: userIds().artist },
  });

  // 초대받은 작가 → 간편 지원
  const a = await openAs(browser, 'artist');
  await a.page.goto(`/exhibitions/${ex.id}`);
  await expect(a.page.getByRole('button', { name: '간편 지원' })).toBeVisible({ timeout: 10000 });
  await expect(a.page.locator('body')).toContainText('초대받은 공모예요');

  // 초대 안 받은 작가 → 기존 지원하기
  const a2 = await openAs(browser, 'artist2');
  await a2.page.goto(`/exhibitions/${ex.id}`);
  await expect(a2.page.getByRole('button', { name: '지원하기' })).toBeVisible({ timeout: 10000 });
  await expect(a2.page.getByRole('button', { name: '간편 지원' })).toHaveCount(0);

  await api.dispose();
  await a.ctx.close();
  await a2.ctx.close();
});

test('F2. 초대 삭제 — 확인 다이얼로그 후 목록에서 사라짐', async ({ browser }) => {
  const api = await pwRequest.newContext();
  await ensurePublicArtworks(api, aTok(), 3);
  const ex = await createApprovedExhibition(api, { capacity: 3, title: `초대해제검증 ${Date.now()}` });
  await api.post(`${API}/exhibitions/${ex.id}/invite`, {
    headers: auth(gTok()), data: { artistId: userIds().artist },
  });

  const { page, ctx } = await openAs(browser, 'artist');
  await page.goto('/mypage?tab=invites');
  await expect(page.locator('body')).toContainText(ex.title, { timeout: 10000 });

  await page.getByRole('button', { name: '삭제', exact: true }).first().click();
  await expect(page.getByText('초대 삭제')).toBeVisible({ timeout: 8000 });
  await expect(page.locator('body')).toContainText('되돌릴 수 없습니다');
  await page.getByRole('button', { name: '삭제', exact: true }).last().click();
  await expect(page.locator('body')).toContainText('초대를 삭제했습니다', { timeout: 8000 });
  await expect(page.locator('body')).not.toContainText(ex.title, { timeout: 8000 });

  // 삭제해도 갤러리는 재초대 불가 (스팸 방지) — 유니크 제약이 살아있어야 한다
  const re = await api.post(`${API}/exhibitions/${ex.id}/invite`, {
    headers: auth(gTok()), data: { artistId: userIds().artist },
  });
  expect(re.status(), '재초대 차단(409)').toBe(409);

  await api.dispose();
  await ctx.close();
});

test('F3. 정원 마감 — 초대 차단 + 받은 초대에서 자동 제거 + 거절 시 복구', async () => {
  const api = await pwRequest.newContext();
  await ensurePublicArtworks(api, aTok(), 3);
  const ex = await createApprovedExhibition(api, { capacity: 1, title: `정원1 ${Date.now()}` });

  // artist에게 초대 (아직 자리 있음)
  const ok = await api.post(`${API}/exhibitions/${ex.id}/invite`, {
    headers: auth(gTok()), data: { artistId: userIds().artist },
  });
  expect(ok.status()).toBe(201);

  let inv = await (await api.get(`${API}/exhibitions/invites/received`, { headers: auth(aTok()) })).json();
  expect(inv.invites.some((i: any) => i.exhibition.id === ex.id), '초대 노출').toBe(true);

  // artist2가 지원해 정원 1명을 채움
  const applied = await api.post(`${API}/exhibitions/${ex.id}/apply`, {
    headers: auth(a2Tok()),
    data: {
      biography: 'E2E 약력', artworkImages: ['https://example.com/a.jpg'],
      termsAgreed: true, termsVersion: 'artist_apply_2026-07-03',
    },
  });
  expect(applied.status()).toBe(201);

  // ① 정원이 찬 공모에는 초대 자체가 차단
  const blocked = await api.post(`${API}/exhibitions/${ex.id}/invite`, {
    headers: auth(gTok()), data: { artistId: userIds().admin },
  });
  expect(blocked.status(), '정원 마감 → 초대 400').toBe(400);
  expect((await blocked.json()).error).toContain('모집 인원');

  // ② 기존 초대는 받은 초대 목록에서 자동 제거
  inv = await (await api.get(`${API}/exhibitions/invites/received`, { headers: auth(aTok()) })).json();
  expect(inv.invites.some((i: any) => i.exhibition.id === ex.id), '정원 마감 → 목록에서 제거').toBe(false);

  // ③ 상세의 간편 지원 버튼도 사라짐
  const detail = await (await api.get(`${API}/exhibitions/${ex.id}`, { headers: auth(aTok()) })).json();
  expect(detail.invited, '정원 마감 → invited=false').toBe(false);

  // ④ 갤러리가 거절 → 슬롯 복구 → 초대가 다시 보임
  const apps = await (await api.get(`${API}/exhibitions/${ex.id}/applications`, { headers: auth(gTok()) })).json();
  await api.patch(`${API}/exhibitions/${ex.id}/applications/${apps[0].id}`, {
    headers: auth(gTok()), data: { status: 'REJECTED' },
  });
  inv = await (await api.get(`${API}/exhibitions/invites/received`, { headers: auth(aTok()) })).json();
  expect(inv.invites.some((i: any) => i.exhibition.id === ex.id), '슬롯 복구 → 초대 재노출').toBe(true);

  await api.dispose();
});

test('F4. 하루 초대 상한 10명', async () => {
  const api = await pwRequest.newContext();
  const stamp = Date.now();

  // 상한은 '갤러리 계정 기준 24시간 합산'이라 앞선 테스트의 초대와 섞이면 안 된다.
  // → 초대 0건인 새 갤러리 계정을 만들어 격리한다.
  const gSignup = await (await api.post(`${API}/auth/signup`, {
    data: { email: `limitgallery${stamp}@e2e.test`, password: 'e2e-pass-1234', name: '상한테스트갤러리', role: 'GALLERY' },
  })).json();
  const newGTok = gSignup.token;
  const gal = await (await api.post(`${API}/galleries`, {
    headers: auth(newGTok),
    data: {
      name: `상한갤러리 ${stamp}`, address: '서울시 종로구', phone: '02-1234-5678',
      description: '초대 상한 테스트', region: '서울', ownerName: '상한테스트갤러리',
    },
  })).json();
  await api.patch(`${API}/approvals/gallery/${gal.id}`, { headers: auth(adTok()), data: { status: 'APPROVED' } });

  const today = new Date().toISOString().slice(0, 10);
  const future = new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 10);
  const ex = await (await api.post(`${API}/exhibitions`, {
    headers: auth(newGTok),
    data: {
      title: `상한테스트 ${stamp}`, type: 'SOLO', deadlineStart: today, deadline: future,
      exhibitStartDate: future, exhibitDate: future, capacity: 50, region: '서울',
      description: '초대 상한 E2E', galleryId: gal.id,
    },
  })).json();
  await api.patch(`${API}/approvals/exhibition/${ex.id}`, { headers: auth(adTok()), data: { status: 'APPROVED' } });

  // 초대 대상 작가 10명 생성 (회원가입 API)
  const targets: number[] = [];
  for (let i = 0; i < 10; i++) {
    const r = await api.post(`${API}/auth/signup`, {
      data: {
        email: `invitee${stamp}_${i}@e2e.test`,
        password: 'e2e-pass-1234',
        name: `초대대상${i}`,
        role: 'ARTIST',
      },
    });
    const body = await r.json();
    const id = body.user?.id ?? body.id;
    expect(id, `대상 작가 ${i} 생성`).toBeTruthy();
    targets.push(id);
  }

  for (let i = 0; i < 10; i++) {
    const r = await api.post(`${API}/exhibitions/${ex.id}/invite`, {
      headers: auth(newGTok), data: { artistId: targets[i] },
    });
    expect(r.status(), `${i + 1}번째 초대는 성공`).toBe(201);
  }

  // 11번째 → 상한 차단
  const over = await api.post(`${API}/exhibitions/${ex.id}/invite`, {
    headers: auth(newGTok), data: { artistId: userIds().artist },
  });
  expect(over.status(), '11번째 초대 차단').toBe(400);
  expect((await over.json()).error).toContain('하루에 최대 10명');

  await api.dispose();
});
