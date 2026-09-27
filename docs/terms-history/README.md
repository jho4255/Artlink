# 작가 지원 약관 판본 기록

작가가 공모에 지원하거나 초대·초대 코드로 참여할 때 `Application` 에 **동의 시각(`termsAgreedAt`) · 버전(`termsVersion`) · 전문 해시(`termsTextHash`)** 가 남는다.
분쟁이 생기면 그 기록으로 **그 작가가 실제로 본 전문**을 찾아야 하므로, 화면에 내건 모든 판본을 여기 보관한다.
공개 경로(`frontend/public/terms/`)에는 **지금 판본만** 있다 — 옛 판본은 git 과 이 폴더에만 있다.

목록은 `artist_apply.json`. 테스트(`backend/src/__tests__/terms-consistency.test.ts`)가 각 파일의 SHA-256 이 적힌 해시와 같은지,
마지막 판본이 지금 코드의 버전·해시·공개 파일과 같은지 대조한다.

## ⚠️ 2026-09-05 ~ 2026-09-27 의 기록은 버전이 틀려 있다

2026-09-05 배포(`9780e5f`)에서 제7조(정산 무응답 3일 자동 수락)·제8조(정원 및 마감)를 넣었는데 **버전과 해시를 올리지 않았다.**
그래서 그 사이 동의 기록은 `artist_apply_2026-07-03` / `b6cbfa5e…` 를 가리키지만, 화면에 걸려 있던 글은 `artist_apply_2026-09-05.txt`(해시 `9308d78a…`)다.

- 이 기간의 기록을 **고쳐 쓰지 않았다** — 기록은 그때 서버가 남긴 그대로 두는 것이 원칙이다.
- 대신 `termsVersion = 'artist_apply_2026-07-03'` 이고 `termsAgreedAt` 이 **2026-09-05 배포 이후**인 행은 `artist_apply_2026-09-05.txt` 를 본 것으로 읽는다.
  배포 시각은 Render 대시보드의 배포 이력에서 정확히 확인할 것(커밋 시각은 2026-09-05 00:21 KST).
- 2026-09-27 배포부터는 버전이 `artist_apply_2026-09-27` 로 올라가 다시 맞는다.

## 판본을 추가할 때

1. `frontend/public/terms/artist_apply_real.txt` 를 고친다.
2. `backend/src/lib/terms.ts` 의 버전·해시와 프론트 두 곳(`ExhibitionDetailPage`·`InviteApplyModal`)의 버전을 올린다.
3. 새 전문을 이 폴더에 `artist_apply_<버전 날짜>.txt` 로 복사하고 `artist_apply.json` 맨 뒤에 한 줄 더한다.
4. 이용약관(`TermsPage`)의 변경 이력과 최종 수정일도 함께 고친다(이용약관 제3조 — 적용일자와 변경사유를 알린다).
