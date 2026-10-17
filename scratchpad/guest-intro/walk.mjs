// 비회원 소개 팝업(lib/guestIntro.ts · components/shared/GuestIntro.tsx) — 실제 브라우저로 뜨는 곳·모양·동작을 잰다. 로컬 개발 서버 전용.
//   node scratchpad/guest-intro/walk.mjs            크롬
//   ENGINE=webkit node scratchpad/guest-intro/walk.mjs   사파리 엔진(~/.cache/wk-deps/run.sh)
// ⚠️ 팝업은 자동화(navigator.webdriver)에 안 뜬다 — 여기서는 그 값을 false 로 바꿔 사람처럼 연다.
import pw from '/home/jho4255/ArtLink/e2e/node_modules/playwright/index.js';
import { mkdirSync } from 'node:fs';
const APP = process.env.APP || 'http://localhost:5173';
const OUT = '/home/jho4255/ArtLink/scratchpad/guest-intro/out';
mkdirSync(OUT, { recursive: true });
const wk = process.env.ENGINE === 'webkit';
const tag = wk ? 'webkit' : 'chrome';
const b = await (wk ? pw.webkit : pw.chromium).launch(wk ? { executablePath: `${process.env.HOME}/.cache/wk-deps/run.sh` } : {});
const out = [];
const check = (name, ok, info = '') => { out.push(`${ok ? '✓' : '✗'} ${name}${info ? ` — ${info}` : ''}`); if (!ok) process.exitCode = 1; };
const HUMAN = () => { Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }); navigator.sendBeacon = () => true; };

const exId = await fetch(APP.replace(':5173', ':4000') + '/api/exhibitions?scope=open').then((r) => r.json()).then((d) => (Array.isArray(d) ? d : d.exhibitions || d.items || [])[0]?.id).catch(() => null);

