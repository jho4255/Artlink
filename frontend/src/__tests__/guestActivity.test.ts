/**
 * 비회원 둘러보기 — 화면 쪽 기록기(`lib/guestActivity.ts`)와 통계 글자(`lib/guestStatsView.ts`) (2026-10-03)
 *
 * 기록기는 시계·저장소·전송을 `deps` 로 받으므로 여기서 시계를 돌려 본다(브라우저 없이).
 * 지켜야 하는 것: 머문 시간은 보이는 동안만 · 곧바로 넘어간 화면은 남기지 않음 · 탭이 열려 있는 한 같은 방문(쉬는 시간으로 끊지 않는다) · 로그인하면 닫고 멈춤 ·
 * 닫을 때 '떠남' · 주소는 tab·work 만.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GuestTracker, guestPath, guestTrackingAllowed, HANDOFF_SEQ_GAP, HANDOFF_TTL_MS, MAX_BATCH, MAX_VIEWS, readHandoff, type GuestBeacon, type GuestVisit, type TrackerDeps } from '@/lib/guestActivity';
import { fmtDuration, pct, stepText, visitEnd, visitTime } from '@/lib/guestStatsView';

/** 가짜 시계·타이머·저장소 */
function rig(opts: { stored?: GuestVisit | null; sendThrows?: boolean } = {}) {
  let now = 1_000_000;
  let visible = true;
  let ids = 0;
  const timers: { at: number; fn: () => void; id: number }[] = [];
  let tid = 0;
  const sent: GuestBeacon[] = [];
  let stored: GuestVisit | null = opts.stored ?? null;
  const deps: TrackerDeps = {
    now: () => now,
    visible: () => visible,
    send: (b) => { sent.push(JSON.parse(JSON.stringify(b))); if (opts.sendThrows) throw new Error('network down'); },
    load: () => (stored ? { ...stored } : null),
    save: (v) => { stored = { ...v }; },
    newId: () => `visit-${String(++ids).padStart(16, '0')}`,
    setTimer: (fn, ms) => { const id = ++tid; timers.push({ at: now + ms, fn, id }); return id; },
    clearTimer: (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); },
  };
  const t = new GuestTracker(deps);
  t.start();
  /** 시간을 흘린다 — 그 사이 걸린 타이머를 순서대로 */
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const next = timers[0];
      if (!next || next.at > end) break;
      timers.shift();
      now = next.at;
      next.fn();
    }
    now = end;
  };
  return { t, sent, advance, setVisible: (v: boolean) => { visible = v; }, stored: () => stored };
}
const lastViews = (sent: GuestBeacon[]) => sent.flatMap((b) => b.views);

describe('guestPath — 남길 주소', () => {
  it('경로 + tab·work 만 — 인증 코드·광고 꼬리표·검색어는 버린다', () => {
    expect(guestPath('/auth/kakao/callback', '?code=SECRET&state=x')).toBe('/auth/kakao/callback');
    expect(guestPath('/@kim', '?tab=note&utm_source=ig&fbclid=1')).toBe('/@kim?tab=note');
    expect(guestPath('/portfolio/3', '?work=12&q=검색')).toBe('/portfolio/3?work=12');
    expect(guestPath('/exhibitions', '?region=SEOUL&sort=deadline')).toBe('/exhibitions');
    expect(guestPath('/a//b', '?tab=<x>')).toBe('/a/b');
  });
  it('⚠️ 서버와 같은 규칙 — 남기는 쿼리 이름·값 형식이 두 곳에서 같다', () => {
    const server = readFileSync(resolve(__dirname, '../../../backend/src/lib/guestActivity.ts'), 'utf8');
    expect(server).toMatch(/KEEP_QUERY = \['tab', 'work'\]/);
    expect(server).toContain('/^[A-Za-z0-9_-]{1,40}$/');
    const client = readFileSync(resolve(__dirname, '../lib/guestActivity.ts'), 'utf8');
    expect(client).toContain("for (const k of ['tab', 'work'])");
    expect(client).toContain('/^[A-Za-z0-9_-]{1,40}$/');
    // 화면이 붙이는 단계 이름을 서버가 안다
    expect(server).toContain("'/auth/register'");
    // 한 번에 보내는 화면 수 = 서버가 받는 수(크면 서버가 뒤를 버린다)
    expect(server).toMatch(new RegExp(`GUEST_MAX_BATCH = ${MAX_BATCH};`));
  });
});

