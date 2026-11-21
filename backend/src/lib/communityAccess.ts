import type { Prisma, PrismaClient } from '@prisma/client';
import { AppError } from '../middleware/errorHandler';

/**
 * 커뮤니티 탭 — 누가 쓰고, 익명이 되는가 (2026-11-13). 판정은 **여기 한 곳**이다(라우트·탭 목록의 canWrite 가 같이 쓴다).
 *
 * - `writePolicy`: 'all'(로그인한 누구나) · 'writers'(필진 + 관리자) · 'admin'(관리자만)
 * - 숨긴 탭(`active:false`)은 관리자만 쓴다(공개 전에 미리 채우는 용도)
 * - `allowAnonymous:false` 탭에 익명으로 보내면 **400** — 말없이 실명으로 바꾸면 익명인 줄 안 사람의 이름이 드러난다
 * - **'탭 없음'은 없다**(2026-11-21 사용자 결정) — 탭을 안 고른 글·지운 탭의 글은 **기본 탭(자유게시판, `isDefault`)** 으로 간다(`ensureDefaultTab`)
 * ⚠️ 탭 이름('공지'·'칼럼')으로 판정하지 말 것 — 이름을 바꾸는 순간 조용히 풀린다(규칙: 커뮤니티 탭).
 */
export const WRITE_POLICIES = ['all', 'writers', 'admin'] as const;
export type WritePolicy = (typeof WRITE_POLICIES)[number];
export const TAB_LAYOUTS = ['list', 'card'] as const;
export type TabLayout = (typeof TAB_LAYOUTS)[number];

export function asWritePolicy(v: unknown): WritePolicy {
  return typeof v === 'string' && (WRITE_POLICIES as readonly string[]).includes(v) ? (v as WritePolicy) : 'all';
}
export function asTabLayout(v: unknown): TabLayout {
  return v === 'card' ? 'card' : 'list';
}

export interface TabRule { id?: number; name: string; active: boolean; writePolicy: string; allowAnonymous: boolean }
export interface Writer { id: number; role: string }

/** 이 탭에 쓸 수 있나 — 못 쓰면 이유(화면에 그대로 보여 줄 말) */
export function writeBlockReason(tab: TabRule | null, user: Writer, isWriter: boolean): string | null {
  if (!tab) return null;   // 탭이 없는 옛 글(기본 탭이 생기기 전) — 막을 이유가 없다
  if (user.role === 'ADMIN') return null;
  if (!tab.active) return `‘${tab.name}’ 탭은 지금 숨겨져 있어 글을 쓸 수 없습니다.`;
  const policy = asWritePolicy(tab.writePolicy);
  if (policy === 'admin') return `‘${tab.name}’ 탭에는 관리자만 글을 쓸 수 있습니다.`;
  if (policy === 'writers' && !isWriter) return `‘${tab.name}’ 탭은 필진만 글을 쓸 수 있어요.`;
  return null;
}

/** 익명이 되나 — 공지는 늘 실명, 탭이 막으면 실명 */
export function anonymousAllowed(tab: TabRule | null, notice: boolean): boolean {
  if (notice) return false;
  return tab ? tab.allowAnonymous : true;
}

type Db = PrismaClient | Prisma.TransactionClient;

export async function isCommunityWriter(db: Db, userId: number | undefined | null): Promise<boolean> {
  if (!userId) return false;
  const row = await db.communityWriter.findUnique({ where: { userId }, select: { userId: true } });
  return !!row;
}

/** 기본 탭(자유게시판) 이름 — 처음 만들 때만 쓴다. 찾을 때는 이름이 아니라 `isDefault` 로(관리자가 이름을 바꿀 수 있다) */
export const DEFAULT_TAB_NAME = '자유게시판';
const TAB_SELECT = { id: true, name: true, slug: true, active: true, writePolicy: true, allowAnonymous: true } as const;

