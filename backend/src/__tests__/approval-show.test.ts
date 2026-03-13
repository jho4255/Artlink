/**
 * Approval API — Show 승인 관련 추가 테스트
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { request, testPrisma, authToken, cleanDb, seedUsers, seedGallery } from './helpers';

describe('Approval API (Show)', () => {
  beforeEach(async () => {
    await cleanDb();
    await seedUsers();
  });

  describe('GET /approvals', () => {
    it('pendingShows가 응답에 포함됨', async () => {
      const gallery = await seedGallery();
      await testPrisma.show.create({
        data: {
          title: 'Pending Show', description: '대기중',
          startDate: new Date(), endDate: new Date(Date.now() + 30 * 86400000),
          openingHours: '10:00-18:00', admissionFee: '무료', location: '서울',
          region: 'SEOUL', posterImage: 'https://example.com/p.jpg',
          status: 'PENDING', galleryId: gallery.id,
        },
      });

      const token = authToken(4, 'ADMIN');
      const res = await request.get('/api/approvals')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.pendingShows).toHaveLength(1);
      expect(res.body.pendingShows[0].title).toBe('Pending Show');
      expect(res.body.pendingShows[0].gallery.name).toBe('Test Gallery');
    });

    it('APPROVED 전시는 pendingShows에 미포함', async () => {
      const gallery = await seedGallery();
      await testPrisma.show.create({
        data: {
          title: 'Approved Show', description: '승인됨',
          startDate: new Date(), endDate: new Date(Date.now() + 30 * 86400000),
          openingHours: '10:00-18:00', admissionFee: '무료', location: '서울',
          region: 'SEOUL', posterImage: 'https://example.com/p.jpg',
          status: 'APPROVED', galleryId: gallery.id,
        },
      });

      const token = authToken(4, 'ADMIN');
      const res = await request.get('/api/approvals')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.pendingShows).toHaveLength(0);
    });
  });

  describe('PATCH /approvals/show/:id', () => {
    it('거절 시 사유 없으면 400', async () => {
      const gallery = await seedGallery();
      const show = await testPrisma.show.create({
        data: {
          title: 'Pending', description: '대기',
          startDate: new Date(), endDate: new Date(Date.now() + 30 * 86400000),
          openingHours: '10:00-18:00', admissionFee: '무료', location: '서울',
          region: 'SEOUL', posterImage: 'https://example.com/p.jpg',
          status: 'PENDING', galleryId: gallery.id,
        },
      });

      const token = authToken(4, 'ADMIN');
      const res = await request.patch(`/api/approvals/show/${show.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'REJECTED' });
      expect(res.status).toBe(400);
    });

    it('비Admin 유저는 403', async () => {
      const token = authToken(1, 'ARTIST');
      const res = await request.patch('/api/approvals/show/1')
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'APPROVED' });
      expect(res.status).toBe(403);
    });
  });
});
