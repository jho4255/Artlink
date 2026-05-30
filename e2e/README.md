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

## 시나리오 (총 18개, 전부 통과)
- `00-smoke` — 3역할 세션 + 보호라우트 리다이렉트 (4)
- `01-messaging` — 갤러리↔지원자 **6턴 왕복**(누적·순서·읽음상태) (1)
- `02-favorites-reliability` — 찜 **3라운드** cross-cache 일관성 + 5연타 멱등성 (2)
- `03-application-status-notification` — 상태 단계변경 → 알림 누적 + 배지 갱신 + **역행 차단** (1)
- `04-report-moderation` — 신고 → 관리자 제재 → 작가·갤러리 양쪽 마스킹 (3유저) (1)
- `05-reliability` — 새로고침 유지 · 위조토큰 401→로그인 · **네트워크 단절→복구** (3)
- `06-tier3-edge` — 정원초과 차단(미구현 갭, test.fail) · 권한 매트릭스 (3)
- `07-registration-approval` — 갤러리 등록폼 → 승인/거절 UI → 공개노출/사유전달 + 폼검증 (3)

> 정원초과(06-tier3) 1건은 `test.fail`로 **알려진 갭** 표시 — 백엔드가 정원을 안 막음(docs/known-issues.md KI-2). 고치면 자동으로 초록불 전환.

## 발견된 버그
→ `docs/known-issues.md` 에 누적 (테스트로 발견한 것 포함). 일괄 수정 예정.
