import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma';
import { AppError } from './errorHandler';
const JWT_SECRET = process.env.JWT_SECRET || 'artlink-dev-secret';

// JWT 페이로드 타입
export interface JwtPayload {
  userId: number;
  role: string;
}

// Express Request 확장
declare global {
  namespace Express {
    interface Request {
      user?: { id: number; role: string; email: string; name: string };
    }
  }
}

// 인증 미들웨어 - 토큰 검증
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new AppError('인증이 필요합니다.', 401);
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, role: true, email: true, name: true }
    });
    if (!user) {
      throw new AppError('유효하지 않은 사용자입니다.', 401);
    }

    req.user = user;
    next();
  } catch (error) {
    if (error instanceof AppError) return next(error);
    next(new AppError('인증 토큰이 유효하지 않습니다.', 401));
  }
}

// 선택적 인증 - 토큰이 있으면 검증, 없으면 통과
export async function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return next();

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, role: true, email: true, name: true }
    });
    if (user) {
      req.user = user;
    }
    next();
  } catch {
    next();
  }
}

// 역할 기반 인가 미들웨어
export function authorize(...roles: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new AppError('인증이 필요합니다.', 401));
    }
    if (!roles.includes(req.user.role)) {
      return next(new AppError('권한이 없습니다.', 403));
    }
    next();
  };
}
