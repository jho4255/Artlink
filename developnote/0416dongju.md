# feat: 둘러보기 (Explore) 기능 추가

---

## 기존 상황

- 작가(ARTIST)는 MyPage → 포트폴리오 탭에서 최대 30장의 작품 사진을 등록할 수 있었음
- 등록된 포트폴리오 이미지는 `/portfolio/:userId` 공개 페이지에서만 확인 가능
- **다른 사용자가 작가의 작품을 발견할 수 있는 탐색 진입점 없음** — 직접 포트폴리오 URL을 알아야만 접근 가능
- 좋아요(공감) 기능 없음 — 작가와 관람자 간 상호작용 수단 전무

---

## 추가한 기능

### 1. 헤더 `둘러보기` 탭

- Navbar에 `둘러보기` 링크(`/explore`) 추가
- 작가들이 공개 설정한 포트폴리오 이미지를 Instagram 탐색 탭처럼 격자로 표시

### 2. 포트폴리오 이미지 공개 설정 (작가 전용)

- MyPage → 포트폴리오 → 이미지에 마우스를 올리면 우하단에 체크박스 표시
- 체크 시 해당 이미지가 둘러보기에 노출, 해제 시 숨김
- 기본값 `false` (비공개) — 본인이 명시적으로 공개해야만 노출됨
- 낙관적 업데이트 적용 (즉시 반영, 실패 시 롤백)

### 3. 둘러보기 페이지 (`/explore`)

- 공개 설정된 이미지를 최신순으로 3열(모바일) / 4열(데스크탑) 격자로 표시
- 무한 스크롤 (30장씩 페이지네이션, `IntersectionObserver` 사용)
- 이미지 호버 시 좋아요 수 오버레이 표시

### 4. 이미지 상세 모달

- 이미지 클릭 시 확대 모달 오픈 (Portal 기반)
- 작가 아바타 + 이름 표시, 클릭 시 해당 작가 포트폴리오 페이지(`/portfolio/:userId`)로 이동
- ESC 키 / 배경 클릭으로 닫기

### 5. 좋아요 기능

- 하트 버튼으로 좋아요 토글 (로그인 필요, 비로그인 시 토스트 안내)
- 낙관적 업데이트 (하트/카운트 즉시 반영, 실패 시 롤백)
- 숫자를 클릭하면 **본인 이미지인 경우에만** 좋아요한 사람 목록 패널이 슬라이드 오픈
- 타인 이미지에서는 숫자 클릭 불가 (개수만 표시)

---

## 변경 내용

### DB 스키마 (`backend/prisma/schema.prisma`)

```diff
 model PortfolioImage {
-  id          Int       @id @default(autoincrement())
-  url         String
-  order       Int       @default(0)
-  portfolioId Int
-  portfolio   Portfolio @relation(fields: [portfolioId], references: [id], onDelete: Cascade)
+  id            Int       @id @default(autoincrement())
+  url           String
+  order         Int       @default(0)
+  showInExplore Boolean   @default(false)
+  portfolioId   Int
+  portfolio     Portfolio @relation(fields: [portfolioId], references: [id], onDelete: Cascade)
+  likes         PortfolioImageLike[]
 }

+// 포트폴리오 이미지 좋아요
+model PortfolioImageLike {
+  id        Int            @id @default(autoincrement())
+  userId    Int
+  user      User           @relation(fields: [userId], references: [id], onDelete: Cascade)
+  imageId   Int
+  image     PortfolioImage @relation(fields: [imageId], references: [id], onDelete: Cascade)
+  createdAt DateTime       @default(now())
+
+  @@unique([userId, imageId])
+  @@index([imageId])
+  @@index([userId])
+}
```

```diff
 model User {
   // Relations
-  galleries      Gallery[]
-  reviews        Review[]
-  favorites      Favorite[]
-  portfolio      Portfolio?
-  applications   Application[]
-  notifications  Notification[]
-  inquiries      Inquiry[]
+  galleries           Gallery[]
+  reviews             Review[]
+  favorites           Favorite[]
+  portfolio           Portfolio?
+  applications        Application[]
+  notifications       Notification[]
+  inquiries           Inquiry[]
+  portfolioImageLikes PortfolioImageLike[]
 }
```

> ⚠️ **스키마 변경 후 반드시 아래 명령 실행 필요:**
> ```bash
> cd backend
> npx prisma migrate dev --name add_explore_feature
> npx prisma generate
> ```

### 신규 파일

| 파일 | 내용 |
|------|------|
| `backend/src/routes/explore.ts` | 둘러보기 API 라우트 |
| `frontend/src/pages/ExplorePage.tsx` | 둘러보기 페이지 컴포넌트 |

