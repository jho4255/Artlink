# 액자 살 단면(바깥 벽 → 작품) 휘도 — framecmp 렌더에서 네 변을 잰다.
# python3 scratchpad/vt/railprof.py <set> id [id...]
import sys, json
import numpy as np
from PIL import Image
base=f'/home/jho4255/ArtLink/scratchpad/vt/framecmp/{sys.argv[1]}'
m=json.load(open(f'{base}/meta.json'))
def lum(a): return 0.2126*a[...,0]+0.7152*a[...,1]+0.0722*a[...,2]
for k in sys.argv[2:]:
    v=m['frames'][k]; a=lum(np.asarray(Image.open(f"{base}/{v['file']}").convert('RGB')).astype(float))
    p=v['probe']; f=p['front']; art=p['art']
    x0,y0,x1,y1=f['x'],f['y'],f['x']+f['w'],f['y']+f['h']
    ax0,ay0,ax1,ay1=art['x'],art['y'],art['x']+art['w'],art['y']+art['h']
    out=8; 
    def prof(side):
        if side=='T':
            cs=slice(int(x0+f['w']*.35),int(x0+f['w']*.65)); r=range(int(y0)-out,int(ay0)+3)
            return [a[y,cs].mean() for y in r]
        if side=='B':
            cs=slice(int(x0+f['w']*.35),int(x0+f['w']*.65)); r=range(int(y1)+out,int(ay1)-3,-1)
            return [a[y,cs].mean() for y in r]
        if side=='L':
            rs=slice(int(y0+f['h']*.35),int(y0+f['h']*.65)); r=range(int(x0)-out,int(ax0)+3)
            return [a[rs,x].mean() for x in r]
        if side=='R':
            rs=slice(int(y0+f['h']*.35),int(y0+f['h']*.65)); r=range(int(x1)+out,int(ax1)-3,-1)
            return [a[rs,x].mean() for x in r]
    print(f"== {k} ({v['kind']}) rail≈{p.get('railPx',0):.1f} mat≈{p.get('matPx',0):.1f}")
    for s in 'TBLR':
        pr=prof(s); print(s, ' '.join(f'{x:3.0f}' for x in pr))
