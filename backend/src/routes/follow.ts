/**
 * 이웃 (단방향 팔로우) — `follower → following`.
 *
 * · 상대 수락 불필요. 추가하면 상대에게 **알림**이 간다(내 프로필로 링크).
 * · 스토리의 [이웃공개]가 이 관계를 근거로 판정된다(내가 팔로우하면 그 사람 이웃공개 스토리를 본다).
 * · 역할 무관 — 작가·갤러리 서로 이웃할 수 있다.
 */
import { Router } from 'express';
import prisma from '../lib/prisma';
import { authenticate, optionalAuth } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';

const router = Router();

const displayName = (u: { name: string; nickname: string | null }) => u.nickname || u.name;

// 이웃 추가
router.post('/:userId', authenticate, async (req, res, next) => {
  try {
    const me = req.user!.id;
    const target = parseInt(req.params.userId as string);
    if (!Number.isFinite(target)) throw new AppError('대상을 찾을 수 없습니다.', 404);
    if (target === me) throw new AppError('자기 자신은 이웃할 수 없습니다.', 400);

    const user = await prisma.user.findFirst({ where: { id: target, deletedAt: null }, select: { id: true } });
    if (!user) throw new AppError('대상을 찾을 수 없습니다.', 404);

    const existing = await prisma.follow.findUnique({
      where: { followerId_followingId: { followerId: me, followingId: target } }, select: { id: true },
    });
    if (!existing) {
      await prisma.follow.create({ data: { followerId: me, followingId: target } });
      // 상대에게 알림 (내 프로필로) — 멱등: 이미 이웃이면 알림 재발송 안 함
      try {
        const meUser = await prisma.user.findUnique({ where: { id: me }, select: { name: true, nickname: true } });
        await prisma.notification.create({
          data: {
            userId: target,
            type: 'NEIGHBOR_FOLLOW',
            message: `${meUser ? displayName(meUser) : '누군가'}님이 회원님을 이웃으로 추가했습니다.`,
            linkUrl: `/portfolio/${me}`,
            refKey: `follow:${me}->${target}`,
          },
        });
      } catch { /* best-effort */ }
    }
    const followerCount = await prisma.follow.count({ where: { followingId: target } });
    res.json({ following: true, followerCount });
  } catch (e) { next(e); }
});

// 이웃 취소
router.delete('/:userId', authenticate, async (req, res, next) => {
  try {
    const me = req.user!.id;
    const target = parseInt(req.params.userId as string);
    await prisma.follow.deleteMany({ where: { followerId: me, followingId: target } });
    const followerCount = await prisma.follow.count({ where: { followingId: target } });
    res.json({ following: false, followerCount });
  } catch (e) { next(e); }
});

// 서로 이웃(양방향 팔로우) 목록 — 메시지창에서 '이웃에게 바로 말 걸기' 용.
// 아무나 검색해 말 거는 게 아니라, **이미 서로 이웃인 사람만** 나온다(설계상 진입점 확장의 유일한 예외).
// ⚠️ 반드시 GET '/:userId' 보다 **먼저** 등록할 것 — 안 그러면 'mutuals'가 userId 로 잡힌다.
router.get('/mutuals', authenticate, async (req, res, next) => {
  try {
    const me = req.user!.id;
    const [iFollow, followMe] = await Promise.all([
      prisma.follow.findMany({ where: { followerId: me }, select: { followingId: true } }),
      prisma.follow.findMany({ where: { followingId: me }, select: { followerId: true } }),
    ]);
    const followMeSet = new Set(followMe.map(f => f.followerId));
    const mutualIds = iFollow.map(f => f.followingId).filter(id => followMeSet.has(id));
    if (mutualIds.length === 0) { res.json([]); return; }
    const users = await prisma.user.findMany({
      where: { id: { in: mutualIds }, deletedAt: null },
      select: { id: true, name: true, nickname: true, avatar: true, role: true },
      orderBy: { name: 'asc' },
    });
    res.json(users);
  } catch (e) { next(e); }
});

// 상태 — 내가 이 사람을 팔로우 중인지 + 팔로워/팔로잉 수 (프로필 버튼용)
router.get('/:userId', optionalAuth, async (req, res, next) => {
  try {
    const me = req.user?.id;
    const target = parseInt(req.params.userId as string);
    if (!Number.isFinite(target)) throw new AppError('대상을 찾을 수 없습니다.', 404);

    const [followerCount, followingCount, mine] = await Promise.all([
      prisma.follow.count({ where: { followingId: target } }),
      prisma.follow.count({ where: { followerId: target } }),
      me ? prisma.follow.findUnique({ where: { followerId_followingId: { followerId: me, followingId: target } }, select: { id: true } }) : null,
    ]);
    res.json({ following: !!mine, followerCount, followingCount, isMe: me === target });
  } catch (e) { next(e); }
});

export default router;
