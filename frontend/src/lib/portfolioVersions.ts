/**
 * 포트폴리오 PDF 버전 — 순수 함수 (2026-09-16).
 *
 * 버전은 홈페이지 작품 위에 얹는 **선택과 순서**다. 국내 공모는 A4 24장·이미지 10점처럼 장수를 제한하는 곳이 많아,
 * 27점 전부를 싣는 책 하나로는 제출 요건을 못 맞춘다(조사 A3). 그래서 "공모용 10점"·"갤러리용 전체" 를 따로 저장한다.
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

/** 새 버전 이름 — 겹치지 않게 "새 버전 2" 처럼 */
export function nextVersionName(existing: { name: string }[], base = '새 버전'): string {
  const names = new Set(existing.map((v) => v.name));
  if (!names.has(base)) return base;
  for (let i = 2; i < 100; i++) if (!names.has(`${base} ${i}`)) return `${base} ${i}`;
  return `${base} ${Date.now()}`;
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
