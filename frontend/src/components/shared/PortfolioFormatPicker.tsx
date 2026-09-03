import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2, FileDown, Maximize2, Pencil, ChevronDown, Wand2, Check } from 'lucide-react';
import type { PortfolioImage } from '@/types';
import toast from 'react-hot-toast';
import {
  buildPortfolioPages, downloadPortfolioBook, downloadPortfolioPptx, themeById, normalizePdfDesign, PAGE_DIMS, FONT_PRESETS, PORTFOLIO_FONT_HREF, COVER_LAYOUTS, WORKS_PER_PAGE,
  type BookPhase, type PortfolioBookData, type PortfolioPage,
  type PdfDesign, type PageKey, type WorksLayout, type DescDepth, type WorksCaption, type ProseAlign,
} from '@/lib/portfolioFormats';
import { BACKGROUNDS, TEXTS, ACCENTS, recommendedTextKeys, bestTextKey, recommendedAccentKeys, bestAccentKey } from '@/lib/portfolioColors';
import { measureAspects, aspectMap, analyzePortfolio } from '@/lib/artworkAnalysis';
import { DESIGN_DIRECTIONS, recommendDirections, directionByKey, type DesignDirection } from '@/lib/portfolioDirection';
import { hasCaption, normalizeCareer } from '@/lib/artwork';

