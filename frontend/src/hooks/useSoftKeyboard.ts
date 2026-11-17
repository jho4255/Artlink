import { useEffect, useState } from 'react';

/**
 * 휴대폰 자판이 떠 있는가 (2026-11-14, 앱 점검에서 나옴).
 *
 * 안드로이드 앱(WebView)은 자판이 뜨면 **화면(레이아웃) 자체가 줄어든다** — 그래서 아래에 붙은 하단 탭바가
 * 자판 바로 위로 따라 올라와, 댓글·답글을 쓰는 동안 글자 칸 자리를 먹었다(브라우저는 자판이 탭바를 덮어 티가 안 났다).
 * 글자 칸에 있고 보이는 높이가 평소보다 20% 넘게 줄었으면 자판이 떠 있다고 본다.
 * 평소 높이는 **글자 칸에 있지 않을 때** 본 가장 큰 높이 — 화면을 돌리면 다시 잰다.
 */
const NON_TEXT = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file', 'image', 'hidden']);

/** 자판이 뜨는 칸인가 — 글 칸·입력칸(체크·단추류 빼고)·편집기 */
export function isTextEntry(el: Element | null): boolean {
  if (!el || typeof HTMLElement === 'undefined' || !(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled;
  if (el instanceof HTMLInputElement) return !el.readOnly && !el.disabled && !NON_TEXT.has(el.type);
  return false;
}

/** 자판이 떠 있다고 볼 때 — 글자 칸에 있고, 보이는 높이가 평소의 80% 아래 */
export function keyboardLikelyOpen(typing: boolean, height: number, base: number): boolean {
  return typing && base > 0 && height < base * 0.8;
}

export function useSoftKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const vv = window.visualViewport;
    const now = () => Math.round(vv?.height ?? window.innerHeight);
    let base = Math.max(now(), window.innerHeight);
    let timer = 0;
    const check = () => {
      const typing = isTextEntry(document.activeElement);
      const h = now();
      if (!typing) base = Math.max(base, h, window.innerHeight);
      const next = keyboardLikelyOpen(typing, h, base);
      setOpen((p) => (p === next ? p : next));
    };
    // 칸을 옮겨 다닐 때 잠깐 '아무 칸도 아님'이 끼므로 한 박자 뒤에 본다
    const later = () => { window.clearTimeout(timer); timer = window.setTimeout(check, 60); };
    const turned = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => { base = Math.max(now(), window.innerHeight); check(); }, 400);
    };
    vv?.addEventListener('resize', check);
    window.addEventListener('resize', check);
    document.addEventListener('focusin', later);
    document.addEventListener('focusout', later);
    window.addEventListener('orientationchange', turned);
    return () => {
      window.clearTimeout(timer);
      vv?.removeEventListener('resize', check);
      window.removeEventListener('resize', check);
      document.removeEventListener('focusin', later);
      document.removeEventListener('focusout', later);
      window.removeEventListener('orientationchange', turned);
    };
  }, []);
  return open;
}
