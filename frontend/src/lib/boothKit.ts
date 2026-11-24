/**
 * 단체전 도록 (2026-09-16 · 2026-11-24 다시 짬, 규칙 53·92 · 목업 'CatA'·'CatB') — 출품 자료로 A5 도록 PDF 를 만든다.
 *
 * 예전 도록은 포트폴리오 엔진(작가 한 사람의 포트폴리오)을 작가마다 그대로 불러 이어 붙여서, 작가 10명에 105쪽 · 거의 빈 쪽 17쪽 ·
 * 여러 점을 놓은 쪽에서 캡션이 잘리고(재료·크기 없음) · 작가마다 '작품 목록' 쪽까지 들어갔다. 이제 도록 전용으로 짠다.
 *
 *  1 표지 · 2 전시 소개 · 3 참여 작가(차례)
 *  작가마다 **왼쪽 쪽에서 시작하는 펼침면**: [대표작 | 이름 · 작가노트] → [작품 | 작품 + 약력 요약]
 *    - 작가노트가 길면 다음 쪽으로 잇는다(자르지 않는다 — 작가의 글이다)
 *    - 작품은 한 쪽에 1~4점, 비율대로(자르지도 늘리지도 않는다, 규칙 18) · 캡션은 온전히(작품명, 연도 / 재료 · 크기)
 *    - 작가의 쪽 수는 늘 짝수 — 다음 작가가 왼쪽에서 시작하게(필요하면 작품을 한 쪽 더 나눠 싣고, 그래도 안 되면 빈 쪽)
 *    - 약력은 갈래마다 최근 둘 + '외 N회' — 전체 약력은 출품 자료 PDF 에
 *  뒷표지 — 전체 쪽 수는 4의 배수(제본). 모자라면 뒷표지 앞에 빈 쪽
 *
 * 쪽 나누기(작가노트가 어디서 넘어가는지 · 캡션이 몇 줄인지)는 **브라우저에서 실제로 재서** 정한다(같은 글꼴로 그리므로 잰 대로 나온다).
 * 재는 함수를 주입받는 `planCatalogue` 는 순수 함수라 테스트가 가짜 잣대로 쪽 수·짝수 규칙을 확인한다.
 * 그리기는 예전처럼 `renderPagesToPdf`(html2canvas, 240dpi) — 도록은 그림책이라 글자 복사보다 명조 글꼴·사진이 중요하다.
 */
import api from '@/lib/axios';
import { exhibitionTypeLabels, regionLabels } from '@/lib/utils';
import { imageSrc, prefetchImages, recoverFailed } from '@/lib/imageFetch';
import { esc, safeName, triggerDownload, type SubmissionRow } from '@/lib/operationPdf';
import { PAGE_DIMS, applyDesign, normalizePdfDesign, renderPagesToPdf, themeById, type PortfolioPage } from '@/lib/portfolioFormats';
import { SANS, SERIF, ensurePortfolioFonts } from '@/lib/portfolioFonts';
import type { ArtworkItem, CvEntry } from '@/types';
import { richToText } from './richText';
import { CV_SECTIONS } from './submissionChecklist';
import { docArtistName, mediumText, sizeText } from './galleryDocs/format';
import { paragraphs } from './galleryDocs/text';

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
      period: periodText(ex.exhibitStartDate, ex.exhibitDate), description: richToText(ex.description ?? ''),   // 공모 소개는 서식 있는 글일 수 있다 — 도록엔 글자로(문단은 살린다)
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

// ── 기하 (A5 720×1018 px — 렌더 배율로 240dpi) ─────────────────────────────
const A5 = PAGE_DIMS['a5-portrait'];
const M = 56;                    // 표지·뒷표지 여백
export const BOX = { x: 56, y: 92, w: A5.w - 112, h: 864 };   // 본문 상자(머리말 아래 ~ 쪽 번호 위)
const PARA_GAP = 13;
const CAP_GAP = 12;              // 그림 → 캡션
const ROW_GAP = 34;              // 줄 사이
const COL_GAP = 24;              // 한 줄의 그림 사이
const CV_GAP = 30;               // 작품 → 약력 요약
/** 여러 점을 한 쪽에 실을 때 그림 하나의 하한 — 짧은 변(약 31mm)과 넓이(약 42×42mm). 이보다 작아지면 그 쪽에 너무 많이 실은 것이다 */
export const MIN_SIDE = 150;
export const MIN_AREA = 42000;

/** 글 모양 — 재는 쪽과 그리는 쪽이 **같은 문자열**을 쓴다(어긋나면 잰 대로 안 나온다) */
export const ST = {
  statement: `font-family:${SERIF};font-size:16.5px;line-height:1.95;color:#1a1a1a;text-align:justify;word-break:keep-all;overflow-wrap:anywhere;margin:0`,
  /** 몇 줄만 다음 쪽으로 넘칠 때 그 작가의 작가노트만 한 단계 작게(쪽 하나에 한두 줄만 남기지 않게) */
  statementSm: `font-family:${SERIF};font-size:15.5px;line-height:1.85;color:#1a1a1a;text-align:justify;word-break:keep-all;overflow-wrap:anywhere;margin:0`,
  name: `font-family:${SERIF};font-size:56px;line-height:1.12;font-weight:400;letter-spacing:.06em;color:#111;word-break:keep-all;overflow-wrap:anywhere;margin:0`,
  nameEn: `font-family:${SANS};font-size:15px;line-height:1.5;color:#555;margin:10px 0 0`,
  capTitle: `font-family:${SERIF};font-size:16.5px;line-height:1.45;color:#111;word-break:keep-all;overflow-wrap:anywhere;margin:0`,
  capMeta: `font-family:${SANS};font-size:14.5px;line-height:1.5;color:#555;word-break:keep-all;overflow-wrap:anywhere;margin:2px 0 0`,
  cv: `font-family:${SANS};font-size:14.5px;line-height:1.7;color:#333;word-break:keep-all;overflow-wrap:anywhere`,
  head: `font-family:${SANS};font-size:13.5px;line-height:1;color:#767676;white-space:nowrap;overflow:hidden;text-overflow:ellipsis`,
};

