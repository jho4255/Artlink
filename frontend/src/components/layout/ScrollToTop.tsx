import { useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

/**
 * 화면(경로)이 바뀌면 맨 위에서 시작한다 (2026-10-03 공모 흐름 점검 P1-1).
 *
 * 앱 어디에도 이 장치가 없어서, 브라우저가 앞 화면의 스크롤 위치를 그대로 들고 왔다 — 공모 상세에서 [지원하기]까지 내려
 * 누르면 **지원서가 경력 중간부터** 열렸고(PC scrollY 1151 · 모바일 952, 제목과 '홈페이지 내용으로 채웠어요' 안내·1번 약력 칸이
 * 이미 지나가 있었다), 모바일 목록에서 카드를 누르면 상세가 포스터를 지난 자리에서 열렸다.
 *
 * 건드리지 않는 것:
 *  - 뒤로·앞으로(POP) — 브라우저가 기억해 둔 자리로 돌아가야 한다(목록으로 돌아왔는데 맨 위면 보던 곳을 잃는다)
 *  - 같은 화면 안의 변화(`?tab=` · `?work=` · `?ex=` · `#…`) — 경로(pathname)가 같으면 그대로 둔다.
 *    딥링크(`?ex=` 로 카드를 펼치는 화면)는 자기가 카드로 스크롤한다 — 이 효과가 먼저 돌고 그쪽이 뒤에 덮는다(main.tsx 에서 App 보다 앞).
 * ⚠️ `html { scroll-behavior: smooth }` 라 그냥 scrollTo 를 부르면 맨 위까지 미끄러져 올라간다 — 'instant' 로 바로 놓는다.
 * ⚠️ `useEffect` 가 아니라 **`useLayoutEffect`** — useEffect 는 화면을 한 번 그린 **뒤**에 돌아서, 데이터가 캐시에 있는 화면(상세 → 지원서)은
 *    첫 프레임이 앞 화면의 스크롤 위치(855px)로 그려졌다가 튀어 올라갔다(e2e 66 이 잡았다). 그리기 전에 놓는다.
 */
export default function ScrollToTop() {
  const { pathname } = useLocation();
  const navType = useNavigationType();
  const prev = useRef(pathname);
  useLayoutEffect(() => {
    if (prev.current === pathname) return;
    prev.current = pathname;
    if (navType === 'POP') return;
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior });
  }, [pathname, navType]);
  return null;
}
