# ArtLook 개선 — 진행 기록 (PLAN.md 를 따라간다)

2026-11-17 사용자: "이전 거 로컬 커밋 해두고 계획대로 구현 시작. 새로 만드는 생성형 액자는 기존 대비 퀄리티를 철저히 검증 — 퀄이 떨어지면 없는 것만 못하다."

## 커밋
- c82e55b — 규칙 80~84 작업(로컬 체크포인트, push 안 함)
- 569a113 — artlook-review 하니스 + PLAN.md

## WP0 기준선 (2026-11-17, `bash baseline.sh base` → q-base/ · logs/base-*)
- vt run.py 9/10 (t07 keyline 32.3 — 캔버스 랩 문서화된 위양성) · contact_drop 중앙 33.8 · 최대 46.2(t05)
- syncheck 8/10 (t02 · t10 합성과다 — 문서화된 기준선)
- physics 그림자 방향 10/10 (최소 0.875)
- artpreserve 10/10 · presence 2/10(문서화 — piece_pct/wall_hf 밴드)
- 프론트 ArtLook 단위 5파일 248 통과
- 화면 캡처 기준선 shots-base/ (11-17 리뷰 때 찍은 것, 고치기 전)
- 그림자(shadow.cjs): 흰 플라스터 모서리 tl -3 tr -13 bl -8 br -15 · 그늘 변(왼) -12,-6,-5,-2

## 진행
- [x] WP1 그림자 — scene.js: 모서리 그늘을 액자 안으로(cornerAOClip 기본 true) · 투영(cast) 1.5배 · **접지(contact)는 그대로**
      (접지 1.2배만 해도 vt t08 keyline 9.5→12.5 로 한계 12 초과 — 1.5배면 16.4). 비교 손잡이 `?cast=&contact=&aoclip=`(index.html SHADOW_Q).
      실측: 빛 받는 모서리 벽 −12 → −4~+4% · 그늘 쪽 변(0.3–1%) −13 → −16%(흰 플라스터·블랙) · vt 기준선과 통과 수 같음(9/10 · syncheck 8/10 · 방향 10/10 · 보존 10/10).
      시트: sheets/g1-small.png (G1 — 사용자 확인 대기, 기본은 A)
- [x] WP2 실내 해상도 — walls/wall11~17 을 2508px(Lanczos, q88 4:4:4, 226~641KB) · scenes.json srcScale:2 · index.html compose 의 longSide/keepZoom.
      구도: 조각 위치 차 ≤0.15% · 평균 픽셀 차 0.5~1.4/255(워터마크 글자 자리만 큼) · 벽 배경은 픽셀 0(그림자 손잡이를 예전으로 두고 비교).
      저장본 1:1 1568² · 9:16 1080×1920 · 16:9 1920×1080. 무늬 유출 그대로(작품 무늬 0.64→0.64 등). vt 9/10(t08 keyline 10.7→7.7).
- [x] WP3 워터마크 — 'Link' 가 명암비 <2.5 이고 (OKLab ΔE <0.15 또는 명암비 <1.2) 면 'Art' 와 같은 흑/백.
      바뀌는 곳: 테라코타·붉은 벽돌·컬렉터 홈. 베이지·트래버틴·버건디·네이비는 빨강 그대로(밝기만 보면 베이지까지 검정이 됐다 — 기각).
