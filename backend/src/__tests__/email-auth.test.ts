/**
 * 이메일 가입(아티스트·갤러리·일반) · 비밀번호 찾기 · 이메일 로그인 (2026-10-08 사용자 결정)
 *
 * 흐름: 인증번호 받기(`/auth/email/code`) → 확인(`/auth/email/verify`, 인증 토큰) → 가입(`/auth/email-signup`) / 재설정(`/auth/password/reset`).
 * 메일은 테스트에서 절대 나가지 않는다 — lib/mailer.ts 의 보관함(devOutbox)에서 번호를 읽는다.
 * 같은 파일에 **카카오 가입 토큰 혼동**(2026-10-08 발견) 회귀도 둔다 — 이번 작업이 같은 비밀 키로 서명하는 토큰을 하나 더 만든다.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { request, cleanDb, seedUsers, seedGallery, authToken, testPrisma } from './helpers';
import { clearDevOutbox, devOutbox, isDevFakeAddress } from '../lib/mailer';
import { codeMail, DAILY_SEND_MAX, MAX_ATTEMPTS, passwordProblem } from '../lib/emailCode';
import { LOGIN_FAIL_MAX, resetLoginThrottle } from '../lib/loginThrottle';

const CONSENT = { agreeTerms: true, agreePrivacy: true };
const PW = 'gallery2026';

/** 보관함의 가장 최근 메일에서 6자리 번호 */
function lastCode(to: string): string {
  const mail = devOutbox(to)[0];
  expect(mail, `${to} 로 간 메일이 없다`).toBeTruthy();
  const m = mail!.text.match(/인증번호: (\d{6})/);
  expect(m).toBeTruthy();
  return m![1];
}

/** 1분 다시 받기 제한을 건너뛰려고 앞 번호들을 2분 전에 만든 것으로 */
async function ageCodes(email: string) {
  await testPrisma.emailCode.updateMany({ where: { email }, data: { createdAt: new Date(Date.now() - 2 * 60_000) } });
}

async function sendCode(email: string, purpose: 'signup' | 'reset' = 'signup') {
  return request.post('/api/auth/email/code').send({ email, purpose });
}
async function verify(email: string, code: string, purpose: 'signup' | 'reset' = 'signup') {
  return request.post('/api/auth/email/verify').send({ email, purpose, code });
}
async function verifiedToken(email: string, purpose: 'signup' | 'reset' = 'signup'): Promise<string> {
  expect((await sendCode(email, purpose)).status).toBe(200);
  const res = await verify(email, lastCode(email), purpose);
  expect(res.status).toBe(200);
  return res.body.verificationToken;
}
async function signup(token: string, extra: Record<string, unknown> = {}) {
  return request.post('/api/auth/email-signup').send({ verificationToken: token, role: 'GALLERY', password: PW, name: '김갤러리', phone: '010-1234-5678', ...CONSENT, ...extra });
}

beforeEach(async () => {
  await cleanDb();
  await seedUsers();
  clearDevOutbox();
  resetLoginThrottle();
});

describe('★ 카카오 가입 토큰 자리에 다른 토큰을 넣으면 400 (2026-10-08 발견)', () => {
  const body = { role: 'ARTIST', name: 'x', email: 'fresh@probe.test', phone: '010-1234-5678', ...CONSENT };

  it('로그인 토큰을 넣으면 — 예전엔 **아무 회원**(첫 행)의 로그인 토큰이 나왔다', async () => {
    const res = await request.post('/api/auth/complete-registration').send({ ...body, tempToken: authToken(2, 'ARTIST') });
    expect(res.status).toBe(400);
    expect(res.body.token).toBeUndefined();
  });

  it('이메일 인증 토큰을 넣어도 400', async () => {
    const token = await verifiedToken('mix@probe.test');
    const res = await request.post('/api/auth/complete-registration').send({ ...body, tempToken: token });
    expect(res.status).toBe(400);
  });

  it('진짜 카카오 가입 토큰은 그대로 가입된다', async () => {
    const tempToken = jwt.sign({ provider: 'KAKAO', providerId: 'k-777', name: '카', email: null, avatar: null }, process.env.JWT_SECRET!, { expiresIn: '10m' });
    const res = await request.post('/api/auth/complete-registration').send({ ...body, tempToken });
    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe('fresh@probe.test');
  });

  it('카카오 가입도 대소문자만 다른 주소는 같은 주소로 본다', async () => {
    const tempToken = jwt.sign({ provider: 'KAKAO', providerId: 'k-778' }, process.env.JWT_SECRET!, { expiresIn: '10m' });
    const res = await request.post('/api/auth/complete-registration').send({ ...body, email: 'GALLERY@test.com', tempToken });
    expect(res.status).toBe(409);
  });
});

