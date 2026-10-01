# 히어로 배너 잘림 하니스 (2026-10-01)

홈 배너(`frontend/src/components/home/HeroSlider.tsx`)가 **어느 엔진·어느 화면에서도 잘리지 않는지** 잰다.
크롬만 보면 못 잡는다 — 2026-10-01 의 잘림은 사파리(WebKit)에서만 났다.

```bash
bash scratchpad/hero/setup-webkit.sh        # 최초 1회 — WebKit 을 sudo 없이 띄울 준비(~/.cache/wk-deps)
# 로컬 프론트(5173)가 떠 있어야 한다. 백엔드·DB 는 건드리지 않는다(슬라이드·이미지를 가로채 넣는다).
cd e2e && PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1 node ../scratchpad/hero/matrix.js
#   ENGINE=webkit|chromium  한쪽만 · SHOTS=1  스크린샷(out/) · BASE=https://artlink.cc  실서버를 같은 구성으로
```

- 2 엔진 × 8 화면(아이폰 SE·13·13 가로, 갤럭시 360, 픽셀 7, 아이패드 미니, PC 1280·1920) × 8 슬라이드 구성 = **128 조합**.
- 판정: 사진이 `contain` 으로 앉은 '그림 영역'이 트랙·슬라이드 칸 안에 **전부** 들어와 있는가(보임 100%),
  트랙이 세로로 스크롤되지 않는가, 페이지가 가로로 밀리지 않는가. 하나라도 어기면 종료 코드 1.
- 테스트 이미지는 네 변 색이 다른 SVG(위 빨강·아래 파랑·왼쪽 초록·오른쪽 자홍) — 스크린샷에서 어느 변이 잘렸는지 바로 보인다.

수정 전 실측(WebKit): PC 1280×720 에서 3:1 배너의 77.6% · 아이폰 13 가로 95.7% · 4:5 모바일 이미지 + 아이폰 13 세로 95.3% ·
16:9 배너는 46~57% 만 보였다. 크롬은 전부 100%. 원인과 고친 방법은 `HeroSlider.tsx` 의 주석과 CLAUDE.md 규칙 48.
