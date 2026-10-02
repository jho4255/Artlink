/**
 * 홈페이지 편집 화면 — 화면 안에 들어오는가·눌리는가 (사용법은 README.md)
 *
 * E2E(크롬, 로직)가 못 보는 것만 잰다: **기하**와 **사파리 엔진**.
 *   ① 가입 직후 첫 화면에 [작품 사진 올리기] 가 들어와 있는가 (예전: PC 2,518px · 모바일 2,747px 아래)
 *   ② [저장] 을 누를 수 있는가 — 그 자리를 눌러 보면 저장 버튼이 잡히는가 (예전: 모바일에서 하단 탭바가 잡혔다)
 *   ③ 묶음마다 페이지가 가로로 밀리지 않는가
 *   ④ 작품 칸의 삭제 버튼이 44px 로 눌리는가 · 사진 위에 겹친 단추가 둘(삭제·좋아요) 이하인가
 *   ⑤ 묶음 탭이 스크롤해도 상단에 붙어 있는가 · 좁은 화면의 [미리보기] 시트가 열리는가
 *
 * 계정은 `backend/scripts/seed-nudge-demo.ts` 의 둘(작품 0점 / 일부만 채움)을 쓴다 — **로컬 데모 DB 전용**.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { chromium, webkit, devices } = require(path.resolve(__dirname, '../../e2e/node_modules/playwright'));

const BASE = process.env.BASE || 'http://localhost:5173';
const API = process.env.API || 'http://localhost:4000/api';
const OUT = path.join(__dirname, 'out');
const WEBKIT_RUN = path.join(process.env.HOME, '.cache/wk-deps/run.sh');
const BACKEND = path.resolve(__dirname, '../../backend');

/**
 * 계정을 심을 DB 주소 — `DEMO_DATABASE_URL` > `DATABASE_URL` > `backend/.env`.
 * ⚠️ 주소(비밀번호 포함)를 이 파일에 적지 않는다 — 배포 전 점검(scripts/predeploy-check.sh)이 접속정보 문자열을 막는다.
 * ⚠️ 이름에 prod 가 들어 있으면 멈춘다. `backend/.env` 가 실서버 복제본(artlink_prod)을 가리킬 때는
 *    `DEMO_DATABASE_URL=…localhost:5432/artlink` 로 데모 DB 를 넘겨 줄 것(백엔드도 같은 DB 로 떠 있어야 한다).
 */
function demoDbUrl() {
  const fromEnv = process.env.DEMO_DATABASE_URL || process.env.DATABASE_URL;
  if (fromEnv) return fromEnv;
  try {
    const m = fs.readFileSync(path.join(BACKEND, '.env'), 'utf8').match(/^DATABASE_URL=(.*)$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, '');
  } catch { /* 없으면 아래에서 멈춘다 */ }
  return '';
}
const DEMO_DB = demoDbUrl();

if (!DEMO_DB) { console.error('⛔ DB 주소를 찾지 못했습니다 — DEMO_DATABASE_URL 로 로컬 데모 DB 주소를 넘겨 주세요.'); process.exit(1); }
if (/artlink\.cc|onrender/.test(BASE + API) || /prod/i.test(DEMO_DB)) { console.error('⛔ 로컬 데모 DB 에서만 돌립니다(실서버·복제본 금지).'); process.exit(1); }

