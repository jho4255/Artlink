/**
 * 보안 회귀 테스트 — PII/비밀 노출 및 IDOR 차단 검증
 *  1) Instagram 액세스 토큰이 공개 엔드포인트(전시/공모/이달의갤러리 상세)에 노출되지 않음
 *  2) 포트폴리오 이미지 삭제는 본인 것만 (타인 이미지 삭제 IDOR 차단)
 *  3) 전시 사진 삭제는 해당 전시 소속 이미지만 (다른 전시 이미지 삭제 IDOR 차단)
 *  4) 익명 리뷰의 작성자 신원은 본인/관리자 외에는 마스킹
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { request, testPrisma, authToken, cleanDb, seedUsers, seedGallery, seedShow, seedExhibition } from '../../__tests__/helpers';

const SECRET = 'IG_SECRET_TOKEN_should_never_leak';

describe('Security — PII/secret exposure & IDOR', () => {
  let galleryId: number;

  beforeAll(async () => {
    await cleanDb();
    await seedUsers();
    const gallery = await seedGallery(3);
    galleryId = gallery.id;
    // Instagram 토큰 + 프로필 공개 설정
    await testPrisma.gallery.update({
      where: { id: galleryId },
      data: { instagramAccessToken: SECRET, instagramProfileVisible: true, instagramUrl: '@testgallery' },
    });
  });
  afterAll(async () => { await cleanDb(); });

  // ===== 1) Instagram 토큰 비노출 =====
  it('GET /api/shows/:id — instagramAccessToken 미노출, instagramConnected만', async () => {
    const show = await seedShow(galleryId);
    const res = await request.get(`/api/shows/${show.id}`);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain(SECRET);
    expect(res.body.gallery).not.toHaveProperty('instagramAccessToken');
    expect(res.body.gallery.instagramConnected).toBe(true);
  });

  it('GET /api/exhibitions/:id — instagramAccessToken 미노출', async () => {
    const ex = await seedExhibition(galleryId);
    const res = await request.get(`/api/exhibitions/${ex.id}`);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain(SECRET);
    expect(res.body.gallery).not.toHaveProperty('instagramAccessToken');
  });

  it('GET /api/gallery-of-month — instagramAccessToken 미노출', async () => {
    await testPrisma.galleryOfMonth.create({
      data: { galleryId, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), title: '이달' },
    });
    const res = await request.get('/api/gallery-of-month');
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain(SECRET);
    expect(res.body[0].gallery).not.toHaveProperty('instagramAccessToken');
  });

  // ===== 2) 포트폴리오 이미지 삭제 IDOR =====
  it('DELETE /api/portfolio/images/:id — 타인 이미지 삭제 불가(404), 이미지 보존', async () => {
    const pf = await testPrisma.portfolio.create({ data: { userId: 1 } });
    const img = await testPrisma.portfolioImage.create({ data: { url: 'x.jpg', portfolioId: pf.id, order: 0 } });

    // artist2(다른 작가)가 artist1의 이미지 삭제 시도
    const res = await request.delete(`/api/portfolio/images/${img.id}`)
      .set('Authorization', `Bearer ${authToken(2, 'ARTIST')}`);
    expect(res.status).toBe(404);
    expect(await testPrisma.portfolioImage.findUnique({ where: { id: img.id } })).not.toBeNull();

    // 본인은 삭제 가능
    const ok = await request.delete(`/api/portfolio/images/${img.id}`)
      .set('Authorization', `Bearer ${authToken(1, 'ARTIST')}`);
    expect(ok.status).toBe(200);
    expect(await testPrisma.portfolioImage.findUnique({ where: { id: img.id } })).toBeNull();
  });

  // ===== 3) 전시 사진 삭제 cross-object IDOR =====
  it('DELETE /api/shows/:id/images/:imageId — 다른 전시 이미지 삭제 불가(404)', async () => {
    const showA = await seedShow(galleryId);
    const showB = await seedShow(galleryId);
    const imgB = await testPrisma.showImage.create({ data: { url: 'b.jpg', order: 0, showId: showB.id } });

    // showA의 id로 showB의 이미지 삭제 시도 (소유자이지만 다른 전시)
    const res = await request.delete(`/api/shows/${showA.id}/images/${imgB.id}`)
      .set('Authorization', `Bearer ${authToken(3, 'GALLERY')}`);
    expect(res.status).toBe(404);
    expect(await testPrisma.showImage.findUnique({ where: { id: imgB.id } })).not.toBeNull();

    // 올바른 전시(showB)로는 삭제 가능
    const ok = await request.delete(`/api/shows/${showB.id}/images/${imgB.id}`)
      .set('Authorization', `Bearer ${authToken(3, 'GALLERY')}`);
    expect(ok.status).toBe(200);
  });

  // ===== 4) 익명 리뷰 신원 마스킹 =====
  it('GET /api/reviews/gallery/:id — 익명 리뷰는 제3자에게 user/userId 마스킹', async () => {
    const ex = await seedExhibition(galleryId);
    await testPrisma.review.create({
      data: { userId: 1, galleryId, exhibitionId: ex.id, rating: 5, content: '익명후기', anonymous: true },
    });
    await testPrisma.review.create({
      data: { userId: 2, galleryId, exhibitionId: ex.id, rating: 4, content: '실명후기', anonymous: false },
    });

    // 비로그인 제3자
    const pub = await request.get(`/api/reviews/gallery/${galleryId}`);
    expect(pub.status).toBe(200);
    const anon = pub.body.find((r: any) => r.content === '익명후기');
    const named = pub.body.find((r: any) => r.content === '실명후기');
    expect(anon.user).toBeNull();
    expect(anon.userId).toBeNull();
    expect(named.user).not.toBeNull();          // 실명 리뷰는 그대로

    // 작성자 본인은 익명 리뷰의 신원 확인 가능
    const mine = await request.get(`/api/reviews/gallery/${galleryId}`)
      .set('Authorization', `Bearer ${authToken(1, 'ARTIST')}`);
    const anonSelf = mine.body.find((r: any) => r.content === '익명후기');
    expect(anonSelf.userId).toBe(1);
    expect(anonSelf.user).not.toBeNull();

    // 관리자도 확인 가능
    const adm = await request.get(`/api/reviews/gallery/${galleryId}`)
      .set('Authorization', `Bearer ${authToken(4, 'ADMIN')}`);
    const anonAdmin = adm.body.find((r: any) => r.content === '익명후기');
    expect(anonAdmin.user).not.toBeNull();
  });
});
