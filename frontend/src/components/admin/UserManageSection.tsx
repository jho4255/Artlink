/**
 * 마이페이지(관리자) > 사용자 관리 — 2026-11-21 개편(CLAUDE.md 규칙 89).
 *
 * 예전: 쪽 나눔·정렬·수 없이 한 줄 106~124px 카드가 늘어섰다(작가 179명 ≈ 19,000px) · 글자의 91% 가 12px 회색 ·
 * 줄마다 역할 select 가 늘 보이고 고르는 즉시 바뀌었다(확인 없음) · 지원 이력은 [운영 조회]에 따로 있었다.
 *
 * 지금: 탭 [전체 · 아티스트 · 갤러리 · 일반 · 관리자 · 오늘 방문](수) · 찾기(치는 대로 — 이름·이메일·닉네임·@주소) ·
 * 걸러 보기(작품 없음 · 지원한 적 없음 · 이번 주 가입) · 정렬 · 50명씩.
 * 표: 회원 · 가입(방법) · 최근 접속 · 최근 7일(칸 일곱 — 단위는 '날'이다) · 작품 · 지원.
 * 줄을 누르면 회원 한 명(넓은 화면은 옆 칸, 좁은 화면은 창): 접속·방문 · 홈페이지 채운 정도 · 활동 · 지원 이력 · [역할 변경](확인창).
 * 다른 화면에서 그 회원을 찾아 들어온다 — `?tab=user-manage&role=<역할>&q=<이메일>`([신고 관리]의 ArtTalk 신고).
 */
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import { cn, roleLabel } from '@/lib/utils';
import { useAuthStore } from '@/stores/authStore';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { artistPath } from '@/lib/handle';
import { pageCount } from '@/lib/pagination';
import PageTabBar from '@/components/shared/PageTabBar';
import Pagination from '@/components/shared/Pagination';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import { AdminHead, ChoiceLinks, DetailPane, Dot, EmptyLine, SearchBox, Th } from '@/components/admin/AdminUi';
import { seenText, shortDate } from '@/lib/adminFormat';

type RoleTab = 'ALL' | 'ARTIST' | 'GALLERY' | 'VISITOR' | 'ADMIN' | 'TODAY';
type Filter = '' | 'noWorks' | 'neverApplied' | 'newThisWeek';
type Sort = 'recent' | 'lastSeen' | 'name';

const ROLE_TABS: { id: RoleTab; label: string }[] = [
  { id: 'ALL', label: '전체' },
  { id: 'ARTIST', label: '아티스트' },
  { id: 'GALLERY', label: '갤러리' },
  { id: 'VISITOR', label: '일반' },
  { id: 'ADMIN', label: '관리자' },
  { id: 'TODAY', label: '오늘 방문' },
];
const GALLERY_STATUS: Record<string, string> = { PENDING: '승인 대기', APPROVED: '승인', REJECTED: '반려', WITHDRAWN: '탈퇴' };

interface Row {
  id: number; email: string; name: string; nickname: string | null; handle: string | null; role: string; provider: string | null;
  createdAt: string; lastSeenAt: string | null; deletedAt: string | null;
  galleries: { id: number; name: string; status: string }[];
  works: number;
  applications: { total: number; accepted: number; pending: number; rejected: number };
  visitDays: boolean[]; visitDays7: number; todayFirstAt: string | null;
}
interface Paged { page: number; pageSize: number; total: number; counts: Record<string, number>; filterCounts: Record<string, number>; rows: Row[] }

function appsText(a: Row['applications']): string {
  if (!a.total) return '—';
  return a.accepted ? `${a.total} · 선정 ${a.accepted}` : String(a.total);
}

/** 지원 칸 — 수 · 선정, 검토 대기가 있으면 빨간 점(글자를 늘리면 칸을 넘친다) */
function AppsCell({ a }: { a: Row['applications'] }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {appsText(a)}
      {a.pending > 0 && <span className="inline-flex items-center gap-1 text-accent" title={`검토 대기 ${a.pending}건`}><Dot /><span className="sr-only">검토 대기 {a.pending}건</span></span>}
    </span>
  );
}

/** 최근 7일 — 칸 일곱(오늘이 오른쪽 끝). 단위는 '날' */
function Week({ days }: { days: boolean[] }) {
  const n = days.filter(Boolean).length;
  return (
    <span role="img" aria-label={`최근 7일 중 ${n}일 방문`} className="flex gap-[3px]">
      {days.map((on, i) => <span key={i} className={cn('h-4 w-2 rounded-[2px]', on ? 'bg-gray-800' : 'bg-gray-200')} />)}
    </span>
  );
}

