import { Router } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { AppError } from '../middleware/errorHandler';
import { deleteUploadedFile } from '../lib/storage';
import { safeFileUrl } from '../lib/safeUrl';
import { handleTaken, normalizeHandle, validateHandle } from '../lib/handle';
import {
  consumeEmailCode, issueEmailCode, normalizeEmail, passwordProblem, readVerificationToken, verifyEmailCode, type EmailCodePurpose,
} from '../lib/emailCode';
import { devOutbox } from '../lib/mailer';
import { clearAllLoginFailures, clearLoginFailures, reserveLoginAttempt } from '../lib/loginThrottle';
import { clientIp } from '../lib/clientIp';

const router = Router();
import { JWT_SECRET } from '../lib/jwt';
const KAKAO_CLIENT_ID = process.env.KAKAO_CLIENT_ID || '';

// 로그인 타이밍 오라클 제거용 더미 해시 — 존재하지 않는 계정에도 동일한 bcrypt 비용을 지불한다.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('artlink-timing-guard', 10);

function generateToken(user: { id: number; role: string }) {
  return jwt.sign({ userId: user.id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
}

function safeUser(user: { id: number; name: string; email: string; role: string; avatar: string | null; nickname?: string | null; handle?: string | null; phone?: string | null; instagramUrl?: string | null }) {
  return { id: user.id, name: user.name, nickname: user.nickname ?? null, handle: user.handle ?? null, email: user.email, role: user.role, avatar: user.avatar, phone: user.phone ?? null, instagramUrl: user.instagramUrl ?? null };
}

// ========== 카카오 OAuth ==========

const kakaoSchema = z.object({
  code: z.string().min(1),
  redirectUri: z.string().url(),
});

router.post('/kakao', validate(kakaoSchema), async (req, res, next) => {
  try {
    const { code, redirectUri } = req.body;

    const tokenRes = await fetch('https://kauth.kakao.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: KAKAO_CLIENT_ID,
        redirect_uri: redirectUri,
        code,
      }),
    });
    const tokenData = await tokenRes.json() as any;
    if (tokenData.error) {
      console.error('[Kakao Token Error]', tokenData);
      throw new AppError(`카카오 인증 실패: ${tokenData.error_description || tokenData.error}`, 401);
    }

    const userRes = await fetch('https://kapi.kakao.com/v2/user/me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const kakaoUser = await userRes.json() as any;

    // 사용자 정보 응답 검증: 오류 바디(레이트리밋/장애 등)면 id가 undefined → providerId "undefined"로 교차 로그인 방지
    if (!userRes.ok || !kakaoUser?.id) {
      console.error('[Kakao UserInfo Error]', userRes.status, kakaoUser);
      throw new AppError('카카오 사용자 정보를 가져오지 못했습니다. 잠시 후 다시 시도해주세요.', 502);
    }

    const kakaoId = String(kakaoUser.id);
    const nickname = kakaoUser.kakao_account?.profile?.nickname || '';
    const profileImage = kakaoUser.kakao_account?.profile?.profile_image_url || null;
    const email = kakaoUser.kakao_account?.email || null;

    const existingUser = await prisma.user.findFirst({
      where: { provider: 'KAKAO', providerId: kakaoId, deletedAt: null },
    });

    if (existingUser) {
      const token = generateToken(existingUser);
      return res.json({ token, user: safeUser(existingUser) });
    }

    const tempToken = jwt.sign(
      { provider: 'KAKAO', providerId: kakaoId, name: nickname, email, avatar: profileImage },
      JWT_SECRET,
      { expiresIn: '10m' },
    );

    res.json({
      needsRegistration: true,
      tempToken,
      profile: { name: nickname, email, avatar: profileImage },
    });
  } catch (error) { next(error); }
});

// ========== OAuth 가입 완료 ==========

/**
 * 가입 시 필수 동의 — **이용약관 · 개인정보 처리방침**.
 *
 * ⚠️ `z.boolean()` 이 아니라 **true 를 강제**한다. optional 로 두면 화면이 값을 안 보내는 순간
 *    조용히 미동의 가입이 된다 — 동의를 받은 적 없는 회원이 생기고, 그건 나중에 되돌릴 수 없다.
 * ⚠️ 마케팅 수신 동의는 두지 않는다. 우리가 보내는 메일은 **이메일 인증번호뿐**이다(2026-10-08 — 갤러리 이메일 가입·비밀번호 찾기).
 *    하지도 않을 일에 동의를 받아 두는 건 그 자체가 문제다. 광고·소식 메일을 보내게 되면 그때 따로 동의를 받을 것.
 */
