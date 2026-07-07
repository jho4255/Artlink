import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import path from 'path';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';

dotenv.config();

import { errorHandler } from './middleware/errorHandler';
import logger from './lib/logger';
import authRoutes from './routes/auth';
import heroRoutes from './routes/hero';
import galleryRoutes from './routes/gallery';
import exhibitionRoutes from './routes/exhibition';
import reviewRoutes from './routes/review';
import favoriteRoutes from './routes/favorite';
import portfolioRoutes from './routes/portfolio';
import approvalRoutes from './routes/approval';
import benefitRoutes from './routes/benefit';
import galleryOfMonthRoutes from './routes/galleryOfMonth';
import uploadRoutes from './routes/upload';
import showRoutes from './routes/show';
import notificationRoutes from './routes/notification';
import inquiryRoutes from './routes/inquiry';
import exploreRoutes from './routes/explore';
import messageRoutes from './routes/message';
import reportRoutes from './routes/report';
import adminRoutes from './routes/admin';
import operationRoutes from './routes/operation';

// ===== 전역 에러 핸들러: 프로세스 크래시 방지 =====
process.on('unhandledRejection', (reason: any) => {
  logger.error('Process', `Unhandled Promise Rejection: ${reason?.message || reason}`, {
    stack: reason?.stack?.split('\n').slice(0, 5).join(' | '),
  });
});

process.on('uncaughtException', (err: Error) => {
  logger.error('Process', `Uncaught Exception: ${err.message}`, {
    stack: err.stack?.split('\n').slice(0, 5).join(' | '),
  });
  // uncaughtException 이후에도 프로세스를 유지 (graceful하지 않지만 서비스 연속성 확보)
  // 프로덕션에서는 PM2 등 프로세스 매니저가 자동 재시작
});

const app = express();
const PORT = Number(process.env.PORT) || 4000;

// Render 등 리버스 프록시 환경에서 X-Forwarded-For 신뢰
app.set('trust proxy', 1);

// 미들웨어 설정
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:5173', credentials: true }));
app.use(express.json());
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('dev'));
}

// 정적 파일 제공 (업로드된 이미지)
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// Rate limiting (보안: 과도한 요청 방지, 테스트 시 비활성화)
// 15분에 300회로 완화 (기존 100회 → SPA 특성상 페이지 로드에 다수 API 호출 필요)
// DISABLE_RATE_LIMIT=true 시 비활성화 (로컬 E2E 전용 — 운영에선 절대 설정하지 않음)
if (process.env.NODE_ENV !== 'test' && process.env.DISABLE_RATE_LIMIT !== 'true') {
  app.use('/api', rateLimit({ windowMs: 15 * 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false }));
  app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false }));
}

// API 라우트
app.use('/api/auth', authRoutes);
app.use('/api/hero-slides', heroRoutes);
app.use('/api/galleries', galleryRoutes);
app.use('/api/exhibitions', exhibitionRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/favorites', favoriteRoutes);
app.use('/api/portfolio', portfolioRoutes);
app.use('/api/approvals', approvalRoutes);
app.use('/api/benefits', benefitRoutes);
app.use('/api/gallery-of-month', galleryOfMonthRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/shows', showRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/inquiries', inquiryRoutes);
app.use('/api/explore', exploreRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/operations', operationRoutes);

// 헬스 체크 (DB 연결 상태 포함)
app.get('/api/health', async (_req, res) => {
  try {
    const { prisma } = await import('./lib/prisma');
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', db: 'connected', timestamp: new Date().toISOString() });
  } catch (err: any) {
    logger.error('Health', `DB 연결 실패: ${err.message}`);
    res.status(503).json({ status: 'degraded', db: 'disconnected', timestamp: new Date().toISOString() });
  }
});

// 매칭되지 않은 /api 경로는 SPA(index.html)로 흘리지 않고 404 JSON 반환
// (그렇지 않으면 오타/미존재 API가 200+HTML로 응답돼 클라이언트가 오작동)
app.use('/api', (_req, res) => {
  res.status(404).json({ error: '요청한 API를 찾을 수 없습니다.' });
});

// 프론트엔드 정적 파일 제공 (프로덕션)
if (process.env.NODE_ENV === 'production') {
  const distPath = path.join(__dirname, '../../frontend/dist');
  // 해시된 번들은 장기 캐시(immutable), index.html은 항상 재검증(no-cache)
  app.use(express.static(distPath, {
    maxAge: '1y',
    immutable: true,
    index: false,
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
    },
  }));
  app.get('/{*path}', (_req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

// 에러 핸들러
app.use(errorHandler);

// 테스트 환경에서는 supertest가 자체 포트 사용하므로 listen 생략
if (process.env.NODE_ENV !== 'test') {
  const server = app.listen(PORT, '0.0.0.0', () => {
    logger.info('Server', `ArtLink 백엔드 서버 실행 중: http://0.0.0.0:${PORT}`);
  });

  // Graceful shutdown: 배포/재시작 시 SIGTERM에 진행 중 요청을 정리하고 Prisma 연결 해제
  const shutdown = (signal: string) => {
    logger.info('Server', `${signal} 수신 — graceful shutdown 시작`);
    server.close(async () => {
      try {
        const { prisma } = await import('./lib/prisma');
        await prisma.$disconnect();
      } catch { /* 무시 */ }
      process.exit(0);
    });
    // 10초 내 정리되지 않으면 강제 종료
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

export default app;
