# ArtLink HANDOFF

> 최종 업데이트: 2026-03-14 | Git 태그: `submission/2` | 브랜치: `main`, `deploy/render`

이 문서를 읽으면 프로젝트의 모든 맥락을 파악하고 바로 이어서 개발할 수 있습니다.

---

## 1. 프로젝트 개요

갤러리-아티스트 매칭 **모바일 웹 플랫폼(PWA)**. 아티스트가 갤러리를 찾고, 공모에 지원하며, 갤러리 오너가 전시를 관리하고, Admin이 전체를 운영합니다.

**3가지 유저 역할**: Artist (포트폴리오/지원/리뷰), Gallery (갤러리/공모 등록), Admin (승인/운영 관리)

---

## 2. 기술 스택 (정확한 버전)

| 레이어 | 기술 | 버전 |
|--------|------|------|
| Frontend | React + Vite + TypeScript | 19.2 / 7.3 / 5.9 |
| 라우팅 | React Router | v7.13 |
| 서버 상태 | TanStack Query | v5.90 |
| 클라이언트 상태 | Zustand (localStorage persist) | v5.0 |
| 스타일링 | Tailwind CSS v4 | v4.2 (`@import "tailwindcss"` 문법) |
| 애니메이션 | Framer Motion | v12.34 |
| 아이콘 | Lucide React | v0.577 |
| 알림 | react-hot-toast | v2.6 |
| HTTP | Axios (JWT 인터셉터, 401 자동 로그아웃) | v1.13 |
| 백엔드 | Express + TypeScript | v5.2 |
| ORM | **Prisma v5** (v7 사용 금지 - breaking change) | v5.22 |
| DB | PostgreSQL 16 (apt 설치, WSL2) | 16.13 |
| 인증 | JWT (7일 만료) | jsonwebtoken v9 |
| 파일 업로드 | Multer (10MB, jpeg/png/gif/webp) + Cloudinary (배포) | v2.1 |
| 이메일 | Nodemailer (SMTP 미설정시 콘솔 로그) | v8.0 |
| PWA | vite-plugin-pwa | v1.2 |
| 배포 | Render.com (모놀리스), Cloudinary (이미지) | `deploy/render` 브랜치 |

**설치되었지만 미사용**: react-hook-form v7.71, zod v4.3, bcryptjs v3.0

---

## 3. 프로젝트 구조

