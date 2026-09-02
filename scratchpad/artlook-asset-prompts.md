# ArtLook 자산 생성 프롬프트 (GPT Image)

2026-09-02. **지금 있는 자산을 실측해서** 빈자리를 고른 것이다 — 목록을 늘리려고 만든 게 아니다.
측정 명령은 각 절 끝에 있다. 받은 뒤 할 일은 §5.

---

## 0. 지금 있는 것 (실측)

### 액자 8종 — 살 두께가 두 무리뿐이다

| 키 | 살 % | 재질 |
|---|---|---|
| black · gold · oak · walnut · white | **9.0 ~ 9.8** | 검정·금·오크·월넛·흰색 |
| oak-thin · silver-thin · walnut-thin | **4.9 ~ 5.5** | 오크·실버·월넛 |

비어 있는 자리: **넓은 살(13~16%)이 하나도 없다** · 실버가 얇은 것만 있다 ·
**밝은 나무(메이플/애시)가 없다**(오크는 주황 계열) · 아이보리(크림 도장)가 없다 · 얇은 검정이 없다.

### 벽(평면 매크로) 8종 — 전부 밝고 전부 중성색

| 파일 | 밝기 | 색 | 결 |
|---|---|---|---|
| wall05 화이트브릭 | 231 | 231,231,231 | 4.4 |
| wall01 | 203 | 204,203,196 | 18.1 |
| wall04 | 199 | 204,199,189 | 21.1 |
| wall06 | 184 | 190,183,173 | 37.9 |
| wall07~09 | 173~174 | 따뜻한 베이지 | 33.0~38.7 |
| wall03 | 157 | 163,156,144 | 42.7 |

**가장 어두운 것이 157이다.** 짙은 벽(차콜·올리브·네이비)이 0종, 차가운 색이 0종,
색이 있는 벽(테라코타·세이지)이 0종. 결은 18~43으로 오히려 **너무 시끄러워**
`wallCalm` 이 매번 뭉개고 있다(규칙 41).

### 공간(실내) 10종

밝기 115~231로 폭은 있으나 —

- **`foreground` 레이어를 쓰는 장면이 0개다.** 경쟁사(FrameIt)의 간판 기능이고
  엔진은 이미 지원하는데(`scenes.json` `_readme`) 자산이 없어서 한 번도 안 켜졌다.
- `occlusion`·`reflection` 도 0개.
- 결 0.19~3.21 — 대부분 정보가 없는 면이다.
- 광원 근거가 뚜렷한 건 리넨 리빙·클레이 살롱 둘뿐(규칙 44g: 15개 중 6개는 근거 없음).
- 새로 넣은 셋(wall18~20)은 원본이 382px 라 3배 확대한 것이다 — **화질 부채**.

```bash
# 위 표를 다시 뽑기
python3 - <<'PY'
import json,numpy as np
from PIL import Image, ImageFilter
from pathlib import Path
sc={s['src'].split('/')[-1]:s for s in json.load(open('frontend/public/artlook/scenes/scenes.json'))['scenes']}
for p in sorted(Path('frontend/public/artlook/walls').glob('*.jpg')):
    im=Image.open(p).convert('RGB'); w,h=im.size; s=sc.get(p.name)
    if s and s.get('region'):
        r=s['region']; im=im.crop((int(r[0][0]*w),int(r[0][1]*h),int(r[2][0]*w),int(r[2][1]*h)))
    g=im.convert('L').resize((1200,1200)); a=np.asarray(g).astype(float)
    hi=a-np.asarray(g.filter(ImageFilter.GaussianBlur(3))).astype(float)
    rgb=np.asarray(im.resize((80,80))).astype(float).reshape(-1,3).mean(0)
    print(f"{p.name:30s}{w}x{h:6d} 결{hi.std():6.2f} 밝기{a.mean():5.0f}  {rgb[0]:.0f},{rgb[1]:.0f},{rgb[2]:.0f}")
PY
```

---

