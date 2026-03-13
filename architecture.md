# ArtLink 아키텍처 문서

> 최종 업데이트: 2026-03-11 (Phase 1-10 + 버그 수정 + Render.com 배포 + UX/버그 4건 + Vitest + tel링크 + PWA캐시갱신 + Instagram 피드 연동)

## 시스템 구조

```
ArtLink/
├── frontend/              # React 클라이언트 (Vite + TypeScript)
│   ├── src/
│   │   ├── components/    # UI 컴포넌트
│   │   │   ├── layout/    # Navbar, Layout (공통 레이아웃)
│   │   │   ├── home/      # SplashScreen, HeroSlider, QuickActionCards, GalleryOfMonth
│   │   │   ├── gallery/   # InstagramFeed, InstagramPrivateMessage
│   │   │   └── shared/    # ProtectedRoute, ImageUpload, MultiImageUpload
│   │   ├── pages/         # 라우트별 페이지
│   │   ├── stores/        # Zustand 상태 관리 (authStore)
│   │   ├── lib/           # axios 인스턴스, queryClient, utils
│   │   └── types/         # TypeScript 타입 정의
│   └── public/            # 정적 파일, PWA 아이콘
├── backend/               # Express API 서버 (TypeScript)
│   ├── prisma/
│   │   ├── schema.prisma  # 데이터 모델 (Single Source of Truth)
│   │   └── seed.ts        # 초기 데이터
│   ├── uploads/           # 업로드된 이미지 파일
│   └── src/
│       ├── index.ts       # 서버 엔트리 포인트
│       ├── routes/        # API 라우트 (11개 모듈)
│       ├── middleware/     # auth, errorHandler
│       └── lib/           # prisma 싱글톤, mailer (nodemailer)
├── docker-compose.yml     # PostgreSQL (프로덕션용)
├── run_web.sh             # 로컬 개발 자동 실행 스크립트
├── REQUIREMENTS_CHECKLIST.md  # 요구사항 체크리스트
└── architecture.md        # 이 문서
```

## 기술 스택

| 레이어 | 기술 | 버전 |
|--------|------|------|
| 프론트엔드 | React + Vite + TypeScript | React 19, Vite 7 |
| 라우팅 | React Router | v6 |
| 서버 상태 | TanStack Query | v5 |
| 클라이언트 상태 | Zustand | v5 (persist middleware) |
| 스타일링 | Tailwind CSS | v4 |
| 애니메이션 | Framer Motion | - |
| 아이콘 | Lucide React | - |
| 알림 | react-hot-toast | - |
| PWA | vite-plugin-pwa (skipWaiting+clientsClaim) | v1.2.0 |
| 테스트 | Vitest + supertest (67 tests) | v4.0.18 |
| 백엔드 | Express + TypeScript | - |
| ORM | Prisma | v5 (⚠️ v7 사용 금지) |
| DB | PostgreSQL | 로컬: apt 설치, 배포: Render PostgreSQL |
| 인증 | JWT (개발: 퀵 로그인) | - |
| 파일 업로드 | Multer + Cloudinary (배포) | v2.1 |
| 배포 | Render.com (모놀리스) | `deploy/render` 브랜치 |

## 데이터 모델 (14개 테이블)

- **User** — 사용자 (ARTIST / GALLERY / ADMIN)
- **Gallery** — 갤러리 (승인 워크플로우: PENDING → APPROVED / REJECTED)
- **GalleryImage** — 갤러리 이미지 (1:N)
- **Exhibition** — 전시/공모 (승인 워크플로우)
- **PromoPhoto** — 전시 종료 후 홍보 사진
- **HeroSlide** — 히어로 슬라이드 (Admin 관리)
- **Benefit** — 혜택 (Admin 관리)
- **GalleryOfMonth** — 이달의 갤러리 (자동 만료)
- **Review** — 갤러리 리뷰 (별점, 익명 옵션, 사진)
- **Favorite** — 찜하기 (갤러리/공모)
- **Portfolio** — 아티스트 포트폴리오
- **PortfolioImage** — 포트폴리오 이미지 (최대 30개)
- **Application** — 공모 지원
- **ApprovalRequest** — 수정 승인 요청

## API 엔드포인트 (11개 라우트 모듈)

