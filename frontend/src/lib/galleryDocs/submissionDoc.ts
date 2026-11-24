/**
 * 출품 자료 — 작가 한 사람의 출품 자료를 한 파일로 (2026-11-24, 규칙 92 · 목업 'ArtistProfile'·'ArtistNote').
 * 예전엔 작가마다 PDF 세 개(출품리스트 · 작가약력 · 작가노트)였고, 쪽이 넘어가는 자리에서 글자 줄이 반으로 잘렸다.
 *
 *  1쪽  이름 · 연락처 · 대표작  +  약력(2단으로 흐른다 · 같은 해는 연도를 한 번만)
 *  다음 작가노트(본문 폭) + 작품별 설명(그 작품 사진 옆에서 시작해 사진 아래 본문 폭으로 잇는다)
 *  다음 출품 작품 표(전시 전체 번호 · 2쪽부터 표 머리가 다시 나온다)
 *  모든 쪽에 머리말(전시명 | 출품 자료) · 꼬리말(작가 이름 · 쪽 번호)
 *
 * 2026-11-25 빈 단 정리: 약력은 쪽마다 왼쪽 → 오른쪽으로 흐르고(cvFlow — 긴 갈래가 한 단만 이어지며 옆 단이 비던 것),
 * 작가노트는 왼쪽 이름표 칸(112pt, 쪽마다 비었다) 대신 머리를 위에, 작품별 설명은 사진을 180pt 로 키우고 넘치는 글을 사진 아래로.
 * 줄 높이는 `opts.measure`(render 가 문서 글꼴로 잰다)로 계산한다 — 없으면 대강(approxMeasure).
 *
 * ⚠️ 문서 이름은 '출품 자료' — '작가 자료'·'제출 자료'라고 부르지 말 것(규칙 59 의 용어 통일. 목업엔 '작가 자료'라 적었었다).
 */
import type { Content, TableCell, TDocumentDefinitions } from 'pdfmake/interfaces';
import { CV_SECTIONS } from '@/lib/submissionChecklist';
import type { ArtworkItem, CvEntry } from '@/types';
import { C, CW, FS, NO_LINES, PAGE, baseDoc, folio, hr, rowsLayout, runningHead } from './layout';
import { keepLastTwo, paragraphs, runs, txt } from './text';
import { LINE, approxMeasure, cvFlow, cvMarker, lineCount, remainingBelowMarker } from './cvFlow';
import { docArtistName, mediumText, priceText, sizeText } from './format';
import type { DimsFn, DocTools, ImgFn, Measure, SubmissionRowLike } from './types';

export const SUBMISSION_DOC_LABEL = '출품 자료';

/** 출품 자료 쪽 여백(위·아래) — 약력 두 단의 쪽 높이 계산에 쓴다 */
export const SUB_MARGIN = { top: 60, bottom: 46 };
/** 작품별 설명의 사진 칸(예전 112pt) */
const SECTION_PHOTO = 180;
const SECTION_GAP = 16;

/** 같은 해가 이어지면 연도는 처음 한 번만 — 화면 약력과 같은 읽기 */
export function dedupeYears(items: CvEntry[]): { year: string; content: string }[] {
  let prev = '';
  return items
    .filter((e) => String(e?.content ?? '').trim() || String(e?.year ?? '').trim())
    .map((e) => {
      const y = String(e.year ?? '').trim();
      const show = y && y === prev ? '' : y;
      if (y) prev = y;
      return { year: show, content: String(e.content ?? '').trim() };
    });
}

/** 약력 한 갈래(개인전 …) — 머리 줄을 headerRows 로 두어 단·쪽이 넘어가면 다시 나오고, 머리만 끝에 남지 않는다(지원서도 쓴다) */
export function cvSection(label: string, items: CvEntry[]): Content | null {
  const rows = dedupeYears(items);
  if (rows.length === 0) return null;
  return {
    table: {
      headerRows: 1,
      keepWithHeaderRows: 1,
      dontBreakRows: true,
      widths: [34, '*'],
      body: [
        [{ ...(txt(label, { bold: true, fontSize: FS.body }) as object), colSpan: 2, margin: [0, 0, 0, 1] } as TableCell, {}],
        ...rows.map((r) => [
          { text: r.year, fontSize: FS.small, color: C.sub, lineHeight: 1.35 },
          txt(r.content, { fontSize: FS.small, lineHeight: 1.35 }),
        ] as TableCell[]),
      ],
    },
    layout: {
      ...NO_LINES,
      hLineWidth: (i: number) => (i === 1 ? 0.75 : 0),
      hLineColor: () => C.rule,
      paddingTop: (i: number) => (i === 1 ? 4 : 0.6),
      paddingBottom: (i: number) => (i === 0 ? 4 : 0.6),
    },
    margin: [0, 12, 0, 0],
  } as Content;
}

