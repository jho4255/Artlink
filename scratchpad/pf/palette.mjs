// 팔레트 전수 — 화면이 '추천'(초록 점)이라고 표시하는 조합이 실제로 읽히는가.
//
// portfolioColors.ts 는 **ink 와 accent 만** 대비를 잰다. 그런데 캡션(재료·크기·연도)·
// 작품설명·CV 영문라벨·연락처는 전부 `sub = mix(ink, bg, 0.45)` 로 그려진다 —
// 이 값은 아무도 검사하지 않는다. accent 도 12px 글자로 쓰이는데 기준은 3.0(대형용)이다.
//
//   node palette.mjs
const BACKGROUNDS = [['white', '#FFFFFF'], ['ivory', '#FAF7F0'], ['sand', '#F1E8DA'], ['mist', '#EDF1F4'],
  ['blush', '#F6EEEC'], ['graphite', '#2B2B31'], ['ink', '#15151B'], ['navy', '#161B2E']];
const TEXTS = [['black', '#1A1A1A'], ['charcoal', '#3C3C44'], ['brown', '#4A3F31'], ['navy', '#1E2540'],
  ['white', '#F5F5F5'], ['cream', '#EFE7D7'], ['slate', '#C6CCD6']];
const ACCENTS = [['red', '#C4302B'], ['gold', '#8A7350'], ['orange', '#EA6A1E'], ['blue', '#2563EB'],
  ['green', '#2F7D5B'], ['plum', '#7A3E63']];

const rgb = (h) => [0, 2, 4].map((i) => parseInt(h.slice(1 + i, 3 + i), 16));
const relLum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const contrast = (a, b) => { const x = relLum(rgb(a)), y = relLum(rgb(b)); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const mix = (a, b, t) => '#' + rgb(a).map((v, i) => Math.round(v + (rgb(b)[i] - v) * t).toString(16).padStart(2, '0')).join('');

console.log('추천(초록점) 조합에서 **보조글자(sub)** 의 실제 대비 — 캡션·설명·CV영문·연락처가 이 색이다');
console.log('배경        글자        ink대비  →  sub 대비   13px 캡션 판정');
let worst = 9, nBad = 0, nRec = 0;
for (const [bk, bg] of BACKGROUNDS)
  for (const [tk, ink] of TEXTS) {
    const ci = contrast(ink, bg);
    if (ci < 4.5) continue;                       // 화면이 추천하지 않는 조합은 뺀다
    nRec++;
    const sub = mix(ink, bg, 0.45);
    const cs = contrast(sub, bg);
    if (cs < 4.5) nBad++;
    if (cs < worst) worst = cs;
    console.log(`${bk.padEnd(11)} ${tk.padEnd(11)} ${ci.toFixed(2).padStart(6)}  →  ${cs.toFixed(2).padStart(6)}:1   ${cs >= 4.5 ? 'AA 통과' : 'AA 미달 ✗'}`);
  }
console.log(`\n추천 조합 ${nRec}개 중 보조글자가 AA 미달: ${nBad}개  (최저 ${worst.toFixed(2)}:1)`);

console.log('\n강조색(accent) — 기준이 3.0(대형 그래픽)인데 실제로는 10~13px 글자로도 쓰인다');
console.log('  (prosePages 아이브로우 12px · CV 머리말 12px · 연락처 12px · 작품 상태배지 12px)');
console.log('배경        강조        대비    3.0기준  4.5기준(작은 글자)');
let smallBad = 0, smallTot = 0;
for (const [bk, bg] of BACKGROUNDS)
  for (const [ak, ac] of ACCENTS) {
    const c = contrast(ac, bg);
    if (c < 3.0) continue;                        // 추천에 안 뜨는 건 뺀다
    smallTot++; if (c < 4.5) smallBad++;
    console.log(`${bk.padEnd(11)} ${ak.padEnd(11)} ${c.toFixed(2).padStart(5)}   추천    ${c >= 4.5 ? '통과' : '미달 ✗'}`);
  }
console.log(`\n추천 강조색 ${smallTot}개 중 12px 글자 기준 미달: ${smallBad}개`);

console.log('\n구분선(line = mix(ink,bg,0.88)) — 은은함이 의도지만 어디까지 옅어지나');
for (const [bk, bg] of BACKGROUNDS.slice(0, 3).concat(BACKGROUNDS.slice(5, 6))) {
  const ln = mix('#1A1A1A', bg, 0.88);
  console.log(`  ${bk.padEnd(10)} ${ln}  대비 ${contrast(ln, bg).toFixed(2)}:1  (UI 경계 권장 3.0)`);
}
