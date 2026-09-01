import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2, FileDown, Maximize2, Pencil } from 'lucide-react';
import type { PortfolioImage } from '@/types';
import toast from 'react-hot-toast';
import {
  buildPortfolioPages, downloadPortfolioBook, downloadPortfolioPptx, themeById, normalizePdfDesign, PAGE_DIMS, FONT_PRESETS, PORTFOLIO_FONT_HREF, COVER_LAYOUTS, COVER_SHOWS_TAGLINE,
  type BookPhase, type PortfolioBookData, type PortfolioPage,
  type PdfDesign, type PageKey, type WorksLayout, type DescDepth, type WorksCaption, type ProseAlign,
} from '@/lib/portfolioFormats';
import { BACKGROUNDS, TEXTS, ACCENTS, recommendedTextKeys, bestTextKey, recommendedAccentKeys, bestAccentKey } from '@/lib/portfolioColors';
import { hasCaption } from '@/lib/artwork';

/**
 * 포트폴리오 **제작 화면** — 4개 샘플을 늘어놓지 않는다.
 * [스타일]·[색감] 을 고르면 **선택한 것 하나만** 실물 크기 그대로(축소) 실시간 미리보기 → 그대로 PDF 저장.
 * 미리보기는 PDF에 들어갈 **바로 그 HTML**이라 실물과 어긋나지 않는다(같은 buildPortfolioPages).
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

// 표지 선택용 **미니 목업** — 실제 표지를 그대로 축소해 구조(사진 위치·이름 자리)를 보여준다.
// 회색 자리표시 이미지로 렌더하므로 "어떤 레이아웃인지" 한눈에 보인다(글로 된 이름만으론 감이 안 온다는 지적).
function CoverMock({ html, w, h, tw }: { html: string; w: number; h: number; tw: number }) {
  const scale = tw / w;
  return (
    <div style={{ width: tw, height: Math.round(h * scale) }} className="overflow-hidden bg-white">
      <div style={{ width: w, height: h, transform: `scale(${scale})`, transformOrigin: 'top left' }} dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}

/**
 * 미리보기 배율 — 컨테이너 폭에 맞추되 한 장이 화면 높이를 넘지 않게 한다.
 * 폭만 기준으로 하면 A4 세로가 한 장에 화면 두 배 높이가 되어 넘겨보기가 불편하다.
 */
function useFitScale(pageW: number, pageH: number, maxViewH: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.2);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const bw = el.clientWidth || pageW;
      setScale(Math.min(1, bw / pageW, maxViewH / pageH));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    return () => { ro.disconnect(); window.removeEventListener('resize', measure); };
  }, [pageW, pageH, maxViewH]);
  return { ref, scale };
}

function phaseLabel(phase: BookPhase, done: number, total: number) {
  if (phase === 'images') return `작품 불러오는 중 ${done}/${total}`;
  if (phase === 'retry') return `다시 시도 ${done}/${total}`;
  return `페이지 만드는 중 ${done}/${total}`;
}

// 포맷 A/B/C/D 프리셋은 없앴다 — 표지·글꼴·판형·밀도·설명·색(배경/글자/강조)의 **조합**으로 만든다.
const PAGES: readonly [PageKey, string][] = [
  ['a4-portrait', '세로'], ['a4-landscape', '가로'], ['wide', '와이드'],
];
const WORKS_LAYOUTS: readonly [WorksLayout, string][] = [
  ['hero', '1점 크게'], ['label', '작품+설명'], ['full', '꽉 채우기'], ['duo', '2점씩'], ['grid', '4점씩'], ['index', '6점 목록'],
];
const DESCS: readonly [DescDepth, string][] = [['none', '설명 없음'], ['short', '짧게'], ['full', '전체']];
const WORKS_CAPTIONS: readonly [WorksCaption, string][] = [['below', '아래 가운데'], ['left', '아래 왼쪽'], ['minimal', '제목만']];
const PROSE_ALIGNS: readonly [ProseAlign, string][] = [['justify', '양쪽맞춤'], ['left', '왼쪽'], ['right', '오른쪽']];
const COVER_GROUPS = ['사진 없이', '대표작 1점', '여러 작품', '색 배경', '심플'] as const;
const PAGE_LABELS: Record<PageKey, string> = { 'a4-portrait': '세로 A4', 'a4-landscape': '가로 A4', 'wide': '와이드 16:9' };

