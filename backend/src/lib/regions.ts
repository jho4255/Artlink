/**
 * 지역 — 갤러리·공모(모집공고)·전시가 **같은 목록**을 쓴다.
 * 2026-10-08 사용자 요청으로 경북·경남·전북·전남을 더했다(공모 등록 때 고를 곳이 없었다).
 *
 * ⚠️ 화면의 목록은 `frontend/src/lib/utils.ts` 의 `regionLabels` — **같은 값·같은 순서**여야 한다
 *    (`frontend/src/__tests__/regions.test.ts` 가 이 파일과 대조한다). 한쪽에만 넣으면
 *    화면엔 보이는데 저장이 400 이거나, 저장은 되는데 목록 필터에 영영 안 걸린다.
 * ⚠️ 코드는 지우지 말 것 — DB 에 그 값으로 저장된 갤러리·공모·전시가 남는다. 이름만 바꿀 수 있다.
 */
export const REGIONS = [
  'SEOUL', 'INCHEON', 'GYEONGGI_NORTH', 'GYEONGGI_SOUTH',
  'DAEJEON', 'DAEGU', 'BUSAN', 'ULSAN',
  'GYEONGBUK', 'GYEONGNAM', 'JEONBUK', 'JEONNAM',
] as const;

export type Region = (typeof REGIONS)[number];

export const REGION_LABELS: Record<Region, string> = {
  SEOUL: '서울',
  INCHEON: '인천',
  GYEONGGI_NORTH: '경기 북부',
  GYEONGGI_SOUTH: '경기 남부',
  DAEJEON: '대전',
  DAEGU: '대구',
  BUSAN: '부산',
  ULSAN: '울산',
  GYEONGBUK: '경북',
  GYEONGNAM: '경남',
  JEONBUK: '전북',
  JEONNAM: '전남',
};

export function isRegion(v: unknown): v is Region {
  return typeof v === 'string' && (REGIONS as readonly string[]).includes(v);
}

/** 화면에 보일 이름 — 모르는 값은 그대로(빈칸보다 낫다) */
export function regionLabel(r?: string | null): string {
  if (!r) return '';
  return isRegion(r) ? REGION_LABELS[r] : r;
}
