#!/usr/bin/env python3
"""매트(대지)와 액자↔작품 '틈' 전용 지표.

사용자 지적(2026-08-30): "액자랑 그림 사이 틈이 조악하고 평면적이다. 매트도 FrameIt 은
사실적인데 우리는 그냥 하얀색이라 퀄이 떨어진다."

레퍼런스 `sampleframe.png`(FrameIt Pro 결과물)를 확대하면 매트가 **색면이 아니다**.
① 종이 결이 뚜렷하고 ② 위→아래로 밝기가 크게 기울고 ③ 개구부에 45° 사면이 있다.

⚠️ **그레인·방향광은 절대 레벨로도 함께 볼 것.** 비율만 보면 어두운 매트(L 69)와
   흰 매트(L 231)를 같은 잣대로 못 잰다 — 흰 매트에서 9% 는 std 21 이라 모래알이 된다.
   골든의 절대값(그레인 std ≈6, 방향광 ≈34레벨)이 실제 목표다.

    python mat.py          # 골든 + 우리 렌더 비교
"""
import json
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))

# FrameIt Pro 레퍼런스 — 손으로 확정(단면 프로파일을 직접 읽어 확인)
GOLDEN = {'path': '/home/jho4255/ArtLink/sampleframe.png',
          'piece': [272, 72, 886, 784], 'art': [404, 183, 760, 675],
          'rail': 22, 'mat': 80}
# 목표: 골든의 **절대값**에 맞춘다 (그레인 std 6, 방향광 34레벨, 개구부 사면 있음)
# ⚠️ 임계 근거가 **골든 두 장**이다 — 검은 매트(sampleframe)와 흰 매트(sample3).
#    처음엔 검은 매트만 보고 dir_abs>=18 로 잡았는데, 흰 매트 골든은 6.7 이다.
#    매트 색이 아니라 **그 장면의 조명 세기** 차이다(sample3 는 균일 스튜디오 광).
#    그래서 방향광은 '0 이 아닐 것'을 본다. 대신 gap_pct 에는 **상한**을 새로 걸었다 —
#    우리 개구부가 90% 로 새까매져 오히려 '오려 낸 구멍'이 됐기 때문(골든 흰 매트 48%).
LIMITS = {'grain_abs': ('>=', 6.0, '매트 종이 결(절대 std). 골든 6.4(검정)~13.5(흰색)'),
          'dir_abs': ('>=', 5.0, '매트 위↔아래 밝기차(절대). 골든 6.7(흰)~31.6(검정)'),
          'bevel_abs': ('>=', 8.0, '개구부 45° 사면의 밝기 낙차(절대)'),
          'gap_pct': ('range', (20.0, 65.0), '틈 깊이 ÷ 매트 밝기 %. 골든 흰 매트 48%')}


def lum(a):
    return a[..., 0] * .2126 + a[..., 1] * .7152 + a[..., 2] * .0722


