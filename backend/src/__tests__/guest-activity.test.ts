/**
 * 비회원 둘러보기 (2026-10-03, Admin [통계] 탭) — `routes/guestActivity.ts` · `GET /api/admin/stats/guests` · `lib/guestActivity.ts`
 *
 * 지켜야 하는 것:
 *  ① 화면이 보내는 그대로(sendBeacon = text/plain 본문) 받는다
 *  ② 주소는 경로 + `tab`·`work` 만 — 카카오 로그인 코드·광고 꼬리표(utm)는 남지 않는다, 바깥 주소는 버린다
 *  ③ 같은 화면을 다시 보내면 머문 시간만 늘어난다(줄지 않는다) — 동시에 와도 한 줄
 *  ④ 가입 표시는 로그인 표시로 낮아지지 않는다
 *  ⑤ '바로 나감' = 화면 하나 · 30초 미만 · 로그인/가입 없음
 *  ⑥ 처음 본 화면·많이 본 화면·둘러보다 나간 곳·최근 방문 경로 — 상세 화면은 이름으로(작가·갤러리 `@주소` 포함)
 *  ⑦ 통계는 Admin 만 · 90일 지난 기록은 지운다
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { request, testPrisma, authToken, cleanDb, seedUsers, seedGallery, seedExhibition } from './helpers';
import { clearGuestStatsCache, guestStats, normalizeGuestPath, pruneGuestActivity, recordGuestActivity, GUEST_STATS_CACHE_MS, GUEST_VIEW_MAX_MS } from '../lib/guestActivity';

const admin = authToken(4, 'ADMIN');
const artist = authToken(1, 'ARTIST');
const V1 = 'visit-aaaaaaaaaaaaaaaa';
const V2 = 'visit-bbbbbbbbbbbbbbbb';
const V3 = 'visit-cccccccccccccccc';

/** sendBeacon 이 보내는 모양 — Content-Type: text/plain, 본문은 JSON 문자열 */
const beacon = (body: unknown) =>
  request.post('/api/guest-activity').set('Content-Type', 'text/plain;charset=UTF-8').send(JSON.stringify(body));
const views = (visitId: string) => testPrisma.guestPageView.findMany({ where: { visitId }, orderBy: { seq: 'asc' } });
const stats = async (days = 30) => {
  const r = await request.get(`/api/admin/stats/guests?days=${days}`).set('Authorization', `Bearer ${admin}`);
  expect(r.status).toBe(200);
  return r.body;
};

