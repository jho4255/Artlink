/**
 * operations-extended.test.ts
 * 누락된 테스트 보완: HeroSlide CRUD, Benefit CRUD, Approval 통합 큐,
 * Show 엣지케이스 (찜 cascade 삭제, 이미지 순서, 복합 필터)
 *
 * 구조: 단일 top-level describe, cleanDb+seedUsers는 1회만 호출
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { request, testPrisma, authToken, cleanDb, seedUsers, seedGallery, seedShow } from './helpers';

describe('Operations Extended', () => {
  // 전체 테스트 시작 전 1회만 DB 정리 + 유저 시드
  beforeAll(async () => {
    await cleanDb();
    await seedUsers();
  });

  // ===== HeroSlide CRUD =====
  describe('HeroSlide API', () => {
    beforeEach(async () => {
      await testPrisma.heroSlide.deleteMany();
    });

    it('Admin이 슬라이드 생성 (외부 URL)', async () => {
      const token = authToken(4, 'ADMIN');
      const res = await request.post('/api/hero-slides').set('Authorization', `Bearer ${token}`)
        .send({ title: 'External Slide', imageUrl: 'https://example.com/ext.jpg', linkUrl: 'https://external.com', order: 10 });
      expect(res.status).toBe(201);
      expect(res.body.title).toBe('External Slide');
      expect(res.body.linkUrl).toBe('https://external.com');
    });

    it('Admin이 내부 URL 슬라이드 생성', async () => {
      const token = authToken(4, 'ADMIN');
      const res = await request.post('/api/hero-slides').set('Authorization', `Bearer ${token}`)
        .send({ title: 'Internal Slide', imageUrl: 'https://example.com/int.jpg', linkUrl: '/galleries', order: 20 });
      expect(res.status).toBe(201);
      expect(res.body.linkUrl).toBe('/galleries');
    });

    it('공개 목록 조회 — 비로그인도 가능하며 order 순 정렬', async () => {
      const token = authToken(4, 'ADMIN');
      // 선행 데이터 생성
      await request.post('/api/hero-slides').set('Authorization', `Bearer ${token}`)
        .send({ title: 'Slide A', imageUrl: 'https://example.com/a.jpg', order: 10 });
      await request.post('/api/hero-slides').set('Authorization', `Bearer ${token}`)
        .send({ title: 'Slide B', imageUrl: 'https://example.com/b.jpg', order: 20 });

      const res = await request.get('/api/hero-slides');
      expect(res.status).toBe(200);
      expect(res.body.length).toBeGreaterThanOrEqual(2);
      // order 오름차순 정렬 확인
      const orders = res.body.map((s: any) => s.order);
      for (let i = 1; i < orders.length; i++) {
        expect(orders[i]).toBeGreaterThanOrEqual(orders[i - 1]);
      }
    });

    it('비Admin은 슬라이드 생성 불가 403', async () => {
      const token = authToken(1, 'ARTIST');
      const res = await request.post('/api/hero-slides').set('Authorization', `Bearer ${token}`)
        .send({ title: 'Fail', imageUrl: 'https://example.com/f.jpg' });
      expect(res.status).toBe(403);
    });

    it('비로그인은 슬라이드 생성 불가 401', async () => {
      const res = await request.post('/api/hero-slides')
        .send({ title: 'Fail', imageUrl: 'https://example.com/f.jpg' });
      expect(res.status).toBe(401);
    });

    it('Admin이 슬라이드 수정', async () => {
      const token = authToken(4, 'ADMIN');
      const createRes = await request.post('/api/hero-slides').set('Authorization', `Bearer ${token}`)
        .send({ title: 'ToUpdate', imageUrl: 'https://example.com/u.jpg', order: 30 });
      const res = await request.patch(`/api/hero-slides/${createRes.body.id}`).set('Authorization', `Bearer ${token}`)
        .send({ title: 'Updated Title', linkUrl: '/internal' });
      expect(res.status).toBe(200);
      expect(res.body.title).toBe('Updated Title');
      expect(res.body.linkUrl).toBe('/internal');
    });

    it('Gallery 유저는 슬라이드 수정 불가 403', async () => {
      const adminToken = authToken(4, 'ADMIN');
      const createRes = await request.post('/api/hero-slides').set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'NoEdit', imageUrl: 'https://example.com/ne.jpg', order: 40 });
      const galleryToken = authToken(3, 'GALLERY');
      const res = await request.patch(`/api/hero-slides/${createRes.body.id}`).set('Authorization', `Bearer ${galleryToken}`)
        .send({ title: 'Hack' });
      expect(res.status).toBe(403);
    });

    it('Admin이 슬라이드 삭제', async () => {
      const token = authToken(4, 'ADMIN');
      const createRes = await request.post('/api/hero-slides').set('Authorization', `Bearer ${token}`)
        .send({ title: 'ToDelete', imageUrl: 'https://example.com/del.jpg', order: 50 });
      const res = await request.delete(`/api/hero-slides/${createRes.body.id}`).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
    });

    it('Artist는 슬라이드 삭제 불가 403', async () => {
      const adminToken = authToken(4, 'ADMIN');
      const createRes = await request.post('/api/hero-slides').set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'NoDel', imageUrl: 'https://example.com/nd.jpg', order: 60 });
      const artistToken = authToken(1, 'ARTIST');
      const res = await request.delete(`/api/hero-slides/${createRes.body.id}`).set('Authorization', `Bearer ${artistToken}`);
      expect(res.status).toBe(403);
    });
  });

  // ===== Benefit CRUD =====
  describe('Benefit API', () => {
    beforeEach(async () => {
      await testPrisma.benefit.deleteMany();
    });

    it('Admin이 혜택 생성', async () => {
      const token = authToken(4, 'ADMIN');
      const res = await request.post('/api/benefits').set('Authorization', `Bearer ${token}`)
        .send({ title: '새 혜택', description: '혜택 상세', imageUrl: 'https://example.com/b.jpg', linkUrl: 'https://link.com' });
      expect(res.status).toBe(201);
      expect(res.body.title).toBe('새 혜택');
      expect(res.body.linkUrl).toBe('https://link.com');
    });

    it('공개 목록 조회 — 비로그인도 가능', async () => {
      // 선행 데이터
      const token = authToken(4, 'ADMIN');
      await request.post('/api/benefits').set('Authorization', `Bearer ${token}`)
        .send({ title: '혜택1', description: '설명' });

      const res = await request.get('/api/benefits');
      expect(res.status).toBe(200);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
    });

    it('비Admin은 혜택 생성 불가 403', async () => {
      const token = authToken(3, 'GALLERY');
      const res = await request.post('/api/benefits').set('Authorization', `Bearer ${token}`)
        .send({ title: 'Fail', description: 'no' });
      expect(res.status).toBe(403);
    });

    it('비로그인은 혜택 생성 불가 401', async () => {
      const res = await request.post('/api/benefits')
        .send({ title: 'Fail', description: 'no' });
      expect(res.status).toBe(401);
    });

    it('Admin이 혜택 수정', async () => {
      const token = authToken(4, 'ADMIN');
      const createRes = await request.post('/api/benefits').set('Authorization', `Bearer ${token}`)
        .send({ title: 'OldBenefit', description: '구 설명' });
      const res = await request.patch(`/api/benefits/${createRes.body.id}`).set('Authorization', `Bearer ${token}`)
        .send({ title: 'Updated Benefit', description: '신 설명' });
      expect(res.status).toBe(200);
      expect(res.body.title).toBe('Updated Benefit');
    });

    it('Admin이 혜택 삭제', async () => {
      const token = authToken(4, 'ADMIN');
      const createRes = await request.post('/api/benefits').set('Authorization', `Bearer ${token}`)
        .send({ title: 'ToDelBenefit', description: '삭제용' });
      const res = await request.delete(`/api/benefits/${createRes.body.id}`).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
    });

    it('Artist는 혜택 삭제 불가 403', async () => {
      const token = authToken(4, 'ADMIN');
      const createRes = await request.post('/api/benefits').set('Authorization', `Bearer ${token}`)
        .send({ title: 'NoDelBenefit', description: '삭제 불가' });
      const artistToken = authToken(2, 'ARTIST');
      const res = await request.delete(`/api/benefits/${createRes.body.id}`).set('Authorization', `Bearer ${artistToken}`);
      expect(res.status).toBe(403);
    });
  });

  // ===== Approval 통합 큐 =====
  describe('Approval API', () => {
    beforeEach(async () => {
      // 승인 관련 데이터만 정리 (유저 유지)
      await testPrisma.application.deleteMany();
      await testPrisma.approvalRequest.deleteMany();
      await testPrisma.favorite.deleteMany();
      await testPrisma.review.deleteMany();
      await testPrisma.galleryOfMonth.deleteMany();
      await testPrisma.showImage.deleteMany();
      await testPrisma.show.deleteMany();
      await testPrisma.promoPhoto.deleteMany();
      await testPrisma.exhibition.deleteMany();
      await testPrisma.galleryImage.deleteMany();
      await testPrisma.gallery.deleteMany();
    });

    it('갤러리+공모+전시 pending이 모두 포함된 통합 큐', async () => {
      // PENDING 갤러리
      await testPrisma.gallery.create({
        data: {
          name: 'Pending Gallery', address: '주소', phone: '010', description: '소개',
          region: 'SEOUL', ownerName: 'Owner', status: 'PENDING', ownerId: 3,
        },
      });
      // APPROVED 갤러리 for PENDING 공모/전시
      const gallery = await seedGallery();
      await testPrisma.exhibition.create({
        data: {
          title: 'Pending Exh', type: 'SOLO',
          deadline: new Date(Date.now() + 30 * 86400000),
          exhibitDate: new Date(Date.now() + 60 * 86400000),
          capacity: 3, region: 'SEOUL', description: '대기', status: 'PENDING',
          galleryId: gallery.id,
        },
      });
      await testPrisma.show.create({
        data: {
          title: 'Pending Show', description: '대기', startDate: new Date(),
          endDate: new Date(Date.now() + 30 * 86400000),
          openingHours: '10-18', admissionFee: '무료', location: '서울',
          region: 'SEOUL', posterImage: 'https://example.com/p.jpg',
          status: 'PENDING', galleryId: gallery.id,
        },
      });

      const token = authToken(4, 'ADMIN');
      const res = await request.get('/api/approvals').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.pendingGalleries).toHaveLength(1);
      expect(res.body.pendingExhibitions).toHaveLength(1);
      expect(res.body.pendingShows).toHaveLength(1);
      expect(res.body.pendingRequests).toHaveLength(0);
    });

    it('비Admin은 승인 큐 접근 불가 403', async () => {
      const token = authToken(1, 'ARTIST');
      const res = await request.get('/api/approvals').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    });
  });

  // ===== Gallery 승인/거절 =====
  describe('Gallery Approval', () => {
    beforeEach(async () => {
      await testPrisma.application.deleteMany();
      await testPrisma.approvalRequest.deleteMany();
      await testPrisma.favorite.deleteMany();
      await testPrisma.review.deleteMany();
      await testPrisma.galleryOfMonth.deleteMany();
      await testPrisma.showImage.deleteMany();
      await testPrisma.show.deleteMany();
      await testPrisma.promoPhoto.deleteMany();
      await testPrisma.exhibition.deleteMany();
      await testPrisma.galleryImage.deleteMany();
      await testPrisma.gallery.deleteMany();
    });

    it('Admin이 갤러리 승인', async () => {
      const gallery = await testPrisma.gallery.create({
        data: {
          name: 'ToApprove', address: '주소', phone: '010', description: '소개',
          region: 'SEOUL', ownerName: 'Owner', status: 'PENDING', ownerId: 3,
        },
      });
      const token = authToken(4, 'ADMIN');
      const res = await request.patch(`/api/approvals/gallery/${gallery.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'APPROVED' });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('APPROVED');
    });

    it('갤러리 거절 시 사유 없으면 400', async () => {
      const gallery = await testPrisma.gallery.create({
        data: {
          name: 'ToRejectNoReason', address: '주소', phone: '010', description: '소개',
          region: 'SEOUL', ownerName: 'Owner', status: 'PENDING', ownerId: 3,
        },
      });
      const token = authToken(4, 'ADMIN');
      const res = await request.patch(`/api/approvals/gallery/${gallery.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'REJECTED' });
      expect(res.status).toBe(400);
    });

    it('갤러리 거절 시 사유 포함하면 성공', async () => {
      const gallery = await testPrisma.gallery.create({
        data: {
          name: 'ToRejectWithReason', address: '주소', phone: '010', description: '소개',
          region: 'SEOUL', ownerName: 'Owner', status: 'PENDING', ownerId: 3,
        },
      });
      const token = authToken(4, 'ADMIN');
      const res = await request.patch(`/api/approvals/gallery/${gallery.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'REJECTED', rejectReason: '정보 부족' });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('REJECTED');
      expect(res.body.rejectReason).toBe('정보 부족');
    });
  });

  // ===== Exhibition/Show 승인 =====
  describe('Exhibition/Show Approval', () => {
    beforeEach(async () => {
      await testPrisma.application.deleteMany();
      await testPrisma.approvalRequest.deleteMany();
      await testPrisma.favorite.deleteMany();
      await testPrisma.review.deleteMany();
      await testPrisma.galleryOfMonth.deleteMany();
      await testPrisma.showImage.deleteMany();
      await testPrisma.show.deleteMany();
      await testPrisma.promoPhoto.deleteMany();
      await testPrisma.exhibition.deleteMany();
      await testPrisma.galleryImage.deleteMany();
      await testPrisma.gallery.deleteMany();
    });

    it('Admin이 공모 승인', async () => {
      const gallery = await seedGallery();
      const exhibition = await testPrisma.exhibition.create({
        data: {
          title: 'ToApproveExh', type: 'SOLO',
          deadline: new Date(Date.now() + 30 * 86400000),
          exhibitDate: new Date(Date.now() + 60 * 86400000),
          capacity: 3, region: 'SEOUL', description: '대기', status: 'PENDING',
          galleryId: gallery.id,
        },
      });
      const token = authToken(4, 'ADMIN');
      const res = await request.patch(`/api/approvals/exhibition/${exhibition.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'APPROVED' });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('APPROVED');
    });

    it('공모 거절 시 사유 없으면 400', async () => {
      const gallery = await seedGallery();
      const exhibition = await testPrisma.exhibition.create({
        data: {
          title: 'ToRejectExh', type: 'SOLO',
          deadline: new Date(Date.now() + 30 * 86400000),
          exhibitDate: new Date(Date.now() + 60 * 86400000),
          capacity: 3, region: 'SEOUL', description: '대기', status: 'PENDING',
          galleryId: gallery.id,
        },
      });
      const token = authToken(4, 'ADMIN');
      const res = await request.patch(`/api/approvals/exhibition/${exhibition.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'REJECTED' });
      expect(res.status).toBe(400);
    });

    it('Show 거절 시 rejectReason 포함하면 성공', async () => {
      const gallery = await seedGallery();
      const show = await testPrisma.show.create({
        data: {
          title: 'ToRejectShow', description: '거절 대상', startDate: new Date(),
          endDate: new Date(Date.now() + 30 * 86400000),
          openingHours: '10-18', admissionFee: '무료', location: '서울',
          region: 'SEOUL', posterImage: 'https://example.com/p.jpg',
          status: 'PENDING', galleryId: gallery.id,
        },
      });
      const token = authToken(4, 'ADMIN');
      const res = await request.patch(`/api/approvals/show/${show.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'REJECTED', rejectReason: '부적절한 내용' });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('REJECTED');
      expect(res.body.rejectReason).toBe('부적절한 내용');
    });
  });

  // ===== Edit Request 흐름 =====
  describe('Edit Request flow', () => {
    beforeEach(async () => {
      await testPrisma.application.deleteMany();
      await testPrisma.approvalRequest.deleteMany();
      await testPrisma.favorite.deleteMany();
      await testPrisma.review.deleteMany();
      await testPrisma.galleryOfMonth.deleteMany();
      await testPrisma.showImage.deleteMany();
      await testPrisma.show.deleteMany();
      await testPrisma.promoPhoto.deleteMany();
      await testPrisma.exhibition.deleteMany();
      await testPrisma.galleryImage.deleteMany();
      await testPrisma.gallery.deleteMany();
    });

    it('Gallery 유저가 수정 요청 제출 → Admin 승인 → 변경 적용', async () => {
      const gallery = await seedGallery();
      const galleryToken = authToken(3, 'GALLERY');
      const adminToken = authToken(4, 'ADMIN');

      const createRes = await request.post('/api/approvals/edit-request')
        .set('Authorization', `Bearer ${galleryToken}`)
        .send({ type: 'GALLERY_EDIT', targetId: gallery.id, changes: { description: '수정된 소개' } });
      expect(createRes.status).toBe(201);
      expect(createRes.body.status).toBe('PENDING');

      const approveRes = await request.patch(`/api/approvals/edit-request/${createRes.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'APPROVED' });
      expect(approveRes.status).toBe(200);

      const updated = await testPrisma.gallery.findUnique({ where: { id: gallery.id } });
      expect(updated!.description).toBe('수정된 소개');
    });

    it('수정 요청 거절 시 사유 필수', async () => {
      const gallery = await seedGallery();
      const galleryToken = authToken(3, 'GALLERY');
      const adminToken = authToken(4, 'ADMIN');

      const createRes = await request.post('/api/approvals/edit-request')
        .set('Authorization', `Bearer ${galleryToken}`)
        .send({ type: 'GALLERY_EDIT', targetId: gallery.id, changes: { description: '변경' } });

      const res = await request.patch(`/api/approvals/edit-request/${createRes.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'REJECTED' });
      expect(res.status).toBe(400);
    });

    it('Artist는 수정 요청 제출 불가 403', async () => {
      const token = authToken(1, 'ARTIST');
      const res = await request.post('/api/approvals/edit-request')
        .set('Authorization', `Bearer ${token}`)
        .send({ type: 'GALLERY_EDIT', targetId: 1, changes: { description: 'hack' } });
      expect(res.status).toBe(403);
    });
  });

  // ===== Show 엣지케이스 — 각 테스트가 독립적으로 데이터 생성 =====
  describe('Show edge cases', () => {
    beforeEach(async () => {
      // Show 관련 데이터만 정리 (유저 유지)
      await testPrisma.favorite.deleteMany();
      await testPrisma.showImage.deleteMany();
      await testPrisma.show.deleteMany();
      await testPrisma.promoPhoto.deleteMany();
      await testPrisma.exhibition.deleteMany();
      await testPrisma.galleryImage.deleteMany();
      await testPrisma.gallery.deleteMany();
    });

    it('전시 삭제 시 관련 찜도 cascade 삭제', async () => {
      const gallery = await seedGallery();
      const show = await seedShow(gallery.id);
      await testPrisma.favorite.create({ data: { userId: 1, showId: show.id } });
      await testPrisma.favorite.create({ data: { userId: 2, showId: show.id } });

      const token = authToken(3, 'GALLERY');
      const delRes = await request.delete(`/api/shows/${show.id}`).set('Authorization', `Bearer ${token}`);
      expect(delRes.status).toBe(200);

      const favs = await testPrisma.favorite.findMany({ where: { showId: show.id } });
      expect(favs).toHaveLength(0);
    });

    it('이미지 추가 시 order 값 유지 및 정렬', async () => {
      const gallery = await seedGallery();
      const show = await seedShow(gallery.id);
      const token = authToken(3, 'GALLERY');

      const r1 = await request.post(`/api/shows/${show.id}/images`).set('Authorization', `Bearer ${token}`)
        .send({ url: 'https://example.com/img1.jpg', order: 2 });
      expect(r1.status).toBe(201);
      const r2 = await request.post(`/api/shows/${show.id}/images`).set('Authorization', `Bearer ${token}`)
        .send({ url: 'https://example.com/img2.jpg', order: 1 });
      expect(r2.status).toBe(201);

      const res = await request.get(`/api/shows/${show.id}`);
      expect(res.body.images).toHaveLength(2);
      expect(res.body.images[0].order).toBe(1);
      expect(res.body.images[1].order).toBe(2);
    });

    it('region + showStatus 복합 필터', async () => {
      const gallery = await seedGallery();
      await seedShow(gallery.id); // 진행중 SEOUL
      await testPrisma.show.create({
        data: {
          title: 'Busan Show', description: '부산',
          startDate: new Date(Date.now() - 5 * 86400000),
          endDate: new Date(Date.now() + 30 * 86400000),
          openingHours: '10-18', admissionFee: '무료', location: '부산',
          region: 'BUSAN', posterImage: 'https://example.com/p.jpg',
          status: 'APPROVED', galleryId: gallery.id,
        },
      });

      const res = await request.get('/api/shows?region=BUSAN&showStatus=ongoing');
      expect(res.body).toHaveLength(1);
      expect(res.body[0].title).toBe('Busan Show');
    });

    it('비소유 Gallery 유저가 이미지 추가 시 403', async () => {
      const gallery = await seedGallery();
      const show = await seedShow(gallery.id);

      const otherUser = await testPrisma.user.create({
        data: { email: 'gallery-other@test.com', name: 'G2', role: 'GALLERY' },
      });
      const token = authToken(otherUser.id, 'GALLERY');
      const res = await request.post(`/api/shows/${show.id}/images`).set('Authorization', `Bearer ${token}`)
        .send({ url: 'https://example.com/hack.jpg', order: 0 });
      expect(res.status).toBe(403);
    });
  });
});
