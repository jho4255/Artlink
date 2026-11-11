# ArtLink 안드로이드 앱 — 구현·검증 계획 (2026-11-09)

> 다른 세션(모델)이 이어서 실행하는 문서다. **순서대로** 하고, 묶음(WP)마다 끝에 적힌 검증을 통과한 뒤 다음으로 간다.
> 먼저 읽을 것: 저장소 `CLAUDE.md`(특히 규칙 23·46·51·64·65), `HANDOFF.md` 0장, 메모리 `mobile-app-android-2026-11`, `plan-approval-is-not-go`, `no-subagents-session-limit`.
> 사용자 규칙: 대답은 한국어 · 서브에이전트 금지 · 커밋/배포는 시키면 · 실서버 DB 는 읽기 전용 · 실서버에 진짜 계정으로 로그인 금지 · E2E 는 로컬 데모 DB(`artlink`)만, 백업 뒤.

## 0. 결정된 것 (사용자, 2026-11-09)

| 항목 | 결정 |
|---|---|
| 방식 | **Capacitor 껍데기** — WebView 가 `https://artlink.cc` 를 그대로 연다(웹 배포 = 앱 갱신). 웹 빌드 번들·RN 재작성 아님 |
| 순서 | **안드로이드 먼저**. iOS 는 Apple Developer(유료, 푸시 필수)·맥 없음 → 계정 나온 뒤 CI(GitHub Actions macOS)→TestFlight |
| 추가 기능 | **푸시 알림**(벨 알림을 기기로). 그 밖의 앱 전용 기능은 없음 |
| 패키지/이름 | `cc.artlink.app` / `ArtLink` — 바꾸지 말 것(스토어·App Links·FCM 이 이 값을 쓴다) |
| 계정 | Google Play·Apple 은 **아직 없음**. 스토어 올릴 때 필요. 회사 명의면 D-U-N-S 번호부터(1~2주) — 사용자가 신청 |
| 미정(사용자에게 물을 것) | ① 푸시 범위 — **추천안(전부)으로 진행**(2026-11-09) ② Firebase 를 artlink.aws@gmail.com 으로 ③ 안드로이드 실기기 유무 ④ 카카오 개발 키의 `http://localhost:5173/auth/kakao/callback` — **등록돼 있음 확인**(앱 안에서 카카오 로그인 화면까지 열림) |

## 1. 환경 (구축 완료 — 다시 만들지 말 것)

- **이 PC 는 Windows 10** → WSL2 에 중첩 가상화(/dev/kvm)가 없어 **에뮬레이터는 윈도우 쪽**, **빌드는 WSL** 이다. WSL 에서 윈도우 실행 파일을 interop 으로 부른다.
- 윈도우 `C:\Android` : `jdk21\` · `Sdk\`(platform-tools · emulator 37 · `system-images;android-35;google_apis_playstore;x86_64`) · AVD **`ArtLink_Pixel7`**(`C:\Users\idye4\.android\avd\`, Android 15, Play 스토어 이미지라 **FCM 푸시가 실제로 온다**, 1080×2400 · 420dpi · RAM 2GB · 키보드 켬).
- WSL : JDK 21 `~/.local/jdk/jdk-21.0.13+9`(apt 는 JRE 뿐이라 따로 받음) · SDK `~/Android/Sdk`(platforms;android-36 · build-tools;36.0.0 · 35.0.0 은 Gradle 이 받음) · Node 22(nvm, **기본값은 20 그대로** — `mobile/.nvmrc`) · 디버그 서명키 `~/.android/debug.keystore`(첫 빌드 때 생성).
- 저장소 `mobile/` : Capacitor **8.6**(`@capacitor/core·cli·android`, typescript) · `capacitor.config.ts`(`server.url` = `ARTLINK_APP_URL` 또는 `https://artlink.cc`, `allowNavigation` = artlink.cc · *.kakao.com · logins.daum.net) · `www/index.html`(연결 중 한 줄 — 원격 모드라 안 쓰임) · `android/`(cap add 산출물, 디버그 APK 빌드 성공 4.1MB) · `scripts/env.sh`(환경 변수) · `scripts/emu.sh`(에뮬레이터 도우미) · `.gitignore`. **전부 미커밋.**
- 환경 변수는 `. mobile/scripts/env.sh` 로만 — `.bashrc` 수정은 권한이 막혀 못 했다(사용자가 원하면 직접 한 줄).
- 네트워크(확인됨): 에뮬레이터 → `10.0.2.2:<port>` → 윈도우 localhost → WSL 릴레이(서버가 127.0.0.1 에 묶여 있어도 됨) · **`adb.exe reverse tcp:5173 tcp:5173`** 로 기기의 `localhost:5173` → WSL vite. 개발은 reverse 방식(브라우저 개발과 origin 이 같아 카카오 redirect URI 도 같다). WSL IP 직접은 안 됨.
- 검증 도구: `emu.sh shot`(스크린샷 → `mobile/.emu-out/`), `emu.sh dump`(uiautomator 접근성 XML — **WebView 안 글자·버튼이 그대로 들어 있다**, 확인됨), `emu.sh tap/text/back`, `emu.sh log`(WebView 콘솔은 logcat `chromium` 태그로 나온다), `emu.sh url`(App Links). Playwright 로 WebView 를 잡는 건 포트 포워딩이 윈도우 127.0.0.1 에만 열려 WSL 에서 못 붙는다 — 쓰지 말고 dump/shot 으로 판정한다.
- ⚠️ 앱으로 **실서버를 열면 [통계] 비회원 둘러보기에 방문이 남는다**(2026-11-09 1건 남김 — 사용자에게 알렸다). 개발·검증은 `emu.sh dev`(localhost:5173)로만. 실서버는 출시 직전 스모크 1회만, 그때도 사용자에게 "1건 남는다"고 먼저 말한다.
- ⚠️ `/tmp` 스크래치는 WSL 재시작에 지워진다 — 하니스·스크린샷은 `mobile/.emu-out/`(git 제외) 또는 저장소 `scratchpad/` 에.
- 에뮬레이터 띄우기: `bash mobile/scripts/emu.sh start`(윈도우 화면에 창이 뜬다). 안 뜨면 `C:\Android\Sdk\emulator\emulator.exe -avd ArtLink_Pixel7` 을 윈도우에서 직접.

## 2. 설계 원칙 (전 단계 공통)

