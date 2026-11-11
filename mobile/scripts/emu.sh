#!/usr/bin/env bash
# ArtLink 안드로이드 에뮬레이터 도우미 — WSL 에서 **윈도우 쪽** 에뮬레이터·adb 를 부른다(2026-11-09).
#   . mobile/scripts/env.sh 뒤에:  bash mobile/scripts/emu.sh <명령>
#   start      에뮬레이터(ArtLink_Pixel7) 띄우기(이미 떠 있으면 그대로) · 부팅 완료까지 기다림
#   wait       부팅 완료 대기
#   dev        앱이 WSL 개발 서버(http://localhost:5173)를 보게: adb reverse + cap sync + 빌드·설치·실행
#   prod       앱이 실서버(https://artlink.cc)를 보게 다시 sync + 빌드·설치·실행  ⚠️ 비회원 통계에 방문이 남는다
#   run        앱 실행(이미 설치돼 있을 때)
#   shot [이름] 스크린샷 → $OUT/<이름>.png (기본 shot-<시각>)
#   dump       화면 접근성 트리(XML) — WebView 글자·버튼도 들어 있어 "무엇이 보이는가" 판정에 쓴다
#   tap <x> <y> 좌표 탭 / tapon "<글자>" 글자로 찾아 탭 / has "<글자>" 화면에 있나 / top 맨 앞 화면
#   pageurl    앱 WebView 의 지금 주소(디버그 빌드) / js "<식>" 앱 안에서 JS 실행(디버그 빌드)
#   text "<글>" 글자 입력 / back 뒤로가기 / key <KEYCODE>
#   log        앱 WebView 콘솔(chromium) + Capacitor 로그 따라가기(Ctrl+C 로 끝)
#   url <주소>  기기 브라우저가 아니라 **우리 앱**으로 https://artlink.cc/… 를 열어 본다(App Links 확인용)
#   uninstall  앱 지우기
set -euo pipefail
WIN_SDK="${WIN_SDK:-/mnt/c/Android/Sdk}"
ADB="$WIN_SDK/platform-tools/adb.exe"
EMU="$WIN_SDK/emulator/emulator.exe"
AVD="${AVD:-ArtLink_Pixel7}"
PKG="cc.artlink.app"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${EMU_OUT:-$HERE/.emu-out}"; mkdir -p "$OUT"
cmd="${1:-}"; shift || true

