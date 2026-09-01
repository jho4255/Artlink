/**
 * 대화(갠톡·단톡) — `routes/chat.ts` · `lib/chat.ts`
 *
 * 예전 쪽지는 라우트마다 "작가는 갤러리에게만" 같은 역할 규칙이 박혀 있어 작가끼리 대화가 아예 안 됐다.
 * 지금은 **방에 들어가 있는가** 하나로만 판정한다. 그래서 두 가지를 반드시 못 박아야 한다.
 *   ① 역할로 막지 않는다 (작가↔작가도 된다)
 *   ② 대신 **남의 방은 절대 못 본다** — 권한이 참여 여부 하나에 달려 있으므로 여기가 뚫리면 전부 샌다
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { request, testPrisma, authToken, cleanDb, seedUsers, seedGallery, seedExhibition } from './helpers';
import { directKeyOf, ensureExhibitionChat } from '../lib/chat';

const a1 = authToken(1, 'ARTIST');
const a2 = authToken(2, 'ARTIST');
const owner = authToken(3, 'GALLERY');
const admin = authToken(4, 'ADMIN');

describe('directKeyOf', () => {
  it('누가 먼저 걸든 같은 키 — 방이 두 개 생기지 않게', () => {
    expect(directKeyOf(1, 2)).toBe('1-2');
    expect(directKeyOf(2, 1)).toBe('1-2');
  });
});

describe('갠톡 (1:1)', () => {
  beforeEach(async () => { await cleanDb(); await seedUsers(); });

  const openDirect = (tok: string, userId: number) =>
    request.post('/api/chats/direct').set('Authorization', `Bearer ${tok}`).send({ userId });

  it('★ 작가끼리도 대화할 수 있다 (예전 쪽지는 이게 막혀 있었다)', async () => {
    const r = await openDirect(a1, 2);
    expect(r.status).toBe(200);
    expect(r.body.id).toBeGreaterThan(0);
  });

  it('두 번 열어도 방은 하나 (누가 먼저 걸든)', async () => {
    const first = await openDirect(a1, 2);
    const again = await openDirect(a2, 1);
    expect(again.body.id).toBe(first.body.id);
    expect(await testPrisma.chat.count({ where: { kind: 'DIRECT' } })).toBe(1);
  });

  it('자기 자신과는 못 연다', async () => {
    expect((await openDirect(a1, 1)).status).toBe(400);
  });

  it('탈퇴한 회원과는 새로 시작할 수 없다', async () => {
    await testPrisma.user.update({ where: { id: 2 }, data: { deletedAt: new Date() } });
    expect((await openDirect(a1, 2)).status).toBe(404);
  });

  it('비로그인은 열 수 없다', async () => {
    expect((await request.post('/api/chats/direct').send({ userId: 2 })).status).toBe(401);
  });

  it('★ 갠톡에서 내가 보낸 말은 상대가 읽어야 read=true 가 된다', async () => {
    const { body: { id } } = await openDirect(a1, 2);
    await request.post(`/api/chats/${id}/messages`).set('Authorization', `Bearer ${a1}`).send({ content: '안녕하세요' });

    const mine = await request.get(`/api/chats/${id}`).set('Authorization', `Bearer ${a1}`);
    expect(mine.body.messages[0].read, '상대가 아직 안 읽었다').toBe(false);

    await request.get(`/api/chats/${id}`).set('Authorization', `Bearer ${a2}`);   // 상대가 열어봄 = 읽음
    const after = await request.get(`/api/chats/${id}`).set('Authorization', `Bearer ${a1}`);
    expect(after.body.messages[0].read).toBe(true);
  });

  it('받은 사람의 안읽음에 잡히고, 열면 사라진다', async () => {
    const { body: { id } } = await openDirect(a1, 2);
    await request.post(`/api/chats/${id}/messages`).set('Authorization', `Bearer ${a1}`).send({ content: 'hi' });

    const before = await request.get('/api/chats/unread-count').set('Authorization', `Bearer ${a2}`);
    expect(before.body.count).toBe(1);
    // 보낸 사람 본인은 안읽음이 아니다
    expect((await request.get('/api/chats/unread-count').set('Authorization', `Bearer ${a1}`)).body.count).toBe(0);

    await request.get(`/api/chats/${id}`).set('Authorization', `Bearer ${a2}`);
    expect((await request.get('/api/chats/unread-count').set('Authorization', `Bearer ${a2}`)).body.count).toBe(0);
  });

  it('빈 메시지·너무 긴 메시지는 거절', async () => {
    const { body: { id } } = await openDirect(a1, 2);
    const send = (content: string) =>
      request.post(`/api/chats/${id}/messages`).set('Authorization', `Bearer ${a1}`).send({ content });
    expect((await send('   ')).status).toBe(400);
    expect((await send('x'.repeat(2001))).status).toBe(400);
    expect((await send('ok')).status).toBe(201);
  });
});

describe('첨부 (사진·동영상·파일)', () => {
  beforeEach(async () => { await cleanDb(); await seedUsers(); });
  const openDirect = (tok: string, userId: number) =>
    request.post('/api/chats/direct').set('Authorization', `Bearer ${tok}`).send({ userId });
  const send = (id: number, tok: string, body: any) =>
    request.post(`/api/chats/${id}/messages`).set('Authorization', `Bearer ${tok}`).send(body);

  it('★ 본문 없이 사진만 보낼 수 있다', async () => {
    const { body: { id } } = await openDirect(a1, 2);
    const r = await send(id, a1, { attachmentUrl: '/uploads/pic-1.jpg', attachmentType: 'IMAGE' });
    expect(r.status).toBe(201);
    expect(r.body.attachmentType).toBe('IMAGE');
    expect(r.body.attachmentUrl).toBe('/uploads/pic-1.jpg');
    expect(r.body.content).toBe('');
  });

  it('본문과 첨부를 함께 보낼 수 있다', async () => {
    const { body: { id } } = await openDirect(a1, 2);
    const r = await send(id, a1, { content: '이 작품이요', attachmentUrl: '/uploads/pic-2.jpg', attachmentType: 'IMAGE' });
    expect(r.status).toBe(201);
    expect(r.body.content).toBe('이 작품이요');
    expect(r.body.attachmentType).toBe('IMAGE');
  });

  it('파일은 이름·용량 메타를 함께 저장한다', async () => {
    const { body: { id } } = await openDirect(a1, 2);
    const r = await send(id, a1, { attachmentUrl: '/uploads/doc-1.pdf', attachmentType: 'FILE', attachmentName: '포트폴리오.pdf', attachmentSize: 123456 });
    expect(r.status).toBe(201);
    expect(r.body.attachmentName).toBe('포트폴리오.pdf');
    expect(r.body.attachmentSize).toBe(123456);
  });

  it('동영상도 보낼 수 있다', async () => {
    const { body: { id } } = await openDirect(a1, 2);
    const r = await send(id, a1, { attachmentUrl: '/uploads/clip-1.mp4', attachmentType: 'VIDEO' });
    expect(r.status).toBe(201);
    expect(r.body.attachmentType).toBe('VIDEO');
  });

  it('★ 본문도 첨부도 없으면 거절', async () => {
    const { body: { id } } = await openDirect(a1, 2);
    expect((await send(id, a1, {})).status).toBe(400);
    expect((await send(id, a1, { content: '   ' })).status).toBe(400);
  });

  it('★ 첨부 종류 없이 주소만 오면 거절 (엉뚱한 값 방지)', async () => {
    const { body: { id } } = await openDirect(a1, 2);
    expect((await send(id, a1, { attachmentUrl: '/uploads/x.jpg' })).status).toBe(400);
  });

  it('★ 이상한 첨부 주소(javascript: 등)는 막는다', async () => {
    const { body: { id } } = await openDirect(a1, 2);
    const r = await send(id, a1, { attachmentUrl: 'javascript:alert(1)', attachmentType: 'IMAGE' });
    expect(r.status).toBe(400);
  });

  it('★ 외부 URL 은 첨부로 못 넣는다 (추적 픽셀·피싱 차단 — 우리 저장소만)', async () => {
    const { body: { id } } = await openDirect(a1, 2);
    for (const url of ['https://evil.com/track.gif', 'http://attacker.test/x.mp4', '/etc/passwd']) {
      const r = await send(id, a1, { attachmentUrl: url, attachmentType: 'IMAGE' });
      expect(r.status, `${url} 이 통과했다`).toBe(400);
    }
    // 우리 업로드 경로는 통과
    expect((await send(id, a1, { attachmentUrl: '/uploads/ours.jpg', attachmentType: 'IMAGE' })).status).toBe(201);
  });

  it('알 수 없는 첨부 종류는 거절', async () => {
    const { body: { id } } = await openDirect(a1, 2);
    expect((await send(id, a1, { attachmentUrl: '/uploads/x.jpg', attachmentType: 'AUDIO' })).status).toBe(400);
  });

  it('★ 남의 방에는 첨부도 못 올린다 (404)', async () => {
    const { body: { id } } = await openDirect(a1, 2);
    const r = await send(id, owner, { attachmentUrl: '/uploads/pic.jpg', attachmentType: 'IMAGE' });
    expect(r.status).toBe(404);
  });

  it('목록 미리보기: 첨부만이면 종류 라벨로 보인다', async () => {
    const { body: { id } } = await openDirect(a1, 2);
    await send(id, a1, { attachmentUrl: '/uploads/pic.jpg', attachmentType: 'IMAGE' });
    const list = await request.get('/api/chats').set('Authorization', `Bearer ${a1}`);
    const room = list.body.find((c: any) => c.id === id);
    expect(room.lastMessage.content).toBe('[사진]');
  });
});

describe('★ 남의 방은 못 본다 (권한이 참여 여부 하나에 달려 있다)', () => {
  let chatId: number;
  beforeEach(async () => {
    await cleanDb(); await seedUsers();
    const r = await request.post('/api/chats/direct').set('Authorization', `Bearer ${a1}`).send({ userId: 2 });
    chatId = r.body.id;
  });

  it('참여자가 아니면 읽기·쓰기·읽음처리 모두 404 (403 은 방의 존재를 알려준다)', async () => {
    for (const tok of [owner, admin]) {
      expect((await request.get(`/api/chats/${chatId}`).set('Authorization', `Bearer ${tok}`)).status).toBe(404);
      expect((await request.post(`/api/chats/${chatId}/messages`).set('Authorization', `Bearer ${tok}`).send({ content: 'x' })).status).toBe(404);
      expect((await request.post(`/api/chats/${chatId}/read`).set('Authorization', `Bearer ${tok}`)).status).toBe(404);
    }
  });

  it('Admin 이라고 남의 갠톡을 들여다볼 수 없다', async () => {
    const list = await request.get('/api/chats').set('Authorization', `Bearer ${admin}`);
    expect(list.body).toEqual([]);
  });

  it('없는 방·이상한 id 도 404', async () => {
    expect((await request.get('/api/chats/999999').set('Authorization', `Bearer ${a1}`)).status).toBe(404);
    expect((await request.get('/api/chats/abc').set('Authorization', `Bearer ${a1}`)).status).toBe(404);
  });
});

describe('단톡 (공모방)', () => {
  let exId: number;
  beforeEach(async () => {
    await cleanDb(); await seedUsers();
    const gallery = await seedGallery(3);
    const ex = await seedExhibition(gallery.id);
    exId = ex.id;
    await testPrisma.exhibition.update({ where: { id: exId }, data: { status: 'APPROVED' } });
  });

  it('공모 단톡은 공모당 하나 — 여러 번 불러도 방이 늘지 않는다', async () => {
    const a = await ensureExhibitionChat(exId);
    const b = await ensureExhibitionChat(exId);
    expect(a).toBe(b);
    expect(await testPrisma.chat.count({ where: { kind: 'GROUP' } })).toBe(1);
  });

  it('승인 전 공모에는 방을 만들지 않는다', async () => {
    await testPrisma.exhibition.update({ where: { id: exId }, data: { status: 'PENDING' } });
    expect(await ensureExhibitionChat(exId)).toBeNull();
  });

  it('★ 갤러리 오너와 수락된 작가가 자동 참여자가 된다 (거절·미심사 작가는 제외)', async () => {
    await testPrisma.application.create({ data: { userId: 1, exhibitionId: exId, status: 'ACCEPTED' } });
    await testPrisma.application.create({ data: { userId: 2, exhibitionId: exId, status: 'REJECTED' } });
    const chatId = (await ensureExhibitionChat(exId))!;
    const ids = (await testPrisma.chatParticipant.findMany({ where: { chatId }, select: { userId: true } }))
      .map(p => p.userId).sort();
    expect(ids).toEqual([1, 3]);
  });

  it('나중에 수락된 작가도 다시 부르면 합류한다 (멱등)', async () => {
    const chatId = (await ensureExhibitionChat(exId))!;
    await testPrisma.application.create({ data: { userId: 1, exhibitionId: exId, status: 'ACCEPTED' } });
    await ensureExhibitionChat(exId);
    expect(await testPrisma.chatParticipant.count({ where: { chatId } })).toBe(2);
  });

  it('★ 수락이 풀려도 방에서 빼지 않는다 (지난 대화를 읽을 수 있어야 한다)', async () => {
    const app = await testPrisma.application.create({ data: { userId: 1, exhibitionId: exId, status: 'ACCEPTED' } });
    const chatId = (await ensureExhibitionChat(exId))!;
    await testPrisma.application.update({ where: { id: app.id }, data: { status: 'REJECTED' } });
    await ensureExhibitionChat(exId);
    expect(await testPrisma.chatParticipant.count({ where: { chatId } })).toBe(2);
  });

  it('★ 단톡에서는 아직 안 읽은 사람 수가 보인다', async () => {
    await testPrisma.application.create({ data: { userId: 1, exhibitionId: exId, status: 'ACCEPTED' } });
    await testPrisma.application.create({ data: { userId: 2, exhibitionId: exId, status: 'ACCEPTED' } });
    const chatId = (await ensureExhibitionChat(exId))!;

    await request.post(`/api/chats/${chatId}/messages`).set('Authorization', `Bearer ${owner}`).send({ content: '공지드립니다' });
    const first = await request.get(`/api/chats/${chatId}`).set('Authorization', `Bearer ${owner}`);
    expect(first.body.messages[0].unreadBy, '작가 2명이 아직 안 읽음').toBe(2);

    await request.get(`/api/chats/${chatId}`).set('Authorization', `Bearer ${a1}`);
    const after = await request.get(`/api/chats/${chatId}`).set('Authorization', `Bearer ${owner}`);
    expect(after.body.messages[0].unreadBy).toBe(1);
  });

  it('단톡은 API 로 만들 수 없다 (공모 승인 때 서버가 만든다)', async () => {
    // 방을 만드는 엔드포인트가 /direct 하나뿐이라는 것 — 갤러리가 임의 단톡을 못 만든다
    const r = await request.post('/api/chats').set('Authorization', `Bearer ${owner}`).send({ kind: 'GROUP' });
    expect([404, 405]).toContain(r.status);
  });
});

/**
 * 초대 수락 = **지원 없이 바로 참가**
 *
 * 갤러리가 이미 작품을 보고 부른 것이라 지원서를 다시 쓰게 하지 않는다.
 * 다만 정원·마감은 그대로 지켜야 한다 — 초대가 있었다고 정원을 넘겨 받을 수는 없다.
 */
