import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react';
import { BubbleMenu, FloatingMenu } from '@tiptap/react/menus';
import { NodeSelection } from '@tiptap/pm/state';
import { Fragment, Slice, type Node as PMNode } from '@tiptap/pm/model';
import {
  ArrowLeft, Bold, Check, ChevronDown, CloudOff, Eye, Heading2, Heading3, Highlighter, ImagePlus, Italic, Lightbulb, Link2, ListChecks, Loader2,
  Minus, MoreHorizontal, Plus, Quote, Strikethrough, TextQuote, Underline, Video,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import { useAuthStore } from '@/stores/authStore';
import { setPostLoginRedirect } from '@/lib/postLoginRedirect';
import { useGoBack } from '@/hooks/useGoBack';
import { useFinePointer } from '@/components/shared/sortableHooks';
import { useVisualViewport, useScrollLock } from '@/hooks/useVisualViewport';
import { holdReload, onReloadDeferred, runDeferredReload, isReloadDeferred } from '@/lib/swUpdate';
import { AutosaveController, type AutosaveState, type SaveOutcome } from '@/lib/postAutosave';
import {
  emptyPostDoc, isEmptyPostDoc, normalizeLinkInput, parseYoutubeId, pendingImageCount, postDocPoll, postDocText, POST_DOC_LIMITS, savableDoc,
  type PollAttrs, type PostDoc,
} from '@/lib/postDoc';
import { samePoll } from '@/lib/postPoll';
import { postEditorExtensions, insertBlocks, pollStorage, toggleCallout, togglePullQuote } from './extensions';
import { DesktopToolbar, MobileToolbar, ToolButton } from './Toolbar';
import { useFormatState } from './formatState';
import PhotoTools from './PhotoTools';
import { EditorDialog, PhotoChoiceDialog, PromptDialog, btnGhost, btnPrimary } from './EditorDialog';
import { activeUploadCount, fileProblem, onUploadDone, resetUploads, useActiveUploadCount, videoProblem } from './uploadStore';
import { insertPhotos, insertVideos, photoRoom, reconcileUploads, replaceFigure, addToGallery, selectedMedia, videoRoom, type InsertMode } from './imageOps';
import { backupKey, clearBackup, contentSig, moveBackup, readBackup, writeBackup, type PostBackup } from './postBackup';
import PostBody from '@/components/post/PostBody';
import PollDialog from './PollDialog';
import { roleLabel } from '@/lib/utils';

/**
 * 커뮤니티 글쓰기 (2026-11-13, 블로그형 편집기) — `/community/write`(새 글) · `/community/:id/edit`(고치기).
 *
 * 화면: `Layout` 밖 전용 화면(상단바·하단 탭바·팝업 없음). 뿌리를 **보이는 영역**에 맞춰(useVisualViewport) 휴대폰 도구 막대가 자판 위에 붙는다.
 * 저장: 작업본(서버)에 자동 저장(lib/postAutosave) + 이 기기 보관(postBackup). 다른 기기·탭 충돌은 409 → 묻는다. 로그인이 풀리면
 *       로그아웃시키지 않고(axios skipAuthLogout) 묻는다. 배포 중 새로고침은 이 화면을 떠날 때까지 미룬다(swUpdate holdReload).
 * 등록: 발행 창 없이 [등록] — 탭·익명은 제목 위에서 고르고, 표지(목록 그림)는 늘 첫 사진, 요약은 서버가 뽑는다.
 * 넣을 것(2026-11-13): 사진 · 동영상 파일(25MB, 유튜브는 주소를 붙여 넣을 때만) · 투표(한 글에 하나 — 표가 모인 투표를 고치면 질문·보기는 잠근다).
 *
 * ⚠️ 이 파일은 lazy 로만 불러온다(pages/CommunityWritePage) — 편집기(TipTap)는 읽는 사람에게 필요 없다.
 */

interface Tab {
  id: number; name: string; slug: string; active: boolean; canWrite?: boolean; writePolicy?: string; allowAnonymous?: boolean; layout?: string;
}
interface DraftDto {
  id: number; postId: number | null; title: string; doc: PostDoc; categoryId: number | null; anonymous: boolean;
  rev: number; updatedAt: string; notice?: boolean; pollLocked?: boolean;
}
interface Initial {
  draftId: number | null; postId: number | null; rev: number; updatedAt: string | null;
  title: string; doc: PostDoc; categoryId: number | null; anonymous: boolean; notice: boolean;
  /** 고치는 글의 투표에 이미 표가 있다(그 투표의 질문·보기는 잠근다) */
  pollLocked: boolean;
}
interface Payload { title: string; doc: PostDoc; categoryId: number | null; anonymous: boolean }

const NET = { skipAuthLogout: true, timeout: 20_000 } as const;
const toId = (v: string | null | undefined) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };
const fromDraft = (d: DraftDto): Initial => ({
  draftId: d.id, postId: d.postId, rev: d.rev, updatedAt: d.updatedAt, title: d.title ?? '', doc: d.doc ?? emptyPostDoc(),
  categoryId: d.categoryId, anonymous: !!d.anonymous, notice: !!d.notice, pollLocked: !!d.pollLocked,
});

const CropDialog = lazy(() => import('./CropDialog'));

/* ═════════════════════════ 화면 껍데기 — 불러오기 ═════════════════════════ */
export default function PostEditorScreen({ postId }: { postId: number | null }) {
  const [params, setParams] = useSearchParams();
  // ⚠️ 주소의 draft 는 **처음 한 번만** 읽는다 — 작업본이 생겨 주소를 바꿀 때(replace) 다시 불러오면 쓰던 화면이 깜빡이며 처음으로 돌아간다
  const [target, setTarget] = useState<number | null>(() => toId(params.get('draft')));
  const tabSlug = useRef(params.get('tab'));
  const [initial, setInitial] = useState<Initial | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'ADMIN';

  const { data: tabs, isError: tabsError } = useQuery<Tab[]>({
    queryKey: ['community-tabs'],
    queryFn: () => api.get('/community/categories').then((r) => r.data),
    staleTime: 0,
  });

  useEffect(() => {
    let alive = true;
    setInitial(null);
    setLoadError(null);
    (async () => {
      try {
        if (postId) {
          const { data } = await api.post<DraftDto>('/community/drafts', { postId }, NET);
          if (alive) setInitial(fromDraft(data));
        } else if (target) {
          try {
            const { data } = await api.get<DraftDto>(`/community/drafts/${target}`, NET);
            if (alive) setInitial(fromDraft(data));
          } catch (e: unknown) {
            if ((e as { response?: { status?: number } })?.response?.status !== 404) throw e;
            toast.error('쓰던 글을 찾을 수 없어요. 새 글로 시작해요.');
            if (alive) { setTarget(null); setParams((p) => { p.delete('draft'); return p; }, { replace: true }); }
          }
        } else if (alive) {
          setInitial({ draftId: null, postId: null, rev: 0, updatedAt: null, title: '', doc: emptyPostDoc(), categoryId: null, anonymous: false, notice: false, pollLocked: false });
        }
      } catch (e: unknown) {
        const r = (e as { response?: { status?: number; data?: { error?: string } } })?.response;
        if (alive) setLoadError(r?.status === 404 ? '글을 찾을 수 없어요.' : r?.status === 401 ? '로그인이 필요해요.' : r?.data?.error || '글을 불러오지 못했어요.');
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postId, target, attempt]);

  // 새 글 — 탭 페이지에서 왔으면(?tab=) 그 탭을 골라 둔다(쓸 수 있을 때만)
  const ready = useMemo(() => {
    if (!initial || !tabs) return null;
    if (!initial.draftId && !initial.postId && initial.categoryId == null && tabSlug.current) {
      const t = tabs.find((x) => x.slug === tabSlug.current && x.canWrite);
      if (t) return { ...initial, categoryId: t.id, anonymous: false };
    }
    return initial;
  }, [initial, tabs]);

  if (loadError || tabsError) {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center gap-4 bg-white px-6 text-center">
        <p className="text-[15px] text-gray-700">{loadError ?? '탭 목록을 불러오지 못했어요.'}</p>
        <div className="flex gap-2">
          <button type="button" onClick={() => setAttempt((n) => n + 1)} className="h-11 rounded-lg border border-gray-300 px-4 text-sm">다시 시도</button>
          <a href="/community" className="inline-flex h-11 items-center rounded-lg bg-gray-900 px-4 text-sm font-semibold text-white">커뮤니티로</a>
        </div>
      </div>
    );
  }
  if (!ready || !tabs) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-white" role="status" aria-live="polite">
        <Loader2 size={22} className="animate-spin text-gray-400" /><span className="sr-only">글쓰기 화면을 여는 중</span>
      </div>
    );
  }
  return (
    <EditorCore
      key={`${ready.postId ?? 'n'}-${ready.draftId ?? 'new'}-${attempt}`}
      initial={ready}
      tabs={tabs}
      isAdmin={isAdmin}
      onSwitchDraft={(id) => { setTarget(id); setParams((p) => { p.set('draft', String(id)); return p; }, { replace: true }); }}
      onDraftCreated={(id) => setParams((p) => { p.set('draft', String(id)); return p; }, { replace: true })}
    />
  );
}

