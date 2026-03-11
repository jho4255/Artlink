# feat: Instagram 피드 앱 이탈 방지 — 앱 내 라이트박스 확대

---

## 배경 및 문제 의식

기존 `InstagramFeed` 컴포넌트는 썸네일 클릭 시 Instagram 원본 게시물로 새 탭을 열어 이동시켰다.

앱이 정식 출시될 경우 사용자 흐름:
```
ArtLink 갤러리 상세 탐색 → Instagram 피드 썸네일 클릭 → Instagram 앱/웹으로 이탈
```

이 흐름에서 발생하는 문제:
- 사용자가 ArtLink를 떠나 Instagram으로 이동하면 **재진입 가능성이 낮아짐**
- 갤러리 탐색, 공모 지원, 찜하기 등 핵심 전환 행동이 중단됨
- PWA 환경에서는 외부 앱 이동이 더욱 이탈감을 높임

---

## 적용된 대안

| 항목 | 변경 전 | 변경 후 |
|---|---|---|
| 썸네일 클릭 | Instagram 새 탭 이동 | 앱 내 ImageLightbox 확대 |
| "Instagram에서 전체 보기" 헤더 링크 | 유지 | **그대로 유지** |
| hover 아이콘 | ExternalLink 아이콘 | 제거 (dim 효과만 유지) |

피드 데이터 조회, 썸네일 그리드 렌더링, 5분 캐시, 스켈레톤 로딩, 비공개 처리 등
나머지 기능은 전부 그대로 유지된다.

---

## 구현 내용

### 변경 파일

**`frontend/src/components/gallery/InstagramFeed.tsx`** 1개만 수정.
백엔드, DB, 타입, GalleryDetailPage, 기타 컴포넌트 변경 없음.

---

### 핵심 변경 요약

#### 1. 라이트박스 상태 추가 (`InstagramFeed.tsx:30`)

```typescript
const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
```
`null`이면 닫힘, 숫자면 해당 인덱스 이미지를 라이트박스로 표시.

#### 2. 이미지 URL 배열 생성 (`InstagramFeed.tsx:75`)

```typescript
const imageUrls = posts.map(post =>
  post.mediaType === 'VIDEO' ? (post.thumbnailUrl || post.mediaUrl) : post.mediaUrl
);
```
`ImageLightbox`의 `images` prop에 전달하기 위해 미리 추출.

#### 3. 썸네일 `<a>` → `<button>` 교체 (`InstagramFeed.tsx:83`)

```diff
- <a href={post.permalink} target="_blank" rel="noopener noreferrer" ...>
+ <button onClick={() => setLightboxIndex(i)} ...>
```
외부 이동 제거, 클릭 시 라이트박스 오픈으로 교체.
hover dim 효과는 유지, ExternalLink 아이콘만 제거.

#### 4. ImageLightbox 마운트 (`InstagramFeed.tsx:103`)

```tsx
<AnimatePresence>
  {lightboxIndex !== null && (
    <ImageLightbox
      images={imageUrls}
      initialIndex={lightboxIndex}
      onClose={() => setLightboxIndex(null)}
    />
  )}
</AnimatePresence>
```

기존 `ImageLightbox` (`frontend/src/components/shared/ImageLightbox.tsx`) 를 그대로 재사용.
Portal 렌더링, 좌우 화살표 탐색, 터치 스와이프, Escape 키, 배경 클릭 닫기가
모두 자동으로 지원된다.

---

## 검증 시나리오

- [] 갤러리 상세 페이지 Instagram 섹션에 3x3 그리드 정상 표시
- [] 썸네일 클릭 시 앱 내 라이트박스로 이미지 확대 (새 탭 이동 없음)
- [] 라이트박스 좌우 화살표로 게시물 간 이동
- [] 배경 클릭 또는 X 버튼으로 라이트박스 닫기
- [] Escape 키로 라이트박스 닫기
- [] "Instagram에서 전체 보기" 헤더 링크 클릭 시 Instagram 프로필 새 탭 이동 (유지)
- [] 피드 OFF 상태에서 비공개 메시지 정상 표시
- [] 미연동 갤러리에서 Instagram 섹션 숨김 유지
- [] TypeScript 에러 없음: `cd frontend && npx tsc --noEmit`
