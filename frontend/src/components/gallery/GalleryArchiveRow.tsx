import { Edit3, Trash2 } from 'lucide-react';
import Thumb from '@/components/shared/Thumb';
import type { GalleryArchive } from '@/types';

/**
 * 지난 활동 기록 한 줄 (2026-09-16) — 갤러리가 **아트링크 밖에서** 해 온 전시·아트페어.
 *
 * 공개 갤러리 페이지의 '지난 전시·아트페어'에서 아트링크 공모와 **한 줄로 섞여** 날짜순으로 나온다.
 * 작가가 갤러리를 고를 때 읽는 이력이라, 우리 플랫폼에서 한 것인지 아닌지를 배지로 구분하지 않는다 —
 * 보는 사람에게는 둘 다 "이 갤러리가 해 온 일"이다.
 */
export default function GalleryArchiveRow({ archive, canEdit, onEdit, onDelete, onOpenImage }: {
  archive: GalleryArchive;
  canEdit: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onOpenImage: (images: string[], index: number) => void;
}) {
  const meta = [archive.period, archive.venue].filter(Boolean).join(' · ');
  return (
    <div className="border-b border-gray-200 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-medium break-keep [overflow-wrap:anywhere]">{archive.title}</h3>
          {meta && <p className="mt-0.5 text-sm text-gray-500 break-keep">{meta}</p>}
          {archive.artists && <p className="mt-0.5 text-sm text-gray-500 break-keep [overflow-wrap:anywhere]">참여 작가 {archive.artists}</p>}
        </div>
        {canEdit && (
          <div className="flex shrink-0 items-center gap-1">
            <button onClick={onEdit} aria-label="수정" className="flex h-9 w-9 items-center justify-center text-gray-400 hover:text-gray-900"><Edit3 size={14} /></button>
            <button onClick={onDelete} aria-label="삭제" className="flex h-9 w-9 items-center justify-center text-gray-400 hover:text-accent"><Trash2 size={14} /></button>
          </div>
        )}
      </div>

      {archive.body && (
        <p className="mt-2 max-w-3xl whitespace-pre-wrap text-sm leading-relaxed text-gray-700 break-keep [overflow-wrap:anywhere]">{archive.body}</p>
      )}

      {archive.images.length > 0 && (
        <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
          {archive.images.map((url, i) => (
            <button key={`${url}-${i}`} onClick={() => onOpenImage(archive.images, i)} className="block cursor-zoom-in">
              {/* 목록 칸이라 t240 이 아니라 t800 — 24px 칸이 아니라 100~160px 이라 240 은 뭉개진다 */}
              <Thumb src={url} size="grid" alt="" loading="lazy" className="h-24 w-full rounded-lg object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
