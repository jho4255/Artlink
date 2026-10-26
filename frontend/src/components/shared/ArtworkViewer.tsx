import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { ChevronLeft, ChevronRight, Share2, X } from 'lucide-react';
import Thumb from '@/components/shared/Thumb';
import { AVAILABLE_DOT, artworkTitle, hasTitle, museumCaption, priceLabel, statusBadge } from '@/lib/artwork';
import { readViewerMode, saveViewerMode, wallPrefetchAllowed, type ViewerMode } from '@/lib/wallView';
import { useWallView } from '@/hooks/useWallView';
import type { PortfolioImage } from '@/types';

/**
 * 작가 홈페이지의 작품 보기 — 대표작·작품 격자를 누르면 열린다(PortfolioPage, `?work=<id>` 고유 주소).
 *
 * 2026-10-22 (CLAUDE.md 규칙 74) — 미미오 작가 페이지의 [See More] 창과 견줘 모자랐던 것을 채웠다.
 *   · [사진 | 벽에 걸어 보기] — 벽 그림은 ArtLook 엔진이 그린다(hooks/useWallView). 처음엔 사진, 벽을 고르면 이 탭에서 기억한다.
 *     WebGL2 가 없거나 엔진이 안 되면 토글을 감춘다. 그리는 동안엔 흐린 사진(잠깐 뒤 '벽에 거는 중…').
 *     **엔진은 미리 띄워 둔다**(`wall.warm`, 2026-10-26 사용자 결정 — 누를 때 받으니 너무 느렸다): 사진 모드에서 지금 작품 사진이 다 뜨면
 *     잠깐 뒤 한가할 때(사진을 받는 동안엔 끼어들지 않는다 — 보고 있는 사진이 늦어진다). 사진이 안 뜨면 WARM_FALLBACK_MS 뒤에.
 *     데이터 절약·2G·3G 면 미리 받지 않는다(`wallPrefetchAllowed`) — 그때는 버튼에 마우스를 올리거나 누를 때 띄운다(예전 그대로).
 *   · 캡션 두 줄(미술관 라벨: `작품명, 연도` / `재료 · 크기 · 가격`)은 **작품 바로 아래 가운데** — 사진이든 벽이든.
 *     처음엔 화면 왼쪽 아래 구석에 두었더니 작품에서 멀어 "작품 정보가 안 보인다"고 했다(2026-10-22 로컬 확인).
 *   · 작품 공유(그 작품 주소) · 좋아요 — PC 는 위 줄 오른쪽(닫기 옆), 휴대폰은 맨 아래 줄. PC 아래 작품 썸네일 줄.
 *   · 사진의 모서리를 깎지 않는다(예전 `rounded-lg` — 작품 모서리도 작품이다, 규칙 18).
 *   · `role="dialog" aria-modal` — 비회원 소개 팝업(규칙 73)이 이 창 위로 뜨지 않고 닫힐 때까지 기다린다.
 *   · 바탕은 불투명 — 비치면 휴대폰에서 뒤 페이지의 로고·[로그인]이 [닫기] 밑에 겹쳐 보였다(예전 라이트박스는 90%).
 * 갤러리·전시 사진의 `ImageLightbox` 는 그대로다 — 토글·캡션·공유·썸네일 줄은 작품에만 뜻이 있다.
 *
 * - 사진은 **원본**(크게 보는 화면은 원본 — CLAUDE.md 21). 벽을 기다리는 동안의 흐린 사진만 t800(격자가 이미 받아 둔 것).
 * - 넘길 때마다 `onIndexChange` — 부모가 매 렌더 새 함수를 줘도 되게 ref 로 든다(ImageLightbox 와 같은 이유: 무한 루프).
 * - 부모에서 `AnimatePresence` 로 감싸야 닫힐 때 사라지는 효과가 난다.
 */
/** PC(Tailwind `md`) — 좋아요·공유를 위 줄에 둔다. **한 번만 그리고 자리만 바꾼다** — CSS 로 두 벌을 숨겨 두면 같은 단추가 둘이 된다 */
const WIDE_MEDIA = '(min-width: 768px)';
const hasMatchMedia = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function';
function subscribeWide(onChange: () => void): () => void {
  if (!hasMatchMedia()) return () => {};
  const mq = window.matchMedia(WIDE_MEDIA);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}
const readWide = () => hasMatchMedia() && window.matchMedia(WIDE_MEDIA).matches;

/** 사진이 다 뜬 뒤 엔진을 미리 띄우기까지 — 여는 효과(0.2초)가 끝나고 */
const WARM_AFTER_PHOTO_MS = 300;
/** 사진이 끝내 안 뜨면(느린 원본) 이만큼 뒤에라도 미리 띄운다 */
const WARM_FALLBACK_MS = 3000;
type IdleWindow = Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (h: number) => void };

