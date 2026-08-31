#!/usr/bin/env python3
"""조명 슬라이더 판정 — 강도를 올릴 때 무엇이 얼마나 변하는가.

FrameIt 은 강도를 올리면 작품까지 함께 망가진다(채도 92.6 → 46.5). 우리는 그러면 안 되므로
**강도 100 에서도 작품이 보존되는지**를 매번 잰다. 동시에 조명이 조각 경계에 테를 만들지
않는지(마스크 테 = 라운드 2~5 의 반복 함정)도 본다.

  작품 dE       조명 0 대비 작품 픽셀의 평균 |ΔRGB|      ≤ 12   (artpreserve 는 14)
  작품 채도비   조명 0 대비 채도 비                      0.90~1.10
                (artpreserve 와 **같은 한계** — 조명을 100 까지 올려도 작품 보존 약속은 그대로)
  작품 대비비   지역 대비(밴드패스 std) 비               ≥ 0.90  (뭉개면 안 된다)
  그늘구석      광원 반대쪽 구석의 밝기 배율             강도 100 에서 0.62~0.84
  방향성        광원 쪽 구석 배율 / 그늘 쪽 구석 배율     ≥ 1.06 (1 이면 그냥 비네트다)
  경계 spike    조각 경계가 양옆보다 어두워진 정도       ≤ 12   (metrics 와 같은 임계)

    node light.mjs strengths && python lightcheck.py
"""
import json
import os
import sys

import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter

import metrics

HERE = os.path.dirname(os.path.abspath(__file__))
LIM = dict(dE=12.0, sat_lo=0.90, sat_hi=1.10, con=0.90,
           corner_lo=0.62, corner_hi=0.84, spike=12.0, dir=1.06)


def band(L):
    return L - gaussian_filter(L, 3)


def main():
    meta = json.load(open(f'{HERE}/light/strengths_meta.json'))
    keys = list(meta)
    scenes = []
    for k in keys:
        s = meta[k]['scene']
        if s not in scenes:
            scenes.append(s)
    print(f'{"장면":16s} {"강도":>5s} {"작품dE":>7s} {"채도비":>7s} {"대비비":>7s} '
          f'{"그늘구석":>8s} {"방향성":>7s} {"경계spike":>9s} {"작품R-B":>8s}')
    nfail = 0
    for sc in scenes:
        ks = [k for k in keys if meta[k]['scene'] == sc]
        base = None
        for k in ks:
            im = np.asarray(Image.open(f'{HERE}/light/strengths_{k}.png').convert('RGB')).astype(float)
            pr = meta[k]['probe']
            a = pr['art']
            ax0, ay0 = int(a['x']) + 4, int(a['y']) + 4
            ax1, ay1 = int(a['x'] + a['w']) - 4, int(a['y'] + a['h']) - 4
            art = im[ay0:ay1, ax0:ax1]
            L = im.mean(2)
            h, w = L.shape
            c = 40
            corners = np.concatenate([L[:c, :c].ravel(), L[:c, -c:].ravel(),
                                      L[-c:, :c].ravel(), L[-c:, -c:].ravel()])
            # 방향성 — **광원 쪽 구석 vs 반대쪽 구석**. 이게 없으면 조명이 아니라 비네트다.
            # (밝히는 항이 없으므로 '웅덩이 밝기'가 아니라 '덜 어두워진 쪽'을 본다)
            ld = meta[k].get('ld') or [-1, -1]
            nn = float(np.hypot(ld[0], ld[1])) or 1.0
            ux, uy = ld[0] / nn, ld[1] / nn
            cs = {'tl': L[:c, :c], 'tr': L[:c, -c:], 'bl': L[-c:, :c], 'br': L[-c:, -c:]}
            vec = {'tl': (-1, -1), 'tr': (1, -1), 'bl': (-1, 1), 'br': (1, 1)}
            dots = {k2: (v[0] * ux + v[1] * uy) for k2, v in vec.items()}
            lit = max(dots, key=dots.get)
            dark = min(dots, key=dots.get)
            st = dict(sat=float((art.max(2) - art.min(2)).mean()),
                      con=float(band(art.mean(2)).std()),
                      corner=float(corners.mean()),
                      lit=float(cs[lit].mean()), dark=float(cs[dark].mean()),
                      warm=float((art[..., 0] - art[..., 2]).mean()))
            L0 = meta[k]['light']
            if L0 == 0:
                base = (art.copy(), st)
                print(f'{sc:16s} {0:5d} {0:7.1f} {1.0:7.2f} {1.0:7.2f} '
                      f'{1.0:8.2f} {1.0:7.2f} {"—":>9s} {st["warm"]:8.1f}')
                continue
            b_art, b_st = base
            dE = float(np.abs(art - b_art).mean())
            sat = st['sat'] / max(b_st['sat'], 1e-6)
            con = st['con'] / max(b_st['con'], 1e-6)
            # ⚠️ 네 구석 **평균**으로 판정하지 말 것 — 편심을 준 필드라 광원 쪽 구석은
            # 거의 안 어두워진다. 평균으로 보면 그늘 쪽이 충분히 내려가도 통과가 안 된다.
            # 조명의 세기는 **그늘 쪽 구석**이 얼마나 내려갔는가로 본다.
            cor = st['dark'] / max(b_st['dark'], 1e-6)
            # 방향성 = (광원 쪽 구석 배율) / (반대쪽 구석 배율). 1 이면 순수 비네트다.
            dirn = ((st['lit'] / max(b_st['lit'], 1e-6))
                    / max(st['dark'] / max(b_st['dark'], 1e-6), 1e-6))
            # 경계 spike — 조각 사각형을 metrics 로
            p = pr['piece']
            rect = (int(p['x']), int(p['y']), int(p['x'] + p['w']) - 1, int(p['y'] + p['h']) - 1)
            arect = (ax0, ay0, ax1, ay1)
            try:
                an = metrics.analyse(Image.open(f'{HERE}/light/strengths_{k}.png'),
                                     rect, arect, pr['railPx'])
                spike = an['keyline_spike'] if an else float('nan')
            except Exception:
                spike = float('nan')
            bad = (dE > LIM['dE'] or not LIM['sat_lo'] <= sat <= LIM['sat_hi']
                   or con < LIM['con'] or (spike == spike and spike > LIM['spike'])
                   or (L0 == 1.0 and (not LIM['corner_lo'] <= cor <= LIM['corner_hi']
                                      or dirn < LIM['dir'])))
            nfail += bad
            print(f'{sc:16s} {int(L0*100):5d} {dE:7.1f} {sat:7.2f} {con:7.2f} '
                  f'{cor:8.2f} {dirn:7.2f} {spike:9.1f} {st["warm"]:8.1f}'
                  + ('   FAIL' if bad else ''))
    print()
    print(f'한계  작품dE≤{LIM["dE"]}  채도비 {LIM["sat_lo"]}~{LIM["sat_hi"]}  '
          f'대비비≥{LIM["con"]}  경계spike≤{LIM["spike"]}  '
          f'강도100 그늘구석 {LIM["corner_lo"]}~{LIM["corner_hi"]} · 방향성≥{LIM["dir"]}')
    print(f'{"실패 없음" if not nfail else str(nfail) + "건 실패"}')
    return 1 if nfail else 0


if __name__ == '__main__':
    sys.exit(main())
