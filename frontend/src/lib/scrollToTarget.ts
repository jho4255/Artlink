/**
 * 요소를 그 요소의 `scroll-margin-top` 만큼 띄워 화면 위로 (2026-11-11, CLAUDE.md 규칙 79).
 *
 * ⚠️ `el.scrollIntoView()` 를 쓰지 말 것 — 크롬 124(안드로이드 에뮬레이터 앱 WebView 실측)는 **`overflow:hidden` 인 요소**의
 * `scroll-margin-top` 을 무시하고 맨 위에 붙인다(같은 여백을 준 평범한 div 는 지킨다). 그래서 알림으로 연 문의의 제목이
 * 상단바 뒤로 숨었다. 앱 WebView 는 기기마다 판이 다르고, 옛 휴대폰 크롬도 같다. 여백을 직접 읽어 계산하면 판과 무관하다.
 */
export function scrollToTarget(el: Element | null | undefined, behavior: ScrollBehavior = 'smooth'): void {
  if (!el) return;
  const margin = parseFloat(getComputedStyle(el).scrollMarginTop) || 0;
  window.scrollTo({ top: Math.max(0, el.getBoundingClientRect().top + window.scrollY - margin), behavior });
}
