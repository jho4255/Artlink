// 비회원 소개 팝업(규칙 73)의 네 칸 — **실제 우리 화면**을 샘플 작가로 찍는다. 로컬 개발 서버 + 데모 DB 전용.
//   cd backend && npx tsx scripts/seed-intro-sample.ts      (샘플 작가 '윤서진' · /@seojin.yoon · 데모 그림 9점)
//   node scratchpad/guest-intro/capture.mjs                 → out/raw-*.png
//   node scratchpad/guest-intro/compose.mjs                 → out/q-*.png (칸 모양으로 짜 맞춘 것)
//   python3 scratchpad/guest-intro/make-assets.py           → frontend/public/intro/*.webp
// 공모 제목·주최는 찍는 브라우저 안에서만 바꾼다(로컬 데모 공모 제목이 '[예시] …' 라서) — DB 는 건드리지 않는다.
import pw from '/home/jho4255/ArtLink/e2e/node_modules/playwright/index.js';
import { writeFileSync } from 'node:fs';
const APP = 'http://localhost:5173', API = 'http://localhost:4000/api';
const OUT = '/home/jho4255/ArtLink/scratchpad/guest-intro/out';
const DESIGNS = (process.env.DESIGNS || '갤러리 도록,에디토리얼,다크 룩북').split(',');

