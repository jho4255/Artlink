#!/usr/bin/env bash
# 배포 전 안전 점검 — DB 데이터·접속정보가 커밋/푸시에 섞이지 않았는지 확인한다.
#
# 왜 필요한가:
#   실서버 DB를 로컬로 복제해 확인하는 일이 잦다(2026-08-11에도 했다). 그때 만들어지는
#   덤프 파일·`.env` 백업·복사한 접속정보가 실수로 커밋되면 **실제 가입자 개인정보가 GitHub에 공개**된다.
#   한번 올라가면 커밋을 지워도 이미 퍼진 것으로 봐야 하므로, 올라가기 전에 막는 게 유일한 방어다.
#
# 사용법:
#   bash scripts/predeploy-check.sh            # 커밋 예정(스테이징) + 아직 안 올린 커밋 검사
#   bash scripts/predeploy-check.sh --all      # 추적 중인 파일 전체 검사 (느림, 가끔)
#
# 자동 실행: .githooks/pre-push 가 매 push 때 호출한다.
#   최초 1회만: git config core.hooksPath .githooks
set -uo pipefail
cd "$(dirname "$0")/.."

RED=$'\033[31m'; GRN=$'\033[32m'; YEL=$'\033[33m'; OFF=$'\033[0m'
fail=0
note() { printf '  %s\n' "$1"; }
bad()  { fail=1; printf '%s✗ %s%s\n' "$RED" "$1" "$OFF"; }
ok()   { printf '%s✓ %s%s\n' "$GRN" "$1" "$OFF"; }

# 검사 대상 파일 목록
if [ "${1:-}" = "--all" ]; then
  MODE="추적 중인 파일 전체"
  files=$(git ls-files)
else
  MODE="커밋 예정 + 아직 push 하지 않은 커밋"
  upstream=$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || echo '')
  base=""
  [ -n "$upstream" ] && base=$(git merge-base HEAD "$upstream" 2>/dev/null || echo '')
  files=$( { git diff --cached --name-only; git diff --name-only;
             [ -n "$base" ] && git diff --name-only "$base"..HEAD; } | sort -u )
fi
echo "배포 전 점검 — 대상: $MODE"
[ -z "$files" ] && { ok "검사할 변경 없음"; exit 0; }

# ── 1) DB 덤프·데이터 파일 ──
hits=$(printf '%s\n' "$files" | grep -EI '\.(sql|dump|csv|sqlite3?|db|bak|tar|tgz|gz|zip)$' \
        | grep -v '^backend/prisma/migrations/' || true)
if [ -n "$hits" ]; then
  bad "DB 덤프/데이터 파일이 포함됐습니다 (마이그레이션 제외)"
  printf '%s\n' "$hits" | sed 's/^/     /'
  note "덤프는 레포 밖(/tmp)에만 두세요."
else ok "DB 덤프·데이터 파일 없음"; fi

# ── 2) 접속정보 파일 ──
hits=$(printf '%s\n' "$files" | grep -E '(^|/)\.env' | grep -v '\.env\.example$' || true)
if [ -n "$hits" ]; then
  bad "환경변수 파일이 포함됐습니다"; printf '%s\n' "$hits" | sed 's/^/     /'
else ok ".env 계열 없음"; fi

# ── 3) 업로드 원본 ──
hits=$(printf '%s\n' "$files" | grep '^backend/uploads/' | grep -v '\.gitkeep$' || true)
if [ -n "$hits" ]; then
  bad "backend/uploads 실제 파일이 포함됐습니다"; printf '%s\n' "$hits" | sed 's/^/     /'
else ok "업로드 원본 없음"; fi

# ── 4) 파일 내용에 실서버 접속정보/비밀 ──
#    호스트·계정명 패턴 + 일반적인 시크릿 형태. 테스트/시드의 더미는 제외.
exist=$(printf '%s\n' "$files" | while IFS= read -r f; do [ -f "$f" ] && printf '%s\n' "$f"; done)
if [ -n "$exist" ]; then
  hits=$(printf '%s\n' "$exist" | xargs -d '\n' grep -lI -E \
    'dpg-[a-z0-9]+-a\.[a-z-]+\.render\.com|[a-z_]+-postgres\.render\.com|postgres(ql)?://[^ "'"'"']*:[^ "'"'"']*@|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}' \
    2>/dev/null | grep -v '^scripts/predeploy-check.sh$' || true)
  if [ -n "$hits" ]; then
    bad "실서버 접속정보/토큰으로 보이는 문자열이 있습니다"
    printf '%s\n' "$hits" | sed 's/^/     /'
    note "실제 값이면 즉시 폐기·교체하세요. 예시라면 dpg-xxx 처럼 가려주세요."
  else ok "접속정보·토큰 문자열 없음"; fi
fi

# ── 5) 덩치 큰 새 파일 (데이터 덩어리 의심) ──
big=$(printf '%s\n' "$exist" | while IFS= read -r f; do
        s=$(stat -c%s "$f" 2>/dev/null || echo 0)
        [ "$s" -gt 2097152 ] && echo "     $((s/1024/1024))MB $f"
      done)
if [ -n "$big" ]; then
  printf '%s! 2MB 넘는 파일이 있습니다 — 데이터 덩어리인지 확인하세요%s\n' "$YEL" "$OFF"
  printf '%s\n' "$big"
else ok "2MB 초과 신규 파일 없음"; fi

echo
if [ "$fail" -eq 0 ]; then ok "통과 — 배포해도 됩니다"; else
  printf '%s배포 중단. 위 항목을 정리한 뒤 다시 실행하세요.%s\n' "$RED" "$OFF"; fi
exit "$fail"
