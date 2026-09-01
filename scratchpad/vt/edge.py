#!/usr/bin/env python3
"""'그어 놓은 선'인가 '파인 자리'인가 — 매트 없는 액자의 안쪽 이음매를 잰다.

사용자 지적(2026-09-01): *"FRAME → INNER RECESS → ARTWORK 전이가 일부 렌더에서 여전히
얇은 그래픽 선으로 읽힌다."* 깊이를 **더** 넣지 말고 **더 그럴듯하게** 만들라는 요구다.

선으로 읽히는 조건을 셋으로 나눠 잰다. 셋 다 '세기'가 아니라 **모양**을 본다.

    band    골↔끝의 차이 ÷ 앞면.  작으면 골과 끝이 같은 밝기 = **평평한 띠** = 선.
            골든은 골과 회복이 뚜렷이 달라 0.15~0.42 다(V 자).
    cross   작품 첫 픽셀 ÷ 작품 본문.  1.0 이면 어두워짐이 **경계에서 뚝 끊긴다**.
            실제 리베이트의 폐색은 재질 경계를 모르므로 작품 쪽으로 이어진다
            — 골든 0.82~0.92. 끊기면 그 자리가 곧 '선의 가장자리'다.
    width   앞면의 90% 아래로 내려간 구간의 폭(px). 좁을수록 선으로 보인다.

    python3 edge.py matrix          # 우리 렌더
    python3 edge.py --golden        # 실제 사진(기준)
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path('/home/jho4255/ArtLink/scratchpad/vt')


def lum(p):
    return np.asarray(Image.open(p).convert('RGB')).astype(float) @ [.2126, .7152, .0722]


def cut(L, rect, art, side):
    """살 바깥 → 작품 안쪽 단면(변 가운데 30% 평균)과 작품 시작 인덱스."""
    x0, y0, x1, y1 = rect
    ax0, ay0, ax1, ay1 = art
    if side == 'left':
        lo, hi = ay0 + int((ay1 - ay0) * .35), ay0 + int((ay1 - ay0) * .65)
        return L[lo:hi, x0:ax0 + 9].mean(axis=0), ax0 - x0
    if side == 'right':
        lo, hi = ay0 + int((ay1 - ay0) * .35), ay0 + int((ay1 - ay0) * .65)
        return L[lo:hi, ax1 - 8:x1 + 1].mean(axis=0)[::-1], x1 - ax1
    if side == 'top':
        lo, hi = ax0 + int((ax1 - ax0) * .35), ax0 + int((ax1 - ax0) * .65)
        return L[y0:ay0 + 9, lo:hi].mean(axis=1), ay0 - y0
    lo, hi = ax0 + int((ax1 - ax0) * .35), ax0 + int((ax1 - ax0) * .65)
    return L[ay1 - 8:y1 + 1, lo:hi].mean(axis=1)[::-1], y1 - ay1


def stats(L, rect, art):
    out = []
    for side in ('top', 'right', 'bottom', 'left'):
        p, n = cut(L, rect, art, side)
        if n < 6 or len(p) < n + 6:
            continue
        rail, aw = p[:n], p[n + 1:n + 9]
        if len(aw) < 4:
            continue
        face = float(np.median(rail[:max(2, int(n * .5))]))
        if face < 2:
            continue
        inner = rail[int(n * .55):]
        # ⚠️ **마지막 1px 은 빼고 잰다** — 작품 경계가 정수 픽셀에 안 떨어져 축소 때 살과
        #    작품이 섞인다. 어두운 액자 + 밝은 작품이면 그 혼합 픽셀이 **앞면보다 밝게** 나와
        #    (실측 얇은 월넛 1.58배) 있지도 않은 '밝은 링'으로 읽힌다. `profile.py` 와 같은 처리.
        trough, tip = float(inner.min()), float(rail[-2] if len(rail) > 2 else rail[-1])
        body = float(np.median(aw[2:]))
        first = float(aw[0])
        # 앞면의 90% 아래로 내려간 구간(살 안에서만)
        w = int((rail[int(n * .3):] < face * .90).sum())
        out.append(dict(band=(tip - trough) / face, cross=first / max(body, 1.0), width=w,
                        trough=trough / face, tip=tip / face))
    if not out:
        return None
    return {k: float(np.median([o[k] for o in out])) for k in out[0]}


def main():
    rows = []
    if '--golden' in sys.argv:
        import golden as G
        for k, g in sorted(G.GOLD.items()):
            s = stats(lum(f'cases/{k}/frameit_reference.png'), g['rect'], G.art_of(g))
            if s:
                rows.append((k + '  ' + g['note'][:14], s))
    else:
        d = HERE / (sys.argv[1] if len(sys.argv) > 1 else 'matrix')
        meta = json.load(open(d / 'meta.json'))
        for k in sorted(meta):
            g = meta[k]
            if g['mat'] != 0 or g['kind'] == 'canvas':
                continue
            s = stats(lum(d / f'{k}.png'), g['rect'], g['art'])
            if s:
                rows.append((k, s))
    print(f"{'':30s}{'band':>7s}{'cross':>8s}{'width':>7s}   (골 → 끝)")
    for k, s in rows:
        flag = []
        if s['band'] < 0.10:
            flag.append('평평')
        if s['cross'] > 0.97:
            flag.append('끊김')
        print(f"{k[:30]:30s}{s['band']:7.2f}{s['cross']:8.2f}{s['width']:7.0f}   "
              f"{s['trough']:.2f} → {s['tip']:.2f}   {'·'.join(flag)}")
    if rows:
        for m in ('band', 'cross', 'width'):
            v = [s[m] for _, s in rows]
            print(f'  {m:6s} {min(v):6.2f} ~ {max(v):6.2f}  중앙 {np.median(v):6.2f}')


if __name__ == '__main__':
    main()
