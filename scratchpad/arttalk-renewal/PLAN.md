# ArtTalk(메시지) 개편 — 버그 전수 조사 · 화면 개편 · 전시 초대 제거 계획

작성 2026-11-19 · 기준 커밋 `68339b2`(main = deploy/render) · **구현 전 문서**(이 문서를 쓴 세션은 코드를 고치지 않았다)

- 목업(비공개 캔버스): https://claude.ai/artifact/5gk1T5nTDEXbKvb4tKQeY1 — 원본은 `scratchpad/arttalk-renewal/mock/project/*.dc.html`
- 재현 하니스: `scratchpad/arttalk-renewal/audit/probe.cjs`(가상 계정 둘 · 로컬 전용) · `reset.sh`(그 둘의 갠톡만 지운다)
- 사용자 요청(2026-11-19): ①ArtTalk 버그 전수검사 ②UX/UI 리뉴얼(앱에서 필수 기능) ③1:1 문의를 로그아웃 줄로 내리고 그 자리에 같은 아이콘으로 ArtTalk ④갤러리의 전시 초대 기능을 통째로 없앤다(초대 **코드**는 남긴다)

읽는 순서: 0(결정) → 1(실측) → 2(결함 목록) → 4(작업 묶음). 3(화면 명세)·5(전수검사 표)는 작업하면서 찾아본다.

---

## 0. 먼저 정할 것 (사용자 결정 — 괄호가 이 계획의 기본값)

구현하는 쪽은 사용자가 따로 말하지 않으면 **기본값대로** 진행한다.

| # | 정할 것 | 기본값(추천) | 다른 선택 |
|---|---|---|---|
| D1 | 새 메시지가 뜨는 속도 | **폴링 유지 + 다듬기**(방 4초 · 목록 10초 · 탭으로 돌아오면 즉시). 앱은 푸시가 오면 즉시(지금도 그렇다) | SSE 실시간(WP8, 선택) |
| D2 | 신고·차단 | **이번에 넣는다** — 앱 스토어 심사(Apple 1.2 · Google Play UGC)가 1:1 대화가 있는 앱에 신고·차단을 요구한다. 규칙 33(신고 끊김)도 같이 닫는다 | 앱 출시 직전으로 미룸 |
| D3 | 빈 방 | **첫 메시지가 있어야 목록에 나온다**(방은 지금처럼 만들되 목록에서 뺀다) | 방 생성 자체를 첫 메시지 때로 미룸(더 큰 수술) |
| D4 | 프로필 사진 | **대화에서는 이름 첫 글자 원**(사진 안 씀) — 작가 사진은 대개 카카오 프로필이라 홈페이지도 작가가 켜야 보인다(규칙 77). 단체방은 공모 포스터 | 사진 보이기 |
| D5 | 작품·공모 맥락 카드 | **넣는다**(`ChatMessage.ref`) — 문의가 어느 작품·공모에 대한 것인지 방 위에 고정 | 지금처럼 사진 첨부만 |
| D6 | 보낸 메시지 삭제 | **이번엔 없음**(지금도 없다 — 병합 로직이 '삭제 없음'을 전제한다) | 다음 라운드 |
| D7 | `ExhibitionInvite` 표 | **표는 남기고 코드만 지운다**(실서버 0행 — 다음 정리 때 drop) | 이번에 drop 마이그레이션 |
| D8 | 지원 약관의 '초대를 수락하거나' 문구 | **그대로 둔다** — 판본을 올리면 보관본·해시까지 손대야 한다(규칙 57). 쓰이지 않는 조항이 남을 뿐이다 | 약관 개정 |
| D9 | 단체방 공지 띠 · 입장 안내 줄 | **선택(WP7)** — 목업 3번에 그려 두었다 | 빼기 |
| D10 | 휴대폰 하단 탭바에 ArtTalk | **넣지 않는다**(이미 7칸) — 상단 아이콘 + [메뉴] 맨 위 | 탭 하나를 빼고 넣기 |
| D11 | 비회원 문의함([받은 문의]) | **ArtTalk 목록 맨 위에 '비회원 문의 N' 한 줄**(받기를 켠 사람에게만, 누르면 지금 화면) | 그대로(숨은 탭) / 완전 통합 |

---

## 1. 지금 상태 (실측)

### 1-1. 실서버 사용량 (2026-11-15 복제본)

| 항목 | 값 |
|---|---|
| 회원 | 작가 179 · 갤러리 14 · 일반 1 · 관리자 3 |
| 갠톡 방 | 2 — **둘 다 메시지 0개**(누가 [메시지]를 눌러 방만 생기고 아무것도 안 보냄) |
| 공모 단체방 | 4(참여자 5 · 1 · 1 · 1) |
| 보낸 메시지 | **0** |
| 방 알림 끈 사람 | 0 |
| 전시 초대(`ExhibitionInvite`) | **0행**(한 번도 쓰이지 않았다) · `joinedVia` 가 INVITE·CODE 인 지원 0 |
| 앱 푸시 토큰 | 3(관리자 2 · 가상 작가 1) |

→ 옛 데이터·옛 사용 습관을 지킬 것이 없다. 전시 초대를 없애도 잃는 것이 없다.

### 1-2. 사용자가 겪은 일의 원인 (로컬 서버 기록 + 재현)

로컬 서버 기록 순서: `GET /chats → []`(ArtTalk 방문, 빈 목록이 캐시에 든다) → 작가 홈페이지 [문의하기] →
`POST /chats/direct` → `POST /chats/9/messages 201` → [대화 보기] → `GET /chats/9` … **그 뒤 `GET /chats`(목록)가 한 번도 없다.**

- 문의 창(`InquirySheet`)이 보낸 뒤 목록 캐시(`['chats']`)를 무효화하지 않는다.
- 전역 `staleTime` 이 5분이라 ArtTalk 에 다시 들어가도 5분 안이면 다시 받지 않는다(`refetchOnWindowFocus: false`).
- 15초 폴링이 유일한 갱신인데, 탭이 가려져 있으면(다른 창을 보는 동안) 폴링도 멈춘다.

재현(`probe.cjs`, 가상 계정):

| 확인 | 결과 |
|---|---|
| 보낸 직후 [대화 보기] — PC 왼쪽 목록 | '아직 대화가 없습니다' **15.4초** |
| 휴대폰에서 [←] 목록으로 | **빈 목록** |
| 그 상태에서 기기 뒤로가기 | **다시 그 방으로**(목록 ↔ 방 고리) |
| 받는 쪽이 방을 연 뒤 상단 배지 | **26~27초** 남는다 |
| 방을 열 때 `GET /chats/:id` | 2번(개발 서버 — 운영 빌드에서 확인 필요) |
| 입력 칸 | `<input>` — 줄바꿈 불가 |
| 이웃 고르기 창 · 사진 크게 보기 | `role="dialog"` 0 · `aria-modal` 0 |

### 1-3. 로컬 확인 때 알아 둘 것

