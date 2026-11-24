/**
 * 약력 두 단 — 쪽마다 '왼쪽 단 → 오른쪽 단 → 다음 쪽'으로 흐르게 (2026-11-25, 규칙 92 보강).
 *
 * 왜: pdfmake 의 columns 는 단마다 **따로** 흐르고 단 폭도 끝까지 그대로다. 그래서
 *  - 지원서: 약력(왼쪽 단) 옆에 작품 사진 단을 두었더니 사진이 1쪽에서 끝나도 2~8쪽 내내 글이 반 폭에 갇혔다
 *  - 출품 자료: 갈래를 통째로 단에 나눠 담아(splitIntoColumns) 단체전 120줄처럼 긴 갈래가 있으면 한 단만 이어지고 옆 단이 비었다
 * 그래서 줄 높이를 직접 재서(`Measure` — render.ts 가 문서 글꼴로 잰다) 쪽 단위로 나눈다.
 *  - 쪽이 넘칠 만큼 길면: 이 쪽 왼쪽 단 → 오른쪽 단 → 다음 쪽
 *  - 마지막 쪽(또는 한 쪽에 다 들어가면): 두 단 높이를 반씩(반 근처에 갈래 경계가 있으면 거기서 — 갈래를 안 쪼갠다)
 *  - 남은 게 짧으면(190pt 이하) 나누지 않고 왼쪽 단에 — 아홉 줄짜리 갈래를 두 단으로 쪼개지 않게
 *  - 한 갈래가 단·쪽을 넘어가면 다음 단 맨 위에 '단체전 (계속)'을 다시 쓰고, 연도도 다시 쓴다
 *  - 시작 쪽에 머리 + 한 줄도 안 들어가면 다음 쪽 맨 위에서 시작한다(억지로 넣으면 한 줄만 다음 쪽으로 밀린다)
 * 시작 쪽에 남은 높이(`firstH`)는 render.ts 가 문서를 한 번 미리 배치해 `CV_MARKER` 위치로 잰다(모르면 대강 반 쪽).
 * 추정이 빗나가도 깨지지 않게 표 머리는 headerRows(쪽이 넘어가면 다시 · 머리만 끝에 남지 않음)이고, 쪽은 97%만 채운다.
 */
import type { Content, TableCell } from 'pdfmake/interfaces';
import type { CvEntry } from '@/types';
import { C, FS, NO_LINES } from './layout';
import { txt } from './text';
import type { LayoutProbe, Measure } from './types';

export type { Measure };

/** 미리 배치에서 찾는 표시 — 약력이 시작하는 자리 */
export const CV_MARKER = 'cv-start';
/** 표시 조각(흰 점 1pt) — pdfmake 는 빈 글자 조각을 배치에서 빼므로 보이지 않는 점을 둔다 */
export const cvMarker = (margin: [number, number, number, number] = [0, 0, 0, 0]): Content =>
  ({ text: '.', fontSize: 1, color: '#ffffff', id: CV_MARKER, margin } as Content);

/**
 * 표시 조각 아래로 그 쪽에 남은 높이(pt) — 미리 배치해 잰다. 못 재면 undefined(빌더가 대강 반 쪽으로 본다).
 * 표시가 본문 맨 위 줄기에 있으면 **표시까지만** 배치한다(그 뒤는 위치에 영향이 없다) — 작가노트 30쪽을 매번 배치하지 않게.
 */
export async function remainingBelowMarker(probe: LayoutProbe | undefined, doc: Parameters<LayoutProbe>[0], pageH: number, bottomMargin: number): Promise<number | undefined> {
  if (!probe) return undefined;
  const content = doc.content;
  const at = Array.isArray(content) ? content.findIndex((n) => (n as { id?: string } | null)?.id === CV_MARKER) : -1;
  const head = at >= 0 ? { ...doc, content: (content as unknown[]).slice(0, at + 1) as typeof content } : doc;
  const { top } = await probe(head, CV_MARKER);
  return top == null ? undefined : pageH - bottomMargin - (top + 1 * LINE);
}

