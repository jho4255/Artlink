#!/usr/bin/env python3
"""ArtLook 박물관 색 벽 — 결이 살아 있는 기존 벽 사진의 결·얼룩·조명은 그대로 두고 평균색만 옮긴다 (2026-10-25, 2026-10-26 다시)

  python3 frontend/scripts/recolor-wall.py            # 세 장을 다시 만든다(같은 입력이면 같은 결과)

왜: FrameIt 벽 목록에는 미술관에서 흔한 짙은 색 벽(네이비·버건디·짙은 녹색)이 있는데 우리는 없었다.
새 사진을 생성하면 화질·조명이 기존 벽과 따로 놀 수 있어, 이미 검증된 벽 사진에서 색만 옮긴다.

⚠️⚠️ 처음(2026-10-25)엔 **화이트 플라스터**(wall26)의 상대 밝기를 짙은 색에 곱했다 — 흰 벽의 결은 밝기 대비 몇 % 라,
그 비율을 어두운 색에 곱하면 절대 대비가 거의 0 이 되어 **색칠한 판**이 됐다(고주파 결 1.2 ↔ 차콜 7.5 · 올리브 5.7 ·
테라코타 5.4, 사용자 지적 "텍스처가 없어서 별로, 차콜·올리브 참고"). 지금은 **이미 결이 짙은 벽**에서 옮긴다:
네이비 ← 차콜 미장(wall21) · 버건디 ← 테라코타 라임워시(wall24) · 포레스트 ← 올리브 라임워시(wall22).

방법(OKLab): 밝기 L 은 원본의 **편차**(L − 평균)를 목표 평균에 더하고 — 결의 세기가 원본과 같아지도록 배율 s 를 찾는다
(1200px 로 줄인 휘도의 고주파 표준편차 = 원본과 같게) — a·b 는 원본 편차(얼룩의 색 흔들림)를 목표 색에 더한다.
즉 평균색만 바뀌고 미장 자국·라임워시 얼룩·조명 낙차는 원본 그대로다.
⚠️ 광원 방향(lightDir)·영역은 **그 원본 벽의 값**을 scenes.json 에 옮겨 적는다(조명 낙차가 원본 그대로이므로).
"""
import os
import numpy as np
from PIL import Image, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
WALLS = os.path.join(HERE, '..', 'public', 'artlook', 'walls')
OUT = [  # (파일, 원본 벽, 목표 평균색)
    ('wall27-navy.jpg', 'wall21-charcoal.jpg', '#2c3a55'),
    ('wall28-burgundy.jpg', 'wall24-terracotta.jpg', '#5a2328'),
    ('wall29-forest.jpg', 'wall22-olive.jpg', '#2f4436'),
]


def srgb2lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def lin2srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


M1 = np.array([[0.4122214708, 0.5363325363, 0.0514459929],
               [0.2119034982, 0.6806995451, 0.1073969566],
               [0.0883024619, 0.2817188376, 0.6299787005]])
M2 = np.array([[0.2104542553, 0.7936177850, -0.0040720468],
               [1.9779984951, -2.4285922050, 0.4505937099],
               [0.0259040371, 0.7827717662, -0.8086757660]])


def lin2oklab(lin):
    return np.cbrt(lin @ M1.T) @ M2.T


def oklab2lin(lab):
    return (lab @ np.linalg.inv(M2).T) ** 3 @ np.linalg.inv(M1).T


def texture(rgb8):
    """결의 세기 — 1200px 로 줄인 휘도에서 6px 흐림을 뺀 고주파 표준편차(벽 진정 하니스와 같은 잣대)"""
    im = Image.fromarray(rgb8)
    im = im.resize((1200, round(1200 * im.height / im.width)), Image.LANCZOS)
    y = np.asarray(im).astype(np.float64) @ [0.2126, 0.7152, 0.0722]
    bl = np.asarray(Image.fromarray(np.clip(y, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(6))).astype(np.float64)
    return (y - bl).std()


def render(lab, mu, tgt, s, rng):
    out = np.empty_like(lab)
    out[..., 0] = tgt[0] + (lab[..., 0] - mu[0]) * s
    out[..., 1:] = tgt[1:] + (lab[..., 1:] - mu[1:])
    rgb = lin2srgb(np.clip(oklab2lin(out), 0, None)) * 255 + rng.uniform(-0.5, 0.5, out.shape)
    return np.clip(np.round(rgb), 0, 255).astype(np.uint8)


def main():
    for name, src, hexc in OUT:
        rgb = np.asarray(Image.open(os.path.join(WALLS, src)).convert('RGB'))
        lab = lin2oklab(srgb2lin(rgb.astype(np.float64) / 255))
        mu = lab.reshape(-1, 3).mean(0)
        t = np.array([int(hexc[i:i + 2], 16) for i in (1, 3, 5)]) / 255
        tgt = lin2oklab(srgb2lin(t)[None, :])[0]
        want = texture(rgb)
        lo, hi = 0.3, 3.0                                           # 결의 세기가 원본과 같아지는 밝기 배율
        for _ in range(14):
            s = (lo + hi) / 2
            got = texture(render(lab, mu, tgt, s, np.random.default_rng(20261026)))
            lo, hi = (s, hi) if got < want else (lo, s)
        out = render(lab, mu, tgt, (lo + hi) / 2, np.random.default_rng(20261026))
        Image.fromarray(out).save(os.path.join(WALLS, name), quality=92, optimize=True)
        print(f'{name} ← {src} {hexc}  배율 {(lo + hi) / 2:.2f}  결 {want:.2f} → {texture(out):.2f}  평균 {out.reshape(-1, 3).mean(0).round(1)}')


if __name__ == '__main__':
    main()
