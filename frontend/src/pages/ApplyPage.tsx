/**
 * ApplyPage — 공모 지원서 (/exhibitions/:id/apply, 2026-09-29)
 *
 * 예전엔 공모 상세 위의 모달(448px)이었다. 좁은 창 안에서 따로 스크롤되고, 경력 세 칸·포트폴리오 파일마다
 * '없음' 을 체크하지 않으면 제출이 막혔다(비워 두고 누르면 오류 네 개). 그 부담을 덜어 주는
 * [포트폴리오 불러오기]는 작은 외곽선 버튼이라 잘 안 보였고, 모달엔 어떤 공모인지도 적혀 있지 않았다.
 *
 * 지금은:
 *  - 전용 페이지 — 맨 위에 공모명·갤러리·마감을 적고, 번호 붙은 구역(약력 · 경력 · 작품 사진 · 포트폴리오 파일 · 추가 질문)
 *  - **열리면 홈페이지(포트폴리오) 내용으로 채운다** — 대부분의 작가는 고칠 것만 고치고 낸다
 *  - '없음' 체크 없음 — 비워 두면 없는 것이다(서버는 원래 빈 경력·파일을 받는다)
 *  - 필수는 약력 · 작품 사진 1장 · 필수 추가 질문뿐. [지원하기]를 누르면 비어 있는 칸을 빨갛게 표시하고
 *    그리로 데려간다(예전엔 약관 동의 전까지 버튼이 이유 없이 회색이었다).
 *  - 약관은 **[지원하기] 확인 창 안**에서 받는다(2026-11-20, D5 — 등록 화면 셋과 같은 `SubmitSheet`). 창은 낸 것을 한 번 더 보여 준다.
 *    ⚠️ 하단 줄에 '남은 것 · …'/'다 채웠어요' 를 적지 않는다(2026-10-03 사용자 요청 — 버튼 하나만)
 *
 * **고치기 모드**(`/exhibitions/:id/apply/edit`, 2026-11-21 — 규칙 90): 같은 화면을 **낸 내용으로** 채워 연다. 고친 칸에 '고침',
 * 아래 줄에 '고친 곳 N · 칸 이름' + [취소] [수정 저장]. 약관은 다시 받지 않는다(처음 동의 그대로). 검토 대기 · 모집이 열려 있을 때만
 * (`lib/applicationWindow.ts` — 아니면 [내 전시]의 그 공모로 돌려보낸다). 저장은 `PUT /exhibitions/:id/my-application`.
 *
 * ⚠️ 약관 버전은 서버와 같아야 한다 — `backend/src/lib/terms.ts`, 검사는 `terms-consistency.test.ts`.
 * ⚠️ 이미 지원했거나 마감됐거나 작가가 아니면 상세로 되돌린다(서버도 400 으로 막는다) — 다 쓰고 나서 400 을 받게 하지 않는다.
 * (초대받은 작가의 '간편 지원' 창은 2026-11-19 에 1:1 공모 초대와 함께 없앴다.)
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ExternalLink, RotateCw } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import { useAuthStore } from '@/stores/authStore';
import { getDday, cn } from '@/lib/utils';
import { isCareerEmpty, normalizeCareer } from '@/lib/artwork';
import { ddayText } from '@/lib/flowLabels';
import { confirmLeaveUnsaved, useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import { canChangeApplication } from '@/lib/applicationWindow';
import { shortDate } from '@/lib/listings';
import { dropAuthStash, peekAuthStash, stashKeys, useStashOnAuthLoss } from '@/lib/authStash';
import CareerEditor, { PORTFOLIO_CATEGORIES } from '@/components/shared/CareerEditor';
import PortfolioFileInput from '@/components/shared/PortfolioFileInput';
import { MultiImageUpload } from '@/components/shared/ImageUpload';
import SubmitSheet from '@/components/form/SubmitSheet';
import Thumb from '@/components/shared/Thumb';
import { FormSection } from '@/components/flow/FormParts';
import type { Career, CustomAnswer, CustomField, Exhibition } from '@/types';
import { EMPTY_CAREER } from '@/types';

const ARTIST_APPLY_TERMS_VERSION = 'artist_apply_2026-09-27'; // backend/src/lib/terms.ts 와 같아야 한다(terms-consistency.test.ts)
const MAX_IMAGES = 10;

type AnswerDraft = Record<string, string | string[]>;
type ApplyExhibition = Exhibition & {
  gallery: { id: number; name: string } | null;
  recruitmentClosed?: boolean;
  ended?: boolean;
};

function isMultiChoice(field: CustomField): boolean {
  return field.type === 'multiselect' || (field.type === 'select' && field.maxSelect !== undefined && field.maxSelect !== 1);
}
const answerText = (v: AnswerDraft, id: string) => { const x = v[id]; return Array.isArray(x) ? x.join('\n') : x ?? ''; };
const answerList = (v: AnswerDraft, id: string) => { const x = v[id]; return Array.isArray(x) ? x : x ? [x] : []; };

function buildCustomAnswers(fields: CustomField[] | null | undefined, values: AnswerDraft): CustomAnswer[] {
  return (fields ?? [])
    .map((field) => {
      const value = values[field.id];
      if (Array.isArray(value)) return { fieldId: field.id, value: Array.from(new Set(value.map((v) => v.trim()).filter(Boolean))) };
      return { fieldId: field.id, value: (value ?? '').trim() };
    })
    .filter((a) => (Array.isArray(a.value) ? a.value.length > 0 : a.value));
}

/** 고치기 — 낸 지원서(GET /exhibitions/my-applications 의 한 줄 중 이 화면이 읽는 칸) */
interface MyApplication {
  exhibitionId: number;
  status: string;
  createdAt: string;
  biography?: string | null;
  career?: unknown;
  artworkImages?: string[] | null;
  portfolioFileUrl?: string | null;
  customAnswers?: unknown;
}

