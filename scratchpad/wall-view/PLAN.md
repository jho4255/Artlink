# 작가 홈페이지 라이트박스 — [벽에 걸어 보기] (ArtLook 응용) 분석·계획

작성 2026-10-22 · 상태 **구현됨(2026-10-22, 커밋 전 — 로컬 확인 중)**. 결정 6개는 추천안 그대로 갔다. 지금 규칙은 CLAUDE.md 74.

## 구현하며 계획과 달라진 것
- **작품 전용 창을 새로 만들었다**(`components/shared/ArtworkViewer.tsx`) — `ImageLightbox` 를 키우지 않았다. 그건 갤러리·전시·지원자 사진 다섯 곳이 쓰고,
  토글·캡션 두 줄·공유·썸네일 줄은 작품에만 뜻이 있다.
- **벽 사본(1,400px)을 만들지 않았다** — `white-plaster` 원본(2,508px, 1.2MB)을 그대로 쓴다. 출력이 벽 사진 크기 ÷ 1.6 로 정해져 사본이면 1,080px 로 줄어
  PC 레티나·휴대폰에서 무르다. `scenes.json` 도 안 바꿨다(view.js 가 목록의 그 장면을 복사해 쓴다) — `ui.js buildScenes` 도 그대로.
- **합성 배율은 1 하나** — 2 는 4배 느리고(헤드리스 1.2~2.3초) 화면 크기에선 차이가 안 보였다(`out/cmp-edge.png`). 같은 출처 iframe 이라 그 시간 동안 바깥 화면도 멈춘다.
  그래서 '초안 → 완성'은 배율이 아니라 **사진**(t800 → 원본)의 차이다. 원본은 0.45초 머문 뒤에만, 이웃은 0.7초 멈춘 뒤에만, 일 사이 160ms.
- **엔진 로더는 정적 태그 그대로** — `<script src="view.js?v=…">` 를 ui.js 다음에 더했고, 둘 다 `VIEW_ONLY` 를 보고 첫 줄에서 돌아간다(ArtLook 탭은 지연 없음).
- 바탕은 불투명(95% 였을 때 휴대폰에서 뒤 페이지의 [로그인]이 [닫기] 밑에 비쳤다). 판매완료 점은 사이트 빨강 하나(규칙 47 가드에 걸렸다).
- 로컬 확인용으로 실서버 복제본(`artlink_prod`)에 밀린 마이그레이션 3개(칸·표 추가뿐)를 적용했다 — 백업 `~/artlink-backups/artlink-prod-replica-before-migrate-20261022.dump`.
  R2 CORS 가 `localhost:5173` 만 허용해서 복제본 화면을 5173 에 띄웠다(데모는 5183).
참고 그림은 `scratchpad/wall-view/ref/`, 엔진 시간을 잰 스크립트는 `scratchpad/wall-view/timing-probe.mjs`(vite 를 5191 로 띄우고 돌린다).

### 로컬 확인 뒤 고친 것 (2026-10-23)
- **캡션이 안 보인다** → 화면 왼쪽 아래 구석이라 작품에서 멀었다. 작품 바로 아래 가운데로(사진·벽 둘 다), PC 는 좋아요·공유를 위 줄(닫기 옆)로 올려 작품 크기를 지켰다.
  작품 정보를 하나도 안 넣은 작가도 있다(복제본 451점 중 정보 있는 작품 81점) — 그런 작품은 캡션 없이 작품만.
- **'벽에 거는 중'이 길다** → 첫 장의 절반 이상이 '처음 한 번' 비용(벽 사진 해독·텍스처·광원 측정)과 사진 받기였다. 사진은 엔진 준비와 함께 받고, view.js 가 준비 신호 전에
  미리 치르고(warmUp), 버튼에 마우스를 올리거나 누르기 시작하면 미리 띄운다. 헤드리스 첫 초안 1.15 → 0.8초(`timing.mjs` · `warm.mjs`).