- 로컬 백엔드는 실서버 복제본 + Firebase 키로 떠 있다. **복제본의 실제 계정에 메시지를 보내면 그 계정에 기기 토큰이 있을 때 진짜 푸시가 나간다.**
  지금 토큰이 있는 실제 계정은 관리자 둘뿐이다(사용자가 보낸 작가 540·493 은 토큰이 없어 푸시가 나가지 않았다).
- 확인·재현은 가상 계정으로: `intro-gallery@artlink.test`(677, 갤러리) ↔ `intro-sample@artlink.test`(676, 작가 `/@seojin.yoon`).

---

## 2. 결함 목록 (전수 조사 1차 — 코드 정독 + 재현)

표시: ★ = 재현으로 확인 · ○ = 코드로 확인(재현 안 함) · 등급 P0(기능이 안 되는 것처럼 보임) / P1(틀리거나 불편) / P2(다듬기)

### 2-1. 목록·배지가 늦거나 틀림

| id | 등급 | 내용 | 자리 |
|---|---|---|---|
| B1 ★ | P0 | 방을 만들거나 보낸 뒤 **목록이 옛 캐시 그대로**. ArtTalk 밖에서 보내는 곳 셋이 목록을 무효화하지 않는다 | `components/homepage/InquirySheet.tsx sendMember` · `pages/ExhibitionDetailPage.tsx openChat` · `components/shared/ArtworkDetailModal.tsx openChat` |
| B2 ★ | P0 | ArtTalk 목록 쿼리가 전역 staleTime(5분)을 그대로 써 **들어와도 다시 받지 않는다** | `pages/MessagesPage.tsx` `useQuery(['chats'])` |
| B3 ★ | P1 | 방을 읽은 뒤에도 상단 배지(30초 폴링)·목록의 안 읽은 수(15초)가 남는다 — 읽음을 캐시에 반영하지 않는다. 벨 숫자(`['unread-count']`)도 같다(서버는 그 방 알림을 읽음 처리한다) | `MessagesPage.tsx` 방 응답 처리 effect |
| B4 ○ | P1 | 탭이 가려진 동안 폴링이 멈추고, 돌아와도 즉시 받지 않는다(다음 틱까지 최대 8·15초) | 같은 파일 |
| B5 ○ | P2 | 단체방 목록 미리보기에 누가 보냈는지 없다 · 내가 보낸 말도 구분 없다 | `backend/src/lib/chat.ts listChats` |

### 2-2. 빈 방 · 상대 상태

| id | 등급 | 내용 | 자리 |
|---|---|---|---|
| B6 ★ | P1 | **빈 방이 상대 목록에 생긴다** — [메시지]·[갤러리에 문의]·이웃 고르기가 누르는 순간 방을 만든다(실서버 갠톡 2개가 전부 이것). 받는 쪽엔 알림도 없이 '아직 대화가 없습니다' 방이 뜬다 | `routes/chat.ts POST /direct` + `listChats` |
| B7 ○ | P1 | **탈퇴한 상대에게 보낼 수 있다** — 저장은 되지만 아무도 읽지 않는다. 화면엔 '탈퇴한 회원' 이름만 나오고 입력 칸이 그대로다 | `routes/chat.ts POST /:id/messages` |
| B8 ○ | P1 | 새 갠톡 수·보내는 속도에 **상한이 없다** — 회원이면 작가 179명 전원에게 방을 열고 보낼 수 있다(전역 300/15분뿐) | `routes/chat.ts` |
| B9 ○ | P2 | 알림 한 줄 합치기가 '찾고 → 없으면 만든다'라 동시에 두 메시지가 오면 같은 방 알림이 두 줄이 될 수 있다(`refKey` 는 unique 가 아니다 — 글 좋아요에서 고친 것과 같은 모양) | `lib/chat.ts notifyChatMessage` |

### 2-3. 방 화면

| id | 등급 | 내용 | 자리 |
|---|---|---|---|
| B10 ★ | P1 | 휴대폰 [←] 가 기록을 **쌓는다**(`setSearchParams({})`) → 기기·앱 뒤로가기를 누르면 방으로 되돌아간다 | `MessagesPage.tsx` 방 머리 |
| B11 ★ | P1 | 이웃 고르기 창 · 사진 크게 보기에 `role="dialog" aria-modal` · Esc 가 없다 → **앱 뒤로가기가 창 대신 화면을 넘긴다**(규칙 79) | `MessagesPage.tsx` 포털 둘 |
| B12 ★ | P1 | 입력 칸이 한 줄 `<input>` — **줄바꿈을 칠 수 없다**(받은 글의 줄바꿈은 그려 준다) | `MessagesPage.tsx` 입력 폼 |
| B13 ○ | P1 | 위로 올려 지난 말을 읽는 중에 새 말이 오면 **맨 아래로 끌려간다**(마지막 id 가 바뀌면 무조건 스크롤) | 같은 파일 `lastMsgId` effect |
| B14 ○ | P1 | 방을 바꾸는 순간 **앞 방의 말이 한 프레임 보일 수 있다**(메시지 state 를 effect 에서 비운다 — 렌더가 먼저다) | 같은 파일 초기화 effect |
| B15 ○ | P1 | 날짜 구분이 없다 — 오늘이 아닌 말은 '11. 18.' 만 나오고 **시각이 없다** | `lib/chatView.ts timeLabel` |
| B16 ○ | P1 | 보내기가 낙관적이지 않다 — 느린 망에선 보낸 말이 서버 응답 뒤에야 뜨고, 실패하면 알림 글 하나뿐(다시 보내기 없음) | `send` mutation |
| B17 ○ | P1 | 휴대폰에서 방이 페이지 안 상자다(위 로고·제목, 아래 회사 정보·탭바, 메시지 칸 `max-h-[55vh]`) — 자판이 뜨면 대화가 두세 줄만 보인다 | 화면 구조 |
| B18 ○ | P2 | 주소(URL)가 눌리지 않는다 | 말풍선 |
| B19 ○ | P2 | 첨부 사진이 원본이다(썸네일 미사용 — 규칙 21) · 받는 동안 자리 높이가 없어 화면이 밀린다 · 한 번에 한 장 | `ChatAttachment` |
| B20 ○ | P2 | 작품 문의가 '사진 첨부 + 글'일 뿐이라 받는 작가가 **그 작품 페이지로 갈 수 없다** | `InquirySheet` |
| B21 ○ | P2 | [갤러리에 문의](공모 상세)는 **어느 공모 얘기인지 없이** 빈 방만 연다 | `ExhibitionDetailPage` |
| B22 ○ | P2 | 단체방에 참여자 목록이 없다('참여자 N명' 글자뿐) · 주최와 작가가 구분되지 않는다 | 방 머리 |
| B23 ○ | P2 | 2,000자를 넘으면 말없이 잘린다(`slice`) | 입력 칸 |
| B24 ○ | P2 | 쓰던 글이 방을 옮기면 사라진다(방마다 보관하지 않음) | 입력 칸 |

### 2-4. 없는 기능 (앱 출시 전에 필요한 것)

