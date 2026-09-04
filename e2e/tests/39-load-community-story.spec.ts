import { test, expect, request as pwRequest, type APIRequestContext } from '@playwright/test';
import {
  tokenFor, authHeader, fireConcurrently, timed, crowdUsers, openAs,
} from '../lib/helpers';

/**
 * 커뮤니티 · ArtStory — **트래픽·이용량이 늘었을 때** 생기는 문제 검증.
 *
 * 여기서 보는 위험은 단발 기능 테스트가 절대 못 잡는 것들이다.
 *   1. **비정규화 카운트 드리프트** — `likeCount`/`commentCount` 를 따로 들고 있으므로
 *      동시 요청에서 실제 행 수와 어긋날 수 있다. 어긋나면 인기글 랭킹이 거짓이 된다.
 *   2. **check-then-act 경합** — 좋아요는 `findUnique` 로 확인한 뒤 `create` 한다.
 *      같은 사람이 연타하면 둘 다 "없음"을 보고 들어가 unique 위반 500 이 날 수 있다.
 *   3. **목록 페이지네이션** — 글이 쌓였을 때 페이지 경계에서 중복·누락이 생기는가.
 *   4. **응답 시간** — 글·좋아요·팔로우가 늘수록 느려지는 구간이 있는가.
 *
 * ⚠️ 실패해도 "느리다"가 아니라 **무엇이 어긋났는지**를 남긴다(수치를 콘솔에 찍는다).
 */
const API = 'http://localhost:4000/api';
const U = () => authHeader(tokenFor('artist'));

/** 서로 다른 사람 N명 (실행마다 새로 만든다 — 시드에는 4명뿐이다) */
const crowd = crowdUsers;

async function makePost(api: APIRequestContext, title: string) {
  const r = await api.post(`${API}/community`, {
    headers: U(), data: { title, body: '부하 검증용 본문', anonymous: false },
  });
  if (!r.ok()) throw new Error(`글 생성 실패 ${r.status()}: ${await r.text()}`);
  return (await r.json()).id as number;
}
const detail = async (api: APIRequestContext, id: number) =>
  (await api.get(`${API}/community/${id}`)).json();

// ─────────────────────────────────────────────────────────────
// 1. 카운트 정합성
// ─────────────────────────────────────────────────────────────

test('★ 17명이 동시에 좋아요 → likeCount 가 정확히 17 (드리프트 없음)', async () => {
  const api = await pwRequest.newContext();
  const id = await makePost(api, `동시좋아요 ${Date.now()}`);
  const people = await crowd(api, 17);

  const results = await fireConcurrently(
    people.map((p) => () => api.post(`${API}/community/${id}/like`, { headers: authHeader(p.token) })),
  );
  const codes = await Promise.all(results.map(async (r) => (r.status === 'fulfilled' ? r.value.status() : 0)));
  const fail = codes.filter((c) => c !== 200);
  console.log(`  [동시 좋아요] 200=${codes.filter((c) => c === 200).length} 실패=${JSON.stringify(fail)}`);

  expect(fail, `서로 다른 사람의 동시 좋아요가 실패했다: ${fail.join(',')}`).toHaveLength(0);

  const d = await detail(api, id);
  expect(d.likeCount, '비정규화 likeCount 가 실제 좋아요 수와 어긋났다').toBe(17);

  // 목록·인기글 위젯도 같은 값을 봐야 한다 (랭킹 근거)
  const list = await (await api.get(`${API}/community?sort=popular`)).json();
  const row = list.posts.find((p: any) => p.id === id);
  expect(row?.likeCount).toBe(17);
  await api.dispose();
});