/**
 * 포트폴리오 **제작 화면**.
 *
 * ## 무엇이 바뀌었나 (추천 우선, §5·§19~§24)
 * 예전 화면은 표지 20종 · 작품 7종 · 글꼴 6 · 배경 8 · 글자 7 · 강조 7 · 판형 3 …
 * **저수준 선택지를 한꺼번에** 늘어놓았다. 작가는 디자이너가 아니라서 "어느 조합이 좋은가"를
 * 스스로 풀어야 했고, 실제로는 대부분 기본값 그대로 뽑았다. 즉 선택지는 많은데 결정은 없었다.
 *
 * 지금은 **먼저 좋은 답을 준다**:
 *   1단계 추천 3종 (실제 작품 수·비율·캡션에서 뽑는다 — 이유도 함께)
 *   2단계 디자인 방향 6종
 *   3단계 작품 배치 (자동 / 직접)
 *   4단계 세부 (색·글꼴·판형·표지·설명)
 * 아무것도 없애지 않았다 — 순서를 바꿨을 뿐이다(§38 하위호환).
 *
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

// 표지·작품 선택용 **미니 목업** — 실제 페이지를 그대로 축소해 구조를 보여준다.
// `th` 를 주면 그 상자 **안에 맞춘다**(가로 판형과 세로 판형이 한 줄에 섞여도 카드 높이가 흔들리지 않게).
function CoverMock({ html, w, h, tw, th }: { html: string; w: number; h: number; tw: number; th?: number }) {
  const scale = th ? Math.min(tw / w, th / h) : tw / w;
  const box = { width: tw, height: th ?? Math.round(h * scale) };
  return (
    <div style={box} className="flex items-center justify-center overflow-hidden bg-white">
      <div style={{ width: w * scale, height: h * scale }} className="overflow-hidden">
        <div style={{ width: w, height: h, transform: `scale(${scale})`, transformOrigin: 'top left' }} dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    </div>
  );
}

/**
 * 미리보기 배율 — 컨테이너 폭에 맞추되 한 장이 화면 높이를 넘지 않게 한다.
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

const PAGES: readonly [PageKey, string][] = [
  ['a4-portrait', '세로'], ['a4-landscape', '가로'], ['wide', '와이드'],
];
// ⚠️ 라벨은 **눈에 보이는 대로** — 작가가 뭘 얻는지 바로 알게(디자이너 용어 금지).
const WORKS_LAYOUTS: readonly [WorksLayout, string][] = [
  ['hero', '1점 크게'], ['label', '작품+설명'], ['full', '꽉 채우기'],
  ['feature', '크게+작게'], ['duo', '2점씩'], ['grid', '4점씩'], ['index', '6점 목록'],
];
const DESCS: readonly [DescDepth, string][] = [['none', '설명 없음'], ['short', '짧게'], ['full', '전체']];
const WORKS_CAPTIONS: readonly [WorksCaption, string][] = [['below', '아래 가운데'], ['left', '아래 왼쪽'], ['minimal', '제목만']];
const PROSE_ALIGNS: readonly [ProseAlign, string][] = [['justify', '양쪽맞춤'], ['left', '왼쪽'], ['right', '오른쪽']];
const COVER_GROUPS = ['사진 없이', '대표작 1점', '여러 작품', '색 배경', '심플'] as const;
const PAGE_LABELS: Record<PageKey, string> = { 'a4-portrait': '세로 A4', 'a4-landscape': '가로 A4', 'wide': '와이드 16:9' };

// ── 작품 페이지 레이아웃별로 어떤 본문 설정이 실제 반영되는가 ──
function bodyApplicability(wl: WorksLayout) {
  return {
    // 작품 설명: full(꽉채우기)·index(6점목록)에선 안 나온다
    descApplies: wl !== 'full' && wl !== 'index',
    // '전체(긴 설명 전문)'는 한 장에 작품 1점인 레이아웃에서만 뒤 글 페이지로 이어 실을 수 있다
    descFullDiffers: wl === 'hero' || wl === 'label',
    // 작품 정보 위치(캡션 정렬): 격자에서만 고를 수 있다(나머지는 자동 배치)
    captionApplies: wl === 'duo' || wl === 'grid' || wl === 'feature',
  };
}

// 표지 레이아웃이 쓰는 사진 칸 수(minImages)
function coverSlotCount(layout: PdfDesign['coverLayout']): number {
  return COVER_LAYOUTS.find((c) => c.key === layout)?.minImages ?? 0;
}

// ── 접히는 설정 묶음 ──────────────────────────────────────────────
function Section({ title, hint, open, onToggle, children }: {
  title: string; hint?: string; open: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <div className="border-t border-gray-100 pt-2.5">
      <button type="button" onClick={onToggle} className="flex w-full items-center justify-between gap-2 py-1 text-left">
        <span className="text-[13px] font-medium text-gray-800">{title}</span>
        <span className="flex items-center gap-1.5">
          {hint && <span className="text-[11px] text-gray-400">{hint}</span>}
          <ChevronDown size={14} className={`text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
        </span>
      </button>
      {open && <div className="space-y-3 pb-2 pt-2">{children}</div>}
    </div>
  );
}

// ── 표지 인라인 편집 — 미리보기 표지 아래에서 각 사진 칸을 직접 교체/삭제하고 글을 켠다/끈다.
function CoverInlineEditor({
  design, onPatch, works, open, setOpen,
}: {
  design: PdfDesign; onPatch: (p: Partial<PdfDesign>) => void; works: PortfolioImage[];
  open: boolean; setOpen: (v: boolean) => void;
}) {
  const withImg = works.filter((w) => w.url);
  const slotCount = coverSlotCount(design.coverLayout);
  const defaultIds = withImg.map((w) => w.id);
  const baseIds = design.coverImageIds.length ? design.coverImageIds : defaultIds;
  const slotIds: number[] = Array.from({ length: slotCount }, (_, i) => baseIds[i] ?? 0);
  const [activeSlot, setActiveSlot] = useState(0);
  const active = Math.min(activeSlot, Math.max(0, slotCount - 1));
  const byId = new Map(works.map((w) => [w.id, w] as const));
  const filled = slotIds.filter((id) => id).length;

  const setSlot = (i: number, id: number) => { const next = [...slotIds]; next[i] = id; onPatch({ coverImageIds: next }); };
  const removeSlot = (i: number) => { const next = [...slotIds]; next[i] = 0; onPatch({ coverImageIds: next }); };
  const resetImages = () => onPatch({ coverImageIds: [] });

  const toggle = (k: 'coverEyebrow' | 'coverYear' | 'coverNameAccent') => onPatch({ [k]: !design[k] } as Partial<PdfDesign>);
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
        </div>
      )}
    </div>
  );
}

// ── 추천 카드 — 표지와 작품면을 **실제로 그려서** 보여준다(§22: 작은 썸네일로는 판단이 안 된다) ──
function DirectionCard({
  dir, why, active, onPick, pages, pageW, pageH,
}: {
  dir: DesignDirection; why?: string; active: boolean; onPick: () => void;
  pages: PortfolioPage[]; pageW: number; pageH: number;
}) {
  // 판형이 섞여도(세로/가로/와이드) 카드가 들쭉날쭉하지 않게 **같은 상자 안에** 맞춘다.
  const [tw, th] = [124, 176];
  return (
    <button type="button" onClick={onPick}
      className={`flex-1 min-w-0 rounded-xl border p-3 text-left transition-colors ${
        active ? 'border-gray-900 bg-gray-50 ring-1 ring-gray-900' : 'border-gray-200 bg-white hover:border-gray-400'}`}>
      <div className="flex items-center gap-2">
        {pages.slice(0, 2).map((p, i) => (
          <div key={i} className="overflow-hidden rounded-sm ring-1 ring-black/10">
            <CoverMock html={p.html} w={pageW} h={pageH} tw={tw} th={th} />
          </div>
        ))}
      </div>
      <div className="mt-2.5 flex items-center gap-1.5">
        <span className="text-[13px] font-semibold text-gray-900">{dir.name}</span>
        {active && <Check size={13} className="text-gray-900" />}
      </div>
      <p className="mt-0.5 text-[11px] leading-relaxed text-gray-500">{why ?? dir.note}</p>
    </button>
  );
}

// ── 인라인 제작 미리보기 ──
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
              {p.works ? <span className="text-gray-300">작품 {p.works}점</span> : null}
              {i === 0 && <span className="ml-auto text-[11px] text-gray-400">표지를 눌러 편집</span>}
            </div>
            {i === 0 ? (
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

// ── 전체화면 미리보기 ──
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
  /** 저장된 디자인(방향·표지·글꼴·판형·배치·설명·색감) */
  designValue?: unknown;
  onChangeDesign?: (d: PdfDesign) => void;
}