const SCREENS = {
  'PC 1280x800': { viewport: { width: 1280, height: 800 } },
  'PC 1440x900': { viewport: { width: 1440, height: 900 } },
  'iPad Mini 768': devices['iPad Mini'],
  'iPhone 13 390': devices['iPhone 13'],
  'iPhone SE 320': devices['iPhone SE'],
  'Galaxy 360': { viewport: { width: 360, height: 740 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  'Pixel 7 412': devices['Pixel 7'],
};
const SECTIONS = ['작품', '소개', '약력', '파일', '꾸미기'];

const seed = () => execSync('npx tsx scripts/seed-nudge-demo.ts', { cwd: BACKEND, env: { ...process.env, DATABASE_URL: DEMO_DB }, stdio: 'pipe' });
async function devLogin(email) {
  const r = await fetch(`${API}/auth/dev-login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
  if (!r.ok) throw new Error(`개발자 로그인 실패 ${email} ${r.status} — 백엔드가 데모 DB 로 떠 있는지, 계정이 심어졌는지 확인`);
  return r.json();
}
const storage = (acc) => ({ cookies: [], origins: [{ origin: BASE, localStorage: [{ name: 'artlink-auth', value: JSON.stringify({ state: { token: acc.token, user: acc.user, isAuthenticated: true }, version: 0 }) }] }] });

/** 그 요소의 한가운데를 눌렀을 때 정말 그 요소가 잡히는가 + 화면 안에 다 들어와 있는가 */
const hit = (page, selector, nth = 0) => page.evaluate(([sel, n]) => {
  const el = [...document.querySelectorAll(sel)][n];
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return {
    inView: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth,
    hit: !!top && (top === el || el.contains(top)),
    covered: top && !(top === el || el.contains(top)) ? `${top.tagName.toLowerCase()} "${(top.textContent || '').trim().slice(0, 14)}"` : null,
    y: Math.round(r.top), h: Math.round(r.height), w: Math.round(r.width),
  };
}, [selector, nth]);
const overflowX = (page) => page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - innerWidth));
const openSection = async (page, label) => {
  await page.getByRole('tablist', { name: '홈페이지 편집' }).getByRole('tab', { name: new RegExp(`^${label}`) }).click();
  await page.waitForTimeout(250);
};

(async () => {
  if (process.env.SHOTS) fs.mkdirSync(OUT, { recursive: true });
  seed();
  const empty = await devLogin('nudge.empty@demo.artlink.local');
  const partial = await devLogin('nudge.partial@demo.artlink.local');
  const rows = [];
  const fail = [];
  const check = (who, what, ok, detail) => { rows.push({ who, what, ok, detail }); if (!ok) fail.push(`✗ ${who} · ${what} — ${detail}`); };

  for (const [engName, eng, opts] of [['chromium', chromium, {}], ['webkit', webkit, { executablePath: WEBKIT_RUN }]]) {
    if (process.env.ENGINE && process.env.ENGINE !== engName) continue;
    if (engName === 'webkit' && !fs.existsSync(WEBKIT_RUN)) { console.log('WebKit 준비 안 됨 — bash scratchpad/hero/setup-webkit.sh'); process.exitCode = 1; continue; }
    const b = await eng.launch(opts);
    for (const [scrName, dev] of Object.entries(SCREENS)) {
      if (process.env.SCREEN && !scrName.includes(process.env.SCREEN)) continue;
      const { defaultBrowserType: _ignored, ...d } = dev;
      const who = `${engName} · ${scrName}`;
      const shot = async (page, name) => { if (process.env.SHOTS) await page.screenshot({ path: path.join(OUT, `${engName}-${scrName}-${name}`.replace(/[^\w가-힣.-]+/g, '_') + '.png') }); };

      // ── ① 작품 0점 작가의 첫 화면 ──
      {
        const ctx = await b.newContext({ ...d, storageState: storage(empty) });
        const p = await ctx.newPage();
        await p.goto(`${BASE}/mypage?tab=homepage-edit`);
        await p.locator('[data-testid="works-upload"] button').first().waitFor({ timeout: 20000 });
        await p.waitForTimeout(500);
        const up = await hit(p, '[data-testid="works-upload"] button');
        check(who, '① 첫 화면에 [작품 사진 올리기]', up.inView && up.hit, `y=${up.y} h=${up.h} 보임=${up.inView} 눌림=${up.hit}${up.covered ? ' 가림=' + up.covered : ''}`);
        const before = await p.evaluate(() => {
          const u = document.querySelector('[data-testid="works-upload"]').getBoundingClientRect().top;
          const main = document.querySelector('main');
          return [...main.querySelectorAll('input:not([type=file]):not([type=hidden]), textarea')].filter((e) => e.offsetParent && e.getBoundingClientRect().top < u).length;
        });
        check(who, '① 올리기 앞에 입력칸 0개', before === 0, `${before}개`);
        check(who, '① 가로 넘침 없음', (await overflowX(p)) <= 1, `${await overflowX(p)}px`);
        await shot(p, '0점-첫화면');
        await ctx.close();
      }

      // ── ②~⑤ 일부만 채운 작가 ──
      {
        const ctx = await b.newContext({ ...d, storageState: storage(partial) });
        const p = await ctx.newPage();
        await p.goto(`${BASE}/mypage?tab=homepage-edit`);
        await p.locator('[data-testid="works-grid"] li').first().waitFor({ timeout: 20000 });
        await p.waitForTimeout(600);
        await shot(p, '작품');

        // ④ 작품 칸
        const tile = await p.evaluate(() => {
          const li = document.querySelector('[data-testid="works-grid"] li');
          const photo = li.querySelector('button').getBoundingClientRect();
          const over = [...li.querySelectorAll('button')].slice(1).filter((bt) => {
            const r = bt.getBoundingClientRect();
            return r.top < photo.bottom - 1 && r.bottom > photo.top + 1 && r.left < photo.right - 1 && r.right > photo.left + 1;
          });
          const del = li.querySelector('button[aria-label="작품 사진 삭제"]').getBoundingClientRect();
          return { w: Math.round(photo.width), overlapping: over.map((bt) => bt.getAttribute('aria-label') || bt.textContent.trim()), del: `${Math.round(del.width)}x${Math.round(del.height)}`, delOk: del.width >= 44 && del.height >= 44 };
        });
        check(who, '④ 사진 위에 겹친 단추는 삭제뿐(좋아요 0)', tile.overlapping.length <= 1, `${tile.overlapping.join(', ') || '없음'} · 칸 ${tile.w}px`);
        check(who, '④ 삭제 버튼 44px', tile.delOk, tile.del);
        // 칸을 화면 가운데로 올린 뒤에 눌러 본다(첫 화면 아래에 있을 수 있다)
        await p.evaluate(() => document.querySelector('[data-testid="works-grid"] li').scrollIntoView({ block: 'center' }));
        await p.waitForTimeout(250);
        const delHit = await hit(p, '[data-testid="works-grid"] li button[aria-label="작품 사진 삭제"]');
        check(who, '④ 삭제 버튼이 눌린다', delHit.inView && delHit.hit, delHit.covered ? '가림=' + delHit.covered : `보임=${delHit.inView}`);
        await p.evaluate(() => document.querySelector('[data-testid="works-grid"] li button[aria-pressed]').scrollIntoView({ block: 'center' }));
        await p.waitForTimeout(200);
        const chip = await hit(p, '[data-testid="works-grid"] li button[aria-pressed]');
        check(who, '④ [홈페이지에만] 단추가 눌린다', chip.inView && chip.hit && chip.h >= 32, `h=${chip.h}${chip.covered ? ' 가림=' + chip.covered : ''}`);
        await p.evaluate(() => scrollTo(0, 0));
        await p.waitForTimeout(200);
        // 첫 화면에서 지금 할 일(작품 정보 입력하기)이 보이는가
        const task = await hit(p, '[data-task-line]');
        check(who, '① 첫 화면에 [작품 정보 입력하기]', !!task && task.inView && task.hit, task ? `y=${task.y}${task.covered ? ' 가림=' + task.covered : ''}` : '없음');

        // ③ 묶음마다 가로 넘침
        for (const label of SECTIONS) {
          await openSection(p, label);
          const o = await overflowX(p);
          check(who, `③ [${label}] 가로 넘침 없음`, o <= 1, `${o}px`);
          if (label !== '작품') await shot(p, label);
        }

        // ② 저장 — 글을 고친 뒤 화면 어디서든 눌리는가
        await openSection(p, '약력');
        await p.locator('#hpe-field-biography').fill('홍익대학교 회화과 졸업\n2024 개인전 〈머무는 빛〉, 서울\n하니스가 고친 줄');
        await p.waitForTimeout(250);
        const pageH = await p.evaluate(() => document.documentElement.scrollHeight);
        for (const [nm, y] of [['맨 위', 0], ['가운데', Math.round(pageH / 2)], ['맨 끝', pageH]]) {
          await p.evaluate((yy) => scrollTo(0, yy), y);
          await p.waitForTimeout(300);
          const s = await hit(p, '[data-save-bar] button.bg-gray-900');
          check(who, `② [저장] 이 눌린다 (${nm})`, !!s && s.inView && s.hit, s ? `y=${s.y} 보임=${s.inView} 눌림=${s.hit}${s.covered ? ' 가림=' + s.covered : ''}` : '저장 버튼 없음');
        }
        await p.evaluate(() => scrollTo(0, 0));
        await shot(p, '저장바');

        // ⑤ 묶음 탭이 스크롤해도 붙어 있다
        await p.evaluate(() => scrollTo(0, 600));
        await p.waitForTimeout(300);
        const tabs = await p.evaluate(() => { const t = document.querySelector('[role=tablist][aria-label="홈페이지 편집"]'); const r = t.getBoundingClientRect(); return { top: Math.round(r.top), inView: r.top >= 0 && r.bottom <= innerHeight }; });
        check(who, '⑤ 묶음 탭이 붙어 있다', tabs.inView && tabs.top <= 90, `top=${tabs.top}`);
        await p.evaluate(() => scrollTo(0, 0));

        // ⑤ 미리보기 — 좁은 화면은 시트, 넓은 화면은 옆
        const vw = await p.evaluate(() => innerWidth);
        if (vw < 1024) {
          await p.locator('[data-save-bar]').getByRole('button', { name: '미리보기' }).click();
          const sheet = p.locator('[data-testid="preview-sheet"]');
          await sheet.waitFor({ timeout: 5000 });
          const name = await sheet.locator('h1').first().innerText();
          check(who, '⑤ [미리보기] 시트', /팝업확인 일부채움/.test(name), name);
          await shot(p, '미리보기시트');
          await sheet.getByRole('button', { name: '미리보기 닫기' }).click();
        } else {
          const side = await p.evaluate(() => { const a = document.querySelector('aside[aria-label="홈페이지 미리보기"]'); if (!a) return null; const r = a.getBoundingClientRect(); return r.width > 200 && r.right <= innerWidth + 1; });
          check(who, '⑤ 옆 미리보기', !!side, String(side));
        }
        await ctx.close();
      }
    }
    await b.close();
  }

  // 요약
  const byWhat = new Map();
  for (const r of rows) { const k = r.what.replace(/\s*\(.*\)$/, ''); const v = byWhat.get(k) || { ok: 0, n: 0 }; v.n += 1; if (r.ok) v.ok += 1; byWhat.set(k, v); }
  for (const [k, v] of byWhat) console.log(`${v.ok === v.n ? '✓' : '✗'} ${k.padEnd(34)} ${v.ok}/${v.n}`);
  fail.forEach((f) => console.log(f));
  console.log(`\n${rows.length}개 확인 · 실패 ${fail.length}건`);
  seed();   // 하니스가 고친 글을 되돌린다
  if (fail.length) process.exitCode = 1;
})().catch((e) => { console.error(e); process.exit(1); });
