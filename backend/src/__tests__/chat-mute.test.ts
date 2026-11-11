/**
 * 대화방 알림 끄기 (2026-11-11, CLAUDE.md 규칙 79) — 카카오톡 '알림 끄기'처럼:
 * 끄면 새 메시지가 벨 알림·앱 푸시로 오지 않고, 대화 목록의 안 읽은 수는 그대로 센다.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { request, testPrisma, authToken, cleanDb, seedUsers } from './helpers';

const a1 = authToken(1, 'ARTIST');
const a2 = authToken(2, 'ARTIST');
const gal = authToken(3, 'GALLERY');

const openDirect = (tok: string, userId: number) =>
  request.post('/api/chats/direct').set('Authorization', `Bearer ${tok}`).send({ userId });
const say = (tok: string, id: number, content: string) =>
  request.post(`/api/chats/${id}/messages`).set('Authorization', `Bearer ${tok}`).send({ content });
const mute = (tok: string, id: number, muted: unknown) =>
  request.patch(`/api/chats/${id}/mute`).set('Authorization', `Bearer ${tok}`).send({ muted });
const bell = (userId: number) => testPrisma.notification.count({ where: { userId, type: 'CHAT_MESSAGE' } });

describe('대화방 알림 끄기', () => {
  beforeEach(async () => { await cleanDb(); await seedUsers(); });

  it('★ 끄면 벨 알림(=앱 푸시)이 오지 않는다 · 안 읽은 수는 그대로 · 다시 켜면 온다', async () => {
    const { body: { id } } = await openDirect(a1, 2);
    const r = await mute(a2, id, true);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ muted: true });

    await say(a1, id, '조용히 쌓이는 말');
    expect(await bell(2)).toBe(0);
    expect((await request.get('/api/chats/unread-count').set('Authorization', `Bearer ${a2}`)).body.count).toBe(1);
    const list = await request.get('/api/chats').set('Authorization', `Bearer ${a2}`);
    expect(list.body[0]).toMatchObject({ id, muted: true, unread: 1 });

    expect((await mute(a2, id, false)).body).toEqual({ muted: false });
    await say(a1, id, '이제 울리는 말');
    expect(await bell(2)).toBe(1);
  });

  it('내 설정만 바뀐다 — 상대에게는 그대로 간다 · 방 응답에 내 설정이 실린다', async () => {
    const { body: { id } } = await openDirect(a1, 2);
    await mute(a1, id, true);
    await say(a2, id, 'a1 은 껐다');
    await say(a1, id, 'a2 는 켜 있다');
    expect(await bell(1)).toBe(0);
    expect(await bell(2)).toBe(1);
    expect((await request.get(`/api/chats/${id}`).set('Authorization', `Bearer ${a1}`)).body.muted).toBe(true);
    expect((await request.get(`/api/chats/${id}`).set('Authorization', `Bearer ${a2}`)).body.muted).toBe(false);
  });

  it('두 번 꺼도 같은 답(토글이 아니다) · 남의 방은 404 · 값이 불리언이 아니면 400 · 비로그인 401', async () => {
    const { body: { id } } = await openDirect(a1, 2);
    expect((await mute(a1, id, true)).body.muted).toBe(true);
    expect((await mute(a1, id, true)).body.muted).toBe(true);
    expect((await mute(gal, id, true)).status).toBe(404);
    expect((await mute(a1, id, 'yes')).status).toBe(400);
    expect((await request.patch(`/api/chats/${id}/mute`).send({ muted: true })).status).toBe(401);
  });
});