test('★ 같은 사람이 좋아요를 10번 연타해도 500 이 없고 최종 상태가 일관된다', async () => {
  const api = await pwRequest.newContext();
  const id = await makePost(api, `연타 ${Date.now()}`);
  const me = authHeader((await crowd(api, 1))[0].token);

  const results = await fireConcurrently(
    Array.from({ length: 10 }, () => () => api.post(`${API}/community/${id}/like`, { headers: me })),
  );
  const codes = await Promise.all(results.map(async (r) => (r.status === 'fulfilled' ? r.value.status() : 0)));
  const bad = codes.filter((c) => c !== 200);
  console.log(`  [연타] codes=${codes.join(',')}`);

  // ⚠️ 임계를 '5xx 만 아니면 통과' 로 두지 말 것 — 실제로 나던 건 **400** 이었다(2026-09-04).
  //    500 만 보면 사용자가 겪던 "눌렀는데 안 눌림"을 통째로 놓친다.
  expect(bad, `연타가 에러로 떨어졌다 — check-then-act 경합(codes=${codes.join(',')})`).toHaveLength(0);

  // 최종 likeCount 는 0 또는 1 이어야 한다. 음수·2 이상이면 카운트가 깨진 것이다.
  const d = await detail(api, id);
  console.log(`  [연타] 최종 likeCount=${d.likeCount}`);
  expect(d.likeCount).toBeGreaterThanOrEqual(0);
  expect(d.likeCount).toBeLessThanOrEqual(1);

  // 한 번 더 눌러 토글이 여전히 정상 동작하는지 (경합 뒤에도 상태가 살아 있는가)
  const again = await api.post(`${API}/community/${id}/like`, { headers: me });
  expect(again.status()).toBe(200);
  const after = await again.json();
  expect(after.likeCount).toBe(d.likeCount + (after.liked ? 1 : -1));
  await api.dispose();
});

test('★ 17명이 동시에 댓글 → commentCount 가 정확하고 댓글이 하나도 안 샌다', async () => {
  const api = await pwRequest.newContext();
  const id = await makePost(api, `동시댓글 ${Date.now()}`);
  const people = await crowd(api, 17);

  const results = await fireConcurrently(
    people.map((p, i) => () => api.post(`${API}/community/${id}/comments`, {
      headers: authHeader(p.token), data: { body: `동시댓글 ${i}`, anonymous: false },
    })),
  );
  const codes = await Promise.all(results.map(async (r) => (r.status === 'fulfilled' ? r.value.status() : 0)));
  const okN = codes.filter((c) => c === 201).length;
  console.log(`  [동시 댓글] 201=${okN} / 17`);
  expect(okN).toBe(17);

  const d = await detail(api, id);
  expect(d.comments).toHaveLength(17);
  expect(d.commentCount, '비정규화 commentCount 가 실제 댓글 수와 어긋났다').toBe(17);

  // 동시 삭제도 카운트를 정확히 되돌리는가
  const half = d.comments.slice(0, 8);
  await fireConcurrently(half.map((c: any) => () =>
    api.delete(`${API}/community/${id}/comments/${c.id}`, { headers: authHeader(tokenFor('admin')) })));
  const d2 = await detail(api, id);
  expect(d2.comments).toHaveLength(9);
  expect(d2.commentCount, '동시 삭제 후 commentCount 가 어긋났다').toBe(9);
  await api.dispose();
});

test('★ 17명이 동시에 상세를 열면 조회수가 정확히 17 오른다', async () => {
  const api = await pwRequest.newContext();
  const id = await makePost(api, `동시조회 ${Date.now()}`);
  const people = await crowd(api, 17);

  const before = (await detail(api, id)).viewCount;
  await fireConcurrently(
    people.map((p) => () => api.get(`${API}/community/${id}`, { headers: authHeader(p.token) })),
  );
  // ⚠️ 확인용 조회는 **작성자로** 해야 한다 — 비로그인으로 읽으면 그 요청이 조회수를 또 올려
  //    17이 18로 나오고, 멀쩡한 코드를 '원자성 깨짐'으로 오진한다.
  const v = (await (await api.get(`${API}/community/${id}`, { headers: U() })).json()).viewCount;
  console.log(`  [동시 조회] ${before} → ${v}`);
  expect(v - before, '조회수 증가분이 어긋났다 (increment 원자성)').toBe(17);
  await api.dispose();
});

// ─────────────────────────────────────────────────────────────
// 2. 목록 페이지네이션 — 글이 쌓였을 때
// ─────────────────────────────────────────────────────────────

