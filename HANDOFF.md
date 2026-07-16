# ArtLink HANDOFF

> 최종 업데이트: **2026-06-24** | 브랜치: `main`(개발), `deploy/render`(배포) | 최신 커밋: `8b2f627`

이 문서를 읽으면 프로젝트의 모든 맥락을 파악하고 바로 이어서 개발할 수 있습니다.
아래 **0장(계정 인계)** 이 가장 최신 상태이며, 1장부터는 기반 레퍼런스입니다.

---

## 0. ⭐ 계정 인계 — 새 세션은 여기부터 (2026-06-24)

> Claude 구독 계정 전환 대비 인계 문서. 새 계정/머신에서 이 저장소를 받으면 아래만 읽고 바로 이어서 작업 가능.

### 0-1. 한 줄 요약
ArtLink는 **거의 완성된 운영 중 서비스**(https://artlink.cc). 코드는 GitHub `jho4255/Artlink`에 있고, 진실의 원천은 **이 저장소 + `CLAUDE.md`(세션 자동 로드)**. 대화 기록이 없어도 이 문서 + `git log` + `CLAUDE.md`로 전부 복원됨.

### 0-2. 새 세션 첫 단계 (순서대로)
1. `CLAUDE.md` 읽기 (자동 로드됨) — 명령어·아키텍처·**Critical Constraints**·유저 시나리오.
2. 이 HANDOFF 0장(여기) 읽기 — 현재 상태·최근 변경·다음 작업.
3. `git log --oneline -30` — 최근 작업 흐름.
4. 로컬 띄우기: PostgreSQL 확인(`pg_isready`) → 백엔드/프론트 실행(아래 0-4).
5. 작업 후 **반드시** `cd backend && npm test` + `cd frontend && npm test`.

### 0-3. 운영/계정 정보 (비밀값은 저장 안 함)
- **서비스 URL**: https://artlink.cc/ (커스텀 도메인)
- **배포**: Render.com, 계정 `artlink.aws@gmail.com`(Google 로그인). 브랜치 `deploy/render` push 시 자동 배포.
  - 빌드 체인: frontend build → backend build → `prisma migrate deploy` → seed → `npm start` (Express가 `frontend/dist`도 서빙하는 모놀리스).
  - **환경변수(R2_*, JWT_SECRET, SMTP 등)는 Render 대시보드에 설정됨** — 코드/저장소에 없음. Claude 계정과 무관하므로 전환해도 영향 없음.
- **이미지 저장소**: Cloudflare R2 (env 있으면 R2, 없으면 로컬 디스크 fallback). 변수: `R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET_NAME/R2_PUBLIC_URL`.
- **로컬 DB(dev 전용, 비밀 아님)**: PostgreSQL16, user=`artlink` pw=`artlink_dev_password` db=`artlink` :5432. WSL2는 재부팅 후 `sudo service postgresql start`.
- **GitHub**: `https://github.com/jho4255/Artlink.git` (origin). main + deploy/render.

### 0-4. 빠른 시작 명령
```bash
# 한 번에 (PostgreSQL→마이그레이션→시드→백+프론트)
bash run_web.sh
# 또는 개별
sudo service postgresql start                                  # WSL2 재부팅 후
cd backend  && DISABLE_RATE_LIMIT=true ENABLE_DEV_LOGIN=true npm run dev   # :4000
cd frontend && npm run dev                                     # :5173 (Vite proxy /api,/uploads → 4000)
# 테스트 (코드 수정 후 필수)
cd backend && npm test     # 433 통과 (순차, artlink_test DB)
cd frontend && npm test    # 46 통과
```
- 로컬 인증 우회: `ENABLE_DEV_LOGIN=true`일 때 `POST /api/auth/dev-login {email}` 로 시드 계정 토큰 발급(시드 이메일: `artist1@artlink.com`, `gallery@artlink.com`, `admin@artlink.com`).

### 0-5. 현재 상태 (2026-06-24)
- **테스트**: 백엔드 **433** / 프론트 **46** 통과. (백엔드 순차 실행, `artlink_test` DB)
- **DB 모델 22개**, 마이그레이션은 `backend/prisma/migrations/`에 누적(최신: `convert_reviewed_to_submitted`).
- 배포 정상(번들 해시 교체로 확인). 마지막 배포 커밋 `8b2f627`.
- ⚠️ 알려진 flaky 테스트 1건: `exhibition-extended.test.ts > 상세 조회 시 gallery 정보 포함` — 동시성 테스트 데이터 누수로 가끔 실패. 단독 재실행하면 통과(회귀 아님).

### 0-6. 최근 변경 이력 (이번 인계 직전 세션들, 최신순)
- (2026-07-16) **크롬 외 브라우저 에러 화면 사고 해결**: Cloudflare 엣지가 7/8자 `sw.js`·`registerSW.js`를 1년 immutable로 캐시(옛 헤더 시절) → 오리진에 수정이 배포돼도 전 사용자에게 옛 워커가 서빙되고, Safari/삼성인터넷은 CacheStorage 소실 시 "화면을 불러오지 못했어요"로 죽음. 대응: ① SW 등록을 `main.tsx`에서 `/sw.js?v=BUILD_ID`(빌드마다 새 URL → CF 캐시 키 우회)로 직접, `registerSW.js` 생성 중단(`injectRegister: null`) ② 네비게이션을 precache 바인딩→**네트워크 우선**으로 전환(`1ce07ea` injectManifest 커스텀 `frontend/src/sw.js` — NetworkOnly 5s + 오프라인만 precache 폴백, 캐시 소실 내성) ③ 고정 파일명 응답 `no-cache`→**no-store**. **잔여 조치**: 크롬 사용자 복구를 위해 Cloudflare 대시보드에서 캐시 퍼지 + Browser Cache TTL="Respect Existing Headers" 권장(architecture.md 캐시 정책 절 참고).
- `8b2f627` **지원 상태 전이 규칙 정비**: 수락=최종(변경 불가, UI "수락(확정)" 잠금 배지), 거절→수락만 허용(거절→접수 차단), **검토중(REVIEWED) 폐지**(기존 데이터는 접수로 환원 마이그레이션). 거절 시 작가가 **"확인"** 눌러야 지원내역에서 제거(`Application.rejectionAckedAt` + `POST /exhibitions/applications/:appId/acknowledge-rejection`).
- `f1dd47e` **인스타 OAuth/피드 연동 전면 제거**(인증 어려움). 인스타 **주소(instagramUrl)는 유지** — 갤러리 등록 폼/상세 페이지에서 직접 입력, 상세에 링크 표시. `maskGallery`는 토큰만 가림. 개인정보처리방침에서 인스타 OAuth 항목 삭제. 갤러리 삭제는 마이페이지에서만(상세 페이지 삭제 제거), **갤러리/공모/전시 삭제 시 "삭제" 입력 이중확인 모달**(`DeleteConfirmModal`). 승인완료/거절 갤러리 삭제 가능.
- `e6466f3` 수락 알림 메시지에 "운영 페이지에서 전시정보 입력" + 클릭 시 운영페이지 이동. 지원내역에 **공모 진행상태 배지**(모집중/모집마감/확정/전시종료/정산완료), 필터를 **전체/진행중/정산완료** 3개로 단순화. 마이페이지 찜목록 하트 빨강 채움.
- `3711f61` 모집공고 포스터: 목록 **A4 비율**, 상세는 **원본 비율 보존 + 여러 장 세로 나열**, **포스터별 대표색 글로우**, 그라데이션 제거, "포스터 관리" 라벨.
- `4a1e2ce` **공모 다중 사진**(`ExhibitionImage`, 추가/삭제(최소1장)/드래그 순서변경, lazy 백필). **지원자 관리 별도 페이지**(`/exhibitions/:id/applicants`) — 지원서 PDF(닉네임·전화·메일 포함)+전체 ZIP, CSV 제거, 연락처 지원 시점부터 노출. 운영 **상태 스텝퍼**(모집마감→확정→전시종료 순서 강제, Admin 우회). 전 페이지 찜 버튼 ARTIST 전용. 공모 삭제 버튼 소형화.
- `286250c`~`d17b2a9` **정산 2단계 승인제**(갤러리 확인요청→작가 수락/문제제기→전원 수락 시 완료), 정산서 PDF(R2 이미지 동일출처 프록시로 캔버스 taint 해결), **ArtLook**(판매작 홍보 이미지 도구) 연동.
- `bd25047` **회원탈퇴**(소프트삭제+익명화), Navbar 로그인/로그아웃 버튼.
- 그 외 보안 강화(PII/IDOR/SSRF/XSS/SSE 티켓), 메시지 실시간(SSE), 캡션 .hwp 생성 등 — `git log` 참고.

### 0-7. 다음 작업 / 미해결 (우선순위)
1. **React-hook-form + Zod** 설치됨(v7.71/v4.3)이나 미사용 — 갤러리/공모 등록 폼에 적용 권장.
2. **수정 요청 UI** — 백엔드 API는 완성, 프론트 MyPage Gallery에 "수정 요청" 버튼/폼 미구현.
3. **Nodemailer 실제 SMTP** — 현재 콘솔 로그만. Render env에 SMTP 설정 시 작동.
4. **코드 스플리팅** — 프론트 번들 큼. React.lazy + Suspense 페이지 분리.
5. **MyPage 분리** — `MyPage.tsx` ~3000줄 단일 파일. 섹션별 컴포넌트 분리.
6. 나머지 페이지 `DESIGN.md` 기반 리디자인(상세/마이페이지/혜택/고객센터).

### 0-8. 절대 함정 (실수 빈발 — CLAUDE.md Critical Constraints도 필독)
- **Prisma v5 고정**(v7 금지), **Tailwind v4**(`@import "tailwindcss"`), **Express v5**(SPA wildcard `/{*path}`).
- **seed.ts upsert**: 스키마 새 필드 추가 시 `update` 블록에도 반드시 포함(Render DB는 유지되어 update 경로 탐).
- **ImageLightbox** `initialIndex` prop(`currentIndex` 아님), 부모 `AnimatePresence` 필요. **ImageUpload** `placeholder` prop(`label` 아님).
- **찜 연동**은 invalidate만으론 부족 — cross-cache `setQueriesData`로 즉시 수정.
- **시드 ID 계약**: 1=artist1, 2=artist2, 3=gallery, 4=admin (추가 작가는 admin 뒤에 생성).
- **배포 흐름**: `git checkout deploy/render && git merge origin/deploy/render && git merge main && git push origin deploy/render` 후 main도 push. Render가 자동 배포(~2분, 번들 해시 교체로 확인).
- **GitHub 토큰 등 비밀값을 출력/커밋 금지** — 과거 트랜스크립트에 토큰이 섞였을 수 있어 `.jsonl`은 절대 커밋하지 말 것.

### 0-9. 대화 기록(대화내역)의 위치
- 과거 세션 원본 트랜스크립트(JSONL): `~/.claude/projects/-home-jho4255-ArtLink/*.jsonl` — **로컬에만 존재**(같은 OS 계정이면 Claude 구독 전환과 무관하게 유지). 비밀값이 섞일 수 있어 **저장소엔 커밋하지 않음**. 다른 머신으로 옮기려면 이 디렉토리를 별도로 백업.
- 자동 메모리: `~/.claude/projects/-home-jho4255-ArtLink/memory/`(MEMORY.md + 개별 파일) — 같은 머신이면 새 계정 세션도 자동 로드. 머신 이동 시엔 함께 복사.
- 대화의 *핵심*(결정·변경·이유)은 이 0장 + `git log` 커밋 메시지에 모두 녹여둠.

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
