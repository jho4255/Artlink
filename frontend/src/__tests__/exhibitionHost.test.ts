/**
 * 공모 주최자 규칙 — 화면에서 헷갈리기 쉬운 두 가지를 고정한다.
 *
 *   1. 운영 위임 ≠ 소유. 위임받은 갤러리는 운영은 하되 **삭제는 못 한다**(서버도 403).
 *   2. 운영 가능 판정은 서버가 내려주는 `canOperate` 를 따른다 — 프론트가 오너 비교를 다시 구현하면
 *      규칙이 두 벌이 되어 어긋난다.
 */
import { describe, it, expect } from 'vitest';
import { isAdminHosted, canOperate, canDelete } from '../lib/exhibitionHost';

const gallery = { id: 7, role: 'GALLERY' };
const admin = { id: 1, role: 'ADMIN' };
const artist = { id: 9, role: 'ARTIST' };

describe('isAdminHosted', () => {
  it('hostType 이 ADMIN 일 때만 참', () => {
    expect(isAdminHosted({ hostType: 'ADMIN' })).toBe(true);
    expect(isAdminHosted({ hostType: 'GALLERY' })).toBe(false);
    expect(isAdminHosted({})).toBe(false);       // 옛 데이터(필드 없음)
    expect(isAdminHosted(undefined)).toBe(false);
  });
});

describe('canOperate', () => {
  it('서버가 내려준 canOperate 를 그대로 따른다', () => {
    expect(canOperate({ hostType: 'ADMIN', canOperate: true, gallery: { ownerId: 999 } }, gallery)).toBe(true);
    expect(canOperate({ hostType: 'ADMIN', canOperate: false, gallery: { ownerId: 7 } }, gallery)).toBe(false);
  });

  it('canOperate 가 없으면(목록 API) 오너 비교로 폴백', () => {
    expect(canOperate({ gallery: { ownerId: 7 } }, gallery)).toBe(true);
    expect(canOperate({ gallery: { ownerId: 8 } }, gallery)).toBe(false);
    expect(canOperate({ gallery: null }, gallery)).toBe(false);
  });

  it('갤러리 계정이 아니면 항상 false', () => {
    expect(canOperate({ canOperate: true }, artist)).toBe(false);
    expect(canOperate({ canOperate: true }, admin)).toBe(false); // Admin 은 운영자가 아니라 관리자
    expect(canOperate({ canOperate: true }, null)).toBe(false);
  });
});

describe('canDelete', () => {
  it('★ 아트링크 주최 공모는 운영 갤러리가 지울 수 없다', () => {
    const hosted = { hostType: 'ADMIN', canOperate: true };
    expect(canOperate(hosted, gallery)).toBe(true);  // 운영은 된다
    expect(canDelete(hosted, gallery)).toBe(false);  // 삭제는 안 된다
  });

  it('갤러리가 직접 등록한 공모는 오너가 지울 수 있다', () => {
    expect(canDelete({ hostType: 'GALLERY', canOperate: true }, gallery)).toBe(true);
    expect(canDelete({ gallery: { ownerId: 7 } }, gallery)).toBe(true);
  });

  it('Admin 은 무엇이든 지울 수 있다', () => {
    expect(canDelete({ hostType: 'ADMIN' }, admin)).toBe(true);
    expect(canDelete({ hostType: 'GALLERY' }, admin)).toBe(true);
  });

  it('무관한 갤러리·비로그인은 false', () => {
    expect(canDelete({ hostType: 'GALLERY', gallery: { ownerId: 8 } }, gallery)).toBe(false);
    expect(canDelete({ hostType: 'ADMIN' }, null)).toBe(false);
  });
});
