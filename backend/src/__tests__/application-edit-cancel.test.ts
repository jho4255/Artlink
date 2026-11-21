/**
 * 작가의 지원서 고치기 · 지원 취소 + 마감된 공모 정리 (2026-11-21, CLAUDE.md 규칙 90 · lib/applicationWindow.ts).
 *
 *  - 고치기·취소는 **검토 대기 · 모집이 열려 있을 때만**(접수 마감일 전 · 모집 마감 전 · 전시 종료 전)
 *  - 고치기는 알림 없이 `editedAt` 만 — 취소는 지원을 지우고 운영자에게 `APPLICATION_CANCELED`
 *  - 갤러리 결정과 겹치면 상태 하나 — 409 로 늦은 쪽을 막는다
 *  - 배포 마이그레이션: 선정이 이미 끝난 공모(확정·시작·종료)의 검토 대기만 미선정(알림 없음) — 모집만 마감한 공모는 그대로
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeEach } from 'vitest';
import { request, testPrisma, authToken, cleanDb, seedUsers, seedGallery, seedExhibition } from './helpers';
import { ARTIST_APPLY_TERMS_VERSION } from '../lib/terms';
import { applicationChangeBlock, CLOSED_MESSAGE, DECIDED_MESSAGE, DECIDE_AFTER_CLOSE } from '../lib/applicationWindow';

const ownerTok = authToken(3, 'GALLERY');
const a1 = authToken(1, 'ARTIST');
const a2 = authToken(2, 'ARTIST');
const REPEAT = 6;
const APPLY = { biography: '처음 약력', artworkImages: ['/uploads/first.jpg'], termsAgreed: true, termsVersion: ARTIST_APPLY_TERMS_VERSION };
const EDIT = { biography: '고친 약력', artworkImages: ['/uploads/second.jpg', '/uploads/third.jpg'], portfolioFileUrl: '/uploads/pf.pdf' };

let galleryId: number;
let exId: number;
const edit = (body: any = EDIT, tok = a1, id = exId) => request.put(`/api/exhibitions/${id}/my-application`).set('Authorization', `Bearer ${tok}`).send(body);
const cancel = (tok = a1, id = exId) => request.delete(`/api/exhibitions/${id}/my-application`).set('Authorization', `Bearer ${tok}`);
const apply = (tok = a1, id = exId) => request.post(`/api/exhibitions/${id}/apply`).set('Authorization', `Bearer ${tok}`).send(APPLY);
const mine = (userId = 1, id = exId) => testPrisma.application.findFirst({ where: { exhibitionId: id, userId } });

beforeEach(async () => {
  await cleanDb();
  await seedUsers();
  galleryId = (await seedGallery(3)).id;
  exId = (await seedExhibition(galleryId)).id;
  expect((await apply()).status).toBe(201);
});

describe('지원서 고치기', () => {
  it('★ 검토 대기 · 모집 중이면 고친다 — 본문이 바뀌고 editedAt 이 남는다 · 상태·약관은 그대로 · 알림 없음', async () => {
    const before = await mine();
    const r = await edit();
    expect(r.status).toBe(200);
    expect(r.body.biography).toBe('고친 약력');
    expect(r.body.artworkImages).toEqual(['/uploads/second.jpg', '/uploads/third.jpg']);
    const after = await mine();
    expect(after!.status).toBe('SUBMITTED');
    expect(after!.editedAt).not.toBeNull();
    expect(after!.portfolioFileUrl).toBe('/uploads/pf.pdf');
    expect(after!.termsAgreedAt?.getTime(), '약관 동의는 처음 그대로').toBe(before!.termsAgreedAt?.getTime());
    expect(await testPrisma.notification.count({ where: { userId: 3, type: { not: 'NEW_APPLICANT' } } }), '고쳐도 운영자에게 알리지 않는다').toBe(0);
    // 갤러리 지원자 목록이 수정 시각을 받는다(‘11.22 수정’)
    const list = await request.get(`/api/exhibitions/${exId}/applications`).set('Authorization', `Bearer ${ownerTok}`);
    expect(list.body[0].editedAt).toBeTruthy();
    expect(list.body[0].closedOutAt).toBeNull();
  });

  it('지원과 같은 규칙으로 본문을 본다 — 약력 없음·사진 없음·바깥 주소는 400', async () => {
    expect((await edit({ ...EDIT, biography: '  ' })).status).toBe(400);
    expect((await edit({ ...EDIT, artworkImages: [] })).status).toBe(400);
    expect((await edit({ ...EDIT, artworkImages: ['https://evil.example/x.jpg'] })).status).toBe(400);
    expect((await edit({ ...EDIT, portfolioFileUrl: '//evil.example/a.pdf' })).status).toBe(400);
    expect((await mine())!.biography).toBe('처음 약력');
  });

  it('★ 모집이 끝났으면 못 고친다 — 접수 마감일 지남 · 모집 마감 · 전시 종료(400)', async () => {
    await testPrisma.exhibition.update({ where: { id: exId }, data: { deadline: new Date(Date.now() - 2 * 86_400_000) } });
    expect((await edit()).body.error).toBe(CLOSED_MESSAGE);
    await testPrisma.exhibition.update({ where: { id: exId }, data: { deadline: new Date(Date.now() + 5 * 86_400_000), recruitmentClosed: true } });
    expect((await edit()).status).toBe(400);
    await testPrisma.exhibition.update({ where: { id: exId }, data: { recruitmentClosed: false, ended: true } });
    expect((await edit()).status).toBe(400);
    expect((await mine())!.biography).toBe('처음 약력');
  });

  it('결과가 났으면 못 고친다(400) · 지원하지 않은 공모는 404 · 갤러리 계정은 403', async () => {
    await testPrisma.application.updateMany({ where: { exhibitionId: exId, userId: 1 }, data: { status: 'ACCEPTED' } });
    const r = await edit();
    expect(r.status).toBe(400);
    expect(r.body.error).toBe(DECIDED_MESSAGE);
    expect((await edit(EDIT, a2)).status).toBe(404);
    expect((await request.put(`/api/exhibitions/${exId}/my-application`).set('Authorization', `Bearer ${ownerTok}`).send(EDIT)).status).toBe(403);
  });
});

describe('지원 취소', () => {
  it('★ 검토 대기 · 모집 중이면 취소 — 지원이 지워지고 운영자에게 알림 한 통 · 다시 지원할 수 있다', async () => {
    const r = await cancel();
    expect(r.status).toBe(200);
    expect(await mine()).toBeNull();
    const notes = await testPrisma.notification.findMany({ where: { userId: 3, type: 'APPLICATION_CANCELED' } });
    expect(notes).toHaveLength(1);
    expect(notes[0]!.message).toBe('"Test Exhibition"에서 Artist 1님이 지원을 취소했어요.');
    expect(notes[0]!.linkUrl).toContain(String(exId));
    // 접수 마감 전이면 다시 지원
    expect((await apply()).status).toBe(201);
    expect((await mine())!.status).toBe('SUBMITTED');
  });

  it('두 번 누르면 하나만 지운다 — 늦은 쪽은 404(이미 없다)·409(그 사이 지워졌다) · 알림은 한 통', async () => {
    const [x, y] = await Promise.all([cancel(), cancel()]);
    const codes = [x.status, y.status].sort();
    expect(codes[0]).toBe(200);
    expect([404, 409]).toContain(codes[1]);
    expect(await testPrisma.notification.count({ where: { userId: 3, type: 'APPLICATION_CANCELED' } })).toBe(1);
  });

  it('결과가 났거나 모집이 끝났으면 취소하지 못한다(400) — 지원은 그대로', async () => {
    await testPrisma.application.updateMany({ where: { exhibitionId: exId, userId: 1 }, data: { status: 'REJECTED' } });
    expect((await cancel()).status).toBe(400);
    await testPrisma.application.updateMany({ where: { exhibitionId: exId, userId: 1 }, data: { status: 'SUBMITTED' } });
    await testPrisma.exhibition.update({ where: { id: exId }, data: { recruitmentClosed: true } });
    expect((await cancel()).status).toBe(400);
    expect(await mine()).not.toBeNull();
  });

  it('★ 두 시기는 겹치지 않는다 — 모집 중엔 갤러리 수락이 400(작가 취소만 된다), 마감 뒤엔 작가 취소가 400(갤러리만 결정한다)', async () => {
    for (let i = 0; i < REPEAT; i++) {
      const id = (await seedExhibition(galleryId)).id;
      expect((await apply(a2, id)).status).toBe(201);
      const app = (await mine(2, id))!;
      const [acc, can] = await Promise.all([
        request.patch(`/api/exhibitions/${id}/applications/${app.id}`).set('Authorization', `Bearer ${ownerTok}`).send({ status: 'ACCEPTED' }),
        cancel(a2, id),
      ]);
      // 취소가 먼저 끝났으면 수락은 지원을 못 찾는다(404) — 어느 쪽이든 접수 중엔 수락되지 않는다
      expect([400, 404], `회차 ${i}`).toContain(acc.status);
      if (acc.status === 400) expect(acc.body.error).toBe(DECIDE_AFTER_CLOSE);
      expect(can.status, `회차 ${i}`).toBe(200);
      expect(await mine(2, id), `회차 ${i}`).toBeNull();

      // 마감 뒤 — 갤러리는 결정하고 작가는 못 바꾼다
      expect((await apply(a2, id)).status).toBe(201);
      await testPrisma.exhibition.update({ where: { id }, data: { recruitmentClosed: true } });
      const again = (await mine(2, id))!;
      const [acc2, can2] = await Promise.all([
        request.patch(`/api/exhibitions/${id}/applications/${again.id}`).set('Authorization', `Bearer ${ownerTok}`).send({ status: 'ACCEPTED' }),
        cancel(a2, id),
      ]);
      expect(acc2.status, `회차 ${i}`).toBe(200);
      expect(can2.status, `회차 ${i}`).toBe(400);
      expect((await mine(2, id))?.status, `회차 ${i}`).toBe('ACCEPTED');
    }
  });
});

describe('판정 함수 — 화면과 같은 규칙', () => {
  const open = { status: 'APPROVED', recruitmentClosed: false, ended: false, deadline: new Date(Date.now() + 86_400_000) };
  it('검토 대기 · 열림이면 null, 아니면 이유', () => {
    expect(applicationChangeBlock({ status: 'SUBMITTED' }, open)).toBeNull();
    expect(applicationChangeBlock({ status: 'REVIEWED' }, open)).toBeNull();
    expect(applicationChangeBlock({ status: 'ACCEPTED' }, open)).toBe(DECIDED_MESSAGE);
    expect(applicationChangeBlock({ status: 'SUBMITTED' }, { ...open, recruitmentClosed: true })).toBe(CLOSED_MESSAGE);
    expect(applicationChangeBlock({ status: 'SUBMITTED' }, { ...open, ended: true })).toBe(CLOSED_MESSAGE);
    expect(applicationChangeBlock({ status: 'SUBMITTED' }, { ...open, status: 'PENDING' })).toBe(CLOSED_MESSAGE);
    // 마감일 당일은 아직 열려 있다(KST 달력 날짜 — 규칙 14)
    expect(applicationChangeBlock({ status: 'SUBMITTED' }, { ...open, deadline: new Date() })).toBeNull();
    expect(applicationChangeBlock({ status: 'SUBMITTED' }, { ...open, deadline: new Date(Date.now() - 2 * 86_400_000) })).toBe(CLOSED_MESSAGE);
  });
});

describe('배포 마이그레이션 — 선정이 이미 끝난 공모의 검토 대기 정리', () => {
  it('★ 확정·시작·종료된 공모의 검토 대기만 미선정(closedOutAt) · 모집만 마감한 공모와 결과 난 지원은 그대로 · 알림 없음', async () => {
    const sql = fs.readFileSync(path.join(__dirname, '../../prisma/migrations/20261121160000_application_closeout_edit/migration.sql'), 'utf8');
    const update = sql.slice(sql.indexOf('UPDATE "Application"'));
    const closed = (await seedExhibition(galleryId)).id;     // 모집만 마감 — 아직 고르는 중일 수 있다(이미 올라간 공고는 그대로)
    const confirmed = (await seedExhibition(galleryId)).id;
    const started = (await seedExhibition(galleryId)).id;
    const ended = (await seedExhibition(galleryId)).id;
    await testPrisma.exhibition.update({ where: { id: closed }, data: { recruitmentClosed: true } });
    await testPrisma.exhibition.update({ where: { id: confirmed }, data: { recruitmentClosed: true, confirmed: true } });
    await testPrisma.exhibition.update({ where: { id: started }, data: { recruitmentClosed: true, exhibitStartDate: new Date(Date.now() - 2 * 86400000) } });
    await testPrisma.exhibition.update({ where: { id: ended }, data: { ended: true } });
    for (const [id, uid, status] of [[closed, 1, 'SUBMITTED'], [confirmed, 1, 'SUBMITTED'], [confirmed, 2, 'ACCEPTED'], [started, 1, 'SUBMITTED'], [ended, 1, 'REVIEWED'], [ended, 2, 'REJECTED']] as const) {
      await testPrisma.application.create({ data: { exhibitionId: id, userId: uid, status } });
    }
    await testPrisma.$executeRawUnsafe(update);
    const rows = await testPrisma.application.findMany({ orderBy: [{ exhibitionId: 'asc' }, { userId: 'asc' }] });
    const byKey = Object.fromEntries(rows.map((r) => [`${r.exhibitionId}:${r.userId}`, r]));
    expect(byKey[`${exId}:1`]!.status, '열린 공모의 검토 대기는 그대로').toBe('SUBMITTED');
    expect(byKey[`${closed}:1`]!.status, '모집만 마감한 공모는 그대로 — 미선정이 되면 다시 수락할 수 없다').toBe('SUBMITTED');
    expect(byKey[`${closed}:1`]!.closedOutAt).toBeNull();
    expect(byKey[`${confirmed}:1`]!.status).toBe('REJECTED');
    expect(byKey[`${confirmed}:1`]!.closedOutAt).not.toBeNull();
    expect(byKey[`${confirmed}:2`]!.status).toBe('ACCEPTED');
    expect(byKey[`${started}:1`]!.status, '시작일이 지나 저절로 확정된 공모도').toBe('REJECTED');
    expect(byKey[`${ended}:1`]!.status, '옛 검토중(REVIEWED)도 검토 대기다').toBe('REJECTED');
    expect(byKey[`${ended}:2`]!.closedOutAt, '직접 거절한 것은 표시하지 않는다').toBeNull();
    expect(await testPrisma.notification.count({ where: { type: 'APPLICATION_STATUS' } })).toBe(0);
  });
});
