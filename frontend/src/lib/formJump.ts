/**
 * 등록 화면의 '남은 필수 칸'으로 데려가기(2026-11-15 — 공모·갤러리·전시 등록 공통).
 * 칸을 감싼 `data-field="<키>"` 를 찾아 화면 가운데로 옮기고, 입력칸이면 커서까지 둔다.
 * 하단 고정 줄(components/form/StickySubmitBar)의 '남은 필수 N · 칸 이름'과 [등록 요청]이 부른다.
 */
export function jumpToField(key: string) {
  const box = document.querySelector<HTMLElement>(`[data-field="${key}"]`);
  if (!box) return;
  // 한 구역에 칸이 여럿이면(일정 달력) 표시만 두고 `data-field-focus` 로 그 칸을 가리킨다
  const focusSel = box.dataset.fieldFocus;
  const target = (focusSel && document.querySelector<HTMLElement>(focusSel))
    || box.querySelector<HTMLElement>('input, select, textarea, [contenteditable="true"], button');
  (target ?? box).scrollIntoView({ behavior: 'smooth', block: 'center' });
  window.setTimeout(() => target?.focus({ preventScroll: true }), 350);
}
