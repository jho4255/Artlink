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
const PORT = process.env.PORT || 4000;

// 미들웨어 설정
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? true  // 모놀리스 배포: same-origin 허용
    : (process.env.FRONTEND_URL || 'http://localhost:5173'),
  credentials: true
}));
app.use(express.json());
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('dev'));
}

// 정적 파일 제공 (업로드된 이미지)
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// Rate limiting (보안: 과도한 요청 방지, 테스트 시 비활성화)
// 15분에 300회로 완화 (기존 100회 → SPA 특성상 페이지 로드에 다수 API 호출 필요)
if (process.env.NODE_ENV !== 'test') {
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

// 프로덕션 환경: 프론트엔드 정적 파일 서빙 (모놀리스 배포용)
if (process.env.NODE_ENV === 'production') {
  const frontendDistPath = path.join(__dirname, '../../frontend/dist');
  app.use(express.static(frontendDistPath));
  // SPA fallback: API 라우트가 아닌 모든 요청을 index.html로
  // Express v5에서는 '*' 대신 '{*path}' 문법 사용
  app.get('/{*path}', (_req, res) => {
    res.sendFile(path.join(frontendDistPath, 'index.html'));
  });
}

// 에러 핸들러 (반드시 마지막에 등록)
app.use(errorHandler);

// 테스트 환경에서는 supertest가 자체 포트 사용하므로 listen 생략
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, '0.0.0.0', () => {
    logger.info('Server', `ArtLink 백엔드 서버 실행 중: http://0.0.0.0:${PORT}`);
  });
}

export default app;