interface ArtworkViewerProps {
  works: PortfolioImage[];
  initialIndex: number;
  artistName: string;
  onClose: () => void;
  onIndexChange?: (index: number) => void;
  /** 캡션 옆 좋아요 — 작가 탭에도 소개한 작품만(PortfolioPage renderLike) */
  renderLike?: (index: number) => React.ReactNode;
  /** 그 작품의 고유 주소 — 있으면 [공유]를 그린다 */
  shareUrl?: (index: number) => string;
}

export default function ArtworkViewer({ works, initialIndex, artistName, onClose, onIndexChange, renderLike, shareUrl }: ArtworkViewerProps) {
  const n = works.length;
  const [index, setIndex] = useState(() => Math.min(Math.max(0, initialIndex), Math.max(0, n - 1)));
  const [mode, setMode] = useState<ViewerMode>(() => readViewerMode());
  const [copiedAt, setCopiedAt] = useState<number | null>(null);
  const wide = useSyncExternalStore(subscribeWide, readWide, () => false);
  const urls = useMemo(() => works.map((w) => w.url), [works]);
  const wall = useWallView({ urls, index, active: mode === 'wall' });
  const showWall = mode === 'wall' && wall.available;

  const dialogRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const onIndexChangeRef = useRef(onIndexChange);
  useEffect(() => { onCloseRef.current = onClose; onIndexChangeRef.current = onIndexChange; });

  // 엔진 미리 띄우기 — 사진 모드에서 지금 작품 사진이 다 뜬 뒤 한가할 때(위 머리말). 넘기면 새 작품의 초안 사진도 받아 둔다
  const [shownPhoto, setShownPhoto] = useState<number | null>(null);
  const currentId = works[index]?.id;
  const { warm, available: wallAvailable } = wall;
  useEffect(() => {
    if (mode !== 'photo' || !wallAvailable || currentId == null || !wallPrefetchAllowed()) return;
    const w = window as IdleWindow;
    let idle = 0;
    const t = window.setTimeout(() => {
      if (w.requestIdleCallback) idle = w.requestIdleCallback(() => warm(), { timeout: 1000 });
      else warm();
    }, shownPhoto === currentId ? WARM_AFTER_PHOTO_MS : WARM_FALLBACK_MS);
    return () => { window.clearTimeout(t); if (idle) w.cancelIdleCallback?.(idle); };
  }, [mode, wallAvailable, warm, currentId, shownPhoto]);

  // 넘길 때만 알린다 — 처음 열릴 때는 이미 그 작품이다
  const firstRef = useRef(true);
  useEffect(() => {
    if (firstRef.current) { firstRef.current = false; return; }
    onIndexChangeRef.current?.(index);
  }, [index]);

  // 스크롤 잠금 · 열 때 창에 초점(키보드·화면 읽기), 닫으면 누른 자리로 되돌린다
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const prevFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus({ preventScroll: true });
    return () => {
      document.body.style.overflow = prevOverflow;
      prevFocus?.focus?.({ preventScroll: true });
    };
  }, []);

  // 키보드 — Esc 닫기 · ←/→ 넘기기
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onCloseRef.current(); }
      else if (e.key === 'ArrowLeft' && n > 1) setIndex((i) => (i - 1 + n) % n);
      else if (e.key === 'ArrowRight' && n > 1) setIndex((i) => (i + 1) % n);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [n]);

  // PC 썸네일 줄 — 지금 작품이 줄 가운데 오게
  useEffect(() => {
    const strip = stripRef.current;
    const btn = strip?.querySelector<HTMLElement>(`[data-thumb="${index}"]`);
    if (!strip || !btn || strip.scrollWidth <= strip.clientWidth) return;
    strip.scrollTo({ left: Math.max(0, btn.offsetLeft - (strip.clientWidth - btn.offsetWidth) / 2), behavior: 'smooth' });
  }, [index]);

  // 손가락으로 넘기기 — 두 손가락(확대)·확대해 둔 상태에서 끄는 건 넘기기가 아니다
  const touch = useRef<{ x: number; y: number; multi: boolean } | null>(null);
  const swiped = useRef(false);
  const go = (d: number) => { if (n > 1) setIndex((i) => (i + d + n) % n); };

  const work = works[index];
  if (!work) return null;

  const choose = (m: ViewerMode) => { setMode(m); saveViewerMode(m); };
  const alt = hasTitle(work) ? artworkTitle(work) : `${artistName} 작품`;
  const cap = museumCaption(work);
  const meta = [cap?.medium, cap?.size, priceLabel(work)].filter(Boolean).join(' · ');
  const st = statusBadge(work);
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  const share = async () => {
    if (!shareUrl) return;
    const url = shareUrl(index);
    const title = hasTitle(work) ? `${artworkTitle(work)} — ${artistName}` : artistName;
    try {
      if (navigator.share) { await navigator.share({ title, url }); return; }
      await navigator.clipboard?.writeText(url);
      const at = index;
      setCopiedAt(at);
      window.setTimeout(() => setCopiedAt((c) => (c === at ? null : c)), 2000);
    } catch { /* 공유 창을 닫았거나 클립보드 권한이 없다 — 조용히 */ }
  };

  // 캡션이 있으면 그 자리(두 줄씩 접어도 넉넉히)를 남기고 작품을 그 위에 — 작품과 캡션을 한 덩어리로 가운데 둔다
  const hasCaption = !!(cap?.head || st || meta);
  const imgClass = `${hasCaption ? 'max-h-[calc(100%-6rem)] sm:max-h-[calc(100%-5rem)]' : 'max-h-full'} max-w-full min-h-0 select-none object-contain`;
  let media: React.ReactNode;
  if (showWall && wall.src) {
    // 같은 작품의 초안 → 원본은 같은 요소에서 src 만 바뀐다(깜빡이지 않게). 다른 작품으로 넘어가면 새로 뜬다
    media = (
      <motion.img
        key={`wall-${work.id}`}
        src={wall.src}
        alt={`${alt} — 벽에 건 모습`}
        data-view="wall"
        data-quality={wall.quality ?? undefined}
        draggable={false}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.18 }}
        className={imgClass}
        onClick={stop}
      />
    );
  } else if (showWall) {
    media = (
      <Thumb key={`wait-${work.id}`} src={work.url} size="grid" alt={alt} data-view="wall-pending" draggable={false} className={`${imgClass} opacity-40`} onClick={stop} />
    );
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
        className={imgClass}
        onClick={stop}
      />
    );
  }

  const actions = (renderLike || shareUrl) ? (
    <>
      {renderLike?.(index)}
      {shareUrl && (
        <button
          type="button"
          onClick={share}
          aria-label="이 작품 공유"
          className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full bg-white/15 px-3.5 text-sm text-white backdrop-blur hover:bg-white/25"
        >
          <Share2 size={16} />
          <span className={copiedAt === index ? '' : 'hidden sm:inline'}>{copiedAt === index ? '링크를 복사했어요' : '공유'}</span>
        </button>
      )}
    </>
  ) : null;

  const seg = (on: boolean) =>
    `min-h-[40px] whitespace-nowrap rounded-full px-3.5 text-[13px] font-medium transition-colors ${on ? 'bg-white text-gray-900' : 'text-white/80 hover:text-white'}`;
  const arrow = 'absolute top-1/2 z-10 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-black/35 text-white backdrop-blur-sm hover:bg-black/55 sm:bg-white/15 sm:hover:bg-white/30';

  return createPortal(
    <motion.div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={`${artistName} — 작품 보기`}
      tabIndex={-1}
      data-testid="artwork-viewer"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-[9999] flex flex-col bg-neutral-950 text-white outline-none"
    >
      {/* 위 — 몇 번째 · 보기 방식 · 닫기 */}
      <div className="grid shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-2 px-3 pb-2 pt-[max(8px,env(safe-area-inset-top))] sm:px-5">
        <p className="justify-self-start text-sm tabular-nums text-white/70">{n > 1 ? `${index + 1} / ${n}` : ''}</p>
        {wall.available ? (
          <div role="group" aria-label="보기 방식" className="flex rounded-full bg-white/10 p-1">
            <button type="button" aria-pressed={!showWall} onClick={() => choose('photo')} className={seg(!showWall)}>사진</button>
            <button
              type="button"
              aria-pressed={showWall}
              onClick={() => choose('wall')}
              onPointerEnter={wall.warm}
              onPointerDown={wall.warm}
              onFocus={wall.warm}
              className={seg(showWall)}
            >
              벽에 걸어 보기
            </button>
          </div>
        ) : mode === 'wall' ? (
          <p className="text-center text-xs text-white/60">이 브라우저에서는 벽에 걸어 볼 수 없어요</p>
        ) : <span />}
        <div className="flex items-center gap-2 justify-self-end">
          {wide && actions}
          <button
            type="button"
            onClick={() => onCloseRef.current()}
            aria-label="닫기"
            className="grid h-11 w-11 place-items-center rounded-full text-white/80 hover:bg-white/10 hover:text-white"
          >
            <X size={26} />
          </button>
        </div>
      </div>

      {/* 가운데 — 작품. 작품 밖(빈 자리)을 누르면 닫힌다 */}
      <div
        className="relative min-h-0 flex-1"
        onClick={() => { if (!swiped.current) onCloseRef.current(); }}
        onTouchStart={(e) => {
          swiped.current = false;
          const t = e.touches[0];
          touch.current = e.touches.length === 1 && t ? { x: t.clientX, y: t.clientY, multi: false } : null;
        }}
        onTouchMove={(e) => { if (e.touches.length > 1 && touch.current) touch.current.multi = true; }}
        onTouchEnd={(e) => {
          const t = touch.current;
          touch.current = null;
          const end = e.changedTouches[0];
          if (!t || t.multi || !end || n < 2) return;
          if ((window.visualViewport?.scale ?? 1) > 1.01) return;   // 확대해 둔 채 둘러보는 중
          const dx = end.clientX - t.x, dy = end.clientY - t.y;
          if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.2) { swiped.current = true; go(dx < 0 ? 1 : -1); }
        }}
      >
        <div className="absolute inset-0 flex flex-col items-center justify-center px-2 py-1 sm:px-16">
          {media}
          {hasCaption && (
            <div
              className="mt-3 w-full max-w-2xl shrink-0 text-center break-keep [overflow-wrap:anywhere]"
              data-testid="artwork-caption"
              onClick={stop}
            >
              {(cap?.head || st) && (
                <p className="line-clamp-2 text-[15px] font-medium leading-snug text-white sm:text-base">
                  {cap?.head}
                  {st && (
                    <span className={`whitespace-nowrap text-[12px] font-normal text-white/70 sm:text-[13px] ${cap?.head ? 'ml-2' : ''}`}>
                      {/* 점 색은 홈페이지 캡션과 같다 — 판매완료 = 사이트 빨강 하나(규칙 47) · 판매중 = 초록 · 비매 = 흐린 흰색 */}
                      <span
                        aria-hidden
                        className={st.tone === 'sold' ? 'text-accent' : st.tone === 'muted' ? 'text-white/45' : undefined}
                        style={st.tone === 'available' ? { color: AVAILABLE_DOT } : undefined}
                      >●</span> {st.label}
                    </span>
                  )}
                </p>
              )}
              {meta && <p className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-white/70 sm:text-sm">{meta}</p>}
            </div>
          )}
        </div>
        {showWall && !wall.src && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center px-6">
            {wall.status === 'failed' ? (
              <p role="status" className="pointer-events-auto rounded-full bg-black/75 px-4 py-2 text-sm text-white" onClick={stop}>
                벽에 걸지 못했어요
                <button type="button" onClick={wall.retry} className="ml-2 min-h-[32px] font-medium underline underline-offset-4">다시 시도</button>
              </p>
            ) : (
              // 잠깐 뒤에 — 금방 그려지면 글자가 번쩍였다 사라지지 않게(흐린 사진만으로도 '그리는 중'이다)
              <motion.p
                role="status"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.35, duration: 0.2 }}
                className="rounded-full bg-black/60 px-4 py-2 text-sm text-white/90"
              >
                벽에 거는 중…
              </motion.p>
            )}
          </div>
        )}
        {n > 1 && (
          <>
            <button type="button" aria-label="이전 작품" onClick={(e) => { e.stopPropagation(); go(-1); }} className={`${arrow} left-2 sm:left-4`}>
              <ChevronLeft size={24} />
            </button>
            <button type="button" aria-label="다음 작품" onClick={(e) => { e.stopPropagation(); go(1); }} className={`${arrow} right-2 sm:right-4`}>
              <ChevronRight size={24} />
            </button>
          </>
        )}
      </div>

      {/* 아래 — 휴대폰만 좋아요 · 공유(PC 는 위 줄) */}
      {!wide && actions && (
        <div className="flex shrink-0 items-center justify-end gap-2 px-4 pb-[max(14px,env(safe-area-inset-bottom))] pt-2">
          {actions}
        </div>
      )}

      {/* PC — 작품 썸네일 줄(휴대폰은 손가락으로 넘긴다). 칸은 정사각 + contain — 작품을 자르지 않는다(규칙 18) */}
      {n > 1 && (
        <div className="hidden shrink-0 pb-4 md:block">
          <div ref={stripRef} className="relative overflow-x-auto px-6 [scrollbar-width:thin]">
            <div className="mx-auto flex w-max gap-2 py-1" role="group" aria-label="작품 목록">
              {works.map((w, i) => (
                <button
                  key={w.id}
                  type="button"
                  data-thumb={i}
                  aria-label={`${i + 1}번째 작품${hasTitle(w) ? ` — ${artworkTitle(w)}` : ''}`}
                  aria-current={i === index ? 'true' : undefined}
                  onClick={() => setIndex(i)}
                  className={`grid h-16 w-16 shrink-0 place-items-center bg-white/5 transition-opacity ${i === index ? 'opacity-100 ring-2 ring-white' : 'opacity-50 hover:opacity-80'}`}
                >
                  <Thumb src={w.url} size="grid" alt="" loading="lazy" decoding="async" draggable={false} className="max-h-full max-w-full object-contain" />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </motion.div>,
    document.body,
  );
}
