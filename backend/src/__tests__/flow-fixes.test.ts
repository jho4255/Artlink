/**
 * 공모 흐름 점검 후속 (2026-10-03, `scratchpad/flow-audit-2026-10-03.md` · 계획 `flow-fixes-2026-10`)
 *
 * 묶음:
 *  - 삭제 규칙(수락 작가·판매·정산이 있으면 직접 못 지운다) + 관리자 삭제 요청
 *  - 모집 인원 직접 수정
 *  - 전시 종료 되돌리기 · 판매가 묶인 출품 목록 잠금
 *  - 출품 자료 모양 검증 · 판매 입력 검증 · 글 길이
 *  - 우리 저장소 주소만(지원서·포스터·홍보 사진·포트폴리오)
 *  - 공개 응답에서 운영용 값 빼기 · 비밀번호 가입/로그인 운영에서 닫기
 *  - 시작일 전 지원 · 날짜 순서 · 전시 종료 뒤 선정 변경 · 내 정산 확인 상태 · 결과 알림 문구
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ARTIST_APPLY_TERMS_VERSION } from '../lib/terms';
import { safeFileUrl, ownFileUrl } from '../lib/safeUrl';
import { request, authToken, cleanDb, seedUsers, seedGallery, seedExhibition, testPrisma } from './helpers';

const OWNER = () => authToken(3, 'GALLERY');
const ADMIN = () => authToken(4, 'ADMIN');
const ARTIST = () => authToken(1, 'ARTIST');
const ARTIST2 = () => authToken(2, 'ARTIST');
const DAY = 86400000;
const future = (d: number) => new Date(Date.now() + d * DAY).toISOString();
const applyBody = { biography: '약력', artworkImages: ['/uploads/a.jpg'], termsAgreed: true, termsVersion: ARTIST_APPLY_TERMS_VERSION };

/** 다른 갤러리 계정(id 5) */
async function otherGallery() {
  await testPrisma.user.create({ data: { id: 5, email: 'other@test.com', name: 'Other Gallery', role: 'GALLERY' } });
  const g = await seedGallery(5);
  return { token: authToken(5, 'GALLERY'), gallery: g };
}

async function accept(exhibitionId: number, userId: number) {
  return testPrisma.application.create({ data: { userId, exhibitionId, status: 'ACCEPTED', biography: 'x', artworkImages: '[]' } });
}

beforeEach(async () => {
  await cleanDb();
  await seedUsers();
});

describe('주소 검증 — 우리 저장소 주소만 (점검 S3)', () => {
  it('safeFileUrl 은 `//외부`·`/\\외부` 를 같은 출처 경로로 보지 않는다', () => {
    expect(safeFileUrl('//evil.example/x.png')).toBeNull();
    expect(safeFileUrl('/\\evil.example/x.png')).toBeNull();
    expect(safeFileUrl('/uploads/a.jpg')).toBe('/uploads/a.jpg');
  });
  it('ownFileUrl 은 우리 정적 경로·R2 만 — 외부 http(s)·API 경로·경로 되돌리기는 거절', () => {
    expect(ownFileUrl('/uploads/a.jpg')).toBe('/uploads/a.jpg');
    expect(ownFileUrl('/demo-art/a.jpg')).toBe('/demo-art/a.jpg');
    expect(ownFileUrl('https://tracker.example/p.png')).toBeNull();
    expect(ownFileUrl('/api/auth/me')).toBeNull();
    expect(ownFileUrl('/uploads/../api/auth/me')).toBeNull();
    expect(ownFileUrl('/uploads/%2e%2e/api/auth/me')).toBeNull();
    expect(ownFileUrl('javascript:alert(1)')).toBeNull();
  });
  it('★ 지원서의 외부 작품 사진은 버리고, 남는 게 없으면 400 · 외부 포트폴리오 파일은 400', async () => {
    const g = await seedGallery();
    const ex = await seedExhibition(g.id);
    const onlyExternal = await request.post(`/api/exhibitions/${ex.id}/apply`).set('Authorization', `Bearer ${ARTIST()}`)
      .send({ ...applyBody, artworkImages: ['https://tracker.example/p.png', '//tracker.example/p2.png', '/api/auth/me'] });
    expect(onlyExternal.status).toBe(400);
    const badFile = await request.post(`/api/exhibitions/${ex.id}/apply`).set('Authorization', `Bearer ${ARTIST()}`)
      .send({ ...applyBody, portfolioFileUrl: '//phish.example/login' });
    expect(badFile.status).toBe(400);
    const mixed = await request.post(`/api/exhibitions/${ex.id}/apply`).set('Authorization', `Bearer ${ARTIST()}`)
      .send({ ...applyBody, artworkImages: ['/uploads/ok.jpg', 'https://tracker.example/p.png'] });
    expect(mixed.status).toBe(201);
    expect(JSON.parse(mixed.body.artworkImages)).toEqual(['/uploads/ok.jpg']);
  });
  it('포스터·공모 사진·홍보 사진·작가 홈페이지 작품도 외부 주소는 400', async () => {
    const g = await seedGallery();
    const poster = await request.post('/api/exhibitions').set('Authorization', `Bearer ${OWNER()}`).send({
      title: 'x', type: 'SOLO', deadline: future(10), recruitOnly: true, capacity: 1, region: 'SEOUL', description: 'x', galleryId: g.id,
      imageUrl: 'https://tracker.example/poster.png',
    });
    expect(poster.status).toBe(400);
    const ex = await seedExhibition(g.id);
    expect((await request.post(`/api/exhibitions/${ex.id}/images`).set('Authorization', `Bearer ${OWNER()}`).send({ url: 'https://tracker.example/a.png' })).status).toBe(400);
    expect((await request.post(`/api/exhibitions/${ex.id}/promo-photos`).set('Authorization', `Bearer ${OWNER()}`).send({ url: '//tracker.example/a.png' })).status).toBe(400);
    expect((await request.post(`/api/exhibitions/${ex.id}/promo-photos`).set('Authorization', `Bearer ${OWNER()}`).send({ url: '/uploads/p.png' })).status).toBe(201);
    await testPrisma.portfolio.create({ data: { userId: 1, biography: 'x' } });
    expect((await request.post('/api/portfolio/images').set('Authorization', `Bearer ${ARTIST()}`).send({ url: 'https://tracker.example/w.png' })).status).toBe(400);
  });
});

