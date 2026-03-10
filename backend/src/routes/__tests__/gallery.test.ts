import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { request, testPrisma, authToken, cleanDb, seedUsers, seedGallery } from '../../__tests__/helpers';

describe('Gallery Routes', () => {
  let galleryId: number;

  beforeAll(async () => {
    await cleanDb();
    await seedUsers();
    const gallery = await seedGallery();
    galleryId = gallery.id;
    // 두 번째 갤러리 (BUSAN, 다른 지역 필터 테스트용)
    await testPrisma.gallery.create({
      data: {
        name: 'Busan Gallery', address: '부산시', phone: '051-111-2222',
        description: '부산 갤러리', region: 'BUSAN', ownerName: 'Owner',
        status: 'APPROVED', ownerId: 3, rating: 4.5,
      },
    });
  });
  afterAll(async () => {
    await cleanDb();
    await testPrisma.$disconnect();
  });

  // 승인된 갤러리 목록
  it('GET /api/galleries — 승인된 갤러리만 반환', async () => {
    const res = await request.get('/api/galleries');
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(2);
    res.body.forEach((g: any) => expect(g.status).toBe('APPROVED'));
  });

  // 지역 필터
  it('GET /api/galleries?region=SEOUL — 서울 갤러리만 반환', async () => {
    const res = await request.get('/api/galleries?region=SEOUL');
    expect(res.status).toBe(200);
    res.body.forEach((g: any) => expect(g.region).toBe('SEOUL'));
  });

  // 별점 필터
  it('GET /api/galleries?minRating=4 — 4점 이상만', async () => {
    const res = await request.get('/api/galleries?minRating=4');
    expect(res.status).toBe(200);
    res.body.forEach((g: any) => expect(g.rating).toBeGreaterThanOrEqual(4));
  });

  // 상세 조회
  it('GET /api/galleries/:id — 갤러리 상세 반환', async () => {
    const res = await request.get(`/api/galleries/${galleryId}`);
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Test Gallery');
    expect(res.body).toHaveProperty('images');
    expect(res.body).toHaveProperty('reviews');
  });

  // 갤러리 등록 (PENDING 상태)
  it('POST /api/galleries — Gallery 유저가 등록하면 PENDING 상태', async () => {
    const token = authToken(3, 'GALLERY');
    const res = await request.post('/api/galleries').set('Authorization', `Bearer ${token}`).send({
      name: 'New Gallery', address: '서울시 강남구', phone: '02-9999-8888',
      description: '새 갤러리', region: 'SEOUL', ownerName: 'Test Owner',
    });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('PENDING');
  });

  // Artist는 갤러리 등록 불가
  it('POST /api/galleries — Artist 유저 403', async () => {
    const token = authToken(1, 'ARTIST');
    const res = await request.post('/api/galleries').set('Authorization', `Bearer ${token}`).send({
      name: 'Fail', address: 'addr', phone: '000', description: 'desc', region: 'SEOUL', ownerName: 'o',
    });
    expect(res.status).toBe(403);
  });

  // 상세 소개 수정 (owner만)
  it('PATCH /api/galleries/:id/detail — owner만 수정 가능', async () => {
    const token = authToken(3, 'GALLERY');
    const res = await request.patch(`/api/galleries/${galleryId}/detail`)
      .set('Authorization', `Bearer ${token}`)
      .send({ detailDesc: '수정된 상세 소개' });
    expect(res.status).toBe(200);
    expect(res.body.detailDesc).toBe('수정된 상세 소개');
  });

  // Admin 삭제
  it('DELETE /api/galleries/:id — Admin만 삭제 가능', async () => {
    const tempGallery = await testPrisma.gallery.create({
      data: {
        name: 'Delete Me', address: 'addr', phone: '000',
        description: 'desc', region: 'SEOUL', ownerName: 'o', status: 'APPROVED', ownerId: 3,
      },
    });
    const token = authToken(4, 'ADMIN');
    const res = await request.delete(`/api/galleries/${tempGallery.id}`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });
});
