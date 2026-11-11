# ArtLink 안드로이드 앱 (Capacitor 껍데기)

`https://artlink.cc` 를 WebView 로 그대로 띄우고 푸시 알림을 더한 앱. **웹을 배포하면 앱 화면도 바뀐다.**
설계·결정·검증 체크리스트는 [`PLAN.md`](PLAN.md), 지켜야 할 규칙은 저장소 `CLAUDE.md` 규칙 79.

## 환경 (이 PC 기준 — 이미 깔려 있다)
- 이 PC 는 Windows 10 이라 WSL2 안에서 에뮬레이터를 못 띄운다(/dev/kvm 없음). **에뮬레이터는 윈도우 쪽**, **빌드는 WSL**.
  - 윈도우 `C:\Android` — JDK 21 · Android SDK · 에뮬레이터 · AVD `ArtLink_Pixel7`(Android 15, Play 스토어 이미지 = 진짜 FCM 수신 가능)
  - WSL — JDK 21 `~/.local/jdk` · SDK `~/Android/Sdk` · Node 22(nvm, 기본값은 20 그대로)
- 매번 `. scripts/env.sh` 로 불러 쓴다(`.bashrc` 에는 안 넣었다).

## 자주 쓰는 것
```bash
. mobile/scripts/env.sh
bash mobile/scripts/emu.sh start      # 에뮬레이터 띄우기(윈도우 화면에 창이 뜬다)
bash mobile/scripts/emu.sh dev        # 앱이 로컬 개발 서버(localhost:5173)를 보게 — adb reverse + sync + 빌드 + 설치 + 실행
bash mobile/scripts/emu.sh prod       # 실서버로(⚠️ 비회원 통계에 방문이 남는다 — 출시 전 스모크 때만)
bash mobile/scripts/emu.sh shot NAME  # 스크린샷 → mobile/.emu-out/NAME.png
bash mobile/scripts/emu.sh tapon "글자" / has "글자" / back / top / pageurl / js "식" / log
bash mobile/scripts/emu.sh url https://artlink.cc/exhibitions   # 앱 링크로 열어 보기
```
- 로컬 확인은 개발 서버가 떠 있어야 한다(백엔드 4000 · 프론트 5173, 데모 DB). 로그인은 로그인 화면의 [개발자 로그인].
- `js` 는 디버그 빌드에서만 된다(DevTools 를 윈도우 PowerShell 로 붙인다 — `scripts/cdp.ps1`, UTF-8 BOM 으로 저장할 것).

## 바꿀 때
- 아이콘: `python3 scripts/make-icons.py <Pretendard-Bold.otf>` → `npx @capacitor/assets@4.0.0 generate --android --assetPath assets --iconBackgroundColor '#ffffff' --iconBackgroundColorDark '#ffffff' --splashBackgroundColor '#ffffff' --splashBackgroundColorDark '#ffffff'`
- 플러그인을 더하거나 올리면 **`frontend/package.json` 의 같은 패키지도 같은 버전으로**(`native.test.ts` 가 대조) → `npm run sync`.
- 출시 빌드 전에 `ARTLINK_APP_URL` 없이 `npm run sync`(개발 주소가 박힌 채면 `post-sync` 가 경고한다).
- `google-services.json`(Firebase)은 `android/app/` 에 두되 **커밋하지 않는다**(`.gitignore`). 없으면 앱은 푸시를 등록하지 않는다(부르면 죽으므로 웹이 `ArtLinkShell.info().push` 를 보고 건너뛴다).
