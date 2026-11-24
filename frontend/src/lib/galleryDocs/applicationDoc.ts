/**
 * 지원서 — 지원자 한 사람 (2026-11-24, 규칙 92 · 목업 'Apply').
 *
 * 예전 지원서 PDF 의 문제: ①작품 사진을 정사각으로 **찌그러뜨렸다**(object-fit:cover 를 html2canvas 가 늘려 그린다 —
 * 실측 원본 비율 0.76 → 1, 규칙 18 위반) ②경력에 **학력·수상이 빠졌다**(개인전·단체전·아트페어만 옮겨 담았다)
 * ③포트폴리오 파일이 눌리지 않는 주소 글자였다.
 *  - 작품 사진: 폭만 정하고 높이는 비율대로(fit) — 늘리지도 자르지도 않는다
 *  - 경력 다섯 갈래 전부(학력 · 개인전 · 단체전 · 아트페어 · 수상) — 빈 갈래만 빠진다
 *  - 홈페이지 · 포트폴리오 파일은 PDF 안에서 눌리는 링크
 *  - 갤러리 추가 질문: 지금 질문 순서대로, 지운 질문의 답은 '삭제된 질문'으로 남긴다(옛 문서와 같은 규칙)
 *
 * 배치 두 가지 (2026-11-25):
 *  - 'side'  — 왼쪽 약력·경력 / 오른쪽 작품 사진 두 줄. **한 쪽에 다 들어갈 때만** 쓴다(짧은 지원서는 이게 가장 촘촘하다)
 *  - 'stack' — 작품 사진(본문 폭, 한 줄 4장) → 약력(본문 폭) → 경력 두 단(cvFlow, 쪽마다 왼쪽 → 오른쪽) → 추가 질문.
 *    예전엔 늘 'side' 라 사진이 1쪽에서 끝나도 2쪽부터 글이 반 폭에 갇혔다(강윤서 8쪽 중 7쪽의 오른쪽 절반이 비었다 → 6쪽)
 *  어느 쪽인지는 render 쪽(operationPdf.ts applicationDocFor)이 'side' 를 미리 배치해 쪽 수로 정한다. 모르면 'stack'.
 *  사진은 세로로 긴 것부터(세로/가로 비율 — 크기는 render 가 그림을 받을 때 적어 둔다) — 한 줄(한 단)에 비슷한 모양끼리 모인다.
 */
import type { Content, TableCell, TDocumentDefinitions } from 'pdfmake/interfaces';
import type { Career, CustomAnswer, CustomField } from '@/types';
import { C, CW, FS, PAGE, baseDoc, folio, hr, runningHead } from './layout';
import { keepLastTwo, paragraphs, runs, txt } from './text';
import { LINE, approxMeasure, cvFlow, cvMarker, lineCount, remainingBelowMarker } from './cvFlow';
import { kstDate } from './format';
import { cvSection } from './submissionDoc';
import type { DimsFn, DocTools, ImgFn, Measure } from './types';

export interface ApplicantLike {
  user: { id?: number; name: string; nickname?: string | null; email?: string | null; phone?: string | null; handle?: string | null };
  biography?: string | null;
  career?: Career | null;
  artworkImages?: string[] | null;
  portfolioFileUrl?: string | null;
  customAnswers?: CustomAnswer[] | null;
  status?: string;
  createdAt?: string;
}

/** 경력 다섯 갈래 — 지원서 화면(ApplicationContent)과 같은 이름·순서 */
export const APP_CAREER_SECTIONS: { key: keyof Career; label: string }[] = [
  { key: 'education', label: '학력' },
  { key: 'solo', label: '개인전' },
  { key: 'group', label: '단체전' },
  { key: 'artFair', label: '아트페어' },
  { key: 'award', label: '수상 및 선정' },
];

/** 추가 질문의 답 — 다중 선택은 쉼표로. 지금 질문에 없는 답은 '삭제된 질문'으로 남긴다. 배열이 아닌 옛 값은 무시 */
export function applicationAnswers(app: ApplicantLike, fields?: CustomField[] | null): { label: string; value: string; removed?: boolean }[] {
  const answers = Array.isArray(app.customAnswers) ? app.customAnswers : [];
  const byId = new Map(answers.map((a) => [a.fieldId, a.value] as const));
  const fmt = (v?: string | string[]) => (Array.isArray(v) ? v.filter(Boolean).join(', ') : (v ?? ''));
  const ids = new Set((fields ?? []).map((f) => f.id));
  return [
    ...(fields ?? []).map((f) => ({ label: f.label, value: fmt(byId.get(f.id)) })),
    ...answers.filter((a) => !ids.has(a.fieldId)).map((a) => ({ label: '삭제된 질문', value: fmt(a.value), removed: true })),
  ];
}

