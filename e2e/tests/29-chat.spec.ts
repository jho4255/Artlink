import { test, expect, request as pwRequest, type Page } from '@playwright/test';
import { openAs, tokenFor, userIds, applyToExhibition, settle, exhibitionDates, realUploadPath } from '../lib/helpers';

/**
 * ArtTalk (갠톡·단톡) — 2026-08-28 전면 개편분.
 *
 * 예전 쪽지는 라우트마다 "작가는 갤러리에게만" 같은 역할 규칙이 박혀 있어 작가끼리 대화가 아예 안 됐다.
 * 지금은 **방에 들어가 있는가** 하나로만 판정하고, 대신 **방이 생기는 길목**을 좁혔다.
 * 그래서 이 파일이 지켜야 하는 건 셋이다.
 *   ① 길목이 실제로 동작하는가 (둘러보기·작가 홈페이지 → 갠톡 / 공모 수락 → 단톡)
 *   ② 남의 방은 절대 안 보이는가
 *   ③ 화면 규칙(카톡식 묶음·읽음)이 지켜지는가
 */
const API = 'http://localhost:4000/api';

/** 화면에 그려진 말풍선들을 순서대로 (이름/시각이 붙었는지 함께) */
async function bubbles(page: Page) {
  return page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('div.rounded-2xl.px-3.py-2'));
    return rows.map((b) => {
      const col = b.parentElement!;
      const kids = Array.from(col.children);
      const idx = kids.indexOf(b);
      const nameEl = idx > 0 ? kids[idx - 1] : null;
      const metaEl = kids[idx + 1] ?? null;
      return {
        text: (b.textContent || '').trim(),
        mine: b.className.includes('bg-gray-900'),
        name: nameEl ? (nameEl.textContent || '').trim() : null,
        meta: metaEl ? (metaEl.textContent || '').trim() : null,
      };
    });
  });
}

/** 목록에서 방을 골라 **대화가 실제로 열릴 때까지** 기다린다(좁은 화면에선 목록이 숨는다) */
async function openRoom(page: Page, title: string) {
  await page.getByText(title).first().click();
  await expect(page.getByPlaceholder('메시지를 입력하세요')).toBeVisible({ timeout: 15000 });
}

async function send(page: Page, text: string) {
  await page.getByPlaceholder('메시지를 입력하세요').fill(text);
  await page.getByRole('button', { name: '보내기' }).click();
  await expect(page.locator('body')).toContainText(text, { timeout: 8000 });
}

