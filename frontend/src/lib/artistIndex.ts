/**
 * 작가 목록을 **초성 칸으로 묶는다** — [작가] 탭 왼쪽 목록의 ㄱ/ㄴ/ㄷ 펼쳐보기 (2026-09-13)
 *
 * ⚠️ **여기서 초성을 계산하지 않는다.** 판정은 서버(`backend/src/lib/hangulIndex.ts`)가 하고
 *    응답의 `initial` 로 내려온다. 화면이 따로 계산하면 규칙이 둘이 되어, 한쪽만 고치는 순간
 *    'ㄱ' 칸 안에 'ㄴ' 이름이 섞인다. 여기는 **이미 정렬된 목록을 묶기만** 한다.
 *
 * ⚠️ 서버가 이미 **칸 순서 → 이름순**으로 정렬해 주므로 다시 정렬하지 말 것 —
 *    서버가 쓰는 `localeCompare('ko')` 와 브라우저의 그것이 같다는 보장이 없다.
 */

export interface IndexedArtist {
  id: number;
  name: string;
  /** 서버가 정해 준 색인 칸 (ㄱ~ㅎ 14칸 · `A–Z` · `#`) */
  initial?: string;
}

export interface ArtistGroup<T> {
  initial: string;
  artists: T[];
}

/**
 * 같은 `initial` 끼리 묶는다. **처음 나온 순서**를 그대로 지키므로 서버가 정한 칸 순서가 곧 화면 순서다.
 *
 * ⚠️ 이어진 것만 묶지 말고 **Map 으로 합칠 것** — 정렬이 어떤 이유로든 흐트러졌을 때
 *    이어진 것만 묶으면 같은 'ㄱ' 칸이 목록에 두 번 나타난다(빈 칸을 펼치는 것처럼 보인다).
 * ⚠️ `initial` 이 없으면 `#` 로 떨어뜨린다 — 이름이 통째로 사라지는 것보다 낫다.
 */
export function groupByInitial<T extends IndexedArtist>(artists: readonly T[]): ArtistGroup<T>[] {
  const byInitial = new Map<string, T[]>();
  for (const a of artists) {
    const key = a.initial || '#';
    const bucket = byInitial.get(key);
    if (bucket) bucket.push(a);
    else byInitial.set(key, [a]);
  }
  return [...byInitial].map(([initial, list]) => ({ initial, artists: list }));
}

/**
 * 처음 화면에 들어왔을 때 **펼쳐 둘 칸**.
 *
 * 작가가 적으면 접을 이유가 없고(접어 두면 이름을 보려고 한 번 더 눌러야 한다),
 * 많으면 펼쳐 둘 수가 없다(왼쪽 칸이 수천 px 이 되어 sticky 가 무너지고 작품 격자가 밀린다).
 * 그래서 **개수로 가른다** — 어느 쪽이든 사용자가 헤더를 눌러 바꿀 수 있다.
 */
export const AUTO_EXPAND_MAX = 24;

export function initiallyExpanded<T>(groups: readonly ArtistGroup<T>[], total: number): Set<string> {
  return new Set(total <= AUTO_EXPAND_MAX ? groups.map((g) => g.initial) : []);
}
