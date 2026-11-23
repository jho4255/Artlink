import { randomUUID } from 'crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { AppError } from '../middleware/errorHandler';
import { LOCK_NS, withKeyLock } from './keyLock';

/**
 * 비회원 작가 (2026-11-23, CLAUDE.md 규칙 91) — 아트링크에 가입하지 않은 작가를 공모 운영자가 직접 넣는다.
 *
 * 작가 한 명 = **로그인할 수 없는 계정** 하나(`role='GUEST'` · 비밀번호·카카오 없음 · 주소는 받을 수 없는 `.invalid`)
 * + 그 공모와의 연결(`ExhibitionGuestArtist`). 출품 자료·판매·정산 비율·정산 확인이 전부 회원 번호에 묶여 있어서
 * 그 길을 그대로 쓰려고 계정을 만든다. **지원(Application)이 아니다** — 그래서 지원자 목록·정원·단톡방·갤러리 [작가] 탭·
 * 공고의 지원 수에는 저절로 안 들어간다(사용자 결정: 정원에 안 센다 · 작가 탭에 안 나온다 · 사용자 관리에 안 넣는다).
 *
 * 참여 작가가 필요한 곳 — 출품 자료 목록·대신 입력·캡션·도록·판매·정산 — 은 `participantsOf` 로 수락된 회원과 합친다.
 * ⚠️ 정산 **확인 요청·완료 조건·알림**은 회원만이다(비회원은 받을 수 없다 — 3일 무응답 자동 확인도 안내를 못 받은 사람에겐 걸지 않는다, 규칙 26).
 * ⚠️ 사용자를 늘어놓는 곳(관리자 사용자 관리·통계·멘션·이웃·대화·홈페이지)은 `NOT_GUEST` 로 뺀다. 새 목록을 만들면 여기를 볼 것.
 * 나중에 그 사람이 가입해도 이어 주지 않는다(사용자 결정 — 다른 사람으로 본다).
 */

type Db = PrismaClient | Prisma.TransactionClient;

export const GUEST_ROLE = 'GUEST';
export const GUEST_PROVIDER = 'GUEST';
/** 이름 글자 수 — 출품 자료 약력의 이름 칸과 같은 쓰임 */
export const GUEST_NAME_MAX = 40;
/** 공모 하나에 넣을 수 있는 비회원 작가 수 — 봇·실수로 수천 명이 들어오지 않게 */
export const GUEST_LIMIT = 200;

/** 사용자 목록에서 비회원 계정을 뺀다 — `where: { ...NOT_GUEST, … }` */
export const NOT_GUEST = { role: { not: GUEST_ROLE } } as const;

/** 받을 수 없는 주소(RFC 2606 `.invalid`) — User.email 이 필수·unique 라 자리만 채운다. 화면·응답에는 내보내지 않는다(`maskGuestEmail`) */
export function guestEmail(): string {
  return `guest-${randomUUID()}@guest.artlink.invalid`;
}

export function isGuestRole(role: string | null | undefined): boolean {
  return role === GUEST_ROLE;
}

/** 이름 — 앞뒤 공백을 떼고 가운데 공백은 하나로. 비었거나 너무 길면 400 */
export function cleanGuestName(raw: unknown): string {
  const name = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
  if (!name) throw new AppError('작가 이름을 적어 주세요.', 400);
  if ([...name].length > GUEST_NAME_MAX) throw new AppError(`작가 이름은 ${GUEST_NAME_MAX}자까지 적을 수 있어요.`, 400);
  return name;
}

/** 응답의 사용자 — 비회원이면 가짜 주소를 지우고 `guest: true` 를 단다 */
export function maskGuestUser<T extends { email?: string | null }>(user: T, guest: boolean): T & { guest?: true } {
  return guest ? { ...user, email: null, guest: true } : user;
}

/** 이 공모의 비회원 작가 번호들(추가한 순) */
export async function guestIdsOf(db: Db, exhibitionId: number): Promise<number[]> {
  const rows = await db.exhibitionGuestArtist.findMany({
    where: { exhibitionId },
    select: { userId: true },
    orderBy: { id: 'asc' },
  });
  return rows.map((r) => r.userId);
}

/** 이 공모의 비회원 작가인가 */
export async function isGuestOf(db: Db, exhibitionId: number, userId: number): Promise<boolean> {
  const row = await db.exhibitionGuestArtist.findUnique({ where: { userId }, select: { exhibitionId: true } });
  return row?.exhibitionId === exhibitionId;
}