const a5Page = (inner: string) =>
  `<div style="position:relative;width:${A5.w}px;height:${A5.h}px;background:#fff;overflow:hidden;font-family:${SANS};color:#111">${inner}</div>`;

/** 머리말·쪽 번호 — 왼쪽 쪽(짝수)은 왼쪽에 전시명, 오른쪽 쪽(홀수)은 오른쪽에 작가 이름. 쪽 번호는 바깥 아래 */
function chrome(page: number, exTitle: string, artist: string): string {
  const left = page % 2 === 0;
  const head = left
    ? `<div style="position:absolute;left:${BOX.x}px;top:44px;width:${BOX.w * 0.7}px;${ST.head}">${esc(exTitle)}</div>`
    : `<div style="position:absolute;right:${BOX.x}px;top:44px;width:${BOX.w * 0.7}px;text-align:right;${ST.head}">${esc(artist)}</div>`;
  const folio = `<div style="position:absolute;${left ? 'left' : 'right'}:${BOX.x}px;bottom:34px;${ST.head}">${page}</div>`;
  return head + folio;
}

// ── 캡션 · 문단 · 약력 요약 (그리는 HTML = 재는 HTML) ─────────────────────
export interface CatWork { url: string; aspect: number; title: string; year: string; medium: string; size: string }

export function captionHtml(w: Pick<CatWork, 'title' | 'year' | 'medium' | 'size'>): string {
  const t = w.title.trim() || '무제';
  const meta = [w.medium, w.size].filter(Boolean).join(' · ');
  return `<p style="${ST.capTitle}">${esc(t)}${w.year ? `, ${esc(w.year)}` : ''}</p>${meta ? `<p style="${ST.capMeta}">${esc(meta)}</p>` : ''}`;
}

/**
 * 문단들. 작가가 친 줄바꿈은 줄마다 블록으로 그린다 — `text-align-last` 는 강제 줄바꿈 앞 줄에도 걸리므로,
 * 한 덩어리(pre-line)로 두고 끝줄 맞춤을 켜면 줄바꿈 앞의 짧은 줄까지 글자 사이가 벌어진다(2026-11-24 실측).
 * `splitTail` 이면 **맨 끝 줄만** 양쪽 맞춤 — 쪽 끝에서 문장 중간에 나뉘어 다음 쪽으로 이어지는 줄이다.
 */
export function parasHtml(paras: string[], splitTail = false, small = false): string {
  const style = small ? ST.statementSm : ST.statement;
  return paras.map((p, i) => {
    const lines = p.split('\n');
    const lastPara = i === paras.length - 1;
    const body = lines.map((ln, li) => {
      const justify = lastPara && splitTail && li === lines.length - 1;
      return `<span style="display:block${justify ? ';text-align-last:justify' : ''}">${esc(ln) || '&nbsp;'}</span>`;
    }).join('');
    return `<p style="${style}${i ? `;margin-top:${PARA_GAP}px` : ''}">${body}</p>`;
  }).join('');
}

export interface CvRow { label: string; text: string }

/** 약력 요약 — 갈래마다 최근 둘 + '외 N회'(학력은 '외 N') */
export function cvSummary(cv: Partial<Record<'education' | 'solo' | 'group' | 'artFair' | 'award', CvEntry[]>> | null | undefined): CvRow[] {
  if (!cv) return [];
  const yearNum = (e: CvEntry) => { const n = parseInt(String(e.year ?? '').replace(/[^0-9]/g, '').slice(0, 4), 10); return Number.isFinite(n) ? n : -1; };
  return CV_SECTIONS.flatMap(({ key, label }) => {
    const items = (cv[key] ?? []).filter((e) => String(e?.content ?? '').trim() || String(e?.year ?? '').trim());
    if (!items.length) return [];
    // 최근 것부터 — 연도가 같거나 없으면 적은 순서 그대로(안정 정렬)
    const sorted = items.map((e, i) => ({ e, i })).sort((a, b) => (yearNum(b.e) - yearNum(a.e)) || (a.i - b.i)).map((x) => x.e);
    const shown = sorted.slice(0, 2).map((e) => [String(e.year ?? '').trim(), String(e.content ?? '').trim()].filter(Boolean).join(' ')).join(' · ');
    const rest = items.length - 2;
    const short = label.replace(' / 옥션', '').replace(' 및 선정', '');
    return [{ label: short, text: rest > 0 ? `${shown} 외 ${rest}${key === 'education' ? '' : '회'}` : shown }];
  });
}

export function cvHtml(rows: CvRow[]): string {
  if (!rows.length) return '';
  return `<div style="border-top:1px solid #111;padding-top:12px">${rows.map((r) =>
    `<div style="display:flex;gap:14px;${ST.cv}"><span style="flex:0 0 74px;font-weight:700;color:#111">${esc(r.label)}</span><span style="flex:1;min-width:0">${esc(r.text)}</span></div>`).join('')}</div>`;
}

