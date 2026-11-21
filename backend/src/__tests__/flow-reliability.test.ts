/**
 * 공모 흐름 개편(규칙 88) 신뢰성 — **동시에 · 여러 번** 들어온 요청 (2026-11-20, `scratchpad/flow-review-2026-11/TESTCASES.md` REL-01 묶음).
 *
 * 두 탭 · 두 운영자 · 연타 · 화면과 서버가 겹치는 순간에도 **상태 하나 · 알림 한 통**이어야 한다.
 * 판정은 응답 코드가 아니라 **행 수 · 알림 수 · 최종 상태**(규칙 46 — 400 하나만 보고 통과시키지 말 것).
 * 동시성은 한 번 통과로 끝내지 않는다 — 같은 경합을 REPEAT 번 새 공모로 되풀이한다.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { request, testPrisma, authToken, cleanDb, seedUsers, seedGallery, seedExhibition } from './helpers';
import { ARTIST_APPLY_TERMS_VERSION } from '../lib/terms';

const ownerTok = authToken(3, 'GALLERY');
const adminTok = authToken(4, 'ADMIN');
const a1 = authToken(1, 'ARTIST');
const a2 = authToken(2, 'ARTIST');
const REPEAT = 6;

const FULL = {
  artworkList: [{ title: '수평선', size: '40x60', medium: '유채', year: '2024', price: '1000000' }],
  cv: { nameKo: '작가', solo: [{ year: '2024', content: '개인전' }] },
  note: { statement: '작가노트입니다', sections: [] },
};
const exLink = (exId: number) => `/mypage?tab=applications&ex=${exId}`;

let galleryId: number;
/** 테스트용 작가 셋째(101) — seedUsers 는 1·2 만 만든다 */
async function thirdArtist() {
  return testPrisma.user.upsert({ where: { id: 101 }, create: { id: 101, email: 'artist101@test.com', name: 'Artist 101', role: 'ARTIST' }, update: {} });
}
/** 지원 상태를 지정해 공모 하나 */
async function exhibitionWith(apps: Record<number, string>, data: Record<string, unknown> = {}) {
  const ex = await seedExhibition(galleryId);
  if (Object.keys(data).length) await testPrisma.exhibition.update({ where: { id: ex.id }, data });
  const ids: Record<number, number> = {};
  for (const [uid, status] of Object.entries(apps)) {
    const app = await testPrisma.application.create({ data: { userId: Number(uid), exhibitionId: ex.id, status } });
    ids[Number(uid)] = app.id;
  }
  return { exId: ex.id, appIds: ids };
}
const lifecycle = (exId: number, body: any, tok = ownerTok) =>
  request.patch(`/api/operations/${exId}/lifecycle`).set('Authorization', `Bearer ${tok}`).send(body);
const setStatus = (exId: number, appId: number, status: string, tok = ownerTok) =>
  request.patch(`/api/exhibitions/${exId}/applications/${appId}`).set('Authorization', `Bearer ${tok}`).send({ status });
const saveMine = (exId: number, tok: string, body: any = FULL) =>
  request.put(`/api/operations/${exId}/me`).set('Authorization', `Bearer ${tok}`).send(body);
/** 그 공모에 대해 그 사람이 받은 알림(종류별) */
const notesFor = (userId: number, type: string, exId: number) =>
  testPrisma.notification.findMany({ where: { userId, type, linkUrl: { contains: `${exId}` } }, orderBy: { id: 'asc' } });

beforeEach(async () => {
  await cleanDb();
  await seedUsers();
  galleryId = (await seedGallery(3)).id;
});

