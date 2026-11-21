/**
 * 관리자 화면 개편(2026-11-21, CLAUDE.md 규칙 89) — 새 API
 *   GET  /api/admin/todo-counts          메뉴 배지 · 통계 '지금 처리할 일'
 *   GET  /api/admin/users?paged=1        [사용자 관리] 표(쪽 · 걸러 보기 · 수)
 *   GET  /api/admin/users/:id/summary    회원 한 명
 *   GET  /api/admin/shows                운영 조회의 전시 탭
 *   GET  /api/admin/stats/*              요약 · 회원 · 공모·지원 · 갤러리·전시 · 기능 사용
 *   GET  /api/approvals/history          처리한 요청
 *   POST /api/exhibitions/:id/attachment-hit  첨부파일 받은 수
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { request, testPrisma, cleanDb, seedUsers, seedGallery, seedExhibition, authToken } from './helpers';
import { stallOf } from '../lib/adminConsole';
import { kstDay } from '../lib/visitStats';

const admin = () => authToken(4, 'ADMIN');
const DAY = 86400000;
/** KST 오늘에서 n 일 뒤의 달력 날짜(UTC 자정) — 마감일·전시일이 저장되는 모양 */
const dateIn = (n: number) => new Date(kstDay().getTime() + n * DAY);