function nameBlockHtml(name: string, nameEn: string): string {
  return `<p style="${ST.name}">${esc(name)}</p>${nameEn ? `<p style="${ST.nameEn}">${esc(nameEn)}</p>` : ''}<div style="width:36px;height:2.5px;background:#111;margin:18px 0 40px"></div>`;
}

// ── 작품 한 쪽의 배치 ──────────────────────────────────────────────────────
export interface Placement { index: number; x: number; y: number; w: number; h: number; capY: number; capH: number }
export interface WorksLayout { items: Placement[]; height: number; minSide: number; score: number }

/** 배치의 점수 — 그림 넓이의 로그 합. 큰 그림 하나보다 고르게 큰 여러 점을, 아주 작은 그림 하나를 특히 싫어한다 */
export const areaScore = (areas: number[]) => areas.reduce((s, a) => s + Math.log(Math.max(1, a)), 0);

/** 1~4점을 어떻게 줄 세울지 — 줄마다 그림 높이를 같게(폭은 비율대로) */
const TEMPLATES: Record<number, number[][][]> = {
  1: [[[0]]],
  2: [[[0], [1]], [[0, 1]]],
  3: [[[0], [1, 2]], [[0, 1], [2]], [[0], [1], [2]], [[0, 1, 2]]],
  4: [[[0, 1], [2, 3]], [[0], [1, 2, 3]], [[0, 1, 2], [3]], [[0], [1], [2, 3]], [[0, 1], [2], [3]]],
};

/**
 * 작품 몇 점을 상자(w×h)에 놓는다. 줄마다 폭을 꽉 채우는 높이로 잡고, 넘치면 전체를 줄인다(캡션 높이까지 다시 재며).
 * 그림 넓이의 로그 합이 가장 큰 배치를 고른다(그림 하나라도 `minSide`·`minArea` 아래로 내려가는 배치는 빼고). 못 놓으면 null.
 * @param capH (작품 번호, 캡션 폭) → 캡션 높이 — 브라우저에선 실제로 잰다
 */
export function layoutWorks(works: Pick<CatWork, 'aspect'>[], w: number, h: number, capH: (i: number, width: number) => number, minSide = 0, minArea = 0): WorksLayout | null {
  let best: WorksLayout | null = null;
  let bestScore = -Infinity;
  for (const rows of TEMPLATES[works.length] ?? []) {
    const base = rows.map((r) => (w - COL_GAP * (r.length - 1)) / r.reduce((s, i) => s + Math.max(0.2, works[i]!.aspect), 0));
    let s = 1;
    let done: { hs: number[]; caps: number[]; total: number } | null = null;
    for (let iter = 0; iter < 8; iter++) {
      const hs = base.map((x) => x * s);
      const caps = rows.map((r, ri) => Math.max(...r.map((i) => capH(i, Math.max(60, works[i]!.aspect * hs[ri]!)))));
      const fixed = caps.reduce((a, b) => a + b, 0) + CAP_GAP * rows.length + ROW_GAP * (rows.length - 1);
      const total = hs.reduce((a, b) => a + b, 0) + fixed;
      if (total <= h + 0.5) { done = { hs, caps, total }; break; }
      const avail = h - fixed;
      if (avail <= 40) break;
      s = Math.min(s * 0.995, (avail / base.reduce((a, b) => a + b, 0)) * (iter > 3 ? 0.98 : 1));
    }
    if (!done) continue;
    const items: Placement[] = [];
    let y = 0;
    rows.forEach((r, ri) => {
      const rh = done!.hs[ri]!;
      const widths = r.map((i) => Math.max(0.2, works[i]!.aspect) * rh);
      const rowW = widths.reduce((a, b) => a + b, 0) + COL_GAP * (r.length - 1);
      let x = (w - rowW) / 2;
      r.forEach((i, k) => {
        const iw = widths[k]!;
        items.push({ index: i, x, y, w: iw, h: rh, capY: y + rh + CAP_GAP, capH: capH(i, Math.max(60, iw)) });
        x += iw + COL_GAP;
      });
      y += rh + CAP_GAP + done!.caps[ri]! + ROW_GAP;
    });
    const areas = items.map((it) => it.w * it.h);
    const minSideOf = Math.min(...items.map((it) => Math.min(it.w, it.h)));
    if (minSideOf < minSide || Math.min(...areas) < minArea) continue;   // 그림 하나가 너무 작아지는 배치는 고르지 않는다
    const score = areaScore(areas);
    if (score > bestScore) { bestScore = score; best = { items, height: done.total, minSide: minSideOf, score }; }
  }
  return best;
}

// ── 쪽 계획 (순수 — 잣대를 주입받는다) ─────────────────────────────────────
/** 캡션 높이 — 폭을 8px 단위로 **내려** 잰다. 좁게 재면 줄 수가 같거나 많으므로 그린 캡션이 잰 자리를 넘지 않고, 같은 폭을 여러 번 재지 않는다 */
export function capHeight(m: Pick<Measure, 'height'>, w: Pick<CatWork, 'title' | 'year' | 'medium' | 'size'>, width: number): number {
  return m.height(captionHtml(w), Math.max(60, Math.floor(width / 8) * 8));
}