describe('공개 응답 — 운영용 값은 운영자에게만 (점검 S4)', () => {
  it('★ 비로그인 공모 상세·목록·갤러리 상세에 카드 수수료·정산 요청 시각·반려 사유·숨긴 작가 id 가 없다', async () => {
    const g = await seedGallery();
    await testPrisma.gallery.update({ where: { id: g.id }, data: { hiddenArtistIds: [2] } });
    const ex = await seedExhibition(g.id);
    await testPrisma.exhibition.update({ where: { id: ex.id }, data: { cardFeeRate: 2.2, settlementRequestedAt: new Date() } });

    const detail = await request.get(`/api/exhibitions/${ex.id}`);
    expect(detail.status).toBe(200);
    for (const k of ['cardFeeRate', 'settlementRequestedAt', 'rejectReason']) expect(detail.body).not.toHaveProperty(k);
    expect(detail.body.gallery).not.toHaveProperty('hiddenArtistIds');
    expect(detail.body.gallery).not.toHaveProperty('rejectReason');
    expect(detail.body.gallery.ownerId).toBe(3);   // 화면이 주인 판정·메시지에 쓴다

    const list = await request.get('/api/exhibitions');
    const item = list.body.find((e: any) => e.id === ex.id);
    for (const k of ['cardFeeRate', 'settlementRequestedAt', 'rejectReason']) expect(item).not.toHaveProperty(k);

    const gal = await request.get(`/api/galleries/${g.id}`);
    expect(gal.body).not.toHaveProperty('hiddenArtistIds');
    for (const k of ['cardFeeRate', 'settlementRequestedAt']) expect(gal.body.exhibitions[0]).not.toHaveProperty(k);
    const gl = await request.get('/api/galleries');
    expect(gl.body[0]).not.toHaveProperty('hiddenArtistIds');
  });
  it('운영자(갤러리 주인)·관리자에게는 그대로 준다', async () => {
    const g = await seedGallery();
    const ex = await seedExhibition(g.id);
    await testPrisma.exhibition.update({ where: { id: ex.id }, data: { cardFeeRate: 2.2 } });
    expect((await request.get(`/api/exhibitions/${ex.id}`).set('Authorization', `Bearer ${OWNER()}`)).body.cardFeeRate).toBe(2.2);
    expect((await request.get(`/api/exhibitions/${ex.id}`).set('Authorization', `Bearer ${ADMIN()}`)).body.cardFeeRate).toBe(2.2);
  });
});

describe('확인 없는 이메일+비밀번호 가입 — 운영에서 닫힌다 (점검 S6)', () => {
  // 2026-10-08: 로그인은 운영에서도 열렸다 — 갤러리가 인증번호로 이메일을 확인하고 가입한다(gallery-email-auth.test.ts).
  //             확인 없는 옛 가입(/auth/signup)만 그대로 닫혀 있다. 없는 계정 로그인은 404 가 아니라 401.
  it('★ 운영(production)에서는 옛 가입이 404, ENABLE_PASSWORD_AUTH=true 면 열린다 · 로그인은 열려 있다', async () => {
    const prev = process.env.NODE_ENV;
    const prevFlag = process.env.ENABLE_PASSWORD_AUTH;
    try {
      process.env.NODE_ENV = 'production';
      delete process.env.ENABLE_PASSWORD_AUTH;
      const body = { name: 'n', email: 'pw@test.com', password: 'secret123', role: 'ARTIST', agreeTerms: true, agreePrivacy: true };
      expect((await request.post('/api/auth/signup').send(body)).status).toBe(404);
      expect((await request.post('/api/auth/login').send({ email: 'pw@test.com', password: 'secret123' })).status).toBe(401);
      process.env.ENABLE_PASSWORD_AUTH = 'true';
      expect((await request.post('/api/auth/signup').send(body)).status).toBe(201);
    } finally {
      process.env.NODE_ENV = prev;
      if (prevFlag === undefined) delete process.env.ENABLE_PASSWORD_AUTH; else process.env.ENABLE_PASSWORD_AUTH = prevFlag;
    }
  });
  it('로컬·테스트에서는 그대로 열려 있다', async () => {
    const body = { name: 'n', email: 'local@test.com', password: 'secret123', role: 'ARTIST', agreeTerms: true, agreePrivacy: true };
    expect((await request.post('/api/auth/signup').send(body)).status).toBe(201);
  });
});

