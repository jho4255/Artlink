import { Request, Response, NextFunction } from 'express';
import { ZodSchema } from 'zod';
import { AppError } from './errorHandler';

// Zod 스키마 기반 입력 검증 미들웨어
export function validate(schema: ZodSchema) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return next(new AppError(result.error.issues[0].message, 400));
    }
    req.body = result.data;
    next();
  };
}
