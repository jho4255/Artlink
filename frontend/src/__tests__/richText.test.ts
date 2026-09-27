import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { RICH_TAGS, isRichHtml, plainToHtml, toEditorHtml, sanitizeRich, richTextLength } from '@/lib/richText';

/** 서식 있는 글 (2026-09-28) — 갤러리 소개·기록 본문. 화면이 HTML 로 그리므로 여기가 두 번째 문이다(첫째는 서버). */
describe('서식 있는 글 — 화면 쪽', () => {
  it('허용 태그 목록 = 서버 목록 — 한쪽만 넓히면 저장은 되는데 화면에서 사라진다(또는 반대)', () => {
    const src = readFileSync(resolve(__dirname, '../../../backend/src/lib/richText.ts'), 'utf8');
    const m = src.match(/export const RICH_TAGS = \[([^\]]+)\]/);
    const server = m![1].split(',').map((t) => t.trim().replace(/'/g, ''));
    expect(server).toEqual(RICH_TAGS);
  });

  it('★ 그릴 때 한 번 더 거른다 — 스크립트·이벤트 속성·javascript: 링크·style·이미지', () => {
    const out = sanitizeRich('<p onclick="x()" style="color:red">글<script>alert(1)</script><img src=x onerror=alert(1)><a href="javascript:alert(1)">나쁜</a></p><iframe src="//e"></iframe>');
    expect(out).not.toMatch(/script|onclick|onerror|style=|<img|<iframe|javascript:/i);
    expect(out).toContain('글');
  });

  it('서식은 남고 링크엔 새 창 + rel 이 붙는다', () => {
    const out = sanitizeRich('<h2>제목</h2><p><strong>굵게</strong> <a href="https://a.com">링크</a></p><ul><li><p>하나</p></li></ul>');
    expect(out).toContain('<h2>제목</h2>');
    expect(out).toContain('<strong>굵게</strong>');
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer nofollow"');
  });

  it('옛 평범한 글은 HTML 이 아니다 — 편집기에 넣을 땐 빈 줄 = 문단, 한 줄바꿈 = <br>, 꺾쇠는 글자로', () => {
    expect(isRichHtml('첫 줄\n둘째')).toBe(false);
    expect(isRichHtml('<p>문단</p>')).toBe(true);
    expect(plainToHtml('첫 줄\n둘째 줄\n\n새 문단 <b>')).toBe('<p>첫 줄<br>둘째 줄</p><p>새 문단 &lt;b&gt;</p>');
    expect(toEditorHtml('<h2>이미 HTML</h2>')).toBe('<h2>이미 HTML</h2>');
    expect(toEditorHtml(null)).toBe('');
  });

  it('보이는 글자 수는 태그를 빼고 센다(서버 한도와 같은 기준)', () => {
    expect(richTextLength('<p><strong>가나</strong>다</p>')).toBe(3);
    expect(richTextLength('평범한 글')).toBe(5);
  });
});