const consentFields = {
  agreeTerms: z.boolean().refine((v) => v === true, '이용약관에 동의해주세요.'),
  agreePrivacy: z.boolean().refine((v) => v === true, '개인정보 처리방침에 동의해주세요.'),
};

const completeSchema = z.object({
  tempToken: z.string().min(1),
  // VISITOR = 관람객(컬렉터, 2026-09-16). 찜·좋아요·메시지·이웃·소식만 — 지원·등록은 authorize 가 막는다
  role: z.enum(['ARTIST', 'GALLERY', 'VISITOR']),
  name: z.string().min(1, '이름을 입력해주세요.').max(50),
  email: z.string().email('유효한 이메일을 입력해주세요.'),
  phone: z.string().regex(/^01[0-9]-?\d{3,4}-?\d{4}$/, '올바른 휴대폰 번호를 입력해주세요.'),
  ...consentFields,
});

router.post('/complete-registration', validate(completeSchema), async (req, res, next) => {
  try {
    const { tempToken, role, name, email, phone } = req.body;

    let payload: any;
    try {
      payload = jwt.verify(tempToken, JWT_SECRET);
    } catch {
      throw new AppError('등록 세션이 만료되었습니다. 다시 로그인해주세요.', 400);
    }
    // ⚠️⚠️ **카카오 가입 토큰인지 확인할 것**(2026-10-08 발견·수정). 같은 비밀 키로 서명한 다른 토큰(로그인 토큰·이메일 인증 토큰)에는
    //    provider·providerId 가 없다. 그걸 그대로 아래 findFirst 에 넣으면 Prisma 가 undefined 조건을 **빼 버려서**
    //    '탈퇴하지 않은 아무 회원' 이 잡혔고, 그 회원의 로그인 토큰을 돌려줬다 — 로그인한 누구나 자기 토큰을 여기 넣어 남의 계정으로 들어갈 수 있었다.
    //    회귀: gallery-email-auth.test.ts 「로그인 토큰을 카카오 가입 토큰 자리에 넣으면 400」
    if (payload?.provider !== 'KAKAO' || typeof payload.providerId !== 'string' || !payload.providerId) {
      throw new AppError('등록 세션이 만료되었습니다. 다시 로그인해주세요.', 400);
    }

    // 대소문자만 다른 주소도 같은 주소로 본다 — 이메일 가입 계정(소문자로 저장)과 겹치지 않게
    const emailTaken = await prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } }, select: { id: true } });
    if (emailTaken) throw new AppError('이미 사용 중인 이메일입니다.', 409);

    const oauthExists = await prisma.user.findFirst({
      where: { provider: payload.provider, providerId: payload.providerId, deletedAt: null },
    });
    if (oauthExists) {
      const token = generateToken(oauthExists);
      return res.json({ token, user: safeUser(oauthExists) });
    }

    // 동의 시각은 **서버 시각**으로 남긴다(클라이언트가 보낸 시각을 믿지 않는다)
    const agreedAt = new Date();
    const user = await prisma.user.create({
      data: {
        name,
        email,
        phone,
        role,
        avatar: payload.avatar,
        provider: payload.provider,
        providerId: payload.providerId,
        termsAgreedAt: agreedAt,
        privacyAgreedAt: agreedAt,
      },
    });

    const token = generateToken(user);
    res.status(201).json({ token, user: safeUser(user) });
  } catch (error) { next(error); }
});

// ========== 일반 회원가입 · 비밀번호 로그인 ==========
/**
 * **확인 없는** 이메일+비밀번호 가입(`POST /signup`)은 운영에서 닫는다(2026-10-03 사용자 결정, 점검 S6).
 * 이메일 확인 없이 계정을 만들 수 있어서, 남의 이메일을 먼저 등록하면 그 사람은 카카오 가입에서 '이미 사용 중인 이메일' 로 막혔다.
 * 다시 열려면 Render 환경 변수 `ENABLE_PASSWORD_AUTH=true`. 로컬·테스트는 그대로 열려 있다(E2E·테스트 픽스처가 쓴다).
 * 없는 주소처럼 404 로 답한다(존재를 알릴 이유가 없다).
 *
 * 2026-10-08 부터 **인증번호로 이메일을 확인한 뒤에만** 비밀번호로 가입한다(`POST /email-signup`, 아래 — 아티스트·갤러리·일반 모두) —
 * 그래서 **로그인(`POST /login`)은 운영에서도 열려 있다.** 비밀번호가 있는 계정만 로그인된다.
 */
