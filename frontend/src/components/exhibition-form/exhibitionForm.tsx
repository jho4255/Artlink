/**
 * 공모 등록 폼의 판단 — 남은 필수 칸 · 날짜 순서 · 칸으로 데려가기 · 미리보기(2026-11-15).
 * 폼 본문(`ExhibitionFormBody`)과 부르는 두 화면(갤러리 공모 · 아트링크 주최 공모)이 같이 쓴다 — 하단 줄의 '남은 필수'와
 * [등록 요청]이 같은 목록을 본다. 미리보기는 모집공고 목록 카드·공고 상세 부품을 그대로 쓴다(흉내 내지 않는다).
 * (컴포넌트 파일과 나눈 이유: 컴포넌트와 함수를 한 파일에서 내보내면 개발 서버의 빠른 새로고침이 그 파일을 통째로 다시 불러온다)
 */
import SkeletonImage from '@/components/shared/SkeletonImage';
import HostBadge from '@/components/shared/HostBadge';
import RichText from '@/components/shared/RichText';
import { DeadlineText, Fact, ScheduleStrip } from '@/components/exhibition/DetailBits';
import { regionLabels, exhibitionTypeLabels, capacityError, capacityText, validateExhibitionDates, type CapacityMask } from '@/lib/utils';
import { richTextLength } from '@/lib/richText';
import { addressArea, deadlineView, scheduleSteps } from '@/lib/listings';
import type { ExhibitionAttachment } from '@/lib/attachments';
import type { MissingField } from '@/components/form/StickySubmitBar';
import type { Preview } from '@/components/form/PreviewPane';
import type { CustomField, Exhibition } from '@/types';

export interface ExFormValues {
  title: string;
  type: string;
  deadlineStart: string;
  deadline: string;
  /** 선정 마감일(규칙 90) — 진행 범위와 상관없이 필수 */
  selectionDeadline: string;
  exhibitStartDate: string;
  exhibitDate: string;
  submissionDeadline: string;
  recruitOnly: boolean;
  capacity: number;
  capacityMask: CapacityMask | null;
  region: string;
  description: string;
  imageUrl: string;
  customFields: CustomField[];
  attachments: ExhibitionAttachment[];
  galleryId?: number;
}

/**
 * 남은 필수 칸 — 폼 순서대로. 하단 줄('남은 필수 N · 칸 이름')과 [등록 요청] 이 같은 답을 본다.
 * 날짜 순서 오류는 `validateExhibitionDates`(lib/utils) 가 따로 본다.
 */
export function exhibitionMissing(form: ExFormValues, opts: { needGallery: boolean }): MissingField[] {
  const m: MissingField[] = [];
  if (opts.needGallery && !form.galleryId) m.push({ key: 'galleryId', label: '갤러리' });
  if (!form.title.trim()) m.push({ key: 'title', label: '공모 제목' });
  if (!form.deadlineStart) m.push({ key: 'deadlineStart', label: '접수 시작일' });
  if (!form.deadline) m.push({ key: 'deadline', label: '접수 마감일' });
  if (!form.selectionDeadline) m.push({ key: 'selectionDeadline', label: '선정 마감일' });
  if (!form.recruitOnly) {
    if (!form.submissionDeadline) m.push({ key: 'submissionDeadline', label: '출품 자료 제출 마감일' });
    if (!form.exhibitStartDate) m.push({ key: 'exhibitStartDate', label: '전시 시작일' });
    if (!form.exhibitDate) m.push({ key: 'exhibitDate', label: '전시 종료일' });
  }
  if (!form.capacityMask && capacityError(form.capacity)) m.push({ key: 'capacity', label: '모집 인원' });
  if (richTextLength(form.description) === 0) m.push({ key: 'description', label: '공모 소개' });
  return m;
}

/** 날짜 순서 오류 — 공모만 진행이면 자료 제출·전시 칸이 없으니 남은 값으로 검사하지 않는다(서버와 같은 규칙, lib/utils) */
export function exhibitionDateError(form: ExFormValues): string | null {
  return validateExhibitionDates({
    deadlineStart: form.deadlineStart || undefined,
    deadline: form.deadline,
    exhibitStartDate: form.recruitOnly ? undefined : (form.exhibitStartDate || undefined),
    exhibitDate: form.recruitOnly ? undefined : (form.exhibitDate || undefined),
    submissionDeadline: form.recruitOnly ? undefined : (form.submissionDeadline || undefined),
    selectionDeadline: form.selectionDeadline || undefined,
  });
}


const ymdToIso = (v: string) => (v ? new Date(v).toISOString() : '');

