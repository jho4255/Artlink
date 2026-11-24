# 결과물 PDF 를 쪽마다 PNG 로 — python3 render.py   (out/, x/sub, x/app 을 훑는다)
import fitz, os, sys, glob, re
ROOT = os.path.dirname(os.path.abspath(__file__))
PNG = os.path.join(ROOT, 'png')
def slug(p):
    b = os.path.basename(p).replace('[점검] 2027 봄 기획전 《겹과 결》_', '').replace('.pdf', '')
    return re.sub(r'\s+', '', b)
files = sorted(glob.glob(os.path.join(ROOT, 'out', '*.pdf')) + glob.glob(os.path.join(ROOT, 'x', 'sub', '*', '*.pdf')) + glob.glob(os.path.join(ROOT, 'x', 'app', '*.pdf')) + glob.glob(os.path.join(ROOT, 'x', 'hwp', '*.pdf')))
only = sys.argv[1] if len(sys.argv) > 1 else ''
for f in files:
    if only and only not in f: continue
    d = fitz.open(f)
    text = sum(len(p.get_text()) for p in d)
    imgs = sum(len(p.get_images()) for p in d)
    r = d[0].rect
    print(f"{slug(f):28s} {len(d):3d}쪽  {r.width*25.4/72:.0f}×{r.height*25.4/72:.0f}mm  글자 {text:5d}  그림 {imgs:3d}  {os.path.getsize(f)//1024:6d}KB")
    for i, p in enumerate(d):
        if len(d) > 14 and i not in (0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, len(d)-2, len(d)-1) and not only: continue
        pix = p.get_pixmap(dpi=72)
        pix.save(os.path.join(PNG, f"{slug(f)}-{i+1:02d}.png"))