/** 로그인이 풀릴 때 남겨 두는 지원서(lib/authStash) — 고치기 모드의 '처음 값'도 같은 모양이다 */
type ApplyStash = { biography: string; career: Career; images: string[]; file: string | null; answers: AnswerDraft };

const cleanEntries = (list: Career['solo'] | undefined) => (list ?? []).filter((e) => e.year.trim() || e.content.trim());
/** 보낼 경력 — 비어 있는 줄은 뺀다('없음' 을 따로 체크하게 하지 않는다) */
function cleanCareer(c: Career): Career {
  return { education: cleanEntries(c.education), solo: cleanEntries(c.solo), group: cleanEntries(c.group), artFair: cleanEntries(c.artFair), award: cleanEntries(c.award) };
}
/** 낸 지원서의 추가 질문 답(`[{fieldId, value}]`) → 화면의 답 */
function answersFrom(raw: unknown): AnswerDraft {
  const out: AnswerDraft = {};
  for (const a of Array.isArray(raw) ? raw : []) {
    if (a && typeof a.fieldId === 'string') out[a.fieldId] = Array.isArray(a.value) ? a.value.map(String) : String(a.value ?? '');
  }
  return out;
}
/** 고치기 모드 — 무엇을 고쳤나(칸 이름). 비교는 보낼 모양으로 한다(빈 줄·앞뒤 공백은 고친 게 아니다) */
const EDIT_SECTIONS = [['bio', '작가 약력'], ['career', '경력'], ['images', '작품 사진'], ['file', '포트폴리오 파일'], ['answers', '추가 질문']] as const;
type EditSection = (typeof EDIT_SECTIONS)[number][0];
function sectionValues(v: ApplyStash, fields: CustomField[] | null | undefined): Record<EditSection, string> {
  return {
    bio: v.biography.trim(),
    career: JSON.stringify(cleanCareer(normalizeCareer(v.career))),
    images: JSON.stringify(v.images),
    file: v.file ?? '',
    answers: JSON.stringify(buildCustomAnswers(fields, v.answers)),
  };
}

