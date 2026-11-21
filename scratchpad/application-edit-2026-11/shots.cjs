/**
 * 규칙 90 구현 확인 스크린샷 — 데모(5183/4001, DB artlink) 전용. 가상 데모 계정만 쓴다(artist1·artist2·gallery).
 * ⚠️ 첫 판(모집 마감 → [선정 마치기]) 때 찍은 것 — 지금 규칙(수락만 · 선정 마감일)과 다르다.
 *   DATABASE_URL=<로컬 데모 DB> SP=<세션 스크래치(tok.cjs 가 있는 곳)> node scratchpad/application-edit-2026-11/shots.cjs
 * 데모 데이터: seed-flow-stages 의 [단계 03](18) · seed-admin-demo 의 [관리자 예시] 겨울 드로잉 클럽(30).
 * ⚠️ 데이터를 바꾼다(18 모집 마감 · 30 의 Artist 2 지원 취소 · Artist 1 지원서 고치기) — 다시 찍으려면 두 시드를 --clean 후 다시 심을 것.
 */
const { chromium, devices } = require('/home/jho4255/ArtLink/e2e/node_modules/playwright');
const { execSync, execFileSync } = require('child_process');
const path = require('path');
const SP = process.env.SP; const FE = 'http://localhost:5183';
const OUT = path.join(__dirname, 'shots');
// 공모 번호는 시드를 다시 심을 때마다 바뀐다 — 제목으로 찾는다(데모 DB)
const q = (sql) => execFileSync('psql', [process.env.DATABASE_URL, '-Atc', sql]).toString().trim();
const EX_OPEN = Number(q(`select id from "Exhibition" where title like '[단계 03]%' order by id desc limit 1`));
const EX_ADMIN = Number(q(`select id from "Exhibition" where title like '[관리자 예시] 겨울 드로잉%' order by id desc limit 1`));
if (!EX_OPEN || !EX_ADMIN) throw new Error('데모 공모를 찾지 못했다 — seed-flow-stages · seed-admin-demo 를 먼저 심을 것');
const tok = (id, role) => execSync(`node ${SP}/tok.cjs ${id} ${role}`).toString();
const U = {
  1: { id: 1, name: 'Artist 1', email: 'artist1@artlink.com', role: 'ARTIST' },
  2: { id: 2, name: 'Artist 2', email: 'artist2@artlink.com', role: 'ARTIST' },
  3: { id: 3, name: 'Gallery Owner', email: 'gallery@artlink.com', role: 'GALLERY' },
};
const PC = { viewport: { width: 1280, height: 900 } };
const PHONE = { ...devices['iPhone 13'] };
const errs = [];
async function as(browser, id, opts) {
  const c = await browser.newContext(opts);
  const u = U[id];
  await c.addInitScript(([t, u]) => {
    localStorage.setItem('artlink-auth', JSON.stringify({ state: { token: t, user: u, isAuthenticated: true }, version: 0 }));
    localStorage.setItem('artlink-homepage-nudge-snooze', JSON.stringify({ [u.id]: 8.64e15 }));
  }, [tok(id, u.role), u]);
  const p = await c.newPage();
  p.on('pageerror', (e) => errs.push(`${id}: ${String(e).slice(0, 160)}`));
  p.on('dialog', (d) => d.accept());
  return { c, p };
}
const shot = (p, name, full = false) => p.screenshot({ path: path.join(OUT, name), fullPage: full });
const log = (...a) => console.log(...a);

