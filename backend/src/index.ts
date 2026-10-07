import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import path from 'path';
import dotenv from 'dotenv';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import helmet from 'helmet';

dotenv.config();

import { errorHandler } from './middleware/errorHandler';
import logger from './lib/logger';
import { staticCacheControl } from './lib/staticCache';
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
import kanbanRoutes from './routes/kanban';
import chatRoutes from './routes/chat';
import communityRoutes from './routes/community';
import handleRoutes from './routes/handle';
import followRoutes from './routes/follow';
import storyRoutes from './routes/story';
import mentionRoutes from './routes/mention';
import guestbookRoutes from './routes/guestbook';
import adRoutes from './routes/ad';
import operationRoutes from './routes/operation';
import settingsRoutes from './routes/settings';
import visitRoutes from './routes/visit';
import guestActivityRoutes from './routes/guestActivity';
import seoRoutes from './routes/seo';
import { createSeoHandler, createTemplateLoader, SEO_RATE_LIMITED } from './lib/seoMeta';
import type { SeoKind } from './lib/seoMeta';

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

/*
  보안 헤더 (2026-10-03 점검 S5 — 실서버 응답에 HSTS·iframe 차단·nosniff·Referrer-Policy 가 하나도 없었고 `x-powered-by: Express` 가 나갔다)
  - 남의 사이트가 우리 화면을 iframe 에 넣지 못하게: X-Frame-Options SAMEORIGIN + CSP `frame-ancestors 'self'`.
    ArtLook(마이페이지 안 iframe)은 같은 출처라 그대로 된다.
  - ⚠️ CSP 의 나머지 지시어(script-src 등)는 **넣지 않는다** — 외부 글꼴·pdf.js(jsDelivr)·카카오 로그인·R2 이미지 도메인 목록부터
    만들어야 하고, 하나라도 빠지면 화면이 조용히 깨진다. 그래서 helmet 의 CSP 는 끄고 frame-ancestors 하나만 직접 단다.
  - COOP `same-origin-allow-popups`(카카오 로그인·공유 창), CORP `cross-origin`(이미지·OG 미리보기를 다른 출처가 읽는다).
  - HSTS 는 운영에서만, 하위 도메인은 포함하지 않는다(img.artlink.cc 말고 다른 하위 도메인이 있는지 모른다).
  - 개별 라우트가 다시 정하면 그게 이긴다(예: 이미지 프록시의 `default-src 'none'; sandbox`).
*/
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  frameguard: { action: 'sameorigin' },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  strictTransportSecurity: process.env.NODE_ENV === 'production' ? { maxAge: 15552000, includeSubDomains: false } : false,
}));
app.use((_req, res, next) => { res.setHeader('Content-Security-Policy', "frame-ancestors 'self'"); next(); });

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
// ⚠️ 배경 폴링은 전역 한도에서 뺀다 (2026-09-19). 로그인 사용자가 메시지 화면만 열어둬도 15분에
//    방 8초(112) + 목록 15초(60) + 대화 배지 30초(30) + 알림 배지 30초(30) = **232회** 라 300 을 거의 다 먹었고,
//    탭 둘이면 정상 사용자가 429 를 맞았다. IP 키라 같은 NAT 뒤 사용자끼리 한 버킷을 나누므로 더 빨리 터진다.
//    폴링 GET 만 넉넉한 별도 한도(1,500/15분 ≈ 탭 6개)로 두고, 쓰기·나머지 API 는 종전 300 그대로.
const isPollingRequest = (req: express.Request) =>
  req.method === 'GET' && (/^\/chats(\/|$)/.test(req.path) || req.path === '/notifications/unread-count');
