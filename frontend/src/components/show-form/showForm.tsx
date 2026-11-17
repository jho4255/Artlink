/**
 * 전시 등록 폼의 판단 — 남은 필수 칸 · 미리보기(2026-11-15, 공모·갤러리 등록과 같은 틀).
 * 미리보기는 전시 찾기 카드(`ShowCard`·`ShowRow`)와 전시 상세의 부품(`ShowPeriodLine`·`ScheduleStrip`·`Fact`)을 **그대로** 쓴다.
 * (컴포넌트 파일과 나눈 이유: 한 파일에서 컴포넌트와 함수를 함께 내보내면 개발 서버의 빠른 새로고침이 그 파일을 통째로 다시 불러온다)
 */
import SkeletonImage from '@/components/shared/SkeletonImage';
import RichText from '@/components/shared/RichText';
import { ShowPeriodLine, type ShowCardData } from '@/components/listing/ShowCards';
import { Fact, ScheduleStrip } from '@/components/exhibition/DetailBits';
import { regionLabels } from '@/lib/utils';
import { richTextLength } from '@/lib/richText';
import { addressArea, artistsLine, openingHoursText, showSteps } from '@/lib/listings';
import type { MissingField } from '@/components/form/StickySubmitBar';
import type { Preview } from '@/components/form/PreviewPane';
import type { ArtistEntry } from '@/types';

export interface ShowFormValues {
  title: string;
  description: string;
  startDate: string;
  endDate: string;
  /** '10:00-18:00' — 시작·끝 시간 칸 둘을 이어 저장한다(상세는 openingHoursText 로 '10:00 – 18:00') */
  openingHours: string;
  admissionFee: string;
  location: string;
  region: string;
  posterImage: string;
  galleryId: number;
  additionalImages: { url: string }[];
}

export const emptyShowForm: ShowFormValues = {
  title: '', description: '', startDate: '', endDate: '',
  openingHours: '', admissionFee: '', location: '', region: 'SEOUL',
  posterImage: '', galleryId: 0,
  additionalImages: [],
};

export const OPENING_HOURS_RE = /^\d{2}:\d{2}-\d{2}:\d{2}$/;

/** 남은 필수 칸 — 폼 순서대로(하단 줄 '남은 필수'와 [등록 요청]이 같은 목록을 본다) */
export function showMissing(form: ShowFormValues, opts: { needGallery: boolean }): MissingField[] {
  const m: MissingField[] = [];
  if (!form.posterImage) m.push({ key: 'posterImage', label: '포스터' });
  if (!form.title.trim()) m.push({ key: 'title', label: '전시 제목' });
  if (opts.needGallery && !form.galleryId) m.push({ key: 'galleryId', label: '갤러리' });
  if (!form.startDate) m.push({ key: 'startDate', label: '전시 시작일' });
  if (!form.endDate) m.push({ key: 'endDate', label: '전시 종료일' });
  if (!OPENING_HOURS_RE.test(form.openingHours)) m.push({ key: 'openingHours', label: '관람 시간' });
  if (!form.admissionFee.trim()) m.push({ key: 'admissionFee', label: '입장료' });
  if (!form.location.trim()) m.push({ key: 'location', label: '장소' });
  if (richTextLength(form.description) === 0) m.push({ key: 'description', label: '전시 소개' });
  return m;
}

/** 관람 시간 순서 — 끝 시간이 시작보다 이르면 틀렸다(밤샘 전시는 없다고 본다) */
export function openingHoursError(v: string): string | null {
  if (!OPENING_HOURS_RE.test(v)) return null;
  const [a, b] = v.split('-');
  return a < b ? null : '관람 끝 시간은 시작 시간보다 늦어야 해요.';
}

const ymdToIso = (v: string) => (v ? new Date(v).toISOString() : '');

/**
 * 미리보기 — [전시 상세] 첫 화면(포스터 · 기간 · 제목 · 갤러리 · 기간 띠 · 관람 정보 · 소개). 승인된 뒤에 보인다.
 * 전시 찾기 카드는 미리 보여 주지 않는다(2026-11-15 사용자 결정 — 상세만 보면 된다).
 */
export function showPreview(form: ShowFormValues, artists: ArtistEntry[], gallery: { id: number; name: string } | null): Preview {
  const named = artists.filter((a) => a.name.trim());
  const hasDates = !!form.startDate && !!form.endDate;
  const show: ShowCardData = {
    id: 0,
    title: form.title.trim() || '전시 제목',
    startDate: ymdToIso(form.startDate),
    endDate: ymdToIso(form.endDate),
    location: form.location,
    region: form.region,
    artists: named,
    posterImage: form.posterImage,
    isFavorited: false,
    gallery,
  };
  const detail = (
    <div>
      <div className="flex gap-4">
        <SkeletonImage src={form.posterImage} thumb="grid" alt="" fallbackLabel={show.title} className="aspect-[210/297] w-[96px] shrink-0" imgClassName="object-contain" blurFill />
        <div className="min-w-0 flex-1">
          {hasDates && <ShowPeriodLine show={show} className="text-[13px]" />}
          <p className="mt-1.5 text-[18px] font-semibold leading-snug tracking-tight text-gray-900 break-keep [overflow-wrap:anywhere]">{show.title}</p>
          {gallery && (
            <p className="mt-1.5 text-[13px] text-gray-600"><b className="font-medium text-gray-900">{gallery.name}</b><span className="ml-1.5">{addressArea(form.location, form.region)}</span></p>
          )}
        </div>
      </div>
      {hasDates && <div className="mt-5"><ScheduleStrip steps={showSteps(show)} compact /></div>}
      <dl className="mt-4 grid grid-cols-3 gap-x-2 border-b border-gray-100 pb-2">
        <Fact label="관람 시간" compact>{openingHoursText(form.openingHours) || '—'}</Fact>
        <Fact label="입장료" compact>{form.admissionFee.trim() || '—'}</Fact>
        <Fact label="지역" compact>{regionLabels[form.region] ?? form.region}</Fact>
      </dl>
      {form.location.trim() && <p className="mt-2 text-[13px] text-gray-800 break-keep [overflow-wrap:anywhere]">{form.location}</p>}
      {named.length > 0 && <p className="mt-2 text-[13px] text-gray-600">{artistsLine(named, 6)}</p>}
      {richTextLength(form.description) > 0 && (
        <div className="relative mt-4 max-h-40 overflow-hidden">
          <RichText value={form.description} className="text-[13px] leading-relaxed text-gray-700 break-keep [overflow-wrap:anywhere]" />
          <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-white to-transparent" />
        </div>
      )}
    </div>
  );
  return { label: '전시 상세', node: detail };
}
