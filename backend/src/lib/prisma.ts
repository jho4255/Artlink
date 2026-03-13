import { PrismaClient } from '@prisma/client';
import logger from './logger';

// 싱글톤 Prisma 클라이언트 (개발 중 핫 리로딩 시 연결 과다 방지)
// 커넥션 풀: DATABASE_URL의 connection_limit 파라미터로 설정 (기본 10 → 20 권장)
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma = globalForPrisma.prisma || new PrismaClient({
  log: [
    { emit: 'event', level: 'error' },
    { emit: 'event', level: 'warn' },
    ...(process.env.NODE_ENV !== 'production'
      ? [{ emit: 'event' as const, level: 'query' as const }]
      : []),
  ],
});

// Prisma 이벤트 로깅
prisma.$on('error' as never, (e: any) => {
  logger.error('Prisma', e.message, { target: e.target });
});

prisma.$on('warn' as never, (e: any) => {
  logger.warn('Prisma', e.message, { target: e.target });
});

// 개발 환경: slow query 로깅 (100ms 초과)
if (process.env.NODE_ENV !== 'production') {
  prisma.$on('query' as never, (e: any) => {
    if (e.duration > 100) {
      logger.slowQuery(e.query, e.duration);
    }
  });
}

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export default prisma;
