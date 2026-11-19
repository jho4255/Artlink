#!/usr/bin/env python3
"""WP9 품질 관문 — 색 옮긴 액자가 '원본(가진 사진 액자)보다 못하지 않은가'를 같은 잣대로 잰다.

사용자(2026-11-17): "새로 만드는 생성형 액자는 기존 대비 퀄리티를 철저히 검증해야 한다. 퀄이 떨어지면 없는 것만 못하다."

    python3 wp9gate.py            # wp9/assets(엔진이 그리는 액자 사진) + wp9/after(렌더, 흰 플라스터 · 매트 5%)

사진 단계(원본과 견준다)
  G1 잘림   — 색을 옮기다 색역을 넘어 0·255 로 잘린 픽셀의 **실제 색 오차**(의도한 색 ↔ 잘린 색, OKLab ×100)가
              2(≈ 1 JND)를 넘는 픽셀이 0.1% 를 넘으면 탈락 — 하이라이트가 하얗게 뭉개지거나 그늘의 색이 틀어진다
  G2 결     — 앞면 띠의 밝기 결(고주파 표준편차)이 원본의 0.80~1.25배 밖이면 탈락(결이 뭉개지거나 튄다)
렌더 단계(같은 작품 · 같은 벽 · 같은 매트)
  G3 채도   — 살의 채도 폭(sat_rail)이 골든 한계(40, 실물 FrameIt 사진 7~36 — 규칙 41)를 넘으면 탈락('플라스틱 액자')
  G4 얼룩   — 살의 색 편차(얼룩)가 기존 액자 중 가장 큰 것보다 크면 탈락
  G5 결     — 렌더에서 살의 밝기 결이 원본 렌더의 0.75~1.33배 밖이면 탈락
  G6 구분   — 같은 모양(몰딩)의 기존 액자 · 앞서 통과한 후보와 ΔE2000 10 미만이면 탈락.
              10 은 기존에서 '구분되는' 가장 가까운 쌍(오크–실버 10.0 · 메이플–화이트 10.2 · 월넛–블랙 11.2)이고,
              '비슷한 베이지'로 읽히는 오크–골드 7.4 · 오크–메이플 7.5 는 그 아래다(2026-11-17 리뷰). 평균색 OKLab 거리(v1)는
              밝은 색의 엷은 색조 차이를 과소평가해 눈과 어긋났다(세이지–메이플 2.6 인데 시트에선 분명히 갈린다) — 그래서 ΔE2000.
그 밖에 전수 판정(sweepcheck — 원본이 통과하는 항목은 후보도 통과) · 무매트(nomat) · 눈 확인(시트)은 따로 본다.
"""
import json, os, sys
import numpy as np
from PIL import Image
from scipy.ndimage import uniform_filter
PHOTO = '/home/jho4255/ArtLink/frontend/public/artlook/frames/photo'
def lin2oklab(c):
    l = np.cbrt(0.4122214708 * c[..., 0] + 0.5363325363 * c[..., 1] + 0.0514459929 * c[..., 2])
    m = np.cbrt(0.2119034982 * c[..., 0] + 0.6806995451 * c[..., 1] + 0.1073969566 * c[..., 2])
    s_ = np.cbrt(0.0883024619 * c[..., 0] + 0.2817188376 * c[..., 1] + 0.6299787005 * c[..., 2])
    return np.stack([0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s_,
                     1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s_,
                     0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s_], -1)
def oklab2lin(lab):
    L, a, b = lab[..., 0], lab[..., 1], lab[..., 2]
    l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3; m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3; s_ = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
    return np.stack([4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s_, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s_,
                     -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s_], -1)
sys.path.insert(0, '/home/jho4255/ArtLink/scratchpad/vt')
import presence as P

