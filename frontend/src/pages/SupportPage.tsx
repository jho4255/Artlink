import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, ChevronDown, ChevronUp, MessageCircle, Send, HelpCircle, Trash2, Edit3 } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import { useAuthStore } from '@/stores/authStore';
import type { Inquiry } from '@/types';

interface Faq {
  id: number;
  question: string;
  answer: string;
  order: number;
}

export default function SupportPage() {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const isAdmin = user?.role === 'ADMIN';

  const [activeTab, setActiveTab] = useState<'faq' | 'inquiry'>('faq');

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="max-w-4xl mx-auto px-4 py-6">
      <h1 className="text-2xl font-bold font-serif mb-6">고객센터</h1>

      {/* 탭 전환 */}
      <div className="flex gap-1 border-b border-gray-100 mb-6">
        <button
          onClick={() => setActiveTab('faq')}
          className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'faq' ? 'text-gray-900 border-gray-900' : 'text-gray-400 border-transparent hover:text-gray-600'
          }`}
        >
          <HelpCircle size={15} /> 자주 묻는 질문
        </button>
        <button
          onClick={() => setActiveTab('inquiry')}
          className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'inquiry' ? 'text-gray-900 border-gray-900' : 'text-gray-400 border-transparent hover:text-gray-600'
          }`}
        >
          <MessageCircle size={15} /> 1:1 문의
        </button>
      </div>

      {/* 탭 콘텐츠 */}
      <motion.div key={activeTab} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.2 }}>
        {activeTab === 'faq' ? <FaqSection /> : <InquirySection />}
      </motion.div>
    </motion.div>
  );
}

// ===== FAQ 섹션 =====
function FaqSection() {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const isAdmin = user?.role === 'ADMIN';

  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');

  const { data: faqs = [], isLoading } = useQuery<Faq[]>({
    queryKey: ['faqs'],
    queryFn: () => api.get('/inquiries/faq').then(r => r.data),
  });

  const createMutation = useMutation({
    mutationFn: (data: { question: string; answer: string; order?: number }) => api.post('/inquiries/faq', data),
    retry: false,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['faqs'] });
      resetForm();
      toast.success('FAQ가 등록되었습니다.');
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'FAQ 등록에 실패했습니다.'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...data }: { id: number; question: string; answer: string }) => api.patch(`/inquiries/faq/${id}`, data),
    retry: false,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['faqs'] });
      resetForm();
      toast.success('FAQ가 수정되었습니다.');
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'FAQ 수정에 실패했습니다.'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/inquiries/faq/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['faqs'] });
      toast.success('FAQ가 삭제되었습니다.');
    },
  });

  const resetForm = () => {
    setShowForm(false);
    setEditingId(null);
    setQuestion('');
    setAnswer('');
  };

  const startEdit = (faq: Faq) => {
    setEditingId(faq.id);
    setQuestion(faq.question);
    setAnswer(faq.answer);
    setShowForm(true);
  };

  const handleSubmit = () => {
    if (!question.trim()) { toast.error('질문을 입력해주세요.'); return; }
    if (!answer.trim()) { toast.error('답변을 입력해주세요.'); return; }
    if (editingId) {
      updateMutation.mutate({ id: editingId, question: question.trim(), answer: answer.trim() });
    } else {
      createMutation.mutate({ question: question.trim(), answer: answer.trim(), order: faqs.length });
    }
  };

  return (
    <>
      {/* Admin: FAQ 추가 버튼 */}
      {isAdmin && (
        <div className="flex justify-end mb-4">
          <button
            onClick={() => { resetForm(); setShowForm(!showForm); }}
            className="flex items-center gap-1.5 px-4 py-2 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-800"
          >
            <Plus size={16} /> FAQ 추가
          </button>
        </div>
      )}

      {/* Admin: FAQ 작성/수정 폼 */}
      <AnimatePresence>
        {showForm && isAdmin && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden mb-6"
          >
            <div className="p-5 bg-gray-50 rounded-xl space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">질문</label>
                <input
                  value={question}
                  onChange={e => setQuestion(e.target.value)}
                  maxLength={500}
                  placeholder="자주 묻는 질문을 입력해주세요"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">답변</label>
                <textarea
                  value={answer}
                  onChange={e => setAnswer(e.target.value)}
                  maxLength={5000}
                  placeholder="답변을 입력해주세요"
                  className="w-full h-28 px-3 py-2 border border-gray-200 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={resetForm} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700">취소</button>
                <button
                  onClick={handleSubmit}
                  disabled={createMutation.isPending || updateMutation.isPending}
                  className="px-4 py-2 bg-gray-900 text-white text-sm rounded-lg disabled:opacity-50 hover:bg-gray-800"
                >
                  {editingId ? '수정' : '등록'}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* FAQ 목록 */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <div key={i} className="h-16 bg-gray-100 animate-pulse" />)}
        </div>
      ) : faqs.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <HelpCircle size={40} className="mx-auto mb-3 opacity-50" />
          <p>등록된 FAQ가 없습니다.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {faqs.map((faq, i) => (
            <motion.div
              key={faq.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03 }}
              className="border border-gray-100 rounded-xl bg-white shadow-sm overflow-hidden"
            >
              <button
                onClick={() => setExpandedId(expandedId === faq.id ? null : faq.id)}
                className="w-full flex items-center justify-between p-4 text-left hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <span className="text-blue-500 font-bold text-sm flex-none">Q</span>
                  <span className="font-medium text-gray-900 truncate">{faq.question}</span>
                </div>
                {expandedId === faq.id ? <ChevronUp size={18} className="text-gray-400 flex-none" /> : <ChevronDown size={18} className="text-gray-400 flex-none" />}
              </button>
              <AnimatePresence>
                {expandedId === faq.id && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="px-4 pb-4">
                      <div className="flex items-start gap-2 bg-gray-50 rounded-lg p-4">
                        <span className="text-green-600 font-bold text-sm flex-none mt-0.5">A</span>
                        <p className="text-sm text-gray-700 whitespace-pre-wrap">{faq.answer}</p>
                      </div>
                      {isAdmin && (
                        <div className="flex justify-end gap-2 mt-2">
                          <button onClick={() => startEdit(faq)} className="text-xs text-gray-400 hover:text-blue-500 flex items-center gap-1">
                            <Edit3 size={12} /> 수정
                          </button>
                          <button onClick={() => deleteMutation.mutate(faq.id)} className="text-xs text-gray-400 hover:text-red-500 flex items-center gap-1">
                            <Trash2 size={12} /> 삭제
                          </button>
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ))}
        </div>
      )}
    </>
  );
}

