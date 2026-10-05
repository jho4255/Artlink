import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, ExternalLink, Eye } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import { useAuthStore } from '@/stores/authStore';
import { normalizeCareer, seriesNames } from '@/lib/artwork';
import { computeCompleteness, type CompletenessItem } from '@/lib/completeness';
import {
  EDIT_SECTIONS, entryInfoImageId, previewTabFor, resolveEditEntry, sectionDone, uncaptionedCount,
  type EditEntry, type EditField, type EditFocus, type EditSectionId,
} from '@/lib/homepageEdit';
import {
  DEFAULT_THEME_KEYS, WEB_THEME_FLAG, resolveHomepageTheme, themeKeysFrom, themeSavePatch, type HomepageThemeKeys,
} from '@/lib/homepageTheme';
import { artistPath, artistUrl, normalizeHandle, suggestHandle, validateHandle } from '@/lib/handle';
import { normalizePdfDesign } from '@/lib/portfolioFormats';
import { cn } from '@/lib/utils';
import { useCareerColumns } from '@/hooks/useCareerColumns';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import PageTabBar from '@/components/shared/PageTabBar';
import HomepageView from '@/components/shared/HomepageView';
import CompletenessLine from '@/components/shared/CompletenessLine';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import WorksSection from './WorksSection';
import PreviewSheet from './PreviewSheet';
import { CvSection, FileSection, IntroSection, StyleSection, fieldId } from './sections';
import type { Career, Portfolio, PortfolioImage } from '@/types';
import { EMPTY_CAREER } from '@/types';

/**
 * 작가 홈페이지 편집 화면 (2026-10-02 개편) — `/mypage?tab=homepage-edit`
 *
 * ## 왜 다시 짰나
 * 한 장짜리 긴 폼이었다: 스타일 → 약력(필수) → 작가노트 → 한 줄 소개 → 경력 5칸 → 파일 → **작품(맨 끝)**.
 * 가입 직후 도착한 작가의 첫 화면에 작품 올리기가 없었고(PC 2,518px · 모바일 2,747px 아래), 모바일에서는 [저장] 바가
 * 하단 탭바에 가려 페이지 맨 끝에서만 보였으며, 약력을 안 쓰면 한 줄 소개조차 저장되지 않았다.
 * 실서버 작가 97명 중 작품 0점 50명 · 작품이 있는 47명 중 작품 정보가 전부 빈 작가 38명 · 작가노트 8명.
 *
 * ## 지금
 *  - **묶음 다섯** [작품 · 소개 · 약력 · 파일 · 꾸미기] — 홈페이지 탭과 같은 순서, 작품이 첫 화면(`lib/homepageEdit.ts`).
 *    묶음을 오가도 쓰던 글은 남는다(값은 전부 여기서 들고 있다). 채운 묶음엔 ✓.
 *  - **저장은 한 곳** — 맨 아래 바. 글·꾸미기·주소가 함께 저장되고, 저장하면 공개 홈페이지의 그 탭으로 간다(규칙 31).
 *    사진·작품 정보·[작가] 탭 소개·순서는 누르는 즉시 저장된다 — 바가 그렇게 말해 준다.
 *    고친 게 없으면 [저장] 대신 [내 홈페이지 보기] 가 놓인다(저장할 게 없는데 저장 버튼이 있으면 눌러야 하나 싶다).
 *  - **약력은 필수가 아니다** — 서버는 원래 요구하지 않았고, 화면만 막고 있었다.
 *  - 바는 모바일에서 **하단 탭바 위**에 붙는다(지원서 페이지와 같은 클래스).
 *  - 미리보기: 넓은 화면은 오른쪽에 붙어 따라오고, 좁은 화면은 바의 [미리보기] → 전체 화면 시트.
 *    지금 손대는 묶음·칸의 탭을 따라 연다. 공개 페이지와 **같은 컴포넌트**(HomepageView)라 실제와 어긋나지 않는다.
 *
 * ⚠️ 훅은 전부 아래 `return` 들보다 **위**에 둔다 — 조회가 끝나는 순간 훅 개수가 늘면 React #310 으로 화면이 통째로 죽는다
 *    (2026-09-21 이 화면에서 실제로 겪었다. `__tests__/hooksBeforeReturn.test.ts`).
 * ⚠️ 묶음은 **화면 상태**다. 주소(`section=`·`focus=`·`do=`)는 들어올 때만 읽는다 — 탭을 누를 때 주소를 갈아끼우면
 *    `useUnsavedChanges` 의 가드 히스토리 항목이 어긋난다.
 * ⚠️ 저장할 때 designConfig 는 **스타일을 건드렸을 때만** 보낸다(`themeSavePatch`). 매번 보내면 웹 기본값이 PDF 설정을 덮는다(규칙 49).
 */
