/**
 * 출품 자료 — 작가 한 사람의 출품 자료를 한 파일로 (2026-11-24, 규칙 92 · 목업 'ArtistProfile'·'ArtistNote').
 * 예전엔 작가마다 PDF 세 개(출품리스트 · 작가약력 · 작가노트)였고, 쪽이 넘어가는 자리에서 글자 줄이 반으로 잘렸다.
 *
 *  1쪽  이름 · 연락처 · 대표작  +  약력(2단으로 흐른다 · 같은 해는 연도를 한 번만)
 *  다음 작가노트(한 줄 36자 안팎) + 작품별 설명(그 작품 사진 옆에, 자르지 않는다)
 *  다음 출품 작품 표(전시 전체 번호 · 2쪽부터 표 머리가 다시 나온다)
 *  모든 쪽에 머리말(전시명 | 출품 자료) · 꼬리말(작가 이름 · 쪽 번호)
 *
 * ⚠️ 문서 이름은 '출품 자료' — '작가 자료'·'제출 자료'라고 부르지 말 것(규칙 59 의 용어 통일. 목업엔 '작가 자료'라 적었었다).
 */
import type { Content, TableCell, TDocumentDefinitions } from 'pdfmake/interfaces';
import { CV_SECTIONS } from '@/lib/submissionChecklist';
import { splitIntoColumns } from '@/lib/careerColumns';
import type { ArtworkItem, CvEntry } from '@/types';
import { C, FS, NO_LINES, baseDoc, folio, hr, rowsLayout, runningHead } from './layout';
import { paragraphs, runs, txt } from './text';
import { docArtistName, mediumText, priceText, sizeText } from './format';
import type { ImgFn, SubmissionRowLike } from './types';

export const SUBMISSION_DOC_LABEL = '출품 자료';

/** 왼쪽 이름표 칸(목업 150px) */
const LABEL_W = 112;

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
export function buildSubmissionDoc(exTitle: string, row: SubmissionRowLike, numberOf: (userId: number, index: number) => number, img: ImgFn): TDocumentDefinitions {
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

  // ── 약력 — 두 단에 갈래째로 고르게(화면 약력과 같은 나누기, lib/careerColumns.ts). 한 갈래가 단 사이로 쪼개지지 않는다 ──
  content.push(hr({ color: C.ink, thick: 1.5, margin: [0, 20, 0, 0] }));
  if (cvParts.length) {
    const cols = splitIntoColumns(cvParts, 2, (p) => p.rows);
    content.push({ columns: [0, 1].map((i) => ({ width: '*', stack: (cols[i] ?? []).map((p) => p.block) })), columnGap: 30 } as Content);
  } else {
    content.push({ text: '약력이 비어 있어요.', color: C.muted, margin: [0, 12, 0, 0] });
  }

  // ── 작가노트 · 작품별 설명 ──
  if (statement.length || sections.length) {
    content.push({ ...(txt(name, { fontSize: FS.h2, bold: true }) as object), pageBreak: 'before', margin: [0, 4, 0, 0] } as Content);
    if (statement.length) {
      content.push(hr({ color: C.ink, thick: 1.5, margin: [0, 14, 0, 12] }));
      content.push({
        columns: [
          { width: LABEL_W, text: '작가노트', bold: true, fontSize: FS.body },
          { width: '*', stack: statement.map((p, i) => txt(p, { fontSize: FS.text, lineHeight: 1.75, alignment: 'justify', color: C.body, margin: [0, i ? 8 : 0, 0, 0] })) },
        ],
        columnGap: 24,
      } as Content);
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
        const block: Content = {
          columns: [
            src ? { width: LABEL_W, image: src, fit: [LABEL_W, LABEL_W] } : { width: LABEL_W, text: '' },
            {
              width: '*',
              stack: [
                titleYear({ title: s.title || work?.title || '', year: work?.year ?? '' }, FS.h3),
                ...(metaLine ? [txt(metaLine, { fontSize: FS.small, color: C.sub, margin: [0, 1, 0, 0] })] : []),
                ...body.map((p, j) => txt(p, { fontSize: FS.text, lineHeight: 1.75, alignment: 'justify', color: C.body, margin: [0, j ? 8 : 6, 0, 0] })),
              ],
            },
          ],
          columnGap: 24,
          margin: [0, i ? 20 : 0, 0, 0],
        } as Content;
        // 짧은 설명은 사진과 함께 넘어가게(사진만 쪽 끝에 남지 않게). 긴 설명은 쪽을 넘겨 흐른다
        const short = String(s.body ?? '').length < 520;
        const parts = i === 0 ? [...heading, block] : [block];
        content.push(short ? ({ stack: parts, unbreakable: true } as Content) : ({ stack: parts } as Content));
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
    pageMargins: [42, 60, 42, 46],
    header: () => runningHead(exTitle, SUBMISSION_DOC_LABEL),
    footer: (page: number, count: number) => folio(footLabel, page, count),
    content,
  });
}
