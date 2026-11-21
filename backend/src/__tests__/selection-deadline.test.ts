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

/**
 * 정원을 다 뽑으면 선정이 끝난다 (2026-11-21 사용자 결정 — "정원 다 뽑으면 자동으로 선정 마치기").
 * 선정 기간(접수가 끝난 뒤)에 수락 수가 정원에 닿으면 남은 검토 대기는 **알림 없이** 미선정(`closedOutAt`) — 되돌릴 수 없다.
 * 갤러리 수락 · 초대 코드 참여 · 모집 인원 변경 · 모집 마감이 그 자리에서, 접수 마감일이 지나 저절로 선정이 시작된 공모는 읽을 때 정리한다.
 */
describe('정원을 다 뽑으면 선정이 끝난다', () => {
  const accept = (exId: number, appId: number, tok = ownerTok) =>
    request.patch(`/api/exhibitions/${exId}/applications/${appId}`).set('Authorization', `Bearer ${tok}`).send({ status: 'ACCEPTED' });
  const statusOf = async (exId: number, userId: number) => testPrisma.application.findFirstOrThrow({ where: { exhibitionId: exId, userId } });
  const extraArtists = async (ids: number[]) => {
    for (const id of ids) await testPrisma.user.upsert({ where: { id }, create: { id, email: `artist${id}@test.com`, name: `Artist ${id}`, role: 'ARTIST' }, update: {} });
  };
  const statusNotes = (userId: number) => testPrisma.notification.count({ where: { userId, type: 'APPLICATION_STATUS' } });

  it('★ 마지막 자리를 수락하면 남은 검토 대기는 그 자리에서 미선정 — 알림 없음 · 응답에 그 수 · 다시 수락할 수 없다(새 공고·옛 공고)', async () => {
    await extraArtists([101]);
    for (const sel of [5, null]) {
      const { exId, ids } = await selecting(5, { 1: 'SUBMITTED', 2: 'SUBMITTED', 101: 'SUBMITTED' }, { capacity: 2, selectionDeadline: sel == null ? null : at(sel) });
      const first = await accept(exId, ids[1]!);
      expect(first.status).toBe(200);
      expect(first.body.closedOut, '아직 한 자리가 남았다').toBe(0);
      expect((await statusOf(exId, 2)).status).toBe('SUBMITTED');
      const last = await accept(exId, ids[2]!);
      expect(last.status).toBe(200);
      expect(last.body.closedOut, `선정 마감일 ${sel}`).toBe(1);
      const left = await statusOf(exId, 101);
      expect(left.status).toBe('REJECTED');
      expect(left.closedOutAt).not.toBeNull();
      // 미선정에는 알림이 없다(선정된 두 명만 받는다)
      expect(await testPrisma.notification.count({ where: { userId: 101, type: 'APPLICATION_STATUS', message: { contains: 'Test Exhibition' } } })).toBe(0);
      const again = await accept(exId, ids[101]!);
      expect(again.status).toBe(400);
      expect(again.body.error).toBe(SELECTION_FINISHED);
    }
  });

  it('★ 동시에 수락해도 정원을 넘지 않는다 — 남은 2자리에 4건이면 수락 2 · 나머지 미선정 · 500 없음', async () => {
    await extraArtists([101, 102]);
    for (let round = 0; round < 3; round++) {
      const { exId, ids } = await selecting(5, { 1: 'SUBMITTED', 2: 'SUBMITTED', 101: 'SUBMITTED', 102: 'SUBMITTED' }, { capacity: 2 });
      const res = await Promise.all([1, 2, 101, 102].map((u) => accept(exId, ids[u]!)));
      expect(res.every((r) => r.status === 200 || r.status === 400), `회차 ${round}: ${res.map((r) => r.status)}`).toBe(true);
      expect(res.filter((r) => r.status === 200)).toHaveLength(2);
      const apps = await testPrisma.application.findMany({ where: { exhibitionId: exId } });
      expect(apps.filter((a) => a.status === 'ACCEPTED')).toHaveLength(2);
      expect(apps.filter((a) => a.status === 'REJECTED' && a.closedOutAt)).toHaveLength(2);
    }
  });

  it('★ 초대 코드 — 접수 중엔 정원이 차도 그대로 · 선정 기간이면 끝', async () => {
    await extraArtists([101]);
    const a101 = authToken(101, 'ARTIST');
    const join = (code: string, tok: string) => request.post('/api/exhibitions/join').set('Authorization', `Bearer ${tok}`).send({ code });
    // 접수 중 — 코드로 정원(1)이 차도 검토 대기는 그대로(작가가 아직 지원서를 고치거나 취소할 수 있다)
    const open = await seedExhibition(galleryId);
    await testPrisma.exhibition.update({ where: { id: open.id }, data: { capacity: 1 } });
    await testPrisma.application.create({ data: { userId: 1, exhibitionId: open.id, status: 'SUBMITTED' } });
    await testPrisma.exhibitionJoinCode.create({ data: { exhibitionId: open.id, code: 'ABCD2345' } });
    expect([200, 201]).toContain((await join('ABCD2345', a101)).status);
    expect((await statusOf(open.id, 1)).status).toBe('SUBMITTED');
    // 선정 기간 — 코드로 마지막 자리가 차면 남은 검토 대기는 미선정
    const { exId } = await selecting(5, { 1: 'SUBMITTED', 2: 'ACCEPTED' }, { capacity: 2 });
    await testPrisma.exhibitionJoinCode.create({ data: { exhibitionId: exId, code: 'EFGH6789' } });
    expect([200, 201]).toContain((await join('EFGH6789', a101)).status);
    const left = await statusOf(exId, 1);
    expect(left.status).toBe('REJECTED');
    expect(left.closedOutAt).not.toBeNull();
  });

  it('★ 모집 인원을 수락한 수만큼으로 줄이면 끝 — 접수 중엔 그대로', async () => {
    const change = (exId: number, capacity: number) => request.patch(`/api/exhibitions/${exId}/capacity`).set('Authorization', `Bearer ${ownerTok}`).send({ capacity });
    const { exId } = await selecting(5, { 1: 'ACCEPTED', 2: 'SUBMITTED' }, { capacity: 3 });
    const r = await change(exId, 1);
    expect(r.status).toBe(200);
    expect(r.body.closedOut).toBe(1);
    expect((await statusOf(exId, 2)).status).toBe('REJECTED');
    // 접수 중
    const open = await seedExhibition(galleryId);
    await testPrisma.application.createMany({ data: [{ userId: 1, exhibitionId: open.id, status: 'ACCEPTED' }, { userId: 2, exhibitionId: open.id, status: 'SUBMITTED' }] });
    const r2 = await change(open.id, 1);
    expect(r2.status).toBe(200);
    expect(r2.body.closedOut).toBe(0);
    expect((await statusOf(open.id, 2)).status).toBe('SUBMITTED');
  });

  it('★ 모집 마감 때 이미 정원이 차 있으면(초대 코드) 마감과 함께 끝 — 아니면 그대로', async () => {
    const close = (exId: number) => request.patch(`/api/operations/${exId}/lifecycle`).set('Authorization', `Bearer ${ownerTok}`).send({ recruitmentClosed: true });
    const full = await seedExhibition(galleryId);
    await testPrisma.exhibition.update({ where: { id: full.id }, data: { capacity: 1 } });
    await testPrisma.application.createMany({ data: [{ userId: 1, exhibitionId: full.id, status: 'ACCEPTED', joinedVia: 'CODE' }, { userId: 2, exhibitionId: full.id, status: 'SUBMITTED' }] });
    const r = await close(full.id);
    expect(r.status).toBe(200);
    expect(r.body.rejectedCount).toBe(1);
    expect((await statusOf(full.id, 2)).status).toBe('REJECTED');
    const room = await seedExhibition(galleryId);
    await testPrisma.application.createMany({ data: [{ userId: 1, exhibitionId: room.id, status: 'ACCEPTED', joinedVia: 'CODE' }, { userId: 2, exhibitionId: room.id, status: 'SUBMITTED' }] });
    const r2 = await close(room.id);
    expect(r2.body.rejectedCount).toBe(0);
    expect((await statusOf(room.id, 2)).status).toBe('SUBMITTED');
  });

  it('★ 접수 마감일이 지나 저절로 선정이 시작됐는데 정원이 이미 차 있으면 — 지원자 목록·훑기가 정리한다', async () => {
    const ex = await seedExhibition(galleryId);
    await testPrisma.exhibition.update({ where: { id: ex.id }, data: { capacity: 1, deadline: at(-1) } });
    await testPrisma.application.createMany({ data: [{ userId: 1, exhibitionId: ex.id, status: 'ACCEPTED', joinedVia: 'CODE' }, { userId: 2, exhibitionId: ex.id, status: 'SUBMITTED' }] });
    expect(await closeOutExpiredSelections({ exhibitionIds: [ex.id] })).toBe(1);
    expect((await statusOf(ex.id, 2)).status).toBe('REJECTED');
    // 아직 접수 중이면 정원이 차 있어도 그대로
    const open = await seedExhibition(galleryId);
    await testPrisma.exhibition.update({ where: { id: open.id }, data: { capacity: 1 } });
    await testPrisma.application.createMany({ data: [{ userId: 1, exhibitionId: open.id, status: 'ACCEPTED', joinedVia: 'CODE' }, { userId: 2, exhibitionId: open.id, status: 'SUBMITTED' }] });
    await sweepSelectionDeadlines();
    expect((await statusOf(open.id, 2)).status).toBe('SUBMITTED');
    expect(await statusNotes(2)).toBe(0);
  });
});
