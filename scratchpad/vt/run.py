#!/usr/bin/env python3
"""골든 회귀 실행 — 지표 계산 · 임계 판정 · 반복 간 비교.

    python run.py                지표 + 판정
    python run.py --crops        100% 코너/변 크롭까지 생성 (증거)
    python run.py --save NAME    이번 결과를 반복 기록으로 저장
    python run.py --vs NAME      저장된 반복과 비교 (회귀 감시)

⚠️ **임계값은 FrameIt 레퍼런스 실측에서 유도했다.** 통과시키려고 느슨하게 고치지 말 것 —
   그 순간 이 표는 아무것도 보증하지 않는 장식이 된다. 근거는 아래 표에 적어 뒀다.
"""
import json
import os
import sys

import numpy as np
from PIL import Image

import metrics as M

HERE = os.path.dirname(os.path.abspath(__file__))
R = os.path.join(HERE, 'renders')

#              판정          근거(FrameIt 5장 실측)
LIMITS = {
    'keyline_spike': ('<=', 12.0,          '0.0~8.2', '벽↔액자 경계의 검은 테 = 잘라 붙인 티'),
    # ⚠️ 절대 낙차가 아니라 **비율**로 판정한다. 검은 액자는 살이 이미 어두워(L≈40)
    #    물리적으로 옳게 그늘져도 절대 낙차가 30 을 못 넘는다 — 재질 때문에 실패하면
    #    지표가 렌더 품질을 못 재는 것이다. 눈도 상대 대비로 읽는다.
    'rebate_ratio':  ('range', (0.24, 0.85),          '0.26~0.80', '작품이 액자 뒤로 들어간 깊이(상대 대비)'),
    'rail_span':     ('>=', 20.0,          '7~54',    '살 단면 밝기 낙차 — 몰딩인가 인쇄한 띠인가'),
    'dir_tb':        ('range', (15.0, 95.0),          '30~90',   '위살↔아래살 밝기차 — 방향광을 받는가'),
    'contact_drop':  ('range', (20., 85.), '22~79',   '접지 그림자 세기(절대 밝기 낙차)'),
    'recover_pct':   ('range', (5., 30.),  '1~24',    '그림자가 사라지는 거리(조각 폭 %)'),
    'aspect_err':    ('<=', 0.5,           '0',       '작품 비율 보존 % (CLAUDE.md 18)'),
}
ORDER = list(LIMITS)
# 살이 12px 미만이면 프로파일을 담을 자리가 없다 — 레퍼런스도 8px 짜리는 span 6.8 이다.
THIN_RAIL = 12


def ok(name, v, g):
    kind, lim = LIMITS[name][0], LIMITS[name][1]
    if v is None:
        return True
    if name == 'rail_span' and g.get('railPx', 99) < THIN_RAIL:
        return True
    # 액자가 없는 캔버스랩은 리베이트가 물리적으로 존재하지 않는다.
    # FrameIt 의 캔버스랩(case_08) 도 0.133 이다 — 임계를 낮추는 게 아니라 해당 없음.
    if name == 'rebate_ratio' and g.get('frameKind') == 'canvas':
        return True
    if kind == '<=':
        return v <= lim
    if kind == '>=':
        return v >= lim
    return lim[0] <= v <= lim[1]


def limtext(n):
    k, l = LIMITS[n][0], LIMITS[n][1]
    return f'≤{l:g}' if k == '<=' else (f'≥{l:g}' if k == '>=' else f'{l[0]:g}~{l[1]:g}')


