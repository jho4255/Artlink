# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ArtLink — 갤러리-아티스트 매칭 모바일웹 플랫폼 (PWA). 3가지 역할: Artist(포트폴리오/지원/리뷰), Gallery(갤러리/공모 등록), Admin(승인/운영). Frontend와 Backend가 분리된 모노레포 구조.

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
- **routes/**: 12개 모듈 — auth, gallery, exhibition, show, review, favorite, portfolio, approval, hero, benefit, galleryOfMonth, upload
- **middleware/**: `authenticate`(필수 JWT), `optionalAuth`(선택), `authorize(roles)`(역할 검증), `errorHandler`
- **lib/**: `prisma.ts` (싱글톤), `mailer.ts` (nodemailer), `logger.ts` (파일+콘솔 로깅)
- **prisma/**: `schema.prisma` (16개 모델, Single Source of Truth), `seed.ts` (4 users, 3 galleries, 2 exhibitions, 2 shows 등)

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

- **161 tests**: Backend 128 (20 files, supertest), Frontend 33 (4 files, jsdom)
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

## Deployment (Render.com)

- **URL**: https://artlink-2esp.onrender.com
- **브랜치**: `deploy/render` (main에서 작업 → merge → push)
- **빌드 순서**: frontend build → backend build → prisma migrate deploy → seed → npm start
- **모놀리스 배포**: Backend Express가 Frontend `dist/`도 서빙
- **이미지 업로드**: Cloudinary 환경변수 유무로 자동 전환 (있으면 Cloudinary, 없으면 디스크)
- **PWA 캐시**: workbox `skipWaiting` + `clientsClaim`, `controllerchange` → 자동 reload
- **무료 플랜**: 15분 미사용 시 sleep (~30초 콜드스타트), PostgreSQL 90일 후 자동 삭제
- **재배포**: `git checkout deploy/render && git merge main && git push`

## 개발 원칙

- **아키텍처 문서 유지**: 신규 작성 및 변경 시 항상 `architecture.md`에 반영
- **사용자 가이드**: 기능 구현 시 코드 블록 위치를 명시한 개발자 가이드를 주석이나 문서로 남길 것 (큰 틀에서)
- **데이터 무결성**: 등록/수정/삭제 시 서버 상태와 DB 동기화 보장 및 예외 처리 철저
- **검증**: 단일 기능 검증 + 복합 시나리오 ([등록→승인→검색→지원]) 전체 흐름 테스트
- **상업화 고려**: 인증(OAuth), 환경 변수 교체가 용이한 추상화 구조 유지

## 미완료 항목 (우선순위 순)

1. **React-hook-form + Zod** — 설치됨(v7.71, v4.3)이나 미사용. 갤러리/공모 등록 폼에 적용 필요
2. **수정 요청 UI** — 백엔드 API 완성, 프론트엔드 MyPage Gallery 섹션에 "수정 요청" 버튼+폼 미구현
3. **Nodemailer 실제 전송** — SMTP 설정 시 작동. 현재 콘솔 로그만
4. **코드 스플리팅** — 프론트 번들 572KB. React.lazy + Suspense로 페이지별 분리
5. **ESLint + Prettier** — eslint.config.js 존재하나 팀 규칙 미설정
6. **MyPage 분리** — ~1400줄 단일 파일. 섹션별 컴포넌트 분리 고려

## 참고 문서

- `architecture.md` — 상세 아키텍처 (데이터 모델, API 상세, 컴포넌트 가이드, 로깅/안정성)
- `HANDOFF.md` — 전체 핸드오프 문서 (50개 API 엔드포인트 전체, 인증 플로우, 버그 수정 이력, 배포 장애 기록)
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
    - **포트폴리오**: [전시 이력, 작가 약력, 작품 사진(최대 30장)] 관리.
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
      - 승인 후에도 커스텀 필드 수정 가능 (Gallery 오너, ExhibitionDetailPage에서 인라인 수정). 수정 시 `maxLength`, `maxSelect` 값도 편집 가능.
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

### 3. 서비스 화면별 세부 동작
- **갤러리 찾기**:
    - 리스트: 1줄 1개 구성. 사진, 이름, 주소, 전화번호, 한줄소개, 찜하기, 별점 노출.
    - 필터: 지역(서울, 경기 북/남, 대전, 부산), 별점(3/4점+). **현재 적용된 필터 목록을 화면에 표시.**
    - 정렬: 별점순 나열 기능.
- **갤러리 상세**:
    - 상단 스와이프 사진, 우상단 하트(찜), 상세 소개(주인일 때만 수정 버튼 노출), 진행 중 공고(D-day).
    - 전시 종료 후 **홍보용 사진 및 후기 글 등록** 기능 (Gallery 유저 전용).
    - **리뷰**: Artist 전용. [별점, 사진(옵션), 텍스트]. 익명 시 `익명의 예술가 N` 표기. Admin은 삭제 버튼 노출.
- **모집 공고**:
    - D-day가 남은 공고만 노출. 갤러리 별점 및 지역 필터 제공.
    - **지원하기**: 클릭 시 마이페이지의 포트폴리오를 해당 갤러리 메일로 자동 전송 (Artist 전용).
    - **커스텀 필드 지원**: 공모에 추가정보 항목이 있으면 지원 시 모달에서 입력.
      - 텍스트: 글자수 제한 시 실시간 카운트 표시, maxLength > 200이면 textarea로 자동 전환.
      - 선택형(select): maxSelect=1이면 **라디오 버튼**, 2+/0이면 **체크박스**. 최대 선택 수 도달 시 나머지 비활성화 + 카운트 표시.
      - **검증 강화**: 제출 시 모든 필수/글자수/선택수 오류를 한번에 수집하여 줄바꿈 toast로 표시. 오류 필드에 빨간 테두리(ring) + 라벨 색상 강조.
      - **커스텀 답변 표시**: 긴 텍스트 overflow 방지 (`whitespace-pre-wrap break-all`), 배경 박스(`bg-gray-50 rounded px-2 py-1`)로 가독성 향상.
    - **지원 상태**: Artist는 마이페이지에서 본인의 지원 상태(접수/검토중/수락/거절) 확인 가능.