| 모듈 | 경로 | 주요 기능 |
|------|------|----------|
| auth | /api/auth | 개발 퀵 로그인, 유저 정보, 아바타 변경 |
| hero | /api/hero-slides | 슬라이드 CRUD (Admin) |
| gallery | /api/galleries | 갤러리 목록/상세/등록/이미지/상세수정/삭제(Admin)/Instagram연동 |
| exhibition | /api/exhibitions | 공모 목록/상세/등록/지원(+이메일)/내 지원/내 공모/홍보사진/삭제(오너/Admin) |
| review | /api/reviews | 리뷰 CRUD, 별점 자동 계산, 익명 |
| favorite | /api/favorites | 찜하기 토글 (갤러리/공모) |
| portfolio | /api/portfolio | 포트폴리오 CRUD, 이미지 관리 |
| approval | /api/approvals | 승인 큐, 수정 요청 관리 |
| benefit | /api/benefits | 혜택 CRUD (Admin) |
| galleryOfMonth | /api/gallery-of-month | 이달의 갤러리 (자동 만료) |
| upload | /api/upload | 이미지 업로드 (Multer) |

## 인증 구조

```
클라이언트 → [Axios 인터셉터: Bearer 토큰 자동 첨부]
          → 백엔드 [authenticate 미들웨어: JWT 검증]
                   [authorize 미들웨어: 역할 확인]
                   [optionalAuth: 비인증도 허용, 인증 시 추가 정보]
```

- `authStore` (Zustand + localStorage persist) — 토큰/유저 정보 영속화
- 개발: POST /api/auth/dev-login으로 유저 선택 로그인
- 추후: OAuth 교체 시 authStore.login() 호출만 변경

## 프론트엔드 라우트

| 경로 | 페이지 | 인증 |
|------|--------|------|
| / | HomePage | X |
| /galleries | GalleriesPage | X |
| /galleries/:id | GalleryDetailPage | X |
| /exhibitions | ExhibitionsPage | X |
| /exhibitions/:id | ExhibitionDetailPage | X |
| /benefits | BenefitsPage | X |
| /login | LoginPage | X |
| /mypage | MyPage | O (ProtectedRoute) |

## 주요 컴포넌트 가이드

### 페이지별 기능 매핑

| 페이지 | 주요 기능 | 관련 코드 |
|--------|----------|-----------|
| HomePage | Splash, Hero 슬라이더, 캐치프레이즈, 퀵액션, GotM | `components/home/*` |
| GalleriesPage | 갤러리 목록, 지역/별점 필터, 정렬, 찜 | `pages/GalleriesPage.tsx` |
| GalleryDetailPage | 이미지 슬라이더, 찜, 상세수정, 공모목록, 홍보사진, 리뷰 | `pages/GalleryDetailPage.tsx` |
| ExhibitionsPage | 공모 목록, 필터, 카드 클릭→상세 이동, 빠른 지원 | `pages/ExhibitionsPage.tsx` |
| ExhibitionDetailPage | 공모 상세, 지원하기(+이메일), 홍보사진, 삭제(오너/Admin) | `pages/ExhibitionDetailPage.tsx` |
| BenefitsPage | 혜택 목록 | `pages/BenefitsPage.tsx` |
| MyPage | 역할별 탭 (아래 상세) | `pages/MyPage.tsx` |

### MyPage 섹션별 가이드

| 섹션 | 역할 | 기능 |
|------|------|------|
| ProfileCard | 공통 | 아바타 업로드, 로그아웃 |
| PortfolioSection | Artist | 전시이력, 약력, 작품사진(최대30) |
| FavoritesSection | Artist | 갤러리/공모 찜 목록 (탭 분리) |
| MyReviewsSection | Artist | 작성 리뷰 목록 |
| ApplicationsSection | Artist | 지원한 공고 목록 |
| MyGalleriesSection | Gallery | 갤러리 등록 요청, 상태 확인, Instagram 연동/토글 |
| MyExhibitionsSection | Gallery | 공모 등록 요청 (승인된 갤러리 선택), 공모 삭제 |
| ApprovalsSection | Admin | 승인 큐 (승인/거절+사유), 등록 관리 (갤러리/공모 삭제) |
| HeroManageSection | Admin | Hero CRUD + 미리보기 |
| BenefitManageSection | Admin | 혜택 CRUD + 미리보기 |
| GotmManageSection | Admin | 이달의 갤러리 검색/선정/기한 |

## Instagram 피드 연동

### DB 필드 (Gallery 모델)
- `instagramAccessToken` — Graph API 토큰 (서버 전용, 응답에 미노출)
- `instagramFeedVisible` — 피드 공개 여부 (기본 false)
- `instagramUrl` — @handle (토큰 연동 시 자동 설정, 프로필 링크 토글로 null 가능)