describe('삭제 규칙 — 공모 (수락 작가·판매·정산이 있으면 직접 못 지운다)', () => {
  it('수락 작가가 없으면 갤러리가 직접 지우고, 진행 중이던 지원 작가에게 알림이 간다', async () => {
    const g = await seedGallery();
    const ex = await seedExhibition(g.id);
    await testPrisma.application.create({ data: { userId: 1, exhibitionId: ex.id, status: 'SUBMITTED' } });
    expect((await request.get(`/api/exhibitions/${ex.id}/delete-check`).set('Authorization', `Bearer ${OWNER()}`)).body.blocked).toBeNull();
    const r = await request.delete(`/api/exhibitions/${ex.id}`).set('Authorization', `Bearer ${OWNER()}`);
    expect(r.status).toBe(200);
    const n = await testPrisma.notification.findFirst({ where: { userId: 1, type: 'EXHIBITION_DELETED' } });
    expect(n?.message).toContain('Test Exhibition');
  });
  it('★ 수락 작가가 있으면 400 + delete-check 가 이유를 준다', async () => {
    const g = await seedGallery();
    const ex = await seedExhibition(g.id);
    await accept(ex.id, 1);
    const check = await request.get(`/api/exhibitions/${ex.id}/delete-check`).set('Authorization', `Bearer ${OWNER()}`);
    expect(check.body.blocked).toContain('수락한 작가가 1명');
    const r = await request.delete(`/api/exhibitions/${ex.id}`).set('Authorization', `Bearer ${OWNER()}`);
    expect(r.status).toBe(400);
    expect(r.body.error).toContain('삭제 요청');
    expect(await testPrisma.exhibition.count({ where: { id: ex.id } })).toBe(1);
  });
  it('관리자는 지울 수 있고, 수락 작가에게 알림이 간다', async () => {
    const g = await seedGallery();
    const ex = await seedExhibition(g.id);
    await accept(ex.id, 1);
    expect((await request.get(`/api/exhibitions/${ex.id}/delete-check`).set('Authorization', `Bearer ${ADMIN()}`)).body.blocked).toBeNull();
    expect((await request.delete(`/api/exhibitions/${ex.id}`).set('Authorization', `Bearer ${ADMIN()}`)).status).toBe(200);
    expect(await testPrisma.notification.count({ where: { userId: 1, type: 'EXHIBITION_DELETED' } })).toBe(1);
  });
  it('남의 공모의 delete-check 는 404', async () => {
    const g = await seedGallery();
    const ex = await seedExhibition(g.id);
    const other = await otherGallery();
    expect((await request.get(`/api/exhibitions/${ex.id}/delete-check`).set('Authorization', `Bearer ${other.token}`)).status).toBe(404);
  });
});

describe('삭제 규칙 — 갤러리 (그 갤러리의 공모와 같은 규칙, 점검 P1-4)', () => {
  it('★ 정산 기록이 있는 공모가 있으면 갤러리를 직접 지울 수 없다 — 판매·정산 기록이 cascade 로 사라지지 않는다', async () => {
    const g = await seedGallery();
    const ex = await seedExhibition(g.id);
    await accept(ex.id, 1);
    await testPrisma.artworkSale.create({ data: { exhibitionId: ex.id, artistUserId: 1, artworkIndex: 0, title: 'W', soldPrice: 1_000_000 } });
    await testPrisma.exhibition.update({ where: { id: ex.id }, data: { ended: true, settledAt: new Date() } });
    const check = await request.get(`/api/galleries/${g.id}/delete-check`).set('Authorization', `Bearer ${OWNER()}`);
    expect(check.body.blocked).toContain('Test Exhibition');
    const r = await request.delete(`/api/galleries/${g.id}`).set('Authorization', `Bearer ${OWNER()}`);
    expect(r.status).toBe(400);
    expect(await testPrisma.artworkSale.count({ where: { exhibitionId: ex.id } })).toBe(1);
  });
  it('아트링크 주최 공모의 주관 갤러리도 직접 지울 수 없다', async () => {
    const g = await seedGallery();
    const ex = await seedExhibition(g.id);
    await testPrisma.exhibition.update({ where: { id: ex.id }, data: { hostType: 'ADMIN' } });
    expect((await request.delete(`/api/galleries/${g.id}`).set('Authorization', `Bearer ${OWNER()}`)).status).toBe(400);
  });
  it('진행 중인 일이 없으면 지우고, 지원 작가에게 알림이 간다', async () => {
    const g = await seedGallery();
    const ex = await seedExhibition(g.id);
    await testPrisma.application.create({ data: { userId: 2, exhibitionId: ex.id, status: 'SUBMITTED' } });
    expect((await request.delete(`/api/galleries/${g.id}`).set('Authorization', `Bearer ${OWNER()}`)).status).toBe(200);
    expect(await testPrisma.exhibition.count({ where: { id: ex.id } })).toBe(0);
    expect(await testPrisma.notification.count({ where: { userId: 2, type: 'EXHIBITION_DELETED' } })).toBe(1);
  });
});

