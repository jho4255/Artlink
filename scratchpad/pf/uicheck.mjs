// 실제 앱 화면 확인 — 피커의 미리보기는 같은 엔진을 쓴다.
// ⚠️ 로컬 백엔드가 실서버 복제본을 가리킬 수 있어 **로그인하지 않는다**. 공개 라우트만 본다.
import pw from '/home/jho4255/ArtLink/e2e/node_modules/playwright/index.js';
const b = await pw.chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
const errs = [];
p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 160)); });
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.waitForTimeout(2500);
console.log('홈 로드:', await p.title());
// 엔진을 앱 번들에서 직접 불러 미리보기와 같은 경로로 한 장 그린다
const r = await p.evaluate(async () => {
  const m = await import('/src/lib/portfolioFormats.ts');
  const data = { user: { name: '김서연', email: 'a@b.com' }, biography: '약력', statement: '작가노트',
    images: [{ id: 1, url: '', title: '작품', medium: 'Oil', sizeText: '50×50 cm', year: '2025', order: 0 }] };
  const pages = m.buildPortfolioPages(data, m.themeById('archive'),
    { design: { coverLayout: 'bandTop', worksLayout: 'grid', page: 'wide', desc: 'short' } });
  const html = pages.map((x) => x.html).join('');
  return { pages: pages.length, colorMix: html.includes('color-mix'),
    colorFn: /[^-]\bcolor\(/.test(html), panel: (html.match(/background:#[0-9a-f]{6}/gi) || []).slice(0, 3) };
});
console.log('앱 번들 엔진:', JSON.stringify(r));
console.log('에러:', errs.length ? errs.slice(0, 5) : '없음');
await b.close();
