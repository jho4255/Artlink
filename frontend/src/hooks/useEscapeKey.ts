import { useEffect, useRef } from 'react';

/**
 * Esc 로 닫기 — 창·패널 공용 (2026-10-03, 포트폴리오 만들기 화면에서 겪은 일).
 *
 * `useEffect(() => { window.addEventListener('keydown', onKey) … }, [onClose])` 처럼 **부모가 매 렌더 새로 만드는 콜백**을
 * 의존성에 두면 안 된다. Esc 를 듣는 것이 둘일 때(옆 패널 + 그 위의 창), 먼저 불린 쪽이 상태를 바꾸면 React 가 곧바로 다시 그리고
 * (키 입력은 동기로 반영된다) 그 사이에 다른 쪽의 리스너가 **떼어졌다 다시 붙는다** — 지금 처리 중인 키 입력에는 새로 붙인 리스너가
 * 불리지 않는다. 그래서 Esc 를 눌렀는데 위의 창은 그대로이고 아래 패널만 닫혔다(E2E 64 가 잡았다).
 * 여기서는 리스너를 한 번만 붙이고, 부를 함수는 ref 로 최신 것을 본다.
 *
 * `enabled` 가 false 면 듣지 않는다(작업 중에는 닫히면 안 되는 창).
 * `yieldToModal` — 모달 창(`role="dialog"` + `aria-modal="true"`)이 떠 있으면 양보한다. 창 **아래**에 깔린 패널이 쓴다:
 * Esc 는 맨 위의 것 하나만 닫아야 한다.
 */
export function useEscapeKey(onEscape: () => void, opts: { enabled?: boolean; yieldToModal?: boolean } = {}) {
  const fn = useRef(onEscape);
  const enabled = useRef(opts.enabled ?? true);
  const yieldToModal = useRef(!!opts.yieldToModal);
  useEffect(() => {
    fn.current = onEscape;
    enabled.current = opts.enabled ?? true;
    yieldToModal.current = !!opts.yieldToModal;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !enabled.current) return;
      if (yieldToModal.current && document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      fn.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
