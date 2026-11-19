/**
 * ArtTalk 개편(2026-11-19) — 빈 방 · 탈퇴 상대 · 차단 · 숨기기 · 신고 · 맥락 카드 · 보내기 한도 · 알림 한 줄.
 * 계획: scratchpad/arttalk-renewal/PLAN.md(B6~B9 · WP5 · WP6). 기존 규칙(남의 방 404 · 증분 폴링 · 읽음)은 chat.test.ts.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { request, testPrisma, authToken, cleanDb, seedUsers, seedGallery, seedExhibition } from './helpers';
import { setChatLimitsForTest, CHAT_SEND_PER_MIN, DIRECT_CHATS_PER_DAY } from '../lib/chatSafety';
import { ensureExhibitionChat } from '../lib/chat';

const a1 = authToken(1, 'ARTIST');
const a2 = authToken(2, 'ARTIST');
const owner = authToken(3, 'GALLERY');
const admin = authToken(4, 'ADMIN');
const auth = (tok: string) => ({ Authorization: `Bearer ${tok}` });

const openDirect = (tok: string, userId: number) => request.post('/api/chats/direct').set(auth(tok)).send({ userId });
const send = (tok: string, chatId: number, body: Record<string, unknown>) =>
  request.post(`/api/chats/${chatId}/messages`).set(auth(tok)).send(body);
const list = async (tok: string) => (await request.get('/api/chats').set(auth(tok))).body as any[];
const unread = async (tok: string) => (await request.get('/api/chats/unread-count').set(auth(tok))).body.count as number;

beforeEach(async () => { await cleanDb(); await seedUsers(); });
afterEach(() => setChatLimitsForTest(null));

describe('빈 1:1 방은 목록에 없다 (B6)', () => {
  it('★ 방만 열고 아무것도 안 보냈으면 양쪽 목록에 없다 → 첫 메시지 뒤에 양쪽에 나온다', async () => {
    const { body: { id } } = await openDirect(a1, 2);
    expect(await list(a1)).toEqual([]);
    expect(await list(a2), '받는 쪽에 빈 방이 뜨면 안 된다').toEqual([]);
    expect((await request.get(`/api/chats/${id}`).set(auth(a1))).status, '방 자체는 열린다(보낼 수 있어야 한다)').toBe(200);

    expect((await send(a1, id, { content: '안녕하세요' })).status).toBe(201);
    expect((await list(a1)).map((c) => c.id)).toEqual([id]);
    expect((await list(a2)).map((c) => c.id)).toEqual([id]);
  });

  it('단톡은 메시지가 없어도 운영자에게는 보인다(첫 말을 보낼 곳) — 작가에게는 운영자가 연 뒤에(아래 「단톡은 운영자가 연다」)', async () => {
    const g = await seedGallery(3);
    const ex = await seedExhibition(g.id);
    await testPrisma.application.create({ data: { userId: 1, exhibitionId: ex.id, status: 'ACCEPTED', biography: 'b', artworkImages: '[]' } });
    const chatId = await ensureExhibitionChat(ex.id);
    expect((await list(owner)).map((c) => c.id)).toEqual([chatId]);
    expect(await list(a1)).toEqual([]);
  });

  it('목록에 보낸 사람 이름(단톡 미리보기)·공모 포스터·탈퇴 여부가 실린다', async () => {
    const g = await seedGallery(3);
    const ex = await seedExhibition(g.id);
    await testPrisma.exhibition.update({ where: { id: ex.id }, data: { imageUrl: '/uploads/poster.jpg' } });
    await testPrisma.application.create({ data: { userId: 1, exhibitionId: ex.id, status: 'ACCEPTED', biography: 'b', artworkImages: '[]' } });
    const chatId = (await ensureExhibitionChat(ex.id))!;
    await send(owner, chatId, { content: '반입 안내입니다' });
    const room = (await list(a1)).find((c) => c.id === chatId);
    expect(room.cover).toBe('/uploads/poster.jpg');
    expect(room.lastMessage).toMatchObject({ content: '반입 안내입니다', senderId: 3, senderName: 'Gallery Owner' });
    expect(room.participants.every((p: any) => p.deleted === false)).toBe(true);
    expect(room.participants[0]).not.toHaveProperty('deletedAt');
  });
});

describe('탈퇴한 상대 (B7)', () => {
  it('★ 탈퇴한 상대에게는 보낼 수 없고(400), 방을 열면 blockReason=deleted', async () => {
    const { body: { id } } = await openDirect(a1, 2);
    await send(a1, id, { content: '전에 보낸 말' });
    await testPrisma.user.update({ where: { id: 2 }, data: { deletedAt: new Date(), name: '탈퇴한 회원' } });
    const r = await send(a1, id, { content: '안 갈 말' });
    expect(r.status).toBe(400);
    expect(await testPrisma.chatMessage.count({ where: { chatId: id } }), '저장되지 않는다').toBe(1);
    const room = await request.get(`/api/chats/${id}`).set(auth(a1));
    expect(room.body).toMatchObject({ canSend: false, blockReason: 'deleted' });
    expect(room.body.counterpart).toMatchObject({ id: 2, deleted: true, homepage: null });
  });
});

describe('차단 (WP6)', () => {
  const block = (tok: string, userId: number) => request.post('/api/blocks').set(auth(tok)).send({ userId });
  const unblock = (tok: string, userId: number) => request.delete(`/api/blocks/${userId}`).set(auth(tok));

  it('★ 차단하면 양쪽 다 못 보낸다 · 새로 열지도 못한다 · 누가 막았는지 말하지 않는다', async () => {
    const { body: { id } } = await openDirect(a1, 2);
    await send(a2, id, { content: '안녕하세요' });
    expect((await block(a1, 2)).body).toEqual({ blocked: true });

    const mine = await send(a1, id, { content: 'x' });
    expect(mine.status).toBe(403);
    const theirs = await send(a2, id, { content: 'y' });
    expect(theirs.status).toBe(403);
    expect(theirs.body.error).toBe('메시지를 보낼 수 없는 상대예요.');
    expect((await openDirect(a2, 1)).status).toBe(403);
    expect((await openDirect(a1, 2)).status).toBe(403);

    expect((await request.get(`/api/chats/${id}`).set(auth(a1))).body).toMatchObject({ canSend: false, blockReason: 'blocked' });
    expect((await request.get(`/api/chats/${id}`).set(auth(a2))).body).toMatchObject({ canSend: false, blockReason: 'unavailable' });
  });

  it('★ 막은 사람의 목록·배지에서 그 방이 빠지고, 풀면 돌아온다', async () => {
    const { body: { id } } = await openDirect(a2, 1);
    await send(a2, id, { content: '읽어 주세요' });
    expect(await unread(a1)).toBe(1);
    await block(a1, 2);
    expect(await list(a1)).toEqual([]);
    expect(await unread(a1), '열 수 없는 배지가 남으면 안 된다').toBe(0);
    expect((await list(a2)).map((c) => c.id), '막힌 사람 목록엔 그대로(아무 일 없던 것처럼)').toEqual([id]);

    expect((await unblock(a1, 2)).body).toEqual({ blocked: false });
    expect((await list(a1)).map((c) => c.id)).toEqual([id]);
    expect((await send(a1, id, { content: '다시 됩니다' })).status).toBe(201);
  });

  it('두 번 눌러도 한 줄 · 동시에 눌러도 한 줄 · 나 자신은 400 · 없는 회원 404 · 목록', async () => {
    await Promise.all([block(a1, 2), block(a1, 2), block(a1, 2)]);
    expect(await testPrisma.userBlock.count()).toBe(1);
    expect((await block(a1, 1)).status).toBe(400);
    expect((await block(a1, 9999)).status).toBe(404);
    const mine = await request.get('/api/blocks').set(auth(a1));
    expect(mine.body).toEqual([expect.objectContaining({ id: 2, name: 'Artist 2', role: 'ARTIST', deleted: false })]);
    expect((await request.get('/api/blocks').set(auth(a2))).body).toEqual([]);
    expect((await request.post('/api/blocks').send({ userId: 2 })).status).toBe(401);
  });

  it('단체방(공모방)에는 걸지 않는다 — 운영 공지를 못 받게 되면 안 된다', async () => {
    const g = await seedGallery(3);
    const ex = await seedExhibition(g.id);
    await testPrisma.application.create({ data: { userId: 1, exhibitionId: ex.id, status: 'ACCEPTED', biography: 'b', artworkImages: '[]' } });
    const chatId = (await ensureExhibitionChat(ex.id))!;
    await block(a1, 3);
    expect((await send(owner, chatId, { content: '공지입니다' })).status).toBe(201);
    expect((await send(a1, chatId, { content: '확인했어요' })).status).toBe(201);
    expect((await list(a1)).map((c) => c.id)).toEqual([chatId]);
  });

  it('탈퇴하면 그 사람의 차단 기록이 양쪽 다 지워진다', async () => {
    await block(a1, 2);
    await block(a2, 1);
    await testPrisma.user.update({ where: { id: 2 }, data: { provider: 'KAKAO', providerId: 'k2', password: null } });
    const r = await request.delete('/api/auth/me').set(auth(a2)).send({ confirmText: '탈퇴', acknowledge: true });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(await testPrisma.userBlock.count()).toBe(0);
  });
});

describe('목록에서 숨기기', () => {
  const hide = (tok: string, id: number, hidden: boolean) => request.patch(`/api/chats/${id}/hidden`).set(auth(tok)).send({ hidden });

  it('★ 숨기면 내 목록에서 빠지고 읽은 것으로 친다 · 새 메시지가 오면 다시 나온다 · 상대는 그대로', async () => {
    const { body: { id } } = await openDirect(a2, 1);
    await send(a2, id, { content: '첫 말' });
    expect(await unread(a1)).toBe(1);
    expect((await hide(a1, id, true)).body).toEqual({ hidden: true });
    expect(await list(a1)).toEqual([]);
    expect(await unread(a1), '숨긴 방의 안 읽은 수가 배지에 남으면 안 된다').toBe(0);
    expect((await list(a2)).map((c) => c.id)).toEqual([id]);
    expect((await request.get(`/api/chats/${id}`).set(auth(a1))).body.hidden).toBe(true);

    await new Promise((r) => setTimeout(r, 5));
    await send(a2, id, { content: '새 말' });
    expect((await list(a1)).map((c) => c.id), '새 메시지가 오면 저절로 다시 나온다').toEqual([id]);
    expect(await unread(a1)).toBe(1);
  });

  it('다시 보이기 · 남의 방은 404', async () => {
    const { body: { id } } = await openDirect(a1, 2);
    await send(a1, id, { content: 'hi' });
    await hide(a1, id, true);
    await hide(a1, id, false);
    expect((await list(a1)).map((c) => c.id)).toEqual([id]);
    expect((await hide(owner, id, true)).status).toBe(404);
  });
});

describe('맥락 카드 (ref) — 서버가 만든다', () => {
  async function work(userId: number, data: Record<string, unknown> = {}) {
    const pf = await testPrisma.portfolio.upsert({ where: { userId }, create: { userId }, update: {} });
    return testPrisma.portfolioImage.create({ data: { portfolioId: pf.id, url: `/uploads/w-${userId}-${Date.now()}.jpg`, ...data } });
  }

  it('★ 상대의 작품으로 문의하면 서버가 제목·부제·그림·링크를 찍는다(화면이 보낸 제목·링크는 무시)', async () => {
    const w = await work(2, { title: '푸른 벽', year: '2026년', medium: '캔버스에 유채', sizeText: '91 × 73 cm' });
    const { body: { id } } = await openDirect(a1, 2);
    const r = await send(a1, id, { content: '구매 문의드립니다', ref: { type: 'WORK', id: w.id, title: '가짜 제목', link: 'https://evil.example' } });
    expect(r.status).toBe(201);
    expect(r.body.ref).toEqual({
      type: 'WORK', id: w.id, title: '푸른 벽, 2026', sub: '캔버스에 유채 · 91 × 73 cm', image: w.url, link: `/portfolio/2?work=${w.id}`,
    });
    const room = await request.get(`/api/chats/${id}`).set(auth(a2));
    expect(room.body.context).toMatchObject({ type: 'WORK', id: w.id, messageId: r.body.id });
    expect(room.body.messages[0].ref.title).toBe('푸른 벽, 2026');
  });

  it('글 없이 카드만 보내도 된다 — 목록·알림 미리보기는 [작품 문의] · 제목 없는 작품도 카드가 된다', async () => {
    const w = await work(2);
    const { body: { id } } = await openDirect(a1, 2);
    expect((await send(a1, id, { ref: { type: 'WORK', id: w.id } })).body.ref.title).toBe('제목 없는 작품');
    expect((await list(a2))[0].lastMessage.content).toBe('[작품 문의]');
    const n = await testPrisma.notification.findFirst({ where: { userId: 2, type: 'CHAT_MESSAGE' } });
    expect(n?.message).toContain('[작품 문의]');
  });

  it('★ 이 방 사람이 아닌 작가의 작품은 붙일 수 없다 · 승인 안 된 공모·갤러리도 400', async () => {
    const someoneElse = await work(4);
    const { body: { id } } = await openDirect(a1, 2);
    expect((await send(a1, id, { content: 'x', ref: { type: 'WORK', id: someoneElse.id } })).status).toBe(400);
    const g = await seedGallery(3);
    const ex = await seedExhibition(g.id);
    await testPrisma.exhibition.update({ where: { id: ex.id }, data: { status: 'PENDING' } });
    expect((await send(a1, id, { content: 'x', ref: { type: 'EXHIBITION', id: ex.id } })).status).toBe(400);
    await testPrisma.gallery.update({ where: { id: g.id }, data: { status: 'PENDING' } });
    expect((await send(a1, id, { content: 'x', ref: { type: 'GALLERY', id: g.id } })).status).toBe(400);
    expect((await send(a1, id, { content: 'x', ref: { type: 'NOPE', id: 1 } })).status).toBe(400);
    expect(await testPrisma.chatMessage.count()).toBe(0);
  });

  it('공모·갤러리 카드 — 공개된 것만, 링크는 우리 사이트 경로', async () => {
    const g = await seedGallery(3);
    const ex = await seedExhibition(g.id);
    const { body: { id } } = await openDirect(a1, 3);
    const e = await send(a1, id, { content: '공모 문의', ref: { type: 'EXHIBITION', id: ex.id } });
    expect(e.body.ref).toMatchObject({ type: 'EXHIBITION', title: 'Test Exhibition', link: `/exhibitions/${ex.id}` });
    expect(e.body.ref.sub).toMatch(/^Test Gallery · \d+\.\d+ 마감$/);
    const gg = await send(a1, id, { content: '갤러리 문의', ref: { type: 'GALLERY', id: g.id } });
    expect(gg.body.ref).toMatchObject({ type: 'GALLERY', title: 'Test Gallery', sub: '서울', link: `/galleries/${g.id}` });
    expect((await request.get(`/api/chats/${id}`).set(auth(a1))).body.context.type, '고정 카드는 가장 최근 것').toBe('GALLERY');
  });
});

describe('방 머리 — 상대 홈페이지 · 단톡 운영자 (방을 열 때만)', () => {
  it('작가는 핸들 주소, 갤러리 주인은 승인된 첫 갤러리 · 폴링 응답엔 머리를 싣지 않는다', async () => {
    await testPrisma.user.update({ where: { id: 2 }, data: { handle: 'artist.two' } });
    const { body: { id } } = await openDirect(a1, 2);
    await send(a1, id, { content: 'hi' });
    const room = await request.get(`/api/chats/${id}`).set(auth(a1));
    expect(room.body.counterpart).toMatchObject({ id: 2, role: 'ARTIST', homepage: '/@artist.two', deleted: false });
    expect(room.body.canSend).toBe(true);
    const poll = await request.get(`/api/chats/${id}?after=${room.body.messages[0].id}`).set(auth(a1));
    expect(poll.body).not.toHaveProperty('counterpart');
    expect(poll.body).not.toHaveProperty('context');

    const g = await seedGallery(3);
    const { body: { id: gid } } = await openDirect(a1, 3);
    await send(a1, gid, { content: 'hi' });
    expect((await request.get(`/api/chats/${gid}`).set(auth(a1))).body.counterpart)
      .toMatchObject({ role: 'GALLERY', homepage: `/galleries/${g.id}`, galleryName: 'Test Gallery' });
  });

  it('단톡은 운영자 id(주최 표시)를 싣고, 공모의 운영 정보는 싣지 않는다', async () => {
    const g = await seedGallery(3);
    const ex = await seedExhibition(g.id);
    await testPrisma.application.create({ data: { userId: 1, exhibitionId: ex.id, status: 'ACCEPTED', biography: 'b', artworkImages: '[]' } });
    const chatId = (await ensureExhibitionChat(ex.id))!;
    await send(owner, chatId, { content: '반가워요' });   // 운영자가 열어야 작가가 들어온다
    const room = await request.get(`/api/chats/${chatId}`).set(auth(a1));
    expect(room.body.operatorIds).toEqual([3]);
    expect(room.body.exhibition).toEqual({ id: ex.id, title: 'Test Exhibition', imageUrl: null });
  });
});

describe('보내기 한도 · 새 방 한도 (B8)', () => {
  it(`★ 1분에 ${CHAT_SEND_PER_MIN}개 — 넘으면 429 이고 저장되지 않는다(운영 계정은 세지 않는다)`, async () => {
    setChatLimitsForTest(true);
    const { body: { id } } = await openDirect(a1, 2);
    for (let i = 0; i < CHAT_SEND_PER_MIN; i++) expect((await send(a1, id, { content: `m${i}` })).status).toBe(201);
    const over = await send(a1, id, { content: '넘침' });
    expect(over.status).toBe(429);
    expect(await testPrisma.chatMessage.count({ where: { chatId: id } })).toBe(CHAT_SEND_PER_MIN);
    expect((await send(a2, id, { content: '상대는 따로 센다' })).status).toBe(201);
  });

  it('빈 글·이상한 첨부로 400 이 난 시도는 한도를 먹지 않는다', async () => {
    setChatLimitsForTest(true);
    const { body: { id } } = await openDirect(a1, 2);
    for (let i = 0; i < CHAT_SEND_PER_MIN; i++) await send(a1, id, { content: 'x', attachmentType: 'IMAGE', attachmentUrl: 'https://evil.example/a.jpg' });
    expect((await send(a1, id, { content: '정상' })).status).toBe(201);
  });

  it(`★ 새 1:1 방은 하루 ${DIRECT_CHATS_PER_DAY}개 — 동시에 몰아도 넘지 않는다 · 있는 방을 다시 여는 건 세지 않는다`, async () => {
    setChatLimitsForTest(true);
    const extra = Array.from({ length: DIRECT_CHATS_PER_DAY + 5 }, (_, i) => ({ id: 100 + i, email: `x${i}@test.com`, name: `X${i}`, role: 'ARTIST' }));
    await testPrisma.user.createMany({ data: extra });
    const results = await Promise.all(extra.map((u) => openDirect(a1, u.id)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(DIRECT_CHATS_PER_DAY);
    expect(results.filter((r) => r.status === 429)).toHaveLength(5);
    expect(await testPrisma.chat.count({ where: { kind: 'DIRECT' } })).toBe(DIRECT_CHATS_PER_DAY);
    const again = results.find((r) => r.status === 200)!;
    const reopenTarget = extra[results.indexOf(again)].id;
    expect((await openDirect(a1, reopenTarget)).body.id).toBe(again.body.id);
  });
});

describe('새 메시지 알림은 방마다 한 줄 (B9)', () => {
  it('★ 같은 방에 동시에 여러 개가 와도 받는 사람의 안 읽은 알림은 한 줄', async () => {
    const { body: { id } } = await openDirect(a1, 2);
    await Promise.all(Array.from({ length: 6 }, (_, i) => send(a1, id, { content: `동시 ${i}` })));
    expect(await testPrisma.notification.count({ where: { userId: 2, type: 'CHAT_MESSAGE', read: false } })).toBe(1);
  });
});

describe('신고 (WP6 · 규칙 33)', () => {
  const report = (tok: string, chatId: number, body: Record<string, unknown>) =>
    request.post(`/api/chats/${chatId}/report`).set(auth(tok)).send(body);

  it('★ 메시지를 신고하면 그 메시지와 앞뒤 몇 줄이 사본으로 남고 관리자에게 알림이 간다', async () => {
    const { body: { id } } = await openDirect(a1, 2);
    const ids: number[] = [];
    for (let i = 0; i < 12; i++) ids.push((await send(i % 2 ? a1 : a2, id, { content: `줄 ${i}` })).body.id);
    const target = ids[6];   // a2 가 보낸 줄
    const r = await report(a1, id, { messageId: target, reason: 'ABUSE', detail: '욕설이에요' });
    expect(r.status).toBe(201);
    const row = await testPrisma.chatReport.findUniqueOrThrow({ where: { id: r.body.id } });
    expect(row).toMatchObject({ reporterId: 1, targetUserId: 2, messageId: target, reason: 'ABUSE', detail: '욕설이에요', status: 'OPEN' });
    const lines = (row.snapshot as any).lines as any[];
    expect(lines.map((l) => l.content)).toEqual(['줄 2', '줄 3', '줄 4', '줄 5', '줄 6', '줄 7', '줄 8', '줄 9', '줄 10']);
    expect(lines.find((l) => l.target).id).toBe(target);
    const notes = await testPrisma.notification.findMany({ where: { type: 'CHAT_REPORT' } });
    expect(notes.map((n) => n.userId)).toEqual([4]);
    expect(notes[0].linkUrl).toBe('/mypage?tab=report-manage');
  });

  it('내 말은 신고 못 한다 · 같은 것을 두 번은 409 · 남의 방 404 · 이상한 사유 400', async () => {
    const { body: { id } } = await openDirect(a1, 2);
    const mine = (await send(a1, id, { content: '내 말' })).body.id;
    const theirs = (await send(a2, id, { content: '상대 말' })).body.id;
    expect((await report(a1, id, { messageId: mine, reason: 'SPAM' })).status).toBe(400);
    expect((await report(a1, id, { messageId: theirs, reason: 'SPAM' })).status).toBe(201);
    expect((await report(a1, id, { messageId: theirs, reason: 'SCAM' })).status).toBe(409);
    expect((await report(owner, id, { messageId: theirs, reason: 'SPAM' })).status).toBe(404);
    expect((await report(a2, id, { messageId: mine, reason: 'WHATEVER' })).status).toBe(400);
  });

  it('1:1 방은 사람을 신고할 수 있다(최근 대화가 사본) · 단톡은 메시지로만', async () => {
    const { body: { id } } = await openDirect(a1, 2);
    await send(a2, id, { content: '광고입니다' });
    const r = await report(a1, id, { reason: 'SPAM' });
    expect(r.status).toBe(201);
    expect(await testPrisma.chatReport.findUniqueOrThrow({ where: { id: r.body.id } })).toMatchObject({ targetUserId: 2, messageId: 0 });

    const g = await seedGallery(3);
    const ex = await seedExhibition(g.id);
    await testPrisma.application.create({ data: { userId: 1, exhibitionId: ex.id, status: 'ACCEPTED', biography: 'b', artworkImages: '[]' } });
    const chatId = (await ensureExhibitionChat(ex.id))!;
    await send(owner, chatId, { content: '공지입니다' });
    expect((await report(a1, chatId, { reason: 'SPAM' })).status).toBe(400);
  });

  it('관리자만 목록·처리 — 처리하면 확인할 것에서 빠진다', async () => {
    const { body: { id } } = await openDirect(a1, 2);
    const theirs = (await send(a2, id, { content: '이상한 말' })).body.id;
    const { body: { id: rid } } = await report(a1, id, { messageId: theirs, reason: 'ABUSE' });
    expect((await request.get('/api/chat-reports').set(auth(a1))).status).toBe(403);
    const open = await request.get('/api/chat-reports?status=OPEN').set(auth(admin));
    expect(open.body).toHaveLength(1);
    expect(open.body[0]).toMatchObject({ id: rid, reason: 'ABUSE', target: { id: 2, openReports: 1 }, reporter: { id: 1 } });
    expect(open.body[0].snapshot.lines.some((l: any) => l.content === '이상한 말')).toBe(true);
    expect((await request.patch(`/api/chat-reports/${rid}`).set(auth(admin)).send({ status: 'DISMISSED', adminNote: '문제없음' })).status).toBe(200);
    expect((await request.get('/api/chat-reports?status=OPEN').set(auth(admin))).body).toHaveLength(0);
    expect((await request.patch('/api/chat-reports/99999').set(auth(admin)).send({ status: 'DONE' })).status).toBe(404);
  });
});

describe('단톡은 운영자가 연다 — 첫 메시지 전엔 작가에게 안 보인다 (2026-11-19, 카카오톡 단체방처럼)', () => {
  const setup = async () => {
    const g = await seedGallery(3);
    const ex = await seedExhibition(g.id);
    await testPrisma.application.create({ data: { userId: 1, exhibitionId: ex.id, status: 'ACCEPTED', biography: 'b', artworkImages: '[]' } });
    return { ex, chatId: (await ensureExhibitionChat(ex.id))! };
  };

  it('★ 승인·수락으로 방이 생기고 작가가 들어가도 — 작가의 목록·주소·보내기·알림 끄기·신고·읽음 모두 없는 방(404)', async () => {
    const { chatId } = await setup();
    expect(await list(a1)).toEqual([]);
    expect(await unread(a1)).toBe(0);
    expect((await request.get(`/api/chats/${chatId}`).set(auth(a1))).status).toBe(404);
    expect((await send(a1, chatId, { content: '먼저 말해 본다' })).status, '작가가 먼저 열 수는 없다').toBe(404);
    expect((await request.patch(`/api/chats/${chatId}/mute`).set(auth(a1)).send({ muted: true })).status).toBe(404);
    expect((await request.patch(`/api/chats/${chatId}/hidden`).set(auth(a1)).send({ hidden: true })).status).toBe(404);
    expect((await request.post(`/api/chats/${chatId}/read`).set(auth(a1))).status).toBe(404);
    expect((await request.post(`/api/chats/${chatId}/report`).set(auth(a1)).send({ reason: 'SPAM' })).status).toBe(404);
    expect(await testPrisma.chatMessage.count({ where: { chatId } })).toBe(0);
    // 운영자는 처음부터 — 아직 안 열렸다는 표시와 함께
    const room = await request.get(`/api/chats/${chatId}`).set(auth(owner));
    expect(room.status).toBe(200);
    expect(room.body.opened).toBe(false);
  });

  it('★ 운영자의 첫 메시지로 열린다 — 작가 목록에 그 말과 함께 · 알림 한 줄 · 그 뒤로는 작가도 말한다', async () => {
    const { chatId } = await setup();
    expect((await send(owner, chatId, { content: '선정 축하드려요. 반입 일정 안내드릴게요.' })).status).toBe(201);
    expect((await testPrisma.chat.findUniqueOrThrow({ where: { id: chatId } })).openedAt).not.toBeNull();
    const room = (await list(a1)).find((c) => c.id === chatId);
    expect(room?.lastMessage?.content).toBe('선정 축하드려요. 반입 일정 안내드릴게요.');
    expect(room?.unread).toBe(1);
    expect(await testPrisma.notification.count({ where: { userId: 1, type: 'CHAT_MESSAGE', refKey: `chat:${chatId}`, read: false } })).toBe(1);
    const detail = await request.get(`/api/chats/${chatId}`).set(auth(a1));
    expect(detail.status).toBe(200);
    expect(detail.body.opened).toBe(true);
    expect((await send(a1, chatId, { content: '감사합니다!' })).status).toBe(201);
  });

  it('열린 뒤에 수락된 작가는 들어오자마자 보인다(지난 말까지)', async () => {
    const { ex, chatId } = await setup();
    await send(owner, chatId, { content: '첫 공지' });
    await testPrisma.application.create({ data: { userId: 2, exhibitionId: ex.id, status: 'ACCEPTED', biography: 'b', artworkImages: '[]' } });
    await ensureExhibitionChat(ex.id);
    expect((await list(a2)).map((c) => c.id)).toEqual([chatId]);
    const detail = await request.get(`/api/chats/${chatId}`).set(auth(a2));
    expect(detail.body.messages.map((m: any) => m.content)).toEqual(['첫 공지']);
  });

  it('아트링크 주최(운영 갤러리 없음)는 관리자가 연다 · 갠톡은 이 규칙과 무관(빈 방 규칙만)', async () => {
    const ex = await testPrisma.exhibition.create({
      data: {
        title: '아트링크 주최', type: 'GROUP', hostType: 'ADMIN', galleryId: null, status: 'APPROVED', capacity: 5, region: 'SEOUL',
        description: '갤러리 없는 공모', deadline: new Date(Date.now() + 30 * 864e5), exhibitDate: new Date(Date.now() + 60 * 864e5),
      },
    });
    await testPrisma.application.create({ data: { userId: 1, exhibitionId: ex.id, status: 'ACCEPTED', biography: 'b', artworkImages: '[]' } });
    const chatId = (await ensureExhibitionChat(ex.id))!;
    expect(await list(a1)).toEqual([]);
    expect((await list(admin)).map((c) => c.id)).toEqual([chatId]);
    expect((await send(admin, chatId, { content: '아트링크입니다' })).status).toBe(201);
    expect((await list(a1)).map((c) => c.id)).toEqual([chatId]);

    const { body: { id } } = await openDirect(a1, 2);
    expect((await send(a1, id, { content: '안녕하세요' })).status).toBe(201);
    expect((await request.get(`/api/chats/${id}`).set(auth(a2))).body.opened).toBe(true);
  });
});
