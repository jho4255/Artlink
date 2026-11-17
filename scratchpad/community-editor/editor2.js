/**
 * 글쓰기 2차 — 도구 막대의 [동영상]·[투표]·인용 이름 → 미리보기 → 등록 → 글 화면 → 고치기(표가 생기면 질문·보기 잠금).
 *   node scratchpad/community-editor/editor2.js [chromium|webkit] [desktop|mobile]
 * ⚠️ 복제본·데모 DB 전용. 가상 데모 필진(한지우)으로만 쓴다. 만든 글은 끝에 지운다.
 * ⚠️ WebKit(이 PC, 미디어 없음)은 <video> 가 든 화면이 멈춰 동영상 단계를 건너뛴다.
 */
const { BASE, API, session, launch, api, devices, path } = require('./lib');
const engine = process.argv[2] || 'chromium';
const form = process.argv[3] || 'desktop';
const OUT = (name) => path.join(__dirname, 'out', `ed2-${engine}-${form}-${name}.png`);
const VIDEO = path.join(__dirname, 'media', 'show-salon-walk.webm');
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`); };
async function demoUser(key) {
  const r = await fetch(`${API}/auth/dev-login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `${key}@community-demo.example.com` }) });
  const j = await r.json();
  if (!String(j.user?.email || '').endsWith('@community-demo.example.com')) throw new Error(`데모 계정이 아님: ${key}`);
  return j.user;
}

