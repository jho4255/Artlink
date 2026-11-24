/**
 * 정산서 — 전체 · 현금 · 카드 · 작가별 (2026-11-24, 규칙 92 · 목업 'Settle'·'SettleArtist').
 *
 * 예전 정산서는 판매가 없는 작가도 빈 표를 한 칸씩 차지했고(현금 정산서는 절반이 빈 표), 작가별 합계를 한눈에 볼 표가 없이
 * 합계가 맨 끝에만 있었으며, 발행일·전시 기간·작가가 확인한 날짜가 없었다.
 *  - 전체: 요약 숫자 → 작가별 정산 표(판매 있는 작가만 · 합계 줄 · 작가 확인) → '판매 없음 N명' 한 줄 → 판매 내역
 *  - 작가별: 판매 작품 → 계산 순서(판매 합계 → 카드 수수료 → 정산 대상 → 갤러리 → 작가 지급액) → 확인 기록 · 발행처
 *  - 현금·카드 정산서는 같은 틀에 그 결제수단만(카드 수수료는 카드 정산서에만 — 두 장을 더했을 때 두 번 빠지지 않게)
 *
 * ⚠️ 작가가 받는 [내 정산서](`forArtist`)는 **갤러리 몫 금액 줄을 뺀다** — 화면(`MyArtistSettlementSection`)과 같은 서식 규칙.
 *    정보를 감추는 장치가 아니다(판매 합계·비율이 남으니 뺄셈으로 나온다).
 */
import type { Content, TableCell, TDocumentDefinitions } from 'pdfmake/interfaces';
import { displayName } from '@/lib/utils';
import { cardFeeOf } from '@/lib/settlement';
import type { Settlement, SettlementArtist, SettlementWork } from '@/types';
import { C, FS, baseDoc, docTitle, folio, rowsLayout, statRow } from './layout';
import { runs, txt } from './text';
import { kstDate, kstShortDate, mediumText, num, sizeText, won } from './format';
import type { DocContext, ImgFn } from './types';

export type PayMethod = 'CARD' | 'CASH';

/** 작가가 정산을 확인한 기록 — 서버 정산 응답의 approval(+ respondedAt, 2026-11-24) */
export interface SettlementApprovalInfo {
  status: string;
  autoApproved?: boolean;
  /** 확인(또는 이의)한 시각 */
  respondedAt?: string | null;
}
export type DocSettlementArtist = SettlementArtist & { approval?: SettlementApprovalInfo | null };
export type DocSettlement = Omit<Settlement, 'artists'> & { artists: DocSettlementArtist[] };

const methodLabel = (m?: PayMethod) => (m === 'CASH' ? '현금' : m === 'CARD' ? '카드' : '');
/** '현금으로' · '카드로' — 받침에 따라 조사가 다르다 */
const byMethod = (m: PayMethod) => (m === 'CASH' ? '현금으로' : '카드로');

/**
 * 결제수단(카드/현금)으로 거른 작가 정산 — 합계를 다시 계산한다.
 * 카드 수수료는 **카드 정산서에만** 따라간다(현금 정산서에서 빼면 두 장을 더했을 때 두 번 빠진다).
 */
export function filterArtistByMethod<T extends SettlementArtist>(a: T, method: PayMethod, cardFeeRate = 0): T {
  const works = a.works.filter((w) => w.sold && (w.paymentMethod || 'CARD') === method);
  const total = works.reduce((s, w) => s + (w.soldPrice || 0), 0);
  const cardFee = method === 'CARD' ? cardFeeOf(works.map((w) => ({ ...w, sold: true })), cardFeeRate) : 0;
  const settleBase = total - cardFee;
  const galleryAmount = Math.round(settleBase * a.galleryRatio / 100);
  return {
    ...a, works, total,
    cardTotal: method === 'CARD' ? total : 0,
    cashTotal: method === 'CASH' ? total : 0,
    cardFee, settleBase,
    galleryAmount, artistAmount: settleBase - galleryAmount,
  };
}

