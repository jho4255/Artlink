# 칼럼(저널) 글쓰기 — 블로그형 편집기 개발·검증 계획

작성 2026-11-13 · 계획: Fable 5.2 · 구현: Opus 5.5 · 상태: **사용자 결정 대기(§2), 코드 변경 없음**

> 구현자에게 — 이 문서는 계획이다. 사용자가 "구현해"라고 하기 전에는 코드를 고치지 않는다(이 사용자는 조사·계획·구현을 따로 시킨다).
> 단계(M1~M6)마다 멈춰 로컬 확인을 받는다. 커밋·배포는 시킬 때만. 대답은 한국어. 서브에이전트 금지. E2E 는 데모 DB(`artlink`)에서만, 먼저 백업.

---

## ★ 방향 수정 (2026-11-13 사용자 피드백 — 아래 본문보다 이 절이 우선)

사용자: "칼럼 쓰는 게 따로 있는 게 아니라 **커뮤니티 글쓰기 전체**를 이 수준의 도구로. 칼럼은 **탭으로 구분**하면 된다. 짧은 글도 같은 도구로 쓰면 된다. 지금 커뮤니티 UI 가 별 볼 일 없으니 **커뮤니티 UI/UX 도** 신경 써라."

아래 본문은 '칼럼을 별도 종류(`Article`, `/journal`)로' 쓴 첫 판이다. **목업 피드백이 끝나면 본문 전체를 이 방향으로 다시 쓴다.** 그때까지 바뀌는 것:

| 첫 판 | 바뀐 방향 |
|---|---|
| `Article` 표 · `/journal` · ArtJournal 이름(D1) | **없앤다.** `Post` 를 넓힌다 — `doc Json?`·`docVersion`·`coverUrl`·`excerpt`·`readingMinutes`. 주소는 `/community/:id` 그대로 |
| 종류(`kind`) 5가지 | **탭(`PostCategory`)이 곧 종류**다(작업일지·꿀팁·전시 후기·전시 준비…). 관리자가 만든다 |
| 필진만 쓴다(D2) | **탭마다** 정한다 — `writeAdminOnly` 를 `writePolicy: all \| writers \| admin` 으로 넓히고 필진 목록(`CommunityWriter`)을 둔다. 자유·질문 탭은 누구나 |
| 목록은 `/journal` 카드 격자 | 탭마다 **보이는 모양**(`layout: list \| card`). 전체 탭은 맨 위 '필진의 새 글' 한 줄 + 글 목록 |
| 발행 창 | **없다.** 탭·익명은 편집 화면 제목 위에서 고르고 [등록]. 표지는 첫 사진이 자동, 사진 도구의 [표지로] 로 바꾼다. 요약은 자동 |
| 익명 없음 | 익명은 그대로(글·댓글). 탭 설정으로 익명을 막을 수 있다(`allowAnonymous` — 필진 탭은 실명) |
| 이웃 알림 | **필진 탭의 실명 글**에만. 익명 글·자유 탭 글은 알리지 않는다(익명이 드러나고, 잡담마다 알림이 가면 끈다) |
| 옛 글 | DB 를 고치지 않는다. `doc` 이 없는 글은 읽을 때 `body`(문단) + `images`(사진)로 그린다. 수정하면 새 형식으로 저장 |
| 글 수정 | 사진까지 고친다(지금은 제목·내용뿐). 작업본은 `PostDraft(postId?)` — 새 글 초안과 같은 표 |

그대로 가는 것: 문서 JSON + 서버 검증(§4.2·§6) · 읽는 화면에 편집기를 싣지 않음(§4.3) · 작업본 별도 표(§4.4) · 편집 화면은 `Layout` 밖(§4.5) · 사진(§8) · 저장 안전망(§9) · 검증 계획(§14) · `index.ts` 한도 둘.

새로 생긴 일: **커뮤니티 화면 다시 그리기**(목록·글 화면 — 지금은 `max-w-3xl` 에 알약 탭·64px 둥근 썸네일·노란 고정 표시·이모지 안내라 DESIGN.md 와도 어긋난다) · 짧은 글에서도 가볍게 느껴져야 한다(제목 + 본문 두 줄 + [등록] 이 지금보다 번거로우면 실패).

목업: https://claude.ai/artifact/XUmfeZb9uqH61e8htxrsYR (원본 `scratchpad/column-editor/mockup/`)

---

## 0. 한 장 요약

- **무엇**: 섭외한 작가·갤러리가 작업일지·꿀팁·전시 후기·전시 준비 과정을 쓰는 **읽을거리(칼럼)** 와, 그걸 쓰는 **블로그형 편집기**(글 + 사진 올리기·배치·자르기).
- **왜 새로 만드나**: 지금 커뮤니티 글쓰기는 `<textarea>` 하나 + 맨 아래 사진 10장 격자다(`CommunityWritePage.tsx`). 글 중간에 사진을 못 넣고, 서식·임시저장·수정 시 사진 변경이 없고, 떠나면 다 사라진다.
- **핵심 구조 다섯** (이유는 §4)
  1. 칼럼은 커뮤니티 글(`Post`)과 **다른 종류**(`Article`)다 — 익명 게시판과 섞지 않는다.
  2. 본문은 HTML 이 아니라 **문서 JSON**(TipTap/ProseMirror)으로 저장하고, 서버가 허용 목록으로 검증한다.
  3. 읽는 화면은 **편집기 없이** JSON 을 그린다(읽는 사람은 편집기 400KB 를 받지 않는다). 편집기와 읽기 화면이 **같은 부품·같은 CSS** 를 써서 쓰는 모양 = 보이는 모양.
  4. 초안은 **서버에** 자동 저장한다(휴대폰에서 사진, PC 에서 글). 작업본은 **별도 표**(`ArticleDraft`) — 공개 응답에 절대 안 실린다.
  5. 편집 화면은 **`Layout` 밖 전용 화면**이다(상단바·하단 탭바·팝업 없음). 휴대폰 도구 막대는 `visualViewport` 로 자판 바로 위에 붙인다.
- **가장 큰 위험 셋**: ① 휴대폰 자판 + 한글 조합(IME) + 사진 블록 ② 쓰던 글을 잃는 길(배포 중 자동 새로고침·로그인 만료·요청 한도) ③ 사진 여러 장의 용량·레이아웃 밀림. 셋 다 M2~M3 에서 먼저 부수고 간다.

---

## 1. 지금 상태 (2026-11-13 코드 조사)

| 항목 | 사실 | 위치 |
|---|---|---|
| 커뮤니티 글쓰기 | 제목 input + 본문 textarea(5,000자) + 사진 10장(맨 아래 격자). 사진은 한 장씩 차례로 올림. 임시저장 없음 | `frontend/src/pages/CommunityWritePage.tsx` |
| 커뮤니티 글 수정 | 제목·내용·익명만. 사진은 못 바꾼다 | `routes/community.ts` `updateSchema` |
| 커뮤니티 글 삭제 | DB 행만 지우고 **사진 파일은 안 지운다**(고아 파일) | `routes/community.ts:425` |
| 기존 서식 편집기 | TipTap **3.31.3**(`@tiptap/react`·`starter-kit`·`extension-placeholder`). 제목·굵게·목록·인용·링크·구분선만, **이미지 없음**(일부러). 저장은 HTML, 서버 `sanitize-html` + 화면 `DOMPurify` 이중 거름 | `components/shared/RichTextEditor.tsx` · `lib/richText.ts`(양쪽) |
| 편집기 청크 | `RichTextEditor-*.js` 401KB(압축 전). `React.lazy` 로만 받고 PWA 미리받기에서 뺌 | `LazyRichTextEditor.tsx` · `vite.config.ts` `globIgnores` |
| 사진 올리기 | `POST /api/upload/image` → `{url}` 만(치수 없음). 15MB, jpeg·png·gif·webp(HEIC 불가). PNG 사진은 JPEG 로 바꿔 저장. 썸네일 `t240`·`t800` 을 **응답 뒤에** 비동기로 만든다. 서버 동시 처리 3개, 30개 넘게 밀리면 503 | `routes/upload.ts` · `lib/thumb.ts` · `lib/imageNormalize.ts` |
| 화면 쪽 압축 | `compressImage` — 2MB 또는 2000px 을 **넘을 때만** JPEG 0.85 로 다시 굽는다 | `frontend/src/lib/utils.ts:144` |
| 요청 본문 한도 | `app.use(express.json())` — **기본 100KB**. 긴 문서 JSON 은 413 | `backend/src/index.ts:96` |
| 요청 수 한도 | `/api` 전체 **15분 300회**(폴링·비회원 기록만 예외) | `index.ts:127` |
| 배포 중 새로고침 | 새 서비스워커가 넘겨받으면 `reloadIfStale` → 옛 판이면 **`location.reload()`**. 쓰는 중인지 보지 않는다 | `main.tsx:33` · `lib/swUpdate.ts` |
| 청크 404 | `lazyWithReload`(App.tsx)·`LazyRichTextEditor` 가 옛 청크 404 에 **자동 새로고침** | `App.tsx:17` |
| 로그인 만료 | axios 401 → `authStore.logout()` → `ProtectedRoute` 가 `/login` 으로(돌아올 곳은 기억) | `lib/axios.ts:29` |
| 미저장 가드 | `useUnsavedChanges`(confirm + 가드 히스토리 항목) · 등록 폼 임시저장은 localStorage(`lib/formDraft.ts`) | `hooks/` |
| 메뉴 | 가운데 메뉴 6칸(홈·작가·갤러리·전시·모집공고·커뮤니티) = 휴대폰 하단 탭바 6칸. 이미 꽉 찼다 | `lib/navLinks.ts` |
| 공유 미리보기 | `seoMeta.ts` 가 공모·갤러리·전시·작가 홈페이지만 처리. 커뮤니티 글은 없음. `sitemap.xml` 있음 | `lib/seoMeta.ts` · `routes/seo.ts` |
| 비회원 머문 시간 | `guestPageKind` 에 화면 이름을 더하면 [통계]에 그 화면의 머문 시간이 잡힌다 | `lib/guestActivity.ts:176` |
| 이웃(팔로우) | `Follow`(단방향). 새 글을 이웃에게 알리는 길은 아직 없음(스토리는 피드에만) | `schema.prisma` |
| 앱(안드로이드) | 실서버를 띄우는 WebView(크롬 124). `<input type=file>` 은 Capacitor 가 선택기·카메라를 연다. 뒤로가기는 `role="dialog"` 창에 Esc 를 보낸다 | 규칙 79 |
| 사파리 엔진 | sudo 없이 띄우는 래퍼 있음(`~/.cache/wk-deps/run.sh`) | 메모리 `webkit-without-sudo.md` |
| 안드로이드 에뮬레이터 | 윈도우 쪽 `ArtLink_Pixel7`, `mobile/scripts/emu.sh dev\|shot\|js\|tapon` — **진짜 자판이 뜬다** | 규칙 79 |

