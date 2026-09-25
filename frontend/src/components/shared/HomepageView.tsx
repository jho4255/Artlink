import { lazy, memo, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Download, FileText, Instagram } from 'lucide-react';
import { displayName, safeHttpUrl, instagramHandle } from '@/lib/utils';
import {
  artworkGridSignature, artworkTitle, careerLineText, groupBySeries, hasTitle, isCareerEmpty, museumCaption,
  normalizeCareer, statusBadge, ungroupedLabel,
} from '@/lib/artwork';
import { reflowProse } from '@/lib/prose';
import { splitIntoColumns } from '@/lib/careerColumns';
import { aspectOf, columnGrid, columnWidth } from '@/lib/columnGrid';
import { pickHeroImage, resolveHomepageTheme, themeCssVars } from '@/lib/homepageTheme';
import { ensurePortfolioFonts, needsWebFont } from '@/lib/portfolioFonts';
import { homepageTabs, resolveHomepageTab, tabParamFor, type HomepageTabDef, type HomepageTabId } from '@/lib/homepageTabs';
import { fileTypeLabel, portfolioFileKind } from '@/lib/portfolioFile';
import Thumb from '@/components/shared/Thumb';
import type { PortfolioImage, Career, CareerKey, SeriesInfo } from '@/types';

// pdf.js(본체 0.5MB + 워커 1.3MB)는 [포트폴리오] 탭을 열 때만 받는다
const PdfViewer = lazy(() => import('@/components/shared/PdfViewer'));

/**
 * 작가 홈페이지 본문 v2 (2026-09-16) — **공개 페이지(`/@handle`, `/portfolio/:id`)와 편집 화면 미리보기가 함께 쓴다.**
 *
 * 따로 만들면 반드시 어긋난다. 미리보기가 실제와 다르면 미리보기를 볼 이유가 없으므로 여기 하나만 두고
 * 양쪽이 같은 것을 그린다. 페이지 껍데기(액션 줄·라이트박스·방명록)는 바깥에서 붙인다(`actions`).
 *
 * ## v2 에서 바뀐 것 (사용자 결정, 2026-09-16)
 * - **작품이 먼저, 작가 이름이 마스트헤드.** v1 은 ArtLink 의 'HomePage' 라벨 → 작은 이름 → 약력 → 경력 → 작품 순이라
 *   작가의 홈페이지가 아니라 ArtLink 안의 프로필로 읽혔다. 이제 이름(큰 글자) → 대표작 → 작품 → 작가노트 → 약력·경력.
 *   'HomePage' 라벨은 뺐다. 작가 사이트 구조의 업계 관례(대표작 → 작품 → 소개·CV → 연락처)를 따른다.
 * - **같은 폭의 열 격자**(`lib/columnGrid`, 2026-09-22). 데스크톱 3열·모바일 2열, 열 폭은 컨테이너에서 한 번 정해 이음매와
 *   오른쪽 끝이 전 시리즈에서 같은 자리에 온다. 그림은 칸 안에 비율대로(contain). 비율은 서버가 업로드 때 잰 `width/height`,
 *   없으면 로드 후 재서 다시 놓는다. (2026-09-16~22 의 정렬 격자는 이음매·오른쪽 끝이 행마다 달라 되돌렸다)
 * - **미술관식 캡션.** `작품명, 연도 / 재료 / 크기` 순(국내 관례). 종전 한 줄(크기 / 재료 / 연도)은 순서가 거꾸로였다.
 * - **테마.** `designConfig` 의 배경·글자·강조·글꼴이 PDF 와 똑같이 적용된다(`lib/homepageTheme`). 안쪽 부품은
 *   `var(--hp-…)` 만 본다 — 회색 클래스(`text-gray-500`)를 쓰면 어두운 배경에서 안 보인다.
 *
 * - **탭**(2026-09-25, `lib/homepageTabs`). 이름 아래 한 줄 탭 [작품 · 작가노트 · 약력 · 포트폴리오 · 방명록] — 예전엔 전부 세로로
 *   이어져 방명록까지 몇 화면을 내려가야 했다. 대표작은 [작품] 탭 맨 위. 비어 있는 탭은 안 만든다.
 *   탭 막대는 상단바 아래에 붙어(sticky) 긴 작품 목록 중간에서도 다른 탭으로 바로 간다.
 * - **포트폴리오 파일은 페이지 안에서 펼친다**(PDF 만, `PdfViewer`). HWP·DOC·ZIP 은 그릴 방법이 없어 내려받기로 남는다.
 *
 * ⚠️ **작가가 넣는 글에는 `break-keep` 만으로 부족하다** — 공백 없이 이어 쓴 한글은 통째로 한 낱말이라 아무 데서도
 *    안 끊긴다(실측 4848px 넘침). 글 자리마다 `[overflow-wrap:anywhere]` 를 함께 준다.
 * ⚠️ 작품은 자르지도 늘리지도 않는다(CLAUDE.md 18). 격자 칸 크기가 곧 사진 비율이라 letterbox 도 crop 도 없다.
 */
