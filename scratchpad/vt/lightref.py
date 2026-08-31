#!/usr/bin/env python3
"""FrameIt 조명(light) 레퍼런스 분석 — 조명 기능을 만들기 전에 '무엇을 하는 것인지' 잰다.

`~/ArtLink/light/` 에 FrameIt Pro 결과물이 있다.
  1~12.png          서로 다른 조명 프리셋 (같은 작품·같은 액자)
  opacity20/50/70/100.png   **같은 프리셋을 강도만 바꾼 것** ← 이게 핵심 자료다

강도 4단계가 있으므로 다음을 풀 수 있다.
  ① 강도는 선형인가 (= 단순 opacity 인가, 아니면 비선형 곡선인가)
  ② 조명이 꺼진 원본(base)은 무엇인가 → 외삽으로 복원
  ③ 블렌드 모드는 무엇인가 (normal / screen / multiply / overlay …)
     base 와 full(=100%) 의 관계를 픽셀 단위로 회귀해서 판정
  ④ 조명이 **작품 픽셀에도 걸리는가**, 걸린다면 벽 대비 얼마나 약한가
     — 우리 규칙(작품 보존)과 정면으로 만나는 지점이라 반드시 수치로 알아야 한다

    python lightref.py            # 강도 시리즈 분석
    python lightref.py --presets  # 12 프리셋 성격 분류
"""
import os
import sys

import numpy as np
from PIL import Image

LIGHT = '/home/jho4255/ArtLink/light'
X0, X1 = 150, 1007          # 좌우 레터박스(앱 배경)를 뺀 캔버스 구간
# 작품(포스터) 사각형 — 강도 시리즈는 액자가 고정이므로 한 번만 확정한다.
ART = (196, 115, 686, 728)
# 액자 바깥 사각형 (수동 확정, 캔버스 좌표)
PIECE = (160, 78, 723, 767)


def load(name):
    return np.asarray(Image.open(f'{LIGHT}/{name}.png').convert('RGB')).astype(float)[:, X0:X1]


def masks(shape):
    h, w = shape[:2]
    art = np.zeros((h, w), bool)
    art[ART[1] + 8:ART[3] - 8, ART[0] + 8:ART[2] - 8] = True
    piece = np.zeros((h, w), bool)
    piece[PIECE[1]:PIECE[3], PIECE[0]:PIECE[2]] = True
    wall = ~piece
    # 워터마크(FramePRO)가 중앙을 가로지른다 — 벽 통계에서 뺀다
    return art, wall, piece


