import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { request, testPrisma, authToken, cleanDb, seedUsers, seedGallery, seedExhibition } from '../../__tests__/helpers';

describe('Favorite Routes', () => {
  let galleryId: number;
  let exhibitionId: number;

  beforeAll(async () => {
    await cleanDb();
    await seedUsers();
    const gallery = await seedGallery();
    galleryId = gallery.id;
    const exhibition = await seedExhibition(galleryId);
    exhibitionId = exhibition.id;
  });
  afterAll(async () => {
    await cleanDb();
  });

  // 갤러리 찜 토글 (생성)
  it('POST /api/favorites/toggle — 갤러리 찜 추가', async () => {
    const token = authToken(1, 'ARTIST');
    const res = await request.post('/api/favorites/toggle')
      .set('Authorization', `Bearer ${token}`)
      .send({ galleryId });
    expect(res.status).toBe(200);
    expect(res.body.favorited).toBe(true);
  });

  // 갤러리 찜 토글 (삭제)
  it('POST /api/favorites/toggle — 갤러리 찜 취소', async () => {
    const token = authToken(1, 'ARTIST');
    const res = await request.post('/api/favorites/toggle')
      .set('Authorization', `Bearer ${token}`)
      .send({ galleryId });
    expect(res.status).toBe(200);
    expect(res.body.favorited).toBe(false);
  });

  // 공모 찜 토글
  it('POST /api/favorites/toggle — 공모 찜 추가/삭제', async () => {
    const token = authToken(1, 'ARTIST');
    const res1 = await request.post('/api/favorites/toggle')
      .set('Authorization', `Bearer ${token}`)
      .send({ exhibitionId });
    expect(res1.body.favorited).toBe(true);

    const res2 = await request.post('/api/favorites/toggle')
      .set('Authorization', `Bearer ${token}`)
      .send({ exhibitionId });
    expect(res2.body.favorited).toBe(false);
  });

  // 찜 목록 조회 — 응답: flat array of favorites with gallery/exhibition includes
  it('GET /api/favorites — 찜 목록 반환', async () => {
    const token = authToken(1, 'ARTIST');
    // 찜 하나 추가
    await request.post('/api/favorites/toggle').set('Authorization', `Bearer ${token}`).send({ galleryId });

    const res = await request.get('/api/favorites').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    // 갤러리 찜 항목에 gallery 정보 포함
    const galleryFav = res.body.find((f: any) => f.galleryId);
    expect(galleryFav).toBeDefined();
    expect(galleryFav.gallery).toHaveProperty('name');
  });

  // 비인증 시 401
  it('POST /api/favorites/toggle — 비인증 401', async () => {
    const res = await request.post('/api/favorites/toggle').send({ galleryId });
    expect(res.status).toBe(401);
  });
});