def _lab(m):   # OKLab 평균 → CIELAB(D65) — ΔE2000 용
    lin = oklab2lin(np.asarray(m)[None, :])[0]
    X = 0.4124 * lin[0] + 0.3576 * lin[1] + 0.1805 * lin[2]; Y = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]; Z = 0.0193 * lin[0] + 0.1192 * lin[1] + 0.9505 * lin[2]
    f = lambda t: np.cbrt(t) if t > 0.008856 else 7.787 * t + 16 / 116
    fx, fy, fz = f(X / 0.95047), f(Y), f(Z / 1.08883)
    return np.array([116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)])
def de2000(m1, m2):
    (L1, a1, b1), (L2, a2, b2) = _lab(m1), _lab(m2)
    C1, C2 = np.hypot(a1, b1), np.hypot(a2, b2); Cb = (C1 + C2) / 2
    G = 0.5 * (1 - np.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)))
    a1p, a2p = (1 + G) * a1, (1 + G) * a2
    C1p, C2p = np.hypot(a1p, b1), np.hypot(a2p, b2)
    h1p, h2p = np.degrees(np.arctan2(b1, a1p)) % 360, np.degrees(np.arctan2(b2, a2p)) % 360
    dLp, dCp, dh = L2 - L1, C2p - C1p, h2p - h1p
    if C1p * C2p == 0: dh = 0
    elif dh > 180: dh -= 360
    elif dh < -180: dh += 360
    dHp = 2 * np.sqrt(C1p * C2p) * np.sin(np.radians(dh / 2))
    Lbp, Cbp = (L1 + L2) / 2, (C1p + C2p) / 2
    if C1p * C2p == 0: hbp = h1p + h2p
    elif abs(h1p - h2p) <= 180: hbp = (h1p + h2p) / 2
    elif h1p + h2p < 360: hbp = (h1p + h2p + 360) / 2
    else: hbp = (h1p + h2p - 360) / 2
    T = 1 - 0.17 * np.cos(np.radians(hbp - 30)) + 0.24 * np.cos(np.radians(2 * hbp)) + 0.32 * np.cos(np.radians(3 * hbp + 6)) - 0.20 * np.cos(np.radians(4 * hbp - 63))
    dth = 30 * np.exp(-((hbp - 275) / 25) ** 2); Rc = 2 * np.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7))
    Sl = 1 + 0.015 * (Lbp - 50) ** 2 / np.sqrt(20 + (Lbp - 50) ** 2); Sc = 1 + 0.045 * Cbp; Sh = 1 + 0.015 * Cbp * T; Rt = -np.sin(np.radians(2 * dth)) * Rc
    return float(np.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh)))

HERE = os.path.dirname(os.path.abspath(__file__))
A = f'{HERE}/wp9/assets'
R = f'{HERE}/wp9/after'
amet = json.load(open(f'{A}/meta.json'))
rmet = json.load(open(f'{R}/meta.json'))

def oklab(rgb):
    c = rgb.astype(np.float64) / 255
    c = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    l = np.cbrt(0.4122214708 * c[..., 0] + 0.5363325363 * c[..., 1] + 0.0514459929 * c[..., 2])
    m = np.cbrt(0.2119034982 * c[..., 0] + 0.6806995451 * c[..., 1] + 0.1073969566 * c[..., 2])
    s = np.cbrt(0.0883024619 * c[..., 0] + 0.2817188376 * c[..., 1] + 0.6299787005 * c[..., 2])
    return np.stack([0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
                     1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
                     0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s], -1)

def band_mask(h, w, x0, y0, x1, y1, t, a=0.25, b=0.6):
    """사각 액자의 앞면 띠(살 두께의 a~b 깊이, 모서리 t 는 뺀다) — 바깥 상자 (x0,y0)-(x1,y1), 살 두께 t"""
    m = np.zeros((h, w), bool)
    da, db = int(round(t * a)), max(int(round(t * b)), int(round(t * a)) + 1)
    xs, xe, ys, ye = int(x0 + t), int(x1 - t), int(y0 + t), int(y1 - t)
    m[int(y0) + da:int(y0) + db, xs:xe] = True            # 위
    m[int(y1) - db:int(y1) - da, xs:xe] = True            # 아래
    m[ys:ye, int(x0) + da:int(x0) + db] = True            # 왼
    m[ys:ye, int(x1) - db:int(x1) - da] = True            # 오른
    return m

