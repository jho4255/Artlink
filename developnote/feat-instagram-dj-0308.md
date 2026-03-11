# feat: Instagram 피드 연동 및 프로필 링크 공개 설정

---

> ## ⚠️ 다음 에이전트 필독: 현재 구현의 임시 방식과 향후 전환 계획
>
> **현재 구현은 MVP 프로토타입용 임시 방식이다.**
>
> 현재 갤러리 오너가 Instagram 계정을 연동할 때, Meta 개발자 콘솔(Graph API Explorer)에서
> 액세스 토큰을 직접 발급받아 ArtLink MyPage에 수동으로 붙여넣는 방식을 사용하고 있다.
> 이는 일반 사용자가 수행하기에 매우 어렵고 불편한 방식으로, **상업화 전 반드시 OAuth로 전환해야 한다.**
>
> **현재 수동 토큰 방식을 유지하는 이유: Meta 앱 심사 필요**
>
> Instagram OAuth를 적용하려면 Meta 개발자 콘솔에서 앱을 생성하고,
> **Meta의 공식 앱 심사(App Review)를 통과한 뒤 앱을 Live 모드로 전환**해야 한다.
> 심사를 통과하기 전 개발 모드에서는 앱 소유자 본인과 사전 등록된 테스트 유저만 연동이 가능하며,
> 일반 갤러리 오너는 OAuth 연동 자체가 불가능하다.
> 또한 OAuth callback URL은 HTTPS가 필수이므로 로컬 개발 환경에서는 ngrok 등의 터널링 도구가 별도로 필요하다.
>
> 따라서 **상업화(서비스 정식 출시) 전 Meta 앱 심사 완료 시점에 OAuth로 전환할 예정**이며,
> 현재 MVP 단계에서는 갤러리 오너가 Meta Graph API Explorer에서 직접 액세스 토큰을 발급받아
> ArtLink MyPage에 붙여넣는 방식으로 운영한다.
>
> **향후 전환 계획: Instagram OAuth 로그인**
> - 갤러리 오너가 "Instagram으로 연동" 버튼을 클릭하면 Instagram 앱(또는 브라우저)으로 이동
> - "ArtLink가 미디어 접근 권한을 요청합니다" → 허용 클릭 한 번으로 완료
> - Instagram이 ArtLink 백엔드의 OAuth callback URL로 자동 redirect
> - 백엔드에서 authorization code → access token 교환 후 DB 자동 저장
> - 토큰 갱신도 자동화 가능 (장기 토큰 60일 만료 → 자동 갱신 스케줄러 구현 필요)
>
> **OAuth 전환 시 변경 범위 (최소화 설계됨):**
> - **백엔드**: `POST /api/galleries/:id/instagram-token` → OAuth callback 엔드포인트로 교체
> - **프론트엔드**: MyPage의 토큰 입력 모달 → Instagram OAuth redirect 버튼 1개로 교체
> - **나머지 코드 전부 재사용 가능**: 토큰 DB 저장 로직, 피드 조회 로직, 토글 UI 등 변경 불필요
>
> 즉, 현재 코드는 OAuth 전환을 고려해 추상화된 구조로 설계되어 있으므로,
> **토큰 입력 진입점만 바꾸면 나머지는 그대로 동작한다.**

---

## 기존 상황 및 이슈 상황

### 기존 상황
- `Gallery` 모델에 `instagramUrl String?` 필드가 존재하며, 갤러리 **등록 폼**에서 오너가 직접 Instagram 주소를 텍스트로 입력받고 있었음
- `GalleryDetailPage`에서 `instagramUrl`이 존재할 경우 단순 외부 링크(아이콘 + 텍스트)로만 표시
- Instagram 게시물 피드를 ArtLink 내에서 표시하는 기능 없음

### 이슈
- 갤러리는 Instagram에 이미 전시 사진과 업데이트를 올리고 있는데, ArtLink에도 동일한 콘텐츠를 별도로 업로드해야 하는 **이중 업로드 문제** 존재
- Instagram 주소를 등록 폼에서 자유 텍스트로 입력받다 보니 포맷이 제각각 (@handle, 전체 URL, 불완전 입력 등)이고, 실제 연동 여부와 무관하게 값이 저장됨
- 갤러리 오너가 Instagram 공개 여부를 제어할 수단이 없음

---

## 개선 내용

### 1. Instagram Graph API 백엔드 프록시 피드 연동

