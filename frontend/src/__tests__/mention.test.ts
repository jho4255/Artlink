/**
 * 멘션 입력 파싱 — **한글과 공백이 핵심이다.**
 *
 * 여기 있는 케이스는 전부 실제로 깨졌던 것이다. 옛 구현이 `/@(\w*)$/` 였는데
 * `\w` 는 `[A-Za-z0-9_]` 라 한글이 한 글자도 안 걸렸다(한국어 서비스에서 자동완성이
 * 한 번도 뜨지 않았다). 이름에 공백이 있는 계정도 앞 토막만 잘렸다.
 */
import { describe, it, expect } from 'vitest';
import { mentionQueryAt, applyMention } from '@/lib/mention';

describe('mentionQueryAt — 커서 앞의 @… 찾기', () => {
  it('★ 한글이 걸린다 (옛 \\w 정규식이 놓치던 것)', () => {
    expect(mentionQueryAt('@홍길', 3)).toEqual({ start: 0, query: '홍길' });
  });

  it('★ 이름 속 공백도 검색어에 들어간다 (Artist 1, 갤러리 상호)', () => {
    expect(mentionQueryAt('@Artist 1', 9)).toEqual({ start: 0, query: 'Artist 1' });
  });

  it('@ 를 막 쳤을 땐 빈 검색어 — 목록을 바로 펼쳐 보여준다', () => {
    expect(mentionQueryAt('안녕 @', 4)).toEqual({ start: 3, query: '' });
  });

  it('★ 글 끝이 아니라 커서 기준이다 (가운데를 고칠 때)', () => {
    // "@홍 님 안녕" 에서 커서가 3(홍 뒤)
    expect(mentionQueryAt('@홍 님 안녕', 2)).toEqual({ start: 0, query: '홍' });
  });

  it('@ 가 없으면 null', () => {
    expect(mentionQueryAt('그냥 글입니다', 7)).toBeNull();
  });

  it('★ 이메일은 멘션이 아니다 (앞에 글자가 붙어 있다)', () => {
    expect(mentionQueryAt('me@artlink.com', 14)).toBeNull();
  });

  it('줄이 바뀌면 끊긴다', () => {
    expect(mentionQueryAt('@홍길동\n다음 줄', 8)).toBeNull();
  });

  it('다음 @ 가 시작되면 그 앞은 잊는다', () => {
    expect(mentionQueryAt('@가 @나', 5)).toEqual({ start: 3, query: '나' });
  });

  it('★ 너무 길면 멘션을 쓰는 게 아니라 그냥 글이다 (계속 검색하지 않게)', () => {
    expect(mentionQueryAt('@' + '가'.repeat(30), 31)).toBeNull();
  });
});

describe('applyMention — 고른 사람 끼워 넣기', () => {
  it('@ 부터 커서까지를 바꾸고 뒤에 공백을 붙인다', () => {
    const span = mentionQueryAt('@홍', 2)!;
    expect(applyMention('@홍', span, 2, '홍길동')).toEqual({ text: '@홍길동 ', cursor: 5 });
  });

  it('★ 뒤에 있던 글은 그대로 남는다 (가운데 삽입)', () => {
    const text = '@홍 님 안녕하세요';
    const span = mentionQueryAt(text, 2)!;
    expect(applyMention(text, span, 2, '홍길동').text).toBe('@홍길동  님 안녕하세요');
  });

  it('공백이 든 이름도 그대로 들어간다 — 서버가 최장일치로 되찾는다', () => {
    const span = mentionQueryAt('@Art', 4)!;
    expect(applyMention('@Art', span, 4, 'Artist 1').text).toBe('@Artist 1 ');
  });

  it('커서는 끼워 넣은 글자 뒤에 온다', () => {
    const text = '안녕 @홍';
    const span = mentionQueryAt(text, 5)!;
    const out = applyMention(text, span, 5, '홍길동');
    expect(out.text.slice(0, out.cursor)).toBe('안녕 @홍길동 ');
  });
});
