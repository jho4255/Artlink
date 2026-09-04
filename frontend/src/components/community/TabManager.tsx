import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X, Plus, Trash2, ArrowUp, ArrowDown, Eye, EyeOff, Lock, LockOpen, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/axios';

/**
 * 커뮤니티 **탭 관리** — Admin 전용.
 *
 * ⚠️ 탭을 지워도 **글은 안 지운다** — `categoryId` 가 null 이 되어 '미분류'로 내려온다.
 *    그래서 삭제 확인에 "글 N개가 미분류로 이동" 을 반드시 보여 준다. 안 보여 주면
 *    관리자는 글까지 지워지는 줄 알고 못 지우거나, 반대로 글이 사라진 줄 알고 놀란다.
 * ⚠️ **끄기(비활성)를 먼저 권한다.** 탭만 감추고 글은 그 탭에 그대로 있어서 되돌릴 수 있다.
 *    삭제는 되돌릴 수 없다(어느 글이 어느 탭이었는지 복구 못 한다).
 */
export interface CommunityTab {
  id: number; name: string; slug: string; order: number; active: boolean;
  /** 켜면 **Admin 만** 이 탭에 글을 쓸 수 있다(공지 탭 등). 읽기는 그대로 공개 */
  writeAdminOnly: boolean;
  postCount: number;
}

