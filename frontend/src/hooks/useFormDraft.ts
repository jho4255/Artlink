/**
 * useFormDraft - 등록 폼 임시저장 (갤러리·공모·전시)
 *
 * 규칙은 `lib/formDraft.ts` 에 있다(만료 없음 · 정하기 전엔 쓰지 않음 · 제출해도 정하지 않은 옛 초안은 남김).
 * 이 훅은 그 칸을 컴포넌트 수명 동안 하나 들고, 바뀔 때 다시 그리게 하고, 3초 자동저장만 더한다.
 *
 * 화면 쪽 약속:
 *  - `pending` 이 있으면 폼 위에 `<DraftNotice>` 를 띄워 [이어서 쓰기]·[새로 쓰기] 를 고르게 한다.
 *  - [임시저장] 버튼은 `save()` 가 false 면 "먼저 골라 달라" 고 알린다(조용히 덮어쓰지 않는다).
 *  - 버튼 옆에 `savedAt` 으로 마지막 저장 시각을 보여 준다.
 */
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { createDraftSlot, type DraftSlot } from '@/lib/formDraft';

export function useFormDraft<T>(key: string) {
  // 칸은 처음 한 번만 읽는다 — 그 뒤 바뀌는 건 slot 이 들고 있고, rerender 로 화면에 알린다
  const [slot] = useState<DraftSlot<T>>(() => createDraftSlot<T>(key));
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resume = useCallback(() => { const d = slot.resume(); rerender(); return d; }, [slot]);
  const discard = useCallback(() => { slot.discard(); rerender(); }, [slot]);
  const save = useCallback((data: T) => { const ok = slot.save(data); if (ok) rerender(); return ok; }, [slot]);
  const clear = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    slot.clear();
    rerender();
  }, [slot]);

  // 입력을 멈추고 3초 뒤 저장 — 정하지 않은 초안이 있으면 slot 이 거절한다(옛 초안을 덮어쓰지 않는다)
  const autoSave = useCallback((data: T) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { if (slot.save(data)) rerender(); }, 3000);
  }, [slot]);

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  return { pending: slot.pending, savedAt: slot.savedAt, resume, discard, save, clear, autoSave };
}
