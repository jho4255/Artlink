"""tone.js 가 쓰는 테스트 배너 만들기 — scratchpad/hero/img/ (커밋하지 않는다, .gitignore)

    python3 scratchpad/hero/make-tone-images.py

실서버 이벤트 배너(2026-10, 밝은 종이색 3:1)와 그 t240 썸네일은 공개 주소에서 받는다. 나머지는 단색·그라데이션으로 그린다.
파일 이름 앞 숫자는 업로드 시각 형식 — 화면의 thumbUrl() 이 2026-08-11 이후 파일에만 t240 을 찾는다(old-light.jpg 는 원본만).
"""
import os, random, urllib.request
from PIL import Image, ImageDraw

HERE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'img')
os.makedirs(os.path.join(HERE, 't240'), exist_ok=True)
os.chdir(HERE)
random.seed(1)


def save(name, im):
    im.save(name, quality=90)
    t = im.copy(); t.thumbnail((240, 240)); t.save('t240/' + name, quality=85)


REAL = 'https://img.artlink.cc/artlink/1789702744423-69830538.jpg'
urllib.request.urlretrieve(REAL, '1789702744423-real.jpg')
urllib.request.urlretrieve(REAL.replace('/artlink/', '/artlink/t240/'), 't240/1789702744423-real.jpg')

W, H = 2000, 667
im = Image.new('RGB', (W, H), (22, 28, 52)); d = ImageDraw.Draw(im)          # 어두운 배너
d.rectangle([120, 180, 900, 260], fill=(230, 230, 235)); d.rectangle([120, 300, 700, 340], fill=(180, 180, 190))
save('1789702744424-dark.jpg', im)
im = Image.new('RGB', (W, H), (238, 234, 226)); d = ImageDraw.Draw(im)       # 밝은 배너 + 오른쪽 위만 어두움
d.rectangle([int(W * 0.72), 0, W, int(H * 0.32)], fill=(30, 30, 34))
save('1789702744425-darkcorner.jpg', im)
im = Image.new('RGB', (W, H), (40, 36, 30)); d = ImageDraw.Draw(im)          # 어두운 배너 + 오른쪽 위만 밝음
d.rectangle([int(W * 0.72), 0, W, int(H * 0.32)], fill=(244, 240, 232))
save('1789702744426-lightcorner.jpg', im)
W2, H2 = 1920, 1080                                                          # 16:9 하늘(위 밝음 → 아래 어두움)
im = Image.new('RGB', (W2, H2)); px = im.load()
for y in range(H2):
    t = y / H2; base = (int(200 - 150 * t), int(215 - 160 * t), int(235 - 170 * t))
    for x in range(W2):
        n = random.randint(-6, 6); px[x, y] = tuple(max(0, c + n) for c in base)
save('1789702744427-sky.jpg', im)
im = Image.new('RGB', (1080, 1350), (30, 40, 35)); d = ImageDraw.Draw(im)    # 세로형 모바일 4:5
d.rectangle([80, 900, 1000, 1100], fill=(220, 220, 210))
save('1789702744428-mobile.jpg', im)
Image.new('RGB', (W, H), (245, 245, 240)).save('old-light.jpg', quality=90)  # 썸네일 없는 옛 업로드
print('ok', sorted(os.listdir('.')))
