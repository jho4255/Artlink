/**
 * 공모 흐름 — 단계가 넘어가는 **순간**을 상대에게 알린다 (2026-11-20, lib/flowNotify.ts · CLAUDE.md 규칙 88).
 *
 *  ① 작가가 출품 자료를 다 채워 낸 순간 → 운영자(공모마다 한 줄로 합침)
 *  ② 갤러리가 전시를 확정한 순간 → 수락된 작가 전원
 *  ③ 마지막 작가가 정산을 확인한 순간(직접 · 무응답 자동 수락) → 운영자 한 번
 *  ④ 모집 마감 — 되돌릴 수 없다 · 수락만(거절 없음) · 선정이 끝나면 남은 검토 대기는 미선정 · **알림 없음** · 되돌릴 수 없다(2026-11-21, 규칙 90)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { request, testPrisma, authToken, cleanDb, seedUsers, seedGallery, seedExhibition } from './helpers';
import { DECIDE_AFTER_CLOSE, FINISH_AFTER_CLOSE, NO_REJECT, SELECTION_FINISHED } from '../lib/applicationWindow';

const ownerTok = authToken(3, 'GALLERY');
const a1 = authToken(1, 'ARTIST');
const a2 = authToken(2, 'ARTIST');
const adminTok = authToken(4, 'ADMIN');

const FULL = {
  artworkList: [{ title: '수평선', size: '40x60', medium: '유채', year: '2024', price: '1000000' }],
  cv: { nameKo: '작가', solo: [{ year: '2024', content: '개인전' }] },
  note: { statement: '작가노트입니다', sections: [] },
};

describe('공모 흐름 — 넘어가는 순간의 알림', () => {
  let exId: number;
  const saveMine = (tok: string, body: any) =>
    request.put(`/api/operations/${exId}/me`).set('Authorization', `Bearer ${tok}`).send(body);
  const lifecycle = (body: any, tok = ownerTok) =>
    request.patch(`/api/operations/${exId}/lifecycle`).set('Authorization', `Bearer ${tok}`).send(body);
  const notesOf = (userId: number, type: string) =>
    testPrisma.notification.findMany({ where: { userId, type }, orderBy: { id: 'asc' } });

  beforeEach(async () => {
    await cleanDb();
    await seedUsers();
    const gallery = await seedGallery(3);
    const ex = await seedExhibition(gallery.id);
    exId = ex.id;
    for (const uid of [1, 2]) {
      await testPrisma.application.create({ data: { userId: uid, exhibitionId: exId, status: 'ACCEPTED' } });
    }
    await testPrisma.exhibition.update({ where: { id: exId }, data: { recruitmentClosed: true } });
  });

  describe('① 출품 자료를 다 채워 낸 순간 → 운영자', () => {
    it('★ 다 채우지 않은 저장(출품작만 · 임시저장)은 알리지 않는다', async () => {
      expect((await saveMine(a1, { artworkList: FULL.artworkList, cv: null, note: null })).status).toBe(200);
      expect((await saveMine(a1, { ...FULL, artworkList: [{ ...FULL.artworkList[0], draft: true }] })).status).toBe(200);
      expect(await notesOf(3, 'SUBMISSION_RECEIVED')).toHaveLength(0);
    });

    it('★ 다 채운 순간 운영자에게 한 줄 — 두 번째 작가는 같은 줄을 고친다, 다 모이면 전시 확정을 말한다', async () => {
      expect((await saveMine(a1, FULL)).status).toBe(200);
      let notes = await notesOf(3, 'SUBMISSION_RECEIVED');
      expect(notes).toHaveLength(1);
      expect(notes[0].message).toContain('(1/2)');
      expect(notes[0].linkUrl).toBe(`/exhibitions/${exId}/operation/new?view=submissions`);
      expect(notes[0].refKey).toBe(`submission:${exId}`);

      expect((await saveMine(a2, FULL)).status).toBe(200);
      notes = await notesOf(3, 'SUBMISSION_RECEIVED');
      expect(notes, '안 읽은 줄을 고쳐 쓴다 — 작가마다 줄이 쌓이지 않는다').toHaveLength(1);
      expect(notes[0].message).toContain('모두 모였어요 (2/2)');
      expect(notes[0].message).toContain('전시를 확정하세요');
    });

    it('이미 낸 자료를 고쳐 다시 저장해도 또 알리지 않는다(새로 다 찬 순간만)', async () => {
      await saveMine(a1, FULL);
      await testPrisma.notification.updateMany({ where: { userId: 3 }, data: { read: true } });
      await saveMine(a1, { ...FULL, note: { statement: '고친 노트', sections: [] } });
      expect(await notesOf(3, 'SUBMISSION_RECEIVED')).toHaveLength(1);
    });

    it('읽은 뒤에 다른 작가가 내면 새 줄로 알린다', async () => {
      await saveMine(a1, FULL);
      await testPrisma.notification.updateMany({ where: { userId: 3 }, data: { read: true } });
      await saveMine(a2, FULL);
      const notes = await notesOf(3, 'SUBMISSION_RECEIVED');
      expect(notes).toHaveLength(2);
      expect(notes[1].read).toBe(false);
    });

    it('★ 두 작가가 동시에 다 채워 내도 한 줄(공모마다 잠금)', async () => {
      const rs = await Promise.all([saveMine(a1, FULL), saveMine(a2, FULL)]);
      expect(rs.map((r) => r.status)).toEqual([200, 200]);
      const notes = await notesOf(3, 'SUBMISSION_RECEIVED');
      expect(notes).toHaveLength(1);
      expect(notes[0].message).toContain('(2/2)');
    });

    it('갤러리가 [대신 입력]으로 채운 것은 갤러리에게 알리지 않는다(본인이 한 일이다)', async () => {
      const r = await request.put(`/api/operations/${exId}/submissions/1`).set('Authorization', `Bearer ${ownerTok}`).send(FULL);
      expect(r.status).toBe(200);
      expect(await notesOf(3, 'SUBMISSION_RECEIVED')).toHaveLength(0);
    });
  });

  describe('② 전시 확정 → 수락된 작가', () => {
    it('★ 갤러리가 확정하면 수락된 작가마다 한 통 — 작가의 그 전시 화면으로', async () => {
      expect((await lifecycle({ confirmed: true })).status).toBe(200);
      for (const uid of [1, 2]) {
        const notes = await notesOf(uid, 'EXHIBITION_CONFIRMED');
        expect(notes).toHaveLength(1);
        expect(notes[0].message).toContain('출품 자료는 더 고칠 수 없어요');
        expect(notes[0].linkUrl).toBe(`/mypage?tab=applications&ex=${exId}`);
      }
      expect(await notesOf(3, 'EXHIBITION_CONFIRMED'), '갤러리에게는 안 간다').toHaveLength(0);
    });

    it('전시 시작일이 지나 이미 저절로 확정된 뒤의 수동 확정은 새 소식이 아니다', async () => {
      await testPrisma.exhibition.update({ where: { id: exId }, data: { exhibitStartDate: new Date(Date.now() - 86_400_000) } });
      expect((await lifecycle({ confirmed: true })).status).toBe(200);
      expect(await notesOf(1, 'EXHIBITION_CONFIRMED')).toHaveLength(0);
    });

    it('이미 확정된 공모에 다시 확정을 보내도 두 번 알리지 않는다', async () => {
      await lifecycle({ confirmed: true });
      await lifecycle({ confirmed: true });
      expect(await notesOf(1, 'EXHIBITION_CONFIRMED')).toHaveLength(1);
    });
  });

  describe('④ 모집 마감 — 되돌릴 수 없다 · 수락·거절은 마감 뒤에만 · 남은 검토 대기는 선정을 마칠 때 미선정(알림 없음, 규칙 90)', () => {
    const finish = (tok = ownerTok) => request.post(`/api/operations/${exId}/finish-selection`).set('Authorization', `Bearer ${tok}`);
    beforeEach(async () => {
      // 모집 중으로 되돌리고 검토 대기 지원자를 하나 더 둔다(작가 2 는 수락 → 검토 대기로 바꾼다)
      await testPrisma.exhibition.update({ where: { id: exId }, data: { recruitmentClosed: false } });
      await testPrisma.application.updateMany({ where: { exhibitionId: exId, userId: 2 }, data: { status: 'SUBMITTED' } });
    });

    it('★ 마감해도 검토 대기는 그대로다 — 이제부터 선정한다(알림 없음)', async () => {
      const r = await lifecycle({ recruitmentClosed: true });
      expect(r.status).toBe(200);
      expect(r.body.rejectedCount).toBe(0);
      const apps = await testPrisma.application.findMany({ where: { exhibitionId: exId }, orderBy: { userId: 'asc' } });
      expect(apps.map((a) => a.status)).toEqual(['ACCEPTED', 'SUBMITTED']);
      expect(await notesOf(2, 'APPLICATION_STATUS')).toHaveLength(0);
    });

    it('★ 접수 중엔 수락 400 — 마감하면 된다 · 거절은 언제나 400', async () => {
      const app = await testPrisma.application.findFirstOrThrow({ where: { exhibitionId: exId, userId: 2 } });
      const decide = (status: string, tok = ownerTok) => request.patch(`/api/exhibitions/${exId}/applications/${app.id}`).set('Authorization', `Bearer ${tok}`).send({ status });
      for (const [status, tok, msg] of [['ACCEPTED', ownerTok, DECIDE_AFTER_CLOSE], ['REJECTED', ownerTok, NO_REJECT], ['ACCEPTED', adminTok, DECIDE_AFTER_CLOSE]] as const) {
        const r = await decide(status, tok);
        expect(r.status).toBe(400);
        expect(r.body.error).toBe(msg);
      }
      await lifecycle({ recruitmentClosed: true });
      expect((await decide('ACCEPTED')).status).toBe(200);
      const notes = await notesOf(2, 'APPLICATION_STATUS');
      expect(notes).toHaveLength(1);
      expect(notes[0].message).toContain('선정되었어요');
    });

    it('옛 화면이 보낸 rejectPending 은 무시한다 — 마감은 아무도 미선정으로 바꾸지 않는다', async () => {
      const r = await lifecycle({ recruitmentClosed: true, rejectPending: true });
      expect(r.status).toBe(200);
      expect(r.body.rejectedCount).toBe(0);
      expect((await testPrisma.application.findFirst({ where: { exhibitionId: exId, userId: 2 } }))!.status).toBe('SUBMITTED');
    });

    it('★ 모집 마감은 되돌릴 수 없다 — 갤러리도 관리자도 400', async () => {
      await lifecycle({ recruitmentClosed: true });
      for (const tok of [ownerTok, adminTok]) {
        const r = await lifecycle({ recruitmentClosed: false }, tok);
        expect(r.status).toBe(400);
        expect(r.body.error).toBe('모집 마감은 되돌릴 수 없어요.');
      }
      expect((await testPrisma.exhibition.findUnique({ where: { id: exId } }))!.recruitmentClosed).toBe(true);
    });

    it('아직 열려 있는 공모에 false 를 보내면 아무 일도 없다(200)', async () => {
      const r = await lifecycle({ recruitmentClosed: false });
      expect(r.status).toBe(200);
      expect(r.body.recruitmentClosed).toBe(false);
      expect((await testPrisma.application.findFirst({ where: { exhibitionId: exId, userId: 2 } }))!.status).toBe('SUBMITTED');
    });

    it('★ [선정 마치기] — 남은 검토 대기는 미선정(closedOutAt) · 알림 없음 · 수락은 그대로 · 모집 중엔 400', async () => {
      const early = await finish();
      expect(early.status).toBe(400);
      expect(early.body.error).toBe(FINISH_AFTER_CLOSE);
      await lifecycle({ recruitmentClosed: true });
      const r = await finish();
      expect(r.status).toBe(200);
      expect(r.body.closedOut).toBe(1);
      const apps = await testPrisma.application.findMany({ where: { exhibitionId: exId }, orderBy: { userId: 'asc' } });
      expect(apps.map((a) => a.status)).toEqual(['ACCEPTED', 'REJECTED']);
      expect(apps[0]!.closedOutAt, '수락은 표시가 없다').toBeNull();
      expect(apps[1]!.closedOutAt, '선정을 마칠 때 미선정이 된 줄').not.toBeNull();
      expect(await notesOf(2, 'APPLICATION_STATUS'), '미선정 알림은 보내지 않는다(사용자 결정)').toHaveLength(0);
      expect((await finish(a1)).status, '작가는 못 한다').toBe(403);
    });

    it('[전시 확정]이 선정을 마친다 — 남은 검토 대기는 미선정(알림 없음)', async () => {
      await lifecycle({ recruitmentClosed: true });
      const r = await lifecycle({ confirmed: true });
      expect(r.status).toBe(200);
      expect(r.body.rejectedCount).toBe(1);
      expect((await testPrisma.application.findFirst({ where: { exhibitionId: exId, userId: 2 } }))!.closedOutAt).not.toBeNull();
      expect(await notesOf(2, 'APPLICATION_STATUS')).toHaveLength(0);
    });

    it('관리자가 순서를 건너뛰어 [전시 종료]만 보내도(모집이 함께 닫힌다) 남은 검토 대기는 미선정', async () => {
      const r = await lifecycle({ ended: true }, adminTok);
      expect(r.status).toBe(200);
      expect(r.body.rejectedCount).toBe(1);
      expect(r.body.recruitmentClosed).toBe(true);
    });

    it('★ 선정을 마친 뒤엔 되돌릴 수 없다 — 미선정은 갤러리도 관리자도 다시 수락하지 못한다(2026-11-21 사용자 결정)', async () => {
      await lifecycle({ recruitmentClosed: true });
      await finish();
      const app = await testPrisma.application.findFirstOrThrow({ where: { exhibitionId: exId, userId: 2 } });
      for (const tok of [ownerTok, adminTok]) {
        const r = await request.patch(`/api/exhibitions/${exId}/applications/${app.id}`).set('Authorization', `Bearer ${tok}`).send({ status: 'ACCEPTED' });
        expect(r.status).toBe(400);
        expect(r.body.error).toBe(SELECTION_FINISHED);
      }
      const after = await testPrisma.application.findUniqueOrThrow({ where: { id: app.id } });
      expect(after.status).toBe('REJECTED');
      expect(after.closedOutAt).not.toBeNull();
      expect(await notesOf(2, 'APPLICATION_STATUS')).toHaveLength(0);
    });

    it('작가는 단계 전환을 못 한다(403)', async () => {
      const r = await lifecycle({ recruitmentClosed: true }, a1);
      expect(r.status).toBe(403);
    });
  });

  describe('③ 마지막 작가가 정산을 확인한 순간 → 운영자 한 번', () => {
    const respond = (tok: string, body: any) =>
      request.post(`/api/operations/${exId}/settlement/respond`).set('Authorization', `Bearer ${tok}`).send(body);

    beforeEach(async () => {
      for (const tok of [a1, a2]) await saveMine(tok, FULL);
      await testPrisma.exhibition.update({ where: { id: exId }, data: { confirmed: true, ended: true } });
      await request.put(`/api/operations/${exId}/settlement`).set('Authorization', `Bearer ${ownerTok}`).send({
        sales: [{ artistUserId: 1, artworkIndex: 0, title: '수평선', soldPrice: 1_000_000, paymentMethod: 'CARD' }],
        ratios: [{ artistUserId: 1, galleryRatio: 40 }, { artistUserId: 2, galleryRatio: 40 }],
      });
      await request.post(`/api/operations/${exId}/settlement/request`).set('Authorization', `Bearer ${ownerTok}`).send({});
    });

    it('★ 한 명만 확인하면 아직 아니다 — 마지막 작가가 확인하면 [정산 완료]를 누르라고 한 번', async () => {
      await respond(a1, { approve: true });
      expect(await notesOf(3, 'SETTLEMENT_ALL_APPROVED')).toHaveLength(0);
      await respond(a2, { approve: true });
      const notes = await notesOf(3, 'SETTLEMENT_ALL_APPROVED');
      expect(notes).toHaveLength(1);
      expect(notes[0].message).toContain('작가 2명이 모두 정산을 확인했어요');
      expect(notes[0].linkUrl).toBe(`/exhibitions/${exId}/operation/new?view=settlement`);
    });

    it('이의가 남아 있으면 알리지 않는다', async () => {
      await respond(a1, { approve: true });
      await respond(a2, { approve: false, comment: '판매가가 다릅니다' });
      expect(await notesOf(3, 'SETTLEMENT_ALL_APPROVED')).toHaveLength(0);
      const issue = await notesOf(3, 'SETTLEMENT_ISSUE');
      expect(issue[0].message).toContain('이의를 남겼어요');
      expect(issue[0].linkUrl).toBe(`/exhibitions/${exId}/operation/new?view=settlement`);
    });

    it('★ 두 작가가 동시에 마지막으로 확인해도 한 줄', async () => {
      await Promise.all([respond(a1, { approve: true }), respond(a2, { approve: true })]);
      expect(await notesOf(3, 'SETTLEMENT_ALL_APPROVED')).toHaveLength(1);
    });

    it('★ 무응답 자동 수락으로 모두 확인이 돼도 알린다', async () => {
      await respond(a1, { approve: true });
      await testPrisma.settlementApproval.update({
        where: { exhibitionId_artistUserId: { exhibitionId: exId, artistUserId: 2 } },
        data: { askedAt: new Date(Date.now() - 10 * 86_400_000) },
      });
      // 화면을 열 때 훑는다(스케줄러 없음)
      await request.get(`/api/operations/${exId}/settlement`).set('Authorization', `Bearer ${ownerTok}`);
      expect(await notesOf(3, 'SETTLEMENT_ALL_APPROVED')).toHaveLength(1);
    });
  });
});
