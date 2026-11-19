#!/bin/bash
# 가상 계정 둘(676 작가 · 677 갤러리) 사이의 갠톡과 그 알림만 지운다 — 로컬 복제본 전용
# 주소는 환경 변수로 넘긴다(저장소에 접속 정보를 적지 않는다):
#   REPLICA_DATABASE_URL="<backend/.env 의 로컬 주소에서 DB 이름만 artlink_prod 로>" bash reset.sh
set -euo pipefail
: "${REPLICA_DATABASE_URL:?REPLICA_DATABASE_URL(로컬 복제본 artlink_prod 주소)을 넘길 것}"
case "$REPLICA_DATABASE_URL" in
  *localhost*|*127.0.0.1*) ;;
  *) echo "로컬 주소가 아니다 — 멈춘다" >&2; exit 1 ;;
esac
psql "$REPLICA_DATABASE_URL" -Atc "delete from \"Notification\" where \"refKey\" in (select 'chat:'||id from \"Chat\" where \"directKey\"='676-677'); delete from \"Chat\" where \"directKey\"='676-677';"
