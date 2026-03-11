/**
 * Instagram 연동 API 테스트
 *
 * - GET /api/galleries — instagramAccessToken 미노출, instagramConnected 노출
 * - GET /api/galleries/:id — 동일 검증
 * - POST /api/galleries/:id/instagram-token — 토큰 저장
 * - PATCH /api/galleries/:id/instagram-visibility — 피드 토글
 * - GET /api/galleries/:id/instagram-feed — 피드 조회
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { request, testPrisma, authToken, cleanDb, seedUsers, seedGallery } from './helpers';

describe('Instagram API', () => {
  let galleryId: number;
  const galleryToken = authToken(3, 'GALLERY');
  const artistToken = authToken(1, 'ARTIST');

  beforeAll(async () => {
    await cleanDb();
    await seedUsers();
  });

  afterAll(async () => {
    await cleanDb();
    await testPrisma.$disconnect();
  });

  beforeEach(async () => {
    // 갤러리 초기화
    await testPrisma.gallery.deleteMany();
    const gallery = await seedGallery(3);
    galleryId = gallery.id;
  });

  describe('maskInstagram — 토큰 미노출', () => {
    it('GET /api/galleries 응답에 instagramAccessToken이 없고 instagramConnected가 있다', async () => {
      // 토큰을 직접 DB에 설정
      await testPrisma.gallery.update({
        where: { id: galleryId },
        data: { instagramAccessToken: 'test_token_123' },
      });

      const res = await request.get('/api/galleries');
      expect(res.status).toBe(200);
      expect(res.body.length).toBeGreaterThan(0);

      const gallery = res.body[0];
      expect(gallery).not.toHaveProperty('instagramAccessToken');
      expect(gallery).toHaveProperty('instagramConnected');
      expect(gallery.instagramConnected).toBe(true);
    });

    it('GET /api/galleries/:id 응답에 instagramAccessToken이 없고 instagramConnected가 있다', async () => {
      await testPrisma.gallery.update({
        where: { id: galleryId },
        data: { instagramAccessToken: 'test_token_123' },
      });

      const res = await request.get(`/api/galleries/${galleryId}`);
      expect(res.status).toBe(200);
      expect(res.body).not.toHaveProperty('instagramAccessToken');
      expect(res.body.instagramConnected).toBe(true);
    });

    it('토큰 없는 갤러리는 instagramConnected가 false', async () => {
      const res = await request.get(`/api/galleries/${galleryId}`);
      expect(res.status).toBe(200);
      expect(res.body.instagramConnected).toBe(false);
    });
  });

  describe('POST /api/galleries/:id/instagram-token', () => {
    it('인증 없으면 401', async () => {
      const res = await request.post(`/api/galleries/${galleryId}/instagram-token`).send({ accessToken: 'test' });
      expect(res.status).toBe(401);
    });

    it('비오너면 403', async () => {
      const res = await request
        .post(`/api/galleries/${galleryId}/instagram-token`)
        .set('Authorization', `Bearer ${artistToken}`)
        .send({ accessToken: 'test' });
      expect(res.status).toBe(403);
    });

    it('빈 토큰이면 400', async () => {
      const res = await request
        .post(`/api/galleries/${galleryId}/instagram-token`)
        .set('Authorization', `Bearer ${galleryToken}`)
        .send({ accessToken: '' });
      expect(res.status).toBe(400);
    });

    it('잘못된 토큰이면 400 (Graph API mock)', async () => {
      // Graph API mock — 실패 응답
      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 400 } as any);

      const res = await request
        .post(`/api/galleries/${galleryId}/instagram-token`)
        .set('Authorization', `Bearer ${galleryToken}`)
        .send({ accessToken: 'invalid_token' });
      expect(res.status).toBe(400);

      global.fetch = originalFetch;
    });

    it('유효한 토큰이면 저장 성공 (Graph API mock)', async () => {
      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: '12345', username: 'test_gallery' }),
      } as any);

      const res = await request
        .post(`/api/galleries/${galleryId}/instagram-token`)
        .set('Authorization', `Bearer ${galleryToken}`)
        .send({ accessToken: 'valid_token_123' });

      expect(res.status).toBe(200);
      expect(res.body.instagramConnected).toBe(true);
      expect(res.body.username).toBe('test_gallery');

      // DB 확인
      const gallery = await testPrisma.gallery.findUnique({ where: { id: galleryId } });
      expect(gallery?.instagramAccessToken).toBe('valid_token_123');
      expect(gallery?.instagramUrl).toBe('@test_gallery');

      global.fetch = originalFetch;
    });
  });

  describe('PATCH /api/galleries/:id/instagram-visibility', () => {
    it('토큰 없이 visible=true면 400', async () => {
      const res = await request
        .patch(`/api/galleries/${galleryId}/instagram-visibility`)
        .set('Authorization', `Bearer ${galleryToken}`)
        .send({ visible: true });
      expect(res.status).toBe(400);
    });

    it('토큰 있으면 visible 토글 성공', async () => {
      await testPrisma.gallery.update({
        where: { id: galleryId },
        data: { instagramAccessToken: 'test_token' },
      });

      const res = await request
        .patch(`/api/galleries/${galleryId}/instagram-visibility`)
        .set('Authorization', `Bearer ${galleryToken}`)
        .send({ visible: true });
      expect(res.status).toBe(200);
      expect(res.body.instagramFeedVisible).toBe(true);

      // DB 확인
      const gallery = await testPrisma.gallery.findUnique({ where: { id: galleryId } });
      expect(gallery?.instagramFeedVisible).toBe(true);
    });
  });

  describe('GET /api/galleries/:id/instagram-feed', () => {
    it('토큰 없으면 빈 배열', async () => {
      const res = await request.get(`/api/galleries/${galleryId}/instagram-feed`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('피드 OFF면 빈 배열', async () => {
      await testPrisma.gallery.update({
        where: { id: galleryId },
        data: { instagramAccessToken: 'test_token', instagramFeedVisible: false },
      });

      const res = await request.get(`/api/galleries/${galleryId}/instagram-feed`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('피드 ON + 토큰 → Graph API mock으로 게시물 반환', async () => {
      await testPrisma.gallery.update({
        where: { id: galleryId },
        data: { instagramAccessToken: 'test_token', instagramFeedVisible: true },
      });

      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            { id: '1', media_type: 'IMAGE', media_url: 'https://img.com/1.jpg', permalink: 'https://instagram.com/p/1', timestamp: '2026-03-10T00:00:00Z' },
            { id: '2', media_type: 'VIDEO', media_url: 'https://img.com/2.mp4', thumbnail_url: 'https://img.com/2_thumb.jpg', permalink: 'https://instagram.com/p/2', timestamp: '2026-03-09T00:00:00Z' },
          ],
        }),
      } as any);

      const res = await request.get(`/api/galleries/${galleryId}/instagram-feed`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      expect(res.body[0].mediaType).toBe('IMAGE');
      expect(res.body[1].thumbnailUrl).toBe('https://img.com/2_thumb.jpg');

      global.fetch = originalFetch;
    });

    it('Graph API 오류 시 빈 배열 반환', async () => {
      await testPrisma.gallery.update({
        where: { id: galleryId },
        data: { instagramAccessToken: 'expired_token', instagramFeedVisible: true },
      });

      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 400 } as any);

      const res = await request.get(`/api/galleries/${galleryId}/instagram-feed`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);

      global.fetch = originalFetch;
    });
  });
});
