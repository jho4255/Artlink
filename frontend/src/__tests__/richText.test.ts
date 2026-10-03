import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { RICH_TAGS, isRichHtml, plainToHtml, toEditorHtml, sanitizeRich, richTextLength, richToText } from '@/lib/richText';

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

/** 2026-10-03 — 공모 소개·전시 소개도 서식 있는 글. HTML 을 그릴 수 없는 곳(단체전 도록 PDF)은 글자로 바꿔 싣는다 */
describe('서식 있는 글 → 줄바꿈이 살아 있는 글자 (richToText)', () => {
  it('문단·제목은 빈 줄, 목록은 •, 줄바꿈은 줄바꿈 — 태그는 남지 않는다', () => {
    const out = richToText('<h2>모집 요강</h2><p>회화 <strong>신진</strong> 작가<br>둘째 줄</p><ul><li><p>개인전</p></li><li><p>단체전</p></li></ul><p>끝</p>');
    expect(out).toBe('모집 요강\n\n회화 신진 작가\n둘째 줄\n\n• 개인전\n• 단체전\n\n끝');
    expect(out).not.toMatch(/[<>]/);
  });
  it('옛 평범한 글은 그대로 · 빈 값은 빈 글', () => {
    expect(richToText('그냥 글\n둘째 줄')).toBe('그냥 글\n둘째 줄');
    expect(richToText(null)).toBe('');
  });
  it('위험한 태그는 글자로도 새지 않는다', () => {
    expect(richToText('<p>안녕<script>alert(1)</script></p>')).toBe('안녕');
  });
});

describe('소스 가드 — 공모·전시 소개는 서식 있는 글로 그리고 쓴다', () => {
  const read = (rel: string) => readFileSync(resolve(__dirname, '..', rel), 'utf8');
  it('공모 상세·전시 상세는 RichText 로 그리고 LazyRichTextEditor 로 고친다(평범한 <p> 로 그리면 태그가 글자로 찍힌다)', () => {
    for (const f of ['pages/ExhibitionDetailPage.tsx', 'pages/ShowDetailPage.tsx']) {
      const src = read(f);
      expect(src, f).toMatch(/<RichText value=\{(exhibition|show)\.description\}/);
      expect(src, f).toContain('<LazyRichTextEditor');
      expect(src, f).not.toMatch(/whitespace-pre-wrap[^>]*>\{(exhibition|show)\.description\}/);
    }
  });
  it('등록 폼의 소개 편집기는 함수형으로 갱신한다 — 편집기가 처음 콜백을 붙들면 다른 칸을 되돌린다', () => {
    const my = read('pages/MyPage.tsx');
    expect(my).toContain("onChange={(v) => { setForm(prev => ({ ...prev, description: v })); clearError('description'); }}");
    expect(my).toContain('onChange={(v) => setForm(prev => ({ ...prev, description: v }))} placeholder="전시 소개"');
    expect(read('components/admin/HostedExhibitionsSection.tsx')).toContain("onChange={(v) => { setForm(prev => ({ ...prev, description: v })); clearError('description'); }}");
  });
  it('편집기는 바깥 값 변경(임시저장 복원·제출 뒤 비우기)을 따라간다', () => {
    const ed = read('components/shared/RichTextEditor.tsx');
    expect(ed).toContain('lastEmitted');
    expect(ed).toMatch(/setContent\(toEditorHtml\(value\), \{ emitUpdate: false \}\)/);
    expect(ed).toContain('onChangeRef.current(html)');
  });
});
