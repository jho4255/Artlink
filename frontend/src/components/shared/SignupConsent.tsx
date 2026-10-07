import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { TermsBody } from '@/pages/TermsPage';
import { PrivacyBody } from '@/pages/PrivacyPage';

/**
 * 가입 필수 동의 — 이용약관 · 개인정보 처리방침. 카카오 가입(AuthCallbackPage)과 이메일 가입(EmailSignupPage)이 같이 쓴다.
 * 서버도 둘 다 true 가 아니면 400 으로 막는다(화면에서만 막으면 API 를 직접 부르는 순간 미동의 가입이 된다).
 *
 * **끝까지 읽어야 체크된다**(2026-10-08 사용자 결정). 전문을 칸 안에 띄우고, 그 칸을 맨 아래까지 내려야 그 항목에 체크할 수 있다.
 * 읽기 전에 누르면 체크하지 않고 "끝까지 읽어야 체크할 수 있어요" 를 보여 주며 그 칸으로 데려간다(비활성으로 두면 왜 안 되는지 모른다).
 * 예전의 회색 요약 두 줄(자동 처리 사항 · 수집 항목)은 없앴다 — 전문을 읽게 하는 게 그 일을 대신한다.
 * 본문은 /terms · /privacy 화면과 같은 컴포넌트(`TermsBody`·`PrivacyBody`)라 문구가 어긋나지 않는다.
 * ⚠️ 마케팅 수신 동의는 두지 않는다 — 우리가 보내는 메일은 인증번호뿐이다.
 */
type Doc = 'terms' | 'privacy';
const DOC_LABEL: Record<Doc, string> = { terms: '이용약관', privacy: '개인정보 처리방침' };

/** 맨 아래까지 내렸는가 — 몇 px 모자라도 끝으로 친다(소수점 스크롤·확대 배율) */
function atBottom(el: HTMLElement): boolean {
  return el.scrollTop + el.clientHeight >= el.scrollHeight - 12;
}

function DocBox({ doc, children, onRead, boxRef }: {
  doc: Doc;
  children: ReactNode;
  onRead: () => void;
  boxRef: React.RefObject<HTMLDivElement | null>;
}) {
  // 내용이 칸보다 짧으면(큰 화면 등) 내릴 것 없이 다 읽은 것이다
  useEffect(() => {
    const el = boxRef.current;
    if (el && atBottom(el)) onRead();
  }, [boxRef, onRead]);
  return (
    <div
      ref={boxRef}
      tabIndex={0}
      role="region"
      aria-label={`${DOC_LABEL[doc]} 전문`}
      data-consent-doc={doc}
      onScroll={(e) => { if (atBottom(e.currentTarget)) onRead(); }}
      className="h-40 overflow-y-auto overscroll-contain rounded-md border border-gray-200 bg-gray-50 px-3 py-2.5 text-left focus:outline-none focus:ring-1 focus:ring-gray-400"
    >
      {children}
    </div>
  );
}

export default function SignupConsent({ agreeTerms, agreePrivacy, onChange }: {
  agreeTerms: boolean;
  agreePrivacy: boolean;
  onChange: (next: { agreeTerms: boolean; agreePrivacy: boolean }) => void;
}) {
  const [read, setRead] = useState<Record<Doc, boolean>>({ terms: false, privacy: false });
  // 읽기 전에 체크하려 한 칸 — 그 칸 아래에 이유를 보여 준다
  const [nudge, setNudge] = useState<Doc | null>(null);
  const termsRef = useRef<HTMLDivElement>(null);
  const privacyRef = useRef<HTMLDivElement>(null);
  const refOf = (d: Doc) => (d === 'terms' ? termsRef : privacyRef);

  const markTerms = useCallback(() => setRead((r) => (r.terms ? r : { ...r, terms: true })), []);
  const markPrivacy = useCallback(() => setRead((r) => (r.privacy ? r : { ...r, privacy: true })), []);

  const point = (d: Doc) => {
    setNudge(d);
    const el = refOf(d).current;
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el?.focus({ preventScroll: true });
  };

  const toggle = (d: Doc, checked: boolean) => {
    if (checked && !read[d]) { point(d); return; }
    setNudge(null);
    onChange(d === 'terms' ? { agreeTerms: checked, agreePrivacy } : { agreeTerms, agreePrivacy: checked });
  };

  const toggleAll = (checked: boolean) => {
    if (checked) {
      const unread = (['terms', 'privacy'] as Doc[]).find((d) => !read[d]);
      if (unread) { point(unread); return; }
    }
    setNudge(null);
    onChange({ agreeTerms: checked, agreePrivacy: checked });
  };

  const item = (d: Doc, checked: boolean, body: ReactNode, onRead: () => void) => (
    <div>
      <p className="mb-1.5 text-left text-sm font-medium text-gray-900">
        <b className="font-medium">[필수]</b> {DOC_LABEL[d]}
      </p>
      <DocBox doc={d} onRead={onRead} boxRef={refOf(d)}>{body}</DocBox>
      <label className={`mt-2 flex cursor-pointer items-center gap-2 text-left ${read[d] ? '' : 'opacity-60'}`}>
        <input
          type="checkbox"
          checked={checked}
          aria-disabled={!read[d]}
          onChange={(e) => toggle(d, e.target.checked)}
          className="h-4 w-4 accent-gray-900"
        />
        <span className="text-sm text-gray-700">{DOC_LABEL[d]}에 동의합니다</span>
      </label>
      {nudge === d && !read[d] && (
        <p role="alert" className="mt-1 text-left text-xs text-accent">끝까지 읽어야 체크할 수 있어요.</p>
      )}
    </div>
  );

  return (
    <div className="space-y-4 rounded-lg border border-gray-200 p-3">
      <label className={`flex cursor-pointer items-center gap-2 border-b border-gray-100 pb-3 ${read.terms && read.privacy ? '' : 'opacity-60'}`}>
        <input
          type="checkbox"
          checked={agreeTerms && agreePrivacy}
          aria-disabled={!(read.terms && read.privacy)}
          onChange={(e) => toggleAll(e.target.checked)}
          className="h-4 w-4 accent-gray-900"
        />
        <span className="text-sm font-medium text-gray-900">전체 동의</span>
      </label>
      {item('terms', agreeTerms, <TermsBody compact />, markTerms)}
      {item('privacy', agreePrivacy, <PrivacyBody compact />, markPrivacy)}
    </div>
  );
}
