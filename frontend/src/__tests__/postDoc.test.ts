/**
 * 커뮤니티 글 문서(2026-11-13) — 화면 쪽 규칙. ⚠️ 노드·마크·값 목록은 서버 backend/src/lib/postDoc.ts 와 같아야 한다(여기서 소스를 읽어 대조).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as fe from '@/lib/postDoc';
import { balancedRows, galleryRows, imageRatio, imageSources, sizesFor, variantUrl } from '@/lib/postLayout';

const SERVER = readFileSync(join(__dirname, '../../../backend/src/lib/postDoc.ts'), 'utf8');
/** 서버 소스에서 `export const NAME = [ ... ] as const` 의 값 목록 */
function serverList(name: string): string[] {
  const m = SERVER.match(new RegExp(`export const ${name} = \\[([\\s\\S]*?)\\] as const`));
  if (!m) throw new Error(`서버에 ${name} 이 없다`);
  return [...m[1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!);
}
function serverLimit(key: string): number {
  const m = SERVER.match(new RegExp(`${key}:\\s*([\\d_]+)`));
  if (!m) throw new Error(`서버 한도 ${key} 가 없다`);
  return Number(m[1]!.replace(/_/g, ''));
}

describe('서버와 같은 목록', () => {
  it.each([
    'POST_BLOCK_NODES', 'POST_LIST_CHILD_NODES', 'POST_QUOTE_CHILD_NODES', 'POST_INLINE_NODES', 'POST_MARKS',
    'FIGURE_SIZES', 'GALLERY_LAYOUTS', 'QUOTE_VARIANTS', 'CALLOUT_TONES',
  ] as const)('%s', (name) => {
    expect([...fe[name]]).toEqual(serverList(name));
  });

  it.each(['textChars', 'images', 'galleryItems', 'titleChars', 'captionChars', 'altChars', 'videos', 'pollOptionsMin', 'pollOptionsMax', 'pollQuestionChars', 'pollOptionChars', 'pollMaxDays'] as const)('한도 %s', (key) => {
    expect(fe.POST_DOC_LIMITS[key]).toBe(serverLimit(key));
  });
});

describe('문서 다루기', () => {
  const t = (text: string) => ({ type: 'text', text });

  it('옛 글 → 문서는 서버와 같은 모양', () => {
    expect(fe.legacyToPostDoc('a\nb\n\nc', ['/uploads/1.jpg'])).toEqual({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [t('a'), { type: 'hardBreak' }, t('b')] },
        { type: 'paragraph', content: [t('c')] },
        { type: 'figure', attrs: { src: '/uploads/1.jpg', width: null, height: null, alt: '', caption: '', size: 'text', large: false } },
      ],
    });
    expect(fe.legacyToPostDoc('', [])).toEqual(fe.emptyPostDoc());
  });

  it('저장할 문서 — 올리는 중인 사진(src 없음)과 화면 전용 uploadId 를 뺀다', () => {
    const doc = {
      type: 'doc' as const,
      content: [
        { type: 'figure', attrs: { src: null, uploadId: 'u1' } },
        { type: 'figure', attrs: { src: '/uploads/a.jpg', uploadId: 'u2', caption: 'x' } },
        { type: 'gallery', attrs: { layout: 'row', items: [{ src: null, uploadId: 'u3' }, { src: '/uploads/b.jpg', uploadId: 'u4' }] } },
        { type: 'gallery', attrs: { items: [{ src: null, uploadId: 'u5' }] } },
      ],
    };
    const out = fe.savableDoc(doc);
    expect(out.content).toEqual([
      { type: 'figure', attrs: { src: '/uploads/a.jpg', caption: 'x' } },
      { type: 'gallery', attrs: { layout: 'row', items: [{ src: '/uploads/b.jpg' }] } },
    ]);
    expect(fe.pendingImageCount(doc)).toBe(3);
    expect(fe.savableDoc({ type: 'doc', content: [{ type: 'figure', attrs: { src: null } }] })).toEqual(fe.emptyPostDoc());
  });

  it('글·사진·빈 문서·읽는 시간', () => {
    const doc = { type: 'doc' as const, content: [{ type: 'heading', attrs: { level: 2 }, content: [t('제목')] }, { type: 'figure', attrs: { src: '/a.jpg', caption: '설명' } }, { type: 'paragraph', content: [t('본문')] }, { type: 'youtube', attrs: { videoId: 'x' } }] };
    expect(fe.postDocText(doc)).toBe('제목\n\n본문');
    expect(fe.postDocImages(doc).map((i) => i.src)).toEqual(['/a.jpg']);
    expect(fe.postDocMediaCount(doc)).toBe(2);
    expect(fe.isEmptyPostDoc(fe.emptyPostDoc())).toBe(true);
    expect(fe.isEmptyPostDoc({ content: [{ type: 'figure', attrs: { src: '/a.jpg' } }] })).toBe(false);
    expect(fe.readingMinutes(2500, 0)).toBe(5);
  });

  it.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10', 'dQw4w9WgXcQ'],
    ['youtu.be/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://youtube.com/shorts/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://m.youtube.com/embed/dQw4w9WgXcQ?x=1', 'dQw4w9WgXcQ'],
    ['dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://vimeo.com/123', null],
    ['https://youtube.com/watch?v=short', null],
    ['javascript:alert(1)', null],
  ])('유튜브 %s → %s', (url, id) => {
    expect(fe.parseYoutubeId(url)).toBe(id);
  });

  it.each([
    ['artlink.cc/exhibitions/3', 'https://artlink.cc/exhibitions/3'],
    ['/exhibitions/3', '/exhibitions/3'],
    ['a@b.cc', 'mailto:a@b.cc'],
    ['javascript:alert(1)', null],
    ['//evil.example', null],
    ['  ', null],
  ])('링크 입력 %s → %s', (raw, want) => {
    expect(fe.normalizeLinkInput(raw)).toBe(want);
  });
});

