/**
 * 포트폴리오 PDF 버전 — 순수 함수 (2026-09-16).
 *
 * 버전은 홈페이지 작품 위에 얹는 **선택과 순서**다. 국내 공모는 A4 24장·이미지 10점처럼 장수를 제한하는 곳이 많아,
 * 27점 전부를 싣는 책 하나로는 제출 요건을 못 맞춘다(조사 A3). 그래서 "공모용 10점"·"갤러리용 전체" 를 따로 저장한다.
 *
 * 화면에서는 2026-10-03 부터 **'구성'** 이라고 부른다(포트폴리오 만들기 개편 — '버전' 은 무엇의 버전인지 안 읽혔다).
 * 모델·주소(`PortfolioVersion`, `/portfolio/versions`)와 이 파일의 이름은 그대로다. 새 구성의 이름은 `lib/portfolioMaker.ts nextSelectionName`.
 */
import type { PortfolioImage, PortfolioVersion } from '@/types';

/**
 * 버전이 실을 작품 — `workIds` 순서대로, **실제로 있는 작품만**(지운 작품 id 는 배열에 남을 수 있다).
 * `workIds` 가 비어 있으면 전체 작품을 홈페이지 순서로(= 기본 버전과 같다).
 */
export function versionWorks(all: PortfolioImage[], version: PortfolioVersion | null | undefined): PortfolioImage[] {
  if (!version || version.workIds.length === 0) return all;
  const byId = new Map(all.map((w) => [w.id, w] as const));
  const seen = new Set<number>();
  const out: PortfolioImage[] = [];
  for (const id of version.workIds) {
    const w = byId.get(id);
    if (w && !seen.has(id)) { out.push(w); seen.add(id); }
  }
  return out;
}

/** 버전이 쓰는 디자인 — 제 것이 없으면 기본 디자인 */
export function versionDesign(version: PortfolioVersion | null | undefined, defaultDesign: unknown): unknown {
  return version?.design ?? defaultDesign ?? null;
}

/** 선택 목록에서 한 칸 옮기기(순서 바꾸기). 범위를 벗어나면 그대로 */
export function moveId(ids: number[], id: number, delta: -1 | 1): number[] {
  const i = ids.indexOf(id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= ids.length) return ids;
  const next = [...ids];
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
}

/**
 * 끌어서 놓기 — `id` 를 `targetId` 가 있던 자리로 옮기고 그 사이는 한 칸씩 민다(2026-10-15, `SortableTiles`).
 * 두 칸을 맞바꾸는 게 아니다 — 30번째를 1번째로 끌면 나머지는 한 칸씩 뒤로 간다(사람이 기대하는 '끼워 넣기').
 * 없는 id 거나 제자리면 **같은 배열**을 돌려준다(부르는 쪽이 저장을 건너뛴다).
 */
export function moveIdTo(ids: number[], id: number, targetId: number): number[] {
  const from = ids.indexOf(id);
  const to = ids.indexOf(targetId);
  if (from < 0 || to < 0 || from === to) return ids;
  const next = [...ids];
  next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}