export default function ApplyPage({ mode = 'apply' }: { mode?: 'apply' | 'edit' } = {}) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const isEdit = mode === 'edit';
  /** 고치기 — [내 전시]의 그 공모 화면에서 왔는가(돌아갈 때 뒤로 간다 — 기록이 두 번 쌓이지 않게) */
  const fromWorkspace = !!(location.state as { fromWorkspace?: boolean } | null)?.fromWorkspace;
  const workspaceHref = `/mypage?tab=applications&ex=${id}`;

  const { data: exhibition, isLoading, isError } = useQuery<ApplyExhibition>({
    queryKey: ['exhibition', id],
    queryFn: () => api.get(`/exhibitions/${id}`).then(r => r.data),
    enabled: !!id,
    staleTime: 0,
    refetchOnMount: 'always',
    retry: (count, err: any) => (err?.response?.status ?? 500) >= 500 && count < 2,
  });

  /** [지원하기] 확인 창 — 낸 것 요약 + 약관 동의(2026-11-20, D5 — 예전엔 폼 맨 끝 6번 구역이 약관이었다) */
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [biography, setBiography] = useState('');
  const [career, setCareer] = useState<Career>(EMPTY_CAREER);
  const [images, setImages] = useState<string[]>([]);
  const [file, setFile] = useState<string | null>(null);
  const [answers, setAnswers] = useState<AnswerDraft>({});
  /** 홈페이지로 채웠는가 — 'filled' 면 안내, 'empty' 면 여기서 쓰라고 안내 */
  const [prefill, setPrefill] = useState<'loading' | 'filled' | 'empty'>('loading');
  /** 사용자가 직접 고쳤는가 — 채운 직후엔 떠나도 잃을 게 없다(이탈 경고를 걸지 않는다) */
  const [touched, setTouched] = useState(false);
  /** [지원하기]를 한 번 눌러 본 뒤로 빈 칸을 빨갛게(칸을 채우는 대로 사라진다) */
  const [validated, setValidated] = useState(false);

  // 홈페이지(포트폴리오) — 마이페이지와 같은 쿼리 키라 방금 고친 내용이 그대로 온다. 없으면(404) 빈 지원서로 시작한다.
  // 고치기 모드는 낸 지원서로 채우므로 받지 않는다([홈페이지에 올린 파일 불러오기]는 그때 refetch 로 받는다)
  const { data: portfolio, isError: portfolioMissing, refetch: refetchPortfolio } = useQuery<any>({
    queryKey: ['portfolio'],
    queryFn: () => api.get('/portfolio').then(r => r.data),
    enabled: user?.role === 'ARTIST' && !isEdit,
    retry: false,
  });
  // 고치기 — 낸 지원서. [내 전시]와 같은 쿼리 키(열 때마다 새로 — 그 사이 결과가 났을 수 있다)
  const { data: myApps, isError: myAppsError } = useQuery<MyApplication[]>({
    queryKey: ['my-applications'],
    queryFn: () => api.get('/exhibitions/my-applications').then(r => r.data),
    enabled: isEdit && user?.role === 'ARTIST',
    staleTime: 0,
    refetchOnMount: 'always',
  });
  const myApp = isEdit ? (myApps ?? []).find((a) => a.exhibitionId === Number(id)) ?? null : null;
  /** 고치기 — 낸 그대로의 값(고친 칸을 가리는 기준) */
  const [initial, setInitial] = useState<ApplyStash | null>(null);
  const stashKey = id ? (isEdit ? stashKeys.applyEdit(id) : stashKeys.apply(id)) : null;

  /** 홈페이지 내용으로 채운다 — 채울 게 하나라도 있었는가 */
  const fillFrom = (data: any): boolean => {
    const c = normalizeCareer(data?.career);
    const imgs: string[] = (data?.images || []).map((img: any) => img.url).slice(0, MAX_IMAGES);
    setBiography(data?.biography || '');
    setCareer(c);
    setImages(imgs);
    setFile(data?.portfolioFileUrl || null);
    return !!(data?.biography?.trim() || imgs.length || !isCareerEmpty(c) || data?.portfolioFileUrl);
  };
  /** 로그인이 풀리기 전에 쓰던 지원서가 이 기기에 남아 있으면 되살렸는가 — 그러면 아래 effect 가 지우고 알린다(lib/authStash) */
  const [restored, setRestored] = useState(false);
  // 처음 한 번만 — 렌더 중 상태 맞추기(effect 안 setState 대신). 그 뒤로는 작가가 고친 것을 덮지 않는다
  if (prefill === 'loading' && !isEdit && (portfolio || portfolioMissing)) {
    /*
      로그인이 풀리기 전에 쓰던 지원서가 이 기기에 남아 있으면 홈페이지 내용 대신 그걸로 채운다(2026-11-21 O6).
      렌더 중이라 들여다보기만 하고(개발 모드는 렌더를 두 번 한다) 지우는 건 아래 effect 에서.
    */
    const stash = stashKey ? peekAuthStash<ApplyStash>(user?.id, stashKey) : null;
    if (stash) {
      setBiography(stash.biography);
      setCareer(normalizeCareer(stash.career));
      setImages(stash.images.slice(0, MAX_IMAGES));
      setFile(stash.file);
      setAnswers(stash.answers ?? {});
      setTouched(true);
      setRestored(true);
      setPrefill('filled');
    } else {
      setPrefill(portfolio && fillFrom(portfolio) ? 'filled' : 'empty');
    }
  }
  // 고치기 — 낸 지원서로 채운다(처음 한 번). 로그인이 풀리기 전에 고치던 것이 남아 있으면 그걸로(같은 규칙)
  if (prefill === 'loading' && isEdit && myApp) {
    const base: ApplyStash = {
      biography: myApp.biography ?? '',
      career: normalizeCareer(myApp.career as Career | null | undefined),
      images: (Array.isArray(myApp.artworkImages) ? myApp.artworkImages : []).slice(0, MAX_IMAGES),
      file: myApp.portfolioFileUrl || null,
      answers: answersFrom(myApp.customAnswers),
    };
    const stash = stashKey ? peekAuthStash<ApplyStash>(user?.id, stashKey) : null;
    const v = stash ?? base;
    setInitial(base);
    setBiography(v.biography);
    setCareer(normalizeCareer(v.career));
    setImages(v.images.slice(0, MAX_IMAGES));
    setFile(v.file);
    setAnswers(v.answers ?? {});
    if (stash) { setTouched(true); setRestored(true); }
    setPrefill('filled');
  }
  useEffect(() => {
    if (!restored || !stashKey) return;
    dropAuthStash(user?.id, stashKey);
    toast('로그인이 풀리기 전에 쓰던 지원서를 되살렸어요.', { id: `auth-stash-${stashKey}`, duration: 6000 });
  }, [restored, stashKey, user?.id]);
  /** [다시 불러오기] */
  const reloadPortfolio = async () => {
    const r = await refetchPortfolio();
    if (r.data) { fillFrom(r.data); setTouched(false); toast.success('홈페이지 내용으로 다시 채웠어요.'); }
    else toast.error('홈페이지 내용을 불러오지 못했습니다.');
  };

  /**
   * [홈페이지에 올린 파일 불러오기] — 포트폴리오 파일 칸이 비어 있을 때(2026-10-03).
   * [PDF 만들기] 는 **새 탭**으로 연다(지원서에는 임시저장이 없다 — 같은 탭으로 가면 쓰던 지원서를 잃는다).
   * 그 탭에서 만들며 '내 홈페이지에도 올리기' 를 켰으면 여기서 다시 받아 붙인다. 다른 칸(약력·작품)은 건드리지 않는다.
   */
  const [loadingFile, setLoadingFile] = useState(false);
  const loadHomepageFile = async () => {
    setLoadingFile(true);
    try {
      const r = await refetchPortfolio();
      const url: string | null = r.data?.portfolioFileUrl || null;
      if (url) { setFile(url); setTouched(true); toast.success('홈페이지에 올린 포트폴리오 파일을 붙였어요.'); }
      else toast('홈페이지에 올린 포트폴리오 파일이 아직 없어요.');
    } finally { setLoadingFile(false); }
  };

  // 고치기 — 무엇을 고쳤나(낸 것과 다른 칸). 되돌려 같아지면 고친 게 아니다
  const fields = exhibition?.customFields ?? [];
  const current: ApplyStash = { biography, career, images, file, answers };
  const changed: EditSection[] = isEdit && initial
    ? (() => { const a = sectionValues(current, fields); const b = sectionValues(initial, fields); return EDIT_SECTIONS.map(([k]) => k).filter((k) => a[k] !== b[k]); })()
    : [];
  const dirty = isEdit ? changed.length > 0 : touched;
  // 쓰다가 떠나면 경고 — 지원서는 길다
  useUnsavedChanges(dirty);
  // 로그인이 풀리면 쓰던 지원서를 이 기기에 남긴다 — 다시 로그인해 이 화면이 뜨면 위에서 되살린다(lib/authStash)
  useStashOnAuthLoss(stashKey, (): ApplyStash | null => (dirty ? { biography, career, images, file, answers } : null));

  const applyMutation = useMutation({
    mutationFn: (payload: { biography: string; career: Career; artworkImages: string[]; portfolioFileUrl: string | null; customAnswers?: CustomAnswer[]; termsAgreed: boolean; termsVersion: string }) =>
      api.post(`/exhibitions/${id}/apply`, payload),
    onSuccess: () => {
      // 먼저 떠난다 — 이탈 경고 훅이 쌓아 둔 기록을 라우터가 갈아끼우게(규칙 같은 이유로 다른 폼도 저장 뒤 이동)
      navigate(`/exhibitions/${id}`, { replace: true });
      // 미선정은 알림이 없다(규칙 90) — 언제 결과가 나오는지(선정 마감일), 날짜가 없는 옛 공고면 '선정되면 알림으로'
      toast.success(exhibition?.selectionDeadline ? `지원했어요! ${shortDate(exhibition.selectionDeadline)}까지 선정 결과가 나와요.` : '지원했어요! 선정되면 알림으로 알려 드려요.');
      queryClient.invalidateQueries({ queryKey: ['exhibition', id] });
      queryClient.invalidateQueries({ queryKey: ['exhibitions'] });
      queryClient.invalidateQueries({ queryKey: ['my-applications'] });
    },
    onError: (err: any) => toast.error(err.response?.data?.error || '지원 중 오류가 발생했습니다.'),
  });
  // 고치기 저장 — 먼저 [내 전시]의 그 공모로 옮긴다(이탈 경고 훅이 쌓아 둔 기록을 갈아끼우게, 지원과 같은 이유)
  const editMutation = useMutation({
    mutationFn: (payload: { biography: string; career: Career; artworkImages: string[]; portfolioFileUrl: string | null; customAnswers?: CustomAnswer[] }) =>
      api.put(`/exhibitions/${id}/my-application`, payload),
    onSuccess: () => {
      navigate(workspaceHref, { replace: true });
      toast.success('지원서를 고쳤어요.');
      queryClient.invalidateQueries({ queryKey: ['my-applications'] });
    },
    // 그 사이 결과가 났거나 모집이 끝났다(400·409) — 이유를 보여 주고 낸 지원서를 다시 받는다
    onError: (err: { response?: { data?: { error?: string } } }) => { toast.error(err.response?.data?.error || '지원서를 고치지 못했어요.'); queryClient.invalidateQueries({ queryKey: ['my-applications'] }); },
  });
  /** 고치기 — [← 내 전시]·[취소]. 그 화면에서 왔으면 뒤로(고친 게 있으면 이탈 경고가 묻는다), 아니면 그리로 */
  const leaveEdit = () => {
    if (fromWorkspace) { navigate(-1); return; }
    if (!confirmLeaveUnsaved()) return;
    navigate(workspaceHref);
  };

  if (isLoading || !user || (isEdit && user.role === 'ARTIST' && !myApps && !myAppsError)) {
    return <div className="mx-auto max-w-3xl px-6 py-10 md:px-12"><div className="h-64 animate-pulse rounded-2xl bg-gray-100" /></div>;
  }
  if (isError || !exhibition) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-20 text-center md:px-12">
        <p className="text-gray-600">공모를 찾을 수 없어요.</p>
        <Link to="/exhibitions" className="mt-4 inline-block text-sm text-gray-500 underline-offset-4 hover:text-gray-900 hover:underline">모집공고로</Link>
      </div>
    );
  }
  // 고치기 — 검토 대기 · 모집이 열려 있을 때만(서버와 같은 규칙). 아니면 [내 전시]의 그 공모로(거기가 상태를 말한다)
  if (isEdit) {
    if (user.role !== 'ARTIST' || !canChangeApplication(myApp, exhibition)) return <Navigate to={workspaceHref} replace />;
  } else {
    // 지원할 수 없는 경우 — 상세로(상세가 이유를 보여 준다: 이미 지원함 / 마감 / 아직 시작 전 / 작가 계정만)
    const expired = getDday(exhibition.deadline) < 0 || !!exhibition.recruitmentClosed || !!exhibition.ended;
    // 공모 시작일 전 — 서버도 400(2026-10-03 점검 P2: 주소로 들어오면 지원서가 열리고 201 이었다)
    const notStarted = !!exhibition.deadlineStart && getDday(exhibition.deadlineStart) > 0;
    if (user.role !== 'ARTIST' || exhibition.myApplication || expired || notStarted) {
      return <Navigate to={`/exhibitions/${id}`} replace />;
    }
  }

  const missingRequired = fields.filter((f) => {
    if (!f.required) return false;
    const v = answers[f.id];
    return Array.isArray(v) ? v.length === 0 : !String(v ?? '').trim();
  });
  const missing: { key: string; label: string }[] = [
    ...(!biography.trim() ? [{ key: 'bio', label: '작가 약력' }] : []),
    ...(images.length === 0 ? [{ key: 'images', label: '작품 사진' }] : []),
    ...missingRequired.map((f) => ({ key: `q-${f.id}`, label: `추가 질문 “${f.label}”` })),
  ];
  const bad = (key: string) => validated && missing.some((m) => m.key === key);
  const edit = <T,>(setter: (v: T) => void) => (v: T) => { setter(v); setTouched(true); };

  const submit = () => {
    if (missing.length) {
      setValidated(true);
      toast.error(`아직 채울 것: ${missing.map((m) => m.label).join(', ')}`, { duration: 5000 });
      const first = missing[0]!.key;
      document.getElementById(`apply-${first.startsWith('q-') ? 'questions' : first}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    // 고치기 — 약관은 처음 동의 그대로라 확인 창 없이 바로 저장한다
    if (isEdit) {
      if (changed.length === 0 || editMutation.isPending) return;
      editMutation.mutate({
        biography: biography.trim(),
        career: cleanCareer(career),
        artworkImages: images,
        portfolioFileUrl: file,
        customAnswers: buildCustomAnswers(fields, answers),
      });
      return;
    }
    setConfirmOpen(true);
  };
  const send = () => {
    applyMutation.mutate({
      biography: biography.trim(),
      // 비어 있는 경력은 '없음' — 예전처럼 따로 체크하게 하지 않는다
      career: cleanCareer(career),
      artworkImages: images,
      portfolioFileUrl: file,
      customAnswers: buildCustomAnswers(fields, answers),
      termsAgreed: true,
      termsVersion: ARTIST_APPLY_TERMS_VERSION,
    });
  };

  /** 고치기 — 그 칸을 고쳤으면 제목 옆 '고침' */
  const edited = (k: EditSection) => (changed.includes(k) ? <span className="inline-flex items-center gap-1.5 text-gray-700"><span aria-hidden className="h-1.5 w-1.5 rounded-full bg-gray-900" />고침</span> : undefined);
  const deadlineLabel = ddayText('마감', exhibition.deadline);
  const hostName = exhibition.gallery?.name ?? '아트링크';

  return (
    <div className="mx-auto max-w-3xl px-6 pb-4 pt-6 md:px-12 md:pt-10">
      <button type="button" onClick={isEdit ? leaveEdit : () => navigate(-1)} className="-ml-1 inline-flex min-h-[44px] items-center gap-1 px-1 text-sm text-gray-500 hover:text-gray-900">
        <ArrowLeft size={16} aria-hidden /> {isEdit ? '내 전시' : '공모로 돌아가기'}
      </button>

      <header className="mt-2">
        <p className="text-sm text-gray-500">{isEdit ? '지원서 수정' : '지원서'}</p>
        <h1 className="mt-1 break-keep text-2xl font-semibold leading-tight text-gray-950 md:text-3xl">{exhibition.title}</h1>
        <p className="mt-2 text-sm text-gray-500">
          {hostName}
          {deadlineLabel && <> · <span className="font-medium tabular-nums text-gray-900">{deadlineLabel}</span></>}
          {isEdit && myApp?.createdAt ? ` · ${shortDate(myApp.createdAt)}에 냈어요` : exhibition.recruitOnly ? ' · 선정(수락)까지만 진행하는 공모' : ''}
        </p>
      </header>

      {/* 홈페이지로 채웠으면 다시 불러오는 글자 링크 하나 — 안내 상자는 없앴다(2026-11-20, 칸이 이미 채워져 보인다) */}
      {prefill === 'filled' && !isEdit && (
        <button type="button" onClick={reloadPortfolio} className="mt-3 inline-flex min-h-[40px] items-center gap-1 text-[13px] text-gray-600 underline-offset-4 hover:text-gray-900 hover:underline">
          <RotateCw size={13} aria-hidden /> 홈페이지 내용으로 다시 채우기
        </button>
      )}

      <div className="mt-8 space-y-8">
        <FormSection n={1} id="apply-bio" title="작가 약력 *" titleNote={edited('bio')}>
          <textarea
            value={biography}
            onChange={(e) => edit(setBiography)(e.target.value)}
            placeholder="작가 소개·약력을 입력하세요."
            rows={6}
            className={cn('w-full resize-y rounded-lg border px-3 py-2.5 text-sm leading-relaxed focus:outline-none', bad('bio') ? 'border-accent bg-accent/5' : 'border-gray-200 focus:border-gray-400')}
          />
          {bad('bio') && <p className="mt-1.5 text-xs text-accent">약력을 적어 주세요.</p>}
        </FormSection>

        {/* 홈페이지와 같은 5항목(학력·개인전·단체전·아트페어·수상) — 예전엔 셋만 그리고 셋만 보내 학력·수상이 빠졌다(2026-10-03 점검 P2).
            초대·초대 코드로 들어온 작가는 홈페이지 경력을 통째로 가져가서 다섯이 다 갔다 — 일반 지원만 빠졌다 */}
        <FormSection n={2} title="경력" titleNote={edited('career')} description="한 줄에 한 건씩. 없는 항목은 비워 두면 '없음'으로 보내요.">
          <CareerEditor value={career} onChange={edit(setCareer)} categories={PORTFOLIO_CATEGORIES} />
        </FormSection>

        <FormSection n={3} id="apply-images" title="작품 사진 *" titleNote={edited('images')} description={`1장 이상, 최대 ${MAX_IMAGES}장. 갤러리가 지원서와 함께 보는 대표 작품이에요.`}>
          <div className={cn(bad('images') && 'rounded-xl p-1 ring-1 ring-accent/50')}>
            <MultiImageUpload
              images={images.map((url) => ({ url }))}
              onAdd={(url) => { setImages((prev) => [...prev, url].slice(0, MAX_IMAGES)); setTouched(true); }}
              onRemove={(index) => { setImages((prev) => prev.filter((_, i) => i !== index)); setTouched(true); }}
              maxCount={MAX_IMAGES}
            />
          </div>
          {bad('images') && <p className="mt-1.5 text-xs text-accent">작품 사진을 1장 이상 올려 주세요.</p>}
        </FormSection>

        <FormSection n={4} title="포트폴리오 파일" titleNote={edited('file')} description="PDF · DOC · HWP. 없으면 비워 두세요.">
          <PortfolioFileInput value={file} onChange={edit(setFile)} />
          {/* 파일이 없을 때만 — 올린 작품으로 PDF 를 만들 수 있다는 것을 **쓰일 자리에서** 알린다(예전엔 편집 화면 [파일] 묶음의 링크 한 줄뿐이었다) */}
          {!file && (
            <p className="mt-2.5 break-keep text-sm leading-relaxed text-gray-600" data-testid="apply-pdf-hint">
              아직 만들어 둔 파일이 없나요? 올린 작품으로{' '}
              <a href="/mypage?tab=portfolio" target="_blank" rel="noopener" className="inline-flex items-center gap-0.5 font-medium text-gray-950 underline underline-offset-4">
                포트폴리오 PDF 만들기 <ExternalLink size={13} aria-hidden />
              </a>
              <span className="text-gray-500"> (새 창) · 만들 때 '내 홈페이지에도 올리기' 를 켰다면{' '}</span>
              <button type="button" onClick={loadHomepageFile} disabled={loadingFile} className="font-medium text-gray-950 underline underline-offset-4 disabled:opacity-50">
                {loadingFile ? '불러오는 중…' : '홈페이지에 올린 파일 불러오기'}
              </button>
            </p>
          )}
        </FormSection>

        {fields.length > 0 && (
          <FormSection n={5} id="apply-questions" title="갤러리 추가 질문" titleNote={edited('answers')} description="이 공모를 연 갤러리가 따로 묻는 것이에요.">
            <div className="space-y-5">
              {fields.map((field) => {
                const selected = answerList(answers, field.id);
                const maxSelect = field.maxSelect ?? 0;
                const invalid = bad(`q-${field.id}`);
                return (
                  <div key={field.id}>
                    <p className={cn('mb-1.5 text-sm font-medium', invalid ? 'text-accent' : 'text-gray-800')}>
                      {field.label}{field.required && <span className="ml-0.5 text-accent">*</span>}
                    </p>
                    {isMultiChoice(field) ? (
                      <div className={cn('space-y-1 rounded-lg border p-3', invalid ? 'border-accent/60' : 'border-gray-200')}>
                        {(field.options ?? []).map((option) => {
                          const checked = selected.includes(option);
                          const disabled = !checked && maxSelect > 0 && selected.length >= maxSelect;
                          return (
                            <label key={option} className={cn('flex min-h-[36px] cursor-pointer items-center gap-2 text-sm', disabled ? 'text-gray-300' : 'text-gray-700')}>
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={disabled}
                                onChange={(e) => {
                                  setTouched(true);
                                  setAnswers((prev) => {
                                    const current = answerList(prev, field.id);
                                    return { ...prev, [field.id]: e.target.checked ? [...current, option] : current.filter((v) => v !== option) };
                                  });
                                }}
                                className="h-4 w-4 rounded"
                              />
                              {option}
                            </label>
                          );
                        })}
                        {maxSelect > 0 && <p className="pt-1 text-xs text-gray-400">최대 {maxSelect}개 선택</p>}
                      </div>
                    ) : field.type === 'select' ? (
                      <select
                        value={answerText(answers, field.id)}
                        onChange={(e) => { setTouched(true); setAnswers((prev) => ({ ...prev, [field.id]: e.target.value })); }}
                        className={cn('w-full rounded-lg border bg-white px-3 py-2.5 text-sm', invalid ? 'border-accent' : 'border-gray-200')}
                      >
                        <option value="">선택해 주세요</option>
                        {(field.options ?? []).map((option) => <option key={option} value={option}>{option}</option>)}
                      </select>
                    ) : (
                      <>
                        {/* 글자수 제한 */}
                        <textarea
                          value={answerText(answers, field.id)}
                          onChange={(e) => { setTouched(true); setAnswers((prev) => ({ ...prev, [field.id]: e.target.value })); }}
                          maxLength={(field.maxLength ?? 0) > 0 ? field.maxLength : undefined}
                          placeholder="답변을 입력해 주세요"
                          rows={(field.maxLength ?? 0) > 200 ? 5 : 3}
                          className={cn('w-full resize-y rounded-lg border px-3 py-2.5 text-sm focus:outline-none', invalid ? 'border-accent bg-accent/5' : 'border-gray-200 focus:border-gray-400')}
                        />
                        {(field.maxLength ?? 0) > 0 && (
                          <p className="text-right text-xs tabular-nums text-gray-400">{answerText(answers, field.id).length} / {field.maxLength}</p>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </FormSection>
        )}

      </div>

      {/* 제출 줄 — 화면 아래에 붙어 따라온다. 휴대폰에선 하단 탭바 위에, 버튼이 줄을 채운다(공모 상세의 지원 줄과 같은 모양).
          빈 칸 안내는 [지원하기]를 누를 때 한다(토스트 + 빨간 칸 + 그 칸으로 이동) — 줄에 '남은 것' 을 적지 않는다(2026-10-03 사용자 요청) */}
      <div className="sticky bottom-[calc(3.5rem+1px+env(safe-area-inset-bottom))] tabbar-hidden:bottom-0 z-30 -mx-6 mt-10 border-t border-gray-100 bg-white/95 px-6 py-3 backdrop-blur md:-mx-12 md:px-12 lg:bottom-0">
        {isEdit ? (
          // 고치기 — '고친 곳 N · 칸 이름' + [취소] [수정 저장](고친 게 없으면 저장을 잠근다)
          <div data-edit-bar className="flex items-center justify-between gap-3">
            <p className="min-w-0 shrink truncate text-sm text-gray-700">
              {changed.length > 0
                ? <>고친 곳 {changed.length}<span className="hidden text-gray-500 sm:inline"> · {EDIT_SECTIONS.filter(([k]) => changed.includes(k)).map(([, label]) => label).join(', ')}</span></>
                : <span className="text-gray-500">고친 곳이 없어요</span>}
            </p>
            <div className="flex flex-1 items-center justify-end gap-2 sm:flex-none">
              <button type="button" onClick={leaveEdit} className="hidden min-h-[44px] rounded-lg px-4 text-sm text-gray-600 hover:bg-gray-50 sm:inline-block">취소</button>
              <button
                type="button"
                onClick={submit}
                disabled={changed.length === 0 || editMutation.isPending}
                className="min-h-[44px] flex-1 rounded-lg bg-gray-900 px-6 text-sm font-semibold text-white hover:bg-gray-800 disabled:bg-gray-300 sm:flex-none"
              >
                {editMutation.isPending ? '저장 중…' : '수정 저장'}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-end">
            <button
              type="button"
              onClick={submit}
              disabled={applyMutation.isPending}
              className="min-h-[44px] flex-1 rounded-lg bg-gray-900 px-6 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50 sm:flex-none"
            >
              {applyMutation.isPending ? '지원 중...' : '지원하기'}
            </button>
          </div>
        )}
      </div>

      {confirmOpen && (
        <SubmitSheet
          title="지원서를 보낼까요?"
          subtitle={`${exhibition.title} · ${hostName}`}
          keyWidth="w-24"
          rows={[
            ['작가 약력', '입력함'],
            ['경력', careerSummary(career) || '없음'],
            ['작품 사진', (
              <span className="flex flex-wrap items-center gap-1.5">
                {images.slice(0, 4).map((u) => <Thumb key={u} src={u} alt="" className="h-9 w-9 bg-white object-contain" />)}
                <span className="ml-1">{images.length}장</span>
              </span>
            )],
            ['포트폴리오 파일', file ? (decodeURIComponent(file.split('/').pop() ?? '') || '있음') : '없음'],
            ...(fields.length > 0 ? [['추가 질문', `${fields.length - missingRequired.length}개 답함`] as [string, ReactNode]] : []),
          ]}
          terms={{ url: '/terms/artist_apply_real.txt', label: '작가 지원 약관' }}
          nagText="약관에 동의해야 지원할 수 있어요."
          cancelLabel="취소"
          confirmLabel="지원하기"
          pending={applyMutation.isPending}
          onConfirm={() => { setConfirmOpen(false); send(); }}
          onClose={() => setConfirmOpen(false)}
        />
      )}
    </div>
  );
}

/** 확인 창의 경력 한 줄 — '개인전 1 · 단체전 2'(비어 있는 항목은 빼고) */
function careerSummary(c: Career): string {
  const parts: [string, unknown[] | undefined][] = [['학력', c.education], ['개인전', c.solo], ['단체전', c.group], ['아트페어', c.artFair], ['수상', c.award]];
  return parts
    .map(([k, list]) => [k, (list ?? []).filter((e) => { const r = e as { year?: unknown; content?: unknown } | null; return String(r?.year ?? '').trim() || String(r?.content ?? '').trim(); }).length] as const)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${k} ${n}`)
    .join(' · ');
}
