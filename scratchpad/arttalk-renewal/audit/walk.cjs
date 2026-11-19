// ArtTalk 화면 기하 점검 — 크롬 + 사파리 엔진(WebKit) × 여러 폭. 로컬 전용 · 가상 계정만(seed-audit-chat.ts 의 '점검' 작가).
//   cd backend && DATABASE_URL=<로컬 DB> npx tsx scripts/seed-audit-chat.ts      # 먼저(멱등)
//   node scratchpad/arttalk-renewal/audit/walk.cjs [chromium|webkit|all]
// 보는 것(화면마다): 가로 밀림 0 · 입력 줄과 [보내기]가 화면 안 · 휴대폰 방에는 상단바·하단 탭바 없음 · 말풍선이 칸 밖으로 안 나감 ·
//   머리 단추 44px · 창(방 메뉴·신고)이 화면 안 · PC 는 목록과 방이 나란히. 스크린숏은 out/walk-*.png
const pw = require('/home/jho4255/ArtLink/e2e/node_modules/playwright');
const fs = require('fs');
const BASE = 'http://localhost:5173';
const API = 'http://localhost:4000/api';
const OUT = __dirname + '/out';
fs.mkdirSync(OUT, { recursive: true });
const which = process.argv[2] || 'all';

const SIZES = [
  { w: 320, h: 640, touch: true }, { w: 360, h: 780, touch: true }, { w: 390, h: 844, touch: true }, { w: 412, h: 915, touch: true },
  { w: 768, h: 1024, touch: true }, { w: 1024, h: 768, touch: false }, { w: 1280, h: 800, touch: false }, { w: 1440, h: 900, touch: false },
];

let fails = 0; let checks = 0;
function check(ok, label) { checks += 1; if (!ok) { fails += 1; console.log('  ✗', label); } }