(async () => {
  const han = await demoUser('han');
  const kim = await demoUser('kim');
  const browser = await launch(engine);
  const o = form === 'mobile' ? { ...devices['iPhone 13'], storageState: session(han).storage } : { viewport: { width: 1280, height: 900 }, storageState: session(han).storage };
  if (engine === 'chromium' && form === 'mobile') delete o.defaultBrowserType;
  const ctx = await browser.newContext(o);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(`console: ${m.text().slice(0, 200)}`); });
  let postId = null;
  try {
    await page.goto(`${BASE}/community/write?tab=worklog`);
    await page.waitForSelector('[data-post-editor] .ProseMirror', { timeout: 20000 });
    const bar = page.getByRole('toolbar', { name: '서식' });
    const labels = await bar.locator('button').evaluateAll((bs) => bs.map((b) => b.getAttribute('aria-label')));
    check('도구 막대 — 동영상·투표가 있고 유튜브·"크게 인용"은 없다', labels.includes('동영상 넣기') && labels.includes('투표 넣기') && !labels.some((l) => /유튜브|크게 인용/.test(l || '')),
      labels.filter((l) => /동영상|투표|인용|강조|유튜브/.test(l || '')).join(' · '));
    await page.fill('#post-title', '점검 — 동영상과 투표가 든 글');
    await page.click('.ProseMirror');
    await page.keyboard.type('다음 작업 주제를 골라 주세요.');

    // 투표 넣기
    await bar.getByRole('button', { name: '투표 넣기' }).click();
    const dlg = page.getByRole('dialog', { name: '투표 넣기' });
    await dlg.waitFor();
    await dlg.getByRole('textbox').first().fill('어느 쪽이 좋을까요?');
    await dlg.getByLabel('보기 1', { exact: true }).fill('물');
    await dlg.getByLabel('보기 2', { exact: true }).fill('빛');
    await dlg.getByRole('button', { name: '보기 더하기' }).click();
    await dlg.getByLabel('보기 3', { exact: true }).fill('그림자');
    await dlg.getByRole('combobox').selectOption({ label: '3일 뒤' });
    await page.screenshot({ path: OUT('poll-dialog') });
    await dlg.getByRole('button', { name: '넣기', exact: true }).click();
    const pollBlocks = await page.locator('.ProseMirror .post-poll').count();
    check('투표 넣기 — 본문에 투표 상자', pollBlocks === 1);
    // 한 글에 하나 — 다시 누르면 고치기 창
    await bar.getByRole('button', { name: '투표 넣기' }).click();
    const again = await page.getByRole('dialog', { name: '투표 고치기' }).count();
    check('[투표]를 또 누르면 새로 넣지 않고 고치기 창', again === 1);
    await page.getByRole('dialog', { name: '투표 고치기' }).getByRole('button', { name: '고치기' }).click();
    check('투표는 여전히 하나', (await page.locator('.ProseMirror .post-poll').count()) === 1);

    // 동영상 넣기
    if (engine !== 'webkit') {
      // 커서를 마지막 문단으로(투표를 고른 채로 두면 다음 입력이 투표를 덮는다 — 사진과 같은 편집기 동작)
      await page.locator('.ProseMirror > p').last().click();
      const chooser = page.waitForEvent('filechooser');
      await bar.getByRole('button', { name: '동영상 넣기' }).click();
      await (await chooser).setFiles(VIDEO);
      await page.waitForFunction(() => {
        const v = document.querySelector('.ProseMirror .post-video video');
        return v && /^https?:|^\/uploads\//.test(v.getAttribute('src') || '') && !(v.getAttribute('src') || '').startsWith('blob:');
      }, null, { timeout: 60000 }).catch(() => {});
      const vsrc = await page.locator('.ProseMirror .post-video video').first().getAttribute('src').catch(() => null);
      check('동영상 넣기 — 올라가 본문에 동영상(서버 주소)', !!vsrc && !vsrc.startsWith('blob:'), String(vsrc).slice(-30));
    } else check('동영상 넣기 — WebKit(미디어 없음)이라 건너뜀', true);

    // 인용 이름 — 넓은 화면은 막대, 휴대폰은 한 단추가 돈다
    await page.locator('.ProseMirror > p').last().click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('좋은 전시는 나올 때 걸음이 느려진다.');
    if (form === 'desktop') await bar.getByRole('button', { name: /^강조 문장/ }).click();
    else { await bar.getByRole('button', { name: '인용구' }).click(); await bar.getByRole('button', { name: /인용구 \(누르면 강조 문장\)/ }).click(); }
    check('강조 문장 — 가운데 큰 인용이 된다', (await page.locator('.ProseMirror blockquote[data-variant="pull"]').count()) === 1);
    await page.screenshot({ path: OUT('editor') });

    // 미리보기
    await page.getByRole('button', { name: '미리보기' }).click();
    const pv = page.getByRole('dialog', { name: '미리보기' });
    await pv.waitFor();
    const pvPoll = await pv.getByRole('group', { name: '투표' }).count();
    check('미리보기 — 투표 상자가 보인다', pvPoll === 1);
    await page.screenshot({ path: OUT('preview') });
    await pv.getByRole('button', { name: '닫기' }).click();

    // 등록
    await page.waitForFunction(() => /저장됨/.test(document.querySelector('[data-post-editor] header [role=status]')?.textContent || ''), null, { timeout: 30000 }).catch(() => {});
    await page.getByRole('button', { name: '등록' }).click();
    await page.waitForURL(/\/community\/\d+$/, { timeout: 30000 });
    postId = Number(page.url().match(/\/community\/(\d+)$/)[1]);
    // 주소는 바로 바뀌지만 글 화면 청크를 받는 동안엔 편집기가 그대로 보인다 — 글 화면이 뜰 때까지
    await page.waitForSelector('[data-post-article]', { timeout: 20000 });
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.getByRole('group', { name: /^투표: / }).first().evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' })).catch(() => {});
    const live = page.getByRole('group', { name: /^투표: 어느 쪽이 좋을까요\?/ });
    check('등록 — 글 화면에 투표(글쓴이는 결과)', (await live.count()) === 1 && (await live.getByLabel('투표 결과').count()) === 1);
    await page.screenshot({ path: OUT('published'), fullPage: false });

    // 표가 생기면 — 고칠 때 질문·보기 잠금
    const post = await api('GET', `/community/${postId}`, session(kim).token);
    const opt = post.body.poll.options[0].id;
    await api('POST', `/community/${postId}/poll`, session(kim).token, { optionIds: [opt] });
    await page.goto(`${BASE}/community/${postId}/edit`);
    await page.waitForSelector('[data-post-editor] .ProseMirror', { timeout: 20000 });
    await page.getByRole('toolbar', { name: '서식' }).getByRole('button', { name: '투표 넣기' }).click();
    const ed = page.getByRole('dialog', { name: '투표 고치기' });
    await ed.waitFor();
    const lockedNote = await ed.getByText('이미 투표한 사람이 있어').count();
    const qDisabled = await ed.getByRole('textbox').first().isDisabled();
    check('표가 생긴 투표 — 질문·보기 잠금(마감만)', lockedNote === 1 && qDisabled);
    await page.screenshot({ path: OUT('poll-locked') });
    await ed.getByRole('button', { name: '고치기' }).click();
    await page.getByRole('button', { name: '나가기' }).click();
    await page.waitForURL(/\/community\/\d+$/, { timeout: 15000 }).catch(() => {});
  } catch (e) {
    check(`진행 중 오류: ${e.message.split('\n')[0]}`, false);
    await page.screenshot({ path: OUT('error') }).catch(() => {});
  } finally {
    // 만든 글·작업본 지우기(데모 데이터를 흔들지 않게)
    if (postId) {
      const del = await api('DELETE', `/community/${postId}`, session(han).token);
      check('정리 — 점검 글 지움', del.status === 200, `#${postId}`);
    }
    const drafts = await api('GET', '/community/drafts', session(han).token);
    for (const d of drafts.body || []) if (/^점검 —/.test(d.title)) await api('DELETE', `/community/drafts/${d.id}`, session(han).token);
  }
  check('오류 없음', errs.length === 0, errs.join(' | ').slice(0, 300));
  const bad = results.filter((x) => !x.ok);
  console.log(`\n${results.length - bad.length}/${results.length} 통과`);
  await browser.close();
  process.exit(bad.length ? 1 : 0);
})().catch((e) => { console.error('실패:', e.message); process.exit(1); });
