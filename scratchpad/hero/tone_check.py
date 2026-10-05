"""히어로 배너 글자 색 판정 — tone.js 가 남긴 out/<TAG>/rows.json + 배경 스크린샷으로 명암비를 다시 잰다.

화면이 고른 글자 색이 '그 자리의 실제 배경'(글자를 숨기고 찍은 픽셀)에 대해
  · 평균 명암비(배경 평균 대비)
  · 가장 불리한 10% 명암비(흰 글자는 밝은 10%, 검은 글자는 어두운 10% 대비)
를 내고, 반대 색을 골랐을 때보다 나쁜지(= 잘못 고름) 본다.

    python3 scratchpad/hero/tone_check.py [TAG]     # 기본 TAG=tone
"""
import json, re, sys, os
import numpy as np
from PIL import Image

TAG = sys.argv[1] if len(sys.argv) > 1 else 'tone'
OUT = os.path.join(os.path.dirname(__file__), 'out', TAG)
rows = json.load(open(os.path.join(OUT, 'rows.json')))


def lin(c):
    c = c / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def lum(rgb):
    rgb = np.asarray(rgb, dtype=float)
    return 0.2126 * lin(rgb[..., 0]) + 0.7152 * lin(rgb[..., 1]) + 0.0722 * lin(rgb[..., 2])


def cr(a, b):
    return (max(a, b) + 0.05) / (min(a, b) + 0.05)


def parse(color):
    m = re.match(r'rgba?\(([^)]+)\)', color or '')
    if not m:
        return None
    parts = [float(x) for x in m.group(1).replace('/', ',').split(',') if x.strip()]
    return parts[:3], (parts[3] if len(parts) > 3 else 1.0)


bad = 0
cur = None
for r in rows:
    head = f"{r['eng']:8} {r['screen']:15} {r['sc'][:26]:26} #{r['slide']}"
    bg = Image.open(os.path.join(OUT, r['shot'] + '-bg.png')).convert('RGB')
    a = np.asarray(bg)
    dpr = r['dpr']
    ir = r['imgRect']
    for e in r['pick']:
        x0, y0 = int(e['x'] * dpr), int(e['y'] * dpr)
        x1, y1 = int((e['x'] + e['w']) * dpr), int((e['y'] + e['h']) * dpr)
        crop = a[max(0, y0):y1, max(0, x0):x1]
        if crop.size == 0:
            continue
        L = lum(crop.reshape(-1, 3))
        p10, p90, mean = float(np.percentile(L, 10)), float(np.percentile(L, 90)), float(L.mean())
        pc = parse(e['color'])
        if not pc:
            continue
        rgb, alpha = pc
        # 반투명 글자(흰색 80% 등)는 배경 평균 위에 섞어서 본다
        bg_mean = crop.reshape(-1, 3).mean(0)
        eff = np.array(rgb) * alpha + bg_mean * (1 - alpha)
        lt = float(lum(eff))
        white_text = float(lum(np.array(rgb))) > 0.5   # 색 자체로 가른다 — 옅은 흰색(40%)도 흰 글자다
        worst = cr(lt, p90) if white_text else cr(lt, p10)
        other_worst = cr(0.0, p10) if white_text else cr(1.0, p90)
        inside = (e['x'] >= ir['x'] - 1 and e['y'] >= ir['y'] - 1 and e['x'] + e['w'] <= ir['x'] + ir['w'] + 1 and e['y'] + e['h'] <= ir['y'] + ir['h'] + 1)
        wrong = other_worst > worst * 1.15 and other_worst >= 3.0
        # 관리자가 색을 고정한 구성(F)은 '고른 대로 나왔는가'만 본다 — 사진 위 요소는 흰 글자여야 한다
        forced = r['sc'].startswith('F') and not e['name'].startswith('cap')
        if forced:
            wrong = not white_text
        flag = ('✗' if wrong else '·') if forced else ('✗' if wrong else '✓')
        if wrong:
            bad += 1
        if head != cur:
            print(head, f"사진 {ir['w']:.0f}x{ir['h']:.0f}@({ir['x']:.0f},{ir['y']:.0f})")
            cur = head
        where = '사진 안' if inside else ('사진 밖' if not e['name'].startswith('cap') else '아래 줄')
        print(f"   {flag} {e['name']:10} {'흰' if white_text else '검정'} 글자 · 평균 {cr(lt, mean):5.1f}:1 · 불리한10% {worst:5.1f}:1 (반대색 {other_worst:5.1f}:1) · {where}"
              + (f" · 위치 ({e['x']:.0f},{e['y']:.0f})" if e['name'] == 'button' else ''))

print(f"\n잘못 고른 요소 {bad}개")
sys.exit(1 if bad else 0)
