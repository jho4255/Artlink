import { useMemo } from 'react';
import { isRichHtml, sanitizeRich } from '@/lib/richText';

/**
 * 서식 있는 글 보기 (2026-09-28) — 갤러리 소개·지난 활동 기록 본문.
 * HTML 이면 걸러서(`sanitizeRich`) 그리고, 옛 평범한 글이면 예전처럼 줄바꿈을 살려 그린다.
 * 모양은 `index.css` 의 `.rich-text` 한 곳 — 편집기 안(TipTap)도 같은 클래스를 써서 **쓰는 모양 = 보이는 모양**이다.
 */
export default function RichText({ value, className = '' }: { value: string; className?: string }) {
  const rich = isRichHtml(value);
  const html = useMemo(() => (rich ? sanitizeRich(value) : ''), [rich, value]);
  if (!rich) return <p className={`whitespace-pre-wrap ${className}`}>{value}</p>;
  // ⚠️ html 은 sanitizeRich(DOMPurify, 허용 목록)를 거친 값만 — 이 자리에 걸러지지 않은 문자열을 넣지 말 것
  return <div className={`rich-text ${className}`} dangerouslySetInnerHTML={{ __html: html }} />;
}
