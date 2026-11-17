import pw from '/home/jho4255/ArtLink/e2e/node_modules/playwright/index.js';
const b = await pw.chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1100, height: 860 } });
await p.goto('http://localhost:5173/artlook/index.html', { waitUntil: 'networkidle' });
await p.waitForTimeout(2500);
const r = await p.evaluate(() => ({
  frames: FRAMES.map((f, i) => [i, f.id, f.name, f.kind, f.hidden ? 'hidden' : '']),
  scenes: SCENES.map((s, i) => [i, s.id, s.name, s.group, s.maxLong || '', s.frameless ? 'frameless' : '']),
  state: Object.fromEntries(Object.entries(state).filter(([k, v]) => typeof v !== 'object' || v === null)),
  ratios: typeof RATIOS !== 'undefined' ? RATIOS : null,
}));
console.log(r.frames.map((x) => x.join(' | ')).join('\n'));
console.log('---');
console.log(r.scenes.map((x) => x.join(' | ')).join('\n'));
console.log('---', JSON.stringify(r.state));
console.log(JSON.stringify(r.ratios));
await b.close();
