# ArtLink 아키텍처 문서

> 최종 업데이트: 2026-03-14 (Phase 1-10 + 버그 수정 + Render.com 배포 + UX/버그 4건 + Vitest + tel링크 + PWA캐시갱신 + Instagram 피드 연동 + Show(전시) 기능)

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
│       ├── routes/        # API 라우트 (13개 모듈, notification 포함)
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
| 테스트 | Vitest + supertest (161 tests) | v4.0.18 |
| 백엔드 | Express + TypeScript | - |
| ORM | Prisma | v5 (⚠️ v7 사용 금지) |
| DB | PostgreSQL | 로컬: apt 설치, 배포: Render PostgreSQL |
| 인증 | JWT (개발: 퀵 로그인) | - |
| 파일 업로드 | Multer + Cloudinary (배포) | v2.1 |
| 배포 | Render.com (모놀리스) | `deploy/render` 브랜치 |

## 데이터 모델 (16개 테이블)

- **User** — 사용자 (ARTIST / GALLERY / ADMIN)
- **Gallery** — 갤러리 (승인 워크플로우: PENDING → APPROVED / REJECTED)
- **GalleryImage** — 갤러리 이미지 (1:N)
- **Exhibition** — 공모 (승인 워크플로우)
- **PromoPhoto** — 전시 종료 후 홍보 사진
- **Show** — 전시 (갤러리의 실제 전시/행사, 승인 워크플로우)
- **ShowImage** — 전시 추가 이미지 (1:N)
- **HeroSlide** — 히어로 슬라이드 (Admin 관리)
- **Benefit** — 혜택 (Admin 관리)
- **GalleryOfMonth** — 이달의 갤러리 (자동 만료)
- **Review** — 갤러리 리뷰 (별점, 익명 옵션, 사진, exhibitionId로 공모 연동 — ACCEPTED 지원자만, 공모당 1회)
- **Favorite** — 찜하기 (갤러리/공모/전시)
- **Portfolio** — 아티스트 포트폴리오 (약력 biography, 경력 career[JSON: 아트페어/개인전/단체전], 포트폴리오파일 portfolioFileUrl, 작품사진)
- **PortfolioImage** — 포트폴리오 이미지 (최대 10개)
- **Application** — 공모 지원 (고정 양식: biography 필수, career[JSON], artworkImages[JSON, 1장이상 필수], portfolioFileUrl) — 갤러리별 커스텀 추가정보(customFields) 기능은 제거됨(컬럼만 하위호환 유지)
  - **상태(status)**: 접수(SUBMITTED) / 수락(ACCEPTED) / 거절(REJECTED). **검토중(REVIEWED) 폐지**(기존 데이터는 SUBMITTED로 환원, migration `convert_reviewed_to_submitted`).
  - **전이 규칙**(`PATCH /exhibitions/:id/applications/:appId`): 수락=최종(변경 불가), 거절→수락만 허용(거절→접수 차단), 접수→수락/거절. UI는 수락 시 "수락(확정)" 잠금 배지.
  - **거절 확인**: `rejectionAckedAt` — 작가가 `POST /exhibitions/applications/:appId/acknowledge-rejection` 으로 '확인'해야 본인 지원내역 목록에서 숨김(확인 전엔 거절 카드+확인 버튼 노출). 거절→수락 전환 시 자동 해제.
- **ExhibitionNotice** — 공모 운영 공지사항 (갤러리 작성, 등록 시 수락작가에게 OPERATION_NOTICE 알림)
- **ExhibitionSubmission** — 수락 작가의 전시정보 제출 (출품리스트/작가약력/작가노트 JSON, unique exhibitionId+userId)
- **ArtworkSale** — 전시종료 후 판매작 (artistUserId+artworkIndex, soldPrice 원, unique exhibitionId+artist+index)
- **ArtistSettlement** — 작가별 정산 비율 (galleryRatio %, 작가=100−갤러리, unique exhibitionId+artist)
- **Exhibition** 상태필드: recruitmentClosed(모집마감), confirmed(확정·작가수정잠금/전시시작일경과시자동), ended(전시종료)
  - **라이프사이클 순서 강제** (오너 한정, Admin은 우회): 모집마감 → 확정 → 전시종료. 확정은 모집마감 후, 전시종료는 확정 후에만 가능. 역순 해제는 뒷 단계부터.
- **ExhibitionImage** — 공모 다중 사진 (url, order, exhibitionId Cascade). 첫 사진(order 최소)이 대표 `imageUrl`과 동기화. 기존 `imageUrl`만 있던 공모는 상세 GET 시 lazy 백필. 상세 페이지 인라인 관리(추가/삭제(최소1장)/드래그 순서변경, 최대 20장)
  - API: `POST /api/exhibitions/:id/images`, `DELETE /api/exhibitions/:id/images/:imageId`(최소1장 400), `PATCH /api/exhibitions/:id/images/reorder`{orderedIds}
- **지원자 관리**: 공모 상세에서 분리된 별도 페이지 `/exhibitions/:id/applicants` (ApplicantsPage). 연락처(닉네임·전화·이메일)는 지원 시점부터 오너에게 노출(상태 무관). 지원서 PDF 다운로드(지원자별 `공모명_작가명_지원서.pdf` + 전체 ZIP `공모명_지원서.zip`). 기존 CSV 내보내기 제거. (`operationPdf.ts`: downloadApplicationPdf / downloadAllApplicationsZip)
- **찜(Favorite)**: ARTIST 전용 — 갤러리/공모/전시 목록·상세 모든 곳에서 GALLERY·ADMIN 유저는 하트 버튼 미표시
- **Notification** — 인앱 알림 (APPLICATION_STATUS, NEW_APPLICANT, APPROVAL_RESULT, INQUIRY_REPLY)
- **Inquiry** — 1:1 문의 (subject, content, reply, status: OPEN/ANSWERED)
- **ApprovalRequest** — 수정 승인 요청

## API 엔드포인트 (14개 라우트 모듈)

| 모듈 | 경로 | 주요 기능 |
|------|------|----------|
| auth | /api/auth | 개발 퀵 로그인, 유저 정보, 아바타 변경 |
| hero | /api/hero-slides | 슬라이드 CRUD (Admin) |
| gallery | /api/galleries | 갤러리 목록(지역/별점/정렬/키워드검색 q=이름·주소·소개)/상세/등록/이미지/상세수정/삭제(Admin)/Instagram연동 |
| exhibition | /api/exhibitions | 공모 목록(지역/유형/별점/키워드검색 q=제목·소개)/상세/등록/지원(+이메일)/내 지원/내 공모/홍보사진/삭제(오너/Admin) |
| show | /api/shows | 전시 목록(지역/상태/키워드검색 q=제목·장소·작가)/상세/등록/수정/삭제/이미지관리/내 전시(GALLERY) |
| review | /api/reviews | 리뷰 CRUD, 별점 자동 계산, 익명, 공모 연동 (GET /reviewable/:galleryId) |
| favorite | /api/favorites | 찜하기 토글 (갤러리/공모/전시) |
| portfolio | /api/portfolio | 포트폴리오 CRUD, 이미지 관리 |
| approval | /api/approvals | 승인 큐 (갤러리/공모/전시), 수정 요청 관리 + 알림 트리거 |
| benefit | /api/benefits | 혜택 CRUD (Admin) |
| galleryOfMonth | /api/gallery-of-month | 이달의 갤러리 (자동 만료) |
| upload | /api/upload | 이미지 업로드 (Multer) |
| notification | /api/notifications | 인앱 알림 (목록/읽음처리/전체읽음/미읽음카운트) |
| inquiry | /api/inquiries | 1:1 문의 (작성/목록/상세/Admin답변, 답변 시 알림 트리거) |
| admin | /api/admin | (ADMIN 전용) 사용자 검색·역할변경 + 운영 조회: 공모 지원현황/작가 지원이력/갤러리 게시물 |

### Admin 운영 조회 (ADMIN 전용, `backend/src/routes/admin.ts`)

