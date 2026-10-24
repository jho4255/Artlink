# 매트 → 작품 경계(작품 네 모서리 중 왼쪽 위·오른쪽 아래)를 3배로 — 세트:액자 칸을 나란히.
# python3 scratchpad/vt/artzoom.py <out.png> set:id[+set:id...] [...]
import sys, json
from PIL import Image, ImageDraw
B='/home/jho4255/ArtLink/scratchpad/vt/framecmp'
out=sys.argv[1]; rows=sys.argv[2:]
Z=3; C=80; cw=C*Z; pad=8; lab=16
cols=max(len(r.split('+')) for r in rows)*2
sheet=Image.new('RGB',(cols*(cw+pad),len(rows)*(cw+pad+lab)),(255,255,255)); d=ImageDraw.Draw(sheet)
for ri,r in enumerate(rows):
    y=ri*(cw+pad+lab)
    for j,cell in enumerate(r.split('+')):
        sn,k=cell.split(':'); m=json.load(open(f'{B}/{sn}/meta.json'))['frames'][k]
        a=m['probe']['art']; im=Image.open(f"{B}/{sn}/{m['file']}").convert('RGB')
        x0,y0=int(a['x']),int(a['y']); x1,y1=int(a['x']+a['w']),int(a['y']+a['h'])
        tl=im.crop((x0-30,y0-30,x0-30+C,y0-30+C)).resize((cw,cw),Image.LANCZOS)
        br=im.crop((x1+30-C,y1+30-C,x1+30,y1+30)).resize((cw,cw),Image.LANCZOS)
        sheet.paste(tl,((2*j)*(cw+pad),y+lab)); sheet.paste(br,((2*j+1)*(cw+pad),y+lab))
        d.text(((2*j)*(cw+pad)+2,y+2),f'{k}/{sn}',fill=(0,0,0))
sheet.save(out); print(out, sheet.size)
