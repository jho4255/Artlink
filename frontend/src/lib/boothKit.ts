/**
 * 단체전 도록 (2026-09-16) — 갤러리 운영 페이지에서 수락 작가 제출자료로 A5 도록 PDF 를 만든다.
 * 표지 → 전시 소개·참여 작가 → 작가마다 [대표작·작가노트·작품·약력](포트폴리오 엔진 재사용) → 뒷표지.
 *
 * ⚠️ **엽서·가격표·QR 캡션은 없앴다**(2026-09-16 사용자 결정). 셋 다 **작품 캡션(.hwp)이 이미 하는 일**이라
 *    — 제목·재료·크기·연도·가격이 거기 다 있다 — 같은 정보를 네 가지 인쇄물로 나눠 내보내면 고르는 쪽만 헷갈린다.
 *    QR 도 마찬가지로, 부스에 붙일 캡션은 한글 캡션이라 QR 시트를 따로 둘 자리가 없었다.
 *    되살리려면 git 에서 가져올 것 — `postcardFrontHtml`·`priceListHtml`·`qrCaptionCellHtml` 이 그 이름이다.
 *
 * 설계
 * - 도록은 **고정 크기 페이지**라 `renderPagesToPdf`(html2canvas, 240dpi 목표)로 만든다. 새 렌더러를 만들지 않는다.
 * - 작가 장은 `buildPortfolioPages` 를 **A5 판형·folioStart·skipContact** 로 부른다 — 작가 홈페이지·PDF 와 같은 엔진이라
 *   대표작 선택(`representativeIndex`)이 도록의 작가 첫 장 사진이 된다.
 * - 이미지는 먼저 병렬로 모아 blob: 주소로 바꾼다(`prefetchImages`) — 안 그러면 html2canvas 가 장마다 네트워크를 기다린다.
 * - 작품은 어디서도 자르지 않는다(CLAUDE.md 18).
 *
 * ⚠️ 순수 HTML 빌더(`catalogueCoverHtml`·`artistBookData`·…)는 export 해서 jsdom 테스트가 문자열로 검사한다.
 *    렌더 결과(잘림·여백)는 `scratchpad` 하니스로 눈으로 본다 — vitest 는 레이아웃을 못 잰다.
 */
import api from '@/lib/axios';
import { displayName, exhibitionTypeLabels, regionLabels } from '@/lib/utils';
import { imageSrc, prefetchImages, recoverFailed } from '@/lib/imageFetch';
import { esc, safeName, triggerDownload, type SubmissionRow } from '@/lib/operationPdf';
import {
  PAGE_DIMS, applyDesign, buildPortfolioPages, normalizePdfDesign, renderPagesToPdf, themeById,
  type PortfolioBookData, type PortfolioPage,
} from '@/lib/portfolioFormats';
import { SANS, SERIF, ensurePortfolioFonts } from '@/lib/portfolioFonts';
import { aspectMap, measureAspects } from '@/lib/artworkAnalysis';
import type { ArtworkItem, CvEntry, PortfolioImage } from '@/types';

// ── 입력 ──────────────────────────────────────────────────────────────────
export type BoothRow = SubmissionRow & { user: { handle?: string | null } };

export interface BoothContext {
  exhibition: {
    id: number; title: string; typeLabel: string; period: string; description: string;
    poster: string | null; url: string;
  };
  gallery: { name: string; address: string; phone: string; instagram: string; region: string } | null;
}

export type BoothProgress = (phase: string, done: number, total: number) => void;

const ymd = (s?: string | null) => {
  if (!s) return '';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '';
  // KST 달력 날짜 (CLAUDE.md 14) — 자정 저장값이 UTC 로 하루 전으로 밀리지 않게
  const k = new Date(d.getTime() + 9 * 3600 * 1000);
  return `${k.getUTCFullYear()}.${k.getUTCMonth() + 1}.${k.getUTCDate()}`;
};
/** 전시 기간 — "2026.10.1 – 10.4" (같은 해면 뒤쪽 연도 생략) */
export function periodText(start?: string | null, end?: string | null): string {
  const a = ymd(start), b = ymd(end);
  if (!a && !b) return '';
  if (!a || a === b) return b || a;
  if (!b) return a;
  const [ya] = a.split('.'), [yb, ...rest] = b.split('.');
  return ya === yb ? `${a} – ${rest.join('.')}` : `${a} – ${b}`;
}

/** 운영 페이지가 아는 건 제목뿐이라, 공개 API 로 전시·갤러리 정보를 마저 받는다 */
export async function loadBoothContext(exhibitionId: string | number): Promise<BoothContext> {
  const ex = (await api.get(`/exhibitions/${exhibitionId}`)).data;
  let gallery: BoothContext['gallery'] = null;
  if (ex?.gallery?.id) {
    try {
      const g = (await api.get(`/galleries/${ex.gallery.id}`)).data;
      gallery = { name: g.name ?? '', address: g.address ?? '', phone: g.phone ?? '', instagram: g.instagramUrl ?? '', region: regionLabels[g.region] ?? '' };
    } catch { gallery = { name: ex.gallery.name ?? '', address: '', phone: '', instagram: '', region: '' }; }
  }
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://artlink.cc';
  return {
    exhibition: {
      id: ex.id, title: ex.title ?? '', typeLabel: exhibitionTypeLabels[ex.type] ?? '',
      period: periodText(ex.exhibitStartDate, ex.exhibitDate), description: ex.description ?? '',
      poster: ex.imageUrl || ex.images?.[0]?.url || null, url: `${origin}/exhibitions/${ex.id}`,
    },
    gallery,
  };
}

