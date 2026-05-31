# ArtLink E2E (Playwright)

로컬 서버 대상 멀티유저·신뢰성·복합 시나리오 E2E. **실서버(artlink.cc)는 절대 대상으로 하지 않습니다.**

## 실행 전제 (로컬 서버 2개)

```bash
# 1) 백엔드 — E2E 동안 rate limit 비활성화 플래그 필수 (E2E는 수백 개 API 호출)
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