갤러리 오너가 Meta Graph API에서 발급한 액세스 토큰을 1회 입력하면, ArtLink가 해당 토큰을 서버에 안전하게 저장하고 갤러리 상세 페이지에서 최근 Instagram 게시물을 자동으로 표시함. 토큰은 서버에만 존재하며 프론트엔드에 절대 노출되지 않음.

**피드 조회 흐름:**
```
방문자 → GalleryDetailPage 접속
  → GET /api/galleries/:id (instagramConnected: boolean, instagramFeedVisible: boolean 포함)
  → instagramConnected && instagramFeedVisible === true
    → InstagramFeed 컴포넌트 마운트
    → GET /api/galleries/:id/instagram-feed
      → 백엔드: DB에서 instagramAccessToken 조회
      → Instagram Graph API 호출 (최근 9개 게시물)
      → 토큰 미포함 가공 데이터 반환
    → 3x3 썸네일 그리드 표시
    → 썸네일 클릭 → Instagram 원본 게시물 새 탭 오픈
```

**조건별 렌더링:**
| 상태 | GalleryDetailPage 표시 |
|------|----------------------|
| 미연동 | 섹션 자체 숨김 |
| 연동 + 피드 OFF | "Instagram 피드가 비공개 상태입니다." |
| 연동 + 피드 ON | 3x3 썸네일 그리드 |

### 2. 갤러리 등록 폼에서 instagramUrl 입력 제거

Instagram 주소를 더 이상 등록 폼에서 수동 입력받지 않음. 대신 Instagram 연동 시 Graph API에서 username을 자동으로 가져와 `@username` 형태로 `instagramUrl` 필드에 저장함.

### 3. MyPage Instagram 설정 블록 (승인된 갤러리만)

MyPage → 내 갤러리 탭의 각 승인 갤러리 카드 하단에 Instagram 설정 블록 추가.

**연동 흐름:**
```
갤러리 오너 → "연동하기" 버튼 클릭
  → 토큰 입력 모달 오픈
  → Meta Graph API Explorer에서 발급한 액세스 토큰 입력
  → POST /api/galleries/:id/instagram-token
    → 백엔드: Graph API 유효성 검증 (graph.instagram.com/me)
    → 유효 → DB에 instagramAccessToken 저장
           → instagramUrl = @username 자동 설정
    → 응답: { instagramConnected: true, username }
  → "연결됨" 상태로 전환, 두 토글 활성화
```

**토글 구성 (연동 후 활성화):**
- **프로필 링크 표시**: ON → `instagramUrl = @username` (갤러리 상세에 링크 노출), OFF → `instagramUrl = null`
- **피드 표시**: ON → `instagramFeedVisible = true` (갤러리 상세에 게시물 그리드 노출), OFF → `instagramFeedVisible = false`

---

## Local 확인 여부

### 신규 기능 확인
- [] MyPage → 내 갤러리 탭 → 승인된 갤러리에 Instagram 설정 블록 표시
- [] "연동하기" 클릭 → 토큰 입력 모달 오픈
- [] 유효한 토큰 입력 → 저장 성공, "연결됨" 상태 전환
- [] 잘못된 토큰 입력 → 에러 토스트 표시
- [] 피드 토글 ON → GalleryDetailPage에 Instagram 3x3 그리드 표시
- [] 피드 토글 OFF → "Instagram 피드가 비공개 상태입니다." 표시
- [] 프로필 링크 토글 ON → 갤러리 상세 기본 정보에 @handle 링크 표시
- [] 프로필 링크 토글 OFF → 링크 숨김
- [] 미연동 갤러리 상세 → Instagram 섹션 자체 숨김
- [] 비로그인 방문자로 갤러리 상세 → 피드 정상 표시
- [] 갤러리 등록 폼 → instagramUrl 입력란 없음
- [] 썸네일 클릭 → Instagram 원본 게시물 새 탭 오픈

### 기존 기능 정상 동작 확인
- [] 갤러리 목록 (지역 필터, 별점 필터, 정렬) 정상
- [] 갤러리 목록 찜하기 토글 정상
- [] 갤러리 상세 기본 정보 표시 정상
- [] 갤러리 상세 찜하기 토글 정상
- [] 갤러리 상세 상세소개 수정 (오너) 정상
- [] 갤러리 상세 진행중인 공모 표시 정상
- [] 갤러리 상세 리뷰 작성/삭제 정상
- [] MyPage 갤러리 목록, 등록 폼, 상태 표시 정상
- [] Admin 승인 큐 정상

