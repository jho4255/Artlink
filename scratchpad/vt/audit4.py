#!/usr/bin/env python3
"""4차 감사 — 브리핑 10항목 중 **아직 안 된 것**을 찾는다. 고치기 전에 잰다."""
import json, os, sys
import numpy as np
from PIL import Image
from scipy import ndimage
import golden as G, presence as P

HERE = os.path.dirname(os.path.abspath(__file__))
lum = P.lum

def shadow_shape(path, rect):
    """접지→투영 그림자의 **모양**. 골든과 감쇠 곡선이 같은가."""
    L = lum(np.asarray(Image.open(path).convert('RGB')).astype(float))
    x0, y0, x1, y1 = rect
    w = x1 - x0 + 1
    d = min(max(16, int(w * .30)), L.shape[0] - y1 - 4)
    if d < 12: return None
    lo, hi = x0 + int(w * .25), x0 + int(w * .75)
    s = L[y1 + 2:y1 + 2 + d, lo:hi].mean(axis=1)
    sm = np.convolve(s, np.ones(3) / 3, 'same')
    far = float(sm[2:-2].max())
    if far < 1: return None
    dep = (far - sm) / far                     # 0 = 벽, 1 = 완전 그림자
    at = lambda f: float(dep[min(len(dep) - 1, max(0, int(w * f)))])
    peak = float(dep.max())
    if peak < .01: return None
    return {'d01': round(at(.01) / peak, 2), 'd03': round(at(.03) / peak, 2),
            'd08': round(at(.08) / peak, 2), 'd15': round(at(.15) / peak, 2),
            'peak%': round(peak * 100, 1)}

def edge_acutance(path, rect):
    """조각 바깥 경계의 **날카로움**. 경계 대비 대비 정규화한 최대 기울기(px⁻¹)."""
    L = lum(np.asarray(Image.open(path).convert('RGB')).astype(float))
    x0, y0, x1, y1 = rect
    h = y1 - y0 + 1
    out = []
    for side, prof in (('l', L[y0 + h // 3:y0 + 2 * h // 3, max(0, x0 - 14):x0 + 14].mean(0)),
                       ('r', L[y0 + h // 3:y0 + 2 * h // 3, x1 - 13:min(L.shape[1], x1 + 15)].mean(0)[::-1])):
        if len(prof) < 20: continue
        g = np.abs(np.diff(prof))
        con = abs(float(prof[:6].mean() - prof[-6:].mean()))
        # ⚠️ 벽과 살의 밝기가 비슷하면 분모가 0 에 가까워 비가 폭발한다 — 측정 불가로 뺀다.
        #    실측 t08: 벽 152 · 살 156 → 대비 4 인데 비가 2.67 로 나왔다(경계는 멀쩡했다).
        if con < 20: continue
        out.append(float(g.max()) / con)
    return round(float(np.mean(out)), 3) if out else None

def wall_converge(path, quad):
    """장면 사진 벽의 **원근 수렴**. 세로 모서리가 기울어 있으면 정면이 아니다."""
    A = np.asarray(Image.open(path).convert('L')).astype(float)
    h, w = A.shape
    xs = [p[0] for p in quad]; ys = [p[1] for p in quad]
    y0, y1 = int(min(ys) * h), int(max(ys) * h)
    gx = ndimage.sobel(ndimage.gaussian_filter(A, 2), axis=1)
    gy = ndimage.sobel(ndimage.gaussian_filter(A, 2), axis=0)
    mag = np.hypot(gx, gy)
    band = slice(max(0, y0 - int(h * .1)), min(h, y1 + int(h * .1)))
    m, gxx, gyy = mag[band], gx[band], gy[band]
    strong = m > np.percentile(m, 99.3)
    if strong.sum() < 200: return None
    ang = np.degrees(np.arctan2(gyy[strong], gxx[strong]))       # 기울기 방향
    vert = np.abs(np.abs(ang) - 0) < 25                          # 세로 모서리(가로 기울기)
    if vert.sum() < 50: return None
    tilt = np.abs(ang[vert])
    return round(float(np.percentile(tilt, 90)), 1)

def main():
    print('■ 그림자 모양 (peak 대비 남은 깊이 — 1%/3%/8%/15% 지점)')
    print(f'{"":22s} {"d01":>6s} {"d03":>6s} {"d08":>6s} {"d15":>6s} {"peak%":>7s}  {"acut":>6s}')
    gs = []
    for k, g in sorted(G.GOLD.items()):
        p = f'{HERE}/cases/{k}/frameit_reference.png'
        v = shadow_shape(p, g['rect']); a = edge_acutance(p, g['rect'])
        if v: gs.append(v); print(f'{"■ 골든 " + k:22s} ' + ' '.join(f'{v[c]:6.2f}' for c in ('d01','d03','d08','d15')) + f' {v["peak%"]:7.1f}  {a if a else 0:6.3f}')
    for c in ('d01','d03','d08','d15','peak%'):
        vs=[x[c] for x in gs]; print(f'   골든 {c:5s} min={min(vs):5.2f} 중앙={np.median(vs):5.2f} max={max(vs):5.2f}')
    geo = json.load(open(f'{HERE}/renders/geometry.json'))
    print()
    for cid, g in geo.items():
        p = f'{HERE}/renders/{cid}.png'
        v = shadow_shape(p, g['rect']); a = edge_acutance(p, g['rect'])
        if v: print(f'{cid + " " + g["frame"]:22s} ' + ' '.join(f'{v[c]:6.2f}' for c in ('d01','d03','d08','d15')) + f' {v["peak%"]:7.1f}  {a if a else 0:6.3f}')

    print('\n■ 장면 벽의 원근 수렴 (세로 모서리 기울기 90퍼센타일, ° — 0 이면 완전 정면)')
    R = '/home/jho4255/ArtLink/frontend/public/artlook/'
    d = json.load(open(R + 'scenes/scenes.json'))
    for s in d['scenes']:
        q = s.get('region') or s.get('opening')
        t = wall_converge(R + s['src'], q)
        if t is not None and t > 1.5:
            print(f'   {s["id"]:18s} {t:5.1f}°')
    print('   (1.5° 이하는 생략 — 정면으로 본다)')

if __name__ == '__main__':
    sys.exit(main() or 0)
