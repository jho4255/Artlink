#!/usr/bin/env python3
"""
ArtLook 사진 액자 추출 — GPT 로 뽑은 '정면·빈 액자·흰 배경' 이미지를
9-slice 로 쓸 수 있는 알파 PNG + 메타(frames.json)로 만든다.

    python3 frontend/scripts/extract-photo-frames.py

입력 :  gptsamplecase/*.png   (레포 루트, 커밋하지 않는 원본 보관함)
출력 :  frontend/public/artlook/frames/photo/<이름>.png  +  frames.json

왜 필요한가 — 절차적 액자는 아무리 다듬어도 '평면을 계단식으로 칠한 것'이라
미세 질감·마이터 이음새에서 진다. 실사 액자 사진을 9-slice 로 늘려 쓰면
액자 픽셀이 곧 사진이 된다.

⚠️ 원본에 요구되는 것 (하나라도 어긋나면 검출이 틀어진다)
   · 완전 정면(원근 없음), 네 변이 화면과 평행
   · 액자 속은 **완전히 비어 있고 균일한 회색** — 무늬가 있으면 개구부를 못 찾는다
   · 순백 배경, 액자 밖 그림자 없음

⚠️ **흰 액자 주의** — 배경(254,255,255)과 흰 프레임(244,242,242) 차이가 10 남짓이라
   임계값을 크게 잡으면 액자를 배경으로 오인해 **안쪽 어딘가를 바깥 경계로 잡는다**
   (실제로 그랬다). 250 + 연속 4px 규칙으로 잡는다.

이름 붙이기: 파일명에 재질 키워드(oak/black/white/walnut/gold/floater…)가 있으면
그걸 쓰고, 없으면 정렬 순서대로 frame1, frame2 … 가 된다. 이름은 `frames.json`
키이자 `index.html` 의 `FRAMES[].photo` 가 가리키는 값이다.
"""
import glob
import json
import os
import re
import sys

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(ROOT, 'gptsamplecase')
OUT = os.path.join(ROOT, 'frontend', 'public', 'artlook', 'frames', 'photo')
# ⚠️ 'champagne'·'maple' 은 'floater' **앞**에 둔다 — 순서대로 찾으므로 뒤에 두면 frame-champagne-floater 가 'floater' 로 잡힌다(2026-10-26)
KEYS = ['oak', 'black', 'white', 'walnut', 'gold', 'silver', 'champagne', 'maple', 'floater', 'ivory']


# 같은 재질의 **다른 살 두께**를 함께 두려면 한정어가 필요하다. 2026-09-01 에 들어온
# 얇은 액자 3종(살 5.0~5.7%, 기존 9.0~9.8%)이 oak/walnut 과 키가 겹쳐 덮어쓸 뻔했다.
QUALS = ['thin', 'wide', 'deep', 'floater']   # floater = 사진 플로터(2026-10-26) — 몰딩 키와 겹치지 않게


def name_for(path, i):
    low = os.path.basename(path).lower()
    for k in KEYS:
        if k in low:
            q = next((q for q in QUALS if q in low), None)
            return f'{k}-{q}' if q else k
    return f'frame{i + 1}'


def first_run(vals, test, n=4):
    """조건을 만족하는 픽셀이 n개 연속되는 첫 위치 — 노이즈 한 점에 속지 않게."""
    c = 0
    for i, p in enumerate(vals):
        c = c + 1 if test(p) else 0
        if c >= n:
            return i - n + 1
    return 0


def _step(p, lo, hi):
    """p[lo..hi] 에서 밝기가 가장 크게 바뀌는 자리(앞뒤 2px 차이 기준)"""
    lo = max(2, lo); hi = min(len(p) - 2, hi)
    if hi <= lo:
        return lo
    d = np.abs(p[lo + 1:hi + 1] - p[lo - 1:hi - 1])
    return lo + int(np.argmax(d))


