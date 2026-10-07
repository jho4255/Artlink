import path from 'path';
import { AppError } from '../middleware/errorHandler';
import { ownFileUrl } from './safeUrl';

/**
 * 공모 첨부파일 (2026-10-08 사용자 결정) — 갤러리·관리자가 공고를 올릴 때 모집 요강·지원서 양식 같은 파일을 붙인다.
 * **누구나**(비회원 포함) 공고 상세에서 내려받는다. 승인 뒤에도 공모 소개처럼 운영자(갤러리·관리자)가 상세 화면에서 바로 고친다.
 *
 * 저장은 `Exhibition.attachments` (JSON `[{ url, name, size }]`). 쓰는 곳은 셋 — 갤러리 등록 `POST /exhibitions`,
 * 아트링크 주최 등록 `POST /exhibitions/hosted`, 고치기 `PATCH /exhibitions/:id/attachments`. 셋 다 `parseAttachments` 를 지난다.
 *
 * ⚠️ 주소는 **우리 저장소만**(`ownFileUrl`) — 외부 주소를 받으면 공고 상세가 남의 파일(악성 파일 포함)을 우리 이름으로 내려준다.
 * ⚠️ 빼거나 공고를 지워도 **파일은 지우지 않는다** — 주소만 알면 다른 공고(심지어 남의 것)에 같은 주소를 넣을 수 있어서,
 *    지우면 그쪽 첨부가 깨지거나 남의 파일을 지우는 길이 된다. 첨부는 몇 MB 라 남겨도 비용이 거의 없다.
 * ⚠️ 썸네일 백필 목록(scripts/backfill-thumbs.ts SOURCES)에 넣지 말 것 — 문서는 썸네일을 만들 수 없다(규칙 21b).
 */
export interface ExhibitionAttachment {
  url: string;
  name: string;
  size: number | null;
}

/** 공고 하나에 붙일 수 있는 파일 수 — 프론트 `lib/attachments.ts ATTACHMENT_MAX` 와 같아야 한다 */
export const ATTACHMENT_MAX = 10;
/** 화면에 보일 파일 이름 길이 */
export const ATTACHMENT_NAME_MAX = 120;

/**
 * 화면·내려받기에 쓸 파일 이름. 경로 구분자·제어 문자를 빼고 길면 확장자를 살려 자른다.
 * ⚠️ NFC 로 맞출 것 — 맥에서 올린 한글 파일 이름은 자모가 풀린(NFD) 채로 와서, 그대로 두면 'ㅁㅗㅈㅣㅂ' 처럼 보이는 곳이 있다.
 */
export function cleanAttachmentName(raw: unknown): string {
  let n = String(raw ?? '')
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  if (n.length > ATTACHMENT_NAME_MAX) {
    const ext = n.match(/\.[A-Za-z0-9]{1,8}$/)?.[0] ?? '';
    n = n.slice(0, ATTACHMENT_NAME_MAX - ext.length).trimEnd() + ext;
  }
  return n;
}

/** 이름이 비었을 때 — 주소의 파일 이름(확장자)이라도 */
function fallbackName(url: string): string {
  const base = path.posix.basename(url.split('?')[0] ?? '');
  const ext = path.posix.extname(base);
  return ext ? `첨부파일${ext}` : '첨부파일';
}

function toAttachment(a: any): ExhibitionAttachment | null {
  const url = ownFileUrl(a?.url);
  if (!url) return null;
  const name = cleanAttachmentName(a?.name) || fallbackName(url);
  const sizeNum = Number(a?.size);
  const size = Number.isFinite(sizeNum) && sizeNum >= 0 ? Math.round(sizeNum) : null;
  return { url, name, size };
}

/** 저장할 때 — 형식이 틀리거나 우리 저장소 주소가 아니면 400. 같은 주소가 두 번이면 한 번만 */
export function parseAttachments(raw: unknown): ExhibitionAttachment[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw new AppError('첨부파일 형식이 올바르지 않습니다.', 400);
  if (raw.length > ATTACHMENT_MAX) throw new AppError(`첨부파일은 ${ATTACHMENT_MAX}개까지 붙일 수 있어요.`, 400);
  const out: ExhibitionAttachment[] = [];
  for (const item of raw) {
    const a = toAttachment(item);
    if (!a) throw new AppError('첨부파일 주소가 올바르지 않습니다. 파일을 다시 올려 주세요.', 400);
    if (!out.some((x) => x.url === a.url)) out.push(a);
  }
  return out;
}

/** 읽을 때 — 이상한 줄은 건너뛰고 **던지지 않는다**(한 줄 때문에 공고 상세가 500 이 되면 안 된다) */
export function readAttachments(raw: unknown): ExhibitionAttachment[] {
  if (!Array.isArray(raw)) return [];
  const out: ExhibitionAttachment[] = [];
  for (const item of raw.slice(0, ATTACHMENT_MAX)) {
    const a = toAttachment(item);
    if (a && !out.some((x) => x.url === a.url)) out.push(a);
  }
  return out;
}

/**
 * R2 에 함께 적을 Content-Disposition — 내려받을 때 원래 이름으로 저장되게.
 * 화면의 `<a download="이름">` 은 **다른 출처(R2)** 주소에서 브라우저가 무시하므로, 이게 없으면 '1696…-123.hwp' 로 받아진다.
 * 헤더는 ASCII 만 되므로 `filename`(ASCII 대체) + `filename*`(UTF-8 퍼센트 인코딩, RFC 6266/5987)을 함께 쓴다.
 */
export function attachmentDisposition(name: string): string {
  const clean = cleanAttachmentName(name) || '첨부파일';
  const ascii = clean.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_') || 'attachment';
  const encoded = encodeURIComponent(clean).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