- **액자를 바꾸자** → 오크 액자 · 매트 넓게 · 차콜 벽(사용자 지정) → 곧이어 **오크 플로터**로(사진 액자가 아니라 엔진이 그리는 액자 — 결 텍스처 0.3MB 한 장). 액자 자산까지 와야 준비 신호.
- **"아트룩에서 보던 것보다 퀄리티가 개쓰레기"** → 속도 때문에 낮춘 화질이 원인이었다(완성 배율 1 · 초안 0.6배로 그려 키움). 캔버스 랩에선 안 보이던 차이가 액자·매트에서 드러났다.
  완성은 ArtLook 저장과 같은 배율 2 · capToCanvas · JPEG 0.95, 초안은 t800 · 배율 1 로 되돌렸다. 대조 `quality.mjs`(완성 ↔ 저장 PNG 평균 1~2 단계).
  같이: 헤드리스에서 WebGL 이 꺼져 작품 없이 그림자만 남은 그림이 한 번 나왔다 → view.js 가 `glLost()` 를 보고 그 그림을 버리고 새 iframe 으로 다시 그린다.

## 0. 한 줄 요약

미미오(mimio.life) 작가 페이지의 작품 [See More] 창은 **작품을 회색 벽에 그림자와 함께 걸어 보여 준다**. 우리 라이트박스는 검은 바탕에 사진만
띄운다. 우리에겐 그 일을 훨씬 잘하는 ArtLook 엔진이 이미 있으니, 라이트박스 안에 **[사진 | 벽에 걸어 보기] 토글**을 두고 벽 보기는 **숨은 iframe 의 ArtLook 엔진이
그려 준 그림**을 띄운다. 엔진은 건드리지 않고(합성 규칙 36~44k 그대로) **얇은 '그리기 전용 화면'(`view.js`)** 하나를 더한다. 기본은 지금처럼 사진이고, 벽 보기는
WebGL2 가 없거나 실패하면 조용히 빠진다.

## 1. 미미오 See More 와 우리 라이트박스 — 눌렀을 때 무엇이 다른가

| | 미미오 (실측 2026-10-22, 크롬 PC 1280 · 폰 390) | 우리 작가 홈페이지 (`ImageLightbox` + `PortfolioPage`) |
|---|---|---|
| 작품 칸 | 정사각 **cover(잘림)** · 마우스를 올리면 어둡게 덮고 가운데 [See More] · 휴대폰은 **두 번** 눌러야 열림(첫 탭 = 덮개) | 정사각 칸 안 contain(안 자름) · **한 번** 누르면 열림 · 캡션은 칸 아래 늘 보임 |
| 열린 창 — 배경 | **회색 벽 사진 + 그림자**(작품이 걸린 느낌) · 창은 페이지 위 모달 | 검정 90% 바탕에 사진만 · 사진 모서리를 `rounded-lg` 로 **깎는다(작품 모서리 손실)** |
| 캡션 | 두 줄: `작품명 | 영문명` / `연도 | 재료 | 크기` | 한 줄: `작품명, 연도 / 재료 / 크기 / 가격`(`museumCaption` + `priceLabel`) |
| 부가 | 하트 · 공유 · 닫기 · 좌우 화살표 · **아래 썸네일 줄**(현재 작품 노란 테) | 좋아요 · 닫기 · 좌우 화살표 · `1 / N` 숫자 · 키보드 · 스와이프 · `?work=` 고유 주소 |
| 접근성/겹침 | — | `role=dialog`·`aria-modal` 이 없다 → 소개 팝업(규칙 73)이 라이트박스 **위에** 뜰 수 있다(광고 → `?work=` 링크 착지 때) |

**우리가 모자란 것**(이 계획이 채울 것): ① 벽에 걸린 모습 ② 두 줄 캡션 ③ 공유 ④ 썸네일 줄(선택) ⑤ 모서리 깎임 ⑥ dialog 표시.
**우리가 나은 것**(지키는 것): 한 번에 열림 · 안 자름 · 키보드·스와이프 · 고유 주소 · 가격.

## 2. 지금 구조에서 확인한 사실

### 2-1. 라이트박스 쪽
- `frontend/src/components/shared/ImageLightbox.tsx`(157줄): `images:string[]`(원본 URL) · `captions` · `renderExtra`(좋아요) · `onIndexChange`(ref 로 들어 무한 루프 방지) · 스크롤 잠금 · Esc/화살표/스와이프 · 배경 클릭 닫기.
  Portal(`z-[9999]`). 사진 `<img>` 는 crossorigin 없이 원본을 그대로 받는다.
- `frontend/src/pages/PortfolioPage.tsx`: `ordered`(시리즈 순) · `openAt` · `?work=` 로 바로 열기 · `syncWorkParam`(정식 주소 유지) · `captionTexts` · `renderLike`(showInExplore 작품만) · `share()`(페이지 주소 Web Share/복사).
- 격자 칸은 t800(`Thumb size="grid"`), 대표작·라이트박스는 원본. 비회원 통계 `guestPath` 는 `work` 쿼리를 남긴다(벽 보기는 상태라 통계에 안 섞인다).

