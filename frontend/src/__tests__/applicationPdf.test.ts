/**
 * 지원서 PDF (2026-11-24 글자 PDF 로 다시 짬, 규칙 92).
 *  - 갤러리 추가 질문: 지금 질문 순서대로, 다중 선택은 쉼표로, 지운 질문의 답은 '삭제된 질문'으로 남긴다(옛 문서와 같은 규칙)
 *  - 예전 PDF 는 경력에 학력·수상이 빠졌고, 작품 사진을 정사각으로 찌그러뜨렸다(규칙 18)
 *  - 2026-11-25 빈 단 정리: 사진 옆 배치('side')는 한 쪽에 다 들어갈 때만. 넘치면 사진(본문 폭) → 약력 → 경력 두 단(cvFlow).
 *    예전엔 사진이 1쪽에서 끝나도 2쪽부터 글이 반 폭에 갇혔다. 사진은 세로로 긴 것부터.
 */
import { describe, it, expect } from 'vitest';
import { APP_CAREER_SECTIONS, applicationAnswers, buildApplicationDoc, composeApplicationDoc, type ApplicantLike } from '@/lib/galleryDocs/applicationDoc';
import { CV_MARKER } from '@/lib/galleryDocs/cvFlow';
import type { LayoutProbe } from '@/lib/galleryDocs/types';
import type { CustomField } from '@/types';
import { docText, fakeImg, imagesOf, nodesOf } from './docTestUtils';

const customFields: CustomField[] = [
  { id: 'q1', label: '작업 분야', type: 'select', required: true, maxSelect: 1, options: ['회화', '조각'] },
  { id: 'q2', label: '참여 가능 요일', type: 'multiselect', required: false, maxSelect: 0, options: ['월', '화', '수', '목', '금'] },
  { id: 'q3', label: '지원 동기', type: 'text', required: true, maxLength: 100 },
];

const app: ApplicantLike = {
  user: { name: '강윤서', nickname: 'yunseo', email: 'a@b.com', phone: '010-0000-0000', handle: 'yunseo.kang' },
  biography: '작가 약력입니다.\n\n둘째 문단.',
  career: {
    education: [{ year: '2018', content: '예술대학 회화과 졸업' }],
    solo: [{ year: '2026', content: '개인전 「사이」' }],
    group: [], artFair: [],
    award: [{ year: '2026', content: '신진작가상' }],
  },
  artworkImages: ['/uploads/1.jpg', '/uploads/2.jpg', '/uploads/3.jpg'],
  portfolioFileUrl: '/uploads/files/pf.pdf',
  createdAt: '2026-09-24T16:00:00.000Z',
  customAnswers: [
    { fieldId: 'q1', value: '회화' },
    { fieldId: 'q2', value: ['월', '수', '금'] },
    { fieldId: 'q3', value: '지원 동기 텍스트' },
    { fieldId: 'removed', value: '삭제된 질문의 답변' },
  ],
};
const origin = 'https://artlink.cc';

describe('지원서 PDF — 갤러리 추가 질문', () => {
  it('질문 순서대로 · 다중 선택은 쉼표 · 지운 질문의 답은 보존', () => {
    expect(applicationAnswers(app, customFields)).toEqual([
      { label: '작업 분야', value: '회화' },
      { label: '참여 가능 요일', value: '월, 수, 금' },
      { label: '지원 동기', value: '지원 동기 텍스트' },
      { label: '삭제된 질문', value: '삭제된 질문의 답변', removed: true },
    ]);
    const text = docText(buildApplicationDoc('테스트 공모', app, customFields, fakeImg, { origin }));
    for (const s of ['추가 질문', '작업 분야', '회화', '월, 수, 금', '지원 동기 텍스트', '삭제된 질문', '삭제된 질문의 답변']) expect(text, s).toContain(s);
  });

  it('답이 없는 질문은 — 로 · 질문도 답도 없으면 그 구역이 없다', () => {
    const empty: ApplicantLike = { user: { name: 'x' }, customAnswers: [] };
    expect(applicationAnswers(empty, customFields).map((q) => q.value)).toEqual(['', '', '']);
    expect(docText(buildApplicationDoc('공모', empty, customFields, fakeImg, { origin }))).toContain('—');
    expect(docText(buildApplicationDoc('공모', { user: { name: 'x' }, biography: '' }, null, fakeImg, { origin }))).not.toContain('추가 질문');
  });

  it('기존·옛 데이터 — 답이 null 이거나 배열이 아니어도 문서가 만들어진다', () => {
    expect(() => buildApplicationDoc('공모', { user: { name: 'x' }, customAnswers: null }, customFields, fakeImg, { origin })).not.toThrow();
    const legacy = { user: { name: 'x' }, customAnswers: { q1: '회화' } } as unknown as ApplicantLike;
    expect(applicationAnswers(legacy, customFields).every((q) => q.value === '')).toBe(true);
    expect(applicationAnswers(app, null).map((q) => q.label)).toEqual(['삭제된 질문', '삭제된 질문', '삭제된 질문', '삭제된 질문']);
  });
});