booted() { [ "$("$ADB" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; }
wait_boot() { for i in $(seq 1 90); do booted && { echo "booted"; return 0; }; sleep 4; done; echo "boot timeout" >&2; return 1; }
build_install_run() {
  # 빌드는 리눅스(WSL) Gradle, 설치는 **윈도우 adb** — 에뮬레이터는 윈도우 adb 서버에 붙어 있어 리눅스 adb(gradlew installDebug)로는 안 보인다
  # ⚠️ grep -v 는 걸러 낼 게 없으면(조용한 성공) 1 을 돌려준다 — pipefail+set -e 에서 그대로 두면 여기서 스크립트가 말없이 끝난다
  (cd "$HERE/android" && ./gradlew assembleDebug -q 2>&1 | { grep -v -E '^\s*$|unchecked|Recompile|deprecated|SDK processing' || true; } | tail -5)
  "$ADB" install -r "$(wslpath -w "$HERE/android/app/build/outputs/apk/debug/app-debug.apk")" | tr -d '\r' | tail -1
  "$ADB" shell am force-stop "$PKG" >/dev/null 2>&1 || true
  "$ADB" shell am start -n "$PKG/.MainActivity" >/dev/null 2>&1 && echo "app started"
}

case "$cmd" in
  start)
    "$ADB" start-server >/dev/null 2>&1 || true
    if "$ADB" devices | grep -q emulator; then echo "emulator already running"; else
      (cd "$WIN_SDK/emulator" && nohup "$EMU" -avd "$AVD" -gpu auto -no-boot-anim -no-snapshot-load >"$OUT/emulator.log" 2>&1 &)
      echo "launching $AVD (log: $OUT/emulator.log)"; fi
    wait_boot ;;
  wait) wait_boot ;;
  dev)
    "$ADB" reverse tcp:5173 tcp:5173 >/dev/null && echo "adb reverse 5173 ok"
    (cd "$HERE" && ARTLINK_APP_URL=http://localhost:5173 npm run -s sync 2>&1 | tail -3)
    build_install_run ;;
  prod)
    (cd "$HERE" && npm run -s sync 2>&1 | tail -2)
    build_install_run ;;
  run) "$ADB" shell am start -n "$PKG/.MainActivity" | tr -d '\r' ;;
  shot) f="$OUT/${1:-shot-$(date +%H%M%S)}.png"; "$ADB" exec-out screencap -p > "$f"; echo "$f" ;;
  dump) "$ADB" exec-out uiautomator dump /dev/tty 2>/dev/null | tr -d '\r' | sed 's/UI hierchary dumped to: \/dev\/tty//' ;;
  tap) "$ADB" shell input tap "$1" "$2" ;;
  tapon)  # 글자·설명으로 찾아 누른다(WebView 안 버튼도) — tapon "<글자>" [--exact] [--nth N]
    "$ADB" exec-out uiautomator dump /dev/tty 2>/dev/null > "$OUT/.ui.xml"
    read -r x y label < <(python3 "$HERE/scripts/ui_find.py" "$OUT/.ui.xml" "$@") || { echo "not found: $1" >&2; exit 1; }
    "$ADB" shell input tap "$x" "$y"; echo "tapped ($x,$y) $label" ;;
  has)    # 화면에 그 글자가 있는가 — 있으면 0
    "$ADB" exec-out uiautomator dump /dev/tty 2>/dev/null > "$OUT/.ui.xml"
    python3 "$HERE/scripts/ui_find.py" "$OUT/.ui.xml" "$@" >/dev/null ;;
  top)    # 지금 맨 앞 화면(앱 · 크롬 · 공유 창 …) — grep -m1 이 파이프를 먼저 닫으면 pipefail 로 141 이 난다 → 다 받아 두고 찾는다
    acts="$("$ADB" shell dumpsys activity activities 2>/dev/null | tr -d '\r')"
    grep -m1 -o 'topResumedActivity=[^}]*' <<<"$acts" || true ;;
  js)     # 앱 WebView 에서 JS 를 실행하고 값을 찍는다(디버그 빌드) — js "location.pathname" · Promise 도 기다린다
    pid="$("$ADB" shell pidof "$PKG" | tr -d '\r')"
    [ -n "$pid" ] || { echo "app not running" >&2; exit 1; }
    "$ADB" forward tcp:9333 "localabstract:webview_devtools_remote_$pid" >/dev/null
    printf '%s' "$1" > "$OUT/.expr.js"
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$(wslpath -w "$HERE/scripts/cdp.ps1")" -ExprFile "$(wslpath -w "$OUT/.expr.js")" 2>&1 | tr -d '\r' \
      | python3 -c 'import json,sys
raw=sys.stdin.read(); i=raw.find("{")
d=json.loads(raw[i:]) if i>=0 else {}
r=d.get("result",{})
if "exceptionDetails" in r: print("JS ERROR:", r["exceptionDetails"].get("exception",{}).get("description") or r["exceptionDetails"].get("text")); sys.exit(2)
v=r.get("result",{}).get("value")
print(v if isinstance(v,str) else json.dumps(v, ensure_ascii=False))' ;;
  pageurl) # 앱 WebView 가 지금 보고 있는 주소(디버그 빌드 — Chrome DevTools /json 을 윈도우 쪽에서 읽는다)
    pid="$("$ADB" shell pidof "$PKG" | tr -d '\r')"
    [ -n "$pid" ] || { echo "app not running" >&2; exit 1; }
    "$ADB" forward tcp:9333 "localabstract:webview_devtools_remote_$pid" >/dev/null
    powershell.exe -NoProfile -Command "(Invoke-WebRequest -UseBasicParsing http://127.0.0.1:9333/json).Content" 2>/dev/null | tr -d '\r' \
      | python3 -c 'import json,sys; [print(p["url"]) for p in json.load(sys.stdin) if p.get("type")=="page"]' ;;
  text) "$ADB" shell input text "$(printf '%s' "$1" | sed 's/ /%s/g')" ;;
  back) "$ADB" shell input keyevent KEYCODE_BACK ;;
  key) "$ADB" shell input keyevent "$1" ;;
  log) "$ADB" logcat -v brief chromium:I Capacitor:V Capacitor/Console:V Capacitor/Plugin:V '*:S' | tr -d '\r' ;;
  url) "$ADB" shell am start -a android.intent.action.VIEW -d "$1" "$PKG" | tr -d '\r' ;;
  uninstall) "$ADB" uninstall "$PKG" | tr -d '\r' ;;
  *) sed -n 2,16p "$0"; exit 1 ;;
esac
