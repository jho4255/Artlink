import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  hideMemberIntro, introAllowedAt, isIntroHiddenHere, introAudience, introDefaultSide, introForced, introReturnPath, introSignupHref, isIntroAnswered,
  isMemberIntroHidden, isMemberIntroSeenToday, markIntroAnswered, markMemberIntroDay, memberIntroAudience, rememberIntroReturn,
} from '@/lib/guestIntro';

// 소개 팝업 'Welcome to ArtLink!' — 언제·누구에게 (2026-10-18, lib/guestIntro.ts). 브라우저 동작은 scratchpad/guest-intro/walk.mjs(크롬+WebKit × PC·휴대폰·SE)
const SRC = resolve(__dirname, '..');
const read = (f: string) => readFileSync(resolve(SRC, f), 'utf8');

describe('어디서 띄우나', () => {
  it('광고가 보내는 화면 — 홈·공모·작가·갤러리·전시·홈페이지·커뮤니티', () => {
    for (const p of ['/', '/exhibitions', '/exhibitions/18', '/artists', '/galleries', '/galleries/3', '/shows/2', '/portfolio/7', '/@my.studio', '/community', '/community/5'])
      expect(introAllowedAt(p), p).toBe(true);
  });
  it('그 일을 하러 온 화면·로그인이 필요한 화면은 뺀다', () => {
    for (const p of ['/login', '/signup', '/signup/email', '/password/reset', '/auth/kakao/callback', '/join/ABCD2345', '/exhibitions/18/apply',
      '/exhibitions/18/operation/new', '/terms', '/privacy', '/mypage', '/messages', '/feed', '/galleries/new', '/exhibitions/new', '/shows/new', '/community/write'])
      expect(introAllowedAt(p), p).toBe(false);
  });
});

describe('누구에게 띄우나', () => {
  const base = { authenticated: false, hiddenHere: false, ua: 'Mozilla/5.0 (iPhone)', webdriver: false, answered: false };
  it('처음 온 비회원 · 로그인한 적 있는 브라우저(로그아웃 상태)도 뜬다', () => expect(introAudience(base)).toBe(true));
  it('로그인했으면 이 규칙이 아니다(회원 규칙) · 이 브라우저에서 누군가 [다시 보지 않기] 를 눌렀으면 로그아웃 상태에서도 안 뜬다', () => {
    expect(introAudience({ ...base, authenticated: true })).toBe(false);
    expect(introAudience({ ...base, hiddenHere: true })).toBe(false);
  });
  it('이미 답했으면 아니다', () => expect(introAudience({ ...base, answered: true })).toBe(false));
  it('검색 로봇·자동화(E2E·점검 하니스)는 아니다', () => {
    expect(introAudience({ ...base, ua: 'Mozilla/5.0 (compatible; Googlebot/2.1)' })).toBe(false);
    expect(introAudience({ ...base, webdriver: true })).toBe(false);
  });
});