describe('관리자 삭제 요청 (2026-10-03 사용자 결정)', () => {
  async function blockedExhibition() {
    const g = await seedGallery();
    const ex = await seedExhibition(g.id);
    await accept(ex.id, 1);
    return { g, ex };
  }
  it('★ 요청 → 승인 관리에 요약과 함께 → 승인하면 지워지고 작가·요청자에게 알림', async () => {
    const { ex } = await blockedExhibition();
    const req = await request.post('/api/approvals/delete-request').set('Authorization', `Bearer ${OWNER()}`)
      .send({ type: 'EXHIBITION_DELETE', targetId: ex.id, reason: '전시가 취소되었습니다.' });
    expect(req.status).toBe(201);
    const mine = await request.get('/api/approvals/my-delete-requests').set('Authorization', `Bearer ${OWNER()}`);
    expect(mine.body).toEqual([expect.objectContaining({ type: 'EXHIBITION_DELETE', targetId: ex.id, status: 'PENDING', reason: '전시가 취소되었습니다.' })]);

    const queue = await request.get('/api/approvals').set('Authorization', `Bearer ${ADMIN()}`);
    const item = queue.body.pendingRequests.find((r: any) => r.id === req.body.id);
    expect(item.target).toMatchObject({ gone: false, name: 'Test Exhibition', accepted: 1 });

    const ok = await request.patch(`/api/approvals/delete-request/${req.body.id}`).set('Authorization', `Bearer ${ADMIN()}`).send({ status: 'APPROVED' });
    expect(ok.status).toBe(200);
    expect(await testPrisma.exhibition.count({ where: { id: ex.id } })).toBe(0);
    expect(await testPrisma.notification.count({ where: { userId: 1, type: 'EXHIBITION_DELETED' } })).toBe(1);
    const toOwner = await testPrisma.notification.findFirst({ where: { userId: 3, type: 'APPROVAL_RESULT' }, orderBy: { id: 'desc' } });
    expect(toOwner?.message).toContain('승인되어 삭제');
  });
  it('같은 대상에 대기 중인 요청은 하나 — 동시에 보내도 하나만 들어간다', async () => {
    const { ex } = await blockedExhibition();
    const send = () => request.post('/api/approvals/delete-request').set('Authorization', `Bearer ${OWNER()}`)
      .send({ type: 'EXHIBITION_DELETE', targetId: ex.id, reason: '전시가 취소되었습니다.' });
    const rs = await Promise.all([send(), send(), send()]);
    expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
    expect(rs.filter((r) => r.status === 409)).toHaveLength(2);
    expect(await testPrisma.approvalRequest.count({ where: { type: 'EXHIBITION_DELETE', targetId: ex.id } })).toBe(1);
  });
  it('남의 공모·아트링크 주최 공모 404 · 정산이 끝난 공모 400 · 사유가 짧으면 400', async () => {
    const { ex } = await blockedExhibition();
    const other = await otherGallery();
    const body = { type: 'EXHIBITION_DELETE', targetId: ex.id, reason: '전시가 취소되었습니다.' };
    expect((await request.post('/api/approvals/delete-request').set('Authorization', `Bearer ${other.token}`).send(body)).status).toBe(404);
    expect((await request.post('/api/approvals/delete-request').set('Authorization', `Bearer ${OWNER()}`).send({ ...body, reason: '취소' })).status).toBe(400);
    await testPrisma.exhibition.update({ where: { id: ex.id }, data: { settledAt: new Date() } });
    expect((await request.post('/api/approvals/delete-request').set('Authorization', `Bearer ${OWNER()}`).send(body)).status).toBe(400);
    await testPrisma.exhibition.update({ where: { id: ex.id }, data: { settledAt: null, hostType: 'ADMIN' } });
    expect((await request.post('/api/approvals/delete-request').set('Authorization', `Bearer ${OWNER()}`).send(body)).status).toBe(404);
  });
  it('요청 취소 — 본인·대기 중만. 거절은 사유 필수이고 요청자가 반려 사유를 본다', async () => {
    const { ex } = await blockedExhibition();
    const body = { type: 'EXHIBITION_DELETE', targetId: ex.id, reason: '전시가 취소되었습니다.' };
    const a = await request.post('/api/approvals/delete-request').set('Authorization', `Bearer ${OWNER()}`).send(body);
    const other = await otherGallery();
    expect((await request.delete(`/api/approvals/delete-request/${a.body.id}`).set('Authorization', `Bearer ${other.token}`)).status).toBe(404);
    expect((await request.delete(`/api/approvals/delete-request/${a.body.id}`).set('Authorization', `Bearer ${OWNER()}`)).status).toBe(200);
    expect(await testPrisma.approvalRequest.count()).toBe(0);

    const b = await request.post('/api/approvals/delete-request').set('Authorization', `Bearer ${OWNER()}`).send(body);
    expect((await request.patch(`/api/approvals/delete-request/${b.body.id}`).set('Authorization', `Bearer ${ADMIN()}`).send({ status: 'REJECTED' })).status).toBe(400);
    expect((await request.patch(`/api/approvals/delete-request/${b.body.id}`).set('Authorization', `Bearer ${ADMIN()}`).send({ status: 'REJECTED', rejectReason: '참여 작가와 먼저 정리해 주세요.' })).status).toBe(200);
    expect(await testPrisma.exhibition.count({ where: { id: ex.id } })).toBe(1);
    const mine = await request.get('/api/approvals/my-delete-requests').set('Authorization', `Bearer ${OWNER()}`);
    expect(mine.body[0]).toMatchObject({ status: 'REJECTED', rejectReason: '참여 작가와 먼저 정리해 주세요.' });
    // 반려된 요청은 다시 처리할 수 없다
    expect((await request.patch(`/api/approvals/delete-request/${b.body.id}`).set('Authorization', `Bearer ${ADMIN()}`).send({ status: 'APPROVED' })).status).toBe(400);
  });
  it('수정 요청 길(`/edit-request/:id`)로는 삭제 요청을 처리할 수 없다 — 대상은 안 지워지고 승인만 남는 일을 막는다', async () => {
    const { ex } = await blockedExhibition();
    const a = await request.post('/api/approvals/delete-request').set('Authorization', `Bearer ${OWNER()}`)
      .send({ type: 'EXHIBITION_DELETE', targetId: ex.id, reason: '전시가 취소되었습니다.' });
    expect((await request.patch(`/api/approvals/edit-request/${a.body.id}`).set('Authorization', `Bearer ${ADMIN()}`).send({ status: 'APPROVED' })).status).toBe(404);
  });
  it('갤러리 삭제 요청 승인 → 갤러리와 공모가 지워진다 · 대상이 이미 없으면 요청만 정리', async () => {
    const { g } = await blockedExhibition();
    const a = await request.post('/api/approvals/delete-request').set('Authorization', `Bearer ${OWNER()}`)
      .send({ type: 'GALLERY_DELETE', targetId: g.id, reason: '갤러리 문을 닫습니다.' });
    expect(a.status).toBe(201);
    const ok = await request.patch(`/api/approvals/delete-request/${a.body.id}`).set('Authorization', `Bearer ${ADMIN()}`).send({ status: 'APPROVED' });
    expect(ok.body.alreadyGone).toBe(false);
    expect(await testPrisma.gallery.count({ where: { id: g.id } })).toBe(0);

    const g2 = await seedGallery();
    const b = await request.post('/api/approvals/delete-request').set('Authorization', `Bearer ${OWNER()}`)
      .send({ type: 'GALLERY_DELETE', targetId: g2.id, reason: '갤러리 문을 닫습니다.' });
    await testPrisma.gallery.delete({ where: { id: g2.id } });
    const gone = await request.patch(`/api/approvals/delete-request/${b.body.id}`).set('Authorization', `Bearer ${ADMIN()}`).send({ status: 'APPROVED' });
    expect(gone.status).toBe(200);
    expect(gone.body.alreadyGone).toBe(true);
  });
});

