import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Send, Users, MessageCircle, ArrowLeft, Paperclip, Image as ImageIcon, Film, FileText, Loader2, Download, X, UserPlus } from 'lucide-react';
import { createPortal } from 'react-dom';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import { useAuthStore } from '@/stores/authStore';
import { displayName } from '@/lib/utils';
// 표시 규칙(묶음·제목·시각)은 화면 밖에 두고 테스트로 지킨다 — lib/chatView.ts
import {
  chatTitle, groupFlags, showsSenderName, timeLabel,
  mergeMessages, applyReadState, type ChatReader,
} from '@/lib/chatView';

/**
 * 대화 — 갠톡(1:1)과 단톡(공모방)을 한 화면에서 본다.
 *
 * ## 예전 쪽지와 무엇이 다른가
 * 예전에는 제목+본문의 '쪽지'였고, 라우트에 "작가는 갤러리에게만" 같은 역할 규칙이 박혀 있어
 * 작가끼리는 대화 자체가 불가능했다. 지금은 **방에 들어가 있으면 대화할 수 있다** — 그게 전부다.
 *
 * ## 대신 방이 생기는 길목이 좁다
 *  · 갠톡 — 둘러보기 작품 모달 / 작가 홈페이지의 [메시지] 버튼 (그 사람을 보고 시작)
 *  · 단톡 — 공모가 승인되면 서버가 자동 생성. 갤러리와 수락 작가가 자동 참여자
 * 그래서 이 화면에는 임의 검색으로 아무나 찾아 말 거는 기능이 없다.
 * **딱 하나 예외** — 이미 **서로 이웃**인 사람에게는 목록 위 [이웃에게 메시지]로 바로 갠톡을 연다.
 *   (서로 이웃 = 양방향 팔로우. 임의 검색이 아니라 이미 맺어진 관계라 설계 전제를 깨지 않는다)
 *
 * ## 읽음
 *  · 갠톡 : 내가 보낸 말 옆에 '읽음'
 *  · 단톡 : 내가 보낸 말 옆에 아직 안 읽은 사람 수 (카카오톡과 같은 방식)
 */
interface ChatUser { id: number; name: string; nickname?: string | null; avatar?: string | null; role?: string }
interface ChatSummary {
  id: number;
  kind: 'DIRECT' | 'GROUP';
  title: string | null;
  exhibitionId: number | null;
  lastMessageAt: string;
  unread: number;
  participants: ChatUser[];
  lastMessage: { content: string; senderId: number; createdAt: string } | null;
}
type AttachmentType = 'IMAGE' | 'VIDEO' | 'FILE';
interface ChatMessage {
  id: number; senderId: number; content: string; createdAt: string;
  sender: ChatUser; read: boolean | null; unreadBy: number | null;
  attachmentUrl?: string | null;
  attachmentType?: AttachmentType | null;
  attachmentName?: string | null;
  attachmentSize?: number | null;
}
interface ChatDetail {
  id: number; kind: 'DIRECT' | 'GROUP'; title: string | null;
  exhibition: { id: number; title: string } | null;
  participants: ChatUser[]; otherCount: number; messages: ChatMessage[];
  /** 더 앞(과거) 메시지가 남아 있는가 — 첫 로드·[이전 메시지]에서만 의미가 있다 */
  hasMore?: boolean;
  /** 참여자별 마지막 읽은 시각 — 캐시에 든 옛 메시지의 읽음 표시를 갱신하는 근거 */
  readers?: ChatReader[];
}

/**
 * 방을 열 때 받는 메시지 수. 서버 `CHAT_PAGE_SIZE` 와 같은 값.
 * ⚠️ 폴링은 이 창을 다시 받지 않는다 — `?after=<마지막 id>` 로 **새 것만** 받는다.
 *    예전엔 8초마다 방을 통째로 다시 받아서, 방이 오래될수록 무거워졌다(5,000개 방 = 175KB/s).
 */
const CHAT_PAGE = 150;

/** 바이트 → 사람이 읽는 크기 */
function formatBytes(n?: number | null): string {
  if (!n || n <= 0) return '';
  const mb = n / 1024 / 1024;
  if (mb >= 1) return `${mb.toFixed(1)}MB`;
  return `${Math.max(1, Math.round(n / 1024))}KB`;
}

