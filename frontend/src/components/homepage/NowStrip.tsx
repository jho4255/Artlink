import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { nowShowingHref, nowShowingParts, type NowShowing } from '@/lib/homepageSite';

/**
 * '전시 중' 띠 (2026-11-14, CLAUDE.md 규칙 82) — 작가 홈페이지 첫 화면에 지금 하는(30일 안에 시작하는) 전시 한 줄.
 * 서버가 정해 준다(`lib/nowShowing.ts` — 선정된 공모 · 전시 기간 · 갤러리가 숨긴 작가는 뺀다). 작가가 [꾸미기]에서 끌 수 있다.
 * '전시 중' 글자만 강조색(규칙 47 — 빨강은 상태에만). 누르면 그 갤러리 홈페이지(갤러리 없이 연 아트링크 공모면 공모 상세).
 * 편집 미리보기(`asLink=false`)에서는 눌리지 않는다.
 */
export default function NowStrip({ now, asLink = true }: { now: NowShowing; asLink?: boolean }) {
  const p = nowShowingParts(now);
  const body = (
    <>
      <span className="shrink-0 text-[12px] font-semibold text-[var(--hp-accent)]">{p.label}</span>
      <span className="min-w-0 flex-1 text-[14px] leading-snug break-keep [overflow-wrap:anywhere]">
        <span className="text-[var(--hp-ink)]">{p.title}</span>
        {p.detail && <span className="block text-[13px] text-[var(--hp-sub)]">{p.detail}</span>}
      </span>
      {asLink && <ChevronRight size={16} aria-hidden className="shrink-0 text-[var(--hp-sub)]" />}
    </>
  );
  const cls = 'flex max-w-md items-center gap-3 border border-[var(--hp-line)] px-4 py-3';
  return asLink
    ? <Link to={nowShowingHref(now)} className={`${cls} hover:border-[var(--hp-ink)]`} data-testid="now-strip">{body}</Link>
    : <div className={cls} data-testid="now-strip">{body}</div>;
}
