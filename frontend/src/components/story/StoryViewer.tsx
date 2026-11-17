/**
 * ArtStory 보기 화면 (2026-11-14, CLAUDE.md 규칙 81) — 홈 카드 줄 · [ArtStory] 격자 · 하이라이트가 같이 쓴다.
 *
 * 화면 가득(휴대폰) / 가운데 세로 창 9:16(PC) 으로 열리고 **저절로 넘어간다**.
 *  · 진행 막대 한 칸 = 사진 한 장(글만 소식은 한 칸). 사진 5초 · 글만 6.5초, 글이 길면 더(`slideDuration`).
 *    **사진이 다 뜬 뒤부터** 센다 — 느린 연결에서 빈 화면으로 5초를 쓰지 않게.
 *  · 한 소식이 끝나면 다음 사람 소식으로. 끝까지 보면 '새 소식을 다 봤어요'(endScreen).
 *  · 왼쪽 1/3 누르면 앞 칸, 나머지는 다음 칸. 누르고 있으면 멈춤. 옆으로 밀면 다음/앞 소식, 아래로 밀면 닫기.
 *  · PC: 양옆 화살표·앞뒤 소식 미리보기, 방향키, Space(멈춤), Esc. 댓글은 창 오른쪽에 붙는다.
 *  · 멈추는 때: 누르고 있을 때 · 댓글·메뉴·확인창이 열려 있을 때 · 탭이 가려졌을 때 · 사진을 받는 중 · '움직임 줄이기'(그땐 직접 넘긴다).
 *
 * ⚠️ 진행은 CSS 애니메이션 하나로 센다(`storyFill`, index.css) — 매 프레임 React 를 다시 그리지 않는다.
 *    멈춤은 `animation-play-state`, 다음 칸은 `animationend`.
 * ⚠️ 사진은 자르지 않는다(규칙 18). 남는 자리는 같은 사진을 흐리게.
 * ⚠️ `role="dialog" aria-modal` — 소개·홈페이지 팝업이 이 창 위로 뜨지 않고 기다리고, 앱 뒤로가기가 Esc 를 보낸다(규칙 79).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import {
  X, Heart, MessageCircle, Share2, MoreHorizontal, ChevronLeft, ChevronRight, Pause, Play, UserPlus, UserCheck, Users,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import Thumb from '@/components/shared/Thumb';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import { useAuthStore } from '@/stores/authStore';
import { setPostLoginRedirect } from '@/lib/postLoginRedirect';
import { shareLinkNative } from '@/lib/native';
import { timeAgo, roleLabel, apiErrorMessage } from '@/lib/utils';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useVisualViewport } from '@/hooks/useVisualViewport';
import type { StoryHighlight } from '@/types';
import {
  markStorySeen, nextPosition, overlayFor, prevPosition, readGesture, slideDuration, storyBgHex, storyPath, storySlides, textStorySize,
  STORY_REPORT_LABELS, STORY_REPORT_REASONS, type Story, type StoryReportReason,
} from '@/lib/story';
import StoryComments from './StoryComments';
import StoryPhoto from './StoryPhoto';
import { StoryAvatar } from './StoryCard';

type Sheet = null | 'comments' | 'more' | 'report' | 'login' | 'highlight' | 'text';
type LoginWhy = 'like' | 'comment' | 'follow' | 'report' | 'mute';
const LOGIN_LINES: Record<LoginWhy, string> = {
  like: '좋아요는 로그인하고 누를 수 있어요',
  comment: '댓글은 로그인하고 쓸 수 있어요',
  follow: '이웃 추가는 로그인하고 할 수 있어요',
  report: '신고는 로그인하고 할 수 있어요',
  mute: '로그인하고 쓸 수 있어요',
};

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

interface FollowStatus { following: boolean; followerCount: number; followingCount: number; isMe: boolean }

export interface StoryViewerProps {
  stories: Story[];
  startIndex?: number;
  /** 닫을 때 — 마지막으로 보던 자리(목록의 그 카드로 스크롤), 무언가 바뀌었나(목록을 다시 받을지) */
  onClose: (lastIndex: number, changed: boolean) => void;
  /** 알림(`comment=`)으로 왔다 — 댓글 창을 연 채로, 그 댓글로 */
  openComments?: boolean;
  focusCommentId?: number | null;
  /** 끝까지 보면 '새 소식을 다 봤어요'(홈 줄·격자). 하이라이트는 그냥 닫는다 */
  endScreen?: boolean;
  /** 다 본 화면의 [소식 올리기] */
  onCompose?: () => void;
  /** 머리 첫 줄을 바꾼다(하이라이트 이름) */
  title?: string;
  /** 머리에 덧붙일 단추(하이라이트 관리) — 지금 소식을 받는다 */
  headerExtra?: (story: Story) => ReactNode;
  /** 지금 보고 있는 소식이 바뀔 때 */
  onIndexChange?: (index: number, story: Story) => void;
  /** 확인창 등 바깥 창이 떠 있다 — 넘김을 멈춘다(하이라이트 관리 확인창) */
  holdExternal?: boolean;
}