test.describe('갠톡 — 둘러보기·작가 홈페이지에서만 시작된다', () => {
  test('★ 작가가 다른 작가의 홈페이지에서 대화를 연다 (예전 쪽지는 작가끼리가 막혀 있었다)', async ({ browser }) => {
    const ids = userIds();
    const { page, ctx } = await openAs(browser, 'artist');

    await page.goto(`/portfolio/${ids.artist2}`);
    const btn = page.getByRole('button', { name: '메시지' });
    await expect(btn).toBeVisible({ timeout: 10000 });
    await btn.click();

    // 방으로 이동한다 (?chat=N)
    await page.waitForURL(/\/messages\?chat=\d+/, { timeout: 10000 });
    await expect(page.getByRole('heading', { name: 'ArtTalk' })).toBeVisible();
    await send(page, '안녕하세요, 작품 잘 봤습니다.');

    await ctx.close();
  });

  test('★ 상대에게 안읽음 배지로 뜨고, 열면 사라진다', async ({ browser }) => {
    const ids = userIds();
    const a1 = await openAs(browser, 'artist');
    await a1.page.goto(`/portfolio/${ids.artist2}`);
    await a1.page.getByRole('button', { name: '메시지' }).click();
    await a1.page.waitForURL(/\/messages\?chat=\d+/);
    await send(a1.page, '안읽음 확인용 메시지');

    const a2 = await openAs(browser, 'artist2');
    await a2.page.goto('/messages');
    /* 목록의 빨간 개수 배지.
       ⚠️ Navbar 벨/대화 배지도 같은 색 클래스라, 화면 전체에서 찾으면
       그때 감춰져 있는 Navbar 쪽을 집어 "hidden" 으로 실패한다. 대화 목록(ul) 안으로 좁힌다. */
    const badge = a2.page.locator('ul span.bg-\\[\\#c4302b\\]').first();
    await expect(badge).toBeVisible({ timeout: 10000 });

    // 방을 열면 읽음 처리 → 배지 사라짐
    await a2.page.getByText('안읽음 확인용 메시지').first().click();
    await settle(a2.page, 1200);
    await a2.page.goto('/messages');
    await expect(a2.page.locator('ul span.bg-\\[\\#c4302b\\]')).toHaveCount(0, { timeout: 10000 });

    await a1.ctx.close(); await a2.ctx.close();
  });

  test("★ 보낸 사람 화면에 '읽음' 이 뜬다 (상대가 열어야만)", async ({ browser }) => {
    const ids = userIds();
    const a1 = await openAs(browser, 'artist');
    await a1.page.goto(`/portfolio/${ids.artist2}`);
    await a1.page.getByRole('button', { name: '메시지' }).click();
    await a1.page.waitForURL(/\/messages\?chat=\d+/);
    const url = a1.page.url();
    await send(a1.page, '읽음 표시 확인');

    // 아직 상대가 안 열었다 → '읽음' 없음
    await a1.page.reload();
    await expect(a1.page.locator('b', { hasText: /^읽음$/ })).toHaveCount(0);

    const a2 = await openAs(browser, 'artist2');
    await a2.page.goto('/messages');
    await a2.page.getByText('읽음 표시 확인').first().click();
    await settle(a2.page, 1200);

    await a1.page.goto(url);
    /* ⚠️ '읽음' 을 화면 전체에서 찾으면 목록의 미리보기('읽음 표시 확인')에 먼저 걸린다.
       읽음 표시는 말풍선 옆 <b> 다. */
    await expect(a1.page.locator('b', { hasText: /^읽음$/ }).first()).toBeVisible({ timeout: 12000 });

    await a1.ctx.close(); await a2.ctx.close();
  });

  test("화면에 '새 대화' 같은 임의 시작 버튼이 없다 (길목을 좁힌 설계)", async ({ browser }) => {
    const { page, ctx } = await openAs(browser, 'artist');
    await page.goto('/messages');
    await expect(page.getByRole('button', { name: /새 대화|새 채팅/ })).toHaveCount(0);
    await ctx.close();
  });
});

test.describe('카카오톡식 묶음 — 이어 보낸 말은 이름·시각을 한 번만', () => {
  test('★ 내가 세 줄 이어 보내면 시각은 마지막 줄에만 붙는다', async ({ browser }) => {
    const ids = userIds();
    const { page, ctx } = await openAs(browser, 'artist');
    await page.goto(`/portfolio/${ids.artist2}`);
    await page.getByRole('button', { name: '메시지' }).click();
    await page.waitForURL(/\/messages\?chat=\d+/);

    await send(page, '첫 줄입니다');
    await send(page, '두 번째 줄');
    await send(page, '세 번째 줄');

    const list = (await bubbles(page)).filter(b => /줄/.test(b.text));
    expect(list.length).toBeGreaterThanOrEqual(3);
    const last3 = list.slice(-3);
    // 시각(메타)은 묶음의 마지막에만
    const withMeta = last3.filter(b => b.meta && b.meta.length > 0);
    expect(withMeta.length, `시각이 ${withMeta.length}번 찍혔다 — 묶음 규칙이 깨졌다`).toBe(1);
    expect(last3[2].meta).toBeTruthy();

    await ctx.close();
  });
});

