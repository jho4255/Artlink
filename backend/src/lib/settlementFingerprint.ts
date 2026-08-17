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
 * ⚠️ `ArtworkSale.title` 은 **넣지 않는다**. 화면에 뜨는 제목은 작가 본인 출품목록에서 오고
 *    (`computeSettlement`), 이 컬럼은 판매 당시 스냅샷일 뿐이라 넣으면 금액이 그대로인데도
 *    지문이 달라져 **멀쩡한 수락이 헛되이 풀린다**.
 * ⚠️ 순서에 의존하지 말 것 — `findMany` 는 정렬을 보장하지 않는다. 반드시 index 로 정렬한 뒤 만든다.
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

/** 작가 한 명의 지문 */
export function settlementFingerprint(
  sales: Pick<FingerprintSale, 'artworkIndex' | 'soldPrice' | 'paymentMethod'>[],
  galleryRatio: number,
): string {
  const rows = [...sales]
    .sort((a, b) => a.artworkIndex - b.artworkIndex)
    .map((s) => `${s.artworkIndex}:${Math.round(Number(s.soldPrice) || 0)}:${s.paymentMethod === 'CASH' ? 'CASH' : 'CARD'}`);
  return `r${Math.round(Number(galleryRatio) || 0)}|${rows.join(',')}`;
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
): Map<number, string> {
  const byArtist = new Map<number, FingerprintSale[]>();
  for (const s of sales) {
    if (!byArtist.has(s.artistUserId)) byArtist.set(s.artistUserId, []);
    byArtist.get(s.artistUserId)!.push(s);
  }
  const ratioOf = new Map(ratios.map((r) => [r.artistUserId, r.galleryRatio]));

  const out = new Map<number, string>();
  for (const id of artistIds) {
    out.set(id, settlementFingerprint(byArtist.get(id) ?? [], ratioOf.get(id) ?? 0));
  }
  return out;
}
