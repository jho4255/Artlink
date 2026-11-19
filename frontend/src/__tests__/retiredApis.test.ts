/**
 * 은퇴한 API 를 화면이 아직 부르고 있지 않은지 — **소스 전체를 훑어** 확인한다.
 *
 * ## 왜 필요한가 (2026-08-28 실제 사고)
 * 대화가 옛 쪽지(`Message`)에서 ArtTalk(`Chat`)으로 바뀐 뒤에도
 * 갤러리 상세·공모 상세의 [쪽지 보내기]가 **옛 `POST /messages` 를 계속 부르고 있었다.**
 * 서버는 200 을 주고 화면은 "쪽지가 전송되었습니다" 를 띄우는데,
 * ArtTalk 은 `Chat` 만 읽으므로 **그 글을 아무도 볼 수 없었다.** 에러가 없어서 아무도 몰랐다.
 *
 * 타입도 테스트도 이걸 못 잡는다 — 주소가 문자열이라서다. 그래서 소스를 직접 본다.
 *
 * ## 새 은퇴 API 를 여기 추가할 때
 * 백엔드 라우트를 지우지 않고 **화면에서만 뗀 경우**가 대상이다(옛 알림 링크 때문에 라우트는 남긴다).
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

const SRC = resolve(__dirname, '..');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === '__tests__' || name === 'node_modules') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sourceFiles(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const FILES = sourceFiles(SRC);

/**
 * 주석을 걷어낸 소스. 주석에는 "'새 대화' 버튼이 없다" 같은 **설명이** 들어 있어서,
 * 날것으로 훑으면 규칙을 적어 둔 문장 자체가 위반으로 잡힌다(실제로 그랬다).
 */
function codeOf(file: string): string {
  return readFileSync(file, 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** 은퇴한 주소 → 대신 써야 하는 것 */
const RETIRED: { pattern: RegExp; what: string; instead: string }[] = [
  {
    pattern: /api\.(post|put|patch|get|delete)\(\s*['"`]\/messages\b/,
    what: '옛 쪽지 API (POST /messages)',
    instead: "POST /chats/direct 로 방을 열고 POST /chats/:id/messages 로 보낸다",
  },
  {
    // 2026-11-19 — 1:1 공모 초대를 통째로 없앴다(서버 라우트도 없다 — 404). 초대 **코드**(`/join`·`/join-code`)는 그대로다
    pattern: /api\.(post|put|patch|get|delete)\(\s*[`'"][^`'"]*\/(invite|invites)\b/,
    what: '1:1 공모 초대 API (/exhibitions/:id/invite · /exhibitions/invites/…)',
    instead: '없앴다 — 이미 선정한 작가는 초대 코드(/exhibitions/:id/join-code)로 들어온다',
  },
  {
    // 옛 쪽지(Message) 신고 — 화면 대화는 ArtTalk 이다. 신고는 POST /chats/:id/report, 관리자 목록은 /chat-reports
    pattern: /api\.(post|put|patch|get|delete)\(\s*[`'"]\/reports\b/,
    what: '옛 쪽지 신고 API (/reports)',
    instead: 'POST /chats/:id/report · 관리자는 GET/PATCH /chat-reports',
  },
];

describe('은퇴한 API 를 아직 부르는 화면이 없다', () => {
  it.each(RETIRED)('$what 를 부르지 않는다', ({ pattern, instead }) => {
    const callers = FILES.filter(f => pattern.test(codeOf(f)))
      .map(f => f.replace(SRC + '/', ''));
    expect(callers, `대신: ${instead}`).toEqual([]);
  });
});

describe('갠톡 진입점은 설계된 길목뿐이다', () => {
  /*
    "아무나 검색해서 말을 걸 수 없다"가 이 기능의 설계다(CLAUDE.md 대화 절).
    방을 여는 곳이 늘어나면 그 전제가 조용히 무너지므로 목록을 고정해 둔다.
    새 길목을 정말 추가할 때는 여기 함께 적을 것 — 그게 검토를 강제한다.
  */
  /*
    2026-11-19 ArtTalk 개편 — 길목이 **둘**로 줄었다. 작가·갤러리 홈페이지·작품 페이지·[작가] 탭 작품 창·공모 상세 [갤러리에 문의]가
    전부 같은 문의 창(InquirySheet)을 연다 — 누르는 순간 빈 방을 만들지 않고, 보낼 때 방을 열고 무엇에 대한 문의인지(맥락 카드)를 함께 싣는다.
    (예전엔 작품 창·공모 상세가 누르는 순간 빈 방을 만들어, 아무것도 안 보냈는데 상대 목록에 빈 방이 떴다 — 실서버 갠톡 2개가 전부 그것)
  */
  const ALLOWED = [
    'components/homepage/InquirySheet.tsx',     // 그 사람·작품·공모를 보고 있는 자리의 [문의하기] — 보낼 때 방을 연다
    'components/chat/NeighborPicker.tsx',       // 이웃에게 바로 말 걸기 — **서로 이웃**만(임의 검색 아님). 설계상 유일한 예외
  ];

  it('POST /chats/direct 를 부르는 화면이 허용 목록과 정확히 같다', () => {
    const callers = FILES
      .filter(f => /['"`]\/chats\/direct['"`]/.test(codeOf(f)))
      .map(f => f.replace(SRC + '/', ''))
      .sort();
    expect(callers).toEqual([...ALLOWED].sort());
  });

  it("★ 화면에 '새 대화' 버튼을 만들지 않는다 (만들면 이 설계가 무너진다)", () => {
    const offenders = FILES.filter(f => /새 대화|새 채팅|대화 상대 검색/.test(codeOf(f)))
      .map(f => f.replace(SRC + '/', ''));
    expect(offenders).toEqual([]);
  });

  it('단톡은 화면에서 만들지 않는다 (공모 승인 때 서버가 만든다)', () => {
    const offenders = FILES.filter(f => /['"`]\/chats\/group['"`]|chats\/.*\{.*kind:\s*'GROUP'/.test(codeOf(f)))
      .map(f => f.replace(SRC + '/', ''));
    expect(offenders).toEqual([]);
  });
});