### 2-2. ArtLook 엔진 쪽 (`frontend/public/artlook/`)
- `index.html`(2,669줄) = 엔진: 전역 `state`(img·frameIdx·mode·sceneIdx·ratio·light·matWidth·draft) · `FRAMES`(사진 액자 8 + 절차적 + `canvas-wrap`) · `compose()`(**동기**, `#preview` 캔버스에 그린다, 합성 배율 `SUPERSAMPLE` 2.0 / `state.draft` 면 1) · `capToCanvas(img)` · `drawWatermark`(항상, 끌 수 없음) · `?embed=1`·`?preload=all`·`?level=`·`?debug=1`.
- `scene.js`(1,421줄) = `window.ArtLookScene` { `supported()`(WebGL2) · `loadScenes(url, cb, {preloadAll})` · `ensureScene(s, onEach)` · `sceneReady` · `composeScene` · `parseSizeCm` }. 사진은 **고를 때** 받는다.
- `ui.js`(785줄) = 화면(탭·칩·끌기·저장). `index.html` 맨 아래 `<script src="ui.js?v=__ARTLOOK_BUILD__">` 로 고정 로드. 엔진이 부르는 건 `window.render/requestRender/onAssetArrived` 뿐.
  장면 목록을 받아 `SCENES` 를 채우고 `state.mode='scene'` 으로 바꾸는 코드가 ui.js 545~569행에 있다(엔진 기본은 `mode:'wall'`). `buildScenes` 는 **모든 group 을 칩으로 그린다**(wall/space 두 글자 라벨만 있음) → 보기 전용 장면을 더하면 거르는 한 줄이 필요하다.
- 자산: 벽 사진 2,508~2,600px 1.1~2.9MB(`wall01~10, 21~26`) / 실내 1,254px 80~220KB(`wall11~17`) / 사진 액자 PNG 0.9~1.1MB(두꺼운 5종) · 195~250KB(얇은 3종) / `canvas-wrap` 은 **자산 0**.
- 캐시: `backend/src/lib/staticCache.ts` — `artlook/` 고정 이름 파일은 no-cache(ETag), `?v=빌드ID` 로 CDN 우회(`vite.config.ts artlook-build-id` 가 index.html 안 `__ARTLOOK_BUILD__` 를 **전부** 바꾼다). 서비스워커 precache 제외·NavigationRoute denylist `/artlook/`.
- 마이페이지 iframe 연동 패턴(`MyPage.tsx ArtLookSection`, `lib/artlook.ts readArtLookMessage`): `postMessage` + `e.source === iframe.contentWindow && e.origin === location.origin` 검사. 작품 목록은 localStorage 로 넘긴다(벽 보기에는 안 쓴다 — 아래).
- 외부(R2) 작품을 캔버스에 쓰려면 taint 를 피해야 한다. ui.js 는 `/api/upload/image-proxy?immutable=1` 로 중계하지만, 프론트에는 **R2 직접(CORS) → 실패 시 프록시** 경로가 이미 있다: `lib/imageFetch.ts fetchImage(url)`(`cache:'reload'` 로 규칙 16 함정 회피, 정체 타임아웃).

### 2-3. 실측 — 라이트박스 후보 설정으로 엔진을 돌려 봤다 (헤드리스 SwiftShader, GPU 없음 → **비관적 값**)
`timing-probe.mjs` · 데모 작품 `dawn-window.jpg`(세로) · 결과 그림 `ref/engine-*.jpg`

| 배경 · 액자 · 비율 | 장면 px | 출력 px | 합성 초안(배율 1) | 합성 완성(배율 2) | 비고 |
|---|---|---|---|---|---|
| white-cube(실내) · canvas-wrap · 4:5 | 1254 | 864×1080 | 340ms | 866ms | 전시장 느낌, 작품이 작다(maxLong 0.49) |
| white-plaster(벽) · canvas-wrap · 4:5 | 2508 | 1254×1568 | 855ms | 1,907ms | **작품이 크고 보기 좋다** — 1순위 |
| white-plaster · oak-thin(얇은 액자) · 4:5 | 2508 | 1254×1568 | 289ms | 790ms | 액자 PNG 250KB 더 받음, 3D 옆면이 없어 더 빠르다 |
| sand · canvas-wrap · **16:9** | 2600 | 1625×914 | 1,006ms | 1,864ms | ⚠️ **세로 작품이 위아래로 잘린다** |

