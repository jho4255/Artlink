#!/usr/bin/env python3
"""장면 벽의 결 세기를 재서 scenes.json 의 `wallCalm` 을 정한다.

    python wallcalm.py [--write] [--target 3.6]

⚠️ 손으로 적지 말 것 — 17장을 눈으로 고르면 반드시 어긋난다(lightDir 에서 겪었다).
   결 세기(1200px 기준 band-pass std)를 재서 목표치까지 내리는 혼합비를 계산한다.
⚠️ **실내 사진은 상한을 낮게** — 결의 상당 부분이 가구·책·화분 같은 '진짜 물체'라
   세게 흐리면 가짜 아웃포커스가 된다. 평평한 매크로 벽(2600px)만 세게 건다.
"""
import json, sys
import numpy as np
from PIL import Image
from scipy import ndimage

R = '/home/jho4255/ArtLink/frontend/public/artlook/'
J = R + 'scenes/scenes.json'
TARGET = float(sys.argv[sys.argv.index('--target') + 1]) if '--target' in sys.argv else 3.3
CAP_WALL, CAP_ROOM = 0.82, 0.52          # 매크로 벽 / 실내 사진
# ⚠️ **실내 사진은 목표를 느슨하게.** 방의 결에는 화분·조명·책 같은 '진짜 물체'가 섞여 있어
#    평평한 벽과 같은 목표까지 내리면 가짜 아웃포커스가 된다. 한도(4.5) 안에서 덜 건드린다.
ROOM_TARGET = 4.0

d = json.load(open(J, encoding='utf-8'))
print(f'{"id":18s} {"hf":>6s} {"cap":>5s} {"calm":>6s}')
for s in d['scenes']:
    im = Image.open(R + s['src']).convert('L')
    k = 1200 / max(im.size)
    if k < 1:
        im = im.resize((int(im.width * k), int(im.height * k)), Image.LANCZOS)
    L = np.asarray(im).astype(float)
    hf = float((ndimage.gaussian_filter(L, 1.) - ndimage.gaussian_filter(L, 4.)).std())
    # 매크로 벽인지 실내 사진인지: 원본이 2000px 이상이면 평평한 벽 텍스처다
    cap = CAP_WALL if max(Image.open(R + s['src']).size) >= 2000 else CAP_ROOM
    tgt = TARGET if cap == CAP_WALL else ROOM_TARGET
    calm = round(min(cap, max(0.0, 1 - tgt / hf)), 2)
    print(f'{s["id"]:18s} {hf:6.2f} {cap:5.2f} {calm:6.2f}')
    if '--write' in sys.argv:
        if calm > 0.02:
            s['wallCalm'] = calm
        else:
            s.pop('wallCalm', None)
if '--write' in sys.argv:
    json.dump(d, open(J, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(f'\n→ {J} 갱신')
