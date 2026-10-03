/**
 * 포트폴리오 만들기 화면 — 화면 안에 들어오는가 · 눌리는가 · 가려지지 않는가 (사용법은 README.md)
 *
 * E2E(`e2e/tests/64-portfolio-maker.spec.ts`)는 크롬 한 엔진·한 화면으로 **로직**(눌러서 무슨 일이 나는가)을 본다.
 * 여기는 **기하**(가림·넘침·sticky·누르는 곳 크기·글자 크기)와 **사파리 엔진**을 본다.
 *   ① 첫 화면에 내 PDF(표지)가 보이고 [PDF 저장] 이 눌린다          (예전: PC 미리보기 y894·저장 y856, 휴대폰 미리보기 y1375)
 *   ② 아래 바가 어디까지 내려 봐도 붙어 있고 한 줄이다                 (예전: 저장 버튼이 설정 묶음 아래에 한 번 나왔다)
 *   ③ 꾸미기를 열면 그 묶음이 바꾸는 쪽이 통째로 보인다                (예전: 휴대폰에서 표지를 골라도 화면 안 미리보기 0쪽)
 *   ④ 꾸미기의 스크롤은 하나, 높이가 넉넉하다                          (예전: 1,126px 내용이 PC 420px · SE 188px 상자)
 *   ⑤ 누르는 곳이 작지 않다 · 글자가 12px 아래로 내려가지 않는다       (예전: 16~28px 단추, 글자의 47% 가 11px 이하)
 *   ⑥ 저장 창·작품 고르기·크게 보기가 화면 안에 들어오고 주 버튼이 눌린다
 *   ⑦ 들어올 때 원본 사진을 받지 않는다(800px 썸네일)                  (예전: 8점 5.7MB · 30점 23.5MB)
 *
 * 계정: 작품 0점(`seed-nudge-demo.ts`) + 하니스가 직접 만드는 작품 12점 작가(진짜 업로드 — 썸네일이 있어야 ⑦ 을 잴 수 있다).
 * **로컬 데모 DB 전용.** 디자인 저장(PUT /portfolio/design)은 가로채 DB 를 바꾸지 않는다.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium, webkit, devices } = require(path.resolve(__dirname, '../../e2e/node_modules/playwright'));

const BASE = process.env.BASE || 'http://localhost:5173';
const API = process.env.API || 'http://localhost:4000/api';
const OUT = path.join(__dirname, 'out');
const WEBKIT_RUN = path.join(process.env.HOME, '.cache/wk-deps/run.sh');
const BACKEND = path.resolve(__dirname, '../../backend');

/**
 * 계정을 심을 DB 주소 — `DEMO_DATABASE_URL` > `DATABASE_URL` > `backend/.env`.
 * ⚠️ 주소(비밀번호 포함)를 이 파일에 적지 않는다 — 배포 전 점검(scripts/predeploy-check.sh)이 접속정보 문자열을 막는다.
 * ⚠️ 이름에 prod 가 들어 있으면 멈춘다(실서버 복제본).
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
  'PC 1024x768': { viewport: { width: 1024, height: 768 } },   // 꾸미기 패널이 옆에 붙는 가장 좁은 폭
  'iPad Mini 768': devices['iPad Mini'],
  'iPhone 13 390': devices['iPhone 13'],
  'iPhone SE 320': devices['iPhone SE'],
  'Galaxy 360': { viewport: { width: 360, height: 740 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  'Pixel 7 412': devices['Pixel 7'],
};
/** 편집 탭과 그 탭이 고치는 쪽(미리보기가 데려가야 할 쪽). 색·글꼴은 모든 쪽이라 보던 자리에 둔다 */
const TABS = [
  ['표지', '[data-page-kind="cover"]'], ['작품', '[data-page-kind="works"]'], ['약력', '[data-page-part="statement"]'],
  ['색·글꼴', null], ['이름·연락처', '[data-page-kind="contact"]'],
];
/** 누르는 곳의 하한(px) — 가로·세로 모두. 예전 화면의 단추는 16~28px 이었다 */
const TAP_MIN = 40;
/** 화면 글자의 하한(px). 예전 화면은 글자의 47% 가 11px 이하였다(표지·배치 이름은 9px) */
const TEXT_MIN = 12;