/**
 * 참여 작가 — 수락된 회원(지원 순) 다음에 비회원(추가한 순). 출품 자료 목록·캡션·정산 표가 같은 순서를 쓴다.
 * `members` 는 회원만(정산 확인 요청·완료 조건), `all` 은 함께(출품 자료·판매).
 */
export async function participantsOf(db: Db, exhibitionId: number): Promise<{ all: number[]; members: number[]; guests: number[] }> {
  const [accepted, guests] = await Promise.all([
    db.application.findMany({ where: { exhibitionId, status: 'ACCEPTED' }, select: { userId: true }, orderBy: { createdAt: 'asc' } }),
    guestIdsOf(db, exhibitionId),
  ]);
  const members = accepted.map((a) => a.userId);
  return { all: [...members, ...guests], members, guests };
}

/**
 * 참여 작가와 그 사용자 정보 — `{ user, guest }` 를 참여 순으로. 비회원의 가짜 주소는 지운다.
 * select 에 id 는 꼭 넣을 것(행을 맞춘다).
 */
export async function participantUsersOf<S extends Prisma.UserSelect & { id: true }>(
  db: Db, exhibitionId: number, select: S,
): Promise<{ userId: number; guest: boolean; user: any }[]> {
  const ids = await participantsOf(db, exhibitionId);
  if (ids.all.length === 0) return [];
  const users = await db.user.findMany({ where: { id: { in: ids.all } }, select });
  const byId = new Map(users.map((u: any) => [u.id as number, u]));
  const guestSet = new Set(ids.guests);
  return ids.all
    .filter((id) => byId.has(id))
    .map((id) => ({ userId: id, guest: guestSet.has(id), user: maskGuestUser(byId.get(id), guestSet.has(id)) }));
}

/**
 * 비회원 작가를 만든다 — 계정 + 연결 한 줄. 공모마다 `GUEST_LIMIT` 명까지(세고 만들기를 줄 세운다, 규칙 46).
 */
export async function createGuestArtist(exhibitionId: number, rawName: unknown, createdById: number) {
  const name = cleanGuestName(rawName);
  return withKeyLock(LOCK_NS.guestArtists, exhibitionId, async (tx) => {
    const count = await tx.exhibitionGuestArtist.count({ where: { exhibitionId } });
    if (count >= GUEST_LIMIT) throw new AppError(`비회원 작가는 공모 하나에 ${GUEST_LIMIT}명까지 넣을 수 있어요.`, 400);
    const user = await tx.user.create({
      data: { email: guestEmail(), name, role: GUEST_ROLE, provider: GUEST_PROVIDER },
      select: { id: true, name: true, nickname: true, avatar: true, handle: true },
    });
    await tx.exhibitionGuestArtist.create({ data: { exhibitionId, userId: user.id, createdById } });
    return { ...user, email: null, guest: true as const };
  });
}

/**
 * 비회원 작가 계정을 지운다 — 판매·정산 비율·정산 확인은 계정을 RESTRICT 로 잡고 있어 먼저 지운다
 * (출품 자료·연결 행은 계정을 따라 CASCADE). 판매가 있으면 지우지 않는 판단은 부르는 쪽이 한다.
 */
export async function deleteGuestUsers(db: Db, userIds: number[]): Promise<void> {
  if (userIds.length === 0) return;
  // 혹시라도 회원 계정이 섞이지 않게 — 비회원 계정만 지운다
  const guests = await db.user.findMany({ where: { id: { in: userIds }, role: GUEST_ROLE }, select: { id: true } });
  const ids = guests.map((g) => g.id);
  if (ids.length === 0) return;
  await db.artworkSale.deleteMany({ where: { artistUserId: { in: ids } } });
  await db.artistSettlement.deleteMany({ where: { artistUserId: { in: ids } } });
  await db.settlementApproval.deleteMany({ where: { artistUserId: { in: ids } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
}

/** 공모들의 비회원 작가 계정 번호 — 공모를 지우기 전에 모아 둔다(연결 행은 공모를 따라 지워진다) */
export async function guestIdsOfExhibitions(db: Db, exhibitionIds: number[]): Promise<number[]> {
  if (exhibitionIds.length === 0) return [];
  const rows = await db.exhibitionGuestArtist.findMany({ where: { exhibitionId: { in: exhibitionIds } }, select: { userId: true } });
  return rows.map((r) => r.userId);
}
