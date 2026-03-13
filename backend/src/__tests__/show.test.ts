import { describe, it, expect, beforeEach } from 'vitest';
import { request, testPrisma, authToken, cleanDb, seedUsers, seedGallery, seedShow } from './helpers';

describe('Show API', () => {
  beforeEach(async () => {
    await cleanDb();
    await seedUsers();
  });

  // ===== GET /shows =====
  describe('GET /shows', () => {
    it('승인된 전시만 반환', async () => {
      const gallery = await seedGallery();
      await seedShow(gallery.id);
      // PENDING 전시는 목록에 미노출
      await testPrisma.show.create({
        data: {
          title: 'Pending Show', description: 'pending', startDate: new Date(),
          endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          openingHours: '10:00-18:00', admissionFee: '무료', location: '서울',
          region: 'SEOUL', posterImage: 'https://example.com/p.jpg',
          status: 'PENDING', galleryId: gallery.id,
        },
      });

      const res = await request.get('/api/shows');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].title).toBe('Test Show');
    });

    it('지역 필터 동작', async () => {
      const gallery = await seedGallery();
      await seedShow(gallery.id);

      const res = await request.get('/api/shows?region=BUSAN');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(0);
    });

    it('로그인 시 isFavorited 반환', async () => {
      const gallery = await seedGallery();
      const show = await seedShow(gallery.id);
      await testPrisma.favorite.create({ data: { userId: 1, showId: show.id } });

      const res = await request.get('/api/shows').set('Authorization', `Bearer ${authToken(1, 'ARTIST')}`);
      expect(res.body[0].isFavorited).toBe(true);
    });
  });

  // ===== GET /shows/:id =====
  describe('GET /shows/:id', () => {
    it('전시 상세 조회 성공', async () => {
      const gallery = await seedGallery();
      const show = await seedShow(gallery.id);

      const res = await request.get(`/api/shows/${show.id}`);
      expect(res.status).toBe(200);
      expect(res.body.title).toBe('Test Show');
      expect(res.body.gallery.ownerId).toBe(3);
      expect(res.body.artists).toEqual(['작가1', '작가2']);
    });

    it('존재하지 않는 전시 404', async () => {
      const res = await request.get('/api/shows/999');
      expect(res.status).toBe(404);
    });
  });

  // ===== POST /shows =====
  describe('POST /shows', () => {
    it('Gallery 유저가 전시 등록', async () => {
      const gallery = await seedGallery();
      const token = authToken(3, 'GALLERY');

      const res = await request.post('/api/shows').set('Authorization', `Bearer ${token}`).send({
        title: '새 전시', description: '전시 소개',
        startDate: '2026-05-01', endDate: '2026-06-01',
        openingHours: '10:00-18:00', admissionFee: '무료',
        location: '서울시', region: 'SEOUL',
        posterImage: 'https://example.com/poster.jpg',
        galleryId: gallery.id,
      });
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('PENDING');
    });

    it('다른 유저의 갤러리에 등록 시 403', async () => {
      const gallery = await seedGallery();
      // artist1(id=1)이 gallery owner(id=3)의 갤러리에 등록 시도
      const token = authToken(1, 'GALLERY');

      const res = await request.post('/api/shows').set('Authorization', `Bearer ${token}`).send({
        title: '새 전시', description: '전시 소개',
        startDate: '2026-05-01', endDate: '2026-06-01',
        openingHours: '10:00-18:00', admissionFee: '무료',
        location: '서울시', region: 'SEOUL',
        posterImage: 'https://example.com/poster.jpg',
        galleryId: gallery.id,
      });
      expect(res.status).toBe(403);
    });

    it('시작일이 종료일 이후면 400', async () => {
      const gallery = await seedGallery();
      const token = authToken(3, 'GALLERY');

      const res = await request.post('/api/shows').set('Authorization', `Bearer ${token}`).send({
        title: '새 전시', description: '전시 소개',
        startDate: '2026-06-01', endDate: '2026-05-01',
        openingHours: '10:00-18:00', admissionFee: '무료',
        location: '서울시', region: 'SEOUL',
        posterImage: 'https://example.com/poster.jpg',
        galleryId: gallery.id,
      });
      expect(res.status).toBe(400);
    });
  });

  // ===== PATCH /shows/:id =====
  describe('PATCH /shows/:id', () => {
    it('소유자가 소개 수정', async () => {
      const gallery = await seedGallery();
      const show = await seedShow(gallery.id);
      const token = authToken(3, 'GALLERY');

      const res = await request.patch(`/api/shows/${show.id}`).set('Authorization', `Bearer ${token}`)
        .send({ description: '수정된 소개' });
      expect(res.status).toBe(200);
      expect(res.body.description).toBe('수정된 소개');
    });

    it('비소유자는 수정 불가 403', async () => {
      const gallery = await seedGallery();
      const show = await seedShow(gallery.id);
      const token = authToken(1, 'ARTIST');

      const res = await request.patch(`/api/shows/${show.id}`).set('Authorization', `Bearer ${token}`)
        .send({ description: '수정 시도' });
      expect(res.status).toBe(403);
    });
  });

  // ===== DELETE /shows/:id =====
  describe('DELETE /shows/:id', () => {
    it('소유자가 삭제', async () => {
      const gallery = await seedGallery();
      const show = await seedShow(gallery.id);
      const token = authToken(3, 'GALLERY');

      const res = await request.delete(`/api/shows/${show.id}`).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
    });

    it('Admin이 삭제', async () => {
      const gallery = await seedGallery();
      const show = await seedShow(gallery.id);
      const token = authToken(4, 'ADMIN');

      const res = await request.delete(`/api/shows/${show.id}`).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
    });

    it('비관련 유저는 삭제 불가', async () => {
      const gallery = await seedGallery();
      const show = await seedShow(gallery.id);
      const token = authToken(1, 'ARTIST');

      const res = await request.delete(`/api/shows/${show.id}`).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    });
  });

  // ===== 찜 토글 =====
  describe('POST /favorites/toggle (show)', () => {
    it('전시 찜 토글', async () => {
      const gallery = await seedGallery();
      const show = await seedShow(gallery.id);
      const token = authToken(1, 'ARTIST');

      // 찜 추가
      const res1 = await request.post('/api/favorites/toggle').set('Authorization', `Bearer ${token}`)
        .send({ showId: show.id });
      expect(res1.body.favorited).toBe(true);

      // 찜 해제
      const res2 = await request.post('/api/favorites/toggle').set('Authorization', `Bearer ${token}`)
        .send({ showId: show.id });
      expect(res2.body.favorited).toBe(false);
    });
  });

  // ===== Admin 승인 =====
  describe('PATCH /approvals/show/:id', () => {
    it('Admin이 전시 승인', async () => {
      const gallery = await seedGallery();
      const show = await testPrisma.show.create({
        data: {
          title: 'Pending', description: '대기중', startDate: new Date(),
          endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          openingHours: '10:00-18:00', admissionFee: '무료', location: '서울',
          region: 'SEOUL', posterImage: 'https://example.com/p.jpg',
          status: 'PENDING', galleryId: gallery.id,
        },
      });
      const token = authToken(4, 'ADMIN');

      const res = await request.patch(`/api/approvals/show/${show.id}`).set('Authorization', `Bearer ${token}`)
        .send({ status: 'APPROVED' });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('APPROVED');
    });

    it('거절 시 사유 필수', async () => {
      const gallery = await seedGallery();
      const show = await testPrisma.show.create({
        data: {
          title: 'Pending', description: '대기중', startDate: new Date(),
          endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          openingHours: '10:00-18:00', admissionFee: '무료', location: '서울',
          region: 'SEOUL', posterImage: 'https://example.com/p.jpg',
          status: 'PENDING', galleryId: gallery.id,
        },
      });
      const token = authToken(4, 'ADMIN');

      const res = await request.patch(`/api/approvals/show/${show.id}`).set('Authorization', `Bearer ${token}`)
        .send({ status: 'REJECTED' });
      expect(res.status).toBe(400);
    });
  });

  // ===== 이미지 관리 =====
  describe('Show Images', () => {
    it('이미지 추가 및 삭제', async () => {
      const gallery = await seedGallery();
      const show = await seedShow(gallery.id);
      const token = authToken(3, 'GALLERY');

      // 추가
      const addRes = await request.post(`/api/shows/${show.id}/images`).set('Authorization', `Bearer ${token}`)
        .send({ url: 'https://example.com/img1.jpg', order: 0 });
      expect(addRes.status).toBe(201);

      // 삭제
      const delRes = await request.delete(`/api/shows/${show.id}/images/${addRes.body.id}`).set('Authorization', `Bearer ${token}`);
      expect(delRes.status).toBe(200);
    });
  });
});
