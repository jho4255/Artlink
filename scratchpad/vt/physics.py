#!/usr/bin/env python3
"""6차 라운드 — **물리 일관성** 지표.

앞선 라운드는 "효과가 충분한가"를 쟀다(살 낙차·리베이트 깊이·접지 세기). 그래서
전부 통과하는데도 "shadow 와 shading 이 실제 물체의 물리적 관계를 따르지 않는다"는
지적이 남았다. 이 파일은 **관계**를 잰다 — 세기가 아니라 방향·연속성·평면성.

  ① sh_dir     그림자가 **광원 반대쪽**으로 지는가 (= 브리핑 1번, 체크리스트
                 "cast shadow direction is consistent"). 장면의 lightDir 로 판정한다.
     sh_aniso  그림자가 한쪽으로 몰렸는가, 사방 균일한 헤일로인가.
                 ⚠️ **아래는 벽 결이 바닥을 만든다** — 벽돌 줄눈이 있으면 그림자가
                 없어도 3~6% 가 나온다. 그래서 비(比)만 보지 말고 sh_dir 을 함께 볼 것.
  ② rail_line  살에 **1~2px 짜리 선**이 그어져 있는가 (= 브리핑 2번 "line effect 금지")
                 원본 픽셀에 중앙값 필터를 걸어 그 잔차를 본다 — 폭 있는 면·골·재질
                 경계는 통과하고 임펄스만 남는다.
  ③ gap_floor  액자↔작품 틈의 바닥이 **검정에 얼마나 가까운가** (= 브리핑 3번)

⚠️ 골든과 **같은 코드**로 잰다. 임계는 골든 실측에서 나온다 — 통과시키려고 고치지 말 것.
"""
import json
import sys

import numpy as np
from PIL import Image

import metrics as M

SIDES = ('top', 'bottom', 'left', 'right')
# 그림자가 지는 쪽(광원 반대). lightDir 은 빛이 **오는** 방향이다.
N_SAMP = 64


def _outside_strip(L, rect, side, depth):
    """조각 바깥으로 depth px 내려가는 평균 띠 (변의 가운데 60% 만)."""
    x0, y0, x1, y1 = rect
    w, h = x1 - x0 + 1, y1 - y0 + 1
    if side in ('top', 'bottom'):
        a0, a1 = x0 + int(w * .20), x0 + int(w * .80)
        if side == 'top':
            d = min(depth, y0 - 2)
            return L[max(0, y0 - 1 - d):y0 - 1, a0:a1].mean(1)[::-1] if d >= 8 else None
        d = min(depth, L.shape[0] - y1 - 3)
        return L[y1 + 2:y1 + 2 + d, a0:a1].mean(1) if d >= 8 else None
    a0, a1 = y0 + int(h * .20), y0 + int(h * .80)
    if side == 'left':
        d = min(depth, x0 - 2)
        return L[a0:a1, max(0, x0 - 1 - d):x0 - 1].mean(0)[::-1] if d >= 8 else None
    d = min(depth, L.shape[1] - x1 - 3)
    return L[a0:a1, x1 + 2:x1 + 2 + d].mean(0) if d >= 8 else None