---

## 개선 PLAN

> Claude에서 Shift+Tab으로 PLAN mode 전환 후 아래 내용을 기반으로 타 에이전트가 동일하게 적용할 수 있도록 요청할 것.

---

### 사전 이해

이 플랜은 ArtLink 프로젝트에 Instagram 피드 연동 기능을 추가하는 작업이다.
CLAUDE.md와 architecture.md를 먼저 읽고 프로젝트 구조를 파악한 뒤 아래 순서대로 진행한다.

핵심 설계 결정:
- Instagram 액세스 토큰은 **절대 프론트엔드에 노출하지 않음** — 백엔드 DB에만 저장하고 `instagramConnected: boolean`으로 변환하여 반환
- 게시물 데이터는 DB에 저장하지 않음 — Graph API 실시간 조회 + TanStack Query 5분 캐시
- `instagramUrl` 필드를 프로필 링크 가시성 플래그로 재활용 (별도 boolean 컬럼 불필요)
- API 오류 시 빈 배열 반환 (best-effort, 서비스 중단 방지)

> **⚠️ 현재 토큰 입력 방식은 임시 구현이다.**
> 현재는 오너가 Meta 개발자 콘솔에서 토큰을 수동 발급해 입력하는 방식이나,
> **상업화 전 Instagram OAuth로 전환 예정.**
> 전환 시 `POST /api/galleries/:id/instagram-token` 엔드포인트를 OAuth callback으로 교체하고,
> MyPage의 토큰 입력 모달을 OAuth redirect 버튼으로만 바꾸면 된다.
> 피드 조회, 토글, DB 저장 등 나머지 로직은 전부 재사용 가능하도록 설계되어 있다.

---

### Step 1: DB 스키마 수정

**파일:** `backend/prisma/schema.prisma`

`Gallery` 모델의 `instagramUrl` 주석 아래에 두 필드를 추가한다:

```prisma
instagramUrl         String?  // 인스타그램 주소 (@handle 또는 profile URL)
instagramAccessToken String?  // Instagram Graph API 액세스 토큰 (서버 전용, 프론트 미노출)
instagramFeedVisible Boolean  @default(false) // 갤러리 상세 페이지에 피드 공개 여부
```

마이그레이션 실행:
```bash
cd backend && npx prisma migrate dev --name add_instagram_fields
```

---

### Step 2: 백엔드 gallery.ts 수정

**파일:** `backend/src/routes/gallery.ts`

#### 2-1. 상단 헬퍼 함수 추가 (라우터 선언 직후)

```typescript
/**
 * 갤러리 응답에서 instagramAccessToken을 제거하고 instagramConnected(boolean)로 변환
 * 토큰은 서버 전용 필드 — 프론트엔드에 절대 노출하지 않음
 */
function maskInstagram(g: any) {
  const { instagramAccessToken, ...rest } = g;
  return { ...rest, instagramConnected: instagramAccessToken !== null && instagramAccessToken !== undefined };
}
```

#### 2-2. 갤러리 목록 조회 (GET /) 응답에 maskInstagram 적용

로그인 유저 분기와 비로그인 분기 모두에서 `maskInstagram()` 적용:
```typescript
// 로그인 유저
return res.json(galleries.map((g: any) => ({ ...maskInstagram(g), isFavorited: favSet.has(g.id) })));
// 비로그인
res.json(galleries.map((g: any) => ({ ...maskInstagram(g), isFavorited: false })));
```

#### 2-3. 갤러리 상세 조회 (GET /:id) 응답에 maskInstagram 적용

```typescript
res.json({ ...maskInstagram(gallery), isFavorited });
```

#### 2-4. 갤러리 등록 스키마에서 instagramUrl 제거

`galleryCreateSchema`에서 `instagramUrl: z.string().optional()` 라인을 삭제하고, 갤러리 create data에서도 `instagramUrl` 제거. 주석으로 "Instagram 연동 시 자동 설정됨" 명시.

#### 2-5. 새 엔드포인트 3개 추가 (기존 DELETE /:id 아래에 추가)

**① Instagram 토큰 저장 — POST /:id/instagram-token**
- 오너 전용 (authenticate)
- body: `{ accessToken: string }`
- Graph API로 토큰 유효성 검증: `https://graph.instagram.com/me?fields=id,username&access_token=${accessToken}`
- 유효하면 DB 저장: `{ instagramAccessToken: accessToken, instagramUrl: '@${igUser.username}' }`
- 응답: `{ instagramConnected: true, username: igUser.username }`
- 실패 시 400 에러

