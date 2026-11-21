/**
 * 공모 등록 폼 — 갤러리 공모(`MyPage` 의 `/exhibitions/new`)와 아트링크 주최 공모(`HostedExhibitionsSection`)가 **같이 쓴다**(2026-11-15).
 * 예전엔 두 화면에 같은 칸이 두 벌 복사돼 있었다(2026-10-28 에 모양만 맞췄다). 이제 칸·순서·필수 판정·미리보기가 여기 하나다.
 *
 * 순서 = 공고 상세 순서(규칙 83): 공고 → (운영 갤러리) → 일정 → 모집 내용 → 첨부파일 → 공모 소개 → 추가 질문.
 *  · 진행 범위(전시까지 / 공모만)는 **일정 맨 위** — 그 값이 아래 날짜 칸을 가른다
 *  · 지역은 고른 갤러리의 지역으로 미리 채운다(부르는 쪽)
 *  · 판단(남은 필수 칸 · 날짜 순서 · 미리보기)은 `exhibitionForm.tsx`
 * 상태(form)·제출·임시저장은 부르는 쪽이 갖는다 — 갤러리 공모는 약관·승인, 아트링크 주최는 바로 게시라 끝맺음이 다르다.
 * ⚠️ 값은 늘 함수형으로 합칠 것(`setForm(prev => …)`) — 편집기·달력이 처음 받은 콜백을 붙들 수 있다.
 */
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import { AlertTriangle } from 'lucide-react';
import { FormSection, FormField } from '@/components/flow/FormParts';
import { HeroImageEdit } from '@/components/shared/EditableField';
import CapacityPicker from '@/components/shared/CapacityPicker';
import ExhibitionScopePicker from '@/components/shared/ExhibitionScopePicker';
import SchedulePicker from '@/components/shared/SchedulePicker';
import LazyRichTextEditor from '@/components/shared/LazyRichTextEditor';
import { AttachmentEditor } from '@/components/shared/ExhibitionAttachments';
import { CustomQuestionBuilder } from '@/components/shared/CustomQuestionsEditor';
import { ChoiceButton } from '@/components/listing/ListControls';
import { formInputCls } from '@/lib/formStyles';
import { exhibitionSchedule, type ScheduleValues } from '@/lib/scheduleCalendar';
import { scheduleSummary } from '@/lib/scheduleSummary';
import { ATTACHMENT_TYPES_TEXT } from '@/lib/attachments';
import { REGION_CODES, regionLabels, exhibitionTypeLabels, cn } from '@/lib/utils';
import { exhibitionDateError, type ExFormValues } from '@/components/exhibition-form/exhibitionForm';

const TYPES = ['SOLO', 'GROUP', 'ART_FAIR'] as const;