const signatureOf = (v: {
  biography: string; statement: string; tagline: string; career: Career;
  portfolioFileUrl: string | null; seriesNotes: Record<string, string>; design: HomepageThemeKeys;
}) => JSON.stringify([v.biography, v.statement, v.tagline, v.career, v.portfolioFileUrl, v.seriesNotes, v.design]);

const errText = (err: unknown, fallback: string) =>
  (err as { response?: { data?: { error?: string } } })?.response?.data?.error || fallback;

const NO_IMAGES: PortfolioImage[] = [];

const btnPrimary = 'inline-flex min-h-[44px] shrink-0 items-center justify-center whitespace-nowrap rounded-lg bg-gray-900 px-5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50';
const btnSecondary = 'inline-flex min-h-[44px] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium text-gray-900 hover:bg-gray-50';

export default function HomepageEditor() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { user, updateUser } = useAuthStore();
  const { data: portfolio, isLoading, isError, refetch } = useQuery<Portfolio>({
    queryKey: ['portfolio'],
    queryFn: () => api.get('/portfolio').then((r) => r.data),
  });

  // ── 묶음 ──
  const [section, setSection] = useState<EditSectionId>(() => resolveEditEntry(location.search).section);
  /** 들어오며 받은 '이 칸으로'·'작품 정보 창 열기' — 데이터가 온 뒤에 한 번만 쓴다 */
  const pendingFocus = useRef<EditFocus | null>(null);
  /** 들어오며 열 작품 정보 창 — false: 없음 · true: 정보 없는 첫 작품 · 숫자: 그 작품(ArtLook 의 [크기 입력하기]) */
  const pendingInfo = useRef<boolean | number>(false);
  const [entrySeq, setEntrySeq] = useState(0);

  // ── 폼(글·꾸미기·주소) — 아래 [저장] 한 번에 함께 저장된다 ──
  const [biography, setBiography] = useState('');
  const [statement, setStatement] = useState('');
  const [tagline, setTagline] = useState('');
  const [career, setCareer] = useState<Career>(EMPTY_CAREER);
  const [portfolioFileUrl, setPortfolioFileUrl] = useState<string | null>(null);
  /** 불러왔을 때의 파일 — 저장할 때 **바꿨을 때만** 파일을 보낸다(아래 save 주석) */
  const loadedFileUrl = useRef<string | null>(null);
  const [seriesNotes, setSeriesNotes] = useState<Record<string, string>>({});
  // 홈페이지 스타일(배경·글자·강조·글꼴·대표작) — PDF 와 같은 designConfig 에 저장된다
  const [design, setDesign] = useState<HomepageThemeKeys>(DEFAULT_THEME_KEYS);
  const [handle, setHandle] = useState(user?.handle ?? '');
  const handleTouched = useRef(false);
  const [handleError, setHandleError] = useState<string | null>(null);
  /** 불러온 값의 지문. null = 아직 폼을 채우지 않았다 */
  const [snapshot, setSnapshot] = useState<string | null>(null);

  // ── 미리보기·창 ──
  const [previewTab, setPreviewTab] = useState<string | null>(() => previewTabFor(resolveEditEntry(location.search).section));
  const [previewOpen, setPreviewOpen] = useState(false);
  const [metaImageId, setMetaImageId] = useState<number | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const previewBoxRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const careerColumnCount = useCareerColumns();

  // 저장된 값으로 폼을 채운다 — **딱 한 번**. 사진을 올릴 때마다 재조회가 일어나는데, 그때마다 채우면 쓰던 글이 사라진다
  const inited = useRef(false);
  useEffect(() => {
    if (!portfolio || inited.current) return;
    inited.current = true;
    const init = {
      biography: portfolio.biography || '',
      statement: portfolio.statement || '',
      tagline: portfolio.tagline || '',
      career: normalizeCareer(portfolio.career),
      portfolioFileUrl: portfolio.portfolioFileUrl || null,
      seriesNotes: Object.fromEntries((portfolio.seriesInfo ?? []).map((s) => [s.name, s.note])),
      design: themeKeysFrom(portfolio.designConfig),
    };
    setBiography(init.biography);
    setStatement(init.statement);
    setTagline(init.tagline);
    setCareer(init.career);
    setPortfolioFileUrl(init.portfolioFileUrl);
    loadedFileUrl.current = init.portfolioFileUrl;
    setSeriesNotes(init.seriesNotes);
    setDesign(init.design);
    setSnapshot(signatureOf(init));
  }, [portfolio]);

  // 주소는 공개 페이지가 처음 열릴 때 서버가 인스타 아이디로 만들어 두기도 한다 — 로그인 때 받은 값이 옛것일 수 있어 한 번 다시 받는다
  useEffect(() => {
    let alive = true;
    api.get('/auth/me').then(({ data }) => {
      const u = data?.user;
      if (!alive || !u) return;
      updateUser({ handle: u.handle ?? null, instagramUrl: u.instagramUrl, nickname: u.nickname });
      if (!handleTouched.current) setHandle(u.handle ?? '');
    }).catch(() => { /* 못 받아도 로그인 때 값으로 쓴다 */ });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 주소로 들어온 길(`section=`·`focus=`·`do=info`) — 프로필 탭의 완성도 한 줄·로그인 팝업·공개 페이지의 [수정] 이 이렇게 보낸다
  useEffect(() => {
    const e = resolveEditEntry(location.search);
    setSection(e.section);
    const t = previewTabFor(e.section, e.focus);
    if (t) setPreviewTab(t);
    if (e.focus) pendingFocus.current = e.focus;
    if (e.info) pendingInfo.current = e.work ?? true;
    if (e.focus || e.info) {
      setEntrySeq((n) => n + 1);
      // 한 번 쓰고 버리는 값이다 — 주소에 남기면 새로고침할 때마다 창이 다시 열린다.
      // 묶음은 주소에 **적어 둔다**: `focus` 만 달고 온 주소에서 그걸 떼면 이 effect 가 다시 돌며 [작품] 으로 되돌아간다.
      const q = new URLSearchParams(location.search);
      q.delete('focus');
      q.delete('do');
      q.delete('work');
      q.set('section', e.section);
      navigate({ pathname: location.pathname, search: `?${q.toString()}` }, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);

  useEffect(() => {
    if (!portfolio || snapshot === null) return;
    if (pendingInfo.current !== false) {
      const want = pendingInfo.current;
      pendingInfo.current = false;
      const id = entryInfoImageId(portfolio.images ?? [], typeof want === 'number' ? want : null);
      if (id != null) setMetaImageId(id);
    }
    const f = pendingFocus.current;
    if (f) {
      pendingFocus.current = null;
      // 묶음이 그려진 뒤에 — 그 칸을 화면 가운데로 올리고 커서를 둔다
      window.setTimeout(() => {
        const el = document.getElementById(fieldId(f));
        el?.scrollIntoView({ block: 'center' });
        el?.focus({ preventScroll: true });
      }, 80);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portfolio, snapshot, entrySeq]);

  // 조회 전의 빈 배열도 **같은 배열**이어야 한다 — 매 렌더 새 배열이면 memo 한 [작품] 묶음이 글자를 칠 때마다 다시 그려진다
  const images = portfolio?.images ?? NO_IMAGES;
  const foundSeries = seriesNames(images);
  const handleNorm = normalizeHandle(handle);
  // 비워 두면 '안 바꾼다' — 주소를 없애는 길은 없다(서버도 빈 값을 받지 않는다)
  const handleChanged = handleNorm !== '' && handleNorm !== (user?.handle ?? '');
  const dirty = snapshot !== null
    && (signatureOf({ biography, statement, tagline, career, portfolioFileUrl, seriesNotes, design }) !== snapshot || handleChanged);
  // 긴 글을 쓰다 다른 메뉴를 눌러도 통째로 사라지지 않게 — 갤러리·공모 폼과 같은 이탈 경고
  useUnsavedChanges(dirty);

  const save = useMutation({
    mutationFn: async () => {
      let nextHandle = user?.handle ?? null;
      if (handleChanged) {
        const reason = validateHandle(handleNorm);
        if (reason) throw Object.assign(new Error(reason), { field: 'handle' });
        try {
          const res = await api.put('/auth/me/handle', { handle: handleNorm });
          nextHandle = res.data.handle as string;
          updateUser({ handle: nextHandle });
        } catch (err) {
          throw Object.assign(new Error(errText(err, '주소를 저장하지 못했습니다.')), { field: 'handle' });
        }
      }
      // 디자인은 PDF 설정과 한 객체다 — **여기서 바꾼 키만** 얹고 표지 레이아웃 등 나머지 키는 그대로 둔다.
      // 스타일을 안 건드렸으면 designConfig 를 아예 안 보낸다(서버는 보냈을 때만 갱신한다).
      // ⚠️ 키 전체를 매번 보내면 웹 기본값(고딕·빨강)이 PDF 로 건너가고 자동 편집이 꺼진다 — `themeSavePatch` 주석 참고.
      //    `auto` 는 지금 PDF 가 쓰고 있는 값으로 못박는다: `bg`·`font` 가 새로 생겨도 '저장된 선택'으로 오판되지 않게.
      const prevDesign = portfolio?.designConfig && typeof portfolio.designConfig === 'object' ? (portfolio.designConfig as Record<string, unknown>) : {};
      const stylePatch = themeSavePatch(portfolio?.designConfig, design);
      const designConfig = stylePatch ? { ...prevDesign, ...stylePatch, auto: normalizePdfDesign(prevDesign).auto } : undefined;
      await api.put('/portfolio', {
        biography: biography.trim(),
        career,
        // 파일은 **여기서 바꿨을 때만** 보낸다(서버는 보냈을 때만 바꾼다, 2026-10-03). 포트폴리오 만들기 화면도 이 파일을 바꾸는데
        // (만든 PDF 를 홈페이지에 올리기), 이 화면이 다른 탭에 열려 있다가 글만 고쳐 저장하면 옛 주소를 다시 보내 방금 올린 파일을 지웠다.
        ...(portfolioFileUrl !== loadedFileUrl.current ? { portfolioFileUrl } : {}),
        statement: statement.trim() || null,
        tagline: tagline.trim() || null,
        themeId: portfolio?.themeId ?? null,
        // 작품에 실제로 붙어 있는 시리즈만 저장 (이름을 바꾸면 옛 설명이 유령으로 남는다)
        seriesInfo: foundSeries.map((name) => ({ name, note: (seriesNotes[name] || '').trim() })).filter((s) => s.note),
        ...(designConfig ? { designConfig } : {}),
      });
      return nextHandle;
    },
    onSuccess: (nextHandle) => {
      // 공개 페이지 캐시(`['portfolio', …]`)까지 함께 — 안 하면 방금 저장한 내용이 아니라 옛 화면이 뜬다
      queryClient.invalidateQueries({ queryKey: ['portfolio'] });
      toast.success('홈페이지가 저장되었습니다.');
      /*
        저장하면 **홈페이지로 돌아간다**(규칙 31) — 방금 고치던 묶음의 탭으로. 약력을 고쳤는데 [작품] 탭이 뜨면 저장이 안 된 것처럼 보인다.
        거기서 다시 [수정] 을 누르면 같은 묶음으로 돌아온다(`editSectionForTab`).
      */
      if (!user) return;
      const home = artistPath({ id: user.id, handle: nextHandle });
      const tab = previewTabFor(section);
      // `savedHomepage` — 공개 홈페이지가 "이 내용으로 포트폴리오 PDF 도 만들 수 있어요" 를 한 번 알린다(작품 3점 이상, 닫으면 다시 안 뜬다)
      navigate(tab && tab !== 'works' ? `${home}?tab=${tab}` : home, { state: { savedHomepage: true } });
    },
    onError: (err) => {
      const e = err as Error & { field?: string };
      if (e.field === 'handle') {
        setHandleError(e.message);
        setSection('style');
        pendingFocus.current = 'handle';
        setEntrySeq((n) => n + 1);
        toast.error(e.message);
        return;
      }
      toast.error(errText(err, '홈페이지 저장에 실패했습니다.'));
    },
  });

  if (isError) {
    return (
      <div className="py-16 text-center">
        <p className="text-sm text-gray-500">홈페이지 정보를 불러오지 못했습니다.</p>
        <button type="button" onClick={() => refetch()} className="mt-3 text-sm font-medium text-gray-900 underline underline-offset-4">다시 시도</button>
      </div>
    );
  }
  if (isLoading || !portfolio || snapshot === null || !user) return <div className="h-64 animate-pulse bg-gray-100" />;

  const home = artistPath({ id: user.id, handle: user.handle });
  const noInfo = uncaptionedCount(images);
  const done = sectionDone({ workCount: images.length, uncaptioned: noInfo, statement, biography, career, portfolioFileUrl });
  // 완성도 — 프로필 탭의 한 줄·로그인 팝업과 **같은 판정**. 글은 지금 쓰고 있는 값으로 본다(쓰는 대로 줄어든다. 저장은 아래 바가 말한다)
  const completeness = computeCompleteness({ images, statement, biography, career });

  const followPreview = (t: string | null) => {
    if (!t || t === previewTab) return;
    setPreviewTab(t);
    if (previewBoxRef.current) previewBoxRef.current.scrollTop = 0;   // 새 탭의 첫머리부터
  };
  const selectSection = (id: EditSectionId) => {
    // 탭 막대가 상단에 붙어 있을 때 묶음을 바꾸면 새 묶음의 첫머리로 올려 준다(긴 작품 격자 한가운데서 [소개]를 누른 경우)
    const a = anchorRef.current;
    if (a) {
      const top = a.getBoundingClientRect().top;
      const stick = window.innerWidth >= 1024 ? 80 : 64;
      if (top < stick) window.scrollTo({ top: window.scrollY + top - stick });
    }
    setSection(id);
    followPreview(previewTabFor(id));
  };
  const onField = (f: EditField) => followPreview(previewTabFor(section, f));
  /** 그 묶음·그 칸으로 — 주소로 들어올 때(`resolveEditEntry`)와 같은 일을 화면 안에서 한다 */
  const goEntry = (e: EditEntry) => {
    selectSection(e.section);
    if (e.info) { const id = entryInfoImageId(images, e.work); if (id != null) setMetaImageId(id); }
    if (e.focus) { pendingFocus.current = e.focus; setEntrySeq((n) => n + 1); }
  };
  /** 완성도 줄의 항목 — 링크가 아니라 **그 자리에서** 묶음을 바꾼다(링크면 쓰던 글 때문에 이탈 경고가 뜬다) */
  const goItem = (it: CompletenessItem) => goEntry(resolveEditEntry(it.href.slice(it.href.indexOf('?'))));
  const copyAddress = async () => {
    try { await navigator.clipboard.writeText(artistUrl(user)); toast.success('주소를 복사했어요.'); }
    catch { toast.error('복사하지 못했습니다. 주소를 길게 눌러 복사해 주세요.'); }
  };

  /*
    미리보기에 넘길 데이터 — **저장 전 입력값**을 그대로 쓴다(그래야 보면서 쓸 수 있다).
    작품은 올리는 즉시 저장되므로 저장된 것을 그대로 보여 준다.
    ⚠️ HomepageView 가 작품 격자를 내용 지문으로 memo 하므로, 여기서 객체를 매번 새로 만들어도
       타이핑 때 30장이 다시 그려지지는 않는다(참조가 아니라 내용으로 판단한다).
  */
  const previewDesign = { ...design, [WEB_THEME_FLAG]: true };   // 아직 저장 전이라 표식이 없어도 고르는 값이 보여야 한다
  const previewData = {
    user,
    tagline,
    statement,
    biography,
    career,
    portfolioFileUrl,
    seriesInfo: foundSeries.map((name) => ({ name, note: (seriesNotes[name] || '').trim() })).filter((s) => s.note),
    images,
    designConfig: previewDesign,
  };
  const previewBg = resolveHomepageTheme(previewDesign).bg;
  const wide = careerColumnCount >= 3;   // lg(1024px) 이상 — 미리보기를 옆에 붙인다
  const preview = (columns: number) => (
    <HomepageView
      data={previewData}
      careerColumns={columns}
      emptyText="작품을 올리거나 글을 쓰면 여기에 홈페이지 모양으로 보입니다."
      compact
      tab={previewTab}
      onTabChange={(id) => setPreviewTab(id)}
    />
  );

  return (
    <div data-testid="homepage-editor">
      {/* ── 머리 ── h2 다: 이 화면의 h1 은 미리보기 속 작가 이름이다(공개 페이지와 같은 컴포넌트) */}
      <header className="mb-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xl font-semibold tracking-tight text-gray-950 md:text-2xl">홈페이지 편집</h2>
          <Link to={home} className="inline-flex min-h-[40px] shrink-0 items-center gap-1 text-sm text-gray-600 underline-offset-4 hover:text-gray-950 hover:underline">
            <ExternalLink size={14} /> 내 홈페이지 보기
          </Link>
        </div>
        <p className="flex flex-wrap items-center gap-x-2.5 text-sm text-gray-500">
          <span className="break-all">artlink.cc{home}</span>
          <button type="button" onClick={copyAddress} className="inline-flex min-h-[32px] items-center gap-1 text-gray-700 underline-offset-4 hover:text-gray-950 hover:underline">
            <Copy size={13} /> 주소 복사
          </button>
          {!user.handle && (
            <button type="button" onClick={() => goEntry({ section: 'style', focus: 'handle', info: false })} className="inline-flex min-h-[32px] items-center text-gray-700 underline underline-offset-4 hover:text-gray-950">
              내 주소 정하기
            </button>
          )}
        </p>
      </header>

      {/* ── 완성도 한 줄 — 무엇이 남았는지, 누르면 그 자리로. 다 채우면 사라진다. 작품이 0점이면 [작품] 묶음이 첫 안내를 한다.
          칩은 링크가 아니라 **버튼**(onItem)이다 — 링크면 쓰던 글 때문에 이탈 경고가 뜬다. 프로필 탭의 같은 줄은 링크다. ── */}
      {images.length > 0 && <CompletenessLine completeness={completeness} onItem={goItem} className="mb-3" />}

      {/* ── 묶음 탭 ── */}
      <div ref={anchorRef} className="scroll-mt-16 lg:scroll-mt-20" />
      <PageTabBar
        tabs={EDIT_SECTIONS.map((s) => ({ id: s.id, label: s.label, done: done[s.id], ...(s.id === 'works' && images.length > 0 ? { count: images.length } : {}) }))}
        active={section}
        onSelect={selectSection}
        idPrefix="hpe"
        label="홈페이지 편집"
      />

      <div className="pt-6 lg:flex lg:gap-8">
        <div role="tabpanel" id={`hpe-panel-${section}`} aria-labelledby={`hpe-tab-${section}`} className="lg:min-w-0 lg:flex-1">
          {/*
            [작품] 묶음은 **떼어 내지 않고 감춰 둔다** — 사진 열 장을 올리는 20~30초 사이에 [소개] 를 눌러 글을 쓰는 사람이 있다.
            떼어 내면 올리는 중이라는 표시와 "방금 올린 N점" 안내가 사라지고, 돌아왔을 때 [작품 사진 올리기] 가 다시 눌려 같은 사진을 두 번 올리게 된다.
            (감춘 동안 글을 쳐도 격자를 다시 그리지 않는다 — WorksSection 이 memo 다)
          */}
          <div hidden={section !== 'works'}>
            <WorksSection images={images} metaImageId={metaImageId} onMeta={setMetaImageId} />
          </div>
          {section === 'intro' && (
            <IntroSection
              tagline={tagline} onTagline={setTagline}
              statement={statement} onStatement={setStatement}
              series={foundSeries} seriesNotes={seriesNotes}
              onSeriesNote={(name, note) => setSeriesNotes((prev) => ({ ...prev, [name]: note }))}
              onField={onField}
            />
          )}
          {section === 'cv' && <CvSection biography={biography} onBiography={setBiography} career={career} onCareer={setCareer} onField={onField} />}
          {section === 'file' && <FileSection value={portfolioFileUrl} onChange={setPortfolioFileUrl} />}
          {section === 'style' && (
            <StyleSection
              handle={handle}
              onHandle={(v) => { handleTouched.current = true; setHandle(v); setHandleError(null); }}
              currentHandle={user.handle}
              handleSuggestion={suggestHandle(user.instagramUrl)}
              handleError={handleError}
              design={design} onDesign={setDesign}
              images={images}
              onField={onField}
            />
          )}
        </div>

        {/* 미리보기 — 넓은 화면에서만 옆에 붙는다. 좁은 화면은 저장 바의 [미리보기](시트). 숨겨 둔 채 그리지 않는다(사진을 다 받는다) */}
        {wide && (
          <aside className="w-[44%] min-w-0 shrink-0" aria-label="홈페이지 미리보기">
            <div className="sticky top-[8.5rem]">
              <p className="mb-2 text-xs text-gray-500">미리보기 <span className="text-gray-400">· 저장하기 전 내용이 그대로 보여요</span></p>
              <div ref={previewBoxRef} className="max-h-[calc(100vh-15rem)] overflow-y-auto rounded-xl border border-gray-200 p-4" style={{ backgroundColor: previewBg }}>
                {preview(Math.max(1, careerColumnCount - 1))}
              </div>
            </div>
          </aside>
        )}
      </div>

      {/*
        저장 바 — 화면 아래에 붙어 따라온다.
        ⚠️ 모바일에서는 **하단 탭바 위**(`bottom-[calc(3.5rem+1px+safe-area)]`)다. `bottom-0` 이면 탭바(z-40) 밑에 깔려
           페이지 맨 끝에서만 보인다 — 실측: 저장 버튼 자리를 눌러 보면 탭바의 [커뮤니티] 가 잡혔다(2026-10-02).
        ⚠️ 묶음 안이 아니라 **화면 맨 끝**에 둔다. 묶음 안에 두면 그 묶음 높이에서 sticky 가 끝난다.
        ⚠️ **한 줄**이어야 한다 — 좁은 화면에서 글자와 버튼이 두 줄로 꺾이면 바가 121px 이 되어 첫 화면의 [작품 사진 올리기] 를 가린다
           (실측 390px). 그래서 안내 글자는 sm 이상에서만 보이고, 좁은 화면엔 버튼만 놓인다.
        고친 것도 없고 작품도 없으면 바를 그리지 않는다 — 저장할 것도 미리 볼 것도 없다.
      */}
      {(dirty || images.length > 0) && (
        <div data-save-bar className="sticky bottom-[calc(3.5rem+1px+env(safe-area-inset-bottom))] z-30 -mx-6 mt-10 border-t border-gray-200 bg-white/95 px-6 py-3 backdrop-blur md:-mx-12 md:px-12 lg:bottom-0">
          <div className="flex items-center justify-end gap-2">
            <p className={cn('mr-auto hidden min-w-0 break-keep text-xs sm:block', dirty ? 'font-medium text-accent' : 'text-gray-500')}>
              {dirty ? '저장하지 않은 변경이 있어요.' : '사진·작품 정보는 올리는 즉시 저장됩니다.'}
            </p>
            {!wide && (
              <button type="button" onClick={() => setPreviewOpen(true)} className={btnSecondary}>
                <Eye size={15} /> 미리보기
              </button>
            )}
            {dirty ? (
              <>
                <button type="button" onClick={() => setLeaveOpen(true)} disabled={save.isPending} className="min-h-[44px] shrink-0 px-3 text-sm text-gray-600 hover:text-gray-950">취소</button>
                <button type="button" onClick={() => save.mutate()} disabled={save.isPending} className={btnPrimary}>
                  {save.isPending ? '저장 중…' : '저장'}
                </button>
              </>
            ) : (
              <button type="button" onClick={() => navigate(home)} className={btnSecondary}>내 홈페이지 보기</button>
            )}
          </div>
        </div>
      )}

      <PreviewSheet open={previewOpen && !wide} onClose={() => setPreviewOpen(false)}>
        <div className="min-h-full px-5 py-5" style={{ backgroundColor: previewBg }}>{preview(1)}</div>
      </PreviewSheet>

      <ConfirmDialog
        open={leaveOpen}
        title="저장하지 않고 나갈까요?"
        details={['고친 글·꾸미기 설정은 저장되지 않습니다.', '올린 사진과 작품 정보는 이미 저장되어 있어요.']}
        confirmText="저장하지 않고 나가기"
        cancelText="계속 편집"
        onConfirm={() => { setLeaveOpen(false); navigate(home); }}
        onCancel={() => setLeaveOpen(false)}
      />
    </div>
  );
}
