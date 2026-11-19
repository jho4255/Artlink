/**
 * 대화(ArtTalk) 표시 규칙 — `lib/chatView.ts`
 *
 * 여기 있는 규칙은 전부 실제로 화면이 잘못 나왔던 자리다.
 *  · 이어 보낸 말마다 이름·시각이 다 붙어 한 사람이 세 줄 쓰면 이름 3번·시각 3번
 *  · 갠톡인데 제목이 비어 '단체 대화' 로 나옴
 */
import { describe, it, expect } from 'vitest';
import {
  sameChatGroup,
  groupFlags,
  showsSenderName,
  chatTitle,
  timeLabel,
  mergeMessages,
  applyReadState,
  dayKey,
  dividerLabel,
  showsDayDivider,
  bubbleTime,
  listTime,
  listPreview,
  filterChats,
  linkParts,
  chatRoleTag,
  chatCounterpartOf,
} from '@/lib/chatView';

const msg = (senderId: number, createdAt: string) => ({ senderId, createdAt });

describe('sameChatGroup — 묶음 판정', () => {
  it('같은 사람 + 같은 분이면 한 묶음', () => {
    expect(sameChatGroup(msg(1, '2026-08-28T10:03:05Z'), msg(1, '2026-08-28T10:03:59Z'))).toBe(true);
  });

  it('사람이 다르면 다른 묶음', () => {
    expect(sameChatGroup(msg(1, '2026-08-28T10:03:05Z'), msg(2, '2026-08-28T10:03:06Z'))).toBe(false);
  });

  it('★ 분이 넘어가면 다른 묶음 — 1초 차이라도', () => {
    expect(sameChatGroup(msg(1, '2026-08-28T10:03:59Z'), msg(1, '2026-08-28T10:04:00Z'))).toBe(false);
  });

  it('★ 시(hour)까지만 보면 안 된다 — 한 시간 전 말이 방금 말과 붙는다', () => {
    expect(sameChatGroup(msg(1, '2026-08-28T10:00:00Z'), msg(1, '2026-08-28T10:59:00Z'))).toBe(false);
  });

  it('날짜가 다르면 시:분이 같아도 다른 묶음', () => {
    expect(sameChatGroup(msg(1, '2026-08-27T10:03:00Z'), msg(1, '2026-08-28T10:03:00Z'))).toBe(false);
  });

  it('끝(없는 이웃)은 묶이지 않는다', () => {
    expect(sameChatGroup(undefined, msg(1, '2026-08-28T10:03:00Z'))).toBe(false);
    expect(sameChatGroup(msg(1, '2026-08-28T10:03:00Z'), undefined)).toBe(false);
    expect(sameChatGroup(undefined, undefined)).toBe(false);
  });
});

describe('groupFlags — 이름은 첫 줄, 시각은 마지막 줄', () => {
  // 갤러리(3)가 세 줄 → 작가(1)가 두 줄
  const thread = [
    msg(3, '2026-08-28T10:00:10Z'),
    msg(3, '2026-08-28T10:00:20Z'),
    msg(3, '2026-08-28T10:00:30Z'),
    msg(1, '2026-08-28T10:01:00Z'),
    msg(1, '2026-08-28T10:01:40Z'),
  ];

  it('★ 3연속 보낸 말에서 시각은 마지막 한 번만', () => {
    const lasts = thread.map((_, i) => groupFlags(thread, i).last);
    expect(lasts).toEqual([false, false, true, false, true]);
  });

  it('★ 3연속 보낸 말에서 이름은 첫 줄 한 번만', () => {
    const firsts = thread.map((_, i) => groupFlags(thread, i).first);
    expect(firsts).toEqual([true, false, false, true, false]);
  });

  it('묶음마다 first 와 last 가 정확히 하나씩', () => {
    expect(thread.filter((_, i) => groupFlags(thread, i).first).length).toBe(2);
    expect(thread.filter((_, i) => groupFlags(thread, i).last).length).toBe(2);
  });

  it('메시지가 하나뿐이면 첫 줄이자 마지막 줄', () => {
    const one = [msg(1, '2026-08-28T10:00:00Z')];
    expect(groupFlags(one, 0)).toEqual({ first: true, last: true });
  });

  it('번갈아 주고받으면 모두 각자 한 묶음', () => {
    const pingpong = [
      msg(1, '2026-08-28T10:00:00Z'),
      msg(2, '2026-08-28T10:00:01Z'),
      msg(1, '2026-08-28T10:00:02Z'),
    ];
    pingpong.forEach((_, i) => expect(groupFlags(pingpong, i)).toEqual({ first: true, last: true }));
  });

  it('같은 사람이라도 분이 바뀌면 시각이 다시 찍힌다', () => {
    const spread = [
      msg(1, '2026-08-28T10:00:30Z'),
      msg(1, '2026-08-28T10:01:30Z'),
    ];
    expect(spread.map((_, i) => groupFlags(spread, i).last)).toEqual([true, true]);
  });
});

