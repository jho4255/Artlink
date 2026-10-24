# framecmp.mjs 결과를 시트로 — 모서리 1:1(왼쪽 위·오른쪽 아래) + 화면 크기로 줄인 전체.
#   python scratchpad/vt/framecmp.py <이름> [다른이름(전/후 나란히)] [--only id,id]
import json, sys
from PIL import Image, ImageDraw, ImageFont
HERE = '/home/jho4255/ArtLink/scratchpad/vt/framecmp'
args = [a for a in sys.argv[1:] if not a.startswith('--')]
only = []
if '--only' in sys.argv: only = sys.argv[sys.argv.index('--only') + 1].split(',')
names = args[:2] if len(args) > 1 and not args[1].count(',') else args[:1]
try:
    font = ImageFont.truetype('/usr/share/fonts/truetype/nanum/NanumGothic.ttf', 18)
except Exception:
    font = ImageFont.load_default()
metas = [json.load(open(f'{HERE}/{n}/meta.json')) for n in names]
ids = [k for k in metas[0]['frames'] if (not only or k in only) and all(k in m['frames'] for m in metas)]
C = 300  # 모서리 칸
def corner(n, m, k, which):
    f = m['frames'][k]; im = Image.open(f'{HERE}/{n}/{f["file"]}').convert('RGB')
    fr = f['probe']['front']
    if which == 'tl': x, y = fr['x'] - 40, fr['y'] - 40
    else: x, y = fr['x'] + fr['w'] - C + 40, fr['y'] + fr['h'] - C + 40
    return im.crop((int(x), int(y), int(x) + C, int(y) + C))
def whole(n, m, k):
    f = m['frames'][k]; im = Image.open(f'{HERE}/{n}/{f["file"]}').convert('RGB')
    im.thumbnail((C, C * 5 // 4)); return im
cols = len(names) * 3
W = cols * (C + 8) + 8; H = len(ids) * (C * 5 // 4 + 40) + 8
sheet = Image.new('RGB', (W, H), (255, 255, 255)); d = ImageDraw.Draw(sheet)
for r, k in enumerate(ids):
    y = 8 + r * (C * 5 // 4 + 40)
    for j, (n, m) in enumerate(zip(names, metas)):
        x0 = 8 + j * 3 * (C + 8)
        d.text((x0, y), f'{m["frames"][k]["name"]} ({k}) — {n}', fill=(0, 0, 0), font=font)
        sheet.paste(corner(n, m, k, 'tl'), (x0, y + 26))
        sheet.paste(corner(n, m, k, 'br'), (x0 + C + 8, y + 26))
        sheet.paste(whole(n, m, k), (x0 + 2 * (C + 8), y + 26))
out = f'{HERE}/sheet_{"_vs_".join(names)}{"_" + "-".join(only) if only else ""}.png'
sheet.save(out); print(out, sheet.size)
