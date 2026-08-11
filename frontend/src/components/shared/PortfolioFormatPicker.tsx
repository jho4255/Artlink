import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2, FileDown, Eye, Check } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  PORTFOLIO_THEMES, buildPortfolioPages, downloadPortfolioBook, themeById,
  type BookPhase, type PortfolioBookData, type PortfolioTheme, type PortfolioThemeId,
} from '@/lib/portfolioFormats';
import { hasCaption } from '@/lib/artwork';

/**
 * 포맷 미리보기 — PDF에 들어갈 **바로 그 HTML**을 화면 크기에 맞게 축소해 보여준다.
 * 미리보기 전용 마크업을 따로 두면 언젠가 반드시 실물과 어긋나므로 같은 함수(buildPortfolioPages)를 쓴다.
 */
function PagePreview({ html, w, h, scale }: { html: string; w: number; h: number; scale: number }) {
  return (
    <div
      style={{ width: w * scale, height: h * scale }}
      className="relative overflow-hidden bg-white shadow-[0_1px_3px_rgba(0,0,0,0.12)] ring-1 ring-black/5"
    >
      <div
        style={{ width: w, height: h, transform: `scale(${scale})`, transformOrigin: 'top left' }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}

/**
 * 카드 썸네일 — 판형이 달라도 **모든 포맷이 같은 크기 상자**에 들어간다.
 * 세로 판형(아카이브)만 혼자 길어지면 선택 화면이 들쭉날쭉해져 비교가 안 된다.
 * 그래서 상자를 꽉 채우도록(cover) 키우고 넘치는 부분은 자른다 — 썸네일이라 잘려도 된다.
 * 위쪽 기준으로 맞춰 제목이 항상 보이게 한다(포맷을 알아보는 단서가 제목이라).
 */
function PageThumb({ html, w, h }: { html: string; w: number; h: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.2);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const bw = el.clientWidth, bh = el.clientHeight;
      if (bw && bh) setScale(Math.max(bw / w, bh / h));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [w, h]);

  return (
    <div ref={ref} className="relative w-full aspect-[3/2] overflow-hidden bg-white ring-1 ring-black/5 shadow-[0_1px_3px_rgba(0,0,0,0.12)]">
      <div
        style={{
          position: 'absolute', top: 0, left: '50%', width: w, height: h,
          transform: `translateX(-50%) scale(${scale})`, transformOrigin: 'top center',
        }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}

/**
 * 전체 미리보기 배율 — 폭에 맞추되 **화면 높이도 넘지 않게** 한다.
 * 폭만 기준으로 하면 세로 판형(A4 세로)이 한 장에 화면 두 배 높이가 되어 넘겨보기가 불편하다.
 */
function useFitScale(pageW: number, pageH: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.2);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const bw = el.clientWidth || pageW;
      const maxH = Math.max(320, window.innerHeight - 190); // 상단 바 + 라벨 여유
      setScale(Math.min(1, bw / pageW, maxH / pageH));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    return () => { ro.disconnect(); window.removeEventListener('resize', measure); };
  }, [pageW, pageH]);
  return { ref, scale };
}

function phaseLabel(phase: BookPhase, done: number, total: number) {
  if (phase === 'images') return `작품 불러오는 중 ${done}/${total}`;
  if (phase === 'retry') return `다시 시도 ${done}/${total}`;
  return `페이지 만드는 중 ${done}/${total}`;
}