describe('showsSenderName — 이름을 붙일 자리', () => {
  it('★ 단톡에서 남이 보낸 묶음의 첫 줄에만', () => {
    expect(showsSenderName('GROUP', false, true)).toBe(true);
    expect(showsSenderName('GROUP', false, false)).toBe(false);
  });

  it('내 말에는 단톡이어도 이름을 붙이지 않는다', () => {
    expect(showsSenderName('GROUP', true, true)).toBe(false);
  });

  it('★ 갠톡은 좌우 자리로 구분되므로 이름을 붙이지 않는다', () => {
    expect(showsSenderName('DIRECT', false, true)).toBe(false);
    expect(showsSenderName('DIRECT', true, true)).toBe(false);
  });
});

describe('chatTitle', () => {
  const me = { id: 1, name: '한도윤' };
  const other = { id: 2, name: '전지에', nickname: '지에' };

  it('갠톡은 상대 이름 (닉네임 우선)', () => {
    expect(chatTitle({ kind: 'DIRECT', title: null, participants: [me, other] }, 1)).toBe('지에');
  });

  it('갠톡에 나뿐이면 "나"', () => {
    expect(chatTitle({ kind: 'DIRECT', title: null, participants: [me] }, 1)).toBe('나');
  });

  it('단톡은 방 제목', () => {
    expect(chatTitle({ kind: 'GROUP', title: '8월 단체전', participants: [me, other] }, 1)).toBe('8월 단체전');
  });

  it('★ 단톡 제목이 비어도 상대 이름으로 새지 않는다', () => {
    expect(chatTitle({ kind: 'GROUP', title: null, participants: [me, other] }, 1)).toBe('단체 대화');
  });
});

describe('timeLabel', () => {
  it('오늘 보낸 말은 시:분', () => {
    const now = new Date('2026-08-28T12:00:00+09:00');
    expect(timeLabel('2026-08-28T10:03:00+09:00', now)).toMatch(/\d/);
    expect(timeLabel('2026-08-28T10:03:00+09:00', now)).not.toContain('.');
  });

  it('지난 말은 월/일 (점 표기)', () => {
    const now = new Date('2026-08-28T12:00:00+09:00');
    expect(timeLabel('2026-08-20T10:03:00+09:00', now)).toContain('.');
  });
});

/**
 * 증분 폴링 — 2026-09-04.
 *
 * 방을 열 때만 최근 150개를 받고, 이후 폴링은 `?after=<마지막 id>` 로 **새 것만** 받는다.
 * (예전엔 8초마다 방을 통째로 다시 받아서 5,000개 방이면 175KB/s 였다)
 * 그래서 화면이 두 가지를 스스로 해야 하고, 둘 다 여기 규칙이다.
 */
describe('mergeMessages — 초기·폴링·더보기 응답 합치기', () => {
  const m = (id: number, createdAt: string, extra: any = {}) =>
    ({ id, createdAt, senderId: 1, ...extra });

  it('새 것을 뒤에 붙이고 시간순을 지킨다', () => {
    const held = [m(1, '2026-09-04T10:00:00.000Z'), m(2, '2026-09-04T10:01:00.000Z')];
    const got = mergeMessages(held, [m(3, '2026-09-04T10:02:00.000Z')]);
    expect(got.map(x => x.id)).toEqual([1, 2, 3]);
  });

  it('[이전 메시지]로 받은 옛 것은 앞에 붙는다', () => {
    const held = [m(5, '2026-09-04T10:05:00.000Z')];
    const got = mergeMessages(held, [m(3, '2026-09-04T10:03:00.000Z'), m(4, '2026-09-04T10:04:00.000Z')]);
    expect(got.map(x => x.id)).toEqual([3, 4, 5]);
  });

  it('★ 겹치면 나중 것이 이긴다 — 읽음 표시가 갱신돼야 하므로 건너뛰기가 아니라 덮어쓰기', () => {
    const held = [m(1, '2026-09-04T10:00:00.000Z', { read: false })];
    const got = mergeMessages(held, [m(1, '2026-09-04T10:00:00.000Z', { read: true })]);
    expect(got).toHaveLength(1);
    expect((got[0] as any).read).toBe(true);
  });

  it('빈 응답(조용한 폴링)은 들고 있던 것을 그대로 둔다', () => {
    const held = [m(1, '2026-09-04T10:00:00.000Z')];
    expect(mergeMessages(held, [])).toBe(held);
  });

  it('같은 시각이면 id 순 — 동시에 들어온 메시지의 순서가 흔들리지 않게', () => {
    const t = '2026-09-04T10:00:00.000Z';
    const got = mergeMessages([], [m(9, t), m(7, t), m(8, t)]);
    expect(got.map(x => x.id)).toEqual([7, 8, 9]);
  });
});