function assertPasswordAuthAllowed() {
  if (process.env.NODE_ENV === 'production' && process.env.ENABLE_PASSWORD_AUTH !== 'true') {
    throw new AppError('요청한 API를 찾을 수 없습니다.', 404);
  }
}

const signupSchema = z.object({
  name: z.string().min(1, '이름을 입력해주세요.').max(50),
  email: z.string().email('유효한 이메일을 입력해주세요.'),
  password: z.string().min(6, '비밀번호는 6자 이상이어야 합니다.').max(100),
  // VISITOR = 관람객(컬렉터, 2026-09-16). 찜·좋아요·메시지·이웃·소식만 — 지원·등록은 authorize 가 막는다
  role: z.enum(['ARTIST', 'GALLERY', 'VISITOR']),
  // ⚠️ 화면은 카카오 가입만 쓰지만 이 API 도 열려 있다. 한쪽만 막으면 뚫린 채로 남는다.
  ...consentFields,
});

router.post('/signup', (_req, _res, next) => { try { assertPasswordAuthAllowed(); next(); } catch (e) { next(e); } }, validate(signupSchema), async (req, res, next) => {
  try {
    const { name, email, password, role } = req.body;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) throw new AppError('이미 사용 중인 이메일입니다.', 409);

    const hashed = await bcrypt.hash(password, 10);
    const agreedAt = new Date();
    const user = await prisma.user.create({
      data: { name, email, password: hashed, role, provider: 'LOCAL', termsAgreedAt: agreedAt, privacyAgreedAt: agreedAt },
    });

    const token = generateToken(user);
    res.status(201).json({ token, user: safeUser(user) });
  } catch (error) { next(error); }
});

// ========== 일반 로그인 ==========

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post('/login', validate(loginSchema), async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body.email);
    const { password } = req.body;
    // 실패 한도 — 이메일+주소 15분 10번 · 이메일 전체 하루 50번(lib/loginThrottle.ts). 막혀 있으면 비밀번호를 보지도 않는다.
    // ⚠️ 비밀번호를 보기 **전에** 이 시도를 센다(맞히면 아래에서 지운다) — 확인하는 동안 같이 들어온 요청이 같은 빈자리로 통과하지 못하게
    const ip = clientIp(req);
    const block = reserveLoginAttempt(email, ip);
    if (block === 'account') {
      // 하루 동안 남는다 — 기다리라고 하지 않는다. 비밀번호 찾기를 하면 그 자리에서 풀리고 로그인된다.
      // '이 계정' 이라 하지 않는다 — 없는 이메일도 똑같이 세므로, 그 말이 가입 여부를 아는 척하게 된다
      throw new AppError('이 이메일로 로그인에 너무 많이 실패해 비밀번호 로그인을 잠시 막았어요. 비밀번호 찾기로 새 비밀번호를 정하면 바로 로그인돼요.', 429);
    }
    if (block === 'ip') {
      throw new AppError('로그인을 여러 번 실패했어요. 15분 뒤에 다시 시도하거나 비밀번호 찾기를 해 주세요.', 429);
    }

    // 대소문자는 가리지 않는다(이메일 가입은 소문자로 저장하지만, 사람은 대문자를 섞어 친다). 비밀번호가 있는 계정만 본다 —
    // 같은 주소의 카카오 계정이 있어도 그 계정으로 로그인되지 않는다.
    const user = await prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' }, password: { not: null }, deletedAt: null } });
    // 계정 부재/OAuth전용/탈퇴 시에도 동일 비용의 bcrypt를 수행해 존재여부 타이밍 노출 방지
    if (!user || !user.password || user.deletedAt) {
      await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
      // 없는 계정도 똑같이 센다(위에서 이미 셌다) — 다르게 굴면 가입 여부가 드러난다
      throw new AppError('이메일 또는 비밀번호가 올바르지 않습니다.', 401);
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) throw new AppError('이메일 또는 비밀번호가 올바르지 않습니다.', 401);   // 위에서 이미 셌다

    clearLoginFailures(email, ip);
    const token = generateToken(user);
    res.json({ token, user: safeUser(user) });
  } catch (error) { next(error); }
});