### 수정 파일

#### `backend/src/routes/portfolio.ts`

```diff
+// 포트폴리오 이미지 showInExplore 토글
+router.patch('/images/:imageId/explore', authenticate, authorize('ARTIST'), async (req, res, next) => {
+  // 본인 이미지 확인 후 showInExplore 반전
+  const updated = await prisma.portfolioImage.update({
+    where: { id: imageId },
+    data: { showInExplore: !image.showInExplore },
+  });
+  res.json(updated);
+});
```

#### `backend/src/index.ts`

```diff
+import exploreRoutes from './routes/explore';
+app.use('/api/explore', exploreRoutes);
```

#### `frontend/src/types/index.ts`

```diff
+export interface PortfolioImage {
+  id: number;
+  url: string;
+  order: number;
+  showInExplore: boolean;
+}

 export interface Portfolio {
   id: number;
   biography?: string;
   exhibitionHistory?: string;
-  images: { id: number; url: string; order: number }[];
+  images: PortfolioImage[];
 }

+export interface ExploreImage {
+  id: number;
+  url: string;
+  artist: { id: number; name: string; avatar?: string };
+  likeCount: number;
+  isLiked: boolean;
+}
```

#### `frontend/src/components/layout/Navbar.tsx`

```diff
 const navLinks = [
   { path: '/', label: '홈' },
+  { path: '/explore', label: '둘러보기' },
   { path: '/galleries', label: '갤러리' },
```

#### `frontend/src/App.tsx`

```diff
+import ExplorePage from '@/pages/ExplorePage';
+<Route path="/explore" element={<ExplorePage />} />
```

#### `frontend/src/pages/MyPage.tsx`

```diff
+// 둘러보기 공개 토글 mutation 추가
+const exploreToggleMutation = useMutation({
+  mutationFn: (imageId: number) => api.patch(`/portfolio/images/${imageId}/explore`),
+  onMutate: async (imageId) => { /* 낙관적 업데이트 */ },
+  onError: (_err, _id, ctx) => { /* 롤백 */ },
+  onSettled: () => {
+    queryClient.invalidateQueries({ queryKey: ['portfolio'] });
+    queryClient.invalidateQueries({ queryKey: ['explore'] });
+  },
+});

-// MultiImageUpload 단순 사용
-<MultiImageUpload images={portfolio?.images || []} onAdd={...} onRemove={...} maxCount={30} />

+// 체크박스 포함 커스텀 그리드로 교체
+<PortfolioImageGrid
+  images={portfolio?.images || []}
+  onAdd={(url) => addImageMutation.mutate(url)}
+  onRemove={(imageId) => removeImageMutation.mutate(imageId)}
+  onToggleExplore={(imageId) => exploreToggleMutation.mutate(imageId)}
+  maxCount={30}
+/>
```

---

## API 명세

### `GET /api/explore`

```
Query: page=1, limit=30
Auth: optionalAuth (비로그인 가능, 로그인 시 isLiked 포함)

Response:
{
  "images": [
    {
      "id": 42,
      "url": "/uploads/...",
      "artist": { "id": 3, "name": "김민수", "avatar": null },
      "likeCount": 7,
      "isLiked": false
    }
  ],
  "total": 120,
  "page": 1,
  "limit": 30
}
```

### `POST /api/explore/:imageId/like`

```
Auth: 필수 (JWT)

Response:
{ "liked": true, "likeCount": 8 }
```

### `GET /api/explore/:imageId/likes`

```
Auth: optionalAuth

Response (이미지 주인):
{ "likeCount": 8, "likers": [{ "id": 5, "name": "이예진", "avatar": null }] }

Response (타인 / 비로그인):
{ "likeCount": 8, "likers": [] }
```

### `PATCH /api/portfolio/images/:imageId/explore`

```
Auth: 필수 (ARTIST 전용)
동작: showInExplore 현재값 반전 (toggle)
Response: 업데이트된 PortfolioImage 객체
```

---

## TanStack Query 키

| 쿼리 키 | 사용 위치 | invalidate 하는 곳 |
|---------|----------|-------------------|
| `['explore']` | ExplorePage | 좋아요 토글, explore 토글 |
| `['explore-likes', imageId]` | ImageDetailModal | (fetch only, 30초 캐시) |

---

## 확인 항목

### 신규 기능

