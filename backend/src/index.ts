import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

import { errorHandler } from './middleware/errorHandler';
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
app.use(morgan('dev'));

// 정적 파일 제공 (업로드된 이미지)
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

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

// 헬스 체크
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 프로덕션 환경: 프론트엔드 정적 파일 서빙 (모놀리스 배포용)
if (process.env.NODE_ENV === 'production') {
  const frontendDistPath = path.join(__dirname, '../../frontend/dist');
  app.use(express.static(frontendDistPath));
  // SPA fallback: API 라우트가 아닌 모든 요청을 index.html로
  app.get('*', (_req, res) => {
    res.sendFile(path.join(frontendDistPath, 'index.html'));
  });
}

// 에러 핸들러 (반드시 마지막에 등록)
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`🚀 ArtLink 백엔드 서버 실행 중: http://localhost:${PORT}`);
});

export default app;