- `GET /admin/exhibitions?q=&galleryId=` — 전체 공모 목록 + 지원자 수
- `GET /admin/exhibitions/:id/applications` — 특정 공모 지원현황(지원자·상태·결정시각·지원서[약력/경력/작품사진/파일]·카운트)
- `GET /admin/users/:id/applications` — 작가 지원 이력(공모/갤러리/상태/지원·결정시각)
- `GET /admin/galleries?q=` — 갤러리 검색(+공모/전시 수)
- `GET /admin/galleries/:id/posts` — 갤러리가 올린 공모+전시 전체(상태 무관)
- `GET /admin/view-stats` — 상세 페이지 조회수 통계 API: `{galleries, exhibitions, shows, totals}` 각 항목 viewCount 내림차순 (Admin 대시보드용, 현재 UI 미연결·테스트 존재)
- **조회수(viewCount)**: 갤러리/공모/전시 상세 `GET /:id` 응답에 `viewCount` 포함. 각 상세 페이지에서 **ADMIN에게만** 배지로 노출(`components/shared/ViewCountBadge`, GalleryDetail/ExhibitionDetail/ShowDetailPage 제목 옆)
  - 누적: `lib/viewCount.ts`의 `bumpViewCount`가 상세 조회 시 `viewCount` +1 (best-effort). **관리자·소유자 본인 조회는 집계 제외**. 스키마: Gallery/Exhibition/Show.viewCount Int @default(0) (migration ..._add_view_count)
- `Application.updatedAt`(@updatedAt) 추가로 수락/거절 결정 시각 추적 (migration 20260603000000)
- 지원서 고정 양식 컬럼 추가: Portfolio.career/portfolioFileUrl, Application.biography/career/artworkImages/portfolioFileUrl (migration 20260607060000_artist_profile_fields)
- 공용 컴포넌트: `CareerEditor`(경력 편집), `PortfolioFileInput`(pdf/doc/hwp 업로드), `ApplicationContent`(지원서 표시) — 포트폴리오/지원모달/지원자조회 공유
- 지원 모달 '포트폴리오 불러오기' → `GET /portfolio`로 폼 자동 채움
- **공모 운영 페이지** (migration 20260607080000_exhibition_operation)
  - 접근: 갤러리 오너 / Admin / 수락(ACCEPTED) 작가. API `/api/operations/:id/(access|notices|me|submissions|submissions/:userId)`
  - 공지사항: 오너·Admin 작성, 셋 다 열람
  - 작가 제출: 출품리스트(이미지/제목/크기/재료/년도/가격) · 작가약력(헤더+학력/개인전/단체전/아트페어·옥션/수상) · 작가노트(전체+섹션)
  - 열람 권한: 오너·Admin만 전 작가 열람, **작가 상호 비공개** (submissions는 오너/admin, submissions/:userId는 오너/admin/본인)
  - PDF: 인쇄 기반 A4 화면(`OperationPrintPage`), 파일명 `[공모명]_[작가명]_[문서종류]` 자동 제안
  - 전체 PDF 일괄 ZIP: 클라이언트(jsPDF+html2canvas+JSZip, `lib/operationPdf.ts`), `[공모명]_전체제출물.zip`
  - **엽서 대표작** (migration 20260608120000_submission_representative_index): 수락 작가가 본인 출품작 중 1점 선택(`representativeIndex`, 범위 밖은 서버에서 null). `PUT /me` 저장, submissions/readonly에 '엽서 대표작' 뱃지. UI `RepresentativeSelector`(OperationPage)
  - **작품 원본 일괄 다운로드(ZIP)**: 갤러리·Admin이 전 출품작 이미지를 캔버스로 **jpg 변환** 후 ZIP. 파일명 `작가명_제목_크기_재료_년도_가격.jpg`(중복 시 `_2`…). `downloadAllArtworkImagesZip` (`lib/operationPdf.ts`)
  - **캡션 HWP(한글)**: `GET /api/operations/:id/caption.hwp`(오너/Admin). 원본 양식 템플릿(`backend/assets/caption-template.hwp`)을 베이스로 CFB 컨테이너는 그대로 두고 BodyText/Section0의 표 셀 텍스트만 교체(채움=가변 길이+PARA_HEADER 글자수 갱신, 빈칸=같은 길이 공백). 재압축은 유효 deflate 빈 블록 패딩으로 정확 길이 맞춰 섹터 제자리 덮어쓰기+디렉터리 크기 갱신(`backend/src/lib/captionHwp.ts`, cfb 라이브러리 미사용). 한 칸=한 작품(제목/크기/재료/년도+가격, **작가명 미표기**), 최대 96작품. 파일명 `[공모명]_작품캡션.hwp`
  - **제출물 저장 검증**: 작가 전시정보 저장 시 캡션 필수항목(각 출품작 제목/크기/재료/년도/가격)이 비면 차단 + 미입력 항목 팝업(OperationPage `handleSave`/`collectMissing`)
- **공모 상태/정산** (migration 20260607100000_exhibition_lifecycle_settlement)
  - 갤러리·Admin: 운영 페이지 상단 [모집마감]/[확정]/[전시종료] 토글(재오픈 가능). API `PATCH /api/operations/:id/lifecycle`
  - 모집마감/종료 → `GET /exhibitions` 목록·지원에서 제외. 확정(또는 전시 시작일 경과) → 작가 `PUT /me` 잠금
  - 전시종료 → 정산: 작가별 출품작 판매체크+판매가(원), 갤러리비율 입력(작가 자동). API `GET/PUT /api/operations/:id/settlement`
  - 정산 PDF: 작가별/전체 (`downloadArtistSettlementPdf`, `downloadOverallSettlementPdf`). method 지정 시 라벨 "현금/카드 정산서". R2 이미지는 `proxied()`로 동일출처 프록시 경유(캔버스 taint 방지 → PDF에 작품사진 정상 표시)
  - **정산 2단계 승인제** (migration 20260614141021 settledAt, 20260615 settlement_approval):
    - `SettlementApproval{exhibitionId,artistUserId,status PENDING|APPROVED|ISSUE,comment}` + `Exhibition.settlementRequestedAt`
    - 흐름: 갤러리 [정산 확인 요청]`POST .../settlement/request`(수락작가 전원 PENDING 생성+알림 SETTLEMENT_CONFIRM_REQUEST) → 작가 `POST .../settlement/respond`{approve|comment}(수락 APPROVED / 문제 ISSUE+코멘트→오너 알림 SETTLEMENT_ISSUE) → 전원 APPROVED여야 `POST .../settlement/complete`(settledAt) 가능
    - 요청 중: `PUT settlement` 403 잠금, [요청 취소]`.../settlement/request/cancel`로 해제 후 수정·재요청
    - `my-settlement`: **요청중 또는 완료 시** 작가에게 공개(+myApproval). `GET settlement`: artist별 approval + allApproved
    - 프론트: 갤러리 정산섹션 OPEN[정산저장|정산확인요청]/REQUESTED[요청취소|정산완료(전원수락시활성)]+작가별 수락/문제뱃지+코멘트, 작가 [수락]/[문제제기+코멘트]
- **ArtLook** (`frontend/public/artlook/` 정적 페이지, 구 poc/frameit) — 작품 액자·전시공간 목업 합성(클라이언트 Canvas). 운영페이지 정산 섹션 [ArtLook으로 홍보 이미지 만들기]가 판매작을 `localStorage 'artlook:works'`([{url,title,artist,exhibition}])로 넘겨 `/artlook/index.html` 새 탭으로 염. 다운로드 파일명 `작가_작품명_공모명_판매작.png`. 첨부 없음(판매작만). 운영(R2 외부도메인) 이미지는 캔버스 taint 방지 위해 `GET /api/upload/image-proxy?url=`(R2_PUBLIC_URL 화이트리스트, SSRF가드)로 동일출처 중계
- 프론트: MyPage Admin '운영 조회' 탭 (`OversightSection` → 공모 지원현황/작가 지원이력/갤러리 게시물 서브탭)

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
- Navbar 우측 상단: 비로그인 시 [로그인], 로그인 시 [로그아웃](캐시 clear + logout + /login)