describe('회원 — 하루 한 번, [다시 보지 않기] 를 누르면 다시 안 뜬다', () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });
  const base = { role: 'ARTIST', hidden: false, seenToday: false, ua: 'Mozilla/5.0 (iPhone)', webdriver: false };
  it('작가·갤러리·일반 회원에게 뜬다 — 관리자는 아니다', () => {
    for (const role of ['ARTIST', 'GALLERY', 'VISITOR']) expect(memberIntroAudience({ ...base, role }), role).toBe(true);
    expect(memberIntroAudience({ ...base, role: 'ADMIN' })).toBe(false);
  });
  it('다시 보지 않기 · 오늘 이미 봤음 · 로봇 · 자동화는 아니다', () => {
    expect(memberIntroAudience({ ...base, hidden: true })).toBe(false);
    expect(memberIntroAudience({ ...base, seenToday: true })).toBe(false);
    expect(memberIntroAudience({ ...base, webdriver: true })).toBe(false);
    expect(memberIntroAudience({ ...base, ua: 'Googlebot/2.1' })).toBe(false);
  });
  it('[다시 보지 않기] 는 그 계정만 — 로그아웃 상태에서도 이 브라우저에선 지킨다', () => {
    expect(isIntroHiddenHere()).toBe(false);
    hideMemberIntro(7);
    expect(isMemberIntroHidden(7)).toBe(true);
    expect(isMemberIntroHidden(8)).toBe(false);
    expect(isIntroHiddenHere()).toBe(true);
  });
  it('닫으면 그날만 — KST 날짜가 바뀌면 다시', () => {
    const day1 = Date.parse('2026-10-18T10:00:00+09:00');
    markMemberIntroDay(7, day1);
    expect(isMemberIntroSeenToday(7, day1 + 3600_000)).toBe(true);
    expect(isMemberIntroSeenToday(7, Date.parse('2026-10-19T00:30:00+09:00'))).toBe(false);
    expect(isMemberIntroSeenToday(8, day1)).toBe(false);
  });
  it('이 탭에서 오늘 로그인 전에 소개에 답했으면(방금 가입) 그날은 회원에게도 안 띄운다', () => {
    const now = Date.parse('2026-10-18T15:00:00+09:00');
    markIntroAnswered(now - 600_000);
    expect(isMemberIntroSeenToday(9, now)).toBe(true);
    expect(isMemberIntroSeenToday(9, Date.parse('2026-10-19T12:00:00+09:00'))).toBe(false);
  });
});

describe('작가 · 갤러리', () => {
  it('처음 펼칠 쪽 — 갤러리 회원은 갤러리, 그 밖(비회원 포함)은 작가', () => {
    expect(introDefaultSide('GALLERY')).toBe('gallery');
    for (const r of ['ARTIST', 'VISITOR', null, undefined]) expect(introDefaultSide(r)).toBe('artist');
  });
  it('[무료로 시작하기] 는 보고 있던 쪽의 역할을 골라 둔 가입 화면으로', () => {
    expect(introSignupHref('artist')).toBe('/signup?role=ARTIST');
    expect(introSignupHref('gallery')).toBe('/signup?role=GALLERY');
  });
});

describe('미리보기 ?intro=1', () => {
  it('주소에 intro=1 이 있으면 조건과 상관없이 띄운다(운영자 확인용)', () => {
    expect(introForced('?intro=1')).toBe(true);
    expect(introForced('?tab=cv&intro=1')).toBe(true);
    expect(introForced('')).toBe(false);
    expect(introForced('?intro=0')).toBe(false);
  });
});

describe('답한 기록 · 가입 뒤 돌아올 곳', () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });
  it('답하면 이 탭에만 남는다 — 새 탭·다음 방문엔 다시 뜬다', () => {
    expect(isIntroAnswered()).toBe(false);
    markIntroAnswered();
    expect(isIntroAnswered()).toBe(true);
    expect(sessionStorage.getItem('artlink-intro-guest-answered')).toBeTruthy();
    expect(localStorage.getItem('artlink-intro-guest-answered')).toBeNull();   // 탭(방문)마다 한 번 — 브라우저에 남기지 않는다
  });
  it('공모 상세에서 가입하러 가면 그 공모로 돌아온다 — 다른 화면은 적지 않는다(작품 올리기로 가야 한다)', () => {
    expect(introReturnPath('/exhibitions/18', '?from=ad')).toBe('/exhibitions/18?from=ad');
    expect(introReturnPath('/exhibitions', '')).toBeNull();
    expect(introReturnPath('/', '')).toBeNull();
    expect(introReturnPath('/artists', '')).toBeNull();
  });
  it('이미 적어 둔 곳은 덮지 않는다', () => {
    sessionStorage.setItem('post_login_redirect', '/join/ABCD2345');
    rememberIntroReturn('/exhibitions/18', '');
    expect(sessionStorage.getItem('post_login_redirect')).toBe('/join/ABCD2345');
    sessionStorage.clear();
    rememberIntroReturn('/exhibitions/18', '');
    expect(sessionStorage.getItem('post_login_redirect')).toBe('/exhibitions/18');
  });
});

