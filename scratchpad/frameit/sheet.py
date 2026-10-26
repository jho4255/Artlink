"""boxcmp.mjs 결과로 시트 두 장: 전체(축소) + 왼쪽 위 모서리 확대.  python3 sheet.py <scene> <mat> <id,id,…> <out-prefix>"""
import sys, numpy as np
from PIL import Image
D = '/home/jho4255/ArtLink/scratchpad/frameit/out/'
scene, mat, ids, pre = sys.argv[1], sys.argv[2], sys.argv[3].split(','), sys.argv[4]
n = len(ids); cols = 3; rows = (n + cols - 1) // cols
full = Image.new('RGB', (cols * 300, rows * 375), 'white'); zoom = Image.new('RGB', (cols * 400, rows * 400), 'white')
for i, fid in enumerate(ids):
    im = Image.open(f'{D}{scene}_{mat}_{fid}.png').convert('RGB'); a = np.asarray(im).astype(int)
    g = a.mean(-1); H, W = g.shape
    col = g[:, W // 2]; y0 = int(np.argmax(np.abs(col - np.median(col[:120])) > 25))
    row = g[H // 2, :]; x0 = int(np.argmax(np.abs(row - np.median(row[:80])) > 25))
    full.paste(im.resize((300, 375), Image.LANCZOS), ((i % cols) * 300, (i // cols) * 375))
    zoom.paste(im.crop((x0 - 25, y0 - 25, x0 + 175, y0 + 175)).resize((400, 400), Image.LANCZOS), ((i % cols) * 400, (i // cols) * 400))
full.save(f'{D}{pre}_full.jpg', quality=90); zoom.save(f'{D}{pre}_zoom.png')
