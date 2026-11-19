/**
 * 카카오 중계 (2026-11-19, CLAUDE.md 규칙 86) — 실서버 IP 에서 카카오에 닿지 않은 일 뒤에 넣었다.
 *  - 서버: 환경 변수만으로 Cloudflare 중계를 거치게 한다(lib/kakaoHttp.ts) · 못 닿으면 10초 500 이 아니라 503 + 알아듣는 말
 *  - 중계 Worker(infra/cloudflare/kakao-relay.js): 세 경로만 · 비밀이 맞을 때만 · 넘기는 머리는 둘뿐
 * 카카오는 가짜다(fetch 를 갈아 끼운다).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { request, cleanDb, seedUsers } from './helpers';
import { kakaoBase, kakaoRelayed } from '../lib/kakaoHttp';

type Call = { url: string; headers: Headers; method: string; body?: string };
let calls: Call[] = [];
let mode: 'ok' | 'down' | 'relay404' | 'relay502' = 'ok';
const realFetch = globalThis.fetch;
const ENV_KEYS = ['KAKAO_AUTH_URL', 'KAKAO_API_URL', 'KAKAO_RELAY_SECRET', 'KAKAO_APP_ID'] as const;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(async () => {
  await cleanDb();
  await seedUsers();
  calls = [];
  mode = 'ok';
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = String(input);
    if (!/kakao\.com|relay\.example/.test(url)) return realFetch(input, init);
    calls.push({ url, headers: new Headers(init?.headers), method: init?.method || 'GET', body: init?.body ? String(init.body) : undefined });
    if (mode === 'down') throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } });
    if (mode === 'relay404') return new Response('Not found', { status: 404 });
    if (mode === 'relay502') return json({ error: 'relay_upstream_failed' }, 502);
    if (url.includes('/oauth/token')) return json({ access_token: 'tok-123' });
    if (url.includes('/v1/user/access_token_info')) return json({ id: 555, app_id: 4242 });
    if (url.includes('/v2/user/me')) return json({ id: 555, kakao_account: { email: 'relay@user.test', profile: { nickname: '중계사람' } } });
    return json({}, 404);
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const k of ENV_KEYS) delete process.env[k];
});

const webLogin = () => request.post('/api/auth/kakao').send({ code: 'auth-code-1', redirectUri: 'https://artlink.cc/auth/kakao/callback' });
const appLogin = () => request.post('/api/auth/kakao/native').send({ accessToken: 'app-access-token-abc' });

describe('서버 — 카카오 주소는 환경 변수로 바꾼다', () => {
  it('기본은 카카오로 바로 · 비밀이 있어도 카카오로는 보내지 않는다', async () => {
    process.env.KAKAO_RELAY_SECRET = 'top-secret-value';
    const r = await webLogin();
    expect(r.status).toBe(200);
    expect(calls.map((c) => c.url)).toEqual(['https://kauth.kakao.com/oauth/token', 'https://kapi.kakao.com/v2/user/me']);
    for (const c of calls) expect(c.headers.get('x-relay-secret')).toBeNull();
  });

  it('★ 중계 주소를 넣으면 세 경로 모두 중계로 · 비밀 머리를 붙인다(웹·앱 로그인)', async () => {
    process.env.KAKAO_AUTH_URL = 'https://relay.example.workers.dev/auth/';
    process.env.KAKAO_API_URL = 'https://relay.example.workers.dev/api';
    process.env.KAKAO_RELAY_SECRET = 'top-secret-value';
    process.env.KAKAO_APP_ID = '4242';
    expect((await webLogin()).status).toBe(200);
    expect((await appLogin()).status).toBe(200);
    expect(calls.map((c) => c.url)).toEqual([
      'https://relay.example.workers.dev/auth/oauth/token',
      'https://relay.example.workers.dev/api/v2/user/me',
      'https://relay.example.workers.dev/api/v1/user/access_token_info',
      'https://relay.example.workers.dev/api/v2/user/me',
    ]);
    for (const c of calls) expect(c.headers.get('x-relay-secret')).toBe('top-secret-value');
    expect(calls[0].method).toBe('POST');
    expect(calls[0].body).toContain('code=auth-code-1');
    expect(calls[1].headers.get('authorization')).toBe('Bearer tok-123');
  });

  it('https 가 아닌 중계 주소는 무시한다(토큰이 평문으로 지나가지 않게)', () => {
    process.env.KAKAO_AUTH_URL = 'http://relay.example.workers.dev/auth';
    process.env.KAKAO_API_URL = '  ';
    expect(kakaoBase('auth')).toBe('https://kauth.kakao.com');
    expect(kakaoRelayed('auth')).toBe(false);
    expect(kakaoBase('api')).toBe('https://kapi.kakao.com');
  });

  it('★ 카카오에 못 닿으면 503 + 알아듣는 말(예전엔 10초 뒤 "서버 내부 오류" 500)', async () => {
    mode = 'down';
    process.env.KAKAO_APP_ID = '4242';
    const web = await webLogin();
    expect(web.status).toBe(503);
    expect(web.body.error).toContain('카카오에 연결하지 못했어요');
    const app = await appLogin();
    expect(app.status).toBe(503);
  });

  it('중계가 404(비밀 틀림·주소 틀림)·502(중계가 카카오에 못 닿음)면 503 — "로그인 실패"·"만료"로 알리지 않는다', async () => {
    process.env.KAKAO_AUTH_URL = 'https://relay.example.workers.dev/auth';
    process.env.KAKAO_API_URL = 'https://relay.example.workers.dev/api';
    process.env.KAKAO_APP_ID = '4242';
    for (const m of ['relay404', 'relay502'] as const) {
      mode = m;
      expect((await webLogin()).status, `${m} 웹`).toBe(503);
      expect((await appLogin()).status, `${m} 앱`).toBe(503);
    }
  });
});

describe('중계 Worker — infra/cloudflare/kakao-relay.js', () => {
  // 백엔드 tsc(rootDir src) 밖의 파일이라 이름을 계산해서 불러온다
  const load = async () => (await import(pathToFileURL(resolve(__dirname, '../../../infra/cloudflare/kakao-relay.js')).href)).default as {
    fetch: (req: Request, env: Record<string, string | undefined>) => Promise<Response>;
  };
  const env = { RELAY_SECRET: 'worker-secret-1234' };
  const req = (path: string, init: RequestInit = {}) => new Request(`https://relay.example.workers.dev${path}`, init);

  it('비밀이 없거나 틀리거나 Worker 에 비밀이 없으면 404 · 카카오는 부르지 않는다', async () => {
    const w = await load();
    expect((await w.fetch(req('/api/v2/user/me'), env)).status).toBe(404);
    expect((await w.fetch(req('/api/v2/user/me', { headers: { 'x-relay-secret': 'worker-secret-123' } }), env)).status).toBe(404);
    expect((await w.fetch(req('/api/v2/user/me', { headers: { 'x-relay-secret': '' } }), {})).status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it('세 경로만 연다 — 다른 경로·다른 메서드는 404', async () => {
    const w = await load();
    const h = { 'x-relay-secret': env.RELAY_SECRET };
    expect((await w.fetch(req('/api/v1/user/unlink', { method: 'POST', headers: h }), env)).status).toBe(404);
    expect((await w.fetch(req('/auth/oauth/token', { headers: h }), env)).status).toBe(404);
    expect((await w.fetch(req('/api/v2/user/me/../../v1/user/logout', { headers: h }), env)).status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it('★ 맞으면 카카오의 같은 경로로 넘기고 답을 그대로 · 넘기는 머리는 content-type·authorization 뿐', async () => {
    const w = await load();
    const tok = await w.fetch(req('/auth/oauth/token', {
      method: 'POST',
      headers: { 'x-relay-secret': env.RELAY_SECRET, 'content-type': 'application/x-www-form-urlencoded', cookie: 'a=b' },
      body: 'grant_type=authorization_code&code=xyz',
    }), env);
    expect(tok.status).toBe(200);
    expect(await tok.json()).toEqual({ access_token: 'tok-123' });
    expect(tok.headers.get('cache-control')).toBe('no-store');
    const me = await w.fetch(req('/api/v2/user/me', { headers: { 'x-relay-secret': env.RELAY_SECRET, authorization: 'Bearer abc' } }), env);
    expect(me.status).toBe(200);
    expect(calls.map((c) => c.url)).toEqual(['https://kauth.kakao.com/oauth/token', 'https://kapi.kakao.com/v2/user/me']);
    expect(calls[0].body).toBe('grant_type=authorization_code&code=xyz');
    for (const c of calls) {
      expect(c.headers.get('x-relay-secret')).toBeNull();
      expect(c.headers.get('cookie')).toBeNull();
    }
    expect(calls[1].headers.get('authorization')).toBe('Bearer abc');
  });

  it('카카오에 못 닿으면 502 JSON (서버는 이걸 503 으로 바꾼다)', async () => {
    const w = await load();
    mode = 'down';
    const r = await w.fetch(req('/api/v2/user/me', { headers: { 'x-relay-secret': env.RELAY_SECRET } }), env);
    expect(r.status).toBe(502);
    expect(await r.json()).toEqual({ error: 'relay_upstream_failed' });
  });
});