### API 엔드포인트
| 메서드 | 경로 | 인증 | 기능 |
|--------|------|------|------|
| POST | /api/galleries/:id/instagram-token | 오너 | Graph API 토큰 검증 및 저장 |
| PATCH | /api/galleries/:id/instagram-profile-visibility | 오너 | @handle 프로필 링크 표시 토글 |
| PATCH | /api/galleries/:id/instagram-visibility | 오너 | 피드 공개/비공개 토글 |
| GET | /api/galleries/:id/instagram-feed | 공개 | 최근 9개 게시물 조회 (best-effort) |

### 토큰 보안
- `maskInstagram()` 헬퍼: 모든 갤러리 응답에서 `instagramAccessToken`을 제거하고 `instagramConnected: boolean`으로 변환
- 토큰은 서버 DB에만 저장, 클라이언트에 노출 안 됨

### 프론트엔드 컴포넌트
- `InstagramFeed.tsx` — 3x3 그리드 + 앱 내 ImageLightbox 확대 (외부 이탈 없음)
- `InstagramPrivateMessage.tsx` — 비공개 상태 안내 (오너에게 설정 링크)
- GalleryDetailPage — Instagram 섹션 (연동 시만 표시)
- MyPage MyGalleriesSection — 토큰 입력 모달 + 프로필/피드 토글 스위치

### 향후 계획
- 현재: 수동 토큰 입력 방식 (Instagram Graph API long-lived token)
- 추후: Instagram OAuth 연동 (Facebook Login 기반)으로 자동 토큰 발급

## 개발 계정 (Seed 데이터)

| ID | 이름 | 역할 | 비고 |
|----|------|------|------|
| 1 | Artist 1 | ARTIST | 포트폴리오 있음 |
| 2 | Artist 2 | ARTIST | - |
| 3 | Gallery Owner | GALLERY | 3개 갤러리 보유 |
| 4 | Admin | ADMIN | 전체 관리 권한 |

## 로컬 개발 실행

```bash
./run_web.sh
# 또는 수동:
cd backend && npx prisma db push && npx ts-node prisma/seed.ts && npx ts-node src/index.ts
cd frontend && npm run dev
```

- 프론트엔드: http://localhost:5173
- 백엔드: http://localhost:4000
- API 프록시: Vite proxy `/api` → `http://localhost:4000/api`

## 검증 결과

- API 테스트: 35/36 통과 (100% - 1개는 테스트 스크립트 regex 이슈)
- 프론트-백엔드 라우트 매칭: 40+개 전수 검증 → 0개 불일치
- E2E 시나리오: 갤러리 등록 → Admin 승인 → 검색 노출 → 공모 등록 → 승인 → Artist 지원 ✅
- 거절 워크플로우: 거절 사유 미입력 시 차단, 사유 입력 시 정상 처리 ✅
- 인증 보호: 비인증 접근 차단, 권한 없는 역할 차단 ✅

## 이메일 전송 (nodemailer)

- 지원하기 시 Artist 포트폴리오를 Gallery 오너에게 자동 전송
- SMTP 설정: `.env`에 `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` 설정
- 미설정 시 콘솔 로그 출력 (개발 환경)
- 전송 실패해도 지원 자체는 성공 처리 (best-effort)
- 구현: `backend/src/lib/mailer.ts`

## HeroSlider 구현 방식

- **CSS scroll-snap 기반 네이티브 캐러셀** (Framer Motion AnimatePresence 방식에서 변경)
- `IntersectionObserver` (threshold 0.5)로 현재 슬라이드 감지
- `scrollTo({ behavior: 'smooth' })`로 슬라이드 이동
- 3초 자동 슬라이드, `current` 변경 시 타이머 리셋
- `scrollbar-hide` CSS 유틸리티로 스크롤바 숨김
- 구현: `frontend/src/components/home/HeroSlider.tsx`

## 모바일 tel: 링크

- 갤러리 상세 페이지 전화번호: 모바일 터치 시 다이얼러 오픈, 데스크톱은 일반 텍스트
- Tailwind 반응형 분기: `md:hidden` (모바일 `<a>`) / `hidden md:flex` (데스크톱 `<p>`)
- 구현: `frontend/src/pages/GalleryDetailPage.tsx:288`

## PWA 자동 캐시 갱신

- `vite.config.ts`: workbox `skipWaiting: true` + `clientsClaim: true`
- `main.tsx`: `controllerchange` → `window.location.reload()` 자동 새로고침
- 배포 후 수동 Clear site data 불필요

## 로깅 & 안정성 시스템

### 로거 (`backend/src/lib/logger.ts`)
- 콘솔 + 파일 동시 기록 (INFO/WARN/ERROR/DEBUG 레벨)
- 로그 파일 위치: `backend/logs/app.log` (전체), `backend/logs/error.log` (에러 전용)
- 10MB 초과 시 `.old`로 자동 로테이션
- 확인 방법: `tail -f backend/logs/error.log` (실시간 에러 모니터링)

