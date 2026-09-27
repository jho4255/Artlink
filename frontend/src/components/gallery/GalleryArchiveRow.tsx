import { Edit3, Trash2 } from 'lucide-react';
import SquarePhotoGrid from '@/components/shared/SquarePhotoGrid';
import RichText from '@/components/shared/RichText';
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
        <RichText value={archive.body} className="mt-2 max-w-3xl text-sm leading-relaxed text-gray-700 break-keep [overflow-wrap:anywhere]" />
      )}

      {/* 사진은 작가 홈페이지 작품 격자와 같은 정사각 칸 — 자르지 않는다 */}
      <SquarePhotoGrid
        className="mt-4"
        photos={archive.images.map((url, i) => ({ url, key: `${url}-${i}` }))}
        onOpen={(i) => onOpenImage(archive.images, i)}
      />
    </div>
  );
}
