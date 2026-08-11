/**
 * ZIP 다운로드용 제출물 PDF(HTML) 회귀 테스트.
 *
 * 실제로 겪은 문제들을 고정한다:
 *  - 작가노트 PDF에 작품 사진이 아예 안 들어갔다 (상세설명은 출품작에 붙는 글인데 텍스트만 나감)
 *  - 표 이미지에 width/height를 함께 줘서 작품 비율이 찌그러졌다 (CLAUDE.md 18)
 *  - 열 정렬이 행마다 어긋나 보였다 (table-layout 미고정 + 열별 정렬 혼용)
 */
import { describe, it, expect } from 'vitest';
import { artworkHtml, noteHtml } from '../lib/operationPdf';
import type { OperationSubmission } from '../types';

const submission = {
  artworkList: [
    { image: 'https://img.example/a.jpg', title: '푸른 밤', size: '72.7×60.6 cm', medium: 'Acrylic on canvas', year: '2026', price: '500000' },
    { image: '', title: '사진 없는 작품', size: '30×30 cm', medium: 'Oil', year: '2025', price: '비매' },
  ],
  cv: null,
  note: {
    statement: '제 작업은 도시의 빛을 다룹니다.',
    sections: [
      { title: '푸른 밤', body: '이 작품은...' },
      { title: '출품리스트에 없는 작품', body: '옛 데이터' },
    ],
  },
} as unknown as OperationSubmission;

describe('artworkHtml (출품리스트 PDF)', () => {
  const html = artworkHtml(submission, '테스트 공모', '홍길동', 'a@b.com');

  it('사진 칸 크기는 통일하되 이미지는 max-*로만 제한해 비율을 유지한다', () => {
    // 고정 크기 박스 안에 max-* 이미지 — html2canvas는 object-fit을 재현하지 못해
    // 박스에 꽉 늘려 그리므로(작품 왜곡) object-fit에 의존하면 안 된다
    expect(html).toContain('width:88px;height:88px');
    expect(html).toContain('max-width:88px');
    expect(html).toContain('max-height:88px');
    expect(html).not.toMatch(/<img[^>]*object-fit/);
    expect(html).not.toMatch(/<img[^>]*style="[^"]*[^-]width:\d+px;height:\d+px/);
  });

  it('열 너비 고정 + 모든 칸 가운데 정렬', () => {
    expect(html).toContain('table-layout:fixed');
    expect(html).toContain('<colgroup>');
    expect(html).not.toContain('text-align:left');
    expect(html).not.toContain('text-align:right');
  });

  it('크기의 단위가 줄바꿈되지 않고, 가격은 콤마+원 표기', () => {
    expect(html).toContain('white-space:nowrap');
    expect(html).toContain('500,000원');
    expect(html).toContain('비매'); // 자유 텍스트는 원문 유지
  });

  it('이미지가 없는 작품은 빈 칸 표시로 대체', () => {
    expect(html).toContain('사진 없는 작품');
    expect((html.match(/<img/g) || []).length).toBe(1);
  });
});

describe('noteHtml (작가노트 PDF)', () => {
  const html = noteHtml(submission, '테스트 공모', '홍길동', 'a@b.com');

  it('상세설명에 해당 출품작 사진과 캡션 정보가 함께 실린다', () => {
    // 이미지는 CORS 회피용 프록시를 거치므로 URL이 인코딩되어 들어간다
    expect(html).toContain(encodeURIComponent('https://img.example/a.jpg'));
    expect(html).toContain('72.7×60.6 cm · Acrylic on canvas · 2026');
    // 사진 칸 크기 통일 + 비율 유지
    expect(html).toContain('width:130px;height:130px');
    expect(html).toContain('max-width:130px');
    expect(html).not.toMatch(/<img[^>]*object-fit/);
  });

  it('출품리스트에 없는 제목은 사진 없이 본문만 유지 (옛 데이터 보존)', () => {
    expect(html).toContain('출품리스트에 없는 작품');
    expect(html).toContain('옛 데이터');
    expect((html.match(/<img/g) || []).length).toBe(1);
  });

  it('헤더에 이미 있는 제목·작가명을 본문에서 중복 출력하지 않는다', () => {
    expect(html).toContain('제 작업은 도시의 빛을 다룹니다.');
    // 문서 제목은 header()가 만드는 h1 하나뿐, 작가명도 한 번만
    expect((html.match(/작가노트/g) || []).length).toBe(1);
    expect((html.match(/홍길동/g) || []).length).toBe(1);
  });

  it('노트가 비어 있으면 안내 문구', () => {
    const empty = noteHtml({ artworkList: [], cv: null, note: null } as unknown as OperationSubmission, '공모', '홍길동');
    expect(empty).toContain('등록된 작가노트가 없습니다');
  });
});
