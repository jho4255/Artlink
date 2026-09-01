/**
 * 정산 응답을 **여러 번 뒤집어도** 상태가 어긋나지 않는가 (문제제기 ↔ 수락 반복).
 *
 * 정산은 돈 문제라 "마지막에 누른 것"이 유일한 진실이어야 한다. 실무에서는 이런 일이 흔하다:
 *   작가가 금액을 보고 이의 → 갤러리가 고침 → 작가가 수락 → 또 다른 문제 발견 → 다시 이의 → …
 * 이 왕복에서 하나라도 어긋나면 **동의한 적 없는 금액으로 정산이 완료되거나**,
 * 반대로 다 수락했는데 완료가 막힌다.
 *
 * 여기서 못 박는 것:
 *  1) 몇 번을 뒤집어도 행은 하나뿐이고(upsert), 마지막 응답만 남는다
 *  2) 수락 → 이의로 되돌리면 `autoApprovedAt`(무응답 자동 수락 흔적)이 반드시 지워진다
 *  3) 이의가 하나라도 있으면 정산 완료가 막히고, 전원 수락이면 열린다
 *  4) 요청 중 갤러리가 금액을 고치면 **그 작가만** 재확인 대상이 되고, 옛 화면의 수락은 409로 막힌다
 *  5) 문제 제기 알림이 왕복마다 오너에게 쌓인다(마지막 것만 남기지 않는다 — 이력이다)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { request, testPrisma, authToken, cleanDb, seedUsers, seedGallery, seedExhibition } from './helpers';

const ownerTok = authToken(3, 'GALLERY');
const a1 = authToken(1, 'ARTIST');
const a2 = authToken(2, 'ARTIST');

describe('정산 응답 반복 — 문제제기 ↔ 수락', () => {
  let exId: number;

  const respond = (tok: string, body: any) =>
    request.post(`/api/operations/${exId}/settlement/respond`).set('Authorization', `Bearer ${tok}`).send(body);
  const complete = () =>
    request.post(`/api/operations/${exId}/settlement/complete`).set('Authorization', `Bearer ${ownerTok}`).send({});
  const saveSettlement = (body: any) =>
    request.put(`/api/operations/${exId}/settlement`).set('Authorization', `Bearer ${ownerTok}`).send(body);
  const approvalOf = (userId: number) =>
    testPrisma.settlementApproval.findUnique({ where: { exhibitionId_artistUserId: { exhibitionId: exId, artistUserId: userId } } });

  beforeEach(async () => {
    await cleanDb();
    await seedUsers();
    const gallery = await seedGallery(3);
    const ex = await seedExhibition(gallery.id);
    exId = ex.id;
    for (const uid of [1, 2]) {
      await testPrisma.application.create({ data: { userId: uid, exhibitionId: exId, status: 'ACCEPTED' } });
    }
    for (const tok of [a1, a2]) {
      await request.put(`/api/operations/${exId}/me`).set('Authorization', `Bearer ${tok}`).send({
        artworkList: [{ title: 'A', size: '1', medium: '1', year: '1', price: '1' }], cv: null, note: null,
      });
    }
    await testPrisma.exhibition.update({ where: { id: exId }, data: { recruitmentClosed: true, confirmed: true, ended: true } });
    await saveSettlement({
      sales: [
        { artistUserId: 1, artworkIndex: 0, title: 'A', soldPrice: 1_000_000, paymentMethod: 'CARD' },
        { artistUserId: 2, artworkIndex: 0, title: 'A', soldPrice: 2_000_000, paymentMethod: 'CASH' },
      ],
      ratios: [{ artistUserId: 1, galleryRatio: 40 }, { artistUserId: 2, galleryRatio: 40 }],
    });
    await request.post(`/api/operations/${exId}/settlement/request`).set('Authorization', `Bearer ${ownerTok}`).send({});
  });

  it('★ 10번을 뒤집어도 행은 하나, 마지막 응답만 남는다', async () => {
    for (let i = 0; i < 10; i++) {
      const approve = i % 2 === 0;
      const r = await respond(a1, approve ? { approve: true } : { approve: false, comment: `이의 ${i}` });
      expect(r.status, `${i}번째 응답`).toBe(200);
    }
    const rows = await testPrisma.settlementApproval.findMany({ where: { exhibitionId: exId, artistUserId: 1 } });
    expect(rows).toHaveLength(1);
    // 마지막(i=9)은 이의
    expect(rows[0].status).toBe('ISSUE');
    expect(rows[0].comment).toBe('이의 9');
  });

  it('★ 수락 → 이의로 되돌리면 자동수락 흔적(autoApprovedAt)이 지워진다', async () => {
    await respond(a1, { approve: true });
    // 무응답 자동 수락이 찍힌 상태를 흉내낸다
    await testPrisma.settlementApproval.update({
      where: { exhibitionId_artistUserId: { exhibitionId: exId, artistUserId: 1 } },
      data: { autoApprovedAt: new Date() },
    });
    await respond(a1, { approve: false, comment: '금액이 다릅니다' });
    const row = await approvalOf(1);
    expect(row?.status).toBe('ISSUE');
    // 남아 있으면 "본인이 안 눌렀는데 자동 수락됐다"는 기록이 이의 상태에 붙어 분쟁 근거가 뒤섞인다
    expect(row?.autoApprovedAt).toBeNull();
  });

  it('★ 이의가 하나라도 있으면 정산 완료가 막히고, 다시 수락하면 열린다', async () => {
    await respond(a1, { approve: true });
    await respond(a2, { approve: false, comment: '확인 필요' });
    const blocked = await complete();
    expect(blocked.status).toBe(400);

    await respond(a2, { approve: true });
    const okNow = await complete();
    expect(okNow.status).toBe(200);
    const ex = await testPrisma.exhibition.findUnique({ where: { id: exId } });
    expect(ex?.settledAt).not.toBeNull();
  });

  it('★ 정산 완료 뒤에는 더 이상 응답할 수 없다 (확정된 금액이 흔들리면 안 된다)', async () => {
    await respond(a1, { approve: true });
    await respond(a2, { approve: true });
    expect((await complete()).status).toBe(200);
    const after = await respond(a1, { approve: false, comment: '역시 아닙니다' });
    expect(after.status).toBe(400);
    expect((await approvalOf(1))?.status, '완료 후 응답은 저장되지 않는다').toBe('APPROVED');
  });

  it('★ 요청 중 금액을 고치면 그 작가만 재확인 — 안 고쳐진 작가의 수락은 유지된다', async () => {
    await respond(a1, { approve: true });
    await respond(a2, { approve: true });
    // 작가1 금액만 수정
    await saveSettlement({
      sales: [
        { artistUserId: 1, artworkIndex: 0, title: 'A', soldPrice: 1_500_000, paymentMethod: 'CARD' },
        { artistUserId: 2, artworkIndex: 0, title: 'A', soldPrice: 2_000_000, paymentMethod: 'CASH' },
      ],
      ratios: [{ artistUserId: 1, galleryRatio: 40 }, { artistUserId: 2, galleryRatio: 40 }],
    });
    expect((await approvalOf(1))?.status, '금액이 바뀐 작가는 다시 확인해야 한다').toBe('PENDING');
    expect((await approvalOf(2))?.status, '금액이 그대로인 작가의 수락은 풀리면 안 된다').toBe('APPROVED');
    expect((await complete()).status, '한 명이 미응답이면 완료 불가').toBe(400);
  });

  it('★ 옛 화면(옛 지문)으로 누른 수락은 409로 막는다 — 본 적 없는 금액에 동의시키지 않는다', async () => {
    const before = await request.get(`/api/operations/${exId}/my-settlement`).set('Authorization', `Bearer ${a1}`);
    const staleFingerprint = before.body?.fingerprint;
    expect(typeof staleFingerprint, '화면이 지문을 받아야 대조할 수 있다').toBe('string');

    await saveSettlement({
      sales: [{ artistUserId: 1, artworkIndex: 0, title: 'A', soldPrice: 9_000_000, paymentMethod: 'CARD' }],
      ratios: [{ artistUserId: 1, galleryRatio: 40 }, { artistUserId: 2, galleryRatio: 40 }],
    });

    const stale = await respond(a1, { approve: true, fingerprint: staleFingerprint });
    expect(stale.status).toBe(409);
    expect((await approvalOf(1))?.status).toBe('PENDING');
  });

  it('★ 문제 제기 알림은 왕복마다 오너에게 쌓인다 (이력이라 덮어쓰지 않는다)', async () => {
    await respond(a1, { approve: false, comment: '첫 번째 이의' });
    await respond(a1, { approve: true });
    await respond(a1, { approve: false, comment: '두 번째 이의' });
    const notis = await testPrisma.notification.findMany({
      where: { userId: 3, type: 'SETTLEMENT_ISSUE' }, orderBy: { id: 'asc' },
    });
    expect(notis).toHaveLength(2);
    expect(notis[0].message).toContain('첫 번째 이의');
    expect(notis[1].message).toContain('두 번째 이의');
  });

  it('이의를 낼 때 내용이 없으면 400 (무엇이 문제인지 모르면 갤러리가 고칠 수 없다)', async () => {
    const r = await respond(a1, { approve: false, comment: '   ' });
    expect(r.status).toBe(400);
    expect((await approvalOf(1))?.status, '실패한 응답이 상태를 바꾸면 안 된다').toBe('PENDING');
  });
});