/**
 * 대화 첨부 렌더 — 사진(클릭 확대) / 동영상(인라인 재생) / 파일(다운로드).
 * ⚠️ `<a download>` 은 크로스오리진(R2)에서 브라우저가 무시할 수 있어 새 탭으로도 열리게 target 을 함께 준다.
 */
function ChatAttachment({ message, onOpenImage }: { message: ChatMessage; onOpenImage: (url: string) => void }) {
  const url = message.attachmentUrl!;
  if (message.attachmentType === 'IMAGE') {
    return (
      <button type="button" onClick={() => onOpenImage(url)} className="block overflow-hidden rounded-2xl border border-gray-100 cursor-pointer">
        <img src={url} alt="" loading="lazy" className="max-h-64 max-w-full object-cover hover:opacity-90" />
      </button>
    );
  }
  if (message.attachmentType === 'VIDEO') {
    return (
      <video src={url} controls preload="metadata" className="max-h-64 max-w-full rounded-2xl border border-gray-100 bg-black" />
    );
  }
  // FILE
  const name = message.attachmentName || '첨부파일';
  const size = formatBytes(message.attachmentSize);
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      download={name}
      className="flex items-center gap-2.5 rounded-2xl border border-gray-200 bg-white px-3 py-2.5 hover:bg-gray-50"
    >
      <span className="grid h-9 w-9 place-items-center rounded-lg bg-gray-100 text-gray-500 shrink-0"><FileText size={18} /></span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-gray-900">{name}</span>
        <span className="block text-xs text-gray-400">{size ? `${size} · ` : ''}다운로드</span>
      </span>
      <Download size={16} className="ml-auto shrink-0 text-gray-400" />
    </a>
  );
}