- 마이페이지 ArtLook 탭의 첫 그림(기본 설정)은 1.3초, 받는 파일은 index.html 185KB + scene.js 88KB + ui.js 40KB + 목록 JSON 2 + 고른 벽 1장 + 고른 액자 1장.
- ⚠️ **잘림의 원인**: `composeScene` 의 상한 `maxLong` 은 "조각 긴 변 ≤ **화면 긴 변**의 70%" 다. 가로 캔버스에 세로 작품을 걸면 작품 긴 변(높이)이 캔버스 높이보다 커질 수 있다.
  → 벽 보기는 **출력 비율을 작품 방향에 맞춘다**(세로 작품 4:5 · 가로 5:4 · 정사각 1:1). 그러면 작품 긴 변 축 = 캔버스 긴 변 축이라 70% 안에 반드시 든다. 엔진을 고칠 필요가 없다. 라이트박스는 그 그림을 화면에 contain 으로 놓는다(미미오 PC 창도 가운데 판 + 양옆 어두운 띠다).
- 실제 GPU(PC·휴대폰)는 WebGL 워프가 훨씬 빠르지만 Canvas2D 그림자·그레인은 CPU 라 몇 배나 빠른지는 **실기기에서 재야 한다**(README 의 ArtLook 하니스도 같은 주의). 그래서 **초안(배율 1)을 먼저 보여 주고 완성(배율 2)으로 바꿔 끼운다** — ui.js 의 끌기 중 draft 동작과 같은 원리.

## 3. 설계

### 3-1. 사용자 눈에 보이는 것
```
┌───────────────────────────────────────────────┐
│  [사진 | 벽에 걸어 보기]        1 / 27     ✕   │   ← 위 가운데 토글(세그먼트), 기본 '사진'
│                                                │
│   ◀        (사진 / 벽 그림, contain)        ▶  │
│                                                │
│  작품명, 2023                   ♡ 12   ⤴ 공유 │   ← 두 줄 캡션(미술관 라벨) + 좋아요 + 공유(작품 주소 ?work=)
│  장지에 채색, 한지콜라주 · 45.5×53.0 cm · 250,000원 │
│  ▢ ▢ ▣ ▢ ▢ ▢ ▢ ▢ ▢ …                            │   ← PC 만 · 선택(결정 5)
└───────────────────────────────────────────────┘
```
- **토글**: [사진 | 벽에 걸어 보기]. 마지막 선택을 이 탭(sessionStorage)에 기억 → 벽을 골랐으면 다음 작품도 벽으로 열린다. 벽 그림이 아직 없으면 그 자리에 사진을 흐리게 두고 "벽에 거는 중…" → 초안 → 완성 순으로 바꿔 끼운다(깜빡임 없이 교체).
- **벽 그림**: 중립 밝은 벽(white-plaster 를 **1,400px 로 줄인 보기 전용 사본**, ≈300KB) · 액자 `canvas-wrap`(자산 0) · 매트 0 · 조명 0 · 비율은 작품 방향(4:5 / 5:4 / 1:1) · 장면 `fill` 로 작품을 크게(0.76 부근 — 로컬 확인에서 미미오와 나란히 보고 정한다). 워터마크·실치수는 결정 1·2.
- **좌우 넘김·스와이프·키보드·`?work=`·좋아요**는 그대로. 벽 모드에서 넘기면 다음 작품도 벽(미리 그려 둔 초안이 있으면 즉시).
- **작은 손질**(토글과 무관하게 같이): 사진의 `rounded-lg` 제거(작품 모서리를 깎지 않는다, 규칙 18 정신) · 캡션 두 줄 · [공유](Web Share → 복사, 주소는 `?work=<id>`) · `role="dialog" aria-modal="true"`(소개 팝업이 기다린다 · 스크린리더).
- **폴백**: WebGL2 없음 / `scenes.json`·벽 사진 못 받음 / 15초 넘김 / iframe 오류 → 토글을 감추거나 "이 브라우저에서는 벽 보기를 쓸 수 없어요" 한 줄, 사진은 그대로. **라이트박스가 깨지는 일은 없어야 한다**(try/catch, 타임아웃, 페이지 오류 0 — e2e 로 못 박는다).
- 적용 범위(결정 6): v1 은 **작가 홈페이지 라이트박스**(`PortfolioPage`)만. 편집 미리보기(`compact`)·[작가] 탭 `ArtworkDetailModal` 은 제외.

