import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { request, testPrisma, authToken, cleanDb, seedUsers } from '../../__tests__/helpers';

describe('Hero Slide Routes', () => {
  let slideId: number;

  beforeAll(async () => {
    await cleanDb();
    await seedUsers();
  });
  afterAll(async () => {
    await cleanDb();
    await testPrisma.$disconnect();
  });

  it('POST /api/hero-slides — Admin이 슬라이드 생성', async () => {
    const token = authToken(4, 'ADMIN');
    const res = await request.post('/api/hero-slides').set('Authorization', `Bearer ${token}`).send({
      title: 'Hero 1', imageUrl: '/img/hero.jpg', linkUrl: '/galleries', order: 0,
    });
    expect(res.status).toBe(201);
    slideId = res.body.id;
  });

  it('GET /api/hero-slides — 슬라이드 목록', async () => {
    const res = await request.get('/api/hero-slides');
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
  });

  it('PATCH /api/hero-slides/:id — Admin이 수정', async () => {
    const token = authToken(4, 'ADMIN');
    const res = await request.patch(`/api/hero-slides/${slideId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Updated Hero' });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Updated Hero');
  });

  it('DELETE /api/hero-slides/:id — Admin이 삭제', async () => {
    const token = authToken(4, 'ADMIN');
    const res = await request.delete(`/api/hero-slides/${slideId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });
});
