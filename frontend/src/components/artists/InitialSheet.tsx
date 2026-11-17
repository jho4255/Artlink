import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ChevronRight, X } from 'lucide-react';
import Thumb from '@/components/shared/Thumb';
import { artistPath } from '@/lib/handle';
import { useEscapeKey } from '@/hooks/useEscapeKey';
import type { ArtistGroup } from '@/lib/artistIndex';

/**
 * [작가] 탭 — 휴대폰·태블릿(1024px 미만)의 작가 찾기 (2026-11-15, 사용자가 고른 B안)
 *
 * 예전엔 휴대폰에서 PC 의 왼쪽 목록(초성 15줄 + [모두 펼치기])이 작품 **위에** 그대로 쌓여,
 * 첫 화면이 초성 목록으로 꽉 차고 첫 작품이 968px 아래에서 시작했다(복제본, 390×844 실측).
 * 지금은 제목 아래 **초성 한 줄**(옆으로 민다, 상단바 아래에 붙는다)만 두고 작품이 바로 이어진다.
 * 초성을 누르면 **아래에서 이름 창**이 올라온다 — 이름을 누르면 그 작가의 홈페이지(PC 목록과 같은 동작).
 *
 * ⚠️ 칸과 순서는 서버가 정한 그대로(`groupByInitial` — 화면에서 초성을 다시 계산하지 않는다, `lib/artistIndex.ts`).
 * ⚠️ 작가 수·칸마다 몇 명인지·'가나다순' 같은 안내 글자를 두지 않는다(2026-09-13 사용자 요청 — PC 목록과 같은 규칙).
 * ⚠️ 이름 옆 작은 그림은 그 작가 홈페이지 첫 화면의 대표작(`cover`, 서버가 고른다). 프로필 사진(`avatar`)을 쓰지 말 것 —
 *    대개 카카오 프로필 사진이라 홈페이지도 작가가 켜야 보여 준다(규칙 77).
 */

export interface SheetArtist {
  id: number;
  name: string;
  handle?: string | null;
  initial: string;
  /** 대표작 주소 — 홈페이지 첫 화면과 같은 그림(없으면 null) */
  cover?: string | null;
}

/** 초성 한 줄 — 제목 아래, 상단바(64px) 아래에 붙는다. 넘치면 옆으로 민다(줄바꿈하면 높이가 튄다) */
export function InitialStrip({ groups, loading, onOpen }: {
  groups: ArtistGroup<SheetArtist>[];
  loading: boolean;
  onOpen: (initial: string) => void;
}) {
  if (!loading && groups.length === 0) return null;
  return (
    <div
      className="sticky top-16 z-30 -mx-6 border-b border-gray-200 bg-white px-6 md:-mx-12 md:px-12"
      data-testid="artist-initials"
    >
      <div role="group" aria-label="작가 이름 찾기" className="flex items-center overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <span className="shrink-0 pr-1.5 text-[13px] text-gray-500" aria-hidden="true">작가</span>
        {loading
          ? Array.from({ length: 8 }).map((_, i) => <span key={i} className="mx-2 h-4 w-5 shrink-0 animate-pulse rounded bg-gray-100" />)
          : groups.map((g) => (
            <button
              key={g.initial}
              type="button"
              onClick={() => onOpen(g.initial)}
              aria-haspopup="dialog"
              aria-label={`${g.initial} — 작가 이름 보기`}
              className="h-11 min-w-10 shrink-0 cursor-pointer whitespace-nowrap px-2 text-[15px] font-bold text-gray-900"
            >
              {g.initial}
            </button>
          ))}
        <span aria-hidden="true" className="w-4 shrink-0" />
      </div>
    </div>
  );
}

