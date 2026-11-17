import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { galleryRows, imageRatio, slideFrameRatio, type LayoutItem } from '@/lib/postLayout';
import type { GalleryLayout } from '@/lib/postDoc';

/**
 * 사진 모음 배치 — 편집기·읽는 화면 공용.
 * - 'row'·'grid': **정렬 줄**. 칸마다 flex-grow 와 aspect-ratio 를 사진 비율로 주면 한 줄의 높이가 같아지고 폭은 비율만큼이 된다(자르지 않는다).
 * - 'slide': **한 장씩** 넘겨 보기(scroll-snap, 2026-11-13 — 옆에 다음 사진이 보이지 않게). 틀 비율은 모음에 하나 —
 *   가장 세로로 긴 사진에 맞추되 4:5 ~ 1.91:1 로 묶는다(세로 사진 한 장이 틀을 화면보다 키우지 않게). 사진은 자르지 않고 틀 안에 맞춘다.
 */


export default function PostGalleryLayout<T extends LayoutItem>({ items, layout, renderCell, label = '사진 모음' }: {
  items: T[];
  layout: GalleryLayout;
  /** 칸 안 — 사진(자리는 칸이 잡는다) */
  renderCell: (item: T, index: number, columns: number) => ReactNode;
  label?: string;
}) {
  if (layout === 'slide') return <SlideTrack items={items} renderCell={renderCell} label={label} />;
  const rows = galleryRows(items.map((item, index) => ({ item, index })), layout);
  return (
    <div className="post-gallery-rows">
      {rows.map((row, r) => (
        <div className="post-gallery-row" key={r}>
          {row.map(({ item, index }) => {
            const ratio = imageRatio(item);
            return (
              <div className="post-gallery-cell" key={index} style={{ flexGrow: ratio, aspectRatio: String(ratio) }}>
                {renderCell(item, index, row.length)}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function SlideTrack<T extends LayoutItem>({ items, renderCell, label }: { items: T[]; renderCell: (item: T, index: number, columns: number) => ReactNode; label: string }) {
  const track = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const el = track.current;
    if (!el) return;
    let raf = 0;
    const on = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const mid = el.scrollLeft + el.clientWidth / 2;
        let best = 0, bestD = Infinity;
        Array.from(el.children).forEach((c, i) => {
          const h = c as HTMLElement;
          const d = Math.abs(h.offsetLeft + h.offsetWidth / 2 - mid);
          if (d < bestD) { bestD = d; best = i; }
        });
        setActive(best);
      });
    };
    el.addEventListener('scroll', on, { passive: true });
    return () => { el.removeEventListener('scroll', on); cancelAnimationFrame(raf); };
  }, [items.length]);

  const go = (i: number) => {
    const el = track.current;
    const c = el?.children[Math.max(0, Math.min(items.length - 1, i))] as HTMLElement | undefined;
    if (el && c) el.scrollTo({ left: c.offsetLeft - (el.clientWidth - c.offsetWidth) / 2, behavior: 'smooth' });
  };

  const frame = slideFrameRatio(items);
  return (
    <div className="post-slide-wrap" role="group" aria-roledescription="넘겨 보기" aria-label={label}>
      <div className="post-slide-track" ref={track} tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'ArrowRight') { e.preventDefault(); go(active + 1); } else if (e.key === 'ArrowLeft') { e.preventDefault(); go(active - 1); } }}>
        {items.map((item, i) => (
          <div className="post-slide" key={i} style={{ aspectRatio: String(frame) }} aria-label={`${i + 1}/${items.length}`}>
            {renderCell(item, i, 1)}
          </div>
        ))}
      </div>
      {items.length > 1 && (
        <>
          <span className="post-slide-count" aria-hidden="true">{active + 1} / {items.length}</span>
          <button type="button" data-nv-control className="post-slide-arrow left" aria-label="이전 사진" onClick={() => go(active - 1)} disabled={active === 0}><ChevronLeft size={18} /></button>
          <button type="button" data-nv-control className="post-slide-arrow right" aria-label="다음 사진" onClick={() => go(active + 1)} disabled={active === items.length - 1}><ChevronRight size={18} /></button>
          <div className="post-slide-dots" aria-hidden="true">
            {items.map((_, i) => <span key={i} className={i === active ? 'on' : ''} />)}
          </div>
        </>
      )}
    </div>
  );
}