```
ArtLink/
├── CLAUDE.md                     # 최상위 요구사항 스펙 (절대 기준)
├── architecture.md               # 아키텍처 문서 (변경시 업데이트 필수)
├── REQUIREMENTS_CHECKLIST.md     # 요구사항 체크리스트
├── HANDOFF.md                    # 이 문서
├── render.yaml                   # Render.com Blueprint (deploy/render 브랜치)
├── package.json                  # 루트 (Render 빌드용, deploy/render 브랜치)
├── howtosetPostGreSQL.txt        # PostgreSQL 설치 가이드
├── run_web.sh                    # 자동 실행 스크립트
├── .env.example                  # 환경변수 템플릿
├── docker-compose.yml            # PostgreSQL Docker (배포용)
│
├── backend/
│   ├── .env                      # DB URL, JWT 시크릿 등
│   ├── prisma/
│   │   ├── schema.prisma         # 16개 모델 (Single Source of Truth)
│   │   ├── seed.ts               # 초기 데이터
│   │   └── migrations/           # PostgreSQL 마이그레이션
│   ├── uploads/                  # 업로드 이미지 파일
│   └── src/
│       ├── index.ts              # Express 서버 (CORS, 미들웨어, 12개 라우트)
│       ├── routes/               # 12개 API 모듈 (~1400줄)
│       │   ├── auth.ts           # 로그인, 유저 정보, 아바타
│       │   ├── gallery.ts        # 갤러리 CRUD, 필터, 찜
│       │   ├── exhibition.ts     # 공모 CRUD, 지원, 홍보사진, 찜
│       │   ├── show.ts           # 전시 CRUD, 필터, 이미지, 찜 (2026-03-14 신규)
│       │   ├── review.ts         # 리뷰 CRUD, 별점 자동계산, 익명
│       │   ├── favorite.ts       # 찜 토글 (갤러리/공모/전시)
│       │   ├── portfolio.ts      # 포트폴리오 CRUD (이미지 max 30)
│       │   ├── approval.ts       # 승인 큐 (갤러리/공모/전시), 수정 요청
│       │   ├── hero.ts           # 히어로 슬라이드 CRUD
│       │   ├── benefit.ts        # 혜택 CRUD
│       │   ├── galleryOfMonth.ts # 이달의 갤러리 (자동 만료)
│       │   └── upload.ts         # Multer 이미지 업로드 + Cloudinary (배포용)
│       ├── middleware/
│       │   ├── auth.ts           # authenticate, optionalAuth, authorize
│       │   └── errorHandler.ts   # AppError 클래스, 글로벌 에러 핸들러
│       └── lib/
│           ├── prisma.ts         # Prisma 싱글톤
│           └── mailer.ts         # Nodemailer (포트폴리오 이메일)
│
└── frontend/
    ├── vite.config.ts            # Tailwind v4 플러그인, PWA, /api 프록시
    └── src/
        ├── main.tsx              # QueryClientProvider, BrowserRouter, Toaster
        ├── App.tsx               # 10개 라우트, SplashScreen 전환
        ├── index.css             # Tailwind v4 import, 커스텀 CSS 변수
        ├── pages/                # 10개 페이지 (~4500줄)
        │   ├── HomePage.tsx      # Hero, 캐치프레이즈, 퀵액션, GotM (43줄)
        │   ├── GalleriesPage.tsx # 목록, 필터, 정렬, 찜 (277줄)
        │   ├── GalleryDetailPage.tsx  # 이미지, 찜, 리뷰, 홍보사진, 수정 (655줄)
        │   ├── ExhibitionsPage.tsx    # D-day 필터, 빠른 지원, 찜 (207줄)
        │   ├── ExhibitionDetailPage.tsx # 상세, 지원, 찜, 삭제 (239줄)
        │   ├── ShowsPage.tsx     # 전시 목록, 지역/상태 필터, 찜 (213줄, 2026-03-14 신규)
        │   ├── ShowDetailPage.tsx # 전시 상세, ImageLightbox, 소개수정, 삭제 (239줄, 2026-03-14 신규)
        │   ├── BenefitsPage.tsx  # 혜택 목록 (57줄)
        │   ├── LoginPage.tsx     # 개발용 퀵 로그인 (83줄)
        │   └── MyPage.tsx        # 역할별 탭 (~1400줄, 가장 복잡)
        ├── components/
        │   ├── layout/           # Layout.tsx (Navbar+Outlet), Navbar.tsx (sticky, 모바일 햄버거)
        │   ├── home/             # SplashScreen, HeroSlider(AnimatePresence+variants), QuickActionCards, GalleryOfMonth
        │   └── shared/           # ProtectedRoute, ImageUpload/MultiImageUpload, ImageLightbox(Portal)
        ├── stores/
        │   └── authStore.ts      # Zustand: token, user, login/logout/updateUser
        ├── lib/
        │   ├── axios.ts          # baseURL:/api, JWT 인터셉터, 401 로그아웃
        │   ├── queryClient.ts    # staleTime:5분, retry:1
        │   └── utils.ts          # cn(), getDday(), regionLabels, exhibitionTypeLabels, getShowStatus, showStatusLabels, validateExhibitionDates
        └── types/
            └── index.ts          # 13개 인터페이스 (User, Gallery, Exhibition, Show, ShowImage 등)
```

---

## 4. 데이터 모델 (16개 테이블)

```
User (id, email[unique], name, role, avatar)
  ├─ Gallery (name, address, phone, description, detailDesc, region, rating, reviewCount, status, rejectReason, ownerName, mainImage)
  │    ├─ GalleryImage (url, order) [cascade]
  │    ├─ Exhibition (title, type, deadline, exhibitDate, capacity, region, description, status, rejectReason)
  │    │    ├─ PromoPhoto (url, caption) [cascade]
  │    │    ├─ Application (userId, status) [unique: userId+exhibitionId, cascade]
  │    │    └─ Favorite (userId) [unique: userId+exhibitionId, cascade]
  │    ├─ Show (title, description, startDate, endDate, openingHours, admissionFee, location, region, artists[JSON], posterImage, status) [2026-03-14 추가]
  │    │    ├─ ShowImage (url, order) [cascade]
  │    │    └─ Favorite (userId) [unique: userId+showId, cascade]
  │    ├─ Review (rating, content, imageUrl, anonymous) [cascade]
  │    ├─ Favorite (userId) [unique: userId+galleryId, cascade]
  │    └─ GalleryOfMonth (expiresAt) [unique: galleryId, cascade]
  ├─ Portfolio (biography, exhibitionHistory) [unique: userId]
  │    └─ PortfolioImage (url, order) [cascade]
  └─ Application (exhibitionId, status) [unique: userId+exhibitionId]

HeroSlide (title, description, imageUrl, linkUrl, order)
Benefit (title, description, imageUrl, linkUrl)
ApprovalRequest (type, targetId, changes[JSON], status, rejectReason, requesterId)
```

**승인 워크플로우**: Gallery/Exhibition 등록 → status: PENDING → Admin 승인/거절(사유 필수) → APPROVED/REJECTED