1. **웹 코드에서 '앱 안'을 가르는 곳은 `frontend/src/lib/native.ts` 하나**다. 판정은 `window.Capacitor?.isNativePlatform?.()`(네이티브 브리지가 페이지에 심는 전역). 화면 컴포넌트가 직접 `Capacitor` 를 import 하지 않는다 — 소스 가드 테스트로 막는다(`retiredApis.test.ts` 방식).
2. **서버에서 푸시를 보내는 곳도 하나** — 벨 알림(`Notification`) 행이 생기거나 다시 울릴 때 Prisma 클라이언트 확장(`$extends`)에서 보낸다. 알림을 만드는 15개 파일 34곳은 **건드리지 않는다**(확인: `tx.notification.*` 는 0곳이라 트랜잭션 안 호출 문제가 없다).
3. 앱이 켜진 상태의 벨 갱신·링크 이동은 **기존 웹 코드를 그대로 쓴다**(`['notifications']`·`['unread-count']` invalidate, `navigate(linkUrl)` — Navbar 가 하는 것과 같은 길).
4. 네이티브 플러그인 JS(`@capacitor/*`)는 **앱일 때만 동적 import** — 웹 번들(브라우저 사용자)에 상시 실리지 않게. `@capacitor/core` 의 major 는 `mobile/` 의 네이티브 런타임과 **같아야 한다**(둘 다 8) — 올릴 땐 같이.
5. 확인하고 만들지 않는다(규칙 46) — 토큰 저장은 `upsert`, 삭제는 `deleteMany`. 남의 것은 404(규칙 23).
6. 비밀값(Firebase 서비스 계정 JSON·`google-services.json`·서명키)은 저장소에 넣지 않는다 — `.gitignore` 에 이미 있다. 실서버 값은 Render 환경 변수. `scripts/predeploy-check.sh` 가 2MB 초과·접속정보를 막는다.

## 3. 작업 묶음

### WP1 — 껍데기 다듬기 (앱 쪽 + 웹 소량)

**A. 앱 설정** (`mobile/capacitor.config.ts`, `mobile/android/…`)
- `android.appendUserAgent: 'ArtLinkApp/0.1 (Android)'` — 웹이 UA 로도 앱을 알아본다(ArtLook `ui.js` 의 `IN_APP` 정규식에 `ArtLinkApp` 추가 → 앱에서는 '길게 눌러 저장' 시트가 아니라 네이티브 공유로 간다, 아래 C).
- 플러그인 설치(`mobile/`): `@capacitor/app` `@capacitor/share` `@capacitor/filesystem` `@capacitor/status-bar` `@capacitor/splash-screen` `@capacitor/push-notifications`(WP3 에서 씀, 지금 넣어도 됨). 설치 뒤 `npx cap sync android`.
- 아이콘·스플래시: `npx @capacitor/assets generate --android` — 원본은 `frontend/public/icons/icon-512x512.png`(PWA 와 같은 그림), 스플래시 배경 흰색. 적응형 아이콘 전경 여백 확인.
- 상태바: 흰 배경·어두운 아이콘(웹 상단바가 흰색). `StatusBar.setStyle({ style: Light })` 는 웹 `native.ts` 에서 앱 시작 때 한 번.
- **뒤로가기**: `App.addListener('backButton', ({canGoBack}) => canGoBack ? window.history.back() : App.exitApp())` — 웹 `native.ts` 에서. 모달이 떠 있을 때는 웹의 ESC 처리와 같게 모달만 닫히는지 확인(공모 지원 모달·ConfirmDialog·소개 팝업).
- **새 창 링크**(`window.open`·`target="_blank"` 17곳 + 약관·`/uploads/` 파일): Capacitor Android 가 어떻게 여는지 **실측**한다 — 우리 호스트면 같은 WebView 에서 열리게(뒤로가기로 돌아올 수 있게), 바깥 사이트(인스타그램 등)는 기기 브라우저로. 기본 동작이 다르면 `native.ts` 가 `window.open` 을 감싸 `Browser`/`window.location` 으로 가른다(`lib/siteLink.ts openSiteLink` 가 이미 우리/바깥을 가르는 함수 — 거기에 앱 분기 한 줄이 맞는 자리인지 먼저 본다).
- 파일 올리기(`<input type=file>` — 작품 사진·프로필·첨부·채팅): Capacitor 가 파일 선택기·카메라를 연다. 권한 선언 `AndroidManifest.xml`(CAMERA 는 선택기에서 카메라를 고를 때만). 실측으로 사진 1장·여러 장·카메라 확인.

**B. App Links** (카카오톡 복귀·푸시·공유 링크가 앱으로 열리게)
- 백엔드: `GET /.well-known/assetlinks.json` — `backend/src/index.ts` 의 SPA 폴백 **앞**에, `Content-Type: application/json`, `Cache-Control: no-cache`. 내용은 환경 변수 `ANDROID_CERT_SHA256`(쉼표 구분 — 디버그 키 + 나중에 출시 키)에서 만든다(`backend/src/lib/assetLinks.ts`, 값이 없으면 404). 디버그 키 지문: `keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android | grep SHA256`.
- 앱: `AndroidManifest.xml` 의 MainActivity 에 `<intent-filter android:autoVerify="true">` — `https` `artlink.cc`(및 `www.artlink.cc`) · `pathPrefix` 는 `/`(전부). 단 **파일 주소(`/uploads/`·`/terms/`·`/artlook/`)는 앱이 받아도 WebView 가 그대로 열므로 괜찮다.**
- 웹 `native.ts`: `App.addListener('appUrlOpen', ({url}) => navigate(pathname+search+hash))` + 시작 때 `App.getLaunchUrl()`. 라우터 밖이라 `window.history.pushState` + `popstate` 로 알리거나, `App.tsx` 안의 훅(`useNativeBridge`)에서 `useNavigate` 를 쓴다(권장 — `useVisitBeacon`·`useGuestActivity` 옆).
- ⚠️ 실서버에 `assetlinks.json` 이 올라가기 전엔 자동 검증이 안 된다 — 에뮬레이터에서는 `adb shell pm set-app-links --package cc.artlink.app 2 artlink.cc`(수동 승인)로 먼저 확인하고, 배포 뒤 `adb shell pm get-app-links cc.artlink.app` 으로 `verified` 를 본다.

