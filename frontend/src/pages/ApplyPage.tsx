/**
 * ApplyPage — 공모 지원서 (/exhibitions/:id/apply, 2026-09-29)
 *
 * 예전엔 공모 상세 위의 모달(448px)이었다. 좁은 창 안에서 따로 스크롤되고, 경력 세 칸·포트폴리오 파일마다
 * '없음' 을 체크하지 않으면 제출이 막혔다(비워 두고 누르면 오류 네 개). 그 부담을 덜어 주는
 * [포트폴리오 불러오기]는 작은 외곽선 버튼이라 잘 안 보였고, 모달엔 어떤 공모인지도 적혀 있지 않았다.
 *
 * 지금은:
 *  - 전용 페이지 — 맨 위에 공모명·갤러리·마감을 적고, 번호 붙은 구역(약력 · 경력 · 작품 사진 · 포트폴리오 파일 · 추가 질문 · 약관)
 *  - **열리면 홈페이지(포트폴리오) 내용으로 채운다** — 대부분의 작가는 고칠 것만 고치고 낸다
 *  - '없음' 체크 없음 — 비워 두면 없는 것이다(서버는 원래 빈 경력·파일을 받는다)
 *  - 필수는 약력 · 작품 사진 1장 · 필수 추가 질문 · 약관뿐. 하단 고정 줄이 **아직 남은 것**을 말하고,
 *    [지원하기]를 누르면 비어 있는 칸으로 데려간다(예전엔 약관 동의 전까지 버튼이 이유 없이 회색이었다)
 *
 * ⚠️ 약관 버전은 서버와 같아야 한다 — `backend/src/lib/terms.ts`, 검사는 `terms-consistency.test.ts`.
 * ⚠️ 이미 지원했거나 마감됐거나 작가가 아니면 상세로 되돌린다(서버도 400 으로 막는다) — 다 쓰고 나서 400 을 받게 하지 않는다.
 * 초대받은 작가의 '간편 지원'(`InviteApplyModal`)은 상세 페이지에 그대로 있다.
 */
import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ExternalLink, RotateCw } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import { useAuthStore } from '@/stores/authStore';
import { getDday, cn } from '@/lib/utils';
import { isCareerEmpty, normalizeCareer } from '@/lib/artwork';
import { ddayText } from '@/lib/flowLabels';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import CareerEditor from '@/components/shared/CareerEditor';
import PortfolioFileInput from '@/components/shared/PortfolioFileInput';
import { MultiImageUpload } from '@/components/shared/ImageUpload';
import Notice from '@/components/flow/Notice';
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