---

## 5. API 엔드포인트 전체 (50개)

### 인증 `/api/auth`
| Method | Path | Auth | 설명 |
|--------|------|------|------|
| POST | /dev-login | X | `{userId}` → `{token, user}` |
| GET | /me | O | 현재 유저 정보 |
| GET | /dev-users | X | 개발용 유저 목록 |
| PUT | /me/avatar | O | `{avatar}` 아바타 URL 변경 |

### 갤러리 `/api/galleries`
| Method | Path | Auth | 설명 |
|--------|------|------|------|
| GET | / | opt | 목록 (query: region, minRating, sortBy, owned) + isFavorited |
| GET | /:id | opt | 상세 (images, exhibitions, reviews, isFavorited) |
| POST | / | GALLERY | 등록 → PENDING |
| POST | /:id/images | O | 이미지 추가 (owner) |
| PATCH | /:id/detail | O | 상세소개 수정 (owner) |
| DELETE | /:id | ADMIN | 삭제 (cascade) |

### 공모 `/api/exhibitions`
| Method | Path | Auth | 설명 |
|--------|------|------|------|
| GET | / | opt | 진행중 목록 (deadline≥now) + isFavorited |
| GET | /my-applications | ARTIST | 내 지원 내역 |
| GET | /my-exhibitions | GALLERY | 내 공모 목록 |
| GET | /:id | opt | 상세 (gallery.ownerId, promoPhotos, isFavorited) |
| POST | / | GALLERY | 등록 → PENDING |
| POST | /:id/apply | ARTIST | 지원 + 포트폴리오 이메일 (best-effort) |
| POST | /:id/promo-photos | GALLERY | 홍보사진 추가 (owner) |
| DELETE | /:id | O | 삭제 (owner 또는 admin) |
| DELETE | /:id/promo-photos/:photoId | GALLERY | 홍보사진 삭제 |

### 리뷰 `/api/reviews`
| Method | Path | Auth | 설명 |
|--------|------|------|------|
| GET | /gallery/:galleryId | X | 갤러리 리뷰 목록 |
| GET | /my | O | 내 리뷰 목록 |
| POST | / | ARTIST | 작성 (rating 자동 재계산) |
| PATCH | /:id | O | 수정 (author only, 재계산) |
| DELETE | /:id | O | 삭제 (author/admin, 재계산) |

### 전시 `/api/shows` (2026-03-14 추가)
| Method | Path | Auth | 설명 |
|--------|------|------|------|
| GET | / | opt | APPROVED 목록 (query: region, showStatus) + isFavorited |
| GET | /my-shows | GALLERY | 내 전시 목록 (전 상태) |
| GET | /:id | opt | 상세 (gallery, images, artists JSON parse, isFavorited) |
| POST | / | GALLERY | 등록 → PENDING (galleryId 소유권 확인) |
| PATCH | /:id | O | description/artists 수정 (owner) |
| DELETE | /:id | O | 삭제 (owner 또는 admin) |
| POST | /:id/images | GALLERY | 추가 이미지 등록 (owner) |
| DELETE | /:id/images/:imageId | GALLERY | 이미지 삭제 (owner) |

### 찜 `/api/favorites`
| Method | Path | Auth | 설명 |
|--------|------|------|------|
| GET | / | O | 내 찜 목록 (gallery/exhibition/show 포함) |
| POST | /toggle | O | `{galleryId}` 또는 `{exhibitionId}` 또는 `{showId}` → `{favorited}` |

### 포트폴리오 `/api/portfolio`
| Method | Path | Auth | 설명 |
|--------|------|------|------|
| GET | / | ARTIST | 조회 (없으면 자동 생성) |
| PUT | / | ARTIST | biography, exhibitionHistory 수정 |
| POST | /images | ARTIST | 이미지 추가 (max 30) |
| DELETE | /images/:id | ARTIST | 이미지 삭제 |

### 승인 `/api/approvals`
| Method | Path | Auth | 설명 |
|--------|------|------|------|
| GET | / | ADMIN | `{pendingGalleries, pendingExhibitions, pendingShows, pendingRequests}` |
| PATCH | /gallery/:id | ADMIN | 승인/거절 (`rejectReason` 필수 if REJECTED) |
| PATCH | /exhibition/:id | ADMIN | 승인/거절 |
| PATCH | /show/:id | ADMIN | 전시 승인/거절 (2026-03-14 추가) |
| POST | /edit-request | GALLERY | 수정 요청 제출 |
| PATCH | /edit-request/:id | ADMIN | 수정 요청 승인/거절 |