| id | 내용 |
|---|---|
| N1 | **신고** — 말풍선에 신고가 없고 서버(`routes/report.ts`)는 옛 쪽지(`Message`)만 받는다(규칙 33, 미해결) |
| N2 | **차단** — 없다 |
| N3 | 방 숨기기(목록 정리) — 없다. 끝난 공모의 단체방이 영원히 쌓인다 |
| N4 | 대화 찾기(이름·공모) — 없다 |

### 2-5. 멀쩡한 것 (건드리지 말 것 — 회귀 주의)

- 남의 방 404 · 관리자도 예외 없음 · 갠톡 서버 관문(작가·갤러리에게만, 일반·운영 계정은 서로 이웃일 때만).
- 증분 폴링(`?after=` 커서는 **id**) · `mergeMessages`(id 병합, 나중 것이 이긴다) · `applyReadState`(읽음은 `readers` 로 전부 다시 계산) — CLAUDE.md '대화' 절의 ⚠️ 전부.
- 조용한 폴링은 DB 를 쓰지 않는다 · 안 읽은 수는 `OR` 한 덩어리 `groupBy`.
- 방마다 알림 끄기 · 대화 푸시 모양(제목 = 보낸 사람) · 앱에서 푸시가 오면 `['chats']`·`['chat']` 무효화 · 위쪽 배너.
- 첨부는 우리 저장소 주소만 · 주소와 종류는 함께.
- 공모 단체방 자동 생성·합류(`ensureExhibitionChat`) · 갤러리 없는 공모는 관리자가 방에 들어간다.

---

## 3. 화면 명세 (목업 번호 = 캔버스 화면 번호)

공통: 흑백 + 강조색 하나(`text-accent`), 그림자·그라데이션 없음, 알약 필터 금지(글자 탭), 누르는 곳 44px 이상, 화면에 설명 문구를 두지 않는다(막혔을 때만 문장).
색은 토큰 클래스만(`singleAccent.test.ts`). 긴 무공백 글은 `[overflow-wrap:anywhere]`(규칙 30), 격자 칸은 `min-w-0`(규칙 27).

### ① 대화 목록 (휴대폰) — `Main.dc.html`

- 앱 틀(상단바 · 하단 탭바) 그대로. 상단 편지 아이콘 → **말풍선**(`MessageCircle`), 이름표 'ArtTalk'.
- 머리: `ArtTalk`(로고 규칙) · 오른쪽 [찾기](돋보기 — 누르면 이름·공모 찾는 칸) · [이웃에게 메시지](연필 네모, 지금 기능 그대로).
  ⚠️ '새 대화'·'새 채팅'·'대화 상대 검색' 글자를 쓰지 말 것(`retiredApis.test.ts` 가 막는다). 찾기는 **내 대화 목록 안에서만** 거른다.
- 글자 탭: 전체 · 안 읽음 N · 1:1 · 공모 단체 (화면에서 거른다 — 서버 변경 없음).
- 줄(72px): 얼굴(1:1 = 이름 첫 글자 원 48 / 단체 = 공모 포스터 8px 모서리 네모, contain) · 이름 + 역할(작가·갤러리·일반) 또는 '단체 N' · 시각 ·
  미리보기 한 줄(단체는 '보낸 사람: 글', 내가 보낸 건 '나: 글', 첨부만이면 '사진'·'동영상'·'파일') · 안 읽은 수(강조색, 알림 끈 방은 회색 + 종 꺼짐 아이콘).
  안 읽은 방은 이름 굵게 · 미리보기 진하게. 탈퇴한 상대는 '탈퇴한 회원'(회색, 점선 원).
- 시각: 오늘 = '오후 8:46' · 어제 = '어제' · 올해 = '11.17' · 그 전 = '2025.11.17'.
- 빈 목록: 문장 하나 + 갈 곳 둘([작가 둘러보기] · [모집공고 보기]).
- (D11) 받기를 켠 작가·갤러리에게만 목록 맨 위 '비회원 문의 N' 한 줄 → `/mypage?tab=received-inquiries`.

### ② 1:1 대화 (휴대폰) — `Room.dc.html`

- **대화 전용 화면**: 상단바·하단 탭바·회사 정보 없음(ArtLook 편집 전용 화면과 같은 방식 — `Layout` 이 틀을 안 그린다). 화면 높이를 다 쓴다.
- 머리(56px): [←] · 얼굴 36 · 이름(굵게) + '작가 · 홈페이지 보기'(누르면 홈페이지) · [⋯] 방 메뉴.
- **맥락 카드**(있을 때만, 머리 아래 고정): 작은 그림(contain) · '작품 문의' · `작품명, 연도` · `재료 · 크기` · [작품 보기]. 공모면 '공모 문의' · 제목 · 마감.
  가장 최근에 붙은 맥락 하나만 고정한다.
- 메시지: 날짜 구분 줄('2026년 11월 19일 목요일', KST) · 같은 사람 + 같은 분은 묶음(지금 규칙) · 남의 묶음 첫 줄에 얼굴 30 ·
  시각은 묶음 마지막 말풍선 **옆**(카카오톡처럼, 늘 '오후 8:46') · 내 말엔 '읽음'(1:1) · 말풍선 최대 폭 76% · 모서리 14px ·
  내 말 = 검정 바탕 흰 글, 남의 말 = `gray-100`.
- 사진 = 썸네일(t800) · contain · 자리 높이를 먼저 잡는다 · 누르면 `ImageLightbox`(원본). 파일 = 이름·크기·'받기' 카드. 동영상 = 지금대로.
- 보내는 중 = 말풍선이 바로 뜬다(연한 테두리). 실패 = '보내지 못했어요 · 다시 보내기'(강조색 글자 단추).
- 입력 줄: [+](사진·동영상·파일) · 여러 줄 입력 칸(1~5줄 자동, 글자 16px — iOS 확대 방지) · [보내기](검정 네모 44, 위 화살표).
  자판 바로 위에 붙는다. 휴대폰은 Enter = 줄바꿈, 마우스 화면은 Enter = 보내기 · Shift+Enter = 줄바꿈(한글 조합 중 Enter 는 무시).
- 위로 올려 읽는 중에 새 말이 오면 끌어내리지 않고 **[새 메시지 N ↓]**(목업 3번) — 누르면 맨 아래.
- 탈퇴·차단 상태면 입력 줄 자리에 한 줄('탈퇴한 회원이에요' / '차단한 상대예요 · 차단 풀기').

### ③ 공모 단체 대화 (휴대폰) — `Group.dc.html`

- 머리: 포스터 네모 36 · 공모 제목(한 줄) · '참여자 12 · 공모 보기' — '참여자 12' 를 누르면 참여자 창(이름 · 주최/작가 · 홈페이지).
- 남의 묶음 첫 줄: 이름 + 주최면 강조색 '주최'(운영자 = 그 공모의 알림 대상, 서버가 판정). 주최 얼굴은 검정 네모.
- 내 말 옆 숫자 = 아직 안 읽은 사람 수(지금 규칙).
- (D9 선택) 공지 띠 = 그 공모의 가장 최근 운영 공지 한 줄 → 누르면 운영 공지. 입장 안내 줄('○○ 님이 들어왔어요').

### ④ 방 메뉴 — `RoomMenu.dc.html`

