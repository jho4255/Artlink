import { Router } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { AppError } from '../middleware/errorHandler';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'artlink-dev-secret';
const KAKAO_CLIENT_ID = process.env.KAKAO_CLIENT_ID || '';

function generateToken(user: { id: number; role: string }) {
  return jwt.sign({ userId: user.id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
}

function safeUser(user: { id: number; name: string; email: string; role: string; avatar: string | null }) {
  return { id: user.id, name: user.name, email: user.email, role: user.role, avatar: user.avatar };
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
      select: { id: true, name: true, email: true, role: true, avatar: true },
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

// (dev-login/dev-users 제거됨 — 카카오 OAuth 정식 로그인으로 전환, KI-1 해소)

export default router;