/** 작가의 대표작 — 작가가 고른 인덱스, 없으면 첫 작품 */
export function representativeWork(row: BoothRow): ArtworkItem | null {
  const list = row.submission.artworkList ?? [];
  if (list.length === 0) return null;
  const i = row.submission.representativeIndex ?? 0;
  return list[i] ?? list[0] ?? null;
}

/** PDF 에 들어갈 이미지를 미리 모은다. 못 받은 주소 목록을 돌려준다(조용히 빈 칸 금지) */
async function prefetchAll(urls: (string | undefined | null)[], onProgress?: BoothProgress): Promise<string[]> {
  const list = [...new Set(urls.filter((u): u is string => !!u))];
  if (list.length === 0) return [];
  let failed = await prefetchImages(list, (d, t) => onProgress?.('이미지', d, t));
  if (failed.length) failed = await recoverFailed(failed, (d, t) => onProgress?.('재시도', d, t));
  return failed;
}

// ── 도록 (A5) ────────────────────────────────────────────────────────────
const A5 = PAGE_DIMS['a5-portrait'];
const a5Page = (inner: string) =>
  `<div style="position:relative;width:${A5.w}px;height:${A5.h}px;background:#fff;overflow:hidden;font-family:${SANS};color:#111">${inner}</div>`;
const M = 56; // A5 여백(px)

export function catalogueCoverHtml(ctx: BoothContext, imageUrl: string | null): string {
  const t = ctx.exhibition.title;
  const size = t.length <= 10 ? 52 : t.length <= 20 ? 42 : 34;
  const img = imageUrl ? `<img src="${esc(imageSrc(imageUrl))}" crossorigin="anonymous" style="max-width:100%;max-height:100%;display:block"/>` : '';
  return a5Page(`
    <div style="position:absolute;left:${M}px;right:${M}px;top:${M}px">
      <p style="margin:0;font-size:10px;letter-spacing:.24em;color:#888">EXHIBITION CATALOGUE</p>
      <p style="margin:14px 0 0;font-family:${SERIF};font-size:${size}px;line-height:1.15;font-weight:500;word-break:keep-all">${esc(t)}</p>
      <p style="margin:16px 0 0;font-size:13px;color:#444">${esc([ctx.exhibition.typeLabel, ctx.exhibition.period].filter(Boolean).join(' · '))}</p>
      <p style="margin:4px 0 0;font-size:13px;color:#444">${esc(ctx.gallery?.name ?? '')}</p>
    </div>
    <div style="position:absolute;left:${M}px;right:${M}px;top:${Math.round(A5.h * 0.44)}px;bottom:${M + 12}px;display:flex;align-items:flex-end;justify-content:center">${img}</div>
  `);
}

export function catalogueIntroHtml(ctx: BoothContext, index: { name: string; page: number }[]): string {
  const desc = ctx.exhibition.description.trim();
  const clipped = desc.length > 1100 ? `${desc.slice(0, 1100).trim()}…` : desc;
  const rows = index.map((it) => `
    <div style="display:flex;align-items:baseline;gap:8px;font-size:12.5px;line-height:1.9">
      <span style="word-break:keep-all">${esc(it.name)}</span>
      <span style="flex:1;border-bottom:1px dotted #bbb;transform:translateY(-4px)"></span>
      <span style="color:#666;font-variant-numeric:tabular-nums">${it.page}</span>
    </div>`).join('');
  return a5Page(`
    <div style="position:absolute;left:${M}px;right:${M}px;top:${M}px;bottom:${M}px;display:flex;flex-direction:column">
      ${clipped ? `<p style="margin:0;font-size:10px;letter-spacing:.24em;color:#888">전시 소개</p>
      <p style="margin:12px 0 0;font-size:12.5px;line-height:1.9;color:#222;white-space:pre-wrap;word-break:keep-all;text-align:justify">${esc(clipped)}</p>` : ''}
      <div style="margin-top:${clipped ? '40px' : '0'}">
        <p style="margin:0 0 8px;font-size:10px;letter-spacing:.24em;color:#888">참여 작가 ${index.length}</p>
        <div style="column-count:${index.length > 14 ? 2 : 1};column-gap:24px">${rows}</div>
      </div>
    </div>
  `);
}

