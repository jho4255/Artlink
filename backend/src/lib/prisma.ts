import { PrismaClient, type Prisma } from '@prisma/client';
import logger from './logger';

// 싱글톤 Prisma 클라이언트 (개발 중 핫 리로딩 시 연결 과다 방지)
// 커넥션 풀: DATABASE_URL의 connection_limit 파라미터로 설정 (기본 10 → 20 권장)
type NotificationHook = (params: Prisma.MiddlewareParams, result: unknown) => void;
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient;
  notificationHook?: NotificationHook;
  notificationHookInstalled?: boolean;
};

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

/**
 * 벨 알림(Notification) 쓰기를 지켜보는 갈고리 (2026-11-09, 규칙 79 — 앱 푸시). 채우는 쪽은 lib/push.ts 하나다.
 * 알림을 만드는 34곳을 하나씩 고치지 않고 여기서 한 번에 본다.
 * ⚠️ 미들웨어는 **클라이언트당 한 번만** 걸고, 부를 함수는 자리(notificationHook)에 꽂는다 — 테스트는 파일마다 모듈을 새로 읽지만
 *    클라이언트는 globalThis 로 같이 쓴다. 파일마다 $use 를 걸면 옛 모듈을 붙잡은 미들웨어가 쌓여 지난 파일의 것까지 불린다.
 * ⚠️ 갈고리가 던져도 알림 저장은 그대로 끝난다(결과를 먼저 받아 두고, 실패는 삼킨다).
 */
export function setNotificationHook(fn: NotificationHook | undefined): void {
  globalForPrisma.notificationHook = fn;
}
if (!globalForPrisma.notificationHookInstalled) {
  globalForPrisma.notificationHookInstalled = true;
  prisma.$use(async (params, next) => {
    const result = await next(params);
    if (params.model === 'Notification') {
      try { globalForPrisma.notificationHook?.(params, result); } catch { /* 푸시는 덤이다 */ }
    }
    return result;
  });
}

export default prisma;
