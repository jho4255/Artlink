/**
 * 등록 폼 임시저장(갤러리·공모·전시) — 이 브라우저의 localStorage 칸 하나 (2026-09-29 개편).
 *
 * ## 예전 문제 넷
 *  1. **24시간이 지나면 말없이 사라졌다.** '임시저장' 이라는 이름이 며칠 뒤 이어 쓸 수 있다고 말하는데 아니었다.
 *  2. 다시 들어오면 브라우저 기본 창(`window.confirm`)으로 "복원하시겠습니까?" 를 물었다 — 사이트 화면과 딴판이다.
 *  3. 거기서 [취소]를 누르면 빈 폼으로 시작하고, **아무거나 입력하는 순간 3초 자동저장이 옛 초안을 덮어썼다.**
 *  4. 그 상태에서 새로 쓴 걸 제출하면 제출 성공 처리가 **정하지도 않은 옛 초안까지 지웠다.**
 *
 * ## 지금 규칙
 *  - 만료 없음. 지울 때는 사람이 [새로 쓰기]를 고르거나, 이어 쓴 내용을 제출했을 때뿐.
 *  - 저장된 초안이 있으면 **정할 때까지(pending)** 이 칸에 쓰지 않는다 — 자동저장·[임시저장]·제출 후 정리 모두.
 *    화면은 폼 위에 [이어서 쓰기]·[새로 쓰기] 를 띄운다(`components/flow/DraftNotice`).
 *  - 칸은 폼마다 하나다(공고 여러 개를 동시에 써 두는 기능은 없다 — 필요해지면 서버 저장으로 간다).
 *
 * React 없이 돌아가게 둔다 — 규칙은 여기서 테스트하고(`__tests__/formDraft.test.ts`), 훅은 감싸기만 한다.
 */

export interface StoredDraft<T> {
  data: T;
  savedAt: number;
}

/** localStorage 가 막힌 환경(사생활 보호 창·미리보기)에서도 화면이 죽지 않게 */
function defaultStorage(): Storage | null {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}

export function readDraft<T>(storage: Storage | null, key: string): StoredDraft<T> | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<StoredDraft<T>>;
    if (!d || typeof d !== 'object' || d.data == null || typeof d.savedAt !== 'number') throw new Error('bad draft');
    return { data: d.data as T, savedAt: d.savedAt };
  } catch {
    try { storage.removeItem(key); } catch { /* 무시 */ }
    return null;
  }
}

export interface DraftSlot<T> {
  /** 저장돼 있는데 아직 이어 쓸지 정하지 않은 초안 */
  readonly pending: StoredDraft<T> | null;
  /** 지금 쓰고 있는 내용이 마지막으로 저장된 시각(표시용) */
  readonly savedAt: number | null;
  /** [이어서 쓰기] — 초안을 돌려주고, 이제부터 이 폼이 그 칸의 주인이다 */
  resume(): T | null;
  /** [새로 쓰기] — 저장된 초안을 지운다 */
  discard(): void;
  /** 저장. 정하지 않은 초안이 있으면 쓰지 않고 false */
  save(data: T, now?: number): boolean;
  /** 제출 성공 뒤 정리. 정하지 않은 옛 초안은 이 제출과 무관하므로 남긴다 */
  clear(): void;
}

export function createDraftSlot<T>(key: string, storage: Storage | null = defaultStorage()): DraftSlot<T> {
  let pending: StoredDraft<T> | null = readDraft<T>(storage, key);
  let savedAt: number | null = null;
  const remove = () => { try { storage?.removeItem(key); } catch { /* 무시 */ } };
  return {
    get pending() { return pending; },
    get savedAt() { return savedAt; },
    resume() {
      const d = pending ?? readDraft<T>(storage, key);
      pending = null;
      savedAt = d?.savedAt ?? null;
      return d?.data ?? null;
    },
    discard() {
      remove();
      pending = null;
      savedAt = null;
    },
    save(data, now = Date.now()) {
      if (pending || !storage) return false;   // 쓸 곳이 없으면(사생활 보호 창 등) 저장됐다고 말하지 않는다
      try {
        storage.setItem(key, JSON.stringify({ data, savedAt: now } satisfies StoredDraft<T>));
      } catch {
        return false; // 저장 공간이 가득 찼거나 막힌 환경 — 저장됐다고 말하지 않는다
      }
      savedAt = now;
      return true;
    },
    clear() {
      if (pending) return;
      remove();
      savedAt = null;
    },
  };
}

/** '오늘 14:20' · '어제 09:05' · '9월 27일 14:20' · '2025년 9월 27일' — 이 기기의 시계 기준 */
export function savedAtLabel(ts: number, now: number = Date.now()): string {
  const d = new Date(ts);
  const n = new Date(now);
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(n) - startOf(d)) / 86_400_000);
  if (days === 0) return `오늘 ${hm}`;
  if (days === 1) return `어제 ${hm}`;
  if (d.getFullYear() === n.getFullYear()) return `${d.getMonth() + 1}월 ${d.getDate()}일 ${hm}`;
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
}
