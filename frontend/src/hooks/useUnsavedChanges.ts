/**
 * useUnsavedChanges - 미저장 변경사항 이탈 경고 훅
 *
 * 기능:
 *  - beforeunload (브라우저 닫기/새로고침) 차단
 *  - 조건부 활성화 (isDirty가 true일 때만)
 *
 * @see Phase 4 - 폼 UX 개선
 */
import { useEffect } from 'react';

export function useUnsavedChanges(isDirty: boolean) {
  useEffect(() => {
    if (!isDirty) return;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // 표준 방식: returnValue 설정 (대부분의 브라우저에서 커스텀 메시지는 무시됨)
      e.returnValue = '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);
}
