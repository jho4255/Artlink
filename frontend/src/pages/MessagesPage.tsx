import { useState, useEffect, useMemo, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { useLocation, useSearchParams } from 'react-router-dom';
import { ArrowLeft, SendHorizonal, Plus, Mail, User as UserIcon, Flag, X, FileText, Building2, Paperclip, Image, Download } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import { useAuthStore } from '@/stores/authStore';
import type { Message, MessageAttachment } from '@/types';

function useIsMobile(breakpoint = 1280) {
  const [isMobile, setIsMobile] = useState(window.innerWidth < breakpoint);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < breakpoint);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, [breakpoint]);
  return isMobile;
}

// ===== 유틸 =====
function baseSubject(s: string) { return s.replace(/^(Re:\s*)+/i, ''); }

interface SubjectThread {
  subject: string; messages: Message[]; lastDate: string; unreadCount: number;
}

function groupBySubject(messages: Message[], myId: number): SubjectThread[] {
  const map = new Map<string, Message[]>();
  for (const m of messages) { const b = baseSubject(m.subject); if (!map.has(b)) map.set(b, []); map.get(b)!.push(m); }
  return Array.from(map.entries())
    .map(([subject, msgs]) => ({
      subject,
      messages: msgs.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
      lastDate: msgs[msgs.length - 1].createdAt,
      unreadCount: msgs.filter(m => m.receiverId === myId && !m.read).length,
    }))
    .sort((a, b) => new Date(b.lastDate).getTime() - new Date(a.lastDate).getTime());
}