const CAREER_LABELS: { key: CareerKey; label: string }[] = [
  { key: 'education', label: '학력' },
  { key: 'solo', label: '개인전' },
  { key: 'group', label: '단체전' },
  { key: 'artFair', label: '아트페어' },
  { key: 'award', label: '수상 및 선정' },
];

const SUB: CSSProperties = { color: 'var(--hp-sub)' };
const INK: CSSProperties = { color: 'var(--hp-ink)' };
const LINE: CSSProperties = { borderColor: 'var(--hp-line)' };

/** 섹션 머리 — 작은 대문자 라벨. 붉은 세로줄(v1)은 뺐다(작품보다 먼저 눈에 들어왔다). 탭(2026-09-25) 뒤로는 [약력] 탭 안의 '경력'만 쓴다 */
const SectionLabel = ({ children }: { children: ReactNode }) => (
  <h3 className="mb-5 text-[11px] font-semibold uppercase tracking-[0.22em]" style={SUB}>{children}</h3>
);

export interface HomepageViewData {
  user: { id?: number; name: string; nickname?: string | null; handle?: string | null; avatar?: string | null; instagramUrl?: string | null };
  tagline?: string | null;
  statement?: string | null;
  biography?: string | null;
  career?: Career | null;
  portfolioFileUrl?: string | null;
  // 서버가 null 로 내려주는 경우가 있어 null 도 받는다 (groupBySeries 가 알아서 빈 것으로 본다)
  seriesInfo?: SeriesInfo[] | null;
  images: PortfolioImage[];
  /** PDF 와 같은 디자인 설정(색·글꼴·대표작). 없으면 사이트 기본 톤 */
  designConfig?: unknown;
}

interface Props {
  data: HomepageViewData;
  /** 작품을 눌렀을 때(공개 페이지=라이트박스). 없으면 작품은 클릭되지 않는다(미리보기). */
  onOpenImage?: (img: PortfolioImage) => void;
  /** 경력 열 수. 미리보기는 폭이 절반이라 공개 페이지보다 한 단계 적게 준다. */
  careerColumns?: number;
  /** 미리보기에서 '아직 비어 있다' 안내를 다르게 하고 싶을 때 */
  emptyText?: string;
  /** 마스트헤드 오른쪽 액션(이웃·메시지·공유·QR·수정). 페이지가 넣는다 — 미리보기에는 없다 */
  actions?: ReactNode;
  /** 편집 화면 미리보기(폭이 절반) — 글자·행 높이를 줄인다 */
  compact?: boolean;
  /**
   * 지금 탭. 주면 **부모가 탭을 쥔다**(공개 페이지 — `?tab=` 주소). 안 주면 이 컴포넌트가 스스로 기억한다(편집 미리보기).
   * 없는 탭·모르는 값이면 첫 탭(`resolveHomepageTab`).
   */
  tab?: string | null;
  /** `param` = 주소에 실을 값. 첫 탭이면 null(쿼리를 지워 공유 주소를 깔끔하게) */
  onTabChange?: (id: HomepageTabId, param: string | null) => void;
  /** 방명록 탭 — 공개 페이지만 넣는다(미리보기엔 방명록이 없다) */
  guestbook?: { count?: number; content: ReactNode } | null;
}