// ========== 이메일 가입 · 비밀번호 찾기 (2026-10-08) ==========
/**
 * 인증번호로 이메일을 확인한 뒤에만 비밀번호 계정을 만든다 — 규칙은 lib/emailCode.ts.
 *   ① `POST /email/code`   { email, purpose: 'signup' | 'reset' }  → 6자리 번호를 메일로
 *   ② `POST /email/verify` { email, purpose, code }                → { verificationToken } (30분)
 *   ③ `POST /email-signup` { verificationToken, role, password, name, phone, 동의 } → 계정 + 로그인
 *      `POST /password/reset` { verificationToken, password }                       → 새 비밀번호 + 로그인
 * 역할은 **아티스트·갤러리·일반 모두**(사용자 결정 — 처음엔 갤러리만이었다가 로컬 확인 중 넓혔다). 카카오 가입도 그대로 된다.
 * 관리자는 갤러리 승인 화면에서 가입 이메일과 '이메일 인증됨'(emailVerifiedAt)을 보고 그 갤러리 메일인지 판단한다.
 *
 * ⚠️ 이미 가입된 주소인지는 알려 준다(가입·찾기 화면이 "카카오로 로그인하세요" 를 말해야 해서). 대신 IP 한도(index.ts)와
 *    주소별 한도(1분 1번 · 1시간 5번)가 함께 걸려 대량 조회는 막힌다. 로그인만은 지금처럼 존재 여부를 드러내지 않는다.
 */
const emailField = z.string().trim().min(1, '이메일을 입력해 주세요.').max(254, '이메일이 너무 깁니다.').email('이메일 주소를 확인해 주세요.');
const purposeField = z.enum(['signup', 'reset'], { message: '잘못된 요청입니다.' });
const toPurpose = (p: 'signup' | 'reset'): EmailCodePurpose => (p === 'signup' ? 'SIGNUP' : 'RESET');

/** 이 주소로 가입한 (탈퇴하지 않은) 계정 — 대소문자 무시 */
function findAccountByEmail(email: string) {
  return prisma.user.findFirst({
    where: { email: { equals: email, mode: 'insensitive' }, deletedAt: null },
    select: { id: true, password: true },
  });
}

const sendCodeSchema = z.object({ email: emailField, purpose: purposeField });
router.post('/email/code', validate(sendCodeSchema), async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body.email);
    const purpose = toPurpose(req.body.purpose);
    const account = await findAccountByEmail(email);
    if (purpose === 'SIGNUP' && account) {
      throw new AppError(
        account.password
          ? '이미 이 이메일로 가입한 계정이 있어요. 로그인해 주세요.'
          : '이미 이 이메일로 가입한 계정이 있어요. 카카오로 가입하셨다면 카카오로 로그인해 주세요.',
        409,
      );
    }
    if (purpose === 'RESET') {
      if (!account) throw new AppError('이 이메일로 가입한 계정이 없어요. 주소를 확인해 주세요.', 404);
      if (!account.password) throw new AppError('카카오로 가입한 계정이에요. 카카오로 로그인해 주세요.', 400);
    }
    res.json(await issueEmailCode(email, purpose));
  } catch (error) { next(error); }
});

const verifyCodeSchema = z.object({ email: emailField, purpose: purposeField, code: z.string().trim().min(1, '인증번호를 입력해 주세요.').max(20) });
router.post('/email/verify', validate(verifyCodeSchema), async (req, res, next) => {
  try {
    const verificationToken = await verifyEmailCode(normalizeEmail(req.body.email), toPurpose(req.body.purpose), req.body.code);
    res.json({ verificationToken });
  } catch (error) { next(error); }
});

const passwordField = z.string().min(1, '비밀번호를 입력해 주세요.').max(200, '비밀번호가 너무 깁니다.');
const emailSignupSchema = z.object({
  verificationToken: z.string().min(1),
  // VISITOR = 일반(디렉터·관람객). 관리자(ADMIN)는 여기서 만들 수 없다
  role: z.enum(['ARTIST', 'GALLERY', 'VISITOR'], { message: '역할을 골라 주세요.' }),
  password: passwordField,
  name: z.string().trim().min(1, '이름을 입력해 주세요.').max(50),
  phone: z.string().trim().regex(/^01[0-9]-?\d{3,4}-?\d{4}$/, '올바른 휴대폰 번호를 입력해 주세요.'),
  ...consentFields,
});
router.post('/email-signup', validate(emailSignupSchema), async (req, res, next) => {
  try {
    const { email, codeId } = readVerificationToken(req.body.verificationToken, 'SIGNUP');
    const problem = passwordProblem(req.body.password);
    if (problem) throw new AppError(problem, 400);
    const hashed = await bcrypt.hash(req.body.password, 10);
    const now = new Date();   // 동의·인증 시각은 서버 시각으로 남긴다
    const user = await prisma.$transaction(async (tx) => {
      await consumeEmailCode(tx, codeId, email, 'SIGNUP');
      const taken = await tx.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } }, select: { id: true } });
      if (taken) throw new AppError('이미 이 이메일로 가입한 계정이 있어요. 로그인해 주세요.', 409);
      return tx.user.create({
        data: {
          name: req.body.name,
          email,
          phone: req.body.phone,
          role: req.body.role,
          password: hashed,
          provider: 'LOCAL',
          emailVerifiedAt: now,
          termsAgreedAt: now,
          privacyAgreedAt: now,
        },
      });
    });
    res.status(201).json({ token: generateToken(user), user: safeUser(user) });
  } catch (error) { next(error); }
});