def hp_std(L, mask, k=7):
    return float(np.std((L - uniform_filter(L, k))[mask]))

# ── 사진 단계 ─────────────────────────────────────────────
def clip_error(key):
    """엔진의 tintImage 를 그대로 다시 계산 — 의도한 색(잘리기 전)과 잘린 색의 차이. 엔진 결과와도 대조한다"""
    me = amet[key]['meta']
    raw = np.asarray(Image.open(f"{PHOTO}/{me['file']}").convert('RGBA')).astype(np.float64)
    al = raw[..., 3]; op = al > 0
    c = raw[..., :3] / 255; lin = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    lab = lin2oklab(lin)
    mean = lab[al > 250].mean(0)
    t = np.array([int(me['tint'][i:i + 2], 16) for i in (1, 3, 5)]) / 255
    T = lin2oklab(np.where(t <= 0.04045, t / 12.92, ((t + 0.055) / 1.055) ** 2.4)[None, :])[0]
    kL = 1 if me.get('kL') is None else me['kL']; kAB = 1 if me.get('kAB') is None else me['kAB']
    want = np.empty_like(lab)
    want[..., 0] = np.maximum(0, T[0] + (lab[..., 0] - mean[0]) * kL)
    want[..., 1] = T[1] + (lab[..., 1] - mean[1]) * kAB
    want[..., 2] = T[2] + (lab[..., 2] - mean[2]) * kAB
    lin2 = oklab2lin(want)
    got = lin2oklab(np.clip(lin2, 0, 1))
    err = np.linalg.norm(got - want, axis=-1) * 100
    # 엔진이 실제로 그린 것과 같은 식인지(8비트 반올림 차이만 있어야 한다)
    s8 = np.clip(lin2, 0, 1); s8 = np.where(s8 <= 0.0031308, 12.92 * s8, 1.055 * np.power(s8, 1 / 2.4) - 0.055) * 255
    eng = np.asarray(Image.open(f'{A}/{key}.png').convert('RGBA')).astype(np.float64)[..., :3]
    same = float(np.abs(np.round(s8) - eng)[op].max())
    return float(np.mean(err[op] > 2)), float(np.percentile(err[op], 99.9)), same

def asset_stats(key):
    im = np.asarray(Image.open(f'{A}/{key}.png').convert('RGBA'))
    rgb, al = im[..., :3], im[..., 3]
    op = al > 250
    clip = float(np.mean(((rgb == 0) | (rgb == 255)).any(-1)[op]))
    ix, iy, ix2, iy2 = amet[key]['meta']['inner']
    h, w = al.shape
    t = min(ix, iy, w - 1 - ix2, h - 1 - iy2)
    m = band_mask(h, w, 0, 0, w - 1, h - 1, t) & op
    L = oklab(rgb)[..., 0]
    return {'clip': clip, 'tex': hp_std(L, m)}

# ── 렌더 단계 ─────────────────────────────────────────────
def render_stats(fid, mat=0.05):
    k = f'{fid}_m{mat}'
    me = rmet[k]
    im = np.asarray(Image.open(f'{R}/{k}.png').convert('RGB'))
    p, t = me['piece'], me['railPx']
    h, w = im.shape[:2]
    m = band_mask(h, w, p['x'], p['y'], p['x'] + p['w'] - 1, p['y'] + p['h'] - 1, t)
    lab = oklab(im)
    sel = lab[m]
    mean = sel.mean(0)
    noise = float(np.sqrt(sel[:, 1].var() + sel[:, 2].var()))
    box = lambda b: [round(b['x']), round(b['y']), round(b['x'] + b['w']) - 1, round(b['y'] + b['h']) - 1]
    pv = P.measure(f'{R}/{k}.png', box(p), box(me['art']), box(p), round(t))
    return {'mean': mean, 'chroma': float(np.hypot(mean[1], mean[2])), 'noise': noise, 'tex': hp_std(lab[..., 0], m), 'railPx': t,
            'sat_rail': pv.get('sat_rail', 0)}