**② Instagram 프로필 링크 토글 — PATCH /:id/instagram-profile-visibility**
- 오너 전용 (authenticate)
- body: `{ visible: boolean }`
- visible=true: 저장된 토큰으로 username 재조회 → `instagramUrl = @username`
- visible=false: `instagramUrl = null`
- 토큰 없이 visible=true 요청 시 400 에러
- 응답: `{ instagramProfileVisible: boolean, instagramUrl: string | null }`

**③ Instagram 피드 조회 — GET /:id/instagram-feed**
- optionalAuth (비로그인도 접근 가능)
- DB에서 `instagramAccessToken`, `instagramFeedVisible` 조회
- `!instagramFeedVisible` 또는 `!instagramAccessToken` → 빈 배열 반환
- Graph API 호출: `https://graph.instagram.com/me/media?fields=id,media_type,media_url,thumbnail_url,permalink,timestamp&limit=9&access_token=${token}`
- 실패 시 (토큰 만료 등) 빈 배열 반환 (에러 전파 금지)
- 응답 필드: `{ id, mediaType, mediaUrl, thumbnailUrl, permalink, timestamp }`

**④ Instagram 피드 공개 토글 — PATCH /:id/instagram-visibility**
- 오너 전용 (authenticate)
- body: `{ visible: boolean }`
- 토큰 없이 visible=true 요청 시 400 에러
- DB: `instagramFeedVisible = visible`
- 응답: `{ instagramFeedVisible: boolean }`

---

### Step 3: 프론트엔드 타입 수정

**파일:** `frontend/src/types/index.ts`

`Gallery` 인터페이스에 두 필드 추가:
```typescript
/** 백엔드에서 instagramAccessToken 존재 여부를 boolean으로 변환한 값 */
instagramConnected?: boolean;
/** 갤러리 상세 페이지에 Instagram 피드 공개 여부 */
instagramFeedVisible?: boolean;
```

새 타입 추가:
```typescript
export interface InstagramPost {
  id: string;
  mediaType: 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM';
  mediaUrl: string;
  thumbnailUrl?: string;
  permalink: string;
  timestamp: string;
}
```

---

### Step 4: InstagramFeed 컴포넌트 생성

**파일 생성:** `frontend/src/components/gallery/InstagramFeed.tsx`

Props: `{ galleryId: number, instagramUrl?: string }`

- `useQuery(['instagram-feed', galleryId])` → `GET /api/galleries/:id/instagram-feed`
- `staleTime: 5 * 60 * 1000` (5분 캐시)
- 로딩: 9개 `aspect-square bg-gray-100 rounded-lg animate-pulse` 스켈레톤
- 게시물 없음: "게시물을 불러올 수 없습니다." 점선 테두리 박스
- 게시물 있음:
  - 헤더: instagramUrl → 프로필 URL 변환 후 "Instagram에서 전체 보기" 링크
  - `grid grid-cols-3 gap-1.5` 그리드
  - 각 셀: `<a href={permalink} target="_blank">` → `aspect-square` 정사각형 썸네일
  - VIDEO 타입: `thumbnailUrl || mediaUrl` 사용, 나머지: `mediaUrl`
  - hover: scale-105 + dim 오버레이 + ExternalLink 아이콘

---

### Step 5: InstagramPrivateMessage 컴포넌트 생성

**파일 생성:** `frontend/src/components/gallery/InstagramPrivateMessage.tsx`

Props: `{ isOwner: boolean }`

- Instagram 아이콘 + "Instagram 피드가 비공개 상태입니다." 텍스트
- `isOwner === true`일 때만 "마이페이지에서 설정하기" 버튼 → `navigate('/mypage')`
- 스타일: `border border-dashed border-gray-200 rounded-xl` 중앙 정렬

---

### Step 6: GalleryDetailPage.tsx 수정

**파일:** `frontend/src/pages/GalleryDetailPage.tsx`

#### 6-1. import 추가
```typescript
import InstagramFeed from '@/components/gallery/InstagramFeed';
import InstagramPrivateMessage from '@/components/gallery/InstagramPrivateMessage';
```
(`Instagram` 아이콘은 lucide-react에서 이미 import되어 있음)

#### 6-2. JSX 삽입 위치

`{/* === 상세 소개 섹션 === */}` 블록과 `{/* === 진행중인 공모 섹션 === */}` 블록 사이에 삽입:

