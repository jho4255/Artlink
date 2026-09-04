/**
 * 하이라이트 뷰어 — **인스타그램 스토리처럼 한 장씩 넘겨 본다.**
 *
 * 전체화면 · 위쪽에 칸 나뉜 진행바 · 좌우를 눌러 앞뒤로 · 5초마다 자동으로 다음.
 * 목록을 죽 늘어놓는 방식은 스토리가 아니라 게시판이라 안 쓴다.
 *
 * ⚠️ **한 칸(frame)은 스토리가 아니라 '사진 한 장'이다.** 소식 하나에 사진이 여러 장이면
 *    인스타처럼 장마다 칸을 나눈다 — 안 그러면 진행바 한 칸에 사진 세 장이 몰려
 *    "넘겨 본다"가 되지 않는다. 사진 없는 글은 글 자체가 한 칸이 된다.
 * ⚠️ 자동 넘김은 **누르고 있으면 멈춘다**(인스타와 같다). 긴 글이 5초에 넘어가면 못 읽는다.
 * ⚠️ `prefers-reduced-motion` 이면 자동 넘김을 끈다 — 움직임에 민감한 사람에게
 *    스스로 넘어가는 화면은 쫓기는 느낌을 준다.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X, ChevronLeft, ChevronRight, Lock } from 'lucide-react';
import api from '@/lib/axios';
import { timeAgo } from '@/lib/utils';

interface HighlightStory {
  id: number; caption: string; images: string[]; createdAt: string;
  author: { id: number; name: string; avatar: string | null };
}
interface HighlightDetail { id: number; name: string; isPublic: boolean; stories: HighlightStory[] }

/** 진행바 한 칸 = 화면 하나 */
interface Frame { key: string; story: HighlightStory; image: string | null }

