import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { request, testPrisma, authToken, cleanDb, seedUsers, seedGallery, seedExhibition } from '../../__tests__/helpers';

describe('Exhibition Routes', () => {
  let galleryId: number;
  let exhibitionId: number;

  beforeAll(async () => {
    await cleanDb();
    await seedUsers();
    const gallery = await seedGallery();
    galleryId = gallery.id;
    const exhibition = await seedExhibition(galleryId);
    exhibitionId = exhibition.id;
    // 마감된 공모 (노출되지 않아야 함)
    await testPrisma.exhibition.create({
      data: {
        title: 'Expired Exhibition', type: 'GROUP',
        deadline: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
        exhibitDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        capacity: 3, region: 'BUSAN', description: '마감됨',
        status: 'APPROVED', galleryId,
      },
    });
  });
  afterAll(async () => {
    await cleanDb();
  });

  // D-day 남은 공모만 노출
  it('GET /api/exhibitions — 마감 전 공모만 반환', async () => {
    const res = await request.get('/api/exhibitions');
    expect(res.status).toBe(200);
    res.body.forEach((e: any) => {
      expect(new Date(e.deadline).getTime()).toBeGreaterThan(Date.now());
    });
  });

  // 상세 조회
  it('GET /api/exhibitions/:id — 상세 반환', async () => {
    const res = await request.get(`/api/exhibitions/${exhibitionId}`);
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Test Exhibition');
  });

  // 공모 등록 (Gallery 유저, PENDING)
  it('POST /api/exhibitions — Gallery 유저가 등록 시 PENDING', async () => {
    const token = authToken(3, 'GALLERY');
    const res = await request.post('/api/exhibitions').set('Authorization', `Bearer ${token}`).send({
      galleryId, title: 'New Exhibition', type: 'SOLO',
      deadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      exhibitDate: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(),
      capacity: 10, region: 'SEOUL', description: '새 공모',
    });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('PENDING');
  });

  // 지원하기 (Artist)
  it('POST /api/exhibitions/:id/apply — Artist 지원', async () => {
    const token = authToken(1, 'ARTIST');
    const res = await request.post(`/api/exhibitions/${exhibitionId}/apply`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
  });

  // 중복 지원 차단
  it('POST /api/exhibitions/:id/apply — 중복 지원 차단', async () => {
    const token = authToken(1, 'ARTIST');
    const res = await request.post(`/api/exhibitions/${exhibitionId}/apply`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  // 삭제 (owner 또는 Admin)
  it('DELETE /api/exhibitions/:id — owner가 삭제 가능', async () => {
    const temp = await testPrisma.exhibition.create({
      data: {
        title: 'To Delete', type: 'SOLO',
        deadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        exhibitDate: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
        capacity: 5, region: 'SEOUL', description: '삭제용',
        status: 'APPROVED', galleryId,
      },
    });
    const token = authToken(3, 'GALLERY');
    const res = await request.delete(`/api/exhibitions/${temp.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });
});
