import { Request, Response, NextFunction } from 'express';
import logger from '../lib/logger';

// 커스텀 에러 클래스
export class AppError extends Error {
  statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
  }
}

// 글로벌 에러 핸들러
export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction) {
  const meta = {
    method: req.method,
    url: req.originalUrl,
    userId: (req as any).user?.id,
    stack: err.stack?.split('\n').slice(0, 5).join(' | '),
  };

  if (err instanceof AppError) {
    // 비즈니스 에러 (4xx) — WARN 레벨
    if (err.statusCode >= 500) {
      logger.error('AppError', err.message, meta);
    } else {
      logger.warn('AppError', err.message, meta);
    }
    return res.status(err.statusCode).json({ error: err.message });
  }

  // 잘못된 입력값(타입 불일치 등) — Prisma 검증 에러 → 400
  if (err.name === 'PrismaClientValidationError') {
    logger.warn('PrismaValidation', err.message, meta);
    return res.status(400).json({ error: '입력값 형식이 올바르지 않습니다.' });
  }

  // 파일 업로드 에러(용량 초과 등) → 400
  if (err.name === 'MulterError') {
    logger.warn('MulterError', err.message, meta);
    return res.status(400).json({ error: `파일 업로드 오류: ${err.message}` });
  }

  // Prisma 에러 처리
  if (err.name === 'PrismaClientKnownRequestError') {
    logger.error('PrismaError', err.message, { ...meta, code: (err as any).code });
    return res.status(400).json({ error: '데이터 처리 중 오류가 발생했습니다.' });
  }

  // Prisma 커넥션 풀 타임아웃
  if (err.name === 'PrismaClientInitializationError' ||
      err.message?.includes('connection pool') ||
      err.message?.includes('timed out')) {
    logger.error('DB_POOL', `커넥션 풀 고갈/타임아웃: ${err.message}`, meta);
    return res.status(503).json({ error: '서버가 일시적으로 바쁩니다. 잠시 후 다시 시도해주세요.' });
  }

  // body-parser 에러 (잘못된 JSON 문법, 100kb 초과 등)는 자체 status(400/413)를 가진다
  const bodyErrStatus = (err as any).status ?? (err as any).statusCode;
  if (typeof bodyErrStatus === 'number' && bodyErrStatus >= 400 && bodyErrStatus < 500) {
    logger.warn('BodyParser', err.message, meta);
    const msg = bodyErrStatus === 413 ? '요청 본문이 너무 큽니다.' : '요청 형식이 올바르지 않습니다.';
    return res.status(bodyErrStatus).json({ error: msg });
  }

  // 알 수 없는 서버 에러
  logger.error('UnhandledError', err.message, meta);
  return res.status(500).json({ error: '서버 내부 오류가 발생했습니다.' });
}
