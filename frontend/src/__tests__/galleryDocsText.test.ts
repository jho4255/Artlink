/**
 * 갤러리 결과물의 표기·글자·엑셀 규칙 (2026-11-24, 규칙 92).
 *
 *  - 표기 정리는 **문서에 찍을 때만** — 저장된 값은 그대로다(작품 캡션 .hwp 는 사용자 결정으로 예전 그대로라 이 규칙을 안 쓴다)
 *  - 작품 번호는 전시 전체에 이어진다 — 작품 리스트·출품 자료·작품 원본 파일 이름이 같은 번호
 *  - 글은 낱말 단위로 줄을 바꾸고(한국어 keep-all), Pretendard 에 없는 한자·이모지는 대체 글꼴 조각으로 갈라 둔다
 */
import { describe, it, expect } from 'vitest';
import {
  docArtistName, isNotForSale, kstDate, kstPeriod, kstShortDate, mediumText, numberWorks, padNo, priceAmount, priceText, sizeText,
} from '@/lib/galleryDocs/format';
import { FB_CJK, FB_EMOJI, KEEP_WORD_MAX, cleanText, collectFallbackChars, paragraphs, runs, txt } from '@/lib/galleryDocs/text';
import { colName, sheetName, sheetXml, xmlText } from '@/lib/galleryDocs/xlsx';
import { pretendardHas } from '@/lib/galleryDocs/glyphCoverage';

describe('표기 정리 — 문서에 찍을 때만', () => {
  it('재료: 목록에 있는 낱말만 대소문자를 맞춘다(고유명사·한글은 그대로)', () => {
    expect(mediumText('acrylic on Canvas ')).toBe('Acrylic on canvas');
    expect(mediumText('Acrylic On Canvas')).toBe('Acrylic on canvas');
    expect(mediumText('Mixed Media on unbleached Cotton fabric')).toBe('Mixed media on unbleached cotton fabric');
    expect(mediumText('Ink on Hanji')).toBe('Ink on Hanji');
    expect(mediumText('캔버스에  유채')).toBe('캔버스에 유채');
    expect(mediumText(null)).toBe('');
  });

  it('크기: 곱하기 기호와 단위 앞 띄어쓰기만 맞춘다(단위를 지어 붙이지 않는다)', () => {
    expect(sizeText('24.2x24.2cm')).toBe('24.2 × 24.2 cm');
    expect(sizeText('72.7 X 60.6 cm')).toBe('72.7 × 60.6 cm');
    expect(sizeText('30*30*10cm')).toBe('30 × 30 × 10 cm');
    expect(sizeText('45.5×45.5')).toBe('45.5 × 45.5');
    expect(sizeText('가변 크기')).toBe('가변 크기');
  });

  it('가격: 숫자로 읽히면 원 단위, 아니면 쓴 그대로 · 비매 판정', () => {
    expect(priceAmount('1,200,000')).toBe(1_200_000);
    expect(priceAmount('₩320,000')).toBe(320_000);
    expect(priceAmount('120만원')).toBe(1_200_000);
    expect(priceAmount('1200000원')).toBe(1_200_000);
    for (const v of ['비매', '협의', '', '0', null]) expect(priceAmount(v), String(v)).toBeNull();
    expect(priceText('1200000')).toBe('1,200,000원');
    expect(priceText('가격 문의')).toBe('가격 문의');
    expect(isNotForSale('비매품')).toBe(true);
    expect(isNotForSale('NFS')).toBe(true);
    expect(isNotForSale('Not for sale')).toBe(true);
    expect(isNotForSale('협의')).toBe(false);
  });

  it('날짜는 KST 달력 날짜 — 자정 저장값이 하루 전으로 밀리지 않는다', () => {
    expect(kstDate('2027-03-19T15:00:00.000Z')).toBe('2027. 3. 20.');
    expect(kstShortDate('2027-04-08T15:30:00.000Z')).toBe('4. 9.');
    expect(kstPeriod('2027-03-20', '2027-04-06')).toBe('2027. 3. 20 – 4. 6');
    expect(kstPeriod('2026-12-28', '2027-01-03')).toBe('2026. 12. 28 – 2027. 1. 3');
    expect(kstPeriod(null, '2027-04-06')).toBe('2027. 4. 6');
    expect(kstDate(null)).toBe('');
  });

  it('작가 이름은 출품 자료에 적은 이름이 먼저, 없으면 화면에 보이던 이름', () => {
    expect(docArtistName({ name: '박기량', nickname: 'kiryang' }, { nameKo: '박 기량' })).toBe('박 기량');
    expect(docArtistName({ name: '박기량', nickname: 'kiryang' }, { nameKo: '  ' })).toBe('kiryang');
    expect(docArtistName({ name: '박기량', nickname: null }, null)).toBe('박기량');
    expect(docArtistName(null, null)).toBe('작가');
  });
});

