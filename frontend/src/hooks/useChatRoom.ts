import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import api from '@/lib/axios';
import { mergeMessages, applyReadState } from '@/lib/chatView';
import { chatRead, chatsChanged, CHAT_POKE_EVENT } from '@/lib/chatCache';
import type {
  AttachmentType, ChatDetailResponse, ChatMessage, ChatRefType, ChatRoomMeta, PendingMessage,
} from '@/lib/chatTypes';

/**
 * 대화방 하나의 데이터 — 방을 열 때 최근 150개, 그 뒤엔 **새 것만** 4초마다(`?after=<마지막 id>`).
 *
 * ## 왜 쿼리 캐시(useQuery)가 아니라 제 상태인가 (2026-11-19 개편)
 * 이 방은 '응답 하나'가 아니라 **이어 붙는 흐름**이다. 예전엔 useQuery 응답을 누적 state 에 옮겨 담았는데,
 * 캐시에 남은 직전 폴링 응답(빈 배열)이 다시 열 때 그대로 나와 텅 빈 방·`after=0` 같은 함정을 따로 막아야 했다.
 * 방 화면을 `key={chatId}` 로 그리고 상태를 여기서만 들면 방과 함께 태어나고 죽는다 — 방을 바꿔도 앞 방의 말이 한 프레임도 안 남는다.
 *
 * ## 그대로 지키는 규칙(CLAUDE.md '대화' 절)
 *  · 커서는 **id** — createdAt 은 동시 삽입에서 순서가 어긋난다 · 빈 응답으로 커서를 0 으로 만들지 말 것(null ≠ 0)
 *  · 받은 것은 id 로 **병합**(나중 것이 이긴다) · 읽음은 `readers` 로 **전부** 다시 계산
 *  · 탭이 가려지면 폴링을 쉬고, 돌아오면(보이기·창 포커스) 곧바로 받는다 · 앱 푸시가 오면 곧바로(`pokeChat`)
 *
 * ## 보내기는 낙관적으로
 * 누르는 순간 말풍선이 뜬다(`pending`). 서버 응답이 오면 진짜 메시지로 바꾸고, 실패하면 그 자리에 '다시 보내기'.
 * 보내는 일은 **한 줄로** 처리한다(사진 여러 장도 고른 순서대로) — 순서가 뒤섞이지 않게.
 */
export const CHAT_PAGE = 150;
export const CHAT_POLL_MS = 4000;

/** 첨부 한도 — 서버(multer)가 최종 판정, 여기선 헛된 업로드를 줄이려고 미리 자른다 */
export const ATTACH_LIMITS: Record<AttachmentType, { bytes: number; endpoint: string; field: string; label: string }> = {
  IMAGE: { bytes: 15 * 1024 * 1024, endpoint: '/upload/image', field: 'image', label: '사진' },
  VIDEO: { bytes: 25 * 1024 * 1024, endpoint: '/upload/video', field: 'video', label: '동영상' },
  FILE: { bytes: 20 * 1024 * 1024, endpoint: '/upload/file', field: 'file', label: '파일' },
};

type ApiError = { response?: { status?: number; data?: { error?: string } } };
const errText = (e: unknown, fallback: string) => (e as ApiError)?.response?.data?.error || fallback;

function metaFrom(d: ChatDetailResponse, prev: ChatRoomMeta | null): ChatRoomMeta {
  return {
    id: d.id,
    kind: d.kind,
    title: d.title,
    exhibition: d.exhibition,
    participants: d.participants,
    muted: d.muted ?? prev?.muted ?? false,
    hidden: d.hidden ?? prev?.hidden ?? false,
    // 아래는 방을 열 때만 온다 — 폴링 응답엔 없으니 들고 있던 것을 쓴다
    counterpart: d.counterpart !== undefined ? d.counterpart : prev?.counterpart ?? null,
    operatorIds: d.operatorIds ?? prev?.operatorIds ?? [],
    context: d.context !== undefined ? d.context : prev?.context ?? null,
    canSend: d.canSend ?? prev?.canSend ?? true,
    blockReason: d.blockReason !== undefined ? d.blockReason : prev?.blockReason ?? null,
  };
}

