import express, { Router } from 'express';
import { AppError } from '../middleware/errorHandler';
import { cleanGuestViews, GUEST_OUTCOMES, GUEST_VISIT_ID_RE, guestActivityEnabled, recordGuestActivity, type GuestOutcome } from '../lib/guestActivity';

/**
 * 비회원 둘러보기 기록 (2026-10-03) — `POST /api/guest-activity { visitId, views: [{seq, path, ms}], outcome?, left? }`. 규칙은 `lib/guestActivity.ts`.
 *
 * 화면(`frontend/src/lib/guestActivity.ts`)이 화면을 옮기거나 창이 가려질 때 `navigator.sendBeacon` 으로 보낸다 —
 * 탭을 닫는 순간에도 보내지려면 그래야 한다. sendBeacon 은 헤더를 못 다니 본문이 `text/plain` 으로 온다(JSON 문자열).
 * 인증 헤더도 없다 — 이 기록은 원래 계정과 잇지 않는다. `left` 는 창을 닫거나 다른 사이트로 떠날 때(pagehide)만 온다.
 * 응답은 204 — 화면이 기다리지 않는다(실패해도 사용자 동작과 무관). 형식이 틀리면 400.
 */
const router = Router();

router.post('/', express.text({ type: 'text/plain', limit: '16kb' }), async (req, res, next) => {
  try {
    // 끄개(`GUEST_ACTIVITY=off`) — 읽지도 쓰지도 않고 바로 돌려보낸다
    if (!guestActivityEnabled()) { res.status(204).end(); return; }
    let body: unknown = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { throw new AppError('잘못된 요청입니다.', 400); }
    }
    const { visitId, views, outcome, left } = (body ?? {}) as Record<string, unknown>;
    if (typeof visitId !== 'string' || !GUEST_VISIT_ID_RE.test(visitId)) throw new AppError('잘못된 요청입니다.', 400);
    const cleaned = cleanGuestViews(views);
    const result = GUEST_OUTCOMES.includes(outcome as GuestOutcome) ? (outcome as GuestOutcome) : null;
    if (!cleaned.length && !result && left !== true) { res.status(204).end(); return; }
    await recordGuestActivity(visitId, { views: cleaned, outcome: result, left: left === true });
    res.status(204).end();
  } catch (error) { next(error); }
});

export default router;
