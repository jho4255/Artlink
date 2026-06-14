#!/bin/bash
# ============================================================
# ArtLink 로컬 개발 서버 실행 스크립트
# 사용법: bash run_web.sh
# ============================================================

set -e

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$PROJECT_ROOT/backend"
FRONTEND_DIR="$PROJECT_ROOT/frontend"

echo "🎨 ArtLink 개발 서버를 시작합니다..."
echo "============================================"

# 0. PostgreSQL 서비스 시작
echo "🐘 PostgreSQL 서비스 확인 중..."
if command -v pg_isready &> /dev/null; then
  if ! pg_isready -q 2>/dev/null; then
    echo "   PostgreSQL 시작 중..."
    sudo service postgresql start
  else
    echo "   PostgreSQL 이미 실행 중"
  fi
else
  echo "⚠️  PostgreSQL이 설치되지 않았습니다. 먼저 설치하세요:"
  echo "   sudo apt install -y postgresql postgresql-client"
  exit 1
fi

# 1. 의존성 설치 확인
if [ ! -d "$BACKEND_DIR/node_modules" ]; then
  echo "📦 백엔드 의존성 설치 중..."
  cd "$BACKEND_DIR" && npm install
fi

if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
  echo "📦 프론트엔드 의존성 설치 중..."
  cd "$FRONTEND_DIR" && npm install
fi

# 2. 업로드 디렉토리 생성
mkdir -p "$BACKEND_DIR/uploads"

# 3. 이전 실행에서 남은 node 프로세스 정리 (DLL 잠금 방지)
taskkill.exe /F /IM node.exe 2>/dev/null || true

# 4. DB 마이그레이션 & 시드
echo "🗄️  데이터베이스 설정 중..."
cd "$BACKEND_DIR"
npx prisma generate
npx prisma migrate dev --name init 2>/dev/null || npx prisma db push
npx tsx prisma/seed.ts 2>/dev/null || echo "시드 데이터가 이미 존재합니다."

# 5. 백엔드 서버 시작 (백그라운드)
echo "🚀 백엔드 서버 시작 (포트 4000)..."
cd "$BACKEND_DIR"
npx tsx src/index.ts &
BACKEND_PID=$!

# 6. 프론트엔드 개발 서버 시작
echo "🖥️  프론트엔드 서버 시작 (포트 5173)..."
cd "$FRONTEND_DIR"
npx vite --host &
FRONTEND_PID=$!

echo ""
echo "============================================"
echo "✅ ArtLink 실행 완료!"
echo "   프론트엔드: http://localhost:5173"
echo "   백엔드 API: http://localhost:4000"
echo "   DB Studio:  npx prisma studio (backend/ 에서 실행)"
echo "============================================"
echo "종료하려면 Ctrl+C를 누르세요."

# 종료 시 프로세스 정리
trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; echo '서버가 종료되었습니다.'" EXIT

# 포그라운드 대기
wait