### 회원 탈퇴 (소프트 삭제 + 익명화, migration 20260614120048_add_user_deleted_at)
- `User.deletedAt DateTime?` — null 아니면 로그인 차단 + 공개 표시 '탈퇴한 회원'. 행은 유지(참조 무결성·거래기록 보존)
- `GET /auth/me/withdraw-info` — 탈퇴 영향 요약(보유 갤러리/진행 공고/대기 지원자) + 본인확인 방식(`confirmMethod`: LOCAL=password, OAuth=text)
- `DELETE /auth/me` — 본인확인(비번 or '탈퇴' 입력) → 갤러리 보유 시 책임고지 `acknowledge` 필수 → 트랜잭션: ①소유 갤러리/공모/전시 `status='WITHDRAWN'`(공개 목록 APPROVED 필터에서 자동 제외) ②PII 익명화(name/email/phone/avatar/nickname/instagram/password/providerId) + `deletedAt`. ADMIN은 403
- 차단 지점: `authenticate`/`optionalAuth`(deletedAt), 카카오/로컬 로그인, 갤러리·공모·전시 상세(WITHDRAWN→404, ADMIN 제외), 공모 지원(status!=APPROVED→400)
- 프론트: MyPage 프로필 탭 하단 [회원 탈퇴] → `WithdrawModal`(영향 안내+동의+확인입력) → 성공 시 logout+/login

## 프론트엔드 라우트

| 경로 | 페이지 | 인증 |
|------|--------|------|
| / | HomePage | X |
| /galleries | GalleriesPage | X |
| /galleries/:id | GalleryDetailPage | X |
| /exhibitions | ExhibitionsPage | X |
| /exhibitions/:id | ExhibitionDetailPage | X |
| /shows | ShowsPage | X |
| /shows/:id | ShowDetailPage | X |
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
| ShowsPage | 전시 목록, 지역/상태 필터, 찜 (optimistic) | `pages/ShowsPage.tsx` |
| ShowDetailPage | 전시 상세, ImageLightbox, 소개수정(오너), 삭제, 찜, 작가→포트폴리오 | `pages/ShowDetailPage.tsx` |
| PortfolioPage | 공개 포트폴리오 (약력, 경력[아트페어/개인전/단체전], 포트폴리오파일, 작품 이미지 그리드) | `pages/PortfolioPage.tsx` |
| OperationPage | 공모 운영 페이지 (`/exhibitions/:id/operation`) — 공지/작가 전시정보 입력/갤러리·admin 열람 | `pages/OperationPage.tsx` |
| OperationPrintPage | 작가 제출문서 PDF 인쇄 (`/exhibitions/:id/operation/print/:userId/:doc`) | `pages/OperationPrintPage.tsx` |
| BenefitsPage | 혜택 목록 | `pages/BenefitsPage.tsx` |
| MyPage | 역할별 탭 (아래 상세) | `pages/MyPage.tsx` |

### MyPage 섹션별 가이드

| 섹션 | 역할 | 기능 |
|------|------|------|
| ProfileCard | 공통 | 아바타 업로드, 로그아웃 |
| PortfolioSection | Artist | 약력, 경력(아트페어/개인전/단체전 +/-), 포트폴리오파일(pdf/doc/hwp), 작품사진(최대10) |
| FavoritesSection | Artist | 갤러리/공모/전시 찜 목록 (탭 분리) |
| MyReviewsSection | Artist | 작성 리뷰 목록 |
| ApplicationsSection | Artist | 지원한 공고 목록 |
| MyGalleriesSection | Gallery | 갤러리 등록 요청, 상태 확인, Instagram 연동/토글 |
| MyExhibitionsSection | Gallery | 공모 등록 요청 (승인된 갤러리 선택), 공모 삭제 |
| MyShowsSection | Gallery | 전시 등록 (갤러리 선택, 작가 연동/검색, 다중 이미지), 목록/상태/삭제 |
| ApprovalsSection | Admin | 승인 큐 (갤러리/공모/전시 승인/거절+사유), 등록 관리 (삭제) |
| (등록 폼 WYSIWYG) | Gallery | 갤러리·공고·전시 등록 폼을 상세페이지 디자인 그대로 인라인 편집 (`components/shared/EditableField.tsx`: EditableText/HeroImageEdit). 제출 전 실제 노출 모습 확인 |
| HeroManageSection | Admin | Hero CRUD + 미리보기 |
| BenefitManageSection | Admin | 혜택 CRUD + 미리보기 |
| GotmManageSection | Admin | 이달의 갤러리 검색/선정/기한 |

## Instagram 피드 연동

### 연동 방식: Instagram OAuth (Instagram API with Instagram Login)
- **비즈니스/크리에이터 계정 전용** (개인 계정 불가 — Basic Display API는 2024-12 폐기)
- 필요한 권한(scope): `instagram_business_basic` 하나
- 환경변수: backend `INSTAGRAM_APP_ID`/`INSTAGRAM_APP_SECRET`(호출 시점 read), frontend `VITE_INSTAGRAM_APP_ID`

### OAuth 플로우
1. MyPage `[연동하기]` → `handleConnectInstagram` → `www.instagram.com/oauth/authorize` 리다이렉트 (`state`=nonce, `sessionStorage`에 nonce+galleryId 저장)
2. `/auth/instagram/callback` (`InstagramCallbackPage`) — state 검증 후 `POST /galleries/:id/instagram/connect` 호출
3. 백엔드: code → 단기토큰(`api.instagram.com/oauth/access_token`) → 장기토큰 60일(`graph.instagram.com/access_token`, `ig_exchange_token`) → `/me`로 username 조회 → 저장

### DB 필드 (Gallery 모델)
- `instagramAccessToken` — 장기 토큰 60일 (서버 전용, 응답에 미노출)
- `instagramTokenExpiresAt` — 장기 토큰 만료 시각 (만료 7일 이내면 피드 조회 시 자동 갱신)
- `instagramFeedVisible` — 피드 공개 여부 (기본 false)
- `instagramUrl` — @handle (연동 시 자동 설정, 프로필 링크 토글로 null 가능)

### API 엔드포인트
| 메서드 | 경로 | 인증 | 기능 |
|--------|------|------|------|
| PATCH | /api/galleries/:id/detail | 오너 | 한줄소개·상세소개 + **전화번호·주소 무승인 즉시 수정** (빈 값 400) |
| POST | /api/galleries/:id/instagram/connect | 오너 | OAuth code → 토큰 교환·저장 |
| PATCH | /api/galleries/:id/instagram-profile-visibility | 오너 | @handle 프로필 링크 표시 토글 |
| PATCH | /api/galleries/:id/instagram-visibility | 오너 | 피드 공개/비공개 토글 |
| GET | /api/galleries/:id/instagram-feed | 공개 | 최근 9개 게시물 조회 (best-effort, 만료 임박 시 토큰 갱신) |

### 토큰 보안
- `maskInstagram()` 헬퍼: 모든 갤러리 응답에서 `instagramAccessToken`을 제거하고 `instagramConnected: boolean`으로 변환
- 토큰은 서버 DB에만 저장, 클라이언트에 노출 안 됨

### 프론트엔드 컴포넌트
- `InstagramFeed.tsx` — 3x3 그리드 + 앱 내 ImageLightbox 확대 (외부 이탈 없음)
- `InstagramPrivateMessage.tsx` — 비공개 상태 안내 (오너에게 설정 링크)
- `InstagramCallbackPage.tsx` — OAuth 콜백 처리 (`/auth/instagram/callback`)
- GalleryDetailPage — Instagram 섹션 (연동 시만 표시)
- MyPage MyGalleriesSection — `[연동하기]`(OAuth 리다이렉트) + 프로필/피드 토글 스위치

