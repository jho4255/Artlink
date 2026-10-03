import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Plus, Upload } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import { useAuthStore } from '@/stores/authStore';
import { hasCaption, normalizeCareer } from '@/lib/artwork';
import { analyzePortfolio, aspectMap, dimsAspect, measureAspects } from '@/lib/artworkAnalysis';
import { artistPath } from '@/lib/handle';
import { editHref } from '@/lib/homepageEdit';
import { recommendDirections, type DesignDirection } from '@/lib/portfolioDirection';
import { cn } from '@/lib/utils';
import {
  PAGE_DIMS, PORTFOLIO_FONT_HREF, buildPortfolioPages, normalizePdfDesign, themeById,
  type PageKey, type PdfDesign, type PortfolioBookData,
} from '@/lib/portfolioFormats';
import {
  CUSTOMIZE_TABS, PAPER_OPTIONS, applyDirection, isCustomizeTab, nextSelectionName, pageIndexForTab, resetTab, statusLine, type CustomizeTab,
} from '@/lib/portfolioMaker';
import { versionDesign, versionWorks } from '@/lib/portfolioVersions';
import { thumbUrl } from '@/components/shared/Thumb';
import { useViewport } from '@/hooks/useViewport';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import TaskLine from '@/components/flow/TaskLine';
import MenuButton from '@/components/flow/MenuButton';
import type { Portfolio, PortfolioImage, PortfolioVersion } from '@/types';
import BookPreview, { PAGE_LABEL_H, type BookPreviewHandle } from './BookPreview';
import CustomizePanel, { SHEET_VH } from './CustomizePanel';
import DesignRow from './DesignRow';
import MakerBar from './MakerBar';
import PageViewer from './PageViewer';
import SaveDialog from './SaveDialog';
import WorkPicker from './WorkPicker';
import { useDesignAutosave } from './useDesignAutosave';

/**
 * 포트폴리오 PDF 만들기 (2026-10-03 개편) — `/mypage?tab=portfolio`
 *
 * ## 왜 다시 짰나
 * 기능(표지 15종 · 자동 배치 · 버전 · 세 가지 저장)은 다 있었는데 **처음 온 작가가 쓸 수 있는 화면이 아니었다**(2026-10-02 조사).
 *  - 첫 화면에 결과물도 저장 버튼도 없었다 — 프로필 카드 아래로 제목이 y409, [PDF 저장] y856, 미리보기 y894(PC 1280×800).
 *    휴대폰은 세부 설정 → 저장 → 추천 → 미리보기 순이라 표지를 골라도 화면 안에 미리보기가 한 장도 없었다.
 *  - 먼저 읽히는 말이 `기본 4점` `+ 버전` `글 0쪽 · CV 1쪽` `자동 편집 켜짐` `세부 싣지 않음` 이었다.
 *  - [PDF 저장] 은 파일이 아니라 인쇄 창을 열었고, 무엇이 찍히는지(닉네임·전화번호)는 저장한 뒤에야 알았다.
 *  - 실서버: 작품 있는 작가 47명 중 디자인을 바꿔 본 사람 1명, 버전 0개.
 *
 * ## 지금 (사용자 결정 여덟, `~/.claude/plans/portfolio-maker-ux.md`)
 *  - **미리보기가 주인공** — 들어오면 내 PDF 가 바로 보인다. 위에 용지·디자인 한 줄, 아래에 늘 붙어 있는 바 [꾸미기 · 작품 고르기 · PDF 저장].
 *  - **편집은 처음부터 보인다**(2026-10-03 사용자 결정 — 첫 판은 닫힌 채 시작했는데 "표지 고치기를 못 찾을 수도"). 넓은 화면은 오른쪽 패널이
 *    열린 채로, 좁은 화면은 아래 바 위에 탭 줄이 늘 있고 누르면 시트가 올라온다. 묶음을 바꾸면 미리보기가 그 쪽으로 따라온다.
 *  - **용지는 맨 위에서 따로** 고른다(가장 먼저 정할 것). 디자인 카드·[처음 상태로] 는 용지를 건드리지 않는다.
 *  - **한 탭의 옵션은 그 쪽만** 바꾼다 — [처음 상태로] 도 그 탭만 되돌린다(`resetTab`).
 *  - **[PDF 저장] → 저장 창** — 무엇이 실리는지 먼저 보여 주고, 누르면 파일이 바로 내려받아진다. 홈페이지에도 올릴 수 있다.
 *  - 이름은 실명이 기본, 연락처는 항목마다 켜고 끈다([이름·연락처]).
 *  - '버전' → **작품 고르기 / 구성**.
 *
 * ⚠️ 디자인은 고르는 즉시 저장된다(0.8초 모아서) — **디자인만** 보낸다(`PUT /portfolio/design`). 예전엔 색 하나를 바꿀 때마다
 *    약력·경력·파일까지 통째로 다시 보내, 다른 탭에서 고친 글이 옛 글로 되돌아갔다.
 * ⚠️ 훅은 전부 `return` 들보다 **위**에 둔다(React #310 — `__tests__/hooksBeforeReturn.test.ts`). 그래서 조회·빈 화면은 바깥 컴포넌트가,
 *    화면 본체는 `MakerScreen` 이 맡는다.
 */
