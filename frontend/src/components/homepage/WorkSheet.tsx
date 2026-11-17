import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, ChevronLeft, ChevronRight, Edit3, Expand, Heart, Share2 } from 'lucide-react';
import Thumb from '@/components/shared/Thumb';
import { AVAILABLE_DOT, artworkTitle, hasTitle, museumCaption, priceLabel, statusBadge } from '@/lib/artwork';
import { readViewerMode, saveViewerMode, wallPrefetchAllowed, type ViewerMode } from '@/lib/wallView';
import { useWallView } from '@/hooks/useWallView';
import { useEscapeKey } from '@/hooks/useEscapeKey';
import type { PortfolioImage } from '@/types';
import { LinkAction, OwnerLink, PrimaryAction } from './Actions';

/**
 * 작품 한 점의 페이지 (2026-11-14, CLAUDE.md 규칙 82) — 작가 홈페이지에서 작품을 누르면 열린다. 주소는 그대로 `?work=<id>`
 * (공유 링크·서버 SEO 미리보기·비회원 통계가 이미 이 주소를 쓴다 — 새 라우트를 만들지 않는다).
 *
 * 예전엔 검은 작품 창(`ArtworkViewer`)이 바로 떴다. 이제는 **흰 페이지**(작가가 고른 테마 색)에 작품 · 작품 정보 · 판매 상태 · 가격 ·
 * 설명 · **[작품 문의하기]** · 같은 시리즈. 검은 창은 [크게 보기](작품을 누르거나)로 그대로 연다.
 *  · [사진 | 벽에 걸어 보기] — 벽 그림은 ArtLook 엔진(hooks/useWallView, 규칙 74). 엔진을 미리 띄우는 조건도 같다
 *    (사진이 다 뜬 뒤 · 한가할 때 · 데이터 절약이면 안 한다). 고른 방식은 작품 창과 같은 곳에 기억한다(`saveViewerMode`).
 *  · 정보가 하나도 없는 작품(실서버 80%) — 제목 자리에 작가 이름, 빈 줄을 만들지 않는다.
 *  · 넘기기 — 앞/다음 화살표 · 키보드 ←/→ · 손가락으로 밀기. 주소는 replace(뒤로가기 = 작품 목록).
 *  · 휴대폰은 [작품 문의하기]가 아래 고정 줄(하단 탭바가 없는 홈페이지라 safe-area 만 둔다).
 *  · `role="dialog" aria-modal` — 앱 뒤로가기가 Esc 를 보낸다(규칙 79). 그 위에 문의 창·크게 보기가 떠 있으면 Esc 는 그쪽 몫이다.
 * ⚠️ 작품은 자르지 않는다(규칙 18) — 원본을 contain.
 */
export interface WorkLike { liked: boolean; count: number; onToggle: () => void }

