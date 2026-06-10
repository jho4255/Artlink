import { Router } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { AppError } from '../middleware/errorHandler';

const router = Router();
import { JWT_SECRET } from '../lib/jwt';
const KAKAO_CLIENT_ID = process.env.KAKAO_CLIENT_ID || '';

function generateToken(user: { id: number; role: string }) {
  return jwt.sign({ userId: user.id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
}

function safeUser(user: { id: number; name: string; email: string; role: string; avatar: string | null; nickname?: string | null; phone?: string | null; instagramUrl?: string | null }) {
  return { id: user.id, name: user.name, nickname: user.nickname ?? null, email: user.email, role: user.role, avatar: user.avatar, phone: user.phone ?? null, instagramUrl: user.instagramUrl ?? null };
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

    const kakaoId = String(kakaoUser.id);
    const nickname = kakaoUser.kakao_account?.profile?.nickname || '';
    const profileImage = kakaoUser.kakao_account?.profile?.profile_image_url || null;
    const email = kakaoUser.kakao_account?.email || null;

    const existingUser = await prisma.user.findFirst({
      where: { provider: 'KAKAO', providerId: kakaoId },
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

const completeSchema = z.object({
  tempToken: z.string().min(1),
  role: z.enum(['ARTIST', 'GALLERY']),
  name: z.string().min(1, '이름을 입력해주세요.').max(50),
  email: z.string().email('유효한 이메일을 입력해주세요.'),
  phone: z.string().regex(/^01[0-9]-?\d{3,4}-?\d{4}$/, '올바른 휴대폰 번호를 입력해주세요.'),
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

    const emailTaken = await prisma.user.findUnique({ where: { email } });
    if (emailTaken) throw new AppError('이미 사용 중인 이메일입니다.', 409);

    const oauthExists = await prisma.user.findFirst({
      where: { provider: payload.provider, providerId: payload.providerId },
    });
    if (oauthExists) {
      const token = generateToken(oauthExists);
      return res.json({ token, user: safeUser(oauthExists) });
    }

    const user = await prisma.user.create({
      data: {
        name,
        email,
        phone,
        role,
        avatar: payload.avatar,
        provider: payload.provider,
        providerId: payload.providerId,
      },
    });

    const token = generateToken(user);
    res.status(201).json({ token, user: safeUser(user) });
  } catch (error) { next(error); }
});

// ========== 일반 회원가입 ==========

const signupSchema = z.object({
  name: z.string().min(1, '이름을 입력해주세요.').max(50),
  email: z.string().email('유효한 이메일을 입력해주세요.'),
  password: z.string().min(6, '비밀번호는 6자 이상이어야 합니다.').max(100),
  role: z.enum(['ARTIST', 'GALLERY']),
});

router.post('/signup', validate(signupSchema), async (req, res, next) => {
  try {
    const { name, email, password, role } = req.body;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) throw new AppError('이미 사용 중인 이메일입니다.', 409);

    const hashed = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { name, email, password: hashed, role, provider: 'LOCAL' },
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
    const { email, password } = req.body;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.password) throw new AppError('이메일 또는 비밀번호가 올바르지 않습니다.', 401);

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) throw new AppError('이메일 또는 비밀번호가 올바르지 않습니다.', 401);

    const token = generateToken(user);
    res.json({ token, user: safeUser(user) });
  } catch (error) { next(error); }
});

// ========== 기존 엔드포인트 ==========

router.get('/me', authenticate, async (req, res, next) => {
  try {
    // avatar 포함해 최신 사용자 정보 반환 (authenticate가 채우는 req.user엔 avatar가 없음)
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { id: true, name: true, nickname: true, email: true, role: true, avatar: true, phone: true, instagramUrl: true },
    });
    res.json({ user });
  } catch (error) { next(error); }
});

router.put('/me/avatar', authenticate, async (req, res, next) => {
  try {
    const { avatar } = req.body;
    const user = await prisma.user.update({
      where: { id: req.user!.id },
      data: { avatar },
      select: { id: true, name: true, email: true, role: true, avatar: true },
    });
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
      const taken = await prisma.user.findUnique({ where: { email } });
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
router.post('/dev-login', validate(devLoginSchema), async (req, res, next) => {
  try {
    // 양성 옵트인 전용: 로컬에서 ENABLE_DEV_LOGIN=true 일 때만 동작. production에서는 이중 차단.
    if (process.env.NODE_ENV === 'production' || process.env.ENABLE_DEV_LOGIN !== 'true') {
      throw new AppError('개발자 로그인은 사용할 수 없습니다.', 404);
    }
    const email = (req.body.email as string).trim().toLowerCase();
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) throw new AppError('해당 이메일의 시드 계정이 없습니다. 시드를 먼저 실행하세요.', 404);
    const token = generateToken(user);
    res.json({ token, user: safeUser(user) });
  } catch (error) { next(error); }
});

export default router;
