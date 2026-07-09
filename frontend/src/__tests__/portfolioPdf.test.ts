import { describe, it, expect } from 'vitest';
import { portfolioHtml } from '../lib/portfolioPdf';

const fullData = {
  user: {
    name: '홍길동',
    nickname: '길동이',
    email: 'artist@example.com',
    phone: '010-1234-5678',
    instagramUrl: 'https://instagram.com/gildong_art',
  },
  biography: '빛과 색을 탐구하는 회화 작가입니다.',
  career: {
    artFair: [{ year: '2025', content: '아트부산' }],
    solo: [{ year: '2024', content: "개인전 '빛의 결'" }],
    group: [],
  },
  images: [{ url: '/uploads/a.jpg' }, { url: '/uploads/b.jpg' }, { url: '/uploads/c.jpg' }],
};

describe('portfolioHtml - 작가 포트폴리오 PDF', () => {
  it('이름(닉네임 우선)·연락처·약력·경력·작품이 모두 포함된다', () => {
    const html = portfolioHtml(fullData as any);
    expect(html).toContain('ARTIST PORTFOLIO');
    expect(html).toContain('길동이');                    // displayName: nickname 우선
    expect(html).toContain('artist@example.com');
    expect(html).toContain('@gildong_art');              // instagram URL → @handle 축약
    expect(html).toContain('빛과 색을 탐구하는 회화 작가입니다.');
    expect(html).toContain('아트부산');
    expect(html).toContain("개인전 '빛의 결'");
    expect(html).toContain('작품 (3)');
    expect((html.match(/<img /g) || []).length).toBe(3); // 작품 3장 (avatar 없음)
  });

  it('생성일자/ArtLink 푸터는 넣지 않는다', () => {
    const html = portfolioHtml(fullData as any);
    expect(html).not.toContain('생성');
    expect(html).not.toContain('ArtLink');
  });

  it('경력 연도를 강제하지 않는다: 연도 없으면 내용만, 있으면 연도+내용', () => {
    const html = portfolioHtml({
      user: { name: '작가' },
      career: {
        artFair: [],
        solo: [
          { year: '', content: '뉴욕 레지던시 참여 (2020–2022)' }, // 연도 필드 없이 내용에 직접 기입
          { year: '2024', content: "개인전 '결'" },
        ],
        group: [],
      },
    } as any);
    expect(html).toContain('뉴욕 레지던시 참여 (2020–2022)');
    expect(html).toContain("개인전 '결'");
    // 연도 없는 항목은 연도 span 없이 렌더 (빈 연도 자리 없음)
    expect(html).not.toContain('><span style="color:#999;margin-right:12px"></span>');
  });

  it('작품 이미지는 원자 블록, 섹션 제목은 keep-next로 표시된다 (페이지 잘림 방지)', () => {
    const html = portfolioHtml(fullData as any);
    expect((html.match(/data-pdf-atomic/g) || []).length).toBeGreaterThanOrEqual(4); // 이미지 3 + 경력 그룹
    expect(html).toContain('data-pdf-keep-next');
  });

  it('작품은 정사각 썸네일 그리드로 표시되고 각 이미지가 원자 블록이다', () => {
    const html = portfolioHtml(fullData as any);
    expect(html).toContain('width:360px;height:360px'); // 정사각 썸네일
    expect(html).toContain('object-fit:cover');
  });

  it('작품 섹션은 강제 페이지 나눔(data-pdf-break-before)으로 경력 다음 페이지부터 시작한다', () => {
    const html = portfolioHtml(fullData as any);
    expect(html).toContain('data-pdf-break-before');
    // 작품이 없으면 강제 나눔 마커도 없음
    const noWorks = portfolioHtml({ user: { name: 'x' }, career: fullData.career } as any);
    expect(noWorks).not.toContain('data-pdf-break-before');
  });

  it('빈 포트폴리오도 크래시 없이 생성된다 (경력/작품 섹션은 생략)', () => {
    const html = portfolioHtml({ user: { name: '신인작가' } } as any);
    expect(html).toContain('신인작가');
    expect(html).toContain('등록된 약력이 없습니다');
    expect(html).not.toContain('작품 (');
    expect(html).not.toContain('아트페어');
  });

  it('사용자 입력의 HTML은 이스케이프된다 (XSS 방지)', () => {
    const html = portfolioHtml({
      user: { name: '<script>alert(1)</script>' },
      biography: '<img src=x onerror=alert(1)>',
    } as any);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<img src=x');
  });
});
