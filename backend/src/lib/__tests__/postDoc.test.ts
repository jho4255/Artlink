import { describe, it, expect } from 'vitest';
import {
  sanitizePostDoc, applyAssetInfo, legacyToPostDoc, postDocText, readingMinutes, postExcerpt, postDocLede, safeLinkHref,
  postDocImageSrcs, POST_DOC_LIMITS,
} from '../postDoc';

/**
 * 커뮤니티 글 문서 (2026-11-13) — 허용 목록 검증. 화면은 이 JSON 을 그대로 그리므로 여기가 유일한 관문이다.
 */
const IMG = '/uploads/1762000000000-123.jpg';
const IMG2 = '/uploads/1762000000001-456.jpg';
const doc = (...content: unknown[]) => ({ type: 'doc', content });
const p = (...content: unknown[]) => ({ type: 'paragraph', content });
const t = (text: string, marks?: unknown[]) => (marks ? { type: 'text', text, marks } : { type: 'text', text });

describe('기본 구조', () => {
  it('문단·제목·목록·인용·구분선·줄바꿈이 그대로 남는다', () => {
    const r = sanitizePostDoc(doc(
      { type: 'heading', attrs: { level: 2 }, content: [t('제목')] },
      p(t('첫 줄'), { type: 'hardBreak' }, t('둘째 줄')),
      { type: 'bulletList', content: [{ type: 'listItem', content: [p(t('하나'))] }] },
      { type: 'orderedList', attrs: { start: 3 }, content: [{ type: 'listItem', content: [p(t('셋'))] }] },
      { type: 'blockquote', attrs: { variant: 'pull' }, content: [p(t('뽑은 말'))] },
      { type: 'horizontalRule' },
    ), 'publish');
    expect(r.doc.content.map((n) => n.type)).toEqual(['heading', 'paragraph', 'bulletList', 'orderedList', 'blockquote', 'horizontalRule']);
    expect(r.doc.content[3]!.attrs).toEqual({ start: 3 });
    expect(r.doc.content[4]!.attrs).toEqual({ variant: 'pull' });
    expect(r.text).toBe('제목\n\n첫 줄\n둘째 줄\n\n하나\n\n셋\n\n뽑은 말');
  });

  it('제목 단계는 2·3 만 — 그 밖은 2', () => {
    const r = sanitizePostDoc(doc({ type: 'heading', attrs: { level: 1 }, content: [t('a')] }), 'draft');
    expect(r.doc.content[0]!.attrs).toEqual({ level: 2 });
  });

  it('가운데 맞춤만 받는다(오른쪽·양쪽은 버림)', () => {
    const r = sanitizePostDoc(doc(
      { type: 'paragraph', attrs: { textAlign: 'center' }, content: [t('a')] },
      { type: 'paragraph', attrs: { textAlign: 'right' }, content: [t('b')] },
    ), 'draft');
    expect(r.doc.content[0]!.attrs).toEqual({ textAlign: 'center' });
    expect(r.doc.content[1]!.attrs).toBeUndefined();
  });

  it('목록 항목이 문단으로 시작하지 않으면 빈 문단을 앞에 넣는다(ProseMirror 규칙)', () => {
    const r = sanitizePostDoc(doc({ type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'bulletList', content: [{ type: 'listItem', content: [p(t('x'))] }] }] }] }), 'draft');
    expect(r.doc.content[0]!.content![0]!.content![0]!.type).toBe('paragraph');
  });

  it('빈 문서는 빈 문단 하나 — 작업본은 통과, 등록은 400', () => {
    expect(sanitizePostDoc(doc(), 'draft').doc.content).toEqual([{ type: 'paragraph' }]);
    expect(() => sanitizePostDoc(doc(p()), 'publish')).toThrow('내용을 입력해주세요.');
  });

  it('사진만 있는 글은 등록된다(글이 없어도)', () => {
    const r = sanitizePostDoc(doc({ type: 'figure', attrs: { src: IMG } }), 'publish');
    expect(r.images).toEqual([IMG]);
    expect(r.text).toBe('');
  });
});

