import { forwardRef, useImperativeHandle, useRef } from 'react';
import { Pencil } from 'lucide-react';
import { pageLabel, previewScale } from '@/lib/portfolioMaker';
import type { PortfolioPage } from '@/lib/portfolioFormats';
import { useElementWidth } from '@/hooks/useElementWidth';
import ScaledPage from './ScaledPage';

/** 쪽 위의 이름 줄 높이(px) — 꾸미기를 연 동안 한 쪽이 통째로 보이게 줄일 때 이만큼을 뺀다 */
export const PAGE_LABEL_H = 40;

export interface BookPreviewHandle {
  /** 그 쪽을 화면 위쪽으로 데려온다 — 꾸미기에서 묶음을 바꿀 때 */
  scrollToPage: (index: number) => void;
}

/**
 * 만들어진 포트폴리오 — 쪽을 위에서 아래로 (2026-10-03).
 *
 * 이 화면의 주인공이다. 예전엔 설정 묶음·추천 카드 아래에 있어 첫 화면에 안 보였고(PC y894, 휴대폰 y1375),
 * 한 쪽을 화면 높이에 맞춰 줄여(PC 339px · 아이폰 243px) 글을 읽을 수 없었다.
 *  - 쪽 폭은 칸에 맞추되 세로 판형 600px · 가로 판형 840px 까지(`previewScale`).
 *  - 꾸미기를 연 동안에는 `fitHeight` 로 한 쪽이 통째로 보이게 줄인다 — 고르는 동안에는 지면 전체가 보여야 한다.
 *  - 쪽을 누르면 크게 보기(`PageViewer`). 표지·마지막 장에는 그 쪽을 고치는 단추가 **늘** 보인다
 *    (예전의 '편집' 표식은 마우스를 올려야만 나왔고, 누르면 편집 패널이 화면 밖에 열렸다).
 *
 * 사진은 800px 썸네일이다(엔진의 `preview` 모드) — 배치는 PDF 와 같다. 원본은 크게 보기와 저장에서만 받는다.
 */
const BookPreview = forwardRef<BookPreviewHandle, {
  pages: PortfolioPage[];
  /** 판형 크기(px) */
  pageW: number;
  pageH: number;
  /** 한 쪽이 이 높이 안에 들어오게(꾸미기를 열었을 때). 없으면 폭에만 맞춘다 */
  fitHeight?: number | null;
  /**
   * 마지막 쪽 아래에 자리를 남긴다 — 넓은 화면에서 꾸미기 패널(옆에 붙어 따라온다)을 연 동안.
   * 패널은 이 줄(미리보기 칸)이 끝나는 곳에서 함께 밀려 올라간다. 마지막 쪽이 패널보다 낮으면([이름·연락처] 가 마지막 장으로 데려간다)
   * 패널 머리(탭·닫기)가 상단바 뒤로 숨는다 — 1024px 폭에서 실제로 그랬다(하니스 ④). 마지막 칸을 패널 높이만큼 받쳐 둔다.
   */
  tailRoom?: boolean;
  onOpen: (index: number) => void;
  onEditCover: () => void;
  onEditInfo: () => void;
}>(function BookPreview({ pages, pageW, pageH, fitHeight, tailRoom, onOpen, onEditCover, onEditInfo }, ref) {
  const { ref: boxRef, width } = useElementWidth<HTMLDivElement>();
  const scale = previewScale(pageW, pageH, width, fitHeight);
  const items = useRef<(HTMLDivElement | null)[]>([]);
  useImperativeHandle(ref, () => ({
    scrollToPage: (i) => items.current[i]?.scrollIntoView({ block: 'start', behavior: 'smooth' }),
  }), []);

  const editBtn = 'inline-flex min-h-[40px] items-center gap-1 whitespace-nowrap px-1 text-xs font-medium text-gray-800 underline-offset-4 hover:underline';
  return (
    <section aria-label="포트폴리오 미리보기" data-book-preview className="-mx-6 bg-gray-100 px-3 pb-5 pt-1.5 sm:px-6 sm:pt-3 md:-mx-12 md:px-12 lg:mx-0 lg:px-6">
      <div ref={boxRef} className="flex flex-col items-center gap-6">
        {pages.map((p, i) => (
          <div
            key={i}
            ref={(el) => { items.current[i] = el; }}
            data-page-index={i}
            data-page-kind={p.kind}
            data-page-part={p.part}
            // 상단바(h-16 / lg:h-20) 아래에 걸리게 — scrollIntoView 가 쪽 머리를 상단바 밑에 숨기지 않게
            className="scroll-mt-[76px] lg:scroll-mt-[92px]"
            // 12.5rem = 패널의 높이 한계(100vh − 11.5rem)에서 이 칸 아래 여백(1.25rem)을 빼고 패널과 칸의 머리 차이(0.25rem)를 더한 값
            style={{ width: pageW * scale, minHeight: tailRoom && i === pages.length - 1 ? 'calc(100vh - 12.5rem)' : undefined }}
          >
            {/* 줄 높이는 쪽마다 같다(40px) — 단추가 있는 쪽만 높으면 꾸미기를 열었을 때 그 쪽의 아랫부분이 시트에 가린다(`PAGE_LABEL_H`) */}
            <div className="flex h-10 items-center gap-2 text-xs text-gray-500">
              <span className="tabular-nums text-gray-400">{String(i + 1).padStart(2, '0')}</span>
              <span className="min-w-0 truncate">{pageLabel(p.label)}</span>
              {p.kind === 'cover' && (
                <button type="button" onClick={onEditCover} className={`${editBtn} ml-auto`}><Pencil size={12} aria-hidden /> 표지 고치기</button>
              )}
              {p.kind === 'contact' && (
                <button type="button" onClick={onEditInfo} className={`${editBtn} ml-auto`}><Pencil size={12} aria-hidden /> 실리는 정보 고치기</button>
              )}
            </div>
            <button
              type="button"
              onClick={() => onOpen(i)}
              aria-label={`${i + 1}쪽 ${pageLabel(p.label)} 크게 보기`}
              className="block cursor-zoom-in ring-1 ring-black/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900"
            >
              <ScaledPage html={p.html} w={pageW} h={pageH} scale={scale} />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
});

export default BookPreview;