/** 사이트 주소로 — '/uploads/a.pdf' → 'https://artlink.cc/uploads/a.pdf' */
function absolute(url: string, origin: string): string {
  return /^https?:\/\//i.test(url) ? url : `${origin.replace(/\/$/, '')}${url.startsWith('/') ? '' : '/'}${url}`;
}

const fileKind = (url: string) => {
  const ext = /\.([a-z0-9]{2,5})(?:\?|#|$)/i.exec(url)?.[1]?.toUpperCase();
  return ext && ext.length <= 4 ? ext : '';
};

/** 지원서 쪽 여백(위·아래) — 경력 두 단의 쪽 높이 계산에 쓴다 */
export const APP_MARGIN = { top: 60, bottom: 46 };

export interface ApplicationDocOpts {
  origin: string;
  /** 'side' = 사진 옆(한 쪽에 들어갈 때) · 'stack' = 새 배치(기본) */
  mode?: 'side' | 'stack';
  /** 글자 폭 재기(경력 두 단 나누기) — 없으면 대강 */
  measure?: Measure;
  /** 경력이 시작하는 쪽에 남은 높이(pt) — 미리 배치해 CV_MARKER 로 잰다. 없으면 반 쪽으로 본다 */
  cvStart?: number;
  /** 그림 크기(px) — 세로로 긴 순서 정하기. 모르면 원래 순서 */
  dims?: DimsFn;
}

/**
 * 지원서 한 장을 배치까지 보고 짠다 — 'side' 로 한 쪽에 다 들어가면 그것, 아니면 'stack'(경력 두 단은 시작 쪽 남은 높이를 재서).
 * 미리 배치(probe)가 없으면(그림 적기 단계 · 테스트) 'stack' 을 대강으로.
 * ⚠️ 미리 배치한 정의는 버리고 **새로 짠다** — pdfmake 는 받은 정의를 고쳐 쓴다(조각마다 위치·쪽 나눔 표시를 남긴다). 빌더는 싸다.
 */
export async function composeApplicationDoc(exTitle: string, app: ApplicantLike, customFields: CustomField[] | null | undefined, t: DocTools, origin: string): Promise<TDocumentDefinitions> {
  const base = { origin, measure: t.measure, dims: t.dims };
  if (!t.probe) return buildApplicationDoc(exTitle, app, customFields, t.img, base);
  if (!sideCannotFit(app, t.measure ?? approxMeasure, t.dims)) {
    const side = buildApplicationDoc(exTitle, app, customFields, t.img, { ...base, mode: 'side' });
    const { pages } = await t.probe(side);
    if (pages === 1) return buildApplicationDoc(exTitle, app, customFields, t.img, { ...base, mode: 'side' });
  }
  if (!APP_CAREER_SECTIONS.some(({ key }) => (app.career?.[key] ?? []).length)) return buildApplicationDoc(exTitle, app, customFields, t.img, base); // 경력이 없으면 잴 것이 없다
  const cvStart = await remainingBelowMarker(t.probe, buildApplicationDoc(exTitle, app, customFields, t.img, base), PAGE.h, APP_MARGIN.bottom);
  return buildApplicationDoc(exTitle, app, customFields, t.img, { ...base, cvStart });
}

/**
 * 사진 옆 배치가 한 쪽에 **절대** 안 들어가는가 — 적게 잡은 높이(약력 줄 · 경력 한 줄씩 · 사진 두 단 반씩)만으로도 넘치면
 * 미리 배치를 건너뛴다(긴 지원서마다 통째로 한 번 더 배치하지 않게). 애매하면 false(배치해 본다).
 */
function sideCannotFit(app: ApplicantLike, measure: Measure, dims?: DimsFn): boolean {
  const bodyH = PAGE.h - APP_MARGIN.top - APP_MARGIN.bottom - 70; // 머리(이름·연락처·줄) 몫을 적게 뺀다
  const leftW = CW - 236 - 28;
  let left = 0;
  for (const p of paragraphs(app.biography)) left += lineCount(p, leftW, FS.body, measure) * FS.body * LINE * 1.65;
  for (const { key } of APP_CAREER_SECTIONS) left += (app.career?.[key] ?? []).length * FS.small * LINE * 1.35;
  const photoH = (app.artworkImages || []).filter(Boolean).reduce((h, u) => {
    const d = dims?.(u);
    return h + (d && d.w > 0 ? Math.min(190, (112 * d.h) / d.w) : 60) + 10;
  }, 0);
  return left > bodyH || photoH / 2 > bodyH;
}

export function buildApplicationDoc(exTitle: string, app: ApplicantLike, customFields: CustomField[] | null | undefined, img: ImgFn, opts: ApplicationDocOpts): TDocumentDefinitions {
  const u = app.user;
  const name = (u.name || u.nickname || '작가').trim();
  const nick = u.nickname?.trim() && u.nickname.trim() !== name ? u.nickname.trim() : '';
  const photos = (app.artworkImages ?? []).filter((x): x is string => !!x);
  const contact = [u.phone, u.email].map((v) => String(v ?? '').trim()).filter(Boolean).join(' · ');
  const home = u.handle ? `${opts.origin.replace(/\/$/, '')}/@${u.handle}` : '';
  const file = app.portfolioFileUrl ? absolute(app.portfolioFileUrl, opts.origin) : '';
  const linkRuns: object[] = [];
  if (home) linkRuns.push({ text: home.replace(/^https?:\/\//, ''), link: home, decoration: 'underline', color: C.ink });
  if (home && file) linkRuns.push({ text: ' · ' });
  if (file) linkRuns.push({ text: `포트폴리오 파일${fileKind(file) ? `(${fileKind(file)})` : ''}`, link: file, decoration: 'underline', color: C.ink });

  const content: Content[] = [];
  content.push({
    columns: [
      {
        width: '*',
        stack: [
          { text: [...runs(name, { bold: true }), ...(nick ? [{ text: `  ${nick}`, fontSize: 12, bold: false, color: C.sub }] : [])], fontSize: 27, bold: true, lineHeight: 1.1, characterSpacing: 0.5 },
          ...(contact ? [txt(contact, { fontSize: FS.body, color: C.sub, margin: [0, 9, 0, 0] })] : []),
          ...(linkRuns.length ? [{ text: linkRuns, fontSize: FS.body, color: C.sub, margin: [0, 2, 0, 0] } as Content] : []),
        ],
      },
      {
        width: 'auto',
        stack: [
          ...(app.createdAt ? [{ text: `지원 ${kstDate(app.createdAt)}`, fontSize: FS.small, color: C.sub, alignment: 'right' }] : []),
          { text: `작품 사진 ${photos.length}점`, fontSize: FS.small, color: C.sub, alignment: 'right' },
        ],
      },
    ],
    columnGap: 18,
  } as Content);

  content.push(hr({ color: C.ink, thick: 1.5, margin: [0, 16, 0, 0] }));

  const measure = opts.measure ?? approxMeasure;
  // 세로로 긴 것부터(크기를 모르는 사진은 맨 뒤, 원래 순서대로)
  const ratio = (u: string) => { const d = opts.dims?.(u); return d && d.w > 0 ? d.h / d.w : -1; };
  const ordered = photos.map((u, k) => ({ u, k, r: ratio(u) })).sort((a, b) => b.r - a.r || a.k - b.k).map((x) => x.u);
  const bio = paragraphs(app.biography);
  const bioBlocks = bio.length
    ? bio.map((p, i) => keepLastTwo(txt(p, { fontSize: FS.body, lineHeight: 1.65, alignment: 'justify', color: C.body, margin: [0, i ? 6 : 0, 0, 0] })))
    : [{ text: '약력이 비어 있어요.', color: C.muted, fontSize: FS.small } as Content];
  const photoCell = (url: string, w: number, maxH: number, margin?: [number, number, number, number]): Content => {
    const src = img(url, 'mid');
    return src
      ? ({ image: src, fit: [w, maxH], ...(margin ? { margin } : {}) } as Content)
      : ({ text: '사진을 받지 못했어요', fontSize: FS.tiny, color: C.muted, ...(margin ? { margin } : {}) } as Content);
  };

  if (opts.mode === 'side') {
    // ── 왼쪽: 약력 · 경력 / 오른쪽: 작품 사진 두 줄(높이를 맞춰 나눈다) — 한 쪽에 다 들어갈 때만 ──
    const left: Content[] = [
      { text: '약력', bold: true, fontSize: FS.body, margin: [0, 12, 0, 6] },
      ...bioBlocks,
      ...APP_CAREER_SECTIONS.map(({ key, label }) => cvSection(label, app.career?.[key] ?? [])).filter((b): b is Content => !!b),
    ];
    const cols: string[][] = [[], []];
    const hs = [0, 0];
    for (const u of ordered) {
      const d = opts.dims?.(u);
      const h = d && d.w > 0 ? Math.min(190, (112 * d.h) / d.w) : 150;
      const c = hs[0]! <= hs[1]! ? 0 : 1;
      cols[c]!.push(u);
      hs[c] = hs[c]! + h + 10;
    }
    const photoCol = (list: string[]): Content => ({ width: 112, stack: list.map((u) => photoCell(u, 112, 190, [0, 0, 0, 10])) } as Content);
    const right: Content[] = [
      { text: '작품 사진', bold: true, fontSize: FS.body, margin: [0, 12, 0, 8] },
      photos.length
        ? ({ columns: [photoCol(cols[0]!), photoCol(cols[1]!)], columnGap: 12 } as Content)
        : ({ text: '올린 작품 사진이 없어요.', color: C.muted, fontSize: FS.small } as Content),
    ];
    content.push({ columns: [{ width: '*', stack: left }, { width: 236, stack: right }], columnGap: 28 } as Content);
  } else {
    // ── 작품 사진 — 본문 폭 전체, 한 줄에 4장(비율대로, 자르지 않는다) ──
    const PER_ROW = 4;
    const GAP = 12;
    const cellW = (CW - GAP * (PER_ROW - 1)) / PER_ROW;
    content.push({ text: [{ text: '작품 사진 ', bold: true }, { text: `${photos.length}점`, color: C.sub }], fontSize: FS.body, margin: [0, 14, 0, 8] } as Content);
    if (photos.length) {
      for (let r = 0; r < ordered.length; r += PER_ROW) {
        const cells: Content[] = ordered.slice(r, r + PER_ROW).map((u) => ({ width: cellW, stack: [photoCell(u, cellW, 150)] } as Content));
        while (cells.length < PER_ROW) cells.push({ width: cellW, text: '' } as Content);
        content.push({ columns: cells, columnGap: GAP, margin: [0, r ? GAP : 0, 0, 0], unbreakable: true } as Content);
      }
    } else {
      content.push({ text: '올린 작품 사진이 없어요.', color: C.muted, fontSize: FS.small });
    }

    // ── 약력 — 본문 폭 전체 ──
    content.push(hr({ color: C.rule, thick: 0.75, margin: [0, 18, 0, 0] }));
    content.push({ text: '약력', bold: true, fontSize: FS.body, margin: [0, 12, 0, 6] });
    content.push(...bioBlocks);

    // ── 경력 — 두 단, 쪽마다 왼쪽 → 오른쪽(cvFlow) ──
    content.push(cvMarker([0, 6, 0, 0]));
    const pageH = PAGE.h - APP_MARGIN.top - APP_MARGIN.bottom;
    content.push(...cvFlow(APP_CAREER_SECTIONS.map(({ key, label }) => ({ label, items: app.career?.[key] ?? [] })),
      { colW: (CW - 30) / 2, gap: 30, firstH: opts.cvStart ?? pageH / 2, pageH, measure }));
  }

  // ── 갤러리 추가 질문 ──
  const qa = applicationAnswers(app, customFields);
  if (qa.length) {
    content.push({
      margin: [0, 22, 0, 0],
      unbreakable: qa.length <= 8, // 머리('추가 질문')만 쪽 끝에 남지 않게(길면 표 머리가 다음 쪽에 다시 나온다)
      stack: [
        { text: '추가 질문', bold: true, fontSize: FS.body, margin: [0, 0, 0, 4] },
        {
          table: {
            dontBreakRows: true,
            widths: [180, '*'],
            body: qa.map((q) => [
              txt(q.label, { fontSize: FS.small, color: q.removed ? C.muted : C.sub }),
              q.value ? txt(q.value, { fontSize: FS.small }) : { text: '—', fontSize: FS.small, color: C.muted },
            ] as TableCell[]),
          },
          layout: {
            hLineWidth: (i: number) => (i === 0 ? 0.75 : 0.5),
            hLineColor: (i: number) => (i === 0 ? C.ink : C.hair),
            vLineWidth: () => 0, paddingLeft: (i: number) => (i === 0 ? 0 : 8), paddingRight: () => 0, paddingTop: () => 6, paddingBottom: () => 6,
          },
        },
      ],
    } as Content);
  }

  return baseDoc(`${exTitle} 지원서 — ${name}`, {
    pageMargins: [42, APP_MARGIN.top, 42, APP_MARGIN.bottom],
    header: () => runningHead(exTitle, '지원서'),
    footer: (page: number, count: number) => folio(`지원서 · ${name}`, page, count),
    content,
  });
}