---

## 2. 사용자가 정할 것 (괄호 = 이 계획이 가정한 추천값)

| # | 결정 | 추천 | 다른 길 |
|---|---|---|---|
| D1 | 이름·주소 | **ArtJournal** (Art 검정 + Journal 빨강, 한글 '저널'), 주소 `/journal` | ArtColumn `/columns` · 한글 '칼럼' 그대로 |
| D2 | 누가 쓰나 | **관리자가 초대한 회원만**(역할 무관 — 작가·갤러리·일반). 관리자는 늘 가능 | 모든 작가·갤러리에게 열기 |
| D3 | 발행 방식 | 초대한 필진은 **바로 발행**. 관리자는 숨기기·추천 고정 | 관리자 승인 뒤 공개(승인 대기열 추가) |
| D4 | 진입점 | 메뉴 칸은 늘리지 않는다 — **홈 섹션(ArtWorks 바로 아래) + 커뮤니티 맨 위 띠 + 작가·갤러리 홈페이지 [글] 탭 + 이웃 알림** | 가운데 메뉴에 7번째 칸(휴대폰 탭바가 7칸이 된다) |
| D5 | 범위 | **칼럼 먼저**. 커뮤니티 글쓰기는 2차로 같은 편집기의 가벼운 설정을 붙인다 | 커뮤니티도 동시에 교체 |
| D6 | 사진 편집 | 1차 **자르기·돌리기**. 밝기·가리기(모자이크)는 2차 | 1차에 전부 |
| D7 | 댓글·좋아요 | 로그인 회원 누구나. 글쓴이·관리자가 댓글 삭제 | 댓글 없이 시작 |

URL(D1)만은 M1 전에 정해야 한다 — 공유된 주소는 못 바꾼다. 나머지는 구현 중에 뒤집어도 비용이 작다.

---

## 3. 제품 흐름

- **필진 초대**: 관리자 [저널 관리] 탭에서 회원을 찾아 [필진으로] → 그 회원의 마이페이지에 **[내 글]** 탭과 [새 글 쓰기]가 생긴다(`/auth/me` 의 `canWriteArticles`).
- **쓰기**: [새 글 쓰기] → 서버에 빈 초안이 생기고 `/journal/write/:id` 로. 치는 대로 자동 저장. 휴대폰·PC 를 오가며 이어 쓴다.
- **발행**: [발행] → 발행 창(종류 · 표지 · 한 줄 요약 · 글쓴이 표시 · 댓글) → `/journal/:id`. 처음 발행할 때만 이웃에게 알림(벨 + 앱 푸시).
- **고치기**: 발행한 글을 열어 고치면 **작업본**에 저장되고, [수정 발행]을 눌러야 공개본이 바뀐다(쓰다 만 글이 공개되지 않는다). [변경 버리기] 가능.
- **읽기**: 홈 섹션·`/journal` 목록·작가/갤러리 홈페이지 [글] 탭·알림·공유 링크로 들어와 → 글 → 끝에서 글쓴이 카드(이웃 추가·홈페이지)·다음 글·댓글.
- **글쓴이 표시**: 기본은 닉네임(→ `/@핸들`). 갤러리 회원은 자기 갤러리 이름으로도 낼 수 있다(→ 갤러리 홈페이지). 익명 없음.
- **종류**(`kind`): 작업일지 `WORKLOG` · 꿀팁 `TIP` · 전시 후기 `REVIEW` · 전시 준비 `MAKING` · 에세이 `ESSAY`. 서버 `lib/articleKinds.ts` ↔ 화면 거울(테스트가 대조 — 지역 목록 규칙 67 과 같은 방식).

---

## 4. 구조 결정과 이유

### 4.1 `Post` 를 늘리지 않고 `Article` 을 따로 둔다
`Post` 는 익명·말머리·공지·고정이 얽힌 게시판이다(익명이면 서버가 신원을 통째로 가린다). 칼럼은 실명 기고·초안·발행·표지·시리즈가 필요해 겹치는 게 거의 없다. 한 표에 넣으면 익명 규칙과 초안 규칙이 서로의 구멍이 된다.

### 4.2 본문은 문서 JSON — 기존 `richField()`(HTML)를 쓰지 않는다
기존 HTML 방식은 사진 없는 짧은 소개용이다. 사진·모아 놓기·영상·카드가 들어가면 HTML 은 ①`<img src>` 를 우리 저장소 주소로만 제한하고 ②크기·배치를 `class`/`data-*` 로 실어야 하고 ③읽는 화면에서 `srcset`·치수 예약·크게 보기를 붙이려고 HTML 을 다시 파싱해야 한다. JSON 이면
- 서버가 **노드·속성 단위**로 검증한다(모르는 노드는 400, 사진 주소는 `ownFileUrl`, 링크는 http·https·mailto).
- 읽는 화면이 React 요소로 직접 그린다 — **`dangerouslySetInnerHTML` 이 없다**(저장형 XSS 표면이 사라진다).
- 발췌·읽는 시간·사진 목록·표지 후보를 서버가 문서에서 뽑는다.
- 나중에 서버가 같은 JSON 으로 검색엔진용 HTML·RSS 를 만든다(§15).

### 4.3 읽는 화면에 TipTap 을 싣지 않는다
읽는 사람이 대다수다. `ArticleBody`(JSON → React)는 TipTap 을 import 하지 않는다 — 소스 가드 테스트로 고정(`native.test.ts` 의 `@capacitor/*` 가드와 같은 방식). 편집기의 사진·모아 놓기 NodeView 는 `ArticleBody` 가 쓰는 **같은 표시 부품**(`FigureView`·`GalleryView`)을 감싸 편집 단추만 얹는다.

### 4.4 작업본은 별도 표
공개 응답이 행을 통째로 내려주는 사고가 이 저장소에서 반복됐다(초대 코드 규칙 57 · 작품 가격 규칙 71). 발행 전 글·고치던 글이 `Article` 컬럼이면 `...article` 한 번에 샌다. `ArticleDraft(articleId PK)` 로 나누고, 공개 라우트는 이 표를 읽지도 않는다.

### 4.5 편집 화면은 `Layout` 밖
`Layout` 안이면 상단바(64~80px)·하단 탭바(57px, `fixed z-40`)·로그인 사이드바(224px)·소개 팝업·홈페이지 팝업·푸시 배너가 같이 온다. 휴대폰에서 자판이 올라오면 글 쓸 자리가 거의 없고, 탭바와 도구 막대가 싸운다. 인쇄 화면처럼 `App.tsx` 에서 `<Route element={<Layout/>}>` **밖**에 둔다. `ScrollToTop`·토스트는 `main.tsx` 에 있어 그대로 온다.

---

## 5. 데이터 모델 · API

### 5.1 표 (마이그레이션 `2026111x_articles`)

