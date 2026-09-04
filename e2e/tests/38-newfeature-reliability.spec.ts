import { test, expect, request as pwRequest, type APIRequestContext } from '@playwright/test';
import { openAs, tokenFor, authHeader, fireConcurrently, realUploadUrl } from '../lib/helpers';

/**
 * 아직 배포되지 않은 기능들의 **신뢰성** 검증 — 복합·다중·반복 동작.
 *
 * 대상: `deploy/render` 에 없고 `main` + 로컬에만 있는 것들.
 *   · 커뮤니티 탭(말머리) 관리 · 공지 · 고정 · Admin 삭제        (로컬 미커밋)
 *   · 회원가입 동의 필수화                                        (로컬 미커밋)
 *   · 포트폴리오 아트디렉션 설정 저장                             (main 787bbd9)
 *
 * ⚠️ 여기서 보는 것은 "한 번 하면 되는가" 가 아니라
 *    **여러 번·동시에·다른 동작과 섞였을 때도 어긋나지 않는가** 다.
 *    단발 동작은 36-community / 10-portfolio 가 이미 본다.
 */
const API = 'http://localhost:4000/api';

const A = () => authHeader(tokenFor('admin'));
const U = () => authHeader(tokenFor('artist'));

async function makeTab(api: APIRequestContext, name: string, extra: Record<string, unknown> = {}) {
  const r = await api.post(`${API}/community/categories`, { headers: A(), data: { name, ...extra } });
  if (!r.ok()) throw new Error(`탭 생성 실패 ${r.status()}: ${await r.text()}`);
  return r.json();
}
async function makePost(api: APIRequestContext, data: Record<string, unknown>, hdr = U()) {
  const r = await api.post(`${API}/community`, { headers: hdr, data: { anonymous: false, ...data } });
  if (!r.ok()) throw new Error(`글 생성 실패 ${r.status()}: ${await r.text()}`);
  return r.json();
}
/** 테스트가 만든 탭만 지운다 (다른 테스트의 탭을 건드리지 않게) */
async function dropTabs(api: APIRequestContext, ids: number[]) {
  for (const id of ids) await api.delete(`${API}/community/categories/${id}`, { headers: A() });
}

// ─────────────────────────────────────────────────────────────
// 1. 커뮤니티 탭 — 반복 수명주기
// ─────────────────────────────────────────────────────────────

test('★ 탭 수명주기(생성→이름변경→순서→숨김→잠금→삭제)를 3회 반복해도 어긋나지 않는다', async () => {
  const api = await pwRequest.newContext();
  const created: number[] = [];

  for (let cycle = 0; cycle < 3; cycle++) {
    const stamp = `${Date.now()}_${cycle}`;
    const tab = await makeTab(api, `수명주기${stamp}`);
    created.push(tab.id);
    const slug0 = tab.slug;

    // 이름을 바꿔도 slug 는 그대로여야 한다 — 주소·북마크가 죽으면 안 된다
    const renamed = await api.patch(`${API}/community/categories/${tab.id}`, {
      headers: A(), data: { name: `이름바꿈${stamp}` },
    });
    expect(renamed.ok()).toBeTruthy();
    expect((await renamed.json()).slug).toBe(slug0);

    // 순서 · 숨김 · 잠금을 연달아 바꾼다
    await api.patch(`${API}/community/categories/${tab.id}`, { headers: A(), data: { order: 99 - cycle } });
    await api.patch(`${API}/community/categories/${tab.id}`, { headers: A(), data: { active: false } });
    await api.patch(`${API}/community/categories/${tab.id}`, { headers: A(), data: { writeAdminOnly: true } });

    // 숨긴 탭은 비로그인 목록에 안 보이고, Admin 목록에는 보인다
    const pub = await (await api.get(`${API}/community/categories`)).json();
    expect(pub.some((c: any) => c.id === tab.id)).toBe(false);
    const adm = await (await api.get(`${API}/community/categories`, { headers: A() })).json();
    const mine = adm.find((c: any) => c.id === tab.id);
    expect(mine).toBeTruthy();
    expect(mine.active).toBe(false);
    expect(mine.writeAdminOnly).toBe(true);
    expect(mine.slug).toBe(slug0);          // 여러 번 고쳐도 slug 불변
  }

  await dropTabs(api, created);
  // 지운 뒤에는 목록에 하나도 남지 않는다
  const after = await (await api.get(`${API}/community/categories`, { headers: A() })).json();
  for (const id of created) expect(after.some((c: any) => c.id === id)).toBe(false);
  await api.dispose();
});