## 1. 공통 하드 제약 — 어기면 조용히 깨진다

### 해상도 (셋 다 해당)

`SCENE_HEADROOM=1.6`, `SCENE_MIN_LONG=1080` 이라 **출력 긴 변 = max(1080, 원본/1.6)** 이고,
자동 프레이밍의 확대 여유(`maxSrcScale` 1.15배)가 거기서 나온다.
원본이 1024면 출력이 1080 → 원본보다 크게 뽑는 셈이라 **여유가 0이고 액자가 작게 걸린다**(규칙 41의 실패 그대로).

> **원본 긴 변 ≥ 1730px 이 필요하다. 2600px 이면 넉넉하다.**
> GPT Image 는 최대 1536 이므로 **1536 으로 뽑고 ×2 업스케일**해서 넣는다.
> 평면 매크로 벽은 확대해도 잃는 게 거의 없다(wall18 선례). 실내 사진은 ×2 까지만.

### 액자 — 추출기(`frontend/scripts/extract-photo-frames.py`)가 요구하는 것

가운데 행·열 한 줄만 훑어서 바깥 사각형과 개구부를 찾는다. 그래서:

| 요구 | 이유 |
|---|---|
| 배경 **순백(모든 채널 251 이상)**, 액자 밖 그림자·그라디언트·반사 **전무** | `p.min()<=250` 을 배경 끝으로 본다. 그림자가 있으면 그걸 액자로 잡는다 |
| 개구부는 **완전히 균일한 단색**(중앙 픽셀 기준 ±18 이내) | 안쪽 그림자·그라디언트·유리 반사가 있으면 개구부를 **작게** 잡는다 |
| 개구부 색과 액자 색이 **18 이상** 차이 | 실버 액자에 밝은 회색 개구부를 넣으면 경계를 못 찾는다 |
| 완전 정면(원근 0), 네 변이 화면과 평행, 개구부가 정중앙 | 어긋나면 살 폭이 짝짝이가 된다(오크 원본이 26.7% 차이였다) |
| **PNG** 로 저장 | 지금 있는 얇은 3종은 JPG 라 가장자리에 압축 잡티가 있다 |

⚠️ **실측으로 확인된 함정** — 좋은 5종은 `배경 253~254 / 개구부 194~204`,
문제였던 얇은 3종은 `배경 248 / 개구부 249`(**개구부가 배경보다 밝다**). 순서를 뒤집지 말 것.

### 9-slice 제약

네 모서리는 원본 비율로 두고 **네 변만 늘린다.** 따라서 살을 따라
**반복 무늬·구슬 장식·코너 조각이 있으면 안 된다.** 살 프로파일은 길이 방향으로 균일해야 한다.

---

## 2. 액자 6종 — 프롬프트

**공통 머리말** (아래 6개 각각의 앞에 그대로 붙인다):

```
Studio product photograph of an EMPTY picture frame, shot perfectly straight-on:
the camera axis is exactly perpendicular to the frame, zero perspective, no tilt,
all four sides exactly parallel to the image edges. Square frame, perfectly centered,
filling about 92% of a square 1536x1536 canvas.

BACKGROUND: pure flat white (255,255,255). Absolutely NO drop shadow, NO contact
shadow, NO gradient, NO vignette, NO reflection, NO surface under the frame.

INSIDE THE OPENING: a completely flat, perfectly uniform neutral grey card
(RGB 128,128,128). NO inner shadow, NO gradient, NO glass, NO reflection,
NO texture, NO artwork, NO mat board. Absolutely even from edge to edge.

The four rails must be exactly equal in width. The rail profile must be uniform
along its entire length — no repeating carved ornament, no beads, no corner
decoration. Even soft studio lighting, sharp focus edge to edge, high detail in
the surface material. Photorealistic, not a 3D render, not an illustration.
No text, no watermark, no props.
```

