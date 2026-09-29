/**
 * 출품 자료 체크리스트·검증 + 공모 등록 일정 요약 (2026-09-29)
 *
 * `lib/submissionChecklist.ts` — 편집기의 네 줄(출품작·대표작·약력·작가노트)과 '갤러리에 보낸 상태'.
 * ⚠️ serverStatus 는 서버 `submissionComplete`(routes/exhibition.ts)·갤러리 [제출 완료] 배지와 같은 규칙이어야 한다.
 * `lib/scheduleSummary.ts` — 등록 폼 아래 한 줄 일정.
 */
import { describe, it, expect } from 'vitest';
import { artworkMissing, hasContent, hasNoteContent, serverStatus, submissionChecklist } from '@/lib/submissionChecklist';
import { md, scheduleSummary } from '@/lib/scheduleSummary';
import { EMPTY_CV, EMPTY_NOTE } from '@/types';

const art = (o: Record<string, unknown> = {}) =>
  ({ image: '', title: '', size: '', width: '', height: '', medium: '', year: '', price: '', ...o }) as any;
const full = (title = '가을의 문', o: Record<string, unknown> = {}) => art({ title, size: '72.7×60.6 cm', medium: 'Oil on canvas', year: '2026', price: '1500000', ...o });

describe('artworkMissing — 캡션에 들어가는 다섯 칸', () => {
  it('빈 칸 작품은 검사하지 않는다(보내지 않으므로)', () => {
    expect(artworkMissing(art())).toEqual([]);
  });
  it('하나라도 쓰면 나머지 필수 칸을 이름으로 돌려준다', () => {
    expect(artworkMissing(art({ title: '제목' }))).toEqual(['크기', '재료', '제작년도', '가격']);
    expect(artworkMissing(full())).toEqual([]);
  });
  it('공백만 있는 칸은 빈 칸', () => {
    expect(artworkMissing(full('   '))).toEqual(['작품명']);
  });
});

describe('submissionChecklist — 지금 화면에 채운 것', () => {
  const items = (input: Parameters<typeof submissionChecklist>[0]) => Object.fromEntries(submissionChecklist(input).map(i => [i.key, i.done]));

  it('처음엔 넷 다 비어 있다', () => {
    expect(items({ artworkList: [], repIndex: null, cv: EMPTY_CV, note: EMPTY_NOTE })).toEqual({ artworks: false, representative: false, cv: false, note: false });
  });

  it('작품은 채운 것 전부가 완전해야 ✓ — 한 점이라도 빈 칸이 있으면 아직', () => {
    expect(items({ artworkList: [full(), art({ title: '미완성' })], repIndex: 0, cv: EMPTY_CV, note: EMPTY_NOTE }).artworks).toBe(false);
    expect(items({ artworkList: [full(), art()], repIndex: 0, cv: EMPTY_CV, note: EMPTY_NOTE }).artworks).toBe(true);  // 갓 추가한 빈 칸은 무시
  });

  it('대표작은 빈 칸을 가리키면 안 된다', () => {
    expect(items({ artworkList: [full(), art()], repIndex: 1, cv: EMPTY_CV, note: EMPTY_NOTE }).representative).toBe(false);
    expect(items({ artworkList: [full(), art()], repIndex: 0, cv: EMPTY_CV, note: EMPTY_NOTE }).representative).toBe(true);
  });

  it('약력·노트는 내용이 있어야 — 빈 객체·빈 문자열은 없음(규칙 15)', () => {
    expect(hasContent({ nameKo: '  ', solo: [] })).toBe(false);
    expect(hasContent({ ...EMPTY_CV, nameKo: '홍길동' })).toBe(true);
    expect(hasNoteContent({ statement: '  ', sections: [] })).toBe(false);
    expect(hasNoteContent({ statement: '', sections: [{ title: 'a', body: '' }] })).toBe(true);
  });
});

describe('serverStatus — 갤러리가 지금 보는 것', () => {
  it('★ 임시저장(draft) 작품은 갤러리에 안 보인다 — 서버 submissionComplete 와 같은 규칙', () => {
    const cv = { ...EMPTY_CV, nameKo: '홍길동' };
    const note = { statement: '작가노트', sections: [] };
    expect(serverStatus({ artworkList: [full('a', { draft: true })], cv, note })).toMatchObject({ artworks: false, complete: false, any: true });
    expect(serverStatus({ artworkList: [full('a', { draft: false })], cv, note })).toMatchObject({ artworks: true, complete: true });
  });
  it('아무것도 없으면 any=false', () => {
    expect(serverStatus({ artworkList: [], cv: null, note: null })).toMatchObject({ any: false, complete: false });
  });
});

describe('scheduleSummary — 등록 폼 아래 한 줄', () => {
  it('문자열에서 바로 월/일을 뗀다(UTC 해석으로 하루 밀리지 않게)', () => {
    expect(md('2026-10-01')).toBe('10/1');
    expect(md('2026-12-31T15:00:00.000Z')).toBe('12/31');
    expect(md('')).toBe('');
  });
  it('시간순으로 이어 붙인다', () => {
    expect(scheduleSummary({ deadlineStart: '2026-09-27', deadline: '2026-10-11', submissionDeadline: '2026-10-21', exhibitStartDate: '2026-11-01', exhibitDate: '2026-11-15' }))
      .toBe('지원 9/27–10/11 · 자료 제출 ~10/21 · 전시 11/1–11/15');
  });
  it('채운 칸만 — 비면 빈 문자열', () => {
    expect(scheduleSummary({ deadline: '2026-10-11' })).toBe('지원 ~10/11');
    expect(scheduleSummary({})).toBe('');
  });
  it('공모만 진행하면 자료 제출·전시는 안 적는다(값이 남아 있어도)', () => {
    expect(scheduleSummary({ recruitOnly: true, deadlineStart: '2026-09-27', deadline: '2026-10-11', exhibitStartDate: '2026-11-01' }))
      .toBe('지원 9/27–10/11');
  });
});
