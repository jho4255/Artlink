/**
 * 갤러리 이미지 삭제 API 테스트
 *
 * DELETE /api/galleries/:id/images/:imageId
 * - 오너: 204 성공
 * - 비오너: 403
 * - 미인증: 401
 * - 없는 이미지: 404
 * - 삭제 후 GET 상세에서 미포함 확인
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { request, testPrisma, authToken, cleanDb, seedUsers, seedGallery } from './helpers';

describe('Gallery Image Delete API', () => {
  let galleryId: number;
  let imageId: number;
  const ownerToken = authToken(3, 'GALLERY');   // Gallery Owner (id=3)
  const artistToken = authToken(1, 'ARTIST');   // Artist (id=1)

  beforeAll(async () => {
    await testPrisma.$connect();
  });

  afterAll(async () => {
    await cleanDb();
    await testPrisma.$disconnect();
  });

  beforeEach(async () => {
    await cleanDb();
    await seedUsers();
    const gallery = await seedGallery(3);
    galleryId = gallery.id;

    const image = await testPrisma.galleryImage.create({
      data: { url: 'https://example.com/test.jpg', order: 0, galleryId },
    });
    imageId = image.id;
  });

  it('오너가 이미지를 삭제할 수 있다 (204)', async () => {
    const res = await request
      .delete(`/api/galleries/${galleryId}/images/${imageId}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(204);

    // DB에서 삭제 확인
    const deleted = await testPrisma.galleryImage.findUnique({ where: { id: imageId } });
    expect(deleted).toBeNull();
  });

  it('비오너는 403 반환', async () => {
    const res = await request
      .delete(`/api/galleries/${galleryId}/images/${imageId}`)
      .set('Authorization', `Bearer ${artistToken}`);
    expect(res.status).toBe(403);
  });

  it('미인증은 401 반환', async () => {
    const res = await request
      .delete(`/api/galleries/${galleryId}/images/${imageId}`);
    expect(res.status).toBe(401);
  });

  it('없는 이미지는 404 반환', async () => {
    const res = await request
      .delete(`/api/galleries/${galleryId}/images/99999`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(404);
  });

  it('다른 갤러리 이미지는 404 반환', async () => {
    // 두 번째 갤러리 생성 (다른 오너)
    const otherGallery = await testPrisma.gallery.create({
      data: {
        name: 'Other Gallery', address: '부산', phone: '051-1111-2222',
        description: '다른 갤러리', region: 'BUSAN', ownerName: 'Other',
        status: 'APPROVED', ownerId: 3,
      },
    });
    // 이미지가 다른 갤러리 소속이면 404
    const res = await request
      .delete(`/api/galleries/${otherGallery.id}/images/${imageId}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(404);
  });

  it('삭제 후 GET 상세에서 해당 이미지 미포함', async () => {
    // 두 번째 이미지 추가
    await testPrisma.galleryImage.create({
      data: { url: 'https://example.com/test2.jpg', order: 1, galleryId },
    });

    // 첫 번째 이미지 삭제
    await request
      .delete(`/api/galleries/${galleryId}/images/${imageId}`)
      .set('Authorization', `Bearer ${ownerToken}`);

    // GET 상세 조회
    const res = await request.get(`/api/galleries/${galleryId}`);
    expect(res.status).toBe(200);
    const imageIds = res.body.images.map((img: any) => img.id);
    expect(imageIds).not.toContain(imageId);
    expect(imageIds).toHaveLength(1);
  });
});