const passwordResetSchema = z.object({ verificationToken: z.string().min(1), password: passwordField });
router.post('/password/reset', validate(passwordResetSchema), async (req, res, next) => {
  try {
    const { email, codeId } = readVerificationToken(req.body.verificationToken, 'RESET');
    const problem = passwordProblem(req.body.password);
    if (problem) throw new AppError(problem, 400);
    const hashed = await bcrypt.hash(req.body.password, 10);
    const user = await prisma.$transaction(async (tx) => {
      await consumeEmailCode(tx, codeId, email, 'RESET');
      const u = await tx.user.findFirst({
        where: { email: { equals: email, mode: 'insensitive' }, deletedAt: null, password: { not: null } },
        select: { id: true, emailVerifiedAt: true },
      });
      if (!u) throw new AppError('이 이메일로 가입한 계정을 찾지 못했어요.', 404);
      // 번호를 받아 맞혔으니 이 주소는 확인된 것이다
      return tx.user.update({ where: { id: u.id }, data: { password: hashed, emailVerifiedAt: u.emailVerifiedAt ?? new Date() } });
    });
    clearAllLoginFailures(email);   // 로그인 실패로 막혀 있었으면 비밀번호를 새로 정한 순간 풀린다(주인의 다른 기기까지)
    res.json({ token: generateToken(user), user: safeUser(user) });
  } catch (error) { next(error); }
});

// ========== 기존 엔드포인트 ==========

router.get('/me', authenticate, async (req, res, next) => {
  try {
    // avatar 포함해 최신 사용자 정보 반환 (authenticate가 채우는 req.user엔 avatar가 없음)
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { id: true, name: true, nickname: true, handle: true, email: true, role: true, avatar: true, phone: true, instagramUrl: true },
    });
    res.json({ user });
  } catch (error) { next(error); }
});

router.put('/me/avatar', authenticate, async (req, res, next) => {
  try {
    // null(제거)은 허용, 값이 있으면 안전한 URL(업로드 경로 or http(s))만 저장 — javascript:/data: 등 폐기
    const raw = req.body.avatar;
    const avatar = raw == null || raw === '' ? null : safeFileUrl(raw);
    if (raw && !avatar) throw new AppError('유효하지 않은 이미지 URL입니다.', 400);
    const before = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { avatar: true } });
    const user = await prisma.user.update({
      where: { id: req.user!.id },
      data: { avatar },
      select: { id: true, name: true, email: true, role: true, avatar: true },
    });
    // 아바타가 우리 업로드 파일에서 다른 값으로 바뀌면 이전 파일 정리(카카오 외부 URL은 헬퍼가 무시)
    if (before?.avatar && before.avatar !== user.avatar) void deleteUploadedFile(before.avatar);
    res.json(user);
  } catch (error) { next(error); }
});

// 닉네임 중복 확인
router.get('/nickname-check', authenticate, async (req, res, next) => {
  try {
    const nickname = ((req.query.nickname as string) || '').trim();
    if (nickname.length < 2 || nickname.length > 20) {
      return res.json({ available: false, reason: '닉네임은 2~20자로 입력해주세요.' });
    }
    const existing = await prisma.user.findUnique({ where: { nickname } });
    res.json({ available: !existing || existing.id === req.user!.id });
  } catch (error) { next(error); }
});

