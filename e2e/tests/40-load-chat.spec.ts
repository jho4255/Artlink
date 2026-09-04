import { test, expect, request as pwRequest, type APIRequestContext } from '@playwright/test';
import {
  tokenFor, authHeader, fireConcurrently, timed, crowdUsers, openAs,
} from '../lib/helpers';

/**
 * 메시지(ArtTalk) — **이용량이 늘었을 때** 생기는 문제 검증.
 *
 * 이 기능의 트래픽 특성이 다른 것과 다르다:
 *   · `GET /chats/unread-count` 는 **로그인한 모든 사용자가 30초마다** 부른다(Navbar 배지).
 *   · `GET /chats` 는 방마다 안읽음을 따로 센다.
 * 즉 방이 늘어날수록 **한 사람의 배경 폴링 비용이 커진다**. 여기서 그 증가율을 잰다.
 *
 * ⚠️ 안읽음은 참여자별 `lastReadAt` **하나**로 판정한다(메시지마다 읽음 행을 쌓지 않는다).
 *    그래서 "읽었는데 배지가 안 사라진다" 류의 버그는 시각 비교에서만 난다.
 */
const API = 'http://localhost:4000/api';
const ME = 1;                                   // artist(id 1) 를 '많은 방을 가진 사용자'로 쓴다
const H = () => authHeader(tokenFor('artist'));

const crowd = crowdUsers;

async function openDirect(api: APIRequestContext, otherId: number): Promise<number> {
  const r = await api.post(`${API}/chats/direct`, { headers: H(), data: { userId: otherId } });
  if (!r.ok()) throw new Error(`방 열기 실패 ${r.status()}: ${await r.text()}`);
  const b = await r.json();
  return (b.id ?? b.chatId) as number;
}
const send = (api: APIRequestContext, chatId: number, token: string, content: string) =>
  api.post(`${API}/chats/${chatId}/messages`, { headers: authHeader(token), data: { content } });

// ─────────────────────────────────────────────────────────────
// 1. 폴링 비용 — 방이 늘어나면 얼마나 느려지는가
// ─────────────────────────────────────────────────────────────

test('★ 방이 1개 → 17개로 늘 때 안읽음 배지 조회가 얼마나 느려지는가 (N+1 측정)', async () => {
  test.setTimeout(150_000);
  const api = await pwRequest.newContext();
  const people = await crowd(api, 17);

  // 방 1개 상태에서 기준선
  const firstChat = await openDirect(api, people[0].id);
  await send(api, firstChat, people[0].token, '첫 메시지');
  const base = await timed(() => api.get(`${API}/chats/unread-count`, { headers: H() }).then((r) => r.json()));

  // 방을 17개까지 늘리고 각 방에 안 읽은 메시지를 남긴다
  const chats: number[] = [firstChat];
  for (const p of people.slice(1)) {
    const id = await openDirect(api, p.id);
    await send(api, id, p.token, `안읽음 ${p.id}`);
    chats.push(id);
  }

  const many = await timed(() => api.get(`${API}/chats/unread-count`, { headers: H() }).then((r) => r.json()));
  const list = await timed(() => api.get(`${API}/chats`, { headers: H() }).then((r) => r.json()));

  console.log(
    `  [폴링 비용] unread-count 방1=${base.ms}ms(count=${base.value.count}) ` +
    `방${chats.length}=${many.ms}ms(count=${many.value.count}) | 목록=${list.ms}ms(${list.value.length}방)`,
  );

  // 값 자체가 맞아야 한다 — 17개 방 전부 안 읽었으므로 17
  expect(many.value.count, '안읽음 방 개수가 실제와 다르다').toBe(chats.length);

  // 배지는 **모든 로그인 사용자가 30초마다** 부른다. 방 17개에 500ms 를 넘으면
  // 사용자가 늘었을 때 DB 커넥션을 배경 폴링이 다 먹는다.
  expect(many.ms, `안읽음 배지 조회가 ${many.ms}ms — 방마다 쿼리(N+1)를 도는지 확인할 것`).toBeLessThan(1500);
  expect(list.ms, `대화 목록이 ${list.ms}ms — 방마다 count 쿼리를 도는지 확인할 것`).toBeLessThan(2000);

  // 배경 폴링 30명이 동시에 들어오는 상황
  const burst = await timed(() => fireConcurrently(
    Array.from({ length: 30 }, () => () => api.get(`${API}/chats/unread-count`, { headers: H() })),
  ));
  const codes = await Promise.all(burst.value.map(async (r) => (r.status === 'fulfilled' ? r.value.status() : 0)));
  const bad = codes.filter((c) => c !== 200);
  console.log(`  [배경 폴링 30동시] ${burst.ms}ms 실패=${bad.length}`);
  expect(bad, `폴링 동시 요청이 실패했다 (${bad.join(',')}) — 커넥션 풀 고갈 의심`).toHaveLength(0);

  await api.dispose();
});

