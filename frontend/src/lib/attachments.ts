/**
 * 공모 첨부파일 (2026-10-08) — 모집 요강·지원서 양식 같은 파일. 누구나(비회원 포함) 공고 상세에서 내려받는다.
 * 서버 규칙은 `backend/src/lib/exhibitionAttachments.ts`, 업로드는 `POST /api/upload/attachment`(`routes/upload.ts`).
 * ⚠️ 아래 상수 셋(개수·크기·형식)은 서버와 **같아야** 한다 — `attachments.test.ts` 가 서버 소스와 대조한다.
 */
export interface ExhibitionAttachment {
  url: string;
  name: string;
  size: number | null;
}

/** 공고 하나에 붙일 수 있는 파일 수 */
export const ATTACHMENT_MAX = 10;
/** 한 파일 크기 상한 */
export const ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;
/** 받는 형식(확장자) */
export const ATTACHMENT_EXTS = ['pdf', 'hwp', 'hwpx', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'zip', 'jpg', 'jpeg', 'png'] as const;
export const ATTACHMENT_ACCEPT = ATTACHMENT_EXTS.map((e) => `.${e}`).join(',');
export const ATTACHMENT_TYPES_TEXT = 'PDF·한글·워드·엑셀·파워포인트·ZIP·JPG·PNG';

export function attachmentExt(name: string): string {
  return name.match(/\.([A-Za-z0-9]{1,8})$/)?.[1]?.toLowerCase() ?? '';
}

export type AttachmentKind = 'pdf' | 'hwp' | 'doc' | 'sheet' | 'slide' | 'zip' | 'image' | 'file';
export function attachmentKind(name: string): AttachmentKind {
  const ext = attachmentExt(name);
  if (ext === 'pdf') return 'pdf';
  if (ext === 'hwp' || ext === 'hwpx') return 'hwp';
  if (ext === 'doc' || ext === 'docx') return 'doc';
  if (ext === 'xls' || ext === 'xlsx') return 'sheet';
  if (ext === 'ppt' || ext === 'pptx') return 'slide';
  if (ext === 'zip') return 'zip';
  if (ext === 'jpg' || ext === 'jpeg' || ext === 'png') return 'image';
  return 'file';
}

const KIND_LABEL: Record<AttachmentKind, string> = {
  pdf: 'PDF', hwp: '한글', doc: '워드', sheet: '엑셀', slide: '파워포인트', zip: 'ZIP', image: '이미지', file: '파일',
};
export const attachmentTypeLabel = (name: string) => KIND_LABEL[attachmentKind(name)];

/** 120KB · 3.4MB — 모르면 빈 글자 */
export function formatFileSize(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)}MB`;
  return `${Math.max(1, Math.round(bytes / 1024))}KB`;
}

/** 올리기 전에 거를 이유 — 서버도 같은 규칙으로 막지만, 20MB 를 다 올린 뒤에 거절당하면 시간만 버린다 */
export function attachmentFileProblem(file: { name: string; size: number }): string | null {
  if (!(ATTACHMENT_EXTS as readonly string[]).includes(attachmentExt(file.name))) return `${file.name} — 첨부할 수 없는 형식이에요(${ATTACHMENT_TYPES_TEXT}).`;
  if (file.size > ATTACHMENT_MAX_BYTES) return `${file.name} — 20MB 를 넘어요.`;
  return null;
}

/** 서버·임시저장에서 온 값을 화면용으로 — 모양이 틀린 줄은 버린다 */
export function normalizeAttachments(raw: unknown): ExhibitionAttachment[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((a): a is { url: string; name?: unknown; size?: unknown } => !!a && typeof (a as any).url === 'string' && !!(a as any).url)
    .slice(0, ATTACHMENT_MAX)
    .map((a) => ({
      url: a.url,
      name: typeof a.name === 'string' && a.name.trim() ? a.name : '첨부파일',
      size: typeof a.size === 'number' && Number.isFinite(a.size) ? a.size : null,
    }));
}
