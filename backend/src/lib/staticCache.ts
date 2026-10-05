/**
 * 프론트 빌드(`frontend/dist`) 정적 파일의 Cache-Control — `index.ts` 가 운영에서 dist 를 서빙할 때 쓴다.
 *
 * 세 가지로 나눈다.
 *  - `assets/` 아래 = 파일 이름에 내용 해시가 붙은 번들 → **1년 immutable**. 내용이 바뀌면 이름이 바뀐다.
 *  - 앱 셸(index.html·sw.js·registerSW.js·manifest.webmanifest) → **no-store**. CDN 엣지에도 남기지 않는다
 *    (sw.js 가 엣지에 1년 굳어 새 버전이 배포되지 않는 사고가 실제로 있었다, 2026-07).
 *  - **그 밖의 고정 이름 파일**(`public/` 에서 그대로 복사된 것) → **no-cache**. 저장은 하되 쓸 때마다 ETag 로
 *    확인한다(바뀌지 않았으면 304 — 본문을 다시 받지 않는다).
 *
 * ⚠️⚠️ 고정 이름 파일을 immutable 로 두지 말 것 (2026-10-04 실서버에서 확인). 예전엔 assets 가 아닌 것까지 전부
 *    `maxAge: '1y', immutable` 이었다. 그래서 ArtLook(`public/artlook/`)의 scene.js 가 Cloudflare 에 **9/4 판으로 30일째**
 *    굳어 있었다(원본은 9/16 판 — 작품 크기를 세로×가로로 읽게 고친 판). 고쳐 배포해도 이름이 같으면 사용자에게 가지 않는다.
 *    푸터의 회사 정보(`terms/company-info.txt`, "빌드 없이 파일만 고치면 바뀐다")도 같은 상태였다.
 *    이미 1년짜리로 받아 간 사본은 서버가 헤더를 바꿔도 다시 묻지 않으므로, ArtLook 은 부르는 쪽이 `?v=<빌드 ID>` 를 붙인다
 *    (`frontend/vite.config.ts` 의 artlook-build-id).
 */
import path from 'path';

/** 내용이 바뀌어도 이름이 같은 앱 셸 — 저장 자체를 막는다 */
export const NO_STORE_FILES = new Set(['index.html', 'sw.js', 'registerSW.js', 'manifest.webmanifest']);

export const CACHE_IMMUTABLE = 'public, max-age=31536000, immutable';
export const CACHE_REVALIDATE = 'no-cache';
export const CACHE_NO_STORE = 'no-store';

/** dist 기준 상대 경로(`artlook/scene.js`, `assets/index-abc.js`) → Cache-Control 값 */
export function staticCacheControl(relPath: string): string {
  const p = relPath.split(path.sep).join('/').replace(/\\/g, '/').replace(/^\.?\/+/, '');
  if (NO_STORE_FILES.has(p.split('/').pop() ?? '')) return CACHE_NO_STORE;
  if (p.startsWith('assets/')) return CACHE_IMMUTABLE;
  return CACHE_REVALIDATE;
}