test('★ 읽으면 배지가 정확히 줄고, 새 메시지가 오면 다시 는다', async () => {
  const api = await pwRequest.newContext();
  const people = await crowd(api, 3);

  const chats: { id: number; token: string }[] = [];
  for (const p of people) {
    const id = await openDirect(api, p.id);
    await send(api, id, p.token, `읽음검증 ${p.id}`);
    chats.push({ id, token: p.token });
  }

  const before = (await (await api.get(`${API}/chats/unread-count`, { headers: H() })).json()).count;
  expect(before).toBeGreaterThanOrEqual(3);

  // 한 방만 읽는다 → 정확히 1 줄어야 한다
  await api.post(`${API}/chats/${chats[0].id}/read`, { headers: H() });
  const mid = (await (await api.get(`${API}/chats/unread-count`, { headers: H() })).json()).count;
  expect(mid, '한 방을 읽었는데 배지가 1 줄지 않았다').toBe(before - 1);

  // 그 방에 새 메시지가 오면 다시 는다
  await send(api, chats[0].id, chats[0].token, '읽은 뒤 새 메시지');
  const after = (await (await api.get(`${API}/chats/unread-count`, { headers: H() })).json()).count;
  expect(after, '읽은 방에 새 메시지가 왔는데 배지가 안 늘었다').toBe(before);

  // 방을 열면(GET /chats/:id) 읽음 처리가 되어야 한다
  await api.get(`${API}/chats/${chats[0].id}`, { headers: H() });
  const opened = (await (await api.get(`${API}/chats/unread-count`, { headers: H() })).json()).count;
  expect(opened, '방을 열었는데 안읽음이 안 사라졌다').toBe(before - 1);
  await api.dispose();
});

// ─────────────────────────────────────────────────────────────
// 2. 동시 전송 — 메시지가 새지 않는가
// ─────────────────────────────────────────────────────────────

test('★ 한 방에 30개를 동시에 보내도 하나도 안 새고 중복도 없다', async () => {
  const api = await pwRequest.newContext();
  const other = (await crowd(api, 1))[0];
  const chatId = await openDirect(api, other.id);

  const stamp = Date.now();
  const mine = Array.from({ length: 15 }, (_, i) => `나-${stamp}-${i}`);
  const theirs = Array.from({ length: 15 }, (_, i) => `상대-${stamp}-${i}`);

  const results = await fireConcurrently([
    ...mine.map((c) => () => send(api, chatId, tokenFor('artist'), c)),
    ...theirs.map((c) => () => send(api, chatId, other.token, c)),
  ]);
  const codes = await Promise.all(results.map(async (r) => (r.status === 'fulfilled' ? r.value.status() : 0)));
  const okN = codes.filter((c) => c === 201).length;
  console.log(`  [동시 전송] 201=${okN}/30 실패=${codes.filter((c) => c !== 201).join(',') || '없음'}`);
  expect(okN, `동시 전송에서 ${30 - okN}건이 실패했다`).toBe(30);

  const room = await (await api.get(`${API}/chats/${chatId}`, { headers: H() })).json();
  const texts: string[] = room.messages.map((m: any) => m.content);
  for (const c of [...mine, ...theirs]) {
    expect(texts.filter((t) => t === c), `메시지 "${c}" 가 유실되거나 중복됐다`).toHaveLength(1);
  }

  // 순서가 단조인가 (묶음 표시와 커서 페이지네이션이 이 순서를 전제한다)
  // ⚠️ **`createdAt` 이 아니라 `id`** 로 본다 — Postgres 의 now() 는 트랜잭션 시작 시각이라
  //    동시에 들어온 메시지는 시각이 같은 밀리초이거나 id 순서와 거꾸로다. id 가 곧 삽입 순서다.
  const ids = room.messages.map((m: any) => m.id);
  expect(ids, '메시지가 순서대로 내려오지 않는다').toEqual([...ids].sort((a, b) => a - b));
  await api.dispose();
});

