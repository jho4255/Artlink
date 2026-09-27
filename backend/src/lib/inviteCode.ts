import { randomInt } from 'crypto';
import type { Prisma, PrismaClient } from '@prisma/client';

/**
 * 공모 초대 코드 (2026-09-27) — 이미 선정이 끝난 공모를 ArtLink 로 옮겨 올 때 쓴다.
 *
 * 코드는 `ExhibitionJoinCode` 테이블에 둔다(공모당 하나, 행이 없으면 끔) — Exhibition 컬럼이면 공개 응답에 실린다.
 *
 * 갤러리가 공모마다 코드 하나를 만들어 선정 작가들 단톡방에 돌리면, 코드를 넣은 작가는
 * **지원서 없이 곧바로 수락(ACCEPTED)** 되어 자료제출 → 전시 → 정산을 그대로 밟는다.
 * 코드 = 수락 권한이므로 규칙을 여기 한 곳에 둔다(프론트 `lib/inviteCode.ts` 는 같은 규칙의 거울 — 바꾸면 둘 다).
 *
 * - 8자리, 헷갈리는 글자(0·O·1·I·L)를 뺀 31자. 31^8 ≈ 8.5×10^11 이라 전역 rate limit 아래에서 추측은 불가능하다.
 * - 입력은 대소문자·하이픈·공백을 무시한다(`k7m4-qx2p`, `K7M4 QX2P` 모두 같은 코드). 화면은 `XXXX-XXXX` 로 보여 준다.
 */
export const INVITE_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const INVITE_CODE_LENGTH = 8;

export function generateInviteCode(): string {
  let out = '';
  for (let i = 0; i < INVITE_CODE_LENGTH; i++) out += INVITE_CODE_ALPHABET[randomInt(INVITE_CODE_ALPHABET.length)];
  return out;
}

/** 사용자가 친 값 → 저장 형식. 형식이 아니면 null(DB 를 두드리지 않고 404) */
export function normalizeInviteCode(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const s = input.toUpperCase().replace(/[\s-]/g, '');
  if (s.length !== INVITE_CODE_LENGTH) return null;
  for (const ch of s) if (!INVITE_CODE_ALPHABET.includes(ch)) return null;
  return s;
}

export function formatInviteCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * 선정 인원 = **수락(ACCEPTED)된 지원 수** (2026-09-27 사용자 결정).
 *
 * ⚠️ 정원(`capacity`)은 '지원할 수 있는 사람 수'가 아니라 '뽑을 수 있는 사람 수'다. 예전엔 거절 안 된 지원 전부를 세서
 *    정원이 차면 **지원 자체가 400** 이었다(KI-2, 2026-07) — 정원 5명이면 선착순 5명만 지원서를 낼 수 있었다.
 *    지금은 지원은 무제한이고, 수락·초대·초대 수락·코드 참여 네 곳이 이 수로 막는다.
 * ⚠️ 이 수를 **트랜잭션 밖에서 세고 나서 수락하지 말 것** — 마지막 한 자리에 둘이 동시에 들어오면 정원을 넘긴다.
 *    수락하는 쪽은 Serializable 트랜잭션 안에서 `tx` 를 넘겨 센다.
 */
export function countSelected(db: Db, exhibitionId: number, excludeApplicationId?: number): Promise<number> {
  return db.application.count({
    where: { exhibitionId, status: 'ACCEPTED', ...(excludeApplicationId ? { id: { not: excludeApplicationId } } : {}) },
  });
}

export async function selectedCounts(db: Db, exhibitionIds: number[]): Promise<Map<number, number>> {
  if (exhibitionIds.length === 0) return new Map();
  const grouped = await db.application.groupBy({
    by: ['exhibitionId'],
    where: { exhibitionId: { in: exhibitionIds }, status: 'ACCEPTED' },
    _count: { _all: true },
  });
  return new Map(grouped.map((g) => [g.exhibitionId, g._count._all]));
}

export const SEATS_FULL_MESSAGE = (capacity: number) => `선정 인원(${capacity}명)이 모두 찼습니다.`;

/**
 * 자리(정원)를 지키는 Serializable 트랜잭션 — 동시에 부딪혀 Postgres 가 한쪽을 되돌리면(P2034) 두 번까지 다시 시도한다.
 * 안 그러면 마지막 자리를 두고 둘이 동시에 수락할 때 진 쪽이 '데이터 처리 중 오류'(errorHandler 의 400)를 받는다 —
 * 다시 세면 '정원이 찼다'는 제대로 된 안내가 나간다.
 */
export async function withSeatLock<T>(db: PrismaClient, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(fn, { isolationLevel: 'Serializable' });
    } catch (e: any) {
      if (e?.code === 'P2034' && attempt < 2) continue;
      throw e;
    }
  }
}
