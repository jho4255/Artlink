/**
 * 데이터 정합성 복합 시나리오 테스트
 * - 리뷰 → 별점 재계산 → GotM 반영 체인
 * - Cascade 삭제 정합성
 * - 찜 상태 일관성 (Gallery + Exhibition + Show)
 * - 승인 상태 전환 정합성
 * - 동시 리뷰/찜 정합성
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { request, testPrisma, authToken, cleanDb, seedUsers } from '../helpers';

// 토큰 상수
const artist1Token = `Bearer ${authToken(1, 'ARTIST')}`;
const artist2Token = `Bearer ${authToken(2, 'ARTIST')}`;
const galleryToken = `Bearer ${authToken(3, 'GALLERY')}`;
const adminToken = `Bearer ${authToken(4, 'ADMIN')}`;

describe('데이터 정합성 복합 시나리오', () => {
  beforeAll(async () => {
    await cleanDb();
    await seedUsers();
  });

  // ============================================================
  // 시나리오 1: 리뷰 → 별점 재계산 → GotM 반영 → 리뷰 삭제 → 별점 재계산 체인
  // ============================================================
  describe('시나리오 1: 리뷰-별점-GotM 연쇄 정합성', () => {
    beforeEach(async () => {
      // 부분 정리 (리뷰, 찜, GotM, 전시, 공모, 갤러리)
      await testPrisma.galleryOfMonth.deleteMany();
      await testPrisma.review.deleteMany();
      await testPrisma.favorite.deleteMany();
      await testPrisma.showImage.deleteMany();
      await testPrisma.show.deleteMany();
      await testPrisma.application.deleteMany();
      await testPrisma.promoPhoto.deleteMany();
      await testPrisma.exhibition.deleteMany();
      await testPrisma.galleryImage.deleteMany();
      await testPrisma.gallery.deleteMany();
    });

    it('Artist1 리뷰(5점) → Artist2 리뷰(3점) → GotM 등록 → Artist1 삭제 → 별점 갱신 체인', async () => {
      // 승인된 갤러리 생성
      const gallery = await testPrisma.gallery.create({
        data: {
          name: '별점 체인 갤러리', address: '서울시 종로구', phone: '02-0000-0001',
          description: '별점 테스트용', region: 'SEOUL', ownerName: 'Owner',
          status: 'APPROVED', ownerId: 3,
        },
      });

      // 1) Artist1이 별점 5 리뷰 작성
      const review1Res = await request.post('/api/reviews')
        .set('Authorization', artist1Token)
        .send({ galleryId: gallery.id, rating: 5, content: '최고의 갤러리!' });
      expect(review1Res.status).toBe(201);
      const review1Id = review1Res.body.id;

      // 갤러리 rating=5 확인
      const g1 = await testPrisma.gallery.findUnique({ where: { id: gallery.id } });
      expect(g1!.rating).toBe(5);
      expect(g1!.reviewCount).toBe(1);

      // 2) Artist2가 별점 3 리뷰 작성
      const review2Res = await request.post('/api/reviews')
        .set('Authorization', artist2Token)
        .send({ galleryId: gallery.id, rating: 3, content: '보통입니다' });
      expect(review2Res.status).toBe(201);

      // 갤러리 rating=4 ((5+3)/2) 확인
      const g2 = await testPrisma.gallery.findUnique({ where: { id: gallery.id } });
      expect(g2!.rating).toBe(4);
      expect(g2!.reviewCount).toBe(2);

      // 3) Admin이 이달의 갤러리 등록
      const gotmRes = await request.post('/api/gallery-of-month')
        .set('Authorization', adminToken)
        .send({
          galleryId: gallery.id,
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        });
      expect(gotmRes.status).toBe(201);

      // GET /gallery-of-month에서 rating=4 확인
      const gotmList1 = await request.get('/api/gallery-of-month');
      expect(gotmList1.status).toBe(200);
      const gotmEntry1 = gotmList1.body.find((g: any) => g.galleryId === gallery.id);
      expect(gotmEntry1).toBeDefined();
      expect(gotmEntry1.gallery.rating).toBe(4);

      // 4) Artist1이 리뷰 삭제 → rating=3
      const deleteRes = await request.delete(`/api/reviews/${review1Id}`)
        .set('Authorization', artist1Token);
      expect(deleteRes.status).toBe(200);

      // DB에서 rating=3 확인
      const g3 = await testPrisma.gallery.findUnique({ where: { id: gallery.id } });
      expect(g3!.rating).toBe(3);
      expect(g3!.reviewCount).toBe(1);

      // 5) GET /gallery-of-month에서 rating=3 반영 확인
      const gotmList2 = await request.get('/api/gallery-of-month');
      const gotmEntry2 = gotmList2.body.find((g: any) => g.galleryId === gallery.id);
      expect(gotmEntry2).toBeDefined();
      expect(gotmEntry2.gallery.rating).toBe(3);
    });
  });

  // ============================================================
  // 시나리오 2: Cascade 삭제 정합성
  // ============================================================
  describe('시나리오 2: Cascade 삭제 정합성', () => {
    beforeEach(async () => {
      await testPrisma.galleryOfMonth.deleteMany();
      await testPrisma.favorite.deleteMany();
      await testPrisma.review.deleteMany();
      await testPrisma.application.deleteMany();
      await testPrisma.promoPhoto.deleteMany();
      await testPrisma.showImage.deleteMany();
      await testPrisma.show.deleteMany();
      await testPrisma.exhibition.deleteMany();
      await testPrisma.galleryImage.deleteMany();
      await testPrisma.gallery.deleteMany();
    });

    it('Gallery 삭제 시 Exhibition, Show, Review, Favorite, GotM 모두 cascade 삭제', async () => {
      // 갤러리 생성
      const gallery = await testPrisma.gallery.create({
        data: {
          name: 'Cascade 테스트 갤러리', address: '서울시 강남구', phone: '02-0000-0002',
          description: 'Cascade 테스트', region: 'SEOUL', ownerName: 'Owner',
          status: 'APPROVED', ownerId: 3,
        },
      });

      // Exhibition 생성
      const exhibition = await testPrisma.exhibition.create({
        data: {
          title: 'Cascade 공모', type: 'SOLO',
          deadline: new Date(Date.now() + 30 * 86400000),
          exhibitDate: new Date(Date.now() + 60 * 86400000),
          capacity: 5, region: 'SEOUL', description: '테스트',
          status: 'APPROVED', galleryId: gallery.id,
        },
      });

      // Show 생성
      const show = await testPrisma.show.create({
        data: {
          title: 'Cascade 전시', description: '테스트 전시',
          startDate: new Date(Date.now() - 7 * 86400000),
          endDate: new Date(Date.now() + 30 * 86400000),
          openingHours: '10:00-18:00', admissionFee: '무료',
          location: '서울시 강남구', region: 'SEOUL',
          posterImage: 'https://example.com/poster.jpg',
          status: 'APPROVED', galleryId: gallery.id,
        },
      });

      // ShowImage 생성
      await testPrisma.showImage.create({
        data: { url: 'https://example.com/show-img.jpg', order: 0, showId: show.id },
      });

      // Review 생성 (Artist1)
      await request.post('/api/reviews')
        .set('Authorization', artist1Token)
        .send({ galleryId: gallery.id, rating: 4, content: 'Cascade 리뷰' });

      // Favorite 생성 (Gallery, Exhibition, Show 각각)
      await request.post('/api/favorites/toggle')
        .set('Authorization', artist1Token)
        .send({ galleryId: gallery.id });
      await request.post('/api/favorites/toggle')
        .set('Authorization', artist1Token)
        .send({ exhibitionId: exhibition.id });
      await request.post('/api/favorites/toggle')
        .set('Authorization', artist1Token)
        .send({ showId: show.id });

      // GotM 등록
      await testPrisma.galleryOfMonth.create({
        data: {
          galleryId: gallery.id,
          expiresAt: new Date(Date.now() + 30 * 86400000),
        },
      });

      // 삭제 전 데이터 존재 확인
      expect(await testPrisma.exhibition.count({ where: { galleryId: gallery.id } })).toBe(1);
      expect(await testPrisma.show.count({ where: { galleryId: gallery.id } })).toBe(1);
      expect(await testPrisma.review.count({ where: { galleryId: gallery.id } })).toBe(1);
      expect(await testPrisma.favorite.count({ where: { userId: 1 } })).toBe(3);
      expect(await testPrisma.galleryOfMonth.count({ where: { galleryId: gallery.id } })).toBe(1);
      expect(await testPrisma.showImage.count({ where: { showId: show.id } })).toBe(1);

      // Admin이 갤러리 삭제
      const deleteRes = await request.delete(`/api/galleries/${gallery.id}`)
        .set('Authorization', adminToken);
      expect(deleteRes.status).toBe(200);

      // DB 직접 조회: 관련 데이터 모두 삭제 확인
      expect(await testPrisma.gallery.findUnique({ where: { id: gallery.id } })).toBeNull();
      expect(await testPrisma.exhibition.count({ where: { galleryId: gallery.id } })).toBe(0);
      expect(await testPrisma.show.count({ where: { galleryId: gallery.id } })).toBe(0);
      expect(await testPrisma.review.count({ where: { galleryId: gallery.id } })).toBe(0);
      expect(await testPrisma.favorite.count({ where: { userId: 1 } })).toBe(0);
      expect(await testPrisma.galleryOfMonth.count({ where: { galleryId: gallery.id } })).toBe(0);
      expect(await testPrisma.showImage.count({ where: { showId: show.id } })).toBe(0);

      // API에서도 미노출 확인
      const exhibitionsRes = await request.get('/api/exhibitions');
      const exFound = exhibitionsRes.body.find((e: any) => e.id === exhibition.id);
      expect(exFound).toBeUndefined();

      const showsRes = await request.get('/api/shows');
      const showFound = showsRes.body.find((s: any) => s.id === show.id);
      expect(showFound).toBeUndefined();
    });
  });

  // ============================================================
  // 시나리오 3: 찜 상태 일관성 (Gallery + Exhibition + Show 동시)
  // ============================================================
  describe('시나리오 3: 찜 상태 일관성', () => {
    beforeEach(async () => {
      await testPrisma.galleryOfMonth.deleteMany();
      await testPrisma.favorite.deleteMany();
      await testPrisma.review.deleteMany();
      await testPrisma.application.deleteMany();
      await testPrisma.promoPhoto.deleteMany();
      await testPrisma.showImage.deleteMany();
      await testPrisma.show.deleteMany();
      await testPrisma.exhibition.deleteMany();
      await testPrisma.galleryImage.deleteMany();
      await testPrisma.gallery.deleteMany();
    });

    it('Gallery/Exhibition/Show 찜 → Gallery 삭제 → 모든 찜 cascade 삭제', async () => {
      // 갤러리 + Exhibition + Show 생성
      const gallery = await testPrisma.gallery.create({
        data: {
          name: '찜 테스트 갤러리', address: '서울시 서초구', phone: '02-0000-0003',
          description: '찜 테스트', region: 'SEOUL', ownerName: 'Owner',
          status: 'APPROVED', ownerId: 3,
        },
      });
      const exhibition = await testPrisma.exhibition.create({
        data: {
          title: '찜 테스트 공모', type: 'SOLO',
          deadline: new Date(Date.now() + 30 * 86400000),
          exhibitDate: new Date(Date.now() + 60 * 86400000),
          capacity: 5, region: 'SEOUL', description: '테스트',
          status: 'APPROVED', galleryId: gallery.id,
        },
      });
      const show = await testPrisma.show.create({
        data: {
          title: '찜 테스트 전시', description: '테스트',
          startDate: new Date(Date.now() - 7 * 86400000),
          endDate: new Date(Date.now() + 30 * 86400000),
          openingHours: '10:00-18:00', admissionFee: '무료',
          location: '서울시 서초구', region: 'SEOUL',
          posterImage: 'https://example.com/poster.jpg',
          status: 'APPROVED', galleryId: gallery.id,
        },
      });

      // Artist1이 3개 모두 찜
      const favGallery = await request.post('/api/favorites/toggle')
        .set('Authorization', artist1Token)
        .send({ galleryId: gallery.id });
      expect(favGallery.body.favorited).toBe(true);

      const favExhibition = await request.post('/api/favorites/toggle')
        .set('Authorization', artist1Token)
        .send({ exhibitionId: exhibition.id });
      expect(favExhibition.body.favorited).toBe(true);

      const favShow = await request.post('/api/favorites/toggle')
        .set('Authorization', artist1Token)
        .send({ showId: show.id });
      expect(favShow.body.favorited).toBe(true);

      // GET /favorites에 3개 모두 포함 확인
      const favList = await request.get('/api/favorites')
        .set('Authorization', artist1Token);
      expect(favList.status).toBe(200);
      expect(favList.body.length).toBe(3);

      // Gallery 찜, Exhibition 찜, Show 찜 각각 존재 확인
      const hasGalleryFav = favList.body.some((f: any) => f.galleryId === gallery.id);
      const hasExhibitionFav = favList.body.some((f: any) => f.exhibitionId === exhibition.id);
      const hasShowFav = favList.body.some((f: any) => f.showId === show.id);
      expect(hasGalleryFav).toBe(true);
      expect(hasExhibitionFav).toBe(true);
      expect(hasShowFav).toBe(true);

      // Gallery 삭제 → 모든 관련 찜 cascade 삭제
      const deleteRes = await request.delete(`/api/galleries/${gallery.id}`)
        .set('Authorization', adminToken);
      expect(deleteRes.status).toBe(200);

      // GET /favorites → 빈 배열
      const favListAfter = await request.get('/api/favorites')
        .set('Authorization', artist1Token);
      expect(favListAfter.body.length).toBe(0);

      // DB 확인: 모든 찜 삭제
      const favCount = await testPrisma.favorite.count({ where: { userId: 1 } });
      expect(favCount).toBe(0);
    });
  });

  // ============================================================
  // 시나리오 4: 승인 상태 전환 정합성
  // ============================================================
  describe('시나리오 4: 승인 상태 전환 정합성', () => {
    beforeEach(async () => {
      await testPrisma.galleryOfMonth.deleteMany();
      await testPrisma.favorite.deleteMany();
      await testPrisma.review.deleteMany();
      await testPrisma.application.deleteMany();
      await testPrisma.promoPhoto.deleteMany();
      await testPrisma.showImage.deleteMany();
      await testPrisma.show.deleteMany();
      await testPrisma.exhibition.deleteMany();
      await testPrisma.galleryImage.deleteMany();
      await testPrisma.gallery.deleteMany();
    });

    it('Gallery/Exhibition/Show: PENDING → APPROVED → 노출, REJECTED → 미노출 + 사유, 재등록 가능', async () => {
      // === Gallery 승인 흐름 ===

      // Gallery 등록 (PENDING)
      const createGalleryRes = await request.post('/api/galleries')
        .set('Authorization', galleryToken)
        .send({
          name: '승인 테스트 갤러리', address: '서울시 마포구', phone: '02-0000-0004',
          description: '승인 테스트', region: 'SEOUL', ownerName: 'Owner',
        });
      expect(createGalleryRes.status).toBe(201);
      expect(createGalleryRes.body.status).toBe('PENDING');
      const galleryId = createGalleryRes.body.id;

      // PENDING → 목록 미노출
      const galBefore = await request.get('/api/galleries');
      expect(galBefore.body.find((g: any) => g.id === galleryId)).toBeUndefined();

      // APPROVED → 목록 노출
      await request.patch(`/api/approvals/gallery/${galleryId}`)
        .set('Authorization', adminToken)
        .send({ status: 'APPROVED' });

      const galAfter = await request.get('/api/galleries');
      expect(galAfter.body.find((g: any) => g.id === galleryId)).toBeDefined();

      // === Exhibition 승인 흐름 ===

      const createExRes = await request.post('/api/exhibitions')
        .set('Authorization', galleryToken)
        .send({
          galleryId, title: '승인 테스트 공모', type: 'SOLO',
          deadline: new Date(Date.now() + 30 * 86400000).toISOString(),
          exhibitDate: new Date(Date.now() + 60 * 86400000).toISOString(),
          capacity: 5, region: 'SEOUL', description: '승인 테스트 공모',
        });
      expect(createExRes.status).toBe(201);
      const exId = createExRes.body.id;

      // PENDING → 목록 미노출
      const exBefore = await request.get('/api/exhibitions');
      expect(exBefore.body.find((e: any) => e.id === exId)).toBeUndefined();

      // APPROVED → 목록 노출
      await request.patch(`/api/approvals/exhibition/${exId}`)
        .set('Authorization', adminToken)
        .send({ status: 'APPROVED' });

      const exAfter = await request.get('/api/exhibitions');
      expect(exAfter.body.find((e: any) => e.id === exId)).toBeDefined();

      // === Show 승인 흐름 ===

      const createShowRes = await request.post('/api/shows')
        .set('Authorization', galleryToken)
        .send({
          galleryId, title: '승인 테스트 전시', description: '전시 설명',
          startDate: new Date(Date.now() - 7 * 86400000).toISOString(),
          endDate: new Date(Date.now() + 30 * 86400000).toISOString(),
          openingHours: '10:00-18:00', admissionFee: '무료',
          location: '서울시 마포구', region: 'SEOUL',
          posterImage: 'https://example.com/poster.jpg',
        });
      expect(createShowRes.status).toBe(201);
      const showId = createShowRes.body.id;

      // PENDING → 목록 미노출
      const showBefore = await request.get('/api/shows');
      expect(showBefore.body.find((s: any) => s.id === showId)).toBeUndefined();

      // APPROVED → 목록 노출
      await request.patch(`/api/approvals/show/${showId}`)
        .set('Authorization', adminToken)
        .send({ status: 'APPROVED' });

      const showAfter = await request.get('/api/shows');
      expect(showAfter.body.find((s: any) => s.id === showId)).toBeDefined();

      // === REJECTED 흐름 ===

      // Gallery2 등록 → REJECTED
      const createGal2 = await request.post('/api/galleries')
        .set('Authorization', galleryToken)
        .send({
          name: '거절 갤러리', address: '서울시 강북구', phone: '02-0000-0005',
          description: '거절 테스트', region: 'SEOUL', ownerName: 'Owner',
        });
      const gal2Id = createGal2.body.id;

      const rejectGal = await request.patch(`/api/approvals/gallery/${gal2Id}`)
        .set('Authorization', adminToken)
        .send({ status: 'REJECTED', rejectReason: '정보 부족' });
      expect(rejectGal.status).toBe(200);
      expect(rejectGal.body.status).toBe('REJECTED');
      expect(rejectGal.body.rejectReason).toBe('정보 부족');

      // REJECTED → 목록 미노출
      const galRejected = await request.get('/api/galleries');
      expect(galRejected.body.find((g: any) => g.id === gal2Id)).toBeUndefined();

      // DB에서 rejectReason 저장 확인
      const rejectedGal = await testPrisma.gallery.findUnique({ where: { id: gal2Id } });
      expect(rejectedGal!.rejectReason).toBe('정보 부족');

      // === REJECTED 후 재등록 → PENDING → 재승인 가능 ===

      // 새 갤러리 등록 (기존 거절된 것과 별개)
      const createGal3 = await request.post('/api/galleries')
        .set('Authorization', galleryToken)
        .send({
          name: '재등록 갤러리', address: '서울시 동작구', phone: '02-0000-0006',
          description: '재등록 테스트', region: 'SEOUL', ownerName: 'Owner',
        });
      expect(createGal3.status).toBe(201);
      expect(createGal3.body.status).toBe('PENDING');
      const gal3Id = createGal3.body.id;

      // 재승인
      const reApprove = await request.patch(`/api/approvals/gallery/${gal3Id}`)
        .set('Authorization', adminToken)
        .send({ status: 'APPROVED' });
      expect(reApprove.status).toBe(200);
      expect(reApprove.body.status).toBe('APPROVED');

      // 목록 노출 확인
      const galFinal = await request.get('/api/galleries');
      expect(galFinal.body.find((g: any) => g.id === gal3Id)).toBeDefined();
    });
  });

  // ============================================================
  // 시나리오 5: 동시 리뷰/찜 정합성
  // ============================================================
  describe('시나리오 5: 동시 리뷰/찜 정합성', () => {
    beforeEach(async () => {
      await testPrisma.galleryOfMonth.deleteMany();
      await testPrisma.favorite.deleteMany();
      await testPrisma.review.deleteMany();
      await testPrisma.application.deleteMany();
      await testPrisma.promoPhoto.deleteMany();
      await testPrisma.showImage.deleteMany();
      await testPrisma.show.deleteMany();
      await testPrisma.exhibition.deleteMany();
      await testPrisma.galleryImage.deleteMany();
      await testPrisma.gallery.deleteMany();
    });

    it('Artist1/2 동시 리뷰 → 별점 평균 정밀도, 독립적 찜 상태', async () => {
      // 승인된 갤러리 생성
      const gallery = await testPrisma.gallery.create({
        data: {
          name: '동시성 테스트 갤러리', address: '부산시 해운대구', phone: '051-0000-0001',
          description: '동시 리뷰/찜 테스트', region: 'BUSAN', ownerName: 'Owner',
          status: 'APPROVED', ownerId: 3,
        },
      });

      // Artist1: 별점 4 리뷰
      const r1 = await request.post('/api/reviews')
        .set('Authorization', artist1Token)
        .send({ galleryId: gallery.id, rating: 4, content: '좋아요' });
      expect(r1.status).toBe(201);

      // Artist2: 별점 3 리뷰
      const r2 = await request.post('/api/reviews')
        .set('Authorization', artist2Token)
        .send({ galleryId: gallery.id, rating: 3, content: '괜찮아요' });
      expect(r2.status).toBe(201);

      // 별점 평균 = (4+3)/2 = 3.5 (소수점 정밀도)
      const g = await testPrisma.gallery.findUnique({ where: { id: gallery.id } });
      expect(g!.rating).toBe(3.5);
      expect(g!.reviewCount).toBe(2);

      // API 응답에서도 rating 확인
      const galDetail = await request.get(`/api/galleries/${gallery.id}`);
      expect(galDetail.body.rating).toBe(3.5);

      // Artist1 찜
      const fav1 = await request.post('/api/favorites/toggle')
        .set('Authorization', artist1Token)
        .send({ galleryId: gallery.id });
      expect(fav1.body.favorited).toBe(true);

      // Artist2 찜
      const fav2 = await request.post('/api/favorites/toggle')
        .set('Authorization', artist2Token)
        .send({ galleryId: gallery.id });
      expect(fav2.body.favorited).toBe(true);

      // 각 Artist의 isFavorited 독립 확인
      const gal1 = await request.get(`/api/galleries/${gallery.id}`)
        .set('Authorization', artist1Token);
      expect(gal1.body.isFavorited).toBe(true);

      const gal2 = await request.get(`/api/galleries/${gallery.id}`)
        .set('Authorization', artist2Token);
      expect(gal2.body.isFavorited).toBe(true);

      // Artist1 찜 해제
      const unfav1 = await request.post('/api/favorites/toggle')
        .set('Authorization', artist1Token)
        .send({ galleryId: gallery.id });
      expect(unfav1.body.favorited).toBe(false);

      // Artist1: isFavorited=false, Artist2: isFavorited=true (독립)
      const gal1After = await request.get(`/api/galleries/${gallery.id}`)
        .set('Authorization', artist1Token);
      expect(gal1After.body.isFavorited).toBe(false);

      const gal2After = await request.get(`/api/galleries/${gallery.id}`)
        .set('Authorization', artist2Token);
      expect(gal2After.body.isFavorited).toBe(true);

      // DB에서 찜 개수 확인 (Artist2만 남음)
      const favCount = await testPrisma.favorite.count({
        where: { galleryId: gallery.id },
      });
      expect(favCount).toBe(1);

      // 별점은 영향 없음 (여전히 3.5)
      const gFinal = await testPrisma.gallery.findUnique({ where: { id: gallery.id } });
      expect(gFinal!.rating).toBe(3.5);
    });
  });
});
