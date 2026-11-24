/**
 * 지원서 PDF (2026-11-24 글자 PDF 로 다시 짬, 규칙 92).
 *  - 갤러리 추가 질문: 지금 질문 순서대로, 다중 선택은 쉼표로, 지운 질문의 답은 '삭제된 질문'으로 남긴다(옛 문서와 같은 규칙)
 *  - 예전 PDF 는 경력에 학력·수상이 빠졌고, 작품 사진을 정사각으로 찌그러뜨렸다(규칙 18)
 */
import { describe, it, expect } from 'vitest';
import { APP_CAREER_SECTIONS, applicationAnswers, buildApplicationDoc, type ApplicantLike } from '@/lib/galleryDocs/applicationDoc';
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
    const imgs = imagesOf(doc);
    expect(imgs.map((n) => n.image)).toEqual(['/uploads/1.jpg', '/uploads/3.jpg', '/uploads/2.jpg'].map((u) => `data:image/jpeg;mid;${u}`));
    expect(imgs.every((n) => Array.isArray(n.fit) && !(n.width !== undefined && n.height !== undefined))).toBe(true);
    const noImg = docText(buildApplicationDoc('공모', app, null, () => null, { origin }));
    expect(noImg.match(/사진을 받지 못했어요/g)).toHaveLength(3);
  });
});