| # | 파일명 | 이어 붙일 문장 |
|---|---|---|
| 1 | `frame-white-wide.png` | `The frame is a WIDE gallery moulding in matte chalk white paint, rail width about 15% of the frame's outer width. Flat broad face with a shallow step down into the rabbet. Slight visible brush texture in the paint, warm-neutral white (about RGB 238), never pure white.` |
| 2 | `frame-black-wide.png` | `The frame is a WIDE box moulding in deep matte black painted wood, rail width about 14% of the frame's outer width. Flat broad face, crisp square edges, fine wood grain barely visible through the matte paint.` |
| 3 | `frame-silver.png` | `The frame is a brushed aluminium moulding with a fine horizontal brush grain, cool neutral silver, rail width about 9.5% of the frame's outer width. Slightly rounded outer edge catching a soft highlight.` **개구부는 예외로** `charcoal grey (RGB 60,60,60)` **로 바꿀 것** (은색과 회색이 붙으면 경계 검출이 실패한다) |
| 4 | `frame-ivory.png` | `The frame is a classic ivory / cream painted wood moulding with a soft satin finish, rail width about 9% of the frame's outer width. Gently rounded outer profile, subtle warm off-white (about RGB 232,226,214).` |
| 5 | `frame-maple.png` | `The frame is a pale blond maple / ash hardwood moulding, natural unstained, very light warm cream-blond colour with fine straight grain, rail width about 9% of the frame's outer width. Flat face, clear satin lacquer.` |
| 6 | `frame-black-thin.png` | `The frame is a THIN minimal moulding in deep matte black, rail width only about 5% of the frame's outer width. Simple flat square profile.` |

> ⚠️ `frame-maple.png` 는 추출기 `KEYS` 에 `maple` 이 없어 `frame5` 같은 이름이 된다.
> `frontend/scripts/extract-photo-frames.py` 의 `KEYS` 에 `'maple'` 한 단어를 추가할 것.
> `ivory` 는 이미 있다. `wide` 는 `QUALS` 에 이미 있다.

---

## 3. 벽(평면 매크로) 6종 — 프롬프트

**공통 머리말**:

```
Seamless macro photograph of a flat interior wall surface, shot perfectly
straight-on, completely filling a square 1536x1536 frame.

ONLY the wall surface. No objects, no furniture, no artwork, no picture frames,
no mirrors, no power outlets, no switches, no skirting board, no cornice,
no room corner, no ceiling, no floor, no plant, no shadow of anything.

LIGHTING: broad soft directional light from the upper left, producing a very
gentle luminance falloff toward the lower right — the light side about 12%
brighter than the dark side. No hard shadow, no hotspot, no visible lamp,
no vignette, no lens flare.

The surface texture must be fine and even — clearly visible at 100% zoom but
never coarse or high-contrast; no dramatic cracks, no large stains, no strong
mottling. Realistic photography, natural colour, not CGI, not an illustration.
No text, no watermark.
```

| # | 파일명 | 이어 붙일 문장 | 목표 밝기 |
|---|---|---|---|
| 1 | `wall21-charcoal.jpg` | `The wall is a deep charcoal grey micro-cement / polished plaster finish, cool dark neutral, with a very fine sandy micro-texture and soft tonal variation.` | ~62 |
| 2 | `wall22-olive.jpg` | `The wall is a deep muted olive-green limewash, chalky matte, with soft cloudy brush variation typical of limewash.` | ~78 |
| 3 | `wall23-walnut-panel.jpg` | `The wall is dark walnut wood panelling made of narrow vertical slats about 6 cm wide with fine shadow gaps between them, rich brown, satin finish, straight grain running vertically.` | ~72 |
| 4 | `wall24-terracotta.jpg` | `The wall is a warm terracotta / clay-pink limewash, chalky matte, soft cloudy tonal variation, earthy and desaturated (not orange, not pink candy).` | ~135 |
| 5 | `wall25-blue-grey.jpg` | `The wall is a cool dusty blue-grey limewash, chalky matte, soft cloudy variation, muted and slightly desaturated.` | ~152 |
| 6 | `wall26-white-plaster.jpg` | `The wall is a smooth warm off-white venetian plaster, almost flat with only a whisper of trowel texture and a soft light gradient across it.` | ~218 |

