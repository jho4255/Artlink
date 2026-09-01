/**
 * 목록용 썸네일 주소 규칙.
 *
 * 실측 배경(2026-08-11): 갤러리 운영 페이지가 28×28px 자리에 **원본**을 그려
 * 한 번 열 때 이미지 149건·약 96MB를 받고 있었다. 240px 썸네일로 바꾸면 같은 페이지가 1.3MB가 된다.
 * 규칙이 어긋나면 전부 404 → 원본 폴백으로 조용히 되돌아가 **효과가 0이 되므로** 여기서 못 박는다.
 */
import { describe, it, expect } from 'vitest';
import { thumbUrl, THUMB_SINCE, THUMB_SIZES } from '../components/shared/Thumb';

const after = THUMB_SINCE + 60_000;   // 기능 도입 이후 업로드
const before = THUMB_SINCE - 60_000;  // 이전 업로드

describe('thumbUrl', () => {
  it('파일명 앞에 t240/ 을 끼운다 (백엔드 thumbKey 와 같은 규칙)', () => {
    expect(thumbUrl(`https://img.artlink.cc/artlink/${after}-123.jpg`))
      .toBe(`https://img.artlink.cc/artlink/t240/${after}-123.jpg`);
    expect(thumbUrl(`/uploads/${after}-123.jpg`)).toBe(`/uploads/t240/${after}-123.jpg`);
  });

  it('두 R2 도메인 모두 동작한다', () => {
    for (const host of ['https://img.artlink.cc', 'https://pub-abc.r2.dev']) {
      expect(thumbUrl(`${host}/artlink/${after}-1.jpg`)).toBe(`${host}/artlink/t240/${after}-1.jpg`);
    }
  });

  it('기능 도입 전 업로드는 그대로 원본 — 헛된 404를 쏘지 않는다', () => {
    const u = `https://img.artlink.cc/artlink/${before}-1.jpg`;
    expect(thumbUrl(u)).toBe(u);
  });

  it('시각을 읽을 수 없는 옛 형식도 원본', () => {
    for (const u of ['/uploads/img_640x640.jpg', 'https://x/y/photo.png', '']) {
      expect(thumbUrl(u)).toBe(u);
    }
  });

  it('쿼리·해시가 붙어도 파일명 위치를 지킨다', () => {
    expect(thumbUrl(`https://img.artlink.cc/a/${after}-1.jpg?v=2`))
      .toBe(`https://img.artlink.cc/a/t240/${after}-1.jpg?v=2`);
  });

  it('경로를 바꾸지 않는다 (디렉터리 구조 보존)', () => {
    expect(thumbUrl(`https://img.artlink.cc/deep/path/${after}-1.jpg`))
      .toBe(`https://img.artlink.cc/deep/path/t240/${after}-1.jpg`);
  });
});

/**
 * 작품 격자용 t800 (2026-08-27)
 *
 * 240px 는 목록칸(28~120px)용이라 작품 격자에 쓰면 뭉개진다 — 실측 표시 크기가
 * PC 377px / 레티나 754px / 모바일3x 486px 이라 0.32~0.64배로 늘어난다.
 * t800 은 도입과 동시에 기존 372장을 전부 백필했으므로 **시각 가드를 걸지 않는다**.
 */
describe('thumbUrl(size) — 크기 두 종', () => {
  it('grid 는 t800 을 끼운다', () => {
    expect(thumbUrl(`https://img.artlink.cc/artlink/${after}-1.jpg`, 'grid'))
      .toBe(`https://img.artlink.cc/artlink/t800/${after}-1.jpg`);
  });

  it('기본값은 목록용(t240) — 기존 호출부가 그대로 동작한다', () => {
    const u = `https://img.artlink.cc/artlink/${after}-1.jpg`;
    expect(thumbUrl(u)).toBe(thumbUrl(u, 'list'));
    expect(thumbUrl(u)).toContain('/t240/');
  });

  it('★ grid 는 백필했으므로 옛 파일도 t800 을 쓴다', () => {
    // 372장 전부가 2026-08-11 이전 업로드다. 시각으로 거르면 효과가 0이 된다.
    expect(thumbUrl(`https://img.artlink.cc/artlink/${before}-1.jpg`, 'grid'))
      .toBe(`https://img.artlink.cc/artlink/t800/${before}-1.jpg`);
  });

  it('list 는 아직 백필 전이라 옛 파일에 헛된 404를 쏘지 않는다', () => {
    const u = `https://img.artlink.cc/artlink/${before}-1.jpg`;
    expect(thumbUrl(u, 'list')).toBe(u);
    expect(THUMB_SIZES.list.backfilled, 't240 을 백필했다면 이 값을 true 로 바꿀 것').toBe(false);
    expect(THUMB_SIZES.grid.backfilled).toBe(true);
  });

  it('시각을 못 읽는 옛 형식도 grid 는 t800 을 시도한다 (없으면 onError 로 원본 폴백)', () => {
    expect(thumbUrl('/uploads/img_640x640.jpg', 'grid')).toBe('/uploads/t800/img_640x640.jpg');
  });

  it('빈 주소는 그대로 (두 크기 모두)', () => {
    expect(thumbUrl('', 'grid')).toBe('');
    expect(thumbUrl('', 'list')).toBe('');
  });

  it('두 크기의 폴더명이 서로 다르다 (섞이면 화질/용량이 뒤엉킨다)', () => {
    expect(THUMB_SIZES.list.dir).not.toBe(THUMB_SIZES.grid.dir);
  });
});
