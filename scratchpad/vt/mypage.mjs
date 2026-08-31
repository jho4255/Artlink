// 실제 사용자 경로 확인 — 마이페이지 ArtLook 탭(iframe) 이 정상인지.
// 하니스가 아니라 여기서 깨지면 사용자에게 깨진 것이다.
import pw from '/home/jho4255/ArtLink/e2e/node_modules/playwright/index.js';
import { writeFileSync } from 'node:fs';
const { chromium } = pw;
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await b.newContext({ viewport: { width: 1500, height: 1000 } });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push('page: ' + e.message));
p.on('console', (m) => { if (m.type() === 'error') errs.push('con: ' + m.text().slice(0, 160)); });

// ⚠️ 로컬 백엔드가 **실사용자 데이터가 든 DB** 를 보고 있다. 로그인해서 남의 계정으로
// 들어가지 않는다. 마이페이지가 씌우는 것과 같은 임베드 주소를 직접 연다.
await p.goto('http://localhost:5173/artlook/index.html?embed=1', { waitUntil: 'networkidle' });
await p.waitForTimeout(6000);
const fr = p.frames().find((f) => f.url().includes('/artlook/'));
console.log('iframe:', fr ? fr.url() : '없음');
if (fr) {
  const st = await fr.evaluate(() => ({
    works: document.querySelectorAll('#works img').length,
    webgl: !!(window.ArtLookScene && ArtLookScene.supported()),
    scenes: (window.SCENES || []).length,
    frames: (window.FRAMES || []).length,
    previewW: document.getElementById('preview') && document.getElementById('preview').width,
    wallsHidden: (() => { const e = document.getElementById('walls'); return !e || e.offsetParent === null; })(),
  }));
  console.log('상태:', JSON.stringify(st));
  await fr.evaluate(async () => {
    const w = document.querySelectorAll('#works img');
    if (w.length) w[0].click();
    await new Promise((r) => setTimeout(r, 2500));
  });
}
await p.screenshot({ path: '/home/jho4255/ArtLink/scratchpad/vt/mypage_artlook.png', fullPage: false });
console.log('에러:', errs.length ? [...new Set(errs)].slice(0, 6) : '없음');
await b.close();
