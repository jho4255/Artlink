import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { esc } from '@/lib/operationPdf';

/**
 * 포트폴리오 한 쪽을 **축소해 그린다** — 미리보기·크게 보기·꾸미기의 목업이 같이 쓴다 (2026-10-03).
 *
 * 쪽 HTML 은 PDF 에 들어갈 바로 그 HTML 이다(`buildPortfolioPages`). 판형 크기(px) 그대로 그린 뒤 `transform: scale` 로 줄인다 —
 * 그래서 미리보기와 결과물이 어긋나지 않는다.
 *
 * ## 썸네일이 없는 사진
 * 미리보기는 사진을 800px 썸네일로 싣는다(엔진의 `preview` 모드, `data-full` 에 원본 주소). 썸네일이 없는 파일이면(옛 업로드·로컬 시드)
 * 원본으로 되돌린다. `<img onerror="…">` 를 문자열에 심지 않고 **여기서 받는다** — `error` 는 버블링하지 않지만 캡처 단계로는 조상에게 온다.
 * 한 번 실패한 주소는 기억해 두고(`missingThumbs`) 다음부터는 처음부터 원본을 싣는다 — 디자인을 바꿀 때마다 쪽이 다시 그려지는데,
 * 그때마다 404 를 한 번씩 쏘고 깜빡이면 안 된다.
 */
const missingThumbs = new Set<string>();
const THUMB_PAIR = /src="([^"]+)" data-full="([^"]+)"/g;
/** 썸네일이 없다고 알려진 사진은 원본 주소로 바꿔 싣는다 */
function withKnownOriginals(html: string): string {
  if (missingThumbs.size === 0) return html;
  return html.replace(THUMB_PAIR, (whole, _thumb: string, full: string) => (missingThumbs.has(full) ? `src="${full}"` : whole));
}

export default function ScaledPage({ html, w, h, scale, className }: {
  html: string;
  /** 판형 크기(px) — `PAGE_DIMS` */
  w: number;
  h: number;
  scale: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // 썸네일 실패가 새로 알려지면 다시 그린다(같은 사진을 싣는 다른 쪽·다음 렌더가 원본으로 시작하게)
  const [, bump] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onError = (e: Event) => {
      const im = e.target as HTMLImageElement | null;
      const full = im?.tagName === 'IMG' ? im.getAttribute('data-full') : null;
      if (!im || !full) return;
      // 엔진이 주소를 HTML 로 이스케이프해 실었으므로, 속성에서 읽은 값(복원된 주소)이 아니라 **실린 글자 그대로**를 열쇠로 쓴다
      missingThumbs.add(esc(full));
      im.removeAttribute('data-full');
      im.src = full;
      bump((n) => n + 1);
    };
    el.addEventListener('error', onError, true);
    return () => el.removeEventListener('error', onError, true);
  }, []);
  const safeHtml = useMemo(() => withKnownOriginals(html), [html, missingThumbs.size]);   // eslint-disable-line react-hooks/exhaustive-deps

  return (
    // data-scaled-page: 이 안의 글자 크기·단추는 '줄여 그린 지면'의 것이다 — 화면 글자 크기를 세는 하니스가 여기를 건너뛴다
    <div data-scaled-page style={{ width: w * scale, height: h * scale }} className={cn('relative overflow-hidden bg-white', className)}>
      <div
        ref={ref}
        style={{ width: w, height: h, transform: `scale(${scale})`, transformOrigin: 'top left' }}
        // 쪽 HTML 은 엔진이 만든다 — 작가가 쓴 글은 전부 `esc()` 를 거친다(portfolioFormats.ts)
        dangerouslySetInnerHTML={{ __html: safeHtml }}
      />
    </div>
  );
}

/**
 * 상자 안에 맞춰 그리는 작은 목업 — 꾸미기의 표지·작품 배치 고르기, 디자인 줄의 카드.
 * 세로 판형과 가로 판형이 한 줄에 섞여도 칸 높이가 흔들리지 않게 **같은 상자 안에** 맞춘다(가운데 정렬).
 */
export function PageMock({ html, w, h, boxW, boxH, className, pageClassName }: {
  html: string; w: number; h: number;
  boxW: number;
  /** 주면 그 높이 안에도 들어오게 줄인다. 없으면 폭에만 맞춘다 */
  boxH?: number;
  className?: string;
  /** 쪽 자체에 붙일 클래스(테두리) — 상자가 아니라 **지면**을 두른다. 가로 판형은 상자보다 납작하다 */
  pageClassName?: string;
}) {
  const scale = boxH ? Math.min(boxW / w, boxH / h) : boxW / w;
  return (
    <div style={{ width: boxW, height: boxH ?? Math.round(h * scale) }} className={cn('flex items-center justify-center', className)}>
      <ScaledPage html={html} w={w} h={h} scale={scale} className={pageClassName} />
    </div>
  );
}
