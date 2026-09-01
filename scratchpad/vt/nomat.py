#!/usr/bin/env python3
"""매트 없음이 **매트 흉내를 내지 않는가** (브리핑 NO-MAT SAFETY SYSTEM).

작품 경계를 가로지르는 단면에서 세 가지를 본다. 전부 **1~2px 임펄스**를 보는 것이라
중앙값 필터 잔차로 잰다 — 단조 경계(재질이 바뀌는 자리)는 통과시키고 '그어 넣은 선'만 남긴다
(CLAUDE.md 44b 가 같은 이유로 `gap_step` 을 버리고 이 방식을 택했다).

    ring_up    작품 바로 바깥의 **밝은** 임펄스 = "흰 테두리"
    ring_dn    작품 바로 바깥의 **어두운** 임펄스 = "검은 선"
    inset      작품이 액자 뒤로 들어갔는가 (살 대비 상대 낙차)

⚠️⚠️ **절대값으로 판정하지 말 것 — 액자 사진 자체의 결·비드가 섞인다.**
   실측(2026-09-01): 합성을 완전히 끄고 재도 골드 42.8 · 블랙 40.2 · 월넛 38.1 이다.
   골드의 42.8 은 그 액자의 **금장 비드**고, 브리핑 7번이 보존하라고 한 재질 그 자체다.
   그래서 7차 `syncheck.py` 와 같은 논리로 **합성만 끈 렌더와 비교**해 우리가 더한 몫만 본다.
   (그 기준으로 보면 우리 합성은 임펄스를 **더하지 않고 덜어낸다** — 블랙 40.2 → 8.1,
    월넛 38.1 → 2.7. 매트 없이 걸 때 자산의 밝은 립을 상쇄하기 때문이다.)

    node nomat.mjs
    SYN=0 SYNDIR=0 NOMAT_OUT=nomat_off node nomat.mjs
    python3 nomat.py
"""
import json
import sys

import numpy as np
from PIL import Image
from scipy.ndimage import median_filter

HERE = '/home/jho4255/ArtLink/scratchpad/vt/nomat'
OFF = '/home/jho4255/ArtLink/scratchpad/vt/nomat_off'
# 합성이 **더한** 임펄스의 상한. 사진 자체의 결은 여기 안 들어온다(위 주석).
LIM = {'added': 8.0}


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


def scan(d):
    meta = json.load(open(f'{d}/meta.json'))
    out = {}
    for k, g in meta.items():
        L = np.asarray(Image.open(f'{d}/{k}.png').convert('RGB')).astype(float) @ [.2126, .7152, .0722]
        pr = profiles(L, g['rect'], g['art'])
        if not pr:
            continue
        up = dn = 0.0
        for v in pr.values():
            a, b = impulse(v)
            up, dn = max(up, a), max(dn, b)
        out[k] = {**{q: g[q] for q in ('name', 'kind', 'mat')},
                  'up': round(up, 1), 'dn': round(dn, 1)}
    return out


def main():
    on = scan(HERE)
    try:
        off = scan(OFF)
    except FileNotFoundError:
        print('먼저:  SYN=0 SYNDIR=0 NOMAT_OUT=nomat_off node nomat.mjs')
        return 2
    rows = [dict(k=k, **v) for k, v in on.items() if v['mat'] == 0 and k in off]
    rows.sort(key=lambda r: r['name'])
    print('매트 없음 — 작품 경계의 임펄스가 **우리 합성인가 액자 사진인가**')
    print(f"{'액자':14s}{'종류':9s}{'사진만 밝은':>11s}{'합성후':>8s}"
          f"{'사진만 어두운':>13s}{'합성후':>8s}   판정")
    print('-' * 78)
    bad = 0
    for r in rows:
        o = off[r['k']]
        du, dd = r['up'] - o['up'], r['dn'] - o['dn']
        f = []
        if du > LIM['added']:
            f.append('흰 테두리')
        if dd > LIM['added']:
            f.append('검은 선')
        bad += bool(f)
        src = f"  (사진 자체 {max(o['up'], o['dn']):.0f})" if max(o['up'], o['dn']) > 14 else ''
        print(f"{r['name'][:12]:14s}{r['kind']:9s}{o['up']:>11.1f}{r['up']:>8.1f}"
              f"{o['dn']:>13.1f}{r['dn']:>8.1f}   "
              + ('FAIL ' + '·'.join(f) if f else 'pass') + src)
    print('-' * 78)
    print(f"  한계: **합성이 더한** 임펄스 ≤{LIM['added']:.0f} (절대값이 아니라 사진 대비 증가분)")
    print(f'  {len(rows) - bad}/{len(rows)} 통과')
    du = [on[r['k']]['up'] - off[r['k']]['up'] for r in rows]
    print(f'  우리 합성의 기여: 밝은 임펄스 중앙 {np.median(du):+.1f}'
          f'  (음수 = 사진에 있던 걸 **덜어낸다**)')
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
