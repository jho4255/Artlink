import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { FileText, Instagram } from 'lucide-react';
import { displayName, safeHttpUrl, instagramHandle } from '@/lib/utils';
import {
  artworkGridSignature, artworkTitle, careerLineText, groupBySeries, hasTitle, isCareerEmpty, museumCaption,
  normalizeCareer, statusBadge,
} from '@/lib/artwork';
import { reflowProse } from '@/lib/prose';
import { splitIntoColumns } from '@/lib/careerColumns';
import { aspectOf, justifyRows } from '@/lib/justifiedRows';
import { pickHeroImage, resolveHomepageTheme, themeCssVars } from '@/lib/homepageTheme';
import { ensurePortfolioFonts, needsWebFont } from '@/lib/portfolioFonts';
import Thumb from '@/components/shared/Thumb';
import type { PortfolioImage, Career, CareerKey, SeriesInfo } from '@/types';

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
 * - **정렬 격자.** 정사각 칸 + contain 은 칸의 30~40% 가 흰 여백이었다. 한 행의 작품이 같은 높이로 서고 폭은 비율만큼
 *   가져간다(`lib/justifiedRows`). 비율은 서버가 업로드 때 잰 `width/height`, 없으면 로드 후 재서 다시 놓는다.
 * - **미술관식 캡션.** `작품명, 연도 / 재료 / 크기` 순(국내 관례). 종전 한 줄(크기 / 재료 / 연도)은 순서가 거꾸로였다.
 * - **테마.** `designConfig` 의 배경·글자·강조·글꼴이 PDF 와 똑같이 적용된다(`lib/homepageTheme`). 안쪽 부품은
 *   `var(--hp-…)` 만 본다 — 회색 클래스(`text-gray-500`)를 쓰면 어두운 배경에서 안 보인다.
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

/** 섹션 머리 — 작은 대문자 라벨 + 위 헤어라인. 붉은 세로줄(v1)은 뺐다(작품보다 먼저 눈에 들어왔다) */
const SectionLabel = ({ children, count }: { children: ReactNode; count?: number }) => (
  <h3 className="mb-5 text-[11px] font-semibold uppercase tracking-[0.22em]" style={SUB}>
    {children}{typeof count === 'number' && <span className="ml-2 font-normal tracking-normal">{count}</span>}
  </h3>
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
}

/** 컨테이너 폭 — 정렬 격자가 행을 나누려면 실제 픽셀 폭을 알아야 한다 */
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
 * 정렬 격자 한 묶음(시리즈 하나). 비율을 모르는 작품은 정사각으로 두고 로드 후 재서 다시 놓는다.
 */