/** 작품의 대표작 — 작가가 고른 것, 없으면 첫 작품 */
function representative(list: ArtworkItem[], idx: number | null | undefined): ArtworkItem | null {
  if (list.length === 0) return null;
  return list[idx ?? 0] ?? list[0] ?? null;
}

/** '작품명, 연도' — 연도는 보통 굵기 */
function titleYear(a: Pick<ArtworkItem, 'title' | 'year'>, size: number): Content {
  const t = String(a.title ?? '').trim() || '(제목 없음)';
  const y = String(a.year ?? '').trim();
  return { text: [...runs(t, { bold: true }), ...(y ? [{ text: `, ${y}`, bold: false }] : [])], bold: true, fontSize: size, lineHeight: 1.3 } as Content;
}

/**
 * @param numberOf 전시 전체 작품 번호(format.ts numberWorks) — 작품 리스트·원본 파일 이름과 같은 번호
 */
/** 글을 width 폭에서 maxH 높이까지 담을 만큼 앞에서 자른다 — 되도록 문장 끝에서. [앞, 뒤] */
export function splitToFit(text: string, width: number, maxH: number, size: number, lh: number, measure: Measure): [string, string] {
  const tokens = text.split(/(?<=\s)/u);
  const maxLines = Math.floor(maxH / (size * LINE * lh));
  if (maxLines <= 0) return ['', text];
  let lines = 1;
  let cur = 0;
  let cut = tokens.length;
  for (let k = 0; k < tokens.length; k++) {
    const w = measure(tokens[k]!, size);
    const wTrim = measure(tokens[k]!.trimEnd(), size);
    if (cur > 0 && cur + wTrim > width) { lines += 1; cur = w; } else cur += w;
    if (lines > maxLines) { cut = k; break; }
  }
  if (cut >= tokens.length) return [text, ''];
  // 문장 끝(. ? ! …)에서 자를 수 있으면 거기서 — 허용 범위의 절반보다 뒤쪽일 때만
  let at = cut;
  for (let k = cut - 1; k >= Math.floor(cut / 2); k--) if (/[.?!…]\s*$/u.test(tokens[k]!)) { at = k + 1; break; }
  return [tokens.slice(0, at).join('').trimEnd(), tokens.slice(at).join('').trimStart()];
}

export interface SubmissionDocOpts {
  /** 글자 폭 재기(약력 두 단 · 사진 옆 글) — 없으면 대강 */
  measure?: Measure;
  /** 약력이 시작하는 쪽에 남은 높이(pt) — 미리 배치해 CV_MARKER 로 잰다. 없으면 반 쪽으로 본다 */
  cvStart?: number;
  /** 그림 크기(px) — 작품별 설명 사진 칸을 실제 비율로. 모르면 정사각 칸 */
  dims?: DimsFn;
}

/**
 * 출품 자료 한 장 — 약력이 시작하는 쪽에 남은 높이를 미리 배치로 재서 다시 짠다(probe 가 없으면 대강).
 * ⚠️ 미리 배치한 정의는 버리고 새로 짠다 — pdfmake 는 받은 정의를 고쳐 쓴다.
 */
