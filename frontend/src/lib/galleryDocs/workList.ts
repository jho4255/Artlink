/**
 * 작품 리스트 — 전시 전체 출품작을 한 표로 (2026-11-24, 규칙 92 · 목업 'WorkList').
 * 예전엔 작가마다 따로 '출품리스트' PDF 만 있어 전시 전체를 한눈에 볼 문서가 없었다.
 *  - 1번부터 이어지는 번호(작품 원본 파일 이름·출품 자료와 같은 번호, format.ts numberWorks)
 *  - 작가마다 묶음 머리(작품 수 · 가격 합계 · 비매) — 쪽이 넘어가면 묶음 머리가 다시 나온다(headerRows)
 *  - 2쪽부터는 머리말 자리에 표 머리(번호 · 작품명 · 재료 …)가 다시 나온다
 *  - 같은 표를 엑셀로(`workListSheet` → xlsx.ts)
 */
import type { Content, TableCell, TDocumentDefinitions } from 'pdfmake/interfaces';
import { C, FS, MX, baseDoc, docTitle, folio, statRow } from './layout';
import { runs, txt } from './text';
import { docArtistName, isNotForSale, mediumText, numberWorks, priceAmount, priceText, sizeText, won } from './format';
import type { DocContext, ImgFn, SubmissionRowLike } from './types';

/** 열 너비(pt) — 작품명만 남는 폭 */
const W: (number | string)[] = [20, 32, '*', 112, 72, 26, 64];
const PAD_X = 4;
const THUMB = 28;

const cellLayout = {
  vLineWidth: () => 0,
  paddingLeft: (i: number) => (i === 0 ? 0 : PAD_X),
  paddingRight: (i: number) => (i === W.length - 1 ? 0 : PAD_X),
};

/** 표 머리 한 줄 — 1쪽은 본문에, 2쪽부터는 머리말에 */
function headRow(): Content {
  const h = (t: string, right = false) => ({ text: t, fontSize: FS.tiny, color: C.sub, alignment: right ? 'right' : 'left' });
  return {
    table: { widths: W, body: [[h('번호'), h(''), h('작품명'), h('재료'), h('크기'), h('연도'), h('가격', true)]] },
    layout: { ...cellLayout, hLineWidth: (i: number) => (i === 1 ? 0.75 : 0), hLineColor: () => C.ink, paddingTop: () => 2, paddingBottom: () => 5 },
  } as Content;
}

export interface WorkLine {
  no: number;
  artist: string;
  guest: boolean;
  title: string;
  year: string;
  medium: string;
  size: string;
  /** 숫자로 읽히는 가격(원) — 아니면 null */
  amount: number | null;
  /** 문서에 찍는 가격 — '1,200,000원' · '비매' · '협의' */
  price: string;
  nfs: boolean;
  image: string | null;
}

export interface WorkGroup { artist: string; guest: boolean; lines: WorkLine[] }

/** 화면의 출품 자료 → 작가별 작품 줄 (번호·표기 정리까지) */
export function workGroups(rows: SubmissionRowLike[]): WorkGroup[] {
  const { numberOf } = numberWorks(rows);
  return rows.map((r) => {
    const artist = docArtistName(r.user, r.submission.cv);
    return {
      artist,
      guest: !!r.guest,
      lines: (r.submission.artworkList ?? []).map((a, i) => ({
        no: numberOf(r.user.id, i),
        artist,
        guest: !!r.guest,
        title: String(a.title ?? '').trim(),
        year: String(a.year ?? '').trim(),
        medium: mediumText(a.medium),
        size: sizeText(a.size),
        amount: priceAmount(a.price),
        price: priceText(a.price),
        nfs: isNotForSale(a.price),
        image: a.image || null,
      })),
    };
  });
}

/** 묶음 머리 오른쪽 '8점 · 5,090,000원 · 비매 1점' */
function groupMeta(lines: WorkLine[]): string {
  if (lines.length === 0) return '0점';
  const sum = lines.reduce((s, l) => s + (l.amount ?? 0), 0);
  const nfs = lines.filter((l) => l.nfs).length;
  return [`${lines.length}점`, sum > 0 ? won(sum) : '', nfs ? `비매 ${nfs}점` : ''].filter(Boolean).join(' · ');
}

function workRow(l: WorkLine, img: ImgFn): TableCell[] {
  const src = img(l.image, 'thumb');
  const mid = { verticalAlignment: 'middle' as const };
  return [
    { text: String(l.no), fontSize: FS.small, color: C.sub, ...mid },
    src ? { image: src, fit: [THUMB, THUMB], alignment: 'center', ...mid } : { text: '', ...mid },
    { ...(txt(l.title || '(제목 없음)', { fontSize: FS.small, color: l.title ? C.ink : C.muted }) as object), ...mid },
    { ...(txt(l.medium, { fontSize: FS.small, color: '#333333' }) as object), ...mid },
    { ...(txt(l.size, { fontSize: FS.small, color: '#333333' }, { maxWord: 8 }) as object), ...mid },
    { text: l.year, fontSize: FS.small, color: '#333333', ...mid },
    { ...(txt(l.price, { fontSize: FS.small, alignment: 'right' }) as object), ...mid },
  ] as TableCell[];
}

