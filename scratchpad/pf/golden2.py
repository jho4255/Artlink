#!/usr/bin/env python3
"""골든을 **쪽당 작품 수별로** 다시 잰다.

앞선 golden.py 는 전 페이지를 뭉쳐 중앙값 33.8% 를 냈는데, 한 쪽에 1점인 페이지와
4점인 페이지를 같이 넣으면 우리 duo/grid 와 견줄 수 없다. 같은 밀도끼리 비교해야
"우리가 작다"가 참인지 알 수 있다. 판형(세로/가로)도 나눈다 — 세로 그림을 가로 지면에
놓으면 높이가 천장이라 물리적 상한이 다르다.
"""
import glob, os, statistics as st
import fitz

REF = '/home/jho4255/ArtLink/portfolio'
buckets = {}
orient = {}
for f in sorted(glob.glob(f'{REF}/*.pdf')):
    doc = fitz.open(f)
    for pg in doc:
        A = pg.rect.width * pg.rect.height
        rects = []
        for info in pg.get_images(full=True):
            for r in pg.get_image_rects(info[0]):
                if (r.width * r.height) / A >= 0.01:
                    rects.append(r)
        if not rects: continue
        n = min(len(rects), 6)
        share_max = max(r.width * r.height for r in rects) / A
        share_sum = sum(r.width * r.height for r in rects) / A
        buckets.setdefault(n, []).append((share_max, share_sum))
        o = 'landscape' if pg.rect.width >= pg.rect.height else 'portrait'
        orient.setdefault(o, []).append(share_max)
    doc.close()

print(f'{"쪽당점수":>6s} {"페이지":>5s} {"최대작품 중앙":>12s} {"하위25%":>8s} {"상위25%":>8s} {"작품합계 중앙":>12s}')
for n in sorted(buckets):
    v = buckets[n]
    mx = sorted(x[0] for x in v); sm = sorted(x[1] for x in v)
    print(f'{n:6d} {len(v):5d} {100*st.median(mx):11.1f}% {100*mx[len(mx)//4]:7.1f}% '
          f'{100*mx[3*len(mx)//4]:7.1f}% {100*st.median(sm):11.1f}%')
print()
for o, v in orient.items():
    print(f'{o:10s} 페이지 {len(v):3d}  최대작품 중앙 {100*st.median(v):.1f}%')
