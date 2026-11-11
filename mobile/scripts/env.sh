#!/usr/bin/env bash
# ArtLink 모바일 앱 빌드 환경 — `. mobile/scripts/env.sh` 로 불러 쓴다(2026-11-09).
#   리눅스(WSL): JDK 21(Temurin, ~/.local/jdk) · Android SDK(~/Android/Sdk) · Node 22(nvm) — 여기서 APK 를 빌드한다.
#   윈도우(C:\Android): JDK 21 · Android SDK · 에뮬레이터 — WSL2 가 Windows 10 이라 중첩 가상화(/dev/kvm)가 없어
#   에뮬레이터는 윈도우 쪽에서 돌리고(WHPX), WSL 에서는 interop 으로 adb.exe / emulator.exe 를 부른다.
export JAVA_HOME="$HOME/.local/jdk/jdk-21.0.13+9"
export ANDROID_HOME="$HOME/Android/Sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"
if [ -s "$HOME/.nvm/nvm.sh" ]; then . "$HOME/.nvm/nvm.sh"; nvm use 22 >/dev/null 2>&1; fi

export WIN_SDK="/mnt/c/Android/Sdk"
wadb()      { "$WIN_SDK/platform-tools/adb.exe" "$@"; }       # 윈도우 adb(에뮬레이터가 붙어 있는 쪽)
wemulator() { "$WIN_SDK/emulator/emulator.exe" "$@"; }        # 윈도우 에뮬레이터
export -f wadb wemulator