### 3-2. 구조 — "엔진은 숨은 iframe 안, 화면은 React"
iframe 을 직접 보여 주는 방식(안 C)은 키보드·스와이프가 iframe 경계에서 끊기고 캡션·단추를 iframe 위에 얹어야 해서 버렸다. 엔진을 번들로 옮기는 것(2,669줄 전역 스크립트)은 이 일의 범위가 아니다.

```
PortfolioPage ── ImageLightbox(토글·캡션·넘김) ──▶ useWallRenderer(hook)
                                                     │  fetchImage(원본) → Blob
                                                     │  postMessage {artlook:render}
                                                     ▼
                                   <iframe src="/artlook/index.html?view=1" (1×1, 화면 밖)>
                                     index.html 엔진 + scene.js + view.js(새, ui.js 대신)
                                     Blob → Image → state.img=capToCanvas → compose() → toBlob(jpeg .9)
                                                     │  postMessage {artlook:rendered}
                                                     ▼
                                   objectURL 캐시(작품 id → 초안/완성) → <img> 로 표시
```
- **메시지**(같은 출처, `e.source === iframe.contentWindow && e.origin === location.origin` 기존 검사 그대로, 읽기는 `lib/artlook.ts readArtLookMessage` 확장):
  - 바깥 → iframe `{ type:'artlook:render', req:<n>, blob:Blob, aspect:<w/h>, quality:'draft'|'full', opts:{ scene:'view-plaster', frame:'canvas-wrap', ratio:'4:5'|'5:4'|'1:1', watermark:false, sizeText?:string } }`
  - iframe → 바깥 `{ type:'artlook:ready' }`(엔진·장면 준비) · `{ type:'artlook:rendered', req, quality, blob:Blob(image/jpeg) }` · `{ type:'artlook:render-failed', req, reason }` · `{ type:'artlook:unsupported' }`(WebGL2 없음)
  - 바깥은 blob 의 type/크기(≤ 15MB)와 `req` 일치를 검사한다. 모르는 모양은 버린다.
- **iframe 은 `display:none` 이 아니라 화면 밖 1×1**(`position:fixed; left:-9999px; width:1px; height:1px; opacity:0; pointer-events:none; aria-hidden`) — 숨긴 문서에서는 `requestAnimationFrame` 이 안 돈다. view.js 는 rAF 를 쓰지 않고 `compose()` 를 **직접** 부른다(동기). `toBlob` 콜백은 가려져도 온다.
- **수명**: 라이트박스가 처음 열릴 때 iframe 을 만들고 `PortfolioPage` 가 살아 있는 동안 유지(두 번째부터는 즉시). 페이지를 떠나면 제거 + objectURL 전부 revoke.
- **큐·캐시·미리 그리기**: 한 번에 하나만 그린다(큐). 현재 작품 초안 → 현재 완성 → 다음 작품 초안 → 이전 작품 초안 순. 캐시는 작품 id 당 `{draft?, full?}` objectURL, 최대 8개(넘치면 가장 오래된 것 revoke). 넘길 때 요청이 겹치면 **마지막 요청만 유효**(`req` 번호로 옛 응답을 버린다).
- **작품 그림 가져오기**: `lib/imageFetch.ts fetchImage(url)` → Blob → iframe 으로. 서버를 안 거치고(R2 직접, 실패 시만 프록시) 규칙 16 함정(`<img>` 가 먼저 남긴 CORS 없는 캐시)을 이미 피한다. 사진 보기가 받은 원본과 **한 번 더 받는 셈**(작품당 평균 1MB) — 벽 보기를 눌렀을 때만이라 받아들인다. (v2: 휴대폰은 t800 로 그리기 — 벽 위 작품은 ≤ 1,100px 라 800px 로도 거의 차이가 없다. 로컬 확인에서 둘을 나란히 보고 정한다.)
- **품질·메모리**: 초안 = `state.draft=true`(배율 1), 완성 = 배율 2 (휴대폰은 `state.ssMax=1.5` — 엔진 `compose()` 의 `SS` 식에 상한 하나 추가, 기본값 없으면 지금과 같다). 1,254×1,568 완성 합성 캔버스 = 2,508×3,136(31MB) — 아이폰도 괜찮지만 1.5 면 18MB.
- **출력 비율**은 `targetDims(ratio)` 가 `'a:b'` 문자열이면 무엇이든 받는다(`RATIOS` 목록은 ui.js 의 칩용). 그래서 `'5:4'` 를 쓸 수 있다.
- **엔진 변경은 셋뿐**(합성 규칙·기준 렌더 불변 — vt 하니스는 ui.js 경로라 영향 없음):
  1. `index.html` 맨 아래 스크립트 로더: `?view=1` 이면 `view.js`, 아니면 `ui.js`(둘 다 `?v=__ARTLOOK_BUILD__`). `artlookScreen.test.ts` 172~173행의 문자열 기대를 새 로더 모양으로 바꾼다.
  2. `drawWatermark()` 첫 줄 `if(state.watermark===false) return;`(결정 1 에 따라) · `compose()` 의 `SS` 식에 `state.ssMax` 상한.
  3. `scenes/scenes.json` 에 보기 전용 장면 `{ id:'view-plaster', group:'view', src:'walls/view/plaster-1400.jpg', frameless:true, region:[…], regionAspect, fill:0.76, maxLong:0.80, lightDir·shadow·wallAmt·toneAmt·wallCalm 은 white-plaster 와 같게 }` + `ui.js buildScenes` 에서 `group==='view'` 는 칩에서 **제외**(한 줄). 사진은 `frontend/scripts/build-artlook-view-wall.mjs`(sharp 로 `wall26-white-plaster.jpg` → 1,400px, q82) 로 만든다. thumbs 는 필요 없다(칩에 안 나온다). 출처 문서 `docs/artlook-asset-provenance.md` 에 한 줄.
