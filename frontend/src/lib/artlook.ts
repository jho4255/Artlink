/**
 * ArtLook 핸드오프 — 작품을 액자·전시공간 목업 도구로 넘긴다.
 *
 * ArtLook 은 `frontend/public/artlook/index.html` 의 **정적 페이지**다(번들 밖, 화면은 같은 폴더의 ui.js).
 * 합성은 전부 브라우저 Canvas 에서 하고 서버 연산은 없다. 그래서 데이터는
 * 같은 출처의 `localStorage` 로 넘긴다 — 새 탭에서도, 마이페이지 안 iframe 에서도 그대로 읽힌다.
 *
 * 들어오는 길은 둘이고, 결과물 파일명이 달라서 `kind` 로 구분한다.
 *   sold      운영페이지 정산 > 판매작 홍보(새 탭)   → `작가_작품명_공모명_액자_배경_판매작.png`
 *   portfolio 마이페이지 > [ArtLook] 탭(iframe)      → `작가_작품명_액자_배경.png`
 *
 * 마이페이지 iframe 과는 `postMessage` 로 이야기한다(2026-10-04, `readArtLookMessage`):
 *   iframe → 바깥  artlook:goto {to:'upload'}          [작품 올리기] — 작품 0점(데모 작품)일 때
 *                  artlook:goto {to:'size', id}        [크기 입력하기] — 크기를 몰라 30호로 건 작품
 *                  artlook:story {blob, name}          [ArtStory에 올리기] — 바깥이 올리고 사진이 실린 글쓰기 칸을 연다
 *   바깥 → iframe  artlook:story-failed                올리기가 실패했다(단추를 되살린다)
 */
import { thumbUrl } from '@/components/shared/Thumb';
import type { PortfolioImage } from '@/types';

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
   * 작품 실치수 — 포트폴리오의 `sizeText`('116.8 × 91.0 cm' 처럼 자유 형식, 세로×가로).
   * 장면 모드가 이걸 읽어 **방에 실제 크기대로** 건다. 30호와 100호가
   * 같은 벽에서 다르게 보여야 목업이 판단 근거가 된다(경쟁 앱 리뷰의 최다 불만).
   * 없으면 높이 90cm(30호 정도)로 가정해 걸고, 화면이 그렇게 걸었다고 알린다.
   */
  sizeText?: string;
  /** 포트폴리오 작품 id — [크기 입력하기] 가 그 작품의 정보 창을 연다 */
  id?: number;
  /**
   * 목록 칸에 쓸 작은 그림. 칸은 68px 인데 예전엔 원본(장당 0.4~1.3MB)을 받아 30점이면 23MB 였다(2026-10-04).
   * 못 받으면 ArtLook 이 원본으로 한 번 더 시도한다. 미리보기·저장은 언제나 원본이다.
   */
  thumb?: string;
}

export const ARTLOOK_STORAGE_KEY = 'artlook:works';

/** 정적 페이지라 index.html 을 명시한다 (개발 Vite·운영 Express 양쪽에서 SPA fallback 회피) */
export const ARTLOOK_URL = '/artlook/index.html';
/** 마이페이지 안 iframe 용 — 바깥에 이미 제목이 있으므로 페이지 머리말을 감춘다 */
export const ARTLOOK_EMBED_URL = `${ARTLOOK_URL}?embed=1`;

/**
 * 포트폴리오 작품 → ArtLook 이 받는 모양.
 * ⚠️ 제목은 **비어 있으면 비워 둔다**(`artworkTitle` 의 '무제' 를 쓰지 않는다) — ArtLook 이 '제목 없음'으로 보이고
 *    파일 이름에서 뺀다. '무제' 를 넘기면 정보를 안 넣은 작품이 넣은 것처럼 보인다(홈페이지 편집의 tileLabel 과 같은 이유).
 * ⚠️ 썸네일은 t800(`grid`)이다 — t240 은 옛 파일에 백필되지 않아 원본으로 떨어진다(Thumb.tsx THUMB_SIZES).
 */
export function portfolioArtLookWorks(
  images: Pick<PortfolioImage, 'id' | 'url' | 'title' | 'sizeText'>[],
  artist: string,
): ArtLookWork[] {
  return images.filter((img) => !!img.url).map((img) => ({
    id: img.id,
    url: img.url,
    thumb: thumbUrl(img.url, 'grid'),
    title: img.title?.trim() || undefined,
    artist,
    kind: 'portfolio' as const,
    sizeText: img.sizeText?.trim() || undefined,
  }));
}

