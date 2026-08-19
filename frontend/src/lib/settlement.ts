/**
 * 정산 화면 공용 값/계산 — 컴포넌트에서 분리해 둔다.
 *
 * `components/operation/SettlementSection.tsx` 안에 두면 컴포넌트 파일이 함수를 함께 내보내게 돼
 * Vite fast-refresh 가 그 파일 전체를 새로 고침한다(편집 중 입력값이 날아감). 그래서 여기로 뺀다.
 */

/** 금액 표기 — "1,000,000원". 한글 표기(`koreanWon`)와 달리 숫자 그대로 쓴다(정산서·PDF 관례) */
export const won = (n: number) => `${(n || 0).toLocaleString('ko')}원`;

export type EditWork = {
  index: number; title: string; image?: string; size?: string; medium?: string; year?: string;
  listPrice: string; sold: boolean; soldPrice: number; paymentMethod: 'CARD' | 'CASH';
};
export type EditArtist = {
  user: { id: number; name: string; nickname?: string | null; email?: string };
  galleryRatio: number;
  works: EditWork[];
};

/**
 * 카드 수수료율 → 계산에 쓸 정수(백분율의 1/100 단위. 2.2% → 220).
 * 백엔드 `lib/settlementFingerprint.ts` 의 `feeUnits` 와 같은 규칙이다 — 갈라지면
 * 화면 금액과 서버 금액이 어긋난다.
 */
export const feeUnits = (rate: unknown): number => {
  const n = Number(rate);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(Math.min(100, n) * 100);
};

/** 카드로 팔린 금액에 붙는 수수료(원). 현금 판매분에는 붙지 않는다. */
export function cardFeeOf(works: { sold: boolean; soldPrice: number; paymentMethod?: string | null }[], cardFeeRate: unknown): number {
  const units = feeUnits(cardFeeRate);
  if (units === 0) return 0;
  const cardTotal = works
    .filter(w => w.sold && w.paymentMethod !== 'CASH')
    .reduce((s, w) => s + (Math.round(Number(w.soldPrice)) || 0), 0);
  return Math.round((cardTotal * units) / 10000);
}

/**
 * 작가 한 명의 합계.
 *
 * 순서가 중요하다 — **카드 수수료를 먼저 떼고, 남은 금액을 갤러리:작가 비율로 나눈다.**
 * 그래야 수수료를 양쪽이 비율만큼 나눠 부담한다. 비율을 먼저 적용하고 갤러리 몫에서만 빼면
 * 작가는 수수료를 전혀 부담하지 않게 돼 결과가 달라진다. (백엔드 `artistAmounts` 와 같은 식)
 *
 * 갤러리 몫을 먼저 반올림하고 작가 몫을 뺄셈으로 구한다 — 양쪽을 따로 반올림하면
 * 합이 총액과 1원 어긋나 정산서에서 숫자가 안 맞는다.
 */
export function artistTotals(a: EditArtist, cardFeeRate: unknown = 0) {
  const sold = a.works.filter(w => w.sold);
  const cardTotal = sold.filter(w => w.paymentMethod !== 'CASH').reduce((s, w) => s + (w.soldPrice || 0), 0);
  const cashTotal = sold.filter(w => w.paymentMethod === 'CASH').reduce((s, w) => s + (w.soldPrice || 0), 0);
  const total = cardTotal + cashTotal;
  const cardFee = cardFeeOf(a.works, cardFeeRate);
  const settleBase = total - cardFee;
  const galleryAmount = Math.round(settleBase * a.galleryRatio / 100);
  return { total, cardTotal, cashTotal, cardFee, settleBase, galleryAmount, artistAmount: settleBase - galleryAmount };
}

/**
 * 화면에 입력된 정산 내용의 지문 — 서버가 갖고 있는 값과 비교해 **저장 안 된 변경**을 알아낸다.
 *
 * 이게 없어서 사고가 났다: 금액을 고치고 [이 작가에게 다시 확인 요청]을 누르면
 * 저장이 안 된 채 요청만 나가 **작가는 옛 금액을 다시 확인**하게 되고,
 * 목록을 다시 불러오면서 입력하던 값까지 조용히 사라졌다.
 *
 * 백엔드 `lib/settlementFingerprint.ts` 와 같은 규칙(판매 표시된 작품의 위치·금액·결제수단 + 비율).
 * 화면 비교 전용이라 굳이 서버와 문자열이 같을 필요는 없지만, 규칙이 갈라지면 헷갈리므로 맞춰 둔다.
 */
export interface SignatureArtist {
  user: { id: number };
  galleryRatio: number;
  works: { index: number; sold: boolean; soldPrice: number; paymentMethod?: string | null }[];
}

export function settlementFormSignature(artists: SignatureArtist[], cardFeeRate: unknown = 0): string {
  const rows = [...artists]
    .sort((a, b) => a.user.id - b.user.id)
    .map((a) => {
      const sold = a.works
        .filter((w) => w.sold)
        .sort((x, y) => x.index - y.index)
        .map((w) => `${w.index}:${Math.round(w.soldPrice || 0)}:${w.paymentMethod === 'CASH' ? 'CASH' : 'CARD'}`)
        .join(',');
      return `${a.user.id}|r${Math.round(a.galleryRatio || 0)}|${sold}`;
    })
    .join(';');
  // 수수료율도 저장 대상 — 빼면 율만 고치고 저장 없이 [작가에게 보내기] 를 눌러
  // **옛 금액이 그대로 나가는** 사고가 그대로 재현된다
  return `f${feeUnits(cardFeeRate)};${rows}`;
}

/** 접기/펼치기를 정할 때 필요한 최소 정보 */
export interface CollapsibleArtist {
  user: { id: number };
  approval?: { status: string } | null;
}

/**
 * 정산 화면을 처음 열 때 **펼쳐 둘 작가**를 고른다.
 *
 * 단체전은 작가 10명 × 출품작 여러 점이라 다 펼치면 화면이 수십 줄로 덮여 아무것도 안 보인다.
 * 그래서 기본은 접되, 두 경우는 예외로 둔다.
 *  · 작가가 2명 이하 — 접을 이유가 없다. 개인전에서 매번 한 번 더 누르게 하는 건 손해다
 *  · **문제를 제기한 작가** — 갤러리가 지금 봐야 하는 건 정확히 그 사람이다. 접어두면 놓친다
 */
export function initialOpenArtistIds(artists: CollapsibleArtist[]): Set<number> {
  const few = artists.length <= 2;
  return new Set(artists.filter(a => few || a.approval?.status === 'ISSUE').map(a => a.user.id));
}
