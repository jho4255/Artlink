# feat: Instagram 연동 — 수동 토큰 → OAuth(Instagram API with Instagram Login) 전환

> 작성: dongju / 2026-06-03
> 선행 문서: [`feat-instagram-dj-0308.md`](./feat-instagram-dj-0308.md) (수동 토큰 MVP) 의 "향후 전환 계획(OAuth)" 을 이번에 구현 완료.

---

## 1. 기존 상황

- 갤러리 오너가 Instagram을 연동하려면 **Meta Graph API Explorer에서 액세스 토큰을 직접 발급**받아
  ArtLink MyPage의 입력 모달에 **수동으로 붙여넣는** 방식이었음 (`POST /galleries/:id/instagram-token`).
- 일반 사용자가 수행하기 매우 어렵고, 토큰 만료(장기 60일) 시 재발급/재입력이 필요했음.
- `Gallery` 모델에 `instagramAccessToken`은 있었으나 **만료 시각을 저장하지 않아** 자동 갱신이 불가능했음.

### 이슈
- 상업화 전 OAuth 전환이 필수였고, Meta가 제공하는 **"Instagram API with Instagram Login"** 방식으로
  버튼 한 번 → 권한 허용 → 자동 토큰 발급/저장 흐름이 필요.

---

## 2. 변경 사항

### 2-1. OAuth 인증 흐름 (신규)
```
MyPage [연동하기]
  → www.instagram.com/oauth/authorize (client_id=Instagram앱ID, redirect_uri, scope=instagram_business_basic, state)
  → 인스타 로그인/권한 허용
  → /auth/instagram/callback?code=&state=  (InstagramCallbackPage)
  → POST /galleries/:id/instagram/connect { code, redirectUri }
  → (백엔드) code → 단기토큰 → 장기토큰(60일) → username 조회 → DB 저장
```

### 2-2. 백엔드 (`backend/src/routes/gallery.ts`)
- `POST /:id/instagram-token` (수동 토큰 저장) **삭제** → `POST /:id/instagram/connect` (OAuth code 교환) **신규**.
  - `instagramConnectSchema` (zod): `code`, `redirectUri` 검증.
  - 3단계 교환: ① `api.instagram.com/oauth/access_token` (code→단기) ② `graph.instagram.com/access_token?grant_type=ig_exchange_token` (단기→장기 60일) ③ `graph.instagram.com/me` (username).
  - `INSTAGRAM_APP_ID` / `INSTAGRAM_APP_SECRET` 미설정 시 500.
- `refreshInstagramTokenIfNeeded()` **신규**: 만료 7일 전이면 `refresh_access_token`으로 장기토큰 갱신 (best-effort, 실패 시 기존 토큰 유지). 피드 조회 시 호출.
- 저장 필드에 `instagramTokenExpiresAt` 추가.

### 2-3. DB (`schema.prisma` + 마이그레이션)
- `Gallery.instagramTokenExpiresAt DateTime?` 추가.
- 마이그레이션: `20260602071333_add_instagram_token_expiry`
  ```sql
  ALTER TABLE "Gallery" ADD COLUMN "instagramTokenExpiresAt" TIMESTAMP(3);
  ```

### 2-4. 프론트엔드
- `MyPage.tsx`: 토큰 입력 모달 **삭제** → `handleConnectInstagram()`이 authorize URL로 redirect (state는 sessionStorage에 저장해 CSRF 방어).
- `InstagramCallbackPage.tsx` **신규**: code/state 검증 → `connect` 호출 → 결과 toast 후 `/mypage?tab=my-galleries` 복귀.
- `App.tsx`: `/auth/instagram/callback` 라우트 추가.
- `vite.config.ts`: `DEV_HTTPS=true` 시 `@vitejs/plugin-basic-ssl`로 self-signed HTTPS (인스타 OAuth는 HTTPS redirect 필수).
- `.env.example`(backend/frontend) 추가: `INSTAGRAM_APP_ID/SECRET`, `VITE_INSTAGRAM_APP_ID`.

### 2-5. 개발 보조 (`backend/prisma/dev-token.ts`, 신규)
- 카카오 OAuth 없이 시드 계정(`gallery@artlink.com`)으로 로그인 상태를 만드는 dev 전용 JWT 발급 스크립트. 운영(`NODE_ENV=production`)에서는 실행 거부.

> ⚠️ **중요 함정**: OAuth `client_id`/`client_secret`은 **Instagram 앱 ID/시크릿**(App Dashboard > Instagram > API setup with Instagram login)을 써야 함. **메타 앱 ID/시크릿이 아님** (같은 앱 안에 두 종류가 따로 존재, 혼동 시 "Invalid redirect_uri"/인증 실패). redirect URI는 Meta에 **정확히 일치**하게 등록 필요 (끝 슬래시 주의).

---

## 3. 테스트해야 할 내용