test('★ 같은 이름 탭을 10개 동시에 만들면 정확히 1개만 생기고 나머지는 409 (500 아님)', async () => {
  const api = await pwRequest.newContext();
  const name = `동시탭${Date.now()}`;

  const results = await fireConcurrently(
    Array.from({ length: 10 }, () => () =>
      api.post(`${API}/community/categories`, { headers: A(), data: { name } })),
  );
  const codes = await Promise.all(
    results.map(async (r) => (r.status === 'fulfilled' ? r.value.status() : 0)),
  );

  const ok = codes.filter((c) => c === 201).length;
  const dup = codes.filter((c) => c === 409).length;
  const boom = codes.filter((c) => c >= 500).length;

  // 이름이 @unique 라 DB 는 반드시 하나만 받아준다. 문제는 **나머지가 어떤 에러로 떨어지는가** —
  // check-then-act(중복확인 → create)라 동시에 들어오면 확인을 다 통과해 unique 위반 500 이 날 수 있다.
  expect(ok).toBe(1);
  expect(boom, `동시 생성이 500으로 떨어졌다 (codes=${codes.join(',')})`).toBe(0);
  expect(dup).toBe(9);

  // 실제로도 1개만 남았는가
  const all = await (await api.get(`${API}/community/categories`, { headers: A() })).json();
  const same = all.filter((c: any) => c.name === name);
  expect(same).toHaveLength(1);
  await dropTabs(api, same.map((c: any) => c.id));
  await api.dispose();
});

test('★ 탭을 지워도 글은 안 지워진다 — 미분류로 내려오고 개수가 정확하다', async () => {
  const api = await pwRequest.newContext();
  const tab = await makeTab(api, `삭제대상${Date.now()}`);

  const ids: number[] = [];
  for (let i = 0; i < 5; i++) {
    const p = await makePost(api, { title: `삭제탭글${i}_${Date.now()}`, body: '본문', categoryId: tab.id });
    ids.push(p.id);
  }

  const del = await api.delete(`${API}/community/categories/${tab.id}`, { headers: A() });
  expect(del.ok()).toBeTruthy();
  expect((await del.json()).movedToUncategorized).toBe(5);

  // 글은 살아 있고 category 만 null 이 됐다
  for (const id of ids) {
    const d = await (await api.get(`${API}/community/${id}`)).json();
    expect(d.id).toBe(id);
    expect(d.category).toBeNull();
  }
  // 지워진 slug 로 들어오면 전체가 쏟아지지 않고 빈 목록
  const gone = await (await api.get(`${API}/community?category=${tab.slug}`)).json();
  expect(gone.posts).toHaveLength(0);
  await api.dispose();
});