// ── 전체 미리보기 모달 ──
function PreviewModal({
  theme, data, onClose, onDownload, busy, progress,
}: {
  theme: PortfolioTheme;
  data: PortfolioBookData;
  onClose: () => void;
  onDownload: () => void;
  busy: boolean;
  progress: string;
}) {
  const pages = useMemo(() => buildPortfolioPages(data, theme), [data, theme]);
  const { ref, scale } = useFitScale(theme.page.w, theme.page.h);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  return createPortal(
    // 반투명(/80)으로 두면 뒤 화면이 페이지 사이로 비쳐 미리보기가 지저분해진다 — 불투명 배경
    <div className="fixed inset-0 z-[80] bg-neutral-900 flex flex-col">
      <div className="flex items-center justify-between px-4 sm:px-6 py-3 bg-neutral-900 text-white flex-none">
        <div className="min-w-0">
          <p className="text-[15px] font-semibold truncate">{theme.name}</p>
          <p className="text-[11px] text-white/55">{theme.sizeLabel} · 총 {pages.length}쪽</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onDownload}
            disabled={busy}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-white text-neutral-900 text-sm font-medium rounded-lg disabled:opacity-60"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <FileDown size={14} />}
            {busy ? progress || '만드는 중' : 'PDF 저장'}
          </button>
          <button onClick={onClose} disabled={busy} className="p-2 text-white/70 hover:text-white disabled:opacity-40" aria-label="닫기">
            <X size={20} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-6">
        <div ref={ref} className="max-w-4xl mx-auto space-y-7 flex flex-col items-center">
          {pages.map((p, i) => (
            <div key={i} style={{ width: theme.page.w * scale }}>
              <div className="flex items-baseline gap-2 mb-1.5 text-white/60 text-[11px]">
                <span className="tabular-nums">{String(i + 1).padStart(2, '0')}</span>
                <span>{p.label}</span>
              </div>
              <PagePreview html={p.html} w={theme.page.w} h={theme.page.h} scale={scale} />
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}

interface Props {
  data: PortfolioBookData;
  /** 저장된 포맷 (마지막 선택) */
  value?: string | null;
  onChange?: (id: PortfolioThemeId) => void;
}

/**
 * 포트폴리오 포맷 선택 — 4종의 표지를 실제 데이터로 그려 보여주고, 고른 포맷으로 PDF를 만든다.
 */
export default function PortfolioFormatPicker({ data, value, onChange }: Props) {
  const [selected, setSelected] = useState<PortfolioThemeId>(() => themeById(value).id);
  const [previewing, setPreviewing] = useState<PortfolioTheme | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');

  const works = data.images;
  const missingCaption = works.filter((w) => !hasCaption(w)).length;

  const pick = (id: PortfolioThemeId) => {
    setSelected(id);
    onChange?.(id);
  };

  const download = async (theme: PortfolioTheme) => {
    if (works.length === 0) {
      toast.error('작품 사진을 먼저 등록해주세요.');
      return;
    }
    setBusy(true);
    setProgress('');
    try {
      const { missing, pages } = await downloadPortfolioBook(data, theme.id, (d, t, phase) => setProgress(phaseLabel(phase, d, t)));
      if (missing.length > 0) {
        toast.error(`${pages}쪽으로 저장했지만 작품 ${missing.length}장을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.`, { duration: 6000 });
      } else {
        toast.success(`${theme.name}로 저장했습니다. (${pages}쪽)`);
      }
    } catch {
      toast.error('PDF 생성에 실패했습니다.');
    } finally {
      setBusy(false);
      setProgress('');
    }
  };

  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <p className="text-sm font-medium text-gray-700">포트폴리오 포맷</p>
        <span className="text-xs text-gray-400">작품 {works.length}점</span>
      </div>
      <p className="text-xs text-gray-400 mb-3 leading-relaxed">
        지금 등록한 내용으로 4가지 포맷을 만들어 드립니다. 골라서 미리 보고 PDF로 저장하세요.<br />
        작품 정보를 고치면 미리보기에 <b className="font-medium text-gray-500">바로</b> 반영됩니다 —
        다만 <b className="font-medium text-gray-500">이미 저장해 둔 PDF 파일은 다시 저장</b>해야 최신 내용이 들어갑니다.
      </p>

      {missingCaption > 0 && (
        <div className="mb-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-[12px] text-amber-800 leading-relaxed">
          작품 {missingCaption}점에 <b>작품명·재료·크기·연도</b>가 없습니다. 작품 사진을 눌러 정보를 채우면 포트폴리오가 훨씬 좋아집니다.
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {PORTFOLIO_THEMES.map((theme) => (
          <FormatCard
            key={theme.id}
            theme={theme}
            data={data}
            selected={selected === theme.id}
            onSelect={() => pick(theme.id)}
            onPreview={() => { pick(theme.id); setPreviewing(theme); }}
            onDownload={() => { pick(theme.id); download(theme); }}
            busy={busy && selected === theme.id}
            progress={progress}
          />
        ))}
      </div>

      {previewing && (
        <PreviewModal
          theme={previewing}
          data={data}
          busy={busy}
          progress={progress}
          onClose={() => setPreviewing(null)}
          onDownload={() => download(previewing)}
        />
      )}
    </div>
  );
}

function FormatCard({
  theme, data, selected, onSelect, onPreview, onDownload, busy, progress,
}: {
  theme: PortfolioTheme;
  data: PortfolioBookData;
  selected: boolean;
  onSelect: () => void;
  onPreview: () => void;
  onDownload: () => void;
  busy: boolean;
  progress: string;
}) {
  // 카드에는 표지 한 장만 그린다 (전체는 미리보기 모달에서)
  const cover = useMemo(() => buildPortfolioPages(data, theme)[0]?.html ?? '', [data, theme]);

  return (
    <div className={`rounded-xl border transition-colors ${selected ? 'border-gray-900 ring-1 ring-gray-900' : 'border-gray-200'}`}>
      <button onClick={onSelect} className="block w-full text-left p-3 pb-2" aria-pressed={selected}>
        <PageThumb html={cover} w={theme.page.w} h={theme.page.h} />
        <div className="flex items-center gap-1.5 mt-3">
          {selected && <Check size={14} className="text-gray-900 flex-none" />}
          <span className="text-sm font-semibold">{theme.name}</span>
          <span className="text-[11px] text-gray-400 border border-gray-200 rounded px-1.5 py-0.5 ml-auto flex-none">{theme.sizeLabel}</span>
        </div>
        <p className="text-[12px] text-gray-500 mt-1 leading-relaxed">{theme.summary}</p>
      </button>
      <div className="flex border-t border-gray-100">
        <button onClick={onPreview} className="flex-1 py-2.5 text-[13px] text-gray-600 hover:bg-gray-50 flex items-center justify-center gap-1.5">
          <Eye size={13} /> 미리보기
        </button>
        <span className="w-px bg-gray-100" />
        <button onClick={onDownload} disabled={busy} className="flex-1 py-2.5 text-[13px] text-gray-900 font-medium hover:bg-gray-50 disabled:opacity-50 flex items-center justify-center gap-1.5">
          {busy ? <Loader2 size={13} className="animate-spin" /> : <FileDown size={13} />}
          {busy ? (progress || '만드는 중') : 'PDF 저장'}
        </button>
      </div>
    </div>
  );
}
