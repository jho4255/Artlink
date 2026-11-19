# 카카오 중계 (Cloudflare Worker)

**언제 쓰나**: 실서버(Render)에서 카카오(`kauth.kakao.com`·`kapi.kakao.com`)에 직접 닿지 않을 때.
2026-11-19 에 Render 싱가포르의 나가는 IP(74.220.52.222)에서만 카카오 연결이 15초 타임아웃으로 막혀
카카오 로그인·가입이 전부 멈췄다(한국·싱가포르의 다른 망·해외 40곳에서는 정상). CLAUDE.md 규칙 86.

**어떻게**: 서버는 환경 변수만 바꾸면 이 Worker 를 거친다(`backend/src/lib/kakaoHttp.ts`). 코드 배포가 필요 없다.
Worker 는 아트링크가 쓰는 세 경로만, 비밀 머리가 맞을 때만 카카오로 그대로 넘긴다. 아무것도 저장하지 않는다.

| Worker 경로 | 넘기는 곳 |
|---|---|
| `POST /auth/oauth/token` | `https://kauth.kakao.com/oauth/token` (웹 로그인 — 인가 코드 → 토큰) |
| `GET /api/v2/user/me` | `https://kapi.kakao.com/v2/user/me` (사용자 정보) |
| `GET /api/v1/user/access_token_info` | `https://kapi.kakao.com/v1/user/access_token_info` (앱 로그인 — 우리 앱 토큰인지) |

## 설치 (Cloudflare 대시보드, 5분)

1. 비밀 값 하나 만들기 — 터미널에서 `openssl rand -hex 32` (이 값을 아래 두 곳에 똑같이 넣는다. 저장소·문서에 적지 말 것)
2. Cloudflare 대시보드 → **Workers & Pages** → **Create** → **Create Worker** → 이름 `artlink-kakao-relay` → **Deploy**
3. **Edit code** → 기본 코드를 지우고 `infra/cloudflare/kakao-relay.js` 내용을 통째로 붙여 넣기 → **Deploy**
4. Worker → **Settings → Variables and Secrets** → **Add** → 종류 **Secret**, 이름 `RELAY_SECRET`, 값 = 1번 값 → **Deploy**
5. Worker 주소 확인: `https://artlink-kakao-relay.<계정>.workers.dev`
6. **Render 셸에서 Worker 를 거쳐 카카오에 닿는지 확인** (비밀 값은 1번 값):
   ```
   curl -s -m 15 -w '\n%{http_code} %{time_total}s\n' -X POST https://artlink-kakao-relay.<계정>.workers.dev/auth/oauth/token \
     -H 'X-Relay-Secret: <1번 값>' -d grant_type=authorization_code -d client_id=x -d code=x
   ```
   → 1초 안에 카카오의 JSON 오류(`"error":"invalid_client"` 류)와 `401` 이 오면 성공이다(가짜 값을 보냈으니 거절이 정상).
   `Not found` 404 면 비밀 값·경로가 틀린 것, 15초 타임아웃이면 Worker 주소가 틀린 것이다.
7. Render → 서비스 → **Environment** 에 세 개 추가 → **Save, rebuild, and deploy**(또는 Save and deploy):
   ```
   KAKAO_AUTH_URL      = https://artlink-kakao-relay.<계정>.workers.dev/auth
   KAKAO_API_URL       = https://artlink-kakao-relay.<계정>.workers.dev/api
   KAKAO_RELAY_SECRET  = <1번 값>
   ```
8. 실서버에서 카카오 로그인을 직접 해 본다.

## 되돌리기

카카오가 Render IP 를 다시 받아 주면 Render 에서 `KAKAO_AUTH_URL`·`KAKAO_API_URL` 을 지우면 된다(비밀은 남겨 둬도 카카오로는 보내지 않는다).
Worker 는 지우지 않고 둬도 된다 — 비밀 없이는 404 만 준다.

## 주의

- 서버는 **https 가 아닌 중계 주소를 무시**하고 카카오로 바로 간다(토큰이 평문으로 지나가지 않게).
- 카카오 개발자 콘솔의 **허용 IP 주소**(보안 설정)를 켜 두었다면 Worker 의 IP 가 막힌다 — 이 중계를 쓰려면 꺼져 있어야 한다.
- Worker 무료 한도는 하루 10만 요청 — 로그인 한 번에 요청 2~3개라 넉넉하다.
- Worker 코드를 고치면 `backend/src/__tests__/kakao-relay.test.ts` 를 돌릴 것(같은 파일을 불러와 시험한다).