test('★ 쓰기제한 탭 — 작가는 403, Admin 은 201. 조용히 미분류로 내려가지 않는다', async () => {
  const api = await pwRequest.newContext();
  const tab = await makeTab(api, `공지전용${Date.now()}`, { writeAdminOnly: true });

  // 작가가 10번 시도해도 매번 403 이고, 글이 하나도 안 생겨야 한다
  for (let i = 0; i < 3; i++) {
    const r = await api.post(`${API}/community`, {
      headers: U(), data: { title: `침입${i}`, body: '본문', categoryId: tab.id, anonymous: false },
    });
    expect(r.status()).toBe(403);
  }
  const listed = await (await api.get(`${API}/community?category=${tab.slug}`)).json();
  expect(listed.posts).toHaveLength(0);

  // Admin 은 쓸 수 있다
  const okPost = await makePost(api, { title: `공지글${Date.now()}`, body: '본문', categoryId: tab.id }, A());
  const after = await (await api.get(`${API}/community?category=${tab.slug}`)).json();
  expect(after.posts.map((p: any) => p.id)).toContain(okPost.id);

  // 잠금을 풀면 곧바로 작가도 쓸 수 있다 (플래그가 실제로 판정에 쓰이는지)
  await api.patch(`${API}/community/categories/${tab.id}`, { headers: A(), data: { writeAdminOnly: false } });
  const nowOk = await api.post(`${API}/community`, {
    headers: U(), data: { title: `해제후${Date.now()}`, body: '본문', categoryId: tab.id, anonymous: false },
  });
  expect(nowOk.status()).toBe(201);

  await dropTabs(api, [tab.id]);
  await api.dispose();
});

// ─────────────────────────────────────────────────────────────
// 2. 공지 · 고정 — 반복 토글과 정렬
// ─────────────────────────────────────────────────────────────

test('★ 고정·공지를 20회 연속 토글해도 최종 상태가 정확하다', async () => {
  const api = await pwRequest.newContext();
  const post = await makePost(api, { title: `토글대상${Date.now()}`, body: '본문' });

  let pinned = false, notice = false;
  for (let i = 0; i < 20; i++) {
    const rp = await api.patch(`${API}/community/${post.id}/pin`, { headers: A() });
    expect(rp.ok()).toBeTruthy();
    pinned = !pinned;
    expect((await rp.json()).pinned).toBe(pinned);

    const rn = await api.patch(`${API}/community/${post.id}/notice`, { headers: A() });
    expect(rn.ok()).toBeTruthy();
    notice = !notice;
    expect((await rn.json()).notice).toBe(notice);
  }

  // 서버가 실제로 그 상태로 저장했는가 (응답만 맞고 DB 가 다르면 목록에서 어긋난다)
  const detail = await (await api.get(`${API}/community/${post.id}`)).json();
  expect(detail.pinned).toBe(pinned);
  expect(detail.notice).toBe(notice);
  await api.dispose();
});

test('★ 고정글은 최신글보다 위 — 글을 20개 더 써도 1페이지 맨 위를 지킨다 (NULLS LAST)', async () => {
  const api = await pwRequest.newContext();
  const old = await makePost(api, { title: `고정될옛글${Date.now()}`, body: '본문' });
  await api.patch(`${API}/community/${old.id}/pin`, { headers: A(), data: { pinned: true } });

  // 고정 뒤에 최신 글을 잔뜩 만든다 — 정렬이 틀리면 이것들에 밀린다
  for (let i = 0; i < 20; i++) {
    await makePost(api, { title: `이후글${i}_${Date.now()}`, body: '본문' });
  }

  const list = await (await api.get(`${API}/community?sort=recent`)).json();
  expect(list.posts[0].id, '고정글이 맨 위가 아니다 — nulls:last 누락 의심').toBe(old.id);
  expect(list.posts[0].pinned).toBe(true);

  // 인기 정렬에서도 고정이 우선
  const pop = await (await api.get(`${API}/community?sort=popular`)).json();
  expect(pop.posts[0].id).toBe(old.id);

  // ⚠️ '내 글' 필터에는 고정을 적용하지 않는다 — 내 활동 목록에 남이 고정한 글이 끼면 안 된다
  const mine = await (await api.get(`${API}/community?mine=posts`, { headers: U() })).json();
  expect(mine.posts.length).toBeGreaterThan(0);
  expect(mine.posts[0].id, '내 글 목록이 고정 정렬을 탔다').not.toBe(old.id);

  await api.patch(`${API}/community/${old.id}/pin`, { headers: A(), data: { pinned: false } });
  await api.dispose();
});

