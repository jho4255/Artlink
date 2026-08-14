/**
 * 공모 운영 권한 — "누가 이 공모를 갤러리처럼 운영할 수 있는가"를 한 곳에서 판정한다.
 *
 * ## 배경
 * 원래 공모의 운영자는 `exhibition.gallery.ownerId` 한 명뿐이었다. 여기에 **아트링크(Admin) 주최 공모**가
 * 생기면서, admin 이 지정한 **여러 갤러리**가 실질적인 운영(지원자 관리·초대·전시 확정·정산)을 맡는다.
 *
 * ## 규칙 (중요)
 * 운영 위임은 **`hostType === 'ADMIN'` 인 공모에서만** 동작한다. 갤러리가 직접 등록한 공모에는
 * `ExhibitionManager` 행 자체를 만들지 않지만, 혹시 남아 있더라도 여기서 `hostType` 을 먼저 보고
 * 무시한다 — 데이터가 새더라도 권한이 새지 않게 이중으로 막는 것.
 *
 * ## 주관 갤러리(`galleryId`)는 그대로 남는다
 * 목록 카드의 갤러리명, 지원 통계(`galleryApplicationStats`), 정산, SEO 등 기존 코드 전부가
 * `exhibition.gallery` 를 전제로 한다. 그래서 admin 주최 공모도 **주관 갤러리 1곳을 반드시 지정**하고,
 * 그 갤러리는 운영 갤러리 목록에도 함께 들어간다. 화면에서는 `hostType` 을 보고 "아트링크 주최"로 표기한다.
 *
 * ## 쓰는 법
 *   단건 판정  : `const ex = await assertCanManageExhibition(id, req.user!)`  (Admin 포함)
 *   목록 조회  : `where: operableExhibitionWhere(userId)`
 *   이미 읽은 객체: `canOperateExhibition(ex, userId)` (OPERATOR_INCLUDE 로 읽었어야 함)
 */
import prisma from './prisma';
import { AppError } from '../middleware/errorHandler';

/** 권한 판정에 필요한 최소 필드 — findUnique/findMany 의 include 에 그대로 넣는다 */
export const OPERATOR_INCLUDE = {
  gallery: { select: { ownerId: true } },
  managers: { select: { galleryId: true, gallery: { select: { ownerId: true } } } },
} as const;

export interface OperatorShape {
  hostType?: string | null;
  gallery?: { ownerId: number } | null;
  managers?: { gallery?: { ownerId: number } | null }[] | null;
}

/** 이 유저가 공모를 운영할 수 있는가 (주관 갤러리 오너 또는 위임받은 운영 갤러리 오너) */
export function canOperateExhibition(ex: OperatorShape | null | undefined, userId: number): boolean {
  if (!ex) return false;
  if (ex.gallery?.ownerId === userId) return true;
  // 위임은 아트링크 주최 공모에서만 인정한다
  if (ex.hostType !== 'ADMIN') return false;
  return (ex.managers ?? []).some((m) => m?.gallery?.ownerId === userId);
}

/**
 * 이 공모를 운영하는 유저 id 전부 (알림 발송 대상).
 * 갤러리 주최면 오너 1명, 아트링크 주최면 주관 + 위임 갤러리 오너 전부.
 */
export function operatorUserIds(ex: OperatorShape | null | undefined): number[] {
  const ids = new Set<number>();
  if (!ex) return [];
  if (ex.gallery?.ownerId) ids.add(ex.gallery.ownerId);
  if (ex.hostType === 'ADMIN') {
    for (const m of ex.managers ?? []) if (m?.gallery?.ownerId) ids.add(m.gallery.ownerId);
  }
  return [...ids];
}

/**
 * "이 유저가 운영하는 공모" Prisma where 절.
 * 갤러리를 따로 조회할 필요 없이 관계로 바로 건다.
 */
export function operableExhibitionWhere(ownerId: number) {
  return {
    OR: [
      { gallery: { ownerId } },
      { hostType: 'ADMIN', managers: { some: { gallery: { ownerId } } } },
    ],
  };
}

/**
 * 운영 갤러리 **또는 Admin**. 관리자는 승인·삭제·운영 페이지를 이미 전부 볼 수 있으므로
 * 지원자 관리·초대·홍보사진도 같은 기준으로 연다(`operation.ts` 의 isAdmin 취급과 맞춘 것).
 *
 * ⚠️ `canOperateExhibition`(순수 함수) 자체에 Admin을 넣지 않는 이유: `operation.ts` 는 `isOwner` 와 `isAdmin` 을
 * 나눠서 쓴다(정산 완료 후 수정은 Admin만 허용하는 식). 섞으면 그 구분이 무너진다.
 */
export async function assertCanManageExhibition<T extends Record<string, unknown> = {}>(
  exhibitionId: number,
  user: { id: number; role: string },
  extraInclude?: T
) {
  const exhibition = await prisma.exhibition.findUnique({
    where: { id: exhibitionId },
    include: { ...OPERATOR_INCLUDE, ...(extraInclude ?? {}) } as any,
  });
  if (!exhibition) throw new AppError('공모를 찾을 수 없습니다.', 404);
  if (user.role !== 'ADMIN' && !canOperateExhibition(exhibition as OperatorShape, user.id)) {
    throw new AppError('권한이 없습니다.', 403);
  }
  return exhibition as any;
}
