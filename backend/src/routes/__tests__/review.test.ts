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

  // 동일 내용 1분 내 재전송 → 기존 리뷰 반환 (idempotency)
  it('POST /api/reviews — 동일 내용 재전송 시 201 + 중복 생성 없음', async () => {
    const token = authToken(1, 'ARTIST');
    const res = await request.post('/api/reviews').set('Authorization', `Bearer ${token}`).send({
      galleryId, rating: 5, content: '훌륭한 갤러리입니다',
    });
    expect(res.status).toBe(201);
    expect(res.body.id).toBe(reviewId); // 기존 리뷰 반환
    const gallery = await testPrisma.gallery.findUnique({ where: { id: galleryId } });
    expect(gallery!.reviewCount).toBe(1); // 리뷰 수 변화 없음
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

  // 같은 유저가 다른 내용으로 추가 리뷰 가능
  it('POST /api/reviews — 다른 내용은 새 리뷰 생성', async () => {
    const token = authToken(1, 'ARTIST');
    const res = await request.post('/api/reviews').set('Authorization', `Bearer ${token}`).send({
      galleryId, rating: 4, content: '두 번째 방문 후기',
    });
    expect(res.status).toBe(201);
    expect(res.body.id).not.toBe(reviewId);
    const gallery = await testPrisma.gallery.findUnique({ where: { id: galleryId } });
    expect(gallery!.reviewCount).toBe(3);
  });

  // 갤러리 리뷰 목록 조회
  it('GET /api/reviews/gallery/:galleryId — 리뷰 목록 반환', async () => {
    const res = await request.get(`/api/reviews/gallery/${galleryId}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(3);
  });

  // 리뷰 수정
  it('PATCH /api/reviews/:id — 작성자가 수정', async () => {
    const token = authToken(1, 'ARTIST');
    const res = await request.patch(`/api/reviews/${reviewId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ rating: 4, content: '수정된 리뷰' });
    expect(res.status).toBe(200);
    expect(res.body.content).toBe('수정된 리뷰');
    // 별점 재계산: (4+3+4)/3 = 3.67
    const gallery = await testPrisma.gallery.findUnique({ where: { id: galleryId } });
    expect(gallery!.rating).toBeCloseTo(3.67, 1);
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
    // 리뷰 2개 남음: Artist2(3) + Artist1 '두 번째 방문 후기'(4)
    expect(gallery!.rating).toBe(3.5);
    expect(gallery!.reviewCount).toBe(2);
  });
});
