/**
 * R2 공개 주소 다중 도메인 지원 테스트 (2026-08-04 커스텀 도메인 전환)
 *
 * DB에 저장된 기존 이미지 주소는 전부 옛 도메인(`pub-*.r2.dev`)이다.
 * `R2_PUBLIC_URL`을 새 도메인으로 그냥 바꾸면
 *   ① 프록시가 옛 주소를 400으로 막아 폴백이 죽고
 *   ② 파일 삭제가 옛 주소를 "우리 것"으로 못 알아봐 고아 파일이 쌓인다.
 * 그래서 쉼표로 여러 주소를 허용하되 SSRF 방어는 그대로 유지되는지 확인한다.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { r2PublicBases, r2CanonicalBase, matchR2Base } from '../lib/r2Urls';

const NEW = 'https://img.artlink.cc';
const OLD = 'https://pub-e87cde18dad54847b656f80cf0ae7b28.r2.dev';
const original = process.env.R2_PUBLIC_URL;

afterAll(() => {
  if (original === undefined) delete process.env.R2_PUBLIC_URL;
  else process.env.R2_PUBLIC_URL = original;
});

describe('단일 도메인 (기존 동작 유지)', () => {
  beforeEach(() => { process.env.R2_PUBLIC_URL = OLD; });

  it('목록과 정식 주소가 그 하나', () => {
    expect(r2PublicBases()).toEqual([OLD]);
    expect(r2CanonicalBase()).toBe(OLD);
  });

  it('해당 도메인만 허용', () => {
    expect(matchR2Base(`${OLD}/artlink/a.jpg`)).toBe(OLD);
    expect(matchR2Base(`${NEW}/artlink/a.jpg`)).toBeNull();
  });
});

describe('다중 도메인 (전환기)', () => {
  beforeEach(() => { process.env.R2_PUBLIC_URL = `${NEW},${OLD}`; });

  it('신규 업로드는 첫 번째(정식) 주소를 쓴다', () => {
    expect(r2CanonicalBase()).toBe(NEW);
  });

  it('★ 신·구 주소를 모두 우리 것으로 인정한다', () => {
    expect(matchR2Base(`${NEW}/artlink/new.jpg`)).toBe(NEW);
    expect(matchR2Base(`${OLD}/artlink/old.jpg`)).toBe(OLD);
  });

  it('공백·끝 슬래시가 섞여도 정규화한다', () => {
    process.env.R2_PUBLIC_URL = ` ${NEW}/ , ${OLD}/ `;
    expect(r2PublicBases()).toEqual([NEW, OLD]);
    expect(matchR2Base(`${OLD}/artlink/a.jpg`)).toBe(OLD);
  });

  it('키 추출이 도메인별로 정확하다 (삭제 시 사용)', () => {
    const url = `${OLD}/artlink/1784-abc.jpg`;
    const base = matchR2Base(url)!;
    expect(url.slice(base.length + 1)).toBe('artlink/1784-abc.jpg');
  });
});

describe('SSRF 방어는 그대로', () => {
  beforeEach(() => { process.env.R2_PUBLIC_URL = `${NEW},${OLD}`; });

  it('다른 호스트는 차단', () => {
    expect(matchR2Base('https://evil.example.com/a.jpg')).toBeNull();
    expect(matchR2Base('http://localhost:4000/api/health')).toBeNull();
    expect(matchR2Base('http://169.254.169.254/latest/meta-data/')).toBeNull();
  });

  it('★ 허용 도메인을 문자열에 끼워 넣은 우회 차단', () => {
    expect(matchR2Base(`https://evil.com/?x=${NEW}/a.jpg`)).toBeNull();
    expect(matchR2Base(`https://img.artlink.cc.evil.com/a.jpg`)).toBeNull();
    expect(matchR2Base(`https://evil.com#${NEW}/a.jpg`)).toBeNull();
  });

  it('프로토콜이 다르면 차단 (https 설정에 http 요청)', () => {
    expect(matchR2Base(`http://img.artlink.cc/artlink/a.jpg`)).toBeNull();
  });

  it('경로 접두사가 없으면 차단 (도메인 루트 등)', () => {
    expect(matchR2Base(NEW)).toBeNull();
    expect(matchR2Base(`${NEW}x/artlink/a.jpg`)).toBeNull();
  });

  it('URL이 아니면 차단', () => {
    expect(matchR2Base('')).toBeNull();
    expect(matchR2Base('not-a-url')).toBeNull();
  });

  it('미설정이면 아무것도 허용하지 않는다', () => {
    delete process.env.R2_PUBLIC_URL;
    expect(r2PublicBases()).toEqual([]);
    expect(r2CanonicalBase()).toBe('');
    expect(matchR2Base(`${OLD}/artlink/a.jpg`)).toBeNull();
  });
});
