import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { request, testPrisma, authToken, cleanDb, seedUsers, seedGallery } from '../../__tests__/helpers';

describe('Review Routes', () => {
  let galleryId: number;
  let reviewId: number;
  let exhId1: number; // artist1 (userId=1) 용 ACCEPTED 공모
  let exhId2: number; // artist2 (userId=2) 용 ACCEPTED 공모
  let exhId3: number; // artist1 (userId=1) 용 두 번째 ACCEPTED 공모

  beforeAll(async () => {
    await cleanDb();
    await seedUsers();
    const gallery = await seedGallery();
    galleryId = gallery.id;

    // 공모 3개 생성 + ACCEPTED 지원
    const ex1 = await testPrisma.exhibition.create({
      data: {
        title: '리뷰공모1', type: 'SOLO', deadline: new Date('2099-12-31'),
        exhibitDate: new Date('2099-12-31'), capacity: 5, region: 'SEOUL',
        description: 'desc', status: 'APPROVED', galleryId,
      },
    });
    exhId1 = ex1.id;
    await testPrisma.application.create({ data: { userId: 1, exhibitionId: exhId1, status: 'ACCEPTED' } });

    const ex2 = await testPrisma.exhibition.create({
      data: {
        title: '리뷰공모2', type: 'SOLO', deadline: new Date('2099-12-31'),
        exhibitDate: new Date('2099-12-31'), capacity: 5, region: 'SEOUL',
        description: 'desc', status: 'APPROVED', galleryId,
      },
    });
    exhId2 = ex2.id;
    await testPrisma.application.create({ data: { userId: 2, exhibitionId: exhId2, status: 'ACCEPTED' } });

    const ex3 = await testPrisma.exhibition.create({
      data: {
        title: '리뷰공모3', type: 'SOLO', deadline: new Date('2099-12-31'),
        exhibitDate: new Date('2099-12-31'), capacity: 5, region: 'SEOUL',
        description: 'desc', status: 'APPROVED', galleryId,
      },
    });
    exhId3 = ex3.id;
    await testPrisma.application.create({ data: { userId: 1, exhibitionId: exhId3, status: 'ACCEPTED' } });
  });
  afterAll(async () => {
    await cleanDb();
  });

  // 리뷰 작성 (Artist만)
  it('POST /api/reviews — Artist가 리뷰 작성', async () => {
    const token = authToken(1, 'ARTIST');
    const res = await request.post('/api/reviews').set('Authorization', `Bearer ${token}`).send({
      galleryId, exhibitionId: exhId1, rating: 5, content: '훌륭한 갤러리입니다', anonymous: false,
    });
    expect(res.status).toBe(201);
    // ⚠️ 별점은 2026-09-10 에 없앴다 — 보내와도 저장하지 않는다
    expect(res.body.rating).toBeNull();
    reviewId = res.body.id;
  });

  // 리뷰 개수 자동 재계산 확인 (별점 평균은 더 이상 갱신하지 않는다)
  it('★ 리뷰 작성 후 갤러리 리뷰 개수가 재계산됨', async () => {
    const gallery = await testPrisma.gallery.findUnique({ where: { id: galleryId } });
    expect(gallery!.reviewCount).toBe(1);
  });

  // 동일 공모에 대한 중복 리뷰 → 409
  it('POST /api/reviews — 동일 공모 중복 리뷰 시 409', async () => {
    const token = authToken(1, 'ARTIST');
    const res = await request.post('/api/reviews').set('Authorization', `Bearer ${token}`).send({
      galleryId, exhibitionId: exhId1, rating: 5, content: '다른 내용이지만 같은 공모',
    });
    expect(res.status).toBe(409);
    const gallery = await testPrisma.gallery.findUnique({ where: { id: galleryId } });
    expect(gallery!.reviewCount).toBe(1); // 리뷰 수 변화 없음
  });

  // 두 번째 리뷰로 개수 변화 확인 (다른 공모)
  it('★ 두 번째 리뷰 추가 후 리뷰 개수 변화', async () => {
    const token = authToken(2, 'ARTIST');
    await request.post('/api/reviews').set('Authorization', `Bearer ${token}`).send({
      galleryId, exhibitionId: exhId2, rating: 3, content: '보통이에요', anonymous: true,
    });
    const gallery = await testPrisma.gallery.findUnique({ where: { id: galleryId } });
    expect(gallery!.reviewCount).toBe(2);
  });

  // 같은 유저가 다른 공모로 추가 리뷰 가능
  it('POST /api/reviews — 다른 공모 리뷰는 새 리뷰 생성', async () => {
    const token = authToken(1, 'ARTIST');
    const res = await request.post('/api/reviews').set('Authorization', `Bearer ${token}`).send({
      galleryId, exhibitionId: exhId3, rating: 4, content: '두 번째 방문 후기',
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
    // exhibition 정보 포함 확인
    expect(res.body[0]).toHaveProperty('exhibition');
  });

  // 리뷰 수정
  it('PATCH /api/reviews/:id — 작성자가 수정', async () => {
    const token = authToken(1, 'ARTIST');
    const res = await request.patch(`/api/reviews/${reviewId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ rating: 4, content: '수정된 리뷰' });
    expect(res.status).toBe(200);
    expect(res.body.content).toBe('수정된 리뷰');
    // ⚠️ 별점을 실어 보내도 저장되지 않는다. 개수도 수정으로는 변하지 않는다.
    expect(res.body.rating).toBeNull();
    const gallery = await testPrisma.gallery.findUnique({ where: { id: galleryId } });
    expect(gallery!.reviewCount).toBe(3);
  });

  // Gallery 유저는 리뷰 작성 불가
  it('POST /api/reviews — Gallery 유저 403', async () => {
    const token = authToken(3, 'GALLERY');
    const res = await request.post('/api/reviews').set('Authorization', `Bearer ${token}`).send({
      galleryId, exhibitionId: exhId1, rating: 5, content: 'fail',
    });
    expect(res.status).toBe(403);
  });

  // Admin이 삭제
  it('★ DELETE /api/reviews/:id — Admin 삭제 + 리뷰 개수 재계산', async () => {
    const token = authToken(4, 'ADMIN');
    const res = await request.delete(`/api/reviews/${reviewId}`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const gallery = await testPrisma.gallery.findUnique({ where: { id: galleryId } });
    // 리뷰 2개 남음: Artist2 + Artist1 '두 번째 방문 후기'
    expect(gallery!.reviewCount).toBe(2);
  });
});
