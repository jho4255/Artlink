/**
 * 삭제 요청 — 데이터 쪽 (2026-10-03, 화면 부품은 `components/shared/DeleteRequest.tsx`).
 * 함수·훅을 화면 파일과 나눠 둔다 — 한 파일에서 컴포넌트와 함께 내보내면 개발 중 핫리로드가 입력 중이던 사유를 날린다(`lib/flowLabels.ts` 와 같은 이유).
 *
 *  - `checkDeletable(kind, id)` — 서버에 먼저 묻는다(`GET /exhibitions|galleries/:id/delete-check`). 규칙은 서버 `lib/deletion.ts` 한 곳이라
 *    화면이 숫자를 보고 따로 판단하지 않는다(둘이 다른 답을 내면 "지울 수 있다고 해 놓고 400").
 *  - `useMyDeleteRequests()` — 내 삭제 요청(대기 중 + 최근 반려)을 `(kind, id) → 요청` 으로 찾는다. 갤러리 계정에서만 부른다.
 */
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/axios';
import { useAuthStore } from '@/stores/authStore';

export type DeleteKind = 'exhibition' | 'gallery';

/** 직접 지울 수 없는 이유(없으면 null). 실패하면 던진다 — 부르는 쪽이 토스트로 알린다 */
export async function checkDeletable(kind: DeleteKind, id: number): Promise<string | null> {
  const { data } = await api.get(`/${kind === 'exhibition' ? 'exhibitions' : 'galleries'}/${id}/delete-check`);
  return data?.blocked ?? null;
}

export interface MyDeleteRequest {
  id: number;
  type: 'EXHIBITION_DELETE' | 'GALLERY_DELETE';
  targetId: number;
  status: 'PENDING' | 'REJECTED';
  rejectReason: string | null;
  reason: string;
}

/** 내 삭제 요청 — `(kind, id)` → 요청(최신). 갤러리 계정에서만 받는다 */
export function useMyDeleteRequests() {
  const role = useAuthStore((s) => s.user?.role);
  const { data = [] } = useQuery<MyDeleteRequest[]>({
    queryKey: ['my-delete-requests'],
    queryFn: () => api.get('/approvals/my-delete-requests').then((r) => r.data),
    enabled: role === 'GALLERY',
    staleTime: 30_000,
  });
  const byTarget = new Map<string, MyDeleteRequest>();
  for (const r of data) {
    const key = `${r.type === 'EXHIBITION_DELETE' ? 'exhibition' : 'gallery'}:${r.targetId}`;
    if (!byTarget.has(key)) byTarget.set(key, r);   // 최신이 앞에 온다
  }
  return (kind: DeleteKind, id: number) => byTarget.get(`${kind}:${id}`) ?? null;
}
