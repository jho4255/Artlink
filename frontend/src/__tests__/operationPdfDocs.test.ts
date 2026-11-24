/**
 * 출품 자료 PDF · 작품 리스트 (2026-11-24, 규칙 92) — 글자가 살아 있는 PDF 로 바꾸며 다시 짰다.
 *
 * 예전(html2canvas 로 쪽을 그림 한 장으로) 실제로 겪은 것들을 그대로 고정한다:
 *  - 작가노트에 작품 사진이 빠졌다 → 작품별 설명은 그 작품의 사진·재료·크기와 함께
 *  - 표의 작품 사진이 찌그러졌다(CLAUDE.md 18) → 그림은 `fit`(비율 그대로)만, 폭·높이를 둘 다 주지 않는다
 *  - 약력이 줄 단위로 잘려 쪽을 넘었다 → 갈래(개인전…)마다 머리 줄을 headerRows 로
 *  - 출품리스트·약력·작가노트가 세 파일 → 작가마다 한 파일
 */
import { describe, it, expect } from 'vitest';
import { buildSubmissionDoc, dedupeYears } from '@/lib/galleryDocs/submissionDoc';
import { buildWorkListDoc, workGroups, workListImages, workListSheet } from '@/lib/galleryDocs/workList';
import { numberWorks } from '@/lib/galleryDocs/format';
import type { DocContext, SubmissionRowLike } from '@/lib/galleryDocs/types';
import { docText, fakeImg, imagesOf, nodesOf, textOf } from './docTestUtils';

const ctx: DocContext = { exTitle: '겹과 결', issuer: '갤러리 온', period: '2027. 3. 20 – 4. 6', issued: '2027. 4. 9.', contact: '02-123-4567' };

const cv = (o: Record<string, unknown> = {}) => ({
  nameKo: '', nameEn: '', birth: '', tel: '', email: '',
  education: [{ year: '2018', content: '예술대학 회화과 졸업' }],
  solo: [{ year: '2026', content: '개인전 「빛의 결」, 갤러리 온' }, { year: '2026', content: '개인전 「사이」' }],
  group: [], artFair: [{ year: '2025', content: '서울 아트페어' }],
  award: [{ year: '2026', content: '신진작가상' }],
  ...o,
});

const rowA: SubmissionRowLike = {
  user: { id: 11, name: '강윤서', nickname: null, email: 'a@b.c' },
  submission: {
    artworkList: [
      { image: '/uploads/a.jpg', title: '푸른 밤', size: '72.7x60.6cm', medium: 'acrylic on Canvas', year: '2026', price: '500000' },
      { image: '', title: '사진 없는 작품', size: '30×30 cm', medium: 'Oil', year: '2025', price: '비매' },
    ],
    cv: cv({ nameEn: 'Kang Yunseo', tel: '010-1111-2222' }),
    note: {
      statement: '제 작업은 도시의 빛을 다룹니다.\n\n둘째 문단입니다.',
      sections: [{ title: '푸른 밤', body: '이 작품은…' }, { title: '출품리스트에 없는 작품', body: '옛 데이터' }],
    },
    representativeIndex: 0,
  },
};
const rowB: SubmissionRowLike = {
  user: { id: 4, name: '박기량', nickname: 'kiryang', email: 'b@b.c' },
  guest: true,
  submission: { artworkList: [{ image: '/uploads/b.jpg', title: '여름', size: '', medium: '', year: '', price: '1,200,000' }], cv: null, note: null },
};