export default function TabManager({ tabs, onClose }: { tabs: CommunityTab[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [confirmDel, setConfirmDel] = useState<CommunityTab | null>(null);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['community-tabs'] });
    qc.invalidateQueries({ queryKey: ['community'] });
  };
  const fail = (e: any, msg: string) => toast.error(e?.response?.data?.error || msg);

  const create = useMutation({
    mutationFn: () => api.post('/community/categories', { name: name.trim() }),
    onSuccess: () => { setName(''); refresh(); toast.success('탭을 만들었습니다.'); },
    onError: (e) => fail(e, '탭 생성 실패'),
  });
  const patch = useMutation({
    mutationFn: ({ id, ...body }: { id: number } & Partial<CommunityTab>) => api.patch(`/community/categories/${id}`, body),
    onSuccess: refresh,
    onError: (e) => fail(e, '수정 실패'),
  });
  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`/community/categories/${id}`),
    onSuccess: (r) => {
      const moved = r.data?.movedToUncategorized ?? 0;
      refresh(); setConfirmDel(null);
      toast.success(moved > 0 ? `탭을 지웠습니다. 글 ${moved}개는 미분류로 옮겼습니다.` : '탭을 지웠습니다.');
    },
    onError: (e) => fail(e, '삭제 실패'),
  });

  // 순서 바꾸기 — 이웃과 order 를 맞바꾼다. order 가 같으면 id 순이라 한 번에 안 움직일 수 있어
  // 항상 서로 다른 값으로 재배치한다.
  const move = (i: number, dir: -1 | 1) => {
    const a = tabs[i], b = tabs[i + dir];
    if (!a || !b) return;
    // 두 탭의 순서를 맞바꾼다. 값이 같으면(옛 데이터) 한쪽을 밀어 서로 달라지게 한다.
    // ⚠️ 두 번째 삼항은 양쪽 가지가 같은 값이라 죽은 코드였다 — b 는 늘 a 자리로 간다.
    const [na, nb] = b.order === a.order ? [a.order + dir, a.order] : [b.order, a.order];
    patch.mutate({ id: a.id, order: na });
    patch.mutate({ id: b.id, order: nb });
  };

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">탭 관리</h2>
          <button onClick={onClose} aria-label="닫기" className="p-1 text-gray-400 hover:text-gray-700"><X size={18} /></button>
        </div>

        <form
          onSubmit={(e) => { e.preventDefault(); if (name.trim() && !create.isPending) create.mutate(); }}
          className="mb-4 flex gap-2"
        >
          <input
            value={name} onChange={(e) => setName(e.target.value)} maxLength={20}
            placeholder="새 탭 이름 (예: 공지, 자유, 작가 모집)"
            className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-500 focus:outline-none"
          />
          <button
            type="submit" disabled={!name.trim() || create.isPending}
            className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            {create.isPending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} 추가
          </button>
        </form>

        {tabs.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-400">아직 탭이 없습니다. 위에서 만들어 보세요.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {tabs.map((t, i) => (
              <li key={t.id} className="flex items-center gap-2 py-2.5">
                <div className="flex flex-col">
                  <button onClick={() => move(i, -1)} disabled={i === 0} aria-label="위로"
                    className="p-0.5 text-gray-300 hover:text-gray-700 disabled:opacity-20"><ArrowUp size={13} /></button>
                  <button onClick={() => move(i, 1)} disabled={i === tabs.length - 1} aria-label="아래로"
                    className="p-0.5 text-gray-300 hover:text-gray-700 disabled:opacity-20"><ArrowDown size={13} /></button>
                </div>
                <input
                  defaultValue={t.name} maxLength={20}
                  onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== t.name) patch.mutate({ id: t.id, name: v }); }}
                  className={`min-w-0 flex-1 rounded border border-transparent px-2 py-1 text-sm hover:border-gray-200 focus:border-gray-400 focus:outline-none ${t.active ? 'text-gray-900' : 'text-gray-400 line-through'}`}
                />
                <span className="shrink-0 text-xs tabular-nums text-gray-400">{t.postCount}</span>
                <button
                  onClick={() => patch.mutate({ id: t.id, writeAdminOnly: !t.writeAdminOnly })}
                  title={t.writeAdminOnly ? '관리자만 쓰기 — 눌러서 누구나 쓰기로' : '누구나 쓰기 — 눌러서 관리자만 쓰기로'}
                  className={`shrink-0 p-1 ${t.writeAdminOnly ? 'text-[#c4302b]' : 'text-gray-300 hover:text-gray-700'}`}
                >
                  {t.writeAdminOnly ? <Lock size={14} /> : <LockOpen size={14} />}
                </button>
                <button
                  onClick={() => patch.mutate({ id: t.id, active: !t.active })}
                  title={t.active ? '탭 숨기기 (글은 그대로)' : '탭 다시 보이기'}
                  className="shrink-0 p-1 text-gray-300 hover:text-gray-700"
                >
                  {t.active ? <Eye size={14} /> : <EyeOff size={14} />}
                </button>
                <button onClick={() => setConfirmDel(t)} title="탭 삭제" className="shrink-0 p-1 text-gray-300 hover:text-[#c4302b]">
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}

        <p className="mt-3 text-[11px] leading-relaxed text-gray-400">
          <Lock size={11} className="inline align-[-1px]" /> 를 켜면 <b className="text-gray-500">관리자만</b> 그 탭에 글을 쓸 수 있습니다(읽기는 누구나).
          이름을 고쳐도 기존 링크는 살아 있습니다. 탭을 <b className="text-gray-500">숨기면</b> 글은 그 탭에 그대로 남고,
          <b className="text-gray-500"> 지우면</b> 글이 ‘미분류’로 내려옵니다(글 자체는 안 지워집니다).
        </p>

        {confirmDel && (
          <div className="mt-4 rounded-xl border border-[#c4302b]/30 bg-[#c4302b]/5 p-3">
            <p className="text-sm text-gray-800">
              <b>{confirmDel.name}</b> 탭을 지울까요?
              {confirmDel.postCount > 0 && <> 글 <b>{confirmDel.postCount}개</b>가 ‘미분류’로 옮겨집니다.</>}
            </p>
            <div className="mt-2 flex gap-2">
              <button onClick={() => remove.mutate(confirmDel.id)} disabled={remove.isPending}
                className="rounded-lg bg-[#c4302b] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">지우기</button>
              <button onClick={() => setConfirmDel(null)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-600">취소</button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
