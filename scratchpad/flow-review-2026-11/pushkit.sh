#!/usr/bin/env bash
# 데모 DB(4001) 전용 — 새 알림을 일으키는 도우미. 사용: pushkit.sh <명령>
# 공모 번호는 제목('[단계 0n]')으로 찾는다 — 데모 DB 를 다시 깔면 번호가 밀린다(2026-11-20 실제로 한 칸 밀렸다).
API=http://localhost:4001/api
tok() { curl -s -X POST $API/auth/dev-login -H 'Content-Type: application/json' -d "{\"email\":\"$1\"}" | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])"; }
# stage <두 자리 단계 번호> → 그 단계 데모 공모의 id
stage() {
  local G; G=$(tok gallery@artlink.com)
  curl -s $API/exhibitions/my-exhibitions -H "Authorization: Bearer $G" | python3 -c "
import sys,json
d=json.load(sys.stdin); d=d if isinstance(d,list) else d.get('exhibitions',[])
print(next((e['id'] for e in d if str(e.get('title','')).startswith('[단계 $1]')), ''))"
}
S04=$(stage 04); S05=$(stage 05); S09=$(stage 09)
case "$1" in
  submit7)   # [단계 04] Artist 1 이 출품 자료를 다 낸다 → 갤러리 '출품 자료'
    T=$(tok artist1@artlink.com)
    curl -s -X PUT $API/operations/$S04/me -H "Authorization: Bearer $T" -H 'Content-Type: application/json' \
      -d '{"artworkList":[{"title":"푸시 확인 작품","size":"60x40","medium":"캔버스에 유채","year":"2026","price":"500000","image":""}],"cv":{"nameKo":"Artist 1"},"note":{"statement":"푸시 확인 작가노트","sections":[]},"representativeIndex":0}' | head -c 200; echo ;;
  issue12)   # [단계 09] Artist 1 이 정산에 이의 → 갤러리 '정산 이의'
    T=$(tok artist1@artlink.com)
    FP=$(curl -s $API/operations/$S09/my-settlement -H "Authorization: Bearer $T" | python3 -c "import sys,json;print(json.load(sys.stdin).get('fingerprint',''))")
    curl -s -X POST $API/operations/$S09/settlement/respond -H "Authorization: Bearer $T" -H 'Content-Type: application/json' \
      -d "{\"approve\":false,\"comment\":\"'테스트 출품작 1' 판매가가 다릅니다. 150만 원에 팔렸어요.\",\"fingerprint\":\"$FP\"}" | head -c 200; echo ;;
  confirm8)  # [단계 05] 갤러리가 전시 확정 → 수락 작가 '전시 확정'
    T=$(tok gallery@artlink.com)
    curl -s -X PATCH $API/operations/$S05/lifecycle -H "Authorization: Bearer $T" -H 'Content-Type: application/json' -d '{"confirmed":true}' | head -c 200; echo ;;
  *) echo "submit7 | issue12 | confirm8" ;;
esac