### Meta App Review (승인)
- 개발 모드에선 앱에 등록된 **테스터(인스타 비즈니스 계정)**만 OAuth 통과 → 이 상태로 시연 영상 촬영
- 심사엔 실제 사용하는 권한(`instagram_business_basic`)만 제출 (미사용 권한 제출 시 거절 위험)

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

## 갤러리 상세 이미지 캐러셀 (GalleryImageCarousel)

- HeroSlider와 동일한 scroll-snap + IntersectionObserver 방식, 5초 자동 슬라이드(hover 시 정지)
- **휠 가로채기 방지**: scroll-snap 컨테이너에 비-passive `wheel` 리스너를 달아, 브라우저가 세로 휠을 가로 스크롤로 변환해 이미지가 움직이는 것을 막는다. 세로 휠은 `window.scrollBy`로 페이지 스크롤에 전달, 가로 휠(트랙패드)은 `preventDefault`로 무시
- **데스크톱 마우스 드래그 비활성화**: 마우스로 이미지를 끌어 옮기는 동작 제거. 이동은 좌우 화살표·하단 점·자동 슬라이드로만. 클릭 시 라이트박스 오픈
- **모바일 터치 스와이프**: `overflow-x-auto` 네이티브 스크롤로 동작(유지)
- 구현: `frontend/src/pages/GalleryDetailPage.tsx`

## 갤러리 대표 이미지(mainImage) 동기화 규칙

- `mainImage`는 `GalleryImage[]`의 **첫 이미지(order asc)를 비정규화한 대표 썸네일**. 목록(GalleriesPage)·이달의 갤러리·공모 카드·찜 목록 등 `images` 배열을 include 하지 않는 화면이 이 값을 사용
- 이미지 **추가/삭제 시 백엔드에서 항상 첫 이미지로 재동기화**(`POST/DELETE /galleries/:id/images`) → 사진 변경이 mainImage-only 화면에도 즉시 반영. 남은 이미지가 없으면 `null`
- 목록 카드(`GalleriesPage`)는 상세 페이지와 동일하게 `images[0]?.url || mainImage` 순으로 표시

## 모바일 반응형 규칙 (2026-07 전수 수리)

별도 모바일 UI 없이 기존 UI를 반응형으로 유지한다. 320~412px 실기기에서 확인된 깨짐 2건(운영 페이지 헤더 세로 깨짐, 지원자 행 액션 잘림)을 수리하면서 프론트 전체에 아래 규칙을 적용했다:

- **헤더/툴바**: 제목+버튼이 한 줄 flex일 때 `flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between`(제목 `shrink-0`, 버튼 그룹 `flex flex-wrap`) 또는 최소 `flex-wrap` 추가. 한글은 공백 없이도 글자 단위 줄바꿈되므로 제목 컬럼이 짜부라지면 세로로 깨진다 (OperationPage/OperationClassicPage `작가 제출 정보` 헤더, 목록 페이지 h1 헤더)
- **truncate + min-w-0**: flex 자식은 `min-width:auto`가 기본이라 `min-w-0` 없이는 truncate가 동작하지 않음. 이름/이메일/제목 등 긴 텍스트 flex 자식에 `min-w-0`(+필요 시 `break-all`) 필수 (ApplicantManager 행, GalleryDetailPage 연락처, 카드 h3)
- **모바일 2줄 접기**: 한 행에 많은 요소가 있으면 `flex-col gap-2 sm:flex-row`로 모바일에서 2줄 분리 (ApplicantManager 지원자 행: 1줄 체크박스+이름, 2줄 날짜+뱃지+액션 / 운영 페이지 작가 제출 행: 1줄 아바타+이름, 2줄 요약을 `pl-[38px]`로 이름 시작점에 들여쓰기)
- **목록 컬럼 정렬**: sm+에서 이름 등 가변 텍스트는 고정폭+truncate(`sm:w-44 truncate` + `title` 속성)로 뒤 컬럼 시작점을 정렬. 접힌 행에서 잘린 풀네임은 펼침 영역 상단에 다시 노출. 출품작 가격은 `formatArtworkPrice`(`lib/utils.ts`: 숫자만이면 콤마+원, 비매/협의는 원문)로 우측 정렬(`tabular-nums`)
- **터치 타겟 ≥44px**: 관례는 `min-h-[44px] min-w-[44px] (inline-)flex items-center justify-center` + 시각 크기 유지가 필요하면 네거티브 마진(`-m-2`~`-m-3`). 찜 하트, 삭제 휴지통, 모달 닫기 X, 네브바 아이콘, 다이얼로그 버튼 등에 적용
- **hover 전용 컨트롤 금지**: 터치 기기에는 hover가 없음. `opacity-0 group-hover:opacity-100`은 `opacity-100 md:opacity-0 md:group-hover:opacity-100`으로 — 모바일 항상 노출, md 이상만 hover 게이트 (ImageUpload 삭제 버튼, EditableField HeroImageEdit 변경/삭제 오버레이)
- **그리드 모바일 축소**: base가 4열 이상이면 `grid-cols-3 sm:grid-cols-4 md:grid-cols-5`식으로 (ApplicationContent 작품 썸네일)
- **Navbar 데스크톱 분기점은 lg(1024px)**: 링크 8개+우측 아이콘이 768px에서는 안 들어가 라벨이 2줄로 깨짐 → `hidden lg:flex`/`lg:hidden` (기존 md에서 상향)
- **검증**: dev 서버 + 디바이스 모드 320/375/768/1024에서 `document.body.scrollWidth > window.innerWidth`가 false여야 함

## 모바일 tel: 링크

- 갤러리 상세 페이지 전화번호: 모바일 터치 시 다이얼러 오픈, 데스크톱은 일반 텍스트
- Tailwind 반응형 분기: `md:hidden` (모바일 `<a>`) / `hidden md:flex` (데스크톱 `<p>`)
- 구현: `frontend/src/pages/GalleryDetailPage.tsx:288`

## PWA 자동 캐시 갱신 & HTTP 캐시 정책

- `vite.config.ts`: workbox `skipWaiting: true` + `clientsClaim: true`
- `main.tsx`: `controllerchange` → `window.location.reload()` 자동 새로고침
- 배포 후 수동 Clear site data 불필요

### 서비스워커 등록 — 버전 쿼리로 CDN 엣지 캐시 우회 (2026-07 사고 재발 방지)
- **등록은 `main.tsx`에서 직접**: `navigator.serviceWorker.register('/sw.js?v=' + __BUILD_ID__)` (PROD에서만).
  `__BUILD_ID__`는 `vite.config.ts`의 `define`으로 빌드 시 주입되는 타임스탬프.
- `vite.config.ts` VitePWA에 `injectRegister: null` — 자동 생성 `registerSW.js`를 만들지 않음.
- **배경(2026-07 실사고)**: Cloudflare 엣지가 고정 URL `/sw.js`·`/registerSW.js`를 옛 헤더(1년 immutable) 시절에
  캐시해버려, 오리진(Render)에 신버전이 배포돼도 전 사용자에게 7/8자 워커가 계속 서빙됨.
  쿼리스트링은 CF 캐시 키에 포함되므로 빌드마다 URL이 바뀌어 **반드시 오리진에서 새로 받는다**.
  (같은 스코프에 다른 URL을 등록하면 브라우저가 기존 등록을 새 워커로 교체)

### 커스텀 서비스워커 — 네비게이션 네트워크 우선, precache 소실 내성 (Safari/삼성인터넷)
- `frontend/src/sw.js` (vite-plugin-pwa `strategies: 'injectManifest'`, srcDir `src`, 출력 `dist/sw.js`):
  페이지 이동(navigation)을 **NetworkOnly(5초 타임아웃)**로 처리 — 온라인이면 항상 최신 index.html.
  실패(오프라인/타임아웃) 시에만 precache된 '현재 배포' 셸로 폴백(`createHandlerBoundToURL`, 키 없으면 가드).
  skipWaiting/clientsClaim/cleanupOutdatedCaches/precache는 기존 generateSW와 동등. `/api`·`/uploads`는 denylist.