**C. 웹 `frontend/src/lib/native.ts`** (앱 전용 분기 한 곳)
- `isNativeApp()` · `useNativeBridge()`(App.tsx 에 한 번: 상태바·뒤로가기·appUrlOpen·푸시 리스너(WP4)) · `saveFileNative(blob, name, mime)`(Filesystem 에 캐시로 쓰고 `Share.share({files:[uri]})` — 공유 창에서 '파일에 저장'·카톡·인스타로 보냄).
- 갈아끼울 곳(전수 — `grep -rn "a\.download\|triggerDownload\|saveBlob\|navigator\.share" frontend/src frontend/public/artlook`): `lib/operationPdf.ts triggerDownload`(정산 PDF·캡션·ZIP 전부 이걸 탄다) · `lib/portfolioExport.ts saveBlob` · `pages/OperationPage.tsx:1025`·`OperationClassicPage.tsx:571`(CSV) · `components/shared/ArtworkViewer.tsx`(공유 = 주소 공유라 `Share.share({url})`) · ArtLook `ui.js` 저장(iframe → 부모로 `artlook:save {blob,name}` postMessage, `ArtLookSection` 이 `saveFileNative`; 새 탭 ArtLook(판매작 홍보)은 앱에서는 같은 WebView 라 부모가 없다 → `window.Capacitor` 가 iframe 에도 있는지 실측해 있으면 ui.js 가 직접, 없으면 postMessage). 브라우저(웹)에서는 **한 줄도 바뀌지 않는다**(앱 분기만 추가).
- 홈페이지 PDF 뷰어(`PdfViewer`)·이미지 라이트박스는 그대로(WebView 가 그린다).
- 비회원 통계(`lib/guestActivity.ts`): 앱 방문도 비회원 방문이다 — 그대로 센다. (앱/웹 구분이 필요해지면 UA 의 `ArtLinkApp` 으로 서버에서 가른다 — 지금은 안 한다.)

**D. 카카오 로그인 확인** (코드 변경은 필요할 때만)
- 경로 ①: 웹 로그인 → `kauth.kakao.com`(WebView 안, allowNavigation) → 카카오계정 로그인 → `/auth/kakao/callback` 같은 WebView. 그대로 돼야 한다.
- 경로 ②: 카카오 페이지의 **[카카오톡으로 로그인]** → `kakaotalk://`/`intent://` → 카카오톡 앱 → 인증 → 카카오톡이 redirect_uri(`https://artlink.cc/auth/kakao/callback?code=…`)를 연다 → **App Links 가 있으면 우리 앱**, 없으면 기기 브라우저(= 규칙 64 의 '다른 탭' 상황 — state 가 localStorage 에도 있어 통과하지만 로그인이 브라우저에 남는다). WebView 가 `kakaotalk://` 를 못 열면 Capacitor 가 'ERR_UNKNOWN_URL_SCHEME' 를 낸다 → `MainActivity` 의 WebViewClient 에서 `intent://`·`kakaotalk://` 를 `startActivity` 로 넘기는 코드를 넣는다(Capacitor 는 기본으로 `allowNavigation` 밖 스킴을 외부로 보내려 시도한다 — 먼저 실측).
- 에뮬레이터엔 카카오톡이 없다 → Play 이미지라 **Play 스토어에서 카카오톡을 설치**하면 경로 ② 도 에뮬레이터에서 볼 수 있다(구글 계정 로그인 필요 — 사용자 계정으로는 하지 말고 테스트용). 안 되면 실기기.
- 로컬 확인은 `emu.sh dev`(localhost:5173) + 카카오 **개발용** 앱 키(`frontend/.env` 의 `VITE_KAKAO_CLIENT_ID`) — redirect URI `http://localhost:5173/auth/kakao/callback` 등록 여부를 사용자에게 확인(미정 ④). 실서버 계정으로 로그인하지 않는다.

**WP1 검증**
- 자동: `frontend` vitest 전체 + 새 `native.test.ts`(앱 아님이면 아무것도 안 함 · 앱이면 저장 경로가 네이티브 · 소스 가드: `Capacitor` import 는 `lib/native.ts` 뿐 · `IN_APP` 에 `ArtLinkApp`) · `backend` `asset-links.test.ts`(환경 변수 없으면 404 · 있으면 지문 N개 · JSON 타입 · SPA 폴백보다 먼저) · 두 쪽 `npm run build`.
- 에뮬레이터(로컬 서버 `emu.sh dev`, 데모 DB · 계정은 개발자 로그인):  
  ① 홈이 뜬다(dump 에 '홈·작가·갤러리…' 탭) ② 뒤로가기: 갤러리 → 홈 → 한 번 더 = 앱 종료(`dumpsys activity top` 에 MainActivity 없음) ③ 모달 위에서 뒤로가기 = 모달만 닫힘 ④ 로그인(개발자 로그인) → 알림 벨 → 알림 누르면 그 화면 ⑤ 사진 올리기(작품 1장·3장) ⑥ 포트폴리오 PDF 저장 → 공유 창(dump 에 안드로이드 공유 시트) ⑦ ArtLook 저장 → 공유 창 ⑧ 정산 CSV/PDF → 공유 창 ⑨ 인스타 링크 → 기기 브라우저(`dumpsys activity top` 이 chrome) ⑩ 약관(`/terms/…`) 열림·돌아옴 ⑪ `emu.sh url https://artlink.cc/support?inquiry=1` → 앱이 받아 그 화면(`set-app-links` 수동 승인 뒤) ⑫ 카카오 경로 ①(가능하면 ②) ⑬ 화면 회전·키보드 올라올 때 하단 탭바·저장 바가 가려지지 않음(shot) ⑭ 앱 콘솔(`emu.sh log`)에 빨간 에러 0.
- 통과 기준: 위 14개 전부. 스크린샷은 `mobile/.emu-out/wp1-*.png` 로 남기고 보고에 경로를 적는다.

### WP2 — 푸시 서버 (`backend/`)

- 스키마(`prisma/schema.prisma` + 마이그레이션 `20261110120000_push_token`):
  ```prisma
  model PushToken {
    id         Int      @id @default(autoincrement())
    token      String   @unique
    userId     Int
    user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
    platform   String   // 'android' | 'ios'
    createdAt  DateTime @default(now())
    lastSeenAt DateTime @default(now())
    @@index([userId])
  }
  ```
  `User` 에 `pushTokens PushToken[]`. 테스트 `helpers.ts` 의 `ALL_TABLES` 에 `'PushToken'`(정수 PK 라 시퀀스 있음).