describe('소스 가드', () => {
  it('Layout 에 놓여 어느 화면에서도 뜬다', () => {
    expect(read('components/layout/Layout.tsx')).toMatch(/<GuestIntro \/>/);
  });
  it("문구 — 'Welcome to ArtLink'(느낌표 없음) · 갤러리는 2027년 6월까지 무료 · 가입 화면이 ?role= 을 읽는다", () => {
    const src = read('components/shared/GuestIntro.tsx');
    expect(src).toMatch(/Welcome to <Brand \/>\n/);
    expect(src).not.toMatch(/Welcome to <Brand \/>!/);
    expect(src).toContain('갤러리 회원은 2027년 6월까지 아트링크의 모든 서비스를');
    for (const t of ['원하는 형식의 포트폴리오를 쉽고 빠르게.', '나만의 홈페이지를 꾸며보세요.', '공모 간편지원', '클릭 한번으로 원하는 공모 지원 끝.',
      '공모 운영 자동화', '지원 접수부터 출품 자료·정산까지, 클릭 한번으로.', '갤러리 홈페이지', '갤러리 홈페이지를 꾸미고 소개해주세요.', '전시 홍보', '진행중인 전시를 홍보해보세요.'])
      expect(src).toContain(t);
    expect(read('pages/SignupPage.tsx')).toMatch(/params\.get\('role'\)/);
  });
  it('회원에게는 [다시 보지 않기] — 누르면 그 계정을 숨긴다 · 홈페이지 완성 팝업이 뜨는 날엔 양보한다', () => {
    const src = read('components/shared/GuestIntro.tsx');
    expect(src).toContain('다시 보지 않기');
    expect(src).toMatch(/if \(hide\) hideMemberIntro\(member\.id\)/);
    expect(src).toContain('[data-testid="homepage-nudge"]');
    expect(src).toContain('armedHomepageNudgeUserId()');
  });
  it("'봤다'는 답할 때만 적는다 — 띄우는 effect 안에서 적지 않는다", () => {
    const src = read('components/shared/GuestIntro.tsx');
    const openEffect = src.slice(src.indexOf('const tryOpen'), src.indexOf('return () => { alive = false'));
    expect(openEffect.length).toBeGreaterThan(100);
    expect(openEffect).not.toContain('markIntroAnswered');
    expect(openEffect).not.toContain('hideMemberIntro');
    expect(src).toMatch(/const answer = \(hide = false\) => \{[\s\S]{0,400}markIntroAnswered\(\)/);
    // 미리보기는 아무것도 적지 않는다 — 적으면 미리보기를 본 브라우저에 진짜로는 다시 안 뜬다(2026-10-18 실제로 그랬다)
    expect(src).toMatch(/const answer = \(hide = false\) => \{[\s\S]{0,250}if \(!forced\) \{/);
  });
  it('그림은 실제 화면 여덟(작가 넷 · 갤러리 넷) — 작게(합 130KB 아래, 광고로 들어온 휴대폰이 받는다) · 실제 가입자 작품을 쓰지 않는다', () => {
    const dir = resolve(SRC, '../public/intro');
    const files = readdirSync(dir);
    expect(files.sort()).toEqual(['apply.webp', 'artlook.webp', 'gallery-artlook.webp', 'gallery-home.webp', 'gallery-ops.webp', 'gallery-show.webp', 'homepage.webp', 'portfolio.webp']);
    expect(files.reduce((n, f) => n + statSync(resolve(dir, f)).size, 0)).toBeLessThan(130_000);
    const src = read('components/shared/GuestIntro.tsx');
    expect(src).not.toMatch(/\/uploads\/|img\.artlink\.cc/);
    for (const f of files) expect(src).toContain(`/intro/${f}`);
  });
});
