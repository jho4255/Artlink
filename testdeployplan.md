# ArtLink Render.com 무료 배포 계획

## Context
ArtLink를 Render.com에 무료 배포하여 소규모 테스트 용도로 사용.
원본 코드는 건드리지 않고 `deploy/render` 브랜치를 만들어 배포 전용 변경만 적용.

## 배포 구성
| 구성요소 | Render 서비스 타입 | 비고 |
|----------|-------------------|------|
| Frontend | Static Site | `frontend/dist/` 빌드 결과물 서빙 |
| Backend | Web Service (free) | Express, 15분 미사용시 sleep |
| PostgreSQL | Render PostgreSQL | 무료 1GB, 90일 제한 |
| 파일 저장 | Cloudinary (무료 25GB) | 업로드 코드 수정 필요 |

## 구현 단계

### 1. `deploy/render` 브랜치 생성
- `git checkout -b deploy/render` (main 기반)
- 이 브랜치에서만 배포 전용 변경 작업

### 2. Backend 변경 (deploy 브랜치에서만)

#### 2-1. Cloudinary 업로드로 전환
- `backend/package.json`에 `cloudinary` 패키지 추가
- `backend/src/routes/upload.ts` 수정:
  - Multer diskStorage → memoryStorage (파일을 메모리 버퍼로 받음)
  - Cloudinary SDK로 버퍼 업로드 → 반환된 URL 사용
  - 기존 `/uploads/filename` 대신 `https://res.cloudinary.com/...` URL 반환
- 환경변수: `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`

#### 2-2. Express 정적 파일 서빙 제거/조건부 처리
- `backend/src/index.ts`: `/uploads` 정적 서빙은 유지 (seed 데이터 등 fallback)
- Cloudinary URL은 절대경로라 별도 서빙 불필요

#### 2-3. Frontend 정적 파일 서빙 추가 (모놀리스 배포)
- `backend/src/index.ts`에 프론트엔드 `dist/` 서빙 추가:
  ```typescript
  // 프론트엔드 정적 파일 서빙 (배포용)
  app.use(express.static(path.join(__dirname, '../../frontend/dist')));
  // SPA fallback
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../../frontend/dist/index.html'));
  });
  ```
- 이렇게 하면 별도 Static Site 없이 하나의 Web Service로 프론트+백엔드 서빙 가능
- `/api/*` 라우트는 먼저 매칭, 나머지는 SPA로 fallback
- **장점**: CORS 설정 불필요, 프록시 불필요, 무료 서비스 1개만 사용

#### 2-4. Prisma migrate deploy 스크립트
- Render build command에서 `npx prisma migrate deploy` 실행 (dev 아닌 deploy)

### 3. Frontend 변경 (deploy 브랜치에서만)

#### 3-1. axios baseURL
- 현재 `/api` (상대경로) → 모놀리스 배포시 변경 불필요 ✅

#### 3-2. 이미지 URL 처리
- 현재 `<img src={gallery.mainImage}>` 등에서 `/uploads/...` 상대경로 사용
- Cloudinary URL은 `https://...` 절대경로로 반환되므로 `<img>`에서 자동 처리됨
- seed 데이터의 이미지 URL만 placeholder URL로 변경 필요

### 4. Render 배포 설정

#### 4-1. render.yaml (Blueprint)
```yaml
services:
  - type: web
    name: artlink
    runtime: node
    buildCommand: |
      cd backend && npm install && npx prisma generate && npm run build
      cd ../frontend && npm install && npm run build
    startCommand: cd backend && npx prisma migrate deploy && npm start
    envVars:
      - key: DATABASE_URL
        fromDatabase:
          name: artlink-db
          property: connectionString
      - key: JWT_SECRET
        generateValue: true
      - key: NODE_ENV
        value: production
      - key: CLOUDINARY_CLOUD_NAME
        sync: false
      - key: CLOUDINARY_API_KEY
        sync: false
      - key: CLOUDINARY_API_SECRET
        sync: false

databases:
  - name: artlink-db
    plan: free
    databaseName: artlink
```

#### 4-2. 루트 package.json 생성 (Render 빌드용)
- Render는 루트에서 빌드하므로 간단한 루트 package.json 필요

### 5. Seed 데이터 조정
- `backend/prisma/seed.ts`의 이미지 URL을 placeholder 서비스 URL로 변경
  (예: `https://placehold.co/400x300?text=Gallery`)
- 또는 seed 실행을 건너뛰고 빈 DB로 시작

### 6. 배포 순서 (사용자 수동 작업)
1. Render 계정 생성 (https://render.com)
2. Cloudinary 계정 생성 (https://cloudinary.com) → API 키 확보
3. GitHub에 `deploy/render` 브랜치 push
4. Render Dashboard에서 "New Blueprint" → repo 연결 → `deploy/render` 브랜치 선택
5. 환경변수에 Cloudinary 키 입력
6. 자동 빌드 & 배포
7. `https://artlink-xxxx.onrender.com` 에서 확인

## 수정 파일 목록 (deploy/render 브랜치에서만)
| 파일 | 변경 내용 |
|------|-----------|
| `render.yaml` (신규) | Render Blueprint 설정 |
| `package.json` (루트, 신규) | Render 빌드용 |
| `backend/package.json` | cloudinary 의존성 추가 |
| `backend/src/routes/upload.ts` | Multer disk→memory, Cloudinary 업로드 |
| `backend/src/index.ts` | 프론트엔드 static 서빙 + SPA fallback 추가 |
| `backend/prisma/seed.ts` | 이미지 URL placeholder로 변경 |

## 검증 방법
1. 로컬에서 `npm run build` (frontend + backend) 성공 확인
2. Render 배포 후 `/api/health` 엔드포인트 응답 확인
3. 브라우저에서 메인 페이지 로드 확인
4. 로그인 → 이미지 업로드 → Cloudinary URL 반환 확인
5. 갤러리/공모 등록 → 승인 → 목록 노출 전체 플로우 확인