export default function WorkSheet({
  works, index, artistName, themeVars, onIndex, onClose, onZoom, onInquiry, like, onShare, ownerEditHref, childOpen,
}: {
  works: PortfolioImage[];
  index: number;
  artistName: string;
  themeVars: CSSProperties;
  onIndex: (i: number) => void;
  onClose: () => void;
  /** 크게 보기(검은 작품 창) — 지금 보기 방식으로 */
  onZoom: (mode: ViewerMode) => void;
  /** 없으면 [작품 문의하기]를 그리지 않는다(주인) */
  onInquiry?: (() => void) | null;
  /** 작가 탭에도 소개한 작품만 좋아요가 된다(서버 규칙) — null 이면 그리지 않는다 */
  like?: WorkLike | null;
  onShare: () => void;
  /** 주인에게만 — 작품 정보 고치는 곳 */
  ownerEditHref?: string | null;
  /** 위에 다른 창(문의·크게 보기)이 떠 있다 — Esc·키보드를 그쪽에 양보한다 */
  childOpen: boolean;
}) {
  const n = works.length;
  const work = works[index];
  const [mode, setMode] = useState<ViewerMode>(() => readViewerMode());
  const urls = useMemo(() => works.map((w) => w.url), [works]);
  const wall = useWallView({ urls, index, active: mode === 'wall' });
  const showWall = mode === 'wall' && wall.available;
  const scroller = useRef<HTMLDivElement>(null);

  useEscapeKey(onClose, { enabled: !childOpen });

  // 스크롤 잠금 — 아래 홈페이지가 같이 밀리지 않게(닫으면 보던 자리 그대로)
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  // 작품이 바뀌면 맨 위로
  useEffect(() => { scroller.current?.scrollTo({ top: 0 }); }, [work?.id]);

  // 키보드 ←/→ — 리스너는 한 번만 붙이고 최신 값은 ref 로 본다(부모가 매 렌더 새 콜백을 준다)
  const indexRef = useRef(index);
  const childRef = useRef(childOpen);
  const onIndexRef = useRef(onIndex);
  useEffect(() => { indexRef.current = index; childRef.current = childOpen; onIndexRef.current = onIndex; });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (childRef.current || n < 2) return;
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (e.key === 'ArrowLeft') onIndexRef.current((indexRef.current - 1 + n) % n);
      else if (e.key === 'ArrowRight') onIndexRef.current((indexRef.current + 1) % n);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [n]);

  // 벽 엔진 미리 띄우기 — 작품 창과 같은 조건(사진이 뜬 뒤 · 한가할 때 · 데이터 절약이면 안 한다)
  const [shownPhoto, setShownPhoto] = useState<number | null>(null);
  const { warm, available: wallAvailable } = wall;
  const currentId = work?.id;
  useEffect(() => {
    if (mode !== 'photo' || !wallAvailable || currentId == null || !wallPrefetchAllowed()) return;
    type IdleWindow = Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (h: number) => void };
    const w = window as IdleWindow;
    let idle = 0;
    const t = window.setTimeout(() => {
      if (w.requestIdleCallback) idle = w.requestIdleCallback(() => warm(), { timeout: 1000 });
      else warm();
    }, shownPhoto === currentId ? 300 : 3000);
    return () => { window.clearTimeout(t); if (idle) w.cancelIdleCallback?.(idle); };
  }, [mode, wallAvailable, warm, currentId, shownPhoto]);

  // 손가락으로 밀기
  const touch = useRef<{ x: number; y: number } | null>(null);
  const go = (d: number) => { if (n > 1) onIndex((index + d + n) % n); };

  // 같은 시리즈(지금 작품 빼고, 화면 순서대로 12점까지)
  const series = (work?.series ?? '').trim();
  const siblings = useMemo(
    () => (series ? works.map((w, i) => ({ w, i })).filter(({ w }) => (w.series ?? '').trim() === series && w.id !== work?.id).slice(0, 12) : []),
    [works, series, work?.id],
  );

  if (!work) return null;
  const titled = hasTitle(work);
  const cap = museumCaption(work);
  // 연도 · 재료 · 크기 — 제목은 위 h1 이 든다(제목이 없으면 h1 이 작가 이름)
  const metaLines = [(work.year ?? '').trim(), cap?.medium, cap?.size].filter(Boolean) as string[];
  const st = statusBadge(work);
  const price = priceLabel(work);
  const desc = (work.description ?? '').trim();
  const alt = titled ? artworkTitle(work) : `${artistName} 작품`;
  const choose = (m: ViewerMode) => { setMode(m); saveViewerMode(m); };

  let media: ReactNode;
  if (showWall && wall.src) {
    media = <motion.img key={`wall-${work.id}`} src={wall.src} alt={`${alt} — 벽에 건 모습`} data-view="wall" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.18 }} className="max-h-full max-w-full object-contain" draggable={false} />;
  } else if (showWall) {
    media = <Thumb key={`wait-${work.id}`} src={work.url} size="grid" alt={alt} data-view="wall-pending" className="max-h-full max-w-full object-contain opacity-40" draggable={false} />;
  } else {
    media = (
      <motion.img
        key={`photo-${work.id}`}
        src={work.url}
        alt={alt}
        data-view="photo"
        decoding="async"
        draggable={false}
        onLoad={() => setShownPhoto(work.id)}
        onError={() => setShownPhoto(work.id)}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2 }}
        className="max-h-full max-w-full cursor-zoom-in object-contain"
        onClick={() => onZoom(mode)}
      />
    );
  }

  const seg = (on: boolean) =>
    `min-h-[40px] whitespace-nowrap px-3.5 text-[13px] transition-colors ${on ? 'bg-[var(--hp-ink)] font-medium text-[var(--hp-bg)]' : 'text-[var(--hp-sub)] hover:text-[var(--hp-ink)]'}`;

  const likeButton = like ? (
    <LinkAction
      icon={Heart}
      iconClassName={like.liked ? 'fill-accent text-accent' : ''}
      onClick={like.onToggle}
      aria-pressed={like.liked}
      aria-label={like.liked ? '좋아요 취소' : '좋아요'}
    >
      {like.count > 0 ? like.count : '좋아요'}
    </LinkAction>
  ) : null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${titled ? artworkTitle(work) : '작품'} — ${artistName}`}
      data-testid="work-sheet"
      className="fixed inset-0 z-50 flex flex-col bg-[var(--hp-bg)] text-[var(--hp-ink)]"
      style={{ ...themeVars, fontFamily: 'var(--hp-body-font)' }}
    >
      {/* 머리 — ← 작품 목록 · 작가 이름 · 몇 번째 */}
      <div className="shrink-0 border-b border-[var(--hp-line)]">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-2 px-3 md:px-12 lg:h-[72px]">
          <button type="button" onClick={onClose} aria-label="작품 목록으로" className="-ml-1 grid h-11 w-11 shrink-0 place-items-center text-[var(--hp-ink)] hover:opacity-70 md:-ml-3">
            <ArrowLeft size={20} />
          </button>
          <span className="min-w-0 flex-1 truncate text-[16px] font-semibold lg:text-[19px]" style={{ fontFamily: 'var(--hp-title-font)' }}>{artistName}</span>
          {n > 1 && <span className="shrink-0 text-[13px] tabular-nums text-[var(--hp-sub)]">{index + 1} / {n}</span>}
        </div>
      </div>

      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-7xl px-6 pb-28 pt-5 md:px-12 md:pb-16 md:pt-8 lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-12">
          {/* 작품 */}
          <figure className="min-w-0">
            <div
              className="relative flex h-[min(62svh,560px)] items-center justify-center lg:h-[min(72vh,760px)]"
              onTouchStart={(e) => { const t = e.touches[0]; touch.current = e.touches.length === 1 && t ? { x: t.clientX, y: t.clientY } : null; }}
              onTouchEnd={(e) => {
                const s = touch.current; touch.current = null;
                const end = e.changedTouches[0];
                if (!s || !end || n < 2 || (window.visualViewport?.scale ?? 1) > 1.01) return;
                const dx = end.clientX - s.x, dy = end.clientY - s.y;
                if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.2) go(dx < 0 ? 1 : -1);
              }}
            >
              {media}
              {showWall && !wall.src && (
                <div className="pointer-events-none absolute inset-0 grid place-items-center px-6">
                  {wall.status === 'failed' ? (
                    <p role="status" className="pointer-events-auto bg-[var(--hp-bg)] px-4 py-2 text-sm">
                      벽에 걸지 못했어요
                      <button type="button" onClick={wall.retry} className="ml-2 min-h-[32px] font-medium underline underline-offset-4">다시 시도</button>
                    </p>
                  ) : (
                    <motion.p role="status" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.35, duration: 0.2 }} className="bg-[var(--hp-bg)] px-4 py-2 text-sm text-[var(--hp-sub)]">
                      벽에 거는 중…
                    </motion.p>
                  )}
                </div>
              )}
              {n > 1 && (
                <>
                  <button type="button" aria-label="이전 작품" onClick={() => go(-1)} className="absolute left-0 top-1/2 hidden h-11 w-11 -translate-y-1/2 place-items-center text-[var(--hp-sub)] hover:text-[var(--hp-ink)] md:grid lg:-left-2">
                    <ChevronLeft size={28} />
                  </button>
                  <button type="button" aria-label="다음 작품" onClick={() => go(1)} className="absolute right-0 top-1/2 hidden h-11 w-11 -translate-y-1/2 place-items-center text-[var(--hp-sub)] hover:text-[var(--hp-ink)] md:grid lg:-right-2">
                    <ChevronRight size={28} />
                  </button>
                </>
              )}
            </div>
            {/* 보기 방식 · 크게 보기 */}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              {wall.available ? (
                <div role="group" aria-label="보기 방식" className="flex border border-[var(--hp-line)]">
                  <button type="button" aria-pressed={!showWall} onClick={() => choose('photo')} className={seg(!showWall)}>사진</button>
                  <button type="button" aria-pressed={showWall} onClick={() => choose('wall')} onPointerEnter={wall.warm} onPointerDown={wall.warm} onFocus={wall.warm} className={seg(showWall)}>벽에 걸어 보기</button>
                </div>
              ) : mode === 'wall' ? (
                <p className="text-xs text-[var(--hp-sub)]">이 브라우저에서는 벽에 걸어 볼 수 없어요</p>
              ) : <span />}
              <LinkAction icon={Expand} onClick={() => onZoom(mode)}>크게 보기</LinkAction>
            </div>
          </figure>

          {/* 작품 정보 — PC 는 오른쪽 칸(붙어 따라온다) */}
          <section className="mt-6 min-w-0 lg:sticky lg:top-6 lg:mt-0 lg:self-start" aria-label="작품 정보">
            <h1 className="text-[22px] font-semibold leading-snug tracking-[-0.01em] break-keep [overflow-wrap:anywhere] lg:text-[26px]" style={{ fontFamily: 'var(--hp-title-font)' }}>
              {titled ? artworkTitle(work) : artistName}
            </h1>
            {metaLines.length > 0 && (
              <p className="mt-2 text-[14px] leading-relaxed text-[var(--hp-sub)] break-keep [overflow-wrap:anywhere]" data-testid="work-meta">
                {metaLines.map((l, i) => <span key={i} className="block">{l}</span>)}
              </p>
            )}
            {(st || price) && (
              <p className="mt-4 flex flex-wrap items-baseline gap-x-2.5 text-[15px]" data-testid="work-sale">
                {price && <span className="text-[17px] font-semibold text-[var(--hp-ink)]" data-artwork-price>{price}</span>}
                {st && (
                  <span className="text-[13px] text-[var(--hp-sub)]" data-sale-status={st.tone}>
                    <span aria-hidden className={st.tone === 'sold' ? 'text-accent' : undefined} style={st.tone === 'available' ? { color: AVAILABLE_DOT } : undefined}>●</span> {st.label}
                  </span>
                )}
              </p>
            )}
            {desc && (
              <p className="mt-5 whitespace-pre-wrap border-t border-[var(--hp-line)] pt-5 text-[15px] leading-[1.85] break-keep [overflow-wrap:anywhere]">{desc}</p>
            )}

            <div className="mt-6 hidden flex-col items-start gap-2 md:flex">
              {onInquiry && <PrimaryAction onClick={onInquiry} className="w-full">작품 문의하기</PrimaryAction>}
              {ownerEditHref && <OwnerLink to={ownerEditHref} testId="work-owner-edit"><Edit3 size={14} /> 작품 정보 수정</OwnerLink>}
              <div className="flex flex-wrap items-center gap-x-5">
                {likeButton}
                <LinkAction icon={Share2} onClick={onShare}>공유</LinkAction>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-x-5 md:hidden">
              {ownerEditHref && <OwnerLink to={ownerEditHref} testId="work-owner-edit-m"><Edit3 size={14} /> 작품 정보 수정</OwnerLink>}
              <LinkAction icon={Share2} onClick={onShare}>공유</LinkAction>
            </div>
          </section>
        </div>

        {/* 같은 시리즈 */}
        {siblings.length > 0 && (
          <section className="mx-auto max-w-7xl px-6 pb-32 md:px-12 md:pb-16" aria-label={`${series} 시리즈`}>
            <h2 className="mb-3 text-[15px] font-semibold" style={{ fontFamily: 'var(--hp-title-font)' }}>{series}</h2>
            <div className="flex gap-3 overflow-x-auto pb-2 [scrollbar-width:thin]">
              {siblings.map(({ w, i }) => (
                <button key={w.id} type="button" onClick={() => onIndex(i)} className="w-32 shrink-0 text-left md:w-36" aria-label={hasTitle(w) ? artworkTitle(w) : `${i + 1}번째 작품`}>
                  <span className="grid aspect-square place-items-center">
                    <Thumb src={w.url} size="grid" alt="" loading="lazy" className="max-h-full max-w-full object-contain" />
                  </span>
                  {hasTitle(w) && <span className="mt-1.5 block truncate text-[13px] text-[var(--hp-sub)]">{artworkTitle(w)}</span>}
                </button>
              ))}
            </div>
          </section>
        )}
      </div>

      {/* 휴대폰 — 아래 고정 줄: 좋아요 · [작품 문의하기] */}
      {(onInquiry || like) && (
        <div className="shrink-0 border-t border-[var(--hp-line)] bg-[var(--hp-bg)] px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-3 md:hidden">
          <div className="flex items-center gap-3">
            {likeButton}
            {onInquiry && <PrimaryAction onClick={onInquiry} className="flex-1">작품 문의하기</PrimaryAction>}
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