export async function composeSubmissionDoc(exTitle: string, row: SubmissionRowLike, numberOf: (userId: number, index: number) => number, t: DocTools): Promise<TDocumentDefinitions> {
  const base = { measure: t.measure, dims: t.dims };
  const cv = row.submission.cv;
  if (!t.probe || !CV_SECTIONS.some(({ key }) => (cv?.[key] ?? []).length)) return buildSubmissionDoc(exTitle, row, numberOf, t.img, base);
  const cvStart = await remainingBelowMarker(t.probe, buildSubmissionDoc(exTitle, row, numberOf, t.img, base), PAGE.h, SUB_MARGIN.bottom);
  return buildSubmissionDoc(exTitle, row, numberOf, t.img, { ...base, cvStart });
}

export function buildSubmissionDoc(exTitle: string, row: SubmissionRowLike, numberOf: (userId: number, index: number) => number, img: ImgFn, opts: SubmissionDocOpts = {}): TDocumentDefinitions {
  const measure = opts.measure ?? approxMeasure;
  const sub = row.submission;
  const cv = sub.cv;
  const list = sub.artworkList ?? [];
  const name = docArtistName(row.user, cv);
  const statement = paragraphs(sub.note?.statement);
  const sections = (sub.note?.sections ?? []).filter((s) => String(s?.title ?? '').trim() || String(s?.body ?? '').trim());
  const cvParts = CV_SECTIONS.map(({ key, label }) => ({ block: cvSection(label, cv?.[key] ?? []), rows: dedupeYears(cv?.[key] ?? []).length }))
    .filter((p): p is { block: Content; rows: number } => !!p.block);
  const cvBlocks = cvParts.map((p) => p.block);
  const rep = representative(list, sub.representativeIndex);
  const repSrc = rep ? img(rep.image, 'mid') : null;
  const footLabel = `${name} · ${SUBMISSION_DOC_LABEL}`;
  const content: Content[] = [];

  // ── 1쪽: 이름 · 연락처 · 대표작 ──
  const contact = [cv?.tel, cv?.email || (row.guest ? '' : row.user.email)].map((v) => String(v ?? '').trim()).filter(Boolean).join(' · ');
  const meta = [`출품 ${list.length}점`, row.guest ? '비회원 작가 · 갤러리가 입력' : ''].filter(Boolean).join(' · ');
  content.push({
    columns: [
      {
        width: '*',
        stack: [
          txt(name, { fontSize: FS.name, bold: true, lineHeight: 1.1, characterSpacing: 0.6 }),
          ...(cv?.nameEn?.trim() ? [txt(cv.nameEn, { fontSize: 11.25, color: C.sub, margin: [0, 3, 0, 0] })] : []),
          ...(cv?.birth?.trim() ? [txt(cv.birth, { fontSize: FS.body, color: C.sub, margin: [0, 2, 0, 0] })] : []),
          ...(contact ? [txt(contact, { fontSize: FS.body, color: C.sub, margin: [0, 10, 0, 0] })] : []),
          txt(meta, { fontSize: FS.body, color: C.sub, margin: [0, contact ? 2 : 10, 0, 0] }),
        ],
      },
      ...(repSrc && rep ? [{
        width: 172,
        stack: [
          { image: repSrc, fit: [172, 126], alignment: 'right' },
          { ...(txt(`대표작 · ${String(rep.title ?? '').trim() || '(제목 없음)'}${rep.year ? `, ${rep.year}` : ''}`, { fontSize: FS.tiny, color: C.sub, alignment: 'right' }) as object), margin: [0, 6, 0, 0] },
        ],
      } as Content] : []),
    ],
    columnGap: 24,
  } as Content);

  // ── 약력 — 두 단, 쪽마다 왼쪽 → 오른쪽으로 흐른다(cvFlow). 긴 갈래는 두 단에 걸쳐 '(계속)'으로 잇는다 — 한쪽 단만 남지 않게 ──
  //    예전(lib/careerColumns 로 갈래째 나누기)은 단체전 120줄 같은 긴 갈래가 있으면 그 단만 쪽을 넘어 이어지고 옆 단이 비었다
  content.push(hr({ color: C.ink, thick: 1.5, margin: [0, 20, 0, 0] }));
  if (cvParts.length) {
    content.push(cvMarker());
    const pageH = PAGE.h - SUB_MARGIN.top - SUB_MARGIN.bottom;
    content.push(...cvFlow(CV_SECTIONS.map(({ key, label }) => ({ label, items: cv?.[key] ?? [] })),
      { colW: (CW - 30) / 2, gap: 30, firstH: opts.cvStart ?? pageH / 2, pageH, measure }));
  } else {
    content.push({ text: '약력이 비어 있어요.', color: C.muted, margin: [0, 12, 0, 0] });
  }

  // ── 작가노트 · 작품별 설명 ──
  if (statement.length || sections.length) {
    content.push({ ...(txt(name, { fontSize: FS.h2, bold: true }) as object), pageBreak: 'before', margin: [0, 4, 0, 0] } as Content);
    if (statement.length) {
      content.push(hr({ color: C.ink, thick: 1.5, margin: [0, 14, 0, 12] }));
      // 머리는 위에, 글은 본문 폭 전체로 — 예전엔 왼쪽 112pt 이름표 칸이 쪽마다 비어 있었다
      content.push({ text: '작가노트', bold: true, fontSize: FS.body, margin: [0, 0, 0, 8] });
      statement.forEach((p, i) => content.push(keepLastTwo(txt(p, { fontSize: FS.text, lineHeight: 1.75, alignment: 'justify', color: C.body, margin: [0, i ? 8 : 0, 0, 0] }))));
    }
    if (sections.length) {
      // 머리(줄 + '작품별 설명')는 첫 설명과 한 덩어리 — 따로 두면 첫 설명이 다음 쪽으로 넘어갈 때 머리만 쪽 끝에 남는다
      const heading: Content[] = [
        hr({ color: C.ink, thick: 0.75, margin: [0, statement.length ? 26 : 14, 0, 10] }),
        { text: '작품별 설명', bold: true, fontSize: FS.body, margin: [0, 0, 0, 12] },
      ];
      sections.forEach((s, i) => {
        const work = list.find((a) => String(a.title ?? '').trim() && String(a.title ?? '').trim() === String(s.title ?? '').trim());
        const src = work ? img(work.image, 'mid') : null;
        const metaLine = work ? [mediumText(work.medium), sizeText(work.size)].filter(Boolean).join(' · ') : '';
        const body = paragraphs(s.body);
        // 사진(180pt — 예전 112pt 보다 크게) 옆을 제목·설명으로 채우고, 넘치는 설명은 사진 아래 본문 폭 전체로 잇는다.
        // 예전: 사진 칸 옆 좁은 단에 설명 전체 → 길면 다음 쪽부터 사진 칸 자리가 비었다.
        const dm = work?.image ? opts.dims?.(work.image) : null;
        const sc = dm && dm.w > 0 && dm.h > 0 ? Math.min(SECTION_PHOTO / dm.w, SECTION_PHOTO / dm.h) : 0;
        const pw = src ? (sc ? dm!.w * sc : SECTION_PHOTO) : 0;
        const ph = src ? (sc ? dm!.h * sc : SECTION_PHOTO) : 0;
        const sideW = src ? CW - pw - SECTION_GAP : CW;
        const titleLine = String(s.title || work?.title || '').trim() + (work?.year ? `, ${work.year}` : '');
        const titleH = lineCount(titleLine, sideW, FS.h3, measure) * FS.h3 * LINE * 1.3
          + (metaLine ? lineCount(metaLine, sideW, FS.small, measure) * FS.small * LINE + 1 : 0);
        const plain = (t: string, top: number) => txt(t, { fontSize: FS.text, lineHeight: 1.75, alignment: 'justify', color: C.body, margin: [0, top, 0, 0] });
        const para = (t: string, top: number) => keepLastTwo(plain(t, top));
        const beside: Content[] = [];
        const below: Content[] = [];
        let room = src ? ph - titleH : 0; // 사진 옆에 남은 높이(사진이 없으면 글은 모두 제목 아래로 — 본문 폭)
        body.forEach((p, j) => {
          const top = j ? 8 : 6;
          if (below.length || room <= 0) { below.push(para(p, below.length ? 8 : src ? 12 : 6)); return; }
          const h = lineCount(p, sideW, FS.text, measure) * FS.text * LINE * 1.75;
          if (top + h <= room + 4) { beside.push(para(p, top)); room -= top + h; return; }
          const [head, rest] = splitToFit(p, sideW, room - top, FS.text, 1.75, measure);
          // 문장 끝에서 잘랐으면 그 끝도 문단 끝처럼(끝 두 어절을 묶는다 — 한 어절만 남지 않게).
          // 줄을 꽉 채운 자리(문장 중간)에서 잘랐으면 묶지 않는다 — 묶으면 마지막 줄이 짧게 끊기고 옆 자리가 빈다
          if (head) { beside.push((/[.?!…]$/u.test(head) ? para : plain)(head, top)); room = 0; }
          if (rest) below.push(para(rest, 12));
        });
        const head: Content = {
          columns: [
            ...(src ? [{ width: pw, image: src, fit: [pw, ph] }] : []),
            {
              width: '*',
              stack: [
                titleYear({ title: s.title || work?.title || '', year: work?.year ?? '' }, FS.h3),
                ...(metaLine ? [txt(metaLine, { fontSize: FS.small, color: C.sub, margin: [0, 1, 0, 0] })] : []),
                ...beside,
              ],
            },
          ],
          columnGap: SECTION_GAP,
        } as Content;
        // 머리('작품별 설명')·사진·사진 옆 글은 한 덩어리 — 머리·사진만 쪽 끝에 남지 않게. 사진 아래로 이어지는 글은 쪽을 넘겨 흐른다
        // (예전처럼 설명 전체를 묶으면 자리가 남아도 통째로 다음 쪽으로 가 빈 곳이 생긴다)
        const glued: Content = { stack: [...(i === 0 ? heading : []), head], unbreakable: true } as Content;
        content.push({ stack: [glued, ...below], margin: [0, i ? 22 : 0, 0, 0] } as Content);
      });
    }
  }

  // ── 출품 작품 ──
  if (list.length) {
    content.push({ text: [{ text: '출품 작품 ', bold: true }, { text: `${list.length}점`, bold: false, color: C.sub }], fontSize: FS.h2, pageBreak: 'before', margin: [0, 4, 0, 12] } as Content);
    const W: (number | string)[] = [20, 50, '*', 106, 70, 26, 62];
    const mid = { verticalAlignment: 'middle' as const };
    const h = (t: string, right = false) => ({ text: t, fontSize: FS.tiny, color: C.sub, alignment: right ? 'right' : 'left' });
    content.push({
      table: {
        headerRows: 1,
        dontBreakRows: true,
        widths: W,
        body: [
          [h('번호'), h(''), h('작품명'), h('재료'), h('크기'), h('연도'), h('가격', true)],
          ...list.map((a, i) => {
            const src = img(a.image, 'thumb');
            return [
              { text: String(numberOf(row.user.id, i)), fontSize: FS.small, color: C.sub, ...mid },
              src ? { image: src, fit: [46, 46], alignment: 'center', ...mid } : { text: '', ...mid },
              { ...(txt(String(a.title ?? '').trim() || '(제목 없음)', { fontSize: FS.small, color: String(a.title ?? '').trim() ? C.ink : C.muted }) as object), ...mid },
              { ...(txt(mediumText(a.medium), { fontSize: FS.small, color: '#333333' }) as object), ...mid },
              { ...(txt(sizeText(a.size), { fontSize: FS.small, color: '#333333' }, { maxWord: 8 }) as object), ...mid },
              { text: String(a.year ?? ''), fontSize: FS.small, color: '#333333', ...mid },
              { ...(txt(priceText(a.price), { fontSize: FS.small, alignment: 'right' }) as object), ...mid },
            ] as TableCell[];
          }),
        ],
      },
      layout: rowsLayout({ padY: 5 }),
    } as Content);
  }

  if (!list.length && !cvBlocks.length && !statement.length && !sections.length) {
    content.push({ text: '아직 낸 출품 자료가 없어요.', color: C.muted, margin: [0, 16, 0, 0] });
  }

  return baseDoc(`${name} ${SUBMISSION_DOC_LABEL} — ${exTitle}`, {
    pageMargins: [42, SUB_MARGIN.top, 42, SUB_MARGIN.bottom],
    header: () => runningHead(exTitle, SUBMISSION_DOC_LABEL),
    footer: (page: number, count: number) => folio(footLabel, page, count),
    content,
  });
}
