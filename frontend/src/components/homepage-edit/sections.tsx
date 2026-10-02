import { Link } from 'react-router-dom';
import { formInputCls } from '@/lib/formStyles';
import { cn } from '@/lib/utils';
import { portfolioFileKind } from '@/lib/portfolioFile';
import type { EditField } from '@/lib/homepageEdit';
import type { HomepageThemeKeys } from '@/lib/homepageTheme';
import { FormField } from '@/components/flow/FormParts';
import Notice from '@/components/flow/Notice';
import CareerEditor, { PORTFOLIO_CATEGORIES } from '@/components/shared/CareerEditor';
import PortfolioFileInput from '@/components/shared/PortfolioFileInput';
import HomepageStylePicker from '@/components/shared/HomepageStylePicker';
import HomepageAddressField from '@/components/shared/HomepageAddressField';
import type { Career, PortfolioImage } from '@/types';

/**
 * 홈페이지 편집의 글 묶음들 — [소개] · [약력] · [파일] · [꾸미기] (2026-10-02)
 *
 * 값은 전부 편집 화면(`HomepageEditor`)이 들고 있다 — 묶음을 오가도 쓰던 글이 남고, 아래 [저장] 한 번에 함께 저장된다.
 * 칸마다 **홈페이지 어디에 나오는지**를 한 줄 적는다: 예전엔 '작가 약력 *' · '작가노트' · '한 줄 소개' 가 설명 없이 나란히 있어
 * 무엇이 어디에 쓰이는지 알 수 없었다(실서버: 작품이 있는 작가 47명 중 작가노트 8명 · 한 줄 소개 5명).
 *
 * `onField` — 지금 손대는 칸. 오른쪽 미리보기가 그 내용이 보이는 탭을 따라 연다.
 * 칸의 id(`hpe-field-…`)는 완성도 줄·로그인 팝업이 "그 칸으로" 데려올 때 쓴다(`editHref(…, { focus })`).
 */
export const fieldId = (name: string) => `hpe-field-${name}`;
const area = (extra: string) => cn(formInputCls(), 'leading-relaxed', extra);

export function IntroSection({ tagline, onTagline, statement, onStatement, series, seriesNotes, onSeriesNote, onField }: {
  tagline: string; onTagline: (v: string) => void;
  statement: string; onStatement: (v: string) => void;
  /** 작품에 실제로 붙어 있는 시리즈 이름 */
  series: string[];
  seriesNotes: Record<string, string>;
  onSeriesNote: (name: string, note: string) => void;
  onField: (f: EditField) => void;
}) {
  return (
    <div className="space-y-6">
      <div onFocusCapture={() => onField('tagline')}>
        <FormField label="한 줄 소개" htmlFor={fieldId('tagline')} hint="홈페이지에서 이름 바로 아래에 나옵니다.">
          <input
            id={fieldId('tagline')}
            value={tagline}
            onChange={(e) => onTagline(e.target.value)}
            maxLength={200}
            placeholder="예: 동심의 이면을 과잉된 에너지로 시각화하는 감각의 연출자"
            className={formInputCls()}
          />
        </FormField>
      </div>

      <div onFocusCapture={() => onField('statement')}>
        <FormField label="작가노트" htmlFor={fieldId('statement')} hint="홈페이지 [작가노트] 탭에 나옵니다. 작업물과 작가님에 대한 이야기를 채워주세요.">
          <textarea
            id={fieldId('statement')}
            value={statement}
            onChange={(e) => onStatement(e.target.value)}
            placeholder="예: 나의 작업은 시간의 흐름 속에서 휘발되는 기억과, 그 자리에 남은 감정의 잔상을 기록하는 과정이다…"
            className={area('h-56 resize-y')}
          />
        </FormField>
      </div>

      <div onFocusCapture={() => onField('series')}>
        <p className="mb-1.5 text-sm font-medium text-gray-800">시리즈 소개</p>
        {series.length > 0 ? (
          <div className="space-y-3">
            {series.map((name) => (
              <div key={name}>
                <label htmlFor={`hpe-series-${name}`} className="mb-1 block text-sm text-gray-700">{name}</label>
                <textarea
                  id={`hpe-series-${name}`}
                  value={seriesNotes[name] ?? ''}
                  onChange={(e) => onSeriesNote(name, e.target.value)}
                  placeholder="이 시리즈가 어떤 작업인지 적어 주세요."
                  rows={3}
                  className={area('resize-y')}
                />
              </div>
            ))}
            <p className="break-keep text-xs leading-relaxed text-gray-500">[작품] 탭에서 시리즈 이름 아래에 나옵니다.</p>
          </div>
        ) : (
          <p className="break-keep text-xs leading-relaxed text-gray-500">
            작품 정보에 ‘시리즈’를 적으면 같은 시리즈끼리 묶여 보이고, 여기서 시리즈마다 소개 글을 쓸 수 있어요.
          </p>
        )}
      </div>
    </div>
  );
}