// 비회원 둘러보기 기록(2026-10-03) — 화면을 옮길 때마다 보내므로 전역 300 에서 빼 별도 한도로 센다(비회원의 화면 요청 몫을 먹지 않게).
// 탭 하나는 많아야 5초에 한 번(15분 180회)이라 300 이면 같은 IP 의 탭 둘까지 넉넉하다. 넘치면 429 — 화면은 조용히 버린다(기록만 빠진다).
const isGuestBeacon = (req: express.Request) => req.method === 'POST' && req.path === '/guest-activity';
/**
 * 로그인·가입 한도를 셀 때의 '한 사람' — Cloudflare 가 붙여 주는 실제 접속 주소(`CF-Connecting-IP`)를 먼저 본다(2026-10-08).
 * artlink.cc 는 Cloudflare 를 거쳐 Render(이것도 Cloudflare 엣지 — onrender.com 주소도 `server: cloudflare`)로 들어온다.
 * Render 앞단 프록시가 여러 겹이라 `trust proxy 1` 로 고른 `req.ip` 가 그중 하나의 주소일 수 있어, 그대로 세면 같은 엣지를 지나는
 * 여러 사람이 한 칸을 나눠 써서 **남 때문에 인증번호를 못 받는** 일이 생긴다. Cloudflare 는 이 헤더를 직접 채우고 클라이언트가 보낸 값을
 * 덮어쓴다(Render 서비스에는 Cloudflare 를 거치지 않고 닿는 길이 없다). 없으면(로컬) `req.ip`. IPv6 는 `ipKeyGenerator` 가 대역으로 묶는다.
 * ⚠️ 이 판단이 틀려 헤더를 위조할 수 있더라도 버티게, 로그인은 **이메일별로도** 센다(lib/loginThrottle.ts — 15분 10번),
 *    인증번호는 번호당 5번·주소당 1시간 5번·하루 300통(lib/emailCode.ts)이 IP 와 무관하게 막는다.
 */
const clientKey = (req: express.Request) => ipKeyGenerator(String(req.headers['cf-connecting-ip'] || req.ip || ''));
if (process.env.NODE_ENV !== 'test' && process.env.DISABLE_RATE_LIMIT !== 'true') {
  app.use('/api', rateLimit({ windowMs: 15 * 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false, skip: (req) => isPollingRequest(req) || isGuestBeacon(req) }));
  app.use('/api', rateLimit({ windowMs: 15 * 60 * 1000, max: 1500, standardHeaders: true, legacyHeaders: false, skip: (req) => !isPollingRequest(req) }));
  app.use('/api', rateLimit({ windowMs: 15 * 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false, skip: (req) => !isGuestBeacon(req) }));
  // 로그인·가입 시도만 엄하게(15분 30회). 예전엔 `/api/auth` 전체였는데 마이페이지·PDF 만들기·홈페이지 편집이 열 때마다 `/auth/me` 를,
  // 주소·닉네임 입력이 중복 확인을 부르는 것까지 세어, 같은 와이파이의 여러 명이 쓰면 **15분간 로그인이 막혔다**(2026-10-03 점검 P2-17).
  // 그 조회들은 위의 전역 한도(300)로 센다.
  // 이메일 인증번호(받기·확인)·이메일 가입·비밀번호 재설정(2026-10-08)도 같은 한도로 센다 — 번호 맞히기·주소 조회를 IP 단위로 막는다
  const isSignInAttempt = (req: express.Request) =>
    req.method === 'POST' && /^\/(login|signup|kakao|complete-registration|dev-login|email\/code|email\/verify|email-signup|password\/reset)$/.test(req.path);
  app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false, keyGenerator: clientKey, skip: (req) => !isSignInAttempt(req) }));
  // 인증번호 메일 보내기는 IP 당 1시간 10번 — 메일 한 통마다 Gmail 하루 한도(약 500, 홍보 메일과 같은 계정)를 쓴다(lib/emailCode.ts DAILY_SEND_MAX 와 함께)
  app.use('/api/auth/email/code', rateLimit({ windowMs: 60 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false, keyGenerator: clientKey, skip: (req) => req.method !== 'POST',
    message: { error: '인증번호를 너무 여러 번 받았어요. 1시간 뒤에 다시 시도해 주세요.' } }));
}

