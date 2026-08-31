#!/usr/bin/env python3
"""벽 무늬 유출(wall leak) 측정.

단색 작품을 걸었으므로 작품 영역에 남는 무늬는 **전부 벽에서 새어 들어온 것**이다.

⚠️ **대역을 작품 크기 기준으로 잡을 것.** 처음엔 고정 sigma=14 로 나눴다가 벽돌 한 장
   (작품 폭의 1/5)이 '조명 낙차'로 분류돼 유출이 5% 로 나왔다 — 눈으로는 돌벽이 그대로
   보이는데도. 벽돌·돌 무늬는 작품 폭의 1/12~1/2 대역에 있다.

  leak_tex   작품 영역의 **무늬 대역** 표준편차  ← 이게 곧 '비침'
  wall_tex   같은 자리 벽의 무늬 대역 표준편차
  leak_pct   벽 무늬의 몇 %가 작품에 통과했나
  grad       작품 영역의 **조명 낙차**(작품 폭 1/2 이상) — 지켜야 할 것.
             이걸 같이 죽이면 작품만 균일하게 떠 보인다(CLAUDE.md 36).
"""
import json
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
D = os.path.join(HERE, 'leak')


def lum(a):
    return a[..., 0] * .2126 + a[..., 1] * .7152 + a[..., 2] * .0722


def bands(L, w):
    """작품 폭 w 기준 3분할: 그레인 / 무늬 / 조명."""
    grain_s, tex_s = max(1.0, w / 90), max(2.0, w / 3.2)
    g = ndimage.gaussian_filter(L, grain_s)      # 그레인 제거
    light = ndimage.gaussian_filter(L, tex_s)    # 조명 낙차만
    return light, g - light                      # (조명, 무늬)


def main():
    meta = json.load(open(f'{D}/meta.json'))
    print(f'{"장면":16s} {"장면px":>7s} {"amt":>5s} {"lod":>5s} '
          f'{"벽 무늬":>8s} {"작품 무늬":>9s} {"유출%":>7s} {"조명낙차":>8s}')
    rows = {}
    for sid, m in meta.items():
        a = np.asarray(Image.open(f'{D}/{sid}.png').convert('RGB')).astype(float)
        L = lum(a)
        pr = m['probe']['art']
        x0, y0 = int(pr['x']), int(pr['y'])
        x1, y1 = int(pr['x'] + pr['w']), int(pr['y'] + pr['h'])
        p = int(pr['w'] * .10)
        ix0, iy0, ix1, iy1 = x0 + p, y0 + p, x1 - p, y1 - p
        w = ix1 - ix0
        light, tex = bands(L[iy0:iy1, ix0:ix1], w)
        leak, grad = float(tex.std()), float(light.max() - light.min())
        wx1 = max(0, x0 - int(w * .12)); wx0 = max(0, wx1 - w)
        if wx1 - wx0 < w * .5:
            wx0 = min(L.shape[1] - w, x1 + int(w * .12)); wx1 = wx0 + w
        _wl, wtex = bands(L[iy0:iy1, wx0:wx1], w)
        wall_tex = float(wtex.std())
        pct = leak / max(wall_tex, 1e-6) * 100
        rows[sid] = {'leak_tex': round(leak, 2), 'wall_tex': round(wall_tex, 2),
                     'leak_pct': round(pct, 1), 'grad': round(grad, 1),
                     'wallAmt': m['wallAmt'], 'srcWH': m['srcWH']}
        print(f'{sid:16s} {max(m["srcWH"]):7d} {str(m["wallAmt"]):>5s} '
              f'{str(m.get("wallLod")):>5s} {wall_tex:8.2f} {leak:9.2f} {pct:6.1f}% {grad:8.1f}')
    json.dump(rows, open(f'{D}/leak.json', 'w'), indent=1)
    v = [r['leak_pct'] for r in rows.values()]
    g = [r['grad'] for r in rows.values()]
    print(f'\n유출 중앙값 {np.median(v):.1f}%   조명낙차 중앙값 {np.median(g):.1f}')
    print('목표: 유출 ≤ 8%(눈에 안 보임) · 조명낙차는 그대로 유지')
    return 0


if __name__ == '__main__':
    sys.exit(main())
