#!/usr/bin/env python3
"""사진 액자 바깥 둘레에 남은 **흰 배경 테**를 깎는다 (2026-10-24).

    python3 frontend/scripts/trim-photo-frame-rims.py [--dry]
    → 그다음 반드시 python3 frontend/scripts/symmetrize-photo-frames.py (네 살 폭을 다시 같게)

왜 필요한가 — 얇은 액자 3종(oak-thin·walnut-thin·silver-thin)은 1024px 원본을 흰 배경에서
오려 냈는데 가장자리가 흐려서, 바깥 4~13px 이 **흰색과 섞인 채 불투명**(알파 255)으로 남았다.
실측(위살 바깥 → 안쪽 휘도): oak-thin 248 248 247 248 249 250 247 242 233 221 210 200 192 186(앞면 187)
· walnut-thin 193 155 117 85 63 51(앞면 ~60). 어두운 벽에 걸면 액자 둘레에 **흰 테**가 뜬다
(CLAUDE.md 37 의 E=2 와 같은 결함 — 큰 5종은 그때 깎았고 얇은 3종은 나중에 들어와 빠졌다).

규칙: 변마다 가운데 40% 구간의 단면을 재서, 맨 바깥 픽셀이 흰색 쪽으로 크게 치우쳐 있으면
(앞면과 흰색의 중간보다 밝으면) 바깥에서부터 **앞면 밝기(살 안쪽 14~24px 의 중앙값)보다 눈에 띄게
밝은 픽셀**을 깎는다(문턱 = 앞면 + max(8, 6%)). 어두운 바깥 모서리는 진짜
그늘이라 건드리지 않는다. 개구부(inner)는 그대로 — 바깥만 안으로 당긴다(symmetrize 와 같은 방식).
⚠️ **멱등**이다. 깎을 게 없으면 아무것도 안 바꾼다.
"""
import json
import os
import sys

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'frontend', 'public', 'artlook', 'frames', 'photo')
MAX_CUT = 16   # 이보다 많이 깎아야 한다면 판정이 틀린 것 — 멈춘다


def lum(a):
    return 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]


def cut_for(prof):
    face = float(np.median(prof[14:24]))
    thr = face + max(8.0, face * 0.06)
    # 흰 배경이 섞인 테는 **맨 바깥 픽셀이 흰색 쪽으로 크게 치우쳐** 있다. 그게 아니면 진짜
    # 몰딩(금장 비드의 반사 등)이라 건드리지 않는다 — 이 조건이 없으면 symmetrize 가 바깥을
    # 깎아 비드가 드러날 때마다 또 깎아 멱등이 깨진다(골드 오른쪽에서 실제로 그랬다).
    if prof[0] < face + 0.5 * (255 - face):
        return 0, face
    n = 0
    while n < len(prof) and prof[n] > thr:
        n += 1
    return n, face


def main():
    dry = '--dry' in sys.argv
    mp = os.path.join(OUT, 'frames.json')
    meta = json.load(open(mp, encoding='utf-8'))
    changed = 0
    for name, m in meta.items():
        p = os.path.join(OUT, m['file'])
        im = Image.open(p).convert('RGBA')
        a = np.asarray(im).astype(float)
        L = lum(a)
        h, w = L.shape
        cs = slice(int(w * .3), int(w * .7))
        rs = slice(int(h * .3), int(h * .7))
        profs = {
            't': L[:30, cs].mean(axis=1),
            'b': L[::-1][:30, cs].mean(axis=1),
            'l': L[rs, :30].mean(axis=0),
            'r': L[rs, ::-1][:, :30].mean(axis=0),
        }
        cuts = {}
        for s, pr in profs.items():
            n, face = cut_for(pr)
            if n > MAX_CUT:
                print(f'  ! {name} {s}: {n}px 를 깎아야 한다고 나왔다(앞면 {face:.0f}) — 건너뜀')
                n = 0
            cuts[s] = n
        if not any(cuts.values()):
            print(f'  · {name:12s} 깎을 테 없음')
            continue
        dl, dt, dr, db = cuts['l'], cuts['t'], cuts['r'], cuts['b']
        ix, iy, ix2, iy2 = m['inner']
        print(f'  ✓ {name:12s} 깎음 좌{dl} 우{dr} 상{dt} 하{db}  {w}×{h} → {w - dl - dr}×{h - dt - db}')
        changed += 1
        if dry:
            continue
        im.crop((dl, dt, w - dr, h - db)).save(p)
        m['inner'] = [ix - dl, iy - dt, ix2 - dl, iy2 - dt]
        m['w'], m['h'] = w - dl - dr, h - dt - db
        m['rail'] = min(m['inner'][0], m['inner'][1], m['w'] - 1 - m['inner'][2], m['h'] - 1 - m['inner'][3])
        m['railPct'] = round(m['rail'] / m['w'] * 100, 1)
    if changed and not dry:
        json.dump(meta, open(mp, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    print(f'\n{changed}종 테 깎음' + (' (dry-run)' if dry else '') + ' — 이어서 symmetrize-photo-frames.py 를 돌릴 것')
    return 0


if __name__ == '__main__':
    sys.exit(main())