```prisma
model ArticleWriter {            // 필진 = 글쓰기 권한. 역할로 가르지 않는다
  userId      Int      @id
  invitedById Int?
  createdAt   DateTime @default(now())
}
model Article {
  id              Int       @id @default(autoincrement())
  authorId        Int
  galleryId       Int?                      // 글쓴이를 갤러리로 표시(작성자가 주인인 갤러리만)
  kind            String                    // lib/articleKinds.ts
  status          String    @default("DRAFT") // DRAFT | PUBLISHED | HIDDEN(관리자)
  title           String    @default("")
  subtitle        String?
  coverUrl        String?
  coverWidth      Int?
  coverHeight     Int?
  doc             Json      @default("{}")    // 공개본
  docVersion      Int       @default(1)
  excerpt         String    @default("")      // 서버가 doc 에서 뽑는다(요약을 적었으면 그것)
  imageUrls       String[]  @default([])      // doc 안 사진 주소(파일 정리·표지 후보)
  readingMinutes  Int       @default(1)
  seriesId        Int?
  seriesOrder     Int?
  commentsEnabled Boolean   @default(true)
  featuredAt      DateTime?                   // 추천 고정 — 시각(순서가 있어야 한다, Post.pinnedAt 과 같은 이유)
  publishedAt     DateTime?                   // 처음 발행한 때(다시 발행해도 안 바뀐다)
  likeCount       Int       @default(0)
  commentCount    Int       @default(0)
  viewCount       Int       @default(0)
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
  @@index([status, publishedAt]) @@index([authorId]) @@index([galleryId]) @@index([seriesId]) @@index([featuredAt])
}
model ArticleDraft {             // 작업본 — 공개 응답에 싣지 않는다
  articleId   Int      @id
  title       String   @default("")
  subtitle    String?
  coverUrl    String?
  kind        String?
  galleryId   Int?
  summary     String?                        // 직접 적은 한 줄 요약
  doc         Json
  imageUrls   String[] @default([])
  rev         Int      @default(0)           // 저장할 때마다 +1 — 다른 기기·탭 충돌 판정
  updatedAt   DateTime @updatedAt
}
model ArticleAsset {             // 이 글에 올린 사진(파일 정리 · 사진 보관함)
  id        Int      @id @default(autoincrement())
  articleId Int
  url       String
  width     Int?
  height    Int?
  createdAt DateTime @default(now())
  @@index([articleId])
}
model ArticleLike    { articleId Int; userId Int; createdAt DateTime @default(now()); @@id([articleId, userId]) }
model ArticleComment { id Int @id @default(autoincrement()); articleId Int; authorId Int; body String; createdAt DateTime @default(now()); @@index([articleId, createdAt]) }
model ArticleSeries  { id Int @id @default(autoincrement()); authorId Int; title String; createdAt DateTime @default(now()) }   // M5
```

불변식: **`ArticleDraft` 가 있다 ⇔ 발행 안 된 변경이 있다.** 발행하면 작업본을 지운다. 발행한 적 없는 글은 내용이 작업본에만 있다.

⚠️ 새 표는 `backend/src/__tests__/helpers.ts` `cleanDb()` 에 추가한다(빠지면 테스트 사이로 새어 엉뚱한 실패). 복합 키·문자열 키 표는 `ALL_TABLES`(시퀀스 리셋 목록)에 넣지 않는다 — `ArticleWriter`·`ArticleDraft`·`ArticleLike` 는 `deleteMany` 로.

### 5.2 API (`routes/article.ts`, `/api/articles`)

| 메서드·경로 | 누가 | 하는 일 |
|---|---|---|
| `GET /` | 누구나 | 발행된 글 목록. `kind`·`author`·`gallery`·`cursor`(id). 추천 고정 먼저(`nulls: 'last'` 필수 — Postgres 는 DESC 에서 NULL 이 앞) |
| `GET /mine` | 필진 | 내 글 전부(초안 포함, '수정 중' 표시). ⚠️ `/:id` 보다 **먼저** 선언 |
| `GET /:id` | 누구나(`optionalAuth`) | 공개본 + 카드 블록이 가리키는 대상(`entities`) + 내가 좋아요했나. `PUBLISHED` 가 아니면 글쓴이·관리자 말고는 **404**(403 금지 — 규칙 23). 조회수는 `bumpViewCount` 방식 |
| `POST /` | 필진 | 빈 초안 생성 → `{id}`. 초안 30개 상한은 `withKeyLock`(세고 나서 만들기 — 규칙 62) |
| `GET /:id/draft` | 글쓴이 | 작업본(없으면 공개본을 `rev 0` 으로 돌려주되 **행은 만들지 않는다**) |
| `PUT /:id/draft` | 글쓴이 | 자동 저장. `{baseRev, title, subtitle, coverUrl, kind, galleryId, summary, doc}` → `updateMany({where:{articleId, rev: baseRev}, data:{…, rev:{increment:1}}})`, 0건이면 **409** `{rev, updatedAt}`. 작업본이 없으면 `createMany skipDuplicates`. 확인하고 쓰지 않는다(규칙 46) |
| `DELETE /:id/draft` | 글쓴이 | 변경 버리기(발행한 적 없는 글이면 글째로 삭제) |
| `POST /:id/publish` | 글쓴이 | 작업본을 **엄격 검증**(제목 1~80자 · 본문 있음 · 종류 있음) → 공개본에 복사 + 발췌·읽는 시간·`imageUrls`·표지 계산 → 작업본 삭제. 처음 발행이면 이웃 알림 |
| `POST /:id/unpublish` | 글쓴이 | 내리기(`DRAFT` 로, `publishedAt` 유지) |
| `DELETE /:id` | 글쓴이·관리자 | 글 + 이 글의 `ArticleAsset` 파일 삭제(§8.6 의 '다른 글이 쓰는 주소는 안 지운다' 확인 뒤) |
| `PUT /:id/like` | 로그인 | `{liked}` **상태를 적어 보낸다**(토글 아님, 멱등). `deleteMany`/`createMany` + 바뀐 행 수만큼 `likeCount`(규칙 46) |
| `GET·POST /:id/comments` · `DELETE /:id/comments/:cid` | 누구나 읽기 · 로그인 쓰기 · 글쓴이/작성자/관리자 삭제 | 평평한 목록, 2,000자 |
| `GET /:id/assets` | 글쓴이 | 이 글에 올린 사진(사진 보관함, M5) |
| `PATCH /:id/feature` · `PATCH /:id/hide` | 관리자 | 추천 고정 · 숨기기 |
| `GET·PUT·DELETE /api/admin/article-writers[/:userId]` | 관리자 | 필진 목록·초대·해제 |
| `POST /api/upload/article-image?articleId=` | 그 글의 글쓴이 | §8.1 |

`/auth/me` 응답에 `canWriteArticles`(관리자이거나 `ArticleWriter` 행이 있음)를 더한다.

**`index.ts` 에서 반드시 같이 고칠 것**
- ⚠️ 본문 한도 — `app.use('/api/articles', express.json({ limit: '1mb' }))` 를 **전역 `express.json()`(96행)보다 앞**에 둔다. 뒤에 두면 전역 파서가 먼저 100KB 로 413 을 낸다.
- ⚠️ 요청 수 — `isDraftSave`(`PUT /articles/:id/draft`)를 전역 300/15분에서 빼고 **전용 한도**(15분 400회)를 준다. 자동 저장 + 사진 30장 + 다른 요청이면 전역 한도를 넘기고, 넘기면 저장뿐 아니라 그 사람의 **모든 API 가 429** 다. `isPollingRequest` 와 같은 모양으로, 술어는 단위 테스트.
- `guestPageKind` 에 `/journal`('저널')·`/journal/:id`('저널 글', `ref kind 'article'` → 제목) 추가. 빠지면 '기타'로 뭉친다.
- `SEO_ROUTES` 에 `['/journal/:id', 'article']`. ⚠️ `/journal/write` 가 `:id='write'` 로 걸린다 — 숫자가 아니면 기본 meta 로 떨어지는지 확인(테스트).

---

## 6. 문서 규칙 (`backend/src/lib/articleDoc.ts` ↔ `frontend/src/lib/articleDoc.ts` 거울)

프론트 테스트가 서버 소스의 노드·속성 목록을 읽어 대조한다(`richText.test.ts` 방식).

| 노드 | 속성 | 메모 |
|---|---|---|
| `paragraph` · `heading`(2·3) | `align: null \| 'center'` | 오른쪽·양쪽 맞춤 없음 |
| `bulletList` · `orderedList` · `listItem` · `hardBreak` · `horizontalRule` | — | |
| `blockquote` | `variant: 'line' \| 'pull'` | pull = 크게 뽑은 인용 |
| `figure` (사진 한 장, atom) | `src · width · height · alt · caption(≤200) · size: 'text' \| 'wide' \| 'full'` | `src` 는 `ownFileUrl` 통과분만 |
| `gallery` (사진 2~12장, atom) | `layout: 'row' \| 'grid' \| 'slide'` · `items: [{src,width,height,alt,caption}]` · `size` | 배열을 속성에 든다 |
| `embed` (M5, atom) | `provider: 'youtube'` · `id` | `id` 는 `^[A-Za-z0-9_-]{11}$`. **주소를 저장하지 않는다** — iframe 주소는 id 로 화면이 만든다 |
| `entityCard` (M5, atom) | `kind: 'artwork' \| 'show' \| 'exhibition' \| 'gallery' \| 'artist'` · `id` | 표시할 내용은 저장하지 않는다 — 읽을 때 서버가 공개 규칙으로 채운다 |
| `callout` (M5) | `tone: 'tip' \| 'note'` | 안에 문단·목록 |
| `beforeAfter` (M5, atom) | `before · after`(각 `{src,width,height}`) · `caption` | 전/후 비교 |