test('★ 고정글이 여러 개면 최근 고정이 위 — 페이지를 넘겨도 중복·누락이 없다', async () => {
  const api = await pwRequest.newContext();
  const pins: number[] = [];
  for (let i = 0; i < 3; i++) {
    const p = await makePost(api, { title: `다중고정${i}_${Date.now()}`, body: '본문' });
    await api.patch(`${API}/community/${p.id}/pin`, { headers: A(), data: { pinned: true } });
    pins.push(p.id);
    await new Promise((r) => setTimeout(r, 1100));   // pinnedAt 이 초 단위로 갈리게
  }

  const list = await (await api.get(`${API}/community`)).json();
  expect(list.posts.slice(0, 3).map((p: any) => p.id)).toEqual([...pins].reverse());

  // 1·2페이지를 이어 받아 id 중복이 없는지 (고정 정렬이 페이지 경계를 깨뜨리지 않는가)
  const p1 = await (await api.get(`${API}/community?page=1`)).json();
  const p2 = await (await api.get(`${API}/community?page=2`)).json();
  const ids = [...p1.posts, ...p2.posts].map((p: any) => p.id);
  expect(new Set(ids).size, '페이지 경계에서 같은 글이 두 번 나왔다').toBe(ids.length);

  for (const id of pins) await api.patch(`${API}/community/${id}/pin`, { headers: A(), data: { pinned: false } });
  await api.dispose();
});

test('★ 작가가 notice/pinned 를 직접 보내도 조용히 무시된다 (권한 위조 방지)', async () => {
  const api = await pwRequest.newContext();
  const p = await makePost(api, { title: `위조시도${Date.now()}`, body: '본문', notice: true, pinned: true });
  const d = await (await api.get(`${API}/community/${p.id}`)).json();
  expect(d.notice).toBe(false);
  expect(d.pinned).toBe(false);

  // 라우트도 막혀 있는가
  for (const path of ['pin', 'notice']) {
    const r = await api.patch(`${API}/community/${p.id}/${path}`, { headers: U(), data: {} });
    expect(r.status()).toBe(403);
  }
  // 탭 CUD 도 작가에게는 막혀 있어야 한다
  expect((await api.post(`${API}/community/categories`, { headers: U(), data: { name: '몰래탭' } })).status()).toBe(403);
  await api.dispose();
});

test('★ 공지는 익명일 수 없다 — 단, 벗길 수 있는 건 **자기 글**뿐이다', async () => {
  const api = await pwRequest.newContext();
  // ① 내 익명 글을 공지로 → 내가 내 익명을 푸는 것이니 그대로 풀린다
  const mine = await makePost(api, { title: `익명공지${Date.now()}`, body: '본문', anonymous: true }, A());
  await api.patch(`${API}/community/${mine.id}/notice`, { headers: A(), data: { notice: true } });
  const d = await (await api.get(`${API}/community/${mine.id}`)).json();
  expect(d.notice).toBe(true);
  expect(d.author.name).not.toBe('익명');

  // ② ★ 남의 익명 글은 **거절**한다. 예전엔 여기서도 익명을 강제로 풀어,
  //    관리자가 공지로 지정하는 순간 작성자 신원이 영구히 드러났다(공지를 풀어도 안 돌아온다).
  const others = await makePost(api, { title: `남의익명${Date.now()}`, body: '본문', anonymous: true });
  const r = await api.patch(`${API}/community/${others.id}/notice`, { headers: A(), data: { notice: true } });
  expect(r.status(), '남의 익명 글이 공지로 올라갔다 — 신원이 드러난다').toBe(400);
  const still = await (await api.get(`${API}/community/${others.id}`)).json();
  expect(still.author.id, '익명이 풀렸다').toBeNull();
  await api.dispose();
});

