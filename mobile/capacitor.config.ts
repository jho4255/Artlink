import type { CapacitorConfig } from '@capacitor/cli';

/**
 * ArtLink 모바일 앱 — 실서버(artlink.cc)를 WebView 로 그대로 띄우는 껍데기. 계획·검증은 mobile/PLAN.md.
 *
 * 개발 때는 앱이 WSL 의 vite 개발 서버를 보게 한다: `bash scripts/emu.sh dev`
 *   (= adb reverse tcp:5173 + `ARTLINK_APP_URL=http://localhost:5173 npm run sync` + 빌드·설치)
 * 값은 sync 때 android/app/src/main/assets/capacitor.config.json 에 박힌다 — 그 APK 가 보는 주소다.
 * ⚠️ 출시 빌드 전에는 반드시 기본값(실서버)으로 다시 sync 할 것(scripts/post-sync.mjs 가 경고한다).
 */
const url = process.env.ARTLINK_APP_URL ?? 'https://artlink.cc';

const config: CapacitorConfig = {
  appId: 'cc.artlink.app',
  appName: 'ArtLink',
  webDir: 'www',
  backgroundColor: '#ffffff',
  // 웹이 UA 로도 앱을 알아본다 — 번들 밖 화면(ArtLook ui.js)·서버 로그용. 숫자는 '껍데기 규약' 판:
  // 네이티브가 할 수 있는 일이 바뀌면 올린다(정확한 판은 ArtLinkShell.info() 의 versionCode).
  appendUserAgent: 'ArtLinkApp/1',
  server: {
    url,
    cleartext: url.startsWith('http://'),
    // 첫 화면을 못 불러오면(오프라인·서버 5xx) WebView 기본 오류 화면 대신 이것 — 앱 안에서 https://localhost/offline.html 로 열린다
    errorPath: 'offline.html',
    // ⚠️ 여기 넣은 주소는 WebView 안에서 열릴 뿐 아니라 **앱의 네이티브 기능 통로(androidBridge)도 받는다**
    //    (Capacitor Bridge.allowedOriginRules 에 그대로 들어간다). 카카오 로그인에 실제로 거치는 곳만 —
    //    '*.kakao.com' 처럼 넓히지 말 것. 그 밖의 주소(인스타그램·첨부 파일·카카오 채널 등)는 시스템(브라우저·앱)으로 나간다.
    allowNavigation: ['kauth.kakao.com', 'accounts.kakao.com', 'logins.daum.net'],
  },
  plugins: {
    // 밝은 바탕 + 어두운 아이콘(사이트 상단바가 흰색). 바 자리 색은 테마의 windowBackground(흰색, styles.xml)
    SystemBars: { style: 'LIGHT' },
    // 웹이 그려지면 native.ts 가 바로 내린다. 3초는 상한 — 옛 웹(hide 를 안 부르는 판)이나 오류 화면에서도 걷힌다
    SplashScreen: { launchShowDuration: 3000, launchAutoHide: true, launchFadeOutDuration: 200, backgroundColor: '#ffffff', showSpinner: false },
  },
};

export default config;
