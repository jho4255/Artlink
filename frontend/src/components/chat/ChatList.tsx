import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BellOff, ChevronRight, SquarePen, Search, X } from 'lucide-react';
import api from '@/lib/axios';
import {
  chatCounterpartOf, chatRoleTag, chatTitle, filterChats, listPreview, listTime, type ChatListTab,
} from '@/lib/chatView';
import type { ChatSummary } from '@/lib/chatTypes';
import { PersonAvatar, PosterAvatar } from './ChatAvatar';

/**
 * 대화 목록 (2026-11-19 개편 — 목업 ①⑥).
 *  · 머리: ArtTalk · [찾기] · [이웃에게 메시지]  ⚠️ '새 대화'·'대화 상대 검색' 같은 말을 쓰지 말 것(retiredApis.test.ts — 아무에게나 말 거는 길이 아니다).
 *    [찾기]는 **내 대화 목록 안에서만** 거른다.
 *  · 글자 탭: 전체 · 안 읽음 N · 1:1 · 공모 단체 (화면에서 거른다)
 *  · 줄: 얼굴 · 이름 + 역할(또는 '단체 N') · 시각 / 미리보기('나: …' · 단톡은 '보낸 사람: …') · 안 읽은 수(알림 끈 방은 회색)
 *  · 받기를 켠 작가·갤러리: 맨 위에 '비회원 문의' 한 줄(받은 문의가 있을 때만) → 마이페이지 [받은 문의]
 */
