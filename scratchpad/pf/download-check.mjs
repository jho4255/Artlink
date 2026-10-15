// [PDF 내려받기] 결과가 화면 미리보기와 같은가 — **앱에서 실제로 내려받아** 쪽마다 비교한다 (2026-10-15)
//
// 왜: 김현수 작가의 '작품 이름이 잘린다'(규칙 69)는 미리보기·인쇄 경로는 멀쩡하고 내려받은 파일에서만 났다.
//     그때까지 PDF 하니스는 앱 밖(앱 CSS 없이)에서 엔진만 돌려 이 차이를 볼 수 없었다. 이건 사용자가 누르는 그 단추를 누른다.
//
// 하는 일(로컬 데모 DB 의 Artist 1 — 디자인 설정을 잠깐 바꿨다가 되돌린다):
//   1. 설정마다 디자인을 저장하고 포트폴리오 만들기 화면을 연다
//   2. [PDF 저장] → [PDF 내려받기] 로 받은 파일을 out-dl/<이름>.pdf 에
//   3. 같은 화면의 미리보기 쪽 HTML 을 **크롬이 그대로**(내려받기와 같은 배율) 그린 그림을 out-dl/<이름>-ref-<쪽>.png 에
//   4. python3 download-check.py 가 둘을 쪽마다 맞대 본다(어긋남·글자 밀림·사라진 것)
//
//   node scratchpad/pf/download-check.mjs && python3 scratchpad/pf/download-check.py
//   ⚠️ 로컬 개발 서버(5173·4000)와 데모 DB 에서만. 실서버에 돌리지 말 것.
import pw from '/home/jho4255/ArtLink/e2e/node_modules/playwright/index.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = '/home/jho4255/ArtLink/scratchpad/pf/out-dl';
mkdirSync(OUT, { recursive: true });
const API = 'http://localhost:4000/api';
const APP = 'http://localhost:5173';

const ALL_CONFIGS = [
  // 김현수 작가(실서버 610)와 같은 설정 — 제목만 · 작품 목록 · 고딕 · 꽉 채우기
  { name: 'kim', design: { font: 'gothic', worksCaption: 'minimal', worksIndex: true, auto: true, worksLayout: 'full', direction: 'artwork', page: 'a4-portrait', coverLayout: 'fullTint', captionStyle: 'kr' } },
  { name: 'myeongjo-grid-price', design: { font: 'myeongjo', worksCaption: 'below', worksIndex: true, auto: false, worksLayout: 'grid', page: 'a4-portrait', coverLayout: 'bandTop', showPrice: true } },
  { name: 'landscape-label', design: { font: 'noto', worksLayout: 'label', desc: 'full', auto: false, page: 'a4-landscape', coverLayout: 'grid2x2', worksIndex: true } },
  { name: 'wide-duo', design: { font: 'gowun', worksLayout: 'duo', auto: false, page: 'wide', coverLayout: 'stacked', worksCaption: 'side' } },
];
// ONLY=kim 처럼 이름으로 고른다
const CONFIGS = process.env.ONLY ? ALL_CONFIGS.filter((c) => process.env.ONLY.split(',').includes(c.name)) : ALL_CONFIGS;
const SCALE = { 'a4-portrait': ((210 / 25.4) * 240) / 1000, 'a4-landscape': ((297 / 25.4) * 240) / 1414, wide: Math.min(2.4, ((297 / 25.4) * 240) / 1600) };

