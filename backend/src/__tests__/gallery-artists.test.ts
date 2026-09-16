/**
 * 갤러리 페이지 '함께한 작가' — 수락된 작가 자동 집계 · 숨기기 (2026-09-16)
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { request, testPrisma, authToken, cleanDb, seedUsers, seedGallery, seedExhibition } from './helpers';

describe('GET /api/galleries/:id — artists', () => {
  let galleryId = 0, ex1 = 0, ex2 = 0;

  beforeAll(async () => {
    await cleanDb();
    await seedUsers();                       // 1·2 작가, 3 갤러리 주인, 4 Admin
    const g = await seedGallery(3);
    galleryId = g.id;
    ex1 = (await seedExhibition(galleryId)).id;
    ex2 = (await seedExhibition(galleryId)).id;
    // 작가 1: 두 공모에 모두 수락(중복 제거 확인), 포트폴리오 첫 작품이 커버
    const pf = await testPrisma.portfolio.create({ data: { userId: 1, biography: 'b' } });
    await testPrisma.portfolioImage.create({ data: { portfolioId: pf.id, url: '/uploads/a1.jpg', order: 0, width: 800, height: 1000 } });
    await testPrisma.application.create({ data: { userId: 1, exhibitionId: ex1, status: 'ACCEPTED' } });
    await testPrisma.application.create({ data: { userId: 1, exhibitionId: ex2, status: 'ACCEPTED' } });
    // 작가 2: 지원만 했다(SUBMITTED) → 안 나온다
    await testPrisma.application.create({ data: { userId: 2, exhibitionId: ex1, status: 'SUBMITTED' } });
  });
  afterAll(async () => { await cleanDb(); });
  beforeEach(async () => {
    await testPrisma.gallery.update({ where: { id: galleryId }, data: { hiddenArtistIds: [] } });
  });

  it('수락된 작가만, 한 번씩, 커버 작품과 함께', async () => {
    const res = await request.get(`/api/galleries/${galleryId}`);
    expect(res.status).toBe(200);
    expect(res.body.artists.map((a: any) => a.id)).toEqual([1]);
    expect(res.body.artists[0]).toMatchObject({ id: 1, hidden: false, cover: { url: '/uploads/a1.jpg', width: 800, height: 1000 } });
    // 내부 설정은 응답에 없다
    expect(res.body.hiddenArtistIds).toBeUndefined();
  });

  it('수락 뒤 탈퇴한 작가는 뺀다', async () => {
    await testPrisma.user.update({ where: { id: 1 }, data: { deletedAt: new Date() } });
    const res = await request.get(`/api/galleries/${galleryId}`);
    expect(res.body.artists).toEqual([]);
    await testPrisma.user.update({ where: { id: 1 }, data: { deletedAt: null } });
  });

  it('숨기기 — 주인만 · 공개 응답에서 빠지고 주인에겐 hidden:true 로 남는다', async () => {
    const owner = authToken(3, 'GALLERY'), other = authToken(2, 'ARTIST'), admin = authToken(4, 'ADMIN');
    expect((await request.patch(`/api/galleries/${galleryId}/artists/1`).set('Authorization', `Bearer ${other}`).send({ hidden: true })).status).toBe(403);
    const hide = await request.patch(`/api/galleries/${galleryId}/artists/1`).set('Authorization', `Bearer ${owner}`).send({ hidden: true });
    expect(hide.status).toBe(200);
    expect(hide.body).toEqual({ artistId: 1, hidden: true });

    const pub = await request.get(`/api/galleries/${galleryId}`);
    expect(pub.body.artists).toEqual([]);
    const mine = await request.get(`/api/galleries/${galleryId}`).set('Authorization', `Bearer ${owner}`);
    expect(mine.body.artists[0]).toMatchObject({ id: 1, hidden: true });
    const adminView = await request.get(`/api/galleries/${galleryId}`).set('Authorization', `Bearer ${admin}`);
    expect(adminView.body.artists[0]).toMatchObject({ id: 1, hidden: true });

    // 되돌리기 (Admin 도 된다)
    const show = await request.patch(`/api/galleries/${galleryId}/artists/1`).set('Authorization', `Bearer ${admin}`).send({ hidden: false });
    expect(show.status).toBe(200);
    expect((await request.get(`/api/galleries/${galleryId}`)).body.artists.map((a: any) => a.id)).toEqual([1]);
  });

  it('없는 갤러리·이상한 id 는 404/400', async () => {
    const owner = authToken(3, 'GALLERY');
    expect((await request.patch(`/api/galleries/999999/artists/1`).set('Authorization', `Bearer ${owner}`).send({ hidden: true })).status).toBe(404);
    expect((await request.patch(`/api/galleries/${galleryId}/artists/abc`).set('Authorization', `Bearer ${owner}`).send({ hidden: true })).status).toBe(400);
  });
});