export function filterSettlementByMethod(s: DocSettlement, method: PayMethod): DocSettlement {
  const artists = s.artists.map((a) => filterArtistByMethod(a, method, s.cardFeeRate ?? 0));
  return {
    ...s,
    artists,
    grand: {
      total: artists.reduce((sum, a) => sum + a.total, 0),
      cardTotal: artists.reduce((sum, a) => sum + (a.cardTotal ?? 0), 0),
      cashTotal: artists.reduce((sum, a) => sum + (a.cashTotal ?? 0), 0),
      cardFee: artists.reduce((sum, a) => sum + (a.cardFee ?? 0), 0),
      settleBase: artists.reduce((sum, a) => sum + (a.settleBase ?? a.total), 0),
      galleryAmount: artists.reduce((sum, a) => sum + a.galleryAmount, 0),
      artistAmount: artists.reduce((sum, a) => sum + a.artistAmount, 0),
      soldCount: artists.reduce((sum, a) => sum + a.works.filter((w) => w.sold).length, 0),
    },
  };
}

/** 작가 확인 칸 — '4. 9.' · '자동 4. 12.' · '확인 전' · '이의' · '비회원'(확인 요청이 없다, 규칙 91) */
export function approvalCell(a: DocSettlementArtist): string {
  if (a.guest || a.user?.guest) return '비회원';
  const ap = a.approval;
  if (!ap) return '—';
  if (ap.status === 'APPROVED') {
    const d = kstShortDate(ap.respondedAt ?? null);
    return ap.autoApproved ? `자동${d ? ` ${d}` : ''}` : d || '확인';
  }
  if (ap.status === 'ISSUE') return '이의';
  return '확인 전';
}

const soldOf = (a: SettlementArtist) => a.works.filter((w) => w.sold);
const workMeta = (w: SettlementWork) => [mediumText(w.medium), sizeText(w.size), String(w.year ?? '').trim()].filter(Boolean).join(' · ');
const payText = (w: SettlementWork) => (w.paymentMethod === 'CASH' ? '현금' : '카드');
const mid = { verticalAlignment: 'middle' as const };

/** 작품 칸 — 제목 + 재료·크기·연도 한 줄 */
function workCell(w: SettlementWork): TableCell {
  const meta = workMeta(w);
  return {
    stack: [
      txt(String(w.title ?? '').trim() || '(제목 없음)', { fontSize: FS.small }),
      ...(meta ? [txt(meta, { fontSize: FS.tiny, color: C.sub, margin: [0, 1, 0, 0] })] : []),
    ],
    ...mid,
  } as TableCell;
}

function titleFor(method?: PayMethod): { sub: string; label: string } {
  return method ? { sub: methodLabel(method), label: `정산서(${methodLabel(method)})` } : { sub: '전체', label: '정산서(전체)' };
}

