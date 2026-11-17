/**
 * 갤러리 카드 — 갤러리 찾기(PC 격자 `GalleryCard` · 휴대폰 줄 `GalleryRow`, 2026-11-15).
 */
import { Link } from 'react-router-dom';
import SkeletonImage from '@/components/shared/SkeletonImage';
import { HeartButton } from '@/components/listing/ListControls';
import { cn } from '@/lib/utils';
import { galleryPath } from '@/lib/handle';
import { addressArea, daysUntil, shortDate } from '@/lib/listings';
import type { Gallery } from '@/types';

/** 카드가 쓰는 것만 — 목록 응답(이미지 목록)과 대표 사진 주소 하나 둘 다 받는다 */
export type GalleryCardData = Pick<Gallery, 'id' | 'name' | 'address' | 'region' | 'reviewCount' | 'description' | 'mainImage' | 'handle' | 'isFavorited' | 'openCall' | 'nowShow'> & { images?: Gallery['images'] };

const photoOf = (g: GalleryCardData) => g.images?.[0]?.url || g.mainImage || '';

/** 동네 · 리뷰 수(있을 때만) — 리뷰 0 을 '아직 리뷰 없음' 으로 적지 않는다(11곳 전부 그 글자였다) */
function placeLine(g: GalleryCardData) {
  return [addressArea(g.address, g.region), g.reviewCount > 0 ? `리뷰 ${g.reviewCount}개` : ''].filter(Boolean).join(' · ');
}

/**
 * 모집 중 · 전시 중 두 줄 — 있을 때만. 모집 중은 그 공모로, 전시는 그 전시로 간다.
 * '모집 중'만 강조색(이 화면에서 작가가 찾는 것), 전시는 진한 글자.
 */
function Signals({ g, small }: { g: GalleryCardData; small?: boolean }) {
  const call = g.openCall;
  const show = g.nowShow;
  if (!call && !show) return null;
  const days = call ? daysUntil(call.deadline) : 0;
  return (
    <div className={cn('space-y-1', small ? 'mt-2.5 text-xs' : 'mt-3.5 text-[13px]')}>
      {call && (
        <p className="flex min-w-0 gap-2">
          <b className="shrink-0 font-semibold text-accent">모집 중</b>
          <Link to={`/exhibitions/${call.id}`} className="min-w-0 truncate text-gray-700 hover:text-gray-900 hover:underline hover:underline-offset-2">
            {call.title}{call.count > 1 ? ` 외 ${call.count - 1}` : ''}
          </Link>
          <span className="shrink-0 text-gray-500">{days === 0 ? '오늘 마감' : `D-${days}`}</span>
        </p>
      )}
      {show && (
        <p className="flex min-w-0 gap-2">
          <b className="shrink-0 font-semibold text-gray-900">{show.state === 'ongoing' ? '전시 중' : '전시 예정'}</b>
          <Link to={`/shows/${show.id}`} className="min-w-0 truncate text-gray-700 hover:text-gray-900 hover:underline hover:underline-offset-2">{show.title}</Link>
          <span className="shrink-0 text-gray-500">{show.state === 'ongoing' ? `${shortDate(show.endDate)}까지` : `${shortDate(show.startDate)}부터`}</span>
        </p>
      )}
    </div>
  );
}

/** PC·태블릿 카드 — 사진은 자르지 않는다(contain + 같은 사진 흐림). 사진 링크는 이름 링크와 같은 곳이라 탭 순서에서 뺀다 */
export function GalleryCard({ g, showFav = false, onFav }: { g: GalleryCardData; showFav?: boolean; onFav?: (id: number) => void }) {
  const to = galleryPath(g);
  return (
    <article className="group/card">
      <Link to={to} tabIndex={-1} aria-hidden="true" className="block">
        <SkeletonImage
          src={photoOf(g)}
          thumb="grid"
          alt=""
          fallbackLabel={g.name}
          className="aspect-[4/3]"
          imgClassName="object-contain transition-opacity duration-300 group-hover/card:opacity-90"
          loading="lazy"
          blurFill
        />
      </Link>
      <div className="mt-3.5 flex items-center justify-between gap-2">
        <h2 className="min-w-0 text-[19px] font-medium leading-snug text-gray-900 break-keep [overflow-wrap:anywhere]">
          <Link to={to} className="decoration-1 underline-offset-2 hover:underline">{g.name}</Link>
        </h2>
        {showFav && onFav && <HeartButton on={!!g.isFavorited} onToggle={() => onFav(g.id)} className="-my-2 -mr-3" />}
      </div>
      {placeLine(g) && <p className="mt-1 text-[13px] text-gray-500">{placeLine(g)}</p>}
      {g.description && <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-gray-600 break-keep [overflow-wrap:anywhere]">{g.description}</p>}
      <Signals g={g} />
    </article>
  );
}

/** 휴대폰 줄 — 작은 사진 + 이름 · 동네 · 소개 두 줄 · 모집 중/전시 중 */
export function GalleryRow({ g, showFav = false, onFav }: { g: GalleryCardData; showFav?: boolean; onFav?: (id: number) => void }) {
  const to = galleryPath(g);
  return (
    <li className="border-b border-gray-100">
      <article className="flex gap-4 py-4">
        <Link to={to} tabIndex={-1} aria-hidden="true" className="w-[116px] shrink-0">
          <SkeletonImage src={photoOf(g)} thumb="list" alt="" fallbackLabel={g.name} className="aspect-[4/3]" imgClassName="object-contain" loading="lazy" blurFill />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h2 className="min-w-0 text-[16px] font-medium leading-snug text-gray-900 break-keep [overflow-wrap:anywhere]">
              <Link to={to}>{g.name}</Link>
            </h2>
            {showFav && onFav && <HeartButton on={!!g.isFavorited} onToggle={() => onFav(g.id)} size={17} className="-my-3 -mr-3" />}
          </div>
          {placeLine(g) && <p className="mt-0.5 text-xs text-gray-500">{placeLine(g)}</p>}
          {g.description && <p className="mt-1.5 line-clamp-2 text-[13px] leading-normal text-gray-600 break-keep [overflow-wrap:anywhere]">{g.description}</p>}
          <Signals g={g} small />
        </div>
      </article>
    </li>
  );
}
