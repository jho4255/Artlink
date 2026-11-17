/**
 * 소식 올리기 (`/story/new`, 2026-11-14, CLAUDE.md 규칙 81) — **한 페이지에서 다 한다**(인스타 스토리 만들기처럼).
 *
 * [+] 를 누르면 곧바로 여기로 온다 — 사진/글을 먼저 고르는 창은 없다(2026-11-14 사용자 결정).
 *  · 들어오면 색 바탕 위에 바로 글을 쓴다(글만 소식). 바탕색 여섯.
 *  · 아래 [사진] 으로 사진을 넣으면 사진 소식이 된다 — 사진 줄(보기·빼기·더 넣기, 10장) · 글 칸(사진 아래에 나오는 글).
 *    사진을 다 빼면 쓰던 글을 들고 색 바탕으로 돌아간다.
 *  · **사진 위 글**: 사진 오른쪽 위 [Aa] → 글·꾸밈(글자만/검은 띠/흰 띠)·크기 → 사진 위에 얹히고 **끌어서 옮긴다**, 누르면 다시 고친다.
 *    사진 원본은 그대로 두고 글을 따로 얹는다(StoryPhoto — 카드·보기 화면과 같은 부품이라 같은 자리·같은 비율로 보인다).
 *  · 맨 아래 [전체 공개 | 이웃 공개] / 오른쪽 위 [올리기]. PC 는 사진을 끌어다 놓아도 된다.
 * 사진은 고르는 대로 올리기 시작하고 칸마다 진행·실패·다시 시도. 다 올라가기 전엔 [올리기]가 잠긴다.
 * 쓰던 것은 이 기기에 남긴다(올라간 사진 주소·사진 위 글·글·색·공개 범위). 고친 채로 닫으면 묻는다.
 * ⚠️ Layout 밖 전용 화면(커뮤니티 글쓰기와 같은 이유 — 하단 탭바·팝업이 없어야 자판 위 자리가 남는다).
 * ⚠️ 화면에 설명 문구를 두지 않는다(규칙 81) — 자리표시는 '글 쓰기' 뿐.
 */
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { X, Plus, RotateCw, ImagePlus, Loader2, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import { compressImage, apiErrorMessage } from '@/lib/utils';
import { readComposeImages } from '@/lib/artlook';
import { useAuthStore } from '@/stores/authStore';
import { useVisualViewport, useScrollLock } from '@/hooks/useVisualViewport';
import { useMention, MentionSuggest } from '@/components/shared/MentionSuggest';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import { StoryAvatar } from '@/components/story/StoryCard';
import StoryPhoto, { OverlayText, type PhotoBox } from '@/components/story/StoryPhoto';
import type { StoryComposeState } from '@/components/story/useStoryCompose';
import {
  STORY_BG_KEYS, STORY_BGS, STORY_PHOTO_MAX, STORY_TEXT_MAX, STORY_OVERLAY_MAX, STORY_OVERLAY_SIZES, STORY_OVERLAY_STYLES,
  OVERLAY_SIZE_LABELS, OVERLAY_STYLE_LABELS, clampOverlayPos, storyBgHex, type StoryBgKey, type StoryOverlay,
} from '@/lib/story';
import { readStoryDraft, saveStoryDraft, clearStoryDraft } from '@/lib/storyDraft';

type OverlayDraft = Omit<StoryOverlay, 'i'>;
interface Item { key: string; preview: string; url: string | null; status: 'uploading' | 'done' | 'error'; file?: File; overlay?: OverlayDraft | null }

let seq = 0;
const newKey = () => `p${Date.now()}-${++seq}`;
const fromFile = (f: File): Item => ({ key: newKey(), preview: URL.createObjectURL(f), url: null, status: 'uploading', file: f });
const fromUrl = (u: string, overlay?: OverlayDraft | null): Item => ({ key: newKey(), preview: u, url: u, status: 'done', overlay: overlay ?? null });

interface Init { items: Item[]; text: string; bg: StoryBgKey; visibility: 'PUBLIC' | 'NEIGHBORS' }

/** 사진 위 글을 고치는 동안의 값 */
interface Editing { index: number; text: string; size: OverlayDraft['size']; style: OverlayDraft['style'] }

/**
 * 꾸밈·크기·바탕색 단추는 눌러도 글 칸에서 포커스를 뺏지 않는다 — 뺏으면 휴대폰 자판이 내려가 다시 칸을 눌러야 했다(2026-11-14 앱 점검).
 * 누르기(click)는 그대로 온다. 키보드로 옮겨 다니는 것(Tab)도 그대로다.
 */
const keepFocus = (e: React.PointerEvent) => e.preventDefault();

/** 올라간 사진에 붙은 '사진 위 글' — `i` 는 올라간 사진 사이의 번호(서버·쓰던 것 저장과 같은 기준) */
function overlaysOf(done: Item[]): StoryOverlay[] {
  return done.flatMap((it, i) => (it.overlay?.text.trim() ? [{ i, ...it.overlay, text: it.overlay.text.trim() }] : []));
}

export default function StoryComposePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const { user } = useAuthStore();
  const vv = useVisualViewport();
  useScrollLock();
  const state = (location.state ?? {}) as StoryComposeState;

  // 처음 열 때 한 번 정한다 — ArtLook 이 넘긴 사진 > 쓰던 것 > 빈 글 바탕
  const [init] = useState<Init>(() => {
    const artlook = readComposeImages(location.state);
    const base = { text: '', bg: 'slate' as StoryBgKey, visibility: 'PUBLIC' as const };
    if (artlook.length) return { ...base, items: artlook.map((u) => fromUrl(u)) };
    const draft = user ? readStoryDraft(user.id) : null;
    if (!draft) return { ...base, items: [] };
    return {
      text: draft.text, bg: draft.bg, visibility: draft.visibility,
      items: draft.urls.map((u, i) => {
        const o = draft.overlays?.find((v) => v.i === i);
        return fromUrl(u, o ? { text: o.text, x: o.x, y: o.y, size: o.size, style: o.style } : null);
      }),
    };
  });
  // 마우스·키보드 화면이면 들어오자마자 쓴다 — 휴대폰은 자판이 사진 단추를 가리지 않게 누를 때까지 기다린다
  const [finePointer] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: fine)').matches);
  const [items, setItems] = useState<Item[]>(init.items);
  const [cur, setCur] = useState(0);
  const [text, setText] = useState(init.text);
  const [bg, setBg] = useState<StoryBgKey>(init.bg);
  const [visibility, setVisibility] = useState<'PUBLIC' | 'NEIGHBORS'>(init.visibility);
  const [posting, setPosting] = useState(false);
  const [askDiscard, setAskDiscard] = useState(false);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [dropping, setDropping] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement | null>(null);
  // ⚠️ 나눠 받는다 — 한 객체로 들고 다니면 React 컴파일러 린트가 ref 와 같은 덩어리로 보고 렌더 중 접근으로 잡는다
  const { ref: mentionRef, onChange: onMentionChange, onBlur: onMentionBlur, onKeyDown: onMentionKey, suggest } = useMention(text, (v) => setText(v.slice(0, STORY_TEXT_MAX)));
  const photo = items.length > 0;
  const shownIndex = Math.min(cur, Math.max(0, items.length - 1));
  const shown = photo ? items[shownIndex] : undefined;

  // ArtLook 이 넘긴 사진(라우터 state)은 한 번 쓰면 비운다(새로고침·뒤로가기에 다시 붙지 않게 — 그 뒤로는 쓰던 것으로 남는다)
  useEffect(() => {
    if (readComposeImages(location.state).length) navigate(location.pathname, { replace: true, state: { from: state.from } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 사진 올리기 — 고르는 대로, 하나씩 ──
  const started = useRef(new Set<string>());
  useEffect(() => {
    for (const it of items) {
      if (it.status !== 'uploading' || !it.file || started.current.has(it.key)) continue;
      started.current.add(it.key);
      const file = it.file;
      (async () => {
        try {
          const small = await compressImage(file);
          const form = new FormData();
          form.append('image', small);
          const { data } = await api.post('/upload/image', form, { headers: { 'Content-Type': 'multipart/form-data' } });
          setItems((list) => list.map((x) => (x.key === it.key ? { ...x, url: data.url as string, status: 'done' } : x)));
        } catch {
          started.current.delete(it.key);
          setItems((list) => list.map((x) => (x.key === it.key ? { ...x, status: 'error' } : x)));
        }
      })();
    }
  }, [items]);

  // 미리보기 주소(blob:)는 화면을 떠날 때 돌려준다.
  // ⚠️ 개발 모드(StrictMode)는 처음에 effect 를 '정리 → 다시 실행' 한다 — 그때 돌려주면 미리보기가 깨진다.
  //    정리한 뒤 한 박자 기다려 정말 떠났을 때만 돌려준다.
  const itemsRef = useRef(items);
  useEffect(() => { itemsRef.current = items; }, [items]);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      window.setTimeout(() => {
        if (alive.current) return;
        for (const it of itemsRef.current) if (it.preview.startsWith('blob:')) URL.revokeObjectURL(it.preview);
      }, 0);
    };
  }, []);

  // 쓰던 것은 이 기기에 — 올라간 사진·사진 위 글·글·색·공개 범위
  useEffect(() => {
    if (!user) return;
    const t = window.setTimeout(() => {
      const done = items.filter((i) => i.status === 'done' && i.url);
      const urls = done.map((i) => i.url!) as string[];
      if (!urls.length && !text.trim()) clearStoryDraft(user.id);
      else saveStoryDraft(user.id, { mode: urls.length ? 'photo' : 'text', urls, overlays: overlaysOf(done), text, bg, visibility });
    }, 400);
    return () => window.clearTimeout(t);
  }, [user, items, text, bg, visibility]);

  // 글만 소식 — 쓰는 만큼 칸이 자란다(가운데 정렬을 지키려고)
  useEffect(() => {
    const el = textRef.current;
    if (!el || photo) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [text, photo]);

  const addFiles = (list: FileList | File[] | null) => {
    const files = Array.from(list ?? []).filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;
    const room = STORY_PHOTO_MAX - items.length;
    if (room <= 0) { toast.error(`사진은 ${STORY_PHOTO_MAX}장까지예요.`); return; }
    if (files.length > room) toast(`사진은 ${STORY_PHOTO_MAX}장까지라 ${room}장만 넣었어요.`);
    const add = files.slice(0, room).map(fromFile);
    setItems((l) => [...l, ...add]);
    setCur(items.length);
  };
  const removeAt = (i: number) => {
    const it = items[i];
    if (it?.preview.startsWith('blob:')) URL.revokeObjectURL(it.preview);
    const next = items.filter((_, k) => k !== i);
    setItems(next);
    setCur((c) => Math.max(0, Math.min(c > i ? c - 1 : c, next.length - 1)));
  };
  const retry = (i: number) => setItems((l) => l.map((x, k) => (k === i ? { ...x, status: 'uploading' } : x)));
  const setOverlay = (i: number, fn: (o: OverlayDraft | null | undefined) => OverlayDraft | null) =>
    setItems((l) => l.map((x, k) => (k === i ? { ...x, overlay: fn(x.overlay) } : x)));

  // ── 사진 위 글 ──
  const openEditor = (i: number) => {
    const o = items[i]?.overlay;
    setEditing({ index: i, text: o?.text ?? '', size: o?.size ?? 'm', style: o?.style ?? 'plain' });
  };
  const finishEditor = () => {
    if (!editing) return;
    const t = editing.text.trim().slice(0, STORY_OVERLAY_MAX);
    setOverlay(editing.index, (o) => (t ? { text: t, size: editing.size, style: editing.style, x: o?.x ?? 0.5, y: o?.y ?? 0.5 } : null));
    setEditing(null);
  };
  const nudge = (dx: number, dy: number) =>
    setOverlay(shownIndex, (o) => (o ? { ...o, x: clampOverlayPos(o.x + dx), y: clampOverlayPos(o.y + dy) } : null));

  // 끌어 옮기기 — 짧게 누르고 떼면 고치는 창
  const drag = useRef<{ id: number; px: number; py: number; ox: number; oy: number; t: number; moved: boolean } | null>(null);
  const onOverlayDown = (e: React.PointerEvent<HTMLSpanElement>, o: OverlayDraft) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { id: e.pointerId, px: e.clientX, py: e.clientY, ox: o.x, oy: o.y, t: Date.now(), moved: false };
  };
  const onOverlayMove = (e: React.PointerEvent<HTMLSpanElement>, box: PhotoBox) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.px;
    const dy = e.clientY - d.py;
    if (!d.moved && Math.hypot(dx, dy) < 5) return;
    d.moved = true;
    setOverlay(shownIndex, (o) => (o ? { ...o, x: clampOverlayPos(d.ox + dx / box.width), y: clampOverlayPos(d.oy + dy / box.height) } : null));
  };
  const onOverlayUp = (e: React.PointerEvent<HTMLSpanElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.id !== e.pointerId) return;
    if (!d.moved && Date.now() - d.t < 500) openEditor(shownIndex);
  };
  const onOverlayKey = (e: React.KeyboardEvent<HTMLSpanElement>) => {
    const step = e.shiftKey ? 0.1 : 0.02;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openEditor(shownIndex); }
    else if (moves[e.key]) { e.preventDefault(); nudge(...moves[e.key]); }
  };

  const uploading = items.some((i) => i.status === 'uploading');
  const failed = items.some((i) => i.status === 'error');
  const canPost = !posting && !uploading && (photo ? items.some((i) => i.status === 'done') : text.trim().length > 0);
  const dirty = items.length > 0 || text.trim().length > 0;

  const leave = () => {
    if (location.key !== 'default') navigate(-1);
    else navigate(state.from || '/', { replace: true });
  };
  const discard = () => {
    if (user) clearStoryDraft(user.id);
    leave();
  };
  const post = async () => {
    if (failed) { toast.error('올리지 못한 사진이 있어요. 다시 올리거나 빼 주세요.'); return; }
    if (!canPost) return;
    setPosting(true);
    try {
      const done = items.filter((i) => i.url);
      await api.post('/stories', {
        caption: text.trim(),
        images: done.map((i) => i.url!),
        overlays: overlaysOf(done),
        visibility,
        bg: photo ? null : bg,
      });
      if (user) clearStoryDraft(user.id);
      qc.invalidateQueries({ queryKey: ['stories'] });
      toast.success(visibility === 'PUBLIC' ? '소식을 올렸어요.' : '소식을 올렸어요. 이웃에게만 보여요.');
      leave();
    } catch (e) {
      toast.error(apiErrorMessage(e, '올리지 못했어요. 잠시 후 다시 해 주세요.'));
      setPosting(false);
    }
  };

  const shownOverlay = shown?.overlay ?? null;
  const editingSize = editing?.size === 's' ? 'text-[20px]' : editing?.size === 'l' ? 'text-[32px]' : 'text-[26px]';
  // 올린 뒤의 모양(OverlayText)과 같은 비율 — em 단위라 글자 크기를 바꿔도 모양이 같다
  const editingLook = editing?.style === 'dark'
    ? 'rounded-[0.3em] bg-black/75 px-[0.5em] py-[0.22em] text-white [&_textarea]:placeholder:text-white/60'
    : editing?.style === 'light'
      ? 'rounded-[0.3em] bg-white/90 px-[0.5em] py-[0.22em] text-gray-900 [&_textarea]:placeholder:text-gray-500'
      : 'text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.7)] [&_textarea]:placeholder:text-white/60';

  return (
    <div className="fixed inset-x-0 top-0 z-40 flex justify-center bg-black" style={{ height: vv.height, transform: vv.offsetTop ? `translateY(${vv.offsetTop}px)` : undefined }}>
      <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" data-story-file-input
        onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
      <div
        data-story-compose
        className={`relative flex h-full w-full max-w-[480px] flex-col overflow-hidden text-white sm:my-4 sm:h-[calc(100%-32px)] sm:rounded-xl ${dropping ? 'ring-2 ring-inset ring-white' : ''}`}
        style={{ background: photo ? '#0b0b0c' : storyBgHex(bg) }}
        onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDropping(true); } }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false); }}
        onDrop={(e) => { if (e.dataTransfer.files.length) { e.preventDefault(); addFiles(e.dataTransfer.files); } setDropping(false); }}
      >
        {shown && (
          <img src={shown.preview} alt="" aria-hidden="true" className="pointer-events-none absolute inset-[-12%] h-[124%] w-[124%] object-cover opacity-40 blur-2xl" />
        )}

        {/* 머리 — 닫기 · 나 · [올리기] */}
        {/* ⚠️ 사진 위 글을 고치는 동안엔 머리·아래 줄을 감춘다 — 창이 반투명이라 두 겹의 단추가 겹쳐 보였다(2026-11-14 실측) */}
        <div className={`relative flex shrink-0 items-center gap-2 py-2 pl-1 pr-3 pt-[max(8px,env(safe-area-inset-top))] ${editing ? 'invisible' : ''}`}>
          <button type="button" onClick={() => (dirty ? setAskDiscard(true) : leave())} aria-label="닫기" className="grid h-11 w-11 place-items-center">
            <X size={24} />
          </button>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {user && <StoryAvatar name={user.nickname || user.name} avatar={user.avatar ?? null} size={30} />}
            <span className="truncate text-sm font-bold">{user ? (user.nickname || user.name) : ''}</span>
            {items.length > 1 && <span className="shrink-0 rounded-full bg-black/50 px-2 text-xs">{shownIndex + 1}/{items.length}</span>}
          </div>
          <button type="button" onClick={post} disabled={!canPost && !failed}
            className="h-10 shrink-0 rounded-lg bg-white px-4 text-[15px] font-bold text-gray-900 disabled:bg-white/25 disabled:text-white/70">
            {posting ? '올리는 중…' : uploading ? '사진 올리는 중' : '올리기'}
          </button>
        </div>

        {/* 가운데 — 사진(자르지 않는다, 위에 글) 또는 색 바탕 위 글 */}
        {shown ? (
          <div className="relative min-h-0 flex-1">
            <StoryPhoto key={shown.key} src={shown.preview} alt={`올릴 사진 ${shownIndex + 1}`}>
              {(box) => shownOverlay && !editing && (
                <OverlayText
                  o={shownOverlay}
                  boxWidth={box.width}
                  role="button"
                  tabIndex={0}
                  aria-label={`사진 위 글 ${shownOverlay.text}`}
                  onKeyDown={onOverlayKey}
                  onPointerDown={(e) => onOverlayDown(e, shownOverlay)}
                  onPointerMove={(e) => onOverlayMove(e, box)}
                  onPointerUp={onOverlayUp}
                  onPointerCancel={() => { drag.current = null; }}
                  className="pointer-events-auto cursor-move touch-none select-none outline-none focus-visible:ring-2 focus-visible:ring-white"
                />
              )}
            </StoryPhoto>
            {shown.status === 'uploading' && (
              <Loader2 size={30} className="pointer-events-none absolute left-1/2 top-1/2 -ml-[15px] -mt-[15px] animate-spin text-white/80" aria-label="사진 올리는 중" />
            )}
            <button type="button" onClick={() => openEditor(shownIndex)} aria-label="사진 위에 글 쓰기"
              className={`absolute right-3 top-2 grid h-11 w-11 place-items-center rounded-full bg-black/50 text-[17px] font-bold hover:bg-black/65 ${editing ? 'invisible' : ''}`}>
              Aa
            </button>
          </div>
        ) : (
          <div className="relative flex min-h-0 flex-1 cursor-text items-center justify-center overflow-y-auto px-6" onClick={() => textRef.current?.focus()}>
            <div className="relative w-full">
              <label htmlFor="story-text" className="sr-only">글</label>
              <textarea
                id="story-text"
                ref={(el) => { textRef.current = el; (mentionRef as React.MutableRefObject<HTMLTextAreaElement | null>).current = el; }}
                value={text}
                onChange={onMentionChange}
                onBlur={onMentionBlur}
                onKeyDown={onMentionKey}
                rows={1}
                autoFocus={finePointer && !text}
                placeholder="글 쓰기"
                className="block max-h-[60vh] w-full resize-none bg-transparent text-center text-[24px] font-bold leading-[1.55] text-white placeholder:text-white/60 focus:outline-none [overflow-wrap:anywhere]"
              />
              <MentionSuggest {...suggest} />
            </div>
          </div>
        )}

        {/* 아래 — (사진) 사진 줄·글 칸 / (글) 바탕색 · [사진] · 공개 범위 */}
        <div className={`relative flex shrink-0 flex-col gap-3 px-4 pb-[max(14px,env(safe-area-inset-bottom))] pt-2 ${editing ? 'invisible' : ''}`}>
          {photo ? (
            <>
              <div className="story-rail -mx-1 flex gap-2.5 overflow-x-auto px-1 pb-1 pt-2" role="list" aria-label="올릴 사진">
                {items.map((it, i) => (
                  <div key={it.key} role="listitem" className="relative h-[54px] w-[54px] shrink-0">
                    <button type="button" onClick={() => setCur(i)} aria-label={`사진 ${i + 1} 보기`} aria-pressed={i === shownIndex}
                      className={`grid h-full w-full place-items-center overflow-hidden rounded-md bg-white/10 ${i === shownIndex ? 'ring-2 ring-white' : 'ring-1 ring-white/30'}`}>
                      <img src={it.preview} alt="" className="max-h-full max-w-full object-contain" />
                      {it.status === 'uploading' && <span className="absolute inset-0 grid place-items-center bg-black/45"><Loader2 size={16} className="animate-spin" /></span>}
                      {it.overlay?.text && <span aria-hidden="true" className="absolute bottom-0.5 left-0.5 rounded bg-black/65 px-1 text-[10px] font-bold leading-4">Aa</span>}
                    </button>
                    {it.status === 'error' && (
                      <button type="button" onClick={() => retry(i)} aria-label={`사진 ${i + 1} 다시 올리기`}
                        className="absolute inset-0 grid place-items-center rounded-md bg-accent/85"><RotateCw size={16} /></button>
                    )}
                    <button type="button" onClick={() => removeAt(i)} aria-label={`사진 ${i + 1} 빼기`}
                      className="absolute -right-2 -top-2 grid h-6 w-6 place-items-center rounded-full bg-white text-gray-900">
                      <X size={12} strokeWidth={3} />
                    </button>
                  </div>
                ))}
                {items.length < STORY_PHOTO_MAX && (
                  <button type="button" onClick={() => fileRef.current?.click()} aria-label="사진 더 넣기"
                    className="grid h-[54px] w-[54px] shrink-0 place-items-center rounded-md border border-dashed border-white/70">
                    <Plus size={20} />
                  </button>
                )}
              </div>
              <div className="relative">
                <label htmlFor="story-caption" className="sr-only">글</label>
                <textarea
                  id="story-caption"
                  ref={mentionRef as React.Ref<HTMLTextAreaElement>}
                  value={text}
                  onChange={onMentionChange}
                  onBlur={onMentionBlur}
                  onKeyDown={onMentionKey}
                  rows={2}
                  placeholder="글 쓰기"
                  className="block w-full resize-none rounded-lg border border-white/35 bg-black/35 px-3 py-2.5 text-[15px] leading-relaxed text-white placeholder:text-white/60 focus:border-white/70 focus:outline-none"
                />
                <MentionSuggest {...suggest} placement="above" />
              </div>
            </>
          ) : (
            <div className="flex justify-center gap-3" role="radiogroup" aria-label="바탕색">
              {STORY_BG_KEYS.map((k) => (
                <button key={k} type="button" role="radio" aria-checked={bg === k} aria-label={`바탕색 ${STORY_BGS[k].label}`} onPointerDown={keepFocus} onClick={() => setBg(k)}
                  className={`h-9 w-9 rounded-full ${bg === k ? 'ring-[3px] ring-white' : 'ring-1 ring-white/50'}`} style={{ background: STORY_BGS[k].hex }} />
              ))}
            </div>
          )}
          <div className="flex items-center gap-3">
            {!photo && (
              <button type="button" onClick={() => fileRef.current?.click()}
                className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg bg-white/15 px-3.5 text-[13px] font-bold hover:bg-white/25">
                <ImagePlus size={17} /> 사진
              </button>
            )}
            <span className="flex-1" />
            {text.length > STORY_TEXT_MAX * 0.8 && <span className="shrink-0 text-xs text-white/80">{text.length} / {STORY_TEXT_MAX}</span>}
            <div role="radiogroup" aria-label="공개 범위" className="flex shrink-0 overflow-hidden rounded-lg border border-white/60">
              {(['PUBLIC', 'NEIGHBORS'] as const).map((v) => (
                <button key={v} type="button" role="radio" aria-checked={visibility === v} onClick={() => setVisibility(v)}
                  className={`h-10 px-3.5 text-[13px] font-bold ${visibility === v ? 'bg-white text-gray-900' : 'text-white'}`}>
                  {v === 'PUBLIC' ? '전체 공개' : '이웃 공개'}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 사진 위 글 — 꾸밈·크기를 바로 보며 쓴다 */}
        {editing && (
          <div role="dialog" aria-modal="true" aria-label="사진 위 글" className="absolute inset-0 z-30 flex flex-col bg-black/70"
            onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setEditing(null); } }}>
            <div className="flex shrink-0 items-center justify-between px-2 pr-3 pt-[max(8px,env(safe-area-inset-top))]">
              <button type="button" onClick={() => setEditing(null)} className="h-11 px-3 text-[15px]">취소</button>
              <div className="flex items-center gap-1">
                {items[editing.index]?.overlay && (
                  <button type="button" aria-label="사진 위 글 지우기" onClick={() => { setOverlay(editing.index, () => null); setEditing(null); }}
                    className="grid h-11 w-11 place-items-center"><Trash2 size={19} /></button>
                )}
                <button type="button" onClick={finishEditor} className="h-10 rounded-lg bg-white px-4 text-[15px] font-bold text-gray-900">완료</button>
              </div>
            </div>
            <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-6">
              <label htmlFor="overlay-text" className="sr-only">사진 위 글</label>
              {/* 글 칸은 글만큼 — 숨은 같은 글(span)이 칸 크기를 정하고 textarea 가 그 위에 겹친다.
                  그래야 띠(검은·흰)가 글을 감싸 올린 뒤의 모양과 같다(줄 수만큼 큰 상자가 되지 않게) */}
              <div className={`inline-grid max-w-full text-center font-bold leading-[1.35] ${editingSize} ${editingLook}`}>
                <span aria-hidden="true" className="invisible col-start-1 row-start-1 whitespace-pre-wrap break-keep [overflow-wrap:anywhere]">
                  {editing.text ? `${editing.text} ` : '글 쓰기'}
                </span>
                <textarea
                  id="overlay-text"
                  autoFocus
                  value={editing.text}
                  maxLength={STORY_OVERLAY_MAX}
                  onChange={(e) => setEditing({ ...editing, text: e.target.value.slice(0, STORY_OVERLAY_MAX) })}
                  rows={1}
                  cols={1}
                  placeholder="글 쓰기"
                  className="col-start-1 row-start-1 h-full w-full min-w-[1ch] resize-none overflow-hidden whitespace-pre-wrap break-keep bg-transparent text-center text-inherit [font:inherit] [letter-spacing:inherit] [overflow-wrap:anywhere] focus:outline-none"
                />
              </div>
            </div>
            <div className="flex shrink-0 flex-col gap-2.5 px-4 pb-[max(14px,env(safe-area-inset-bottom))] pt-2">
              <div role="radiogroup" aria-label="꾸밈" className="flex justify-center gap-2">
                {STORY_OVERLAY_STYLES.map((st) => (
                  <button key={st} type="button" role="radio" aria-checked={editing.style === st} onPointerDown={keepFocus} onClick={() => setEditing({ ...editing, style: st })}
                    className={`h-10 rounded-full px-4 text-[13px] font-bold ${editing.style === st ? 'bg-white text-gray-900' : 'border border-white/60 text-white'}`}>
                    {OVERLAY_STYLE_LABELS[st]}
                  </button>
                ))}
              </div>
              <div role="radiogroup" aria-label="글자 크기" className="flex justify-center gap-2">
                {STORY_OVERLAY_SIZES.map((sz) => (
                  <button key={sz} type="button" role="radio" aria-checked={editing.size === sz} onPointerDown={keepFocus} onClick={() => setEditing({ ...editing, size: sz })}
                    className={`h-10 rounded-full px-4 text-[13px] font-bold ${editing.size === sz ? 'bg-white text-gray-900' : 'border border-white/60 text-white'}`}>
                    {OVERLAY_SIZE_LABELS[sz]}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={askDiscard}
        title="쓰던 소식을 버릴까요?"
        confirmText="버리기"
        cancelText="계속 쓰기"
        variant="danger"
        onConfirm={() => { setAskDiscard(false); discard(); }}
        onCancel={() => setAskDiscard(false)}
      />
    </div>
  );
}
