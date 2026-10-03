import { describe, it, expect, beforeEach } from 'vitest';
import { request, testPrisma, authToken, cleanDb, seedUsers, seedGallery, seedExhibition } from './helpers';
import { ARTIST_APPLY_TERMS_VERSION } from '../lib/terms';
import { normalizeInviteCode, formatInviteCode, generateInviteCode, INVITE_CODE_ALPHABET } from '../lib/inviteCode';

/**
 * 공모 초대 코드 (2026-09-27) — 이미 선정이 끝난 공모를 옮겨 올 때, 코드를 넣은 작가는 지원서 없이 곧바로 수락된다.
 * 코드 = 수락 권한이라 ①공개 응답에 새지 않는지 ②운영자만 만들고 끄는지 ③정원(선정 인원)·거절 결정을 지키는지를 본다.
 */
const galleryTok = authToken(3, 'GALLERY');
const adminTok = authToken(4, 'ADMIN');
const artist1Tok = authToken(1, 'ARTIST');
const artist2Tok = authToken(2, 'ARTIST');
const APPLY_BODY = { biography: '약력', artworkImages: ['/uploads/a.jpg'], termsAgreed: true, termsVersion: ARTIST_APPLY_TERMS_VERSION };

let exhibitionId: number;
const makeCode = () => request.post(`/api/exhibitions/${exhibitionId}/join-code`).set('Authorization', `Bearer ${galleryTok}`);
const join = (tok: string, code: string) => request.post('/api/exhibitions/join').set('Authorization', `Bearer ${tok}`).send({ code });

beforeEach(async () => {
  await cleanDb();
  await seedUsers();
  const g = await seedGallery(3);
  exhibitionId = (await seedExhibition(g.id)).id;
});

describe('코드 형식 (lib/inviteCode)', () => {
  it('8자리, 헷갈리는 글자 없음, 입력은 대소문자·하이픈·공백을 무시한다', () => {
    const c = generateInviteCode();
    expect(c).toHaveLength(8);
    for (const ch of c) expect(INVITE_CODE_ALPHABET).toContain(ch);
    expect(INVITE_CODE_ALPHABET).not.toMatch(/[0O1IL]/);
    expect(normalizeInviteCode(`${c.slice(0, 4).toLowerCase()}-${c.slice(4)}`)).toBe(c);
    expect(normalizeInviteCode(` ${c.slice(0, 4)} ${c.slice(4)} `)).toBe(c);
    expect(normalizeInviteCode('ABCD-EFG0')).toBeNull();   // 0 은 쓰지 않는 글자
    expect(normalizeInviteCode('ABC')).toBeNull();
    expect(normalizeInviteCode(12345678)).toBeNull();
    expect(formatInviteCode('K7M4QX2P')).toBe('K7M4-QX2P');
  });
});

describe('운영자 — 만들기·새로 발급·끄기', () => {
  it('처음엔 없고, 만들면 코드와 선정 현황을 준다', async () => {
    const before = await request.get(`/api/exhibitions/${exhibitionId}/join-code`).set('Authorization', `Bearer ${galleryTok}`);
    expect(before.status).toBe(200);
    expect(before.body.code).toBeNull();
    const r = await makeCode();
    expect(r.status).toBe(200);
    expect(normalizeInviteCode(r.body.code)).toBe(r.body.code);
    expect(r.body).toMatchObject({ selected: 0, capacity: 5 });
  });

  it('새로 발급하면 옛 코드는 그 순간 죽는다', async () => {
    const old = (await makeCode()).body.code;
    const next = (await makeCode()).body.code;
    expect(next).not.toBe(old);
    expect((await request.get(`/api/exhibitions/join/${old}`)).status).toBe(404);
    expect((await request.get(`/api/exhibitions/join/${next}`)).status).toBe(200);
  });

  it('끄면 코드로 들어올 수 없다', async () => {
    const code = (await makeCode()).body.code;
    const off = await request.delete(`/api/exhibitions/${exhibitionId}/join-code`).set('Authorization', `Bearer ${galleryTok}`);
    expect(off.body.code).toBeNull();
    expect((await join(artist1Tok, code)).status).toBe(404);
  });

  it('남의 갤러리·작가는 만들 수 없고, Admin 은 된다', async () => {
    const other = await testPrisma.user.create({ data: { email: 'other@g.test', name: '다른 갤러리', role: 'GALLERY', provider: 'LOCAL' } });
    const r1 = await request.post(`/api/exhibitions/${exhibitionId}/join-code`).set('Authorization', `Bearer ${authToken(other.id, 'GALLERY')}`);
    expect([403, 404]).toContain(r1.status);
    expect((await request.post(`/api/exhibitions/${exhibitionId}/join-code`).set('Authorization', `Bearer ${artist1Tok}`)).status).toBe(403);
    expect((await request.post(`/api/exhibitions/${exhibitionId}/join-code`).set('Authorization', `Bearer ${adminTok}`)).status).toBe(200);
  });

  it('승인 전·전시 종료 뒤에는 만들 수 없다', async () => {
    await testPrisma.exhibition.update({ where: { id: exhibitionId }, data: { status: 'PENDING' } });
    expect((await makeCode()).status).toBe(400);
    await testPrisma.exhibition.update({ where: { id: exhibitionId }, data: { status: 'APPROVED', ended: true } });
    expect((await makeCode()).status).toBe(400);
  });

  it('⚠️ 코드는 공개 응답에 새지 않는다 — 공모 상세·목록 어디에도', async () => {
    const code = (await makeCode()).body.code;
    const detail = await request.get(`/api/exhibitions/${exhibitionId}`);
    const list = await request.get('/api/exhibitions');
    const asArtist = await request.get(`/api/exhibitions/${exhibitionId}`).set('Authorization', `Bearer ${artist1Tok}`);
    for (const r of [detail, list, asArtist]) expect(JSON.stringify(r.body)).not.toContain(code);
  });
});