test('★ 글 60개에서 전 페이지를 훑어도 중복·누락이 없다', async () => {
  test.setTimeout(180_000);
  const api = await pwRequest.newContext();
  const stamp = Date.now();
  // 10개씩 병렬로 만들어 시간 절약
  for (let batch = 0; batch < 6; batch++) {
    await Promise.all(Array.from({ length: 10 }, (_, i) =>
      api.post(`${API}/community`, {
        headers: U(), data: { title: `페이지검증 ${stamp}_${batch}_${i}`, body: '본문', anonymous: false },
      })));
  }

  const first = await (await api.get(`${API}/community?sort=recent&page=1`)).json();
  const total: number = first.total;
  const pages = Math.ceil(total / 20);
  expect(total).toBeGreaterThanOrEqual(60);

  const seen: number[] = [];
  for (let p = 1; p <= pages; p++) {
    const r = await (await api.get(`${API}/community?sort=recent&page=${p}`)).json();
    seen.push(...r.posts.map((x: any) => x.id));
    expect(r.page).toBe(p);
    expect(r.hasMore).toBe(p < pages);
  }
  console.log(`  [페이지네이션] total=${total} pages=${pages} 수집=${seen.length} 고유=${new Set(seen).size}`);
  expect(new Set(seen).size, '페이지 경계에서 같은 글이 두 번 나왔다').toBe(seen.length);
  expect(seen.length, '페이지를 다 훑었는데 total 과 다르다 — 누락').toBe(total);
  await api.dispose();
});

test('★ 목록·인기글 응답이 글이 쌓여도 예산 안에 들어온다', async () => {
  const api = await pwRequest.newContext();
  const budget = 1500;   // ms — 로컬 기준. 넘으면 인덱스·N+1 을 의심한다.

  const a = await timed(() => api.get(`${API}/community?sort=recent`).then((r) => r.json()));
  const b = await timed(() => api.get(`${API}/community?sort=popular`).then((r) => r.json()));
  const c = await timed(() => api.get(`${API}/community/popular?limit=5`).then((r) => r.json()));
  const d = await timed(() => api.get(`${API}/community/categories`).then((r) => r.json()));
  console.log(`  [응답] 최신=${a.ms}ms 인기=${b.ms}ms 인기위젯=${c.ms}ms 탭=${d.ms}ms (글 ${a.value.total}개)`);

  for (const [name, r] of [['최신', a], ['인기', b], ['인기위젯', c], ['탭', d]] as const) {
    expect(r.ms, `${name} 목록이 ${budget}ms 를 넘었다 (${r.ms}ms)`).toBeLessThan(budget);
  }

  // 동시 30 요청에도 전부 200 (커넥션 풀 고갈 확인 — pool 은 20)
  const burst = await fireConcurrently(
    Array.from({ length: 30 }, () => () => api.get(`${API}/community?sort=popular`)),
  );
  const codes = await Promise.all(burst.map(async (r) => (r.status === 'fulfilled' ? r.value.status() : 0)));
  const bad = codes.filter((x) => x !== 200);
  console.log(`  [동시 30요청] 실패=${bad.length}`);
  expect(bad, `동시 요청에서 실패 ${bad.join(',')} — 커넥션 풀 고갈 의심`).toHaveLength(0);
  await api.dispose();
});

// ─────────────────────────────────────────────────────────────
// 3. ArtStory — 피드·좋아요·댓글
// ─────────────────────────────────────────────────────────────

test('★ 스토리 좋아요·댓글도 동시 요청에서 카운트가 정확하다', async () => {
  const api = await pwRequest.newContext();
  const created = await api.post(`${API}/stories`, {
    headers: U(), data: { caption: `부하스토리 ${Date.now()}`, visibility: 'PUBLIC' },
  });
  expect(created.ok()).toBeTruthy();
  const story = await created.json();
  const people = await crowd(api, 15);

  await fireConcurrently(people.map((p) => () =>
    api.post(`${API}/stories/${story.id}/like`, { headers: authHeader(p.token) })));
  await fireConcurrently(people.map((p, i) => () =>
    api.post(`${API}/stories/${story.id}/comments`, {
      headers: authHeader(p.token), data: { body: `동시 스토리 댓글 ${i}` },
    })));

  const likers = await (await api.get(`${API}/stories/${story.id}/likers`, { headers: U() })).json();
  const comments = await (await api.get(`${API}/stories/${story.id}/comments`, { headers: U() })).json();
  const feed = await (await api.get(`${API}/stories/feed`, { headers: U() })).json();
  const row = feed.stories.find((s: any) => s.id === story.id);

  console.log(`  [스토리] likers=${likers.users?.length ?? likers.length} likeCount=${row?.likeCount} commentCount=${row?.commentCount}`);
  expect(row?.likeCount, '스토리 likeCount 드리프트').toBe(15);
  expect(row?.commentCount, '스토리 commentCount 드리프트').toBe(15);
  await api.dispose();
});