### 히어로/혜택/GotM/업로드
- `/api/hero-slides` — GET, POST(ADMIN), PATCH(ADMIN), DELETE(ADMIN)
- `/api/benefits` — GET, POST(ADMIN), PATCH(ADMIN), DELETE(ADMIN)
- `/api/gallery-of-month` — GET(자동 만료 삭제), POST(ADMIN), DELETE(ADMIN)
- `/api/upload` — POST /image(single), POST /images(max 10)
- `/api/health` — GET (헬스체크)

---

## 6. 프론트엔드 TanStack Query 키 맵

| 쿼리 키 | 사용 위치 | invalidate 하는 곳 |
|---------|----------|-------------------|
| `['galleries', region?, rating?, sort?]` | GalleriesPage | 찜 토글 |
| `['gallery', id]` | GalleryDetailPage | 찜, 리뷰 CUD, 상세수정, 홍보사진 |
| `['exhibitions', region?, rating?]` | ExhibitionsPage | 찜, 지원 |
| `['exhibition', id]` | ExhibitionDetailPage | 찜, 지원, 삭제 |
| `['gallery-of-month']` | GalleryOfMonth | 리뷰 CUD, Admin GotM 관리 |
| `['hero-slides']` | HeroSlider, Admin | Admin Hero CRUD |
| `['benefits']` | BenefitsPage, Admin | Admin Benefit CRUD |
| `['shows', region?, status?]` | ShowsPage | 찜 토글 |
| `['show', id]` | ShowDetailPage | 찜, 소개수정 |
| `['my-shows']` | MyPage Gallery | 전시 등록/삭제 |
| `['favorites']` | MyPage, 찜 토글 전체 | 모든 찜 토글 (MyPage는 setQueriesData로 cross-cache 수정도) |
| `['portfolio']` | MyPage Artist | 포트폴리오 수정 |
| `['my-reviews']` | MyPage Artist | 리뷰 수정/삭제 |
| `['my-applications']` | MyPage Artist | 지원 |
| `['my-galleries']` | MyPage Gallery | 갤러리 등록 |
| `['my-exhibitions']` | MyPage Gallery | 공모 등록/삭제 |
| `['approvals']` | MyPage Admin | 승인/거절 |

---

## 7. 인증 플로우

```
1. LoginPage → POST /api/auth/dev-login {userId} → {token, user}
2. authStore.login(token, user) → localStorage 저장
3. axios interceptor → 모든 요청에 Authorization: Bearer {token}
4. 백엔드 authenticate → JWT 검증 → req.user 설정
5. optionalAuth → 토큰 있으면 검증, 없으면 통과
6. authorize('ADMIN') → req.user.role 체크
7. 401 응답 → axios interceptor → authStore.logout() → /login 이동
```

---

## 8. 완료된 기능 (Phase 1-10 전체)

- Splash Screen (1.5초, Framer Motion 애니메이션)
- Navigation Bar (sticky, 모바일 햄버거, 활성 라우트 하이라이팅)
- Hero Slider (3초 자동, 수동시 리셋, 외부/내부 URL 분기)
- Quick Action Cards (갤러리/공모/혜택 3개)
- Gallery of the Month (가로 스크롤, 자동 만료)
- 갤러리 목록 (지역/별점 필터, 별점순 정렬, 필터 칩 표시, 찜)
- 갤러리 상세 (이미지 슬라이더, 찜, 상세수정, 리뷰 CRUD, 홍보사진, 공모 목록)
- 공모 목록 (D-day 필터, 갤러리 별점 필터, 빠른 지원, 찜)
- 공모 상세 (지원, 찜, 삭제, 홍보사진)
- 혜택 목록
- MyPage Artist (포트폴리오, 찜 목록, 내 리뷰, 지원 내역)
- MyPage Gallery (갤러리 등록, 공모 등록, 상태 확인)
- MyPage Admin (승인 큐 + 거절사유, Hero/Benefit/GotM 관리 + 미리보기)
- 이미지 업로드 (단일/다중, 10MB 제한)
- PWA manifest + service worker + 자동 캐시 갱신 (skipWaiting/clientsClaim)
- PostgreSQL 마이그레이션 완료
- 갤러리 상세 전화번호 모바일 tel: 링크 (데스크톱은 일반 텍스트)
- 전시(Show) 기능: 목록(필터)/상세/등록(PENDING→승인)/수정/삭제/이미지/찜 + MyPage 통합
- Vitest 테스트 스위트 (Backend 128, Frontend 33 = 161개)

---

## 9. 버그 수정 이력 (submission/2)