/** 전체 정산서(현금·카드 정산서도 같은 틀) */
export function buildSettlementDoc(ctx: DocContext, s: DocSettlement, method: PayMethod | undefined, img: ImgFn): TDocumentDefinitions {
  const t = method ? filterSettlementByMethod(s, method) : s;
  const { sub, label } = titleFor(method);
  const sold = t.artists.filter((a) => soldOf(a).length > 0);
  const none = t.artists.filter((a) => soldOf(a).length === 0);
  const g = t.grand;
  const fee = g.cardFee ?? 0;
  const rate = t.cardFeeRate ?? 0;
  const content: Content[] = [];

  content.push(docTitle(ctx.exTitle, '정산서', [ctx.issuer, ctx.period ? `전시 ${ctx.period}` : '', `발행 ${ctx.issued}`], sub));
  content.push(statRow([['판매', `${g.soldCount}점`], ['판매 합계', won(g.total)], ['갤러리', won(g.galleryAmount)], ['작가 지급', won(g.artistAmount)]]));
  const payLine = method === 'CASH'
    ? `현금 판매 ${won(g.total)}`
    : method === 'CARD'
      ? [`카드 판매 ${won(g.total)}`, fee > 0 ? `카드 수수료 ${rate}% −${won(fee)}` : ''].filter(Boolean).join(' · ')
      : [`카드 판매 ${won(g.cardTotal ?? 0)}`, `현금 판매 ${won(g.cashTotal ?? 0)}`, fee > 0 ? `카드 수수료 ${rate}% −${won(fee)}` : ''].filter(Boolean).join(' · ');
  content.push({ text: payLine, fontSize: FS.small, color: C.sub, margin: [0, 6, 0, 0] });

  // ── 작가별 정산 ──
  content.push({ text: '작가별 정산', bold: true, fontSize: 10.5, margin: [0, 20, 0, 6] });
  const hd = (x: string, left = false) => ({ text: x, fontSize: FS.tiny, color: C.sub, alignment: left ? 'left' : 'right' });
  const showFee = sold.some((a) => (a.cardFee ?? 0) > 0);
  const widths: (number | string)[] = ['*', 26, 62, ...(showFee ? [54] : []), 40, 60, 64, 50];
  const row = (cells: TableCell[]) => cells;
  const body: TableCell[][] = [row([
    hd('작가', true), hd('판매'), hd('판매 합계'), ...(showFee ? [hd('카드 수수료')] : []), hd('비율'), hd('갤러리'), hd('작가 지급'), hd('작가 확인'),
  ] as TableCell[])];
  for (const a of sold) {
    const n = (v: string, extra: object = {}) => ({ text: v, fontSize: FS.small, alignment: 'right', ...extra });
    body.push(row([
      { text: [...runs(displayName(a.user), { bold: true }), ...(a.guest ? [{ text: ' 비회원', fontSize: FS.tiny, color: C.muted, bold: false }] : [])], fontSize: FS.small, bold: true },
      n(String(soldOf(a).length)), n(num(a.total)), ...(showFee ? [n((a.cardFee ?? 0) > 0 ? `−${num(a.cardFee ?? 0)}` : '—', { color: C.sub })] : []),
      n(`${a.galleryRatio} : ${a.artistRatio}`, { color: C.sub }), n(num(a.galleryAmount)), n(num(a.artistAmount), { bold: true }),
      n(approvalCell(a), { color: C.sub }),
    ] as TableCell[]));
  }
  if (sold.length) {
    const tot = (v: string) => ({ text: v, fontSize: FS.small, bold: true, alignment: 'right' });
    body.push(row([
      { text: '합계', fontSize: FS.small, bold: true }, tot(String(g.soldCount)), tot(num(g.total)), ...(showFee ? [tot(fee > 0 ? `−${num(fee)}` : '—')] : []),
      { text: '' }, tot(num(g.galleryAmount)), tot(num(g.artistAmount)), { text: '' },
    ] as TableCell[]));
  }
  if (sold.length) {
    content.push({
      table: { headerRows: 1, dontBreakRows: true, widths, body },
      layout: {
        ...rowsLayout({ padY: 5 }),
        hLineWidth: (i: number, node: { table: { body: unknown[] } }) => (i === 0 ? 0 : i === 1 ? 0.75 : i === node.table.body.length - 1 ? 0.75 : i === node.table.body.length ? 0 : 0.5),
        hLineColor: (i: number, node: { table: { body: unknown[] } }) => (i === 1 || i === node.table.body.length - 1 ? C.ink : C.hair),
      },
    } as Content);
  } else {
    content.push({ text: method ? `${byMethod(method)} 판매된 작품이 없어요.` : '판매된 작품이 없어요.', color: C.muted, fontSize: FS.small });
  }
  if (none.length && sold.length) {
    const names = none.map((a) => (a.guest ? `${displayName(a.user)}(비회원)` : displayName(a.user))).join(' · ');
    content.push({ text: runs(`판매 없음 ${none.length}명 — ${names}`) as never, fontSize: FS.small, color: C.sub, margin: [0, 6, 0, 0] });
  }

  // ── 판매 내역 ──
  if (sold.length) {
    content.push({ text: '판매 내역', bold: true, fontSize: 10.5, margin: [0, 22, 0, 6] });
    const sbody: TableCell[][] = [[hd('작가', true), hd(''), hd('작품', true), hd('결제', true), hd('판매가')] as TableCell[]];
    for (const a of sold) {
      soldOf(a).forEach((w, i) => {
        const src = img(w.image, 'thumb');
        sbody.push([
          // 같은 작가의 둘째 줄부터는 이름을 흐리게 — 쪽이 넘어가도 맨 위 작품이 누구 것인지 보이게
          i === 0
            ? { text: runs(displayName(a.user), { bold: true }) as never, fontSize: FS.small, bold: true, ...mid }
            : { text: runs(displayName(a.user)) as never, fontSize: FS.tiny, color: C.muted, ...mid },
          src ? { image: src, fit: [27, 27], alignment: 'center', ...mid } : { text: '', ...mid },
          workCell(w),
          { text: payText(w), fontSize: FS.small, color: '#333333', ...mid },
          { text: won(w.soldPrice), fontSize: FS.small, alignment: 'right', ...mid },
        ] as TableCell[]);
      });
    }
    content.push({ table: { headerRows: 1, dontBreakRows: true, widths: [62, 33, '*', 34, 74], body: sbody }, layout: rowsLayout({ padY: 4 }) } as Content);
  }

  return baseDoc(`${ctx.exTitle} ${label}`, {
    footer: (page: number, count: number) => folio(`${label} · ${ctx.exTitle}`, page, count),
    content,
  });
}

