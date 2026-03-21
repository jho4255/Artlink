import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { request, testPrisma, authToken, cleanDb, seedUsers, seedGallery } from '../../__tests__/helpers';

describe('Review Routes', () => {
  let galleryId: number;
  let reviewId: number;

  beforeAll(async () => {
    await cleanDb();
    await seedUsers();
    const gallery = await seedGallery();
    galleryId = gallery.id;
  });
  afterAll(async () => {
    await cleanDb();
  });

  // 리뷰 작성 (Artist만)
  it('POST /api/reviews — Artist가 리뷰 작성', async () => {
    const token = authToken(1, 'ARTIST');
    const res = await request.post('/api/reviews').set('Authorization', `Bearer ${token}`).send({
      galleryId, rating: 5, content: '훌륭한 갤러리입니다', anonymous: false,
    });
    expect(res.status).toBe(201);
    expect(res.body.rating).toBe(5);
    reviewId = res.body.id;
  });

  // 별점 자동 재계산 확인
  it('리뷰 작성 후 갤러리 rating이 정확히 재계산됨', async () => {
    const gallery = await testPrisma.gallery.findUnique({ where: { id: galleryId } });
    expect(gallery!.rating).toBe(5);
    expect(gallery!.reviewCount).toBe(1);
  });

  // 두 번째 리뷰로 평균 변화 확인
  it('두 번째 리뷰 추가 후 평균 별점 변화', async () => {
    const token = authToken(2, 'ARTIST');
    await request.post('/api/reviews').set('Authorization', `Bearer ${token}`).send({
      galleryId, rating: 3, content: '보통이에요', anonymous: true,
    });
    const gallery = await testPrisma.gallery.findUnique({ where: { id: galleryId } });
    expect(gallery!.rating).toBe(4); // (5+3)/2 = 4
    expect(gallery!.reviewCount).toBe(2);
  });

  // 갤러리 리뷰 목록 조회
  it('GET /api/reviews/gallery/:galleryId — 리뷰 목록 반환', async () => {
    const res = await request.get(`/api/reviews/gallery/${galleryId}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2);
  });

  // 리뷰 수정
  it('PATCH /api/reviews/:id — 작성자가 수정', async () => {
    const token = authToken(1, 'ARTIST');
    const res = await request.patch(`/api/reviews/${reviewId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ rating: 4, content: '수정된 리뷰' });
    expect(res.status).toBe(200);
    expect(res.body.content).toBe('수정된 리뷰');
    // 별점 재계산: (4+3)/2 = 3.5
    const gallery = await testPrisma.gallery.findUnique({ where: { id: galleryId } });
    expect(gallery!.rating).toBe(3.5);
  });

  // 같은 유저가 같은 갤러리에 중복 리뷰 작성 불가
  it('POST /api/reviews — 중복 리뷰 400', async () => {
    const token = authToken(1, 'ARTIST');
    const res = await request.post('/api/reviews').set('Authorization', `Bearer ${token}`).send({
      galleryId, rating: 4, content: '중복 리뷰 시도',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('이미');
  });

  // Gallery 유저는 리뷰 작성 불가
  it('POST /api/reviews — Gallery 유저 403', async () => {
    const token = authToken(3, 'GALLERY');
    const res = await request.post('/api/reviews').set('Authorization', `Bearer ${token}`).send({
      galleryId, rating: 5, content: 'fail',
    });
    expect(res.status).toBe(403);
  });

  // Admin이 삭제
  it('DELETE /api/reviews/:id — Admin 삭제 + 별점 재계산', async () => {
    const token = authToken(4, 'ADMIN');
    const res = await request.delete(`/api/reviews/${reviewId}`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const gallery = await testPrisma.gallery.findUnique({ where: { id: galleryId } });
    // 리뷰 1개(rating 3)만 남음
    expect(gallery!.rating).toBe(3);
    expect(gallery!.reviewCount).toBe(1);
  });
});
