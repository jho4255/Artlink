/**
 * 알림이 **누구에게 가느냐에 따라 다른 화면**을 가리켜야 한다 (lib/notifyLinks.ts).
 *
 * 2026-08-27 작가의 운영페이지 접근을 없애면서 링크를 갈아끼웠는데, 그때 갤러리 오너에게 가는
 * 정산 재촉 알림까지 작가 링크로 바꿔버렸다(테스트가 잡았다). 같은 실수를 다시 하지 않도록
 * **소스에 날 문자열이 남지 않았는지** 그리고 **받는 사람과 링크가 맞는지**를 함께 못 박는다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ARTIST_EXHIBITION_LINK, artistExhibitionLink, operationLink } from '../lib/notifyLinks';

const read = (rel: string) => readFileSync(resolve(__dirname, '..', rel), 'utf-8');

describe('notifyLinks', () => {
  it('작가 링크는 마이페이지 [내 전시] 탭이다', () => {
    expect(ARTIST_EXHIBITION_LINK).toBe('/mypage?tab=applications');
  });

  it('★ 어느 전시인지 아는 알림은 그 전시를 열어둔 채로 보낸다 (?ex=)', () => {
    // 프론트 ApplicationsSection 이 ?ex= 를 읽어 해당 카드를 펼치고 그 탭으로 전환한다.
    // 이 형식이 바뀌면 알림을 눌러도 목록만 열리고 사용자가 다시 찾아 눌러야 한다.
    expect(artistExhibitionLink(42)).toBe('/mypage?tab=applications&ex=42');
    expect(artistExhibitionLink('42')).toBe('/mypage?tab=applications&ex=42');
  });

  it('운영자 링크는 그 공모의 운영페이지다', () => {
    expect(operationLink(7)).toBe('/exhibitions/7/operation/new');
    expect(operationLink('7')).toBe('/exhibitions/7/operation/new');
  });

  it('★ 알림 코드에 운영페이지 주소를 직접 적지 않는다 (헬퍼로만)', () => {
    // 날 문자열이 남아 있으면 다음에 링크 정책이 바뀔 때 이 파일들만 조용히 옛 주소로 남는다
    for (const rel of ['routes/operation.ts', 'routes/exhibition.ts', 'lib/settlementReminder.ts']) {
      const src = read(rel);
      const raw = [...src.matchAll(/linkUrl:\s*`\/exhibitions\/\$\{[^}]+\}\/operation\/new`/g)];
      expect(raw.map(m => m[0]), `${rel} 에 날 주소가 남아 있다`).toEqual([]);
    }
  });

  it('★ 정산 재촉은 갤러리 오너에게 가므로 운영페이지 링크다', () => {
    // "판매·정산 내역을 입력해주세요" 는 갤러리가 할 일이다. 여기를 작가 링크로 바꾸면
    // 오너가 자기 마이페이지 [내 전시](작가 전용 탭)로 튕겨 아무것도 못 한다.
    const src = read('lib/settlementReminder.ts');
    expect(src).toContain('operationLink(ex.id)');
    expect(src).not.toContain('artistExhibitionLink');
  });

  it('★ 작가가 정산에 이의를 제기하면 오너에게 가는 알림은 운영페이지 링크다', () => {
    const src = read('routes/operation.ts');
    const i = src.indexOf("type: 'SETTLEMENT_ISSUE'");
    expect(i, 'SETTLEMENT_ISSUE 알림이 사라졌다면 이 테스트를 고쳐야 한다').toBeGreaterThan(0);
    const block = src.slice(i, i + 400);
    expect(block).toContain('operationLink(');
    expect(block).not.toContain('artistExhibitionLink');
  });

  it('★ 작가에게 가는 정산·자료 알림은 마이페이지 링크다', () => {
    const src = read('routes/operation.ts');
    for (const type of ['OPERATION_NOTICE', 'SETTLEMENT_CONFIRM_REQUEST', 'SETTLEMENT_SHARED']) {
      const i = src.indexOf(`type: '${type}'`);
      expect(i, `${type} 알림을 못 찾았다`).toBeGreaterThan(0);
      expect(src.slice(i, i + 400), `${type} 는 작가에게 간다`).toContain('artistExhibitionLink(');
    }
  });

  it('★ 지원 수락 알림도 마이페이지로 (거절은 공모 상세 그대로)', () => {
    const src = read('routes/exhibition.ts');
    expect(src).toContain('accepted ? artistExhibitionLink(exhibitionId) : `/exhibitions/${exhibitionId}`');
  });
});
