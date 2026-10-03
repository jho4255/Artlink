// W. 흐름 화면 기하 — 크롬 + WebKit × PC·아이폰13·작은 안드로이드(360) : 가로 넘침 · 잘림 · 주 버튼이 실제로 눌리는가
const L = require('./lib.js');
const path = require('path'); const fs = require('fs');
const WEBKIT_RUN = path.join(process.env.HOME, '.cache/wk-deps/run.sh');
const engines = [['chromium', L.chromium, {}]];
if (fs.existsSync(WEBKIT_RUN)) engines.push(['webkit', L.webkit, { executablePath: WEBKIT_RUN }]);
const VIEWS = [
  // [이름, 역할, 주소, 준비(page) → 확인할 버튼 로케이터 목록]
  ['작가·모집공고 목록', 'haewon.noh@demo.artlink.local', '/exhibitions', async (p) => []],
  // 2026-10-03 수정 후: 따라오는 줄이라 **첫 화면에서 그대로** 눌려야 한다(스크롤 없이, soft 아님)
  ['작가·공모 상세', 'haewon.noh@demo.artlink.local', '/exhibitions/7', async (p) => [['지원하기(첫 화면)', p.locator('[data-apply-bar]').getByRole('button', { name: /지원하기/ })]]],
  ['비로그인·공모 상세', null, '/exhibitions/7', async (p) => [['로그인하고 지원하기(첫 화면)', p.locator('[data-apply-bar]').getByRole('button', { name: /로그인하고 지원하기/ })]]],
  ['작가·지원서', 'haewon.noh@demo.artlink.local', '/exhibitions/7/apply', async (p) => [['지원하기(하단 바)', p.getByRole('button', { name: '지원하기', exact: true })]]],
  ['작가·내 전시 출품 자료', 'artist', '/mypage?tab=applications&ex=8', async (p) => [['갤러리에 제출', p.getByRole('button', { name: /갤러리에 제출|변경 내용 제출|제출 완료/ }).first()], ['임시저장', p.getByRole('button', { name: '임시저장' }).first()]]],
  // 아직 답하지 않은 작가(Artist 1 = PENDING)로 — 강윤서는 이미 이의를 내서 2026-10-03 부터 정산 구역이 자동으로 펼쳐지지 않는다(의도)
  // ⚠️ 시드의 확인 요청 시각이 오래돼 하니스를 도는 사이 '무응답 3일 자동 수락'(규칙 26)이 Artist 1 을 확인함으로 바꿀 수 있다 —
  //    그러면 [문제 제기] 대신 '✓ 확인했어요' 가 맞는 화면이다. 둘 중 하나가 있으면 통과(soft 아님: 둘 다 없으면 문제)
  ['작가·정산 확인', 'artist', '/mypage?tab=applications&ex=13', async (p) => {
    if (await p.getByText('✓ 확인했어요').count()) return [];
    return [['정산 확인/문제 제기', p.getByRole('button', { name: '문제 제기' }).first(), 'scroll']];
  }],
  // 이의를 낸 작가 — 할 일 줄은 회색 '기다림' 문장이어야 한다(버튼 크기 검사 대상이 아니라 글자가 있는지만)
  ['작가·정산 이의 낸 뒤', 'kang', '/mypage?tab=applications&ex=13', async (p) => {
    if (!(await p.getByText('이의를 전달했어요').count())) throw new Error("'이의를 전달했어요' 할 일 줄이 없다");
    return [];
  }],
  ['갤러리·내 공모', 'gallery', '/mypage?tab=my-exhibitions', async (p) => [['카드 [운영] 토글', p.locator('#ex-card-7').getByRole('button', { name: '운영', exact: true }), 'scroll'], ['카드 제목', p.locator('#ex-card-7 button').filter({ has: p.locator('span.truncate') }).first(), 'scroll']]],
  ['갤러리·지원자', 'gallery', '/mypage?tab=my-exhibitions&ex=7&panel=applicants', async (p) => { const row = p.locator('#ex-card-7 li').filter({ hasText: '검토 대기' }).first(); await row.locator('button[aria-expanded]').first().click(); await p.waitForTimeout(500); return [['수락하기', row.getByRole('button', { name: '수락하기', exact: true }), 'scroll'], ['거절', row.getByRole('button', { name: '거절', exact: true }), 'scroll']]; }],
  ['갤러리·운영(출품 자료)', 'gallery', '/mypage?tab=my-exhibitions&ex=8&panel=operation', async (p) => [['전시 확정하기', p.locator('#ex-card-8').getByRole('button', { name: '전시 확정하기' }), 'scroll']]],
  ['갤러리·운영 전용(정산)', 'gallery', '/exhibitions/12/operation/new', async (p) => { const reg = p.locator('#op-12-settlement'); /* exact — 구역 머리 버튼('정산 판매 입력 전')도 걸려 접어 버렸다 */ const open = reg.getByRole('button', { name: '판매 입력', exact: true }).first(); if (await open.count()) { await open.click(); await p.waitForTimeout(300); } const box = reg.getByRole('checkbox', { name: /판매됨/ }).first(); if (await box.count()) { await box.scrollIntoViewIfNeeded(); await box.check(); await p.waitForTimeout(200); } return [['작가에게 확인 요청', reg.getByRole('button', { name: '작가에게 확인 요청' }), 'scroll'], ['판매가 칸', reg.getByLabel('판매가').first(), 'scroll']]; }],
  ['갤러리·공모 등록', 'gallery', '/exhibitions/new', async (p) => [['등록 요청', p.getByRole('button', { name: '등록 요청' }), 'scroll']]],
];
L.login('kang').catch(() => {});
(async () => {
  const kang = 'yunseo.kang@demo.artlink.local';
  let bad = 0, total = 0;
  for (const [engName, eng, opts] of engines) {
    const browser = await eng.launch(opts);
    for (const screen of ['pc', 'mobile', 'small']) {
      for (const [name, role, url, prep] of VIEWS) {
        const { page, ctx } = await L.open(browser, role === 'kang' ? kang : role, screen);
        try {
          await page.goto(url, { waitUntil: 'domcontentloaded' }); await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(1300);
          const checks = await prep(page);
          const m = await L.measure(page);
          const issues = [];
          if (m.overflowX > 1) issues.push(`가로 넘침 ${m.overflowX}px`);
          if (m.clipped.length) issues.push(`잘림 ${m.clipped.slice(0, 3).join(' | ')}`);
          for (const [label, loc, mode] of checks) {
            total++;
            if (!(await loc.count())) { issues.push(`「${label}」 없음`); continue; }
            // 가운데로 — scrollIntoViewIfNeeded 는 화면 맨 아래 가장자리에 세워 고정 탭바·저장 줄과 겹친 채로 재게 된다(1차 점검의 오탐)
            if (mode === 'scroll') await loc.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' })).catch(() => {});
            const h = await L.hit(page, loc);
            if (!h.ok && !(mode === 'soft')) issues.push(`「${label}」 안 눌림 — ${h.why}`);
            if (!h.ok && mode === 'soft') issues.push(`(참고) 「${label}」 첫 화면 밖 — ${h.why}`);
            const box = await loc.boundingBox();
            if (box && Math.min(box.width, box.height) < 40) issues.push(`「${label}」 작음 ${Math.round(box.width)}×${Math.round(box.height)}`);
          }
          const log = page.__log;
          if (log.pageErrors.length) issues.push(`페이지 오류 ${log.pageErrors[0]}`);
          total++;
          if (issues.filter((i) => !i.startsWith('(참고)')).length) bad++;
          if (issues.length) console.log(`✗ ${engName}/${screen} · ${name}: ${issues.join(' ; ')}`);
        } catch (e) { bad++; console.log(`✗ ${engName}/${screen} · ${name}: 예외 ${String(e).slice(0, 160)}`); }
        await ctx.close();
      }
    }
    await browser.close();
  }
  console.log(`\n확인 ${total}건 · 문제 화면 ${bad}건`);
})().catch((e) => { console.error(e); process.exit(1); });