describe('작품 번호 — 전시 전체에 이어진다', () => {
  const rows = [
    { user: { id: 5 }, submission: { artworkList: [{}, {}] } },
    { user: { id: 2 }, submission: { artworkList: [{}] } },
    { user: { id: 9 }, submission: { artworkList: null } },
    { user: { id: 7 }, submission: { artworkList: [{}] } },
  ];
  it('참여 작가 순서대로, 작가 안에서는 출품 목록 순서대로', () => {
    const { total, numberOf } = numberWorks(rows);
    expect(total).toBe(4);
    expect([numberOf(5, 0), numberOf(5, 1), numberOf(2, 0), numberOf(7, 0)]).toEqual([1, 2, 3, 4]);
    expect(numberOf(9, 0)).toBe(0);
  });
  it('파일 이름 앞 번호는 자릿수를 채운다(정렬이 맞게)', () => {
    expect(padNo(3, 5)).toBe('03');
    expect(padNo(9, 90)).toBe('09');
    expect(padNo(9, 120)).toBe('009');
  });
});

describe('글자 조각 — 낱말 단위 줄바꿈 · 대체 글꼴', () => {
  const joined = (rs: { text: string }[]) => rs.map((r) => r.text).join('');

  it('글자를 바꾸지 않는다(조각을 이으면 원문) · 짧은 낱말은 한 줄에(noWrap)', () => {
    const rs = runs('작업실은 늘 조용하다');
    expect(joined(rs)).toBe('작업실은 늘 조용하다');
    expect(rs.every((r) => r.noWrap)).toBe(true);
  });

  it(`${KEEP_WORD_MAX}자보다 긴 낱말은 칸 폭에서 끊을 수 있다(좁은 칸이 넘치지 않게)`, () => {
    const long = '가'.repeat(KEEP_WORD_MAX + 6);
    expect(runs(long).some((r) => r.noWrap)).toBe(false);
    expect(runs('24.2 × 24.2 cm', { maxWord: 3 }).find((r) => r.text.startsWith('24.2'))?.noWrap).toBeUndefined();
  });

  it('Pretendard 에 없는 한자·이모지는 대체 글꼴 조각 — 같은 낱말 안이면 다음 조각과 붙여 둔다', () => {
    const rs = runs('개인展 고마워❤️');
    expect(joined(rs)).toBe('개인展 고마워❤');            // 변형 선택자(U+FE0F)는 덜어낸다
    const han = rs.find((r) => r.text === '展')!;
    expect(han.font).toBe(FB_CJK);
    expect(rs[rs.indexOf(han) - 1]!.noNewLine).toBe(true);   // '개인' 다음 줄로 '展' 이 떨어지지 않게
    expect(rs.find((r) => r.text === '❤')!.font).toBe(FB_EMOJI);
    expect(rs.filter((r) => /\s/.test(r.text)).every((r) => !r.font)).toBe(true);   // 공백은 늘 본문 글꼴
    expect(pretendardHas('가'.codePointAt(0)!)).toBe(true);
    expect(pretendardHas('展'.codePointAt(0)!)).toBe(false);
  });

  it('문서에 쓰인 대체 글꼴 글자만 모은다(그 글자만 서버에서 받는다)', () => {
    const doc = { content: [txt('개인展 書畵同源'), { stack: [txt('❤ 書')] }], header: null };
    const { cjk, emoji } = collectFallbackChars(doc.content);
    expect(Array.from(cjk).sort().join('')).toBe(Array.from('展書畵同源').sort().join(''));
    expect(emoji).toBe('❤');
    expect(collectFallbackChars([txt('한글만')])).toEqual({ cjk: '', emoji: '' });
  });

  it('줄바꿈·제어 문자 정리와 문단 — 빈 줄이 문단 사이, 한 줄 바꿈은 문단 안', () => {
    expect(cleanText('a\r\nb c\td\u0007')).toBe('a\nb\nc d');
    expect(paragraphs('첫 문단\n\n둘째\n줄\n\n\n')).toEqual(['첫 문단', '둘째\n줄']);
    expect(paragraphs('  \n\n')).toEqual([]);
  });
});

describe('엑셀(.xlsx) 시트', () => {
  it('글자는 셀 안 문자열(수식이 되지 않는다) · 가격은 숫자 칸 · 빈 칸은 쓰지 않는다', () => {
    const xml = sheetXml(['번호', '작품명', '가격(원)'], [[1, '=SUM(A1)', 1_200_000], [2, '<무제 & 1>', null]], [6, 30, 14]);
    expect(xml).toContain('<c r="B2" t="inlineStr"><is><t>=SUM(A1)</t></is></c>');
    expect(xml).toContain('<c r="C2" s="2"><v>1200000</v></c>');
    expect(xml).toContain('&lt;무제 &amp; 1&gt;');
    expect(xml).not.toContain('r="C3"');
    expect(xml).toContain('<pane ySplit="1"');                   // 첫 줄 고정
    expect(xml).toContain('<autoFilter ref="A1:C3"/>');
  });
  it('열 이름 · 시트 이름 · XML 에 못 넣는 글자', () => {
    expect([colName(0), colName(25), colName(26), colName(27)]).toEqual(['A', 'Z', 'AA', 'AB']);
    expect(sheetName('작품 리스트 [2027/봄]')).toBe('작품 리스트  2027 봄');
    expect(sheetName('가'.repeat(40))).toHaveLength(31);
    expect(xmlText('a\u0001b"c')).toBe('ab&quot;c');
  });
});
