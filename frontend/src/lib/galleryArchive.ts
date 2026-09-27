import type { GalleryArchive } from '@/types';

/**
 * 갤러리 '지난 활동 기록' 편집 상태 (2026-09-16).
 *
 * ⚠️ 컴포넌트 파일이 아니라 여기 있는 이유: `GalleryArchiveForm.tsx` 가 컴포넌트와 이 헬퍼를 함께
 * 내보내면 Fast Refresh 가 그 파일 전체를 통째로 다시 만든다(eslint `react-refresh/only-export-components`).
 * 순수 함수라 화면과 분리해 두는 게 맞다.
 */
/** 기록 하나에 넣을 수 있는 사진 수 — 서버 `routes/gallery.ts` 의 ARCHIVE_MAX_IMAGES 와 같은 값(넘으면 서버가 400) */
export const ARCHIVE_MAX_IMAGES = 12;

export interface ArchiveDraft {
  title: string; venue: string; period: string; date: string; artists: string; body: string; images: string[];
}

export const emptyArchiveDraft = (): ArchiveDraft =>
  ({ title: '', venue: '', period: '', date: '', artists: '', body: '', images: [] });

export const draftFrom = (a: GalleryArchive): ArchiveDraft => ({
  title: a.title,
  venue: a.venue ?? '',
  period: a.period ?? '',
  // `<input type="date">` 는 YYYY-MM-DD 만 받는다
  date: a.date ? a.date.slice(0, 10) : '',
  artists: a.artists ?? '',
  body: a.body ?? '',
  images: [...a.images],
});