export default function StoryViewer({
  stories, startIndex = 0, onClose, openComments = false, focusCommentId = null, endScreen = true, onCompose,
  title, headerExtra, onIndexChange, holdExternal = false,
}: StoryViewerProps) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuthStore();
  const isAdmin = user?.role === 'ADMIN';
  const wide = useMediaQuery('(min-width: 1024px)');
  const vv = useVisualViewport();

  const [list, setList] = useState<Story[]>(stories);
  const [pos, setPos] = useState(() => ({ i: Math.min(Math.max(0, startIndex), Math.max(0, stories.length - 1)), slide: 0 }));
  const [sheet, setSheet] = useState<Sheet>(openComments ? 'comments' : null);
  const [loginWhy, setLoginWhy] = useState<LoginWhy>('like');
  const [holding, setHolding] = useState(false);
  const [userPaused, setUserPaused] = useState(false);
  const [docHidden, setDocHidden] = useState(false);
  const [ended, setEnded] = useState(false);
  const [confirm, setConfirm] = useState<null | 'delete'>(null);
  const [replay, setReplay] = useState(0);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const [reduced] = useState(prefersReducedMotion);
  const changed = useRef(false);

  const cur: Story | undefined = list[pos.i];
  const slides = cur ? storySlides(cur) : 1;
  const slide = Math.min(pos.slide, slides - 1);
  const src = cur?.images[slide] ?? null;
  const loaded = !src || loadedSrc === src;
  const dur = cur ? slideDuration(cur, slide) : 5000;

  const close = useCallback(() => onClose(pos.i, changed.current), [onClose, pos.i]);

  // ── 넘기기 ──
  const go = useCallback((dir: 1 | -1) => {
    setEnded(false);
    if (dir === 1) {
      const nx = nextPosition(list.map(storySlides), pos.i, slide);
      if (nx) setPos(nx);
      else if (endScreen) setEnded(true);
      else close();
    } else {
      setPos(prevPosition(pos.i, slide));
      setReplay((r) => r + 1);   // 첫 칸에서 앞으로 가면 그 칸을 처음부터
    }
  }, [list, pos.i, slide, endScreen, close]);

  const jumpStory = useCallback((dir: 1 | -1) => {
    setEnded(false);
    const i = pos.i + dir;
    if (i < 0) { setPos({ i: 0, slide: 0 }); setReplay((r) => r + 1); return; }
    if (i >= list.length) { if (endScreen) setEnded(true); else close(); return; }
    setPos({ i, slide: 0 });
  }, [pos.i, list.length, endScreen, close]);

  // 본 소식 기억(이 기기만) · 바깥에 알림
  const curId = cur?.id;
  useEffect(() => {
    if (!cur) return;
    if (!cur.mine) markStorySeen(cur.id);
    onIndexChange?.(pos.i, cur);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curId]);

  // 사진을 다 받기 전에는 세지 않는다 — 8초가 지나도 안 오면 그냥 센다(멈춘 채로 남지 않게)
  useEffect(() => {
    if (!src || loaded) return;
    const t = window.setTimeout(() => setLoadedSrc(src), 8000);
    return () => window.clearTimeout(t);
  }, [src, loaded]);

  // 다음 칸·다음 소식 첫 장을 미리 받는다
  useEffect(() => {
    if (!cur) return;
    const urls = [cur.images[slide + 1], list[pos.i + 1]?.images[0]].filter(Boolean) as string[];
    for (const u of urls) { const im = new Image(); im.src = u; }
  }, [cur, slide, list, pos.i]);

  // 탭이 가려지면 멈춘다
  useEffect(() => {
    const on = () => setDocHidden(document.visibilityState === 'hidden');
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);

  // 뒤 페이지가 같이 스크롤되지 않게
  useEffect(() => {
    const html = document.documentElement;
    const prev = { b: document.body.style.overflow, h: html.style.overflow };
    document.body.style.overflow = 'hidden';
    html.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev.b; html.style.overflow = prev.h; };
  }, []);

  // 키보드 — 입력칸에 쓰는 중이면 건드리지 않는다. 이 창 위에 확인창이 떠 있으면 그쪽이 Esc 를 먹는다.
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    keyRef.current = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      const stacked = document.querySelectorAll('[role="dialog"][aria-modal="true"]').length > 1;
      if (e.key === 'Escape') {
        if (stacked || confirm) return;
        e.preventDefault();
        if (sheet) setSheet(null); else close();
        return;
      }
      if (typing || stacked || sheet) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
      else if (e.key === ' ') { e.preventDefault(); setUserPaused((p) => !p); }
    };
  });
  useEffect(() => {
    const on = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);

  const running = !!cur && loaded && !holding && !userPaused && !docHidden && !ended && !sheet && !confirm && !holdExternal && !reduced;

  // ── 손동작 ──
  // 짧게 누르기는 [이전]/[다음] 단추의 click 이 맡는다(키보드·화면 낭독기도 같은 단추로 넘긴다).
  // 여기는 누르고 있기(멈춤)·밀기만 — 밀었거나 오래 눌렀으면 뒤따르는 click 을 버린다.
  const touch = useRef<{ x: number; y: number; t: number; id: number } | null>(null);
  const swallowClick = useRef(false);
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    swallowClick.current = false;
    touch.current = { x: e.clientX, y: e.clientY, t: Date.now(), id: e.pointerId };
    setHolding(true);
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = touch.current;
    touch.current = null;
    setHolding(false);
    if (!s || s.id !== e.pointerId) return;
    const box = e.currentTarget.getBoundingClientRect();
    const g = readGesture({ dx: e.clientX - s.x, dy: e.clientY - s.y, ms: Date.now() - s.t, x: e.clientX - box.left, width: box.width });
    if (g === 'next' || g === 'prev') return;   // 단추가 받는다
    swallowClick.current = true;
    if (g === 'nextStory') jumpStory(1);
    else if (g === 'prevStory') jumpStory(-1);
    else if (g === 'close') close();
  };
  const onPointerCancel = () => { touch.current = null; setHolding(false); };
  const tap = (dir: 1 | -1) => {
    if (swallowClick.current) { swallowClick.current = false; return; }
    go(dir);
  };

  // ── 바꾸기(이 창 안의 목록) ──
  const patch = (id: number, fn: (s: Story) => Story) => setList((l) => l.map((s) => (s.id === id ? fn(s) : s)));
  const remove = (pred: (s: Story) => boolean) => {
    changed.current = true;
    const keep = list.filter((s) => !pred(s));
    if (keep.length === 0) { onClose(0, true); return; }
    // 지금 자리부터 뒤로, 남아 있는 첫 소식으로 간다(없으면 마지막)
    const after = list.slice(pos.i).find((s) => !pred(s));
    const ni = after ? keep.indexOf(after) : keep.length - 1;
    setList(keep);
    setPos({ i: ni, slide: 0 });
    setSheet(null);
  };
  const needLogin = (why: LoginWhy) => {
    if (isAuthenticated) return false;
    setLoginWhy(why);
    setSheet('login');
    return true;
  };

  const like = useMutation({
    mutationFn: (s: Story) => api.post(`/stories/${s.id}/like`).then((r) => r.data as { liked: boolean; likeCount: number }),
    onMutate: (s) => { changed.current = true; patch(s.id, (x) => ({ ...x, liked: !x.liked, likeCount: Math.max(0, x.likeCount + (x.liked ? -1 : 1)) })); },
    onSuccess: (d, s) => patch(s.id, (x) => ({ ...x, liked: d.liked, likeCount: d.likeCount })),
    onError: (_e, s) => { patch(s.id, (x) => ({ ...x, liked: !x.liked, likeCount: Math.max(0, x.likeCount + (x.liked ? -1 : 1)) })); toast.error('잠시 후 다시 해 주세요.'); },
  });

  // 이웃 — 로그인했고 남의 소식일 때만 상태를 묻는다(비회원은 묻지 않는다)
  const authorId = cur?.author.id;
  const showFollow = !!cur && !cur.mine;
  const { data: follow } = useQuery<FollowStatus>({
    queryKey: ['follow', authorId],
    queryFn: () => api.get(`/follow/${authorId}`).then((r) => r.data),
    enabled: isAuthenticated && showFollow && authorId != null,
  });
  const followMut = useMutation({
    mutationFn: (next: boolean) => (next ? api.post(`/follow/${authorId}`) : api.delete(`/follow/${authorId}`)).then((r) => r.data),
    onMutate: (next) => {
      const prev = qc.getQueryData<FollowStatus>(['follow', authorId]);
      qc.setQueryData<FollowStatus>(['follow', authorId], (s) => (s ? { ...s, following: next } : s));
      return { prev };
    },
    onError: (_e, _n, ctx) => { if (ctx?.prev) qc.setQueryData(['follow', authorId], ctx.prev); toast.error('잠시 후 다시 해 주세요.'); },
    onSettled: () => { qc.invalidateQueries({ queryKey: ['follow', authorId] }); qc.invalidateQueries({ queryKey: ['stories', 'neighbors'] }); },
  });

  const share = async (s: Story) => {
    const url = `${window.location.origin}${storyPath(s.id)}`;
    const t = `${s.author.name}님의 소식 — ArtStory`;
    if (await shareLinkNative(t, url)) return;
    try {
      if (navigator.share && window.matchMedia?.('(pointer: coarse)').matches) { await navigator.share({ title: t, url }); return; }
      await navigator.clipboard?.writeText(url);
      toast.success('링크를 복사했어요.');
    } catch { /* 공유 창을 닫았다 */ }
  };
  const copyLink = async (s: Story) => {
    try { await navigator.clipboard?.writeText(`${window.location.origin}${storyPath(s.id)}`); toast.success('링크를 복사했어요.'); }
    catch { toast.error('복사하지 못했어요.'); }
    setSheet(null);
  };

  const report = useMutation({
    mutationFn: ({ s, reason }: { s: Story; reason: StoryReportReason }) => api.post(`/stories/${s.id}/report`, { reason }).then(() => s),
    onSuccess: (s) => { toast.success('신고했어요. 운영자가 확인할게요.'); remove((x) => x.id === s.id); },
    onError: (e) => toast.error(apiErrorMessage(e, '신고하지 못했어요.')),
  });
  const mute = useMutation({
    mutationFn: (s: Story) => api.post(`/stories/mutes/${s.author.id}`).then(() => s),
    onSuccess: (s) => {
      const who = s.author;
      remove((x) => x.author.id === who.id);
      toast((tt) => (
        <span className="flex items-center gap-3 text-sm">
          {who.name}님 소식을 그만 봐요
          <button type="button" className="font-bold underline underline-offset-2"
            onClick={() => { toast.dismiss(tt.id); api.delete(`/stories/mutes/${who.id}`).then(() => { qc.invalidateQueries({ queryKey: ['stories'] }); qc.invalidateQueries({ queryKey: ['story-mutes'] }); }); }}>
            되돌리기
          </button>
        </span>
      ), { duration: 6000 });
      qc.invalidateQueries({ queryKey: ['story-mutes'] });
    },
    onError: (e) => toast.error(apiErrorMessage(e, '잠시 후 다시 해 주세요.')),
  });
  const del = useMutation({
    mutationFn: (s: Story) => api.delete(`/stories/${s.id}`).then(() => s),
    onSuccess: (s) => { toast.success('삭제했어요.'); qc.removeQueries({ queryKey: ['story', s.id] }); qc.invalidateQueries({ queryKey: ['highlights'] }); remove((x) => x.id === s.id); },
    onError: () => toast.error('삭제하지 못했어요.'),
  });
  const visibility = useMutation({
    mutationFn: (s: Story) => api.patch(`/stories/${s.id}/visibility`, { visibility: s.visibility === 'PUBLIC' ? 'NEIGHBORS' : 'PUBLIC' }).then((r) => ({ s, v: r.data.visibility as Story['visibility'] })),
    onSuccess: ({ s, v }) => {
      changed.current = true;
      patch(s.id, (x) => ({ ...x, visibility: v }));
      toast.success(v === 'PUBLIC' ? '전체 공개로 바꿨어요. 홈에도 보여요.' : '이웃 공개로 바꿨어요. 홈에서는 내려가요.');
      setSheet(null);
    },
    onError: () => toast.error('바꾸지 못했어요.'),
  });
  const hide = useMutation({
    mutationFn: (s: Story) => api.patch(`/stories/${s.id}/hidden`, { hidden: !s.hidden }).then((r) => ({ s, d: r.data as { hidden: boolean; hiddenReason: Story['hiddenReason'] } })),
    onSuccess: ({ s, d }) => {
      changed.current = true;
      patch(s.id, (x) => ({ ...x, hidden: d.hidden, hiddenReason: d.hiddenReason }));
      qc.invalidateQueries({ queryKey: ['story-reports'] });
      toast.success(d.hidden ? '홈에서 내렸어요.' : '다시 보이게 했어요.');
      setSheet(null);
    },
    onError: () => toast.error('바꾸지 못했어요.'),
  });

  // 하이라이트에 담기 (내 소식)
  const { data: myHighlights } = useQuery<StoryHighlight[]>({
    queryKey: ['highlights', user?.id],
    queryFn: () => api.get(`/stories/highlights/${user!.id}`).then((r) => r.data),
    enabled: sheet === 'highlight' && !!user?.id,
  });
  const [newHighlight, setNewHighlight] = useState('');
  const addToHighlight = useMutation({
    mutationFn: async ({ s, highlightId, name }: { s: Story; highlightId?: number; name?: string }) => {
      const id = highlightId ?? (await api.post('/stories/highlights', { name, isPublic: true })).data.id;
      await api.post(`/stories/highlights/${id}/stories/${s.id}`);
    },
    onSuccess: () => { toast.success('하이라이트에 담았어요.'); setNewHighlight(''); setSheet(null); qc.invalidateQueries({ queryKey: ['highlights'] }); },
    onError: (e) => toast.error(apiErrorMessage(e, '담지 못했어요.')),
  });

  // 긴 글은 접어 두고 [더 보기] — 잘렸는지 재서 단추를 보인다
  const textRef = useRef<HTMLParagraphElement>(null);
  const [clamped, setClamped] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const el = textRef.current;
      setClamped(!!el && el.scrollHeight > el.clientHeight + 2);
    });
    return () => cancelAnimationFrame(raf);
  }, [curId, slide, wide]);

  const leaveTo = (to: string) => { onClose(pos.i, changed.current); navigate(to); };

  const sideStory = (d: 1 | -1) => list[pos.i + d];
  const textSize = cur ? textStorySize(cur.caption) : 'lg';
  const textClass = textSize === 'lg' ? 'text-[24px] leading-[1.55]' : textSize === 'md' ? 'text-[20px] leading-[1.6]' : 'text-[16px] leading-[1.7]';

  const backdrop = useMemo(() => (cur && cur.images.length ? cur.images[slide] ?? cur.images[0] : null), [cur, slide]);

  if (!cur) return null;
  const hiddenNote = cur.hidden
    ? `${cur.hiddenReason === 'REPORTS' ? '신고가 쌓여 내려간 소식이에요.' : '운영자가 내린 소식이에요.'} ${cur.mine ? '나만 볼 수 있어요.' : '다른 사람에게는 보이지 않아요.'}`
    : null;

  // 휴대폰: 아래에서 올라오는 창 / PC: 댓글만 창 옆에 붙고 나머지는 창 안에서 올라온다
  const sheetBox = (content: ReactNode, label: string, tall = false) => (
    <div className="absolute inset-0 z-20 flex flex-col justify-end" onPointerDown={(e) => e.stopPropagation()}>
      {/* 바깥을 누르면 닫힌다 — 키보드는 Esc. 단추로 두면 '닫기'가 화면에 여럿이 된다 */}
      <div aria-hidden="true" onClick={() => setSheet(null)} className="min-h-0 flex-1 bg-black/40" />
      <div role="dialog" aria-label={label} className={`flex flex-col overflow-hidden rounded-t-2xl bg-white text-gray-900 ${tall ? 'h-[66%]' : 'max-h-[80%]'}`}>
        {content}
      </div>
    </div>
  );
  const menuItem = (label: string, onClick: () => void, danger = false, note?: string) => (
    <button key={label} type="button" onClick={onClick}
      className={`flex min-h-[52px] w-full items-center gap-2 px-5 text-left text-[15px] hover:bg-gray-50 ${danger ? 'font-bold text-accent' : 'text-gray-900'}`}>
      {label}{note && <span className="text-[13px] font-normal text-gray-500">{note}</span>}
    </button>
  );

  const comments = (
    <StoryComments
      story={cur}
      canWrite={isAuthenticated}
      isAdmin={isAdmin}
      focusCommentId={focusCommentId}
      onCount={(d) => { changed.current = true; patch(cur.id, (x) => ({ ...x, commentCount: Math.max(0, x.commentCount + d) })); }}
      onClose={() => setSheet(null)}
      onNeedLogin={() => { setLoginWhy('comment'); setSheet('login'); }}
      onLeave={() => onClose(pos.i, changed.current)}
    />
  );

  const frame = (
    <div
      className="relative flex h-full w-full flex-col overflow-hidden text-white lg:h-[min(88vh,820px)] lg:w-auto lg:aspect-[9/16] lg:rounded-lg"
      style={{ background: cur.images.length ? '#0b0b0c' : storyBgHex(cur.bg) }}
    >
      {backdrop && (
        <Thumb key={backdrop} src={backdrop} size="list" alt="" aria-hidden="true"
          className="pointer-events-none absolute inset-[-12%] h-[124%] w-[124%] object-cover opacity-45 blur-2xl" />
      )}

      {/* 진행 막대 — 한 칸 = 사진 한 장 */}
      <div className="relative flex shrink-0 gap-1 px-2.5 pt-[max(10px,env(safe-area-inset-top))]">
        {Array.from({ length: slides }, (_, k) => (
          <div key={k} className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/30">
            {k < slide && <div className="h-full w-full bg-white" />}
            {k === slide && (
              <div
                key={`${cur.id}-${slide}-${replay}`}
                data-story-progress
                className="h-full w-full origin-left bg-white"
                style={reduced
                  ? { transform: 'scaleX(1)' }
                  : { animation: `storyFill ${dur}ms linear forwards`, animationPlayState: running ? 'running' : 'paused' }}
                onAnimationEnd={(e) => { if (e.animationName === 'storyFill') go(1); }}
              />
            )}
          </div>
        ))}
      </div>

      {/* 머리 — 올린 사람 · 이웃 · 닫기 */}
      <div className="relative flex shrink-0 items-center gap-2.5 py-1.5 pl-3 pr-1">
        <StoryAvatar name={cur.author.name} avatar={cur.author.avatar} size={34} />
        <div className="min-w-0 flex-1">
          {title ? (
            <>
              <p className="truncate text-sm font-bold">{title}</p>
              <p className="truncate text-xs text-white/80">{cur.author.name} · {timeAgo(cur.createdAt)}</p>
            </>
          ) : (
            <>
              {cur.author.homepage
                ? <Link to={cur.author.homepage} onClick={() => onClose(pos.i, changed.current)} className="block truncate text-sm font-bold hover:underline">{cur.author.name}</Link>
                : <p className="truncate text-sm font-bold">{cur.author.name}</p>}
              <p className="flex items-center gap-1 truncate text-xs text-white/80">
                {[roleLabel(cur.author.role), timeAgo(cur.createdAt)].filter(Boolean).join(' · ')}
                {cur.visibility === 'NEIGHBORS' && <span className="ml-1 inline-flex items-center gap-0.5 rounded-full bg-white/15 px-1.5 text-[11px]"><Users size={10} /> 이웃 공개</span>}
              </p>
            </>
          )}
        </div>
        {headerExtra?.(cur)}
        {showFollow && !title && (
          <button
            type="button"
            onClick={() => { if (!needLogin('follow')) followMut.mutate(!(follow?.following ?? false)); }}
            disabled={followMut.isPending}
            aria-pressed={follow?.following ?? false}
            className={`inline-flex h-9 shrink-0 items-center gap-1 rounded-lg border border-white/70 px-2.5 text-[13px] font-bold disabled:opacity-60 ${follow?.following ? 'bg-white/20' : ''}`}
          >
            {follow?.following ? <><UserCheck size={14} /> 이웃</> : <><UserPlus size={14} /> 이웃 추가</>}
          </button>
        )}
        {!reduced && (
          <button type="button" onClick={() => setUserPaused((p) => !p)} aria-label={userPaused ? '이어 보기' : '멈춤'} aria-pressed={userPaused}
            className="hidden h-10 w-10 shrink-0 place-items-center lg:grid">
            {userPaused ? <Play size={18} fill="currentColor" /> : <Pause size={18} fill="currentColor" />}
          </button>
        )}
        <button type="button" onClick={close} aria-label="닫기" className="grid h-11 w-11 shrink-0 place-items-center">
          <X size={24} />
        </button>
      </div>

      {hiddenNote && (
        <p className="relative mx-3 mb-1 rounded-md bg-black/55 px-3 py-2 text-[13px] leading-snug text-white">{hiddenNote}</p>
      )}

      {/* 내용 + 누르기·밀기 자리 */}
      <div
        className="relative flex min-h-0 flex-1 touch-none select-none items-center justify-center"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onContextMenu={(e) => e.preventDefault()}
        data-story-stage
      >
        {src ? (
          <StoryPhoto
            key={src}
            src={src}
            alt={`${cur.author.name}님이 올린 사진 ${slide + 1}`}
            overlay={overlayFor(cur, slide)}
            onLoad={() => setLoadedSrc(src)}
            onError={() => setLoadedSrc(src)}
            imgClassName="[-webkit-touch-callout:none]"
          />
        ) : (
          <div className="flex max-h-full w-full flex-col items-center px-7">
            <p ref={textRef}
              className={`w-full whitespace-pre-line text-center font-bold [overflow-wrap:anywhere] ${textClass} ${textSize === 'sm' ? 'line-clamp-[14]' : 'line-clamp-[10]'}`}>
              {cur.caption}
            </p>
            {clamped && (
              <button type="button" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()} onClick={() => setSheet('text')}
                className="relative z-10 mt-3 h-10 rounded-full border border-white/60 px-4 text-[13px] font-bold">전체 보기</button>
            )}
          </div>
        )}
        {/* 왼쪽 1/3 = 앞 칸, 나머지 = 다음 칸 — 눈에 안 보이는 넓은 단추(손이 쉽게 닿는다) */}
        <button type="button" aria-label="이전" onClick={() => tap(-1)} className="absolute inset-y-0 left-0 w-1/3 cursor-default focus-visible:outline-none" />
        <button type="button" aria-label="다음" onClick={() => tap(1)} className="absolute inset-y-0 right-0 w-2/3 cursor-default focus-visible:outline-none" />
        {!loaded && <span className="pointer-events-none absolute h-9 w-9 animate-spin rounded-full border-2 border-white/30 border-t-white" aria-hidden="true" />}
        {userPaused && (
          <span className="pointer-events-none absolute grid h-14 w-14 place-items-center rounded-full bg-black/45" aria-hidden="true">
            <Pause size={22} fill="currentColor" />
          </span>
        )}
      </div>

      {/* 사진 소식의 글 — 세 줄까지, 길면 [더 보기] */}
      {src && cur.caption && (
        <div className="relative shrink-0 px-4 pt-3">
          <p ref={textRef} className="line-clamp-3 whitespace-pre-line text-[14px] leading-relaxed text-white [overflow-wrap:anywhere]">{cur.caption}</p>
          {clamped && <button type="button" onClick={() => setSheet('text')} className="mt-0.5 text-[13px] font-bold text-white/85 underline underline-offset-2">더 보기</button>}
        </div>
      )}

      {/* 좋아요 · 댓글 · 공유 · 홈페이지 · 더 보기 */}
      <div className="relative flex shrink-0 items-center gap-0.5 pb-[max(12px,env(safe-area-inset-bottom))] pl-2 pr-1 pt-1.5">
        <button type="button" onClick={() => { if (!needLogin('like')) like.mutate(cur); }} aria-pressed={cur.liked}
          aria-label={cur.liked ? '좋아요 취소' : '좋아요'}
          className={`flex h-11 items-center gap-1.5 px-2.5 text-sm ${cur.liked ? 'text-[#ff6b61]' : 'text-white'}`}>
          <Heart size={23} fill={cur.liked ? 'currentColor' : 'none'} />
          <span className="text-white">{cur.likeCount > 0 ? cur.likeCount : ''}</span>
        </button>
        <button type="button" onClick={() => setSheet(sheet === 'comments' ? null : 'comments')} aria-label="댓글" aria-pressed={sheet === 'comments'}
          className="flex h-11 items-center gap-1.5 px-2.5 text-sm">
          <MessageCircle size={23} />
          <span>{cur.commentCount > 0 ? cur.commentCount : ''}</span>
        </button>
        <button type="button" onClick={() => share(cur)} aria-label="공유" className="grid h-11 w-11 place-items-center">
          <Share2 size={21} />
        </button>
        <span className="flex-1" />
        {cur.author.homepage && !title && (
          <button type="button" onClick={() => leaveTo(cur.author.homepage!)}
            className="h-10 rounded-lg border border-white/55 px-3 text-[13px] font-bold">홈페이지</button>
        )}
        <button type="button" onClick={() => setSheet('more')} aria-label="더 보기" className="grid h-11 w-11 place-items-center">
          <MoreHorizontal size={22} />
        </button>
      </div>

      {/* ── 창들 ── */}
      {sheet === 'comments' && !wide && sheetBox(comments, '댓글', true)}
      {sheet === 'text' && sheetBox(
        <div className="min-h-0 overflow-y-auto px-5 pb-[max(20px,env(safe-area-inset-bottom))] pt-5">
          <p className="whitespace-pre-line text-[15px] leading-relaxed text-gray-900 [overflow-wrap:anywhere]">{cur.caption}</p>
          <button type="button" onClick={() => setSheet(null)} className="mt-5 h-11 w-full rounded-lg border border-gray-300 text-sm font-bold">닫기</button>
        </div>, '소식 전체 글')}
      {sheet === 'more' && sheetBox(
        <div className="py-2 pb-[max(8px,env(safe-area-inset-bottom))]">
          {menuItem('링크 복사', () => copyLink(cur))}
          {cur.mine ? (
            <>
              {menuItem('하이라이트에 담기', () => setSheet('highlight'))}
              {cur.visibility === 'PUBLIC'
                ? menuItem('이웃 공개로 바꾸기', () => visibility.mutate(cur), false, '홈에서 내려가요')
                : menuItem('전체 공개로 바꾸기', () => visibility.mutate(cur), false, '홈에도 보여요')}
              {menuItem('삭제', () => { setSheet(null); setConfirm('delete'); }, true)}
            </>
          ) : (
            <>
              {menuItem(`${cur.author.name}님 소식 그만 보기`, () => { if (!needLogin('mute')) mute.mutate(cur); })}
              {menuItem('신고하기', () => { if (!needLogin('report')) setSheet('report'); }, true)}
              {isAdmin && (
                <>
                  {menuItem(cur.hidden ? '다시 보이게 하기' : '홈에서 내리기', () => hide.mutate(cur))}
                  {menuItem('삭제', () => { setSheet(null); setConfirm('delete'); }, true)}
                </>
              )}
            </>
          )}
        </div>, '소식 메뉴')}
      {sheet === 'report' && sheetBox(
        <div className="pb-[max(8px,env(safe-area-inset-bottom))]">
          <p className="px-5 pb-1 pt-4 text-[15px] font-bold">신고하는 이유</p>
          {STORY_REPORT_REASONS.map((r) => menuItem(STORY_REPORT_LABELS[r], () => { if (!report.isPending) report.mutate({ s: cur, reason: r }); }))}
        </div>, '신고하기')}
      {sheet === 'login' && sheetBox(
        <div className="px-5 pb-[max(16px,env(safe-area-inset-bottom))] pt-5">
          <p className="mb-4 text-[17px] font-bold">{LOGIN_LINES[loginWhy]}</p>
          <button type="button"
            onClick={() => { setPostLoginRedirect(storyPath(cur.id)); onClose(pos.i, changed.current); navigate('/login'); }}
            className="h-12 w-full rounded-lg bg-gray-900 text-[15px] font-bold text-white">로그인</button>
          <button type="button" onClick={() => setSheet(null)} className="mt-2 h-11 w-full text-sm text-gray-600">계속 보기</button>
        </div>, '로그인 안내')}
      {sheet === 'highlight' && sheetBox(
        <div className="min-h-0 overflow-y-auto pb-[max(8px,env(safe-area-inset-bottom))]">
          <p className="px-5 pb-1 pt-4 text-[15px] font-bold">하이라이트에 담기</p>
          {(myHighlights ?? []).map((h) => menuItem(h.name, () => { if (!addToHighlight.isPending) addToHighlight.mutate({ s: cur, highlightId: h.id }); }))}
          <form className="flex gap-2 px-5 pb-2 pt-2" onSubmit={(e) => { e.preventDefault(); const n = newHighlight.trim(); if (n && !addToHighlight.isPending) addToHighlight.mutate({ s: cur, name: n.slice(0, 50) }); }}>
            <label htmlFor="new-highlight" className="sr-only">새 하이라이트 이름</label>
            <input id="new-highlight" value={newHighlight} onChange={(e) => setNewHighlight(e.target.value)} placeholder="새 하이라이트 이름" maxLength={50}
              className="h-11 min-w-0 flex-1 rounded-lg border border-gray-300 px-3 text-[15px] focus:border-gray-500 focus:outline-none" />
            <button type="submit" disabled={!newHighlight.trim() || addToHighlight.isPending}
              className="h-11 shrink-0 rounded-lg bg-gray-900 px-3.5 text-sm font-bold text-white disabled:bg-gray-200 disabled:text-gray-500">만들고 담기</button>
          </form>
        </div>, '하이라이트에 담기')}

      {/* 끝 — 보는 사람을 올리는 사람으로 */}
      {ended && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2.5 bg-[#0b0b0c] px-8 text-center">
          <p className="mb-3 text-xl font-bold">새 소식을 다 봤어요</p>
          {onCompose && (
            <button type="button" onClick={() => { onClose(pos.i, changed.current); onCompose(); }}
              className="h-12 w-56 rounded-lg bg-white text-[15px] font-bold text-gray-900">소식 올리기</button>
          )}
          <button type="button" onClick={close} className="h-12 w-56 rounded-lg border border-white/55 text-[15px]">닫기</button>
          <button type="button" onClick={() => { setEnded(false); setPos({ i: 0, slide: 0 }); setReplay((r) => r + 1); }}
            className="h-11 px-3 text-[13px] text-white/80 underline underline-offset-2">처음부터 다시 보기</button>
        </div>
      )}
    </div>
  );

  const side = (d: 1 | -1) => {
    const s = sideStory(d);
    if (!s || sheet === 'comments') return <span className="hidden w-[132px] shrink-0 xl:block" />;
    const img = s.images[0];
    return (
      <button type="button" onClick={() => jumpStory(d)} aria-label={`${s.author.name}님의 소식으로`}
        className="relative hidden h-[220px] w-[132px] shrink-0 overflow-hidden rounded-md opacity-50 transition-opacity hover:opacity-80 xl:block"
        style={{ background: img ? '#111' : storyBgHex(s.bg) }}>
        {img
          ? <Thumb src={img} size="grid" alt="" className="absolute inset-0 h-full w-full object-contain" />
          : <span className="absolute inset-0 flex items-center justify-center p-3 text-center text-xs font-bold text-white"><span className="line-clamp-5 whitespace-pre-line">{s.caption}</span></span>}
        <span className="absolute inset-x-2 bottom-2 truncate text-left text-xs font-bold text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.7)]">{s.author.name}</span>
      </button>
    );
  };
  const arrow = (d: 1 | -1) => (
    <button type="button" onClick={() => jumpStory(d)} aria-label={d === 1 ? '다음 소식' : '이전 소식'}
      className={`hidden h-12 w-12 shrink-0 place-items-center rounded-full border border-white/50 text-white hover:bg-white/10 lg:grid ${d === -1 && pos.i === 0 ? 'invisible' : ''}`}>
      {d === 1 ? <ChevronRight size={22} /> : <ChevronLeft size={22} />}
    </button>
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title ?? `${cur.author.name}님의 소식`}
      data-story-viewer
      className="fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-4 bg-black lg:bg-black/95"
      style={{ height: vv.height, transform: vv.offsetTop ? `translateY(${vv.offsetTop}px)` : undefined }}
    >
      {side(-1)}
      {arrow(-1)}
      {frame}
      {wide && sheet === 'comments' && (
        <div className="h-[min(88vh,820px)] w-[360px] shrink-0 overflow-hidden rounded-lg">{comments}</div>
      )}
      {arrow(1)}
      {side(1)}

      <ConfirmDialog
        open={confirm === 'delete'}
        title="소식 삭제"
        message="이 소식을 지웁니다. 사진과 댓글도 함께 사라지며 되돌릴 수 없습니다."
        confirmText="삭제"
        variant="danger"
        onConfirm={() => { setConfirm(null); del.mutate(cur); }}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
