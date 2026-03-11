# 전체 수정사항 프롬프트

이 문서는 현재 세션에서 구현한 모든 기능과 버그 수정을 요약합니다.

---

## 기능 1: 공모 등록 시 추가 정보 요청 (Custom Fields)

Gallery 유저가 공모 등록 시 지원자에게 추가로 요청할 정보 항목을 설정하고, Artist가 지원할 때 해당 항목을 입력하는 기능.

### DB 스키마 변경 (`backend/prisma/schema.prisma`)
```prisma
model Exhibition {
  customFields  String?  // JSON: [{id, label, type, required, options?}]
}
model Application {
  customAnswers  String?  // JSON: [{fieldId, value}]
}
```
- 마이그레이션: `backend/prisma/migrations/20260310134600_add_custom_fields/`

### 백엔드 (`backend/src/routes/exhibition.ts`)
- `customFieldSchema` Zod 검증 스키마 추가 (type: text | textarea | select | file)
- `POST /exhibitions` — customFields를 JSON.stringify로 저장
- `GET /exhibitions` (목록) — customFields JSON 파싱 후 반환
- `GET /exhibitions/:id` (상세) — customFields JSON 파싱 + gallery.ownerId 포함
- `GET /exhibitions/my-exhibitions` — customFields JSON 파싱 (string 그대로 반환하면 프론트 .map() 크래시)
- `POST /exhibitions/:id/apply` — required 항목 검증 + customAnswers JSON 저장
- **신규** `PATCH /exhibitions/:id/custom-fields` — Gallery 오너가 요청 정보 수정

### 백엔드 파일 업로드 (`backend/src/routes/upload.ts`)
- `fileUpload` multer 설정 추가 (PDF, DOC, HWP, ZIP 등 20MB 제한)
- **신규** `POST /upload/file` — 단일 파일 업로드, `{url, originalName}` 반환

### 백엔드 시드 (`backend/prisma/seed.ts`)
- Exhibition id=1에 샘플 customFields 추가 (textarea, select, file 타입)
- update 블록에 `customFields: null` 추가 (배포 규칙 준수)

### 백엔드 패키지 (`backend/package.json`)
- `prisma.seed` 설정 추가: `"seed": "tsx prisma/seed.ts"`

### 프론트엔드 타입 (`frontend/src/types/index.ts`)
```typescript
export interface CustomField {
  id: string;
  label: string;
  type: 'text' | 'textarea' | 'select' | 'file';
  required: boolean;
  options?: string[];
}
export interface CustomAnswer {
  fieldId: string;
  value: string;
}
// Exhibition에 customFields?: CustomField[] | null 추가
```

### 프론트엔드 — 공모 등록 폼 (`frontend/src/pages/MyPage.tsx` MyExhibitionsSection)
- "지원자에게 추가 정보를 요청합니다" 체크박스 + 동적 항목 빌더
- 항목별: label, type(텍스트/장문/선택형/파일첨부), required, options(선택형)
- 내 공모 목록에서 요청 정보 인라인 수정 기능

### 프론트엔드 — 공모 상세 (`frontend/src/pages/ExhibitionDetailPage.tsx`)
- "요청 정보" 섹션 표시 (customFields가 있을 때)
- Gallery 오너: 수정 버튼 → 인라인 편집 UI
- Artist 지원하기: customFields 있으면 모달 열림 → 항목별 입력 폼
  - text → input, textarea → textarea, select → select, file → 파일 업로드 UI
  - 파일 업로드: 드래그 영역 + 스피너 + 업로드 완료 표시 + 삭제
- customFields 없으면 기존처럼 즉시 지원

### 프론트엔드 — 공모 목록 (`frontend/src/pages/ExhibitionsPage.tsx`)
- 빠른 지원 버튼: customFields 있으면 상세 페이지로 이동 + toast

---

## 기능 2: 폼 UX 개선 (날짜검증 / 임시저장 / 저장확인 / 이탈경고)

### 날짜 유효성 검증 (`frontend/src/lib/utils.ts`)
```typescript
export function validateExhibitionDates(dates): string | null
```
- 공모 시작일 ≤ 마감일
- 전시 시작일 ≤ 전시 종료일
- 공모 마감일 ≤ 전시 시작일/종료일
- 날짜 input에 min/max 속성 상호 연동
- 에러 시 실시간 메시지 표시 + 등록 버튼 비활성화

### 임시저장 훅 (`frontend/src/hooks/useFormDraft.ts`) — 신규
- localStorage 기반 자동 저장 (3초 디바운스)
- 폼 재진입 시 "임시저장된 작업이 있습니다. 불러오시겠습니까?" confirm
- 24시간 만료, 빈 폼 무시
- 수동 "임시저장" 버튼
- 등록 성공 시 clearDraft()
- 추가 데이터 지원 (customFields 등)

