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

const router = Router();
import { JWT_SECRET } from '../lib/jwt';
const KAKAO_CLIENT_ID = process.env.KAKAO_CLIENT_ID || '';

// 로그인 타이밍 오라클 제거용 더미 해시 — 존재하지 않는 계정에도 동일한 bcrypt 비용을 지불한다.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('artlink-timing-guard', 10);

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
      where: { provider: payload.provider, providerId: payload.providerId, deletedAt: null },
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
    // 계정 부재/OAuth전용/탈퇴 시에도 동일 비용의 bcrypt를 수행해 존재여부 타이밍 노출 방지
    if (!user || !user.password || user.deletedAt) {
      await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
      throw new AppError('이메일 또는 비밀번호가 올바르지 않습니다.', 401);
    }

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
