import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { cvItems, printedInfo, type CvItem, type CvItemKey } from '@/lib/portfolioMaker';
import { editHref } from '@/lib/homepageEdit';
import {
  COVER_LAYOUTS, FONT_PRESETS, PAGE_DIMS, WORKS_PER_PAGE, buildPortfolioPages, normalizePdfDesign, themeById,
  type CoverGroup, type CvColumns, type CvPosition, type DescDepth, type PdfDesign, type PortfolioBookData, type ProseAlign, type WorksCaption, type WorksLayout,
} from '@/lib/portfolioFormats';
import {
  ACCENTS, BACKGROUNDS, TEXTS, bestAccentKey, bestTextKey, recommendedAccentKeys, recommendedTextKeys,
} from '@/lib/portfolioColors';
import Thumb from '@/components/shared/Thumb';
import type { PortfolioImage } from '@/types';
import { useElementWidth } from '@/hooks/useElementWidth';
import { PageMock } from './ScaledPage';

/**
 * 꾸미기의 묶음 다섯 — [표지 · 작품 · 약력 · 색·글꼴 · 이름·연락처] (2026-10-03).
 *
 * ⚠️ **한 탭의 옵션은 그 쪽만 바꾼다**(2026-10-03 사용자 결정). 책 전체에 걸리는 것은 [색·글꼴] 과 [이름·연락처], 맨 위의 용지뿐이다.
 *    그래서 '글 정렬' 은 [작품](시리즈 소개·작품 설명) 과 [약력](작가노트·약력) 에 하나씩, '프로필 사진' 은 [약력](작가노트 쪽) 과
 *    [이름·연락처](마지막 장) 에 하나씩 있다. 용지는 탭이 아니라 화면 맨 위에서 고른다(가장 먼저 정할 것).
 *
 * 선택지는 **하나도 없애지 않았다** — 자리와 말을 바꿨다.
 *  - 예전 묶음 [작품 배치 · 표지 · 색·글꼴·판형 · 세부] 는 안쪽 스크롤 상자(PC 420px · 아이폰 SE 188px)에 접혀 있었고,
 *    표지 사진·머리말·크기는 미리보기의 표지를 눌러야 나오는 **다른 패널**(화면 밖에 열렸다)에 있었다. 지금은 [표지] 한 묶음이다.
 *  - 검은 '자동 편집 켜짐' 상자는 [작품 쪽] 맨 위의 둘 중 하나 고르기가 됐다(주 버튼처럼 생겨 누르면 말없이 쪽수가 바뀌었다).
 *  - '세부' 는 뜻이 없는 이름이라 내용을 각 묶음으로 나눴다. '판형' → **용지**.
 *  - 이름·연락처는 새로 생긴 묶음이다(예전엔 고를 수 없었다).
 * 글자는 12px 이상, 누르는 곳은 40px 이상(예전: 이름표 9px · 색 단추 28px · 표지 × 16px).
 */
type Patch = (p: Partial<PdfDesign>) => void;

// ── 작은 부품 ──────────────────────────────────────────────────────────────
function Group({ title, note, children }: { title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <p className="text-sm font-semibold text-gray-950">{title}</p>
      {note && <p className="mt-0.5 break-keep text-xs leading-relaxed text-gray-500">{note}</p>}
      <div className="mt-2.5">{children}</div>
    </div>
  );
}

/** 여럿 중 하나 고르기(칩) — 고른 것은 진한 테두리. 검정 채움은 화면의 주 버튼([PDF 저장]) 하나에만 쓴다 */
const chipCls = (on: boolean, disabled?: boolean) => cn(
  'inline-flex min-h-[40px] items-center justify-center whitespace-nowrap rounded-lg border px-3 text-sm transition-colors',
  on ? 'border-gray-900 font-medium text-gray-950 ring-1 ring-gray-900' : 'border-gray-300 text-gray-700 hover:border-gray-500',
  disabled && 'pointer-events-none opacity-40',
);
function Chips<T extends string>({ value, options, onChange, disabled, label }: {
  value: T; options: readonly (readonly [T, string])[]; onChange: (v: T) => void; disabled?: boolean; label: string;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {options.map(([v, text]) => (
        <button key={v} type="button" aria-pressed={value === v} disabled={disabled} onClick={() => onChange(v)} className={chipCls(value === v, disabled)}>{text}</button>
      ))}
    </div>
  );
}

