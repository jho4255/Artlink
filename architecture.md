# ArtLink 아키텍처 문서

> 최종 업데이트: 2026-03-14 (Phase 1-10 + 버그 수정 + Render.com 배포 + UX/버그 4건 + Vitest + tel링크 + PWA캐시갱신 + Instagram 피드 연동 + Show(전시) 기능)

## 시스템 구조

```
ArtLink/
├── frontend/              # React 클라이언트 (Vite + TypeScript)
│   ├── src/
│   │   ├── components/    # UI 컴포넌트
│   │   │   ├── layout/    # Navbar, Layout (공통 레이아웃)
│   │   │   ├── home/      # SplashScreen, ArtWorks, HeroSlider, GalleryOfMonth
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
- **SettlementApproval.snapshot** — 작가가 **응답할 때 본 금액**의 지문. 갤러리가 그 작가 금액을 고치면 어긋나 자동으로 재확인 대상이 된다(`lib/settlementFingerprint.ts`). null=옛 데이터/미응답
- **Exhibition** 상태필드: recruitmentClosed(모집마감), confirmed(확정·작가수정잠금/전시시작일경과시자동), ended(전시종료)
  - **라이프사이클 순서 강제** (오너 한정, Admin은 우회): 모집마감 → 확정 → 전시종료. 확정은 모집마감 후, 전시종료는 확정 후에만 가능. 역순 해제는 뒷 단계부터.
- **ExhibitionImage** — 공모 다중 사진 (url, order, exhibitionId Cascade). 첫 사진(order 최소)이 대표 `imageUrl`과 동기화. 기존 `imageUrl`만 있던 공모는 상세 GET 시 lazy 백필. 상세 페이지 인라인 관리(추가/삭제(최소1장)/드래그 순서변경, 최대 20장)
  - API: `POST /api/exhibitions/:id/images`, `DELETE /api/exhibitions/:id/images/:imageId`(최소1장 400), `PATCH /api/exhibitions/:id/images/reorder`{orderedIds}
- **지원자 관리**: 공모 상세에서 분리된 별도 페이지 `/exhibitions/:id/applicants` (ApplicantsPage). 연락처(닉네임·전화·이메일)는 지원 시점부터 오너에게 노출(상태 무관). 지원서 PDF 다운로드(지원자별 `공모명_작가명_지원서.pdf` + 전체 ZIP `공모명_지원서.zip`). 기존 CSV 내보내기 제거. (`operationPdf.ts`: downloadApplicationPdf / downloadAllApplicationsZip)
- **찜(Favorite)**: ARTIST 전용 — 갤러리/공모/전시 목록·상세 모든 곳에서 GALLERY·ADMIN 유저는 하트 버튼 미표시
- **Notification** — 인앱 알림 (APPLICATION_STATUS, NEW_APPLICANT, APPROVAL_RESULT, INQUIRY_REPLY, NEIGHBOR_FOLLOW, GUESTBOOK_NEW, GUESTBOOK_REPLY 등)
- **Inquiry** — 1:1 문의 (subject, content, reply, status: OPEN/ANSWERED)
- **ApprovalRequest** — 수정 승인 요청
- **Post / PostComment / PostLike** — 커뮤니티(글로벌 게시판). 글마다 anonymous, images[], likeCount/commentCount/viewCount 비정규화
- **Follow** — 이웃(단방향 팔로우). `@@unique([followerId, followingId])`
- **Story / StoryLike / StoryComment** — 스토리(작업 사진+짧은 글). visibility PUBLIC|NEIGHBORS(글마다), likeCount/commentCount 비정규화. ArtStory([소식]) 피드의 출처
- **GuestbookEntry** — 방명록(작가 홈페이지). secret(비밀글), parentId(방 주인 답글, 1단계)
- **AdBanner** — 광고 배너(Admin 관리). imageUrl/title/linkUrl/active/position. 사이드바 하단 `AdSlot` 노출

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
| upload | /api/upload | 업로드 (Multer): `/image`(15MB)·`/video`(25MB, 대화 첨부용)·`/file`(20MB, PDF/DOC/HWP/ZIP) |
| notification | /api/notifications | 인앱 알림 (목록/읽음처리/전체읽음/미읽음카운트) |
| inquiry | /api/inquiries | 1:1 문의 (작성/목록/상세/Admin답변, 답변 시 알림 트리거) |
| admin | /api/admin | (ADMIN 전용) 사용자 검색·역할변경 + 운영 조회: 공모 지원현황/작가 지원이력/갤러리 게시물 |
| kanban | /api/kanban | (ADMIN 전용) 할 일 보드 — 회의 내용·할 일 정리. 보드/항목/댓글 CRUD, 순서 재배치 |
| chat | /api/chats | ArtTalk — 갠톡(1:1)/단톡(공모방). 방 참여 여부로만 권한 판정. 첨부(사진/영상/파일, 우리 저장소만) |
| community | /api/community | 커뮤니티 글로벌 게시판(블라인드식). 글마다 실명/익명, 좋아요·댓글·조회수. `/popular`=홈 인기글 |
| follow | /api/follow | 이웃(단방향 팔로우). 추가 시 상대에게 알림(멱등). 상태 `GET /:userId`(following/팔로워수) |
| stories | /api/stories | 스토리(ArtStory [소식]). `/feed`, `/user/:id`, 좋아요·댓글. 공개범위 글마다 |
| guestbook | /api/guestbook | 방명록(작가 홈페이지). 공개, 비밀글(본문만 가림), 답글은 방 주인만(1단계) |
| ad | /api/ads | 광고 배너. 공개 GET(활성만) / Admin CRUD. 사이드바 하단 슬롯 |

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
  - 작가 제출: 출품리스트(이미지/제목/크기/재료/년도/가격) · 작가약력(헤더+학력/개인전/단체전/아트페어·옥션/수상) · 작가노트(전체+작품별 상세설명 — 출품작 드롭다운 선택, 한 작품당 1개)
  - 열람 권한: 오너·Admin만 전 작가 열람, **작가 상호 비공개** (submissions는 오너/admin, submissions/:userId는 오너/admin/본인)
  - **임시저장(draft)**: 출품작에 `draft:true` — 필수값이 덜 채워져도 보관되지만 **갤러리·Admin에게 비공개**. 서버에서 일괄 필터(`publicSubmission`/`publishedArtworks`, operation.ts) — 목록·PDF·캡션·정산·독촉 대상 판단·대시보드 카운트(exhibition.ts) 모두 여기서 걸러지고, 대표작 인덱스는 걸러낸 배열 기준 재매핑, draft 작품의 노트 상세설명도 함께 감춤. 정식 [저장] 시 draft 해제(전체 검증+대표작 필수). 프론트 상태 4색(`lib/saveState.ts`): 회색(작성 전 빈 칸, 서버 미전송)/빨강(저장 안 됨)/노랑(임시저장)/초록(저장됨). **대표작 인덱스는 참조 비교 금지** — 전송 목록은 복제본이므로 `repOrdinal()`(빈 칸 제외 서수)로 변환. 저장 기준선은 서버 응답으로 갱신(요청 중 입력 유실 방지), 미저장 이탈 경고 `useUnsavedChanges`(닫기/뒤로가기/앱 내 링크)
  - **정산 입력은 전시 종료 후에만** (`PUT /settlement`에서 차단) — 종료 전엔 작가가 출품 목록을 고칠 수 있어 위치 기반 `artworkIndex`가 어긋난다. 작가 열람용 `/my-settlement`도 갤러리와 같은 draft 제외 목록으로 계산(프레임 일치)
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
    - `SettlementApproval{exhibitionId,artistUserId,status PENDING|APPROVED|ISSUE,comment,snapshot}` + `Exhibition.settlementRequestedAt`
    - 흐름: 갤러리 [정산 확인 요청]`POST .../settlement/request`(재확인 대상만 PENDING 생성+알림 SETTLEMENT_CONFIRM_REQUEST) → 작가 `POST .../settlement/respond`{approve|comment}(수락 APPROVED / 문제 ISSUE+코멘트→오너 알림 SETTLEMENT_ISSUE) → 전원 APPROVED여야 `POST .../settlement/complete`(settledAt) 가능
    - 요청 중에도 `PUT settlement` **수정 가능**(2026-08-17, 이전엔 403 잠금). [요청 취소]`.../settlement/request/cancel`는 정산을 작가들에게서 통째로 다시 감출 때만
    - `my-settlement`: **요청중 또는 완료 시** 작가에게 공개(+myApproval). `GET settlement`: artist별 approval + allApproved
    - 프론트: 갤러리 정산섹션 OPEN[정산저장|정산확인요청]/REQUESTED[요청취소|정산완료(전원수락시활성)]+작가별 수락/문제뱃지+코멘트, 작가 [수락]/[문제제기+코멘트]
  - **부분 재확인 — 금액이 바뀐 작가만 다시 묻는다** (2026-08-17, migration 20260817120000_add_settlement_approval_snapshot):
    - 왜: 예전엔 [요청 취소]가 `settlementApproval` 을 통째로 지워서, **한 명이 문제를 제기하면 전원이 다시 확인**해야 했다. 18명짜리 단체전(실데이터)에서 1명 때문에 17명을 다시 붙잡는 셈이라 실무에서 못 쓴다
    - 지문(`backend/src/lib/settlementFingerprint.ts`): 작가별 `r{비율}|{작품index}:{판매가}:{결제수단},…`. 응답 시 `SettlementApproval.snapshot` 에 저장. **`ArtworkSale.title` 은 넣지 않는다** — 화면 제목은 작가 출품목록에서 오고 이 컬럼은 판매 당시 스냅샷이라, 넣으면 금액이 그대로인데도 멀쩡한 수락이 풀린다. `findMany` 순서를 믿지 말고 반드시 index 정렬 후 생성
    - **요청을 유지한 채 그 작가만 고쳐 보낸다** — `PUT settlement` 의 요청 중 403 잠금을 없앴다. 예전엔 수정 경로가 [요청 취소]뿐이라, 한 명을 고치려면 요청 전체를 내려야 했고 **아직 검토 중이던 작가의 화면까지 닫혔다**(`my-settlement` 가 requested:false 로 비공개). 지금은 저장만 하면 끝
    - `PUT settlement`: 저장 후 지문이 어긋난 작가만 `PENDING`(+comment/snapshot null)로 되돌리고, **요청이 열려 있으면 그 작가에게만** 재확인 알림(`SETTLEMENT_CONFIRM_REQUEST`, "…수정되었습니다"). `{resetCount, notified}` 반환. **관리자가 요청 중 금액을 고쳐도 여기서 자동으로 풀린다** — 예전엔 작가가 못 본 금액으로 완료될 수 있었다
    - ⚠️ **낙관적 동시성**: 갤러리가 검토 중에 고칠 수 있게 되면서, 작가가 **옛 화면을 띄워둔 채 수락**하면 본 적 없는 금액에 동의한 기록이 남는다. `GET my-settlement` 이 현재 지문(`fingerprint`)을 함께 내려주고, `POST settlement/respond` 가 그걸 되돌려받아 대조 → 불일치면 **409**(프론트는 409에서 `['operation-my-settlement']` invalidate 해 최신 금액을 다시 그린다). 지문을 안 보내는 옛 클라이언트는 통과(하위호환)
    - `POST .../settlement/request/artist/:artistUserId`: **그 작가만** PENDING 으로 되돌리고(코멘트도 지움) 알림. 금액을 고칠 게 없는데 ISSUE 가 남은 경우(작가가 잘못 봤거나 전화로 이미 풀린 경우)의 출구 — 없으면 전원 수락이 안 돼 정산을 못 끝내고 결국 요청 전체를 내렸다 올려야 한다. 화면에선 **요청 중인 모든 작가 카드**에 [이 작가에게 다시 확인 요청] (상태별로 감췄더니 금액을 고쳐 PENDING 이 된 순간 버튼이 사라져 다시 보낼 길이 없었다). 수락 작가 검증(임의 id 주입 차단), 요청 전이면 400
    - `request/cancel`: 승인 기록을 **지우지 않고** `settlementRequestedAt` 만 해제(`keptCount` 반환)
    - `settlement/request`: `APPROVED && snapshot 일치` 인 작가는 건너뛰고(=수락 유지), 나머지(미응답·ISSUE·금액변경)만 PENDING 재생성 + **그들에게만 알림**. `{requestedCount, keptCount}` 반환. ISSUE 는 금액이 그대로여도 다시 묻는다(그 상태로는 어차피 완료 불가). 수락 취소된 작가 행은 이때 정리
    - `settlement/complete`: 전원 APPROVED 게이트에 더해 **지문 일치까지 확인**(PUT 을 우회한 직접 수정 방어). 어긋나면 400
    - ⚠️ **보내는 버튼은 화면 값을 먼저 저장한다** ([정산 확인 요청], [이 작가에게 다시 확인 요청]). 저장을 안 했더니 ①작가에게 **옛 금액**이 그대로 갔고 ②invalidate→refetch 가 입력 중이던 값을 **조용히 되돌렸다**(실측 재현). 저장 응답의 `resetIds` 로 그 작가가 이미 알림을 받았는지 보고 재요청을 건너뛴다(알림 2번 방지). 값을 확정/철회하는 [정산 완료]·[요청 취소]는 반대로 **미저장이면 막는다**(옛 금액으로 확정되거나 입력이 사라진다). 미저장 여부는 `lib/settlement.ts` 의 `settlementFormSignature` 로 화면 값 ↔ 서버 값 지문 비교, 화면엔 '저장 안 된 변경 있음' 배지
    - 회귀 테스트: `operation.test.ts > 정산 부분 재확인`(14), `settlement-fingerprint.test.ts`(8), `frontend/src/__tests__/settlement.test.ts`(15), E2E `e2e/_settle.mjs`(브라우저 42항목)
  - **무응답 자동 수락 (3일)** (2026-08-17, migration 20260817140000, `lib/settlementDeadline.ts`):
    - 확인 요청 후 작가가 3일간 응답하지 않으면 수락으로 처리. 응답이 없어 정산이 무기한 멈추는 걸 막는다
    - 기준은 공모의 `settlementRequestedAt` 이 아니라 **작가별 `SettlementApproval.askedAt`** — 부분 재확인 때문에 작가마다 물어본 시점이 다르다. PENDING 을 만드는 **모든 경로**에서 새로 찍는다(최초 요청 / 작가별 재요청 / 금액 수정으로 인한 초기화) = **기한이 다시 시작된다**
    - ⚠️ 특히 **금액 수정 시 연장**이 핵심 — 안 그러면 마감 직전에 금액을 바꿔놓고 자동 수락시키는 게 가능하다
    - ⚠️ **ISSUE 는 절대 자동 수락하지 않는다**. 명시적으로 이의를 낸 사람을 침묵으로 간주하는 건 취지와 정반대
    - 자동 수락 시 `autoApprovedAt` 기록 — 사람이 누른 수락과 반드시 구분(다툼 시 유일한 근거). 화면에도 '자동 수락' 회색 배지. **지문(snapshot)도 함께 써야 한다** — 안 쓰면 곧바로 '확인 이후 변경'으로 잡혀 완료가 400
    - 기한은 **KST 달력 3일**(`endOfTodayKstAsUtc(askedAt) + 3일`). 72시간으로 하면 밤에 보낸 요청이 하루를 손해 본다 — 돈 판정은 작가에게 유리한 쪽으로
    - 별도 스케줄러 없이 **정산 화면 조회/완료 시 훑는다**(`autoApproveOverdue`, 알림 TTL 정리와 같은 방식). best-effort — 실패해도 조회·완료는 진행
    - 고지: 확인 요청 알림 3종 모두에 "3일간 응답이 없으면 자동 수락" 문구, 작가 화면에 기한 날짜, 갤러리 카드에 작가별 기한. 자동 수락되면 작가에게 알림
    - ⚠️ **소급 적용하지 않는다** — 배포 시점의 기존 PENDING 행은 `askedAt` 이 NULL 이라 영원히 자동 수락되지 않는다. 안내를 받은 적 없는 사람에게 침묵=동의를 적용할 수 없기 때문. 기존 건은 갤러리가 [이 작가에게 다시 확인 요청]을 눌러야 기한이 시작되고, 그때 안내가 함께 나간다
    - 회귀: `settlement-deadline.test.ts`(12, KST 경계 실측), `operation.test.ts > 무응답 자동 수락`(11), E2E `e2e/_autoapprove2.mjs`(10)
  - **작가용 정산서 PDF 는 갤러리 몫 금액을 찍지 않는다** (2026-08-17): `downloadArtistSettlementPdf(…, { forArtist: true })` → `artistSettlementHtml` 의 `hideGalleryAmount`. 화면(`MyArtistSettlementSection`)은 원래부터 판매합계·비율·내 정산액만 보여주는데 PDF 만 '갤러리 정산' 줄을 인쇄해 어긋나 있었다. **갤러리가 받는 작가별/전체 정산서는 그대로**(운영 기록에서 자기 몫이 사라지면 안 된다). 정보 은닉이 아니라 서식 규칙 — 판매합계·비율이 남으니 갤러리 몫은 뺄셈으로 나온다. 회귀 `frontend/src/__tests__/settlementPdf.test.ts`(6)
  - **정산 섹션 컴포넌트 공용화 + 작가별 접기/열기** (2026-08-17):
    - `components/operation/SettlementSection.tsx` 한 벌을 `OperationPage`(신규)·`OperationClassicPage`(클래식)가 공유(`className` 만 다름). 예전엔 같은 코드가 두 파일에 복붙돼 있어 **돈 계산이 한쪽만 조용히 틀어질 수 있었다**
    - 계산·표기는 `lib/settlement.ts`(`won`/`artistTotals`/`initialOpenArtistIds`)로 분리 — 컴포넌트 파일이 함수를 함께 export 하면 Vite fast-refresh 가 편집 중 입력을 날린다
    - 기본 접힘. 예외 둘: **작가 2명 이하**(개인전에서 매번 한 번 더 누르게 하지 않는다), **ISSUE 작가**(갤러리가 지금 봐야 할 사람). 접힌 줄엔 상태배지·판매점수·작가지급액만. 실측 18명 기준 문서 높이 16015px → 2807px
    - ⚠️ `truncate` 는 **min-content 를 줄이지 않는다** — `overflow:hidden` 은 flex 자동 최소치의 '바닥'만 없앨 뿐이라, min-content 로 크기가 정해지는 grid 트랙 안에서는 nowrap 텍스트가 폭을 그대로 밀어낸다. `OperationPage` 의 grid 아이템에 `min-w-0` 을 **하나라도 빼먹으면** 375px 에서 가로 스크롤이 생긴다(실측 447px). 모바일에선 토글이 한 줄을 다 쓰고 PDF 버튼이 아래로 내려간다 — 한 줄에 다 넣었더니 이름이 '한' 한 글자로 뭉개졌다
- **공개 모집공고 [모집 중 / 마감된 공고] 탭** (2026-08-17, `GET /exhibitions?scope=open|closed`):
  - 마감되면 목록에서 통째로 사라져 화면이 비었다(실측 노출 4 / 숨김 6). 지원자 19명이 붙었던 공모도 흔적이 없어 갤러리가 뭘 해왔는지 알 수 없었다. `scope=closed` 는 **수동 모집마감 · 전시종료 · 마감일 경과** 를 모은다(최근 마감순). 기본은 `open`, 알 수 없는 값도 `open`(기본이 숨김)
  - ⚠️ **`status: 'APPROVED'` 는 두 scope 모두에 항상 걸린다** — 심사중·반려·탈퇴가 '마감된 공고'로 새면 남의 미승인 공모를 공개하는 셈이다(CLAUDE.md 23 과 같은 사고). 검색어(`q`)가 있으면 기존 코드가 `where.OR` 를 `AND` 로 감싸므로 scope 조건이 유지된다 — 여기를 고칠 땐 반드시 같이 확인할 것
  - ⚠️ **상세의 지원 차단은 마감일만 보면 안 된다.** `ExhibitionDetailPage` 의 `isExpired` 가 `dday < 0` 뿐이라, **마감일이 남은 채 수동 마감/전시종료된 공고**에 [지원하기]가 그대로 떴다. 목록에 안 보일 땐 드러나지 않다가 이 탭이 생기며 도달 가능해졌다 → `recruitmentClosed`/`ended` 포함으로 확장(`?apply=1` 자동 오픈 경로도 동일). 서버 `POST /:id/apply` 는 상태·수동마감·전시종료·마감일 **4중**으로 이미 막고 있어 새도 지원은 안 되지만, 눌러보고 400 을 받는 화면을 만들지 않는다
  - 카드는 D-day 대신 `마감` 배지 + 흐리게. 상세는 계속 열람 가능(기록·갤러리 신뢰도). 탭은 URL(`?scope=closed`)에 실어 뒤로가기·공유에서 유지
  - 회귀: `exhibition-closed-scope.test.ts`(11 — 미승인 누출·검색 결합·지원 차단), E2E `e2e/_closedlist.mjs`(18)
- **정산 완료 후 공모 취급** (2026-08-17):
  - 공고는 살아 있고 **잠긴다** — 상세/운영 페이지 열람·정산 PDF 는 그대로, 공지·제출자료·정산·단계 변경은 403(Admin 예외). 공개 목록에는 전시종료 때 이미 `recruitmentClosed` 로 빠져 있어 정산 완료가 추가로 하는 일은 없다. `settledAt` 을 되돌리는 API 는 없다(완료 모달에도 '되돌릴 수 없습니다')
  - ⚠️ **삭제 차단**(`DELETE /exhibitions/:id`) — cascade 가 `ArtworkSale`·`ArtistSettlement`·`SettlementApproval`·`ExhibitionSubmission` 까지 지운다. 합의가 끝난 금전 기록이라 버튼 한 번에 사라지면 다툼 시 근거가 없다. 갤러리 400, **Admin 은 허용**(잘못 만든 데이터 정리용). 회귀 `exhibition-extended.test.ts`
  - **마이페이지 내 공모 = [진행중인 공모] / [종료된 공모] 탭** — 예전엔 `신규 운영 보기 / 기존 목록 보기`(같은 목록의 렌더링 두 벌) 였는데, 한쪽만 뒤처지고(단계 배지·다음 할 일이 신규에만 있었다) 끝난 공모가 계속 쌓였다. 렌더링은 운영 허브 한 벌로 통일하고 토글 자리를 필터로 바꿨다. **종료 = `settledAt`**(전시종료는 정산이 남아 할 일이 있으므로 진행중). 종료 탭은 최근 마감순, 카드에서 [추가 질문]·[삭제] 를 감춘다(서버가 막는 동작이라 눌러보고 실패하게 두지 않는다). 필터는 localStorage 에 **저장하지 않는다** — 다음에 열었을 때 종료 탭이 떠 있으면 "공모가 다 사라졌다"로 읽힌다
  - **Admin 운영 조회(마이페이지 > 운영 조회 > 공모 지원현황)도 같은 분리** — `GET /admin/exhibitions` 가 `ended`·`settledAt` 을 함께 내려주고 화면에서 [진행중인 공모 / 종료된 공모] 로 나눈다. **기준은 갤러리 쪽과 같아야 한다**(종료 = `settledAt`) — 갈리면 두 화면의 숫자가 달라진다. 목록 줄에 `정산 단계`(주황)·`정산 완료`(초록) 배지. 검색 결과 안에서 나눈다. ⚠️ 응답에서 두 필드가 빠지면 화면이 **에러 없이 전부 진행중으로** 보인다 — 회귀 `admin-oversight.test.ts`
  - **진행 단계 스텝퍼에 4번째 '정산 완료'** (`components/operation/StatusPanel.tsx`, 두 운영 뷰 공용) — 예전엔 전시종료에서 끝나 완전히 마감됐는지 알 수 없었다. ⚠️ 앞 3단계와 달리 **버튼으로 넘어가는 단계가 아니다**(작가 확인을 거쳐야 함). `LIFECYCLE_STEPS`(버튼용 3개)와 `STEP_NODES`(표시용 4개)를 분리해 둔 이유 — 합치면 [다음 단계로]가 정산을 건너뛰고 마감시킨다. 마감 시 초록 체크 + [🔒 마감됨] 배지
- **ArtLook** (`frontend/public/artlook/` 정적 페이지, 구 poc/frameit) — 작품 액자·전시공간 목업 합성(클라이언트 Canvas). 운영페이지 정산 섹션 [ArtLook으로 홍보 이미지 만들기]가 판매작을 `localStorage 'artlook:works'`([{url,title,artist,exhibition}])로 넘겨 `/artlook/index.html` 새 탭으로 염. 다운로드 파일명 `작가_작품명_공모명_판매작.png`. 첨부 없음(판매작만). 운영(R2 외부도메인) 이미지는 캔버스 taint 방지 위해 `GET /api/upload/image-proxy?url=`(R2_PUBLIC_URL 화이트리스트, SSRF가드)로 동일출처 중계
- **ArtLook 진입 경로 2개** (2026-08-15): ① 운영페이지 정산 > 판매작 홍보 ② 마이페이지 > 포트폴리오 > [액자에 걸어보기].
  핸드오프는 `frontend/src/lib/artlook.ts` 로 공용화했고, payload 에 `kind`('sold'|'portfolio')를 실어
  **파일명에서 '판매작' 접미사를 판매작에만** 붙인다(포트폴리오 작품에 붙으면 사실과 다르다). `kind` 없는 옛 payload 는 판매작으로 본다.
  작품 카드는 네 모서리(캡션·삭제·공개토글·좋아요)가 이미 차 있어 카드마다 버튼을 얹지 않고 **섹션 헤더에 하나** 두고 전체를 넘긴다 — 고르는 건 ArtLook 안에서.
  ⚠️ 호출부는 **3곳**이다 — `MyPage`, `OperationPage`, 그리고 **`OperationClassicPage`**(클래식 뷰). 클래식 쪽을 빼먹으면
  갤러리가 어떤 뷰를 쓰느냐에 따라 `kind` 가 실리거나 안 실려 **에러 없이 조용히** 파일명만 달라진다(실제로 그랬다).
  `lib/artlook.ts` 밖에서 `localStorage.setItem('artlook:works', ...)` 를 직접 쓰지 말 것.
- **ArtLook 워터마크** (2026-08-15): 출력 우하단에 `ArtLink` 워드마크. **항상 켜짐(끌 수 없음)** —
  두 진입 경로 모두 적용된다. 체크박스는 없앴다: 이 도구를 무료로 여는 목적 자체가 작가 유입이라
  워터마크가 곧 노출 경로다. 미리보기에도 같이 그린다(저장 후 발견하면 배신감). 벽이 17종이라 밝기 편차가 커서
  **놓일 자리 배경을 캔버스에서 읽어 글자색을 뒤집는다**(밝으면 검정+흰 그림자, 어두우면 흰색+검은 그림자). 빨강 `Link` 는 유지.
  ⚠️ 캔버스에 글자를 그리기 전 `document.fonts.ready` 를 기다린다 — 없으면 Pretendard 대신 시스템 글꼴로 찍힌다(포트폴리오 PDF와 같은 함정).
  ⚠️ 로컬에서 작품이 안 뜨면 `backend/.env` 의 `R2_PUBLIC_URL` 누락이다. ArtLook 은 캔버스 taint 를 피하려고 R2 이미지를 동일출처 프록시로 받는데, 그 값이 없으면 프록시가 400 을 낸다.
- **ArtLook 장면(Scene) 모드** (2026-08-30, `public/artlook/scene.js` + `scenes/scenes.json` + `author.html`):
  [4 · 배경]의 [기본 벽 | 장면] 토글. **장면** = Flux 로 사전 생성한 *빈 액자가 걸린 방* 사진에
  원본 작품을 **원근 워프**해 끼우는 방식. 액자를 그리지 않고 사진에서 가져오므로 CG 티가 없다.
  - 파이프라인: `buildInsert`(매트+작품 contain+베벨+안쪽그림자) → `boxFaces`(입체 — 뒷면/앞면/옆면)
    → 2겹 그림자 → 옆면 `warp` → 앞면 `warp`(WebGL2 역호모그래피, 밉맵·이방성·fwidth AA)
    → `occlusion`(multiply) → `reflection`(screen) → `foreground`(작품 앞을 가리는 화분·의자).
    **전경은 반드시 마지막** — 순서가 바뀌면 가려진다.
  - **입체(2026-08-30)**: 작품을 벽에서 떠 있는 상자로 본다. `depth`(기본 0.030=짧은 변 대비)·
    `view`(시선 오프셋 `[0.58,0.32]` — **빛을 받는 왼쪽·위 면이 보이게**)로 앞면을 밀고 키워
    옆면을 드러낸다. 옆면 텍스처는 `edgeStrip()`(판 가장자리 픽셀 띠, 폭은 **실제 두께만큼**,
    바깥 `inset` 만큼 건너뜀) + 앞→벽 낙차 + 경계 그늘 선. 액자에는 옆면을 만들지 않고
    (`depth:0`) 몰딩 프로파일이 두께를 낸다. `opening` 장면도 두께 없음(사진 액자가 이미 갖고 있다).
  - **액자 몰딩 조명(2026-08-30, `shadeFrameProfile`)**: 사진 액자는 스튜디오 확산광으로 찍혀
    네 변이 같은 밝기라 그대로 걸면 인쇄한 띠로 보인다. 살을 **세 면**(바깥 모따기 18% /
    앞면 56% / 안쪽 사면 26%)으로 보고 장면 `lightDir` 로 다시 비춘다. 코너는 마이터라
    `mitreBand()` 사다리꼴로 클립. 안쪽 사면은 **폐색 지배**(기본 그늘 .58, 방향 진폭 .22)라
    빛을 향한 변에서도 어둡다 — 이게 '작품이 액자 뒤에 있다'는 유일한 신호(`rebateShadow`).
    절차적 액자도 같은 모델(`planeOf()` 가 `lightDir` 로 `PLANE_AMP` 를 회전).
  - **합성 해상도(2026-08-30 4차)**: 출력보다 `SUPERSAMPLE`(1.6)배 큰 오프스크린
    (`stageCanvas`)에서 마스크·그림자·워프·워터마크를 전부 계산하고 `finish()` 가 **한 번만**
    내린다. 벽 배율은 그대로다(`maxSrcScale`에 SS 를 곱해 넘긴다) — 좋아지는 건 그림자 계조와
    글자·대각 경계. 화면에 넘기는 좌표는 `toOut`/`artlookProbe(…,SS)` 로 출력 좌표로 되돌린다.
  - **그림자는 세 겹**: 넓은 반그림자(0.160/0.065) · 투영(0.050/0.170) · 접지(0.014/0.140).
    두 겹일 때 감쇠 꼬리가 골든보다 일찍 죽었다(폭 8% 지점 0.02~0.06 vs 0.10~0.12).
  - **코너 폐색 + 비네팅(2026-08-30 5차)**: 골든의 살은 길이 방향으로 8.5~104% 흔들리는데
    (양 끝이 어둡다 = 마이터 코너 폐색) 우리는 3% 로 균일했다. `composeScene` 이 **화면
    좌표**에서 조각 네 모서리에 곱연산 폐색(`cornerAO`)을 걸고, `sceneVignette` 이 화면
    전체에 렌즈 비네팅을 건다. ⚠️ 판(plate)에만 걸면 판 경계에서 벽과 어긋나 **검은 테**가
    생긴다(실측 벽 228 / 판 147). 조각 배치도 정중앙이 아니라 살짝 위(`fitScene` 0.485).
  - **디버그 마스크**: `/artlook/index.html?debug=1` → `window.__artlookDebug(override)` 가
    outer/front/bevel/mat/opening 마스크와 접지·투영·반그림자 레이어, BEFORE/AFTER 를 준다.
    마스크는 **본 렌더와 같은 quad 로 워프**하므로 화면과 정확히 겹친다.
    하니스 `scratchpad/vt/masks.mjs` + `masksheet.py`.
  - **그림자(2026-08-30)**: 캐스터를 캔버스 밖(−2W)에 두고 `shadowOffsetX` 로 **그림자만** 끌어온다.
    본 캔버스에 바로 `fill()` 하면 quad 가 통짜 검정이 되어 조각 둘레에 검은 테가 생기고,
    파내기로 지우면 반대로 밝은 테가 생긴다(둘 다 실측으로 확인).
  - **매트(2026-08-30)**: 색면이 아니라 **두께 있는 종이판**으로 그린다 —
    `matPaper`(평균 보존 직조 결) → `shadeMatSurface`(세로 지배 방향광) →
    `frameShadowOnMat`(액자가 드리우는 그림자) → 작품 → `matOpeningBevel`(45° 코어 사면).
    액자↔작품 틈은 **다섯 마디**(앞면 → 급락 → 회복 → 밝은 립 → 작품 위 그림자).
  - **벽 명암 LOD**: 장면 사진 크기와 무관하게 ≈11텍셀로 뭉갠다(고정 5단계는 큰 사진에서
    벽돌 줄눈이 작품에 비쳤다 — 스톤 20% 유출).
  - **`lightDir` 은 사진에서 측정**(`scratchpad/vt/lightdir.py`). 손으로 적은 값이 실제와
    반대인 장면이 11개 중 10개였다. 단, 세로는 항상 위로 보정(바닥 반사 때문).
  - **벽 진정(`wallCalm`, 2026-08-30 3차)**: 배경의 결만 죽이고 조명 낙차는 남긴다 —
    같은 사진의 **흐린 판을 알파로 덮는다**(`원본×(1−c)+흐림×c`). 반드시 화면 전체에 균일하게
    (액자 둘레만 흐리면 그게 마스크 테다). 세기는 `scratchpad/vt/wallcalm.py` 로 **재서** 넣는다
    (평평한 벽 목표 3.3 / 실내 사진 4.0 — 방은 가구까지 흐려지면 가짜 아웃포커스가 된다).
    최종 세기는 `calmtune.py` 가 **렌더 결과를 보고** 2.5~4.5 밴드 안으로 되먹임 조정한다.
  - **액자 색 보정(`FRAME_GRADE`, 2026-08-30 3차)**: 우리 액자는 실물보다 채도가 2.5배 높았다
    (오크 60.4 ↔ FrameIt 24.5, 골드 97.3 ↔ 36.1 — 'plastic wood'의 정체).
    재질별 [채도, 밝기]를 **로드 때 한 번 구워** 둔다(hex 색 + 텍스처 이미지 **둘 다**).
  - **사진 액자 기하 대칭**: 개구부가 치우쳐 있었다(오크 위 119/아래 91 = 26.7%).
    `frontend/scripts/symmetrize-photo-frames.py` 가 개구부를 고정하고 바깥을 깎아 맞춘다(멱등).
  - **화질 회귀**: `scratchpad/vt/` — FrameIt 결과물을 골든으로 고정하고 keyline·rebate·
    rail_span·dir_tb·contact·recover·aspect 7지표(`run.py`) + 매트 4지표(`mat.py`) +
    존재감 7지표(`presence.py` — 조각 면적·벽 소란도·디테일비·대비비·살 채도·색온도·살 대칭) +
    작품 보존 4지표(`artpreserve.py` — 원본 파일과 직접 대조) + 벽무늬 유출(`leak.py`)을
    같은 코드로 잰다. 전수 스윕은 `sweepcheck.py frames|scenes`. 액자·매트·배경 변경 시 필수.
  - **장면 15종**: 매크로 벽 텍스처 8 + 인테리어 7. (스톤·그레이브릭은 2026-08-31 제거)
  - **조명(2026-08-31, `applyStudioLight`)**: [3 · 조명]은 **강도 0~100 슬라이더 하나**(0=없음).
    종류(없음/스포트/소프트)와 옛 라이팅맵 9-slice(`drawLightMap`)는 제거 —
    ⚠️ 그 코드는 **장면 분기에서 호출조차 되지 않아** 무엇을 골라도 화면이 그대로였다.
    합성이 끝난 **화면 전체**에 곱연산 두 겹 + 벽에만 닿는 밝힘 한 겹:
    ① 낙차(주역) — 장면의 `lightDir` 쪽으로 편심을 준 타원 그라디언트. 안쪽 반경이 조각
    네 귀퉁이를 덮으므로 작품은 배율 1(마스크가 아니라 **기하**로 보호 → 경계 테 없음).
    타원은 **광원 축에 수직**으로 늘인다(`aniso` 0.72). ② 물듦 — `sceneLightColor`(장면 사진의
    밝은 10% 색, 편차 상한 30레벨)를 화면 전체에 곱연산(soft-light 금지: 검정이 들린다).
    ③ 빛자국 — 조각 **바깥**(변 기준 1.68배)에만 `screen`.
    강도 100 실측: 작품 dE 0.7~2.8 · 채도비 0.90~1.00 · 그늘 쪽 구석 0.67~0.70 · 방향성 1.42~1.49.
    회귀 `scratchpad/vt/light.mjs` + `lightcheck.py`, 레퍼런스 분석 `lightref.py`.
  - **매트는 캔버스 랩만 빼고 전 스타일**(2026-08-31). 플로터는 **플로트 마운트** —
    [몰딩] → [갭] → [매트 보드] → [보드 위에 떠서 그림자를 드리우는 작품]. 개구부 사면은 없다.
    캔버스 랩은 액자가 없어 매트를 받칠 것이 없다(비활성 + 이유 표시). 액자 이름의 '(사진)' 제거.
  - 셰이더가 **장면사진의 같은 자리 밝기를 읽어 작품에 곱한다**(`wallAmt`) + 그레인 매칭.
    방의 조명 낙차가 작품 위로 이어지지 않으면 작품만 균일하게 떠 보인다(=붙여넣은 티).
  - 자리 지정 둘: `opening`(액자 구멍 4점 — 매트가 비율차를 먹는다, **드래그·휠 잠금**) /
    `region`(액자 없이 캔버스만 — 작품 비율 그대로, `regionCm`+`sizeText` 로 **실제 cm 스케일**).
  - **크기는 실제 크기 하나뿐**(2026-08-31): `sizeText` 를 압축 없이 벽 대비 실제 비율로 건다.
    실측(흰 벽돌 163×154cm): 4호 5.7% · 10호 14.8% · 30호 43.6% · 100호 44%(영역 상한).
    모드 토글·크기 안내문은 제거. 작아 보이면 자동 프레이밍이 **카메라를 당겨** 채운다
    (실치수를 아는 작품엔 `gain` 을 쓰지 않는다 — 비례가 거짓말이 되므로).
  - **자동 프레이밍은 '화면에서 차지하는 면적'이 목표**(`u.frameArea`, 기본 0.44 — 2026-08-30 3차).
    예전엔 작품 **높이**의 52% 였는데 세로 작품이면 면적은 21% 뿐이라 액자가 주인공이 못 됐다
    (실측 중앙값 16.9%, FrameIt Pro 44.1%). 키우는 순서: ①`placeInRegion` 의 `gain` 으로
    **영역 안에서**(화질 손실 0) ②모자란 만큼만 카메라를 당긴다. `gain` 은 실제 크기 모드에선
    쓰지 않고(정직한 치수), 사용자 조절(`scale`)과도 별개 축이다.
    확대 상한 `maxSrcScale`(1.15배) — 그 이상은 배경이 뭉개진다.
  - **출력 해상도는 장면 원본의 1/`SCENE_HEADROOM`(1.6)**, 최소 1080(`compose()`).
    원본 크기 그대로 뽑으면 `zoom×(출력/원본)≤1.15` 때문에 **확대 한도가 1.15배**뿐이라
    액자를 키울 수 없었다. 2600px 벽 → 1625px 출력이면 같은 화질 보증 아래 1.84배까지 당긴다.
    비율은 1:1 기본, '원본'은 제거.
  - **작품이 안 넘어오면 데모 작품(`demo/*.jpg`, 절차적 생성)** 을 띄워 바로 만져볼 수 있게 한다.
    ⚠️ 실제 가입자 작품을 `public/` 에 두지 말 것(배포물에 개인정보).
  - 폴백: WebGL2 미지원이거나 `scenes.json` 이 비면 토글을 감추고 기본 벽만 남는다.
  - 회귀: `frontend/src/__tests__/artlookScene.test.ts`(38) — 호모그래피 정확도·두 크기모드·비율보존·파서·폴백 +
    자동 프레이밍 `gain`·`scenes.json` 데이터 규칙(lightDir 세로/wallCalm 범위)·사진 액자 살 대칭.
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
- Navbar 배치: 로고는 본문 컨테이너 왼쪽, **가운데 메뉴는 네비바 전체의 정중앙**(absolute), **우측 그룹은 네비바 오른쪽 끝**(`absolute right-4`).
  `right-4`(16px)는 우측 사이드바 `nav` 의 `px-4` 와 같은 값이라 [로그아웃] 오른쪽 끝이 사이드바 메뉴 항목과 맞는다.
  실측(1024~1920, 로그인): 로그아웃 우단 = 사이드바 우단, 메뉴 중심 = 화면 중심, 겹침 없음.
- Navbar 우측 상단: 비로그인 시 [로그인] 하나. 로그인 시 `이름 (역할)` → [로그아웃](캐시 clear + logout + /login)
  - **[마이페이지] 버튼은 제거**(2026-08-27) — 우측 세로 사이드바가 각 탭으로 바로 보내 중복이었다
  - 🔑 **로고 왼쪽 끝 = 본문 제목 왼쪽 끝.** 네비바도 본문과 같은 컨테이너(`max-w-7xl mx-auto px-6 md:px-12`)를 쓰고,
    사이드바가 뜨는 조건과 **같은 조건으로** `w-56` 자리를 비운다. 안 맞추면 1600px에서 48~144px 어긋난다(실측)
  - **로그아웃도 Navbar 전용** — MyPage 본문 우상단의 로그아웃 버튼은 제거(한 화면에 두 개였다)

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
| /benefits | ⏸ 비활성화 → `/` 리다이렉트 (BenefitsPage 파일·API·Admin 관리탭은 유지) | X |
| /login | LoginPage | X |
| /mypage | MyPage | O (ProtectedRoute) |

## 주요 컴포넌트 가이드

### 페이지별 기능 매핑

| 페이지 | 주요 기능 | 관련 코드 |
|--------|----------|-----------|
| HomePage | ArtWorks → Hero 슬라이더 → GotM (2026-08-27 개편, 퀵액션 삭제) | `components/home/*` |
| GalleriesPage | 갤러리 목록, 지역/별점 필터, 정렬, 찜 | `pages/GalleriesPage.tsx` |
| GalleryDetailPage | 이미지 슬라이더, 찜, 상세수정, 공모목록, 홍보사진, 리뷰 | `pages/GalleryDetailPage.tsx` |
| ExhibitionsPage | 공모 목록, 필터, 카드 클릭→상세 이동, 빠른 지원 | `pages/ExhibitionsPage.tsx` |
| ExhibitionDetailPage | 공모 상세, 지원하기(+이메일), 홍보사진, 삭제(오너/Admin) | `pages/ExhibitionDetailPage.tsx` |
| ShowsPage | 전시 목록, 지역/상태 필터, 찜 (optimistic) | `pages/ShowsPage.tsx` |
| ShowDetailPage | 전시 상세, ImageLightbox, 소개수정(오너), 삭제, 찜, 작가→포트폴리오 | `pages/ShowDetailPage.tsx` |
| PortfolioPage | 공개 포트폴리오 (약력, 경력[아트페어/개인전/단체전], 포트폴리오파일, 작품 이미지 그리드) | `pages/PortfolioPage.tsx` |

> **작가 공개페이지 표시 규칙** (2026-08-16)
> - **작품 격자**: `aspect-square` 칸 + `object-contain`, 칸 배경은 **흰색**. 예전 masonry(`columns`)는 폭만 맞고
>   높이가 제각각이라 줄이 어긋났다. 칸을 정사각으로 고정해 행렬을 맞추되, 회색 타일을 깔면 타일이
>   작품보다 먼저 읽히므로 배경은 두지 않는다. 비율은 그대로다(18번 규칙).
> - **이미지 프리로드 제거**: masonry 시절 높이를 미리 몰라 30장을 전부 받은 뒤 한꺼번에 보여줬다.
>   칸 높이가 정해지면서 불필요해졌다 — 한 장씩 lazy 로 들어와도 레이아웃이 움직이지 않는다.
> - **캡션**: `hasTitle()` 이 false 면 제목 줄을 그리지 않는다. `artworkTitle()` 은 빈 제목에 '무제' 를
>   돌려주므로 **표시 여부 판정에 쓰면 안 된다** — 실데이터 372점 중 제목이 있는 건 9점(2%)뿐이라
>   그대로 그리면 화면이 '무제' 로 도배된다. 편집 화면(MyPage)은 반대로 보여줘야 작가가 빠진 걸 안다.
>   보여줄 게 아무것도 없으면 `<figcaption>` 자체를 그리지 않는다(빈 요소가 여백을 먹는다).
> - **약력·작가노트**: `reflowProse()`(`lib/prose.ts`)로 손으로 넣은 줄바꿈을 정리해 표시한다.
>   **저장값은 건드리지 않는다.**
> - **뒤로가기**: `useGoBack('/explore')`. `navigate(-1)` 은 기록이 있을 때만 동작하는데, 공개페이지는
>   공유·새 탭으로 열리는 일이 잦아 그때 버튼이 죽는다. 기록이 없으면 목록으로 보낸다.
| OperationPage | 공모 운영 페이지 (`/exhibitions/:id/operation`) — 공지/작가 전시정보 입력/갤러리·admin 열람 | `pages/OperationPage.tsx` |
| OperationPrintPage | 작가 제출문서 PDF 인쇄 (`/exhibitions/:id/operation/print/:userId/:doc`) | `pages/OperationPrintPage.tsx` |
| BenefitsPage | 혜택 목록 | `pages/BenefitsPage.tsx` |
| MyPage | 역할별 메뉴 — **lg↑ 우측 세로 사이드바 / lg↓ 가로 탭바** (아래 상세) | `pages/MyPage.tsx` |

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
| KanbanSection | Admin | 할 일 보드 (`components/admin/KanbanSection.tsx`) — 보드 여러 개, 체크박스 목록, 세부항목 인라인, 담당자·마감일·댓글 |

## Admin 할 일 보드 (2026-08-21)

마이페이지(Admin) > **할 일 보드** 탭. Admin 계정끼리 회의 내용과 할 일을 정리한다.

### 화면은 한 장뿐이다
보드를 클릭해 **들어가는 단계가 없다.** 보드 목록 화면에 각 보드의 할 일이 그대로 펼쳐지고,
추가·체크·순서·세부항목까지 전부 거기서 끝낸다. 보드가 많아지면 머리말을 눌러 접을 수 있고,
접어 둔 보드는 `localStorage`(`artlink-todo-collapsed`)에 기억된다(읽기·쓰기 모두 try/catch).

그래서 **`GET /kanban/boards` 가 항목과 세부항목까지 통째로** 준다 — 보드마다 따로 부르면
화면 하나 그리는 데 N+1 번을 부르게 된다. 쿼리 키도 `['todo-boards']` 하나뿐이라 모든 변경이
이 키만 무효화하면 된다. 낙관적 업데이트는 **해당 보드의 cards 만** 갈아끼운다(다른 보드는 그대로).

### 구조
- **보드 여러 개** — 회의별·주제별로 나눈다(`KanbanBoard`). 머리말에 진행 표시줄과 완료/전체.
- **각 보드는 체크박스 목록 하나** — 한 줄에 항목 하나(`KanbanCard`). 제목, 본문(회의 내용),
  담당자(Admin 중에서만), 마감일, 댓글(`KanbanComment`).
- **세부항목**(`KanbanSubtask`) — 항목 아래에 **목록 화면에서 그대로 펼쳐진다.** 거기서 바로
  추가·체크·이름수정·삭제한다(모달을 열지 않는다). 상위 줄에는 `2/3` 배지만 붙는다.

> 이름이 `Kanban*` / `/api/kanban` 인 이유: 처음엔 3열 칸반으로 만들었다가 목록형 체크리스트로 바꿨다
> (2026-08-21 당일). 테이블·경로 이름만 남았을 뿐 **열(column) 개념은 없다.**

### 지켜야 할 규칙
1. **라우터 전체가 Admin 전용** — `routes/kanban.ts` 는 `router.use(authenticate, authorize('ADMIN'))` 로
   한 번에 건다. 보드 제목·항목 본문·댓글에 내부 논의가 그대로 들어가므로 공개 엔드포인트를 하나라도
   만들면 그 즉시 샌다. 회귀 방지는 `__tests__/kanban.test.ts` 의 '접근 제어' 블록(엔드포인트 전수 검사).
2. **완료는 `doneAt` 하나로만 판정** — 상태 필드를 따로 만들지 말 것. 두 곳에 두면 반드시 어긋나고,
   어긋난 쪽이 화면이면 "체크했는데 안 된 것처럼 보이는" 상태가 된다.
3. **체크해도 `position` 은 건드리지 않는다** — 완료 항목은 `sortItems` 정렬로만 뒤로 간다.
   실제로 줄을 옮겨버리면 **체크를 푸는 순간 원래 자리로 돌아올 수 없다.**
   정렬 규칙: 안 한 일(position 순) → 완료(최근 체크 순). 백엔드·프론트 양쪽 `sortItems` 가 같아야 한다.
4. **position 은 보드 안에서 0부터 연속** — 소수점 사이값(0.5)을 끼워 넣는 방식은 옮길수록 자릿수가 늘어
   부동소수점에서 순서가 뒤집힌다. 재정렬할 때마다 서버가 0..n-1 로 다시 매긴다.
5. **순서 변경은 전체 순서 id 배열을 통째로 보낸다**(`PATCH /boards/:id/reorder`). "몇 번째 앞으로" 를
   index 로 주고받으면 완료 항목이 뒤로 밀려 보이는 화면과 실제 position 이 어긋나 계산이 틀어진다.
   ids 에 빠진 항목(그 사이 다른 Admin 이 추가한 것)은 **뒤에 붙인다** — 여기서 409 로 거절하면
   같이 쓰는 보드에서 재정렬이 자꾸 실패한다.
6. **순서 이동 경로가 둘인 이유** — 드래그앤드롭은 HTML5 네이티브라 **터치에서 동작하지 않는다.**
   이 사이트는 모바일웹이 기본이므로 줄의 `↑ ↓` 버튼이 폰에서의 유일한 경로다. 지우지 말 것.
   (Framer Motion drag 는 CLAUDE.md 제약 9 때문에 쓰지 않는다.)
   ⚠️ 목록 컨테이너의 `onDragOver` 에서 목표 위치를 **덮어쓰지 말 것** — 줄 사이 여백에서도 이 핸들러가
   뜨는데, 그때마다 '맨 끝'으로 덮으면 마지막 순간이 하필 여백일 때 항목이 엉뚱하게 맨 아래로 간다
   (2026-08-21 E2E 에서 잡음). 목표는 줄의 dragover 가 정한다.
7. **드래그는 같은 보드 안에서만** — 보드를 건너뛰면 그 항목이 어느 보드 소속인지가 흔들린다.
   보드 구획(`BoardSection`)이 각자 dragging 상태를 들고 있어 자연히 갈라진다.
8. **댓글은 작성자 본인만 삭제** — 다른 Admin 이 남긴 회의 기록을 지울 수 있으면 논의 근거가 조용히 사라진다.
9. **마감일 판정은 KST 달력 날짜** — `dueBadge()` 가 `getDday` 를 쓴다. 순수 `new Date()` 비교를 쓰면
   마감일 당일 오전 9시에 '지남'으로 바뀐다(CLAUDE.md 제약 14).
10. **담당자는 Admin + 미탈퇴만** — 서버 `assertAssignee()` 가 검증한다. 작가/갤러리를 넣으면 400.
11. **세부항목을 다 체크해도 상위 항목을 자동 완료시키지 말 것** — 확인·보고가 남아 있을 수 있고,
    자동으로 목록에서 사라지면 되돌리기도 번거롭다. 진행(2/3)만 보여주고 마무리는 사람이 누른다.
12. **세부항목은 체크해도 자리가 안 바뀐다**(상위 항목과 다른 점) — 언제나 position 순 그대로다.
    서너 줄짜리 목록에서 체크할 때마다 줄이 튀어 다니면 다음 걸 누르기가 힘들다.
    담당자·마감일·댓글도 없다 — 그 정도로 무거운 일이면 상위 항목으로 올리는 게 맞다.

### API
```
GET    /api/kanban/members                담당자 후보(Admin 목록)
GET    /api/kanban/boards                 보드 목록 (항목·세부항목 통째로, 정렬 완료 상태)
POST   /api/kanban/boards                 보드 생성
GET    /api/kanban/boards/:id             보드 하나 (테스트·단건 조회용)
PATCH  /api/kanban/boards/:id             이름·설명 수정
PATCH  /api/kanban/boards/:id/reorder     항목 순서 { ids: 전체 순서 }
DELETE /api/kanban/boards/:id             삭제 (항목·댓글 Cascade)
POST   /api/kanban/boards/:id/cards       항목 추가 (목록 맨 뒤)
POST   /api/kanban/cards/:id/subtasks     세부항목 추가 (맨 뒤)
PATCH  /api/kanban/subtasks/:id           세부항목 수정 (이름 / done 체크)
DELETE /api/kanban/subtasks/:id           세부항목 삭제
PATCH  /api/kanban/cards/:id              항목 수정 (+ done 체크)
DELETE /api/kanban/cards/:id              항목 삭제
GET    /api/kanban/cards/:id/comments     댓글 목록
POST   /api/kanban/cards/:id/comments     댓글 작성
DELETE /api/kanban/comments/:id           댓글 삭제 (작성자 본인만)
```

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
- **Navbar 데스크톱 분기점은 lg(1024px)**: 가운데 링크(현 6개)+우측 아이콘·[마이페이지]·[로그아웃]이 768px에서는 안 들어가 라벨이 2줄로 깨짐 → `hidden lg:flex`/`lg:hidden` (기존 md에서 상향)
- **검증**: dev 서버 + 디바이스 모드 320/375/768/1024에서 `document.body.scrollWidth > window.innerWidth`가 false여야 함

### 글꼴 크게 설정까지 같이 봐야 한다 (2026-08-14)

갤럭시에서 "내 공모 화면이 가로모드 아니면 잘리고 스크롤도 안 된다"는 신고. **폭만 줄여서는 재현되지 않았다.**
안드로이드의 **글꼴 크기 크게** 설정(=루트 폰트 배율)을 같이 걸어야 터진다 — rem 기반 텍스트가 통째로 커지면서
`min-width:auto` 인 flex 자식들이 화면을 밀어낸다.

| 조건 | 문서 폭 (뷰포트 360) |
|---|---|
| 기본 | 360 (정상) |
| 글꼴 125% | 360 (정상) |
| **글꼴 150%** | **424 → 64px 넘침** |

범인은 **마이페이지 프로필 카드의 이메일**이었다. `min-w-0` 이 없어 공백 없는 이메일이 카드를 밀어냈고,
프로필 카드는 **모든 탭 공통**이라 내 공모 화면까지 같이 넓어졌다. 문서 폭이 뷰포트를 넘으면 화면이 좌우로
흔들리고 오른쪽이 잘려 보인다 — 가로모드에선 폭이 남아 멀쩡해 보여서 "가로면 괜찮다"가 된다.
같은 원인으로 닉네임 중복확인·사용자 관리·운영 조회의 `flex-1` 입력칸도 넘쳤다(`min-w-0` 누락).

- 검증 스크립트: `e2e/_galaxy.mjs`(폭×글꼴 조합), `e2e/_galaxy2.mjs`(마이페이지 전 탭×역할)
- 320px 미만(갤럭시 폴드 커버화면)은 `max-[320px]:` 로 아바타만 축소 — 일반 폰 모양은 건드리지 않는다
- 남은 것: 관리자/사용자 관리의 역할 셀렉트(`flex-none`), 작가/포트폴리오 16px — 별건

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

- **1547 tests**: Backend 1087 (68 files), Frontend 460 (30 files) — 2026-08-28 기준
- Test DB: `artlink_test`, Backend: supertest, Frontend: jsdom
- Show 테스트: show.test.ts(17), show-extended.test.ts(10), favorite-show.test.ts(4), approval-show.test.ts(4), frontend show.test.ts(11)
- Run: `cd backend && npm test` + `cd frontend && npm test`

### 소스를 훑는 '가드 테스트'

타입도 단위 테스트도 못 잡는 어긋남이 있다 — **주소·라벨이 문자열**이라서다. 그런 자리는 소스를 직접 대조한다.

| 파일 | 무엇을 지키나 | 왜 |
|---|---|---|
| `frontend/…/myPageMenu.test.ts` | 메뉴 정의 ↔ `MyPage.tsx` 분기 양방향 | 메뉴엔 있는데 눌러도 **빈 화면**이 되는 걸 막는다 |
| `frontend/…/retiredApis.test.ts` | 은퇴한 API 호출 · **갠톡 진입점 목록** | 옛 `POST /messages` 를 계속 부르던 [쪽지 보내기]가 **에러 없이** 허공으로 갔다(2026-08-28) |
| `backend/…/notify-links.test.ts` | 알림 링크가 받는 사람에 맞는가 | 작가 링크로 바꾸면 오너가 작가 탭으로 튕겨 아무것도 못 한다 |
| `backend/…/chat-wiring.test.ts` | 승인·수락 라우트가 실제로 단톡을 만드는가 | 세 호출부가 전부 `try{}catch{}` 라 **호출이 빠져도 조용하다** |

### 2026-08-28 추가분

- `chatView.test.ts`(21) — 카톡식 묶음(이름은 첫 줄, 시각은 마지막 줄) · 갠톡 제목 · 시각 표기
- `artworkGridSignature.test.ts`(13) — 작품 격자 재렌더 방지 지문(무관한 편집엔 안 바뀌고, 캡션·시리즈엔 바뀐다)
- `careerColumnsBreakpoint.test.ts`(6) — 경력 열 수가 Tailwind sm/lg 경계와 같은가
- `retiredApis.test.ts`(4) · `chat-wiring.test.ts`(9) · `artlook.test.ts` 확장(15) · `myPageMenu.test.ts` 확장(44)

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
- **마이페이지 메뉴는 전 페이지에 뜨고, 폭에 따라 두 형태**(2026-08-27, artspoon.io 참고. 그쪽은 좌측, 우리는 우측):
  - 정의는 **`lib/myPageMenu.ts` 하나** (`myPageTabs(role)` / `resolveTab` / `myPageHref`). 쓰는 곳 셋이 이걸 공유한다.
  - **lg(1024px)↑ — 전 페이지 우측 세로 사이드바** (`components/layout/MyPageSideMenu.tsx`, `Layout` 이 `<Outlet/>` 옆에 렌더):
    `<aside className="hidden lg:block w-56 shrink-0 border-l">`, 안의 `<nav>`는 `sticky top-24`
    (= 네비바 `h-20` 80px + 16px. **네비바 높이를 바꾸면 여기도 맞출 것**).
    항목은 아이콘+라벨, 선택 항목만 `bg-gray-100` 라운드 채움 + `aria-current="page"`.
    **로그인 시에만** 렌더하고, **강조는 `/mypage` 에서만** — 홈에서 '프로필'이 눌린 것처럼 보이면 현재 위치를 잘못 알려준다.
    ⚠️ `Layout` 의 `<main>` 에 **`min-w-0` 필수** — 없으면 안쪽 표·긴 제목의 min-content 가 폭을 밀어 사이드바를 화면 밖으로 낸다(위 27번).
    ⚠️ sticky 는 부모(`aside`) 높이 안에서만 움직인다. **본문이 메뉴보다 짧으면 여유가 0이라 안 붙는다** —
    버그가 아니다(그 경우 메뉴가 페이지에서 제일 긴 요소라 어차피 화면에 다 들어온다). 실측: 본문 774 > 메뉴 480 → top 96 고정, 본문 480 = 메뉴 480 → 여유 0.
    ⚠️ **MyPage 안에 같은 사이드바를 또 두지 말 것** — 마이페이지에서만 메뉴가 두 개가 된다.
  - **lg↓ — Navbar 우측 상단 [메뉴] 버튼**: 같은 목록이 'MY PAGE' 구분선 아래로 들어간다(`Navbar.tsx`).
    **버튼을 따로 만들지 않는다** — 우측 상단에 햄버거가 둘이면 구분이 안 된다.
  - **lg↓ 마이페이지 본문의 가로 탭바는 유지**: 375px에 224px 사이드바를 붙이면 본문이 150px밖에 안 남고,
    그 화면 안에서 탭을 바꾸는 데는 가로 탭바가 제일 빠르다.
    가로 오버플로 시 우측 페이드 그라데이션(`pointer-events-none`)으로 스크롤 힌트 — Admin 11탭 모바일 대응.
    훅(`tabBarRef` 측정)은 early return(`if (!user)`)보다 위에 선언
  - **작가 메뉴 개편(2026-08-27)**:
    | 메뉴 | 가는 곳 | 내용 |
    |---|---|---|
    | 홈페이지 | `/portfolio/:userId` (바깥 링크, `linkTo`) | 공개 작가 페이지. 마이페이지 탭이 **아니다** |
    | 포트폴리오 | `?tab=portfolio` | PDF 포맷 4종 (`PortfolioFormatSection`) |
    | (숨김) | `?tab=homepage-edit` | 홈페이지 편집 (`PortfolioSection`) — 공개 페이지 [수정] 에서만 |
    - 작가에게 공개 페이지는 '관리 화면'이 아니라 **남에게 보여줄 홈페이지**다. 그래서 메뉴는 편집이 아니라 공개 페이지로 보낸다 —
      고치기 전에 남 눈에 어떻게 보이는지 반드시 한 번 보게 된다.
    - **[수정] → 한 번에 편집 모드**. 그 탭은 진입 즉시 `initForm()` 으로 편집을 연다(읽기 화면을 거치지 않는다).
      ⚠️ `autoEditedRef` 로 **한 번만** — 저장 시 invalidate→재조회마다 걸리면 저장 결과를 못 보고 튕기고 [취소]가 무력해진다.
    - **[수정] 은 주인 본인에게만**. 판정은 `viewer.id === params.userId` 뿐 — 역할(ARTIST)만 보면 **남의 페이지에서도 뜬다**.
    - PDF 포맷은 예전에 편집 화면 **맨 아래**(작품 30장 뒤)에 있어 있는 줄도 모르는 기능이었다.
    - `?tab=homepage` 로 들어와도 열 화면이 없다 → `resolveTab` 은 **`linkTo` 항목 id 를 절대 돌려주지 않는다**.
  - **편집 화면 = 좌우 2단**(lg↑): 왼쪽 입력 **+ 작품 사진 관리(2열)** / 오른쪽 실시간 미리보기(`lg:sticky top-24`). lg↓ 는 아래로 쌓임.
    - ⚠️ 작품 사진 관리를 2단 **바깥**에 두면 거기까지 스크롤한 순간 미리보기가 사라진다(sticky 는 부모 높이 안에서만).
    - ⚠️ 2단 컨테이너에 `items-start` 금지 — 오른쪽 열이 제 내용 높이로 줄어 sticky 여지가 0이 된다(실측 y=800에서 이탈).
    - 미리보기는 편집 영역 끝(2단 구간, 실측 0~6668px)까지 상단 고정. 그 아래 324px(저장바+푸터)에서는 자연히 올라간다.
    - 미리보기와 공개 페이지는 **같은 컴포넌트** `components/shared/HomepageView.tsx` 를 쓴다. 따로 만들면 반드시 어긋나고,
      실제와 다른 미리보기는 볼 이유가 없다. 페이지 껍데기(뒤로가기·[수정]·라이트박스)만 `PortfolioPage` 가 붙인다.
    - 미리보기 경력 열 수는 폭이 절반이라 `careerColumnCount - 1`.
    - ⚡ **작품 격자 memo**: 미리보기는 한 글자 칠 때마다 부모가 다시 렌더된다. 작품 30장을 매번 재조정하면 입력이 밀리므로
      `HomepageView` 가 **내용 지문**(`id|url|title|series|status|caption` + seriesInfo JSON)으로 `useMemo`/`memo` 한다.
      참조가 아니라 내용으로 판단하므로 부모가 데이터 객체를 매번 새로 만들어도 안전하다.
      ⚠️ `onOpenImage` 는 **`useCallback` 필수** — 매 렌더 새 함수면 memo 가 매번 깨진다.
      실측: 10글자 타이핑 후에도 첫 `<img>` DOM 노드가 동일(30→30장).
  - **편집 저장은 하단 고정 저장바**(`sticky bottom-0`, 미저장 시 빨간 안내). ⚠️ **폼 안이 아니라 섹션 맨 끝**에 둘 것 —
    폼 안에 두면 sticky 가 폼 높이에서 끝나 아래 '작품 사진 관리'로 내리는 순간 저장 안 된 변경을 안은 채 사라진다(실측 y=-299).
  - 🔑 **메뉴에 항목을 추가하면 `MyPage.tsx` 의 `currentTab === '...'` 분기도 추가**할 것. 빠뜨리면 역할 폴백에도
    안 걸려(id 가 유효하므로) **에러 없이 빈 화면**이 된다. `__tests__/myPageMenu.test.ts` 가 MyPage.tsx 소스를
    직접 읽어 양방향(분기 누락/죽은 분기)으로 잡는다 — 일부러 깨뜨려 실패하는 것까지 확인했다.
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

### ③ 눌러도 아무것도 안 정해지던 문제 → 홈 ArtWorks (D)
- `GET /api/explore/highlight?limit=8` (인증 불필요) → `{ images, basis }`
  - **정렬 = 전체 좋아요 수 내림차순**. 동점이면 최근 7일 좋아요 많은 순(신선도) → 최신 순.
  - `all`(좋아요 하나라도 있음) / `random`(좋아요 전무, **날짜 시드**로 하루 고정)
  - ⚠️ **정렬 기준은 카드에 찍히는 배지(전체 좋아요 수)와 반드시 같아야 한다.** 처음엔 '최근 7일' 기준으로 정렬하면서 배지는 전체 수를 보여줘 실서비스에서 하트가 `1,1,1,…,3` 순으로 보이는(=하트순이 아닌 것처럼 보이는) 신고가 있었다 — 전체 3개지만 이번 주엔 0개인 작품이 주간 정렬에서 꼴찌로 밀린 것. 회귀 방지 테스트: "화면에 찍히는 하트 수 기준으로 항상 내림차순".
- `GET /api/explore/highlight?seed=N` — **홈 ArtWorks [새로고침]** (2026-08-27). 그 시드로 랜덤 재정렬 + 같은 작가 연속 방지.
  - 둘러보기(`/explore`)의 새로고침과 **같은 함수**(`shuffleNoAdjacent`)를 쓴다 — 두 화면에서 누른 느낌이 같아야 한다.
  - seed가 있으면 좋아요 집계 쿼리 2개를 **건너뛴다**. 연타되는 버튼이라 매번 전체 집계를 돌릴 이유가 없다. `basis`는 `random`.
  - `seed=0`·문자·빈값은 seed 없음으로 취급(좋아요순 유지), 음수는 절대값 — Explore 피드와 동일.
### 경력 배치 — `lib/careerColumns.ts` (2026-08-27)
공개 작가 페이지와 마이페이지 읽기 뷰가 함께 쓴다. 열 수는 `hooks/useCareerColumns`(sm 640 / lg 1024 — Tailwind 와 같은 경계).
- **grid 를 쓰면 안 된다**: 한 **행**의 높이가 그 행에서 제일 긴 칸에 맞춰진다. 실제 데이터가 단체전 20줄 / 개인전·아트페어 3줄이라
  '수상 및 선정'이 개인전에서 한참 떨어져 보였다. `items-start` 는 칸 안에서 위로 붙일 뿐 **행 높이를 못 줄인다**.
- **CSS columns 도 아니다**: 브라우저가 알아서 세로로 채워 어느 항목이 어느 열에 갈지 예측이 안 된다(예전에 개인전+단체전이 한 열에 몰렸다).
- **항목의 줄 수를 무게로 주고, 그때그때 제일 짧은 열에 담는다.** 단순 라운드로빈(i%n)은 2열에서 무너진다 —
  열0=[학력,단체전,수상](26줄) / 열1=[개인전,아트페어](6줄) 이 되어 수상이 1180px 밀리고 오른쪽이 텅 빈다.
- 실측(작가A 데이터, 수상↔개인전 세로 간격): 3열 227px · 2열 509px(개선 전 1180px) · 1열은 단일 열이라 해당 없음.
- **항목 이름은 내용보다 크게**: 이름 `text-sm font-semibold text-gray-900` + 밑줄 / 내용 `text-[13px] text-gray-600`.
  예전엔 이름 12px 회색 · 내용 14px 이라 **이름이 더 작아** 한 열에 두 덩어리가 들어가면 경계가 안 읽혔다.

- `components/home/ArtWorks.tsx` (구 `ExploreHighlight`) — **HomePage 최상단**(2026-08-27 개편 전에는 GalleryOfMonth 아래였다).
  - 제목은 ArtLink 로고와 같은 색 규칙 `Art` + `Works`(#dc3545), 크기는 **로고보다 작게**(20/24px vs 로고 30/36px) — 회사 이름이 섹션 제목에 눌리면 안 된다. **부제는 없다.**
  - **첫 진입부터 랜덤**이다 — 마운트마다 새 시드(`newSeed()`, 1 이상)를 만들어 `?seed=N`으로 부른다.
    좋아요순 고정은 홈에 늘 같은 작품만 걸려 좋아요가 적은 작가가 영영 노출되지 않는 문제가 있었다.
    ⚠️ 그 대가로 "좋아요 → 홈 노출"이라는 참여 동기(위 ③의 원래 설계)는 없어졌다. 되돌리려면 프론트에서 seed만 빼면 서버는 그대로 좋아요순을 준다.
  - 우측 상단 [⟳ 새로고침] · [모두 모아보기 →]. **둘러보기의 유일한 진입점**이다(Navbar 메뉴에서 뺐다).
    색은 `text-gray-500` 이 하한 — gray-300/400 은 흰 배경에서 안 보인다(실사용 지적). 현재 대비 4.84:1.
  - 재정렬 중 `placeholderData: prev => prev` 필수 — 없으면 `images.length === 0 → null` 때문에 섹션이 사라졌다 나타나며 홈이 위로 튄다.

### 갤러리 스카우팅 + 공모 초대 (E)
> ⚠️ **2026-08-28 개편** — 아래 '비공개 스크랩' 설계는 **하트(좋아요)로 통합**됐다. 갤러리도 하트로 작품을 모으고,
> 그 작가에게 초대를 보낸다. 스크랩과 달리 **하트는 작가에게 보인다**("관심을 숨길 이유가 없다"). 백엔드 스크랩
> 모델·라우트·테스트는 **그대로 남겨 두되 화면에서만 뗐다**(`ArtworkDetailModal` 북마크 버튼 삭제, [관심 작품] 탭은 `/explore/my-likes`).

원래 설계(참고 — 백엔드는 유효):

| | 공개 | 작가 알림 | 용도 |
|---|---|---|---|
| 하트(좋아요) | 공개 | O | 응원 → (지금은) 스카우팅도 겸함 |
| 🔖 스크랩 | **비공개** | X | 스카우팅 메모 (UI 미사용) |

- **모델 2개(순수 추가)**: `ArtworkScrap`(userId+imageId unique, memo), `ExhibitionInvite`(exhibitionId+artistId unique, status SENT/APPLIED/DECLINED)
- **API**: `POST /explore/:imageId/scrap`(토글) · `GET /explore/scraps` · `PATCH /explore/scraps/:id`(메모) · `POST /exhibitions/:id/invite` · `GET /exhibitions/:id/invites` · `GET /exhibitions/invites/received` · `PATCH /exhibitions/invites/:id`(숨김)
- **초대는 알림일 뿐 자동 지원이 아니다** — 공모마다 커스텀 질문이 다르므로 작가가 직접 지원해야 한다(단, 초대 수락 = 바로 참가 경로는 별도, `POST /invites/:id/accept`).
- **초대 방어**: 소유 갤러리만 / `APPROVED` + 모집중(`recruitmentClosed·confirmed·ended` 아님) + 마감 전(KST) / 이미 지원한 작가 400 / 중복 초대 409 / 탈퇴·비ARTIST 404 / **공모당 100명·계정당 하루 50명 상한**
- **초대 진입 2방향**(2026-08-28): 작가 고정+공모 선택(`InviteModal` — 작품 모달·관심 작품 탭), 공모 고정+작가 선택(`ExhibitionInviteModal` — 내 공모 지원자 관리 패널, 대상은 하트 저장 작가). UI: ExplorePage/홈 모달, MyPage GALLERY **"관심 작품"**(=하트 보드), MyPage ARTIST **[내 전시] 초대받은 전시 탭**.

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

### 타임아웃은 '총 시간'이 아니라 '무응답'으로 판정
총 시간으로 자르면 **죽은 요청과 느린 요청을 구분하지 못한다.** 작품 이미지가 평균 1MB(실측: 중앙 1042KB)라 1Mbps 회선에선 정상 다운로드도 8초가 걸린다 — 짧은 총 시간 제한은 멀쩡한 다운로드를 끊는다. 이어받기가 없어 재시도는 0부터 다시 받으므로, 느린 회선에서 '짧은 타임아웃 + 재시도'는 순손해다.
  - 첫 응답(헤더)까지 **10초** / 이후 **무응답 15초**(청크가 올 때마다 리셋) / 이미지 1장 총 예산 **90초**
  - 재시도는 **retryable(연결오류·5xx·429)에만**. `fatal`(404·비이미지)과 `slow`(타임아웃)는 재시도해도 결과가 같아 시간만 3배가 된다
  - 결과: 죽은 이미지 판정이 75초 → 최대 ~20초로 줄고, **느리지만 살아 있는 다운로드는 오히려 성공률이 올라간다**

### 실패 시 사용자 안내
- 작품 원본 ZIP: 실패 건수 + 작품명(최대 5건 + "외 N건")
- **전체 PDF ZIP**: `prefetchImages`가 못 받은 URL을 반환 → 작가·작품명으로 변환해 `(이미지 N개 누락)` + 목록 안내. 예전엔 실패를 삼켜 **PDF에 이미지가 빈 채로 나가도 알 수 없었다**(2026-08-04 지적).

### 진행률 표시 위치 — 토스트가 아니라 **버튼**
"N장째 불러오는 중"이 **사라졌다 생겼다** 한다는 신고(2026-08-04). 토스트는 성격상 사라질 수 있어 장시간 작업의 진행률을 담기에 부적합하다.
→ 진행률은 **버튼 라벨**(`이미지 12/60장`)로 옮겼다. 작업이 끝날 때까지 유지되고 끝나면 원래 라벨로 돌아온다. 토스트는 시작/완료/실패 안내만 담당.
부수적으로 전역 `toastOptions.duration`이 **로딩 토스트의 기본값(Infinity)까지 덮어쓰는** 문제도 확인해 `loading: { duration: Infinity }`로 분리했다(`lib/toastOptions.ts`).
⚠️ 로컬에서 토스트가 사라지는 현상 자체는 재현하지 못했다(갱신 간격 4초로 벌려도 유지). 그래서 duration 수정은 방어적 조치이고, **실질 해결은 버튼 인라인 표시**다.

### 검증
- `frontend/src/__tests__/imageFetch.test.ts` 14개 — 동시성 상한·순서 보존·진행률, 직접→폴백→재시도, **캐시 공유(같은 URL 네트워크 1회)**, 확장자 판정, 비이미지 거부
- `backend/src/__tests__/upload-proxy-stream.test.ts` 5개 — 스트리밍 후에도 바이트 무손실·보안 헤더·SSRF/리다이렉트/MIME 차단 유지
- E2E `e2e/tests/27-operation-zip.spec.ts` 3개 — 실제 R2 이미지로 ZIP·PDF 다운로드 발생, 진행률 문구, **실패 시 작품명 안내**
- ⚠️ E2E에서 갤러리 소유 갤러리는 `ownedGalleryId()`로 찾을 것. 목록에서 아무 승인 갤러리나 집으면 **다른 갤러리 계정 소유**라 403이 난다(스펙 26 F4가 별도 갤러리 계정을 만든다).

## 일괄 다운로드 — "하나라도 빠지면 안 된다" (2026-08-04)

**지적**: 전체 다운로드에서 이미지 하나가 빠지면 그대로 넘어가는 게 문제다. "될 때까지 해야 하는 것 아니냐 — 다만 무작정 기다리게 하는 건 아니고."

이 둘은 충돌한다. 무한 재시도는 "안 끝나는" 그 사고로 되돌아가고, 한 번 실패에 포기하면 조용히 빠진다. 그래서 **3겹**으로 나눴다.

| 겹 | 무엇 | 어디 | 대기 |
|---|---|---|---|
| ① 자동 회수 | 배치가 끝난 뒤 **실패분만** 다시 (최대 2라운드, 백오프 1.5s→4s) | `imageFetch.ts` `recoverFailed()` | 전체 **45초 예산** 상한 |
| ② 수동 재시도 | 사라지지 않는 **배너 + [다시 받기]** | `components/shared/MissingImagesBanner.tsx` | 사용자가 원할 때만 |
| ③ 자기기록 | ZIP 안에 `_받지못한작품.txt` | `operationPdf.ts` `missingNote()` | — |

### ① 왜 "배치 후" 재시도는 배치 중 재시도와 다른가
배치 도중엔 동시 5장이 회선을 나눠 쓰고 서버도 같은 순간 몰린 요청을 처리한다. **배치가 끝나면 그 경쟁이 사라져 같은 요청도 성공할 여지가 생긴다.** 그래서 배치 중엔 재시도하지 않던 `slow`(타임아웃)까지 여기서는 대상에 넣는다. 상한이 두 개(라운드 수 + 시간 예산)라 "무작정"이 되지 않는다.

### ⚠️ 전제 조건 — 실패는 캐시에 남기지 않는다
`fetchImage`가 **실패한 약속(null)까지 캐시에 영구 보관**하고 있었다. 이 상태로는 [다시 받기]를 눌러도 캐시가 즉시 null을 돌려주며 **네트워크를 아예 타지 않는다** — 재시도 기능 자체가 무력화된다. 진행 중일 때만 공유하고(중복 요청 방지) 실패로 끝나면 즉시 비운다. 성공은 계속 캐시하므로 **재시도가 이미 받은 것까지 다시 받지는 않는다**(그래서 다시 받기가 빠르다).

### ZIP 구조 — 작가별 폴더 (2026-08-04)
전체 다운로드는 파일이 평평하게 쏟아져 작가가 여럿이면 정리가 안 됐다. **작가명 폴더**로 나눈다.

```
공모명_작품원본.zip              공모명_전체제출물.zip
  ├ 한도윤/                        ├ 한도윤/
  │   └ 한도윤_작품A_50x50_….jpg   │   ├ 공모명_한도윤_출품리스트.pdf
  └ 이서준/                        │   ├ 공모명_한도윤_작가약력.pdf
      └ …                          │   └ 공모명_한도윤_작가노트.pdf
                                   └ 이서준/ …
  _받지못한작품.txt (있을 때만, 최상단)
```

- **폴더에 작가명이 있어도 파일명에 그대로 둔다.** 파일을 폴더 밖으로 꺼내 인쇄소·디자이너에게 넘기거나 메일로 보내는 일이 잦은데, 그때 이름이 없으면 어느 작가 것인지 알 수 없다.
- ⚠️ **동명이인은 폴더를 분리한다**(`artistFolderNames()` → `김민수`, `김민수 (2)`). 합치면 갤러리가 서로 다른 작가의 작품을 섞어버리는데, **파일이 사라지지 않아 눈치채기도 어렵다.**
- 이름 중복 검사(`_2`, `_3`)는 **폴더별**로 한다 — 다른 작가 폴더의 같은 파일명은 충돌이 아니다.
- 누락 메모는 작가를 가로지르는 정보라 **최상단**에 둔다.
- 지원서 ZIP은 지원자당 PDF가 1개라 폴더를 만들지 않는다(폴더당 파일 1개는 의미 없음).

### ③ 왜 파일에까지 남기나
화면 안내는 페이지를 닫으면 사라진다. 작품이 하나 빠졌는데 안내마저 사라지면 **빠진 사실 자체를** 모른다. ZIP 안 메모는 화면과 달리 목록을 **자르지 않는다**(화면은 3건까지만 보여줌).

### 개별 PDF 경로도 선수집 적용 (그동안 누락돼 있던 부분)
`prefetchImages`가 "전체 제출물 ZIP" 한 곳에서만 호출되고 있었다. 나머지는 `<img src>`가 전부 백엔드 프록시를 타 **바로 그 성능 사고와 같은 구조**였다. 전부 `prefetchForPdf()`(선수집 + 자동 회수 + 누락 목록 반환)를 거치게 했다.

| 경로 | 이미지 규모 | 반환 |
|---|---|---|
| 작가별/전체 정산서 | 판매작 수 | `{ missing: string[] }` |
| 지원서 1건 | 작가당 최대 30장 | `{ missing: number }` |
| 전체 지원서 ZIP | 지원자 × 30장 (**가장 큼**) | `{ count, missing: string[] }` |

### ⚠️ 이 작업 중 발견 — 직접 경로가 조용히 죽어 있었다 (브라우저 캐시 CORS 오염)
정산서 PDF E2E를 붙이자 **프록시 요청이 6건** 나왔다(선수집을 넣었으니 0이어야 한다). 추적 결과:

1. 운영 페이지가 같은 이미지를 먼저 평범한 `<img src>`(**`crossorigin` 없음**)로 그린다 → 브라우저 HTTP 캐시에 **CORS 정보 없는 항목**이 남는다.
2. 곧이어 ZIP/PDF가 같은 URL을 **CORS 모드 `fetch`** 로 요청 → 브라우저가 그 캐시 항목을 재사용하며 `has been blocked by CORS policy`로 **차단**한다. 서버 응답 헤더는 정상이다(`curl`로 확인: `Access-Control-Allow-Origin: http://localhost:5173` 정상 반환).
3. 직접 경로가 죽고 **조용히 프록시로 되돌아간다** — 우리가 없앤 바로 그 느린 구조.

> 화면에 썸네일이 이미 떠 있는 상태에서 다운로드를 누르면 재현된다. 목록이 접혀 있으면(썸네일 미렌더) 재현되지 않아, 앞선 실측에서 드러나지 않았다.

**해결**: R2 직접 요청에만 `cache: 'reload'`. 캐시를 건너뛰고 네트워크에서 새로 받아 오염된 항목을 피한다. 검증: 프록시 요청 **6건 → 0건**.
- `crossOrigin="anonymous"`를 화면 `<img>`에 다는 방법도 있지만, R2 CORS 허용목록에 없는 출처에서는 **이미지가 아예 안 보이게** 되어 위험이 더 크다. 다운로드 경로만 고치는 쪽을 택했다.
- `cache: 'force-cache'`를 제거하는 것만으로는 **해결되지 않는다**(실측). 브라우저는 캐시 옵션과 무관하게 그 항목을 재사용한다.

`imageSrc`의 캐시 미스는 **프록시 유지**(R2 직접으로 바꾸지 않음). 이제 모든 경로가 선수집을 하므로 여기까지 오는 건 선수집이 실패한 이미지뿐인데, 브라우저에서 실패한 주소를 브라우저로 다시 요청해봐야 결과가 같다. **프록시는 서버가 대신 받아오는 다른 경로**라 오히려 성공할 여지가 있다.

### 검증
- `frontend/src/__tests__/imageFetch.test.ts` 26개(+7) — 실패 캐시 무효화, 회수 성공/실패/예산초과/라운드 진행률
- `frontend/src/__tests__/operationZip.test.ts` 10개 — 누락 메모(목록을 자르지 않는지), **작가 폴더 동명이인 분리·경로구분자 제거**
- E2E `e2e/tests/28-download-recovery.spec.ts` 6개 — 자동 회수, 배너 지속(토스트 소멸 시간 경과 후에도), ZIP 자기기록, **작가 2명 → 폴더 2개**, **정산서·지원서 PDF(그동안 커버리지 0)**

## R2 이미지 도메인 전환 — 개발용 URL → 커스텀 도메인 (2026-08-04)

### 배경
모든 이미지 주소가 Cloudflare의 **Public Development URL**(`pub-<hash>.r2.dev`)이었다. 이름 그대로 **개발용**이라 Cloudflare가 속도 제한을 걸어두며, 캐싱도 프로덕션 수준이 아니다. 프로덕션 트래픽을 여기에 태우면 안 된다. → 커스텀 도메인 `img.artlink.cc`로 옮긴다.

### 전환기의 함정 — `R2_PUBLIC_URL`을 그냥 바꾸면 두 곳이 조용히 깨진다
DB에 **이미 저장된 이미지 주소는 전부 옛 도메인**이다(실측: 표본 69/69). 그런데 `R2_PUBLIC_URL`은 단순 접두사 비교로 3곳에서 쓰인다.

| 위치 | 그냥 바꾸면 |
|---|---|
| `routes/upload.ts` 업로드 URL 생성 | (정상 — 새 주소로 저장) |
| `routes/upload.ts` `image-proxy` SSRF 허용검사 | 옛 주소가 **400**으로 막혀 R2 직접 수신이 실패했을 때의 **폴백이 죽는다** |
| `lib/storage.ts` `deleteUploadedFile` | 옛 주소를 "우리 것"으로 못 알아봐 **에러 없이 조용히** 건너뛴다 → R2에 고아 파일이 계속 쌓인다 |

### 해결 — `lib/r2Urls.ts` (공개 주소를 목록으로)
`R2_PUBLIC_URL`에 **쉼표로 여러 개**를 넣을 수 있게 했다.

```
R2_PUBLIC_URL="https://img.artlink.cc,https://pub-xxxx.r2.dev"
                 └ 첫 번째 = 신규 업로드에 쓸 정식 주소
                 └ 전체    = 프록시 허용·파일 삭제 시 "우리 것"으로 인정
```

- `r2CanonicalBase()` — 업로드 URL 생성 (`upload.ts`)
- `matchR2Base(url)` — 일치하면 그때 쓴 base를 반환(키 추출에 필요). 프록시 허용검사·파일 삭제가 공유
- 값이 하나면 예전과 **완전히 동일하게 동작**(하위호환)

**SSRF 방어는 그대로**: 호스트네임 정확 일치 + 동일 프로토콜 + 경로 접두사(`base + '/'`) 3중 검사. `evil.com/?x=https://img.artlink.cc/a.jpg`, `img.artlink.cc.evil.com` 같은 우회는 여전히 차단.

### 적용 순서 (반드시 지킬 것)
1. **먼저 배포** — 위 코드(두 도메인 허용)를 올린다.
2. **그 다음** Render 환경변수 `R2_PUBLIC_URL`을 `https://img.artlink.cc,https://pub-xxxx.r2.dev`로 변경.
   순서를 바꾸면 배포 전까지 옛 이미지의 프록시 폴백이 400으로 막힌다.
3. 옛 주소는 **지우지 않는다**. DB에 남아 있는 한 계속 목록에 둬야 삭제·폴백이 동작한다.

> R2 CORS 정책은 **버킷 단위**라 커스텀 도메인에도 그대로 적용된다(별도 설정 불필요). 실측: `img.artlink.cc` 200 + `access-control-allow-origin: https://artlink.cc`, 응답 0.345s(옛 도메인 0.312s와 동등, 캐싱 켜기 전 기준).

### 검증
- `backend/src/__tests__/r2-urls.test.ts` 12개 — 단일/다중 도메인, 정식 주소 선택, 키 추출, SSRF 우회 6종 차단
- `backend/src/__tests__/storage-delete.test.ts` 4개 — 신·구 도메인 삭제, 폴더 키 보존, 남의 도메인 무시
- `backend/src/__tests__/upload-proxy-stream.test.ts` +3개 — 라우트에서 두 도메인 모두 중계, 화이트리스트 밖은 400

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

## 작가 포트폴리오 포맷 (2026-08-10)

실제 작가 5명의 포트폴리오 PDF를 기준으로 삼아, 우리 포트폴리오가 무엇이 부족했는지 정리하고 포맷 4종을 만들었다.

### 무엇이 문제였나 (레퍼런스 대비)

| 레퍼런스 5종의 공통 문법 | 기존 ArtLink |
|---|---|
| 작품마다 **[제목 / 재료 / 크기 / 제작연도]** 캡션 (5/5) | `PortfolioImage = {url, order}` — 정보가 아예 없음 |
| 작품을 **자르지 않음**. 중립 배경에 원본 비율 (5/5) | `aspect-square object-cover` — 회화를 정사각으로 크롭 |
| **시리즈 단위** 구성 + 시리즈별 설명 (4/5) | 30장 평면 나열 |
| **작가노트(ARTIST STATEMENT)** 전용 페이지 (5/5) | 약력만 있음 (정작 제출 플로우엔 작가노트가 있었다) |
| **표지 + 연락처 페이지**로 시작·마무리 (5/5) | 없음 |
| 학력·수상까지 담은 CV (5/5) | 경력 = 아트페어/개인전/단체전 3종 |

### 데이터 (migration `20260810135150_add_portfolio_artwork_meta`)

- `PortfolioImage` + `title` `medium` `sizeText` `year` `series` `description` `status`(AVAILABLE/SOLD/NFS)
- `Portfolio` + `statement`(작가노트) `tagline`(한 줄 소개) `themeId`(고른 포맷) `seriesInfo`(JSON `[{name,note}]`)
- `career` JSON에 `education` `award` 선택 항목 추가 — **기존 JSON엔 없으므로 항상 `normalizeCareer()`로 통과**시킬 것

### 포맷 4종 (`frontend/src/lib/portfolioFormats.ts`)

| id | 이름 | 판형 | 작품/쪽 | 성격 |
|---|---|---|---|---|
| `gallery` | 포맷 A | 16:9 (1600×900 → 297×167mm) | 2 | 아이보리 + 명조, 무장식 |
| `studio` | 포맷 B | A4 가로 (1414×1000) | 3 | 차콜/오렌지, 큰 시리즈 제목 + 그리드 + 하단 러닝 푸터 |
| `story` | 포맷 C | A4 가로 | 1 | 좌 작품 / 우 이야기, 매 장 하단 연락처 |
| `archive` | 포맷 D | A4 세로 (1000×1414) | 2 | 인쇄·공모 첨부용 정통 문서 |

페이지 순서(공통): 표지 → 작가노트 → [시리즈 소개 → 작품…]× → CV → 연락처

### 엔진이 `operationPdf.htmlToPdfBlob`과 다른 점

`htmlToPdfBlob`은 **긴 세로 문서 한 장**을 렌더해 잘라내므로 페이지마다 다른 레이아웃을 줄 수 없다.
포맷 엔진은 반대로 **페이지 하나 = 판형 크기 HTML 하나**를 렌더해 1:1로 넣는다(`renderPagesToPdf`).
덕분에 표지·시리즈 표지·작품 페이지가 각기 다른 구성을 갖고, **미리보기 화면이 같은 HTML을 축소해 보여주므로
미리보기와 PDF가 구조적으로 어긋날 수 없다**(`PortfolioFormatPicker`).

배율은 판형 폭 기준 240dpi를 목표로 자동 계산한다(`scale = min(2.4, mm/25.4*240 / px)`).
실측: 작품 9점 + 전시전경 2장 기준 13~18쪽, 5~8MB, 7~10초.

### 페이지 레이아웃에서 주의할 점

- **`PAD` 상수에서만 여백을 읽을 것.** 페이지별로 손으로 숫자를 적었더니 아카이브에서 머리말과 작품이 겹치고,
  스토리 전시전경이 하단 연락처 줄을 뚫고 나갔다. `availH()` / `captionH()`로 이미지 높이를 계산한다.
- **대각선은 `transform` 대신 `linear-gradient`로.** html2canvas가 transform을 항상 정확히 재현하지는 않는다.
  기울어진 배너는 `linear-gradient(100deg, transparent 0 3%, accent 3% 97%, transparent 97%)` 형태.
- **글꼴 대기 필수** — `await document.fonts.ready` 없이 렌더하면 표지 큰 글씨가 폴백 글꼴로 찍힌다.
  명조(Nanum Myeongjo)는 `frontend/index.html`에서 로드한다.
- **작품 이미지는 반드시 prefetch 후 렌더** — 안 하면 페이지 수만큼 프록시 요청이 붙는다(`operationPdf` 주석 참고).
- **작품은 절대 자르거나 늘리지 않는다.** 회화에서 비율은 작품 그 자체다. `img()` 헬퍼가 `object-fit:contain`을
  강제로 덧붙이므로 호출부가 `cover`를 적어도 무시된다. 크기는 `max-width`/`max-height`로만 준다.
  표지를 꾸미려고 `cover`로 깔았다가 그림이 잘린 적이 있어(포맷 A·C 표지) 회귀 방지 테스트를 뒀다
  (`portfolioFormats.test.ts` — 전 포맷 전 페이지 HTML에 cover/fill 및 img의 width/height가 없어야 통과).
- **높이 추정은 실측과 맞춘다 — 넘치면 조용히 잘린다** (2026-08-16 전수조사).
  페이지가 고정 크기 + `overflow:hidden` 이라 추정이 실제보다 작으면 **에러 없이 내용이 사라진다**.
  실서버 복제본의 전 작가 × 4포맷을 브라우저에 그려 재보니 17장이 넘쳤고, 원인이 넷이었다.
  - **약력 높이가 줄바꿈을 안 셌다** — 화면엔 `\n`이 `<br/>`로 나가는데 글자 수만 폭으로 나눠 줄 수를 잡아
    90~136px 모자랐다(4개 포맷 전부). 글 페이지가 쓰는 `estimateParaH` 와 같은 규칙으로 통일.
  - **긴 약력을 나눌 데가 없었다** — 약력만 600px 넘는 작가가 있다. 첫 장에 경력 칸이 200px도 안 남으면
    약력을 `prosePages` 로 빼고 경력은 다음 장부터 시작한다.
  - **경력이 0건이면 CV 페이지가 아예 안 생겨 약력이 통째로 사라졌다** — `sections` 가 비어도 약력이 있으면 한 장을 만든다.
  - **`captionH` 가 상수(104)였다** — 캡션 줄 수는 작품마다 다르다(실측 0줄 45 / 1줄 70 / 2줄 94 / 3줄 119).
    포맷 D는 한 장에 2점을 세로로 쌓아 오차가 두 배가 됐다. 지금은 `captionH(theme, items)` 로 그 장의 작품에서 계산.
  - `splitParagraphs` 의 조각내기도 줄바꿈을 세도록 고쳤다(`takeLines`). 빈 줄 없이 줄바꿈만 22번 쓴 약력에서
    조각의 실제 줄 수가 예산을 넘겼다. 추정치엔 `SAFETY`(24px) 쿠션을 둔다.
  - 회귀: `portfolioFormats.test.ts`(순수 함수·문자열) + **`scratchpad/pf/`(브라우저 실측 하니스, 2026-08-31 재구축)**.
    ⚠️ vitest 는 jsdom 이라 레이아웃을 못 잰다 — 넘침·작품 크기·렌더 색 대비·PDF 저장 성패는 하니스 몫이다.

#### 2026-08-31 실측 감사에서 고친 것 (`scratchpad/pf/` README 에 수치)

| | 전 | 후 |
|---|---|---|
| PDF 가 나오는 표지×작품 조합 | **16/126 (13%)** | 126/126 |
| 작품설명 2줄 예약 초과 | 216건 (최대 60px / 예약 42px) | 0건 |
| 대비 미달 조합 | 216/216 (최저 2.76:1) | 0/216 |
| 구분선 대비(어두운 배경) | 1.03:1 | 1.51:1 |
| 작품 지면점유 `grid`@와이드 | 4.2% | 10.3% |
| 작품 지면점유 `hero`@와이드 | 17.6% | 24.5% |
| 넘침 | 0 | 0 (유지) |

**실데이터로 본 것** (`artlink_prod` 복제본, 작품 372점) — 지금까지 수치로만 판정하고 렌더를 본 적이 없었다.

- **작품 372점 중 361점(97%)이 제목·재료·크기·연도가 전부 비어 있다.** `artworkTitle()` 이 '무제' 를
  돌려주므로 26점짜리 포트폴리오가 **26쪽 내내 '무제'** 한 단어만 달고 나왔다. 공개 홈페이지는 이미
  `hasTitle()` 로 걸러 왔는데 PDF 만 안 걸렀다 → `captionParts()` 로 통일, 캡션이 비면 자리도 예약하지 않는다.
- **`hero` 의 이미지 상자가 `height` 고정이라** 정사각 작품이 상자 안에서 뜨고 캡션이 145~185px 떨어졌다
  → `max-height` 로 바꿔 작품+캡션이 한 덩어리로 앉는다.
- **표지 `bandTop`(기본값) 하단 28.7% 가 비어 있었다** — 사진 높이를 `h*0.5` 로 못박고 글을 그 아래 붙였는데,
  그 자리를 메울 한 줄 소개를 채운 작가가 **81명 중 0명**이라 전원이 그 표지를 받았다 → 위아래를 잡은
  flex 기둥으로 바꿔 사진이 남는 높이를 가져간다(7.1/8.5 대칭). ⚠️ 21종 전수 측정에서 비대칭인 건 이것 하나 —
  `serifCenter`·`nameplate`·`accentField` 는 위아래가 같이 비는 **가운데 정렬**이라 의도된 구성이다.
- **`label`(뮤지엄 라벨)은 적을 게 없으면 `hero` 로 전환** — 캡션 칸이 지면 44% 인데 97% 는 넣을 게 없었다.
- 결과(실데이터 4명, A4 세로 `hero`): 골든 42.2% 대비 **93~117%**. 실데이터 4명 PDF 생성 전부 성공.

- **`color-mix()` 가 PDF 를 죽이고 있었다** — 크롬 계산값 `color(srgb …)` 를 html2canvas 1.4.1 이
  파싱하다 던진다. `softPanel()` 하나 때문에 표지 13/21 · 작품 4/6 이 걸려 **기본값 포함 87% 조합에서
  PDF 가 안 나왔다**. PPTX 는 `hexOf()` 가 null 을 돌려 배경 도형이 조용히 빠졌다. → `mixHex()` 로 hex 고정.
- **여백이 판형에 안 따라갔다** — A4 세로 기준 픽셀 상수를 전 판형에 써서 와이드에서 상하 여백이 24.9%.
  `PAD_RATIO` + `runTop()` 으로 비례화(그 판형에서는 기존 값 그대로 재현).
- **파생 색을 아무도 안 쟀다** — `sub`(캡션·설명·CV 라벨·연락처)가 최선 조합에서도 3.90:1.
  `towardBg()` 가 대비를 만족하는 가장 물린 값을 찾는다. 강조색 추천 기준 3.0 → 4.5.
- **죽은 코드 82줄** — `paragraphs`/`studioSeriesHead`/`fullDescWork` 는 호출부가 0이었고,
  `captionHtml` 의 `worksPerPage === 3` 분기는 `WORKS_PER_PAGE` 가 1·2·4·6 만 내므로 도달 불가였다.
- **전시 전경(설치 사진) 기능은 두지 않는다.** 2026-08-11 철회 — 작품/전시전경 분류 입력이 작가에게 부담이었고
  포트폴리오 본문과 겹쳤다. `PortfolioImage.category`는 migration `20260811001500_remove_portfolio_image_category`로 제거.
- **시리즈 제목은 페이지 '내용'이 그린다(머리말 장식이 아니다).** 스튜디오에서 시리즈명을 상단 배너 장식에
  넣어뒀더니, 시리즈를 쓰지 않는 작가에게 **내용 없는 빈 띠**만 남았다. 지금은 `worksHtml`이 직접 그리고
  시리즈가 없으면 아예 그리지 않는다. 같은 시리즈가 여러 장 이어지면 첫 장만 큰 제목, 이후는 축약형.

### 공용 순수 함수 (`frontend/src/lib/artwork.ts`)

캡션 조립(`captionInline`/`captionLines` — **있는 항목만** 이어붙임), 시리즈 그룹핑(`groupBySeries` — 미지정 묶음은 맨 뒤),
크기 합성(`composeSize`/`splitSize` — 운영페이지 출품리스트와 공용), 경력 정규화(`normalizeCareer`).
`normalizeCareer`는 MyPage/PortfolioPage/ExhibitionDetailPage/ApplicationContent 4곳에 복붙돼 있던 것을 여기로 합쳤다.

## 아트링크(Admin) 주최 공모 · 운영 갤러리 위임 (2026-08-14)

Admin 계정이 직접 공모를 **주최**하고, 지정한 **여러 갤러리**에게 실제 운영을 맡기는 기능.

### 데이터 모델

| | 설명 |
|---|---|
| `Exhibition.hostType` | `'GALLERY'`(기본, 기존 전부) \| `'ADMIN'`(아트링크 주최) |
| `ExhibitionManager` | `(exhibitionId, galleryId)` 유니크. **아트링크 주최 공모에서만** 의미가 있다 |

마이그레이션: `20260814120000_add_admin_hosted_exhibition`

### `galleryId`는 왜 그대로 두었나

목록 카드의 갤러리명, 지원 통계(`galleryApplicationStats`), 정산, SEO, 찜, 메시지 그룹핑 등
**기존 코드 79곳**이 "공모에는 갤러리 1곳이 붙어 있다"를 전제로 한다. nullable로 바꾸면 프론트까지 전부 손봐야 한다.
그래서 아트링크 주최 공모도 **주관 갤러리 1곳을 반드시 지정**하고(선택 목록의 첫 번째),
그 갤러리는 운영 갤러리 목록에도 함께 들어간다. 화면에서는 `hostType`을 보고 "아트링크 주최" 배지를 붙인다.

### 권한 판정 — `backend/src/lib/exhibitionAccess.ts` 한 곳

```
canOperateExhibition(ex, userId)   주관 갤러리 오너 || (hostType==='ADMIN' && 위임 갤러리 오너)
operableExhibitionWhere(ownerId)   목록 조회용 where 절
assertCanManageExhibition(id, u)   단건 조회 + 403 (Admin 은 항상 통과)
operatorUserIds(ex)                알림 발송 대상 전부
```

⚠️ **위임은 `hostType === 'ADMIN'` 일 때만 인정한다.** 갤러리가 등록한 공모에 `ExhibitionManager` 행이
어떤 경로로든 섞여 들어가도 권한을 주지 않는다 — 뚫리면 **남의 공모 지원자 개인정보가 통째로** 열린다.
데이터(행을 만들지 않음)와 코드(hostType 먼저 확인) 양쪽에서 막고, 회귀 테스트로 고정했다.

적용 지점: `exhibition.ts`(내 공모/운영 대시보드/지원자 조회·상태변경/초대/소개·추가질문 수정/홍보사진/사진관리),
`operation.ts`(`getAccess` — 공지·제출자료·캡션·확정·정산 전부가 여기를 지난다), `message.ts`(지원자 쪽지).

### 갤러리 주최와 다른 점

| | 갤러리 주최 | 아트링크 주최 |
|---|---|---|
| 등록 | `POST /exhibitions` (GALLERY) | `POST /exhibitions/hosted` (ADMIN) |
| 승인 | `PENDING` → Admin 승인 필요 | **`APPROVED` 즉시 게시** (주최자가 관리자) |
| 운영 | 오너 1명 | 지정된 갤러리 전부 |
| 삭제 | 오너 또는 Admin | **Admin만** (갤러리는 운영만 위임받았다) |

추가 API: `GET /exhibitions/hosted`(목록), `PATCH /exhibitions/:id/managers`(운영 갤러리 전체 교체 — 첫 번째가 새 주관).

### Admin 도 지원자 관리를 한다 (2026-08-14)

`authorize('GALLERY')` 가 ADMIN 을 걸러내는 바람에 관리자가 **지원자 수락/거절을 못 했다**.
운영 페이지·승인·삭제는 이미 다 열려 있었는데 이 한 줄 때문에 막혀 있던 것. 다음 라우트를
`authorize('GALLERY', 'ADMIN')` + `assertCanManageExhibition` 로 바꿨다.

| 라우트 | 하는 일 |
|---|---|
| `GET/PATCH /exhibitions/:id/applications[/:appId]` | 지원자 조회 · 수락/거절 |
| `POST /exhibitions/:id/invite`, `GET .../invites` | 작가 초대 |
| `PATCH /exhibitions/:id/description`, `.../custom-fields` | 소개 · 추가 질문 |
| `POST/DELETE /exhibitions/:id/promo-photos[...]` | 홍보 사진 |

화면 진입점은 마이페이지(Admin) > 주최 공모 카드의 **[지원자 관리]** — 갤러리와 같은
인라인 `ApplicantManager` 를 그대로 쓴다(역할 분기 없음).

⚠️ 순수 함수 `canOperateExhibition` 에는 Admin 을 넣지 않았다. `operation.ts` 는 `isOwner` 와 `isAdmin` 을
나눠 쓴다(정산 완료 후 수정은 Admin만 허용하는 식) — 섞으면 그 구분이 무너진다.

### 화면

- Admin 마이페이지 **'주최 공모'** 탭 — `frontend/src/components/admin/HostedExhibitionsSection.tsx`
  (MyPage.tsx가 이미 4400줄이라 별도 파일로 분리)
- 표시 `components/shared/HostBadge.tsx` — 모집공고 목록·상세, 갤러리 내 공모(운영/클래식 뷰), 갤러리 상세.
  글자("아트링크 주최") 대신 **로고 워드마크**만 찍는다(`ArtLinkWordmark` — Navbar 와 동일한 `Art`+빨간 `Link`).
  칩(테두리·바탕)도 "주최" 글자도 붙이지 않는다 — 로고 자체로 읽힌다는 판단.
  크기는 자리마다 다르므로 호출부에서 `className` 으로 준다(목록 카드는 갤러리명과 같은 `text-base`).
  ⚠️ `<span>` 이라 `mb-*` 만 주면 안 먹는다 — 상세 페이지처럼 아래를 띄워야 하면 `block` 을 함께
- **모집공고 목록 카드는 갤러리명 자리를 배지로 대체한다.** 거기 나오는 갤러리는 '주관' 1곳일 뿐이라
  이름을 그대로 두면 그 갤러리가 주최한 것으로 읽힌다. 참여 갤러리 전체는 상세에서 밝힌다
- **갤러리 상세 페이지**는 자기 공모(relation) + 위임받은 아트링크 주최 공모를 합쳐 마감일 순으로 보여준다
  (`routes/gallery.ts`). 실제로 그 갤러리가 운영하는 공고이므로 갤러리 페이지에 없으면 관람객이 찾지 못한다.
  주관 갤러리는 relation 에 이미 들어 있으므로 `galleryId: { not: id }` 로 **중복을 뺀다**
- 판정 규칙은 `frontend/src/lib/exhibitionHost.ts` (`isAdminHosted`/`canOperate`/`canManage`/`canDelete`) — 순수 함수 + 테스트
- ⚠️ **편집 버튼은 `canOperate` 가 아니라 `canManage` 로 판단할 것.** `canOperate` 는 운영 위임을
  판정하는 함수라 갤러리 계정만 인정한다 — 그걸로 버튼을 그리면 **Admin 이 자기가 주최한 공고의
  소개·포스터를 못 고친다**(서버는 허용하는데 버튼만 없는 상태였다). 백엔드 `assertCanManageExhibition` 과 짝
- **공고 상세는 "참여 갤러리 : A, B"** 로만 쓴다. 아트링크가 주최고 갤러리들은 같이 참여하는 것이라
  누가 주관인지 화면에 드러내지 않는다. 갤러리 별점·리뷰 줄도 붙이지 않는다 — 이 공모의 평가가 아니다
- 상세 API가 `canOperate`를 계산해 내려준다 — 프론트에서 오너 비교를 다시 구현하지 않는다
- 갤러리 화면에서 아트링크 주최 공모의 **삭제 버튼은 숨긴다** (서버도 403)

## 목록 썸네일 (2026-08-12)

목록 화면이 **원본을 그대로** 받아 작은 자리에 그리고 있었다. 실측:

| | 값 |
|---|---|
| 갤러리 운영 페이지 1회 열람 | 이미지 149건 · 평균 674KB · **약 96MB** |
| 표시 크기 대비 원본 | 16~28배 (원본 2000px급 → 표시 28×28px) |
| 240px 썸네일 적용 시 | 평균 8KB · 같은 페이지 **1.3MB** |

- 업로드 시 `t240/` 아래에 240px JPEG를 함께 올린다(`backend/src/lib/thumb.ts`).
  **실패해도 업로드는 성공**으로 둔다 — 사진이 올라가는 게 우선이고, 화면은 폴백이 있다.
- 화면은 `components/shared/Thumb.tsx`. 썸네일이 404면 원본으로 되돌린다.
- **기존 이미지(약 785장)는 백필하지 않았다.** 업로드 파일명이 `<Date.now()>-난수` 라서
  `THUMB_SINCE` 이전 파일은 **아예 썸네일을 요청하지 않는다** — 헛된 404가 0건. 백필하면 이 값을 0으로.
- **확대·라이트박스·PDF는 원본**을 쓴다. 240px를 키우면 뭉개진다.
- ⚠️ `thumbKey`를 `String.replace`로 만들면 `artlinkartlink/t240/…` 처럼 디렉터리가 중복된다
  (replace는 매칭 부분만 치환). 로컬은 디스크 경로를 따로 써서 **R2에서만 조용히** 깨진다 — 문자열을 직접 조립할 것.

## 승인 전 항목은 주소로도 열리지 않는다 (2026-08-15)

목록은 `status: 'APPROVED'` 로 거르는데 **상세 라우트는 탈퇴(WITHDRAWN)만 막고 있었다.**
그래서 심사중(PENDING)·반려(REJECTED) 갤러리·공모·전시가 목록에는 없는데
**주소로 id 를 치면 비로그인에게도 전부 열렸다.** 순번 id 라 1번부터 훑으면
아직 공개되지 않은 신청 내용과 반려 사유까지 긁을 수 있었다.

| 상태 | 비로그인·무관 | 당사자(운영자) | Admin |
|---|---|---|---|
| APPROVED | 공개 | 공개 | 공개 |
| PENDING · REJECTED | **404** | 열림 | 열림 |
| WITHDRAWN | **404** | **404** | 열림 |

- 적용: `exhibition.ts` / `gallery.ts` / `show.ts` 의 `GET /:id`
- **화이트리스트로 둔다** (`status !== 'APPROVED'` 면 일단 숨김) — 나중에 상태가 늘어도 기본이 '숨김'이 되게
- **403 이 아니라 404** — 403 은 "그 번호에 뭔가 있다"까지 알려주는 셈이다
- 공모는 아트링크 주최의 **참여 갤러리도 당사자**로 본다(`canOperateExhibition`)
- 당사자를 여는 이유: 갤러리가 마이페이지에서 자기 신청 건과 **반려 사유**를 확인해야 한다
- 회귀 방지: `backend/src/__tests__/private-detail.test.ts` (31건)

> ⚠️ URL 의 순번 id 자체는 취약점이 아니다 — 권한이 지키면 된다. 다만 위처럼 권한이 비는 곳이
> 있으면 순번 id 가 그 구멍을 훑기 쉽게 만든다. id 체계를 바꿔도 구멍은 그대로이므로 순서가 중요하다.

## 배포 전 데이터 유출 점검 (2026-08-11)

`scripts/predeploy-check.sh` — 커밋 예정분 + 아직 push 하지 않은 커밋을 훑어 다음을 차단한다.

| 검사 | 막는 것 |
|---|---|
| 덤프·데이터 파일 | `*.sql/dump/csv/sqlite/db/bak/tar/gz/zip` (`prisma/migrations/` 는 제외) |
| 접속정보 파일 | `.env`, `.env.*` (`.env.example` 제외) |
| 업로드 원본 | `backend/uploads/*` (`.gitkeep` 제외) |
| 파일 **내용** | Render Postgres 호스트명, 비밀번호가 박힌 DB URL, GitHub 토큰(classic·fine-grained) |
| 덩치 | 2MB 초과 신규 파일 경고 |

`.githooks/pre-push`가 push마다 자동 실행한다(활성화: `git config core.hooksPath .githooks`).
세 가지 유출 시나리오(덤프 add / 소스에 접속정보 / `.env` 강제 add)로 **차단되는 것까지 확인**했다.

배경: 실서버 DB를 로컬 `artlink_prod`로 복제해 확인하는 작업이 반복된다. 그 과정에서 만들어지는
덤프와 `.env` 백업이 실수로 커밋되면 실제 가입자 개인정보가 공개된다 — 되돌릴 수 없는 사고다.

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

### ArtLook 6차 — 물리 일관성 (2026-08-31)

브리핑("효과를 더 넣지 말고 한 촬영 환경에서 액자만 교체된 것처럼")에 따라 잣대를
**세기에서 관계로** 바꿨다. 새 지표 `scratchpad/vt/physics.py`(그림자 방향·얇은 선·틈 바닥)와
`framelight.mjs`(액자 18종이 광원을 따르는가). 자세한 함정은 CLAUDE.md 44b.

| | 전 | 후 | 골든 |
|---|---|---|---|
| 그림자가 광원 반대쪽으로 지는가 | (미측정, 사실상 헤일로) | **9/9** cos≥0.969 | — |
| 액자↔작품 틈 바닥 ÷ 살 | **0.002** (플로터 3종 = 순검정) | 0.12~0.55 | 0.11~0.38 |
| 액자가 광원에 반응하는 폭 Δ | 플로터 **0** (좌상단 고정) | 전 18종 5.1~37 | — |
| 액자를 바꿀 때 작품 밝기 편차 | 1.6 레벨 | **0.5 레벨** | 0 이어야 |
| 살의 1~2px 임펄스 | 최대 60.6 | 최대 30.7(대부분 액자 사진 자체의 결) | 2.1~14.4 |

주요 변경: `hexToRgb` 가 `rgb(...)` 도 파싱(그렇지 않아 오크·골드·월넛 트레이가 순검정이었다) ·
작품 둘레 stroke 전부 제거(면으로 대체) · 개구부 밝은 립 폐기 · 살 한 변을 폴리곤 하나 +
다중 스톱 그라디언트로(밴드 이음매 제거) · 그림자 오프셋 > 블러 + lightDir 정규화 ·
플로터 트레이/마이터/리베이트의 좌상단 고정광 제거 · `SUPERSAMPLE` 1.6→2.0 ·
디버그에 조명 변조 레이어와 토글 목록.

**최소 크기**(신고: 12×12cm 소품이 안 보임): 실치수를 유지하되 **무릎(soft knee)** 으로 바닥만
든다(KNEE 11% / FLOOR 5.5%). 딱딱한 clamp 는 12~60cm 를 전부 같은 크기로 만들어 기각했다.
부풀린 경우 `fitNote.enlarged` 로 화면에 알린다.

### ArtLook 7차 — 덜어내기 (2026-09-01)

평가 기준이 바뀌었다: **'입체감이 더 강해졌나'가 아니라 '아무것도 안 한 것처럼 자연스러운가'.**
사용자가 든 실패 조건 — [액자 → 흰 테두리 → 검은 선 → 흰 매트 → 작품] 으로 층이 보이면 실패.

- 바닥값(`>=`) 임계는 "효과를 더 넣어라"로 민다 → 골든 **밴드**로 교체.
- 절대값으로는 "합성이 지배적인가"를 못 가른다(합성을 다 꺼도 `rail_span` 73.5, 켜면 75.2 —
  그건 액자 **사진 자체**의 대비였다) → `syncheck.py` 가 **합성만 끈 렌더와 비교**한다.
- 한 노브로 일괄 조절하면 장면 광원 추종까지 죽는다 → `SYN_DIR`(면의 방향광, 층을 안 만든다) /
  `SYN_EDGE`(아리스·매트 사면·리베이트·매트 그늘, 사용자가 본 테두리가 전부 여기서 나온다)로 분리.
- 넓은 반그림자 제거(회색 헤일로였다) · 액자가 매트에 지는 그늘 62%→20% · 매트 결 진폭 하향.

### ArtLook 8차 — 상수를 재서 조건부로 (2026-09-01)

브리핑: "모든 규칙은 **조건부**다. 자산에 이미 있으면 다시 만들지 말고, 확신이 없으면 덜 해라."
7차까지 `SYN_DIR`·`SYN_EDGE` 는 전역 상수 하나라 액자 18종 × 장면 15개에 같은 세기를 걸었다 —
그래서 노브를 돌릴 때마다 어떤 조합은 좋아지고 어떤 조합은 나빠졌다. 이제 **측정값에서 유도**한다.

| 무엇을 재나 | 어디서 | 무엇이 달라지나 |
|---|---|---|
| 액자 자산에 **이미 구워진** 방향광·단면 | `measureAssetLight()` (로드 때 1회) | 잔차만 채운다. 충분하면 **아무것도 안 한다** |
| 장면 벽의 조명 낙차 → **신뢰도** | `sceneLightModel()` (장면당 1회) | 근거 없는 가로 성분을 줄인다 |
| 매트 사면이 **1px 을 채우는가** | `matOpeningBevel(…, vis)` | 못 채우면 알파로 사라진다(선 금지) |

실측으로 뒤집힌 전제 둘: ①사진 액자 5종의 위살−아래살이 `+27.8 / +15.8 / +20.6 / **−17.3** /
**−41.2**` — "네 변이 똑같이 밝다"가 전부 틀렸고, 우리 음영은 셋에서 **중복**, 둘에서 **싸우다
지고** 있었다. ②장면 15개 중 6개는 벽 낙차가 0.0~4.5 라 광원 방향의 근거가 **없는데** 전부 손으로
적은 `[-1,-1]` 이었다.

주요 변경: 균일 항을 상수 → **잔차**(이미 충분하면 delta=0) · 밝히기를 `screen` → `lighter`
(밝은 액자에서 +16% 요청이 +3.8% 로 뭉갰다) · 깊은 폐색의 곱연산 색을 근사 검정으로(따뜻한
그늘색은 검은 살에서 **바닥**이 된다) · 리베이트의 방향 성분(자산에 있다)과 폐색 성분(자산에
없다)을 분리 · 폴백 사다리 `?level=0..3` · 계측 훅이 **뒷면**(`back`)도 알려준다.

지표(7차→8차): 합성 기여 0.9~20% → **0.0~17.7%** · 그림자 방향 최소 0.774 → **0.865** ·
매트 방향광 8/9 → **9/9** · `run.py` 8/10 동률 · 작품 보존 10/10. 자세한 건 CLAUDE.md 44g.

### ArtLook 매트 '없음' 복원 (2026-09-01)

44e(2026-08-31)에서 없앴던 **매트 없음**을 되살렸다 — 선택지는 없음 / 좁게(5%) / 넓게(10%),
캔버스 랩만 예외. `matFrac` 을 한 곳에서만 정하는 구조(44e 의 진짜 값)는 그대로 뒀다.

매트를 빼면 **매트가 가려 주던 것이 드러난다.** 브리핑의 NO-MAT SAFETY SYSTEM 을 지표로
만들어(`scratchpad/vt/nomat.mjs`·`nomat.py`) 재 보니 둘이 걸렸다.

| 무엇이 | 왜 | 어떻게 고쳤나 |
|---|---|---|
| 사진 액자에 **흰 테두리** (검정 40.2 · 월넛 38.1) | 자산의 밝은 안쪽 립. 촬영 때 개구부에 댄 **회색판 반사광**이지 그 액자의 성질이 아니다 | `LIP_TARGET`(0.85)으로 **상쇄** — 테두리를 더하지 않고 없어야 할 밝기를 던다. 립이 이미 어두운 자산엔 아무 일도 안 한다 |
| 플로터에 **검은 선** (샴페인 19.5 · 아이보리 23.5) | 트레이 폐색과 작품 접지 그림자가 **같은 자리에 겹친다** | 매트가 없을 때 트레이 폐색을 끈다(ANTI-COMPOUNDING) |

⚠️ 판정은 **차등**으로. 합성을 끄고 재도 골드 42.8 인데 그건 그 액자의 금장 비드(재질)다.
`syncheck.py` 와 같은 논리로 합성이 더한 몫만 본다 — 18/18, 기여 중앙 **−1.0**.

부수 효과: `suite.json` 의 `mat: 0` 여섯 케이스가 진짜 매트 없음이 되면서 액자 전수 스윕이
19/36 → **24/36** 으로 올랐다(매트가 없으면 겹칠 레이어가 줄어든다).

### ArtLook 9차 — 리베이트가 깊이를 만든다 (2026-09-01)

브리핑: "NO-MAT ↑ · WITH-MAT = 또는 ↑. 가짜 매트 띠 대신 **액자 자신의 리베이트·폐색**에서
깊이를 얻어라." 8차 지표가 전부 통과하는데도 매트 없는 렌더가 납작했다 — 지표 둘이 이 결함을
구조적으로 못 봤기 때문이다. `nomat.py` 의 임펄스는 중앙값 필터라 **넓은 띠**를 못 보고,
`rebate_ratio` 는 **골의 최솟값만** 본다. 눈에 '층'으로 보이는 건 골 다음에 되올라오는 띠다.
4배 확대 시트(`sheet.py`)를 보고서야 찾았다.

**골든 5장이 전부 매트 없음**이라는 걸 그제야 확인했다 — 이 구성의 정답지가 이미 있었다.
단면을 재면 한결같다: 앞면 → 3~5px 에 **깊은 골(0.15~0.40)** → 3~5px 에 **회복(0.43~0.63)** → 작품.

| | 골 | 끝(작품 직전) | 앞면보다 밝은 px |
|---|---|---|---|
| 골든(실제 사진 5장) | 0.15~0.40 | 0.43~0.63 | — |
| 8차 오크 / 골드 | 0.67 / 0.58 | 0.83 / 0.83 | 0 / 0 |
| 8차 검정 / 월넛 | 0.34 / 0.31 | **1.54** / 1.17 | 5 / 3 |
| **9차 사진 액자 5종** | 0.36~0.55 | **0.52~0.60** | **0** |
| 8차 → 9차 슬림 액자 | 0.80 → **0.34** | | |

핵심 기전은 하나다 — `f(d) = min(1, 목표(d) / 자산(d))`. **한 방향으로만** 작동해서 결과가
`min(자산, 목표)` 가 된다. 사진에 이미 더 깊은 골이 있으면 살리고(SOURCE-FIRST), 개구부
반사광으로 **밝아지는** 구간만 목표까지 내린다. 그래서 이미 옳은 자산에는 아무 일도 안 한다.

바뀐 코드(전부 `frontend/public/artlook/index.html`):
- `measureAssetLight` 가 **변별** 단면 프로파일 `prof4`(24구간, 각 변을 제 앞면으로 정규화)를
  로드 때 한 번 잰다. 평균 하나로는 안 된다 — 골드의 봉우리는 왼쪽 살에만 있다.
- `assetRel(A,d,s)` + `shadeFrameProfile` 의 절대 프로파일 분기(`absReb`). 얇은 살은
  구간 폭(px)으로 깊이를 줄인다(`kd`) — 몇 px 안에 표현 못 할 깊이는 안 그리는 게 낫다.
- 절차적 액자용 `rebateOnly` 모드 + `planeShade(…, rebOwn)`. 슬림 액자는 리베이트가 아예
  없었다(골 0.80). `planeShade` 가 아랫변 사면을 **밝히고** 리베이트는 **어둡게** 해서
  두 모델이 충돌하므로, 사면과 아리스를 리베이트에 통째로 넘긴다.
- 소수점 좌표 액자의 이음매 보정(`OV`) — 살 마지막 픽셀이 폴리곤에 절반만 덮여 밝은 실선이 됐다.

지표 쪽도 둘을 고쳤다(둘 다 **상상한 한계값**이었다):
- `metrics.py` 에 `face_span` 추가 — 골든의 `rail` 은 앞면만이라 우리 `railPx`(리베이트 포함)와
  다른 구간을 재고 있었다. `syncheck` 을 이걸로 바꾸니 우리 합성은 앞면 대비를 **줄인다**(−26%·−7%).
- `nomat.py` 를 골든 실측으로 재보정 — 종전 "≤8" 은 **실제 사진(1.5~27.4 / 12.4~24.7)도 탈락**시킨다.

🔒 **매트 있는 렌더는 픽셀 하나도 안 바뀐다**(전 케이스 최대 차이 0). 실버 플로터 무매트
(브리핑이 지목한 성공 레퍼런스)도 동일. 검증: `nomat` 18/18 · `run.py` 8/10 동률 ·
`artpreserve` 10/10 · 그림자 방향 10/10 · 프론트 587 통과.

### ArtLook 10차 — 선이 아니라 폭 (2026-09-01)

사용자 지적: 매트 없는 일부 렌더에서 [액자 → 안쪽 리베이트 → 작품] 전이가 **얇은 그래픽 선**으로
읽힌다. 더 진한 테두리·그림자로 풀지 말고 물리 해석을 고칠 것. 지금 자연스러운 것들은 보호.

`edge.py` 로 골든과 우리를 같은 코드로 재서 원인을 갈랐다.

| | band(골↔끝) | cross(작품 첫 px) | width(px) |
|---|---|---|---|
| 골든 5장 | 0.00~0.46 (중앙 0.28) | 0.76~1.06 (중앙 **0.95**) | 2.5~20.5 |
| 9차 우리 | 0.01~0.60 (중앙 0.07) | 0.95~0.99 (중앙 **0.97**) | 2.5~12.5 |

`cross` 가 이미 골든 범위라 **"폐색이 작품 경계에서 끊긴다"는 가설은 기각**됐다 — 작품 쪽
그림자를 더할 이유가 없다. 남은 건 `width`: 약한 케이스는 전부 **조각이 작게 그려지는 렌더**
(실내 장면 `maxLong` 0.49 · 얇은 액자)였다. 오크는 살 44px·리베이트 10px 인데 갤러리 살롱의
같은 오크는 살 20px·리베이트 4~5px 다. 그 4px 에 온전한 V 를 넣으면 선이 된다.

고친 것 넷 (`frontend/public/artlook/index.html`):
1. **해상도 판정을 화면 기준으로.** `kd` 가 판(plate) 픽셀을 보고 있어서 **한 번도 작동하지
   않았다**(판은 작품 원본 크기라 늘 넉넉하다). `compose()` 가 출력 크기를 판보다 **먼저** 구해
   `state.outLongEst` 로 넘긴다.
2. **못 그릴 폭이면 '없음'으로 수렴.** 예전엔 골만 얕게 해서 골=끝인 **평평한 어두운 띠**가
   남았다. 양 끝을 함께 1 로 보내 V 모양은 지키고 세기만 준다(골든 case_06 이 그 증거 — 살 8px
   짜리 실제 사진의 골이 0.87 이다).
3. **회복에 별도 게이트(`krec`).** 되밝아짐 자체는 물리적으로 맞지만 2~3px 안에 그리면 밝은 링이
   된다. 원인은 자산의 립이 **아니다** — 얇은 실버 자산은 개구부 직전이 0.94~1.05 로 깨끗한데도
   실패했고, 검정(3.7배)·월넛 자산은 살이 넓어 통과한다.
4. **smoothstep.** 리베이트는 두 평면이 만나는 각이 아니라 오목한 곡면이다.

되돌린 것: 자산 개구부의 촬영판 잘라내기(`L ≥ 앞면` 기준이 기존 5종의 문서화된 립과 구분되지
않아 골드를 깎았다 — git 복원).

🔒 보호: 매트 전 케이스 · 실버 플로터 무매트 · 캔버스 랩 **0px 변화**. 큰 사진 액자 5종은
최대 4~14레벨(0.2~1.0% 픽셀, smoothstep 때문).
검증: 얇은 오크 32.7→**17.8** · 샴페인 슬림 28.0→**20.3** · 실버 슬림 26.3→**13.6** ·
화이트 매트 25.3→**4.6** · `nomat` 21/21 · 나머지 지표 동률 · 프론트 590.

### ArtLook 추가 자산 (2026-09-01)

- **얇은 사진 액자 3종**(`oak-thin`·`walnut-thin`·`silver-thin`, native 살 5.0~5.7% = 기존의 절반).
  추출기에 한정어(`QUALS`)를 넣어 키 충돌을 막는다. ⚠️ 추출기를 다시 돌리면 `gptsamplecase/` 에
  원본이 없는 액자가 `frames.json` 에서 사라진다(walnut) — 재추출 후 `git checkout` + 새 키만 병합.
- **콰이어트 스터디** 실내 장면. 원본 382×332 를 3배 확대(벽이 매끈해 손실 없음을 재고 결정).
  ⚠️ 그래서 벽 결이 0.44 로 목표 밴드(2.5~4.5) 아래 — 배경이 평평하게 읽힌다. 더 큰 원본이
  생기면 교체할 것.
- **리넨 리빙 · 클레이 살롱**(`frameit_test_assets.zip`). 우리 장면 중 **방향광 근거가 가장
  뚜렷하다**(영역 실측 좌−우 +18.4 · +33.5, 대부분의 장면은 4 미만 = 근거 없음). 둘 다 왼쪽 창.
  ⚠️ 광원 기울기는 **`region` 안에서** 잴 것 — 리넨 리빙은 왼쪽 화분 탓에 이미지 전체로 재면
  부호가 뒤집힌다(−10.7 ↔ 영역 +18.4).
- ⛔ 같은 zip 에서 **쓰지 않은 것**: 액자 3종(앞서 넣은 1024px 판과 같은 액자를 271px 로 담은 것) ·
  wall_01~03(결 1.07~1.37 = 밴드의 1/3, 색도 기존 8종과 중복) · room_03(이미 작품이 걸려 있다).
- **배경 [벽]/[공간] 탭.** `scenes.json` 의 `group` 으로 가른다(벽 8 · 공간 10).
  `state.sceneIdx` 는 전체 목록 인덱스를 유지한다.

⚠️ 엔진은 `main` 에 있지만 **`deploy/render` 는 아직 `9ed4713`** — 실서버에는 장면 모드가
빠져 있다(CLAUDE.md 44d).
