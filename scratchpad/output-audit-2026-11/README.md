# 갤러리 결과물 점검 하니스 (2026-11-24, CLAUDE.md 규칙 92 · 53)

갤러리가 [출품 자료]·[정산]·[지원자] 에서 내려받는 문서(작품 리스트 · 출품 자료 · 정산서 · 지원서 · 도록)를
**화면의 버튼으로 실제로 받아** 쪽을 그림으로 펼쳐 본다. vitest(jsdom)는 PDF 를 그리지 않으므로 모양·글꼴·쪽 나누기는 여기서만 보인다.

⚠️ **데모 DB 전용**(5183 → 4001 = `artlink`). 실서버·복제본에 돌리지 말 것.

## 준비 — 데모 공모 하나
```bash
cd backend && DATABASE_URL=<로컬 데모 DB> npx tsx ../scratchpad/output-audit-2026-11/seed-output-demo.ts           # 가상 작가 10명(비회원 2) · 판매 · 정산 · 지원서 — 공모 번호를 찍는다(다시 돌리면 지우고 새로)
cd backend && DATABASE_URL=<로컬 데모 DB> npx tsx ../scratchpad/output-audit-2026-11/seed-output-demo.ts --clean
# 대체 글꼴 확인용 한자·이모지 — 데모 공모는 전시가 끝나 출품 자료를 못 고친다(403). 2026-11-24 에는 데모 DB 에서 그 작가의
# 출품 자료 JSON 을 SQL 로 바꿨다(작품명 '猫와 나 #1' · 재료 '장지에 水墨' · 약력 '개인展' · 작가노트 '❤ 書畵同源').
# hanja.mjs 는 같은 일을 대신 입력 API 로 한다(전시 종료 전 공모에만 된다).
```

## 받기 — 화면의 버튼으로
```bash
node scratchpad/output-audit-2026-11/grab.cjs <공모> sub      # 출품 자료 구역의 [내려받기] 항목 전부(LABELS='작품 리스트(PDF),도록 PDF' 로 고를 수 있다)
node scratchpad/output-audit-2026-11/grab.cjs <공모> settle   # 전체·현금·카드·작가 정산서
node scratchpad/output-audit-2026-11/grab.cjs <공모> app      # 지원서 전체 ZIP
OUTDIR=out4 ...                                              # 받는 폴더(기본 out/)
```
걸린 시간·크기·파일 이름을 찍는다. 2026-11-24 기준(10명 64점): 작품 리스트 0.4~1.2초 191KB · 출품 자료 ZIP 2.3~3.1초 2.9MB(예전 23.8초 11.5MB) ·
정산서 0.3~0.9초 · 도록 A5 64쪽 29초 15MB(예전 105쪽).

## 보기
```bash
python3 scratchpad/output-audit-2026-11/sheet.py png/a.png 42 "out4/<파일>.pdf:1,2,3,4"     # 쪽 여러 장을 한 장에(두 번째 인자 = dpi)
python3 scratchpad/output-audit-2026-11/render.py ...                                     # 쪽마다 PNG
```
글자가 살아 있는지: `python3 -c "import fitz;d=fitz.open('x.pdf');print(sum(len(p.get_text()) for p in d), {f[3] for p in d for f in p.get_fonts()})"`
— 도록만 그림 PDF(html2canvas)라 글자가 0 이다(의도: 명조 글꼴·사진이 주인공인 책).

## 빌더만 Node 에서(브라우저 없이)
```bash
cd <세션 스크래치>/pdfm && npx tsx --tsconfig tsconfig.json /home/jho4255/ArtLink/scratchpad/output-audit-2026-11/harness/docs.ts <공모> [list|sub|settle|app]
```
pdfmake 의 Node 판으로 같은 빌더를 돌려 `harness/out/` 에 둔다(글꼴은 frontend/src/assets/fonts).

## Pretendard 글자 범위 표 다시 뽑기
글꼴 파일(`frontend/src/assets/fonts/Pretendard-*.otf`)을 바꾸면 `frontend/src/lib/galleryDocs/glyphCoverage.ts` 도 다시 뽑는다 —
`galleryDocsGuards.test.ts` 가 표와 파일을 대조해 먼저 깨진다.
```bash
cd frontend && node -e "
const fk=require('fontkit');
const r=fk.openSync('src/assets/fonts/Pretendard-Regular.otf'), b=fk.openSync('src/assets/fonts/Pretendard-Bold.otf');
const B=new Set(b.characterSet); const cps=[...new Set(r.characterSet)].filter(c=>B.has(c)&&c>=32).sort((x,y)=>x-y);
const R=[]; for(const c of cps){const l=R[R.length-1]; if(l&&c===l[1]+1) l[1]=c; else R.push([c,c]);}
console.log(JSON.stringify(R))"
```

## 목업
`project/*.dc.html` — 개선안 목업 캔버스(https://claude.ai/artifact/Btx9WUtbhETceu3D4CZ9gp)의 원본. 그림은 `assets/`(ArtLook 렌더 · 지어낸 그림).