test.describe('단톡 (공모방) — 서버가 만든다', () => {
  let exId: number;
  let exTitle: string;

  test.beforeAll(async () => {
    const api = await pwRequest.newContext();
    const gTok = tokenFor('gallery');
    const adminTok = tokenFor('admin');

    const gs = await api.get(`${API}/galleries?owned=true`, { headers: { Authorization: `Bearer ${gTok}` } });
    const gl = await gs.json();
    const galleryId = (Array.isArray(gl) ? gl : gl.galleries).find((g: any) => g.status === 'APPROVED').id;

    const today = new Date().toISOString().slice(0, 10);
    const future = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
    exTitle = `단톡검증 ${Date.now()}`;
    const cr = await api.post(`${API}/exhibitions`, {
      headers: { Authorization: `Bearer ${gTok}` },
      data: {
        title: exTitle, type: 'SOLO', deadlineStart: today, deadline: future,
        exhibitDate: future, exhibitEndDate: future, capacity: 5, region: 'SEOUL',
        description: '단톡 E2E', galleryId, ...exhibitionDates() },
    });
    exId = (await cr.json()).id;
    await api.patch(`${API}/approvals/exhibition/${exId}`, {
      headers: { Authorization: `Bearer ${adminTok}` }, data: { status: 'APPROVED' },
    });

    // 작가1 지원 → 갤러리가 수락 (여기서 단톡에 합류한다)
    const apply = await applyToExhibition(api, exId, tokenFor('artist'));
    const appId = (await apply.json()).id;
    await api.patch(`${API}/exhibitions/${exId}/applications/${appId}`, {
      headers: { Authorization: `Bearer ${gTok}` }, data: { status: 'ACCEPTED' },
    });
    await api.dispose();
  });

  test('★ 수락된 작가와 갤러리 양쪽 목록에 같은 공모 단톡이 보인다', async ({ browser }) => {
    for (const role of ['artist', 'gallery'] as const) {
      const { page, ctx } = await openAs(browser, role);
      await page.goto('/messages');
      await expect(page.locator('body')).toContainText(exTitle, { timeout: 12000 });
      await ctx.close();
    }
  });

  test('★ 단톡에서는 남의 말에 이름이 붙는다 (누가 한 말인지 알아야 한다)', async ({ browser }) => {
    const g = await openAs(browser, 'gallery');
    await g.page.goto('/messages');
    await openRoom(g.page, exTitle);
    await send(g.page, '참여해주셔서 감사합니다.');
    await g.ctx.close();

    const a = await openAs(browser, 'artist');
    await a.page.goto('/messages');
    await openRoom(a.page, exTitle);

    const list = await bubbles(a.page);
    const theirs = list.find(b => b.text.includes('참여해주셔서'));
    expect(theirs, '갤러리가 보낸 말이 말풍선에 없다 (방이 안 열렸거나 전달 안 됨)').toBeTruthy();
    expect(theirs!.mine).toBe(false);
    expect(theirs!.name, '단톡에서 남의 말인데 이름이 없다').toBeTruthy();

    await a.ctx.close();
  });

  test('단톡 머리말에 참여자 수와 [공모 보기]가 있다', async ({ browser }) => {
    const { page, ctx } = await openAs(browser, 'artist');
    await page.goto('/messages');
    await openRoom(page, exTitle);
    await expect(page.getByText(/참여자 \d+명/)).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: '공모 보기' }).click();
    await page.waitForURL(new RegExp(`/exhibitions/${exId}`), { timeout: 10000 });
    await ctx.close();
  });

  test('★ 참여하지 않은 작가에게는 그 방이 아예 없다 (목록에도, 주소로도)', async ({ browser }) => {
    // 방 id 를 알아내서 직접 두드려 본다
    const api = await pwRequest.newContext();
    const r = await api.get(`${API}/chats`, { headers: { Authorization: `Bearer ${tokenFor('artist')}` } });
    const rooms = await r.json();
    const room = rooms.find((c: any) => c.exhibitionId === exId);
    expect(room, '작가1의 목록에 공모 단톡이 없다').toBeTruthy();

    const denied = await api.get(`${API}/chats/${room.id}`, { headers: { Authorization: `Bearer ${tokenFor('artist2')}` } });
    expect(denied.status(), '403 은 방의 존재를 알려준다 — 404 여야 한다').toBe(404);

    // Admin 도 예외가 아니다
    const adminTry = await api.get(`${API}/chats/${room.id}`, { headers: { Authorization: `Bearer ${tokenFor('admin')}` } });
    expect(adminTry.status()).toBe(404);
    await api.dispose();

    const { page, ctx } = await openAs(browser, 'artist2');
    await page.goto(`/messages?chat=${room.id}`);
    await settle(page, 1500);
    await expect(page.locator('body')).not.toContainText(exTitle);
    await ctx.close();
  });
});