// ─────────────────────────────────────────────────────────────
describe('LIF — 모집 마감 + 남은 검토 대기를 미선정으로(D2), 동시에', () => {
  it('★ LIF-06 마감 요청 둘이 동시에 와도 작가마다 결과 알림 한 통 · 처리 수의 합 = 실제로 바뀐 수 (가설 S2)', async () => {
    await thirdArtist();
    for (let i = 0; i < REPEAT; i++) {
      const { exId } = await exhibitionWith({ 1: 'SUBMITTED', 2: 'SUBMITTED', 101: 'ACCEPTED' });
      const [r1, r2] = await Promise.all([
        lifecycle(exId, { recruitmentClosed: true, rejectPending: true }),
        lifecycle(exId, { recruitmentClosed: true, rejectPending: true }),
      ]);
      expect([r1.status, r2.status], `회차 ${i}`).toEqual([200, 200]);
      expect((r1.body.rejectedCount ?? 0) + (r2.body.rejectedCount ?? 0), `회차 ${i} — 두 응답이 같은 사람을 겹쳐 세면 안 된다`).toBe(2);
      for (const uid of [1, 2]) {
        const notes = await notesFor(uid, 'APPLICATION_STATUS', exId);
        expect(notes, `회차 ${i} · 작가 ${uid} — 결과 알림은 한 통`).toHaveLength(1);
        expect(notes[0]!.message).toContain('지원 결과가 나왔어요');
      }
      expect(await notesFor(101, 'APPLICATION_STATUS', exId), '수락된 작가는 건드리지 않는다').toHaveLength(0);
      const apps = await testPrisma.application.findMany({ where: { exhibitionId: exId }, orderBy: { userId: 'asc' } });
      expect(apps.map(a => a.status)).toEqual(['REJECTED', 'REJECTED', 'ACCEPTED']);
    }
  });

  it('★ LIF-07 마감(D2)과 같은 지원의 수동 거절이 동시에 — 최종 미선정 · 결과 알림 한 통 (가설 S2)', async () => {
    for (let i = 0; i < REPEAT; i++) {
      const { exId, appIds } = await exhibitionWith({ 1: 'SUBMITTED', 2: 'ACCEPTED' });
      await Promise.all([
        lifecycle(exId, { recruitmentClosed: true, rejectPending: true }),
        setStatus(exId, appIds[1]!, 'REJECTED'),
      ]);
      const app = await testPrisma.application.findUnique({ where: { id: appIds[1]! } });
      expect(app?.status, `회차 ${i}`).toBe('REJECTED');
      expect(await notesFor(1, 'APPLICATION_STATUS', exId), `회차 ${i} — 같은 미선정을 두 번 알리면 안 된다`).toHaveLength(1);
    }
  });

  it('LIF-07b 마감(D2)과 같은 지원의 수동 수락이 동시에 — 마지막 알림이 최종 상태와 맞고, 같은 결과를 두 번 알리지 않는다', async () => {
    for (let i = 0; i < REPEAT; i++) {
      const { exId, appIds } = await exhibitionWith({ 1: 'SUBMITTED' });
      await Promise.all([
        lifecycle(exId, { recruitmentClosed: true, rejectPending: true }),
        setStatus(exId, appIds[1]!, 'ACCEPTED'),
      ]);
      const app = await testPrisma.application.findUnique({ where: { id: appIds[1]! } });
      const notes = await notesFor(1, 'APPLICATION_STATUS', exId);
      // 거절 → 수락(허용된 전환)으로 두 번 바뀌었으면 두 통이 맞다. 같은 말이 두 번이면 안 된다
      const msgs = notes.map(n => (n.message.includes('선정되었어요') ? 'ACCEPTED' : 'REJECTED'));
      expect(new Set(msgs).size, `회차 ${i} — 같은 결과를 두 번 알렸다: ${msgs}`).toBe(msgs.length);
      expect(msgs[msgs.length - 1], `회차 ${i} — 마지막 알림이 최종 상태(${app?.status})와 다르다`).toBe(app?.status);
    }
  });

  it('LIF-09 rejectPending 은 진짜 true 일 때만 · 마감하는 순간에만 · 단독으로는 아무 일도 안 한다', async () => {
    const one = await exhibitionWith({ 1: 'SUBMITTED' });
    expect((await lifecycle(one.exId, { recruitmentClosed: true, rejectPending: 'true' })).body.rejectedCount).toBe(0);
    expect((await testPrisma.application.findUnique({ where: { id: one.appIds[1]! } }))?.status).toBe('SUBMITTED');

    const two = await exhibitionWith({ 1: 'SUBMITTED' });
    expect((await lifecycle(two.exId, { rejectPending: true })).status).toBe(200);
    expect((await testPrisma.application.findUnique({ where: { id: two.appIds[1]! } }))?.status).toBe('SUBMITTED');

    // 이미 마감된 공모를 끝내며(ended) 같이 실어 보내도 검토 대기는 건드리지 않는다(마감하는 '순간'이 아니다)
    const three = await exhibitionWith({ 1: 'SUBMITTED', 2: 'ACCEPTED' }, { recruitmentClosed: true, confirmed: true });
    expect((await lifecycle(three.exId, { ended: true, rejectPending: true })).body.rejectedCount).toBe(0);
    expect((await testPrisma.application.findUnique({ where: { id: three.appIds[1]! } }))?.status).toBe('SUBMITTED');
  });
});