| 버그 | 근본원인 | 수정 파일 | 수정 내용 |
|------|----------|-----------|-----------|
| 공모 찜 안됨 | exhibition GET에 optionalAuth 없음, isFavorited 미반환 | `backend/routes/exhibition.ts` | optionalAuth + isFavorited 계산 추가 |
| 공모 하트 항상 회색 | isFavorited 상태 미반영 | `frontend/pages/ExhibitionsPage.tsx` | `ex.isFavorited` 조건부 스타일 |
| 공모 상세에 찜 버튼 없음 | Heart 버튼 누락 | `frontend/pages/ExhibitionDetailPage.tsx` | Heart 버튼 + favMutation 추가 |
| 마이페이지 찜 공모 클릭 무반응 | exhibitionId navigate 분기 누락 | `frontend/pages/MyPage.tsx:316` | `else if (fav.exhibitionId) navigate(...)` |
| GotM 평점 미갱신 | 리뷰 mutation에서 gallery-of-month 미invalidate | `frontend/pages/GalleryDetailPage.tsx` | 3개 리뷰 mutation에 invalidate 추가 |
| Exhibition 타입 isFavorited 없음 | 타입 정의 누락 | `frontend/types/index.ts` | `isFavorited?: boolean` 추가 |

### UX 버그 수정 (2026-03-07, commits `6dca041`→`0ec0bd1`→`e5aba83`)

| 버그 | 근본원인 | 수정 |
|------|----------|------|
| 찜 토글 반응 느림 (3페이지) | onSuccess+invalidate만, optimistic update 없음 | onMutate 캐시 flip + onError rollback 추가 |
| 이미지 확대 불가 | lightbox 컴포넌트 없었음 | ImageLightbox 신규 + 2페이지 5곳 적용 |
| 히어로 여러장 넘어감 + 화살표 안됨 | drag="x" + animate={controls} 이중 x 제어 충돌 | AnimatePresence + direction variants 방식으로 전면 교체 |
| 공모 상세 이미지 확대 안됨 | gradient overlay가 img onClick 차단 | `pointer-events-none` 추가 |
| MyPage 찜 삭제→타페이지 하트 깜빡임 | invalidate만 → stale 캐시 렌더 후 refetch | setQueriesData로 cross-cache isFavorited 즉시 수정 |
| MyPage 찜 빠른 연타시 되살아남 | optimistic update 없이 invalidation race | onMutate filter 제거 + onError rollback |

---

## 10. Render.com 배포 (2026-03-06)

### 구조
- **브랜치**: `deploy/render` (main 기반, 배포 전용 변경만 포함)
- **모놀리스 배포**: Backend Express가 Frontend `dist/`도 서빙 (Render Web Service 1개)
- **이미지 저장**: Cloudinary (환경변수 기반 자동 전환, 미설정시 로컬 디스크)
- **DB**: Render PostgreSQL 무료 (1GB, 90일 제한)

### deploy/render 브랜치 변경 파일
| 파일 | 변경 내용 |
|------|-----------|
| `render.yaml` (신규) | Render Blueprint — Web Service + PostgreSQL 설정 |
| `package.json` (루트, 신규) | Render 빌드/스타트 스크립트 |
| `backend/package.json` | `cloudinary` 의존성 추가 |
| `backend/src/routes/upload.ts` | Cloudinary 업로드 (memoryStorage + SDK), 환경변수 없으면 기존 diskStorage |
| `backend/src/index.ts` | 프로덕션: frontend/dist 정적 서빙 + SPA fallback (`/{*path}`), CORS same-origin |

### Cloudinary 계정
- Cloud Name: `df8uht2ry`
- API Key: `198794618252623`
- (API Secret은 Render 환경변수에 설정됨)

### 배포 URL
- https://artlink-2esp.onrender.com
- 무료 플랜: 15분 미사용시 sleep, 접속 시 ~30초 콜드스타트

### 무료 플랜 한도
| 서비스 | 한도 |
|--------|------|
| Render Web Service | 750시간/월 |
| Render PostgreSQL | 1GB, **90일 후 자동 삭제** |
| Cloudinary | 25GB 저장, 25GB 대역폭/월, 25,000 변환/월 |

### 배포 시 주의사항
- `render.yaml`의 `buildCommand`에 `--include=dev` 필수 (TypeScript 타입 패키지가 devDependencies)
- Express v5에서 SPA wildcard는 `/{*path}` 문법 (`*` 불가)
- `startCommand`에서 `prisma migrate deploy` + `seed.ts` 실행 후 서버 시작
- seed는 upsert 기반이라 매 재시작마다 안전하게 실행 가능
- **⚠️ seed.ts upsert `update` 블록 필수** — 아래 "과거 배포 장애" 참조

### 재배포 방법
```bash
# deploy/render 브랜치에서 변경 후
git checkout deploy/render
# ... 수정 ...
git add . && git commit -m "..." && git push
# Render가 자동 감지하여 재배포 (또는 대시보드에서 Manual Deploy)
```

