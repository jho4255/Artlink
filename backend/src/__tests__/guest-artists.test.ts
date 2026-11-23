/**
 * 비회원 작가 (2026-11-23, CLAUDE.md 규칙 91) — 공모 운영자가 가입하지 않은 작가를 넣고 출품 자료·판매·정산을 대신 채운다.
 *
 * 사용자 결정: 정원에 안 센다 · 작가 탭(갤러리 [작가])에 안 나온다 · 사용자 관리에 안 넣는다 · 나중에 가입해도 이어 주지 않는다.
 * 정산 확인 요청은 회원 작가에게만(비회원은 받을 수 없다) — 비회원만 있는 공모는 확인 요청 없이 마친다.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { request, testPrisma, authToken, cleanDb, seedUsers, seedGallery, seedExhibition } from './helpers';
import { GUEST_LIMIT, GUEST_ROLE, guestEmail } from '../lib/guestArtists';
import { countSelected } from '../lib/inviteCode';

const ownerTok = authToken(3, 'GALLERY');
const a1 = authToken(1, 'ARTIST');
const adminTok = authToken(4, 'ADMIN');

const FULL = {
  artworkList: [{ title: '봄의 문턱', size: '53x45.5', medium: '캔버스에 유채', year: '2026', price: '1200000' }],
  cv: { nameKo: '한지우', solo: [{ year: '2025', content: '개인전' }] },
  note: { statement: '작가노트입니다', sections: [] },
};

describe('비회원 작가', () => {
  let exId: number;
  let galleryId: number;
  const api = (method: 'get' | 'post' | 'patch' | 'put' | 'delete', path: string, tok = ownerTok) =>
    (request as any)[method](`/api/operations/${exId}${path}`).set('Authorization', `Bearer ${tok}`);
  const addGuest = async (name = '한지우', tok = ownerTok) => {
    const res = await api('post', '/guest-artists', tok).send({ name });
    return res;
  };

  beforeEach(async () => {
    await cleanDb();
    await seedUsers();
    const gallery = await seedGallery(3);
    galleryId = gallery.id;
    const ex = await seedExhibition(gallery.id);
    exId = ex.id;
  });

  describe('넣기 · 권한', () => {
    it('★ 운영자가 이름만 넣으면 로그인할 수 없는 계정 + 연결 한 줄 — 지원이 아니다', async () => {
      const res = await addGuest('  한지우  ');
      expect(res.status).toBe(201);
      expect(res.body.user).toMatchObject({ name: '한지우', email: null, guest: true });
      const user = await testPrisma.user.findUnique({ where: { id: res.body.user.id } });
      expect(user).toMatchObject({ role: GUEST_ROLE, password: null, providerId: null });
      expect(user!.email.endsWith('@guest.artlink.invalid')).toBe(true);
      expect(await testPrisma.application.count({ where: { exhibitionId: exId } })).toBe(0);
      expect(await testPrisma.exhibitionGuestArtist.count({ where: { exhibitionId: exId, createdById: 3 } })).toBe(1);
    });

    it('이름이 비었거나 너무 길면 400', async () => {
      expect((await addGuest('   ')).status).toBe(400);
      expect((await addGuest('가'.repeat(41))).status).toBe(400);
    });

    it('운영자·관리자만 — 작가·다른 갤러리는 403', async () => {
      expect((await addGuest('A', a1)).status).toBe(403);
      await testPrisma.user.create({ data: { id: 50, email: 'g2@test.com', name: 'G2', role: 'GALLERY' } });
      expect((await addGuest('A', authToken(50, 'GALLERY'))).status).toBe(403);
      expect((await addGuest('A', adminTok)).status).toBe(201);
    });

    it('공모만 진행하는 공고 · 승인 전 · 정산 완료 · 전시 종료(관리자 빼고)에는 넣지 못한다', async () => {
      await testPrisma.exhibition.update({ where: { id: exId }, data: { recruitOnly: true } });
      expect((await addGuest()).status).toBe(400);
      await testPrisma.exhibition.update({ where: { id: exId }, data: { recruitOnly: false, status: 'PENDING' } });
      expect((await addGuest()).status).toBe(400);
      await testPrisma.exhibition.update({ where: { id: exId }, data: { status: 'APPROVED', ended: true, confirmed: true } });
      expect((await addGuest()).status).toBe(400);
      expect((await addGuest('관리자가', adminTok)).status).toBe(201);
      await testPrisma.exhibition.update({ where: { id: exId }, data: { settledAt: new Date() } });
      expect((await addGuest()).status).toBe(403);
    });

    it(`공모 하나에 ${GUEST_LIMIT}명까지 — 동시에 넣어도 넘지 않는다`, async () => {
      const users = await Promise.all(Array.from({ length: GUEST_LIMIT - 2 }, (_, i) =>
        testPrisma.user.create({ data: { email: guestEmail(), name: `G${i}`, role: GUEST_ROLE, provider: 'GUEST' }, select: { id: true } })));
      await testPrisma.exhibitionGuestArtist.createMany({ data: users.map((u) => ({ exhibitionId: exId, userId: u.id })) });
      const results = await Promise.all(Array.from({ length: 5 }, (_, i) => addGuest(`동시${i}`)));
      expect(results.filter((r) => r.status === 201)).toHaveLength(2);
      expect(results.filter((r) => r.status === 400)).toHaveLength(3);
      expect(await testPrisma.exhibitionGuestArtist.count({ where: { exhibitionId: exId } })).toBe(GUEST_LIMIT);
    });
  });

  describe('정원 · 지원자 · 공개 화면에는 안 들어간다', () => {
    it('★ 정원(선정 인원)에 세지 않는다 · 지원자 목록에 없다', async () => {
      await addGuest();
      await addGuest('두번째');
      expect(await countSelected(testPrisma, exId)).toBe(0);
      const apps = await request.get(`/api/exhibitions/${exId}/applications`).set('Authorization', `Bearer ${ownerTok}`);
      expect(apps.status).toBe(200);
      expect(apps.body).toHaveLength(0);
    });

    it('★ 갤러리 홈페이지 [작가](함께한 작가)에 안 나온다', async () => {
      const g = (await addGuest()).body.user;
      await testPrisma.exhibitionSubmission.create({ data: { exhibitionId: exId, userId: g.id, artworkList: JSON.stringify(FULL.artworkList) } });
      const res = await request.get(`/api/galleries/${galleryId}`);
      expect(res.status).toBe(200);
      expect((res.body.artists ?? []).map((a: any) => a.id)).not.toContain(g.id);
    });

    it('★ 사용자 관리(표·찾기·배열)·회원 통계·멘션에 안 나온다', async () => {
      const g = (await addGuest('숨은작가')).body.user;
      const paged = await request.get('/api/admin/users?paged=1').set('Authorization', `Bearer ${adminTok}`);
      expect(paged.status).toBe(200);
      expect(paged.body.rows.map((u: any) => u.id)).not.toContain(g.id);
      expect(paged.body.total).toBe(4);
      const found = await request.get('/api/admin/users?paged=1&q=' + encodeURIComponent('숨은')).set('Authorization', `Bearer ${adminTok}`);
      expect(found.body.rows).toHaveLength(0);
      const arr = await request.get('/api/admin/users').set('Authorization', `Bearer ${adminTok}`);
      expect(arr.body.map((u: any) => u.id)).not.toContain(g.id);
      // 역할 칸은 정해진 값만 받는다 — 비회원 작가 계정만 따로 볼 길도 없다
      expect((await request.get('/api/admin/users?role=GUEST').set('Authorization', `Bearer ${adminTok}`)).status).toBe(400);
      const members = await request.get('/api/admin/stats/members?days=30').set('Authorization', `Bearer ${adminTok}`);
      expect(members.status).toBe(200);
      expect(JSON.stringify(members.body)).not.toContain('GUEST');
      const mentions = await request.get('/api/mentions?q=' + encodeURIComponent('숨은')).set('Authorization', `Bearer ${adminTok}`);
      expect((mentions.body ?? []).map((u: any) => u.id)).not.toContain(g.id);
    });

    it('★ 이웃 · 대화(관리자도) · 방명록 · 홈페이지는 404', async () => {
      const g = (await addGuest()).body.user;
      expect((await request.post(`/api/follow/${g.id}`).set('Authorization', `Bearer ${a1}`)).status).toBe(404);
      expect((await request.post('/api/chats/direct').set('Authorization', `Bearer ${adminTok}`).send({ userId: g.id })).status).toBe(404);
      expect((await request.post(`/api/guestbook/${g.id}`).set('Authorization', `Bearer ${a1}`).send({ body: '안녕하세요' })).status).toBe(404);
      expect((await request.get(`/api/portfolio/${g.id}`)).status).toBe(404);
    });
  });

  describe('출품 자료 · 캡션', () => {
    it('★ 출품 자료 목록에 회원 다음으로 나온다(guest · 주소 없음) · 대신 입력은 알림 없이 저장', async () => {
      await testPrisma.application.create({ data: { userId: 1, exhibitionId: exId, status: 'ACCEPTED' } });
      const g = (await addGuest()).body.user;
      const save = await api('put', `/submissions/${g.id}`).send(FULL);
      expect(save.status).toBe(200);
      const list = await api('get', '/submissions');
      expect(list.status).toBe(200);
      expect(list.body.map((r: any) => r.user.id)).toEqual([1, g.id]);
      expect(list.body[0].guest).toBe(false);
      expect(list.body[1]).toMatchObject({ guest: true, user: { email: null, guest: true } });
      expect(list.body[1].submission.artworkList).toHaveLength(1);
      expect(await testPrisma.notification.count({ where: { userId: g.id } })).toBe(0);
      const one = await api('get', `/submissions/${g.id}`);
      expect(one.status).toBe(200);
      expect(one.body.user.email).toBeNull();
    });

    it('남의 공모 비회원 작가는 대신 입력할 수 없다(404)', async () => {
      const other = await seedExhibition(galleryId);
      const res = await request.post(`/api/operations/${other.id}/guest-artists`).set('Authorization', `Bearer ${ownerTok}`).send({ name: '다른공모' });
      expect(res.status).toBe(201);
      expect((await api('put', `/submissions/${res.body.user.id}`).send(FULL)).status).toBe(404);
    });

    it('★ 캡션 한글 파일에 비회원 작가의 출품작이 들어간다(비회원 작품만 있어도 만든다)', async () => {
      const g = (await addGuest()).body.user;
      expect((await api('get', '/caption.hwp')).status).toBe(400);   // 출품작이 없다
      await api('put', `/submissions/${g.id}`).send(FULL);
      const res = await api('get', '/caption.hwp');
      expect(res.status).toBe(200);
    });

    it('★ [내 공모] 출품 자료 칸 — 필요 = 수락 + 비회원 · 비회원 미완료 수를 따로 준다', async () => {
      await testPrisma.application.create({ data: { userId: 1, exhibitionId: exId, status: 'ACCEPTED' } });
      const g = (await addGuest()).body.user;
      await addGuest('둘째');
      await api('put', `/submissions/${g.id}`).send(FULL);
      const res = await request.get('/api/exhibitions/my-operation-overview').set('Authorization', `Bearer ${ownerTok}`);
      const row = res.body.find((r: any) => r.id === exId);
      expect(row.counts.applications.accepted).toBe(1);
      expect(row.counts.submissions).toMatchObject({ required: 3, complete: 1, guests: 2, guestIncomplete: 1 });
    });

    it('출품 자료 알림의 (n/m) 에 비회원 작가가 든다 — 다 모이기 전에 "모두 모였어요"라 하지 않는다', async () => {
      await testPrisma.application.create({ data: { userId: 1, exhibitionId: exId, status: 'ACCEPTED' } });
      await addGuest();
      expect((await request.put(`/api/operations/${exId}/me`).set('Authorization', `Bearer ${a1}`).send(FULL)).status).toBe(200);
      const note = await testPrisma.notification.findFirst({ where: { userId: 3, type: 'SUBMISSION_RECEIVED' } });
      expect(note!.message).toContain('(1/2)');
      expect(note!.message).not.toContain('모두 모였어요');
    });
  });

  describe('이름 바꾸기 · 빼기', () => {
    it('이름을 바꾼다 · 이 공모의 비회원이 아니면 404', async () => {
      const g = (await addGuest()).body.user;
      const res = await api('patch', `/guest-artists/${g.id}`).send({ name: '한 지우' });
      expect(res.status).toBe(200);
      expect((await testPrisma.user.findUnique({ where: { id: g.id } }))!.name).toBe('한 지우');
      expect((await api('patch', '/guest-artists/1').send({ name: 'x' })).status).toBe(404);
    });

    it('★ 빼면 계정·출품 자료가 사라진다 · 판매 기록이 있으면(관리자도) 뺄 수 없다', async () => {
      const g = (await addGuest()).body.user;
      await api('put', `/submissions/${g.id}`).send(FULL);
      await testPrisma.artworkSale.create({ data: { exhibitionId: exId, artistUserId: g.id, artworkIndex: 0, title: '봄의 문턱', soldPrice: 1000 } });
      expect((await api('delete', `/guest-artists/${g.id}`, adminTok)).status).toBe(400);
      await testPrisma.artworkSale.deleteMany({ where: { artistUserId: g.id } });
      await testPrisma.artistSettlement.create({ data: { exhibitionId: exId, artistUserId: g.id, galleryRatio: 30 } });
      expect((await api('delete', `/guest-artists/${g.id}`)).status).toBe(200);
      expect(await testPrisma.user.findUnique({ where: { id: g.id } })).toBeNull();
      expect(await testPrisma.exhibitionSubmission.count({ where: { userId: g.id } })).toBe(0);
      expect(await testPrisma.artistSettlement.count({ where: { artistUserId: g.id } })).toBe(0);
    });

    it('회원 작가는 이 길로 지울 수 없다(404)', async () => {
      await testPrisma.application.create({ data: { userId: 1, exhibitionId: exId, status: 'ACCEPTED' } });
      expect((await api('delete', '/guest-artists/1', adminTok)).status).toBe(404);
      expect(await testPrisma.user.findUnique({ where: { id: 1 } })).not.toBeNull();
    });

    it('★ 공모를 지우면 그 공모의 비회원 작가 계정도 지운다', async () => {
      const g = (await addGuest()).body.user;
      await api('put', `/submissions/${g.id}`).send(FULL);
      const del = await request.delete(`/api/exhibitions/${exId}`).set('Authorization', `Bearer ${adminTok}`);
      expect(del.status).toBe(200);
      expect(await testPrisma.user.findUnique({ where: { id: g.id } })).toBeNull();
    });
  });

  describe('정산', () => {
    const sale = (uid: number) => ({ artistUserId: uid, artworkIndex: 0, title: '봄의 문턱', soldPrice: 1200000, paymentMethod: 'CASH' });

    beforeEach(async () => {
      await testPrisma.exhibition.update({ where: { id: exId }, data: { recruitmentClosed: true } });
    });

    it('★ 회원 + 비회원 — 판매는 둘 다 저장 · 확인 요청은 회원만 · 회원이 확인하면 정산 완료', async () => {
      await testPrisma.application.create({ data: { userId: 1, exhibitionId: exId, status: 'ACCEPTED' } });
      const g = (await addGuest()).body.user;
      await request.put(`/api/operations/${exId}/me`).set('Authorization', `Bearer ${a1}`).send(FULL);
      await api('put', `/submissions/${g.id}`).send(FULL);
      await testPrisma.exhibition.update({ where: { id: exId }, data: { confirmed: true, ended: true } });

      const put = await api('put', '/settlement').send({ sales: [sale(1), sale(g.id)], ratios: [{ artistUserId: 1, galleryRatio: 30 }, { artistUserId: g.id, galleryRatio: 30 }] });
      expect(put.status).toBe(200);
      expect(await testPrisma.artworkSale.count({ where: { exhibitionId: exId } })).toBe(2);

      const view = await api('get', '/settlement');
      const guestRow = view.body.artists.find((a: any) => a.user.id === g.id);
      expect(guestRow).toMatchObject({ guest: true, approval: null, user: { email: null } });
      expect(guestRow.artistAmount).toBe(840000);

      const req = await api('post', '/settlement/request');
      expect(req.status).toBe(200);
      expect(req.body.requestedCount).toBe(1);
      expect(await testPrisma.settlementApproval.count({ where: { exhibitionId: exId, artistUserId: g.id } })).toBe(0);
      expect(await testPrisma.notification.count({ where: { userId: g.id } })).toBe(0);
      expect((await api('post', `/settlement/request/artist/${g.id}`)).status).toBe(400);

      expect((await api('post', '/settlement/complete')).status).toBe(400);   // 회원이 아직
      const respond = await request.post(`/api/operations/${exId}/settlement/respond`).set('Authorization', `Bearer ${a1}`).send({ approve: true });
      expect(respond.status).toBe(200);
      expect((await api('get', '/settlement')).body.allApproved).toBe(true);
      const done = await api('post', '/settlement/complete');
      expect(done.status).toBe(200);
      expect(await testPrisma.notification.count({ where: { userId: g.id } })).toBe(0);
    });

    it('★ 비회원만 있는 공모는 확인 요청 없이 정산을 마친다(요청 시각도 함께 적힌다)', async () => {
      const g = (await addGuest()).body.user;
      await api('put', `/submissions/${g.id}`).send(FULL);
      await testPrisma.exhibition.update({ where: { id: exId }, data: { confirmed: true, ended: true } });
      expect((await api('put', '/settlement').send({ sales: [sale(g.id)], ratios: [{ artistUserId: g.id, galleryRatio: 40 }] })).status).toBe(200);
      expect((await api('get', '/settlement')).body.allApproved).toBe(true);
      const done = await api('post', '/settlement/complete');
      expect(done.status).toBe(200);
      const ex = await testPrisma.exhibition.findUnique({ where: { id: exId } });
      expect(ex!.settledAt).not.toBeNull();
      expect(ex!.settlementRequestedAt).not.toBeNull();
    });

    it('회원이 있으면 여전히 확인 요청 없이는 마칠 수 없다', async () => {
      await testPrisma.application.create({ data: { userId: 1, exhibitionId: exId, status: 'ACCEPTED' } });
      await addGuest();
      await testPrisma.exhibition.update({ where: { id: exId }, data: { confirmed: true, ended: true } });
      expect((await api('post', '/settlement/complete')).status).toBe(400);
    });

    it('남의 공모 비회원 작가의 판매는 저장하지 않는다', async () => {
      const other = await seedExhibition(galleryId);
      const res = await request.post(`/api/operations/${other.id}/guest-artists`).set('Authorization', `Bearer ${ownerTok}`).send({ name: '다른공모' });
      await testPrisma.exhibitionSubmission.create({ data: { exhibitionId: exId, userId: res.body.user.id, artworkList: JSON.stringify(FULL.artworkList) } });
      await testPrisma.exhibition.update({ where: { id: exId }, data: { confirmed: true, ended: true } });
      expect((await api('put', '/settlement').send({ sales: [sale(res.body.user.id)], ratios: [] })).status).toBe(200);
      expect(await testPrisma.artworkSale.count({ where: { exhibitionId: exId } })).toBe(0);
    });
  });
});
