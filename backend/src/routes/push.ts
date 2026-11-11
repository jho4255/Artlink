import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import '../lib/push'; // 벨 알림 → 기기 푸시 갈고리를 꽂는다(lib/push.ts 맨 아래)

/**
 * 앱 기기 토큰 (2026-11-09, CLAUDE.md 규칙 79) — 안드로이드 앱(frontend lib/native.ts)이 로그인하면 등록, 로그아웃하면 지운다.
 */
const router = Router();

const tokenField = z.string().trim().min(20, '토큰이 올바르지 않습니다.').max(4096, '토큰이 올바르지 않습니다.');

// PUT /push/tokens — 이 기기를 지금 로그인한 사람에게 묶는다. 같은 기기에서 다른 사람이 로그인하면 그 사람으로 옮겨진다.
// ⚠️ upsert(ON CONFLICT) 한 번 — '있나 보고 만들기'면 동시에 두 번 오면 하나가 unique 위반으로 400 이 된다(규칙 46)
router.put('/tokens', authenticate, validate(z.object({ token: tokenField, platform: z.enum(['android', 'ios']) })), async (req, res, next) => {
  try {
    const { token, platform } = req.body as { token: string; platform: string };
    await prisma.pushToken.upsert({
      where: { token },
      create: { token, platform, userId: req.user!.id },
      update: { userId: req.user!.id, platform, lastSeenAt: new Date() },
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// DELETE /push/tokens — 이 기기로 가던 알림을 끊는다. **인증 없이** — 토큰 값이 곧 자격이다(앱만 아는 긴 무작위 값).
// 로그인이 만료돼 자동 로그아웃(401)될 때도 지워져야 한다. 인증을 요구하면 그때 못 지워 로그아웃한 기기로 남의 알림이 계속 간다.
router.delete('/tokens', validate(z.object({ token: tokenField })), async (req, res, next) => {
  try {
    const { count } = await prisma.pushToken.deleteMany({ where: { token: (req.body as { token: string }).token } });
    res.json({ ok: true, removed: count });
  } catch (err) {
    next(err);
  }
});

export default router;