**왜 이 여섯인가** — 지금 8종이 밝기 157~231 · 전부 중성 따뜻한 색이다.
1·2·3이 **짙은 벽 구간을 처음 연다**(밝은 작품이 살아난다), 4·5가 **색이 있는 벽**,
5가 **처음 나오는 차가운 벽**, 6이 결 4~10짜리 **깨끗한 흰 벽**(지금 흰 벽은 벽돌 하나뿐).

받은 뒤 결을 재서 8~16 밖이면 `wallCalm` 을 **계산하지 말고 되먹임으로 맞춘다**
(`scratchpad/vt/calmtune.py`, 규칙 42).

---

## 4. 공간(실내) 5종 — 프롬프트

**공통 머리말**:

```
Interior photograph of a real room, shot straight-on with the camera axis
perpendicular to the main wall — no converging vertical lines, no wide-angle
distortion, eye-level camera height (about 150 cm).

THE MAIN WALL IS COMPLETELY EMPTY: absolutely no pictures, no picture frames,
no posters, no mirrors, no TV, no shelves, no wall lamps, no clock, no wall
decoration of any kind. There must be one clean, unobstructed, empty wall area
occupying at least 55% of the image width and 50% of the image height, centred
slightly above the middle of the frame.

Furniture and objects only in the lower third and along the left and right edges,
never crossing the empty wall area.

LIGHTING: soft daylight entering from the left, producing a clearly visible
gradient across the empty wall — the left side noticeably brighter than the
right. No hard shadow patterns on the empty wall, no visible light fixture
in front of the wall.

Realistic interior photography, natural colours, calm and uncluttered.
No people, no text, no watermark. 1536 px wide.
```

| # | 파일명 | 이어 붙일 문장 |
|---|---|---|
| 1 | `wall27-charcoal-gallery.jpg` | `A small contemporary gallery room with deep charcoal-grey painted walls, a pale oak floor, and a low light-grey upholstered bench along the bottom edge of the frame.` |
| 2 | `wall28-tall-window-room.jpg` | `A minimal living room with a tall empty warm-white plaster wall, a low walnut sideboard along the bottom edge, and a large window just out of frame on the left casting a soft bright gradient across the wall.` |
| 3 | `wall29-cafe.jpg` | `A quiet café interior with a warm beige plaster wall, a wooden counter and two bentwood chairs along the bottom edge of the frame, morning light from the left.` |
| 4 | `wall30-stair-landing.jpg` | `A staircase landing with a smooth off-white wall, a dark metal handrail entering from the lower right corner, and daylight from a window on the left.` |
| 5 | `wall31-study.jpg` | `A warm study with a muted clay-coloured wall, a walnut desk and a wooden chair along the bottom edge of the frame, a soft table lamp glow from the lower left.` |

**왜** — 지금 10종에 짙은 벽 방이 없고(1), 세로 작품을 걸 만한 높은 벽이 없고(2),
카페·계단·서재 같은 **작가가 실제로 거는 자리**가 없다(3·4·5). 다섯 다 왼쪽 광원을
명시해 규칙 39·44g 의 '광원 근거 없음' 을 피한다.

---

## 5. 전경(foreground) 컷아웃 3종 — 지금 0개다

엔진은 이미 지원한다(워프·오버레이 **다음**에 그린다 — 규칙 36). 자산만 없다.
화분·의자가 작품 앞을 지나가면 깊이감이 즉시 생긴다.

```
A single <OBJECT>, isolated on a fully transparent background (PNG with alpha).
Photographed at eye level with a normal lens, lit softly from the left with the
same soft daylight quality as an indoor room. Slightly out of focus / shallow
depth of field, as if it is close to the camera and in front of the subject.
The object is cropped by the frame edge as described. No ground, no shadow on
the ground, no background elements, no text, no watermark.
```