- **view.js**(새, ≈120줄): `?view=1` 전용. ① `ArtLookScene.supported()` 아니면 `artlook:unsupported` 보내고 끝 ② `loadScenes('scenes/scenes.json?v='+BUILD)` → `SCENES` 채우고 `view-plaster` 를 `ensureScene`, 준비되면 `artlook:ready` ③ `message` 수신: 검사(`e.source===window.parent`, origin) → `URL.createObjectURL(blob)` → `Image` → `state.img=capToCanvas(im)` → `state.mode='scene'; sceneIdx; frameIdx=canvas-wrap; matWidth=0; light=0; ratio; draft; watermark=false; selectedWork = opts.sizeText ? {sizeText} : null` → `compose()` → `preview.toBlob(cb,'image/jpeg',0.9)` → 응답, objectURL revoke ④ 한 번에 하나(큐) ⑤ 어떤 예외도 `render-failed` 로 바꾼다 ⑥ `window.__artlookRenders` 증가(테스트용).
  `fetch` 로 글꼴을 기다릴 필요가 없다(워터마크 없음). `localStorage artlook:works/prefs` 는 **읽지도 쓰지도 않는다**(방문자 브라우저에 작가 목록이 남으면 안 된다).

### 3-3. React 쪽 파일
- 새 `frontend/src/lib/wallView.ts`(순수, 테스트 대상): `wallRatioFor(aspect)`(4:5/5:4/1:1) · `WALL_VIEW_SCENE/FRAME` 상수 · `readWallMessage(data)`(iframe → 바깥, `readArtLookMessage` 와 같은 꼴) · `makeRenderRequest(...)` · 기억(`sessionStorage 'artlink-lightbox-view'`, 던지지 않게 try/catch) · 캐시 LRU(`WallCache`, revoke 콜백 주입).
- 새 `frontend/src/hooks/useWallRenderer.ts`: iframe 생성/수명 · ready/unsupported 상태 · `request(work, quality)` · 큐 · 미리 그리기 · 타임아웃(장면 준비 15s, 한 장 20s) · `status(workId)` = 'idle'|'rendering'|'draft'|'full'|'failed'.
- `ImageLightbox.tsx` 확장(새 props, 기본값은 지금 동작): `view?: { mode:'photo'|'wall'; onModeChange; wallSrc?:string|null; wallStatus; available:boolean }` · `captionLines?: [string, string]` · `onShare?` · `thumbs?: string[]`(선택) · `rounded-lg` 제거 · `role="dialog" aria-modal`. 다른 사용처(갤러리 사진 등)는 props 를 안 주므로 그대로다.
- `PortfolioPage.tsx`: `useWallRenderer(ordered)` 연결 · `captionLines`(제목·연도 / 재료 · 크기 · 가격) · 공유 주소 `?work=` · 열릴 때 현재 작품 초안 요청(벽 모드였으면 즉시, 사진 모드면 **1초 뒤 미리**) — 사진 모드 사용자에게 헛된 다운로드를 안 시키려면 "미리 그리기는 벽 모드를 한 번이라도 켠 뒤부터"로 둔다(결정 4).
- `lib/artlook.ts`: 메시지 타입에 `artlook:rendered`·`artlook:render-failed`·`artlook:ready`·`artlook:unsupported` 추가(기존 24 테스트 유지).

