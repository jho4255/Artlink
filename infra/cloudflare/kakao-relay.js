/**
 * 카카오 중계 — Cloudflare Worker (2026-11-19, CLAUDE.md 규칙 86 · 설치 방법은 같은 폴더 README.md)
 *
 * 아트링크 서버(Render)가 카카오에 직접 닿지 못할 때만 쓴다. 서버의 환경 변수
 *   KAKAO_AUTH_URL = https://<이 Worker>/auth   KAKAO_API_URL = https://<이 Worker>/api
 * 로 바꾸면 서버가 여기를 부르고, 여기는 kauth.kakao.com · kapi.kakao.com 의 같은 경로로 그대로 넘긴 뒤 답을 그대로 돌려준다.
 *
 * ⚠️ 아트링크가 쓰는 세 경로만 연다 — 아무 카카오 API 나 대신 불러 주는 열린 중계가 되지 않게.
 * ⚠️ X-Relay-Secret 머리가 Worker 비밀 RELAY_SECRET 과 같을 때만 — 아니면 404(있다는 것도 알리지 않는다).
 *    RELAY_SECRET 을 안 넣었으면 모든 요청이 404 다(비밀 없이 열지 않는다).
 * ⚠️ 아무것도 저장하거나 로그로 남기지 않는다 — 인가 코드·접근 토큰이 지나간다.
 *    넘기는 머리도 content-type · authorization 둘뿐이다(우리 비밀은 카카오로 넘기지 않는다).
 */
const ROUTES = {
  'POST /auth/oauth/token': 'https://kauth.kakao.com/oauth/token',
  'GET /api/v2/user/me': 'https://kapi.kakao.com/v2/user/me',
  'GET /api/v1/user/access_token_info': 'https://kapi.kakao.com/v1/user/access_token_info',
};

const MAX_BODY = 8 * 1024; // 토큰 요청 폼은 수백 바이트다

/** 길이·내용을 같은 시간에 비교한다(비밀 값을 한 글자씩 맞혀 보지 못하게) */
function sameSecret(given, expected) {
  if (typeof given !== 'string' || typeof expected !== 'string' || !expected) return false;
  let diff = given.length ^ expected.length;
  for (let i = 0; i < expected.length; i++) diff |= (given.charCodeAt(i) || 0) ^ expected.charCodeAt(i);
  return diff === 0;
}

const notFound = () => new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const target = ROUTES[`${request.method} ${url.pathname}`];
    if (!target || !sameSecret(request.headers.get('x-relay-secret') || '', env && env.RELAY_SECRET)) return notFound();

    const headers = new Headers();
    for (const name of ['content-type', 'authorization']) {
      const v = request.headers.get(name);
      if (v) headers.set(name, v);
    }
    const init = { method: request.method, headers, redirect: 'manual' };
    if (request.method === 'POST') {
      const body = await request.text();
      if (body.length > MAX_BODY) return new Response('Payload too large', { status: 413, headers: { 'cache-control': 'no-store' } });
      init.body = body;
    }

    try {
      const res = await fetch(target + url.search, init);
      const out = new Headers({ 'cache-control': 'no-store' });
      const ct = res.headers.get('content-type');
      if (ct) out.set('content-type', ct);
      return new Response(res.body, { status: res.status, headers: out });
    } catch {
      return new Response(JSON.stringify({ error: 'relay_upstream_failed' }), {
        status: 502,
        headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
      });
    }
  },
};
