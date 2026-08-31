#!/usr/bin/env python3
"""전수 스윕(액자 18종·장면 17개)을 골든 지표 + 3차 지표로 한 번에 판정.

    python sweepcheck.py frames | scenes
"""
import json, os, sys
import numpy as np
import metrics as M, presence as P, run as R

HERE = os.path.dirname(os.path.abspath(__file__))
mode = sys.argv[1] if len(sys.argv) > 1 else 'frames'
meta = json.load(open(f'{HERE}/sweep/{mode}_meta.json'))
COLS = ['keyline_spike', 'rebate_ratio', 'rail_span', 'dir_tb', 'contact_drop', 'recover_pct']
P2 = ['piece_pct', 'wall_hf', 'hf_ratio', 'con_ratio', 'sat_rail', 'rail_pct', 'rail_cv']
print(f'{"":26s} ' + ' '.join(f'{c[:9]:>9s}' for c in COLS + P2))
nf = 0
rows = 0
for name, pr in meta.items():
    f = f'{HERE}/sweep/{mode}_' + ''.join(ch if (ch.isalnum() or ch in '.-_' or '가' <= ch <= '힣') else '_' for ch in name) + '.jpg'
    if not pr or not os.path.exists(f):
        continue
    box = lambda b: [round(b['x']), round(b['y']), round(b['x'] + b['w']) - 1, round(b['y'] + b['h']) - 1]
    rect, art = box(pr['piece']), box(pr['art'])
    front = box(pr['front']) if pr.get('front') else rect
    v = M.analyse(f, rect, art, round(pr['railPx']))
    v.update(P.measure(f, rect, art, front, round(pr['railPx'])))
    g = {'railPx': round(pr['railPx']), 'frameKind': 'canvas' if '캔버스' in name else ''}
    bad = [c for c in COLS if c in R.LIMITS and not R.ok(c, v[c], g)]
    bad += [c for c in P2 if c in v and not P.ok(c, v[c], g)]
    nf += bool(bad); rows += 1
    cells = ' '.join(f'{(("!" if c in bad else "") + f"{v.get(c, 0):.1f}"):>9s}' for c in COLS + P2)
    print(f'{name[:26]:26s} {cells}' + ('  FAIL' if bad else '  pass'))
print(f'\n{mode}: {rows - nf}/{rows} 통과')