### main에서 변경사항 반영
```bash
git checkout deploy/render
git merge main
git push
```

---

## 11. UX 개선 (2026-03-07, 3 commits)

### 찜 Optimistic Update (5개 페이지)
모든 찜 토글에 낙관적 업데이트 적용. 서버 응답 전 즉시 UI 반영, 실패 시 rollback.

| 페이지 | 패턴 | 비고 |
|--------|------|------|
| GalleriesPage | 리스트 map flip (기존) | — |
| GalleryDetailPage | 단일 객체 flip | queryKey: `['gallery', id]` |
| ExhibitionsPage | 리스트 map flip | queryKey에 필터 포함 |
| ExhibitionDetailPage | 단일 객체 flip | queryKey: `['exhibition', id]` |
| MyPage FavoritesSection | 리스트 filter 제거 + **cross-cache setQueriesData** | galleries/exhibitions 캐시까지 isFavorited 직접 수정 |

**MyPage cross-cache 패턴**: invalidate만으로는 페이지 이동 시 stale 캐시 렌더 → 하트 깜빡임. `queryClient.setQueriesData({ queryKey: ['galleries'], exact: false }, ...)` 로 모든 필터 조합의 캐시에서 해당 항목의 isFavorited를 즉시 false로 설정.

### ImageLightbox 컴포넌트 (신규)
- 파일: `frontend/src/components/shared/ImageLightbox.tsx`
- Portal 기반, Framer Motion, 좌우 화살표, 터치 스와이프, Escape/배경클릭 닫기
- **부모에서 `<AnimatePresence>` 로 감싸야 exit 애니메이션 동작**
- didSwipe ref로 스와이프 vs 탭 구분 (close 오작동 방지)
- 적용 위치:
  - GalleryDetailPage: 갤러리 이미지 슬라이더, 홍보사진 그리드, 리뷰 이미지
  - ExhibitionDetailPage: 상단 이미지, 홍보사진 그리드

### HeroSlider 재작성
- **AnimatePresence + direction variants 방식** (translateX ±100% 전환)
- 이전 방식(Framer Motion `drag="x"` + `animate={controls}`)은 이중 x 제어 충돌로 폐기
  - 증상: 여러 장 동시 넘어감, 화살표 안됨, 1장 넘기면 멈춤
  - 원인: drag 내부 x 오프셋과 controls.start x가 분리되어 합산됨
- 터치 스와이프: 수동 onTouchStart/End (threshold 50px)
- spring 물리 (stiffness:300, damping:30)

### pointer-events-none 수정
- ExhibitionDetailPage 상단 그래디언트 오버레이에 `pointer-events-none` 추가
- 원인: `absolute inset-0` div가 아래 img의 onClick을 차단 → 이미지 확대 불가

---

## 12. Show(전시) 기능 (2026-03-14)

갤러리의 실제 전시/행사를 소개하는 기능. 기존 "모집공고"(Exhibition, 아티스트 모집)와 별도.

### 변경 파일 (20개)
| 파일 | 작업 |
|------|------|
| `backend/prisma/schema.prisma` | Show, ShowImage 모델 추가, Favorite/Gallery 확장 |
| `backend/prisma/migrations/20260314003729_add_show_model/` | 마이그레이션 SQL |
| `backend/prisma/seed.ts` | 샘플 전시 2건 (진행중 SEOUL + 예정 BUSAN) |
| `backend/src/index.ts` | show 라우트 등록 |
| `backend/src/routes/show.ts` | **신규** — 전시 CRUD API (8 endpoints) |
| `backend/src/routes/favorite.ts` | showId 찜 토글 추가 |
| `backend/src/routes/approval.ts` | pendingShows + show 승인/거절 |
| `backend/src/__tests__/helpers.ts` | cleanDb에 Show/ShowImage, seedShow 헬퍼 추가 |
| `backend/src/__tests__/show.test.ts` | **신규** — 17 tests |
| `backend/src/__tests__/show-extended.test.ts` | **신규** — 10 tests |
| `backend/src/__tests__/favorite-show.test.ts` | **신규** — 4 tests |
| `backend/src/__tests__/approval-show.test.ts` | **신규** — 4 tests |
| `frontend/src/types/index.ts` | Show, ShowImage 인터페이스 |
| `frontend/src/lib/utils.ts` | getShowStatus, showStatusLabels |
| `frontend/src/pages/ShowsPage.tsx` | **신규** — 전시 목록 (지역/상태 필터, optimistic 찜) |
| `frontend/src/pages/ShowDetailPage.tsx` | **신규** — 전시 상세 (ImageLightbox, 소개수정, 삭제) |
| `frontend/src/pages/MyPage.tsx` | MyShowsSection(Gallery), pendingShows(Admin), 찜에 전시(Artist) |
| `frontend/src/components/layout/Navbar.tsx` | '전시' 탭 추가 |
| `frontend/src/App.tsx` | /shows, /shows/:id 라우트 |
| `frontend/src/__tests__/show.test.ts` | **신규** — 11 tests |