/**
 * 이름 창 — 아래에서 올라온다. 위에 지금 초성(크게) · 닫기, 그 아래 초성 줄(눌러서 바꾼다), 이름 목록.
 * `role="dialog"` + `aria-modal` — Esc · 앱 뒤로가기(규칙 79 — 떠 있는 창에 Esc 를 보낸다)로 닫히고, 소개 팝업이 그 위로 뜨지 않는다.
 * 열려 있는 동안 뒤 페이지는 스크롤되지 않는다. 닫으면 연 단추로 포커스를 돌려준다.
 */
export function InitialSheet({ groups, active, onSelect, onClose }: {
  groups: ArtistGroup<SheetArtist>[];
  active: string;
  onSelect: (initial: string) => void;
  onClose: () => void;
}) {
  const group = groups.find((g) => g.initial === active) ?? groups[0];
  const closeRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  useEscapeKey(onClose);

  // 열 때 — 뒤 페이지 스크롤을 잠그고 닫기 단추에 포커스. 닫을 때 — 잠금을 풀고 연 단추로 돌아간다
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus({ preventScroll: true });
    return () => {
      document.body.style.overflow = prev;
      opener?.focus?.({ preventScroll: true });
    };
  }, []);

  // 초성을 바꾸면 목록은 맨 위부터, 고른 초성은 줄 안에 보이게
  useEffect(() => {
    listRef.current?.scrollTo({ top: 0 });
    const btn = rowRef.current?.querySelector<HTMLElement>('[aria-pressed="true"]');
    btn?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [active]);

  if (!group) return null;
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" data-testid="initial-sheet">
      <motion.button
        type="button"
        tabIndex={-1}
        aria-label="이름 창 닫기"
        onClick={onClose}
        className="flex-1 cursor-default bg-black/40"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
      />
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label={`${group.initial} 로 시작하는 작가`}
        className="flex max-h-[68svh] flex-col rounded-t-[14px] bg-white pb-[env(safe-area-inset-bottom)]"
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ duration: 0.22, ease: 'easeOut' }}
      >
        <div className="flex items-center justify-between pb-1 pl-6 pr-2.5 pt-3">
          <strong className="text-xl font-extrabold text-gray-900">{group.initial}</strong>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="grid h-11 w-11 cursor-pointer place-items-center text-gray-700"
          >
            <X size={20} aria-hidden />
          </button>
        </div>
        <div ref={rowRef} className="flex shrink-0 items-center overflow-x-auto border-b border-gray-200 pl-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {groups.map((g) => {
            const on = g.initial === group.initial;
            return (
              <button
                key={g.initial}
                type="button"
                onClick={() => onSelect(g.initial)}
                aria-pressed={on}
                className={`relative h-11 min-w-10 shrink-0 cursor-pointer whitespace-nowrap px-2 text-[15px] ${on ? 'font-extrabold text-gray-900' : 'font-medium text-gray-500'}`}
              >
                {g.initial}
                {on && <span aria-hidden className="absolute inset-x-2 bottom-0 h-[2px] bg-gray-900" />}
              </button>
            );
          })}
          <span aria-hidden="true" className="w-4 shrink-0" />
        </div>
        <ul ref={listRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pb-5 pt-0.5" data-testid="initial-sheet-names">
          {group.artists.map((a) => (
            <li key={a.id}>
              {/* ⚠️ `<Link>` 로 둘 것 — 새 탭·주소 복사·키보드 접근(PC 목록과 같다) */}
              <Link to={artistPath(a)} className="flex h-[60px] items-center gap-3 border-b border-gray-100 text-gray-900">
                <span className="relative h-11 w-11 shrink-0 overflow-hidden bg-gray-50">
                  {a.cover && (
                    /* 작품은 자르지 않는다(규칙 18) — 칸 안에 비율대로 */
                    <Thumb src={a.cover} size="list" alt="" loading="lazy" className="absolute inset-0 h-full w-full object-contain" />
                  )}
                </span>
                <span className="min-w-0 flex-1 truncate text-[15px]">{a.name}</span>
                <ChevronRight size={16} className="shrink-0 text-gray-500" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      </motion.div>
    </div>
  );
}