describe('비회원 둘러보기 — 기록', () => {
  beforeEach(async () => { await cleanDb(); await seedUsers(); clearGuestStatsCache(); });

  it('① sendBeacon 본문(text/plain)과 JSON 본문 둘 다 받는다 — 204', async () => {
    expect((await beacon({ visitId: V1, views: [{ seq: 0, path: '/', ms: 4200 }] })).status).toBe(204);
    expect((await request.post('/api/guest-activity').send({ visitId: V2, views: [{ seq: 0, path: '/artists', ms: 1000 }] })).status).toBe(204);
    expect((await views(V1)).map((v) => [v.path, v.durationMs])).toEqual([['/', 4200]]);
    expect((await views(V2)).map((v) => v.path)).toEqual(['/artists']);
  });

  it('② 주소는 경로 + tab·work 만 — 인증 코드·광고 꼬리표·해시는 버리고, 바깥 주소는 받지 않는다', async () => {
    await beacon({
      visitId: V1,
      views: [
        { seq: 0, path: '/auth/kakao/callback?code=SECRETCODE&state=xyz', ms: 900 },
        { seq: 1, path: '/@kim.artist?tab=note&utm_source=instagram&fbclid=abc#top', ms: 5000 },
        { seq: 2, path: '/portfolio/7?work=31&q=검색어', ms: 3000 },
        { seq: 3, path: 'https://evil.example/x', ms: 1000 },
        { seq: 4, path: '//evil.example/x', ms: 1000 },
        { seq: 5, path: '/exhibitions?tab=<script>', ms: 1000 },
      ],
    });
    const rows = await views(V1);
    expect(rows.map((r) => r.path)).toEqual(['/auth/kakao/callback', '/@kim.artist?tab=note', '/portfolio/7?work=31', '/exhibitions']);
    expect(JSON.stringify(rows)).not.toMatch(/SECRETCODE|utm|fbclid|검색어|evil/);
    // 함수 자체도
    expect(normalizeGuestPath('/a//b?tab=cv&work=3&x=1')).toBe('/a/b?tab=cv&work=3');
    expect(normalizeGuestPath('javascript:alert(1)')).toBeNull();
    expect(normalizeGuestPath('/\\evil')).toBeNull();
  });

  it('③ 같은 화면을 다시 보내면 머문 시간만 늘어난다 — 줄지 않고, 동시에 와도 한 줄', async () => {
    await beacon({ visitId: V1, views: [{ seq: 0, path: '/exhibitions/1', ms: 3000 }] });
    await beacon({ visitId: V1, views: [{ seq: 0, path: '/exhibitions/1', ms: 9000 }, { seq: 1, path: '/login', ms: 0 }] });
    await beacon({ visitId: V1, views: [{ seq: 0, path: '/exhibitions/1', ms: 2000 }] });   // 늦게 도착한 옛 값
    await Promise.all([1, 2, 3, 4].map((i) => beacon({ visitId: V1, views: [{ seq: 1, path: '/login', ms: i * 1000 }] })));
    const rows = await views(V1);
    expect(rows.map((r) => [r.seq, r.path, r.durationMs])).toEqual([[0, '/exhibitions/1', 9000], [1, '/login', 4000]]);
    expect(await testPrisma.guestVisit.count()).toBe(1);
  });

  it('④ 결과 표시 — 가입은 로그인으로 낮아지지 않고, 로그인은 비어 있을 때만', async () => {
    await beacon({ visitId: V1, views: [{ seq: 0, path: '/login', ms: 2000 }], outcome: 'SIGNUP' });
    await beacon({ visitId: V1, views: [], outcome: 'LOGIN' });
    expect((await testPrisma.guestVisit.findUnique({ where: { id: V1 } }))!.outcome).toBe('SIGNUP');
    await beacon({ visitId: V2, views: [{ seq: 0, path: '/login', ms: 2000 }], outcome: 'LOGIN' });
    expect((await testPrisma.guestVisit.findUnique({ where: { id: V2 } }))!.outcome).toBe('LOGIN');
    await beacon({ visitId: V2, views: [], outcome: 'HACKED' });
    expect((await testPrisma.guestVisit.findUnique({ where: { id: V2 } }))!.outcome).toBe('LOGIN');
  });

  it('한 요청에 화면 10개까지만 — 로그인 없이 쓰는 길이라 요청 하나가 쌓는 줄 수를 묶는다', async () => {
    const many = Array.from({ length: 25 }, (_, i) => ({ seq: i, path: `/community/${i}`, ms: 1000 }));
    expect((await beacon({ visitId: V1, views: many })).status).toBe(204);
    expect((await views(V1)).map((v) => v.seq)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    // 16KB 를 넘는 본문은 받지 않는다
    expect((await request.post('/api/guest-activity').set('Content-Type', 'text/plain').send('x'.repeat(17 * 1024))).status).toBe(413);
  });

  it('끄개 GUEST_ACTIVITY=off — 받기만 하고(204) 아무것도 쓰지 않는다 · 통계는 그대로 열린다', async () => {
    process.env.GUEST_ACTIVITY = 'off';
    try {
      expect((await beacon({ visitId: V1, views: [{ seq: 0, path: '/', ms: 5000 }], outcome: 'LOGIN' })).status).toBe(204);
      expect((await request.post('/api/guest-activity').set('Content-Type', 'text/plain').send('not json')).status).toBe(204);
      expect(await testPrisma.guestVisit.count()).toBe(0);
      expect((await request.get('/api/admin/stats/guests').set('Authorization', `Bearer ${admin}`)).status).toBe(200);
    } finally {
      delete process.env.GUEST_ACTIVITY;
    }
    expect((await beacon({ visitId: V1, views: [{ seq: 0, path: '/', ms: 5000 }] })).status).toBe(204);
    expect(await testPrisma.guestVisit.count()).toBe(1);
  });

  it('형식이 아니면 400 · 이상한 화면은 버린다(순번 300 이상·음수·숫자 아님) · 머문 시간은 30분까지', async () => {
    for (const bad of ['', 'short', 'x'.repeat(65), 'has space 1234567890', '<script>alert(1)</script>']) {
      expect((await beacon({ visitId: bad, views: [{ seq: 0, path: '/', ms: 1 }] })).status, bad).toBe(400);
    }
    expect((await request.post('/api/guest-activity').set('Content-Type', 'text/plain').send('not json')).status).toBe(400);
    await beacon({
      visitId: V1,
      views: [
        { seq: 300, path: '/a', ms: 1 }, { seq: -1, path: '/b', ms: 1 }, { seq: '2', path: '/c', ms: 1 }, { seq: 1.5, path: '/d', ms: 1 },
        { seq: 0, path: '/', ms: 99 * 60 * 60 * 1000 },
      ],
    });
    const rows = await views(V1);
    expect(rows.map((r) => [r.seq, r.durationMs])).toEqual([[0, GUEST_VIEW_MAX_MS]]);
    // 받을 화면도 결과도 없으면 아무것도 만들지 않는다
    expect((await beacon({ visitId: V2, views: [] })).status).toBe(204);
    expect(await testPrisma.guestVisit.findUnique({ where: { id: V2 } })).toBeNull();
  });
});

describe('비회원 둘러보기 — 통계', () => {
  beforeEach(async () => { await cleanDb(); await seedUsers(); clearGuestStatsCache(); });

  it('⑤⑥ 바로 나감 · 처음 본 화면 · 많이 본 화면 · 둘러보다 나간 곳 · 최근 경로(이름으로)', async () => {
    const g = await seedGallery();
    const ex = await seedExhibition(g.id);
    await testPrisma.exhibition.update({ where: { id: ex.id }, data: { title: '가을 신진 공모' } });
    await testPrisma.user.update({ where: { id: 1 }, data: { handle: 'kim.artist', nickname: '김작가' } });
    await testPrisma.gallery.update({ where: { id: g.id }, data: { handle: 'blue.gallery', name: '파란 갤러리' } });
    const old = new Date(Date.now() - 3 * 3600_000);   // 세 시간 전 — '보는 중' 이 아니다

    // V1: 공모 상세만 12초 보고 나감 → 바로 나감
    await recordGuestActivity(V1, { views: [{ seq: 0, path: `/exhibitions/${ex.id}`, ms: 12_000 }] }, old);
    // V2: 공모 상세 → 작가 홈페이지(@) 작품 셋을 넘겨 봄 → 약력 탭 → 갤러리(@) → 나감
    await recordGuestActivity(V2, { views: [
      { seq: 0, path: `/exhibitions/${ex.id}`, ms: 40_000 },
      { seq: 1, path: '/@kim.artist', ms: 8_000 },
      { seq: 2, path: '/@kim.artist?work=11', ms: 3_000 },
      { seq: 3, path: '/@kim.artist?work=12', ms: 2_400 },
      { seq: 4, path: '/@kim.artist?work=13', ms: 2_400 },
      { seq: 5, path: '/@kim.artist?tab=cv', ms: 15_000 },
      { seq: 6, path: '/@blue.gallery', ms: 6_000 },
    ] }, old);
    // V3: 홈 → 로그인 → 가입 정보 입력 → 가입
    await recordGuestActivity(V3, { views: [
      { seq: 0, path: '/', ms: 20_000 }, { seq: 1, path: '/login', ms: 5_000 }, { seq: 2, path: '/auth/register', ms: 30_000 },
    ], outcome: 'SIGNUP' }, old);
    // V4: 홈 하나를 오래(45초) — 바로 나감이 아니다
    await recordGuestActivity('visit-dddddddddddddddd', { views: [{ seq: 0, path: '/', ms: 45_000 }] }, old);

    const s = await stats();
    expect(s.summary).toMatchObject({ visits: 4, bounced: 1, signup: 1, login: 0 });
    expect(s.summary.avgViews).toBe(3);   // (1 + 7 + 3 + 1) / 4
    // 처음 본 화면 — 공모 상세(제목으로) 2회 중 1회 바로 나감, 홈 2회 중 가입 1회
    const land = (label: string) => s.landings.find((l: any) => l.label === label);
    expect(land('공모 상세')).toMatchObject({ detail: '가을 신진 공모', visits: 2, bounced: 1, signups: 0 });
    expect(land('홈')).toMatchObject({ visits: 2, bounced: 0, signups: 1 });
    // 많이 본 화면 — 방문 수 기준, `@주소` 는 작가·갤러리로 갈린다
    const page = (label: string) => s.pages.find((p: any) => p.label === label);
    expect(page('작가 홈페이지')).toMatchObject({ visits: 1, views: 5 });
    expect(page('갤러리 홈페이지')).toMatchObject({ visits: 1, views: 1, avgSeconds: 6 });
    expect(page('가입 정보 입력')).toMatchObject({ visits: 1, avgSeconds: 30 });
    // 둘러보다 나간 곳 — 바로 나간 V1·가입한 V3 는 빼고: V2(갤러리) · V4(홈)
    expect(s.exits).toEqual(expect.arrayContaining([{ label: '갤러리 홈페이지', count: 1 }, { label: '홈', count: 1 }]));
    expect(s.exits.reduce((n: number, e: any) => n + e.count, 0)).toBe(2);

    // 최근 경로 — 작품을 넘겨 본 셋은 한 줄로(×3), 탭 이름, 이름이 붙는다
    const v2 = s.recent.find((r: any) => r.views === 7);
    expect(v2.steps.map((st: any) => [st.label, st.detail, st.tab, st.work, st.repeat, st.seconds])).toEqual([
      ['공모 상세', '가을 신진 공모', null, false, 1, 40],
      ['작가 홈페이지', '김작가', null, false, 1, 8],
      ['작가 홈페이지', '김작가', null, true, 3, 8],
      ['작가 홈페이지', '김작가', '약력', false, 1, 15],
      ['갤러리 홈페이지', '파란 갤러리', null, false, 1, 6],
    ]);
    expect(v2).toMatchObject({ seconds: 77, bounced: false, ongoing: false, outcome: null });
    expect(s.recent.find((r: any) => r.outcome === 'SIGNUP').steps.map((st: any) => st.label)).toEqual(['홈', '로그인', '가입 정보 입력']);
    expect(s.since).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('새로고침으로 같은 화면이 이어서 두 번 남아도 한 화면이다 — 바로 나감·화면 수가 흔들리지 않는다', async () => {
    const old = new Date(Date.now() - 3 * 3600_000);
    // V1: 모집공고 7초 → (새로고침) 모집공고 10초 → 나감 = 화면 하나 17초 → 바로 나감
    await recordGuestActivity(V1, { views: [
      { seq: 0, path: '/exhibitions', ms: 7_000 }, { seq: 1, path: '/exhibitions', ms: 10_000 },
    ] }, old);
    // V2: 모집공고 → (새로고침) 모집공고 → 작가 → 모집공고 = 화면 셋(떨어진 같은 화면은 합치지 않는다)
    await recordGuestActivity(V2, { views: [
      { seq: 0, path: '/exhibitions', ms: 7_000 }, { seq: 1, path: '/exhibitions', ms: 4_000 },
      { seq: 2, path: '/artists', ms: 5_000 }, { seq: 3, path: '/exhibitions', ms: 3_000 },
    ] }, old);
    const s = await stats();
    expect(s.summary).toMatchObject({ visits: 2, bounced: 1, avgViews: 2 });   // (1 + 3) / 2
    expect(s.landings.find((l: any) => l.label === '모집공고')).toMatchObject({ visits: 2, bounced: 1 });
    expect(s.pages.find((p: any) => p.label === '모집공고')).toMatchObject({ visits: 2, views: 3 });
    const v1 = s.recent.find((r: any) => r.bounced);
    expect(v1).toMatchObject({ views: 1, seconds: 17 });
    expect(v1.steps).toEqual([expect.objectContaining({ label: '모집공고', repeat: 1, seconds: 17 })]);   // ×2 로 그리지 않는다
    const v2 = s.recent.find((r: any) => !r.bounced);
    expect(v2.views).toBe(3);
    expect(v2.steps.map((st: any) => [st.label, st.seconds])).toEqual([['모집공고', 11], ['작가', 5], ['모집공고', 3]]);
    // 가장 많이 본 곳은 모집공고 — 새로고침 몫은 머문 시간에만 더해진다(평균 = (17 + 11 + 3) / 3)
    expect(s.pages.find((p: any) => p.label === '모집공고').avgSeconds).toBe(10);
  });

  it('기간 밖 방문은 빼고 · 방금 기록된 방문은 \'보는 중일 수 있음\'', async () => {
    await recordGuestActivity(V1, { views: [{ seq: 0, path: '/', ms: 5_000 }] }, new Date(Date.now() - 10 * 86400_000));
    await recordGuestActivity(V2, { views: [{ seq: 0, path: '/artists', ms: 5_000 }] });
    const s = await stats(7);
    expect(s.summary.visits).toBe(1);
    expect(s.recent[0]).toMatchObject({ ongoing: true, bounced: true });
    expect((await stats(30)).summary.visits).toBe(2);
  });

  it('떠남 신호(pagehide)가 오면 30분 안이라도 \'나감\' — 같은 방문이 이어지면(새 화면) 다시 지운다', async () => {
    await beacon({ visitId: V1, views: [{ seq: 0, path: '/', ms: 6_000 }], left: true });
    expect((await stats()).recent[0]).toMatchObject({ ongoing: false });
    // 늦게 도착한 가려짐 신호(이미 받은 화면의 시간만 고침)는 떠남을 지우지 않는다
    await beacon({ visitId: V1, views: [{ seq: 0, path: '/', ms: 6_500 }] });
    expect((await testPrisma.guestVisit.findUnique({ where: { id: V1 } }))!.leftAt).not.toBeNull();
    // 새로고침·카카오에서 돌아와 새 화면이 들어오면 — 이어지는 방문이다
    await beacon({ visitId: V1, views: [{ seq: 1, path: '/artists', ms: 3_000 }] });
    expect((await testPrisma.guestVisit.findUnique({ where: { id: V1 } }))!.leftAt).toBeNull();
    clearGuestStatsCache();   // 같은 1분 안이라 저장해 둔 답이 나온다
    expect((await stats()).recent[0]).toMatchObject({ ongoing: true, views: 2 });
    // 화면 없이 떠남만 와도 받는다(204, 표시만)
    expect((await beacon({ visitId: V1, views: [], left: true })).status).toBe(204);
    expect((await testPrisma.guestVisit.findUnique({ where: { id: V1 } }))!.leftAt).not.toBeNull();
    // left 는 true 일 때만 — 문자열 'true' 같은 건 무시
    await beacon({ visitId: V2, views: [{ seq: 0, path: '/', ms: 1_000 }], left: 'true' });
    expect((await testPrisma.guestVisit.findUnique({ where: { id: V2 } }))!.leftAt).toBeNull();
  });

  it('같은 기간은 1분 동안 다시 세지 않는다(저장해 둔 답) — 지나면 새로 센다', async () => {
    const t0 = new Date();
    await recordGuestActivity(V1, { views: [{ seq: 0, path: '/', ms: 5_000 }] }, t0);
    expect((await guestStats(30, t0)).summary.visits).toBe(1);
    await recordGuestActivity(V2, { views: [{ seq: 0, path: '/artists', ms: 5_000 }] }, t0);
    expect((await guestStats(30, new Date(t0.getTime() + 1_000))).summary.visits).toBe(1);   // 저장해 둔 답
    expect((await guestStats(7, new Date(t0.getTime() + 1_000))).summary.visits).toBe(2);    // 다른 기간은 따로
    expect((await guestStats(30, new Date(t0.getTime() + GUEST_STATS_CACHE_MS + 1))).summary.visits).toBe(2);
  });

  it('기록이 없으면 since 가 null — 화면은 \'아직 기록 없음\'을 그린다', async () => {
    const s = await guestStats(30);
    expect(s).toMatchObject({ since: null, capped: false, summary: { visits: 0, bounced: 0, medianSeconds: 0 }, landings: [], pages: [], exits: [], recent: [] });
  });

  it('⑦ 통계는 Admin 만 · 기간 형식 확인', async () => {
    expect((await request.get('/api/admin/stats/guests')).status).toBe(401);
    expect((await request.get('/api/admin/stats/guests').set('Authorization', `Bearer ${artist}`)).status).toBe(403);
    expect((await request.get('/api/admin/stats/guests?days=abc').set('Authorization', `Bearer ${admin}`)).status).toBe(400);
  });

  it('⑦ 90일 지난 방문은 지운다(화면도 함께)', async () => {
    const now = new Date();
    await recordGuestActivity(V1, { views: [{ seq: 0, path: '/', ms: 1_000 }] }, new Date(now.getTime() - 91 * 86400_000));
    await recordGuestActivity(V2, { views: [{ seq: 0, path: '/', ms: 1_000 }] }, new Date(now.getTime() - 89 * 86400_000));
    expect(await pruneGuestActivity(now, true)).toBe(1);
    expect(await testPrisma.guestVisit.findMany({ select: { id: true } })).toEqual([{ id: V2 }]);
    expect(await testPrisma.guestPageView.count({ where: { visitId: V1 } })).toBe(0);
  });
});
