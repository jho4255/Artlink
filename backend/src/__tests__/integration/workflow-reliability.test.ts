/**
 * 복합 워크플로우 신뢰성 테스트
 * - Gallery Owner 시점 전체 서비스 흐름
 * - Artist 시점 전체 서비스 흐름
 * - 권한 경계 테스트
 * - 수정 요청 워크플로우
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { request, testPrisma, authToken, cleanDb, seedUsers } from '../helpers';

describe('Workflow Reliability', () => {
  const galleryToken = `Bearer ${authToken(3, 'GALLERY')}`;
  const adminToken = `Bearer ${authToken(4, 'ADMIN')}`;
  const artistToken = `Bearer ${authToken(1, 'ARTIST')}`;
  const artist2Token = `Bearer ${authToken(2, 'ARTIST')}`;

  beforeAll(async () => {
    await cleanDb();
    await seedUsers();
  });

  // ============================================================
  // 시나리오 1: Gallery Owner 시점 전체 서비스 흐름
  // ============================================================
  describe('Gallery Owner 전체 서비스 흐름', () => {
    beforeEach(async () => {
      // 관련 데이터만 정리 (User 유지)
      await testPrisma.application.deleteMany();
      await testPrisma.approvalRequest.deleteMany();
      await testPrisma.favorite.deleteMany();
      await testPrisma.review.deleteMany();
      await testPrisma.promoPhoto.deleteMany();
      await testPrisma.showImage.deleteMany();
      await testPrisma.show.deleteMany();
      await testPrisma.exhibition.deleteMany();
      await testPrisma.galleryImage.deleteMany();
      await testPrisma.gallery.deleteMany();
      await testPrisma.heroSlide.deleteMany();
    });

    it('Gallery 등록(거절→재등록→승인) → Exhibition → CustomFields → Show → Hero Slide 전체 흐름', async () => {
      // 1. Gallery 등록 → PENDING
      const createRes = await request.post('/api/galleries')
        .set('Authorization', galleryToken)
        .send({
          name: 'WR Test Gallery', address: '서울시 강남구', phone: '02-9999-8888',
          description: '워크플로우 테스트', region: 'SEOUL', ownerName: 'WR Owner',
        });
      expect(createRes.status).toBe(201);
      expect(createRes.body.status).toBe('PENDING');
      const galleryId1 = createRes.body.id;

      // 2. Admin이 거절 (사유 포함)
      const rejectRes = await request.patch(`/api/approvals/gallery/${galleryId1}`)
        .set('Authorization', adminToken)
        .send({ status: 'REJECTED', rejectReason: '소개가 너무 짧습니다.' });
      expect(rejectRes.status).toBe(200);
      expect(rejectRes.body.status).toBe('REJECTED');
      expect(rejectRes.body.rejectReason).toBe('소개가 너무 짧습니다.');

      // 3. 거절된 Gallery는 목록에 노출되지 않음
      const listAfterReject = await request.get('/api/galleries');
      expect(listAfterReject.body.find((g: any) => g.id === galleryId1)).toBeUndefined();

      // 4. Gallery 유저가 재등록
      const reCreateRes = await request.post('/api/galleries')
        .set('Authorization', galleryToken)
        .send({
          name: 'WR Test Gallery v2', address: '서울시 종로구', phone: '02-8888-7777',
          description: '워크플로우 테스트 갤러리 - 상세 소개 추가', region: 'SEOUL', ownerName: 'WR Owner',
        });
      expect(reCreateRes.status).toBe(201);
      const galleryId2 = reCreateRes.body.id;

      // 5. Admin이 승인
      const approveRes = await request.patch(`/api/approvals/gallery/${galleryId2}`)
        .set('Authorization', adminToken)
        .send({ status: 'APPROVED' });
      expect(approveRes.status).toBe(200);
      expect(approveRes.body.status).toBe('APPROVED');

      // 6. 승인된 Gallery가 목록에 노출
      const listAfterApprove = await request.get('/api/galleries');
      const found = listAfterApprove.body.find((g: any) => g.id === galleryId2);
      expect(found).toBeDefined();
      expect(found.name).toBe('WR Test Gallery v2');

      // 7. Exhibition 등록 → PENDING
      const exhRes = await request.post('/api/exhibitions')
        .set('Authorization', galleryToken)
        .send({
          galleryId: galleryId2, title: 'WR Exhibition', type: 'SOLO',
          deadline: new Date(Date.now() + 30 * 86400000).toISOString(),
          exhibitDate: new Date(Date.now() + 60 * 86400000).toISOString(),
          capacity: 5, region: 'SEOUL', description: 'WR 공모 테스트',
        });
      expect(exhRes.status).toBe(201);
      expect(exhRes.body.status).toBe('PENDING');
      const exhId = exhRes.body.id;

      // 8. Admin이 Exhibition 승인
      const approveExh = await request.patch(`/api/approvals/exhibition/${exhId}`)
        .set('Authorization', adminToken)
        .send({ status: 'APPROVED' });
      expect(approveExh.status).toBe(200);

      // 9. Exhibition에 커스텀 필드 추가
      const cfRes = await request.patch(`/api/exhibitions/${exhId}/custom-fields`)
        .set('Authorization', galleryToken)
        .send({
          customFields: [
            { id: 'cf1', label: '작업 스타일', type: 'text', required: true },
            { id: 'cf2', label: '포트폴리오 파일', type: 'file', required: false },
          ],
        });
      expect(cfRes.status).toBe(200);
      expect(cfRes.body.customFields).toHaveLength(2);
      expect(cfRes.body.customFields[0].label).toBe('작업 스타일');

      // 10. 상세 조회에서 커스텀 필드 포함 확인
      const detailRes = await request.get(`/api/exhibitions/${exhId}`);
      expect(detailRes.body.customFields).toHaveLength(2);

      // 11. Show 등록 → PENDING
      const showRes = await request.post('/api/shows')
        .set('Authorization', galleryToken)
        .send({
          title: 'WR Show', description: 'WR 전시 테스트',
          startDate: new Date(Date.now() - 7 * 86400000).toISOString(),
          endDate: new Date(Date.now() + 30 * 86400000).toISOString(),
          openingHours: '10:00-18:00', admissionFee: '무료',
          location: '서울시 종로구', region: 'SEOUL',
          posterImage: 'https://example.com/poster.jpg',
          galleryId: galleryId2,
        });
      expect(showRes.status).toBe(201);
      expect(showRes.body.status).toBe('PENDING');
      const showId = showRes.body.id;

      // 12. PENDING Show는 공개 목록에 없음
      const showListBefore = await request.get('/api/shows');
      expect(showListBefore.body.find((s: any) => s.id === showId)).toBeUndefined();

      // 13. Admin이 Show 승인
      const approveShow = await request.patch(`/api/approvals/show/${showId}`)
        .set('Authorization', adminToken)
        .send({ status: 'APPROVED' });
      expect(approveShow.status).toBe(200);

      // 14. 승인 후 Show 목록에 노출
      const showListAfter = await request.get('/api/shows');
      const showFound = showListAfter.body.find((s: any) => s.id === showId);
      expect(showFound).toBeDefined();
      expect(showFound.title).toBe('WR Show');

      // 15. Hero Slide 등록 (Admin)
      const heroRes = await request.post('/api/hero-slides')
        .set('Authorization', adminToken)
        .send({
          title: 'WR Hero', description: 'WR 히어로 슬라이드',
          imageUrl: 'https://example.com/hero.jpg',
          linkUrl: 'https://example.com', order: 0,
        });
      expect(heroRes.status).toBe(201);

      // 16. Hero 목록에 슬라이드 포함 확인
      const heroList = await request.get('/api/hero-slides');
      const heroFound = heroList.body.find((h: any) => h.title === 'WR Hero');
      expect(heroFound).toBeDefined();
      expect(heroFound.linkUrl).toBe('https://example.com');
    });
  });

  // ============================================================
  // 시나리오 2: Artist 시점 전체 서비스 흐름
  // ============================================================
  describe('Artist 전체 서비스 흐름', () => {
    let galleryId: number;
    let exhId: number;
    let showId: number;

    beforeEach(async () => {
      // 데이터 정리 후 승인된 Gallery/Exhibition/Show 준비
      await testPrisma.application.deleteMany();
      await testPrisma.approvalRequest.deleteMany();
      await testPrisma.favorite.deleteMany();
      await testPrisma.review.deleteMany();
      await testPrisma.promoPhoto.deleteMany();
      await testPrisma.showImage.deleteMany();
      await testPrisma.show.deleteMany();
      await testPrisma.exhibition.deleteMany();
      await testPrisma.galleryImage.deleteMany();
      await testPrisma.gallery.deleteMany();
      await testPrisma.heroSlide.deleteMany();

      // 승인된 갤러리 생성
      const g = await testPrisma.gallery.create({
        data: {
          name: 'Artist Flow Gallery', address: '서울시 강남구', phone: '02-1111-2222',
          description: 'Artist 흐름 테스트', region: 'SEOUL', ownerName: 'Owner',
          status: 'APPROVED', ownerId: 3, rating: 0,
        },
      });
      galleryId = g.id;

      // 승인된 Exhibition (마감일 30일 후)
      const e = await testPrisma.exhibition.create({
        data: {
          title: 'Artist Flow Exhibition', type: 'SOLO',
          deadline: new Date(Date.now() + 30 * 86400000),
          exhibitDate: new Date(Date.now() + 60 * 86400000),
          capacity: 5, region: 'SEOUL', description: 'Artist 흐름 공모',
          status: 'APPROVED', galleryId: g.id,
          customFields: JSON.stringify([
            { id: 'q1', label: '자기소개', type: 'textarea', required: true },
          ]),
        },
      });
      exhId = e.id;

      // 승인된 Show (진행중)
      const s = await testPrisma.show.create({
        data: {
          title: 'Artist Flow Show', description: 'Artist 흐름 전시',
          startDate: new Date(Date.now() - 7 * 86400000),
          endDate: new Date(Date.now() + 30 * 86400000),
          openingHours: '10:00-18:00', admissionFee: '무료',
          location: '서울시 종로구', region: 'SEOUL',
          posterImage: 'https://example.com/poster.jpg',
          status: 'APPROVED', galleryId: g.id,
        },
      });
      showId = s.id;
    });

    it('Gallery 조회/필터 → 찜 → 리뷰 → Exhibition 찜/지원 → Show 찜 → 찜 목록 통합 확인', async () => {
      // 1. Gallery 목록 조회
      const listRes = await request.get('/api/galleries');
      expect(listRes.status).toBe(200);
      expect(listRes.body.length).toBeGreaterThanOrEqual(1);

      // 2. region 필터
      const filteredRes = await request.get('/api/galleries?region=SEOUL');
      expect(filteredRes.body.length).toBeGreaterThanOrEqual(1);

      const filteredBusan = await request.get('/api/galleries?region=BUSAN');
      expect(filteredBusan.body.find((g: any) => g.id === galleryId)).toBeUndefined();

      // 3. sortBy=rating 정렬
      const sortedRes = await request.get('/api/galleries?sortBy=rating');
      expect(sortedRes.status).toBe(200);

      // 4. Gallery 찜
      const favGallery = await request.post('/api/favorites/toggle')
        .set('Authorization', artistToken)
        .send({ galleryId });
      expect(favGallery.status).toBe(200);
      expect(favGallery.body.favorited).toBe(true);

      // 5. 찜 목록에 Gallery 포함 확인
      const favList1 = await request.get('/api/favorites')
        .set('Authorization', artistToken);
      expect(favList1.body.some((f: any) => f.galleryId === galleryId)).toBe(true);

      // 6. Gallery 리뷰 작성 (별점, 내용, anonymous)
      const reviewRes = await request.post('/api/reviews')
        .set('Authorization', artistToken)
        .send({ galleryId, rating: 4, content: '좋은 갤러리입니다.', anonymous: true });
      expect(reviewRes.status).toBe(201);
      expect(reviewRes.body.anonymous).toBe(true);

      // 7. 갤러리 rating 갱신 확인
      const galleryDetail = await request.get(`/api/galleries/${galleryId}`);
      expect(galleryDetail.body.rating).toBe(4);
      expect(galleryDetail.body.reviewCount).toBe(1);

      // 8. Exhibition 조회 (D-day 필터: deadline >= now 만 노출)
      const exhList = await request.get('/api/exhibitions');
      const exhFound = exhList.body.find((e: any) => e.id === exhId);
      expect(exhFound).toBeDefined();

      // 9. Exhibition 찜
      const favExh = await request.post('/api/favorites/toggle')
        .set('Authorization', artistToken)
        .send({ exhibitionId: exhId });
      expect(favExh.status).toBe(200);
      expect(favExh.body.favorited).toBe(true);

      // 10. Exhibition 지원 (customAnswers 포함)
      const applyRes = await request.post(`/api/exhibitions/${exhId}/apply`)
        .set('Authorization', artistToken)
        .send({
          customAnswers: [{ fieldId: 'q1', value: '저는 추상미술을 전공했습니다.' }],
        });
      expect(applyRes.status).toBe(201);

      // 11. 중복 지원 차단
      const dupRes = await request.post(`/api/exhibitions/${exhId}/apply`)
        .set('Authorization', artistToken)
        .send({
          customAnswers: [{ fieldId: 'q1', value: '재지원 시도' }],
        });
      expect(dupRes.status).toBe(400);

      // 12. Show 찜
      const favShow = await request.post('/api/favorites/toggle')
        .set('Authorization', artistToken)
        .send({ showId });
      expect(favShow.status).toBe(200);
      expect(favShow.body.favorited).toBe(true);

      // 13. 찜 목록에 Gallery + Exhibition + Show 모두 포함
      const favListAll = await request.get('/api/favorites')
        .set('Authorization', artistToken);
      expect(favListAll.body.some((f: any) => f.galleryId === galleryId)).toBe(true);
      expect(favListAll.body.some((f: any) => f.exhibitionId === exhId)).toBe(true);
      expect(favListAll.body.some((f: any) => f.showId === showId)).toBe(true);

      // 14. 내 리뷰 목록 확인
      const myReviews = await request.get('/api/reviews/my')
        .set('Authorization', artistToken);
      expect(myReviews.status).toBe(200);
      expect(myReviews.body.length).toBeGreaterThanOrEqual(1);
      expect(myReviews.body[0].content).toBe('좋은 갤러리입니다.');

      // 15. 내 지원 내역 확인
      const myApps = await request.get('/api/exhibitions/my-applications')
        .set('Authorization', artistToken);
      expect(myApps.status).toBe(200);
      expect(myApps.body.some((a: any) => a.exhibitionId === exhId)).toBe(true);
    });
  });

  // ============================================================
  // 시나리오 3: 권한 경계 테스트
  // ============================================================
  describe('권한 경계 테스트', () => {
    let galleryId: number;

    beforeEach(async () => {
      await testPrisma.application.deleteMany();
      await testPrisma.approvalRequest.deleteMany();
      await testPrisma.favorite.deleteMany();
      await testPrisma.review.deleteMany();
      await testPrisma.promoPhoto.deleteMany();
      await testPrisma.showImage.deleteMany();
      await testPrisma.show.deleteMany();
      await testPrisma.exhibition.deleteMany();
      await testPrisma.galleryImage.deleteMany();
      await testPrisma.gallery.deleteMany();
      await testPrisma.heroSlide.deleteMany();

      // 테스트용 승인 갤러리
      const g = await testPrisma.gallery.create({
        data: {
          name: 'Perm Gallery', address: '서울', phone: '02-0000-0000',
          description: '권한 테스트', region: 'SEOUL', ownerName: 'Owner',
          status: 'APPROVED', ownerId: 3,
        },
      });
      galleryId = g.id;
    });

    it('Artist가 Gallery 등록 시도 → 403', async () => {
      const res = await request.post('/api/galleries')
        .set('Authorization', artistToken)
        .send({
          name: 'Hack Gallery', address: '서울', phone: '010-0000-0000',
          description: 'test', region: 'SEOUL', ownerName: 'Hacker',
        });
      expect(res.status).toBe(403);
    });

    it('Artist가 Admin 승인 큐 접근 → 403', async () => {
      const res = await request.get('/api/approvals')
        .set('Authorization', artistToken);
      expect(res.status).toBe(403);
    });

    it('Gallery 유저가 리뷰 작성 → 403', async () => {
      const res = await request.post('/api/reviews')
        .set('Authorization', galleryToken)
        .send({ galleryId, rating: 5, content: 'Gallery trying review' });
      expect(res.status).toBe(403);
    });

    it('Gallery 유저가 다른 Gallery의 Exhibition 등록 → 403', async () => {
      // Gallery 유저 id=3이 아닌 다른 사람의 갤러리에 Exhibition 등록 시도
      // 먼저 admin이 직접 소유한 갤러리를 DB에 만들어서 ownerId=4로 설정
      const otherGallery = await testPrisma.gallery.create({
        data: {
          name: 'Other Gallery', address: '부산', phone: '051-0000-0000',
          description: 'other', region: 'BUSAN', ownerName: 'Other',
          status: 'APPROVED', ownerId: 4,
        },
      });

      const res = await request.post('/api/exhibitions')
        .set('Authorization', galleryToken)
        .send({
          galleryId: otherGallery.id, title: 'Hack Exhibition', type: 'SOLO',
          deadline: new Date(Date.now() + 30 * 86400000).toISOString(),
          exhibitDate: new Date(Date.now() + 60 * 86400000).toISOString(),
          capacity: 3, region: 'BUSAN', description: 'Unauthorized',
        });
      expect(res.status).toBe(403);
    });

    it('비로그인 사용자가 찜 시도 → 401', async () => {
      const res = await request.post('/api/favorites/toggle')
        .send({ galleryId });
      expect(res.status).toBe(401);
    });

    it('비로그인 사용자가 리뷰 작성 시도 → 401', async () => {
      const res = await request.post('/api/reviews')
        .send({ galleryId, rating: 5, content: 'no auth' });
      expect(res.status).toBe(401);
    });

    it('비로그인 사용자가 지원 시도 → 401', async () => {
      const exh = await testPrisma.exhibition.create({
        data: {
          title: 'Perm Exh', type: 'SOLO',
          deadline: new Date(Date.now() + 30 * 86400000),
          exhibitDate: new Date(Date.now() + 60 * 86400000),
          capacity: 5, region: 'SEOUL', description: 'test',
          status: 'APPROVED', galleryId,
        },
      });
      const res = await request.post(`/api/exhibitions/${exh.id}/apply`);
      expect(res.status).toBe(401);
    });

    it('Gallery 유저가 Hero Slide 생성 → 403', async () => {
      const res = await request.post('/api/hero-slides')
        .set('Authorization', galleryToken)
        .send({
          title: 'Hack Hero', description: 'test',
          imageUrl: 'https://example.com/hack.jpg', order: 0,
        });
      expect(res.status).toBe(403);
    });

    it('Artist가 Show 등록 → 403', async () => {
      const res = await request.post('/api/shows')
        .set('Authorization', artistToken)
        .send({
          title: 'Artist Show', description: 'test',
          startDate: new Date().toISOString(),
          endDate: new Date(Date.now() + 30 * 86400000).toISOString(),
          openingHours: '10-18', admissionFee: '무료',
          location: '서울', region: 'SEOUL',
          posterImage: 'https://example.com/poster.jpg',
          galleryId,
        });
      expect(res.status).toBe(403);
    });
  });

  // ============================================================
  // 시나리오 4: 수정 요청 워크플로우
  // ============================================================
  describe('수정 요청 워크플로우', () => {
    let galleryId: number;

    beforeEach(async () => {
      await testPrisma.application.deleteMany();
      await testPrisma.approvalRequest.deleteMany();
      await testPrisma.favorite.deleteMany();
      await testPrisma.review.deleteMany();
      await testPrisma.promoPhoto.deleteMany();
      await testPrisma.showImage.deleteMany();
      await testPrisma.show.deleteMany();
      await testPrisma.exhibition.deleteMany();
      await testPrisma.galleryImage.deleteMany();
      await testPrisma.gallery.deleteMany();

      // 승인된 갤러리 준비
      const g = await testPrisma.gallery.create({
        data: {
          name: 'Edit Request Gallery', address: '서울시 종로구', phone: '02-5555-6666',
          description: '원본 소개', region: 'SEOUL', ownerName: 'ER Owner',
          status: 'APPROVED', ownerId: 3,
        },
      });
      galleryId = g.id;
    });

    it('수정 요청 제출 → 거절(사유) → 원본 유지 → 재요청 → 승인 → 변경 적용', async () => {
      // 1. Gallery 유저가 수정 요청 제출 (description 변경)
      const editReq1 = await request.post('/api/approvals/edit-request')
        .set('Authorization', galleryToken)
        .send({
          type: 'GALLERY_EDIT',
          targetId: galleryId,
          changes: { description: '수정된 소개 1차' },
        });
      expect(editReq1.status).toBe(201);
      expect(editReq1.body.status).toBe('PENDING');
      const reqId1 = editReq1.body.id;

      // 2. Admin이 거절 (사유 포함)
      const rejectRes = await request.patch(`/api/approvals/edit-request/${reqId1}`)
        .set('Authorization', adminToken)
        .send({ status: 'REJECTED', rejectReason: '소개 내용이 부적절합니다.' });
      expect(rejectRes.status).toBe(200);
      expect(rejectRes.body.status).toBe('REJECTED');
      expect(rejectRes.body.rejectReason).toBe('소개 내용이 부적절합니다.');

      // 3. 원본 데이터가 유지되었는지 확인
      const galleryAfterReject = await request.get(`/api/galleries/${galleryId}`);
      expect(galleryAfterReject.body.description).toBe('원본 소개');

      // 4. Gallery 유저가 다시 수정 요청
      const editReq2 = await request.post('/api/approvals/edit-request')
        .set('Authorization', galleryToken)
        .send({
          type: 'GALLERY_EDIT',
          targetId: galleryId,
          changes: { description: '수정된 소개 2차 - 적절한 내용' },
        });
      expect(editReq2.status).toBe(201);
      const reqId2 = editReq2.body.id;

      // 5. Admin이 승인
      const approveRes = await request.patch(`/api/approvals/edit-request/${reqId2}`)
        .set('Authorization', adminToken)
        .send({ status: 'APPROVED' });
      expect(approveRes.status).toBe(200);
      expect(approveRes.body.status).toBe('APPROVED');

      // 6. 변경사항이 실제 적용되었는지 확인
      const galleryAfterApprove = await request.get(`/api/galleries/${galleryId}`);
      expect(galleryAfterApprove.body.description).toBe('수정된 소개 2차 - 적절한 내용');

      // 7. DB에서도 직접 확인
      const dbGallery = await testPrisma.gallery.findUnique({ where: { id: galleryId } });
      expect(dbGallery?.description).toBe('수정된 소개 2차 - 적절한 내용');
    });
  });
});
