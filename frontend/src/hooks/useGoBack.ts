/**
 * 뒤로가기 — **막다른 길이 되지 않는** 버전.
 *
 * `navigate(-1)` 은 브라우저 기록이 있을 때만 동작한다. 그래서 아래 경우엔 눌러도 아무 일이 없다.
 *   · 새 탭으로 열린 페이지 (마이페이지의 '공개 작가 페이지 보기' 가 그랬다)
 *   · 카톡·문자로 받은 링크를 바로 연 경우
 *   · 검색 결과에서 바로 들어온 경우
 *
 * 공개 페이지는 **공유되는 것이 정상**이라 이 상황이 드물지 않다.
 * 기록이 없으면 조용히 목록으로 보낸다 — 버튼이 아무 반응도 없는 것보다 낫다.
 *
 * 판정에 `history.state.idx` 를 쓰는 이유: React Router 가 방문 순번을 여기에 넣어 둔다.
 * 0 이면 이 탭에서 우리가 처음 연 화면이라는 뜻이다. `history.length` 는 다른 사이트 방문까지
 * 세기 때문에 믿을 수 없다.
 */
import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

export function useGoBack(fallback: string) {
  const navigate = useNavigate();
  return useCallback(() => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate(fallback, { replace: true });
  }, [navigate, fallback]);
}
