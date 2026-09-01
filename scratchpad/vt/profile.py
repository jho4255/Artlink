#!/usr/bin/env python3
"""살을 가로지르는 **단면**을 숫자로 본다 — 벽 → 액자 → (매트) → 작품.

`nomat.py` 의 임펄스 지표는 중앙값 필터(size=5) 잔차라 **3px 이상 넓은 띠를 못 본다**.
그런데 눈에 '층'으로 보이는 건 바로 그 폭이다(4배 확대에서 확인). 그래서 단면을 그대로 찍는다.

    python3 profile.py matrix m04_walnut_nomat m07_silverfl_nomat
    python3 profile.py matrix --all
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path('/home/jho4255/ArtLink/scratchpad/vt')


def lum(p):
    return np.asarray(Image.open(p).convert('RGB')).astype(float) @ [.2126, .7152, .0722]


def cut(L, g, side='left', frac=0.34):
    """살을 가로지르는 평균 단면. 벽 8px 부터 작품 안쪽 10px 까지."""
    x0, y0, x1, y1 = g['rect']
    ax0, ay0, ax1, ay1 = g['art']
    if side == 'left':
        lo, hi = ay0 + int((ay1 - ay0) * (.5 - frac / 2)), ay0 + int((ay1 - ay0) * (.5 + frac / 2))
        seg = L[lo:hi, max(0, x0 - 8):ax0 + 11].mean(axis=0)
        wall_n, edge = 8, x0
    else:                                        # top
        lo, hi = ax0 + int((ax1 - ax0) * (.5 - frac / 2)), ax0 + int((ax1 - ax0) * (.5 + frac / 2))
        seg = L[max(0, y0 - 8):ay0 + 11, lo:hi].mean(axis=1)
        wall_n, edge = 8, y0
    return seg, wall_n


def show(seg, wall_n, g, name):
    art_i = len(seg) - 11                        # 작품 첫 픽셀의 인덱스
    rail = g['railPx']
    matpx = g['matPx']
    print(f'\n── {name}   rail {rail}  mat {matpx}')
    body = seg[wall_n:art_i]
    if len(body) < 4:
        print('   (너무 얇다)')
        return
    face = float(np.median(body[:max(2, int(len(body) * .5))]))   # 앞면 대표 밝기
    s = ''
    for i, v in enumerate(seg):
        tag = ''
        if i == wall_n - 1:
            tag = '|'                            # 액자 시작
        if i == art_i - 1:
            tag = '|'                            # 작품 시작
        s += f'{v:5.0f}{tag}'
        if (i + 1) % 12 == 0:
            s += '\n     '
    print('     ' + s)
    # 살 안쪽 40% 에서 앞면보다 **밝은** 부분 = 물리적으로 설명 안 되는 띠
    # ⚠️ **마지막 1px 은 빼고 잰다** — 작품 경계가 정수 픽셀에 안 떨어져 축소 때 살과
    #    작품이 섞인다(검정: 목표 26 인데 작품 86 과 반반 섞여 59 로 찍혔다). 그건 우리가
    #    그린 띠가 아니다. 대신 경계값은 따로 적어 둔다.
    inner = body[int(len(body) * .6):-1]
    if len(inner):
        up = inner.max() / max(1e-6, face)
        w = int((inner > face * 1.03).sum())
        print(f'     앞면 {face:5.1f}   안쪽 최대 {inner.max():5.1f} ({up:4.2f}배)'
              f'   앞면보다 밝은 픽셀 {w}px   골 {inner.min():5.1f}'
              f' ({inner.min() / max(1e-6, face):4.2f}배)'
              f'   끝 {body[-2]:5.1f} ({body[-2] / max(1e-6, face):4.2f}배)')


def main():
    d = HERE / (sys.argv[1] if len(sys.argv) > 1 else 'matrix')
    meta = json.load(open(d / 'meta.json'))
    keys = sorted(meta) if '--all' in sys.argv else [a for a in sys.argv[2:] if a in meta]
    for k in keys:
        L = lum(d / f'{k}.png')
        seg, wn = cut(L, meta[k], 'left')
        show(seg, wn, meta[k], k + '  [왼쪽 살]')


if __name__ == '__main__':
    main()