```tsx
{/* === Instagram 피드 섹션 === */}
{gallery.instagramConnected && (
  <div>
    <h2 className="text-lg font-bold mb-3 flex items-center gap-2">
      <Instagram size={18} className="text-pink-500" />
      Instagram
    </h2>
    {gallery.instagramFeedVisible ? (
      <InstagramFeed galleryId={Number(id)} instagramUrl={gallery.instagramUrl} />
    ) : (
      <InstagramPrivateMessage isOwner={isOwner} />
    )}
  </div>
)}
```

---

### Step 7: MyPage.tsx 수정

**파일:** `frontend/src/pages/MyPage.tsx`

#### 7-1. lucide-react import에 `Instagram` 추가

#### 7-2. MyGalleriesSection 함수 내 수정

**form state에서 instagramUrl 제거:**
```typescript
const [form, setForm] = useState({
  name: '', address: '', phone: '', description: '',
  region: 'SEOUL', ownerName: '', mainImage: '', email: ''
  // instagramUrl 제거
});
```
폼 리셋 부분도 동일하게 instagramUrl 제거.

**Instagram 관련 state 추가:**
```typescript
const [instagramModalGalleryId, setInstagramModalGalleryId] = useState<number | null>(null);
const [tokenInput, setTokenInput] = useState('');
```

**mutation 3개 추가:**

```typescript
// 토큰 저장
const saveTokenMutation = useMutation({
  mutationFn: ({ galleryId, accessToken }) =>
    api.post(`/galleries/${galleryId}/instagram-token`, { accessToken }),
  onSuccess: (data, { galleryId }) => {
    queryClient.invalidateQueries({ queryKey: ['my-galleries'] });
    queryClient.invalidateQueries({ queryKey: ['instagram-feed', galleryId] });
    setInstagramModalGalleryId(null);
    setTokenInput('');
    toast.success(`Instagram 계정이 연동되었습니다.${data.data.username ? ` (@${data.data.username})` : ''}`);
  },
  onError: (err) => toast.error(err.response?.data?.error || 'Instagram 연동에 실패했습니다.'),
});

// 프로필 링크 토글 (instagramUrl 유무로 가시성 제어)
const toggleProfileVisibilityMutation = useMutation({
  mutationFn: ({ galleryId, visible }) =>
    api.patch(`/galleries/${galleryId}/instagram-profile-visibility`, { visible }),
  onSuccess: () => queryClient.invalidateQueries({ queryKey: ['my-galleries'] }),
  onError: () => toast.error('설정 변경에 실패했습니다.'),
});

// 피드 토글 (낙관적 업데이트)
const toggleVisibilityMutation = useMutation({
  mutationFn: ({ galleryId, visible }) =>
    api.patch(`/galleries/${galleryId}/instagram-visibility`, { visible }),
  onMutate: async ({ galleryId, visible }) => {
    await queryClient.cancelQueries({ queryKey: ['my-galleries'] });
    const prev = queryClient.getQueryData(['my-galleries']);
    if (prev) {
      queryClient.setQueryData(['my-galleries'],
        prev.map(g => g.id === galleryId ? { ...g, instagramFeedVisible: visible } : g)
      );
    }
    return { prev };
  },
  onError: (_err, _vars, context) => {
    if (context?.prev) queryClient.setQueryData(['my-galleries'], context.prev);
    toast.error('설정 변경에 실패했습니다.');
  },
  onSettled: () => queryClient.invalidateQueries({ queryKey: ['my-galleries'] }),
});
```

**등록 폼 UI에서 instagramUrl input 제거.**

