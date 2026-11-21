/**
 * 마이페이지(관리자) > 운영 조회 — 2026-11-21 개편(CLAUDE.md 규칙 89).
 *
 * 예전: [공모 지원현황 · 작가 지원이력 · 갤러리 게시물] 알약 탭 · 공모 목록 아래에 상세가 붙어(목록이 길면 한참 아래) ·
 * 진행/종료 두 갈래뿐. 승인 관리의 '등록 관리'에 삭제 목록이 따로 있었다.
 *
 * 지금: 탭 [공모 · 갤러리 · 전시] (작가 지원이력은 [사용자 관리]의 회원 한 명으로 옮겼다).
 *   공모 — 단계(모집 중 · 전시 준비 · 전시 · 정산 · 마무리 · 승인 대기/반려 — 갤러리 [내 공모]와 같은 말, lib/flowLabels.ts) ·
 *          주최(갤러리 / 아트링크)로 거른다 · 멈춘 공모(빨간 점)가 위로 · 줄을 누르면 한 건(진행 띠 · 숫자 · 지원자 · 삭제).
 *   갤러리 · 전시 — 표 | 한 건(게시물 · 주인 계정 · 삭제).
 * `?ex=<id>` 로 들어오면 그 공모를 연 채로(운영 화면 [← 운영 조회] · 회원 한 명의 지원 이력이 이 주소를 쓴다, lib/operationLinks.ts).
 * 관리자가 갤러리 주최 공모를 보는 곳이라 **조회 전용**이다 — 수락·거절은 그 갤러리의 일이다([공모 화면 열기]도 조회).
 */
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import { cn, regionLabels, exhibitionTypeLabels, capacityText } from '@/lib/utils';
import { flowStrip } from '@/lib/flowLabels';
import { GROUP_OF, hostLine, rowNote, rowStage, type OvRow, type StageGroup } from '@/lib/adminOversight';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { ADMIN_TODO_KEY } from '@/hooks/useAdminTodo';
import PageTabBar from '@/components/shared/PageTabBar';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import ApplicationContent from '@/components/shared/ApplicationContent';
import FlowStrip from '@/components/flow/FlowStrip';
import { nameWithNickname } from '@/lib/utils';
import { AdminHead, ChoiceLinks, DetailPane, Dot, EmptyLine, SearchBox, Th } from '@/components/admin/AdminUi';
import { seenText, shortDate } from '@/lib/adminFormat';

type View = 'exhibitions' | 'galleries' | 'shows';
type Host = 'all' | 'GALLERY' | 'ADMIN';
const STATUS_LABEL: Record<string, string> = { PENDING: '승인 대기', APPROVED: '승인', REJECTED: '반려', WITHDRAWN: '탈퇴' };
export default function OversightSection() {
  const [searchParams] = useSearchParams();
  const linkedEx = Number(searchParams.get('ex')) || null;
  const [view, setView] = useState<View>('exhibitions');
  return (
    <div>
      <AdminHead title="운영 조회" />
      <div className="mt-3">
        <PageTabBar<View>
          sticky={false}
          idPrefix="oversight"
          label="조회 대상"
          active={view}
          onSelect={setView}
          tabs={[{ id: 'exhibitions', label: '공모' }, { id: 'galleries', label: '갤러리' }, { id: 'shows', label: '전시' }]}
        />
      </div>
      {view === 'exhibitions' && <ExhibitionsView linkedId={linkedEx} />}
      {view === 'galleries' && <GalleriesView />}
      {view === 'shows' && <ShowsView />}
    </div>
  );
}

// ───────────────────────────── 공모 ─────────────────────────────