- 라우트 `routes/push.ts` → `app.use('/api/push', …)`: `PUT /tokens {token, platform}`(authenticate · `upsert` — 같은 기기를 다른 사람이 쓰면 userId 가 바뀐다 · `lastSeenAt` 갱신 · 200) · `DELETE /tokens {token}`(authenticate · `deleteMany({token, userId: me})` · 없어도 200). 토큰 형식 검사(문자열 20~4096). 전역 한도 안(앱 켤 때 한 번).
- `lib/push.ts`: `isPushEnabled()`(= `FIREBASE_SERVICE_ACCOUNT` 있음 && `PUSH !== 'off'`) · `sendPushToUsers(userIds, {title, body, linkUrl, notificationId})` — 토큰 조회 → `firebase-admin` `getMessaging().sendEachForMulticast({tokens, notification:{title, body}, data:{linkUrl, notificationId}, android:{priority:'high', notification:{channelId:'artlink', clickAction:…없음}}})`(500개씩 끊기) → 응답의 `messaging/registration-token-not-registered`·`invalid-registration-token`·`invalid-argument` 토큰은 `deleteMany`. 실패는 `logger.warn`, **절대 던지지 않는다**. `firebase-admin` 은 `FIREBASE_SERVICE_ACCOUNT`(JSON 문자열 또는 base64)로 `initializeApp` 한 번(lazy).
- **fan-out = `lib/prisma.ts` 의 `$extends({ query: { notification: { create, createMany, update } } })`**:
  - `create` → 결과 행으로 push(`title` = 'ArtLink', `body` = message, `linkUrl`).
  - `createMany` → `args.data`(배열)로 같은 message 끼리 묶어 userIds 로 push(관리자 전원 새 문의 같은 경우).
  - `update` → `args.data.message` 가 있을 때만(= 다시 울리는 경우: 채팅 `lib/chat.ts:131`, 대신 입력 `operation.ts:548`, 좋아요 `explore.ts:60`), 결과 행의 `type` 이 `REPUSH_TYPES`(`CHAT_MESSAGE`·`SUBMISSION_PROXY_EDIT`)일 때만 — **좋아요 합산(`ARTWORK_LIKE`)은 다시 보내지 않는다**(좋아요마다 울리면 잔소리). 읽음 처리(`data.read`)는 message 가 없어 안 걸린다.
  - 보내기는 `setImmediate` 로 떼어 놓고(응답을 안 기다리게) 예외는 삼킨다. 테스트는 `sendPushToUsers` 를 `vi.spyOn` 하고 `await vi.waitFor(...)`.
  - `$extends` 는 새 클라이언트를 돌려준다 — `prisma` 의 타입을 `ReturnType<typeof build>` 로 바꾸고 `globalForPrisma` 도 같은 타입. `$on('query')` 로깅은 확장 **전** 원본에 건다. `$transaction`·`testPrisma` 가 그대로 도는지 백엔드 전체 테스트로 확인.
- 설정: `backend/.env.example` 에 `FIREBASE_SERVICE_ACCOUNT=`·`PUSH=`·`ANDROID_CERT_SHA256=` 설명. 테스트 `setup.ts` 에서 `FIREBASE_SERVICE_ACCOUNT` 를 비운다(메일 SMTP 와 같은 방식 — 테스트가 진짜로 보내지 않게).
- 알림 켜고 끄기 설정(사용자별)은 **2차** — 지금은 '전부'(미정 ①이 '일부' 면 `PUSH_TYPES` 화이트리스트 상수 하나로 가른다).

**WP2 검증**
- 새 테스트 `backend/src/__tests__/push.test.ts`: 토큰 등록(201/200·upsert·다른 사람이 같은 토큰 → userId 이전) · 삭제(내 것만·없어도 200) · 비로그인 401 · `inquiry` 작성 → 관리자 전원 userIds 로 `sendPushToUsers` 호출(`createMany` 경로) · 답변 → 작성자(`create` 경로) · 채팅 두 번째 메시지 → 다시 호출(`update` 경로) · 좋아요 합산 갱신 → 호출 **안 함** · 읽음 처리 → 호출 안 함 · `firebase-admin` 모킹으로 not-registered 토큰이 지워짐 · `PUSH=off` 면 아무것도 안 보냄 · 설정 없으면 조용히 통과.
- `cd backend && npm test` 전체(약 7분 — `timeout` 걸지 말 것, 백그라운드로) — 1669 + 새 것 전부 통과. `npm run build`.
- `notify-links.test.ts`·`inquiry.test.ts` 가 그대로 통과(알림 생성 코드를 안 건드렸다는 증거).

### WP3 — 푸시 웹 (`frontend/src/lib/native.ts` 확장)

