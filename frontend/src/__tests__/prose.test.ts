import { describe, it, expect } from 'vitest';
import { reflowProse, willReflow } from '@/lib/prose';

/**
 * 실데이터에서 가져온 모양들로 검증한다.
 * 여기서 틀리면 **작가의 이력이 한 줄로 뭉개지거나**, 산문이 계단처럼 들쭉날쭉해진다.
 */
describe('reflowProse — 이력은 줄을 지킨다', () => {
  it('김혜원 약력(줄당 6~24자, 종결부호 없음) — 줄바꿈 그대로', () => {
    const src = [
      '2026 미산동 입주예술가 (레지던시) 선정',
      '숙명여자 대학교 미술사학과 석사수료',
      '한국화 전공',
      '한국 금융사박물관 전 학예연구사',
      '국립중앙박물관 전 학예연구원',
    ].join('\n');
    expect(reflowProse(src)).toBe(src);
  });

  it('연도로 시작하는 줄이 길어도 이력으로 본다', () => {
    const src = [
      '2025 <인연:connection_만남과 이별 그리고 다시함께> 한옥청 (서울) 개인전 및 초대전 진행',
      '2024 <틈과 틈 사이> 갤러리 라메르 (서울) 단체전 참여 그리고 도록 발간까지 마쳤다',
    ].join('\n');
    expect(reflowProse(src)).toBe(src);
  });

  it('목록 기호로 시작하면 이력', () => {
    const src = '- 첫 번째 항목입니다 그리고 조금 더 길게 써서 평균 글자수를 올려 봅니다.\n- 두 번째 항목입니다 이것도 충분히 길게 만들어 봅니다 정말로요.';
    expect(reflowProse(src)).toBe(src);
  });

  it('한 줄짜리는 그대로', () => {
    const src = '천안에서 거주하는 회화 작가입니다. 메타세콰이어 숲과 유니콘을 소재로 몽환적인 풍경을 표현합니다.';
    expect(reflowProse(src)).toBe(src);
  });
});

describe('reflowProse — 산문은 이어 붙인다', () => {
  it('박명선 작가노트(문장마다 엔터) — 한 문단으로 흐른다', () => {
    const src = [
      '내 그림의 고양이들은 모두 저만의 이야기들을 품고 있다.',
      '그림 속 그들은 단잠을 꾸며 각각 상상의 나래를 펼치거나, 첫눈에 사랑에 빠지기도 하고, 놀라운 광경에 말을 잃는 경험을 하거나, 설령 다른 차원으로의 여행일지라도 기꺼이 감행한다.',
      '혹시라도 누군가가 이들을 인터뷰하는 시도라도 하게 된다면, 꽤나 흥미진진하고 손에 땀을 쥐게 하는 스토리들을 얻어낼 수 있으리라 생각한다.',
    ].join('\n');
    const out = reflowProse(src);
    expect(out).not.toContain('\n');
    expect(out).toContain('있다. 그림 속');       // 문장 사이에 공백 하나
    expect(out).toContain('감행한다. 혹시라도');
  });

  it('보람 작가노트 — 문단은 유지, 문단 안 문장은 합쳐진다', () => {
    const src = [
      '비눗방울은 잠시 아름답게 반짝이다 사라지지만, 사람들은 그 사라짐을 슬퍼하기보다 다시 비눗방울을 불어 올립니다.',
      '',
      '저는 비눗방울을 통해 우리 주변의 다양한 풍경과 이야기들을 그리고 있습니다. ',
      '사라짐과 다시 시작, 그리고 순간의 반짝임을 비눗방울 안에 담아 바라봅니다.',
      '',
      '제 작품이 누군가에게 잠시 마음이 맑아지는 순간으로 남기를 바랍니다.',
    ].join('\n');
    const out = reflowProse(src);
    expect(out.split('\n\n')).toHaveLength(3);                    // 문단 3개 보존
    expect(out).toContain('있습니다. 사라짐과');                    // 문단 안은 합쳐짐
    expect(out).not.toContain('있습니다.  사라짐');                 // 공백 두 개가 되면 안 된다
  });

  it('줄 끝 공백이 있어도 공백이 겹치지 않는다', () => {
    const out = reflowProse('첫 문장은 여기서 끝납니다.   \n두 번째 문장도 충분히 길게 이어서 씁니다.');
    expect(out).toBe('첫 문장은 여기서 끝납니다. 두 번째 문장도 충분히 길게 이어서 씁니다.');
  });

  it('영문 산문도 같은 규칙으로 합쳐진다', () => {
    const src = 'Every cat in my paintings carries its own story and each one of them dreams.\nIf someone ever tried to interview them, they would come away with thrilling stories.';
    const out = reflowProse(src);
    expect(out).not.toContain('\n');
    expect(out).toContain('dreams. If someone');
  });
});

describe('reflowProse — 섞여 있어도 문단마다 따로 판정', () => {
  it('최금곤 형태: 제목 + 짧은 항목 + 산문', () => {
    const src = [
      '[감정의 기하학]',
      '',
      '건축설계 전공,',
      '서양화, 캘리그라피, 수제도장(전각)',
      '',
      '다양한 공간 속에서 펼쳐지는 우리들의 이야기와 생각들을 단순한 형태로 표현하고 있습니다.',
      '건축적인 구조와 기하학적인 패턴을 통해 보이지 않는 감정과 관계의 흐름을 표현하고 있습니다.',
    ].join('\n');
    const paras = reflowProse(src).split('\n\n');
    expect(paras[0]).toBe('[감정의 기하학]');
    expect(paras[1]).toBe('건축설계 전공,\n서양화, 캘리그라피, 수제도장(전각)');   // 항목은 줄 유지
    expect(paras[2]).not.toContain('\n');                                     // 산문은 합쳐짐
  });
});

describe('reflowProse — 안전장치', () => {
  it('빈 값', () => {
    expect(reflowProse('')).toBe('');
    expect(reflowProse(null)).toBe('');
    expect(reflowProse(undefined)).toBe('');
  });

  it('빈 줄이 여러 개여도 문단 하나로만 센다', () => {
    expect(reflowProse('가\n\n\n\n나').split('\n\n')).toHaveLength(2);
  });

  it('윈도우 줄바꿈(CRLF)도 처리한다', () => {
    expect(reflowProse('2026 수상\r\n2025 선정')).toBe('2026 수상\n2025 선정');
  });

  it('글자를 잃지 않는다 — 공백만 달라져야 한다', () => {
    const src = '첫 문장입니다. 충분히 길게 씁니다.\n두 번째 문장입니다. 이것도 길게 씁니다.\n\n2026 수상\n2025 선정';
    const strip = (s: string) => s.replace(/\s/g, '');
    expect(strip(reflowProse(src))).toBe(strip(src));
  });
});

describe('willReflow', () => {
  it('이력은 바뀌지 않는다', () => {
    expect(willReflow('2026 수상\n2025 선정')).toBe(false);
  });
  it('산문은 바뀐다', () => {
    expect(willReflow('첫 문장입니다. 충분히 길게 씁니다.\n두 번째 문장입니다. 이것도 길게 씁니다.')).toBe(true);
  });
});