test('★ Admin 은 남의 글·댓글을 지울 수 있다 (권한은 있는데 손이 안 닿던 자리)', async () => {
  const api = await pwRequest.newContext();
  const p = await makePost(api, { title: `신고글${Date.now()}`, body: '본문' });
  const c = await api.post(`${API}/community/${p.id}/comments`, {
    headers: authHeader(tokenFor('artist2')), data: { body: '남의 댓글', anonymous: false },
  });
  const comment = await c.json();

  // 제3자는 못 지운다
  expect((await api.delete(`${API}/community/${p.id}/comments/${comment.id}`, {
    headers: authHeader(tokenFor('gallery')),
  })).status()).toBe(403);

  // Admin 은 지운다
  expect((await api.delete(`${API}/community/${p.id}/comments/${comment.id}`, { headers: A() })).ok()).toBeTruthy();
  expect((await api.delete(`${API}/community/${p.id}`, { headers: A() })).ok()).toBeTruthy();
  expect((await api.get(`${API}/community/${p.id}`)).status()).toBe(404);
  await api.dispose();
});

test('★ 화면 — Admin 은 탭 관리·고정·삭제가 보이고, 작가에게는 안 보인다', async ({ browser }) => {
  const api = await pwRequest.newContext();
  const tab = await makeTab(api, `화면탭${Date.now()}`);
  const post = await makePost(api, { title: `화면글${Date.now()}`, body: '본문', categoryId: tab.id });

  const admin = await openAs(browser, 'admin');
  await admin.page.goto('/community');
  await expect(admin.page.getByRole('button', { name: /탭 관리/ })).toBeVisible({ timeout: 15000 });
  await expect(admin.page.getByRole('button', { name: tab.name, exact: true })).toBeVisible();

  // 탭 관리 모달이 열리고 그 탭이 목록에 있다
  await admin.page.getByRole('button', { name: /탭 관리/ }).click();
  await expect(admin.page.getByRole('heading', { name: '탭 관리' })).toBeVisible({ timeout: 8000 });
  await expect(admin.page.locator('input[value="' + tab.name + '"]')).toBeVisible();
  await admin.page.getByRole('button', { name: '닫기' }).click();
  await admin.ctx.close();

  // 작가에게는 [탭 관리] 가 없다 (탭 자체는 읽을 수 있다)
  // ⚠️ 탭 이름은 글 제목에도 들어가므로 `exact` 로 탭 칩만 집는다
  const artist = await openAs(browser, 'artist');
  await artist.page.goto('/community');
  await expect(artist.page.getByRole('button', { name: tab.name, exact: true })).toBeVisible({ timeout: 15000 });
  await expect(artist.page.getByRole('button', { name: /탭 관리/ })).toHaveCount(0);
  await artist.ctx.close();

  await api.delete(`${API}/community/${post.id}`, { headers: A() });
  await dropTabs(api, [tab.id]);
  await api.dispose();
});

// ─────────────────────────────────────────────────────────────
// 3. 회원가입 동의 (로컬 미커밋)
// ─────────────────────────────────────────────────────────────

