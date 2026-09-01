/**
 * ArtLook 핸드오프 — 작품을 액자·전시공간 목업 도구로 넘긴다.
 *
 * ArtLook 은 `frontend/public/artlook/index.html` 의 **정적 페이지**다(번들 밖).
 * 합성은 전부 브라우저 Canvas 에서 하고 서버 연산은 없다. 그래서 데이터는
 * 같은 출처의 `localStorage` 로 넘긴다 — 새 탭에서 그대로 읽힌다.
 *
 * 들어오는 길은 둘이고, 결과물 파일명이 달라서 `kind` 로 구분한다.
 *   sold      운영페이지 정산 > 판매작 홍보   → `작가_작품명_공모명_판매작.png`
 *   portfolio 마이페이지 > 포트폴리오        → `작가_작품명.png`
 */
export interface ArtLookWork {
  url: string;
  title?: string;
  /** 작가 표시명 (다운로드 파일명용) */
  artist?: string;
  /** 공모명 — 판매작에서만 (다운로드 파일명용) */
  exhibition?: string;
  /** 어디서 왔는지. ArtLook 이 파일명과 안내 문구를 이걸로 고른다 */
  kind?: 'sold' | 'portfolio';
  /**
   * 작품 실치수 — 포트폴리오의 `sizeText`('116.8 × 91.0 cm' 처럼 자유 형식).
   * 장면(프리미엄) 모드가 이걸 읽어 **방에 실제 크기대로** 건다. 30호와 100호가
   * 같은 벽에서 다르게 보여야 목업이 판단 근거가 된다(경쟁 앱 리뷰의 최다 불만).
   * 없으면 장면의 기본 채움 비율로 앉으므로 넘겨도 안 넘겨도 동작은 한다.
   */
  sizeText?: string;
}

export const ARTLOOK_STORAGE_KEY = 'artlook:works';

/** 정적 페이지라 index.html 을 명시한다 (개발 Vite·운영 Express 양쪽에서 SPA fallback 회피) */
export const ARTLOOK_URL = '/artlook/index.html';
/** 마이페이지 안 iframe 용 — 바깥에 이미 제목이 있으므로 페이지 머리말을 감춘다 */
export const ARTLOOK_EMBED_URL = `${ARTLOOK_URL}?embed=1`;

/**
 * 넘길 작품을 localStorage 에 올려둔다. 이미지 없는 항목은 걸러낸다.
 * ArtLook 은 **뜰 때 한 번** 읽으므로 화면(iframe)을 그리기 **전에** 불러야 한다.
 * @returns 넘긴 작품 수 (0이면 보여줄 게 없다 — 호출부에서 안내)
 */
export function stageArtLookWorks(works: ArtLookWork[]): number {
  const valid = works.filter(w => w.url);
  if (valid.length === 0) return 0;
  try {
    localStorage.setItem(ARTLOOK_STORAGE_KEY, JSON.stringify(valid));
  } catch {
    // 시크릿 모드 등에서 저장이 막히면 ArtLook 이 빈 화면을 띄운다 — 여는 것 자체는 막지 않는다
  }
  return valid.length;
}

/**
 * 새 탭으로 ArtLook 을 연다.
 * 마이페이지 [ArtLook] 탭은 **같은 페이지 안 iframe** 으로 띄우고(왔다갔다 하지 않게),
 * 이 함수는 운영페이지 정산의 '판매작 홍보' 처럼 다른 화면에서 넘어올 때 쓴다.
 */
export function openArtLook(works: ArtLookWork[]): number {
  const n = stageArtLookWorks(works);
  if (n === 0) return 0;
  window.open(ARTLOOK_URL, '_blank');
  return n;
}