describe('GuestTracker — 기록기', () => {
  it('바로 나감: 첫 화면 8초 → 닫기. 3초에 미리 한 번, 닫을 때 떠남과 함께 8초', () => {
    const { t, sent, advance } = rig();
    t.navigate('/exhibitions/7');
    advance(8000);
    t.hidden(true);
    expect(sent.map((b) => b.views.map((v) => [v.seq, v.path, v.ms]))).toEqual([[[0, '/exhibitions/7', 3000]], [[0, '/exhibitions/7', 8000]]]);
    expect(sent[1].left).toBe(true);
    expect(new Set(sent.map((b) => b.visitId)).size).toBe(1);
  });

  it('곧바로 넘어간 화면(0.7초 미만 — 주소 정리·로그인으로 보내기)은 남기지 않고 순번도 쓰지 않는다', () => {
    const { t, sent, advance } = rig();
    t.navigate('/explore');
    advance(100);
    t.navigate('/artists');
    advance(4000);
    t.hidden();
    expect(lastViews(sent).map((v) => [v.seq, v.path])).toEqual([[0, '/artists'], [0, '/artists']]);
  });

  it('머문 시간은 보이는 동안만 — 가려진 동안은 세지 않는다', () => {
    const { t, sent, advance, setVisible } = rig();
    t.navigate('/');
    advance(5000);
    setVisible(false); t.hidden();
    advance(60_000);
    setVisible(true); t.shown();
    advance(5000);
    t.navigate('/artists');
    advance(6000);   // 5초 묶음 보내기
    const home = lastViews(sent).filter((v) => v.path === '/').pop()!;
    expect(home.ms).toBe(10_000);
  });

  it('띄워 둔 탭으로 몇 시간 뒤 돌아와도 같은 방문 — 그 화면을 새 첫 화면으로 치지 않는다', () => {
    // 2026-10-04 사용자 결정: 예전엔 30분 쉬면 새 방문이라, 돌아와서 보던 화면(모집공고)이 '처음 본 화면'에 섞였다
    const { t, sent, advance, setVisible } = rig();
    t.navigate('/exhibitions/7');
    advance(4000);
    t.navigate('/exhibitions');
    advance(3000);
    setVisible(false); t.hidden();
    advance(5 * 3600_000);
    setVisible(true); t.shown();
    advance(8000);
    t.navigate('/artists');
    advance(6000);
    t.hidden(true);
    expect(new Set(sent.map((b) => b.visitId)).size).toBe(1);
    const bySeq = new Map<number, { path: string; ms: number }>();
    for (const v of lastViews(sent)) bySeq.set(v.seq, v);
    expect([...bySeq.entries()].sort((a, b) => a[0] - b[0]).map(([s, v]) => [s, v.path])).toEqual([[0, '/exhibitions/7'], [1, '/exhibitions'], [2, '/artists']]);
    expect(bySeq.get(1)!.ms).toBe(11_000);   // 쉰 다섯 시간은 안 들어가고 보인 시간(3초 + 8초)만
  });

  it('로그인하면 마지막 화면과 함께 \'로그인\'으로 닫고, 그 뒤 화면은 남기지 않는다', () => {
    const { t, sent, advance } = rig();
    t.navigate('/exhibitions');
    advance(4000);
    t.navigate('/login');
    advance(3000);
    t.finish('LOGIN');
    const last = sent[sent.length - 1];
    expect(last.outcome).toBe('LOGIN');
    expect(last.views.map((v) => v.path)).toContain('/login');
    const n = sent.length;
    t.navigate('/mypage');
    advance(10_000);
    t.hidden(true);
    expect(sent.length).toBe(n);
    expect(t.active).toBe(false);
  });

  it('화면을 빨리 옮기면 5초에 한 번만 보낸다 — 순번은 본 순서대로', () => {
    const { t, sent, advance } = rig();
    t.navigate('/');
    advance(3500);   // 미리 보내기 한 번
    const before = sent.length;
    t.navigate('/artists'); advance(1000);
    t.navigate('/galleries'); advance(1000);
    t.navigate('/shows'); advance(1000);
    expect(sent.length - before).toBeLessThanOrEqual(1);
    advance(6000);
    t.hidden(true);
    const bySeq = new Map<number, string>();
    for (const v of lastViews(sent)) bySeq.set(v.seq, v.path);
    expect([...bySeq.entries()].sort((a, b) => a[0] - b[0]).map(([, p]) => p)).toEqual(['/', '/artists', '/galleries', '/shows']);
  });

  it('가려짐과 떠남이 잇달아 와도 같은 화면 값을 두 번 보내지 않는다 — 떠남만 따로', () => {
    const { t, sent, advance } = rig();
    t.navigate('/community/3');
    advance(40_000);
    const n = sent.length;
    t.hidden();
    t.hidden(true);
    expect(sent.length).toBe(n + 2);
    expect(sent[n].views).toHaveLength(1);
    expect(sent[n + 1]).toMatchObject({ views: [], left: true });
  });

  it('새로고침·카카오에서 돌아오면 같은 방문을 잇는다 — 순번이 이어지고 첫 화면을 미리 보낸다', () => {
    const { t, sent, advance } = rig({ stored: { id: 'visit-kept0000000000', seq: 3, last: 1_000_000 - 60_000 } });
    t.navigate('/auth/kakao/callback');
    advance(3500);
    expect(sent[0]).toMatchObject({ visitId: 'visit-kept0000000000', views: [{ seq: 3, path: '/auth/kakao/callback' }] });
    t.navigate('/auth/register');
    advance(20_000);
    t.finish('SIGNUP');
    expect(sent[sent.length - 1]).toMatchObject({ outcome: 'SIGNUP', views: [{ seq: 4, path: '/auth/register' }] });
  });

  it('오래 띄워 둔 탭을 새로고침해도 같은 방문을 잇는다(쉬는 시간으로 끊지 않는다)', () => {
    const { t, sent, advance } = rig({ stored: { id: 'visit-kept0000000000', seq: 2, last: 1_000_000 - 3 * 86400_000 } });
    t.navigate('/exhibitions');
    advance(3500);
    expect(sent[0]).toMatchObject({ visitId: 'visit-kept0000000000', views: [{ seq: 2, path: '/exhibitions' }] });
  });

  it('뒤로가기 캐시에서 되살아나면 같은 화면을 새 순번으로 — 서버가 떠남을 지울 수 있게', () => {
    const { t, sent, advance } = rig();
    t.navigate('/artists');
    advance(5000);
    t.hidden(true);
    t.restored();
    advance(3500);
    expect(lastViews(sent).map((v) => [v.seq, v.path]).slice(-1)).toEqual([[1, '/artists']]);
  });

  it(`한 방문에 화면 ${MAX_VIEWS}개까지 — 그 뒤는 보내지 않는다`, () => {
    const { t, sent, advance } = rig();
    for (let i = 0; i < MAX_VIEWS + 20; i++) { t.navigate(`/community/${i}`); advance(1000); }
    t.hidden(true);
    const seqs = new Set(lastViews(sent).map((v) => v.seq));
    expect(Math.max(...seqs)).toBe(MAX_VIEWS - 1);
    expect(seqs.size).toBe(MAX_VIEWS);
  });

  it(`한 번에 ${MAX_BATCH}개까지 — 넘치면 나눠 보내고, 로그인 표시는 마지막 묶음에`, () => {
    const { t, sent, advance } = rig();
    // 5초 묶음 안에서 화면을 많이 넘기면 한 번에 보낼 것이 쌓인다
    t.navigate('/'); advance(3500);
    const before = sent.length;
    for (let i = 0; i < 24; i++) { t.navigate(`/community/${i}`); advance(150 + 700); }
    t.finish('LOGIN');
    const after = sent.slice(before);
    expect(after.every((b) => b.views.length <= MAX_BATCH)).toBe(true);
    expect(after.filter((b) => b.outcome).length).toBe(1);
    expect(after[after.length - 1].outcome).toBe('LOGIN');
    expect(new Set(after.flatMap((b) => b.views.map((v) => v.path))).size).toBeGreaterThanOrEqual(24);
  });

  it('보내기가 실패해도(던져도) 기록기는 던지지 않는다 — 화면이 죽지 않는다', () => {
    const { t, sent, advance } = rig({ sendThrows: true });
    expect(() => { t.navigate('/'); advance(4000); t.navigate('/artists'); advance(6000); t.hidden(true); }).not.toThrow();
    expect(sent.length).toBeGreaterThan(0);
  });

  it('로그인한 적 있는 브라우저·검색 로봇은 기록하지 않는다', () => {
    const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 340.0';
    expect(guestTrackingAllowed(ua, false)).toBe(true);
    expect(guestTrackingAllowed(ua, true)).toBe(false);
    expect(guestTrackingAllowed('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', false)).toBe(false);
    expect(guestTrackingAllowed('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/131.0 Safari/537.36', false)).toBe(true);
    expect(guestTrackingAllowed('Mozilla/5.0 (compatible; Yeti/1.1; +https://naver.me/spd)', false)).toBe(false);
    // 네이버 앱 인앱 브라우저는 사람이다
    expect(guestTrackingAllowed('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 NAVER(inapp; search; 2000; 12.6.4)', false)).toBe(true);
  });
});

