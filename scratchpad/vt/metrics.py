#!/usr/bin/env python3
"""ArtLook 액자 렌더 — 객관 지표.

'비슷해 보인다'를 못 쓰게 하는 게 목적이다. 레퍼런스(FrameIt)와 우리 렌더에
**같은 코드**로 잰다 — 다른 방법으로 재면 숫자가 달라도 그게 렌더 차이인지 측정
차이인지 알 수 없다.

한 변을 가로지르는 단면 p (벽 → 안쪽):
    [ 벽 … | i0 조각 바깥경계 | 살(rail) railPx | 리베이트 구간 | iart 작품 경계 | 작품 … ]

⚠️ 측정을 망가뜨렸던 것들 — 되돌리지 말 것
 ① **조각 사각형을 이미지에서 다시 찾지 말 것.** 색으로 찾으면 오른쪽 투영 그림자가
    조각으로 잡혀 경계가 16px 밀린다(case_00 실측). 우리 렌더는 페이지의 계측 훅
    `window.__artlook` 이 정확히 알려주고, 레퍼런스는 손으로 확정한다.
 ② **리베이트를 작품 안에서 재지 말 것.** 어두운 그림이면 그림 자체가 최소값이라
    액자와 무관하게 큰 값이 나온다. 리베이트 구간은 **살 중간 ~ 작품 경계**,
    즉 작품 픽셀이 절대 포함되지 않는 구간으로 못박는다.
 ③ **키라인은 ±3px 로 잴 것.** ±2px 면 흰 액자의 바깥 모따기(자연스러운 3px 음영)까지
    '검은 테'로 잡힌다. 우리가 잡으려는 건 1px 절벽이다.
"""
import numpy as np
from PIL import Image

SIDES = ('top', 'bottom', 'left', 'right')


def lum(a):
    return a[..., 0] * .2126 + a[..., 1] * .7152 + a[..., 2] * .0722


def _slice(L, rect, side, out_px, in_px, band=.30):
    """한 변을 가로지르는 평균 단면과, 그 안에서 바깥경계의 인덱스."""
    x0, y0, x1, y1 = rect
    w, h = x1 - x0 + 1, y1 - y0 + 1
    if side in ('top', 'bottom'):
        a0, a1 = x0 + int(w * (.5 - band / 2)), x0 + int(w * (.5 + band / 2))
        if side == 'top':
            k = min(out_px, y0)
            return L[y0 - k:y0 + in_px, a0:a1].mean(1), k
        k = min(out_px, L.shape[0] - 1 - y1)
        return L[y1 - in_px:y1 + k + 1, a0:a1].mean(1)[::-1], k
    a0, a1 = y0 + int(h * (.5 - band / 2)), y0 + int(h * (.5 + band / 2))
    if side == 'left':
        k = min(out_px, x0)
        return L[a0:a1, x0 - k:x0 + in_px].mean(0), k
    k = min(out_px, L.shape[1] - 1 - x1)
    return L[a0:a1, x1 - in_px:x1 + k + 1].mean(0)[::-1], k


