import { Link } from 'react-router-dom';
import { Eye, Heart, MessageCircle, Pin, PinOff, Trash2 } from 'lucide-react';
import Thumb from '@/components/shared/Thumb';
import { timeAgo } from '@/lib/utils';
import { authorLine, type PostAuthor } from '@/lib/postAuthor';

export type { PostAuthor };

/**
 * 커뮤니티 목록의 한 줄(목록형)·한 장(카드형) — 탭마다 관리자가 고른 모양(`PostCategory.layout`)으로 그린다(2026-11-13).
 * 사진은 4:3 으로 잘라 보인다(목록 썸네일 관례 — DESIGN.md 6). 글 안에서는 원래 비율 그대로다.
 */
export interface PostRowData {
  id: number; title: string; excerpt: string;
  thumbnail: string | null; cover?: string | null; imageCount: number; readingMinutes?: number;
  likeCount: number; commentCount: number; viewCount: number; createdAt: string;
  notice: boolean; pinned: boolean;
  category: { id: number; name: string; slug: string; layout?: string; writePolicy?: string } | null;
  author: PostAuthor;
}


function Tag({ p, showTab }: { p: PostRowData; showTab: boolean }) {
  const writer = p.category?.writePolicy === 'writers';
  const parts: { text: string; accent: boolean; strong?: boolean }[] = [];
  if (p.notice) parts.push({ text: '공지', accent: true, strong: true });
  // 탭 이름 — 전체 보기에서만. ⚠️ 공지 배지와 같은 글자면 안 그린다(관리자가 탭 이름을 '공지'로 지으면 '공지 공지')
  if (showTab && p.category && !(p.notice && p.category.name === '공지')) parts.push({ text: p.category.name, accent: writer });
  if (parts.length === 0 && !p.pinned) return null;
  return (
    <span className="flex flex-wrap items-center gap-x-1.5 text-[12px] font-medium">
      {p.pinned && <Pin size={12} className="text-gray-500" aria-label="고정됨" />}
      {parts.map((x, i) => (
        <span key={i} className={`${x.accent ? 'text-accent' : 'text-gray-500'} ${x.strong ? 'font-semibold' : ''}`}>{i > 0 && <span className="mr-1.5 text-gray-300">·</span>}{x.text}</span>
      ))}
    </span>
  );
}

function Meta({ p }: { p: PostRowData }) {
  return (
    <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-gray-500 md:text-[13px]">
      <span>{authorLine(p.author)}</span>
      <span>{timeAgo(p.createdAt)}</span>
      <span className="inline-flex items-center gap-1"><Eye size={13} aria-hidden="true" /><span className="sr-only">조회</span>{p.viewCount}</span>
      {p.likeCount > 0 && <span className="inline-flex items-center gap-1"><Heart size={13} aria-hidden="true" /><span className="sr-only">좋아요</span>{p.likeCount}</span>}
      {p.commentCount > 0 && <span className="inline-flex items-center gap-1"><MessageCircle size={13} aria-hidden="true" /><span className="sr-only">댓글</span>{p.commentCount}</span>}
    </span>
  );
}

export function PostRow({ p, showTab, admin }: {
  p: PostRowData; showTab: boolean;
  admin?: { onPin: () => void; onDelete: () => void } | null;
}) {
  const img = p.cover ?? p.thumbnail;
  return (
    <li className="group relative border-b border-gray-100">
      <Link to={`/community/${p.id}`} className="flex gap-4 py-5 md:gap-6 md:py-6">
        <span className="min-w-0 flex-1">
          <Tag p={p} showTab={showTab} />
          <span className="mt-1 block break-keep text-[16px] font-medium leading-snug text-gray-900 group-hover:underline [overflow-wrap:anywhere] md:text-[18px]">{p.title}</span>
          {p.excerpt && <span className="mt-1.5 line-clamp-2 break-keep text-[14px] leading-relaxed text-gray-500 [overflow-wrap:anywhere]">{p.excerpt}</span>}
          <Meta p={p} />
        </span>
        {img && (
          <span className="mt-1 block aspect-[4/3] w-24 shrink-0 overflow-hidden bg-gray-100 md:w-36">
            <Thumb src={img} size="list" alt="" loading="lazy" className="h-full w-full object-cover" />
          </span>
        )}
      </Link>
      {admin && (
        <span className="absolute right-0 top-2 flex gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
          <button type="button" onClick={admin.onPin} title={p.pinned ? '고정 해제' : '맨 위에 고정'} aria-label={p.pinned ? '고정 해제' : '맨 위에 고정'}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-500 hover:text-gray-900">
            {p.pinned ? <PinOff size={14} /> : <Pin size={14} />}
          </button>
          <button type="button" onClick={admin.onDelete} title="글 삭제 (관리자)" aria-label="글 삭제 (관리자)"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-500 hover:text-accent">
            <Trash2 size={14} />
          </button>
        </span>
      )}
    </li>
  );
}

export function PostCard({ p, showTab, large = false }: { p: PostRowData; showTab: boolean; large?: boolean }) {
  const img = p.cover ?? p.thumbnail;
  return (
    <Link to={`/community/${p.id}`} className={`group block min-w-0 ${large ? 'md:col-span-2' : ''}`}>
      {img ? (
        <span className="block aspect-[4/3] overflow-hidden bg-gray-100">
          <Thumb src={img} size="grid" alt="" loading="lazy" className="h-full w-full object-cover transition-opacity duration-300 group-hover:opacity-80" />
        </span>
      ) : (
        <span className="flex aspect-[4/3] items-end bg-gray-50 p-5">
          <span className="line-clamp-4 break-keep text-[15px] leading-relaxed text-gray-600 [overflow-wrap:anywhere]">{p.excerpt}</span>
        </span>
      )}
      <span className="mt-3.5 block"><Tag p={p} showTab={showTab} /></span>
      <span className="mt-1 block break-keep text-[18px] font-medium leading-snug text-gray-900 group-hover:underline [overflow-wrap:anywhere] md:text-[20px]">{p.title}</span>
      {img && p.excerpt && <span className="mt-1.5 line-clamp-2 break-keep text-[14px] leading-relaxed text-gray-500 [overflow-wrap:anywhere]">{p.excerpt}</span>}
      <span className="mt-2.5 block text-[13px] text-gray-500">{authorLine(p.author)}{p.readingMinutes ? ` · ${p.readingMinutes}분` : ''}</span>
    </Link>
  );
}