// ── 작품 페이지 레이아웃별로 어떤 본문 설정이 실제 반영되는가 ──
// (엔진 기준: hero/label 은 캡션 위치 고정, full·index 는 설명 없음, worksCaption 은 duo/grid 에서만)
function bodyApplicability(wl: WorksLayout) {
  return {
    // 작품 설명: full(꽉채우기)·index(6점목록)에선 안 나온다
    descApplies: wl !== 'full' && wl !== 'index',
    // '전체(긴 설명 전문)'는 한 장에 작품 1점인 레이아웃에서 뒤 글 페이지로 이어 실을 수 있다(hero·label).
    // 격자(2·4점씩)는 한 장에 여러 점이라 전문을 못 실어 2줄 요약까지만.
    descFullDiffers: wl === 'hero' || wl === 'label',
    // 작품 정보 위치(캡션 정렬): 격자(2점씩/4점씩)에서만 고를 수 있다(나머지는 자동 배치)
    captionApplies: wl === 'duo' || wl === 'grid',
  };
}

// 표지 레이아웃이 쓰는 사진 칸 수(minImages) — 사진 없이=0, 대표작=1, 여러작품=3~4.
function coverSlotCount(layout: PdfDesign['coverLayout']): number {
  return COVER_LAYOUTS.find((c) => c.key === layout)?.minImages ?? 0;
}