def _side_stats(p, i0, rail_px, art_px):
    """rail_px = 조각 경계~살 끝, art_px = 조각 경계~작품 경계 (둘 다 px)."""
    n = len(p)
    r = max(3, int(rail_px))
    ia = max(r, min(n - 2, int(art_px)))
    if n < i0 + ia + 2:
        return None
    s = i0 + 1
    rail = p[s:i0 + r]                                  # 살 전체(바깥 모따기~안쪽 사면)
    if len(rail) < 3:
        rail = p[s:s + 3]
    plate = p[s:s + max(2, int(r * .45))]               # 살 앞면 평탄부
    plateau = float(np.median(plate))
    # 리베이트 — 살 중간부터 작품 경계까지. 작품 픽셀은 절대 안 들어간다.
    b0, b1 = i0 + max(2, int(r * .55)), i0 + ia
    band = p[b0:b1] if b1 - b0 >= 2 else p[max(s, i0 + ia - 2):i0 + ia]
    trough = float(np.min(band)) if len(band) else plateau
    rebate = max(0.0, plateau - trough)
    # ⚠️ **절대 낙차만 보면 어두운 액자가 부당하게 실패한다.** 검은 액자는 살 자체가
    #    L≈40 이라 물리적으로 옳게 그늘져도 낙차가 30 을 못 넘는다(곱연산이므로).
    #    눈이 '들어가 있다'고 읽는 건 **상대 대비**다. 골든 실측 비율 0.24~0.80.
    ratio = max(0.0, rebate / max(plateau, 1.0))
    # 키라인
    spike = 0.0
    if 3 <= i0 < n - 3:
        spike = max(0.0, min(float(p[i0 - 3]), float(p[i0 + 3]))
                    - float(min(p[i0 - 1], p[i0], p[i0 + 1])))
    # 살 단면의 굴곡 — 몰딩은 면이 여럿이라 기울기 부호가 바뀐다
    turns = 0
    if len(rail) >= 9:
        g = np.convolve(np.diff(rail), np.ones(3) / 3, 'valid')
        sg = np.sign(g)
        turns = int(np.sum(sg[1:] * sg[:-1] < 0))
    wall = float(np.median(p[:max(1, i0 - 1)])) if i0 >= 3 else float(p[0])
    return {'wall': round(wall, 1), 'rail': round(plateau, 1),
            'rail_std': round(float(np.std(rail)), 2),
            'rail_span': round(float(rail.max() - rail.min()), 1),
            'rail_turns': turns, 'rebate_drop': round(rebate, 1),
            'rebate_ratio': round(ratio, 3),
            'keyline_spike': round(spike, 1)}


def shadow_stats(L, rect):
    x0, y0, x1, y1 = rect
    w = x1 - x0 + 1
    # ⚠️ **띠를 깊게 내리지 말 것.** 접지 그림자는 조각 폭의 몇 % 안에서 회복된다(골든 실측
    #    0.8~17%). 35% 까지 훑으면 실내 장면에서 **작품 아래 협탁·콘솔이 '벽'으로 잡혀**
    #    기준 밝기가 무너진다 — t03 실측: 벽 158 인데 159px 아래부터 34 라 접지 낙차가
    #    **−104** 로 뒤집혔다(렌더는 멀쩡했다). 12% 면 회복 구간을 다 담으면서 가구를 피한다.
    #    (상위 백분위로 바꾸는 방법도 시도했으나, 벽이 아래로 어두워지는 장면에서는 그림자
    #     자체가 최댓값이 되어 낙차가 0 이 된다 — 골든 case_09 가 그 경우다.)
    d = min(max(12, int(w * .25)), L.shape[0] - y1 - 4)
    if d < 8:
        return {'contact_pct': 0.0, 'recover_pct': 0.0}
    lo, hi = x0 + int(w * .25), x0 + int(w * .75)
    strip = L[y1 + 2:y1 + 2 + d, lo:hi].mean(axis=1)
    # 물체를 만나면 거기서 띠를 끊는다 — 접지 그림자는 **단조 회복**이라 도중에 급히
    # 어두워질 수 없다. 3줄 연속 3레벨 이상 떨어지면 그건 벽이 아니라 가구 모서리다.
    sm = np.convolve(strip, np.ones(3) / 3, 'same')
    run, cut = 0, len(strip)
    for i in range(2, len(sm)):
        run = run + 1 if sm[i] < sm[i - 1] - 3.0 else 0
        if run >= 3:
            cut = i - 4
            break
    strip = strip[:max(6, cut)]
    if len(strip) < max(6, int(w * .02)):
        return {'contact_pct': 0.0, 'recover_pct': 0.0, 'contact_drop': 0.0, 'obstructed': True}
    # ⚠️ **기준(그림자 없는 벽)을 띠의 끝값으로 잡지 말 것.** 벽 자체에 세로 기울기가 있으면
    #    끝이 곧 벽 밝기가 아니다 — stone 실측: 경계 100 → 25px 에서 115 로 회복한 뒤
    #    **다시 98 로 떨어진다**(벽이 아래로 어두워진다). 끝값을 쓰면 접지 낙차가 15 → 1.2 로
    #    사라진다. '그림자가 회복해 도달한 밝기' = 띠에서 가장 밝은 값이 정의에 맞다.
    #    (가구가 있어도 가구는 어두우므로 자동으로 빠진다)
    far = float(np.convolve(strip, np.ones(5) / 5, 'same')[2:-2].max()) if len(strip) > 8 \
        else float(np.median(strip))
    if far < 1:
        return {'contact_pct': 0.0, 'recover_pct': 0.0}
    rel = (strip - far) / far * 100
    # ⚠️ 접지 그림자의 **가장 어두운 지점**을 잡을 것. 예전엔 '경계에서 폭의 1%' 라는 고정
    #    위치를 읽었는데, 조각이 커지면(945px) 그게 9px 이라 이미 절반쯤 회복된 자리다.
    #    stone 실측: 경계 100 · 9px 108 · 회복 115 → 낙차가 15 대신 7 로 측정됐다.
    #    맨 앞 1px 은 안티에일리어싱이라 건너뛴다.
    i1 = int(np.argmin(np.convolve(strip, np.ones(3) / 3, 'same')[1:max(4, int(w * .03))])) + 1
    i1 = min(i1, len(rel) - 1)
    rec = next((i for i in range(len(rel)) if rel[i] > -1.0), len(rel))
    # ⚠️ 접지 그림자는 **절대 밝기 낙차**로 잴 것. 비율(%)로 재면 어두운 벽(슬레이트)에서
    #    같은 그림자가 훨씬 큰 값으로 나와, 밝은 벽끼리 비교가 안 된다(실측: 같은 -45% 가
    #    슬레이트에선 60레벨, 흰 벽돌에선 103레벨).
    return {'contact_pct': round(float(rel[i1]), 1),
            'contact_drop': round(far - float(strip[i1]), 1),
            'recover_pct': round(rec / w * 100, 1)}


