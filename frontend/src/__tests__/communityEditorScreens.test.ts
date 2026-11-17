import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { POST_BLOCK_NODES, POST_MARKS } from '@/lib/postDoc';

/**
 * 커뮤니티 블로그형 글쓰기 (2026-11-13) — 화면 구조 가드. 소스를 읽어 확인한다(jsdom 은 레이아웃·청크를 못 본다).
 *
 * 지키는 것:
 *  ① 읽는 화면(목록·글)은 편집기(TipTap)를 받지 않는다 — 글을 읽는 사람 모두가 편집기 청크를 받게 된다
 *  ② 읽는 화면은 HTML 을 꽂지 않는다(dangerouslySetInnerHTML 금지) — 문서 JSON 을 React 요소로만 그린다(저장형 XSS 표면이 없다)
 *  ③ 편집기가 만드는 노드·서식은 읽는 화면이 전부 그린다 — 한쪽에만 더하면 쓴 것이 올린 뒤 사라진다
 *  ④ 글쓰기 화면은 Layout 밖(상단바·하단 탭바·팝업 없음), 편집기 청크는 PWA 미리받기에서 뺀다
 */
const root = path.resolve(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
/** 주석을 뺀 코드 — 설명 글에 옛 이름을 적어 둬도 가드가 걸리지 않게 */
const code = (rel: string) => read(rel)
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/\s\/\/ .*$/gm, '');

const READER_FILES = [
  'pages/CommunityPage.tsx',
  'pages/CommunityPostPage.tsx',
  'components/community/PostListItems.tsx',
  'components/post/PostBody.tsx',
  'components/post/PostImage.tsx',
  'components/post/PostGalleryLayout.tsx',
  'components/post/PostYoutube.tsx',
  'components/post/PostVideo.tsx',
  'components/post/PostPoll.tsx',
  'components/post/ProfilePopover.tsx',
  'components/shared/Pagination.tsx',
];