- **배경**: 기존 방식(precache된 index.html에 네비게이션 바인딩, 캐시 우선)은 Safari(ITP 7일 제한)·삼성인터넷이
  CacheStorage를 임의로 비우면(워커 등록은 살아있음) 서빙할 것이 없어 **"화면을 불러오지 못했어요"** 에러로 죽고,
  precache가 낡으면 죽은 청크를 가리키는 옛 셸에 갇혔음. 네트워크 우선이라 캐시 소실/노후 모두 내성.

### 캐시 무효화 (파일명 버전)
- `vite.config.ts` `build.rollupOptions.output`에서 `entry/chunk/assetFileNames`를 `[name]-[hash]`로 **명시 고정**.
  내용이 바뀌면 파일명(=버전)이 바뀌어 브라우저·CDN이 무조건 새 파일을 받는다. (Vite 기본값이지만 해싱이 꺼지는 사고 방지용으로 명시)

### HTTP 캐시 만료 정책 (`backend/src/index.ts`)
- **해시 번들** (`assets/*-[hash].js/css`, `workbox-*.js`): `Cache-Control: public, max-age=31536000, immutable` (1년 장기 캐시)
- **고정 파일명** (`index.html`, `sw.js`, `registerSW.js`, `manifest.webmanifest`): `Cache-Control: no-store`
  → CDN 엣지·브라우저가 아예 저장하지 못하게 함. `no-cache`는 CDN 설정(Browser Cache TTL 등)에 덮어써질 수 있어
  실제로 `sw.js`가 엣지에 1년 immutable로 굳는 사고 발생(2026-07). `NO_CACHE_FILES` Set으로 관리.
- **SPA fallback** (`/{*path}` → index.html): `no-store`
- **API 응답** (`/api/*`): `Cache-Control: no-store` (Safari ETag 휴리스틱 캐싱으로 인한 stale 목록 방지)
- **Cloudflare 대시보드 권장 설정**: ① Browser Cache TTL = "Respect Existing Headers", ② `/sw.js*`·`/workbox-*.js` Cache Rule = Bypass.
  (코드만으로도 버전 쿼리 덕에 안전하지만, 이중 방어)

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

- 161 tests: Backend 128 (20 files), Frontend 33 (4 files)
- Test DB: `artlink_test`, Backend: supertest, Frontend: jsdom
- Show 테스트: show.test.ts(17), show-extended.test.ts(10), favorite-show.test.ts(4), approval-show.test.ts(4), frontend show.test.ts(11)
- Run: `cd backend && npm test` + `cd frontend && npm test`

## Show(전시) 기능 (2026-03-14)

갤러리의 실제 전시/행사를 소개하는 기능. 기존 "모집공고"(Exhibition)와는 별개.

### 데이터 모델
- **Show** — title, description, startDate/endDate, openingHours, admissionFee, location, region, artists(JSON string), posterImage, status(PENDING/APPROVED/REJECTED), galleryId
- **ShowImage** — url, order, showId (cascade delete)
- **Favorite** — showId 추가 (@@unique([userId, showId]))

### API (`backend/src/routes/show.ts`)
| Method | Path | Auth | 설명 |
|--------|------|------|------|
| GET | /shows | optionalAuth | APPROVED 목록, region/showStatus 필터, isFavorited |
| GET | /shows/my-shows | GALLERY | 내 전시 (전 상태) |
| GET | /shows/:id | optionalAuth | 상세 (gallery, images, artists JSON parse) |
| POST | /shows | GALLERY | 등록 → PENDING (소유권 확인) |
| PATCH | /shows/:id | owner | description/artists 수정 |
| DELETE | /shows/:id | owner/ADMIN | 삭제 |
| POST | /shows/:id/images | owner | 추가 이미지 등록 |
| DELETE | /shows/:id/images/:imageId | owner | 이미지 삭제 |

### 승인 (`backend/src/routes/approval.ts`)
- GET /approvals → `pendingShows` 추가 반환
- PATCH /approvals/show/:id → 승인/거절 (거절 시 사유 필수)

### 프론트엔드
- `ShowsPage.tsx` — 목록, 지역/상태 필터, optimistic 찜 토글
- `ShowDetailPage.tsx` — 포스터+추가이미지 캐러셀(ImageLightbox), 정보 그리드, 소개수정(오너), 삭제, 찜
- `MyPage.tsx` — Gallery: MyShowsSection(등록폼+목록), Admin: pendingShows 승인, Artist: 찜에 전시 표시
- Navbar: '전시' 탭 (갤러리와 모집공고 사이)
- Utils: `getShowStatus(startDate, endDate)` → 'upcoming' | 'ongoing' | 'ended'

### showStatus 필터 로직 (서버)
- ongoing: `startDate <= now AND endDate >= now`
- upcoming: `startDate > now`
- ended: `endDate < now`

## Admin 찜하기

- Admin 계정은 갤러리/공모 찜하기 버튼이 표시되지 않음
- GalleriesPage, GalleryDetailPage, ExhibitionsPage에서 처리

## UI/UX 개선 (2026-07-19 전수 점검 반영)

PC/모바일 × 4계정 Playwright 전수 점검에서 나온 항목 일괄 반영:

- **쪽지 접근 제어**: `/messages` 라우트에 `roles={['ARTIST','GALLERY']}` (백엔드 authorize와 동일). Admin은 홈으로 리다이렉트 — 이전엔 403 무한 "불러오는 중". 대화목록 쿼리에 에러 상태 UI("다시 시도") + 403은 retry 안 함 (`MessagesPage.tsx`)
- **이미지 404 폴백**: `SkeletonImage`가 onError 시 '이미지 없음' 플레이스홀더로 폴백 (`errored` 상태, src 교체 시 렌더 중 상태 조정 패턴으로 리셋 — effect 내 setState 금지). ExhibitionDetail `PosterImage`·ShowDetail 포스터도 동일
- **목록 카드 = 실제 링크**: Galleries(GlowCard `to` prop)/Exhibitions/Shows 목록 카드를 div onClick → `<Link>`. 새 탭·주소 복사·키보드 접근 가능. **내부 버튼(찜·갤러리명 등)은 `e.preventDefault()+stopPropagation()` 필수** (앵커 기본 이동 차단)
- **리뷰 0건 표시**: `reviewCount === 0`이면 ★0.0 대신 "아직 리뷰 없음" — GalleriesPage, GalleryDetailPage, ExhibitionDetailPage, GotM, MyPage 찜 목록. favorites API의 gallery select에 `reviewCount` 추가
- **갤러리 등록 검증**: 공모 폼과 동일하게 누락 항목 나열 toast + `EditableText error` 빨간 테두리 + 입력 시 즉시 해제 (`galleryFormErrors` Set)
- **FAQ 번호**: 내부 정렬값(`faq.order`) 노출 중단 → 화면엔 1부터 순번 (`SupportPage`)
- **마이페이지 탭바**: 가로 오버플로 시 우측 페이드 그라데이션(`pointer-events-none`)으로 스크롤 힌트 — Admin 8탭 모바일 대응. 훅은 early return(`if (!user)`)보다 위에 선언
- **히어로 조작부**: 화살표/인디케이터에 aria-label, 인디케이터는 시각 2px 라인 유지 + 버튼 패딩으로 히트영역 확대(22px+). '자세히 보기'는 `p-3 -m-3`
- **터치 타겟**: 별점순/리뷰순·푸터 링크·공모상세 갤러리명 버튼 — 패딩+네거티브 마진으로 시각 유지하며 히트영역만 확대
- **상태 뱃지**: `whitespace-nowrap` ("승인 대/기" 줄바꿈 방지)
- **목록 이미지 lazy**: Galleries/Exhibitions/Shows/GotM/찜 목록 `loading="lazy"` (히어로 첫 장은 eager 유지)
- **OG 태그**: `og:url`=artlink.cc, `og:image`=`/og-image.png`(1200×630, `frontend/public/`), `twitter:card` 추가. og-image 재생성은 `e2e/og-image-gen.mjs` 참조. ⚠️ og-image.png는 고정 파일명이라 1y immutable로 캐시됨 — **내용을 바꾸면 파일명도 바꿔야** CDN/브라우저에 반영됨