/**
 * 기본 탭(자유게시판)을 돌려준다 — 없으면 만든다(2026-11-21, '탭 없음'을 없앤 대신).
 * 마이그레이션이 실서버의 '자유게시판'을 기본으로 표시해 두지만, 테스트 DB·새 DB 처럼 탭이 하나도 없는 곳에서도 글이 갈 곳이 있어야 한다.
 * ⚠️ 확인하고 만들지 말 것(규칙 46) — 이름이 unique 라 동시에 만들면 한쪽이 P2002, 그러면 먼저 만든 것을 다시 읽는다.
 */
export async function ensureDefaultTab(db: Db) {
  const found = await db.postCategory.findFirst({ where: { isDefault: true }, orderBy: { id: 'asc' }, select: TAB_SELECT });
  if (found) return found;
  // 같은 이름의 탭이 이미 있으면 그걸 기본으로
  const named = await db.postCategory.findUnique({ where: { name: DEFAULT_TAB_NAME }, select: { id: true } });
  if (named) return db.postCategory.update({ where: { id: named.id }, data: { isDefault: true }, select: TAB_SELECT });
  const order = ((await db.postCategory.aggregate({ _max: { order: true } }))._max.order ?? 0) + 1;
  const slugTaken = await db.postCategory.findUnique({ where: { slug: 'free' }, select: { id: true } });
  try {
    return await db.postCategory.create({
      data: { name: DEFAULT_TAB_NAME, slug: slugTaken ? `free-${Date.now()}` : 'free', order, isDefault: true },
      select: TAB_SELECT,
    });
  } catch (e: any) {
    if (e?.code !== 'P2002') throw e;
    const again = await db.postCategory.findFirst({ where: { OR: [{ isDefault: true }, { name: DEFAULT_TAB_NAME }] }, orderBy: { id: 'asc' }, select: TAB_SELECT });
    if (!again) throw e;
    return again;
  }
}

/**
 * 글을 올릴 탭을 확인한다. **탭을 안 골랐거나 없는 탭 id 면 기본 탭(자유게시판)** — '탭 없음'은 없다(2026-11-21).
 * (화면이 옛 탭을 들고 있거나, 배포 사이 옛 화면이 categoryId 없이 보낼 수 있다)
 * 못 쓰는 탭이면 403(조용히 다른 탭으로 내리면 어디에 올렸는지 어긋난다 — 예전 규칙 그대로).
 */
export async function resolveWritableTab(db: Db, categoryId: unknown, user: Writer): Promise<TabRule & { id: number; slug: string }> {
  const picked = typeof categoryId === 'number'
    ? await db.postCategory.findUnique({ where: { id: categoryId }, select: TAB_SELECT })
    : null;
  const tab = picked ?? await ensureDefaultTab(db);
  const reason = writeBlockReason(tab, user, await isCommunityWriter(db, user.id));
  if (reason) throw new AppError(reason, 403);
  return tab;
}

/** 익명 요청을 탭 규칙에 맞춘다 — 막힌 탭에 익명이면 400 */
export function resolveAnonymous(tab: TabRule | null, notice: boolean, wantAnonymous: boolean): boolean {
  if (!wantAnonymous) return false;
  if (notice) return false;   // 공지는 익명일 수 없다(예전 규칙 — 조용히 실명. 공지는 관리자 자신의 글이다)
  if (!anonymousAllowed(tab, false)) throw new AppError(`‘${tab!.name}’ 탭은 익명으로 쓸 수 없어요. 익명을 끄고 다시 올려 주세요.`, 400);
  return true;
}

/**
 * 자동 저장 요청인가 — `index.ts` 가 전역 요청 한도에서 빼고 따로 센다(쓰는 동안 8초마다 저장해 전역 300 을 먹으면 그 사람의 모든 API 가 429).
 * `path` 는 `/api` 를 뗀 경로다(express 마운트 기준).
 */
export function isDraftSaveRequest(method: string, path: string): boolean {
  return method === 'PUT' && /^\/community\/drafts\/\d+$/.test(path);
}