describe('모집 인원 직접 수정 (2026-10-03 사용자 결정)', () => {
  it('★ 갤러리가 늘리고 줄인다 — 수락한 인원보다 적게는 안 된다 · 1000 명까지', async () => {
    const g = await seedGallery();
    const ex = await seedExhibition(g.id);
    await accept(ex.id, 1);
    await accept(ex.id, 2);
    const up = await request.patch(`/api/exhibitions/${ex.id}/capacity`).set('Authorization', `Bearer ${OWNER()}`).send({ capacity: 8 });
    expect(up.status).toBe(200);
    expect(up.body.capacity).toBe(8);
    expect((await request.patch(`/api/exhibitions/${ex.id}/capacity`).set('Authorization', `Bearer ${OWNER()}`).send({ capacity: 1 })).status).toBe(400);
    expect((await request.patch(`/api/exhibitions/${ex.id}/capacity`).set('Authorization', `Bearer ${OWNER()}`).send({ capacity: 1001 })).status).toBe(400);
    expect((await request.patch(`/api/exhibitions/${ex.id}/capacity`).set('Authorization', `Bearer ${OWNER()}`).send({ capacity: 2 })).status).toBe(200);
  });
  it('남의 공모 403 · 전시가 끝난 공모 400', async () => {
    const g = await seedGallery();
    const ex = await seedExhibition(g.id);
    const other = await otherGallery();
    expect((await request.patch(`/api/exhibitions/${ex.id}/capacity`).set('Authorization', `Bearer ${other.token}`).send({ capacity: 3 })).status).toBe(403);
    await testPrisma.exhibition.update({ where: { id: ex.id }, data: { ended: true } });
    expect((await request.patch(`/api/exhibitions/${ex.id}/capacity`).set('Authorization', `Bearer ${OWNER()}`).send({ capacity: 3 })).status).toBe(400);
  });
  it('아트링크 주최 공모는 관리자만 — 위임 갤러리는 403', async () => {
    const g = await seedGallery();
    const ex = await seedExhibition(g.id);
    await testPrisma.exhibition.update({ where: { id: ex.id }, data: { hostType: 'ADMIN' } });
    await testPrisma.exhibitionManager.create({ data: { exhibitionId: ex.id, galleryId: g.id } });
    expect((await request.patch(`/api/exhibitions/${ex.id}/capacity`).set('Authorization', `Bearer ${OWNER()}`).send({ capacity: 3 })).status).toBe(403);
    expect((await request.patch(`/api/exhibitions/${ex.id}/capacity`).set('Authorization', `Bearer ${ADMIN()}`).send({ capacity: 3 })).status).toBe(200);
  });
  it('정원이 찼을 때 수락하면 [모집 인원 변경]으로 늘리라고 안내한다', async () => {
    const g = await seedGallery();
    const ex = await seedExhibition(g.id);
    await testPrisma.exhibition.update({ where: { id: ex.id }, data: { capacity: 1 } });
    await accept(ex.id, 1);
    const app2 = await testPrisma.application.create({ data: { userId: 2, exhibitionId: ex.id, status: 'SUBMITTED' } });
    const r = await request.patch(`/api/exhibitions/${ex.id}/applications/${app2.id}`).set('Authorization', `Bearer ${OWNER()}`).send({ status: 'ACCEPTED' });
    expect(r.status).toBe(400);
    expect(r.body.error).toContain('[모집 인원 변경]');
  });
});