describe('인증번호 받기', () => {
  it('6자리 번호가 메일로 간다(제목에도 번호) — DB 에는 해시만', async () => {
    const res = await sendCode('New.Gallery@Mail.test');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ expiresInSec: 600, resendInSec: 60 });
    const mail = devOutbox('new.gallery@mail.test')[0]!;   // 소문자로 맞춰 보낸다
    expect(mail.subject).toMatch(/^\[ArtLink\] 이메일 인증번호 \d{6}$/);
    const code = lastCode('new.gallery@mail.test');
    const row = await testPrisma.emailCode.findFirstOrThrow({ where: { email: 'new.gallery@mail.test' } });
    expect(row.codeHash).not.toContain(code);
    expect(row.purpose).toBe('SIGNUP');
  });

  it('1분 안에 다시 받으면 429(몇 초 남았는지), 1시간에 5번까지', async () => {
    expect((await sendCode('cool@mail.test')).status).toBe(200);
    const again = await sendCode('cool@mail.test');
    expect(again.status).toBe(429);
    expect(again.body.error).toMatch(/초 뒤에 다시/);
    for (let i = 0; i < 4; i++) {
      await ageCodes('cool@mail.test');
      expect((await sendCode('cool@mail.test')).status).toBe(200);
    }
    await ageCodes('cool@mail.test');
    const sixth = await sendCode('cool@mail.test');
    expect(sixth.status).toBe(429);
    expect(sixth.body.error).toMatch(/1시간/);
  });

  it('동시에 여러 번 눌러도 번호는 하나만 나간다', async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => sendCode('race@mail.test')));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(await testPrisma.emailCode.count({ where: { email: 'race@mail.test' } })).toBe(1);
    expect(devOutbox('race@mail.test')).toHaveLength(1);
  });

  it('이미 가입된 주소 — 카카오 계정이면 카카오로, 비밀번호 계정이면 로그인으로 안내(대소문자 무시)', async () => {
    const kakao = await sendCode('Gallery@Test.com');   // seedUsers 의 gallery@test.com (비밀번호 없음)
    expect(kakao.status).toBe(409);
    expect(kakao.body.error).toMatch(/카카오/);
    await testPrisma.user.create({ data: { email: 'pw@mail.test', name: 'p', role: 'GALLERY', password: await bcrypt.hash(PW, 4) } });
    const pw = await sendCode('PW@mail.test');
    expect(pw.status).toBe(409);
    expect(pw.body.error).toMatch(/로그인해 주세요/);
    expect(devOutbox()).toHaveLength(0);
  });

  it('하루 전체 상한을 넘으면 503 — Gmail 하루 한도(홍보 메일과 같은 계정)를 지킨다', async () => {
    await testPrisma.emailCode.createMany({
      data: Array.from({ length: DAILY_SEND_MAX }, (_, i) => ({ email: `flood${i}@mail.test`, purpose: 'SIGNUP', codeHash: 'x', expiresAt: new Date(Date.now() + 60_000) })),
    });
    const res = await sendCode('late@mail.test');
    expect(res.status).toBe(503);
    expect(devOutbox('late@mail.test')).toHaveLength(0);
    // 하루 지난 줄은 세지 않는다
    await testPrisma.emailCode.updateMany({ data: { createdAt: new Date(Date.now() - 25 * 3600_000) } });
    expect((await sendCode('late@mail.test')).status).toBe(200);
  });

  it('형식이 틀린 주소·목적은 400', async () => {
    expect((await sendCode('not-an-email')).status).toBe(400);
    expect((await request.post('/api/auth/email/code').send({ email: 'a@mail.test', purpose: 'admin' })).status).toBe(400);
  });

  it('운영에서 메일 설정이 없으면 503 — 번호는 남기지 않는다(다시 누를 때 1분을 기다리지 않게)', async () => {
    const prev = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      const res = await sendCode('prod@mail.test');
      expect(res.status).toBe(503);
    } finally {
      process.env.NODE_ENV = prev;
    }
    expect(await testPrisma.emailCode.count({ where: { email: 'prod@mail.test' } })).toBe(0);
  });
});