export function useChatRoom(chatId: number, myId: number) {
  const qc = useQueryClient();
  const [meta, setMeta] = useState<ChatRoomMeta | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState<'notfound' | 'network' | null>(null);
  const [loaded, setLoaded] = useState(false);

  const cursor = useRef<number | null>(null);          // 마지막으로 받은 메시지 id(null = 아직 첫 적재 전)
  const kindRef = useRef<'DIRECT' | 'GROUP'>('DIRECT');
  const readersRef = useRef<ChatDetailResponse['readers']>([]);
  const pollNow = useRef<() => void>(() => {});

  /** 받은 메시지·읽음을 합친다 */
  const absorb = useCallback((d: ChatDetailResponse) => {
    kindRef.current = d.kind;
    readersRef.current = d.readers ?? readersRef.current;
    setMessages((prev) => applyReadState(mergeMessages(prev, d.messages), d.kind, d.readers ?? [], myId));
    setMeta((prev) => {
      const next = metaFrom(d, prev);
      // 새로 온 말에 맥락 카드가 있으면 머리의 카드도 그것으로(가장 최근 것)
      const lastRef = [...d.messages].reverse().find((m) => m.ref);
      if (lastRef?.ref && (!next.context || lastRef.id > next.context.messageId)) next.context = { ...lastRef.ref, messageId: lastRef.id };
      return next;
    });
    const maxId = d.messages.reduce((a, m) => Math.max(a, m.id), 0);
    // ⚠️ 빈 응답으로 커서를 0 으로 만들지 말 것 — 0 이면 다음 요청이 `?after=0` 이라 맨 처음 150개를 받아 온다
    if (maxId > 0) cursor.current = Math.max(cursor.current ?? 0, maxId);
  }, [myId]);

  // 열기 + 폴링 — 방(chatId)마다 한 번. 이 effect 안의 `active` 가 그 방의 생명이다(StrictMode 의 두 번 실행도 안전)
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let busy = false;

    const schedule = (ms = CHAT_POLL_MS) => {
      clearTimeout(timer);
      if (active) timer = setTimeout(() => void poll(), ms);
    };

    const poll = async () => {
      if (!active || busy || cursor.current == null) return schedule();
      if (document.visibilityState === 'hidden') return schedule();
      busy = true;
      try {
        const d: ChatDetailResponse = (await api.get(`/chats/${chatId}`, { params: { after: cursor.current } })).data;
        if (!active) return;
        absorb(d);
        if (d.messages.some((m) => m.senderId !== myId)) chatRead(qc, chatId);
        setError(null);
      } catch (e) {
        if (!active) return;
        if ((e as ApiError)?.response?.status === 404) { setError('notfound'); return; }
        // 잠깐 끊긴 것은 다음 차례에 다시 — 화면을 깨지 않는다
      } finally {
        busy = false;
      }
      schedule();
    };

    const init = async () => {
      try {
        const d: ChatDetailResponse = (await api.get(`/chats/${chatId}`, { params: { limit: CHAT_PAGE } })).data;
        if (!active) return;
        absorb(d);
        /* 빈 방이면 커서가 아직 없다(null) — 0 으로 둬야 폴링이 돈다(`?after=0` = 이 방의 모든 말 = 새로 온 첫 말).
           null 로 두면 poll 이 '첫 적재 전'으로 보고 매번 건너뛰어, 상대의 첫 말이 방을 다시 열 때까지 안 보였다. */
        if (cursor.current == null) cursor.current = 0;
        setHasMore(!!d.hasMore);
        setLoaded(true);
        setError(null);
        // 서버가 방을 열면서 읽음을 적었다 — 목록·배지 숫자도 곧바로 맞춘다
        chatRead(qc, chatId);
        schedule();
      } catch (e) {
        if (!active) return;
        setLoaded(true);
        setError((e as ApiError)?.response?.status === 404 ? 'notfound' : 'network');
      }
    };

    pollNow.current = () => { if (cursor.current != null) { clearTimeout(timer); void poll(); } };
    const onVisible = () => { if (document.visibilityState === 'visible') pollNow.current(); };
    const onPoke = (ev: Event) => {
      const id = (ev as CustomEvent<{ chatId: number | null }>).detail?.chatId;
      if (id == null || id === chatId) pollNow.current();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    window.addEventListener(CHAT_POKE_EVENT, onPoke);
    void init();
    return () => {
      active = false;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      window.removeEventListener(CHAT_POKE_EVENT, onPoke);
    };
  }, [chatId, myId, qc, absorb]);

  /** [이전 메시지] — 들고 있는 가장 옛 말보다 앞을 받는다. 화면이 스크롤 자리를 지킨다 */
  const loadOlder = useCallback(async (): Promise<boolean> => {
    const first = messages[0];
    if (!first || loadingOlder) return false;
    setLoadingOlder(true);
    try {
      const d: ChatDetailResponse = (await api.get(`/chats/${chatId}`, { params: { before: first.id, limit: CHAT_PAGE } })).data;
      setMessages((prev) => applyReadState(mergeMessages(prev, d.messages), d.kind, d.readers ?? [], myId));
      setHasMore(!!d.hasMore);
      return true;
    } catch {
      return false;
    } finally {
      setLoadingOlder(false);
    }
  }, [chatId, messages, loadingOlder, myId]);

  /* ───────────── 보내기 — 한 줄로 처리 ───────────── */
  const queue = useRef<PendingMessage[]>([]);
  const running = useRef(false);

  const patchPending = useCallback((tempId: string, patch: Partial<PendingMessage> | null) =>
    setPending((prev) => (patch ? prev.map((p) => (p.tempId === tempId ? { ...p, ...patch } : p)) : prev.filter((p) => p.tempId !== tempId))), []);

  const runQueue = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      while (queue.current.length) {
        const job = queue.current.shift()!;
        try {
          let attachment: { attachmentUrl: string; attachmentType: AttachmentType; attachmentName?: string; attachmentSize?: number } | null = null;
          if (job.file && job.attachmentType) {
            const spec = ATTACH_LIMITS[job.attachmentType];
            const form = new FormData();
            form.append(spec.field, job.file);
            const { data } = await api.post(spec.endpoint, form, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120000 });
            attachment = {
              attachmentUrl: data.url,
              attachmentType: job.attachmentType,
              attachmentName: job.attachmentType === 'FILE' ? (data.originalName || job.file.name) : undefined,
              attachmentSize: data.size ?? job.file.size,
            };
          }
          const res = await api.post<ChatMessage>(`/chats/${chatId}/messages`, {
            content: job.content || undefined,
            ...(attachment ?? {}),
            ...(job.ref ? { ref: job.ref } : {}),
          });
          const sent = res.data;
          setMessages((prev) => applyReadState(mergeMessages(prev, [sent]), kindRef.current, readersRef.current ?? [], myId));
          if (sent.ref) setMeta((m) => (m ? { ...m, context: { ...sent.ref!, messageId: sent.id } } : m));
          /* ⚠️ 커서(마지막으로 받은 id)를 내가 보낸 말의 id 로 올리지 말 것 — 그 사이 상대가 보낸 말(id 가 더 작다)을
             다음 폴링 `?after=` 가 건너뛰어 **영영 안 보인다**(둘이 동시에 말할 때 흔하다). 커서는 폴링만 올린다 —
             다음 폴링이 내 말을 한 번 더 받아 와도 id 로 병합되니 겹치지 않는다. 회귀 `useChatRoom.test.ts`. */
          patchPending(job.tempId, null);
          if (job.previewUrl) URL.revokeObjectURL(job.previewUrl);
          chatsChanged(qc);
        } catch (e) {
          const status = (e as ApiError)?.response?.status;
          patchPending(job.tempId, { status: 'failed', error: errText(e, '보내지 못했어요.') });
          // 탈퇴·차단 — 보낼 수 없는 방이 됐다(그동안 상대가 막았다). 입력 줄을 그 안내로 바꾼다
          if (status === 403 || (status === 400 && /탈퇴/.test(errText(e, '')))) {
            setMeta((m) => (m ? { ...m, canSend: false, blockReason: m.blockReason ?? (status === 400 ? 'deleted' : 'unavailable') } : m));
          }
        }
      }
    } finally {
      running.current = false;
    }
  }, [chatId, myId, qc, patchPending]);

  const enqueue = useCallback((items: PendingMessage[]) => {
    if (!items.length) return;
    setPending((prev) => [...prev, ...items]);
    queue.current.push(...items);
    void runQueue();
  }, [runQueue]);

  const tempId = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

  const sendText = useCallback((content: string, ref?: { type: ChatRefType; id: number } | null) => {
    const text = content.trim();
    if (!text && !ref) return;
    enqueue([{ tempId: tempId(), createdAt: new Date().toISOString(), content: text, ref: ref ?? null, status: 'sending' }]);
  }, [enqueue]);

  /** 사진은 여러 장(최대 10) · 동영상·파일은 한 개씩 — 한도를 넘는 건 이유를 돌려준다(화면이 알림으로) */
  const sendFiles = useCallback((files: File[], type: AttachmentType): string | null => {
    const spec = ATTACH_LIMITS[type];
    const picked = files.slice(0, type === 'IMAGE' ? 10 : 1);
    const over = picked.filter((f) => f.size > spec.bytes);
    const ok = picked.filter((f) => f.size <= spec.bytes);
    enqueue(ok.map((file) => ({
      tempId: tempId(), createdAt: new Date().toISOString(), content: '', file, attachmentType: type,
      previewUrl: type === 'FILE' ? undefined : URL.createObjectURL(file), status: 'sending' as const,
    })));
    if (over.length) return `${spec.label}은(는) 최대 ${Math.round(spec.bytes / 1024 / 1024)}MB 까지 보낼 수 있어요.`;
    if (files.length > picked.length) return type === 'IMAGE' ? '사진은 한 번에 10장까지 보낼 수 있어요.' : null;
    return null;
  }, [enqueue]);

  const retry = useCallback((id: string) => {
    const item = pending.find((p) => p.tempId === id);
    if (!item) return;
    const again = { ...item, status: 'sending' as const, error: undefined };
    setPending((prev) => prev.map((p) => (p.tempId === id ? again : p)));
    queue.current.push(again);
    void runQueue();
  }, [pending, runQueue]);

  const discard = useCallback((id: string) => {
    setPending((prev) => {
      const item = prev.find((p) => p.tempId === id);
      if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl);
      return prev.filter((p) => p.tempId !== id);
    });
  }, []);

  // 방을 떠날 때 미리보기 주소를 돌려준다(렌더 중에 ref 를 쓰지 않는다 — 들고 있는 값은 effect 가 옮긴다)
  const pendingRef = useRef<PendingMessage[]>([]);
  useEffect(() => { pendingRef.current = pending; }, [pending]);
  useEffect(() => () => { for (const p of pendingRef.current) if (p.previewUrl) URL.revokeObjectURL(p.previewUrl); }, []);

  return {
    meta, setMeta, messages, pending, hasMore, loadingOlder, loaded, error,
    loadOlder, sendText, sendFiles, retry, discard,
    pollNow: () => pollNow.current(),
  };
}
