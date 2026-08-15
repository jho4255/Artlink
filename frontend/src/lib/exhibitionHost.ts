/**
 * 공모 주최자 규칙 (화면용 순수 함수).
 *
 * 아트링크(Admin)가 주최하는 공모는 `hostType === 'ADMIN'` 이고, 실제 운영은 admin 이 지정한
 * 갤러리들(`managerGalleries`)이 맡는다. 화면에서 헷갈리기 쉬운 두 가지를 여기서 못 박는다.
 *
 *  1. **목록 카드의 갤러리명은 '주관' 갤러리일 뿐이다** — 배지가 없으면 그 갤러리가 주최한 것으로 오해한다.
 *  2. **운영 위임 ≠ 소유** — 위임받은 갤러리는 운영은 하지만 공모를 지울 수는 없다(서버도 403).
 *
 * 운영 권한 자체는 서버가 계산해 `canOperate` 로 내려준다. 프론트에서 오너 비교를 다시 구현하면
 * 규칙이 두 벌이 되어 어긋난다 — 여기서는 그 값을 쓰기만 한다(`canOperate` 미제공 시 오너 비교로 폴백).
 */
export interface HostLike {
  hostType?: 'GALLERY' | 'ADMIN' | string;
  managerGalleries?: { id: number; name: string }[];
  canOperate?: boolean;
  // 목록 API와 상세 API의 gallery 모양이 달라(ownerId는 상세에만 있다) 나머지 필드는 열어둔다
  gallery?: ({ ownerId?: number } & Record<string, unknown>) | null;
}

interface UserLike {
  id: number;
  role: string;
}

export function isAdminHosted(ex: HostLike | null | undefined): boolean {
  return ex?.hostType === 'ADMIN';
}

/** 이 계정이 공모를 운영할 수 있는가 (상세 API의 canOperate 우선, 없으면 오너 비교) */
export function canOperate(ex: HostLike | null | undefined, user: UserLike | null | undefined): boolean {
  if (!ex || !user || user.role !== 'GALLERY') return false;
  if (typeof ex.canOperate === 'boolean') return ex.canOperate;
  return !!ex.gallery?.ownerId && ex.gallery.ownerId === user.id;
}

/**
 * 공모 내용(소개·사진·공지 등)을 고칠 수 있는가 — **운영 갤러리 또는 Admin**.
 *
 * `canOperate` 는 갤러리 계정만 인정한다(운영 위임을 판정하는 함수라서).
 * 화면의 편집 버튼은 그걸로 판단하면 안 된다 — Admin 이 자기가 주최한 공고의
 * 소개·포스터를 못 고치게 된다(서버는 허용하는데 버튼만 없는 상태였다).
 * 백엔드 `assertCanManageExhibition` 과 짝을 이룬다.
 */
export function canManage(ex: HostLike | null | undefined, user: UserLike | null | undefined): boolean {
  if (!user) return false;
  if (user.role === 'ADMIN') return true;
  return canOperate(ex, user);
}

/** 삭제 가능한가 — 아트링크 주최 공모는 주최자(Admin)만. 갤러리는 운영만 위임받았다. */
export function canDelete(ex: HostLike | null | undefined, user: UserLike | null | undefined): boolean {
  if (!ex || !user) return false;
  if (user.role === 'ADMIN') return true;
  return canOperate(ex, user) && !isAdminHosted(ex);
}