export function ExhibitionFormBody({ form, setForm, errors, clearError, hostField, extraSection, onAttachBusy, idPrefix = 'ex' }: {
  form: ExFormValues;
  setForm: Dispatch<SetStateAction<any>>;
  errors: Set<string>;
  clearError: (key: string) => void;
  /** 공고 칸 안 '갤러리' 자리 — 갤러리 공모는 고르는 칸(하나면 이름만), 아트링크 주최는 없음 */
  hostField?: ReactNode;
  /** 공고 다음 구역 — 아트링크 주최의 '운영 갤러리 (선택)' */
  extraSection?: { title: string; node: ReactNode };
  onAttachBusy: (busy: boolean) => void;
  /** 칸 id 접두 — 갤러리 공모 'ex', 아트링크 주최 'hosted'(E2E 가 `#ex-start`·`#hosted-start` 로 찾는다) */
  idPrefix?: string;
}) {
  let n = 0;
  const next = () => ++n;
  const err = (k: string) => errors.has(k);
  const summary = scheduleSummary(form);
  const dateError = exhibitionDateError(form);
  return (
    <div className="space-y-2">
      <FormSection n={next()} title="공고">
        <div className="flex gap-4 sm:gap-6">
          <div className="w-[104px] shrink-0 sm:w-[150px]" data-field="imageUrl">
            {/* 목록 카드와 같은 모양 — 자르지 않고 남는 자리는 흐린 배경(규칙 18 · 2026-10-28) */}
            <HeroImageEdit fit="contain" value={form.imageUrl} onChange={(url) => setForm((prev: ExFormValues) => ({ ...prev, imageUrl: url }))} onRemove={() => setForm((prev: ExFormValues) => ({ ...prev, imageUrl: '' }))} className="aspect-[210/297] w-full" label="포스터" />
          </div>
          <div className="min-w-0 flex-1 space-y-4">
            <div data-field="title">
              <FormField label="공모 제목 *" error={err('title')} htmlFor={`${idPrefix}-title`}>
                <textarea
                  id={`${idPrefix}-title`}
                  rows={2}
                  data-form-error={err('title') || undefined}
                  value={form.title}
                  onChange={(e) => { const v = e.target.value.replace(/\n/g, ' '); setForm((prev: ExFormValues) => ({ ...prev, title: v })); clearError('title'); }}
                  placeholder="공모 제목"
                  className={cn(formInputCls(err('title')), 'resize-none leading-snug')}
                />
              </FormField>
            </div>
            {hostField}
          </div>
        </div>
      </FormSection>

      {extraSection && <FormSection n={next()} title={extraSection.title}>{extraSection.node}</FormSection>}

      <FormSection n={next()} title="일정">
        {/* 어디까지 진행할지 — 이 값이 아래 날짜 칸을 가른다(공모만 진행하면 출품 자료·전시 칸이 없다, 서버도 받지 않는다) */}
        <ExhibitionScopePicker
          bare
          recruitOnly={form.recruitOnly}
          onChange={(nextScope) => {
            setForm((prev: ExFormValues) => ({ ...prev, recruitOnly: nextScope, ...(nextScope ? { submissionDeadline: '', exhibitStartDate: '', exhibitDate: '' } : {}) }));
            ['submissionDeadline', 'exhibitStartDate', 'exhibitDate'].forEach(clearError);
          }}
        />
        {/* 달력 하나를 칸들이 나눠 쓴다(규칙 77) — 고르면 다음 칸으로, 지난 날·앞 칸보다 이른 날은 못 고른다 */}
        <div className="mt-5">
          {/* 남은 칸 표시 — 달력 칸 버튼 id 로 데려간다(lib/formJump) */}
          <span hidden data-field="deadlineStart" data-field-focus={`#${idPrefix}-start`} />
          <span hidden data-field="deadline" data-field-focus={`#${idPrefix}-deadline`} />
          <span hidden data-field="selectionDeadline" data-field-focus={`#${idPrefix}-selection`} />
          <span hidden data-field="submissionDeadline" data-field-focus={`#${idPrefix}-submission`} />
          <span hidden data-field="exhibitStartDate" data-field-focus={`#${idPrefix}-show-start`} />
          <span hidden data-field="exhibitDate" data-field-focus={`#${idPrefix}-show-end`} />
          <SchedulePicker
            {...exhibitionSchedule(!!form.recruitOnly, idPrefix)}
            values={form as unknown as ScheduleValues}
            errors={errors}
            onChange={(patch) => { setForm((prev: ExFormValues) => ({ ...prev, ...patch })); Object.keys(patch).forEach(clearError); }}
          />
          {summary && <p className="mt-5 text-sm text-gray-700"><span className="text-gray-500">한눈에 · </span>{summary}</p>}
          {dateError && <p className="mt-2 flex items-center gap-1 text-xs text-accent"><AlertTriangle size={12} aria-hidden /> {dateError}</p>}
        </div>
      </FormSection>

      <FormSection n={next()} title="모집 내용">
        <div className="space-y-4">
          <div role="group" aria-label="유형" className="flex flex-wrap items-center gap-x-5">
            <span className="w-20 text-sm font-medium text-gray-800">유형</span>
            {TYPES.map((t) => (
              <ChoiceButton key={t} on={form.type === t} onClick={() => setForm((prev: ExFormValues) => ({ ...prev, type: t }))} className="text-[15px]">
                {exhibitionTypeLabels[t]}
              </ChoiceButton>
            ))}
          </div>
          <div className="flex flex-wrap items-start gap-x-5 gap-y-2" data-field="capacity">
            <span className={cn('w-20 pt-2.5 text-sm font-medium', err('capacity') ? 'text-accent' : 'text-gray-800')}>모집 인원 *</span>
            {/* 0명·00명(2026-10-14) — 공고에는 그 글자만, 수락은 9·99명까지(CapacityPicker) */}
            <CapacityPicker
              inputId={`${idPrefix}-capacity`}
              error={err('capacity')}
              value={{ capacity: form.capacity, capacityMask: form.capacityMask ?? null }}
              onChange={(v) => { setForm((prev: ExFormValues) => ({ ...prev, ...v })); clearError('capacity'); }}
            />
          </div>
          <div className="flex flex-wrap items-center gap-x-5">
            <label htmlFor={`${idPrefix}-region`} className="w-20 text-sm font-medium text-gray-800">지역</label>
            <select id={`${idPrefix}-region`} value={form.region} onChange={(e) => setForm((prev: ExFormValues) => ({ ...prev, region: e.target.value }))} className={cn(formInputCls(), 'w-auto min-w-[8rem]')}>
              {REGION_CODES.map((r) => <option key={r} value={r}>{regionLabels[r]}</option>)}
            </select>
          </div>
        </div>
      </FormSection>

      {/* 첨부파일(2026-10-08) — 모집 요강·지원서 양식. 함수형 갱신(여러 파일을 차례로 올린다) */}
      <FormSection n={next()} title="첨부파일 (선택)">
        <FormField label="" hint={`첨부 가능 형식: ${ATTACHMENT_TYPES_TEXT}`}>
          <AttachmentEditor
            value={form.attachments}
            onChange={(update) => setForm((prev: ExFormValues) => ({ ...prev, attachments: update(prev.attachments ?? []) }))}
            onBusyChange={onAttachBusy}
          />
        </FormField>
      </FormSection>

      <FormSection n={next()} title="공모 소개 *">
        <div id={`${idPrefix}-desc`} data-field="description" data-form-error={err('description') || undefined} className={cn('rounded-lg', err('description') && 'ring-1 ring-accent')}>
          <LazyRichTextEditor
            value={form.description}
            onChange={(v) => { setForm((prev: ExFormValues) => ({ ...prev, description: v })); clearError('description'); }}
            placeholder="공모 소개"
            maxLength={20000}
            minHeight={200}
          />
        </div>
      </FormSection>

      <FormSection n={next()} title="추가 질문 (선택)">
        <CustomQuestionBuilder
          bare
          fields={form.customFields}
          onChange={(updateCustomFields) => setForm((prev: ExFormValues) => ({ ...prev, customFields: updateCustomFields(prev.customFields) }))}
        />
      </FormSection>
    </div>
  );
}