/* ═════════════════════════ 편집기 본체 ═════════════════════════ */
type Dialog =
  | { kind: 'link'; href: string; from: number; to: number }
  | { kind: 'poll'; initial: PollAttrs | null; locked: boolean }
  | { kind: 'alt'; pos: number; alt: string }
  | { kind: 'photos'; files: File[]; at?: number }
  | { kind: 'crop'; pos: number; src: string }
  | { kind: 'discard' };
type FileTarget = { kind: 'insert'; at?: number } | { kind: 'gallery'; pos: number } | { kind: 'replace'; pos: number };

/** 문서의 투표 노드(한 글에 하나) — 위치는 고치는 사이에 바뀌므로 그때그때 찾는다 */
function findPoll(editor: Editor): { pos: number; attrs: PollAttrs } | null {
  let found: { pos: number; attrs: PollAttrs } | null = null;
  editor.state.doc.descendants((n, pos) => {
    if (found) return false;
    if (n.type.name === 'poll') { found = { pos, attrs: n.attrs as PollAttrs }; return false; }
    return true;
  });
  return found;
}

function EditorCore({ initial, tabs, isAdmin, onSwitchDraft, onDraftCreated }: {
  initial: Initial; tabs: Tab[]; isAdmin: boolean; onSwitchDraft: (id: number) => void; onDraftCreated: (id: number) => void;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const goBack = useGoBack(initial.postId ? `/community/${initial.postId}` : '/community');
  const fine = useFinePointer();
  const vv = useVisualViewport();
  useScrollLock();
  const uploading = useActiveUploadCount();
  const postId = initial.postId;

  const [title, setTitle] = useState(initial.title);
  const [categoryId, setCategoryId] = useState<number | null>(initial.categoryId);
  const [anonymous, setAnonymous] = useState(initial.anonymous);
  const [notice, setNotice] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [save, setSave] = useState<AutosaveState>({ status: initial.draftId ? 'saved' : 'idle', savedAt: initial.updatedAt ? Date.parse(initial.updatedAt) : null, failures: 0 });
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [preview, setPreview] = useState<{ doc: PostDoc; width: 'pc' | 'mobile' } | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [typing, setTyping] = useState(false);
  const [chars, setChars] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  // 알림 띠
  const [conflict, setConflict] = useState<{ rev: number } | null>(null);
  const [authLost, setAuthLost] = useState(false);
  const [reloadWaiting, setReloadWaiting] = useState(() => isReloadDeferred());
  const [backupOffer, setBackupOffer] = useState<PostBackup | null>(null);
  const [draftsOffer, setDraftsOffer] = useState<{ id: number; title: string; updatedAt: string; imageCount: number }[] | null>(null);
  const [draftsOpen, setDraftsOpen] = useState(false);
  const [pristine, setPristine] = useState(!initial.draftId);
  const [, tick] = useState(0);

  const draftIdRef = useRef(initial.draftId);
  const revRef = useRef(initial.rev);
  const keyRef = useRef(backupKey({ postId, draftId: initial.draftId }));
  const titleRef = useRef(title);
  const catRef = useRef(categoryId);
  const anonRef = useRef(anonymous);
  const lastErrorRef = useRef<string | null>(null);
  const controller = useRef<AutosaveController<Payload> | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);
  const fileTarget = useRef<FileTarget>({ kind: 'insert' });
  // 표가 모인 투표(고치는 글) — 이 투표를 고칠 때만 질문·보기를 잠근다. 빼고 새로 넣은 투표는 잠그지 않는다(samePoll)
  const lockedPoll = useRef<PollAttrs | null>(initial.pollLocked ? postDocPoll(initial.doc) : null);
  const titleEl = useRef<HTMLTextAreaElement>(null);
  const changeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pastedImgs = useRef(0);
  const editorRef = useRef<Editor | null>(null);
  useEffect(() => { titleRef.current = title; catRef.current = categoryId; anonRef.current = anonymous; });

  const tab = tabs.find((t) => t.id === categoryId) ?? null;
  const anonAllowed = !initial.notice && !notice && (tab ? tab.allowAnonymous !== false : true);
  const writable = tabs.filter((t) => t.canWrite || t.id === initial.categoryId);

  /* ── 저장할 내용 ── */
  const payloadNow = useCallback((): Payload | null => {
    const ed = editorRef.current;
    if (!ed || ed.isDestroyed) return null;
    return {
      title: titleRef.current.replace(/\s+/g, ' ').trim(),
      doc: savableDoc(ed.getJSON() as PostDoc),
      categoryId: catRef.current,
      anonymous: anonRef.current,
    };
  }, []);

  /* ── 서버 저장(자동 저장 상태 기계가 부른다) ── */
  const saveDraft = useCallback(async (payload: Payload): Promise<SaveOutcome> => {
    try {
      if (!draftIdRef.current) {
        if (postId) {
          const { data } = await api.post<DraftDto>('/community/drafts', { postId }, NET);
          draftIdRef.current = data.id; revRef.current = data.rev;
        } else {
          const { data } = await api.post<DraftDto>('/community/drafts', payload, NET);
          const oldKey = keyRef.current;
          draftIdRef.current = data.id; revRef.current = data.rev;
          keyRef.current = backupKey({ draftId: data.id });
          moveBackup(oldKey, keyRef.current);
          onDraftCreated(data.id);
          lastErrorRef.current = null;
          return { ok: true };
        }
      }
      const { data } = await api.put<{ rev: number }>(`/community/drafts/${draftIdRef.current}`, { ...payload, baseRev: revRef.current }, NET);
      revRef.current = data.rev;
      lastErrorRef.current = null;
      return { ok: true };
    } catch (e: unknown) {
      const r = (e as { response?: { status?: number; data?: { error?: string; rev?: number } } })?.response;
      if (r?.status === 409) { setConflict({ rev: r.data?.rev ?? revRef.current }); return { ok: false, kind: 'conflict' }; }
      if (r?.status === 401) { setAuthLost(true); return { ok: false, kind: 'auth' }; }
      if (r?.status === 404) draftIdRef.current = null;   // 다른 곳에서 올렸거나 지웠다 — 다음에 새로 만든다
      lastErrorRef.current = r?.status === 400 || r?.status === 413 ? r.data?.error ?? null : null;
      return { ok: false, kind: 'retry' };
    }
  }, [postId, onDraftCreated]);

  /* ── 편집기 ── */
  const openFiles = useCallback((target: FileTarget) => {
    fileTarget.current = target;
    fileInput.current?.click();
  }, []);

  const handleFiles = useCallback((files: File[], target: FileTarget) => {
    const ed = editorRef.current;
    if (!ed || files.length === 0) return;
    const bad = files.filter((f) => fileProblem(f));
    let good = files.filter((f) => !fileProblem(f));
    if (bad.length) toast.error(bad.length === files.length ? fileProblem(bad[0]!)! : `사진 ${bad.length}장은 넣지 못했어요 — ${fileProblem(bad[0]!)}`);
    if (target.kind === 'replace') {
      if (good[0]) replaceFigure(ed, target.pos, good[0]);
      return;
    }
    const room = photoRoom(ed);
    if (good.length > room) {
      toast.error(`사진은 한 글에 ${POST_DOC_LIMITS.images}장까지예요. ${room}장만 넣을게요.`);
      good = good.slice(0, room);
    }
    if (good.length === 0) return;
    if (target.kind === 'gallery') {
      const n = addToGallery(ed, target.pos, good);
      if (n < good.length) toast(`모음에는 ${POST_DOC_LIMITS.galleryItems}장까지라 ${n}장만 더했어요.`);
      return;
    }
    if (good.length === 1) insertPhotos(ed, good, 'single', target.at);
    else setDialog({ kind: 'photos', files: good, at: target.at });
  }, []);

  /** 동영상 파일 — 하나씩 블록으로(모음은 없다) */
  const handleVideos = useCallback((files: File[], at?: number) => {
    const ed = editorRef.current;
    if (!ed || files.length === 0) return;
    const bad = files.filter((f) => videoProblem(f));
    let good = files.filter((f) => !videoProblem(f));
    if (bad.length) toast.error(bad.length === files.length ? videoProblem(bad[0]!)! : `동영상 ${bad.length}개는 넣지 못했어요 — ${videoProblem(bad[0]!)}`);
    const room = videoRoom(ed);
    if (good.length > room) {
      toast.error(`동영상은 한 글에 ${POST_DOC_LIMITS.videos}개까지예요.${room ? ` ${room}개만 넣을게요.` : ''}`);
      good = good.slice(0, room);
    }
    if (good.length) insertVideos(ed, good, at);
  }, []);

  /** [투표] — 이미 있으면 그 투표를 고치고, 없으면 새로 넣는다(한 글에 하나) */
  const openPoll = useCallback(() => {
    const ed = editorRef.current;
    if (!ed) return;
    const cur = findPoll(ed);
    if (cur) ed.chain().setNodeSelection(cur.pos).scrollIntoView().run();
    const locked = !!(cur && lockedPoll.current && samePoll(lockedPoll.current, cur.attrs));
    setDialog({ kind: 'poll', initial: cur ? cur.attrs : null, locked });
  }, []);

  const editor = useEditor({
    extensions: postEditorExtensions(),
    content: initial.doc,
    editorProps: {
      attributes: { class: 'post-body', 'aria-label': '본문', role: 'textbox', 'aria-multiline': 'true', spellcheck: 'false' },
      scrollThreshold: { top: 90, bottom: 110, left: 0, right: 0 },
      scrollMargin: { top: 90, bottom: 110, left: 0, right: 0 },
      handleKeyDown: (_view, event) => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
          event.preventDefault();
          openLinkDialog();
          return true;
        }
        return false;
      },
      handlePaste: (view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'));
        if (files.length) { event.preventDefault(); handleFiles(files, { kind: 'insert' }); return true; }
        const videos = Array.from(event.clipboardData?.files ?? []).filter((f) => f.type.startsWith('video/'));
        if (videos.length) { event.preventDefault(); handleVideos(videos); return true; }
        const text = event.clipboardData?.getData('text/plain')?.trim() ?? '';
        const html = event.clipboardData?.getData('text/html') ?? '';
        const { $from, empty } = view.state.selection;
        if (text && !/\s/.test(text) && empty && $from.parent.type.name === 'paragraph' && $from.parent.content.size === 0 && (!html || !html.includes('<img'))) {
          const id = /youtu/i.test(text) ? parseYoutubeId(text) : null;
          if (id && editorRef.current) { insertBlocks(editorRef.current, [{ type: 'youtube', attrs: { videoId: id, caption: '' } }]); return true; }
        }
        return false;
      },
      handleDrop: (view, event, _slice, moved) => {
        if (moved) return false;
        const all = Array.from(event.dataTransfer?.files ?? []);
        const files = all.filter((f) => f.type.startsWith('image/') || /\.hei[cf]$/i.test(f.name));
        const videos = all.filter((f) => f.type.startsWith('video/') || /\.(mp4|mov|m4v|webm)$/i.test(f.name));
        if (files.length === 0 && videos.length === 0) return false;
        event.preventDefault();
        const hit = view.posAtCoords({ left: event.clientX, top: event.clientY });
        let at: number | undefined;
        if (hit) { const $p = view.state.doc.resolve(hit.pos); at = $p.depth > 0 ? $p.after(1) : hit.pos; }
        if (files.length) handleFiles(files, { kind: 'insert', at });
        else handleVideos(videos, at);
        return true;
      },
      // 투표는 한 글에 하나 — 복사해 붙여 넣어 둘이 되면 붙여 넣은 쪽을 뺀다(투표는 맨 바깥 블록이라 맨 바깥만 본다)
      transformPasted: (slice, view) => {
        let pasted = 0;
        slice.content.forEach((n) => { if (n.type.name === 'poll') pasted++; });
        if (pasted === 0) return slice;
        let keep = 1;
        view.state.doc.forEach((n) => { if (n.type.name === 'poll') keep = 0; });
        if (pasted <= keep) return slice;
        const out: PMNode[] = [];
        slice.content.forEach((n) => { if (n.type.name !== 'poll') out.push(n); else if (keep > 0) { keep--; out.push(n); } });
        toast('투표는 한 글에 하나만 넣을 수 있어요. 붙여 넣은 투표는 뺐어요.', { id: 'paste-poll' });
        return new Slice(Fragment.from(out), out.length ? slice.openStart : 0, out.length ? slice.openEnd : 0);
      },
      // 바깥에서 붙여 넣은 글 — 사진(<img>)은 빼고 알린다(서버가 바깥 사진을 받지 않는다). 글꼴·색·크기는 스키마가 없어 저절로 떨어진다
      transformPastedHTML: (html) => {
        if (/data-post-(figure|gallery|youtube|video|poll)/.test(html)) return html;   // 이 편집기에서 복사한 사진·동영상·투표는 그대로
        let n = 0;
        const cleaned = html.replace(/<img\b[^>]*>/gi, () => { n += 1; return ''; });
        if (n > 0) {
          pastedImgs.current += n;
          toast(`붙여 넣은 글의 사진 ${n}장은 빠졌어요. 사진은 [사진] 으로 올려 주세요.`, { id: 'paste-img' });
        }
        return cleaned;
      },
    },
    onUpdate: () => scheduleChange(),
    onFocus: () => setTyping(true),
    onBlur: () => setTyping(false),
  });
  editorRef.current = editor;

  /* ── 고칠 때마다(0.4초 모아) — 서명·자동 저장·기기 보관·글자 수 ── */
  const scheduleChange = useCallback(() => {
    if (changeTimer.current) clearTimeout(changeTimer.current);
    changeTimer.current = setTimeout(() => {
      const ed = editorRef.current;
      const payload = payloadNow();
      if (!ed || !payload) return;
      const sig = contentSig(payload);
      controller.current?.changed(sig, () => payload);
      setChars(postDocText(payload.doc).replace(/\s/g, '').length);
      if (controller.current?.dirty) {
        setPristine(false);
        if (backupTimer.current) clearTimeout(backupTimer.current);
        backupTimer.current = setTimeout(() => writeBackup(keyRef.current, { ...payload, savedAt: Date.now() }), 1000);
      }
    }, 400);
  }, [payloadNow]);

  // 편집기가 준비되면 — 자동 저장 시작(서명은 편집기가 만든 모양으로), 기기 보관 확인, 쓰던 글 목록
  useEffect(() => {
    if (!editor) return;
    const start = payloadNow()!;
    const startSig = contentSig(start);
    setChars(postDocText(start.doc).replace(/\s/g, '').length);
    const c = new AutosaveController<Payload>({
      save: saveDraft,
      onChange: (s) => {
        setSave(s);
        // 서버가 지금 내용을 다 가졌으면 기기 보관은 필요 없다
        if (s.status === 'saved' && !c.dirty) clearBackup(keyRef.current);
      },
    }, startSig);
    controller.current = c;

    const b = readBackup(keyRef.current);
    if (b) {
      const serverAt = initial.updatedAt ? Date.parse(initial.updatedAt) : 0;
      const differs = contentSig(b) !== startSig;
      const hasSomething = !!b.title.trim() || !isEmptyPostDoc(b.doc);
      if (differs && hasSomething && b.savedAt > serverAt) setBackupOffer(b);
      else clearBackup(keyRef.current);
    }
    if (!initial.draftId && !initial.postId) {
      api.get<{ id: number; postId: number | null; title: string; updatedAt: string; imageCount: number }[]>('/community/drafts', NET)
        .then((r) => { const list = r.data.filter((d) => d.postId == null); if (list.length) setDraftsOffer(list); })
        .catch(() => { /* 목록은 없어도 쓴다 */ });
    }
    return () => { c.dispose(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  // 제목·탭·익명이 바뀌어도 저장 대상
  useEffect(() => { if (editor) scheduleChange(); }, [title, categoryId, anonymous, editor, scheduleChange]);

  // 올라간 사진을 문서에 채운다 · 되살아난 노드 정리
  useEffect(() => {
    if (!editor) return;
    const off = onUploadDone((e) => reconcileUploads(editor, e));
    // 되돌리기·다시 실행으로 되살아난 사진 노드를 맞춘다(문서를 훑기만 하고, 고칠 게 있을 때만 dispatch — 업데이트 도중이 아니게 다음 틱에)
    const onUpd = () => { queueMicrotask(() => reconcileUploads(editor)); };
    editor.on('update', onUpd);
    return () => { off(); editor.off('update', onUpd); };
  }, [editor]);

  // 투표 블록의 [투표 고치기] — 노드뷰가 이 창을 연다
  useEffect(() => {
    if (!editor) return;
    const st = pollStorage(editor);
    st.onEdit = () => openPoll();
    return () => { st.onEdit = null; };
  }, [editor, openPoll]);

  // 화면을 떠날 때 — 올리던 미리보기 정리
  useEffect(() => () => { resetUploads(); }, []);

  // 배포 중 새로고침은 이 화면을 떠날 때까지 미룬다
  useEffect(() => {
    const release = holdReload();
    const off = onReloadDeferred(() => setReloadWaiting(true));
    return () => { off(); release(); };
  }, []);

  // 가려지면(다른 앱·탭) 바로 저장 + 기기 보관 / 닫으려 하면 저장 안 된 것이 있을 때만 묻는다
  useEffect(() => {
    const persist = () => {
      const p = payloadNow();
      if (p && controller.current?.dirty) writeBackup(keyRef.current, { ...p, savedAt: Date.now() });
    };
    const onVis = () => { if (document.visibilityState === 'hidden') { persist(); void controller.current?.flush(); } };
    const onHide = () => persist();
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      persist();
      if (controller.current?.dirty || activeUploadCount() > 0) { e.preventDefault(); e.returnValue = ''; }
    };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', onHide);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pagehide', onHide);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [payloadNow]);

  // Ctrl/⌘+S — 지금 저장
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void controller.current?.flush().then((ok) => (ok ? toast.success('저장했어요.', { id: 'save' }) : toast.error('아직 저장하지 못했어요. 이 기기에 보관해 두었어요.', { id: 'save' })));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 저장된 시각 글자(방금 전 → 1분 전 …)를 30초마다 다시 그린다
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 30_000); return () => clearInterval(t); }, []);

  // 첫 화면 — 새 글이면 제목에 커서(넓은 화면만; 휴대폰은 자판이 화면을 가린다)
  useEffect(() => {
    if (fine && !initial.title && titleEl.current) titleEl.current.focus();
    // 자르기 창을 미리 받아 둔다 — 배포 뒤 옛 청크가 사라져 열 때 404 가 나지 않게
    void import('./CropDialog').catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 제목 칸 높이
  useEffect(() => {
    const el = titleEl.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [title, vv.height]);

  /* ── 동작 ── */
  function openLinkDialog() {
    const ed = editorRef.current;
    if (!ed) return;
    const { from, to } = ed.state.selection;
    setDialog({ kind: 'link', href: (ed.getAttributes('link').href as string | undefined) ?? '', from, to });
  }

  const applyLink = (raw: string, d: Extract<Dialog, { kind: 'link' }>) => {
    const ed = editorRef.current;
    if (!ed) return;
    const href = normalizeLinkInput(raw);
    if (!href) return;
    const chain = ed.chain().focus().setTextSelection({ from: d.from, to: d.to });
    if (d.from === d.to && !ed.isActive('link')) {
      chain.insertContent({ type: 'text', text: raw.trim(), marks: [{ type: 'link', attrs: { href } }] }).run();
    } else {
      chain.extendMarkRange('link').setLink({ href }).run();
    }
    setDialog(null);
  };

  const resolveConflict = async (keep: 'mine' | 'theirs') => {
    const c = controller.current;
    if (!c || !conflict) return;
    if (keep === 'mine') {
      revRef.current = conflict.rev;
      setConflict(null);
      c.resume();
      return;
    }
    try {
      const { data } = await api.get<DraftDto>(`/community/drafts/${draftIdRef.current}`, NET);
      editorRef.current?.commands.setContent(data.doc, { emitUpdate: false });
      setTitle(data.title); setCategoryId(data.categoryId); setAnonymous(!!data.anonymous);
      revRef.current = data.rev;
      titleRef.current = data.title; catRef.current = data.categoryId; anonRef.current = !!data.anonymous;
      const p = payloadNow();
      if (p) c.markSaved(contentSig(p), Date.parse(data.updatedAt));
      clearBackup(keyRef.current);
      setConflict(null);
      c.resume();
    } catch {
      toast.error('불러오지 못했어요. 잠시 뒤 다시 눌러 주세요.');
    }
  };

  const restoreBackup = (b: PostBackup) => {
    const ed = editorRef.current;
    if (!ed) return;
    ed.commands.setContent(b.doc);
    setTitle(b.title); setCategoryId(b.categoryId); setAnonymous(b.anonymous);
    setBackupOffer(null);
    setPristine(false);
    scheduleChange();
  };

  const loginAgain = () => {
    const p = payloadNow();
    if (p) writeBackup(keyRef.current, { ...p, savedAt: Date.now() });
    const here = postId ? `/community/${postId}/edit` : draftIdRef.current ? `/community/write?draft=${draftIdRef.current}` : '/community/write';
    setPostLoginRedirect(here);
    useAuthStore.getState().logout();
    navigate('/login');
  };

  const exit = async () => {
    if (activeUploadCount() > 0 && !window.confirm('사진·동영상을 올리는 중이에요. 나가면 올리는 중인 것은 빠져요. 나갈까요?')) return;
    const c = controller.current;
    if (c?.dirty) {
      const ok = await c.flush();
      if (!ok && !window.confirm('아직 서버에 저장하지 못했어요. 이 기기에 보관해 두었으니 다음에 이어 쓸 수 있어요. 나갈까요?')) return;
    }
    goBack();
  };

  const discard = async () => {
    setDialog(null);
    controller.current?.pause();
    if (draftIdRef.current) {
      try { await api.delete(`/community/drafts/${draftIdRef.current}`, NET); } catch { /* 지우기 실패해도 화면은 떠난다 — 다음에 목록에서 지울 수 있다 */ }
    }
    clearBackup(keyRef.current);
    resetUploads();
    goBack();
  };

  const publish = async () => {
    const ed = editorRef.current;
    const c = controller.current;
    if (!ed || publishing) return;
    const t = titleRef.current.replace(/\s+/g, ' ').trim();
    if (!t) { toast.error('제목을 입력해 주세요.'); titleEl.current?.focus(); return; }
    if (activeUploadCount() > 0) { toast('사진·동영상을 올리는 중이에요. 다 올라가면 다시 눌러 주세요.', { id: 'publish-wait' }); return; }
    const json = ed.getJSON() as PostDoc;
    if (pendingImageCount(json) > 0) { toast.error('올리지 못한 사진·동영상이 있어요. [다시]를 누르거나 지운 뒤 올려 주세요.'); return; }
    const doc = savableDoc(json);
    if (isEmptyPostDoc(doc)) { toast.error('내용을 입력해 주세요.'); ed.commands.focus('end'); return; }
    if (tab && !tab.canWrite && tab.id !== initial.categoryId) { toast.error(`‘${tab.name}’ 탭에는 쓸 수 없어요.`); return; }
    // 표가 모인 투표를 뺐거나 새 투표로 바꿨으면 — 올리면 그 표가 사라진다. 묻고 올린다
    if (lockedPoll.current) {
      const now = postDocPoll(doc);
      if (!now || !samePoll(lockedPoll.current, now)) {
        const msg = now ? '투표를 새로 넣었어요. 올리면 앞 투표에 모인 표가 사라져요. 올릴까요?' : '투표를 뺐어요. 올리면 지금까지 모인 표가 사라져요. 올릴까요?';
        if (!window.confirm(msg)) return;
      }
    }
    setPublishing(true);
    c?.pause();
    try {
      const body = { title: t, doc, categoryId: catRef.current, anonymous: anonAllowed ? anonRef.current : false };
      let id = postId;
      if (postId) {
        await api.patch(`/community/${postId}`, body, { ...NET, timeout: 30_000 });
      } else {
        const { data } = await api.post<{ id: number }>('/community', {
          ...body, draftId: draftIdRef.current ?? undefined, ...(isAdmin ? { notice, pinned } : {}),
        }, { ...NET, timeout: 30_000 });
        id = data.id;
      }
      clearBackup(keyRef.current);
      clearBackup('new');
      resetUploads();
      qc.invalidateQueries({ queryKey: ['community'] });
      qc.invalidateQueries({ queryKey: ['community-popular'] });
      qc.invalidateQueries({ queryKey: ['community-tabs'] });
      // 새 글은 글 화면 맨 위의 "글을 올렸어요 [공유]" 줄이 알린다 — 알림까지 띄우면 같은 말이 겹쳐 그 줄을 덮는다(휴대폰)
      if (postId) toast.success('고쳤어요.');
      navigate(`/community/${id}`, { replace: true, state: postId ? undefined : { justPublished: true } });
    } catch (e: unknown) {
      const r = (e as { response?: { status?: number; data?: { error?: string } } })?.response;
      if (r?.status === 401) setAuthLost(true);
      toast.error(r?.data?.error || (r ? '올리지 못했어요.' : '인터넷 연결을 확인해 주세요. 글은 이 기기에 보관해 두었어요.'));
      const p = payloadNow();
      if (p) writeBackup(keyRef.current, { ...p, savedAt: Date.now() });
      setPublishing(false);
      c?.resume();
    }
  };

  /* ── 화면 ── */
  const media = useSelectedMedia(editor);
  const statusText = (() => {
    if (conflict) return { text: '다른 곳에서 고친 내용이 있어요', tone: 'warn' as const };
    if (authLost) return { text: '로그인이 풀렸어요', tone: 'warn' as const };
    if (save.status === 'saving') return { text: '저장 중…', tone: 'muted' as const };
    if (save.status === 'retrying') {
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      return { text: lastErrorRef.current ? `저장 못 함 — ${lastErrorRef.current}` : offline ? '인터넷이 끊겼어요 · 이 기기에 보관 중' : '저장 못 함 — 다시 시도 중', tone: 'warn' as const };
    }
    if (save.status === 'dirty') return { text: '저장 전', tone: 'muted' as const };
    if (save.status === 'saved' && save.savedAt) return { text: `저장됨 · ${ago(save.savedAt)}`, tone: 'ok' as const };
    return { text: postId ? '고치는 중' : '자동 저장돼요', tone: 'muted' as const };
  })();

  const photoActions = {
    onCrop: (pos: number) => {
      const n = editor?.state.doc.nodeAt(pos);
      if (n?.attrs.src) setDialog({ kind: 'crop', pos, src: n.attrs.src as string });
    },
    onReplace: (pos: number) => openFiles({ kind: 'replace', pos }),
    onAlt: (pos: number) => { const n = editor?.state.doc.nodeAt(pos); setDialog({ kind: 'alt', pos, alt: (n?.attrs.alt as string) ?? '' }); },
    onAddToGallery: (pos: number) => openFiles({ kind: 'gallery', pos }),
    onEditPoll: () => openPoll(),
  };
  const toolbarActions = {
    onPhoto: () => openFiles({ kind: 'insert' }),
    onVideo: () => videoInput.current?.click(),
    onPoll: openPoll,
    onLink: openLinkDialog,
  };

  const banner = conflict ? (
    <Banner tone="warn" title="다른 곳에서 고친 내용이 있어요" desc="다른 기기나 탭에서 이 글을 저장했어요. 어느 쪽을 남길까요?">
      <button type="button" className="h-10 rounded-lg bg-gray-900 px-4 text-sm font-semibold text-white" onClick={() => void resolveConflict('theirs')}>그 내용 불러오기</button>
      <button type="button" className="h-10 rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium text-gray-700" onClick={() => void resolveConflict('mine')}>지금 내용으로 덮어쓰기</button>
    </Banner>
  ) : authLost ? (
    <Banner tone="warn" title="다시 로그인해 주세요" desc="쓰던 글은 이 기기에 그대로 있어요. 로그인하면 이 화면으로 돌아와요.">
      <button type="button" className="h-10 rounded-lg bg-gray-900 px-4 text-sm font-semibold text-white" onClick={loginAgain}>로그인하기</button>
    </Banner>
  ) : reloadWaiting ? (
    <Banner title="새 버전이 나왔어요" desc="글을 저장한 뒤에 새로고침할게요. 계속 쓰셔도 돼요.">
      <button type="button" className="h-10 rounded-lg bg-gray-900 px-4 text-sm font-semibold text-white" onClick={async () => {
        const ok = await controller.current?.flush();
        const p = payloadNow();
        if (p && controller.current?.dirty) writeBackup(keyRef.current, { ...p, savedAt: Date.now() });
        if (ok === false) toast('서버에 저장하지 못해 이 기기에 보관했어요.');
        runDeferredReload();
      }}>저장하고 새로고침</button>
      <button type="button" className="h-10 rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium text-gray-700" onClick={() => setReloadWaiting(false)}>나중에</button>
    </Banner>
  ) : backupOffer ? (
    <Banner title={initial.draftId || initial.postId ? '이 기기에 저장 못 한 글이 있어요' : '쓰던 글이 있어요'} desc={`${new Date(backupOffer.savedAt).toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })}에 쓰던 내용이에요${backupOffer.title ? ` — ‘${backupOffer.title.slice(0, 30)}’` : ''}.`}>
      <button type="button" className="h-10 rounded-lg bg-gray-900 px-4 text-sm font-semibold text-white" onClick={() => restoreBackup(backupOffer)}>이어서 쓰기</button>
      <button type="button" className="h-10 rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium text-gray-700" onClick={() => { clearBackup(keyRef.current); setBackupOffer(null); }}>{initial.draftId || initial.postId ? '서버에 있는 것으로' : '새로 쓰기'}</button>
    </Banner>
  ) : draftsOffer && pristine ? (
    <div className="border-b border-gray-200 bg-white">
      <div className="mx-auto flex max-w-[1040px] flex-wrap items-center justify-between gap-2 px-4 py-2.5 md:px-6">
        <span className="text-[14px] text-gray-700">쓰던 글이 {draftsOffer.length}개 있어요</span>
        <span className="flex gap-1.5">
          <button type="button" className="inline-flex h-9 items-center gap-1 rounded-lg border border-gray-300 px-3 text-[13px] font-medium text-gray-800" aria-expanded={draftsOpen} onClick={() => setDraftsOpen((o) => !o)}>이어 쓰기<ChevronDown size={14} /></button>
          <button type="button" className="h-9 px-2 text-[13px] text-gray-500 underline underline-offset-4" onClick={() => setDraftsOffer(null)}>닫기</button>
        </span>
      </div>
      {draftsOpen && (
        <ul className="mx-auto max-w-[1040px] divide-y divide-gray-100 border-t border-gray-100 px-4 md:px-6">
          {draftsOffer.map((d) => (
            <li key={d.id} className="flex items-center gap-3 py-2">
              <button type="button" onClick={() => onSwitchDraft(d.id)} className="min-w-0 flex-1 text-left">
                <span className="block truncate text-[14px] font-medium text-gray-900">{d.title || '제목 없음'}</span>
                <span className="text-[12px] text-gray-500">{ago(Date.parse(d.updatedAt))}{d.imageCount ? ` · 사진 ${d.imageCount}장` : ''}</span>
              </button>
              <button type="button" className="h-9 shrink-0 px-2 text-[13px] text-gray-500 hover:text-accent" onClick={async () => {
                if (!window.confirm(`‘${d.title || '제목 없음'}’ 쓰던 글을 지울까요? 되돌릴 수 없어요.`)) return;
                try { await api.delete(`/community/drafts/${d.id}`, NET); clearBackup(backupKey({ draftId: d.id })); setDraftsOffer((l) => (l ?? []).filter((x) => x.id !== d.id)); } catch { toast.error('지우지 못했어요.'); }
              }}>지우기</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  ) : null;

  return (
    <div
      className="fixed left-0 top-0 z-[60] flex w-full flex-col bg-white"
      style={{ height: vv.height, transform: vv.offsetTop ? `translateY(${vv.offsetTop}px)` : undefined }}
      data-post-editor
    >
      {/* 위 줄 */}
      <header className="flex h-[52px] shrink-0 items-center gap-1 border-b border-gray-200 pl-1 pr-2 md:h-14 md:gap-3 md:px-4">
        <button type="button" onClick={() => void exit()} className="inline-flex h-11 items-center gap-1.5 rounded-md px-2.5 text-[15px] font-medium text-gray-700 hover:bg-gray-100" aria-label="나가기">
          <ArrowLeft size={20} /><span className="hidden md:inline">나가기</span>
        </button>
        <span className={`inline-flex min-w-0 items-center gap-1.5 truncate text-[13px] ${statusText.tone === 'warn' ? 'text-accent' : 'text-gray-500'}`} role="status" aria-live="polite">
          {statusText.tone === 'ok' && <Check size={14} className="shrink-0" />}
          {statusText.tone === 'warn' && save.status === 'retrying' && <CloudOff size={14} className="shrink-0" />}
          <span className="truncate">{uploading > 0 ? `올리는 중 ${uploading}개 · ` : ''}{statusText.text}</span>
        </span>
        <span className="flex-1" />
        <span className="hidden text-[13px] tabular-nums text-gray-500 lg:inline">{chars.toLocaleString()}자</span>
        <div className="relative">
          <button type="button" aria-label="더 보기" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)} className="inline-flex h-11 w-11 items-center justify-center rounded-md text-gray-600 hover:bg-gray-100"><MoreHorizontal size={20} /></button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} aria-hidden="true" />
              <div role="menu" className="absolute right-0 top-12 z-20 w-56 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-[0_6px_20px_rgba(0,0,0,0.08)]">
                <button type="button" role="menuitem" className="block w-full px-4 py-2.5 text-left text-[14px] text-gray-800 hover:bg-gray-50" onClick={() => { setMenuOpen(false); void controller.current?.flush().then((ok) => (ok ? toast.success('저장했어요.') : toast.error('아직 저장하지 못했어요. 이 기기에 보관해 두었어요.'))); }}>지금 저장</button>
                <button type="button" role="menuitem" className="block w-full px-4 py-2.5 text-left text-[14px] text-accent hover:bg-gray-50" onClick={() => { setMenuOpen(false); setDialog({ kind: 'discard' }); }}>{postId ? '고친 것 버리기' : '쓰던 글 버리기'}</button>
              </div>
            </>
          )}
        </div>
        <button type="button" onClick={() => editor && setPreview({ doc: savableDoc(editor.getJSON() as PostDoc), width: 'pc' })} className="inline-flex h-11 items-center gap-1.5 rounded-md px-2.5 text-[14px] font-medium text-gray-700 hover:bg-gray-100" aria-label="미리보기">
          <Eye size={19} className="md:hidden" /><span className="hidden md:inline">미리보기</span>
        </button>
        <button type="button" onClick={() => void publish()} disabled={publishing} className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg bg-gray-900 px-4 text-[14px] font-semibold text-white disabled:opacity-60 md:px-5">
          {publishing && <Loader2 size={15} className="animate-spin" />}{postId ? '수정 완료' : '등록'}
        </button>
      </header>

      {/* 넓은 화면 도구 막대 */}
      {fine && editor && (
        <div className="shrink-0 border-b border-gray-200 bg-white">
          <DesktopToolbar editor={editor} actions={toolbarActions} />
        </div>
      )}

      {banner && <div className="shrink-0">{banner}</div>}

      {/* 본문 — 이 안에서만 스크롤 */}
      <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain" data-editor-scroll>
        <div className="mx-auto w-full max-w-[1040px] px-5 pb-10 pt-6 md:px-12 md:pt-12">
          <div className="mx-auto max-w-[680px]">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
              <label className="relative inline-flex items-center">
                <span className="sr-only">탭</span>
                <select
                  value={categoryId ?? ''}
                  onChange={(e) => {
                    const id = e.target.value === '' ? null : Number(e.target.value);
                    setCategoryId(id);
                    const t = tabs.find((x) => x.id === id);
                    if (t && t.allowAnonymous === false && anonymous) { setAnonymous(false); toast(`‘${t.name}’ 탭은 실명으로 써요.`); }
                  }}
                  className="h-9 appearance-none rounded-md bg-transparent pr-6 text-[14px] font-medium text-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400"
                >
                  <option value="">탭 없음</option>
                  {writable.map((t) => <option key={t.id} value={t.id}>{t.name}{t.writePolicy === 'writers' ? ' (필진)' : t.writePolicy === 'admin' ? ' (관리자)' : ''}</option>)}
                </select>
                <ChevronDown size={14} className="pointer-events-none absolute right-1 text-accent" />
              </label>
              <label className={`inline-flex min-h-9 items-center gap-2 text-[14px] ${anonAllowed ? 'cursor-pointer text-gray-700' : 'cursor-not-allowed text-gray-400'}`}
                onClick={(e) => { if (!anonAllowed) { e.preventDefault(); toast(initial.notice || notice ? '공지는 익명으로 쓸 수 없어요.' : `‘${tab?.name}’ 탭은 실명으로 써요.`, { id: 'anon' }); } }}>
                <input type="checkbox" checked={anonAllowed && anonymous} disabled={!anonAllowed} onChange={(e) => setAnonymous(e.target.checked)} className="h-4 w-4 accent-gray-900" />
                익명으로 쓰기
              </label>
              {isAdmin && !postId && (
                <>
                  <label className="inline-flex min-h-9 cursor-pointer items-center gap-2 text-[14px] text-gray-700">
                    <input type="checkbox" checked={notice} onChange={(e) => { setNotice(e.target.checked); if (e.target.checked) setAnonymous(false); }} className="h-4 w-4 accent-gray-900" />공지
                  </label>
                  <label className="inline-flex min-h-9 cursor-pointer items-center gap-2 text-[14px] text-gray-700">
                    <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} className="h-4 w-4 accent-gray-900" />맨 위 고정
                  </label>
                </>
              )}
              {tab?.writePolicy === 'writers' && <span className="text-[13px] text-gray-500">필진 탭 — 올리면 이웃에게 알림이 가요</span>}
            </div>
            <label className="sr-only" htmlFor="post-title">제목</label>
            <textarea
              id="post-title"
              ref={titleEl}
              value={title}
              rows={1}
              maxLength={POST_DOC_LIMITS.titleChars}
              onChange={(e) => setTitle(e.target.value.replace(/\n/g, ' '))}
              onFocus={() => setTyping(true)}
              onBlur={() => setTyping(false)}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                if (e.key === 'Enter' || (e.key === 'ArrowDown' && e.currentTarget.selectionStart === e.currentTarget.value.length)) {
                  e.preventDefault();
                  editor?.commands.focus('start');
                }
              }}
              placeholder="제목"
              enterKeyHint="next"
              className="mt-3 block w-full resize-none overflow-hidden border-0 bg-transparent p-0 text-[26px] font-semibold leading-[1.35] tracking-[-0.01em] text-gray-900 placeholder:text-gray-300 focus:outline-none md:text-[36px] md:leading-[1.3]"
            />
            <div className="mb-8 mt-5 h-px bg-gray-200 md:mb-10 md:mt-7" />
          </div>
          {editor && <EditorContent editor={editor} />}
        </div>
      </main>

      {/* 넓은 화면 — 고른 사진 위 도구 · 글자를 고르면 뜨는 막대 · 빈 줄의 [+] */}
      {fine && editor && (
        <>
          <BubbleMenu
            editor={editor}
            pluginKey="postMediaMenu"
            shouldShow={({ state }) => state.selection instanceof NodeSelection && ['figure', 'gallery', 'youtube', 'video', 'poll'].includes(state.selection.node.type.name)}
            options={{ placement: 'top', offset: 10 }}
          >
            {media && <PhotoTools editor={editor} node={media.node} pos={media.pos} actions={photoActions} compact />}
          </BubbleMenu>
          <BubbleMenu
            editor={editor}
            pluginKey="postTextMenu"
            shouldShow={({ state, editor: e }) => !(state.selection instanceof NodeSelection) && !state.selection.empty && e.isFocused}
            options={{ placement: 'top', offset: 8 }}
          >
            <TextBubble editor={editor} onLink={openLinkDialog} />
          </BubbleMenu>
          <FloatingMenu editor={editor} pluginKey="postPlusMenu" options={{ placement: 'left-start', offset: 12 }}>
            <PlusMenu editor={editor} onPhoto={() => openFiles({ kind: 'insert' })} onVideo={() => videoInput.current?.click()} onPoll={openPoll} />
          </FloatingMenu>
        </>
      )}

      {/* 휴대폰 — 자판 바로 위 막대(사진을 고르면 사진 도구) */}
      {!fine && editor && (
        <div className={`shrink-0 border-t border-gray-200 bg-white ${vv.keyboard ? '' : 'pb-[env(safe-area-inset-bottom)]'}`}>
          {media ? <PhotoTools editor={editor} node={media.node} pos={media.pos} actions={photoActions} /> : <MobileToolbar editor={editor} actions={toolbarActions} typing={typing || vv.keyboard} />}
        </div>
      )}

      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          handleFiles(fileTarget.current.kind === 'replace' ? files.slice(0, 1) : files, fileTarget.current);
        }}
      />
      <input
        ref={videoInput}
        type="file"
        accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.m4v,.webm"
        multiple
        className="hidden"
        aria-label="동영상 파일 고르기"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          handleVideos(files);
        }}
      />

      {/* 창 */}
      {dialog?.kind === 'photos' && editor && (
        <PhotoChoiceDialog count={dialog.files.length} onClose={() => setDialog(null)} onChoose={(mode: InsertMode) => { insertPhotos(editor, dialog.files, mode, dialog.at); setDialog(null); }} />
      )}
      {dialog?.kind === 'link' && (
        <PromptDialog
          title={dialog.href ? '링크 고치기' : '링크 넣기'}
          label="링크 주소"
          initial={dialog.href}
          placeholder="https://… 또는 artlink.cc/…"
          inputMode="url"
          hint={dialog.from === dialog.to ? '고른 글자가 없으면 주소가 글자로 들어가요.' : undefined}
          validate={(v) => (normalizeLinkInput(v) ? null : '주소가 올바르지 않아요.')}
          onSubmit={(v) => applyLink(v, dialog)}
          onRemove={dialog.href ? () => { editor?.chain().focus().setTextSelection({ from: dialog.from, to: dialog.to }).extendMarkRange('link').unsetLink().run(); setDialog(null); } : undefined}
          removeText="링크 빼기"
          onClose={() => { setDialog(null); editor?.commands.focus(); }}
        />
      )}
      {dialog?.kind === 'poll' && editor && (
        <PollDialog
          initial={dialog.initial}
          locked={dialog.locked}
          onClose={() => { setDialog(null); editor.commands.focus(); }}
          onSubmit={(poll) => {
            const cur = findPoll(editor);
            if (cur) editor.chain().command(({ tr }) => { tr.setNodeMarkup(cur.pos, undefined, { ...poll }); return true; }).setNodeSelection(cur.pos).run();
            else insertBlocks(editor, [{ type: 'poll', attrs: { ...poll } }]);
            setDialog(null);
          }}
          onRemove={dialog.initial ? () => {
            if (dialog.locked && !window.confirm('이미 투표한 사람이 있어요. 투표를 빼고 글을 올리면 모인 표가 사라져요. 뺄까요?')) return;
            const cur = findPoll(editor);
            if (cur) editor.chain().focus().deleteRange({ from: cur.pos, to: cur.pos + editor.state.doc.nodeAt(cur.pos)!.nodeSize }).run();
            setDialog(null);
          } : undefined}
        />
      )}
      {dialog?.kind === 'alt' && (
        <PromptDialog
          title="대체 글"
          label="대체 글"
          initial={dialog.alt}
          placeholder="예: 작업실 바닥에 늘어놓은 그림 스무 점"
          hint="사진을 볼 수 없는 사람(화면 낭독기)에게 읽어 주는 설명이에요. 비우면 사진 설명을 대신 읽어요."
          onSubmit={(v) => {
            const n = editor?.state.doc.nodeAt(dialog.pos);
            if (editor && n?.type.name === 'figure') editor.chain().command(({ tr }) => { tr.setNodeMarkup(dialog.pos, undefined, { ...n.attrs, alt: v.trim().slice(0, POST_DOC_LIMITS.altChars) }); return true; }).setNodeSelection(dialog.pos).run();
            setDialog(null);
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'crop' && editor && (
        <Suspense fallback={<div className="fixed inset-0 z-[95] flex items-center justify-center bg-gray-950"><Loader2 size={22} className="animate-spin text-gray-400" /></div>}>
          <CropDialog
            src={dialog.src}
            onClose={() => setDialog(null)}
            onDone={(file) => {
              // 자르는 동안 글이 바뀌었으면 같은 사진을 다시 찾는다
              let pos = dialog.pos;
              const n = editor.state.doc.nodeAt(pos);
              if (!n || n.attrs.src !== dialog.src) editor.state.doc.descendants((x, p) => { if (x.type.name === 'figure' && x.attrs.src === dialog.src) { pos = p; return false; } return true; });
              replaceFigure(editor, pos, file);
              setDialog(null);
            }}
          />
        </Suspense>
      )}
      {dialog?.kind === 'discard' && (
        <EditorDialog title={postId ? '고친 것을 버릴까요?' : '쓰던 글을 버릴까요?'} onClose={() => setDialog(null)} footer={<>
          <button type="button" className={btnGhost} onClick={() => setDialog(null)}>계속 쓰기</button>
          <button type="button" className={`${btnPrimary} !bg-accent`} onClick={() => void discard()}>버리기</button>
        </>}>
          <p className="text-[14px] leading-relaxed text-gray-600">{postId ? '올린 글은 그대로 두고, 이번에 고친 내용만 지워요.' : '이 글의 작업본과 이 기기에 보관한 내용을 지워요. 되돌릴 수 없어요.'}</p>
        </EditorDialog>
      )}

      {preview && (
        <PreviewOverlay
          doc={preview.doc}
          title={title.trim() || '제목 없음'}
          tabName={tab?.name ?? null}
          anonymous={anonAllowed && anonymous}
          width={preview.width}
          onWidth={(w) => setPreview((p) => (p ? { ...p, width: w } : p))}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  );
}

/* ═════════════════════════ 작은 부품 ═════════════════════════ */

/** 고른 사진·모음·영상 — 선택이 바뀌거나 그 노드의 속성이 바뀌면 다시 그린다(편집기 본체는 트랜잭션마다 다시 그리지 않는다) */
function useSelectedMedia(editor: Editor | null) {
  const sel = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      if (!e) return null;
      const m = selectedMedia(e);
      return m ? { pos: m.pos, type: m.node.type.name, attrs: m.node.attrs } : null;
    },
  });
  if (!editor || !sel) return null;
  const node = editor.state.doc.nodeAt(sel.pos);
  return node ? { node, pos: sel.pos } : null;
}