(async () => {
  const b = await chromium.launch();

  // ── ② 작가 — 심사 중인 공고 화면 · 지원서 고치기(PC) ──
  {
    const { c, p } = await as(b, 1, PC);
    await p.goto(`${FE}/mypage?tab=applications&ex=${EX_ADMIN}`);
    await p.locator('[data-application-actions]').waitFor();
    await shot(p, '01-artist-pending-pc.png');
    await p.getByRole('link', { name: '지원서 수정' }).click();
    await p.waitForURL(new RegExp(`/exhibitions/${EX_ADMIN}/apply/edit`));
    await p.locator('#apply-bio textarea').waitFor();
    await shot(p, '02-edit-pc-open.png');
    const bio = p.locator('#apply-bio textarea');
    await bio.fill(`${await bio.inputValue()} 2026년 겨울에는 목탄 드로잉 연작을 새로 그리고 있어요.`);
    // 작품 사진 한 장 빼기 — 두 칸이 '고침'
    const removeBtn = p.locator('#apply-images button[aria-label*="삭제"], #apply-images button[aria-label*="빼"]').first();
    if (await removeBtn.count()) await removeBtn.click();
    await p.evaluate(() => window.scrollTo(0, 0));
    await p.waitForTimeout(300);
    await shot(p, '03-edit-pc-changed.png');
    log('edit bar:', (await p.locator('[data-edit-bar]').innerText()).replace(/\s+/g, ' '));
    await p.getByRole('button', { name: '수정 저장' }).click();
    await p.waitForURL(new RegExp(`tab=applications&ex=${EX_ADMIN}`));
    await p.getByText(/수정$/).first().waitFor({ timeout: 8000 }).catch(() => {});
    await p.waitForTimeout(600);
    await shot(p, '04-after-edit-pc.png');
    await c.close();
  }
  // ── ② 지원서 고치기(휴대폰) — 저장하지 않고 화면만 ──
  {
    const { c, p } = await as(b, 1, PHONE);
    await p.goto(`${FE}/exhibitions/${EX_ADMIN}/apply/edit`);
    const bio = p.locator('#apply-bio textarea');
    await bio.waitFor();
    await bio.fill(`${await bio.inputValue()} 한 줄 더`);
    await p.evaluate(() => window.scrollTo(0, 0));
    await p.waitForTimeout(300);
    await shot(p, '05-edit-mobile.png');
    await c.close();
  }
  // ── ② 갤러리(운영 갤러리) — 지원자 탭의 '수정' ──
  {
    const { c, p } = await as(b, 3, PC);
    await p.goto(`${FE}/mypage?tab=my-exhibitions&ex=${EX_ADMIN}&view=applicants`);
    await p.locator('[data-applicant-manager]').waitFor();
    await p.getByRole('button', { name: /Artist 1/ }).first().click();
    await p.waitForTimeout(500);
    await shot(p, '06-gallery-applicants-edited.png');
    await c.close();
  }
  // ── ③ 작가 2 — 지원 취소(휴대폰) ──
  {
    const { c, p } = await as(b, 2, PHONE);
    await p.goto(`${FE}/mypage?tab=applications&ex=${EX_ADMIN}`);
    await p.locator('[data-application-actions]').waitFor();
    await shot(p, '07-artist2-pending-mobile.png');
    await p.getByRole('button', { name: '지원 취소' }).click();
    const dlg = p.getByRole('dialog', { name: '지원을 취소할까요?' });
    await dlg.waitFor();
    await p.waitForTimeout(400);
    await shot(p, '08-cancel-dialog-mobile.png');
    await dlg.getByRole('button', { name: '지원 취소' }).click();
    await p.waitForURL(new RegExp(`/exhibitions/${EX_ADMIN}$`));
    await p.getByText('지원을 취소했어요.').waitFor();
    await p.waitForTimeout(500);
    await shot(p, '09-after-cancel-mobile.png');
    await c.close();
  }
  // ── ③ 갤러리 벨 — 지원 취소 알림 ──
  {
    const { c, p } = await as(b, 3, PC);
    await p.goto(`${FE}/`);
    await p.getByRole('button', { name: /알림/ }).first().click();
    await p.waitForTimeout(800);
    await shot(p, '10-gallery-bell.png');
    await c.close();
  }
  // ── ① 갤러리 — 모집 중엔 읽기만(PC) ──
  const accept = async (p, name) => {
    await p.getByRole('button', { name: new RegExp(name) }).first().click();
    await p.waitForTimeout(400);
    await p.locator('[data-decision-bar]').getByRole('button', { name: '수락하기', exact: true }).first().click();
    const acc = p.getByRole('dialog', { name: new RegExp(`${name} 님을 수락할까요`) });
    await acc.waitFor();
    await acc.getByRole('button', { name: '수락하기', exact: true }).click();
    await p.waitForTimeout(1200);
  };
  {
    const { c, p } = await as(b, 3, PC);
    await p.goto(`${FE}/mypage?tab=my-exhibitions&ex=${EX_OPEN}&view=applicants`);
    await p.locator('[data-exhibition-workspace]').waitFor();
    await p.waitForTimeout(800);
    await p.getByRole('button', { name: /배소민/ }).first().click();
    await p.waitForTimeout(600);
    log('recruiting bar:', (await p.locator('[data-task-bar]').innerText()).replace(/\s+/g, ' '));
    log('recruiting decision:', (await p.locator('[data-decision-bar]').first().innerText()).replace(/\s+/g, ' '));
    await shot(p, '11-recruiting-readonly-pc.png');
    await c.close();
  }
  // ── ① 갤러리 — 모집 마감 확인창(휴대폰, 띄우고 닫기) ──
  {
    const { c, p } = await as(b, 3, PHONE);
    await p.goto(`${FE}/mypage?tab=my-exhibitions&ex=${EX_OPEN}`);
    await p.locator('[data-exhibition-workspace]').waitFor();
    await p.waitForTimeout(800);
    await p.locator('[data-workspace-bar]').getByRole('button', { name: '모집 마감' }).click();
    const dlg = p.getByRole('dialog', { name: '모집을 마감할까요?' });
    await dlg.waitFor();
    await p.waitForTimeout(400);
    await shot(p, '12-close-dialog-mobile.png');
    await dlg.getByRole('button', { name: '취소' }).click();
    await c.close();
  }
  // ── ① 갤러리 — 모집 마감(PC) → 선정(수락) → [선정 마치기] → 미선정 → 그래도 수락 · [⋯] 메뉴 ──
  {
    const { c, p } = await as(b, 3, PC);
    await p.goto(`${FE}/mypage?tab=my-exhibitions&ex=${EX_OPEN}`);
    await p.locator('[data-exhibition-workspace]').waitFor();
    await p.waitForTimeout(800);
    await p.locator('[data-task-bar]').getByRole('button', { name: '모집 마감' }).click();
    const dlg = p.getByRole('dialog', { name: '모집을 마감할까요?' });
    await dlg.waitFor();
    await p.waitForTimeout(400);
    await shot(p, '13-close-dialog-pc.png');
    log('close dialog:', (await dlg.innerText()).replace(/\s+/g, ' '));
    await dlg.getByRole('button', { name: '모집 마감' }).click();
    await p.getByText('모집을 마감했어요.').waitFor({ timeout: 8000 });
    await p.waitForTimeout(1000);
    await p.getByRole('button', { name: /배소민/ }).first().click();
    await p.waitForTimeout(600);
    await shot(p, '14-after-close-applicants-pc.png');
    await accept(p, '배소민');
    await accept(p, '서진우');
    await p.waitForTimeout(800);
    log('select bar:', (await p.locator('[data-task-bar]').innerText()).replace(/\s+/g, ' '));
    await shot(p, '15-select-task-pc.png');
    await p.locator('[data-task-bar]').getByRole('button', { name: '선정 마치기' }).click();
    const fin = p.getByRole('dialog', { name: '선정을 마칠까요?' });
    await fin.waitFor();
    await p.waitForTimeout(400);
    log('finish dialog:', (await fin.innerText()).replace(/\s+/g, ' '));
    await shot(p, '16-finish-dialog-pc.png');
    await fin.getByRole('button', { name: '선정 마치기' }).click();
    await p.getByText(/선정을 마쳤어요/).first().waitFor({ timeout: 8000 });
    await p.waitForTimeout(800);
    await p.getByRole('button', { name: /Artist 1/ }).first().click();
    await p.waitForTimeout(600);
    await shot(p, '17-after-finish-pc.png');
    await p.getByRole('button', { name: '더 보기' }).first().click();
    await p.waitForTimeout(400);
    log('menu:', (await p.locator('[role="menu"]').first().innerText()).replace(/\s+/g, ' | '));
    await shot(p, '18-more-menu-pc.png');
    await p.keyboard.press('Escape');
    await c.close();
  }
  // ── ① 작가 — 선정을 마칠 때 미선정(휴대폰) ──
  {
    const { c, p } = await as(b, 1, PHONE);
    await p.goto(`${FE}/mypage?tab=applications&ex=${EX_OPEN}`);
    await p.getByText('이번 공모에서는 선정되지 않았어요.').waitFor();
    await p.waitForTimeout(500);
    await shot(p, '19-artist-closed-out-mobile.png');
    await c.close();
  }
  console.log('page errors:', errs.length, errs.slice(0, 5));
  await b.close();
})().catch((e) => { console.error('FAILED', e.message); console.log('page errors:', errs); process.exit(1); });
