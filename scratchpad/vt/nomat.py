#!/usr/bin/env python3
"""매트 없음이 **매트 흉내를 내지 않는가** (브리핑 NO-MAT SAFETY SYSTEM).

작품 경계를 가로지르는 단면에서 두 가지를 본다. 둘 다 **1~2px 임펄스**라 중앙값 필터
잔차로 잰다 — 단조 경계(재질이 바뀌는 자리)는 통과시키고 '그어 넣은 선'만 남긴다.

    ring_up (밝은)   작품 바로 바깥의 밝은 임펄스 = "흰 테두리"
    ring_dn (어두운) 작품 바로 바깥의 어두운 임펄스 = "검은 선"

⚠️⚠️ **한계값을 상상해서 적지 말 것 — 실제 사진으로 재라.**
   예전 판정은 "합성이 더한 임펄스 ≤ 8" 이었다. 그런데 골든 5장(FrameIt, 전부 매트 없음)을
   **같은 코드로** 재면 밝은 1.5~27.4 · 어두운 12.4~24.7(중앙 21.1) 이다.
   즉 그 기준은 **실제 액자 사진도 전부 탈락**시킨다 — 매트 없는 액자의 안쪽 턱은 원래
   또렷한 어두운 전이이기 때문이다. 그 잣대를 들고 튜닝하면 리베이트를 지워야만 통과한다
   (실제로 2026-09-01 에 세 번 헛돌았다: 33→21→33).
   지금은 **골든을 같은 표에 찍고** 그 범위로 판정한다.

⚠️ 골든은 n=5 라 최댓값은 모집단 상한이 아니다. 그래서 **1.5배**를 넘을 때만 실패로 본다 —
   그 기준으로도 라운드 9 의 실제 결함(절차적 액자 밝은 임펄스 33~37)은 잡힌다.
   1.0~1.5배 구간은 '주의'로 찍고 눈으로 확인한다(`slim_ab.png` 같은 확대 시트).

    node nomat.mjs
    python3 nomat.py
    # 선택: 합성만 끈 렌더와의 차등도 보고 싶으면
    SYN=0 SYNDIR=0 NOMAT_OUT=nomat_off node nomat.mjs
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.ndimage import median_filter

HERE = Path('/home/jho4255/ArtLink/scratchpad/vt')
FAIL_X = 1.5          # 골든 최댓값의 몇 배부터 실패로 볼 것인가 (위 주석)


def lum(p):
    return np.asarray(Image.open(p).convert('RGB')).astype(float) @ [.2126, .7152, .0722]


def profiles(L, rect, art):
    """네 변에서 '살 안쪽 → 작품 안쪽' 단면을 뽑는다. 값은 원본 픽셀(리샘플 안 함)."""
    x0, y0, x1, y1 = rect
    ax0, ay0, ax1, ay1 = art
    out = {}
    # 가운데 30% 만 — 코너 마이터가 섞이면 임펄스 판정이 흐려진다
    lo, hi = ax0 + int((ax1 - ax0) * .35), ax0 + int((ax1 - ax0) * .65)
    vo, vi = ay0 + int((ay1 - ay0) * .35), ay0 + int((ay1 - ay0) * .65)
    d = 10                                  # 경계 양옆으로 몇 px 을 볼 것인가
    out['top'] = L[max(0, ay0 - d):ay0 + d, lo:hi].mean(axis=1)
    out['bottom'] = L[ay1 - d:min(L.shape[0], ay1 + d), lo:hi].mean(axis=1)[::-1]
    out['left'] = L[vo:vi, max(0, ax0 - d):ax0 + d].mean(axis=0)
    out['right'] = L[vo:vi, ax1 - d:min(L.shape[1], ax1 + d)].mean(axis=0)[::-1]
    return {k: v for k, v in out.items() if len(v) >= 2 * d - 2}


def impulse(p):
    """중앙값 필터 잔차 — 단조 경계는 0 에 가깝고 1~2px 튐만 남는다."""
    if len(p) < 7:
        return 0.0, 0.0
    res = p - median_filter(p, size=5, mode='nearest')
    return float(res.max()), float(-res.min())


def rings(L, rect, art):
    up = dn = 0.0
    for v in profiles(L, rect, art).values():
        a, b = impulse(v)
        up, dn = max(up, a), max(dn, b)
    return up, dn


def scan(d):
    meta = json.load(open(f'{d}/meta.json'))
    out = {}
    for k, g in meta.items():
        up, dn = rings(lum(f'{d}/{k}.png'), g['rect'], g['art'])
        out[k] = {**{q: g[q] for q in ('name', 'kind', 'mat')},
                  'up': round(up, 1), 'dn': round(dn, 1)}
    return out


def golden_rows():
    import golden as G
    rows = []
    for k, g in sorted(G.GOLD.items()):
        up, dn = rings(lum(f'cases/{k}/frameit_reference.png'), g['rect'], G.art_of(g))
        rows.append((k, g['note'], up, dn))
    return rows


def main():
    gold = golden_rows()
    gu, gd = max(r[2] for r in gold), max(r[3] for r in gold)
    print('매트 없음 — 작품 경계의 임펄스.  **실제 액자 사진(골든)과 같은 표에서** 본다.')
    print(f"\n{'골든 (실제 사진)':22s}{'밝은':>8s}{'어두운':>9s}")
    for k, note, up, dn in gold:
        print(f'  {k:20s}{up:8.1f}{dn:9.1f}   {note}')
    print(f"  {'최댓값':20s}{gu:8.1f}{gd:9.1f}")

    on = scan(HERE / 'nomat')
    try:
        off = scan(HERE / 'nomat_off')
    except FileNotFoundError:
        off = None
    rows = sorted((dict(k=k, **v) for k, v in on.items() if v['mat'] == 0),
                  key=lambda r: r['name'])
    print(f"\n{'액자':16s}{'종류':9s}{'밝은':>7s}{'어두운':>8s}   판정"
          + ('        (합성만 끈 렌더 대비)' if off else ''))
    print('-' * 78)
    bad = warn = 0
    for r in rows:
        f = []
        if r['up'] > gu * FAIL_X:
            f.append('흰 테두리')
        if r['dn'] > gd * FAIL_X:
            f.append('검은 선')
        over = (r['up'] > gu or r['dn'] > gd) and not f
        bad += bool(f)
        warn += over
        v = 'FAIL ' + '·'.join(f) if f else ('주의 골든최대 초과' if over else 'pass')
        d = ''
        if off and r['k'] in off:
            o = off[r['k']]
            d = f"   {r['up'] - o['up']:+6.1f} /{r['dn'] - o['dn']:+6.1f}"
        print(f"{r['name'][:14]:16s}{r['kind']:9s}{r['up']:7.1f}{r['dn']:8.1f}   {v}{d}")
    print('-' * 78)
    print(f'  한계: 골든 최댓값의 {FAIL_X}배 (밝은 {gu * FAIL_X:.1f} · 어두운 {gd * FAIL_X:.1f})')
    print(f'  {len(rows) - bad}/{len(rows)} 통과' + (f'  · 주의 {warn}건' if warn else ''))
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
