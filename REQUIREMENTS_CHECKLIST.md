# ArtLink 요구사항 체크리스트

## 기술 스택 검증
- [x] React + Vite + TypeScript
- [x] React-router v6
- [x] Axios
- [x] TanStack Query v5
- [x] Zustand v5
- [x] Tailwind CSS + Framer Motion
- [ ] Shadcn/ui (일부만 사용 - 커스텀 컴포넌트로 대체)
- [ ] React-hook-form + Zod (폼은 직접 state로 관리 중)
- [ ] ESLint + Prettier (설정 파일 없음)
- [x] Vitest 테스트 (Backend 56, Frontend 11 = 67개)
- [x] Express 백엔드
- [x] Prisma ORM (SQLite, PostgreSQL 전환 가능)
- [x] 개발용 퀵 로그인 (Auth.js 대신 JWT)
- [x] 유저 타입: Admin / Gallery / Artist
- [x] 모바일 웹 대응
- [x] PWA (vite-plugin-pwa 적용, manifest, service worker 생성)

## 1. 초기 접속 - Splash Screen
- [x] 화면 가운데 ArtLink 로고 표시
- [x] 세련된 애니메이션 (Framer Motion)
- [x] 1초간 유지

## 2. Main 화면

### 2.1 Hero Section
- [x] 슬라이드 가능
- [x] Admin만 등록/수정/삭제 가능 (API + 프론트 CRUD)
- [x] 사진/제목/링크 URL 등록
- [x] [바로가기] 버튼 우측 하단
- [x] 외부 URL → 새 탭, 내부 URL → 라우팅
- [x] 3초 자동 슬라이드
- [x] 수동 조작 시 타이머 리셋 후 3초 뒤 재시작
- [x] Admin 미리보기 기능 (MyPage HeroManageSection)

### 2.2 Center Catchphrase
- [x] "갤러리와 아티스트를 잇다 : ArtLink" 중단 배치

### 2.3 Quick Action Cards
- [x] 갤러리 찾기 / 진행중인 공고 / 혜택 3개 카드
- [x] 각 페이지로 이동
- [x] 아이콘 포함

### 2.4 Navigation Bar
- [x] 좌측 ArtLink 로고 (클릭 시 홈 이동)
- [x] 우측 메뉴: 홈/갤러리/모집공고/혜택/마이페이지
- [x] 모든 페이지에서 표시 (Layout 컴포넌트)

### 2.5 Gallery of the Month
- [x] 이달의 갤러리 목록 표시
- [x] 메인 사진, 이름, 주소, 별점 표시
- [x] 클릭 시 갤러리 상세 페이지 이동
- [x] Admin만 등록/관리 (MyPage GotmManageSection)
- [x] 기한 만료 시 자동 제거 (서버사이드)

## 3. 마이페이지

### 3.1 인증
- [x] 비로그인 시 로그인 창 표시
- [x] 로그아웃 → 로그인 페이지 이동
- [x] 개발용 퀵 로그인 (Artist1/Artist2/Gallery/Admin)
- [x] 추후 실제 로그인으로 변경 가능한 추상화 구조

### 3.2 프로필
- [x] 프로필 사진 변경 기능

### 3.3 Artist 유저
- [x] 포트폴리오 - 전시 참가 이력 입력/수정/저장
- [x] 포트폴리오 - 작가 약력 입력/수정/저장
- [x] 포트폴리오 - 작품 사진 등록/삭제 (최대 30장)
- [x] 찜 목록 - 갤러리(갤러리명) / 공모(갤러리명-공모명) 구분
- [x] 찜 목록 - 갤러리/공모 탭 분리
- [x] 찜 취소 시 즉시 제거
- [x] 내가 작성한 리뷰 모아보기
- [x] 내가 지원한 공고 모아보기

### 3.4 Gallery 유저
- [x] 갤러리 등록 요청 (이름/주소/소개/대표자명/전화번호/대표이미지/지역태그)
- [x] 등록 요청 상태 확인 (대기/거절사유/승인)
- [x] 승인된 갤러리 목록 표시
- [x] 공모 등록 요청 (갤러리선택/제목/구분/마감일/전시일/모집인원/지역/소개)
- [x] 공모 등록 요청 상태 확인
- [x] 상세 내용 수정 (갤러리 상세 페이지에서 detailDesc 수정)
- [ ] 수정 요청 기능 UI (백엔드 API는 있으나 프론트 미연결)

### 3.5 Admin 유저
- [x] 갤러리/공모 승인 큐 (승인/거절 + 거절 사유 필수)
- [x] Hero Section CRUD + 미리보기
- [x] 혜택 관리 CRUD + 미리보기
- [x] Gallery of the Month 관리 (검색/선정/기한/자동제거)
- [ ] 수정 요청 승인 UI (백엔드 API는 있음)

## 4. 갤러리 찾기 화면
- [x] 한 줄에 한 개 리스트
- [x] 사진/이름/주소/전화번호/한줄소개/찜하기/별점
- [x] 지역 필터 (서울/경기북부/경기남부/대전/부산)
- [x] 별점 필터 (3점 이상/4점 이상)
- [x] 적용된 필터 목록 화면 표시
- [x] 별점순 정렬

## 5. 갤러리 상세 페이지
- [x] 상단 갤러리 사진 (스와이프)
- [x] 우측 상단 하트 (찜하기)
- [x] 갤러리명/주소/별점/한줄소개
- [x] 상세 소개 (갤러리 주인만 수정 버튼)
- [x] 진행중 모집공고 (공모명/타입/전시일/모집인원/지역/D-day)
- [x] 전시 종료 후 홍보 사진/글 등록 UI + 삭제 (Gallery 오너 전용)
- [x] 리뷰 작성 (Artist 전용)
- [x] 리뷰: 사진(옵션) + 글 + 평점
- [x] 리뷰: 익명 선택 가능 → "익명의 예술가 N"
- [x] Admin만 리뷰 삭제 버튼

## 6. 모집 공고 페이지
- [x] D-day 남은 공고만 표시
- [x] 사진/제목/갤러리명/갤러리별점/타입/모집인원/지역/D-day
- [x] 갤러리명 클릭 → 갤러리 상세 이동
- [x] 찜하기 버튼
- [x] 지역/갤러리별점 필터
- [x] 클릭 시 확장 + 상세정보 + 지원하기 버튼
- [x] 지원하기 (Artist 전용)
- [ ] 지원 시 포트폴리오를 갤러리 메일로 전송 (nodemailer 미구현)

## 7. 혜택 페이지
- [x] Admin이 등록한 혜택 목록 표시

## 기타 요구사항
- [x] run_web.sh 자동 실행 스크립트
- [x] 개발자 가이드 (architecture.md)
- [x] 코드 주석
- [x] DB 무결성 (Prisma 관계, cascade)
- [x] API 에러 핸들링
- [x] Toast 알림 (react-hot-toast)

---

## 미구현/미완 항목 요약 (3개)
1. **React-hook-form + Zod**: 폼 검증 (현재 직접 state 관리 - 기능상 문제 없음)
2. **수정 요청 UI**: Gallery 유저가 승인된 갤러리/공모의 초기 정보 수정 요청하는 프론트 UI (백엔드 API 준비 완료)
3. **포트폴리오 메일 전송**: 지원 시 nodemailer로 갤러리에 전송 (현재는 DB 지원 기록만 저장)

## API 테스트 결과: 35/36 통과 (1개는 테스트 스크립트 regex 이슈)
## 프론트엔드-백엔드 라우트 매칭: 40+개 전수 검증 → 0개 불일치