def analyse(src, rect, art, rail_px):
    """rect = 조각(액자 포함) 사각형, art = 작품 사각형, rail_px = 살 두께(평균)."""
    im = src if isinstance(src, Image.Image) else Image.open(src)
    a = np.asarray(im.convert('RGB')).astype(float)
    L = lum(a)
    x0, y0, x1, y1 = rect
    w, h = x1 - x0 + 1, y1 - y0 + 1
    gap = {'left': art[0] - x0, 'top': art[1] - y0, 'right': x1 - art[2], 'bottom': y1 - art[3]}
    per = {}
    for side in SIDES:
        dim = w if side in ('left', 'right') else h
        inpx = max(12, int(gap[side]) + max(6, int(dim * .04)))
        p, i0 = _slice(L, rect, side, max(4, int(dim * .08)), inpx)
        st = _side_stats(p, i0, rail_px, gap[side])
        if st:
            per[side] = st
    if len(per) < 4:
        return None
    out = {'rect': list(rect), 'art': list(art), 'per_side': per,
           'keyline_spike': round(max(v['keyline_spike'] for v in per.values()), 1),
           'rail_std': round(float(np.mean([v['rail_std'] for v in per.values()])), 2),
           'rail_span': round(float(np.mean([v['rail_span'] for v in per.values()])), 1),
           'rail_turns': round(float(np.mean([v['rail_turns'] for v in per.values()])), 1),
           'rebate_drop': round(float(np.mean([v['rebate_drop'] for v in per.values()])), 1),
           'rebate_ratio': round(float(np.mean([v['rebate_ratio'] for v in per.values()])), 3),
           # 위·아래 살이 **얼마나 다른가**가 방향광의 증거다. 부호는 장면의 광원 방향에
           # 따라 뒤집히므로(레퍼런스도 +92 ~ -91) 절대값으로 본다.
           'dir_tb': round(abs(per['top']['rail'] - per['bottom']['rail']), 1),
           'dir_lr': round(abs(per['left']['rail'] - per['right']['rail']), 1),
           'piece_wh': [w, h], 'fill_w': round(w / im.width, 3)}
    out.update(shadow_stats(L, rect))
    return out