- 휴대폰 = 아래에서 올라오는 창, PC = [⋯] 아래 작은 목록. `role="dialog" aria-modal` + Esc + 바깥 누르기.
- 1:1: 홈페이지 보기 · 알림 끄기/켜기 · (선택)대화 내용 찾기 · 목록에서 숨기기 · 신고하기 · 차단하기(강조색).
- 단체: 공모 보기 · 참여자 · 알림 끄기/켜기 · 목록에서 숨기기 · 신고하기.
- 말풍선 길게 누르기(PC 는 마우스 오른쪽 또는 호버 [⋯]): 복사 · (남의 말) 신고.
- 신고 창: 사유 고르기(스팸·광고 / 욕설·비방 / 사기 의심 / 기타) + 자세한 내용(선택) + 한 줄 고지
  ('신고하면 이 메시지와 앞뒤 대화 일부가 운영자에게 전달돼요') + [신고하기]. 차단은 `ConfirmDialog details`.

### ⑤ 갤러리 [관심 작품] — `Likes.dc.html`

- 카드의 [전시 초대] → **[문의하기]**(글자 링크, 문의 창 + 그 작품 맥락). 위의 안내 문장('…전시 초대를 보낼 수 있습니다')은 지운다.

### ⑥ PC — `Desktop.dc.html`

- 사이트 틀(상단바 + 오른쪽 메뉴) 안에서 **두 칸이 화면 높이를 다 쓴다**(회사 정보 푸터 없음, 바깥 둥근 상자·페이지 제목 줄 없음).
  왼쪽 340px = 목록(머리 `ArtTalk` + [이웃에게 메시지] · 찾는 칸 · 글자 탭 · 줄), 오른쪽 = 방. 고른 줄은 `gray-100` 바탕.
- 방 머리 오른쪽: 알림 종 · [⋯]. 입력 칸은 2줄부터, [보내기] 글자 단추. 파일을 끌어다 놓거나 사진을 붙여 넣으면 첨부.
- 1024px 미만은 휴대폰 구조(목록 ↔ 방 전환)를 그대로 쓴다. 두 구조를 CSS 로 둘 다 그려 감추지 말 것(`useMediaQuery` 로 하나만).

### ⑦ 메뉴 자리 — `Menu.dc.html`

- PC 오른쪽 메뉴: [역할 메뉴] ─ **[말풍선] ArtTalk  (안 읽은 수)** ─ [1:1 문의] ……… [로그아웃](같은 줄, 12px 회색).
- 상단 아이콘: 편지 → 말풍선(PC·휴대폰 둘 다), `aria-label="ArtTalk"`.
- 휴대폰 [메뉴]: 맨 위 ArtTalk 한 줄(배지) → MY PAGE 탭들 → 맨 아래 [1:1 문의] · [로그아웃] 한 줄.
- 푸터의 [고객센터] 링크는 그대로(비회원의 길).

---

## 4. 작업 묶음 (순서대로 · 묶음마다 따로 커밋할 수 있게)

공통 규칙: 묶음을 끝낼 때마다 `cd backend && npm test`(⚠️ 백엔드 테스트를 두 개 동시에 돌리지 말 것 — `artlink_test` 를 같이 쓴다) + `cd frontend && npm test` + `npm run build`.
훅은 조기 return 위(`hooksBeforeReturn.test.ts`). 새 표는 `backend/src/__tests__/helpers.ts cleanDb` 에 추가. `architecture.md` 갱신.
커밋·푸시·배포는 사용자가 말할 때만.

### WP0. 준비

1. `git status` 로 미추적 파일이 계획 밖인지 확인(커밋 금지 목록은 메모리·CLAUDE.md 참고).
2. 기준선: 백엔드·프론트 테스트 수, `e2e/tests/29-chat.spec.ts` 통과 여부(데모 DB `artlink` 로만 — E2E 는 DB 를 지운다).
3. `node scratchpad/arttalk-renewal/audit/probe.cjs desktop` · `mobile` 로 1-2 표가 재현되는지 본다(복제본 + 가상 계정, 돌리기 전 `reset.sh`).

### WP1. 버그 수정 (화면 모양은 그대로 — 이것만 먼저 배포할 수 있다)

프론트
1. `lib/chatCache.ts`(신규): `chatsChanged(queryClient)` = `['chats']`·`['chat-unread']` 무효화, `chatRead(queryClient, chatId)` = 목록 캐시에서 그 방 `unread` 를 0 으로 + `['chat-unread']`·`['unread-count']`·`['notifications']` 무효화.
2. 보내는 곳 전부가 `chatsChanged` 를 부른다: `InquirySheet.sendMember`(성공 직후) · `ExhibitionDetailPage.openChat` · `ArtworkDetailModal.openChat` · `MessagesPage` 의 send·startDirect · `OperationPage` 의 안내 보내기 둘.
   가드 테스트(신규, `retiredApis.test.ts` 방식): `/chats/` 로 POST 하는 파일은 `chatCache` 를 import 해야 한다.
3. `MessagesPage` 목록 쿼리: `staleTime: 0` · `refetchOnMount: 'always'` · `refetchOnWindowFocus: true` · 주기 10초. 방 쿼리: 4초 · `refetchOnWindowFocus: true`.
   `visibilitychange` 로 탭이 다시 보이면 방·목록을 즉시 다시 받는다.
4. 방 응답을 합칠 때(초기 적재 · 새 말이 실려 온 폴링) `chatRead` 를 부른다.
5. [←] 목록으로: 목록에서 들어온 방이면(`location.state.fromList`) `navigate(-1)`, 아니면 `navigate('/messages', { replace: true })`. 목록에서 방을 열 때 `state: { fromList: true }`.
   PC 에서 방 ↔ 방 전환은 `replace`(뒤로가기가 방들을 거꾸로 훑지 않게).
6. 이웃 고르기 창 · 사진 크게 보기: `role="dialog" aria-modal="true"` + `useEscapeKey` + 스크롤 잠금. 사진은 `ImageLightbox` 로 바꾼다(부모에서 `AnimatePresence`, `initialIndex` — 규칙 11).
7. 방 전환 누수: 방 본문을 `<ChatRoom key={chatId} />` 로 떼어 메시지 state 가 방과 함께 태어나고 죽게 한다(effect 로 비우지 않는다). 이때 지금의 ⚠️(캐시 `removeQueries` · 커서 null ≠ 0)를 그대로 옮길 것.
   운영 빌드에서 방을 열 때 요청이 한 번인지 센다.

백엔드
8. `listChats`: 메시지가 하나도 없는 **DIRECT** 방은 목록에서 뺀다(`where: { participants: { some: { userId } }, OR: [{ kind: 'GROUP' }, { messages: { some: {} } }] }`). `unreadChatCount` 는 원래 메시지 기준이라 그대로.
   `lastMessage` 에 `senderName`(닉네임 우선) 추가, `participants[]` 에 `deleted`(= `deletedAt != null`) 추가.
