/**
 * 공모 사진 관리 API + 라이프사이클 순서 강제 + 지원자 연락처 노출 테스트
 *
 *  - POST   /api/exhibitions/:id/images           사진 추가 (오너/Admin)
 *  - DELETE /api/exhibitions/:id/images/:imageId  사진 삭제 (최소 1장 유지)
 *  - PATCH  /api/exhibitions/:id/images/reorder   순서 변경
 *  - PATCH  /api/operations/:id/lifecycle         모집마감 → 확정 → 전시종료 순서 강제
 *  - GET    /api/exhibitions/:id/applications      연락처(전화/이메일) 상태 무관 노출
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { request, testPrisma, authToken, cleanDb, seedUsers, seedGallery, seedExhibition } from './helpers';

const ownerTok = authToken(3, 'GALLERY');
const adminTok = authToken(4, 'ADMIN');
const artistTok = authToken(1, 'ARTIST');

describe('공모 사진 관리 API', () => {
  let exId: number;
  beforeEach(async () => {
    await cleanDb();
    await seedUsers();
    const gallery = await seedGallery(3);
    const ex = await seedExhibition(gallery.id);
    exId = ex.id;
  });

  const addImage = (tok: string, url: string) =>
    request.post(`/api/exhibitions/${exId}/images`).set('Authorization', `Bearer ${tok}`).send({ url });

  it('오너가 사진을 추가하면 201 + 목록 반환', async () => {
    const r = await addImage(ownerTok, '/uploads/a.jpg');
    expect(r.status).toBe(201);
    expect(r.body).toHaveLength(1);
    expect(r.body[0].url).toBe('/uploads/a.jpg');
    // 대표 imageUrl 동기화
    const ex = await testPrisma.exhibition.findUnique({ where: { id: exId } });
    expect(ex?.imageUrl).toBe('/uploads/a.jpg');
  });

  it('비오너(작가)는 403', async () => {
    const r = await addImage(artistTok, '/uploads/a.jpg');
    expect(r.status).toBe(403);
  });

  it('Admin도 사진 추가 가능', async () => {
    const r = await addImage(adminTok, '/uploads/admin.jpg');
    expect(r.status).toBe(201);
  });

  it('잘못된 URL(javascript:)은 400', async () => {
    const r = await addImage(ownerTok, 'javascript:alert(1)');
    expect(r.status).toBe(400);
  });

  it('사진이 1장뿐이면 삭제 차단(400)', async () => {
    const add = await addImage(ownerTok, '/uploads/only.jpg');
    const imageId = add.body[0].id;
    const del = await request.delete(`/api/exhibitions/${exId}/images/${imageId}`).set('Authorization', `Bearer ${ownerTok}`);
    expect(del.status).toBe(400);
    expect(del.body.error).toContain('최소 한 장');
  });

  it('2장 이상이면 삭제 가능 + order 재정렬 + imageUrl 동기화', async () => {
    const a = await addImage(ownerTok, '/uploads/1.jpg');
    await addImage(ownerTok, '/uploads/2.jpg');
    const firstId = a.body[0].id;
    const del = await request.delete(`/api/exhibitions/${exId}/images/${firstId}`).set('Authorization', `Bearer ${ownerTok}`);
    expect(del.status).toBe(200);
    expect(del.body).toHaveLength(1);
    expect(del.body[0].url).toBe('/uploads/2.jpg');
    expect(del.body[0].order).toBe(0);
    const ex = await testPrisma.exhibition.findUnique({ where: { id: exId } });
    expect(ex?.imageUrl).toBe('/uploads/2.jpg');
  });

  it('순서 변경 시 order 반영 + 첫 사진이 대표 imageUrl', async () => {
    const a = await addImage(ownerTok, '/uploads/1.jpg');
    const b = await addImage(ownerTok, '/uploads/2.jpg');
    const id1 = a.body[0].id;
    const id2 = b.body[1].id;
    const r = await request.patch(`/api/exhibitions/${exId}/images/reorder`)
      .set('Authorization', `Bearer ${ownerTok}`).send({ orderedIds: [id2, id1] });
    expect(r.status).toBe(200);
    expect(r.body.map((i: any) => i.url)).toEqual(['/uploads/2.jpg', '/uploads/1.jpg']);
    const ex = await testPrisma.exhibition.findUnique({ where: { id: exId } });
    expect(ex?.imageUrl).toBe('/uploads/2.jpg');
  });

  it('reorder의 id 집합이 불일치하면 400', async () => {
    const a = await addImage(ownerTok, '/uploads/1.jpg');
    const id1 = a.body[0].id;
    const r = await request.patch(`/api/exhibitions/${exId}/images/reorder`)
      .set('Authorization', `Bearer ${ownerTok}`).send({ orderedIds: [id1, 999999] });
    expect(r.status).toBe(400);
  });

  it('기존 imageUrl만 있는 공모에 업로드 시 기존 사진을 order 0으로 보존(유실 방지)', async () => {
    // 상세 GET 백필을 거치지 않고 곧바로 업로드하는 상황
    await testPrisma.exhibition.update({ where: { id: exId }, data: { imageUrl: '/uploads/existing.jpg' } });
    const r = await addImage(ownerTok, '/uploads/new.jpg');
    expect(r.status).toBe(201);
    expect(r.body.map((i: any) => i.url)).toEqual(['/uploads/existing.jpg', '/uploads/new.jpg']);
    // 대표 이미지는 기존 사진 유지
    const ex = await testPrisma.exhibition.findUnique({ where: { id: exId } });
    expect(ex?.imageUrl).toBe('/uploads/existing.jpg');
  });

  it('상세 조회 시 imageUrl만 있던 기존 공모는 이미지 행으로 lazy 백필', async () => {
    await testPrisma.exhibition.update({ where: { id: exId }, data: { imageUrl: '/uploads/legacy.jpg' } });
    const r = await request.get(`/api/exhibitions/${exId}`);
    expect(r.status).toBe(200);
    expect(r.body.images).toHaveLength(1);
    expect(r.body.images[0].url).toBe('/uploads/legacy.jpg');
  });
});

describe('라이프사이클 순서 강제 (모집마감 → 확정 → 전시종료)', () => {
  let exId: number;
  beforeEach(async () => {
    await cleanDb();
    await seedUsers();
    const gallery = await seedGallery(3);
    const ex = await seedExhibition(gallery.id);
    exId = ex.id;
  });

  const lifecycle = (body: Record<string, boolean>) =>
    request.patch(`/api/operations/${exId}/lifecycle`).set('Authorization', `Bearer ${ownerTok}`).send(body);

  it('모집마감 전 확정 시도 → 400', async () => {
    const r = await lifecycle({ confirmed: true });
    expect(r.status).toBe(400);
    expect(r.body.error).toContain('모집마감');
  });

  it('확정 전 전시종료 시도 → 400', async () => {
    await lifecycle({ recruitmentClosed: true });
    const r = await lifecycle({ ended: true });
    expect(r.status).toBe(400);
    expect(r.body.error).toContain('확정');
  });

  it('모집마감 → 확정 → 전시종료 순서대로 성공', async () => {
    expect((await lifecycle({ recruitmentClosed: true })).status).toBe(200);
    expect((await lifecycle({ confirmed: true })).status).toBe(200);
    const ended = await lifecycle({ ended: true });
    expect(ended.status).toBe(200);
    expect(ended.body.ended).toBe(true);
  });

  it('확정 상태에서 모집 재개 차단 → 400', async () => {
    await lifecycle({ recruitmentClosed: true });
    await lifecycle({ confirmed: true });
    const r = await lifecycle({ recruitmentClosed: false });
    expect(r.status).toBe(400);
  });

  it('전시종료 상태에서 확정 취소 차단 → 400', async () => {
    await lifecycle({ recruitmentClosed: true });
    await lifecycle({ confirmed: true });
    await lifecycle({ ended: true });
    const r = await lifecycle({ confirmed: false });
    expect(r.status).toBe(400);
  });
});

describe('지원자 연락처 노출 (상태 무관)', () => {
  let exId: number;
  beforeEach(async () => {
    await cleanDb();
    await seedUsers();
    // 연락처가 있는 미수락(SUBMITTED) 지원자
    await testPrisma.user.update({ where: { id: 1 }, data: { phone: '010-1111-2222', email: 'artist1@test.com' } });
    const gallery = await seedGallery(3);
    const ex = await seedExhibition(gallery.id);
    exId = ex.id;
    await testPrisma.application.create({ data: { userId: 1, exhibitionId: exId, status: 'SUBMITTED', biography: '약력' } });
  });

  it('미수락 지원자도 오너에게 전화/이메일 노출', async () => {
    const r = await request.get(`/api/exhibitions/${exId}/applications`).set('Authorization', `Bearer ${ownerTok}`);
    expect(r.status).toBe(200);
    expect(r.body).toHaveLength(1);
    expect(r.body[0].status).toBe('SUBMITTED');
    expect(r.body[0].user.phone).toBe('010-1111-2222');
    expect(r.body[0].user.email).toBe('artist1@test.com');
  });
});

describe('거절 확인 (acknowledge-rejection)', () => {
  let exId: number;
  const artist1Tok = authToken(1, 'ARTIST');
  const artist2Tok = authToken(2, 'ARTIST');
  beforeEach(async () => {
    await cleanDb();
    await seedUsers();
    const gallery = await seedGallery(3);
    const ex = await seedExhibition(gallery.id);
    exId = ex.id;
  });

  it('거절된 본인 지원은 확인 처리 → rejectionAckedAt 설정', async () => {
    const app = await testPrisma.application.create({ data: { userId: 1, exhibitionId: exId, status: 'REJECTED', biography: '약력' } });
    const r = await request.post(`/api/exhibitions/applications/${app.id}/acknowledge-rejection`).set('Authorization', `Bearer ${artist1Tok}`);
    expect(r.status).toBe(200);
    expect(r.body.rejectionAckedAt).toBeTruthy();
    const updated = await testPrisma.application.findUnique({ where: { id: app.id } });
    expect(updated?.rejectionAckedAt).not.toBeNull();
  });

  it('거절이 아닌(접수) 지원은 확인 불가 400', async () => {
    const app = await testPrisma.application.create({ data: { userId: 1, exhibitionId: exId, status: 'SUBMITTED', biography: '약력' } });
    const r = await request.post(`/api/exhibitions/applications/${app.id}/acknowledge-rejection`).set('Authorization', `Bearer ${artist1Tok}`);
    expect(r.status).toBe(400);
  });

  it('남의 지원은 확인 불가 404', async () => {
    const app = await testPrisma.application.create({ data: { userId: 1, exhibitionId: exId, status: 'REJECTED', biography: '약력' } });
    const r = await request.post(`/api/exhibitions/applications/${app.id}/acknowledge-rejection`).set('Authorization', `Bearer ${artist2Tok}`);
    expect(r.status).toBe(404);
  });

  it('확인 처리된 거절은 my-applications에서 rejectionAckedAt이 노출(프론트가 숨김 판단)', async () => {
    const app = await testPrisma.application.create({ data: { userId: 1, exhibitionId: exId, status: 'REJECTED', biography: '약력' } });
    await request.post(`/api/exhibitions/applications/${app.id}/acknowledge-rejection`).set('Authorization', `Bearer ${artist1Tok}`);
    const r = await request.get('/api/exhibitions/my-applications').set('Authorization', `Bearer ${artist1Tok}`);
    expect(r.status).toBe(200);
    const found = r.body.find((a: any) => a.id === app.id);
    expect(found.rejectionAckedAt).toBeTruthy();
  });
});

describe('지원 상태 전이 규칙 (수락 최종 / 거절→수락만 / 검토중 폐지)', () => {
  let exId: number;
  let appId: number;
  beforeEach(async () => {
    await cleanDb();
    await seedUsers();
    const gallery = await seedGallery(3);
    const ex = await seedExhibition(gallery.id);
    exId = ex.id;
    const app = await testPrisma.application.create({ data: { userId: 1, exhibitionId: exId, status: 'SUBMITTED', biography: '약력' } });
    appId = app.id;
  });
  const patch = (status: string) =>
    request.patch(`/api/exhibitions/${exId}/applications/${appId}`).set('Authorization', `Bearer ${ownerTok}`).send({ status });

  it('접수 → 수락 허용', async () => {
    expect((await patch('ACCEPTED')).status).toBe(200);
  });
  it('수락 → 거절 차단 (400)', async () => {
    await patch('ACCEPTED');
    const r = await patch('REJECTED');
    expect(r.status).toBe(400);
    expect(r.body.error).toContain('수락한 지원');
  });
  it('수락 → 접수 차단 (400)', async () => {
    await patch('ACCEPTED');
    expect((await patch('SUBMITTED')).status).toBe(400);
  });
  it('거절 → 수락 허용', async () => {
    await patch('REJECTED');
    expect((await patch('ACCEPTED')).status).toBe(200);
  });
  it('거절 → 접수 차단 (400)', async () => {
    await patch('REJECTED');
    const r = await patch('SUBMITTED');
    expect(r.status).toBe(400);
    expect(r.body.error).toContain('수락으로만');
  });
  it('검토중(REVIEWED)은 설정 불가 (400)', async () => {
    expect((await patch('REVIEWED')).status).toBe(400);
  });
  it('거절→수락 시 거절확인(rejectionAckedAt) 해제', async () => {
    await patch('REJECTED');
    await testPrisma.application.update({ where: { id: appId }, data: { rejectionAckedAt: new Date() } });
    await patch('ACCEPTED');
    const updated = await testPrisma.application.findUnique({ where: { id: appId } });
    expect(updated?.rejectionAckedAt).toBeNull();
  });
});