describe('지원서 PDF — 지원자', () => {
  const doc = buildApplicationDoc('겹과 결', app, customFields, fakeImg, { origin });
  const text = docText(doc);

  it('경력 다섯 갈래 전부(학력·수상 포함) — 빈 갈래만 빠진다', () => {
    expect(APP_CAREER_SECTIONS.map((s) => s.label)).toEqual(['학력', '개인전', '단체전', '아트페어', '수상 및 선정']);
    for (const s of ['학력', '예술대학 회화과 졸업', '개인전', '수상 및 선정', '신진작가상']) expect(text, s).toContain(s);
    expect(text).not.toContain('단체전');
  });

  it('이름(닉네임) · 연락처 · 지원일 · 약력 문단', () => {
    for (const s of ['강윤서', 'yunseo', '010-0000-0000 · a@b.com', '지원 2026. 9. 25.', '작품 사진 3점', '작가 약력입니다.', '둘째 문단.', '지원서 · 강윤서']) {
      expect(text, s).toContain(s);
    }
  });

  it('홈페이지 · 포트폴리오 파일은 눌리는 링크(사이트 주소로)', () => {
    const links = nodesOf(doc.content).filter((n) => typeof n.link === 'string').map((n) => [n.text, n.link]);
    expect(links).toEqual([
      ['artlink.cc/@yunseo.kang', 'https://artlink.cc/@yunseo.kang'],
      ['포트폴리오 파일(PDF)', 'https://artlink.cc/uploads/files/pf.pdf'],
    ]);
  });

  it('★ 작품 사진은 비율 그대로(fit) — 폭·높이를 함께 주지 않는다 · 못 받은 사진은 글자로', () => {
    for (const mode of ['stack', 'side'] as const) {
      const imgs = imagesOf(buildApplicationDoc('겹과 결', app, customFields, fakeImg, { origin, mode }));
      expect(imgs).toHaveLength(3);
      expect(imgs.every((n) => Array.isArray(n.fit) && !(n.width !== undefined && n.height !== undefined)), mode).toBe(true);
      const noImg = docText(buildApplicationDoc('공모', app, null, () => null, { origin, mode }));
      expect(noImg.match(/사진을 받지 못했어요/g), mode).toHaveLength(3);
    }
  });
});

