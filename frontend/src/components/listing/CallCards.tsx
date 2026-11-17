/**
 * 모집공고 카드 — 모집공고 찾기(PC 격자 `CallCard` · 휴대폰 줄 `CallRow`, 2026-11-15).
 * 마감 표시는 `lib/listings.ts deadlineView` 하나(상세·따라오는 [지원하기] 줄과 같은 말).
 */
import { Link } from 'react-router-dom';
import SkeletonImage from '@/components/shared/SkeletonImage';
import HostBadge from '@/components/shared/HostBadge';
import { HeartButton } from '@/components/listing/ListControls';
import { regionLabels, exhibitionTypeLabels, capacityText, cn } from '@/lib/utils';
import { isAdminHosted } from '@/lib/exhibitionHost';
import { deadlineView } from '@/lib/listings';
import type { Exhibition } from '@/types';

const posterOf = (ex: Exhibition) => ex.imageUrl || ex.gallery?.mainImage || '';

/** 마감 표시 한 줄 — `D-9 11.24(화)까지`. 7일 안이면 앞 글자가 빨강 */
export function DeadlineLine({ ex, closedTab, className }: { ex: Exhibition; closedTab: boolean; className?: string }) {
  const dv = deadlineView(ex, { closedScope: closedTab });
  return (
    <p className={cn('min-w-0 truncate text-gray-500', className)}>
      <b className={cn('font-bold', dv.hot ? 'text-accent' : dv.state === 'closed' ? 'text-gray-500' : 'text-gray-900')}>{dv.badge}</b>
      {dv.date && <span className="ml-2">{dv.date}</span>}
    </p>
  );
}

/**
 * 주최 — 아트링크 주최면 로고(갤러리 이름을 두면 그 갤러리가 주최한 것으로 읽힌다, `HostBadge`), 아니면 갤러리 이름(그 갤러리로).
 * 카드 전체를 링크로 감싸지 않으므로 여기 링크가 겹치지 않는다(링크 안 단추 금지).
 */
export function HostLine({ ex, className }: { ex: Exhibition; className?: string }) {
  if (isAdminHosted(ex)) return <p className={className}><HostBadge exhibition={ex} className="text-[15px]" /></p>;
  if (!ex.gallery) return null;
  return (
    <p className={cn('min-w-0 truncate', className)}>
      <Link to={`/galleries/${ex.gallery.id}`} className="hover:underline hover:underline-offset-2">{ex.gallery.name}</Link>
    </p>
  );
}

const metaOf = (ex: Exhibition) => [exhibitionTypeLabels[ex.type], regionLabels[ex.region], capacityText(ex)].filter(Boolean).join(' · ');

/** PC·태블릿 격자 카드 — 포스터는 자르지 않는다(contain + 같은 그림 흐림). 포스터 링크는 제목 링크와 같은 곳이라 탭 순서에서 뺀다 */
export function CallCard({ ex, closedTab = false, showFav = false, onFav }: { ex: Exhibition; closedTab?: boolean; showFav?: boolean; onFav?: (id: number) => void }) {
  return (
    <article className="group/card">
      <Link to={`/exhibitions/${ex.id}`} tabIndex={-1} aria-hidden="true" className="block">
        <SkeletonImage
          src={posterOf(ex)}
          thumb="grid"
          fallbackLabel={ex.title}
          className="aspect-[210/297]"
          imgClassName="object-contain transition-opacity duration-300 group-hover/card:opacity-80"
          loading="lazy"
          blurFill
        />
      </Link>
      <div className="mt-3 flex items-center justify-between gap-2">
        <DeadlineLine ex={ex} closedTab={closedTab} className="text-sm" />
        {showFav && onFav && <HeartButton on={!!ex.isFavorited} onToggle={() => onFav(ex.id)} className="-my-2 -mr-3" />}
      </div>
      <h3 className="mt-1 text-lg font-medium leading-snug text-gray-900 break-keep [overflow-wrap:anywhere]">
        <Link to={`/exhibitions/${ex.id}`} className="decoration-1 underline-offset-2 hover:underline">{ex.title}</Link>
      </h3>
      <HostLine ex={ex} className="mt-1.5 text-sm text-gray-700" />
      <p className="mt-1 text-[13px] text-gray-500">{metaOf(ex)}</p>
    </article>
  );
}

/** 휴대폰 줄 — 작은 포스터 + 마감 · 제목 · 주최 · 정보. 한 화면에 네댓 개가 든다(예전 카드는 한 장 580px) */
export function CallRow({ ex, closedTab = false, showFav = false, onFav }: { ex: Exhibition; closedTab?: boolean; showFav?: boolean; onFav?: (id: number) => void }) {
  return (
    <li className="border-b border-gray-100">
      <article className="flex gap-4 py-4">
        <Link to={`/exhibitions/${ex.id}`} tabIndex={-1} aria-hidden="true" className="w-[88px] shrink-0">
          <SkeletonImage
            src={posterOf(ex)}
            thumb="list"
            fallbackLabel={ex.title}
            className="aspect-[210/297]"
            imgClassName="object-contain"
            loading="lazy"
            blurFill
          />
        </Link>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between gap-2">
            <DeadlineLine ex={ex} closedTab={closedTab} className="text-[13px]" />
            {showFav && onFav && <HeartButton on={!!ex.isFavorited} onToggle={() => onFav(ex.id)} size={17} className="-my-3 -mr-3" />}
          </div>
          <h3 className="mt-1 line-clamp-2 text-[16px] font-medium leading-snug text-gray-900 break-keep [overflow-wrap:anywhere]">
            <Link to={`/exhibitions/${ex.id}`}>{ex.title}</Link>
          </h3>
          <HostLine ex={ex} className="mt-auto pt-2 text-[13px] text-gray-700" />
          <p className="mt-0.5 text-xs text-gray-500">{metaOf(ex)}</p>
        </div>
      </article>
    </li>
  );
}