export interface CatArtist { name: string; nameEn: string; rep: CatWork | null; works: CatWork[]; statement: string[]; cv: CvRow[] }

export interface Measure {
  /** 문단들을 폭 w, 높이 h 에 채운다 — 들어간 문단(마지막은 잘린 앞부분일 수 있다)과 남은 문단 */
  fitParas(paras: string[], w: number, h: number, small?: boolean): { taken: string[]; rest: string[]; split: boolean };
  /** HTML 한 덩어리의 높이 */
  height(html: string, w: number): number;
}

export type ArtistPage =
  | { kind: 'rep'; work: CatWork }
  | { kind: 'name'; paras: string[]; split: boolean; cv: boolean; small?: boolean }
  | { kind: 'text'; paras: string[]; split: boolean; cv: boolean; small?: boolean }
  | { kind: 'works'; works: CatWork[]; layout: WorksLayout; cv: boolean }
  | { kind: 'cv' }
  | { kind: 'blank' };

/**
 * 작가 한 사람의 쪽들. 늘 짝수 쪽 — 다음 작가가 왼쪽(짝수 쪽)에서 시작하게.
 *
 *  [대표작] [이름 + 작가노트] [작가노트 이어서 …] [작품 …]
 *  약력 요약은 **마지막 작품 쪽 아래**가 기본이다(목업). 작가노트가 없는 작가는 이름 쪽이 비므로 **이름 아래**에 둔다.
 *  짝수를 맞추는 순서: ① 작품을 한 쪽 더 나눠 싣기 ② 약력 요약을 다른 자리로 옮겨 작품 쪽 수를 하나 줄이거나 늘리기 ③ 빈 쪽.
 */
export function planArtist(a: CatArtist, m: Measure): ArtistPage[] {
  const cvBlock = cvHtml(a.cv);
  const cvH = cvBlock ? m.height(cvBlock, BOX.w) + CV_GAP : 0;
  const nameH = m.height(nameBlockHtml(a.name, a.nameEn), BOX.w);

  // 이름 + 작가노트(넘치면 다음 쪽으로)
  type TextPage = { kind: 'name' | 'text'; paras: string[]; split: boolean; room: number; used: number };
  const flow = (small: boolean): TextPage[] => {
    const out: TextPage[] = [];
    let rest = a.statement;
    let first = true;
    do {
      const avail = BOX.h - (first ? nameH : 0);
      const fit = rest.length ? m.fitParas(rest, BOX.w, avail, small) : { taken: [], rest: [], split: false };
      const used = fit.taken.length ? m.height(parasHtml(fit.taken, fit.split, small), BOX.w) : 0;
      if (!fit.taken.length && !first) break; // 진행이 없으면 멈춘다(무한 루프 방지 — 한 글자도 안 들어가는 상자)
      out.push({ kind: first ? 'name' : 'text', paras: fit.taken, split: fit.split, room: avail - used, used });
      rest = fit.rest;
      first = false;
    } while (rest.length);
    return out;
  };
  let small = false;
  let textPages = flow(false);
  // 마지막 쪽에 몇 줄만 넘어갔으면(쪽 높이의 30% 미만) 한 단계 작은 글자로 — 그래서 쪽이 하나 줄 때만 쓴다
  if (textPages.length > 1 && textPages[textPages.length - 1]!.used < BOX.h * 0.3) {
    const tight = flow(true);
    if (tight.length < textPages.length) { textPages = tight; small = true; }
  }
  const cvFitsText = cvH > 0 && textPages[textPages.length - 1]!.room >= cvH;

  // 작품 쪽 — 순서대로 k 쪽에 나누는 가장 좋은 방법(동적 계획법). 쪽마다 1~4점, 마지막 쪽은 약력 요약 자리를 비울 수 있다.
  // 좋은 방법 = 모든 작품 넓이의 로그 합이 가장 큰 것(작은 그림이 없게 · 고르게). 한 점짜리 쪽은 늘 놓인다.
  const works = a.works;
  const n = works.length;
  const chunkCache = new Map<string, WorksLayout | null>();
  const chunk = (j: number, i: number, withCv: boolean): WorksLayout | null => {
    const key = `${j}|${i}|${withCv ? 1 : 0}`;
    if (chunkCache.has(key)) return chunkCache.get(key)!;
    const list = works.slice(j, i);
    const one = list.length === 1;
    const lay = layoutWorks(list, BOX.w, BOX.h - (withCv ? cvH : 0), (k, width) => capHeight(m, list[k]!, width), one ? 0 : MIN_SIDE, one ? 0 : MIN_AREA);
    chunkCache.set(key, lay);
    return lay;
  };
  const partCache = new Map<string, ArtistPage[] | null>();
  const partition = (k: number, withCv: boolean): ArtistPage[] | null => {
    if (k < 1 || k > n || k * 4 < n) return null;
    const key = `${k}|${withCv ? 1 : 0}`;
    if (partCache.has(key)) return partCache.get(key)!;
    type Cell = { score: number; prev: number; lay: WorksLayout | null } | null;
    const dp: Cell[][] = Array.from({ length: k + 1 }, () => new Array<Cell>(n + 1).fill(null));
    dp[0]![0] = { score: 0, prev: -1, lay: null };
    for (let c = 1; c <= k; c++) {
      const last = c === k;
      for (let i = c; i <= n; i++) {
        if (last && i !== n) continue;
        let cell: Cell = null;
        for (let size = 1; size <= 4 && i - size >= 0; size++) {
          const j = i - size;
          const prev = dp[c - 1]![j];
          if (!prev) continue;
          const lay = chunk(j, i, withCv && last);
          if (!lay) continue;
          const score = prev.score + lay.score;
          if (!cell || score > cell.score) cell = { score, prev: j, lay };
        }
        dp[c]![i] = cell;
      }
    }
    let out: ArtistPage[] | null = null;
    if (dp[k]![n]) {
      out = [];
      let i = n;
      for (let c = k; c >= 1; c--) {
        const cell = dp[c]![i]!;
        out.unshift({ kind: 'works', works: works.slice(cell.prev, i), layout: cell.lay!, cv: withCv && c === k });
        i = cell.prev;
      }
    }
    partCache.set(key, out);
    return out;
  };
  const minPages = (withCv: boolean): number | null => {
    for (let k = Math.max(1, Math.ceil(n / 4)); k <= n; k++) if (partition(k, withCv)) return k;
    return null;
  };

  type Cand = { cvOn: 'works' | 'text' | 'own' | 'none'; works: ArtistPage[] };
  const cands: Cand[] = [];
  const add = (cvOn: Cand['cvOn'], w: ArtistPage[] | null) => { if (w) cands.push({ cvOn, works: w }); };
  if (!n) {
    add(cvH ? (cvFitsText ? 'text' : 'own') : 'none', []);
  } else {
    const pW = cvH ? minPages(true) : null;
    const pN = minPages(false);
    const onWorks = () => { if (pW != null) { add('works', partition(pW, true)); add('works', partition(pW + 1, true)); } };
    const onText = (cvOn: 'text' | 'own' | 'none') => {
      if (pN == null) return;
      add(cvOn, partition(pN, false));
      add(cvOn, partition(pN + 1, false));
    };
    if (!cvH) onText('none');
    else if (!a.statement.length && cvFitsText) { onText('text'); onWorks(); }
    else { onWorks(); if (cvFitsText) onText('text'); }
    if (cvH && !cands.length && !cvFitsText) onText('own');
    // 아무 배치도 안 되면(아주 길쭉한 그림) 한 쪽에 한 점씩 — 한 점은 늘 놓인다
    if (!cands.length) {
      add(cvH ? (cvFitsText ? 'text' : 'own') : 'none', works.map((w, i) => ({ kind: 'works' as const, works: [w], layout: chunk(i, i + 1, false)!, cv: false })));
    }
  }

  const build = (c: Cand): ArtistPage[] => {
    const pages: ArtistPage[] = [];
    if (a.rep) pages.push({ kind: 'rep', work: a.rep });
    textPages.forEach((t, i) => {
      const cv = i === textPages.length - 1 && c.cvOn === 'text';
      pages.push(t.kind === 'name' ? { kind: 'name', paras: t.paras, split: t.split, cv, small } : { kind: 'text', paras: t.paras, split: t.split, cv, small });
    });
    if (c.cvOn === 'own') pages.push({ kind: 'cv' });
    pages.push(...c.works);
    return pages;
  };
  const built = cands.map(build);
  const even = built.find((p) => p.length % 2 === 0);
  if (even) return even;
  const fallback = built[0]!;
  return [...fallback, { kind: 'blank' }];
}

