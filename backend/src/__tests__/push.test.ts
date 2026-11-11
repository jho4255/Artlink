/**
 * 앱 푸시 알림 (2026-11-09, CLAUDE.md 규칙 79) — 기기 토큰 등록·삭제와 '벨 알림이 생기면 기기로도 간다'.
 * Firebase 는 가짜(sendEach 를 받아 적는다). 보내기는 응답 뒤에 일어나므로 pushIdle() 로 기다린 뒤 본다.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';

const fcm = vi.hoisted(() => ({ sendEach: vi.fn() }));
vi.mock('firebase-admin/app', () => ({
  getApps: () => [],
  initializeApp: (_opts: unknown, name: string) => ({ name }),
  cert: (sa: unknown) => sa,
}));
vi.mock('firebase-admin/messaging', () => ({ getMessaging: () => ({ sendEach: fcm.sendEach }) }));

import { request, cleanDb, seedUsers, authToken, testPrisma } from './helpers';
import { pushIdle, pushItemsFor, buildMessage, __resetPushForTests, PUSH_CHANNEL_ID, PUSH_TITLES, pushTitle } from '../lib/push';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const TOKEN_A = 'tok-artist1-' + 'a'.repeat(40);
const TOKEN_B = 'tok-artist1-phone2-' + 'b'.repeat(40);
const TOKEN_ADMIN = 'tok-admin-' + 'c'.repeat(40);

type Msg = { token: string; notification: { title: string; body: string }; data: Record<string, string>; android: { notification: { channelId: string; tag?: string } } };
const sentMessages = (): Msg[] => fcm.sendEach.mock.calls.flatMap((c) => c[0] as Msg[]);

const savedEnv = { sa: process.env.FIREBASE_SERVICE_ACCOUNT, push: process.env.PUSH };

beforeEach(async () => {
  await pushIdle();
  __resetPushForTests();
  await cleanDb();
  await seedUsers();
  process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({ project_id: 'artlink-test', client_email: 't@test', private_key: 'x' });
  process.env.PUSH = '';
  fcm.sendEach.mockReset();
  fcm.sendEach.mockImplementation(async (msgs: Msg[]) => ({
    successCount: msgs.length,
    failureCount: 0,
    responses: msgs.map(() => ({ success: true, messageId: 'm' })),
  }));
});

afterAll(async () => {
  await pushIdle();
  process.env.FIREBASE_SERVICE_ACCOUNT = savedEnv.sa ?? '';
  process.env.PUSH = savedEnv.push ?? '';
  __resetPushForTests();
});

const putToken = (userId: number, role: string, token: string, platform = 'android') =>
  request.put('/api/push/tokens').set('Authorization', `Bearer ${authToken(userId, role)}`).send({ token, platform });

describe('기기 토큰 — PUT /push/tokens · DELETE /push/tokens', () => {
  it('로그인한 사람의 기기를 등록한다 · 같은 토큰을 다시 보내면 줄이 늘지 않는다', async () => {
    expect((await putToken(1, 'ARTIST', TOKEN_A)).status).toBe(200);
    expect((await putToken(1, 'ARTIST', TOKEN_A)).status).toBe(200);
    const rows = await testPrisma.pushToken.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ token: TOKEN_A, userId: 1, platform: 'android' });
  });

  it('같은 기기에서 다른 사람이 로그인하면 그 사람에게 옮겨진다', async () => {
    await putToken(1, 'ARTIST', TOKEN_A);
    await putToken(2, 'ARTIST', TOKEN_A);
    const rows = await testPrisma.pushToken.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(2);
  });

  it('★ 동시에 여러 번 와도 전부 200 · 줄 하나(규칙 46 — 확인하고 만들지 않는다)', async () => {
    const res = await Promise.all(Array.from({ length: 6 }, () => putToken(1, 'ARTIST', TOKEN_A)));
    expect(res.map((r) => r.status)).toEqual([200, 200, 200, 200, 200, 200]);
    expect(await testPrisma.pushToken.count()).toBe(1);
  });

  it('로그인이 없으면 401 · 토큰·플랫폼이 이상하면 400', async () => {
    expect((await request.put('/api/push/tokens').send({ token: TOKEN_A, platform: 'android' })).status).toBe(401);
    expect((await putToken(1, 'ARTIST', 'short')).status).toBe(400);
    expect((await putToken(1, 'ARTIST', TOKEN_A, 'windows')).status).toBe(400);
    expect(await testPrisma.pushToken.count()).toBe(0);
  });

  it('★ 지우기는 인증 없이 토큰만으로 — 로그인이 만료돼 자동 로그아웃될 때도 끊겨야 한다', async () => {
    await putToken(1, 'ARTIST', TOKEN_A);
    await putToken(1, 'ARTIST', TOKEN_B);
    const res = await request.delete('/api/push/tokens').send({ token: TOKEN_A });
    expect(res.status).toBe(200);
    expect(res.body.removed).toBe(1);
    expect((await testPrisma.pushToken.findMany()).map((r) => r.token)).toEqual([TOKEN_B]);
    // 없는 토큰도 200(두 번 눌러도 에러가 아니다)
    expect((await request.delete('/api/push/tokens').send({ token: TOKEN_A })).body.removed).toBe(0);
  });

  it('탈퇴하면 그 사람의 기기 토큰이 지워진다', async () => {
    await putToken(1, 'ARTIST', TOKEN_A);
    const res = await request.delete('/api/auth/me').set('Authorization', `Bearer ${authToken(1, 'ARTIST')}`).send({ confirmText: '탈퇴' });
    expect(res.status).toBe(200);
    expect(await testPrisma.pushToken.count()).toBe(0);
  });
});

describe('벨 알림 → 기기 푸시 (Prisma 갈고리 한 곳)', () => {
  it('★ 문의에 답하면 작성자의 기기들로 — 메시지·링크·알림 id·채널이 실린다', async () => {
    await putToken(1, 'ARTIST', TOKEN_A);
    await putToken(1, 'ARTIST', TOKEN_B);
    const inq = await testPrisma.inquiry.create({ data: { userId: 1, subject: '정산 문의', content: '내용' } });
    const res = await request.patch(`/api/inquiries/${inq.id}/reply`).set('Authorization', `Bearer ${authToken(4, 'ADMIN')}`).send({ reply: '답변입니다' });
    expect(res.status).toBe(200);
    await pushIdle();

    const notif = await testPrisma.notification.findFirstOrThrow({ where: { userId: 1, type: 'INQUIRY_REPLY' } });
    const msgs = sentMessages();
    expect(msgs.map((m) => m.token).sort()).toEqual([TOKEN_A, TOKEN_B].sort());
    for (const m of msgs) {
      expect(m.notification.title).toBe('문의 답변');   // 종류별 제목 — 'ArtLink' 는 알림 머리의 앱 이름과 겹친다
      expect(m.notification.body).toBe(notif.message);
      expect(m.data).toEqual({ linkUrl: `/support?inquiry=${inq.id}`, notificationId: String(notif.id), type: 'INQUIRY_REPLY' });
      expect(m.android.notification.channelId).toBe(PUSH_CHANNEL_ID);
      expect(m.android.notification.tag).toBe(`n:${notif.id}`);
    }
  });

  it('★ 제목은 알림 종류별 — 모르는 종류는 ArtLink · 백엔드가 만드는 모든 종류에 제목이 있다(새 종류를 빠뜨리지 않게)', () => {
    expect(pushTitle('CHAT_MESSAGE')).toBe('ArtTalk');
    expect(pushTitle('SOMETHING_NEW')).toBe('ArtLink');
    expect(pushTitle(null)).toBe('ArtLink');
    // 소스에서 `type: '…'` 로 적힌 값을 모은다(공모 구분 SOLO·GROUP·ART_FAIR 는 알림이 아니다)
    const NOT_NOTIFICATION = new Set(['SOLO', 'GROUP', 'ART_FAIR']);
    const files: string[] = [];
    const walk = (d: string) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) { if (n !== '__tests__') walk(p); } else if (p.endsWith('.ts')) files.push(p); } };
    walk(join(__dirname, '..'));
    const types = new Set<string>();
    for (const f of files) for (const line of readFileSync(f, 'utf8').split('\n')) {
      const m = /\btype:\s*(.*)$/.exec(line);
      if (m) for (const t of m[1].matchAll(/'([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+|[A-Z]{3,})'/g)) if (!NOT_NOTIFICATION.has(t[1])) types.add(t[1]);
    }
    expect(types.size).toBeGreaterThan(20);
    expect([...types].filter((t) => !PUSH_TITLES[t])).toEqual([]);
  });

  it('★ 새 문의(createMany — 관리자 전원)도 간다 · 토큰 없는 사람은 건너뛴다', async () => {
    await testPrisma.user.create({ data: { id: 50, email: 'admin2@test.com', name: 'Admin 2', role: 'ADMIN' } });
    await putToken(4, 'ADMIN', TOKEN_ADMIN);   // 관리자 50 은 앱이 없다
    const res = await request.post('/api/inquiries').set('Authorization', `Bearer ${authToken(1, 'ARTIST')}`).send({ subject: '앱 문의', content: '내용' });
    expect(res.status).toBe(201);
    await pushIdle();
    const msgs = sentMessages();
    expect(msgs).toHaveLength(1);
    expect(msgs[0].token).toBe(TOKEN_ADMIN);
    expect(msgs[0].data.linkUrl).toBe(`/support?inquiry=${res.body.id}`);
    expect(msgs[0].data.notificationId).toBe('');   // createMany 는 행 id 를 돌려주지 않는다 — 누르면 화면으로는 간다
  });

  it('★ 고쳐 쓰는 알림은 "새 소식"만 다시 울린다 — 대화방 새 메시지는 울리고, 좋아요 합산·읽음은 안 울린다', async () => {
    await putToken(1, 'ARTIST', TOKEN_A);
    const chat = await testPrisma.notification.create({ data: { userId: 1, type: 'CHAT_MESSAGE', message: '갤러리: 안녕하세요', linkUrl: '/messages?chat=7', refKey: 'chat:7' } });
    await testPrisma.notification.update({ where: { id: chat.id }, data: { message: '갤러리: 두 번째', createdAt: new Date() } });
    await testPrisma.notification.update({ where: { id: chat.id }, data: { read: true } });
    const like = await testPrisma.notification.create({ data: { userId: 1, type: 'ARTWORK_LIKE', message: '1명이 좋아합니다', linkUrl: '/@a', refKey: 'artwork-like:3' } });
    await testPrisma.notification.update({ where: { id: like.id }, data: { message: '2명이 좋아합니다' } });
    await pushIdle();

    const bodies = sentMessages().map((m) => m.notification.body);
    expect(bodies).toEqual(['갤러리: 안녕하세요', '갤러리: 두 번째', '1명이 좋아합니다']);
    // 같은 방 알림은 서랍에서 하나로(tag = refKey)
    expect(sentMessages()[1].android.notification.tag).toBe('chat:7');
  });

  it('★ 대화 알림은 카카오톡처럼 — 갠톡 제목 = 보낸 사람·본문 = 메시지 / 단톡 제목 = 방 이름·본문 = 보낸 사람: 메시지', async () => {
    await putToken(2, 'ARTIST', TOKEN_B);
    const a1 = authToken(1, 'ARTIST');
    const direct = await request.post('/api/chats/direct').set('Authorization', `Bearer ${a1}`).send({ userId: 2 });
    await request.post(`/api/chats/${direct.body.id}/messages`).set('Authorization', `Bearer ${a1}`).send({ content: '작품 잘 봤어요' });
    const group = await testPrisma.chat.create({ data: { kind: 'GROUP', title: '2026 신진작가 공모', participants: { create: [{ userId: 1 }, { userId: 2 }] } } });
    await request.post(`/api/chats/${group.id}/messages`).set('Authorization', `Bearer ${a1}`).send({ content: '자료 제출 마감은 금요일입니다' });
    await pushIdle();

    const me = await testPrisma.user.findUniqueOrThrow({ where: { id: 1 } });
    const name = me.nickname || me.name;
    const msgs = sentMessages();
    expect(msgs.map((m) => [m.notification.title, m.notification.body])).toEqual([
      [name, '작품 잘 봤어요'],
      ['2026 신진작가 공모', `${name}: 자료 제출 마감은 금요일입니다`],
    ]);
    // 벨 목록 글은 그대로다
    const bell = await testPrisma.notification.findFirstOrThrow({ where: { userId: 2, refKey: `chat:${direct.body.id}` } });
    expect(bell.message).toBe(`${name}님의 새 메시지: 작품 잘 봤어요`);
  });

  it('★ FCM 이 "등록 해제된 토큰"이라고 하면 지운다 — 다른 오류(invalid-argument)로는 지우지 않는다', async () => {
    await putToken(1, 'ARTIST', TOKEN_A);
    await putToken(1, 'ARTIST', TOKEN_B);
    fcm.sendEach.mockImplementation(async (msgs: Msg[]) => ({
      successCount: 0,
      failureCount: msgs.length,
      responses: msgs.map((m) => ({
        success: false,
        error: { code: m.token === TOKEN_A ? 'messaging/registration-token-not-registered' : 'messaging/invalid-argument', message: 'x' },
      })),
    }));
    await testPrisma.notification.create({ data: { userId: 1, type: 'APPLICATION_STATUS', message: '결과가 나왔어요', linkUrl: '/mypage' } });
    await pushIdle();
    expect((await testPrisma.pushToken.findMany()).map((r) => r.token)).toEqual([TOKEN_B]);
  });

  it('500개씩 나눠 보낸다(FCM sendEach 상한)', async () => {
    await testPrisma.pushToken.createMany({ data: Array.from({ length: 620 }, (_, i) => ({ token: `bulk-${i}-${'x'.repeat(30)}`, userId: 2, platform: 'android' })) });
    await testPrisma.notification.create({ data: { userId: 2, type: 'APPLICATION_STATUS', message: 'm', linkUrl: '/' } });
    await pushIdle();
    expect(fcm.sendEach.mock.calls.map((c) => (c[0] as Msg[]).length)).toEqual([500, 120]);
  });

  it('탈퇴한 사람에겐 보내지 않는다 · PUSH=off 거나 서비스 계정이 없으면 아무것도 안 한다', async () => {
    await putToken(1, 'ARTIST', TOKEN_A);
    await putToken(2, 'ARTIST', TOKEN_B);
    await testPrisma.user.update({ where: { id: 1 }, data: { deletedAt: new Date() } });
    await testPrisma.notification.create({ data: { userId: 1, type: 'APPLICATION_STATUS', message: 'x', linkUrl: '/' } });
    await pushIdle();
    expect(fcm.sendEach).not.toHaveBeenCalled();

    process.env.PUSH = 'off';
    await testPrisma.notification.create({ data: { userId: 2, type: 'APPLICATION_STATUS', message: 'x', linkUrl: '/' } });
    await pushIdle();
    process.env.PUSH = '';
    process.env.FIREBASE_SERVICE_ACCOUNT = '';
    await testPrisma.notification.create({ data: { userId: 2, type: 'APPLICATION_STATUS', message: 'x', linkUrl: '/' } });
    await pushIdle();
    expect(fcm.sendEach).not.toHaveBeenCalled();
  });

  it('보내기가 실패해도 알림 저장·응답은 그대로다', async () => {
    await putToken(1, 'ARTIST', TOKEN_A);
    fcm.sendEach.mockRejectedValue(new Error('FCM down'));
    const inq = await testPrisma.inquiry.create({ data: { userId: 1, subject: 's', content: 'c' } });
    const res = await request.patch(`/api/inquiries/${inq.id}/reply`).set('Authorization', `Bearer ${authToken(4, 'ADMIN')}`).send({ reply: 'r' });
    expect(res.status).toBe(200);
    await pushIdle();
    expect(await testPrisma.notification.count({ where: { userId: 1 } })).toBe(1);
    expect(await testPrisma.pushToken.count()).toBe(1);   // 일시 오류로 토큰을 지우지 않는다
  });
});

describe('pushItemsFor · buildMessage (순수 판정)', () => {
  const row = { id: 9, userId: 3, type: 'NEW_APPLICANT', message: 'm', linkUrl: '/x', refKey: null };
  it('Notification 이 아니거나 다른 동작이면 []', () => {
    expect(pushItemsFor({ model: 'User', action: 'create', args: {} }, row)).toEqual([]);
    expect(pushItemsFor({ model: 'Notification', action: 'updateMany', args: { data: { message: 'x' } } }, { count: 3 })).toEqual([]);
    expect(pushItemsFor({ model: 'Notification', action: 'delete', args: {} }, row)).toEqual([]);
  });
  it('createMany 는 data 가 하나여도 배열이어도 받는다', () => {
    expect(pushItemsFor({ model: 'Notification', action: 'createMany', args: { data: { userId: 1, message: 'a', type: 'T' } } }, { count: 1 })).toHaveLength(1);
    expect(pushItemsFor({ model: 'Notification', action: 'createMany', args: { data: [{ userId: 1, message: 'a' }, { userId: 2, message: 'b' }] } }, { count: 2 })).toHaveLength(2);
  });
  it('긴 메시지는 자르고 data 값은 전부 문자열', () => {
    const m = buildMessage('t', { userId: 1, body: '가'.repeat(400), linkUrl: null, notificationId: 5, type: 'X' }) as unknown as Msg;
    expect(m.notification.body.length).toBeLessThanOrEqual(180);
    expect(m.notification.body.endsWith('…')).toBe(true);
    expect(Object.values(m.data).every((v) => typeof v === 'string')).toBe(true);
    expect(m.data.linkUrl).toBe('/');
  });
});
