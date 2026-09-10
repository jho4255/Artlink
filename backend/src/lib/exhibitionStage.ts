/**
 * 공모의 **진행 범위** — "이 공고가 전시까지 가는가, 수락까지인가"를 한 곳에서 판정한다.
 *
 * ## 두 가지 (2026-09-10)
 *   전시까지 진행 (`recruitOnly=false`, 기본)
 *     지원 → 수락 → 자료제출 → 전시 확정 → 전시 종료 → 판매·정산
 *   공모만 진행 (`recruitOnly=true`)
 *     지원 → **수락에서 끝**. 뒷 단계가 아예 없다.
 *
 * ## 왜 서버가 막아야 하나
 * 화면에서 버튼만 감추면 **주소를 알거나 옛 알림을 누른 사람이 그대로 들어간다**. 그러면
 * 공모만 하기로 한 공고에 자료제출·정산 데이터가 생기고, 갤러리는 그런 걸 만든 적이 없으니
 * 아무도 안 본다 — 작가만 자료를 내고 기다리는, **에러 없이 조용히 어긋나는** 상태가 된다.
 * 그래서 뒷 단계 라우트는 전부 여기를 통과시킨다(규칙 22 가 권한을 한 곳에 모은 것과 같은 이유).
 *
 * ## 쓰는 법
 *   라우트에서 : `assertFullExhibition(exhibition)`   // 아니면 400
 *   화면 판정   : `hasExhibitionStages(exhibition)`
 */
import { AppError } from '../middleware/errorHandler';

export interface StageShape {
  recruitOnly?: boolean | null;
}

/** 자료제출·전시·정산 단계가 있는 공모인가 (= 전시까지 진행) */
export function hasExhibitionStages(ex: StageShape | null | undefined): boolean {
  return !ex?.recruitOnly;
}

/**
 * 뒷 단계(자료제출·확정·종료·판매·정산) 라우트의 관문.
 *
 * ⚠️ 404 가 아니라 **400** 이다 — 공모 자체는 존재하고 볼 수도 있다. 없는 척하면
 *    운영자가 "왜 내 공모가 사라졌지" 하고 헤맨다. 무엇이 없는지 말해 준다.
 */
export function assertFullExhibition(ex: StageShape | null | undefined): void {
  if (!hasExhibitionStages(ex)) {
    throw new AppError('공모만 진행하는 공고입니다. 지원자 수락까지만 진행되며 자료제출·전시·정산 단계가 없습니다.', 400);
  }
}