export interface CataloguePlan { pages: ({ artist: number; page: ArtistPage } | { front: 'cover' | 'intro' | 'contents' | 'back' | 'blank' })[]; index: { name: string; page: number }[] }

/** 도록 전체 — 앞 3쪽(표지·소개·차례) → 작가들(각자 짝수 쪽, 왼쪽에서 시작) → 빈 쪽(4의 배수로) → 뒷표지 */
export function planCatalogue(artists: CatArtist[], m: Measure): CataloguePlan {
  const pages: CataloguePlan['pages'] = [{ front: 'cover' }, { front: 'intro' }, { front: 'contents' }];
  const index: CataloguePlan['index'] = [];
  artists.forEach((a, ai) => {
    index.push({ name: a.name, page: pages.length + 1 });
    for (const p of planArtist(a, m)) pages.push({ artist: ai, page: p });
  });
  while ((pages.length + 1) % 4 !== 0) pages.push({ front: 'blank' });
  pages.push({ front: 'back' });
  return { pages, index };
}

// ── 쪽 HTML ───────────────────────────────────────────────────────────────
export function catalogueCoverHtml(ctx: BoothContext, imageUrl: string | null): string {
  const t = ctx.exhibition.title;
  const size = t.length <= 10 ? 52 : t.length <= 20 ? 42 : 34;
  const img = imageUrl ? `<img src="${esc(imageSrc(imageUrl))}" crossorigin="anonymous" style="max-width:100%;max-height:100%;display:block"/>` : '';
  return a5Page(`
    <div style="position:absolute;left:${M}px;right:${M}px;top:${M}px">
      <p style="margin:0;font-size:12px;letter-spacing:.24em;color:#888">EXHIBITION CATALOGUE</p>
      <p style="margin:14px 0 0;font-family:${SERIF};font-size:${size}px;line-height:1.15;font-weight:500;word-break:keep-all">${esc(t)}</p>
      <p style="margin:16px 0 0;font-size:15px;color:#444">${esc([ctx.exhibition.typeLabel, ctx.exhibition.period].filter(Boolean).join(' · '))}</p>
      <p style="margin:4px 0 0;font-size:15px;color:#444">${esc(ctx.gallery?.name ?? '')}</p>
    </div>
    <div style="position:absolute;left:${M}px;right:${M}px;top:${Math.round(A5.h * 0.44)}px;bottom:${M + 12}px;display:flex;align-items:flex-end;justify-content:center">${img}</div>
  `);
}