const login = await (await fetch(`${API}/auth/dev-login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'intro-sample@artlink.test' }) })).json();
if (!login.token) throw new Error('샘플 작가가 없다 — seed-intro-sample.ts 를 먼저');
const H = { 'content-type': 'application/json', authorization: `Bearer ${login.token}` };
const open = await fetch(`${API}/exhibitions?scope=open`).then((r) => r.json());
const exId = (Array.isArray(open) ? open : open.exhibitions || open.items || [])[0]?.id;
const asMe = async (ctx) => ctx.addInitScript(([token, user]) => {
  localStorage.setItem('artlink-auth', JSON.stringify({ state: { token, user, isAuthenticated: true }, version: 0 }));
  localStorage.setItem('artlink-homepage-nudge-snooze', JSON.stringify({ [user.id]: 8.64e15 }));
  navigator.sendBeacon = () => true;
}, [login.token, login.user]);

const b = await pw.chromium.launch();

// 1) 작가 홈페이지 — 비회원이 보는 그대로(PC)
{
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  await p.goto(`${APP}/@seojin.yoon`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `${OUT}/raw-home.png`, clip: { x: 0, y: 0, width: 1280, height: 900 } });
  await ctx.close();
  console.log('✓ 홈페이지');
}

// 2) 지원서 — 홈페이지 내용으로 채워진 화면(사이드바가 없는 폭)
if (exId) {
  const ctx = await b.newContext({ viewport: { width: 900, height: 1200 }, deviceScaleFactor: 2 });
  await asMe(ctx);
  await ctx.route(new RegExp(`/api/exhibitions/${exId}(\\?.*)?$`), async (r) => {
    const res = await r.fetch(); const j = await res.json();
    j.title = '2026 신진작가 공모';
    if (j.gallery) j.gallery.name = '아트링크';
    await r.fulfill({ response: res, json: j });
  });
  const p = await ctx.newPage();
  await p.goto(`${APP}/exhibitions/${exId}/apply`, { waitUntil: 'networkidle' });
  await p.getByText('채웠어요').first().waitFor({ timeout: 15000 });
  await p.waitForTimeout(800);
  // 머리(지원서 · 공모 제목)부터 작품 사진 칸까지
  const top = await p.getByText('지원서', { exact: true }).first().boundingBox();
  const works = await p.getByText('작품 사진', { exact: false }).first().boundingBox();
  const bio = await p.locator('textarea').first().boundingBox();
  // 작품 사진 칸 — 작품 썸네일이 든 가장 가까운 격자
  const grid = await p.evaluate(() => {
    const img = [...document.querySelectorAll('main img')].find((i) => i.src.includes('demo-art'));
    let el = img; while (el && getComputedStyle(el).display !== 'grid') el = el.parentElement;
    const r = (el || img).getBoundingClientRect();
    return { x: r.x, y: r.y + scrollY, width: r.width, height: r.height };
  });
  await p.screenshot({ path: `${OUT}/raw-apply.png`, fullPage: true });
  writeFileSync(`${OUT}/raw-apply.json`, JSON.stringify({ top, works, bio, grid }));
  await ctx.close();
  console.log('✓ 지원서', JSON.stringify({ top: top?.y, works: works?.y }));
}

// 3) 포트폴리오 PDF — 디자인마다 표지·작품 쪽을 원래 크기로 그린다(내려받기와 같은 HTML)
{
  const ctx = await b.newContext({ viewport: { width: 1500, height: 1500 }, deviceScaleFactor: 1 });
  await asMe(ctx);
  const p = await ctx.newPage();
  await p.goto(`${APP}/mypage?tab=portfolio`, { waitUntil: 'networkidle' });
  await p.locator('[data-book-preview] [data-page-index="0"]').waitFor({ timeout: 30000 });
  for (const [di, name] of DESIGNS.entries()) {
    await p.getByRole('button', { name: new RegExp(name) }).first().click();
    await p.waitForTimeout(1800);
    const pages = await p.$$eval('[data-book-preview] [data-page-index]', (els) => els.map((e) => ({
      kind: e.getAttribute('data-page-kind'),
      html: e.querySelector('[data-scaled-page] > div')?.innerHTML || '',
      w: parseFloat(e.querySelector('[data-scaled-page] > div')?.style.width || '0'),
      h: parseFloat(e.querySelector('[data-scaled-page] > div')?.style.height || '0'),
    })));
    const pick = [pages.findIndex((x) => x.kind === 'cover'), pages.findIndex((x) => x.kind === 'works')];
    for (const [k, idx] of pick.entries()) {
      const pg = pages[idx];
      await p.evaluate(async ({ html, w, h }) => {
        let host = document.getElementById('__ref');
        if (!host) { host = document.createElement('div'); host.id = '__ref'; document.body.appendChild(host); }
        host.style.cssText = `position:fixed;left:0;top:0;width:${w}px;height:${h}px;z-index:2147483647;background:#fff;overflow:hidden`;
        host.innerHTML = html.replace(/src="([^"]+)" data-full="([^"]+)"/g, (_m, _t, full) => `src="${full}"`);
        await Promise.all([...host.querySelectorAll('img')].map((im) => (im.complete ? 0 : new Promise((r) => { im.onload = im.onerror = r; }))));
        await document.fonts.ready;
      }, pg);
      await p.waitForTimeout(200);
      await p.locator('#__ref').screenshot({ path: `${OUT}/raw-pf${di}-${k ? 'works' : 'cover'}.png` });
      await p.evaluate(() => document.getElementById('__ref')?.remove());
    }
    console.log('✓ 포트폴리오', di, name, pages.length + '쪽');
  }
  await ctx.close();
}
// 4) 갤러리 — 공모 운영 화면(정산까지 온 공모). 로컬 데모 데이터의 이름은 찍는 브라우저 안에서만 바꾼다
//    ('서울 현대 갤러리' 는 실존 갤러리와 헷갈리고, 공모 제목은 '[단계 10] …' 이다. DB 는 그대로)
{
  const GID = Number(process.env.OP_EX || 14);
  const RENAME = [['서울 현대 갤러리', '아트링크 갤러리'], ['[단계 10] 작가 모두 확인 · 정산 완료 전', '2026 신진작가 기획전'], ['Artist 1', '윤서진']];
  const g = await (await fetch(`${API}/auth/dev-login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'gallery@artlink.com' }) })).json();
  const ctx = await b.newContext({ viewport: { width: 900, height: 1200 }, deviceScaleFactor: 2 });
  await ctx.addInitScript(([token, user]) => {
    localStorage.setItem('artlink-auth', JSON.stringify({ state: { token, user, isAuthenticated: true }, version: 0 }));
    navigator.sendBeacon = () => true;
  }, [g.token, g.user]);
  await ctx.route(/\/api\//, async (r) => {
    const res = await r.fetch();
    const type = res.headers()['content-type'] || '';
    if (!type.includes('json')) return r.fulfill({ response: res });
    let body = await res.text();
    for (const [from, to] of RENAME) body = body.split(from).join(to);
    await r.fulfill({ response: res, body });
  });
  const p = await ctx.newPage();
  await p.goto(`${APP}/exhibitions/${GID}/operation/new`, { waitUntil: 'networkidle' });
  // 900px 폭에서는 휴대폰용 하단 탭바가 떠 있어 전체 화면 캡처 가운데에 찍힌다 — 찍을 때만 숨긴다
  await p.addStyleTag({ content: 'nav[aria-label="하단 메뉴"], nav.fixed.bottom-0 { display: none !important; }' });
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `${OUT}/raw-op.png`, fullPage: true });
  const head = await p.getByText('공모 운영', { exact: false }).first().boundingBox();
  // 정산 합계 상자('전체 · 판매 합계 · 작가 지급') — 그 글자를 다 품은 가장 작은 상자
  const sum = await p.evaluate(() => {
    const all = [...document.querySelectorAll('main div')].filter((d) => /^전체/.test(d.textContent.trim()) && d.textContent.includes('작가 지급'));
    const el = all.sort((a, b) => a.getBoundingClientRect().height - b.getBoundingClientRect().height)[0];
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y + scrollY, width: r.width, height: r.height };
  });
  writeFileSync(`${OUT}/raw-op.json`, JSON.stringify({ head, sum }));
  await ctx.close();
  console.log('✓ 공모 운영', JSON.stringify({ head, sum }));
}
// 5) 갤러리 홈페이지 · 전시 홍보 — 샘플 갤러리(/@artlink.gallery)와 그 전시를 비회원이 보는 그대로
{
  const showId = await fetch(`${API}/shows?showStatus=ongoing`).then((r) => r.json())
    .then((d) => (Array.isArray(d) ? d : d.shows || d.items || []).find((x) => String(x.title).startsWith('윤서진 개인전'))?.id);
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  await p.goto(`${APP}/@artlink.gallery`, { waitUntil: 'networkidle' }); await p.waitForTimeout(1500);
  await p.screenshot({ path: `${OUT}/raw-ghome.png`, clip: { x: 0, y: 0, width: 1280, height: 900 } });
  if (showId) {
    await p.goto(`${APP}/shows/${showId}`, { waitUntil: 'networkidle' }); await p.waitForTimeout(1500);
    await p.screenshot({ path: `${OUT}/raw-show.png`, fullPage: true });
    // 포스터 · 제목부터 '위치' 줄까지(정보 상자)
    const box = await p.evaluate(() => {
      const r = (el) => { const b = el.getBoundingClientRect(); return { x: b.x, y: b.y + scrollY, width: b.width, height: b.height }; };
      const poster = [...document.querySelectorAll('img')].find((i) => i.src.includes('show-poster'));
      const title = [...document.querySelectorAll('h1,h2')].find((h) => h.textContent.includes('빛의 결'));
      const loc = [...document.querySelectorAll('main *')].filter((e) => e.children.length === 0 && e.textContent.includes('아트링크 갤러리 (서울)'))[0];
      return { poster: r(poster), title: r(title), loc: r(loc) };
    });
    writeFileSync(`${OUT}/raw-show.json`, JSON.stringify(box));
  }
  await ctx.close();
  console.log('✓ 갤러리 홈페이지 · 전시', showId);
}
await b.close();