describe('카카오 인증 뒤 콜백이 다른 탭에서 열려도 같은 방문 (2026-10-04)', () => {
  // 실서버에 '카카오 로그인 3초 → 로그인 1초 → 카카오 로그인 1초 → 가입 정보 입력 → 가입 완료' — 콜백에서 시작한 방문이 남았다.
  // 새 탭은 sessionStorage 가 비어 새 방문을 열었고, 광고로 들어와 공모를 본 원래 방문은 '로그인 앞에서 나감'으로 따로 남았다.
  const STATE = 'aaaaaaaa-1111-4111-8111-111111111111';
  const T = 1_800_000_000_000;

  it('handoff — 떠나는 탭 몫을 남기고 그 뒤 순번을 넘긴다 · 이 탭은 그대로(같은 탭으로 돌아오면 순번을 건너뛰지 않는다)', () => {
    const { t, sent, advance, stored } = rig();
    t.navigate('/exhibitions/7'); advance(4000);
    t.navigate('/login'); advance(1500);
    const h = t.handoff()!;
    expect(h.id).toBe(stored()!.id);
    expect(h.seq).toBe(stored()!.seq + HANDOFF_SEQ_GAP);
    t.hidden(true);   // 카카오로 떠난다
    // 같은 탭으로 돌아왔다(보통) — 저장된 방문을 그대로 잇는다
    const back = rig({ stored: stored() });
    back.t.navigate('/auth/kakao/callback'); back.advance(3500);
    const loginSeq = lastViews(sent).find((v) => v.path === '/login')!.seq;
    expect(back.sent[0].views[0]).toMatchObject({ seq: loginSeq + 1, path: '/auth/kakao/callback' });
  });

  it('다른 탭이 이어받으면 같은 방문 번호 · 순번은 로그인 화면 뒤 · 가입으로 닫힌다', () => {
    const tab1 = rig();
    tab1.t.navigate('/exhibitions/7'); tab1.advance(4000);
    tab1.t.navigate('/login'); tab1.advance(1500);
    const h = tab1.t.handoff()!;
    tab1.t.hidden(true);
    const raw = JSON.stringify({ state: STATE, id: h.id, seq: h.seq, at: T });
    const adopted = readHandoff(raw, '/auth/kakao/callback', `?code=x&state=${STATE}`, T + 30_000);
    expect(adopted.drop).toBe(true);
    const tab2 = rig({ stored: adopted.visit });   // 새 탭 — 자기 방문이 없어 넘겨 둔 방문을 읽는다
    tab2.t.navigate('/auth/kakao/callback'); tab2.advance(1200);
    tab2.t.navigate('/auth/register'); tab2.advance(23_000);
    tab2.t.finish('SIGNUP');
    const all = [...tab1.sent, ...tab2.sent];
    expect(new Set(all.map((b) => b.visitId))).toEqual(new Set([h.id]));
    const bySeq = new Map<number, string>();
    for (const v of all.flatMap((b) => b.views)) bySeq.set(v.seq, v.path);
    expect([...bySeq.entries()].sort((a, b) => a[0] - b[0]).map(([, p]) => p)).toEqual(['/exhibitions/7', '/login', '/auth/kakao/callback', '/auth/register']);
    expect(Math.max(...[...bySeq.keys()].filter((k) => bySeq.get(k) === '/login'))).toBeLessThan(h.seq);
    expect(tab2.sent[tab2.sent.length - 1].outcome).toBe('SIGNUP');
  });

  it('readHandoff — 그 로그인의 콜백(state 가 같다)에서만 이어받는다 · 다른 화면에선 그대로 둔다 · 오래됐거나 망가졌으면 지운다', () => {
    const raw = JSON.stringify({ state: STATE, id: 'visit-kept0000000000', seq: 21, at: T });
    expect(readHandoff(raw, '/auth/kakao/callback', `?code=x&state=${STATE}`, T + 1000)).toEqual({ visit: { id: 'visit-kept0000000000', seq: 21, last: T + 1000 }, drop: true });
    // 남이 만든 콜백 주소(다른 state) · state 없음 — 이어받지 않는다(아직 카카오에 가 있을 수 있으니 지우지도 않는다)
    expect(readHandoff(raw, '/auth/kakao/callback', '?code=x&state=other-state-000000', T)).toEqual({ visit: null, drop: false });
    expect(readHandoff(raw, '/auth/kakao/callback', '?code=x', T)).toEqual({ visit: null, drop: false });
    // 콜백이 아닌 화면 — 다른 탭을 새로 열었다
    expect(readHandoff(raw, '/exhibitions', `?state=${STATE}`, T)).toEqual({ visit: null, drop: false });
    // 오래됐다 · 망가졌다 · 방문 번호 형식이 아니다 · 순번이 범위 밖
    expect(readHandoff(raw, '/auth/kakao/callback', `?state=${STATE}`, T + HANDOFF_TTL_MS + 1)).toEqual({ visit: null, drop: true });
    expect(readHandoff('{oops', '/auth/kakao/callback', `?state=${STATE}`, T)).toEqual({ visit: null, drop: true });
    expect(readHandoff(JSON.stringify({ state: STATE, id: '<script>', seq: 1, at: T }), '/auth/kakao/callback', `?state=${STATE}`, T).visit).toBeNull();
    expect(readHandoff(JSON.stringify({ state: STATE, id: 'visit-kept0000000000', seq: MAX_VIEWS, at: T }), '/auth/kakao/callback', `?state=${STATE}`, T).visit).toBeNull();
    expect(readHandoff(null, '/auth/kakao/callback', `?state=${STATE}`, T)).toEqual({ visit: null, drop: false });
  });

  it(`순번이 끝에 가까우면(${MAX_VIEWS} - ${HANDOFF_SEQ_GAP} 이상) 넘기지 않는다 · 방문이 없거나 멈췄으면 null`, () => {
    const near = rig({ stored: { id: 'visit-kept0000000000', seq: MAX_VIEWS - HANDOFF_SEQ_GAP, last: 1_000_000 } });
    near.t.navigate('/login'); near.advance(1000);
    expect(near.t.handoff()).toBeNull();
    const fresh = rig();
    expect(fresh.t.handoff()).toBeNull();   // 아직 본 화면이 없다
    fresh.t.navigate('/login'); fresh.advance(1000);
    fresh.t.finish('LOGIN');
    expect(fresh.t.handoff()).toBeNull();
  });
});

