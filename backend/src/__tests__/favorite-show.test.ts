/**
 * Favorite API — Show 찜 관련 추가 테스트
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { request, testPrisma, authToken, cleanDb, seedUsers, seedGallery, seedShow } from './helpers';

describe('Favorite API (Show)', () => {
  beforeEach(async () => {
    await cleanDb();
    await seedUsers();
  });

  describe('POST /favorites/toggle (showId)', () => {
    it('전시 찜 토글 — 등록 후 해제', async () => {
      const gallery = await seedGallery();
      const show = await seedShow(gallery.id);
      const token = authToken(1, 'ARTIST');

      // 찜 등록
      const res1 = await request.post('/api/favorites/toggle')
        .set('Authorization', `Bearer ${token}`)
        .send({ showId: show.id });
      expect(res1.status).toBe(200);
      expect(res1.body.favorited).toBe(true);

      // 찜 해제
      const res2 = await request.post('/api/favorites/toggle')
        .set('Authorization', `Bearer ${token}`)
        .send({ showId: show.id });
      expect(res2.status).toBe(200);
      expect(res2.body.favorited).toBe(false);
    });

    it('galleryId/exhibitionId/showId 모두 없으면 400', async () => {
      const token = authToken(1, 'ARTIST');
      const res = await request.post('/api/favorites/toggle')
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(res.status).toBe(400);
    });
  });

  describe('GET /favorites (show 포함)', () => {
    it('찜 목록에 show 정보가 포함됨', async () => {
      const gallery = await seedGallery();
      const show = await seedShow(gallery.id);
      const token = authToken(1, 'ARTIST');

      // 전시 찜
      await request.post('/api/favorites/toggle')
        .set('Authorization', `Bearer ${token}`)
        .send({ showId: show.id });

      const res = await request.get('/api/favorites')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].show).toBeTruthy();
      expect(res.body[0].show.title).toBe('Test Show');
      expect(res.body[0].show.gallery.name).toBe('Test Gallery');
    });

    it('갤러리+전시 동시 찜 목록', async () => {
      const gallery = await seedGallery();
      const show = await seedShow(gallery.id);
      const token = authToken(1, 'ARTIST');

      await request.post('/api/favorites/toggle')
        .set('Authorization', `Bearer ${token}`)
        .send({ galleryId: gallery.id });
      await request.post('/api/favorites/toggle')
        .set('Authorization', `Bearer ${token}`)
        .send({ showId: show.id });

      const res = await request.get('/api/favorites')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
    });
  });
});