/** Pretendard (ascent − descent) / em — pdfmake 한 줄 높이 = 글자 크기 × 이 값 × lineHeight */
export const LINE = 1.1929;
const YEAR_W = 34;
const SEC_TOP = 12;
const ROW_LH = 1.35;
const SHORT = 190;

/** 재는 수단이 없을 때(jsdom 테스트 · 글꼴을 못 받았을 때)의 대강 — 한글 0.93em · 영문·숫자 0.56em · 공백 0.26em */
export const approxMeasure: Measure = (text, size, bold) => {
  let em = 0;
  for (const ch of text) {
    if (/\s/u.test(ch)) em += 0.26;
    else if (/[ᄀ-ᇿ㄰-㆏가-힣一-鿿]/u.test(ch)) em += 0.93;
    else if (/[A-Z]/.test(ch)) em += 0.66;
    else em += 0.56;
  }
  return em * size * (bold ? 1.04 : 1);
};

/** text 가 width 폭에서 몇 줄인지 — 어절(공백까지) 단위로 채운다(text.ts runs 와 같은 끊기) */
export function lineCount(text: string, width: number, size: number, measure: Measure): number {
  let n = 0;
  for (const para of (text || ' ').split('\n')) {
    n += 1;
    let cur = 0;
    for (const tok of para.split(/(?<=\s)/u)) {
      const w = measure(tok, size);
      const wTrim = measure(tok.trimEnd(), size);
      if (cur > 0 && cur + wTrim > width) {
        n += 1;
        cur = w;
      } else cur += w;
      while (cur > width) { // 한 낱말이 한 줄보다 길면 안에서 끊긴다
        n += 1;
        cur -= width;
      }
    }
  }
  return n;
}

export interface CvPart { label: string; items: CvEntry[] }
interface Row { part: number; label: string; year: string; realYear: string; content: string; h: number }
interface Seg { label: string; cont: boolean; rows: Row[] }

const headH = () => SEC_TOP + FS.body * LINE + 1 + 4 + 0.75 + (4 - 0.6);

/**
 * @param o.colW 한 단 폭 · o.gap 단 사이 · o.firstH 시작 쪽에 남은 높이 · o.pageH 다음 쪽부터의 본문 높이
 * @returns 쪽마다 두 단 묶음(columns) — 둘째부터 pageBreak 'before'. 갈래가 다 비었으면 []
 */