/**
 * 작가 한 사람의 정산서(현금·카드도 같은 틀).
 * @param forArtist 작가가 받는 [내 정산서] — 갤러리 몫 금액 줄을 뺀다
 */
export function buildArtistSettlementDoc(
  ctx: DocContext, artist: DocSettlementArtist, method: PayMethod | undefined,
  opts: { forArtist?: boolean; cardFeeRate?: number }, img: ImgFn,
): TDocumentDefinitions {
  const rate = opts.cardFeeRate ?? 0;
  const a = method ? filterArtistByMethod(artist, method, rate) : artist;
  const name = displayName(a.user);
  const sold = soldOf(a);
  const fee = a.cardFee ?? 0;
  const base = a.settleBase ?? a.total;
  const label = method ? `정산서(${methodLabel(method)})` : '정산서';
  const content: Content[] = [];

  content.push(docTitle(ctx.exTitle, '정산서', [ctx.issuer, ctx.period ? `전시 ${ctx.period}` : '', `발행 ${ctx.issued}`], method ? methodLabel(method) : undefined));
  content.push({
    margin: [0, 16, 0, 0],
    table: {
      widths: ['*', 'auto'],
      body: [[
        { text: [...runs(name, { bold: true }), { text: '  작가님', fontSize: 10.5, bold: false, color: C.sub }], fontSize: 15, bold: true },
        { text: `판매 ${sold.length}점 · 정산 비율 갤러리 ${a.galleryRatio} : 작가 ${a.artistRatio}`, fontSize: FS.small, color: C.sub, alignment: 'right', margin: [0, 4, 0, 0] },
      ]],
    },
    layout: {
      hLineWidth: (i: number) => (i === 0 ? 1.5 : 0.75), hLineColor: (i: number) => (i === 0 ? C.ink : C.rule), vLineWidth: () => 0,
      paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 10, paddingBottom: () => 12,
    },
  } as Content);

  content.push({ text: '판매 작품', bold: true, fontSize: 10.5, margin: [0, 20, 0, 6] });
  if (sold.length) {
    const hd = (x: string, left = false) => ({ text: x, fontSize: FS.tiny, color: C.sub, alignment: left ? 'left' : 'right' });
    content.push({
      table: {
        headerRows: 1, dontBreakRows: true, widths: [48, '*', 40, 84],
        body: [
          [hd(''), hd('작품', true), hd('결제', true), hd('판매가')],
          ...sold.map((w) => {
            const src = img(w.image, 'thumb');
            return [
              src ? { image: src, fit: [45, 45], alignment: 'center', ...mid } : { text: '', ...mid },
              workCell(w),
              { text: payText(w), fontSize: FS.small, color: '#333333', ...mid },
              { text: won(w.soldPrice), fontSize: FS.small, alignment: 'right', ...mid },
            ] as TableCell[];
          }),
        ],
      },
      layout: rowsLayout({ padY: 5 }),
    } as Content);
  } else {
    content.push({ text: method ? `${byMethod(method)} 판매된 작품이 없어요.` : '판매된 작품이 없어요.', color: C.muted, fontSize: FS.small });
  }

  // ── 계산 순서 ──
  const line = (k: string | object, v: string, opt: { strong?: boolean } = {}): TableCell[] => [
    typeof k === 'string' ? { text: k, fontSize: FS.body, bold: !!opt.strong } : (k as TableCell),
    { text: v, fontSize: opt.strong ? 18 : FS.body, bold: !!opt.strong, alignment: 'right' },
  ];
  const calc: TableCell[][] = [line('판매 합계', won(a.total))];
  if (fee > 0) {
    calc.push(line({ text: [{ text: '카드 수수료' }, { text: `  카드 판매 ${won(a.cardTotal ?? 0)} × ${rate}%`, fontSize: FS.tiny, color: C.sub }], fontSize: FS.body }, `−${won(fee)}`));
    calc.push(line('정산 대상', won(base)));
  }
  if (!opts.forArtist) calc.push(line({ text: [{ text: '갤러리' }, { text: `  ${a.galleryRatio}%`, fontSize: FS.tiny, color: C.sub }], fontSize: FS.body }, `−${won(a.galleryAmount)}`));
  calc.push(line({ text: [{ text: '작가 지급액', bold: true }, { text: `  ${a.artistRatio}%`, fontSize: FS.tiny, color: C.sub, bold: false }], fontSize: FS.body }, won(a.artistAmount), { strong: true }));
  content.push({
    margin: [0, 22, 0, 0],
    columns: [{ width: '*', text: '' }, {
      width: 300,
      table: { widths: ['*', 'auto'], body: calc },
      layout: {
        hLineWidth: (i: number, node: { table: { body: unknown[] } }) => (i === 0 || i === node.table.body.length ? 0 : i === node.table.body.length - 1 ? 0.75 : 0.5),
        hLineColor: (i: number, node: { table: { body: unknown[] } }) => (i === node.table.body.length - 1 ? C.ink : C.hair),
        vLineWidth: () => 0, paddingLeft: () => 0, paddingRight: () => 0,
        paddingTop: (i: number, node: { table: { body: unknown[] } }) => (i === node.table.body.length - 1 ? 10 : 6),
        paddingBottom: () => 6,
      },
    }],
  } as Content);

  // ── 확인 기록 · 발행처 ──
  const ap = a.approval;
  const isGuest = a.guest || a.user?.guest;
  const confirm = isGuest ? ''
    : ap?.status === 'APPROVED'
      ? (ap.autoApproved
        ? `${kstDate(ap.respondedAt ?? null)} 확인 기한이 지나 자동으로 확인되었습니다.`.trim()
        : `${kstDate(ap.respondedAt ?? null)} 작가가 이 금액을 확인했습니다.`.trim())
      : ap?.status === 'ISSUE' ? '작가가 이의를 남긴 금액입니다.' : ap ? '작가 확인 전인 금액입니다.' : '';
  const foot = [confirm, [ctx.issuer, ctx.contact].filter(Boolean).join(' · ')].filter(Boolean);
  if (foot.length) {
    content.push({
      margin: [0, 34, 0, 0],
      stack: [
        { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 511.28, y2: 0, lineWidth: 0.75, lineColor: C.rule }] },
        ...foot.map((l, i) => txt(l, { fontSize: FS.small, color: C.sub, margin: [0, i ? 2 : 9, 0, 0] })),
      ],
      unbreakable: true,
    } as Content);
  }

  return baseDoc(`${ctx.exTitle} ${name} ${label}`, {
    footer: (page: number, count: number) => folio(`${label} · ${name} · ${ctx.exTitle}`, page, count),
    content,
  });
}

/** 정산서가 실을 판매작 그림 */
export function settlementImages(artists: SettlementArtist[]): string[] {
  return artists.flatMap((a) => a.works.filter((w) => w.sold).map((w) => w.image)).filter((u): u is string => !!u);
}
