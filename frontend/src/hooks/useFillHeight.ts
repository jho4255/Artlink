import { useLayoutEffect, useState, type RefObject } from 'react';

/**
 * 그 상자가 **지금 보이는 화면의 바닥까지** 차지할 높이 — 상단바 아래에서 시작해 하단 탭바(휴대폰) 위에서 끝난다.
 * 마이페이지 [ArtLook] 탭이 iframe 높이로 쓴다(2026-10-04, CLAUDE.md 규칙 65).
 *
 * CSS(`100dvh - …`)로 하지 않은 이유: 위에 무엇이 있는지(상단바·제목 줄·여백)가 화면 폭마다 달라서 숫자를 손으로 맞추면
 * 하나만 바뀌어도 어긋난다. 상자의 실제 위치를 재면 맞다. 하단 탭바는 lg 미만에서만 있다(`BottomTabBar`, fixed).
 * ⚠️ 문서 기준 위치(top + scrollY)로 잰다 — 스크롤한 채로 다시 재도 같은 답.
 */
export function useFillHeight(ref: RefObject<HTMLElement | null>, opts: { enabled?: boolean; min?: number; gap?: number } = {}): number | null {
  const { enabled = true, min = 420, gap = 24 } = opts;
  const [height, setHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!enabled) return;
    const fit = () => {
      const el = ref.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top + window.scrollY;
      const bar = document.querySelector<HTMLElement>('nav[aria-label="하단 내비게이션"]');
      const barH = bar && getComputedStyle(bar).display !== 'none' ? bar.getBoundingClientRect().height : 0;
      const vh = window.visualViewport?.height ?? window.innerHeight;
      setHeight(Math.max(min, Math.round(vh - top - barH - (barH ? 0 : gap))));
    };
    fit();
    window.addEventListener('resize', fit);
    window.visualViewport?.addEventListener('resize', fit);
    return () => {
      window.removeEventListener('resize', fit);
      window.visualViewport?.removeEventListener('resize', fit);
    };
  }, [ref, enabled, min, gap]);
  return height;
}
