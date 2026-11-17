/**
 * ArtStory 세로 카드 (3:5) — 홈 카드 줄과 [ArtStory] 격자가 같이 쓴다 (2026-11-14, 규칙 81).
 *
 * - 사진은 **자르지 않는다**(규칙 18 — 작품일 수 있다). 남는 자리는 같은 사진을 흐리게 깔아 채운다(공모 포스터 카드와 같은 방식).
 * - 왼쪽 위에 올린 사람, 사진이 여러 장이면 오른쪽 위 `1/3`.
 * - 글만 있는 소식은 바탕색 위에 글.
 */
import Thumb from '@/components/shared/Thumb';
import { overlayFor, storyBgHex, type Story } from '@/lib/story';
import { monthDayKst } from '@/lib/homepageSite';
import StoryPhoto from './StoryPhoto';

export function StoryAvatar({ name, avatar, size = 22 }: { name: string; avatar: string | null; size?: number }) {
  return avatar
    ? <img src={avatar} alt="" style={{ width: size, height: size }} className="shrink-0 rounded-full border border-white/75 object-cover" />
    : (
      <span style={{ width: size, height: size, fontSize: Math.round(size * 0.48) }}
        className="grid shrink-0 place-items-center rounded-full border border-white/75 bg-white/20 font-bold text-white">
        {name.slice(0, 1)}
      </span>
    );
}

export default function StoryCard({ story, onOpen, className = '', label, badge, head = 'author' }: {
  story: Story;
  onOpen: () => void;
  /** 크기는 부르는 쪽이 정한다(홈 줄은 고정 폭, 격자는 칸 폭) */
  className?: string;
  /** 화면 낭독기 이름(기본: '○○님의 소식') */
  label?: string;
  /** 카드 아래쪽에 얹을 표시(내린 소식·이웃 공개) */
  badge?: React.ReactNode;
  /**
   * 왼쪽 위 — 올린 사람(기본) 또는 **올린 날**. 한 사람의 홈페이지 [소식] 탭(2026-11-14, 규칙 82)은 카드마다 같은 이름이라
   * 이름 대신 날짜를 단다.
   */
  head?: 'author' | 'date';
}) {
  const img = story.images[0];
  const n = story.images.length;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={label ?? `${story.author.name}님의 소식`}
      data-story-card={story.id}
      className={`group relative block shrink-0 overflow-hidden rounded-md text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900 ${className}`}
      style={{ background: img ? '#111111' : storyBgHex(story.bg) }}
    >
      {img ? (
        <>
          {/* 흐린 배경 — 장식이라 썸네일(작은 것)로 충분하다 */}
          <Thumb src={img} size="list" alt="" aria-hidden="true"
            className="absolute inset-[-12%] h-[124%] w-[124%] object-cover opacity-60 blur-xl" />
          <StoryPhoto src={img} size="grid" alt="" loading="lazy" overlay={overlayFor(story, 0)}
            className="transition-transform duration-300 group-hover:scale-[1.02]" />
        </>
      ) : (
        <span className="absolute inset-0 flex items-center justify-center px-3.5 pb-4 pt-11 text-center text-[14px] font-bold leading-relaxed text-white [overflow-wrap:anywhere] md:text-[15px]">
          <span className="line-clamp-6 whitespace-pre-line">{story.caption}</span>
        </span>
      )}
      <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-14 bg-gradient-to-b from-black/55 to-transparent" />
      <span className="absolute inset-x-2 top-2 flex items-center gap-1.5">
        {head === 'date' ? (
          <span className="min-w-0 flex-1 truncate text-xs font-bold text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.6)]" data-story-date>{monthDayKst(story.createdAt)}</span>
        ) : (
          <>
            <StoryAvatar name={story.author.name} avatar={story.author.avatar} />
            <span className="min-w-0 flex-1 truncate text-xs font-bold text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.6)]">{story.author.name}</span>
          </>
        )}
        {n > 1 && <span className="shrink-0 rounded-full bg-black/55 px-1.5 text-[11px] text-white">1/{n}</span>}
      </span>
      {badge && <span className="absolute inset-x-2 bottom-2 flex flex-wrap gap-1">{badge}</span>}
    </button>
  );
}