### 3-4. 하지 않는 것(v1) — 뒤로 미룬다
작가가 벽·액자를 고르기(v2: `designConfig.wallView`, 규칙 49 `WEB_ONLY_KEYS` 에 추가) · 공유 링크 `?view=wall` · 벽 그림 저장/공유(워터마크 논의와 묶임) · 끌기·확대 · 갤러리 홈페이지 사진 · [작가] 탭 모달 · 실치수 반영(결정 2) · 엔진을 번들로 옮기기.

## 4. 결정이 필요한 것 (구현 전에 답을 받는다)
1. **워터마크** — 벽 보기 그림에 `ArtLink` 워터마크를 찍을까? **추천: 안 찍음.** 작가의 홈페이지 안이고 저장 단추가 없다(저장을 넣게 되면 그때 내보내는 파일에만 찍는다). 엔진 주석 "항상 찍는다"는 ArtLook 탭(유입용 SNS 이미지) 얘기다.
2. **실제 크기** — `sizeText` 대로 걸까(24cm 소품은 벽에서 작게), 늘 보기 좋게 크게 걸까? **추천: 크게**(미미오와 같은 용도 — 작품을 보여 주는 창. 실치수 비교는 ArtLook 탭의 일).
3. **액자** — `canvas-wrap`(자산 0, 옆면 있음) 고정? 얇은 액자(+250KB, 더 빠름)? **추천: canvas-wrap 고정**, 작가 선택은 v2.
4. **기본 모드·미리 그리기** — 열면 사진이 먼저(지금과 같음, 추천) · 벽 보기를 한 번 켠 뒤부터 다음 작품을 미리 그린다.
5. **썸네일 줄** — PC 에서 아래에 작품 썸네일 줄(t240)을 둘까(40점 이하)? **추천: v1 에 넣되 PC 만**(휴대폰은 스와이프).
6. **적용 범위** — 작가 홈페이지 라이트박스만(추천) / [작가] 탭 작품 모달도.

## 5. 작업 묶음 (순서대로 · 묶음마다 `npx tsc -b --noEmit` + 관련 vitest)

### WP1 — 엔진 쪽 (`frontend/public/artlook/`)
- `view.js` 새로 · `index.html` 로더 한 곳 · `drawWatermark` 가드 · `compose()` `state.ssMax` · `scenes.json` view 장면 · `ui.js buildScenes` 의 group 'view' 제외 · 벽 사본 생성 스크립트 + `walls/view/plaster-1400.jpg` · `docs/artlook-asset-provenance.md`.
- 회귀: `artlookScreen.test.ts`(로더 문자열 · view.js 가 localStorage 를 안 읽는지 · group 'view' 가 칩에서 빠지는지 소스 가드) · `artlookScene.test.ts` 영향 확인.
- ⚠️ `scratchpad/vt` 하니스(기준 렌더 10장)는 ui.js 경로 — 돌려서 **픽셀 동일**을 확인한다(워터마크 가드는 기본값이 undefined 라 그대로 찍힌다).

### WP2 — 순수 함수 (`lib/wallView.ts`, `lib/artlook.ts`)
- 비율 판정 · 메시지 읽기/만들기 · 기억 · LRU. 테스트 `wallView.test.ts`(비율 경계값 0.95~1.05 는 1:1 · 이상한 메시지 버림 · 캐시가 넘치면 revoke 콜백 · 저장소 막혀도 던지지 않음) · `artlook.test.ts` 메시지 4종.

### WP3 — 훅 + 라이트박스 화면
- `hooks/useWallRenderer.ts` · `ImageLightbox.tsx` 확장(토글·두 줄 캡션·공유·썸네일 줄·dialog·모서리) · 폴백 문구.
- 디자인: 공모 흐름 화면과 같은 부품 규칙(흑백 + accent 는 현재 토글 표시에만, 단추 40px↑, 글자 12px↑). 토글은 `role="radiogroup"`.

