import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { useLocation, useSearchParams } from 'react-router-dom';
import { ArrowLeft, SendHorizonal, Plus, Mail, User as UserIcon, Flag, X, FileText, Building2, Paperclip, Image, Download } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import { compressImage } from '@/lib/utils';
import { useAuthStore } from '@/stores/authStore';
import type { MessageAttachment } from '@/types';

function useIsMobile(breakpoint = 1024) {
  const [isMobile, setIsMobile] = useState(window.innerWidth < breakpoint);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < breakpoint);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, [breakpoint]);
  return isMobile;
}

interface ChatItem {
  partner: { id: number; name: string; role: string; avatar: string | null };
  lastMessage: { content: string; createdAt: string; fromMe: boolean; exhibitionTitle: string | null };
  unreadCount: number;
}

export default function MessagesPage() {
  const { user, token } = useAuthStore();
  const qc = useQueryClient();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const isMobile = useIsMobile();
  const bottomRef = useRef<HTMLDivElement>(null);

  const prefill = location.state as { receiverId?: number; receiverName?: string; exhibitionId?: number } | null;
  const partnerFromUrl = searchParams.get('partner') ? Number(searchParams.get('partner')) : null;

  const [selectedId, setSelectedId] = useState<number | null>(prefill?.receiverId ?? partnerFromUrl ?? null);
  // 첫 대화 시 공모 맥락(있으면 첫 메시지에 연결)
  const [pendingExhibitionId, setPendingExhibitionId] = useState<number | undefined>(prefill?.exhibitionId);

  const [replyContent, setReplyContent] = useState('');
  const [replyAttachments, setReplyAttachments] = useState<MessageAttachment[]>([]);
  const [uploading, setUploading] = useState(false);

  const [showNew, setShowNew] = useState(false);
  const [reportingMsgId, setReportingMsgId] = useState<number | null>(null);
  const [reportReason, setReportReason] = useState<string>('PROFANITY');
  const [reportDetail, setReportDetail] = useState('');
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  // prefill state 정리
  useEffect(() => { if (prefill?.receiverId) window.history.replaceState({}, ''); }, []);
  // 알림/네비게이션 파라미터로 들어온 상대 선택
  useEffect(() => { if (partnerFromUrl) setSelectedId(partnerFromUrl); }, [partnerFromUrl, location.key]);

  // ===== 쿼리 =====
  const { data: chats = [], isLoading: chatsLoading } = useQuery<ChatItem[]>({
    queryKey: ['message-chats'],
    queryFn: () => api.get('/messages/chats').then(r => r.data),
  });

  const { data: thread } = useQuery<any>({
    queryKey: ['message-thread', selectedId],
    queryFn: () => api.get(`/messages/thread/${selectedId}`).then(r => r.data),
    enabled: selectedId != null && selectedId > 0,
  });

  const { data: recipients = [] } = useQuery<any[]>({
    queryKey: ['message-recipients'],
    queryFn: () => api.get('/messages/recipients').then(r => r.data),
    enabled: showNew,
  });

  // 스레드 열람 시 미읽음 갱신
  useEffect(() => {
    if (selectedId) {
      qc.invalidateQueries({ queryKey: ['message-unread-count'] });
      qc.invalidateQueries({ queryKey: ['message-chats'] });
    }
  }, [selectedId, thread?.messages?.length]);

  // 새 메시지 도착 시 맨 아래로
  useEffect(() => {
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
  }, [thread?.messages?.length, selectedId]);

  // ===== SSE 실시간 수신 =====
  useEffect(() => {
    if (!token) return;
    const es = new EventSource(`/api/messages/stream?token=${encodeURIComponent(token)}`);
    es.addEventListener('message', () => {
      qc.invalidateQueries({ queryKey: ['message-chats'] });
      qc.invalidateQueries({ queryKey: ['message-unread-count'] });
      qc.invalidateQueries({ queryKey: ['message-thread'] });
    });
    es.onerror = () => { /* 브라우저가 자동 재연결 */ };
    return () => es.close();
  }, [token, qc]);

  // ===== 파일 업로드 =====
  const handleFileUpload = async (files: FileList) => {
    if (replyAttachments.length + files.length > 5) { toast.error('최대 5개까지 첨부 가능합니다.'); return; }
    setUploading(true);
    try {
      for (const rawFile of Array.from(files)) {
        const isImage = rawFile.type.startsWith('image/');
        const file = isImage ? await compressImage(rawFile) : rawFile;
        const formData = new FormData();
        formData.append(isImage ? 'image' : 'file', file);
        const res = await api.post(isImage ? '/upload/image' : '/upload/file', formData);
        setReplyAttachments(prev => [...prev, { url: res.data.url, name: file.name, type: file.type, size: file.size }]);
      }
    } catch (err: any) { toast.error(err?.response?.data?.error || '파일 업로드에 실패했습니다.'); }
    setUploading(false);
  };

  // ===== Mutations =====
  const sendMutation = useMutation({
    mutationFn: (data: any) => api.post('/messages', data),
    retry: false,
    onError: (err: any) => toast.error(err.response?.data?.error || '전송에 실패했습니다.'),
  });

  const reportMutation = useMutation({
    mutationFn: (data: { messageId: number; reason: string; detail?: string }) => api.post('/reports', data),
    onSuccess: () => { toast.success('신고가 접수되었습니다.'); setReportingMsgId(null); setReportReason('PROFANITY'); setReportDetail(''); qc.invalidateQueries({ queryKey: ['message-thread'] }); },
    onError: (err: any) => toast.error(err.response?.status === 409 ? '이미 신고한 메시지입니다.' : '신고에 실패했습니다.'),
  });

  const send = () => {
    if (!selectedId) return;
    if (!replyContent.trim() && replyAttachments.length === 0) return;
    sendMutation.mutate(
      {
        receiverId: selectedId,
        subject: '대화',
        content: replyContent.trim() || '(첨부)',
        ...(pendingExhibitionId ? { exhibitionId: pendingExhibitionId } : {}),
        ...(replyAttachments.length > 0 ? { attachments: replyAttachments } : {}),
      },
      {
        onSuccess: () => {
          setReplyContent(''); setReplyAttachments([]); setPendingExhibitionId(undefined);
          qc.invalidateQueries({ queryKey: ['message-thread', selectedId] });
          qc.invalidateQueries({ queryKey: ['message-chats'] });
        },
      },
    );
  };

  const handleReport = () => {
    if (!reportingMsgId) return;
    reportMutation.mutate({ messageId: reportingMsgId, reason: reportReason, ...(reportDetail.trim() ? { detail: reportDetail.trim() } : {}) });
  };

  const openChat = (partnerId: number, exhibitionId?: number) => {
    setSelectedId(partnerId);
    setPendingExhibitionId(exhibitionId);
    setShowNew(false);
    setReplyContent(''); setReplyAttachments([]);
  };

  const formatTime = (d: string) => new Date(d).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const formatDay = (d: string) => new Date(d).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });

  const partnerName = thread?.partner?.name || chats.find(c => c.partner.id === selectedId)?.partner.name || '대화';

  // ===== 대화 목록 (좌측) =====
  const chatList = (
    <div className="divide-y divide-gray-100">
      {chatsLoading ? (
        <div className="p-6 text-center text-gray-300 text-sm">불러오는 중…</div>
      ) : chats.length === 0 ? (
        <div className="p-8 text-center text-gray-300 text-sm">
          <Mail size={36} className="mx-auto mb-2 opacity-30" />
          아직 대화가 없습니다.
        </div>
      ) : (
        chats.map(c => (
          <button
            key={c.partner.id}
            onClick={() => openChat(c.partner.id)}
            className={`w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-gray-50 transition-colors ${selectedId === c.partner.id ? 'bg-gray-100' : ''}`}
          >
            <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center flex-none overflow-hidden">
              {c.partner.avatar ? <img src={c.partner.avatar} alt="" className="w-full h-full object-cover" /> : (c.partner.role === 'GALLERY' ? <Building2 size={18} className="text-gray-400" /> : <UserIcon size={18} className="text-gray-400" />)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-gray-900 truncate">{c.partner.name}</p>
                <span className="text-[10px] text-gray-300 flex-none">{formatDay(c.lastMessage.createdAt)}</span>
              </div>
              <p className="text-xs text-gray-400 truncate">{c.lastMessage.fromMe ? '나: ' : ''}{c.lastMessage.content}</p>
            </div>
            {c.unreadCount > 0 && (
              <span className="flex-none min-w-[18px] h-[18px] px-1 rounded-full bg-[#c4302b] text-white text-[10px] font-bold flex items-center justify-center">{c.unreadCount}</span>
            )}
          </button>
        ))
      )}
    </div>
  );

  // ===== 대화창 (우측) =====
  const threadView = selectedId == null ? (
    <div className="flex-1 flex items-center justify-center bg-gray-50 text-gray-300">
      <div className="text-center"><Mail size={48} className="mx-auto mb-3 opacity-20" /><p className="text-sm">대화를 선택하세요</p></div>
    </div>
  ) : (
    <div className="flex flex-col h-full bg-gray-50">
      {/* 헤더 */}
      <div className="px-5 py-3 border-b border-gray-200 bg-white flex-none flex items-center gap-2">
        {isMobile && <button onClick={() => setSelectedId(null)} className="p-1.5 hover:bg-gray-100 -ml-1"><ArrowLeft size={18} /></button>}
        <p className="text-base font-semibold text-gray-900 truncate">{partnerName}</p>
      </div>

      {/* 말풍선 */}
      <div className="flex-1 overflow-y-auto px-4 py-5 space-y-3">
        {(thread?.messages || []).map((msg: any) => {
          const isMe = msg.senderId === user?.id;
          const hidden = msg.sanctioned || msg.reportedByMe;
          let atts: MessageAttachment[] = [];
          try { if (msg.attachments) atts = JSON.parse(msg.attachments); } catch { /* noop */ }
          return (
            <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[78%] ${hidden ? 'opacity-60' : ''}`}>
                {msg.exhibition?.title && (
                  <p className={`text-[10px] text-gray-400 mb-0.5 ${isMe ? 'text-right' : 'text-left'}`}>📌 {msg.exhibition.title}</p>
                )}
                <div className={`px-4 py-2.5 text-sm rounded-2xl ${isMe ? 'bg-gray-900 text-white rounded-br-sm' : 'bg-white border border-gray-200 text-gray-800 rounded-bl-sm'}`}>
                  {msg.sanctioned ? (
                    <p className="italic text-gray-400">제재로 가려진 메시지입니다</p>
                  ) : msg.reportedByMe ? (
                    <p className="italic text-gray-400">신고한 메시지입니다</p>
                  ) : (
                    <p className="whitespace-pre-wrap break-words leading-relaxed">{msg.content}</p>
                  )}
                  {!hidden && atts.length > 0 && (
                    <div className="mt-2 space-y-1.5">
                      {atts.map((a, i) => (
                        a.type.startsWith('image/') ? (
                          <button key={i} onClick={() => setLightboxUrl(a.url)} className="block">
                            <img src={a.url} alt={a.name} className="max-w-[200px] max-h-[150px] rounded-lg border border-gray-200 object-cover cursor-zoom-in hover:opacity-80" />
                          </button>
                        ) : (
                          <a key={i} href={a.url} target="_blank" rel="noopener noreferrer" className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs w-fit ${isMe ? 'bg-white/20 hover:bg-white/30' : 'bg-gray-100 hover:bg-gray-200'}`}>
                            <Download size={12} /><span>{a.name}</span>
                          </a>
                        )
                      ))}
                    </div>
                  )}
                </div>
                <div className={`flex items-center gap-2 mt-1 ${isMe ? 'justify-end' : 'justify-start'}`}>
                  <span className="text-[10px] text-gray-300">{formatTime(msg.createdAt)}</span>
                  {!isMe && !hidden && <button onClick={() => setReportingMsgId(msg.id)} className="text-gray-300 hover:text-[#c4302b]"><Flag size={10} /></button>}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* 입력 */}
      <div className="px-4 py-3 border-t border-gray-200 bg-white flex-none">
        {replyAttachments.length > 0 && (
          <div className="mb-2 space-y-1">
            {replyAttachments.map((a, i) => (
              <div key={i} className="flex items-center gap-2 px-2 py-1 bg-gray-50 rounded text-xs">
                {a.type.startsWith('image/') ? <Image size={10} className="text-gray-400" /> : <FileText size={10} className="text-gray-400" />}
                <span className="flex-1 truncate">{a.name}</span>
                <button onClick={() => setReplyAttachments(prev => prev.filter((_, j) => j !== i))} className="text-gray-400 hover:text-[#c4302b]"><X size={10} /></button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          <label className="p-2.5 text-gray-400 hover:text-gray-900 cursor-pointer flex-none">
            <Paperclip size={16} />
            <input type="file" multiple className="hidden" onChange={e => e.target.files && handleFileUpload(e.target.files)} accept="*/*" />
          </label>
          <textarea
            value={replyContent}
            onChange={e => setReplyContent(e.target.value)}
            maxLength={5000}
            placeholder={uploading ? '업로드 중…' : '메시지를 입력하세요…'}
            rows={1}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            className="flex-1 px-4 py-2.5 border border-gray-200 rounded-2xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-gray-400 max-h-24 overflow-y-auto"
            style={{ minHeight: '42px' }}
          />
          <button onClick={send} disabled={(!replyContent.trim() && replyAttachments.length === 0) || sendMutation.isPending}
            className="p-2.5 bg-gray-900 text-white rounded-full disabled:opacity-30 hover:bg-gray-800 flex-none"><SendHorizonal size={16} /></button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="h-[calc(100dvh-5rem)] flex flex-col">
      <div className="flex justify-between items-center px-4 py-3 border-b border-gray-200 bg-white flex-none">
        <h1 className="text-lg font-semibold font-serif text-gray-900">메시지</h1>
        <button onClick={() => setShowNew(true)} className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-800">
          <Plus size={14} /> 새 대화
        </button>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* 목록 */}
        {(!isMobile || selectedId == null) && (
          <div className={`${isMobile ? 'w-full' : 'w-80 flex-none border-r border-gray-200'} overflow-y-auto bg-white`}>
            {chatList}
          </div>
        )}
        {/* 대화창 */}
        {(!isMobile || selectedId != null) && (
          <div className="flex-1 flex flex-col overflow-hidden">{threadView}</div>
        )}
      </div>

      <AnimatePresence>
        {showNew && (
          <NewChatModal
            recipients={recipients}
            isArtist={user?.role === 'ARTIST'}
            onClose={() => setShowNew(false)}
            onPick={(uid, exId) => openChat(uid, exId)}
          />
        )}
      </AnimatePresence>
      <ReportModal {...{ reportingMsgId, reportReason, reportDetail, reportMutation, setReportingMsgId, setReportReason, setReportDetail, handleReport }} />
      <MessageImageLightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />
    </div>
  );
}

// ========== 새 대화 상대 선택 ==========
function NewChatModal({ recipients, isArtist, onClose, onPick }: { recipients: any[]; isArtist: boolean; onClose: () => void; onPick: (userId: number, exhibitionId?: number) => void }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <motion.div initial={{ scale: 0.96 }} animate={{ scale: 1 }} exit={{ scale: 0.96 }} onClick={e => e.stopPropagation()} className="bg-white w-full max-w-md max-h-[80vh] flex flex-col rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">새 대화 상대</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded"><X size={18} /></button>
        </div>
        <div className="overflow-y-auto p-2">
          {recipients.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">{isArtist ? '메시지를 보낼 수 있는 갤러리가 없습니다.' : '아직 지원자가 없습니다. (지원한 작가에게만 메시지를 보낼 수 있어요)'}</p>
          ) : isArtist ? (
            recipients.map((r: any) => (
              <button key={r.userId} onClick={() => onPick(r.userId)} className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-gray-50 flex items-center gap-2">
                <Building2 size={16} className="text-gray-400" />
                <span className="text-sm text-gray-800">{r.galleryName}</span>
              </button>
            ))
          ) : (
            recipients.map((ex: any) => (
              <div key={ex.exhibitionId} className="mb-2">
                <p className="px-3 py-1 text-[11px] font-medium text-gray-400">{ex.exhibitionTitle}</p>
                {ex.applicants.map((a: any) => (
                  <button key={a.userId} onClick={() => onPick(a.userId, ex.exhibitionId)} className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-gray-50 flex items-center gap-2">
                    <div className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center overflow-hidden flex-none">
                      {a.avatar ? <img src={a.avatar} alt="" className="w-full h-full object-cover" /> : <UserIcon size={14} className="text-gray-400" />}
                    </div>
                    <span className="text-sm text-gray-800">{a.name}</span>
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

// ========== 신고 모달 ==========
function ReportModal({ reportingMsgId, reportReason, reportDetail, reportMutation, setReportingMsgId, setReportReason, setReportDetail, handleReport }: any) {
  return (
    <AnimatePresence>
      {reportingMsgId !== null && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setReportingMsgId(null)}>
          <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }} onClick={(e: React.MouseEvent) => e.stopPropagation()} className="bg-white w-full max-w-sm p-5 rounded-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-gray-900">메시지 신고</h3>
              <button onClick={() => setReportingMsgId(null)} className="p-1 hover:bg-gray-100 rounded"><X size={18} /></button>
            </div>
            <div className="space-y-2 mb-4">
              {([['PROFANITY','비속어 / 욕설'],['SPAM','스팸 / 광고'],['INAPPROPRIATE','부적절한 내용'],['OTHER','기타']] as const).map(([v,l]) => (
                <label key={v} className="flex items-center gap-2.5 p-2.5 hover:bg-gray-50 rounded cursor-pointer">
                  <input type="radio" name="rr" value={v} checked={reportReason===v} onChange={()=>setReportReason(v)} className="accent-gray-900" /><span className="text-sm">{l}</span>
                </label>
              ))}
            </div>
            <textarea value={reportDetail} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>)=>setReportDetail(e.target.value)} maxLength={500} placeholder="상세 내용 (선택)" className="w-full h-20 px-3 py-2 border border-gray-200 rounded text-sm resize-none focus:outline-none focus:ring-2 focus:ring-gray-400 mb-4" />
            <div className="flex gap-2">
              <button onClick={()=>setReportingMsgId(null)} className="flex-1 py-2.5 border border-gray-200 rounded text-sm text-gray-600 hover:bg-gray-50">취소</button>
              <button onClick={handleReport} disabled={reportMutation.isPending} className="flex-1 py-2.5 bg-gray-900 text-white rounded text-sm hover:bg-gray-800 disabled:opacity-50">{reportMutation.isPending?'처리 중...':'신고하기'}</button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ========== 이미지 라이트박스 ==========
function MessageImageLightbox({ url, onClose }: { url: string | null; onClose: () => void }) {
  if (!url) return null;
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/80 z-50 flex flex-col items-center justify-center p-4 cursor-zoom-out" onClick={onClose}>
      <img src={url} alt="" className="max-w-full max-h-[85vh] object-contain" onClick={e => e.stopPropagation()} />
      <a href={url} download onClick={e => e.stopPropagation()} className="mt-3 flex items-center gap-1.5 px-4 py-2 bg-white/90 text-gray-800 text-sm rounded hover:bg-white cursor-pointer">
        <Download size={14} /> 다운로드
      </a>
    </motion.div>
  );
}