/**
 * 6턴 왕복 — 옛 `01-messaging.spec.ts` 의 지속 시나리오를 ArtTalk 으로 옮겨 왔다.
 * (그 파일은 사라진 쪽지 UI(제목+textarea)를 두드리고 있어 더는 돌지 않는다)
 *
 * 단발 검증으로는 "두 번째 메시지부터 안 쌓인다", "상대 화면에는 순서가 뒤집힌다",
 * "한 번 읽으면 그 뒤로는 안읽음이 안 걸린다" 같은 것을 못 잡는다.
 */
test.describe('지속 대화 — 6턴 왕복', () => {
  test('★ 누적·순서·안읽음이 여섯 턴 내내 유지된다', async ({ browser }) => {
    const ids = userIds();
    const api = await pwRequest.newContext();

    // 갤러리가 작가 홈페이지에서 말을 건다 (갠톡 길목)
    const gallery = await openAs(browser, 'gallery');
    await gallery.page.goto(`/portfolio/${ids.artist}`);
    await gallery.page.getByRole('button', { name: '메시지' }).click();
    await gallery.page.waitForURL(/\/messages\?chat=\d+/, { timeout: 15000 });
    const roomUrl = gallery.page.url();
    const chatId = Number(new URL(roomUrl).searchParams.get('chat'));

    const artist = await openAs(browser, 'artist');
    const artistUnread = async () =>
      (await (await api.get(`${API}/chats/unread-count`, {
        headers: { Authorization: `Bearer ${tokenFor('artist')}` },
      })).json()).count;

    const turns: { who: 'gallery' | 'artist'; text: string }[] = [
      { who: 'gallery', text: '지원 잘 봤습니다. 포트폴리오 인상깊네요 (1)' },
      { who: 'artist', text: '안녕하세요! 관심 가져주셔서 감사합니다 (2)' },
      { who: 'gallery', text: '전시 일정은 다음달 초를 생각 중입니다 (3)' },
      { who: 'artist', text: '좋습니다. 작품 사이즈 조율 가능할까요? (4)' },
      { who: 'gallery', text: '네 가능합니다. 도면 보내드릴게요 (5)' },
      { who: 'artist', text: '확인했습니다. 잘 부탁드립니다 (6)' },
    ];

    const seen: string[] = [];
    for (const turn of turns) {
      const actor = turn.who === 'artist' ? artist : gallery;
      await actor.page.goto(`/messages?chat=${chatId}`);
      await expect(actor.page.getByPlaceholder('메시지를 입력하세요')).toBeVisible({ timeout: 15000 });

      /* 지금까지의 말이 전부 남아 있어야 한다.
         ⚠️ 같은 문구가 목록의 '마지막 메시지 미리보기'에도 찍히므로 **말풍선만** 본다
         (화면 전체에서 찾으면 strict mode 위반으로 죽는다). */
      const shown = await bubbles(actor.page);
      for (const prev of seen) {
        expect(shown.some(b => b.text.includes(prev)), `"${prev}" 가 말풍선에서 사라졌다`).toBe(true);
      }
      // 작가가 방을 열었으면 안읽음은 0 이 된다
      if (turn.who === 'artist') {
        await expect.poll(artistUnread, { timeout: 10000 }).toBe(0);
      }

      await send(actor.page, turn.text);
      seen.push(turn.text);

      // 갤러리가 말한 직후에는 작가 안읽음이 올라간다
      if (turn.who === 'gallery') {
        await expect.poll(artistUnread, { timeout: 10000 }).toBeGreaterThan(0);
      }
      await settle(actor.page, 400);
    }

    // 양쪽 화면 모두 여섯 줄이 순서대로
    for (const actor of [artist, gallery]) {
      await actor.page.goto(`/messages?chat=${chatId}`);
      await expect(actor.page.getByPlaceholder('메시지를 입력하세요')).toBeVisible({ timeout: 15000 });
      const texts = (await bubbles(actor.page)).map(b => b.text);
      const idx = seen.map(s => texts.findIndex(t => t.includes(s)));
      expect(idx.every(i => i >= 0), '여섯 줄 중 빠진 게 있다').toBe(true);
      expect([...idx].sort((a, b) => a - b), '순서가 뒤집혔다').toEqual(idx);
    }

    await api.dispose();
    await artist.ctx.close();
    await gallery.ctx.close();
  });
});

