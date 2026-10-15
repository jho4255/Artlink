# download-check.mjs 가 받아 온 PDF 와 크롬이 그린 같은 쪽을 맞대 본다.
#  - 어긋남: 쪽 전체를 가장 잘 맞추는 이동(px). 2 이하여야 한다 — 규칙 69 의 글자 밀림은 세로 18px(=9 CSS px) 이었다.
#  - 글자 줄 밀림: 글자가 있는 줄마다 위아래 ±12px 안에서 가장 잘 맞는 이동. 4px(기기 px) 넘게 밀린 줄이 있으면 실패.
#  - 다른 칸: 64px 칸마다 평균 차이 — JPEG·글자 다듬기 차이(실측 최대 50)를 넘는 칸(60↑)이 있으면 실패.
import json, os, sys
import fitz
import numpy as np
from PIL import Image

OUT = '/home/jho4255/ArtLink/scratchpad/pf/out-dl'
summary = json.load(open(os.path.join(OUT, 'summary.json')))
fail = 0
for s in summary:
    doc = fitz.open(os.path.join(OUT, f"{s['name']}.pdf"))
    print(f"\n{s['name']}: PDF {len(doc)}쪽 / 미리보기 {s['pages']}쪽")
    if len(doc) != s['pages']:
        print('  ✗ 쪽 수가 다르다'); fail += 1
    for i, page in enumerate(doc):
        # ⚠️ get_images() 는 문서가 함께 쓰는 그림 목록을 돌려줄 수 있다(jsPDF) — 그 쪽에 **실제로 그려진** 그림을 고른다
        xref = max(page.get_image_info(xrefs=True), key=lambda im: (im['bbox'][2]-im['bbox'][0])*(im['bbox'][3]-im['bbox'][1]))['xref']
        pix = fitz.Pixmap(doc, xref)
        if pix.n - pix.alpha >= 4: pix = fitz.Pixmap(fitz.csRGB, pix)
        pdf = np.asarray(Image.frombytes('RGB' if pix.n >= 3 else 'L', (pix.width, pix.height), pix.samples).convert('L'), dtype=float)
        ref = np.asarray(Image.open(os.path.join(OUT, f"{s['name']}-ref-{i+1:02d}.png")).convert('L'), dtype=float)
        h, w = min(pdf.shape[0], ref.shape[0]), min(pdf.shape[1], ref.shape[1])
        pdf, ref = pdf[:h, :w], ref[:h, :w]
        # 쪽 전체 어긋남
        best = (1e9, 0, 0)
        for dy in range(-20, 21, 2):
            for dx in range(-6, 7, 2):
                a = pdf[max(0, dy):h + min(0, dy), max(0, dx):w + min(0, dx)]
                b = ref[max(0, -dy):h + min(0, -dy), max(0, -dx):w + min(0, -dx)]
                m = np.abs(a - b).mean()
                if m < best[0]: best = (m, dx, dy)
        # 글자 줄마다 세로 밀림 — 잉크가 있는 가로띠(40px)마다
        ink = (ref < 140).mean(axis=1)
        shifts = []
        for y in range(20, h - 60, 40):
            if ink[y:y + 40].mean() < 0.002: continue
            bb = None
            for dy in range(-12, 13):
                if y + dy < 0 or y + dy + 40 > h: continue
                m = np.abs(pdf[y + dy:y + dy + 40] - ref[y:y + 40]).mean()
                if bb is None or m < bb[0]: bb = (m, dy)
            if bb: shifts.append(bb[1])
        worst_shift = max((abs(v) for v in shifts), default=0)
        # 칸마다 차이
        T = 64; tiles = []
        for y in range(0, h - T, T):
            for x in range(0, w - T, T):
                tiles.append((np.abs(pdf[y:y+T, x:x+T] - ref[y:y+T, x:x+T]).mean(), x, y))
        tmax = max(tiles)
        # 기준(2026-10-15 실측): html2canvas 와 크롬은 글자 기준선 반올림이 달라 줄마다 2~3px(기기 px — 이 배율에서 CSS 1~1.5px) 어긋나고
        # 쪽 전체가 2px 어긋나 보이기도 한다. 규칙 69 의 결함은 18px 이었다 — 4px 를 넘으면 실패.
        bad = worst_shift > 4 or abs(best[1]) > 2 or abs(best[2]) > 2 or tmax[0] > 60
        fail += bad
        mark = '✗' if bad else '·'
        print(f"  {mark} {i+1:2d}쪽  평균차 {best[0]:5.2f}  쪽 어긋남 ({best[1]},{best[2]})  글자줄 최대 밀림 {worst_shift}px({len(shifts)}줄)  가장 다른 칸 {tmax[0]:5.1f} @({tmax[1]},{tmax[2]})")
print(f"\n실패 {fail}")
sys.exit(1 if fail else 0)