describe('사진 배치', () => {
  it('줄 나누기 — 고르게, 앞줄이 하나 더', () => {
    expect(balancedRows(7, 3)).toEqual([3, 2, 2]);
    expect(balancedRows(4, 3)).toEqual([2, 2]);
    expect(balancedRows(5, 4)).toEqual([3, 2]);
    expect(balancedRows(0, 3)).toEqual([]);
    expect(galleryRows([1, 2, 3, 4], 'row')).toEqual([[1, 2, 3, 4]]);
    expect(galleryRows([1, 2, 3, 4], 'grid')).toEqual([[1, 2], [3, 4]]);
    expect(galleryRows([1, 2, 3], 'slide')).toEqual([[1, 2, 3]]);
  });

  it('비율 — 모르면 4:3, 너무 길쭉한 건 묶는다', () => {
    expect(imageRatio({ width: 2000, height: 1000 })).toBe(2);
    expect(imageRatio({})).toBeCloseTo(4 / 3);
    expect(imageRatio({ width: 10000, height: 100 })).toBe(4);
  });

  it('글쓰기로 올린 사진은 srcset(t800·t1280·원본, 실제 폭 이하), 옛 사진은 t800 → 원본', () => {
    const big = imageSources({ src: '/uploads/1762000000000-1.jpg', width: 2000, height: 1500, large: true })!;
    expect(big.srcSet).toBe('/uploads/t800/1762000000000-1.jpg 800w, /uploads/t1280/1762000000000-1.jpg 1280w, /uploads/1762000000000-1.jpg 2000w');
    expect(big.fallback).toBe('/uploads/1762000000000-1.jpg');
    const small = imageSources({ src: '/uploads/1762000000000-2.jpg', width: 600, height: 400, large: true })!;
    expect(small.srcSet).toBe('/uploads/t800/1762000000000-2.jpg 600w');
    const legacy = imageSources({ src: 'https://img.artlink.cc/artlink/1762000000000-3.jpg', width: null, height: null })!;
    expect(legacy.srcSet).toBeUndefined();
    expect(legacy.src).toBe('https://img.artlink.cc/artlink/t800/1762000000000-3.jpg');
    expect(variantUrl('/uploads/a.jpg?x=1', 't1280')).toBe('/uploads/t1280/a.jpg?x=1');
  });

  it('sizes — 본문 680 · 넓게 1040 · 화면 폭', () => {
    expect(sizesFor('text')).toBe('(min-width: 740px) 680px, 100vw');
    expect(sizesFor('wide', 2)).toBe('(min-width: 1100px) 520px, 50vw');
    expect(sizesFor('full')).toBe('100vw');
  });
});
