import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { PenLine } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import { apiErrorMessage } from '@/lib/utils';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import TabManager, { type CommunityTab } from '@/components/community/TabManager';
import { PostCard, PostRow, type PostRowData } from '@/components/community/PostListItems';
import { authorLine } from '@/lib/postAuthor';
import { useAuthStore } from '@/stores/authStore';
import { setPostLoginRedirect } from '@/lib/postLoginRedirect';
import Pagination from '@/components/shared/Pagination';
import { pageCount, readPage } from '@/lib/pagination';
import { scrollToTarget } from '@/lib/scrollToTarget';

/**
 * 커뮤니티 (2026-11-13 다시 그림) — 작가·갤러리의 작업 이야기. 칼럼(필진 글)도 여기 **탭**으로 산다(따로 메뉴를 만들지 않았다).
 *
 * - 머리: `Community` + 한 줄 + [글쓰기]. 탭은 글자 버튼(DESIGN.md 5 — 알약 금지), 관리자가 만든다.
 * - 전체 탭 맨 위: **필진의 새 글**(필진 탭의 실명 글, 카드 3장). 없으면 띠째로 그리지 않는다.
 * - 목록 모양은 탭마다(`layout`): 목록형(제목·발췌·썸네일) / 카드형(표지·제목·발췌). 넓은 화면은 오른쪽에 이번 주 인기글.
 * - 휴대폰: [글쓰기]는 아래 탭바 위에 떠 있는 단추(스크롤해도 닿게).
 * - 정렬·필터·탭·**쪽**(`?page=`)은 **주소**에 둔다 — 글을 읽고 돌아오면 그대로(감사 S24). 기본값은 주소에 안 남긴다.
 *   목록은 [더 보기] 대신 **페이지 번호**(2026-11-13 사용자 요청) — 한 쪽 20개. 탭·정렬·필터를 바꾸면 1쪽으로.
 * - 관리자: 탭 관리 · 고정 · 남의 글 삭제(서버가 다시 막는다 — 화면에서 감추는 건 권한이 아니다).
 */
type Scope = 'all' | 'mine' | 'commented';
const PER_PAGE = 20;

