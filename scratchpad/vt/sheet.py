#!/usr/bin/env python3
"""브리핑 "INSPECT AT THREE SCALES" — 눈으로 볼 시트를 만든다.

지표만 보다가 두 번 잘못 판단했다(CLAUDE.md 44f). 매 실험마다 **이걸 열어 본다**.

    ① 썸네일   — 전체 합성 인상 ("붙여 놓은 것 같은가")
    ② 실물 크기 — 장면 통합·깊이
    ③ 4배 확대 — 마스크·액자 안쪽 가장자리·매트·리베이트의 인공물

    python3 sheet.py matrix sheet_matrix.png            # 세 배율 한 장
    python3 sheet.py matrix sheet_ab.png --vs matrix_best   # 전/후 나란히
"""
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path('/home/jho4255/ArtLink/scratchpad/vt')
THUMB_W = 150          # ①
NORM_W = 250           # ②
ZOOM = 4               # ③
ZOOM_SRC = 62          # 확대 전 원본 창 크기(px)
PAD = 8
LABEL_W = 108


def load(d):
    d = HERE / d
    meta = json.load(open(d / 'meta.json'))
    return d, meta


def crops(im, g):
    """세 배율 이미지를 돌려준다."""
    x0, y0, x1, y1 = g['rect']
    ax0, ay0, ax1, ay1 = g['art']
    W, H = im.size

    a = im.copy()
    a.thumbnail((THUMB_W, THUMB_W * 2), Image.LANCZOS)

    m = max(6, (x1 - x0) // 12)
    b = im.crop((max(0, x0 - m), max(0, y0 - m), min(W, x1 + m), min(H, y1 + m)))
    b.thumbnail((NORM_W, NORM_W * 2), Image.LANCZOS)

    # ③ 왼쪽 살을 가로지르는 창 — 벽 | 액자 | (매트) | 작품 이 한 장에 다 들어와야 한다
    cy = (ay0 + ay1) // 2
    cx = (x0 + ax0) // 2
    half = ZOOM_SRC // 2
    c = im.crop((max(0, cx - half), max(0, cy - half),
                 min(W, cx + half), min(H, cy + half)))
    c = c.resize((c.width * ZOOM, c.height * ZOOM), Image.NEAREST)
    return a, b, c


def row(im, g):
    a, b, c = crops(im, g)
    h = max(a.height, b.height, c.height)
    w = a.width + b.width + c.width + PAD * 2
    r = Image.new('RGB', (w, h), (250, 250, 250))
    x = 0
    for p in (a, b, c):
        r.paste(p, (x, (h - p.height) // 2))
        x += p.width + PAD
    return r


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else 'matrix'
    out = sys.argv[2] if len(sys.argv) > 2 else 'sheet_matrix.png'
    vs = None
    if '--vs' in sys.argv:
        vs = sys.argv[sys.argv.index('--vs') + 1]

    d, meta = load(src)
    dv, metav = load(vs) if vs else (None, None)
    keys = [k for k in sorted(meta) if (not vs or k in metav)]
    only = [a for a in sys.argv[3:] if not a.startswith('--') and a != vs]
    if only:
        keys = [k for k in keys if any(o in k for o in only)]

    rows = []
    for k in keys:
        im = Image.open(d / f'{k}.png').convert('RGB')
        r = row(im, meta[k])
        if vs:
            im2 = Image.open(dv / f'{k}.png').convert('RGB')
            r2 = row(im2, metav[k])
            h = max(r.height, r2.height)
            j = Image.new('RGB', (r.width + r2.width + 14, h), (210, 210, 210))
            j.paste(r2, (0, 0))
            j.paste(r, (r2.width + 14, 0))
            r = j
        rows.append((k, r))

    W = LABEL_W + max(r.width for _, r in rows) + PAD
    H = sum(r.height + PAD for _, r in rows) + PAD
    sheet = Image.new('RGB', (W, H), (232, 232, 232))
    dr = ImageDraw.Draw(sheet)
    y = PAD
    for k, r in rows:
        sheet.paste(r, (LABEL_W, y))
        g = meta[k]
        dr.text((6, y + 6), k.replace('_', '\n'), fill=(20, 20, 20))
        dr.text((6, y + r.height - 34), f"mat {g['matPx']}\nrail {g['railPx']}", fill=(90, 90, 90))
        y += r.height + PAD
    sheet.save(HERE / out)
    lab = f'  (좌={vs} 우={src})' if vs else ''
    print(f'{HERE / out}  {W}x{H}  {len(rows)}행{lab}')
    print('열: 썸네일 | 실물크기 | 왼쪽 살 4배 확대(벽|액자|매트|작품)')


if __name__ == '__main__':
    main()
