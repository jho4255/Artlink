import { describe, it, expect } from 'vitest';
import { instagramHandle } from '../lib/utils';

/**
 * 공개 작가 페이지의 인스타 링크는 계정 아이디를 그대로 보여준다.
 * 'Instagram' 이라고만 쓰면 누구 계정인지 눌러보기 전엔 알 수 없기 때문.
 *
 * 저장된 값이 제각각인 게 핵심이다 — 작가가 주소를 통째로 붙여넣기도 하고,
 * 아이디만 적기도 하고, @를 붙이기도 한다. 전부 받아줘야 한다.
 */
describe('instagramHandle', () => {
  it('주소를 붙여넣은 경우 — 경로 첫 조각이 아이디', () => {
    expect(instagramHandle('https://www.instagram.com/eunyeongma')).toBe('@eunyeongma');
    expect(instagramHandle('https://instagram.com/eunyeongma')).toBe('@eunyeongma');
    expect(instagramHandle('instagram.com/eunyeongma')).toBe('@eunyeongma');
  });

  it('아이디만 적거나 @를 붙인 경우도 받아준다', () => {
    expect(instagramHandle('eunyeongma')).toBe('@eunyeongma');
    expect(instagramHandle('@eunyeongma')).toBe('@eunyeongma');
  });

  it('끝 슬래시·쿼리·해시·대문자 도메인을 흘려보낸다 — 브라우저에서 복사하면 자주 붙는다', () => {
    expect(instagramHandle('https://www.instagram.com/eunyeongma/')).toBe('@eunyeongma');
    expect(instagramHandle('https://www.instagram.com/eunyeongma?hl=ko')).toBe('@eunyeongma');
    expect(instagramHandle('https://www.instagram.com/eunyeongma#reels')).toBe('@eunyeongma');
    expect(instagramHandle('https://Instagram.COM/eunyeongma')).toBe('@eunyeongma');
    expect(instagramHandle('  @eunyeongma  ')).toBe('@eunyeongma');
  });

  it('아이디에 쓰이는 마침표·밑줄·숫자를 지운다거나 자르지 않는다', () => {
    expect(instagramHandle('https://instagram.com/ma.eun_yeong2')).toBe('@ma.eun_yeong2');
  });

  it('아이디 규칙에 안 맞으면 null — 호출부가 그냥 "Instagram" 으로 되돌린다', () => {
    expect(instagramHandle('https://instagram.com/마은영')).toBeNull();  // 한글 아이디는 없다
    expect(instagramHandle('마은영')).toBeNull();
    expect(instagramHandle('a'.repeat(31))).toBeNull();                  // 인스타 상한 30자
    expect(instagramHandle('https://facebook.com/eunyeongma')).toBeNull();
  });

  it('빈 값에서 터지지 않는다 — 인스타를 안 적은 작가가 대부분이다', () => {
    expect(instagramHandle(undefined)).toBeNull();
    expect(instagramHandle(null)).toBeNull();
    expect(instagramHandle('')).toBeNull();
    expect(instagramHandle('   ')).toBeNull();
  });
});
