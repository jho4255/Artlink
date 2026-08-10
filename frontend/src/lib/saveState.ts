/**
 * 작가 제출물(출품작·작가노트)의 저장 상태 3단계와 표시 규칙.
 *
 *  - unsaved(빨강): 아직 서버에 안 보냄. 새로고침하면 사라진다.
 *  - draft(노랑)  : 임시저장됨. 서버에 남지만 **갤러리·관리자에게는 보이지 않는다**
 *                   (백엔드 operation.ts의 publicSubmission/publishedArtworks가 걸러낸다).
 *  - saved(초록)  : 정식 저장. 갤러리에 공개되고 PDF·정산에 포함된다.
 *
 * 색을 바꿀 땐 여기만 고치면 두 운영 페이지(신규/클래식)에 함께 반영된다.
 */
export type SaveState = 'empty' | 'unsaved' | 'draft' | 'saved';

export const STATE_UI: Record<SaveState, { box: string; text: string; label: string }> = {
  // 갓 추가해 아직 아무것도 안 쓴 칸 — 색으로 경고할 게 없다
  empty: { box: 'border-gray-200 bg-white', text: 'text-gray-400', label: '작성 전' },
  unsaved: { box: 'border-red-300 bg-red-50/40', text: 'text-red-600', label: '저장 안 됨' },
  draft: { box: 'border-amber-300 bg-amber-50/50', text: 'text-amber-700', label: '임시저장 · 갤러리 비공개' },
  saved: { box: 'border-green-200 bg-green-50/30', text: 'text-green-700', label: '✓ 저장됨' },
};

/** 작품 칸이 완전히 비었는지 (추가만 하고 아직 아무 입력도 없는 상태) */
export function isBlankArtwork(a: { image?: string; title?: string; size?: string; width?: string; height?: string; medium?: string; year?: string; price?: string } | undefined): boolean {
  if (!a) return true;
  return !['image', 'title', 'size', 'width', 'height', 'medium', 'year', 'price']
    .some(k => String((a as Record<string, unknown>)[k] ?? '').trim());
}

/** 저장본과 현재 값을 비교해 상태를 낸다. draft 플래그는 현재 값 기준. */
export function computeSaveState(current: unknown, saved: unknown, isDraft?: boolean): SaveState {
  if (JSON.stringify(current ?? null) !== JSON.stringify(saved ?? null)) return 'unsaved';
  return isDraft ? 'draft' : 'saved';
}

/**
 * 대표작 인덱스(전체 목록 기준)를 서버로 보낼 목록(빈 칸 제외) 기준 서수로 변환.
 * 참조 비교(===)는 금물 — 저장 시 {...a}로 복제된 목록에서는 항상 실패해 대표작이 지워진다.
 * @param artworkList 화면의 전체 목록 (빈 칸 포함)
 * @param repIndex    전체 목록 기준 대표작 인덱스
 * @param sentLength  실제로 보내는 목록 길이 (범위 밖이면 null)
 */
export function repOrdinal(
  artworkList: Parameters<typeof isBlankArtwork>[0][],
  repIndex: number | null,
  sentLength: number,
): number | null {
  if (repIndex == null) return null;
  const target = artworkList[repIndex];
  if (!target || isBlankArtwork(target)) return null;
  const ord = artworkList.slice(0, repIndex).filter(a => !isBlankArtwork(a)).length;
  return ord < sentLength ? ord : null;
}