### 핵심 패턴
- **artists 필드**: DB에 JSON string 저장 (`JSON.stringify`), API 응답에서 `JSON.parse` → 배열 반환
- **showStatus 필터**: ongoing(`startDate<=now AND endDate>=now`), upcoming(`startDate>now`), ended(`endDate<now`)
- **ImageLightbox**: `initialIndex` prop 사용 (NOT `currentIndex`), 부모에서 AnimatePresence 감싸기
- **seed.ts upsert**: update 블록에 title, description, status, galleryId 등 전체 필드 포함 (Render 배포 호환)

---

## 13. 약관 동의 기능 (2026-03-08)

갤러리/공모 등록 시 약관 동의 체크박스 필수화.

### 구조
- 약관 파일: `frontend/public/terms/gallery-registration.txt`, `exhibition-application.txt`
- `public/` 폴더에 위치하여 빌드 없이 파일 교체만으로 약관 수정 가능
- 프론트엔드에서 `fetch('/terms/...')` 로 런타임 로드

### 동작
- 폼 열릴 때 `useEffect`로 약관 텍스트 fetch
- 스크롤 가능한 약관 표시 영역(max-h-40) + 체크박스
- **미동의 시 등록 버튼 disabled** (기존 isPending 조건에 `|| !agreed` 추가)
- 등록 성공, 취소 시 체크박스 리셋

### 수정 파일
| 파일 | 변경 |
|------|------|
| `frontend/src/pages/MyPage.tsx` | `useEffect` import 추가, MyGalleriesSection/MyExhibitionsSection에 약관 state+UI+disabled 조건 |
| `frontend/public/terms/*.txt` (신규) | 약관 텍스트 파일 2개 |

---

## 14. Vitest 테스트 스위트 (2026-03-10 → 2026-03-14)

- **161 tests total**: Backend 128 (20 files), Frontend 33 (4 files)
- Test DB: `artlink_test` (별도 PostgreSQL DB)
- Backend: supertest + vitest, `fileParallelism: false` (순차 실행), setupFiles로 migrate deploy
- Frontend: jsdom environment, 순수함수(utils) + zustand store 테스트
- Helper: `backend/src/__tests__/helpers.ts` — TRUNCATE CASCADE로 cleanDb, seedUsers (id 1-4), seedGallery, seedShow
- index.ts: NODE_ENV=test 시 listen/rateLimit/morgan 비활성화
- **Show 테스트 (2026-03-14)**: show.test.ts(17), show-extended.test.ts(10), favorite-show.test.ts(4), approval-show.test.ts(4), frontend show.test.ts(11)
- Run: `cd backend && npm test`, `cd frontend && npm test`

---

## 15. 모바일 tel: 링크 (2026-03-10)

- 갤러리 상세 페이지 전화번호: 모바일에서 터치 시 전화 다이얼러 오픈
- 데스크톱에서는 일반 텍스트 (클릭 불가)
- Tailwind 반응형: `<a>` + `md:hidden` (모바일) / `<p>` + `hidden md:flex` (데스크톱)
- 파일: `frontend/src/pages/GalleryDetailPage.tsx:288`

---

## 16. PWA 자동 캐시 갱신 (2026-03-10)

배포 후 구버전 캐시가 남아 변경이 안 보이는 문제 해결.

| 파일 | 변경 |
|------|------|
| `frontend/vite.config.ts` | workbox `skipWaiting: true` + `clientsClaim: true` 추가 |
| `frontend/src/main.tsx` | `controllerchange` 이벤트 감지 → `window.location.reload()` 자동 새로고침 |

- `skipWaiting` — 새 서비스워커가 대기 없이 즉시 활성화
- `clientsClaim` — 활성화 즉시 모든 탭의 제어권 획득
- 사용자가 수동으로 Clear site data 할 필요 없음

---

## 17. 미완료 항목 (다음 단계) {#remaining}

### 높은 우선순위
1. **React-hook-form + Zod** — 설치됨(`v7.71`, `v4.3`)이나 미사용. 갤러리/공모 등록 폼에 적용 필요
2. **수정 요청 UI** — 백엔드 API(`POST /api/approvals/edit-request`, `PATCH /edit-request/:id`) 완성. 프론트엔드 MyPage Gallery 섹션에 "수정 요청" 버튼+폼 미구현

