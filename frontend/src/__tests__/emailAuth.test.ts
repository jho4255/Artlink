/**
 * 이메일 가입(아티스트·갤러리·일반) · 비밀번호 찾기 · 이메일 로그인 (2026-10-08) — lib/emailAuth.ts + 화면이 붙는 자리.
 * 서버 규칙은 backend lib/emailCode.ts · routes/auth.ts. 서버가 거절할 비밀번호를 화면이 통과시키면 함정이라 같은 문구·규칙인지 대조한다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { authErrorMessage, cleanCodeInput, formatRemaining, looksLikeEmail, passwordProblem, PHONE_RE } from '@/lib/emailAuth';

const root = join(__dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(root, p), 'utf-8');

describe('비밀번호 규칙 — 서버와 같다', () => {
  it('8자 이상 · 영문과 숫자 · 72바이트까지', () => {
    expect(passwordProblem('abc12345')).toBeNull();
    expect(passwordProblem('abc1234')).toMatch(/8자/);
    expect(passwordProblem('abcdefgh')).toMatch(/영문과 숫자/);
    expect(passwordProblem('12345678')).toMatch(/영문과 숫자/);
    expect(passwordProblem('a1'.repeat(37))).toMatch(/너무 길어요/);
    expect(passwordProblem('가나다라a1234')).toBeNull();   // 한글이 섞여도 된다(바이트로 잰다)
  });
  it('서버 소스에 같은 문구가 있다', () => {
    const server = read('backend/src/lib/emailCode.ts');
    for (const pw of ['abc1234', 'abcdefgh', 'a1'.repeat(37)]) {
      expect(server).toContain(passwordProblem(pw)!);
    }
    expect(server).toMatch(/Buffer\.byteLength\(pw, 'utf8'\) > 72/);
  });
  it('휴대폰 형식도 서버와 같다', () => {
    expect(read('backend/src/routes/auth.ts')).toContain(PHONE_RE.source);
    expect(PHONE_RE.test('010-1234-5678')).toBe(true);
    expect(PHONE_RE.test('02-123-4567')).toBe(false);
  });
});

describe('입력 다듬기', () => {
  it('인증번호 칸은 숫자 6자리만(띄어 복사해도 된다)', () => {
    expect(cleanCodeInput('123 456')).toBe('123456');
    expect(cleanCodeInput('12a3-4567')).toBe('123456');
  });
  it('남은 시간', () => {
    expect(formatRemaining(9 * 60_000 + 5_000)).toBe('9:05');
    expect(formatRemaining(-1)).toBe('0:00');
  });
  it('주소 모양', () => {
    expect(looksLikeEmail(' gallery@naver.com ')).toBe(true);
    expect(looksLikeEmail('gallery@naver')).toBe(false);
  });
  it('서버가 준 이유를 그대로, 한도 초과(영어 글)는 우리말로', () => {
    expect(authErrorMessage({ response: { status: 409, data: { error: '카카오로 로그인해 주세요.' } } }, 'x')).toBe('카카오로 로그인해 주세요.');
    expect(authErrorMessage({ response: { status: 429, data: 'Too many requests, please try again later.' } }, 'x')).toMatch(/너무 많아요/);
    expect(authErrorMessage({}, '기본')).toBe('기본');
  });
});

describe('화면이 붙는 자리 — 되돌아가지 않게', () => {
  it('새 화면 셋이 라우트에 있다(회원가입 · 이메일 가입 · 비밀번호 찾기)', () => {
    const app = read('frontend/src/App.tsx');
    expect(app).toMatch(/path="\/signup" element=\{<SignupPage \/>\}/);
    expect(app).toMatch(/path="\/signup\/email" element=\{<EmailSignupPage \/>\}/);
    expect(app).toMatch(/path="\/password\/reset" element=\{<PasswordResetPage \/>\}/);
  });

  it('로그인 화면 — 역할을 묻지 않는다: [카카오로 로그인] · 이메일 로그인 · [비밀번호 찾기] · 따로 [회원가입](2026-10-08 사용자 결정)', () => {
    const login = read('frontend/src/pages/LoginPage.tsx');
    expect(login).not.toMatch(/RoleChoice|radiogroup/);                     // 로그인하면 가입했던 계정 그대로 — 고를 것이 없다
    expect(login).toMatch(/<KakaoLoginButton label="카카오로 로그인" \/>/);
    expect(login).toMatch(/api\.post\('\/auth\/login'/);
    expect(login).toMatch(/to="\/password\/reset"/);
    expect(login).toMatch(/to="\/signup"/);
    // 이메일 로그인도 카카오·개발자 로그인과 같은 길(enter)로 들어간다 — 돌아갈 곳·홈페이지 팝업 예약이 한 곳에서
    expect(login).toMatch(/rememberEmailLogin\(data\.user\.email\);\s*await enter\(data\);/);
  });

  it('회원가입 화면 — 역할을 고르면 [카카오로 가입하기](고른 역할을 적어 두고 떠난다) · [이메일로 가입하기](?role=)', () => {
    const page = read('frontend/src/pages/SignupPage.tsx');
    expect(page).toMatch(/<RoleChoice value=\{role\}/);
    expect(page).toMatch(/\{role && \(/);                                  // 고르기 전에는 가입 버튼이 없다
    expect(page).toMatch(/<KakaoLoginButton label="카카오로 가입하기" onStart=\{\(\) => stashSignupRole\(role\)\} \/>/);
    expect(page).toMatch(/to=\{`\/signup\/email\?role=\$\{role\}`\}/);
    expect(page).toMatch(/contextSignupRole\(peekPostLoginRedirect\(\)\)/);   // 지원·초대 코드로 오면 아티스트
  });

  it('카카오 가입 정보 입력이 로그인 화면에서 고른 역할을 이어받는다', () => {
    const cb = read('frontend/src/pages/AuthCallbackPage.tsx');
    expect(cb).toMatch(/useState<'ARTIST' \| 'GALLERY' \| 'VISITOR'>\(\(\) => peekSignupRole\(\) \?\? 'ARTIST'\)/);
    expect(cb).toMatch(/const handleSuccess = async[\s\S]{0,80}clearSignupRole\(\);/);
  });

  it('이메일 가입 — 역할을 고르고(로그인 화면에서 넘어온 역할) 비회원 둘러보기에 \'가입\'을 먼저 남긴 뒤 로그인한다', () => {
    const page = read('frontend/src/pages/EmailSignupPage.tsx');
    const a = page.indexOf('noteGuestSignup();');
    const b = page.indexOf('login(data.token, data.user);');
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);   // 순서가 바뀌면 이 방문이 LOGIN 으로 닫힌다
    expect(page).toMatch(/api\.post\('\/auth\/email-signup'/);
    expect(page).toMatch(/<RoleChoice value=\{role\}/);
    expect(page).toMatch(/searchParams\.get\('role'\)/);
    expect(page).toMatch(/<SignupConsent/);
  });

  it('가입 동의는 카카오 가입과 같은 부품', () => {
    expect(read('frontend/src/pages/AuthCallbackPage.tsx')).toMatch(/<SignupConsent/);
  });

  it('가입 동의 — 회색 요약 문구 없이, 전문을 끝까지 읽어야 체크된다(2026-10-08 사용자 결정)', () => {
    const c = read('frontend/src/components/shared/SignupConsent.tsx');
    // 예전 요약 두 줄(자동 처리 사항 · 수집 항목)은 되살리지 않는다 — 전문을 읽게 하는 게 그 일을 대신한다
    expect(c).not.toContain('정산 무응답 3일 자동 수락');
    expect(c).not.toContain('수집합니다');
    expect(c).not.toContain('privacyNote');
    // 읽기 전에 누르면 체크하지 않고 그 칸으로 데려간다(전체 동의도)
    expect(c).toMatch(/if \(checked && !read\[d\]\) \{ point\(d\); return; \}/);
    expect(c).toMatch(/const unread = \(\['terms', 'privacy'\] as Doc\[\]\)\.find\(\(d\) => !read\[d\]\);/);
    // 본문은 /terms · /privacy 화면과 같은 컴포넌트 — 문구가 어긋나지 않게
    expect(c).toContain('<TermsBody compact />');
    expect(c).toContain('<PrivacyBody compact />');
    expect(read('frontend/src/pages/TermsPage.tsx')).toMatch(/<TermsBody \/>/);
    expect(read('frontend/src/pages/PrivacyPage.tsx')).toMatch(/<PrivacyBody \/>/);
  });

  it('인증번호 칸 — 바깥 가입 폼이 Enter 로 제출되지 않는다', () => {
    const field = read('frontend/src/components/shared/EmailVerifyField.tsx');
    expect((field.match(/e\.preventDefault\(\); void (send|check)\(\);/g) ?? []).length).toBe(2);
    expect(field).not.toMatch(/type="submit"/);
  });
});