describe('전시 종료 되돌리기 · 판매에 묶인 출품 목록 (점검 P1-3)', () => {
  async function endedWithSale() {
    const g = await seedGallery();
    const ex = await seedExhibition(g.id);
    await testPrisma.exhibition.update({ where: { id: ex.id }, data: { recruitmentClosed: true, confirmed: true, ended: true } });
    await accept(ex.id, 1);
    await testPrisma.exhibitionSubmission.create({ data: { exhibitionId: ex.id, userId: 1, artworkList: JSON.stringify([{ title: '이른 아침' }, { title: '창밖의 오후' }]) } });
    await testPrisma.artworkSale.create({ data: { exhibitionId: ex.id, artistUserId: 1, artworkIndex: 0, title: '이른 아침', soldPrice: 1_200_000 } });
    return ex;
  }
  it('★ 판매 기록이 있으면 갤러리는 전시 종료를 되돌릴 수 없다', async () => {
    const ex = await endedWithSale();
    const r = await request.patch(`/api/operations/${ex.id}/lifecycle`).set('Authorization', `Bearer ${OWNER()}`).send({ ended: false });
    expect(r.status).toBe(400);
    expect(r.body.error).toContain('판매');
  });
  it('정산 확인을 요청 중이어도 되돌릴 수 없다 · 아무 기록이 없으면 되돌린다', async () => {
    const g = await seedGallery();
    const ex = await seedExhibition(g.id);
    await testPrisma.exhibition.update({ where: { id: ex.id }, data: { recruitmentClosed: true, confirmed: true, ended: true, settlementRequestedAt: new Date() } });
    expect((await request.patch(`/api/operations/${ex.id}/lifecycle`).set('Authorization', `Bearer ${OWNER()}`).send({ ended: false })).status).toBe(400);
    await testPrisma.exhibition.update({ where: { id: ex.id }, data: { settlementRequestedAt: null } });
    expect((await request.patch(`/api/operations/${ex.id}/lifecycle`).set('Authorization', `Bearer ${OWNER()}`).send({ ended: false })).status).toBe(200);
  });
  it('관리자는 되돌릴 수 있지만, 그 뒤에도 갤러리는 판매가 묶인 작가의 출품 목록을 [대신 입력]으로 고칠 수 없다', async () => {
    const ex = await endedWithSale();
    expect((await request.patch(`/api/operations/${ex.id}/lifecycle`).set('Authorization', `Bearer ${ADMIN()}`).send({ ended: false })).status).toBe(200);
    const r = await request.put(`/api/operations/${ex.id}/submissions/1`).set('Authorization', `Bearer ${OWNER()}`)
      .send({ artworkList: [{ title: '창밖의 오후' }, { title: '이른 아침' }], cv: null, note: null });
    expect(r.status).toBe(403);
    const sale = await testPrisma.artworkSale.findFirst({ where: { exhibitionId: ex.id } });
    expect(sale?.title).toBe('이른 아침');
  });
});

describe('출품 자료 모양 검증 (점검 P1-5)', () => {
  async function acceptedExhibition() {
    const g = await seedGallery();
    const ex = await seedExhibition(g.id);
    await accept(ex.id, 1);
    return ex;
  }
  it('★ 작품 사진은 우리 저장소 주소만 · 모양이 틀리면 400', async () => {
    const ex = await acceptedExhibition();
    const put = (body: unknown) => request.put(`/api/operations/${ex.id}/me`).set('Authorization', `Bearer ${ARTIST()}`).send(body as object);
    expect((await put({ artworkList: [{ title: 'a', image: 'javascript:alert(1)' }] })).status).toBe(400);
    expect((await put({ artworkList: [{ title: 'a', image: 'https://tracker.example/x.png' }] })).status).toBe(400);
    expect((await put({ note: { statement: 's', sections: 'x' } })).status).toBe(400);
    expect((await put({ artworkList: [{ title: 5 }] })).status).toBe(400);
    expect((await put({ artworkList: [{ title: 'a'.repeat(301) }] })).status).toBe(400);
    expect((await put({ artworkList: [{ title: 'a', image: '/uploads/a.jpg' }] })).status).toBe(200);
  });
  it('모르는 키는 버리고, 보낸 키 순서는 그대로 돌려준다 — 화면의 \'저장 안 된 변경\' 판정이 JSON 비교라서', async () => {
    const ex = await acceptedExhibition();
    const art = { image: '', title: '푸른 밤', size: '72.7×60.6 cm', width: '60.6', height: '72.7', medium: 'Oil', year: '2026', price: '1500000', draft: true };
    const r = await request.put(`/api/operations/${ex.id}/me`).set('Authorization', `Bearer ${ARTIST()}`)
      .send({ artworkList: [{ ...art, hack: 1 }], cv: null, note: { statement: '노트', sections: [] }, representativeIndex: 0 });
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.body.artworkList)).toBe(JSON.stringify([art]));
  });
  it('★ 이미 저장된 이상한 값이 있어도 갤러리 목록·캡션·정산이 500 이 아니다', async () => {
    const ex = await acceptedExhibition();
    await testPrisma.exhibitionSubmission.create({
      data: {
        exhibitionId: ex.id, userId: 1,
        artworkList: JSON.stringify([{ title: 5, image: { a: 1 }, price: [], size: null }, null, 'str', { title: '정상 작품', size: '10×10 cm' }]),
        cv: JSON.stringify('plain-string'),
        note: JSON.stringify({ statement: 42, sections: 'x' }),
      },
    });
    const subs = await request.get(`/api/operations/${ex.id}/submissions`).set('Authorization', `Bearer ${OWNER()}`);
    expect(subs.status).toBe(200);
    expect(subs.body[0].submission.artworkList.map((a: any) => a.title)).toEqual(['5', '정상 작품']);
    expect((await request.get(`/api/operations/${ex.id}/caption.hwp`).set('Authorization', `Bearer ${OWNER()}`)).status).toBe(200);
    await testPrisma.exhibition.update({ where: { id: ex.id }, data: { ended: true, confirmed: true, recruitmentClosed: true } });
    expect((await request.get(`/api/operations/${ex.id}/settlement`).set('Authorization', `Bearer ${OWNER()}`)).status).toBe(200);
  });
});

