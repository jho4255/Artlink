import { describe, it, expect, beforeEach } from 'vitest';
import { request, testPrisma, authToken, cleanDb, seedUsers, seedGallery, seedShow, seedExhibition } from './helpers';

// 시드: 1=artist1(ARTIST), 2=artist2(ARTIST), 3=gallery(GALLERY, 소유자), 4=admin(ADMIN)
const ADMIN = () => authToken(4, 'ADMIN');
const ARTIST = () => authToken(1, 'ARTIST');
const OWNER = () => authToken(3, 'GALLERY');

describe('상세 페이지 조회수', () => {
  beforeEach(async () => { await cleanDb(); await seedUsers(); });

  describe('조회수 증가 규칙 (갤러리/공모/전시 상세 GET)', () => {
    it('비로그인 조회 시 갤러리 viewCount 증가', async () => {
      const g = await seedGallery(3);
      await request.get(`/api/galleries/${g.id}`);
      await request.get(`/api/galleries/${g.id}`);
      const after = await testPrisma.gallery.findUnique({ where: { id: g.id } });
      expect(after!.viewCount).toBe(2);
    });

    it('아티스트(비-소유자) 조회 시 공모 viewCount 증가', async () => {
      const g = await seedGallery(3);
      const ex = await seedExhibition(g.id);
      await request.get(`/api/exhibitions/${ex.id}`).set('Authorization', `Bearer ${ARTIST()}`);
      const after = await testPrisma.exhibition.findUnique({ where: { id: ex.id } });
      expect(after!.viewCount).toBe(1);
    });

    it('전시(Show) 조회 시 viewCount 증가', async () => {
      const g = await seedGallery(3);
      const s = await seedShow(g.id);
      await request.get(`/api/shows/${s.id}`);
      const after = await testPrisma.show.findUnique({ where: { id: s.id } });
      expect(after!.viewCount).toBe(1);
    });

    it('ADMIN 조회는 집계 제외 (viewCount 불변)', async () => {
      const g = await seedGallery(3);
      await request.get(`/api/galleries/${g.id}`).set('Authorization', `Bearer ${ADMIN()}`);
      const after = await testPrisma.gallery.findUnique({ where: { id: g.id } });
      expect(after!.viewCount).toBe(0);
    });

    it('소유자(owner) 본인 조회는 집계 제외 (viewCount 불변)', async () => {
      const g = await seedGallery(3);
      const ex = await seedExhibition(g.id);
      await request.get(`/api/galleries/${g.id}`).set('Authorization', `Bearer ${OWNER()}`);
      await request.get(`/api/exhibitions/${ex.id}`).set('Authorization', `Bearer ${OWNER()}`);
      const g2 = await testPrisma.gallery.findUnique({ where: { id: g.id } });
      const ex2 = await testPrisma.exhibition.findUnique({ where: { id: ex.id } });
      expect(g2!.viewCount).toBe(0);
      expect(ex2!.viewCount).toBe(0);
    });

    it('조회수 증가가 상세 응답을 막지 않음 (정상 200 + viewCount 필드 포함)', async () => {
      const g = await seedGallery(3);
      const res = await request.get(`/api/galleries/${g.id}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('viewCount');
    });
  });

  describe('GET /api/admin/view-stats', () => {
    it('ADMIN: 갤러리/공모/전시 조회수를 내림차순으로 반환', async () => {
      const g = await seedGallery(3);
      const exA = await seedExhibition(g.id);
      const exB = await seedExhibition(g.id);
      const s = await seedShow(g.id);

      // exB를 3회, exA를 1회 조회 → exB가 상위
      await request.get(`/api/exhibitions/${exA.id}`);
      await request.get(`/api/exhibitions/${exB.id}`);
      await request.get(`/api/exhibitions/${exB.id}`);
      await request.get(`/api/exhibitions/${exB.id}`);
      await request.get(`/api/shows/${s.id}`);

      const res = await request.get('/api/admin/view-stats').set('Authorization', `Bearer ${ADMIN()}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('galleries');
      expect(res.body).toHaveProperty('exhibitions');
      expect(res.body).toHaveProperty('shows');
      expect(res.body).toHaveProperty('totals');

      // 내림차순 정렬 검증
      expect(res.body.exhibitions[0].id).toBe(exB.id);
      expect(res.body.exhibitions[0].viewCount).toBe(3);
      expect(res.body.exhibitions[1].id).toBe(exA.id);
      expect(res.body.exhibitions[0]).toHaveProperty('galleryName', 'Test Gallery');

      // 합계 검증
      expect(res.body.totals.exhibitions).toBe(4);
      expect(res.body.totals.shows).toBe(1);
    });

    it('ARTIST 접근 → 403', async () => {
      const res = await request.get('/api/admin/view-stats').set('Authorization', `Bearer ${ARTIST()}`);
      expect(res.status).toBe(403);
    });

    it('비로그인 접근 → 401', async () => {
      const res = await request.get('/api/admin/view-stats');
      expect(res.status).toBe(401);
    });
  });
});