describe('마크·링크', () => {
  it('허용한 마크만, 같은 마크는 한 번', () => {
    const r = sanitizePostDoc(doc(p(t('a', [{ type: 'bold' }, { type: 'bold' }, { type: 'code' }, { type: 'highlight' }, { type: 'textStyle', attrs: { color: 'red' } }]))), 'draft');
    expect(r.doc.content[0]!.content![0]!.marks).toEqual([{ type: 'bold' }, { type: 'highlight' }]);
  });

  it.each([
    ['javascript:alert(1)', null],
    ['data:text/html,x', null],
    ['//evil.example/x', null],
    ['/\\evil', null],
    ['https://artlink.cc/exhibitions/3', 'https://artlink.cc/exhibitions/3'],
    ['/exhibitions/3', '/exhibitions/3'],
    ['mailto:a@b.cc', 'mailto:a@b.cc'],
  ])('링크 %s → %s', (href, want) => {
    expect(safeLinkHref(href)).toBe(want);
    const r = sanitizePostDoc(doc(p(t('링크', [{ type: 'link', attrs: { href, target: '_self', class: 'x' } }]))), 'publish');
    const marks = r.doc.content[0]!.content![0]!.marks;
    if (want) expect(marks).toEqual([{ type: 'link', attrs: { href: want } }]);
    else expect(marks).toBeUndefined();   // 위험한 링크는 글자만 남긴다
  });
});

describe('사진', () => {
  it('우리 저장소 사진만 — 바깥 사진은 작업본에서 버리고 등록에서 400', () => {
    const ext = doc({ type: 'figure', attrs: { src: 'https://evil.example/a.jpg' } });
    expect(sanitizePostDoc(ext, 'draft').images).toEqual([]);
    expect(() => sanitizePostDoc(ext, 'publish')).toThrow('다른 사이트의 사진');
  });

  it('주소가 빈 사진(올리는 중)은 등록에서 400 — 말없이 빠진 채 올라가지 않게', () => {
    expect(() => sanitizePostDoc(doc(p(t('a')), { type: 'figure', attrs: { src: '' } }), 'publish')).toThrow('올라가는 중');
    expect(sanitizePostDoc(doc(p(t('a')), { type: 'figure', attrs: { src: '' } }), 'draft').doc.content).toHaveLength(1);
  });

  it('크기·설명·대체 글을 정리한다(모르는 크기는 본문 폭, 설명은 한 줄)', () => {
    const r = sanitizePostDoc(doc({ type: 'figure', attrs: { src: IMG, size: 'huge', caption: '  첫 줄\n둘째  ', alt: 'x'.repeat(500), onerror: 'x' } }), 'publish');
    expect(r.doc.content[0]!.attrs).toEqual({ src: IMG, width: null, height: null, alt: 'x'.repeat(POST_DOC_LIMITS.altChars), caption: '첫 줄 둘째', size: 'text', large: false });
  });

  it('모아 놓기 — 항목은 정리되고, 한 장만 남으면 그냥 사진이 된다', () => {
    const g = sanitizePostDoc(doc({ type: 'gallery', attrs: { layout: 'grid', items: [{ src: IMG }, { src: IMG2 }], caption: '둘' } }), 'publish');
    expect(g.doc.content[0]!.type).toBe('gallery');
    expect(g.images).toEqual([IMG, IMG2]);
    const one = sanitizePostDoc(doc({ type: 'gallery', attrs: { items: [{ src: IMG }, { src: 'https://x.example/a.jpg' }] } }), 'draft');
    expect(one.doc.content[0]!.type).toBe('figure');
  });

  it('같은 사진을 두 번 넣어도 목록에는 한 번', () => {
    const r = sanitizePostDoc(doc({ type: 'figure', attrs: { src: IMG } }, { type: 'figure', attrs: { src: IMG } }), 'publish');
    expect(r.images).toEqual([IMG]);
    expect(postDocImageSrcs(r.doc)).toEqual([IMG]);
  });

  it('치수·큰 썸네일은 사진 기록(서버) 값이 이긴다 — 받은 large 는 믿지 않는다', () => {
    const r = sanitizePostDoc(doc({ type: 'figure', attrs: { src: IMG, width: 10, height: 10, large: true } }, { type: 'figure', attrs: { src: IMG2, width: 400, height: 300, large: true } }), 'publish');
    const out = applyAssetInfo(r.doc, new Map([[IMG, { width: 2000, height: 1500 }]]));
    expect(out.content[0]!.attrs).toMatchObject({ width: 2000, height: 1500, large: true });
    expect(out.content[1]!.attrs).toMatchObject({ width: 400, height: 300, large: false });
  });
});