/** 탭 막대가 붙는 높이 = 상단바 높이(lg 미만 64 / 이상 80, Navbar 의 h-16 lg:h-20) */
const stickyTopPx = () => (typeof window !== 'undefined' && window.innerWidth >= 1024 ? 80 : 64);

/**
 * 탭 막대 — 글자 탭 + 밑줄. 강조색은 쓰지 않는다(글자색) — 빨강은 판매완료·D-day 처럼 '상태'에 아껴 둔다.
 * 좁은 화면에서 넘치면 가로로 밀어 본다(줄바꿈하면 막대 높이가 튄다).
 */
function TabBar({ tabs, active, onSelect, sticky }: {
  tabs: HomepageTabDef[]; active: HomepageTabId | null; onSelect: (id: HomepageTabId) => void; sticky: boolean;
}) {
  return (
    <div
      className={`${sticky ? 'sticky top-16 z-30 -mx-6 px-6 md:-mx-12 md:px-12 lg:top-20' : ''} border-b`}
      style={{ ...LINE, background: 'var(--hp-bg)' }}
    >
      <div role="tablist" aria-label="홈페이지 메뉴" className="flex gap-6 overflow-x-auto [scrollbar-width:none] md:gap-8 [&::-webkit-scrollbar]:hidden">
        {tabs.map((t) => {
          const on = t.id === active;
          return (
            <button
              key={t.id}
              role="tab"
              type="button"
              id={`hp-tab-${t.id}`}
              aria-selected={on}
              aria-controls={`hp-panel-${t.id}`}
              onClick={() => onSelect(t.id)}
              className={`relative min-h-[44px] shrink-0 cursor-pointer whitespace-nowrap py-3 text-[14px] md:text-[15px] ${on ? 'font-semibold' : 'hover:opacity-80'}`}
              style={on ? INK : SUB}
            >
              {t.label}
              {typeof t.count === 'number' && <span className="ml-1.5 text-[12px] font-normal tabular-nums" style={SUB}>{t.count}</span>}
              {on && <span aria-hidden className="absolute inset-x-0 -bottom-px h-[2px]" style={{ background: 'var(--hp-ink)' }} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** PDF 가 아닌 첨부(HWP·DOC·ZIP) — 브라우저가 그릴 수 없어 내려받게 한다 */
function FileDownloadCard({ url }: { url: string }) {
  return (
    <div className="flex flex-col items-start gap-3 border px-6 py-8 md:flex-row md:items-center md:justify-between" style={LINE}>
      <div className="flex items-center gap-3">
        <FileText size={20} style={SUB} />
        <div>
          <p className="text-[15px]" style={INK}>포트폴리오 {fileTypeLabel(url)}</p>
          <p className="mt-0.5 text-[13px]" style={SUB}>이 형식은 페이지에서 바로 볼 수 없어 내려받아 확인합니다.</p>
        </div>
      </div>
      <a href={url} target="_blank" rel="noreferrer" className="inline-flex min-h-[44px] items-center gap-1.5 border px-4 text-sm hover:opacity-80" style={{ ...LINE, ...INK }}>
        <Download size={14} /> 내려받기
      </a>
    </div>
  );
}

/** 컨테이너 폭 — 열 폭을 정하려면 실제 픽셀 폭을 알아야 한다 */
function useContainerWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.round(entry!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

/** 미술관식 캡션 — 대표작(큰 글자)과 격자(작은 글자)가 같은 조립을 쓴다 */
function Caption({ img, size }: { img: PortfolioImage; size: 'hero' | 'grid' }) {
  const cap = museumCaption(img);
  const st = statusBadge(img);
  if (!cap && !st) return null;
  const hero = size === 'hero';
  const badge = st && (
    <span
      className={`${hero ? 'text-[11px]' : 'text-[10px]'} font-semibold ${cap?.head ? 'ml-2' : ''}`}
      style={{ color: st.tone === 'sold' ? 'var(--hp-accent)' : 'var(--hp-sub)' }}
    >
      ● {st.label}
    </span>
  );
  return (
    <figcaption className={`${hero ? 'text-sm leading-relaxed' : 'mt-2 text-[12px] leading-snug'} break-keep [overflow-wrap:anywhere]`} style={SUB}>
      {(cap?.head || badge) && (
        <p className={hero ? 'text-[15px] font-medium' : 'text-[13px]'} style={INK}>
          {cap?.head}{badge}
        </p>
      )}
      {cap?.medium && <p>{cap.medium}</p>}
      {cap?.size && <p>{cap.size}</p>}
    </figcaption>
  );
}

/**
 * 대표작 — 미술관 벽처럼 **작품 왼쪽, 라벨 오른쪽 아래**. 라벨에 적을 게 없으면(캡션 없음) 작품만 전폭.
 * 원본을 그대로 받는다(t800 은 이 크기에선 뭉개진다 — CLAUDE.md 21).
 */
function Hero({ img, artistName, onOpen, compact }: { img: PortfolioImage; artistName: string; onOpen?: (img: PortfolioImage) => void; compact: boolean }) {
  const hasLabel = !!(museumCaption(img) || statusBadge(img));
  const alt = hasTitle(img) ? artworkTitle(img) : `${artistName} 대표작`;
  const image = (
    <img
      src={img.url}
      alt={alt}
      loading="eager"
      decoding="async"
      className="block h-auto w-auto max-w-full object-contain"
      style={{ maxHeight: compact ? 320 : '76vh' }}
    />
  );
  return (
    <figure className={`grid gap-5 ${hasLabel ? 'md:grid-cols-[minmax(0,1fr)_220px] md:items-end md:gap-8' : ''}`}>
      {onOpen ? (
        <button onClick={() => onOpen(img)} className="block min-w-0 cursor-zoom-in text-left">{image}</button>
      ) : <div className="min-w-0">{image}</div>}
      {hasLabel && <div className="md:pb-1"><Caption img={img} size="hero" /></div>}
    </figure>
  );
}

/**
 * 작품 격자 한 묶음(시리즈 하나) — **같은 크기의 정사각 칸**(`lib/columnGrid.ts`, 2026-09-22).
 * 데스크톱 3열 · 좁은 폭(<640) 2열. 열 폭이 컨테이너에서 한 번 정해지고 칸 높이 = 열 폭이라 이음매·오른쪽 끝·윗선·아랫선·캡션 줄이
 * 전 시리즈에서 같은 자리에 온다. 그림은 칸 **가운데**(미술관이 작품 중심선을 맞추고 라벨을 같은 높이에 붙이는 방식) —
 * 가로 그림 아래 남는 자리는 칸에 배경이 없어 매트처럼 읽힌다. 비율을 모르는 작품은 정사각으로 두고 로드 후 재서 다시 놓는다.
 * ⚠️ 2026-09-16~22 는 정렬 격자(justified rows), 같은 날 잠시 '행 최대 높이 + 바닥 정렬'이었다 — 둘 다 윗선이나 이음매가 어긋났다.
 */
function ColumnGridView({ images, artistName, onOpen }: {
  images: PortfolioImage[]; artistName: string; onOpen?: (img: PortfolioImage) => void;
}) {
  const [ref, width] = useContainerWidth<HTMLDivElement>();
  const [measured, setMeasured] = useState<Record<string, number>>({});
  const narrow = width > 0 && width < 640;
  const gap = narrow ? 12 : 24;
  const columns = narrow ? 2 : 3;
  const colW = columnWidth({ containerWidth: width, columns, gap });
  const rows = useMemo(() => {
    if (width <= 0) return [];
    return columnGrid(
      images.map((img) => ({ item: img, aspect: aspectOf(img, measured[img.url]) })),
      { containerWidth: width, columns, gap },
    );
  }, [images, width, measured, columns, gap]);

  return (
    <div ref={ref} className="flex flex-col" style={{ gap: narrow ? 20 : 32 }}>
      {rows.map((row, ri) => (
        <div key={ri} className="flex items-start" style={{ gap }}>
          {row.cells.map((cell) => {
            const img = cell.item;
            const alt = hasTitle(img) ? artworkTitle(img) : `${artistName} 작품`;
            const picture = (
              <Thumb
                src={img.url}
                size="grid"
                alt={alt}
                loading="lazy"
                decoding="async"
                className="block object-contain transition-opacity hover:opacity-90"
                style={{ width: cell.width, height: cell.height }}
                onLoad={(e) => {
                  // 서버가 크기를 못 쟀던 옛 작품 — 로드 후 실제 비율로 다시 놓는다
                  const el = e.currentTarget;
                  if (!img.width && el.naturalWidth && el.naturalHeight) {
                    const a = el.naturalWidth / el.naturalHeight;
                    setMeasured((m) => (m[img.url] === a ? m : { ...m, [img.url]: a }));
                  }
                }}
              />
            );
            return (
              <figure key={img.id} style={{ width: colW }} className="min-w-0 shrink-0">
                {/* 칸: 정사각(행 높이 = 열 폭), 그림은 정가운데 — 칸 폭은 figure 가 정하므로 이음매가 행마다 같다 */}
                <div className="flex items-center justify-center" style={{ height: row.height }}>
                  {onOpen ? (
                    <button onClick={() => onOpen(img)} className="block cursor-zoom-in">{picture}</button>
                  ) : picture}
                </div>
                <Caption img={img} size="grid" />
              </figure>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/**
 * 작품 섹션 — **타이핑할 때마다 다시 그리지 않는다.**
 * 편집 미리보기는 글자를 칠 때마다 부모가 다시 렌더된다. 작품 30장의 격자를 매번 다시 놓으면 입력이 밀리므로
 * 내용 지문(`signature`)이 같으면 이전 렌더를 그대로 쓴다.
 */
const ArtworkSection = memo(function ArtworkSection({ groups, artistName, onOpenImage }: {
  groups: { name: string; note: string; images: PortfolioImage[] }[]; artistName: string;
  onOpenImage?: (img: PortfolioImage) => void; compact: boolean; signature: string;
}) {
  // 머리 라벨('작품 N')은 없다 — 탭이 그 이름과 개수를 이미 들고 있다(2026-09-25)
  return (
    <section>
      <div className="flex flex-col gap-14">
        {groups.map((g, gi) => {
          // 시리즈 없는 묶음도 시리즈가 하나라도 있으면 머리말을 단다 — 안 그러면 앞 시리즈의 계속으로 읽힌다(lib/artwork.ts ungroupedLabel)
          const heading = g.name || ungroupedLabel(groups);
          return (
            <div key={g.name || `__${gi}`}>
              {heading && (
                <div className="mb-5 max-w-3xl">
                  <p className="text-lg font-medium" style={{ fontFamily: 'var(--hp-title-font)', ...(g.name ? {} : SUB) }}>{heading}</p>
                  {g.note && <p className="mt-1.5 text-[14px] leading-relaxed whitespace-pre-wrap break-keep [overflow-wrap:anywhere]" style={SUB}>{g.note}</p>}
                </div>
              )}
              <ColumnGridView images={g.images} artistName={artistName} onOpen={onOpenImage} />
            </div>
          );
        })}
      </div>
    </section>
  );
}, (a, b) => a.signature === b.signature && a.compact === b.compact && a.onOpenImage === b.onOpenImage && a.artistName === b.artistName);

export default function HomepageView({
  data, onOpenImage, careerColumns = 3, emptyText, actions, compact = false, tab, onTabChange, guestbook,
}: Props) {
  const { user, images, seriesInfo } = data;
  const artistName = displayName(user);
  const theme = useMemo(() => resolveHomepageTheme(data.designConfig), [data.designConfig]);

  // 기본 글꼴(명조·고딕)이 아니면 웹폰트를 한 번 받는다 — 안 받으면 폴백 글꼴로 이름이 찍힌다
  useEffect(() => { if (needsWebFont(theme.keys.font)) ensurePortfolioFonts(); }, [theme.keys.font]);

  const signature = artworkGridSignature(images, seriesInfo) + '|' + images.map((i) => `${i.width ?? ''}x${i.height ?? ''}`).join(',');
  const groups = useMemo(() => groupBySeries(images, seriesInfo), [images, seriesInfo]);
  const total = images.length;
  const hero = pickHeroImage(images, theme.keys);

  const career = normalizeCareer(data.career);
  const careerEmpty = isCareerEmpty(data.career);
  const fileUrl = safeHttpUrl(data.portfolioFileUrl);
  const fileKind = portfolioFileKind(fileUrl);
  const ig = safeHttpUrl(user.instagramUrl);
  const isEmpty = !data.biography && !data.statement && careerEmpty && !fileUrl && images.length === 0;

  const tabs = homepageTabs({
    workCount: total,
    hasNote: !!data.statement,
    hasCv: !!data.biography || !careerEmpty,
    hasFile: !!fileUrl,
    guestbook: guestbook ? { count: guestbook.count } : null,
  });
  // 부모가 탭을 쥐면(공개 페이지 ?tab=) 그걸, 아니면 스스로(미리보기)
  const [ownTab, setOwnTab] = useState<string | null>(null);
  const controlled = tab !== undefined;
  const active = resolveHomepageTab(controlled ? tab : ownTab, tabs);

  /** 탭 막대 바로 위 표지 — 막대가 상단에 붙어 있을 때 탭을 바꾸면 새 내용의 첫머리로 올려 준다 */
  const anchorRef = useRef<HTMLDivElement>(null);
  const select = (id: HomepageTabId) => {
    const a = anchorRef.current;
    if (a && !compact) {
      const top = a.getBoundingClientRect().top;
      const stick = stickyTopPx();
      // 긴 작품 목록 한가운데서 [약력]을 누르면 약력의 중간(=빈 곳)에 떨어진다 — 막대가 붙어 있을 때만 끌어올린다
      if (top < stick) window.scrollTo({ top: window.scrollY + top - stick });
    }
    if (controlled) onTabChange?.(id, tabParamFor(id, tabs));
    else setOwnTab(id);
  };

  const prose = `whitespace-pre-wrap break-keep [overflow-wrap:anywhere] text-justify max-w-3xl leading-[1.9] ${compact ? 'text-[14px]' : 'text-[15px]'}`;
  const hasBio = !!data.biography;

  const panel = (() => {
    switch (active) {
      case 'works':
        return (
          <div className={`flex flex-col ${compact ? 'gap-10' : 'gap-14 md:gap-20'}`}>
            {hero && <Hero img={hero} artistName={artistName} onOpen={onOpenImage} compact={compact} />}
            <ArtworkSection groups={groups} artistName={artistName} onOpenImage={onOpenImage} compact={compact} signature={signature} />
          </div>
        );
      case 'note':
        // 문장마다 엔터를 친 글은 이어 붙인다(lib/prose.ts). 저장값은 안 건드린다.
        return <p className={prose}>{reflowProse(data.statement ?? '')}</p>;
      case 'cv':
        return (
          <div className="flex flex-col gap-14">
            {hasBio && <div className={`${prose} ${compact ? '' : 'text-[14px]'}`} style={SUB}>{reflowProse(data.biography ?? '')}</div>}
            {!careerEmpty && (
              <div className={hasBio ? 'border-t pt-6' : ''} style={LINE}>
                {/* 약력 글과 함께 있을 때만 머리 라벨 — 혼자면 탭 이름이 곧 제목이다 */}
                {hasBio && <SectionLabel>경력</SectionLabel>}
                {/* 열마다 자기 높이만 쓰는 배치(lib/careerColumns.ts) — grid 는 긴 단체전에 행이 맞춰져 수상이 한참 아래로 밀린다 */}
                <div className="flex max-w-6xl items-start gap-x-14">
                  {splitIntoColumns(
                    CAREER_LABELS.filter(({ key }) => (career[key] ?? []).length > 0),
                    careerColumns,
                    ({ key }) => (career[key] ?? []).length,
                  ).map((column, ci) => (
                    <div key={ci} className="min-w-0 flex-1 space-y-9">
                      {column.map(({ key, label }) => (
                        <div key={key}>
                          <p className="border-b pb-1.5 text-sm font-semibold" style={LINE}>{label}</p>
                          <ul className="mt-2.5 space-y-2">
                            {(career[key] ?? []).map((e, i) => (
                              <li key={i} className="text-[13px] leading-[1.7] break-keep [overflow-wrap:anywhere]" style={SUB}>{careerLineText(e)}</li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      case 'file':
        if (!fileUrl) return null;
        return fileKind === 'pdf' ? (
          <Suspense fallback={<div className="border py-24 text-center text-sm" style={{ ...LINE, ...SUB }}>포트폴리오를 불러오는 중</div>}>
            <PdfViewer key={fileUrl} url={fileUrl} compact={compact} />
          </Suspense>
        ) : <FileDownloadCard url={fileUrl} />;
      case 'guestbook':
        return guestbook?.content ?? null;
      default:
        return null;
    }
  })();

  return (
    <div style={themeCssVars(theme)} className="min-w-0">
      {/* ── 마스트헤드: 작가 이름이 이 페이지의 제목이다 ── */}
      <header className={`${compact ? 'pb-6' : 'pb-8 md:pb-12'} flex flex-col gap-5 md:flex-row md:items-end md:justify-between`}>
        <div className="min-w-0">
          <h1
            className={`break-keep [overflow-wrap:anywhere] leading-[1.05] tracking-[-0.02em] ${compact ? 'text-3xl' : 'text-4xl md:text-6xl'} ${theme.serif ? 'font-medium' : 'font-semibold'}`}
            style={{ fontFamily: 'var(--hp-title-font)' }}
          >
            {artistName}
          </h1>
          {/* 한 줄 소개가 없으면 아무것도 쓰지 않는다 — 누구에게나 해당되는 문구로 자리를 채우지 않는다 */}
          {data.tagline && <p className={`mt-3 break-keep [overflow-wrap:anywhere] ${compact ? 'text-sm' : 'text-base md:text-lg'}`} style={SUB}>{data.tagline}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
          {/* 인스타 — 브랜드 핑크 대신 페이지 색을 따른다(강조색이 둘이면 페이지가 시끄럽다) */}
          {ig && (
            <a href={ig} target="_blank" rel="noreferrer" className="inline-flex min-h-[44px] items-center gap-1.5 hover:underline underline-offset-4" style={SUB}>
              <Instagram size={14} /> {instagramHandle(user.instagramUrl) ?? 'Instagram'}
            </a>
          )}
          {actions}
        </div>
      </header>

      {isEmpty && (
        <div className="py-16 text-center" style={SUB}>{emptyText ?? '아직 포트폴리오가 등록되지 않았습니다.'}</div>
      )}

      {tabs.length > 0 && (
        <>
          {/* 탭 막대 자리 표지 — [방명록] 같은 바깥 버튼이 여기로 스크롤한다(scroll-mt = 상단바 높이) */}
          <div ref={anchorRef} id="hp-tabs" className="scroll-mt-16 lg:scroll-mt-20" />
          <TabBar tabs={tabs} active={active} onSelect={select} sticky={!compact} />
          <div
            role="tabpanel"
            id={`hp-panel-${active}`}
            aria-labelledby={`hp-tab-${active}`}
            className={compact ? 'pt-6' : 'pt-8 md:pt-12'}
          >
            {panel}
          </div>
        </>
      )}
    </div>
  );
}