def measure(path, piece, art, rail, mat):
    L = lum(np.asarray(Image.open(path).convert('RGB')).astype(float))
    x0, y0, x1, y1 = piece
    ax0, ay0, ax1, ay1 = art
    pw = x1 - x0 + 1
    cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
    W = max(6, int(pw * .05))               # 변 방향 평균 폭 — 좁게(넓으면 결이 지워진다)

    def band(v0, v1, vert, fixed):
        if vert:
            return L[max(0, v0):v1, fixed - W:fixed + W]
        return L[fixed - W:fixed + W, max(0, v0):v1].T

    pad = max(3, int(mat * .25))
    segs = {'top': band(y0 + rail + pad, ay0 - pad, True, cx),
            'bottom': band(ay1 + pad, y1 - rail - pad, True, cx)[::-1],
            'left': band(x0 + rail + pad, ax0 - pad, False, cy),
            'right': band(ax1 + pad, x1 - rail - pad, False, cy)[::-1]}
    segs = {k: v for k, v in segs.items() if v.size > 40}
    if len(segs) < 3:
        return None
    mats = {k: float(np.median(v)) for k, v in segs.items()}
    mm = float(np.mean(list(mats.values())))
    grain = float(np.mean([(v - ndimage.gaussian_filter(v, 2.0)).std() for v in segs.values()]))
    # ⚠️ **절대값으로 볼 것.** 광원이 아래에서 오는 방에서는 매트 위쪽이 어두운 게
    #    정상이다(부호가 뒤집힌다). 중요한 건 '위아래가 다른가'다.
    dir_abs = abs(mats.get('top', mm) - mats.get('bottom', mm))

    # 개구부의 골. ⚠️ **작품 안쪽을 깊이 훑지 말 것** — 어두운 그림이 있으면 그 픽셀이
    #    '틈'으로 잡혀 액자와 무관하게 90% 가 나온다(실측). 매트 쪽만 넓게 보고
    #    작품 쪽은 경계 직후 몇 px 만 본다(리베이트 그림자가 거기 있다).
    g = max(6, int(pw * .035))
    gi = max(3, int(pw * .006))
    gaps, bevels = {}, {}
    for k, (a, b, vert, fixed) in {
            'top': (ay0 - g, ay0 + gi, True, cx), 'bottom': (ay1 - gi, ay1 + g, True, cx),
            'left': (ax0 - g, ax0 + gi, False, cy), 'right': (ax1 - gi, ax1 + g, False, cy)}.items():
        seg = band(a, b, vert, fixed)
        if seg.size < 20:
            continue
        p = seg.mean(axis=1)
        if k in ('bottom', 'right'):
            p = p[::-1]                      # 항상 매트 → 작품 방향으로
        half = len(p) // 2
        gaps[k] = mats.get(k, mm) - float(p.min())
        # 사면 = 매트 평탄부에서 골까지의 **단조 낙차**(작품 쪽 그림자와 구분)
        bevels[k] = float(p[:half].max() - p[:half].min())
    return {'mat_lum': round(mm, 1),
            'grain_abs': round(grain, 2), 'grain_pct': round(grain / mm * 100, 2),
            'dir_abs': round(dir_abs, 1), 'dir_pct': round(dir_abs / mm * 100, 1),
            'bevel_abs': round(float(np.mean(list(bevels.values()))), 1),
            'gap_abs': round(float(np.mean(list(gaps.values()))), 1),
            'gap_pct': round(float(np.mean(list(gaps.values()))) / mm * 100, 1)}


def ok(n, v):
    k, l = LIMITS[n][0], LIMITS[n][1]
    if k == 'range':
        return l[0] <= v <= l[1]
    return v >= l if k == '>=' else v <= l


def main():
    G = measure(GOLDEN['path'], GOLDEN['piece'], GOLDEN['art'], GOLDEN['rail'], GOLDEN['mat'])
    cols = ['mat_lum', 'grain_abs', 'grain_pct', 'dir_abs', 'dir_pct', 'bevel_abs', 'gap_pct']
    print(f'{"":26s} ' + ' '.join(f'{c:>10s}' for c in cols))
    print(f'{"■ 골든 FrameIt Pro":26s} ' + ' '.join(f'{G[c]:10.2f}' for c in cols))
    geo = json.load(open(f'{HERE}/renders/geometry.json'))
    rows, nfail = {}, 0
    for cid, g in geo.items():
        if g['matPx'] < 6:
            continue
        v = measure(f'{HERE}/renders/{cid}.png', g['rect'], g['art'], g['railPx'], g['matPx'])
        if not v:
            continue
        rows[cid] = v
        bad = [m for m in LIMITS if not ok(m, v[m])]
        nfail += bool(bad)
        mark = ' '.join(f'{("!" if c in bad else "") + f"{v[c]:.2f}":>10s}' for c in cols)
        print(f'{cid + " " + g["frame"] + " mat" + str(g["mat"]):26s} {mark}'
              + ('   FAIL' if bad else '   pass'))
    print(f'\n{"한계":26s} ' + ' '.join(
        f'{(str(LIMITS[c][1]) if LIMITS[c][0] == "range" else LIMITS[c][0] + str(LIMITS[c][1])) if c in LIMITS else "":>10s}' for c in cols))
    for m, (_k, _l, why) in LIMITS.items():
        n = sum(1 for v in rows.values() if ok(m, v[m]))
        print(f'  {m:11s} {n}/{len(rows)} 통과   {why}')
    print(f'\n매트 케이스 {len(rows)} 중 {len(rows) - nfail} 통과')
    json.dump({'golden': G, 'ours': rows}, open(f'{HERE}/reports/mat_last.json', 'w'), indent=1)
    return 1 if nfail else 0


if __name__ == '__main__':
    sys.exit(main())