export function cvFlow(parts: CvPart[], o: { colW: number; gap: number; firstH: number; pageH: number; measure: Measure; fill?: number }): Content[] {
  const fill = o.fill ?? 0.97;
  const rows: Row[] = [];
  parts.forEach((p, pi) => {
    let prev = '';
    (p.items ?? []).filter((e) => String(e?.content ?? '').trim() || String(e?.year ?? '').trim()).forEach((e) => {
      const y = String(e.year ?? '').trim();
      const content = String(e.content ?? '').trim();
      const h = lineCount(content, o.colW - YEAR_W, FS.small, o.measure) * FS.small * LINE * ROW_LH + 1.2;
      rows.push({ part: pi, label: p.label, year: y && y === prev ? '' : y, realYear: y, content, h });
      if (y) prev = y;
    });
  });
  if (!rows.length) return [];

  let i = 0;
  const started = new Set<number>(); // 이미 머리를 쓴 갈래
  /** 남은 줄을 한 단에 다 쌓았을 때의 높이(갈래가 바뀔 때마다 머리 하나) */
  const restHeight = () => {
    let h = 0;
    let last = -1;
    for (let k = i; k < rows.length; k++) {
      if (rows[k]!.part !== last) { h += headH(); last = rows[k]!.part; }
      h += rows[k]!.h;
    }
    return h;
  };
  /** 반반 나눌 높이 — 반 근처(±25%)에 갈래 경계가 있으면 거기서 나눈다 */
  const splitPoint = (rest: number) => {
    let h = 0;
    let last = -1;
    let best = rest / 2;
    let bestDist = Infinity;
    for (let k = i; k < rows.length; k++) {
      if (rows[k]!.part !== last) {
        if (k > i) {
          const d = Math.abs(h - rest / 2);
          if (d < bestDist) { bestDist = d; best = h; }
        }
        h += headH();
        last = rows[k]!.part;
      }
      h += rows[k]!.h;
    }
    return bestDist <= rest * 0.25 ? best + 0.5 : rest / 2;
  };
  /** target 높이까지 한 단을 채운다. half=true 면 줄의 절반이 target 을 넘으면 멈춘다(반반 맞추기) */
  const take = (target: number, half: boolean): Seg[] => {
    const segs: Seg[] = [];
    let h = 0;
    while (i < rows.length) {
      const r = rows[i]!;
      const cur = segs[segs.length - 1];
      const add = (!cur || cur.label !== r.label ? headH() : 0) + r.h;
      const over = half ? h + add / 2 > target : h + add > target;
      if (over && segs.length) break;
      if (!cur || cur.label !== r.label) {
        segs.push({ label: r.label, cont: started.has(r.part), rows: [] });
        started.add(r.part);
      }
      const seg = segs[segs.length - 1]!;
      seg.rows.push(seg.rows.length === 0 ? { ...r, year: r.realYear } : r); // 단 맨 위 줄은 연도를 다시 쓴다
      h += add;
      i += 1;
    }
    return segs;
  };

  const out: Content[] = [];
  let first = true;
  while (i < rows.length) {
    let cap = (first ? o.firstH : o.pageH) * fill;
    let breakBefore = !first;
    if (first && cap < headH() + rows[i]!.h) { // 시작 쪽에 자리가 없으면 다음 쪽 맨 위에서
      cap = o.pageH * fill;
      breakBefore = true;
    }
    const rest = restHeight();
    let left: Seg[];
    let right: Seg[];
    if (rest <= SHORT && rest <= cap) {
      left = take(cap, false);
      right = [];
    } else if (rest <= cap * 2) {
      const save = i;
      const saveStarted = new Set(started);
      left = take(splitPoint(rest), true);
      right = take(cap, false);
      if (i < rows.length) { // 반반이 안 맞으면(머리 줄이 늘어서) 왼쪽부터 꽉 채운다
        i = save;
        started.clear();
        saveStarted.forEach((x) => started.add(x));
        left = take(cap, false);
        right = take(cap, false);
      }
    } else {
      left = take(cap, false);
      right = take(cap, false);
    }
    out.push({
      columns: [{ width: '*', stack: left.map(segTable) }, { width: '*', stack: right.map(segTable) }],
      columnGap: o.gap,
      ...(breakBefore ? { pageBreak: 'before' } : {}),
    } as Content);
    first = false;
  }
  return out;
}

function segTable(s: Seg): Content {
  const head = s.cont
    ? { text: [{ text: s.label, bold: true }, { text: '  (계속)', bold: false, color: C.sub }], fontSize: FS.body }
    : (txt(s.label, { bold: true, fontSize: FS.body }) as object);
  return {
    table: {
      headerRows: 1,
      keepWithHeaderRows: 1,
      dontBreakRows: true,
      widths: [YEAR_W, '*'],
      body: [
        [{ ...head, colSpan: 2, margin: [0, 0, 0, 1] } as TableCell, {}],
        ...s.rows.map((r) => [
          { text: r.year, fontSize: FS.small, color: C.sub, lineHeight: ROW_LH },
          txt(r.content, { fontSize: FS.small, lineHeight: ROW_LH }),
        ] as TableCell[]),
      ],
    },
    layout: {
      ...NO_LINES,
      hLineWidth: (k: number) => (k === 1 ? 0.75 : 0),
      hLineColor: () => C.rule,
      paddingTop: (k: number) => (k === 1 ? 4 : 0.6),
      paddingBottom: (k: number) => (k === 0 ? 4 : 0.6),
    },
    margin: [0, SEC_TOP, 0, 0],
  } as Content;
}
