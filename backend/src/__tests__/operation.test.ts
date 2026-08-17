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

    it('요청 중에도 수정 가능 + 작가 문제제기 시 완료 불가 + 요청취소로 공개 해제', async () => {
      await request.post(`/api/operations/${exId}/settlement/request`).set('Authorization', `Bearer ${ownerTok}`);
      // 요청 중 수정 허용 — 예전엔 403 이라, 한 명 고치려고 요청 전체를 내려야 했다
      expect((await request.put(`/api/operations/${exId}/settlement`).set('Authorization', `Bearer ${ownerTok}`).send({ sales: [], ratios: [] })).status).toBe(200);
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

  /**
   * 재확인은 '전원'이 아니라 '금액이 바뀐 작가'만 받는다.
   *
   * 예전엔 [요청 취소]가 승인 기록을 통째로 지워서, 한 명이 문제를 제기하면
   * 이미 수락한 작가까지 전부 다시 확인해야 했다. 10명 단체전에서 1명 때문에 9명을 다시 붙잡는 셈.
   * 지금은 응답 시점 금액을 지문으로 남겨두고(lib/settlementFingerprint.ts) 대조한다.
   */
  describe('정산 부분 재확인', () => {
    const artistA = 1, artistB = 2;
    const put = (body: any, tok = ownerTok) =>
      request.put(`/api/operations/${exId}/settlement`).set('Authorization', `Bearer ${tok}`).send(body);
    const baseline = {
      sales: [
        { artistUserId: artistA, artworkIndex: 0, title: 'A', soldPrice: 1000000 },
        { artistUserId: artistB, artworkIndex: 0, title: 'B', soldPrice: 2000000 },
      ],
      ratios: [
        { artistUserId: artistA, galleryRatio: 30 },
        { artistUserId: artistB, galleryRatio: 30 },
      ],
    };
    const statusOf = async (uid: number) =>
      (await testPrisma.settlementApproval.findUnique({
        where: { exhibitionId_artistUserId: { exhibitionId: exId, artistUserId: uid } },
      }))?.status ?? null;

    beforeEach(async () => {
      // 두 작가 모두 수락 + 출품 + 전시 종료 (정산 단계 셋업)
      await testPrisma.application.update({ where: { userId_exhibitionId: { userId: artistB, exhibitionId: exId } }, data: { status: 'ACCEPTED' } });
      for (const tok of [artist1Tok, artist2Tok]) {
        await request.put(`/api/operations/${exId}/me`).set('Authorization', `Bearer ${tok}`).send({
          artworkList: [{ title: 'W1', size: '', medium: '', year: '', price: '' }], cv: null, note: null,
        });
      }
      await testPrisma.exhibition.update({ where: { id: exId }, data: { recruitmentClosed: true, confirmed: true, ended: true } });
      await put(baseline);
    });

    it('요청 취소해도 수락 기록이 남는다 (예전엔 통째로 지웠다)', async () => {
      await request.post(`/api/operations/${exId}/settlement/request`).set('Authorization', `Bearer ${ownerTok}`);
      await request.post(`/api/operations/${exId}/settlement/respond`).set('Authorization', `Bearer ${artist1Tok}`).send({ approve: true });

      const cancel = await request.post(`/api/operations/${exId}/settlement/request/cancel`).set('Authorization', `Bearer ${ownerTok}`);
      expect(cancel.status).toBe(200);
      expect(cancel.body.keptCount).toBe(1);
      expect(await statusOf(artistA)).toBe('APPROVED');
    });

    it('B만 금액 수정 → 재요청 시 B만 다시 묻고 A의 수락은 유지', async () => {
      await request.post(`/api/operations/${exId}/settlement/request`).set('Authorization', `Bearer ${ownerTok}`);
      await request.post(`/api/operations/${exId}/settlement/respond`).set('Authorization', `Bearer ${artist1Tok}`).send({ approve: true });
      await request.post(`/api/operations/${exId}/settlement/respond`).set('Authorization', `Bearer ${artist2Tok}`).send({ approve: false, comment: '판매가가 다릅니다' });
      await request.post(`/api/operations/${exId}/settlement/request/cancel`).set('Authorization', `Bearer ${ownerTok}`);

      // B 판매가만 정정 — A 는 손대지 않는다
      const saved = await put({
        ...baseline,
        sales: [baseline.sales[0], { ...baseline.sales[1], soldPrice: 2500000 }],
      });
      expect(saved.status).toBe(200);
      expect(saved.body.resetCount).toBe(1);          // B 만 무효화
      expect(await statusOf(artistA)).toBe('APPROVED');
      expect(await statusOf(artistB)).toBe('PENDING');

      const re = await request.post(`/api/operations/${exId}/settlement/request`).set('Authorization', `Bearer ${ownerTok}`);
      expect(re.status).toBe(200);
      expect(re.body.requestedCount).toBe(1);          // B 에게만 요청
      expect(re.body.keptCount).toBe(1);               // A 는 그대로
      expect(await statusOf(artistA)).toBe('APPROVED');

      // A 는 다시 응답할 필요 없이, B 만 수락하면 완료된다
      expect((await request.post(`/api/operations/${exId}/settlement/complete`).set('Authorization', `Bearer ${ownerTok}`)).status).toBe(400);
      await request.post(`/api/operations/${exId}/settlement/respond`).set('Authorization', `Bearer ${artist2Tok}`).send({ approve: true });
      expect((await request.post(`/api/operations/${exId}/settlement/complete`).set('Authorization', `Bearer ${ownerTok}`)).status).toBe(200);
    });

    it('재요청 알림은 다시 물어야 하는 작가에게만 간다', async () => {
      await request.post(`/api/operations/${exId}/settlement/request`).set('Authorization', `Bearer ${ownerTok}`);
      await request.post(`/api/operations/${exId}/settlement/respond`).set('Authorization', `Bearer ${artist1Tok}`).send({ approve: true });
      await request.post(`/api/operations/${exId}/settlement/request/cancel`).set('Authorization', `Bearer ${ownerTok}`);
      await testPrisma.notification.deleteMany({ where: { type: 'SETTLEMENT_CONFIRM_REQUEST' } });

      await put({ ...baseline, sales: [baseline.sales[0], { ...baseline.sales[1], soldPrice: 3000000 }] });
      await request.post(`/api/operations/${exId}/settlement/request`).set('Authorization', `Bearer ${ownerTok}`);

      const notis = await testPrisma.notification.findMany({ where: { type: 'SETTLEMENT_CONFIRM_REQUEST' } });
      expect(notis.map((n) => n.userId)).toEqual([artistB]);
    });

    it('금액을 안 바꾸고 저장하면 아무 수락도 풀리지 않는다', async () => {
      await request.post(`/api/operations/${exId}/settlement/request`).set('Authorization', `Bearer ${ownerTok}`);
      await request.post(`/api/operations/${exId}/settlement/respond`).set('Authorization', `Bearer ${artist1Tok}`).send({ approve: true });
      await request.post(`/api/operations/${exId}/settlement/respond`).set('Authorization', `Bearer ${artist2Tok}`).send({ approve: true });
      await request.post(`/api/operations/${exId}/settlement/request/cancel`).set('Authorization', `Bearer ${ownerTok}`);

      // 순서만 뒤집어 같은 내용을 다시 저장 — 지문은 index 정렬 기준이라 흔들리면 안 된다
      const saved = await put({ sales: [baseline.sales[1], baseline.sales[0]], ratios: [baseline.ratios[1], baseline.ratios[0]] });
      expect(saved.body.resetCount).toBe(0);
      const re = await request.post(`/api/operations/${exId}/settlement/request`).set('Authorization', `Bearer ${ownerTok}`);
      expect(re.body.requestedCount).toBe(0);
      expect(re.body.keptCount).toBe(2);
      expect((await request.post(`/api/operations/${exId}/settlement/complete`).set('Authorization', `Bearer ${ownerTok}`)).status).toBe(200);
    });

    it('비율만 바꿔도 그 작가는 재확인 대상', async () => {
      await request.post(`/api/operations/${exId}/settlement/request`).set('Authorization', `Bearer ${ownerTok}`);
      await request.post(`/api/operations/${exId}/settlement/respond`).set('Authorization', `Bearer ${artist1Tok}`).send({ approve: true });
      await request.post(`/api/operations/${exId}/settlement/respond`).set('Authorization', `Bearer ${artist2Tok}`).send({ approve: true });
      await request.post(`/api/operations/${exId}/settlement/request/cancel`).set('Authorization', `Bearer ${ownerTok}`);

      await put({ ...baseline, ratios: [{ artistUserId: artistA, galleryRatio: 50 }, baseline.ratios[1]] });
      expect(await statusOf(artistA)).toBe('PENDING');
      expect(await statusOf(artistB)).toBe('APPROVED');
    });

    it('관리자가 요청 중에 금액을 고치면 그 작가 수락이 자동으로 풀린다', async () => {
      await request.post(`/api/operations/${exId}/settlement/request`).set('Authorization', `Bearer ${ownerTok}`);
      await request.post(`/api/operations/${exId}/settlement/respond`).set('Authorization', `Bearer ${artist1Tok}`).send({ approve: true });
      await request.post(`/api/operations/${exId}/settlement/respond`).set('Authorization', `Bearer ${artist2Tok}`).send({ approve: true });

      // 관리자는 요청 중에도 수정 가능 — 예전엔 수락 기록이 그대로 남아
      // 작가가 못 본 금액으로 정산이 완료될 수 있었다
      await put({ ...baseline, sales: [{ ...baseline.sales[0], soldPrice: 9000000 }, baseline.sales[1]] }, adminTok);
      expect(await statusOf(artistA)).toBe('PENDING');
      expect(await statusOf(artistB)).toBe('APPROVED');
      expect((await request.post(`/api/operations/${exId}/settlement/complete`).set('Authorization', `Bearer ${ownerTok}`)).status).toBe(400);
    });

    it('수락 기록이 있어도 확인 이후 금액이 바뀐 채로는 완료 불가', async () => {
      await request.post(`/api/operations/${exId}/settlement/request`).set('Authorization', `Bearer ${ownerTok}`);
      await request.post(`/api/operations/${exId}/settlement/respond`).set('Authorization', `Bearer ${artist1Tok}`).send({ approve: true });
      await request.post(`/api/operations/${exId}/settlement/respond`).set('Authorization', `Bearer ${artist2Tok}`).send({ approve: true });
      // PUT 을 거치지 않고 DB 를 직접 고친 상황 (마지막 문 방어)
      await testPrisma.artworkSale.updateMany({ where: { exhibitionId: exId, artistUserId: artistA }, data: { soldPrice: 4321000 } });

      const r = await request.post(`/api/operations/${exId}/settlement/complete`).set('Authorization', `Bearer ${ownerTok}`);
      expect(r.status).toBe(400);
      expect(r.body.error).toContain('다시');
    });

    /**
     * 핵심 시나리오 — 요청을 내리지 않고 문제 제기한 작가만 고쳐서 다시 보낸다.
     * 예전엔 [요청 취소]가 유일한 수정 경로여서, 아직 검토 중이던 작가의 화면까지 닫혔다.
     */
    it('요청을 유지한 채 B만 고치면 → B만 재확인 + B에게만 알림, A·C 검토는 그대로', async () => {
      await request.post(`/api/operations/${exId}/settlement/request`).set('Authorization', `Bearer ${ownerTok}`);
      await request.post(`/api/operations/${exId}/settlement/respond`).set('Authorization', `Bearer ${artist1Tok}`).send({ approve: true });
      await request.post(`/api/operations/${exId}/settlement/respond`).set('Authorization', `Bearer ${artist2Tok}`).send({ approve: false, comment: '판매가 확인 부탁드립니다' });
      await testPrisma.notification.deleteMany({ where: { type: 'SETTLEMENT_CONFIRM_REQUEST' } });

      // 요청을 내리지 않고 바로 수정
      const saved = await put({ ...baseline, sales: [baseline.sales[0], { ...baseline.sales[1], soldPrice: 2500000 }] });
      expect(saved.status).toBe(200);
      expect(saved.body.resetCount).toBe(1);
      expect(saved.body.notified).toBe(1);

      // 요청은 계속 열려 있다 — 작가들은 내역을 계속 볼 수 있다
      const ex = await testPrisma.exhibition.findUnique({ where: { id: exId } });
      expect(ex!.settlementRequestedAt).not.toBeNull();
      const mine = await request.get(`/api/operations/${exId}/my-settlement`).set('Authorization', `Bearer ${artist1Tok}`);
      expect(mine.body.requested).toBe(true);

      expect(await statusOf(artistA)).toBe('APPROVED');   // 손대지 않은 작가는 수락 유지
      expect(await statusOf(artistB)).toBe('PENDING');

      const notis = await testPrisma.notification.findMany({ where: { type: 'SETTLEMENT_CONFIRM_REQUEST' } });
      expect(notis.map((n) => n.userId)).toEqual([artistB]);
      expect(notis[0]!.message).toContain('수정');

      // B 만 다시 수락하면 완료
      await request.post(`/api/operations/${exId}/settlement/respond`).set('Authorization', `Bearer ${artist2Tok}`).send({ approve: true });
      expect((await request.post(`/api/operations/${exId}/settlement/complete`).set('Authorization', `Bearer ${ownerTok}`)).status).toBe(200);
    });

    /**
     * 금액을 고칠 게 없는데 '문제 제기'가 남은 경우 — 작가가 잘못 봤거나 전화로 이미 풀린 상황.
     * 이 출구가 없으면 전원 수락이 안 돼 정산을 영영 못 끝내고, 결국 요청 전체를 내렸다 올려야 한다.
     */
    it('작가 한 명만 다시 확인 요청 → 그 사람만 PENDING + 그 사람에게만 알림', async () => {
      await request.post(`/api/operations/${exId}/settlement/request`).set('Authorization', `Bearer ${ownerTok}`);
      await request.post(`/api/operations/${exId}/settlement/respond`).set('Authorization', `Bearer ${artist1Tok}`).send({ approve: true });
      await request.post(`/api/operations/${exId}/settlement/respond`).set('Authorization', `Bearer ${artist2Tok}`).send({ approve: false, comment: '제가 잘못 봤나요?' });
      await testPrisma.notification.deleteMany({ where: { type: 'SETTLEMENT_CONFIRM_REQUEST' } });

      // 금액은 그대로 두고 B 에게만 다시 물어본다
      const r = await request.post(`/api/operations/${exId}/settlement/request/artist/${artistB}`).set('Authorization', `Bearer ${ownerTok}`);
      expect(r.status).toBe(200);
      expect(await statusOf(artistB)).toBe('PENDING');
      expect(await statusOf(artistA)).toBe('APPROVED');   // A 는 건드리지 않는다

      const notis = await testPrisma.notification.findMany({ where: { type: 'SETTLEMENT_CONFIRM_REQUEST' } });
      expect(notis.map((n) => n.userId)).toEqual([artistB]);

      // 문제 제기 코멘트도 지워져 화면에 남지 않는다
      const appr = await testPrisma.settlementApproval.findUnique({ where: { exhibitionId_artistUserId: { exhibitionId: exId, artistUserId: artistB } } });
      expect(appr!.comment).toBeNull();
    });

    it('작가별 재요청 — 참여 작가가 아니면 400, 권한 없으면 403, 요청 전이면 400', async () => {
      // 요청 전
      expect((await request.post(`/api/operations/${exId}/settlement/request/artist/${artistA}`).set('Authorization', `Bearer ${ownerTok}`)).status).toBe(400);
      await request.post(`/api/operations/${exId}/settlement/request`).set('Authorization', `Bearer ${ownerTok}`);
      // 미참여 작가(수락되지 않은 id)
      expect((await request.post(`/api/operations/${exId}/settlement/request/artist/9999`).set('Authorization', `Bearer ${ownerTok}`)).status).toBe(400);
      // 작가 본인은 호출 불가
      expect((await request.post(`/api/operations/${exId}/settlement/request/artist/${artistB}`).set('Authorization', `Bearer ${artist1Tok}`)).status).toBe(403);
    });

    it('금액이 안 바뀐 저장은 요청 중이어도 알림을 보내지 않는다', async () => {
      await request.post(`/api/operations/${exId}/settlement/request`).set('Authorization', `Bearer ${ownerTok}`);
      await request.post(`/api/operations/${exId}/settlement/respond`).set('Authorization', `Bearer ${artist1Tok}`).send({ approve: true });
      await testPrisma.notification.deleteMany({ where: { type: 'SETTLEMENT_CONFIRM_REQUEST' } });

      const saved = await put(baseline);
      expect(saved.body.resetCount).toBe(0);
      expect(saved.body.notified).toBe(0);
      expect(await testPrisma.notification.count({ where: { type: 'SETTLEMENT_CONFIRM_REQUEST' } })).toBe(0);
    });

    /**
     * 갤러리가 검토 중에 금액을 고칠 수 있게 되면서 생긴 위험 — 작가가 옛 화면을 띄워둔 채
     * 수락을 누르면 **본 적 없는 금액에 동의한 기록**이 남는다. 화면이 받은 지문을 되돌려받아 막는다.
     */
    it('작가가 옛 화면(옛 지문)으로 수락하면 409', async () => {
      await request.post(`/api/operations/${exId}/settlement/request`).set('Authorization', `Bearer ${ownerTok}`);
      const before = await request.get(`/api/operations/${exId}/my-settlement`).set('Authorization', `Bearer ${artist1Tok}`);
      const staleFp = before.body.fingerprint;
      expect(typeof staleFp).toBe('string');

      // 갤러리가 A 의 금액을 고침
      await put({ ...baseline, sales: [{ ...baseline.sales[0], soldPrice: 7000000 }, baseline.sales[1]] });

      const r = await request.post(`/api/operations/${exId}/settlement/respond`)
        .set('Authorization', `Bearer ${artist1Tok}`).send({ approve: true, fingerprint: staleFp });
      expect(r.status).toBe(409);
      expect(await statusOf(artistA)).toBe('PENDING');

      // 새로 받은 지문으로는 정상 수락
      const after = await request.get(`/api/operations/${exId}/my-settlement`).set('Authorization', `Bearer ${artist1Tok}`);
      const ok = await request.post(`/api/operations/${exId}/settlement/respond`)
        .set('Authorization', `Bearer ${artist1Tok}`).send({ approve: true, fingerprint: after.body.fingerprint });
      expect(ok.status).toBe(200);
      expect(await statusOf(artistA)).toBe('APPROVED');
    });

    it('지문을 안 보내는 옛 클라이언트도 그대로 동작한다', async () => {
      await request.post(`/api/operations/${exId}/settlement/request`).set('Authorization', `Bearer ${ownerTok}`);
      const r = await request.post(`/api/operations/${exId}/settlement/respond`).set('Authorization', `Bearer ${artist1Tok}`).send({ approve: true });
      expect(r.status).toBe(200);
    });

    /**
     * 무응답 자동 수락 (3일) — 침묵을 동의로 바꾸는 장치라 기한 계산이 틀리면 작가가 손해를 본다.
     * 핵심은 "마지막으로 물어본 때"가 기준이라는 것. 갤러리가 다시 물으면 기한도 다시 시작된다.
     */
    describe('무응답 자동 수락', () => {
      const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);
      const setAskedAt = (uid: number, at: Date) =>
        testPrisma.settlementApproval.update({
          where: { exhibitionId_artistUserId: { exhibitionId: exId, artistUserId: uid } },
          data: { askedAt: at },
        });
      const apprOf = (uid: number) =>
        testPrisma.settlementApproval.findUnique({ where: { exhibitionId_artistUserId: { exhibitionId: exId, artistUserId: uid } } });

      beforeEach(async () => {
        await request.post(`/api/operations/${exId}/settlement/request`).set('Authorization', `Bearer ${ownerTok}`);
      });

      it('요청 시 askedAt 이 찍히고, 3일이 지나면 자동 수락된다', async () => {
        expect((await apprOf(artistA))!.askedAt).not.toBeNull();

        await setAskedAt(artistA, daysAgo(5));
        await request.get(`/api/operations/${exId}/settlement`).set('Authorization', `Bearer ${ownerTok}`);

        const a = await apprOf(artistA);
        expect(a!.status).toBe('APPROVED');
        expect(a!.autoApprovedAt).not.toBeNull();   // 사람이 누른 수락과 구분된다
        expect(a!.snapshot).not.toBeNull();          // 지문을 안 쓰면 곧바로 '변경됨'으로 잡혀 완료가 막힌다
      });

      it('기한 안이면 건드리지 않는다', async () => {
        await setAskedAt(artistA, daysAgo(1));
        await request.get(`/api/operations/${exId}/settlement`).set('Authorization', `Bearer ${ownerTok}`);
        expect((await apprOf(artistA))!.status).toBe('PENDING');
      });

      it('문제 제기(ISSUE)는 아무리 오래돼도 자동 수락되지 않는다', async () => {
        await request.post(`/api/operations/${exId}/settlement/respond`).set('Authorization', `Bearer ${artist1Tok}`).send({ approve: false, comment: '이의 있습니다' });
        await setAskedAt(artistA, daysAgo(30));
        await request.get(`/api/operations/${exId}/settlement`).set('Authorization', `Bearer ${ownerTok}`);

        const a = await apprOf(artistA);
        expect(a!.status).toBe('ISSUE');
        expect(a!.autoApprovedAt).toBeNull();
      });

      it('askedAt 이 없는 옛 데이터는 자동 수락 대상이 아니다 (소급 적용 금지)', async () => {
        await testPrisma.settlementApproval.update({
          where: { exhibitionId_artistUserId: { exhibitionId: exId, artistUserId: artistA } },
          data: { askedAt: null },
        });
        await request.get(`/api/operations/${exId}/settlement`).set('Authorization', `Bearer ${ownerTok}`);
        expect((await apprOf(artistA))!.status).toBe('PENDING');
      });

      // ── 기한 연장 ──
      it('[이 작가에게 다시 확인 요청] 하면 기한이 다시 시작된다', async () => {
        await setAskedAt(artistA, daysAgo(5));
        await request.post(`/api/operations/${exId}/settlement/request/artist/${artistA}`).set('Authorization', `Bearer ${ownerTok}`);

        const a = await apprOf(artistA);
        expect(a!.askedAt!.getTime()).toBeGreaterThan(daysAgo(1).getTime());
        // 다시 물었으니 곧바로 자동 수락되면 안 된다
        await request.get(`/api/operations/${exId}/settlement`).set('Authorization', `Bearer ${ownerTok}`);
        expect((await apprOf(artistA))!.status).toBe('PENDING');
      });

      it('금액을 고쳐 저장하면 그 작가의 기한이 다시 시작된다 (마감 직전 금액 변경 방지)', async () => {
        // A 는 수락했지만 기한이 임박한 상태를 만든다
        await request.post(`/api/operations/${exId}/settlement/respond`).set('Authorization', `Bearer ${artist1Tok}`).send({ approve: true });
        await setAskedAt(artistA, daysAgo(5));

        // 금액 변경 → A 는 PENDING 으로 돌아가고 askedAt 도 새로 찍혀야 한다
        await put({ ...baseline, sales: [{ ...baseline.sales[0], soldPrice: 5_000_000 }, baseline.sales[1]] });
        const a = await apprOf(artistA);
        expect(a!.status).toBe('PENDING');
        expect(a!.askedAt!.getTime()).toBeGreaterThan(daysAgo(1).getTime());

        // 바꾼 직후 바로 자동 수락되면 '고쳐놓고 자동 통과' 가 되므로 반드시 막혀야 한다
        await request.get(`/api/operations/${exId}/settlement`).set('Authorization', `Bearer ${ownerTok}`);
        expect((await apprOf(artistA))!.status).toBe('PENDING');
      });

      it('자동 수락된 뒤 갤러리가 금액을 고치면 다시 물어본다 (자동 수락 표시도 지워짐)', async () => {
        await setAskedAt(artistA, daysAgo(5));
        await request.get(`/api/operations/${exId}/settlement`).set('Authorization', `Bearer ${ownerTok}`);
        expect((await apprOf(artistA))!.autoApprovedAt).not.toBeNull();

        await put({ ...baseline, sales: [{ ...baseline.sales[0], soldPrice: 6_000_000 }, baseline.sales[1]] });
        const a = await apprOf(artistA);
        expect(a!.status).toBe('PENDING');
        expect(a!.autoApprovedAt).toBeNull();
      });

      it('자동 수락으로 전원이 채워지면 정산 완료가 된다', async () => {
        await setAskedAt(artistA, daysAgo(5));
        await setAskedAt(artistB, daysAgo(5));
        const done = await request.post(`/api/operations/${exId}/settlement/complete`).set('Authorization', `Bearer ${ownerTok}`);
        expect(done.status).toBe(200);   // 화면을 안 거치고 눌러도 완료 직전에 훑는다
      });

      it('작가에게 기한과 자동 수락 여부를 알려준다', async () => {
        const mine = await request.get(`/api/operations/${exId}/my-settlement`).set('Authorization', `Bearer ${artist1Tok}`);
        expect(mine.body.autoApproveDays).toBe(3);
        expect(mine.body.autoApproveAt).toBeTruthy();
        expect(mine.body.myApproval.autoApproved).toBe(false);

        await setAskedAt(artistA, daysAgo(5));
        const after = await request.get(`/api/operations/${exId}/my-settlement`).set('Authorization', `Bearer ${artist1Tok}`);
        expect(after.body.myApproval.status).toBe('APPROVED');
        expect(after.body.myApproval.autoApproved).toBe(true);
        expect(after.body.autoApproveAt).toBeNull();   // 이미 처리됐으므로 기한 표시 없음
      });

      it('자동 수락되면 작가에게 알림이 간다 (본인이 누르지 않은 수락이므로)', async () => {
        await testPrisma.notification.deleteMany({});
        await setAskedAt(artistA, daysAgo(5));
        await request.get(`/api/operations/${exId}/settlement`).set('Authorization', `Bearer ${ownerTok}`);

        const notis = await testPrisma.notification.findMany({ where: { userId: artistA } });
        expect(notis.some((n) => n.message.includes('자동 수락'))).toBe(true);
      });

      it('확인 요청 알림에 자동 수락 안내가 들어간다 (모르고 침묵하는 일이 없게)', async () => {
        const notis = await testPrisma.notification.findMany({ where: { type: 'SETTLEMENT_CONFIRM_REQUEST' } });
        expect(notis.length).toBeGreaterThan(0);
        expect(notis[0]!.message).toContain('3일간 응답이 없으면 자동 수락');
      });
    });

    it('수락 후 거절로 되돌린 작가의 확인 기록은 재요청 때 정리된다', async () => {
      await request.post(`/api/operations/${exId}/settlement/request`).set('Authorization', `Bearer ${ownerTok}`);
      await request.post(`/api/operations/${exId}/settlement/respond`).set('Authorization', `Bearer ${artist1Tok}`).send({ approve: true });
      await request.post(`/api/operations/${exId}/settlement/respond`).set('Authorization', `Bearer ${artist2Tok}`).send({ approve: true });
      await request.post(`/api/operations/${exId}/settlement/request/cancel`).set('Authorization', `Bearer ${ownerTok}`);

      await testPrisma.application.update({ where: { userId_exhibitionId: { userId: artistB, exhibitionId: exId } }, data: { status: 'REJECTED' } });
      const re = await request.post(`/api/operations/${exId}/settlement/request`).set('Authorization', `Bearer ${ownerTok}`);
      expect(re.body.keptCount).toBe(1);
      expect(await statusOf(artistB)).toBeNull();
    });
  });
});