describe('applyReadState — 폴링에 없는 옛 메시지의 읽음 표시 되계산', () => {
  const mine = { id: 1, senderId: 1, createdAt: '2026-09-04T10:00:00.000Z', read: false, unreadBy: null };
  const theirs = { id: 2, senderId: 2, createdAt: '2026-09-04T10:01:00.000Z', read: null, unreadBy: null };

  it('★ 갠톡 — 상대가 그 뒤에 읽었으면 읽음으로 바뀐다', () => {
    const got = applyReadState([mine], 'DIRECT',
      [{ userId: 1, lastReadAt: null }, { userId: 2, lastReadAt: '2026-09-04T10:00:30.000Z' }], 1);
    expect(got[0].read).toBe(true);
  });

  it('갠톡 — 상대가 아직 안 읽었으면 그대로', () => {
    const got = applyReadState([mine], 'DIRECT',
      [{ userId: 1, lastReadAt: null }, { userId: 2, lastReadAt: null }], 1);
    expect(got[0].read).toBe(false);
  });

  it('남이 보낸 말에는 읽음 표시를 달지 않는다', () => {
    const got = applyReadState([theirs], 'DIRECT',
      [{ userId: 1, lastReadAt: '2026-09-04T11:00:00.000Z' }, { userId: 2, lastReadAt: null }], 1);
    expect(got[0].read).toBeNull();
    expect(got[0].unreadBy).toBeNull();
  });

  it('★ 단톡 — 아직 안 읽은 사람 수를 센다 (보낸 사람 제외)', () => {
    const got = applyReadState([mine], 'GROUP', [
      { userId: 1, lastReadAt: null },                              // 나 (제외)
      { userId: 2, lastReadAt: '2026-09-04T10:00:30.000Z' },        // 읽음
      { userId: 3, lastReadAt: null },                              // 안 읽음
      { userId: 4, lastReadAt: '2026-09-04T09:00:00.000Z' },        // 그 전에 읽음 = 안 읽음
    ], 1);
    expect(got[0].unreadBy).toBe(2);
    expect(got[0].read).toBeNull();
  });

  it('readers 가 없으면(옛 서버) 아무것도 건드리지 않는다', () => {
    const list = [mine];
    expect(applyReadState(list, 'DIRECT', [], 1)).toBe(list);
  });

  it('바뀔 게 없으면 같은 객체를 돌려준다 (불필요한 리렌더 방지)', () => {
    const readers = [{ userId: 1, lastReadAt: null }, { userId: 2, lastReadAt: null }];
    const got = applyReadState([mine], 'DIRECT', readers, 1);
    expect(got[0]).toBe(mine);
  });
});


/* ───────── 2026-11-19 ArtTalk 개편 — 날짜·시각·미리보기·찾기·링크 ───────── */
describe('날짜·시각은 한국 시간(KST) — 브라우저 시간대와 무관', () => {
  it('★ dayKey — UTC 15:00 은 KST 다음 날 0시', () => {
    expect(dayKey('2026-11-19T14:59:00Z')).toBe('2026-11-19');
    expect(dayKey('2026-11-19T15:00:00Z')).toBe('2026-11-20');
  });

  it('날짜 구분 줄 — 요일까지', () => {
    expect(dividerLabel('2026-11-19T03:00:00Z')).toBe('2026년 11월 19일 목요일');
    expect(dividerLabel('2026-11-19T15:30:00Z')).toBe('2026년 11월 20일 금요일');
  });

  it('★ 말풍선 시각은 늘 시:분 — 예전 timeLabel 은 지난 말에 날짜만 찍고 시각을 버렸다', () => {
    expect(bubbleTime('2026-11-19T11:46:00Z')).toBe('오후 8:46');
    expect(bubbleTime('2026-11-18T23:05:00Z')).toBe('오전 8:05');
    expect(bubbleTime('2026-11-19T03:00:00Z')).toBe('오후 12:00');
    expect(bubbleTime('2026-11-19T15:00:00Z')).toBe('오전 12:00');
  });

  it('목록 시각 — 오늘 시:분 · 어제 · 올해 월.일 · 그 전 연.월.일', () => {
    const now = new Date('2026-11-19T12:00:00Z');   // KST 11월 19일 21시
    expect(listTime('2026-11-19T11:46:00Z', now)).toBe('오후 8:46');
    expect(listTime('2026-11-18T10:00:00Z', now)).toBe('어제');
    expect(listTime('2026-11-17T10:00:00Z', now)).toBe('11.17');
    expect(listTime('2025-12-31T10:00:00Z', now)).toBe('2025.12.31');
  });

  it('날짜가 바뀌는 자리에만 구분 줄 — 첫 말에는 늘', () => {
    const list = [{ createdAt: '2026-11-18T14:00:00Z' }, { createdAt: '2026-11-18T14:30:00Z' }, { createdAt: '2026-11-18T15:10:00Z' }];
    expect(list.map((_, i) => showsDayDivider(list, i))).toEqual([true, false, true]);
  });
});

