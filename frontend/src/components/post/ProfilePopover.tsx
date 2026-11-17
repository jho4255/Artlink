import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { User, X } from 'lucide-react';
import FollowButton from '@/components/shared/FollowButton';
import { roleLabel } from '@/lib/utils';

/**
 * 이름·사진을 누르면 뜨는 프로필 카드 (2026-11-13, 커뮤니티 글쓴이·댓글 쓴 사람).
 * - 넓은 화면(≥640px)은 누른 자리 바로 아래 작은 카드(문서에 붙어 함께 스크롤된다), 휴대폰은 아래에서 올라오는 시트.
 * - 내용: 사진 · 이름 · 역할 · 한 줄 소개 · [홈페이지](있을 때) · [이웃 추가](내가 아니면). 메시지는 두지 않는다(갠톡 길목을 넓히지 않는다 — CLAUDE.md 「대화」).
 * - 익명은 열지 않는다 — 서버가 신원을 보내지 않으므로 부르는 쪽이 애초에 열 수 없다.
 * - `role="dialog"` + Esc 로 닫힌다 — 앱 뒤로가기는 떠 있는 창에 Esc 를 보낸다(규칙 79).
 */
export interface ProfileTarget {
  id: number;
  name: string;
  avatar: string | null;
  role: string | null;
  mine: boolean;
  homepage: string | null;
  intro: string | null;
}

const WIDE = '(min-width: 640px)';
const subscribeWide = (fn: () => void) => {
  const mq = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(WIDE) : null;
  if (!mq) return () => {};
  if (mq.addEventListener) mq.addEventListener('change', fn); else mq.addListener?.(fn);
  return () => { if (mq.removeEventListener) mq.removeEventListener('change', fn); else mq.removeListener?.(fn); };
};
const readWide = () => typeof window !== 'undefined' && !!window.matchMedia?.(WIDE).matches;

const CARD_W = 300;

export default function ProfilePopover({ target, anchor, onClose }: {
  target: ProfileTarget;
  /** 누른 요소 — 넓은 화면에서 카드를 그 아래에 둔다 */
  anchor: HTMLElement | null;
  onClose: () => void;
}) {
  const wide = useSyncExternalStore(subscribeWide, readWide, () => false);
  const card = useRef<HTMLDivElement>(null);

  // 넓은 화면 — 누른 자리 아래(아래가 모자라면 위). 문서 좌표라 스크롤해도 따라 움직인다.
  // 자리는 그리기 전에 DOM 에 바로 적는다(상태로 들고 다시 그리지 않는다)
  useLayoutEffect(() => {
    const el = card.current;
    if (!wide || !anchor || !el) return;
    const r = anchor.getBoundingClientRect();
    const h = el.offsetHeight || 180;
    const below = r.bottom + 8;
    const top = below + h > window.innerHeight - 12 && r.top - h - 8 > 12 ? r.top - h - 8 : below;
    const left = Math.min(Math.max(12, r.left), window.innerWidth - CARD_W - 12);
    el.style.top = `${top + window.scrollY}px`;
    el.style.left = `${left + window.scrollX}px`;
    el.style.visibility = 'visible';
  }, [wide, anchor, target.id]);

  // 바깥을 누르거나 Esc — 닫는다
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (card.current?.contains(t) || anchor?.contains(t)) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('pointerdown', onDown); };
  }, [anchor, onClose]);

  // 열리면 카드 안으로 초점(키보드로 연 사람이 [홈페이지]까지 바로 간다) · 닫히면 누른 자리로 돌려준다
  useEffect(() => {
    const el = card.current;
    el?.focus({ preventScroll: true });
    return () => { anchor?.focus?.({ preventScroll: true }); };
  }, [anchor]);

  const role = roleLabel(target.role);
  const body = (
    <>
      <div className="flex items-start gap-3">
        {target.avatar
          ? <img src={target.avatar} alt="" className="h-12 w-12 shrink-0 rounded-full object-cover" />
          : <span aria-hidden="true" className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-gray-200 text-gray-500"><User size={22} /></span>}
        <div className="min-w-0 flex-1 pt-0.5">
          <p className="break-keep text-[16px] font-semibold leading-snug text-gray-900 [overflow-wrap:anywhere]">{target.name}</p>
          {role && <p className="mt-0.5 text-[13px] text-gray-500">{role}</p>}
        </div>
        <button type="button" onClick={onClose} aria-label="닫기" className="-mr-2 -mt-2 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-700">
          <X size={17} />
        </button>
      </div>
      {target.intro && <p className="mt-3 line-clamp-3 break-keep text-[14px] leading-relaxed text-gray-600 [overflow-wrap:anywhere]">{target.intro}</p>}
      {(target.homepage || !target.mine) && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {target.homepage && (
            <Link to={target.homepage} onClick={onClose} className="inline-flex h-10 items-center rounded-lg bg-gray-900 px-4 text-[14px] font-semibold text-white hover:bg-gray-800">
              홈페이지 보기
            </Link>
          )}
          {/* 주 버튼은 [홈페이지 보기] 하나 — 이웃 추가는 테두리 버튼(검정 둘이 나란히 서지 않게) */}
          {!target.mine && <FollowButton userId={target.id} className="!h-10 !rounded-lg !border !border-gray-300 !bg-white !px-4 !py-0 !text-gray-700 hover:!bg-gray-50" />}
        </div>
      )}
      {!target.homepage && target.mine && <p className="mt-3 text-[13px] text-gray-500">나의 프로필이에요.</p>}
    </>
  );

  if (wide) {
    return createPortal(
      <div
        ref={card}
        role="dialog"
        aria-label={`${target.name} 프로필`}
        tabIndex={-1}
        className="absolute z-50 rounded-xl border border-gray-200 bg-white p-4 shadow-[0_10px_30px_rgba(0,0,0,0.10)] focus:outline-none"
        style={{ width: CARD_W, top: -9999, left: -9999, visibility: 'hidden' }}
        data-profile-popover
      >
        {body}
      </div>,
      document.body,
    );
  }
  return createPortal(
    <div className="fixed inset-0 z-50" data-profile-popover>
      <div className="absolute inset-0 bg-black/30" aria-hidden="true" />
      <div
        ref={card}
        role="dialog"
        aria-modal="true"
        aria-label={`${target.name} 프로필`}
        tabIndex={-1}
        className="absolute inset-x-0 bottom-0 rounded-t-2xl bg-white px-5 pb-[calc(20px+env(safe-area-inset-bottom))] pt-5 focus:outline-none"
      >
        {body}
      </div>
    </div>,
    document.body,
  );
}
