/**
 * 모집 인원(= 선정 인원, 수락할 수 있는 사람 수) — 숫자로 정하거나, 공고에는 **'0명'·'00명'** 으로만 적는다
 * (2026-10-14 사용자 요청. 국내 공고의 관례 — '0명' = 한 자릿수, '00명' = 두 자릿수, 정확한 수는 밝히지 않는다).
 *
 * - `capacityMask` null = 숫자 그대로(지금까지의 모든 공모) · 'ONE' = 0명 · 'TWO' = 00명
 * - ⚠️⚠️ 수락 한도는 **`capacity` 하나**가 정한다 — 0명이면 9, 00명이면 99 를 함께 저장한다(사용자 결정: 0명=9명, 00명=99명).
 *    그래서 정원을 세는 곳(수락·초대·초대 수락·코드 참여, lib/inviteCode.ts)은 손대지 않아도 된다.
 *    둘을 따로 받지 말 것 — 0명인데 capacity 가 5 면 공고(0명)와 한도(5)가 다른 말을 한다. 늘 `resolveCapacity` 를 거친다.
 * - 공고에 숫자를 쓰는 곳은 `capacityText` 로 — `${capacity}명` 을 그대로 쓰면 0명 공고에 '9명' 이 뜬다.
 * - 화면 거울: `frontend/src/lib/utils.ts`(CAPACITY_MASKS·capacityText) — 같은 값이어야 한다(프론트 테스트가 대조).
 */
import { AppError } from '../middleware/errorHandler';

/** 숫자로 정할 때의 상한 — DB 정수 범위를 넘는 값이 500 이었다(2026-10-03 점검 S10). 화면 `CAPACITY_MAX` 와 같아야 한다 */
export const CAPACITY_MAX = 1000;

/** 0명·00명 — 공고에 적는 글자와 수락 한도 */
export const CAPACITY_MASKS = {
  ONE: { label: '0명', max: 9 },
  TWO: { label: '00명', max: 99 },
} as const;
export type CapacityMask = keyof typeof CAPACITY_MASKS;

export function isCapacityMask(v: unknown): v is CapacityMask {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(CAPACITY_MASKS, v);
}

/**
 * 받은 값 → 저장할 두 칸. 0명·00명이면 보낸 숫자는 무시하고 그 한도(9·99)를 쓴다.
 * 숫자면 1 ~ CAPACITY_MAX 정수만. 틀리면 400.
 */
export function resolveCapacity(capacity: unknown, mask: unknown): { capacity: number; capacityMask: CapacityMask | null } {
  if (mask != null && mask !== '') {
    if (!isCapacityMask(mask)) throw new AppError('모집 인원 표시가 올바르지 않습니다.', 400);
    return { capacity: CAPACITY_MASKS[mask].max, capacityMask: mask };
  }
  if (typeof capacity !== 'number' || !Number.isInteger(capacity) || capacity < 1) {
    throw new AppError('모집 인원은 1명 이상이어야 해요.', 400);
  }
  if (capacity > CAPACITY_MAX) throw new AppError(`모집 인원은 ${CAPACITY_MAX}명까지 정할 수 있어요.`, 400);
  return { capacity, capacityMask: null };
}

/** 공고에 적는 모집 인원 — '5명' | '0명' | '00명' */
export function capacityText(capacity: number, mask?: string | null): string {
  return isCapacityMask(mask) ? CAPACITY_MASKS[mask].label : `${capacity}명`;
}

/** 자리가 다 찼을 때 — 0명 공고면 '0명 — 최대 9명' 처럼 한도를 함께 밝힌다(그냥 '9명' 이면 공고와 다른 숫자로 읽힌다) */
export function seatsFullMessage(capacity: number, mask?: string | null): string {
  const what = isCapacityMask(mask) ? `${CAPACITY_MASKS[mask].label} — 최대 ${capacity}명` : `${capacity}명`;
  return `선정 인원(${what})이 모두 찼습니다.`;
}