describe('인증번호 확인', () => {
  it('틀리면 남은 횟수를 알려 주고, 5번 틀리면 맞는 번호도 더는 안 받는다', async () => {
    await sendCode('wrong@mail.test');
    const code = lastCode('wrong@mail.test');
    const bad = code === '000000' ? '111111' : '000000';
    const first = await verify('wrong@mail.test', bad);
    expect(first.status).toBe(400);
    expect(first.body.error).toMatch(/4번 더/);
    for (let i = 1; i < MAX_ATTEMPTS; i++) await verify('wrong@mail.test', bad);
    const locked = await verify('wrong@mail.test', code);
    expect(locked.status).toBe(400);
    expect(locked.body.error).toMatch(/새 번호를 받아/);
  });

  it('동시에 여러 번 넣어도 5번을 넘기지 못한다', async () => {
    await sendCode('burst@mail.test');
    const code = lastCode('burst@mail.test');
    const bad = code === '000000' ? '111111' : '000000';
    await Promise.all(Array.from({ length: 12 }, () => verify('burst@mail.test', bad)));
    const row = await testPrisma.emailCode.findFirstOrThrow({ where: { email: 'burst@mail.test' } });
    expect(row.attempts).toBe(MAX_ATTEMPTS);
    expect((await verify('burst@mail.test', code)).status).toBe(400);
  });

  it('10분이 지난 번호는 만료', async () => {
    await sendCode('old@mail.test');
    const code = lastCode('old@mail.test');
    await testPrisma.emailCode.updateMany({ where: { email: 'old@mail.test' }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const res = await verify('old@mail.test', code);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/만료/);
  });

  it('다시 받으면 앞 번호는 못 쓴다 — 가장 최근 번호만', async () => {
    await sendCode('twice@mail.test');
    const first = lastCode('twice@mail.test');
    await ageCodes('twice@mail.test');
    await sendCode('twice@mail.test');
    const second = lastCode('twice@mail.test');
    if (first !== second) expect((await verify('twice@mail.test', first)).status).toBe(400);
    expect((await verify('twice@mail.test', second)).status).toBe(200);
  });

  it('가입용 번호로 비밀번호 재설정 확인은 안 된다(목적이 다르다)', async () => {
    await sendCode('purpose@mail.test');
    expect((await verify('purpose@mail.test', lastCode('purpose@mail.test'), 'reset')).status).toBe(400);
  });
});

describe('이메일 가입', () => {
  it('아티스트·일반도 이메일로 가입한다 — 고른 역할로 만들어진다', async () => {
    const a = await signup(await verifiedToken('artist@mail.test'), { role: 'ARTIST', name: '김작가' });
    expect(a.status).toBe(201);
    expect(a.body.user).toMatchObject({ role: 'ARTIST', email: 'artist@mail.test' });
    const v = await signup(await verifiedToken('visitor@mail.test'), { role: 'VISITOR' });
    expect(v.status).toBe(201);
    expect(v.body.user.role).toBe('VISITOR');
    expect((await testPrisma.user.findUniqueOrThrow({ where: { email: 'artist@mail.test' } })).emailVerifiedAt).toBeInstanceOf(Date);
  });

  it('관리자 역할·역할 없음은 400 — 인증은 쓰지 않은 채로 남는다', async () => {
    const token = await verifiedToken('role@mail.test');
    expect((await signup(token, { role: 'ADMIN' })).status).toBe(400);
    expect((await signup(token, { role: undefined })).status).toBe(400);
    expect((await signup(token, { role: 'VISITOR' })).status).toBe(201);
  });

  it('인증한 주소로 갤러리 계정이 생기고 바로 로그인된다 — 이메일 인증 시각·약관 동의 시각이 남는다', async () => {
    const token = await verifiedToken('Owner@Gallery.test');
    const res = await signup(token);
    expect(res.status).toBe(201);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user).toMatchObject({ email: 'owner@gallery.test', role: 'GALLERY', name: '김갤러리' });
    const u = await testPrisma.user.findUniqueOrThrow({ where: { email: 'owner@gallery.test' } });
    expect(u.provider).toBe('LOCAL');
    expect(u.emailVerifiedAt).toBeInstanceOf(Date);
    expect(u.termsAgreedAt).toBeInstanceOf(Date);
    expect(u.password).not.toBe(PW);
    expect(await bcrypt.compare(PW, u.password!)).toBe(true);
    // 발급된 토큰으로 내 정보가 열린다
    const me = await request.get('/api/auth/me').set('Authorization', `Bearer ${res.body.token}`);
    expect(me.body.user.role).toBe('GALLERY');
  });

  it('인증은 한 번만 쓴다 — 같은 토큰으로 두 번째 가입은 400', async () => {
    const token = await verifiedToken('once@gallery.test');
    expect((await signup(token)).status).toBe(201);
    const again = await signup(token, { name: '다른 사람' });
    expect(again.status).toBe(400);
    expect(await testPrisma.user.count({ where: { email: 'once@gallery.test' } })).toBe(1);
  });

  it('토큰 없이·남의 토큰·재설정 토큰으로는 가입할 수 없다', async () => {
    expect((await signup('')).status).toBe(400);
    expect((await signup(authToken(3, 'GALLERY'))).status).toBe(400);
    const forged = jwt.sign({ kind: 'email-verified', email: 'forged@gallery.test', purpose: 'SIGNUP', codeId: 999 }, process.env.JWT_SECRET!, { expiresIn: '30m' });
    expect((await signup(forged)).status).toBe(400);   // 그런 번호(줄)가 없다
    expect(await testPrisma.user.count({ where: { email: 'forged@gallery.test' } })).toBe(0);
  });

  it('비밀번호는 8자 이상 · 영문과 숫자를 함께, 약관 동의 필수', async () => {
    const token = await verifiedToken('rules@gallery.test');
    expect((await signup(token, { password: 'short1' })).status).toBe(400);
    expect((await signup(token, { password: 'onlyletters' })).status).toBe(400);
    expect((await signup(token, { password: '1234567890' })).status).toBe(400);
    expect((await signup(token, { agreePrivacy: false })).status).toBe(400);
    expect((await signup(token, { phone: '02-123' })).status).toBe(400);
    expect((await signup(token)).status).toBe(201);   // 실패한 시도들이 인증을 써 버리지 않았다
  });

  it('인증한 뒤 같은 주소로 다른 가입이 먼저 생기면 409', async () => {
    const token = await verifiedToken('late@gallery.test');
    await testPrisma.user.create({ data: { email: 'LATE@gallery.test', name: 'k', role: 'ARTIST' } });
    expect((await signup(token)).status).toBe(409);
  });

  it('비밀번호 규칙(서버판)', () => {
    expect(passwordProblem('abc12345')).toBeNull();
    expect(passwordProblem('abc1234')).toMatch(/8자/);
    expect(passwordProblem('abcdefgh')).toMatch(/영문과 숫자/);
    expect(passwordProblem('a1'.repeat(40))).toMatch(/너무 길어요/);
  });
});

