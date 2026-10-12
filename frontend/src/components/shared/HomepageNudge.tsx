import { useEffect, useId, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronRight } from 'lucide-react';
import api from '@/lib/axios';
import { computeCompleteness } from '@/lib/completeness';
import { editHref } from '@/lib/homepageEdit';
import {
  armHomepageNudge, armedHomepageNudgeUserId, disarmHomepageNudge, isHomepageNudgeSeenToday, isHomepageNudgeSnoozed, markHomepageNudgeSeen,
  nudgePlace, snoozeHomepageNudge, subscribeHomepageNudge, NUDGE_SNOOZE_DAYS,
} from '@/lib/homepageNudge';
import { useAuthStore } from '@/stores/authStore';
import type { Portfolio } from '@/types';

/**
 * 작가에게 "홈페이지에 아직 빈 곳이 있어요" 팝업 (2026-10-01, 사용자 요청 · 2026-10-11 부터 하루 첫 방문에 한 번)
 *
 * 언제 뜨는지는 `lib/homepageNudge.ts`, 무엇이 비었는지는 `lib/completeness.ts`(프로필 탭·편집 화면의 완성도 한 줄과 같은 판정).
 * `Layout` 에 한 번 놓여 어느 화면에 내려도 뜬다. 작가가 아니거나 홈페이지를 다 채웠으면 아무것도 그리지 않는다.
 *
 * - 비어 있는 항목만 보여준다. 줄을 누르면 그걸 채우는 자리로 간다.
 * - 닫는 길은 셋: [지금 채우기](첫 항목으로) · [나중에](내일 첫 방문 때 다시) · [7일 동안 보지 않기].
 * - 화면이 자리를 잡은 뒤(0.6초)에 뜬다 — 로그인 직후엔 화면이 한두 번 바뀌는데, 그 사이에 떴다 닫히면 번쩍인다.
 */
const SETTLE_MS = 600;

export default function HomepageNudge() {
  const { user } = useAuthStore();
  const location = useLocation();
  const navigate = useNavigate();
  const titleId = useId();

  // 하루 첫 방문 — 이미 로그인된 채로 앱을 열 때, 숨겼던 탭으로 돌아올 때(날이 바뀌었을 수 있다) 예약한다.
  // 오늘 이미 보여 줬으면 `armHomepageNudge` 가 건너뛴다. ⚠️ 로그인된 사용자가 바뀔 때마다 걸지 말 것(lib/homepageNudge.ts ⚠️).
  // ⚠️ 앱 맨 위라 던지면 화면 전체가 죽는다 — 저장소가 막혀도 조용히 넘어간다
  useEffect(() => {
    const arm = () => { try { armHomepageNudge(useAuthStore.getState().user); } catch { /* 이번엔 안 띄운다 */ } };
    arm();
    const onVisible = () => { if (document.visibilityState === 'visible') arm(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  // 다른 탭에서 답했으면(오늘 봤다 · 7일 보지 않기) 이 탭의 팝업도 닫는다 — 탭 둘에 떠 있던 팝업이 한쪽에만 남지 않게.
  // 'storage' 이벤트는 같은 브라우저의 **다른** 탭에서만 온다.
  useEffect(() => {
    const onStorage = () => {
      try {
        const u = useAuthStore.getState().user;
        if (u && (isHomepageNudgeSeenToday(u.id) || isHomepageNudgeSnoozed(u.id))) disarmHomepageNudge();
      } catch { /* 저장소를 못 읽으면 이 탭에서 답하면 된다 */ }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const armedId = useSyncExternalStore(subscribeHomepageNudge, armedHomepageNudgeUserId, () => null);
  const armed = !!user && user.role === 'ARTIST' && armedId === user.id;
  const place = nudgePlace(location.pathname, location.search);

  // 마이페이지(프로필 탭의 완성도 한 줄·편집 화면)와 같은 쿼리 — 그 화면에서 뜨면 요청이 늘지 않는다
  const { data: portfolio } = useQuery<Portfolio>({
    queryKey: ['portfolio'],
    queryFn: () => api.get('/portfolio').then((r) => r.data),
    enabled: armed && place === 'show',
  });
  const c = portfolio
    ? computeCompleteness({ images: portfolio.images ?? [], statement: portfolio.statement, biography: portfolio.biography, career: portfolio.career })
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

  // 띄울 필요가 없어졌으면 예약을 지운다 — 이미 편집 화면에 있거나, 받아 보니 다 채워져 있다. 그날은 본 것으로 친다
  const nothingToSay = armed && (place === 'done' || (place === 'show' && !!c && c.complete));
  useEffect(() => {
    if (!nothingToSay) return;
    if (user) markHomepageNudgeSeen(user.id);
    disarmHomepageNudge();
  }, [nothingToSay]); // eslint-disable-line react-hooks/exhaustive-deps

  // ⚠️⚠️ '오늘 봤다'는 **사람이 답했을 때만** 적는다(나중에·닫기·ESC·항목·지금 채우기 — 7일 보지 않기는 따로 적는다).
  //    뜨는 순간 적으면 안 된다 — 배포 뒤 처음 들어온 휴대폰은 새 판으로 바뀌며 새로고침이 일어나는데, 팝업이 뜬 지 0.5초 만에
  //    그 새로고침이 화면을 지워도 '봤다'가 남아 그날은 다시 안 떴다(2026-10-12 실서버 '초원' — 들어와 4시간 머물고 아무것도 안 했다.
  //    재현 scratchpad/homepage-edit/returning-artist.js). 답하지 않은 채 사라졌으면 다음 화면에서 다시 뜬다.
  const dismiss = () => {
    if (user) markHomepageNudgeSeen(user.id);
    disarmHomepageNudge();
  };

  // ESC 로 닫기 + 배경 스크롤 잠금 (ConfirmDialog 와 같은 방식)
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') dismiss(); };
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
  const go = (href: string) => { dismiss(); navigate(href); };

  return createPortal(
    <AnimatePresence>
      {open && c && user && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 sm:items-center"
          onClick={dismiss}
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
                onClick={dismiss}
                className="min-h-[44px] rounded-lg px-4 text-sm text-gray-500 hover:text-gray-900"
              >
                나중에
              </button>
              <button
                type="button"
                onClick={() => go(missing[0]?.href ?? editHref())}
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
