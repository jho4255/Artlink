/**
 * Instagram 연동 API 테스트
 *
 * - GET /api/galleries — instagramAccessToken 미노출, instagramConnected 노출
 * - GET /api/galleries/:id — 동일 검증
 * - POST /api/galleries/:id/instagram/connect — OAuth code 교환 후 토큰 저장
 * - PATCH /api/galleries/:id/instagram-visibility — 피드 토글
 * - GET /api/galleries/:id/instagram-feed — 피드 조회
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
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

  describe('POST /api/galleries/:id/instagram/connect', () => {
    const validBody = { code: 'auth_code_123', redirectUri: 'https://artlink.example/auth/instagram/callback' };
    let originalFetch: typeof global.fetch;
    const origAppId = process.env.INSTAGRAM_APP_ID;
    const origSecret = process.env.INSTAGRAM_APP_SECRET;

    beforeEach(() => {
      originalFetch = global.fetch;
      process.env.INSTAGRAM_APP_ID = 'test_app_id';
      process.env.INSTAGRAM_APP_SECRET = 'test_app_secret';
    });
    afterEach(() => {
      global.fetch = originalFetch;
      process.env.INSTAGRAM_APP_ID = origAppId;
      process.env.INSTAGRAM_APP_SECRET = origSecret;
    });

    it('인증 없으면 401', async () => {
      const res = await request.post(`/api/galleries/${galleryId}/instagram/connect`).send(validBody);
      expect(res.status).toBe(401);
    });

    it('비오너면 403', async () => {
      const res = await request
        .post(`/api/galleries/${galleryId}/instagram/connect`)
        .set('Authorization', `Bearer ${artistToken}`)
        .send(validBody);
      expect(res.status).toBe(403);
    });

    it('code 누락이면 400 (validate)', async () => {
      const res = await request
        .post(`/api/galleries/${galleryId}/instagram/connect`)
        .set('Authorization', `Bearer ${galleryToken}`)
        .send({ redirectUri: validBody.redirectUri });
      expect(res.status).toBe(400);
    });

    it('code 교환 실패면 400 (Instagram mock)', async () => {
      // 1차 호출(단기 토큰 교환) 실패
      global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error_message: 'bad code' }) } as any);

      const res = await request
        .post(`/api/galleries/${galleryId}/instagram/connect`)
        .set('Authorization', `Bearer ${galleryToken}`)
        .send(validBody);
      expect(res.status).toBe(400);
    });

    it('유효한 code면 토큰 교환 후 저장 성공 (Instagram mock)', async () => {
      // 3단계: 단기토큰 → 장기토큰 → 프로필
      global.fetch = vi.fn()
        .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'short_tok', user_id: '999' }) } as any)
        .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'long_tok', expires_in: 5184000 }) } as any)
        .mockResolvedValueOnce({ ok: true, json: async () => ({ id: '999', username: 'test_gallery' }) } as any);

      const res = await request
        .post(`/api/galleries/${galleryId}/instagram/connect`)
        .set('Authorization', `Bearer ${galleryToken}`)
        .send(validBody);

      expect(res.status).toBe(200);
      expect(res.body.instagramConnected).toBe(true);
      expect(res.body.username).toBe('test_gallery');

      // DB 확인 — 장기 토큰/핸들/만료시각 저장
      const gallery = await testPrisma.gallery.findUnique({ where: { id: galleryId } });
      expect(gallery?.instagramAccessToken).toBe('long_tok');
      expect(gallery?.instagramUrl).toBe('@test_gallery');
      expect(gallery?.instagramTokenExpiresAt).toBeTruthy();
    });

    it('앱 자격증명 미설정이면 500', async () => {
      delete process.env.INSTAGRAM_APP_ID;
      delete process.env.INSTAGRAM_APP_SECRET;

      const res = await request
        .post(`/api/galleries/${galleryId}/instagram/connect`)
        .set('Authorization', `Bearer ${galleryToken}`)
        .send(validBody);
      expect(res.status).toBe(500);
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

    it('Graph API 오류 시 502 반환 (빈 피드와 구분 — 프론트에서 안내 표시)', async () => {
      await testPrisma.gallery.update({
        where: { id: galleryId },
        data: { instagramAccessToken: 'expired_token', instagramFeedVisible: true },
      });

      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 400 } as any);

      const res = await request.get(`/api/galleries/${galleryId}/instagram-feed`);
      expect(res.status).toBe(502);
      expect(res.body.error).toBe('instagram_unavailable');

      global.fetch = originalFetch;
    });
  });
});
