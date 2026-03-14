/**
 * Show 추가 테스트 — my-shows, status 필터, PATCH 엣지케이스
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { request, testPrisma, authToken, cleanDb, seedUsers, seedGallery, seedShow } from './helpers';

describe('Show API (Extended)', () => {
  beforeEach(async () => {
    await cleanDb();
    await seedUsers();
  });

  // ===== GET /shows/my-shows =====
  describe('GET /shows/my-shows', () => {
    it('Gallery 유저의 전시 목록 반환 (전 상태)', async () => {
      const gallery = await seedGallery();
      await seedShow(gallery.id); // APPROVED
      await testPrisma.show.create({
        data: {
          title: 'Pending Show', description: 'pending', startDate: new Date(),
          endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          openingHours: '10:00-18:00', admissionFee: '무료', location: '서울',
          region: 'SEOUL', posterImage: 'https://example.com/p.jpg',
          status: 'PENDING', galleryId: gallery.id,
        },
      });
      const token = authToken(3, 'GALLERY');
      const res = await request.get('/api/shows/my-shows').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2); // APPROVED + PENDING 모두
    });

    it('다른 Gallery 유저의 전시는 미포함', async () => {
      const gallery = await seedGallery(); // ownerId=3
      await seedShow(gallery.id);
      // 별도의 Gallery 유저 생성 (소유 갤러리 없음)
      await testPrisma.user.create({
        data: { id: 100, email: 'gallery2@test.com', name: 'Gallery 2', role: 'GALLERY' },
      });
      const token = authToken(100, 'GALLERY');
      const res = await request.get('/api/shows/my-shows').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(0);
    });

    it('비Gallery 유저 접근 시 403', async () => {
      const token = authToken(1, 'ARTIST');
      const res = await request.get('/api/shows/my-shows').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    });
  });

  // ===== GET /shows?showStatus=... =====
  describe('GET /shows (showStatus filter)', () => {
    it('ongoing: 진행중 전시만 반환', async () => {
      const gallery = await seedGallery();
      // 진행중 (seedShow는 시작일 7일전 ~ 종료일 30일후)
      await seedShow(gallery.id);
      // 예정 전시
      await testPrisma.show.create({
        data: {
          title: 'Upcoming', description: '예정', 
          startDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
          endDate: new Date(Date.now() + 40 * 24 * 60 * 60 * 1000),
          openingHours: '10:00-18:00', admissionFee: '무료', location: '서울',
          region: 'SEOUL', posterImage: 'https://example.com/p.jpg',
          status: 'APPROVED', galleryId: gallery.id,
        },
      });

      const res = await request.get('/api/shows?showStatus=ongoing');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].title).toBe('Test Show');
    });

    it('upcoming: 예정 전시만 반환', async () => {
      const gallery = await seedGallery();
      await seedShow(gallery.id);
      await testPrisma.show.create({
        data: {
          title: 'Upcoming', description: '예정',
          startDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
          endDate: new Date(Date.now() + 40 * 24 * 60 * 60 * 1000),
          openingHours: '10:00-18:00', admissionFee: '무료', location: '서울',
          region: 'SEOUL', posterImage: 'https://example.com/p.jpg',
          status: 'APPROVED', galleryId: gallery.id,
        },
      });

      const res = await request.get('/api/shows?showStatus=upcoming');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].title).toBe('Upcoming');
    });

    it('ended: 종료 전시만 반환', async () => {
      const gallery = await seedGallery();
      await testPrisma.show.create({
        data: {
          title: 'Ended', description: '종료',
          startDate: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
          endDate: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
          openingHours: '10:00-18:00', admissionFee: '무료', location: '서울',
          region: 'SEOUL', posterImage: 'https://example.com/p.jpg',
          status: 'APPROVED', galleryId: gallery.id,
        },
      });

      const res = await request.get('/api/shows?showStatus=ended');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].title).toBe('Ended');
    });
  });

  // ===== PATCH /shows/:id 엣지케이스 =====
  describe('PATCH /shows/:id (edge cases)', () => {
    it('artists만 수정 (description 미포함)', async () => {
      const gallery = await seedGallery();
      const show = await seedShow(gallery.id);
      const token = authToken(3, 'GALLERY');

      const res = await request.patch(`/api/shows/${show.id}`).set('Authorization', `Bearer ${token}`)
        .send({ artists: ['새작가1', '새작가2'] });
      expect(res.status).toBe(200);
      // 문자열 배열도 ArtistEntry로 정규화됨
      expect(res.body.artists).toEqual([{ name: '새작가1', userId: null }, { name: '새작가2', userId: null }]);
    });

    it('artists를 null로 설정', async () => {
      const gallery = await seedGallery();
      const show = await seedShow(gallery.id);
      const token = authToken(3, 'GALLERY');

      const res = await request.patch(`/api/shows/${show.id}`).set('Authorization', `Bearer ${token}`)
        .send({ artists: null });
      expect(res.status).toBe(200);
      expect(res.body.artists).toBeNull();
    });

    it('존재하지 않는 전시 수정 시 404', async () => {
      const token = authToken(3, 'GALLERY');
      const res = await request.patch('/api/shows/99999').set('Authorization', `Bearer ${token}`)
        .send({ description: '수정 시도' });
      expect(res.status).toBe(404);
    });
  });

  // ===== Cascade delete =====
  describe('Cascade delete', () => {
    it('갤러리 삭제 시 관련 전시도 삭제', async () => {
      const gallery = await seedGallery();
      const show = await seedShow(gallery.id);
      await testPrisma.showImage.create({ data: { url: 'https://example.com/img.jpg', showId: show.id } });
      await testPrisma.favorite.create({ data: { userId: 1, showId: show.id } });

      // 갤러리 삭제
      const token = authToken(4, 'ADMIN');
      await request.delete(`/api/galleries/${gallery.id}`).set('Authorization', `Bearer ${token}`);

      // Show, ShowImage, Favorite 모두 cascade 삭제됨
      const shows = await testPrisma.show.findMany({ where: { galleryId: gallery.id } });
      expect(shows).toHaveLength(0);
      const images = await testPrisma.showImage.findMany({ where: { showId: show.id } });
      expect(images).toHaveLength(0);
    });
  });
});
