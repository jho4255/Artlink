/**
 * 출품 자료(`ExhibitionSubmission`)의 **모양** — 작가 저장(`PUT /operations/:id/me`)과 갤러리 대신 입력(`PUT /submissions/:userId`)이
 * 같은 규칙을 탄다(`operation.ts submissionDataFrom`).
 *
 * ## 왜 (2026-10-03 점검 P1-5)
 * 예전엔 `artworkList` 가 배열인지만 봤다. 수락된 작가 한 명이 `note.sections` 를 글자로, 작품 제목을 숫자로 보내면 200 으로 저장되고,
 * 그 뒤 **갤러리의 출품 자료 목록과 캡션(.hwp)이 500** 이 되어 그 공모의 운영 화면이 통째로 안 열렸다. 작품 `image` 에는
 * `javascript:` 문자열도 그대로 들어갔다. 정상 화면으로는 만들 수 없는 값이지만 참여 작가 누구나 직접 호출로 만들 수 있다.
 *
 * ## 두 겹
 *  1. 쓸 때 — `parseSubmissionBody` 로 거른다(틀리면 400). 모르는 키는 버린다.
 *  2. 읽을 때 — `readArtworkList`·`readCv`·`readNote` 가 틀린 모양을 **건너뛴다**. 이미 저장된 이상한 값이 있어도 500 이 아니게.
 *
 * ⚠️⚠️ **키 순서와 빠진 키를 바꾸지 말 것.** 화면(`OperationPage MySubmissionSection`)은 '저장 안 된 변경' 을 보낸 값과 받은 값의
 *    `JSON.stringify` 로 가린다. 서버가 키를 스키마 순서로 다시 세우거나 빈 칸을 채워 돌려주면, 저장 직후에도 늘 '저장 안 된 변경' 이 뜬다.
 *    그래서 기본값(`.default`)을 쓰지 않고, 들어온 객체의 키 순서대로 **아는 키만** 남긴다(`inOrder`·`pick`).
 * ⚠️ 키는 프론트 타입(`ArtworkItem`·`ArtistCv`·`ArtistNote`, `frontend/src/types/index.ts`)과 같아야 한다 — 빠뜨리면
 *    그 칸이 저장할 때마다 조용히 사라진다. `submission-schema.test.ts` 가 프론트 소스와 대조한다.
 * 실서버 출품 자료 81건(2026-09-13 복제본)은 전부 이 모양 안에 있다(작품 최대 18점 · 작가노트 최대 1만 자).
 */
import { z } from 'zod';
import { ownFileUrl } from './safeUrl';

export const SUBMISSION_LIMITS = {
  artworks: 100,
  field: 300,          // 작품명·재료 같은 한 줄 칸
  short: 40,           // 크기 한 변·연도·가격처럼 짧은 칸
  entries: 300,        // 약력 한 항목(개인전 등)의 줄 수
  entry: 1000,         // 약력 한 줄
  statement: 30000,    // 작가노트 전체
  sections: 200,       // 작품별 설명 수
  sectionBody: 20000,
} as const;

/** 프론트 타입과 같은 키 — 순서는 상관없다(들어온 순서를 따른다) */
export const ARTWORK_KEYS = ['image', 'title', 'size', 'width', 'height', 'medium', 'year', 'price', 'draft'] as const;
export const CV_TEXT_KEYS = ['nameKo', 'nameEn', 'birth', 'tel', 'email'] as const;
export const CV_LIST_KEYS = ['education', 'solo', 'group', 'artFair', 'award'] as const;
export const NOTE_KEYS = ['statement', 'sections'] as const;

const L = SUBMISSION_LIMITS;
const str = (max: number) => z.string().max(max, `글자가 너무 길어요(최대 ${max}자).`);

/** 작품 사진 — 우리 저장소 주소만, 비어 있어도 된다(사진을 나중에 올리는 작가가 있다) */
const imageField = z.string().max(2000).transform((v, ctx) => {
  if (v.trim() === '') return v;
  const own = ownFileUrl(v);
  if (!own) { ctx.addIssue({ code: 'custom', message: '작품 사진 주소가 올바르지 않습니다.' }); return z.NEVER; }
  return own;
});

const artworkItemSchema = z.object({
  image: imageField.optional(),
  title: str(L.field).optional(),
  size: str(L.short * 2).optional(),
  width: str(L.short).optional(),
  height: str(L.short).optional(),
  medium: str(L.field).optional(),
  year: str(L.short).optional(),
  price: str(L.short).optional(),
  draft: z.boolean().optional(),
});

const cvEntrySchema = z.object({ year: str(L.short).optional(), content: str(L.entry).optional() });
const cvEntries = z.array(cvEntrySchema).max(L.entries, `약력 한 항목에는 ${L.entries}줄까지 넣을 수 있어요.`).optional();

