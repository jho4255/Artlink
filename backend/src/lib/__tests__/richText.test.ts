import { describe, it, expect } from 'vitest';
import { isRichHtml, richTextPlain, sanitizeRichText } from '../richText';

/** 서식 있는 글 (2026-09-28) — 갤러리 소개·지난 활동 기록 본문. 화면이 HTML 로 그리므로 여기가 저장형 XSS 의 문이다. */
describe('sanitizeRichText', () => {
  it('편집기가 만드는 서식은 남긴다 — 제목·굵게·기울임·밑줄·목록·인용·구분선·링크', () => {
    const html = '<h2>공간</h2><p><strong>굵게</strong> <em>기울임</em> <u>밑줄</u></p><ul><li><p>하나</p></li></ul><ol><li><p>둘</p></li></ol><blockquote><p>인용</p></blockquote><hr><p><a href="https://example.com">링크</a></p>';
    const out = sanitizeRichText(html)!;
    for (const t of ['<h2>', '<strong>', '<em>', '<u>', '<ul>', '<ol>', '<li>', '<blockquote>', '<hr />', 'href="https://example.com"']) expect(out).toContain(t);
  });

  it('★ 스크립트·이벤트 속성·javascript: 링크·style·이미지는 지운다', () => {
    const out = sanitizeRichText('<p onclick="x()" style="color:red">글<script>alert(1)</script><img src=x onerror=alert(1)><a href="javascript:alert(1)">나쁜</a><iframe src="//evil"></iframe></p>')!;
    expect(out).not.toMatch(/script|onclick|onerror|style=|<img|<iframe|javascript:/i);
    expect(out).toContain('글');
  });

  it('링크는 새 창 + rel 을 서버가 붙인다(작성자가 빼도)', () => {
    const out = sanitizeRichText('<p><a href="https://a.com" target="_self" rel="opener">a</a></p>')!;
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer nofollow"');
  });

  it('평범한 글(옛 값)은 그대로 — 줄바꿈도 그대로', () => {
    expect(sanitizeRichText('  첫 줄\n둘째 줄  ')).toBe('첫 줄\n둘째 줄');
    expect(isRichHtml('첫 줄\n둘째')).toBe(false);
  });

  it('비었으면 null — 빈 문단만 있는 편집기 값도', () => {
    expect(sanitizeRichText('')).toBeNull();
    expect(sanitizeRichText('   ')).toBeNull();
    expect(sanitizeRichText('<p></p>')).toBeNull();
    expect(sanitizeRichText(123)).toBeNull();
  });

  it('끝의 빈 문단은 지운다(Enter 를 한 번 더 누른 자리)', () => {
    expect(sanitizeRichText('<p>글</p><p></p><p><br></p>')).toBe('<p>글</p>');
  });

  it('보이는 글자 수는 태그를 빼고 센다', () => {
    expect(richTextPlain('<p><strong>가나</strong>다</p>')).toBe('가나다');
  });
});
