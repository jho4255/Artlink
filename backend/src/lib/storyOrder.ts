/**
 * [전체 보기] 무작위 순서 (2026-11-14 사용자 결정 — "새로고침하면 안 본 스토리 걍 랜덤으로, 대신 너무 오래된 건 안 뜨게")
 *
 * 순서: ① 올린 지 하루 안 된 **내 소식**(최신순) → ② **안 본** 남의 소식(시드로 섞음) → ③ 본 소식·그 밖의 내 소식(최신순).
 *  - '본 소식'은 서버가 모른다 — 화면이 이 기기에서 본 소식 id 를 보낸다(`?seen=`, 화면을 열 때 한 번 찍은 것).
 *  - 섞는 건 **소식마다 시드로 정한 값**(`storyRank`)으로 정렬한다. 배열을 통째로 섞으면(Fisher–Yates) 소식 하나가
 *    빠지거나 들어올 때 **전체 순서가 바뀐다** — 보기 화면에서 신고·그만 보기 하고 닫으면 격자가 통째로 뒤섞였을 것이다.
 *  - 시드가 같으면 순서가 같다 — 쪽을 이어 받아도(offset) 겹치거나 빠지지 않는다.
 */

/** 시드·소식 id 로 정한 32비트 값(murmur3 fmix32) — 같은 (seed, id) 면 늘 같다 */
export function storyRank(seed: number, id: number): number {
  let h = (seed ^ Math.imul(id, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

export interface StoryHead {
  id: number;
  authorId: number;
  createdAt: Date;
}

/**
 * @param heads 최신순으로 받은 후보(공개·안 내림·기간 안 등은 이미 걸렀다)
 * @returns 보여 줄 순서의 소식 id
 */
export function shuffledStoryIds(
  heads: StoryHead[],
  opts: { seed: number; seen: ReadonlySet<number>; me?: number; now?: number; mineFrontMs: number },
): number[] {
  const now = opts.now ?? Date.now();
  const mineFront: number[] = [];
  const fresh: StoryHead[] = [];
  const rest: number[] = [];
  for (const h of heads) {
    const mine = opts.me != null && h.authorId === opts.me;
    if (mine && now - h.createdAt.getTime() < opts.mineFrontMs) mineFront.push(h.id);
    else if (!mine && !opts.seen.has(h.id)) fresh.push(h);
    else rest.push(h.id); // 본 소식 · 하루 지난 내 소식 — 최신순 그대로
  }
  fresh.sort((a, b) => storyRank(opts.seed, a.id) - storyRank(opts.seed, b.id) || a.id - b.id);
  return [...mineFront, ...fresh.map((h) => h.id), ...rest];
}

/** `?seed=` — 1 이상 정수만(그 밖엔 '시드 없음' = 예전처럼 최신순) */
export function parseSeed(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 2_147_483_647 ? n : null;
}

/** `?seen=1,2,3` — 양의 정수만, 앞에서부터 max 개 */
export function parseIdList(raw: unknown, max: number): Set<number> {
  const out = new Set<number>();
  if (typeof raw !== 'string' || !raw) return out;
  for (const part of raw.split(',')) {
    const n = Number(part);
    if (Number.isInteger(n) && n > 0) out.add(n);
    if (out.size >= max) break;
  }
  return out;
}