def crops(img, g, out, tag):
    os.makedirs(out, exist_ok=True)
    x0, y0, x1, y1 = g['rect']
    w, h = x1 - x0 + 1, y1 - y0 + 1
    S = max(70, int(min(w, h) * .32))
    q = S // 4
    spots = {'tl': (x0 - q, y0 - q), 'tr': (x1 + q - S, y0 - q),
             'bl': (x0 - q, y1 + q - S), 'br': (x1 + q - S, y1 + q - S),
             'edge_t': (x0 + w // 2 - S // 2, y0 - q), 'edge_b': (x0 + w // 2 - S // 2, y1 + q - S),
             'edge_l': (x0 - q, y0 + h // 2 - S // 2), 'edge_r': (x1 + q - S, y0 + h // 2 - S // 2)}
    for k, (cx, cy) in spots.items():
        img.crop((cx, cy, cx + S, cy + S)).save(f'{out}/{tag}_{k}.png')


def main():
    geo = json.load(open(f'{R}/geometry.json'))
    rows = {}
    for cid, g in geo.items():
        im = Image.open(f'{R}/{cid}.png')
        v = M.analyse(im, g['rect'], g['art'], g['railPx'])
        if not v:
            print(f'{cid} 측정 실패'); continue
        # ⚠️ 비율 보존은 **작품 사각형**으로 잰다. 조각 실루엣으로 재면 두께가 있는
        #    캔버스랩에서 옆면 때문에 실루엣 비율이 달라져 멀쩡한 렌더가 실패한다.
        ax0, ay0, ax1, ay1 = g['art']
        v['aspect_err'] = round(abs(((ax1 - ax0 + 1) / (ay1 - ay0 + 1)) / g['srcAspect'] - 1) * 100, 3)
        v['railPx'] = g['railPx']
        v['frameKind'] = g['frameKind']
        rows[cid] = v
        if '--crops' in sys.argv:
            crops(im, g, f'{HERE}/crops', cid)

    hdr = f'{"case":5s} ' + ' '.join(f'{m.replace("_"," ")[:11]:>12s}' for m in ORDER)
    print(hdr + '   판정')
    print('-' * len(hdr) + '-------')
    nfail = 0
    for cid, v in rows.items():
        bad = [m for m in ORDER if not ok(m, v.get(m), v)]
        nfail += bool(bad)
        cells = [f'{("!" if m in bad else " ") + f"{v.get(m, 0):.1f}":>12s}' for m in ORDER]
        print(f'{cid:5s} ' + ' '.join(cells) + ('   FAIL' if bad else '   pass'))
    print('-' * len(hdr) + '-------')
    print(f'{"한계":5s} ' + ' '.join(f'{limtext(m):>12s}' for m in ORDER))
    print(f'{"골든":5s} ' + ' '.join(f'{LIMITS[m][2]:>12s}' for m in ORDER))
    print()
    for m in ORDER:
        n = sum(1 for v in rows.values() if ok(m, v.get(m), v))
        vals = [v[m] for v in rows.values() if m in v]
        print(f'  {m:14s} {n}/{len(rows)} 통과   중앙값 {np.median(vals):8.1f}   {LIMITS[m][3]}')
    print(f'\n케이스 {len(rows)} 중 {len(rows)-nfail} 통과')

    os.makedirs(f'{HERE}/reports', exist_ok=True)
    json.dump(rows, open(f'{HERE}/reports/last.json', 'w'), indent=1)
    if '--save' in sys.argv:
        nm = sys.argv[sys.argv.index('--save') + 1]
        json.dump(rows, open(f'{HERE}/reports/{nm}.json', 'w'), indent=1)
        print(f'기록 저장: reports/{nm}.json')
    if '--vs' in sys.argv:
        nm = sys.argv[sys.argv.index('--vs') + 1]
        old = json.load(open(f'{HERE}/reports/{nm}.json'))
        print(f'\n── {nm} 대비 (지표별 통과 수) ──')
        for m in ORDER:
            a = sum(1 for c, v in old.items() if c in rows and ok(m, v.get(m), v))
            b = sum(1 for c, v in rows.items() if ok(m, v.get(m), v))
            mark = '↑' if b > a else ('↓ 회귀' if b < a else '=')
            print(f'  {m:14s} {a} → {b}  {mark}')
    return 1 if nfail else 0


if __name__ == '__main__':
    sys.exit(main())
