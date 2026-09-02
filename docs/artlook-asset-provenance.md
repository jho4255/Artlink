# ArtLook 자산 출처

> 원래 `frontend/public/artlook/{walls,frames/photo}/ATTRIBUTION.txt` 에 있었다.
> 거기 두면 `artlink.cc/artlook/walls/ATTRIBUTION.txt` 로 **누구나 읽힌다** — 내부 메모라
> 2026-09-02 에 서빙되지 않는 이 자리로 옮겼다. 자산을 추가하면 여기에 적을 것.

## 벽 (`frontend/public/artlook/walls/`)

```
POC 전용. 출처/라이선스 (Openverse 경유, CC 라이선스 — 상용 전 개별 확인 필요)

wall01.jpg <- cand05_living.jpg	Plage Colección My Wall	Plage Vinilos y Decoración	by	https://www.flickr.com/photos/59209848@N08/5429084250	https://live.staticflickr.com/5014/5429084250_591e0dcb6c.jpg
wall02.jpg <- cand07_minimal.jpg	Test illumination VRay	Qu1m	by	https://www.flickr.com/photos/96076734@N00/134679894	https://live.staticflickr.com/46/134679894_8775d3aa3d_b.jpg
wall03.jpg <- cand09_minimal.jpg	Plage Colección My Wall	Plage Vinilos y Decoración	by	https://www.flickr.com/photos/59209848@N08/5428483551	https://live.staticflickr.com/5216/5428483551_fb4a65603b.jpg
wall04.jpg <- cand13_bedroom.jpg	su11	Associated Fabrication	by	https://www.flickr.com/photos/31167421@N07/4503768052	https://live.staticflickr.com/4039/4503768052_571faa23b3_b.jpg
wall05.jpg <- cand14_bedroom.jpg	red-minimalist-bedroom	tec_estromberg	by	https://www.flickr.com/photos/92334668@N07/11368418554	https://live.staticflickr.com/3705/11368418554_1be2439c8f_b.jpg
wall06.jpg <- cand20_concrete.jpg	White brick wall texture (3x tiled)	qubodup	by	https://www.flickr.com/photos/21051491@N02/2951312700	https://live.staticflickr.com/3281/2951312700_f8e3cab58f_b.jpg
wall07.jpg <- cand25_plant.jpg	Peggy's Zen living room makeover, white sofa, pink tulips, bright pillows, maroon throw, natural woven drum shaped tables, jute rug, refinished floor, old brass floor lamp, Seattle, Washington, USA	Wonderlane	by	https://www.flickr.com/photos/71401718@N00/465852851	https://live.staticflickr.com/171/465852851_a341bac227_b.jpg
wall08.jpg <- cand39_apart.jpg	Living A, v0	aforero	by	https://www.flickr.com/photos/88824995@N00/2107624809	https://live.staticflickr.com/2151/2107624809_18f59fe877_b.jpg
wall09.jpg <- cand47_herring.jpg	Getty Villa - 17985 Pacific Coast Highway - Pacific Palisades	Dale Cruse - 11M SF views	by	https://commons.wikimedia.org/w/index.php?curid=189974101	https://upload.wikimedia.org/wikipedia/commons/1/10/Getty_Villa_-_17985_Pacific_Coast_Highway_-_Pacific_Palisades.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original
wall10.jpg <- cand19_concrete.jpg	Concrete Wall	splorp	by-nc-nd	https://www.flickr.com/photos/13522901@N00/6559870	https://live.staticflickr.com/3/6559870_d6d63b27e4_b.jpg

[교체 2026-06-11]
wall01.jpg <- cand51_wmin (Openverse/Flickr, 고해상도 교체)
wall03.jpg <- cand45_museum (Openverse/Flickr)
wall10.jpg <- 동일 출처 _k(2048px) 버전으로 업그레이드
wall09.jpg <- 2200px로 다운스케일

[전면 교체 2026-06-11] wall01~10 = 자체 제작(2600×2600 평면 매크로 벽).
FrameIt 의 bg_scene 이 '정면에서 크게 찍은 평면 벽'이라는 것을 **참고해서** 같은 종류로 만든 것이다.
FrameIt 은 원본 자산을 배포하지 않으므로 받아올 수 있는 것도 아니다. 저작권 제약 없음.

⚠️ 여기 원래 "oss.aiframeit.com/bg_scene/* 에서 받은 FrameIt 자산 → 상용 시 교체 필수" 라고
   적혀 있었다(2026-09-02 사용자 확인으로 정정). **그 줄은 사실이 아니었고, 자기모순이기도 했다** —
   "3000~4000px 원본 → 1800px 다운스케일" 이라고 써 놓고 실제 파일은 전부 2600×2600 이다.
   출처도 결과도 안 맞는다. 그 기록을 근거로 2026-09-02 감사가 배포를 막을 뻔했다.
   ⚠️ **자산 출처는 추측으로 적지 말 것.** 모르면 '미확인'이라고 적고 만든 사람에게 물을 것 —
   틀린 출처 기록은 없느니만 못하다(지우기도 어렵고, 멀쩡한 자산을 못 쓰게 만든다).

[추가 2026-09-01] wall11~20 = **GPT 생성**(직접 제작). 저작권 제약 없음.
  wall11~17  실내 장면 7종
  wall18     quiet-study   <- room_03_no_artwork  (382x332 원본 -> 3배 확대)
  wall19     linen-living  <- room_01             (381x332 원본 -> 3배 확대)
  wall20     clay-salon    <- room_02             (382x332 원본 -> 3배 확대)

⚠️ wall18~20 을 담아 온 파일 이름이 `frameit_test_assets*.zip` 이었다(FrameIt 과 비교하려고
   그렇게 부른 것이지 FrameIt 자산이 아니다). 2026-09-02 감사에서 이름만 보고 FrameIt
   계열로 오인한 적이 있다 — **이름이 아니라 이 기록을 볼 것.**
   위 [전면 교체 2026-06-11] 의 wall01~10 은 별개이고, 그쪽 경고는 그대로 유효하다.

[삭제 2026-09-03] wall18·19·20 (quiet-study / linen-living / clay-salon) — 사용자 요청.
   원본이 382×332 뿐이라 3배 확대해 넣은 것이라 화질 부채가 있었다. 파일까지 지웠다.

[추가 2026-09-03] wall21~26 = **GPT 생성**(직접 제작, `gptgenwall/` 원본 PNG). 저작권 제약 없음.
  wall21 charcoal       차콜 미장          wall24 terracotta      테라코타 라임워시
  wall22 olive          올리브 라임워시     wall25 blue-grey       블루 그레이 라임워시
  wall23 walnut-panel   월넛 세로 슬랫      wall26 white-plaster   웜 오프화이트 베네치안
   생성 프롬프트는 `scratchpad/artlook-asset-prompts.md` §3.
   1254×1254 원본을 **×2 LANCZOS 업스케일**해 2508×2508 로 넣었다 — 실측상 같은 표시
   크기에서 벽 결 손실이 **0.0%** 인데, 출력이 1080→1568px 로 커지고 자동 프레이밍
   확대 한도가 1.34→1.84 배가 된다(규칙 41 의 SCENE_HEADROOM 여유).
   ⚠️ 이 여섯이 **처음으로 어두운 벽(밝기 48~135)과 색 있는 벽**을 연다. 기존 8종은
      157~231 에 전부 중성색이었다.
```

## 사진 액자 (`frontend/public/artlook/frames/photo/`)

```
ArtLook 사진 액자 — 출처

전 8종 **GPT 생성**(직접 제작). 저작권 제약 없음.
원본 보관함은 레포 루트 `gptsamplecase/`(용량이 커서 커밋하지 않는다),
추출은 `frontend/scripts/extract-photo-frames.py`.

  black / gold / oak / walnut / white     1254px 원본, 살 9.0~9.8%
  oak-thin / silver-thin / walnut-thin    1024px 원본, 살 4.9~5.5%   (2026-09-01 추가)

⚠️ 얇은 3종을 담아 온 파일 이름이 `frameit_test_assets_updated.zip` 이었다
   (FrameIt 과 비교하려고 그렇게 부른 것이지 FrameIt 자산이 아니다).
   2026-09-02 감사에서 이름만 보고 오인한 적이 있다 — **이름이 아니라 이 기록을 볼 것.**
```
