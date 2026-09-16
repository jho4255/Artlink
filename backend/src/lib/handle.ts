/**
 * 홈페이지 주소 `/@handle` 의 규칙 — **여기 한 곳**에서만 정한다 (2026-09-16).
 *
 * ⚠️ **작가(`User.handle`)와 갤러리(`Gallery.handle`)가 이름 공간을 공유한다.** `/@x` 주소 하나로 둘 다
 *    가리키므로 양쪽에 같은 값이 있으면 `/@x` 가 누구인지 정해지지 않는다. 중복 검사는 반드시
 *    `handleTaken()`(양쪽을 함께 본다)으로 할 것 — 한쪽 테이블만 보면 조용히 충돌한다.
 *
 * - 소문자 영문·숫자·`.`·`_` 만, 3~30자, 점으로 시작·끝 금지, 점 연속 금지.
 *   **인스타그램 아이디 규칙과 같다** — 작가 97% 가 인스타 주소를 등록해 뒀으므로 그걸 그대로 가져와
 *   자동 제안한다(사용자 결정). 인스타에서 유효한 아이디는 여기서도 유효해야 제안이 실패하지 않는다.
 * - 예약어: 라우트·역할 이름과 겹치면 `/@admin` 같은 주소가 생긴다. 막는다.
 * - 대소문자는 구분하지 않는다(저장은 소문자). `@` 를 붙여 보내도 뗀다.
 *
 * ⚠️ 프론트(`lib/handle.ts`)에 같은 정규식이 있다. 규칙을 바꾸면 **둘 다** 바꿀 것 —
 *    화면이 통과시키고 서버가 막으면 함정이고, 반대면 규칙이 조용히 무너진다.
 */
import { prisma } from './prisma';

export const HANDLE_MIN = 3;
export const HANDLE_MAX = 30;
const HANDLE_RE = /^[a-z0-9._]+$/;

export const RESERVED_HANDLES = new Set([
  'admin', 'artlink', 'artist', 'artists', 'gallery', 'galleries', 'exhibition', 'exhibitions', 'show', 'shows',
  'login', 'logout', 'signup', 'register', 'auth', 'mypage', 'api', 'uploads', 'explore', 'portfolio',
  'community', 'feed', 'messages', 'support', 'benefits', 'me', 'help', 'about', 'terms', 'privacy',
  'null', 'undefined', 'www', 'static', 'assets', 'artlook', 'artstory', 'arttalk',
]);

/** 입력값 정리 — 앞뒤 공백·`@`·대문자를 정리한 문자열. 유효성은 `validateHandle` 이 본다 */
export function normalizeHandle(raw: unknown): string {
  return String(raw ?? '').trim().replace(/^@+/, '').toLowerCase();
}

/** 유효하면 null, 아니면 사람이 읽을 이유 */
export function validateHandle(handle: string): string | null {
  if (handle.length < HANDLE_MIN || handle.length > HANDLE_MAX) return `주소는 ${HANDLE_MIN}~${HANDLE_MAX}자여야 합니다.`;
  if (!HANDLE_RE.test(handle)) return '영문 소문자·숫자·마침표·밑줄만 쓸 수 있습니다.';
  if (handle.startsWith('.') || handle.endsWith('.') || handle.includes('..')) return '마침표는 처음·끝에 오거나 연달아 올 수 없습니다.';
  if (RESERVED_HANDLES.has(handle)) return '쓸 수 없는 주소입니다.';
  return null;
}

/** 인스타그램 주소(또는 아이디)에서 아이디만 — 프론트 `instagramHandle()` 과 같은 규칙 */
export function instagramId(url: string | null | undefined): string | null {
  const t = String(url ?? '').trim();
  if (!t) return null;
  const m = t.match(/instagram\.com\/+([^/?#]+)/i);
  const raw = (m ? m[1]! : t).replace(/^@/, '').replace(/\/+$/, '').trim();
  return raw || null;
}

/** 인스타 아이디에서 쓸 수 있는 핸들 제안. 규칙에 안 맞으면 null(억지로 고치지 않는다 — 다른 사람 아이디가 될 수 있다) */
export function suggestHandle(instagramUrl: string | null | undefined): string | null {
  const id = instagramId(instagramUrl);
  if (!id) return null;
  const h = normalizeHandle(id);
  return validateHandle(h) ? null : h;
}

/**
 * 그 핸들을 **누군가 이미 쓰고 있는가** — 작가와 갤러리를 함께 본다.
 * `except` 로 자기 자신은 뺀다(같은 값을 다시 저장해도 409 가 나지 않게).
 */
export async function handleTaken(
  handle: string,
  except?: { userId?: number; galleryId?: number },
): Promise<boolean> {
  const [user, gallery] = await Promise.all([
    prisma.user.findUnique({ where: { handle }, select: { id: true } }),
    prisma.gallery.findUnique({ where: { handle }, select: { id: true } }),
  ]);
  if (user && user.id !== except?.userId) return true;
  if (gallery && gallery.id !== except?.galleryId) return true;
  return false;
}

export type HandleOwner = { kind: 'artist'; id: number } | { kind: 'gallery'; id: number };

/**
 * `/@handle` 이 누구인가 — 작가 먼저, 없으면 갤러리. 규칙에 안 맞으면 조회조차 하지 않는다.
 * 화면(`HandleRoute`)과 서버 SEO 가 **같은 함수**를 거쳐야 둘이 다른 페이지를 가리키지 않는다.
 */
export async function resolveHandle(raw: string): Promise<HandleOwner | null> {
  const handle = normalizeHandle(raw);
  if (validateHandle(handle)) return null;
  const user = await prisma.user.findFirst({
    where: { handle, deletedAt: null, role: 'ARTIST' },
    select: { id: true },
  });
  if (user) return { kind: 'artist', id: user.id };
  const gallery = await prisma.gallery.findFirst({
    where: { handle, status: 'APPROVED' },
    select: { id: true },
  });
  return gallery ? { kind: 'gallery', id: gallery.id } : null;
}

/**
 * 핸들이 없는 작가에게 인스타 아이디로 **한 번** 만들어 준다(lazy). 공개 페이지가 열릴 때 부른다.
 * - 이미 있으면 그대로. 인스타가 없거나 규칙에 안 맞거나 **누가 먼저 쓰고 있으면** 만들지 않는다(null).
 * - 동시에 두 요청이 같은 핸들을 잡으려 하면 unique 위반이 나는데, 그건 "만들지 않음"과 같다 — 삼킨다.
 * ⚠️ 갤러리는 자동 생성하지 않는다 — 상호가 한글이라 로마자로 옮기면 엉뚱한 주소가 된다. 주인이 직접 정한다.
 */
export async function ensureHandle(user: { id: number; handle: string | null; instagramUrl: string | null }): Promise<string | null> {
  if (user.handle) return user.handle;
  const suggestion = suggestHandle(user.instagramUrl);
  if (!suggestion) return null;
  if (await handleTaken(suggestion, { userId: user.id })) return null;
  try {
    await prisma.user.update({ where: { id: user.id }, data: { handle: suggestion } });
    return suggestion;
  } catch {
    return null;
  }
}

/** 공개 라우트 파라미터가 `@handle` 꼴인가 (`/portfolio/@kiiryang`) */
export const isHandleParam = (param: string): boolean => param.startsWith('@');