export default function MessagesPage() {
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const scrollRef = useRef<HTMLDivElement>(null);

  const prefill = location.state as { receiverId?: number; receiverName?: string; subject?: string; exhibitionTitle?: string; exhibitionId?: number } | null;

  // URL 파라미터 (알림 클릭 시마다 갱신)
  const partnerFromUrl = searchParams.get('partner') ? Number(searchParams.get('partner')) : null;
  const exhibitionFromUrl = searchParams.get('exhibition') ? Number(searchParams.get('exhibition')) : null;
  const subjectFromUrl = searchParams.get('subject') || null;

  // 선택 상태
  const [selL1, setSelL1] = useState<number | null>(null);
  const [selL2, setSelL2] = useState<number | null>(null);
  const [selSubject, setSelSubject] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(!!prefill?.receiverId);

  // Artist L2 → partnerId 결정용
  const [partnerIdForThread, setPartnerIdForThread] = useState<number | null>(null);

  // 새 쪽지
  const [newReceiverId, setNewReceiverId] = useState<number | ''>(prefill?.receiverId || '');
  const [newSubject, setNewSubject] = useState(prefill?.subject || '');
  const [newContent, setNewContent] = useState('');
  const [prefillName, setPrefillName] = useState(prefill?.receiverName || '');
  const [prefillExhibition, setPrefillExhibition] = useState(prefill?.exhibitionTitle || '');
  const [prefillExhibitionId, setPrefillExhibitionId] = useState<number | undefined>(prefill?.exhibitionId);

  const [replyContent, setReplyContent] = useState('');
  const [newAttachments, setNewAttachments] = useState<MessageAttachment[]>([]);
  const [replyAttachments, setReplyAttachments] = useState<MessageAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [reportingMsgId, setReportingMsgId] = useState<number | null>(null);
  const [reportReason, setReportReason] = useState<string>('PROFANITY');
  const [reportDetail, setReportDetail] = useState('');
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  // 파일 업로드 핸들러
  const handleFileUpload = async (files: FileList, target: 'new' | 'reply') => {
    const setAttachments = target === 'new' ? setNewAttachments : setReplyAttachments;
    const current = target === 'new' ? newAttachments : replyAttachments;
    if (current.length + files.length > 5) { toast.error('최대 5개까지 첨부 가능합니다.'); return; }
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const formData = new FormData();
        const isImage = file.type.startsWith('image/');
        formData.append(isImage ? 'image' : 'file', file);
        const endpoint = isImage ? '/upload/image' : '/upload/file';
        const res = await api.post(endpoint, formData);
        setAttachments(prev => [...prev, { url: res.data.url, name: file.name, type: file.type, size: file.size }]);
      }
    } catch { toast.error('파일 업로드에 실패했습니다.'); }
    setUploading(false);
  };

  const isArtist = user?.role === 'ARTIST';
  const isMobile = useIsMobile();

  // 모바일 현재 레벨 결정
  const mobileLevel = selSubject ? 'L4' : selL2 !== null ? 'L3' : selL1 !== null ? 'L2' : 'L1';

  // 초기화 (prefill만 정리)
  useEffect(() => {
    if (prefill?.receiverId) window.history.replaceState({}, '');
  }, []);

  // ===== 쿼리 =====
  const { data: conversations, isLoading: convsLoading } = useQuery<any>({
    queryKey: ['message-conversations'],
    queryFn: () => api.get('/messages/conversations').then(r => r.data),
  });

  // 알림에서 진입 시 conversations 로드 후 해당 레이어로 이동
  const lastNavKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!conversations || !partnerFromUrl) return;
    const navKey = `${partnerFromUrl}|${exhibitionFromUrl ?? ''}|${subjectFromUrl ?? ''}`;
    if (lastNavKeyRef.current === navKey) return;
    lastNavKeyRef.current = navKey;

    const targetExId = exhibitionFromUrl ?? 0;

    if (isArtist && conversations.galleries) {
      for (const g of conversations.galleries) {
        if (g.ownerId === partnerFromUrl) {
          setSelL1(g.galleryId);
          const ex = g.exhibitions.find((e: any) => e.exhibitionId === targetExId);
          if (ex) {
            setSelL2(targetExId);
            setPartnerIdForThread(partnerFromUrl);
            if (subjectFromUrl) setSelSubject(subjectFromUrl);
          }
          break;
        }
      }
    } else if (!isArtist && conversations.exhibitions) {
      const ex = conversations.exhibitions.find((e: any) => e.exhibitionId === targetExId);
      if (ex) {
        setSelL1(targetExId);
        if (partnerFromUrl) {
          setSelL2(partnerFromUrl);
          if (subjectFromUrl) setSelSubject(subjectFromUrl);
        }
      }
    }
  }, [conversations, partnerFromUrl, exhibitionFromUrl, subjectFromUrl]);

  // Navbar 재클릭 시 리셋
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    if (!mounted) { setMounted(true); return; }
    if (!location.state && !partnerFromUrl) {
      setSelL1(null); setSelL2(null); setSelSubject(null); setShowNew(false);
      lastNavKeyRef.current = null;
    }
  }, [location.key]);

  // 선택 변경 시 자동 스크롤
  useEffect(() => {
    setTimeout(() => scrollRef.current?.scrollTo({ left: scrollRef.current.scrollWidth, behavior: 'smooth' }), 50);
  }, [selL1, selL2, selSubject, showNew]);

  // thread를 위한 partnerId/exhibitionId 결정
  const threadExId = isArtist ? selL2 : selL1;
  const threadPartnerId = isArtist ? partnerIdForThread : selL2;

  const { data: thread } = useQuery<any>({
    queryKey: ['message-thread', threadPartnerId, threadExId],
    queryFn: () => api.get(`/messages/thread/${threadPartnerId}?exhibitionId=${threadExId ?? ''}`).then(r => r.data),
    enabled: threadPartnerId != null && threadPartnerId > 0 && threadExId !== null && threadExId !== undefined && selL2 !== null,
  });

  const { data: recipients = [] } = useQuery<any[]>({
    queryKey: ['message-recipients'],
    queryFn: () => api.get('/messages/recipients').then(r => r.data),
    enabled: showNew,
  });

  const subjectThreads = useMemo(() => {
    if (!thread?.messages || !user) return [];
    return groupBySubject(thread.messages, user.id);
  }, [thread?.messages, user]);

  const currentThread = useMemo(() => {
    if (!selSubject) return null;
    return subjectThreads.find(t => t.subject === selSubject) || null;
  }, [subjectThreads, selSubject]);

  // unread 갱신
  useEffect(() => {
    if (selL2 !== null) {
      qc.invalidateQueries({ queryKey: ['message-unread-count'] });
      qc.invalidateQueries({ queryKey: ['message-conversations'] });
    }
  }, [selL2, thread]);

  // ===== Mutations =====
  const sendMutation = useMutation({
    mutationFn: (data: { receiverId: number; subject: string; content: string; exhibitionId?: number }) => api.post('/messages', data),
    retry: false,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['message-conversations'] }); qc.invalidateQueries({ queryKey: ['message-thread'] }); qc.invalidateQueries({ queryKey: ['message-unread-count'] }); },
    onError: (err: any) => toast.error(err.response?.data?.error || '전송에 실패했습니다.'),
  });

  const reportMutation = useMutation({
    mutationFn: (data: { messageId: number; reason: string; detail?: string }) => api.post('/reports', data),
    onSuccess: () => { toast.success('신고가 접수되었습니다.'); setReportingMsgId(null); setReportReason('PROFANITY'); setReportDetail(''); qc.invalidateQueries({ queryKey: ['message-thread'] }); qc.invalidateQueries({ queryKey: ['message-conversations'] }); },
    onError: (err: any) => toast.error(err.response?.status === 409 ? '이미 신고한 메시지입니다.' : '신고에 실패했습니다.'),
  });

  const handleNewSend = () => {
    if (!newReceiverId) { toast.error('수신자를 선택해주세요.'); return; }
    if (!newSubject.trim()) { toast.error('제목을 입력해주세요.'); return; }
    if (!newContent.trim()) { toast.error('내용을 입력해주세요.'); return; }
    sendMutation.mutate(
      { receiverId: Number(newReceiverId), subject: newSubject.trim(), content: newContent.trim(), exhibitionId: prefillExhibitionId, ...(newAttachments.length > 0 ? { attachments: newAttachments } : {}) } as any,
      { onSuccess: () => { setShowNew(false); setNewReceiverId(''); setNewSubject(''); setNewContent(''); setNewAttachments([]); setPrefillName(''); setPrefillExhibition(''); setPrefillExhibitionId(undefined); toast.success('쪽지를 보냈습니다.'); } },
    );
  };

  const handleReply = () => {
    if (!replyContent.trim() || !selSubject || !threadPartnerId || threadExId === null) return;
    sendMutation.mutate(
      { receiverId: threadPartnerId, subject: `Re: ${selSubject}`, content: replyContent.trim(), ...(threadExId ? { exhibitionId: threadExId } : {}), ...(replyAttachments.length > 0 ? { attachments: replyAttachments } : {}) } as any,
      { onSuccess: () => { setReplyContent(''); setReplyAttachments([]); } },
    );
  };

  const handleReport = () => {
    if (!reportingMsgId) return;
    reportMutation.mutate({ messageId: reportingMsgId, reason: reportReason, ...(reportDetail.trim() ? { detail: reportDetail.trim() } : {}) });
  };

  const formatDate = (d: string) => new Date(d).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
  const formatDateTime = (d: string) => `${new Date(d).toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' })} ${new Date(d).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}`;

  // ===== L1 데이터 =====
  const l1Items = isArtist ? (conversations?.galleries || []) : (conversations?.exhibitions || []);

  // ===== L2 데이터 =====
  let l2Items: any[] = [];
  let l2Title = '';
  if (selL1 !== null) {
    if (isArtist) {
      const gallery = conversations?.galleries?.find((g: any) => g.galleryId === selL1);
      l2Items = gallery?.exhibitions || [];
      l2Title = gallery?.galleryName || '';
    } else {
      const exhibition = conversations?.exhibitions?.find((e: any) => e.exhibitionId === selL1);
      l2Items = exhibition?.partners || [];
      l2Title = exhibition?.exhibitionTitle || '';
    }
  }

  // ====================================================
  // ====== 새 쪽지 모달 ======
  // ====================================================
  const newMsgModal = showNew && (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowNew(false)}>
      <motion.div initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 20 }}
        onClick={e => e.stopPropagation()} className="bg-white w-full max-w-lg max-h-[85vh] overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-gray-900">새 쪽지</h2>
          <button onClick={() => setShowNew(false)} className="p-1 hover:bg-gray-100"><X size={18} /></button>
        </div>
        <div className="space-y-4">
          {prefillExhibition && (
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">공모전</label>
              <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-200 text-sm">
                <FileText size={14} className="text-gray-400" /><span className="font-medium text-gray-900">{prefillExhibition}</span>
              </div>
            </div>
          )}
          {prefillName && newReceiverId ? (
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">수신자</label>
              <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-200 text-sm">
                <UserIcon size={14} className="text-gray-400" /><span className="font-medium text-gray-900">{prefillName}</span>
                <button onClick={() => { setPrefillName(''); setNewReceiverId(''); setPrefillExhibition(''); setPrefillExhibitionId(undefined); setNewSubject(''); }} className="ml-auto text-gray-400 hover:text-gray-900"><X size={14} /></button>
              </div>
            </div>
          ) : isArtist ? (
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">수신자 (갤러리)</label>
              {recipients.length === 0 ? <p className="text-sm text-gray-400 py-2">등록된 갤러리가 없습니다.</p> : (
                <div className="space-y-1.5 max-h-40 overflow-y-auto">{recipients.map((r: any) => (
                  <button key={r.userId} onClick={() => { setNewReceiverId(r.userId); setPrefillName(`${r.galleryName} (${r.userName})`); setPrefillExhibition(''); setPrefillExhibitionId(undefined); if (!newSubject) setNewSubject(`[${r.galleryName}] `); }}
                    className={`w-full text-left px-3 py-2 text-sm border-b border-gray-200 ${newReceiverId === r.userId ? 'bg-gray-100 font-medium' : 'hover:bg-gray-50'}`}>
                    <p className="font-medium text-gray-900">{r.galleryName}</p><p className="text-xs text-gray-400">{r.userName}</p>
                  </button>
                ))}</div>
              )}
            </div>
          ) : (
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">공모 → 지원자</label>
              {recipients.length === 0 ? <p className="text-sm text-gray-400 py-2">지원자가 있는 공모가 없습니다.</p> : (
                <div className="space-y-2 max-h-40 overflow-y-auto">{recipients.map((ex: any) => (
                  <div key={ex.exhibitionId} className="border-b border-gray-200 overflow-hidden">
                    <div className="px-3 py-1.5 text-xs font-medium text-gray-400">{ex.exhibitionTitle}</div>
                    {ex.applicants.map((a: any) => (
                      <button key={a.userId} onClick={() => { setNewReceiverId(a.userId); setPrefillName(a.name); setPrefillExhibition(ex.exhibitionTitle); setPrefillExhibitionId(ex.exhibitionId); if (!newSubject) setNewSubject(`[${ex.exhibitionTitle}] `); }}
                        className={`w-full flex items-center gap-2 px-3 py-2 text-sm ${newReceiverId === a.userId ? 'bg-gray-100' : 'hover:bg-gray-50'}`}>
                        <UserIcon size={12} className="text-gray-400" /><span>{a.name}</span>
                      </button>
                    ))}
                  </div>
                ))}</div>
              )}
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">제목</label>
            <input value={newSubject} onChange={e => setNewSubject(e.target.value)} maxLength={200} placeholder="제목을 입력해주세요" className="w-full px-3 py-2 border-b border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">내용</label>
            <textarea value={newContent} onChange={e => setNewContent(e.target.value)} maxLength={5000} placeholder="내용을 작성해주세요" className="w-full h-28 px-3 py-2 border border-gray-200 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-gray-400" />
            <p className="text-xs text-gray-400 mt-1 text-right">{newContent.length}/5000</p>
          </div>
          {/* 첨부파일 */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <label className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-600 bg-gray-100 cursor-pointer hover:bg-gray-200 transition-colors">
                <Paperclip size={12} /> 파일 첨부
                <input type="file" multiple className="hidden" onChange={e => e.target.files && handleFileUpload(e.target.files, 'new')} accept="*/*" />
              </label>
              {uploading && <span className="text-xs text-gray-400">업로드 중...</span>}
              <span className="text-[10px] text-gray-400">{newAttachments.length}/5</span>
            </div>
            {newAttachments.length > 0 && (
              <div className="space-y-1">
                {newAttachments.map((a, i) => (
                  <div key={i} className="flex items-center gap-2 px-2 py-1.5 bg-gray-50 text-xs">
                    {a.type.startsWith('image/') ? <Image size={12} className="text-gray-400" /> : <FileText size={12} className="text-gray-400" />}
                    <span className="flex-1 truncate">{a.name}</span>
                    <span className="text-gray-400">{(a.size / 1024).toFixed(0)}KB</span>
                    <button onClick={() => setNewAttachments(prev => prev.filter((_, j) => j !== i))} className="text-gray-400 hover:text-[#c4302b]"><X size={12} /></button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <button onClick={handleNewSend} disabled={sendMutation.isPending || uploading} className="w-full flex items-center justify-center gap-2 py-2.5 bg-gray-900 text-white text-sm disabled:opacity-50 hover:bg-gray-800">
            <SendHorizonal size={16} /> 보내기
          </button>
        </div>
      </motion.div>
    </motion.div>
  );

  // ===== 공유 렌더러 =====
  const selectL1 = (id: number) => { setSelL1(id); setSelL2(null); setSelSubject(null); if (isArtist) setPartnerIdForThread(null); };
  const selectL2Artist = (exId: number, ownerId: number) => { setSelL2(exId); setSelSubject(null); setPartnerIdForThread(ownerId); };
  const selectL2Gallery = (partnerId: number) => { setSelL2(partnerId); setSelSubject(null); };

  // 셀 공통 스타일
  const cellCls = (selected: boolean) =>
    `w-full h-[56px] text-left px-3 flex items-center border-b border-gray-200 transition-all ${selected ? 'bg-gray-100 shadow-[inset_3px_0_0_#111827]' : 'hover:bg-gray-50/80'}`;

  const renderL1List = (cls?: string) => (
    <div className={cls}>
      {convsLoading ? (
        <div className="p-3 space-y-2">{[1,2,3].map(i => <div key={i} className="h-[56px] bg-gray-100 animate-pulse" />)}</div>
      ) : l1Items.length === 0 ? (
        <div className="text-center py-12 text-gray-400 text-sm"><Mail size={24} className="mx-auto mb-2 opacity-50" /><p>비어있음</p></div>
      ) : l1Items.map((item: any) => {
        const id = isArtist ? item.galleryId : item.exhibitionId;
        const name = isArtist ? item.galleryName : item.exhibitionTitle;
        const sub = isArtist ? `공모 ${item.exhibitions.length}개` : `지원자 ${item.partners.length}명`;
        const Icon = isArtist ? Building2 : FileText;
        const selected = selL1 === id;
        return (
          <button key={id} onClick={() => selectL1(id)} className={cellCls(selected)}>
            <div className="flex items-center gap-2.5 w-full">
              <div className={`w-8 h-8 flex items-center justify-center flex-none ${selected ? 'bg-gray-200' : 'bg-gray-100'}`}>
                <Icon size={14} className={selected ? 'text-gray-900' : 'text-gray-400'} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <p className={`text-sm truncate ${selected ? 'font-semibold text-gray-900' : item.totalUnread > 0 ? 'font-medium text-gray-900' : 'text-gray-700'}`}>{name}</p>
                  {item.totalUnread > 0 && <span className="min-w-[18px] h-[18px] bg-gray-900 text-white text-[10px] font-medium flex items-center justify-center px-1 ml-1">{item.totalUnread}</span>}
                </div>
                <p className="text-[11px] text-gray-400">{sub}</p>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );

  const renderL2List = (cls?: string) => (
    <div className={cls}>
      {l2Items.length === 0 ? (
        <div className="text-center py-12 text-gray-400 text-sm"><p>없음</p></div>
      ) : l2Items.map((item: any) => {
        if (isArtist) {
          const selected = selL2 === item.exhibitionId;
          const gallery = conversations?.galleries?.find((g: any) => g.galleryId === selL1);
          return (
            <button key={item.exhibitionId} onClick={() => selectL2Artist(item.exhibitionId, gallery?.ownerId || 0)} className={cellCls(selected)}>
              <div className="flex items-center gap-2.5 w-full">
                <div className={`w-8 h-8 flex items-center justify-center flex-none ${selected ? 'bg-gray-200' : 'bg-gray-100'}`}>
                  <FileText size={14} className={selected ? 'text-gray-900' : 'text-gray-400'} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <p className={`text-sm truncate ${selected ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>{item.exhibitionTitle}</p>
                    {item.unreadCount > 0 && <span className="min-w-[18px] h-[18px] bg-gray-900 text-white text-[10px] font-medium flex items-center justify-center px-1 ml-1">{item.unreadCount}</span>}
                  </div>
                  <p className="text-[11px] text-gray-400">{item.messageCount}건</p>
                </div>
              </div>
            </button>
          );
        } else {
          const p = item;
          const selected = selL2 === p.partner.id;
          return (
            <button key={p.partner.id} onClick={() => selectL2Gallery(p.partner.id)} className={cellCls(selected)}>
              <div className="flex items-center gap-2.5 w-full">
                {p.partner.avatar ? <img src={p.partner.avatar} alt="" className="w-8 h-8 rounded-full object-cover flex-none" />
                  : <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center flex-none"><UserIcon size={14} className="text-gray-400" /></div>}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <p className={`text-sm truncate ${selected ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>{p.partner.name}</p>
                    {p.unreadCount > 0 && <span className="min-w-[18px] h-[18px] bg-gray-900 text-white text-[10px] font-medium flex items-center justify-center px-1 ml-1">{p.unreadCount}</span>}
                  </div>
                  <p className="text-[11px] text-gray-400 truncate">{p.lastMessage.content}</p>
                </div>
              </div>
            </button>
          );
        }
      })}
    </div>
  );

  const renderL3List = (cls?: string) => (
    <div className={cls}>
      {subjectThreads.length === 0 ? (
        <div className="text-center py-12 text-gray-400 text-sm"><Mail size={20} className="mx-auto mb-2 opacity-50" /><p>쪽지 없음</p></div>
      ) : subjectThreads.map((st) => {
        const last = st.messages[st.messages.length - 1];
        const isMe = last.senderId === user?.id;
        const selected = selSubject === st.subject;
        return (
          <button key={st.subject} onClick={() => setSelSubject(st.subject)} className={cellCls(selected)}>
            <div className="flex items-center gap-2.5 w-full">
              <div className={`w-8 h-8 flex items-center justify-center flex-none ${selected ? 'bg-gray-200' : 'bg-gray-100'}`}>
                <Mail size={14} className={selected ? 'text-gray-900' : 'text-gray-400'} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-1">
                  <p className={`text-sm truncate ${selected ? 'font-semibold text-gray-900' : st.unreadCount > 0 ? 'font-medium text-gray-900' : 'text-gray-700'}`}>{st.subject}</p>
                  <div className="flex items-center gap-1.5 flex-none">
                    {st.messages.length > 1 && <span className="text-[10px] text-gray-400">({st.messages.length})</span>}
                    {st.unreadCount > 0 && <span className="min-w-[16px] h-[16px] bg-gray-900 text-white text-[9px] font-medium flex items-center justify-center px-0.5">{st.unreadCount}</span>}
                  </div>
                </div>
                <p className="text-[11px] text-gray-400 truncate">{isMe ? '나: ' : ''}{last.content}</p>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );

  const renderL4Detail = () => {
    if (!currentThread) return null;
    return (
      <div className="flex flex-col h-full">
        <div className="px-5 py-3 border-b border-gray-200 bg-white flex-none">
          <p className="text-base font-semibold text-gray-900 truncate mt-0.5">{currentThread.subject}</p>
          <p className="text-xs text-gray-400 mt-0.5">{thread?.partner?.name} &middot; {currentThread.messages.length}건</p>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4">
          {currentThread.messages.map((msg) => {
            const isMe = msg.senderId === user?.id;
            const m: any = msg;
            const hidden = m.sanctioned || m.reportedByMe;
            return (
              <div key={msg.id} className={`border-b border-gray-200 pb-4 ${hidden ? 'opacity-60' : ''}`}>
                <div className="flex items-center justify-between mb-2.5">
                  <div className="flex items-center gap-2">
                    <span className={`text-[11px] px-2 py-0.5 font-medium ${isMe ? 'bg-gray-100 text-gray-600' : 'bg-gray-900 text-white'}`}>{isMe ? '보냄' : '받음'}</span>
                    <span className="text-sm font-medium text-gray-900">{isMe ? '나' : thread?.partner?.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-gray-400">{formatDateTime(msg.createdAt)}</span>
                    {!isMe && !hidden && <button onClick={() => setReportingMsgId(msg.id)} className="p-1 text-gray-300 hover:text-[#c4302b] transition-colors"><Flag size={12} /></button>}
                  </div>
                </div>
                {m.sanctioned ? (
                  <p className="text-sm text-gray-400 italic pl-0.5">제재로 가려진 메시지입니다</p>
                ) : m.reportedByMe ? (
                  <p className="text-sm text-gray-400 italic pl-0.5">신고한 메시지입니다</p>
                ) : (
                  <p className="text-sm text-gray-800 whitespace-pre-wrap break-words leading-relaxed pl-0.5">{msg.content}</p>
                )}
                {hidden ? null : (() => {
                  let atts: MessageAttachment[] = [];
                  try { if (msg.attachments) atts = JSON.parse(msg.attachments); } catch {}
                  if (atts.length === 0) return null;
                  return (
                    <div className="mt-2 space-y-1.5">
                      {atts.map((a, i) => (
                        a.type.startsWith('image/') ? (
                          <div key={i} className="inline-block">
                            <button onClick={() => setLightboxUrl(a.url)} className="block">
                              <img src={a.url} alt={a.name} className="max-w-[200px] max-h-[150px] border border-gray-200 object-cover cursor-zoom-in hover:opacity-80 transition-opacity" />
                            </button>
                            <a href={a.url} download={a.name} className="flex items-center gap-1 mt-1 text-[11px] text-gray-400 hover:text-gray-600">
                              <Download size={10} /> {a.name}
                            </a>
                          </div>
                        ) : (
                          <a key={i} href={a.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 px-2.5 py-1.5 bg-gray-100 text-xs hover:bg-gray-200 transition-colors w-fit">
                            <Download size={12} className="text-gray-400" />
                            <span className="text-gray-700">{a.name}</span>
                            <span className="text-gray-400">({(a.size / 1024).toFixed(0)}KB)</span>
                          </a>
                        )
                      ))}
                    </div>
                  );
                })()}
              </div>
            );
          })}
        </div>
        <div className="px-5 py-3 border-t border-gray-200 bg-white flex-none">
          {/* 회신 첨부파일 */}
          {replyAttachments.length > 0 && (
            <div className="mb-2 space-y-1">
              {replyAttachments.map((a, i) => (
                <div key={i} className="flex items-center gap-2 px-2 py-1 bg-gray-50 text-xs">
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
              <input type="file" multiple className="hidden" onChange={e => e.target.files && handleFileUpload(e.target.files, 'reply')} accept="*/*" />
            </label>
            <textarea value={replyContent} onChange={e => setReplyContent(e.target.value)} maxLength={5000} placeholder="회신 내용을 입력하세요..." rows={1}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleReply(); } }}
              className="flex-1 px-4 py-2.5 border border-gray-200 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-gray-400 max-h-24 overflow-y-auto" style={{ minHeight: '42px' }} />
            <button onClick={handleReply} disabled={(!replyContent.trim() && replyAttachments.length === 0) || sendMutation.isPending}
              className="p-2.5 bg-gray-900 text-white disabled:opacity-30 hover:bg-gray-800 transition-colors flex-none"><SendHorizonal size={16} /></button>
          </div>
        </div>
      </div>
    );
  };

  // ====================================================
  // ====== 모바일 레이아웃 ======
  // ====================================================
  if (isMobile) {
    const mobileBack = () => {
      if (selSubject) setSelSubject(null);
      else if (selL2 !== null) { setSelL2(null); setPartnerIdForThread(null); }
      else if (selL1 !== null) setSelL1(null);
    };

    // 브레드크럼
    const crumbs: { label: string; onClick: () => void }[] = [];
    if (selL1 !== null) {
      const l1Label = isArtist
        ? (conversations?.galleries?.find((g: any) => g.galleryId === selL1)?.galleryName || '')
        : (conversations?.exhibitions?.find((e: any) => e.exhibitionId === selL1)?.exhibitionTitle || '');
      crumbs.push({ label: l1Label, onClick: () => { setSelL2(null); setSelSubject(null); setPartnerIdForThread(null); } });
    }
    if (selL2 !== null) {
      let l2Label = '';
      if (isArtist) {
        const g = conversations?.galleries?.find((g: any) => g.galleryId === selL1);
        l2Label = g?.exhibitions?.find((e: any) => e.exhibitionId === selL2)?.exhibitionTitle || '';
      } else {
        const ex = conversations?.exhibitions?.find((e: any) => e.exhibitionId === selL1);
        l2Label = ex?.partners?.find((p: any) => p.partner.id === selL2)?.partner.name || '';
      }
      crumbs.push({ label: l2Label, onClick: () => { setSelSubject(null); } });
    }
    if (selSubject !== null) {
      crumbs.push({ label: selSubject, onClick: () => {} });
    }

    return (
      <div className="h-[calc(100dvh-5rem)] flex flex-col">
        {/* 상단 헤더 */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-200 bg-white flex-none">
          {mobileLevel !== 'L1' && (
            <button onClick={mobileBack} className="p-1.5 hover:bg-gray-100"><ArrowLeft size={18} /></button>
          )}
          <h1 className="text-base font-semibold text-gray-900 flex-1">쪽지함</h1>
          {mobileLevel === 'L1' && (
            <button onClick={() => setShowNew(true)} className="flex items-center gap-1 px-3 py-1.5 bg-gray-900 text-white text-xs">
              <Plus size={12} /> 새 쪽지
            </button>
          )}
        </div>

        {/* 브레드크럼 */}
        {crumbs.length > 0 && (
          <div className="flex-none bg-gray-50 border-b border-gray-200">
            {crumbs.map((c, i) => (
              <button
                key={i}
                onClick={c.onClick}
                className="w-full text-left px-4 py-2.5 border-b border-gray-100 last:border-b-0 hover:bg-gray-100 transition-colors"
                style={{ paddingLeft: `${16 + i * 12}px` }}
              >
                <p className="text-[13px] font-medium text-gray-700 truncate">{c.label}</p>
              </button>
            ))}
          </div>
        )}

        {/* 현재 레이어 콘텐츠 */}
        <div className="flex-1 overflow-y-auto flex flex-col">
          {mobileLevel === 'L1' && (
            <>
              <div className="px-4 py-2 bg-gray-100 text-[11px] font-medium text-gray-400 uppercase tracking-widest">{isArtist ? '갤러리' : '공모전'}</div>
              {renderL1List()}
            </>
          )}
          {mobileLevel === 'L2' && (
            <>
              <div className="px-4 py-2 bg-gray-100 text-[11px] font-medium text-gray-400 uppercase tracking-widest">{isArtist ? '공모전' : '지원자'}</div>
              {renderL2List()}
            </>
          )}
          {mobileLevel === 'L3' && (
            <>
              <div className="px-4 py-2 bg-gray-100 text-[11px] font-medium text-gray-400 uppercase tracking-widest">대화 제목</div>
              {renderL3List()}
            </>
          )}
          {mobileLevel === 'L4' && <div className="flex-1 flex flex-col overflow-hidden">{renderL4Detail()}</div>}
        </div>

        <AnimatePresence>{newMsgModal}</AnimatePresence>
        <ReportModal {...{ reportingMsgId, reportReason, reportDetail, reportMutation, setReportingMsgId, setReportReason, setReportDetail, handleReport }} />
        <MessageImageLightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />
      </div>
    );
  }

  // ====================================================
  // ====== 데스크톱 Finder 레이아웃 ======
  // ====================================================
  return (
    <div className="h-[calc(100dvh-5rem)] flex flex-col">
      {/* 헤더 */}
      <div className="flex justify-between items-center px-4 py-3 border-b border-gray-200 bg-white flex-none">
        <h1 className="text-lg font-semibold font-serif text-gray-900">쪽지함</h1>
        <button onClick={() => setShowNew(true)} className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-900 text-white text-sm hover:bg-gray-800">
          <Plus size={14} /> 새 쪽지
        </button>
      </div>

      {/* 컬럼 컨테이너 */}
      <div ref={scrollRef} className="flex-1 flex items-stretch overflow-x-auto overflow-y-hidden border-t border-t-gray-200">
        {/* L1 */}
        <div className="w-60 min-w-[15rem] h-full flex-none flex flex-col bg-white border-r border-r-gray-200">
          <div className="px-4 h-[40px] flex items-center gap-1.5 bg-gray-100 border-b border-b-gray-200 flex-none">
            {isArtist ? <Building2 size={12} className="text-gray-600" /> : <FileText size={12} className="text-gray-600" />}
            <p className="text-[12px] font-medium text-gray-600 truncate">{isArtist ? '갤러리' : '공모전'}</p>
          </div>
          <div className="flex-1 overflow-y-auto">{renderL1List()}</div>
        </div>

        {/* L2 */}
        <AnimatePresence>
          {selL1 !== null && (
            <motion.div initial={{ width: 0, opacity: 0 }} animate={{ width: 240, opacity: 1 }} exit={{ width: 0, opacity: 0 }} transition={{ duration: 0.2 }}
              className="min-w-[15rem] h-full flex-none flex flex-col bg-gray-50 border-r border-r-gray-200">
              <div className="px-4 h-[40px] flex items-center gap-1.5 bg-gray-100 border-b border-b-gray-200 flex-none">
                {isArtist ? <FileText size={12} className="text-gray-600" /> : <UserIcon size={12} className="text-gray-600" />}
                <p className="text-[12px] font-medium text-gray-600 truncate">{isArtist ? '공모전' : '지원자'}</p>
              </div>
              <div className="flex-1 overflow-y-auto">{renderL2List()}</div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* L3 */}
        <AnimatePresence>
          {selL2 !== null && (
            <motion.div initial={{ width: 0, opacity: 0 }} animate={{ width: 272, opacity: 1 }} exit={{ width: 0, opacity: 0 }} transition={{ duration: 0.2 }}
              className="min-w-[17rem] h-full flex-none flex flex-col bg-white border-r border-r-gray-200">
              <div className="px-4 h-[40px] flex items-center gap-1.5 bg-gray-100 border-b border-b-gray-200 flex-none">
                <Mail size={12} className="text-gray-600" />
                <p className="text-[12px] font-medium text-gray-600 truncate">대화 제목</p>
              </div>
              <div className="flex-1 overflow-y-auto">{renderL3List()}</div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* L4 */}
        <AnimatePresence>
          {selSubject !== null && currentThread && (
            <motion.div initial={{ width: 0, opacity: 0 }} animate={{ width: 'auto', minWidth: 420, opacity: 1 }} exit={{ width: 0, opacity: 0 }} transition={{ duration: 0.2 }}
              className="flex-1 min-w-[26rem] h-full flex flex-col bg-gray-50">
              {renderL4Detail()}
            </motion.div>
          )}
        </AnimatePresence>

        {/* 빈 공간 */}
        {selL1 === null && (
          <div className="flex-1 flex items-center justify-center bg-gray-50 text-gray-300">
            <div className="text-center"><Mail size={48} className="mx-auto mb-3 opacity-20" /><p className="text-sm">{isArtist ? '갤러리를' : '공모전을'} 선택하세요</p></div>
          </div>
        )}
      </div>

      <AnimatePresence>{newMsgModal}</AnimatePresence>
      <ReportModal {...{ reportingMsgId, reportReason, reportDetail, reportMutation, setReportingMsgId, setReportReason, setReportDetail, handleReport }} />
      <MessageImageLightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />
    </div>
  );
}

// ========== 신고 모달 ==========
function ReportModal({ reportingMsgId, reportReason, reportDetail, reportMutation, setReportingMsgId, setReportReason, setReportDetail, handleReport }: any) {
  return (
    <AnimatePresence>
      {reportingMsgId !== null && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setReportingMsgId(null)}>
          <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }} onClick={(e: React.MouseEvent) => e.stopPropagation()} className="bg-white w-full max-w-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-gray-900">메시지 신고</h3>
              <button onClick={() => setReportingMsgId(null)} className="p-1 hover:bg-gray-100"><X size={18} /></button>
            </div>
            <div className="space-y-2 mb-4">
              {([['PROFANITY','비속어 / 욕설'],['SPAM','스팸 / 광고'],['INAPPROPRIATE','부적절한 내용'],['OTHER','기타']] as const).map(([v,l]) => (
                <label key={v} className="flex items-center gap-2.5 p-2.5 hover:bg-gray-50 cursor-pointer">
                  <input type="radio" name="rr" value={v} checked={reportReason===v} onChange={()=>setReportReason(v)} className="accent-gray-900" /><span className="text-sm">{l}</span>
                </label>
              ))}
            </div>
            <textarea value={reportDetail} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>)=>setReportDetail(e.target.value)} maxLength={500} placeholder="상세 내용 (선택)" className="w-full h-20 px-3 py-2 border border-gray-200 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-gray-400 mb-4" />
            <div className="flex gap-2">
              <button onClick={()=>setReportingMsgId(null)} className="flex-1 py-2.5 border border-gray-200 text-sm text-gray-600 hover:bg-gray-50">취소</button>
              <button onClick={handleReport} disabled={reportMutation.isPending} className="flex-1 py-2.5 bg-gray-900 text-white text-sm hover:bg-gray-800 disabled:opacity-50">{reportMutation.isPending?'처리 중...':'신고하기'}</button>
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
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/80 z-50 flex flex-col items-center justify-center p-4 cursor-zoom-out"
      onClick={onClose}
    >
      <img src={url} alt="" className="max-w-full max-h-[85vh] object-contain" onClick={e => e.stopPropagation()} />
      <a href={url} download onClick={e => e.stopPropagation()}
        className="mt-3 flex items-center gap-1.5 px-4 py-2 bg-white/90 text-gray-800 text-sm hover:bg-white transition-colors cursor-pointer">
        <Download size={14} /> 다운로드
      </a>
    </motion.div>
  );
}
