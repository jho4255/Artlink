#!/usr/bin/env bash
# Playwright WebKit(사파리 엔진)을 **sudo 없이** 띄우기 — 시스템에 없는 라이브러리를 사용자 디렉터리에 푼다.
# `npx playwright install-deps` 는 root 가 필요해서 이 WSL 에서는 못 쓴다. Ubuntu 24.04 기준.
#   bash setup-webkit.sh   →   ~/.cache/wk-deps/run.sh 가 생긴다(webkit.launch({ executablePath }) 로 넘긴다)
set -euo pipefail
D="$HOME/.cache/wk-deps"; mkdir -p "$D/debs" "$D/root"
WK="$(ls -d "$HOME"/.cache/ms-playwright/webkit-* 2>/dev/null | sort | tail -1)"
[ -n "$WK" ] || { echo "먼저: cd e2e && npx playwright install webkit"; exit 1; }
cd "$D/debs"
apt-get download libgtk-4-1 libevent-2.1-7t64 libgstreamer-plugins-bad1.0-0 libflite1 libwebpdemux2 libavif16 libwebpmux3 \
  libwayland-server0 libmanette-0.2-0 libenchant-2-2 libsecret-1-0 libwoff1 libx264-164 libsvtav1enc1d1 \
  libcairo-script-interpreter2 libdav1d7 libevdev2 libgav1-1 librav1e0 libyuv0 libsoup-3.0-0 libnice10 libva-drm2 libva2 \
  libxkbcommon-x11-0 glib-networking glib-networking-common libproxy1v5
for f in *.deb; do dpkg -x "$f" "$D/root"; done
cat > "$D/run.sh" <<RUN
#!/bin/sh
# Playwright 의 MiniBrowser 래퍼는 LD_LIBRARY_PATH 를 덮어쓴다 — 그래서 래퍼를 따로 둔다. TLS 는 glib-networking(GIO 모듈)이 준다.
W="$WK/minibrowser-wpe"
export WEBKIT_EXEC_PATH="\$W/bin" WEBKIT_INJECTED_BUNDLE_PATH="\$W/lib" WEBKIT_INSPECTOR_RESOURCES_PATH="\$W/share"
export LD_LIBRARY_PATH="\$W/lib:\$W/sys/lib:$D/root/usr/lib/x86_64-linux-gnu"
export GIO_EXTRA_MODULES="$D/root/usr/lib/x86_64-linux-gnu/gio/modules"
export WEBKIT_FORCE_COMPLEX_TEXT=1
exec "\$W/bin/MiniBrowser" "\$@"
RUN
chmod +x "$D/run.sh"; echo "준비됨: $D/run.sh"