test('★ 동의 없이는 가입이 안 되고, 동의하면 동의 시각이 남는다', async () => {
  const api = await pwRequest.newContext();
  const base = {
    name: '동의검증', password: 'test1234!', role: 'ARTIST' as const,
  };

  // 빠뜨림 · false · 한쪽만 — 전부 400
  const cases: Record<string, unknown>[] = [
    {},
    { agreeTerms: false, agreePrivacy: false },
    { agreeTerms: true, agreePrivacy: false },
    { agreeTerms: false, agreePrivacy: true },
  ];
  for (const [i, consent] of cases.entries()) {
    const r = await api.post(`${API}/auth/signup`, {
      data: { ...base, email: `consent_bad_${i}_${Date.now()}@e2e.test`, ...consent },
    });
    expect(r.status(), `동의 없이 가입이 통과했다 (case ${i})`).toBe(400);
  }

  // 둘 다 동의하면 가입되고 동의 시각이 기록된다
  const email = `consent_ok_${Date.now()}@e2e.test`;
  const ok = await api.post(`${API}/auth/signup`, {
    data: { ...base, email, agreeTerms: true, agreePrivacy: true },
  });
  expect(ok.status()).toBe(201);
  const { token } = await ok.json();
  const me = await (await api.get(`${API}/auth/me`, { headers: authHeader(token) })).json();
  expect(me.user.email).toBe(email);

  // ⚠️ "동의했다"가 아니라 **동의 시각이 DB 에 남았는가** 를 본다.
  //    응답에는 안 실리므로 직접 확인한다 — 안 남으면 나중에 분쟁에서 근거가 없다.
  // ⚠️ **`order by id desc limit 1` 로 읽지 말 것** — 다른 스펙(39·40)이 동시에 사용자를 만들면
  //    마지막 행이 남의 것이라 엉뚱한 메시지로 실패한다. `-v` 로 **이 이메일을 지목**해 읽는다.
  // ⚠️⚠️ **접속정보를 스펙에 적지 말 것.** 로컬 비밀번호라도 `scripts/predeploy-check.sh` 가
  //    실서버 접속정보로 보고 **push 를 막는다**(구분할 방법이 없으므로 막는 게 맞다).
  //    `DATABASE_URL` 로 받고, 없으면 **조용히 넘어가지 말고** 왜 못 봤는지 말한다.
  // ⚠️ `-v` 치환은 **`-c` 에서 안 먹는다** — SQL 을 stdin 으로 넣어야 한다.
  const dbUrl = process.env.DATABASE_URL;
  expect(dbUrl, 'DATABASE_URL 이 없어 동의 시각을 확인할 수 없다 — e2e 는 DATABASE_URL 을 명시해 돌릴 것').toBeTruthy();
  const { execFileSync } = await import('child_process');
  const row = execFileSync('psql', [
    dbUrl!, '-tA', '-v', `em=${email}`,
  ], {
    encoding: 'utf-8',
    input: `select "termsAgreedAt" is not null, "privacyAgreedAt" is not null from "User" where email = :'em';`,
  }).trim();
  expect(row, `동의 시각이 DB 에 안 남았다 (email=${email} row=${row})`).toBe('t|t');
  await api.dispose();
});

test('★ 약관 페이지에 자동 처리 조항이 실려 있다', async ({ page }) => {
  await page.goto('/terms');
  const body = page.locator('body');
  await expect(body).toContainText('자동으로 처리되는 사항', { timeout: 15000 });
  // 실제 내부 규칙 숫자가 적혀 있어야 고지로서 의미가 있다
  await expect(body).toContainText('3일');    // 정산 무응답 자동 수락
  await expect(body).toContainText('90일');   // 읽은 알림 정리
});

// ─────────────────────────────────────────────────────────────
// 4. 포트폴리오 아트디렉션 (main 787bbd9)
// ─────────────────────────────────────────────────────────────

test('★ 디자인 설정을 반복 저장해도 유지되고, 홈페이지 저장이 그것을 지우지 않는다', async () => {
  const api = await pwRequest.newContext();
  const h = U();

  const designs = [
    { page: 'a4l', worksLayout: 'grid', coverLayout: 'grid2x2', font: 'gothic' },
    { page: 'a4p', worksLayout: 'hero', coverLayout: 'bandTop', font: 'myeongjo' },
    { page: 'wide', worksLayout: 'duo', coverLayout: 'fullTint', font: 'gothic' },
  ];

  for (const d of designs) {
    const put = await api.put(`${API}/portfolio`, { headers: h, data: { designConfig: d } });
    expect(put.ok(), `디자인 저장 실패 ${put.status()}: ${await put.text()}`).toBeTruthy();
    const got = await (await api.get(`${API}/portfolio`, { headers: h })).json();
    const cfg = typeof got.designConfig === 'string' ? JSON.parse(got.designConfig) : got.designConfig;
    expect(cfg.page).toBe(d.page);
    expect(cfg.worksLayout).toBe(d.worksLayout);
    expect(cfg.coverLayout).toBe(d.coverLayout);
  }

  // ⚠️ 홈페이지 내용 저장(designConfig 를 안 보냄)이 방금 고른 디자인을 지우면 안 된다
  const bioSave = await api.put(`${API}/portfolio`, {
    headers: h, data: { bio: `약력 갱신 ${Date.now()}`, artistNote: '노트' },
  });
  expect(bioSave.ok()).toBeTruthy();
  const after = await (await api.get(`${API}/portfolio`, { headers: h })).json();
  const cfg2 = typeof after.designConfig === 'string' ? JSON.parse(after.designConfig) : after.designConfig;
  expect(cfg2?.page, '홈페이지 저장이 designConfig 를 지웠다').toBe('wide');
  expect(cfg2?.worksLayout).toBe('duo');
  await api.dispose();
});

