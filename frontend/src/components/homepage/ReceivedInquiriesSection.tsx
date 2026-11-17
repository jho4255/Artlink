import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Mail, Phone, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import { useAuthStore } from '@/stores/authStore';
import { editHref } from '@/lib/homepageEdit';
import { scrollToTarget } from '@/lib/scrollToTarget';
import ConfirmDialog from '@/components/shared/ConfirmDialog';

/**
 * 마이페이지 [받은 문의] (2026-11-14, CLAUDE.md 규칙 82) — 로그인하지 않은 방문자가 내 홈페이지 [문의하기]로 남긴 글.
 * 메뉴에는 없는 숨은 탭이다 — 알림(`HOMEPAGE_INQUIRY` → `?tab=received-inquiries&inquiry=<id>`)과 [꾸미기]·갤러리 정보 수정의 링크로 들어온다.
 * 회원의 문의는 ArtTalk 으로 온다(여기 없다).
 *
 *  · 펼치면 읽음(그 문의의 벨 알림도 읽음) · 답은 적어 준 연락처로 직접(메일·전화 링크) · [삭제]는 바로 지운다(개인정보, 되돌릴 수 없다)
 *  · `?inquiry=<id>` — 그 문의를 펼친 채 그 자리로 내려가고 주소에서 뗀다(규칙 78 의 1:1 문의와 같은 방식)
 *  · 1년 지난 문의는 서버가 지운다
 */
interface Item {
  id: number;
  name: string;
  contact: string;
  message: string;
  createdAt: string;
  readAt: string | null;
  work: { id: number; title: string | null; url: string | null } | null;
  gallery: { id: number; name: string; handle: string | null } | null;
}

const fmt = (iso: string) => new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());