- [x] WP4 화면 틀 — 1024px 미만 [ArtLook] 탭은 상단바·하단 탭바 없이(Layout `useArtLookBare` · siteMode `isArtLookEditor`) · ArtLook 머리 [닫기 ×]·[저장]
      (`artlook:goto {to:'close'}` → 앱 안에서 왔으면 뒤로, 아니면 /mypage) · 저장 단추 묶음은 하나(좁은 편집 화면이면 저장 창 #saveBox 안으로) ·
      확대 단추: 손가락 = 조절한 뒤에만 [처음 자리로], 마우스 = 여백 56px 이상이면 그림 바깥 · [ArtStory에 올리기] 처음부터 보임(storyBusy).
      실측(screens2.cjs): 아이폰 13 미리보기 390 · SE 294 · iPad 750 · PC 1024 291(바깥 틀 그대로) · 1280/1440 은 예전과 같은 크기.
- [x] WP5 액자 모양 × 재질 — FRAME_SHAPES 7 모양(몰딩·넓은 몰딩·슬림·플로터·박스·원형·액자 없음) · 모서리 칩 frames/corners(32개 39KB) ·
      같은 재질 유지(MAT_NEAR) · 원형이면 재질 줄 끝에 [원 맞추기] · 옛 frames/chips 삭제(쓰는 곳 없음) · dummyArt 삭제.
- [x] WP6 추천 조합 8 — presets/*.webp(224px, 30KB) · applyPreset 그리기 1번 · presetLine = 지금 고른 것 · WebGL2 없으면 탭째 감춤.
- [x] WP7 크기 칩 — 10/20/30/50/100호 + 직접 입력(1~1000cm) · artlook:sizes(이 브라우저, 로그아웃 때 지움) · workOf 사본 ·
      sizes.cjs 로 확인(10호→30호→100호 크기 변화 · 다시 누르면 빼기 · 새로고침 뒤 유지 · 크기 있는 작품엔 줄 없음).
      [여러 점] 칩 이름을 상자 안으로(아래 이름 줄이 휴대폰 칩 칸 176px 을 7px 넘쳤다 — panegeo.cjs).
- [x] WP8 배경 [공간|벽] 무리 · [마무리] 비율·조명·벽 캡션 스위치(못 붙이면 눌렀을 때 이유).
- [x] WP9 색 옮긴 액자 — 후보 14종 → **4종 통과(네이비·포레스트·와인·티크)**. 관문(wp9gate.py v2 + sweepcheck + nomat + framelight + 눈):
      G1 잘림 색 오차 · G2/G5 결 보존 · G3 채도 폭(골든 40) · G4 얼룩 · G6 ΔE2000 ≥ 10(기존 '구분되는' 가장 가까운 쌍 10.0~11.2, '비슷한 베이지' 7.4~7.5).
      v1 의 평균색 OKLab ΔE ≥ 10 은 눈과 어긋나(세이지–메이플 2.6 인데 시트에선 갈림) ΔE2000 으로 바꿨다 — 시트: sheets/wp9-*.png.
      탈락: 버건디·체리(채도 폭 42.5·71.8 → 낮춘 와인 32.7·티크 38.8 은 통과) · 세이지(원본 화이트보다 rail_pct·무매트 흰 링 나쁨) ·
      차콜 4.4 · 크림 6.2 · 허니 6.0 · 그레이 워시 7.3 · 에스프레소 8.8 · 블러시 8.2 · 더스트 블루 9.4(ΔE2000, 기존 액자와 비슷).
      기존 28종 렌더 픽셀 0 차이(56/56). 엔진: PHOTO_TINTS · tintImage(√선형 색인 표) · registerPhotoTints · 옮긴 뒤 보정·측정.
- [x] WP10 테스트 · 문서
      단위: artlookEditor.test.ts 신설 + 5파일 갱신 → 273 통과. E2E 1차(84·69·75·41·30·74, 53개): 44 통과 · 9 실패 → **진짜 결함 둘**
      ① 모양을 눌러도 재질 줄이 안 바뀜(selectShape 가 curShape 를 먼저 바꿔 sync 가 '안 바뀜'으로 봄) ② [ArtLook] 탭을 열 때마다 고른 호수가 지워짐
      (작품을 불러오는 동안 stageArtLookWorks([]) → clearArtLookWorks 가 sizes 까지 지움 → 로그아웃 전용 clearArtLookForLogout 로 나눔).
      나머지 7은 테스트 쪽(처음 탭이 추천이라 lazy 썸네일 0장 — 오히려 가벼워짐 · Playwright 가 aria-disabled 스위치를 '못 누름'으로 봄 · 장면 이름 오기).
      문서: CLAUDE.md 65·75 고침 + 85 신설 · architecture.md 절 · provenance(색 옮긴 액자) · 메모리.
      최종(11-17): 프론트 1743/1743 · 백엔드 1861/1861 · E2E 고친 스펙 18/18(84 7 · 69 · 75 · 41) · walk.js 크롬+WebKit 268/268(8화면) ·
      빌드: 빌드 ID 치환 · sw.js 에 artlook/ 없음 · dist 에 모서리 칩 32 · 추천 칩 8. ArtLook 처음 열 때 받는 양 1.37 → 1.90MB(실내 벽 2508px 때문).
      안드로이드 에뮬레이터(emu.sh dev): 아래 '에뮬레이터' 줄. 아이폰 사파리 · 카카오톡 인앱은 못 봤다.

## 에뮬레이터(2026-11-18, emu.sh dev — 앱이 로컬 개발 서버를 본다, 가상 계정 676)
- 편집 전용 화면: 아트링크 상단바·하단 탭 없이 [×] ArtLook [저장] · 미리보기 화면 폭 가득 · 탭 다섯.
- [저장] → 저장 창(썸네일·'긴 여름'·1568 × 1568px · [저장·공유] · [ArtStory에 올리기]) · **안드로이드 뒤로가기 = 저장 창만 닫힘**(주소 그대로 tab=artlook).
- [저장·공유] → 안드로이드 공유 창(Sharing image, 합성 그림) · 취소하면 저장 창 그대로.
- [×]: 주소로 연 ArtLook → /mypage · 다른 화면에서 메뉴로 들어옴 → 그 화면(/artists) · 앱 안에서 들어와 뒤로가기 → 이전 화면.
- ⚠️ 여기서 결함 하나를 잡아 고쳤다: 주소로 연 마이페이지에서 탭으로 ArtLook 에 오면(탭은 replace — idx 0) `location.key !== 'default'` 가 참이라
  [×]가 navigate(-1) 로 **앱 밖 이전 문서**(브라우저면 다른 사이트)로 나갔다. → `history.state.idx > 0` 판정(상세 화면 '뒤로'와 같은 규칙). 단위 소스 가드 갱신.
  E2E 84 A 는 '홈→메뉴(push)'·'주소로 바로'만 봐서 못 잡았다(E2E 추가는 하지 않음 — 에뮬레이터로 확인).
- 확인 뒤 mobile 설정은 `npm run sync` 로 실서버 주소로 되돌렸다(설치된 앱은 개발 빌드 그대로).
- 못 본 것: 아이폰 사파리 · 카카오톡 인앱 · 실기기.

## 2026-11-18 — 벽 캡션 삭제(사용자 결정)
- 스위치·`captionCard`·`placeWallLabel`·`ArtLookWork.year/medium`·`__artlook.label` 전부 삭제. 단위 테스트는 '없앴다' 가드로, e2e 75 D·84 F 는 캡션 없이 다시 씀(아직 안 돌림 — 백엔드를 데모 DB 로 바꿔야 해서).
- 확인: 프론트 1742 통과 · tsc 통과 · localhost ArtLook 휴대폰·PC 에서 [마무리] = 비율·조명뿐, 예전 `prefs.caption=true` 가 남아도 오류 없음.
