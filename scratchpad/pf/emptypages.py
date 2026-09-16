"""
거의 빈 장 비율 — 포트폴리오 PDF 의 '채움' 게이트 (2026-09-16, 조사 1 평가기준 #1).

    /home/jho4255/hunohquant/.venv/bin/python emptypages.py combos/*.pdf
    /home/jho4255/hunohquant/.venv/bin/python emptypages.py combos-before/*.pdf   # 전/후 비교

각 장을 1/4 배율로 그려 **배경(최빈색)이 아닌 픽셀이 4% 미만**이면 '거의 빈 장'으로 센다.
2026-09-16 지면 체계 v2 전: 20권 390쪽 중 51쪽(13.1%). 후(1~9권): 199쪽 중 4쪽(2.0%) — 남은 4장은 사진 없는 작가의
연락처 장(의도된 닫는 장)이다. 표지가 글자만인 타이포 표지도 여기 잡힌다 — 그건 의도라 사람이 가른다.

⚠️ 이 지표는 게이트다. 통과시키려고 장식으로 채우면 안 된다(§17) — 빈 장을 없애는 답은 '그 자리가 일을 하게' 하는 것이다.
"""
import sys, glob, os
import numpy as np
import pymupdf

files = [f for a in sys.argv[1:] for f in sorted(glob.glob(a))]
tot = empty = 0
for f in files:
    d = pymupdf.open(f); e = []
    for i, p in enumerate(d):
        pix = p.get_pixmap(matrix=pymupdf.Matrix(0.25, 0.25), alpha=False)
        a = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, 3).astype(int)
        flat = (a[:, :, 0] // 8) * 4096 + (a[:, :, 1] // 8) * 64 + (a[:, :, 2] // 8)
        vals, cnt = np.unique(flat, return_counts=True)
        bg = vals[cnt.argmax()]
        if (flat != bg).mean() < 0.04:
            e.append(i + 1)
    tot += len(d); empty += len(e)
    print(f'{os.path.basename(f)[:40]:42s} {len(d):3d}쪽 {os.path.getsize(f)/1048576:5.1f}MB  빈장 {len(e):2d} {e}')
if tot:
    print(f'합계 {tot}쪽 중 거의 빈 장 {empty}장 = {empty/tot*100:.1f}%')