/** 2쪽 — 전시 소개(공모 소개 글). 없으면 전시 정보만 */
export function catalogueIntroHtml(ctx: BoothContext): string {
  const desc = ctx.exhibition.description.trim();
  const clipped = desc.length > 1400 ? `${desc.slice(0, 1400).trim()}…` : desc;
  const info = [ctx.exhibition.typeLabel, ctx.exhibition.period, ctx.gallery?.name].filter(Boolean).join(' · ');
  return a5Page(`
    <div style="position:absolute;left:${BOX.x}px;right:${BOX.x}px;top:${BOX.y}px">
      <p style="margin:0;font-size:13px;letter-spacing:.24em;color:#888">전시 소개</p>
      <p style="margin:12px 0 0;font-family:${SERIF};font-size:26px;line-height:1.3;word-break:keep-all">${esc(ctx.exhibition.title)}</p>
      ${info ? `<p style="margin:8px 0 0;font-size:14.5px;color:#555">${esc(info)}</p>` : ''}
      ${clipped ? `<div style="margin-top:34px;${ST.statement};white-space:pre-wrap">${esc(clipped)}</div>` : ''}
    </div>
    <div style="position:absolute;left:${BOX.x}px;bottom:34px;${ST.head}">2</div>
  `);
}

/** 3쪽 — 참여 작가(차례) */
export function catalogueContentsHtml(index: { name: string; page: number }[]): string {
  const rows = index.map((it) => `
    <div style="display:flex;align-items:baseline;gap:10px;font-size:16.5px;line-height:2.1;font-family:${SERIF}">
      <span style="word-break:keep-all">${esc(it.name)}</span>
      <span style="flex:1;border-bottom:1px dotted #bbb;transform:translateY(-5px)"></span>
      <span style="color:#666;font-family:${SANS};font-size:14.5px;font-variant-numeric:tabular-nums">${it.page}</span>
    </div>`).join('');
  return a5Page(`
    <div style="position:absolute;left:${BOX.x}px;right:${BOX.x}px;top:${BOX.y}px">
      <p style="margin:0 0 18px;font-size:13px;letter-spacing:.24em;color:#888">참여 작가 ${index.length}</p>
      <div style="column-count:${index.length > 16 ? 2 : 1};column-gap:32px">${rows}</div>
    </div>
    <div style="position:absolute;right:${BOX.x}px;bottom:34px;${ST.head}">3</div>
  `);
}

export function catalogueBackCoverHtml(ctx: BoothContext): string {
  const g = ctx.gallery;
  return a5Page(`
    <div style="position:absolute;left:${M}px;right:${M}px;bottom:${M}px;font-size:14px;line-height:1.8;color:#444">
      <p style="margin:0;font-family:${SERIF};font-size:22px;color:#111">${esc(ctx.exhibition.title)}</p>
      <p style="margin:2px 0 16px;color:#666">${esc([ctx.exhibition.typeLabel, ctx.exhibition.period].filter(Boolean).join(' · '))}</p>
      ${g ? `<p style="margin:0;font-weight:600;color:#111">${esc(g.name)}</p>${g.address ? `<p style="margin:0">${esc(g.address)}</p>` : ''}${g.phone ? `<p style="margin:0">${esc(g.phone)}</p>` : ''}${g.instagram ? `<p style="margin:0">${esc(g.instagram.replace(/^https?:\/\//, ''))}</p>` : ''}` : ''}
    </div>
  `);
}

const imgTag = (url: string, w: number, h: number) =>
  `<img src="${esc(imageSrc(url))}" crossorigin="anonymous" width="${Math.round(w)}" height="${Math.round(h)}" style="display:block;width:${w.toFixed(1)}px;height:${h.toFixed(1)}px"/>`;

/** 작가 쪽 하나 → HTML */
export function artistPageHtml(p: ArtistPage, a: CatArtist, pageNo: number, exTitle: string, m: Pick<Measure, 'height'>): string {
  const ch = chrome(pageNo, exTitle, a.name);
  const box = (inner: string, style = '') => `<div style="position:absolute;left:${BOX.x}px;top:${BOX.y}px;width:${BOX.w}px;height:${BOX.h}px;${style}">${inner}</div>`;
  const cvAtBottom = `<div style="position:absolute;left:0;right:0;bottom:0">${cvHtml(a.cv)}</div>`;
  switch (p.kind) {
    case 'rep': {
      const lay = layoutWorks([p.work], BOX.w, BOX.h, (_j, width) => capHeight(m, p.work, width))!;
      const it = lay.items[0]!;
      const top = (BOX.h - lay.height) / 2;
      return a5Page(ch + box(`<div style="position:absolute;left:${it.x}px;top:${top + it.y}px">${imgTag(p.work.url, it.w, it.h)}</div>
        <div style="position:absolute;left:${it.x}px;top:${top + it.capY}px;width:${Math.max(it.w, 60)}px">${captionHtml(p.work)}</div>`));
    }
    case 'name':
      // 작가노트가 없으면 약력 요약을 이름 바로 아래에(쪽 바닥에 두면 가운데가 텅 빈다)
      if (!p.paras.length) return a5Page(ch + box(`${nameBlockHtml(a.name, a.nameEn)}${p.cv ? cvHtml(a.cv) : ''}`));
      return a5Page(ch + box(`${nameBlockHtml(a.name, a.nameEn)}${parasHtml(p.paras, p.split, p.small)}${p.cv ? cvAtBottom : ''}`));
    case 'text':
      return a5Page(ch + box(`${parasHtml(p.paras, p.split, p.small)}${p.cv ? cvAtBottom : ''}`));
    case 'works': {
      const single = p.works.length === 1 && !p.cv;
      const top = single ? (BOX.h - p.layout.height) / 2 : 0;
      const items = p.layout.items.map((it) => {
        const w = p.works[it.index]!;
        return `<div style="position:absolute;left:${it.x.toFixed(1)}px;top:${(top + it.y).toFixed(1)}px">${imgTag(w.url, it.w, it.h)}</div>
          <div style="position:absolute;left:${it.x.toFixed(1)}px;top:${(top + it.capY).toFixed(1)}px;width:${Math.max(it.w, 60).toFixed(1)}px">${captionHtml(w)}</div>`;
      }).join('');
      return a5Page(ch + box(`${items}${p.cv ? cvAtBottom : ''}`));
    }
    case 'cv':
      return a5Page(ch + box(cvHtml(a.cv)));
    case 'blank':
      return a5Page('');
  }
}

