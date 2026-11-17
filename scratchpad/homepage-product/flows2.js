/**
 * 홈페이지 개편(규칙 82) — 회원·주인 흐름. ⚠️ 로컬 전용 · 가상 계정(@community-demo.example.com)만 쓴다. 만든 대화·문의는 끝에서 지운다.
 *   OWNER=596(한지우) MEMBER=601(김민서) node scratchpad/homepage-product/flows2.js
 *  ① 회원이 [문의하기] → 보내기 → '메시지를 보냈어요' (ArtTalk 방이 생긴다)
 *  ② 주인이 비회원 문의를 켜면 비회원이 이름·연락처로 보낸다 → 주인 벨 알림 → [받은 문의] 가 그 문의를 펼친다 → 삭제
 *  ③ 주인 화면 — 머리의 [수정] · 한 번 뜨는 안내 · [꾸미기] 구역
 */
const { execFileSync } = require('child_process');
const { BASE, launch, devices, path, session, api } = require('../community-editor/lib');

const OUT = process.env.OUT || '/tmp/claude-1000/-home-jho4255-ArtLink/aabb9dca-5a67-40f0-bba1-6510126c6f16/scratchpad/hp-impl';
const DB = process.env.DB || 'artlink_prod';
const OWNER = { id: Number(process.env.OWNER || 596), role: 'ARTIST', name: '한지우', nickname: '한지우', email: 'x@community-demo.example.com', handle: 'hanjiwoo.studio' };
const MEMBER = { id: Number(process.env.MEMBER || 601), role: 'ARTIST', name: '김민서', nickname: '김민서', email: 'y@community-demo.example.com' };
const PAGE = `/@${OWNER.handle}`;
const sql = (q) => execFileSync('psql', ['-h', 'localhost', '-U', 'artlink', '-d', DB, '-At', '-c', q], { env: { ...process.env, PGPASSWORD: 'artlink_dev_password' } }).toString().trim();
const ok = (cond, msg) => { console.log(`${cond ? 'OK  ' : 'FAIL'} ${msg}`); if (!cond) process.exitCode = 1; };

