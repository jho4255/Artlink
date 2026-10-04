/**
 * 카카오 로그인 state — 콜백이 **다른 탭**에서 열려도 맞춰지는가 (2026-10-04, `lib/oauthState.ts`)
 *
 * 실서버 비회원 통계에 `카카오 로그인 3초 → 로그인 1초 → 카카오 로그인 1초 → 가입 정보 입력 → 가입 완료` 가 남았다 —
 * 콜백이 탭 저장소가 빈 곳에서 열려 state 를 못 찾고 '보안 검증 실패' → 로그인 화면으로 튕긴 뒤 다시 눌러 가입한 것이다.
 * 지켜야 하는 것: 같은 브라우저의 다른 탭에선 맞춰진다 · 이 브라우저가 적지 않은 state 는 여전히 거절(로그인 CSRF) · 한 번만 쓴다 ·
 * 30분 뒤 버린다 · 로그인 뒤 갈 곳을 함께 옮긴다 · 저장소가 막혀도 던지지 않는다.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { newOAuthState, OAUTH_PENDING_KEY, OAUTH_PENDING_MAX, OAUTH_STATE_TTL_MS, saveOAuthState, takeOAuthState, type KV } from '@/lib/oauthState';
import { kakaoAuthorizeUrl } from '@/lib/kakaoLogin';

function mem(): KV & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, String(v)); }, removeItem: (k) => { data.delete(k); } };
}
const broken: KV = {
  getItem: () => { throw new Error('SecurityError'); },
  setItem: () => { throw new Error('QuotaExceededError'); },
  removeItem: () => { throw new Error('SecurityError'); },
};
const S1 = 'aaaaaaaa-1111-4111-8111-111111111111';
const S2 = 'bbbbbbbb-2222-4222-8222-222222222222';
const T0 = 1_800_000_000_000;

describe('takeOAuthState — 돌아와서 맞춰 보기', () => {
  it('같은 탭으로 돌아오면(보통) 맞고, 탭·브라우저 양쪽에서 지운다', () => {
    const session = mem(); const local = mem();
    saveOAuthState('kakao', S1, { now: T0, session, local, returnTo: '/exhibitions/7/apply' });
    expect(session.getItem('kakao_state')).toBe(S1);   // 옛 키 그대로
    const r = takeOAuthState('kakao', S1, { now: T0 + 5_000, session, local });
    expect(r).toEqual({ ok: true, returnTo: '/exhibitions/7/apply', otherTab: false });
    expect(session.getItem('kakao_state')).toBeNull();
    expect(local.getItem(OAUTH_PENDING_KEY)).toBeNull();
  });

  it('⚠️ 같은 브라우저의 **다른 탭**으로 돌아와도 맞는다 — 로그인 뒤 갈 곳도 함께 온다', () => {
    const tab1 = mem(); const tab2 = mem(); const local = mem();
    saveOAuthState('kakao', S1, { now: T0, session: tab1, local, returnTo: '/exhibitions/7/apply' });
    const r = takeOAuthState('kakao', S1, { now: T0 + 40_000, session: tab2, local });
    expect(r).toEqual({ ok: true, returnTo: '/exhibitions/7/apply', otherTab: true });
    // 한 번만 쓴다 — 같은 주소를 다시 열어도(새로고침·뒤로가기) 다시 맞지 않는다
    expect(takeOAuthState('kakao', S1, { now: T0 + 41_000, session: tab2, local }).ok).toBe(false);
  });

  it('이 브라우저가 적지 않은 state 는 거절한다 — 남이 만든 콜백 주소로는 로그인되지 않는다(로그인 CSRF)', () => {
    const session = mem(); const local = mem();
    saveOAuthState('kakao', S1, { now: T0, session, local });
    expect(takeOAuthState('kakao', S2, { now: T0, session, local }).ok).toBe(false);
    expect(takeOAuthState('kakao', null, { now: T0, session, local }).ok).toBe(false);
    expect(takeOAuthState('kakao', '', { now: T0, session, local }).ok).toBe(false);
    // 다른 공급자 이름으로 적힌 것과도 섞이지 않는다
    expect(takeOAuthState('naver', S1, { now: T0, session: mem(), local }).ok).toBe(false);
    // 저장된 건 그대로 남아 진짜 콜백은 맞는다
    expect(takeOAuthState('kakao', S1, { now: T0, session, local }).ok).toBe(true);
  });

  it('다른 브라우저(저장소를 나누지 않는다)로 돌아오면 못 맞춘다 — 화면이 한 번 더 누르게 한다', () => {
    saveOAuthState('kakao', S1, { now: T0, session: mem(), local: mem() });
    expect(takeOAuthState('kakao', S1, { now: T0 + 3_000, session: mem(), local: mem() })).toEqual({ ok: false, returnTo: null, otherTab: false });
  });

  it(`${OAUTH_STATE_TTL_MS / 60_000}분이 지나면 다른 탭에선 맞지 않고 정리된다(같은 탭 값은 옛날처럼 그대로)`, () => {
    const tab1 = mem(); const local = mem();
    saveOAuthState('kakao', S1, { now: T0, session: tab1, local });
    expect(takeOAuthState('kakao', S1, { now: T0 + OAUTH_STATE_TTL_MS + 1, session: mem(), local }).ok).toBe(false);
    expect(local.getItem(OAUTH_PENDING_KEY)).toBeNull();
    // 같은 탭은 탭 저장소로 맞춘다(그 전 동작과 같다)
    expect(takeOAuthState('kakao', S1, { now: T0 + OAUTH_STATE_TTL_MS + 1, session: tab1, local }).ok).toBe(true);
  });

  it(`두 탭에서 따로 시작해도 각자 맞는다 — 최근 ${OAUTH_PENDING_MAX}개까지`, () => {
    const local = mem();
    saveOAuthState('kakao', S1, { now: T0, session: mem(), local, returnTo: '/a' });
    saveOAuthState('kakao', S2, { now: T0 + 1, session: mem(), local, returnTo: '/b' });
    expect(takeOAuthState('kakao', S2, { now: T0 + 2, session: mem(), local })).toMatchObject({ ok: true, returnTo: '/b' });
    expect(takeOAuthState('kakao', S1, { now: T0 + 3, session: mem(), local })).toMatchObject({ ok: true, returnTo: '/a' });
    const states = Array.from({ length: OAUTH_PENDING_MAX + 3 }, (_, i) => `state-${String(i).padStart(20, '0')}`);
    states.forEach((s, i) => saveOAuthState('kakao', s, { now: T0 + i, session: mem(), local }));
    expect(JSON.parse(local.getItem(OAUTH_PENDING_KEY)!)).toHaveLength(OAUTH_PENDING_MAX);
    expect(takeOAuthState('kakao', states[0], { now: T0 + 100, session: mem(), local }).ok).toBe(false);
    expect(takeOAuthState('kakao', states[states.length - 1], { now: T0 + 100, session: mem(), local }).ok).toBe(true);
  });

  it('망가진 값·막힌 저장소에서도 던지지 않는다 — 로그인 버튼과 콜백 화면이 멈추면 안 된다', () => {
    const local = mem();
    local.setItem(OAUTH_PENDING_KEY, '{not json');
    expect(() => saveOAuthState('kakao', S1, { now: T0, session: broken, local: broken })).not.toThrow();
    expect(() => takeOAuthState('kakao', S1, { now: T0, session: broken, local })).not.toThrow();
    expect(takeOAuthState('kakao', S1, { now: T0, session: broken, local: broken }).ok).toBe(false);
    expect(takeOAuthState('kakao', S1, { now: T0, session: null, local: null }).ok).toBe(false);
    // 망가진 목록은 새로 적을 때 덮인다
    saveOAuthState('kakao', S2, { now: T0, session: null, local });
    expect(takeOAuthState('kakao', S2, { now: T0, session: null, local }).ok).toBe(true);
  });
});

describe('newOAuthState · 카카오 주소', () => {
  it('추측할 수 없는 값 — 매번 다르고 충분히 길다', () => {
    const xs = new Set(Array.from({ length: 50 }, () => newOAuthState()));
    expect(xs.size).toBe(50);
    for (const x of xs) expect(x.length).toBeGreaterThanOrEqual(16);
  });
  it('카카오로 보내는 주소에 state 가 실리고 돌아올 주소는 우리 콜백이다', () => {
    const u = new URL(kakaoAuthorizeUrl(S1, 'https://artlink.cc', 'CID'));
    expect(u.origin + u.pathname).toBe('https://kauth.kakao.com/oauth/authorize');
    expect(u.searchParams.get('state')).toBe(S1);
    expect(u.searchParams.get('redirect_uri')).toBe('https://artlink.cc/auth/kakao/callback');
    expect(u.searchParams.get('client_id')).toBe('CID');
    // 카카오에 가는 건 이 넷뿐 — 비회원 방문 번호 같은 우리 쪽 값은 싣지 않는다(CLAUDE.md 64: 방문 번호를 계정과 잇지 않는다)
    expect([...u.searchParams.keys()].sort()).toEqual(['client_id', 'redirect_uri', 'response_type', 'state']);
  });
});

describe('붙이는 곳 — 소스 가드', () => {
  const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');
  const all = (dir: string): string[] => {
    return readdirSync(dir).flatMap((f) => {
      const p = resolve(dir, f);
      if (statSync(p).isDirectory()) return f === '__tests__' ? [] : all(p);
      return /\.(ts|tsx)$/.test(f) ? [p] : [];
    });
  };
  it('카카오로 보내는 길은 하나(startKakaoLogin) — state 를 브라우저 저장소에 적고 비회원 방문을 넘긴 뒤 떠난다', () => {
    const src = read('lib/kakaoLogin.ts');
    const begin = src.indexOf('beginOAuthState(');
    const note = src.indexOf('noteGuestOAuthStart(state)');
    const go = src.indexOf('window.location.href');
    expect(begin).toBeGreaterThan(-1);
    expect(note).toBeGreaterThan(begin);
    expect(go).toBeGreaterThan(note);
    // 카카오 인증 주소를 다른 곳에서 손으로 만들지 않는다
    const offenders = all(resolve(__dirname, '..')).filter((p) => !p.endsWith('kakaoLogin.ts') && readFileSync(p, 'utf8').includes('kauth.kakao.com'));
    expect(offenders).toEqual([]);
    expect(read('pages/LoginPage.tsx')).toContain('<KakaoLoginButton />');
  });
  it('콜백 화면 — 탭 저장소만 보지 않고 checkOAuthState 로 맞춘다 · 못 맞추면 튕기지 않고 한 번 더 누르게 한다(자동으로 카카오에 보내지 않는다)', () => {
    const src = read('pages/AuthCallbackPage.tsx');
    expect(src).toContain('checkOAuthState(provider, state)');
    expect(src).not.toMatch(/sessionStorage\.getItem\(`\$\{provider\}_state`\)/);
    expect(src).not.toContain('보안 검증에 실패');
    expect(src).toContain('<KakaoLoginButton label="카카오로 계속하기" />');
    expect(src).not.toMatch(/startKakaoLogin\(/);   // 사용자 동작(버튼) 없이 부르지 않는다
    // 다른 탭으로 돌아왔으면 로그인 뒤 갈 곳을 되살린다 — 로그인 처리(교환)보다 먼저
    expect(src.indexOf('setPostLoginRedirect(check.returnTo)')).toBeGreaterThan(-1);
    expect(src.indexOf('setPostLoginRedirect(check.returnTo)')).toBeLessThan(src.indexOf('oauthMutation.mutate('));
  });
});
