import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { X, Plus, Trash2, ArrowUp, ArrowDown, Eye, EyeOff, Loader2, ChevronDown, Search, UserMinus } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import { roleLabel, apiErrorMessage } from '@/lib/utils';
import { useEscapeKey } from '@/hooks/useEscapeKey';

/**
 * 커뮤니티 **탭 관리** — Admin 전용.
 *
 * ⚠️ 탭을 지워도 **글은 안 지운다** — `categoryId` 가 null 이 되어 '미분류'로 내려온다.
 *    그래서 삭제 확인에 "글 N개가 미분류로 이동" 을 반드시 보여 준다. 안 보여 주면
 *    관리자는 글까지 지워지는 줄 알고 못 지우거나, 반대로 글이 사라진 줄 알고 놀란다.
 * ⚠️ **끄기(비활성)를 먼저 권한다.** 탭만 감추고 글은 그 탭에 그대로 있어서 되돌릴 수 있다.
 *    삭제는 되돌릴 수 없다(어느 글이 어느 탭이었는지 복구 못 한다).
 *
 * 2026-11-13 — 탭마다 **누가 쓰나**(누구나 / 필진 / 관리자) · **목록 모양**(목록 / 카드) · **익명 허용** · **한 줄 소개**,
 * 그리고 **필진**(필진 탭에 쓸 수 있는 회원) 관리. 칼럼은 '필진 + 카드 + 실명' 탭으로 만든다.
 */
export interface CommunityTab {
  id: number; name: string; slug: string; order: number; active: boolean;
  /** 옛 칸 — `writePolicy === 'admin'` 과 같다(배포 중 옛 화면) */
  writeAdminOnly: boolean;
  writePolicy?: 'all' | 'writers' | 'admin';
  layout?: 'list' | 'card';
  allowAnonymous?: boolean;
  description?: string | null;
  /** 지금 보는 사람이 이 탭에 쓸 수 있나(서버가 판정) */
  canWrite?: boolean;
  postCount: number;
}

const POLICY_LABEL: Record<string, string> = { all: '누구나', writers: '필진만', admin: '관리자만' };

