# 브리핑 "ACTUAL VISUAL VALIDATION" — 같은 입력에서 BEFORE/AFTER 를 **세 배율**로 본다.
#   THUMBNAIL 전체 합성 인상 · NORMAL 장면 통합 · ZOOM 마스크·경계·리베이트·매트·재질
#
#   python3 ab.py [renders_before] [renders] [out.png] [case ...]
import sys, os, json
import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
A = sys.argv[1] if len(sys.argv) > 1 else 'renders_before'
B = sys.argv[2] if len(sys.argv) > 2 else 'renders'
OUT = sys.argv[3] if len(sys.argv) > 3 else 'ab_sheet.png'
CASES = sys.argv[4:] or ['t01', 't02', 't03', 't05', 't08']

geo = json.load(open(f'{HERE}/{B}/geometry.json'))
THUMB, NORMAL, ZOOM = 150, 330, 300      # 픽셀 폭 / 확대 크롭 한 변(원본 픽셀)
ZOOM_SHOW = 330                          # 그 크롭을 이 크기로 보여준다(≈2.2배)
PAD, LBL = 10, 22
rows = []
for cid in CASES:
    if cid not in geo:
        continue
    c = geo[cid]
    x0, y0, x1, y1 = c['rect']
    ax0, ay0 = c['art'][0], c['art'][1]
    tiles = []
    for src in (A, B):
        p = f'{HERE}/{src}/{cid}.png'
        if not os.path.exists(p):
            tiles.append(None); continue
        im = Image.open(p).convert('RGB')
        th = im.copy(); th.thumbnail((THUMB, THUMB), Image.LANCZOS)
        nm = im.copy(); nm.thumbnail((NORMAL, NORMAL), Image.LANCZOS)
        # 확대 — 조각의 **좌상단 모서리**. 벽↔액자 경계 · 살 단면 · 매트 · 작품 경계가 한 컷에 든다
        cx, cy = max(0, x0 - 26), max(0, y0 - 26)
        z = im.crop((cx, cy, min(im.width, cx + ZOOM), min(im.height, cy + ZOOM)))
        z = z.resize((ZOOM_SHOW, ZOOM_SHOW), Image.NEAREST)
        tiles.append((th, nm, z))
    rows.append((cid, c, tiles))

if not rows:
    print('케이스 없음'); sys.exit(1)
colw = [THUMB, NORMAL, ZOOM_SHOW]
W = PAD + sum(w + PAD for w in colw) * 2 + PAD * 2
rowh = max(NORMAL, ZOOM_SHOW) + LBL + PAD
H = PAD + len(rows) * rowh + LBL
sheet = Image.new('RGB', (W, H), (24, 24, 26))
d = ImageDraw.Draw(sheet)
d.text((PAD, 4), f'BEFORE = {A}   |   AFTER = {B}      (썸네일 / 보통 / 확대 2.2x)', fill=(230, 230, 230))
y = PAD + LBL
for cid, c, tiles in rows:
    x = PAD
    for gi, g in enumerate(tiles):
        if g is None:
            x += sum(w + PAD for w in colw) + PAD; continue
        for i, t in enumerate(g):
            sheet.paste(t, (x, y + LBL))
            x += colw[i] + PAD
        d.text((x - sum(colw) - PAD * 3, y + 4),
               f"{cid} {c['frame']} @{c['scene']}  {'BEFORE' if gi == 0 else 'AFTER'}",
               fill=(170, 200, 170) if gi else (200, 180, 160))
        x += PAD
    y += rowh
sheet.save(f'{HERE}/{OUT}')
print(f'{OUT}  {sheet.width}x{sheet.height}   케이스 {len(rows)}')

# 수치 요약 — 눈으로 볼 때 같이 읽을 것
print(f"\n{'case':6s}{'frame':12s}{'벽':>6s}{'위살':>7s}{'아래살':>8s}{'매트':>7s}{'이음매':>8s}{'작품':>7s}")
for cid, c, _ in rows:
    x0, y0, x1, y1 = c['rect']; ax0, ay0, ax1, ay1 = c['art']
    im = np.asarray(Image.open(f'{HERE}/{B}/{cid}.png').convert('RGB')).astype(float) @ [.2126, .7152, .0722]
    lo, hi = x0 + int((x1 - x0) * .35), x0 + int((x1 - x0) * .65)
    col = im[max(0, y0 - 8):ay0 + 6, lo:hi].mean(axis=1)
    rail = int(c['railPx'])
    wall = col[:6].mean()
    top = col[8:8 + max(3, rail)].mean()
    bot = im[y1 - max(3, rail):y1, lo:hi].mean()
    gap = col[8 + rail:] if len(col) > 8 + rail else col[-3:]
    seam = gap.min() if len(gap) else float('nan')
    matv = np.median(gap) if len(gap) else float('nan')
    art = im[ay0 + 2:ay0 + 8, lo:hi].mean()
    print(f"{cid:6s}{c['frame'][:10]:12s}{wall:6.0f}{top:7.0f}{bot:8.0f}{matv:7.0f}{seam:8.0f}{art:7.0f}")