const cvSchema = z.object({
  nameKo: str(L.field).optional(),
  nameEn: str(L.field).optional(),
  birth: str(L.field).optional(),
  tel: str(L.short).optional(),
  email: str(L.field).optional(),
  education: cvEntries,
  solo: cvEntries,
  group: cvEntries,
  artFair: cvEntries,
  award: cvEntries,
});

const noteSchema = z.object({
  statement: str(L.statement).optional(),
  sections: z.array(z.object({ title: str(L.field).optional(), body: str(L.sectionBody).optional() }))
    .max(L.sections, `작품별 설명은 ${L.sections}개까지 쓸 수 있어요.`).optional(),
});

const submissionBodySchema = z.object({
  artworkList: z.array(artworkItemSchema).max(L.artworks, `출품작은 ${L.artworks}점까지 넣을 수 있어요.`).nullish(),
  cv: cvSchema.nullish(),
  note: noteSchema.nullish(),
  representativeIndex: z.number().int().nullish(),
});

export interface SubmissionBody {
  artworkList?: Record<string, unknown>[] | null;
  cv?: Record<string, unknown> | null;
  note?: Record<string, unknown> | null;
  representativeIndex?: number | null;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** zod 가 걸러 낸 값(`parsed`)을 **원래 객체의 키 순서**로 다시 세운다 — 걸러진(모르는) 키는 빠진다 */
function inOrder(orig: unknown, parsed: unknown): unknown {
  if (Array.isArray(parsed)) return parsed.map((p, i) => inOrder(Array.isArray(orig) ? orig[i] : undefined, p));
  if (isObj(parsed) && isObj(orig)) {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(orig)) if (parsed[k] !== undefined) out[k] = inOrder(orig[k], parsed[k]);
    return out;
  }
  return parsed;
}

/** 쓸 때 — 첫 문제를 사람이 읽을 문장으로. 통과하면 정리된 값(모르는 키 제거, 키 순서 유지) */
export function parseSubmissionBody(body: unknown): { ok: true; data: SubmissionBody } | { ok: false; error: string } {
  const r = submissionBodySchema.safeParse(body ?? {});
  if (r.success) return { ok: true, data: inOrder(body, r.data) as SubmissionBody };
  const issue = r.error.issues[0];
  const head = issue?.path?.[0];
  const where = head === 'artworkList' ? '출품 목록' : head === 'cv' ? '약력' : head === 'note' ? '작가노트' : '출품 자료';
  // zod 기본 문구(Invalid input: expected …)는 사람이 못 읽는다 — 우리가 쓴 문구(한글)만 그대로 보여 준다
  const msg = issue && /[가-힣]/.test(issue.message) ? issue.message : '형식이 올바르지 않습니다.';
  return { ok: false, error: `${where}: ${msg}` };
}

/* ─────────────────────────────────────────────────────────────
   읽을 때 — 틀린 모양은 건너뛴다(옛 자료·직접 호출로 들어간 값). 절대 던지지 않는다.
   저장된 키 순서를 그대로 두고, 빠진 키를 채우지 않는다(위 ⚠️⚠️ 와 같은 이유).
   ───────────────────────────────────────────────────────────── */

const asStr = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : '');

/** `src` 의 키 순서대로, `known` 에 있는 키만 `conv` 로 바꿔 담는다 */
function pick(src: Record<string, unknown>, known: readonly string[], conv: (k: string, v: unknown) => unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(src)) {
    if (!known.includes(k)) continue;
    const v = conv(k, src[k]);
    if (v !== undefined) out[k] = v;
  }
  return out;
}

const readEntries = (v: unknown) => (Array.isArray(v) ? v.filter(isObj).map((e) => pick(e, ['year', 'content'], (_k, x) => asStr(x))) : []);

export type ArtworkRead = Partial<Record<'image' | 'title' | 'size' | 'width' | 'height' | 'medium' | 'year' | 'price', string>> & { draft?: boolean };

export function readArtworkList(v: unknown): ArtworkRead[] {
  if (!Array.isArray(v)) return [];
  return v.filter(isObj).map((a) => pick(a, ARTWORK_KEYS, (k, x) => (k === 'draft' ? (typeof x === 'boolean' ? x : undefined) : asStr(x))) as ArtworkRead);
}

export function readCv(v: unknown): Record<string, unknown> | null {
  if (!isObj(v)) return null;
  return pick(v, [...CV_TEXT_KEYS, ...CV_LIST_KEYS], (k, x) => ((CV_LIST_KEYS as readonly string[]).includes(k) ? readEntries(x) : asStr(x)));
}

export function readNote(v: unknown): { statement?: string; sections?: { title?: string; body?: string }[] } | null {
  if (!isObj(v)) return null;
  return pick(v, NOTE_KEYS, (k, x) => (k === 'sections'
    ? (Array.isArray(x) ? x.filter(isObj).map((s) => pick(s, ['title', 'body'], (_k, y) => asStr(y))) : [])
    : asStr(x))) as { statement?: string; sections?: { title?: string; body?: string }[] };
}
