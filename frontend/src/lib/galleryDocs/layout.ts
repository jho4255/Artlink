/**
 * 갤러리 결과물 PDF 의 공통 틀 (2026-11-24, 규칙 92) — A4 · 여백 · 머리말 · 꼬리말 · 줄 · 표 모양.
 * 디자인은 목업(https://claude.ai/artifact/Btx9WUtbhETceu3D4CZ9gp)을 pt 로 옮긴 것이다(1px = 0.75pt).
 * 색은 흑백 + 회색 단계뿐 — 강조색을 쓰지 않는다(문서가 인쇄·복사돼 오간다).
 */
import type { Content, ContentTable, CustomTableLayout, TDocumentDefinitions } from 'pdfmake/interfaces';
import { FONT, txt } from './text';

export const C = {
  ink: '#111111',
  body: '#1a1a1a',
  sub: '#555555',
  muted: '#767676',
  rule: '#cfcfcf',
  hair: '#e6e6e6',
};

/** A4 (pt) */
export const PAGE = { w: 595.28, h: 841.89 };
/** 좌우 여백 56px */
export const MX = 42;
/** 본문 폭 */
export const CW = PAGE.w - MX * 2;

/** 글자 크기(pt) — 목업의 px × 0.75 */
export const FS = {
  tiny: 9, // 12px — 머리말·꼬리말·표 머리
  small: 9.4, // 12.5px — 표 본문
  body: 9.75, // 13px
  text: 10.5, // 14px — 읽는 글(작가노트)
  h3: 10.9, // 14.5px
  h2: 16.5, // 22px
  title: 21, // 28px
  name: 30, // 40px
};

/** 가로줄 한 줄 */
export function hr(opts: { width?: number; color?: string; thick?: number; margin?: [number, number, number, number] } = {}): Content {
  const { width = CW, color = C.rule, thick = 0.75, margin = [0, 0, 0, 0] } = opts;
  return { canvas: [{ type: 'line', x1: 0, y1: 0, x2: width, y2: 0, lineWidth: thick, lineColor: color }], margin } as Content;
}

/** 머리말 — 왼쪽 전시명 · 오른쪽 문서 이름, 아래 가는 줄 (목업의 '작가 자료' 머리줄) */
export function runningHead(left: string, right: string): Content {
  return {
    margin: [MX, 25, MX, 0],
    stack: [
      { columns: [txt(left, { fontSize: FS.tiny, color: C.muted }), txt(right, { fontSize: FS.tiny, color: C.muted, alignment: 'right', width: 'auto' })], columnGap: 12 },
      hr({ margin: [0, 6, 0, 0] }),
    ],
  } as Content;
}

/** 꼬리말 — 왼쪽 문서 이름 · 오른쪽 'n / N' */
export function folio(label: string, page: number, count: number): Content {
  return {
    margin: [MX, 8, MX, 0],
    columns: [
      txt(label, { fontSize: FS.tiny, color: C.muted }),
      { text: `${page} / ${count}`, fontSize: FS.tiny, color: C.muted, alignment: 'right', width: 'auto' },
    ],
    columnGap: 12,
  } as Content;
}

/** 기본 문서 정의 */
export function baseDoc(title: string, extra: Partial<TDocumentDefinitions> = {}): TDocumentDefinitions {
  return {
    pageSize: 'A4',
    pageMargins: [MX, 56, MX, 46],
    info: { title, creator: 'ArtLink', producer: 'ArtLink' },
    defaultStyle: { font: FONT, fontSize: FS.body, lineHeight: 1.3, color: C.ink },
    content: [],
    ...extra,
  };
}

/**
 * 표 모양 — 가로줄만. 머리 줄 아래 검정 1px, 행 사이 연회색, 위 테두리는 없다.
 * `headTop` 이면 표 맨 위에 검정 2px(요약 줄처럼 시작하는 표).
 */
export function rowsLayout(opts: { headRows?: number; headTop?: boolean; padY?: number; padX?: number } = {}): CustomTableLayout {
  const { headRows = 1, headTop = false, padY = 5, padX = 4 } = opts;
  return {
    hLineWidth: (i: number, node: ContentTable) => {
      if (i === 0) return headTop ? 1.5 : 0;
      if (i === headRows && headRows > 0) return 0.75;
      if (i === node.table.body.length) return 0.75;
      return 0.5;
    },
    hLineColor: (i: number, node: ContentTable) => (i === headRows && headRows > 0) || i === 0 ? C.ink : i === node.table.body.length ? C.rule : C.hair,
    vLineWidth: () => 0,
    paddingLeft: (i: number) => (i === 0 ? 0 : padX),
    paddingRight: (i: number, node: ContentTable) => (i === (node.table.widths?.length ?? 1) - 1 ? 0 : padX),
    paddingTop: () => padY,
    paddingBottom: () => padY,
  } as CustomTableLayout;
}

/** 줄 없는 표(배치용) */
export const NO_LINES: CustomTableLayout = {
  hLineWidth: () => 0,
  vLineWidth: () => 0,
  paddingLeft: () => 0,
  paddingRight: () => 0,
  paddingTop: () => 0,
  paddingBottom: () => 0,
};

/**
 * 요약 숫자 한 줄 — '작가 10명 · 작품 90점 …' 을 위 검정 2px · 아래 회색 1px 사이에 칸으로.
 * @param items [이름, 값] 목록
 */
export function statRow(items: [string, string][]): Content {
  return {
    margin: [0, 16, 0, 0],
    table: {
      widths: items.map(() => '*'),
      body: [items.map(([k, v]) => ({
        stack: [
          txt(k, { fontSize: FS.tiny, color: C.sub }),
          txt(v, { fontSize: 12.75, bold: true, margin: [0, 1, 0, 0] }),
        ],
      }))],
    },
    layout: {
      hLineWidth: (i: number) => (i === 0 ? 1.5 : 0.75),
      hLineColor: (i: number) => (i === 0 ? C.ink : C.rule),
      vLineWidth: () => 0,
      paddingLeft: (i: number) => (i === 0 ? 0 : 6),
      paddingRight: () => 6,
      paddingTop: () => 7,
      paddingBottom: () => 9,
    },
  } as Content;
}

/** 머리 — 왼쪽 위에 전시명(작게) · 문서 제목(크게), 오른쪽 위에 발행 정보 줄들 */
export function docTitle(exTitle: string, title: string, rightLines: string[], sub?: string): Content {
  return {
    columns: [
      {
        width: '*',
        stack: [
          txt(exTitle, { fontSize: FS.body, color: C.sub }),
          {
            text: [
              ...((txt(title, { bold: true }) as { text: unknown[] }).text as never[]),
              ...(sub ? [{ text: `  ${sub}`, fontSize: 11.25, bold: false, color: C.sub }] : []),
            ],
            fontSize: FS.title,
            bold: true,
            margin: [0, 3, 0, 0],
            lineHeight: 1.15,
          },
        ],
      },
      {
        width: 'auto',
        stack: rightLines.filter(Boolean).map((l, i) => txt(l, { fontSize: FS.small, color: i === 0 ? C.ink : C.sub, bold: i === 0, alignment: 'right', lineHeight: 1.45 })),
      },
    ],
    columnGap: 18,
  } as Content;
}