## Admin 개발자 도구 + 운영페이지 개선 (2026-07-20)

### 개발자 도구 탭 (수락 되돌리기 토글)
- **AppSetting 모델** (key-value, 마이그레이션 `add_app_setting`): 런타임 전역 플래그 영속화. 헬퍼 `backend/src/lib/appSettings.ts` (`getSettingBool`/`setSettingBool`, 키 `allowAcceptedRevert`)
- **API**: `GET/PUT /api/admin/dev-settings` (ADMIN 전용 토글, `admin.ts`) · `GET /api/settings/flags` (로그인 유저 누구나 — 갤러리 UI가 토글 상태 확인, `routes/settings.ts`)
- **UI**: Admin 마이페이지 '운영 조회' 오른쪽 `개발자 도구` 탭 (`DevToolsSection`, MyPage.tsx). 스위치 토글 + 경고 배너. 쿼리키 `['dev-settings']`, 변경 시 `['feature-flags']` invalidate
- **전이 규칙 변경** (`exhibition.ts` PATCH `/:id/applications/:appId`): 토글 ON이면 **전체 갤러리**가 수락→거절 가능. 수락→접수는 여전히 차단, **정산 완료(`settledAt`) 공모는 차단**
- **되돌리기 정리 트랜잭션**: 해당 작가의 `ExhibitionSubmission`(제출물) + `ArtworkSale`(판매) + `ArtistSettlement`(정산비율) + `SettlementApproval`(정산승인) 삭제 + 제출 작품 이미지 파일 best-effort 삭제. 정원 슬롯·지원횟수는 동적 계산이라 자동 정상화 (지원 이력은 거절 상태로 유지)
- **갤러리 UI** (`ApplicantManager.tsx`): `['feature-flags']` 조회 → 토글 ON이면 "수락 (확정)" 배지 대신 셀렉트(수락/거절) 노출, 거절 선택 시 삭제 경고 ConfirmDialog(variant danger). 되돌리기 후 `['operation-submissions']`까지 invalidate
- **테스트**: `dev-settings-revert.test.ts` (14개 — 토글 API 권한/기본값, OFF 시 차단 유지, ON 시 되돌리기+타 작가 데이터 보존+정원 복구+알림). `helpers.ts cleanDb`에 `appSetting.deleteMany` 추가 (FK 없어 cascade 안 됨 — 테스트 간 토글 누수 방지)

### 작가별 작품 원본(ZIP) 다운로드
- `downloadAllArtworkImagesZip(exTitle, rows, zipName?)` — zipName 파라미터 추가 (`operationPdf.ts`). rows에 1명만 넘기면 개별 작가용
- OperationPage/OperationClassicPage 작가 펼침 패널에 `작품 원본(ZIP)` 버튼 (PDF 3종 옆). 파일명 `{공모명}_{작가명}_작품원본.zip`

### 이름/닉네임 병기
- `nameWithNickname(user)` 헬퍼 (`lib/utils.ts`): `"이름 (닉네임)"`, 닉네임 없거나 이름과 같으면 이름만. **공개 화면은 기존 `displayName`(닉네임 우선) 유지** — 병기는 갤러리/Admin 내부 화면 전용
- 적용: ApplicantManager(목록+연락처), OperationPage/Classic 작가 제출 정보, Admin 운영 조회(공모 지원현황·작가 지원이력)

## 캡션 HWP 적응형 페이지 (2026-07-30)

`GET /api/operations/:id/caption.hwp` — 출품작 수에 맞춰 페이지 수가 자동으로 늘어난다.

- **이전 문제**: 템플릿이 4페이지=96칸 고정이라 96점 초과분을 `slice`로 **조용히 버렸다**(서버 로그 경고만). 실측 재현 = 100점 요청 시 97~100번 누락.
- **해결** (`lib/captionHwp.ts`): 템플릿의 "표 1개 = 1페이지" 레코드 묶음을 복제/삭제해 `pageCount = ceil(작품수 / 24)`로 재구성. 1페이지(구역 정의 보유)는 항상 유지하고 2페이지부터 복제한다.
- **복제 시 반드시 조정하는 필드** (템플릿 4페이지 바이트 비교로 특정):
  1. 표 CTRL_HEADER `offset 24` = 개체 서수(0,1,2…)
  2. 표 CTRL_HEADER `offset 36` = instance id — **페이지마다 유일**해야 함
  3. 최상위(level 0) PARA_HEADER 글자수 MSB(0x80000000) = "마지막 문단" → 문서 전체에서 **마지막 1개만** 설정
  (TABLE 38B·CTRL_DATA 120B·셀 LIST_HEADER는 페이지 간 동일 → 그대로 복제)
- **복제 원본 선택 주의**: 템플릿 3페이지의 18번 칸은 제목 앞에 여분 글자가 있어 **CHAR_SHAPE 런 경계 ≠ 앞쪽 공백 수** → 그 페이지를 복제하면 제목 앞 4글자가 다른 서체로 쪼개진다. `pageCellsAligned()`로 정렬된 페이지만 복제 원본으로 고른다. (기존 4페이지 출력의 67번째 캡션에 있던 결함도 이로써 해소)
- **스트림 확장**: 압축 결과가 Section0 체인 용량(11섹터=5632B)을 넘으면 파일 끝에 섹터를 붙이고 FAT 체인을 연장한다(FAT 여유 엔트리 범위 내). 미니스트림 경계(4096B) 위 유지 + 정확한 선언 크기는 그대로.
- **상한**: `CAPTION_MAX_WORKS = 1200`. 초과 시 400으로 명확히 안내(잘림 없음).
- **검증**: `caption-hwp.test.ts` 19개 (페이지 수 적응·전 작품 포함·구조 불변식·섹터 확장·상한). 추가로 독립 파서(pyhwp)로 20/30/100/200작품 전 제목 존재 + ODT→PDF 렌더 페이지 수(2·5) 확인. ⚠️ 리눅스에는 한글이 없고 LibreOffice HWP 필터는 v3 전용이라(원본 템플릿도 못 엶) **한글 열림 최종 확인은 수동**이다.

## 둘러보기 참여 설계 — 홈 하이라이트 · 좋아요 보드 · 스크랩/초대 (2026-08-01)

실측 진단에서 출발했다: 공개 작품 157점에 **좋아요 총합 18개**(95%가 0개). 작품 공급이 아니라
**참여 루프가 닫혀 있지 않은 것**이 원인이었다. 좋아요를 눌러도 ① 누른 사람에게 아무것도 남지 않고
② 받은 작가는 알 방법이 없고 ③ 눌러봐야 아무것도 결정되지 않았다. 이 셋을 각각 메운다.

### ① 눌러도 남지 않던 문제 → 좋아요 보드
- `GET /api/explore/my-likes` (로그인) — 내가 좋아요한 작품 최신순. 마이페이지 ARTIST **"좋아요한 작품"** 탭.
- 작가가 `showInExplore`를 내렸거나 탈퇴하면 보드에서도 빠진다(작가 선택 존중).

### ② 받아도 모르던 문제 → ARTWORK_LIKE 알림 (작가↔작가 상호성)
- `POST /api/explore/:imageId/like`가 좋아요를 **켤 때만** 작가에게 알린다(취소는 알리지 않음).
- **linkUrl은 누른 사람 프로필(`/portfolio/{likerId}`)** — 맞방문을 유도하는 게 목적이다.
- **24시간 집계**: `Notification.refKey = "artwork-like:{imageId}"`로 미읽음 알림을 찾아 있으면
  새로 쌓지 않고 문구·링크·`createdAt`만 갱신("A님 외 3명이…") → 목록 최상단으로 올라온다.
- 자기 작품 자기 좋아요는 알리지 않는다. 알림 실패해도 좋아요는 성공(best-effort).

