import { X } from 'lucide-react';
import Thumb from '@/components/shared/Thumb';

/**
 * 같은 크기의 정사각 칸에 사진을 놓는 격자 (2026-09-27) — 갤러리 페이지의 지난 전시·아트페어 사진(기록 사진·홍보 사진).
 *
 * 작가 홈페이지 작품 격자(`HomepageView` · `lib/columnGrid.ts`, CLAUDE.md 49)와 **같은 규칙**이다 —
 * 데스크톱 3열 · 좁은 화면 2열, 칸은 정사각, 사진은 칸 안에 비율대로(contain) **정가운데**.
 * 칸에 배경·테두리가 없어 남는 자리는 매트처럼 읽히고, 이음매·윗선·아랫선·오른쪽 끝이 전부 맞는다.
 *
 * ⚠️ 예전엔 `h-24 w-full object-cover` 였다 — 폭은 칸만큼 늘고 높이는 96px 로 못박혀, 화면이 넓을수록 사진이
 * 가로로 긴 띠로 잘려 나갔다(1280px 에서 6열 칸이 약 150×96 = 1.6:1, 세로 사진은 가운데 3분의 1만 보였다).
 * 전시 기록 사진은 작가가 갤러리를 고를 때 보는 자료라 자르면 안 된다(CLAUDE.md 18 과 같은 이유).
 *
 * 작품 격자와 달리 비율을 미리 몰라도 되므로 JS 측정 없이 CSS 로 칸을 잡는다(칸 = aspect-square, 사진 = object-contain).
 */
export interface SquarePhoto {
  url: string;
  caption?: string | null;
  key?: string | number;
}

export default function SquarePhotoGrid({ photos, onOpen, onRemove, className = '' }: {
  photos: SquarePhoto[];
  onOpen?: (index: number) => void;
  /** 주인에게만 넘긴다 — 확인 다이얼로그는 부르는 쪽이 띄운다(지우면 파일까지 사라진다) */
  onRemove?: (index: number) => void;
  className?: string;
}) {
  if (photos.length === 0) return null;
  // 캡션이 있으면 줄 사이를 더 띄운다 — 캡션이 아래 줄 사진에 붙어 보이지 않게(작가 홈페이지와 같은 간격)
  const hasCaption = photos.some((p) => p.caption);
  return (
    <div
      data-testid="square-photo-grid"
      className={`grid grid-cols-2 gap-x-3 sm:grid-cols-3 sm:gap-x-6 ${hasCaption ? 'gap-y-5 sm:gap-y-8' : 'gap-y-3 sm:gap-y-6'} ${className}`}
    >
      {photos.map((p, i) => (
        <figure key={p.key ?? `${p.url}-${i}`} className="group min-w-0">
          <div className="relative aspect-square">
            {onOpen ? (
              <button onClick={() => onOpen(i)} className="block h-full w-full cursor-zoom-in" aria-label={p.caption || `사진 ${i + 1} 크게 보기`}>
                <Thumb src={p.url} size="grid" alt={p.caption || ''} loading="lazy" decoding="async"
                  className="block h-full w-full object-contain transition-opacity hover:opacity-90" />
              </button>
            ) : (
              <Thumb src={p.url} size="grid" alt={p.caption || ''} loading="lazy" decoding="async" className="block h-full w-full object-contain" />
            )}
            {onRemove && (
              // 터치 기기에는 hover 가 없으므로 항상 보이게(md 이상에서만 hover 로) — 히트 영역 44px
              <button
                onClick={() => onRemove(i)}
                aria-label="사진 삭제"
                className="absolute right-0 top-0 flex min-h-[44px] min-w-[44px] items-start justify-end p-1.5 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100"
              >
                <span className="rounded-full bg-black/60 p-1 text-white"><X size={12} /></span>
              </button>
            )}
          </div>
          {p.caption && <figcaption className="mt-2 truncate text-xs text-gray-500">{p.caption}</figcaption>}
        </figure>
      ))}
    </div>
  );
}