const login = await (await fetch(`${API}/auth/dev-login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'artist1@artlink.com' }) })).json();
const H = { 'content-type': 'application/json', authorization: `Bearer ${login.token}` };
const original = (await (await fetch(`${API}/portfolio`, { headers: H })).json()).designConfig ?? null;
const putDesign = (designConfig) => fetch(`${API}/portfolio/design`, { method: 'PUT', headers: H, body: JSON.stringify({ designConfig }) });

const b = await pw.chromium.launch();
const summary = [];
try {
  for (const c of CONFIGS) {
    const keep = original && typeof original === 'object' ? Object.fromEntries(Object.entries(original).filter(([k]) => ['heroImageId', 'webTheme'].includes(k))) : {};
    const r = await putDesign({ ...keep, ...c.design });
    if (!r.ok) throw new Error(`디자인 저장 실패 ${r.status} ${await r.text()}`);
    const scale = SCALE[c.design.page];
    const ctx = await b.newContext({ viewport: { width: 1700, height: 1700 }, deviceScaleFactor: scale, acceptDownloads: true });
    await ctx.addInitScript(([token, user]) => {
      localStorage.setItem('artlink-auth', JSON.stringify({ state: { token, user, isAuthenticated: true }, version: 0 }));
      localStorage.setItem('artlink-homepage-nudge-snooze', JSON.stringify({ [user.id]: 8.64e15 }));
      navigator.sendBeacon = () => true;
    }, [login.token, login.user]);
    // NOFIX=1 — 규칙 69 를 고치기 전 상태를 흉내 낸다(측정용 1px GIF 를 다시 block 으로). 이 검사가 그 결함을 잡는지 확인하는 용도
    if (process.env.NOFIX) await ctx.addInitScript(() => {
      document.addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.textContent = 'img[src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"]{display:block!important}'; document.head.appendChild(st); });
    });
    const p = await ctx.newPage();
    await p.goto(`${APP}/mypage?tab=portfolio`, { waitUntil: 'networkidle' });
    await p.locator('[data-book-preview] [data-page-index="0"]').waitFor({ timeout: 30000 });
    await p.waitForTimeout(1500);

    // 1) 실제 내려받기
    await p.locator('[data-maker-bar]').getByRole('button', { name: /PDF 저장/ }).click();
    const dlg = p.getByRole('dialog', { name: 'PDF 저장' });
    await dlg.waitFor();
    const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 180000 }), dlg.getByRole('button', { name: /PDF 내려받기/ }).click()]);
    await dl.saveAs(join(OUT, `${c.name}.pdf`));
    await p.keyboard.press('Escape');

    // 2) 같은 쪽 HTML 을 크롬이 그린 그림(내려받기와 같은 배율 — 이 컨텍스트의 기기 배율이 곧 그 배율)
    const pages = await p.$$eval('[data-book-preview] [data-page-index] [data-scaled-page] > div', (els) => els.map((e) => e.innerHTML));
    const dims = await p.$eval('[data-book-preview] [data-page-index="0"] [data-scaled-page] > div', (e) => ({ w: parseFloat(e.style.width), h: parseFloat(e.style.height) }));
    for (let i = 0; i < pages.length; i++) {
      await p.evaluate(async ({ html, w, h }) => {
        let host = document.getElementById('__ref');
        if (!host) { host = document.createElement('div'); host.id = '__ref'; document.body.appendChild(host); }
        host.style.cssText = `position:fixed;left:0;top:0;width:${w}px;height:${h}px;z-index:2147483647;background:#fff;overflow:hidden`;
        // 미리보기는 썸네일로 싣는다 — 내려받기는 원본이다
        host.innerHTML = html.replace(/src="([^"]+)" data-full="([^"]+)"/g, (_m, _t, full) => `src="${full}"`);
        await Promise.all([...host.querySelectorAll('img')].map((im) => (im.complete ? 0 : new Promise((r) => { im.onload = im.onerror = r; }))));
        await document.fonts.ready;
      }, { html: pages[i], ...dims });
      await p.waitForTimeout(150);
      await p.locator('#__ref').screenshot({ path: join(OUT, `${c.name}-ref-${String(i + 1).padStart(2, '0')}.png`) });
    }
    summary.push({ name: c.name, pages: pages.length, w: dims.w, h: dims.h, scale });
    console.log(`${c.name}: ${pages.length}쪽 내려받음`);
    await ctx.close();
  }
} finally {
  await putDesign(original);
  await b.close();
}
writeFileSync(join(OUT, 'summary.json'), JSON.stringify(summary, null, 1));