export default function UserManageSection() {
  const [searchParams] = useSearchParams();
  const wide = useMediaQuery('(min-width: 1280px)');
  const tableWide = useMediaQuery('(min-width: 768px)');
  const linkedRole = ROLE_TABS.find((t) => t.id === searchParams.get('role'))?.id;
  const [role, setRole] = useState<RoleTab>(linkedRole ?? 'ARTIST');
  const [q, setQ] = useState((searchParams.get('q') ?? '').trim());
  const [filter, setFilter] = useState<Filter>('');
  const [sort, setSort] = useState<Sort>('recent');
  const [page, setPage] = useState(1);
  const [selId, setSelId] = useState<number | null>(null);

  const params = new URLSearchParams({ paged: '1', page: String(page), sort });
  if (role === 'TODAY') params.set('visited', 'today'); else if (role !== 'ALL') params.set('role', role);
  if (q) params.set('q', q);
  if (filter) params.set('filter', filter);
  const { data, isLoading, isFetching } = useQuery<Paged>({
    queryKey: ['admin-users', 'paged', params.toString()],
    queryFn: () => api.get(`/admin/users?${params.toString()}`).then((r) => r.data),
    placeholderData: keepPreviousData,
    staleTime: 0,
  });
  const rows = data?.rows ?? [];
  const counts = data?.counts ?? {};
  const fc = data?.filterCounts ?? {};
  // 걸러 보기는 작가에게만 뜻이 있다(작품 · 지원) — 이번 주 가입은 누구에게나
  const artistish = role === 'ARTIST' || role === 'ALL';
  const reset = () => { setPage(1); setSelId(null); };
  const selected = rows.find((u) => u.id === selId) ?? null;

  const table = (
    <div className="min-w-0">
      {tableWide ? (
        <div role="table" aria-label="회원" className="border-t border-gray-900">
          <div role="row" className="grid grid-cols-[minmax(0,1fr)_80px_88px_76px_44px_112px] items-center gap-3.5 border-b border-gray-200 py-2.5">
            <Th>회원</Th><Th>가입</Th><Th>최근 접속</Th><Th>최근 7일</Th><Th className="text-right">작품</Th><Th>지원</Th>
          </div>
          {rows.map((u) => (
            <div
              role="row"
              key={u.id}
              aria-selected={u.id === selId}
              className={cn('relative -mx-3 grid grid-cols-[minmax(0,1fr)_80px_88px_76px_44px_112px] items-center gap-3.5 border-b border-gray-100 px-3 py-2.5 hover:bg-gray-50', u.id === selId && 'bg-gray-100 hover:bg-gray-100')}
            >
              <span role="cell" className="min-w-0">
                <button type="button" onClick={() => setSelId(u.id)} className="block max-w-full truncate text-left text-[14.5px] font-semibold text-gray-950 after:absolute after:inset-0 after:content-['']">
                  {u.name}{u.nickname && u.nickname !== u.name && <span className="font-normal text-gray-500"> · {u.nickname}</span>}
                  {u.deletedAt && <span className="ml-1.5 text-[12.5px] font-normal text-gray-500">탈퇴</span>}
                </button>
                <span className="block truncate text-[12.5px] text-gray-500">{u.email}{role === 'ALL' || role === 'TODAY' ? ` · ${roleLabel(u.role)}` : ''}</span>
              </span>
              <span role="cell" className="whitespace-nowrap text-[13px] tabular-nums text-gray-700">
                {shortDate(u.createdAt)}<span className="block text-xs text-gray-500">{u.provider === 'KAKAO' ? '카카오' : '이메일'}</span>
              </span>
              <span role="cell" className={cn('whitespace-nowrap text-[13px] tabular-nums', u.lastSeenAt ? 'text-gray-700' : 'text-gray-500')}>{seenText(u.lastSeenAt)}</span>
              <span role="cell"><Week days={u.visitDays} /></span>
              <span role="cell" className={cn('text-right text-[13.5px] tabular-nums', u.role === 'ARTIST' && u.works === 0 ? 'font-semibold text-accent' : 'text-gray-950')}>
                {u.role === 'ARTIST' ? u.works : u.role === 'GALLERY' ? u.galleries.length : '—'}
              </span>
              <span role="cell" className="whitespace-nowrap text-[13px] tabular-nums text-gray-700">{u.role === 'ARTIST' ? <AppsCell a={u.applications} /> : u.role === 'GALLERY' ? `갤러리 ${u.galleries.length}` : '—'}</span>
            </div>
          ))}
        </div>
      ) : (
        <ul className="border-t border-gray-900" aria-label="회원">
          {rows.map((u) => (
            <li key={u.id} className="border-b border-gray-100">
              <button type="button" onClick={() => setSelId(u.id)} className="flex min-h-[76px] w-full items-center gap-3 py-2 text-left">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold text-gray-950">{u.name}{u.deletedAt && <span className="ml-1.5 text-[12.5px] font-normal text-gray-500">탈퇴</span>}</span>
                  <span className="block truncate text-[12.5px] tabular-nums text-gray-600">가입 {shortDate(u.createdAt)} · 접속 {seenText(u.lastSeenAt)}</span>
                  <span className="block text-[12.5px] tabular-nums text-gray-600">
                    {u.role === 'ARTIST'
                      ? <><span className={cn(u.works === 0 && 'font-semibold text-accent')}>작품 {u.works}</span> · 지원 {appsText(u.applications)}{u.applications.pending > 0 && <span className="text-accent"> · 검토 대기</span>}</>
                      : `${roleLabel(u.role)}${u.role === 'GALLERY' ? ` · 갤러리 ${u.galleries.length}` : ''}`}
                  </span>
                </span>
                <Week days={u.visitDays} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <span className="text-[13px] tabular-nums text-gray-600">{data ? `${(page - 1) * data.pageSize + (rows.length ? 1 : 0)}–${(page - 1) * data.pageSize + rows.length} / ${data.total}명` : ''}</span>
        <Pagination page={page} total={data ? pageCount(data.total, data.pageSize) : 1} onChange={(p) => { setPage(p); setSelId(null); window.scrollTo({ top: 0, behavior: 'instant' }); }} label="회원 쪽" />
      </div>
    </div>
  );

  return (
    <div>
      <AdminHead title="사용자 관리" />
      <div className="mt-3">
        <PageTabBar<RoleTab>
          sticky={false}
          idPrefix="admin-users"
          label="회원 종류"
          active={role}
          onSelect={(r) => { setRole(r); setFilter(''); reset(); }}
          tabs={ROLE_TABS.map((t) => ({ id: t.id, label: t.label, count: counts[t.id] ?? undefined }))}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2 py-3">
        <SearchBox label="이름·이메일·@주소로 찾기" value={q} onChange={(v) => { setQ(v); reset(); }} className="w-full sm:w-[280px]" />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <ChoiceLinks<Filter>
            label="걸러 보기"
            value={filter}
            onChange={(f) => { setFilter(f === filter ? '' : f); reset(); }}
            options={[
              { id: '', label: '모두' },
              ...(artistish ? [{ id: 'noWorks' as const, label: '작품 없음', count: fc.noWorks ?? null }, { id: 'neverApplied' as const, label: '지원한 적 없음', count: fc.neverApplied ?? null }] : []),
              { id: 'newThisWeek', label: '이번 주 가입', count: fc.newThisWeek ?? null },
            ]}
          />
          <span aria-hidden className="hidden h-4 w-px bg-gray-300 sm:block" />
          <label className="inline-flex min-h-[40px] items-center gap-1.5 text-sm text-gray-700">
            <span className="sr-only">정렬</span>
            <select value={sort} onChange={(e) => { setSort(e.target.value as Sort); reset(); }} disabled={role === 'TODAY'}
              className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm font-semibold text-gray-950">
              <option value="recent">최근 가입 순</option>
              <option value="lastSeen">최근 접속 순</option>
              <option value="name">이름 순</option>
            </select>
          </label>
        </div>
      </div>

      {isLoading ? <div className="h-64 animate-pulse rounded-[10px] bg-gray-100" />
        : rows.length === 0 ? <EmptyLine>{role === 'TODAY' && !q && !filter ? '오늘 들어온 회원이 아직 없어요.' : '찾는 회원이 없어요.'}</EmptyLine>
        : (
          <div className={cn(wide && selected ? 'grid grid-cols-[minmax(0,1fr)_352px] items-start gap-7' : '', isFetching && 'opacity-70')}>
            {table}
            {selected && (
              <DetailPane wide={wide} title={selected.name} onClose={() => setSelId(null)}>
                <UserDetail row={selected} onClose={() => setSelId(null)} showClose={wide} />
              </DetailPane>
            )}
          </div>
        )}
      <p className="mt-5 text-xs leading-relaxed text-gray-500">
        최근 7일은 하루 단위예요(같은 날 여러 번 들어와도 1일, 2026년 9월 28일부터 기록). 본인·다른 관리자 계정의 역할은 바꿀 수 없어요.
      </p>
    </div>
  );
}

function UserDetail({ row, onClose, showClose }: { row: Row; onClose: () => void; showClose: boolean }) {
  const qc = useQueryClient();
  const me = useAuthStore((s) => s.user);
  const [roleOpen, setRoleOpen] = useState(false);
  const [nextRole, setNextRole] = useState(row.role);
  const { data, isLoading } = useQuery<any>({
    queryKey: ['admin-user-summary', row.id],
    queryFn: () => api.get(`/admin/users/${row.id}/summary`).then((r) => r.data),
    staleTime: 0,
  });
  const roleMutation = useMutation({
    mutationFn: (role: string) => api.patch(`/admin/users/${row.id}/role`, { role }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-users'] });
      qc.invalidateQueries({ queryKey: ['admin-user-summary', row.id] });
      toast.success('역할을 바꿨어요.');
      setRoleOpen(false);
    },
    onError: (e: any) => toast.error(e.response?.data?.error || '역할을 바꾸지 못했어요.'),
  });
  const locked = me?.id === row.id || row.role === 'ADMIN';
  const u = data?.user;
  const hp = data?.homepage;
  const act = data?.activity;
  const homeHref = row.role === 'ARTIST' ? artistPath({ id: row.id, handle: row.handle }) : null;

  return (
    <div data-testid="admin-user-detail">
      <div className="px-5 pb-4 pt-5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[12.5px] text-gray-600">{roleLabel(row.role)} · 가입 {shortDate(row.createdAt)} · {row.provider === 'KAKAO' ? '카카오' : '이메일'}</p>
            <h3 className="mt-1 text-xl font-semibold tracking-tight text-gray-950">{row.name}</h3>
            <p className="mt-0.5 break-all text-[13px] text-gray-600">{row.email}</p>
          </div>
          {showClose && (
            <button type="button" onClick={onClose} aria-label="닫기" className="-mr-2 -mt-2 flex h-10 w-10 shrink-0 items-center justify-center text-gray-700">
              <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M6 6l12 12" /><path d="M18 6L6 18" /></svg>
            </button>
          )}
        </div>
        <p className="mt-2 flex flex-wrap gap-x-4 text-[13.5px]">
          {homeHref && <Link to={homeHref} className="inline-flex min-h-[40px] items-center underline underline-offset-4">홈페이지 보기</Link>}
          {row.galleries.map((g) => <Link key={g.id} to={`/galleries/${g.id}`} className="inline-flex min-h-[40px] items-center underline underline-offset-4">{g.name}</Link>)}
          <button type="button" onClick={() => { navigator.clipboard?.writeText(row.email).then(() => toast.success('이메일을 복사했어요.')).catch(() => {}); }} className="inline-flex min-h-[40px] items-center underline underline-offset-4">이메일 복사</button>
        </p>
      </div>

      {isLoading || !data ? <div className="mx-5 mb-5 h-40 animate-pulse rounded-lg bg-gray-100" /> : (
        <>
          <dl className="grid grid-cols-[76px_minmax(0,1fr)] gap-x-3 gap-y-2 border-t border-gray-100 px-5 py-3.5 text-[13.5px]">
            <dt className="text-gray-500">최근 접속</dt><dd className="text-gray-950">{seenText(u?.lastSeenAt)}</dd>
            <dt className="text-gray-500">방문</dt><dd className="text-gray-950">최근 7일 중 {data.visits.days7}일 · 30일 중 {data.visits.days30}일</dd>
            {hp && (
              <>
                <dt className="text-gray-500">홈페이지</dt>
                <dd className="text-gray-950">
                  4칸 중 {hp.filled}칸 채움
                  <span className="mt-0.5 block text-[12.5px] text-gray-600">
                    작품 {hp.works}점{hp.works > 0 && ` · 작품 정보 ${hp.captioned}점`} · {hp.hasStatement ? '작가노트 있음' : '작가노트 없음'} · {hp.hasBio ? '약력 있음' : '약력 없음'}
                  </span>
                </dd>
              </>
            )}
            <dt className="text-gray-500">활동</dt>
            <dd className="text-gray-950">좋아요 {act.likes} · 이웃 {act.following} · 소식 {act.stories} · 글 {act.posts}{row.role === 'ARTIST' ? ` · PDF 저장 ${act.exports}` : ''}</dd>
          </dl>

          {u?.galleries?.length > 0 && (
            <div className="border-t border-gray-100 px-5 py-3.5">
              <h4 className="text-[13px] font-semibold text-gray-600">갤러리 {u.galleries.length}곳</h4>
              <ul className="mt-1.5">
                {u.galleries.map((g: any) => (
                  <li key={g.id} className="flex items-center justify-between gap-2 border-b border-gray-100 py-2.5 last:border-0">
                    <Link to={`/galleries/${g.id}`} className="min-w-0 truncate text-[13.5px] font-medium hover:underline">{g.name}</Link>
                    <span className="shrink-0 text-[12.5px] text-gray-600">{GALLERY_STATUS[g.status] ?? g.status} · 공모 {g._count.exhibitions} · 전시 {g._count.shows}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {row.role === 'ARTIST' && (
            <div className="border-t border-gray-100 px-5 py-3.5">
              <h4 className="text-[13px] font-semibold text-gray-600">지원 이력 {data.applications.length}건</h4>
              {data.applications.length === 0 ? <p className="mt-1.5 text-[13px] text-gray-500">아직 지원한 공모가 없어요.</p> : (
                <ul className="mt-1">
                  {data.applications.map((a: any) => {
                    const pending = a.status === 'SUBMITTED' || a.status === 'REVIEWED';
                    return (
                      <li key={a.id} className="flex items-center justify-between gap-2.5 border-b border-gray-100 py-2.5 last:border-0">
                        <span className="min-w-0">
                          {a.exhibition
                            ? <Link to={`/mypage?tab=oversight&ex=${a.exhibition.id}`} className="block truncate text-[13.5px] font-medium hover:underline">{a.exhibition.title}</Link>
                            : <span className="block text-[13.5px] text-gray-500">(삭제된 공모)</span>}
                          <span className="block text-[12.5px] text-gray-500">{a.gallery?.name ?? (a.exhibition?.hostType === 'ADMIN' ? '아트링크 주최' : '—')} · {shortDate(a.appliedAt)} 지원{a.joinedVia === 'CODE' ? ' · 초대 코드' : ''}</span>
                        </span>
                        <span className={cn('shrink-0 text-[12.5px]', pending ? 'font-semibold text-accent' : a.status === 'ACCEPTED' ? 'font-semibold text-gray-950' : 'text-gray-500')}>
                          {pending && <Dot className="mr-1.5" />}{pending ? '검토 대기' : a.status === 'ACCEPTED' ? '선정' : '미선정'}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </>
      )}

      <div className="flex items-center justify-between gap-2 border-t border-gray-100 px-5 py-2">
        <span className="text-[13px] text-gray-600">역할 <strong className="font-semibold text-gray-950">{roleLabel(row.role)}</strong></span>
        {locked ? (
          <span className="text-[12.5px] text-gray-500">{me?.id === row.id ? '본인 역할은 바꿀 수 없어요' : '관리자 역할은 바꿀 수 없어요'}</span>
        ) : (
          <label className="inline-flex min-h-[44px] items-center gap-2 text-[13.5px] text-gray-700">
            역할 변경
            <select value={row.role} onChange={(e) => { setNextRole(e.target.value); setRoleOpen(true); }} className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm">
              <option value="ARTIST">아티스트</option>
              <option value="GALLERY">갤러리</option>
              <option value="VISITOR">일반</option>
              <option value="ADMIN">관리자</option>
            </select>
          </label>
        )}
      </div>
      <ConfirmDialog
        open={roleOpen}
        title="역할을 바꿀까요?"
        details={[
          `${row.name} 님을 ${roleLabel(row.role)} → ${roleLabel(nextRole)} 로 바꿔요.`,
          nextRole === 'ADMIN' ? '관리자가 되면 다른 관리자가 역할을 되돌릴 수 없어요.' : '그 역할의 메뉴와 권한으로 바로 바뀌어요.',
        ]}
        confirmText="바꾸기"
        variant={nextRole === 'ADMIN' ? 'danger' : undefined}
        onConfirm={() => roleMutation.mutate(nextRole)}
        onCancel={() => setRoleOpen(false)}
      />
    </div>
  );
}
