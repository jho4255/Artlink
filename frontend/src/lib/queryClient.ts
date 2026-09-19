import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5분
      // 최대 3회 재시도 + 지수 백오프 (1초, 2초, 4초)
      // 4xx 는 다시 쳐도 같은 답이다 — 404·403·429 까지 네 번 치면 오류 화면이 8~9초 늦고 rate limit 만 앞당긴다(2026-09-19)
      retry: (count, err: any) => ((err?.response?.status ?? 500) >= 500) && count < 3,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 8000),
      refetchOnWindowFocus: false,
    },
  },
});
