/**
 * 복합 시나리오 검증 (CLAUDE.md 요구사항)
 * 갤러리 등록 → Admin 승인 → 검색 노출 → 공모 등록 → Admin 승인 → Artist 지원
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { request, testPrisma, authToken, cleanDb, seedUsers } from '../helpers';
import { ARTIST_APPLY_TERMS_VERSION } from '../../lib/terms';

describe('Full Flow Integration', () => {
  beforeAll(async () => {
    await cleanDb();
    await seedUsers();
  });
  afterAll(async () => {
    await cleanDb();
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
      .set('Authorization', artistToken)
      .send({ biography: '약력', artworkImages: ['https://example.com/a.jpg'], termsAgreed: true, termsVersion: ARTIST_APPLY_TERMS_VERSION });
    expect(apply.status).toBe(201);

    // 10. 중복 지원 불가
    const applyDup = await request.post(`/api/exhibitions/${exhibitionId}/apply`)
      .set('Authorization', artistToken)
      .send({ biography: '약력', artworkImages: ['https://example.com/a.jpg'], termsAgreed: true, termsVersion: ARTIST_APPLY_TERMS_VERSION });
    expect(applyDup.status).toBe(400);

    // 11. Artist의 지원 내역 확인
    const myApps = await request.get('/api/exhibitions/my-applications')
      .set('Authorization', artistToken);
    expect(myApps.status).toBe(200);
    const found = myApps.body.find((a: any) => a.exhibitionId === exhibitionId);
    expect(found).toBeDefined();

    // === 12~14: Instagram 주소(수동 입력) + OAuth 토큰 비노출 ===

    // 12. 갤러리 응답/목록에 OAuth 토큰 미노출
    expect(createGallery.body).not.toHaveProperty('instagramAccessToken');
    const galleriesCheck = await request.get('/api/galleries');
    for (const g of galleriesCheck.body) {
      expect(g).not.toHaveProperty('instagramAccessToken');
    }

    // 13. 갤러리 오너가 인스타 주소를 직접 입력 → 상세에 노출
    const setIg = await request.patch(`/api/galleries/${galleryId}/detail`)
      .set('Authorization', galleryToken)
      .send({ instagramUrl: '@flow_test_gallery' });
    expect(setIg.status).toBe(200);
    const galleryDetail = await request.get(`/api/galleries/${galleryId}`);
    expect(galleryDetail.body.instagramUrl).toBe('@flow_test_gallery');
    expect(galleryDetail.body).not.toHaveProperty('instagramAccessToken');

    // 14. 찜하기는 정상 동작 (Instagram과 무관)
    const favToggle = await request.post('/api/favorites/toggle')
      .set('Authorization', artistToken)
      .send({ galleryId });
    expect(favToggle.status).toBe(200);
    const galleryWithFav = await request.get(`/api/galleries/${galleryId}`)
      .set('Authorization', artistToken);
    expect(galleryWithFav.body.isFavorited).toBe(true);
  });

});