function JustifiedGrid({ images, artistName, onOpen, compact }: {
  images: PortfolioImage[]; artistName: string; onOpen?: (img: PortfolioImage) => void; compact: boolean;
}) {
  const [ref, width] = useContainerWidth<HTMLDivElement>();
  const [measured, setMeasured] = useState<Record<string, number>>({});
  const narrow = width > 0 && width < 640;
  const gap = narrow ? 12 : 24;
  const rows = useMemo(() => {
    if (width <= 0) return [];
    return justifyRows(
      images.map((img) => ({ item: img, aspect: aspectOf(img, measured[img.url]) })),
      { containerWidth: width, targetHeight: narrow ? 180 : compact ? 210 : 320, gap, maxPerRow: narrow ? 2 : undefined },
    );
  }, [images, width, measured, narrow, compact, gap]);

  return (
    <div ref={ref} className="flex flex-col" style={{ gap: narrow ? 20 : 32 }}>
      {rows.map((row, ri) => (
        <div key={ri} className="flex items-start" style={{ gap }}>
          {row.map((cell) => {
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
              <figure key={img.id} style={{ width: cell.width }} className="min-w-0 shrink-0">
                {onOpen ? (
                  <button onClick={() => onOpen(img)} className="block cursor-zoom-in">{picture}</button>
                ) : picture}
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
const ArtworkSection = memo(function ArtworkSection({ groups, total, artistName, onOpenImage, compact }: {
  groups: { name: string; note: string; images: PortfolioImage[] }[]; total: number; artistName: string;
  onOpenImage?: (img: PortfolioImage) => void; compact: boolean; signature: string;
}) {
  return (
    <section className="border-t pt-6" style={LINE}>
      <SectionLabel count={total}>작품</SectionLabel>
      <div className="flex flex-col gap-14">
        {groups.map((g, gi) => (
          <div key={g.name || `__${gi}`}>
            {g.name && (
              <div className="mb-5 max-w-3xl">
                <p className="text-lg font-medium" style={{ fontFamily: 'var(--hp-title-font)' }}>{g.name}</p>
                {g.note && <p className="mt-1.5 text-[14px] leading-relaxed whitespace-pre-wrap break-keep [overflow-wrap:anywhere]" style={SUB}>{g.note}</p>}
              </div>
            )}
            <JustifiedGrid images={g.images} artistName={artistName} onOpen={onOpenImage} compact={compact} />
          </div>
        ))}
      </div>
    </section>
  );
}, (a, b) => a.signature === b.signature && a.compact === b.compact && a.onOpenImage === b.onOpenImage && a.artistName === b.artistName);

export default function HomepageView({ data, onOpenImage, careerColumns = 3, emptyText, actions, compact = false }: Props) {
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
  const ig = safeHttpUrl(user.instagramUrl);
  const isEmpty = !data.biography && !data.statement && careerEmpty && !fileUrl && images.length === 0;

  const prose = `whitespace-pre-wrap break-keep [overflow-wrap:anywhere] text-justify max-w-3xl leading-[1.9] ${compact ? 'text-[14px]' : 'text-[15px]'}`;

  return (
    <div style={themeCssVars(theme)} className="min-w-0">
      {/* ── 마스트헤드: 작가 이름이 이 페이지의 제목이다 ── */}
      <header className={`${compact ? 'pb-6' : 'pb-10 md:pb-14'} flex flex-col gap-5 md:flex-row md:items-end md:justify-between`}>
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

      <div className={`flex flex-col ${compact ? 'gap-10' : 'gap-14 md:gap-20'}`}>
        {/* ── 대표작 ── */}
        {hero && <Hero img={hero} artistName={artistName} onOpen={onOpenImage} compact={compact} />}

        {/* ── 작품 (시리즈별) ── */}
        {total > 0 && (
          <ArtworkSection groups={groups} total={total} artistName={artistName} onOpenImage={onOpenImage} compact={compact} signature={signature} />
        )}

        {/* ── 작가노트 ── */}
        {data.statement && (
          <section className="border-t pt-6" style={LINE}>
            <SectionLabel>작가노트</SectionLabel>
            {/* 문장마다 엔터를 친 글은 이어 붙인다(lib/prose.ts). 저장값은 안 건드린다. */}
            <p className={prose}>{reflowProse(data.statement)}</p>
          </section>
        )}

        {/* ── 약력 ── */}
        {data.biography && (
          <section className="border-t pt-6" style={LINE}>
            <SectionLabel>약력</SectionLabel>
            <div className={`${prose} ${compact ? '' : 'text-[14px]'}`} style={SUB}>{reflowProse(data.biography)}</div>
          </section>
        )}

        {/* ── 경력 ── */}
        {!careerEmpty && (
          <section className="border-t pt-6" style={LINE}>
            <SectionLabel>경력</SectionLabel>
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
          </section>
        )}

        {/* ── 포트폴리오 파일 ── */}
        {fileUrl && (
          <section className="border-t pt-6" style={LINE}>
            <SectionLabel>포트폴리오 파일</SectionLabel>
            <a href={fileUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm hover:underline underline-offset-4" style={SUB}>
              <FileText size={14} /> 파일 보기
            </a>
          </section>
        )}
      </div>

      {isEmpty && (
        <div className="py-16 text-center" style={SUB}>{emptyText ?? '아직 포트폴리오가 등록되지 않았습니다.'}</div>
      )}
    </div>
  );
}
