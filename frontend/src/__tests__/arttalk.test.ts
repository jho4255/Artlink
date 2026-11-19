/**
 * ArtTalk 개편(2026-11-19) — 캐시 규칙과 화면 소스 가드.
 * 계획 `scratchpad/arttalk-renewal/PLAN.md` · 서버 쪽은 backend `chat-renewal.test.ts`.
 *
 * 사용자 신고: "갤러리 계정으로 작가 홈페이지에서 문의를 보냈는데 ArtTalk 에 아무것도 없다가 한참 뒤에 나타났다."
 * 원인은 캐시였다 — 보낸 뒤 대화 목록을 무효화하지 않았고, 목록 쿼리가 전역 staleTime 5분이었다. 그 길이 다시 생기지 않게 막는다.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { QueryClient } from '@tanstack/react-query';
import { chatRead, chatsChanged, pokeChat, CHAT_POKE_EVENT, readChatDraft, writeChatDraft, clearChatDrafts } from '@/lib/chatCache';
import { isChatRoomPath, CHAT_WIDE_MEDIA } from '@/hooks/useChatBare';
import { MYPAGE_TOP_LINKS, MYPAGE_FOOTER_LINKS } from '@/lib/myPageMenu';

const SRC = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');
const code = (rel: string) => read(rel).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) { if (n !== '__tests__') walk(p, out); } else if (/\.(ts|tsx)$/.test(n)) out.push(p);
  }
  return out;
}

describe('캐시 규칙 — lib/chatCache.ts', () => {
  let qc: QueryClient;
  beforeEach(() => { qc = new QueryClient(); });

  it('★ chatsChanged — 대화 목록과 상단 배지를 다시 받게 한다', () => {
    const inv = vi.spyOn(qc, 'invalidateQueries');
    chatsChanged(qc);
    expect(inv.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey))).toEqual(['["chats"]', '["chat-unread"]']);
  });

  it('★ chatRead — 목록의 그 방 안 읽은 수를 곧바로 0 · 배지·벨 숫자는 다시 받는다(예전엔 27초 남았다)', () => {
    qc.setQueryData(['chats'], [{ id: 1, unread: 3 }, { id: 2, unread: 5 }]);
    const inv = vi.spyOn(qc, 'invalidateQueries');
    chatRead(qc, 1);
    expect(qc.getQueryData(['chats'])).toEqual([{ id: 1, unread: 0 }, { id: 2, unread: 5 }]);
    expect(inv.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey))).toEqual(['["chat-unread"]', '["unread-count"]', '["notifications"]']);
  });

  it('pokeChat — 열린 방에 지금 받으라고 알린다', () => {
    const got: unknown[] = [];
    const on = (e: Event) => got.push((e as CustomEvent).detail);
    window.addEventListener(CHAT_POKE_EVENT, on);
    pokeChat(7); pokeChat(null);
    window.removeEventListener(CHAT_POKE_EVENT, on);
    expect(got).toEqual([{ chatId: 7 }, { chatId: null }]);
  });

  it('방마다 쓰던 글 — 이 탭에 남고, 로그아웃하면 지운다', () => {
    writeChatDraft(3, '쓰던 글');
    writeChatDraft(4, '다른 방');
    expect(readChatDraft(3)).toBe('쓰던 글');
    writeChatDraft(4, '');
    expect(readChatDraft(4)).toBe('');
    sessionStorage.setItem('다른-키', 'x');
    clearChatDrafts();
    expect(readChatDraft(3)).toBe('');
    expect(sessionStorage.getItem('다른-키')).toBe('x');
  });
});

describe('★ ArtTalk 밖에서 /chats 에 쓰는 화면은 대화 목록을 다시 받게 한다(2026-11-19 신고)', () => {
  it('`/chats/…` 로 POST·PATCH 하는 파일은 전부 chatCache 를 쓴다', () => {
    const offenders = walk(SRC)
      .filter((f) => /api\.(post|patch|delete)(<[^>]*>)?\(\s*[`'"]\/chats\//.test(code(f.slice(SRC.length + 1))))
      .filter((f) => !/from '@\/lib\/chatCache'|from '\.\/chatCache'/.test(read(f.slice(SRC.length + 1))))
      .map((f) => f.slice(SRC.length + 1));
    // 방 화면(ChatRoom)은 알림·숨기기 결과를 캐시에 직접 써 넣고, 보내기는 useChatRoom 이 한다
    expect(offenders).toEqual([]);
  });

  it('대화 목록 쿼리는 들어올 때마다 다시 받는다(전역 staleTime 5분을 쓰지 않는다)', () => {
    const page = code('pages/MessagesPage.tsx');
    expect(page).toMatch(/queryKey: \['chats'\][\s\S]{0,200}staleTime: 0,[\s\S]{0,80}refetchOnMount: 'always',[\s\S]{0,60}refetchOnWindowFocus: true/);
  });

  it('문의 창은 보낸 뒤 chatsChanged 를 부른다', () => {
    expect(code('components/homepage/InquirySheet.tsx')).toMatch(/await api\.post\(`\/chats\/\$\{chat\.id\}\/messages`[\s\S]{0,120}chatsChanged\(qc\);/);
  });
});

describe('화면 구조 — 소스 가드', () => {
  it('휴대폰 대화 전용 화면 판정 — /messages?chat=<id> · 1024px 미만(MessagesPage 와 같은 경계)', () => {
    expect(isChatRoomPath('/messages', '?chat=12')).toBe(true);
    expect(isChatRoomPath('/messages/', '?chat=12')).toBe(true);
    expect(isChatRoomPath('/messages', '')).toBe(false);
    expect(isChatRoomPath('/messages', '?chat=abc')).toBe(false);
    expect(isChatRoomPath('/mypage', '?chat=12')).toBe(false);
    expect(CHAT_WIDE_MEDIA).toBe('(min-width: 1024px)');
    expect(code('pages/MessagesPage.tsx')).toContain('useMediaQuery(CHAT_WIDE_MEDIA)');
    expect(code('components/layout/Layout.tsx')).toContain('const chatBare = useChatBare();');
  });

  it('★ 두 배치를 CSS 로 둘 다 그리지 않는다 · 방은 key 로 갈아끼운다(앞 방의 말이 남지 않게)', () => {
    const page = code('pages/MessagesPage.tsx');
    expect(page).toMatch(/if \(!wide\) \{/);
    expect(page).not.toMatch(/hidden md:block|hidden lg:block|md:hidden|lg:hidden/);
    expect(page.match(/<(ChatRoom|MobileRoom) key=\{openId\}/g)?.length).toBe(2);
  });

  it('★ [←] 는 기록을 쌓지 않는다 — 목록에서 왔으면 되돌리고, 아니면 목록으로 바꿔 끼운다', () => {
    const page = code('pages/MessagesPage.tsx');
    expect(page).toMatch(/fromList\?: boolean[\s\S]{0,60}\)\?\.fromList\) navigate\(-1\);\s*else navigate\('\/messages', \{ replace: true \}\);/);
    expect(page).toMatch(/wide \? \{ replace: true \} : \{ state: \{ fromList: true \} \}/);
    // 넓은 화면은 기록을 쌓지 않으므로 navigate(-1) 이면 ArtTalk 밖으로 나간다 — 다음 방으로 바꿔 끼운다(숨기기에서 실제로 났다)
    const back = page.slice(page.indexOf('const back = () =>'), page.indexOf('const back = () =>') + 900);
    expect(back).toMatch(/if \(wide\) \{[\s\S]*?navigate\(next \?[\s\S]*?\{ replace: true \}\);\s*return;/);
    expect(back.indexOf('if (wide)')).toBeLessThan(back.indexOf('navigate(-1)'));
  });

  it('★ 입력 칸은 여러 줄 — 한글 조합 중 Enter 는 건드리지 않는다 · 휴대폰 Enter 는 줄바꿈 · 글자 16px', () => {
    const c = code('components/chat/Composer.tsx');
    expect(c).toContain('<textarea');
    expect(c).not.toMatch(/<input\s[^>]*value=\{text\}/);
    expect(c).toMatch(/e\.nativeEvent\.isComposing \|\| e\.keyCode === 229\) return;/);
    expect(c).toMatch(/if \(fine && !e\.shiftKey\) \{ e\.preventDefault\(\); submit\(\); \}/);
    expect(c).toContain('text-[16px]');
    // 말없이 자르지 않는다 — 넘치면 [보내기]만 잠근다
    expect(c).not.toMatch(/slice\(0, (2000|CHAT_MAX_LEN)\)/);
  });

  it('남이 쓴 글을 HTML 로 넣지 않는다 — 주소는 토막 내 그린다', () => {
    for (const f of ['components/chat/MessageBubble.tsx', 'components/chat/ChatRoom.tsx', 'components/chat/ChatList.tsx', 'components/admin/ChatReportsSection.tsx']) {
      expect(code(f), f).not.toContain('dangerouslySetInnerHTML');
    }
    expect(code('components/chat/MessageBubble.tsx')).toContain('linkParts(text)');
  });

  it('위로 올려 읽는 중엔 끌어내리지 않는다 — [새 메시지 N] · 내가 보낸 말은 늘 내려간다', () => {
    const l = code('components/chat/MessageList.tsx');
    expect(l).toMatch(/const follow = nearBottom\.current \|\| mineNew;/);
    expect(l).toContain('새 메시지 {unseen > 99');
  });

  it('★ 방 메뉴·신고·참여자·이웃 고르기는 ChatSheet(role=dialog · Esc) — 앱 뒤로가기가 창만 닫는다', () => {
    for (const f of ['components/chat/RoomSheets.tsx', 'components/chat/NeighborPicker.tsx']) {
      expect(code(f), f).toMatch(/<ChatSheet /);
      expect(code(f), f).not.toMatch(/createPortal\(/);
    }
  });

  it('얼굴은 이름 첫 글자 — 프로필 사진(대개 카카오)을 대화에 쓰지 않는다(결정 D4)', () => {
    const a = code('components/chat/ChatAvatar.tsx');
    expect(a).not.toMatch(/person\.avatar|\.avatar\}/);
    expect(a).toMatch(/Array\.from\(name\)\[0\]/);
  });

  it('갤러리 [관심 작품] 카드에는 [전시 초대]도 [문의하기]도 없다(2026-11-19 사용자 결정)', () => {
    const my = code('pages/MyPage.tsx');
    const sec = my.slice(my.indexOf('function ArtworkScrapsSection'), my.indexOf('function ArtworkScrapsSection') + 3000);
    expect(sec).not.toMatch(/전시 초대|문의하기|InviteModal/);
    expect(my).not.toMatch(/ExhibitionInviteModal|received-invites|InviteApplyModal/);
  });
});

describe('메뉴 자리 — ArtTalk 맨 위 · 1:1 문의는 로그아웃 줄(2026-11-19 사용자 결정, PC·휴대폰 같다)', () => {
  it('맨 위 링크는 ArtTalk(말풍선 · 안 읽은 대화 수) · 맨 아래 줄은 1:1 문의', () => {
    expect(MYPAGE_TOP_LINKS.map((l) => [l.to, l.badge, l.brand?.join('')])).toEqual([['/messages', 'chat', 'ArtTalk']]);
    expect(MYPAGE_FOOTER_LINKS.map((l) => l.to)).toEqual(['/support']);
  });

  it('PC 오른쪽 메뉴 — ArtTalk 이 MY PAGE 보다 위 · [1:1 문의]와 [로그아웃]이 한 줄', () => {
    const side = code('components/layout/MyPageSideMenu.tsx');
    expect(side.indexOf('MYPAGE_TOP_LINKS.map')).toBeLessThan(side.indexOf('My Page'));
    expect(side).toMatch(/MYPAGE_FOOTER_LINKS\.map[\s\S]{0,700}로그아웃/);
    expect(side).toContain("queryKey: ['chat-unread']");
  });

  it('휴대폰 [메뉴] — ArtTalk 맨 위 · 상단바에는 대화 아이콘이 없다(2026-11-19 사용자 결정 — 메뉴 맨 위에 생겼으니)', () => {
    const nav = code('components/layout/Navbar.tsx');
    expect(nav.indexOf('MYPAGE_TOP_LINKS.map')).toBeLessThan(nav.indexOf('My Page'));
    expect(nav).not.toMatch(/\bMail\b/);
    // 종 옆 말풍선(PC·휴대폰 두 벌)을 없앴다 — 새 메시지는 벨 알림(CHAT_MESSAGE)과 메뉴의 ArtTalk 숫자가 알린다
    expect(nav).not.toMatch(/aria-label="ArtTalk"/);
    expect(nav).not.toMatch(/navigate\('\/messages'\)/);
    expect(nav).toMatch(/link\.badge === 'chat' && unreadMsgCount > 0/);
  });
});
