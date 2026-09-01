#!/usr/bin/env python3
"""사진 액자의 **네 살 폭을 같게** 맞춘다 (개구부는 그대로, 바깥 경계만 안으로).

    python3 frontend/scripts/symmetrize-photo-frames.py [--dry]

왜 필요한가 (2026-08-30 실측) — GPT 로 뽑은 액자 사진은 완전한 정면이 아니어서
개구부가 살짝 치우쳐 있다. 추출기는 그걸 있는 그대로 적어 두므로 메타가 비대칭이 된다.

    oak    L98  R98  T119 B91   → 위아래 살 폭이 **26.7%** 차이
    white  L98  R89  T111 B96   → 14.5%
    black  L104 R98  T116 B106  →  9.0%

렌더에서 이건 '작품이 액자 안에서 아래로 내려앉은' 것으로 보인다. 실제 액자는 네 변이
같은 몰딩이라 이런 일이 없다 — 그래서 **AI 가 그린 액자** 특유의 위화감이 된다.

고치는 방법은 둘인데, **바깥을 깎는 쪽**을 쓴다.
  ① (채택) 개구부를 고정하고 **바깥 경계를 제일 좁은 살에 맞춰 안으로** 당긴다.
     잃는 건 두꺼운 변의 바깥 몇 px 뿐이고, 코너 조각의 비율이 보존되므로
     **마이터(45°) 이음새가 그대로** 유지된다.
  ② (기각) 그리는 쪽에서 목적지 밴드 폭만 대칭으로 준다 → 코너 조각이 세로로
     눌려 마이터가 45°에서 4° 가량 기운다. 기하는 맞아도 이음새가 틀어진다.

⚠️ **멱등**이다. 이미 대칭이면 아무것도 안 바꾼다. 추출기를 다시 돌린 뒤에 이걸 한 번 더
   돌리면 된다(추출기는 원본이 없는 액자를 지우므로 통합하지 않았다 — walnut 원본이 없다).
"""
import json
import os
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'frontend', 'public', 'artlook', 'frames', 'photo')


def main():
    dry = '--dry' in sys.argv
    mp = os.path.join(OUT, 'frames.json')
    meta = json.load(open(mp, encoding='utf-8'))
    changed = 0
    for name, m in meta.items():
        p = os.path.join(OUT, m['file'])
        im = Image.open(p).convert('RGBA')
        w, h = im.size
        ix, iy, ix2, iy2 = m['inner']
        l, t, r, b = ix, iy, w - 1 - ix2, h - 1 - iy2
        tgt = min(l, t, r, b)
        dl, dt, dr, db = l - tgt, t - tgt, r - tgt, b - tgt
        if dl == dt == dr == db == 0:
            print(f'  · {name:8s} 이미 대칭 (살 {tgt}px)')
            continue
        print(f'  ✓ {name:8s} L{l} R{r} T{t} B{b} → {tgt} '
              f'(깎음 좌{dl} 우{dr} 상{dt} 하{db})  {w}×{h} → {w - dl - dr}×{h - dt - db}')
        changed += 1
        if dry:
            continue
        im.crop((dl, dt, w - dr, h - db)).save(p)
        m['inner'] = [tgt, tgt, tgt + (ix2 - ix), tgt + (iy2 - iy)]
        m['w'], m['h'] = w - dl - dr, h - dt - db
        m['rail'] = tgt
        m['railPct'] = round(tgt / m['w'] * 100, 1)
    if changed and not dry:
        json.dump(meta, open(mp, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    print(f'\n{changed}종 대칭화' + (' (dry-run)' if dry else ''))
    return 0


if __name__ == '__main__':
    sys.exit(main())
