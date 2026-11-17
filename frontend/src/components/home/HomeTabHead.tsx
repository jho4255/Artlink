import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

/**
 * 휴대폰 홈 탭 안의 칸 머리 (2026-11-14, `lib/homeTabs.ts`) — 칸 제목은 탭이 대신하므로 **제목 옆에 있던 단추만** 남는다.
 * 탭마다 같은 높이·같은 자리라 탭을 바꿔도 머리 줄이 출렁이지 않는다.
 */
export function HomeTabHead({ children }: { children: ReactNode }) {
  return <div className="-mr-2 mb-1 flex min-h-11 items-center justify-end">{children}</div>;
}

/** 칸마다 '더보기 →'·'전체 →' 로 달랐던 링크를 탭 안에서는 [전체 보기] 하나로 맞춘다(ArtStory 머리와 같은 모양) */
export function HomeTabAll({ to }: { to: string }) {
  return <Link to={to} className="px-2 py-2.5 text-sm text-gray-500 hover:text-gray-900">전체 보기</Link>;
}