describe('목록 미리보기·거르기', () => {
  const me = 1;
  const direct = { id: 10, kind: 'DIRECT', title: null, unread: 2, participants: [{ id: 1, name: '나' }, { id: 2, name: '윤서진', nickname: null }], lastMessage: { content: '네, 가능합니다', senderId: 2, senderName: '윤서진' } };
  const group = { id: 11, kind: 'GROUP', title: '2027 신진작가 공모', unread: 0, participants: [{ id: 1, name: '나' }, { id: 3, name: '갤러리' }], lastMessage: { content: '반입 안내입니다', senderId: 3, senderName: '아트링크 갤러리' } };
  const mine = { ...direct, id: 12, unread: 0, lastMessage: { content: '사진\n두 장', senderId: 1, senderName: '나' } };

  it('★ 내가 보낸 건 「나:」 · 단톡의 남의 말은 「보낸 사람:」 · 1:1 의 상대 말은 그대로 · 줄바꿈은 한 칸', () => {
    expect(listPreview(direct, me)).toBe('네, 가능합니다');
    expect(listPreview(group, me)).toBe('아트링크 갤러리: 반입 안내입니다');
    expect(listPreview(mine, me)).toBe('나: 사진 두 장');
    expect(listPreview({ kind: 'DIRECT', lastMessage: null }, me)).toBe('');
  });

  it('탭 — 안 읽음 · 1:1 · 공모 단체 / 찾기는 방 이름·상대 이름(대소문자 무시)', () => {
    const all = [direct, group, mine];
    expect(filterChats(all, 'all', '', me).map((c) => c.id)).toEqual([10, 11, 12]);
    expect(filterChats(all, 'unread', '', me).map((c) => c.id)).toEqual([10]);
    expect(filterChats(all, 'direct', '', me).map((c) => c.id)).toEqual([10, 12]);
    expect(filterChats(all, 'group', '', me).map((c) => c.id)).toEqual([11]);
    expect(filterChats(all, 'all', '신진', me).map((c) => c.id)).toEqual([11]);
    expect(filterChats(all, 'all', '서진', me).map((c) => c.id)).toEqual([10, 12]);
    expect(filterChats(all, 'all', '없는 이름', me)).toEqual([]);
  });

  it('역할 꼬리표 — 운영 계정은 「아트링크」(관리자라는 말을 쓰지 않는다)', () => {
    expect(['ARTIST', 'GALLERY', 'VISITOR', 'ADMIN', undefined].map((r) => chatRoleTag(r))).toEqual(['작가', '갤러리', '일반', '아트링크', '']);
  });

  it('1:1 상대 — 단톡이면 null', () => {
    expect(chatCounterpartOf(direct, me)?.id).toBe(2);
    expect(chatCounterpartOf(group, me)).toBeNull();
  });
});

describe('★ 말 속 주소 — 눌리게 하되 HTML 로 넣지 않는다', () => {
  it('글과 주소로 토막 낸다 · 끝의 문장부호는 주소에서 뗀다', () => {
    expect(linkParts('사이트는 https://artlink.cc/exhibitions/3. 확인해 주세요')).toEqual([
      { kind: 'text', value: '사이트는 ' },
      { kind: 'link', value: 'https://artlink.cc/exhibitions/3' },
      { kind: 'text', value: '. 확인해 주세요' },
    ]);
  });

  it('괄호 안 주소 · 주소 안 괄호(위키) 둘 다', () => {
    expect(linkParts('(https://a.com/x)').map((p) => p.value)).toEqual(['(', 'https://a.com/x', ')']);
    expect(linkParts('https://ko.wikipedia.org/wiki/X_(y)').map((p) => p.value)).toEqual(['https://ko.wikipedia.org/wiki/X_(y)']);
  });

  it('http·https 만 — javascript: 등은 그냥 글이다', () => {
    expect(linkParts('javascript:alert(1)')).toEqual([{ kind: 'text', value: 'javascript:alert(1)' }]);
    expect(linkParts('그냥 글')).toEqual([{ kind: 'text', value: '그냥 글' }]);
  });
});
