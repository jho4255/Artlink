/**
 * 선정 마감일 (2026-11-21, CLAUDE.md 규칙 90) — 새로 올리는 공고부터.
 *  - 등록: 필수 · 접수 마감 < 선정 마감 < 출품 자료 마감(공모만 진행이면 앞쪽만)
 *  - 접수가 끝나면(모집 마감 또는 접수 마감일 경과) 수락 · 선정 마감일이 지나면 남은 검토 대기는 **알림 없이** 미선정, 그 뒤 수락 400
 *  - 3일 전부터 당일까지 하루 한 번 운영자에게 알림(검토 대기가 남았고 접수가 끝났을 때만)
 *  - [선정 마감일 변경] — 지나기 전까지, 주최자만
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { request, testPrisma, authToken, cleanDb, seedUsers, seedGallery, seedExhibition, closeRecruitment } from './helpers';
import { closeOutExpiredSelections, sendSelectionReminders, sweepSelectionDeadlines, resetSelectionSweepThrottle, selectionReminderMessage, daysUntilKst, kstMonthDay, kstYmd } from '../lib/selectionDeadline';
import { SELECTION_FINISHED } from '../lib/applicationWindow';

const ownerTok = authToken(3, 'GALLERY');
const adminTok = authToken(4, 'ADMIN');
const a1 = authToken(1, 'ARTIST');
const DAY = 86400000;
const at = (d: number) => new Date(Date.now() + d * DAY);
const iso = (d: number) => at(d).toISOString();

let galleryId: number;
beforeEach(async () => {
  await cleanDb();
  await seedUsers();
  galleryId = (await seedGallery(3)).id;
  resetSelectionSweepThrottle();
});

/** 선정 중인 공모 — 접수가 끝났고 선정 마감일이 `sel` 일 뒤 */
async function selecting(sel: number, apps: Record<number, string> = { 1: 'SUBMITTED', 2: 'SUBMITTED' }, data: Record<string, unknown> = {}) {
  const ex = await seedExhibition(galleryId);
  await testPrisma.exhibition.update({ where: { id: ex.id }, data: { recruitmentClosed: true, selectionDeadline: at(sel), ...data } });
  const ids: Record<number, number> = {};
  for (const [uid, status] of Object.entries(apps)) {
    ids[Number(uid)] = (await testPrisma.application.create({ data: { userId: Number(uid), exhibitionId: ex.id, status } })).id;
  }
  return { exId: ex.id, ids };
}

describe('등록 — 선정 마감일은 새 공고의 필수 칸', () => {
  const body = (over: Record<string, unknown> = {}) => ({
    title: '새 공모', type: 'GROUP', capacity: 3, region: 'SEOUL', description: '<p>소개</p>', galleryId,
    deadline: iso(10), selectionDeadline: iso(14), submissionDeadline: iso(20), exhibitStartDate: iso(30), exhibitDate: iso(40),
    ...over,
  });
  const post = (over?: Record<string, unknown>) => request.post('/api/exhibitions').set('Authorization', `Bearer ${ownerTok}`).send(body(over));

  it('★ 저장된다 — 없으면 400', async () => {
    const r = await post();
    expect(r.status).toBe(201);
    const saved = await testPrisma.exhibition.findUniqueOrThrow({ where: { id: r.body.id } });
    expect(daysUntilKst(saved.selectionDeadline!)).toBe(14);
    const no = await post({ selectionDeadline: undefined });
    expect(no.status).toBe(400);
  });

  it('★ 접수 마감 < 선정 마감 < 출품 자료 마감 — 같은 날도 안 된다', async () => {
    for (const sel of [8, 10]) {
      const r = await post({ selectionDeadline: iso(sel) });
      expect(r.status, `선정 D+${sel}`).toBe(400);
      expect(r.body.error).toBe('선정 마감일은 접수 마감일보다 뒤여야 해요.');
    }
    for (const sel of [20, 25]) {
      const r = await post({ selectionDeadline: iso(sel) });
      expect(r.status, `선정 D+${sel}`).toBe(400);
      expect(r.body.error).toBe('선정 마감일은 출품 자료 제출 마감일보다 앞이어야 해요.');
    }
    expect((await post({ selectionDeadline: iso(11) })).status).toBe(201);
    expect((await post({ selectionDeadline: iso(19) })).status).toBe(201);
  });

  it('공모만 진행이어도 받는다 — 접수 마감보다 뒤면 된다', async () => {
    const r = await post({ recruitOnly: true, submissionDeadline: undefined, exhibitStartDate: undefined, exhibitDate: undefined, selectionDeadline: iso(50) });
    expect(r.status).toBe(201);
    expect((await post({ recruitOnly: true, submissionDeadline: undefined, exhibitStartDate: undefined, exhibitDate: undefined, selectionDeadline: undefined })).status).toBe(400);
  });

  it('아트링크 주최 등록도 같다', async () => {
    const hosted = (over: Record<string, unknown>) => request.post('/api/exhibitions/hosted').set('Authorization', `Bearer ${adminTok}`)
      .send({ ...body(over), galleryId: undefined, galleryIds: [] });
    expect((await hosted({ selectionDeadline: undefined })).status).toBe(400);
    expect((await hosted({ selectionDeadline: iso(9) })).status).toBe(400);
    expect((await hosted({})).status).toBe(201);
  });
});

