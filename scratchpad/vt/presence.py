#!/usr/bin/env python3
"""3차 라운드 지표 — '고급 제품 사진'인가, '벽에 합성한 AI 이미지'인가.

사용자 지적(2026-08-30 밤):
  A. 벽 텍스처가 너무 세서 **액자보다 벽이 먼저 보인다**
  B. 액자가 너무 작다 (화면의 40~50% 를 차지해야 한다)
  G. 액자와 벽의 색온도·대비가 안 맞아 '붙여넣은 티'가 난다

앞선 두 라운드(액자 프로파일·매트·틈)는 **조각 안쪽**만 쟀다. 이번엔 **조각과 배경의
관계**를 잰다 — 같은 그림이라도 벽이 시끄러우면 싸구려 목업이 된다.

⚠️ **고주파는 반드시 같은 축척으로 잴 것.** 이미지 크기가 다르면 픽셀 기준 band-pass
   가 서로 다른 물리적 크기를 재게 된다. 그래서 모든 측정 전에 **긴 변 1200px 로 정규화**
   한다. 안 하면 2600px 벽 렌더와 1024px 골든을 비교할 수 없다.

⚠️ **벽 표본에서 그림자를 빼야 한다.** 조각 둘레는 우리가 만든 그림자라 벽이 아니다.
   조각 바깥으로 조각 크기의 12% 를 띄우고 나서 읽는다.

    python presence.py            # 골든 + 우리 렌더
    python presence.py --save NAME / --vs NAME
"""
import json
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
NORM = 1200.0          # 긴 변을 여기에 맞춰 재기 (축척 통일)

# ── 골든: FrameIt / FrameIt Pro 결과물 ────────────────────────────────────────
# rect 는 기존 golden.py·mat.py 에서 이미 손으로 확정한 좌표를 그대로 쓴다.
import golden as G  # noqa: E402

GOLDEN_EXTRA = {
    'pro_sampleframe': {'path': '/home/jho4255/ArtLink/sampleframe.png',
                        'rect': [272, 72, 886, 784], 'art': [404, 183, 760, 675]},
    'pro_sample2': {'path': '/home/jho4255/ArtLink/sample2.png'},
    'pro_sample3': {'path': '/home/jho4255/ArtLink/sample3.png'},
    'pro_sample4': {'path': '/home/jho4255/ArtLink/sample4.png'},
}

LIMITS = {
    'piece_pct': ('range', (26.0, 58.0), '조각이 화면에서 차지하는 면적 %. 골든에서 실측'),
    # ⚠️ **하한도 필요하다**(브리핑 9항 — "frame 만 선명하고 background 만 부드러워지는
    #    문제"). 그 실패 모드는 '액자 대비가 세다'가 아니라 **'벽을 뭉갰다'** 이므로
    #    con_ratio 상한이 아니라 벽 자체의 하한으로 잡는다(액자가 대비가 센 건 죄가 아니다).
    #    골든 최저가 2.86 이다 — 그 아래면 배경이 정보 없는 면이 된다.
    'wall_hf': ('range', (2.5, 4.5), '벽의 고주파 결(std, 1200px). 골든 2.9~12.6'),
    'hf_ratio': ('>=', 1.30, '조각 디테일 ÷ 벽 디테일. 1 이하면 벽이 더 눈에 띈다'),
    'con_ratio': ('>=', 1.05, '조각 국부대비 ÷ 벽 국부대비. 액자가 배경보다 우세해야'),
    'temp_dl': ('<=', 40.0, '살 ↔ 벽 색상(ab) 거리. 크면 색온도가 따로 논다'),
    'sat_rail': ('<=', 40.0, '살의 채도 폭(max-min). 골든 7~36. 크면 플라스틱 나무'),
    'rail_pct': ('>=', 8.0, '살 밝기가 길이 방향으로 변하는 폭 %. 골든 8.5~104(중앙 12.9)'),
    'rail_cv': ('<=', 0.06, '네 살 폭의 변동계수. 기하 왜곡 감시'),
}


def lum(a):
    return a[..., 0] * .2126 + a[..., 1] * .7152 + a[..., 2] * .0722


def to_lab_ab(rgb):
    """대충의 지각 색도(ab) — 색온도 비교용이라 정확한 CIELAB 까진 필요 없다."""
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    return np.stack([(r - g), ((r + g) / 2 - b)], -1)


def load_norm(path):
    im = Image.open(path).convert('RGB')
    k = NORM / max(im.size)
    if k < 1:
        im = im.resize((max(1, int(im.width * k)), max(1, int(im.height * k))), Image.LANCZOS)
    else:
        k = 1.0
    return np.asarray(im).astype(float), k


def hf(L, mask):
    """대역통과 결(std). 2~8px 대역 — 벽돌 줄눈·나뭇결이 여기 산다."""
    if mask.sum() < 400:
        return 0.0
    band = ndimage.gaussian_filter(L, 1.0) - ndimage.gaussian_filter(L, 4.0)
    return float(band[mask].std())