(async () => {
  // 안전장치 — 가상 계정이 아니면 멈춘다
  const emails = sql(`select string_agg(email, ',') from "User" where id in (${OWNER.id}, ${MEMBER.id})`);
  if (!emails.split(',').every((e) => e.endsWith('@community-demo.example.com'))) throw new Error('가상 계정이 아닙니다: ' + emails);
  const chatsBefore = sql(`select coalesce(string_agg(id::text, ','), '') from "Chat"`);

  const browser = await launch('chromium');
  try {
    // ① 회원 문의 → ArtTalk
    {
      const s = session(MEMBER);
      const ctx = await browser.newContext({ ...devices['iPhone 13'], storageState: s.storage });
      const page = await ctx.newPage();
      await page.goto(`${BASE}${PAGE}`);
      await page.getByTestId('homepage-actions').getByRole('button', { name: '문의하기' }).click();
      const inq = page.getByTestId('inquiry-sheet');
      await inq.waitFor();
      await inq.getByRole('textbox').fill('전시 일정 문의드립니다. (점검용 가상 메시지)');
      await page.screenshot({ path: path.join(OUT, 'member-inquiry.png') });
      await inq.getByRole('button', { name: '보내기' }).click();
      await inq.getByText('메시지를 보냈어요').waitFor({ timeout: 8000 });
      ok(true, '① 회원 → 메시지를 보냈어요');
      await inq.getByRole('button', { name: '대화 보기' }).click();
      await page.waitForURL(/\/messages\?chat=\d+/, { timeout: 8000 });
      ok(true, '① [대화 보기] → ArtTalk 그 방');
      await ctx.close();
    }

    // ② 비회원 문의
    sql(`update "Portfolio" set "guestInquiry"=true where "userId"=${OWNER.id}`);
    {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const page = await ctx.newPage();
      await page.goto(`${BASE}${PAGE}`);
      await page.getByTestId('homepage-actions').getByRole('button', { name: '문의하기' }).click();
      const inq = page.getByTestId('inquiry-sheet');
      await inq.waitFor();
      await inq.getByLabel('이름', { exact: true }).fill('점검 방문자');
      await inq.getByRole('textbox', { name: /^연락처/ }).fill('visitor-check@example.com');
      await inq.getByLabel('내용', { exact: true }).fill('작품 구매 문의(점검용).');
      await inq.getByRole('button', { name: '보내기' }).click();
      ok(await inq.getByText('개인정보 수집·이용에 동의해 주세요.').isVisible(), '② 동의 안 하면 막힌다');
      await inq.getByTestId('inquiry-agree').check();
      await page.screenshot({ path: path.join(OUT, 'guest-inquiry.png') });
      await inq.getByRole('button', { name: '보내기' }).click();
      await inq.getByText('문의를 보냈어요').waitFor({ timeout: 8000 });
      ok(true, '② 비회원 → 문의를 보냈어요');
      await ctx.close();
    }
    const inqId = Number(sql(`select max(id) from "HomepageInquiry" where "ownerId"=${OWNER.id}`));
    const note = sql(`select "linkUrl" from "Notification" where "userId"=${OWNER.id} and type='HOMEPAGE_INQUIRY' order by id desc limit 1`);
    ok(note === `/mypage?tab=received-inquiries&inquiry=${inqId}`, `② 주인 벨 알림 링크 ${note}`);

    // ③ 주인 화면 + 받은 문의
    {
      const s = session(OWNER);
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, storageState: s.storage });
      const page = await ctx.newPage();
      await page.goto(`${BASE}${PAGE}`);
      await page.getByTestId('homepage-cover').waitFor();   // 머리는 로딩 중에도 그려진다 — 표지가 떠야 데이터가 온 것
      ok(await page.getByTestId('homepage-owner-action').isVisible(), '③ 주인에게 머리의 [수정]');
      ok(await page.getByTestId('site-notice').isVisible(), '③ 주인에게 한 번 — 새 모양 안내');
      ok(!(await page.getByTestId('homepage-actions').getByRole('button', { name: '문의하기' }).count()), '③ 주인에겐 [문의하기]가 없다');
      await page.screenshot({ path: path.join(OUT, 'owner-desktop.png') });
      await page.getByTestId('site-notice').getByRole('button', { name: '안내 닫기' }).click();
      await page.reload();
      await page.getByTestId('homepage-cover').waitFor();
      ok(!(await page.getByTestId('site-notice').count()), '③ 닫으면 다시 안 뜬다');

      await page.goto(`${BASE}${note}`);
      const row = page.locator(`#received-inquiry-${inqId}`);
      await row.waitFor({ timeout: 8000 });
      await page.waitForTimeout(500);
      ok(await row.getByText('visitor-check@example.com').isVisible(), '③ 알림 링크 → 그 문의가 펼쳐져 있다(연락처 보임)');
      ok(!/inquiry=/.test(page.url()), '③ 주소에서 inquiry= 를 뗀다');
      await page.screenshot({ path: path.join(OUT, 'received.png') });
      await row.getByRole('button', { name: '삭제' }).click();
      await page.getByRole('dialog').getByRole('button', { name: '삭제' }).click();
      await page.waitForTimeout(800);
      ok(Number(sql(`select count(*) from "HomepageInquiry" where id=${inqId}`)) === 0, '③ 삭제하면 DB 에서 지워진다');

      await page.goto(`${BASE}/mypage?tab=homepage-edit&section=style`);
      await page.getByTestId('style-cover').waitFor({ timeout: 8000 });
      await page.screenshot({ path: path.join(OUT, 'editor-style.png'), fullPage: true });
      ok(await page.getByTestId('guest-inquiry').isChecked(), '③ [꾸미기] 문의 — 켜 둔 값이 보인다');
      await ctx.close();
    }
  } finally {
    // 되돌리기 — 비회원 문의 끄기 · 이번에 생긴 대화방 지우기 · 남은 점검 문의·알림 지우기
    sql(`update "Portfolio" set "guestInquiry"=false where "userId"=${OWNER.id}`);
    const after = sql(`select coalesce(string_agg(id::text, ','), '') from "Chat"`).split(',').filter(Boolean);
    const created = after.filter((id) => !chatsBefore.split(',').includes(id));
    if (created.length) {
      sql(`delete from "ChatMessage" where "chatId" in (${created.join(',')})`);
      sql(`delete from "ChatParticipant" where "chatId" in (${created.join(',')})`);
      sql(`delete from "Chat" where id in (${created.join(',')})`);
    }
    sql(`delete from "HomepageInquiry" where "ownerId"=${OWNER.id}`);
    sql(`delete from "Notification" where "userId" in (${OWNER.id}, ${MEMBER.id}) and type in ('HOMEPAGE_INQUIRY','CHAT_MESSAGE') and "createdAt" > now() - interval '1 hour'`);
    console.log('정리: 대화방', created.length, '개 지움');
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