function ExhibitionsView({ linkedId }: { linkedId: number | null }) {
  const wide = useMediaQuery('(min-width: 1280px)');
  const [q, setQ] = useState('');
  const [group, setGroup] = useState<StageGroup>('all');
  const [host, setHost] = useState<Host>('all');
  const [selId, setSelId] = useState<number | null>(linkedId);
  const [limit, setLimit] = useState(30);
  const { data: rows = [], isLoading, isFetching } = useQuery<OvRow[]>({
    queryKey: ['ov-exhibitions', q],
    queryFn: () => api.get(`/admin/exhibitions${q ? `?q=${encodeURIComponent(q)}` : ''}`).then((r) => r.data),
    placeholderData: keepPreviousData,
    staleTime: 0,
  });

  const withStage = useMemo(() => rows.map((r) => ({ r, stage: rowStage(r) })), [rows]);
  const groupCount = (g: StageGroup) => withStage.filter((x) => (g === 'all' || GROUP_OF[x.stage.key] === g) && (host === 'all' || x.r.hostType === host)).length;
  const shown = withStage
    .filter((x) => (group === 'all' || GROUP_OF[x.stage.key] === group) && (host === 'all' || x.r.hostType === host))
    // 멈춘 공모가 위로 — 그다음 최근 등록 순(서버 순서)
    .sort((a, b) => Number(!!b.r.stall) - Number(!!a.r.stall));
  const page = shown.slice(0, limit);
  // 가리켜 들어온 공모가 목록에 있는데 거르기에 빠졌으면 '전체'로 — 렌더 중 맞추기(한 번)
  const [placed, setPlaced] = useState(false);
  if (!placed && linkedId && rows.length) {
    setPlaced(true);
    if (!shown.some((x) => x.r.id === linkedId)) { setGroup('all'); setHost('all'); }
  }
  const selected = rows.find((r) => r.id === selId) ?? null;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2 pt-3">
        <SearchBox label="공모 제목으로 찾기" value={q} onChange={(v) => { setQ(v); setLimit(30); }} className="w-full sm:w-[260px]" />
        <ChoiceLinks<Host>
          label="주최"
          value={host}
          onChange={(h) => { setHost(h); setLimit(30); }}
          options={[
            { id: 'all', label: '모든 주최' },
            { id: 'GALLERY', label: '갤러리', count: rows.filter((r) => r.hostType === 'GALLERY').length },
            { id: 'ADMIN', label: '아트링크', count: rows.filter((r) => r.hostType === 'ADMIN').length },
          ]}
        />
      </div>
      <ChoiceLinks<StageGroup>
        label="단계"
        value={group}
        onChange={(g) => { setGroup(g); setLimit(30); }}
        className="py-1"
        options={([
          ['all', '전체'], ['recruit', '모집 중'], ['prepare', '전시 준비'], ['show', '전시'], ['settle', '정산'], ['wrap', '마무리'], ['pending', '승인 대기·반려'],
        ] as [StageGroup, string][]).map(([id, label]) => ({ id, label, count: groupCount(id) }))}
      />

      {isLoading ? <div className="mt-3 h-64 animate-pulse rounded-[10px] bg-gray-100" />
        : shown.length === 0 ? <div className="mt-3"><EmptyLine>찾는 공모가 없어요.</EmptyLine></div>
        : (
          <div className={cn('mt-2', wide && selected && 'grid grid-cols-[minmax(0,1fr)_420px] items-start gap-7', isFetching && 'opacity-70')}>
            <div className="min-w-0">
              <div role="table" aria-label="공모" className="border-t border-gray-900">
                <div role="row" className="hidden grid-cols-[minmax(0,1fr)_200px_72px] items-center gap-3.5 border-b border-gray-200 py-2.5 md:grid">
                  <Th>공모</Th><Th>단계</Th><Th className="text-right">지원 · 수락</Th>
                </div>
                {page.map(({ r, stage }) => (
                  <div role="row" key={r.id} aria-selected={r.id === selId} data-ov-row={r.id}
                    className={cn('relative -mx-3 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3.5 gap-y-1 border-b border-gray-100 px-3 py-2.5 hover:bg-gray-50 md:grid-cols-[minmax(0,1fr)_200px_72px]', r.id === selId && 'bg-gray-100 hover:bg-gray-100')}>
                    <span role="cell" className="min-w-0">
                      <button type="button" onClick={() => setSelId(r.id)} className="block max-w-full truncate text-left text-[14.5px] font-semibold text-gray-950 after:absolute after:inset-0 after:content-['']">{r.title}</button>
                      <span className="block truncate text-[12.5px] text-gray-500">{hostLine(r)}</span>
                    </span>
                    <span role="cell" className="order-3 col-span-2 min-w-0 md:order-none md:col-span-1">
                      <span className="text-[13.5px] font-semibold text-gray-950">{stage.label}</span>
                      <span className={cn('ml-2 text-[12.5px] md:ml-0 md:block md:truncate', r.stall ? 'font-semibold text-accent' : 'text-gray-500')}>
                        {r.stall && <Dot className="mr-1.5" />}{rowNote(r)}
                      </span>
                    </span>
                    <span role="cell" className="whitespace-nowrap text-right text-[13.5px] tabular-nums">
                      <strong className="font-semibold">{r.counts.apps.total}</strong><span className="text-gray-500"> · {r.counts.apps.accepted}</span>
                    </span>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between py-3 text-[13px] text-gray-600">
                <span className="tabular-nums">{page.length} / {shown.length}건</span>
                {shown.length > page.length && (
                  <button type="button" onClick={() => setLimit((n) => n + 30)} className="min-h-[40px] rounded-lg border border-gray-300 px-4 text-[13.5px] text-gray-950">30건 더 보기</button>
                )}
              </div>
            </div>
            {selected && (
              <DetailPane wide={wide} title={selected.title} onClose={() => setSelId(null)}>
                <ExhibitionDetail row={selected} onClose={() => setSelId(null)} showClose={wide} />
              </DetailPane>
            )}
          </div>
        )}
    </div>
  );
}

function ExhibitionDetail({ row, onClose, showClose }: { row: OvRow; onClose: () => void; showClose: boolean }) {
  const qc = useQueryClient();
  const [appFilter, setAppFilter] = useState<'ALL' | 'ACCEPTED' | 'REJECTED' | 'SUBMITTED'>('ALL');
  const [open, setOpen] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const { data } = useQuery<any>({
    queryKey: ['ov-ex-apps', row.id],
    queryFn: () => api.get(`/admin/exhibitions/${row.id}/applications`).then((r) => r.data),
    staleTime: 0,
  });
  const del = useMutation({
    mutationFn: () => api.delete(`/exhibitions/${row.id}`),
    onSuccess: () => {
      for (const k of [['ov-exhibitions'], ['exhibitions'], ['hosted-exhibitions'], ADMIN_TODO_KEY]) qc.invalidateQueries({ queryKey: k as unknown as readonly unknown[] });
      toast.success('공모를 지웠어요.');
      onClose();
    },
    onError: (e: any) => toast.error(e.response?.data?.error || '지우지 못했어요.'),
  });
  const stage = rowStage(row);
  const c = row.counts;
  const strip = flowStrip('gallery', {
    ...row, settlementStarted: c.sales > 0 || !!row.settlementRequestedAt,
    accepted: c.apps.accepted, pending: c.apps.submitted, capacity: row.capacity, capacityMask: row.capacityMask,
    submissionsComplete: c.submissions.complete, submissionsRequired: c.apps.accepted, sales: c.sales, approvals: c.approvals,
  });
  const apps: any[] = (data?.applications ?? []).filter((a: any) => appFilter === 'ALL' || (appFilter === 'SUBMITTED' ? a.status !== 'ACCEPTED' && a.status !== 'REJECTED' : a.status === appFilter));
  const appsShown = showAll ? apps : apps.slice(0, 8);
  const counts = data?.counts ?? {};

  return (
    <div data-testid="ov-ex-detail">
      <div className="px-5 pb-3.5 pt-5">
        <div className="flex items-start justify-between gap-2">
          <p className="text-[12.5px] text-gray-600"><strong className="font-bold text-gray-950">{stage.label}</strong><span className="ml-2">{hostLine(row)} · {exhibitionTypeLabels[row.type] ?? row.type} · {regionLabels[row.region] ?? row.region}</span></p>
          {showClose && (
            <button type="button" onClick={onClose} aria-label="닫기" className="-mr-2 -mt-2 flex h-10 w-10 shrink-0 items-center justify-center text-gray-700">
              <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M6 6l12 12" /><path d="M18 6L6 18" /></svg>
            </button>
          )}
        </div>
        <h3 className="mt-1.5 text-[19px] font-semibold leading-snug tracking-tight text-gray-950">{row.title}</h3>
        {row.stall && <p className="mt-1.5 text-[13px] font-semibold text-accent"><Dot className="mr-1.5" />{row.stall.text}</p>}
        <p className="mt-1.5 flex flex-wrap gap-x-4 text-[13.5px]">
          {row.status === 'APPROVED' && <Link to={`/exhibitions/${row.id}/operation/new`} className="inline-flex min-h-[40px] items-center underline underline-offset-4">공모 화면 열기</Link>}
          <Link to={`/exhibitions/${row.id}`} className="inline-flex min-h-[40px] items-center underline underline-offset-4">공고 보기</Link>
          {row.gallery && <Link to={`/galleries/${row.gallery.id}`} className="inline-flex min-h-[40px] items-center underline underline-offset-4">갤러리 보기</Link>}
        </p>
        {row.status === 'APPROVED' && <FlowStrip cells={strip} variant="row" className="mt-3" />}
      </div>

      <div className="grid grid-cols-4 border-y border-gray-100">
        {[
          ['지원', c.apps.total, ''],
          ['수락', c.apps.accepted, row.recruitOnly || !row.capacityMask ? ` / ${capacityText(row)}` : ''],
          ['출품 자료', row.recruitOnly ? '—' : c.submissions.complete, row.recruitOnly ? '' : ` / ${c.apps.accepted}`],
          ['조회', row.viewCount, ''],
        ].map(([k, v, s], i) => (
          <div key={String(k)} className={cn('py-3', i === 0 ? 'pl-5' : 'pl-3')}>
            <p className="text-[12.5px] text-gray-500">{k}</p>
            <p className="mt-1 text-[17px] font-semibold tabular-nums">{v}<span className="text-[12.5px] font-normal text-gray-500">{s}</span></p>
          </div>
        ))}
      </div>

      <div className="px-5 pb-1 pt-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-[13px] font-semibold text-gray-600">지원자</h4>
          <ChoiceLinks<'ALL' | 'ACCEPTED' | 'REJECTED' | 'SUBMITTED'>
            label="지원 상태"
            value={appFilter}
            onChange={setAppFilter}
            options={[
              { id: 'ALL', label: '전체', count: counts.ALL ?? 0 },
              { id: 'SUBMITTED', label: '검토 대기', count: counts.SUBMITTED ?? 0 },
              { id: 'ACCEPTED', label: '수락', count: counts.ACCEPTED ?? 0 },
              { id: 'REJECTED', label: '거절', count: counts.REJECTED ?? 0 },
            ]}
          />
        </div>
        {!data ? <div className="my-3 h-24 animate-pulse rounded-lg bg-gray-100" />
          : apps.length === 0 ? <p className="py-4 text-[13px] text-gray-500">지원자가 없어요.</p>
          : (
            <ul className="mt-1">
              {appsShown.map((a) => {
                const pending = a.status !== 'ACCEPTED' && a.status !== 'REJECTED';
                return (
                  <li key={a.id} className="border-b border-gray-100 last:border-0">
                    <button type="button" onClick={() => setOpen(open === a.id ? null : a.id)} aria-expanded={open === a.id}
                      className="flex min-h-[52px] w-full items-center justify-between gap-2.5 py-2 text-left">
                      <span className="min-w-0">
                        <span className="text-[14px] font-semibold text-gray-950">{nameWithNickname(a.user)}</span>
                        <span className="ml-2 text-[12.5px] text-gray-600">{a.isFirstApplication ? '첫 지원' : `이 갤러리 ${a.galleryApplicationOrder}번째`}</span>
                        <span className="block text-[12.5px] tabular-nums text-gray-500">{shortDate(a.appliedAt)} 지원{!pending ? ` · ${shortDate(a.decidedAt)} 결정` : ''}</span>
                      </span>
                      <span className={cn('shrink-0 text-[12.5px]', pending ? 'font-semibold text-accent' : a.status === 'ACCEPTED' ? 'font-semibold text-gray-950' : 'text-gray-500')}>
                        {pending ? '검토 대기' : a.status === 'ACCEPTED' ? '수락됨' : '거절'}
                      </span>
                    </button>
                    {open === a.id && <div className="pb-3"><ApplicationContent app={a} /></div>}
                  </li>
                );
              })}
            </ul>
          )}
        {apps.length > 8 && !showAll && (
          <button type="button" onClick={() => setShowAll(true)} className="min-h-[44px] text-[13.5px] text-gray-700 underline underline-offset-4">{apps.length}명 모두 보기</button>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-gray-100 px-5 py-1.5">
        <span className="text-[12.5px] tabular-nums text-gray-500">등록 {shortDate(row.createdAt)}{row.reviewedAt ? ` · 승인 ${shortDate(row.reviewedAt)}` : ''}</span>
        <button type="button" onClick={() => setConfirmDel(true)} className="min-h-[44px] text-[13.5px] text-accent">공모 삭제</button>
      </div>
      <ConfirmDialog
        open={confirmDel}
        title="공모를 지울까요?"
        details={[
          `「${row.title}」을 지워요.`,
          `지원 ${c.apps.total}건 · 수락한 작가 ${c.apps.accepted}명 · 출품 자료 ${c.submissions.started}건 · 판매 ${c.sales}건이 함께 사라져요.`,
          '지원한 작가에게 알림이 가요. 되돌릴 수 없어요.',
        ]}
        confirmText="삭제"
        variant="danger"
        onConfirm={() => { setConfirmDel(false); del.mutate(); }}
        onCancel={() => setConfirmDel(false)}
      />
    </div>
  );
}

// ───────────────────────────── 갤러리 ─────────────────────────────

function GalleriesView() {
  const wide = useMediaQuery('(min-width: 1280px)');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'all' | 'APPROVED' | 'PENDING' | 'REJECTED'>('all');
  const [selId, setSelId] = useState<number | null>(null);
  const { data: rows = [], isLoading } = useQuery<any[]>({
    queryKey: ['ov-galleries', q],
    queryFn: () => api.get(`/admin/galleries${q ? `?q=${encodeURIComponent(q)}` : ''}`).then((r) => r.data),
    placeholderData: keepPreviousData,
    staleTime: 0,
  });
  const shown = rows.filter((g) => status === 'all' || g.status === status);
  const selected = rows.find((g) => g.id === selId) ?? null;
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2 py-3">
        <SearchBox label="갤러리 이름으로 찾기" value={q} onChange={setQ} className="w-full sm:w-[260px]" />
        <ChoiceLinks label="상태" value={status} onChange={setStatus} options={[
          { id: 'all', label: '전체', count: rows.length },
          { id: 'APPROVED', label: '승인', count: rows.filter((g) => g.status === 'APPROVED').length },
          { id: 'PENDING', label: '승인 대기', count: rows.filter((g) => g.status === 'PENDING').length },
          { id: 'REJECTED', label: '반려', count: rows.filter((g) => g.status === 'REJECTED').length },
        ]} />
      </div>
      {isLoading ? <div className="h-48 animate-pulse rounded-[10px] bg-gray-100" />
        : shown.length === 0 ? <EmptyLine>찾는 갤러리가 없어요.</EmptyLine>
        : (
          <div className={cn(wide && selected && 'grid grid-cols-[minmax(0,1fr)_400px] items-start gap-7')}>
            <div role="table" aria-label="갤러리" className="min-w-0 border-t border-gray-900">
              <div role="row" className="hidden grid-cols-[minmax(0,1fr)_88px_96px_64px] items-center gap-3.5 border-b border-gray-200 py-2.5 md:grid">
                <Th>갤러리</Th><Th>상태</Th><Th>공모 · 전시</Th><Th className="text-right">조회</Th>
              </div>
              {shown.map((g) => (
                <div role="row" key={g.id} aria-selected={g.id === selId}
                  className={cn('relative -mx-3 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3.5 border-b border-gray-100 px-3 py-2.5 hover:bg-gray-50 md:grid-cols-[minmax(0,1fr)_88px_96px_64px]', g.id === selId && 'bg-gray-100 hover:bg-gray-100')}>
                  <span role="cell" className="min-w-0">
                    <button type="button" onClick={() => setSelId(g.id)} className="block max-w-full truncate text-left text-[14.5px] font-semibold text-gray-950 after:absolute after:inset-0 after:content-['']">{g.name}</button>
                    <span className="block truncate text-[12.5px] text-gray-500">{regionLabels[g.region] ?? g.region} · {g.owner?.name ?? g.ownerName}</span>
                  </span>
                  <span role="cell" className={cn('text-[13px]', g.status === 'PENDING' ? 'font-semibold text-accent' : 'text-gray-700')}>{STATUS_LABEL[g.status] ?? g.status}</span>
                  <span role="cell" className="hidden text-[13px] tabular-nums text-gray-700 md:block">{g._count.exhibitions} · {g._count.shows}</span>
                  <span role="cell" className="hidden text-right text-[13px] tabular-nums text-gray-700 md:block">{g.viewCount ?? 0}</span>
                </div>
              ))}
            </div>
            {selected && (
              <DetailPane wide={wide} title={selected.name} onClose={() => setSelId(null)}>
                <GalleryDetail gallery={selected} onClose={() => setSelId(null)} showClose={wide} />
              </DetailPane>
            )}
          </div>
        )}
    </div>
  );
}

function GalleryDetail({ gallery, onClose, showClose }: { gallery: any; onClose: () => void; showClose: boolean }) {
  const qc = useQueryClient();
  const [confirmDel, setConfirmDel] = useState(false);
  const { data } = useQuery<any>({
    queryKey: ['ov-gallery-posts', gallery.id],
    queryFn: () => api.get(`/admin/galleries/${gallery.id}/posts`).then((r) => r.data),
    staleTime: 0,
  });
  const del = useMutation({
    mutationFn: () => api.delete(`/galleries/${gallery.id}`),
    onSuccess: () => {
      for (const k of [['ov-galleries'], ['galleries'], ['ov-exhibitions'], ADMIN_TODO_KEY]) qc.invalidateQueries({ queryKey: k as unknown as readonly unknown[] });
      toast.success('갤러리를 지웠어요.');
      onClose();
    },
    onError: (e: any) => toast.error(e.response?.data?.error || '지우지 못했어요.'),
  });
  return (
    <div data-testid="ov-gallery-detail">
      <div className="px-5 pb-3.5 pt-5">
        <div className="flex items-start justify-between gap-2">
          <p className="text-[12.5px] text-gray-600"><strong className="font-bold text-gray-950">{STATUS_LABEL[gallery.status] ?? gallery.status}</strong><span className="ml-2">{regionLabels[gallery.region] ?? gallery.region} · {shortDate(gallery.createdAt)} 등록</span></p>
          {showClose && <button type="button" onClick={onClose} aria-label="닫기" className="-mr-2 -mt-2 flex h-10 w-10 shrink-0 items-center justify-center text-gray-700"><svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M6 6l12 12" /><path d="M18 6L6 18" /></svg></button>}
        </div>
        <h3 className="mt-1.5 text-[19px] font-semibold tracking-tight text-gray-950">{gallery.name}</h3>
        {gallery.mainImage && <img src={gallery.mainImage} alt="" className="mt-3 aspect-[4/3] w-full bg-gray-100 object-contain" />}
        <p className="mt-2 flex flex-wrap gap-x-4 text-[13.5px]"><Link to={`/galleries/${gallery.id}`} className="inline-flex min-h-[40px] items-center underline underline-offset-4">갤러리 보기</Link></p>
        <dl className="mt-1 grid grid-cols-[76px_minmax(0,1fr)] gap-x-3 gap-y-2 text-[13.5px]">
          <dt className="text-gray-500">주인 계정</dt><dd className="min-w-0 break-all">{gallery.owner?.name} · {gallery.owner?.email}</dd>
          <dt className="text-gray-500">최근 접속</dt><dd>{seenText(gallery.owner?.lastSeenAt)}</dd>
          <dt className="text-gray-500">조회</dt><dd className="tabular-nums">{gallery.viewCount ?? 0} · 리뷰 {gallery._count?.reviews ?? 0}</dd>
        </dl>
      </div>
      {!data ? <div className="mx-5 mb-4 h-24 animate-pulse rounded-lg bg-gray-100" /> : (
        <div className="border-t border-gray-100 px-5 py-3.5">
          <h4 className="text-[13px] font-semibold text-gray-600">공모 {data.exhibitions.length}</h4>
          <ul className="mt-1">
            {data.exhibitions.map((e: any) => (
              <li key={e.id} className="flex items-center justify-between gap-2 border-b border-gray-100 py-2.5 last:border-0">
                <Link to={`/mypage?tab=oversight&ex=${e.id}`} className="min-w-0 truncate text-[13.5px] font-medium hover:underline">{e.title}</Link>
                <span className="shrink-0 text-[12.5px] tabular-nums text-gray-600">{STATUS_LABEL[e.status] ?? e.status} · 지원 {e._count.applications}</span>
              </li>
            ))}
            {data.exhibitions.length === 0 && <li className="py-2 text-[13px] text-gray-500">올린 공모가 없어요.</li>}
          </ul>
          <h4 className="mt-3 text-[13px] font-semibold text-gray-600">전시 {data.shows.length}</h4>
          <ul className="mt-1">
            {data.shows.map((s: any) => (
              <li key={s.id} className="flex items-center justify-between gap-2 border-b border-gray-100 py-2.5 last:border-0">
                <Link to={`/shows/${s.id}`} className="min-w-0 truncate text-[13.5px] font-medium hover:underline">{s.title}</Link>
                <span className="shrink-0 text-[12.5px] tabular-nums text-gray-600">{STATUS_LABEL[s.status] ?? s.status} · {shortDate(s.startDate)} – {shortDate(s.endDate)}</span>
              </li>
            ))}
            {data.shows.length === 0 && <li className="py-2 text-[13px] text-gray-500">올린 전시가 없어요.</li>}
          </ul>
        </div>
      )}
      <div className="flex justify-end border-t border-gray-100 px-5 py-1.5">
        <button type="button" onClick={() => setConfirmDel(true)} className="min-h-[44px] text-[13.5px] text-accent">갤러리 삭제</button>
      </div>
      <ConfirmDialog
        open={confirmDel}
        title="갤러리를 지울까요?"
        details={[`「${gallery.name}」와 그 갤러리의 공모 ${gallery._count.exhibitions}건 · 전시 ${gallery._count.shows}건 · 리뷰가 함께 사라져요.`, '되돌릴 수 없어요.']}
        confirmText="삭제"
        variant="danger"
        onConfirm={() => { setConfirmDel(false); del.mutate(); }}
        onCancel={() => setConfirmDel(false)}
      />
    </div>
  );
}

// ───────────────────────────── 전시 ─────────────────────────────

function ShowsView() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [confirm, setConfirm] = useState<any>(null);
  const { data: rows = [], isLoading } = useQuery<any[]>({
    queryKey: ['ov-shows', q],
    queryFn: () => api.get(`/admin/shows${q ? `?q=${encodeURIComponent(q)}` : ''}`).then((r) => r.data),
    placeholderData: keepPreviousData,
    staleTime: 0,
  });
  const del = useMutation({
    mutationFn: (id: number) => api.delete(`/shows/${id}`),
    onSuccess: () => {
      for (const k of [['ov-shows'], ['shows'], ADMIN_TODO_KEY]) qc.invalidateQueries({ queryKey: k as unknown as readonly unknown[] });
      toast.success('전시를 지웠어요.');
    },
    onError: (e: any) => toast.error(e.response?.data?.error || '지우지 못했어요.'),
  });
  return (
    <div>
      <div className="py-3"><SearchBox label="전시 제목으로 찾기" value={q} onChange={setQ} className="w-full sm:w-[260px]" /></div>
      {isLoading ? <div className="h-48 animate-pulse rounded-[10px] bg-gray-100" />
        : rows.length === 0 ? <EmptyLine>찾는 전시가 없어요.</EmptyLine>
        : (
          <div role="table" aria-label="전시" className="border-t border-gray-900">
            <div role="row" className="hidden grid-cols-[minmax(0,1fr)_88px_120px_56px_44px] items-center gap-3.5 border-b border-gray-200 py-2.5 md:grid">
              <Th>전시</Th><Th>상태</Th><Th>기간</Th><Th className="text-right">조회</Th><Th />
            </div>
            {rows.map((s) => (
              <div role="row" key={s.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3.5 border-b border-gray-100 py-2.5 md:grid-cols-[minmax(0,1fr)_88px_120px_56px_44px]">
                <span role="cell" className="min-w-0">
                  <Link to={`/shows/${s.id}`} className="block truncate text-[14.5px] font-semibold text-gray-950 hover:underline">{s.title}</Link>
                  <span className="block truncate text-[12.5px] text-gray-500">{s.gallery?.name} · {regionLabels[s.region] ?? s.region}<span className="md:hidden"> · {shortDate(s.startDate)} – {shortDate(s.endDate)}</span></span>
                </span>
                <span role="cell" className={cn('text-[13px]', s.status === 'PENDING' ? 'font-semibold text-accent' : 'text-gray-700')}>{STATUS_LABEL[s.status] ?? s.status}</span>
                <span role="cell" className="hidden text-[13px] tabular-nums text-gray-700 md:block">{shortDate(s.startDate)} – {shortDate(s.endDate)}</span>
                <span role="cell" className="hidden text-right text-[13px] tabular-nums text-gray-700 md:block">{s.viewCount}</span>
                <span role="cell" className="hidden md:block">
                  <button type="button" onClick={() => setConfirm(s)} aria-label={`${s.title} 삭제`} className="flex h-10 w-10 items-center justify-center text-gray-500 hover:text-accent">
                    <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /></svg>
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}
      <ConfirmDialog
        open={!!confirm}
        title="전시를 지울까요?"
        details={[`「${confirm?.title ?? ''}」을 지워요. 되돌릴 수 없어요.`]}
        confirmText="삭제"
        variant="danger"
        onConfirm={() => { const s = confirm; setConfirm(null); if (s) del.mutate(s.id); }}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
