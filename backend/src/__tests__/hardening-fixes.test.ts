import { describe, it, expect, beforeEach } from 'vitest';
import { request, testPrisma, authToken, cleanDb, seedUsers, seedGallery, seedExhibition } from './helpers';

// 2026-07 하드닝 수정들에 대한 assertion 테스트
// (탈퇴 필터 H7 · 동일상태 알림중복 M2 · 라이프사이클 M12/M6 · 승인 whitelist M13 · admin 페이지네이션 · 알림 TTL)
const ADMIN = () => authToken(4, 'ADMIN');
const OWNER = () => authToken(3, 'GALLERY');
const ARTIST = () => authToken(1, 'ARTIST');

async function makeExhibition(galleryId: number, overrides: any = {}) {
  return testPrisma.exhibition.create({
    data: {
      title: 'Lifecycle Ex', type: 'SOLO',
      deadline: new Date(Date.now() - 2 * 864e5),
      exhibitDate: new Date(Date.now() + 30 * 864e5),
      capacity: 5, region: 'SEOUL', description: 'x', status: 'APPROVED', galleryId,
      ...overrides,
    },
  });
}

describe('하드닝 수정 검증', () => {
  beforeEach(async () => { await cleanDb(); await seedUsers(); });

  describe('탈퇴/비-APPROVED 필터 (H7)', () => {
    it('찜 목록에서 WITHDRAWN 갤러리 제외', async () => {
      const g = await seedGallery(3);
      await testPrisma.favorite.create({ data: { userId: 1, galleryId: g.id } });
      let res = await request.get('/api/favorites').set('Authorization', `Bearer ${ARTIST()}`);
      expect(res.body.some((f: any) => f.galleryId === g.id)).toBe(true);

      await testPrisma.gallery.update({ where: { id: g.id }, data: { status: 'WITHDRAWN' } });
      res = await request.get('/api/favorites').set('Authorization', `Bearer ${ARTIST()}`);
      expect(res.body.some((f: any) => f.galleryId === g.id)).toBe(false);
    });

    it('이달의 갤러리에서 WITHDRAWN 갤러리 제외', async () => {
      const g = await seedGallery(3);
      await testPrisma.galleryOfMonth.create({ data: { galleryId: g.id, expiresAt: new Date(Date.now() + 30 * 864e5) } });
      let res = await request.get('/api/gallery-of-month');
      expect(res.body.some((x: any) => x.galleryId === g.id)).toBe(true);

      await testPrisma.gallery.update({ where: { id: g.id }, data: { status: 'WITHDRAWN' } });
      res = await request.get('/api/gallery-of-month');
      expect(res.body.some((x: any) => x.galleryId === g.id)).toBe(false);
    });

    it('탈퇴 작가의 포트폴리오는 404', async () => {
      const before = await request.get('/api/portfolio/1');
      expect(before.status).toBe(200);
      await testPrisma.user.update({ where: { id: 1 }, data: { deletedAt: new Date() } });
      const after = await request.get('/api/portfolio/1');
      expect(after.status).toBe(404);
    });

    it('탐색 피드에서 탈퇴 작가 이미지 제외', async () => {
      const p = await testPrisma.portfolio.create({ data: { userId: 1 } });
      await testPrisma.portfolioImage.create({ data: { portfolioId: p.id, url: '/uploads/a.jpg', showInExplore: true } });
      let res = await request.get('/api/explore');
      expect(res.body.total).toBeGreaterThanOrEqual(1);

      await testPrisma.user.update({ where: { id: 1 }, data: { deletedAt: new Date() } });
      res = await request.get('/api/explore');
      expect(res.body.total).toBe(0);
    });
  });

  describe('동일 상태 재적용 알림 중복 방지 (M2)', () => {
    it('ACCEPTED → ACCEPTED 재적용 시 알림이 추가 생성되지 않음', async () => {
      const g = await seedGallery(3);
      const ex = await seedExhibition(g.id);
      const app = await testPrisma.application.create({ data: { userId: 1, exhibitionId: ex.id, status: 'SUBMITTED' } });

      await request.patch(`/api/exhibitions/${ex.id}/applications/${app.id}`).set('Authorization', `Bearer ${OWNER()}`).send({ status: 'ACCEPTED' });
      const c1 = await testPrisma.notification.count({ where: { userId: 1, type: 'APPLICATION_STATUS' } });
      expect(c1).toBe(1);

      const r2 = await request.patch(`/api/exhibitions/${ex.id}/applications/${app.id}`).set('Authorization', `Bearer ${OWNER()}`).send({ status: 'ACCEPTED' });
      expect(r2.status).toBe(200);
      const c2 = await testPrisma.notification.count({ where: { userId: 1, type: 'APPLICATION_STATUS' } });
      expect(c2).toBe(1);
    });
  });

  describe('운영 라이프사이클 가드 (M12/M6)', () => {
    it('전시 시작일 경과로 자동확정된 공모는 확정취소 400', async () => {
      const g = await seedGallery(3);
      const ex = await makeExhibition(g.id, {
        recruitmentClosed: true, confirmed: false,
        exhibitStartDate: new Date(Date.now() - 864e5), // 어제 → 자동확정
      });
      const res = await request.patch(`/api/operations/${ex.id}/lifecycle`).set('Authorization', `Bearer ${OWNER()}`).send({ confirmed: false });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('자동 확정');
    });

    it('판매 데이터가 있으면 확정취소 400', async () => {
      const g = await seedGallery(3);
      const ex = await makeExhibition(g.id, {
        recruitmentClosed: true, confirmed: true, ended: false,
        exhibitStartDate: new Date(Date.now() + 10 * 864e5), // 미래 → 자동확정 아님(수동 확정만)
      });
      await testPrisma.artworkSale.create({ data: { exhibitionId: ex.id, artistUserId: 1, artworkIndex: 0, title: 'W', soldPrice: 1000 } });
      const res = await request.patch(`/api/operations/${ex.id}/lifecycle`).set('Authorization', `Bearer ${OWNER()}`).send({ confirmed: false });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('판매');
    });
  });

  describe('승인 status whitelist + rejectReason 초기화 (M13)', () => {
    it('유효하지 않은 status는 400', async () => {
      const g = await testPrisma.gallery.create({ data: { name: 'P', address: 'a', phone: '1', description: 'd', region: 'SEOUL', ownerName: 'o', status: 'PENDING', ownerId: 3 } });
      const res = await request.patch(`/api/approvals/gallery/${g.id}`).set('Authorization', `Bearer ${ADMIN()}`).send({ status: 'BOGUS' });
      expect(res.status).toBe(400);
    });

    it('거절 후 재승인 시 rejectReason이 null로 초기화', async () => {
      const g = await testPrisma.gallery.create({ data: { name: 'P', address: 'a', phone: '1', description: 'd', region: 'SEOUL', ownerName: 'o', status: 'PENDING', ownerId: 3 } });
      await request.patch(`/api/approvals/gallery/${g.id}`).set('Authorization', `Bearer ${ADMIN()}`).send({ status: 'REJECTED', rejectReason: '사유있음' });
      let after = await testPrisma.gallery.findUnique({ where: { id: g.id } });
      expect(after!.rejectReason).toBe('사유있음');

      await request.patch(`/api/approvals/gallery/${g.id}`).set('Authorization', `Bearer ${ADMIN()}`).send({ status: 'APPROVED' });
      after = await testPrisma.gallery.findUnique({ where: { id: g.id } });
      expect(after!.status).toBe('APPROVED');
      expect(after!.rejectReason).toBeNull();
    });
  });

  describe('admin 사용자 목록 페이지네이션', () => {
    it('page 파라미터로 skip 적용 (4명뿐이라 2페이지는 비어있음)', async () => {
      const p1 = await request.get('/api/admin/users?page=1').set('Authorization', `Bearer ${ADMIN()}`);
      expect(p1.status).toBe(200);
      expect(Array.isArray(p1.body)).toBe(true);
      expect(p1.body.length).toBeGreaterThan(0);

      const p2 = await request.get('/api/admin/users?page=2').set('Authorization', `Bearer ${ADMIN()}`);
      expect(p2.status).toBe(200);
      expect(p2.body.length).toBe(0);
    });
  });

  describe('알림 TTL 정리 (읽은 90일+)', () => {
    it('목록 조회 시 읽은 90일 초과 알림 삭제, 미읽음/최신은 유지', async () => {
      await testPrisma.notification.create({ data: { userId: 1, type: 'X', message: 'old-read', read: true, createdAt: new Date(Date.now() - 91 * 864e5) } });
      await testPrisma.notification.create({ data: { userId: 1, type: 'Y', message: 'fresh-unread', read: false } });

      await request.get('/api/notifications').set('Authorization', `Bearer ${ARTIST()}`);
      // TTL 정리는 best-effort(비차단) → 잠시 대기 후 확인
      await new Promise((r) => setTimeout(r, 400));

      const remaining = await testPrisma.notification.findMany({ where: { userId: 1 } });
      expect(remaining.some((n) => n.message === 'old-read')).toBe(false);
      expect(remaining.some((n) => n.message === 'fresh-unread')).toBe(true);
    });
  });
});