describe('미리보기 GET /exhibitions/join/:code', () => {
  it('형식이 틀리거나 없는 코드는 404, 맞으면 공모 요약(비로그인도)', async () => {
    const code = (await makeCode()).body.code;
    expect((await request.get('/api/exhibitions/join/ZZZZ')).status).toBe(404);
    expect((await request.get('/api/exhibitions/join/ABCDEFGH')).status).toBe(404);
    const r = await request.get(`/api/exhibitions/join/${code.toLowerCase()}`);
    expect(r.status).toBe(200);
    expect(r.body.exhibition).toMatchObject({ id: exhibitionId, title: 'Test Exhibition', galleryName: 'Test Gallery' });
    expect(r.body).toMatchObject({ selected: 0, full: false, blocked: null, my: null });
    expect(r.body.exhibition.gallery).toBeUndefined();   // ownerId 등 갤러리 내부 값은 싣지 않는다
  });

  it('승인이 풀린 공모의 코드는 존재를 알리지 않는다(404)', async () => {
    const code = (await makeCode()).body.code;
    await testPrisma.exhibition.update({ where: { id: exhibitionId }, data: { status: 'PENDING' } });
    expect((await request.get(`/api/exhibitions/join/${code}`)).status).toBe(404);
  });

  it('로그인한 작가에게는 내 지원 상태도 준다', async () => {
    const code = (await makeCode()).body.code;
    await request.post(`/api/exhibitions/${exhibitionId}/apply`).set('Authorization', `Bearer ${artist1Tok}`).send(APPLY_BODY);
    const r = await request.get(`/api/exhibitions/join/${code}`).set('Authorization', `Bearer ${artist1Tok}`);
    expect(r.body.my).toEqual({ status: 'SUBMITTED' });
  });
});

