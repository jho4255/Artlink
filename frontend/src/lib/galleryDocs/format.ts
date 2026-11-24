/**
 * 갤러리 결과물의 표기 규칙 (2026-11-24, 규칙 92) — 작품 리스트·출품 자료·정산서·지원서·작품 원본 파일 이름이 같이 쓴다.
 *
 * ⚠️ **문서에 찍을 때만** 다듬는다 — 저장된 값은 건드리지 않는다(작가가 쓴 글자를 고쳐 저장하지 말 것, 멘션 규칙과 같은 이유).
 *    한글 캡션(.hwp)은 사용자 결정으로 예전 그대로라 이 규칙을 쓰지 않는다.
 */
import { displayName, formatArtworkPrice } from '@/lib/utils';
import type { ArtistCv } from '@/types';

// ── 재료 ────────────────────────────────────────────────────────────────
/**
 * 영어 재료 표기의 대소문자를 맞출 낱말 — **이 목록에 있는 낱말만** 고친다.
 * 'Acrylic on Canvas' · 'acrylic on canvas' · 'Acrylic on canvas ' 가 한 표에 섞여 있었다(실서버 647점 중 재료 표기 90가지).
 * 목록 밖 낱말(고유명사 — Arches, Korean, Hanji …)은 쓴 그대로 둔다.
 */
const MATERIAL_WORDS = new Set([
  'acrylic', 'acrylics', 'oil', 'oils', 'canvas', 'linen', 'paper', 'panel', 'panels', 'board', 'wood', 'wooden', 'plywood',
  'cotton', 'fabric', 'silk', 'ink', 'inks', 'gouache', 'watercolor', 'watercolour', 'pencil', 'pencils', 'colored', 'coloured',
  'charcoal', 'pastel', 'pastels', 'crayon', 'marker', 'pen', 'graphite', 'tempera', 'gesso', 'resin', 'pigment', 'pigments',
  'mixed', 'media', 'medium', 'on', 'and', 'with', 'of', 'unbleached', 'paint', 'spray', 'collage', 'thread', 'clay',
  'ceramic', 'ceramics', 'bronze', 'glass', 'metal', 'steel', 'stone', 'marble', 'print', 'digital', 'photograph',
  'leaf', 'gold', 'silver', 'foil', 'embroidery', 'natural', 'dye', 'dyes', 'aluminum', 'aluminium', 'enamel', 'jute',
]);

/** 'acrylic on Canvas ' → 'Acrylic on canvas' (목록 낱말만, 첫 낱말은 대문자로 시작) */
export function mediumText(s: unknown): string {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  if (!/[A-Za-z]/.test(t)) return t;
  let first = true;
  return t.replace(/[A-Za-z]+/g, (w) => {
    const lower = w.toLowerCase();
    const isFirst = first;
    first = false;
    if (!MATERIAL_WORDS.has(lower)) return w;
    return isFirst ? lower[0]!.toUpperCase() + lower.slice(1) : lower;
  });
}

// ── 크기 ────────────────────────────────────────────────────────────────
/** '24.2x24.2cm' → '24.2 × 24.2 cm' — 곱하기 기호와 단위 앞 띄어쓰기만 맞춘다(단위를 지어 붙이지 않는다) */
export function sizeText(s: unknown): string {
  return String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/(\d)\s*[x×X*]\s*(?=\d)/g, '$1 × ')
    .replace(/(\d)\s*(cm|mm|in)\b/g, '$1 $2');
}

