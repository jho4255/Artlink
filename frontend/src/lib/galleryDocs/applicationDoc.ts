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
 */
import type { Content, TableCell, TDocumentDefinitions } from 'pdfmake/interfaces';
import type { Career, CustomAnswer, CustomField } from '@/types';
import { C, FS, baseDoc, folio, hr, runningHead } from './layout';
import { paragraphs, runs, txt } from './text';
import { kstDate } from './format';
import { cvSection } from './submissionDoc';
import type { ImgFn } from './types';

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

export function buildApplicationDoc(exTitle: string, app: ApplicantLike, customFields: CustomField[] | null | undefined, img: ImgFn, opts: { origin: string }): TDocumentDefinitions {
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

  // ── 왼쪽: 약력 · 경력 / 오른쪽: 작품 사진(두 줄, 비율대로) ──
  const bio = paragraphs(app.biography);
  const left: Content[] = [
    { text: '약력', bold: true, fontSize: FS.body, margin: [0, 12, 0, 6] },
    ...(bio.length
      ? bio.map((p, i) => txt(p, { fontSize: FS.body, lineHeight: 1.65, alignment: 'justify', color: C.body, margin: [0, i ? 6 : 0, 0, 0] }))
      : [{ text: '약력이 비어 있어요.', color: C.muted, fontSize: FS.small } as Content]),
    ...APP_CAREER_SECTIONS.map(({ key, label }) => cvSection(label, app.career?.[key] ?? [])).filter((b): b is Content => !!b),
  ];
  const photoCol = (list: string[]): Content => ({
    width: 112,
    stack: list.map((url) => {
      const src = img(url, 'mid');
      return src
        ? ({ image: src, fit: [112, 190], margin: [0, 0, 0, 10] } as Content)
        : ({ text: '사진을 받지 못했어요', fontSize: FS.tiny, color: C.muted, margin: [0, 0, 0, 10] } as Content);
    }),
  } as Content);
  const right: Content[] = [
    { text: '작품 사진', bold: true, fontSize: FS.body, margin: [0, 12, 0, 8] },
    photos.length
      ? ({ columns: [photoCol(photos.filter((_, i) => i % 2 === 0)), photoCol(photos.filter((_, i) => i % 2 === 1))], columnGap: 12 } as Content)
      : ({ text: '올린 작품 사진이 없어요.', color: C.muted, fontSize: FS.small } as Content),
  ];
  content.push({ columns: [{ width: '*', stack: left }, { width: 236, stack: right }], columnGap: 28 } as Content);

  // ── 갤러리 추가 질문 ──
  const qa = applicationAnswers(app, customFields);
  if (qa.length) {
    content.push({
      margin: [0, 22, 0, 0],
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
    pageMargins: [42, 60, 42, 46],
    header: () => runningHead(exTitle, '지원서'),
    footer: (page: number, count: number) => folio(`지원서 · ${name}`, page, count),
    content,
  });
}
