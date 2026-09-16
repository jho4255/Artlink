/**
 * 크기 표기 순서 판정 (`lib/sizeOrder.ts`) — 세로×가로 관례로 옮기는 마이그레이션의 두뇌.
 * 스크립트가 아니라 여기서 잠근다: 실서버 데이터에 한 번 돌리는 코드라 되돌릴 수 없다.
 */
import { describe, it, expect } from 'vitest';
import { toHeightFirst, artworkListSize } from '../sizeOrder';

describe('toHeightFirst — 사진 비율로 판정', () => {
  it('옛 폼(가로×세로)으로 적힌 값은 사진이 세로 그림이면 뒤집힌다', () => {
    // "72.7×90.9" 가 가로 72.7·세로 90.9 였고 사진도 세로(0.8) → 뒤집어 세로×가로
    const r = toHeightFirst('72.7×90.9 cm', { width: 800, height: 1000 });
    expect(r).toEqual({ text: '90.9×72.7 cm', changed: true, reason: 'image-swapped' });
  });

  it('이미 세로×가로로 적힌 값은 사진이 맞으면 그대로 둔다 (폼을 무시하고 관례대로 적은 사람 보호)', () => {
    const r = toHeightFirst('90.9×72.7 cm', { width: 800, height: 1000 });
    expect(r).toEqual({ text: '90.9×72.7 cm', changed: false, reason: 'image-kept' });
  });

  it('가로 그림도 같은 규칙 — 옛 값 "116.8×57" 은 세로 57×가로 116.8 로', () => {
    const r = toHeightFirst('116.8 × 57.0 cm', { width: 2000, height: 1000 });
    expect(r.text).toBe('57.0 × 116.8 cm');
    expect(r.changed).toBe(true);
  });

  it('★ 숫자 자리만 바꾼다 — 공백·단위·괄호는 그대로', () => {
    expect(toHeightFirst('30호 (72.7x90.9cm)', null).text).toBe('30호 (90.9x72.7cm)');
    expect(toHeightFirst('72.7 X 90.9', null).text).toBe('90.9 X 72.7');
  });

  it('사진 비율을 모르면 폼 관례였다고 보고 뒤집는다', () => {
    expect(toHeightFirst('72.7×90.9 cm', null)).toEqual({ text: '90.9×72.7 cm', changed: true, reason: 'assumed' });
    expect(toHeightFirst('72.7×90.9 cm', { width: null, height: null }).reason).toBe('assumed');
  });

  it('정사각·읽을 수 없는 값은 건드리지 않는다', () => {
    expect(toHeightFirst('50×50 cm', { width: 10, height: 10 })).toEqual({ text: '50×50 cm', changed: false, reason: 'square' });
    expect(toHeightFirst('가변크기', null)).toEqual({ text: '가변크기', changed: false, reason: 'unparsed' });
    expect(toHeightFirst(null, null)).toEqual({ text: '', changed: false, reason: 'unparsed' });
    expect(toHeightFirst('0×50 cm', null).changed).toBe(false);
  });
});

describe('artworkListSize — 출품리스트 항목', () => {
  it('가로·세로 칸이 따로 있으면 그것으로 다시 합성한다 (가장 확실한 근거)', () => {
    expect(artworkListSize({ size: '72.7×90.9 cm', width: '72.7', height: '90.9' }))
      .toEqual({ text: '90.9×72.7 cm', changed: true, reason: 'image-kept' });
    // 이미 맞으면 바뀐 게 없다
    expect(artworkListSize({ size: '90.9×72.7 cm', width: '72.7', height: '90.9' }).changed).toBe(false);
  });

  it('칸이 없으면 문자열만 보고 뒤집는다', () => {
    expect(artworkListSize({ size: '72.7×90.9 cm' })).toEqual({ text: '90.9×72.7 cm', changed: true, reason: 'assumed' });
  });

  it('정사각·빈 값은 그대로', () => {
    expect(artworkListSize({ size: '50×50 cm', width: '50', height: '50' }).changed).toBe(false);
    expect(artworkListSize({ size: '', width: '', height: '' })).toEqual({ text: '', changed: false, reason: 'unparsed' });
  });
});
