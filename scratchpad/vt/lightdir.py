#!/usr/bin/env python3
"""장면의 광원 방향(lightDir)을 **사진에서 측정**해 scenes.json 을 갱신한다.

⚠️ 왜 필요한가 (2026-08-30 실측):
   `scenes.json` 의 lightDir 이 17개 장면 모두 `[-1,-1]`(좌상단) 로 손으로 적혀 있었는데,
   컬렉터 살롱 사진은 **벽 위쪽 110 / 아래쪽 159** 로 아래가 훨씬 밝다. 즉 데이터가
   사진과 반대였다. 그러면 액자 살·매트 음영이 방과 **거꾸로** 칠해진다
   (그 장면에서만 매트 위아래 밝기차가 −7 로 뒤집혀 나왔다).

   작품 자리 **바로 바깥 띠**의 밝기를 위/아래/좌/우로 재서 밝은 쪽을 광원으로 본다.
   가구·바닥이 섞이지 않게 좁은 띠만 쓴다. 기울기가 미약하면(평평한 매크로 벽) 그대로 둔다.

    python lightdir.py          # 측정만
    python lightdir.py --write  # scenes.json 갱신
"""
import json
import os
import sys

import numpy as np
from PIL import Image

ROOT = '/home/jho4255/ArtLink/frontend/public/artlook'
J = f'{ROOT}/scenes/scenes.json'
MIN_TILT = 4.0     # 이보다 약하면 방향을 못 정한다 → 기존 값 유지


def lum(a):
    return a[..., 0] * .2126 + a[..., 1] * .7152 + a[..., 2] * .0722


def estimate(path, quad):
    L = lum(np.asarray(Image.open(path).convert('RGB')).astype(float))
    h, w = L.shape
    xs = [p[0] for p in quad]
    ys = [p[1] for p in quad]
    x0, x1 = int(min(xs) * w), int(max(xs) * w)
    y0, y1 = int(min(ys) * h), int(max(ys) * h)
    bw = max(6, int((x1 - x0) * .22))
    bh = max(6, int((y1 - y0) * .22))

    def m(a, b, c, d):
        a, b = max(0, a), max(0, b)
        c, d = min(h, c), min(w, d)
        return float(L[a:c, b:d].mean()) if c > a and d > b else None
    up = m(y0 - bh, x0, y0, x1)
    dn = m(y1, x0, y1 + bh, x1)
    lf = m(y0, x0 - bw, y1, x0)
    rt = m(y0, x1, y1, x1 + bw)
    if None in (up, dn, lf, rt):
        return None, None
    vx, vy = lf - rt, up - dn          # 밝은 쪽이 광원
    n = np.hypot(vx, vy)
    if n < MIN_TILT:
        return None, round(float(n), 1)
    ux, uy = vx / n, vy / n
    # ⚠️ **벽 밝기 기울기 = 조명 낙차이지 광원 위치가 아니다.**
    #    실내 사진은 바닥·가구 반사 때문에 벽 아래가 밝은 경우가 많은데(컬렉터 살롱
    #    위 110 / 아래 159), 그걸 그대로 쓰면 광원이 아래에 있는 셈이 되어
    #    **그림자가 위로 지고 접지 그림자가 사라진다**(실측 contact 48→1.7).
    #    가로 성분(창이 어느 쪽인가)은 믿되, 세로는 **항상 위**로 둔다 —
    #    실내 광원은 천장·창이라 예외가 드물다. 위가 밝으면 그만큼 더 강하게.
    # ⚠️ 세로 성분이 **거의 0 일 때도** 위로 세워야 한다. 예전엔 `uy > 0` 일 때만
    #    뒤집어서, 측정이 −0.03 으로 나온 방(gallery-living)은 **순수 수평광**이 됐다.
    #    그러면 위살·아래살이 같은 밝기라 액자가 인쇄한 띠로 보인다(dir_tb 6.6 실측).
    uy = -max(0.35, abs(uy))
    m = np.hypot(ux, uy)
    return [round(float(ux / m), 2), round(float(uy / m), 2)], round(float(n), 1)


def main():
    d = json.load(open(J, encoding='utf-8'))
    changed = 0
    for s in d['scenes']:
        q = s.get('region') or s.get('opening')
        if not q:
            continue
        est, tilt = estimate(os.path.join(ROOT, s['src']), q)
        old = s.get('lightDir')
        if est is None:
            print(f'{s["id"]:18s} 기울기 {tilt:6.1f}  → 약함, 유지 {old}')
            continue
        # 세로 성분이 뒤집혔거나 30° 이상 어긋나면 갱신
        flip = old and (old[1] * est[1] < 0 or old[0] * est[0] < 0)
        print(f'{s["id"]:18s} 기울기 {tilt:6.1f}  측정 {est}  기존 {old}'
              + ('   ← 뒤집힘' if flip else ''))
        if '--write' in sys.argv:
            s['lightDir'] = est
            changed += 1
    if '--write' in sys.argv:
        json.dump(d, open(J, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        print(f'\n{changed}개 갱신 → {J}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