const PAGE_LABELS: Record<PageKey, string> = { 'a4-portrait': '세로 A4', 'a4-landscape': '가로 A4', wide: '와이드 16:9', 'a5-portrait': '세로 A5' };
const MAX_SELECTIONS = 12;
const NO_VERSIONS: PortfolioVersion[] = [];
const LAST_TAB_KEY = 'artlink-pfm-tab';

const errText = (err: unknown, fallback: string) =>
  (err as { response?: { data?: { error?: string } } })?.response?.data?.error || fallback;

/** 마지막으로 연 편집 탭(이 브라우저의 편의일 뿐) */
function lastTab(): CustomizeTab {
  try { const s = window.localStorage.getItem(LAST_TAB_KEY); if (isCustomizeTab(s)) return s; } catch { /* 저장이 막힌 브라우저 */ }
  return 'cover';
}

/** [처음 상태로] 확인창 — 그 탭이 되돌리는 것과 **그대로인 것**을 함께 말한다(한 탭의 옵션은 그 쪽만 바꾼다) */
const RESET_DETAILS: Record<CustomizeTab, string[]> = {
  cover: ['표지 모양 · 표지 사진 · 표지에 넣을 글 · 크기가 처음 모양으로 돌아갑니다.', '작품·약력 쪽과 색·글꼴 · 용지는 그대로입니다.'],
  works: ['작품 배치(알아서 배치) · 작품 설명 · 작품 정보 위치와 순서 · 작품 목록 · 글 정렬이 처음 상태로 돌아갑니다.', '표지·약력 쪽과 색·글꼴 · 용지는 그대로입니다.'],
  cv: ['싣는 항목(전부 싣기) · 약력 자리(작품 뒤) · 경력 배치 · 영문 머리말 · 글 정렬 · 작가노트 사진이 처음 상태로 돌아갑니다.', '표지·작품 쪽과 색·글꼴 · 용지는 그대로입니다.'],
  style: ['글꼴 · 배경색 · 글자색 · 강조색이 처음 모양(흰 배경 · 검은 글자 · 명조)으로 돌아갑니다.', '용지와 각 쪽의 배치는 그대로입니다.'],
  info: [],
};

/**
 * 용지 — 화면 맨 위에서 **따로** 고른다(2026-10-03 사용자 결정 "가장 중요하니 처음부터 따로").
 * 예전엔 [색·글꼴] 탭 안에 있었고, 디자인 카드를 누르면 말없이 바뀌었다.
 * 좁은 화면(380px 미만)에서는 모양 그림을 빼 세 칸이 '용지' 글자와 한 줄에 든다.
 */
function PaperPicker({ value, onChange }: { value: PdfDesign['page']; onChange: (p: PdfDesign['page']) => void }) {
  const shape: Record<string, string> = { 'a4-portrait': 'h-3.5 w-2.5', 'a4-landscape': 'h-2.5 w-3.5', wide: 'h-2 w-4' };
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
      <span id="pfm-paper" className="text-sm font-semibold text-gray-950">용지</span>
      <div role="radiogroup" aria-labelledby="pfm-paper" className="inline-flex gap-0.5 rounded-lg bg-gray-100 p-0.5">
        {PAPER_OPTIONS.map((o) => {
          const on = o.key === value;
          return (
            <button
              key={o.key}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(o.key)}
              className={cn(
                'inline-flex min-h-[40px] items-center gap-1.5 whitespace-nowrap rounded-md px-2 text-sm min-[380px]:px-2.5',
                on ? 'bg-white font-semibold text-gray-950 ring-1 ring-gray-300' : 'text-gray-600 hover:text-gray-950',
              )}
            >
              <span aria-hidden className={cn('hidden rounded-[2px] border-[1.5px] min-[380px]:inline-block', shape[o.key], on ? 'border-gray-900' : 'border-gray-400')} />
              {o.label}
            </button>
          );
        })}
      </div>
      <span className="hidden text-xs text-gray-500 sm:inline">공모·갤러리에 낼 때는 대개 세로 A4</span>
    </div>
  );
}