export default function ReceivedInquiriesSection() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { user } = useAuthStore();
  const [open, setOpen] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);

  const { data, isLoading, isError } = useQuery<{ unread: number; items: Item[] }>({
    queryKey: ['homepage-inquiries'],
    queryFn: () => api.get('/homepage-inquiries/mine').then((r) => r.data),
  });

  const markRead = useMutation({
    mutationFn: (id: number) => api.patch(`/homepage-inquiries/${id}/read`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['homepage-inquiries'] });
      void qc.invalidateQueries({ queryKey: ['notifications'] });
      void qc.invalidateQueries({ queryKey: ['unread-count'] });
    },
  });
  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`/homepage-inquiries/${id}`),
    onSuccess: () => {
      toast.success('문의를 지웠어요.');
      void qc.invalidateQueries({ queryKey: ['homepage-inquiries'] });
      void qc.invalidateQueries({ queryKey: ['notifications'] });
      void qc.invalidateQueries({ queryKey: ['unread-count'] });
    },
    onError: () => toast.error('지우지 못했어요. 잠시 후 다시 시도해 주세요.'),
  });

  const toggle = (it: Item) => {
    const next = open === it.id ? null : it.id;
    setOpen(next);
    if (next != null && !it.readAt) markRead.mutate(it.id);
  };

  // 알림으로 들어오면 그 문의를 펼치고 그 자리로 — 한 번만, 주소에서 뗀다(같은 알림을 다시 눌러도 열리게)
  const target = Number(params.get('inquiry')) || null;
  const handled = useRef<number | null>(null);
  useEffect(() => {
    if (!target || !data || handled.current === target) return;
    const t = window.setTimeout(() => {
      handled.current = target;
      const it = data.items.find((i) => i.id === target);
      const next = new URLSearchParams(params);
      next.delete('inquiry');
      setParams(next, { replace: true });
      if (!it) return;
      setOpen(it.id);
      if (!it.readAt) markRead.mutate(it.id);
      requestAnimationFrame(() => scrollToTarget(document.getElementById(`received-inquiry-${it.id}`)));
    }, 0);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, data]);

  const items = data?.items ?? [];
  const settingsHref = user?.role === 'GALLERY' ? '/mypage?tab=my-galleries' : editHref('style');

  return (
    <section aria-labelledby="received-inquiries-title" data-testid="received-inquiries">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="received-inquiries-title" className="text-xl font-semibold tracking-tight text-gray-950">받은 문의</h2>
        {data && data.unread > 0 && <span className="text-sm text-accent">읽지 않은 문의 {data.unread}건</span>}
      </div>

      {isLoading ? (
        <div className="h-40 animate-pulse bg-gray-100" />
      ) : isError ? (
        <p className="py-10 text-center text-sm text-gray-500">문의를 불러오지 못했어요.</p>
      ) : items.length === 0 ? (
        <div className="border border-gray-200 px-5 py-10 text-center">
          <p className="text-sm text-gray-600">아직 받은 문의가 없어요.</p>
          <Link to={settingsHref} className="mt-3 inline-flex min-h-[40px] items-center text-sm text-gray-900 underline underline-offset-4">문의 받기 설정</Link>
        </div>
      ) : (
        <ul className="divide-y divide-gray-200 border-y border-gray-200">
          {items.map((it) => {
            const expanded = open === it.id;
            const about = it.work ? `〈${it.work.title || '제목 없는 작품'}〉 작품 문의` : it.gallery ? it.gallery.name : '홈페이지 문의';
            return (
              <li key={it.id} id={`received-inquiry-${it.id}`} className="scroll-mt-24">
                <button
                  type="button"
                  onClick={() => toggle(it)}
                  aria-expanded={expanded}
                  className="flex w-full items-center gap-3 py-3.5 text-left"
                >
                  <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${it.readAt ? 'bg-transparent' : 'bg-accent'}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-medium text-gray-950">{it.name}</span>
                    <span className="block truncate text-[13px] text-gray-500">{about} · {fmt(it.createdAt)}</span>
                  </span>
                  <ChevronDown size={18} aria-hidden className={`shrink-0 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                </button>
                {expanded && (
                  <div className="pb-5 pl-5">
                    {it.work?.url && (
                      <img src={it.work.url} alt="" className="mb-3 max-h-32 max-w-[8rem] object-contain" />
                    )}
                    <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-gray-900 break-keep [overflow-wrap:anywhere]">{it.message}</p>
                    <p className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                      <a
                        href={isEmail(it.contact) ? `mailto:${it.contact.trim()}` : `tel:${it.contact.replace(/[^\d+]/g, '')}`}
                        className="inline-flex min-h-[40px] items-center gap-1.5 font-medium text-gray-950 underline underline-offset-4"
                      >
                        {isEmail(it.contact) ? <Mail size={15} aria-hidden /> : <Phone size={15} aria-hidden />} {it.contact}
                      </a>
                      <button
                        type="button"
                        onClick={() => setDeleting(it.id)}
                        className="inline-flex min-h-[40px] items-center gap-1 text-gray-500 hover:text-accent"
                      >
                        <Trash2 size={14} aria-hidden /> 삭제
                      </button>
                    </p>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmDialog
        open={deleting !== null}
        title="문의 삭제"
        message="이 문의를 지울까요? 이름·연락처도 함께 지워지고 되돌릴 수 없습니다."
        variant="danger"
        confirmText="삭제"
        onConfirm={() => { if (deleting != null) remove.mutate(deleting); setDeleting(null); if (open === deleting) setOpen(null); }}
        onCancel={() => setDeleting(null)}
      />
      {/* 회원의 문의는 ArtTalk — 같은 사람이 회원이면 그쪽에서 이어서 답할 수 있다 */}
      <p className="mt-6 text-xs text-gray-500">
        회원의 문의는 <button type="button" onClick={() => navigate('/messages')} className="underline underline-offset-2 hover:text-gray-900">ArtTalk</button>으로 와요.
      </p>
    </section>
  );
}
