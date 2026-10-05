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

  // 2026-10-05 사용자 요청 — "갤러리 유저가 본인이 올린 공고라면 그 공고에만 한해서 조회수를 볼 수 있게. 다른 갤러리 것은 못 보게"
  describe('공모 조회수는 올린 갤러리·관리자만 본다', () => {
    const OTHER = 50;   // 다른 갤러리 주인
    const OTHER_TOKEN = () => authToken(OTHER, 'GALLERY');
    let mine: { id: number };
    let other: { id: number };
    beforeEach(async () => {
      await testPrisma.user.create({ data: { id: OTHER, email: 'gallery-other@test.com', name: 'Other Gallery', role: 'GALLERY' } });
      const g = await seedGallery(3);
      const og = await seedGallery(OTHER);
      mine = await seedExhibition(g.id);
      other = await seedExhibition(og.id);
      await testPrisma.exhibition.update({ where: { id: mine.id }, data: { viewCount: 7 } });
      await testPrisma.exhibition.update({ where: { id: other.id }, data: { viewCount: 9 } });
    });

    it('상세 — 올린 갤러리 주인에게는 조회수가 온다', async () => {
      const res = await request.get(`/api/exhibitions/${mine.id}`).set('Authorization', `Bearer ${OWNER()}`);
      expect(res.status).toBe(200);
      expect(res.body.viewCount).toBe(7);
    });

    it('상세 — 다른 갤러리·작가·비회원에게는 조회수가 없다', async () => {
      for (const auth of [`Bearer ${OTHER_TOKEN()}`, `Bearer ${ARTIST()}`, null]) {
        const req = request.get(`/api/exhibitions/${mine.id}`);
        const res = auth ? await req.set('Authorization', auth) : await req;
        expect(res.status).toBe(200);
        expect(res.body).not.toHaveProperty('viewCount');
      }
      // 반대 방향도 — 내 갤러리 계정으로 남의 공모를 열면 안 보인다
      const res = await request.get(`/api/exhibitions/${other.id}`).set('Authorization', `Bearer ${OWNER()}`);
      expect(res.body).not.toHaveProperty('viewCount');
    });

    it('상세 — 관리자에게는 온다', async () => {
      const res = await request.get(`/api/exhibitions/${other.id}`).set('Authorization', `Bearer ${ADMIN()}`);
      expect(res.body.viewCount).toBe(9);
    });

    it('공개 목록·갤러리 상세의 공모 목록에는 누구에게도 조회수가 없다', async () => {
      const list = await request.get('/api/exhibitions').set('Authorization', `Bearer ${OTHER_TOKEN()}`);
      expect(list.status).toBe(200);
      expect(list.body.length).toBeGreaterThan(0);
      for (const e of list.body) expect(e).not.toHaveProperty('viewCount');

      const g = await testPrisma.exhibition.findUnique({ where: { id: mine.id }, select: { galleryId: true } });
      const gal = await request.get(`/api/galleries/${g!.galleryId}`).set('Authorization', `Bearer ${OTHER_TOKEN()}`);
      expect(gal.status).toBe(200);
      for (const e of gal.body.exhibitions) expect(e).not.toHaveProperty('viewCount');
    });

    it('[내 공모] — 내 공모에만 조회수가 오고 남의 공모는 목록에 없다', async () => {
      const ov = await request.get('/api/exhibitions/my-operation-overview').set('Authorization', `Bearer ${OWNER()}`);
      expect(ov.status).toBe(200);
      expect(ov.body.map((e: any) => [e.id, e.viewCount])).toEqual([[mine.id, 7]]);

      const my = await request.get('/api/exhibitions/my-exhibitions').set('Authorization', `Bearer ${OWNER()}`);
      expect(my.body.map((e: any) => [e.id, e.viewCount])).toEqual([[mine.id, 7]]);
    });

    it('아트링크 주최 공모 — 운영만 위임받은 갤러리는 조회수를 못 본다(올린 곳이 아트링크)', async () => {
      const og = await testPrisma.exhibition.findUnique({ where: { id: other.id }, select: { galleryId: true } });
      const hosted = await testPrisma.exhibition.create({
        data: {
          title: '아트링크 주최', type: 'GROUP', hostType: 'ADMIN', status: 'APPROVED', capacity: 5, region: 'SEOUL', description: 'd',
          deadline: new Date(Date.now() + 30 * 86400000), exhibitDate: new Date(Date.now() + 60 * 86400000),
          galleryId: og!.galleryId, viewCount: 11,
        },
      });
      await testPrisma.exhibitionManager.create({ data: { exhibitionId: hosted.id, galleryId: og!.galleryId! } });

      const detail = await request.get(`/api/exhibitions/${hosted.id}`).set('Authorization', `Bearer ${OTHER_TOKEN()}`);
      expect(detail.status).toBe(200);
      expect(detail.body.canOperate).toBe(true);          // 운영은 한다
      expect(detail.body).not.toHaveProperty('viewCount'); // 조회수는 못 본다

      const ov = await request.get('/api/exhibitions/my-operation-overview').set('Authorization', `Bearer ${OTHER_TOKEN()}`);
      const row = ov.body.find((e: any) => e.id === hosted.id);
      expect(row.viewCount).toBeNull();
      expect(ov.body.find((e: any) => e.id === other.id).viewCount).toBe(9);

      const adminRes = await request.get(`/api/exhibitions/${hosted.id}`).set('Authorization', `Bearer ${ADMIN()}`);
      expect(adminRes.body.viewCount).toBe(11);
    });

    it('[내 전시](작가) — 지원한 공모의 조회수는 오지 않는다', async () => {
      await testPrisma.application.create({ data: { userId: 1, exhibitionId: mine.id, status: 'SUBMITTED' } });
      const res = await request.get('/api/exhibitions/my-applications').set('Authorization', `Bearer ${ARTIST()}`);
      expect(res.status).toBe(200);
      expect(res.body[0].exhibition.id).toBe(mine.id);
      expect(res.body[0].exhibition).not.toHaveProperty('viewCount');
    });
  });
});