**갤러리 카드 내 Instagram 설정 블록 추가** (`g.status === 'APPROVED'`일 때만):
```tsx
{g.status === 'APPROVED' && (
  <div className="mt-3 pt-3 border-t border-gray-100 space-y-2">
    {/* 연동 상태 + 버튼 */}
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-1.5">
        <Instagram size={14} className="text-pink-400" />
        <span className="text-sm font-medium text-gray-700">Instagram 연동</span>
      </div>
      <button
        onClick={() => { setInstagramModalGalleryId(g.id); setTokenInput(''); }}
        className={`text-xs px-2.5 py-1 rounded-lg font-medium ${
          g.instagramConnected
            ? 'text-green-700 bg-green-50 hover:bg-green-100'
            : 'text-gray-600 bg-gray-100 hover:bg-gray-200'
        }`}
      >
        {g.instagramConnected ? '연결됨 · 재연동' : '연동하기'}
      </button>
    </div>
    {/* 프로필 링크 공개 토글 */}
    <div className="flex items-center justify-between">
      <span className="text-xs text-gray-500">프로필 링크 표시</span>
      <button
        disabled={!g.instagramConnected || toggleProfileVisibilityMutation.isPending}
        onClick={() => toggleProfileVisibilityMutation.mutate({ galleryId: g.id, visible: !g.instagramUrl })}
        className={`relative w-10 h-5 rounded-full transition-colors duration-200 disabled:opacity-40 disabled:cursor-not-allowed ${
          g.instagramUrl ? 'bg-pink-500' : 'bg-gray-200'
        }`}
      >
        <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform duration-200 ${
          g.instagramUrl ? 'translate-x-5' : 'translate-x-0.5'
        }`} />
      </button>
    </div>
    {/* 피드 공개 토글 */}
    <div className="flex items-center justify-between">
      <span className="text-xs text-gray-500">갤러리 페이지에 피드 표시</span>
      <button
        disabled={!g.instagramConnected || toggleVisibilityMutation.isPending}
        onClick={() => toggleVisibilityMutation.mutate({ galleryId: g.id, visible: !g.instagramFeedVisible })}
        className={`relative w-10 h-5 rounded-full transition-colors duration-200 disabled:opacity-40 disabled:cursor-not-allowed ${
          g.instagramFeedVisible ? 'bg-pink-500' : 'bg-gray-200'
        }`}
      >
        <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform duration-200 ${
          g.instagramFeedVisible ? 'translate-x-5' : 'translate-x-0.5'
        }`} />
      </button>
    </div>
  </div>
)}
```

**토큰 입력 모달 추가** (컴포넌트 return 마지막에):
```tsx
{instagramModalGalleryId !== null && (
  <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
    <div className="bg-white rounded-2xl p-6 w-full max-w-sm space-y-4">
      <h3 className="font-semibold flex items-center gap-2">
        <Instagram size={18} className="text-pink-500" /> Instagram 연동
      </h3>
      <p className="text-xs text-gray-500 leading-relaxed">
        Meta 개발자 콘솔(developers.facebook.com)에서 Instagram Graph API 앱을 생성하고,
        Graph API Explorer에서 발급한 액세스 토큰을 입력하세요.
      </p>
      <input
        type="text"
        value={tokenInput}
        onChange={e => setTokenInput(e.target.value)}
        placeholder="액세스 토큰 붙여넣기"
        className="w-full p-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pink-400"
      />
      <div className="flex gap-2">
        <button
          onClick={() => saveTokenMutation.mutate({ galleryId: instagramModalGalleryId, accessToken: tokenInput })}
          disabled={!tokenInput.trim() || saveTokenMutation.isPending}
          className="flex-1 py-2 bg-pink-500 hover:bg-pink-600 text-white text-sm rounded-lg disabled:opacity-50"
        >
          {saveTokenMutation.isPending ? '검증 중...' : '저장'}
        </button>
        <button
          onClick={() => { setInstagramModalGalleryId(null); setTokenInput(''); }}
          className="px-4 py-2 text-sm text-gray-500"
        >
          취소
        </button>
      </div>
    </div>
  </div>
)}
```

---

### Step 8: 검증

TypeScript 타입 체크:
```bash
cd frontend && npx tsc --noEmit
cd ../backend && npx tsc --noEmit
```

동작 검증 시나리오:
1. Gallery 계정 로그인 → MyPage → 내 갤러리 탭 → 승인된 갤러리 카드에 Instagram 설정 블록 노출 확인
2. "연동하기" → 유효한 토큰 입력 → "연결됨" 상태 + 두 토글 활성화 확인
3. 잘못된 토큰 입력 → 에러 토스트 확인
4. 피드 토글 ON → 갤러리 상세 페이지에 3x3 썸네일 그리드 표시 확인
5. 피드 토글 OFF → "Instagram 피드가 비공개 상태입니다." 표시 확인
6. 프로필 링크 토글 ON → 갤러리 상세 기본 정보에 @handle 링크 표시 확인
7. 프로필 링크 토글 OFF → 링크 숨김 확인
8. 미연동 갤러리 상세 → Instagram 섹션 없음 확인
9. 갤러리 등록 폼 → instagramUrl 입력란 없음 확인
10. 기존 기능 (갤러리 목록 필터/정렬/찜, 상세 찜/리뷰, Admin 승인) 정상 작동 확인