// API 응답은 절대 HTTP 캐시하지 않음.
// Cache-Control이 없으면 Safari 등이 ETag 기반 휴리스틱 캐싱으로 오래된(내 공모 생성 전이거나
// 빈) 목록을 계속 보여주는 문제가 있음(크롬은 보수적이라 재현 안 됨). 서비스워커도 /api는
// 캐싱하지 않으므로 여기서 no-store만 명시하면 브라우저 HTTP 캐시로 인한 stale 목록이 사라진다.
// 클라이언트 캐싱은 TanStack Query가 메모리에서 담당하므로 no-store가 성능에 영향 없음.
// (개별 라우트가 이후 res.setHeader로 재지정하면 그 값이 우선 — 예: 업로드 이미지 max-age)
app.use('/api', (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

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
app.use('/api/kanban', kanbanRoutes);
app.use('/api/chats', chatRoutes);
app.use('/api/community', communityRoutes);
// 주소 `/@handle` 이 작가인지 갤러리인지 (2026-09-16)
app.use('/api/handles', handleRoutes);
app.use('/api/follow', followRoutes);
app.use('/api/stories', storyRoutes);
app.use('/api/mentions', mentionRoutes);
app.use('/api/guestbook', guestbookRoutes);
app.use('/api/ads', adRoutes);
app.use('/api/operations', operationRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/visits', visitRoutes);   // 일간 방문 기록(2026-09-28, Admin [통계])
app.use('/api/guest-activity', guestActivityRoutes);   // 비회원 둘러보기(2026-10-03, Admin [통계])

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

// robots.txt / sitemap.xml (검색엔진 색인 진입로)
// SPA 와일드카드보다 앞에 두어야 index.html이 아닌 실제 파일이 응답된다.
app.use('/', seoRoutes);

// 프론트엔드 정적 파일 제공 (프로덕션)
if (process.env.NODE_ENV === 'production') {
  const distPath = path.join(__dirname, '../../frontend/dist');
  // 캐시 만료 정책은 `lib/staticCache.ts` 한 곳 — 해시 번들(assets/)만 1년 immutable, 앱 셸은 no-store,
  // 그 밖의 고정 이름 파일(ArtLook·회사 정보 등)은 no-cache(ETag 재확인).
  // ⚠️ 예전엔 assets 가 아닌 것까지 1년 immutable 이라 ArtLook 의 scene.js 가 엣지에 옛 판으로 굳어 있었다(2026-10-04).
  app.use(express.static(distPath, {
    index: false,
    // 헤더는 setHeaders 가 전부 정한다 — maxAge·immutable 을 주면 serve-static 이 먼저 1년을 적는다
    cacheControl: false,
    setHeaders: (res, filePath) => {
      res.setHeader('Cache-Control', staticCacheControl(path.relative(distPath, filePath)));
    },
  }));
  // ── 상세 페이지 SEO 메타 주입 ──────────────────────────────────────────
  // 아래 기존 와일드카드는 수정하지 않는다. 명시 라우트 4개를 앞에 추가만 하고,
  // 조건 미달(비정수 id·미승인/탈퇴·DB 실패·SEO_META=off)이면 next()로 와일드카드가 원본을 내려준다.
  const loadSeoTemplate = createTemplateLoader(path.join(distPath, 'index.html'));
  const seoLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 800,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => process.env.DISABLE_RATE_LIMIT === 'true',
    // 초과해도 429로 막지 않는다 — 표시만 남기고 '메타 주입'만 생략한다.
    // (429를 던지면 공유 링크로 트래픽이 몰릴 때 정상 사용자의 페이지가 안 열린다)
    handler: (req, _res, next) => {
      (req as unknown as Record<symbol, unknown>)[SEO_RATE_LIMITED] = true;
      next();
    },
  });
  const SEO_ROUTES: [string, SeoKind][] = [
    ['/exhibitions/:id', 'exhibition'],
    ['/galleries/:id', 'gallery'],
    ['/shows/:id', 'show'],
    ['/portfolio/:id', 'portfolio'],
    // 작가 핸들 주소(2026-09-16). 프론트 라우트 `/@:handle` 과 짝.
    ['/@:handle', 'portfolio'],
  ];
  for (const [route, kind] of SEO_ROUTES) {
    app.get(route, seoLimiter, createSeoHandler(kind, loadSeoTemplate));
  }

  app.get('/{*path}', (_req, res) => {
    res.set('Cache-Control', 'no-store');
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
