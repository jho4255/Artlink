/**
 * 출품 자료 모양(`lib/submissionSchema.ts`) — 화면 타입과 키가 같은가, 읽기가 절대 던지지 않는가 (2026-10-03 점검 P1-5)
 *
 * ⚠️ 서버가 아는 키에 화면 타입의 키가 빠지면, 그 칸은 저장할 때마다 **조용히 사라진다**(모르는 키는 버리므로).
 *    그래서 프론트 `types/index.ts` 의 인터페이스를 소스로 읽어 대조한다.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { ARTWORK_KEYS, CV_LIST_KEYS, CV_TEXT_KEYS, NOTE_KEYS, parseSubmissionBody, readArtworkList, readCv, readNote } from '../submissionSchema';

const typesSrc = fs.readFileSync(path.resolve(__dirname, '../../../../frontend/src/types/index.ts'), 'utf8');
function interfaceKeys(name: string): string[] {
  const m = typesSrc.match(new RegExp(`export interface ${name}\\s*\\{([\\s\\S]*?)\\n\\}`));
  if (!m) throw new Error(`${name} 를 types/index.ts 에서 못 찾았다`);
  return [...m[1]!.matchAll(/^\s*(\w+)\??:/gm)].map((x) => x[1]!);
}

describe('출품 자료 키 — 화면 타입과 같다', () => {
  it('★ ArtworkItem 의 모든 키를 서버가 안다', () => {
    expect([...ARTWORK_KEYS].sort()).toEqual(interfaceKeys('ArtworkItem').sort());
  });
  it('★ ArtistCv 의 모든 키를 서버가 안다', () => {
    expect([...CV_TEXT_KEYS, ...CV_LIST_KEYS].sort()).toEqual(interfaceKeys('ArtistCv').sort());
  });
  it('★ ArtistNote 의 모든 키를 서버가 안다', () => {
    expect([...NOTE_KEYS].sort()).toEqual(interfaceKeys('ArtistNote').sort());
  });
});

describe('쓸 때', () => {
  it('화면이 보내는 모양 그대로 통과하고 키 순서를 바꾸지 않는다', () => {
    const art = { image: '/uploads/a.jpg', title: 't', size: '1×1 cm', width: '1', height: '1', medium: 'm', year: '2026', price: '1', draft: false };
    const cv = { nameKo: '홍', nameEn: '', birth: '', tel: '', email: '', education: [{ year: '', content: 'x' }], solo: [], group: [], artFair: [], award: [] };
    const r = parseSubmissionBody({ artworkList: [art], cv, note: { statement: 's', sections: [{ title: 't', body: 'b' }] }, representativeIndex: 0 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(JSON.stringify(r.data.artworkList)).toBe(JSON.stringify([art]));
      expect(JSON.stringify(r.data.cv)).toBe(JSON.stringify(cv));
    }
  });
  it('사람이 읽을 문구로 거절한다', () => {
    const bad = parseSubmissionBody({ artworkList: [{ title: 'a', image: 'javascript:alert(1)' }] });
    expect(bad).toEqual({ ok: false, error: '출품 목록: 작품 사진 주소가 올바르지 않습니다.' });
    const type = parseSubmissionBody({ cv: { solo: 'x' } });
    expect(type).toEqual({ ok: false, error: '약력: 형식이 올바르지 않습니다.' });
  });
});

describe('읽을 때 — 이상한 값이 와도 던지지 않는다', () => {
  it('객체가 아닌 작품은 버리고, 칸은 글자로 바꾼다', () => {
    expect(readArtworkList([{ title: 5, image: { a: 1 }, price: [], draft: 'y' }, null, 'str', 7])).toEqual([{ title: '5', image: '', price: '' }]);
    expect(readArtworkList('not-array')).toEqual([]);
  });
  it('약력·노트가 객체가 아니면 null, 목록이 아니면 빈 목록', () => {
    expect(readCv('plain')).toBeNull();
    expect(readCv({ nameKo: 1, solo: 'x', hack: 2 })).toEqual({ nameKo: '1', solo: [] });
    expect(readNote({ statement: 42, sections: [{ title: null, body: 3 }, 'x'] })).toEqual({ statement: '42', sections: [{ title: '', body: '3' }] });
  });
});