function ago(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 45) return '방금 전';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}분 전`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}시간 전`;
  return new Date(ms).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
}

function Banner({ title, desc, children, tone }: { title: string; desc: string; children: React.ReactNode; tone?: 'warn' }) {
  return (
    <div className={`border-b ${tone === 'warn' ? 'border-accent/30' : 'border-gray-200'} bg-white`} role="alert">
      <div className="mx-auto flex max-w-[1040px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 md:px-6">
        <div className="min-w-0 flex-1">
          <p className={`text-[14px] font-semibold ${tone === 'warn' ? 'text-accent' : 'text-gray-900'}`}>{title}</p>
          <p className="mt-0.5 text-[13px] leading-snug text-gray-600">{desc}</p>
        </div>
        <div className="flex flex-wrap gap-2">{children}</div>
      </div>
    </div>
  );
}

function TextBubble({ editor, onLink }: { editor: Editor; onLink: () => void }) {
  const s = useFormatState(editor);
  const c = () => editor.chain().focus();
  const sz = 'h-9 w-9';
  return (
    <div role="toolbar" aria-label="글자 서식" className="flex items-center gap-0.5 rounded-lg border border-gray-200 bg-white p-1 shadow-[0_6px_20px_rgba(0,0,0,0.08)]">
      <ToolButton label="굵게" active={s.bold} onClick={() => c().toggleBold().run()} className={sz}><Bold size={16} /></ToolButton>
      <ToolButton label="기울임" active={s.italic} onClick={() => c().toggleItalic().run()} className={sz}><Italic size={16} /></ToolButton>
      <ToolButton label="밑줄" active={s.underline} onClick={() => c().toggleUnderline().run()} className={sz}><Underline size={16} /></ToolButton>
      <ToolButton label="취소선" active={s.strike} onClick={() => c().toggleStrike().run()} className={sz}><Strikethrough size={16} /></ToolButton>
      <ToolButton label="형광펜" active={s.highlight} onClick={() => c().toggleMark('highlight').run()} className={sz}><Highlighter size={16} /></ToolButton>
      <ToolButton label="링크" active={s.link} onClick={onLink} className={sz}><Link2 size={16} /></ToolButton>
      <span aria-hidden="true" className="mx-0.5 h-5 w-px bg-gray-200" />
      <ToolButton label="제목" active={s.h2} onClick={() => c().toggleHeading({ level: 2 }).run()} className={sz}><Heading2 size={16} /></ToolButton>
      <ToolButton label="소제목" active={s.h3} onClick={() => c().toggleHeading({ level: 3 }).run()} className={sz}><Heading3 size={16} /></ToolButton>
      <ToolButton label="인용구" active={s.quote && !s.pull} onClick={() => (s.pull ? togglePullQuote(editor) : c().toggleBlockquote().run())} className={sz}><Quote size={16} /></ToolButton>
      <ToolButton label="강조 문장 (가운데 큰 글)" active={s.pull} onClick={() => togglePullQuote(editor)} className={sz}><TextQuote size={16} /></ToolButton>
    </div>
  );
}

