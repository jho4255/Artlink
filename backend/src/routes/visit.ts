import { Router } from 'express';
import { optionalAuth } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { recordVisit, VISITOR_ID_RE } from '../lib/visitStats';

/**
 * 방문 기록 (2026-09-28) — `POST /api/visits { visitorId }`. 로그인해 있으면(optionalAuth) 회원으로 붙는다.
 * 화면(`frontend/src/lib/visitBeacon.ts`)이 하루 한 번 보낸다. 규칙은 `lib/visitStats.ts`.
 * 응답은 204 — 화면이 기다릴 이유가 없다(실패해도 사용자 동작에는 영향이 없어야 한다).
 */
const router = Router();

router.post('/', optionalAuth, async (req, res, next) => {
  try {
    const visitorId = req.body?.visitorId;
    if (typeof visitorId !== 'string' || !VISITOR_ID_RE.test(visitorId)) throw new AppError('잘못된 요청입니다.', 400);
    await recordVisit(visitorId, req.user?.id ?? null);
    res.status(204).end();
  } catch (error) { next(error); }
});

export default router;