### ③ 눌러도 아무것도 안 정해지던 문제 → 홈 하이라이트 (D)
- `GET /api/explore/highlight?limit=8` (인증 불필요) → `{ images, basis }`
  - **정렬 = 전체 좋아요 수 내림차순**. 동점이면 최근 7일 좋아요 많은 순(신선도) → 최신 순.
  - `all`(좋아요 하나라도 있음) → "가장 많이 사랑받은 작품들" / `random`(좋아요 전무, **날짜 시드**로 하루 고정) → "작가들의 작품"
  - ⚠️ **정렬 기준은 카드에 찍히는 배지(전체 좋아요 수)와 반드시 같아야 한다.** 처음엔 '최근 7일' 기준으로 정렬하면서 배지는 전체 수를 보여줘 실서비스에서 하트가 `1,1,1,…,3` 순으로 보이는(=하트순이 아닌 것처럼 보이는) 신고가 있었다 — 전체 3개지만 이번 주엔 0개인 작품이 주간 정렬에서 꼴찌로 밀린 것. 부제에도 '이번 주'를 쓰지 않는다. 회귀 방지 테스트: "화면에 찍히는 하트 수 기준으로 항상 내림차순".
- `components/home/ExploreHighlight.tsx` — HomePage의 GalleryOfMonth 아래. 부제 **"가장 많이 사랑받은 작품들"** 로 근거를 노출해 좋아요를 큐레이션 참여로 만든다.

### 갤러리 스크랩 + 공모 초대 (E)
갤러리는 동기가 다르다 — "관심 있다는 티를 아직 내고 싶지 않다". 그래서 하트와 분리한다.

| | 공개 | 작가 알림 | 용도 |
|---|---|---|---|
| 하트(좋아요) | 공개 | O | 응원 |
| 🔖 스크랩 | **비공개** | X | 스카우팅 메모 |

- **모델 2개(순수 추가)**: `ArtworkScrap`(userId+imageId unique, memo), `ExhibitionInvite`(exhibitionId+artistId unique, status SENT/APPLIED/DECLINED)
- **API**: `POST /explore/:imageId/scrap`(토글) · `GET /explore/scraps` · `PATCH /explore/scraps/:id`(메모) · `POST /exhibitions/:id/invite` · `GET /exhibitions/:id/invites` · `GET /exhibitions/invites/received` · `PATCH /exhibitions/invites/:id`(숨김)
- ⚠️ **스크랩은 작가에게 절대 노출하지 않는다.** 피드 응답의 `isScrapped`는 **GALLERY 계정 + 본인 것만** 포함되고, 작가 응답에는 필드 자체가 없다(테스트로 고정).
- **초대는 알림일 뿐 자동 지원이 아니다** — 공모마다 커스텀 질문이 다르므로 작가가 직접 지원해야 한다. 지원하면 초대가 `APPLIED`로 전환된다.
- **초대 방어**: 소유 갤러리만 / `APPROVED` + 모집중(`recruitmentClosed·confirmed·ended` 아님) + 마감 전(KST) / 이미 지원한 작가 400 / 중복 초대 409 / 탈퇴·비ARTIST 404 / **공모당 100명·계정당 하루 50명 상한**
- UI: ExplorePage 모달(갤러리 액션 + 초대 모달), MyPage GALLERY **"관심 작품"**, MyPage ARTIST **"받은 초대"**

### 초대 간편 지원 (자동 수락 아님)
갤러리가 작품을 보고 직접 부른 것이므로 지원서를 다시 쓰게 하지 않는다.

- `POST /exhibitions/:id/apply` 에 `viaInvite: true` → **작가 포트폴리오의 약력·경력·작품사진(최대 10장)·포트폴리오 파일을 서버가 복사해 첨부**한다(스냅샷이며 이후 포트폴리오 수정과 무관). 약력이 비면 `(초대 지원 — 작가 포트폴리오 참조)` 폴백.
- **약관 동의와 필수 추가질문은 그대로 받는다** — 법적 요건이고, 갤러리가 직접 물은 항목이기 때문. 추가질문이 없으면 약관 체크 한 번으로 끝.
- 포트폴리오에 작품이 0장이면 400(빈 지원서가 갤러리에 가는 것 방지).
- **자동 수락하지 않는다** — 상태는 평소와 같은 `SUBMITTED`, 수락/거절은 갤러리가 결정. 갤러리 알림: *"초대한 작가(X)가 지원했습니다. 수락 여부를 결정해주세요."*
- 진입점 2곳: 마이페이지 **"받은 초대"**, 공모 상세(초대받은 작가만 버튼이 **간편 지원**으로 바뀜 — `GET /exhibitions/:id` 응답의 `invited`). 초대받은 작가도 "지원서를 직접 작성해서 지원하기" 링크로 기존 폼 사용 가능.
- 지원자 목록(`GET /:id/applications`)에 `invited` 플래그 → **"초대한 작가"** 배지.

### 초대 남용 방지 / 정원 연동
- **하루 10명 상한**(갤러리 계정 기준 24시간 롤링, 공모를 나눠 보내도 합산).
- **정원이 찬 공모**는 ① 초대 자체가 400 ② 받은 초대 목록에서 자동 제외 ③ 상세 `invited=false`.
  ⚠️ **DB에서 지우지 않고 조회 시점 계산으로 감춘다** — 거절이 나오면 슬롯이 복구되므로(거절은 정원에서 제외) 그때 다시 유효해져야 한다. 이미 지원한 건은 상태 확인이 필요하므로 정원과 무관하게 남긴다. 세 지점 모두 지원 API와 **동일한 계산식**(`status != 'REJECTED'`, 공용 헬퍼 `activeApplicationCounts`)을 쓴다.
- 작가의 초대 **삭제**(`PATCH /invites/:id`)는 행을 지우지 않고 `status='DECLINED'` — 유니크 제약(exhibitionId+artistId)이 살아 있어야 **재초대 스팸**이 막힌다. 작가 목록에서는 완전히 사라진다.