const SIZES = [
  ['pc', { width: 1440, height: 900 }],
  ['phone', { width: 390, height: 844, hasTouch: true, deviceScaleFactor: 3, ...(wk ? {} : { isMobile: true }) }],
  ['se', { width: 375, height: 667, hasTouch: true, deviceScaleFactor: 2, ...(wk ? {} : { isMobile: true }) }],
];
for (const [name, vp] of SIZES) {
  const { width, height, ...rest } = vp;
  const ctx = await b.newContext({ viewport: { width, height }, ...rest });
  await ctx.addInitScript(HUMAN);
  await ctx.route(/\/api\/(guest-activity|visits)/, (r) => r.fulfill({ status: 204, body: '' }));
  for (const start of ['/', exId ? `/exhibitions/${exId}` : null].filter(Boolean)) {
    const p = await ctx.newPage();
    await p.goto(APP + start, { waitUntil: 'domcontentloaded' });
    const t0 = Date.now();
    const dlg = p.getByTestId('guest-intro');
    const shown = await dlg.waitFor({ timeout: 8000 }).then(() => true, () => false);
    check(`${tag} ${name} ${start} 뜬다`, shown, `${Date.now() - t0}ms`);
    if (!shown) { await p.close(); continue; }
    await p.waitForTimeout(600);
    const g = await p.evaluate(() => {
      const d = document.querySelector('[data-testid=guest-intro]').getBoundingClientRect();
      const cta = [...document.querySelectorAll('[data-testid=guest-intro] button')].find((x) => x.textContent.includes('무료로 시작하기'));
      const cr = cta.getBoundingClientRect();
      const hit = document.elementFromPoint(cr.x + cr.width / 2, cr.y + cr.height / 2);
      const box = document.querySelector('[data-testid=guest-intro]');
      return { top: d.top, bottom: d.bottom, h: d.height, w: d.width, vh: innerHeight, vw: innerWidth, scrollW: box.scrollWidth, clientW: box.clientWidth,
        scrollH: box.scrollHeight, clientH: box.clientHeight, ctaBottom: cr.bottom, ctaHit: !!hit && cta.contains(hit), docW: document.documentElement.scrollWidth,
        imgs: [...box.querySelectorAll('img')].map((i) => i.complete && i.naturalWidth > 0).filter((x) => !x).length };
    });
    check(`${tag} ${name} ${start} 화면 안`, g.top >= 0 && g.bottom <= g.vh + 1 && g.scrollW <= g.clientW && g.docW <= g.vw, `창 ${Math.round(g.w)}×${Math.round(g.h)} · 화면 ${g.vw}×${g.vh} · 안쪽 스크롤 ${g.scrollH > g.clientH + 1 ? `있음(${g.scrollH}/${g.clientH})` : '없음'}`);
    check(`${tag} ${name} ${start} [무료로 시작하기]가 첫 화면에서 눌린다`, g.ctaHit && g.ctaBottom <= g.vh, `아래끝 ${Math.round(g.ctaBottom)}`);
    check(`${tag} ${name} ${start} 그림 다 받음`, g.imgs === 0, `못 받은 그림 ${g.imgs}`);
    await p.screenshot({ path: `${OUT}/${tag}-${name}-${start === '/' ? 'home' : 'exhibition'}.png` });
    // 갤러리 쪽도 — 안내가 두 줄이라 더 길다. 창 안 스크롤 없이 [무료로 시작하기]가 첫 화면에
    await p.getByTestId('guest-intro').getByRole('tab', { name: '갤러리' }).click();
    await p.waitForTimeout(400);
    const gg = await p.evaluate(() => {
      const box = document.querySelector('[data-testid=guest-intro]');
      const cta = [...box.querySelectorAll('button')].find((x) => x.textContent.includes('무료로 시작하기'));
      return { items: box.querySelectorAll('li').length, scroll: box.scrollHeight - box.clientHeight, ctaBottom: cta.getBoundingClientRect().bottom, vh: innerHeight };
    });
    check(`${tag} ${name} ${start} 갤러리 쪽 네 칸 · 스크롤 없이 [무료로 시작하기]가 첫 화면`, gg.items === 4 && gg.scroll <= 1 && gg.ctaBottom <= gg.vh, JSON.stringify(gg));
    await p.close();
  }
  await ctx.close();
}