describe('초대 수락 → 바로 참가', () => {
  let exId: number;
  const invite = (artistId: number) =>
    testPrisma.exhibitionInvite.create({ data: { exhibitionId: exId, artistId, senderId: 3, message: '함께해요' } });
  const accept = (id: number, tok = a1) =>
    request.post(`/api/exhibitions/invites/${id}/accept`).set('Authorization', `Bearer ${tok}`).send({});

  beforeEach(async () => {
    await cleanDb(); await seedUsers();
    const gallery = await seedGallery(3);
    const ex = await seedExhibition(gallery.id);
    exId = ex.id;
    await testPrisma.exhibition.update({ where: { id: exId }, data: { status: 'APPROVED', capacity: 1 } });
    // 참여하려면 포트폴리오에 작품이 있어야 한다 (약력·작품을 여기서 가져온다)
    const p = await testPrisma.portfolio.create({ data: { userId: 1, biography: '내 약력' } });
    await testPrisma.portfolioImage.create({ data: { portfolioId: p.id, url: 'https://cdn.example.com/a.jpg', order: 0 } });
  });

  it('★ 수락하면 지원서 없이 ACCEPTED 로 등록된다', async () => {
    const inv = await invite(1);
    const r = await accept(inv.id);
    expect(r.status).toBe(201);
    const app = await testPrisma.application.findFirst({ where: { exhibitionId: exId, userId: 1 } });
    expect(app?.status).toBe('ACCEPTED');
    expect(app?.biography, '약력은 포트폴리오에서 가져온다').toBe('내 약력');
    expect(JSON.parse(app!.artworkImages as string)).toHaveLength(1);
  });

  it('수락하면 초대가 APPLIED 가 되고 단톡에 합류한다', async () => {
    const inv = await invite(1);
    await accept(inv.id);
    expect((await testPrisma.exhibitionInvite.findUnique({ where: { id: inv.id } }))?.status).toBe('APPLIED');
    const chat = await testPrisma.chat.findUnique({ where: { exhibitionId: exId }, include: { participants: true } });
    expect(chat?.participants.map(p => p.userId).sort()).toEqual([1, 3]);
  });

  it('★ 정원이 찼으면 초대가 있어도 못 들어간다', async () => {
    await testPrisma.application.create({ data: { userId: 2, exhibitionId: exId, status: 'ACCEPTED' } });
    const inv = await invite(1);
    const r = await accept(inv.id);
    expect(r.status).toBe(400);
    expect(await testPrisma.application.count({ where: { userId: 1 } })).toBe(0);
  });

  it('마감된 공모의 초대는 수락할 수 없다', async () => {
    await testPrisma.exhibition.update({ where: { id: exId }, data: { recruitmentClosed: true } });
    const inv = await invite(1);
    expect((await accept(inv.id)).status).toBe(400);
  });

  it('이미 참여 중이면 중복으로 못 들어간다', async () => {
    const inv = await invite(1);
    expect((await accept(inv.id)).status).toBe(201);
    const again = await accept(inv.id);
    expect(again.status).toBe(400);
    expect(await testPrisma.application.count({ where: { exhibitionId: exId, userId: 1 } })).toBe(1);
  });

  it('★ 남의 초대는 수락할 수 없다', async () => {
    const inv = await invite(1);
    expect((await accept(inv.id, a2)).status).toBe(404);
  });

  it('포트폴리오에 작품이 없으면 막고 이유를 알려준다', async () => {
    await testPrisma.portfolioImage.deleteMany({});
    const inv = await invite(1);
    const r = await accept(inv.id);
    expect(r.status).toBe(400);
    expect(r.body.error).toContain('작품');
  });
});