/**
 * 임시저장(draft) 작품은 작가에게만 보이고 갤러리·관리자에게는 감춰져야 한다.
 * 프론트에서 감추면 목록·PDF·정산 등 경로마다 빠뜨리기 쉬워 서버에서 한 번에 거른다.
 */
describe('임시저장 작품 비공개', () => {
  let exId: number;

  beforeEach(async () => {
    await cleanDb();
    await seedUsers();
    const gallery = await seedGallery(3);
    const ex = await seedExhibition(gallery.id);
    exId = ex.id;
    await testPrisma.application.create({ data: { userId: 1, exhibitionId: exId, status: 'ACCEPTED' } });

    await request.put(`/api/operations/${exId}/me`)
      .set('Authorization', `Bearer ${artist1Tok}`)
      .send({
        artworkList: [
          { title: '공개 작품', size: '10×10 cm', medium: 'Oil', year: '2026', price: '100000' },
          { title: '임시 작품', size: '20×20 cm', medium: 'Acrylic', year: '2026', price: '200000', draft: true },
          { title: '공개 작품2', size: '30×30 cm', medium: 'Oil', year: '2026', price: '300000' },
        ],
        cv: null, note: null,
        representativeIndex: 2, // 임시저장 뒤의 작품 — 걸러낸 뒤에도 같은 작품을 가리켜야 한다
      });
  });

  it('작가 본인은 임시저장 작품까지 모두 본다', async () => {
    const r = await request.get(`/api/operations/${exId}/me`).set('Authorization', `Bearer ${artist1Tok}`);
    expect(r.status).toBe(200);
    expect(r.body.artworkList.map((a: any) => a.title)).toEqual(['공개 작품', '임시 작품', '공개 작품2']);
  });

  it('갤러리 오너의 전체 목록에서는 임시저장 작품이 빠진다', async () => {
    const r = await request.get(`/api/operations/${exId}/submissions`).set('Authorization', `Bearer ${ownerTok}`);
    expect(r.status).toBe(200);
    const mine = r.body.find((x: any) => x.user.id === 1);
    expect(mine.submission.artworkList.map((a: any) => a.title)).toEqual(['공개 작품', '공개 작품2']);
  });

  it('단일 조회(PDF용)에서도 빠지고, 대표작 인덱스가 다시 매핑된다', async () => {
    const r = await request.get(`/api/operations/${exId}/submissions/1`).set('Authorization', `Bearer ${ownerTok}`);
    expect(r.status).toBe(200);
    const list = r.body.submission.artworkList;
    expect(list.map((a: any) => a.title)).toEqual(['공개 작품', '공개 작품2']);
    // 원래 index 2(공개 작품2) → 걸러낸 배열에서는 index 1
    expect(r.body.submission.representativeIndex).toBe(1);
    expect(list[r.body.submission.representativeIndex].title).toBe('공개 작품2');
  });

  it('정산 대상 작품 목록에도 임시저장 작품은 포함되지 않는다', async () => {
    const r = await request.get(`/api/operations/${exId}/settlement`).set('Authorization', `Bearer ${ownerTok}`);
    expect(r.status).toBe(200);
    const me = r.body.artists.find((a: any) => a.user.id === 1);
    expect(me.works.map((w: any) => w.title)).toEqual(['공개 작품', '공개 작품2']);
  });

  it('판매 기록이 갤러리와 작가에게 같은 작품을 가리킨다 (draft로 인한 인덱스 어긋남 방지)', async () => {
    // 갤러리 정산 화면(draft 제외 목록)에서 index 1 = '공개 작품2'를 판매 처리
    await testPrisma.exhibition.update({ where: { id: exId }, data: { recruitmentClosed: true, confirmed: true, ended: true } });
    const put = await request.put(`/api/operations/${exId}/settlement`).set('Authorization', `Bearer ${ownerTok}`).send({
      sales: [{ artistUserId: 1, artworkIndex: 1, title: '공개 작품2', soldPrice: 300000 }],
      ratios: [{ artistUserId: 1, galleryRatio: 30 }],
    });
    expect(put.status).toBe(200);
    // 확인 요청 후에야 작가에게 내역이 공개된다
    expect((await request.post(`/api/operations/${exId}/settlement/request`).set('Authorization', `Bearer ${ownerTok}`)).status).toBe(200);
    // 작가의 '내 정산 내역'도 같은 필터 목록을 써야 같은 작품이 판매됨으로 보인다
    const mine = await request.get(`/api/operations/${exId}/my-settlement`).set('Authorization', `Bearer ${artist1Tok}`);
    expect(mine.status).toBe(200);
    const sold = mine.body.artist.works.filter((w: any) => w.sold);
    expect(sold.map((w: any) => w.title)).toEqual(['공개 작품2']);
    expect(sold[0].soldPrice).toBe(300000);
  });

  it('전시 종료 전에는 판매를 기록할 수 없다 (인덱스 프레임이 얼기 전 판매 금지)', async () => {
    const r = await request.put(`/api/operations/${exId}/settlement`).set('Authorization', `Bearer ${ownerTok}`).send({
      sales: [{ artistUserId: 1, artworkIndex: 0, title: '공개 작품', soldPrice: 100000 }],
      ratios: [],
    });
    expect(r.status).toBe(400);
  });

  it('배열이 아닌 artworkList는 400으로 거부한다 (저장되면 갤러리 조회 전체가 죽는다)', async () => {
    const r = await request.put(`/api/operations/${exId}/me`).set('Authorization', `Bearer ${artist1Tok}`)
      .send({ artworkList: { a: 1 }, cv: null, note: null });
    expect(r.status).toBe(400);
  });

  it('draft 작품에 대한 노트 상세설명은 갤러리에게 감춰진다', async () => {
    await request.put(`/api/operations/${exId}/me`).set('Authorization', `Bearer ${artist1Tok}`).send({
      artworkList: [
        { title: '공개 작품', size: '10×10 cm', medium: 'Oil', year: '2026', price: '100000' },
        { title: '비밀 신작', size: '', medium: '', year: '', price: '', draft: true },
      ],
      cv: null,
      note: { statement: '전체 노트', sections: [
        { title: '공개 작품', body: '공개 설명' },
        { title: '비밀 신작', body: '아직 보여주기 싫은 설명' },
      ] },
    });
    const g = await request.get(`/api/operations/${exId}/submissions/1`).set('Authorization', `Bearer ${ownerTok}`);
    const secs = g.body.submission.note.sections.map((x: any) => x.title);
    expect(secs).toEqual(['공개 작품']);
    // 작가 본인은 전부 보인다
    const me = await request.get(`/api/operations/${exId}/me`).set('Authorization', `Bearer ${artist1Tok}`);
    expect(me.body.note.sections.length).toBe(2);
  });
});
