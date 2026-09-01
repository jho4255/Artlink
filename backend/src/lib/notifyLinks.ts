/**
 * 알림이 가리키는 화면 — **받는 사람에 따라 다르다.**
 *
 * 작가는 2026-08-27부터 운영페이지에 가지 않는다. 공지·제출자료·정산 확인을 모두
 * 마이페이지 [내 전시] 카드 안에서 처리하므로(`components/operation/ArtistOperationPanel.tsx`),
 * 작가에게 보내는 알림은 여기로 보낸다.
 *
 * ⚠️ 운영페이지 라우트는 **지우면 안 된다** — 이 변경 전에 이미 발송된 알림 수천 건이
 *    옛 주소를 들고 있다. 그래서 작가가 그 주소로 오면 화면에서 마이페이지로 되돌려 보낸다
 *    (`frontend/src/pages/OperationPage.tsx` 의 `if (!canManage)`).
 * ⚠️ 갤러리·Admin 은 운영페이지가 그대로 일터다 — 이쪽 알림 링크를 바꾸지 말 것.
 *    (예: 작가가 정산에 이의를 제기했을 때 오너에게 가는 SETTLEMENT_ISSUE)
 */

/** 작가에게 보내는 알림 — 마이페이지 [내 전시] */
export const ARTIST_EXHIBITION_LINK = '/mypage?tab=applications';

/**
 * 작가 알림 중 **어느 전시인지 아는** 것은 그 카드를 열어둔 채로 보낸다.
 * 알림을 누르면 목록에서 다시 찾아 눌러야 하는 수고가 없어진다 —
 * `?ex=` 를 프론트(`ApplicationsSection`)가 읽어 해당 카드를 펼치고 그 탭으로 전환한다.
 */
export const artistExhibitionLink = (exhibitionId: number | string): string =>
  `${ARTIST_EXHIBITION_LINK}&ex=${exhibitionId}`;

/** 갤러리·Admin(운영자)에게 보내는 알림 — 운영페이지 */
export const operationLink = (exhibitionId: number | string): string =>
  `/exhibitions/${exhibitionId}/operation/new`;