export default function CommunityPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { isAuthenticated, user } = useAuthStore();
  const isAdmin = user?.role === 'ADMIN';
  const [searchParams, setSearchParams] = useSearchParams();
  const sort: 'recent' | 'popular' = searchParams.get('sort') === 'popular' ? 'popular' : 'recent';
  const rawScope = searchParams.get('scope');
  const scope: Scope = rawScope === 'mine' || rawScope === 'commented' ? rawScope : 'all';
  const tab = searchParams.get('tab') ?? '';
  const page = readPage(searchParams.get('page'));
  // 탭·정렬·필터를 바꾸면 1쪽부터
  const setParam = (key: string, value: string, def: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value === def) next.delete(key); else next.set(key, value);
      next.delete('page');
      return next;
    }, { replace: true });
  };
  const listTop = useRef<HTMLElement>(null);
  const scrollOnPage = useRef(false);
  // 쪽을 넘기면 — 뒤로 가기로 앞 쪽에 돌아올 수 있게 기록을 남기고(push), 목록 맨 위로
  const setPage = (n: number) => {
    scrollOnPage.current = true;
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (n <= 1) next.delete('page'); else next.set('page', String(n));
      return next;
    });
  };
  // ⚠️ 맨 위로는 **새 쪽이 그려진 뒤에** — 2쪽부터는 '필진의 새 글' 띠가 빠져 목록이 위로 올라가므로, 누른 순간에 재면 목록이 화면 위로 지나간다.
  // ⚠️ 부드럽게(smooth) 옮기지 말 것 — 옮기는 사이에 새 쪽 글이 와서 문서가 짧아지면 사파리는 애니메이션을 멈추고 끝으로 붙인다(실측: 목록이 화면 위로 152px 지나갔다)
  useLayoutEffect(() => {
    if (!scrollOnPage.current) return;
    scrollOnPage.current = false;
    scrollToTarget(listTop.current, 'instant' as ScrollBehavior);
  }, [page]);
  const setSort = (v: 'recent' | 'popular') => setParam('sort', v, 'recent');
  const setScope = (v: Scope) => setParam('scope', v, 'all');
  const setTab = (v: string) => setParam('tab', v, '');
  const [manageOpen, setManageOpen] = useState(false);
  const [delTarget, setDelTarget] = useState<PostRowData | null>(null);

  const { data: tabs } = useQuery<CommunityTab[]>({
    queryKey: ['community-tabs'],
    queryFn: () => api.get('/community/categories').then((r) => r.data),
  });
  const visibleTabs = (tabs ?? []).filter((t) => t.active || isAdmin);
  const current = visibleTabs.find((t) => t.slug === tab) ?? null;
  const layout = current?.layout === 'card' ? 'card' : 'list';

  const { data, isLoading, isPlaceholderData } = useQuery<{ posts: PostRowData[]; page: number; total: number; hasMore: boolean }>({
    queryKey: ['community', sort, scope, tab, page],
    queryFn: () => api.get('/community', {
      params: {
        sort,
        page,
        take: PER_PAGE,
        ...(tab ? { category: tab } : {}),
        ...(scope === 'mine' ? { mine: 'posts' } : scope === 'commented' ? { mine: 'comments' } : {}),
      },
    }).then((r) => r.data),
    // 쪽을 넘기는 동안 앞 쪽을 그대로 둔다(목록이 비었다가 다시 차며 화면이 튀지 않게)
    placeholderData: keepPreviousData,
  });
  const posts = data?.posts ?? [];
  const totalPages = pageCount(data?.total ?? 0, PER_PAGE);
  // 글이 지워져 쪽이 줄었으면(주소의 쪽이 끝보다 뒤) 마지막 쪽으로
  useEffect(() => {
    if (data && !isPlaceholderData && page > totalPages) {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (totalPages <= 1) next.delete('page'); else next.set('page', String(totalPages));
        return next;
      }, { replace: true });
    }
  }, [data, isPlaceholderData, page, totalPages, setSearchParams]);

  // 전체 탭 맨 위 — 필진의 새 글(필진 탭의 실명 글). 첫 쪽에서만
  const showWriters = !tab && scope === 'all' && page === 1;
  const { data: writers } = useQuery<{ posts: PostRowData[] }>({
    queryKey: ['community', 'writers-strip'],
    queryFn: () => api.get('/community', { params: { policy: 'writers', take: 3 } }).then((r) => r.data),
    enabled: showWriters,
  });
  const writerPosts = showWriters ? writers?.posts ?? [] : [];
  // 필진 탭이 여럿이면 '모두 보기'는 첫 필진 탭으로
  const firstWriterTab = (tabs ?? []).find((t) => t.active && t.writePolicy === 'writers');

  const { data: popular } = useQuery<{ id: number; title: string; author: { name: string; role: string | null; anonymous: boolean; mine: boolean }; commentCount: number; likeCount: number }[]>({
    queryKey: ['community-popular', 7],
    queryFn: () => api.get('/community/popular', { params: { days: 7, limit: 5 } }).then((r) => r.data),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['community'] });
    qc.invalidateQueries({ queryKey: ['community-popular'] });
  };
  const togglePin = useMutation({
    mutationFn: (p: PostRowData) => api.patch(`/community/${p.id}/pin`, { pinned: !p.pinned }),
    onSuccess: (_r, p) => { invalidate(); toast.success(p.pinned ? '고정을 해제했습니다.' : '맨 위에 고정했습니다.'); },
    onError: (e) => toast.error(apiErrorMessage(e, '고정 변경 실패')),
  });
  const removePost = useMutation({
    mutationFn: (id: number) => api.delete(`/community/${id}`),
    onSuccess: () => { invalidate(); setDelTarget(null); toast.success('글을 삭제했습니다.'); },
    onError: (e) => toast.error(apiErrorMessage(e, '삭제 실패')),
  });

  const goWrite = () => {
    const target = current?.canWrite ? `/community/write?tab=${current.slug}` : '/community/write';
    if (isAuthenticated) { navigate(target); return; }
    setPostLoginRedirect(target);
    toast('로그인이 필요해요.');
    navigate('/login');
  };

  const textBtn = (on: boolean) => `h-10 shrink-0 whitespace-nowrap text-[15px] ${on ? 'font-semibold text-gray-900 underline decoration-1 underline-offset-[7px]' : 'text-gray-500 hover:text-gray-900'}`;
  const emptyText = scope === 'mine' ? '작성한 글이 없어요.' : scope === 'commented' ? '댓글을 단 글이 없어요.' : current ? `‘${current.name}’ 탭에 아직 글이 없어요.` : '아직 글이 없어요. 첫 글을 남겨 보세요.';

  return (
    <div className="mx-auto max-w-7xl px-6 pb-28 pt-10 md:px-12 md:pb-20 md:pt-14">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-4xl text-gray-900 md:text-5xl">Community</h1>
          <p className="mt-2 text-base text-gray-500">작가와 갤러리가 나누는 작업 이야기</p>
        </div>
        <button type="button" onClick={goWrite} className="hidden h-11 items-center gap-2 rounded-lg bg-gray-900 px-5 text-[15px] font-semibold text-white hover:bg-gray-800 lg:inline-flex">
          <PenLine size={16} />글쓰기
        </button>
      </div>

      {/* 탭 — 글자 버튼, 좁은 화면은 옆으로 민다 */}
      <div className="-mx-6 mt-8 overflow-x-auto px-6 scrollbar-hide md:mx-0 md:px-0">
        <div role="tablist" aria-label="커뮤니티 탭" className="flex min-w-max items-center gap-6 border-b border-gray-200 pb-1.5">
          <button type="button" role="tab" aria-selected={tab === ''} onClick={() => setTab('')} className={textBtn(tab === '')}>전체</button>
          {visibleTabs.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.slug} onClick={() => setTab(t.slug)}
              title={t.active ? undefined : '숨긴 탭 (관리자에게만 보입니다)'} className={`${textBtn(tab === t.slug)} ${t.active ? '' : 'opacity-50'}`}>
              {t.name}
            </button>
          ))}
          {isAdmin && (
            <button type="button" onClick={() => setManageOpen(true)} className="h-10 shrink-0 text-[14px] text-gray-500 underline underline-offset-4 hover:text-gray-900">탭 관리</button>
          )}
        </div>
      </div>
      {current?.description && <p className="mt-4 break-keep text-[15px] leading-relaxed text-gray-600">{current.description}</p>}

      {/* 필진의 새 글 */}
      {writerPosts.length > 0 && (
        <section aria-label="필진의 새 글" className="mt-10">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-[18px] font-semibold text-gray-900">필진의 새 글</h2>
            {firstWriterTab && <Link to={`/community?tab=${firstWriterTab.slug}`} className="text-[14px] text-gray-500 underline underline-offset-4 hover:text-gray-900">모두 보기</Link>}
          </div>
          <div className="-mx-6 mt-5 flex gap-4 overflow-x-auto px-6 pb-1 scrollbar-hide md:mx-0 md:grid md:grid-cols-3 md:gap-7 md:overflow-visible md:px-0">
            {writerPosts.map((p) => (
              <div key={p.id} className="w-[72vw] max-w-[300px] shrink-0 md:w-auto md:max-w-none">
                <PostCard p={p} showTab />
              </div>
            ))}
          </div>
        </section>
      )}

      <div className={`flex flex-wrap gap-x-16 ${writerPosts.length > 0 ? 'mt-14 border-t border-gray-200 pt-6' : 'mt-6'}`}>
        <section ref={listTop} aria-label="글 목록" className="min-w-0 flex-[999_1_560px] scroll-mt-28">
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 border-b border-gray-100 pb-1">
            <div role="radiogroup" aria-label="정렬" className="flex gap-5">
              {(['recent', 'popular'] as const).map((s) => (
                <button key={s} type="button" role="radio" aria-checked={sort === s} onClick={() => setSort(s)} className={textBtn(sort === s)}>{s === 'recent' ? '최신' : '인기'}</button>
              ))}
            </div>
            {isAuthenticated && (
              <div className="flex gap-5">
                <button type="button" aria-pressed={scope === 'mine'} onClick={() => setScope(scope === 'mine' ? 'all' : 'mine')} className={textBtn(scope === 'mine')}>내 글</button>
                <button type="button" aria-pressed={scope === 'commented'} onClick={() => setScope(scope === 'commented' ? 'all' : 'commented')} className={textBtn(scope === 'commented')}>내 댓글</button>
              </div>
            )}
          </div>

          <div aria-busy={isPlaceholderData} className={`transition-opacity ${isPlaceholderData ? 'opacity-50' : ''}`}>
          {isLoading ? (
            <div className="space-y-6 py-6" role="status" aria-label="불러오는 중">{[0, 1, 2, 3].map((i) => <div key={i} className="h-20 animate-pulse bg-gray-100" />)}</div>
          ) : posts.length === 0 ? (
            <p className="py-20 text-center text-[15px] text-gray-500">{emptyText}</p>
          ) : layout === 'card' && scope === 'all' ? (
            <div className="grid grid-cols-1 gap-x-7 gap-y-12 pt-8 sm:grid-cols-2 xl:grid-cols-3">
              {posts.map((p) => <PostCard key={p.id} p={p} showTab={false} />)}
            </div>
          ) : (
            <ul>
              {posts.map((p) => (
                <PostRow key={p.id} p={p} showTab={!tab}
                  admin={isAdmin ? { onPin: () => togglePin.mutate(p), onDelete: () => setDelTarget(p) } : null} />
              ))}
            </ul>
          )}
          </div>
          {totalPages > 1 && (
            <div className="pt-8">
              <Pagination page={Math.min(page, totalPages)} total={totalPages} onChange={setPage} label="글 목록 페이지" />
            </div>
          )}
        </section>

        {/* 넓은 화면 — 이번 주 인기글 */}
        {popular && popular.length > 0 && (
          <aside aria-label="이번 주 인기글" className="hidden min-w-0 flex-[1_1_260px] pt-3 lg:block">
            <h2 className="text-[15px] font-semibold text-gray-900">이번 주 인기글</h2>
            <ol className="mt-3">
              {popular.map((p, i) => (
                <li key={p.id} className="flex gap-3 border-t border-gray-100 py-3">
                  <span className={`w-4 shrink-0 text-[14px] font-semibold ${i === 0 ? 'text-accent' : 'text-gray-400'}`}>{i + 1}</span>
                  <Link to={`/community/${p.id}`} className="min-w-0">
                    <span className="line-clamp-2 break-keep text-[14px] leading-snug text-gray-900 hover:underline [overflow-wrap:anywhere]">{p.title}</span>
                    <span className="mt-0.5 block text-[12px] text-gray-500">{authorLine(p.author)}</span>
                  </Link>
                </li>
              ))}
            </ol>
          </aside>
        )}
      </div>

      {/* 휴대폰 — 떠 있는 [글쓰기](아래 탭바 위) */}
      <button
        type="button"
        onClick={goWrite}
        className="fixed bottom-[calc(3.5rem+1px+env(safe-area-inset-bottom)+14px)] right-4 z-30 inline-flex h-12 items-center gap-2 rounded-full bg-gray-900 pl-4 pr-5 text-[15px] font-semibold text-white lg:hidden"
      >
        <PenLine size={17} />글쓰기
      </button>

      {manageOpen && <TabManager tabs={tabs ?? []} onClose={() => setManageOpen(false)} />}
      <ConfirmDialog
        open={!!delTarget}
        title="글 삭제"
        message={`“${delTarget?.title ?? ''}” 글을 삭제하시겠습니까? 댓글도 함께 사라집니다.`}
        confirmText="삭제"
        onConfirm={() => delTarget && removePost.mutate(delTarget.id)}
        onCancel={() => setDelTarget(null)}
      />
    </div>
  );
}
