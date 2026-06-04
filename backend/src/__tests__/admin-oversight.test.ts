/**
 * Admin 운영 조회 API 테스트
 *
 * GET /api/admin/exhibitions                  - 전체 공모 목록(검색/필터)
 * GET /api/admin/exhibitions/:id/applications - 특정 공모 지원 현황 + 상태
 * GET /api/admin/users/:id/applications       - 작가 지원 이력
 * GET /api/admin/galleries                    - 갤러리 검색
 * GET /api/admin/galleries/:id/posts          - 갤러리 공모 + 전시 전체
 *
 * 공통: ADMIN 전용 (비-admin 403)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { request, testPrisma, authToken, cleanDb, seedUsers, seedGallery, seedShow, seedExhibition } from './helpers';

const adminTok = authToken(4, 'ADMIN');
const galleryTok = authToken(3, 'GALLERY');
const artistTok = authToken(1, 'ARTIST');

describe('Admin 운영 조회 API', () => {
  let galleryId: number;
  let exhibitionId: number;

  beforeEach(async () => {
    await cleanDb();
    await seedUsers();
    const gallery = await seedGallery(3);
    galleryId = gallery.id;
    const ex = await seedExhibition(galleryId);
    exhibitionId = ex.id;
    await seedShow(galleryId);

    // 두 작가가 지원, 하나는 수락 처리됨
    await testPrisma.application.create({ data: { userId: 1, exhibitionId, status: 'ACCEPTED', customAnswers: JSON.stringify([{ fieldId: 'f1', value: '답변A' }]) } });
    await testPrisma.application.create({ data: { userId: 2, exhibitionId, status: 'SUBMITTED' } });
  });

  // ===== 권한 검증 =====
  describe('권한', () => {
    const endpoints = [
      ['get', '/api/admin/exhibitions'],
      ['get', `/api/admin/exhibitions/1/applications`],
      ['get', '/api/admin/users/1/applications'],
      ['get', '/api/admin/galleries'],
      ['get', '/api/admin/galleries/1/posts'],
    ] as const;

    it('비인증 → 401', async () => {
      for (const [, url] of endpoints) {
        const res = await request.get(url);
        expect(res.status, url).toBe(401);
      }
    });

    it('GALLERY/ARTIST → 403', async () => {
      for (const [, url] of endpoints) {
        const rg = await request.get(url).set('Authorization', `Bearer ${galleryTok}`);
        expect(rg.status, `gallery ${url}`).toBe(403);
        const ra = await request.get(url).set('Authorization', `Bearer ${artistTok}`);
        expect(ra.status, `artist ${url}`).toBe(403);
      }
    });
  });

  // ===== 공모 목록 =====
  describe('GET /admin/exhibitions', () => {
    it('전체 공모 + 지원자 수 반환', async () => {
      const res = await request.get('/api/admin/exhibitions').set('Authorization', `Bearer ${adminTok}`);
      expect(res.status).toBe(200);
      const ex = res.body.find((e: any) => e.id === exhibitionId);
      expect(ex).toBeTruthy();
      expect(ex.gallery.name).toBe('Test Gallery');
      expect(ex._count.applications).toBe(2);
    });

    it('제목 검색(q) 필터', async () => {
      const hit = await request.get('/api/admin/exhibitions?q=Test').set('Authorization', `Bearer ${adminTok}`);
      expect(hit.body.length).toBeGreaterThan(0);
      const miss = await request.get('/api/admin/exhibitions?q=없는제목XYZ').set('Authorization', `Bearer ${adminTok}`);
      expect(miss.body.length).toBe(0);
    });
  });

  // ===== 공모별 지원 현황 =====
  describe('GET /admin/exhibitions/:id/applications', () => {
    it('지원자 + 상태 + 결정시각 + 카운트 반환', async () => {
      const res = await request.get(`/api/admin/exhibitions/${exhibitionId}/applications`).set('Authorization', `Bearer ${adminTok}`);
      expect(res.status).toBe(200);
      expect(res.body.exhibition.title).toBe('Test Exhibition');
      expect(res.body.counts.ALL).toBe(2);
      expect(res.body.counts.ACCEPTED).toBe(1);
      expect(res.body.counts.SUBMITTED).toBe(1);
      expect(res.body.applications).toHaveLength(2);
      const accepted = res.body.applications.find((a: any) => a.status === 'ACCEPTED');
      expect(accepted.user.id).toBe(1);
      expect(accepted.appliedAt).toBeTruthy();
      expect(accepted.decidedAt).toBeTruthy();
      expect(accepted.customAnswers).toEqual([{ fieldId: 'f1', value: '답변A' }]);
    });

    it('없는 공모 → 404', async () => {
      const res = await request.get('/api/admin/exhibitions/999999/applications').set('Authorization', `Bearer ${adminTok}`);
      expect(res.status).toBe(404);
    });

    it('갤러리 단위 지원 횟수/순번/첫지원 여부', async () => {
      // 같은 갤러리의 두 번째 공모에 user1이 또 지원 (총 2회)
      const ex2 = await testPrisma.exhibition.create({
        data: { title: '두번째 공모', type: 'SOLO', deadline: new Date(Date.now() + 30 * 86400000), exhibitDate: new Date(Date.now() + 60 * 86400000), capacity: 5, region: 'SEOUL', description: 'd', status: 'APPROVED', galleryId },
      });
      await testPrisma.application.create({ data: { userId: 1, exhibitionId: ex2.id, status: 'SUBMITTED' } });

      // 첫 공모: user1은 이 갤러리 첫 지원
      const r1 = await request.get(`/api/admin/exhibitions/${exhibitionId}/applications`).set('Authorization', `Bearer ${adminTok}`);
      const u1a = r1.body.applications.find((a: any) => a.user.id === 1);
      expect(u1a.galleryApplicationCount).toBe(2);
      expect(u1a.galleryApplicationOrder).toBe(1);
      expect(u1a.isFirstApplication).toBe(true);
      // user2는 1회뿐 → 첫 지원
      const u2 = r1.body.applications.find((a: any) => a.user.id === 2);
      expect(u2.isFirstApplication).toBe(true);
      expect(u2.galleryApplicationCount).toBe(1);

      // 두번째 공모: user1은 2번째 지원
      const r2 = await request.get(`/api/admin/exhibitions/${ex2.id}/applications`).set('Authorization', `Bearer ${adminTok}`);
      const u1b = r2.body.applications.find((a: any) => a.user.id === 1);
      expect(u1b.galleryApplicationOrder).toBe(2);
      expect(u1b.isFirstApplication).toBe(false);
    });
  });

  // ===== 작가 지원 이력 =====
  describe('GET /admin/users/:id/applications', () => {
    it('작가의 지원 이력 + 상태 반환', async () => {
      const res = await request.get('/api/admin/users/1/applications').set('Authorization', `Bearer ${adminTok}`);
      expect(res.status).toBe(200);
      expect(res.body.user.id).toBe(1);
      expect(res.body.counts.ACCEPTED).toBe(1);
      expect(res.body.applications).toHaveLength(1);
      expect(res.body.applications[0].status).toBe('ACCEPTED');
      expect(res.body.applications[0].exhibition.title).toBe('Test Exhibition');
      expect(res.body.applications[0].gallery.name).toBe('Test Gallery');
    });

    it('지원 없는 작가 → 빈 이력', async () => {
      const res = await request.get('/api/admin/users/3/applications').set('Authorization', `Bearer ${adminTok}`);
      expect(res.status).toBe(200);
      expect(res.body.applications).toHaveLength(0);
      expect(res.body.counts.ALL).toBe(0);
    });

    it('없는 사용자 → 404', async () => {
      const res = await request.get('/api/admin/users/999999/applications').set('Authorization', `Bearer ${adminTok}`);
      expect(res.status).toBe(404);
    });
  });

  // ===== 갤러리 검색 + 게시물 =====
  describe('GET /admin/galleries (+/:id/posts)', () => {
    it('갤러리 검색 + 공모/전시 수', async () => {
      const res = await request.get('/api/admin/galleries?q=Test').set('Authorization', `Bearer ${adminTok}`);
      expect(res.status).toBe(200);
      const g = res.body.find((x: any) => x.id === galleryId);
      expect(g).toBeTruthy();
      expect(g._count.exhibitions).toBe(1);
      expect(g._count.shows).toBe(1);
      expect(g.owner.id).toBe(3);
    });

    it('갤러리 공모 + 전시 전체 반환', async () => {
      const res = await request.get(`/api/admin/galleries/${galleryId}/posts`).set('Authorization', `Bearer ${adminTok}`);
      expect(res.status).toBe(200);
      expect(res.body.gallery.name).toBe('Test Gallery');
      expect(res.body.exhibitions).toHaveLength(1);
      expect(res.body.exhibitions[0]._count.applications).toBe(2);
      expect(res.body.shows).toHaveLength(1);
      expect(res.body.shows[0].title).toBe('Test Show');
    });

    it('없는 갤러리 → 404', async () => {
      const res = await request.get('/api/admin/galleries/999999/posts').set('Authorization', `Bearer ${adminTok}`);
      expect(res.status).toBe(404);
    });
  });
});
