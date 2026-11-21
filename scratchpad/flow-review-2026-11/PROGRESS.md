# 공모 흐름 개편 — 구현 진행 기록 (2026-11-20~)

사용자 지시(2026-11-20): "기본값(D1~D6)으로 구현 → 로컬로 먼저 확인. PC 웹 / 모바일 웹 / 앱(푸시 포함) 모두 검증 후 넘겨줘.
정산 페이지 '팔림' → '판매'. 정산 이의 제기와 그 처리 UX/UI 도 목업과 일관되게."
→ 커밋·배포 지시는 없다(하지 말 것).

## 구현 결정(계획서 PLAN.md 보다 구체적인 것)
- 갤러리 공모 한 건 화면 = `/mypage?tab=my-exhibitions&ex=<id>` (마이페이지 안, focused). 목록에서 열면 push + state.fromList.
  닫기: fromList 면 navigate(-1), 아니면 replace 로 목록.
- `/exhibitions/:id/operation/new`(옛 알림 주소): 갤러리 → `/mypage?tab=my-exhibitions&ex=<id>` 로 replace,
  관리자 → 같은 ExhibitionWorkspace 를 standalone 으로(목록 링크는 operatorWorkspace().listHref).
- 작가 전시 화면 = `/mypage?tab=applications&ex=<exhibitionId>`(알림 링크 그대로).
- 워크스페이스 데이터: access(['operation-access',id]) + 상세(['exhibition', String(id)]) + 지원자/출품/정산/공지 쿼리(하위 구역과 캐시 공유).
- 정산: SettlementSection 을 `useSettlementController(id,{enabled})`(상태·변이·주 버튼) + 표 화면으로 나눈다.
  워크스페이스가 컨트롤러를 들고 TaskBar 주 버튼과 정산 탭에 같이 넘긴다(포털 안 씀).
- 단계 전환: StatusPanel → hooks/useLifecycle.ts (확인창 문구 그대로 + D2 체크). StatusPanel·OperationClassicPage(라우트 없음) 삭제.
- 알림 3종: SUBMISSION_RECEIVED(갤러리, 공모마다 한 줄 합침, REPUSH) · EXHIBITION_CONFIRMED(작가) · SETTLEMENT_ALL_APPROVED(갤러리).
- 정산 표 열 이름 '팔림' → '판매'.

## 진행 (2026-11-20 끝 — 커밋·배포 안 함)
- [x] WP9 서버 — `lib/flowNotify.ts` 알림 3종 · `rejectPending` · 이의 문구 · `operationLink(id, view)` (backend 1879 통과, 새 `flow-transitions.test.ts` 17)
- [x] WP0 부품 — `FlowStrip` · `TaskBar` · `ExhibitionRow` · `MenuButton iconOnly` · `PageTabBar` 수·잠김 · `ConfirmDialog extra` · `DeleteConfirmModal`
- [x] WP5 정산 — `settlementController.tsx` 분리 · 열 '판매' · 이의 창·이의 글·'저장하고 ○○ 님에게 다시 요청'
- [x] WP4 취합 — 작가 표 · `useSubmissionDownloads` · 안내 보내기
- [x] WP3 심사 — 두 칸 / 한 장씩 창 · 결정 뒤 다음 · 도구 [관리 ▾]
- [x] WP2 워크스페이스 + OperationPage(옛 주소 → 마이페이지, 관리자 단독)
- [x] WP1 목록 — 줄 · 묶음 · 스크롤 되살리기 · fromList 닫기(미저장이면 replace)
- [x] WP6 작가 — 전시 화면 · 정산 탭(내 정산액 맨 위 · 답하는 줄) · 리뷰 쓰기(D6)
- [x] WP7 요약
- [x] WP8 지원서 — 약관은 확인 창 안 · 회색 안내 상자 삭제
- [x] 테스트 — frontend 1808(새 `flowWorkspace.test.ts` 28) · e2e 관련 18개 파일 통과(새 `86` 4)
- [x] 검증 — 크롬·WebKit × PC·휴대폰(`walk.cjs` → `out-impl/`) · 안드로이드 에뮬레이터 앱 + 푸시(`pushkit.sh`)
- [x] 문서 — CLAUDE.md 규칙 88(+59·63·공모 진행 범위·작가 메뉴 문단 정정) · architecture.md 「공모 흐름 개편 2」 · HANDOFF 0-6

## 검증 중 잡아 고친 것
1. 알림을 눌러 왔는데 옛 단계 → 목록·공모 화면 쿼리 `staleTime: 0 · refetchOnMount: 'always'` + 작가 화면은 운영 접근을 덧씌워 단계 판단(앱)
2. '강윤서 외 1명 님이' → '강윤서 님 외 1명이'(앱)
3. [이의 다시 보내기]에 지난 글이 없었다 → 채워서 연다(앱)
4. 정산 완료 뒤 [요약]으로 안 넘어갔다 → 그 순간 요약 탭(앱)
5. 미저장 입력이 있을 때 [← 내 공모]가 확인창 두 번 → fromList 고 미저장이 없을 때만 뒤로, 아니면 replace(e2e 66 D)
6. 휴대폰 [내려받기] 메뉴 아래 항목이 하단 고정 줄에 깔려 안 눌림 → 메뉴 z-[35] + 막히면 위로(e2e 24·27·28)
8. 같은 메뉴가 오른쪽 끝 맞춤이라 화면 왼쪽 밖으로 잘림 → 화면 밖이면 반대쪽 끝 맞춤(앱 에뮬레이터)
7. 추가 질문 창 저장 뒤 공모 화면이 옛 질문 → 공모 상세 캐시에도 곧바로 씀

## 확인 서버(넘길 때 상태)
- 복제본: 백엔드 4000(artlink_prod) · 프론트 5173 — 평소처럼
- 데모(단계별 공모 01~13, 가상 데이터): 백엔드 4001 · 프론트 **http://localhost:5183** — gallery@artlink.com / artist1@artlink.com 개발자 로그인

## 신뢰성·복합 시나리오 테스트 — 2026-11-21 실행함(결과 `RESULTS.md`)
- P0 40/40 · P1 64/100 · P2 6/49 · 의심 지점 12개 재현 → 고침 · 새 결함 9개 고침 · 백엔드 1899 · 프론트 1814 · E2E 새 47개(87~90) · 하니스 302×2 실패 0 · 에뮬레이터 앱 확인.
- 남은 것: P1 36 · P2 43 · P3 1(목록은 RESULTS §6) · 결정이 필요한 관찰(RESULTS §7).

## (기록) 다음 — 신뢰성·복합 시나리오 테스트(미실행 — 11-20 시점)
- 목록: `TESTCASES.md`(190개: 여정 12 · 신뢰성 18 · 기능별 · 기기 · 회귀). **먼저 §1 의 의심 지점 S1~S14** — 코드 리딩에서 나온 가설이라 확인 전에는 결함이 아니다.
- 사용자가 Opus 로 실행한다(2026-11-20). 이 목록은 뽑기만 했다 — 돌리거나 고친 것은 없다.
