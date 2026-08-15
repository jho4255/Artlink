# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ArtLink — 갤러리-아티스트 매칭 모바일웹 플랫폼 (PWA). 3가지 역할: Artist(포트폴리오/지원/리뷰), Gallery(갤러리/공모 등록), Admin(승인/운영). Frontend와 Backend가 분리된 모노레포 구조.

> 🔑 **새 세션/계정 인계 시**: `HANDOFF.md`의 **0장(계정 인계)** 을 먼저 읽으세요. 현재 상태·최근 변경 이력·다음 작업·운영(배포/계정) 정보가 정리돼 있습니다.

## Commands

```bash
# 전체 실행 (PostgreSQL 시작 → 마이그레이션 → 시드 → 백엔드+프론트엔드 동시 실행)
bash run_web.sh

# Frontend (frontend/ 디렉토리에서)
cd frontend && npm run dev           # 개발 서버 (localhost:5173)
cd frontend && npm run build         # 프로덕션 빌드
cd frontend && npm run lint          # ESLint
cd frontend && npm test              # Vitest 전체 테스트
cd frontend && npx vitest run src/__tests__/show.test.ts  # 단일 테스트 파일

# Backend (backend/ 디렉토리에서)
cd backend && npm run dev            # tsx watch 개발 서버 (localhost:4000)
cd backend && npm test               # Vitest 전체 테스트 (순차 실행, artlink_test DB 사용)
cd backend && npx vitest run src/__tests__/gallery.test.ts  # 단일 테스트 파일

# Database (backend/ 디렉토리에서)
cd backend && npx prisma migrate dev    # 마이그레이션 생성+실행
cd backend && npx prisma generate       # Prisma 클라이언트 재생성
cd backend && npx prisma studio         # DB GUI (localhost:5555)
cd backend && npx tsx prisma/seed.ts    # 시드 데이터 실행

# WSL2 필수: PostgreSQL 재부팅 후 수동 시작
sudo service postgresql start
```

## Architecture

**모노레포**: `frontend/` (React+Vite+TS) + `backend/` (Express+Prisma+PostgreSQL)

