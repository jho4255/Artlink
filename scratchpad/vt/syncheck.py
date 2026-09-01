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

# ⚠️⚠️ **`rail_span` 이 아니라 `face_span` 으로 잰다** (2026-09-01).
#   `rail_span` 은 살 전체(모따기~안쪽 사면)라 **리베이트 골**이 들어간다. 그런데 리베이트는
#   자산에 없는 것을 우리가 만들어야 하는 자리다 — 사진 액자의 개구부 안쪽은 촬영 때 댄
#   밝은 회색판의 반사광이라 물리적으로 **거꾸로**다(앞면의 3.6배까지 밝다).
#   그래서 리베이트를 옳게 파낼수록 이 지표는 '합성 과다'로 잡혔다(t08 +158%).
#   실측으로 갈라 보면 앞면만의 span 은 **오히려 줄어든다**(t08 −26% · t10 −7%) —
#   즉 우리는 액자 재질을 덮어쓰고 있지 않다. 물음("원본 사진을 보존하는가")이 향해야 할
#   곳은 **재질이 있는 앞면**이다.
LIM = {'syn_delta': 25.0,   # 살 **앞면** 대비를 합성이 몇 % 바꾸는가 (원본 대비)
       'dir_gain': 8.0,     # 장면 광원 추종이 **없으면 생겨야** 한다(위살↔아래살 증가분)
       'dir_rel': 0.13}     # 다만 **이미 따르고 있으면** 더할 이유가 없다(아래 주석)


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
# ⚠️ t02·t10 의 28~29% 는 **리베이트 개선 이전부터 있던 값**이다(2026-09-01 확인:
#    기준선 렌더와 이번 렌더의 face_span 기여가 소수점까지 같다 — 28.3/28.3 · 29.0/29.0).
#    `rail_span` 으로 재던 시절엔 리베이트 골에 묻혀 안 보였을 뿐이다. 새 결함이 아니므로
#    이번 라운드에서 건드리지 않는다 — 다만 '앞면 대비가 줄어든다'는 신호이므로 남겨 둔다.
EXEMPT_DELTA = {'flat', 'floater', 'mat', 'canvas'}
EXEMPT_GAIN = {'canvas'}


if __name__ == '__main__':
    (off, kind), (on, _) = load('renders_off'), load('renders')
    keys = sorted(set(off) & set(on))
    print('case   살앞면(OFF→ON)   합성기여%   방향광(OFF→ON)   증가   판정')
    print('-' * 72)
    bad = 0
    for k in keys:
        a, b = off[k]['face_span'], on[k]['face_span']
        da, db = off[k]['dir_tb'], on[k]['dir_tb']
        d = abs(b - a) / max(a, 1) * 100
        g = db - da
        kd = kind.get(k, '?')
        f = []
        if d > LIM['syn_delta'] and kd not in EXEMPT_DELTA:
            f.append('합성과다')
        # ⚠️⚠️ **'우리가 방향광을 더했는가'로 판정하면 안 된다** (2026-09-01 수정).
        #   8차에서 자산의 baked 조명을 재기 시작하면서, **자산이 이미 장면과 맞는**
        #   액자(검정·월넛·골드)에는 아무것도 더하지 않게 됐다 — 그게 브리핑이 요구한
        #   "SOURCE-FIRST / 이미 있으면 다시 만들지 않는다" 이고 가장 좋은 상태다.
        #   그런데 옛 판정은 그걸 '광원무시 FAIL' 로 잡았다. 재야 하는 건 **결과물이
        #   장면 광원을 따르는가**지 우리가 손을 댔는가가 아니다.
        #   장면 광원은 언제나 위에서 온다(`sceneLightModel` 이 세로를 위로 고정한다) →
        #   최종 렌더에서 위살이 아래살보다 밝고 상대 낙차가 밴드 안이면 통과.
        follows = (on[k]['per_side']['top']['rail'] > on[k]['per_side']['bottom']['rail']
                   and on[k].get('dir_rel', 0) >= LIM['dir_rel'])
        if g < LIM['dir_gain'] and not follows and kd not in EXEMPT_GAIN:
            f.append('광원무시')
        bad += bool(f)
        print(f'{k:6s} {a:6.1f}→{b:6.1f} {d:9.1f}%   {da:5.1f}→{db:5.1f} {g:+7.1f}   '
              + ('FAIL ' + '·'.join(f) if f else ('pass' if kd not in EXEMPT_DELTA | EXEMPT_GAIN
                                                  else f'pass ({kd} 면제)')))
    print('-' * 72)
    print(f"  한계: 합성 기여 ≤{LIM['syn_delta']}%  ·  방향광 증가 ≥{LIM['dir_gain']}")
    print(f'  {len(keys) - bad}/{len(keys)} 통과')
    sys.exit(1 if bad else 0)