### 검증
- `explore-engagement.test.ts` **53개** — 하이라이트 폴백 3분기·`isLiked` 반영·비공개/탈퇴 제외, 좋아요 보드, 알림 집계(5명 "외 4명"·읽은 알림 분리·24시간 창)·자기좋아요 제외, 스크랩 권한/토글/메모/**작가 미노출**, 간편 지원(포트폴리오 첨부·약관 필수·작품 0장 차단·우회 시도), 초대 방어(중복·마감·정원·상한 10명·재초대 차단)·정원 복구 시 재노출.
- E2E `e2e/tests/26-invite-engagement.spec.ts` **9개** — 홈 확대·좋아요 지속, 좋아요 명단, 보드, 스크랩 프라이버시, **복합 시나리오(발견→스크랩→초대→알림→간편지원→수락→운영페이지)**, 상세 버튼 분기, 삭제 다이얼로그, 정원 마감, 하루 상한.
- ⚠️ **확대 모달 이미지에 `min-h-[200px]` 필수** — 이미지 로드가 실패하면 높이가 0이 되어 정보줄이 위로 올라오고 우상단 닫기 버튼이 좋아요 버튼을 덮어 클릭이 막힌다(E2E에서 실제 재현).

## 운영페이지 일괄 다운로드 성능 (2026-08-03)

**신고**: 실서비스 운영페이지에서 "전체 작품원본(ZIP)"·"전체 PDF(ZIP)"가 끝나지 않음.

### 원인 (운영 로그 + 실측으로 확정)
1. **모든 이미지가 백엔드 `image-proxy` 경유** — R2 버킷에 CORS가 없어 브라우저가 직접 읽지 못했고(캔버스 taint), 어쩔 수 없이 Render 인스턴스가 전 이미지를 중계했다. 로그에 `AbortSignal.timeout(10000)` 초과 **500이 다수**(`10003.984 ms`).
2. **완전 순차** — `for` 루프에서 한 장씩 `await`.
3. **PDF가 같은 이미지를 다시 받음** — ZIP과 캐시를 공유하지 않아 작가마다 재요청, `waitImages`가 최대 8초씩 대기.
4. **캔버스 재인코딩** — "원본"이라면서 JPEG 0.95로 재압축(화질 손실·EXIF 소실)하고 디코딩/인코딩 비용까지 냈다.
5. 재시도·진행률 없음 → 멈춘 것처럼 보임.

> R2 자체는 정상이었다(직접 20회 연속 0.3초, 열화 없음). 병목은 **중계 구간**.

### 해결
- **R2 버킷 CORS 개방**(대시보드 작업, `artlink.cc`/`onrender.com`/`localhost:5173`만 `GET,HEAD`) → 브라우저가 **R2에서 직접** 수신.
- **`lib/imageFetch.ts` 신설** — 이미지 획득을 한 곳으로 모음
  - 경로: **R2 직접 → 동일출처 프록시 폴백 → 1회 재시도**, 각 25초 상한(무한 대기 불가)
  - **URL 캐시**를 ZIP/PDF가 공유 → 같은 이미지를 두 번 받지 않음
  - `mapLimit(items, 5, fn, onProgress)` — 동시 5개(브라우저 호스트당 연결 한계 고려), 결과는 입력 순서 유지
- **ZIP은 원본 바이트 그대로 저장** — 캔버스 재인코딩 제거. 확장자는 실제 MIME 기준(jpg/png/webp)
- **PDF는 이미지 선수집 후 `blob:` URL 주입** — 동일출처라 taint 없음, 렌더 중 네트워크 0
- **진행률 실시간 표시**("작품 원본 12/60장 모으는 중") + **실패 목록 명시**
- **프록시 스트리밍 전환** — `arrayBuffer()` 버퍼링 → `Readable.fromWeb().pipe(res)`, 클라이언트 중단 시 업스트림도 중단. 타임아웃 10초 → **20초**

### 실측 (실제 R2 원본 24장, 프로덕션 브라우저)
| | 소요 | 장당 | 실패 |
|---|---|---|---|
| 전 | 95.7초 | 3988ms | 1장 |
| 후 | 1.0초 | 41ms | 0장 |

→ **97배**. 작품 100점 환산 시 약 400초 → 4초.

### 검증
- `frontend/src/__tests__/imageFetch.test.ts` 14개 — 동시성 상한·순서 보존·진행률, 직접→폴백→재시도, **캐시 공유(같은 URL 네트워크 1회)**, 확장자 판정, 비이미지 거부
- `backend/src/__tests__/upload-proxy-stream.test.ts` 5개 — 스트리밍 후에도 바이트 무손실·보안 헤더·SSRF/리다이렉트/MIME 차단 유지
- E2E `e2e/tests/27-operation-zip.spec.ts` 3개 — 실제 R2 이미지로 ZIP·PDF 다운로드 발생, 진행률 문구, **실패 시 작품명 안내**
- ⚠️ E2E에서 갤러리 소유 갤러리는 `ownedGalleryId()`로 찾을 것. 목록에서 아무 승인 갤러리나 집으면 **다른 갤러리 계정 소유**라 403이 난다(스펙 26 F4가 별도 갤러리 계정을 만든다).

## 프로그래매틱 SEO — robots/sitemap + 페이지별 meta 주입 (2026-08-01)

SPA라 서버가 내려주는 HTML이 모든 URL에서 동일했다. 그 결과 ① 검색엔진에 공모/갤러리 수백 개가 중복 페이지로 보이고 ② **JS를 실행하지 않는 카톡/페북 공유봇**에는 어떤 링크를 공유해도 같은 미리보기가 떴다. SSR 도입 없이 `<head>`의 meta 블록만 서버에서 갈아끼워 해결한다.

### (a) 색인 진입로 — `routes/seo.ts`
- `GET /robots.txt` (text/plain), `GET /sitemap.xml` (application/xml). 이전엔 SPA 와일드카드에 걸려 **index.html이 200으로** 나갔다(sitemap 제출 시 파싱 에러).
- `NODE_ENV` 조건 **밖**에 등록 — dist가 필요 없어 기존 supertest 스위트로 그대로 검증된다.
- sitemap 대상: 정적 공개 페이지 8개 + `status:'APPROVED'` 갤러리/공모/전시 + `user.deletedAt:null`이고 이미지 1장 이상인 포트폴리오. TTL 10분 캐시, 상한 5,000 URL. DB 실패 시 **정적 URL만 담은 유효한 sitemap**을 반환(503로 죽이지 않음).

### (b) 상세 페이지 meta 주입 — `lib/seoMeta.ts`
- 대상 4종: `/exhibitions/:id`, `/galleries/:id`, `/shows/:id`, `/portfolio/:id`
- **기존 SPA 와일드카드(`index.ts`의 `/{*path}`)는 수정하지 않는다.** 명시 라우트 4개를 그 앞에 추가하고, 조건 미달이면 `next()`로 흘려보내 와일드카드가 원본을 내려준다 → 최악의 경우가 "현재 동작".
- `frontend/index.html`의 `<!--SEO_META_START-->` ~ `<!--SEO_META_END-->` 사이를 통째로 교체(og 태그 중복 없음). 마커가 없으면 주입하지 않으며, **프론트 테스트 `seoMarkers.test.ts`가 마커 존재를 감시**한다. `facebook-domain-verification`은 마커 밖.

**방어 4종 (설계 근거)**
1. **인젝션**: 값이 HTML이 되는 지점은 `buildMetaTags()` 하나뿐이고 전부 `escapeAttr()`(`& < > " '` + 제어문자 제거)를 통과. 문맥이 `content="..."` 속성값 하나로 고정돼 이 치환이면 완전하다. 호출부에서 문자열을 이어붙일 수 없는 구조 → 이스케이프 누락 불가. og:image는 `https://` 또는 `/uploads/` **화이트리스트**만 통과.
2. **DB 장애**: 경로 allowlist(정수 id `^\d{1,9}$`만) + 1.5초 타임아웃 + `try/catch` → 실패 시 `next()`. 템플릿은 기동 후 1회만 읽어 메모리 보관(읽기 실패 시 주입만 비활성).
3. **비공개 노출**: 쿼리에 `status:'APPROVED'`(공모/전시는 소속 갤러리도) / `deletedAt:null`을 못 박음. 노출 필드 화이트리스트 = 제목·지역·기간·한줄소개·대표이미지 (연락처/주소상세/이메일 제외). 작가는 닉네임 우선.
4. **부하**: TTL 60초 인메모리 캐시(상한 500, **없는 id도 캐시**해 열거 공격 흡수) + `/api`와 별개의 rate limit **10분 800회**. ⚠️ 초과해도 **429를 던지지 않고** `SEO_RATE_LIMITED` 표시만 남겨 주입만 생략한다(공유 링크로 트래픽이 몰려도 페이지는 정상).

### 킬스위치 / 환경변수
- `SEO_META=off` → 주입만 비활성(robots/sitemap은 유지). Render 대시보드에서 즉시 되돌릴 수 있는 1차 롤백 수단.
- `PUBLIC_BASE_URL` (기본 `https://artlink.cc`) → sitemap·og:url·이미지 절대경로 기준값.

### 검증
- `backend/src/__tests__/seo.test.ts` 27개 + `frontend/src/__tests__/seoMarkers.test.ts` 4개.
- 로컬 프로덕션 모드 실기동 확인: 공모/갤러리별 meta 주입, PENDING·탈퇴·비정수 id·없는 id 전부 원본 폴백, 킬스위치 동작, 805회 연속 요청 시 **429 없이 전부 200**(한도 초과분은 기본 meta).
- XSS 실물 검증: 제목 `"><script>...`, 소개 `<img src=x onerror=...>`인 공모를 실제로 만들어 응답을 **jsdom으로 파싱** → script 태그는 앱 번들 1개뿐, img 0개, `on*` 이벤트 핸들러 0개, 페이로드는 전부 텍스트로 파싱됨.

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