### 전역 에러 핸들러
- `process.on('unhandledRejection')` — 비동기 에러 로그 기록, 프로세스 유지
- `process.on('uncaughtException')` — 예외 로그 기록, 프로세스 유지
- Express errorHandler — 구조화된 로그 (method, url, userId, stack)
- Prisma 커넥션 풀 타임아웃 감지 → 503 응답

### DB 커넥션 풀
- `connection_limit=20` (기본 10에서 증가) — `.env` DATABASE_URL 파라미터
- `pool_timeout=10` — 커넥션 대기 타임아웃 10초
- Prisma 이벤트 로깅: error/warn, slow query(100ms 초과)

### Instagram API 타임아웃
- 모든 Graph API fetch에 `AbortSignal.timeout(5000)` 적용
- 타임아웃 시 빈 배열 반환 (서비스 중단 방지)

### Rate Limit
- 일반 API: 300 req/15min (SPA 특성상 완화, 기존 100)
- Auth API: 30 req/15min (기존 20)

### Frontend 에러 대응
- Axios: 15초 타임아웃, 500+/네트워크 에러 console.error
- TanStack Query: retry 3회 + 지수 백오프 (1s, 2s, 4s)

### Health Check
- `GET /api/health` — DB 연결 상태 포함 (`{ status, db, timestamp }`)
- DB 연결 실패 시 503 반환

## Vitest 테스트 스위트

- 109 tests: Backend 87 (15 files), Frontend 22 (3 files)
- Test DB: `artlink_test`, Backend: supertest, Frontend: jsdom
- Run: `cd backend && npm test` + `cd frontend && npm test`

## Admin 찜하기

- Admin 계정은 갤러리/공모 찜하기 버튼이 표시되지 않음
- GalleriesPage, GalleryDetailPage, ExhibitionsPage에서 처리

## 배포 구조 (Render.com)

```
[브라우저] → [Render Web Service (Express)]
                 ├── /api/* → API 라우트 (Express)
                 ├── /uploads/* → 로컬 정적 파일 (fallback)
                 ├── 정적 파일 → frontend/dist/ (express.static)
                 └── 나머지 → index.html (SPA fallback)

[이미지 업로드] → Multer memoryStorage → Cloudinary SDK → https://res.cloudinary.com/...
[DB] → Render PostgreSQL (무료 1GB, 90일)
```

- **브랜치**: `deploy/render` (main 기반, 배포 전용 변경만)
- **빌드**: `frontend build` → `backend build` → `prisma migrate deploy` → `seed` → `npm start`
- **환경 전환**: Cloudinary 환경변수 유무로 업로드 방식 자동 전환 (있으면 Cloudinary, 없으면 디스크)
- **Express v5**: SPA wildcard `/{*path}` 문법 필수 (`*` 단독 사용 불가)

## 주의사항

- **Prisma v5만 사용** — v7은 `datasource url` 제거로 인한 breaking change
- **Tailwind v4** — `@import "tailwindcss"` 문법 사용 (구 `@tailwind` 디렉티브 아님)
- **PostgreSQL 사용** — 로컬/배포 동일 DB 엔진. `.env`의 `DATABASE_URL`만 환경별로 변경
- **PostgreSQL 설치 가이드** — `howtosetPostGreSQL.txt` 참조
- **Express v5 wildcard** — `app.get('/{*path}', ...)` (path-to-regexp v8 호환)

## 버그 수정 이력 (submission/2, 2026-03-05)

| 버그 | 근본원인 | 수정 파일 |
|------|----------|-----------|
| 공모 찜 미작동 | exhibition API에 optionalAuth 미사용, isFavorited 미반환 | `backend/src/routes/exhibition.ts` |
| 공모 찜 하트 항상 회색 | isFavorited 상태 미반영 | `frontend/src/pages/ExhibitionsPage.tsx` |
| 공모 상세에 찜 버튼 없음 | Heart 버튼 누락 | `frontend/src/pages/ExhibitionDetailPage.tsx` |
| 마이페이지 찜 공모 클릭 무반응 | exhibitionId navigate 분기 누락 | `frontend/src/pages/MyPage.tsx` |
| GotM 평점 미갱신 | 리뷰 mutation에서 gallery-of-month 쿼리 미invalidate | `frontend/src/pages/GalleryDetailPage.tsx` |
| Exhibition 타입에 isFavorited 없음 | 타입 정의 누락 | `frontend/src/types/index.ts` |