마크: `bold` · `italic` · `underline` · `strike` · `highlight` · `link{href}`. **글꼴·색·크기는 없다**(기존 편집기와 같은 이유 — 붙여 넣은 서식이 디자인을 깬다).

검증 규칙
- 모르는 **노드·마크·값** → 400. 모르는 **속성** → 조용히 버린다(TipTap 을 올려 새 기본 속성이 생겨도 저장이 막히지 않게). 그래서 화면의 '고쳤나' 판정은 **서버가 돌려준 문서가 아니라 마지막에 보낸 문서**와 비교한다(규칙 63 의 키 순서 교훈).
- 상한: 직렬화 500KB · 보이는 글자 5만 · 사진 100장 · 깊이 8 · 최상위 블록 800.
- 두 모드: `draft`(빈 제목·빈 본문 허용) / `publish`(엄격).
- 읽는 쪽(`readArticleDoc`)은 **던지지 않는다** — 틀린 노드는 건너뛴다(직접 호출로 넣은 값 하나에 화면이 500 나지 않게, 규칙 63).
- `docVersion` 으로 나중의 형식 변경을 가른다.

서버가 뽑는 값(`lib/articleDerive.ts`): `excerpt`(문단 경계에 띄어쓰기를 넣고 120자) · `readingMinutes`(한글 분당 500자 + 사진 한 장 10초) · `imageUrls` · 표지(지정이 없으면 첫 사진).

---

## 7. 편집 화면

### 7.1 틀
```
[← 나가기]        저장됨 · 방금        [미리보기] [발행]      ← 위 줄(고정)
─────────────────────────────────────────────────────────
  (종류)                                                  ← 본문(이 안에서만 스크롤)
  제목을 적어 주세요
  부제(선택)
  본문 …
─────────────────────────────────────────────────────────
[사진][제목][B][인용][목록][링크][가운데] … [자판 내리기]    ← 도구 막대(PC 는 위 줄 아래에 붙고, 휴대폰은 자판 위)
```
- 파일: `pages/JournalWritePage.tsx`(껍데기·`lazy`) → `components/article-editor/`(`ArticleEditor.tsx` · `Toolbar.tsx` · `MobileToolbar.tsx` · `nodes/FigureNode.tsx` · `nodes/GalleryNode.tsx` · `PublishSheet.tsx` · `CropDialog.tsx` · `useAutosave.ts`) · 판단은 `lib/articleEditor.ts`·`lib/articleAutosave.ts`(순수 함수 — 가짜 시계로 테스트).
- 제목·부제는 문서 밖 `<textarea>`(자동 높이). 제목에서 Enter → 본문 첫 줄. 한글 조합 중(`isComposing`) Enter 는 건드리지 않는다(규칙 60).
- 도구 단추는 `onMouseDown preventDefault`(누를 때 선택·자판이 안 풀리게 — 기존 편집기와 같다), 켜짐 상태는 `useEditorState` 선택자로(트랜잭션마다 전체를 다시 그리지 않는다).
- **PC**: 위 줄 아래 붙는 도구 막대 + 글자를 고르면 뜨는 작은 막대(B·I·U·링크·제목·인용, `@tiptap/react/menus`) + 빈 줄 왼쪽 [+](사진·영상·구분선·인용·카드). 블록 옮기기는 NodeView 의 `data-drag-handle` + Dropcursor(추가 패키지 없이) · `Alt+↑/↓`.
- **휴대폰**: 고르면 뜨는 막대는 **없다**(iOS 의 복사/찾아보기 메뉴와 겹친다) — 판정은 기존 `useFinePointer`. 서식은 자판 위 막대 한 줄(옆으로 민다, 단추 44px). 사진을 고르면 막대가 사진용으로 바뀐다: [크기][자르기][설명][위로][아래로][삭제]. 블록 옮기기는 [위로][아래로].
- 빈 새 글에는 '틀에서 시작'(M5) 한 줄.

### 7.2 휴대폰 자판 — 화면을 '보이는 영역'에 맞춘다
- 편집 화면 뿌리를 `position: fixed; inset: 0 auto auto 0; width: 100%; height: var(--vvh)` 로 두고 `--vvh = visualViewport.height`, `transform: translateY(visualViewport.offsetTop)`. 안은 flex 세로 [위 줄 · 본문(`flex-1 overflow-y-auto`) · 도구 막대]. 이러면 iOS(자판이 화면을 덮는다)·안드로이드 크롬(보이는 영역만 준다)·앱 WebView(레이아웃이 준다) 어디서든 막대가 자판 바로 위다. `bottom: N` 으로 따라가는 방식은 쓰지 않는다(떨린다).
- 편집 화면이 떠 있는 동안 `html, body { overflow: hidden; overscroll-behavior: none }` — iOS 가 커서를 보이려고 페이지를 밀 자리가 없어야 한다. 나갈 때 반드시 되돌린다(E2E 가 스크롤 잠금 풀림을 본다 — 규칙 73 R4 와 같은 검사).
- 커서가 막대 뒤로 숨지 않게 `editorProps.scrollMargin/scrollThreshold`.
- 훅 `hooks/useVisualViewport.ts` — 상태 기계는 가짜 `visualViewport` 로 단위 테스트, 진짜 자판은 에뮬레이터(§14.7).

### 7.3 붙여넣기 · 끌어 놓기
- `transformPastedHTML` 로 스타일·클래스·글꼴을 떼고 우리 노드로만 받는다(네이버 블로그·워드·구글 문서·노션 조각을 픽스처로).
- 붙여 넣은 글 안의 **바깥 사진은 넣지 않는다**(서버가 어차피 거절한다). "붙여 넣은 글의 사진 N장은 빠졌어요 — 사진은 직접 올려 주세요" 한 번 알린다.
- 사진 **파일**을 붙이거나 끌어 놓으면 그 자리에 올린다(`editorProps.handlePaste/handleDrop` 직접 — 확장 의존 없이).
- 빈 줄에 유튜브 주소만 붙이면 영상 블록(M5), 그 밖의 주소는 링크.

### 7.4 미리보기 · 발행 창
- [미리보기] = 지금 문서를 `ArticleBody` 로 그린 덮개(PC 폭 / 휴대폰 390px 틀 전환). 새 주소 없음.
- 발행 창(`role="dialog" aria-modal`, Esc): 종류 · 표지(문서 속 사진 중 고르기, 목록 카드 모양으로 미리 보여 준다) · 한 줄 요약(자동, 고칠 수 있음) · 글쓴이 표시 · 댓글 받기. 사진을 올리는 중이면 [발행]이 기다린다.
- 발행 뒤 글 화면에서 한 번: "발행했어요 [링크 복사] [공유]" — 글쓴이가 자기 글을 퍼뜨리는 게 유입의 시작이다. 앱이면 `shareLinkNative`.

---

## 8. 사진

### 8.1 올리기 — 전용 길 `POST /api/upload/article-image?articleId=`
- 기존 `/upload/image` 와 같은 multer·`normalizeUploadImage`·`uploadSlot`, 더해서 ①응답에 **`{url, width, height}`**(`dimsFromBuffer`) ②썸네일을 `t240`·`t800`·**`t1280`**(q82)까지 ③`ArticleAsset` 한 줄.
- ⚠️ `t1280` 은 `THUMB_SPECS` 에 넣지 않는다(모든 업로드가 한 장씩 더 굽게 된다). 대신 `deleteUploadedFile` 이 **이 폴더도 지우게** 한다 — 지금은 `THUMB_SPECS` 만 돈다(`lib/storage.ts`). 지울 폴더 목록을 `lib/thumb.ts` 한 곳(`ALL_THUMB_DIRS`)으로.
- ⚠️ 썸네일 백필 목록(`backfill-thumbs.ts SOURCES`, 규칙 21b)에 `Article.imageUrls`·`coverUrl` 을 더한다.
- 화면: `compressImage` → 올리기. **한 번에 2장씩**(서버는 3장까지, 30장 넘게 밀리면 503 — 화면이 줄을 세운다). 장마다 진행률·실패·[다시]. 503·네트워크 실패는 자동 재시도(2·5·15초).
- 올리는 동안은 로컬 미리보기(blob). 문서에는 `uploadId` 를 단 임시 노드가 들어가고, 불변식 넷:
  1. 자동 저장에 보낼 땐 **아직 `src` 없는 노드를 뺀다**.
  2. `src` 를 채우는 트랜잭션은 되돌리기 기록에 넣지 않는다(`addToHistory: false`).
  3. 노드는 위치가 아니라 `uploadId` 로 찾는다(올리는 사이에 글이 바뀐다). 그새 지워졌으면 결과를 버린다.
  4. `src` 도 없고 올리는 중도 아닌 노드(새로고침·되돌리기로 남은 것)는 스스로 지운다.
