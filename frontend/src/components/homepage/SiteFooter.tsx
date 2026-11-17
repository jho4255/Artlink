import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Instagram } from 'lucide-react';
import { instagramHandle, safeHttpUrl } from '@/lib/utils';
import { LINK_ACTION } from './Actions';

/**
 * 홈페이지 꼬리말 (2026-11-14, CLAUDE.md 규칙 82) — ArtLink 회사 정보 푸터 대신 그 주인의 연락처.
 *
 * 왼쪽: 이름 · (갤러리면 주소·전화) · 인스타 · [문의하기](받는 경우 — 스크롤 끝에서 한 번 더, 글자 링크).
 * 오른쪽: `Made with ArtLink`(상단바가 없는 홈페이지에서 아트링크로 가는 길) · 개인정보처리방침 · 이용약관
 * (비회원 문의가 이 페이지에서 이름·연락처를 받으므로 방침으로 가는 길을 같은 화면에 둔다).
 * ⚠️ 작가의 이메일·전화는 싣지 않는다 — 지금 공개 정보가 아니다.
 */
export default function SiteFooter({ name, lines, instagramUrl, onInquiry }: {
  name: string;
  /** 이름 아래 줄들(갤러리: 주소·전화) */
  lines?: ReactNode[];
  instagramUrl?: string | null;
  onInquiry?: () => void;
}) {
  const ig = safeHttpUrl(instagramUrl);
  return (
    <footer className="border-t" style={{ borderColor: 'var(--hp-line, #e5e7eb)' }} data-testid="site-footer">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-6 pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-10 md:flex-row md:items-end md:justify-between md:px-12 md:pb-12 md:pt-12">
        <div className="min-w-0 text-[14px] text-[var(--hp-sub)]">
          <p className="text-[15px] font-semibold text-[var(--hp-ink)] break-keep [overflow-wrap:anywhere]">{name}</p>
          {lines?.filter(Boolean).map((l, i) => <p key={i} className="mt-1 break-keep [overflow-wrap:anywhere]">{l}</p>)}
          {(ig || onInquiry) && (
            <div className="mt-1 flex flex-wrap items-center gap-x-5">
              {ig && (
                <a href={ig} target="_blank" rel="noreferrer" className={LINK_ACTION}>
                  <Instagram size={14} aria-hidden /> {instagramHandle(instagramUrl) ?? 'Instagram'}
                </a>
              )}
              {onInquiry && <button type="button" onClick={onInquiry} className={LINK_ACTION}>문의하기</button>}
            </div>
          )}
        </div>
        <div className="flex flex-col items-start gap-1 text-[12px] text-[var(--hp-sub)] md:items-end">
          <Link to="/" className="inline-flex min-h-[32px] items-center hover:underline underline-offset-4" data-testid="made-with-artlink">
            Made with&nbsp;<span className="font-serif font-bold text-[var(--hp-ink)]">Art</span><span className="font-serif font-bold text-accent">Link</span>
          </Link>
          <div className="flex gap-3">
            <Link to="/privacy" className="inline-flex min-h-[32px] items-center hover:underline underline-offset-4">개인정보처리방침</Link>
            <Link to="/terms" className="inline-flex min-h-[32px] items-center hover:underline underline-offset-4">이용약관</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