- 앱이고 로그인돼 있으면(`useAuthStore` 구독): `PushNotifications.requestPermissions()`(Android 13+ 시스템 창 — **로그인 직후**에 묻는다, 앱 첫 화면에서 묻지 않는다) → `register()` → `'registration'` 이벤트의 토큰을 `PUT /push/tokens {token, platform:'android'}` + `localStorage artlink-push-token`. 토큰 갱신 이벤트도 같은 길.
- 로그아웃(`authStore.logout`) 때 `DELETE /push/tokens` best-effort(401 이어도 무시) — `logout` 안에서 `native.ts` 의 `onLogout()` 을 부른다(`clearArtLookWorks()` 옆).
- `'pushNotificationReceived'`(앱이 켜진 채 수신): `queryClient.invalidateQueries(['notifications'])`·`['unread-count']`·`['chat-unread']`(채팅이면). 시스템 알림은 안드로이드가 띄운다(앱 전면이면 기본으로 안 띄움 — `PushNotifications` 의 `presentationOptions` 는 iOS 용).
- `'pushNotificationActionPerformed'`(알림 탭): `data.linkUrl` 로 `navigate`. 앱이 꺼져 있다 열린 경우도 같은 이벤트로 온다(리스너를 **최대한 일찍** — `useNativeBridge` 마운트 때).
- 알림 채널: `PushNotifications.createChannel({id:'artlink', name:'ArtLink 알림', importance:4})` 한 번(안드로이드 8+).
- 벨 아이콘: `android/app/src/main/res/drawable/ic_stat_artlink.png`(흰색 단색 실루엣 — 컬러 아이콘은 회색 네모로 나온다) + `AndroidManifest.xml` 의 `com.google.firebase.messaging.default_notification_icon`·`default_notification_color`(#c4302b).
- 소개 팝업(규칙 73)·홈페이지 완성 팝업(규칙 51)과 권한 창이 겹치지 않게 — 권한은 로그인 직후 한 번, 거절하면 다시 묻지 않는다(`localStorage artlink-push-asked`).

**WP3 검증**
- `frontend/src/__tests__/native.test.ts` 확장: 가짜 `window.Capacitor` + 가짜 플러그인으로 — 로그인 → 권한 → register → PUT 호출 · 로그아웃 → DELETE · 수신 → invalidate 키 셋 · 탭 → navigate(linkUrl) · 웹(브라우저)에서는 어느 것도 호출되지 않는다 · 소스 가드(화면 컴포넌트에 `@capacitor` import 없음).
- `frontend` vitest 전체 + `npm run build` + lint(기존 6개 경고 외 새 경고 0).
- E2E(선택, 로컬 데모 DB): `e2e/tests/79-native-bridge.spec.ts` — `addInitScript` 로 가짜 `window.Capacitor` 를 심고 로그인하면 `PUT /api/push/tokens` 가 한 번 나가고 로그아웃에 DELETE 가 나가는지(요청 가로채기). 실행은 CLAUDE.md 의 E2E 절차대로(백업 → 데모 DB → 복원).
- **에뮬레이터 실측(핵심)** — Firebase 가 연결된 뒤(WP4): `emu.sh dev` 로 로컬 서버(백엔드 `.env` 에 `FIREBASE_SERVICE_ACCOUNT` 넣고 재시작) · 앱에서 작가(개발자 로그인)로 로그인 → 권한 허용 → DB 의 `PushToken` 1행 · 다른 브라우저(PC 크롬)에서 관리자로 그 작가의 문의에 답변 → **에뮬레이터 상단에 알림**(`dump` 에 알림 글자 또는 `adb shell dumpsys notification --noredact | grep artlink`) → 알림 탭 → 앱이 그 문의가 펼쳐진 고객센터로 · 앱을 완전히 끈 상태(`am force-stop`)에서도 알림이 오고 탭하면 그 화면 · 로그아웃 → 행 삭제 → 더는 안 옴 · 채팅 2통 = 알림 2번, 좋아요 2번 = 알림 1번.
- 통과 기준: 위 실측 전부 + 자동 테스트 전부.

### WP4 — Firebase 연결 (사용자 + 모델)

사용자가 할 것(브라우저, 모델은 콘솔에 못 들어간다 — 단계마다 안내문을 써 준다):
1. https://console.firebase.google.com → 프로젝트 만들기(이름 `artlink`, 애널리틱스 끔) — 계정은 미정 ②.
2. 안드로이드 앱 추가: 패키지 `cc.artlink.app`, 디버그 SHA-1(모델이 `keytool` 로 뽑아 준다) → `google-services.json` 내려받기 → **`mobile/android/app/google-services.json`** 에 둔다(git 제외됨).
3. 프로젝트 설정 → 서비스 계정 → 새 비공개 키 → JSON. **저장소에 넣지 않는다.** 로컬은 `backend/.env` 의 `FIREBASE_SERVICE_ACCOUNT='<JSON 한 줄>'`, 실서버는 Render 환경 변수(배포 때).
4. Cloud Messaging API(V1)가 켜져 있는지(기본 켜짐).

모델이 할 것: `mobile/android/app/build.gradle` 에 google-services 플러그인이 자동 적용되는지 확인(Capacitor 템플릿은 `google-services.json` 이 있으면 적용한다) · `npx cap sync` · 빌드 · WP3 실측. Firebase 콘솔의 [테스트 메시지 보내기]로 토큰 하나에 먼저 쏴 보고(서버 코드와 무관한 1차 확인), 그다음 서버 경로.

### WP5 — 문서·회귀 가드 (코드와 같은 커밋)

- `CLAUDE.md` 규칙 **79 「안드로이드 앱(Capacitor 껍데기)·푸시」** — 결정(실서버 그대로·앱 분기는 native.ts 한 곳·푸시는 Prisma 확장 한 곳·REPUSH 규칙·실서버 열면 통계에 남음·에뮬레이터는 윈도우 쪽) + 테스트 수 갱신 + 「Deployment」에 Render 환경 변수 3개(`FIREBASE_SERVICE_ACCOUNT`·`PUSH`·`ANDROID_CERT_SHA256`).
- `architecture.md` 「모바일 앱」절(구조 그림: 앱 ↔ artlink.cc ↔ FCM) · `HANDOFF.md` 0장에 한 줄 + 환경 복구 방법(`mobile/PLAN.md` §1 가리키기).
- `mobile/README.md`(짧게: 띄우기·dev/prod·빌드·검증 도구 — 이 문서 §1 요약).
- 개인정보처리방침 1항에 '앱 알림을 위한 기기 토큰(로그아웃·앱 삭제 시 삭제)' 추가(`TermsBody`/`PrivacyBody` 컴포넌트 — 가입 약관과 같은 원문이라 한 곳).
- 메모리 `mobile-app-android-2026-11` 갱신(어디까지 됐는지).

### WP6 — 출시 준비 (Google Play 계정이 나온 뒤)

- 서명키: `keytool -genkeypair` 로 `~/artlink-keys/artlink-release.jks`(저장소 밖 · `~/artlink-backups/` 에도 사본 · 비밀번호는 사용자에게) · `android/keystore.properties`(git 제외) · `app/build.gradle` 의 `signingConfigs.release`.
- `ANDROID_CERT_SHA256` 에 출시 키 지문 추가(Play 앱 서명을 쓰면 **Play 콘솔의 '앱 서명 키' 지문**이 들어가야 한다 — 업로드 키가 아니다).
- `./gradlew bundleRelease` → `.aab` · 버전은 `versionCode` 자동 증가 스크립트.
- Play Console: 내부 테스트(사용자 폰) → 비공개 → 프로덕션. 데이터 안전 섹션(기기 토큰·방문 통계·업로드 파일), 개인정보처리방침 URL(`https://artlink.cc/privacy`), 스크린샷(에뮬레이터 `emu.sh shot` 1080×2400 그대로 됨), 아이콘 512, 그래픽 1024×500.
- 출시 전 **실서버 스모크 1회**(비회원 홈·공고·고객센터, 로그인 없음 — 통계에 1건 남는다고 먼저 알림) + 사용자 폰에 설치해 본인 계정으로 알림 1건 확인(사용자가 직접).
- 선택: GitHub Actions `android-debug.yml`(푸시마다 디버그 APK 아티팩트 — google-services.json 은 secret).

## 4. 검증 총괄 (끝내기 전에 전부)

| 종류 | 무엇 | 기준 |
|---|---|---|
| 백엔드 vitest | 기존 전부 + `push.test.ts`·`asset-links.test.ts` | 전부 통과, `npm run build` |
| 프론트 vitest | 기존 전부 + `native.test.ts` | 전부 통과, `npm run build`, lint 새 경고 0 |
| E2E | `79-native-bridge`(선택) + 영향 받은 스펙(`78`·알림 관련) | 기준선 밖 실패 0 |
| 에뮬레이터 | WP1 ⑭·WP3 실측 체크리스트 | 전부 통과, 스크린샷 `mobile/.emu-out/` |
| 실기기(있으면) | 카카오톡 전환 로그인 · 푸시 수신 · 사진 올리기(카메라) | 통과 |
| 실서버 영향 | 개발 중 실서버 열지 않음 | 통계 오염 0(스모크 1회 제외, 사전 고지) |
| 브라우저(웹) 회귀 | 앱 분기가 브라우저 동작을 바꾸지 않음 | `native.test.ts` 웹 케이스 + 기존 E2E |

## 5. 알려진 위험·함정

- Android WebView 에는 `navigator.share` 가 없을 수 있다(ArtLook 저장이 그걸 먼저 본다) → 앱이면 무조건 네이티브 공유로(WP1-C). 실측으로 확정할 것.
- 원격 URL 모드에서 플러그인은 브리지가 페이지에 주입되어 동작한다 — **iframe(ArtLook) 안에서도 되는지는 실측**. 안 되면 postMessage 로 부모가 한다.
- `$extends` 로 `prisma` 타입이 바뀌어 `as any` 가 많은 라우트는 괜찮지만 `testPrisma`·`seed.ts` 가 `PrismaClient` 타입을 직접 요구하면 거기만 손본다.
- Play 이미지의 WebView 는 124 로 오래됐다(실기기는 최신). Play 스토어 업데이트로 올라간다 — 화면이 이상하면 WebView 버전부터 본다(`adb shell dumpsys webviewupdate`).
- 에뮬레이터 → Kakao 앱 전환은 카카오톡 설치가 필요. Play 스토어 로그인에 사용자 개인 구글 계정을 쓰지 않는다.
- Apple 심사(4.2 웹 껍데기 거절)는 iOS 단계의 위험 — 안드로이드엔 없다.
- `.bashrc`·전역 설정 변경은 권한이 막힌다 — 환경은 저장소 스크립트로.

## 6. 진행 기록 (이어서 하는 세션이 여기에 적는다)

- 2026-11-09: 환경 구축 · `mobile/` 스켈레톤(실서버 그대로 띄움, 에뮬레이터에서 홈·Welcome 팝업 확인) · 이 계획. **미커밋.** 다음: 사용자 답(미정 ①~④) → WP1.
- 2026-11-09 (같은 날, "계획세운대로 개발드가자"): **WP1·WP2·WP3·WP5 구현 완료, 미커밋·미배포**(사용자: "앱은 바로 배포할 게 아니라 커밋 보류"). 미정 ①은 추천안(벨 알림 전부 — 바꾸려면 `lib/push.ts` 의 판정 한 곳). ②·③은 아직 답 없음.
  - 자동 검증: backend 전체 **1689 통과**(새 `push.test.ts` 16 · `asset-links.test.ts` 4) · frontend 전체 **1438 통과**(새 `native.test.ts` 28 — 일부러 망가뜨려 잡히는지 확인) · 두 쪽 build · 린트(바꾼 파일 HEAD 와 같은 수)
    · E2E — 바뀐 웹 경로에 닿는 기존 스펙 17개 **156 통과 · 1 건너뜀 · 실패 0**(12.1분: 00·05·24·26·27·28·30·34·52·54·56·64·65·69·72·73·74). 데모 DB 는 실행 전 백업(`~/artlink-backups/artlink-before-mobile-20261109-2319.dump`, PushToken 마이그레이션 적용 뒤)으로 되돌렸다.
    · 개인정보처리방침: 1항(앱 알림 기기 토큰) · 3항(보관) · 4항(Firebase Cloud Messaging 위탁) — 최종 수정일을 2026-11-09 로 해 뒀으니 **배포하는 날로 고칠 것**.
  - 에뮬레이터(로컬 서버, `emu.sh dev`) 체크리스트 — ①홈 ✓ ②뒤로가기 갤러리→홈→앱 내림·다시 열면 그대로 ✓ ③창 위 뒤로가기 = 창만(소개 팝업·작품 정보·사진 크게 보기) ✓
    ④개발자 로그인 → 벨 → 답변 알림 → 그 문의 펼친 고객센터 ✓ ⑤사진 선택기로 3장 올리기 ✓ ⑥포트폴리오 PDF → 공유 창(기기에서 꺼낸 6.7MB·23쪽 온전) ✓ ⑦ArtLook → 공유 창(1080² PNG 온전) ✓
    ⑧정산·캡션은 같은 triggerDownload(⑥으로 확인) ⑨인스타 링크 → 크롬 ✓ ⑩파일 주소 → 시스템 '열기'(Drive PDF 뷰어·크롬), 앱 화면 그대로 ✓ ⑪앱 링크 켜진 채·꺼진 채 ✓, 목록 밖 경로 안 받음 ✓
    ⑫카카오 로그인 화면이 앱 안에서 열림·뒤로가기로 돌아옴 ✓(실제 계정 로그인·카카오톡 앱 전환은 못 봄) ⑬키보드가 입력칸을 안 가림 ✓ ⑭우리 코드 콘솔 오류 0(Capacitor 디버그 로그만).
  - **계획과 달라진 것**(이유는 코드 주석·규칙 79):
    · 푸시 갈고리를 `$extends` 가 아니라 `$use` 미들웨어 한 번 + `setNotificationHook` 자리로 — 타입이 안 바뀌고, 테스트가 클라이언트를 globalThis 로 같이 써도 옛 모듈이 쌓이지 않는다.
    · `@capacitor/status-bar` 는 안 넣었다 — Capacitor 8 코어의 SystemBars 로 된다(설정 한 줄 + 밝은 테마 고정).
    · 앱 전용 Java 플러그인 `ArtLinkShell` 추가 — `register()` 가 Firebase 설정 없는 앱에서 **앱을 죽이므로** `info().push` 로 먼저 묻는다 · `intent://` · WebView 내려받기 넘기기.
    · `allowNavigation` 을 카카오 로그인 3곳으로 좁혔다(넣은 주소는 앱의 네이티브 통로까지 받는다) · App Links 는 '내용' 화면 경로만(`/auth` 를 받으면 크롬의 카카오 로그인이 끊긴다).
    · `DELETE /push/tokens` 는 인증 없이(토큰이 자격) — 만료로 자동 로그아웃될 때도 지워져야 한다.
    · E2E `79-native-bridge` 는 만들지 않았다 — 브라우저에 가짜 브리지를 꽂으면 가짜를 시험하게 된다. 단위(모듈 가짜)·에뮬레이터(진짜)로 나눠 봤다. 대신 바뀐 웹 경로에 닿는 기존 E2E 17개를 돌렸다(위).
    · 오류 화면(`www/offline.html` + `scripts/post-sync.mjs`) · 지난 내보내기 파일은 한 시간 지난 것만 지우기 · 모달 셋에 `role="dialog"` — 계획에 없던 작은 추가.
  - **에뮬레이터에서 찾아 고친 결함 셋**: ①플러그인 Proxy 를 Promise 로 돌려줘 `then()` 이 네이티브로 감(푸시 등록이 늘 실패) ②ArtLook iframe 에서 부른 플러그인을 Capacitor 가 버림(눌러도 아무 일 없음) ③새로고침이 공유 중인 파일을 지울 수 있었음. 셋 다 회귀 테스트로 고정.
  - **남은 것**: WP4(Firebase — 사용자가 콘솔에서) → FCM 실제 수신(체크리스트 WP3) · 카카오톡 앱 전환 로그인(카카오톡 깔린 기기) · 실서버 App Links 검증(배포 + `ANDROID_CERT_SHA256`) · WP6 출시.
  - **관찰(고칠지 사용자에게)**: ㉠ 키보드가 올라오면 하단 탭바가 키보드 위에 붙어 입력 공간이 57px 준다(휴대폰 크롬은 키보드 뒤로 숨는다) ㉡ 공유 창의 '파일에 저장' 항목은 기기마다 다르다(이 에뮬레이터엔 없음 — Drive·인쇄만)
    ㉢ 웹사이트 자체의 PWA 아이콘 `/icons/icon-*.png` 가 저장소에 없고(실서버는 HTML 을 돌려준다) 탭 아이콘이 Vite 기본 로고 — 앱 아이콘과 같은 그림으로 맞출 수 있다.
  - 디버그 서명 키 SHA-256(이 PC `~/.android/debug.keystore`): `69:29:3F:44:1B:E2:15:D1:9C:3E:11:F6:3D:5D:E1:F6:18:D8:BC:8A:2C:1A:A5:7A:97:F2:3F:2C:4B:E3:AC:98` — 디버그 빌드로 실서버 앱 링크를 시험할 때만 `ANDROID_CERT_SHA256` 에.
- 2026-11-11: **WP4(Firebase) 연결 · FCM 실제 수신 검증 완료**, 여전히 미커밋.
  - 사용자가 Firebase 프로젝트 `artlink-56a2b` 를 만들고 파일 둘을 `~/firebase/`(저장소 밖, 권한 600)에 뒀다. `google-services.json` 은 `mobile/android/app/` 로 복사(무시 목록에 있음),
    서비스 계정은 base64 로 `backend/.env` 의 `FIREBASE_SERVICE_ACCOUNT` 에만(값을 화면·문서에 찍지 않았다). 인증 확인: access token 발급 OK, 가짜 토큰 dry-run → `invalid-argument`(= API 까지 닿음).
  - 에뮬레이터 실측(로컬 서버, Artist 1): 로그인 직후 알림 허용 창 → `PushToken` 1행 ✓ · 앱을 보는 중 → 시스템 알림 없이 벨 숫자 갱신(`pushNotificationReceived`) ✓ ·
    홈으로 내린 채 → 상단 알림(채널 artlink, 붉은 아이콘, 제목 ArtLink) → 누르면 그 문의를 펼친 고객센터 · 알림 읽음 ✓ · 프로세스를 죽인 채(`am kill`) → 알림 → 누르면 앱이 켜지며 그 문의 ✓ ·
    대화 2통 = 2번 울림, 서랍엔 한 칸(tag `chat:<id>`)에 마지막 말 · 누르면 그 방(`/messages?chat=`) ✓ · 좋아요 두 사람 = 1번만 울림(벨엔 '외 1명') ✓ · 로그아웃 → 토큰 행 삭제 → 그 뒤 답변 알림 안 옴 ✓.
    ⚠️ 설정에서 **'강제 중지'** 한 앱은 다시 열 때까지 FCM 이 오지 않는다(안드로이드 규칙) — 시험할 때 `am force-stop` 말고 `am kill`(백그라운드에서).
  - **에뮬레이터에서 찾아 고친 결함 둘**:
    ①꺼진 앱을 알림으로 켜면 그 방문이 '하루 첫 방문'이라 **소개 팝업(규칙 73)이 그 문의를 덮었다** → `frontend/src/lib/popupHold.ts`: 알림이 데려간 화면에 있는 동안 소개·홈페이지 팝업(51)을 기다리게, 떠나면 원래대로(답한 것으로 적지 않는다).
    ②문의 제목이 상단바 뒤로 숨었다(0~68px) — 크롬 124 WebView 는 **overflow:hidden 요소의 scroll-margin-top 을 무시**한다(같은 여백의 평범한 div 는 지킨다, 실측) → `lib/scrollToTarget.ts` 로 여백을 직접 계산(고객센터 문의 · 관리자 주최 공모 딥링크 두 곳). 최신 크롬은 원래 맞았다(96px, 바뀐 뒤에도 같음).
  - 자동 검증: frontend 전체 **1451 통과**(새 `popupHold.test.ts` 10 · `scrollToTarget.test.ts` 3) · build · 린트(바꾼 파일 HEAD 와 같은 수) · E2E 61·63·73·78 **43 통과**
    (78 C 는 고치기 전에도 실패할 테스트 쪽 문제 — 관리자 목록의 [답변완료] 버튼을 이름 일부로 찾아 답변 달린 문의 줄까지 잡혔다 → `exact: true`). 데모 DB 는 다시 11-09 백업으로.
  - **남은 것**: Render 에 `FIREBASE_SERVICE_ACCOUNT`(웹 배포 때 — 같은 키 파일을 base64 로) · 카카오톡 앱 전환 로그인(실기기) · 실서버 App Links(배포 + `ANDROID_CERT_SHA256`) · WP6 출시 · 개인정보처리방침 날짜.
  - 관찰: 알림 제목이 늘 'ArtLink' 라 서랍 머리의 앱 이름과 겹친다(종류별 제목 — '문의 답변'·'새 메시지' — 으로 바꿀 수 있다) · 좋아요가 합쳐지면 서랍 글은 첫 사람 그대로(다시 울리지 않게 한 대가, 벨은 갱신).
- 2026-11-11 (오후, 사용자가 에뮬레이터에서 카카오 로그인을 해 봄 → '다시 시도'만 뜸):
  - 처음엔 확인을 마치고 꺼 둔 개발 서버 탓(돌아올 주소 localhost:5173 이 꺼져 있었다). 서버를 켜도 같았다 — CDP 로 보니 **`kauth.kakao.com/oauth/authorize` 가 400**,
    카카오 화면은 **KOE006(등록되지 않은 Redirect URI)**. 개발 앱의 돌아올 주소 `http://localhost:5173/auth/kakao/callback` 이 카카오 앱에 없다(PC 로컬 웹도 같다). 실서버 앱은 해당 없음.
  - 그 400 을 Capacitor 가 **어느 사이트든** 오류 화면(offline.html)으로 바꿔 카카오의 안내가 가려졌다 → `ArtLinkShellPlugin` 이 WebViewClient 를 바꿔 바깥 사이트의 HTTP 오류는 그대로 보인다(우리 서버 오류만 오류 화면).
    재빌드 뒤 KOE006 안내 페이지가 그대로 보이는 것 확인.
  - 알림 제목을 종류별로(사용자: "니 말대로"): 문의 답변 · 1:1 문의 · ArtTalk(대화 — 본문 '…님의 새 메시지'와 안 겹치게) · 새 지원·참여(초대 수락·코드 참여 포함) … 26종. 에뮬레이터에서 '문의 답변'·'ArtTalk' 확인.
  - 검증: backend push 17 · build / frontend native 29. 데모 DB 다시 11-09 백업으로. 개발 서버는 켜 둔 채(앞서 꺼 둬서 사용자가 헷갈렸다).
  - 카카오를 로컬에서 끝까지 보려면 사용자가 카카오 개발자 콘솔에 `http://localhost:5173/auth/kakao/callback` 을 등록해야 한다. 카카오톡 앱 전환은 여전히 실기기 필요.
- 2026-11-11 (밤, 사용자 요청 넷 + 하나):
  - **로컬 DB = 실서버 복제본**: 마지막으로 받아 온 판(`~/artlink-backups/artlink-prod-replica-before-migrate-20261001.dump`, 9월 말 실서버)을 `artlink_prod` 에 다시 올리고 마이그레이션 11개 적용
    (그 전 `artlink_prod` 는 `artlink_prod-before-reload-20261111.dump` 로 보관). 백엔드는 `.env` 를 바꾸지 않고 `DATABASE_URL=…/artlink_prod npm run dev`.
    복제본엔 대화가 거의 없어(방 1·메시지 0) 점검 계정·대화방을 만들었다(`backend/scripts/seed-audit-chat.ts`, '점검' 작가 둘, `--clean`).
  - **ArtTalk 대화방 레이아웃**: 휴대폰에서 대화 칸이 상자보다 64px 넓어 [보내기]가 잘리고 '첫 메시지를 보내보세요'가 33px 치우쳤다(격자 칸 auto + 상자 overflow-hidden).
    `grid-cols-1`·`minmax(0,1fr)`·`min-w-0` → 칸 = 상자, 가운데 일치(412·360px). 앱에서도 확인.
  - **화면 전수 점검**(`scratchpad/layout-audit/walk.mjs`): 크롬 6폭(360~1280) + 사파리 엔진(390·1280) × 화면 90여 개 — 고치기 전 ArtTalk 를 잡는 것부터 확인했다.
  - **대화방 알림 끄기**(`ChatParticipant.muted`) — 끄면 벨 알림·푸시 없음, 안 읽은 수는 그대로(회색 배지). 에뮬레이터: 끈 방 메시지 FCM 0건 → 다시 켜면 바로 옴.
  - **카카오톡처럼**: 뒤에 있을 때 화면 위 팝업 배너 + 소리 + **진동(새로 켬 — 채널은 한 번 만들면 못 바꾼다)** · 대화 푸시 제목 = 보낸 사람(단톡은 방 이름), 본문 = 메시지 ·
    앱을 보고 있을 때 = 위쪽 배너(누르면 그 방), 그 방을 보고 있으면 조용하고 메시지가 2.5초 안에 뜬다(전엔 최대 8초). 전부 에뮬레이터 스크린샷으로 확인.
  - **작품 정보 [저장하고 다음 작품]이 세 작품을 맴돌던 것** — 이번에 지나온 작품은 다시 띄우지 않는다(한 바퀴면 끝).
  - 함정: Prisma 스키마를 바꾸고 `prisma generate` 해도 **돌고 있는 tsx watch 는 옛 클라이언트를 쥔다** → 알림 만들기가 'Unknown argument muted' 로 조용히 실패했다(메시지 저장은 201). 서버 재시작.
  - 검증: backend 전체 **1694 통과** · frontend 전체 **1460 통과** · build · 린트(바꾼 파일 HEAD 와 같은 수) · E2E 29·61·62·73·78 **68 통과**(새로 넣은 29 의 알림 끄기·휴대폰 폭 2개 포함).
    화면 전수 점검: 크롬 540 + 사파리 엔진 180 + 창 28 + 눌러 여는 것 26 — 실제 결함은 ArtTalk 하나(고침). 나머지 걸린 것은 흐린 배경 사진·그래프 축 글자(의도)라 판정에서 뺐다.
    데모 DB 는 11-09 백업 + chat_mute 마이그레이션으로 되돌렸고, 로컬 4000 은 다시 실서버 복제본(artlink_prod). 점검 계정은 복제본에 남겨 뒀다(`seed-audit-chat.ts --clean` 으로 지운다).
- 2026-11-11 (밤 늦게, 실기기 APK): 사용자 폰에서 카카오 로그인이 카카오톡과 연동 안 되고 이메일·비밀번호만 — WebView 에서는 카카오 웹 로그인이 카카오톡으로 못 넘어간다.
  → **카카오 SDK 로그인**: `ArtLinkShell.kakaoLogin()`(카카오톡 → 실패면 카카오 계정) → `POST /api/auth/kakao/native`(app_id = `KAKAO_APP_ID` 확인) → 콜백 화면이 웹과 같게.
    사용자가 콘솔에 안드로이드 플랫폼(패키지·디버그 키 해시) 등록, 네이티브 앱 키 받음. 에뮬레이터(카카오톡 없음): 버튼 → 카카오 계정 화면(크롬 탭)까지, 키 해시 오류 없음.
    남은 것: **`KAKAO_APP_ID`**(콘솔의 앱 ID) → 로컬 .env·Render. 폰에서 쓰려면 이 브랜치의 웹·서버가 실서버에 배포돼야 한다(폰 앱은 실서버 웹을 띄운다).
  · 보안 검토 두 건 수정(intent:// 권한 넘기기 차단 · 7일 안 연 기기·비밀번호 재설정 뒤 기기로 알림 안 감).
  · 웹 수정 커밋(37fc4e9)의 실서버 배포 push 는 이 환경 권한에 막혀 사용자가 직접 실행해야 한다.
- 2026-11-11 (배포): 사용자 결정 "앱 브랜치까지 배포하자". 개인정보처리방침 최종 수정일 → 2026-11-11. Render 는 서비스 하나 그대로(앱도 같은 서버·DB),
  환경 변수 둘만 추가(`KAKAO_APP_ID`·`FIREBASE_SERVICE_ACCOUNT` — 값은 `~/firebase/RENDER_FIREBASE_SERVICE_ACCOUNT.txt`, 저장소 밖). 배포 push 는 사용자가 직접.