- 못 올리는 파일: HEIC(안드로이드·PC) → "HEIC 사진은 올릴 수 없어요. JPG 로 바꿔 올려 주세요" · 15MB 초과 · 사진 아님. 한 장이 실패해도 나머지는 계속.
- 여러 장을 한 번에 고르면 묻는다: **[한 장씩] [모아 놓기] [넘겨 보기]** (네이버 블로그 편집기의 개별·콜라주·슬라이드와 같은 익숙한 물음).

### 8.2 배치
- 크기 셋: `text` 본문 폭(680px) · `wide` 넓게(1040px) · `full` 본문 영역 끝까지.
  ⚠️ `full` 을 `100vw` 로 만들지 않는다 — PC 에서 로그인하면 오른쪽 사이드바(224px)만큼 본문 영역이 좁다. 글 컨테이너 기준으로 넓힌다.
- 모아 놓기(`row`·`grid`): **정렬 줄** — 한 줄의 사진 높이가 같고 폭은 비율만큼. CSS 만으로(`flex: <비율> 1 0` + `aspect-ratio`). `grid` 는 줄 나누기만 순수 함수(`lib/articleLayout.ts galleryRows`). 사진을 자르지 않는다(규칙 18 의 취지).
- 넘겨 보기(`slide`): CSS scroll-snap(라이브러리 없이) + 점 표시.
- 사진마다 설명(캡션)·대체 글(없으면 설명을 쓴다). 설명 칸은 NodeView 안의 진짜 `<input>` — ProseMirror 가 그 키 입력을 가로채지 않게 `stopEvent`.
- 글 옆으로 흘리는 배치(float)는 **하지 않는다** — 휴대폰에서 무의미하고 레이아웃 사고의 원천이다.

### 8.3 자르기 · 돌리기 (`CropDialog`, 따로 받는 청크)
- 이미 올린 사진을 다시 받아 canvas 에 그린다 → ⚠️ R2 사진은 `lib/imageFetch.ts fetchImageOnce` 로(규칙 16 — 평범한 `<img>` 캐시 때문에 CORS fetch 가 막히는 함정, 그리고 `fetchImage` 는 페이지가 끝날 때까지 쥔다).
- 비율: 자유 · 1:1 · 4:5 · 3:2 · 16:9. 돌리기 90°. 결과는 JPEG 0.9, 긴 변 2000px → **새 파일로 올려** 노드의 `src·width·height` 를 바꾼다.
- 1순위 `react-image-crop`(자유 비율 손잡이, 포인터 이벤트, 의존성 0) + 돌리기는 canvas 로 직접. 사파리 엔진·에뮬레이터 터치에서 불안하면 `cropperjs` 1.6 으로 바꾼다(M3 시작에 한 시간 스파이크).
- ⚠️ **원본 주소를 문서에 남기지 않는다**(`origSrc` 같은 것). 얼굴·주소를 잘라 낸 사람의 원본이 공개 JSON 으로 샌다. 되돌리기는 편집기의 실행 취소로 충분하다(옛 파일은 하루 뒤에 정리 — §8.6).

### 8.4 읽는 화면의 사진
- `ArticleImage`: `width/height` 로 자리를 먼저 잡는다(`aspect-ratio`) → **레이아웃 밀림 0**.
- `srcset = t800 800w, t1280 1280w, 원본 <width>w` + 배치별 `sizes`. ⚠️ 썸네일은 비동기라 없을 수 있다 — `onError` 면 srcset 을 버리고 원본으로(`Thumb` 과 같은 폴백). GIF 는 srcset 없이 원본(썸네일은 첫 프레임뿐이다).
- 첫 사진만 `fetchpriority="high"`, 나머지는 `loading="lazy"`(자리를 잡아 두었으므로 늦게 떠도 안 밀린다).
- 누르면 `ImageLightbox`(원본, 설명 포함, 글 안 사진 전체를 넘겨 본다). 부모가 `AnimatePresence` 로 감싼다(규칙 11).

### 8.5 표지
- 목록 카드·공유 미리보기(og:image)용. 글 화면 맨 위에 따로 그리지 않는다(첫 사진과 겹친다).
- 카드는 4:3 `object-cover`(DESIGN.md 6) — 발행 창이 그 모양으로 미리 보여 주고 다른 사진을 고르게 한다.

### 8.6 파일 정리
- 대상은 **`ArticleAsset` 에 적힌 주소뿐**('내 작품에서 고른' 포트폴리오 사진은 이 글의 것이 아니다 — 절대 지우지 않는다).
- 지우기 전 확인: 그 주소가 **다른 글·작업본의 `imageUrls` 에 없을 때만**(글 사이 복사·붙여넣기로 같은 주소를 쓸 수 있다 — 규칙 66 의 첨부파일 교훈).
- 글 삭제 때 즉시(M1). 본문에서 뺀 사진은 발행 때 + 하루 지난 것만(M6, 실행 취소·다른 기기 작업본 보호).

---

## 9. 쓰던 글을 잃지 않게

| 사고 | 막는 법 |
|---|---|
| 그냥 닫음·새로고침 | 자동 저장: 마지막 입력 2.5초 뒤, 최소 8초 간격, **한 번에 하나만**(진행 중이면 끝난 뒤 최신 것 하나). 창이 가려질 때·발행 전·나갈 때·Ctrl+S 는 즉시 |
| 네트워크 끊김·서버 오류 | 상태 줄 "저장 못 함 — 다시 시도 중". 5·10·30·60초 간격으로 계속. **이 기기 보관**(localStorage, 글마다 한 칸, 1.5초 모아 쓰기)은 서버가 받았다고 답할 때까지 지우지 않는다 |
| 닫는 순간의 마지막 몇 초 | `fetch keepalive` 는 64KB 가 한도라 긴 글은 못 보낸다 → 이 기기 보관이 안전망. 다음에 열면 "이 기기에 저장 못 한 글이 있어요 [이어서 쓰기] [서버 것으로]" |
| 로그인 만료(401) | 저장이 401 이면 **로그아웃시키지 않고**(이 요청만 인터셉터 예외) "다시 로그인해 주세요" + 이 기기 보관 유지 + `setPostLoginRedirect('/journal/write/:id')` |
| **배포 중 자동 새로고침** | `lib/swUpdate.ts` 에 `holdReload()`/해제를 더하고 `main.tsx` 의 `reload` 가 그걸 본다. 편집 화면이 떠 있는 동안은 미뤘다가 나갈 때 새로고침. 지금은 쓰는 중에도 `location.reload()` 가 그대로 나간다 |
| 배포 뒤 옛 청크 404 | 편집 화면에 들어올 때 자르기 창·고르기 창 청크를 **미리 받아 둔다**. 편집 화면 안의 lazy 는 자동 새로고침하지 않고 "새 버전이 나왔어요 [저장하고 새로고침]" |
| 다른 기기·탭에서 고침 | `rev` 불일치 409 → "다른 곳에서 고친 내용이 있어요 [그 내용 불러오기] [지금 내용으로 덮어쓰기]". 말없이 덮지 않는다 |
| 요청 한도(429) | 자동 저장은 전용 한도(§5.2). 429 도 '저장 못 함'으로 다뤄 재시도 |
| 발행한 글을 고치다 만 것 | 작업본에만 저장된다 — 공개본은 [수정 발행] 전까지 그대로 |

`useUnsavedChanges`(confirm + 가드 히스토리)는 편집 화면에 쓰지 않는다 — 자동 저장 화면에서 confirm 은 거의 늘 헛경고고, 가드 히스토리가 주소 조작과 어긋난 전례가 있다(규칙 60). `beforeunload` 는 '서버가 아직 못 받은 변경이 있을 때'만.

---

## 10. 읽는 화면 · 목록 · 진입점

- **글 `/journal/:id`**(`pages/JournalArticlePage.tsx`): 종류 라벨 → 제목(h1) → 부제 → 글쓴이 줄(사진·이름 → 홈페이지 · 날짜 · N분) → 본문(`<article>`, 본문 안 제목은 h2·h3) → 좋아요·공유 → 글쓴이 카드(이웃 추가 `FollowButton` · 홈페이지) → 시리즈 앞뒤 글(M5) → 이 글쓴이의 다른 글·함께 읽을 글 3개 → 댓글.
  위쪽 2px 읽기 진행 줄. 비회원이 좋아요·댓글을 누르면 이 글을 기억하고 로그인으로.
