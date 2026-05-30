# ArtLink 기능·라우트·API·역할 맵 (PHASE0 범위산정)

> 출시 전 종합 검수의 기준표. 모든 페이지/API/권한을 한눈에 보기 위한 문서입니다.
> 검수일: 2026-05-30 / 대상: 로컬 서버 (frontend localhost:5173, backend localhost:4000)

## 1. 페이지 라우트 (화면)

| 경로 | 페이지 | 누가 볼 수 있나 | 설명 |
|------|--------|----------------|------|
| `/` | 홈 | 누구나 | 히어로 슬라이드, 퀵 메뉴, 이달의 갤러리 |
| `/explore` | 탐색 | 누구나 | 작가 작품 이미지 피드, 좋아요 |
| `/galleries` | 갤러리 찾기 | 누구나 | 갤러리 목록, 지역/별점 필터, 정렬 |
| `/galleries/:id` | 갤러리 상세 | 누구나 | 정보·이미지·공모·리뷰·찜·인스타 피드 |
| `/exhibitions` | 모집공고 | 누구나 | 진행중 공모 목록, 필터 |
| `/exhibitions/:id` | 공모 상세 | 누구나 | 공모 정보, 추가질문, 지원 버튼 |
| `/shows` | 전시 | 누구나 | 전시 목록(진행/예정/종료) |
| `/shows/:id` | 전시 상세 | 누구나 | 전시 정보·작가·이미지 |
| `/portfolio/:userId` | 작가 포트폴리오 | 누구나 | 작가 소개·이력·작품(최대 30장) |
| `/benefits` | 혜택 | 누구나 | 혜택 목록 |
| `/login` | 로그인 | 누구나 | **현재: 개발용 퀵 로그인 (계정 클릭만으로 로그인)** |
| `/messages` | 메시지 | 로그인 | 작가↔갤러리 대화 |
| `/mypage` | 마이페이지 | 로그인 | 역할별 대시보드(아래 3절) |
| `/support` | 고객센터 | 로그인 | FAQ + 1:1 문의 |
| (그 외 모든 주소) | — | — | **404 안내 페이지 없음 → 빈 화면** (PHASE3 참고) |

## 2. API 엔드포인트 (서버 기능) — 총 17개 모듈

인증 표기: **없음**(누구나) / **로그인**(authenticate) / **선택**(optionalAuth, 로그인 안 해도 됨) / **역할**(authorize)

- **인증 `/api/auth`**: `POST /kakao`, `POST /complete-registration`, `POST /signup`, `POST /login`(없음) · `GET /me`, `PUT /me/avatar`(로그인) · **`POST /dev-login`, `GET /dev-users`(없음 ← 보안 PHASE2 핵심)**
- **갤러리 `/api/galleries`**: `GET /`, `GET /:id`(선택) · `POST /`, `PATCH /:id/detail`, `DELETE /:id`, 이미지/인스타 관리(로그인+GALLERY 소유자)
- **공모 `/api/exhibitions`**: `GET /`, `GET /:id`(선택) · `GET /my-applications`(ARTIST) · `GET /my-exhibitions`(GALLERY) · `POST /`, `PATCH …`, `DELETE`(GALLERY 소유자) · `POST /:id/apply`(ARTIST) · `GET/PATCH /:id/applications…`(GALLERY 소유자)
- **전시 `/api/shows`**: `GET /`, `GET /:id`(선택) · `GET /my-shows`, `POST/PATCH/DELETE`(GALLERY 소유자)
- **리뷰 `/api/reviews`**: `GET /gallery/:id`(없음) · `POST`, `PATCH`(ARTIST 작성자) · `DELETE`(ADMIN 또는 작성자)
- **찜 `/api/favorites`**: `GET /`, `POST /toggle`(로그인)
- **포트폴리오 `/api/portfolio`**: `GET /:userId`(없음) · 내 포트폴리오 CRUD(ARTIST) · `GET /search`(GALLERY)
- **승인 `/api/approvals`**: `GET /`, 갤러리/공모/전시 승인·거절, 수정요청 처리(ADMIN) · `POST /edit-request`(GALLERY)
- **혜택 `/api/benefits`**: `GET /`(없음) · 생성/수정/삭제(ADMIN)
- **히어로 `/api/hero-slides`**: `GET /`(없음) · CRUD(ADMIN)
- **이달의갤러리 `/api/gallery-of-month`**: `GET /`(없음, 만료 자동 필터) · 등록/삭제(ADMIN)
- **메시지 `/api/messages`**: 대화·쓰레드·전송·삭제(ARTIST/GALLERY, 참여자만)
- **신고 `/api/reports`**: `POST`(ARTIST/GALLERY) · 목록·처리(ADMIN)
- **알림 `/api/notifications`**: 목록·미읽음수·읽음(로그인)
- **문의 `/api/inquiries`**: FAQ 조회(없음)·FAQ CRUD(ADMIN) · 문의 작성(ARTIST/GALLERY)·답변(ADMIN)
- **탐색 `/api/explore`**: 피드(선택)·좋아요(로그인)
- **업로드 `/api/upload`**: 이미지/파일 업로드(로그인)

## 3. 역할별 권한 요약

- **ARTIST(작가)**: 포트폴리오 관리, 공모 지원, 수락된 공모에 리뷰, 찜, 갤러리에게 메시지, 문의
- **GALLERY(갤러리)**: 갤러리/공모/전시 등록(승인 필요), 지원자 관리·상태변경, 지원자에게 메시지, 수정요청
- **ADMIN(관리자)**: 승인/거절(거절 시 사유 필수), 히어로·혜택·이달의갤러리 관리, 신고·문의 처리, 리뷰 삭제

## 4. 데이터 모델 (20개)
User, Gallery, GalleryImage, Exhibition, Application, PromoPhoto, Show, ShowImage, Review, Favorite, Portfolio, PortfolioImage, PortfolioImageLike, Message, MessageReport, Notification, Inquiry, Faq, ApprovalRequest, HeroSlide, Benefit, GalleryOfMonth

## 5. 인증(로그인) 흐름
- 로그인하면 서버가 **JWT 토큰**(7일 유효, 신분증 같은 암호 문자열)을 발급 → 브라우저 저장소(`artlink-auth`)에 보관 → 이후 모든 요청에 자동 첨부.
- 서버는 토큰을 비밀키(`JWT_SECRET`)로 검증. 정식 로그인은 카카오 OAuth / 이메일+비밀번호(bcrypt 해싱) 지원.
- **단, 현재 살아있는 로그인 화면은 "개발용 퀵 로그인"**: 계정을 클릭만 하면 비밀번호 없이 로그인됨 → PHASE2 보안의 핵심 이슈.
