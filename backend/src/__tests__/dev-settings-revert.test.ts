/**
 * Admin 개발자 도구(수락 되돌리기 토글) + 수락→거절 되돌리기 정리 로직 테스트
 *
 *  - GET/PUT /api/admin/dev-settings  (ADMIN 전용 토글)
 *  - GET     /api/settings/flags      (로그인 유저 플래그 조회)
 *  - PATCH   /api/exhibitions/:id/applications/:appId
 *      토글 OFF: 수락은 최종 (기존 규칙 유지)
 *      토글 ON : 수락→거절 허용 (전체 갤러리). 되돌리면 해당 작가의
 *                제출물/판매/정산비율/정산승인 삭제 + 정원 슬롯 복구.
 *                수락→접수는 여전히 차단, 정산 완료 공모는 차단.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { request, testPrisma, authToken, cleanDb, seedUsers, seedGallery, seedExhibition } from './helpers';
import { ARTIST_APPLY_TERMS_VERSION } from '../lib/terms';

const ownerTok = authToken(3, 'GALLERY');
const adminTok = authToken(4, 'ADMIN');
const artist1Tok = authToken(1, 'ARTIST');

const setRevertFlag = (value: boolean) =>
  request.put('/api/admin/dev-settings').set('Authorization', `Bearer ${adminTok}`).send({ allowAcceptedRevert: value });

describe('개발자 도구 설정 API (/api/admin/dev-settings)', () => {
  beforeEach(async () => {
    await cleanDb();
    await seedUsers();
  });

  it('기본값은 비활성화(false)', async () => {
    const r = await request.get('/api/admin/dev-settings').set('Authorization', `Bearer ${adminTok}`);
    expect(r.status).toBe(200);
    expect(r.body.allowAcceptedRevert).toBe(false);
  });

  it('Admin이 토글 ON → GET에 반영', async () => {
    const put = await setRevertFlag(true);
    expect(put.status).toBe(200);
    expect(put.body.allowAcceptedRevert).toBe(true);
    const get = await request.get('/api/admin/dev-settings').set('Authorization', `Bearer ${adminTok}`);
    expect(get.body.allowAcceptedRevert).toBe(true);
  });

  it('boolean이 아닌 값은 400', async () => {
    const r = await request.put('/api/admin/dev-settings').set('Authorization', `Bearer ${adminTok}`).send({ allowAcceptedRevert: 'yes' });
    expect(r.status).toBe(400);
  });

  it('비Admin(갤러리)은 조회/변경 모두 403', async () => {
    expect((await request.get('/api/admin/dev-settings').set('Authorization', `Bearer ${ownerTok}`)).status).toBe(403);
    expect((await request.put('/api/admin/dev-settings').set('Authorization', `Bearer ${ownerTok}`).send({ allowAcceptedRevert: true })).status).toBe(403);
  });

  it('GET /api/settings/flags — 갤러리도 토글 상태 조회 가능, 비로그인 401', async () => {
    await setRevertFlag(true);
    const r = await request.get('/api/settings/flags').set('Authorization', `Bearer ${ownerTok}`);
    expect(r.status).toBe(200);
    expect(r.body.allowAcceptedRevert).toBe(true);
    expect((await request.get('/api/settings/flags')).status).toBe(401);
  });
});

describe('수락→거절 되돌리기 (토글 ON 시)', () => {
  let exId: number;
  let appId: number;
  beforeEach(async () => {
    await cleanDb();
    await seedUsers();
    const gallery = await seedGallery(3);
    const ex = await seedExhibition(gallery.id);
    exId = ex.id;
    const app = await testPrisma.application.create({ data: { userId: 1, exhibitionId: exId, status: 'ACCEPTED', biography: '약력' } });
    appId = app.id;
  });
  const patch = (status: string) =>
    request.patch(`/api/exhibitions/${exId}/applications/${appId}`).set('Authorization', `Bearer ${ownerTok}`).send({ status });

  it('토글 OFF: 수락→거절 여전히 차단 (400)', async () => {
    const r = await patch('REJECTED');
    expect(r.status).toBe(400);
    expect(r.body.error).toContain('수락한 지원');
  });

  it('토글 ON: 수락→거절 허용 (200)', async () => {
    await setRevertFlag(true);
    const r = await patch('REJECTED');
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('REJECTED');
    const updated = await testPrisma.application.findUnique({ where: { id: appId } });
    expect(updated?.status).toBe('REJECTED');
  });

  it('토글 ON이어도 수락→접수는 차단 (400)', async () => {
    await setRevertFlag(true);
    expect((await patch('SUBMITTED')).status).toBe(400);
  });

  it('되돌리기 시 해당 작가의 제출물·판매·정산 데이터만 삭제 (타 작가 유지)', async () => {
    await setRevertFlag(true);
    // artist1(되돌림 대상) + artist2(유지 대상) 데이터 시드
    await testPrisma.application.create({ data: { userId: 2, exhibitionId: exId, status: 'ACCEPTED', biography: '약력2' } });
    for (const userId of [1, 2]) {
      await testPrisma.exhibitionSubmission.create({
        data: { exhibitionId: exId, userId, artworkList: JSON.stringify([{ image: '/uploads/art.jpg', title: '작품' }]) },
      });
      await testPrisma.artworkSale.create({
        data: { exhibitionId: exId, artistUserId: userId, artworkIndex: 0, title: '작품', soldPrice: 100000 },
      });
      await testPrisma.artistSettlement.create({ data: { exhibitionId: exId, artistUserId: userId, galleryRatio: 30 } });
      await testPrisma.settlementApproval.create({ data: { exhibitionId: exId, artistUserId: userId } });
    }

    const r = await patch('REJECTED');
    expect(r.status).toBe(200);

    // artist1 데이터 전부 삭제
    expect(await testPrisma.exhibitionSubmission.findFirst({ where: { exhibitionId: exId, userId: 1 } })).toBeNull();
    expect(await testPrisma.artworkSale.findFirst({ where: { exhibitionId: exId, artistUserId: 1 } })).toBeNull();
    expect(await testPrisma.artistSettlement.findFirst({ where: { exhibitionId: exId, artistUserId: 1 } })).toBeNull();
    expect(await testPrisma.settlementApproval.findFirst({ where: { exhibitionId: exId, artistUserId: 1 } })).toBeNull();
    // artist2 데이터 유지
    expect(await testPrisma.exhibitionSubmission.findFirst({ where: { exhibitionId: exId, userId: 2 } })).not.toBeNull();
    expect(await testPrisma.artworkSale.findFirst({ where: { exhibitionId: exId, artistUserId: 2 } })).not.toBeNull();
    expect(await testPrisma.artistSettlement.findFirst({ where: { exhibitionId: exId, artistUserId: 2 } })).not.toBeNull();
    expect(await testPrisma.settlementApproval.findFirst({ where: { exhibitionId: exId, artistUserId: 2 } })).not.toBeNull();
  });

  it('정산 완료(settledAt)된 공모는 되돌리기 차단 (400)', async () => {
    await setRevertFlag(true);
    await testPrisma.exhibition.update({ where: { id: exId }, data: { settledAt: new Date() } });
    const r = await patch('REJECTED');
    expect(r.status).toBe(400);
    expect(r.body.error).toContain('정산');
  });

  it('되돌리기 후 정원 슬롯 복구 — 정원 1명 공모에 다른 작가가 지원 가능', async () => {
    await setRevertFlag(true);
    await testPrisma.exhibition.update({ where: { id: exId }, data: { capacity: 1 } });

    // 정원 찬 상태에서는 지원 불가
    const artist2Tok = authToken(2, 'ARTIST');
    const applyPayload = { biography: '약력', artworkImages: ['https://example.com/a.jpg'], termsAgreed: true, termsVersion: ARTIST_APPLY_TERMS_VERSION };
    const before = await request.post(`/api/exhibitions/${exId}/apply`).set('Authorization', `Bearer ${artist2Tok}`).send(applyPayload);
    expect(before.status).toBe(400);

    // 되돌리면 슬롯 복구 → 지원 성공
    expect((await patch('REJECTED')).status).toBe(200);
    const after = await request.post(`/api/exhibitions/${exId}/apply`).set('Authorization', `Bearer ${artist2Tok}`).send(applyPayload);
    expect(after.status).toBe(201);
  });

  it('되돌리기 시 작가에게 상태변경 알림 발송', async () => {
    await setRevertFlag(true);
    await patch('REJECTED');
    const noti = await testPrisma.notification.findFirst({ where: { userId: 1, type: 'APPLICATION_STATUS' } });
    expect(noti).not.toBeNull();
    expect(noti?.message).toContain('거절');
  });

  it('거절→수락 재수락도 여전히 가능 (기존 규칙 유지)', async () => {
    await setRevertFlag(true);
    await patch('REJECTED');
    const r = await patch('ACCEPTED');
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('ACCEPTED');
  });

  it('작가 본인은 상태 변경 불가 (403)', async () => {
    await setRevertFlag(true);
    const r = await request.patch(`/api/exhibitions/${exId}/applications/${appId}`).set('Authorization', `Bearer ${artist1Tok}`).send({ status: 'REJECTED' });
    expect(r.status).toBe(403);
  });
});
