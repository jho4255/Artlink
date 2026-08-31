#!/usr/bin/env python3
"""5차 감사 — "아직 합성 같다"의 남은 원인을 잰다.

새 축 다섯. 전부 **골든에 같은 코드**를 돌려 목표를 얻는다.
  edge_acut   조각 바깥 경계의 날카로움 — 사진보다 날카로우면 그 자체가 합성 신호다
  ao_lit      **빛을 받는 쪽** 벽의 어두워짐 — 방향 그림자가 아닌 폐색(AO). 없으면 경계가 너무 깨끗하다
  rail_along  살 밝기가 **길이 방향으로** 얼마나 변하는가 — 0 이면 인쇄한 띠
  gap_stages  살 → 작품 단면의 마디 수 — 1~2 면 '검은 테두리'
  center_off  화면 중앙에서 벗어난 정도 %
"""
import json, os, sys
import numpy as np
from PIL import Image
from scipy import ndimage
import golden as G, presence as P

HERE = os.path.dirname(os.path.abspath(__file__))
lum = P.lum


def prof_side(L, rect, side, rail):
    """조각 바깥 → 안쪽으로 가는 단면(각 변 중앙). 반환: (벽쪽 포함 프로파일, 경계 index)"""
    x0, y0, x1, y1 = rect
    w, h = x1 - x0 + 1, y1 - y0 + 1
    out = max(8, int(rail * 1.2)); ins = max(10, int(rail * 3.0))
    b = max(6, int(min(w, h) * .06))
    if side == 't':
        s = L[max(0, y0 - out):y0 + ins, x0 + w // 2 - b:x0 + w // 2 + b].mean(1)
    elif side == 'b':
        s = L[y1 - ins:min(L.shape[0], y1 + out), x0 + w // 2 - b:x0 + w // 2 + b].mean(1)[::-1]
    elif side == 'l':
        s = L[y0 + h // 2 - b:y0 + h // 2 + b, max(0, x0 - out):x0 + ins].mean(0)
    else:
        s = L[y0 + h // 2 - b:y0 + h // 2 + b, x1 - ins:min(L.shape[1], x1 + out)].mean(0)[::-1]
    return s, out


def wall_light(L, rect):
    """조각 둘레 벽의 밝기 기울기 → 빛이 오는 방향(단위벡터). 조각 크기의 12~40% 띠."""
    x0, y0, x1, y1 = rect
    w, h = x1 - x0 + 1, y1 - y0 + 1
    m0, m1 = int(max(w, h) * .12), int(max(w, h) * .40)
    g = lambda a: float(np.median(a)) if a.size > 50 else None
    up = g(L[max(0, y0 - m1):max(0, y0 - m0), x0:x1])
    dn = g(L[y1 + m0:y1 + m1, x0:x1])
    lf = g(L[y0:y1, max(0, x0 - m1):max(0, x0 - m0)])
    rt = g(L[y0:y1, x1 + m0:x1 + m1])
    if None in (up, dn, lf, rt):
        return None
    v = np.array([lf - rt, up - dn])
    n = np.hypot(*v)
    return v / n if n > 1e-6 else np.array([0., -1.])


def ao_lit(L, rect, ld):
    """**빛을 받는 쪽** 두 변에서, 경계 바로 밖 벽이 먼 벽보다 얼마나 어두운가(레벨).
       방향 그림자는 반대쪽에 지므로, 이쪽이 어두우면 그건 폐색(AO)이다."""
    x0, y0, x1, y1 = rect
    w, h = x1 - x0 + 1, y1 - y0 + 1
    # ⚠️ 조각이 화면의 44% 를 차지하므로 '먼 벽'을 조각 크기의 30% 로 잡으면 화면 밖이다.
    #    쓸 수 있는 여백에 맞춰 줄인다 — 안 그러면 전 케이스가 측정 불가로 빠진다.
    near = max(3, int(min(w, h) * .012))
    room = max(y0, x0, L.shape[1] - x1, L.shape[0] - y1) - 12
    far = int(max(30, min(max(w, h) * .30, room)))
    b = max(6, int(min(w, h) * .25))
    res = []
    if ld[1] > 0.25 and y0 - far > 4:                     # 위가 광원(위 벽이 밝다)
        n = L[y0 - near - 3:y0 - 2, x0 + w // 2 - b:x0 + w // 2 + b]
        f = L[max(0, y0 - far):y0 - far + 30, x0 + w // 2 - b:x0 + w // 2 + b]
        if n.size > 40 and f.size > 40: res.append(float(np.median(f) - np.median(n)))
    if ld[0] > 0.25 and x0 - far > 4:                     # 왼쪽이 광원
        n = L[y0 + h // 2 - b:y0 + h // 2 + b, x0 - near - 3:x0 - 2]
        f = L[y0 + h // 2 - b:y0 + h // 2 + b, max(0, x0 - far):x0 - far + 30]
        if n.size > 40 and f.size > 40: res.append(float(np.median(f) - np.median(n)))
    if ld[0] < -0.25 and x1 + far < L.shape[1] - 4:       # 오른쪽이 광원
        n = L[y0 + h // 2 - b:y0 + h // 2 + b, x1 + 3:x1 + near + 4]
        f = L[y0 + h // 2 - b:y0 + h // 2 + b, x1 + far - 30:x1 + far]
        if n.size > 40 and f.size > 40: res.append(float(np.median(f) - np.median(n)))
    return round(float(np.mean(res)), 1) if res else None


def rail_along(L, rect, rail):
    """윗살 앞면 밝기를 길이 방향 9곳에서 재고 최대−최소(레벨). 0 이면 균일한 띠."""
    x0, y0, x1, y1 = rect
    w = x1 - x0 + 1
    a, b = y0 + max(2, int(rail * .25)), y0 + max(4, int(rail * .70))
    if b - a < 2: return None
    xs = np.linspace(x0 + rail * 1.4, x1 - rail * 1.4, 9)
    if xs[-1] - xs[0] < 20: return None
    v = [float(np.median(L[a:b, int(x) - max(4, int(w * .02)):int(x) + max(4, int(w * .02))]))
         for x in xs]
    # ⚠️ **절대 레벨만 보면 어두운 액자가 부당하게 실패한다** — 검은 살(L≈90)은 같은 비율로
    #    변조해도 밝은 살(L≈185)의 절반밖에 안 움직인다. 비율을 함께 본다(run.py 의
    #    `rebate_ratio` 와 같은 이유).
    m = float(np.mean(v))
    return round(max(v) - min(v), 1), round((max(v) - min(v)) / max(m, 1) * 100, 1)


def gap_stages(L, rect, rail):
    """살 → 작품 단면의 **마디 수**(부호가 바뀌는 횟수). 검은 테두리 하나면 1~2 다."""
    n = []
    for side in 'tblr':
        s, out = prof_side(L, rect, side, rail)
        seg = s[out:out + max(8, int(rail * 2.2))]
        if len(seg) < 8: continue
        d = np.diff(ndimage.uniform_filter1d(seg, 3))
        sg = np.sign(d[np.abs(d) > 0.35])
        if len(sg) < 3: continue
        n.append(int(np.sum(sg[1:] * sg[:-1] < 0)) + 1)
    return round(float(np.mean(n)), 1) if n else None


def gap_vs_art(L, rect, rail):
    """리세스 골의 최저점이 **작품 가장자리보다 얼마나 어두운가**(레벨).
       0 이하면 '작품이 액자 뒤로 들어가 있다'는 신호가 없다."""
    res = []
    for side in 'tblr':
        s, out = prof_side(L, rect, side, rail)
        g0, g1 = out + int(rail * .6), out + int(rail * 1.6)
        a0, a1 = out + int(rail * 1.8), out + int(rail * 3.0)
        if a1 > len(s) or g1 <= g0: continue
        res.append(float(np.median(s[a0:a1]) - s[g0:g1].min()))
    return round(float(np.mean(res)), 1) if res else None


def run(path, rect, rail):
    A = np.asarray(Image.open(path).convert('RGB')).astype(float)
    L = lum(A)
    ld = wall_light(L, rect)
    h, w = L.shape
    x0, y0, x1, y1 = rect
    cx, cy = (x0 + x1) / 2 / w, (y0 + y1) / 2 / h
    from audit4 import edge_acutance
    return {'edge_acut': edge_acutance(path, rect),
            'ld': None if ld is None else [round(float(ld[0]), 2), round(float(ld[1]), 2)],
            'ao_lit': None if ld is None else ao_lit(L, rect, ld),
            'rail_along': (rail_along(L, rect, rail) or (None, None))[0],
            'rail_pct': (rail_along(L, rect, rail) or (None, None))[1],
            'gap_stages': gap_stages(L, rect, rail),
            'gap_dark': gap_vs_art(L, rect, rail),
            'center_off': round(float(np.hypot(cx - .5, cy - .5) * 100), 1)}


COLS = ['edge_acut', 'ao_lit', 'rail_along', 'rail_pct', 'gap_stages', 'gap_dark', 'center_off']
fmt = lambda v: '   -  ' if v is None else f'{v:6.2f}'


def main():
    print(f'{"":22s} ' + ' '.join(f'{c:>11s}' for c in COLS) + '   광원')
    gs = []
    for k, g in sorted(G.GOLD.items()):
        v = run(f'{HERE}/cases/{k}/frameit_reference.png', g['rect'], g['rail'])
        gs.append(v)
        print(f'{"■ 골든 " + k:22s} ' + ' '.join(f'{fmt(v[c]):>11s}' for c in COLS) + f'   {v["ld"]}')
    for c in COLS:
        vs = [x[c] for x in gs if x[c] is not None]
        if vs: print(f'   골든 {c:11s} min={min(vs):7.2f} 중앙={np.median(vs):7.2f} max={max(vs):7.2f}')
    geo = json.load(open(f'{HERE}/renders/geometry.json'))
    print()
    for cid, g in geo.items():
        v = run(f'{HERE}/renders/{cid}.png', g['rect'], max(6, g['railPx']))
        print(f'{cid + " " + g["frame"]:22s} ' + ' '.join(f'{fmt(v[c]):>11s}' for c in COLS) + f'   {v["ld"]}')


if __name__ == '__main__':
    sys.exit(main() or 0)