export function catalogueBackCoverHtml(ctx: BoothContext): string {
  const g = ctx.gallery;
  return a5Page(`
    <div style="position:absolute;left:${M}px;right:${M}px;bottom:${M}px;font-size:11.5px;line-height:1.8;color:#444">
      <p style="margin:0;font-family:${SERIF};font-size:18px;color:#111">${esc(ctx.exhibition.title)}</p>
      <p style="margin:2px 0 14px;color:#666">${esc([ctx.exhibition.typeLabel, ctx.exhibition.period].filter(Boolean).join(' · '))}</p>
      ${g ? `<p style="margin:0;font-weight:600;color:#111">${esc(g.name)}</p>${g.address ? `<p style="margin:0">${esc(g.address)}</p>` : ''}${g.phone ? `<p style="margin:0">${esc(g.phone)}</p>` : ''}${g.instagram ? `<p style="margin:0">${esc(g.instagram.replace(/^https?:\/\//, ''))}</p>` : ''}` : ''}
    </div>
  `);
}

const toEntries = (list?: CvEntry[] | null) => (list ?? []).filter((e) => e && (String(e.content ?? '').trim() || String(e.year ?? '').trim()))
  .map((e) => ({ year: String(e.year ?? ''), content: String(e.content ?? '') }));

/** 제출자료 → 포트폴리오 엔진 입력. 대표작이 작가 첫 장(표지 레이아웃)의 사진이 된다 */
export function artistBookData(row: BoothRow): { data: PortfolioBookData; repId: number } {
  const list = row.submission.artworkList ?? [];
  const images: PortfolioImage[] = list.map((a, i) => ({
    id: i + 1, url: a.image ?? '', order: i, title: a.title || null, medium: a.medium || null, sizeText: a.size || null, year: a.year || null,
  })).filter((im) => !!im.url);
  const cv = row.submission.cv;
  const repIndex = row.submission.representativeIndex ?? 0;
  const rep = images.find((im) => im.order === repIndex) ?? images[0];
  return {
    repId: rep?.id ?? 0,
    data: {
      user: { name: cv?.nameKo?.trim() || displayName(row.user), email: cv?.email || null, phone: cv?.tel || null },
      statement: row.submission.note?.statement || null,
      biography: cv?.birth ? cv.birth : null,
      career: cv ? { education: toEntries(cv.education), solo: toEntries(cv.solo), group: toEntries(cv.group), artFair: toEntries(cv.artFair), award: toEntries(cv.award) } : null,
      images,
      year: String(new Date().getFullYear()),
    },
  };
}

export async function downloadCataloguePdf(ctx: BoothContext, rows: BoothRow[], onProgress?: BoothProgress): Promise<{ missing: string[]; pages: number }> {
  ensurePortfolioFonts();
  const allUrls = rows.flatMap((r) => (r.submission.artworkList ?? []).map((a) => a.image));
  const failed = await prefetchAll([ctx.exhibition.poster, ...allUrls], onProgress);
  // 배치가 비율을 알아야 격자가 찬다 (PDF 엔진과 같은 측정)
  await measureAspects(allUrls.filter((u): u is string => !!u).map((u) => imageSrc(u)));

  const baseDesign = {
    page: 'a5-portrait', coverLayout: 'bandTop', worksLayout: 'hero', auto: true, desc: 'none', worksCaption: 'below',
    font: 'myeongjo', bg: 'white', ink: 'black', accent: 'red', coverYear: false, proseAlign: 'justify',
    coverEyebrowText: ctx.exhibition.title,
  };
  const theme = applyDesign(themeById('archive'), normalizePdfDesign(baseDesign));

  // 작가 장을 먼저 만든다 — 차례(참여 작가 쪽수)를 채우려면 각 작가의 시작 쪽을 알아야 한다
  const artistPages: PortfolioPage[] = [];
  const index: { name: string; page: number }[] = [];
  let folio = 3; // 1 표지, 2 소개
  for (const row of rows) {
    const { data, repId } = artistBookData(row);
    if (data.images.length === 0) continue;
    const pdfData = { ...data, images: data.images.map((im) => ({ ...im, url: imageSrc(im.url) })), aspects: aspectMap(data.images.map((im) => ({ url: imageSrc(im.url) }))) };
    const pages = buildPortfolioPages(pdfData, themeById('archive'), {
      forPdf: true, design: { ...baseDesign, coverImageIds: [repId] }, folioStart: folio, skipContact: true, runningHead: 'CATALOGUE',
    });
    index.push({ name: data.user.name, page: folio });
    folio += pages.length;
    artistPages.push(...pages);
  }

  const firstRep = rows.map((r) => representativeWork(r)?.image).find((u): u is string => !!u) ?? null;
  const pages: PortfolioPage[] = [
    { label: '표지', html: catalogueCoverHtml(ctx, ctx.exhibition.poster ?? firstRep), kind: 'cover' },
    { label: '전시 소개', html: catalogueIntroHtml(ctx, index), kind: 'prose' },
    ...artistPages,
    { label: '뒷표지', html: catalogueBackCoverHtml(ctx), kind: 'contact' },
  ];
  const blob = await renderPagesToPdf(pages, theme, (d, t) => onProgress?.('도록', d, t));
  triggerDownload(blob, `${safeName(ctx.exhibition.title)}_도록_A5.pdf`);
  return { missing: failed, pages: pages.length };
}