def _darkening(strip):
    """이 변에서 그림자가 벽을 얼마나 떨어뜨렸나(%). metrics.shadow_stats 와 같은 규약:
    기준은 '그림자가 회복해 도달한 밝기'(띠의 최댓값)이고, 물체를 만나면 띠를 끊는다."""
    if strip is None or len(strip) < 8:
        return None
    sm = np.convolve(strip, np.ones(3) / 3, 'same')
    run, cut = 0, len(strip)
    for i in range(2, len(sm)):
        run = run + 1 if sm[i] < sm[i - 1] - 3.0 else 0
        if run >= 3:
            cut = i - 4
            break
    s = strip[:max(6, cut)]
    if len(s) < 6:
        return None
    far = float(np.convolve(s, np.ones(5) / 5, 'same')[2:-2].max()) if len(s) > 8 else float(np.median(s))
    if far < 1:
        return None
    near = float(np.min(np.convolve(s, np.ones(3) / 3, 'same')[1:max(3, len(s) // 2)]))
    return max(0.0, (far - near) / far * 100)


OPP = {'top': (0, -1), 'bottom': (0, 1), 'left': (-1, 0), 'right': (1, 0)}


def shadow_dir_cos(per_side, light_dir):
    """그림자가 **광원 반대쪽**을 향하는가. 1.0 = 정확히 반대, 0 = 직각, −1 = 거꾸로.

    ⚠️ '가장 어두운 변'이 기대한 변인지로 판정하지 말 것 — 좌상단 광이면 아래·오른쪽이
       **정확히 동점**이라 아래위 1% 차이로 성패가 갈린다(실제로 멀쩡한 렌더가 4/9 로
       나왔다). 네 변의 세기를 **벡터로 합쳐** 방향을 보면 동점도 부분 방향도 다 맞는다.
    """
    if not per_side or not light_dir:
        return None
    lx, ly = light_dir
    n = (lx * lx + ly * ly) ** .5 or 1
    vx = sum(v * OPP[s][0] for s, v in per_side.items())
    vy = sum(v * OPP[s][1] for s, v in per_side.items())
    m = (vx * vx + vy * vy) ** .5
    if m < 1e-6:
        return None
    return round((vx * (-lx / n) + vy * (-ly / n)) / m, 3)


def shadow_aniso(L, rect):
    """사방 그림자 세기의 max/min. 1.0 = 완전한 헤일로, 클수록 방향성이 있다."""
    x0, y0, x1, y1 = rect
    depth = max(14, int(min(x1 - x0, y1 - y0) * .16))
    d = {s: _darkening(_outside_strip(L, rect, s, depth)) for s in SIDES}
    d = {k: v for k, v in d.items() if v is not None}
    if len(d) < 3:
        return None
    lo, hi = min(d.values()), max(d.values())
    return {'per_side': {k: round(v, 1) for k, v in d.items()},
            'aniso': round(hi / max(lo, 0.15), 2),
            'dark_side': max(d, key=d.get), 'light_side': min(d, key=d.get)}


def _gap_profile(L, rect, art, side, raw=False):
    """조각 바깥경계 → 작품 경계 구간의 단면. raw=True 면 **원본 픽셀 그대로**."""
    x0, y0, x1, y1 = rect
    ax0, ay0, ax1, ay1 = art
    w, h = x1 - x0 + 1, y1 - y0 + 1
    if side in ('top', 'bottom'):
        a0, a1 = x0 + int(w * .35), x0 + int(w * .65)
        p = (L[y0:ay0 + 1, a0:a1].mean(1) if side == 'top'
             else L[ay1:y1 + 1, a0:a1].mean(1)[::-1])
    else:
        a0, a1 = y0 + int(h * .35), y0 + int(h * .65)
        p = (L[a0:a1, x0:ax0 + 1].mean(0) if side == 'left'
             else L[a0:a1, ax1:x1 + 1].mean(0)[::-1])
    if len(p) < 8:
        return None
    if raw:
        return p
    return np.interp(np.linspace(0, len(p) - 1, N_SAMP), np.arange(len(p)), p)


def _medfilt(a, k=5):
    h = k // 2
    pad = np.pad(a, h, mode='edge')
    return np.median(np.stack([pad[i:i + len(a)] for i in range(k)]), axis=0)


# ── 이 지표가 재면 안 되는 것 두 가지 (둘 다 실제로 잘못 재고 있었다) ──────────────
#  ① **바깥 경계(벽↔액자).** 프로파일이 조각 바깥경계에서 시작하므로 앞 몇 표본에
#     벽↔살 전이가 섞인다. 그건 `keyline_spike` 가 따로 재는 것이고, 여기서 세면
#     **헤일로를 걷어낼수록 점수가 나빠진다**(헤일로가 전이를 부드럽게 해 주므로).
#  ② **작품 자신의 가장자리.** 틈의 마지막 표본은 작품의 첫 픽셀이다. 밝은 매트 옆에
#     어두운 그림이 오면 낙차가 90~106 이 나오는데 그건 **그림이 어두운 것**이지 우리가
#     그린 게 아니다. 실제로 브리핑이 시킨 대로 "작품 둘레 검은 stroke"를 지웠더니
#     매트가 밝아져 이 낙차가 71→106 으로 **올랐다** — 고칠수록 나빠지는 지표였다.
#
#  그래서 '한 표본 최대 낙차(gap_step)'는 **버린다.** 검은 슬림 액자 옆 흰 매트처럼
#  정당한 재질 경계와 그어 넣은 선을 구분하지 못한다. 구분하는 건 `rail_line` 이다 —
#  **stroke 는 좁게 튀었다 되돌아오고, 재질 경계는 단조로 넘어간다.** 5탭 평활 잔차가
#  정확히 그 차이를 잡는다.
SKIP = 3        # 앞 3표본 = 조각 경계의 안티에일리어싱
TAIL = 2        # 뒤 2표본 = 작품의 첫 픽셀


def gap_stats(L, rect, art, rail_frac=None):
    out = {}
    for s in SIDES:
        p0 = _gap_profile(L, rect, art, s)
        if p0 is None:
            continue
        p = p0[SKIP:N_SAMP - TAIL]
        if len(p) < 10:
            continue
        # 살 앞면 평탄부 = 바깥 15~45% 구간의 중앙값 (바깥 모따기·개구부 립을 피한다)
        plateau = float(np.median(p0[int(N_SAMP * .15):int(N_SAMP * .45)]))
        # ── 얇은 선(stroke) 탐지 — **원본 픽셀에서, 중앙값 필터 잔차로** ────────────
        # ⚠️ 리샘플 + 평균 평활로는 못 가른다. 리베이트 골(폭 3px)이나 검은 살↔흰 매트
        #    경계 같은 **정당한 구조**까지 잔차가 커져서, 골든이 낮게 나오는 이유가
        #    "선이 없어서"가 아니라 "살이 두꺼워 리샘플에서 완만해져서"가 된다.
        #    중앙값 필터는 **단조 경계와 폭 있는 골은 그대로 통과시키고 1~2px 임펄스만**
        #    깎는다. stroke 는 정확히 그 임펄스다.
        raw = _gap_profile(L, rect, art, s, raw=True)
        rf = rail_frac if (rail_frac and rail_frac > .12) else 1.0
        q = raw[:max(6, int(len(raw) * min(1.0, rf)))]
        res = float(np.max(np.abs(q - _medfilt(q, 5)))) if len(q) >= 6 else 0.0
        floor = float(np.min(p))
        out[s] = {'plateau': round(plateau, 1), 'line': round(res, 1),
                  'floor': round(floor, 1),
                  'floor_rel': round(floor / max(plateau, 1), 3)}
    if not out:
        return None
    return {'per_side': out,
            'rail_line': round(max(v['line'] for v in out.values()), 1),
            'gap_floor': round(min(v['floor'] for v in out.values()), 1),
            'gap_floor_rel': round(min(v['floor_rel'] for v in out.values()), 3)}


def analyse(path, rect, art, rail_frac=None, light_dir=None):
    a = np.asarray(Image.open(path).convert('RGB')).astype(float)
    L = M.lum(a)
    sh = shadow_aniso(L, rect)
    return {'shadow': sh, 'gap': gap_stats(L, rect, art, rail_frac),
            'dir_cos': shadow_dir_cos(sh['per_side'] if sh else None, light_dir)}


def _row(name, r, extra=''):
    sh, gp = r['shadow'], r['gap']
    an = f"{sh['aniso']:6.2f}" if sh else '     —'
    c = r.get('dir_cos')
    ds = ('   —' if c is None else f'{c:5.2f}') + ('✓' if c is not None and c >= .7 else ' ')
    print(f"{name:16s} {an} {ds:7s} {gp['rail_line']:8.1f} "
          f"{gp['gap_floor']:8.1f} {gp['gap_floor_rel']:8.3f}  {extra}")


if __name__ == '__main__':
    import golden as G
    print('                 그림자   방향   ── 액자↔작품 틈 ──')
    print('케이스           aniso    cos    얇은선     바닥    바닥/살')
    print('-' * 78)
    gold = {}
    for k, g in sorted(G.GOLD.items()):
        r = analyse(f'cases/{k}/frameit_reference.png', g['rect'], G.art_of(g),
                    g['rail'] / max(1, g['gap']))
        gold[k] = r
        _row(k, r, g['note'])
    print('-' * 78)
    scn = json.load(open('/home/jho4255/ArtLink/frontend/public/artlook/scenes/scenes.json'))
    LD = {s['id']: s.get('lightDir') for s in scn['scenes']}
    geo = json.load(open('renders/geometry.json'))
    ours = {}
    for k, c in sorted(geo.items()):
        r = analyse(f'renders/{k}.png', c['rect'], c['art'],
                    c['railPx'] / max(1, c['art'][0] - c['rect'][0]), LD.get(c['scene']))
        ours[k] = r
        _row(k, r, f"{c['frame']} @{c['scene']}")

    def rng(d, get):
        v = [get(x) for x in d.values() if get(x) is not None]
        return f'{min(v):.2f} ~ {max(v):.2f} (중앙 {np.median(v):.2f})' if v else '—'
    print('-' * 78)
    cs = [x['dir_cos'] for x in ours.values() if x.get('dir_cos') is not None]
    print(f'  그림자 방향 cos    최소 {min(cs):.3f} · 중앙 {np.median(cs):.3f}'
          f'   (1=광원 정반대, 0.7 이상이면 45도 안)  {sum(1 for c in cs if c >= .7)}/{len(cs)} 통과')
    for nm, get in (('그림자 aniso', lambda x: x['shadow']['aniso'] if x['shadow'] else None),
                    ('얇은선 rail_line', lambda x: x['gap']['rail_line']),
                    ('틈 바닥/살', lambda x: x['gap']['gap_floor_rel'])):
        print(f'  {nm:18s} 골든 {rng(gold, get):26s}  우리 {rng(ours, get)}')
    if '--save' in sys.argv:
        tag = sys.argv[sys.argv.index('--save') + 1]
        json.dump({'gold': gold, 'ours': ours}, open(f'reports/phys_{tag}.json', 'w'), indent=1)
        print(f'\n기록 저장: reports/phys_{tag}.json')
