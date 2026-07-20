/**
 * 런타임 기능 플래그 조회 (/api/settings)
 *
 * GET /flags — 로그인 유저 누구나. Admin 개발자 도구에서 켠 전역 플래그를
 * 프론트(지원자 관리 UI 등)가 읽어 조건부 UI를 노출하는 용도.
 * 토글 변경 자체는 /api/admin/dev-settings (ADMIN 전용).
 */
import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { getSettingBool, ALLOW_ACCEPTED_REVERT } from '../lib/appSettings';

const router = Router();

router.get('/flags', authenticate, async (_req, res, next) => {
  try {
    res.json({ allowAcceptedRevert: await getSettingBool(ALLOW_ACCEPTED_REVERT) });
  } catch (e) { next(e); }
});

export default router;
