import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { armedHomepageNudgeUserId } from '@/lib/homepageNudge';
import {
  INTRO_IMG_WAIT_MS, INTRO_SETTLE_MS, introAllowedAt, introAudienceHere, introDefaultSide, introForced, introSignupHref,
  hideMemberIntro, markIntroAnswered, markMemberIntroDay, rememberIntroReturn, type IntroSide,
} from '@/lib/guestIntro';

/**
 * 소개 팝업 'Welcome to ArtLink' (2026-10-18, 사용자 요청) — 아트링크로 할 수 있는 일을 짧게 보여 준다.
 * 위의 [작가 · 갤러리] 를 눌러 바꾼다: 작가 네 칸 · 갤러리 네 칸(둘 다 2×2). 언제·누구에게 뜨는지는 `lib/guestIntro.ts`.
 * `Layout` 에 한 번 놓여 어느 화면으로 들어와도 뜬다(홈 포함). 비회원에겐 [무료로 시작하기], 회원에겐 [다시 보지 않기]·[닫기].
 *
 * ⚠️ 칸 그림은 **실제 우리 화면**이다(사용자 결정 — "모형이면 누가 쓰겠냐"). 샘플 작가(지어낸 이름 · 데모 그림)로
 * ArtLook 엔진 · 홈페이지 · 포트폴리오 PDF(내려받기와 같은 쪽 HTML) · 지원서 · 갤러리 공모 운영 · 갤러리 홈페이지 · 전시 상세를 찍어 창 테두리만 둘렀다.
 * 다시 찍는 법: `backend/scripts/seed-intro-sample.ts` → `scratchpad/guest-intro/capture.mjs` → `compose.mjs` → `make-assets.py`.
 * ⚠️ 실제 가입자 작품·이름을 쓰지 말 것. 파일은 `public/intro/` 600×450 webp 여덟(합 약 80KB — 광고로 들어온 휴대폰이 받는다).
 */
type Item = { key: string; title: React.ReactNode; text: React.ReactNode; src: string; top?: boolean };

const Brand = ({ className = '' }: { className?: string }) => (
  <span className={`font-serif font-bold tracking-tight ${className}`}>Art<span className="text-accent">Link</span></span>
);
const ARTLOOK_TITLE = <span className="font-serif">Art<span className="text-accent">Look</span></span>;
const ARTLOOK_TEXT = <>작품을 현실 속으로, <Brand />의 가상 액자 프레이밍 서비스.</>;

const SIDES: Record<IntroSide, { label: string; lead: React.ReactNode; items: Item[] }> = {
  artist: {
    label: '작가',
    lead: <>작가 회원은 아트링크의 모든 서비스를 <b className="font-semibold text-accent">무료</b>로 이용해요.</>,
    items: [
      { key: 'artlook', title: ARTLOOK_TITLE, text: ARTLOOK_TEXT, src: '/intro/artlook.webp' },
      { key: 'portfolio', title: '포트폴리오 PDF', text: '원하는 형식의 포트폴리오를 쉽고 빠르게.', src: '/intro/portfolio.webp' },
      { key: 'homepage', title: '작가 홈페이지', text: '나만의 홈페이지를 꾸며보세요.', src: '/intro/homepage.webp', top: true },
      { key: 'apply', title: '공모 간편지원', text: '클릭 한번으로 원하는 공모 지원 끝.', src: '/intro/apply.webp', top: true },
    ],
  },
  gallery: {
    label: '갤러리',
    lead: <>갤러리 회원은 2027년 6월까지 아트링크의 모든 서비스를 <b className="font-semibold text-accent">무료</b>로 이용할 수 있어요.</>,
    items: [
      { key: 'artlook', title: ARTLOOK_TITLE, text: ARTLOOK_TEXT, src: '/intro/gallery-artlook.webp' },
      { key: 'ops', title: '공모 운영 자동화', text: '지원 접수부터 출품 자료·정산까지, 클릭 한번으로.', src: '/intro/gallery-ops.webp', top: true },
      { key: 'home', title: '갤러리 홈페이지', text: '갤러리 홈페이지를 꾸미고 소개해주세요.', src: '/intro/gallery-home.webp', top: true },
      { key: 'show', title: '전시 홍보', text: '진행중인 전시를 홍보해보세요.', src: '/intro/gallery-show.webp', top: true },
    ],
  },
};

/** 띄우기 전에 그림을 받아 둔다 — 창이 뜬 뒤 칸이 하나씩 채워지면 어수선하다. 한 문서에서 한 번 */
let preloaded: Promise<void> | null = null;
function preloadShots(): Promise<void> {
  if (!preloaded) {
    const srcs = [...SIDES.artist.items, ...SIDES.gallery.items].map((it) => it.src);
    preloaded = Promise.all(srcs.map((src) => new Promise<void>((done) => {
      const im = new Image();
      im.onload = () => done();
      im.onerror = () => done();
      im.src = src;
    }))).then(() => undefined);
  }
  return preloaded;
}

