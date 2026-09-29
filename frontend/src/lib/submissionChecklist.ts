/**
 * 출품 자료(작가가 갤러리에 내는 작품·대표작·약력·작가노트)의 **체크리스트와 검증** — 한 곳 (2026-09-29).
 *
 * 예전 편집기는 저장 버튼이 네다섯 개였고 무엇을 채워야 끝인지 어디에도 없었다. 실제로 밟아 보면
 * 상단 [저장] → "대표작을 선택해주세요" → 대표작 칸은 비활성("저장한 작품만") → 작품 카드의 작은 [저장]을
 * 먼저 눌러야 풀리는 순환이었다. 이제 버튼은 [임시저장]·[갤러리에 제출] 둘이고, 채울 것은 여기 네 줄이 전부다.
 *
 * ⚠️ '갤러리에 보낸 상태'(serverStatus)는 서버 `routes/exhibition.ts` 의 `submissionComplete` 와
 *    갤러리 화면의 [제출완료] 배지와 **같은 규칙**이어야 한다 — 작가는 다 냈다고 보는데 갤러리는 미제출로 보면
 *    둘이 다른 말을 하게 된다(임시저장 작품 제외 · 약력·노트는 내용이 있는가).
 */
import { isBlankArtwork } from '@/lib/saveState';
import type { ArtistCv, ArtistNote, ArtworkItem } from '@/types';

/** 빈 객체({})·빈 배열·공백 문자열은 '없음' — 서버 `lib/submission.ts hasSubmissionContent` 와 같은 판정 */
export function hasContent(obj: unknown): boolean {
  if (!obj || typeof obj !== 'object') return false;
  return Object.values(obj as Record<string, unknown>).some((v) =>
    typeof v === 'string' ? v.trim().length > 0
      : Array.isArray(v) ? v.length > 0
        : (v && typeof v === 'object') ? hasContent(v) : false);
}

/** 캡션(.hwp)·출품리스트 PDF 에 들어가는 칸 — 비면 갤러리가 캡션을 만들 수 없다 */
export const ARTWORK_REQUIRED: [keyof ArtworkItem, string][] = [
  ['title', '작품명'], ['size', '크기'], ['medium', '재료'], ['year', '제작년도'], ['price', '가격'],
];

/** 그 작품에서 빈 필수 칸 이름들(빈 칸 작품은 검사하지 않는다 — 보내지 않으므로) */
export function artworkMissing(a: ArtworkItem | undefined): string[] {
  if (!a || isBlankArtwork(a)) return [];
  return ARTWORK_REQUIRED.filter(([k]) => !String(a[k] ?? '').trim()).map(([, label]) => label);
}

export function hasNoteContent(note: ArtistNote | null | undefined): boolean {
  return !!note && (!!note.statement?.trim() || (note.sections?.length ?? 0) > 0);
}

export type ChecklistKey = 'artworks' | 'representative' | 'cv' | 'note';
export interface ChecklistItem { key: ChecklistKey; label: string; done: boolean; tab: 'artwork' | 'cv' | 'note' }

/**
 * 지금 **화면에 채운 것** 기준의 체크리스트 — "무엇이 남았나" 를 보여 주는 용도다.
 * (갤러리가 실제로 받은 것은 `serverStatus`)
 */
export function submissionChecklist(input: {
  artworkList: ArtworkItem[];
  repIndex: number | null;
  cv: ArtistCv | null | undefined;
  note: ArtistNote | null | undefined;
}): ChecklistItem[] {
  const filled = input.artworkList.filter((a) => !isBlankArtwork(a));
  const artworksDone = filled.length > 0 && filled.every((a) => artworkMissing(a).length === 0);
  const rep = input.repIndex != null ? input.artworkList[input.repIndex] : undefined;
  return [
    { key: 'artworks', label: '출품작', done: artworksDone, tab: 'artwork' },
    { key: 'representative', label: '대표작', done: !!rep && !isBlankArtwork(rep), tab: 'artwork' },
    { key: 'cv', label: '약력', done: hasContent(input.cv), tab: 'cv' },
    { key: 'note', label: '작가노트', done: hasNoteContent(input.note), tab: 'note' },
  ];
}

export interface ServerSubmissionStatus {
  /** 갤러리에 보이는 작품(임시저장 제외)이 있는가 */
  artworks: boolean;
  cv: boolean;
  note: boolean;
  /** 셋 다 — 서버 `submissionComplete` 와 같다 */
  complete: boolean;
  /** 하나라도 */
  any: boolean;
}

/** 서버에 저장된 값 기준 — 갤러리가 지금 보고 있는 것 */
export function serverStatus(saved: { artworkList?: ArtworkItem[] | null; cv?: ArtistCv | null; note?: ArtistNote | null }): ServerSubmissionStatus {
  const artworks = (saved.artworkList ?? []).some((a) => !a?.draft && !isBlankArtwork(a));
  const cv = hasContent(saved.cv);
  const note = hasContent(saved.note);
  return { artworks, cv, note, complete: artworks && cv && note, any: artworks || cv || note };
}