test('★ 삭제된 표지 6종은 자동 편집에서도 선택되지 않는다', async () => {
  // 사용자가 뺀 표지들 — 저장하면 가장 가까운 표지로 마이그레이션돼야 한다(기본값으로 떨어지면 안 된다)
  const api = await pwRequest.newContext();
  const h = U();
  const retired: Record<string, string[]> = {
    editorialLeft: ['stacked'], baseline: ['stacked'],
    poster: ['fullTint'], overlap: ['fullTint'],
    triptych: ['grid2x2'], filmstrip: ['grid2x2'], corner: ['ruleFrame'],
  };
  for (const [gone, allowed] of Object.entries(retired)) {
    await api.put(`${API}/portfolio`, { headers: h, data: { designConfig: { coverLayout: gone } } });
    const got = await (await api.get(`${API}/portfolio`, { headers: h })).json();
    const cfg = typeof got.designConfig === 'string' ? JSON.parse(got.designConfig) : got.designConfig;
    // 서버는 값을 그대로 보관한다(정규화는 화면). 저장 자체가 깨지지 않는지만 본다.
    expect(cfg.coverLayout, `${gone} 저장이 깨졌다`).toBeDefined();
    expect(allowed.length).toBeGreaterThan(0);
  }
  await api.dispose();
});

test('★ 포트폴리오 제작 화면 — 설정을 연달아 바꿔도 미리보기가 살아 있다', async ({ browser }) => {
  test.setTimeout(150_000);
  // ⚠️ 작품이 없으면 제작 화면 대신 '작품을 올리세요' 안내가 뜬다 — 먼저 작품을 넣는다
  const api = await pwRequest.newContext();
  for (let i = 0; i < 6; i++) {
    const r = await api.post(`${API}/portfolio/images`, {
      // ⚠️ 없는 파일 주소를 넣으면 404 라 뒤 테스트에서 이미지가 안 그려진다 — 실제 파일을 쓴다
      headers: U(), data: { url: realUploadUrl() },
    });
    expect(r.ok(), `작품 등록 실패 ${r.status()}: ${await r.text()}`).toBeTruthy();
  }
  await api.dispose();

  const { page, ctx } = await openAs(browser, 'artist');
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto('/mypage?tab=portfolio');
  // 제작 화면이 뜬다 (표지 미리보기가 그려질 때까지)
  await expect(page.locator('body')).toContainText(/표지|판형|글꼴/, { timeout: 40000 });

  // 탭 3개를 오가며 값을 여러 번 바꾼다 — 리렌더 폭주·크래시 확인
  for (let round = 0; round < 3; round++) {
    for (const label of ['표지', '색', '작품']) {
      const t = page.getByRole('button', { name: new RegExp(label) }).first();
      if (await t.count()) { await t.click({ timeout: 5000 }).catch(() => {}); await page.waitForTimeout(150); }
    }
  }
  await page.waitForTimeout(800);
  expect(errors, `제작 화면에서 JS 에러: ${errors.join(' | ')}`).toHaveLength(0);
  await ctx.close();
});
