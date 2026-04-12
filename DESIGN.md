# ArtLink Design System

SPACE 건축 매거진(spacem.org) 레퍼런스 기반. UI는 흑백, 콘텐츠 이미지가 주인공.
타겟: 20-40대 아티스트/갤러리 운영자. 깔끔하고 고급스럽되 장식 없는 톤.

---

## 1. 폰트

- **Pretendard Variable** 단일 사용 (sans/serif 구분 없음)
- CDN: `cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css`
- `--font-sans`와 `--font-serif` 모두 Pretendard로 설정
- weight로 위계 구분:
  - `font-normal` (400): 본문, 캡션
  - `font-medium` (500): 카드 제목, 네비게이션
  - `font-semibold` (600): 강조
  - `font-bold` (700): 로고만

## 2. 컬러

| 용도 | Tailwind 클래스 | HEX | 비고 |
|------|----------------|-----|------|
| 텍스트 기본 | `text-gray-900` | #111827 | 제목, 카드명 |
| 텍스트 중간 | `text-gray-600` | #4b5563 | 부제, 선정 코멘트 |
| 텍스트 보조 | `text-gray-400` | #9ca3af | 설명, 날짜, 주소 |
| 필터 카테고리 | `text-gray-700 font-medium` | #374151 | "지역", "별점" 라벨 |
| 배경 | `bg-white` | #ffffff | 전체 기본 |
| 구분선 | `border-gray-200` | #e5e7eb | 섹션 간 1px 선 |
| 포인트 빨강 | `text-[#c4302b]` | #c4302b | 별점, D-day(≤7), 진행중 상태 |
| 로고 Link | `text-[#dc3545]` | #dc3545 | Art(검정) + Link(빨강) |
| 찜 하트 (활성) | `text-[#c4302b] fill-[#c4302b]` | | 포인트 빨강과 통일 |
| 히어로 배경 | 동적 | | 이미지 dominant color 추출 (×0.6 보정) |

### 컬러 원칙
- UI 요소에 색을 쓰지 않는다. **흑백 + 포인트 빨강 1개.**
- `bg-blue-50`, `bg-orange-50`, `bg-green-100`, `bg-yellow-500` 등 컬러 배경 **절대 사용 금지**
- 상태 뱃지도 컬러 배경 대신 텍스트 색상으로만 구분
- 콘텐츠 이미지는 풀컬러 그대로

## 3. 레이아웃

### 컨테이너
```
max-w-7xl mx-auto px-6 md:px-12
```

### 섹션 구분
- 배경색 교대 **하지 않음**
- `border-t border-gray-200` 얇은 선 1px으로 구분
- 섹션 간 여백: `py-10 md:py-16` ~ `py-16 md:py-24`

### 반응형 (모바일 퍼스트)
- 그리드: `grid-cols-1` → `md:grid-cols-2` → `lg:grid-cols-3`
- 텍스트: 모바일 크기 기본 → `md:`로 키움
- 터치 타겟: 최소 44px

## 4. 페이지 헤더

모든 목록 페이지에 동일 패턴:
```jsx
<h1 className="text-4xl md:text-5xl font-serif text-gray-900">영문 타이틀</h1>
<p className="text-base text-gray-400 mt-2 mb-10">한글 부제</p>
```

### 적용된 타이틀
| 페이지 | 타이틀 | 부제 |
|--------|--------|------|
| 갤러리 | Galleries | Find your next partner |
| 전시 | Exhibitions | 지금 만날 수 있는 전시 |
| 모집공고 | Open Call | 진행 중인 공모를 확인하세요 |
| 홈 GotM | Gallery of the Month | ArtLink 선정 이달의 갤러리 |

## 5. 필터

### 스타일
- 컬러 칩/pill 버튼 **사용 금지** (`rounded-full bg-gray-100` 등)
- 텍스트 버튼으로:
  - 비활성: `text-gray-400 hover:text-gray-900`
  - 활성: `text-gray-900 underline underline-offset-4 decoration-1`
- 카테고리 라벨: `text-gray-700 text-sm font-medium w-10`

### 레이아웃
- 필터 항목별 행 구분 (`space-y-3`)
- 정렬 옵션은 그리드 바로 위 **우측 정렬** (`flex justify-end`)
- 적용된 필터: `text-sm text-gray-600` + X 닫기 버튼
- 필터 아래 `border-t border-gray-200` 구분선

## 6. 카드/컴포넌트

