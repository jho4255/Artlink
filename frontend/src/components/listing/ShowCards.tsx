/**
 * 전시 카드 — 전시 찾기(PC 격자 `ShowCard` · 휴대폰 줄 `ShowRow`, 2026-11-15, 모집공고 카드와 같은 틀).
 * 기간 표시는 `lib/listings.ts showView` 하나(전시 상세 머리와 같은 말).
 */
import { Link } from 'react-router-dom';
import SkeletonImage from '@/components/shared/SkeletonImage';
import { HeartButton } from '@/components/listing/ListControls';
import { cn } from '@/lib/utils';
import { addressArea, artistsLine, showView } from '@/lib/listings';
import type { Show } from '@/types';

export type ShowCardData = Pick<Show, 'id' | 'title' | 'startDate' | 'endDate' | 'location' | 'region' | 'artists' | 'posterImage' | 'isFavorited'> & {
  gallery?: { id: number; name: string } | null;
};

/** 기간 한 줄 — `D-3 종료 12.20(토)까지`. 끝나기 7일 안이면 앞 글자가 빨강 */
export function ShowPeriodLine({ show, className }: { show: Pick<Show, 'startDate' | 'endDate'>; className?: string }) {
  const v = showView(show);
  return (
    <p className={cn('min-w-0 truncate text-gray-500', className)}>
      <b className={cn('font-bold', v.hot ? 'text-accent' : v.state === 'ended' ? 'text-gray-500' : 'text-gray-900')}>{v.badge}</b>
      <span className="ml-2">{v.date}</span>
    </p>
  );
}

/** 갤러리 · 동네 — 갤러리 이름은 그 갤러리로. 장소가 갤러리 밖이어도 동네는 전시 장소 기준 */
function PlaceLine({ show, className }: { show: ShowCardData; className?: string }) {
  const area = addressArea(show.location, show.region);
  return (
    <p className={cn('min-w-0 truncate', className)}>
      {show.gallery && (
        <Link to={`/galleries/${show.gallery.id}`} className="text-gray-700 decoration-1 underline-offset-2 hover:underline">{show.gallery.name}</Link>
      )}
      {area && <span className={cn('text-gray-500', show.gallery && 'ml-2')}>{area}</span>}
    </p>
  );
}

/** PC·태블릿 격자 카드 — 포스터는 자르지 않는다(contain + 같은 그림 흐림). 포스터 링크는 제목 링크와 같은 곳이라 탭 순서에서 뺀다 */
export function ShowCard({ show, showFav = false, onFav }: { show: ShowCardData; showFav?: boolean; onFav?: (id: number) => void }) {
  const artists = artistsLine(show.artists);
  return (
    <article className="group/card">
      <Link to={`/shows/${show.id}`} tabIndex={-1} aria-hidden="true" className="block">
        <SkeletonImage
          src={show.posterImage}
          thumb="grid"
          fallbackLabel={show.title}
          className="aspect-[210/297]"
          imgClassName="object-contain transition-opacity duration-300 group-hover/card:opacity-80"
          loading="lazy"
          blurFill
        />
      </Link>
      <div className="mt-3 flex items-center justify-between gap-2">
        <ShowPeriodLine show={show} className="text-sm" />
        {showFav && onFav && <HeartButton on={!!show.isFavorited} onToggle={() => onFav(show.id)} className="-my-2 -mr-3" />}
      </div>
      <h3 className="mt-1 text-lg font-medium leading-snug text-gray-900 break-keep [overflow-wrap:anywhere]">
        <Link to={`/shows/${show.id}`} className="decoration-1 underline-offset-2 hover:underline">{show.title}</Link>
      </h3>
      {artists && <p className="mt-1 truncate text-[13px] text-gray-600">{artists}</p>}
      <PlaceLine show={show} className="mt-1.5 text-sm" />
    </article>
  );
}

/** 휴대폰 줄 — 작은 포스터 + 기간 · 제목 · 작가 · 갤러리. 한 화면에 네댓 개가 든다 */
export function ShowRow({ show, showFav = false, onFav }: { show: ShowCardData; showFav?: boolean; onFav?: (id: number) => void }) {
  const artists = artistsLine(show.artists, 2);
  return (
    <li className="border-b border-gray-100">
      <article className="flex gap-4 py-4">
        <Link to={`/shows/${show.id}`} tabIndex={-1} aria-hidden="true" className="w-[88px] shrink-0">
          <SkeletonImage
            src={show.posterImage}
            thumb="list"
            fallbackLabel={show.title}
            className="aspect-[210/297]"
            imgClassName="object-contain"
            loading="lazy"
            blurFill
          />
        </Link>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between gap-2">
            <ShowPeriodLine show={show} className="text-[13px]" />
            {showFav && onFav && <HeartButton on={!!show.isFavorited} onToggle={() => onFav(show.id)} size={17} className="-my-3 -mr-3" />}
          </div>
          <h3 className="mt-1 line-clamp-2 text-[16px] font-medium leading-snug text-gray-900 break-keep [overflow-wrap:anywhere]">
            <Link to={`/shows/${show.id}`}>{show.title}</Link>
          </h3>
          {artists && <p className="mt-0.5 truncate text-xs text-gray-600">{artists}</p>}
          <PlaceLine show={show} className="mt-auto pt-2 text-[13px]" />
        </div>
      </article>
    </li>
  );
}
