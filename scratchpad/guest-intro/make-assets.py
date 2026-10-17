# 비회원 소개 팝업의 네 칸 그림 — compose.mjs 가 짜 맞춘 out/q-*.png 를 frontend/public/intro/ 로 줄여 넣는다.
#   python3 scratchpad/guest-intro/make-assets.py
# 600×450(4:3) — 칸 폭이 PC 약 265px · 휴대폰 약 187px 이라 2~3배 화면에서도 선명하다. 광고로 들어온 휴대폰이 받으므로 작게(webp q80).
from PIL import Image
import os
SRC = '/home/jho4255/ArtLink/scratchpad/guest-intro/out'
DST = '/home/jho4255/ArtLink/frontend/public/intro'
os.makedirs(DST, exist_ok=True)
for f in os.listdir(DST):
    os.remove(os.path.join(DST, f))
for k in ['artlook', 'portfolio', 'homepage', 'apply', 'gallery-artlook', 'gallery-ops', 'gallery-home', 'gallery-show']:
    im = Image.open(f'{SRC}/q-{k}.png').convert('RGB').resize((600, 450), Image.LANCZOS)
    im.save(f'{DST}/{k}.webp', 'WEBP', quality=82, method=6)
total = 0
for f in sorted(os.listdir(DST)):
    n = os.path.getsize(f'{DST}/{f}'); total += n
    print(f, n)
print('합', total)
