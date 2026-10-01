import { useEffect, useId, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronRight } from 'lucide-react';
import api from '@/lib/axios';
import { computeCompleteness } from '@/lib/completeness';
import {
  armedHomepageNudgeUserId, disarmHomepageNudge, nudgePlace, snoozeHomepageNudge, subscribeHomepageNudge, NUDGE_SNOOZE_DAYS,
} from '@/lib/homepageNudge';
import { useAuthStore } from '@/stores/authStore';
import type { Portfolio } from '@/types';

/**
 * 작가 로그인 뒤 "홈페이지에 아직 빈 곳이 있어요" 팝업 (2026-10-01, 사용자 요청)
 *
 * 언제 뜨는지는 `lib/homepageNudge.ts`, 무엇이 비었는지는 `lib/completeness.ts`(마이페이지 체크리스트와 같은 판정).
 * `Layout` 에 한 번 놓여 어느 화면에 내려도 뜬다. 작가가 아니거나 홈페이지를 다 채웠으면 아무것도 그리지 않는다.
 *
 * - 비어 있는 항목만 보여준다. 줄을 누르면 그걸 채우는 자리로 간다.
 * - 닫는 길은 셋: [지금 채우기](첫 항목으로) · [나중에](다음 로그인 때 다시) · [7일 동안 보지 않기].
 * - 화면이 자리를 잡은 뒤(0.6초)에 뜬다 — 로그인 직후엔 화면이 한두 번 바뀌는데, 그 사이에 떴다 닫히면 번쩍인다.
 */
const SETTLE_MS = 600;

export default function HomepageNudge() {
  const { user } = useAuthStore();
  const location = useLocation();
  const navigate = useNavigate();
  const titleId = useId();

  const armedId = useSyncExternalStore(subscribeHomepageNudge, armedHomepageNudgeUserId, () => null);
  const armed = !!user && user.role === 'ARTIST' && armedId === user.id;
  const place = nudgePlace(location.pathname, location.search);

  // 마이페이지·체크리스트와 같은 쿼리 — 그 화면에서 뜨면 요청이 늘지 않는다
  const { data: portfolio } = useQuery<Portfolio>({
    queryKey: ['portfolio'],
    queryFn: () => api.get('/portfolio').then((r) => r.data),
    enabled: armed && place === 'show',
  });
  const c = portfolio
    ? computeCompleteness({ images: portfolio.images ?? [], statement: portfolio.statement, biography: portfolio.biography })
    : null;

  // 이 주소에 머문 지 SETTLE_MS 가 지났는가
  const here = location.pathname + location.search;
  const [settledAt, setSettledAt] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setSettledAt(here), SETTLE_MS);
    return () => clearTimeout(t);
  }, [here]);

  const incomplete = !!c && !c.complete;
  const open = armed && place === 'show' && incomplete && settledAt === here;

  // 띄울 필요가 없어졌으면 예약을 지운다 — 이미 편집 화면에 있거나, 받아 보니 다 채워져 있다
  const nothingToSay = armed && (place === 'done' || (place === 'show' && !!c && c.complete));
  useEffect(() => {
    if (nothingToSay) disarmHomepageNudge();
  }, [nothingToSay]);

  // ESC 로 닫기 + 배경 스크롤 잠금 (ConfirmDialog 와 같은 방식)
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') disarmHomepageNudge(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (typeof document === 'undefined') return null;

  const missing = c ? c.items.filter((it) => !it.done) : [];
  const go = (href: string) => { disarmHomepageNudge(); navigate(href); };

  return createPortal(
    <AnimatePresence>
      {open && c && user && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 sm:items-center"
          onClick={() => disarmHomepageNudge()}
        >
          <motion.div
            initial={{ y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 24, opacity: 0 }}
            transition={{ type: 'spring', damping: 28, stiffness: 320 }}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            data-testid="homepage-nudge"
            className="max-h-[88vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-xl sm:mx-4 sm:max-w-md sm:rounded-2xl sm:p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-xs text-gray-500">홈페이지 완성도 {c.done}/{c.total}</p>
            <h2 id={titleId} className="mt-1 text-lg font-bold tracking-tight text-gray-950">홈페이지에 아직 빈 곳이 있어요</h2>
            <p className="mt-1.5 break-keep text-sm leading-relaxed text-gray-600">
              아래를 채우면 갤러리와 방문자가 보는 내 홈페이지·포트폴리오가 완성됩니다.
            </p>
            <div className="mt-4 h-1 w-full bg-gray-100" aria-hidden>
              <div className="h-1 bg-gray-900" style={{ width: `${c.percent}%` }} />
            </div>

            <ul className="mt-3 divide-y divide-gray-100 border-y border-gray-100">
              {missing.map((it) => (
                <li key={it.key}>
                  <button
                    type="button"
                    onClick={() => go(it.href)}
                    className="flex min-h-[48px] w-full items-center gap-3 py-2.5 text-left hover:bg-gray-50"
                  >
                    <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                    <span className="min-w-0 flex-1 text-sm font-medium text-gray-900">{it.label}</span>
                    {it.progress && <span className="shrink-0 whitespace-nowrap text-xs text-gray-500">{it.progress}</span>}
                    <ChevronRight size={16} className="shrink-0 text-gray-300" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => disarmHomepageNudge()}
                className="min-h-[44px] rounded-lg px-4 text-sm text-gray-500 hover:text-gray-900"
              >
                나중에
              </button>
              <button
                type="button"
                onClick={() => go(missing[0]?.href ?? '/mypage?tab=homepage-edit')}
                className="min-h-[44px] rounded-lg bg-gray-900 px-5 text-sm font-medium text-white hover:bg-gray-800"
              >
                지금 채우기
              </button>
            </div>
            <div className="mt-1 text-right">
              <button
                type="button"
                onClick={() => snoozeHomepageNudge(user.id)}
                className="min-h-[44px] px-4 text-xs text-gray-400 underline underline-offset-4 hover:text-gray-700"
              >
                {NUDGE_SNOOZE_DAYS}일 동안 보지 않기
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