export function CvSection({ biography, onBiography, career, onCareer, onField }: {
  biography: string; onBiography: (v: string) => void;
  career: Career; onCareer: (c: Career) => void;
  onField: (f: EditField) => void;
}) {
  return (
    <div className="space-y-6" onFocusCapture={() => onField('biography')}>
      <Notice>
        글로 자유롭게 쓰거나 항목별로 나눠 적을 수 있어요. 둘 다 홈페이지 [약력] 탭에 나옵니다 — <b className="font-medium text-gray-900">하나만 써도 됩니다.</b>
      </Notice>

      <FormField label="약력 (자유롭게 쓰기)" htmlFor={fieldId('biography')} hint="출생·학력·활동을 한 문단으로 적어도 되고, 한 줄에 하나씩 적어도 됩니다.">
        <textarea
          id={fieldId('biography')}
          value={biography}
          onChange={(e) => onBiography(e.target.value)}
          placeholder="작가 소개·약력을 입력하세요."
          className={area('h-36 resize-y')}
        />
      </FormField>

      <div>
        <p className="mb-1.5 text-sm font-medium text-gray-800">항목별 경력</p>
        <p className="mb-3 break-keep text-xs leading-relaxed text-gray-500">학력·개인전·단체전처럼 나눠 적으면 [약력] 탭에 항목별로 정리돼 나옵니다. 있는 항목만 채우세요.</p>
        <CareerEditor value={career} onChange={onCareer} categories={PORTFOLIO_CATEGORIES} />
      </div>
    </div>
  );
}

export function FileSection({ value, onChange }: { value: string | null; onChange: (url: string | null) => void }) {
  const notPdf = !!value && portfolioFileKind(value) !== 'pdf';
  return (
    <div className="space-y-4">
      <div>
        <p className="mb-1.5 text-sm font-medium text-gray-800">포트폴리오 파일</p>
        <p className="mb-3 break-keep text-xs leading-relaxed text-gray-500">이미 만들어 둔 포트폴리오가 있으면 올려 두세요. 홈페이지 [포트폴리오] 탭에 나옵니다. (PDF · DOC · HWP)</p>
        <PortfolioFileInput value={value} onChange={onChange} />
        {/* 홈페이지 [포트폴리오] 탭은 PDF 만 페이지 안에서 펼친다(2026-09-25) — 올리기 전에 알려야 PDF 로 바꿔 올린다 */}
        <p className={cn('mt-2 text-xs leading-relaxed', notPdf ? 'text-accent' : 'text-gray-500')}>
          {notPdf
            ? '이 파일은 홈페이지에서 펼쳐 보이지 않고 내려받기로만 나옵니다. PDF 로 올리면 페이지 안에서 바로 보입니다.'
            : 'PDF 로 올리면 방문자가 내려받지 않고 페이지 안에서 바로 볼 수 있습니다.'}
        </p>
      </div>
      <Notice>
        만들어 둔 파일이 없어도 됩니다. 여기 올린 작품과 글로{' '}
        <Link to="/mypage?tab=portfolio" className="font-medium text-gray-900 underline underline-offset-4">포트폴리오 PDF 를 만들 수 있어요</Link>.
      </Notice>
    </div>
  );
}

export function StyleSection({ handle, onHandle, currentHandle, handleSuggestion, handleError, design, onDesign, images, onField }: {
  handle: string; onHandle: (v: string) => void;
  currentHandle?: string | null;
  handleSuggestion?: string | null;
  handleError?: string | null;
  design: HomepageThemeKeys; onDesign: (d: HomepageThemeKeys) => void;
  images: PortfolioImage[];
  onField: (f: EditField) => void;
}) {
  return (
    <div className="space-y-6">
      <div onFocusCapture={() => onField('handle')}>
        <label htmlFor={fieldId('handle')} className="mb-1.5 block text-sm font-medium text-gray-800">홈페이지 주소</label>
        <p className="mb-2 break-keep text-xs leading-relaxed text-gray-500">
          인스타 프로필·명함에 적을 주소입니다. 영문 소문자·숫자·마침표·밑줄, 3~30자. 인스타그램 아이디를 그대로 쓰면 기억하기 쉽습니다.
        </p>
        <HomepageAddressField
          inputId={fieldId('handle')}
          value={handle}
          onChange={onHandle}
          current={currentHandle}
          suggestion={handleSuggestion}
          error={handleError}
        />
        <p className="mt-3 break-keep text-xs leading-relaxed text-gray-500">
          홈페이지 맨 위에 나오는 이름(닉네임)과 인스타그램 주소는{' '}
          <Link to="/mypage" className="text-gray-800 underline underline-offset-2">프로필</Link>에서 바꿉니다.
        </p>
      </div>

      <HomepageStylePicker value={design} images={images} onChange={onDesign} />
    </div>
  );
}
