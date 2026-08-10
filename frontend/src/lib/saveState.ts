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