export default function ChatList({ chats, loading, myId, role, openId, wide, onOpen, onNeighbor }: {
  chats: ChatSummary[];
  loading: boolean;
  myId: number;
  role?: string;
  openId: number | null;
  wide: boolean;
  onOpen: (id: number) => void;
  onNeighbor: () => void;
}) {
  const [tab, setTab] = useState<ChatListTab>('all');
  const [q, setQ] = useState('');
  const [searching, setSearching] = useState(wide);
  const rows = filterChats(chats, tab, q, myId);
  const unreadRooms = chats.filter((c) => c.unread > 0).length;

  // 홈페이지 비회원 문의(규칙 82) — 받은 게 있을 때만 한 줄(마이페이지 [받은 문의]와 같은 쿼리 키라 한 번만 받는다)
  const { data: guest } = useQuery<{ unread: number; items: unknown[] }>({
    queryKey: ['homepage-inquiries'],
    queryFn: () => api.get('/homepage-inquiries/mine').then((r) => r.data),
    enabled: role === 'ARTIST' || role === 'GALLERY',
    staleTime: 60_000,
  });

  const TABS: [ChatListTab, string][] = [['all', '전체'], ['unread', '안 읽음'], ['direct', '1:1'], ['group', '공모 단체']];

  return (
    <section aria-label="대화 목록" className="flex min-h-0 flex-col" data-testid="chat-list">
      <div className={`flex items-center justify-between ${wide ? 'px-6 pt-6' : 'px-5 pt-5'} pb-1`}>
        <h1 className="font-serif text-2xl font-bold tracking-tight text-gray-900">Art<span className="text-accent">Talk</span></h1>
        <div className="flex items-center">
          {!wide && (
            <button type="button" onClick={() => { setSearching((v) => !v); setQ(''); }} aria-label="대화 찾기" aria-expanded={searching} className="grid h-11 w-11 place-items-center text-gray-900">
              {searching ? <X size={20} aria-hidden /> : <Search size={20} aria-hidden />}
            </button>
          )}
          <button type="button" onClick={onNeighbor} aria-label="이웃에게 메시지" title="이웃에게 메시지" className="grid h-11 w-11 place-items-center text-gray-900">
            <SquarePen size={20} aria-hidden />
          </button>
        </div>
      </div>

      {searching && (
        <label className={`${wide ? 'mx-6' : 'mx-5'} mb-1 mt-1 flex h-10 items-center gap-2 rounded-lg border border-gray-300 px-3 focus-within:border-gray-900`}>
          <Search size={16} aria-hidden className="shrink-0 text-gray-500" />
          <span className="sr-only">대화 찾기</span>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="이름 · 공모 찾기"
            autoFocus={!wide}
            className="min-w-0 flex-1 border-0 bg-transparent text-[16px] text-gray-900 outline-none placeholder:text-gray-500 lg:text-sm"
          />
        </label>
      )}

      <div role="tablist" aria-label="대화 종류" className={`flex gap-5 border-b border-gray-200 ${wide ? 'px-6' : 'px-5'}`}>
        {TABS.map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={`-mb-px h-11 border-b-2 text-sm ${tab === k ? 'border-gray-900 font-medium text-gray-900' : 'border-transparent text-gray-600 hover:text-gray-900'}`}
          >
            {label}{k === 'unread' && unreadRooms > 0 && <span className="ml-1 font-medium text-accent">{unreadRooms}</span>}
          </button>
        ))}
      </div>

      <div className={`min-h-0 flex-1 ${wide ? 'overflow-y-auto overscroll-contain' : ''}`}>
        {guest && guest.items.length > 0 && tab === 'all' && !q && (
          <Link to="/mypage?tab=received-inquiries" className={`flex items-center gap-3 border-b border-gray-100 py-3 hover:bg-gray-50 ${wide ? 'px-6' : 'px-5'}`}>
            <span className="min-w-0 flex-1 text-sm text-gray-900">비회원 문의</span>
            {guest.unread > 0 && <span className="rounded-full bg-accent px-1.5 text-[11px] font-bold leading-5 text-white">{guest.unread}</span>}
            <ChevronRight size={16} aria-hidden className="shrink-0 text-gray-500" />
          </Link>
        )}

        {loading && chats.length === 0 ? (
          <ul aria-hidden className="divide-y divide-gray-100">
            {[0, 1, 2].map((i) => <li key={i} className="h-[72px] animate-pulse bg-gray-50" />)}
          </ul>
        ) : chats.length === 0 ? (
          <div className={`py-14 text-center ${wide ? 'px-6' : 'px-5'}`}>
            <p className="text-sm text-gray-600">아직 대화가 없어요.</p>
            <div className="mt-4 flex justify-center gap-4 text-sm">
              <Link to="/artists" className="min-h-[44px] content-center text-gray-900 underline underline-offset-4">작가 둘러보기</Link>
              <Link to="/exhibitions" className="min-h-[44px] content-center text-gray-900 underline underline-offset-4">모집공고 보기</Link>
            </div>
          </div>
        ) : rows.length === 0 ? (
          <p className={`py-10 text-center text-sm text-gray-600 ${wide ? 'px-6' : 'px-5'}`}>{q ? '찾는 대화가 없어요.' : tab === 'unread' ? '안 읽은 대화가 없어요.' : '대화가 없어요.'}</p>
        ) : (
          <ul>
            {rows.map((c) => {
              const other = chatCounterpartOf(c, myId);
              const tag = c.kind === 'GROUP' ? `단체 ${c.participants.length}` : chatRoleTag(other?.role);
              const unread = c.unread > 0;
              const current = openId === c.id;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => onOpen(c.id)}
                    aria-current={current ? 'true' : undefined}
                    data-chat-id={c.id}
                    className={`flex w-full items-center gap-3 border-b border-gray-100 py-3 text-left ${wide ? 'px-6' : 'px-5'} ${current ? 'bg-gray-100' : 'hover:bg-gray-50'}`}
                  >
                    {c.kind === 'GROUP' ? <PosterAvatar src={c.cover} size={48} /> : <PersonAvatar person={other} size={48} />}
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="flex items-baseline gap-1.5">
                        <span className={`truncate text-[15px] text-gray-900 ${unread ? 'font-bold' : 'font-medium'} ${other?.deleted ? 'text-gray-600' : ''}`}>{chatTitle(c, myId)}</span>
                        {tag && <span className="shrink-0 text-xs text-gray-600">{tag}</span>}
                        {c.muted && <BellOff size={12} aria-label="알림 꺼짐" className="shrink-0 self-center text-gray-500" />}
                        <span className="ml-auto shrink-0 pl-2 text-xs text-gray-600">{c.lastMessage ? listTime(c.lastMessage.createdAt) : listTime(c.lastMessageAt)}</span>
                      </span>
                      <span className="flex items-center gap-2">
                        <span className={`min-w-0 flex-1 truncate text-[13px] ${unread ? 'text-gray-900' : 'text-gray-600'}`}>{listPreview(c, myId) || ' '}</span>
                        {unread && (
                          <span className={`shrink-0 rounded-full px-1.5 text-[11px] font-bold leading-5 text-white ${c.muted ? 'bg-gray-500' : 'bg-accent'}`} aria-label={`안 읽은 메시지 ${c.unread}`}>
                            {c.unread > 99 ? '99+' : c.unread}
                          </span>
                        )}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