def refine_deep(a, lo, ro, to, bo, li, ri, ti, bi):
    """**박스(deep) 액자** — 개구부 경계를 '안쪽 벽 → 뒤판'의 또렷한 계단으로 다시 잡는다 (2026-10-26).

    회색에서 18 넘게 벗어난 첫 자리를 경계로 보는 기본 규칙은 몰딩 액자용이다. 박스 사진은 벽이 뒤판에
    **그림자**를 드리워 판 가장자리가 30~40px 에 걸쳐 서서히 어두워지는데, 그 그라데이션까지 액자로 잡혀
    왼쪽·위 살이 오른쪽·아래보다 40~50px 두꺼워졌다(실측 오크: 왼 147 · 위 137 · 아래 98). 그대로
    symmetrize 를 돌리면 **바깥 앞면을 49px 깎아** 왼쪽 앞면이 통째로 사라진다. 실제로는 네 변 모두
    [앞면 ~60px | 벽 ~40px] 로 같다 — 벽 → 판 경계는 그라데이션이 아니라 계단이다.
    판의 그림자는 개구부(투명)로 넘긴다 — 그림자는 엔진이 방에 맞춰 다시 그린다.
    돌려주는 wall_from = 살 폭 대비 '앞면이 끝나고 벽이 시작하는 자리'(네 변 중앙값)."""
    g = a.astype(float) @ np.array([0.2126, 0.7152, 0.0722])
    H, W = g.shape
    rows = g[int(H * .35):int(H * .65), :].mean(0)
    cols = g[:, int(W * .35):int(W * .65)].mean(1)
    prof = {'L': rows[lo:], 'R': rows[::-1][W - 1 - ro:], 'T': cols[to:], 'B': cols[::-1][H - 1 - bo:]}
    rail = {'L': li - lo, 'R': ro - ri, 'T': ti - to, 'B': bo - bi}
    rmin = min(rail.values())
    new, wf = {}, []
    for k, p in prof.items():
        e = _step(p, int(rmin * 0.6), rail[k] + 3) + 1      # 계단 다음 픽셀부터 개구부(벽과 판 사이의 어두운 주름도 판 쪽으로)
        new[k] = e
        f = _step(p, int(e * 0.3), int(e * 0.8))             # 앞면 → 벽
        wf.append(f / e)
    wall_from = float(np.median(wf))
    return lo + new['L'], ro - new['R'], to + new['T'], bo - new['B'], round(wall_from, 3)


def main():
    files = sorted(glob.glob(os.path.join(SRC, '*.png')) + glob.glob(os.path.join(SRC, '*.jpg')))
    if not files:
        print(f'원본이 없습니다: {SRC}')
        return 1
    os.makedirs(OUT, exist_ok=True)
    meta = {}
    for i, f in enumerate(files):
        im = Image.open(f).convert('RGB')
        a = np.asarray(im).astype(int)
        H, W, _ = a.shape
        cy, cx = H // 2, W // 2
        grey = a[cy, cx].astype(float)

        not_white = lambda p: p.min() <= 250          # noqa: E731
        off_grey = lambda p: np.abs(p.astype(float) - grey).max() > 18   # noqa: E731

        lo = first_run(a[cy, :], not_white)
        ro = W - 1 - first_run(a[cy, ::-1], not_white)
        to = first_run(a[:, cx], not_white)
        bo = H - 1 - first_run(a[::-1, cx], not_white)
        li = cx - first_run(a[cy, :cx][::-1], off_grey)
        ri = cx + first_run(a[cy, cx:], off_grey)
        ti = cy - first_run(a[:cy, cx][::-1], off_grey)
        bi = cy + first_run(a[cy:, cx], off_grey)

        wall_from = None
        # 박스(deep)·플로터(floater)는 안쪽 벽이 보이는 액자 — 개구부를 벽(플로터는 어두운 틈) → 뒤판 계단에서 잡는다
        if any(q in os.path.basename(f).lower() for q in ('deep', 'floater')):
            li, ri, ti, bi, wall_from = refine_deep(a, lo, ro, to, bo, li, ri, ti, bi)
        rail = min(li - lo, ro - ri, ti - to, bo - bi)
        if rail < 8 or ri - li < 40 or bi - ti < 40:
            print(f'  ✗ {os.path.basename(f)} — 검출 실패(살 {rail}px). 정면/빈 회색/흰 배경인지 확인')
            continue

        name = name_for(f, i)
        # ⚠️ 흰 배경에서 잘라낸 가장자리 픽셀은 **흰색과 섞여 있다**(안티에일리어싱).
        # 그대로 두면 어두운 벽에서 액자 둘레에 흰 테가 뜬다 → 바깥 2px 을 깎는다.
        E = 2
        crop = im.crop((lo + E, to + E, ro + 1 - E, bo + 1 - E)).convert('RGBA')
        arr = np.array(crop)
        arr[ti - to - E:bi - to + 1 - E, li - lo - E:ri - lo + 1 - E, 3] = 0   # 개구부는 투명
        Image.fromarray(arr).save(os.path.join(OUT, f'{name}.png'))
        meta[name] = {
            'file': f'{name}.png',
            'inner': [int(li - lo - E), int(ti - to - E), int(ri - lo - E), int(bi - to - E)],
            'w': int(ro - lo + 1 - 2 * E), 'h': int(bo - to + 1 - 2 * E),
            'rail': int(rail), 'railPct': round(rail / (ro - lo) * 100, 1),
        }
        if wall_from is not None:
            meta[name]['wallFrom'] = wall_from     # 박스: 살 폭 대비 안쪽 벽이 시작하는 자리(엔진 shadeBoxWalls)
        print(f'  ✓ {name:9s} {ro - lo + 1}×{bo - to + 1}  살 {rail}px ({meta[name]["railPct"]}%)')

    with open(os.path.join(OUT, 'frames.json'), 'w', encoding='utf-8') as fp:
        json.dump(meta, fp, ensure_ascii=False, indent=2)
    print(f'\n{len(meta)}종 추출 → {OUT}')
    print('index.html 의 FRAMES 에 { name:\'…\', kind:\'photo\', photo:\'<이름>\', rail:0.07 } 를 추가하세요.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