/** 켜고 끄기 한 줄 — 체크 칸 + 이름(+ 값). 줄 전체가 눌린다(44px) */
function CheckRow({ checked, onChange, label, value, disabled, hint }: {
  checked: boolean; onChange: (v: boolean) => void; label: string; value?: string; disabled?: boolean; hint?: ReactNode;
}) {
  return (
    <label className={cn('flex min-h-[44px] items-center gap-3 py-1', disabled ? 'cursor-default' : 'cursor-pointer')}>
      <input type="checkbox" checked={checked && !disabled} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="h-5 w-5 shrink-0 accent-gray-900" />
      <span className="min-w-0 flex-1">
        <span className={cn('block text-sm', disabled ? 'text-gray-400' : 'text-gray-900')}>{label}</span>
        {value && <span className="block truncate text-xs text-gray-500">{value}</span>}
        {hint && <span className="block text-xs text-gray-500">{hint}</span>}
      </span>
    </label>
  );
}

/** 고르는 그림 칸 — 표지 모양·작품 배치. 실제 쪽을 회색 자리표시 그림으로 축소해 구조를 보여 준다 */
function MockGrid({ items, value, onPick, pageW, pageH, label }: {
  items: { key: string; label: string; html: string }[];
  value: string | null;
  onPick: (key: string) => void;
  pageW: number; pageH: number;
  label: string;
}) {
  const { ref, width } = useElementWidth<HTMLDivElement>();
  const GAP = 8, PADX = 6;
  const cell = width > 0 ? Math.floor((width - GAP * 2) / 3) : 96;
  const boxW = Math.max(40, cell - PADX * 2);
  // 칸은 **쪽 모양 그대로** — 세로 판형이면 세로로 길고 가로 판형이면 납작하다(옆에 빈 띠가 생기지 않게)
  const boxH = Math.round(boxW * (pageH / pageW));
  return (
    <div ref={ref} role="group" aria-label={label} className="grid grid-cols-3" style={{ gap: GAP }}>
      {items.map((m) => {
        const on = value === m.key;
        return (
          <button
            key={m.key}
            type="button"
            aria-pressed={on}
            // 그림 속 글자('작가 이름'…)가 버튼 이름으로 읽히지 않게 — 이름은 아래 글자 하나다
            aria-label={m.label}
            onClick={() => onPick(m.key)}
            className={cn('flex min-w-0 flex-col items-center gap-1 rounded-lg border pb-1.5 pt-1.5 transition-colors', on ? 'border-gray-900 bg-gray-50 ring-1 ring-gray-900' : 'border-gray-200 hover:border-gray-400')}
          >
            <PageMock html={m.html} w={pageW} h={pageH} boxW={boxW} boxH={boxH} className="bg-gray-100" />
            <span className={cn('w-full truncate px-1 text-center text-xs', on ? 'font-medium text-gray-950' : 'text-gray-600')}>{m.label}</span>
          </button>
        );
      })}
    </div>
  );
}

const GRAY = "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='400'%20height='300'%3E%3Crect%20width='400'%20height='300'%20fill='%23d9d6d0'/%3E%3C/svg%3E";
const pageDims = (design: PdfDesign) => PAGE_DIMS[design.page] ?? PAGE_DIMS['a4-portrait'];

// ── 표지 ──────────────────────────────────────────────────────────────────
const COVER_GROUPS: CoverGroup[] = ['사진 없이', '대표작 1점', '여러 작품', '색 배경', '심플'];
const slotCountOf = (layout: PdfDesign['coverLayout']) => COVER_LAYOUTS.find((c) => c.key === layout)?.minImages ?? 0;

