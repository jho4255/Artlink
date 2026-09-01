import pw from '/home/jho4255/ArtLink/e2e/node_modules/playwright/index.js';
const b = await pw.chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1100, height: 900 } });
const errs = [];
p.on('pageerror', e => errs.push('JS: ' + e.message));
p.on('console', m => { if (m.type() === 'error') errs.push('C: ' + m.text().slice(0, 160)); });
await p.goto('http://localhost:5173/artlook/index.html', { waitUntil: 'networkidle' });
await p.waitForTimeout(4000);
const r = await p.evaluate(() => ({
  frames: FRAMES.map(f => f.name),
  photos: Object.keys(PHOTO_FRAMES || {}),
  scenes: SCENES.map(s => `${s.name}:${s.group}`),
  group: state.sceneGroup,
  tabs: [...document.querySelectorAll('#sceneGroup button')].map(b => b.dataset.sg + (b.classList.contains('active') ? '*' : '')),
  tabRow: getComputedStyle(document.getElementById('sceneGroupRow')).display,
  chips: [...document.querySelectorAll('#scenes .chip span')].map(s => s.textContent),
}));
console.log('액자', r.frames.length, '·', r.frames.slice(4, 9).join(' '));
console.log('사진자산', r.photos.sort().join(' '));
console.log('장면', r.scenes.length, '· 탭', r.tabs.join('/'), '· 줄', r.tabRow, '· 현재', r.group);
console.log('보이는 칩', r.chips.length, ':', r.chips.join(' '));
// 공간 탭으로 전환
const sp = await p.evaluate(() => { document.querySelector('#sceneGroup button[data-sg="space"]').click();
  return [...document.querySelectorAll('#scenes .chip span')].map(s => s.textContent); });
console.log('공간 탭', sp.length, ':', sp.join(' '));
console.log('에러:', errs.length ? errs.slice(0, 4) : '없음');
await b.close();
