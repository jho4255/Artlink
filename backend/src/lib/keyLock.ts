import type { Prisma } from '@prisma/client';
import prisma from './prisma';

/**
 * 한 사람(또는 한 포트폴리오)의 **'세고 나서 만들기'** 를 줄 세운다 (2026-10-03, 포트폴리오 만들기 신뢰성 검사).
 *
 * "N개까지" 상한을 `count()` → `create()` 로 지키면 동시에 들어온 요청이 둘 다 같은 수를 보고 들어간다(규칙 46 과 같은 경합).
 * 실측: 구성 상한 12개에 동시 5개 → **14개**, 저장 기록 하루 100줄에 26개씩 5번 → **104줄**(e2e 65 R7·R9).
 *
 * Postgres 의 **트랜잭션 advisory lock** 을 건다 — 같은 (ns, key) 끼리만 기다리고, 트랜잭션이 끝나면 저절로 풀린다(행·표를 잠그지 않는다).
 * ⚠️ Serializable(`withSeatLock`)을 쓰지 않은 이유: 그건 부딪히면 되돌리고 다시 시도하는 방식이라, 한 사람이 20개를 한꺼번에 보내면
 *    재시도(2회)가 바닥나 '데이터 처리 중 오류'가 난다. 여기는 기다렸다가 차례로 들어간다.
 * ⚠️ 잠근 뒤의 읽기·쓰기는 **반드시 `tx` 로** — 바깥 `prisma` 로 세면 잠금 밖이라 다시 경합한다.
 */
export const LOCK_NS = {
  /** 포트폴리오 구성(PortfolioVersion) 12개 상한 — key = portfolioId */
  portfolioVersions: 7101,
  /** PDF 저장 기록 하루 100줄 상한 — key = userId */
  portfolioExports: 7102,
  /** 공모 삭제 요청은 대상당 대기 중 하나 — key = exhibitionId */
  exhibitionDeleteRequests: 7103,
  /** 갤러리 삭제 요청은 대상당 대기 중 하나 — key = galleryId */
  galleryDeleteRequests: 7104,
  /** 이메일 인증번호 — 1분에 한 번 · 1시간에 5번(lib/emailCode.ts). key = 주소의 해시(int32) */
  emailCodes: 7105,
} as const;

export async function withKeyLock<T>(ns: number, key: number, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ns}::int, ${key}::int)`;
    return fn(tx);
  }, { maxWait: 10_000, timeout: 15_000 });
}
