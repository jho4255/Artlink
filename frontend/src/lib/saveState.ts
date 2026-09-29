/**
 * 작가 제출물(출품작·작가노트)의 저장 상태와 표시 규칙.
 *
 *  - unsaved : 아직 서버에 안 보냄. 새로고침하면 사라진다(빨간 글자 — 지금 할 일이 있다).
 *  - draft   : 임시저장됨. 서버에 남지만 **갤러리·관리자에게는 보이지 않는다**
 *              (백엔드 operation.ts의 publicSubmission/publishedArtworks가 걸러낸다).
 *  - saved   : 제출됨. 갤러리에 보이고 캡션·PDF·정산에 들어간다.
 *
 * 2026-09-29: 카드 배경을 빨강·노랑·초록으로 칠하던 것을 글자로만 바꿨다(공모 흐름 화면은 흑백 + 빨강 하나).
 * `box` 는 옛 클래식 운영 페이지(OperationClassicPage, 라우트에 연결돼 있지 않다)가 아직 읽어서 남겨 둔다 — 모두 중립색.
 */
export type SaveState = 'empty' | 'unsaved' | 'draft' | 'saved';

export const STATE_UI: Record<SaveState, { box: string; text: string; label: string }> = {
  // 갓 추가해 아직 아무것도 안 쓴 칸 — 경고할 게 없다
  empty: { box: 'border-gray-200 bg-white', text: 'text-gray-400', label: '작성 전' },
  unsaved: { box: 'border-gray-200 bg-white', text: 'text-accent', label: '저장 안 됨' },
  draft: { box: 'border-gray-200 bg-white', text: 'text-gray-500', label: '임시저장 · 갤러리에 안 보임' },
  saved: { box: 'border-gray-200 bg-white', text: 'text-gray-500', label: '✓ 제출됨' },
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
