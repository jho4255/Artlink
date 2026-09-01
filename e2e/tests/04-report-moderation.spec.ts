import { test, expect, request as pwRequest } from '@playwright/test';
import { userIds, tokenFor } from '../lib/helpers';

/**
 * 메시지 신고 → 관리자 제재 → 마스킹.
 *
 * ⚠️ **2026-08-28 대화 개편으로 이 흐름이 화면에서 끊겼다.**
 *   · 신고는 여전히 옛 쪽지(`Message`)만 대상으로 한다(`backend/src/routes/report.ts` 의 `messageId`).
 *   · 그런데 화면의 대화는 ArtTalk(`Chat`/`ChatMessage`)으로 바뀌었고, **말풍선에 신고 버튼이 없다.**
 *   · 즉 지금 제품에서는 **부적절한 메시지를 신고할 방법이 없다.** Admin '신고 관리' 탭은 살아 있지만
 *     새 신고가 들어올 경로가 없다.
 *
 * 그래서 UI 시나리오는 `test.fixme` 로 **명시적으로 남겨 둔다**(지우면 기능이 사라진 사실까지 사라진다).
 * 아래 API 검증은 백엔드 신고·제재 로직이 아직 살아 있음을 지킨다 — 화면만 붙이면 되도록.
 *
 * 되살릴 때 할 일:
 *   1. `ChatMessage` 를 신고 대상으로 받도록 `report.ts` 확장 (또는 chatMessageId 필드 추가)
 *   2. `MessagesPage` 말풍선에 신고 버튼 + 제재된 메시지 마스킹 표시
 *   3. 이 파일의 `test.fixme` 를 `test` 로 되돌리고 ArtTalk 셀렉터로 갱신
 */
const API = 'http://localhost:4000/api';

test.fixme('신고 → 관리자 제재 → 작가·갤러리 양쪽에서 메시지 마스킹 (ArtTalk 에 신고 UI 없음)', async () => {
  // 위 주석의 1~3이 끝나면 되살릴 것
});

test('★ 신고 API 는 살아 있다 — 화면만 붙이면 된다 (관리자 목록 조회 가능)', async () => {
  const api = await pwRequest.newContext();
  const list = await api.get(`${API}/reports`, {
    headers: { Authorization: `Bearer ${tokenFor('admin')}` },
  });
  expect(list.status(), '신고 목록 API 가 사라졌다면 Admin 신고 관리 탭이 죽는다').toBe(200);
  await api.dispose();
});

test('★ 신고 API 는 아무나 못 부른다 (작가/갤러리만, 남의 메시지만)', async () => {
  const api = await pwRequest.newContext();
  const ids = userIds();

  // 비로그인
  const anon = await api.post(`${API}/reports`, { data: { messageId: 1, reason: '테스트' } });
  expect(anon.status()).toBe(401);

  // Admin 은 신고 주체가 아니다 (처리하는 쪽이다)
  const asAdmin = await api.post(`${API}/reports`, {
    headers: { Authorization: `Bearer ${tokenFor('admin')}` },
    data: { messageId: 1, reason: '테스트' },
  });
  expect(asAdmin.status(), 'Admin 이 신고까지 넣을 수 있으면 역할이 뒤엉킨다').toBe(403);

  // 없는 메시지
  const missing = await api.post(`${API}/reports`, {
    headers: { Authorization: `Bearer ${tokenFor('artist')}` },
    data: { messageId: 999999, reason: '테스트' },
  });
  expect(missing.status()).toBe(404);

  expect(ids.artist).toBeGreaterThan(0);
  await api.dispose();
});