async function login(email) {
  const r = await fetch(API + '/auth/dev-login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) });
  if (!r.ok) throw new Error('dev-login ' + r.status);
  return r.json();
}

async function geom(page) {
  return page.evaluate(() => {
    const vw = innerWidth; const vh = innerHeight;
    const r = (el) => el && el.getBoundingClientRect();
    const room = document.querySelector('[data-testid="chat-room"]');
    const list = document.querySelector('[data-testid="chat-list"]');
    const form = room && room.querySelector('form');
    const send = document.querySelector('button[aria-label="보내기"]');
    const scroll = document.querySelector('[data-testid="chat-scroll"]');
    const bubbles = [...document.querySelectorAll('[data-testid="bubble-text"]')].map((b) => r(b));
    const sr = r(scroll);
    const headBtns = room ? [...room.querySelectorAll('header button')].map((b) => { const q = r(b); return { w: q.width, h: q.height, label: b.getAttribute('aria-label') }; }) : [];
    const title = document.querySelector('[data-testid="chat-title"]');
    return {
      vw, vh, docW: document.documentElement.scrollWidth,
      room: room ? { ...r(room).toJSON() } : null,
      list: list ? { ...r(list).toJSON(), visible: list.offsetParent !== null } : null,
      form: form ? r(form).toJSON() : null,
      send: send ? r(send).toJSON() : null,
      tabbar: !!document.querySelector('nav[aria-label="하단 내비게이션"]'),
      navbar: [...document.querySelectorAll('button[aria-label="알림"]')].some((b) => b.offsetParent !== null),
      footer: [...document.querySelectorAll('footer')].some((f) => f.offsetParent !== null && /사업자|대표|아트링크/.test(f.innerText)),
      bubblesOut: sr ? bubbles.filter((b) => b.right > sr.right + 1 || b.left < sr.left - 1).length : 0,
      headBtns,
      titleOver: title ? title.scrollWidth > title.clientWidth + 1 && getComputedStyle(title).textOverflow !== 'ellipsis' : false,
    };
  });
}

async function sheetGeom(page, testId) {
  return page.evaluate((id) => {
    const el = document.querySelector(`[data-testid="${id}"]`);
    if (!el) return null;
    const q = el.getBoundingClientRect();
    const btns = [...el.querySelectorAll('button')].filter((b) => b.offsetParent !== null).map((b) => b.getBoundingClientRect().height);
    return { top: q.top, bottom: q.bottom, left: q.left, right: q.right, vw: innerWidth, vh: innerHeight, minBtn: Math.min(...btns) };
  }, testId);
}

async function run(engineName) {
  const engine = pw[engineName];
  const opts = engineName === 'webkit' ? { executablePath: process.env.HOME + '/.cache/wk-deps/run.sh' } : {};
  const browser = await engine.launch(opts);
  const a = await login('audit.artist.a@example.com');
  // 점검 작가 A 의 방 — 긴 이름·무공백 장문이 든 1:1
  const chats = await (await fetch(API + '/chats', { headers: { Authorization: 'Bearer ' + a.token } })).json();
  const room = chats.find((c) => c.kind === 'DIRECT');
  if (!room) throw new Error('점검 대화방이 없다 — seed-audit-chat.ts 를 먼저');
  console.log(`[${engineName}] 방 ${room.id} · 목록 ${chats.length}개`);
  for (const s of SIZES) {
    const ctx = await browser.newContext({ viewport: { width: s.w, height: s.h }, hasTouch: s.touch, isMobile: engineName === 'chromium' ? s.touch && s.w < 768 : false });
    await ctx.addInitScript(([t, u]) => {
      localStorage.setItem('artlink-auth', JSON.stringify({ state: { token: t, user: u, isAuthenticated: true }, version: 0 }));
      localStorage.setItem('artlink-homepage-nudge-snooze', JSON.stringify({ [String(u.id)]: 8.64e15 }));
      localStorage.setItem('artlink-intro-hidden', JSON.stringify({ [String(u.id)]: true }));
    }, [a.token, a.user]);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const tag = `${engineName}-${s.w}`;
    const wide = s.w >= 1024;

    // 1) 목록
    await page.goto(BASE + '/messages');
    await page.waitForSelector('[data-testid="chat-list"]', { timeout: 20000 });
    await page.waitForTimeout(wide ? 1500 : 800);
    let g = await geom(page);
    check(g.docW <= g.vw, `${tag} 목록 가로 밀림 ${g.docW}/${g.vw}`);
    check(!g.footer, `${tag} /messages 에 회사 푸터가 있다`);
    if (wide) {
      check(!!g.room, `${tag} PC 인데 방이 저절로 안 열렸다`);
      check(g.list && g.room && g.list.right <= g.room.left + 1, `${tag} 목록과 방이 나란히가 아니다`);
    }
    await page.screenshot({ path: `${OUT}/walk-${tag}-1-list.png` });

    // 2) 방
    if (!wide) {
      await page.locator(`[data-chat-id="${room.id}"]`).click();
    } else {
      await page.locator(`[data-chat-id="${room.id}"]`).click();
    }
    await page.waitForSelector('[data-testid="chat-room"] textarea:not([disabled])', { timeout: 20000 });
    await page.waitForTimeout(600);
    g = await geom(page);
    check(g.docW <= g.vw, `${tag} 방 가로 밀림 ${g.docW}/${g.vw}`);
    check(g.send && g.send.right <= g.vw && g.send.bottom <= g.vh, `${tag} [보내기]가 화면 밖 ${JSON.stringify(g.send)}`);
    check(g.form && g.form.bottom <= g.vh + 1, `${tag} 입력 줄이 화면 아래로 넘친다 ${g.form && g.form.bottom}/${g.vh}`);
    check(g.bubblesOut === 0, `${tag} 칸 밖으로 나간 말풍선 ${g.bubblesOut}`);
    check(!g.titleOver, `${tag} 방 제목이 넘친다(말줄임 없음)`);
    for (const b of g.headBtns) check(b.w >= 43.5 && b.h >= 43.5, `${tag} 머리 단추 '${b.label}' ${Math.round(b.w)}×${Math.round(b.h)}`);
    if (!wide) {
      check(!g.tabbar, `${tag} 휴대폰 방에 하단 탭바가 있다`);
      check(!g.navbar, `${tag} 휴대폰 방에 상단바가 있다`);
      check(g.form && g.form.bottom >= g.vh - 90, `${tag} 입력 줄이 맨 아래가 아니다 ${g.form && g.form.bottom}/${g.vh}`);
    }
    await page.screenshot({ path: `${OUT}/walk-${tag}-2-room.png` });

    // 3) 방 메뉴
    await page.getByRole('button', { name: '대화방 메뉴' }).click();
    await page.waitForSelector('[data-testid="room-menu"]');
    await page.waitForTimeout(350);
    let sg = await sheetGeom(page, 'room-menu');
    check(sg && sg.top >= -1 && sg.bottom <= sg.vh + 1 && sg.left >= -1 && sg.right <= sg.vw + 1, `${tag} 방 메뉴가 화면 밖 ${JSON.stringify(sg)}`);
    check(sg && sg.minBtn >= 43.5, `${tag} 방 메뉴 단추 높이 ${sg && sg.minBtn}`);
    await page.screenshot({ path: `${OUT}/walk-${tag}-3-menu.png` });
    // 4) 신고 창(보내지 않는다)
    await page.getByTestId('room-menu').getByRole('button', { name: '신고하기' }).click();
    await page.waitForSelector('[data-testid="report-sheet"]');
    await page.waitForTimeout(350);
    sg = await sheetGeom(page, 'report-sheet');
    check(sg && sg.top >= -1 && sg.bottom <= sg.vh + 1, `${tag} 신고 창이 화면 밖 ${JSON.stringify(sg)}`);
    await page.screenshot({ path: `${OUT}/walk-${tag}-4-report.png` });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    check(!(await page.locator('[data-testid="report-sheet"]').count()), `${tag} Esc 로 신고 창이 안 닫힌다`);

    // 5) 말 메뉴(길게 누르기 대신 contextmenu)
    await page.locator('[data-testid="bubble-text"]').first().click({ button: 'right' });
    await page.waitForSelector('[data-testid="message-menu"]');
    sg = await sheetGeom(page, 'message-menu');
    check(sg && sg.bottom <= sg.vh + 1, `${tag} 말 메뉴가 화면 밖`);
    await page.keyboard.press('Escape');

    // 6) 휴대폰 [←] → 목록
    if (!wide) {
      await page.getByRole('button', { name: '대화 목록으로' }).click();
      await page.waitForSelector('[data-testid="chat-list"]');
      check(!(await page.locator('[data-testid="chat-room"]').count()), `${tag} [←] 뒤에도 방이 남아 있다`);
    }
    check(errors.length === 0, `${tag} 페이지 오류 ${errors.join(' | ')}`);
    await ctx.close();
    console.log(`  ${tag} 확인 끝`);
  }
  await browser.close();
}

(async () => {
  const engines = which === 'all' ? ['chromium', 'webkit'] : [which];
  if (engines.includes('webkit')) process.env.PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS = '1';
  for (const e of engines) await run(e);
  console.log(`\n확인 ${checks} · 실패 ${fails}`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