export default function ApplyPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuthStore();

  const { data: exhibition, isLoading, isError } = useQuery<ApplyExhibition>({
    queryKey: ['exhibition', id],
    queryFn: () => api.get(`/exhibitions/${id}`).then(r => r.data),
    enabled: !!id,
    staleTime: 0,
    refetchOnMount: 'always',
    retry: (count, err: any) => (err?.response?.status ?? 500) >= 500 && count < 2,
  });

  const [terms, setTerms] = useState('');
  const [agreed, setAgreed] = useState(false);
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

  // 지원 약관 텍스트
  useEffect(() => {
    fetch('/terms/artist_apply_real.txt')
      .then(r => { if (!r.ok || r.headers.get('content-type')?.includes('text/html')) throw new Error('not text'); return r.text(); })
      .then(t => { if (!t.trimStart().startsWith('<!') && !t.trimStart().startsWith('<html')) setTerms(t); })
      .catch(() => setTerms('이 공모에 지원하시겠습니까? 지원서가 갤러리에 전송됩니다.'));
  }, []);

  // 홈페이지(포트폴리오) — 마이페이지와 같은 쿼리 키라 방금 고친 내용이 그대로 온다. 없으면(404) 빈 지원서로 시작한다
  const { data: portfolio, isError: portfolioMissing, refetch: refetchPortfolio } = useQuery<any>({
    queryKey: ['portfolio'],
    queryFn: () => api.get('/portfolio').then(r => r.data),
    enabled: user?.role === 'ARTIST',
    retry: false,
  });

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
  // 처음 한 번만 — 렌더 중 상태 맞추기(effect 안 setState 대신). 그 뒤로는 작가가 고친 것을 덮지 않는다
  if (prefill === 'loading' && (portfolio || portfolioMissing)) {
    setPrefill(portfolio && fillFrom(portfolio) ? 'filled' : 'empty');
  }
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

  // 쓰다가 떠나면 경고 — 지원서는 길다
  useUnsavedChanges(touched);

  const applyMutation = useMutation({
    mutationFn: (payload: { biography: string; career: Career; artworkImages: string[]; portfolioFileUrl: string | null; customAnswers?: CustomAnswer[]; termsAgreed: boolean; termsVersion: string }) =>
      api.post(`/exhibitions/${id}/apply`, payload),
    onSuccess: () => {
      // 먼저 떠난다 — 이탈 경고 훅이 쌓아 둔 기록을 라우터가 갈아끼우게(규칙 같은 이유로 다른 폼도 저장 뒤 이동)
      navigate(`/exhibitions/${id}`, { replace: true });
      toast.success('지원했어요! 결과는 알림으로 알려 드려요.');
      queryClient.invalidateQueries({ queryKey: ['exhibition', id] });
      queryClient.invalidateQueries({ queryKey: ['exhibitions'] });
      queryClient.invalidateQueries({ queryKey: ['my-applications'] });
    },
    onError: (err: any) => toast.error(err.response?.data?.error || '지원 중 오류가 발생했습니다.'),
  });

  if (isLoading || !user) {
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
  // 지원할 수 없는 경우 — 상세로(상세가 이유를 보여 준다: 이미 지원함 / 마감 / 작가 계정만)
  const expired = getDday(exhibition.deadline) < 0 || !!exhibition.recruitmentClosed || !!exhibition.ended;
  if (user.role !== 'ARTIST' || exhibition.myApplication || expired) {
    return <Navigate to={`/exhibitions/${id}`} replace />;
  }

  const fields = exhibition.customFields ?? [];
  const missingRequired = fields.filter((f) => {
    if (!f.required) return false;
    const v = answers[f.id];
    return Array.isArray(v) ? v.length === 0 : !String(v ?? '').trim();
  });
  const missing: { key: string; label: string }[] = [
    ...(!biography.trim() ? [{ key: 'bio', label: '작가 약력' }] : []),
    ...(images.length === 0 ? [{ key: 'images', label: '작품 사진' }] : []),
    ...missingRequired.map((f) => ({ key: `q-${f.id}`, label: `추가 질문 “${f.label}”` })),
    ...(!agreed ? [{ key: 'terms', label: '약관 동의' }] : []),
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
    const clean = (list: Career['solo']) => list.filter((e) => e.year.trim() || e.content.trim());
    applyMutation.mutate({
      biography: biography.trim(),
      // 비어 있는 경력은 '없음' — 예전처럼 따로 체크하게 하지 않는다
      career: { artFair: clean(career.artFair), solo: clean(career.solo), group: clean(career.group) },
      artworkImages: images,
      portfolioFileUrl: file,
      customAnswers: buildCustomAnswers(fields, answers),
      termsAgreed: true,
      termsVersion: ARTIST_APPLY_TERMS_VERSION,
    });
  };

  const deadlineLabel = ddayText('마감', exhibition.deadline);
  const hostName = exhibition.gallery?.name ?? '아트링크';

  return (
    <div className="mx-auto max-w-3xl px-6 pb-4 pt-6 md:px-12 md:pt-10">
      <button type="button" onClick={() => navigate(-1)} className="-ml-1 inline-flex min-h-[44px] items-center gap-1 px-1 text-sm text-gray-500 hover:text-gray-900">
        <ArrowLeft size={16} aria-hidden /> 공모로 돌아가기
      </button>

      <header className="mt-2">
        <p className="text-sm text-gray-500">지원서</p>
        <h1 className="mt-1 break-keep text-2xl font-semibold leading-tight text-gray-950 md:text-3xl">{exhibition.title}</h1>
        <p className="mt-2 text-sm text-gray-500">
          {hostName}
          {deadlineLabel && <> · <span className="font-medium tabular-nums text-gray-900">{deadlineLabel}</span></>}
          {exhibition.recruitOnly && ' · 선정(수락)까지만 진행하는 공모'}
        </p>
      </header>

      {/* 홈페이지로 채웠는지 — 채웠으면 무엇을 해야 하는지(고쳐서 낸다)만 말한다 */}
      <div className="mt-6">
        {prefill === 'loading' ? (
          <div className="h-12 animate-pulse rounded-xl bg-gray-50" />
        ) : prefill === 'filled' ? (
          <Notice action={(
            <button type="button" onClick={reloadPortfolio} className="inline-flex min-h-[40px] items-center gap-1 text-sm text-gray-600 underline-offset-4 hover:text-gray-900 hover:underline">
              <RotateCw size={13} aria-hidden /> 다시 불러오기
            </button>
          )}>
            홈페이지(포트폴리오)에 적은 약력·경력·작품으로 채웠어요. 이 공모에 맞게 고쳐서 지원하세요.
          </Notice>
        ) : (
          <Notice>
            홈페이지에 아직 적은 내용이 없어요 — 여기서 바로 써도 돼요. 홈페이지를 채워 두면 다음 지원부터는 자동으로 채워져요.
          </Notice>
        )}
      </div>

      <div className="mt-8 space-y-8">
        <FormSection n={1} id="apply-bio" title="작가 약력 *" description="어떤 작업을 하는 작가인지, 갤러리가 가장 먼저 읽는 글이에요.">
          <textarea
            value={biography}
            onChange={(e) => edit(setBiography)(e.target.value)}
            placeholder="작가 소개·약력을 입력하세요."
            rows={6}
            className={cn('w-full resize-y rounded-lg border px-3 py-2.5 text-sm leading-relaxed focus:outline-none', bad('bio') ? 'border-accent bg-accent/5' : 'border-gray-200 focus:border-gray-400')}
          />
          {bad('bio') && <p className="mt-1.5 text-xs text-accent">약력을 적어 주세요.</p>}
        </FormSection>

        <FormSection n={2} title="경력" description="한 줄에 한 건씩. 없는 항목은 비워 두면 '없음'으로 보내요.">
          <CareerEditor value={career} onChange={edit(setCareer)} />
        </FormSection>

        <FormSection n={3} id="apply-images" title="작품 사진 *" description={`1장 이상, 최대 ${MAX_IMAGES}장. 갤러리가 지원서와 함께 보는 대표 작품이에요.`}>
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

        <FormSection n={4} title="포트폴리오 파일" description="PDF · DOC · HWP. 없으면 비워 두세요.">
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
          <FormSection n={5} id="apply-questions" title="갤러리 추가 질문" description="이 공모를 연 갤러리가 따로 묻는 것이에요.">
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
                        {/* 글자수 제한은 초대 모달(InviteApplyModal)과 같은 규칙 */}
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

        <FormSection n={fields.length > 0 ? 6 : 5} id="apply-terms" title="약관 *">
          <div className={cn('overflow-hidden rounded-xl border', bad('terms') ? 'border-accent' : 'border-gray-200')}>
            <div className="max-h-44 overflow-y-auto whitespace-pre-wrap bg-white p-3 text-xs leading-relaxed text-gray-600">{terms || '약관 로딩 중...'}</div>
            <label className="flex min-h-[48px] cursor-pointer items-center gap-2 border-t border-gray-200 bg-gray-50 px-3 text-sm">
              <input type="checkbox" checked={agreed} onChange={(e) => { setAgreed(e.target.checked); setTouched(true); }} className="h-4 w-4 rounded" />
              위 약관에 동의합니다
            </label>
          </div>
        </FormSection>
      </div>

      {/* 제출 줄 — 화면 아래에 붙어 따라온다. 휴대폰에선 하단 탭바 위에. 아직 남은 것을 말한다 */}
      <div className="sticky bottom-[calc(3.5rem+1px+env(safe-area-inset-bottom))] z-30 -mx-6 mt-10 border-t border-gray-100 bg-white/95 px-6 py-3 backdrop-blur md:-mx-12 md:px-12 lg:bottom-0">
        <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
          <p className="mr-auto min-w-0 text-xs text-gray-500">
            {missing.length === 0
              ? <>다 채웠어요. 지원하면 {hostName}에 지원서가 전달돼요.</>
              : <>남은 것 · <span className={validated ? 'text-accent' : 'text-gray-700'}>{missing.map((m) => m.label).join(' · ')}</span></>}
          </p>
          <button
            type="button"
            onClick={submit}
            disabled={applyMutation.isPending}
            className="min-h-[44px] rounded-lg bg-gray-900 px-6 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {applyMutation.isPending ? '지원 중...' : '지원하기'}
          </button>
        </div>
      </div>
    </div>
  );
}
