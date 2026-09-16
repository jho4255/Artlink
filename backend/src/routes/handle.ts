/**
 * `/@handle` 이 누구인지 알려 주는 단 하나의 라우트 (2026-09-16).
 *
 * 작가와 갤러리가 **같은 이름 공간**을 쓰므로 화면은 `/@x` 만 보고 어느 페이지를 열지 알 수 없다.
 * 화면(`HandleRoute`)이 여기 한 번 물어보고 작가 페이지 또는 갤러리 페이지를 렌더한다.
 * 서버 SEO(`lib/seoMeta.ts`)도 같은 `resolveHandle()` 을 쓴다 — 둘이 다른 곳을 가리키면 안 된다.
 *
 * 공개 라우트다. 없으면 404(403 은 "그 주소에 뭔가 있다"를 알려 주는 셈이다 — CLAUDE.md 23).
 */
import { Router } from 'express';
import { AppError } from '../middleware/errorHandler';
import { resolveHandle } from '../lib/handle';

const router = Router();

router.get('/:handle', async (req, res, next) => {
  try {
    const found = await resolveHandle(String(req.params.handle ?? ''));
    if (!found) throw new AppError('주소를 찾을 수 없습니다.', 404);
    res.json(found);
  } catch (error) { next(error); }
});

export default router;