// ===== 1:1 문의 섹션 =====
function InquirySection() {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const isAdmin = user?.role === 'ADMIN';

  const [showForm, setShowForm] = useState(false);
  const [subject, setSubject] = useState('');
  const [content, setContent] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [replyText, setReplyText] = useState('');

  const { data: inquiries = [], isLoading } = useQuery<Inquiry[]>({
    queryKey: ['inquiries', statusFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      return api.get(`/inquiries?${params}`).then(r => r.data);
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: { subject: string; content: string }) => api.post('/inquiries', data),
    retry: false,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inquiries'] });
      setSubject('');
      setContent('');
      setShowForm(false);
      toast.success('문의가 등록되었습니다.');
    },
    onError: (err: any) => toast.error(err.response?.data?.error || '문의 등록에 실패했습니다.'),
  });

  const replyMutation = useMutation({
    mutationFn: ({ id, reply }: { id: number; reply: string }) => api.patch(`/inquiries/${id}/reply`, { reply }),
    retry: false,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inquiries'] });
      setReplyText('');
      toast.success('답변이 등록되었습니다.');
    },
    onError: (err: any) => toast.error(err.response?.data?.error || '답변 등록에 실패했습니다.'),
  });

  const handleSubmit = () => {
    if (!subject.trim()) { toast.error('제목을 입력해주세요.'); return; }
    if (!content.trim()) { toast.error('내용을 입력해주세요.'); return; }
    createMutation.mutate({ subject: subject.trim(), content: content.trim() });
  };

  const handleReply = (id: number) => {
    if (!replyText.trim()) { toast.error('답변을 입력해주세요.'); return; }
    replyMutation.mutate({ id, reply: replyText.trim() });
  };

  const toggleExpand = (id: number) => {
    setExpandedId(expandedId === id ? null : id);
    setReplyText('');
  };

  const formatDate = (d: string) => new Date(d).toLocaleDateString('ko-KR', {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  return (
    <>
      {/* 문의하기 버튼 (Artist/Gallery) */}
      {!isAdmin && (
        <div className="flex justify-end mb-4">
          <button
            onClick={() => setShowForm(!showForm)}
            className="flex items-center gap-1.5 px-4 py-2 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-800"
          >
            <Plus size={16} /> 문의하기
          </button>
        </div>
      )}

      {/* 문의 작성 폼 */}
      <AnimatePresence>
        {showForm && !isAdmin && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden mb-6"
          >
            <div className="p-5 bg-gray-50 rounded-xl space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">제목</label>
                <input
                  value={subject}
                  onChange={e => setSubject(e.target.value)}
                  maxLength={200}
                  placeholder="문의 제목을 입력해주세요"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-gray-400 mt-1 text-right">{subject.length}/200</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">내용</label>
                <textarea
                  value={content}
                  onChange={e => setContent(e.target.value)}
                  maxLength={5000}
                  placeholder="문의 내용을 자세히 작성해주세요"
                  className="w-full h-32 px-3 py-2 border border-gray-200 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-gray-400 mt-1 text-right">{content.length}/5000</p>
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => { setShowForm(false); setSubject(''); setContent(''); }} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700">취소</button>
                <button onClick={handleSubmit} disabled={createMutation.isPending} className="px-4 py-2 bg-gray-900 text-white text-sm rounded-lg disabled:opacity-50 hover:bg-gray-800">등록</button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Admin: 상태 필터 */}
      {isAdmin && (
        <div className="flex gap-2 mb-4">
          {[
            { label: '전체', value: null },
            { label: '미답변', value: 'OPEN' },
            { label: '답변완료', value: 'ANSWERED' },
          ].map(tab => (
            <button
              key={tab.label}
              onClick={() => setStatusFilter(tab.value)}
              className={`px-3 py-2 text-sm rounded-full min-h-[44px] transition-colors ${
                statusFilter === tab.value ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {/* 문의 목록 */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <div key={i} className="h-20 bg-gray-100 animate-pulse" />)}
        </div>
      ) : inquiries.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <MessageCircle size={40} className="mx-auto mb-3 opacity-50" />
          <p>{isAdmin ? '등록된 문의가 없습니다.' : '문의 내역이 없습니다.'}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {inquiries.map((inq, i) => (
            <motion.div
              key={inq.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03 }}
              className="border border-gray-100 rounded-xl bg-white shadow-sm overflow-hidden"
            >
              <button
                onClick={() => toggleExpand(inq.id)}
                className="w-full flex items-center justify-between p-4 text-left hover:bg-gray-50 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium text-gray-900 truncate">{inq.subject}</h3>
                    <span className={`flex-none text-xs px-2 py-0.5 rounded-full font-medium ${
                      inq.status === 'ANSWERED' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'
                    }`}>
                      {inq.status === 'ANSWERED' ? '답변완료' : '대기중'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-1 text-xs text-gray-400">
                    {isAdmin && <span className="text-gray-600">{inq.user?.name} ({inq.user?.role})</span>}
                    <span>{formatDate(inq.createdAt)}</span>
                  </div>
                </div>
                {expandedId === inq.id ? <ChevronUp size={18} className="text-gray-400" /> : <ChevronDown size={18} className="text-gray-400" />}
              </button>

              <AnimatePresence>
                {expandedId === inq.id && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="px-4 pb-4 space-y-4">
                      <div className="bg-gray-50 rounded-lg p-4">
                        <p className="text-xs font-medium text-gray-400 mb-1">문의 내용</p>
                        <p className="text-sm text-gray-800 whitespace-pre-wrap">{inq.content}</p>
                      </div>

                      {inq.reply && (
                        <div className="bg-blue-50 rounded-lg p-4">
                          <div className="flex justify-between items-center mb-1">
                            <p className="text-xs font-medium text-blue-600">관리자 답변</p>
                            {inq.repliedAt && <p className="text-xs text-gray-400">{formatDate(inq.repliedAt)}</p>}
                          </div>
                          <p className="text-sm text-gray-800 whitespace-pre-wrap">{inq.reply}</p>
                        </div>
                      )}

                      {isAdmin && (
                        <div className="space-y-2">
                          <textarea
                            value={replyText || (inq.status === 'ANSWERED' ? inq.reply || '' : '')}
                            onChange={e => setReplyText(e.target.value)}
                            maxLength={5000}
                            placeholder={inq.status === 'ANSWERED' ? '답변을 수정해주세요' : '답변을 입력해주세요'}
                            className="w-full h-24 px-3 py-2 border border-gray-200 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                          <div className="flex justify-end">
                            <button
                              onClick={() => handleReply(inq.id)}
                              disabled={replyMutation.isPending}
                              className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg disabled:opacity-50 hover:bg-blue-700"
                            >
                              <Send size={14} /> {inq.status === 'ANSWERED' ? '답변 수정' : '답변 등록'}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ))}
        </div>
      )}
    </>
  );
}