/**
 * 넘길 작품을 localStorage 에 올려둔다. 이미지 없는 항목은 걸러낸다.
 * ArtLook 은 **뜰 때 한 번** 읽으므로 화면(iframe)을 그리기 **전에** 불러야 한다.
 * @returns 넘긴 작품 수 (0이면 보여줄 게 없다 — 호출부에서 안내)
 */
export function stageArtLookWorks(works: ArtLookWork[]): number {
  const valid = works.filter(w => w.url);
  if (valid.length === 0) {
    // 넘길 게 없으면 **지난 목록을 지운다** — 남겨 두면 작품을 전부 지운 작가에게 옛 작품이 그대로 뜬다.
    // 비어 있어야 ArtLook 이 데모 작품으로 떨어진다(규칙 36).
    clearArtLookWorks();
    return 0;
  }
  try {
    localStorage.setItem(ARTLOOK_STORAGE_KEY, JSON.stringify(valid));
  } catch {
    // 시크릿 모드 등에서 저장이 막히면 ArtLook 이 데모 작품을 띄운다 — 여는 것 자체는 막지 않는다
  }
  return valid.length;
}

/** 넘겨 둔 작품을 지운다 — 로그아웃 때도(같은 컴퓨터의 다음 사람이 ArtLook 주소를 열면 앞사람 작품이 떴다, 2026-10-04) */
export function clearArtLookWorks(): void {
  try { localStorage.removeItem(ARTLOOK_STORAGE_KEY); } catch { /* 저장이 막힌 환경 */ }
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

/* ───────────── iframe ↔ 바깥 ───────────── */

export type ArtLookMessage =
  | { type: 'goto'; to: 'upload' }
  | { type: 'goto'; to: 'size'; id: number }
  | { type: 'story'; blob: Blob; name: string };

/**
 * iframe 이 보낸 말을 읽는다 — 모양이 틀리면 null. ⚠️ **보낸 쪽은 부르는 쪽이 확인한다**
 * (`event.origin === location.origin && event.source === iframe.contentWindow`) — 다른 창이 보낸 말로 페이지를 옮기거나 올리면 안 된다.
 */
export function readArtLookMessage(data: unknown): ArtLookMessage | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (d.type === 'artlook:goto') {
    if (d.to === 'upload') return { type: 'goto', to: 'upload' };
    if (d.to === 'size' && Number.isInteger(d.id) && (d.id as number) > 0) return { type: 'goto', to: 'size', id: d.id as number };
    return null;
  }
  if (d.type === 'artlook:story') {
    if (typeof Blob === 'undefined' || !(d.blob instanceof Blob) || !/^image\/(jpeg|png)$/.test(d.blob.type)) return null;
    if (d.blob.size <= 0 || d.blob.size > STORY_IMAGE_MAX) return null;
    const raw = typeof d.name === 'string' ? d.name : '';
    const name = raw.replace(/[\\/:*?"<>|]+/g, '').trim().slice(0, 120) || 'ArtLook.jpg';
    return { type: 'story', blob: d.blob, name };
  }
  return null;
}
/** 서버의 사진 상한(`/upload/image` 15MB)과 같다 — 넘으면 보내 봐야 400 이다 */
export const STORY_IMAGE_MAX = 15 * 1024 * 1024;

/** ArtStory 글쓰기 칸에 실어 보낼 사진 — 라우터 `state` 의 키(`navigate('/feed', { state: { composeImages } })`) */
export const COMPOSE_STATE_KEY = 'composeImages';

/**
 * 라우터 state 에서 글쓰기 칸에 실을 사진 주소를 꺼낸다 — 문자열·우리 주소 모양만, 10장까지.
 * (서버도 `ownImageUrls` 로 우리 저장소 주소만 받는다 — 여기서는 화면에 이상한 값이 붙지 않게만 거른다)
 */
export function readComposeImages(state: unknown): string[] {
  if (!state || typeof state !== 'object') return [];
  const list = (state as Record<string, unknown>)[COMPOSE_STATE_KEY];
  if (!Array.isArray(list)) return [];
  return list
    .filter((u): u is string => typeof u === 'string' && (/^\/(?!\/)/.test(u) || /^https:\/\//i.test(u)))
    .slice(0, 10);
}