9. `POST /:id/messages`: DIRECT 방의 상대가 탈퇴했으면 400 '탈퇴한 회원에게는 메시지를 보낼 수 없어요'. `GET /:id` 응답에 `canSend`·`blockReason`('deleted' — WP6 에서 'blocked' 추가).
10. 보내기 상한(서버 메모리, `lib/loginThrottle.ts` 처럼 판정과 세기 사이에 await 없이): 한 사람 1분 30개 → 429 '잠시 후 다시 보내 주세요'.
    새 갠톡 방 하루 30개(`withKeyLock` + 오늘 `createdById = me` 인 DIRECT 수) → 429. 관리자·운영 안내(`sendDirectNotice`)는 제외.
11. `notifyChatMessage`: 받는 사람마다 `withKeyLock(LOCK_NS.chatNotes, …)` 로 '찾고 → 고치거나 만든다'를 줄 세운다(`community.ts` 글 좋아요 알림과 같은 모양 — 잠금 안의 마지막 쿼리로).

테스트
- backend `chat.test.ts`: 빈 갠톡은 양쪽 목록에 없다 → 첫 메시지 뒤에 나온다 · 탈퇴 상대 400 · 분당 상한 · 하루 방 상한(동시 요청) · 동시 두 메시지에 알림 한 줄 · `senderName`.
- frontend: `chatCache` 가드 · `MessagesPage` 소스 가드(목록 쿼리 `staleTime: 0`, 창 둘에 `role="dialog"`).
- e2e `29-chat.spec.ts` 에 추가: 문의 창으로 보낸 뒤 [대화 보기] → **목록에 그 방이 바로 있다** · 휴대폰 [←] 뒤 뒤로가기가 방으로 돌아가지 않는다 · 받는 쪽이 방을 열면 상단 배지가 3초 안에 사라진다.
- `probe.cjs` 다시: 목록 15.4초 → 1초 안 · 배지 27초 → 3초 안 · dialog 2.

### WP2. 전시 초대 제거 (초대 **코드**는 그대로)

지우는 것(화면)
- `pages/MyPage.tsx`: `ArtworkScrapsSection` 의 [전시 초대] 버튼·안내 문장·`InviteModal` 사용 → [문의하기](WP5 전에는 작가 홈페이지로 가는 링크, WP5 에서 문의 창) ·
  `ExhibitionInviteModal`(정의 + [지원자 관리] 패널의 [작가 초대] 버튼 · `canInvite` · `inviteEx` state) ·
  `ApplicationsSection` 의 받은 초대(쿼리 `['received-invites']` · 수락/거절 mutation · 거절 확인창 · 'INVITED' 탭·카드 · 기본 탭 고르는 식의 `invites.length`).
- `components/shared/ArtworkDetailModal.tsx`: `export function InviteModal` 통째로.
- `pages/ExhibitionDetailPage.tsx`: `exhibition.invited` 분기([간편 지원]) · `InviteApplyModal` import·state·렌더. `components/shared/InviteApplyModal.tsx` 파일 삭제.
- `components/shared/ApplicantManager.tsx`: '초대한 작가' 꼬리표(`app.invited`).
- `lib/myExhibitions.ts`: `MyExhibitionBucket` 의 `INVITED` · 그 이름표. `types/index.ts`: `ExhibitionInvite`.
- `pages/ApplyPage.tsx` 주석의 InviteApplyModal 언급.

지우는 것(서버) — `backend/src/routes/exhibition.ts`
- `GET /invites/received` · `POST /invites/:id/accept` · `PATCH /invites/:id` · `POST /:id/invite` · `GET /:id/invites` · 상수 `INVITE_MAX_*`.
  ⚠️ `/join/:code`(GET) · `POST /join` · `/:id/join-code` 는 **남긴다**. 지운 뒤 `GET /exhibitions/invites/received` 가 `/:id` 로 떨어져 500 이 아니라 404·400 인지 확인.
- `POST /join` 안의 `exhibitionInvite.updateMany(…APPLIED)` · `GET /:id` 의 `invited` 계산 · `POST /:id/apply` 의 `pendingInvite`/`viaInvite`(알림 문구 분기 포함) · `GET /:id/applications` 의 `invitedIds`/`invited`.
- `lib/inviteEligibility.ts` 삭제. `lib/push.ts PUSH_TITLES` 의 `EXHIBITION_INVITE` 는 남긴다(옛 알림이 남아 있을 수 있다 — 실서버엔 0건이지만 해가 없다).
- Prisma: `ExhibitionInvite` 모델·관계는 **그대로**(D7). `Application.joinedVia` 주석의 'INVITE' 는 '옛 값'으로 적는다.

테스트·문서
- backend: `explore-engagement.test.ts`(초대 묶음 삭제) · `admin-hosted-exhibition.test.ts`(초대 수락 알림 케이스 삭제) · `invite-code.test.ts`(남은 1:1 초대 관련 단언) · `chat.test.ts`(초대 수락으로 단톡 합류하는 케이스가 있으면 코드 참여로 바꾼다) · `terms-consistency.test.ts`(약관 버전 상수를 보는 파일 목록에서 `InviteApplyModal.tsx` 를 뺀다) · `known-issues-fixes.test.ts`·`dev-settings-revert.test.ts` 에 초대가 섞여 있으면 정리.
  신규 단언: 지운 다섯 주소가 404(또는 400) · 초대 코드 참여는 그대로.
- frontend: `myExhibitions.test.ts` · `flowFixes.test.ts` · `myPageMenu.test.ts` · `native.test.ts` 에서 초대 관련 기대값 정리 + 가드(신규): 소스에 `/invite'`·`invites/` 호출이 없다(`join-code`·`/join` 은 허용).
- e2e: `26-invite-engagement.spec.ts`(초대 묶음 삭제 — 하트 보드·좋아요 공개 케이스는 남긴다) · `33-artist-exhibitions`('초대받은 전시' 탭) · `35-gallery-exhibition-ops`([작가 초대]) · `08-concurrency`(초대 동시성) · `e2e/lib/helpers.ts` 의 초대 도우미.
- CLAUDE.md: '초대 → 참여' 절 · '갤러리 스카우팅' 절을 '없앴다(2026-11, 실서버 사용 0건) — 되살리지 말 것'으로 줄인다 · 규칙 57 의 '정원을 세는 네 곳' → **두 곳**(수락 · 코드 참여) · 규칙 22 의 초대 수락 알림 언급 · TanStack 키 표의 `['received-invites']`.

### WP3. 메뉴 자리

- `lib/myPageMenu.ts`: `MYPAGE_FOOTER_LINKS = [{ label: 'ArtTalk', to: '/messages', brand: ['Art','Talk'], icon: MessageCircle, badge: 'chat' }]` ·
  신규 `MYPAGE_UTILITY_LINKS = [{ label: '1:1 문의', to: '/support' }]`. `FooterLink` 에 `badge?: 'chat'`.