// ── 브라우저 잣대 ──────────────────────────────────────────────────────────
/** 실제 글꼴로 재는 잣대 — 화면 밖 상자에 그려 높이를 읽는다 */
function domMeasure(): Measure & { dispose: () => void } {
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-99999px;top:0;visibility:hidden;pointer-events:none;';
  const el = document.createElement('div');
  // flow-root — 안쪽 첫·끝 요소의 여백이 상자 밖으로 새지 않게(쪽 안 본문 상자도 position:absolute 라 같다)
  el.style.display = 'flow-root';
  host.appendChild(el);
  document.body.appendChild(host);
  const cache = new Map<string, number>();
  const height = (html: string, w: number) => {
    const key = `${w.toFixed(1)}|${html}`;
    const hit = cache.get(key);
    if (hit != null) return hit;
    el.style.width = `${w}px`;
    el.innerHTML = html;
    const h = el.getBoundingClientRect().height;
    cache.set(key, h);
    return h;
  };
  const fitParas: Measure['fitParas'] = (paras, w, h, small = false) => {
    const taken: string[] = [];
    const hOf = (ps: string[], tail = false) => height(parasHtml(ps, tail, small), w);
    for (let i = 0; i < paras.length; i++) {
      if (hOf([...taken, paras[i]!]) <= h) { taken.push(paras[i]!); continue; }
      // 이 문단을 나눈다 — 낱말 경계에서, 들어가는 만큼
      const words = paras[i]!.split(/(?<=\s)/u);
      const fits = (k: number) => hOf([...taken, words.slice(0, k).join('').trimEnd()], true) <= h;
      let lo = 0, hi = words.length - 1;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (fits(mid)) lo = mid; else hi = mid - 1; }
      if (lo > 0 && fits(lo)) {
        const head = words.slice(0, lo).join('');
        taken.push(head.trimEnd());
        // 작가가 친 줄바꿈 자리에서 나뉘었으면 끝줄을 맞추지 않는다(그 줄은 원래 짧다)
        return { taken, rest: [words.slice(lo).join(''), ...paras.slice(i + 1)], split: !/\n\s*$/.test(head) };
      }
      // 낱말 하나도 안 들어가는데 그게 공백 없이 긴 글이면 글자 단위로
      if (words.length === 1) {
        const chars = Array.from(paras[i]!);
        const fitsC = (k: number) => hOf([...taken, chars.slice(0, k).join('')], true) <= h;
        let a = 0, b = chars.length - 1;
        while (a < b) { const mid = (a + b + 1) >> 1; if (fitsC(mid)) a = mid; else b = mid - 1; }
        if (a > 0 && fitsC(a)) {
          taken.push(chars.slice(0, a).join(''));
          return { taken, rest: [chars.slice(a).join(''), ...paras.slice(i + 1)], split: true };
        }
      }
      return { taken, rest: paras.slice(i), split: false };
    }
    return { taken, rest: [], split: false };
  };
  return { height, fitParas, dispose: () => host.remove() };
}

/**
 * 도록에 쓰는 글꼴을 **그 글자들까지** 받아 둔다 — 명조·Pretendard 는 글자 묶음(unicode-range)마다 따로 받는 웹 글꼴이라,
 * 아직 화면에 안 쓰인 글자는 대체 글꼴로 재진다. 그러면 잰 높이와 그린 높이가 달라 글이 넘치거나 빈다.
 * `document.fonts.ready` 만으로는 안 된다(아직 요청도 안 한 글자는 기다리지 않는다). 8초 넘게 걸리면 그냥 간다.
 */
async function loadCatalogueFonts(text: string): Promise<void> {
  const fs = typeof document !== 'undefined' ? document.fonts : undefined;
  if (!fs?.load) return;
  const sample = Array.from(new Set(Array.from(text.replace(/\s+/g, '')))).join('') || '가';
  const faces = ['400 16px "Nanum Myeongjo"', '400 16px "Pretendard Variable"', '700 16px "Pretendard Variable"'];
  await Promise.race([
    Promise.all(faces.map((f) => fs.load(f, sample).catch(() => []))),
    new Promise((r) => setTimeout(r, 8000)),
  ]);
  try { await fs.ready; } catch { /* 지원 안 하는 브라우저는 그대로 */ }
}