describe('선정 마감일이 지나면 — 남은 검토 대기는 알림 없이 미선정 · 되돌릴 수 없다', () => {
  it('★ 지원자 목록을 열면 그 자리에서 정리된다 · 수락한 사람은 그대로 · 알림 없음 · 그 뒤 수락 400', async () => {
    const { exId, ids } = await selecting(-1, { 1: 'SUBMITTED', 2: 'ACCEPTED' });
    const list = await request.get(`/api/exhibitions/${exId}/applications`).set('Authorization', `Bearer ${ownerTok}`);
    expect(list.status).toBe(200);
    const byUser = Object.fromEntries(list.body.map((a: any) => [a.userId, a]));
    expect(byUser[1].status).toBe('REJECTED');
    expect(byUser[1].closedOutAt).toBeTruthy();
    expect(byUser[2].status).toBe('ACCEPTED');
    expect(await testPrisma.notification.count({ where: { type: 'APPLICATION_STATUS' } })).toBe(0);
    const r = await request.patch(`/api/exhibitions/${exId}/applications/${ids[1]}`).set('Authorization', `Bearer ${ownerTok}`).send({ status: 'ACCEPTED' });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe(SELECTION_FINISHED);
  });

  it('★ 작가의 [내 전시]도 열면 미선정으로 보인다(그 작가 것만 정리한다)', async () => {
    const { exId } = await selecting(-2);
    const r = await request.get('/api/exhibitions/my-applications').set('Authorization', `Bearer ${a1}`);
    expect(r.status).toBe(200);
    expect(r.body.find((a: any) => a.exhibitionId === exId).status).toBe('REJECTED');
    const other = await testPrisma.application.findFirstOrThrow({ where: { exhibitionId: exId, userId: 2 } });
    expect(other.status, '다른 작가 것은 그 작가가 볼 때(또는 훑기가)').toBe('SUBMITTED');
  });

  it('★ 선정 마감일 당일은 아직이다 — 하루 종일 수락할 수 있다(KST)', async () => {
    const { exId, ids } = await selecting(0);
    expect(await closeOutExpiredSelections()).toBe(0);
    const r = await request.patch(`/api/exhibitions/${exId}/applications/${ids[1]}`).set('Authorization', `Bearer ${ownerTok}`).send({ status: 'ACCEPTED' });
    expect(r.status).toBe(200);
  });

  it('훑기는 날짜가 지난 공모만 — 옛 공고(날짜 없음)·아직인 공모는 그대로', async () => {
    const past = await selecting(-3);
    const future = await selecting(5);
    const legacy = await seedExhibition(galleryId);
    await closeRecruitment(legacy.id);
    await testPrisma.application.create({ data: { userId: 1, exhibitionId: legacy.id, status: 'SUBMITTED' } });
    await sweepSelectionDeadlines();
    const statusOf = async (exId: number, userId: number) => (await testPrisma.application.findFirstOrThrow({ where: { exhibitionId: exId, userId } })).status;
    expect(await statusOf(past.exId, 1)).toBe('REJECTED');
    expect(await statusOf(past.exId, 2)).toBe('REJECTED');
    expect(await statusOf(future.exId, 1)).toBe('SUBMITTED');
    expect(await statusOf(legacy.id, 1)).toBe('SUBMITTED');
  });
});

