/**
 * 서비스워커가 페이지를 넘겨받았을 때(`controllerchange`) 새로고침할지 — `main.tsx` 가 붙인다.
 *
 * 새로고침은 **새 버전이 배포돼 다른 워커로 바뀌었을 때만** 한다. 워커는 `sw.js` 에서 `skipWaiting()` + `clientsClaim()` 이라
 * 활성화되자마자 열린 페이지를 넘겨받는데, 이건 처음 설치될 때(관리자 없음 → 워커)에도 똑같이 일어난다.
 *
 * ⚠️⚠️ 처음 설치를 업데이트로 치지 말 것 (2026-10-04 실측) — 예전엔 구분하지 않아 **처음 온 사람의 페이지가 들어온 지 7초쯤에
 * 저절로 다시 불러와졌다**(실서버 PC 7.4초 · 휴대폰 6.5초, 두 번째 방문부터는 없음). 광고로 처음 온 사람이 보던 화면이
 * 깜빡이며 열어 둔 메뉴·창이 닫히고 입력하던 글이 사라졌다. 비회원 통계에는 첫 화면이 '×2' 로 남았다.
 * 처음 설치된 페이지는 이미 네트워크에서 받은 최신본이라(내비게이션은 NetworkOnly) 다시 불러올 이유가 없다.
 */
export function controllerChangeReloader(hadController: boolean, reload: () => void): () => void {  // reload 는 main.tsx 가 reloadIfStale 로 넘긴다
  let had = hadController;
  let refreshing = false;
  return () => {
    // 처음 넘겨받은 것 — 새 버전이 아니다. 이 탭에서 다음에 오는 넘겨받기(배포)부터 새로고침한다
    if (!had) { had = true; return; }
    if (refreshing) return;   // 새로고침 중에 또 오면 무시(되풀이 방지)
    refreshing = true;
    reload();
  };
}

/** 페이지 HTML 이 가리키는 첫 화면 묶음 경로(`/assets/index-<hash>.js`) — 없으면 null */
export function entryScriptOf(html: string): string | null {
  const m = html.match(/\/assets\/index-[\w-]+\.js/);
  return m ? m[0] : null;
}

/**
 * 워커가 바뀌었을 때(배포) 이 페이지가 **이미 최신 판인가** — 서버의 지금 `index.html` 이 가리키는 첫 화면 묶음이 이 페이지에도 있으면 최신이다.
 * 모르면(못 받음·못 찾음) false — 예전처럼 새로고침한다(오래 열어 둔 옛 화면은 지워진 옛 파일을 부르다 깨지므로 새로고침이 맞다).
 */
export function isLatestBuild(latestHtml: string | null, pageScriptSrcs: string[]): boolean {
  const latest = latestHtml ? entryScriptOf(latestHtml) : null;
  if (!latest) return false;
  return pageScriptSrcs.some((src) => {
    try { return new URL(src, 'http://localhost').pathname === latest; } catch { return false; }
  });
}

/**
 * ⚠️⚠️ 새 워커가 넘겨받아도 **이미 최신 판이면 새로고침하지 않는다** (2026-10-12).
 * 페이지 이동은 네트워크에서 받으므로(sw.js) 배포 뒤 다시 온 사람은 첫 화면부터 새 판이다. 그런데 새 워커는 그 뒤에 파일을 다 받고서야
 * 넘겨받아(실서버 약 18초) 예전엔 이미 새 판인 화면을 또 불러왔다 — 보던 화면·열어 둔 팝업이 지워졌다.
 */
export async function reloadIfStale(fetchLatest: () => Promise<string>, pageScriptSrcs: () => string[], reload: () => void): Promise<void> {
  let html: string | null = null;
  try { html = await fetchLatest(); } catch { html = null; }
  if (isLatestBuild(html, pageScriptSrcs())) return;
  reload();
}
