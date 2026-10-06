import prisma from './prisma';

/**
 * 작가 홈페이지 완성도(서버판) — 작품 노출 순서에 쓴다 (2026-10-06 사용자 결정).
 *
 * 홈 ArtWorks·[작가] 탭 작품 격자(랜덤 정렬)에서 **완성도 4항목 중 3개 이상** 채운 작가의 작품을 먼저 보여 준다.
 * 네 항목은 작가가 보는 완성도(프론트 `lib/completeness.ts computeCompleteness`)의 앞 네 칸과 **같은 판정**이다 —
 * 작가에게 "이걸 채우면 위로 올라간다" 고 말할 수 있으려면 두 판정이 어긋나면 안 된다. 한쪽을 고치면 다른 쪽도.
 *   ① 작품 3점 이상(홈페이지에 올린 전부 — '작가 탭에도' 여부와 무관)
 *   ② 모든 작품에 작품 정보(작품명·재료·크기·연도 중 하나라도 — 프론트 `hasCaption`)
 *   ③ 작가노트
 *   ④ 약력 — 약력 글 또는 항목별 경력이 한 줄이라도(프론트 `isCareerEmpty` 의 반대)
 * 다섯째 칸('[작가] 탭에도 소개')은 뺐다 — 작품 격자에 나온다는 것 자체가 이미 그 칸을 채웠다는 뜻이다.
 *
 * ⚠️ [좋아요순]에는 쓰지 않는다(사용자 결정) — 보는 사람이 직접 고른 정렬이다.
 */
export const MIN_WORKS = 3;
export const PRIORITY_MIN_FILLED = 3;

type Caption = { title?: string | null; medium?: string | null; sizeText?: string | null; year?: string | null };
const filled = (v?: string | null) => !!String(v ?? '').trim();

export function hasCaption(img: Caption): boolean {
  return filled(img.title) || filled(img.medium) || filled(img.sizeText) || filled(img.year);
}

/** DB 의 경력 JSON 문자열에 항목이 하나라도 있는가 — 못 읽으면 없는 것으로 친다 */
export function hasCareer(career?: string | null): boolean {
  if (!career) return false;
  try {
    const c = JSON.parse(career);
    if (!c || typeof c !== 'object') return false;
    return ['artFair', 'solo', 'group', 'education', 'award'].some((k) => Array.isArray(c[k]) && c[k].length > 0);
  } catch {
    return false;
  }
}

export interface CompletenessSource {
  statement?: string | null;
  biography?: string | null;
  career?: string | null;
  images: Caption[];
}

/** 채운 항목 수(0~4) */
export function filledCount(p: CompletenessSource): number {
  const images = p.images ?? [];
  return [
    images.length >= MIN_WORKS,
    images.length > 0 && images.every(hasCaption),
    filled(p.statement),
    filled(p.biography) || hasCareer(p.career),
  ].filter(Boolean).length;
}

/** 이 작가들 중 먼저 보여 줄 작가(완성도 3칸 이상)의 id — 쿼리 한 번 */
export async function priorityArtistIds(userIds: number[]): Promise<Set<number>> {
  if (userIds.length === 0) return new Set();
  const portfolios = await prisma.portfolio.findMany({
    where: { userId: { in: [...new Set(userIds)] } },
    select: {
      userId: true, statement: true, biography: true, career: true,
      images: { select: { title: true, medium: true, sizeText: true, year: true } },
    },
  });
  return new Set(portfolios.filter((p) => filledCount(p) >= PRIORITY_MIN_FILLED).map((p) => p.userId));
}
