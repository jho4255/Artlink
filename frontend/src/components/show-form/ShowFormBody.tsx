/**
 * 전시 등록 폼(2026-11-15) — `/shows/new`. 순서 = 전시 상세 순서(규칙 83 — 공모 등록과 같은 틀).
 *  1 전시 — 포스터(자르지 않는다 — 목록 카드와 같은 모양) · 전시 제목 · 갤러리(하나면 이름만)
 *  2 기간·관람 — 전시 기간(공모와 같은 달력, 지난날도 된다 — 이미 하고 있는 전시) · 관람 시간 · 입장료
 *  3 장소 — 갤러리를 고르면 그 주소로 채운다(바깥 장소면 고친다) · 지역
 *  4 참여 작가(선택) — 아트링크 작가면 [찾기]로 이어 둔다(상세에서 그 홈페이지로)
 *  5 전시 소개 · 6 전시 사진(선택)
 * 예전 폼은 '실제 상세 페이지에 보일 모습'이라며 칸을 상세 흉내 위에 얹었다 — 지금 미리보기는 진짜 카드·상세 부품이다(showForm.tsx).
 * ⚠️ 값은 늘 함수형으로 합칠 것(`setForm(prev => …)`) — 편집기·달력이 처음 받은 콜백을 붙들 수 있다.
 */
import { useEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { Check, Plus, Search, X } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import { FormSection, FormField } from '@/components/flow/FormParts';
import { HeroImageEdit } from '@/components/shared/EditableField';
import { MultiImageUpload } from '@/components/shared/ImageUpload';
import SchedulePicker from '@/components/shared/SchedulePicker';
import LazyRichTextEditor from '@/components/shared/LazyRichTextEditor';
import { formInputCls } from '@/lib/formStyles';
import { showSchedule, showScheduleFloor, todayKst, type ScheduleValues } from '@/lib/scheduleCalendar';
import { regionFromAddress } from '@/lib/listings';
import { REGION_CODES, regionLabels, displayName, cn } from '@/lib/utils';
import { openingHoursError, type ShowFormValues } from '@/components/show-form/showForm';
import type { ArtistEntry } from '@/types';

export function ShowFormBody({ form, setForm, artists, setArtists, errors, clearError, hostField }: {
  form: ShowFormValues;
  setForm: Dispatch<SetStateAction<ShowFormValues>>;
  artists: ArtistEntry[];
  setArtists: Dispatch<SetStateAction<ArtistEntry[]>>;
  errors: Set<string>;
  clearError: (key: string) => void;
  /** 전시 칸 안 '갤러리' 자리 — 승인된 갤러리가 하나면 이름만, 여럿이면 고르는 칸 */
  hostField: ReactNode;
}) {
  const err = (k: string) => errors.has(k);
  const set = (patch: Partial<ShowFormValues>) => setForm((prev) => ({ ...prev, ...patch }));
  const [open, close] = form.openingHours.split('-');
  const hoursError = openingHoursError(form.openingHours);
  const setHours = (a: string, b: string) => { set({ openingHours: a || b ? `${a}-${b}` : '' }); clearError('openingHours'); };

  return (
    <div className="space-y-2">
      <FormSection n={1} title="전시">
        <div className="flex gap-4 sm:gap-6">
          <div className="w-[104px] shrink-0 sm:w-[150px]" data-field="posterImage">
            <HeroImageEdit fit="contain" value={form.posterImage} onChange={(url) => { set({ posterImage: url }); clearError('posterImage'); }} onRemove={() => set({ posterImage: '' })} className={cn('aspect-[210/297] w-full', err('posterImage') && 'ring-1 ring-accent')} label="포스터" />
          </div>
          <div className="min-w-0 flex-1 space-y-4">
            <div data-field="title">
              <FormField label="전시 제목 *" error={err('title')} htmlFor="show-title">
                <textarea
                  id="show-title"
                  rows={2}
                  value={form.title}
                  data-form-error={err('title') || undefined}
                  onChange={(e) => { set({ title: e.target.value.replace(/\n/g, ' ') }); clearError('title'); }}
                  placeholder="전시 제목"
                  className={cn(formInputCls(err('title')), 'resize-none leading-snug')}
                />
              </FormField>
            </div>
            {hostField}
          </div>
        </div>
      </FormSection>

      <FormSection n={2} title="기간·관람">
        {/* 공모 일정과 같은 달력 — 시작을 고르면 종료로 넘어간다. 지난날도 된다(이미 하고 있는 전시) */}
        <span hidden data-field="startDate" data-field-focus="#show-start" />
        <span hidden data-field="endDate" data-field-focus="#show-end" />
        <SchedulePicker
          {...showSchedule('show')}
          floor={showScheduleFloor()}
          openFrom={todayKst()}
          values={form as unknown as ScheduleValues}
          errors={errors}
          onChange={(patch) => { setForm((prev) => ({ ...prev, ...patch })); Object.keys(patch).forEach(clearError); }}
        />
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div data-field="openingHours">
            <FormField label="관람 시간 *" error={err('openingHours') || !!hoursError} hint={hoursError ?? undefined}>
              <div className="flex items-center gap-2">
                <input type="time" aria-label="관람 시작 시간" value={open || ''} onChange={(e) => setHours(e.target.value, close || '')} className={cn(formInputCls(err('openingHours') && !open), 'min-w-0 flex-1')} />
                <span className="text-gray-400" aria-hidden>–</span>
                <input type="time" aria-label="관람 종료 시간" value={close || ''} onChange={(e) => setHours(open || '', e.target.value)} className={cn(formInputCls((err('openingHours') && !close) || !!hoursError), 'min-w-0 flex-1')} />
              </div>
            </FormField>
          </div>
          <div data-field="admissionFee">
            <FormField label="입장료 *" error={err('admissionFee')} htmlFor="show-fee">
              <input id="show-fee" value={form.admissionFee} data-form-error={err('admissionFee') || undefined} onChange={(e) => { set({ admissionFee: e.target.value }); clearError('admissionFee'); }} placeholder="무료, 5,000원" className={formInputCls(err('admissionFee'))} />
            </FormField>
          </div>
        </div>
      </FormSection>

      <FormSection n={3} title="장소">
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
          <div data-field="location">
            <FormField label="장소 *" error={err('location')} htmlFor="show-location">
              <input
                id="show-location"
                value={form.location}
                data-form-error={err('location') || undefined}
                onChange={(e) => { set({ location: e.target.value }); clearError('location'); }}
                onBlur={() => { const r = regionFromAddress(form.location); if (r) set({ region: r }); }}
                placeholder="장소"
                className={formInputCls(err('location'))}
              />
            </FormField>
          </div>
          <FormField label="지역" htmlFor="show-region">
            <select id="show-region" value={form.region} onChange={(e) => set({ region: e.target.value })} className={cn(formInputCls(), 'w-auto min-w-[8rem]')}>
              {REGION_CODES.map((r) => <option key={r} value={r}>{regionLabels[r]}</option>)}
            </select>
          </FormField>
        </div>
      </FormSection>

      <FormSection n={4} title="참여 작가 (선택)">
        <ShowArtistsEditor artists={artists} setArtists={setArtists} />
      </FormSection>

      <FormSection n={5} title="전시 소개 *">
        <div data-field="description" data-form-error={err('description') || undefined} className={cn('rounded-lg', err('description') && 'ring-1 ring-accent')}>
          {/* 서식 있는 글(2026-10-03, 공모 소개와 같은 편집기). 함수형 갱신 */}
          <LazyRichTextEditor value={form.description} onChange={(v) => { setForm((prev) => ({ ...prev, description: v })); clearError('description'); }} placeholder="전시 소개" maxLength={20000} minHeight={200} />
        </div>
      </FormSection>

      <FormSection n={6} title="전시 사진 (선택)">
        <MultiImageUpload
          images={form.additionalImages}
          onAdd={(url: string) => setForm((prev) => ({ ...prev, additionalImages: [...prev.additionalImages, { url }] }))}
          onRemove={(index: number) => setForm((prev) => ({ ...prev, additionalImages: prev.additionalImages.filter((_, i) => i !== index) }))}
          maxCount={10}
        />
      </FormSection>
    </div>
  );
}

/**
 * 참여 작가 — 이름을 적고, 아트링크 작가면 [찾기]로 이어 둔다(상세에서 그 작가 홈페이지로 간다).
 * 검색 결과는 바깥을 누르거나 Esc 로 닫는다(예전엔 고를 때만 닫혀 아래 줄을 덮었다 — 감사 M20).
 */
function ShowArtistsEditor({ artists, setArtists }: { artists: ArtistEntry[]; setArtists: Dispatch<SetStateAction<ArtistEntry[]>> }) {
  const [results, setResults] = useState<{ id: number; name: string; nickname?: string | null; avatar?: string }[]>([]);
  const [searchingIdx, setSearchingIdx] = useState<number | null>(null);

  useEffect(() => {
    if (searchingIdx === null) return;
    const onDown = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest?.('[data-artist-search]')) setSearchingIdx(null); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSearchingIdx(null); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [searchingIdx]);

  const search = async (idx: number) => {
    const name = artists[idx]?.name?.trim();
    if (!name) { toast.error('작가 이름을 입력해주세요.'); return; }
    try {
      const res = await api.get(`/portfolio/search?q=${encodeURIComponent(name)}`);
      setResults(res.data);
      setSearchingIdx(idx);
    } catch { toast.error('검색에 실패했습니다.'); }
  };
  const link = (idx: number, u: { id: number; name: string }) => {
    setArtists((prev) => prev.map((a, i) => (i === idx ? { name: u.name, userId: u.id } : a)));
    setSearchingIdx(null);
    setResults([]);
  };

  return (
    <div className="space-y-2">
      {artists.map((artist, idx) => (
        <div key={idx} data-artist-search className="relative">
          <div className="flex items-center gap-2">
            <input
              placeholder="작가 이름"
              aria-label={`참여 작가 ${idx + 1}`}
              value={artist.name}
              onChange={(e) => { const v = e.target.value; setArtists((prev) => prev.map((a, i) => (i === idx ? { name: v } : a))); }}
              className={cn(formInputCls(), 'min-w-0 flex-1', artist.userId && 'border-gray-400 bg-gray-50')}
            />
            {artist.userId ? (
              <span className="flex shrink-0 items-center gap-1 text-xs text-gray-600">
                <Check size={12} aria-hidden className="text-green-600" /> 연동됨
                <button type="button" onClick={() => { setArtists((prev) => prev.map((a, i) => (i === idx ? { name: a.name } : a))); toast('작가 연동을 해제했습니다.'); }}
                  className="ml-1 min-h-[36px] rounded border border-gray-200 px-2 text-[12px] text-gray-600 hover:border-gray-400 hover:text-gray-900">
                  연동 해제
                </button>
              </span>
            ) : (
              <button type="button" onClick={() => search(idx)} className="inline-flex min-h-[42px] shrink-0 items-center gap-1 rounded-lg border border-gray-200 px-3 text-sm text-gray-700 hover:border-gray-400">
                <Search size={14} aria-hidden /> 찾기
              </button>
            )}
            {artists.length > 1 && (
              <button type="button" onClick={() => setArtists((prev) => prev.filter((_, i) => i !== idx))} aria-label="작가 빼기" className="grid h-10 w-10 shrink-0 place-items-center text-gray-400 hover:text-accent">
                <X size={15} aria-hidden />
              </button>
            )}
          </div>
          {searchingIdx === idx && (
            <div className="absolute left-0 right-0 top-full z-10 mt-1 max-h-48 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
              {results.length === 0 ? (
                <p className="px-3 py-2.5 text-sm text-gray-500">검색 결과가 없습니다.</p>
              ) : results.map((u) => (
                <button key={u.id} type="button" onClick={() => link(idx, u)} className="flex min-h-[44px] w-full items-center gap-2 px-3 text-left text-sm hover:bg-gray-50">
                  {u.avatar ? <img src={u.avatar} alt="" className="h-6 w-6 rounded-full object-cover" /> : <span className="h-6 w-6 rounded-full bg-gray-200" />}
                  {/* 사이트에서 보이는 이름(닉네임)으로 찾고 본명을 곁들인다 — 연동 값은 본명 유지 */}
                  {displayName(u)}{u.nickname && u.nickname !== u.name ? <span className="text-xs text-gray-500">({u.name})</span> : null}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
      <button type="button" onClick={() => setArtists((prev) => [...prev, { name: '' }])} className="inline-flex min-h-[40px] items-center gap-1 text-sm text-gray-600 hover:text-gray-900">
        <Plus size={14} aria-hidden /> 작가 추가
      </button>
    </div>
  );
}
