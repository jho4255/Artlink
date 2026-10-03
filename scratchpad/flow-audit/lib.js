// 공모 흐름 점검 하니스 (2026-10-03) — 데모 DB(5183 → 4001) 전용.
//   cd e2e && node ../scratchpad/flow-audit/<script>.js
const path = require('path');
const fs = require('fs');
const { chromium, webkit } = require(path.resolve(__dirname, '../../e2e/node_modules/@playwright/test'));

const BASE = process.env.BASE || 'http://localhost:5183';
const API = process.env.API || 'http://localhost:4001/api';
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

const SCREENS = {
  pc: { viewport: { width: 1280, height: 800 } },
  mobile: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' },
  small: { viewport: { width: 360, height: 640 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
};

const EMAILS = { artist: 'artist1@artlink.com', artist2: 'artist2@artlink.com', gallery: 'gallery@artlink.com', admin: 'admin@artlink.com' };
const cache = {};
async function login(role) {
  if (cache[role]) return cache[role];
  const email = EMAILS[role] || role;
  const r = await fetch(`${API}/auth/dev-login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
  if (!r.ok) throw new Error(`dev-login 실패(${email}): ${r.status} ${await r.text()}`);
  return (cache[role] = await r.json());
}
async function api(role, method, url, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (role) headers.Authorization = `Bearer ${(await login(role)).token}`;
  const r = await fetch(`${API}${url}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, body: json };
}

/** 역할·화면별 페이지. 콘솔 오류·실패한 요청을 모은다 */
async function open(browser, role, screen = 'pc') {
  const opts = { ...SCREENS[screen], baseURL: BASE, locale: 'ko-KR', timezoneId: 'Asia/Seoul' };
  if (role) {
    const { token, user } = await login(role);
    opts.storageState = { cookies: [], origins: [{ origin: BASE, localStorage: [{ name: 'artlink-auth', value: JSON.stringify({ state: { token, user, isAuthenticated: true }, version: 0 }) }] }] };
  }
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  const log = { console: [], failed: [], pageErrors: [] };
  page.on('console', (m) => { if (m.type() === 'error') log.console.push(m.text().slice(0, 300)); });
  page.on('pageerror', (e) => log.pageErrors.push(String(e).slice(0, 300)));
  page.on('response', (r) => { if (r.status() >= 400 && r.url().includes('/api/')) log.failed.push(`${r.status()} ${r.request().method()} ${r.url().replace(BASE, '')}`); });
  page.__log = log; page.__screen = screen; page.__role = role;
  return { ctx, page, log };
}

/** 지금 화면의 기하 측정 — 가로 넘침 · 작은 누르는 곳 · 작은 글자 · 화면 밖으로 잘린 것 */
async function measure(page) {
  return page.evaluate(() => {
    const vw = window.innerWidth, vh = window.innerHeight;
    const doc = document.documentElement;
    const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05; };
    const label = (el) => (el.getAttribute('aria-label') || el.innerText || el.getAttribute('title') || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 30);
    const small = [];
    for (const el of document.querySelectorAll('button, a[href], input[type=checkbox], input[type=radio], select, [role=button], [role=tab]')) {
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.bottom < 0 || r.top > doc.scrollHeight) continue;
      // 체크박스·라디오는 감싼 label 이 누르는 곳이다
      let w = r.width, h = r.height;
      const lab = el.closest('label');
      if (lab) { const lr = lab.getBoundingClientRect(); w = Math.max(w, lr.width); h = Math.max(h, lr.height); }
      if (Math.min(w, h) < 32) small.push(`${label(el)}(${Math.round(w)}×${Math.round(h)})`);
    }
    const tiny = new Set();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const n = walker.currentNode; if (!n.nodeValue.trim()) continue;
      const el = n.parentElement; if (!el || !visible(el)) continue;
      if (el.closest('[data-scaled-page]')) continue;
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs < 12) tiny.add(`${n.nodeValue.trim().slice(0, 16)}(${fs}px)`);
    }
    const clipped = [];
    for (const el of document.querySelectorAll('body *')) {
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.right > vw + 2 && r.left < vw && r.width < vw * 2) {
        // 가로 스크롤 상자 안의 것은 의도일 수 있다
        let p = el.parentElement, scroller = false;
        while (p && p !== document.body) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden') { scroller = true; break; } p = p.parentElement; }
        if (!scroller) clipped.push(`${el.tagName}.${(el.className || '').toString().slice(0, 30)}:${label(el)}→${Math.round(r.right)}`);
      }
    }
    return {
      url: location.pathname + location.search,
      overflowX: doc.scrollWidth - vw,
      height: doc.scrollHeight, vh,
      small: small.slice(0, 12), smallCount: small.length,
      tiny: [...tiny].slice(0, 12), tinyCount: tiny.size,
      clipped: clipped.slice(0, 6),
    };
  });
}

let shotNo = 0;
async function shot(page, name, { full = true } = {}) {
  const file = path.join(OUT, `${String(++shotNo).padStart(2, '0')}-${name}-${page.__role || 'guest'}-${page.__screen}.png`);
  await page.screenshot({ path: file, fullPage: full }).catch((e) => console.log('shot 실패', e.message));
  return file;
}
/** 한 지점 기록 — 스크린샷 + 측정 + 그동안 쌓인 오류 */
async function mark(page, name, opts) {
  await page.waitForTimeout(500);
  const file = await shot(page, name, opts);
  const m = await measure(page);
  const log = page.__log;
  const issues = [];
  if (m.overflowX > 1) issues.push(`가로 넘침 ${m.overflowX}px`);
  if (m.clipped.length) issues.push(`잘림: ${m.clipped.join(' | ')}`);
  if (m.smallCount) issues.push(`작은 버튼 ${m.smallCount}: ${m.small.join(', ')}`);
  if (m.tinyCount) issues.push(`작은 글자 ${m.tinyCount}: ${m.tiny.join(', ')}`);
  if (log.console.length) issues.push(`콘솔 오류: ${[...new Set(log.console)].slice(0, 4).join(' | ')}`);
  if (log.pageErrors.length) issues.push(`페이지 오류: ${log.pageErrors.join(' | ')}`);
  if (log.failed.length) issues.push(`실패 요청: ${[...new Set(log.failed)].join(' | ')}`);
  log.console.length = 0; log.pageErrors.length = 0; log.failed.length = 0;
  console.log(`\n■ ${path.basename(file)}  [${m.url}]  높이 ${m.height}px`);
  for (const i of issues) console.log(`   · ${i}`);
  return { file, m, issues };
}
/** 그 자리를 눌렀을 때 실제로 무엇이 잡히는가 */
async function hit(page, locator) {
  const box = await locator.boundingBox();
  if (!box) return { ok: false, why: '없음' };
  const vp = page.viewportSize();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  if (y < 0 || y > vp.height || x < 0 || x > vp.width) return { ok: false, why: `화면 밖(${Math.round(x)},${Math.round(y)})` };
  const handle = await locator.elementHandle();
  const same = await page.evaluate(([x, y, el]) => { const t = document.elementFromPoint(x, y); return !!t && (t === el || el.contains(t) || t.contains(el)) ? true : (t ? (t.innerText || t.tagName).slice(0, 30) : 'null'); }, [x, y, handle]);
  return same === true ? { ok: true } : { ok: false, why: `다른 것이 잡힘: ${same}` };
}

module.exports = { chromium, webkit, BASE, API, OUT, SCREENS, login, api, open, measure, shot, mark, hit };