- `components/layout/MyPageSideMenu.tsx`: ArtTalk 줄에 안 읽은 수(Navbar 와 **같은 쿼리 키** `['chat-unread']` — 요청은 한 번) · 맨 아래 줄을 `justify-between` 으로 [1:1 문의] · [로그아웃].
- `components/layout/Navbar.tsx`: `Mail` → `MessageCircle`(두 곳), `aria-label="ArtTalk"`(E2E·`probe.cjs` 가 `aria-label="대화"` 로 찾는 곳을 같이 고친다) · 휴대폰 [메뉴]: 맨 위 ArtTalk 줄, 맨 아래 [1:1 문의] · [로그아웃] 한 줄.
- 테스트: `myPageMenu.test.ts` · e2e `30`(메뉴·화면 이름) · `78`(문의 알림 — 1:1 문의로 가는 길이 바뀐다).

### WP4. 화면 재구성 (목업 ①②③④⑥)

구조
- `pages/MessagesPage.tsx` 는 껍데기(주소 `?chat=` · 휴대폰/PC 전환)만. 새 폴더 `components/chat/`:
  `ChatList` · `ChatListRow` · `ChatRoom`(key = chatId) · `RoomHeader` · `MessageList` · `MessageBubble` · `Composer` · `RoomMenu` · `MembersSheet` · `NeighborPicker`.
  훅 `hooks/useChatRoom.ts`(초기 적재 · 증분 폴링 · 병합 · 읽음 · 더 보기 · 보내기) — 지금 `MessagesPage` 의 로직을 **옮기되 규칙은 바꾸지 않는다**(2-5).
- 표시 규칙은 `lib/chatView.ts` 에 더하고 테스트로 지킨다: `dayKey`(KST) · `dividerLabel` · `bubbleTime`(늘 시:분) · `listTime` · `listPreview`(나:/보낸 사람:/첨부 이름표) · `filterChats`(탭 · 찾기) · `roleTag`.
- 주소는 그대로 `/messages?chat=<id>` — 알림·푸시·운영 안내 링크와 `pushBanner.isOnTarget` 이 이 모양을 쓴다. **바꾸지 말 것.**

휴대폰 대화 전용 화면
- `hooks/useChatBare.ts`: 경로 `/messages` + `chat` 값 + `(max-width: 1023px)` → `Layout` 이 상단바·하단 탭바·푸터를 그리지 않는다(`useArtLookBare` 와 같은 자리, `chrome = !site && !bare && !chatBare`).
- 방 컨테이너 높이 = 보이는 높이(`visualViewport.height`, 없으면 `100dvh`) — iOS 사파리는 자판이 떠도 레이아웃 높이가 그대로라 입력 줄이 자판 뒤로 간다.
  커뮤니티 글쓰기의 도구 막대가 쓰는 방식(`visualViewport`)을 참고. 안드로이드 앱(WebView)은 화면이 줄어든다 — 둘 다에서 입력 줄이 자판 바로 위인지 잰다.
- 방에 들어오면 소개 팝업·홈페이지 팝업이 뜨지 않게: `/messages` 는 이미 `introAllowedAt` 제외. 홈페이지 팝업(`nudgePlace`)에 `/messages` 를 '기다리는 곳'으로 더한다.

PC 두 칸
- 높이 = 화면 − 상단바(`hooks/useFillHeight.ts` 재사용), `/messages` 에서는 회사 정보 푸터를 그리지 않는다(`Layout`). 격자 `grid-cols-[340px_minmax(0,1fr)]` + 칸마다 `min-w-0`.

메시지 목록
- 날짜 구분 줄 · 시각 위치 · 얼굴 · 묶음(3절 ②). 주소 자동 링크는 http·https 만, 새 창 `rel="noopener noreferrer"`, 우리 사이트면 같은 탭(`lib/siteLink.ts openSiteLink`).
  ⚠️ 글을 HTML 로 넣지 말 것 — 문자열을 토막 내 React 요소로 그린다.
- 스크롤: '맨 아래 근처(80px)인가'를 기억했다가 그럴 때만 새 말에 따라 내려간다. 아니면 [새 메시지 N ↓]. 내가 보낸 말은 늘 내려간다. 사진이 늦게 뜨며 밀리지 않게 자리 높이를 먼저.
- [이전 메시지 더 보기] 는 지금처럼(위에 붙이고 보던 자리 유지).

입력 줄(`Composer`)
- `<textarea>` 자동 높이(휴대폰 1~5줄 · PC 2~8줄) · Enter 규칙(3절) · 2,000자(1,800 부터 '1,812 / 2,000' 표시, 넘으면 [보내기] 잠금 — 말없이 자르지 않는다) ·
  방마다 쓰던 글 보관(`sessionStorage artlink-chat-draft:<id>`, 로그아웃 때 지운다) ·
  꾸밈 단추가 글 칸의 포커스를 뺏지 않게(`onPointerDown` 에서 `preventDefault` — 자판이 내려가지 않게, 규칙 81 의 `keepFocus`).
- 첨부: 사진 여러 장(최대 10, 한 장씩 차례로 보낸다) · PC 끌어다 놓기 · 붙여 넣기 · 올리는 동안 자리 말풍선(진행 표시) · 실패하면 그 자리에서 다시 시도. 한도는 지금 그대로(사진 15 · 동영상 25 · 파일 20MB).
- 낙관적 보내기: 임시 id(음수)로 바로 그리고, 응답이 오면 그 줄을 진짜 메시지로 바꾼다(`mergeMessages` 가 음수 id 를 알도록 — 임시 줄은 늘 맨 아래). 실패하면 '다시 보내기'. 같은 글을 두 번 눌러도 한 번만 나가게 보내는 중엔 잠근다.

방 머리·메뉴
- 1:1 머리의 '역할 · 홈페이지 보기': 서버가 `GET /chats`·`GET /chats/:id` 에 `counterpart`({ id, name, role, deleted, homepage(작가 `/@핸들` 또는 `/portfolio/:id` · 갤러리 주인은 승인된 첫 갤러리 `/galleries/:id` 또는 `/@핸들` · 없으면 null), galleryName }) 를 싣는다. 화면이 주소를 손으로 만들지 않는다.
- 단체: `participants[].operator`(그 공모의 운영자 — `exhibitionNotifyTargets`) · 참여자 창.
- 방 메뉴(WP4 에서는 홈페이지 보기 · 알림 · 공모 보기 · 참여자까지. 숨기기·신고·차단은 WP6).

테스트
- `chatView.test.ts`(날짜·시각·미리보기·거르기·읽음 규칙은 서버와 같다) · `chatScreens.test.ts`(신규 소스 가드: 창마다 `role="dialog"` · 입력 칸이 textarea · 조합 중 Enter 무시 · `dangerouslySetInnerHTML` 없음 · 두 구조를 둘 다 그리지 않는다 · 주소 모양 `?chat=`).
- e2e `85-arttalk.spec.ts`(신규): 휴대폰 = 목록 → 방(틀 없음 · 입력 줄이 화면 안) → 줄바꿈 두 줄 보내기 → [←] → 뒤로가기 · PC = 두 칸 높이 · Enter/Shift+Enter · 위로 올린 채 새 말 → [새 메시지] · 끊긴 망에서 보내기 → 다시 보내기 · 사진 두 장.
- 기하 하니스(신규 `scratchpad/arttalk-renewal/audit/walk.cjs`): 크롬 + 사파리 엔진(`~/.cache/wk-deps/run.sh`) × 360·390·412·768·1024·1440 —
  입력 줄이 화면 안(`elementFromPoint` 로 [보내기]가 잡히는가) · 가로 밀림 0 · 무공백 400자 · 긴 이름 · 자판 높이 흉내(visualViewport) · 탭 줄 44px.
