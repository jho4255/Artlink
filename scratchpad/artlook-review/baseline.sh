#!/usr/bin/env bash
# WP0 기준선 — 고치기 전에 한 번. 5173(개발 서버)이 떠 있어야 한다. 이 스크립트가 도는 동안 frontend/public/artlook 을 고치지 말 것.
#   bash scratchpad/artlook-review/baseline.sh [tag]     → q-<tag>/ · logs/<tag>-*.txt (tag 기본 base)
set -uo pipefail
TAG=${1:-base}
R=/home/jho4255/ArtLink/scratchpad/artlook-review; V=/home/jho4255/ArtLink/scratchpad/vt; L=$R/logs
cd $R
echo "[$(date +%T)] review render" ; node render.mjs all > $L/$TAG-render.txt 2>&1
rm -rf q-$TAG && mkdir -p q-$TAG && cp -r q/frames q/scenes q/special q-$TAG/ && cp q/geo-frames.json q/geo-scenes.json q/geo-special.json q-$TAG/ 2>/dev/null; cp q/geo-all.json q-$TAG/ 2>/dev/null
node shadow.cjs frames/oak frames/black frames/canvas-wrap scenes/concrete scenes/terracotta scenes/charcoal scenes/white-plaster scenes/white-brick special/unknown-salon special/unknown-whitecube special/unknown-collector-home > $L/$TAG-shadow.txt 2>&1
cd $V
echo "[$(date +%T)] vt render"; node render.mjs > $L/$TAG-vt-render.txt 2>&1
python3 run.py --save $TAG-1117 > $L/$TAG-vt-run.txt 2>&1
rm -rf $R/q-$TAG/vt-renders && cp -r renders $R/q-$TAG/vt-renders
echo "[$(date +%T)] vt off"; SYN=0 SYNDIR=0 node render.mjs renders_off > $L/$TAG-vt-render-off.txt 2>&1
python3 syncheck.py > $L/$TAG-vt-syncheck.txt 2>&1
python3 physics.py > $L/$TAG-vt-physics.txt 2>&1
python3 artpreserve.py > $L/$TAG-vt-artpreserve.txt 2>&1
python3 presence.py > $L/$TAG-vt-presence.txt 2>&1
echo "[$(date +%T)] nomat"; node nomat.mjs > $L/$TAG-vt-nomat-render.txt 2>&1; python3 nomat.py > $L/$TAG-vt-nomat.txt 2>&1
echo "[$(date +%T)] leak"; LEAK_OUT=leak/$TAG node leak.mjs > $L/$TAG-vt-leak-render.txt 2>&1; LEAK_OUT=leak/$TAG python3 leak.py > $L/$TAG-vt-leak.txt 2>&1
LEAK_OUT=leak/$TAG-interior LEAK_SCENES=gallery-salon,boutique,collector-salon,gallery-living,white-cube,collector-home,hotel-lounge node leak.mjs > $L/$TAG-vt-leak-int-render.txt 2>&1
LEAK_OUT=leak/$TAG-interior python3 leak.py > $L/$TAG-vt-leak-int.txt 2>&1
echo "[$(date +%T)] done"
