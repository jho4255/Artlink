/**
 * 마이페이지(관리자) > 승인 관리 — 2026-11-21 개편(CLAUDE.md 규칙 89).
 *
 * 예전: 카드가 세로로 늘어서고 포스터를 높이 128px 가로 띠로 잘라 보였다 · 수정 요청은 영문 키와 JSON 그대로 ·
 * 지난 결정 기록이 없었다 · 초록 [승인] 버튼 · '등록 관리'(승인된 갤러리·공모·전시 삭제 목록)가 한 탭에 섞여 있었다.
 *
 * 지금: [기다리는 요청 N · 처리한 요청] 탭.
 *   넓은 화면 — 왼쪽 목록(오래 기다린 순, 종류로 거른다) | 오른쪽 한 건 + 아래 결정 줄 [거절 | 승인].
 *   좁은 화면 — 목록 → 한 건 창(화면을 덮는다, Esc · 앱 뒤로가기로 닫힌다).
 *   결정하면 **다음 요청으로** 넘어간다(없으면 닫힌다). 거절은 자주 쓰는 사유를 골라 채우고 고쳐 쓴다.
 *   수정 요청은 '지금 → 바꾸려는 값'을 한글 항목 이름으로. 삭제 요청은 무엇이 사라지는지 + 확인창.
 * '등록 관리'(삭제)는 [운영 조회]의 한 건 칸으로 옮겼다.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import { cn, regionLabels, exhibitionTypeLabels, capacityText, getDday } from '@/lib/utils';
import { scheduleSteps } from '@/lib/listings';
import { normalizeAttachments } from '@/lib/attachments';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { ADMIN_TODO_KEY } from '@/hooks/useAdminTodo';
import PageTabBar from '@/components/shared/PageTabBar';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import RichText from '@/components/shared/RichText';
import StatusChip from '@/components/flow/StatusChip';
import { AttachmentList } from '@/components/shared/ExhibitionAttachments';
import { ScheduleStrip } from '@/components/exhibition/DetailBits';
import { AdminHead, ChoiceLinks, DetailPane, Dot, EmptyLine } from '@/components/admin/AdminUi';
import { agoText, daysWaited, seenText, shortDate } from '@/lib/adminFormat';

type Kind = 'exhibition' | 'gallery' | 'show' | 'edit-request' | 'delete-request';
type KindFilter = 'all' | 'exhibition' | 'gallery' | 'show' | 'edit' | 'delete';

interface Item { kind: Kind; key: string; id: number; createdAt: string; raw: any }

const KIND_LABEL: Record<Kind, string> = {
  exhibition: '공모 등록', gallery: '갤러리 등록', show: '전시 등록', 'edit-request': '수정 요청', 'delete-request': '삭제 요청',
};

/** 수정 요청 항목의 한글 이름 — 서버 화이트리스트(routes/approval.ts)와 같은 칸 */
const FIELD_LABEL: Record<string, string> = {
  title: '공모 제목', name: '갤러리 이름', type: '유형', deadline: '접수 마감', deadlineStart: '접수 시작', exhibitDate: '전시 종료',
  exhibitStartDate: '전시 시작', capacity: '모집 인원', capacityMask: '모집 인원 표시', region: '지역', description: '소개',
  imageUrl: '포스터', mainImage: '대표 사진', customFields: '추가 질문', address: '주소', phone: '전화', detailDesc: '자세한 소개',
  ownerName: '대표자', instagramUrl: '인스타그램', email: '이메일',
};
const DATE_FIELDS = new Set(['deadline', 'deadlineStart', 'exhibitDate', 'exhibitStartDate']);
const IMAGE_FIELDS = new Set(['imageUrl', 'mainImage']);
const RICH_FIELDS = new Set(['description', 'detailDesc']);

/** 자주 쓰는 거절 사유 — 고르면 글 칸이 채워지고 고쳐 쓴다 */
const REJECT_PRESETS: Record<Kind, string[]> = {
  exhibition: ['일정이 맞지 않아요', '포스터를 다시 올려 주세요', '공모 내용이 부족해요', '같은 공모가 이미 있어요'],
  show: ['일정이 맞지 않아요', '포스터를 다시 올려 주세요', '전시 내용이 부족해요'],
  gallery: ['갤러리 정보를 확인할 수 없어요', '대표 사진을 다시 올려 주세요', '주소·연락처를 확인해 주세요'],
  'edit-request': ['이미 지원자가 있어 바꾸기 어려워요', '바꾸려는 내용을 확인할 수 없어요'],
  'delete-request': ['참여 작가와 먼저 이야기해 주세요', '정산을 마친 뒤 다시 요청해 주세요'],
};