### 미저장 이탈 경고 훅 (`frontend/src/hooks/useUnsavedChanges.ts`) — 신규
- beforeunload 이벤트 (브라우저 닫기/새로고침)
- popstate 이벤트 (뒤로가기)
- 참고: BrowserRouter 환경이므로 useBlocker 사용 불가

### 확인 모달 (`frontend/src/components/shared/ConfirmDialog.tsx`) — 신규
- Framer Motion 애니메이션 (scale + fade)
- title, message, confirmText, cancelText, variant(default/danger)

### 적용 위치

**MyGalleriesSection (갤러리 등록)**:
- useFormDraft (key: draft_gallery_form)
- useUnsavedChanges
- 임시저장 버튼
- 등록 요청 → ConfirmDialog
- 취소 → 변경사항 confirm

**MyExhibitionsSection (공모 등록)**:
- useFormDraft (key: draft_exhibition_form, extraData: customFields)
- useUnsavedChanges
- validateExhibitionDates 실시간 검증
- 날짜 input min/max 연동
- 임시저장 버튼
- 등록 요청 → ConfirmDialog
- 취소 → 변경사항 confirm

**ExhibitionDetailPage (공모 수정)**:
- useUnsavedChanges (소개 수정 또는 요청 정보 수정 중)
- 소개 저장 → ConfirmDialog
- 요청 정보 저장 → ConfirmDialog
- 취소 → 변경사항 confirm

---

## 버그 수정

### axios FormData 전송 (`frontend/src/lib/axios.ts`)
- **문제**: 기본 헤더 `Content-Type: application/json`이 FormData 요청에도 적용 → multer가 파일 인식 불가 (400 에러)
- **수정**: 인터셉터에서 `config.data instanceof FormData`이면 Content-Type 삭제 → 브라우저가 `multipart/form-data; boundary=...` 자동 설정

### 파일 업로드 라우트 경로 (`frontend/src/pages/ExhibitionDetailPage.tsx`)
- **문제**: `/uploads/file`로 요청 → 백엔드는 `/api/upload/file`로 마운트 (404)
- **수정**: `/upload/file`로 변경

### my-exhibitions JSON 파싱 (`backend/src/routes/exhibition.ts`)
- **문제**: customFields를 JSON string 그대로 반환 → 프론트에서 `.map()` 호출 시 크래시
- **수정**: JSON.parse 후 반환

### Docker Vite HMR (`frontend/vite.config.ts`)
- **문제**: Windows Docker 볼륨 마운트에서 파일 변경 감지 안 됨
- **수정**: `watch: { usePolling: true, interval: 1000 }`, `host: '0.0.0.0'` 추가

---

## 전체 파일 변경 목록

| 파일 | 상태 | 내용 |
|------|------|------|
| `backend/prisma/schema.prisma` | 수정 | customFields, customAnswers 필드 추가 |
| `backend/prisma/seed.ts` | 수정 | 샘플 customFields, update 블록 반영 |
| `backend/prisma/migrations/20260310134600_add_custom_fields/` | 신규 | 마이그레이션 |
| `backend/package.json` | 수정 | prisma.seed 설정 |
| `backend/src/routes/exhibition.ts` | 수정 | customFields CRUD, apply 검증, my-exhibitions JSON 파싱 |
| `backend/src/routes/upload.ts` | 수정 | fileUpload multer + POST /file 엔드포인트 |
| `frontend/src/types/index.ts` | 수정 | CustomField, CustomAnswer 인터페이스 |
| `frontend/src/lib/axios.ts` | 수정 | FormData Content-Type 자동 설정 |
| `frontend/src/lib/utils.ts` | 수정 | validateExhibitionDates 유틸리티 |
| `frontend/src/hooks/useFormDraft.ts` | 신규 | 임시저장 훅 |
| `frontend/src/hooks/useUnsavedChanges.ts` | 신규 | 미저장 이탈 경고 훅 |
| `frontend/src/components/shared/ConfirmDialog.tsx` | 신규 | 확인 모달 컴포넌트 |
| `frontend/src/pages/MyPage.tsx` | 수정 | 추가 정보 빌더, 인라인 수정, 임시저장, 날짜검증, 저장확인, 이탈경고 |
| `frontend/src/pages/ExhibitionDetailPage.tsx` | 수정 | 요청 정보 표시/수정, 지원 모달(파일업로드), 저장확인, 이탈경고 |
| `frontend/src/pages/ExhibitionsPage.tsx` | 수정 | 빠른 지원 시 customFields 분기 |
| `frontend/vite.config.ts` | 수정 | Docker polling, host, API_TARGET |