export default function PortfolioFormatPicker({ data, designValue, onChangeDesign }: Props) {
  const [design, setDesign] = useState<PdfDesign>(() => normalizePdfDesign(designValue));
  // 자동 편집이면 '작품 배치'는 접어 둔다 — 시스템이 정하는 값이라 처음부터 펼쳐 두면
  // 고르라고 재촉하는 것처럼 보이고 사이드바만 길어진다(§19 인지 부담).
  const [open, setOpen] = useState<Record<string, boolean>>(() => ({ layout: !normalizePdfDesign(designValue).auto }));
  const [allDirections, setAllDirections] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');

  const works = data.images;
  const missingCaption = works.filter((w) => !hasCaption(w)).length;

  // ── 작품 사진 비율 실측 ────────────────────────────────────────
  // ⚠️ 빌더는 순수 동기 함수여야 하므로(미리보기=PDF 보장) 측정은 여기서 하고 결과만 넘긴다.
  //    측정 전에도 문서는 그대로 나온다 — 전부 정사각으로 보고 배치할 뿐이다.
  const urlKey = works.map((w) => w.url).join('|');
  const [aspectV, setAspectV] = useState(0);
  useEffect(() => {
    let alive = true;
    measureAspects(urlKey ? urlKey.split('|') : []).then((changed) => { if (alive && changed) setAspectV((v) => v + 1); });
    return () => { alive = false; };
  }, [urlKey]);
  const book = useMemo<PortfolioBookData>(
    () => ({ ...data, aspects: aspectMap(works) }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, urlKey, aspectV],
  );

  const character = useMemo(() => analyzePortfolio({
    images: works, seriesInfo: data.seriesInfo, statement: data.statement, biography: data.biography,
    careerCount: Object.values(normalizeCareer(data.career)).reduce((n, l) => n + l.length, 0),
    aspects: book.aspects,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [book]);
  const recs = useMemo(() => recommendDirections(character), [character]);

  const pages = useMemo(() => buildPortfolioPages(book, themeById('archive'), { design }), [book, design]);
  const pageDims = PAGE_DIMS[design.page] ?? PAGE_DIMS['a4-portrait'];
  const sizeLabel = PAGE_LABELS[design.page] ?? '세로 A4';

  const patch = (p: Partial<PdfDesign>) => {
    const next = { ...design, ...p };
    setDesign(next);
    onChangeDesign?.(next);
  };
  /** 방향을 고르면 색·글꼴·판형·표지·배치가 **한 벌로** 정해진다 + 자동 편집을 켠다 */
  const pickDirection = (d: DesignDirection) => patch({ ...d.design, direction: d.key, auto: true });

  // 추천/방향 카드용 — 표지 + 첫 작품 장을 실제로 그린다. 작품이 많으면 앞 7점만(속도).
  const shown: DesignDirection[] = allDirections ? DESIGN_DIRECTIONS : recs.map((r) => r.direction);
  const dirPreviews = useMemo(() => {
    const sample: PortfolioBookData = { ...book, images: works.slice(0, 7) };
    return Object.fromEntries(shown.map((d) => {
      const pg = buildPortfolioPages(sample, themeById('archive'), { design: normalizePdfDesign({ ...d.design, auto: true }) });
      const work = pg.find((p) => p.kind === 'works') ?? pg[1] ?? pg[0]!;
      return [d.key, [pg[0]!, work]];
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book, allDirections, urlKey]);

  // 표지 20종 미니 목업 — 현재 판형·색·글꼴로 실제 렌더해 축소(회색 자리표시 이미지)
  const coverMocks = useMemo(() => {
    const gray = "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='400'%20height='300'%3E%3Crect%20width='400'%20height='300'%20fill='%23d9d6d0'/%3E%3C/svg%3E";
    const md = {
      user: { name: '작가 이름', nickname: null }, year: '2025',
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

  // 작품 페이지 목업 — 실제 작품 페이지를 회색 자리표시로 축소(표지와 같은 방식).
  // ⚠️ 작품 수를 **그 배치 정원의 두 배**로 준다. 6장 고정으로 뒀더니 '4점씩' 목업이
  //    balancedSplit(6,4)=[3,3] 때문에 **3점으로 그려져** 픽토그램이 거짓말을 했다.
  //    정원의 배수면 균형 분할이 꽉 찬 페이지를 만든다(8@4 → [4,4]).
  const worksMocks = useMemo(() => {
    const gray = "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='400'%20height='300'%3E%3Crect%20width='400'%20height='300'%20fill='%23d9d6d0'/%3E%3C/svg%3E";
    return WORKS_LAYOUTS.map(([key, label]) => {
      const n = WORKS_PER_PAGE[key] * 2;
      const md = {
        user: { name: '이름', nickname: null }, year: '2025',
        images: Array.from({ length: n }, (_, i) => ({ id: i + 1, url: gray, order: i, title: `작품 ${i + 1}`, medium: 'Oil on canvas', sizeText: '80 × 60 cm', year: '2024', series: 'S', description: '작품 설명 예시 문장입니다. 재료와 시간의 층위를 담았다.' })),
        seriesInfo: [], bio: '', statement: '', career: {},
      } as unknown as PortfolioBookData;
      const pg = buildPortfolioPages(md, themeById('archive'), { design: normalizePdfDesign({
        worksLayout: key, auto: false, page: design.page, font: design.font, bg: design.bg, ink: design.ink, accent: design.accent, desc: design.desc, worksCaption: design.worksCaption, proseAlign: design.proseAlign,
      }) });
      const wp = pg.find((p) => p.label === 'S') ?? pg[1] ?? pg[0]!;
      return { key, label, html: wp.html };
    });
  }, [design.page, design.font, design.bg, design.ink, design.accent, design.desc, design.worksCaption, design.proseAlign]);

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

  // 포트폴리오용 추가 한글 웹폰트를 이 화면에서만 지연 로드
  useEffect(() => {
    const id = 'portfolio-webfonts';
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id = id; link.rel = 'stylesheet'; link.href = PORTFOLIO_FONT_HREF;
    document.head.appendChild(link);
  }, []);

  const download = async () => {
    if (works.length === 0) { toast.error('작품 사진을 먼저 등록해주세요.'); return; }
    setBusy(true);
    setProgress('');
    try {
      const { missing, pages: n } = await downloadPortfolioBook(book, 'archive', (d, t, phase) => setProgress(phaseLabel(phase, d, t)), design);
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

  const downloadPpt = async () => {
    if (works.length === 0) { toast.error('작품 사진을 먼저 등록해주세요.'); return; }
    setBusy(true); setProgress('');
    try {
      const { missing, pages: n } = await downloadPortfolioPptx(book, 'archive', (d, t, phase) => setProgress(phaseLabel(phase, d, t)), design);
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
  const toggleSec = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }));
  const rules = bodyApplicability(design.worksLayout);
  const descOptions = rules.descFullDiffers ? DESCS : DESCS.filter(([v]) => v !== 'full');

  // 전체 구성 한 줄 (§24) — 무엇이 몇 장인지 열어보지 않고 알 수 있게
  const overview = useMemo(() => {
    const n = (k: PortfolioPage['kind']) => pages.filter((p) => p.kind === k).length;
    const workPages = pages.filter((p) => p.kind === 'works');
    const shots = pages.reduce((s, p) => s + (p.works ?? 0), 0);
    return { prose: n('prose'), works: workPages.length, cv: n('cv'), shots };
  }, [pages]);

  return (
    <div className="lg:flex lg:gap-6">
      {/* 좌: 설정 — sticky 라 우측 미리보기를 스크롤해도 사라지지 않는다 */}
      <div className="lg:w-72 lg:shrink-0">
        <div className="space-y-3 lg:sticky lg:top-24">
          <div>
            <p className="text-xs text-gray-500">작품 {works.length}점 · 총 {pages.length}쪽</p>
            <p className="mt-0.5 text-[11px] text-gray-400">
              작품 {overview.shots}점 실림 · 글 {overview.prose}쪽 · CV {overview.cv}쪽
            </p>
          </div>

          {missingCaption > 0 && (
            <p className="text-[12px] text-[#c4302b] leading-relaxed">
              작품 {missingCaption}점에 작품명·재료·크기·연도가 없습니다. 홈페이지에서 정보를 채워 퀄리티를 높여보세요.
            </p>
          )}

          {/* 1단계 — 자동 편집. 기본이며, 무엇을 대신 해주는지 밝힌다(§20·§25) */}
          <button type="button" onClick={() => patch({ auto: !design.auto })}
            className={`flex w-full items-start gap-2.5 rounded-xl border p-3 text-left transition-colors ${
              design.auto ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 bg-white hover:border-gray-400'}`}>
            <Wand2 size={15} className="mt-0.5 shrink-0" />
            <span className="min-w-0">
              <span className="block text-[13px] font-semibold">자동 편집 {design.auto ? '켜짐' : '꺼짐'}</span>
              <span className={`mt-0.5 block text-[11px] leading-relaxed ${design.auto ? 'text-white/70' : 'text-gray-500'}`}>
                {design.auto
                  ? '작품 수와 비율에 맞춰 페이지마다 배치를 바꿉니다. 큰 그림과 격자가 번갈아 나옵니다.'
                  : '고른 배치 한 가지로만 만듭니다.'}
              </span>
            </span>
          </button>

          <div className="max-h-[calc(100vh-380px)] overflow-y-auto pr-0.5">
            {/* 3단계 — 작품 배치 */}
            <Section title="작품 배치" hint={design.auto ? '자동' : WORKS_LAYOUTS.find(([k]) => k === design.worksLayout)?.[1]}
              open={!!open.layout} onToggle={() => toggleSec('layout')}>
              {design.auto && (
                <p className="text-[11px] leading-relaxed text-gray-400">
                  지금은 자동입니다. 아래에서 고르면 그 배치 하나로 고정돼요.
                </p>
              )}
              <div className="grid grid-cols-3 gap-1.5">
                {worksMocks.map((m) => {
                  const on = !design.auto && design.worksLayout === m.key;
                  return (
                    <button key={m.key} type="button" title={m.label}
                      onClick={() => {
                        const r = bodyApplicability(m.key);
                        patch({ worksLayout: m.key, auto: false, ...(design.desc === 'full' && !r.descFullDiffers ? { desc: 'short' as DescDepth } : {}) });
                      }}
                      className={`flex flex-col items-center gap-0.5 rounded-md border p-1 transition-colors ${on ? 'border-gray-900 bg-gray-50' : 'border-gray-200 hover:border-gray-400'} ${design.auto ? 'opacity-60' : ''}`}>
                      <div className={`w-full overflow-hidden rounded-sm ring-1 ${on ? 'ring-gray-900' : 'ring-black/10'}`}>
                        <CoverMock html={m.html} w={pageDims.w} h={pageDims.h} tw={72} />
                      </div>
                      <span className={`w-full truncate text-center text-[9px] leading-tight ${on ? 'font-medium text-gray-900' : 'text-gray-400'}`}>{m.label}</span>
                    </button>
                  );
                })}
              </div>
            </Section>

            {/* 4단계 — 표지 */}
            <Section title="표지" hint={COVER_LAYOUTS.find((c) => c.key === design.coverLayout)?.label}
              open={!!open.cover} onToggle={() => toggleSec('cover')}>
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
                머리말·연도·대표 사진은 기본으로 들어갑니다. <b className="text-gray-500">오른쪽 미리보기의 표지를 눌러</b> 끄거나 바꿀 수 있어요.
              </p>
            </Section>

            {/* 4단계 — 색·글꼴·판형 */}
            <Section title="색 · 글꼴 · 판형" hint={PAGE_LABELS[design.page]} open={!!open.style} onToggle={() => toggleSec('style')}>
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
            </Section>

            {/* 4단계 — 세부 */}
            <Section title="세부" hint={DESCS.find(([v]) => v === design.desc)?.[1]} open={!!open.detail} onToggle={() => toggleSec('detail')}>
              <div className={rules.descApplies || design.auto ? '' : 'opacity-45'}>
                <p className="mb-1.5 text-xs text-gray-500">작품 설명</p>
                <div className={`flex flex-wrap gap-1.5 ${rules.descApplies || design.auto ? '' : 'pointer-events-none'}`}>
                  {descOptions.map(([val, label]) => (
                    <button key={val} type="button" onClick={() => patch({ desc: val })} className={chip(design.desc === val)}>{label}</button>
                  ))}
                </div>
                {!design.auto && !rules.descApplies
                  ? <p className="mt-1 text-[11px] text-gray-400">‘꽉 채우기·6점 목록’ 레이아웃에는 작품 설명이 들어가지 않습니다.</p>
                  : rules.descFullDiffers
                    ? <p className="mt-1 text-[11px] text-gray-400">‘전체’는 긴 설명을 다 싣고, 넘치면 다음 글 페이지로 이어집니다.</p>
                    : <p className="mt-1 text-[11px] text-gray-400">설명은 작품 옆에 2줄로 요약됩니다.</p>}
              </div>
              <div className={rules.captionApplies || design.auto ? '' : 'opacity-45'}>
                <p className="mb-1.5 text-xs text-gray-500">작품 정보 위치 <span className="text-gray-300">(제목·재료)</span></p>
                <div className={`flex flex-wrap gap-1.5 ${rules.captionApplies || design.auto ? '' : 'pointer-events-none'}`}>
                  {WORKS_CAPTIONS.map(([val, label]) => (
                    <button key={val} type="button" onClick={() => patch({ worksCaption: val })} className={chip(design.worksCaption === val)}>{label}</button>
                  ))}
                </div>
                {!design.auto && !rules.captionApplies && (
                  <p className="mt-1 text-[11px] text-gray-400">위치 선택은 격자 배치에서만 적용됩니다(나머지는 자동 배치).</p>
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
            </Section>
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

      {/* 우: 추천 + 제작 미리보기 */}
      <div className="mt-5 lg:mt-0 lg:flex-1 lg:min-w-0">
        {/* 1·2단계 — 추천 방향. 작은 칩이 아니라 **실제로 그린 두 장**을 보여준다(§22) */}
        <div className="mb-4">
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <p className="text-[13px] font-medium text-gray-800">
              {allDirections ? '디자인 방향' : '추천'}
              <span className="ml-1.5 text-[11px] font-normal text-gray-400">
                {allDirections ? `${DESIGN_DIRECTIONS.length}종` : '이 포트폴리오에 어울리는 구성'}
              </span>
            </p>
            <button type="button" onClick={() => setAllDirections(!allDirections)} className="text-[11px] text-gray-400 underline hover:text-gray-700">
              {allDirections ? '추천만 보기' : '다른 방향 보기'}
            </button>
          </div>
          <div className="flex flex-wrap gap-2 sm:flex-nowrap">
            {shown.map((d) => (
              <DirectionCard key={d.key} dir={d}
                why={recs.find((r) => r.direction.key === d.key)?.why}
                active={design.direction === d.key}
                onPick={() => pickDirection(d)}
                pages={dirPreviews[d.key] ?? []}
                pageW={PAGE_DIMS[(d.design.page ?? 'a4-portrait') as PageKey].w}
                pageH={PAGE_DIMS[(d.design.page ?? 'a4-portrait') as PageKey].h} />
            ))}
          </div>
          {design.direction && directionByKey(design.direction) && (
            <p className="mt-2 text-[11px] text-gray-400">
              고른 방향: <b className="text-gray-600">{directionByKey(design.direction)!.name}</b> — 왼쪽에서 세부를 바꾸면 이 방향은 유지된 채 값만 바뀝니다.
            </p>
          )}
        </div>

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
