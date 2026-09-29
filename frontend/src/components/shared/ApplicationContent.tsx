import { FileText } from 'lucide-react';
import { safeHttpUrl } from '@/lib/utils';
import { isCareerEmpty, normalizeCareer } from '@/lib/artwork';
import type { Career, CareerKey, CustomAnswer, CustomField } from '@/types';
import Thumb from '@/components/shared/Thumb';

// 표시용 — 작가가 포트폴리오에 학력·수상을 적었으면 지원서에도 실려 오므로 함께 보여준다
// (지원 시 '필수'로 요구하는 항목은 ExhibitionDetailPage의 APP_CAREER_LABELS 3종 그대로)
const LABELS: { key: CareerKey; label: string }[] = [
  { key: 'education', label: '학력' },
  { key: 'solo', label: '개인전' },
  { key: 'group', label: '단체전' },
  { key: 'artFair', label: '아트페어' },
  { key: 'award', label: '수상 및 선정' },
];

export interface ApplicationLike {
  biography?: string | null;
  career?: Career | null;
  artworkImages?: string[] | null;
  portfolioFileUrl?: string | null;
  customAnswers?: CustomAnswer[] | null;
}

interface Props {
  app: ApplicationLike;
  customFields?: CustomField[] | null;
  /** 작품 사진 클릭 시 라이트박스 오픈 */
  onImageClick?: (images: string[], index: number) => void;
}

/**
 * 지원서 제출 내용 표시 — 작가 약력 / 경력(아트페어·개인전·단체전) / 작품 사진 / 포트폴리오 파일.
 * 갤러리 지원자 관리 + 작가 [내 전시]의 '내가 낸 지원서' + Admin 오버사이트 공용.
 * (2026-09-29: 회색 상자·📋 를 빼고 작은 제목 + 본문의 목록으로 — 카드 안에 상자를 또 넣으면 테두리가 겹쳐 시끄럽다)
 */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-xs text-gray-500">{label}</p>
      {children}
    </div>
  );
}

export default function ApplicationContent({ app, customFields, onImageClick }: Props) {
  const career = normalizeCareer(app.career);
  const images = app.artworkImages ?? [];
  const careerEmpty = isCareerEmpty(app.career);
  // customAnswers는 (구) 하위호환 컬럼이라 배열이 아닌 레거시 데이터가 있을 수 있어 방어적으로 배열만 사용.
  const safeAnswers = Array.isArray(app.customAnswers) ? app.customAnswers : [];
  const answerMap = new Map(safeAnswers.map((answer) => [answer.fieldId, answer.value]));

  // 문자열/배열 답변을 공통 포맷으로 렌더
  const formatAnswer = (value?: string | string[]) => (Array.isArray(value) ? value.join(', ') : value);

  // 갤러리가 질문을 수정/삭제해도 기존 지원자의 답변이 사라지지 않도록,
  // 현재 필드에 없는 fieldId의 답변은 "삭제된 질문"으로 별도 표시한다.
  const currentFieldIds = new Set((customFields ?? []).map((field) => field.id));
  const orphanAnswers = safeAnswers.filter((answer) => !currentFieldIds.has(answer.fieldId));

  return (
    <div className="space-y-4 text-sm">
      {/* 작가 약력 */}
      <Field label="작가 약력">
        <p className="whitespace-pre-wrap break-words leading-relaxed text-gray-800">{app.biography || '—'}</p>
      </Field>

      {/* 경력 */}
      <Field label="경력">
        {careerEmpty ? (
          <p className="text-gray-400">없음</p>
        ) : (
          <div className="space-y-2">
            {LABELS.map(({ key, label }) => career[key].length > 0 && (
              <div key={key}>
                <p className="text-xs font-medium text-gray-700">{label}</p>
                <ul className="mt-0.5 space-y-0.5">
                  {career[key].map((e, i) => (
                    <li key={i} className="text-gray-800">
                      {e.year && <span className="mr-1.5 tabular-nums text-gray-400">{e.year}</span>}{e.content}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Field>

      {/* 작품 사진 */}
      <Field label={`작품 사진 ${images.length}장`}>
        {images.length === 0 ? (
          <p className="text-gray-400">없음</p>
        ) : (
          <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 md:grid-cols-5">
            {/* 규칙 18·21 — 작품은 자르지 않고(contain), 목록은 썸네일로. 예전엔 원본을 정사각 크롭했다(2026-09-19) */}
            {images.map((url, idx) => (
              <button key={idx} type="button" onClick={() => onImageClick?.(images, idx)} aria-label={`작품 ${idx + 1} 크게 보기`} className="aspect-square w-full cursor-pointer rounded bg-gray-50 hover:opacity-80">
                <Thumb src={url} size="grid" alt={`작품 ${idx + 1}`} className="h-full w-full object-contain" />
              </button>
            ))}
          </div>
        )}
      </Field>

      {/* 포트폴리오 파일 */}
      <Field label="포트폴리오 파일">
        {safeHttpUrl(app.portfolioFileUrl) ? (
          <a href={safeHttpUrl(app.portfolioFileUrl)!} target="_blank" rel="noreferrer" className="-mx-1 inline-flex min-h-[40px] items-center gap-1 px-1 text-gray-800 underline-offset-4 hover:underline">
            <FileText size={14} aria-hidden /> 파일 보기
          </a>
        ) : (
          <p className="text-gray-400">없음</p>
        )}
      </Field>

      {((customFields?.length ?? 0) > 0 || orphanAnswers.length > 0) && (
        <Field label="갤러리 추가 질문">
          <dl className="divide-y divide-gray-100 border-y border-gray-100">
            {(customFields ?? []).map((field) => {
              const value = formatAnswer(answerMap.get(field.id));
              return (
                <div key={field.id} className="py-2">
                  <dt className="text-xs text-gray-500">{field.label}</dt>
                  <dd className="mt-0.5 whitespace-pre-wrap break-words text-gray-800">{value || '—'}</dd>
                </div>
              );
            })}
            {/* 질문이 삭제/재생성되어 현재 필드에 없는 답변 — 데이터 유실 방지 */}
            {orphanAnswers.map((answer) => {
              const value = formatAnswer(answer.value);
              return (
                <div key={answer.fieldId} className="py-2">
                  <dt className="text-xs text-gray-400">삭제된 질문</dt>
                  <dd className="mt-0.5 whitespace-pre-wrap break-words text-gray-800">{value || '—'}</dd>
                </div>
              );
            })}
          </dl>
        </Field>
      )}
    </div>
  );
}
