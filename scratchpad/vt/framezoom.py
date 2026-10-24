# 모서리(왼쪽 위·오른쪽 아래)를 3배로 키워 세트끼리 나란히 — 액자 살·홈·매트 이음매를 눈으로 비교한다.
# python3 scratchpad/vt/framezoom.py <out.png> <set1,set2,...> id [id...]
#   id 대신 'set:id' 를 주면 그 줄은 칸마다 다른 액자를 놓는다 — 예: base:floater-oak  (세트 목록은 무시)
import sys, json
from PIL import Image, ImageDraw
out=sys.argv[1]; sets=sys.argv[2].split(','); ids=sys.argv[3:]
B='/home/jho4255/ArtLink/scratchpad/vt/framecmp'
Z=3; C=110; pad=8; lab=18
cols=max([len(sets)]+[len(x.split('+')) for x in ids])*2
W=cols*(C*Z+pad); H=len(ids)*(C*Z+pad+lab)
sheet=Image.new('RGB',(W,H),(255,255,255)); d=ImageDraw.Draw(sheet)
for r,k in enumerate(ids):
    y=r*(C*Z+pad+lab)
    cells=[tuple(x.split(':')) for x in k.split('+')] if ':' in k else [(sn,k) for sn in sets]
    for j,(sname,k) in enumerate(cells):
        m=json.load(open(f'{B}/{sname}/meta.json'))
        if k not in m['frames']: continue
        v=m['frames'][k]; f=v['probe']['front']; im=Image.open(f"{B}/{sname}/{v['file']}").convert('RGB')
        x0,y0=int(f['x']),int(f['y']); x1,y1=int(f['x']+f['w']),int(f['y']+f['h'])
        tl=im.crop((x0-12,y0-12,x0-12+C,y0-12+C)).resize((C*Z,C*Z),Image.LANCZOS)
        br=im.crop((x1+12-C,y1+12-C,x1+12,y1+12)).resize((C*Z,C*Z),Image.LANCZOS)
        sheet.paste(tl,((2*j)*(C*Z+pad),y+lab)); sheet.paste(br,((2*j+1)*(C*Z+pad),y+lab))
        d.text(((2*j)*(C*Z+pad)+2,y+3),f'{k} / {sname}',fill=(0,0,0))
sheet.save(out); print(out, sheet.size)