### 3-1. 자동 테스트 (수정됨)
- `backend/src/__tests__/instagram.test.ts` — `instagram-token` → `instagram/connect` 변경에 맞춰 갱신 (fetch mock: code→단기→장기→me).
- `backend/src/__tests__/integration/full-flow.test.ts` — 연동 플로우 반영.
- 실행: `cd backend && npm test` / `cd frontend && npm test`.

### 3-2. 수동 검증 체크리스트 (로컬, 2026-06-03 완료)
- [x] 사전조건: `backend/.env`(INSTAGRAM_APP_ID/SECRET=**Instagram 값**), `frontend/.env`(VITE_INSTAGRAM_APP_ID=동일), Meta 앱에 `https://localhost:5173/auth/instagram/callback` 등록.
- [x] 프론트 HTTPS 기동: `cd frontend && DEV_HTTPS=true npm run dev`.
- [x] 갤러리 오너 로그인 → MyPage 내 갤러리 → [연동하기] → authorize → 권한 허용 → 콜백 복귀 → "연동되었습니다".
- [x] DB 확인: `instagramAccessToken`(장기토큰), `instagramTokenExpiresAt`(~60일), `instagramUrl`(@username) 저장됨.
- [x] `GET /galleries/:id/instagram-feed` 실제 미디어 9개 반환 (피드 공개 토글 ON).
- [ ] **운영 검증 필요**: Render env 등록(`INSTAGRAM_APP_ID/SECRET`, `VITE_INSTAGRAM_APP_ID`) + Meta OAuth redirect URIs에 운영 도메인 콜백 추가(경로까지, 끝 슬래시X) + 앱 검수/라이브 전환(일반 유저 연동 시).
  - 운영 도메인 2개 모두 등록: `https://artlink.cc/auth/instagram/callback` (실서비스 커스텀 도메인), `https://artlink-phrf.onrender.com/auth/instagram/callback` (Render 기본). 프론트가 `window.location.origin` 기준으로 콜백을 보내므로 접속 가능한 도메인은 모두 등록 필요.
- [ ] 토큰 만료 임박(7일 이내) 시 자동 갱신 동작 (`refreshInstagramTokenIfNeeded`) — 만료일 임의 조정 후 피드 조회로 확인.

### 3-3. 엣지 케이스
- [ ] authorize 취소(`?error=...`) → "연동이 취소되었습니다" toast 후 복귀.
- [ ] state 불일치/누락 → "올바르지 않은 요청" 차단 (CSRF 방어).
- [ ] 잘못된 시크릿/code → connect 400, 기존 연동 상태 변동 없음.

---

## 4. Diff (요약)

### schema.prisma
```diff
   instagramAccessToken    String?  // Instagram 장기 액세스 토큰(60일, 서버 전용) — OAuth로 발급
+  instagramTokenExpiresAt DateTime? // 장기 토큰 만료 시각 — 만료 임박 시 갱신
```

### backend/src/routes/gallery.ts (핵심)
```diff
-router.post('/:id/instagram-token', authenticate, async (req, res, next) => {
-    const { accessToken } = req.body;
-    if (!accessToken) throw new AppError('액세스 토큰을 입력해주세요.', 400);
+const instagramConnectSchema = z.object({ code: z.string().min(1), redirectUri: z.string().url() });
+router.post('/:id/instagram/connect', authenticate, validate(instagramConnectSchema), async (req, res, next) => {
+    const appId = process.env.INSTAGRAM_APP_ID || '';
+    const appSecret = process.env.INSTAGRAM_APP_SECRET || '';
+    if (!appId || !appSecret) throw new AppError('Instagram 연동이 서버에 설정되지 않았습니다.', 500);
+    // 1) code → 단기  2) 단기 → 장기(60일)  3) /me username  → DB 저장(+expiresAt)
```
+ `refreshInstagramTokenIfNeeded()` 신규 (만료 7일 전 갱신), 피드 조회에서 호출.

### frontend/src/pages/MyPage.tsx (핵심)
```diff
-  // 토큰 입력 모달 + saveTokenMutation(POST instagram-token)
+  const handleConnectInstagram = (galleryId) => {
+    sessionStorage.setItem('ig_oauth_state', state);  // CSRF
+    window.location.href = `https://www.instagram.com/oauth/authorize?client_id=...&redirect_uri=...&scope=instagram_business_basic&state=...`;
+  };
```

### frontend/vite.config.ts
```diff
+import basicSsl from '@vitejs/plugin-basic-ssl';
+const useHttps = process.env.DEV_HTTPS === 'true';
     ...(useHttps ? [basicSsl()] : []),
```

> 전체 diff는 커밋(`git show`)에서 확인. 변경 파일: `gallery.ts`, `MyPage.tsx`, `InstagramCallbackPage.tsx`(신규), `App.tsx`, `vite.config.ts`, `schema.prisma` + 마이그레이션, `.env.example`(b/f), 테스트 2종, `dev-token.ts`(신규), `architecture.md`.
