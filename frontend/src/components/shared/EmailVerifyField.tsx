import { useEffect, useRef, useState } from 'react';
import api from '@/lib/axios';
import StatusChip from '@/components/flow/StatusChip';
import { CODE_LENGTH, authErrorMessage, cleanCodeInput, formatRemaining, looksLikeEmail, normalizeEmail } from '@/lib/emailAuth';

/**
 * 이메일 인증번호 칸 (2026-10-08) — 이메일 가입(아티스트·갤러리·일반)·비밀번호 찾기가 같이 쓴다.
 * [인증번호 받기] → 메일의 6자리 → [확인] → 서버가 준 인증 토큰을 `onVerified` 로 넘긴다(30분 안에 가입·재설정에 한 번 쓴다).
 * 서버 규칙: 번호 10분 · 5번 틀리면 끝 · 다시 받기 1분 뒤 · 1시간 5번(backend `lib/emailCode.ts`).
 *
 * ⚠️ 바깥 <form> 안에 들어간다 — 이 칸들에서 Enter 를 누르면 가입 폼이 제출되지 않게 막고, 이 칸의 동작(받기·확인)을 한다.
 * ⚠️ 서버가 말한 이유를 그대로 보여 준다("카카오로 가입한 계정이에요" 처럼 다음 할 일이 들어 있다).
 */
export default function EmailVerifyField({ purpose, verified, onVerified, onReset }: {
  purpose: 'signup' | 'reset';
  /** 인증을 마친 주소 — 있으면 잠긴 줄로 보여 준다 */
  verified: string | null;
  onVerified: (email: string, token: string) => void;
  /** [바꾸기] — 인증을 풀고 처음부터 */
  onReset: () => void;
}) {
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [expiresAt, setExpiresAt] = useState(0);
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [sending, setSending] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const codeRef = useRef<HTMLInputElement>(null);

  // 남은 시간 — 번호를 보내 둔 동안만 1초마다
  useEffect(() => {
    if (!sentTo || verified) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [sentTo, verified]);

  const send = async () => {
    setError('');
    if (!looksLikeEmail(email)) {
      setError('이메일 주소를 확인해 주세요.');
      return;
    }
    setSending(true);
    try {
      const { data } = await api.post('/auth/email/code', { email: email.trim(), purpose });
      const t = Date.now();
      setSentTo(normalizeEmail(email));
      setCode('');
      setExpiresAt(t + (data.expiresInSec ?? 600) * 1000);
      setResendAt(t + (data.resendInSec ?? 60) * 1000);
      setNow(t);
      window.setTimeout(() => codeRef.current?.focus(), 0);
    } catch (err: any) {
      setError(authErrorMessage(err, '인증번호를 보내지 못했어요. 잠시 후 다시 시도해 주세요.'));
    } finally {
      setSending(false);
    }
  };

  const check = async () => {
    setError('');
    if (!sentTo) return;
    if (code.length !== CODE_LENGTH) {
      setError('인증번호 6자리를 입력해 주세요.');
      return;
    }
    setChecking(true);
    try {
      const { data } = await api.post('/auth/email/verify', { email: sentTo, purpose, code });
      onVerified(sentTo, data.verificationToken);
    } catch (err: any) {
      setError(authErrorMessage(err, '확인하지 못했어요. 다시 시도해 주세요.'));
    } finally {
      setChecking(false);
    }
  };

  if (verified) {
    return (
      <div>
        <p className="mb-1 block text-xs text-gray-500">이메일</p>
        <div className="flex h-11 items-center justify-between gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3">
          <span className="min-w-0 truncate text-sm text-gray-900">{verified}</span>
          <span className="flex shrink-0 items-center gap-2">
            <StatusChip variant="done">인증 완료</StatusChip>
            <button
              type="button"
              onClick={() => { setSentTo(null); setCode(''); setError(''); onReset(); }}
              className="text-xs text-gray-500 underline underline-offset-2 hover:text-gray-900"
            >바꾸기</button>
          </span>
        </div>
      </div>
    );
  }

  const resendLeft = resendAt - now;
  const codeLeft = expiresAt - now;
  const inputCls = 'h-11 min-w-0 flex-1 rounded-lg border border-gray-200 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-gray-400';
  return (
    <div className="space-y-3">
      <div>
        <label htmlFor={`ev-email-${purpose}`} className="mb-1 block text-xs text-gray-500">이메일</label>
        <div className="flex gap-2">
          <input
            id={`ev-email-${purpose}`}
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              // 보낸 주소와 달라지면 그 번호는 이 주소의 것이 아니다
              if (sentTo && normalizeEmail(e.target.value) !== sentTo) { setSentTo(null); setCode(''); }
            }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }}
            placeholder="name@example.com"
            className={inputCls}
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={sending || (!!sentTo && resendLeft > 0)}
            className="h-11 shrink-0 rounded-lg border border-gray-900 px-3 text-sm font-medium text-gray-900 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-400"
          >
            {sending ? '보내는 중…' : sentTo ? (resendLeft > 0 ? `다시 받기 ${Math.ceil(resendLeft / 1000)}초` : '다시 받기') : '인증번호 받기'}
          </button>
        </div>
      </div>
      {sentTo && (
        <div>
          <label htmlFor={`ev-code-${purpose}`} className="mb-1 block text-xs text-gray-500">인증번호</label>
          <div className="flex gap-2">
            <input
              id={`ev-code-${purpose}`}
              ref={codeRef}
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(cleanCodeInput(e.target.value))}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void check(); } }}
              placeholder="6자리 숫자"
              className={`${inputCls} tabular-nums tracking-[0.2em] placeholder:tracking-normal`}
            />
            <button
              type="button"
              onClick={() => void check()}
              disabled={checking || code.length !== CODE_LENGTH}
              className="h-11 shrink-0 rounded-lg bg-gray-900 px-4 text-sm font-medium text-white transition-colors hover:bg-gray-800 disabled:opacity-50"
            >{checking ? '확인 중…' : '확인'}</button>
          </div>
          <p className="mt-1.5 break-keep text-xs leading-relaxed text-gray-500">
            <b className="font-medium text-gray-700">{sentTo}</b> 로 보냈어요.{' '}
            {codeLeft > 0 ? `${formatRemaining(codeLeft)} 안에 입력해 주세요.` : '시간이 지났어요. 다시 받아 주세요.'}{' '}
            메일이 안 보이면 스팸함도 확인해 주세요.
          </p>
        </div>
      )}
      {error && <p role="alert" className="break-keep text-sm text-accent">{error}</p>}
    </div>
  );
}