- 앱: `emu.sh dev` 로 자판 위 입력 줄 · 뒤로가기(창 → 방 → 목록 → 앞 화면) · 푸시를 눌러 들어온 방에서 [←] 가 목록으로 가는지.

### WP5. 맥락 카드 + 길목 통일 (마이그레이션 ①)

- 스키마: `ChatMessage.ref Json?` — `{ type: 'WORK'|'EXHIBITION'|'SHOW'|'GALLERY', id, title, image, sub, link }`. **서버만 만든다**(화면은 `{type,id}` 만 보낸다).
- `POST /chats/:id/messages` 가 `ref: { type, id }` 를 받는다 → 서버가 존재·공개 여부를 본다(작품 = 그 방 상대(또는 나)의 작품 · 공모/전시/갤러리 = 승인된 것, 규칙 23·24) → 제목·그림(우리 저장소 주소)·부제(연도·재료·크기 / 마감일 / 기간)·링크(작품 `/portfolio/<작가>?work=<id>` · 공모 `/exhibitions/<id>` …)를 찍어 넣는다. 못 찾으면 400.
- `GET /chats/:id` 에 `context` = 그 방에서 가장 최근 `ref`(한 쿼리). 화면은 머리 아래 고정 카드로, 말풍선에도 같은 카드(작게)를 그린다. 카드 그림은 `Thumb`.
- 문의 창 일반화: `components/homepage/InquirySheet` → 받는 사람 + 맥락(`work`|`exhibition`|…)을 받는다. 보낼 때 사진 첨부 대신 `ref`.
  쓰는 곳: 작가·갤러리 홈페이지 · 작품 페이지 · **공모 상세 [갤러리에 문의]**(빈 방 대신 문의 창 + 공모 맥락) · **작품 모달 [메시지]** · **갤러리 [관심 작품] [문의하기]**.
  사이트 화면에서 쓸 땐 테마 변수로 `SITE_THEME` 을 넘긴다.
- `retiredApis.test.ts` 의 갠톡 길목 허용 목록을 `InquirySheet` · `NeighborPicker`(이웃) 둘로 줄인다.
- 테스트: backend(남의 작품·비공개 공모 ref 400 · 화면이 보낸 title/link 는 무시된다 · context 는 최신 것) · e2e(작품 문의 → 받는 작가 방 위에 카드 → [작품 보기]가 그 작품 페이지).

### WP6. 숨기기 · 차단 · 신고 (마이그레이션 ② — WP5 와 한 번에 내도 된다)

스키마
- `ChatParticipant.hiddenAt DateTime?` — 목록에서 뺀다. 그 뒤 새 메시지가 오면(`chat.lastMessageAt > hiddenAt`) 다시 나온다(쓰기 없이 비교로).
- `UserBlock { id, blockerId, blockedId, createdAt, @@unique([blockerId, blockedId]) }`.
- `ChatReport { id, reporterId, chatId, messageId?, targetUserId, reason, detail?, snapshot Json, status 'OPEN'|'DONE'|'DISMISSED', adminNote?, createdAt, reviewedAt?, @@unique([reporterId, messageId]) }`.

서버
- `PATCH /chats/:id/hidden { hidden }`(상태를 적어 보낸다) · `GET /chats` 가 숨긴 방을 뺀다.
- `POST /blocks { userId }` · `DELETE /blocks/:userId` · `GET /blocks`(확인하고 만들지 말 것 — `createMany skipDuplicates`, 규칙 46).
  효과: 둘 사이 갠톡 열기·보내기 **양쪽 모두 403**('메시지를 보낼 수 없는 상대예요' — 누가 막았는지 알리지 않는다) · 막은 사람 목록에서 그 방이 빠진다 · 알림 없음 · 방은 지우지 않는다(풀면 그대로).
  단체방에는 적용하지 않는다(v1 — 공모 운영 공지를 못 받게 되면 안 된다). `GET /chats/:id` 의 `blockReason: 'blocked'`·`blockedByMe`.
- `POST /chat-reports { chatId, messageId?, reason, detail? }` — 참여자만 · 내 말은 신고 불가 · 같은 메시지는 한 번 · `snapshot` = 그 메시지와 앞뒤 4개씩(보낸 사람·글·첨부 주소·시각).
  관리자: `GET /chat-reports?status=` · `PATCH /chat-reports/:id { status, adminNote }`. ⚠️ 관리자가 방을 직접 읽는 길은 만들지 않는다(남의 방 404 원칙 그대로) — 신고에 실린 사본만 본다.
  새 신고는 관리자 전원에게 벨 알림(`CHAT_REPORT`, `PUSH_TITLES` 에 추가) → `/mypage?tab=report-manage`.
- 탈퇴 처리(`routes/auth.ts`)에 `UserBlock` 정리를 더한다.

화면
- 방 메뉴에 숨기기 · 신고 · 차단, 말풍선 메뉴에 복사 · 신고(3절 ④). 숨기면 목록으로 돌아가고 '숨겼어요 [되돌리기]'.
- 프로필 탭에 '차단한 사람'(풀기). 관리자 [신고 관리]에 'ArtTalk 신고' 구역(`StoryReportsSection` 과 같은 틀: 확인할 것 / 처리한 것 · 사본 · 문제없음 · 처리함 · 신고당한 회원의 [사용자 관리] 링크).
  옛 쪽지 신고 구역은 화면에서 뗀다(옛 표·라우트는 그대로 — 규칙 32 방식으로 소스 가드).
- 개인정보처리방침: 신고 때 운영자에게 전달되는 것 · 차단 기록 보관을 적고 최종 수정일을 올린다. CLAUDE.md 규칙 33 을 '해결'로 고친다. `e2e/tests/04-report-moderation.spec.ts` 의 `test.fixme` 를 새 흐름으로.

테스트
- backend `chat-block-report.test.ts`: 숨기기(새 메시지에 다시 나옴) · 차단 양방향 403·알림 없음·동시 두 번 한 줄 · 단체방엔 영향 없음 · 신고 권한·중복·사본 모양 · 관리자 아닌 사람 403 · 탈퇴 정리.
- e2e: 신고 → 관리자 화면에 사본 · 차단 → 상대가 보내면 막힘 → 풀기.

### WP7. (선택, D9) 단체방 입장 안내 줄 · 공지 띠

- `ChatMessage.kind String @default("TEXT")` + 'SYSTEM'. `ensureExhibitionChat` 이 방을 만들 때·사람을 넣을 때 SYSTEM 줄을 넣는다.
  ⚠️ SYSTEM 줄은 안 읽은 수(`unreadWhere`) · 목록 미리보기 · 알림 · 읽음 숫자에서 **전부 뺀다** — 빠뜨리면 공모를 승인할 때마다 모두에게 안 읽은 표시가 뜬다.
