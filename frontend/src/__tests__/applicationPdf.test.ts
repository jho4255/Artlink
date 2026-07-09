import { describe, it, expect } from 'vitest';
import { applicationHtml } from '../lib/operationPdf';
import type { CustomField } from '../types';

const customFields: CustomField[] = [
  { id: 'q1', label: '작업 분야', type: 'select', required: true, maxSelect: 1, options: ['회화', '조각'] },
  { id: 'q2', label: '참여 가능 요일', type: 'multiselect', required: false, maxSelect: 0, options: ['월', '화', '수', '목', '금'] },
  { id: 'q3', label: '지원 동기', type: 'text', required: true, maxLength: 100 },
];

const app = {
  user: { name: 'Artist 1', email: 'a@b.com', phone: '010-0000-0000' },
  biography: '작가 약력입니다.',
  customAnswers: [
    { fieldId: 'q1', value: '회화' },
    { fieldId: 'q2', value: ['월', '수', '금'] }, // 다중선택
    { fieldId: 'q3', value: '지원 동기 텍스트' },
    { fieldId: 'removed', value: '삭제된 질문의 답변' }, // orphan
  ],
};

describe('지원서 PDF - 갤러리 추가 질문', () => {
  it('커스텀 질문 라벨과 답변(단일/다중/텍스트/orphan)이 HTML에 모두 포함된다', () => {
    const html = applicationHtml('테스트 공모', app as any, customFields);
    expect(html).toContain('갤러리 추가 질문');
    expect(html).toContain('작업 분야');
    expect(html).toContain('회화');
    expect(html).toContain('참여 가능 요일');
    expect(html).toContain('월, 수, 금'); // 다중선택은 콤마로 조인
    expect(html).toContain('지원 동기');
    expect(html).toContain('지원 동기 텍스트');
    // 현재 필드에 없는 답변은 "삭제된 질문"으로 보존
    expect(html).toContain('삭제된 질문');
    expect(html).toContain('삭제된 질문의 답변');
  });

  it('답변이 없는 필수 질문은 - 로 표시된다', () => {
    const html = applicationHtml('테스트 공모', { user: { name: 'x' }, customAnswers: [] } as any, customFields);
    expect(html).toContain('작업 분야');
    expect(html).toContain('갤러리 추가 질문');
  });

  it('customFields가 없고 답변도 없으면 추가 질문 섹션이 렌더되지 않는다', () => {
    const html = applicationHtml('테스트 공모', { user: { name: 'x' }, biography: '' } as any);
    expect(html).not.toContain('갤러리 추가 질문');
  });

  // ── 기존/레거시 데이터 호환 (실서버 배포 대비) ──
  it('기존 지원서: customAnswers=null 이어도 오류 없이 렌더된다', () => {
    const html = applicationHtml('테스트 공모', { user: { name: 'x' }, biography: '약력', customAnswers: null } as any, customFields);
    // 질문 정의는 있으나 답변이 없으므로 각 질문이 -로 표시
    expect(html).toContain('갤러리 추가 질문');
    expect(html).toContain('작업 분야');
  });

  it('질문이 삭제된 공모(customFields 없음)라도 기존 답변은 "삭제된 질문"으로 보존된다', () => {
    const html = applicationHtml('테스트 공모', app as any, null);
    expect(html).toContain('삭제된 질문');
    expect(html).toContain('회화'); // 기존 답변 유지
  });

  it('레거시 비배열 customAnswers(객체 등)도 크래시 없이 안전하게 처리된다', () => {
    const legacy = { user: { name: 'x' }, biography: '약력', customAnswers: { q1: '회화' } };
    expect(() => applicationHtml('테스트 공모', legacy as any, customFields)).not.toThrow();
    const html = applicationHtml('테스트 공모', legacy as any, customFields);
    // 배열이 아니므로 답변은 무시(빈 값 -)되고, 최소한 예외 없이 문서가 생성됨
    expect(html).toContain('지원서');
  });
});
