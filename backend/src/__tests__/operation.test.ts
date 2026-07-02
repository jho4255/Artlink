/**
 * 공모 운영 페이지 API 테스트 (/api/operations)
 *
 * 권한 핵심:
 *  - 갤러리 오너(3)/Admin(4): 공지 관리 + 전 작가 제출정보 열람
 *  - 수락(ACCEPTED) 작가: 공지 열람 + 본인 제출정보 작성/조회
 *  - 작가 상호 비공개: 다른 작가의 제출정보/전체 목록 열람 불가
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { request, testPrisma, authToken, cleanDb, seedUsers, seedGallery, seedExhibition } from './helpers';

const ownerTok = authToken(3, 'GALLERY');
const adminTok = authToken(4, 'ADMIN');
const artist1Tok = authToken(1, 'ARTIST');
const artist2Tok = authToken(2, 'ARTIST');

describe('공모 운영 페이지 API', () => {
  let exId: number;
  let galleryId: number;

  beforeEach(async () => {
    await cleanDb();
    await seedUsers();
    const gallery = await seedGallery(3);
    galleryId = gallery.id;
    const ex = await seedExhibition(gallery.id);
    exId = ex.id;
    // artist1 = 수락, artist2 = 접수(미수락)
    await testPrisma.application.create({ data: { userId: 1, exhibitionId: exId, status: 'ACCEPTED' } });
    await testPrisma.application.create({ data: { userId: 2, exhibitionId: exId, status: 'SUBMITTED' } });
  });

  describe('access', () => {
    it('오너 → isOwner', async () => {
      const r = await request.get(`/api/operations/${exId}/access`).set('Authorization', `Bearer ${ownerTok}`);
      expect(r.status).toBe(200);
      expect(r.body.isOwner).toBe(true);
    });
    it('admin → isAdmin', async () => {
      const r = await request.get(`/api/operations/${exId}/access`).set('Authorization', `Bearer ${adminTok}`);
      expect(r.status).toBe(200);
      expect(r.body.isAdmin).toBe(true);
    });
    it('수락 작가 → isAcceptedArtist', async () => {
      const r = await request.get(`/api/operations/${exId}/access`).set('Authorization', `Bearer ${artist1Tok}`);
      expect(r.status).toBe(200);
      expect(r.body.isAcceptedArtist).toBe(true);
    });
    it('미수락 작가 → 403', async () => {
      const r = await request.get(`/api/operations/${exId}/access`).set('Authorization', `Bearer ${artist2Tok}`);
      expect(r.status).toBe(403);
    });
    it('비로그인 → 401', async () => {
      const r = await request.get(`/api/operations/${exId}/access`);
      expect(r.status).toBe(401);
    });
  });

  describe('공지사항', () => {
    it('오너 작성 → 201, 수락작가 열람 가능', async () => {
      const c = await request.post(`/api/operations/${exId}/notices`).set('Authorization', `Bearer ${ownerTok}`).send({ title: '공지', content: '내용' });
      expect(c.status).toBe(201);
      const r = await request.get(`/api/operations/${exId}/notices`).set('Authorization', `Bearer ${artist1Tok}`);
      expect(r.status).toBe(200);
      expect(r.body.length).toBe(1);
    });
    it('작가는 공지 작성 불가 → 403', async () => {
      const r = await request.post(`/api/operations/${exId}/notices`).set('Authorization', `Bearer ${artist1Tok}`).send({ title: 'x', content: 'y' });
      expect(r.status).toBe(403);
    });
    it('미수락 작가는 공지 열람 불가 → 403', async () => {
      const r = await request.get(`/api/operations/${exId}/notices`).set('Authorization', `Bearer ${artist2Tok}`);
      expect(r.status).toBe(403);
    });
    it('공지 등록 시 수락 작가에게 알림 생성 (미수락 작가는 제외)', async () => {
      await request.post(`/api/operations/${exId}/notices`).set('Authorization', `Bearer ${ownerTok}`).send({ title: '설치 안내', content: '반입 일정' });
      const n1 = await testPrisma.notification.findMany({ where: { userId: 1, type: 'OPERATION_NOTICE' } });
      const n2 = await testPrisma.notification.findMany({ where: { userId: 2, type: 'OPERATION_NOTICE' } });
      expect(n1.length).toBe(1);
      expect(n1[0].message).toContain('설치 안내');
      expect(n1[0].linkUrl).toBe(`/exhibitions/${exId}/operation/new`);
      expect(n2.length).toBe(0); // 미수락 작가는 알림 없음
    });
  });

  describe('작가 본인 제출정보', () => {
    it('수락 작가 저장/조회', async () => {
      const put = await request.put(`/api/operations/${exId}/me`).set('Authorization', `Bearer ${artist1Tok}`).send({
        artworkList: [{ title: 'A', size: '10x10', medium: 'oil', year: '2025', price: '비매' }],
        cv: { nameKo: '홍길동', nameEn: 'Hong', birth: '', tel: '', email: '', education: [], solo: [], group: [], artFair: [], award: [] },
        note: { statement: '노트', sections: [] },
      });
      expect(put.status).toBe(200);
      const get = await request.get(`/api/operations/${exId}/me`).set('Authorization', `Bearer ${artist1Tok}`);
      expect(get.status).toBe(200);
      expect(get.body.artworkList).toHaveLength(1);
      expect(get.body.cv.nameKo).toBe('홍길동');
      expect(get.body.note.statement).toBe('노트');
    });
    it('미수락 작가는 작성 불가 → 403', async () => {
      const r = await request.put(`/api/operations/${exId}/me`).set('Authorization', `Bearer ${artist2Tok}`).send({ artworkList: [] });
      expect(r.status).toBe(403);
    });
    it('엽서 대표작(representativeIndex) 저장/조회', async () => {
      const put = await request.put(`/api/operations/${exId}/me`).set('Authorization', `Bearer ${artist1Tok}`).send({
        artworkList: [
          { title: 'A', size: '', medium: '', year: '', price: '' },
          { title: 'B', size: '', medium: '', year: '', price: '' },
        ],
        representativeIndex: 1,
      });
      expect(put.status).toBe(200);
      const get = await request.get(`/api/operations/${exId}/me`).set('Authorization', `Bearer ${artist1Tok}`);
      expect(get.body.representativeIndex).toBe(1);
    });
    it('범위를 벗어난 대표작 인덱스는 null 처리', async () => {
      const put = await request.put(`/api/operations/${exId}/me`).set('Authorization', `Bearer ${artist1Tok}`).send({
        artworkList: [{ title: 'A', size: '', medium: '', year: '', price: '' }],
        representativeIndex: 5,
      });
      expect(put.status).toBe(200);
      expect(put.body.representativeIndex).toBeNull();
    });
  });

  describe('갤러리/Admin 전 작가 열람 + 작가 상호 비공개', () => {
    beforeEach(async () => {
      await request.put(`/api/operations/${exId}/me`).set('Authorization', `Bearer ${artist1Tok}`).send({
        artworkList: [{ title: 'A', size: '', medium: '', year: '', price: '' }],
        cv: null, note: null,
      });
    });
    it('오너는 전 작가 제출정보 목록 조회', async () => {
      const r = await request.get(`/api/operations/${exId}/submissions`).set('Authorization', `Bearer ${ownerTok}`);
      expect(r.status).toBe(200);
      expect(r.body).toHaveLength(1); // 수락 작가 1명(artist1)
      expect(r.body[0].user.id).toBe(1);
      expect(r.body[0].submission.artworkList).toHaveLength(1);
    });
    it('admin도 목록 조회 가능', async () => {
      const r = await request.get(`/api/operations/${exId}/submissions`).set('Authorization', `Bearer ${adminTok}`);
      expect(r.status).toBe(200);
    });
    it('작가는 전체 목록 열람 불가 → 403', async () => {
      const r = await request.get(`/api/operations/${exId}/submissions`).set('Authorization', `Bearer ${artist1Tok}`);
      expect(r.status).toBe(403);
    });
    it('다른 작가의 단일 제출정보 열람 불가 → 403 (작가 상호 비공개)', async () => {
      // artist2가 artist1의 제출정보 조회 시도
      const r = await request.get(`/api/operations/${exId}/submissions/1`).set('Authorization', `Bearer ${artist2Tok}`);
      expect(r.status).toBe(403);
    });
    it('본인 제출정보는 단일 조회 가능 (PDF용)', async () => {
      const r = await request.get(`/api/operations/${exId}/submissions/1`).set('Authorization', `Bearer ${artist1Tok}`);
      expect(r.status).toBe(200);
      expect(r.body.user.id).toBe(1);
    });
    it('오너는 단일 제출정보 조회 가능 (PDF용)', async () => {
      const r = await request.get(`/api/operations/${exId}/submissions/1`).set('Authorization', `Bearer ${ownerTok}`);
      expect(r.status).toBe(200);
      expect(r.body.exhibitionTitle).toBeTruthy();
    });
    it('수락되지 않은 작가 대상 단일 조회 → 404', async () => {
      const r = await request.get(`/api/operations/${exId}/submissions/2`).set('Authorization', `Bearer ${ownerTok}`);
      expect(r.status).toBe(404);
    });
  });

  describe('캡션 HWP 다운로드', () => {
    it('오너가 캡션 HWP를 받는다 (CFB 시그니처 + 본문)', async () => {
      // 출품작 등록
      await request.put(`/api/operations/${exId}/me`).set('Authorization', `Bearer ${artist1Tok}`).send({
        artworkList: [
          { title: 'Purified Fever', size: '30 x 40 cm', medium: 'Oil on canvas', year: '2024', price: '100만원' },
          { title: '잔상', size: '24.2 x 33.4 cm', medium: '한지에 먹', year: '2026', price: '비매' },
        ],
      });
      const r = await request.get(`/api/operations/${exId}/caption.hwp`)
        .set('Authorization', `Bearer ${ownerTok}`)
        .buffer(true).parse((res, cb) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => cb(null, Buffer.concat(chunks)));
        });
      expect(r.status).toBe(200);
      expect(r.headers['content-type']).toContain('hwp');
      expect(r.headers['content-disposition']).toContain('attachment');
      expect(r.headers['content-disposition']).toContain('.hwp');
      const body: Buffer = r.body;
      // CFB(OLE) 시그니처
      expect(body.slice(0, 8).toString('hex')).toBe('d0cf11e0a1b11ae1');
      expect(body.length).toBeGreaterThan(40000);
    });

    it('출품작이 없으면 400', async () => {
      const r = await request.get(`/api/operations/${exId}/caption.hwp`).set('Authorization', `Bearer ${ownerTok}`);
      expect(r.status).toBe(400);
    });

    it('수락 작가(비오너)는 403', async () => {
      const r = await request.get(`/api/operations/${exId}/caption.hwp`).set('Authorization', `Bearer ${artist1Tok}`);
      expect(r.status).toBe(403);
    });
  });

  describe('상태 토글 (모집마감/확정/종료)', () => {
    it('오너가 전시종료 → ended + 모집 자동마감 (모집마감·확정 선행 필요)', async () => {
      // 순서 강제: 모집마감 → 확정 → 전시종료
      await testPrisma.exhibition.update({ where: { id: exId }, data: { recruitmentClosed: true, confirmed: true } });
      const r = await request.patch(`/api/operations/${exId}/lifecycle`).set('Authorization', `Bearer ${ownerTok}`).send({ ended: true });
      expect(r.status).toBe(200);
      expect(r.body.ended).toBe(true);
      expect(r.body.recruitmentClosed).toBe(true);
    });
    it('모집마감 없이 전시종료 시도 → 400 (순서 강제)', async () => {
      const r = await request.patch(`/api/operations/${exId}/lifecycle`).set('Authorization', `Bearer ${ownerTok}`).send({ ended: true });
      expect(r.status).toBe(400);
    });
    it('작가는 상태 변경 불가 → 403', async () => {
      const r = await request.patch(`/api/operations/${exId}/lifecycle`).set('Authorization', `Bearer ${artist1Tok}`).send({ ended: true });
      expect(r.status).toBe(403);
    });
    it('확정 시 작가 전시정보 수정 잠금 → 403', async () => {
      await testPrisma.exhibition.update({ where: { id: exId }, data: { recruitmentClosed: true } });
      await request.patch(`/api/operations/${exId}/lifecycle`).set('Authorization', `Bearer ${ownerTok}`).send({ confirmed: true });
      const r = await request.put(`/api/operations/${exId}/me`).set('Authorization', `Bearer ${artist1Tok}`).send({ artworkList: [] });
      expect(r.status).toBe(403);
    });
    it('모집마감된 공모는 지원 불가 → 400', async () => {
      const fresh = await seedExhibition(galleryId);
      await testPrisma.exhibition.update({ where: { id: fresh.id }, data: { recruitmentClosed: true } });
      const r = await request.post(`/api/exhibitions/${fresh.id}/apply`).set('Authorization', `Bearer ${artist1Tok}`)
        .send({ biography: '약력', artworkImages: ['https://example.com/a.jpg'] });
      expect(r.status).toBe(400);
      expect(r.body.error).toContain('마감');
    });
  });

  describe('자료 제출 안내 DM', () => {
    it('오너가 미완료 작가에게 발송 → sentCount 1 (artist1)', async () => {
      const r = await request.post(`/api/operations/${exId}/submission-reminders`).set('Authorization', `Bearer ${ownerTok}`)
        .send({ subject: '제목', content: '내용' });
      expect(r.status).toBe(200);
      expect(r.body.sentCount).toBe(1);
      expect(r.body.targets[0].id).toBe(1);
    });
    it('전시 종료 후 오너가 발송 시도 → 400', async () => {
      await testPrisma.exhibition.update({ where: { id: exId }, data: { recruitmentClosed: true, confirmed: true, ended: true } });
      const r = await request.post(`/api/operations/${exId}/submission-reminders`).set('Authorization', `Bearer ${ownerTok}`)
        .send({ subject: '제목', content: '내용' });
      expect(r.status).toBe(400);
    });
    it('전시 종료 후에도 Admin은 발송 가능', async () => {
      await testPrisma.exhibition.update({ where: { id: exId }, data: { recruitmentClosed: true, confirmed: true, ended: true } });
      const r = await request.post(`/api/operations/${exId}/submission-reminders`).set('Authorization', `Bearer ${adminTok}`)
        .send({ subject: '제목', content: '내용' });
      expect(r.status).toBe(200);
    });
    it('작가는 발송 불가 → 403', async () => {
      const r = await request.post(`/api/operations/${exId}/submission-reminders`).set('Authorization', `Bearer ${artist1Tok}`)
        .send({ subject: '제목', content: '내용' });
      expect(r.status).toBe(403);
    });
  });

  describe('정산', () => {
    beforeEach(async () => {
      // artist1 제출 + 종료
      await request.put(`/api/operations/${exId}/me`).set('Authorization', `Bearer ${artist1Tok}`).send({
        artworkList: [{ title: 'A', size: '', medium: '', year: '', price: '' }, { title: 'B', size: '', medium: '', year: '', price: '' }],
        cv: null, note: null,
      });
      // 순서 강제(모집마감→확정→종료)를 우회해 정산 단계 셋업 (정산 테스트의 관심사 아님)
      await testPrisma.exhibition.update({ where: { id: exId }, data: { recruitmentClosed: true, confirmed: true, ended: true } });
    });
    it('오너가 판매작+비율 저장 후 계산 결과 조회', async () => {
      const put = await request.put(`/api/operations/${exId}/settlement`).set('Authorization', `Bearer ${ownerTok}`).send({
        sales: [{ artistUserId: 1, artworkIndex: 0, title: 'A', soldPrice: 1000000 }],
        ratios: [{ artistUserId: 1, galleryRatio: 30 }],
      });
      expect(put.status).toBe(200);
      const get = await request.get(`/api/operations/${exId}/settlement`).set('Authorization', `Bearer ${ownerTok}`);
      expect(get.status).toBe(200);
      const a = get.body.artists.find((x: any) => x.user.id === 1);
      expect(a.total).toBe(1000000);
      expect(a.galleryAmount).toBe(300000);
      expect(a.artistAmount).toBe(700000);
      expect(a.works.find((w: any) => w.index === 0).sold).toBe(true);
      expect(a.works.find((w: any) => w.index === 1).sold).toBe(false);
      expect(get.body.grand.total).toBe(1000000);
      expect(get.body.grand.soldCount).toBe(1);
    });
    it('작가는 전체 정산 조회/저장 불가 → 403', async () => {
      const g = await request.get(`/api/operations/${exId}/settlement`).set('Authorization', `Bearer ${artist1Tok}`);
      expect(g.status).toBe(403);
      const p = await request.put(`/api/operations/${exId}/settlement`).set('Authorization', `Bearer ${artist1Tok}`).send({ sales: [], ratios: [] });
      expect(p.status).toBe(403);
    });
    it('요청 전 비공개 → 확인요청 시 검토 공개 → 전원 수락 후 완료 시 최종 공개', async () => {
      await request.put(`/api/operations/${exId}/settlement`).set('Authorization', `Bearer ${ownerTok}`).send({
        sales: [{ artistUserId: 1, artworkIndex: 0, title: 'A', soldPrice: 500000 }],
        ratios: [{ artistUserId: 1, galleryRatio: 40 }],
      });
      // 요청 전: 작가 비공개 + 요청 없이 완료 시도 → 400
      let mine = await request.get(`/api/operations/${exId}/my-settlement`).set('Authorization', `Bearer ${artist1Tok}`);
      expect(mine.body.requested).toBe(false);
      expect(mine.body.artist).toBeNull();
      expect((await request.post(`/api/operations/${exId}/settlement/complete`).set('Authorization', `Bearer ${ownerTok}`)).status).toBe(400);
      // 정산 확인 요청
      expect((await request.post(`/api/operations/${exId}/settlement/request`).set('Authorization', `Bearer ${ownerTok}`)).status).toBe(200);
      // 요청 후: 작가에게 검토용 공개 + PENDING
      mine = await request.get(`/api/operations/${exId}/my-settlement`).set('Authorization', `Bearer ${artist1Tok}`);
      expect(mine.body.requested).toBe(true);
      expect(mine.body.artist.artistAmount).toBe(300000);
      expect(mine.body.myApproval.status).toBe('PENDING');
      // 미수락 상태에서 완료 → 400
      expect((await request.post(`/api/operations/${exId}/settlement/complete`).set('Authorization', `Bearer ${ownerTok}`)).status).toBe(400);
      // 작가 수락 → 전원 수락 → 완료 성공
      expect((await request.post(`/api/operations/${exId}/settlement/respond`).set('Authorization', `Bearer ${artist1Tok}`).send({ approve: true })).status).toBe(200);
      const done = await request.post(`/api/operations/${exId}/settlement/complete`).set('Authorization', `Bearer ${ownerTok}`);
      expect(done.status).toBe(200);
      expect(done.body.settled).toBe(true);
      // 완료 후 최종 공개
      mine = await request.get(`/api/operations/${exId}/my-settlement`).set('Authorization', `Bearer ${artist1Tok}`);
      expect(mine.body.settled).toBe(true);
      expect(mine.body.artist.artistAmount).toBe(300000);
    });

    it('요청 중 PUT 잠금(403) + 작가 문제제기 시 완료 불가 + 요청취소로 해제', async () => {
      await request.post(`/api/operations/${exId}/settlement/request`).set('Authorization', `Bearer ${ownerTok}`);
      // 요청 중 수정 잠금
      expect((await request.put(`/api/operations/${exId}/settlement`).set('Authorization', `Bearer ${ownerTok}`).send({ sales: [], ratios: [] })).status).toBe(403);
      // 작가 문제 제기(코멘트)
      expect((await request.post(`/api/operations/${exId}/settlement/respond`).set('Authorization', `Bearer ${artist1Tok}`).send({ approve: false, comment: '판매가 오류' })).status).toBe(200);
      // 갤러리 조회 시 ISSUE + 코멘트, 완료 불가
      const s = await request.get(`/api/operations/${exId}/settlement`).set('Authorization', `Bearer ${ownerTok}`);
      expect(s.body.allApproved).toBe(false);
      const a1 = s.body.artists.find((x: any) => x.user.id === 1);
      expect(a1.approval.status).toBe('ISSUE');
      expect(a1.approval.comment).toBe('판매가 오류');
      expect((await request.post(`/api/operations/${exId}/settlement/complete`).set('Authorization', `Bearer ${ownerTok}`)).status).toBe(400);
      // 요청 취소 → 수정 가능
      expect((await request.post(`/api/operations/${exId}/settlement/request/cancel`).set('Authorization', `Bearer ${ownerTok}`)).status).toBe(200);
      expect((await request.put(`/api/operations/${exId}/settlement`).set('Authorization', `Bearer ${ownerTok}`).send({ sales: [], ratios: [] })).status).toBe(200);
    });

    it('관리자는 정산 완료 후에도 수정 가능 (오너 403 / Admin 200)', async () => {
      // 요청 → 수락 → 완료
      await request.post(`/api/operations/${exId}/settlement/request`).set('Authorization', `Bearer ${ownerTok}`);
      await request.post(`/api/operations/${exId}/settlement/respond`).set('Authorization', `Bearer ${artist1Tok}`).send({ approve: true });
      expect((await request.post(`/api/operations/${exId}/settlement/complete`).set('Authorization', `Bearer ${ownerTok}`)).status).toBe(200);
      // 오너는 완료 후 잠금
      expect((await request.put(`/api/operations/${exId}/settlement`).set('Authorization', `Bearer ${ownerTok}`).send({ sales: [], ratios: [] })).status).toBe(403);
      expect((await request.patch(`/api/operations/${exId}/lifecycle`).set('Authorization', `Bearer ${ownerTok}`).send({ recruitmentClosed: false })).status).toBe(403);
      // 관리자는 완료 후에도 수정 가능
      expect((await request.put(`/api/operations/${exId}/settlement`).set('Authorization', `Bearer ${adminTok}`).send({ sales: [], ratios: [] })).status).toBe(200);
      expect((await request.patch(`/api/operations/${exId}/lifecycle`).set('Authorization', `Bearer ${adminTok}`).send({ recruitmentClosed: false })).status).toBe(200);
    });

    it('문제 제기는 코멘트 필수 → 400', async () => {
      await request.post(`/api/operations/${exId}/settlement/request`).set('Authorization', `Bearer ${ownerTok}`);
      const r = await request.post(`/api/operations/${exId}/settlement/respond`).set('Authorization', `Bearer ${artist1Tok}`).send({ approve: false });
      expect(r.status).toBe(400);
    });

    it('전시종료 전에는 정산 확인 요청·완료 불가 → 400', async () => {
      await request.patch(`/api/operations/${exId}/lifecycle`).set('Authorization', `Bearer ${ownerTok}`).send({ ended: false });
      expect((await request.post(`/api/operations/${exId}/settlement/request`).set('Authorization', `Bearer ${ownerTok}`)).status).toBe(400);
      expect((await request.post(`/api/operations/${exId}/settlement/complete`).set('Authorization', `Bearer ${ownerTok}`)).status).toBe(400);
    });
    it('미수락 작가는 본인 정산 조회 불가 → 403', async () => {
      const r = await request.get(`/api/operations/${exId}/my-settlement`).set('Authorization', `Bearer ${artist2Tok}`);
      expect(r.status).toBe(403);
    });
  });
});