/** 도록에 찍히는 글자 전부(글꼴을 미리 받을 때) */
function catalogueText(ctx: BoothContext, artists: CatArtist[]): string {
  const parts: string[] = [ctx.exhibition.title, ctx.exhibition.typeLabel, ctx.exhibition.period, ctx.exhibition.description,
    ctx.gallery?.name ?? '', ctx.gallery?.address ?? '', ctx.gallery?.phone ?? '', ctx.gallery?.instagram ?? '',
    'EXHIBITION CATALOGUE 전시 소개 참여 작가 무제 0123456789'];
  for (const a of artists) {
    parts.push(a.name, a.nameEn, ...a.statement, ...a.cv.flatMap((r) => [r.label, r.text]));
    for (const w of [a.rep, ...a.works]) if (w) parts.push(w.title, w.year, w.medium, w.size);
  }
  return parts.join(' ');
}

/** 그림 비율 — 미리 받아 둔 그림(blob:)을 열어 잰다. 못 재면 1 */
async function aspectOf(url: string): Promise<number> {
  return new Promise((done) => {
    const im = new Image();
    im.onload = () => done(im.naturalWidth > 0 && im.naturalHeight > 0 ? im.naturalWidth / im.naturalHeight : 1);
    im.onerror = () => done(1);
    im.src = imageSrc(url);
  });
}

/** 출품 자료 한 줄 → 도록의 작가 */
async function catArtist(row: BoothRow, bad: Set<string>): Promise<CatArtist | null> {
  const list = (row.submission.artworkList ?? []).filter((w) => !!w.image && !bad.has(w.image));
  if (list.length === 0) return null;
  const repItem = representativeWork(row);
  const rep = repItem && repItem.image && !bad.has(repItem.image) ? repItem : list[0]!;
  const toWork = async (w: ArtworkItem): Promise<CatWork> => ({
    url: w.image!, aspect: await aspectOf(w.image!), title: String(w.title ?? '').trim(), year: String(w.year ?? '').trim(),
    medium: mediumText(w.medium), size: sizeText(w.size),
  });
  const cv = row.submission.cv;
  return {
    name: docArtistName(row.user, cv),
    nameEn: String(cv?.nameEn ?? '').trim(),
    rep: await toWork(rep),
    works: await Promise.all(list.filter((w) => w !== rep).map(toWork)),
    statement: paragraphs(row.submission.note?.statement),
    cv: cvSummary(cv),
  };
}

export async function downloadCataloguePdf(ctx: BoothContext, rows: BoothRow[], onProgress?: BoothProgress): Promise<{ missing: string[]; pages: number }> {
  ensurePortfolioFonts();
  const allUrls = rows.flatMap((r) => (r.submission.artworkList ?? []).map((a) => a.image)).filter((u): u is string => !!u);
  const list = [...new Set([ctx.exhibition.poster, ...allUrls].filter((u): u is string => !!u))];
  let failed = list.length ? await prefetchImages(list, (d, t) => onProgress?.('이미지', d, t)) : [];
  if (failed.length) failed = await recoverFailed(failed, (d, t) => onProgress?.('재시도', d, t));
  const bad = new Set(failed);

  const artists = (await Promise.all(rows.map((r) => catArtist(r, bad)))).filter((a): a is CatArtist => !!a);
  // 글꼴이 늦게 붙으면 잰 높이와 그린 높이가 달라진다 — 쓰이는 글자까지 다 받은 뒤에 잰다
  await loadCatalogueFonts(catalogueText(ctx, artists));
  const m = domMeasure();
  let pagesOut: PortfolioPage[];
  try {
    const plan = planCatalogue(artists, m);
    const firstRep = artists[0]?.rep?.url ?? null;
    pagesOut = plan.pages.map((p, i): PortfolioPage => {
      const no = i + 1;
      if ('front' in p) {
        if (p.front === 'cover') return { label: '표지', html: catalogueCoverHtml(ctx, ctx.exhibition.poster && !bad.has(ctx.exhibition.poster) ? ctx.exhibition.poster : firstRep), kind: 'cover' };
        if (p.front === 'intro') return { label: '전시 소개', html: catalogueIntroHtml(ctx), kind: 'prose' };
        if (p.front === 'contents') return { label: '참여 작가', html: catalogueContentsHtml(plan.index), kind: 'prose' };
        if (p.front === 'back') return { label: '뒷표지', html: catalogueBackCoverHtml(ctx), kind: 'contact' };
        return { label: '빈 쪽', html: a5Page(''), kind: 'prose' };
      }
      const a = artists[p.artist]!;
      return { label: `${a.name} ${no}`, html: artistPageHtml(p.page, a, no, ctx.exhibition.title, m), kind: p.page.kind === 'works' || p.page.kind === 'rep' ? 'works' : 'prose' };
    });
  } finally {
    m.dispose();
  }

  const theme = applyDesign(themeById('archive'), normalizePdfDesign({ page: 'a5-portrait', bg: 'white', ink: 'black', font: 'myeongjo' }));
  const blob = await renderPagesToPdf(pagesOut, theme, (d, t) => onProgress?.('도록', d, t));
  triggerDownload(blob, `${safeName(ctx.exhibition.title)}_도록_A5.pdf`);
  return { missing: failed, pages: pagesOut.length };
}
