import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { request, testPrisma, authToken, cleanDb, seedUsers, seedGallery } from '../../__tests__/helpers';

describe('Gallery of Month Routes', () => {
  let galleryId: number;
  let gallery2Id: number;
  let gotmId: number;

  beforeAll(async () => {
    await cleanDb();
    await seedUsers();
    const gallery = await seedGallery();
    galleryId = gallery.id;
    // 두 번째 갤러리 (삭제 테스트용, GotM unique constraint 회피)
    const gallery2 = await testPrisma.gallery.create({
      data: {
        name: 'Second Gallery', address: '부산시', phone: '051-000-0000',
        description: 'desc', region: 'BUSAN', ownerName: 'Owner2',
        status: 'APPROVED', ownerId: 3,
      },
    });
    gallery2Id = gallery2.id;
  });
  afterAll(async () => {
    await cleanDb();
  });

  it('POST /api/gallery-of-month — Admin이 이달의 갤러리 등록', async () => {
    const token = authToken(4, 'ADMIN');
    const res = await request.post('/api/gallery-of-month').set('Authorization', `Bearer ${token}`).send({
      galleryId,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    });
    expect(res.status).toBe(201);
    gotmId = res.body.id;
  });

  it('GET /api/gallery-of-month — 만료 전 항목만 반환', async () => {
    const res = await request.get('/api/gallery-of-month');
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
  });

  // 자동 만료 필터링 테스트 — 만료된 항목은 GET에서 제외됨 (where expiresAt >= now)
  it('GET /api/gallery-of-month — 만료된 항목 필터링', async () => {
    // 만료 시점을 과거로 수정
    await testPrisma.galleryOfMonth.update({
      where: { id: gotmId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const res = await request.get('/api/gallery-of-month');
    expect(res.status).toBe(200);
    expect(res.body.find((g: any) => g.id === gotmId)).toBeUndefined();
  });

  it('DELETE /api/gallery-of-month/:id — Admin이 삭제', async () => {
    // 두 번째 갤러리로 GotM 생성 (galleryId unique 회피)
    const gotm = await testPrisma.galleryOfMonth.create({
      data: { galleryId: gallery2Id, expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) },
    });
    const token = authToken(4, 'ADMIN');
    const res = await request.delete(`/api/gallery-of-month/${gotm.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });
});
