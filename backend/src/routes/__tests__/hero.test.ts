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

  // 모바일 전용 이미지(2026-09-16): 선택 항목. 빈 문자열은 '지움'.
  it('PATCH — 모바일 이미지를 붙이고 뗄 수 있다', async () => {
    const token = authToken(4, 'ADMIN');
    const set = await request.patch(`/api/hero-slides/${slideId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ mobileImageUrl: '/img/hero-mobile.jpg' });
    expect(set.status).toBe(200);
    expect(set.body.mobileImageUrl).toBe('/img/hero-mobile.jpg');

    const list = await request.get('/api/hero-slides');
    expect(list.body.find((s: any) => s.id === slideId).mobileImageUrl).toBe('/img/hero-mobile.jpg');

    const clear = await request.patch(`/api/hero-slides/${slideId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ mobileImageUrl: '' });
    expect(clear.status).toBe(200);
    expect(clear.body.mobileImageUrl).toBeNull();
  });

  it('POST — 모바일 이미지 없이 만들면 null', async () => {
    const token = authToken(4, 'ADMIN');
    const res = await request.post('/api/hero-slides').set('Authorization', `Bearer ${token}`).send({
      title: 'Hero 2', imageUrl: '/img/hero2.jpg', order: 1,
    });
    expect(res.status).toBe(201);
    expect(res.body.mobileImageUrl).toBeNull();
    const row = await testPrisma.heroSlide.findUnique({ where: { id: res.body.id } });
    expect(row?.mobileImageUrl).toBeNull();
  });

  it('DELETE /api/hero-slides/:id — Admin이 삭제', async () => {
    const token = authToken(4, 'ADMIN');
    const res = await request.delete(`/api/hero-slides/${slideId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });
});