export default function GuestIntro() {
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const member = isAuthenticated && user ? user : null;
  const location = useLocation();
  const navigate = useNavigate();
  const titleId = useId();
  const boxRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [side, setSide] = useState<IntroSide>(() => introDefaultSide(member?.role));

  // 이 주소에 INTRO_SETTLE_MS 머물면 띄운다. 다른 창(라이트박스·확인창)이 떠 있으면 1초씩 기다린다.
  // ⚠️ 앱 맨 위라 던지면 화면 전체가 죽는다 — 판정은 전부 던지지 않는 함수(introAudienceHere)
  const allowedHere = introAllowedAt(location.pathname);
  // 미리보기 `?intro=1` — 로그인했거나 이미 답했어도 띄운다(운영자가 자기 브라우저로 확인)
  const forced = introForced(location.search);
  const memberId = member?.id ?? null;
  useEffect(() => {
    if (open || !allowedHere) return;
    const who = () => { const s = useAuthStore.getState(); return s.isAuthenticated && s.user ? s.user : null; };
    if (!forced && !introAudienceHere(who())) return;
    let t: ReturnType<typeof setTimeout>;
    let alive = true;
    // 그림을 받는 동안 기다리되, 느린 망에서도 INTRO_IMG_WAIT_MS 를 넘기지 않는다(그 뒤엔 그림이 늦게 채워진다)
    const ready = Promise.race([preloadShots(), new Promise<void>((r) => setTimeout(r, INTRO_IMG_WAIT_MS))]);
    const tryOpen = () => {
      if (!alive) return;
      const u = who();
      if (!forced) {
        if (!introAudienceHere(u)) return;
        if (u) {
          // 홈페이지 완성 팝업(규칙 51)이 뜨는 날엔 그쪽에 양보한다 — 한 번에 팝업 둘은 잔소리다(오늘은 본 것으로 친다)
          if (document.querySelector('[data-testid="homepage-nudge"]')) { markMemberIntroDay(u.id); return; }
          if (armedHomepageNudgeUserId() === u.id) { t = setTimeout(tryOpen, 1000); return; }
        }
      }
      if (document.querySelector('[aria-modal="true"]')) { t = setTimeout(tryOpen, 1000); return; }
      setSide(introDefaultSide(u?.role));
      setOpen(true);
    };
    t = setTimeout(() => { void ready.then(tryOpen); }, INTRO_SETTLE_MS);
    return () => { alive = false; clearTimeout(t); };
  }, [location.pathname, allowedHere, memberId, open, forced]);

  // 관리자는 미리보기로만 본다
  const shown = open && (forced || member?.role !== 'ADMIN');

  // ⚠️ '봤다'는 사람이 답했을 때만 적는다(lib/guestIntro.ts) — 뜨는 순간 적으면 답하기 전에 사라진 사람은 영영 못 본다
  const answer = (hide = false) => {
    // ⚠️ 미리보기(?intro=1)는 아무것도 적지 않는다 — 운영자가 보고 닫았다고 이 브라우저의 진짜 한 번이 사라지면 안 된다(2026-10-18 실제로 그래서 안 떴다)
    if (!forced) {
      if (member) {
        markMemberIntroDay(member.id);
        if (hide) hideMemberIntro(member.id);
      } else {
        markIntroAnswered();
      }
    }
    setOpen(false);
    // 미리보기로 열었으면 주소에서 떼어 낸다 — 남겨 두면 닫자마자 다시 뜬다
    if (forced) {
      const q = new URLSearchParams(location.search);
      q.delete('intro');
      navigate({ pathname: location.pathname, search: q.toString() ? `?${q}` : '' }, { replace: true });
    }
  };
  const go = (href: string) => {
    if (side === 'artist') rememberIntroReturn(location.pathname, location.search);
    answer();
    navigate(href);
  };

  // ESC 로 닫기 + 배경 스크롤 잠금 + 창에 초점(키보드·화면 읽기 프로그램이 팝업부터 읽게)
  useEffect(() => {
    if (!shown) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') answer(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const f = requestAnimationFrame(() => boxRef.current?.focus());
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
      cancelAnimationFrame(f);
    };
  }, [shown]); // eslint-disable-line react-hooks/exhaustive-deps -- 창이 열릴 때 한 번 붙인다(answer 는 매 렌더 새 함수)

  if (typeof document === 'undefined') return null;
  const cur = SIDES[side];

  return createPortal(
    <AnimatePresence>
      {shown && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 sm:items-center"
          onClick={() => answer()}
        >
          <motion.div
            ref={boxRef}
            tabIndex={-1}
            initial={{ y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 24, opacity: 0 }}
            transition={{ type: 'spring', damping: 28, stiffness: 320 }}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            data-testid="guest-intro"
            data-side={side}
            className="relative max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl bg-white px-5 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-5 [@media(max-height:700px)]:pt-4 shadow-xl outline-none sm:mx-4 sm:max-w-xl sm:rounded-2xl sm:px-7 sm:pb-6 sm:pt-7"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => answer()}
              aria-label="닫기"
              className="absolute right-2 top-2 flex h-11 w-11 items-center justify-center rounded-full text-gray-400 hover:text-gray-900"
            >
              <X size={20} aria-hidden />
            </button>

            <h2 id={titleId} className="pr-10 font-serif text-xl font-bold tracking-tight text-gray-950 sm:text-2xl">
              Welcome to <Brand />
            </h2>

            {/* 작가 · 갤러리 — 눌러서 바꾼다(처음엔 갤러리 회원은 갤러리, 그 밖은 작가) */}
            <div role="tablist" aria-label="누구를 위한 소개" className="mt-3 [@media(max-height:700px)]:mt-2 inline-flex rounded-full bg-gray-100 p-1">
              {(Object.keys(SIDES) as IntroSide[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  role="tab"
                  aria-selected={side === k}
                  onClick={() => setSide(k)}
                  className={`min-h-[36px] rounded-full px-4 text-sm font-medium transition-colors ${side === k ? 'bg-white text-gray-950 shadow-sm' : 'text-gray-500 hover:text-gray-900'}`}
                >
                  {SIDES[k].label}
                </button>
              ))}
            </div>
            <p className="mt-2.5 [@media(max-height:700px)]:mt-2 break-keep text-sm text-gray-600">{cur.lead}</p>

            {/* 네 칸(2×2, 십자 구분선). 칸 사이 1px 은 배경색이 비쳐 보이는 선이다 */}
            <ul role="tabpanel" className="mt-4 [@media(max-height:700px)]:mt-3 grid grid-cols-2 gap-px overflow-hidden border border-gray-200 bg-gray-200 sm:mt-5">
              {cur.items.map((it) => <Quadrant key={`${side}-${it.key}`} item={it} />)}
            </ul>

            {member ? (
              <div className="mt-5 [@media(max-height:700px)]:mt-3 flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => answer(true)}
                  className="min-h-[44px] px-1 text-sm text-gray-500 underline underline-offset-4 hover:text-gray-900"
                >
                  다시 보지 않기
                </button>
                <button
                  type="button"
                  onClick={() => answer()}
                  className="min-h-[48px] rounded-lg bg-gray-900 px-8 text-sm font-semibold text-white hover:bg-gray-800"
                >
                  닫기
                </button>
              </div>
            ) : (
              <div className="mt-5 [@media(max-height:700px)]:mt-3 flex flex-col gap-1 sm:flex-row-reverse sm:items-center sm:justify-between">
                <button
                  type="button"
                  onClick={() => go(introSignupHref(side))}
                  className="min-h-[48px] w-full rounded-lg bg-gray-900 px-6 text-sm font-semibold text-white hover:bg-gray-800 sm:w-auto"
                >
                  무료로 시작하기
                </button>
                <div className="flex items-center justify-between gap-3 sm:justify-start">
                  <button type="button" onClick={() => answer()} className="min-h-[44px] px-1 text-sm text-gray-500 hover:text-gray-900">
                    먼저 둘러볼게요
                  </button>
                  <Link
                    to="/login"
                    onClick={(e) => { e.preventDefault(); go('/login'); }}
                    className="min-h-[44px] inline-flex items-center px-1 text-xs text-gray-400 underline underline-offset-4 hover:text-gray-700"
                  >
                    이미 회원이에요
                  </Link>
                </div>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

function Quadrant({ item }: { item: Item }) {
  return (
    <li className="min-w-0 bg-white">
      {/* 키가 낮은 화면(아이폰 SE 667px)에선 칸을 납작하게(2:1) — 제목·바꾸기 줄이 붙으며 창 안 스크롤이 생기고 [무료로 시작하기]가 화면 밖으로 밀렸다. 창 모양 그림은 위를 남기고 자른다 */}
      <div aria-hidden className="aspect-[4/3] overflow-hidden bg-[#efede8] [@media(max-height:700px)]:aspect-[2/1]">
        <img src={item.src} alt="" decoding="async" className={`h-full w-full object-cover ${item.top ? 'object-top' : ''}`} />
      </div>
      <div className="px-3 pb-3 pt-2.5 sm:px-4 sm:pb-4 [@media(max-height:700px)]:pb-2 [@media(max-height:700px)]:pt-2">
        <p className="text-sm font-bold tracking-tight text-gray-950">{item.title}</p>
        <p className="mt-0.5 break-keep text-xs leading-snug text-gray-600 [overflow-wrap:anywhere] [text-wrap:pretty]">{item.text}</p>
      </div>
    </li>
  );
}