// ── 표지 인라인 편집(미리캔버스식) — 미리보기 표지 아래에서 **각 사진 칸을 직접** 교체/삭제하고 글을 켠다/끈다.
// ⚠️ 여러작품 표지(4점 격자 등)는 칸이 여러 개다. 슬롯을 골라(활성) 아래 작품 띠에서 채운다.
function CoverInlineEditor({
  design, onPatch, works, open, setOpen,
}: {
  design: PdfDesign; onPatch: (p: Partial<PdfDesign>) => void; works: PortfolioImage[];
  open: boolean; setOpen: (v: boolean) => void;
}) {
  const withImg = works.filter((w) => w.url);
  const slotCount = coverSlotCount(design.coverLayout);
  // 슬롯 배열은 항상 slotCount 길이. 0 = 빈 칸. 명시 목록 없으면 포트폴리오 순서로 채운 기본값.
  const defaultIds = withImg.map((w) => w.id);
  const baseIds = design.coverImageIds.length ? design.coverImageIds : defaultIds;
  const slotIds: number[] = Array.from({ length: slotCount }, (_, i) => baseIds[i] ?? 0);
  const [activeSlot, setActiveSlot] = useState(0);
  const active = Math.min(activeSlot, Math.max(0, slotCount - 1));
  const byId = new Map(works.map((w) => [w.id, w] as const));
  const filled = slotIds.filter((id) => id).length;

  // 슬롯 편집은 항상 slotCount 길이 배열로 저장(0=빈 칸). 전부 비워도 그 레이아웃을 유지한다.
  const setSlot = (i: number, id: number) => { const next = [...slotIds]; next[i] = id; onPatch({ coverImageIds: next }); };
  const removeSlot = (i: number) => { const next = [...slotIds]; next[i] = 0; onPatch({ coverImageIds: next }); };
  const resetImages = () => onPatch({ coverImageIds: [] });

  const toggle = (k: 'coverEyebrow' | 'coverTagline' | 'coverYear' | 'coverNameAccent') => onPatch({ [k]: !design[k] } as Partial<PdfDesign>);
  const tchip = (on: boolean) =>
    `inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors ${on ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-300 text-gray-500 hover:bg-gray-100'}`;

  return (
    <div className="mt-2 w-full">
      <button type="button" onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50">
        <Pencil size={13} /> 표지 편집 {open ? '▲' : '▼'}
      </button>
      {open && (
        <div className="mt-2 space-y-3 rounded-xl border border-gray-200 bg-white p-3 text-left shadow-sm">
          {slotCount > 0 && withImg.length > 0 && (
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <p className="text-[11px] font-medium text-gray-500">
                  {slotCount === 1 ? '대표 사진' : `표지 사진 ${slotCount}칸`}
                  <span className="text-gray-300"> {slotCount === 1 ? '(표지에 쓸 작품)' : '(칸을 고른 뒤 아래에서 작품 선택)'}</span>
                </p>
                {design.coverImageIds.length > 0 && (
                  <button type="button" onClick={resetImages} className="text-[11px] text-gray-400 underline hover:text-gray-600">자동으로</button>
                )}
              </div>
              {/* 슬롯 줄 — 여러 칸이면 골라서(활성) 편집 */}
              <div className="mb-2 flex flex-wrap gap-1.5">
                {Array.from({ length: slotCount }).map((_, i) => {
                  const w = slotIds[i] != null ? byId.get(slotIds[i]) : undefined;
                  return (
                    <div key={i} className="relative">
                      <button type="button" onClick={() => setActiveSlot(i)}
                        className={`grid h-14 w-14 place-items-center overflow-hidden rounded-md border-2 ${(slotCount > 1 && active === i) ? 'border-gray-900' : 'border-gray-200'} bg-gray-50`}>
                        {w?.url ? <img src={w.url} alt="" className="h-full w-full object-cover" /> : <span className="text-[10px] text-gray-400">빈 칸</span>}
                      </button>
                      {w && (
                        <button type="button" onClick={() => removeSlot(i)} title="이 칸 비우기"
                          className="absolute -right-1.5 -top-1.5 grid h-4 w-4 place-items-center rounded-full bg-gray-900 text-white shadow">
                          <X size={10} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
              {/* 작품 띠 — 클릭하면 (여러 칸이면 활성 칸에) 채운다 */}
              <div className="flex gap-1.5 overflow-x-auto pb-1">
                {withImg.map((w) => {
                  const used = slotIds[active] === w.id;
                  return (
                    <button key={w.id} type="button" onClick={() => setSlot(active, w.id)}
                      className={`h-11 w-11 shrink-0 overflow-hidden rounded-md border-2 ${used ? 'border-gray-900' : 'border-transparent hover:border-gray-300'}`}>
                      <img src={w.url} alt="" className="h-full w-full object-cover" />
                    </button>
                  );
                })}
              </div>
              {slotCount > 1 && filled < slotCount && (
                <p className="mt-1 text-[11px] text-gray-400">채우지 않은 칸은 표지에 <b className="text-gray-500">빈 자리</b>로 남습니다{filled === 0 ? ' (전부 비울 수도 있어요)' : ''}.</p>
              )}
            </div>
          )}
          <div>
            <p className="mb-1.5 text-[11px] font-medium text-gray-500">표시할 글 <span className="text-gray-300">(끄면 표지에서 사라짐)</span></p>
            <div className="flex flex-wrap gap-1.5">
              <button type="button" onClick={() => toggle('coverEyebrow')} className={tchip(design.coverEyebrow)}>영문 머리말</button>
              <button type="button" onClick={() => toggle('coverTagline')} className={tchip(design.coverTagline)}>한 줄 소개</button>
              <button type="button" onClick={() => toggle('coverYear')} className={tchip(design.coverYear)}>연도</button>
              <button type="button" onClick={() => toggle('coverNameAccent')} className={tchip(design.coverNameAccent)}>이름 강조색</button>
            </div>
          </div>
          <div className="space-y-2">
            {slotCount > 0 && (
              <label className="block">
                <span className="text-[11px] font-medium text-gray-500">그림 크기 <span className="font-normal text-gray-300">{Math.round(design.coverImageScale * 100)}%</span></span>
                <input type="range" min={0.6} max={1} step={0.05} value={design.coverImageScale}
                  onChange={(e) => onPatch({ coverImageScale: Number(e.target.value) })} className="mt-1 w-full accent-gray-900" />
              </label>
            )}
            <label className="block">
              <span className="text-[11px] font-medium text-gray-500">글자 크기 <span className="font-normal text-gray-300">{Math.round(design.coverTextScale * 100)}%</span></span>
              <input type="range" min={0.8} max={1.25} step={0.05} value={design.coverTextScale}
                onChange={(e) => onPatch({ coverTextScale: Number(e.target.value) })} className="mt-1 w-full accent-gray-900" />
            </label>
          </div>
          {design.coverEyebrow && (
            <div>
              <p className="mb-1 text-[11px] font-medium text-gray-500">영문 머리말 문구</p>
              <input type="text" value={design.coverEyebrowText ?? ''} maxLength={40}
                onChange={(e) => onPatch({ coverEyebrowText: e.target.value })}
                placeholder="ARTWORK PORTFOLIO"
                className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-xs uppercase tracking-wider focus:border-gray-500 focus:outline-none" />
              <p className="mt-1 text-[11px] text-gray-400">비워두면 기본 ‘ARTWORK PORTFOLIO’.</p>
            </div>
          )}
          {design.coverTagline && (
            <div>
              <p className="mb-1 text-[11px] font-medium text-gray-500">한 줄 소개 문구 <span className="font-normal text-gray-300">(표지에만 나오는 문구)</span></p>
              <input type="text" value={design.coverTaglineText ?? ''} maxLength={80}
                onChange={(e) => onPatch({ coverTaglineText: e.target.value })}
                placeholder="예) 회화와 설치를 오가며 시간의 층위를 탐구한다"
                className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-xs focus:border-gray-500 focus:outline-none" />
              {COVER_SHOWS_TAGLINE.has(design.coverLayout)
                ? <p className="mt-1 text-[11px] text-gray-400">홈페이지 한 줄 소개와 별개예요. 비워두면 표지에 소개 줄이 안 나옵니다.</p>
                : <p className="mt-1 text-[11px] text-[#c4302b]">지금 고른 표지에는 한 줄 소개가 나오지 않습니다. 다른 표지를 고르면 표시돼요.</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── 인라인 제작 미리보기 — **적용된 판형 크기**(pageW/pageH)로 스케일한다.
// ⚠️ 표지의 '고유 크기'가 아니라 design.page 로 정해진 크기여야 한다(표지를 바꿔도 크기·비율 불변).
function MakerPreview({ pages, pageW, pageH, design, onPatch, works }: { pages: PortfolioPage[]; pageW: number; pageH: number; design: PdfDesign; onPatch: (p: Partial<PdfDesign>) => void; works: PortfolioImage[] }) {
  const maxViewH = Math.max(320, (typeof window !== 'undefined' ? window.innerHeight : 900) - 320);
  const { ref, scale } = useFitScale(pageW, pageH, maxViewH);
  const [coverOpen, setCoverOpen] = useState(false);
  return (
    <div className="rounded-xl border border-gray-200 bg-neutral-100 p-4">
      <div ref={ref} className="mx-auto flex flex-col items-center gap-5">
        {pages.map((p, i) => (
          <div key={i} style={{ width: pageW * scale }}>
            <div className="mb-1 flex items-baseline gap-2 text-[11px] text-gray-400">
              <span className="tabular-nums">{String(i + 1).padStart(2, '0')}</span>
              <span>{p.label}</span>
              {i === 0 && <span className="ml-auto text-[11px] text-gray-400">표지를 눌러 편집</span>}
            </div>
            {i === 0 ? (
              // 표지는 클릭하면 아래 편집기가 열린다(미리캔버스식 진입점)
              <button type="button" onClick={() => setCoverOpen(true)}
                className="group relative block w-full cursor-pointer" title="표지 편집">
                <PagePreview html={p.html} w={pageW} h={pageH} scale={scale} />
                <span className="pointer-events-none absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/55 px-2 py-1 text-[11px] font-medium text-white opacity-0 transition-opacity group-hover:opacity-100">
                  <Pencil size={11} /> 편집
                </span>
              </button>
            ) : (
              <PagePreview html={p.html} w={pageW} h={pageH} scale={scale} />
            )}
            {i === 0 && <CoverInlineEditor design={design} onPatch={onPatch} works={works} open={coverOpen} setOpen={setCoverOpen} />}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── 전체화면 미리보기 (선택) ──
function PreviewModal({
  pages, pageW, pageH, sizeLabel, onClose, onDownload, busy, progress,
}: {
  pages: PortfolioPage[];
  pageW: number;
  pageH: number;
  sizeLabel: string;
  onClose: () => void;
  onDownload: () => void;
  busy: boolean;
  progress: string;
}) {
  const { ref, scale } = useFitScale(pageW, pageH, Math.max(320, window.innerHeight - 190));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  return createPortal(
    <div className="fixed inset-0 z-[80] bg-neutral-900 flex flex-col">
      <div className="flex items-center justify-between px-4 sm:px-6 py-3 bg-neutral-900 text-white flex-none">
        <div className="min-w-0">
          <p className="text-[15px] font-semibold truncate">포트폴리오 미리보기</p>
          <p className="text-[11px] text-white/55">{sizeLabel} · 총 {pages.length}쪽</p>
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
            <div key={i} style={{ width: pageW * scale }}>
              <div className="flex items-baseline gap-2 mb-1.5 text-white/60 text-[11px]">
                <span className="tabular-nums">{String(i + 1).padStart(2, '0')}</span>
                <span>{p.label}</span>
              </div>
              <PagePreview html={p.html} w={pageW} h={pageH} scale={scale} />
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
  /** 저장된 디자인(표지·글꼴·판형·밀도·설명·색감) */
  designValue?: unknown;
  onChangeDesign?: (d: PdfDesign) => void;
}

/**
 * 포트폴리오 제작 — 표지·글꼴·판형·밀도·설명·색감을 **조합**해 그 하나를 실시간으로 그려 보여주고 PDF로 만든다.
 */
export default function PortfolioFormatPicker({ data, designValue, onChangeDesign }: Props) {
  const [design, setDesign] = useState<PdfDesign>(() => normalizePdfDesign(designValue));
  const [tab, setTab] = useState<'cover' | 'style' | 'body'>('cover');
  const [fullscreen, setFullscreen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');

  const works = data.images;
  const missingCaption = works.filter((w) => !hasCaption(w)).length;
  // 본문 base 는 표지와 무관하게 archive 고정(buildPortfolioPages 내부도 동일). 표지는 design.cover 로 그린다.
  const pages = useMemo(() => buildPortfolioPages(data, themeById('archive'), { design }), [data, design]);
  // ⚠️ 미리보기 스케일은 **적용된 판형**(design.page)으로 — 표지 고유 크기가 아니다(표지 바꿔도 크기 불변)
  const pageDims = PAGE_DIMS[design.page] ?? PAGE_DIMS['a4-portrait'];
  const sizeLabel = PAGE_LABELS[design.page] ?? '세로 A4';

  // 표지 22종 미니 목업 — 현재 판형·색·글꼴로 실제 렌더해 축소(회색 자리표시 이미지). 팔레트/판형 바뀔 때만 다시 만든다.
  const coverMocks = useMemo(() => {
    const gray = "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='400'%20height='300'%3E%3Crect%20width='400'%20height='300'%20fill='%23d9d6d0'/%3E%3C/svg%3E";
    const md = {
      user: { name: '작가 이름', nickname: null }, year: '2025', tagline: '한 줄 소개 문구',
      images: Array.from({ length: 4 }, (_, i) => ({ id: i + 1, url: gray, order: i, title: `작품 ${i + 1}` })),
      seriesInfo: [], bio: '', statement: '', career: {},
    } as unknown as PortfolioBookData;
    return COVER_LAYOUTS.map((c) => ({
      key: c.key, label: c.label, group: c.group,
      html: buildPortfolioPages(md, themeById('archive'), { design: normalizePdfDesign({
        coverLayout: c.key, page: design.page, font: design.font, bg: design.bg, ink: design.ink, accent: design.accent, coverNameAccent: design.coverNameAccent,
        coverImageScale: design.coverImageScale, coverTextScale: design.coverTextScale,
      }) })[0]!.html,
    }));
  }, [design.page, design.font, design.bg, design.ink, design.accent, design.coverNameAccent, design.coverImageScale, design.coverTextScale]);

  // 작품 페이지 6종 미니 목업 — 실제 작품 페이지를 회색 자리표시로 축소(표지와 같은 방식).
  const worksMocks = useMemo(() => {
    const gray = "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='400'%20height='300'%3E%3Crect%20width='400'%20height='300'%20fill='%23d9d6d0'/%3E%3C/svg%3E";
    const md = {
      user: { name: '이름', nickname: null }, year: '2025', tagline: '',
      images: Array.from({ length: 6 }, (_, i) => ({ id: i + 1, url: gray, order: i, title: `작품 ${i + 1}`, medium: 'Oil on canvas', sizeText: '80 × 60 cm', year: '2024', series: 'S', description: '작품 설명 예시 문장입니다. 재료와 시간의 층위를 담았다.' })),
      seriesInfo: [], bio: '', statement: '', career: {},
    } as unknown as PortfolioBookData;
    return WORKS_LAYOUTS.map(([key, label]) => {
      const pages = buildPortfolioPages(md, themeById('archive'), { design: normalizePdfDesign({
        worksLayout: key, page: design.page, font: design.font, bg: design.bg, ink: design.ink, accent: design.accent, desc: design.desc, worksCaption: design.worksCaption, proseAlign: design.proseAlign,
      }) });
      const wp = pages.find((p) => p.label === 'S') ?? pages[1] ?? pages[0]!;
      return { key, label, html: wp.html };
    });
  }, [design.page, design.font, design.bg, design.ink, design.accent, design.desc, design.worksCaption, design.proseAlign]);

  const patch = (p: Partial<PdfDesign>) => {
    const next = { ...design, ...p };
    setDesign(next);
    onChangeDesign?.(next);
  };

  // 배경색 바꾸면 글자색·강조색 대비를 확인 — 새 배경에서 대비 부족이면 추천값으로 자동 교체
  const recTexts = recommendedTextKeys(design.bg);
  const recAccents = recommendedAccentKeys(design.bg);
  const setBg = (bg: string) => {
    const rt = recommendedTextKeys(bg);
    const ink = rt.includes(design.ink) ? design.ink : bestTextKey(bg);
    const ra = recommendedAccentKeys(bg);
    const accent = ra.includes(design.accent) ? design.accent : bestAccentKey(bg);
    patch({ bg, ink, accent });
  };

  // 포트폴리오용 추가 한글 웹폰트를 이 화면에서만 지연 로드(전역 성능 영향 0). PDF 저장은 document.fonts.ready 를 기다린다.
  useEffect(() => {
    const id = 'portfolio-webfonts';
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id = id; link.rel = 'stylesheet'; link.href = PORTFOLIO_FONT_HREF;
    document.head.appendChild(link);
  }, []);

  const download = async () => {
    if (works.length === 0) {
      toast.error('작품 사진을 먼저 등록해주세요.');
      return;
    }
    setBusy(true);
    setProgress('');
    try {
      const { missing, pages: n } = await downloadPortfolioBook(data, 'archive', (d, t, phase) => setProgress(phaseLabel(phase, d, t)), design);
      if (missing.length > 0) {
        toast.error(`${n}쪽으로 저장했지만 작품 ${missing.length}장을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.`, { duration: 6000 });
      } else {
        toast.success(`저장했습니다. (${n}쪽)`);
      }
    } catch {
      toast.error('PDF 생성에 실패했습니다.');
    } finally {
      setBusy(false);
      setProgress('');
    }
  };

  // 편집 가능한 PPTX — 각 요소가 네이티브 파워포인트 개체(사람이 수정 가능).
  const downloadPpt = async () => {
    if (works.length === 0) { toast.error('작품 사진을 먼저 등록해주세요.'); return; }
    setBusy(true); setProgress('');
    try {
      const { missing, pages: n } = await downloadPortfolioPptx(data, 'archive', (d, t, phase) => setProgress(phaseLabel(phase, d, t)), design);
      if (missing.length > 0) toast.error(`${n}쪽으로 저장했지만 작품 ${missing.length}장을 불러오지 못했습니다.`, { duration: 6000 });
      else toast.success(`PPT로 저장했습니다. (${n}쪽) 파워포인트에서 편집할 수 있어요.`, { duration: 5000 });
    } catch {
      toast.error('PPT 생성에 실패했습니다.');
    } finally {
      setBusy(false); setProgress('');
    }
  };

  const chip = (active: boolean) =>
    `inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${
      active ? 'border-gray-900 text-gray-900' : 'border-gray-200 text-gray-500 hover:bg-gray-50'
    }`;

  return (
    <div className="lg:flex lg:gap-6">
      {/* 좌: 설정 — sticky 라 우측 미리보기를 스크롤해도 사라지지 않는다 */}
      <div className="lg:w-72 lg:shrink-0">
        <div className="space-y-3 lg:sticky lg:top-24">
          <p className="text-xs text-gray-400">작품 {works.length}점 · 총 {pages.length}쪽</p>

          {missingCaption > 0 && (
            <p className="text-[12px] text-[#c4302b] leading-relaxed">
              작품 {missingCaption}점에 작품명·재료·크기·연도가 없습니다. 홈페이지에서 정보를 채워 퀄리티를 높여보세요.
            </p>
          )}

          {/* 탭 — 한 번에 한 묶음만 보여 설정란이 짧게 유지된다 */}
          <div className="flex rounded-lg bg-gray-100 p-0.5 text-xs">
            {([['cover', '표지'], ['style', '색·글꼴'], ['body', '작품·본문']] as const).map(([val, label]) => (
              <button key={val} type="button" onClick={() => setTab(val)}
                className={`flex-1 rounded-md px-2 py-1.5 font-medium transition-colors ${tab === val ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                {label}
              </button>
            ))}
          </div>

          {/* 스크롤은 이 안에서만 — 저장 버튼은 항상 아래 고정 */}
          <div className="max-h-[calc(100vh-320px)] space-y-3 overflow-y-auto pr-0.5">

          {tab === 'cover' && <>
            <p className="text-[11px] text-gray-500">표지 레이아웃 <span className="text-gray-300">22종 · 눌러서 고르기</span></p>
            {COVER_GROUPS.map((group) => (
              <div key={group}>
                <p className="mb-1 text-[11px] font-medium text-gray-400">{group}</p>
                <div className="grid grid-cols-3 gap-1.5">
                  {coverMocks.filter((c) => c.group === group).map((c) => {
                    const on = design.coverLayout === c.key;
                    return (
                      <button key={c.key} type="button" onClick={() => patch({ coverLayout: c.key })} title={c.label}
                        className={`group flex flex-col items-center gap-0.5 rounded-md border p-1 transition-colors ${on ? 'border-gray-900 bg-gray-50' : 'border-gray-200 hover:border-gray-400'}`}>
                        <div className={`w-full overflow-hidden rounded-sm ring-1 ${on ? 'ring-gray-900' : 'ring-black/10'}`}>
                          <CoverMock html={c.html} w={pageDims.w} h={pageDims.h} tw={72} />
                        </div>
                        <span className={`w-full truncate text-center text-[9px] leading-tight ${on ? 'font-medium text-gray-900' : 'text-gray-400'}`}>{c.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            <p className="text-[11px] leading-relaxed text-gray-400">
              머리말·한 줄 소개·연도·대표 사진은 기본으로 들어갑니다. <b className="text-gray-500">오른쪽 미리보기의 표지를 눌러</b> 끄거나 바꿀 수 있어요.
            </p>
          </>}

          {tab === 'style' && <>
            <div>
              <p className="mb-1.5 text-xs text-gray-500">글꼴</p>
              <div className="flex flex-wrap gap-1.5">
                {FONT_PRESETS.map((fp) => (
                  <button key={fp.key} type="button" onClick={() => patch({ font: fp.key })} className={chip(design.font === fp.key)} style={{ fontFamily: fp.title }}>{fp.label}</button>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-1.5 text-xs text-gray-500">배경색</p>
              <div className="flex flex-wrap gap-1.5">
                {BACKGROUNDS.map((s) => (
                  <button key={s.key} type="button" title={s.label} aria-label={s.label} onClick={() => setBg(s.key)}
                    className={`h-7 w-7 rounded-full border-2 ${design.bg === s.key ? 'border-gray-900' : 'border-gray-200'}`}
                    style={{ background: s.hex }} />
                ))}
              </div>
            </div>
            <div>
              <p className="mb-1.5 text-xs text-gray-500">글자색 <span className="text-green-600">● 추천</span></p>
              <div className="flex flex-wrap gap-1.5">
                {TEXTS.map((s) => {
                  const rec = recTexts.includes(s.key);
                  return (
                    <button key={s.key} type="button" title={rec ? s.label : `${s.label} · 대비 낮음`} aria-label={s.label}
                      onClick={() => patch({ ink: s.key })}
                      className={`relative h-7 w-7 rounded-full border-2 ${design.ink === s.key ? 'border-gray-900' : 'border-gray-200'} ${rec ? '' : 'opacity-30'}`}
                      style={{ background: s.hex }}>
                      {rec && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-green-500 ring-1 ring-white" />}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <p className="mb-1.5 text-xs text-gray-500">강조색 <span className="text-green-600">● 추천</span></p>
              <div className="flex flex-wrap gap-1.5">
                {ACCENTS.map((s) => {
                  const rec = recAccents.includes(s.key);
                  return (
                    <button key={s.key} type="button" title={rec ? s.label : `${s.label} · 대비 낮음`} aria-label={s.label} onClick={() => patch({ accent: s.key })}
                      className={`relative grid h-7 w-7 place-items-center rounded-full border-2 ${design.accent === s.key ? 'border-gray-900' : 'border-gray-200'} ${rec ? '' : 'opacity-30'}`}
                      style={s.key === 'mono' ? undefined : { background: s.hex }}>
                      {s.key === 'mono' && <span className="text-[9px] text-gray-500">글자</span>}
                      {rec && s.key !== 'mono' && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-green-500 ring-1 ring-white" />}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <p className="mb-1.5 text-xs text-gray-500">판형</p>
              <div className="flex flex-wrap gap-1.5">
                {PAGES.map(([val, label]) => (
                  <button key={val} type="button" onClick={() => patch({ page: val })} className={chip(design.page === val)}>{label}</button>
                ))}
              </div>
            </div>
          </>}

          {tab === 'body' && (() => {
            const rules = bodyApplicability(design.worksLayout);
            // 설명 칩 — '전체'가 '짧게'와 달라지는 건 label 뿐. 나머지 레이아웃엔 '전체'를 아예 안 보여준다(같은 결과라 헷갈림).
            const descOptions = rules.descFullDiffers ? DESCS : DESCS.filter(([v]) => v !== 'full');
            // 레이아웃 바꿀 때 그 레이아웃이 못 쓰는 값은 정리해 저장(엔진은 무시하지만 UI·저장값을 정직하게)
            const changeLayout = (val: WorksLayout) => {
              const r = bodyApplicability(val);
              const p: Partial<PdfDesign> = { worksLayout: val };
              if (design.desc === 'full' && !r.descFullDiffers) p.desc = 'short';
              patch(p);
            };
            return <>
            <div>
              <p className="mb-1.5 text-xs text-gray-500">작품 페이지 <span className="text-gray-300">(눌러서 고르기)</span></p>
              <div className="grid grid-cols-3 gap-1.5">
                {worksMocks.map((m) => {
                  const on = design.worksLayout === m.key;
                  return (
                    <button key={m.key} type="button" onClick={() => changeLayout(m.key)} title={m.label}
                      className={`flex flex-col items-center gap-0.5 rounded-md border p-1 transition-colors ${on ? 'border-gray-900 bg-gray-50' : 'border-gray-200 hover:border-gray-400'}`}>
                      <div className={`w-full overflow-hidden rounded-sm ring-1 ${on ? 'ring-gray-900' : 'ring-black/10'}`}>
                        <CoverMock html={m.html} w={pageDims.w} h={pageDims.h} tw={72} />
                      </div>
                      <span className={`w-full truncate text-center text-[9px] leading-tight ${on ? 'font-medium text-gray-900' : 'text-gray-400'}`}>{m.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className={rules.descApplies ? '' : 'opacity-45'}>
              <p className="mb-1.5 text-xs text-gray-500">작품 설명</p>
              <div className={`flex flex-wrap gap-1.5 ${rules.descApplies ? '' : 'pointer-events-none'}`}>
                {descOptions.map(([val, label]) => (
                  <button key={val} type="button" onClick={() => patch({ desc: val })} className={chip(design.desc === val)}>{label}</button>
                ))}
              </div>
              {!rules.descApplies
                ? <p className="mt-1 text-[11px] text-gray-400">‘꽉 채우기·6점 목록’ 레이아웃에는 작품 설명이 들어가지 않습니다.</p>
                : rules.descFullDiffers
                  ? <p className="mt-1 text-[11px] text-gray-400">‘전체’는 긴 설명을 다 싣고, 넘치면 다음 글 페이지로 이어집니다.</p>
                  : <p className="mt-1 text-[11px] text-gray-400">이 레이아웃에서는 설명이 작품 옆에 2줄로 요약됩니다.</p>}
            </div>
            <div className={rules.captionApplies ? '' : 'opacity-45'}>
              <p className="mb-1.5 text-xs text-gray-500">작품 정보 위치 <span className="text-gray-300">(제목·재료)</span></p>
              <div className={`flex flex-wrap gap-1.5 ${rules.captionApplies ? '' : 'pointer-events-none'}`}>
                {WORKS_CAPTIONS.map(([val, label]) => (
                  <button key={val} type="button" onClick={() => patch({ worksCaption: val })} className={chip(design.worksCaption === val)}>{label}</button>
                ))}
              </div>
              {!rules.captionApplies && (
                <p className="mt-1 text-[11px] text-gray-400">위치 선택은 ‘2점씩·4점씩’에서만 적용됩니다(나머지는 자동 배치).</p>
              )}
            </div>
            <div>
              <p className="mb-1.5 text-xs text-gray-500">본문 정렬 <span className="text-gray-300">(작가노트·약력 등)</span></p>
              <div className="flex flex-wrap gap-1.5">
                {PROSE_ALIGNS.map(([val, label]) => (
                  <button key={val} type="button" onClick={() => patch({ proseAlign: val })} className={chip(design.proseAlign === val)}>{label}</button>
                ))}
              </div>
            </div>
          </>;
          })()}

          </div>

          {/* 저장 / 전체화면 */}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              onClick={download}
              disabled={busy || works.length === 0}
              className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <FileDown size={14} />}
              {busy ? (progress || '만드는 중') : 'PDF 저장'}
            </button>
            <button
              onClick={downloadPpt}
              disabled={busy || works.length === 0}
              title="파워포인트에서 요소별로 편집할 수 있습니다"
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              <FileDown size={14} /> PPT 저장
            </button>
            <button
              onClick={() => setFullscreen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
            >
              <Maximize2 size={14} /> 전체화면
            </button>
          </div>
        </div>
      </div>

      {/* 우: 제작 미리보기 — 조합 반영, 판형 크기로 스케일 */}
      <div className="mt-5 lg:mt-0 lg:flex-1 lg:min-w-0">
        <MakerPreview pages={pages} pageW={pageDims.w} pageH={pageDims.h} design={design} onPatch={patch} works={works} />
      </div>

      {fullscreen && (
        <PreviewModal
          pages={pages}
          pageW={pageDims.w}
          pageH={pageDims.h}
          sizeLabel={sizeLabel}
          busy={busy}
          progress={progress}
          onClose={() => setFullscreen(false)}
          onDownload={download}
        />
      )}
    </div>
  );
}
