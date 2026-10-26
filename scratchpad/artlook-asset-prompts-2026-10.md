# ArtLook 자산 생성 프롬프트 — 2차 (2026-10-26)

박스 사진 5종(2026-10-26 적용)과 같은 방식. 9월 문서(`artlook-asset-prompts.md`)의 액자 5종은 여기 3번으로 옮겨 머리말을 박스 때 잘 된 형식으로 맞췄다.
받은 사진은 아래 파일 이름 그대로 한 폴더(예: `~/frames`)에 — 추출기 이름 규칙(`champagne`·`maple`·`floater` 한정어)은 받은 뒤 맞춘다.

## 액자 공통 머리말 (1·2·3 모두, `[FRAME]` 자리에 아래 문단을 넣는다)

```
Studio product photograph of an EMPTY square picture frame, photographed perfectly straight-on from the exact center. The frame is centered and fills about 80% of a square image; all four outer edges are exactly parallel to the image edges, and all four rails are exactly equal in width.

[FRAME]

Pure white seamless background (#ffffff). No drop shadow, no contact shadow, no floor, no gradient, no vignette, no props, no text, no watermark.

Soft, even, diffuse frontal studio lighting. Photorealistic, sharp focus edge to edge, true-to-life material texture. Not a 3D render, not an illustration.
```

## 1. 플로터 5종

```
A canvas floater frame (float frame) with an L-shaped profile in [MATERIAL]: a narrow flat front lip about 2.5% of the frame's outer width, and behind it a deep inner side wall of the same material, visible in gentle symmetric perspective on all four sides (each about 2.5% of the outer width), meeting at clean 45-degree mitered corners.

Inside the frame sits a flat, uniform, matte light-gray panel (#c8c8c8) standing in for a canvas. It floats with an even, narrow dark gap (about 1.5% of the outer width) all around between its edges and the frame's inner wall — the deep shadowed channel of the floater frame. The gray panel itself is perfectly flat and even from edge to edge: no shadow falling onto it, no texture, no artwork, no glass, no reflection.
```

| 파일 이름 | [MATERIAL] |
|---|---|
| `frame-oak-floater.png` | natural white oak with fine straight grain, light honey-beige tone, matte oil finish |
| `frame-walnut-floater.png` | American black walnut with visible straight grain, warm dark chocolate brown, matte oil finish |
| `frame-black-floater.png` | matte black painted wood with a smooth satin finish and barely visible grain |
| `frame-white-floater.png` | matte warm-white painted wood, very subtle grain, crisp edges |
| `frame-champagne-floater.png` | brushed champagne-gold anodized aluminium — pale, soft, low-saturation warm gold with a fine linear brush grain |

## 2. 얇은 슬림 3종

```
A THIN minimal moulding in [MATERIAL] with a simple flat square profile; rail width only about 5% of the frame's outer width.

The opening is filled edge to edge with a flat, perfectly uniform, matte medium-gray card (#808080): no inner shadow, no gradient, no glass, no reflection, no texture, no artwork, no mat board.
```

| 파일 이름 | [MATERIAL] |
|---|---|
| `frame-black-thin.png` | deep matte black finish |
| `frame-white-thin.png` | matte warm-white painted wood, very subtle grain |
| `frame-champagne-thin.png` | brushed champagne-gold anodized aluminium — pale, soft, low-saturation warm gold with a fine linear brush grain |

## 3. 9월 문서의 액자 5종

```
[DESCRIPTION]

The opening is filled edge to edge with a flat, perfectly uniform, matte medium-gray card (#808080): no inner shadow, no gradient, no glass, no reflection, no texture, no artwork, no mat board. The rail profile is uniform along its whole length — no carved ornament, no beads, no corner decoration.
```

| 파일 이름 | [DESCRIPTION] |
|---|---|
| `frame-white-wide.png` | A WIDE gallery moulding in matte chalk-white paint, rail width about 15% of the frame's outer width. Flat broad face with a shallow step down into the inner edge. Slight visible brush texture, warm-neutral white, never pure white. |
| `frame-black-wide.png` | A WIDE box moulding in deep matte black painted wood, rail width about 14% of the frame's outer width. Flat broad face, crisp square edges, fine wood grain barely visible through the paint. |
| `frame-silver.png` | A brushed aluminium moulding with a fine horizontal brush grain, cool neutral silver, rail width about 9.5% of the frame's outer width, slightly rounded outer edge catching a soft highlight. ⚠️ 판 색을 `#3c3c3c`(짙은 회색)로 바꿀 것 |
| `frame-ivory.png` | A classic ivory / cream painted wood moulding with a soft satin finish, rail width about 9% of the frame's outer width, gently rounded outer profile, subtle warm off-white. |
| `frame-maple.png` | A pale blond maple hardwood moulding, natural and unstained, very light warm cream-blond colour with fine straight grain, rail width about 9% of the frame's outer width, flat face, clear satin lacquer. |

## 5. 벽 3종

```
Seamless macro photograph of a flat interior wall surface, shot perfectly straight-on, completely filling a square image.

ONLY the wall surface: no objects, no furniture, no artwork, no picture frames, no outlets or switches, no skirting board, no room corner, no ceiling, no floor, no plant.

LIGHTING: broad soft directional light from the upper left, producing a very gentle brightness falloff toward the lower right (the light side about 12% brighter). No hotspot, no visible lamp, no vignette, no lens flare.

[WALL]

Texture clearly visible at 100% zoom but never harsh or high-contrast. Realistic photography, natural colour, not CGI, not an illustration. No text, no watermark.
```

| 파일 이름 | [WALL] |
|---|---|
| `wall30-red-brick.jpg` | A classic red brick wall in running bond: weathered, warm red-brown bricks with slightly lighter, recessed mortar joints, matte, about 20 courses of brick from top to bottom of the image, gentle colour variation between bricks. No cast shadows of any object. |
| `wall31-fieldstone.jpg` | A natural stone wall of flat, irregular limestone pieces in warm gray-beige tones, tightly fitted with narrow recessed joints, about 8–10 stones across the image width, softly lit and low in contrast. No cast shadows of any object. |
| `wall32-leaf-shadow.jpg` | A smooth warm off-white plaster wall with soft, slightly blurred shadows of tree leaves from a window, falling ONLY in the upper-left corner and along the left edge (at most a quarter of the wall). The central 60% of the wall is completely free of shadows. |

## 고를 때 버릴 것

- 비스듬하거나 네 변 폭이 다름 · 정사각이 아님
- 액자 안 판에 그림·유리·반사·얼룩·그라데이션 · 액자 밖 그림자·바닥·회색 배경
- 플로터: 판 둘레의 어두운 틈 폭이 변마다 다름 · 판에 그림자가 떨어짐
- 벽: 벽 말고 다른 것이 찍힘 · 결이 거칠거나 대비가 셈 · (잎 그림자) 가운데까지 그림자가 들어옴