### 금지 항목 (AI 바이브코딩 패턴)
| 금지 | 대체 |
|------|------|
| `rounded-2xl` | 직각 또는 `rounded-lg` 최소 |
| `shadow-sm`, `shadow-md` | 그림자 없음 |
| `hover:shadow-md` | 이미지: `group-hover:opacity-80` |
| `hover:-translate-y-1` | 사용 안 함 |
| `whileHover={{ scale: 1.03 }}` | 사용 안 함 |
| Lucide 아이콘 + 컬러 원형 배경 | 아이콘 최소, 텍스트로 해결 |
| `motion.div` 카드 래핑 | 일반 `article` 태그 |
| `bg-blue-50 text-blue-600` 상태 뱃지 | 텍스트 색상만 (`text-[#c4302b]`, `text-gray-900`, `text-gray-400`) |

### 이미지
- 비율: `aspect-[4/3]` (갤러리, 공모) 또는 `aspect-[3/4]` (전시 포스터)
- `object-cover`, 직각
- 호버: `group-hover:opacity-80 transition-opacity duration-300`

### 제목 호버
- `hover:underline underline-offset-2 decoration-1` (제목 요소에 직접)
- **`group-hover:underline` 사용 금지** — 이미지 위 커서에서도 밑줄 보이는 UX 문제

### 텍스트 링크
- 버튼 대신 텍스트 링크 선호: `"자세히 보기 →"`, `"지원하기 →"`
- 스타일: `underline underline-offset-4 decoration-1 hover:text-[#c4302b]`

### 별점
- `<Star size={15} className="text-[#c4302b] fill-[#c4302b]" />`
- 숫자: `text-base font-medium text-[#c4302b]`
- 리뷰 수: `text-sm text-gray-400` 괄호 안

### 찜 하트
- 활성: `text-[#c4302b] fill-[#c4302b]`
- 비활성: `text-gray-300 hover:text-gray-500`
- Admin은 찜 버튼 미표시

## 7. 타이포그래피 스케일

| 용도 | 모바일 | 데스크톱 | weight |
|------|--------|----------|--------|
| 페이지 대제목 | `text-4xl` | `text-5xl` | `font-serif` (= Pretendard) |
| 카드 제목 | `text-xl` | `text-xl` | `font-medium` |
| 네비게이션 | `text-base` | `text-base` | `font-medium` |
| 퀵액션 타이틀 | `text-xl` | `text-2xl` | `font-medium` |
| 부제/설명 | `text-base` | `text-base` | `font-normal` |
| 메타 (날짜, 주소) | `text-sm` | `text-sm` | `font-normal` |
| 선정 코멘트 | `text-[13px]` | `text-[13px]` | `font-normal`, `text-gray-600` |
| 로고 | `text-2xl` | `text-2xl` | `font-bold` |

## 8. Navbar

```
sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-gray-100
높이: h-16 md:h-20
```
- 로고: `Art` (`text-gray-900`) + `Link` (`text-[#dc3545]`)
- 메뉴: `text-base font-medium`
- 활성 탭: `text-gray-900 border-b-2 border-gray-900`
- 비활성: `text-gray-500 hover:text-gray-900`
- 알림 벨: 우측, 뱃지 `bg-red-500`

## 9. 히어로 슬라이더 (홈)

- 이미지 dominant color 추출 (canvas 10×10 샘플 → 평균 → ×0.6 보정)
- 배경색 `transition-colors duration-700`으로 슬라이드 전환 시 부드러운 변화
- 배경 위에 `bg-gradient-to-b from-transparent to-white` 오버레이
- 이미지 카드: `max-w-7xl`, `rounded-lg shadow-2xl`
- 텍스트: 하단 좌측, description은 `uppercase tracking-[0.15em] text-white/60`, title은 `text-xl md:text-3xl font-semibold text-white`
- CTA: `"자세히 보기 →"` 밑줄 텍스트 링크
- 인디케이터: `h-[2px]` 바, 활성 `w-6 bg-white`, 비활성 `w-3 bg-white/40`

## 10. 미완료 페이지

아래 페이지는 아직 DESIGN.md 적용 안 됨:
- GalleryDetailPage (갤러리 상세)
- ExhibitionDetailPage (공모 상세)
- ShowDetailPage (전시 상세)
- BenefitsPage (혜택)
- MyPage (마이페이지)
- SupportPage (고객센터)
- LoginPage (로그인)
- PortfolioPage (포트폴리오)