// 닉네임 설정/변경 (중복 불가)
const nicknameSchema = z.object({
  nickname: z.string().trim().min(2, '닉네임은 2자 이상이어야 합니다.').max(20, '닉네임은 20자 이내여야 합니다.'),
});
router.put('/me/nickname', authenticate, validate(nicknameSchema), async (req, res, next) => {
  try {
    const nickname = (req.body.nickname as string).trim();
    const existing = await prisma.user.findUnique({ where: { nickname } });
    if (existing && existing.id !== req.user!.id) throw new AppError('이미 사용 중인 닉네임입니다.', 409);
    const user = await prisma.user.update({
      where: { id: req.user!.id },
      data: { nickname },
      select: { id: true, name: true, nickname: true, email: true, role: true, avatar: true },
    });
    res.json(user);
  } catch (error) { next(error); }
});

// ========== 홈페이지 주소(@handle) ==========
// 규칙은 lib/handle.ts 한 곳. 여기서는 중복만 본다. 인스타 아이디에서의 자동 제안은 공개 페이지가 열릴 때
// `ensureHandle` 이 한다(routes/portfolio.ts) — 프로필에서 바꾸면 그게 우선이다.
router.get('/handle-check', authenticate, async (req, res, next) => {
  try {
    const handle = normalizeHandle(req.query.handle);
    const reason = validateHandle(handle);
    if (reason) return res.json({ available: false, reason });
    // 갤러리 주소와 **같은 이름 공간**이라 양쪽을 함께 본다
    res.json({ available: !(await handleTaken(handle, { userId: req.user!.id })), handle });
  } catch (error) { next(error); }
});

const handleSchema = z.object({ handle: z.string().trim().max(60) });
router.put('/me/handle', authenticate, validate(handleSchema), async (req, res, next) => {
  try {
    const handle = normalizeHandle(req.body.handle);
    const reason = validateHandle(handle);
    if (reason) throw new AppError(reason, 400);
    if (await handleTaken(handle, { userId: req.user!.id })) throw new AppError('이미 사용 중인 주소입니다.', 409);
    const user = await prisma.user.update({
      where: { id: req.user!.id },
      data: { handle },
      select: { id: true, name: true, nickname: true, handle: true, email: true, role: true, avatar: true },
    });
    res.json(user);
  } catch (error) { next(error); }
});

// ========== 내 정보(연락처/이메일/인스타) 수정 ==========
// 작가가 마이페이지 프로필 탭에서 전화번호·이메일·인스타그램 주소를 직접 수정.
// 모든 필드 선택적(부분 업데이트). 이메일 변경 시 중복(409) 검증.
const profileSchema = z.object({
  phone: z.string().trim().max(20).optional(),
  email: z.string().trim().email('유효한 이메일을 입력해주세요.').optional(),
  instagramUrl: z.string().trim().max(300).optional(),
});
router.put('/me/profile', authenticate, validate(profileSchema), async (req, res, next) => {
  try {
    const { phone, email, instagramUrl } = req.body as { phone?: string; email?: string; instagramUrl?: string };
    const data: { phone?: string | null; email?: string; instagramUrl?: string | null } = {};

    if (email !== undefined) {
      // 이메일로 로그인하는 계정(비밀번호 있음)은 이 주소가 곧 아이디이고 인증번호로 확인한 주소다 — 확인 없이 바꾸면
      // 남의 주소로 바꿔 둘 수 있고, 관리자가 승인 때 본 '인증된 이메일' 이 조용히 다른 주소가 된다(2026-10-08)
      const me = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { email: true, password: true } });
      if (me?.password && normalizeEmail(email) !== normalizeEmail(me.email)) {
        throw new AppError('이메일로 로그인하는 계정은 여기서 이메일을 바꿀 수 없어요. 1:1 문의로 알려 주세요.', 400);
      }
      const taken = await prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } }, select: { id: true } });
      if (taken && taken.id !== req.user!.id) throw new AppError('이미 사용 중인 이메일입니다.', 409);
      data.email = email;
    }
    if (phone !== undefined) data.phone = phone || null;            // 빈 문자열 → null(해제)
    if (instagramUrl !== undefined) data.instagramUrl = instagramUrl || null;

    const user = await prisma.user.update({
      where: { id: req.user!.id },
      data,
      select: { id: true, name: true, nickname: true, email: true, role: true, avatar: true, phone: true, instagramUrl: true },
    });
    res.json(user);
  } catch (error) { next(error); }
});

// ========== 개발자 로그인 (로컬 전용) ==========
// production에서는 절대 노출/동작하지 않음. 시드 계정 이메일로 즉시 JWT 발급.
// 프론트 LoginPage는 import.meta.env.DEV 일 때만 버튼을 렌더한다.
const devLoginSchema = z.object({
  email: z.string().email(),
});