describe('3일 전부터 알림 — 공고 주인에게 하루 한 번', () => {
  const notes = (userId = 3) => testPrisma.notification.findMany({ where: { userId, type: 'SELECTION_DEADLINE' }, orderBy: { id: 'asc' } });

  it('★ D-3 · D-2 · D-1 · 당일에 간다 · 같은 날 두 번 가지 않는다 · [지원자] 탭으로', async () => {
    const days = [3, 2, 1, 0];
    const made = [];
    for (const d of days) made.push(await selecting(d, { 1: 'SUBMITTED' }));
    expect(await sendSelectionReminders()).toBe(4);
    expect(await sendSelectionReminders(), '다시 훑어도 같은 날엔 또 보내지 않는다').toBe(0);
    const list = await notes();
    expect(list).toHaveLength(4);
    const byEx = Object.fromEntries(list.map((n) => [n.linkUrl, n]));
    for (const [i, d] of days.entries()) {
      const n = byEx[`/exhibitions/${made[i]!.exId}/operation/new?view=applicants`];
      expect(n, `D-${d}`).toBeTruthy();
      expect(n!.refKey).toBe(`selection-deadline:${made[i]!.exId}:${kstYmd(at(d))}:${d}`);
      expect(n!.message).toContain(d === 0 ? '선정 마감이 오늘이에요' : `선정 마감까지 ${d}일 남았어요`);
    }
  });

  it('★ 4일 이상 남았거나 · 지났거나 · 검토 대기가 없거나 · 아직 접수 중이면 보내지 않는다', async () => {
    await selecting(4, { 1: 'SUBMITTED' });
    await selecting(-1, { 1: 'SUBMITTED' });
    await selecting(2, { 1: 'ACCEPTED' });
    await selecting(2, { 1: 'SUBMITTED' }, { recruitmentClosed: false });   // 접수 마감일(30일 뒤) 전 — 아직 수락할 수 없다
    expect(await sendSelectionReminders()).toBe(0);
  });

  it('★ 선정 마감일을 늦추면 새 날짜 기준으로 다시 D-3 부터 알린다', async () => {
    const { exId } = await selecting(3, { 1: 'SUBMITTED' }, { deadline: at(-1), submissionDeadline: at(20) });
    expect(await sendSelectionReminders()).toBe(1);                     // 옛 날짜의 D-3
    const r = await request.patch(`/api/exhibitions/${exId}/selection-deadline`).set('Authorization', `Bearer ${ownerTok}`).send({ selectionDeadline: iso(10) });
    expect(r.status).toBe(200);
    // 새 날짜가 사흘 남은 날 — 옛 날짜 때 보낸 D-3 과 열쇠가 다르다
    expect(await sendSelectionReminders(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000))).toBe(1);
    const list = await notes();
    expect(list).toHaveLength(2);
    expect(list[1]!.refKey).toBe(`selection-deadline:${exId}:${kstYmd(at(10))}:3`);
  });

  it('접수 마감일이 지났으면 [모집 마감]을 안 눌렀어도 보낸다', async () => {
    await selecting(2, { 1: 'SUBMITTED' }, { recruitmentClosed: false, deadline: at(-1) });
    expect(await sendSelectionReminders()).toBe(1);
  });

  it('갤러리를 안 낀 아트링크 주최 공모는 관리자에게', async () => {
    const { exId } = await selecting(1, { 1: 'SUBMITTED' });
    await testPrisma.exhibition.update({ where: { id: exId }, data: { hostType: 'ADMIN', galleryId: null } });
    await sendSelectionReminders();
    expect(await notes(4)).toHaveLength(1);
    expect(await notes(3)).toHaveLength(0);
  });

  it('문구 — 며칠 남았는지 · 당일엔 오늘이 지나면 미선정', () => {
    expect(selectionReminderMessage('봄 기획전', at(3), 4)).toBe(`"봄 기획전" 선정 마감까지 3일 남았어요 (${kstMonthDay(at(3))}). 검토 대기 4명이 남아 있어요.`);
    expect(kstMonthDay(new Date('2026-11-30T00:00:00Z'))).toBe('11.30');
    expect(selectionReminderMessage('봄 기획전', at(0), 2)).toBe('"봄 기획전" 선정 마감이 오늘이에요. 오늘이 지나면 검토 대기 2명은 미선정이 돼요.');
  });
});