describe('읽는 화면', () => {
  it.each(READER_FILES)('★ %s — 편집기(TipTap·post-editor)를 import 하지 않는다', (f) => {
    const src = read(f);
    expect(src).not.toMatch(/from ['"]@tiptap\//);
    expect(src).not.toMatch(/from ['"]@\/components\/post-editor\//);
  });

  it.each(READER_FILES)('★ %s — dangerouslySetInnerHTML 을 쓰지 않는다', (f) => {
    // 주석의 경고 문구는 빼고 실제 속성만 본다
    expect(read(f)).not.toMatch(/dangerouslySetInnerHTML\s*=/);
  });

  it('★ 편집기가 만들 수 있는 블록·서식을 읽는 화면이 전부 그린다', () => {
    const body = read('components/post/PostBody.tsx');
    for (const n of POST_BLOCK_NODES) expect(body, `블록 ${n}`).toContain(`case '${n}'`);
    for (const m of POST_MARKS) expect(body, `서식 ${m}`).toContain(`case '${m}'`);
  });

  it('편집기의 직접 만든 노드 이름이 문서 규칙과 같다(figure·gallery·youtube·video·poll·callout)', () => {
    const ext = read('components/post-editor/extensions.ts');
    for (const n of ['figure', 'gallery', 'youtube', 'video', 'poll', 'callout']) {
      expect((POST_BLOCK_NODES as readonly string[]).includes(n)).toBe(true);
      expect(ext).toContain(`name: '${n}'`);
    }
  });

  it('쓰는 모양 = 보이는 모양 — 편집기와 읽는 화면이 같은 클래스(post-body)', () => {
    expect(read('components/post/PostBody.tsx')).toContain('post-body');
    expect(read('components/post-editor/PostEditor.tsx')).toContain("class: 'post-body'");
    expect(read('index.css')).toContain('.post-body');
  });
});

describe('글쓰기 화면', () => {
  it('★ 편집기는 글쓰기 화면에서만 lazy 로 받는다', () => {
    const page = read('pages/CommunityWritePage.tsx');
    expect(page).toMatch(/lazy\(\(\) =>\s*\n?\s*import\('@\/components\/post-editor\/PostEditor'\)/);
    expect(page).not.toMatch(/^import .*post-editor\/PostEditor/m);
  });

  it('★ /community/write · /community/:id/edit 는 Layout 밖이다(하단 탭바·팝업이 도구 막대·글 위에 뜨지 않게)', () => {
    const app = read('App.tsx');
    const start = app.indexOf('<Route element={<Layout />}>');
    expect(start).toBeGreaterThan(-1);
    // Layout 묶음이 닫히는 자리 — 같은 들여쓰기의 </Route>
    const end = app.indexOf('\n      </Route>', start);
    expect(end).toBeGreaterThan(start);
    for (const p of ['/community/write', '/community/:id/edit']) {
      const at = app.indexOf(`<Route path="${p}"`);
      expect(at, p).toBeGreaterThan(end);
    }
    // 읽는 화면은 Layout 안
    const read1 = app.indexOf('<Route path="/community/:id" element');
    expect(read1).toBeGreaterThan(start);
    expect(read1).toBeLessThan(end);
  });

  it('★ 편집기·자르기 청크는 PWA 미리받기에서 뺀다(글을 안 쓰는 설치자에게 받게 하지 않는다)', () => {
    const vite = read('../vite.config.ts');
    expect(vite).toContain("'**/PostEditor-*.js'");
    expect(vite).toContain("'**/CropDialog-*.js'");
  });

  it('★ 편집기 엔진(@tiptap/core)이 든 공용 청크도 이름을 붙여 뺀다 — 안 그러면 index-*.js 로 떨어져 모든 설치자가 410KB 를 받는다', () => {
    const vite = read('../vite.config.ts');
    expect(vite).toContain("'**/tiptap-*.js'");
    expect(vite).toMatch(/@tiptap\/core\/[\s\S]{0,40}'assets\/tiptap-\[name\]-\[hash\]\.js'/);
  });

  it('새 글은 글 화면의 "올렸어요" 줄이 알린다 — 알림(toast)을 겹쳐 띄우지 않는다', () => {
    const ed = read('components/post-editor/PostEditor.tsx');
    expect(ed).not.toMatch(/toast\.success\(postId \? '고쳤어요\.' : '올렸어요\.'\)/);
    expect(ed).toContain('justPublished: true');
  });
});

describe('2026-11-13 로컬 확인 뒤 고친 것', () => {
  it('★ 표지 고르기는 없다 — 표지(목록 그림)는 늘 첫 사진. 편집기·저장·사진 도구 어디에도 coverUrl·[표지로]가 없다', () => {
    for (const f of ['components/post-editor/PostEditor.tsx', 'components/post-editor/PhotoTools.tsx', 'components/post-editor/editorUi.ts', 'components/post-editor/postBackup.ts', 'pages/CommunityPostPage.tsx']) {
      const src = read(f);
      expect(src, f).not.toMatch(/coverUrl|syncEditorCover|getEditorCoverPick/);
      expect(src, f).not.toContain('표지로');
    }
  });

  it('★ [동영상]은 파일 — 유튜브 주소 넣는 창은 없다(유튜브는 빈 줄에 주소를 붙여 넣을 때만)', () => {
    const ed = read('components/post-editor/PostEditor.tsx');
    expect(ed).not.toContain("kind: 'video'");
    expect(ed).not.toContain('유튜브 영상 넣기');
    expect(ed).toMatch(/accept="video\//);
    expect(ed).toContain('handleVideos');
    // 붙여 넣은 유튜브 주소는 그대로 들어간다
    expect(ed).toContain("type: 'youtube'");
    const tb = code('components/post-editor/Toolbar.tsx');
    expect(tb).not.toContain('유튜브');
    expect(tb).toContain('동영상 넣기');
  });

  it('★ 인용 이름 — 인용구 · 강조 문장(옛 이름 "크게 인용"은 어디에도 없다)', () => {
    for (const f of ['components/post-editor/PostEditor.tsx', 'components/post-editor/Toolbar.tsx']) {
      const src = code(f);
      expect(src, f).not.toMatch(/크게 인용|label="인용"|'인용'\)/);
      expect(src, f).toContain('인용구');
      expect(src, f).toContain('강조 문장');
    }
  });

  it('★ 투표 — 도구 막대·[+]에 있고, 한 글에 하나(있으면 고치기), 표가 모인 투표만 잠근다(samePoll)', () => {
    const ed = read('components/post-editor/PostEditor.tsx');
    expect(ed).toContain('onPoll: openPoll');
    expect(ed).toContain("item('투표'");
    expect(ed).toMatch(/const cur = findPoll\(ed\)/);
    expect(ed).toContain('samePoll(lockedPoll.current');
    // 붙여 넣어 투표가 둘이 되지 않게
    expect(ed).toContain('transformPasted:');
    expect(read('components/post-editor/Toolbar.tsx')).toContain('투표 넣기');
  });

  it('★ 댓글 @멘션은 없다 — 답글이 그 일을 한다(글 화면에 멘션 입력이 없다)', () => {
    const page = read('pages/CommunityPostPage.tsx');
    expect(page).not.toMatch(/MentionSuggest|useMention/);
    expect(page).not.toContain('@로 이웃');
    expect(page).toContain('replyTo: to');
    expect(page).toContain('삭제된 댓글입니다');
    expect(page).toContain('님에게');
  });

  it('★ 이름·사진을 누르면 프로필 카드 — 이름 버튼을 렌더 안에서 컴포넌트로 만들지 않는다(다시 그릴 때마다 단추가 바뀌어 카드가 엉뚱한 데 뜬다)', () => {
    const page = read('pages/CommunityPostPage.tsx');
    expect(page).toContain('<ProfilePopover');
    expect(page).toMatch(/^function PersonName\(/m);
    expect(page).toMatch(/^function PersonFace\(/m);
    // 본문 함수 안에서 const X = (...) => <JSX> 식 컴포넌트를 만들지 않는다
    expect(page).not.toMatch(/\n {2}const [A-Z][A-Za-z]* = \(\{/);
    const pop = code('components/post/ProfilePopover.tsx');
    expect(pop).toContain('role="dialog"');
    expect(pop).toContain('홈페이지 보기');
    expect(pop).toContain('FollowButton');
    expect(pop).not.toMatch(/메시지|\/chats\/direct/);
  });

  it('★ 알림으로 오면(?comment=) 그 댓글로 내려가고, 주소에서 뗀다', () => {
    const page = read('pages/CommunityPostPage.tsx');
    expect(page).toContain("params.get('comment')");
    expect(page).toContain('data-comment-id');
    expect(page).toContain("p.delete('comment')");
    expect(page).toContain('scrollToTarget');
  });

  it('★ 목록은 페이지 번호 — [더 보기]·무한 쿼리가 없다, 쪽은 주소(?page=)에', () => {
    const page = read('pages/CommunityPage.tsx');
    expect(page).not.toMatch(/useInfiniteQuery|fetchNextPage|'더 보기'|>더 보기</);
    expect(page).toContain('<Pagination');
    expect(page).toContain("searchParams.get('page')");
    expect(page).toContain("['community', sort, scope, tab, page]");
  });
});

describe('탭 관리', () => {
  it('탭마다 누가 쓰나·목록 모양·익명·소개를 고르고, 필진을 관리한다', () => {
    const tm = read('components/community/TabManager.tsx');
    for (const s of ['writePolicy', 'layout', 'allowAnonymous', 'description', '/community/writers']) expect(tm).toContain(s);
  });
});