- 공지 띠 = 그 공모의 가장 최근 운영 공지(`GET /chats/:id` 의 `notice`). 누르면 운영 공지 위치.

### WP8. (선택, D1) 실시간(SSE)

- `GET /api/chats/stream`(로그인, `text/event-stream`, 25초마다 주석 줄로 연결 유지 — Cloudflare 100초 제한) · 서버 메모리 구독 표(인스턴스 하나라 가능 — 여럿으로 늘리면 Redis 등으로 옮겨야 한다).
  이벤트는 **신호만**(`{ chatId }`) — 화면은 그 방·목록을 지금 폴링 주소로 다시 받는다(내용을 스트림에 싣지 않는다 — 권한 판정이 한 곳에 남는다).
- 끊기면 폴링으로 돌아간다. 끄개 `CHAT_STREAM=off`. 폴링 주기는 연결 중엔 30초로 늦춘다.

### WP9. 전수검사 · 문서

- 5절 표를 한 줄씩 채운다(결과는 이 폴더 `AUDIT.md`).
- CLAUDE.md: 새 규칙 87(ArtTalk 개편 — 목록 캐시 · 대화 전용 화면 · 맥락 카드는 서버가 만든다 · 차단·신고 · 길목 둘 · 초대 제거) + '대화' 절·'갤러리 스카우팅' 절·'초대 → 참여' 절·Navigation Bar 절·TanStack 키 표·테스트 수 갱신. `architecture.md` · `HANDOFF.md`.
- 실서버 배포 뒤: 가상 계정이 없으므로 **보내는 확인은 하지 않는다**(실제 가입자로 로그인 금지). 비회원 화면·주소 404·콘솔 오류만 본다(방문 기록이 남지 않게 비콘을 막고).

---

## 5. 전수검사 표 (WP9 에서 채운다 — 가상 계정 · 로컬)

| 묶음 | 확인 | 방법 |
|---|---|---|
| A 길목 | 작가 홈페이지 · 작품 페이지 · 갤러리 홈페이지 · 공모 상세 · 작품 모달 · 관심 작품 · 이웃 고르기 × (작가·갤러리·일반·관리자) — 보내면 **양쪽 목록에 바로** | e2e + probe |
| A | 일반·관리자 계정에게는 서로 이웃일 때만 · 자기 자신 400 · 탈퇴 404 | backend |
| B 보내기 | 글 · 줄바꿈 · 2,000자 경계 · 이모지 · 주소 · 무공백 400자 · 사진/동영상/파일 한도 경계 · 바깥 주소 첨부 400 · 두 번 누르기 · 끊긴 망 → 다시 보내기 · 분당 30 | e2e + backend |
| C 받기 | 열어 둔 방(4초 안) · 다른 방(목록 배지) · 탭을 가렸다 돌아옴(즉시) · 150개 넘는 방 더 보기 · `after` 커서(동시 삽입) · 방 전환 누수 0 | e2e + 하니스 |
| D 읽음 | 1:1 '읽음' · 단체 안 읽은 수 · 목록·상단·오른쪽 메뉴·[메뉴] 배지가 같은 숫자 · 읽으면 3초 안에 전부 내려감 · 벨의 그 방 알림도 읽음 | probe |
| E 알림 | 방마다 벨 한 줄(동시 두 메시지) · 알림 끈 방은 벨·푸시 없음 · 푸시 제목 = 보낸 사람 · 앱 배너(그 방을 볼 땐 조용히) · 알림 → 그 방 | backend + 에뮬레이터 |
| F 권한 | 남의 방 404(읽기·쓰기·끄기·숨기기·신고) · 관리자도 404 · 차단 양방향 · 탈퇴 상대 | backend |
| G 단체 | 승인 때 생성 · 수락·코드 참여 때 합류 · 갤러리 없는 공모 = 관리자 · 제목 바꾸면 방 이름 · 수락 취소해도 방에 남음 | backend(기존) |
| H 기하 | 크롬 + 사파리 엔진 × 6폭: 입력 줄·[보내기]가 화면 안 · 가로 밀림 0 · 탭바·자판에 안 가림 · 긴 이름·긴 공모 제목 | walk.cjs |
| I 뒤로가기 | 목록 → 방 → [←] → 뒤로(ArtTalk 밖으로) · 알림으로 들어온 방 [←] = 목록 · 창이 떠 있으면 창만 닫힘 · PC 방 ↔ 방은 기록을 안 쌓음 | e2e + 에뮬레이터 |
| J 부하 | 탭 하나의 15분 요청 수(방 4초 + 목록 10초 + 배지 30초 ≈ 345 — 폴링 한도 1,500 안) · 5,000개 방 · 목록 100방 · 조용한 폴링은 쓰기 0 | 하니스(`e2e/tests/40-load-chat`) |
| K 초대 제거 | 지운 주소 404 · 화면에 '초대' 글자는 초대 **코드**뿐 · 코드 참여·정원·단톡 합류 그대로 | backend + e2e 55 |
| L 운영 빌드 | 방을 열 때 요청 1번 · 편집기·pdf 청크처럼 새 청크가 PWA 미리받기에 끼지 않았는지 | `vite preview` |

---

## 6. 하지 않는 것

- 보낸 메시지 삭제·고치기 · 답장(인용) · 반응(이모지) · 입력 중 표시 · 음성·영상 통화 · 방 고정.
- 임의 회원 검색으로 대화 시작(설계 그대로 — 길목은 '그 사람·작품·공모를 보고' + 서로 이웃).
- 단체방 나가기 · 단체방을 손으로 만들기.
- 관리자가 대화를 열람하는 화면(신고 사본만).
- 하단 탭바 구성 변경(D10).

## 7. 구현하는 쪽이 자주 밟는 함정 (이 저장소의 규칙에서)

- 개발 서버가 옛 코드로 응답할 수 있다 — 고친 게 안 보이면 `ss -ltnp | grep -E ':4000|:517'` 와 서버 로그의 마지막 시작 시각부터.
- E2E 는 대상 DB 를 지운다 — `DATABASE_URL=…/artlink`(데모) 를 명시하고, 주소에 Prisma 옵션을 붙이지 않는다. 복제본(`artlink_prod`)으로 돌리지 말 것.
- StrictMode: '한 번만' 표시는 일을 한 **뒤에** 세운다(규칙 61). effect 본문에서 setState 금지(린트).
- 새 알림 종류는 `lib/push.ts PUSH_TITLES` 에(테스트가 훑는다). 새 창은 `role="dialog" aria-modal` + Esc.
- '세고 나서 만들기'는 `withKeyLock`, 토글은 `createMany skipDuplicates`/`deleteMany`(규칙 46).
- 화면에 설명 문구를 늘리지 말 것. 색은 `text-accent` 토큰만. 사진은 자르지 않는다(contain).
- 실제 가입자 계정으로 확인하지 말 것 — 복제본에서도 가상 계정만. 비밀 값(SMTP · DB 주소 · 중계 비밀 · Firebase 키)을 저장소·문서에 적지 말 것.
