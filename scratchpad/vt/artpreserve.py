#!/usr/bin/env python3
"""작품 보존 검사 — 원본이 그대로인가.

사용자가 가장 강하게 못 박은 것: **작품을 자르지도, 늘리지도, 다시 그리지도, 색을
바꾸지도 말 것.** 우리 파이프라인엔 합성 시점에 생성 모델이 없으므로 '다시 그리기'는
구조적으로 불가능하지만, 그걸 **증명**해 두는 게 이 파일이다.

네 가지를 원본 파일과 직접 대조한다.
  aspect_err  비율 오차 %          — 늘리거나 자르면 즉시 커진다
  dE          평균 |ΔRGB| (0~255)  — 사진의 노출·화이트밸런스 정합은 몇 레벨,
                                     '색을 바꾸는' 수준이면 수십 레벨이 된다
  sat_ratio   채도 비              — 1 에서 멀어지면 색을 다시 칠한 것이다
  corr        구조 상관            — 디테일을 더하거나 지우면 1 에서 떨어진다

⚠️ dE 를 0 으로 만들려 하지 말 것 — 방 조명과 전혀 무관한 작품은 오려 붙인 것으로 보인다
   (1차 라운드에서 확인). 여기서 지키는 건 '사진 보정 수준'이라는 상한이다.

    python artpreserve.py
"""
import json
import os
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ART = '/home/jho4255/ArtLink/frontend/public/demo-art'
LIMITS = {'aspect_err': 0.5, 'dE': 14.0, 'sat_lo': 0.90, 'sat_hi': 1.15, 'corr': 0.985}


def main():
    geo = json.load(open(f'{HERE}/renders/geometry.json'))
    suite = {c['id']: c for c in json.load(open(f'{HERE}/suite.json'))['cases']}
    print(f'{"case":5s} {"작품":22s} {"비율오차%":>9s} {"평균ΔRGB":>9s} {"채도비":>7s} {"구조상관":>9s}')
    nfail = 0
    for cid, g in geo.items():
        src = Image.open(f'{ART}/{suite[cid]["work"]}').convert('RGB')
        ax0, ay0, ax1, ay1 = g['art']
        ren = Image.open(f'{HERE}/renders/{cid}.png').convert('RGB').crop((ax0, ay0, ax1 + 1, ay1 + 1))
        n = (240, max(1, round(240 * ren.height / ren.width)))
        a = np.asarray(src.resize(n, Image.LANCZOS)).astype(float)
        b = np.asarray(ren.resize(n, Image.LANCZOS)).astype(float)
        dE = float(np.abs(a - b).mean())
        sa, sb = (a.max(2) - a.min(2)).mean(), (b.max(2) - b.min(2)).mean()
        sat = float(sb / max(1, sa))
        corr = float(np.corrcoef(a.mean(2).ravel(), b.mean(2).ravel())[0, 1])
        ae = abs((ax1 - ax0 + 1) / (ay1 - ay0 + 1) / g['srcAspect'] - 1) * 100
        bad = (ae > LIMITS['aspect_err'] or dE > LIMITS['dE'] or corr < LIMITS['corr']
               or not LIMITS['sat_lo'] <= sat <= LIMITS['sat_hi'])
        nfail += bad
        print(f'{cid:5s} {suite[cid]["work"][:22]:22s} {ae:9.3f} {dE:9.1f} {sat:7.2f} {corr:9.4f}'
              + ('   FAIL' if bad else '   pass'))
    print(f'\n한계  비율≤{LIMITS["aspect_err"]}%  ΔRGB≤{LIMITS["dE"]}  '
          f'채도 {LIMITS["sat_lo"]}~{LIMITS["sat_hi"]}  상관≥{LIMITS["corr"]}')
    print(f'케이스 {len(geo)} 중 {len(geo) - nfail} 통과')
    return 1 if nfail else 0


if __name__ == '__main__':
    sys.exit(main())