// ─────────────────────────────────────────────────────────────
describe('CNF — 전시 확정, 동시에', () => {
  it('★ CNF-02 확정 요청 둘이 동시에 와도 수락 작가마다 확정 알림 한 통 (가설 S3)', async () => {
    for (let i = 0; i < REPEAT; i++) {
      const { exId } = await exhibitionWith({ 1: 'ACCEPTED', 2: 'ACCEPTED' }, { recruitmentClosed: true });
      const rs = await Promise.all([lifecycle(exId, { confirmed: true }), lifecycle(exId, { confirmed: true })]);
      expect(rs.map(r => r.status), `회차 ${i}`).toEqual([200, 200]);
      for (const uid of [1, 2]) {
        expect(await notesFor(uid, 'EXHIBITION_CONFIRMED', exId), `회차 ${i} · 작가 ${uid}`).toHaveLength(1);
      }
    }
  });

  it('CNF-03 확정 → 되돌리기 → 다시 확정이면 두 번째 알림이 간다(다시 잠겼다는 새 소식)', async () => {
    const { exId } = await exhibitionWith({ 1: 'ACCEPTED' }, { recruitmentClosed: true });
    expect((await lifecycle(exId, { confirmed: true })).status).toBe(200);
    expect((await lifecycle(exId, { confirmed: false })).status).toBe(200);
    expect((await lifecycle(exId, { confirmed: true })).status).toBe(200);
    expect(await notesFor(1, 'EXHIBITION_CONFIRMED', exId)).toHaveLength(2);
  });

  it('CNF-02b 마감을 건너뛴 확정(관리자가 둘을 한 번에)도 동시에 두 번 오면 한 통', async () => {
    for (let i = 0; i < 3; i++) {
      const { exId } = await exhibitionWith({ 1: 'ACCEPTED' });
      await Promise.all([
        lifecycle(exId, { recruitmentClosed: true, confirmed: true }, adminTok),
        lifecycle(exId, { recruitmentClosed: true, confirmed: true }, adminTok),
      ]);
      expect(await notesFor(1, 'EXHIBITION_CONFIRMED', exId), `회차 ${i}`).toHaveLength(1);
    }
  });
});