describe('붙이는 곳 — 소스 가드', () => {
  const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');
  it('App 맨 위에서 로그인 상태를 넘겨 부른다 · 그 effect·이벤트·타이머는 전부 safely 로 감싼다(던지면 화면 전체가 죽는다)', () => {
    expect(read('App.tsx')).toMatch(/useGuestActivity\(isAuthenticated\)/);
    const src = read('lib/guestActivity.ts');
    expect(src.match(/useEffect\(\(\) => safely\(/g)?.length).toBe(2);
    expect(src).toContain('setTimeout(() => safely(fn), ms)');
    for (const ev of ["'visibilitychange', () => safely(", "'pagehide', () => safely(", "'pageshow', (e) => safely("]) expect(src).toContain(ev);
  });
  it('카카오로 떠나기 직전 방문을 넘기고(startKakaoLogin), 새 탭은 콜백에서 그걸 읽는다 — 방문 번호는 브라우저 저장소에만(카카오로 보내지 않는다)', () => {
    const src = read('lib/guestActivity.ts');
    expect(src).toMatch(/readHandoff\(storageGet\(local, HANDOFF_KEY\), window\.location\.pathname, window\.location\.search, Date\.now\(\)\)/);
    expect(src).toContain('return memoryVisit ?? handoff.visit;');
    expect(read('lib/kakaoLogin.ts')).toContain('noteGuestOAuthStart(state)');
    // 카카오로 보내는 주소에 방문 번호가 실리지 않는다 — 주소는 state·돌아올 주소만으로 만든다(oauthState.test 가 쿼리 이름을 센다)
    expect(read('lib/kakaoLogin.ts')).toMatch(/kakaoAuthorizeUrl\(state, window\.location\.origin\)/);
    expect(read('lib/kakaoLogin.ts')).not.toMatch(/artlink-guest|\.handoff\(/);
  });
  it('카카오 가입: 가입 정보 입력 단계를 남기고, 가입을 마치면 로그인보다 먼저 표시한다', () => {
    const src = read('pages/AuthCallbackPage.tsx');
    expect(src).toContain("noteGuestStep('/auth/register')");
    expect(src).toMatch(/onSuccess: \(data\) => \{ noteGuestSignup\(\); return handleSuccess\(data\); \}/);
  });
  it('개인정보처리방침에 적었다 — 수집 항목과 보관 기간', () => {
    const src = read('pages/PrivacyPage.tsx');
    expect(src).toContain('로그인하지 않은 방문의 화면 이용 기록');
    expect(src).toContain('90일 뒤 자동 삭제');
  });
});

describe('통계 글자', () => {
  it('머문 시간', () => {
    expect(fmtDuration(0)).toBe('0초');
    expect(fmtDuration(45)).toBe('45초');
    expect(fmtDuration(60)).toBe('1분');
    expect(fmtDuration(65)).toBe('1분 5초');
    expect(fmtDuration(3600)).toBe('1시간');
    expect(fmtDuration(3725)).toBe('1시간 2분');
  });
  it('비율 · 화면 한 칸 · 끝맺음 · 시각(한국 시간)', () => {
    expect(pct(1, 3)).toBe(33);
    expect(pct(5, 0)).toBe(0);
    expect(stepText({ label: '작가 홈페이지', detail: '김작가', tab: '약력', work: false, seconds: 5, repeat: 1 })).toBe('작가 홈페이지 「김작가」 · 약력');
    expect(stepText({ label: '작가 홈페이지', detail: null, tab: null, work: true, seconds: 8, repeat: 3 })).toBe('작가 홈페이지 · 작품 크게 보기 ×3');
    expect(visitEnd({ outcome: 'SIGNUP', ongoing: true })).toBe('가입 완료');
    expect(visitEnd({ outcome: 'LOGIN', ongoing: false })).toBe('로그인 완료');
    expect(visitEnd({ outcome: null, ongoing: true })).toBe('아직 보는 중일 수 있음');
    expect(visitEnd({ outcome: null, ongoing: false })).toBe('나감');
    expect(visitTime('2026-10-03T15:30:00.000Z')).toBe('10/4 00:30');
  });
});
