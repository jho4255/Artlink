import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { request, testPrisma, authToken, cleanDb, seedUsers } from '../../__tests__/helpers';

describe('Benefit Routes', () => {
  let benefitId: number;

  beforeAll(async () => {
    await cleanDb();
    await seedUsers();
  });
  afterAll(async () => {
    await cleanDb();
  });

  it('POST /api/benefits — Admin이 혜택 생성', async () => {
    const token = authToken(4, 'ADMIN');
    const res = await request.post('/api/benefits').set('Authorization', `Bearer ${token}`).send({
      title: 'Benefit 1', description: '혜택 설명',
    });
    expect(res.status).toBe(201);
    benefitId = res.body.id;
  });

  it('GET /api/benefits — 혜택 목록', async () => {
    const res = await request.get('/api/benefits');
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
  });

  it('PATCH /api/benefits/:id — Admin이 수정', async () => {
    const token = authToken(4, 'ADMIN');
    const res = await request.patch(`/api/benefits/${benefitId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Updated Benefit' });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Updated Benefit');
  });

  it('DELETE /api/benefits/:id — Admin이 삭제', async () => {
    const token = authToken(4, 'ADMIN');
    const res = await request.delete(`/api/benefits/${benefitId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });
});