function Heading() {
  // ArtLink 로고와 같은 색 규칙 — Port(검정) + Folio(빨강)
  return (
    <h2 className="font-serif text-xl font-bold tracking-tight text-gray-900 md:text-2xl">
      Port<span className="text-accent">Folio</span>
    </h2>
  );
}

export default function PortfolioMaker() {
  const { user, updateUser } = useAuthStore();
  const { data: portfolio, isLoading, isError, refetch } = useQuery<Portfolio>({
    queryKey: ['portfolio'],
    queryFn: () => api.get('/portfolio').then((r) => r.data),
  });

  // 마지막 장에 찍히는 값(이메일·전화번호·인스타·닉네임·프로필 사진)이다 — 로그인 때 받은 옛 값이면 화면이 말한 것과 다른 것이 찍힌다
  useEffect(() => {
    let alive = true;
    api.get('/auth/me').then(({ data }) => {
      const u = data?.user;
      if (!alive || !u) return;
      updateUser({ nickname: u.nickname, handle: u.handle ?? null, email: u.email, phone: u.phone, instagramUrl: u.instagramUrl, avatar: u.avatar ?? undefined });
    }).catch(() => { /* 못 받아도 로그인 때 값으로 만든다 */ });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (isError) {
    return (
      <div className="py-16 text-center">
        <p className="text-sm text-gray-500">포트폴리오 정보를 불러오지 못했습니다.</p>
        <button type="button" onClick={() => refetch()} className="mt-3 text-sm font-medium text-gray-900 underline underline-offset-4">다시 시도</button>
      </div>
    );
  }
  if (isLoading || !portfolio || !user) return <div className="h-64 animate-pulse bg-gray-100" />;

  // 작품이 없으면 만들 것이 없다 — 어디로 가면 되는지만 말한다
  if ((portfolio.images ?? []).length === 0) {
    return (
      <div className="pb-16" data-testid="portfolio-maker-empty">
        <Heading />
        <div className="mt-6 rounded-xl border border-gray-200 px-6 py-14 text-center">
          <p className="break-keep text-[15px] font-medium text-gray-950">작품을 올리면 포트폴리오 PDF 가 바로 만들어집니다.</p>
          <p className="mt-1.5 break-keep text-sm text-gray-500">홈페이지에 올린 작품과 글을 그대로 가져와 갤러리·공모에 낼 문서로 만들어 드려요.</p>
          <Link to={editHref('works')} className="mt-5 inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-gray-900 px-5 text-sm font-medium text-white hover:bg-gray-800">
            <Upload size={15} aria-hidden /> 작품 올리기
          </Link>
        </div>
      </div>
    );
  }
  return <MakerScreen portfolio={portfolio} user={user} />;
}

type Picker = { mode: 'new' } | { mode: 'edit'; id: number };
/** 로그인한 사람(스토어의 모양) — 이름·닉네임·연락처·프로필 사진이 문서에 찍힌다 */
type MakerUser = NonNullable<ReturnType<typeof useAuthStore.getState>['user']>;

function MakerScreen({ portfolio, user }: { portfolio: Portfolio; user: MakerUser }) {
  const queryClient = useQueryClient();
  const all: PortfolioImage[] = portfolio.images;
  const versions = portfolio.versions ?? NO_VERSIONS;

  // ── 구성(작품 선택) — 없으면 전체 작품을 홈페이지 순서로 ──
  const [versionId, setVersionId] = useState<number | null>(null);
  // 지워진 구성을 가리키고 있으면(다른 탭에서 지움) 자연히 전체 작품이 된다
  const version = versions.find((v) => v.id === versionId) ?? null;
  const images = useMemo(() => versionWorks(all, version), [all, version]);

  // ── 디자인 ──
  const [design, setDesign] = useState<PdfDesign>(() => normalizePdfDesign(portfolio.designConfig));
  const designRef = useRef(design);
  const versionRef = useRef<number | null>(null);
  // 다른 탭에서 지워진 구성 — 저장이 404 로 돌아오면 전체 작품으로 돌아간다(아래 effect 가 같은 일을 목록 갱신 때도 한다)
  const goneVersion = useRef<(id: number) => void>(() => {});
  const { state: saveState, schedule, flush: flushDesign, retry: retrySave } = useDesignAutosave((id) => goneVersion.current(id));
  /** 방금 한꺼번에 바꾼 것(디자인 줄 · 처음 상태로) — 바로 되돌릴 수 있게 그 전 값을 들고 있는다. 다른 것을 만지면 사라진다.
   *  `where` — 되돌리기 줄을 어디에 보일까(디자인 줄은 위, [처음 상태로] 는 그 패널 맨 아래 — 누른 자리 옆에) */
  const [undo, setUndo] = useState<{ label: string; design: PdfDesign; where: 'row' | 'panel' } | null>(null);

  const commit = useCallback((next: PdfDesign) => {
    designRef.current = next;
    setDesign(next);
    schedule(next, versionRef.current);
  }, [schedule]);
  const patch = useCallback((p: Partial<PdfDesign>) => {
    setUndo(null);
    commit({ ...designRef.current, ...p });
  }, [commit]);
  const pickDirection = (d: DesignDirection) => {
    const before = designRef.current;
    commit(applyDirection(before, d));   // 용지는 그대로
    setUndo({ label: `'${d.name}' 디자인으로 바꿨어요.`, design: before, where: 'row' });
  };
  /** 그 탭의 값만 처음 상태로 — 다른 탭·용지·이름·연락처는 그대로 */
  const resetDesign = (tab: CustomizeTab) => {
    const before = designRef.current;
    commit(resetTab(before, tab));
    const name = CUSTOMIZE_TABS.find((t) => t.id === tab)?.label ?? '';
    setUndo({ label: `'${name}'을 처음 상태로 돌렸어요.`, design: before, where: 'panel' });
  };
  /** 용지 — 맨 위에서 따로 고른다. 되돌리기 줄을 지우지 않는다(용지는 디자인이 아니다) */
  const setPaper = (page: PdfDesign['page']) => {
    if (designRef.current.page === page) return;
    commit({ ...designRef.current, page });
  };
  const undoDesign = () => {
    if (!undo) return;
    commit(undo.design);
    setUndo(null);
  };

  const selectVersion = (id: number | null, opts: { flush?: boolean } = {}) => {
    if (opts.flush !== false) void flushDesign();   // 지금 구성의 변경을 먼저 보낸다
    const latest = queryClient.getQueryData<Portfolio>(['portfolio']) ?? portfolio;
    const v = (latest.versions ?? []).find((x) => x.id === id) ?? null;
    const next = normalizePdfDesign(versionDesign(v, latest.designConfig));
    versionRef.current = v ? v.id : null;
    designRef.current = next;
    setDesign(next);
    setVersionId(v ? v.id : null);
    setUndo(null);
  };

  /**
   * 보던 구성이 **다른 곳에서 지워졌다** — 다른 탭·다른 기기에서 지운 뒤 목록이 새로 왔거나, 저장이 404 로 돌아왔을 때.
   * 그대로 두면 화면은 '전체 작품'(목록에 없으니)을 보이면서 디자인은 지워진 구성의 것이고, 고칠 때마다 지워진 구성으로 보내 404 에 갇힌다.
   * 전체 작품과 그 디자인으로 돌아간다. ⚠️ 남은 변경을 먼저 보내지 않는다(flush:false) — 지워진 구성으로 또 가거나, 그 디자인이 전체 작품에 덮인다.
   */
  const dropGoneVersion = (id: number) => {
    if (versionRef.current !== id) return;
    selectVersion(null, { flush: false });
    toast('보던 구성이 다른 곳에서 지워져 전체 작품으로 돌아왔어요.');
    queryClient.invalidateQueries({ queryKey: ['portfolio'] });
  };
  goneVersion.current = dropGoneVersion;
  // ⚠️ '목록에 없다' 만으로 판정하지 말 것 — 방금 만든 구성은 목록 캐시보다 선택이 먼저 반영될 수 있다(캐시 알림은 한 박자 늦게 온다).
  //    **목록에 한 번 나타났다가 사라진** 것만 지워진 것으로 본다.
  const seenVersions = useRef(new Set<number>());
  useEffect(() => {
    for (const v of versions) seenVersions.current.add(v.id);
    if (versionId != null && seenVersions.current.has(versionId) && !versions.some((v) => v.id === versionId)) dropGoneVersion(versionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versions, versionId]);

  // ── 책 데이터 — 미리보기·크게 보기·저장이 **같은 객체**를 쓴다(그래야 본 그대로 저장된다) ──
  // 사진 비율은 서버가 업로드 때 잰 값을 쓰고(대부분), 없는 사진만 작은 썸네일로 잰다 — 예전엔 비율을 재려고 원본을 전부 받았다
  const urlKey = images.map((w) => w.url).join('|');
  const [aspectV, setAspectV] = useState(0);
  useEffect(() => {
    let alive = true;
    const unknown = images.filter((w) => !dimsAspect(w)).map((w) => w.url);
    measureAspects(unknown, (u) => thumbUrl(u, 'grid')).then((changed) => { if (alive && changed) setAspectV((v) => v + 1); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlKey]);
  const homepageUrl = `${window.location.origin}${artistPath(user)}`;
  const base = useMemo(() => ({
    user: { name: user.name, nickname: user.nickname, email: user.email, phone: user.phone, instagramUrl: user.instagramUrl, avatar: user.avatar },
    homepageUrl,
    tagline: portfolio.tagline, statement: portfolio.statement, biography: portfolio.biography,
    career: portfolio.career, seriesInfo: portfolio.seriesInfo,
  }), [user.name, user.nickname, user.email, user.phone, user.instagramUrl, user.avatar, homepageUrl,
    portfolio.tagline, portfolio.statement, portfolio.biography, portfolio.career, portfolio.seriesInfo]);
  const book = useMemo<PortfolioBookData>(
    () => ({ ...base, images, aspects: aspectMap(images) }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [base, images, aspectV],
  );

  const pages = useMemo(() => buildPortfolioPages(book, themeById('archive'), { design, preview: true }), [book, design]);
  const recs = useMemo(() => recommendDirections(analyzePortfolio({
    images, seriesInfo: base.seriesInfo, statement: base.statement, biography: base.biography,
    careerCount: Object.values(normalizeCareer(base.career)).reduce((n, l) => n + l.length, 0),
    aspects: book.aspects,
  })), [images, base, book.aspects]);
  /** 작품 고르기 창의 "약 M쪽" — 미리보기와 같은 엔진으로 센다 */
  const countPages = useCallback((ids: number[]) => {
    const picked = versionWorks(all, { workIds: ids } as PortfolioVersion);
    return buildPortfolioPages({ ...base, images: picked, aspects: aspectMap(picked) }, themeById('archive'), { design: designRef.current }).length;
  }, [all, base]);

  // 포트폴리오용 한글 웹폰트 — 이 화면에서만 받는다
  useEffect(() => {
    const id = 'portfolio-webfonts';
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id = id; link.rel = 'stylesheet'; link.href = PORTFOLIO_FONT_HREF;
    document.head.appendChild(link);
  }, []);

  // ── 꾸미기 · 창들 ──
  const vp = useViewport();
  const wide = vp.w >= 1024;
  // 넓은 화면은 편집 패널을 **연 채로** 시작한다(2026-10-03 사용자 결정). 좁은 화면은 아래 바의 탭 줄이 늘 보이고, 누르면 시트가 열린다
  const [customize, setCustomize] = useState<CustomizeTab | null>(() => (window.innerWidth >= 1024 ? lastTab() : null));
  // 창 폭이 바뀌어 패널 ↔ 시트가 갈리면 그에 맞춘다 — 넓어지면 패널을 열고, 좁아지면 화면 절반을 덮는 시트로 바뀌지 않게 닫는다
  const wasWide = useRef(wide);
  useEffect(() => {
    if (wasWide.current === wide) return;
    wasWide.current = wide;
    setCustomize(wide ? lastTab() : null);
  }, [wide]);
  const [viewer, setViewer] = useState<number | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [picker, setPicker] = useState<Picker | null>(null);
  /** [처음 상태로] 를 누른 탭 — 확인창이 그 탭의 이름으로 묻는다 */
  const [resetFor, setResetFor] = useState<CustomizeTab | null>(null);
  /** 지우려는 구성 — 확인창은 작품 고르기 창을 **닫고** 띄운다(확인창이 그 창 뒤에 깔린다). 취소하면 고르던 창으로 돌아간다 */
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const previewRef = useRef<BookPreviewHandle>(null);

  /** 탭을 누를 때마다 하나씩 — 미리보기를 그 탭의 쪽으로 데려가라는 신호. 이미 고른 탭을 다시 눌러도(예: [표지 고치기]) 데려간다 */
  const [scrollReq, setScrollReq] = useState(0);
  const openCustomize = (tab?: CustomizeTab) => {
    const next = tab ?? lastTab();
    try { window.localStorage.setItem(LAST_TAB_KEY, next); } catch { /* 편의일 뿐이다 */ }
    setCustomize(next);
    setScrollReq((n) => n + 1);
  };
  // 탭을 누르면 미리보기를 그 탭이 바꾸는 쪽으로 — **누를 때만**(디자인을 고칠 때마다 움직이면 보던 자리를 잃는다)
  // ⚠️ 들어올 때(넓은 화면은 패널이 연 채로 시작한다)는 움직이지 않는다 — 움직이면 맨 위의 용지·디자인이 첫 화면 밖으로 밀려난다.
  //    판정은 '누른 횟수'(scrollReq)다. 처음엔 0 이라 개발 모드(StrictMode)가 effect 를 두 번 돌려도 움직이지 않는다(규칙 61).
  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  useEffect(() => {
    if (scrollReq === 0 || !customize) return;
    const i = pageIndexForTab(pagesRef.current, customize);
    if (i == null) return;
    // 꾸미기를 열면 한 쪽이 통째로 보이게 미리보기가 줄어든다 — 그 뒤에 데려간다
    const t = window.setTimeout(() => previewRef.current?.scrollToPage(i), 80);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollReq]);

  // ── 구성 저장 ──
  const patchCache = (fn: (vs: PortfolioVersion[]) => PortfolioVersion[]) =>
    queryClient.setQueryData<Portfolio>(['portfolio'], (old) => (old ? { ...old, versions: fn(old.versions ?? []) } : old));
  const createVersion = useMutation({
    mutationFn: (body: { name: string; workIds: number[]; design: PdfDesign }) =>
      api.post('/portfolio/versions', body).then((r) => r.data as PortfolioVersion),
    onSuccess: (v) => {
      // 캐시에 먼저 넣는다 — 재조회가 끝나기 전에 고르면 그 구성이 아직 목록에 없어 '전체 작품'으로 번쩍인다
      patchCache((vs) => [...vs, v]);
      versionRef.current = v.id;
      setVersionId(v.id);
      setPicker(null);
      queryClient.invalidateQueries({ queryKey: ['portfolio'] });
    },
    onError: (err) => toast.error(errText(err, '구성을 저장하지 못했습니다.')),
  });
  const updateVersion = useMutation({
    mutationFn: ({ id, ...body }: { id: number; name: string; workIds: number[] }) => api.patch(`/portfolio/versions/${id}`, body),
    onSuccess: (_r, vars) => {
      patchCache((vs) => vs.map((x) => (x.id === vars.id ? { ...x, name: vars.name, workIds: vars.workIds } : x)));
      setPicker(null);
      queryClient.invalidateQueries({ queryKey: ['portfolio'] });
    },
    onError: (err) => toast.error(errText(err, '구성을 저장하지 못했습니다.')),
  });
  const deleteVersion = useMutation({
    mutationFn: (id: number) => api.delete(`/portfolio/versions/${id}`),
    onSuccess: (_r, id) => {
      setDeleteId(null);
      if (versionRef.current === id) selectVersion(null);
      patchCache((vs) => vs.filter((x) => x.id !== id));
      queryClient.invalidateQueries({ queryKey: ['portfolio'] });
    },
    onError: (err) => { setDeleteId(null); toast.error(errText(err, '구성을 지우지 못했습니다.')); },
  });

  const dims = PAGE_DIMS[design.page] ?? PAGE_DIMS['a4-portrait'];
  const sizeLabel = PAGE_LABELS[design.page] ?? '세로 A4';
  const noInfo = images.filter((w) => !hasCaption(w)).length;
  const home = artistPath(user);
  const editing = picker?.mode === 'edit' ? versions.find((v) => v.id === picker.id) ?? null : null;
  const deleting = deleteId != null ? versions.find((v) => v.id === deleteId) ?? null : null;
  const full = versions.length >= MAX_SELECTIONS;

  // 꾸미기를 연 동안에는 한 쪽이 통째로 보이게 — 넓은 화면은 상단바·아래 바를 뺀 높이, 좁은 화면은 시트 위에 남는 높이
  // (상단바 · 쪽 머리의 여백 12 · 이름 줄 · 아래 여유 12 를 뺀다. 넓은 화면은 아래 바 68px 도)
  const fitHeight = !customize ? null
    : wide ? Math.max(260, vp.h - 80 - 12 - PAGE_LABEL_H - 68 - 12)
    : Math.max(150, vp.h * (1 - SHEET_VH) - 64 - 12 - PAGE_LABEL_H - 12);
  const sheetOpen = !!customize && !wide;

  return (
    <div data-testid="portfolio-maker" style={sheetOpen ? { paddingBottom: `${SHEET_VH * 100}vh` } : undefined}>
      {/* ── 머리 ── 무엇을 하는 화면인지 한 문장, 지금 상태 한 줄. 제목은 브랜드 이름(로고 규칙) */}
      {/* ⚠️ 머리는 낮게 — 여기가 높아지는 만큼 미리보기가 첫 화면 밖으로 밀린다(하니스 ①: 아이폰 SE 에서 표지가 2px 만 보였다).
          그래서 좁은 화면에는 설명을 한 문장만, 할 일은 판 없는 한 줄(`compact`)로 상태 옆에 둔다 */}
      <header className="mb-2 sm:mb-3">
        <div className="flex items-center justify-between gap-3">
          <Heading />
          {/* 작품·글은 홈페이지에서 가져온다 — 더하거나 고치러 가는 길. '내용 고치기' 는 무엇을 하는 곳인지 안 읽혔다(2026-10-03 사용자 지적) */}
          <Link to={editHref()} className="inline-flex min-h-[40px] shrink-0 items-center gap-1 rounded-lg border border-gray-300 pl-2.5 pr-2 text-sm font-medium text-gray-900 hover:bg-gray-50">
            <Plus size={14} aria-hidden /> 작품·글 추가·수정 <ChevronRight size={14} aria-hidden className="text-gray-500" />
          </Link>
        </div>
        <PaperPicker value={design.page} onChange={setPaper} />
        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-0.5">
          <p className="text-sm text-gray-600" data-testid="maker-status">
            <b className="font-semibold tabular-nums text-gray-950">{statusLine(images.length, pages.length)}</b>
          </p>
          {/* 저장해 둔 구성이 있을 때만 — 없으면 고를 것이 없다(아래 바의 [작품 고르기] 로 만든다) */}
          {versions.length > 0 && (
            <MenuButton
              align="left"
              label={version ? `${version.name} · ${images.length}점` : `전체 작품 · ${all.length}점`}
              items={[
                { id: 'all', label: `전체 작품 ${all.length}점`, hint: '홈페이지 순서 그대로', onSelect: () => selectVersion(null) },
                ...versions.map((v) => ({ id: `v${v.id}`, label: `${v.name} · ${versionWorks(all, v).length}점`, onSelect: () => selectVersion(v.id) })),
                { id: 'new', label: '+ 새 구성 만들기', hint: full ? `${MAX_SELECTIONS}개까지 만들 수 있어요` : '지금 구성에서 작품을 골라 따로 저장', disabled: full, onSelect: () => setPicker({ mode: 'new' }) },
              ]}
            />
          )}
          {noInfo > 0 && (
            <TaskLine
              compact
              to={editHref('works', { info: true })}
              // 무엇이 없는지가 아니라 **PDF 에서 어떻게 되는지**를 말한다 — 그림만 실리고 캡션이 빠진다
              task={{ tone: 'attention', text: `작품 ${noInfo}점이 제목·재료 없이 실려요`, action: '작품 정보 채우기' }}
            />
          )}
        </div>
      </header>

      <DesignRow book={book} design={design} recs={recs} onPick={pickDirection} undo={undo?.where === 'row' ? { label: undo.label } : null} onUndo={undoDesign} />

      {/* ⚠️ 이 줄에 items-start 를 주지 않는다 — 오른쪽 열이 제 내용 높이로 줄면 그 안의 sticky 패널이 따라올 여지가 없다 */}
      <div className="mt-3 sm:mt-4 lg:flex lg:gap-6">
        <div className="min-w-0 flex-1">
          <BookPreview
            ref={previewRef}
            pages={pages}
            pageW={dims.w}
            pageH={dims.h}
            fitHeight={fitHeight}
            tailRoom={!!customize && wide}
            onOpen={setViewer}
            onEditCover={() => openCustomize('cover')}
            onEditInfo={() => openCustomize('info')}
          />
        </div>
        {customize && (
          <CustomizePanel
            wide={wide}
            tab={customize}
            onTab={openCustomize}
            onClose={() => setCustomize(null)}
            onReset={setResetFor}
            undo={undo?.where === 'panel' ? { label: undo.label } : null}
            onUndo={undoDesign}
            design={design}
            patch={patch}
            book={book}
            works={images}
          />
        )}
      </div>

      <MakerBar
        customizing={!!customize}
        onCustomize={() => (customize ? setCustomize(null) : openCustomize())}
        onTab={openCustomize}
        onPickWorks={() => setPicker(version ? { mode: 'edit', id: version.id } : { mode: 'new' })}
        selected={images.length}
        total={all.length}
        saveState={saveState}
        onRetrySave={retrySave}
        onSave={() => setSaveOpen(true)}
      />

      {viewer != null && (
        <PageViewer
          book={book}
          design={design}
          pageW={dims.w}
          pageH={dims.h}
          index={viewer}
          onIndex={setViewer}
          onClose={() => setViewer(null)}
          onSave={() => { setViewer(null); setSaveOpen(true); }}
        />
      )}

      {saveOpen && (
        <SaveDialog
          book={book}
          design={design}
          pages={pages.length}
          works={images.length}
          sizeLabel={sizeLabel}
          currentFileUrl={portfolio.portfolioFileUrl ?? null}
          homePath={home}
          userId={user.id}
          beforeExport={flushDesign}
          onUploaded={(url) => {
            queryClient.setQueryData<Portfolio>(['portfolio'], (old) => (old ? { ...old, portfolioFileUrl: url } : old));
            queryClient.invalidateQueries({ queryKey: ['portfolio'] });
          }}
          onEditInfo={() => { setSaveOpen(false); openCustomize('info'); }}
          onPickWorks={() => { setSaveOpen(false); setPicker(version ? { mode: 'edit', id: version.id } : { mode: 'new' }); }}
          onClose={() => setSaveOpen(false)}
        />
      )}

      {picker && (
        <WorkPicker
          key={picker.mode === 'edit' ? `e${picker.id}` : 'new'}
          all={all}
          mode={picker.mode}
          // 새 구성은 **지금 보고 있는 선택**에서 시작한다(전체에서 시작하면 '전체 작품', 저장한 구성에서 시작하면 그 구성의 사본)
          initial={picker.mode === 'edit' ? (editing?.workIds ?? []) : images.map((w) => w.id)}
          initialName={picker.mode === 'edit' ? (editing?.name ?? '') : nextSelectionName(versions)}
          saving={createVersion.isPending || updateVersion.isPending}
          countPages={countPages}
          onApply={({ ids, name }) => {
            if (picker.mode === 'edit') { updateVersion.mutate({ id: picker.id, name, workIds: ids }); return; }
            if (full) { toast.error(`구성은 ${MAX_SELECTIONS}개까지 만들 수 있어요. 안 쓰는 구성을 지워 주세요.`); return; }
            createVersion.mutate({ name, workIds: ids, design: designRef.current });
          }}
          onDelete={picker.mode === 'edit' ? () => { setDeleteId(picker.id); setPicker(null); } : undefined}
          onClose={() => setPicker(null)}
        />
      )}

      <ConfirmDialog
        open={!!resetFor}
        title={`'${CUSTOMIZE_TABS.find((t) => t.id === resetFor)?.label ?? ''}'을 처음 상태로 돌릴까요?`}
        details={resetFor ? RESET_DETAILS[resetFor] : []}
        confirmText="처음 상태로"
        onConfirm={() => { const t = resetFor; setResetFor(null); if (t) resetDesign(t); }}
        onCancel={() => setResetFor(null)}
      />
      <ConfirmDialog
        open={!!deleting}
        title="이 구성을 지울까요?"
        details={[
          `'${deleting?.name ?? ''}' 의 작품 선택·순서·디자인이 사라집니다.`,
          '작품과 홈페이지는 그대로입니다.',
        ]}
        confirmText="지우기"
        variant="danger"
        onConfirm={() => { if (deleting) deleteVersion.mutate(deleting.id); }}
        onCancel={() => { const id = deleteId; setDeleteId(null); if (id != null) setPicker({ mode: 'edit', id }); }}
      />
    </div>
  );
}