// ── 계정 ─────────────────────────────────────────────────────────────────
const WALK = { email: 'maker.walk@demo.artlink.local', name: '하니스 서하늘', nick: 'walk_studio', password: 'MakerWalk1!' };
const json = { 'Content-Type': 'application/json' };
async function call(method, url, token, body) {
  const r = await fetch(`${API}${url}`, { method, headers: { ...json, ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: r.ok, status: r.status, data };
}
async function devLogin(email) {
  const r = await call('POST', '/auth/dev-login', null, { email });
  return r.ok ? r.data : null;
}
const WORKS = [
  [1200, 1600, '#223a5e', '#d67a3c'], [1600, 1200, '#782832', '#ecd6aa'], [1400, 1400, '#285a46', '#e6c85a'], [1000, 1600, '#463c6e', '#f0aa96'],
  [1600, 800, '#1f4d5c', '#e9b872'], [1300, 1600, '#5c2e46', '#9fc2b2'], [1600, 1100, '#2f3b2a', '#d9a05b'], [1500, 1500, '#6b3a2a', '#cfd8dc'],
  [1100, 1600, '#243b55', '#e8998d'], [1600, 1000, '#3d2c5e', '#f2d16b'], [1200, 1500, '#444444', '#c9c2b6'], [1600, 1300, '#7a4b1e', '#a7c4d6'],
];
/** 절차적으로 그린 색면 + 잡음(실제 사진처럼 압축이 덜 되게) — 실제 작가 작품이 아니다 */
async function paint([w, h, a, b]) {
  const sharp = require(path.join(BACKEND, 'node_modules/sharp'));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>
    <rect width="${w}" height="${h}" fill="url(#g)"/>
    <ellipse cx="${w * 0.34}" cy="${h * 0.4}" rx="${w * 0.3}" ry="${h * 0.16}" fill="${b}" opacity="0.55"/>
    <ellipse cx="${w * 0.66}" cy="${h * 0.68}" rx="${w * 0.24}" ry="${h * 0.2}" fill="${a}" opacity="0.5"/>
    <rect x="${w * 0.12}" y="${h * 0.8}" width="${w * 0.5}" height="${h * 0.035}" fill="${b}" opacity="0.7"/></svg>`;
  const noise = await sharp({ create: { width: w, height: h, channels: 3, background: '#808080', noise: { type: 'gaussian', mean: 128, sigma: 26 } } }).png().toBuffer();
  return sharp(Buffer.from(svg)).composite([{ input: noise, blend: 'soft-light' }]).jpeg({ quality: 88 }).toBuffer();
}
/** 경력 — 항목마다 { year, content }(문자열 배열이 아니다 — 그러면 엔진이 한 줄도 못 찍는다). 키는 Career 타입 그대로(artFair) */
const WALK_CAREER = {
  education: [{ year: '2020', content: '홍익대학교 회화과 졸업' }],
  solo: [{ year: '2024', content: '〈머무는 빛〉, 갤러리 온, 서울' }, { year: '2022', content: '〈오후 네 시〉, 스페이스 결, 서울' }],
  group: [{ year: '2023', content: '〈낮은 지평〉, 부산시립미술관, 부산' }, { year: '2022', content: '〈겨울 정원〉, 아트스페이스 휴, 파주' }],
  artFair: [{ year: '2024', content: '화랑미술제, 코엑스, 서울' }],
  award: [{ year: '2023', content: '신진작가 지원 선정' }],
};
/** 작품 12점 작가 — 없으면 만든다(가입 → 진짜 업로드). 있으면 그대로 쓴다 */
async function ensureWalkArtist() {
  let acc = await devLogin(WALK.email);
  if (!acc) {
    const r = await call('POST', '/auth/signup', null, { name: WALK.name, email: WALK.email, password: WALK.password, role: 'ARTIST', agreeTerms: true, agreePrivacy: true });
    if (!r.ok) throw new Error(`하니스 작가 가입 실패 ${r.status}: ${JSON.stringify(r.data).slice(0, 200)}`);
    acc = r.data;
  }
  const t = acc.token;
  let pf = (await call('GET', '/portfolio', t)).data;
  const have = (pf.images || []).length;
  for (let i = have; i < WORKS.length; i++) {
    const buf = await paint(WORKS[i]);
    const fd = new FormData();
    fd.append('image', new Blob([buf], { type: 'image/jpeg' }), `walk-${i + 1}.jpg`);
    const up = await fetch(`${API}/upload/image`, { method: 'POST', headers: { Authorization: `Bearer ${t}` }, body: fd });
    if (!up.ok) throw new Error(`사진 올리기 실패 ${up.status}: ${(await up.text()).slice(0, 200)}`);
    const { url } = await up.json();
    // 앞의 9점만 작품 정보가 있다 — 나머지 3점 때문에 머리에 '작품 정보 채우기' 줄이 뜬다(첫 화면이 가장 길어지는 경우)
    const meta = i < 9 ? { title: ['머무는 빛', '오후 네 시', '겨울 정원', '물의 기억', '낮은 지평', '붉은 언덕', '저녁의 결', '흰 그늘', '먼 곳'][i], medium: 'Oil on canvas', year: String(2026 - (i % 4)), sizeText: '72.7 × 60.6 cm' } : {};
    const r = await call('POST', '/portfolio/images', t, { url, ...meta });
    if (!r.ok) throw new Error(`작품 추가 실패 ${r.status}: ${JSON.stringify(r.data).slice(0, 200)}`);
  }
  if (have < WORKS.length) {
    await call('PUT', '/auth/me/nickname', t, { nickname: WALK.nick });
    await call('PUT', '/auth/me/profile', t, { email: WALK.email, phone: '010-0000-0000', instagramUrl: 'https://instagram.com/walk_studio' });
    await call('PUT', '/portfolio', t, {
      tagline: '겹쳐 칠한 색으로 머무는 시간을 그립니다',
      statement: '겹쳐진 색층은 한 번에 읽히지 않는다. 나는 같은 자리를 여러 번 지나가며 남은 흔적을 쌓는다.\n\n화면은 풍경처럼 보이지만 실제 장소가 아니다. 오래 본 것들이 섞여 만들어진, 기억의 온도에 가까운 색이다.\n\n그림 앞에 선 사람이 잠시 머물다 가기를 바란다.',
      biography: '홍익대학교 회화과 졸업\n2024 개인전 〈머무는 빛〉, 서울\n2023 단체전 〈낮은 지평〉, 부산',
      career: WALK_CAREER,
    });
  }
  // 첫 판이 경력을 잘못된 형식(문자열 배열)으로 심었다 — 이미 있는 계정도 바로잡는다
  pf = (await call('GET', '/portfolio', t)).data;
  if (!pf.career || !Array.isArray(pf.career.solo) || !pf.career.solo.length || typeof pf.career.solo[0] !== 'object') {
    await call('PUT', '/portfolio', t, { tagline: pf.tagline, statement: pf.statement, biography: pf.biography || '홍익대학교 회화과 졸업', career: WALK_CAREER });
  }
  // 하니스는 디자인을 바꾸지 않지만(가로챈다), 손으로 만져 둔 값이 남아 있으면 측정이 달라진다 — 처음 모양으로
  await call('PUT', '/portfolio/design', t, { designConfig: null });
  acc = await devLogin(WALK.email);
  pf = (await call('GET', '/portfolio', acc.token)).data;
  return { acc, works: pf.images.length };
}
const storage = (acc) => ({ cookies: [], origins: [{ origin: BASE, localStorage: [{ name: 'artlink-auth', value: JSON.stringify({ state: { token: acc.token, user: acc.user, isAuthenticated: true }, version: 0 }) }] }] });

// ── 재는 도구(브라우저 안에서 돈다) ───────────────────────────────────────
/** 그 요소의 한가운데를 눌렀을 때 정말 그 요소가 잡히는가 + 화면 안에 다 들어와 있는가 */
const probe = async (loc) => {
  if ((await loc.count()) === 0) return null;
  return loc.first().evaluate((el) => {
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    const ok = !!top && (top === el || el.contains(top));
    return {
      inView: r.top >= -0.5 && r.bottom <= innerHeight + 0.5 && r.left >= -0.5 && r.right <= innerWidth + 0.5,
      hit: ok,
      covered: !ok && top ? `${top.tagName.toLowerCase()} "${(top.textContent || '').trim().slice(0, 14)}"` : null,
      y: Math.round(r.top), b: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height),
    };
  });
};
const fmt = (m) => (m ? `y=${m.y} ${m.w}×${m.h} 보임=${m.inView} 눌림=${m.hit}${m.covered ? ' 가림=' + m.covered : ''}` : '없음');
const overflowX = (page) => page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - innerWidth));
/** 그 영역 안의 화면 글자 가운데 TEXT_MIN 보다 작은 것 — 줄여 그린 지면(data-scaled-page) 안은 세지 않는다 */
const smallText = (page, rootSel, min) => page.evaluate(([sel, lim]) => {
  const out = []; let total = 0;
  for (const root of document.querySelectorAll(sel)) {
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = tw.nextNode())) {
      const t = n.nodeValue.trim();
      const el = n.parentElement;
      if (!t || !el || el.closest('[data-scaled-page]')) continue;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (cs.visibility === 'hidden' || r.width === 0 || r.height === 0) continue;
      total++;
      const fs = parseFloat(cs.fontSize);
      if (fs < lim) out.push(`${fs}px "${t.slice(0, 10)}"`);
    }
  }
  return { total, small: out };
}, [rootSel, min]);
/**
 * 그 영역 안의 누르는 곳 가운데 TAP_MIN 보다 작은 것.
 * 체크박스·라디오는 감싼 label 이 누르는 곳이다. 슬라이더는 손잡이를 끄는 것이라 높이만 본다(24px).
 * 문장 안의 글자 단추(예: "… · 다시 내려받기")는 줄 높이를 따르므로 따로 센다 — `inline` 으로 돌려준다.
 */
const tapTargets = (page, rootSel, min) => page.evaluate(([sel, lim]) => {
  const bad = []; const inline = []; let total = 0; let smallest = 999;
  const seen = new Set();
  for (const root of document.querySelectorAll(sel)) {
    for (const raw of root.querySelectorAll('button, a[href], [role=tab], input, select, textarea')) {
      if (raw.disabled) continue;
      let el = raw;
      const type = raw.getAttribute('type');
      if (raw.tagName === 'INPUT' && (type === 'checkbox' || type === 'radio')) el = raw.closest('label') || raw;
      if (seen.has(el)) continue;
      seen.add(el);
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden') continue;
      total++;
      const name = (el.getAttribute('aria-label') || el.textContent || type || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 16);
      const w = Math.round(r.width), h = Math.round(r.height);
      if (type === 'range') { if (h < 24) bad.push(`${name} 슬라이더 ${w}×${h}`); continue; }
      // 문장 안에 놓인 링크(예: "… — 프로필에서 입력")는 줄 높이를 따른다 — 따로 센다
      if (cs.display === 'inline') { inline.push(`${name} ${w}×${h}`); continue; }
      smallest = Math.min(smallest, w, h);
      if (w < lim || h < lim) bad.push(`${name} ${w}×${h}`);
    }
  }
  return { total, smallest, bad, inline };
}, [rootSel, min]);
/** 스크롤이 멎을 때까지 — 부드러운 스크롤(scrollIntoView smooth)은 엔진마다 걸리는 시간이 다르다 */
async function settle(page, ms = 250) {
  let last = -1; let same = 0;
  for (let i = 0; i < 40; i++) {
    const y = await page.evaluate(() => Math.round(scrollY));
    if (y === last) { same++; if (same >= 3) return; } else { same = 0; last = y; }
    await page.waitForTimeout(ms / 3);
  }
}
/** 그 쪽(지면)이 위 한계와 아래 한계 사이에 통째로 들어와 있는가 */
const pageInBand = (page, sel, top, bottom) => page.evaluate(([k, t, b]) => {
  const items = [...document.querySelectorAll(k ? `[data-book-preview] ${k}` : '[data-page-index]')];
  const boxes = items.map((it) => it.querySelector('[data-scaled-page]').getBoundingClientRect());
  const fits = (r) => r.top >= t - 1 && r.bottom <= b + 1;
  const best = k ? boxes[0] : boxes.find(fits) || boxes[0];
  return best ? { ok: fits(best), y: Math.round(best.top), b: Math.round(best.bottom), w: Math.round(best.width), h: Math.round(best.height) } : null;
}, [sel, top, bottom]);

(async () => {
  if (process.env.SHOTS) fs.mkdirSync(OUT, { recursive: true });
  // 작품 0점 계정 — 데모 DB 에 직접 심는다. 백엔드가 같은 DB 로 떠 있지 않으면 여기서 멈춘다(복제본에 가짜 계정을 만들지 않는다)
  execFileSync('npx', ['tsx', 'scripts/seed-nudge-demo.ts'], { cwd: BACKEND, env: { ...process.env, DATABASE_URL: DEMO_DB }, stdio: 'pipe' });
  const empty = await devLogin('nudge.empty@demo.artlink.local');
  if (!empty) { console.error('⛔ 백엔드가 데모 DB 로 떠 있지 않습니다(방금 심은 계정이 안 보인다). 백엔드를 DATABASE_URL=…/artlink 로 띄워 주세요.'); process.exit(1); }
  const { acc: walk, works } = await ensureWalkArtist();
  console.log(`계정 준비 — 작품 0점 · 작품 ${works}점(${WALK.email})`);

  const rows = [];
  const fail = [];
  const notes = [];
  const check = (who, what, ok, detail) => { rows.push({ who, what, ok, detail }); if (!ok) fail.push(`✗ ${who} · ${what} — ${detail}`); };

  for (const [engName, eng, opts] of [['chromium', chromium, {}], ['webkit', webkit, { executablePath: WEBKIT_RUN }]]) {
    if (process.env.ENGINE && process.env.ENGINE !== engName) continue;
    if (engName === 'webkit' && !fs.existsSync(WEBKIT_RUN)) { console.log('WebKit 준비 안 됨 — bash scratchpad/hero/setup-webkit.sh'); process.exitCode = 1; continue; }
    const b = await eng.launch(opts);
    for (const [scrName, dev] of Object.entries(SCREENS)) {
      if (process.env.SCREEN && !scrName.includes(process.env.SCREEN)) continue;
      const { defaultBrowserType: _ignored, ...d } = dev;
      const who = `${engName} · ${scrName}`;
      const wide = d.viewport.width >= 1024;
      const navH = wide ? 80 : 64;
      const shot = async (page, name) => { if (process.env.SHOTS) await page.screenshot({ path: path.join(OUT, `${engName}-${scrName}-${name}`.replace(/[^\w가-힣.-]+/g, '_') + '.png') }); };
      const prep = async (acc) => {
        const ctx = await b.newContext({ ...d, storageState: storage(acc) });
        const p = await ctx.newPage();
        await p.route('**/api/visits', (q) => q.fulfill({ status: 204, body: '' }));
        // 디자인 저장은 가로챈다 — 하니스가 DB 를 바꾸지 않게(보낸 값을 그대로 돌려준다)
        await p.route('**/api/portfolio/design', (q) => q.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ designConfig: (q.request().postDataJSON() || {}).designConfig ?? null }) }));
        const errs = [];
        p.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));
        return { ctx, p, errs };
      };

      // ── 작품 0점 ──
      {
        const { ctx, p, errs } = await prep(empty);
        await p.goto(`${BASE}/mypage?tab=portfolio`);
        await p.locator('[data-testid="portfolio-maker-empty"]').waitFor({ timeout: 30000 });
        await p.waitForTimeout(400);
        const up = await probe(p.locator('[data-testid="portfolio-maker-empty"] a', { hasText: '작품 올리기' }));
        check(who, '⓪ 작품 0점 — 첫 화면에 [작품 올리기]', !!up && up.inView && up.hit, fmt(up));
        check(who, '⓪ 가로 넘침 없음', (await overflowX(p)) <= 1, `${await overflowX(p)}px`);
        check(who, '⓪ 화면 오류 없음', errs.length === 0, errs.join(' | ') || '0건');
        await shot(p, '0점');
        await ctx.close();
      }

      // ── 작품 12점 ──
      const { ctx, p, errs } = await prep(walk);
      const imgs = [];
      p.on('response', (res) => {
        const u = res.url();
        if (!/\/uploads\//.test(u) || !/\.(jpe?g|png|webp)(\?|$)/i.test(u)) return;
        imgs.push({ u, len: Number(res.headers()['content-length'] || 0), thumb: /\/t(240|800)\//.test(u), status: res.status() });
      });
      const t0 = Date.now();
      await p.goto(`${BASE}/mypage?tab=portfolio`);
      await p.locator('[data-page-index="0"] [data-scaled-page]').waitFor({ timeout: 30000 });
      const firstPaint = Date.now() - t0;
      await p.waitForFunction(() => [...document.querySelectorAll('[data-page-index="0"] img')].every((im) => im.complete && im.naturalWidth > 0), null, { timeout: 15000 }).catch(() => {});
      await p.waitForLoadState('networkidle').catch(() => {});
      await p.waitForTimeout(500);
      await shot(p, '첫화면');
      const bar = p.locator('[data-maker-bar]');
      const saveBtn = bar.locator('button', { hasText: 'PDF 저장' });
      const customizeBtn = bar.locator('button', { hasText: '꾸미기' });
      const pickBtn = bar.locator('button', { hasText: '작품 고르기' });

      // ① 첫 화면
      const first = await p.evaluate((nav) => {
        const pg = document.querySelector('[data-page-index="0"] [data-scaled-page]').getBoundingClientRect();
        const br = document.querySelector('[data-maker-bar]').getBoundingClientRect();
        const st = document.querySelector('[data-testid="maker-status"]').getBoundingClientRect();
        return { pageY: Math.round(pg.top), pageW: Math.round(pg.width), pageH: Math.round(pg.height), visible: Math.round(Math.min(pg.bottom, br.top) - Math.max(pg.top, nav)), barY: Math.round(br.top), barH: Math.round(br.height), statusY: Math.round(st.top), vh: innerHeight };
      }, navH);
      // ⚠️ 첫 화면의 표지 — 2026-10-03 사용자 결정 셋(편집 탭 줄을 늘 보이게 · 용지를 맨 위로 · 디자인 여섯을 3×2 로)의 대가로
      //    휴대폰에서는 표지가 거의 아래로 밀렸다. 사용자가 그걸 알고 골랐다(아이폰 13 109px → 약 40px 로 줄어든다고 묻고 정했다).
      //    그래서 휴대폰(넓이 1024 미만)은 판정하지 않고 값만 적는다. **PC 는 그대로 90px 이상** — 넓은 화면은 여유가 있다.
      if (wide) check(who, '① 첫 화면에 표지(미리보기)가 보인다', first.visible >= 90, `표지 y=${first.pageY} · 바 위로 ${first.visible}px 보임 · 쪽 ${first.pageW}×${first.pageH} (화면 ${first.vh})`);
      const save0 = await probe(saveBtn);
      check(who, '① 첫 화면에서 [PDF 저장] 이 눌린다', !!save0 && save0.inView && save0.hit, fmt(save0));
      const pick0 = await probe(pickBtn);
      check(who, '① [작품 고르기] 가 눌린다', !!pick0 && pick0.hit && pick0.inView, fmt(pick0));
      // 용지 — 맨 위에서 따로(2026-10-03 사용자 결정 "가장 중요하니 처음부터 따로"). 세 칸 다 첫 화면에서 눌린다
      const papers = p.locator('[role=radiogroup][aria-labelledby="pfm-paper"] [role=radio]');
      const paperM = [];
      for (let i = 0; i < (await papers.count()); i++) paperM.push(await probe(papers.nth(i)));
      check(who, '① 용지 세 칸이 첫 화면에서 눌린다', paperM.length === 3 && paperM.every((m) => m && m.inView && m.hit && m.h >= 40),
        paperM.map((m) => (m ? `y=${m.y} ${m.w}×${m.h}${m.hit ? '' : ' 가림=' + m.covered}` : '없음')).join(' / '));
      // 편집은 처음부터 보인다(2026-10-03 사용자 결정) — 넓은 화면은 패널이 열려 있고, 좁은 화면은 아래 바에 탭 줄이 있다
      if (wide) {
        const kind0 = await p.locator('[data-customize]').getAttribute('data-customize').catch(() => null);
        const tab0 = await probe(p.locator('[data-customize] [role=tab]').first());
        const cus0 = await probe(customizeBtn);
        check(who, '① 편집 패널이 열린 채로 시작한다 · [꾸미기] 가 눌린다', kind0 === 'panel' && !!tab0 && tab0.inView && tab0.hit && !!cus0 && cus0.hit,
          `패널=${kind0} · 첫 탭 ${fmt(tab0)} · 꾸미기 ${fmt(cus0)}`);
        // 페이지 맨 위에서도 패널이 아래 바 뒤로 깔리지 않는다 — 깔리면 그 안의 아래쪽 항목에 손이 닿지 않는다
        const pan0 = await p.evaluate(() => {
          const r = document.querySelector('[data-customize="panel"] > div').getBoundingClientRect();
          return { y: Math.round(r.top), b: Math.round(r.bottom), bar: Math.round(document.querySelector('[data-maker-bar]').getBoundingClientRect().top) };
        });
        check(who, '① 맨 위에서도 패널이 아래 바 위에서 끝난다', pan0.b <= pan0.bar + 1, `패널 y=${pan0.y}~${pan0.b} · 바 y=${pan0.bar}`);
      } else {
        const row = bar.locator('[role=group][aria-label="편집"] button');
        const ms = [];
        for (let i = 0; i < (await row.count()); i++) ms.push(await probe(row.nth(i)));
        check(who, '① 아래 바에 편집 탭 다섯이 한 줄로, 다 눌린다', ms.length === 5 && ms.every((m) => m && m.inView && m.hit && m.h >= 40 && m.w >= 40) && new Set(ms.map((m) => m.y)).size === 1,
          ms.map((m) => (m ? `${m.w}×${m.h}@${m.y}` : '없음')).join(' '));
      }
      check(who, '① 가로 넘침 없음', (await overflowX(p)) <= 1, `${await overflowX(p)}px`);
      // 디자인 — 여섯 다 첫 화면에서 눌린다(2026-10-03 사용자 지적 "6종 중 3종밖에 안 보인다"). 휴대폰·태블릿 3×2, 넓은 화면 한 줄
      const cardsL = p.locator('[data-design-row] li button');
      const cms = [];
      for (let i = 0; i < (await cardsL.count()); i++) cms.push(await probe(cardsL.nth(i)));
      const rowsN = new Set(cms.filter(Boolean).map((m) => m.y)).size;
      const names = await p.locator('[data-design-row] li button span.font-semibold').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
      check(who, '① 디자인 여섯이 첫 화면에서 다 눌린다', cms.length === 6 && cms.every((m) => m && m.inView && m.hit) && rowsN === (d.viewport.width >= 1280 ? 1 : 2),
        `${cms.length}개 · ${rowsN}줄 · ${cms.map((m) => (m ? `${m.w}×${m.h}${m.hit ? '' : '가림'}` : '없음')).join(' ')}`);
      // 이름이 낱말 한가운데서 끊기지 않는다('에디토/리얼') — 이름 줄 높이로 본다(한 줄 ≈ 16~18px, 낱말 사이에서 두 줄로 꺾이는 건 허용 ≈ 34px)
      const broken = await p.locator('[data-design-row] li button span.font-semibold').evaluateAll((els) => els.filter((e) => {
        const t = (e.textContent || '').trim();
        return !t.includes(' ') && e.getBoundingClientRect().height > 24;
      }).map((e) => e.textContent.trim()));
      check(who, '① 디자인 이름이 낱말 가운데서 끊기지 않는다', broken.length === 0, broken.join(', ') || `이름 줄 높이 ${names.join('/')}`);
      // 표지 사진이 그려졌는가(사파리 엔진: 줄여 그린 지면 안의 사진)
      const cover = await p.evaluate(() => {
        const box = document.querySelector('[data-page-index="0"] [data-scaled-page]');
        const br = box.getBoundingClientRect();
        const ims = [...box.querySelectorAll('img')];
        const inner = box.firstElementChild.getBoundingClientRect();
        return {
          imgs: ims.length, loaded: ims.filter((im) => im.complete && im.naturalWidth > 0).length,
          outside: ims.filter((im) => { const r = im.getBoundingClientRect(); return r.left < br.left - 1 || r.right > br.right + 1 || r.top < br.top - 1 || r.bottom > br.bottom + 1; }).length,
          ratio: br.width / br.height, innerDelta: Math.round(Math.abs(inner.width - br.width) + Math.abs(inner.height - br.height)),
        };
      });
      check(who, '① 표지가 제 비율로 그려지고 사진이 지면 안에 있다', cover.loaded === cover.imgs && cover.outside === 0 && Math.abs(cover.ratio - 1000 / 1414) < 0.01 && cover.innerDelta <= 2,
        `사진 ${cover.loaded}/${cover.imgs} · 지면 밖 ${cover.outside} · 비율 ${cover.ratio.toFixed(3)} · 안팎 차 ${cover.innerDelta}px`);

      // ⑦ 들어올 때 받은 사진
      const originals = imgs.filter((i) => !i.thumb && i.status < 400);
      const bytes = imgs.reduce((s, i) => s + (i.status < 400 ? i.len : 0), 0);
      check(who, '⑦ 들어올 때 원본 사진을 받지 않는다', originals.length === 0, `사진 ${imgs.length}장 ${(bytes / 1048576).toFixed(2)}MB · 원본 ${originals.length}장`);
      notes.push(`${who} — 첫 쪽까지 ${firstPaint}ms · 표지 y=${first.pageY}(${first.visible}px 보임) · 바 y=${first.barY} h=${first.barH} · 사진 ${imgs.length}장 ${(bytes / 1048576).toFixed(2)}MB`);

      // ⑤ 첫 화면의 누르는 곳·글자
      const tap1 = await tapTargets(p, '[data-testid="portfolio-maker"]', TAP_MIN);
      check(who, `⑤ 첫 화면 — 누르는 곳 ${TAP_MIN}px 이상`, tap1.bad.length === 0, `${tap1.total}개 · 가장 작은 변 ${tap1.smallest}px${tap1.bad.length ? ' · 작은 것: ' + tap1.bad.slice(0, 6).join(', ') : ''}`);
      const txt1 = await smallText(p, '[data-testid="portfolio-maker"]', TEXT_MIN);
      check(who, `⑤ 첫 화면 — 글자 ${TEXT_MIN}px 이상`, txt1.small.length === 0, `글자 ${txt1.total}곳 · 작은 글자 ${txt1.small.length}곳${txt1.small.length ? ': ' + txt1.small.slice(0, 5).join(', ') : ''}`);

      // ② 아래 바 — 가운데·맨 끝에서도
      for (const [name, frac] of [['가운데', 0.5], ['맨 끝', 1]]) {
        await p.evaluate((f) => scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * f), frac);
        await settle(p);
        const m = await probe(saveBtn);
        check(who, `② ${name}까지 내려도 [PDF 저장] 이 눌린다`, !!m && m.inView && m.hit, fmt(m));
        // 사진은 늦게 받는다(loading=lazy) — 내려 본 자리의 쪽에 사진이 실제로 그려지는가(엔진마다 늦게 받는 기준이 다르다)
        const inView = () => p.evaluate(() => {
          const ims = [...document.querySelectorAll('[data-book-preview] [data-scaled-page] img')].filter((im) => { const r = im.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; });
          return { n: ims.length, loaded: ims.filter((im) => im.complete && im.naturalWidth > 0).length };
        });
        let seen = await inView();
        for (let i = 0; i < 20 && seen.loaded < seen.n; i++) { await p.waitForTimeout(250); seen = await inView(); }
        check(who, `② ${name} — 화면 안 쪽의 사진이 그려진다`, seen.loaded === seen.n, `사진 ${seen.loaded}/${seen.n}`);
      }
      const barH = await bar.evaluate((el) => Math.round(el.getBoundingClientRect().height));
      // 넓은 화면은 한 줄, 좁은 화면은 탭 줄 + 버튼 줄 두 줄(사용자가 고른 모양)
      check(who, wide ? '② 아래 바는 한 줄' : '② 아래 바는 두 줄(탭 줄 + 버튼 줄)', barH <= (wide ? 72 : 116), `${barH}px`);
      await p.evaluate(() => scrollTo(0, 0));
      await settle(p);


      // ③④ 꾸미기 — 넓은 화면은 이미 열려 있다. 좁은 화면은 탭 줄의 [표지] 로 연다
      if (!wide) await bar.locator('[role=group][aria-label="편집"] button', { hasText: '표지' }).click();
      const cz = p.locator('[data-customize]');
      await cz.waitFor({ timeout: 10000 });
      await p.waitForTimeout(500);
      const kind = await cz.getAttribute('data-customize');
      check(who, wide ? '③ 꾸미기 = 옆 패널' : '③ 꾸미기 = 아래 시트', kind === (wide ? 'panel' : 'sheet'), kind);
      for (const [label, target] of TABS) {
        const tab = cz.locator('[role=tab]').filter({ hasText: new RegExp(`^${label}$`) });
        await tab.scrollIntoViewIfNeeded();
        const tm = await probe(tab);
        await tab.click();
        await p.waitForTimeout(450);
        await settle(p);
        const lim = await p.evaluate((w) => {
          const el = w ? document.querySelector('[data-maker-bar]') : document.querySelector('[data-customize="sheet"]');
          return Math.round(el.getBoundingClientRect().top);
        }, wide);
        const band = await pageInBand(p, target, navH, lim);
        check(who, `③ [${label}] — 고치는 쪽이 통째로 보인다`, !!tm && tm.hit && !!band && band.ok, `탭 ${fmt(tm)} · 쪽 y=${band && band.y}~${band && band.b} (${band && band.w}×${band && band.h}) · 보이는 띠 ${navH}~${lim}`);
        const body = await p.evaluate(() => { const el = document.querySelector('#pfm-panel'); return { h: el.clientHeight, sh: el.scrollHeight, ox: el.scrollWidth - el.clientWidth }; });
        const tapC = await tapTargets(p, '[data-customize]', TAP_MIN);
        const txtC = await smallText(p, '[data-customize]', TEXT_MIN);
        check(who, `④ [${label}] — 스크롤 영역 ${wide ? 400 : 200}px 이상 · 가로 넘침 없음`, body.h >= (wide ? 400 : 200) && body.ox <= 1 && (await overflowX(p)) <= 1, `영역 ${body.h}px / 내용 ${body.sh}px · 안쪽 넘침 ${body.ox}px · 페이지 넘침 ${await overflowX(p)}px`);
        check(who, `⑤ [${label}] — 누르는 곳 ${TAP_MIN}px · 글자 ${TEXT_MIN}px 이상`, tapC.bad.length === 0 && txtC.small.length === 0,
          `누르는 곳 ${tapC.total}개(가장 작은 변 ${tapC.smallest}px)${tapC.bad.length ? ' 작은 것: ' + tapC.bad.slice(0, 6).join(', ') : ''} · 작은 글자 ${txtC.small.length}곳${txtC.small.length ? ': ' + txtC.small.slice(0, 4).join(', ') : ''}`);
        await shot(p, `꾸미기-${label}`);
        if (wide) {
          // 패널이 상단바와 아래 바 사이에 통째로 들어와 있다(마지막 장으로 내려간 [이름·연락처] 에서도)
          const panel = () => p.evaluate(() => {
            const r = document.querySelector('[data-customize="panel"] > div').getBoundingClientRect();
            const br = document.querySelector('[data-maker-bar]').getBoundingClientRect();
            return { y: Math.round(r.top), b: Math.round(r.bottom), bar: Math.round(br.top) };
          });
          const pan = await panel();
          check(who, `④ [${label}] — 패널이 상단바와 아래 바 사이에 있다`, pan.y >= navH - 1 && pan.b <= pan.bar + 1, `패널 y=${pan.y}~${pan.b} · 바 y=${pan.bar}`);
          if (label === '표지') {
            // 미리보기를 내려도 따라온다(sticky)
            await p.evaluate(() => scrollBy(0, 700));
            await settle(p);
            const after = await panel();
            check(who, '④ 미리보기를 내려 봐도 패널이 따라온다', after.y >= navH - 1 && after.b <= after.bar + 1, `패널 y=${after.y}~${after.b} · 바 y=${after.bar}`);
          }
        }
      }
      if (wide) {
        const x = await probe(cz.locator('button[aria-label="꾸미기 닫기"]'));
        check(who, '④ 패널 [닫기] 가 눌린다', !!x && x.hit && x.inView, fmt(x));
        await cz.locator('button[aria-label="꾸미기 닫기"]').click();
      } else {
        const done = await probe(cz.locator('button', { hasText: '완료' }));
        check(who, '④ 시트 [완료] 가 눌린다', !!done && done.hit && done.inView, fmt(done));
        await cz.locator('button', { hasText: '완료' }).click();
      }
      await cz.waitFor({ state: 'detached', timeout: 5000 });
      await p.evaluate(() => scrollTo(0, 0));
      await settle(p);

      // ⑥ 저장 창
      await saveBtn.click();
      const dlg = p.locator('[data-testid="save-dialog"]');
      await dlg.waitFor({ timeout: 10000 });
      await p.waitForTimeout(350);
      const dl = await probe(dlg.locator('button', { hasText: 'PDF 내려받기' }));
      const dbox = await dlg.evaluate((el) => { const r = el.getBoundingClientRect(); return { y: Math.round(r.top), b: Math.round(r.bottom), l: Math.round(r.left), r: Math.round(r.right), vh: innerHeight, vw: innerWidth }; });
      check(who, '⑥ 저장 창 — [PDF 내려받기] 가 스크롤 없이 눌린다', !!dl && dl.inView && dl.hit && dbox.y >= 0 && dbox.b <= dbox.vh + 1 && dbox.l >= 0 && dbox.r <= dbox.vw + 1, `${fmt(dl)} · 창 y=${dbox.y}~${dbox.b} (화면 ${dbox.vh})`);
      await dlg.locator('button', { hasText: '다른 형식으로 저장' }).click();
      await p.waitForTimeout(250);
      const pr = dlg.locator('button', { hasText: '인쇄 창 열기' });
      await pr.scrollIntoViewIfNeeded();
      const prm = await probe(pr);
      const tapS = await tapTargets(p, '[data-testid="save-dialog"]', TAP_MIN);
      const txtS = await smallText(p, '[data-testid="save-dialog"]', TEXT_MIN);
      check(who, '⑥ 저장 창 — 다른 형식까지 눌리고, 작은 단추·글자가 없다', !!prm && prm.hit && prm.inView && tapS.bad.length === 0 && txtS.small.length === 0,
        `인쇄 ${fmt(prm)} · 누르는 곳 ${tapS.total}개${tapS.bad.length ? ' 작은 것: ' + tapS.bad.join(', ') : ''}${tapS.inline.length ? ' (문장 안 ' + tapS.inline.join(', ') + ')' : ''} · 작은 글자 ${txtS.small.length}곳`);
      await shot(p, '저장창');
      const sx = await probe(dlg.locator('button[aria-label="닫기"]'));
      check(who, '⑥ 저장 창 [닫기] 가 눌린다', !!sx && sx.hit && sx.inView, fmt(sx));
      await dlg.locator('button[aria-label="닫기"]').click();
      await dlg.waitFor({ state: 'detached', timeout: 5000 });

      // ⑥ 작품 고르기
      await pickBtn.click();
      const pk = p.locator('[role=dialog][aria-label="작품 고르기"]');
      await pk.waitFor({ timeout: 10000 });
      await p.waitForTimeout(350);
      const apply = await probe(pk.locator('button', { hasText: /전체 작품 그대로|점으로/ }));
      const arrow = await pk.locator('button[aria-label$="작품을 뒤로"]').first().evaluate((el) => { const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; });
      const tile = await pk.locator('button[aria-pressed]').first().evaluate((el) => Math.round(el.getBoundingClientRect().width));
      const tapP = await tapTargets(p, '[role=dialog][aria-label="작품 고르기"]', TAP_MIN);
      const txtP = await smallText(p, '[role=dialog][aria-label="작품 고르기"]', TEXT_MIN);
      const pbox = await pk.evaluate((el) => { const r = el.getBoundingClientRect(); return { y: Math.round(r.top), b: Math.round(r.bottom), ox: Math.round(Math.max(0, r.right - innerWidth, -r.left)) }; });
      check(who, '⑥ 작품 고르기 — 적용 버튼이 스크롤 없이 눌리고 화살표가 44px', !!apply && apply.inView && apply.hit && arrow.h >= 44 && arrow.w >= TAP_MIN && pbox.y >= 0 && pbox.ox === 0 && tapP.bad.length === 0 && txtP.small.length === 0,
        `적용 ${fmt(apply)} · 화살표 ${arrow.w}×${arrow.h} · 작품 칸 ${tile}px · 창 y=${pbox.y}~${pbox.b}${tapP.bad.length ? ' · 작은 것: ' + tapP.bad.join(', ') : ''}${txtP.small.length ? ' · 작은 글자: ' + txtP.small.slice(0, 4).join(', ') : ''}`);
      await shot(p, '작품고르기');
      await pk.locator('button[aria-label="닫기"]').click();
      await pk.waitFor({ state: 'detached', timeout: 5000 });

      // ⑥ 크게 보기
      await p.locator('[data-page-index="0"] > button').click();
      const vw = p.locator('[data-testid="page-viewer"]');
      await vw.waitFor({ timeout: 10000 });
      await p.waitForTimeout(500);
      const fitBtn = vw.locator('button', { hasText: '맞춤' });
      if (await fitBtn.count()) { await fitBtn.click(); await p.waitForTimeout(300); }
      await p.waitForFunction(() => [...document.querySelectorAll('[data-testid="page-viewer"] [data-scaled-page] img')].every((im) => im.complete && im.naturalWidth > 0), null, { timeout: 20000 }).catch(() => {});
      const vp = await vw.evaluate((el) => {
        const r = el.querySelector('[data-scaled-page]').getBoundingClientRect();
        const ims = [...el.querySelectorAll('[data-scaled-page] img')];
        return { y: Math.round(r.top), b: Math.round(r.bottom), l: Math.round(r.left), r: Math.round(r.right), vh: innerHeight, vw: innerWidth, ratio: r.width / r.height, imgs: ims.length, loaded: ims.filter((im) => im.complete && im.naturalWidth > 0).length };
      });
      const vclose = await probe(vw.locator('button[aria-label="닫기"]'));
      const vnext = await probe(vw.locator('button[aria-label="다음 쪽"]'));
      check(who, '⑥ 크게 보기(맞춤) — 한 쪽이 화면 안에 통째로, 원본 사진이 그려진다', vp.y >= 55 && vp.b <= vp.vh + 1 && vp.l >= -1 && vp.r <= vp.vw + 1 && Math.abs(vp.ratio - 1000 / 1414) < 0.01 && vp.loaded === vp.imgs && !!vclose && vclose.hit && !!vnext && vnext.hit,
        `쪽 y=${vp.y}~${vp.b} x=${vp.l}~${vp.r} (화면 ${vp.vw}×${vp.vh}) · 비율 ${vp.ratio.toFixed(3)} · 사진 ${vp.loaded}/${vp.imgs} · 닫기 ${vclose && vclose.hit} · 다음 ${vnext && vnext.hit}`);
      await shot(p, '크게보기');
      await vw.locator('button[aria-label="닫기"]').click();
      await vw.waitFor({ state: 'detached', timeout: 5000 });

      check(who, '화면 오류 없음', errs.length === 0, errs.join(' | ') || '0건');
      await ctx.close();
    }
    await b.close();
  }

  // ── 결과 ──
  const byWho = new Map();
  for (const r of rows) { if (!byWho.has(r.who)) byWho.set(r.who, []); byWho.get(r.who).push(r); }
  for (const [who, list] of byWho) {
    const bad = list.filter((r) => !r.ok);
    console.log(`\n${bad.length ? '✗' : '✓'} ${who} — ${list.length - bad.length}/${list.length}`);
    for (const r of list) if (!r.ok || process.env.VERBOSE) console.log(`   ${r.ok ? '✓' : '✗'} ${r.what} — ${r.detail}`);
  }
  console.log('\n── 측정값 ──');
  for (const n of notes) console.log('  ' + n);
  console.log(`\n${rows.length - fail.length}/${rows.length} 통과`);
  if (fail.length) { console.log('\n' + fail.join('\n')); process.exitCode = 1; }
})().catch((e) => { console.error(e); process.exit(1); });
