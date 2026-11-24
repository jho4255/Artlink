/**
 * PDF 문서의 대체 글꼴 (2026-11-24, 규칙 92) — `GET /api/fonts/fallback?set=cjk|emoji&weight=400|700&text=<글자들>`.
 * 한자·이모지를 **쓰인 글자만** 담은 TTF 를 돌려준다. 까닭과 규칙은 `lib/fallbackFont.ts`.
 *
 * 로그인한 사람만(문서는 운영자·작가가 로그인해서 만든다 — 아무나 쓰는 중계가 되지 않게).
 * 구글에서 못 받으면 502 — 화면은 문서를 그대로 만들고 '한자 일부를 불러오지 못했어요'를 알린다.
 */
import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { FALLBACK_SETS, FALLBACK_WEIGHTS, cleanFallbackText, fetchFallbackFont, type FallbackSet } from '../lib/fallbackFont';
import logger from '../lib/logger';

const router = Router();

router.get('/fallback', authenticate, async (req, res, next) => {
  try {
    const set = String(req.query.set ?? '');
    if (!Object.prototype.hasOwnProperty.call(FALLBACK_SETS, set)) throw new AppError('글꼴 종류가 올바르지 않습니다.', 400);
    const weight = Number(req.query.weight ?? 400);
    if (!(FALLBACK_WEIGHTS as readonly number[]).includes(weight)) throw new AppError('글꼴 굵기가 올바르지 않습니다.', 400);
    const text = cleanFallbackText(req.query.text);
    if (!text) throw new AppError('글자가 없거나 너무 많습니다.', 400);

    let font: Buffer;
    try {
      font = await fetchFallbackFont(set as FallbackSet, weight, text);
    } catch (e) {
      logger.warn('Fonts', `대체 글꼴을 받지 못함 (${set} ${weight}, ${Array.from(text).length}자): ${e instanceof Error ? e.message : e}`);
      throw new AppError('글꼴을 불러오지 못했어요.', 502);
    }
    res.setHeader('Content-Type', 'font/ttf');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.send(font);
  } catch (error) { next(error); }
});

export default router;