function PlusMenu({ editor, onPhoto, onVideo, onPoll }: { editor: Editor; onPhoto: () => void; onVideo: () => void; onPoll: () => void }) {
  const [open, setOpen] = useState(false);
  const item = (label: string, icon: React.ReactNode, run: () => void) => (
    <button type="button" role="menuitem" onMouseDown={(e) => e.preventDefault()} onClick={() => { setOpen(false); run(); }}
      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[14px] text-gray-800 hover:bg-gray-50">{icon}{label}</button>
  );
  return (
    <div className="relative">
      <button type="button" aria-label="블록 넣기" aria-expanded={open} onMouseDown={(e) => e.preventDefault()} onClick={() => setOpen((o) => !o)}
        className={`flex h-8 w-8 items-center justify-center rounded-full border text-gray-500 transition-colors ${open ? 'rotate-45 border-gray-900 text-gray-900' : 'border-gray-300 hover:border-gray-500 hover:text-gray-800'}`}>
        <Plus size={16} />
      </button>
      {open && (
        <div role="menu" className="absolute left-10 top-0 z-30 w-44 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-[0_6px_20px_rgba(0,0,0,0.08)]">
          {item('사진', <ImagePlus size={16} />, onPhoto)}
          {item('동영상', <Video size={16} />, onVideo)}
          {item('투표', <ListChecks size={16} />, onPoll)}
          {item('팁 상자', <Lightbulb size={16} />, () => toggleCallout(editor))}
          {item('인용구', <Quote size={16} />, () => editor.chain().focus().toggleBlockquote().run())}
          {item('강조 문장', <TextQuote size={16} />, () => togglePullQuote(editor))}
          {item('구분선', <Minus size={16} />, () => editor.chain().focus().setHorizontalRule().run())}
        </div>
      )}
    </div>
  );
}