- [x] Navbar에 `둘러보기` 탭 표시
- [x] `/explore` 진입 → 공개 이미지 격자 표시 (공개 이미지 없으면 안내 문구)
- [x] 이미지 호버 → 하트 개수 오버레이
- [x] 이미지 클릭 → 확대 모달, 작가 이름 표시
- [x] 모달 내 작가 이름 클릭 → `/portfolio/:userId`로 이동
- [x] 로그인 후 하트 클릭 → 카운트 증가, 재클릭 시 감소
- [x] 비로그인 하트 클릭 → 토스트 안내
- [x] 본인 이미지 모달에서 숫자 클릭 → 하단 패널 슬라이드 오픈, 좋아요한 사람 목록 표시
- [x] 타인 이미지 모달에서 숫자 → 클릭 불가, 개수만 표시
- [x] 좋아요한 사람 없으면 패널에 "아직 좋아요한 사람이 없습니다." 표시
- [x] ESC / 배경 클릭으로 모달 닫힘
- [x] 스크롤 하단 도달 → 다음 페이지 자동 로드

### 포트폴리오 체크박스

- [x] MyPage 포트폴리오 → 이미지 호버 시 우하단 체크박스 표시
- [x] 체크 → 둘러보기에 이미지 공개, 즉시 반영 (낙관적)
- [x] 해제 → 둘러보기에서 제거
- [x] 공개 중인 이미지는 호버 없이도 체크 아이콘 상시 표시

### 기존 기능 영향 없음 확인

- [ ] 포트폴리오 약력/이력 수정 정상
- [ ] 포트폴리오 이미지 추가/삭제 정상
- [ ] 공개 포트폴리오 페이지(`/portfolio/:userId`) 정상
- [ ] 기존 `MultiImageUpload` 사용처 (Show 등록 폼) 정상

---

## 개선 PLAN

> Claude에서 Shift+Tab으로 PLAN mode 전환 후 아래 내용을 기반으로 타 에이전트가 동일하게 적용할 수 있도록 요청할 것.

---

### 사전 이해

이 플랜은 ArtLink에 "둘러보기(Explore)" 기능을 추가하는 작업이다.
CLAUDE.md와 architecture.md를 먼저 읽고 프로젝트 구조를 파악한 뒤 아래 순서대로 진행한다.

핵심 설계 결정:
- 포트폴리오 이미지에 `showInExplore Boolean @default(false)` 필드 추가 — 작가가 명시적으로 공개해야만 노출 (opt-in)
- 좋아요는 `PortfolioImageLike` 별도 모델로 관리 (`@@unique([userId, imageId])`로 중복 방지)
- 좋아요한 사람 목록은 이미지 주인만 열람 가능 — `GET /explore/:id/likes` 응답을 소유자 여부로 분기
- 비로그인 사용자도 둘러보기 열람 가능 (`optionalAuth`), 좋아요는 로그인 필요
- 낙관적 업데이트: 체크박스 토글, 좋아요 토글 모두 즉시 반영 후 서버 실패 시 롤백

---

### Step 1: DB 스키마 수정 및 마이그레이션

**파일:** `backend/prisma/schema.prisma`

`PortfolioImage` 모델에 `showInExplore` 필드 추가:
```prisma
model PortfolioImage {
  id            Int       @id @default(autoincrement())
  url           String
  order         Int       @default(0)
  showInExplore Boolean   @default(false)
  portfolioId   Int
  portfolio     Portfolio @relation(fields: [portfolioId], references: [id], onDelete: Cascade)
  likes         PortfolioImageLike[]
}
```

`PortfolioImageLike` 모델 신규 추가:
```prisma
model PortfolioImageLike {
  id        Int            @id @default(autoincrement())
  userId    Int
  user      User           @relation(fields: [userId], references: [id], onDelete: Cascade)
  imageId   Int
  image     PortfolioImage @relation(fields: [imageId], references: [id], onDelete: Cascade)
  createdAt DateTime       @default(now())

  @@unique([userId, imageId])
  @@index([imageId])
  @@index([userId])
}
```

`User` 모델에 역방향 relation 추가:
```prisma
portfolioImageLikes PortfolioImageLike[]
```

마이그레이션 실행:
```bash
cd backend
npx prisma migrate dev --name add_explore_feature
npx prisma generate
```

---

### Step 2: 백엔드 explore 라우트 생성

**파일 생성:** `backend/src/routes/explore.ts`

엔드포인트 3개:

**① GET / — 둘러보기 이미지 목록**
- `optionalAuth`
- `where: { showInExplore: true }`, 최신순, 페이지네이션
- `_count: { likes: true }` 포함, 로그인 시 `isLiked` 계산
- 응답: `{ images, total, page, limit }`

