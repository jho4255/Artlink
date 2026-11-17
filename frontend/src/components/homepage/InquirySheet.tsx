import { useEffect, useId, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { X } from 'lucide-react';
import api from '@/lib/axios';
import { useAuthStore } from '@/stores/authStore';
import { useEscapeKey } from '@/hooks/useEscapeKey';
import { setPostLoginRedirect } from '@/lib/postLoginRedirect';
import {
  INQUIRY_CONTACT_MAX, INQUIRY_MESSAGE_MAX, INQUIRY_NAME_MAX, inquiryDraft, isContactLike,
} from '@/lib/homepageSite';
import { PrimaryAction } from './Actions';

/**
 * 문의 창 (2026-11-14, CLAUDE.md 규칙 82) — 작가·갤러리 홈페이지의 [문의하기]와 작품 페이지의 [작품 문의하기]가 같이 쓴다.
 *
 *  · **로그인한 회원** — 지금 길 그대로 ArtTalk(갠톡): 내용 칸 하나 → 보내면 '보냈어요 [대화 보기]'. 작품 문의면 작품 사진을 붙여 보낸다
 *    (제목 없는 작품이 80% 라 글만으로는 어느 작품인지 모른다).
 *  · **비회원 · 주인이 비회원 문의를 켰을 때** — 이름 · 연락처 · 내용 + 개인정보 동의 → `POST /api/homepage-inquiries`.
 *  · **비회원 · 꺼져 있을 때(기본)** — 로그인하면 메시지로 문의할 수 있다고 알리고 로그인으로(돌아올 곳은 지금 화면).
 *
 * 휴대폰은 아래에서 올라오는 창, 넓은 화면은 가운데 창. `role="dialog" aria-modal` + Esc(앱 뒤로가기가 Esc 를 보낸다, 규칙 79).
 * 색은 `var(--hp-…)` — 포털이라 페이지 루트의 변수를 물려받지 못해 `themeVars` 로 받는다.
 */
export interface InquiryTarget {
  /** 대화 상대(작가 본인 · 갤러리 주인) */
  ownerId: number;
  /** 화면에 부를 이름 */
  name: string;
  /** 비회원 문의를 받는가 */
  guestEnabled: boolean;
  /** 갤러리 페이지에서 열었으면 그 갤러리 — 비회원 문의는 이걸로 받는 사람을 찾는다 */
  galleryId?: number | null;
}

export interface InquiryWork { id: number; title?: string | null; url: string }

export default function InquirySheet({ target, work, themeVars, onClose }: {
  target: InquiryTarget;
  work?: InquiryWork | null;
  themeVars: CSSProperties;
  onClose: () => void;
}) {
  const { isAuthenticated } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();
  const titleId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentChat, setSentChat] = useState<number | null>(null);
  const [sentGuest, setSentGuest] = useState(false);
  const [message, setMessage] = useState(() => inquiryDraft(work));
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [agree, setAgree] = useState(false);
  const honeypot = useRef<HTMLInputElement>(null);
  const firstField = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null);

  useEscapeKey(onClose, { enabled: !busy });

  // 스크롤 잠금 · 마우스 화면이면 첫 칸에 커서(휴대폰은 자판이 창을 가리므로 누를 때까지 두지 않는다)
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (window.matchMedia?.('(pointer: fine)').matches) firstField.current?.focus({ preventScroll: true });
    return () => { document.body.style.overflow = prev; };
  }, []);

  const mode: 'member' | 'guest' | 'login' = isAuthenticated ? 'member' : target.guestEnabled ? 'guest' : 'login';
  const toLogin = (to: '/login' | '/signup') => {
    setPostLoginRedirect(location.pathname + location.search);
    navigate(to);
  };

  const sendMember = async (e: FormEvent) => {
    e.preventDefault();
    const content = message.trim();
    if (!content && !work) { setError('문의 내용을 적어 주세요.'); return; }
    setBusy(true); setError(null);
    try {
      const chat = (await api.post<{ id: number }>('/chats/direct', { userId: target.ownerId })).data;
      await api.post(`/chats/${chat.id}/messages`, work
        ? { content, attachmentUrl: work.url, attachmentType: 'IMAGE', attachmentName: work.title?.trim() || '작품' }
        : { content });
      setSentChat(chat.id);
    } catch (err) {
      setError((err as { response?: { data?: { error?: string } } })?.response?.data?.error || '보내지 못했어요. 잠시 후 다시 시도해 주세요.');
    } finally { setBusy(false); }
  };

  const sendGuest = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setError('이름을 적어 주세요.'); return; }
    if (!isContactLike(contact)) { setError('답을 받을 이메일이나 전화번호를 적어 주세요.'); return; }
    if (!message.trim()) { setError('문의 내용을 적어 주세요.'); return; }
    if (!agree) { setError('개인정보 수집·이용에 동의해 주세요.'); return; }
    setBusy(true); setError(null);
    try {
      await api.post('/homepage-inquiries', {
        ...(target.galleryId ? { galleryId: target.galleryId } : { artistId: target.ownerId }),
        ...(work ? { imageId: work.id } : {}),
        name: name.trim(), contact: contact.trim(), message: message.trim(), agree: true,
        website: honeypot.current?.value ?? '',
      });
      setSentGuest(true);
    } catch (err) {
      setError((err as { response?: { data?: { error?: string } } })?.response?.data?.error || '보내지 못했어요. 잠시 후 다시 시도해 주세요.');
    } finally { setBusy(false); }
  };

  const field = 'block w-full border border-[var(--hp-line)] bg-transparent px-3 text-[16px] text-[var(--hp-ink)] outline-none placeholder:text-[var(--hp-sub)] focus:border-[var(--hp-ink)]';
  const label = 'mb-1.5 block text-[13px] font-medium text-[var(--hp-ink)]';
  const done = sentChat != null || sentGuest;

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center md:items-center" style={themeVars}>
      <div className="absolute inset-0 bg-black/45" onClick={busy ? undefined : onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="inquiry-sheet"
        className="relative max-h-[92svh] w-full overflow-y-auto bg-[var(--hp-bg)] px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4 text-[var(--hp-ink)] shadow-2xl md:max-w-[440px] md:px-7 md:pb-7 md:pt-6"
        style={{ fontFamily: 'var(--hp-body-font)' }}
      >
        <div className="flex items-center justify-between">
          <h2 id={titleId} className="text-[17px] font-semibold">{work ? '작품 문의' : '문의하기'}</h2>
          <button type="button" onClick={onClose} disabled={busy} aria-label="닫기" className="-mr-2.5 grid h-11 w-11 place-items-center text-[var(--hp-sub)] hover:text-[var(--hp-ink)]">
            <X size={20} />
          </button>
        </div>

        {work && !done && (
          <div className="mt-2 flex items-center gap-3 border border-[var(--hp-line)] p-2.5">
            <span className="grid h-14 w-14 shrink-0 place-items-center"><img src={work.url} alt="" className="max-h-full max-w-full object-contain" /></span>
            <span className="min-w-0 text-[14px] break-keep [overflow-wrap:anywhere]">
              {work.title?.trim() || '제목 없는 작품'}
              <span className="block text-[12px] text-[var(--hp-sub)]">{target.name}</span>
            </span>
          </div>
        )}

        {done ? (
          <div className="py-6" role="status">
            <p className="text-[16px] font-semibold">{sentChat != null ? '메시지를 보냈어요' : '문의를 보냈어요'}</p>
            <p className="mt-1.5 text-[14px] leading-relaxed text-[var(--hp-sub)] break-keep">
              {sentChat != null ? `${target.name} 님의 답은 ArtTalk 에서 볼 수 있어요.` : `${target.name} 님이 적어 주신 연락처로 답합니다.`}
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              {sentChat != null && <PrimaryAction onClick={() => navigate(`/messages?chat=${sentChat}`)}>대화 보기</PrimaryAction>}
              <button type="button" onClick={onClose} className="inline-flex h-11 items-center border border-[var(--hp-line)] px-5 text-[14px]">닫기</button>
            </div>
          </div>
        ) : mode === 'login' ? (
          <div className="py-4">
            <p className="text-[14px] leading-relaxed text-[var(--hp-sub)] break-keep">로그인하면 {target.name} 님에게 메시지로 문의할 수 있어요.</p>
            <div className="mt-5 flex flex-wrap gap-2">
              <PrimaryAction onClick={() => toLogin('/login')}>로그인</PrimaryAction>
              <button type="button" onClick={() => toLogin('/signup')} className="inline-flex h-11 items-center border border-[var(--hp-line)] px-5 text-[14px]">회원가입</button>
            </div>
          </div>
        ) : mode === 'member' ? (
          <form onSubmit={sendMember} className="mt-4" noValidate>
            <label htmlFor={`${titleId}-msg`} className={label}>내용</label>
            <textarea
              id={`${titleId}-msg`}
              ref={(el) => { firstField.current = el; }}
              value={message}
              onChange={(e) => { setMessage(e.target.value); setError(null); }}
              rows={4}
              maxLength={2000}
              placeholder={`${target.name} 님에게 보낼 메시지`}
              className={`${field} resize-none py-2.5 leading-relaxed`}
            />
            {error && <p role="alert" className="mt-2 text-[13px] text-accent">{error}</p>}
            <PrimaryAction type="submit" disabled={busy} className="mt-4 w-full">{busy ? '보내는 중…' : '보내기'}</PrimaryAction>
          </form>
        ) : (
          <form onSubmit={sendGuest} className="mt-4 space-y-3.5" noValidate>
            <div>
              <label htmlFor={`${titleId}-name`} className={label}>이름</label>
              <input id={`${titleId}-name`} ref={(el) => { firstField.current = el; }} value={name} onChange={(e) => { setName(e.target.value); setError(null); }} maxLength={INQUIRY_NAME_MAX} autoComplete="name" className={`${field} h-11`} />
            </div>
            <div>
              <label htmlFor={`${titleId}-contact`} className={label}>연락처 <span className="font-normal text-[var(--hp-sub)]">(이메일 또는 전화번호)</span></label>
              <input id={`${titleId}-contact`} value={contact} onChange={(e) => { setContact(e.target.value); setError(null); }} maxLength={INQUIRY_CONTACT_MAX} autoComplete="email" inputMode="email" className={`${field} h-11`} />
            </div>
            <div>
              <label htmlFor={`${titleId}-msg`} className={label}>내용</label>
              <textarea id={`${titleId}-msg`} value={message} onChange={(e) => { setMessage(e.target.value); setError(null); }} rows={4} maxLength={INQUIRY_MESSAGE_MAX} className={`${field} resize-none py-2.5 leading-relaxed`} />
            </div>
            {/* 숨은 칸 — 사람에게는 안 보인다. 봇이 채우면 서버가 받은 척하고 버린다 */}
            <input ref={honeypot} name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="absolute -left-[9999px] h-px w-px opacity-0" defaultValue="" />
            {/* 동의 — 무엇을(이름·연락처·내용) 누구에게(받는 사람) 왜(답하려고) 언제까지(1년) — 동의하지 않으면 보낼 수 없다 */}
            <label className="flex cursor-pointer items-start gap-2.5 text-[13px] leading-relaxed">
              <input type="checkbox" checked={agree} onChange={(e) => { setAgree(e.target.checked); setError(null); }} className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--hp-ink)]" data-testid="inquiry-agree" />
              <span className="min-w-0 break-keep text-[var(--hp-sub)]">
                <span className="text-[var(--hp-ink)]">[필수] 개인정보 수집·이용 및 제공 동의</span> — 답을 받을 수 있게 이름·연락처·내용을 {target.name} 님에게 전달하고, 1년 뒤 지웁니다.
                동의하지 않으면 보낼 수 없어요. <Link to="/privacy" target="_blank" className="underline underline-offset-2">개인정보처리방침</Link>
              </span>
            </label>
            {error && <p role="alert" className="text-[13px] text-accent">{error}</p>}
            <PrimaryAction type="submit" disabled={busy} className="w-full">{busy ? '보내는 중…' : '보내기'}</PrimaryAction>
            <p className="text-center text-[13px] text-[var(--hp-sub)]">
              회원이면 <button type="button" onClick={() => toLogin('/login')} className="min-h-[32px] underline underline-offset-2 hover:text-[var(--hp-ink)]">로그인하고 메시지로</button>
            </p>
          </form>
        )}
      </div>
    </div>,
    document.body,
  );
}