// dev-login과 **완전히 동일한 이중 차단**. production이거나 옵트인이 없으면 존재하지 않는 것처럼 404.
function assertDevLoginAllowed() {
  if (process.env.NODE_ENV === 'production' || process.env.ENABLE_DEV_LOGIN !== 'true') {
    throw new AppError('개발자 로그인은 사용할 수 없습니다.', 404);
  }
}

// 개발자 로그인용 계정 목록 (로컬 전용).
// 실서버 DB 복제본으로 화면을 확인할 때 시드 4계정만으로는 아무것도 볼 수 없어서 추가했다.
// 비밀번호/전화 등 민감 정보는 내려주지 않는다 — 로그인 대상을 고르는 데 필요한 최소한만.
router.get('/dev-users', async (req, res, next) => {
  try {
    assertDevLoginAllowed();
    const q = String(req.query.q ?? '').trim();
    const role = String(req.query.role ?? '').trim().toUpperCase();
    const users = await prisma.user.findMany({
      where: {
        deletedAt: null,
        // ⚠️ 새 역할을 만들면 여기에도 넣을 것 — 빠지면 그 역할만 필터가 조용히 무시돼
        //    "같은 역할의 실제 계정으로 대체"가 엉뚱한 사람을 고른다(2026-09-16 VISITOR 추가).
        ...(role === 'ARTIST' || role === 'GALLERY' || role === 'ADMIN' || role === 'VISITOR' ? { role } : {}),
        ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' as const } }, { email: { contains: q, mode: 'insensitive' as const } }] } : {}),
      },
      select: {
        id: true, name: true, nickname: true, email: true, role: true,
        // 작품 수가 많은 작가부터 보는 게 확인에 유리하다
        portfolio: { select: { _count: { select: { images: true } } } },
      },
      // ⚠️ 작품 수는 관계 카운트라 DB에서 정렬할 수 없다. take로 먼저 자르고 나중에 정렬하면
      // **작품이 제일 많은 작가가 잘려 나간다**(id가 뒤쪽이면 40위 밖으로 밀림 — 실제로 그랬다).
      // 후보를 넉넉히 받아서 정렬한 뒤 자른다.
      take: 300,
      orderBy: { id: 'asc' },
    });
    res.json(
      users
        .map((u) => {
          const { portfolio, ...rest } = u;
          return { ...rest, workCount: portfolio?._count.images ?? 0 };
        })
        .sort((a, b) => b.workCount - a.workCount)
        .slice(0, 40),
    );
  } catch (error) { next(error); }
});
router.post('/dev-login', validate(devLoginSchema), async (req, res, next) => {
  try {
    assertDevLoginAllowed();
    const email = (req.body.email as string).trim().toLowerCase();
    const user = await prisma.user.findFirst({ where: { email, deletedAt: null } });
    if (!user) throw new AppError('해당 이메일의 계정이 없습니다.', 404);
    const token = generateToken(user);
    res.json({ token, user: safeUser(user) });
  } catch (error) { next(error); }
});

/**
 * 보내지 않고 남긴 메일 보기 (로컬 전용, 개발자 로그인과 같은 이중 차단) — 2026-10-08.
 * 로컬에서 SMTP 설정이 없거나 테스트용 주소(@…test·@example.com 등, lib/mailer.ts isDevFakeAddress)면 메일을 보내지 않고 보관함에만 남긴다.
 * E2E 가 이걸로 인증번호를 읽는다. 운영에서는 404 이고, 운영의 보관함은 늘 비어 있다.
 */
router.get('/dev-mails', async (req, res, next) => {
  try {
    assertDevLoginAllowed();
    const to = String(req.query.to ?? '').trim();
    res.json(devOutbox(to || undefined).slice(0, 10).map((m) => ({ to: m.to, subject: m.subject, text: m.text, at: m.at })));
  } catch (error) { next(error); }
});

// ========== 회원 탈퇴 (소프트 삭제 + 익명화) ==========