**② POST /:imageId/like — 좋아요 토글**
- `authenticate` 필수
- 기존 좋아요 있으면 delete, 없으면 create
- 응답: `{ liked: boolean, likeCount: number }`

**③ GET /:imageId/likes — 좋아요한 사람 목록**
- `optionalAuth`
- `isOwner = req.user?.id === image.portfolio.userId`
- 오너: likers 배열 포함, 타인: 빈 배열
- 응답: `{ likeCount: number, likers: User[] }`

`backend/src/index.ts`에 등록:
```typescript
import exploreRoutes from './routes/explore';
app.use('/api/explore', exploreRoutes);
```

---

### Step 3: 포트폴리오 라우트에 토글 API 추가

**파일:** `backend/src/routes/portfolio.ts`

기존 `DELETE /images/:imageId` 위에 추가:
```typescript
// PATCH /portfolio/images/:imageId/explore — showInExplore 토글 (본인 이미지 확인 후)
router.patch('/images/:imageId/explore', authenticate, authorize('ARTIST'), async (req, res, next) => {
  // image.portfolio.userId !== req.user!.id 이면 404
  // prisma.portfolioImage.update({ data: { showInExplore: !image.showInExplore } })
});
```

---

### Step 4: 프론트엔드 타입 수정

**파일:** `frontend/src/types/index.ts`

```typescript
export interface PortfolioImage {
  id: number;
  url: string;
  order: number;
  showInExplore: boolean;
}

export interface Portfolio {
  id: number;
  biography?: string;
  exhibitionHistory?: string;
  images: PortfolioImage[];   // 기존 인라인 타입 → PortfolioImage 참조로 변경
}

// PublicPortfolio의 images도 PortfolioImage[]로 변경

export interface ExploreImage {
  id: number;
  url: string;
  artist: { id: number; name: string; avatar?: string };
  likeCount: number;
  isLiked: boolean;
}
```

---

### Step 5: ExplorePage 생성

**파일 생성:** `frontend/src/pages/ExplorePage.tsx`

구성 요소:
- `useInfiniteQuery(['explore'])` — `GET /explore?page=X&limit=30`
- `IntersectionObserver` sentinel으로 무한 스크롤
- `GridItem` 컴포넌트: `aspect-square`, 호버 시 scale + 하트 개수 오버레이
- `ImageDetailModal` 컴포넌트 (Portal):
  - 작가 아바타 + 이름 → `/portfolio/:userId` 링크
  - 하트 버튼 (로그인 체크)
  - 좋아요 카운트 — 본인 이미지일 때 클릭 가능 (밑줄, cursor-pointer), 타인은 cursor-default
  - `AnimatePresence` + `motion.div`로 likers 패널 슬라이드
  - `useQuery(['explore-likes', imageId])` — `enabled: isOwner && showLikers`

`App.tsx`에 라우트 추가:
```typescript
import ExplorePage from '@/pages/ExplorePage';
<Route path="/explore" element={<ExplorePage />} />
```

---

### Step 6: Navbar 수정

**파일:** `frontend/src/components/layout/Navbar.tsx`

```typescript
const navLinks = [
  { path: '/', label: '홈' },
  { path: '/explore', label: '둘러보기' },  // 추가
  { path: '/galleries', label: '갤러리' },
  ...
];
```

---

### Step 7: MyPage PortfolioSection 수정

**파일:** `frontend/src/pages/MyPage.tsx`

`exploreToggleMutation` 추가 — `PATCH /portfolio/images/:id/explore`, 낙관적 업데이트 포함.

`MultiImageUpload` 대신 `PortfolioImageGrid` 커스텀 컴포넌트로 교체:
- 기존 이미지 삭제 버튼 (group-hover 시 우상단)
- `showInExplore` 체크박스 (group-hover 시 우하단, 공개 중일 때는 항상 표시)

---

### Step 8: 검증

```bash
cd backend && npx tsc --noEmit
cd ../frontend && npx tsc --noEmit
```

동작 검증:
1. ARTIST 로그인 → MyPage 포트폴리오 → 이미지 호버 → 우하단 체크박스 표시
2. 체크 → `/explore`에서 해당 이미지 노출 확인
3. 해제 → `/explore`에서 제거 확인
4. `/explore` → 격자 표시, 스크롤 하단 → 추가 로드
5. 이미지 클릭 → 모달, 작가 이름 클릭 → 포트폴리오 이동
6. 하트 클릭 → 카운트 증가 (낙관적)
7. 본인 이미지 숫자 클릭 → likers 패널 오픈
8. 타인 이미지 숫자 → 클릭 불가 확인
9. 비로그인 하트 클릭 → 토스트 안내
