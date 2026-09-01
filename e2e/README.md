# ArtLink E2E (Playwright)

로컬 서버 대상 멀티유저·신뢰성·복합 시나리오 E2E. **실서버(artlink.cc)는 절대 대상으로 하지 않습니다.**

## 실행 전제 (로컬 서버 2개)

> 🚨 **DB 를 반드시 확인하고 돌리세요.**
> `global-setup.ts` 는 실행 때마다 `prisma migrate reset --force` 로 **대상 DB 를 통째로 지웁니다.**
> `backend/.env` 의 `DATABASE_URL` 이 실서버 복제본(`artlink_prod`)을 가리키고 있으면
> **실제 가입자 데이터가 사라집니다**(2026-08-28 실측: 그 DB 에 유저 93명이 들어 있었다).
> 아래처럼 **로컬 데모 DB(`artlink`)를 명시**해서 돌리세요 — 환경변수가 `.env` 보다 우선합니다.
>
> ```bash
> # backend/.env 의 **로컬** DATABASE_URL 을 그대로 넣으세요.
> # ⚠️ 그 값이 artlink_prod(실서버 복제본)를 가리키고 있지 않은지 **눈으로 확인**할 것 —
> #    DB 이름이 반드시 `artlink` 여야 합니다.
> export DATABASE_URL='<backend/.env 의 로컬 DATABASE_URL — DB 이름이 artlink 인 것>'
> ```
> (레포에 접속 문자열을 그대로 적지 않습니다 — `scripts/predeploy-check.sh` 가 막습니다)
> 백엔드도 **같은 DB 로** 띄워야 합니다(아래 명령의 앞에 같은 변수를 붙일 것).

```bash
# 1) 백엔드 — E2E 동안 rate limit 비활성화 플래그 필수 (E2E는 수백 개 API 호출)
# (위에서 export 한 DATABASE_URL 을 그대로 물려받는다)
cd backend && DISABLE_RATE_LIMIT=true npx tsx watch src/index.ts

# 2) 프론트엔드
cd frontend && npm run dev
```

> `DISABLE_RATE_LIMIT`는 로컬 E2E 전용입니다. 운영(Render)에서는 절대 설정하지 마세요 — 설정 안 하면 기존대로 rate limit이 동작합니다.

## 실행

```bash
cd e2e
npm install            # 최초 1회
npx playwright install chromium   # 최초 1회
npm test               # 전체 실행 (실행 전 DB 시드 자동 리셋)
npm run report         # 마지막 결과 HTML 리포트
npx playwright test tests/01-messaging.spec.ts   # 특정 파일만
```

## 동작 방식
- `global-setup.ts`가 매 실행 전 **로컬 dev DB를 시드 리셋**(`prisma migrate reset --skip-generate` + `seed`)하고, 역할별 로그인 세션(`.auth/*.json`)과 API 토큰(`.auth/tokens.json`)을 생성 → 테스트는 dev-login 재호출 없이 재사용.
- 테스트는 `lib/helpers.ts`의 `openAs(browser, role)`로 역할별 컨텍스트를 동시에 열어 **유저 간 상호작용**을 재현.
- 모바일 뷰포트(Pixel 7), workers=1(공유 DB 안정성), 실패 시 trace/screenshot/video 저장.

## 시나리오 (총 35 통과 + 1 보류, 모바일 전체 + 데스크톱 스모크)
- `00-smoke` — 3역할 세션 + 보호라우트 (모바일·데스크톱 양쪽)
- `01-messaging` — 갤러리↔지원자 **6턴 왕복**(누적·순서·읽음)
- `02-favorites-reliability` — 찜 3라운드 cross-cache + 5연타 멱등성
- `03-application-status-notification` — 상태 단계변경→알림 누적→배지→역행 차단
- `04-report-moderation` — 신고→관리자 제재→양쪽 마스킹(3유저)
- `05-reliability` — 새로고침 유지 · 위조토큰 401→로그인 · 네트워크 단절→복구
- `06-tier3-edge` — 정원초과 차단(KI-2 수정 후 통과) · 권한 매트릭스
- `07-registration-approval` — 갤러리 등록폼→승인/거절 UI→공개/사유 + 폼검증
- `08-concurrency` — 정원1 동시지원 6건→1건만(레이스 없음)
- `09-search-filter` — 지역/별점 필터
- `10-portfolio` — 약력/이력 수정→새로고침 유지
- `11-explore` — 포트폴리오 공개토글→탐색 노출+좋아요
- `12-support` — FAQ 아코디언 + 1:1문의→답변→확인
- `13-admin-content` — 히어로/혜택 생성→공개화면 노출
- `14-show-lifecycle` — 전시 등록→승인→노출+작가파싱
- `15-exhibition-registration` — 공모 등록 4날짜 폼→승인→노출
- `16-review` — 수락 작가 리뷰 작성(별점)→노출+별점 반영
- `17-apply-modal` — 커스텀필드 공모 지원 모달 입력→지원
- `18-attachments` — 첨부 전송(UI 자동화 보류 `test.fixme`; 기능은 감사 API로 검증)

## 발견된 버그
→ `docs/known-issues.md` 에 누적 (테스트로 발견한 것 포함). 일괄 수정 예정.

## 2026-08-01 노후 테스트 정비

시간이 지나며 제품 규칙이 바뀌었는데 테스트가 따라가지 못해 21건이 실패하고 있었다. 원인과 조치:

