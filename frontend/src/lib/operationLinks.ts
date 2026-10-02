/**
 * 공모 운영자의 '일터' 주소 — **역할마다 다르다** (2026-10-02)
 *
 * 운영 화면(`/exhibitions/:id/operation/new`)의 [← 내 공모]·[지원자 보기]·할 일 버튼이 전부
 * `/mypage?tab=my-exhibitions…` 로 가고 있었다. 그 탭은 **갤러리에게만** 있다 — 관리자가 누르면 역할 폴백에 걸려
 * **프로필(닉네임 입력 칸)** 이 떴다(2026-10-02 신고: 운영 조회 → [운영 페이지] → [지원자 보기]).
 * 2026-09-29 개편 전의 [내 공모 운영] 버튼도 같은 주소라, 관리자에겐 그 전부터 그랬다.
 * 갤러리(자기 공모 · 종료된 공모 · 위임받은 아트링크 주최 공모)는 실측으로 전부 정상이었다 — 그 탭이 자기 일터라서다.
 *
 *  - 갤러리                → 마이페이지 [내 공모] 의 그 카드 ([지원자] 탭을 연 채로)
 *  - 관리자 · 아트링크 주최  → [주최 공모] 의 그 카드 (지원자 관리를 연 채로 — 주최자인 관리자가 수락·거절한다)
 *  - 관리자 · 갤러리 주최    → [운영 조회] 의 그 공모 지원 현황 (조회 전용 — 수락·거절은 그 갤러리의 일이다)
 *
 * ⚠️ 운영 화면처럼 **여러 역할이 들어오는 화면**에서 `/mypage?tab=<역할 전용 탭>` 을 손으로 적지 말 것.
 *    주소가 문자열이라 타입이 못 잡고, 틀려도 에러 없이 프로필로 떨어진다(빈 화면도 아니라 더 눈에 안 띈다).
 *    `__tests__/operationLinks.test.ts` 가 그런 화면의 소스를 훑어 막는다.
 */
export interface OperatorWorkspace {
  /** 그 역할이 공모를 모아 보는 곳의 이름 — 뒤로가기 글자·안내문에 쓴다 */
  label: '내 공모' | '주최 공모' | '운영 조회';
  /** 그 목록에서 이 공모를 가리킨 주소 */
  listHref: string;
  /** 이 공모의 지원자를 보는 주소 */
  applicantsHref: string;
  /** 여기서 수락·거절까지 할 수 있는가 (관리자가 갤러리 주최 공모를 볼 땐 조회만) */
  canDecide: boolean;
}

export function operatorWorkspace(
  role: string | null | undefined,
  hostType: string | null | undefined,
  exhibitionId: number | string | null | undefined,
): OperatorWorkspace | null {
  if (exhibitionId == null || exhibitionId === '') return null;
  const ex = encodeURIComponent(String(exhibitionId));
  if (role === 'GALLERY') {
    const base = `/mypage?tab=my-exhibitions&ex=${ex}`;
    return { label: '내 공모', listHref: base, applicantsHref: `${base}&panel=applicants`, canDecide: true };
  }
  if (role === 'ADMIN') {
    if (hostType === 'ADMIN') {
      const base = `/mypage?tab=hosted-exhibitions&ex=${ex}`;
      return { label: '주최 공모', listHref: base, applicantsHref: `${base}&panel=applicants`, canDecide: true };
    }
    // 운영 조회는 공모를 고르면 곧 지원 현황이 펼쳐진다 — 목록 주소와 지원자 주소가 같다
    const base = `/mypage?tab=oversight&ex=${ex}`;
    return { label: '운영 조회', listHref: base, applicantsHref: base, canDecide: false };
  }
  return null;   // 작가·일반은 공모를 운영하지 않는다
}

/** 갤러리가 카드의 [운영] 탭(출품 자료·정산)을 연 채로 들어가는 주소 — 공모 상세의 버튼 */
export function galleryOperationHref(exhibitionId: number | string): string {
  return `/mypage?tab=my-exhibitions&ex=${encodeURIComponent(String(exhibitionId))}&panel=operation`;
}
