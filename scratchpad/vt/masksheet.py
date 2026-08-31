#!/usr/bin/env python3
"""디버그 마스크 시트 + BEFORE/AFTER 그림 만들기.

    node masks.mjs t01      # 먼저 이걸로 레이어를 뽑고
    python masksheet.py t01 # 시트를 만든다
"""
import json, os, sys
import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
D = f'{HERE}/debug'
cid = sys.argv[1] if len(sys.argv) > 1 else 't01'
meta = json.load(open(f'{D}/{cid}_meta.json'))
mc = meta['maskColors']
hx = lambda h: tuple(int(h.lstrip('#')[i:i + 2], 16) for i in (0, 2, 4))
M = np.asarray(Image.open(f'{D}/{cid}_masks.png').convert('RGBA')).astype(int)
rgb, al = M[..., :3], M[..., 3]
sel = lambda col, tol=40: (np.abs(rgb - np.array(hx(col))).max(2) < tol) & (al > 128)
front, bevel, mat, opening = sel(mc['front']), sel(mc['bevel']), sel(mc['mat']), sel(mc['opening'])
outer = al > 128
panels = [('1 outer frame mask', outer, (226, 92, 72)),
          ('2 front face', front & ~bevel & ~mat & ~opening, (226, 92, 72)),
          ('3 inner bevel / rabbet', bevel & ~mat & ~opening, (240, 160, 32)),
          ('4 mat', mat & ~opening, (63, 127, 208)),
          ('5 artwork opening', opening, (255, 255, 255))]
for k in ('contact', 'cast', 'penumbra'):
    f = f'{D}/{cid}_shadow_{k}.png'
    if os.path.exists(f):
        panels.append((f'6 {k} shadow (alpha x4)', None,
                       np.asarray(Image.open(f).convert('RGBA'))[..., 3].astype(float)))
for n, f in (('BEFORE (pre-round settings)', f'{cid}_before'), ('AFTER (current)', f'{cid}_after')):
    panels.append((n, None, np.asarray(Image.open(f'{D}/{f}.png').convert('RGB'))))

cell, cols = 330, 5
rows = (len(panels) + cols - 1) // cols
sheet = Image.new('RGB', (cols * cell, rows * (cell + 24) + 6), '#101010')
dr = ImageDraw.Draw(sheet)
for i, (name, m, extra) in enumerate(panels):
    if m is None and extra.ndim == 3:
        im = Image.fromarray(extra.astype(np.uint8))
    elif m is None:
        a = np.clip(extra * 4, 0, 255).astype(np.uint8)
        im = Image.fromarray(np.dstack([a] * 3))
    else:
        img = np.zeros(M.shape[:2] + (3,), np.uint8); img[m] = extra
        im = Image.fromarray(img)
    im.thumbnail((cell - 10, cell - 10))
    x, y = (i % cols) * cell + 5, (i // cols) * (cell + 24) + 20
    sheet.paste(im, (x, y)); dr.text((x, y - 15), name, fill=(238, 238, 238))
sheet.save(f'{D}/{cid}_sheet.png')
cov = {n: round(float(m.mean() * 100), 2) for n, m, _ in panels[:5] if m is not None}
print(f'{D}/{cid}_sheet.png')
print('마스크 화면 점유율 %:', cov)
# ⚠️ 마스크는 **상호배타**여야 하고 **판 바깥으로 새면 안 된다**. 어기면 디버그 그림이
#    거짓말이 되므로 여기서 실패로 만든다(눈으로 보고 넘어가지 않게).
tot = front | bevel | mat | opening
ov = int((front & bevel).sum() + (mat & opening).sum() + (front & mat).sum())
leak = int((tot & ~outer).sum())
miss = int((outer & ~tot).sum())
print(f'검사 — 상호배타 위반 {ov}px · 판 밖 유출 {leak}px · 미분류 {miss}px')
if ov or leak or miss > outer.sum() * 0.01:
    print('FAIL: 마스크가 렌더와 어긋난다'); sys.exit(1)