def series():
    A = [0.20, 0.50, 0.70, 1.00]
    ims = [load(f'opacity{int(a*100)}') for a in A]
    art, wall, piece = masks(ims[0].shape)

    print('=' * 78)
    print('① 강도는 선형인가 — out(a) = (1-a)·base + a·full 로 예측해 본다')
    print('=' * 78)
    # base 복원: out20 = .8b + .2·full  →  b = (out20 - .2·full)/.8
    full = ims[3]
    base = (ims[0] - 0.20 * full) / 0.80
    for a, im in zip(A[1:3], ims[1:3]):
        pred = (1 - a) * base + a * full
        err = np.abs(pred - im)
        print(f'  강도 {int(a*100):3d}%  예측오차 평균 {err.mean():5.2f}  '
              f'95%tile {np.percentile(err, 95):5.2f}  최대 {err.max():5.1f}')
    print(f'  복원한 base 범위 {base.min():.1f} ~ {base.max():.1f}  '
          f'(0~255 를 벗어나면 선형 가정이 틀린 것)')

    print()
    print('=' * 78)
    print('② 블렌드 모드 — base(복원) 대 full(100%) 의 관계')
    print('=' * 78)
    for label, m in (('벽', wall), ('작품', art)):
        b = base[m].reshape(-1, 3)
        f = full[m].reshape(-1, 3)
        for ci, cn in enumerate('RGB'):
            x, y = b[:, ci], f[:, ci]
            k, c = np.polyfit(x, y, 1)
            r = np.corrcoef(x, y)[0, 1]
            print(f'  {label:3s} {cn}  full ≈ {k:5.3f}·base + {c:6.1f}   r={r:.3f}')
        print(f'      → 기울기<1 · 절편>0 이면 screen 계열(어두운 곳을 더 많이 올린다)')
    print()

    print('=' * 78)
    print('③ 강도별 변화량 — 벽 / 작품 / 액자를 따로')
    print('=' * 78)
    print(f'  {"강도":>5s} {"벽ΔRGB":>8s} {"작품ΔRGB":>9s} {"작품/벽":>8s} '
          f'{"벽 밝기":>8s} {"작품 밝기":>9s} {"벽 색온도":>9s} {"작품 색온도":>11s}')
    bl = base.mean(2)

    def warmth(a, m):
        return float((a[m][:, 0] - a[m][:, 2]).mean())
    print(f'  {"0(복원)":>5s} {0:8.1f} {0:9.1f} {"—":>8s} '
          f'{bl[wall].mean():8.1f} {bl[art].mean():9.1f} '
          f'{warmth(base, wall):9.1f} {warmth(base, art):11.1f}')
    for a, im in zip(A, ims):
        dw = np.abs(im - base)[wall].mean()
        da = np.abs(im - base)[art].mean()
        L = im.mean(2)
        print(f'  {int(a*100):5d} {dw:8.1f} {da:9.1f} {da/max(dw,1e-6):8.2f} '
              f'{L[wall].mean():8.1f} {L[art].mean():9.1f} '
              f'{warmth(im, wall):9.1f} {warmth(im, art):11.1f}')

    print()
    print('=' * 78)
    print('④ 조명의 공간 구조 — full − base 를 9분할로 (양수=밝아짐)')
    print('=' * 78)
    d = (full - base).mean(2)
    h, w = d.shape
    for r in range(3):
        row = []
        for c in range(3):
            blk = d[r * h // 3:(r + 1) * h // 3, c * w // 3:(c + 1) * w // 3]
            row.append(f'{blk.mean():+7.1f}')
        print('   ' + ' '.join(row))
    print(f'  전체 평균 {d.mean():+.1f}   최대 {d.max():+.1f}   최소 {d.min():+.1f}')
    # 벽만으로 세로·가로 기울기
    dw = np.where(wall, d, np.nan)
    top = np.nanmean(dw[:h // 3]); bot = np.nanmean(dw[-h // 3:])
    lf = np.nanmean(dw[:, :w // 3]); rt = np.nanmean(dw[:, -w // 3:])
    print(f'  벽만 —  위 {top:+.1f} / 아래 {bot:+.1f} (차 {top-bot:+.1f})   '
          f'좌 {lf:+.1f} / 우 {rt:+.1f} (차 {lf-rt:+.1f})')

    print()
    print('=' * 78)
    print('⑤ 조명이 대비를 죽이는가 — 지역 대비(밴드패스 std)')
    print('=' * 78)
    from scipy.ndimage import gaussian_filter
    for label, im in [('base(0%)', base)] + [(f'{int(a*100)}%', x) for a, x in zip(A, ims)]:
        L = im.mean(2)
        hf = L - gaussian_filter(L, 3)
        print(f'  {label:9s} 벽 결 {hf[wall].std():5.2f}   작품 결 {hf[art].std():6.2f}   '
              f'작품 채도 {(im[art].max(1)-im[art].min(1)).mean():5.1f}')
    return base


def presets():
    """12 프리셋의 성격 — 우리가 '하나의 슬라이더'로 어디를 겨냥할지 정하기 위해."""
    from scipy.ndimage import gaussian_filter
    print('=' * 100)
    print('12 프리셋 — 같은 작품·같은 액자, 조명만 다름')
    print('=' * 100)
    print(f'  {"샘플":>5s} {"벽밝기":>7s} {"벽색온도":>9s} {"벽결":>6s} {"세로기울기":>11s} '
          f'{"가로기울기":>11s} {"작품밝기":>9s} {"작품색온도":>11s} {"작품채도":>9s}')
    rows = []
    for i in list(range(1, 13)):
        im = load(str(i))
        art, wall, _ = masks(im.shape)
        h, w = im.shape[:2]
        L = im.mean(2)
        dw = np.where(wall, L, np.nan)
        top = np.nanmean(dw[:h // 3]); bot = np.nanmean(dw[-h // 3:])
        lf = np.nanmean(dw[:, :w // 3]); rt = np.nanmean(dw[:, -w // 3:])
        hf = L - gaussian_filter(L, 3)
        row = dict(id=i, wl=L[wall].mean(), ww=(im[wall][:, 0] - im[wall][:, 2]).mean(),
                   wt=hf[wall].std(), vg=top - bot, hg=lf - rt,
                   al=L[art].mean(), aw=(im[art][:, 0] - im[art][:, 2]).mean(),
                   asat=(im[art].max(1) - im[art].min(1)).mean())
        rows.append(row)
        print(f'  {i:5d} {row["wl"]:7.1f} {row["ww"]:9.1f} {row["wt"]:6.2f} {row["vg"]:11.1f} '
              f'{row["hg"]:11.1f} {row["al"]:9.1f} {row["aw"]:11.1f} {row["asat"]:9.1f}')
    print()
    print('  세로기울기 = 위−아래(양수면 위가 밝다 = 위에서 오는 빛)')
    print('  가로기울기 = 좌−우(양수면 왼쪽이 밝다)')
    print()
    wl = np.array([r['wl'] for r in rows]); ww = np.array([r['ww'] for r in rows])
    vg = np.array([r['vg'] for r in rows]); wt = np.array([r['wt'] for r in rows])
    print(f'  벽 밝기      {wl.min():.0f} ~ {wl.max():.0f}  (중앙 {np.median(wl):.0f})')
    print(f'  벽 색온도    {ww.min():+.1f} ~ {ww.max():+.1f}  (중앙 {np.median(ww):+.1f})'
          f'  ← R−B. 양수면 따뜻하다')
    print(f'  세로기울기   {vg.min():+.1f} ~ {vg.max():+.1f}  (중앙 {np.median(vg):+.1f})')
    print(f'  벽 결        {wt.min():.2f} ~ {wt.max():.2f}  (중앙 {np.median(wt):.2f})')


if __name__ == '__main__':
    if '--presets' in sys.argv:
        presets()
    else:
        series()
        print()
        presets()