describe('관리자 화면 API (2026-11-21)', () => {
  beforeEach(async () => {
    await cleanDb();
    await seedUsers();
  });

  describe('권한', () => {
    it('관리자가 아니면 403 · 로그인 안 했으면 401', async () => {
      const paths = ['/api/admin/todo-counts', '/api/admin/users?paged=1', '/api/admin/users/1/summary', '/api/admin/shows',
        '/api/admin/stats/summary', '/api/admin/stats/members', '/api/admin/stats/calls', '/api/admin/stats/galleries', '/api/admin/stats/usage',
        '/api/approvals/history'];
      for (const p of paths) {
        expect((await request.get(p)).status, p).toBe(401);
        expect((await request.get(p).set('Authorization', `Bearer ${authToken(3, 'GALLERY')}`)).status, p).toBe(403);
        expect((await request.get(p).set('Authorization', `Bearer ${admin()}`)).status, p).toBe(200);
      }
    });
  });

  describe('멈춘 공모 판정(stallOf)', () => {
    const base = { status: 'APPROVED', recruitOnly: false, ended: false, settledAt: null, settlementRequestedAt: null, deadline: dateIn(10), exhibitDate: dateIn(40), pending: 0, issues: 0 };
    it('전시가 끝나고 7일 — [전시 종료] 전 / 정산 요청 전', () => {
      expect(stallOf({ ...base, exhibitDate: dateIn(-6) })).toBeNull();
      expect(stallOf({ ...base, exhibitDate: dateIn(-7) })?.kind).toBe('end');
      expect(stallOf({ ...base, exhibitDate: dateIn(-9), ended: true })?.text).toBe('전시 종료 9일째 · 정산 요청 전');
      expect(stallOf({ ...base, exhibitDate: dateIn(-9), ended: true, settlementRequestedAt: new Date() })).toBeNull();
      // 20일이 지나면 '종료'로 정리된 공모다(exhibitionLifecycle) — 몇 달째 같은 줄이 맨 위에 남지 않게
      expect(stallOf({ ...base, exhibitDate: dateIn(-19) })?.kind).toBe('end');
      expect(stallOf({ ...base, exhibitDate: dateIn(-20) })).toBeNull();
      expect(stallOf({ ...base, exhibitDate: dateIn(-40), deadline: dateIn(-60), pending: 3 })).toBeNull();
    });
    it('정산 이의가 가장 먼저 · 마감 지난 검토 대기 · 공모만 진행은 전시 규칙이 없다', () => {
      expect(stallOf({ ...base, exhibitDate: dateIn(-20), ended: true, settlementRequestedAt: new Date(), issues: 2 })?.text).toBe('정산 이의 2건');
      expect(stallOf({ ...base, deadline: dateIn(-3), pending: 2 })?.text).toBe('마감 지나 3일 · 검토 대기 2명');
      expect(stallOf({ ...base, deadline: dateIn(-2), pending: 2 })).toBeNull();
      expect(stallOf({ ...base, recruitOnly: true, exhibitDate: dateIn(-30) })).toBeNull();
      expect(stallOf({ ...base, status: 'PENDING', exhibitDate: dateIn(-30) })).toBeNull();
      expect(stallOf({ ...base, settledAt: new Date(), exhibitDate: dateIn(-30) })).toBeNull();
    });
  });

  describe('GET /admin/todo-counts', () => {
    it('승인 대기 · 신고 · 문의 · 직접 운영 공모의 검토 대기 · 3일 안 마감 · 멈춘 공모를 센다', async () => {
      const g = await seedGallery(3);
      await testPrisma.gallery.create({ data: { name: '새 갤러리', address: '서울', phone: '02', description: 'd', region: 'SEOUL', ownerName: 'o', ownerId: 3, status: 'PENDING' } });
      await testPrisma.exhibition.create({ data: { title: '대기 공모', type: 'SOLO', deadline: dateIn(20), capacity: 3, region: 'SEOUL', description: 'd', status: 'PENDING', galleryId: g.id } });
      await testPrisma.approvalRequest.create({ data: { type: 'GALLERY_EDIT', targetId: g.id, changes: '{"name":"바뀐 이름"}', requesterId: 3 } });
      await testPrisma.approvalRequest.create({ data: { type: 'EXHIBITION_DELETE', targetId: 999, changes: '{"reason":"사정이 있어요","title":"x"}', requesterId: 3 } });
      await testPrisma.inquiry.create({ data: { subject: 'q', content: 'c', userId: 1 } });
      await testPrisma.inquiry.create({ data: { subject: 'q2', content: 'c', userId: 1, status: 'ANSWERED', reply: 'r', repliedAt: new Date() } });
      // 아트링크가 직접 운영(갤러리 없음) · 2일 뒤 마감 · 검토 대기 1
      const hosted = await testPrisma.exhibition.create({ data: { title: '주최', type: 'GROUP', deadline: dateIn(2), capacity: 3, region: 'SEOUL', description: 'd', status: 'APPROVED', hostType: 'ADMIN', recruitOnly: true } });
      await testPrisma.application.create({ data: { userId: 1, exhibitionId: hosted.id, status: 'SUBMITTED' } });
      // 갤러리 공모 — 전시 끝나고 10일, 정산 요청 전 → 멈춤
      await testPrisma.exhibition.create({ data: { title: '끝난 전시', type: 'SOLO', deadline: dateIn(-60), exhibitDate: dateIn(-10), capacity: 3, region: 'SEOUL', description: 'd', status: 'APPROVED', galleryId: g.id, ended: true } });

      const res = await request.get('/api/admin/todo-counts').set('Authorization', `Bearer ${admin()}`);
      expect(res.status).toBe(200);
      expect(res.body.approvals).toBe(4);
      expect(res.body.approvalsByKind).toEqual({ gallery: 1, exhibition: 1, show: 0, edit: 1, delete: 1 });
      expect(res.body.inquiries).toBe(1);
      expect(res.body.oldestInquiryAt).not.toBeNull();
      expect(res.body.pendingApplications).toBe(1);
      expect(res.body.closingSoon).toBe(1);
      expect(res.body.closingSoonEmpty).toBe(0);
      expect(res.body.stalled).toBe(1);
      expect(res.body.reports).toBe(0);
    });
  });

  describe('결정 시각 · 처리한 요청', () => {
    it('승인·거절하면 reviewedAt/decidedAt 이 적히고 /approvals/history 에 최근 순으로 나온다', async () => {
      const g = await seedGallery(3);
      const ex = await testPrisma.exhibition.create({ data: { title: '심사 공모', type: 'SOLO', deadline: dateIn(20), capacity: 3, region: 'SEOUL', description: 'd', status: 'PENDING', galleryId: g.id } });
      const req = await testPrisma.approvalRequest.create({ data: { type: 'GALLERY_EDIT', targetId: g.id, changes: '{"name":"새 이름"}', requesterId: 3 } });

      expect((await request.patch(`/api/approvals/exhibition/${ex.id}`).set('Authorization', `Bearer ${admin()}`).send({ status: 'REJECTED', rejectReason: '일정이 맞지 않아요' })).status).toBe(200);
      expect((await request.patch(`/api/approvals/edit-request/${req.id}`).set('Authorization', `Bearer ${admin()}`).send({ status: 'APPROVED' })).status).toBe(200);
      expect((await testPrisma.exhibition.findUnique({ where: { id: ex.id } }))!.reviewedAt).not.toBeNull();
      expect((await testPrisma.approvalRequest.findUnique({ where: { id: req.id } }))!.decidedAt).not.toBeNull();

      const hist = await request.get('/api/approvals/history').set('Authorization', `Bearer ${admin()}`);
      expect(hist.status).toBe(200);
      expect(hist.body.map((h: any) => h.kind)).toEqual(['edit-request', 'exhibition']);
      expect(hist.body[1]).toMatchObject({ title: '심사 공모', status: 'REJECTED', rejectReason: '일정이 맞지 않아요', by: '새 이름' });   // 지금 갤러리 이름(방금 승인한 수정 요청으로 바뀌었다)
    });

    it('승인 대기 목록 — 등록한 곳 요약 · 수정 요청은 지금 값', async () => {
      const g = await seedGallery(3);
      await testPrisma.exhibition.create({ data: { title: '지난 공모', type: 'SOLO', deadline: dateIn(-30), capacity: 3, region: 'SEOUL', description: 'd', status: 'REJECTED', galleryId: g.id } });
      await testPrisma.exhibition.create({ data: { title: '새 공모', type: 'SOLO', deadline: dateIn(20), capacity: 3, region: 'SEOUL', description: 'd', status: 'PENDING', galleryId: g.id } });
      const target = await seedExhibition(g.id);
      await testPrisma.approvalRequest.create({ data: { type: 'EXHIBITION_EDIT', targetId: target.id, changes: JSON.stringify({ capacity: 9, title: '바뀐 제목' }), requesterId: 3 } });

      const res = await request.get('/api/approvals').set('Authorization', `Bearer ${admin()}`);
      const pend = res.body.pendingExhibitions[0];
      expect(pend.place).toMatchObject({ name: 'Test Gallery', status: 'APPROVED', exhibitions: 3, rejectedExhibitions: 1 });
      const edit = res.body.pendingRequests[0];
      expect(edit.targetName).toBe('Test Exhibition');
      expect(edit.current).toEqual({ capacity: 5, title: 'Test Exhibition' });
      expect(edit.targetFacts).toMatchObject({ applications: 0, accepted: 0 });
    });
  });

  describe('GET /admin/users?paged=1', () => {
    it('역할 탭 수 · 걸러 보기(작품 없음 · 지원한 적 없음) · @주소로 찾기 · 쪽 나눔', async () => {
      await testPrisma.user.update({ where: { id: 1 }, data: { handle: 'first.artist' } });
      const pf = await testPrisma.portfolio.create({ data: { userId: 1 } });
      await testPrisma.portfolioImage.create({ data: { portfolioId: pf.id, url: '/uploads/a.jpg', order: 0 } });
      const g = await seedGallery(3);
      const ex = await seedExhibition(g.id);
      await testPrisma.application.create({ data: { userId: 1, exhibitionId: ex.id, status: 'ACCEPTED' } });
      for (let i = 0; i < 55; i++) await testPrisma.user.create({ data: { email: `bulk${i}@test.com`, name: `대량 ${i}`, role: 'ARTIST' } });
      await testPrisma.dailyVisit.create({ data: { day: kstDay(), visitorId: 'visitor-abcdefghijklmnop', userId: 1 } });

      const get = (qs: string) => request.get(`/api/admin/users?paged=1&${qs}`).set('Authorization', `Bearer ${admin()}`);
      const all = await get('role=ARTIST');
      expect(all.body.total).toBe(57);
      expect(all.body.rows).toHaveLength(50);
      expect(all.body.counts).toMatchObject({ ALL: 59, ARTIST: 57, GALLERY: 1, ADMIN: 1, TODAY: 1 });
      expect(all.body.filterCounts).toMatchObject({ noWorks: 56, neverApplied: 56 });
      expect((await get('role=ARTIST&page=2')).body.rows).toHaveLength(7);

      const me = (await get('q=@first')).body.rows;
      expect(me.map((u: any) => u.id)).toEqual([1]);
      expect(me[0]).toMatchObject({ works: 1, visitDays7: 1, applications: { total: 1, accepted: 1, pending: 0 } });
      expect(me[0].visitDays).toEqual([false, false, false, false, false, false, true]);

      const noWorks = (await get('role=ARTIST&filter=noWorks')).body;
      expect(noWorks.total).toBe(56);
      expect(noWorks.rows.some((u: any) => u.id === 1)).toBe(false);
      expect((await get('sort=name&role=ARTIST')).body.rows[0].name).toBe('Artist 1');
      expect((await get('visited=today')).body.rows.map((u: any) => u.id)).toEqual([1]);
    });
  });

  describe('GET /admin/users/:id/summary', () => {
    it('홈페이지 채운 정도 · 활동 · 지원 이력', async () => {
      const pf = await testPrisma.portfolio.create({ data: { userId: 1, statement: '작가노트', biography: '' } });
      await testPrisma.portfolioImage.create({ data: { portfolioId: pf.id, url: '/uploads/a.jpg', order: 0, title: '무지개' } });
      await testPrisma.portfolioImage.create({ data: { portfolioId: pf.id, url: '/uploads/b.jpg', order: 1 } });
      const g = await seedGallery(3);
      const ex = await seedExhibition(g.id);
      await testPrisma.application.create({ data: { userId: 1, exhibitionId: ex.id, status: 'SUBMITTED' } });
      await testPrisma.follow.create({ data: { followerId: 1, followingId: 2 } });

      const res = await request.get('/api/admin/users/1/summary').set('Authorization', `Bearer ${admin()}`);
      expect(res.status).toBe(200);
      expect(res.body.homepage).toMatchObject({ works: 2, captioned: 1, hasStatement: true, hasBio: false });
      expect(res.body.activity).toMatchObject({ following: 1, followers: 0 });
      expect(res.body.applications).toHaveLength(1);
      expect(res.body.applications[0]).toMatchObject({ status: 'SUBMITTED', decidedAt: null, gallery: { name: 'Test Gallery' } });
      expect(res.body.applicationCounts).toMatchObject({ total: 1, SUBMITTED: 1 });
      // 갤러리 회원은 홈페이지 대신 가진 갤러리
      const gal = await request.get('/api/admin/users/3/summary').set('Authorization', `Bearer ${admin()}`);
      expect(gal.body.homepage).toBeNull();
      expect(gal.body.user.galleries[0]).toMatchObject({ name: 'Test Gallery', _count: { exhibitions: 1, shows: 0 } });
      expect((await request.get('/api/admin/users/9999/summary').set('Authorization', `Bearer ${admin()}`)).status).toBe(404);
    });
  });

  describe('첨부파일 받은 수', () => {
    it('비회원·작가는 세고, 관리자·운영자는 안 센다 · 승인 안 된 공모는 안 센다 · 늘 204', async () => {
      const g = await seedGallery(3);
      const ex = await seedExhibition(g.id);
      const hit = (tok?: string) => {
        const r = request.post(`/api/exhibitions/${ex.id}/attachment-hit`);
        return tok ? r.set('Authorization', `Bearer ${tok}`) : r;
      };
      expect((await hit()).status).toBe(204);
      expect((await hit(authToken(1, 'ARTIST'))).status).toBe(204);
      expect((await hit(authToken(3, 'GALLERY'))).status).toBe(204);   // 주관 갤러리 주인
      expect((await hit(admin())).status).toBe(204);
      const rows = await testPrisma.exhibitionAttachmentHit.findMany({ where: { exhibitionId: ex.id } });
      expect(rows).toHaveLength(1);
      expect(rows[0].count).toBe(2);

      await testPrisma.exhibition.update({ where: { id: ex.id }, data: { status: 'PENDING' } });
      await hit();
      expect((await testPrisma.exhibitionAttachmentHit.findFirst({ where: { exhibitionId: ex.id } }))!.count).toBe(2);
      expect((await request.post('/api/exhibitions/99999/attachment-hit')).status).toBe(204);

      // 동시에 여러 번 — 한 줄에 정확히 더해진다(확인하고 만들지 않는다, 규칙 46)
      await testPrisma.exhibition.update({ where: { id: ex.id }, data: { status: 'APPROVED' } });
      await Promise.all(Array.from({ length: 8 }, () => hit()));
      expect((await testPrisma.exhibitionAttachmentHit.findFirst({ where: { exhibitionId: ex.id } }))!.count).toBe(10);
    });
  });

  describe('주최 공모 목록 · 운영 조회', () => {
    it('/exhibitions/hosted 에 검토 대기·수락·첨부 받음 · /admin/exhibitions 에 숫자와 멈춘 사정 · /admin/shows', async () => {
      const ex = await testPrisma.exhibition.create({ data: { title: '주최 공모', type: 'GROUP', deadline: dateIn(5), capacity: 3, region: 'SEOUL', description: 'd', status: 'APPROVED', hostType: 'ADMIN', recruitOnly: true } });
      await testPrisma.application.create({ data: { userId: 1, exhibitionId: ex.id, status: 'SUBMITTED' } });
      await testPrisma.application.create({ data: { userId: 2, exhibitionId: ex.id, status: 'ACCEPTED' } });
      await testPrisma.exhibitionAttachmentHit.create({ data: { exhibitionId: ex.id, day: kstDay(), count: 4 } });

      const hosted = await request.get('/api/exhibitions/hosted').set('Authorization', `Bearer ${admin()}`);
      expect(hosted.body[0]).toMatchObject({ pendingCount: 1, acceptedCount: 1, attachmentDownloads: 4, applicationCount: 2 });

      const g = await seedGallery(3);
      const late = await testPrisma.exhibition.create({ data: { title: '정산 멈춤', type: 'SOLO', deadline: dateIn(-50), exhibitDate: dateIn(-12), capacity: 3, region: 'SEOUL', description: 'd', status: 'APPROVED', galleryId: g.id, ended: true } });
      const rows = (await request.get('/api/admin/exhibitions').set('Authorization', `Bearer ${admin()}`)).body;
      const r = rows.find((x: any) => x.id === late.id);
      expect(r.stall).toEqual({ kind: 'settlement', text: '전시 종료 12일째 · 정산 요청 전' });
      expect(rows.find((x: any) => x.id === ex.id).counts.apps).toMatchObject({ total: 2, submitted: 1, accepted: 1 });

      const detail = await request.get(`/api/admin/exhibitions/${late.id}/applications`).set('Authorization', `Bearer ${admin()}`);
      expect(detail.body.row.stall.kind).toBe('settlement');

      await testPrisma.show.create({ data: { title: '봄 전시', description: 'd', startDate: dateIn(-1), endDate: dateIn(10), openingHours: '10-18', admissionFee: '무료', location: '서울', region: 'SEOUL', posterImage: '/uploads/p.jpg', galleryId: g.id, status: 'PENDING' } });
      const shows = await request.get('/api/admin/shows').set('Authorization', `Bearer ${admin()}`);
      expect(shows.body[0]).toMatchObject({ title: '봄 전시', status: 'PENDING', gallery: { name: 'Test Gallery' } });
    });
  });

  describe('통계', () => {
    it('요약 — 가입·지원을 앞 기간과 견주고, 주별 가입 · 공모 성과(첨부 받음) · 운영 속도', async () => {
      const old = new Date(Date.now() - 40 * DAY);
      await testPrisma.user.create({ data: { email: 'old@test.com', name: '예전 작가', role: 'ARTIST', createdAt: old } });
      await testPrisma.user.create({ data: { email: 'new@test.com', name: '새 작가', role: 'ARTIST', provider: 'KAKAO' } });
      const g = await seedGallery(3);
      const ex = await seedExhibition(g.id);
      await testPrisma.exhibition.update({ where: { id: ex.id }, data: { viewCount: 300 } });
      await testPrisma.application.create({ data: { userId: 1, exhibitionId: ex.id, status: 'ACCEPTED', createdAt: new Date(Date.now() - 2 * DAY) } });
      await testPrisma.exhibitionAttachmentHit.create({ data: { exhibitionId: ex.id, day: kstDay(), count: 3 } });
      await testPrisma.inquiry.create({ data: { subject: 'q', content: 'c', userId: 1, status: 'ANSWERED', reply: 'r', createdAt: new Date(Date.now() - 4 * 3600000), repliedAt: new Date() } });

      const res = await request.get('/api/admin/stats/summary?days=30').set('Authorization', `Bearer ${admin()}`);
      expect(res.status).toBe(200);
      // seedUsers 의 셋(작가 2·갤러리 1, 관리자는 빼고) + 새 작가 = 4 · 앞 기간 1
      expect(res.body.kpis.signups).toMatchObject({ current: 4, previous: 1 });
      expect(res.body.kpis.signups.byProvider.KAKAO).toBe(1);
      expect(res.body.kpis.applications).toMatchObject({ current: 1, accepted: 1 });
      expect(res.body.weeklySignups).toHaveLength(8);
      expect(res.body.calls[0]).toMatchObject({ id: ex.id, viewCount: 300, apps: 1, accepted: 1, attachmentDownloads: 3, periodAttachmentDownloads: 3 });
      expect(res.body.speed.inquiries.count).toBe(1);
      expect(Math.round(res.body.speed.inquiries.medianHours)).toBe(4);
      expect(res.body.todo).toHaveProperty('approvals');
      expect(res.body.period.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('회원 · 공모·지원 · 갤러리·전시 · 기능 사용 탭이 기간 숫자를 준다', async () => {
      const g = await seedGallery(3);
      const ex = await seedExhibition(g.id);
      await testPrisma.application.create({ data: { userId: 1, exhibitionId: ex.id, status: 'ACCEPTED' } });
      await testPrisma.application.create({ data: { userId: 2, exhibitionId: ex.id, status: 'REJECTED' } });
      await testPrisma.artworkSale.create({ data: { exhibitionId: ex.id, artistUserId: 1, artworkIndex: 0, title: '작품', soldPrice: 1000000 } });
      await testPrisma.artistSettlement.create({ data: { exhibitionId: ex.id, artistUserId: 1, galleryRatio: 40 } });
      await testPrisma.exhibition.update({ where: { id: ex.id }, data: { settledAt: new Date() } });
      await testPrisma.follow.create({ data: { followerId: 1, followingId: 2 } });
      await testPrisma.notification.create({ data: { userId: 1, type: 'APPLICATION_STATUS', message: 'm', read: true } });
      await testPrisma.notification.create({ data: { userId: 1, type: 'APPLICATION_STATUS', message: 'm2' } });
      const tok = admin();

      const members = (await request.get('/api/admin/stats/members?days=30').set('Authorization', `Bearer ${tok}`)).body;
      expect(members.weekly).toHaveLength(12);
      expect(members.weekly.at(-1).ARTIST + members.weekly.at(-2).ARTIST).toBeGreaterThanOrEqual(0);
      expect(members.roleTotals).toMatchObject({ ARTIST: 2, GALLERY: 1, ADMIN: 1 });

      const calls = (await request.get('/api/admin/stats/calls?days=30').set('Authorization', `Bearer ${tok}`)).body;
      expect(calls.weekly.reduce((n: number, w: any) => n + w.total, 0)).toBe(2);
      expect(calls.applicants).toMatchObject({ inPeriod: 2, ever: 2, repeatRate: 0 });
      expect(calls.regions.find((r: any) => r.region === 'SEOUL')).toMatchObject({ calls: 1, applications: 2, galleries: 1 });

      const gal = (await request.get('/api/admin/stats/galleries?days=30').set('Authorization', `Bearer ${tok}`)).body;
      expect(gal.galleries).toMatchObject({ accounts: 1, approved: 1, withCall: 1 });
      expect(gal.trade.period).toMatchObject({ sales: 1, amount: 1000000, galleryShare: 400000 });
      expect(gal.trade.settledInPeriod).toBe(1);

      const usage = (await request.get('/api/admin/stats/usage?days=30').set('Authorization', `Bearer ${tok}`)).body;
      expect(usage.features.follows).toEqual({ current: 1, previous: 0 });
      expect(usage.notifications.find((n: any) => n.type === 'APPLICATION_STATUS')).toMatchObject({ sent: 2, read: 1 });
    });
  });
});
