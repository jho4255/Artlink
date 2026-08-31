#!/usr/bin/env python3
"""합성 음영이 **지배적인가**를 잰다 (2026-09-01 기준 변경).

새 평가 기준은 '입체감이 더 강해졌나'가 아니라 **'아무것도 안 한 것처럼 자연스러운가'** 다.
그런데 절대값 지표(`rail_span` 등)로는 그걸 못 가른다 — 값이 커도 그게 **액자 사진 자체**의
대비일 수 있기 때문이다(실측: 합성을 다 꺼도 73.5, 켜면 75.2).

그래서 **같은 입력으로 합성만 끈 렌더**와 비교한다. 원본이 주인공이고 합성은 거들 뿐이어야 한다.

    SYN=0 SYNDIR=0 node render.mjs renders_off
    node render.mjs
    python syncheck.py
"""
import json
import sys

import numpy as np

import metrics as M

LIM = {'syn_delta': 25.0,   # 살 단면 대비를 합성이 몇 % 바꾸는가 (원본 대비)
       'dir_gain': 8.0}     # 장면 광원 추종은 **생겨야** 한다(위살↔아래살 차이 증가분)


def load(d):
    geo = json.load(open(f'{d}/geometry.json'))
    out, kind = {}, {}
    for k, c in geo.items():
        v = M.analyse(f'{d}/{k}.png', c['rect'], c['art'], c['railPx'])
        if v:
            out[k] = v
            kind[k] = c.get('frameKind', '?')
    return out, kind


# 면제 — 임계 완화가 아니라 **해당 없음**
#  · syn_delta 는 "원본 사진을 보존하는가"를 재는 것이라 **사진 액자에만** 뜻이 있다.
#    절차적 액자(flat/floater/mat)는 보존할 원본이 없다 — 그림 자체가 합성이다.
#  · dir_gain 은 SYN 노브로 끄고 켜서 재는데, 캔버스 랩의 옆면 음영은 그 노브를 타지 않는다
#    (액자가 아니라 그림이 감긴 면이다). 실제로는 광원을 따른다(dir_tb 75).
EXEMPT_DELTA = {'flat', 'floater', 'mat', 'canvas'}
EXEMPT_GAIN = {'canvas'}


if __name__ == '__main__':
    (off, kind), (on, _) = load('renders_off'), load('renders')
    keys = sorted(set(off) & set(on))
    print('case   살단면(OFF→ON)   합성기여%   방향광(OFF→ON)   증가   판정')
    print('-' * 72)
    bad = 0
    for k in keys:
        a, b = off[k]['rail_span'], on[k]['rail_span']
        da, db = off[k]['dir_tb'], on[k]['dir_tb']
        d = abs(b - a) / max(a, 1) * 100
        g = db - da
        kd = kind.get(k, '?')
        f = []
        if d > LIM['syn_delta'] and kd not in EXEMPT_DELTA:
            f.append('합성과다')
        if g < LIM['dir_gain'] and kd not in EXEMPT_GAIN:
            f.append('광원무시')
        bad += bool(f)
        print(f'{k:6s} {a:6.1f}→{b:6.1f} {d:9.1f}%   {da:5.1f}→{db:5.1f} {g:+7.1f}   '
              + ('FAIL ' + '·'.join(f) if f else ('pass' if kd not in EXEMPT_DELTA | EXEMPT_GAIN
                                                  else f'pass ({kd} 면제)')))
    print('-' * 72)
    print(f"  한계: 합성 기여 ≤{LIM['syn_delta']}%  ·  방향광 증가 ≥{LIM['dir_gain']}")
    print(f'  {len(keys) - bad}/{len(keys)} 통과')
    sys.exit(1 if bad else 0)
