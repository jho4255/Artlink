/**
 * 정산 지문 — "이 작가가 확인한 금액이 그 뒤로 바뀌었는가" 를 판정하는 단일 기준.
 *
 * ── 왜 필요한가 ──────────────────────────────────────────────
 * 예전에는 작가 한 명이 문제를 제기하면 갤러리가 [요청 취소] → 수정 → [재요청] 을 해야 했는데,
 * 취소가 `settlementApproval` 을 통째로 지웠다. 그래서 **이미 수락한 작가까지 전원 다시** 확인해야 했다.
 * 10명짜리 단체전에서 한 명 때문에 아홉 명을 다시 붙잡는 셈이라 실무에서 못 쓴다.
 *
 * 이제는 응답 시점의 금액을 지문으로 남겨두고, 갤러리가 정산을 저장할 때마다 대조한다.
 * **자기 금액이 안 바뀐 작가는 수락이 그대로 유지되고, 바뀐 작가만 다시 PENDING** 이 된다.
 *
 * ── 무엇을 지문에 넣는가 ─────────────────────────────────────
 * 작가가 `my-settlement` 화면에서 **동의한 대상**, 즉 돈에 영향을 주는 것만 넣는다.
 *   · 판매 표시된 작품의 위치(artworkIndex) · 판매가 · 결제수단
 *   · 갤러리 몫 비율(galleryRatio)
 *
 *   · 카드 수수료율(cardFeeRate) — 카드 판매분에서 먼저 떼므로 작가 지급액이 직접 줄어든다
 *
 * ⚠️ `ArtworkSale.title` 은 **넣지 않는다**. 화면에 뜨는 제목은 작가 본인 출품목록에서 오고
 *    (`computeSettlement`), 이 컬럼은 판매 당시 스냅샷일 뿐이라 넣으면 금액이 그대로인데도
 *    지문이 달라져 **멀쩡한 수락이 헛되이 풀린다**.
 * ⚠️ 순서에 의존하지 말 것 — `findMany` 는 정렬을 보장하지 않는다. 반드시 index 로 정렬한 뒤 만든다.
 *
 * ── 수수료는 '율' 이 아니라 '이 작가가 실제로 부담한 금액' 으로 넣는다 ──
 * 율을 그대로 넣었더니 **현금으로만 판 작가까지 재확인 대상**이 됐다(2026-08-19 테스트에서 잡힘).
 * 그 사람 지급액은 1원도 안 변했는데 다시 붙잡는 셈이라, `ArtworkSale.title` 을 넣었던 것과 같은
 * 종류의 실수다. 지문에는 **그 작가의 돈에 실제로 영향을 준 것만** 들어가야 한다.
 * 그래서 카드 판매 합계에서 계산한 수수료 **금액**을 넣는다 — 카드 판매가 없으면 0이라 아무 영향이 없다.
 *
 * ── 왜 0일 때는 아예 생략하는가 ─────────────────────────────────
 * 이미 실서버에 **작가가 수락해 둔 지문이 저장돼 있다**. 형식을 그냥 바꾸면 그 값들이
 * 전부 어긋나 멀쩡한 수락이 통째로 풀리고, 갤러리는 정산 완료를 못 하게 된다
 * (2026-08-17 에 백필 마이그레이션으로 겨우 막았던 사고와 같은 유형).
 * 그래서 **수수료 0 = 예전과 한 글자도 다르지 않은 문자열**을 만들고, 0이 아닐 때만 `|f22000` 을 덧붙인다.
 */

export interface FingerprintSale {
  artistUserId: number;
  artworkIndex: number;
  soldPrice: number;
  paymentMethod?: string | null;
}

export interface FingerprintRatio {
  artistUserId: number;
  galleryRatio: number;
}

/**
 * 수수료율을 지문·계산에 쓸 정수로 고정한다 — 백분율의 1/100 단위(2.2% → 220).
 * 실수(Float)를 그대로 문자열에 넣으면 `2.2` 와 `2.20`, 부동소수 오차가 다른 지문을 만든다.
 */
export const feeUnits = (rate: unknown): number => {
  const n = Number(rate);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(Math.min(100, n) * 100);
};

/**
 * 카드 판매분에 붙는 수수료 **금액**(원). 현금 판매는 카드사를 거치지 않으므로 제외한다.
 * 정산 계산(`artistAmounts`)과 지문이 **반드시 같은 값**을 써야 한다 —
 * 갈라지면 화면 금액은 그대로인데 지문만 달라져 수락이 이유 없이 풀린다.
 */
export function cardFeeAmount(
  sales: Pick<FingerprintSale, 'soldPrice' | 'paymentMethod'>[],
  cardFeeRate: unknown,
): number {
  const units = feeUnits(cardFeeRate);
  if (units === 0) return 0;
  const cardTotal = sales
    .filter((s) => s.paymentMethod !== 'CASH')
    .reduce((sum, s) => sum + (Math.round(Number(s.soldPrice)) || 0), 0);
  return Math.round((cardTotal * units) / 10000);
}

/** 작가 한 명의 지문 */
export function settlementFingerprint(
  sales: Pick<FingerprintSale, 'artworkIndex' | 'soldPrice' | 'paymentMethod'>[],
  galleryRatio: number,
  cardFeeRate: number = 0,
): string {
  const rows = [...sales]
    .sort((a, b) => a.artworkIndex - b.artworkIndex)
    .map((s) => `${s.artworkIndex}:${Math.round(Number(s.soldPrice) || 0)}:${s.paymentMethod === 'CASH' ? 'CASH' : 'CARD'}`);
  const base = `r${Math.round(Number(galleryRatio) || 0)}|${rows.join(',')}`;
  // 이 작가가 실제로 부담하는 수수료가 0이면 예전 형식 그대로 (이미 저장된 지문과 맞아야 한다)
  const fee = cardFeeAmount(sales, cardFeeRate);
  return fee === 0 ? base : `${base}|f${fee}`;
}

/**
 * 여러 작가의 지문을 한 번에.
 * 판매·비율이 하나도 없는 작가도 **반드시 항목이 생긴다**(`r0|`) — 없으면 `undefined` 와 비교하게 돼
 * "판매 0건으로 수락했는데 여전히 0건" 인 경우까지 변경으로 오판한다.
 */
export function fingerprintsOf(
  artistIds: number[],
  sales: FingerprintSale[],
  ratios: FingerprintRatio[],
  cardFeeRate: number = 0,
): Map<number, string> {
  const byArtist = new Map<number, FingerprintSale[]>();
  for (const s of sales) {
    if (!byArtist.has(s.artistUserId)) byArtist.set(s.artistUserId, []);
    byArtist.get(s.artistUserId)!.push(s);
  }
  const ratioOf = new Map(ratios.map((r) => [r.artistUserId, r.galleryRatio]));

  const out = new Map<number, string>();
  for (const id of artistIds) {
    out.set(id, settlementFingerprint(byArtist.get(id) ?? [], ratioOf.get(id) ?? 0, cardFeeRate));
  }
  return out;
}