### 중간 우선순위
3. **Nodemailer 실제 전송** — SMTP 설정시 작동. 현재 콘솔 로그만
4. **코드 스플리팅** — 프론트 번들 572KB. React.lazy + Suspense로 페이지별 분리
5. **ESLint + Prettier** — eslint.config.js 존재하나 팀 규칙 미설정
6. **MyPage 분리** — 1207줄 단일 파일. 섹션별 컴포넌트 분리 고려

### 낮은 우선순위
7. **PWA 아이콘** — placeholder 경로만 설정. 실제 png 파일 필요
8. **Shadcn/ui** — CLAUDE.md 스펙에 있지만 현재 커스텀 Tailwind 사용
9. **OAuth 인증** — 현재 dev quick login. `authStore.login()` 호출만 교체하면 됨

---

## 18. 환경 실행

```bash
# 전체 자동 (PostgreSQL + 백엔드 + 프론트엔드)
bash run_web.sh

# 수동 실행
sudo service postgresql start                    # WSL2 필수
cd backend && npx tsx src/index.ts               # http://localhost:4000
cd frontend && npx vite                          # http://localhost:5173

# DB 리셋
cd backend && npx prisma migrate reset           # 스키마 재생성 + 시드

# DB GUI
cd backend && npx prisma studio                  # http://localhost:5555
```

### PostgreSQL 접속 정보
```
Host: localhost:5432
Database: artlink
User: artlink
Password: artlink_dev_password
```

### 개발 계정
| ID | 이름 | 역할 | 이메일 |
|----|------|------|--------|
| 1 | Artist 1 | ARTIST | artist1@artlink.com |
| 2 | Artist 2 | ARTIST | artist2@artlink.com |
| 3 | Gallery Owner | GALLERY | gallery@artlink.com |
| 4 | Admin | ADMIN | admin@artlink.com |

---

## 19. 과거 배포 장애 기록

### [2026-03-06] 새 필드 추가 후 Render에 데이터 반영 안 됨
- **증상**: 코드 배포 성공(Live), 새 컬럼(instagramUrl, deadlineStart 등) 전부 `null`
- **원인**: `seed.ts`의 upsert에 `update: {}`(빈 객체). Render DB는 유지되므로 기존 row에 create가 아닌 update가 실행됨 → 빈 객체라 아무것도 갱신 안 됨
- **왜 로컬에서 못 잡았나**: 로컬은 `prisma migrate reset`으로 DB를 날린 뒤 create 경로로 실행되어 항상 정상
- **해결**: upsert의 `update` 블록에 새 필드 값을 명시적으로 포함
- **재발 방지 규칙**: **스키마에 새 필드를 추가할 때마다 seed.ts의 해당 upsert `update` 블록에도 반드시 해당 필드를 추가할 것**

---

## 20. 절대 지켜야 할 제약사항

1. **Prisma v5만 사용** — v7은 `datasource url` 제거로 인한 breaking change
2. **Tailwind v4** — `@import "tailwindcss"` 문법 (구 `@tailwind` 디렉티브 아님), `@tailwindcss/vite` 플러그인
3. **architecture.md 업데이트** — 코드 변경시 반드시 갱신 (CLAUDE.md 요구사항)
4. **DB 무결성** — 등록/수정/삭제 시 서버-DB 동기화 보장, cascade delete 활용
5. **승인 거절시 사유 필수** — rejectReason 없으면 400 에러
6. **Admin은 찜 버튼 미표시** — GalleriesPage, GalleryDetailPage, ExhibitionsPage, ExhibitionDetailPage
7. **Hero 슬라이더 타이머** — 수동 조작시 타이머 리셋 후 3초 뒤 재시작
8. **seed.ts upsert `update` 블록** — 스키마에 새 필드 추가 시 seed의 `update: {}`를 방치하면 Render 등 프로덕션 DB에 반영 안 됨. 반드시 update에도 새 필드를 넣을 것
9. **Framer Motion drag+animate 금지** — `drag="x"` + `animate={controls}`는 이중 x 제어 충돌. AnimatePresence+variants 방식 사용
10. **absolute inset-0 오버레이에 pointer-events-none** — 아래 요소의 click 이벤트를 차단하므로 필수
11. **찜 연동은 invalidate만으로 부족** — cross-cache setQueriesData로 즉시 수정해야 stale 깜빡임 방지
12. **ImageLightbox는 부모에서 AnimatePresence로 감싸기** — 컴포넌트 자체는 motion.div만, 부모가 unmount하면 exit 애니메이션 안됨
13. **Show artists 필드** — DB에 JSON string으로 저장 (`JSON.stringify`), API에서 `JSON.parse`로 배열 반환. null 허용
14. **Admin은 Show 찜 버튼도 미표시** — ShowsPage, ShowDetailPage에서 `!isAdmin` 조건