def local_con(L, mask):
    """국부 RMS 대비 — 반경 12px 평균 대비 편차."""
    if mask.sum() < 400:
        return 0.0
    d = L - ndimage.uniform_filter(L, 25)
    return float(np.sqrt((d[mask] ** 2).mean()))


def measure(path, rect=None, art=None, front=None, rail_px=None):
    A, k = load_norm(path)
    L = lum(A)
    h, w = L.shape
    out = {'canvas': [w, h]}
    if rect is None:
        return out
    x0, y0, x1, y1 = [int(round(v * k)) for v in rect]
    pw, ph = x1 - x0, y1 - y0
    out['piece_pct'] = round(pw * ph / (w * h) * 100, 1)

    piece = np.zeros_like(L, bool)
    piece[max(0, y0):y1, max(0, x0):x1] = True
    # 벽 = 조각 바깥 + 그림자 여유(조각 크기의 12%)
    m = int(max(pw, ph) * .12)
    near = np.zeros_like(L, bool)
    near[max(0, y0 - m):y1 + m, max(0, x0 - m):x1 + m] = True
    wall = ~near
    # 가장자리 8px 은 비네팅·크롭 영향이 있어 뺀다
    edge = np.zeros_like(L, bool)
    edge[8:-8, 8:-8] = True
    wall &= edge
    # ⚠️ **우리 워터마크를 벽으로 세지 말 것.** 우하단 'ArtLink' 는 획 굵기가 딱 2~8px 대역이라
    #    대비 100 이 넘는 글자가 표본에 섞인다. 흰 벽돌(원본 결 3.22)이 5.29 로 측정된 원인이
    #    이것이었다 — 벽이 시끄러운 게 아니라 글자를 벽으로 세고 있었다.
    wall[int(h * .90):, int(w * .82):] = False

    out['wall_lum'] = round(float(L[wall].mean()), 1) if wall.sum() else 0
    out['wall_hf'] = round(hf(L, wall), 2)
    out['wall_range'] = round(float(np.percentile(ndimage.gaussian_filter(L, 12)[wall], 90)
                                    - np.percentile(ndimage.gaussian_filter(L, 12)[wall], 10)), 1) \
        if wall.sum() else 0

    if art is not None:
        ax0, ay0, ax1, ay1 = [int(round(v * k)) for v in art]
        rail = piece.copy()
        rail[max(0, ay0):ay1, max(0, ax0):ax1] = False       # 액자 살 + 매트만
        out['piece_hf'] = round(hf(L, rail), 2)
        out['piece_con'] = round(local_con(L, rail), 2)
        out['piece_lum'] = round(float(L[rail].mean()), 1) if rail.sum() else 0
        # ⚠️ **색온도는 '살'만 봐야 한다.** piece−art 는 매트까지 포함하는데 매트는 거의
        #    흰 종이라, 넓은 매트가 있으면 살 색이 통째로 희석돼 검은 액자가 밝은 회색으로
        #    측정된다(t03 실측 rail RGB 153,151,146 — 실제 살은 검정).
        rb = rail.copy()
        if rail_px and rail_px > 1:
            q = int(round(rail_px * k))
            rb[:] = False
            rb[max(0, y0):y1, max(0, x0):x1] = True
            rb[y0 + q:y1 - q, x0 + q:x1 - q] = False
            rb &= rail
        ab = to_lab_ab(A)
        if rb.sum() > 200 and wall.sum():
            out['temp_dl'] = round(float(np.hypot(*(ab[rb].mean(0) - ab[wall].mean(0)))), 1)
            c = A[rb].mean(0)
            out['sat_rail'] = round(float(c.max() - c.min()), 1)
            out['rail_rel'] = round(float(lum(A[rb]).mean() / max(1, L[wall].mean())), 2)
        # ⚠️ **살이 길이 방향으로 균일하면 그건 인쇄한 띠다** (2026-08-30 5차).
        #    골든 윗살을 9곳에서 재면 8.5~104% 흔들리는데(중앙 12.9) 우리는 **3%** 였다.
        #    광원 기울기 + 마이터 코너 폐색이 만드는 변화다. 절대 레벨이 아니라 **비율**로
        #    본다 — 검은 살은 같은 비율로 변조해도 절대 낙차가 절반이다.
        if rail_px and rail_px > 2:
            q = max(2, int(round(rail_px * k)))
            ra, rb2 = y0 + max(2, int(q * .25)), y0 + max(4, int(q * .70))
            xs = np.linspace(x0 + q * 1.4, x1 - q * 1.4, 9)
            if rb2 > ra and xs[-1] - xs[0] > 20:
                d = max(4, int((x1 - x0) * .02))
                vv = [float(np.median(L[ra:rb2, int(x) - d:int(x) + d])) for x in xs]
                mu2 = float(np.mean(vv))
                if mu2 > 1:
                    out['rail_pct'] = round((max(vv) - min(vv)) / mu2 * 100, 1)
        # 살 폭 대칭 — **앞면** 기준(실루엣은 두께 때문에 늘 비뚤어져 나온다)
        f = [int(round(v * k)) for v in (front if front else rect)]
        rails = [ax0 - f[0], f[2] - ax1, ay0 - f[1], f[3] - ay1]
        mu = np.mean(rails)
        out['rail_cv'] = round(float(np.std(rails) / mu), 3) if mu > 0 else 0
    else:
        out['piece_hf'] = round(hf(L, piece), 2)
        out['piece_con'] = round(local_con(L, piece), 2)
        out['piece_lum'] = round(float(L[piece].mean()), 1)
    out['wall_con'] = round(local_con(L, wall), 2)
    out['hf_ratio'] = round(out['piece_hf'] / max(.01, out['wall_hf']), 2)
    out['con_ratio'] = round(out['piece_con'] / max(.01, out['wall_con']), 2)
    return out


