/**
 * 자료제출 마감일 (`Exhibition.submissionDeadline`)
 *
 * 작가가 출품자료(출품리스트·약력·노트)를 내야 하는 날짜.
 * 지원마감 < 자료제출마감 < 전시시작 — 이 순서가 어긋나면 실무가 성립하지 않는다.
 * 지원도 안 끝났는데 자료를 내라 할 수 없고, 전시가 시작된 뒤에 받으면 캡션·엽서 만들 시간이 없다.
 *
 * ⚠️ 이 필드는 2026-08-19에 생겼고, 그전 공모 12건에는 값이 없다(nullable).
 *    갤러리가 상세 화면에서 **한 번만** 채워 넣고, 그 뒤 수정은 Admin 만 할 수 있다 —
 *    작가가 보고 일정을 잡는 날짜라, 뒤늦게 당기면 안내받은 기한이 조용히 바뀐다.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { request, testPrisma, authToken, cleanDb, seedUsers, seedGallery } from './helpers';

const ownerTok = authToken(3, 'GALLERY');
const adminTok = authToken(4, 'ADMIN');
const artistTok = authToken(1, 'ARTIST');

const DAY = 24 * 60 * 60 * 1000;
const days = (n: number) => new Date(Date.now() + n * DAY);
const ymd = (d: Date) => d.toISOString().slice(0, 10);

describe('자료제출 마감일', () => {
  let galleryId: number;

  beforeEach(async () => {
    await cleanDb();
    await seedUsers();
    galleryId = (await seedGallery(3)).id;
  });

  const createBody = (over: Record<string, unknown> = {}) => ({
    title: '테스트 공모', type: 'GROUP', region: 'SEOUL', capacity: 5, description: '설명', galleryId,
    deadline: ymd(days(10)),
    exhibitStartDate: ymd(days(30)),
    exhibitDate: ymd(days(40)),
    submissionDeadline: ymd(days(20)),
    ...over,
  });
  const create = (over: Record<string, unknown> = {}) =>
    request.post('/api/exhibitions').set('Authorization', `Bearer ${ownerTok}`).send(createBody(over));

  describe('공모 등록 — 필수', () => {
    it('정상 등록되면 값이 저장된다', async () => {
      const r = await create();
      expect(r.status).toBe(201);
      const saved = await testPrisma.exhibition.findUnique({ where: { id: r.body.id }, select: { submissionDeadline: true } });
      expect(saved!.submissionDeadline).not.toBeNull();
      expect(ymd(saved!.submissionDeadline!)).toBe(ymd(days(20)));
    });

    it('빠뜨리면 400', async () => {
      const body: any = createBody();
      delete body.submissionDeadline;
      const r = await request.post('/api/exhibitions').set('Authorization', `Bearer ${ownerTok}`).send(body);
      expect(r.status).toBe(400);
    });

    it('빈 문자열도 400', async () => {
      expect((await create({ submissionDeadline: '' })).status).toBe(400);
    });

    it('지원 마감일보다 앞이면 400', async () => {
      const r = await create({ submissionDeadline: ymd(days(5)) });
      expect(r.status).toBe(400);
      expect(r.body.error).toContain('지원 마감일');
    });

    it('전시 시작일보다 뒤면 400', async () => {
      const r = await create({ submissionDeadline: ymd(days(35)) });
      expect(r.status).toBe(400);
      expect(r.body.error).toContain('전시 시작일');
    });

    it('경계(같은 날)는 막는다 — 지원마감 당일, 전시시작 당일 모두', async () => {
      expect((await create({ submissionDeadline: ymd(days(10)) })).status).toBe(400);
      expect((await create({ submissionDeadline: ymd(days(30)) })).status).toBe(400);
    });

    it('전시 시작일이 없으면 전시 종료일을 기준으로 본다', async () => {
      const ok = await create({ exhibitStartDate: null, submissionDeadline: ymd(days(20)) });
      expect(ok.status).toBe(201);
      const bad = await create({ exhibitStartDate: null, submissionDeadline: ymd(days(45)) });
      expect(bad.status).toBe(400);
    });
  });

  describe('기존 공모에 채워넣기 (PATCH /:id/submission-deadline)', () => {
    let exId: number;

    beforeEach(async () => {
      // 이 필드가 생기기 전에 올라간 공모를 흉내낸다 (값 없음)
      const ex = await testPrisma.exhibition.create({
        data: {
          title: '옛 공모', type: 'GROUP', region: 'SEOUL', capacity: 5, description: '설명',
          deadline: days(10), exhibitStartDate: days(30), exhibitDate: days(40),
          status: 'APPROVED', galleryId,
        },
      });
      exId = ex.id;
    });

    const patch = (tok: string, value: string) =>
      request.patch(`/api/exhibitions/${exId}/submission-deadline`).set('Authorization', `Bearer ${tok}`).send({ submissionDeadline: value });

    it('갤러리 오너가 비어 있는 값을 채울 수 있다', async () => {
      const r = await patch(ownerTok, ymd(days(20)));
      expect(r.status).toBe(200);
      expect(ymd(new Date(r.body.submissionDeadline))).toBe(ymd(days(20)));
    });

    it('같은 순서 검증을 그대로 탄다', async () => {
      expect((await patch(ownerTok, ymd(days(5)))).status).toBe(400);
      expect((await patch(ownerTok, ymd(days(35)))).status).toBe(400);
    });

    /** 작가가 보고 일정을 잡는 날짜라, 한 번 알린 뒤 조용히 바뀌면 안 된다 */
    it('이미 값이 있으면 갤러리는 못 고친다 → 403', async () => {
      await patch(ownerTok, ymd(days(20)));
      const again = await patch(ownerTok, ymd(days(25)));
      expect(again.status).toBe(403);
      expect(again.body.error).toContain('한 번만');
    });

    it('Admin 은 이미 값이 있어도 고칠 수 있다 (오타 구제)', async () => {
      await patch(ownerTok, ymd(days(20)));
      const fixed = await patch(adminTok, ymd(days(25)));
      expect(fixed.status).toBe(200);
      expect(ymd(new Date(fixed.body.submissionDeadline))).toBe(ymd(days(25)));
    });

    it('전시가 이미 시작됐으면 갤러리는 못 넣는다 (지난 날짜는 의미 없다)', async () => {
      await testPrisma.exhibition.update({
        where: { id: exId },
        data: { deadline: days(-40), exhibitStartDate: days(-20), exhibitDate: days(-10) },
      });
      const r = await patch(ownerTok, ymd(days(-30)));
      expect(r.status).toBe(400);
      expect(r.body.error).toContain('시작된');
    });

    it('그 경우에도 Admin 은 넣을 수 있다', async () => {
      await testPrisma.exhibition.update({
        where: { id: exId },
        data: { deadline: days(-40), exhibitStartDate: days(-20), exhibitDate: days(-10) },
      });
      expect((await patch(adminTok, ymd(days(-30)))).status).toBe(200);
    });

    it('남의 공모는 못 건드린다 → 403', async () => {
      const otherGallery = await seedGallery(2);
      const otherEx = await testPrisma.exhibition.create({
        data: {
          title: '남의 공모', type: 'GROUP', region: 'SEOUL', capacity: 5, description: '설명',
          deadline: days(10), exhibitStartDate: days(30), exhibitDate: days(40),
          status: 'APPROVED', galleryId: otherGallery.id,
        },
      });
      const r = await request.patch(`/api/exhibitions/${otherEx.id}/submission-deadline`)
        .set('Authorization', `Bearer ${ownerTok}`).send({ submissionDeadline: ymd(days(20)) });
      expect(r.status).toBe(403);
    });

    it('작가는 아무 공모도 못 건드린다 → 403', async () => {
      expect((await patch(artistTok, ymd(days(20)))).status).toBe(403);
    });

    it('비로그인 → 401', async () => {
      const r = await request.patch(`/api/exhibitions/${exId}/submission-deadline`).send({ submissionDeadline: ymd(days(20)) });
      expect(r.status).toBe(401);
    });

    it('없는 공모 → 404', async () => {
      const r = await request.patch('/api/exhibitions/999999/submission-deadline')
        .set('Authorization', `Bearer ${adminTok}`).send({ submissionDeadline: ymd(days(20)) });
      expect(r.status).toBe(404);
    });
  });

  describe('작가 [내 전시] 에 필요한 값이 함께 내려온다', () => {
    it('자료제출 마감일 · 제출 완료 여부 · 종료 여부', async () => {
      const ex = await testPrisma.exhibition.create({
        data: {
          title: '진행중 공모', type: 'GROUP', region: 'SEOUL', capacity: 5, description: '설명',
          deadline: days(-10), exhibitStartDate: days(20), exhibitDate: days(30),
          submissionDeadline: days(10), status: 'APPROVED', galleryId,
        },
      });
      await testPrisma.application.create({ data: { userId: 1, exhibitionId: ex.id, status: 'ACCEPTED' } });

      const before = await request.get('/api/exhibitions/my-applications').set('Authorization', `Bearer ${artistTok}`);
      expect(before.status).toBe(200);
      expect(before.body[0].exhibition.submissionDeadline).toBeTruthy();
      expect(before.body[0].submissionComplete).toBe(false);
      expect(before.body[0].exhibition.closed).toBe(false);

      // 출품작·약력·노트를 모두 채워야 '제출 완료' (갤러리 [제출완료] 배지와 같은 규칙)
      await testPrisma.exhibitionSubmission.create({
        data: {
          exhibitionId: ex.id, userId: 1,
          artworkList: JSON.stringify([{ title: 'A' }]),
          cv: JSON.stringify({ nameKo: '작가' }),
          note: JSON.stringify({ statement: '노트' }),
        },
      });
      const after = await request.get('/api/exhibitions/my-applications').set('Authorization', `Bearer ${artistTok}`);
      expect(after.body[0].submissionComplete).toBe(true);
    });

    it('임시저장(draft)만 있으면 제출 완료가 아니다 — 갤러리 화면과 말이 달라지면 안 된다', async () => {
      const ex = await testPrisma.exhibition.create({
        data: {
          title: '진행중 공모', type: 'GROUP', region: 'SEOUL', capacity: 5, description: '설명',
          deadline: days(-10), exhibitStartDate: days(20), exhibitDate: days(30),
          submissionDeadline: days(10), status: 'APPROVED', galleryId,
        },
      });
      await testPrisma.application.create({ data: { userId: 1, exhibitionId: ex.id, status: 'ACCEPTED' } });
      await testPrisma.exhibitionSubmission.create({
        data: {
          exhibitionId: ex.id, userId: 1,
          artworkList: JSON.stringify([{ title: 'A', draft: true }]),
          cv: JSON.stringify({ nameKo: '작가' }),
          note: JSON.stringify({ statement: '노트' }),
        },
      });
      const r = await request.get('/api/exhibitions/my-applications').set('Authorization', `Bearer ${artistTok}`);
      expect(r.body[0].submissionComplete).toBe(false);
    });

    it('전시 종료 20일이 지나고 정산도 안 했으면 closed=true', async () => {
      const ex = await testPrisma.exhibition.create({
        data: {
          title: '방치된 공모', type: 'GROUP', region: 'SEOUL', capacity: 5, description: '설명',
          deadline: days(-60), exhibitStartDate: days(-40), exhibitDate: days(-30),
          status: 'APPROVED', galleryId,
        },
      });
      await testPrisma.application.create({ data: { userId: 1, exhibitionId: ex.id, status: 'ACCEPTED' } });
      const r = await request.get('/api/exhibitions/my-applications').set('Authorization', `Bearer ${artistTok}`);
      expect(r.body[0].exhibition.closed).toBe(true);
    });

    it('정산을 시작했으면 20일이 지나도 closed=false (하던 일을 뺏지 않는다)', async () => {
      const ex = await testPrisma.exhibition.create({
        data: {
          title: '정산중 공모', type: 'GROUP', region: 'SEOUL', capacity: 5, description: '설명',
          deadline: days(-60), exhibitStartDate: days(-40), exhibitDate: days(-30),
          status: 'APPROVED', galleryId, ended: true,
        },
      });
      await testPrisma.application.create({ data: { userId: 1, exhibitionId: ex.id, status: 'ACCEPTED' } });
      await testPrisma.artworkSale.create({
        data: { exhibitionId: ex.id, artistUserId: 1, artworkIndex: 0, title: 'A', soldPrice: 1000, paymentMethod: 'CARD' },
      });
      const r = await request.get('/api/exhibitions/my-applications').set('Authorization', `Bearer ${artistTok}`);
      expect(r.body[0].exhibition.closed).toBe(false);
    });
  });
});
