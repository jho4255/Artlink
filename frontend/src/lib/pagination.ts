/**
 * 페이지 번호 줄 (2026-11-13, 커뮤니티 목록 — [더 보기] 대신) — 무엇을 그릴지만 정한다(화면은 components/shared/Pagination).
 * 처음·끝은 늘 보이고, 지금 쪽 양옆 `around` 쪽씩, 사이가 비면 '…'. 한 칸만 비면 '…' 대신 그 번호를 그린다(…가 번호 하나를 가리는 건 손해다).
 *   pageItems(1, 3)        → [1, 2, 3]
 *   pageItems(6, 20)       → [1, '…', 4, 5, 6, 7, 8, '…', 20]
 *   pageItems(6, 20, 1)    → [1, '…', 5, 6, 7, '…', 20]        (휴대폰)
 */
export type PageItem = number | '…';

export function pageItems(current: number, total: number, around = 2): PageItem[] {
  const last = Math.max(1, Math.floor(total));
  const cur = Math.min(Math.max(1, Math.floor(current)), last);
  const nums = new Set<number>([1, last]);
  for (let p = cur - around; p <= cur + around; p++) if (p >= 1 && p <= last) nums.add(p);
  const sorted = [...nums].sort((a, b) => a - b);
  const out: PageItem[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i]!;
    const prev = sorted[i - 1];
    if (prev != null) {
      if (p - prev === 2) out.push(prev + 1);
      else if (p - prev > 2) out.push('…');
    }
    out.push(p);
  }
  return out;
}

/** 전체 쪽 수(글 0개여도 1쪽) */
export const pageCount = (total: number, perPage: number): number => Math.max(1, Math.ceil(Math.max(0, total) / Math.max(1, perPage)));

/** 주소의 ?page= — 숫자가 아니거나 1보다 작으면 1 */
export function readPage(raw: string | null): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}