test('★ 같은 상대와 방을 동시에 20번 열어도 방이 하나만 생긴다', async () => {
  const api = await pwRequest.newContext();
  const other = (await crowd(api, 10))[9].id;

  const results = await fireConcurrently(Array.from({ length: 20 }, () => () =>
    api.post(`${API}/chats/direct`, { headers: H(), data: { userId: other } })));
  const bodies = await Promise.all(results.map(async (r) =>
    (r.status === 'fulfilled' && r.value.ok() ? await r.value.json() : null)));
  const ids = new Set(bodies.filter(Boolean).map((b: any) => b.id ?? b.chatId));
  const failed = results.filter((r) => r.status !== 'fulfilled' || !r.value.ok()).length;

  console.log(`  [방 동시 생성] 성공=${20 - failed} 서로 다른 방 id=${ids.size} → ${[...ids].join(',')}`);
  expect(ids.size, `같은 상대와 방이 ${ids.size}개 생겼다 — directKey 유니크 경합`).toBe(1);

  // 목록에도 하나만
  const list = await (await api.get(`${API}/chats`, { headers: H() })).json();
  const dup = list.filter((c: any) => c.kind === 'DIRECT'
    && c.participants?.some((p: any) => p.id === other));
  expect(dup, `대화 목록에 같은 상대 방이 ${dup.length}개 있다`).toHaveLength(1);
  await api.dispose();
});

test('★ 남의 방은 반복 시도해도 404 — Admin 도 예외가 아니다', async () => {
  const api = await pwRequest.newContext();
  const [a, b] = await crowd(api, 2);
  // a ↔ b 의 방을 a 가 연다 (artist(1) 는 참여자가 아니다)
  const r = await api.post(`${API}/chats/direct`, { headers: authHeader(a.token), data: { userId: b.id } });
  const chatId = (await r.json()).id;
  await send(api, chatId, a.token, '남의 대화');

  for (const [who, token] of [['artist', tokenFor('artist')], ['admin', tokenFor('admin')]] as const) {
    for (let i = 0; i < 3; i++) {
      const g = await api.get(`${API}/chats/${chatId}`, { headers: authHeader(token) });
      expect(g.status(), `${who} 가 남의 방을 열었다`).toBe(404);
      const s = await api.post(`${API}/chats/${chatId}/messages`, {
        headers: authHeader(token), data: { content: '침입' },
      });
      expect(s.status(), `${who} 가 남의 방에 글을 썼다`).toBe(404);
      const rd = await api.post(`${API}/chats/${chatId}/read`, { headers: authHeader(token) });
      expect(rd.status(), `${who} 가 남의 방을 읽음 처리했다`).toBe(404);
    }
  }
  await api.dispose();
});