describe('출품 자료 PDF — 작가마다 한 파일', () => {
  const { numberOf } = numberWorks([rowA, rowB]);
  const doc = buildSubmissionDoc(ctx.exTitle, rowA, numberOf, fakeImg);
  const text = docText(doc);

  it('이름·영문 이름·연락처·출품 수 · 머리말과 꼬리말', () => {
    for (const s of ['강윤서', 'Kang Yunseo', '010-1111-2222 · a@b.c', '출품 2점', '겹과 결', '강윤서 · 출품 자료']) expect(text).toContain(s);
  });

  it('약력 다섯 갈래(학력·수상 포함) · 같은 해는 연도를 한 번만', () => {
    for (const s of ['학력', '예술대학 회화과 졸업', '개인전', '아트페어', '수상 및 선정', '신진작가상']) expect(text).toContain(s);
    expect(text).not.toContain('단체전');                      // 빈 갈래는 빠진다
    expect(dedupeYears(rowA.submission.cv!.solo).map((r) => r.year)).toEqual(['2026', '']);
    // 갈래마다 머리 줄을 headerRows 로(쪽이 넘어가도 머리만 끝에 남지 않는다)
    const cvTables = nodesOf(doc.content).filter((n) => (n.table as { headerRows?: number; widths?: unknown[] } | undefined)?.widths?.[0] === 34);
    expect(cvTables.length).toBe(4);
    expect(cvTables.every((n) => (n.table as { headerRows: number; keepWithHeaderRows: number }).headerRows === 1)).toBe(true);
  });

  it('작가노트 문단 · 작품별 설명은 그 작품의 사진·재료·크기와 함께(없는 제목은 글만)', () => {
    expect(text).toContain('제 작업은 도시의 빛을 다룹니다.');
    expect(text).toContain('둘째 문단입니다.');
    expect(text).toContain('작품별 설명');
    expect(text).toContain('Acrylic on canvas · 72.7 × 60.6 cm');   // 표기 정리는 문서에서만
    expect(text).toContain('옛 데이터');
    const sectionImgs = imagesOf(doc).filter((n) => Array.isArray(n.fit) && (n.fit as number[])[0] === 112);
    expect(sectionImgs.map((n) => n.image)).toEqual(['data:image/jpeg;mid;/uploads/a.jpg']);
  });

  it('출품 작품 표 — 전시 전체 번호 · 가격 표기 · 사진 없는 작품은 빈 칸', () => {
    const worksTable = (d: typeof doc) => nodesOf(d.content).find((n) => (n.table as { widths?: unknown[] } | undefined)?.widths?.[0] === 20)!.table as { body: unknown[][] };
    const rowsOf = (d: typeof doc) => worksTable(d).body.slice(1).map((r) => r.map(textOf));
    expect(rowsOf(doc)).toEqual([
      ['1', '', '푸른 밤', 'Acrylic on canvas', '72.7 × 60.6 cm', '2026', '500,000원'],
      ['2', '', '사진 없는 작품', 'Oil', '30 × 30 cm', '2025', '비매'],
    ]);
    // B 의 작품은 3번 — 작품 리스트·원본 파일 이름과 같은 전시 전체 번호
    expect(rowsOf(buildSubmissionDoc(ctx.exTitle, rowB, numberOf, fakeImg))[0]![0]).toBe('3');
    // 사진 칸: 있는 작품만 그림, 없는 작품은 빈 칸
    expect(worksTable(doc).body.slice(1).map((r) => typeof (r[1] as { image?: string }).image)).toEqual(['string', 'undefined']);
  });

  it('★ 그림은 비율 그대로 — fit 만 쓰고 폭·높이를 함께 주지 않는다(CLAUDE.md 18)', () => {
    const imgs = imagesOf(doc);
    expect(imgs.length).toBeGreaterThan(0);
    for (const n of imgs) {
      expect(Array.isArray(n.fit), JSON.stringify(n)).toBe(true);
      expect(n.width !== undefined && n.height !== undefined).toBe(false);
    }
  });

  it('비회원 작가 — 갤러리가 입력했다고 적고, 가짜 이메일을 싣지 않는다(규칙 91)', () => {
    const t = docText(buildSubmissionDoc(ctx.exTitle, rowB, numberOf, fakeImg));
    expect(t).toContain('비회원 작가 · 갤러리가 입력');
    expect(t).not.toContain('b@b.c');
    expect(t).toContain('kiryang');                             // 출품 자료에 이름이 없으면 화면에 보이던 이름
  });

  it('아무것도 안 냈으면 한 줄 안내', () => {
    const empty: SubmissionRowLike = { user: { id: 9, name: '빈 작가' }, submission: { artworkList: [], cv: null, note: null } };
    expect(textOf(buildSubmissionDoc('공모', empty, () => 0, fakeImg).content)).toContain('아직 낸 출품 자료가 없어요.');
  });
});

describe('작품 리스트 — PDF 와 엑셀', () => {
  const rows = [rowA, rowB];

  it('작가별 묶음 · 전시 전체 번호 · 가격 합계와 비매', () => {
    const groups = workGroups(rows);
    expect(groups.map((g) => [g.artist, g.guest, g.lines.map((l) => l.no)])).toEqual([['강윤서', false, [1, 2]], ['kiryang', true, [3]]]);
    const text = docText(buildWorkListDoc(ctx, rows, fakeImg));
    for (const s of ['작품 리스트', '갤러리 온', '발행 2027. 4. 9.', '2명', '3점', '1,700,000원', '비매', '1점', '비회원', '2점 · 500,000원 · 비매 1점']) {
      expect(text, s).toContain(s);
    }
  });

  it('묶음 머리는 쪽이 넘어가도 다시 나오고, 머리만 쪽 끝에 남지 않는다', () => {
    const doc = buildWorkListDoc(ctx, rows, fakeImg);
    const tables = nodesOf(doc.content).filter((n) => (n.table as { keepWithHeaderRows?: number } | undefined)?.keepWithHeaderRows === 1);
    expect(tables).toHaveLength(2);
    // 2쪽부터는 머리말에 표 머리가 다시 — 1쪽은 제목이 있어 없다
    const header = doc.header as (p: number) => unknown;
    expect(header(1)).toBeNull();
    expect(textOf(header(2))).toContain('작품명');
  });

  it('엑셀 — 가격은 숫자 칸, 숫자가 아니면 비고 · 비회원 표시', () => {
    const sheet = workListSheet(rows);
    expect(sheet.head).toEqual(['번호', '작가', '작품명', '연도', '재료', '크기', '가격(원)', '비고']);
    expect(sheet.rows).toEqual([
      [1, '강윤서', '푸른 밤', '2026', 'Acrylic on canvas', '72.7 × 60.6 cm', 500000, ''],
      [2, '강윤서', '사진 없는 작품', '2025', 'Oil', '30 × 30 cm', null, '비매'],
      [3, 'kiryang (비회원)', '여름', '', '', '', 1200000, ''],
    ]);
    expect(workListImages(rows)).toEqual(['/uploads/a.jpg', '/uploads/b.jpg']);
  });
});