function parseJson<T>(raw: unknown, fallback: T): T {
  if (raw == null) return fallback;
  if (typeof raw === 'object') return raw as T;
  try { return JSON.parse(String(raw)) as T; } catch { return fallback; }
}

function valueText(key: string, v: unknown): string {
  if (v == null || v === '') return '없음';
  if (DATE_FIELDS.has(key)) return shortDate(String(v));
  if (key === 'region') return regionLabels[String(v)] ?? String(v);
  if (key === 'type') return exhibitionTypeLabels[String(v)] ?? String(v);
  if (key === 'capacity') return `${v}명`;
  if (key === 'capacityMask') return v === 'ONE' ? '0명' : v === 'TWO' ? '00명' : '숫자';
  if (key === 'customFields') return `${parseJson<unknown[]>(v, []).length}개`;
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** 서버 응답 → 한 줄로 */
function toItems(data: any): Item[] {
  if (!data) return [];
  const out: Item[] = [
    ...(data.pendingExhibitions ?? []).map((r: any) => ({ kind: 'exhibition' as const, key: `exhibition-${r.id}`, id: r.id, createdAt: r.createdAt, raw: r })),
    ...(data.pendingGalleries ?? []).map((r: any) => ({ kind: 'gallery' as const, key: `gallery-${r.id}`, id: r.id, createdAt: r.createdAt, raw: r })),
    ...(data.pendingShows ?? []).map((r: any) => ({ kind: 'show' as const, key: `show-${r.id}`, id: r.id, createdAt: r.createdAt, raw: r })),
    ...(data.pendingRequests ?? []).map((r: any) => {
      const del = r.type === 'EXHIBITION_DELETE' || r.type === 'GALLERY_DELETE';
      return { kind: del ? 'delete-request' as const : 'edit-request' as const, key: `req-${r.id}`, id: r.id, createdAt: r.createdAt, raw: r };
    }),
  ];
  // 오래 기다린 순
  return out.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

function itemTitle(it: Item): string {
  const r = it.raw;
  if (it.kind === 'gallery') return r.name;
  if (it.kind === 'exhibition' || it.kind === 'show') return r.title;
  if (it.kind === 'edit-request') return r.targetName ?? String(parseJson<any>(r.changes, {}).title ?? `#${r.targetId}`);
  return r.target?.name ?? String(parseJson<any>(r.changes, {}).title ?? `#${r.targetId}`);
}
function itemKindLabel(it: Item): string {
  const t = it.raw.type;
  if (it.kind === 'edit-request') return t === 'GALLERY_EDIT' ? '갤러리 수정 요청' : '공모 수정 요청';
  if (it.kind === 'delete-request') return t === 'GALLERY_DELETE' ? '갤러리 삭제 요청' : '공모 삭제 요청';
  return KIND_LABEL[it.kind];
}
function itemBy(it: Item): string {
  const r = it.raw;
  if (it.kind === 'gallery') return [r.owner?.name, r.owner?.emailVerifiedAt ? '이메일 인증됨' : null, regionLabels[r.region]].filter(Boolean).join(' · ');
  if (it.kind === 'exhibition') return [r.gallery?.name, exhibitionTypeLabels[r.type], regionLabels[r.region]].filter(Boolean).join(' · ');
  if (it.kind === 'show') return [r.gallery?.name, regionLabels[r.region]].filter(Boolean).join(' · ');
  if (it.kind === 'edit-request') {
    const keys = Object.keys(parseJson<Record<string, unknown>>(r.changes, {}));
    return [r.requester?.name, keys.slice(0, 2).map((k) => FIELD_LABEL[k] ?? k).join(' · ') + (keys.length > 2 ? ` 외 ${keys.length - 2}` : '')].filter(Boolean).join(' · ');
  }
  return [r.requester?.name, '사유: ' + String(parseJson<any>(r.changes, {}).reason ?? '').slice(0, 30)].filter(Boolean).join(' · ');
}
function itemImage(it: Item): string | null {
  const r = it.raw;
  if (it.kind === 'exhibition') return r.imageUrl ?? null;
  if (it.kind === 'show') return r.posterImage ?? null;
  if (it.kind === 'gallery') return r.mainImage ?? null;
  if (it.kind === 'edit-request') {
    const c = parseJson<any>(r.changes, {});
    return c.imageUrl ?? c.mainImage ?? r.current?.imageUrl ?? r.current?.mainImage ?? null;
  }
  return null;
}
/** 승인 API 의 길 — 수정·삭제 요청은 각자 */
function decidePath(it: Item): string {
  if (it.kind === 'edit-request') return `/approvals/edit-request/${it.id}`;
  if (it.kind === 'delete-request') return `/approvals/delete-request/${it.id}`;
  return `/approvals/${it.kind}/${it.id}`;
}

export default function ApprovalsSection() {
  const qc = useQueryClient();
  const wide = useMediaQuery('(min-width: 1280px)');
  const [tab, setTab] = useState<'pending' | 'history'>('pending');
  const [filter, setFilter] = useState<KindFilter>('all');
  const [selKey, setSelKey] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { data, isLoading } = useQuery<any>({
    queryKey: ['approvals'],
    queryFn: () => api.get('/approvals').then((r) => r.data),
    staleTime: 0,
    refetchOnMount: 'always',
  });
  const { data: history = [], isLoading: historyLoading } = useQuery<any[]>({
    queryKey: ['approvals-history'],
    queryFn: () => api.get('/approvals/history?limit=80').then((r) => r.data),
    enabled: tab === 'history',
    staleTime: 0,
  });

  const items = useMemo(() => toItems(data), [data]);
  const counts = useMemo(() => ({
    all: items.length,
    exhibition: items.filter((i) => i.kind === 'exhibition').length,
    gallery: items.filter((i) => i.kind === 'gallery').length,
    show: items.filter((i) => i.kind === 'show').length,
    edit: items.filter((i) => i.kind === 'edit-request').length,
    delete: items.filter((i) => i.kind === 'delete-request').length,
  }), [items]);
  const shown = items.filter((i) => filter === 'all'
    || (filter === 'edit' ? i.kind === 'edit-request' : filter === 'delete' ? i.kind === 'delete-request' : i.kind === filter));
  // 넓은 화면은 늘 한 건이 열려 있다(고른 게 없으면 맨 위) · 좁은 화면은 누른 것만 창으로
  const selected = shown.find((i) => i.key === selKey) ?? (wide ? shown[0] ?? null : null);
  const index = selected ? shown.indexOf(selected) : -1;
  const next = index >= 0 ? shown[index + 1] ?? shown[index - 1] ?? null : null;

  const select = (key: string | null) => { setSelKey(key); setRejecting(false); setReason(''); };

  const invalidate = () => {
    const opts = { refetchType: 'all' as const };
    for (const key of [['approvals'], ['approvals-history'], ADMIN_TODO_KEY, ['my-galleries'], ['galleries'], ['my-exhibitions'], ['exhibitions'], ['my-shows'], ['shows'], ['ov-exhibitions'], ['my-operation-overview']]) {
      qc.invalidateQueries({ queryKey: key as unknown as readonly unknown[], ...opts });
    }
  };

  const decide = useMutation({
    mutationFn: ({ it, status, rejectReason }: { it: Item; status: 'APPROVED' | 'REJECTED'; rejectReason?: string }) =>
      api.patch(decidePath(it), { status, ...(rejectReason ? { rejectReason } : {}) }).then((r) => r.data),
    onSuccess: (res: any, v) => {
      const after = next;
      invalidate();
      if (v.status === 'REJECTED') toast.success('거절하고 알렸어요.');
      else if (v.it.kind === 'delete-request') toast.success(res?.alreadyGone ? '이미 지워진 대상이라 요청만 정리했어요.' : '삭제했어요. 요청한 갤러리와 참여 작가에게 알림이 가요.');
      else toast.success('승인했어요.');
      // 다음 요청으로 — 없으면 닫는다
      select(after ? after.key : null);
    },
    onError: (e: any) => toast.error(e.response?.data?.error || '처리하지 못했어요. 잠시 후 다시 시도해 주세요.'),
  });

  const approve = () => {
    if (!selected || decide.isPending) return;
    if (selected.kind === 'delete-request') { setConfirmDelete(true); return; }
    decide.mutate({ it: selected, status: 'APPROVED' });
  };
  const reject = () => {
    if (!selected || !reason.trim() || decide.isPending) return;
    decide.mutate({ it: selected, status: 'REJECTED', rejectReason: reason.trim() });
  };

  const deleteDetails = (it: Item | null): string[] => {
    const t = it?.raw?.target;
    if (!t || t.gone) return ['이미 지워진 대상이에요. 요청만 정리해요.'];
    const lines = it!.raw.type === 'EXHIBITION_DELETE'
      ? [`공모 「${t.name}」${t.galleryName ? ` (${t.galleryName})` : ''}을 지워요.`]
      : [`갤러리 「${t.name}」와 그 갤러리의 공모 ${t.exhibitions}건을 지워요.`];
    lines.push(`수락한 작가 ${t.accepted}명 · 출품 자료 ${t.submissions}건 · 판매 ${t.sales}건이 함께 사라져요.`);
    lines.push('참여 작가와 요청한 갤러리에게 알림이 가요. 되돌릴 수 없어요.');
    return lines;
  };

  const listNode = (
    <div className="flex min-w-0 flex-col">
      <ChoiceLinks<KindFilter>
        label="요청 종류"
        value={filter}
        onChange={(f) => { setFilter(f); select(null); }}
        className={cn(wide ? 'border-b border-gray-200 px-5 py-1.5' : 'py-1')}
        options={[
          { id: 'all', label: '전체', count: counts.all },
          ...(counts.exhibition ? [{ id: 'exhibition' as const, label: '공모', count: counts.exhibition }] : []),
          ...(counts.gallery ? [{ id: 'gallery' as const, label: '갤러리', count: counts.gallery }] : []),
          ...(counts.show ? [{ id: 'show' as const, label: '전시', count: counts.show }] : []),
          ...(counts.edit ? [{ id: 'edit' as const, label: '수정 요청', count: counts.edit }] : []),
          ...(counts.delete ? [{ id: 'delete' as const, label: '삭제 요청', count: counts.delete }] : []),
        ]}
      />
      <ul className={cn(!wide && 'border-t border-gray-900')} aria-label="기다리는 요청">
        {shown.map((it) => {
          const on = selected?.key === it.key;
          const img = itemImage(it);
          const days = daysWaited(it.createdAt);
          return (
            <li key={it.key} className={cn('border-b border-gray-100', on && wide && 'bg-gray-100')}>
              <button
                type="button"
                aria-current={on && wide ? 'true' : undefined}
                onClick={() => select(it.key)}
                className={cn('flex w-full items-start gap-3 py-3.5 text-left', wide ? 'px-5' : 'px-0')}
              >
                <span className="h-14 w-11 shrink-0 bg-gray-100">
                  {img && <img src={img} alt="" className="h-14 w-11 object-contain" loading="lazy" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[12.5px] text-gray-600">{itemKindLabel(it)}</span>
                  <span className="mt-0.5 block truncate text-[14.5px] font-semibold text-gray-950">{itemTitle(it)}</span>
                  <span className="mt-0.5 block truncate text-[12.5px] text-gray-500">{itemBy(it)}</span>
                </span>
                <span className={cn('shrink-0 text-[12.5px]', days >= 2 ? 'font-semibold text-accent' : 'text-gray-500')}>
                  {days >= 2 ? `${days}일째` : agoText(it.createdAt)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className={cn('py-3 text-[12.5px] text-gray-500', wide && 'px-5')}>오래 기다린 순</p>
    </div>
  );

  const decisionBar = selected && (
    <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
      <p className="min-w-0 text-[13px] text-gray-600">
        {index + 1} / {shown.length}
        {next && <span className="hidden sm:inline"> · 결정하면 다음 요청으로 — <span className="text-gray-900">{itemKindLabel(next)} 「{itemTitle(next)}」</span></span>}
      </p>
      {rejecting ? null : (
        <div className="flex gap-2">
          <button type="button" onClick={() => { setRejecting(true); setReason(''); }} disabled={decide.isPending}
            className="min-h-[44px] rounded-lg border border-gray-300 bg-white px-[18px] text-sm font-medium text-gray-950 hover:bg-gray-50 disabled:opacity-50">
            거절
          </button>
          <button type="button" onClick={approve} disabled={decide.isPending}
            className="min-h-[44px] rounded-lg bg-gray-900 px-[22px] text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50">
            {selected.kind === 'delete-request' ? '삭제 승인' : '승인'}
          </button>
        </div>
      )}
    </div>
  );

  const rejectPanel = selected && rejecting && (
    <div className="border-t border-gray-200 px-5 py-4" data-reject-panel>
      <p className="text-[15px] font-semibold text-gray-950">거절 사유</p>
      <div className="mt-2.5 flex flex-wrap gap-2">
        {REJECT_PRESETS[selected.kind].map((p) => (
          <button key={p} type="button" onClick={() => setReason(p)}
            className={cn('min-h-[36px] rounded-lg border px-3 text-[13.5px]', reason.startsWith(p) ? 'border-gray-900 font-semibold text-gray-950' : 'border-gray-300 text-gray-700 hover:border-gray-500')}>
            {p}
          </button>
        ))}
      </div>
      <label htmlFor="approval-reject-reason" className="mt-3.5 block text-[12.5px] text-gray-600">요청한 사람에게 보이는 글</label>
      <textarea id="approval-reject-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)}
        className="mt-1.5 block w-full resize-none rounded-lg border border-gray-300 px-3 py-2.5 text-base leading-relaxed text-gray-950 focus:border-gray-900 focus:outline-none sm:text-sm" />
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={() => setRejecting(false)} className="min-h-[44px] px-4 text-sm text-gray-700">취소</button>
        <button type="button" onClick={reject} disabled={!reason.trim() || decide.isPending}
          className="min-h-[44px] rounded-lg bg-accent px-5 text-sm font-semibold text-white disabled:opacity-50">거절하고 알리기</button>
      </div>
    </div>
  );

  return (
    <div>
      <AdminHead title="승인 관리" />
      <div className="mt-3">
        <PageTabBar<'pending' | 'history'>
          sticky={false}
          idPrefix="approvals"
          label="승인 관리"
          active={tab}
          onSelect={(t) => { setTab(t); select(null); }}
          tabs={[{ id: 'pending', label: '기다리는 요청', count: items.length || undefined }, { id: 'history', label: '처리한 요청' }]}
        />
      </div>

      {tab === 'pending' && (
        isLoading ? <div className="mt-6 h-64 animate-pulse rounded-[10px] bg-gray-100" />
          : items.length === 0 ? <div className="mt-6"><EmptyLine>기다리는 요청이 없어요.</EmptyLine></div>
          : wide ? (
            <div className="mt-5 grid grid-cols-[360px_minmax(0,1fr)] items-start overflow-hidden rounded-[10px] border border-gray-200">
              <div className="min-w-0 border-r border-gray-200">{listNode}</div>
              {selected && (
                <div className="flex min-w-0 flex-col">
                  <div className="min-w-0 px-7 pb-7 pt-6" data-approval-detail><ApprovalDetail it={selected} /></div>
                  <div className="border-t border-gray-200">{rejectPanel || decisionBar}</div>
                </div>
              )}
            </div>
          ) : (
            <div className="mt-3">
              {listNode}
              {selected && (
                <DetailPane wide={false} title={itemKindLabel(selected)} onClose={() => select(null)} footer={rejectPanel || decisionBar}>
                  <div className="px-5 pb-6 pt-4" data-approval-detail><ApprovalDetail it={selected} /></div>
                </DetailPane>
              )}
            </div>
          )
      )}

      {tab === 'history' && (
        historyLoading ? <div className="mt-6 h-40 animate-pulse rounded-[10px] bg-gray-100" />
          : history.length === 0 ? <div className="mt-6"><EmptyLine>아직 처리한 요청이 없어요.</EmptyLine></div>
          : (
            <ul className="mt-4 border-t border-gray-900" aria-label="처리한 요청">
              {history.map((h) => (
                <li key={`${h.kind}-${h.id}`} className="flex items-start justify-between gap-4 border-b border-gray-100 py-3.5">
                  <div className="min-w-0">
                    <p className="text-[12.5px] text-gray-600">{historyKind(h)} · {h.by ?? '—'}</p>
                    <p className="mt-0.5 truncate text-[14.5px] font-semibold text-gray-950">{h.title ?? `#${h.targetId}`}</p>
                    {h.status === 'REJECTED' && h.rejectReason && <p className="mt-1 text-[13px] text-gray-700">사유: {h.rejectReason}</p>}
                  </div>
                  <div className="shrink-0 text-right">
                    <StatusChip variant={h.status === 'APPROVED' ? 'done' : 'neutral'}>{h.status === 'APPROVED' ? '승인' : '거절'}</StatusChip>
                    <p className="mt-1 text-[12.5px] tabular-nums text-gray-500">{shortDate(h.decidedAt)} · {waited(h.requestedAt, h.decidedAt)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )
      )}

      <ConfirmDialog
        open={confirmDelete}
        title={selected?.raw?.type === 'GALLERY_DELETE' ? '갤러리를 삭제할까요?' : '공모를 삭제할까요?'}
        details={deleteDetails(selected)}
        confirmText="삭제 승인"
        variant="danger"
        onConfirm={() => { setConfirmDelete(false); if (selected) decide.mutate({ it: selected, status: 'APPROVED' }); }}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}

function historyKind(h: any): string {
  if (h.kind === 'gallery') return '갤러리 등록';
  if (h.kind === 'exhibition') return '공모 등록';
  if (h.kind === 'show') return '전시 등록';
  if (h.kind === 'delete-request') return h.type === 'GALLERY_DELETE' ? '갤러리 삭제 요청' : '공모 삭제 요청';
  return h.type === 'GALLERY_EDIT' ? '갤러리 수정 요청' : '공모 수정 요청';
}
function waited(from: string, to: string): string {
  const h = (new Date(to).getTime() - new Date(from).getTime()) / 3600000;
  if (!Number.isFinite(h) || h < 0) return '';
  return h < 1 ? '1시간 안에 처리' : h < 48 ? `${Math.round(h)}시간 만에 처리` : `${Math.round(h / 24)}일 만에 처리`;
}

// ───────────────────────────── 한 건 ─────────────────────────────

function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[88px_minmax(0,1fr)] gap-x-3 gap-y-2.5 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-gray-500">{k}</dt>
          <dd className="min-w-0 break-words text-gray-950">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Sub({ children }: { children: ReactNode }) {
  return <h4 className="mt-7 text-[13px] font-semibold text-gray-600">{children}</h4>;
}

/** 소개 글 — 길면 접어 둔다 */
function Intro({ value }: { value: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <div className={cn('relative max-w-[680px]', !open && 'max-h-[9.5rem] overflow-hidden')}>
        <RichText value={value} className="text-[14.5px] leading-[1.75] text-gray-800" />
      </div>
      <button type="button" onClick={() => setOpen((v) => !v)} className="mt-1 min-h-[40px] text-[13.5px] text-gray-700 underline underline-offset-4">
        {open ? '접기' : '소개 모두 보기'}
      </button>
    </div>
  );
}

/** 등록한 곳 — 갤러리 상태 · 지난 공모 · 가입 계정 */
function Place({ place }: { place: any }) {
  if (!place) return null;
  const o = place.owner;
  return (
    <>
      <Sub>등록한 곳</Sub>
      <div className="mt-2 grid grid-cols-1 border-y border-gray-200 sm:grid-cols-3">
        <div className="py-3.5 sm:pr-4">
          <p className="text-[12.5px] text-gray-500">갤러리</p>
          <p className="mt-1 text-[14.5px] font-medium"><Link to={`/galleries/${place.id}`} className="underline underline-offset-4">{place.name}</Link></p>
          <p className="mt-0.5 text-[12.5px] text-gray-600">{place.status === 'APPROVED' ? '승인된 갤러리' : place.status === 'PENDING' ? '승인 대기 갤러리' : '반려된 갤러리'} · {shortDate(place.createdAt)} 등록</p>
        </div>
        <div className="border-t border-gray-100 py-3.5 sm:border-l sm:border-t-0 sm:px-4">
          <p className="text-[12.5px] text-gray-500">지난 공모</p>
          <p className="mt-1 text-[14.5px] font-medium">{place.exhibitions}건</p>
          <p className="mt-0.5 text-[12.5px] text-gray-600">반려 {place.rejectedExhibitions} · 정산까지 마친 공모 {place.settledExhibitions}</p>
        </div>
        <div className="border-t border-gray-100 py-3.5 sm:border-l sm:border-t-0 sm:pl-4">
          <p className="text-[12.5px] text-gray-500">가입 계정</p>
          <p className="mt-1 text-[14.5px] font-medium">{o?.name ?? '—'}</p>
          <p className="mt-0.5 text-[12.5px] text-gray-600">
            {o?.emailVerifiedAt ? '이메일 인증됨' : o?.provider === 'KAKAO' ? '카카오 가입' : '이메일 미확인'} · 최근 접속 {seenText(o?.lastSeenAt)}
          </p>
        </div>
      </div>
    </>
  );
}

function ApprovalDetail({ it }: { it: Item }) {
  const r = it.raw;
  const waitedDays = daysWaited(it.createdAt);
  const head = (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[13px] text-gray-600">
          <strong className="font-bold text-gray-950">{itemKindLabel(it)}</strong>
          <span className="ml-2">{shortDate(it.createdAt)} 요청 · </span>
          <span className={cn(waitedDays >= 2 && 'font-semibold text-accent')}>{waitedDays >= 1 ? `${waitedDays}일째 기다리는 중` : agoText(it.createdAt)}</span>
        </p>
        <h3 className="mt-1.5 text-[21px] font-semibold leading-snug tracking-tight text-gray-950">{itemTitle(it)}</h3>
        <p className="mt-1 text-[13.5px] text-gray-500">{itemBy(it)}</p>
      </div>
      {it.kind === 'exhibition' && <Link to={`/exhibitions/${r.id}`} className="inline-flex min-h-[44px] items-center text-[13.5px] text-gray-700 underline underline-offset-4">공고로 미리 보기</Link>}
      {it.kind === 'show' && <Link to={`/shows/${r.id}`} className="inline-flex min-h-[44px] items-center text-[13.5px] text-gray-700 underline underline-offset-4">전시로 미리 보기</Link>}
      {it.kind === 'gallery' && <Link to={`/galleries/${r.id}`} className="inline-flex min-h-[44px] items-center text-[13.5px] text-gray-700 underline underline-offset-4">갤러리로 미리 보기</Link>}
    </div>
  );

  if (it.kind === 'exhibition') {
    const attachments = normalizeAttachments(r.attachments);
    const questions = parseJson<any[]>(r.customFields, []);
    return (
      <div>
        {head}
        <div className="mt-5 grid gap-6 sm:grid-cols-[176px_minmax(0,1fr)]">
          <span className="block w-[140px] bg-gray-100 sm:w-[176px]">{r.imageUrl && <img src={r.imageUrl} alt="공모 포스터" className="block aspect-[210/297] w-full object-contain" />}</span>
          <div className="min-w-0">
            <ScheduleStrip steps={scheduleSteps(r)} compact />
            <div className="mt-5">
              <Facts rows={[
                ['모집', `${exhibitionTypeLabels[r.type] ?? r.type} · ${capacityText(r)} · ${regionLabels[r.region] ?? r.region} · ${r.recruitOnly ? '공모만 진행' : '전시까지 진행'}`],
                ...(attachments.length ? [['첨부파일', <AttachmentList key="a" items={attachments} />] as [string, ReactNode]] : []),
                ...(questions.length ? [['추가 질문', `${questions.length}개 — ${questions.map((q: any) => q.label).filter(Boolean).slice(0, 3).join(' · ')}`] as [string, ReactNode]] : []),
              ]} />
            </div>
          </div>
        </div>
        {r.description && <><Sub>공모 소개</Sub><div className="mt-2"><Intro value={r.description} /></div></>}
        <Place place={r.place} />
      </div>
    );
  }

  if (it.kind === 'show') {
    return (
      <div>
        {head}
        <div className="mt-5 grid gap-6 sm:grid-cols-[176px_minmax(0,1fr)]">
          <span className="block w-[140px] bg-gray-100 sm:w-[176px]">{r.posterImage && <img src={r.posterImage} alt="전시 포스터" className="block aspect-[3/4] w-full object-contain" />}</span>
          <Facts rows={[
            ['기간', `${shortDate(r.startDate)} – ${shortDate(r.endDate)}`],
            ['관람', [r.openingHours, r.admissionFee].filter(Boolean).join(' · ') || '—'],
            ['장소', `${r.location ?? '—'} · ${regionLabels[r.region] ?? r.region}`],
          ]} />
        </div>
        {r.description && <><Sub>전시 소개</Sub><div className="mt-2"><Intro value={r.description} /></div></>}
        <Place place={r.place} />
      </div>
    );
  }

  if (it.kind === 'gallery') {
    const o = r.owner;
    const sameEmail = o?.email && r.email && o.email.toLowerCase() === String(r.email).trim().toLowerCase();
    return (
      <div>
        {head}
        <div className="mt-5 grid gap-6 sm:grid-cols-[220px_minmax(0,1fr)]">
          <span className="block bg-gray-100">{r.mainImage && <img src={r.mainImage} alt="대표 사진" className="block aspect-[4/3] w-full object-contain" />}</span>
          <Facts rows={[
            ['주소', r.address || '—'],
            ['지역', regionLabels[r.region] ?? r.region],
            ['전화', r.phone || '—'],
            ['대표자', r.ownerName || '—'],
            ...(r.email ? [['이메일', <span key="e">{r.email}{sameEmail && <span className="text-gray-500"> (가입 계정과 같음)</span>}</span>] as [string, ReactNode]] : []),
            ...(r.instagramUrl ? [['인스타그램', r.instagramUrl] as [string, ReactNode]] : []),
          ]} />
        </div>
        {r.description && <><Sub>한 줄 소개</Sub><p className="mt-2 max-w-[680px] text-[14.5px] leading-relaxed text-gray-800">{r.description}</p></>}
        <Sub>가입 계정</Sub>
        <div className="mt-2">
          <Facts rows={[
            ['이름', o?.name ?? '—'],
            ['이메일', <span key="m" className="inline-flex flex-wrap items-center gap-1.5">{o?.email ?? '—'}{o?.emailVerifiedAt ? <StatusChip variant="done">이메일 인증됨</StatusChip> : <StatusChip>{o?.provider === 'KAKAO' ? '카카오 가입 · 이메일 미확인' : '이메일 미확인'}</StatusChip>}</span>],
            ['가입', `${shortDate(o?.joinedAt)} · 최근 접속 ${seenText(o?.lastSeenAt)}`],
            ['갤러리', `이 계정의 갤러리 ${r.ownerGalleryCount ?? 1}곳`],
          ]} />
        </div>
      </div>
    );
  }

  if (it.kind === 'edit-request') {
    const changes = parseJson<Record<string, unknown>>(r.changes, {});
    const keys = Object.keys(changes);
    const cur = r.current ?? {};
    const f = r.targetFacts;
    return (
      <div>
        {head}
        {r.targetId && (
          <Link to={r.type === 'GALLERY_EDIT' ? `/galleries/${r.targetId}` : `/exhibitions/${r.targetId}`} className="inline-flex min-h-[40px] items-center text-[13.5px] text-gray-700 underline underline-offset-4">
            지금 {r.type === 'GALLERY_EDIT' ? '갤러리' : '공고'} 보기
          </Link>
        )}
        <Sub>바뀌는 것 {keys.length}가지</Sub>
        <dl className="mt-2 border-t border-gray-900">
          {keys.map((k) => (
            <div key={k} className="border-b border-gray-100 py-3.5">
              <dt className="text-[12.5px] text-gray-500">{FIELD_LABEL[k] ?? k}</dt>
              <dd className="mt-1.5">
                {IMAGE_FIELDS.has(k) ? (
                  <span className="flex items-center gap-3.5">
                    <span className="bg-gray-100">{cur[k] ? <img src={String(cur[k])} alt="지금" className="h-[118px] w-[84px] object-contain opacity-60" /> : <span className="block h-[118px] w-[84px]" />}</span>
                    <span aria-hidden className="text-gray-500">→</span>
                    <span className="bg-gray-100">{changes[k] ? <img src={String(changes[k])} alt="바꾸려는 것" className="h-[118px] w-[84px] object-contain" /> : <span className="block h-[118px] w-[84px]" />}</span>
                  </span>
                ) : RICH_FIELDS.has(k) ? (
                  <div className="rounded-lg bg-gray-50 px-3 py-2.5"><Intro value={String(changes[k] ?? '')} /></div>
                ) : (
                  <span className="flex flex-wrap items-baseline gap-x-2.5 text-[15px]">
                    <span className="text-gray-500 line-through">{valueText(k, cur[k])}</span>
                    <span aria-hidden className="text-gray-500">→</span>
                    <strong className="font-semibold text-gray-950">{valueText(k, changes[k])}</strong>
                  </span>
                )}
              </dd>
            </div>
          ))}
        </dl>
        {f && (
          <>
            <Sub>지금 이 공모</Sub>
            <div className="mt-2 grid grid-cols-3 gap-2">
              <div className="rounded-[10px] bg-gray-50 p-3"><p className="text-[12.5px] text-gray-600">지원</p><p className="mt-1 text-lg font-semibold tabular-nums">{f.applications}<span className="ml-0.5 text-[13px] font-medium text-gray-600">명</span></p></div>
              <div className="rounded-[10px] bg-gray-50 p-3"><p className="text-[12.5px] text-gray-600">수락</p><p className="mt-1 text-lg font-semibold tabular-nums">{f.accepted}<span className="ml-0.5 text-[13px] font-medium text-gray-600">명</span></p></div>
              <div className="rounded-[10px] bg-gray-50 p-3"><p className="text-[12.5px] text-gray-600">접수 마감</p><p className="mt-1 text-lg font-semibold tabular-nums">{f.recruitmentClosed ? '마감' : (() => { const d = getDday(f.deadline); return d >= 0 ? `D-${d}` : '지남'; })()}</p></div>
            </div>
            {f.applications > 0 && <p className="mt-2 text-[13px] text-gray-700"><Dot className="mr-2" />이미 지원한 작가가 있어요 — 일정·인원을 바꾸면 그들이 본 공고와 달라져요.</p>}
          </>
        )}
        <Place place={r.place} />
        <Sub>요청한 사람</Sub>
        <p className="mt-2 text-sm text-gray-900">{r.requester?.name ?? `#${r.requesterId}`}{r.requester?.email && <span className="text-gray-500"> · {r.requester.email}</span>}</p>
      </div>
    );
  }

  // 삭제 요청
  const t = r.target;
  const why = String(parseJson<any>(r.changes, {}).reason ?? '');
  return (
    <div>
      {head}
      <Sub>사유</Sub>
      <p className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-gray-50 px-3 py-2.5 text-[14.5px] leading-relaxed text-gray-900">{why || '—'}</p>
      <Sub>지우면 함께 사라지는 것</Sub>
      {t?.gone ? (
        <p className="mt-2 text-sm text-gray-700">이미 지워진 대상이에요 — [삭제 승인]을 누르면 요청만 정리해요.</p>
      ) : (
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            ...(r.type === 'GALLERY_DELETE' ? [['공모', t?.exhibitions]] : []),
            ['수락한 작가', t?.accepted], ['출품 자료', t?.submissions], ['판매', t?.sales],
          ].map(([k, v]) => (
            <div key={String(k)} className="rounded-[10px] bg-gray-50 p-3"><p className="text-[12.5px] text-gray-600">{k}</p><p className="mt-1 text-lg font-semibold tabular-nums">{v ?? 0}</p></div>
          ))}
        </div>
      )}
      <Sub>요청한 사람</Sub>
      <p className="mt-2 text-sm text-gray-900">{r.requester?.name ?? `#${r.requesterId}`}{r.requester?.email && <span className="text-gray-500"> · {r.requester.email}</span>}</p>
    </div>
  );
}