// ── 가격 ────────────────────────────────────────────────────────────────
/** 숫자로 읽히는 가격(원) — '1,200,000' · '₩320,000' · '120만원' · '1200000원'. 아니면 null('비매'·'협의') */
export function priceAmount(s: unknown): number | null {
  const t = String(s ?? '').replace(/\s+/g, '').replace(/^₩/, '').replace(/원$/, '');
  if (!t) return null;
  const man = /^([0-9][0-9,]*(?:\.[0-9]+)?)만$/.exec(t);
  if (man) {
    const n = Number(man[1]!.replace(/,/g, '')) * 10000;
    return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
  }
  if (!/^[0-9][0-9,]*$/.test(t)) return null;
  const n = Number(t.replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** 비매 — '비매' · '비매품' · 'NFS' · 'not for sale' */
export function isNotForSale(s: unknown): boolean {
  return /비매|^\s*nfs\s*$|not\s*for\s*sale/i.test(String(s ?? ''));
}

/** 문서에 찍는 가격 — 숫자면 '1,200,000원', 아니면 쓴 그대로 */
export function priceText(s: unknown): string {
  const n = priceAmount(s);
  if (n != null) return `${n.toLocaleString('ko-KR')}원`;
  return formatArtworkPrice(String(s ?? ''));
}

export const won = (n: number) => `${Math.round(n || 0).toLocaleString('ko-KR')}원`;
/** 원 없이 숫자만(표 안) */
export const num = (n: number) => Math.round(n || 0).toLocaleString('ko-KR');

// ── 날짜 (KST 달력, 규칙 14) ────────────────────────────────────────────
function kstParts(v: string | Date | null | undefined): [number, number, number] | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  const k = new Date(d.getTime() + 9 * 3600_000);
  return [k.getUTCFullYear(), k.getUTCMonth() + 1, k.getUTCDate()];
}
/** '2027. 3. 20.' */
export function kstDate(v: string | Date | null | undefined): string {
  const p = kstParts(v);
  return p ? `${p[0]}. ${p[1]}. ${p[2]}.` : '';
}
/** '3. 20.' — 같은 해 안에서 쓰는 짧은 날짜 */
export function kstShortDate(v: string | Date | null | undefined): string {
  const p = kstParts(v);
  return p ? `${p[1]}. ${p[2]}.` : '';
}
/** '2027. 3. 20 – 4. 6' (같은 해면 뒤 연도 생략) */
export function kstPeriod(start?: string | null, end?: string | null): string {
  const a = kstParts(start);
  const b = kstParts(end);
  if (!a && !b) return '';
  if (!a || !b) { const x = (a ?? b)!; return `${x[0]}. ${x[1]}. ${x[2]}`; }
  if (a.join() === b.join()) return `${a[0]}. ${a[1]}. ${a[2]}`;
  return a[0] === b[0] ? `${a[0]}. ${a[1]}. ${a[2]} – ${b[1]}. ${b[2]}` : `${a[0]}. ${a[1]}. ${a[2]} – ${b[0]}. ${b[1]}. ${b[2]}`;
}

// ── 이름 ────────────────────────────────────────────────────────────────
/** 문서에 찍는 작가 이름 — 출품 자료의 약력에 적은 이름이 먼저, 없으면 화면에 보이던 이름(도록과 같은 규칙) */
export function docArtistName(user: { name?: string | null; nickname?: string | null } | null | undefined, cv?: Pick<ArtistCv, 'nameKo'> | null): string {
  return (cv?.nameKo ?? '').trim() || displayName(user) || '작가';
}

// ── 작품 번호 ───────────────────────────────────────────────────────────
/**
 * 전시 전체에 이어지는 작품 번호 — 작품 리스트·출품 자료·작품 원본 파일 이름이 **같은 번호**를 쓴다.
 * 순서는 화면의 참여 작가 순서(수락한 작가 → 비회원 작가, 규칙 91) 그대로, 작가 안에서는 출품 목록 순서.
 * (작품 캡션 .hwp 는 사용자 결정으로 예전 양식 그대로라 번호가 없다)
 */
export function numberWorks(rows: { user: { id: number }; submission: { artworkList?: unknown[] | null } }[]): {
  total: number;
  numberOf: (userId: number, index: number) => number;
} {
  const map = new Map<string, number>();
  let n = 0;
  for (const r of rows) {
    (r.submission.artworkList ?? []).forEach((_, i) => { n += 1; map.set(`${r.user.id}:${i}`, n); });
  }
  return { total: n, numberOf: (userId, index) => map.get(`${userId}:${index}`) ?? 0 };
}

/** 파일 이름 앞 번호 — 정렬이 맞게 자릿수를 채운다(90점이면 '09', 120점이면 '009') */
export function padNo(no: number, total: number): string {
  return String(no).padStart(Math.max(2, String(total).length), '0');
}