describe('영상·팁 상자·모르는 것', () => {
  it('유튜브는 id(11자)만 — 주소를 저장하지 않는다', () => {
    const r = sanitizePostDoc(doc({ type: 'youtube', attrs: { videoId: 'dQw4w9WgXcQ', src: 'https://evil' } }), 'publish');
    expect(r.doc.content[0]).toEqual({ type: 'youtube', attrs: { videoId: 'dQw4w9WgXcQ', caption: '' } });
    expect(() => sanitizePostDoc(doc({ type: 'youtube', attrs: { videoId: 'x"><script>' } }), 'publish')).toThrow('영상');
  });

  it('팁 상자는 문단·목록만 담는다', () => {
    const r = sanitizePostDoc(doc({ type: 'callout', attrs: { tone: 'warn' }, content: [p(t('팁')), { type: 'figure', attrs: { src: IMG } }] }), 'draft');
    expect(r.doc.content[0]).toEqual({ type: 'callout', attrs: { tone: 'tip' }, content: [p(t('팁'))] });
  });

  it('모르는 노드 — 작업본은 버리고 등록은 400', () => {
    const bad = doc(p(t('a')), { type: 'iframe', attrs: { src: 'https://x' } }, { type: 'codeBlock', content: [t('x')] });
    expect(sanitizePostDoc(bad, 'draft').doc.content).toHaveLength(1);
    expect(() => sanitizePostDoc(bad, 'publish')).toThrow('지원하지 않는');
  });

  it('제어 문자를 지우고 빈 글 노드는 버린다', () => {
    const r = sanitizePostDoc(doc(p(t('a\u0000b​c'), t(''))), 'draft');
    expect(r.doc.content[0]!.content).toEqual([t('abc')]);
  });

  it('문서가 아니면 — 작업본은 빈 문서, 등록은 400', () => {
    expect(sanitizePostDoc('<p>x</p>', 'draft').doc).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
    expect(() => sanitizePostDoc({ type: 'paragraph' }, 'publish')).toThrow('글 형식');
  });
});

describe('상한', () => {
  it('너무 큰 JSON 은 모드와 상관없이 413', () => {
    const big = doc(p(t('가'.repeat(POST_DOC_LIMITS.jsonChars))));
    expect(() => sanitizePostDoc(big, 'draft')).toThrow('너무 길어요');
  });

  it('글자 한도를 넘으면 400', () => {
    const many = doc(...Array.from({ length: 4 }, () => p(t('가'.repeat(8000)))));
    expect(() => sanitizePostDoc(many, 'draft')).toThrow('자까지');
  });

  it('너무 깊게 겹친 목록은 등록에서 400', () => {
    let node: unknown = p(t('x'));
    for (let i = 0; i < 10; i++) node = { type: 'bulletList', content: [{ type: 'listItem', content: [p(t('a')), node] }] };
    expect(() => sanitizePostDoc(doc(node), 'publish')).toThrow('깊게');
  });
});