describe('판매 입력 검증 (점검 P2-12 · S10)', () => {
  async function ended() {
    const g = await seedGallery();
    const ex = await seedExhibition(g.id);
    await testPrisma.exhibition.update({ where: { id: ex.id }, data: { recruitmentClosed: true, confirmed: true, ended: true } });
    await accept(ex.id, 1);
    await testPrisma.exhibitionSubmission.create({ data: { exhibitionId: ex.id, userId: 1, artworkList: JSON.stringify([{ title: 'A' }, { title: 'B', draft: true }]) } });
    return ex;
  }
  const save = (id: number, sales: unknown[]) => request.put(`/api/operations/${id}/settlement`).set('Authorization', `Bearer ${OWNER()}`)
    .send({ sales, ratios: [{ artistUserId: 1, galleryRatio: 40 }] });
  it('★ 0원 판매 · 20억 초과 · 출품 목록 밖 작품 · 같은 작품 두 번 → 400 (예전엔 500·409 였다)', async () => {
    const ex = await ended();
    expect((await save(ex.id, [{ artistUserId: 1, artworkIndex: 0, title: 'A', soldPrice: 0 }])).status).toBe(400);
    expect((await save(ex.id, [{ artistUserId: 1, artworkIndex: 0, title: 'A', soldPrice: 99_999_999_999 }])).status).toBe(400);
    // 임시저장 작품(B)은 갤러리 목록에 없다 — index 1 은 목록 밖
    expect((await save(ex.id, [{ artistUserId: 1, artworkIndex: 1, title: 'B', soldPrice: 100 }])).status).toBe(400);
    expect((await save(ex.id, [{ artistUserId: 1, artworkIndex: -1, title: 'A', soldPrice: 100 }])).status).toBe(400);
    expect((await save(ex.id, [{ artistUserId: 1, artworkIndex: 0, title: 'A', soldPrice: 100 }, { artistUserId: 1, artworkIndex: 0, title: 'A', soldPrice: 200 }])).status).toBe(400);
    expect((await save(ex.id, [{ artistUserId: 1, artworkIndex: 0, title: 'A', soldPrice: 1_500_000 }])).status).toBe(200);
  });
});

describe('글 길이 (점검 S10)', () => {
  it('공지 제목 100자 · 정산 이의 1000자까지', async () => {
    const g = await seedGallery();
    const ex = await seedExhibition(g.id);
    await accept(ex.id, 1);
    expect((await request.post(`/api/operations/${ex.id}/notices`).set('Authorization', `Bearer ${OWNER()}`).send({ title: 't'.repeat(101), content: 'c' })).status).toBe(400);
    expect((await request.post(`/api/operations/${ex.id}/notices`).set('Authorization', `Bearer ${OWNER()}`).send({ title: '반입 안내', content: 'c' })).status).toBe(201);
    await testPrisma.exhibition.update({ where: { id: ex.id }, data: { recruitmentClosed: true, confirmed: true, ended: true, settlementRequestedAt: new Date() } });
    const r = await request.post(`/api/operations/${ex.id}/settlement/respond`).set('Authorization', `Bearer ${ARTIST()}`).send({ approve: false, comment: '틀렸어요'.repeat(300) });
    expect(r.status).toBe(400);
  });
  it('공모 등록 — 큰 정원·없는 지역은 500 이 아니라 400', async () => {
    const g = await seedGallery();
    const base = { title: 'x', type: 'SOLO', deadline: future(10), recruitOnly: true, capacity: 1, region: 'SEOUL', description: 'x', galleryId: g.id };
    expect((await request.post('/api/exhibitions').set('Authorization', `Bearer ${OWNER()}`).send({ ...base, capacity: 99_999_999_999 })).status).toBe(400);
    expect((await request.post('/api/exhibitions').set('Authorization', `Bearer ${OWNER()}`).send({ ...base, region: 'MARS' })).status).toBe(400);
    expect((await request.post('/api/exhibitions').set('Authorization', `Bearer ${OWNER()}`).send({ ...base, title: 't'.repeat(101) })).status).toBe(400);
  });
});

describe('공모 날짜 순서 — 서버도 본다 (점검 P2-14)', () => {
  const base = (g: number) => ({ title: 'x', type: 'SOLO', capacity: 1, region: 'SEOUL', description: 'x', galleryId: g });
  it('★ 공모만 진행이어도 시작일이 마감일보다 늦으면 400 · 지난 마감일 400', async () => {
    const g = await seedGallery();
    const post = (b: object) => request.post('/api/exhibitions').set('Authorization', `Bearer ${OWNER()}`).send({ ...base(g.id), ...b });
    expect((await post({ recruitOnly: true, deadlineStart: future(20), deadline: future(10) })).status).toBe(400);
    expect((await post({ recruitOnly: true, deadline: future(-3) })).status).toBe(400);
    expect((await post({ recruitOnly: true, deadlineStart: future(0), deadline: future(10) })).status).toBe(201);
  });
  it('전시 시작 > 종료 400 · 공모 마감 > 전시 시작 400', async () => {
    const g = await seedGallery();
    const post = (b: object) => request.post('/api/exhibitions').set('Authorization', `Bearer ${OWNER()}`).send({ ...base(g.id), ...b });
    expect((await post({ deadline: future(10), submissionDeadline: future(15), exhibitStartDate: future(30), exhibitDate: future(20) })).status).toBe(400);
    expect((await post({ deadline: future(25), submissionDeadline: future(15), exhibitStartDate: future(20), exhibitDate: future(30) })).status).toBe(400);
    expect((await post({ deadline: future(10), submissionDeadline: future(15), exhibitStartDate: future(20), exhibitDate: future(30) })).status).toBe(201);
  });
});

