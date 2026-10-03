import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, FileDown, Maximize2, Minimize2, X } from 'lucide-react';
import { buildPortfolioPages, themeById, type PdfDesign, type PortfolioBookData } from '@/lib/portfolioFormats';
import { pageLabel } from '@/lib/portfolioMaker';
import { useEscapeKey } from '@/hooks/useEscapeKey';
import ScaledPage from './ScaledPage';

/**
 * 크게 보기 — 미리보기의 쪽을 누르면 열린다 (2026-10-03).
 *
 * 예전 [전체화면] 은 한 쪽이 PC 에서 431×610 이었고(본문 글자 ≈5.6px) 확대가 없어 **글을 읽을 수 없었다**.
 * 여기서는 한 번에 한 쪽을 본다:
 *  - **크게** — 판형 원래 크기(가로 1000px)에 가깝게. 글이 읽힌다. 넓은 화면의 기본.
 *  - **맞춤** — 한 쪽이 화면에 통째로. 좁은 화면의 기본(휴대폰은 두 손가락으로 벌려 확대한다).
 *  - ← → 로 쪽을 넘긴다(자판 화살표도). Esc·✕ 로 닫는다.
 * 사진은 **원본**이다 — 썸네일을 이 크기로 늘리면 뭉개진다. 한 쪽씩 그리므로 원본을 한꺼번에 받지 않는다.
 */
export default function PageViewer({ book, design, pageW, pageH, index, onIndex, onClose, onSave }: {
  book: PortfolioBookData;
  design: PdfDesign;
  pageW: number;
  pageH: number;
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  /** 여기서 바로 저장 창을 연다 */
  onSave: () => void;
}) {
  // 화면용 쪽(원본 사진). 미리보기와 같은 함수·같은 입력이라 쪽 번호가 어긋나지 않는다
  const pages = useMemo(() => buildPortfolioPages(book, themeById('archive'), { design }), [book, design]);
  const n = pages.length;
  const i = Math.min(Math.max(index, 0), n - 1);
  const page = pages[i];

  const [vp, setVp] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const [mode, setMode] = useState<'fit' | 'large'>(() => (window.innerWidth >= 1024 ? 'large' : 'fit'));
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onResize = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEscapeKey(onClose);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' && i > 0) onIndex(i - 1);
      else if (e.key === 'ArrowRight' && i < n - 1) onIndex(i + 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [i, n, onIndex]);
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  // 쪽을 넘기면 그 쪽의 첫머리부터
  useEffect(() => { scroller.current?.scrollTo({ top: 0, left: 0 }); }, [i, mode]);

  if (!page) return null;

  const PAD = 16;
  const HEAD = 56;
  const fitW = (vp.w - PAD * 2) / pageW;
  const fitH = (vp.h - HEAD - PAD * 2) / pageH;
  const fit = Math.max(0.05, Math.min(1, fitW, fitH));
  // 크게: 폭이 화면에 거의 들어오면(80% 이상) 폭에 맞추고, 훨씬 좁은 화면(휴대폰)에서는 0.9 배로 두고 옆으로 민다
  const large = fitW >= 0.8 ? Math.min(1, fitW) : 0.9;
  const scale = mode === 'fit' ? fit : large;

  const iconBtn = 'flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-white/80 hover:bg-white/10 hover:text-white disabled:opacity-30';
  const navBtn = 'absolute top-1/2 z-10 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white hover:bg-black/65 disabled:opacity-0';

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="포트폴리오 크게 보기" data-testid="page-viewer" className="fixed inset-0 z-[80] flex flex-col bg-neutral-900">
      <div className="flex shrink-0 items-center gap-1 px-3 text-white" style={{ height: HEAD }}>
        <p className="min-w-0 truncate pl-1 text-sm">
          <span className="font-semibold tabular-nums">{i + 1}</span>
          <span className="tabular-nums text-white/60"> / {n}</span>
          <span className="ml-2 text-white/70">{pageLabel(page.label)}</span>
        </p>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => setMode(mode === 'fit' ? 'large' : 'fit')}
            className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm text-white/80 hover:bg-white/10 hover:text-white"
          >
            {mode === 'fit' ? <><Maximize2 size={15} aria-hidden /> 크게</> : <><Minimize2 size={15} aria-hidden /> 맞춤</>}
          </button>
          <button type="button" onClick={onSave} className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-lg bg-white px-3.5 text-sm font-medium text-neutral-900 hover:bg-white/90">
            <FileDown size={15} aria-hidden /> PDF 저장
          </button>
          <button type="button" onClick={onClose} aria-label="닫기" className={iconBtn}><X size={20} /></button>
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        <div ref={scroller} className="h-full overflow-auto overscroll-contain">
          {/* w-max + min-w-full: 쪽이 화면보다 넓으면 왼쪽 끝부터 밀어 볼 수 있고, 좁으면 가운데에 온다 */}
          <div className="flex w-max min-w-full justify-center" style={{ padding: PAD }}>
            <ScaledPage html={page.html} w={pageW} h={pageH} scale={scale} />
          </div>
        </div>
        <button type="button" onClick={() => onIndex(i - 1)} disabled={i === 0} aria-label="앞 쪽" className={`${navBtn} left-2`}><ChevronLeft size={24} /></button>
        <button type="button" onClick={() => onIndex(i + 1)} disabled={i >= n - 1} aria-label="다음 쪽" className={`${navBtn} right-2`}><ChevronRight size={24} /></button>
      </div>
    </div>,
    document.body,
  );
}
