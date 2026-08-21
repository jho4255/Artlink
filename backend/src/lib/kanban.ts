/**
 * Admin 할 일 보드의 순서·정렬 계산 (순수 함수 — DB 없이 테스트 가능).
 *
 * 이름이 kanban 인 이유: 처음엔 3열 칸반이었다가 목록형 체크리스트로 바뀌었다.
 * 열(column) 개념은 없다 — 완료 여부는 `doneAt` 하나뿐이다.
 *
 * position 은 "보드 안에서 0부터 연속"이라는 규약이다. 소수점 사이값(0.5)을 끼워 넣는 방식은
 * 옮길수록 자릿수가 늘어 결국 부동소수점 정밀도에서 순서가 뒤집히므로 쓰지 않는다.
 * 대신 재정렬할 때마다 보드 전체를 0..n-1 로 다시 매긴다.
 */

export interface OrderedItem {
  id: number;
  position: number;
  doneAt?: Date | string | null;
}

/**
 * 화면에 뿌릴 순서.
 *
 *   ① 아직 안 한 일 — position 순 (사용자가 끌어 정한 우선순위)
 *   ② 완료한 일   — 최근에 체크한 것부터
 *
 * 완료 항목을 position 과 섞지 않는 이유: 체크했다고 그 줄을 실제로 옮겨버리면
 * 체크를 푸는 순간 원래 자리로 못 돌아온다. position 은 건드리지 않고 정렬만 뒤로 보낸다.
 */
export function sortItems<T extends OrderedItem>(items: T[]): T[] {
  const time = (v: Date | string | null | undefined) => (v ? new Date(v).getTime() : 0);
  return [...items].sort((a, b) => {
    const ad = !!a.doneAt, bd = !!b.doneAt;
    if (ad !== bd) return ad ? 1 : -1;
    if (ad && bd) return time(b.doneAt) - time(a.doneAt) || a.id - b.id;
    return a.position - b.position || a.id - b.id;
  });
}

/**
 * 클라이언트가 보낸 순서(ids)대로 position 을 0..n-1 로 다시 매긴다.
 *
 * ids 에 없는 항목(내가 보고 있는 사이 다른 Admin 이 추가한 것)은 **뒤에 붙인다** —
 * 여기서 409 로 거절하면 두 사람이 같이 쓰는 보드에서 재정렬이 자꾸 실패한다.
 * 최악이라도 순서가 한 번 어긋날 뿐이고, 그건 다시 끌어서 고칠 수 있다.
 *
 * @param current 보드의 현재 항목 (position 순으로 들어온다고 가정하지 않는다)
 * @param ids     원하는 순서
 * @returns 실제로 position 이 바뀐 항목만
 */
export function reorderItems<T extends OrderedItem>(current: T[], ids: number[]): { id: number; position: number }[] {
  const known = new Map(current.map(i => [i.id, i]));
  const seen = new Set<number>();
  const ordered: number[] = [];

  for (const id of ids) {
    if (!known.has(id) || seen.has(id)) continue; // 없는 id·중복은 조용히 무시
    seen.add(id);
    ordered.push(id);
  }
  // 빠진 항목은 원래 순서대로 뒤에
  for (const item of [...current].sort((a, b) => a.position - b.position || a.id - b.id)) {
    if (!seen.has(item.id)) ordered.push(item.id);
  }

  return ordered
    .map((id, position) => ({ id, position }))
    .filter(p => known.get(p.id)!.position !== p.position);
}

/**
 * 보드 목록처럼 단순 목록의 순서 이동 (보드 자체를 위아래로 옮길 때).
 * ids 는 현재 화면 순서대로 들어온다.
 */
export function moveInList(ids: number[], id: number, targetIndex: number): { id: number; position: number }[] {
  const from = ids.indexOf(id);
  if (from === -1) return [];
  const rest = ids.filter(v => v !== id);
  const index = Math.max(0, Math.min(Math.trunc(targetIndex) || 0, rest.length));
  rest.splice(index, 0, id);
  return rest
    .map((v, i) => ({ id: v, position: i }))
    .filter(p => ids[p.position] !== p.id);
}
