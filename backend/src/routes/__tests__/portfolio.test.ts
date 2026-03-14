import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { request, testPrisma, authToken, cleanDb, seedUsers } from '../../__tests__/helpers';

describe('Portfolio Routes', () => {
  beforeAll(async () => {
    await cleanDb();
    await seedUsers();
  });
  afterAll(async () => {
    await cleanDb();
  });

  // 포트폴리오 자동 생성
  it('GET /api/portfolio — Artist 첫 조회 시 자동 생성', async () => {
    const token = authToken(1, 'ARTIST');
    const res = await request.get('/api/portfolio').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('biography');
    expect(res.body).toHaveProperty('images');
  });

  // 포트폴리오 수정
  it('PUT /api/portfolio — 약력 수정', async () => {
    const token = authToken(1, 'ARTIST');
    const res = await request.put('/api/portfolio').set('Authorization', `Bearer ${token}`).send({
      biography: '현대미술 작가', exhibitionHistory: '2024 개인전',
    });
    expect(res.status).toBe(200);
    expect(res.body.biography).toBe('현대미술 작가');
  });

  // 이미지 추가
  it('POST /api/portfolio/images — 이미지 URL 추가', async () => {
    const token = authToken(1, 'ARTIST');
    const res = await request.post('/api/portfolio/images')
      .set('Authorization', `Bearer ${token}`)
      .send({ url: '/uploads/test.jpg' });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
  });

  // 이미지 삭제
  it('DELETE /api/portfolio/images/:imageId — 이미지 삭제', async () => {
    const token = authToken(1, 'ARTIST');
    // 먼저 이미지 조회
    const portfolio = await request.get('/api/portfolio').set('Authorization', `Bearer ${token}`);
    const imageId = portfolio.body.images[0]?.id;
    if (imageId) {
      const res = await request.delete(`/api/portfolio/images/${imageId}`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
    }
  });
});
