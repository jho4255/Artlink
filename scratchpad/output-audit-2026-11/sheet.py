# 여러 쪽을 한 장에 — python3 sheet.py <out.png> <dpi> <file.pdf:쪽,쪽> ...
import fitz, sys, os
from PIL import Image
out, dpi = sys.argv[1], int(sys.argv[2])
tiles = []
for spec in sys.argv[3:]:
    f, _, pages = spec.partition(':')
    d = fitz.open(f)
    idx = [int(x) - 1 for x in pages.split(',')] if pages else range(len(d))
    for i in idx:
        if i >= len(d): continue
        pix = d[i].get_pixmap(dpi=dpi)
        im = Image.frombytes('RGB', (pix.width, pix.height), pix.samples)
        tiles.append(im)
gap = 16
W = sum(t.width for t in tiles) + gap * (len(tiles) + 1)
H = max(t.height for t in tiles) + gap * 2
sheet = Image.new('RGB', (W, H), (120, 120, 120))
x = gap
for t in tiles:
    sheet.paste(t, (x, gap)); x += t.width + gap
sheet.save(out)
print(out, sheet.size)