- **목록 `/journal`**: 화면 이름(로고 규칙) + 종류 필터(글자 버튼 — DESIGN.md 5, 알약 금지) + 카드 격자(표지 4:3 · 종류 · 제목 · 발췌 2줄 · 글쓴이 · 날짜), 추천 글은 맨 위 크게. 커서(id) 무한 스크롤 — sentinel 은 격자 밖.
- **홈**: `ArtWorks` 아래 저널 줄(큰 카드 1 + 작은 카드 3, [모두 보기]). ⚠️ 글이 0개면 **섹션째로 그리지 않는다** — 감싼 `<section>` 여백만 남은 빈 띠가 난 전례(ArtWorks).
- **커뮤니티 맨 위**: 최신 글 3개 띠 + [저널 모두 보기].
- **작가·갤러리 홈페이지 [글] 탭**(M4): `lib/homepageTabs.ts`·`lib/galleryTabs.ts` 에 탭 추가(글이 있을 때만 — 빈 탭 금지). `GET /portfolio/:id`·`GET /galleries/:id` 에 `articleCount`.
- **알림**: 처음 발행 → 이웃에게 `ARTICLE_NEW`("○○님이 새 글을 올렸어요: 제목", `/journal/:id`, `refKey article:<id>`, `createMany`). 댓글 → 글쓴이에게 `ARTICLE_COMMENT`. 좋아요는 글마다 하나로 합친다(`ARTWORK_LIKE` 방식).
  ⚠️ `PUSH_TITLES` 에 새 종류를 넣는다 — `push.test.ts` 가 소스의 `type: '…'` 를 훑는다.
- **공유 미리보기**: `seoMeta.ts` 에 `'article'`(제목 · 발췌 · 표지, `buildMetaTags()` 통과 — 규칙 25). `sitemap.xml` 에 발행 글.
- **마이페이지**: 필진에게 [내 글] 탭, 관리자에게 [저널 관리] 탭. ⚠️ `lib/myPageMenu.ts` 에 항목을 더하면 `MyPage.tsx` 의 `currentTab === '…'` 분기도 — 빠지면 에러 없이 빈 화면(`myPageMenu.test.ts` 가 대조).
- **팝업**: `introAllowedAt`·`nudgePlace` 에 `/journal/write` 를 넣는다(편집 화면이 `Layout` 밖이라 원래 안 뜨지만 규칙을 맞춰 둔다). 글 화면(`/journal/:id`)에는 소개 팝업이 뜬다(공모 상세와 같은 취급).

---

## 11. 디자인

DESIGN.md(SPACE 매거진 — 흑백 + 빨강 하나, 장식 없음)를 그대로 따른다. 이 기능은 매거진 지면 그 자체라 그 문서와 가장 잘 맞는 화면이다.

- 본문: Pretendard 17px / 줄 간격 1.9 / `text-gray-800`(휴대폰 16px / 1.85). 문단 사이 1em. 본문 폭 680px. 모든 글 자리에 `break-keep [overflow-wrap:anywhere]`(규칙 30).
- 제목 `text-3xl md:text-4xl font-semibold`, 본문 안 제목 22px·18px `font-semibold text-gray-900`.
- 사진 설명 13px `text-gray-500` 가운데. 뽑은 인용은 22px `font-medium` 에 위아래 1px 선.
- 팁 상자: 1px `border-gray-200` + 작은 라벨. **색 배경 없음**.
- 형광펜: 아래 40% 만 `accent/15`(글자 뒤 전체를 칠하지 않는다).
- 편집 화면 틀: 1px `gray-200` 선, 아이콘 18px `text-gray-600`, 켜짐은 `bg-gray-900 text-white`(기존 편집기 단추와 같다). 주 버튼은 [발행] 하나(검정). 빨강은 `text-accent` 토큰만(규칙 47 — `singleAccent.test.ts`).
- 떠 있는 것(고르면 뜨는 막대·[+] 메뉴)만 1px 선 + 아주 옅은 그림자. 카드·사진에 그림자·`rounded-2xl`·hover 확대 없음.
- 스타일은 `index.css` 의 `.article-body` **한 곳** — 편집기 뿌리와 읽는 화면이 같은 클래스.

---

## 12. 이 저장소에서 걸리는 것 (구현 전 체크)

1. 본문 한도 100KB · 요청 한도 300/15분 — §5.2.
2. 배포 중 자동 새로고침 · 옛 청크 404 새로고침 — §9.
3. grid 안 칸마다 `min-w-0`(규칙 27) · 긴 무공백 글 `overflow-wrap:anywhere`(규칙 30).
4. R2 사진을 fetch 할 땐 `fetchImageOnce`(규칙 16·74).
5. PNG 는 JPEG 로 바뀌어 확장자가 달라진다 — 화면이 주소를 추측하지 말고 응답의 `url` 을 쓴다(규칙 55).
6. 썸네일 주소는 `thumbKey` 규칙으로 조립(문자열 `replace` 금지 — 규칙 21).
7. 새 표 → `cleanDb()`. 새 알림 종류 → `PUSH_TITLES`. 새 공개 화면 → `guestPageKind`. 새 마이페이지 탭 → `MyPage.tsx` 분기. 새 창 → `role="dialog" aria-modal` + Esc(앱 뒤로가기, 규칙 79).
8. 편집기 청크를 PWA 미리받기에서 뺀다 — `vite.config.ts globIgnores` 에 `**/ArticleEditor-*.js`·`**/CropDialog-*.js`. `manualChunks` 로 묶지 않는다(규칙 79 의 교훈).
9. '한 번만' 표시(ref)는 그 일을 실제로 한 뒤에 세운다 — 개발 서버(StrictMode)는 effect 를 두 번 돌린다(규칙 61). 초안 불러오기·보관 복원 물음·`POST /articles` 가 두 번 나가지 않게.
10. `@tiptap/*` 는 **전부 같은 버전**(지금 3.31.3). 더할 것: `extension-text-align` · `extension-highlight`(설치 전 `npm view` 로 3.31 대 존재·peerDeps 확인). `Placeholder`·`CharacterCount`·`Dropcursor` 는 이미 있는 `@tiptap/extensions` 에, 메뉴는 `@tiptap/react/menus` + 이미 있는 `@floating-ui/dom`. 새 의존성은 `react-image-crop` 하나.
11. 기존 `RichTextEditor`·`lib/richText.ts` 는 **건드리지 않는다**(갤러리·공모·전시 소개가 쓴다).
12. 탈퇴한 글쓴이의 글은 숨긴다(`HIDDEN`) — 탈퇴 처리에 한 줄.
13. 실서버 브라우저 점검은 비콘을 막고(규칙 64), E2E `DATABASE_URL` 에 Prisma 옵션을 붙이지 않는다.

---

## 13. 단계 (main 에서 `feature/journal` 브랜치)

각 단계 끝에 그 단계의 테스트 + `npm run build`(프론트·백 — 배포 빌드는 테스트 타입까지 본다)를 통과시키고 멈춘다.

### M1 — 서버와 문서 규칙 (크기: 중)
표·마이그레이션 · `articleDoc`(검증·읽기·파생) 양쪽 + 거울 테스트 · `routes/article.ts`(초안·발행·읽기·목록·삭제·좋아요·댓글) · 필진 권한 · `upload/article-image` · `index.ts` 한도 둘 · `cleanDb`.
**완료 기준**: §14.2 서버 테스트 전부 통과. 화면 없이 API 만으로 [초안 → 저장 → 충돌 409 → 발행 → 공개 읽기 → 수정 발행 → 삭제(파일까지)] 가 돈다.

### M2 — 글 편집기 + 읽기 렌더러 + 저장 안전망 (크기: 대)
**먼저 스파이크 하루**: 빈 편집 화면(TipTap + 사진 자리표시 NodeView 하나 + 자판 위 막대)을 에뮬레이터 앱·사파리 엔진·휴대폰 크롬에서 연다 — 한글 입력, 사진 블록 앞뒤에서 지우기·Enter, 막대 위치. 여기서 구조가 안 서면 §7.2 를 고친 뒤 간다.
그다음: 편집 화면 틀(`Layout` 밖) · 제목·부제 · 글 서식 전부 · PC·휴대폰 도구 막대 · 붙여넣기 규칙 · `useAutosave` + 이 기기 보관 + 409 · `holdReload` · `ArticleBody` + `.article-body` · 미리보기.
**완료 기준**: 글만으로 쓰고 → 새로고침해도 남고 → 미리보기 = 편집 모양(§14.4 일치 검사) · §14.6 사고 훈련 9개 통과 · §14.5 한글 조합 검사 통과.

### M3 — 사진 (크기: 대)
올리기(여러 장·붙여넣기·끌어 놓기·진행·재시도) · `figure`(크기·설명·대체 글) · `gallery`(줄·격자·넘겨 보기, 묶기·풀기·순서) · 블록 옮기기 · 자르기·돌리기 · 표지 고르기 · `ArticleImage`(srcset·폴백) · 크게 보기.
**완료 기준**: §14.3 사진 E2E · §14.4 기하(정렬 줄 폭 합 = 컨테이너 ±1px, 밀림 0) · 80장 문서 성능 예산.

### M4 — 발행 · 읽는 화면 · 목록 · 진입점 (크기: 대)
발행 창 · 글 화면 · 목록 · 홈 줄 · 커뮤니티 띠 · 홈페이지 [글] 탭 · 좋아요·댓글·공유 · 이웃 알림 + 푸시 제목 · 공유 미리보기·사이트맵 · `guestPageKind` · [내 글] · [저널 관리](필진·숨기기·추천).
**완료 기준**: 섭외 → 쓰기 → 발행 → 이웃 알림 → 읽기 → 댓글의 E2E 한 줄기. **여기까지가 내보낼 수 있는 1차**(관리자만 먼저 써 본다 — §17).