frames = sorted({v['id'] for v in rmet.values()})
TINT = {k: v['meta']['tintBase'] for k, v in amet.items() if v['meta'].get('tintBase')}
# 후보 id → 사진 열쇠(엔진 FRAMES 와 같은 이름 규칙: <원본>@<id>)
cand = {k.split('@')[1]: k for k in TINT}
base_frame = {'black': 'black', 'white': 'white', 'oak': 'oak', 'walnut': 'walnut'}
existing = [f for f in frames if f not in cand]
MOLDING = ['oak', 'walnut', 'maple', 'black', 'white', 'silver', 'gold']

rs = {f: render_stats(f) for f in frames}
ex_chroma = max(rs[f]['chroma'] for f in existing)
ex_noise = max(rs[f]['noise'] for f in existing)
ex_noise = max(rs[f]['noise'] for f in existing)
print(f'기존 {len(existing)}종 — 얼룩 최대 {ex_noise*100:.2f}({max(existing, key=lambda f: rs[f]["noise"])}) · 채도 폭 최대 {max(rs[f]["sat_rail"] for f in existing):.1f}({max(existing, key=lambda f: rs[f]["sat_rail"])})')
print(f'{"후보":10s} {"원본":7s} {"G1오차>2%":>9s} {"(99.9%)":>7s} {"G2사진결":>8s} {"G3채도폭":>8s} {"G4얼룩":>7s} {"G5렌더결":>8s} {"G6최소ΔE00":>15s}  판정')
accepted, report = [], {}
order = ['navy', 'forest', 'burgundy', 'charcoal', 'sage', 'dustblue', 'cream', 'blush', 'cherry', 'honey', 'greywash', 'espresso', 'wine', 'teak']
for cid in [c for c in order if c in cand]:
    key = cand[cid]; b = TINT[key]
    frac, p999, same = clip_error(key)
    assert same <= 2, f'{key}: 다시 계산한 색이 엔진과 다르다({same})'
    a_c, a_b = asset_stats(key), asset_stats(b)
    r_c, r_b = rs[cid], rs[base_frame[b]]
    g2 = a_c['tex'] / a_b['tex']
    g5 = r_c['tex'] / r_b['tex']
    others = MOLDING + accepted
    dEs = sorted((de2000(r_c['mean'], rs[f]['mean']), f) for f in others)
    bad = []
    if frac > 0.001: bad.append('G1')
    if not (0.80 <= g2 <= 1.25): bad.append('G2')
    if not P.ok('sat_rail', r_c['sat_rail']): bad.append('G3')
    if r_c['noise'] > ex_noise: bad.append('G4')
    if not (0.75 <= g5 <= 1.33): bad.append('G5')
    if dEs[0][0] < 10: bad.append('G6')
    ok = not bad
    if ok: accepted.append(cid)
    report[cid] = {'base': b, 'clipErrFrac': frac, 'clipErrP999': p999, 'g2': g2, 'sat_rail': r_c['sat_rail'], 'noise': r_c['noise'] * 100, 'g5': g5,
                   'nearest': dEs[:3], 'bad': bad}
    print(f'{cid:10s} {b:7s} {frac*100:9.3f} {p999:7.2f} {g2:8.2f} {r_c["sat_rail"]:8.1f} {r_c["noise"]*100:7.2f} {g5:8.2f} {dEs[0][0]:7.1f}({dEs[0][1][:6]})  {"통과" if ok else "탈락 " + ",".join(bad)}')
print('\n통과:', accepted)
json.dump(report, open(f'{HERE}/wp9/gate.json', 'w'), ensure_ascii=False, indent=1, default=str)
