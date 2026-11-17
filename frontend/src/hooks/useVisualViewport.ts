import { useEffect, useState } from 'react';

/**
 * 보이는 영역(visualViewport) — 휴대폰 자판이 올라오면 줄어든다 (2026-11-13, 커뮤니티 글쓰기).
 *
 * 글쓰기 화면은 뿌리를 `position:fixed; height = 보이는 높이; translateY(offsetTop)` 로 둬서 아래 도구 막대가 **자판 바로 위**에 붙는다.
 * iOS 사파리(자판이 화면을 덮는다)·안드로이드 크롬(보이는 영역만 준다)·앱 WebView(레이아웃이 준다) 어디서든 같은 식으로 된다.
 * `bottom: N` 으로 따라가지 않는다(떨린다).
 * `keyboard` — 보이는 높이가 창 높이보다 120px 넘게 작으면 자판이 떠 있다고 본다(앱 WebView 처럼 레이아웃이 줄면 false — 그래도 자리는 맞다).
 */
export interface ViewportBox { height: number; offsetTop: number; keyboard: boolean }

function read(): ViewportBox {
  if (typeof window === 'undefined') return { height: 800, offsetTop: 0, keyboard: false };
  const vv = window.visualViewport;
  if (!vv) return { height: window.innerHeight, offsetTop: 0, keyboard: false };
  return { height: Math.round(vv.height), offsetTop: Math.round(vv.offsetTop), keyboard: window.innerHeight - vv.height > 120 };
}

export function useVisualViewport(): ViewportBox {
  const [box, setBox] = useState<ViewportBox>(read);
  useEffect(() => {
    const vv = window.visualViewport;
    let raf = 0;
    const on = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        // iOS 가 입력칸을 보이려고 페이지를 밀면 되돌린다(뿌리가 fixed 라 밀 것이 없어야 한다)
        if (window.scrollY !== 0 && document.documentElement.dataset.editorLock === '1') window.scrollTo(0, 0);
        setBox((prev) => {
          const next = read();
          return prev.height === next.height && prev.offsetTop === next.offsetTop && prev.keyboard === next.keyboard ? prev : next;
        });
      });
    };
    vv?.addEventListener('resize', on);
    vv?.addEventListener('scroll', on);
    window.addEventListener('resize', on);
    window.addEventListener('orientationchange', on);
    return () => {
      cancelAnimationFrame(raf);
      vv?.removeEventListener('resize', on);
      vv?.removeEventListener('scroll', on);
      window.removeEventListener('resize', on);
      window.removeEventListener('orientationchange', on);
    };
  }, []);
  return box;
}

/** 화면 전체를 쓰는 동안 바깥 페이지가 밀리지 않게 잠근다 — 나가면 되돌린다 */
export function useScrollLock(): void {
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prev = { h: html.style.overflow, b: body.style.overflow, ob: body.style.overscrollBehavior, sb: html.style.scrollBehavior };
    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    body.style.overscrollBehavior = 'none';
    html.style.scrollBehavior = 'auto';
    html.dataset.editorLock = '1';
    window.scrollTo(0, 0);
    return () => {
      html.style.overflow = prev.h;
      body.style.overflow = prev.b;
      body.style.overscrollBehavior = prev.ob;
      html.style.scrollBehavior = prev.sb;
      delete html.dataset.editorLock;
    };
  }, []);
}