describe('[선정 마감일 변경] — 지나기 전까지 · 주최자만', () => {
  const change = (exId: number, d: number | string, tok = ownerTok) =>
    request.patch(`/api/exhibitions/${exId}/selection-deadline`).set('Authorization', `Bearer ${tok}`).send({ selectionDeadline: typeof d === 'number' ? iso(d) : d });

  it('★ 바꾼다 — 접수 마감 뒤 · 출품 자료 마감 전 · 오늘 이후', async () => {
    const { exId } = await selecting(3, {}, { deadline: at(-1), submissionDeadline: at(10) });
    const r = await change(exId, 6);
    expect(r.status).toBe(200);
    expect(daysUntilKst(new Date(r.body.selectionDeadline))).toBe(6);
    expect((await change(exId, 10)).status, '출품 자료 마감과 같은 날').toBe(400);
    expect((await change(exId, -1)).status, '접수 마감과 같은 날 · 지난 날').toBe(400);
    expect((await change(exId, '')).status).toBe(400);
  });

  it('★ 이미 지났으면 못 바꾼다 — 지나서 미선정이 된 사람을 되살리지 않는다', async () => {
    const { exId } = await selecting(-1);
    const r = await change(exId, 5);
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('선정 마감일이 지나 바꿀 수 없어요.');
  });

  it('옛 공고(날짜 없음)에는 새로 정하지 않는다', async () => {
    const ex = await seedExhibition(galleryId);
    const r = await change(ex.id, 40);
    expect(r.status).toBe(400);
  });

  it('★ 아트링크 주최 공모는 관리자만 · 남의 갤러리 403 · 작가 403', async () => {
    const { exId } = await selecting(3, {}, { hostType: 'ADMIN', deadline: at(-1) });
    expect((await change(exId, 5)).status).toBe(403);
    expect((await change(exId, 5, adminTok)).status).toBe(200);
    expect((await change(exId, 6, a1)).status).toBe(403);
  });
});

describe('다른 날짜를 바꿀 때도 순서를 지킨다', () => {
  it('출품 자료 마감은 선정 마감 뒤여야 한다', async () => {
    const ex = await seedExhibition(galleryId);
    await testPrisma.exhibition.update({ where: { id: ex.id }, data: { deadline: at(5), selectionDeadline: at(10), submissionDeadline: null, exhibitStartDate: at(30) } });
    const r = await request.patch(`/api/exhibitions/${ex.id}/submission-deadline`).set('Authorization', `Bearer ${ownerTok}`).send({ submissionDeadline: iso(8) });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('선정 마감일은 출품 자료 제출 마감일보다 앞이어야 해요.');
    expect((await request.patch(`/api/exhibitions/${ex.id}/submission-deadline`).set('Authorization', `Bearer ${ownerTok}`).send({ submissionDeadline: iso(12) })).status).toBe(200);
  });

  it('수정 요청으로 접수 마감을 선정 마감 뒤로 미루면 승인에서 막힌다', async () => {
    const ex = await seedExhibition(galleryId);
    await testPrisma.exhibition.update({ where: { id: ex.id }, data: { deadline: at(5), selectionDeadline: at(10) } });
    const req = await request.post('/api/approvals/edit-request').set('Authorization', `Bearer ${ownerTok}`)
      .send({ type: 'EXHIBITION_EDIT', targetId: ex.id, changes: { deadline: iso(12) } });
    expect(req.status).toBe(201);
    const approve = await request.patch(`/api/approvals/edit-request/${req.body.id}`).set('Authorization', `Bearer ${adminTok}`).send({ status: 'APPROVED' });
    expect(approve.status).toBe(400);
    expect(approve.body.error).toBe('선정 마감일은 접수 마감일보다 뒤여야 해요.');
  });
});