### M5 — 더하는 것 (크기: 중, 항목별로 따로 넣고 뺄 수 있다)
영상 블록 · ArtLink 카드 · 내 작품에서 고르기 · 팁 상자 · 글감 틀 · 시리즈 · 사진 보관함(휴대폰 → PC) · 전/후 비교 · 글쓴이 통계.
⚠️ 영상 블록은 앱(WebView)에서 iframe 이 제자리에서 도는지 에뮬레이터로 먼저 본다. 안 되면 앱에서는 미리보기 그림 + 눌러서 바깥으로(웹은 눌렀을 때만 iframe 을 싣는다 — 어차피 같은 모양이다).

### M6 — 전수 검증 · 문서 · 배포 준비 (크기: 중)
§14 전부 · 본문에서 뺀 사진 정리 · `CLAUDE.md` 규칙 80 + Query Key 표 · `architecture.md` · `HANDOFF.md` · 개인정보처리방침·이용약관 검토(§17) · 실기기 점검표를 사용자에게.

---

## 14. 검증 계획

원칙 — 이 저장소가 배운 것 그대로: **보이는지가 아니라 눌러서 무슨 일이 나는지** · **크롬만 믿지 않는다**(E2E 는 크롬 한 엔진, 개발 서버) · **jsdom 은 레이아웃을 못 잰다** · **임계값은 통과시키려고 고치지 않는다**.

### 14.1 단위 (프론트 vitest)
- `articleDoc` — 허용·거절·속성 버리기·상한·읽기는 안 던짐 · **서버 소스와 목록 대조**.
- `articleAutosave` 상태 기계(가짜 시계) — 모아 보내기·최소 간격·한 번에 하나·늦게 온 응답·재시도 간격·409·401·보관 지우는 시점.
- `articleLayout`(줄 나누기) · `articleDerive` 거울(읽는 시간·발췌) · `useVisualViewport`(가짜 viewport).
- `ArticleBody` — 모든 노드 스냅샷 · 모르는 노드 건너뜀 · 링크 `rel`·안팎 구분(`siteLink`).
- 소스 가드 — 읽는 화면·`ArticleBody` 가 `@tiptap/*` 를 import 하지 않는다 · 편집 화면 라우트가 `Layout` 밖 · `PUSH_TITLES` · `globIgnores` · `/journal/write` 가 팝업 제외 목록에.
- `swUpdate` — 붙들고 있으면 새로고침을 미루고 놓으면 한다.

### 14.2 서버 (vitest + supertest, `artlink_test`)
- 문서 검증: `javascript:` 링크 · 바깥 사진 주소 · `//evil` · `data:` · 모르는 노드 · 깊이·크기 초과 · 영상 id 형식.
- 권한: 필진 아님 403 · 남의 초안 404 · `DRAFT`/`HIDDEN` 공개 읽기 404(글쓴이·관리자만) · 남의 갤러리를 글쓴이로 400 · 남의 글에 사진 올리기 403.
- **작업본이 새지 않는다**: 작업본에만 넣은 표식 문자열이 목록·읽기·홈·홈페이지 응답 어디에도 없다.
- 저장: `rev` 충돌 409 · 동시 저장 10개 → 정확히 1개 성공 · 초안 상한 동시 생성.
- 발행: 파생 값 · 처음 한 번만 이웃 알림(다시 발행·내렸다 올리기엔 없음) · 탈퇴·관리자 제외.
- 좋아요 동시 10번 → 전부 200, 수 = 1 · 댓글 권한.
- 삭제: 이 글 파일만, **다른 글이 쓰는 주소는 남는다** · `t1280` 까지 지운다.
- `index.ts`: 400KB 저장 통과 · 1MB 초과 413 · `isDraftSave` 술어.
- 공유 미리보기 `/journal/:id` · `/journal/write` 는 기본 meta · `guestPageKind`.

### 14.3 E2E (Playwright, 스펙 `79`~`83`, 데모 DB) — PC 1280 + 휴대폰 390 둘 다
- `79-journal-write`: 제목 Enter → 본문 · 서식 전부를 **도구 막대로** · 자동 저장 표시 → 새로고침 뒤 그대로 · 미리보기 · 발행 → 비회원 화면의 요소를 센다 · 고치기 → [수정 발행] 전에는 공개본 그대로.
- `80-journal-photos`: **진짜 파일**로 한 장·다섯 장(세 가지 물음)·붙여넣기·끌어 놓기 · 크기 셋 · 설명 · 묶기·풀기·순서 · 자르기(결과 치수 확인)·돌리기 · 표지 · 올리는 중 [발행] 대기 · 업로드 500·503 가로채기 → [다시] · 올리는 중 새로고침 → 죽은 노드 없음.
- `81-journal-read`: 목록·종류 필터·무한 스크롤 · 홈 줄(0개면 섹션 없음) · 좋아요(비회원 → 로그인 → 돌아옴) · 댓글 · 공유 · 크게 보기 · 홈페이지 [글] 탭 · 알림을 눌러 그 글에 도착.
- `82-journal-admin`: 필진 초대 → [내 글] 생김 · 해제 · 숨기기(공개 404) · 추천 고정 순서.
- `83-journal-reliability`: §14.6.
- 헬퍼(`e2e/lib/helpers.ts`): `openJournalEditor` · `journalToolbar` · `typeInBody` · `uploadPhotos` · `publishArticle` · `seedArticle`(API). ⚠️ 도구 막대와 미리보기에 같은 이름이 생기면 `toolbar` 역할로 좁힌다(규칙 60 의 교훈).
- 기존 전체 E2E 를 한 번 돌려 기준선(실패는 `12`·`53` 둘)과 비교 — 홈·커뮤니티·홈페이지 탭·마이페이지를 건드리므로.

### 14.4 기하 하니스 `scratchpad/column-editor/walk.js` (크롬 + 사파리 엔진 × 320·360·390·430·768·1024·1280·1440·1920)
스크린샷이 아니라 **재서** 본다.
- 가로 밀림 0 · 화면 밖으로 나간 단추 0 · 도구 단추마다 `elementFromPoint` 가 자기 자신 · 터치 대상 ≥ 40px.
- 사진 폭이 규격대로(680·1040·본문 영역) · 정렬 줄: 폭 합 + 틈 = 컨테이너 ±1px, 한 줄 높이 차 ≤ 1px · 자르지 않음(그린 비율 = 원본 비율 ±1%).
- **편집 = 읽기 일치**: 같은 문서를 편집 화면과 읽는 화면에 그려 블록마다 글자 크기·줄 간격·위아래 여백·사진 상자 크기를 비교(±1px).
- 읽는 화면 레이아웃 밀림(`layout-shift`) = 0 · 432자 무공백 한글에도 밀림 없음.
- 로그인(사이드바 있음)·비로그인 둘 다.
- README 에 실행법·임계값의 근거를 적고 **고치기 전 결함을 실제로 잡는지** 한 번 확인한다.

### 14.5 한글 입력 · 붙여넣기 (크롬 CDP)
- `Input.imeSetComposition` 으로 조합: ㅎ → 하 → 한 → 확정 · 조합 중 Enter · 조합 중 굵게 켜기 · 제목·목록·인용 첫 글자 · 사진 블록 바로 뒤 · 링크 끝 · 조합 중 자동 저장이 글자를 깨지 않는다.
- 붙여넣기 픽스처(`e2e/fixtures/paste/` — 네이버 블로그·워드·구글 문서·노션·평범한 글): 스타일 0 · 바깥 사진 0 + 안내 · 제목·목록 구조 유지 · 결과 문서가 서버 검증 통과.
- **무작위 조작**(씨앗 5개 × 500걸음: 넣기·지우기·되돌리기·블록 옮기기·서식): 걸음마다 ①콘솔 오류 0 ②문서가 검증 통과 ③JSON 을 다시 넣어도 같은 JSON.

### 14.6 쓰던 글 지키기 훈련 (크롬 + 사파리 엔진, 전부 통과해야 M2 완료)
1. 치고 1초 안에 새로고침 → 이 기기 보관에서 살린다.
2. 네트워크를 끊고 쓰기 → '저장 못 함' → 다시 연결 → 저절로 저장.
3. 저장 응답 401 → 로그아웃되지 않고 안내 → 로그인 → 같은 글, 내용 그대로.
4. **배포 중**: 배포용 빌드 두 개로 편집 화면을 연 채 새 판을 올린다(`scratchpad/homepage-edit/returning-artist.js` 방식 — 개발 서버에는 서비스워커가 없어 E2E 로 못 본다) → 새로고침 0, 나가면 새로고침.
5. 탭 둘에서 같은 글 → 409 물음 → 두 선택지 다.
6. 저장 500 이 다섯 번 → 계속 재시도, 보관 유지 → 성공하면 지움.
7. 느린 첫 저장이 둘째보다 늦게 도착 → 내용·`rev` 어긋남 없음.
8. 옛 청크 404(자르기 창) → 자동 새로고침 없음, [저장하고 새로고침].
9. 저장소가 막힌 브라우저(localStorage 예외) → 편집·서버 저장은 정상, 화면 안 죽음.
+ 요청 한도: 20분 연속 입력 + 사진 30장 흉내 → 429 없음.

