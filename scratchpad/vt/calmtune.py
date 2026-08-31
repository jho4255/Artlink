#!/usr/bin/env python3
"""벽 진정 세기(`wallCalm`)를 **렌더 결과를 보고** 되먹임으로 맞춘다.

    node sweep.mjs scenes && python calmtune.py --write   (2~3회 반복)

⚠️ 원본 사진의 결 세기만 보고 계산하면 빗나간다 — 자동 프레이밍이 카메라를 당기면서
   벽 무늬가 확대돼 측정 대역(2~8px) 밖으로 밀려나기 때문이다. 실측: gallery-living 은
   원본 8.18 에 calm 0.51 이면 4.0 쯤일 줄 알았는데 **2.0** 이 나왔다(과하게 뭉갬).
⚠️ 목표는 **밴드**다(2.5~4.5). 위로 넘치면 벽이 시끄럽고, 아래로 빠지면 배경이
   정보 없는 면이 된다(브리핑 9항). 골든 최저가 2.86 이다.
"""
import json, os, sys
import numpy as np
from PIL import Image
import presence as P

HERE = os.path.dirname(os.path.abspath(__file__))
J = '/home/jho4255/ArtLink/frontend/public/artlook/scenes/scenes.json'
TARGET, LO, HI, CAP = 3.4, 2.5, 4.5, 0.82

meta = json.load(open(f'{HERE}/sweep/scenes_meta.json'))
d = json.load(open(J, encoding='utf-8'))
by = {s['id']: s for s in d['scenes']}
print(f'{"id":18s} {"wall_hf":>8s} {"calm":>6s} {"→":>3s} {"new":>6s}')
n = 0
for name, pr in meta.items():
    sid = name.split('_', 1)[1]
    f = f'{HERE}/sweep/scenes_' + ''.join(
        c if (c.isalnum() or c in '.-_' or '가' <= c <= '힣') else '_' for c in name) + '.jpg'
    if sid not in by or not pr or not os.path.exists(f):
        continue
    box = lambda b: [round(b['x']), round(b['y']), round(b['x'] + b['w']) - 1, round(b['y'] + b['h']) - 1]
    v = P.measure(f, box(pr['piece']), box(pr['art']))
    hf = v['wall_hf']
    cur = by[sid].get('wallCalm', 0.0)
    # 남은 결 ∝ (1 − calm) 로 보고 목표까지의 비율만큼 (1−calm) 을 조정
    keep = max(0.05, 1 - cur)
    new = round(min(CAP, max(0.0, 1 - keep * TARGET / max(0.6, hf))), 2)
    mark = ''
    if not (LO <= hf <= HI):
        mark = ' ←조정'; n += 1
    else:
        new = cur
    print(f'{sid:18s} {hf:8.2f} {cur:6.2f} {"→":>3s} {new:6.2f}{mark}')
    if '--write' in sys.argv:
        if new > 0.02: by[sid]['wallCalm'] = new
        else: by[sid].pop('wallCalm', None)
if '--write' in sys.argv:
    json.dump(d, open(J, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(f'\n{n}개 조정 → {J}')