| 원인 | 영향 | 조치 |
|---|---|---|
| `applyToExhibition` 헬퍼에 **약관 동의 누락** (지원 시 필수로 바뀜) | 지원이 전부 400 → 하위 테스트 연쇄 실패 | 헬퍼에 `termsAgreed`/`termsVersion` 추가. 버전은 `backend/src/lib/terms.ts`에서 **런타임에 읽어** 하드코딩 방지 |
| **시드 공모의 마감일이 과거** | 지원 400 → "지원자 관계" 미성립 → 메시지 403, 지원자 목록 비어 있음 | 01/03에서 매 실행마다 모집 중인 공모를 새로 생성 |
| 지원자 관리가 공모 상세 → **마이페이지 인라인**으로 이동 | `getByText('지원자 관리')` 타임아웃 | `openApplicantManager(page, title)` 헬퍼 신설 |
| 라이프사이클 **순서 강제**(모집마감→확정→전시종료) 도입 | 확정/종료 전환이 400 → 잠금·정산 미검증 | 22에서 앞 단계를 함께 전송 |
| 정산 **2단계 승인제** 도입 | 작가 `my-settlement`가 null | 갤러리 '확인 요청' 단계 추가 후 검증 |
| 연락처 노출 정책 변경(**지원 시점부터** 공개) | 낡은 단언 실패 | 현재 정책 + 타 갤러리 403 검증으로 갱신 |
| CareerEditor가 연도/내용 행 → **자유 textarea** | '추가' 버튼 없음 | textarea placeholder로 입력 |
| 지원 모달 제출이 **약관 동의 전까지 disabled** | 빈 제출 검증 단계 진입 불가 | 동의 후 빈 제출로 검증 확인 |
| `getByPlaceholder('주소')`가 '인스타그램 주소'까지 매칭 | strict mode 위반 | `{ exact: true }` |
| 테스트가 존재하지 않는 `/uploads/art1.png` 사용 | SkeletonImage가 404 시 `<img>`를 렌더하지 않음 | `realUploadUrl()`로 실제 파일 사용 |

결과: **21 failed / 32 passed → 0 failed / 74 passed** (1건은 원래 `test.fixme`).


## 2026-08-28 정비 — 개편분 반영 + 연쇄 실패 제거

한 세션에서 대화(ArtTalk)·마이페이지 메뉴·홈·작가 홈페이지가 크게 바뀌었고, 그 사이 백엔드에도
필수 필드가 하나 늘어 있었다. 돌려보니 **72 failed / 69 passed**. 원인은 넷뿐이었다.

| 원인 | 영향 | 조치 |
|---|---|---|
| **공모 등록에 `submissionDeadline`(자료제출 마감일)이 필수가 됨** (2026-08-19) | 공모 생성이 전부 400 → 지원·수락·운영·정산이 **줄줄이 실패**(30여 개) | `exhibitionDates()` / `createExhibition()` 헬퍼 신설. 날짜 한 벌을 한 곳에서 만든다(지원마감 < 자료제출 < 전시시작 순서까지 맞춰서) |
| 마이페이지 메뉴가 **세 곳**(Navbar 메뉴·본문 탭바·우측 사이드바)에 생김 | `getByText('내 갤러리').first()` 가 모바일에서 **감춰진 사이드바**를 집어 15초 타임아웃 | `openMyPageTab(page, '내 갤러리')` 헬퍼로 교체 — 주소로 바로 간다 |
| 옛 쪽지 UI(제목+textarea) 폐기, ArtTalk 으로 전면 개편 | `01-messaging` 전체가 무의미 | `29-chat.spec.ts` 로 옮기고 **6턴 왕복 시나리오는 그대로 이식**. 옛 파일은 은퇴 |
| 화면 이름 변경 (Favorites→ArtWorks, 포트폴리오 탭 분리, 받은 초대→내 전시, FAQ 삭제) | 셀렉터 불일치 | 10·12·26 갱신 |

테스트끼리 상태를 물려주던 것도 하나 고쳤다 — `02-favorites` 는 앞 테스트가 켜 둔 찜 때문에
[찜하기] 를 못 찾고 죽었다. 이제 `beforeEach` 에서 시작 상태를 직접 맞춘다.

### 새로 추가한 시나리오
- `29-chat` — 갠톡 길목(작가 홈페이지·둘러보기) · 안읽음/읽음 · **카톡식 묶음** · 단톡 자동 생성 · **남의 방 404** · 6턴 왕복
- `30-mypage-menu` — lg↑ 사이드바 / lg↓ 햄버거 하나 · 로그아웃 위치 · 탭 왕복 · **모든 탭이 빈 화면이 아닌지** · 브랜드 제목 색
- `31-home-artworks` — ArtWorks 최상단 · 첫 진입 랜덤 · 새로고침 · 대비(AA) · /benefits 리다이렉트
- `32-artist-homepage` — [수정] 한 번에 편집 · 실시간 미리보기 · 저장 후 공개 페이지 복귀 · **무공백 400자에도 가로 밀림 없음** · 경력 배치
- `33-artist-exhibitions` — 초대 탭 · 초대 수락 = 바로 참가 · 카드 안에서 운영(공지/제출/정산) · 카드 높이
- `34-picks-and-scrap` — MyPicks 통합 · **갤러리 관심 작품 = 하트 보드**(스크랩 버튼 삭제) → [전시 초대] · 갤러리 탭 왕복
- `35-gallery-exhibition-ops` — 내 공모 [상세 운영] **인라인 아코디언**(페이지 이동 없음) · `/operation/new` 라우트 보존 · [추가 질문]·[작가 초대]는 지원자 관리 패널 안 · 하트 저장 작가 초대

> ⚠️ `like` 는 **토글**이라 같은 이미지를 두 번 좋아요하면 취소된다. 갤러리 하트가 필요한 테스트는
> `seedGalleryLike`(항상 새 작품에 첫 하트)로 my-likes 를 결정적으로 채운다.
