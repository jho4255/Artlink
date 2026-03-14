import { describe, it, expect, beforeEach } from 'vitest';
import { request, testPrisma, authToken, cleanDb, seedUsers } from './helpers';

describe('Public Portfolio API', () => {
  beforeEach(async () => {
    await cleanDb();
    await seedUsers();
  });

  // ===== GET /portfolio/:userId =====
  describe('GET /portfolio/:userId', () => {
    it('ARTIST 유저의 공개 포트폴리오 조회', async () => {
      // Artist1(id=1) 포트폴리오 생성
      await testPrisma.portfolio.create({
        data: { userId: 1, biography: '테스트 약력', exhibitionHistory: '전시 이력' },
      });

      const res = await request.get('/api/portfolio/1');
      expect(res.status).toBe(200);
      expect(res.body.user.name).toBe('Artist 1');
      expect(res.body.biography).toBe('테스트 약력');
      expect(res.body.images).toEqual([]);
    });

    it('포트폴리오 없는 ARTIST도 빈 데이터 반환', async () => {
      const res = await request.get('/api/portfolio/1');
      expect(res.status).toBe(200);
      expect(res.body.user.name).toBe('Artist 1');
      expect(res.body.biography).toBeNull();
    });

    it('ARTIST가 아닌 유저는 404', async () => {
      const res = await request.get('/api/portfolio/3'); // GALLERY 유저
      expect(res.status).toBe(404);
    });

    it('존재하지 않는 유저 404', async () => {
      const res = await request.get('/api/portfolio/999');
      expect(res.status).toBe(404);
    });

    it('유효하지 않은 ID 400', async () => {
      const res = await request.get('/api/portfolio/abc');
      expect(res.status).toBe(400);
    });
  });

  // ===== GET /portfolio/search =====
  describe('GET /portfolio/search', () => {
    it('GALLERY 유저가 작가 이름 검색', async () => {
      const token = authToken(3, 'GALLERY');
      const res = await request.get('/api/portfolio/search?q=Artist').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2); // Artist 1, Artist 2
    });

    it('빈 검색어는 빈 배열', async () => {
      const token = authToken(3, 'GALLERY');
      const res = await request.get('/api/portfolio/search?q=').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(0);
    });

    it('ARTIST 유저는 검색 불가 403', async () => {
      const token = authToken(1, 'ARTIST');
      const res = await request.get('/api/portfolio/search?q=Artist').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    });
  });
});