// 탈퇴 전 영향 요약: 보유 갤러리 / 진행 중 공고 / 처리 대기 지원자 / 본인 활동
// 프론트 탈퇴 모달에서 안내 + 본인확인 방식(비밀번호 vs 문구) 분기에 사용.
router.get('/me/withdraw-info', authenticate, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const me = await prisma.user.findUnique({
      where: { id: userId },
      select: { provider: true, password: true, role: true },
    });
    if (!me) throw new AppError('유효하지 않은 사용자입니다.', 401);

    const galleries = await prisma.gallery.findMany({
      where: { ownerId: userId, status: { not: 'WITHDRAWN' } },
      select: { id: true, name: true, status: true },
    });
    const galleryIds = galleries.map((g) => g.id);

    const now = new Date();
    let ongoingExhibitions = 0;
    let activeApplicants = 0;
    if (galleryIds.length) {
      ongoingExhibitions = await prisma.exhibition.count({
        where: { galleryId: { in: galleryIds }, status: 'APPROVED', recruitmentClosed: false, deadline: { gte: now } },
      });
      activeApplicants = await prisma.application.count({
        where: { exhibition: { galleryId: { in: galleryIds } }, status: { not: 'REJECTED' } },
      });
    }

    const [myApplications, myReviews] = await Promise.all([
      prisma.application.count({ where: { userId } }),
      prisma.review.count({ where: { userId } }),
    ]);

    res.json({
      role: me.role,
      // LOCAL(비밀번호 보유) 계정은 비밀번호 확인, 그 외(OAuth)는 '탈퇴' 문구 확인
      confirmMethod: me.provider === 'LOCAL' && me.password ? 'password' : 'text',
      galleries,
      ongoingExhibitions,
      activeApplicants,
      myApplications,
      myReviews,
    });
  } catch (error) { next(error); }
});

// 회원 탈퇴 실행: 본인 확인 → (갤러리 보유 시 책임고지 동의 필수) → 트랜잭션으로
//   1) 소유 갤러리/공모 WITHDRAWN 처리(공개 목록 status='APPROVED' 필터에서 자동 제외)
//   2) 개인정보 익명화 + deletedAt 마킹(=로그인 차단). 행은 유지해 참조 무결성/거래기록 보존.
const withdrawSchema = z.object({
  password: z.string().optional(),
  confirmText: z.string().optional(),
  acknowledge: z.boolean().optional(),
});
router.delete('/me', authenticate, validate(withdrawSchema), async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const me = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, provider: true, password: true, role: true },
    });
    if (!me) throw new AppError('유효하지 않은 사용자입니다.', 401);
    if (me.role === 'ADMIN') throw new AppError('관리자 계정은 탈퇴할 수 없습니다.', 403);

    // 본인 확인
    if (me.provider === 'LOCAL' && me.password) {
      const password = (req.body.password as string) || '';
      if (!password || !(await bcrypt.compare(password, me.password))) {
        throw new AppError('비밀번호가 올바르지 않습니다.', 401);
      }
    } else {
      const confirmText = ((req.body.confirmText as string) || '').trim();
      if (confirmText !== '탈퇴') {
        throw new AppError('확인 문구가 일치하지 않습니다. "탈퇴"를 입력해주세요.', 400);
      }
    }

    // 갤러리 보유 시 책임 고지 동의 필수
    const ownedGalleries = await prisma.gallery.findMany({
      where: { ownerId: userId, status: { not: 'WITHDRAWN' } },
      select: { id: true },
    });
    if (ownedGalleries.length > 0 && req.body.acknowledge !== true) {
      throw new AppError('진행 중인 공고·지원자에 대한 책임 동의가 필요합니다.', 400);
    }
    const galleryIds = ownedGalleries.map((g) => g.id);

    await prisma.$transaction(async (tx) => {
      // 1) 소유 갤러리/공모 숨김 (status APPROVED 필터 기반 공개 목록에서 자동 제외)
      if (galleryIds.length) {
        await tx.exhibition.updateMany({
          where: { galleryId: { in: galleryIds } },
          data: { status: 'WITHDRAWN', recruitmentClosed: true },
        });
        await tx.show.updateMany({
          where: { galleryId: { in: galleryIds } },
          data: { status: 'WITHDRAWN' },
        });
        await tx.gallery.updateMany({
          where: { id: { in: galleryIds } },
          data: { status: 'WITHDRAWN' },
        });
      }
      // 2) 개인정보 익명화 + 소프트 삭제 마킹
      await tx.user.update({
        where: { id: userId },
        data: {
          name: '탈퇴한 회원',
          email: `deleted_${userId}@artlink.invalid`,
          nickname: null,
          handle: null,   // 안 비우면 죽은 `/@handle` 이 이름공간(작가·갤러리 공용)을 영구히 점유한다(2026-09-19)
          phone: null,
          avatar: null,
          instagramUrl: null,
          password: null,
          providerId: null,
          deletedAt: new Date(),
        },
      });
    });

    res.json({ success: true });
  } catch (error) { next(error); }
});

export default router;