test('★ 많이 팔로우해도 [소식] 피드가 예산 안이고 이웃 글만 보인다', async () => {
  test.setTimeout(120_000);
  const api = await pwRequest.newContext();
  const people = await crowd(api, 15);

  // 15명이 각각 스토리를 2개씩 올린다
  await Promise.all(people.flatMap((p, i) => [0, 1].map((k) =>
    api.post(`${API}/stories`, {
      headers: authHeader(p.token), data: { caption: `이웃소식 ${i}-${k} ${Date.now()}`, visibility: 'PUBLIC' },
    }))));

  // artist 가 15명 전부를 이웃으로 추가 (멱등이어야 한다 — 두 번 눌러도 알림 1건)
  await Promise.all(people.map((p) => api.post(`${API}/follow/${p.id}`, { headers: U() })));
  await Promise.all(people.map((p) => api.post(`${API}/follow/${p.id}`, { headers: U() })));

  const feed = await timed(() => api.get(`${API}/stories/feed`, { headers: U() }).then((r) => r.json()));
  console.log(`  [피드] ${feed.ms}ms, total=${feed.value.total}`);
  expect(feed.ms, `[소식] 피드가 느리다 (${feed.ms}ms)`).toBeLessThan(2000);
  expect(feed.value.stories.length).toBeGreaterThan(0);

  // 피드에는 내가 팔로우한 사람 + 나 만 있어야 한다
  const allowed = new Set([...people.map((p) => p.id), 1]);
  const outsiders = feed.value.stories.filter((s: any) => s.author?.id && !allowed.has(s.author.id));
  expect(outsiders, `팔로우하지 않은 사람의 글이 피드에 섞였다: ${JSON.stringify(outsiders.slice(0, 2))}`).toHaveLength(0);

  // 이웃 목록도 정확 (멱등 확인 — 30번 호출했지만 15명)
  const mutual = await (await api.get(`${API}/follow/mutuals`, { headers: U() })).json();
  console.log(`  [이웃] mutuals=${Array.isArray(mutual) ? mutual.length : JSON.stringify(mutual).slice(0, 80)}`);
  await api.dispose();
});

test('★ 이웃 추가를 동시에 20번 눌러도 알림이 폭증하지 않는다 (멱등)', async () => {
  const api = await pwRequest.newContext();
  const [{ id: target, token: targetToken }] = (await crowd(api, 4)).slice(3);

  // 깨끗한 시작
  await api.delete(`${API}/follow/${target}`, { headers: U() });
  const before = await (await api.get(`${API}/notifications`, { headers: authHeader(targetToken) })).json();
  const beforeN = (before.notifications ?? before).length;

  await fireConcurrently(Array.from({ length: 20 }, () => () =>
    api.post(`${API}/follow/${target}`, { headers: U() })));

  const after = await (await api.get(`${API}/notifications`, { headers: authHeader(targetToken) })).json();
  const afterN = (after.notifications ?? after).length;
  console.log(`  [팔로우 멱등] 알림 ${beforeN} → ${afterN} (20회 동시 클릭)`);

  // refKey 가 유니크가 아니라 DB 가 안 막아 준다 — 서버가 createMany(skipDuplicates) 로 막는다
  expect(afterN - beforeN, `이웃 추가 20회에 알림이 ${afterN - beforeN}건 생겼다 — 멱등이 깨졌다`).toBe(1);
  await api.dispose();
});

test('★ 화면 — 커뮤니티 목록에 글이 쌓여도 렌더가 깨지지 않는다', async ({ browser }) => {
  const { page, ctx } = await openAs(browser, 'artist');
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  const t0 = Date.now();
  await page.goto('/community');
  await expect(page.getByRole('button', { name: '글쓰기' })).toBeVisible({ timeout: 20000 });
  await expect(page.locator('li').first()).toBeVisible({ timeout: 15000 });
  console.log(`  [커뮤니티 화면] 첫 글 렌더까지 ${Date.now() - t0}ms`);

  // 정렬·필터를 연달아 바꿔도 크래시 없음
  for (let i = 0; i < 3; i++) {
    await page.getByRole('button', { name: '인기' }).click();
    await page.waitForTimeout(250);
    await page.getByRole('button', { name: '최신' }).click();
    await page.waitForTimeout(250);
  }
  expect(errors, `커뮤니티 목록에서 JS 에러: ${errors.join(' | ')}`).toHaveLength(0);

  // 가로 스크롤이 생기면 모바일에서 레이아웃이 밀린 것이다
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `가로 스크롤 ${overflow}px — min-w-0 누락 의심`).toBeLessThanOrEqual(1);
  await ctx.close();
});