export default function MessagesPage() {
  const { user } = useAuthStore();
  const myId = user?.id ?? 0;
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const openId = Number(searchParams.get('chat')) || null;
  const [draft, setDraft] = useState('');
  const [attachOpen, setAttachOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  // 서로 이웃에게 바로 말 걸기 — '아무나 검색'이 아니라 이미 서로 이웃인 사람만. 설계상 유일한 진입점 확장.
  const [pickerOpen, setPickerOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: chats = [], isLoading } = useQuery<ChatSummary[]>({
    queryKey: ['chats'],
    queryFn: () => api.get('/chats').then(r => r.data),
    refetchInterval: 15000,   // 폴링 — SSE 는 예전 쪽지 전용이라 걷어냈다
  });

  /*
    ── 증분 폴링 ───────────────────────────────────────────────────
    방을 열 때만 최근 150개를 받고, 이후 8초 폴링은 `?after=<마지막 id>` 로 **새 것만** 받는다.
    조용한 방은 응답이 `[]` 라 **방에 몇 개가 쌓였든 폴링 비용이 같다**.
    그래서 메시지는 쿼리 결과가 아니라 여기 누적 state 가 진실이다 — 폴링 응답만 그리면
    새 말 몇 개만 남고 대화가 통째로 사라진다.
  */
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const cursorRef = useRef<number | null>(null);          // 폴링 커서(마지막으로 받은 메시지 id)
  const scrollBoxRef = useRef<HTMLDivElement>(null);

  // 방을 바꾸면 누적분과 커서를 비운다 (안 비우면 남의 방 메시지가 섞인다)
  useEffect(() => {
    cursorRef.current = null;
    setMessages([]);
    setHasMore(false);
  }, [openId]);

  const { data: chat } = useQuery<ChatDetail & { mode: 'init' | 'poll' }>({
    queryKey: ['chat', openId],
    queryFn: async () => {
      const after = cursorRef.current;
      const params = after == null ? { limit: CHAT_PAGE } : { after };
      const d: ChatDetail = await api.get(`/chats/${openId}`, { params }).then(r => r.data);
      return { ...d, mode: after == null ? 'init' : 'poll' };
    },
    enabled: !!openId,
    refetchInterval: 8000,
  });

  // 받은 것을 누적분에 합치고, 읽음 표시는 참여자 lastReadAt 으로 **전부** 다시 계산한다
  // (폴링 응답에는 지난 메시지가 없어서, 상대가 옛 말을 읽어도 그대로면 '읽음'이 안 뜬다)
  useEffect(() => {
    if (!chat) return;
    setMessages(prev => applyReadState(
      mergeMessages(prev, chat.messages), chat.kind, chat.readers ?? [], myId,
    ));
    if (chat.mode === 'init') setHasMore(!!chat.hasMore);
    const maxId = chat.messages.reduce((a, m) => Math.max(a, m.id), 0);
    cursorRef.current = Math.max(cursorRef.current ?? 0, maxId);
  }, [chat, myId]);

  // 방을 안 골랐으면 첫 방을 연다 (넓은 화면에서 빈 오른쪽을 보여주지 않게)
  useEffect(() => {
    if (!openId && chats.length > 0 && window.innerWidth >= 768) {
      setSearchParams({ chat: String(chats[0].id) }, { replace: true });
    }
  }, [chats, openId, setSearchParams]);

  /** [이전 메시지] — 지금 들고 있는 가장 옛 메시지보다 앞을 받는다 */
  const loadOlder = async () => {
    const first = messages[0];
    if (!openId || !first || loadingOlder) return;
    setLoadingOlder(true);
    // 위로 붙이면 보던 자리가 밀린다 — 늘어난 높이만큼 스크롤을 되돌려 제자리를 지킨다
    const box = scrollBoxRef.current;
    const before = box ? box.scrollHeight - box.scrollTop : 0;
    try {
      const d: ChatDetail = await api
        .get(`/chats/${openId}`, { params: { before: first.id, limit: CHAT_PAGE } })
        .then(r => r.data);
      setMessages(prev => applyReadState(
        mergeMessages(prev, d.messages), d.kind, d.readers ?? [], myId,
      ));
      setHasMore(!!d.hasMore);
      requestAnimationFrame(() => { if (box) box.scrollTop = box.scrollHeight - before; });
    } catch (e: any) {
      toast.error(e.response?.data?.error || '이전 메시지를 불러오지 못했습니다.');
    } finally {
      setLoadingOlder(false);
    }
  };

  // 새 말이 오면 아래로. ⚠️ 개수가 아니라 **마지막 id** 를 본다 —
  //    개수로 보면 [이전 메시지]로 위를 채웠을 때도 맨 아래로 튕긴다.
  const lastMsgId = messages[messages.length - 1]?.id;
  useEffect(() => { bottomRef.current?.scrollIntoView({ block: 'end' }); }, [lastMsgId, openId]);

  const send = useMutation({
    mutationFn: (payload: {
      content?: string;
      attachmentUrl?: string; attachmentType?: AttachmentType; attachmentName?: string; attachmentSize?: number;
    }) => api.post(`/chats/${openId}/messages`, payload),
    onSuccess: () => {
      setDraft('');
      queryClient.invalidateQueries({ queryKey: ['chat', openId] });
      queryClient.invalidateQueries({ queryKey: ['chats'] });
      queryClient.invalidateQueries({ queryKey: ['chat-unread'] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || '보내지 못했습니다.'),
  });

  // 서로 이웃 목록 — 피커를 열 때만 부른다
  const { data: mutuals = [], isLoading: mutualsLoading } = useQuery<ChatUser[]>({
    queryKey: ['mutuals'],
    queryFn: () => api.get('/follow/mutuals').then(r => r.data),
    enabled: pickerOpen,
  });

  // 이웃을 고르면 갠톡을 연다(이미 있으면 그 방으로 — 서버가 멱등 처리)
  const startDirect = useMutation({
    mutationFn: (userId: number) => api.post('/chats/direct', { userId }).then(r => r.data),
    onSuccess: (data: { id: number }) => {
      setPickerOpen(false);
      queryClient.invalidateQueries({ queryKey: ['chats'] });
      setSearchParams({ chat: String(data.id) });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || '대화를 열지 못했습니다.'),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || send.isPending) return;
    send.mutate({ content: text });
  };

  /*
    첨부 보내기 — 화면에서 먼저 업로드(`/api/upload/*`)한 뒤 그 url·메타로 메시지를 만든다.
    ⚠️ 용량 상한은 **서버가 최종 판정**(multer). 여기서도 미리 잘라 헛된 업로드·서버비를 줄인다.
      · 사진 15MB(/upload/image)  · 동영상 25MB(/upload/video)  · 파일 20MB(/upload/file, PDF/DOC/HWP/ZIP)
  */
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [attachKind, setAttachKind] = useState<AttachmentType>('IMAGE');
  const [uploading, setUploading] = useState(false);

  const openPicker = (kind: AttachmentType) => {
    setAttachKind(kind);
    const input = fileInputRef.current;
    if (!input) return;
    input.accept = kind === 'IMAGE' ? 'image/*' : kind === 'VIDEO' ? 'video/*' : '.pdf,.doc,.docx,.hwp,.hwpx,.zip';
    input.value = '';
    input.click();
  };

  const ATTACH_LIMITS: Record<AttachmentType, { bytes: number; endpoint: string; field: string; label: string }> = {
    IMAGE: { bytes: 15 * 1024 * 1024, endpoint: '/upload/image', field: 'image', label: '사진' },
    VIDEO: { bytes: 25 * 1024 * 1024, endpoint: '/upload/video', field: 'video', label: '동영상' },
    FILE: { bytes: 20 * 1024 * 1024, endpoint: '/upload/file', field: 'file', label: '파일' },
  };

  const onFilePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !openId) return;
    const spec = ATTACH_LIMITS[attachKind];
    if (file.size > spec.bytes) {
      toast.error(`${spec.label}은(는) 최대 ${Math.round(spec.bytes / 1024 / 1024)}MB 까지 보낼 수 있습니다.`);
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append(spec.field, file);
      const { data } = await api.post(spec.endpoint, form, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120000 });
      send.mutate({
        attachmentUrl: data.url,
        attachmentType: attachKind,
        attachmentName: attachKind === 'FILE' ? (data.originalName || file.name) : undefined,
        attachmentSize: data.size ?? file.size,
      });
    } catch (err: any) {
      toast.error(err.response?.data?.error || '첨부를 보내지 못했습니다.');
    } finally {
      setUploading(false);
    }
  };

  const sorted = useMemo(() => chats, [chats]);

  return (
    <div className="max-w-7xl mx-auto px-6 md:px-12 py-10 md:py-16">
      <h1 className="text-xl md:text-2xl font-bold tracking-tight font-serif text-gray-900 mb-6">
        Art<span className="text-[#dc3545]">Talk</span>
      </h1>

      <div className="grid gap-0 md:grid-cols-[300px_1fr] rounded-2xl border border-gray-200 overflow-hidden bg-white">
        {/* 목록 — 좁은 화면에서는 방을 고르면 숨긴다 */}
        <div className={`border-gray-200 md:border-r ${openId ? 'hidden md:block' : ''}`}>
          {/* 이웃에게 바로 말 걸기 진입점 — 목록 위에 둔다(임의 검색이 아니라 서로 이웃만) */}
          <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-4 py-2.5">
            <span className="text-xs font-medium text-gray-400">대화 목록</span>
            <button
              onClick={() => setPickerOpen(true)}
              className="inline-flex items-center gap-1 rounded-full border border-gray-200 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50"
            >
              <UserPlus size={13} /> 이웃에게 메시지
            </button>
          </div>
          {isLoading ? (
            <div className="p-6 text-sm text-gray-400">불러오는 중…</div>
          ) : sorted.length === 0 ? (
            <div className="p-6 text-sm text-gray-400 leading-relaxed">
              아직 대화가 없습니다.<br />
              둘러보기에서 작가를 보고 [메시지]를 누르거나, 공모에 참여하면 단체 대화가 생깁니다.
            </div>
          ) : (
            <ul className="max-h-[70vh] overflow-y-auto divide-y divide-gray-50">
              {sorted.map(c => (
                <li key={c.id}>
                  <button
                    onClick={() => setSearchParams({ chat: String(c.id) })}
                    className={`w-full px-4 py-3 text-left transition-colors ${openId === c.id ? 'bg-gray-50' : 'hover:bg-gray-50'}`}
                  >
                    <div className="flex items-center gap-2">
                      {c.kind === 'GROUP'
                        ? <Users size={14} className="shrink-0 text-gray-400" />
                        : <MessageCircle size={14} className="shrink-0 text-gray-400" />}
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900">
                        {chatTitle(c, myId)}
                      </span>
                      {/* 안 읽은 게 있으면 개수 배지 */}
                      {c.unread > 0 && (
                        <span className="shrink-0 rounded-full bg-[#c4302b] px-1.5 py-0.5 text-[10px] font-bold text-white">
                          {c.unread > 99 ? '99+' : c.unread}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 truncate text-xs text-gray-500">
                      {c.lastMessage?.content || '아직 대화가 없습니다.'}
                    </p>
                    <p className="mt-0.5 text-[11px] text-gray-300">{timeLabel(c.lastMessageAt)}</p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* 대화 */}
        <div className={`flex flex-col ${openId ? '' : 'hidden md:flex'}`}>
          {!chat ? (
            <div className="flex flex-1 items-center justify-center p-10 text-sm text-gray-400">
              대화를 선택하세요.
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-3">
                <button onClick={() => setSearchParams({})} className="md:hidden text-gray-400" aria-label="목록으로">
                  <ArrowLeft size={16} />
                </button>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-gray-900">{chatTitle(chat, myId)}</p>
                  <p className="text-[11px] text-gray-400">
                    {chat.kind === 'GROUP' ? `참여자 ${chat.participants.length}명` : '1:1 대화'}
                    {chat.exhibition && ' · 공모 단체 대화'}
                  </p>
                </div>
                {chat.exhibition && (
                  <button
                    onClick={() => navigate(`/exhibitions/${chat.exhibition!.id}`)}
                    className="ml-auto shrink-0 text-xs text-gray-400 hover:text-gray-900"
                  >
                    공모 보기
                  </button>
                )}
              </div>

              <div ref={scrollBoxRef} className="flex-1 overflow-y-auto px-4 py-4 max-h-[55vh] min-h-[280px]">
                {/* 방을 열면 최근 150개만 받는다 — 그 앞은 눌러서 더 받는다 */}
                {hasMore && (
                  <div className="mb-3 text-center">
                    <button
                      type="button"
                      onClick={loadOlder}
                      disabled={loadingOlder}
                      className="rounded-full border border-gray-200 px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-50 disabled:opacity-50"
                    >
                      {loadingOlder ? '불러오는 중…' : '이전 메시지 더 보기'}
                    </button>
                  </div>
                )}
                {messages.length === 0 && (
                  <p className="py-10 text-center text-sm text-gray-400">첫 메시지를 보내보세요.</p>
                )}
                {messages.map((m, i) => {
                  const mine = m.senderId === myId;
                  /*
                    카카오톡처럼 **이어 보낸 말은 묶는다.** (규칙은 lib/chatView.ts, 회귀는 chatView.test.ts)
                    예전엔 메시지마다 이름과 시각이 다 붙어서, 한 사람이 세 줄을 쓰면
                    이름 3번·시각 3번이 나와 정작 말이 안 읽혔다.
                  */
                  const { first, last } = groupFlags(messages, i);
                  return (
                    <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'} ${first ? 'mt-3 first:mt-0' : 'mt-0.5'}`}>
                      <div className={`max-w-[78%] ${mine ? 'items-end' : 'items-start'} flex flex-col`}>
                        {showsSenderName(chat.kind, mine, first) && (
                          <span className="mb-0.5 text-[11px] text-gray-400">{displayName(m.sender)}</span>
                        )}
                        {/* 첨부(사진/동영상/파일) — 있으면 본문 위에 */}
                        {m.attachmentUrl && m.attachmentType && (
                          <ChatAttachment message={m} onOpenImage={setPreviewUrl} />
                        )}
                        {/* 본문 — 첨부만 있는 메시지는 빈 문자열이라 말풍선을 그리지 않는다 */}
                        {m.content && (
                          <div className={`rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-keep [overflow-wrap:anywhere] ${
                            mine ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-900'
                          } ${m.attachmentUrl ? 'mt-1' : ''}`}>
                            {m.content}
                          </div>
                        )}
                        {last && (
                          <span className="mt-0.5 flex items-center gap-1 text-[11px] text-gray-300">
                            {/* 갠톡 '읽음' / 단톡 안 읽은 사람 수 — 내 말에만 붙는다 */}
                            {mine && chat.kind === 'DIRECT' && m.read && <b className="font-medium text-gray-400">읽음</b>}
                            {mine && chat.kind === 'GROUP' && (m.unreadBy ?? 0) > 0 && (
                              <b className="font-medium text-[#c4302b]">{m.unreadBy}</b>
                            )}
                            {timeLabel(m.createdAt)}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
                <div ref={bottomRef} />

                {/* 사진 크게 보기 */}
                {previewUrl && createPortal(
                  <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/85 p-4" onClick={() => setPreviewUrl(null)}>
                    <button aria-label="닫기" className="absolute right-4 top-4 text-white/80 hover:text-white"><X size={24} /></button>
                    <img src={previewUrl} alt="" className="max-h-[92vh] max-w-full object-contain" onClick={e => e.stopPropagation()} />
                  </div>,
                  document.body,
                )}
              </div>

              {/* 첨부 업로드용 숨은 input — 종류에 따라 accept 를 바꿔 연다 */}
              <input ref={fileInputRef} type="file" className="hidden" onChange={onFilePicked} />

              <form onSubmit={submit} className="flex items-center gap-1.5 border-t border-gray-100 p-3">
                {/* 첨부 메뉴 — 사진·동영상·파일 */}
                <div className="relative shrink-0">
                  <button
                    type="button"
                    onClick={() => setAttachOpen(v => !v)}
                    disabled={uploading || send.isPending}
                    aria-label="첨부"
                    className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-40"
                  >
                    {uploading ? <Loader2 size={18} className="animate-spin" /> : <Paperclip size={18} />}
                  </button>
                  {attachOpen && !uploading && (
                    <div className="absolute bottom-11 left-0 z-10 w-40 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg">
                      {([
                        ['IMAGE', '사진', <ImageIcon size={15} key="i" />],
                        ['VIDEO', '동영상', <Film size={15} key="v" />],
                        ['FILE', '파일', <FileText size={15} key="f" />],
                      ] as const).map(([kind, label, icon]) => (
                        <button
                          key={kind}
                          type="button"
                          onClick={() => { setAttachOpen(false); openPicker(kind); }}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                        >
                          {icon} {label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <input
                  value={draft}
                  onChange={e => setDraft(e.target.value.slice(0, 2000))}
                  placeholder={uploading ? '첨부를 보내는 중…' : '메시지를 입력하세요'}
                  disabled={uploading}
                  className="flex-1 min-w-0 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-gray-400 disabled:bg-gray-50"
                />
                <button
                  type="submit"
                  disabled={!draft.trim() || send.isPending || uploading}
                  className="shrink-0 inline-flex items-center gap-1 rounded-lg bg-gray-950 px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
                >
                  <Send size={14} /> 보내기
                </button>
              </form>
            </>
          )}
        </div>
      </div>

      {/* 이웃에게 바로 말 걸기 — 서로 이웃인 사람만 나온다(임의 검색 아님) */}
      {pickerOpen && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 px-4" onClick={() => setPickerOpen(false)}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="mb-1 flex items-center justify-between">
              <h3 className="text-base font-semibold text-gray-900">이웃에게 메시지</h3>
              <button onClick={() => setPickerOpen(false)} aria-label="닫기" className="text-gray-400 hover:text-gray-900"><X size={18} /></button>
            </div>
            <p className="mb-3 text-xs text-gray-400">서로 이웃인 사람에게 바로 말을 걸 수 있어요.</p>
            {mutualsLoading ? (
              <p className="py-6 text-center text-sm text-gray-400">불러오는 중…</p>
            ) : mutuals.length === 0 ? (
              <p className="py-6 text-center text-sm leading-relaxed text-gray-400">
                서로 이웃인 사람이 아직 없습니다.<br />
                <span className="text-xs">상대가 나를 이웃으로 추가하고, 나도 그 사람을 추가하면 여기에 나타납니다.</span>
              </p>
            ) : (
              <ul className="space-y-1">
                {mutuals.map(u => (
                  <li key={u.id}>
                    <button
                      onClick={() => startDirect.mutate(u.id)}
                      disabled={startDirect.isPending}
                      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-gray-50 disabled:opacity-50"
                    >
                      {u.avatar
                        ? <img src={u.avatar} alt="" className="h-8 w-8 rounded-full object-cover" />
                        : <span className="grid h-8 w-8 place-items-center rounded-full bg-gray-100 text-gray-400"><Users size={14} /></span>}
                      <span className="min-w-0 truncate text-sm text-gray-900">{displayName(u)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
