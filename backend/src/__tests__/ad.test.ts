/**
 * 광고 배너 — `routes/ad.ts`
 *  ① 공개 GET 은 활성 배너만 / Admin 만 CRUD
 *  ② 이미지·링크는 우리 저장소·안전 스킴만
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { request, authToken, cleanDb, seedUsers } from './helpers';

const gallery = authToken(3, 'GALLERY');
const admin = authToken(4, 'ADMIN');

describe('광고 배너', () => {
  beforeEach(async () => { await cleanDb(); await seedUsers(); });

  it('Admin 만 만든다', async () => {
    expect((await request.post('/api/ads').send({ imageUrl: '/uploads/a.png' })).status).toBe(401);
    expect((await request.post('/api/ads').set('Authorization', `Bearer ${gallery}`).send({ imageUrl: '/uploads/a.png' })).status).toBe(403);
    expect((await request.post('/api/ads').set('Authorization', `Bearer ${admin}`).send({ imageUrl: '/uploads/a.png', title: '광고', linkUrl: '/community' })).status).toBe(201);
  });

  it('외부 이미지 주소는 400', async () => {
    expect((await request.post('/api/ads').set('Authorization', `Bearer ${admin}`).send({ imageUrl: 'https://evil.com/x.png' })).status).toBe(400);
  });

  it('★ 공개 GET 은 활성 배너만, 위험한 링크는 저장 안 됨', async () => {
    await request.post('/api/ads').set('Authorization', `Bearer ${admin}`).send({ imageUrl: '/uploads/on.png', active: true, position: 1, linkUrl: 'javascript:alert(1)' });
    await request.post('/api/ads').set('Authorization', `Bearer ${admin}`).send({ imageUrl: '/uploads/off.png', active: false, position: 0 });
    const pub = await request.get('/api/ads');
    expect(pub.body.length).toBe(1);
    expect(pub.body[0].imageUrl).toBe('/uploads/on.png');
    expect(pub.body[0].linkUrl).toBe('');       // javascript: 스킴은 걸러졌다
    // Admin 전체는 비활성 포함 2개
    const all = await request.get('/api/ads/all').set('Authorization', `Bearer ${admin}`);
    expect(all.body.length).toBe(2);
  });

  it('수정·삭제는 Admin', async () => {
    const { body } = await request.post('/api/ads').set('Authorization', `Bearer ${admin}`).send({ imageUrl: '/uploads/a.png' });
    expect((await request.patch(`/api/ads/${body.id}`).set('Authorization', `Bearer ${admin}`).send({ active: false })).body.active).toBe(false);
    expect((await request.delete(`/api/ads/${body.id}`).set('Authorization', `Bearer ${gallery}`)).status).toBe(403);
    expect((await request.delete(`/api/ads/${body.id}`).set('Authorization', `Bearer ${admin}`)).status).toBe(200);
  });
});
