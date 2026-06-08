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
      expect(n1[0].linkUrl).toBe(`/exhibitions/${exId}/operation`);
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
    it('오너가 전시종료 → ended + 모집 자동마감', async () => {
      const r = await request.patch(`/api/operations/${exId}/lifecycle`).set('Authorization', `Bearer ${ownerTok}`).send({ ended: true });
      expect(r.status).toBe(200);
      expect(r.body.ended).toBe(true);
      expect(r.body.recruitmentClosed).toBe(true);
    });
    it('작가는 상태 변경 불가 → 403', async () => {
      const r = await request.patch(`/api/operations/${exId}/lifecycle`).set('Authorization', `Bearer ${artist1Tok}`).send({ ended: true });
      expect(r.status).toBe(403);
    });
    it('확정 시 작가 전시정보 수정 잠금 → 403', async () => {
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

  describe('정산', () => {
    beforeEach(async () => {
      // artist1 제출 + 종료
      await request.put(`/api/operations/${exId}/me`).set('Authorization', `Bearer ${artist1Tok}`).send({
        artworkList: [{ title: 'A', size: '', medium: '', year: '', price: '' }, { title: 'B', size: '', medium: '', year: '', price: '' }],
        cv: null, note: null,
      });
      await request.patch(`/api/operations/${exId}/lifecycle`).set('Authorization', `Bearer ${ownerTok}`).send({ ended: true });
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
    it('작가 본인 정산 내역 조회 (my-settlement)', async () => {
      await request.put(`/api/operations/${exId}/settlement`).set('Authorization', `Bearer ${ownerTok}`).send({
        sales: [{ artistUserId: 1, artworkIndex: 0, title: 'A', soldPrice: 500000 }],
        ratios: [{ artistUserId: 1, galleryRatio: 40 }],
      });
      const r = await request.get(`/api/operations/${exId}/my-settlement`).set('Authorization', `Bearer ${artist1Tok}`);
      expect(r.status).toBe(200);
      expect(r.body.artist.total).toBe(500000);
      expect(r.body.artist.artistAmount).toBe(300000); // 60%
      expect(r.body.artist.galleryRatio).toBe(40);
    });
    it('미수락 작가는 본인 정산 조회 불가 → 403', async () => {
      const r = await request.get(`/api/operations/${exId}/my-settlement`).set('Authorization', `Bearer ${artist2Tok}`);
      expect(r.status).toBe(403);
    });
  });
});