export default function TabManager({ tabs, onClose }: { tabs: CommunityTab[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [confirmDel, setConfirmDel] = useState<CommunityTab | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [view, setView] = useState<'tabs' | 'writers'>('tabs');
  useEscapeKey(onClose);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['community-tabs'] });
    qc.invalidateQueries({ queryKey: ['community'] });
  };
  const fail = (e: unknown, msg: string) => toast.error(apiErrorMessage(e, msg));

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

  // 순서 바꾸기 — 이웃과 order 를 맞바꾼다. 값이 같으면(옛 데이터) 한쪽을 밀어 서로 달라지게 한다.
  const move = (i: number, dir: -1 | 1) => {
    const a = tabs[i], b = tabs[i + dir];
    if (!a || !b) return;
    const [na, nb] = b.order === a.order ? [a.order + dir, a.order] : [b.order, a.order];
    patch.mutate({ id: a.id, order: na });
    patch.mutate({ id: b.id, order: nb });
  };

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label="탭 관리" className="max-h-[90vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 sm:max-w-lg sm:rounded-xl">
        <div className="mb-4 flex items-center justify-between">
          <div role="tablist" className="flex gap-5">
            <button type="button" role="tab" aria-selected={view === 'tabs'} onClick={() => setView('tabs')}
              className={`h-9 text-[15px] ${view === 'tabs' ? 'font-semibold text-gray-900 underline decoration-1 underline-offset-[7px]' : 'text-gray-500'}`}>탭 관리</button>
            <button type="button" role="tab" aria-selected={view === 'writers'} onClick={() => setView('writers')}
              className={`h-9 text-[15px] ${view === 'writers' ? 'font-semibold text-gray-900 underline decoration-1 underline-offset-[7px]' : 'text-gray-500'}`}>필진</button>
          </div>
          <button type="button" onClick={onClose} aria-label="닫기" className="inline-flex h-10 w-10 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100"><X size={18} /></button>
        </div>

        {view === 'writers' ? <WritersPanel /> : (
          <>
            <form
              onSubmit={(e) => { e.preventDefault(); if (name.trim() && !create.isPending) create.mutate(); }}
              className="mb-4 flex gap-2"
            >
              <input
                value={name} onChange={(e) => setName(e.target.value)} maxLength={20}
                placeholder="새 탭 이름 (예: 자유, 질문, 전시 준비)"
                aria-label="새 탭 이름"
                className="h-11 min-w-0 flex-1 rounded-lg border border-gray-300 px-3 text-sm focus:border-gray-500 focus:outline-none"
              />
              <button
                type="submit" disabled={!name.trim() || create.isPending}
                className="inline-flex h-11 shrink-0 items-center gap-1 rounded-lg bg-gray-900 px-4 text-sm font-medium text-white disabled:opacity-40"
              >
                {create.isPending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} 추가
              </button>
            </form>

            {tabs.length === 0 ? (
              <p className="py-8 text-center text-sm text-gray-500">아직 탭이 없습니다. 위에서 만들어 보세요.</p>
            ) : (
              <ul className="divide-y divide-gray-100 border-y border-gray-100">
                {tabs.map((t, i) => {
                  const policy = t.writePolicy ?? (t.writeAdminOnly ? 'admin' : 'all');
                  const open = openId === t.id;
                  return (
                    <li key={t.id} className="py-2">
                      <div className="flex items-center gap-1.5">
                        <div className="flex flex-col">
                          <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`${t.name} 위로`}
                            className="p-0.5 text-gray-400 hover:text-gray-800 disabled:opacity-20"><ArrowUp size={13} /></button>
                          <button type="button" onClick={() => move(i, 1)} disabled={i === tabs.length - 1} aria-label={`${t.name} 아래로`}
                            className="p-0.5 text-gray-400 hover:text-gray-800 disabled:opacity-20"><ArrowDown size={13} /></button>
                        </div>
                        <TabNameInput key={`${t.id}:${t.name}`} tab={t} onCommit={(v) => patch.mutateAsync({ id: t.id, name: v })} />
                        <span className="shrink-0 text-[12px] text-gray-500">{POLICY_LABEL[policy]}{t.layout === 'card' ? ' · 카드' : ''}</span>
                        <span className="w-6 shrink-0 text-right text-xs tabular-nums text-gray-400" title="글 수">{t.postCount}</span>
                        <button type="button" onClick={() => patch.mutate({ id: t.id, active: !t.active })}
                          title={t.active ? '탭 숨기기 (글은 그대로)' : '탭 다시 보이기'} aria-label={t.active ? `${t.name} 숨기기` : `${t.name} 다시 보이기`}
                          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-800">
                          {t.active ? <Eye size={15} /> : <EyeOff size={15} />}
                        </button>
                        <button type="button" onClick={() => setOpenId(open ? null : t.id)} aria-expanded={open} aria-label={`${t.name} 설정`}
                          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100">
                          <ChevronDown size={16} className={open ? 'rotate-180' : ''} />
                        </button>
                      </div>
                      {open && <TabSettings key={`${t.id}:${t.description ?? ''}`} tab={t} onPatch={(body) => patch.mutate({ id: t.id, ...body })} onDelete={() => setConfirmDel(t)} />}
                    </li>
                  );
                })}
              </ul>
            )}

            <p className="mt-3 text-[12px] leading-relaxed text-gray-500">
              이름을 고쳐도 기존 링크는 살아 있습니다. 탭을 <b className="text-gray-700">숨기면</b> 글은 그 탭에 그대로 남고,
              <b className="text-gray-700"> 지우면</b> 글이 ‘미분류’로 내려옵니다(글 자체는 안 지워집니다).
              칼럼 탭은 <b className="text-gray-700">필진만 · 카드 · 익명 끔</b>으로 만들고 [필진]에서 쓸 사람을 정하세요.
            </p>

            {confirmDel && (
              <div className="mt-4 border border-accent/30 p-3">
                <p className="text-sm text-gray-800">
                  <b>{confirmDel.name}</b> 탭을 지울까요?
                  {confirmDel.postCount > 0 && <> 글 <b>{confirmDel.postCount}개</b>가 ‘미분류’로 옮겨집니다.</>}
                </p>
                <div className="mt-2 flex gap-2">
                  <button type="button" onClick={() => remove.mutate(confirmDel.id)} disabled={remove.isPending}
                    className="h-9 rounded-lg bg-accent px-3 text-xs font-medium text-white disabled:opacity-50">지우기</button>
                  <button type="button" onClick={() => setConfirmDel(null)} className="h-9 rounded-lg border border-gray-300 px-3 text-xs text-gray-600">취소</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

function Choice<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="w-20 shrink-0 text-[13px] text-gray-500">{label}</span>
      <div role="radiogroup" aria-label={label} className="flex gap-0.5 rounded-lg border border-gray-200 p-0.5">
        {options.map(([v, n]) => (
          <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)}
            className={`h-8 rounded-md px-3 text-[13px] font-medium ${value === v ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>{n}</button>
        ))}
      </div>
    </div>
  );
}

function TabSettings({ tab, onPatch, onDelete }: { tab: CommunityTab; onPatch: (b: Partial<CommunityTab>) => void; onDelete: () => void }) {
  // 서버 값이 바뀌면 부모가 key 로 이 칸을 새로 만든다(effect 로 덮어쓰지 않는다)
  const [desc, setDesc] = useState(tab.description ?? '');
  const policy = (tab.writePolicy ?? (tab.writeAdminOnly ? 'admin' : 'all')) as 'all' | 'writers' | 'admin';
  return (
    <div className="mb-1 mt-2 space-y-2.5 bg-gray-50 p-3">
      <Choice label="누가 쓰나" value={policy} options={[['all', '누구나'], ['writers', '필진만'], ['admin', '관리자만']]} onChange={(v) => onPatch({ writePolicy: v })} />
      <Choice label="목록 모양" value={tab.layout === 'card' ? 'card' : 'list'} options={[['list', '목록'], ['card', '카드']]} onChange={(v) => onPatch({ layout: v })} />
      <Choice label="익명 글" value={tab.allowAnonymous === false ? 'off' : 'on'} options={[['on', '허용'], ['off', '실명만']]} onChange={(v) => onPatch({ allowAnonymous: v === 'on' })} />
      <label className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="w-20 shrink-0 text-[13px] text-gray-500">한 줄 소개</span>
        <input
          value={desc} maxLength={120} onChange={(e) => setDesc(e.target.value)}
          onBlur={() => { if ((tab.description ?? '') !== desc.trim()) onPatch({ description: desc.trim() || null }); }}
          placeholder="탭 머리에 보이는 소개(선택)"
          className="h-9 min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-2.5 text-[13px] focus:border-gray-500 focus:outline-none"
        />
      </label>
      <div className="flex justify-end">
        <button type="button" onClick={onDelete} className="inline-flex h-8 items-center gap-1 text-[13px] text-gray-500 hover:text-accent"><Trash2 size={13} />탭 지우기</button>
      </div>
    </div>
  );
}

interface Writer { userId: number; name: string; realName: string; email: string; role: string; withdrawn: boolean; postCount: number }
interface UserHit { id: number; name: string; email: string; role: string }

/** 필진 — 필진 탭에 쓸 수 있는 회원(역할 무관). 넣으면 그 사람에게 알림이 간다 */
function WritersPanel() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const { data: writers, isLoading } = useQuery<Writer[]>({
    queryKey: ['community-writers'],
    queryFn: () => api.get('/community/writers').then((r) => r.data),
  });
  const { data: hits, isFetching } = useQuery<UserHit[]>({
    queryKey: ['admin-users-search', query],
    queryFn: () => api.get('/admin/users', { params: { q: query } }).then((r) => r.data.slice(0, 8)),
    enabled: query.length >= 1,
  });
  const add = useMutation({
    mutationFn: (userId: number) => api.put(`/community/writers/${userId}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['community-writers'] }); qc.invalidateQueries({ queryKey: ['community-tabs'] }); toast.success('필진으로 넣었어요. 그분께 알림이 갔어요.'); },
    onError: (e) => toast.error(apiErrorMessage(e, '넣지 못했어요.')),
  });
  const del = useMutation({
    mutationFn: (userId: number) => api.delete(`/community/writers/${userId}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['community-writers'] }); qc.invalidateQueries({ queryKey: ['community-tabs'] }); },
    onError: () => toast.error('빼지 못했어요.'),
  });
  const ids = new Set((writers ?? []).map((w) => w.userId));
  return (
    <div>
      <form onSubmit={(e) => { e.preventDefault(); setQuery(q.trim()); }} className="flex gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="이름·이메일로 회원 찾기" aria-label="회원 찾기"
          className="h-11 min-w-0 flex-1 rounded-lg border border-gray-300 px-3 text-sm focus:border-gray-500 focus:outline-none" />
        <button type="submit" className="inline-flex h-11 shrink-0 items-center gap-1 rounded-lg border border-gray-300 px-4 text-sm font-medium text-gray-700">
          {isFetching ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}찾기
        </button>
      </form>
      {query && (
        <ul className="mt-2 divide-y divide-gray-100 border border-gray-100">
          {(hits ?? []).length === 0 && !isFetching && <li className="px-3 py-3 text-[13px] text-gray-500">찾는 회원이 없어요.</li>}
          {(hits ?? []).map((u) => (
            <li key={u.id} className="flex items-center gap-3 px-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] text-gray-900">{u.name} <span className="text-[12px] text-gray-500">{roleLabel(u.role)}</span></span>
                <span className="block truncate text-[12px] text-gray-500">{u.email}</span>
              </span>
              {ids.has(u.id)
                ? <span className="text-[12px] text-gray-500">필진</span>
                : <button type="button" onClick={() => add.mutate(u.id)} className="h-9 shrink-0 rounded-lg bg-gray-900 px-3 text-[13px] font-medium text-white">필진으로</button>}
            </li>
          ))}
        </ul>
      )}
      <h3 className="mt-6 text-[14px] font-semibold text-gray-900">필진 {writers?.length ?? 0}명</h3>
      {isLoading ? <p className="py-6 text-center text-sm text-gray-500">불러오는 중…</p> : (writers ?? []).length === 0 ? (
        <p className="py-6 text-center text-[13px] text-gray-500">아직 필진이 없어요. 위에서 회원을 찾아 넣으세요.</p>
      ) : (
        <ul className="mt-2 divide-y divide-gray-100 border-y border-gray-100">
          {(writers ?? []).map((w) => (
            <li key={w.userId} className="flex items-center gap-3 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] text-gray-900">{w.name}{w.withdrawn && <span className="ml-1 text-[12px] text-accent">탈퇴</span>} <span className="text-[12px] text-gray-500">{roleLabel(w.role)}</span></span>
                <span className="block truncate text-[12px] text-gray-500">{w.email} · 필진 글 {w.postCount}편</span>
              </span>
              <button type="button" onClick={() => { if (window.confirm(`${w.name}님을 필진에서 뺄까요? 이미 쓴 글은 그대로 남아요.`)) del.mutate(w.userId); }}
                aria-label={`${w.name} 필진에서 빼기`} className="inline-flex h-9 shrink-0 items-center gap-1 rounded-lg px-2.5 text-[13px] text-gray-500 hover:text-accent">
                <UserMinus size={14} />빼기
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-[12px] leading-relaxed text-gray-500">필진은 ‘필진만’ 탭에 글을 쓸 수 있어요. 필진이 실명으로 올린 글은 그 사람을 이웃 추가한 회원에게 알림이 가요.</p>
    </div>
  );
}

/**
 * 탭 이름 칸 — 예전엔 uncontrolled(`defaultValue`)라 저장에 실패해도(같은 이름 409 등) 화면엔 새 이름이 그대로 남아
 * 바뀐 줄 알았다(감사 S25). 서버 값을 진실로 두고, 실패하면 되돌린다.
 */
function TabNameInput({ tab, onCommit }: { tab: CommunityTab; onCommit: (name: string) => Promise<unknown> }) {
  // 서버 이름이 바뀌면 부모가 key 로 이 칸을 새로 만든다 — effect 로 덮어쓰면 렌더가 두 번 돈다
  const [value, setValue] = useState(tab.name);
  const commit = async () => {
    const v = value.trim();
    if (!v || v === tab.name) { setValue(tab.name); return; }
    try { await onCommit(v); } catch { setValue(tab.name); }
  };
  return (
    <input
      value={value} maxLength={20}
      aria-label={`탭 이름 ${tab.name}`}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) (e.target as HTMLInputElement).blur(); }}
      className={`h-9 min-w-0 flex-1 rounded border border-transparent px-2 text-sm hover:border-gray-200 focus:border-gray-400 focus:outline-none ${tab.active ? 'text-gray-900' : 'text-gray-400 line-through'}`}
    />
  );
}