describe('공모 시작일 전 지원 (점검 P2-13)', () => {
  it('★ 시작일 전에는 400("N월 N일부터"), 시작일 당일부터 된다', async () => {
    const g = await seedGallery();
    const ex = await seedExhibition(g.id);
    await testPrisma.exhibition.update({ where: { id: ex.id }, data: { deadlineStart: new Date(Date.now() + 5 * DAY) } });
    const early = await request.post(`/api/exhibitions/${ex.id}/apply`).set('Authorization', `Bearer ${ARTIST()}`).send(applyBody);
    expect(early.status).toBe(400);
    expect(early.body.error).toContain('부터 지원을 받아요');
    await testPrisma.exhibition.update({ where: { id: ex.id }, data: { deadlineStart: new Date() } });
    expect((await request.post(`/api/exhibitions/${ex.id}/apply`).set('Authorization', `Bearer ${ARTIST()}`).send(applyBody)).status).toBe(201);
  });
});

describe('전시 종료 뒤 지원 상태 변경 (2026-10-03 사용자 결정)', () => {
  it('★ 갤러리는 400, 관리자는 된다', async () => {
    const g = await seedGallery();
    const ex = await seedExhibition(g.id);
    const app = await testPrisma.application.create({ data: { userId: 1, exhibitionId: ex.id, status: 'REJECTED' } });
    await testPrisma.exhibition.update({ where: { id: ex.id }, data: { recruitmentClosed: true, confirmed: true, ended: true } });
    const r = await request.patch(`/api/exhibitions/${ex.id}/applications/${app.id}`).set('Authorization', `Bearer ${OWNER()}`).send({ status: 'ACCEPTED' });
    expect(r.status).toBe(400);
    expect(r.body.error).toContain('전시가 종료');
    expect((await request.patch(`/api/exhibitions/${ex.id}/applications/${app.id}`).set('Authorization', `Bearer ${ADMIN()}`).send({ status: 'ACCEPTED' })).status).toBe(200);
  });
});

describe('결과 알림 문구 — 작가 화면의 말(선정·미선정)과 같게', () => {
  it('★ 선정(전시까지) · 선정(공모만) · 미선정은 "지원 결과가 나왔어요" 까지만', async () => {
    const g = await seedGallery();
    const full = await seedExhibition(g.id);
    const only = await seedExhibition(g.id);
    await testPrisma.exhibition.update({ where: { id: only.id }, data: { recruitOnly: true, exhibitDate: null } });
    const a1 = await testPrisma.application.create({ data: { userId: 1, exhibitionId: full.id, status: 'SUBMITTED' } });
    const a2 = await testPrisma.application.create({ data: { userId: 2, exhibitionId: only.id, status: 'SUBMITTED' } });
    const a3 = await testPrisma.application.create({ data: { userId: 2, exhibitionId: full.id, status: 'SUBMITTED' } });
    await request.patch(`/api/exhibitions/${full.id}/applications/${a1.id}`).set('Authorization', `Bearer ${OWNER()}`).send({ status: 'ACCEPTED' });
    await request.patch(`/api/exhibitions/${only.id}/applications/${a2.id}`).set('Authorization', `Bearer ${OWNER()}`).send({ status: 'ACCEPTED' });
    await request.patch(`/api/exhibitions/${full.id}/applications/${a3.id}`).set('Authorization', `Bearer ${OWNER()}`).send({ status: 'REJECTED' });
    const msgs = (await testPrisma.notification.findMany({ where: { type: 'APPLICATION_STATUS' }, orderBy: { id: 'asc' } })).map((n) => [n.userId, n.message, n.linkUrl]);
    expect(msgs).toEqual([
      [1, '"Test Exhibition"에 선정되었어요. [내 전시]에서 출품 자료를 제출해 주세요.', `/mypage?tab=applications&ex=${full.id}`],
      [2, '"Test Exhibition"에 선정되었어요.', `/mypage?tab=applications&ex=${only.id}`],
      [2, '"Test Exhibition" 지원 결과가 나왔어요.', `/mypage?tab=applications&ex=${full.id}`],
    ]);
  });
});

describe('내 정산 확인 상태 — [내 전시] 카드가 \'확인 필요\' 를 답하기 전에만 띄운다 (점검 P2-6)', () => {
  it('★ my-applications 가 mySettlementStatus 를 준다', async () => {
    const g = await seedGallery();
    const ex = await seedExhibition(g.id);
    await accept(ex.id, 1);
    const before = await request.get('/api/exhibitions/my-applications').set('Authorization', `Bearer ${ARTIST()}`);
    expect(before.body[0].mySettlementStatus).toBeNull();
    await testPrisma.settlementApproval.create({ data: { exhibitionId: ex.id, artistUserId: 1, status: 'ISSUE', comment: '틀림' } });
    const after = await request.get('/api/exhibitions/my-applications').set('Authorization', `Bearer ${ARTIST()}`);
    expect(after.body[0].mySettlementStatus).toBe('ISSUE');
    expect(after.body[0].exhibition).not.toHaveProperty('settlementApprovals');
    void ARTIST2;
  });
});
