/**
 * useFormDraft - localStorage 기반 폼 임시저장 훅
 *
 * 기능:
 *  - 3초 디바운스 자동저장
 *  - 24시간 만료
 *  - 재진입 시 복원 confirm
 *  - saveDraft() / clearDraft() / hasDraft 노출
 *
 * @see Phase 4 - 폼 UX 개선
 */
import { useState, useEffect, useCallback, useRef } from 'react';

interface DraftData<T> {
  data: T;
  savedAt: number;
}

const DRAFT_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24시간

export function useFormDraft<T>(key: string, initialData: T) {
  const [hasDraft, setHasDraft] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initializedRef = useRef(false);

  // 초기화 시 기존 draft 확인 + 복원 confirm
  const loadDraft = useCallback((): T | null => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const draft: DraftData<T> = JSON.parse(raw);
      // 만료 체크
      if (Date.now() - draft.savedAt > DRAFT_EXPIRY_MS) {
        localStorage.removeItem(key);
        return null;
      }
      return draft.data;
    } catch {
      localStorage.removeItem(key);
      return null;
    }
  }, [key]);

  // 마운트 시 draft 존재 여부 체크
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    const draft = loadDraft();
    setHasDraft(!!draft);
  }, [loadDraft]);

  // draft 복원 (사용자가 confirm 후 호출)
  const restoreDraft = useCallback((): T | null => {
    return loadDraft();
  }, [loadDraft]);

  // 즉시 저장
  const saveDraft = useCallback((data: T) => {
    const draft: DraftData<T> = { data, savedAt: Date.now() };
    localStorage.setItem(key, JSON.stringify(draft));
    setHasDraft(true);
  }, [key]);

  // 3초 디바운스 자동저장
  const autoSave = useCallback((data: T) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      saveDraft(data);
    }, 3000);
  }, [saveDraft]);

  // draft 삭제
  const clearDraft = useCallback(() => {
    localStorage.removeItem(key);
    setHasDraft(false);
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, [key]);

  // 언마운트 시 타이머 정리
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return { hasDraft, saveDraft, autoSave, clearDraft, restoreDraft };
}