describe('참여 POST /exhibitions/join', () => {
  it('처음 들어오면 곧바로 수락 — 작품이 0점이어도 된다, 갤러리에 알림, 단톡 합류', async () => {
    const code = (await makeCode()).body.code;
    const r = await join(artist1Tok, `${code.slice(0, 4)}-${code.slice(4)}`.toLowerCase());
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ exhibitionId, status: 'ACCEPTED' });
    const app = await testPrisma.application.findFirst({ where: { exhibitionId, userId: 1 } });
    expect(app).toMatchObject({ status: 'ACCEPTED', joinedVia: 'CODE', artworkImages: '[]', termsVersion: ARTIST_APPLY_TERMS_VERSION });
    expect(app!.termsAgreedAt).not.toBeNull();
    const noti = await testPrisma.notification.findFirst({ where: { userId: 3, type: 'NEW_APPLICANT' } });
    expect(noti?.message).toContain('초대 코드로 참여');
    const chat = await testPrisma.chat.findFirst({ where: { exhibitionId }, include: { participants: true } });
    expect(chat?.participants.map((p) => p.userId)).toContain(1);
    // 갤러리 지원자 목록에서 '코드 참여'로 구분된다
    const list = await request.get(`/api/exhibitions/${exhibitionId}/applications`).set('Authorization', `Bearer ${galleryTok}`);
    expect(list.body[0].joinedVia).toBe('CODE');
  });

  it('두 번 눌러도 에러가 아니다(이미 참여)', async () => {
    const code = (await makeCode()).body.code;
    expect((await join(artist1Tok, code)).status).toBe(201);
    const again = await join(artist1Tok, code);
    expect(again.status).toBe(200);
    expect(again.body.alreadyJoined).toBe(true);
    expect(await testPrisma.application.count({ where: { exhibitionId, userId: 1 } })).toBe(1);
  });

  it('이미 접수된 지원은 수락으로 올라간다', async () => {
    const code = (await makeCode()).body.code;
    await request.post(`/api/exhibitions/${exhibitionId}/apply`).set('Authorization', `Bearer ${artist1Tok}`).send(APPLY_BODY);
    const r = await join(artist1Tok, code);
    expect(r.status).toBe(200);
    const app = await testPrisma.application.findFirst({ where: { exhibitionId, userId: 1 } });
    expect(app).toMatchObject({ status: 'ACCEPTED', joinedVia: 'CODE', biography: '약력' });
  });

  it('⚠️ 거절된 작가는 코드로 결정을 뒤집을 수 없다', async () => {
    const code = (await makeCode()).body.code;
    const a = await request.post(`/api/exhibitions/${exhibitionId}/apply`).set('Authorization', `Bearer ${artist1Tok}`).send(APPLY_BODY);
    await request.patch(`/api/exhibitions/${exhibitionId}/applications/${a.body.id}`).set('Authorization', `Bearer ${galleryTok}`).send({ status: 'REJECTED' });
    const r = await join(artist1Tok, code);
    expect(r.status).toBe(400);
    expect(r.body.error).toContain('선정되지 않은');
    expect((await testPrisma.application.findFirst({ where: { exhibitionId, userId: 1 } }))!.status).toBe('REJECTED');
  });

  it('선정 인원이 차면 막는다', async () => {
    await testPrisma.exhibition.update({ where: { id: exhibitionId }, data: { capacity: 1 } });
    const code = (await makeCode()).body.code;
    expect((await join(artist1Tok, code)).status).toBe(201);
    const r = await join(artist2Tok, code);
    expect(r.status).toBe(400);
    expect(r.body.error).toContain('선정 인원(1명)');
  });

  it('모집 마감일이 지나도 전시 종료 전까지는 들어온다(이미 선정된 작가용)', async () => {
    const code = (await makeCode()).body.code;
    await testPrisma.exhibition.update({ where: { id: exhibitionId }, data: { deadline: new Date(Date.now() - 3 * 864e5), recruitmentClosed: true } });
    expect((await join(artist1Tok, code)).status).toBe(201);
    await testPrisma.exhibition.update({ where: { id: exhibitionId }, data: { ended: true } });
    const r = await join(artist2Tok, code);
    expect(r.status).toBe(400);
    expect(r.body.error).toContain('전시가 끝난');
  });

  it('작가만 참여한다 — 갤러리·비로그인은 막는다', async () => {
    const code = (await makeCode()).body.code;
    expect((await join(galleryTok, code)).status).toBe(403);
    expect((await request.post('/api/exhibitions/join').send({ code })).status).toBe(401);
  });

  it('동시에 둘이 마지막 자리에 들어와도 정원을 넘지 않는다', async () => {
    await testPrisma.exhibition.update({ where: { id: exhibitionId }, data: { capacity: 1 } });
    const code = (await makeCode()).body.code;
    const rs = await Promise.all([join(artist1Tok, code), join(artist2Tok, code)]);
    expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
    expect(await testPrisma.application.count({ where: { exhibitionId, status: 'ACCEPTED' } })).toBe(1);
  });
});

describe('공모 상세의 myApplication', () => {
  it('지원한 작가 본인에게만 상태를 준다', async () => {
    const a = await request.post(`/api/exhibitions/${exhibitionId}/apply`).set('Authorization', `Bearer ${artist1Tok}`).send(APPLY_BODY);
    expect((await request.get(`/api/exhibitions/${exhibitionId}`).set('Authorization', `Bearer ${artist1Tok}`)).body.myApplication).toEqual({ status: 'SUBMITTED' });
    expect((await request.get(`/api/exhibitions/${exhibitionId}`).set('Authorization', `Bearer ${artist2Tok}`)).body.myApplication).toBeNull();
    expect((await request.get(`/api/exhibitions/${exhibitionId}`)).body.myApplication).toBeNull();
    await request.patch(`/api/exhibitions/${exhibitionId}/applications/${a.body.id}`).set('Authorization', `Bearer ${galleryTok}`).send({ status: 'ACCEPTED' });
    expect((await request.get(`/api/exhibitions/${exhibitionId}`).set('Authorization', `Bearer ${artist1Tok}`)).body.myApplication).toEqual({ status: 'ACCEPTED' });
  });
});

describe('갤러리 운영 목록(my-operation-overview)', () => {
  it('공모만 진행이면 수락 작가가 있어도 다음 할 일이 작가 자료 수집이 아니다', async () => {
    await testPrisma.exhibition.update({ where: { id: exhibitionId }, data: { recruitOnly: true, submissionDeadline: null } });
    const a = await request.post(`/api/exhibitions/${exhibitionId}/apply`).set('Authorization', `Bearer ${artist1Tok}`).send(APPLY_BODY);
    await request.patch(`/api/exhibitions/${exhibitionId}/applications/${a.body.id}`).set('Authorization', `Bearer ${galleryTok}`).send({ status: 'ACCEPTED' });
    const r = await request.get('/api/exhibitions/my-operation-overview').set('Authorization', `Bearer ${galleryTok}`);
    const item = r.body.find((x: any) => x.id === exhibitionId);
    expect(item).toMatchObject({ recruitOnly: true, capacity: 5 });
    expect(item.nextAction.label).not.toBe('작가 자료 수집');
  });
});