/** 폼 값 → 목록 카드·상세 부품이 받는 모양(아직 없는 공고 — id 0, 승인 전) */
export function exhibitionPreviewData(form: ExFormValues, host: { gallery?: { id: number; name: string; mainImage?: string; region?: string } | null; adminHosted?: boolean }): Exhibition {
  return {
    id: 0,
    title: form.title.trim() || '공모 제목',
    type: form.type,
    region: form.region,
    capacity: form.capacity,
    capacityMask: form.capacityMask,
    deadline: ymdToIso(form.deadline),
    deadlineStart: ymdToIso(form.deadlineStart) || null,
    imageUrl: form.imageUrl,
    hostType: host.adminHosted ? 'ADMIN' : 'GALLERY',
    gallery: host.gallery ?? null,
    recruitmentClosed: false,
    ended: false,
    recruitOnly: form.recruitOnly,
  } as unknown as Exhibition;
}

/**
 * 미리보기 — [공고 상세] 첫 화면(휴대폰 A안 모양 + 일정 띠 + 모집 내용 + 첨부 + 소개).
 * 모집공고 목록 카드는 미리 보여 주지 않는다(2026-11-15 사용자 결정 — 상세만 보면 된다).
 */
export function exhibitionPreview(form: ExFormValues, host: { gallery?: { id: number; name: string; mainImage?: string; region?: string; address?: string } | null; adminHosted?: boolean; managers?: string[] }): Preview {
  const ex = exhibitionPreviewData(form, host);
  const hasDeadline = !!form.deadline;
  const steps = hasDeadline ? scheduleSteps({
    deadline: ex.deadline,
    deadlineStart: ex.deadlineStart,
    selectionDeadline: ymdToIso(form.selectionDeadline) || null,
    submissionDeadline: ymdToIso(form.submissionDeadline) || null,
    exhibitStartDate: ymdToIso(form.exhibitStartDate) || null,
    exhibitDate: ymdToIso(form.exhibitDate) || null,
    recruitOnly: form.recruitOnly,
  }) : [];
  const poster = form.imageUrl || host.gallery?.mainImage || '';
  const detail = (
    <div>
      <div className="flex gap-4">
        <SkeletonImage src={poster} thumb="grid" alt="" fallbackLabel={ex.title} className="aspect-[210/297] w-[96px] shrink-0" imgClassName="object-contain" blurFill />
        <div className="min-w-0 flex-1">
          {hasDeadline && <DeadlineText dv={deadlineView(ex)} className="text-[13px] text-gray-600" />}
          {host.adminHosted && <HostBadge exhibition={ex} className="mt-1.5 block" />}
          <p className="mt-1.5 text-[18px] font-semibold leading-snug tracking-tight text-gray-900 break-keep [overflow-wrap:anywhere]">{ex.title}</p>
          {host.adminHosted ? (
            <p className="mt-1.5 text-[13px] text-gray-600">{host.managers?.length ? `참여 갤러리 : ${host.managers.join(', ')}` : '아트링크가 직접 진행합니다.'}</p>
          ) : host.gallery && (
            <p className="mt-1.5 text-[13px] text-gray-600"><b className="font-medium text-gray-900">{host.gallery.name}</b><span className="ml-1.5">{addressArea(host.gallery.address, host.gallery.region ?? form.region)}</span></p>
          )}
        </div>
      </div>
      {steps.length > 0 && <div className="mt-5"><ScheduleStrip steps={steps} compact /></div>}
      <dl className="mt-4 grid grid-cols-3 gap-x-2 border-b border-gray-100 pb-2">
        <Fact label="유형" compact>{exhibitionTypeLabels[form.type]}</Fact>
        <Fact label="모집 인원" compact>{capacityText(ex)}</Fact>
        <Fact label="지역" compact>{regionLabels[form.region]}</Fact>
      </dl>
      {form.recruitOnly && <p className="mt-2 text-[12px] text-gray-600 break-keep">지원자 선정(수락)까지 진행해요. 출품 자료·전시 운영·정산 단계는 없어요.</p>}
      {form.attachments.length > 0 && (
        <ul className="mt-3 text-[13px] text-gray-800">
          {form.attachments.map((a, i) => <li key={i} className="truncate border-b border-gray-100 py-1.5">{a.name}</li>)}
        </ul>
      )}
      {richTextLength(form.description) > 0 && (
        <div className="relative mt-4 max-h-40 overflow-hidden">
          <RichText value={form.description} className="text-[13px] leading-relaxed text-gray-700 break-keep [overflow-wrap:anywhere]" />
          <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-white to-transparent" />
        </div>
      )}
    </div>
  );
  return { label: '공고 상세', node: detail };
}