| # | 파일명 | `<OBJECT>` |
|---|---|---|
| 1 | `fg-plant-left.png` | `large potted olive tree, only its upper-left branches and leaves, entering from the LEFT edge and reaching about one third across the frame` |
| 2 | `fg-chair-right.png` | `rattan lounge chair seen from behind, only its backrest and one armrest, entering from the LOWER RIGHT corner and occupying the bottom right quarter of the frame` |
| 3 | `fg-lamp-left.png` | `slim black arc floor lamp, only its curved arm and shade, entering from the UPPER LEFT corner` |

⚠️ 전경은 **그 장면과 같은 광원·같은 카메라 높이**여야 한다. 장면을 고른 뒤 그에 맞춰 뽑을 것.
엉뚱한 방향에서 빛을 받은 화분을 얹으면 그게 곧 합성 티다.

---

## 6. 받은 뒤 할 일

### 액자

```bash
# 1) 원본을 gptsamplecase/ 에 PNG 로 넣는다
# 2) ⚠️ 먼저 확인 — 지금 gptsamplecase/ 에 frame-walnut.png 이 없다.
#    그대로 추출기를 돌리면 frames.json 에서 walnut 이 조용히 사라진다(규칙 44j).
ls gptsamplecase/
python3 frontend/scripts/extract-photo-frames.py
git checkout frontend/public/artlook/frames/photo/     # 기존 것 되돌리고
#    → 새 키만 frames.json 에 병합 + 새 PNG 만 복사
python3 frontend/scripts/symmetrize-photo-frames.py     # 개구부 대칭 맞추기(멱등)
```

그 다음 `frontend/public/artlook/index.html` 에서:
- `FRAMES` 에 `{name:'…', kind:'photo', photo:'<키>', rail:0.0X}` 추가
- `FRAME_GRADE` 에 **실측한** `[채도, 밝기]` 추가 — 손으로 적지 말 것(규칙 41).
  살의 채도 폭을 재서 FrameIt 기준(24~36)에 맞춘다.
- `frontend/src/__tests__/artlookScene.test.ts` 가 먼저 깨질 것이다. 그게 정상이다.

### 벽 / 공간

```bash
# 업스케일 (평면 벽은 ×2, 실내는 ×2 까지만)
python3 -c "
from PIL import Image; im=Image.open('IN.png').convert('RGB')
im.resize((im.width*2, im.height*2), Image.LANCZOS).save('frontend/public/artlook/walls/wallNN-xxx.jpg', quality=92)"
```

`scenes/scenes.json` 에 항목 추가 —
- `group`: `'wall'`(평면 매크로) / `'space'`(실내). **탭이 이걸로 갈린다**(파일명 정규식 아님)
- `maxLong`: 실내면 **0.49**, 평면 벽이면 생략(0.70)
- `lightDir`: **손으로 적지 말고 잰다** (`scratchpad/vt/lightdir.py`).
  ⚠️ 반드시 `region` 안에서 잴 것 — 리넨 리빙은 전체로 재면 부호가 뒤집혔다.
  ⚠️ 가로 성분만 믿고 **세로는 항상 위**로 둔다(바닥 반사를 광원으로 읽으면 그림자가 위로 진다).
- `regionCm`: 그 벽 영역의 실제 크기. 실치수 배치의 근거라 대충 적으면 안 된다
- `wallCalm`: `scratchpad/vt/calmtune.py` 로 **렌더를 보고** 맞춘다(원본 결만 보면 빗나간다)

### 마지막

```bash
cd frontend && npm test                      # artlookScene.test.ts
cd scratchpad/vt && node render.mjs && python3 run.py && python3 syncheck.py \
  && python3 artpreserve.py && python3 nomat.py
```

새 자산이 늘면 `scratchpad/vt/matrix.mjs` 의 케이스에도 한둘 넣어 회귀에 태울 것.