describe('이메일 로그인', () => {
  async function makeAccount(email = 'login@gallery.test') {
    return signup(await verifiedToken(email));
  }

  it('가입한 이메일·비밀번호로 로그인된다(대소문자 무시), 틀리면 401', async () => {
    await makeAccount();
    const ok = await request.post('/api/auth/login').send({ email: 'LOGIN@Gallery.test', password: PW });
    expect(ok.status).toBe(200);
    expect(ok.body.user.role).toBe('GALLERY');
    expect((await request.post('/api/auth/login').send({ email: 'login@gallery.test', password: 'wrong1234' })).status).toBe(401);
    expect((await request.post('/api/auth/login').send({ email: 'nobody@gallery.test', password: PW })).status).toBe(401);
  });

  it('★ 이메일별 실패 한도 — 15분에 10번 틀리면 맞는 비밀번호도 429, 비밀번호를 재설정하면 풀린다(IP 한도와 따로)', async () => {
    await makeAccount('brute@gallery.test');
    for (let i = 0; i < LOGIN_FAIL_MAX; i++) {
      expect((await request.post('/api/auth/login').send({ email: 'brute@gallery.test', password: `wrong${i}pass` })).status).toBe(401);
    }
    const blocked = await request.post('/api/auth/login').send({ email: 'BRUTE@gallery.test', password: PW });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatch(/비밀번호 찾기/);
    // 다른 계정은 그대로
    await makeAccount('other@gallery.test');
    expect((await request.post('/api/auth/login').send({ email: 'other@gallery.test', password: PW })).status).toBe(200);
    // 비밀번호를 재설정하면 바로 풀린다
    const token = await verifiedToken('brute@gallery.test', 'reset');
    expect((await request.post('/api/auth/password/reset').send({ verificationToken: token, password: 'renewed2026' })).status).toBe(200);
    expect((await request.post('/api/auth/login').send({ email: 'brute@gallery.test', password: 'renewed2026' })).status).toBe(200);
  });

  it('없는 계정도 똑같이 센다 — 다르게 굴면 가입 여부가 드러난다', async () => {
    for (let i = 0; i < LOGIN_FAIL_MAX; i++) await request.post('/api/auth/login').send({ email: 'ghost@gallery.test', password: 'x1234567' });
    expect((await request.post('/api/auth/login').send({ email: 'ghost@gallery.test', password: 'x1234567' })).status).toBe(429);
  });

  it('카카오 계정(비밀번호 없음)은 비밀번호로 들어갈 수 없다', async () => {
    expect((await request.post('/api/auth/login').send({ email: 'gallery@test.com', password: PW })).status).toBe(401);
  });

  it('★ 운영에서도 로그인은 열려 있다 — 확인 없는 옛 가입(/auth/signup)만 404', async () => {
    await makeAccount('prodlogin@gallery.test');
    const prev = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      expect((await request.post('/api/auth/login').send({ email: 'prodlogin@gallery.test', password: PW })).status).toBe(200);
      const old = await request.post('/api/auth/signup').send({ name: 'n', email: 'raw@gallery.test', password: PW, role: 'GALLERY', ...CONSENT });
      expect(old.status).toBe(404);
    } finally {
      process.env.NODE_ENV = prev;
    }
  });
});

