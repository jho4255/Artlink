/**
 * 일간 방문자 (2026-09-28, Admin [통계] 탭) — `routes/visit.ts` · `GET /api/admin/stats/visitors` · `lib/visitStats.ts`
 *
 * 지켜야 하는 것:
 *  ① 한 기기는 하루에 한 번만 센다 — 새로고침·재방문·동시 요청이 줄을 늘리지 않는다
 *  ② 비회원으로 들어와 그날 로그인하면 회원 1명(비회원에서 빠진다) — 두 번 세지 않는다
 *  ③ 회원은 사람 단위 — 한 사람이 기기 둘로 들어와도 1명
 *  ④ Admin 은 회원 수에서 뺀다(운영자가 관리 화면을 열어 두는 게 방문자를 부풀리면 안 된다)
 *  ⑤ 날짜는 서버가 KST 로 정한다 — UTC 15시(=KST 자정)를 넘으면 다음 날
 *  ⑥ 기록이 없는 날도 0 으로 채워 날짜열이 끊기지 않는다
 *  ⑦ 통계는 Admin 만
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { request, testPrisma, authToken, cleanDb, seedUsers } from './helpers';
import { dailyVisitorStats, kstDay, recordVisit, dayKey } from '../lib/visitStats';

const artist = authToken(1, 'ARTIST');
const artist2 = authToken(2, 'ARTIST');
const admin = authToken(4, 'ADMIN');
const DEV_A = 'device-aaaaaaaaaaaaaaaa';
const DEV_B = 'device-bbbbbbbbbbbbbbbb';
const DEV_C = 'device-cccccccccccccccc';

const visit = (visitorId: string, token?: string) => {
  const r = request.post('/api/visits').send({ visitorId });
  return token ? r.set('Authorization', `Bearer ${token}`) : r;
};
const todayRow = async () => {
  const s = await request.get('/api/admin/stats/visitors?days=1').set('Authorization', `Bearer ${admin}`);
  expect(s.status).toBe(200);
  return s.body.rows[0] as { date: string; members: number; guests: number; total: number };
};

describe('일간 방문자', () => {
  beforeEach(async () => {
    await cleanDb();
    await seedUsers();
  });

  it('① 비회원 기기는 하루 한 번만 — 다시 와도, 동시에 두 번 와도 한 줄', async () => {
    expect((await visit(DEV_A)).status).toBe(204);
    expect((await visit(DEV_A)).status).toBe(204);
    const both = await Promise.all([visit(DEV_B), visit(DEV_B)]);
    expect(both.map((r) => r.status)).toEqual([204, 204]);
    expect(await testPrisma.dailyVisit.count()).toBe(2);
    expect(await todayRow()).toMatchObject({ members: 0, guests: 2, total: 2 });
  });

  it('형식이 아닌 기기 id 는 400 — 아무 문자열이나 쌓이지 않게', async () => {
    for (const bad of ['', 'short', 'x'.repeat(65), 'has space in it 1234', '<script>alert(1)</script>']) {
      expect((await visit(bad)).status, bad).toBe(400);
    }
    expect((await request.post('/api/visits').send({})).status).toBe(400);
    expect(await testPrisma.dailyVisit.count()).toBe(0);
  });

  it('② 비회원으로 들어와 같은 날 로그인하면 회원 1명 — 비회원에서 빠진다', async () => {
    await visit(DEV_A);
    expect(await todayRow()).toMatchObject({ members: 0, guests: 1 });
    await visit(DEV_A, artist);
    expect(await testPrisma.dailyVisit.count()).toBe(1);
    expect(await todayRow()).toMatchObject({ members: 1, guests: 0, total: 1 });
  });

  it('③ 회원은 사람 단위 — 한 사람이 기기 둘로 들어와도 1명, 다른 사람은 따로', async () => {
    await visit(DEV_A, artist);
    await visit(DEV_B, artist);
    await visit(DEV_C, artist2);
    expect(await todayRow()).toMatchObject({ members: 2, guests: 0, total: 2 });
  });

  it('④ Admin 방문은 회원에도 비회원에도 안 들어간다', async () => {
    await visit(DEV_A);          // 관리자 기기가 먼저 비회원으로 찍혔다가
    await visit(DEV_A, admin);   // 로그인 — 비회원 줄이 관리자 줄로 바뀌고 집계에서 빠진다
    await visit(DEV_B, artist);
    expect(await todayRow()).toMatchObject({ members: 1, guests: 0, total: 1 });
  });

  it('⑤ 날짜는 KST — UTC 14:59 는 그날, 15:00 은 다음 날', async () => {
    expect(dayKey(kstDay(new Date('2026-09-27T14:59:59Z')))).toBe('2026-09-27');
    expect(dayKey(kstDay(new Date('2026-09-27T15:00:00Z')))).toBe('2026-09-28');
    await recordVisit(DEV_A, null, new Date('2026-09-27T14:30:00Z'));
    await recordVisit(DEV_A, null, new Date('2026-09-27T15:30:00Z'));   // 같은 기기라도 날이 바뀌면 새 줄
    const rows = await testPrisma.dailyVisit.findMany({ orderBy: { day: 'asc' } });
    expect(rows.map((r) => dayKey(r.day))).toEqual(['2026-09-27', '2026-09-28']);
  });

  it('⑥ 기록 없는 날도 0 으로 채워 날짜가 이어진다 · since 는 첫 기록일 · 기간은 180일까지', async () => {
    const now = new Date('2026-09-28T03:00:00Z');   // KST 2026-09-28 12:00
    await recordVisit(DEV_A, null, new Date('2026-09-25T03:00:00Z'));
    await recordVisit(DEV_B, 1, new Date('2026-09-28T01:00:00Z'));
    const { rows, since } = await dailyVisitorStats(7, now);
    expect(rows.map((r) => r.date)).toEqual(['2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27', '2026-09-28']);
    expect(rows.find((r) => r.date === '2026-09-25')).toMatchObject({ members: 0, guests: 1 });
    expect(rows.find((r) => r.date === '2026-09-26')).toMatchObject({ members: 0, guests: 0, total: 0 });
    expect(rows[rows.length - 1]).toMatchObject({ date: '2026-09-28', members: 1, guests: 0 });
    expect(since).toBe('2026-09-25');
    expect((await dailyVisitorStats(1000, now)).rows).toHaveLength(180);
  });

  it('⑦ 통계는 Admin 만 — 비로그인 401 · 작가 403 · 잘못된 기간 400', async () => {
    expect((await request.get('/api/admin/stats/visitors')).status).toBe(401);
    expect((await request.get('/api/admin/stats/visitors').set('Authorization', `Bearer ${artist}`)).status).toBe(403);
    expect((await request.get('/api/admin/stats/visitors?days=abc').set('Authorization', `Bearer ${admin}`)).status).toBe(400);
    const ok = await request.get('/api/admin/stats/visitors').set('Authorization', `Bearer ${admin}`);
    expect(ok.status).toBe(200);
    expect(ok.body.rows).toHaveLength(30);   // 기본 30일
    expect(ok.body.since).toBeNull();        // 아직 기록 없음
  });
});
