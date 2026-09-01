# 포트폴리오 PDF 회귀 하니스

ArtLook 의 `scratchpad/vt/` 와 **같은 이유**로 만든다 — "미리보기가 괜찮아 보인다"로는
못 잡는 것들이 있고, 실제로 못 잡아서 사고가 났다.

> ⚠️ **이 폴더를 지우지 말 것.** CLAUDE.md 가 회귀 근거로 지목했던 하니스 7개 중 **6개가
> 이미 사라져 있었다**(`pdf-overflow-audit.mjs`·`cover-layout-audit.mjs`·`works-caption-audit.mjs`·
> `covers-22-engine.mjs`·`works-layouts-engine.mjs`·`pptx-test.mjs`). 문서에 적힌
> "46,752장 → 0" 은 그때 재현할 수 없는 숫자였다. 없어지면 다시 눈으로 판정하게 된다.

## 왜 vitest 로는 부족한가

`portfolioFormats.test.ts` 는 **jsdom** 이라 레이아웃을 못 잰다. 전부 HTML 문자열 검사라
72개가 140ms 에 통과한다 — 한 번도 렌더하지 않으므로 아래 부류는 **구조적으로** 못 본다.

- 페이지(고정 높이 + `overflow:hidden`)를 넘겨 **조용히 잘리는** 내용
- 작품이 지면에서 실제로 얼마나 차지하는가
- 렌더된 색의 대비 (배경은 형제 absolute 요소라 조상 탐색으로는 못 구한다 — 히트테스트 필요)
- html2canvas 가 크롬 계산값을 파싱할 수 있는가 (**PDF 저장 성패**)

문자열만 봐도 확정되는 사고(`color-mix`, 표지 문구 누출, 여백 비율)는 vitest 로 옮겨 뒀다.
나머지가 여기 몫이다.

## 실행

```bash
cd frontend && ./node_modules/.bin/esbuild src/lib/portfolioFormats.ts \
  --bundle --format=esm --alias:@=./src --outfile=../scratchpad/pf/engine.mjs   # 엔진 번들(선행 필수)
cd ../scratchpad/pf

node audit.mjs all      # 넘침·설명줄수·대비 전수 (216+189+24 조합 / 2,688장)
node probe.mjs          # 작품 크기·역할별 대비·PPTX 색 파싱
node probe2.mjs         # 선 대비 · 표지 토글 누출 · 실제 PDF 렌더+용량
node probe3.mjs         # 작품 합계 지면점유 (골든과 같은 지표) · 캡션 실측
node blast.mjs          # PDF 가 깨지는 조합 범위 (표지 21 × 작품 6)
node fidelity.mjs       # 미리보기(크롬) vs PDF(html2canvas) 일치
node capmeasure.mjs     # 캡션 조각별 실제 높이 (글꼴 6종)
node palette.mjs        # 팔레트 전수 대비 (DOM 불필요)

/home/jho4255/hunohquant/.venv/bin/python golden.py    # 레퍼런스 5종 지면점유
/home/jho4255/hunohquant/.venv/bin/python golden2.py   # 쪽당 점수별 · 판형별
/home/jho4255/hunohquant/.venv/bin/python golden3.py   # 비율 분포 · 여백
```

## 골든 (실제 작가 포트폴리오 5종 · 작품 319점)

`portfolio/` 의 PDF 를 **구조에서 직접** 읽는다(이미지 검출 금지 — 여백·액자 때문에
십수 pt 씩 틀린다). ⚠️ **타인 저작물이라 커밋 금지**(`.gitignore` 27행). 뽑는 건 숫자뿐이다.

가장 쓸모 있는 지표는 **작품 합계 지면점유** — 밀도가 달라도 값이 안정적이다.

| 쪽당 점수 | 1 | 2 | 3 | 4 |
|---|---|---|---|---|
| 작품 합계 | 42.2% | 48.7% | 49.9% | 56.1% |

⚠️ **낱장 최대치로 비교하지 말 것** — 1점인 쪽(29%)과 4점인 쪽을 뭉치면 우리 격자와 견줄 수 없다.

골든 작품 비율은 중앙 0.92(**세로 63%**)로 우리 합성 데이터(1.00, 40%)보다 **세로가 많다** —
즉 골든에 불리한 조건인데도 더 크게 싣는다. 비교는 보수적이고, 격차는 진짜다.

## 데이터

`data.mjs` 의 합성 작가 4명. **실제 가입자 데이터를 쓰지 않는다**(개인정보가 스크래치패드에
남지 않게). 실서버 40명 조사 분포를 흉내낸다 — 작품 중앙 8점 · 한줄소개 거의 없음 ·
작가노트 대부분 없음 · 경력 편차 극심.

- `typical` 중앙값 작가 (8점, 짧은 약력)
- `rich` 다 채운 작가 (30점, 경력 72건, 시리즈 2개)
- `stress` 최악 콘텐츠 (무공백 432자, 아주 긴 제목)
- `minimal` 갓 가입 (1점, 나머지 비어 있음)

작품 사진은 캔버스로 그린 색면이다. 비율만 실제 회화 분포를 따른다.

## 2026-08-31 수정으로 잡은 것

| | 전 | 후 |
|---|---|---|
| PDF 가 나오는 표지×작품 조합 | 16/126 (13%) | **126/126** |
| 설명 2줄 예약 초과 | 216건 (최대 60px) | **0건** (최대 40px) |
| 대비 미달 조합 | 216/216 (최저 2.76:1) | **0/216** |
| 선 대비 (어두운 배경) | 1.03:1 | **1.51:1** |
| 작품 합계 `grid`@와이드 | 4.2% | **10.3%** |
| 작품 합계 `hero`@와이드 | 17.6% | **24.5%** |
| 넘침 | 0 | **0** (유지) |