### WP4 — `PortfolioPage` 연결
- `useWallRenderer(ordered)` · 캡션 두 줄 · 공유 주소 · 열릴 때/넘길 때 요청 · 닫을 때 정리.

### WP5 — 검증
- vitest: 위 + `homepageV2.test.ts` 영향(캡션 함수는 그대로).
- E2E 새 `e2e/tests/74-wall-view.spec.ts`(데모 DB, 비회원 시크릿 컨텍스트 · `Navigator.prototype.webdriver=false` 는 **안 바꾼다**(소개 팝업이 안 뜨게)):
  A 열기 → 토글 → `img[data-view=wall]` 의 `src` 가 `blob:` · 캔버스 모서리 픽셀이 **벽 색**(검정 아님) · 작품 영역이 캔버스 안(잘림 0)
  B 벽 모드에서 → 다음 → 벽 유지 · 돌아오면 캐시 재사용(렌더 횟수 `__artlookRenders` 증가 없음)
  C 세로·가로·정사각 작품 각각 비율 4:5/5:4/1:1 (iframe 의 `#preview` 크기로 확인)
  D `/artlook/**` 를 막으면 토글이 사라지거나 안내 한 줄, 사진은 그대로, **페이지 오류 0**
  E 받은 것: 벽 사진 1장(1,400px 사본만) · 액자 사진 0 · 작품 원본 ≤ 1(추가) · `localStorage artlook:works` 없음
  F 휴대폰 뷰포트(390×844): 토글·캡션·닫기가 화면 안, 스와이프로 넘김
  G `?work=` 로 들어와 벽 모드 기억이 있으면 벽으로 열린다
  H 빠르게 10번 넘겨도 마지막 작품의 그림이 뜬다(옛 응답 버림)
- 하니스 `scratchpad/wall-view/walk.mjs`(크롬 + WebKit `~/.cache/wk-deps/run.sh`): 첫 벽 그림까지 시간(초안/완성) · 받은 바이트 · `performance.memory` · 기하(토글·캡션 겹침·가로 넘침) × 화면 6(PC 1280·1440, 아이패드, 픽셀 7, 아이폰 13·SE).
- **실기기** 확인 목록(사용자): 본인 휴대폰(사파리·크롬·카카오 인앱)에서 첫 벽 그림까지 체감 시간, 넘김, 메모리 튕김 없음.

### WP6 — 문서·기억
- `CLAUDE.md` 규칙 74(토글·숨은 iframe·view.js·비율은 작품 방향·rAF 금지·localStorage 안 씀·폴백·워터마크 결정) + 규칙 49/65 참조 한 줄 · `architecture.md` 「라이트박스 벽 보기」 · 메모리 갱신.

## 6. 로컬 확인 순서 (구현 뒤, 배포 전 — 사용자 결정 "로컬에서 먼저")
1. `bash run_web.sh`(데모 DB) + `cd backend && npx tsx scripts/seed-intro-sample.ts`(샘플 작가 윤서진 `/@seojin.yoon`, 데모 그림 9점) — 또는 실서버 복제본으로 실제 작품(세로·가로·정사각·파노라마·치수 없는 작품을 고루).
2. 시크릿 창(비회원) `http://localhost:5173/@seojin.yoon?work=<id>` → [벽에 걸어 보기] → 넘김 → 닫기 → 다시 열기(즉시).
3. 휴대폰: 같은 Wi-Fi 로 `http://<PC IP>:5173/…`(vite `--host`) — 사파리·크롬·카카오 인앱.
4. 미미오 창과 나란히: `ref/mimio-modal-pc.png` ↔ 우리 벽 보기(작품 비중·그림자·캡션 위치).
5. 재는 것: 첫 벽 그림까지(초안/완성) · 받은 바이트 · 메모리 · 작품 모서리 · 넘김 반응 · 소개 팝업과 겹치지 않음(`?intro=1` 로 미리보기 띄운 채 라이트박스).

## 7. 예상 변경 크기
새 파일 5(view.js · wallView.ts · useWallRenderer.ts · wallView.test.ts · 74 스펙) + 수정 7(index.html 로더 3줄 · scenes.json · ui.js 1줄 · ImageLightbox · PortfolioPage · artlook.ts · artlookScreen.test.ts) + 자산 1(벽 사본 ≈300KB) + 문서 3. 서버·DB 변경 없음.