// ─────────────────────────────────────────────────────────────
describe('SUB — 출품 자료, 동시에', () => {
  it('★ SUB-03 세 작가가 동시에 다 채워 내도 운영자에게 한 줄 · 마지막 문구는 3/3 모두 모였어요', async () => {
    await thirdArtist();
    const a3 = authToken(101, 'ARTIST');
    for (let i = 0; i < REPEAT; i++) {
      const { exId } = await exhibitionWith({ 1: 'ACCEPTED', 2: 'ACCEPTED', 101: 'ACCEPTED' }, { recruitmentClosed: true });
      const rs = await Promise.all([saveMine(exId, a1), saveMine(exId, a2), saveMine(exId, a3)]);
      expect(rs.map(r => r.status), `회차 ${i}`).toEqual([200, 200, 200]);
      const notes = await testPrisma.notification.findMany({ where: { userId: 3, refKey: `submission:${exId}` } });
      expect(notes, `회차 ${i}`).toHaveLength(1);
      expect(notes[0]!.message, `회차 ${i}`).toContain('모두 모였어요 (3/3)');
    }
  });

  it('★ SUB-04 같은 작가의 첫 저장이 동시에 둘 — 둘 다 성공(500·뭉개진 400 없음) · 제출 행 하나 · 알림 한 줄 (가설 S9)', async () => {
    for (let i = 0; i < REPEAT; i++) {
      const { exId } = await exhibitionWith({ 1: 'ACCEPTED', 2: 'ACCEPTED' }, { recruitmentClosed: true });
      const rs = await Promise.all([saveMine(exId, a1), saveMine(exId, a1)]);
      expect(rs.map(r => r.status), `회차 ${i} — ${rs.map(r => JSON.stringify(r.body).slice(0, 80))}`).toEqual([200, 200]);
      expect(await testPrisma.exhibitionSubmission.count({ where: { exhibitionId: exId, userId: 1 } })).toBe(1);
      expect(await testPrisma.notification.count({ where: { userId: 3, refKey: `submission:${exId}` } })).toBe(1);
    }
  });

  it('SUB-05 아트링크 주최 + 운영 갤러리 둘이면 두 주인 모두 한 줄씩 · 갤러리 없는 주최면 관리자에게', async () => {
    const owner2 = await testPrisma.user.create({ data: { email: 'gallery2@test.com', name: 'Gallery 2', role: 'GALLERY' } });
    const gallery2 = await seedGallery(owner2.id);
    const { exId } = await exhibitionWith({ 1: 'ACCEPTED' }, { recruitmentClosed: true, hostType: 'ADMIN' });
    await testPrisma.exhibitionManager.createMany({ data: [{ exhibitionId: exId, galleryId }, { exhibitionId: exId, galleryId: gallery2.id }] });
    expect((await saveMine(exId, a1)).status).toBe(200);
    for (const uid of [3, owner2.id]) {
      expect(await testPrisma.notification.count({ where: { userId: uid, refKey: `submission:${exId}` } }), `운영 갤러리 주인 ${uid}`).toBe(1);
    }

    const hostless = await exhibitionWith({ 2: 'ACCEPTED' }, { recruitmentClosed: true, hostType: 'ADMIN', galleryId: null });
    expect((await saveMine(hostless.exId, a2)).status).toBe(200);
    expect(await testPrisma.notification.count({ where: { userId: 4, refKey: `submission:${hostless.exId}` } }), '관리자').toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────
describe('SET — 정산, 동시에 · 여러 번', () => {
  const respond = (exId: number, tok: string, body: any) =>
    request.post(`/api/operations/${exId}/settlement/respond`).set('Authorization', `Bearer ${tok}`).send(body);
  const settlementPut = (exId: number, price: number) =>
    request.put(`/api/operations/${exId}/settlement`).set('Authorization', `Bearer ${ownerTok}`).send({
      sales: [{ artistUserId: 1, artworkIndex: 0, title: '수평선', soldPrice: price, paymentMethod: 'CARD' }],
      ratios: [{ artistUserId: 1, galleryRatio: 40 }, { artistUserId: 2, galleryRatio: 40 }],
    });
  const askRequest = (exId: number) => request.post(`/api/operations/${exId}/settlement/request`).set('Authorization', `Bearer ${ownerTok}`).send({});
  const complete = (exId: number) => request.post(`/api/operations/${exId}/settlement/complete`).set('Authorization', `Bearer ${ownerTok}`).send({});

  /** 전시가 끝나고 판매를 넣은 공모 — 수락 작가 1·2, 둘 다 출품 자료를 냈다 */
  async function endedWithSales() {
    const { exId } = await exhibitionWith({ 1: 'ACCEPTED', 2: 'ACCEPTED' }, { recruitmentClosed: true });
    for (const tok of [a1, a2]) expect((await saveMine(exId, tok)).status).toBe(200);
    await testPrisma.exhibition.update({ where: { id: exId }, data: { confirmed: true, ended: true } });
    expect((await settlementPut(exId, 1_000_000)).status).toBe(200);
    return exId;
  }

  it('★ SET-04 정산 확인 요청 둘이 동시에 — 요청 한 번 · 승인 행 작가당 하나 · 작가 알림 작가당 한 통 · 500/뭉개진 400 없음 (가설 S14)', async () => {
    for (let i = 0; i < REPEAT; i++) {
      const exId = await endedWithSales();
      const rs = await Promise.all([askRequest(exId), askRequest(exId)]);
      const codes = rs.map(r => r.status).sort();
      expect(codes, `회차 ${i} — ${rs.map(r => JSON.stringify(r.body).slice(0, 80))}`).toEqual([200, 400]);
      const failed = rs.find(r => r.status === 400)!;
      expect(failed.body.error, `회차 ${i}`).toBe('이미 정산 확인을 요청했습니다.');
      expect(await testPrisma.settlementApproval.count({ where: { exhibitionId: exId } }), `회차 ${i}`).toBe(2);
      for (const uid of [1, 2]) {
        expect(await notesFor(uid, 'SETTLEMENT_CONFIRM_REQUEST', exId), `회차 ${i} · 작가 ${uid}`).toHaveLength(1);
      }
    }
  });

  it('★ SET-23 갤러리 주인과 관리자가 동시에 고쳐 저장 — 500·뭉개진 400 없이 둘 다 받고, 마지막 저장 한 벌만 남는다 · 요청 중이면 금액이 바뀐 작가만 다시 확인', async () => {
    for (let i = 0; i < REPEAT; i++) {
      const exId = await endedWithSales();
      expect((await askRequest(exId)).status).toBe(200);
      for (const tok of [a1, a2]) expect((await respond(exId, tok, { approve: true })).status).toBe(200);
      const put = (tok: string, price: number) => request.put(`/api/operations/${exId}/settlement`).set('Authorization', `Bearer ${tok}`).send({
        sales: [{ artistUserId: 1, artworkIndex: 0, title: '수평선', soldPrice: price, paymentMethod: 'CARD' }],
        ratios: [{ artistUserId: 1, galleryRatio: 40 }, { artistUserId: 2, galleryRatio: 40 }],
      });
      const rs = await Promise.all([put(ownerTok, 1_200_000), put(adminTok, 1_500_000)]);
      expect(rs.map(r => r.status), `회차 ${i} — ${rs.map(r => JSON.stringify(r.body).slice(0, 90))}`).toEqual([200, 200]);
      const sales = await testPrisma.artworkSale.findMany({ where: { exhibitionId: exId } });
      expect(sales, `회차 ${i} — 판매 줄`).toHaveLength(1);
      expect([1_200_000, 1_500_000], `회차 ${i}`).toContain(sales[0]!.soldPrice);
      const approvals = await testPrisma.settlementApproval.findMany({ where: { exhibitionId: exId }, orderBy: { artistUserId: 'asc' } });
      expect(approvals.map(a => a.status), `회차 ${i} — 금액이 바뀐 작가 1만 다시`).toEqual(['PENDING', 'APPROVED']);
    }
  });

  it('★ SET-16 정산 완료 둘이 동시에 — 완료 한 번 · 작가에게 공개 알림 한 통씩 (가설 S13)', async () => {
    for (let i = 0; i < REPEAT; i++) {
      const exId = await endedWithSales();
      expect((await askRequest(exId)).status).toBe(200);
      for (const tok of [a1, a2]) expect((await respond(exId, tok, { approve: true })).status).toBe(200);
      const rs = await Promise.all([complete(exId), complete(exId)]);
      expect(rs.map(r => r.status).sort(), `회차 ${i} — ${rs.map(r => JSON.stringify(r.body).slice(0, 80))}`).toEqual([200, 400]);
      expect(rs.find(r => r.status === 400)!.body.error).toBe('이미 정산이 완료되었습니다.');
      for (const uid of [1, 2]) {
        const shared = (await notesFor(uid, 'SETTLEMENT_SHARED', exId)).filter(n => n.message.includes('공개'));
        expect(shared, `회차 ${i} · 작가 ${uid}`).toHaveLength(1);
      }
    }
  });

  it('★ SET-13 모두 확인 알림을 읽은 뒤 같은 작가가 확인을 또 보내도 알림이 늘지 않는다 (가설 S10)', async () => {
    const exId = await endedWithSales();
    expect((await askRequest(exId)).status).toBe(200);
    for (const tok of [a1, a2]) await respond(exId, tok, { approve: true });
    expect(await notesFor(3, 'SETTLEMENT_ALL_APPROVED', exId)).toHaveLength(1);
    await testPrisma.notification.updateMany({ where: { userId: 3 }, data: { read: true } });
    expect((await respond(exId, a1, { approve: true })).status).toBe(200);
    expect(await notesFor(3, 'SETTLEMENT_ALL_APPROVED', exId), '이미 끝난 일을 또 알리면 안 된다').toHaveLength(1);
  });

  it('SET-13b 읽은 뒤 금액을 고쳐 그 작가가 다시 확인하면 새 소식 한 줄 · 고치지 않은 작가의 확인은 그대로', async () => {
    const exId = await endedWithSales();
    expect((await askRequest(exId)).status).toBe(200);
    for (const tok of [a1, a2]) await respond(exId, tok, { approve: true });
    await testPrisma.notification.updateMany({ where: { userId: 3 }, data: { read: true } });
    expect((await settlementPut(exId, 1_500_000)).status).toBe(200);
    const approvals = await testPrisma.settlementApproval.findMany({ where: { exhibitionId: exId }, orderBy: { artistUserId: 'asc' } });
    expect(approvals.map(a => a.status), '금액이 바뀐 작가만 다시').toEqual(['PENDING', 'APPROVED']);
    expect((await respond(exId, a1, { approve: true })).status).toBe(200);
    expect(await notesFor(3, 'SETTLEMENT_ALL_APPROVED', exId)).toHaveLength(2);
  });

  it('SET-12 운영 갤러리 둘(아트링크 주최)이 있으면 두 주인 모두 한 줄 — 두 작가가 동시에 마지막으로 확인해도', async () => {
    const owner2 = await testPrisma.user.create({ data: { email: 'gallery2@test.com', name: 'Gallery 2', role: 'GALLERY' } });
    const gallery2 = await seedGallery(owner2.id);
    for (let i = 0; i < 3; i++) {
      const exId = await endedWithSales();
      await testPrisma.exhibition.update({ where: { id: exId }, data: { hostType: 'ADMIN' } });
      await testPrisma.exhibitionManager.createMany({ data: [{ exhibitionId: exId, galleryId }, { exhibitionId: exId, galleryId: gallery2.id }] });
      expect((await askRequest(exId)).status).toBe(200);
      await Promise.all([respond(exId, a1, { approve: true }), respond(exId, a2, { approve: true })]);
      for (const uid of [3, owner2.id]) {
        expect(await notesFor(uid, 'SETTLEMENT_ALL_APPROVED', exId), `회차 ${i} · 운영 갤러리 주인 ${uid}`).toHaveLength(1);
      }
    }
  });

  it('SET-14 이의는 3일이 지나도 자동 확인하지 않는다 · 안내를 못 받은(askedAt 없음) 사람도 자동 확인하지 않는다', async () => {
    const exId = await endedWithSales();
    expect((await askRequest(exId)).status).toBe(200);
    await respond(exId, a1, { approve: false, comment: '판매가가 다릅니다' });
    const old = new Date(Date.now() - 10 * 86_400_000);
    await testPrisma.settlementApproval.update({ where: { exhibitionId_artistUserId: { exhibitionId: exId, artistUserId: 1 } }, data: { askedAt: old } });
    await testPrisma.settlementApproval.update({ where: { exhibitionId_artistUserId: { exhibitionId: exId, artistUserId: 2 } }, data: { askedAt: null } });
    await request.get(`/api/operations/${exId}/settlement`).set('Authorization', `Bearer ${ownerTok}`);
    const approvals = await testPrisma.settlementApproval.findMany({ where: { exhibitionId: exId }, orderBy: { artistUserId: 'asc' } });
    expect(approvals.map(a => [a.status, a.autoApprovedAt])).toEqual([['ISSUE', null], ['PENDING', null]]);
  });
});

// ─────────────────────────────────────────────────────────────
describe('APL·REV — 지원과 심사, 동시에', () => {
  const apply = (exId: number, tok: string) =>
    request.post(`/api/exhibitions/${exId}/apply`).set('Authorization', `Bearer ${tok}`).send({
      biography: '약력입니다', career: { solo: [], group: [], artFair: [] }, artworkImages: ['/uploads/a.jpg'],
      portfolioFileUrl: null, termsAgreed: true, termsVersion: ARTIST_APPLY_TERMS_VERSION,
    });

  it('★ APL-04 같은 작가의 지원 둘이 동시에 — 지원 하나 · 갤러리 알림 한 통 · 다른 하나는 이미 지원했다는 400', async () => {
    for (let i = 0; i < REPEAT; i++) {
      const { exId } = await exhibitionWith({});
      const rs = await Promise.all([apply(exId, a1), apply(exId, a1)]);
      expect(rs.map(r => r.status).sort(), `회차 ${i} — ${rs.map(r => JSON.stringify(r.body).slice(0, 80))}`).toEqual([201, 400]);
      expect(rs.find(r => r.status === 400)!.body.error).toBe('이미 지원한 공모입니다.');
      expect(await testPrisma.application.count({ where: { exhibitionId: exId, userId: 1 } })).toBe(1);
      expect(await testPrisma.notification.count({ where: { userId: 3, type: 'NEW_APPLICANT', linkUrl: { contains: `${exId}` } } }), `회차 ${i}`).toBe(1);
    }
  });

  it('★ REV-04 정원 마지막 자리에 두 사람을 동시에 수락 — 한 명만 · 선정 알림 한 통', async () => {
    for (let i = 0; i < REPEAT; i++) {
      const { exId, appIds } = await exhibitionWith({ 1: 'SUBMITTED', 2: 'SUBMITTED' }, { capacity: 1 });
      const rs = await Promise.all([setStatus(exId, appIds[1]!, 'ACCEPTED'), setStatus(exId, appIds[2]!, 'ACCEPTED')]);
      expect(rs.map(r => r.status).sort(), `회차 ${i}`).toEqual([200, 400]);
      expect(await testPrisma.application.count({ where: { exhibitionId: exId, status: 'ACCEPTED' } })).toBe(1);
      const notes = await testPrisma.notification.findMany({ where: { type: 'APPLICATION_STATUS', linkUrl: exLink(exId) } });
      expect(notes, `회차 ${i}`).toHaveLength(1);
      expect(notes[0]!.message).toContain('선정되었어요');
    }
  });

  it('REV-04b 같은 지원을 두 운영자가 동시에 수락·거절 — 최종 상태와 마지막 알림이 맞고 같은 결과를 두 번 알리지 않는다', async () => {
    for (let i = 0; i < REPEAT; i++) {
      const { exId, appIds } = await exhibitionWith({ 1: 'SUBMITTED' });
      await Promise.all([setStatus(exId, appIds[1]!, 'ACCEPTED'), setStatus(exId, appIds[1]!, 'REJECTED', adminTok)]);
      const app = await testPrisma.application.findUnique({ where: { id: appIds[1]! } });
      const notes = await notesFor(1, 'APPLICATION_STATUS', exId);
      const msgs = notes.map(n => (n.message.includes('선정되었어요') ? 'ACCEPTED' : 'REJECTED'));
      expect(new Set(msgs).size, `회차 ${i} — 같은 결과를 두 번 알렸다: ${msgs}`).toBe(msgs.length);
      expect(msgs[msgs.length - 1], `회차 ${i} — 마지막 알림(${msgs[msgs.length - 1]})이 최종 상태(${app?.status})와 다르다`).toBe(app?.status);
    }
  });
});