def ok(n, v, g=None):
    if n not in LIMITS:
        return True
    kind, lim = LIMITS[n][0], LIMITS[n][1]
    if kind == 'range':
        return lim[0] <= v <= lim[1]
    return v >= lim if kind == '>=' else v <= lim


COLS = ['piece_pct', 'wall_hf', 'hf_ratio', 'con_ratio',
        'sat_rail', 'rail_pct', 'temp_dl', 'rail_cv']


def row(name, v, bad=()):
    cells = []
    for c in COLS:
        s = f'{v[c]:.2f}' if c in v else '-'
        cells.append(f'{("!" + s) if c in bad else s:>9s}')
    return f'{name:30s} ' + ' '.join(cells)


def main():
    print(f'{"":30s} ' + ' '.join(f'{c:>9s}' for c in COLS))
    gold = {}
    for k, g in sorted(G.GOLD.items()):
        v = measure(f'{HERE}/cases/{k}/frameit_reference.png', g['rect'], G.art_of(g))
        gold['fi_' + k] = v
        print(row('■ 골든 ' + k, v))
    for k, g in GOLDEN_EXTRA.items():
        if not os.path.exists(g['path']) or 'rect' not in g:
            continue
        v = measure(g['path'], g['rect'], g.get('art'))
        gold[k] = v
        print(row('■ 골든 ' + k, v))
    print()
    for c in COLS:
        vs = [x[c] for x in gold.values() if c in x]
        if vs:
            print(f'  골든 {c:11s} min={min(vs):7.2f}  median={np.median(vs):7.2f}  max={max(vs):7.2f}')

    geo_p = f'{HERE}/renders/geometry.json'
    if not os.path.exists(geo_p):
        return 0
    geo = json.load(open(geo_p))
    print()
    rows, nfail = {}, 0
    for cid, g in geo.items():
        p = f'{HERE}/renders/{cid}.png'
        if not os.path.exists(p):
            continue
        v = measure(p, g['rect'], g['art'], g.get('front'), g.get('railPx'))
        rows[cid] = v
        bad = [c for c in COLS if c in v and not ok(c, v[c], g)]
        nfail += bool(bad)
        print(row(f'{cid} {g["frame"]}', v, bad) + ('   FAIL' if bad else '   pass'))
    print()
    for m, (kind, lim, why) in LIMITS.items():
        n = sum(1 for cid, v in rows.items() if ok(m, v.get(m, 0), geo.get(cid)))
        s = str(lim) if kind == 'range' else kind + str(lim)
        print(f'  {m:10s} {s:>14s}  {n}/{len(rows)} 통과   {why}')
    print(f'\n케이스 {len(rows)} 중 {len(rows) - nfail} 통과')

    os.makedirs(f'{HERE}/reports', exist_ok=True)
    cur = {'golden': gold, 'ours': rows}
    if '--save' in sys.argv:
        n = sys.argv[sys.argv.index('--save') + 1]
        json.dump(cur, open(f'{HERE}/reports/presence_{n}.json', 'w'), indent=1)
        print(f'저장 → reports/presence_{n}.json')
    if '--vs' in sys.argv:
        n = sys.argv[sys.argv.index('--vs') + 1]
        old = json.load(open(f'{HERE}/reports/presence_{n}.json'))['ours']
        print(f'\n=== {n} 대비 ===')
        for cid, v in rows.items():
            if cid not in old:
                continue
            d = [f'{c} {old[cid][c]:.2f}→{v[c]:.2f}' for c in COLS
                 if c in v and c in old[cid] and abs(v[c] - old[cid][c]) > max(.05, abs(old[cid][c]) * .04)]
            if d:
                print(f'  {cid:5s} ' + '  '.join(d))
    json.dump(cur, open(f'{HERE}/reports/presence_last.json', 'w'), indent=1)
    return 1 if nfail else 0


if __name__ == '__main__':
    sys.exit(main())