### 14.7 진짜 자판 — 안드로이드 에뮬레이터 (`emu.sh dev`)
- 본문을 눌러 자판을 올린 뒤 `emu.sh js` 로 잰다: 도구 막대 아래 끝 = `visualViewport.height`(±2px) · 커서가 막대 위 · 위 줄이 화면 안. `emu.sh shot` 으로 남긴다.
- 사진 고르기(선택기·카메라) · 다섯 장 · 자르기 창을 **뒤로가기**로 닫기(화면이 안 넘어간다) · 발행 뒤 공유 창 · 영상 블록.
- `adb shell input text` 로 넣은 글이 문서에 그대로(조합 없는 입력의 기본기).

### 14.8 성능 예산 (넘으면 보고하고 멈춘다)
| 항목 | 예산 |
|---|---|
| 편집기 청크(gzip) | ≤ 200KB (지금 소개 편집기가 약 100KB) |
| 읽는 화면에 더해지는 JS(gzip) · 그 안의 TipTap | ≤ 20KB · 0 |
| 입력 지연 p95 — 사진 80장·2만 자·CPU 4배 감속 | ≤ 50ms |
| 자동 저장 한 번 — 본문 크기 · 서버 처리 | ≤ 500KB · ≤ 150ms |
| 읽는 화면 LCP — 휴대폰·느린 4G, 사진 20장 글 | ≤ 2.5초 |
| 읽는 화면 사진 전송량 — 휴대폰, 사진 20장 | 원본 대비 절반 이하(`t1280` 효과를 실측) |
| 레이아웃 밀림 | 0 |

### 14.9 보안 점검 (M6, `/security-review` 한 번 + 손으로)
저장형 XSS(읽는 화면에 `dangerouslySetInnerHTML` 없음 · 링크·영상 주소) · 남의 글·갤러리·시리즈·사진(IDOR) · 작업본 유출 · 원본 주소 유출(§8.3) · 업로드 남용(필진만, 한도) · 서버가 사용자 주소를 가져오는 곳 없음(SSRF 0) · 숨긴 글의 사진 주소는 여전히 열린다는 점을 문서에 적는다(R2 공개 주소의 성질).

### 14.10 접근성
도구 막대 `role="toolbar"` + 화살표 키 이동 · `aria-pressed` · 한국어 이름 · 창의 초점 가두기와 되돌리기 · 키보드만으로 쓰고 발행 · 읽는 화면의 제목 순서·`figure/figcaption`·대체 글 · 명암비 4.5:1(회색 글자 포함).

### 14.11 사람이 직접 볼 것 — 사용자 점검표 (자동으로 못 보는 것)
아이폰 사파리 · 안드로이드 크롬 · 삼성 인터넷 · 카카오톡 안 브라우저 · ArtLink 앱 · PC 크롬/엣지에서:
1. 한글로 세 문단 — 글자가 깨지거나 두 번 들어가지 않는다 2. 자판 위 막대가 늘 보인다(화면을 돌려도) 3. 사진 다섯 장을 한 번에 4. 카메라로 찍어 바로 5. 사진 자르기(두 손가락) 6. 사진 앞뒤에서 지우기·Enter 7. 글자를 길게 눌러 고르고 굵게 8. 쓰다가 다른 앱에 다녀오기 9. 쓰다가 비행기 모드 켰다 끄기 10. 휴대폰에서 쓰던 글을 PC 에서 이어 쓰기 11. 발행 → 카카오톡으로 공유 → 미리보기 그림·제목 12. 읽는 화면에서 사진 눌러 넘겨 보기.

---

## 15. 더하면 좋은 것 (추천 순)

1. **사진 보관함 — 휴대폰으로 찍고 PC 에서 쓴다.** PC 편집 화면의 [휴대폰으로 사진 넣기]가 QR 을 띄우고, 휴대폰은 같은 글의 '사진만 올리기' 화면이 열린다. 올린 사진이 몇 초 뒤 PC 의 보관함에 뜨고 끌어다 놓는다. 작가의 사진은 휴대폰에, 글 쓰는 손은 PC 에 있다 — 이 간극이 블로그를 안 쓰게 만드는 가장 큰 이유다. `ArticleAsset` 이 이미 있어 `GET /:id/assets` 5초 폴링이면 된다(실시간 공동 편집 아님).
2. **ArtLink 카드 블록.** 글 안에 내 작품·전시·공모·갤러리·작가를 카드로 넣는다. 저장은 종류와 번호뿐이고 읽을 때 서버가 채우므로 D-day·판매 상태가 늘 지금 값이다. 네이버 블로그가 못 하는 것 — 글이 곧 홈페이지·공모·전시로 가는 길이 된다.
3. **이웃에게 새 글 알림(벨 + 앱 푸시).** '더 자주 들어오게'의 직접 손잡이. 1차(M4)에 넣었다.
4. **내 작품에서 고르기.** 이미 올린 포트폴리오 사진을 다시 올리지 않고 넣는다. 설명에 작품명·연도·재료가 자동으로(`museumCaption`).
5. **글감 틀.** 글쓰기가 본업이 아닌 사람에게 빈 화면이 가장 높은 문턱이다. 전시 후기(어떤 전시였나 · 준비하며 · 현장에서 · 돌아보며) 같은 소제목 뼈대를 깔아 준다.
6. **시리즈(연재).** '전시 준비 ①②③' — 글 끝의 [다음 글]이 머무는 시간을, '다음 편'이 다시 올 이유를 만든다.
7. **글쓴이에게 숫자 보여 주기**(조회 · 끝까지 읽음 · 좋아요). 섭외한 필진이 두 번째 글을 쓰게 하는 건 반응이다. '끝까지 읽음'은 글 끝에 닿고 예상 읽는 시간의 30% 이상 머문 경우 한 번.
8. **검색 노출.** 정보글은 검색 유입의 원천인데 지금은 화면을 브라우저가 그린다. 서버가 같은 JSON 으로 본문 HTML 과 `Article` 구조화 데이터를 `index.html` 에 미리 심는다(이미 SEO 마커 교체 구조가 있다). 네이버는 스크립트를 잘 안 돌린다.
9. **예약 발행.** '매주 화요일 새 글' 같은 리듬. 스케줄러 없이 — 목록을 읽을 때 시각이 지난 글을 발행 처리(이 저장소의 '요청 때 정리' 방식).
10. **전/후 비교 블록.** 가운데 손잡이를 밀어 작업 전·후를 본다. 작업일지에 맞는다.
11. 그 밖 — 끝에 '이 작가가 참여 중인 전시·공모' 자동 표시 · 읽던 자리 기억 · 주간 메일(수신 동의가 먼저 필요하다 — 규칙 66).

---

## 16. 하지 않는 것

글꼴·글자색·글자 크기 고르기 · 글 옆으로 흘리는 사진 · 표 · 코드 블록 · 실시간 공동 편집 · 바깥 링크 미리보기 카드(서버가 남의 주소를 가져와야 한다 — SSRF) · 인스타그램 임베드(그쪽 스크립트 필요) · 동영상 파일 직접 올리기(용량 — 영상은 유튜브로) · 밝기·필터(D6, 2차) · 글 검색(1차) · 신고(규칙 33 이 아직 미해결 — 필진이 초대제라 관리자 숨기기로 시작).

---

## 17. 내보내기

- 환경 변수 추가 없음. DB 마이그레이션 한 번(`prisma migrate deploy` — 빌드에 이미 있다).
- **글이 0개면 어디에도 안 보인다**(홈 줄·커뮤니티 띠·홈페이지 탭이 스스로 사라진다) — M4 뒤 배포해도 방문자 화면은 그대로다.
- 순서: 배포 → 관리자가 직접 두세 편 써 본다(실서버 사진·실기기) → 필진 2~3명 초대 → 글이 5편쯤 쌓이면 홈 줄이 의미가 생긴다.
- 배포 뒤 스모크: 비회원으로 `/journal`·글 하나·공유 미리보기(`curl -A facebookexternalhit`) · 썸네일 `t1280` 이 R2 에서 200 인지(`curl -I`) · 통계에 '저널 글' 머문 시간이 잡히는지(시크릿 창).
- 사용자 확인이 필요한 글: 이용약관(필진이 올린 글·사진의 권리와 책임, 남의 작품 사진) · 개인정보처리방침(새로 모으는 개인정보는 없다 — 댓글·좋아요는 기존 범주) — 문구는 사용자가 정한다.
- 끄는 법: 필진을 전부 해제하면 글쓰기가 닫힌다. 화면째로 감추려면 발행 글을 숨긴다(진입점이 스스로 사라진다).