// 동작 — PC 크롬 한 번
{
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(HUMAN);
  await ctx.route(/\/api\/(guest-activity|visits)/, (r) => r.fulfill({ status: 204, body: '' }));
  const p = await ctx.newPage();
  // 로그인 화면엔 안 뜬다
  await p.goto(APP + '/login'); await p.waitForTimeout(3500);
  check(`${tag} /login 에는 안 뜬다`, (await p.getByTestId('guest-intro').count()) === 0);
  // ESC 로 닫으면 다시 안 뜬다(새로고침·다른 화면)
  await p.goto(APP + '/artists'); await p.getByTestId('guest-intro').waitFor({ timeout: 8000 });
  await p.waitForTimeout(300);   // 뜨자마자(키 처리기를 붙이기 전) 누르면 느린 WebKit 에서 가끔 놓친다 — 사람 손은 이보다 느리다
  await p.keyboard.press('Escape');
  check(`${tag} ESC 로 닫힌다`, await p.getByTestId('guest-intro').waitFor({ state: 'detached', timeout: 3000 }).then(() => true, () => false));
  await p.reload(); await p.waitForTimeout(3500);
  check(`${tag} 답한 뒤엔 새로고침해도 안 뜬다`, (await p.getByTestId('guest-intro').count()) === 0);
  await p.goto(APP + '/galleries'); await p.waitForTimeout(3500);
  check(`${tag} 답한 뒤엔 다른 화면에서도 안 뜬다`, (await p.getByTestId('guest-intro').count()) === 0);
  // 방문(탭)마다 한 번 — 2026-10-18 사용자 결정. 새 탭(같은 브라우저)에선 다시 뜬다
  {
    const p2 = await ctx.newPage();
    await p2.goto(APP + '/');
    check(`${tag} 닫은 뒤에도 새 탭(다음 방문)에선 다시 뜬다`, await p2.getByTestId('guest-intro').waitFor({ timeout: 8000 }).then(() => true, () => false));
    await p2.close();
  }
  // 답하기 전에 화면을 옮기면 다음 화면에서 뜬다
  await p.evaluate(() => sessionStorage.removeItem('artlink-intro-guest-answered'));
  await p.goto(APP + '/'); await p.waitForTimeout(800);
  await p.goto(APP + '/galleries');
  check(`${tag} 답하기 전에 옮기면 다음 화면에서 뜬다`, await p.getByTestId('guest-intro').waitFor({ timeout: 8000 }).then(() => true, () => false));
  // 공모 상세에서 [무료로 시작하기] → 가입(아티스트 골라 둠) · 가입 뒤 그 공모로 돌아올 자리
  if (exId) {
    await p.evaluate(() => { sessionStorage.removeItem('artlink-intro-guest-answered'); sessionStorage.removeItem('post_login_redirect'); });
    await p.goto(APP + `/exhibitions/${exId}`);
    await p.getByTestId('guest-intro').waitFor({ timeout: 8000 });
    await p.getByRole('button', { name: '무료로 시작하기' }).click();
    await p.waitForURL('**/signup?role=ARTIST');
    const picked = await p.getByRole('radio', { name: /아티스트/ }).getAttribute('aria-checked').catch(() => null);
    const kakao = await p.getByRole('button', { name: /카카오로 가입하기/ }).isVisible().catch(() => false);
    const back = await p.evaluate(() => sessionStorage.getItem('post_login_redirect'));
    check(`${tag} [무료로 시작하기] → 가입, 아티스트를 골라 둠`, picked === 'true' || kakao, `aria-checked=${picked} · 카카오 버튼 ${kakao}`);
    check(`${tag} 가입 뒤 그 공모로 돌아올 자리`, back === `/exhibitions/${exId}`, String(back));
  }
  // 로그인한 적 있는 브라우저(로그아웃 상태)에도 뜬다 — 2026-10-18 사용자 결정. 그 브라우저에서 누가 [다시 보지 않기] 를 눌렀으면 안 뜬다
  await p.evaluate(() => { sessionStorage.removeItem('artlink-intro-guest-answered'); localStorage.setItem('artlink-member-device', '1'); });
  await p.goto(APP + '/');
  check(`${tag} 로그인한 적 있는 브라우저(로그아웃 상태)에도 뜬다`, await p.getByTestId('guest-intro').waitFor({ timeout: 6000 }).then(() => true, () => false));
  await p.evaluate(() => { sessionStorage.removeItem('artlink-intro-guest-answered'); localStorage.setItem('artlink-intro-hidden', JSON.stringify({ 5: 1 })); });
  await p.goto(APP + '/galleries'); await p.waitForTimeout(3500);
  check(`${tag} 이 브라우저에서 누가 [다시 보지 않기] 를 눌렀으면 로그아웃 상태에서도 안 뜬다`, (await p.getByTestId('guest-intro').count()) === 0);
  await ctx.close();
}
// 자동화(webdriver)엔 안 뜬다 — E2E·점검 하니스를 막지 않게
{
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.route(/\/api\/(guest-activity|visits)/, (r) => r.fulfill({ status: 204, body: '' }));
  const p = await ctx.newPage();
  await p.goto(APP + '/'); await p.waitForTimeout(3500);
  check(`${tag} 자동화 브라우저엔 안 뜬다`, (await p.getByTestId('guest-intro').count()) === 0);
  await ctx.close();
}
await b.close();
console.log(out.join('\n') + `\n${out.filter((l) => l.startsWith('✗')).length ? '실패 있음' : '전부 통과'}`);