test.describe('첨부 — 사진·동영상·파일 (2026-08-28)', () => {
  /** 작가↔작가2 갠톡을 열고 방 화면으로 이동 */
  async function openDirectRoom(page: Page, otherId: number) {
    await page.goto(`/portfolio/${otherId}`);
    await page.getByRole('button', { name: '메시지' }).click();
    await page.waitForURL(/\/messages\?chat=\d+/, { timeout: 15000 });
    await expect(page.getByPlaceholder('메시지를 입력하세요')).toBeVisible({ timeout: 15000 });
  }

  /** 첨부 메뉴에서 종류를 골라 실제 파일을 올린다 (native filechooser 처리) */
  async function attach(page: Page, kind: '사진' | '동영상' | '파일', filePath: string) {
    await page.getByRole('button', { name: '첨부' }).click();
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.getByRole('button', { name: kind, exact: true }).click(),
    ]);
    await chooser.setFiles(filePath);
  }

  test('★ 사진을 보내면 대화에 이미지가 뜨고, 목록 미리보기는 [사진]', async ({ browser }) => {
    const ids = userIds();
    const { page, ctx } = await openAs(browser, 'artist');
    await openDirectRoom(page, ids.artist2);

    const before = await page.locator('.overflow-y-auto img').count();
    await attach(page, '사진', realUploadPath('image'));

    // 업로드→전송 후 말풍선 영역에 이미지가 하나 늘어난다
    await expect.poll(async () => page.locator('.overflow-y-auto img').count(), { timeout: 20000 })
      .toBeGreaterThan(before);

    // 목록으로 나가면 미리보기가 [사진]
    await page.goto('/messages');
    await expect(page.locator('ul').getByText('[사진]').first()).toBeVisible({ timeout: 10000 });
    await ctx.close();
  });

  test('★ 파일을 보내면 파일명·다운로드 링크가 뜬다', async ({ browser }) => {
    const ids = userIds();
    const { page, ctx } = await openAs(browser, 'artist');
    await openDirectRoom(page, ids.artist2);

    await attach(page, '파일', realUploadPath('pdf'));

    // 파일 첨부는 <a download> 로 렌더 — 다운로드 안내 + .pdf 파일명
    const fileLink = page.locator('a[download]').last();
    await expect(fileLink).toBeVisible({ timeout: 20000 });
    await expect(fileLink).toContainText('.pdf');
    await expect(fileLink).toContainText('다운로드');
    await ctx.close();
  });

  test('★ 상대 화면에도 첨부가 그대로 보인다', async ({ browser }) => {
    const ids = userIds();
    const a1 = await openAs(browser, 'artist');
    await openDirectRoom(a1.page, ids.artist2);
    await attach(a1.page, '사진', realUploadPath('image'));
    await expect.poll(async () => a1.page.locator('.overflow-y-auto img').count(), { timeout: 20000 }).toBeGreaterThan(0);
    await a1.ctx.close();

    const a2 = await openAs(browser, 'artist2');
    await a2.page.goto('/messages');
    // 갠톡 상대(artist) 방을 연다
    await a2.page.getByText('Artist 1').first().click().catch(() => {});
    await settle(a2.page, 800);
    await expect(a2.page.locator('.overflow-y-auto img').first()).toBeVisible({ timeout: 15000 });
    await a2.ctx.close();
  });

  test('본문 없이 첨부만 보내도 빈 말풍선이 생기지 않는다', async ({ browser }) => {
    const ids = userIds();
    const { page, ctx } = await openAs(browser, 'artist');
    await openDirectRoom(page, ids.artist2);
    const countEmptyBubbles = () => page.locator('div.rounded-2xl.px-3.py-2').evaluateAll(
      els => els.filter(e => (e.textContent || '').trim() === '').length,
    );
    const before = await countEmptyBubbles();
    await attach(page, '사진', realUploadPath('image'));
    await expect.poll(async () => page.locator('.overflow-y-auto img').count(), { timeout: 20000 }).toBeGreaterThan(0);
    // 첨부만 보낸 메시지는 텍스트 말풍선을 만들지 않는다(빈 회색 상자 금지)
    expect(await countEmptyBubbles()).toBe(before);
    await ctx.close();
  });
});