describe('비밀번호 찾기', () => {
  it('인증번호로 새 비밀번호를 정하면 옛 비밀번호는 안 되고 바로 로그인된다', async () => {
    await signup(await verifiedToken('reset@gallery.test'));
    clearDevOutbox();
    const token = await verifiedToken('Reset@Gallery.test', 'reset');
    expect(devOutbox('reset@gallery.test')[0]!.subject).toMatch(/비밀번호 재설정 인증번호/);
    const res = await request.post('/api/auth/password/reset').send({ verificationToken: token, password: 'newpass2026' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect((await request.post('/api/auth/login').send({ email: 'reset@gallery.test', password: PW })).status).toBe(401);
    expect((await request.post('/api/auth/login').send({ email: 'reset@gallery.test', password: 'newpass2026' })).status).toBe(200);
    // 같은 인증으로 두 번은 못 바꾼다
    expect((await request.post('/api/auth/password/reset').send({ verificationToken: token, password: 'again2026x' })).status).toBe(400);
  });

  it('없는 주소는 404, 카카오 계정은 카카오로 안내(400) — 메일을 보내지 않는다', async () => {
    const none = await sendCode('ghost@gallery.test', 'reset');
    expect(none.status).toBe(404);
    const kakao = await sendCode('gallery@test.com', 'reset');
    expect(kakao.status).toBe(400);
    expect(kakao.body.error).toMatch(/카카오/);
    expect(devOutbox()).toHaveLength(0);
  });

  it('가입 인증 토큰으로는 재설정할 수 없다', async () => {
    await signup(await verifiedToken('cross@gallery.test'));
    await ageCodes('cross@gallery.test');
    const signupToken = jwt.sign({ kind: 'email-verified', email: 'cross@gallery.test', purpose: 'SIGNUP', codeId: 1 }, process.env.JWT_SECRET!);
    expect((await request.post('/api/auth/password/reset').send({ verificationToken: signupToken, password: 'newpass2026' })).status).toBe(400);
  });
});

describe('로그인 이메일은 프로필에서 못 바꾼다(비밀번호 계정)', () => {
  it('이메일 가입 계정은 400, 카카오 계정은 지금처럼 바꿀 수 있다', async () => {
    const res = await signup(await verifiedToken('fixed@gallery.test'));
    const mine = await request.put('/api/auth/me/profile').set('Authorization', `Bearer ${res.body.token}`).send({ email: 'other@gallery.test' });
    expect(mine.status).toBe(400);
    // 같은 주소(대소문자만 다름)를 그대로 보내는 건 괜찮다 — 프로필 폼이 다른 칸과 함께 보낸다
    expect((await request.put('/api/auth/me/profile').set('Authorization', `Bearer ${res.body.token}`).send({ email: 'Fixed@gallery.test', phone: '010-2222-3333' })).status).toBe(200);
    const kakao = await request.put('/api/auth/me/profile').set('Authorization', `Bearer ${authToken(1, 'ARTIST')}`).send({ email: 'artist1-new@test.com' });
    expect(kakao.status).toBe(200);
  });
});

describe('관리자 갤러리 승인 화면 — 가입 이메일과 인증 여부', () => {
  it('승인 대기 갤러리의 owner 에 provider·emailVerifiedAt 이 실린다', async () => {
    const res = await signup(await verifiedToken('approve@gallery.test'));
    const ownerId = res.body.user.id;
    const g = await seedGallery(ownerId);
    await testPrisma.gallery.update({ where: { id: g.id }, data: { status: 'PENDING' } });
    const kakaoG = await seedGallery(3);
    await testPrisma.gallery.update({ where: { id: kakaoG.id }, data: { status: 'PENDING' } });
    const list = await request.get('/api/approvals').set('Authorization', `Bearer ${authToken(4, 'ADMIN')}`);
    expect(list.status).toBe(200);
    const mine = list.body.pendingGalleries.find((x: any) => x.id === g.id);
    expect(mine.owner).toMatchObject({ email: 'approve@gallery.test', provider: 'LOCAL' });
    expect(mine.owner.emailVerifiedAt).toBeTruthy();
    expect(mine.owner.password).toBeUndefined();
    const other = list.body.pendingGalleries.find((x: any) => x.id === kakaoG.id);
    expect(other.owner.emailVerifiedAt).toBeNull();
  });
});

describe('메일 — 로컬에서 보내지 않는 주소', () => {
  it('예약된 도메인과 시드·테스트 도메인', () => {
    for (const a of ['x@example.com', 'x@e2e.test', 'x@demo.artlink.local', 'x@artlink.com', 'x@test.com', 'x@t.com', 'bad']) {
      expect(isDevFakeAddress(a)).toBe(true);
    }
    for (const a of ['someone@gmail.com', 'gallery@naver.com', 'hello@artlink.cc']) expect(isDevFakeAddress(a)).toBe(false);
  });

  it('메일 본문에 번호·유효 시간이 있고 HTML 에도 번호가 그대로', () => {
    const m = codeMail('SIGNUP', '042137');
    expect(m.subject).toBe('[ArtLink] 이메일 인증번호 042137');
    expect(m.text).toContain('인증번호: 042137');
    expect(m.text).toContain('10분');
    expect(m.html).toContain('042137');
    expect(codeMail('RESET', '123456').subject).toContain('비밀번호 재설정');
  });
});