test('★ 긴 대화(200개)에서도 방 열기가 예산 안이다', async () => {
  test.setTimeout(180_000);
  const api = await pwRequest.newContext();
  const other = (await crowd(api, 1))[0];
  const chatId = await openDirect(api, other.id);

  for (let batch = 0; batch < 10; batch++) {
    await Promise.all(Array.from({ length: 20 }, (_, i) =>
      send(api, chatId, batch % 2 ? other.token : tokenFor('artist'), `대량 ${batch}-${i}`)));
  }

  const raw = await timed(() => api.get(`${API}/chats/${chatId}`, { headers: H() }));
  const open = await raw.value.json();
  const bytes = (await raw.value.body()).length;
  console.log(`  [긴 대화] 200개 넣고 방 열기 → 메시지 ${open.messages.length}개 · ${(bytes / 1024).toFixed(0)}KB · ${raw.ms}ms · hasMore=${open.hasMore}`);
  expect(raw.ms, `방 열기가 ${raw.ms}ms`).toBeLessThan(3000);

  // ⚠️⚠️ 방을 열 때 **쌓인 걸 전부** 내려주면 안 된다 — 화면이 이 응답을 8초마다 다시 받는다.
  //    예전엔 take 가 없어서 5,000개 방이면 1.4MB × 8초마다 = 175KB/s 였다.
  expect(open.messages.length, '방 열기가 메시지를 전부 내려줬다 — 창 제한이 사라졌다').toBeLessThanOrEqual(150);
  expect(bytes, `방 열기 응답이 ${(bytes / 1024).toFixed(0)}KB`).toBeLessThan(80_000);

  // ★ 폴링은 새 것만 받아야 한다 — 조용하면 빈 배열이라 **방 크기와 무관하게** 싸다
  const lastId = open.messages.at(-1).id;
  const poll = await timed(() => api.get(`${API}/chats/${chatId}?after=${lastId}`, { headers: H() }));
  const pollBody = await poll.value.json();
  const pollBytes = (await poll.value.body()).length;
  console.log(`  [증분 폴링] 조용할 때 ${pollBody.messages.length}건 · ${pollBytes}bytes · ${poll.ms}ms`);
  expect(pollBody.messages, '조용한데도 폴링이 메시지를 받아 왔다 — after 커서가 안 먹는다').toHaveLength(0);
  expect(pollBytes, `조용한 폴링이 ${pollBytes}bytes — 증분이 아니다`).toBeLessThan(3_000);

  // 새 말이 오면 그것만 온다
  await send(api, chatId, other.token, '증분 확인용 새 말');
  const delta = await (await api.get(`${API}/chats/${chatId}?after=${lastId}`, { headers: H() })).json();
  expect(delta.messages).toHaveLength(1);
  expect(delta.messages[0].content).toBe('증분 확인용 새 말');

  // [이전 메시지]로 앞을 이어 받으면 빠짐·겹침이 없다
  const older = await (await api.get(`${API}/chats/${chatId}?before=${open.messages[0].id}&limit=150`, { headers: H() })).json();
  const ids = [...older.messages, ...open.messages].map((m: any) => m.id);
  expect(new Set(ids).size, '이전 메시지에 겹침이 있다').toBe(ids.length);
  expect(ids.length, '이전 메시지를 이어 받았는데 총합이 안 맞는다').toBeGreaterThanOrEqual(open.messages.length);
  await api.dispose();
});

// ─────────────────────────────────────────────────────────────
// 3. 화면
// ─────────────────────────────────────────────────────────────

test('★ 화면 — 대화 목록·방 전환을 반복해도 깨지지 않는다', async ({ browser }) => {
  const { page, ctx } = await openAs(browser, 'artist');
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  const t0 = Date.now();
  await page.goto('/messages');
  await expect(page.locator('body')).not.toContainText('불러오는 중', { timeout: 20000 });
  console.log(`  [대화 화면] 목록 렌더까지 ${Date.now() - t0}ms`);

  // 방을 여러 개 오간다 — 폴링(8초)과 겹쳐도 크래시가 없어야 한다
  const rooms = page.locator('li, button').filter({ hasText: /안읽음|메시지|님/ });
  const n = Math.min(await rooms.count(), 5);
  for (let round = 0; round < 2; round++) {
    for (let i = 0; i < n; i++) {
      await rooms.nth(i).click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(300);
    }
  }
  await page.waitForTimeout(1200);
  expect(errors, `대화 화면 JS 에러: ${errors.join(' | ')}`).toHaveLength(0);

  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `가로 스크롤 ${overflow}px`).toBeLessThanOrEqual(1);
  await ctx.close();
});