const FRAME_MS = 5000;

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export default function HighlightViewer({ highlightId, onClose }: { highlightId: number; onClose: () => void }) {
  const { data, isLoading, isError } = useQuery<HighlightDetail>({
    queryKey: ['highlight', highlightId],
    queryFn: () => api.get(`/stories/highlights/${highlightId}/stories`).then((r) => r.data),
  });

  const frames = useMemo<Frame[]>(() => (data?.stories ?? []).flatMap((s): Frame[] =>
    s.images.length > 0
      ? s.images.map((image, n) => ({ key: `${s.id}-${n}`, story: s, image }))
      : [{ key: `${s.id}-t`, story: s, image: null }],
  ), [data]);

  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const total = frames.length;

  // ⚠️ 닫기를 `setI` 콜백 **안에서** 부르지 말 것 — 상태 갱신 함수는 순수해야 한다
  //    (React 가 두 번 부를 수 있어 onClose 가 두 번 실행된다). 밖에서 판정한다.
  const next = useCallback(() => {
    if (i + 1 >= total) onClose(); else setI(i + 1);
  }, [i, total, onClose]);
  const prev = useCallback(() => setI((v) => Math.max(0, v - 1)), []);
  const reduced = prefersReducedMotion();

  // 자동 넘김. `i` 가 바뀔 때마다 타이머를 새로 잡는다(눌러서 넘겼으면 5초를 다시 준다).
  useEffect(() => {
    if (total === 0 || paused || reduced) return;
    const t = setTimeout(next, FRAME_MS);
    return () => clearTimeout(t);
  }, [i, total, paused, reduced, next]);

  // 키보드 — 화살표로 넘기고 Esc 로 닫는다
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') prev();
      else if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next, prev, onClose]);

  // 뒤 페이지가 같이 스크롤되지 않게
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prevOverflow; };
  }, []);

  const cur = frames[i];

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      {/* ── 진행바 ── */}
      <div className="flex shrink-0 gap-1 px-3 pt-3">
        {frames.map((f, n) => (
          <div key={f.key} className="h-0.5 flex-1 overflow-hidden rounded-full bg-white/30">
            <div
              className="h-full bg-white"
              style={
                n < i ? { width: '100%' }
                  : n > i ? { width: 0 }
                    : {
                      width: '100%',
                      transformOrigin: 'left',
                      // 자동 넘김을 끈 경우엔 채워진 채로 둔다 — 빈 칸으로 남으면 멈춘 게 아니라 고장으로 보인다
                      transform: reduced ? 'scaleX(1)' : 'scaleX(0)',
                      animation: reduced ? undefined : `hlFill ${FRAME_MS}ms linear forwards`,
                      animationPlayState: paused ? 'paused' : 'running',
                    }
              }
            />
          </div>
        ))}
      </div>
      {/* 진행바가 왼쪽에서 차오르는 애니메이션. 스타일 파일을 따로 만들 만큼의 규칙이 아니라 여기 둔다. */}
      <style>{`@keyframes hlFill { from { transform: scaleX(0) } to { transform: scaleX(1) } }`}</style>

      {/* ── 머리말 ── */}
      <div className="flex shrink-0 items-center gap-2.5 px-4 py-3">
        {cur?.story.author.avatar
          ? <img src={cur.story.author.avatar} alt="" className="h-8 w-8 rounded-full object-cover" />
          : <span className="grid h-8 w-8 place-items-center rounded-full bg-white/20 text-xs font-semibold text-white">
              {(cur?.story.author.name ?? data?.name ?? '·').slice(0, 1)}
            </span>}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-white">{data?.name ?? '하이라이트'}</p>
          {cur && <p className="text-[11px] text-white/60">{cur.story.author.name} · {timeAgo(cur.story.createdAt)}</p>}
        </div>
        {data && !data.isPublic && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 text-[11px] text-white/80">
            <Lock size={10} /> 비공개
          </span>
        )}
        <button onClick={onClose} aria-label="닫기" className="shrink-0 p-1 text-white/70 hover:text-white">
          <X size={22} />
        </button>
      </div>

      {/* ── 내용 ── */}
      <div
        className="relative min-h-0 flex-1"
        onPointerDown={() => setPaused(true)}
        onPointerUp={() => setPaused(false)}
        onPointerLeave={() => setPaused(false)}
      >
        {isLoading && <div className="h-full w-full animate-pulse bg-white/5" />}
        {isError && <p className="grid h-full place-items-center px-8 text-center text-sm text-white/70">하이라이트를 열 수 없습니다.</p>}
        {data && total === 0 && (
          <p className="grid h-full place-items-center px-8 text-center text-sm text-white/70">
            아직 담은 소식이 없습니다.<br />
            <span className="text-white/40">소식 오른쪽 아래 별을 눌러 담아보세요.</span>
          </p>
        )}

        {cur && (
          <div className="flex h-full flex-col items-center justify-center px-4">
            {cur.image
              // 작품일 수 있으니 **자르지 않는다** — contain (규칙 18)
              ? <img src={cur.image} alt="" className="max-h-full max-w-full object-contain" />
              : <p className="max-w-lg whitespace-pre-wrap text-center text-lg leading-relaxed text-white [overflow-wrap:anywhere]">
                  {cur.story.caption}
                </p>}
          </div>
        )}

        {/* 좌우 탭 영역 — 인스타처럼 화면 절반씩. 버튼이 아니라 넓은 자리라 손이 쉽게 닿는다. */}
        {total > 0 && (
          <>
            <button onClick={prev} aria-label="이전"
              className="group absolute inset-y-0 left-0 w-1/3 cursor-default px-3 text-left disabled:opacity-0"
              disabled={i === 0}>
              <ChevronLeft size={28} className="text-white/0 transition group-hover:text-white/60" />
            </button>
            <button onClick={next} aria-label="다음"
              className="group absolute inset-y-0 right-0 w-1/3 cursor-default px-3 text-right">
              <ChevronRight size={28} className="ml-auto text-white/0 transition group-hover:text-white/60" />
            </button>
          </>
        )}
      </div>

      {/* ── 사진 아래 글 (사진이 있을 때만 — 없으면 위에서 이미 크게 보여줬다) ── */}
      {cur?.image && cur.story.caption && (
        <div className="shrink-0 bg-gradient-to-t from-black/90 to-transparent px-5 pb-6 pt-8">
          <p className="mx-auto max-w-lg whitespace-pre-wrap text-center text-sm leading-relaxed text-white [overflow-wrap:anywhere]">
            {cur.story.caption}
          </p>
        </div>
      )}
    </div>
  );
}
