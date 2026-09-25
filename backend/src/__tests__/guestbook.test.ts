/**
 * 방명록 — `routes/guestbook.ts`
 *
 * 지켜야 하는 것:
 *  ① 읽기는 공개, 쓰기는 로그인 / 새 글은 방 주인에게 알림
 *  ② 답글은 **방 주인만** (남이 남의 방명록에 답글 못 단다)
 *  ③ **새 글에는 비밀글이 없다**(2026-09-16 사용자 결정) — `secret` 을 보내도 조용히 무시한다.
 *     다만 **예전에 남긴 비밀글은 계속 가려야 한다**: 쓴 사람은 안 보이는 줄 알고 남겼으므로,
 *     기능을 없앴다고 그 약속을 깨면 안 된다. 그래서 읽기 쪽(`locked`)은 그대로다.
 *  ④ 삭제는 글쓴이 · 방 주인 · Admin
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { request, testPrisma, authToken, cleanDb, seedUsers } from './helpers';

const a1 = authToken(1, 'ARTIST');   // 방 주인 후보
const a2 = authToken(2, 'ARTIST');
const gallery = authToken(3, 'GALLERY');
const admin = authToken(4, 'ADMIN');

const write = (tok: string, target: number, body: any = {}) =>
  request.post(`/api/guestbook/${target}`).set('Authorization', `Bearer ${tok}`).send({ body: '안녕하세요!', ...body });

describe('방명록', () => {
  beforeEach(async () => { await cleanDb(); await seedUsers(); });

  it('읽기는 공개, 쓰기는 로그인', async () => {
    expect((await request.get('/api/guestbook/1')).status).toBe(200);
    expect((await request.post('/api/guestbook/1').send({ body: 'x' })).status).toBe(401);
  });

  it('내용이 비면 400', async () => {
    expect((await write(a2, 1, { body: '   ' })).status).toBe(400);
  });

  it('★ 남기면 방 주인에게 알림 1건', async () => {
    const r = await write(a2, 1, { body: '작품 잘 봤어요' });
    expect(r.status).toBe(201);
    expect(r.body.author.id).toBe(2);
    const notis = await testPrisma.notification.findMany({ where: { userId: 1, type: 'GUESTBOOK_NEW' } });
    expect(notis.length).toBe(1);
    // 방명록은 작가 홈페이지의 탭이다(2026-09-25) — 쿼리 없이 보내면 [작품] 탭이 열려 글이 안 보인다
    expect(notis[0].linkUrl).toBe('/portfolio/1?tab=guestbook');
    // 목록에 뜬다
    const list = await request.get('/api/guestbook/1');
    expect(list.body.entries.map((e: any) => e.body)).toContain('작품 잘 봤어요');
  });

  it('자기 방에 자기가 쓰면 알림 없음', async () => {
    await write(a1, 1, { body: '내 방 첫 글' });
    expect(await testPrisma.notification.count({ where: { userId: 1, type: 'GUESTBOOK_NEW' } })).toBe(0);
  });

  it('★ 답글은 방 주인만 단다', async () => {
    const { body: entry } = await write(a2, 1, { body: '문의드려요' });
    // 남(gallery)이 답글 시도 → 403
    expect((await write(gallery, 1, { body: '제가 답할게요', parentId: entry.id })).status).toBe(403);
    // 방 주인(a1)이 답글 → 201, 원 글쓴이(2)에게 알림
    const reply = await write(a1, 1, { body: '감사합니다!', parentId: entry.id });
    expect(reply.status).toBe(201);
    expect(await testPrisma.notification.count({ where: { userId: 2, type: 'GUESTBOOK_REPLY' } })).toBe(1);
    // 목록에서 답글이 원 글 아래에 붙는다
    const list = await request.get('/api/guestbook/1');
    const top = list.body.entries.find((e: any) => e.id === entry.id);
    expect(top.replies.map((r: any) => r.body)).toEqual(['감사합니다!']);
  });

  it('답글에 답글은 못 단다 (1단계)', async () => {
    const { body: entry } = await write(a2, 1, { body: '글' });
    const { body: reply } = await write(a1, 1, { body: '답글', parentId: entry.id });
    expect((await write(a1, 1, { body: '답답글', parentId: reply.id })).status).toBe(404);
  });

  it('★ 새 글은 비밀글이 될 수 없다 — secret 을 보내도 무시한다', async () => {
    // 400 으로 막지 않는다. 옛 화면·북마크가 그 필드를 달고 올 수 있고, 막으면 글 자체를 못 남긴다.
    const r = await write(a2, 1, { body: '공개 글', secret: true });
    expect(r.status).toBe(201);
    const saved = await testPrisma.guestbookEntry.findUnique({ where: { id: r.body.id } });
    expect(saved!.secret).toBe(false);
    expect(r.body.locked).toBe(false);
  });

  it('★ 예전에 남긴 비밀글은 그대로 가린다 — 방 주인·작성자만 본문을 본다', async () => {
    // 쓰기 경로가 더는 secret 을 만들지 않으므로 **옛 데이터를 흉내 내** DB 에 직접 넣는다.
    const entry = await testPrisma.guestbookEntry.create({
      data: { targetUserId: 1, authorId: 2, body: '둘만 아는 이야기', secret: true },
    });
    // 남(gallery)이 보면 본문 가림 + locked, 신원은 보임
    const asOther = await request.get('/api/guestbook/1').set('Authorization', `Bearer ${gallery}`);
    const seenByOther = asOther.body.entries.find((e: any) => e.id === entry.id);
    expect(seenByOther.locked).toBe(true);
    expect(seenByOther.body).toBe('');
    expect(seenByOther.author.id).toBe(2);
    // 비로그인도 가림
    const anon = await request.get('/api/guestbook/1');
    expect(anon.body.entries.find((e: any) => e.id === entry.id).body).toBe('');
    // 방 주인(a1)은 본문 보임
    const asOwner = await request.get('/api/guestbook/1').set('Authorization', `Bearer ${a1}`);
    expect(asOwner.body.entries.find((e: any) => e.id === entry.id).body).toBe('둘만 아는 이야기');
    // 작성자(a2)도 보임
    const asAuthor = await request.get('/api/guestbook/1').set('Authorization', `Bearer ${a2}`);
    expect(asAuthor.body.entries.find((e: any) => e.id === entry.id).body).toBe('둘만 아는 이야기');
  });

  it('★ 삭제는 글쓴이 · 방 주인 · Admin', async () => {
    // 글쓴이 삭제
    let { body: e } = await write(a2, 1, { body: '지울글1' });
    expect((await request.delete(`/api/guestbook/1/${e.id}`).set('Authorization', `Bearer ${gallery}`)).status).toBe(403);
    expect((await request.delete(`/api/guestbook/1/${e.id}`).set('Authorization', `Bearer ${a2}`)).status).toBe(200);
    // 방 주인 삭제
    ({ body: e } = await write(a2, 1, { body: '지울글2' }));
    expect((await request.delete(`/api/guestbook/1/${e.id}`).set('Authorization', `Bearer ${a1}`)).status).toBe(200);
    // Admin 삭제
    ({ body: e } = await write(a2, 1, { body: '지울글3' }));
    expect((await request.delete(`/api/guestbook/1/${e.id}`).set('Authorization', `Bearer ${admin}`)).status).toBe(200);
    expect(await testPrisma.guestbookEntry.count()).toBe(0);
  });

  it('원 글 삭제 시 답글도 함께 삭제된다 (Cascade)', async () => {
    const { body: entry } = await write(a2, 1, { body: '원글' });
    await write(a1, 1, { body: '답글', parentId: entry.id });
    await request.delete(`/api/guestbook/1/${entry.id}`).set('Authorization', `Bearer ${a1}`);
    expect(await testPrisma.guestbookEntry.count()).toBe(0);
  });
});