### Frontend (`frontend/src/`)
- **pages/**: 11개 라우트 페이지 (MyPage.tsx ~1400줄이 가장 큼)
- **components/**: layout(Navbar), home(HeroSlider, QuickActionCards), gallery(InstagramFeed), shared(ProtectedRoute, ImageUpload, ImageLightbox, ConfirmDialog)
- **stores/**: Zustand — `authStore` (JWT + localStorage persist)
- **lib/**: `axios.ts` (JWT 인터셉터, 15s 타임아웃), `queryClient.ts` (staleTime 5min, retry 3), `utils.ts`
- **types/**: 전역 TypeScript 타입

### Backend (`backend/src/`)
- **routes/**: 14개 모듈 — auth, gallery, exhibition, show, review, favorite, portfolio, approval, hero, benefit, galleryOfMonth, upload, notification, inquiry
- **middleware/**: `authenticate`(필수 JWT), `optionalAuth`(선택), `authorize(roles)`(역할 검증), `errorHandler`
- **lib/**: `prisma.ts` (싱글톤), `mailer.ts` (nodemailer), `logger.ts` (파일+콘솔 로깅)
- **prisma/**: `schema.prisma` (18개 모델, Single Source of Truth), `seed.ts` (4 users, 3 galleries, 2 exhibitions, 2 shows 등)

### Key Patterns
- **Vite proxy**: `/api` → `localhost:4000`, `/uploads` → `localhost:4000`
- **Auth flow**: Axios 인터셉터가 JWT 자동 첨부, 401 → `authStore.logout()`
- **TanStack Query**: `invalidateQueries` on all mutations (cross-component 포함)
- **Optimistic updates**: 모든 찜 토글에 적용 — `onMutate`(cancelQueries + setQueryData flip) → `onError`(rollback) → `onSettled`(invalidate)
- **MyPage 찜 삭제**: `setQueriesData`로 galleries/exhibitions 캐시까지 직접 수정 (stale 캐시 깜빡임 방지)
- **Review CUD → gallery rating 자동 재계산** (aggregate)
- **GotM**: GET에서 만료된 항목 where 필터 (deleteMany 아님, DB 레코드 유지)
- **Favorite toggle**: existing→delete, not→create, return `{favorited: bool}`
- **Cascade delete**: Gallery→Images/Exhibitions/Shows/Reviews, Exhibition→PromoPhotos/Applications
- **AppError class**: `statusCode` 포함 구조화된 에러
- **ImageLightbox**: Portal 기반, `initialIndex` prop 사용 (NOT `currentIndex`), 부모에서 `AnimatePresence`로 감싸야 exit 애니메이션 동작

## Testing

- **889 tests**: Backend 701 (supertest, `artlink_test` DB 순차), Frontend 188 (jsdom)
- **Backend**: `artlink_test` DB 사용, `fileParallelism: false` 순차 실행, `setup.ts`에서 migrate deploy
- **Frontend**: jsdom 환경, 순수함수(utils) + zustand store 테스트
- **Test helper** (`backend/src/__tests__/helpers.ts`): `cleanDb` (TRUNCATE CASCADE), `seedUsers` (id 1-4), `seedGallery`, `seedShow`
- **Backend index.ts**: `NODE_ENV=test` 시 listen/rateLimit/morgan 비활성화
- **모든 코드 수정 완료 후** `cd backend && npm test` + `cd frontend && npm test` 실행 필수. 기존 코드 수정 시 변경된 로직에 대응하는 테스트가 없으면 추가 작성 필수.

## Critical Constraints

1. **Prisma v5만 사용** — v7은 `datasource url` 제거 등 breaking change, 절대 업그레이드 금지
2. **Tailwind CSS v4** — `@import "tailwindcss"` 문법 사용 (구 `@tailwind` 디렉티브 아님), `@tailwindcss/vite` 플러그인
3. **Express v5** — SPA wildcard `/{*path}` 문법 필수 (`*` 단독 사용 불가)
4. **seed.ts upsert 규칙**: 스키마에 새 필드 추가 시 `update` 블록에도 반드시 해당 필드 포함 (Render DB는 유지되므로 기존 레코드는 update 경로를 탐. 로컬 migrate reset에서는 드러나지 않음)
5. **architecture.md 업데이트** — 코드 변경 시 반드시 갱신
6. **승인 거절 시 rejectReason 필수** — 없으면 400 에러
7. **Admin은 찜 버튼 미표시** — GalleriesPage, GalleryDetailPage, ExhibitionsPage, ExhibitionDetailPage, ShowsPage, ShowDetailPage에서 `!isAdmin` 조건
8. **gradient overlay에 `pointer-events-none` 필수** — `absolute inset-0` 오버레이가 아래 요소 클릭 차단
9. **Framer Motion drag+animate 동시 사용 금지** — `drag="x"` + `animate={controls}` 이중 x 제어 충돌. AnimatePresence+variants 방식 사용
10. **찜 연동은 invalidate만으로 부족** — cross-cache `setQueriesData`로 즉시 수정해야 stale 깜빡임 방지
11. **ImageLightbox**: `initialIndex` prop 사용 (NOT `currentIndex`), 부모에서 `AnimatePresence`로 감싸야 exit 애니메이션 동작
12. **ImageUpload**: `placeholder` prop 사용 (NOT `label`)
13. **Show artists 필드** — DB에 JSON string 저장 (`JSON.stringify`), API에서 `JSON.parse`로 배열 반환. null 허용
14. **날짜 경계는 KST 기준** — `<input type="date">`→`new Date("YYYY-MM-DD")`는 UTC 자정(=KST 09:00)로 저장됨. 마감/만료/전시상태 판정은 반드시 KST 달력 날짜 단위로: 백엔드 `lib/kstDate.ts`(`startOfTodayKstAsUtc`/`endOfTodayKstAsUtc`/`isDeadlinePassedKst`), 프론트 `utils.ts`(`getDday`/`getShowStatus`). 순수 `new Date()` 비교 금지(마감일 당일 09시 소멸 버그)
15. **작가 제출자료 완료 판정** — cv/note는 빈 객체도 저장되므로 `!!`로 판정 금지. `lib/submission.ts`의 `hasSubmissionContent`(내용 존재 검사)로 통일. 프론트도 동일 predicate 사용
16. **R2 이미지를 `fetch`로 받을 땐 `cache: 'reload'` 필수** (`lib/imageFetch.ts`) — 화면이 같은 이미지를 평범한 `<img src>`(crossorigin 없음)로 먼저 그리면 브라우저 캐시에 **CORS 정보 없는 항목**이 남고, 이후 CORS 모드 `fetch`가 그 항목을 재사용하며 차단된다(서버 헤더는 정상). 그러면 R2 직접 경로가 죽고 **에러 없이 조용히** 백엔드 프록시로 되돌아가 느려진다. `force-cache` 제거만으로는 해결되지 않음(실측). 썸네일이 떠 있는 상태로 다운로드해야 재현된다
17. **`R2_PUBLIC_URL`은 쉼표 구분 목록** — **첫 번째**가 신규 업로드용 정식 주소, **전체**가 프록시 허용·파일 삭제로 인정할 주소(`backend/src/lib/r2Urls.ts`). 2026-08-04 개발용 `pub-*.r2.dev` → `img.artlink.cc` 전환 때문. **DB에 옛 주소가 남아 있는 한 목록에서 빼지 말 것** — 빼면 ①프록시가 옛 주소를 400으로 막아 폴백이 죽고 ②`deleteUploadedFile`이 옛 주소를 못 알아봐 **에러 없이 조용히** 고아 파일을 남긴다. 코드에서 `process.env.R2_PUBLIC_URL`을 직접 접두사 비교하지 말고 `r2CanonicalBase()`/`matchR2Base()`를 쓸 것
18. **작품 이미지는 자르지도 늘리지도 말 것** — 회화에서 비율은 작품 그 자체다. 포맷 엔진의 `img()` 헬퍼가 `object-fit:contain`을 강제하고, 크기는 `max-width`/`max-height`로만 준다. 화면 쪽도 마찬가지(`aspect-square + object-cover` 금지). 회귀 방지 테스트가 `portfolioFormats.test.ts`에 있다
19. **포트폴리오 포맷 페이지는 `PAD` 상수에서만 여백을 읽을 것** (`lib/portfolioFormats.ts`) — 페이지별로 숫자를 손으로 적었더니 포맷 D에서 머리말과 작품이 **겹치고**, 포맷 C 페이지가 하단 연락처 줄을 **뚫고 나갔다**. 이미지 높이는 `availH()`/`captionH()`로 계산한다. 대각선 장식은 `transform` 금지 → **`linear-gradient`로** (html2canvas가 transform을 정확히 재현하지 않음). 렌더 전 `await document.fonts.ready` 필수 — 없으면 표지 큰 글씨가 폴백 글꼴로 찍힌다
20. **경력(`Career`)의 `education`/`award`는 선택 항목** — 기존에 저장된 JSON엔 없다. 직접 `career[key].length`로 접근 금지, 반드시 `lib/artwork.ts`의 `normalizeCareer()`를 통과시킬 것 (안 그러면 옛 데이터에서 런타임 에러)
21. **목록 썸네일은 `Thumb` 컴포넌트로** (`components/shared/Thumb.tsx`) — 목록이 원본을 받아 한 페이지에 96MB를 쓰던 문제. 업로드 시 `t240/`에 240px를 함께 생성(`backend/src/lib/thumb.ts`), 없으면 원본 폴백. **확대·라이트박스·PDF는 원본 유지**(키우면 뭉개짐). 썸네일 키를 `String.replace`로 만들지 말 것 — 디렉터리가 중복돼 **R2에서만 조용히** 깨진다
22. **공모 운영 권한은 `lib/exhibitionAccess.ts`로만 판정** — 아트링크(Admin) 주최 공모(`hostType='ADMIN'`)는 admin이 지정한 여러 갤러리(`ExhibitionManager`)가 오너처럼 운영한다. **위임은 `hostType==='ADMIN'`일 때만 인정**할 것 — 갤러리 주최 공모에 위임 행이 섞여도 권한을 주면 **남의 공모 지원자 개인정보가 통째로** 열린다. 새 엔드포인트에서 `gallery.ownerId !== req.user.id` 를 직접 쓰지 말고 `assertCanManageExhibition`(Admin 포함)/`operableExhibitionWhere` 를 쓸 것. **지원자 관리·초대·홍보사진 라우트에 `authorize('GALLERY')` 만 걸면 Admin이 막힌다** — 실제로 관리자가 수락/거절을 못 했다. `galleryId`(주관 갤러리)는 기존 코드 79곳이 전제하므로 nullable로 바꾸지 말 것
23. **`frontend/index.html`의 SEO 마커 삭제 금지** — `<!--SEO_META_START-->`~`<!--SEO_META_END-->` 사이를 서버(`lib/seoMeta.ts`)가 상세 페이지 요청 시 교체한다. 마커가 사라지면 **에러 없이 조용히** 기본 meta로 되돌아감(카톡 공유 미리보기·검색 노출 전부 무력화). meta 값을 코드로 만들 때는 반드시 `buildMetaTags()`를 통과시킬 것 — 직접 문자열 연결 시 XSS. 킬스위치 `SEO_META=off`

## TanStack Query Key Map

| 쿼리 키 | 사용 위치 | invalidate 하는 곳 |
|---------|----------|-------------------|
| `['galleries', ...]` | GalleriesPage | 찜 토글 |
| `['gallery', id]` | GalleryDetailPage | 찜, 리뷰 CUD, 상세수정, 홍보사진 |
| `['exhibitions', ...]` | ExhibitionsPage | 찜, 지원 |
| `['exhibition', id]` | ExhibitionDetailPage | 찜, 지원, 삭제 |
| `['shows', ...]` | ShowsPage | 찜 토글 |
| `['show', id]` | ShowDetailPage | 찜, 소개수정 |
| `['gallery-of-month']` | GalleryOfMonth | 리뷰 CUD, Admin GotM 관리 |
| `['hero-slides']` | HeroSlider, Admin | Admin Hero CRUD |
| `['benefits']` | BenefitsPage, Admin | Admin Benefit CRUD |
| `['favorites']` | MyPage, 찜 토글 전체 | 모든 찜 토글 |
| `['portfolio']` | MyPage Artist | 포트폴리오 수정 |
| `['my-reviews']` | MyPage Artist | 리뷰 수정/삭제 |
| `['my-applications']` | MyPage Artist | 지원 |
| `['my-galleries']` | MyPage Gallery | 갤러리 등록 |
| `['my-exhibitions']` | MyPage Gallery | 공모 등록/삭제 |
| `['my-shows']` | MyPage Gallery | 전시 등록/삭제 |
| `['approvals']` | MyPage Admin | 승인/거절 |
| `['notifications']` | Navbar 알림 dropdown | 읽음/전체읽음 |
| `['unread-count']` | Navbar 벨 뱃지 | 30초 polling, 읽음/전체읽음 |
| `['inquiries']` | SupportPage | 문의 작성/답변 |

## Deployment (Render.com)

- **URL**: https://artlink-stmq.onrender.com
- **브랜치**: `deploy/render` (main에서 작업 → merge → push)
- **빌드 순서**: frontend build → backend build → prisma migrate deploy → seed → npm start
- ⚠️ **Node 버전 고정 필수** — `backend/package.json`의 `engines.node`는 **`24.x`(LTS)**. 예전엔 `">=20"`이라 Render가 매번 **최신 Node**를 골랐고, 2026-08-03 새로 나온 **26.6.0 설치 실패**로 배포가 죽었다(`Unable to install Node.js version 26.6.0`). 범위 지정 금지 — 새 Node가 나올 때마다 무작위로 배포가 깨진다. `.nvmrc`(24)도 함께 둔다.
- ⚠️ **배포 전 검증은 `npm run build`로** — `tsc --noEmit`은 테스트 파일을 검사하지 않아 통과하지만, 실제 빌드는 `tsc -b && vite build`라 테스트까지 검사한다. 실제로 테스트의 타입 오류로 배포가 실패한 적 있다(2026-08-03).
- **모놀리스 배포**: Backend Express가 Frontend `dist/`도 서빙
- **이미지 업로드**: Cloudinary 환경변수 유무로 자동 전환 (있으면 Cloudinary, 없으면 디스크)
- **PWA 캐시**: workbox `skipWaiting` + `clientsClaim`, `controllerchange` → 자동 reload
- **요금제(Starter)**: 2026-07 무료→Starter 전환. **스핀다운/콜드스타트 없음**, PostgreSQL **90일 자동삭제 없음**(영구 유지). 백업 보존은 대시보드에서 확인 권장(별도 pg_dump→R2 오프사이트 백업 미구성)
- **재배포**: `git checkout deploy/render && git merge main && git push`
- 🔒 **배포 전 데이터 유출 점검 필수** — `bash scripts/predeploy-check.sh`
  - `.githooks/pre-push`가 **push 때 자동 실행**한다. 최초 1회만 `git config core.hooksPath .githooks`
  - 막는 것: DB 덤프(`*.dump/*.sql/*.csv` — 마이그레이션 제외) · `.env` 계열 · `backend/uploads` 원본 ·
    파일 내용의 실서버 접속정보(Render Postgres 호스트, 비밀번호가 박힌 DB URL) 및 GitHub 토큰 · 2MB 초과 신규 파일
  - **왜**: 실서버 DB를 로컬로 복제해 확인하는 일이 잦다. 그때 생기는 덤프·`.env` 백업이 커밋되면
    **실제 가입자 개인정보가 GitHub에 공개**된다. 한번 올라가면 커밋을 지워도 퍼진 것으로 봐야 하므로
    올라가기 전에 막는 게 유일한 방어다. 실제로 `.env.local-backup`이 추적 대상이라 커밋될 뻔했다(2026-08-11)
  - 우회는 `--no-verify`지만, 걸린 이유를 먼저 확인할 것

## 개발 원칙

- **아키텍처 문서 유지**: 신규 작성 및 변경 시 항상 `architecture.md`에 반영
- **사용자 가이드**: 기능 구현 시 코드 블록 위치를 명시한 개발자 가이드를 주석이나 문서로 남길 것 (큰 틀에서)
- **데이터 무결성**: 등록/수정/삭제 시 서버 상태와 DB 동기화 보장 및 예외 처리 철저
- **검증**: 단일 기능 검증 + 복합 시나리오 ([등록→승인→검색→지원]) 전체 흐름 테스트
- **상업화 고려**: 인증(OAuth), 환경 변수 교체가 용이한 추상화 구조 유지

## 미완료 항목 (우선순위 순)

1. **React-hook-form + Zod** — 설치됨(v7.71, v4.3)이나 미사용. 갤러리/공모 등록 폼에 적용 필요
2. **수정 요청 UI** — 백엔드 API 완성, 프론트엔드 MyPage Gallery 섹션에 "수정 요청" 버튼+폼 미구현
3. **ESLint + Prettier** — eslint.config.js 존재하나 팀 규칙 미설정
4. **MyPage 분리** — `MyPage.tsx` ~3000줄 단일 파일. 섹션별 컴포넌트 분리 고려
5. 나머지 페이지 `DESIGN.md` 기반 리디자인 (상세/마이페이지/혜택/고객센터)

> 2026-07 완료: 코드 스플리팅(React.lazy), 목록필터 URL 동기화, 알림 TTL 정리(읽은 90일+), 업로드 orphan 파일 정리(`lib/storage.ts`)

## 참고 문서

- `HANDOFF.md` — **인계/현재상태 우선**. 0장(계정 인계)에 최근 변경 이력·운영 정보·다음 작업 정리. 이하 장은 API 전체·인증 플로우·버그 이력 등 상세 레퍼런스
- `architecture.md` — 상세 아키텍처 (데이터 모델, API 상세, 컴포넌트 가이드, 로깅/안정성)
- `REQUIREMENTS_CHECKLIST.md` — 요구사항 체크리스트

---

## 유저 시나리오 및 UI 로직 상세

### 1. 초기 진입 및 공통 UI
- **Navigation Bar**: 전 페이지 노출. 좌측 [ArtLink 로고](클릭 시 홈 이동), 우측 [홈, 갤러리, 모집공고, 혜택, 마이페이지].
- **Hero Section (슬라이더)**:
    - Admin이 [사진, 제목, 링크 URL] 등록/수정/삭제 가능.
    - 3초 자동 슬라이드. **사용자가 수동 조작(슬라이드) 시 해당 시점부터 타이머 리셋 후 3초 뒤 다시 자동 시작.**
    - [바로가기] 버튼 우측 하단 배치: 외부 URL은 브라우저 새 창, 내부 URL은 라우팅 이동.
- **Center Catchphrase**: "갤러리와 아티스트를 잇다 : ArtLink" (중단 배치)
- **Quick Action Cards**: [갤러리 찾기 / 진행중인 공고 / 혜택] 페이지로 즉시 연결. 각각에 어울리는 픽토그램 생성.

### 2. 마이페이지 및 권한 (My Page)
- **인증**: 비로그인 시 로그인 창 노출. 로그아웃 시 로그인 페이지 이동. **프로필 사진 변경 기능** 포함.
- **Artist 유저**:
    - **포트폴리오**: [작가 약력, 작가노트, 한 줄 소개, 경력(학력/개인전/단체전/아트페어/수상), 작품 사진(최대 30장)] 관리.
      - **작품 정보**: 사진을 누르면 [작품명, 시리즈, 크기(가로×세로), 재료, 제작연도, 판매상태, 작품 설명] 입력. 실제 작가 포트폴리오는 예외 없이 작품마다 캡션을 붙이므로 이 정보가 없으면 포맷 PDF에서 캡션이 통째로 빠진다 — 미입력 작품엔 '정보 없음' 배지 표시.
      - **시리즈**: 작품에 붙인 시리즈명으로 자동으로 묶이고, 시리즈마다 소개 글을 넣으면 PDF에 소개 페이지가 생긴다.
      - **포맷 PDF**: 4종(포맷 A 16:9 / 포맷 B A4가로 / 포맷 C A4가로 / 포맷 D A4세로) 중 골라 미리보기 후 저장. 미리보기는 PDF와 **같은 HTML**을 축소해 보여준다(`components/shared/PortfolioFormatPicker.tsx`, `lib/portfolioFormats.ts`).
    - **찜 목록**: 갤러리(갤러리명)와 공모(갤러리명-공모명) 구분 노출. **찜 취소 시 목록에서 즉시 제거.**
    - **활동 내역**: 본인이 작성한 리뷰 및 지원한 공고 목록 모아보기.
    - **지원 내역 관리**: 지원한 공모 목록에서 상태 배지 표시 (접수/검토중/수락/거절).
      - **상태 필터**: 전체/접수/검토중/수락/거절 탭으로 필터링 + 각 상태별 카운트 표시.
      - **지원 답변 확인**: 카드 클릭 시 확장하여 내가 입력한 커스텀 답변(텍스트, 선택, 다중선택, 파일) 확인 가능.
      - **공모 상세 이동**: 확장 영역에서 해당 공모 상세 페이지로 바로 이동.
- **Gallery 유저**:
    - **갤러리 등록**: [이름, 주소, 소개, 대표자명, 전화번호, 대표 이미지, 지역 태그] 승인 요청.
    - **공모 등록**: [대상 갤러리 선택, 제목, 구분(개인전/아트페어), 공모시작일, 공모마감일, 전시시작일, 전시종료일, 모집인원, 지역, 소개] 승인 요청. **4개 날짜 필드 모두 필수.**
      - **검증 강화**: 미입력 필수 항목을 구체적으로 표시 (줄바꿈 toast + 빨간 테두리/라벨 하이라이트). 입력 시 즉시 에러 해제.
    - **공모 추가정보 (커스텀 필드)**: 공모 등록 시 지원자에게 추가 요청할 정보 설정 가능.
      - 필드 타입: **텍스트**(text, 글자수 제한 설정 가능 / maxLength > 200이면 textarea로 자동 렌더링), **선택형**(select, maxSelect로 단일/복수 제어: 1=단일선택 라디오버튼, 2+=최대N개 체크박스, 0=무제한 체크박스), **파일 업로드**(file)
      - 각 필드에 라벨, 필수 여부, 옵션(선택형 시) 개별 추가/삭제 가능
      - 텍스트 필드: `maxLength` 속성으로 글자수 제한 (0 = 무제한). 지원 모달에서 실시간 글자수 카운트 표시.
      - 선택형 필드: `maxSelect` 속성으로 동작 제어 (1=단일선택 라디오버튼, 2+=최대N개 체크박스, 0=무제한 체크박스). 초과 시 체크박스 비활성화 + 카운트 표시.
      - **maxSelect vs 옵션 수 검증**: 최대 선택 수가 옵션 수보다 많으면 등록/수정 시 경고 후 차단.
      - 게시(승인) 후에도 Gallery 오너가 커스텀 필드 수정 가능 — **공유 모달** `components/shared/CustomQuestionsEditor.tsx`(default export `CustomQuestionsEditModal`)를 **MyPage 내 공모 카드**(운영/클래식 뷰의 "추가 질문" 버튼)에서 호출 → `PATCH /exhibitions/:id/custom-fields`. (공고 상세 페이지에는 진입점 없음 — 마이페이지 전용). 단일선택(`type:'select'`,maxSelect 1)↔다중선택(`type:'multiselect'`)은 "중복 선택 허용" 토글로 전환, `maxSelect`도 편집. 등록 폼과 동일한 `CustomQuestionBuilder`/`sanitizeCustomFields`를 공유. 기존 지원자 답변은 유지됨.
      - **백엔드 Zod 스키마**: `customFieldSchema`에 `maxLength`, `maxSelect` optional 필드 포함 → DB 저장/조회 시 유실 방지.
    - **지원자 관리**: 공모별 지원자 목록 조회, 커스텀 답변 확인, 상태 변경 (접수 → 검토중 → 수락/거절).
      - **엑셀(CSV) 다운로드**: 지원자 목록을 CSV로 내보내기 (이름, 이메일, 지원일, 상태, 커스텀 답변 포함). BOM 포함 UTF-8 인코딩.
      - API: `GET /exhibitions/:id/applications`, `PATCH /exhibitions/:id/applications/:appId`
    - **상태 확인**: 승인 대기 / 승인 거절(**거절 사유 확인 가능**) / 승인 완료 상태 제공.
    - **수정 정책**: 승인 후 상세 내용만 수정 가능. 초기 정보 수정은 Admin에게 수정 요청 기능 사용.
- **Admin 유저**:
    - **승인 큐**: 갤러리/공모 등록 및 수정 요청 승인/거절(**거절 시 사유 작성 필수**).
    - **운영 관리**: Hero Section, 혜택 목록 관리 시 **[등록 전 미리보기]** 기능 제공.
    - **이달의 갤러리**: 갤러리 검색 선정 및 **등록 기한 만료 시 자동 제거** 로직 구현.
    - **개발자 도구**: 마이페이지 '개발자 도구' 탭의 **[수락 상태 되돌리기 허용]** 전역 토글(`AppSetting` key-value, `GET/PUT /api/admin/dev-settings`). ON이면 **전체 갤러리**가 수락한 지원을 거절로 되돌릴 수 있음 — 되돌리면 해당 작가의 운영페이지 제출물·판매·정산 데이터 삭제 + 정원 슬롯 복구 (정산 완료 공모는 불가). 갤러리 UI는 `GET /api/settings/flags`로 토글 상태 확인.

### 3. 서비스 화면별 세부 동작
- **갤러리 찾기**:
    - 그리드: 반응형 masonry 레이아웃 (모바일 1열, 태블릿 2열, 데스크톱 3열). 세로형 카드: 상단 이미지(4:3), 하단 정보(이름, 주소, 전화번호, 한줄소개, 찜하기, 별점).
    - 필터: 지역(서울, 경기 북/남, 대전, 부산), 별점(3/4점+). **현재 적용된 필터 목록을 화면에 표시.**
    - 정렬: 별점순 나열 기능.
- **갤러리 상세**:
    - 상단 스와이프 사진, 우상단 하트(찜), 상세 소개(주인일 때만 수정 버튼 노출), 진행 중 공고(D-day).
    - 전시 종료 후 **홍보용 사진 및 후기 글 등록** 기능 (Gallery 유저 전용).
    - **리뷰**: Artist 전용. [별점, 사진(옵션), 텍스트]. 익명 시 `익명의 예술가 N` 표기. Admin은 삭제 버튼 노출.
- **모집 공고**:
    - D-day가 남은 공고만 노출. 갤러리 별점 및 지역 필터 제공.
    - **지원하기**: 클릭 시 갤러리 오너에게 인앱 알림(NEW_APPLICANT) 발송 (Artist 전용). ※ 포트폴리오 이메일 자동전송 기능은 제거됨(2026-07, mailer 삭제).
    - **커스텀 필드 지원**: 공모에 추가정보 항목이 있으면 지원 시 모달에서 입력.
      - 텍스트: 글자수 제한 시 실시간 카운트 표시, maxLength > 200이면 textarea로 자동 전환.
      - 선택형(select): maxSelect=1이면 **라디오 버튼**, 2+/0이면 **체크박스**. 최대 선택 수 도달 시 나머지 비활성화 + 카운트 표시.
      - **검증 강화**: 제출 시 모든 필수/글자수/선택수 오류를 한번에 수집하여 줄바꿈 toast로 표시. 오류 필드에 빨간 테두리(ring) + 라벨 색상 강조.
      - **커스텀 답변 표시**: 긴 텍스트 overflow 방지 (`whitespace-pre-wrap break-all`), 배경 박스(`bg-gray-50 rounded px-2 py-1`)로 가독성 향상.
    - **지원 상태**: Artist는 마이페이지에서 본인의 지원 상태(접수/검토중/수락/거절) 확인 가능.
