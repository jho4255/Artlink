/* ArtLink 서비스워커 (vite-plugin-pwa injectManifest)
 *
 * 이 파일의 핵심은 "페이지 이동(navigation)을 네트워크 우선으로" 처리하는 것.
 *  - 예전(generateSW 기본)은 캐시 우선이라, 서비스워커의 precache에 담긴 index.html을
 *    무조건 먼저 내줬다. 그래서 (1) precache가 비면(Safari/삼성인터넷이 CacheStorage를
 *    삭제) 내줄 게 없어 흰 화면, (2) precache가 낡으면 죽은 청크를 가리키는 옛 셸에 갇힘.
 *  - 이제는 온라인이면 항상 네트워크에서 최신 index.html을 받아 흰 화면/구버전 고착을 막고,
 *    오프라인일 때만 precache된 셸로 폴백해 PWA 오프라인 동작은 유지한다.
 *
 * ⚠️ 이 서비스워커가 Cloudflare 엣지 캐시에 갇히면 이 로직 자체가 사용자에게 전달되지 않는다.
 *    sw.js는 반드시 no-cache로 서빙 + CDN에서 캐시 우회(Bypass)해야 한다(백엔드 index.ts에서
 *    no-cache 지정 완료. CDN Cache Rule은 대시보드에서 설정).
 *
 * API(/api)·업로드(/uploads)는 서비스워커가 절대 캐싱하지 않는다(네트워크 통과) → 목록 stale 방지.
 */
import { clientsClaim } from 'workbox-core';
import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching';
import { registerRoute, NavigationRoute } from 'workbox-routing';
import { NetworkOnly } from 'workbox-strategies';

// 새 서비스워커 즉시 활성화 (기존 generateSW의 skipWaiting/clientsClaim과 동일 동작)
self.skipWaiting();
clientsClaim();

// 해시된 번들 precache(오프라인 지원) + 이전 배포의 오래된 precache 정리(흰 화면 유발 감소)
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST || []);

// 오프라인 최종 폴백용 앱셸 핸들러(precache된 index.html). 키가 없으면 SW가 죽지 않도록 가드.
let offlineShell = null;
try {
  offlineShell = createHandlerBoundToURL('index.html');
} catch {
  offlineShell = null;
}

// 페이지 이동: 네트워크만 사용(5초 타임아웃) → 온라인이면 항상 최신 셸.
// 실패(오프라인/타임아웃) 시에만 precache된 '현재 배포' 셸로 폴백한다.
// precache 셸은 같은 빌드의 청크까지 함께 precache돼 있어 오프라인에서도 앱이 정상 동작하고,
// 런타임 캐시를 따로 두지 않으므로 배포 경계에서 낡은 셸이 남는 문제도 없다.
// NavigationRoute는 mode:'navigate'(최상위 문서 요청)만 매칭하므로 axios API 요청은 건드리지 않음.
// denylist는 /api·/uploads로 직접 진입하는 경우까지 방어(앱셸 폴백 금지).
const netOnly = new NetworkOnly({ networkTimeoutSeconds: 5 });
registerRoute(
  new NavigationRoute(
    async (options) => {
      try {
        return await netOnly.handle(options);
      } catch {
        if (offlineShell) return offlineShell(options);
        return Response.error();
      }
    },
    { denylist: [/^\/api\//, /^\/uploads\//] }
  )
);
