/**
 * 관람객(VISITOR) 역할 (2026-09-16, 사용자 결정) — 찜·좋아요·이웃·메시지·소식은 되고, 지원·등록·리뷰는 안 된다.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { request, testPrisma, cleanDb, seedUsers, seedGallery, seedExhibition } from './helpers';

describe('VISITOR 역할', () => {
  let token = '', visitorId = 0, galleryId = 0, exhibitionId = 0, imageId = 0;

  beforeAll(async () => {
    await cleanDb();
    await seedUsers();
    galleryId = (await seedGallery(3)).id;
    exhibitionId = (await seedExhibition(galleryId)).id;
    const pf = await testPrisma.portfolio.create({ data: { userId: 1, biography: 'b' } });
    imageId = (await testPrisma.portfolioImage.create({ data: { portfolioId: pf.id, url: '/uploads/v1.jpg', order: 0, showInExplore: true } })).id;
    const res = await request.post('/api/auth/signup').send({
      name: '관람객', email: 'visitor@test.com', password: 'Passw0rd!', role: 'VISITOR', agreeTerms: true, agreePrivacy: true,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    token = res.body.token;
    visitorId = res.body.user.id;
    expect(res.body.user.role).toBe('VISITOR');
  });
  afterAll(async () => { await cleanDb(); });

  const auth = () => ({ Authorization: `Bearer ${token}` });

  it('GET /auth/me 가 VISITOR 를 돌려준다', async () => {
    const res = await request.get('/api/auth/me').set(auth());
    expect(res.body.user.role).toBe('VISITOR');
  });

  it('할 수 있는 것: 1:1 문의 (2026-09-19 — 화이트리스트에서 빠져 화면엔 폼이 보이는데 제출하면 403 이었다)', async () => {
    const res = await request.post('/api/inquiries').set(auth()).send({ subject: '문의', content: '내용입니다' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  });

  it('할 수 있는 것: 찜 · 작품 좋아요 · 이웃 · 갠톡 · 방명록', async () => {
    expect((await request.post('/api/favorites/toggle').set(auth()).send({ galleryId })).status).toBe(200);
    expect((await request.post(`/api/explore/${imageId}/like`).set(auth())).status).toBe(200);
    expect([200, 201]).toContain((await request.post('/api/follow/1').set(auth())).status);
    expect([200, 201]).toContain((await request.post('/api/chats/direct').set(auth()).send({ userId: 1 })).status);
    expect([200, 201]).toContain((await request.post('/api/guestbook/1').set(auth()).send({ body: '응원합니다' })).status);
  });

  it('할 수 없는 것: 공모 지원 · 갤러리 등록 · 리뷰 · 작품 등록', async () => {
    expect((await request.post(`/api/exhibitions/${exhibitionId}/apply`).set(auth()).send({})).status).toBe(403);
    expect((await request.post('/api/galleries').set(auth()).send({ name: 'x' })).status).toBe(403);
    expect((await request.post('/api/reviews').set(auth()).send({ galleryId, exhibitionId, content: 'x' })).status).toBe(403);
    expect((await request.post('/api/portfolio/images').set(auth()).send({ url: '/uploads/x.jpg' })).status).toBe(403);
  });

  it('관람객의 포트폴리오 페이지는 없다(404) — 작가만 홈페이지가 있다', async () => {
    expect((await request.get(`/api/portfolio/${visitorId}`)).status).toBe(404);
  });

  it('모르는 역할은 가입 400', async () => {
    const res = await request.post('/api/auth/signup').send({ name: 'x', email: 'x@test.com', password: 'Passw0rd!', role: 'COLLECTOR', agreeTerms: true, agreePrivacy: true });
    expect(res.status).toBe(400);
  });
});
