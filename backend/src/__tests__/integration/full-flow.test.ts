/**
 * 복합 시나리오 검증 (CLAUDE.md 요구사항)
 * 갤러리 등록 → Admin 승인 → 검색 노출 → 공모 등록 → Admin 승인 → Artist 지원
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { request, testPrisma, authToken, cleanDb, seedUsers } from '../helpers';

describe('Full Flow Integration', () => {
  beforeAll(async () => {
    await cleanDb();
    await seedUsers();
  });
  afterAll(async () => {
    await cleanDb();
    await testPrisma.$disconnect();
  });

  it('갤러리 등록 → 승인 → 검색 → 공모 등록 → 승인 → 지원 전체 흐름', async () => {
    const galleryToken = `Bearer ${authToken(3, 'GALLERY')}`;
    const adminToken = `Bearer ${authToken(4, 'ADMIN')}`;
    const artistToken = `Bearer ${authToken(1, 'ARTIST')}`;

    // 1. Gallery 유저가 갤러리 등록 → PENDING
    const createGallery = await request.post('/api/galleries')
      .set('Authorization', galleryToken)
      .send({
        name: 'Flow Test Gallery', address: '서울시 강남구', phone: '02-1111-2222',
        description: '통합 테스트 갤러리', region: 'SEOUL', ownerName: 'Test Owner',
      });
    expect(createGallery.status).toBe(201);
    expect(createGallery.body.status).toBe('PENDING');
    const galleryId = createGallery.body.id;

    // 2. PENDING 상태에서는 검색에 노출되지 않음
    const beforeApproval = await request.get('/api/galleries');
    const foundBefore = beforeApproval.body.find((g: any) => g.id === galleryId);
    expect(foundBefore).toBeUndefined();

    // 3. Admin이 갤러리 승인
    const approveGallery = await request.patch(`/api/approvals/gallery/${galleryId}`)
      .set('Authorization', adminToken)
      .send({ status: 'APPROVED' });
    expect(approveGallery.status).toBe(200);
    expect(approveGallery.body.status).toBe('APPROVED');

    // 4. 승인 후 검색에 노출됨
    const afterApproval = await request.get('/api/galleries');
    const foundAfter = afterApproval.body.find((g: any) => g.id === galleryId);
    expect(foundAfter).toBeDefined();
    expect(foundAfter.name).toBe('Flow Test Gallery');

    // 5. Gallery 유저가 공모 등록 → PENDING
    const createExhibition = await request.post('/api/exhibitions')
      .set('Authorization', galleryToken)
      .send({
        galleryId, title: 'Flow Test Exhibition', type: 'SOLO',
        deadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        exhibitDate: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(),
        capacity: 3, region: 'SEOUL', description: '통합 테스트 공모',
      });
    expect(createExhibition.status).toBe(201);
    expect(createExhibition.body.status).toBe('PENDING');
    const exhibitionId = createExhibition.body.id;

    // 6. PENDING 공모는 검색에 노출되지 않음
    const exhBefore = await request.get('/api/exhibitions');
    const exhFoundBefore = exhBefore.body.find((e: any) => e.id === exhibitionId);
    expect(exhFoundBefore).toBeUndefined();

    // 7. Admin이 공모 승인
    const approveExhibition = await request.patch(`/api/approvals/exhibition/${exhibitionId}`)
      .set('Authorization', adminToken)
      .send({ status: 'APPROVED' });
    expect(approveExhibition.status).toBe(200);

    // 8. 승인 후 공모 검색에 노출됨
    const exhAfter = await request.get('/api/exhibitions');
    const exhFoundAfter = exhAfter.body.find((e: any) => e.id === exhibitionId);
    expect(exhFoundAfter).toBeDefined();

    // 9. Artist가 공모에 지원
    const apply = await request.post(`/api/exhibitions/${exhibitionId}/apply`)
      .set('Authorization', artistToken);
    expect(apply.status).toBe(201);

    // 10. 중복 지원 불가
    const applyDup = await request.post(`/api/exhibitions/${exhibitionId}/apply`)
      .set('Authorization', artistToken);
    expect(applyDup.status).toBe(400);

    // 11. Artist의 지원 내역 확인
    const myApps = await request.get('/api/exhibitions/my-applications')
      .set('Authorization', artistToken);
    expect(myApps.status).toBe(200);
    const found = myApps.body.find((a: any) => a.exhibitionId === exhibitionId);
    expect(found).toBeDefined();

    // === 12~18: Instagram 연동 복합 시나리오 ===

    // 12. 갤러리 생성 응답에 instagramConnected가 있고 false
    expect(createGallery.body).toHaveProperty('instagramConnected');
    expect(createGallery.body.instagramConnected).toBe(false);
    expect(createGallery.body).not.toHaveProperty('instagramAccessToken');

    // 13. 갤러리 목록에서도 instagramAccessToken 미노출
    const galleriesCheck = await request.get('/api/galleries');
    for (const g of galleriesCheck.body) {
      expect(g).not.toHaveProperty('instagramAccessToken');
      expect(g).toHaveProperty('instagramConnected');
    }

    // 14. 미연동 상태에서 피드 ON 시도 → 400
    const failVisibility = await request.patch(`/api/galleries/${galleryId}/instagram-visibility`)
      .set('Authorization', galleryToken)
      .send({ visible: true });
    expect(failVisibility.status).toBe(400);

    // 15. 미연동 상태에서 피드 조회 → 빈 배열
    const emptyFeed = await request.get(`/api/galleries/${galleryId}/instagram-feed`);
    expect(emptyFeed.body).toEqual([]);

    // 16. Instagram 토큰 연동 (Graph API mock)
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: '99999', username: 'flow_test_gallery' }),
    } as any);

    const saveToken = await request.post(`/api/galleries/${galleryId}/instagram-token`)
      .set('Authorization', galleryToken)
      .send({ accessToken: 'flow_test_valid_token' });
    expect(saveToken.status).toBe(200);
    expect(saveToken.body.instagramConnected).toBe(true);
    expect(saveToken.body.username).toBe('flow_test_gallery');

    // 17. 연동 후 갤러리 상세에서 instagramConnected=true, token 미노출
    const galleryDetail = await request.get(`/api/galleries/${galleryId}`);
    expect(galleryDetail.body.instagramConnected).toBe(true);
    expect(galleryDetail.body.instagramUrl).toBe('@flow_test_gallery');
    expect(galleryDetail.body).not.toHaveProperty('instagramAccessToken');

    // 18. 피드 토글 ON → 피드 조회 시 게시물 반환
    const toggleOn = await request.patch(`/api/galleries/${galleryId}/instagram-visibility`)
      .set('Authorization', galleryToken)
      .send({ visible: true });
    expect(toggleOn.status).toBe(200);

    // 피드 mock
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { id: '1', media_type: 'IMAGE', media_url: 'https://img/1.jpg', permalink: 'https://ig/p/1', timestamp: '2026-03-10T00:00:00Z' },
        ],
      }),
    } as any);

    const feedOn = await request.get(`/api/galleries/${galleryId}/instagram-feed`);
    expect(feedOn.body.length).toBe(1);
    expect(feedOn.body[0].mediaType).toBe('IMAGE');

    // 19. 피드 토글 OFF → 빈 배열
    await request.patch(`/api/galleries/${galleryId}/instagram-visibility`)
      .set('Authorization', galleryToken)
      .send({ visible: false });

    const feedOff = await request.get(`/api/galleries/${galleryId}/instagram-feed`);
    expect(feedOff.body).toEqual([]);

    // 20. 찜하기는 여전히 정상 동작 (Instagram과 무관)
    const favToggle = await request.post('/api/favorites/toggle')
      .set('Authorization', artistToken)
      .send({ galleryId });
    expect(favToggle.status).toBe(200);

    const galleryWithFav = await request.get(`/api/galleries/${galleryId}`)
      .set('Authorization', artistToken);
    expect(galleryWithFav.body.isFavorited).toBe(true);
    expect(galleryWithFav.body.instagramConnected).toBe(true);

    // 21. Artist는 토큰 저장 불가 (비오너)
    const artistAttempt = await request.post(`/api/galleries/${galleryId}/instagram-token`)
      .set('Authorization', artistToken)
      .send({ accessToken: 'hacker_token' });
    expect(artistAttempt.status).toBe(403);

    global.fetch = originalFetch;
  });
});