function PreviewOverlay({ doc, title, tabName, anonymous, width, onWidth, onClose }: {
  doc: PostDoc; title: string; tabName: string | null; anonymous: boolean; width: 'pc' | 'mobile'; onWidth: (w: 'pc' | 'mobile') => void; onClose: () => void;
}) {
  const { user } = useAuthStore();
  const name = anonymous ? '익명' : (user?.nickname || user?.name || '');
  const fine = useFinePointer();
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [onClose]);
  return (
    <div role="dialog" aria-modal="true" aria-label="미리보기" className="fixed inset-0 z-[90] flex flex-col bg-gray-100">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-gray-200 bg-white px-3 md:px-5">
        <span className="text-[15px] font-semibold text-gray-900">미리보기</span>
        <span className="text-[13px] text-gray-500">올리면 이렇게 보여요</span>
        <span className="flex-1" />
        {fine && (
          <div role="radiogroup" aria-label="화면 폭" className="flex gap-0.5 rounded-lg border border-gray-200 p-0.5">
            {(['pc', 'mobile'] as const).map((w) => (
              <button key={w} type="button" role="radio" aria-checked={width === w} onClick={() => onWidth(w)}
                className={`h-8 rounded-md px-3 text-[13px] font-medium ${width === w ? 'bg-gray-900 text-white' : 'text-gray-600'}`}>{w === 'pc' ? 'PC' : '휴대폰'}</button>
            ))}
          </div>
        )}
        <button type="button" onClick={onClose} className="h-10 rounded-lg bg-gray-900 px-4 text-[14px] font-semibold text-white">닫기</button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className={`mx-auto bg-white ${width === 'mobile' && fine ? 'my-6 w-[390px] shadow-[0_0_0_1px_rgba(0,0,0,0.06)]' : 'w-full'}`}>
          <article className={`mx-auto ${width === 'mobile' && fine ? 'px-5 py-8' : 'max-w-[1040px] px-5 py-10 md:px-12 md:py-16'}`}>
            <div className="mx-auto max-w-[680px]">
              {tabName && <p className="text-[14px] font-medium text-accent">{tabName}</p>}
              <h1 className={`mt-3 font-semibold leading-[1.3] tracking-[-0.01em] text-gray-900 ${width === 'mobile' && fine ? 'text-[28px]' : 'text-[28px] md:text-[40px]'}`}>{title}</h1>
              <p className="mt-4 border-b border-gray-200 pb-6 text-[13px] text-gray-500">{name}{!anonymous && user?.role ? ` · ${roleLabel(user.role)}` : ''} · 지금</p>
            </div>
            <div className={`mt-8 ${width === 'mobile' && fine ? 'post-preview-mobile' : ''}`}>
              <PostBody doc={doc} />
            </div>
          </article>
        </div>
      </div>
    </div>
  );
}
