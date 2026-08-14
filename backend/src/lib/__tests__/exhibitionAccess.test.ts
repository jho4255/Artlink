/**
 * 공모 운영 권한 판정 — 순수 함수.
 *
 * API 테스트(`__tests__/admin-hosted-exhibition.test.ts`)가 실제 흐름을 검증하지만,
 * **"위임은 아트링크 주최일 때만"** 이라는 규칙은 여기서 한 번 더 못 박는다.
 * 이 한 줄이 무너지면 남의 공모 지원자 개인정보가 통째로 열린다.
 */
import { describe, it, expect } from 'vitest';
import { canOperateExhibition, operableExhibitionWhere, operatorUserIds } from '../exhibitionAccess';

const admin = (managerOwners: number[], hostOwner = 10) => ({
  hostType: 'ADMIN',
  gallery: { ownerId: hostOwner },
  managers: managerOwners.map((ownerId) => ({ gallery: { ownerId } })),
});

describe('canOperateExhibition', () => {
  it('주관 갤러리 오너는 언제나 운영할 수 있다', () => {
    expect(canOperateExhibition(admin([], 10), 10)).toBe(true);
    expect(canOperateExhibition({ hostType: 'GALLERY', gallery: { ownerId: 10 } }, 10)).toBe(true);
  });

  it('아트링크 주최면 위임받은 갤러리 오너도 운영할 수 있다', () => {
    expect(canOperateExhibition(admin([20, 30]), 20)).toBe(true);
    expect(canOperateExhibition(admin([20, 30]), 30)).toBe(true);
  });

  it('★ 갤러리 주최 공모에서는 위임 행이 있어도 권한을 주지 않는다', () => {
    const galleryHosted = {
      hostType: 'GALLERY',
      gallery: { ownerId: 10 },
      managers: [{ gallery: { ownerId: 20 } }], // 어떤 이유로든 남아 있는 행
    };
    expect(canOperateExhibition(galleryHosted, 20)).toBe(false);
  });

  it('hostType 이 없으면(옛 데이터) 위임을 인정하지 않는다', () => {
    expect(canOperateExhibition({ gallery: { ownerId: 10 }, managers: [{ gallery: { ownerId: 20 } }] }, 20)).toBe(false);
  });

  it('무관한 유저·빈 값에는 false', () => {
    expect(canOperateExhibition(admin([20]), 99)).toBe(false);
    expect(canOperateExhibition(null, 20)).toBe(false);
    expect(canOperateExhibition({ hostType: 'ADMIN', gallery: null, managers: null }, 20)).toBe(false);
  });
});

describe('operatorUserIds', () => {
  it('아트링크 주최면 주관 + 위임 갤러리 오너 전부 (중복 제거)', () => {
    expect(operatorUserIds(admin([20, 10, 30], 10)).sort()).toEqual([10, 20, 30]);
  });

  it('갤러리 주최면 오너 한 명뿐', () => {
    expect(operatorUserIds({ hostType: 'GALLERY', gallery: { ownerId: 10 }, managers: [{ gallery: { ownerId: 20 } }] }))
      .toEqual([10]);
  });
});

describe('operableExhibitionWhere', () => {
  it('내 갤러리 공모 + 위임받은 아트링크 주최 공모를 함께 건다', () => {
    expect(operableExhibitionWhere(7)).toEqual({
      OR: [
        { gallery: { ownerId: 7 } },
        { hostType: 'ADMIN', managers: { some: { gallery: { ownerId: 7 } } } },
      ],
    });
  });
});
