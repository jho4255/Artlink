import { useMemo } from 'react';
import { Check, Undo2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { directionMatches } from '@/lib/portfolioMaker';
import { DESIGN_DIRECTIONS, type DesignDirection, type Recommendation } from '@/lib/portfolioDirection';
import {
  PAGE_DIMS, buildPortfolioPages, normalizePdfDesign, themeById,
  type PageKey, type PdfDesign, type PortfolioBookData,
} from '@/lib/portfolioFormats';
import { PageMock } from './ScaledPage';

/**
 * 디자인 고르기 한 줄 (2026-10-03).
 *
 * 하나를 누르면 색·글꼴·표지·작품 배치가 **한 벌로** 바뀐다(용지는 그대로)(`lib/portfolioDirection.ts`). 작가는 디자이너가 아니므로
 * 표지 15종 · 배치 7종 · 글꼴 6 · 색 22 를 스스로 조합하게 하지 않고 먼저 좋은 답을 준다 — 세부는 [꾸미기] 에 남아 있다.
 *
 * 예전과 달라진 것:
 *  - 미리보기 **위에** 한 줄로 온다(예전엔 세부 설정·저장 버튼 아래였다 — 휴대폰에서는 화면 한 장을 넘겨야 나왔다).
 *  - 한 번 누르면 직접 고른 값이 통째로 바뀌므로 **[되돌리기]** 를 바로 아래에 둔다(예전엔 확인도 되돌리기도 없었다).
 *  - ✓ 는 지금 모양이 그 방향 **그대로일 때만**(`directionMatches`). 고른 뒤 표지를 바꿨는데 '도록 ✓' 가 남으면 카드와 화면이 다른 모양이다.
 *  - **여섯 다 보인다**(2026-10-03 사용자 지적 "6종 중 3종밖에 안 보인다") — 넓은 화면은 한 줄, 휴대폰·태블릿은 3×2.
 *    예전엔 추천 3종만 보이고 나머지는 [6종 모두 보기] 뒤에 있었다. 추천은 **순서**(앞쪽)로만 남는다.
 *  - 설명 글(추천 이유)은 없앴다 — 이름과 표지 그림이면 고를 수 있다(사용자 결정).
 *  - **용지는 바꾸지 않는다**(2026-10-03) — 용지는 맨 위에서 따로 고른다. 예전엔 '작품 우선'·'다크 룩북' 이 말없이 가로 A4 로 바꿨다.
 */
export interface DesignUndo { label: string }

export default function DesignRow({ book, design, recs, onPick, undo, onUndo }: {
  book: PortfolioBookData;
  design: PdfDesign;
  /** 이 포트폴리오에 어울리는 방향(이유 포함) — `recommendDirections`. 어울리는 것을 **앞에** 놓는 데만 쓴다 */
  recs: Recommendation[];
  onPick: (d: DesignDirection) => void;
  /** 방금 바꾼 것이 있으면 — "'미니멀'로 바꿨어요 · 되돌리기" */
  undo: DesignUndo | null;
  onUndo: () => void;
}) {
  // 여섯 다 — 추천한 것을 앞에(첫 칸이 이 작가에게 가장 어울리는 것), 나머지는 정의 순서대로
  const shown: DesignDirection[] = useMemo(() => {
    const first = recs.map((r) => r.direction);
    return [...first, ...DESIGN_DIRECTIONS.filter((d) => !first.some((f) => f.key === d.key))];
  }, [recs]);

  // 카드의 그림 — 표지를 **이 작가의 작품으로** 실제로 그린다. 작품이 많으면 앞 7점만(속도).
  // 이름 규칙·용지는 지금 고른 것을 따른다 — 카드의 표지와 아래 미리보기의 이름이 달라 보이면 안 되고, 카드를 눌러도 용지는 안 바뀐다
  const sampleKey = book.images.slice(0, 7).map((w) => w.url).join('|');
  const covers = useMemo(() => {
    const sample: PortfolioBookData = { ...book, images: book.images.slice(0, 7) };
    return Object.fromEntries(shown.map((d) => [d.key, buildPortfolioPages(sample, themeById('archive'), {
      preview: true,
      design: normalizePdfDesign({ ...d.design, page: design.page, auto: true, nameSource: design.nameSource, contact: design.contact }),
    })[0]!]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sampleKey, book.aspects, book.user, shown, design.nameSource, design.page]);
  const { w, h } = PAGE_DIMS[design.page as PageKey] ?? PAGE_DIMS['a4-portrait'];

  return (
    <section aria-label="디자인 고르기" data-design-row className="border-y border-gray-200 py-2.5 sm:py-3">
      <div className="flex items-center gap-3">
        <p className="hidden shrink-0 text-sm font-semibold text-gray-950 sm:block">디자인</p>
        {/* 휴대폰·태블릿은 3×2, 넓은 화면은 한 줄에 여섯 */}
        <ul className="grid min-w-0 flex-1 grid-cols-3 gap-1.5 sm:gap-2 xl:grid-cols-6">
          {shown.map((d) => {
            const on = directionMatches(design, d);
            const cover = covers[d.key];
            return (
              <li key={d.key} className="min-w-0">
                <button
                  type="button"
                  onClick={() => onPick(d)}
                  aria-pressed={on}
                  // 그림 속 글자(표지의 작가 이름)가 버튼 이름으로 읽히지 않게
                  aria-label={`${d.name} 디자인`}
                  className={cn(
                    'flex h-full min-h-[44px] w-full items-center gap-1.5 rounded-lg border px-1.5 py-1.5 text-left transition-colors sm:gap-2 sm:px-2',
                    on ? 'border-gray-900 bg-gray-50 ring-1 ring-gray-900' : 'border-gray-200 hover:border-gray-400',
                  )}
                >
                  {cover && (
                    <>
                      {/* 380px 아래(아이폰 SE)는 칸이 92px 이라 그림을 넣으면 이름이 '에디토/리얼' 로 끊긴다 — 거기서는 이름만 */}
                      <PageMock html={cover.html} w={w} h={h} boxW={24} boxH={34} className="hidden shrink-0 min-[380px]:flex sm:hidden" pageClassName="ring-1 ring-black/10" />
                      <PageMock html={cover.html} w={w} h={h} boxW={34} boxH={48} className="hidden shrink-0 sm:flex" pageClassName="ring-1 ring-black/10" />
                    </>
                  )}
                  {/* 설명 글은 두지 않는다(2026-10-03 사용자 결정) — 이름만. 좁은 칸에서는 두 줄로 꺾인다 */}
                  <span className="flex min-w-0 items-center gap-1 break-keep text-[13px] font-semibold leading-tight text-gray-950 max-[379px]:mx-auto sm:text-sm">
                    {d.name}{on && <Check size={14} aria-label="지금 디자인" className="shrink-0" />}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
      {undo && (
        <p className="mt-2.5 flex flex-wrap items-center gap-x-2 text-sm text-gray-600" role="status">
          {undo.label}
          <button type="button" onClick={onUndo} className="inline-flex min-h-[40px] items-center gap-1 font-medium text-gray-950 underline underline-offset-4">
            <Undo2 size={14} aria-hidden /> 되돌리기
          </button>
        </p>
      )}
    </section>
  );
}