describe('지원서 PDF — 배치(2026-11-25 빈 단 정리)', () => {
  // 1.jpg 가로(0.75) · 2.jpg 세로(1.4) · 3.jpg 정사각 · 크기 모르는 사진은 맨 뒤
  const dims = (u: string) => ({ '/uploads/1.jpg': { w: 400, h: 300 }, '/uploads/2.jpg': { w: 500, h: 700 }, '/uploads/3.jpg': { w: 600, h: 600 } } as Record<string, { w: number; h: number }>)[u] ?? null;
  const order = (d: ReturnType<typeof buildApplicationDoc>) => imagesOf(d).map((n) => String(n.image).split(';').pop());

  it('사진은 세로로 긴 것부터 — 크기를 모르면 원래 순서', () => {
    expect(order(buildApplicationDoc('공모', app, null, fakeImg, { origin, dims }))).toEqual(['/uploads/2.jpg', '/uploads/3.jpg', '/uploads/1.jpg']);
    expect(order(buildApplicationDoc('공모', app, null, fakeImg, { origin }))).toEqual(['/uploads/1.jpg', '/uploads/2.jpg', '/uploads/3.jpg']);
    const partial = { ...app, artworkImages: ['/uploads/x.jpg', '/uploads/1.jpg', '/uploads/2.jpg'] };
    expect(order(buildApplicationDoc('공모', partial, null, fakeImg, { origin, dims }))).toEqual(['/uploads/2.jpg', '/uploads/1.jpg', '/uploads/x.jpg']);
  });

  it("'stack' — 사진은 본문 폭 한 줄 4장(줄은 쪽에서 갈라지지 않는다) → 약력 → 경력은 두 단(표시 조각 뒤)", () => {
    const many = { ...app, artworkImages: Array.from({ length: 6 }, (_, k) => `/uploads/${k}.jpg`) };
    const doc = buildApplicationDoc('공모', many, null, fakeImg, { origin });
    const content = doc.content as unknown as Record<string, unknown>[];
    const photoRows = content.filter((n) => Array.isArray(n.columns) && n.unbreakable === true);
    expect(photoRows.map((r) => (r.columns as unknown[]).length)).toEqual([4, 4]);    // 6장 → 4 + 2(빈 칸 2)
    expect(imagesOf(doc)).toHaveLength(6);
    const at = (pred: (n: Record<string, unknown>) => boolean) => content.findIndex(pred);
    const marker = at((n) => n.id === CV_MARKER);
    expect(marker).toBeGreaterThan(at((n) => n.text === '약력'));
    expect(content.slice(marker + 1).some((n) => Array.isArray(n.columns) && (n.columns as unknown[]).length === 2)).toBe(true);
  });

  it("'side' — 왼쪽 약력·경력 / 오른쪽 사진 두 줄(예전 배치, 한 쪽에 들어갈 때만 쓴다)", () => {
    const doc = buildApplicationDoc('공모', app, null, fakeImg, { origin, mode: 'side', dims });
    const content = doc.content as unknown as Record<string, unknown>[];
    expect(content.some((n) => n.id === CV_MARKER)).toBe(false);
    const two = content.find((n) => Array.isArray(n.columns) && (n.columns as { width?: unknown }[])[1]?.width === 236);
    expect(two).toBeTruthy();
  });

  it('compose — 사진 옆 배치가 한 쪽이면 그대로, 넘치면 새 배치를 경력 시작 쪽 남은 높이로 다시 짠다', async () => {
    /** 표시 조각 뒤의 경력 두 단 묶음들 */
    const cvColsOf = (d: ReturnType<typeof buildApplicationDoc>) => {
      const c = d.content as unknown as Record<string, unknown>[];
      return c.slice(c.findIndex((n) => n.id === CV_MARKER) + 1).filter((n) => Array.isArray(n.columns));
    };
    const calls: (string | undefined)[] = [];
    const probe = (pages: number, top: number | null): LayoutProbe => async (_d, id) => { calls.push(id); return { pages, top }; };
    const one = await composeApplicationDoc('공모', app, null, { img: fakeImg, probe: probe(1, null) }, origin);
    expect((one.content as unknown as Record<string, unknown>[]).some((n) => n.id === CV_MARKER)).toBe(false);
    expect(calls).toEqual([undefined]);

    calls.length = 0;
    const long = await composeApplicationDoc('공모', app, null, { img: fakeImg, probe: probe(3, 600) }, origin);
    expect(calls).toEqual([undefined, CV_MARKER]);
    expect((long.content as unknown as Record<string, unknown>[]).some((n) => n.id === CV_MARKER)).toBe(true);
    // 시작 쪽 남은 높이 = 841.89 − 46 − (600 + 1.19) ≈ 194.7 — 경력(33 + 줄)이 들어가므로 다음 쪽으로 미루지 않는다
    expect(cvColsOf(long)[0]!.pageBreak).toBeUndefined();

    // 시작 쪽에 자리가 없으면(남은 높이 < 머리 + 한 줄) 경력은 다음 쪽 맨 위에서
    const full = await composeApplicationDoc('공모', app, null, { img: fakeImg, probe: probe(3, 760) }, origin);
    expect(cvColsOf(full)[0]!.pageBreak).toBe('before');

    // 미리 배치가 없으면(그림 적기 단계) 새 배치를 대강으로
    const rough = await composeApplicationDoc('공모', app, null, { img: fakeImg }, origin);
    expect((rough.content as unknown as Record<string, unknown>[]).some((n) => n.id === CV_MARKER)).toBe(true);
  });
});
