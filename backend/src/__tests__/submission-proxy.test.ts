/**
 * 갤러리/Admin 이 작가 제출자료를 대신 입력 (`PUT /operations/:id/submissions/:userId`)
 *
 * ── 왜 있나 ────────────────────────────────────────────────
 * 출품 자료를 직접 올리기 어려워하는 작가(주로 고령)가 있어, 갤러리가 전화·종이로 받은 내용을
 * 대신 넣어줘야 실무가 굴러간다. 안 그러면 그 작가만 캡션·엽서에서 통째로 빠진다.
 *
 * ── 여기서 반드시 지켜야 하는 것 ────────────────────────────
 * ⚠️ **대상은 이 공모의 수락 작가만.** 임의 userId 를 넘겨 남의 자료를 만들거나 덮어쓸 수 있으면
 *    다른 공모 작가의 자료가 조용히 오염된다.
 * ⚠️ 다른 작가·제3자는 이 경로로 아무것도 못 한다(403).
 * ⚠️ 잠금은 작가 본인과 **같은 규칙**(확정되면 잠김). 갤러리만 열어두면 확정 후 자료가 바뀌어
 *    이미 인쇄한 캡션·엽서와 어긋난다.
 * ⚠️ 누가 썼는지 남기고 작가에게 알린다 — 본인 모르게 자기 이름의 자료가 바뀌면 안 된다.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { request, testPrisma, authToken, cleanDb, seedUsers, seedGallery, seedExhibition } from './helpers';

const ownerTok = authToken(3, 'GALLERY');
const adminTok = authToken(4, 'ADMIN');
const artist1Tok = authToken(1, 'ARTIST');
const artist2Tok = authToken(2, 'ARTIST');

const WORK = { title: '대신 넣은 작품', size: '100x100', medium: '유화', year: '2026', price: '1000000' };

describe('작가 자료 대신 입력', () => {
  let exId: number;

  const proxyPut = (tok: string, userId: number, body: any) =>
    request.put(`/api/operations/${exId}/submissions/${userId}`).set('Authorization', `Bearer ${tok}`).send(body);
  const proxyGet = (tok: string, userId: number) =>
    request.get(`/api/operations/${exId}/submissions/${userId}/edit`).set('Authorization', `Bearer ${tok}`);

  beforeEach(async () => {
    await cleanDb();
    await seedUsers();
    const gallery = await seedGallery(3);
    const ex = await seedExhibition(gallery.id);
    exId = ex.id;
    // artist1 = 수락, artist2 = 접수(미수락)
    await testPrisma.application.create({ data: { userId: 1, exhibitionId: exId, status: 'ACCEPTED' } });
    await testPrisma.application.create({ data: { userId: 2, exhibitionId: exId, status: 'SUBMITTED' } });
  });

  describe('권한', () => {
    it('갤러리 오너가 수락 작가의 자료를 대신 저장할 수 있다', async () => {
      const r = await proxyPut(ownerTok, 1, { artworkList: [WORK], cv: null, note: null });
      expect(r.status).toBe(200);
      expect(r.body.artworkList[0].title).toBe('대신 넣은 작품');

      // 작가 본인 화면에도 그대로 보인다
      const mine = await request.get(`/api/operations/${exId}/me`).set('Authorization', `Bearer ${artist1Tok}`);
      expect(mine.body.artworkList[0].title).toBe('대신 넣은 작품');
    });

    it('Admin 도 할 수 있다', async () => {
      expect((await proxyPut(adminTok, 1, { artworkList: [WORK], cv: null, note: null })).status).toBe(200);
    });

    it('다른 작가는 남의 자료를 건드릴 수 없다 → 403', async () => {
      const r = await proxyPut(artist2Tok, 1, { artworkList: [WORK], cv: null, note: null });
      expect(r.status).toBe(403);
      expect((await proxyGet(artist2Tok, 1)).status).toBe(403);
    });

    it('작가 본인도 이 경로는 쓸 수 없다 → 403 (본인은 PUT /me)', async () => {
      expect((await proxyPut(artist1Tok, 1, { artworkList: [WORK], cv: null, note: null })).status).toBe(403);
    });

    it('비로그인 → 401', async () => {
      const r = await request.put(`/api/operations/${exId}/submissions/1`).send({ artworkList: [WORK] });
      expect(r.status).toBe(401);
    });
  });

  describe('대상 검증 — 아무 userId 나 받으면 안 된다', () => {
    it('수락되지 않은 작가(접수 상태)는 404', async () => {
      const r = await proxyPut(ownerTok, 2, { artworkList: [WORK], cv: null, note: null });
      expect(r.status).toBe(404);
      const rows = await testPrisma.exhibitionSubmission.findMany({ where: { exhibitionId: exId, userId: 2 } });
      expect(rows).toHaveLength(0);   // 고아 레코드가 생기지 않는다
    });

    it('이 공모에 지원조차 안 한 사람은 404', async () => {
      const r = await proxyPut(ownerTok, 4, { artworkList: [WORK], cv: null, note: null });
      expect(r.status).toBe(404);
    });

    it('다른 공모의 오너는 남의 공모 작가를 건드릴 수 없다 → 403', async () => {
      const otherGallery = await seedGallery(2);   // artist2 가 오너인 별개 갤러리
      const otherEx = await seedExhibition(otherGallery.id);
      const r = await request.put(`/api/operations/${otherEx.id}/submissions/1`)
        .set('Authorization', `Bearer ${ownerTok}`).send({ artworkList: [WORK] });
      expect([403, 404]).toContain(r.status);
    });
  });

  /**
   * 잠금 기준은 확정이 아니라 **전시종료**다.
   * 처음엔 작가 본인과 똑같이 확정에서 잠갔는데, 확정만 눌러둔 실제 공모(작가 11명 수락)에서
   * 정작 도와줘야 할 때 갤러리가 막혔다(2026-08-19). 확정 잠금은 *작가가* 인쇄 기준을
   * 몰래 바꾸는 걸 막는 장치이지, 캡션·엽서를 만드는 갤러리를 막는 장치가 아니다.
   */
  describe('잠금 — 기준은 전시종료', () => {
    it('확정 후에도 갤러리는 대신 넣을 수 있다 (작가 본인은 여전히 잠긴다)', async () => {
      await testPrisma.exhibition.update({ where: { id: exId }, data: { confirmed: true } });
      expect((await proxyPut(ownerTok, 1, { artworkList: [WORK], cv: null, note: null })).status).toBe(200);

      // 같은 상황에서 작가 본인 경로는 그대로 막혀 있어야 한다
      const mine = await request.put(`/api/operations/${exId}/me`).set('Authorization', `Bearer ${artist1Tok}`)
        .send({ artworkList: [WORK], cv: null, note: null });
      expect(mine.status).toBe(403);
    });

    /** 이게 이 블록에서 제일 중요하다 — 돈이 걸린 경계다 */
    it('전시종료 후에는 갤러리도 못 고친다 (판매 기록이 출품목록 위치에 묶여 있다)', async () => {
      await testPrisma.exhibition.update({ where: { id: exId }, data: { confirmed: true, ended: true } });
      const r = await proxyPut(ownerTok, 1, { artworkList: [WORK], cv: null, note: null });
      expect(r.status).toBe(403);
      expect(r.body.error).toContain('종료');
    });

    it('종료 후에도 Admin 은 고칠 수 있다 (다른 잠금들과 같은 예외)', async () => {
      await testPrisma.exhibition.update({ where: { id: exId }, data: { confirmed: true, ended: true } });
      expect((await proxyPut(adminTok, 1, { artworkList: [WORK], cv: null, note: null })).status).toBe(200);
    });
  });

  describe('검증은 본인 저장과 동일해야 한다', () => {
    it('artworkList 가 배열이 아니면 400 (저장되면 갤러리 조회가 통째로 죽는다)', async () => {
      const r = await proxyPut(ownerTok, 1, { artworkList: { nope: true } });
      expect(r.status).toBe(400);
    });

    it('범위 밖 대표작 인덱스는 null 로 정리된다', async () => {
      const r = await proxyPut(ownerTok, 1, { artworkList: [WORK], representativeIndex: 7 });
      expect(r.body.representativeIndex).toBeNull();
    });
  });

  describe('누가 썼는지 남는다', () => {
    it('대신 입력하면 proxyEdited=true 로 표시된다', async () => {
      await proxyPut(ownerTok, 1, { artworkList: [WORK], cv: null, note: null });

      const mine = await request.get(`/api/operations/${exId}/me`).set('Authorization', `Bearer ${artist1Tok}`);
      expect(mine.body.proxyEdited).toBe(true);

      const list = await request.get(`/api/operations/${exId}/submissions`).set('Authorization', `Bearer ${ownerTok}`);
      expect(list.body.find((r: any) => r.user.id === 1).submission.proxyEdited).toBe(true);
    });

    it('작가가 나중에 직접 저장하면 표시가 사라진다', async () => {
      await proxyPut(ownerTok, 1, { artworkList: [WORK], cv: null, note: null });
      const saved = await request.put(`/api/operations/${exId}/me`).set('Authorization', `Bearer ${artist1Tok}`)
        .send({ artworkList: [{ ...WORK, title: '내가 고친 제목' }], cv: null, note: null });
      // 저장 응답에도 담겨야 한다 — 작품 단위 저장은 화면이 refetch 를 안 해서,
      // 빼면 직접 고쳤는데도 '갤러리가 대신 입력함' 안내가 남는다
      expect(saved.body.proxyEdited).toBe(false);

      const mine = await request.get(`/api/operations/${exId}/me`).set('Authorization', `Bearer ${artist1Tok}`);
      expect(mine.body.proxyEdited).toBe(false);
      expect(mine.body.artworkList[0].title).toBe('내가 고친 제목');
    });

    it('대신 입력 기능 이전의 옛 자료(updatedById NULL)는 본인이 쓴 것으로 본다', async () => {
      await testPrisma.exhibitionSubmission.create({
        data: { exhibitionId: exId, userId: 1, artworkList: JSON.stringify([WORK]) },
      });
      const mine = await request.get(`/api/operations/${exId}/me`).set('Authorization', `Bearer ${artist1Tok}`);
      expect(mine.body.proxyEdited).toBe(false);
    });
  });

  describe('작가에게 알린다', () => {
    it('대신 입력하면 알림이 간다', async () => {
      await proxyPut(ownerTok, 1, { artworkList: [WORK], cv: null, note: null });
      const notis = await testPrisma.notification.findMany({ where: { userId: 1, type: 'SUBMISSION_PROXY_EDIT' } });
      expect(notis).toHaveLength(1);
      expect(notis[0]!.message).toContain('대신 입력');
    });

    it('연달아 저장해도 안 읽은 알림은 하나로 합쳐진다 (작품 단위 저장에 알림이 도배되면 안 된다)', async () => {
      for (let i = 0; i < 5; i++) {
        await proxyPut(ownerTok, 1, { artworkList: [{ ...WORK, title: `작품${i}` }], cv: null, note: null });
      }
      const notis = await testPrisma.notification.findMany({ where: { userId: 1, type: 'SUBMISSION_PROXY_EDIT' } });
      expect(notis).toHaveLength(1);
    });

    it('작가가 읽은 뒤 다시 대신 입력하면 새 알림이 간다', async () => {
      await proxyPut(ownerTok, 1, { artworkList: [WORK], cv: null, note: null });
      await testPrisma.notification.updateMany({ where: { userId: 1, type: 'SUBMISSION_PROXY_EDIT' }, data: { read: true } });
      await proxyPut(ownerTok, 1, { artworkList: [{ ...WORK, title: '또 고침' }], cv: null, note: null });

      const notis = await testPrisma.notification.findMany({ where: { userId: 1, type: 'SUBMISSION_PROXY_EDIT' } });
      expect(notis).toHaveLength(2);
    });

    it('작가 본인이 저장할 때는 알림이 가지 않는다', async () => {
      await request.put(`/api/operations/${exId}/me`).set('Authorization', `Bearer ${artist1Tok}`)
        .send({ artworkList: [WORK], cv: null, note: null });
      const notis = await testPrisma.notification.findMany({ where: { userId: 1, type: 'SUBMISSION_PROXY_EDIT' } });
      expect(notis).toHaveLength(0);
    });
  });

  describe('편집용 조회는 임시저장까지 보여준다', () => {
    it('작가가 임시저장한 작품도 갤러리 편집 화면에는 보인다 (모르고 날리면 안 된다)', async () => {
      await request.put(`/api/operations/${exId}/me`).set('Authorization', `Bearer ${artist1Tok}`).send({
        artworkList: [{ ...WORK, title: '공개작' }, { ...WORK, title: '작성중', draft: true }],
        cv: null, note: null,
      });

      // 목록(공개용)에는 임시저장이 빠진다
      const list = await request.get(`/api/operations/${exId}/submissions`).set('Authorization', `Bearer ${ownerTok}`);
      expect(list.body.find((r: any) => r.user.id === 1).submission.artworkList).toHaveLength(1);

      // 편집용 조회에는 그대로 다 나온다
      const edit = await proxyGet(ownerTok, 1);
      expect(edit.status).toBe(200);
      expect(edit.body.artworkList).toHaveLength(2);
      expect(edit.body.artworkList[1].draft).toBe(true);
    });
  });
});
