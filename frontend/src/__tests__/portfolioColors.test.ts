import { describe, it, expect } from 'vitest';
import { contrast, recommendedTextKeys, bestTextKey, recommendedAccentKeys, bestAccentKey, resolvePalette, LINE_MIN_CONTRAST, BACKGROUNDS, TEXTS, ACCENTS } from '@/lib/portfolioColors';

describe('포트폴리오 색 — 대비/추천', () => {
  it('contrast: 흑백 대비는 높고 같은 색은 1', () => {
    expect(contrast('#000000', '#FFFFFF')).toBeGreaterThan(20);
    expect(contrast('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 1);
  });

  it('밝은 배경(화이트)의 추천 글자색은 어두운 색들, 밝은 글자색은 제외', () => {
    const rec = recommendedTextKeys('white');
    expect(rec).toContain('black');
    expect(rec).toContain('charcoal');
    expect(rec).not.toContain('white');
    expect(rec).not.toContain('cream');
  });

  it('어두운 배경(잉크)의 추천 글자색은 밝은 색들', () => {
    const rec = recommendedTextKeys('ink');
    expect(rec).toContain('white');
    expect(rec).not.toContain('black');
  });

  it('추천 글자색은 모두 대비 4.5 이상 (WCAG AA)', () => {
    for (const bg of BACKGROUNDS) {
      const bgHex = bg.hex;
      for (const k of recommendedTextKeys(bg.key)) {
        const tx = TEXTS.find((t) => t.key === k)!.hex;
        expect(contrast(tx, bgHex), `${bg.key}/${k}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('bestTextKey: 밝은 배경→어두운 글자, 어두운 배경→밝은 글자', () => {
    expect(bestTextKey('white')).toBe('black');
    expect(['white', 'cream', 'slate']).toContain(bestTextKey('ink'));
  });

  // ⚠️ 기준이 3.0(대형 글자용)이었는데 강조색은 **10~13px 글자**로도 쓰인다
  //    (글 페이지 아이브로우·CV 머리말·연락처 라벨·판매상태 배지). 실측에서 3.0 기준 추천
  //    38조합 중 19개가 12px 기준 미달이었다. 초록 점은 약속이므로 가장 가혹한 쓰임에 맞춘다.
  it('추천 강조색은 mono 포함이고, 유채색 추천은 모두 대비 4.5 이상 (작은 글자에도 쓰인다)', () => {
    for (const bg of BACKGROUNDS) {
      const rec = recommendedAccentKeys(bg.key);
      expect(rec, `${bg.key}: mono 는 항상 추천`).toContain('mono');
      for (const k of rec.filter((x) => x !== 'mono')) {
        const ac = ACCENTS.find((a) => a.key === k)!.hex;
        expect(contrast(ac, bg.hex), `${bg.key}/${k}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  // ⚠️ `sub` 는 아무도 대비를 안 쟀는데 **작품 캡션(재료·크기·연도)·작품 설명·CV 영문 라벨·
  //    연락처**가 전부 이 색이다. 옛 상수(mix 0.45)는 흰 배경·검정 글자에서도 3.90:1 이었고,
  //    추천 조합 29개 중 23개(79%)가 AA 미달이었다(최저 2.76:1).
  it('추천 조합에서 보조 글자(sub)는 항상 AA(4.5) 이상 — 캡션이 이 색이다', () => {
    for (const bg of BACKGROUNDS)
      for (const k of recommendedTextKeys(bg.key)) {
        const p = resolvePalette(bg.key, k, 'red');
        expect(contrast(p.sub, p.bg), `${bg.key}/${k}`).toBeGreaterThanOrEqual(4.5);
      }
  });

  // ⚠️ 헤어라인은 장식이 아니라 **구조**를 그린다 — 얇은 테두리·명패·가운데 액자 표지는
  //    그 선이 곧 디자인이고, CV 섹션 밑줄도 같은 색이다. 옛 상수(mix 0.88)는 어두운 배경에서
  //    1.03:1 = 사실상 안 보였다.
  it('구분선(line)은 어떤 배경에서도 최소 대비를 지킨다', () => {
    for (const bg of BACKGROUNDS)
      for (const k of recommendedTextKeys(bg.key)) {
        const p = resolvePalette(bg.key, k, 'red');
        expect(contrast(p.line, p.bg), `${bg.key}/${k}`).toBeGreaterThanOrEqual(LINE_MIN_CONTRAST);
      }
  });

  it('bestAccentKey: 배경 대비가 큰 유채색을 고른다(mono 제외)', () => {
    expect(bestAccentKey('white')).not.toBe('mono');
    expect(recommendedAccentKeys('white')).toContain(bestAccentKey('white'));
  });

  it('resolvePalette: bg/ink/accent 해석 + sub/line 자동 도출', () => {
    const p = resolvePalette('white', 'black', 'red');
    expect(p.bg).toBe('#FFFFFF');
    expect(p.ink).toBe('#1A1A1A');
    expect(p.accent).toBe('#C4302B');
    expect(p.sub).toMatch(/^#[0-9a-f]{6}$/i);
    expect(p.line).toMatch(/^#[0-9a-f]{6}$/i);
    // 모노 강조 = 글자색과 동일
    expect(resolvePalette('white', 'black', 'mono').accent).toBe('#1A1A1A');
  });
});
