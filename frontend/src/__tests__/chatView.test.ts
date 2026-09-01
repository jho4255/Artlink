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
  const me = { id: 1, name: '김혜원' };
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
