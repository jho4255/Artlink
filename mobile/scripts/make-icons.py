#!/usr/bin/env python3
"""ArtLink 앱 아이콘·스플래시·알림 아이콘 원본을 만든다 (2026-11-09).

    python3 mobile/scripts/make-icons.py <Pretendard-Bold.otf>
    cd mobile && npx @capacitor/assets generate --android --assetPath assets   # mipmap·splash 로 굽기

로고(Navbar)와 같은 규칙: Pretendard Bold · 자간 -0.025em · 'Art' gray-900(#111827) + 'Link' 강조색(#c4302b, 규칙 47).
런처 아이콘은 48dp 안팎이라 한 줄('ArtLink')이면 글자가 너무 작다 → 두 줄로 쌓는다.
글꼴 파일은 저장소에 넣지 않는다(jsDelivr npm pretendard@1.3.9 /dist/public/static/Pretendard-Bold.otf).
알림 아이콘(상태 표시줄)은 흰색 단색 실루엣이어야 한다 — 색이 있으면 안드로이드가 회색 네모로 그린다.
"""
import os, sys
from PIL import Image, ImageChops, ImageDraw, ImageFont

INK, ACCENT, WHITE = (17, 24, 39, 255), (196, 48, 43, 255), (255, 255, 255, 255)
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
ASSETS = os.path.join(ROOT, 'assets')
RES = os.path.join(ROOT, 'android', 'app', 'src', 'main', 'res')
TRACK = -0.025  # tracking-tight
# 글자 쌍 보정(em) — 'r' 팔 끝과 't' 가로획이 로고 크기(36px)에선 붙어 보이지만 1024px 로 키우면 1.3px 틈이 흰 실선으로 보인다
PAIR = {('r', 't'): -0.008}


def offset(text, i, size):
    """i 번째 글자의 시작 위치에 더할 값 — 자간 + 앞 쌍들의 보정"""
    return TRACK * size * i + sum(PAIR.get((text[j - 1], text[j]), 0) * size for j in range(1, i + 1))


def line_width(font, text, size):
    return font.getlength(text) + offset(text, len(text) - 1, size)


def draw_line(img, font, text, x, y, size, fill):
    """자간을 주려면 글자를 한 자씩 놓아야 하는데, 그냥 겹쳐 칠하면 맞닿은 가장자리(r·t)가 반투명을 두 번 받아
    **흰 이음매**가 생긴다. 글자마다 덮임(마스크)을 더해(255 에서 자름) 한 줄을 한 번에 칠한다."""
    mask = Image.new('L', img.size, 0)
    for i, ch in enumerate(text):
        g = Image.new('L', img.size, 0)
        ImageDraw.Draw(g).text((x + font.getlength(text[:i]) + offset(text, i, size), y), ch, font=font, fill=255)
        mask = ImageChops.add(mask, g)
    img.paste(Image.new('RGBA', img.size, fill), (0, 0), mask)


def wordmark(canvas, font_path, width_frac, bg):
    """canvas×canvas 그림 가운데에 'Art'/'Link' 두 줄. width_frac = 두 줄 중 넓은 줄이 차지할 폭 비율."""
    img = Image.new('RGBA', (canvas, canvas), bg)
    probe = ImageFont.truetype(font_path, 100)
    size = int(100 * (canvas * width_frac) / max(line_width(probe, 'Art', 100), line_width(probe, 'Link', 100)))
    font = ImageFont.truetype(font_path, size)
    # 글자 실제 잉크 높이로 두 줄 블록을 세로 가운데에 — 'Art' 윗선 ~ 'Link' 아랫선
    top1 = font.getbbox('Art')[1]
    gap = int(size * 0.92)  # 줄 간격(윗줄 기준선 → 아랫줄 기준선), 로고처럼 촘촘하게
    bottom2 = gap + font.getbbox('Link')[3]
    block_h = bottom2 - top1
    y0 = (canvas - block_h) / 2 - top1
    for text, dy, fill in (('Art', 0, INK), ('Link', gap, ACCENT)):
        w = line_width(font, text, size)
        draw_line(img, font, text, (canvas - w) / 2, y0 + dy, size, fill)
    return img


def stat_icon(px, font_path):
    """상태 표시줄 알림 아이콘 — 흰 'A' 한 글자(24dp 안 20dp 정도)."""
    img = Image.new('RGBA', (px, px), (0, 0, 0, 0))
    font = ImageFont.truetype(font_path, int(px * 1.05))
    l, t, r, b = font.getbbox('A')
    scale = (px * 0.84) / max(r - l, b - t)
    font = ImageFont.truetype(font_path, int(px * 1.05 * scale))
    l, t, r, b = font.getbbox('A')
    ImageDraw.Draw(img).text(((px - (r - l)) / 2 - l, (px - (b - t)) / 2 - t), 'A', font=font, fill=WHITE)
    return img


def main(font_path):
    os.makedirs(ASSETS, exist_ok=True)
    wordmark(1024, font_path, 0.56, WHITE).save(os.path.join(ASSETS, 'icon-only.png'))
    # 적응형 아이콘 전경 — @capacitor/assets 가 mipmap-anydpi-v26/ic_launcher.xml 에서 전경을 16.7% 안쪽으로 넣는다
    # (108dp 중 보이는 72dp 에 이 그림 전체가 대응). 그래서 레거시 아이콘과 같은 비율(0.56)이면 같은 크기로 보인다.
    # 안전 영역(가운데 66dp 원 = 이 그림의 91.7% 원) 안에 두 줄 블록이 들어간다(대각선 약 75%).
    wordmark(1024, font_path, 0.56, (0, 0, 0, 0)).save(os.path.join(ASSETS, 'icon-foreground.png'))
    Image.new('RGBA', (1024, 1024), WHITE).save(os.path.join(ASSETS, 'icon-background.png'))
    splash = wordmark(2732, font_path, 0.18, WHITE)
    splash.save(os.path.join(ASSETS, 'splash.png'))
    splash.save(os.path.join(ASSETS, 'splash-dark.png'))  # 앱은 밝은 테마로 고정한다(styles.xml)
    for dpi, px in (('mdpi', 24), ('hdpi', 36), ('xhdpi', 48), ('xxhdpi', 72), ('xxxhdpi', 96)):
        out = os.path.join(RES, f'drawable-{dpi}')
        os.makedirs(out, exist_ok=True)
        stat_icon(px, font_path).save(os.path.join(out, 'ic_stat_artlink.png'))
    print('ok:', sorted(os.listdir(ASSETS)))


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
