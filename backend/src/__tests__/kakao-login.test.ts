/**
 * 카카오 로그인 — 웹(인가 코드) · 앱(접근 토큰, 2026-11-11 CLAUDE.md 규칙 79). 카카오 API 는 가짜(fetch 를 갈아 끼운다).
 * ★ 앱 경로는 **우리 카카오 앱에서 나온 토큰인지**(app_id) 먼저 본다 — 안 보면 다른 앱이 받은 토큰으로 남의 계정에 로그인된다.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { request, testPrisma, cleanDb, seedUsers } from './helpers';

const OUR_APP = 1234567;
type Fake = { info?: { status: number; body: unknown }; me?: { status: number; body: unknown }; token?: { status: number; body: unknown } };
let fake: Fake = {};
const realFetch = globalThis.fetch;

beforeEach(async () => {
  await cleanDb();
  await seedUsers();
  process.env.KAKAO_APP_ID = String(OUR_APP);
  fake = {
    info: { status: 200, body: { id: 777, app_id: OUR_APP, expires_in: 3600 } },
    me: { status: 200, body: { id: 777, kakao_account: { email: 'kakao@user.test', profile: { nickname: '카카오사람', profile_image_url: null } } } },
    token: { status: 200, body: { access_token: 'web-access-token-123' } },
  };
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = String(input);
    const pick = url.includes('/v1/user/access_token_info') ? fake.info : url.includes('/v2/user/me') ? fake.me : url.includes('/oauth/token') ? fake.token : null;
    if (!pick) return realFetch(input, init);
    return new Response(JSON.stringify(pick.body), { status: pick.status, headers: { 'content-type': 'application/json' } });
  });
});
afterEach(() => { vi.restoreAllMocks(); delete process.env.KAKAO_APP_ID; });

const native = (accessToken = 'app-access-token-abc') => request.post('/api/auth/kakao/native').send({ accessToken });

describe('앱 카카오 로그인 POST /api/auth/kakao/native', () => {
  it('★ 처음이면 가입 정보 입력으로(임시 토큰) — 그 토큰으로 가입하면 다음엔 바로 로그인', async () => {
    const first = await native();
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ needsRegistration: true, profile: { name: '카카오사람', email: 'kakao@user.test' } });
    const reg = await request.post('/api/auth/complete-registration').send({
      tempToken: first.body.tempToken, role: 'ARTIST', name: '카카오사람', email: 'kakao@user.test', phone: '010-1234-5678', agreeTerms: true, agreePrivacy: true,
    });
    expect(reg.status).toBe(201);
    const again = await native();
    expect(again.status).toBe(200);
    expect(again.body.token).toBeTruthy();
    expect(again.body.user).toMatchObject({ email: 'kakao@user.test', role: 'ARTIST' });
  });

  it('★ 다른 앱에서 받은 토큰(app_id 가 다르다)이면 401 — 이미 가입한 사람이어도 로그인시키지 않는다', async () => {
    await testPrisma.user.create({ data: { email: 'victim@user.test', name: '피해자', role: 'ARTIST', provider: 'KAKAO', providerId: '777' } });
    fake.info = { status: 200, body: { id: 777, app_id: 9999999, expires_in: 3600 } };
    const r = await native();
    expect(r.status).toBe(401);
    expect(r.body.token).toBeUndefined();
  });

  it('토큰이 만료·위조면(카카오가 401) 401 · 토큰 주인과 사용자 정보가 다르면 401', async () => {
    fake.info = { status: 401, body: { code: -401, msg: 'this access token does not exist' } };
    expect((await native()).status).toBe(401);
    fake.info = { status: 200, body: { id: 777, app_id: OUR_APP } };
    fake.me = { status: 200, body: { id: 888, kakao_account: {} } };
    expect((await native()).status).toBe(401);
  });

  it('★ KAKAO_APP_ID 가 없으면 503 — 확인 없이 열지 않는다 · 토큰이 없으면 400', async () => {
    delete process.env.KAKAO_APP_ID;
    expect((await native()).status).toBe(503);
    process.env.KAKAO_APP_ID = String(OUR_APP);
    expect((await request.post('/api/auth/kakao/native').send({})).status).toBe(400);
  });
});

describe('웹 카카오 로그인 POST /api/auth/kakao (함수를 나눈 뒤에도 그대로)', () => {
  it('이미 가입한 카카오 사용자는 로그인 · 처음이면 가입 정보 입력', async () => {
    const fresh = await request.post('/api/auth/kakao').send({ code: 'abc', redirectUri: 'http://localhost:5173/auth/kakao/callback' });
    expect(fresh.status).toBe(200);
    expect(fresh.body.needsRegistration).toBe(true);
    await testPrisma.user.create({ data: { email: 'kakao@user.test', name: '카카오사람', role: 'ARTIST', provider: 'KAKAO', providerId: '777' } });
    const r = await request.post('/api/auth/kakao').send({ code: 'abc', redirectUri: 'http://localhost:5173/auth/kakao/callback' });
    expect(r.status).toBe(200);
    expect(r.body.token).toBeTruthy();
  });

  it('카카오 사용자 정보가 오류 바디면 502(providerId "undefined" 로 교차 로그인되지 않게)', async () => {
    fake.me = { status: 500, body: { msg: 'down' } };
    expect((await request.post('/api/auth/kakao').send({ code: 'abc', redirectUri: 'http://localhost:5173/auth/kakao/callback' })).status).toBe(502);
  });
});
