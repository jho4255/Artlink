/**
 * useUnsavedChanges - 미저장 변경사항 이탈 경고 훅
 *
 * 막는 경로 3가지:
 *  1) 브라우저 닫기 / 새로고침  → beforeunload (문구는 브라우저 기본, 커스텀 불가)
 *  2) 브라우저 뒤로가기          → popstate 감시 + 취소 시 현재 위치 복원
 *  3) 앱 안의 링크 클릭          → 캡처 단계에서 가로채 confirm
 *
 * react-router의 useBlocker를 쓰지 않는 이유: 그건 데이터 라우터(createBrowserRouter)
 * 전용인데 이 앱은 <BrowserRouter>를 쓴다. 라우터 교체는 영향 범위가 커서
 * 브라우저 기본 이벤트로 처리한다.
 *
 * @see Phase 4 - 폼 UX 개선
 */
import { useEffect } from 'react';

const DEFAULT_MESSAGE = '저장하지 않은 내용이 있습니다.\n이 페이지를 벗어나면 작성 중인 내용이 사라집니다.\n\n그래도 나가시겠습니까?';

export function useUnsavedChanges(isDirty: boolean, message: string = DEFAULT_MESSAGE) {
  useEffect(() => {
    if (!isDirty) return;

    // 1) 닫기 / 새로고침
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // 표준 방식: returnValue 설정 (대부분의 브라우저에서 커스텀 메시지는 무시됨)
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);

    // 2) 뒤로가기 — 더미 항목을 하나 쌓아두고, 뒤로 갈 때 확인 후 진행/복원
    window.history.pushState(null, '', window.location.href);
    const onPopState = () => {
      // eslint-disable-next-line no-alert
      if (window.confirm(message)) window.history.back();
      else window.history.pushState(null, '', window.location.href);
    };
    window.addEventListener('popstate', onPopState);

    // 3) 앱 내부 링크 클릭 (Navbar 등) — 라우터가 처리하기 전에 캡처 단계에서 확인
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
      const anchor = (e.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!anchor) return;
      const href = anchor.getAttribute('href') || '';
      // 외부 링크·새 탭·앵커 이동은 그대로 둔다 (새 탭은 현재 페이지를 떠나지 않음)
      if (!href.startsWith('/') || anchor.target === '_blank') return;
      if (href === window.location.pathname) return;
      // eslint-disable-next-line no-alert
      if (!window.confirm(message)) { e.preventDefault(); e.stopPropagation(); }
    };
    document.addEventListener('click', onClick, true);

    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('popstate', onPopState);
      document.removeEventListener('click', onClick, true);
    };
  }, [isDirty, message]);
}