describe('옛 글 · 글자 · 읽는 시간', () => {
  it('옛 글은 빈 줄로 문단, 한 줄바꿈은 hardBreak, 사진은 맨 아래 본문 폭', () => {
    const d = legacyToPostDoc('첫 문단\n둘째 줄\n\n둘째 문단', [IMG]);
    expect(d.content).toEqual([
      p(t('첫 문단'), { type: 'hardBreak' }, t('둘째 줄')),
      p(t('둘째 문단')),
      { type: 'figure', attrs: { src: IMG, width: null, height: null, alt: '', caption: '', size: 'text', large: false } },
    ]);
    // 서버 검증을 그대로 통과한다(고치기 화면이 이 문서로 시작한다)
    expect(sanitizePostDoc(d, 'publish').text).toBe('첫 문단\n둘째 줄\n\n둘째 문단');
  });

  it('글은 사진 설명을 빼고 뽑는다', () => {
    expect(postDocText({ content: [p(t('본문')), { type: 'figure', attrs: { caption: '설명' } }] as never })).toBe('본문');
  });

  it('읽는 시간 — 최소 1분, 사진은 한 장 10초', () => {
    expect(readingMinutes(0, 0)).toBe(1);
    expect(readingMinutes(2500, 0)).toBe(5);
    expect(readingMinutes(1000, 12)).toBe(4);
  });

  it('발췌는 한 줄로 140자', () => {
    expect(postExcerpt('a\n\nb')).toBe('a b');
    expect(postExcerpt('가'.repeat(200))).toHaveLength(141);
  });

  it('★ 리드 — 맨 바깥 문단만(소제목·목록·인용·팁 상자·사진 설명은 건너뛴다), 없으면 글 전체', () => {
    const h = (x: string) => ({ type: 'heading', attrs: { level: 2 }, content: [t(x)] });
    const li = (x: string) => ({ type: 'listItem', content: [p(t(x))] });
    const d = {
      content: [
        h('소제목'), p(t('첫 문단.')), { type: 'bulletList', content: [li('목록')] },
        { type: 'figure', attrs: { caption: '사진 설명' } }, { type: 'blockquote', content: [p(t('인용'))] },
        { type: 'callout', attrs: { tone: 'tip' }, content: [p(t('팁'))] }, p(t('둘째 문단.')),
      ],
    };
    expect(postDocLede(d as never)).toBe('첫 문단. 둘째 문단.');
    // 문단이 하나도 없으면 글 전체(목록만 쓴 글)
    expect(postDocLede({ content: [{ type: 'bulletList', content: [li('하나'), li('둘')] }] } as never)).toBe('하나 둘');
    // 줄바꿈(hardBreak)은 띄어쓰기로, 길면 140자에서 자른다
    expect(postDocLede({ content: [p(t('가'), { type: 'hardBreak' }, t('나'))] } as never)).toBe('가 나');
    expect(postDocLede({ content: [p(t('다'.repeat(100))), p(t('라'.repeat(100))), p(t('마'.repeat(100)))] } as never)).toHaveLength(141);
    expect(postDocLede(null)).toBe('');
  });

  it('★ 동영상 — 우리 저장소의 동영상 확장자만 · 사진 주소를 동영상 칸에 넣으면 400 · videos 에 순서대로', () => {
    const v = { type: 'video', attrs: { src: '/uploads/1762000000009-1.mp4', width: 1920, height: 1080, caption: ' 과정 ', extra: 'x' } };
    const s1 = sanitizePostDoc(doc(v, { ...v }), 'publish');
    expect(s1.videos).toEqual(['/uploads/1762000000009-1.mp4']);
    expect(s1.doc.content[0]).toEqual({ type: 'video', attrs: { src: '/uploads/1762000000009-1.mp4', width: 1920, height: 1080, caption: '과정' } });
    expect(s1.mediaCount).toBe(2);
    expect(() => sanitizePostDoc(doc({ type: 'video', attrs: { src: IMG } }), 'publish')).toThrow(/동영상/);
    expect(() => sanitizePostDoc(doc({ type: 'video', attrs: { src: 'https://evil.example/a.mp4' } }), 'publish')).toThrow(/다른 곳의 동영상/);
    // 작업본은 버리고 저장
    expect(sanitizePostDoc(doc({ type: 'video', attrs: { src: 'blob:x' } }, p(t('글'))), 'draft').doc.content).toHaveLength(1);
  });

  it('★ 투표 — 한 글에 하나 · 질문과 보기 둘 이상(올릴 때) · 보기 id 는 지키고 없으면 만든다 · 빈 보기는 올릴 때 뺀다', () => {
    const poll = (attrs: Record<string, unknown>) => ({ type: 'poll', attrs: { question: '고르기', options: [{ id: 'aaaa1', text: '하나' }, { id: 'bbbb2', text: '둘' }], ...attrs } });
    const s1 = sanitizePostDoc(doc(poll({ multiple: true, endsAt: '2099-01-01T00:00:00Z' })), 'draft');
    expect(s1.poll).toEqual({ question: '고르기', options: [{ id: 'aaaa1', text: '하나' }, { id: 'bbbb2', text: '둘' }], multiple: true, endsAt: null });   // 1년 넘는 마감은 버린다(작업본)
    expect(() => sanitizePostDoc(doc(poll({ endsAt: '2099-01-01T00:00:00Z' })), 'publish')).toThrow(/1년/);
    const s2 = sanitizePostDoc(doc(poll({ options: [{ text: '가' }, { id: 'aaaa1', text: '나' }, { id: 'aaaa1', text: '다' }, { id: 'cccc3', text: ' ' }] })), 'publish');
    expect(s2.poll!.options.map((o) => o.id)).toEqual(['o1', 'aaaa1', 'aaaa1x']);   // 없으면 만든다 · 겹치면 바꾼다 · 빈 보기는 뺀다
    expect(() => sanitizePostDoc(doc(poll({}), poll({})), 'publish')).toThrow('투표는 한 글에 하나만 넣을 수 있어요.');
    expect(sanitizePostDoc(doc(poll({}), poll({})), 'draft').doc.content).toHaveLength(1);
    expect(() => sanitizePostDoc(doc(poll({ question: ' ' })), 'publish')).toThrow('투표 질문을 써 주세요.');
    expect(() => sanitizePostDoc(doc(poll({ options: [{ id: 'aaaa1', text: '하나' }] })), 'publish')).toThrow(/2개 이상/);
    // 투표 질문은 글이다(검색·요약) — 보기는 아니다
    expect(postDocText(sanitizePostDoc(doc(p(t('본문')), poll({})), 'publish').doc)).toBe('본문\n\n고르기');
  });
});