export function CoverTab({ design, patch, works }: { design: PdfDesign; patch: Patch; works: PortfolioImage[] }) {
  const dims = pageDims(design);
  // 표지 15종 — 지금의 용지·색·글꼴로 실제 표지를 그려 축소한다(회색 자리표시 그림)
  const mocks = useMemo(() => {
    const md = {
      user: { name: '작가 이름', nickname: null }, year: String(new Date().getFullYear()),
      images: Array.from({ length: 4 }, (_, i) => ({ id: i + 1, url: GRAY, order: i, title: `작품 ${i + 1}` })),
      seriesInfo: [],
    } as unknown as PortfolioBookData;
    return COVER_LAYOUTS.map((c) => ({
      key: c.key as string, label: c.label, group: c.group,
      html: buildPortfolioPages(md, themeById('archive'), { design: normalizePdfDesign({
        coverLayout: c.key, page: design.page, font: design.font, bg: design.bg, ink: design.ink, accent: design.accent,
        coverNameAccent: design.coverNameAccent, coverImageScale: design.coverImageScale, coverTextScale: design.coverTextScale,
        coverEyebrow: design.coverEyebrow, coverYear: design.coverYear,
      }) })[0]!.html,
    }));
  }, [design.page, design.font, design.bg, design.ink, design.accent, design.coverNameAccent, design.coverImageScale, design.coverTextScale, design.coverEyebrow, design.coverYear]);

  // 표지 사진 칸 — 비어 있는 배열이면 홈페이지 순서대로 자동으로 채운다. `0` 은 빈 칸(일부러 비운 것)
  const withImg = works.filter((w) => w.url);
  const slotCount = slotCountOf(design.coverLayout);
  const baseIds = design.coverImageIds.length ? design.coverImageIds : withImg.map((w) => w.id);
  const slotIds: number[] = Array.from({ length: slotCount }, (_, i) => baseIds[i] ?? 0);
  const [activeSlot, setActiveSlot] = useState(0);
  const active = Math.min(activeSlot, Math.max(0, slotCount - 1));
  const byId = new Map(works.map((w) => [w.id, w] as const));
  const setSlot = (i: number, id: number) => { const next = [...slotIds]; next[i] = id; patch({ coverImageIds: next }); };
  const filled = slotIds.filter((id) => id && byId.has(id)).length;

  const toggles: [keyof Pick<PdfDesign, 'coverEyebrow' | 'coverYear' | 'coverNameAccent'>, string][] = [
    ['coverEyebrow', '영문 머리말'], ['coverYear', '연도'], ['coverNameAccent', '이름을 강조색으로'],
  ];

  return (
    <div className="space-y-7">
      <Group title="표지 모양">
        <div className="space-y-4">
          {COVER_GROUPS.map((g) => (
            <div key={g}>
              <p className="mb-1.5 text-xs font-medium text-gray-500">{g}</p>
              <MockGrid
                label={`표지 모양 — ${g}`}
                items={mocks.filter((m) => m.group === g)}
                value={design.coverLayout}
                onPick={(key) => patch({ coverLayout: key as PdfDesign['coverLayout'] })}
                pageW={dims.w} pageH={dims.h}
              />
            </div>
          ))}
        </div>
      </Group>

      {slotCount > 0 && withImg.length > 0 && (
        <Group
          title={slotCount === 1 ? '표지에 쓸 작품' : `표지에 쓸 작품 ${slotCount}칸`}
          note={slotCount === 1 ? '아래에서 작품을 누르면 표지 사진이 바뀝니다.' : '칸을 누른 뒤 아래에서 그 칸에 넣을 작품을 고르세요.'}
        >
          {slotCount > 1 && (
            <div className="mb-3 flex flex-wrap gap-2.5">
              {slotIds.map((id, i) => {
                const w = id ? byId.get(id) : undefined;
                return (
                  <div key={i} className="relative">
                    <button
                      type="button"
                      onClick={() => setActiveSlot(i)}
                      aria-pressed={active === i}
                      aria-label={`${i + 1}번째 칸${w ? '' : ' (비어 있음)'}`}
                      className={cn('grid h-16 w-16 place-items-center overflow-hidden rounded-lg border-2 bg-gray-50', active === i ? 'border-gray-900' : 'border-gray-200')}
                    >
                      {w?.url ? <Thumb src={w.url} size="grid" alt="" className="h-full w-full object-contain" /> : <span className="text-xs text-gray-400">빈 칸</span>}
                    </button>
                    {w && (
                      <button
                        type="button"
                        onClick={() => setSlot(i, 0)}
                        aria-label={`${i + 1}번째 칸 비우기`}
                        className="absolute -right-3.5 -top-3.5 grid h-10 w-10 place-items-center"
                      >
                        <span className="grid h-5 w-5 place-items-center rounded-full bg-gray-900 text-white"><X size={12} aria-hidden /></span>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
            {withImg.map((w) => {
              const used = slotIds[active] === w.id;
              return (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => setSlot(active, w.id)}
                  aria-pressed={used}
                  aria-label={`표지에 넣기${w.title ? ` — ${w.title}` : ''}`}
                  className={cn('h-14 w-14 shrink-0 overflow-hidden rounded-lg border-2 bg-gray-50', used ? 'border-gray-900' : 'border-transparent hover:border-gray-300')}
                >
                  <Thumb src={w.url} size="grid" alt="" className="h-full w-full object-contain" />
                </button>
              );
            })}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 text-xs text-gray-500">
            {slotCount > 1 && filled < slotCount && <span>비운 칸은 표지에 빈 자리로 남습니다.</span>}
            {design.coverImageIds.length > 0 && (
              <button type="button" onClick={() => patch({ coverImageIds: [] })} className="inline-flex min-h-[40px] items-center text-gray-800 underline underline-offset-4">홈페이지 순서대로(자동)</button>
            )}
          </div>
        </Group>
      )}

      <Group title="표지에 넣을 글">
        <div role="group" aria-label="표지에 넣을 글" className="flex flex-wrap gap-2">
          {toggles.map(([k, label]) => (
            <button key={k} type="button" aria-pressed={design[k]} onClick={() => patch({ [k]: !design[k] } as Partial<PdfDesign>)} className={chipCls(design[k])}>
              {label}
            </button>
          ))}
        </div>
        {design.coverEyebrow && (
          <label className="mt-3 block">
            <span className="text-xs text-gray-500">영문 머리말 문구 <span className="text-gray-400">— 비워 두면 ARTWORK PORTFOLIO</span></span>
            <input
              type="text" value={design.coverEyebrowText ?? ''} maxLength={40}
              onChange={(e) => patch({ coverEyebrowText: e.target.value })}
              placeholder="ARTWORK PORTFOLIO"
              className="mt-1 h-11 w-full rounded-lg border border-gray-300 px-3 text-sm uppercase tracking-wider focus:border-gray-500 focus:outline-none"
            />
          </label>
        )}
      </Group>

      <Group title="크기">
        <div className="space-y-3">
          {slotCount > 0 && (
            <label className="block">
              <span className="flex justify-between text-xs text-gray-600"><span>그림 크기</span><span className="tabular-nums text-gray-400">{Math.round(design.coverImageScale * 100)}%</span></span>
              <input type="range" min={0.6} max={1} step={0.05} value={design.coverImageScale} onChange={(e) => patch({ coverImageScale: Number(e.target.value) })} className="mt-1 h-8 w-full accent-gray-900" />
            </label>
          )}
          <label className="block">
            <span className="flex justify-between text-xs text-gray-600"><span>글자 크기</span><span className="tabular-nums text-gray-400">{Math.round(design.coverTextScale * 100)}%</span></span>
            <input type="range" min={0.8} max={1.25} step={0.05} value={design.coverTextScale} onChange={(e) => patch({ coverTextScale: Number(e.target.value) })} className="mt-1 h-8 w-full accent-gray-900" />
          </label>
        </div>
      </Group>
    </div>
  );
}

// ── 작품 쪽 ────────────────────────────────────────────────────────────────
// ⚠️ 이름은 **눈에 보이는 대로** — 작가가 무엇을 얻는지 바로 알게(디자이너 용어 금지)
const WORKS_LAYOUTS: readonly (readonly [WorksLayout, string])[] = [
  ['hero', '1점 크게'], ['label', '작품+설명'], ['full', '꽉 채우기'],
  ['feature', '크게+작게'], ['duo', '2점씩'], ['grid', '4점씩'], ['index', '6점 목록'],
];
/** 글 정렬 — [작품](시리즈 소개·작품 설명) 과 [약력](작가노트·약력) 이 따로 하나씩 갖는다 */
const PROSE_ALIGNS: readonly (readonly [ProseAlign, string])[] = [['justify', '양쪽 맞춤'], ['left', '왼쪽'], ['right', '오른쪽']];
const DESCS: readonly (readonly [DescDepth, string])[] = [['none', '싣지 않음'], ['full', '싣기']];
const WORKS_CAPTIONS: readonly (readonly [WorksCaption, string])[] = [['below', '아래 가운데'], ['left', '아래 왼쪽'], ['minimal', '제목만']];
/** 작품 쪽 배치마다 어떤 설정이 실제로 먹는가 — 안 먹는 것은 흐리게 두고 이유를 적는다 */
const applies = (wl: WorksLayout) => ({
  // 설명은 한 장에 작품 한 점인 구성에서만 — 자르지 않는 게 원칙이라 격자에서는 뒤 장으로 이으면 책이 글로 뒤덮인다
  desc: wl === 'hero' || wl === 'label',
  caption: wl === 'duo' || wl === 'grid' || wl === 'feature',
});

export function WorksTab({ design, patch, workCount }: { design: PdfDesign; patch: Patch; workCount: number }) {
  const dims = pageDims(design);
  const rules = applies(design.worksLayout);
  // 배치 7종 — 그 배치 정원의 두 배만큼 그려야 꽉 찬 쪽이 나온다(6장 고정이면 '4점씩' 이 3점으로 그려진다)
  const mocks = useMemo(() => WORKS_LAYOUTS.map(([key, label]) => {
    const n = WORKS_PER_PAGE[key] * 2;
    const md = {
      user: { name: '이름', nickname: null }, year: '2026',
      images: Array.from({ length: n }, (_, i) => ({
        id: i + 1, url: GRAY, order: i, title: `작품 ${i + 1}`, medium: 'Oil on canvas', sizeText: '80 × 60 cm', year: '2024', series: 'S',
        description: '작품 설명 예시 문장입니다. 재료와 시간의 층위를 담았다.',
      })),
      seriesInfo: [],
    } as unknown as PortfolioBookData;
    const pg = buildPortfolioPages(md, themeById('archive'), { design: normalizePdfDesign({
      worksLayout: key, auto: false, page: design.page, font: design.font, bg: design.bg, ink: design.ink, accent: design.accent,
      desc: design.desc, worksCaption: design.worksCaption, proseAlign: design.proseAlign, worksIndex: false,
    }) });
    return { key: key as string, label, html: (pg.find((p) => p.label === 'S') ?? pg[1] ?? pg[0]!).html };
  }), [design.page, design.font, design.bg, design.ink, design.accent, design.desc, design.worksCaption, design.proseAlign]);

  const pickLayout = (key: string) => {
    const wl = key as WorksLayout;
    // 설명을 못 싣는 배치로 옮기면 설명 설정을 정리한다 — 켜 둔 채 흐리게만 두면 '싣기' 인데 안 실린다
    patch({ worksLayout: wl, auto: false, ...(design.desc !== 'none' && !applies(wl).desc ? { desc: 'none' as DescDepth } : {}) });
  };

  const radio = (on: boolean) => cn('flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors', on ? 'border-gray-900 ring-1 ring-gray-900' : 'border-gray-300 hover:border-gray-500');
  const dot = (on: boolean) => (
    <span aria-hidden className={cn('mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border-2', on ? 'border-gray-900' : 'border-gray-400')}>
      {on && <span className="h-2.5 w-2.5 rounded-full bg-gray-900" />}
    </span>
  );
  const descOn = design.auto || rules.desc;
  const capOn = design.auto || rules.caption;

  return (
    <div className="space-y-7">
      <Group title="작품을 어떻게 놓을까요">
        <div role="radiogroup" aria-label="작품 배치 방식" className="space-y-2">
          <button type="button" role="radio" aria-checked={design.auto} onClick={() => patch({ auto: true })} className={radio(design.auto)}>
            {dot(design.auto)}
            <span className="min-w-0">
              <span className="block text-sm font-medium text-gray-950">알아서 배치 <span className="font-normal text-gray-500">· 권장</span></span>
              <span className="mt-0.5 block break-keep text-xs leading-relaxed text-gray-500">작품 수와 모양에 맞춰 큰 그림 쪽과 여러 점 쪽을 섞습니다. 쪽수가 가장 적게 나옵니다.</span>
            </span>
          </button>
          <button type="button" role="radio" aria-checked={!design.auto} onClick={() => patch({ auto: false })} className={radio(!design.auto)}>
            {dot(!design.auto)}
            <span className="min-w-0">
              <span className="block text-sm font-medium text-gray-950">한 가지로</span>
              <span className="mt-0.5 block break-keep text-xs leading-relaxed text-gray-500">아래에서 고른 배치 하나로 모든 작품 쪽을 만듭니다.</span>
            </span>
          </button>
        </div>
        {!design.auto && (
          <div className="mt-3">
            <MockGrid label="작품 배치" items={mocks} value={design.worksLayout} onPick={pickLayout} pageW={dims.w} pageH={dims.h} />
          </div>
        )}
      </Group>

      <Group
        title="작품 설명"
        note={descOn
          ? '작품마다 적어 둔 설명을 그 작품 쪽에 싣습니다. 자르지 않고, 길면 다음 쪽으로 이어집니다.'
          : '설명은 한 쪽에 작품 한 점인 배치(1점 크게 · 작품+설명)에서만 실립니다.'}
      >
        <Chips label="작품 설명" value={design.desc} options={DESCS} onChange={(v) => patch({ desc: v })} disabled={!descOn} />
      </Group>

      <Group title="작품 정보 위치" note={capOn ? '제목·재료·크기를 그림 아래 어디에 둘지.' : '여러 점을 놓는 배치(크게+작게 · 2점씩 · 4점씩)에서만 고를 수 있어요. 나머지는 배치가 정합니다.'}>
        <Chips label="작품 정보 위치" value={design.worksCaption} options={WORKS_CAPTIONS} onChange={(v) => patch({ worksCaption: v })} disabled={!capOn} />
      </Group>

      <Group title="작품 정보 순서" note={design.captionStyle === 'kr' ? '작품명, 연도 / 재료 / 크기 — 홈페이지와 같은 순서' : '작품명 / 재료 / 크기 / 연도 — 해외 공모·레지던시에 낼 때'}>
        <Chips label="작품 정보 순서" value={design.captionStyle} options={[['kr', '국내식'], ['intl', '해외식']] as const} onChange={(v) => patch({ captionStyle: v })} />
      </Group>

      <Group title="작품 목록 쪽" note={workCount >= 6 ? '맨 뒤에 실린 작품을 작은 그림과 쪽번호로 한 번 더 모아 보여 줍니다.' : '작품이 6점 이상일 때 만들어집니다.'}>
        <CheckRow checked={design.worksIndex} onChange={(v) => patch({ worksIndex: v })} label="작품 목록 싣기" disabled={workCount < 6} />
      </Group>

      <Group title="글 정렬" note="시리즈 소개와 작품 설명 글의 정렬입니다. 작가노트·약력은 [약력] 탭에서 따로 고릅니다.">
        <Chips label="작품 쪽 글 정렬" value={design.worksProseAlign} options={PROSE_ALIGNS} onChange={(worksProseAlign) => patch({ worksProseAlign })} />
      </Group>
    </div>
  );
}

// ── 약력 ──────────────────────────────────────────────────────────────────
/**
 * 작가노트·약력 쪽 (2026-10-03 신설, 사용자 결정). 예전엔 이 쪽들에 고를 것이 없었다 — 적어 둔 것은 전부, 정해진 자리(작품 뒤)에,
 * 용지가 정한 단 수로 실렸다. 공모마다 요구가 달라(약력을 앞에 · 수상만 빼고 · 한글만) 여기서 고른다.
 * 글이 없는 항목은 켜 둬도 실리지 않는다 — 흐리게 두고 쓰러 가는 길(홈페이지 편집의 그 칸)을 준다.
 */
const CV_POSITIONS: readonly (readonly [CvPosition, string])[] = [['after', '작품 뒤'], ['before', '작품 앞']];
const CV_COLUMNS: readonly (readonly [CvColumns, string])[] = [['auto', '자동'], ['one', '한 단'], ['two', '두 단']];
const cvWriteHref = (key: CvItemKey) =>
  key === 'statement' ? editHref('intro', { focus: 'statement' }) : key === 'bio' ? editHref('cv', { focus: 'biography' }) : editHref('cv');

export function CvTab({ design, patch, book }: { design: PdfDesign; patch: Patch; book: PortfolioBookData }) {
  const items = cvItems(book, design);
  const about = items.filter((i) => i.key === 'statement' || i.key === 'bio');
  const career = items.filter((i) => i.key !== 'statement' && i.key !== 'bio');
  const hasAvatar = !!String(book.user.avatar ?? '').trim();
  const statementOn = about.some((i) => i.key === 'statement' && i.has && i.enabled);
  const link = 'font-medium text-gray-800 underline underline-offset-4';
  const row = (i: CvItem) => (
    <CheckRow
      key={i.key}
      label={i.label}
      value={i.has ? i.amount : undefined}
      hint={i.has ? undefined : <>적어 둔 게 없어요 — <Link to={cvWriteHref(i.key)} className={link}>홈페이지에서 쓰기</Link></>}
      checked={i.enabled}
      disabled={!i.has}
      onChange={(v) => patch({ cvShow: { ...design.cvShow, [i.key]: v } })}
    />
  );

  return (
    <div className="space-y-7">
      <Group title="싣는 항목" note="끈 항목은 PDF 에만 빠집니다. 홈페이지에는 그대로 있어요.">
        <div className="divide-y divide-gray-100">{about.map(row)}</div>
        <p className="mt-4 text-xs font-medium text-gray-500">경력</p>
        <div className="divide-y divide-gray-100">{career.map(row)}</div>
      </Group>

      <Group title="약력 자리" note="약력·경력 쪽을 작품 앞에 둘지 뒤에 둘지. 작가노트는 늘 표지 바로 다음입니다.">
        <Chips label="약력 자리" value={design.cvPosition} options={CV_POSITIONS} onChange={(cvPosition) => patch({ cvPosition })} />
      </Group>

      <Group title="경력 배치" note={design.cvColumns === 'auto' ? '자동은 세로 용지에서 한 단, 가로 용지에서 두 단입니다.' : undefined}>
        <Chips label="경력 단 수" value={design.cvColumns} options={CV_COLUMNS} onChange={(cvColumns) => patch({ cvColumns })} />
        <div className="mt-2">
          <CheckRow checked={design.cvEnglish} onChange={(v) => patch({ cvEnglish: v })} label="영문 머리말" value="학력 EDUCATION · 개인전 SOLO EXHIBITIONS …" />
        </div>
      </Group>

      <Group title="글 정렬" note="작가노트·약력 글의 정렬입니다. 시리즈 소개·작품 설명은 [작품] 탭에서 따로 고릅니다.">
        <Chips label="작가노트·약력 글 정렬" value={design.proseAlign} options={PROSE_ALIGNS} onChange={(proseAlign) => patch({ proseAlign })} />
      </Group>

      <Group
        title="작가노트 쪽에 프로필 사진"
        note={!hasAvatar
          ? <>프로필 사진을 올리면 작가노트 옆에 실을 수 있어요 — <Link to="/mypage" className={link}>프로필에서 올리기</Link></>
          : !statementOn ? '작가노트를 실을 때만 고를 수 있어요.' : '작가노트 글 옆에 실립니다. 마지막 장의 사진은 [이름·연락처] 탭에서 따로 고릅니다.'}
      >
        <CheckRow checked={design.artistPhoto} onChange={(v) => patch({ artistPhoto: v })} label="프로필 사진 싣기" disabled={!hasAvatar || !statementOn} />
      </Group>
    </div>
  );
}

// ── 색·글꼴 ────────────────────────────────────────────────────────────────

function Swatches({ label, list, value, onPick, recommended }: {
  label: string;
  list: { key: string; label: string; hex: string }[];
  value: string;
  onPick: (key: string) => void;
  /** 배경과 잘 어울리는 색(대비 통과). 없으면 표시하지 않는다(배경색 줄) */
  recommended?: string[];
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1">
      {list.map((s) => {
        const rec = !recommended || recommended.includes(s.key);
        const on = value === s.key;
        return (
          <button
            key={s.key}
            type="button"
            aria-pressed={on}
            aria-label={`${s.key === 'mono' ? '글자색과 같게' : s.label}${recommended && !rec ? ' (배경과 대비가 낮음)' : ''}`}
            title={`${s.key === 'mono' ? '글자색과 같게' : s.label}${recommended && !rec ? ' · 배경과 대비가 낮아요' : ''}`}
            onClick={() => onPick(s.key)}
            className="relative grid h-11 w-11 place-items-center"
          >
            <span
              className={cn('grid h-8 w-8 place-items-center rounded-full border', on ? 'border-gray-900 ring-2 ring-gray-900 ring-offset-2' : 'border-gray-300', !rec && 'opacity-30')}
              style={s.key === 'mono' ? undefined : { background: s.hex }}
            >
              {/* '글자색과 같게' — 색이 아니라 글자로 보여 준다(예전엔 10px 로 '글자색' 이라 적었다) */}
              {s.key === 'mono' && <span aria-hidden className="text-sm font-semibold leading-none text-gray-900">가</span>}
            </span>
            {recommended && rec && s.key !== 'mono' && <span aria-hidden className="absolute right-1 top-1 h-2 w-2 rounded-full bg-green-600 ring-2 ring-white" />}
          </button>
        );
      })}
    </div>
  );
}

export function StyleTab({ design, patch }: { design: PdfDesign; patch: Patch }) {
  const recTexts = recommendedTextKeys(design.bg);
  const recAccents = recommendedAccentKeys(design.bg);
  // 배경을 바꾸면 글자색·강조색이 그 배경에서 읽히는지 다시 본다 — 안 읽히면 읽히는 색으로 함께 바꾼다
  const setBg = (bg: string) => {
    const rt = recommendedTextKeys(bg);
    const ra = recommendedAccentKeys(bg);
    patch({ bg, ink: rt.includes(design.ink) ? design.ink : bestTextKey(bg), accent: ra.includes(design.accent) ? design.accent : bestAccentKey(bg) });
  };
  const dotNote = <><span aria-hidden className="mr-1 inline-block h-2 w-2 rounded-full bg-green-600 align-middle" />배경과 잘 어울리는 색</>;

  return (
    <div className="space-y-7">
      {/* 이 탭만 책 전체에 걸린다 — 다른 탭은 그 쪽만 바꾼다(사용자 결정 2026-10-03) */}
      <p className="break-keep text-xs leading-relaxed text-gray-500">색과 글꼴은 표지부터 마지막 장까지 책 전체에 한 벌로 적용됩니다.</p>
      <Group title="글꼴">
        <div role="group" aria-label="글꼴" className="flex flex-wrap gap-2">
          {FONT_PRESETS.map((fp) => (
            <button key={fp.key} type="button" aria-pressed={design.font === fp.key} onClick={() => patch({ font: fp.key })} className={chipCls(design.font === fp.key)} style={{ fontFamily: fp.title }}>
              {fp.label}
            </button>
          ))}
        </div>
      </Group>
      <Group title="배경색">
        <Swatches label="배경색" list={BACKGROUNDS} value={design.bg} onPick={setBg} />
      </Group>
      <Group title="글자색" note={dotNote}>
        <Swatches label="글자색" list={TEXTS} value={design.ink} onPick={(ink) => patch({ ink })} recommended={recTexts} />
      </Group>
      <Group title="강조색" note={<>머리말·작은 표시에 쓰는 색. <b className="font-semibold text-gray-700">가</b> 는 글자색과 같게. {dotNote}</>}>
        <Swatches label="강조색" list={ACCENTS} value={design.accent} onPick={(accent) => patch({ accent })} recommended={recAccents} />
      </Group>
    </div>
  );
}

// ── 이름·연락처 ────────────────────────────────────────────────────────────
/**
 * 내 PDF 에 **무엇이 찍히는가** — 예전엔 이 화면에서 볼 수도 고를 수도 없었다.
 * 표지 이름은 닉네임이 먼저였고(실서버 작가 47명 중 18명이 실명과 다르다), 마지막 장에는 이메일·전화번호·인스타·홈페이지 QR 이
 * 전부 자동으로 실렸다(47명 전원이 전화번호를 등록해 두었다) — 미리보기를 끝까지 내려 봐야 알았다.
 * 기본은 실명 · 전부 싣기(사용자 결정 2026-10-03). 여기서 바꾼다.
 */
export function InfoTab({ design, patch, book }: { design: PdfDesign; patch: Patch; book: PortfolioBookData }) {
  const info = printedInfo(book, design);
  const hasAvatar = !!String(book.user.avatar ?? '').trim();
  const radio = (on: boolean) => cn('flex min-h-[48px] w-full items-center gap-3 rounded-xl border px-3 text-left transition-colors', on ? 'border-gray-900 ring-1 ring-gray-900' : 'border-gray-300 hover:border-gray-500');
  const dot = (on: boolean) => (
    <span aria-hidden className={cn('grid h-5 w-5 shrink-0 place-items-center rounded-full border-2', on ? 'border-gray-900' : 'border-gray-400')}>
      {on && <span className="h-2.5 w-2.5 rounded-full bg-gray-900" />}
    </span>
  );
  const link = 'font-medium text-gray-800 underline underline-offset-4';
  const profileLink = <Link to="/mypage" className={link}>프로필에서 입력</Link>;

  return (
    <div className="space-y-7">
      <Group title="문서에 찍는 이름" note="표지·각 쪽의 머리말·약력·마지막 장·파일 이름에 쓰입니다.">
        {info.canChooseName ? (
          <div role="radiogroup" aria-label="문서에 찍는 이름" className="space-y-2">
            <button type="button" role="radio" aria-checked={design.nameSource === 'real'} onClick={() => patch({ nameSource: 'real' })} className={radio(design.nameSource === 'real')}>
              {dot(design.nameSource === 'real')}
              <span className="min-w-0"><span className="text-xs text-gray-500">실명</span> <span className="break-all text-sm font-medium text-gray-950">{info.realName}</span></span>
            </button>
            <button type="button" role="radio" aria-checked={design.nameSource === 'nickname'} onClick={() => patch({ nameSource: 'nickname' })} className={radio(design.nameSource === 'nickname')}>
              {dot(design.nameSource === 'nickname')}
              <span className="min-w-0"><span className="text-xs text-gray-500">닉네임(활동명)</span> <span className="break-all text-sm font-medium text-gray-950">{info.nickname}</span></span>
            </button>
          </div>
        ) : (
          <p className="text-sm text-gray-900">
            <span className="font-medium">{info.name}</span>
            <span className="mt-1 block break-keep text-xs text-gray-500">활동명으로 내고 싶으면 <Link to="/mypage" className="font-medium text-gray-800 underline underline-offset-4">프로필</Link>에서 닉네임을 정해 주세요.</span>
          </p>
        )}
      </Group>

      <Group title="마지막 장에 실을 연락처" note="갤러리·심사자가 연락할 방법입니다. 끈 것은 PDF 에 찍히지 않습니다.">
        <div className="divide-y divide-gray-100">
          {info.contacts.map((c) => (
            <CheckRow
              key={c.key}
              label={c.label}
              value={c.value || undefined}
              hint={c.value ? undefined : (c.key === 'web' ? '홈페이지 주소를 만들 수 없습니다.' : <>적어 둔 게 없어요 — {profileLink}</>)}
              checked={c.enabled}
              disabled={!c.value}
              onChange={(v) => patch({ contact: { ...design.contact, [c.key]: v } })}
            />
          ))}
        </div>
        {!info.printedText && !(design.contactPhoto && hasAvatar) && (
          <p className="mt-2 break-keep text-xs leading-relaxed text-gray-500">실을 연락처가 없어 마지막 장을 만들지 않습니다.</p>
        )}
      </Group>

      <Group title="마지막 장에 프로필 사진" note={hasAvatar ? '연락처 옆에 실립니다. 작가노트 쪽의 사진은 [약력] 탭에서 따로 고릅니다.' : <>프로필 사진을 올리면 마지막 장에 실을 수 있어요 — <Link to="/mypage" className={link}>프로필에서 올리기</Link></>}>
        <CheckRow checked={design.contactPhoto} onChange={(v) => patch({ contactPhoto: v })} label="프로필 사진 싣기" disabled={!hasAvatar} />
      </Group>
    </div>
  );
}
