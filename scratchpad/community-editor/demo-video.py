# 커뮤니티 데모 글의 동영상 — 렌더해 둔 전시 공간 사진(media/show-salon.jpg)을 천천히 당겨 보는 7초짜리 영상(WebM VP8).
#   python3 scratchpad/community-editor/demo-video.py   (demo-media.mjs 를 먼저 돌려 media/ 가 있어야 한다)
# 인코더는 Playwright 가 함께 받는 ffmpeg(VP8·webm 만 든 작은 판)를 쓴다 — 이 PC 에 ffmpeg 가 따로 없다.
# ⚠️ 실제 가입자 자료는 쓰지 않는다(데모 그림을 우리 ArtLook 엔진으로 건 렌더뿐).
import glob, io, os, subprocess, sys
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'media', 'show-salon.jpg')
OUT = os.path.join(HERE, 'media', 'show-salon-walk.webm')
FF = sorted(glob.glob(os.path.expanduser('~/.cache/ms-playwright/ffmpeg-*/ffmpeg-linux')))
if not FF:
    sys.exit('Playwright ffmpeg 가 없습니다 — e2e 폴더에서 npx playwright install ffmpeg')
W, H, FPS, SECONDS = 960, 540, 24, 7   # 원본이 1080px 라 더 크게 뽑으면 늘어날 뿐이다

src = Image.open(SRC).convert('RGB')
sw, sh = src.size
# 화면 비율(16:9)로 자른 가장 큰 상자에서 시작해 1.4배 당긴다. 끝 상자의 가운데는 그림 쪽(조금 위)
base_w = min(sw, sh * W / H)
base_h = base_w * H / W
start = (sw / 2, sh / 2)
end = (sw * 0.5, sh * 0.44)
ease = lambda t: t * t * (3 - 2 * t)
proc = subprocess.Popen([FF[-1], '-y', '-loglevel', 'error', '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', str(FPS), '-i', 'pipe:0',
                         '-c:v', 'vp8', '-b:v', '2200k', '-auto-alt-ref', '0', OUT], stdin=subprocess.PIPE)
n = FPS * SECONDS
for i in range(n):
    t = ease(i / (n - 1))
    z = 1 + 0.4 * t
    cw, ch = base_w / z, base_h / z
    cx = start[0] + (end[0] - start[0]) * t
    cy = start[1] + (end[1] - start[1]) * t
    box = (max(0, cx - cw / 2), max(0, cy - ch / 2))
    box = (min(box[0], sw - cw), min(box[1], sh - ch))
    frame = src.resize((W, H), Image.LANCZOS, box=(box[0], box[1], box[0] + cw, box[1] + ch))
    buf = io.BytesIO()
    frame.save(buf, 'JPEG', quality=92)
    proc.stdin.write(buf.getvalue())
proc.stdin.close()
if proc.wait() != 0:
    sys.exit('인코딩 실패')
print(OUT, round(os.path.getsize(OUT) / 1024), 'KB')
