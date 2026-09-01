#!/usr/bin/env python3
"""골든의 작품 비율 분포와 여백 — 목표치가 '다른 콘텐츠 기준'이 아닌지 검증한다.

우리 합성 데이터는 세로 그림이 섞여 있는데, 골든이 가로 그림 위주라면 같은 지면에서
당연히 더 크게 실린다. 그러면 '우리가 작다'가 아니라 '비교가 틀렸다'가 된다.
비율·여백을 재서 그 가능성을 먼저 지운다.
"""
import glob, statistics as st
import fitz

REF = '/home/jho4255/ArtLink/portfolio'
asp, marg, hshare, wshare = [], [], [], []
for f in sorted(glob.glob(f'{REF}/*.pdf')):
    doc = fitz.open(f)
    for pg in doc:
        W, H = pg.rect.width, pg.rect.height
        A = W * H
        rs = [r for info in pg.get_images(full=True) for r in pg.get_image_rects(info[0])
              if (r.width * r.height) / A >= 0.01]
        if not rs: continue
        for r in rs:
            asp.append(r.width / r.height)
            hshare.append(r.height / H); wshare.append(r.width / W)
        m = min(min(r.x0, W - r.x1, r.y0, H - r.y1) for r in rs)
        marg.append(m / min(W, H))
    doc.close()

q = lambda a, p: sorted(a)[int(p * (len(a) - 1))]
print(f'작품 {len(asp)}점')
print(f'  비율(w/h)  중앙 {st.median(asp):.2f}   25% {q(asp,.25):.2f}  75% {q(asp,.75):.2f}   '
      f'세로그림(<1) {100*sum(1 for a in asp if a < 1)/len(asp):.0f}%')
print(f'  높이점유   중앙 {100*st.median(hshare):.1f}%   75% {100*q(hshare,.75):.1f}%')
print(f'  폭 점유    중앙 {100*st.median(wshare):.1f}%   75% {100*q(wshare,.75):.1f}%')
print(f'  최소여백   중앙 {100*st.median(marg):.1f}% (짧은 변 대비)   25% {100*q(marg,.25):.1f}%')
print()
print('우리 합성 데이터 비율: [0.8, 1.5, 1.0, 1.25, 0.68] → 중앙 1.00, 세로그림 40%')
print(f'우리 여백(PAD archive): 세로 상하 224/1414 = 15.8%, 좌우 164/1000 = 16.4%')
print(f'                        와이드 상하 224/900 = 24.9%  ← 판형이 짧아도 같은 값')
