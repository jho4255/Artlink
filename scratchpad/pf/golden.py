#!/usr/bin/env python3
"""실제 작가 포트폴리오 5종을 골든으로 재서, 우리 엔진의 '작품 크기'가 어디쯤인지 본다.

ArtLook 41번과 같은 방법이다 — "작아 보인다"를 눈으로 판정하지 않고 레퍼런스를 재서
목표 밴드를 뽑는다. 여기서 재는 것은 **작품이 지면에서 차지하는 면적비**.

배치 사각형은 PDF 구조에서 그대로 읽으므로 검출 오차가 0이다(이미지 검출 금지 — 여백·
액자 때문에 십수 pt 씩 틀린다).

⚠️ portfolio/ 는 **타인 저작물**이라 커밋 금지(.gitignore). 여기서 뽑는 건 숫자뿐이다.

    python golden.py
"""
import glob
import os
import statistics as st

import fitz

REF = '/home/jho4255/ArtLink/portfolio'


def page_stats(pg):
    A = pg.rect.width * pg.rect.height
    rects = []
    for info in pg.get_images(full=True):
        for r in pg.get_image_rects(info[0]):
            a = r.width * r.height
            # 로고·아이콘·장식(지면 1% 미만)은 작품이 아니다
            if a / A >= 0.01:
                rects.append((a / A, max(r.width, r.height), r))
    return A, rects


print(f'{"포트폴리오":34s} {"쪽":>4s} {"작품쪽":>5s} {"최대작품":>7s} {"중앙":>6s} {"쪽당점수":>7s}')
allmax, allmed, perpage = [], [], []
for f in sorted(glob.glob(f'{REF}/*.pdf')):
    doc = fitz.open(f)
    shares, biggest, counts = [], [], []
    for pg in doc:
        A, rects = page_stats(pg)
        if not rects:
            continue
        counts.append(len(rects))
        biggest.append(max(r[0] for r in rects))
        shares.append(sum(r[0] for r in rects))
    if not shares:
        print(f'{os.path.basename(f)[:32]:34s}  (이미지 없음 — 텍스트/벡터 포트폴리오)')
        continue
    allmax += biggest
    allmed += shares
    perpage += counts
    print(f'{os.path.basename(f)[:32]:34s} {doc.page_count:4d} {len(shares):5d} '
          f'{100*max(biggest):6.1f}% {100*st.median(biggest):5.1f}% {st.median(counts):7.1f}')
    doc.close()

print()
print(f'골든 종합 — 작품 낱장 지면점유 중앙값 {100*st.median(allmax):.1f}%  '
      f'(하위25% {100*sorted(allmax)[len(allmax)//4]:.1f}% · 상위25% {100*sorted(allmax)[3*len(allmax)//4]:.1f}%)')
print(f'          한 쪽에 올리는 작품 수 중앙값 {st.median(perpage):.0f}점  '
      f'(1점인 쪽 {100*sum(1 for c in perpage if c == 1)/len(perpage):.0f}%)')
print()
print('우리 엔진 실측(probe.mjs A)과 대조:')
ours = [('hero', 'a4-portrait', 45.8), ('hero', 'a4-landscape', 25.8), ('hero', 'wide', 17.6),
        ('label', 'a4-portrait', 19.4), ('duo', 'a4-portrait', 10.3), ('duo', 'wide', 16.1),
        ('grid', 'a4-portrait', 7.0), ('grid', 'a4-landscape', 2.1), ('grid', 'wide', 1.1),
        ('index', 'wide', 2.6)]
lo = 100 * sorted(allmax)[len(allmax) // 4]
for name, page, v in ours:
    print(f'  {name:6s} {page:14s} {v:5.1f}%   {"밴드 안" if v >= lo else "골든 하위25%보다 작음 ✗"}')