/** 작가 한 사람의 표 — 묶음 머리를 headerRows 로(쪽이 넘어가면 다시 나온다 · 머리만 쪽 끝에 남지 않는다) */
function groupTable(g: WorkGroup, img: ImgFn): Content {
  const span = (c: object): TableCell[] => [{ ...c, colSpan: W.length } as TableCell, ...Array.from({ length: W.length - 1 }, () => ({}) as TableCell)];
  const head = span({
    columns: [
      { text: [...runs(g.artist, { bold: true }), ...(g.guest ? [{ text: '  비회원', fontSize: FS.tiny, color: C.muted, bold: false }] : [])], fontSize: 10.5, bold: true, width: '*' },
      { text: groupMeta(g.lines), fontSize: FS.tiny, color: C.sub, alignment: 'right', width: 'auto', margin: [0, 1.5, 0, 0] },
    ],
    columnGap: 10,
    margin: [0, 6, 0, 0],
  });
  const body: TableCell[][] = [head];
  if (g.lines.length === 0) body.push(span({ text: '아직 낸 작품이 없어요.', fontSize: FS.small, color: C.muted, margin: [0, 2, 0, 2] }));
  else for (const l of g.lines) body.push(workRow(l, img));
  return {
    table: { headerRows: 1, keepWithHeaderRows: 1, dontBreakRows: true, widths: W, body },
    layout: {
      ...cellLayout,
      hLineWidth: (i: number, node: { table: { body: unknown[] } }) => (i === 0 ? 0 : i === 1 ? 0.75 : i === node.table.body.length ? 0.5 : 0.5),
      hLineColor: (i: number) => (i === 1 ? C.rule : C.hair),
      paddingTop: (i: number) => (i === 0 ? 0 : 4),
      paddingBottom: (i: number) => (i === 0 ? 5 : 4),
    },
  } as Content;
}

export function buildWorkListDoc(ctx: DocContext, rows: SubmissionRowLike[], img: ImgFn): TDocumentDefinitions {
  const groups = workGroups(rows);
  const lines = groups.flatMap((g) => g.lines);
  const sum = lines.reduce((s, l) => s + (l.amount ?? 0), 0);
  const nfs = lines.filter((l) => l.nfs).length;
  const stats: [string, string][] = [['작가', `${groups.length}명`], ['작품', `${lines.length}점`], ['가격 합계', won(sum)]];
  if (nfs) stats.push(['비매', `${nfs}점`]);
  const label = `작품 리스트 · ${ctx.exTitle}`;

  return baseDoc(`${ctx.exTitle} 작품 리스트`, {
    pageMargins: [MX, 78, MX, 46],
    header: (page: number) => (page === 1 ? null : {
      margin: [MX, 24, MX, 0],
      stack: [txt(label, { fontSize: FS.tiny, color: C.muted, margin: [0, 0, 0, 10] }), headRow()],
    }) as Content,
    footer: (page: number, count: number) => folio(label, page, count),
    content: [
      docTitle(ctx.exTitle, '작품 리스트', [ctx.issuer, ctx.period ? `전시 ${ctx.period}` : '', `발행 ${ctx.issued}`]),
      statRow(stats),
      { stack: [headRow()], margin: [0, 16, 0, 0] } as Content,
      ...groups.map((g) => groupTable(g, img)),
      ...(lines.length ? [] : [{ text: '아직 낸 작품이 없어요.', color: C.muted, margin: [0, 12, 0, 0] } as Content]),
    ],
  });
}

/** 엑셀 한 장 — 머리 + 작품마다 한 줄. 가격은 숫자 칸(합계·정렬이 되게), 숫자가 아니면 '비고'에 */
export function workListSheet(rows: SubmissionRowLike[]): { head: string[]; rows: (string | number | null)[][]; widths: number[] } {
  const lines = workGroups(rows).flatMap((g) => g.lines);
  return {
    head: ['번호', '작가', '작품명', '연도', '재료', '크기', '가격(원)', '비고'],
    widths: [6, 14, 36, 8, 30, 18, 14, 16],
    rows: lines.map((l) => [
      l.no, l.guest ? `${l.artist} (비회원)` : l.artist, l.title, l.year, l.medium, l.size,
      l.amount, l.amount == null ? (l.price || '') : '',
    ]),
  };
}

/** 작품 리스트가 실을 그림 — 이미지 받기 전에 셀 수 있게 */
export function workListImages(rows: SubmissionRowLike[]): string[] {
  return rows.flatMap((r) => (r.submission.artworkList ?? []).map((a) => a.image).filter((u): u is string => !!u));
}
