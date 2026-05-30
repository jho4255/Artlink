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

## 시나리오 (계속 추가 중)
- `00-smoke` — 3역할 세션 + 보호라우트 리다이렉트
- `01-messaging` — 갤러리↔지원자 **6턴 왕복**(누적·순서·읽음상태)
- `02-favorites-reliability` — 찜 **3라운드** cross-cache 일관성 + 5연타 멱등성
- `03-application-status-notification` — 지원 상태 단계별 변경 → 알림 누적 + 배지 갱신 + **역행 차단**

### 남은 큐
Tier1: 신고→제재→마스킹 · 등록→승인→검색→지원→리뷰 라이프사이클 · 거절+사유
Tier2: 중복클릭 멱등성 · 네트워크 단절→복구 · 세션만료 · 새로고침 상태유지
Tier3: 폼검증 · 권한매트릭스 · 정원초과 지원
