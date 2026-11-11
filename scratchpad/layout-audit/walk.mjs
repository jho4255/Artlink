/**
 * 화면 전수 점검 — 잘린 내용·화면 밖 버튼·가로 밀림 (2026-11-11, ArtTalk [보내기] 잘림·가운데 어긋남 뒤)
 *
 * 무엇을 재나(화면마다, 폭마다, 엔진마다):
 *   ① page   : 페이지가 가로로 밀리는가(scrollWidth > 화면 폭)
 *   ② clip   : overflow 가 hidden/clip 인 상자 안에서 내용이 옆으로 넘쳐 **잘리는가**(말줄임 truncate 은 의도라 뺀다)
 *              → 넘친 자식 중 가장 바깥으로 나간 것을 적는다(버튼·글자)
 *   ③ spill  : 글자 상자보다 글자가 넓어 **밖으로 삐져나오는가**(overflow visible)
 *   ④ offscreen : 누를 수 있는 것(button·a·input)이 화면 밖으로 나갔는가(가로로 미는 줄 안은 뺀다)
 * 판정은 기계가, 확인은 스크린샷으로. 결과: OUT/report.json · OUT/*.png(걸린 화면만)
 *
 * 두 묶음을 본다 —
 *   공개 화면 = 실서버 복제본(5173 → 4000, artlink_prod) : 실제 이름·글 길이
 *   로그인 화면 = 데모 DB(5174 → 4001, artlink) : 단계별 공모·지원 데이터(seed-flow-stages)
 * ⚠️ 로컬 전용. 실서버 주소를 넣지 말 것.
 *   node scratchpad/layout-audit/walk.mjs [--only=<정규식>] [--engines=chromium,webkit] [--widths=360,390,412,768,1024,1280]
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium, webkit } from '../../e2e/node_modules/playwright/index.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const OUT = args.out || path.join(process.env.TMPDIR || '/tmp', 'layout-audit');
fs.mkdirSync(OUT, { recursive: true });
const WIDTHS = (args.widths || '360,390,412,768,1024,1280').split(',').map(Number);
const ENGINES = (args.engines || 'chromium,webkit').split(',');
const WEBKIT_WIDTHS = new Set((args.webkitWidths || '390,1280').split(',').map(Number));
const ONLY = args.only ? new RegExp(args.only) : null;
const WEBKIT_RUN = path.join(process.env.HOME, '.cache/wk-deps/run.sh');

const PUB = { web: 'http://localhost:5173', api: 'http://localhost:4000/api' };
const DEMO = { web: 'http://localhost:5174', api: 'http://localhost:4001/api' };

const j = (u, o) => fetch(u, o).then((r) => (r.ok ? r.json() : null)).catch(() => null);
async function login(stack, email) {
  const r = await j(`${stack.api}/auth/dev-login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) });
  if (!r?.token) throw new Error(`dev-login 실패: ${email}`);
  return r;
}

async function routes() {
  const list = [];
  const add = (stack, who, p, label = p) => list.push({ stack, who, path: p, label: `${who}:${label}` });
  // ── 공개(복제본) ──
  const P = PUB;
  for (const p of ['/', '/artists', '/galleries', '/exhibitions', '/exhibitions?scope=closed', '/shows', '/community', '/support', '/login', '/signup', '/signup/email?role=ARTIST', '/terms', '/privacy', '/join/ABCDEFGH', '/no-such-page']) add(P, 'guest', p);
  const artists = (await j(`${P.api}/explore/artists`)) ?? [];
  const top = [...artists].sort((a, b) => (b.workCount ?? 0) - (a.workCount ?? 0));
  const longName = [...artists].sort((a, b) => String(b.nickname || b.name).length - String(a.nickname || a.name).length)[0];
  for (const a of [top[0], top[1], longName].filter(Boolean)) {
    const base = a.handle ? `/@${a.handle}` : `/portfolio/${a.id}`;
    add(P, 'guest', base, `artist-home(${a.id})`);
    for (const t of ['note', 'cv', 'file', 'guestbook']) add(P, 'guest', `${base}?tab=${t}`, `artist-home(${a.id})?tab=${t}`);
  }
  const gals = (await j(`${P.api}/galleries`)) ?? [];
  for (const g of (Array.isArray(gals) ? gals : gals.items ?? []).slice(0, 3)) {
    add(P, 'guest', `/galleries/${g.id}`, `gallery(${g.id})`);
    for (const t of ['calls', 'artists', 'history', 'reviews']) add(P, 'guest', `/galleries/${g.id}?tab=${t}`, `gallery(${g.id})?tab=${t}`);
  }
  for (const scope of ['open', 'closed']) {
    const ex = (await j(`${P.api}/exhibitions?scope=${scope}`)) ?? [];
    for (const e of (Array.isArray(ex) ? ex : ex.items ?? []).slice(0, 2)) add(P, 'guest', `/exhibitions/${e.id}`, `exhibition(${e.id})`);
  }
  const shows = (await j(`${P.api}/shows`)) ?? [];
  for (const s of (Array.isArray(shows) ? shows : shows.items ?? []).slice(0, 2)) add(P, 'guest', `/shows/${s.id}`, `show(${s.id})`);
  const posts = (await j(`${P.api}/community?sort=popular`)) ?? [];
  for (const po of (Array.isArray(posts) ? posts : posts.items ?? posts.posts ?? []).slice(0, 2)) add(P, 'guest', `/community/${po.id}`, `post(${po.id})`);

  // 주소로 여는 창 — 작품 보기(?work=) · 소개 팝업 미리보기(?intro=1)
  if (top[0]) {
    const pf = await j(`${P.api}/portfolio/${top[0].id}`);
    const work = pf?.images?.[0]?.id ?? pf?.portfolio?.images?.[0]?.id;
    const base = top[0].handle ? `/@${top[0].handle}` : `/portfolio/${top[0].id}`;
    if (work) add(P, 'guest', `${base}?work=${work}`, `artwork-viewer(${work})`);
  }
  add(P, 'guest', '/?intro=1', 'guest-intro');
  // 대화방(복제본의 점검 계정 — backend/scripts/seed-audit-chat.ts): 메시지 있는 방 · 빈 방
  for (const c of (args.chats || '').split(',').filter(Boolean)) add(P, 'audit', `/messages?chat=${c}`, `chat(${c})`);

  // ── 로그인(데모) ──
  const D = DEMO;
  const artistTabs = ['profile', 'homepage-edit', 'homepage-edit&section=intro', 'homepage-edit&section=cv', 'homepage-edit&section=file', 'homepage-edit&section=style', 'portfolio', 'favorites', 'applications', 'artlook'];
  for (const t of artistTabs) add(D, 'artist', `/mypage?tab=${t}`);
  add(D, 'artist', '/mypage?tab=homepage-edit&do=info', 'artwork-info-modal');
  for (const p of ['/messages', '/feed', '/community/write', '/support']) add(D, 'artist', p);
  const galleryTabs = ['profile', 'my-galleries', 'my-exhibitions', 'my-shows', 'scraps'];
  for (const t of galleryTabs) add(D, 'gallery', `/mypage?tab=${t}`);
  for (const p of ['/galleries/new', '/exhibitions/new', '/shows/new', '/messages']) add(D, 'gallery', p);
  const adminTabs = ['profile', 'stats', 'approvals', 'hosted-exhibitions', 'hero-manage', 'gotm-manage', 'ad-manage', 'report-manage', 'user-manage', 'oversight', 'todo', 'dev-tools'];
  for (const t of adminTabs) add(D, 'admin', `/mypage?tab=${t}`);
  for (const t of ['profile', 'favorites']) add(D, 'visitor', `/mypage?tab=${t}`);
  // 데모의 공모: 지원서 · 운영 화면
  const dex = (await j(`${D.api}/exhibitions?scope=open`)) ?? [];
  const firstOpen = (Array.isArray(dex) ? dex : dex.items ?? [])[0];
  if (firstOpen) { add(D, 'artist', `/exhibitions/${firstOpen.id}/apply`, `apply(${firstOpen.id})`); add(D, 'artist', `/exhibitions/${firstOpen.id}`, `exhibition-as-artist(${firstOpen.id})`); }
  return list;
}

import { DETECT } from './detect.mjs';

const results = [];
const all = (await routes()).filter((r) => !ONLY || ONLY.test(r.label));
console.log(`화면 ${all.length}개 × 폭 ${WIDTHS.length} (WebKit 은 ${[...WEBKIT_WIDTHS].join('·')}만)`);
const tokens = {};
for (const engName of ENGINES) {
  if (engName === 'webkit' && !fs.existsSync(WEBKIT_RUN)) { console.log('WebKit 래퍼 없음 — 건너뜀'); continue; }
  const browser = await (engName === 'webkit' ? webkit : chromium).launch(engName === 'webkit' ? { executablePath: WEBKIT_RUN } : {});
  for (const w of WIDTHS) {
    if (engName === 'webkit' && !WEBKIT_WIDTHS.has(w)) continue;
    for (const r of all) {
      const key = `${r.stack.web}|${r.who}`;
      if (r.who !== 'guest' && !tokens[key]) tokens[key] = await login(r.stack, r.who === 'artist' ? 'artist1@artlink.com' : r.who === 'audit' ? 'audit.artist.a@example.com' : `${r.who}@artlink.com`);
      const auth = r.who === 'guest' ? null : tokens[key];
      const ctx = await browser.newContext({ viewport: { width: w, height: w < 700 ? 820 : 900 }, deviceScaleFactor: 1, ...(engName === 'chromium' && w < 700 ? { isMobile: true, hasTouch: true } : {}) });
      await ctx.addInitScript((a) => {
        try {
          localStorage.setItem('artlink-member-device', '1');
          if (a) {
            localStorage.setItem('artlink-auth', JSON.stringify({ state: { user: a.user, token: a.token, isAuthenticated: true }, version: 0 }));
            localStorage.setItem('artlink-homepage-nudge-snooze', JSON.stringify({ [String(a.user.id)]: 8.64e15 }));
            localStorage.setItem('artlink-intro-hidden', JSON.stringify({ [String(a.user.id)]: Date.now() }));
          }
          sessionStorage.setItem('artlink-intro-guest-answered', String(Date.now()));
        } catch { /* */ }
      }, auth);
      const page = await ctx.newPage();
      let rec = { engine: engName, width: w, label: r.label, url: r.stack.web + r.path };
      try {
        await page.goto(rec.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(2200);
        // 늦게 뜨는 칸(무한스크롤·지연 그림)을 깨우고 맨 위로
        await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += innerHeight) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)); } scrollTo(0, 0); });
        await page.waitForTimeout(500);
        const d = await page.evaluate(DETECT);
        rec = { ...rec, ...d };
        const bad = d.page > 1 || d.clip.length || d.spill.length || d.offscreen.length;
        if (bad) {
          const f = `${engName}-${w}-${r.label.replace(/[^\w가-힣().=-]+/g, '_')}.png`.slice(0, 180);
          await page.screenshot({ path: path.join(OUT, f), fullPage: true });
          rec.shot = f;
        }
        console.log(`${bad ? '✗' : '✓'} ${engName} ${w} ${r.label}${bad ? `  page+${d.page} clip${d.clip.length} spill${d.spill.length} off${d.offscreen.length}` : ''}`);
      } catch (e) {
        rec.error = String(e).slice(0, 200);
        console.log(`! ${engName} ${w} ${r.label} ${rec.error}`);
      }
      results.push(rec);
      await ctx.close();
    }
  }
  await browser.close();
}
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(results, null, 1));
const bad = results.filter((x) => x.page > 1 || x.clip?.length || x.spill?.length || x.offscreen?.length);
console.log(`\n끝: ${results.length}회 중 걸린 것 ${bad.length} · ${OUT}/report.json`);
