import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import type { Prisma } from '@prisma/client';
import prisma from './prisma';
import { JWT_SECRET } from './jwt';
import { LOCK_NS, withKeyLock } from './keyLock';
import { sendMail } from './mailer';
import { AppError } from '../middleware/errorHandler';

/**
 * 이메일 인증번호 (2026-10-08 사용자 결정 — 갤러리는 이메일·비밀번호로도 가입한다).
 *
 * 흐름: [번호 받기] `issueEmailCode` → 메일로 6자리 → [확인] `verifyEmailCode` 가 **인증 토큰**(30분)을 준다
 *       → 가입·비밀번호 재설정이 그 토큰을 내고, 같은 트랜잭션에서 `consumeEmailCode` 로 **한 번만** 쓴다.
 *
 * ⚠️⚠️ 가입 단계에서 이메일 주소만 받고 'DB 에 인증된 줄이 있나' 로 판정하지 말 것 — 맞힌 사람이 가입을 마치기 전에
 *    남이 같은 주소로 가입 요청을 보내 **남의 비밀번호로 그 계정을 먼저 만들 수 있다**. 그래서 맞힌 사람에게만 토큰을 준다.
 * ⚠️ 토큰에는 `kind: 'email-verified'` 를 넣고 읽을 때 꼭 확인한다 — 같은 비밀 키로 서명한 다른 토큰(로그인 토큰·카카오 가입 토큰)이
 *    이 자리에 들어오면 안 되고, 반대로 이 토큰이 그 자리에 들어가도 안 된다(카카오 가입 완료가 provider 를 확인하는 이유).
 *
 * 한도: 번호는 10분 · 5번 틀리면 그 번호는 끝 · 다시 받기는 1분 뒤 · 한 주소에 1시간 5번(목적별).
 *       IP 단위로는 index.ts 의 로그인·가입 한도(15분 30회)가 함께 건다.
 * 가장 최근에 보낸 번호만 받는다(다시 받으면 앞 번호는 못 쓴다).
 */
export type EmailCodePurpose = 'SIGNUP' | 'RESET';

export const CODE_TTL_MS = 10 * 60_000;
export const VERIFIED_TTL_MS = 30 * 60_000;
export const MAX_ATTEMPTS = 5;
export const RESEND_COOLDOWN_MS = 60_000;
export const MAX_SENDS_PER_HOUR = 5;
/**
 * 하루(24시간)에 보내는 인증번호 메일 전체 상한. Gmail 개인 계정은 하루 약 500통이고, **같은 계정으로 갤러리 홍보 메일도 보낸다**
 * (사용자의 메일 발송기). 누가 아무 주소로 번호를 계속 요청하면 한도가 바닥나 계정이 막힐 수 있어 여기서 먼저 끊는다 —
 * 넘으면 503(가입이 잠시 막히는 편이 발신 계정이 정지되는 것보다 낫다). IP 단위로는 index.ts 가 1시간 10번을 따로 건다.
 */
export const DAILY_SEND_MAX = 300;
/** 이만큼 지난 줄은 지운다(개인정보처리방침 3항 — 인증번호 기록은 하루) */
const KEEP_MS = 24 * 3600_000;

export function normalizeEmail(raw: unknown): string {
  return String(raw ?? '').trim().toLowerCase();
}

function hashCode(email: string, purpose: EmailCodePurpose, code: string): string {
  return crypto.createHmac('sha256', JWT_SECRET).update(`${purpose}:${email}:${code}`).digest('hex');
}

function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** advisory lock 키(int32) — 주소·목적마다 하나 */
function lockKey(email: string, purpose: EmailCodePurpose): number {
  return crypto.createHash('sha256').update(`${purpose}:${email}`).digest().readInt32BE(0);
}

const PURPOSE_TEXT: Record<EmailCodePurpose, { subject: string; title: string; lead: string }> = {
  SIGNUP: { subject: '이메일 인증번호', title: '이메일 인증번호', lead: '갤러리 회원가입 화면에 아래 번호를 입력해 주세요.' },
  RESET: { subject: '비밀번호 재설정 인증번호', title: '비밀번호 재설정 인증번호', lead: '비밀번호 찾기 화면에 아래 번호를 입력해 주세요.' },
};

/** 인증번호 메일 — 번호는 숫자 6자리라 HTML 에 그대로 넣어도 안전하다 */
export function codeMail(purpose: EmailCodePurpose, code: string) {
  const t = PURPOSE_TEXT[purpose];
  const minutes = CODE_TTL_MS / 60_000;
  const text = [
    `[ArtLink] ${t.title}`,
    '',
    t.lead,
    '',
    `인증번호: ${code}`,
    '',
    `${minutes}분 안에 입력해 주세요.`,
    '본인이 요청하지 않았다면 이 메일은 무시하셔도 됩니다.',
    '',
    'ArtLink · https://artlink.cc',
  ].join('\n');
  const html = `<!doctype html><html lang="ko"><body style="margin:0;padding:0;background:#f5f5f4;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f4;padding:32px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border:1px solid #e7e5e4;">
<tr><td style="padding:32px 32px 8px;font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;">
<p style="margin:0 0 24px;font-size:20px;font-weight:700;letter-spacing:-0.02em;color:#111827;">Art<span style="color:#c4302b;">Link</span></p>
<p style="margin:0 0 8px;font-size:18px;font-weight:600;color:#111827;">${t.title}</p>
<p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#4b5563;">${t.lead}</p>
<p style="margin:0 0 24px;padding:18px 0;text-align:center;background:#f5f5f4;font-size:32px;font-weight:700;letter-spacing:0.3em;color:#111827;font-family:'SFMono-Regular',Menlo,Consolas,monospace;">${code}</p>
<p style="margin:0 0 6px;font-size:13px;line-height:1.6;color:#4b5563;">${minutes}분 안에 입력해 주세요.</p>
<p style="margin:0 0 28px;font-size:13px;line-height:1.6;color:#9ca3af;">본인이 요청하지 않았다면 이 메일은 무시하셔도 됩니다.</p>
</td></tr>
<tr><td style="padding:16px 32px;border-top:1px solid #e7e5e4;font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;font-size:12px;color:#9ca3af;">ArtLink · <a href="https://artlink.cc" style="color:#9ca3af;">artlink.cc</a></td></tr>
</table>
</td></tr>
</table>
</body></html>`;
  return { subject: `[ArtLink] ${t.subject} ${code}`, text, html };
}

/** 6자리 번호를 만들어 메일로 보낸다. 1분 안에 다시 누르면 429(몇 초 남았는지), 1시간 5번 넘으면 429 */
export async function issueEmailCode(email: string, purpose: EmailCodePurpose): Promise<{ expiresInSec: number; resendInSec: number }> {
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  const now = Date.now();
  // 하루 전체 상한 — 지난 24시간 줄 수(하루 지난 줄은 지우고, 못 보낸 줄도 지우므로 = 보낸 수)
  const sentToday = await prisma.emailCode.count({ where: { createdAt: { gte: new Date(now - KEEP_MS) } } });
  if (sentToday >= DAILY_SEND_MAX) {
    console.error(`[Mail] 인증번호 하루 상한(${DAILY_SEND_MAX}) 도달 — 요청이 몰리고 있다`);
    throw new AppError('지금은 인증 메일을 보낼 수 없어요. 잠시 후 다시 시도해 주세요.', 503);
  }
  const row = await withKeyLock(LOCK_NS.emailCodes, lockKey(email, purpose), async (tx) => {
    const recent = await tx.emailCode.findMany({
      where: { email, purpose, createdAt: { gte: new Date(now - 3600_000) } },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    const last = recent[0]?.createdAt.getTime();
    if (last && now - last < RESEND_COOLDOWN_MS) {
      const wait = Math.max(1, Math.ceil((RESEND_COOLDOWN_MS - (now - last)) / 1000));
      throw new AppError(`${wait}초 뒤에 다시 받을 수 있어요.`, 429);
    }
    if (recent.length >= MAX_SENDS_PER_HOUR) {
      throw new AppError('인증번호를 너무 여러 번 받았어요. 1시간 뒤에 다시 시도해 주세요.', 429);
    }
    return tx.emailCode.create({
      data: { email, purpose, codeHash: hashCode(email, purpose, code), expiresAt: new Date(now + CODE_TTL_MS) },
      select: { id: true },
    });
  });
  try {
    await sendMail({ to: email, ...codeMail(purpose, code) });
  } catch (e) {
    // 못 보낸 번호는 없던 것으로 — 남겨 두면 다시 누를 때 1분을 기다리게 되고, 1시간 한도도 헛되이 먹는다
    await prisma.emailCode.delete({ where: { id: row.id } }).catch(() => {});
    throw e;
  }
  // 하루 지난 줄은 지운다 — 실패해도 발송은 그대로
  void prisma.emailCode.deleteMany({ where: { createdAt: { lt: new Date(now - KEEP_MS) } } }).catch(() => {});
  return { expiresInSec: CODE_TTL_MS / 1000, resendInSec: RESEND_COOLDOWN_MS / 1000 };
}

/** 번호가 맞으면 인증 토큰(30분)을 준다 — 가입·재설정은 이 토큰으로만 한다 */
export async function verifyEmailCode(email: string, purpose: EmailCodePurpose, rawCode: unknown): Promise<string> {
  const code = String(rawCode ?? '').replace(/\D/g, '');
  if (code.length !== 6) throw new AppError('인증번호 6자리를 입력해 주세요.', 400);
  const row = await prisma.emailCode.findFirst({
    where: { email, purpose, usedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  if (!row || row.expiresAt.getTime() < Date.now()) {
    throw new AppError('인증번호가 만료됐어요. 새 번호를 받아 주세요.', 400);
  }
  // 맞혀 보기 **전에** 한 번을 먼저 쓴다 — 동시에 여러 번 넣어도 5번을 넘기지 못한다(세고 나서 비교하면 경합으로 넘친다)
  const spent = await prisma.emailCode.updateMany({
    where: { id: row.id, attempts: { lt: MAX_ATTEMPTS } },
    data: { attempts: { increment: 1 } },
  });
  if (spent.count === 0) throw new AppError('여러 번 틀려서 이 번호는 더 쓸 수 없어요. 새 번호를 받아 주세요.', 400);
  if (!sameHash(row.codeHash, hashCode(email, purpose, code))) {
    const left = MAX_ATTEMPTS - (row.attempts + 1);
    throw new AppError(
      left > 0 ? `인증번호가 맞지 않아요. ${left}번 더 넣을 수 있어요.` : '여러 번 틀려서 이 번호는 더 쓸 수 없어요. 새 번호를 받아 주세요.',
      400,
    );
  }
  if (!row.verifiedAt) await prisma.emailCode.update({ where: { id: row.id }, data: { verifiedAt: new Date() } });
  return jwt.sign({ kind: 'email-verified', email, purpose, codeId: row.id }, JWT_SECRET, { expiresIn: Math.floor(VERIFIED_TTL_MS / 1000) });
}

/** 인증 토큰을 읽는다 — 다른 종류의 토큰·다른 목적·만료는 전부 400 */
export function readVerificationToken(token: unknown, purpose: EmailCodePurpose): { email: string; codeId: number } {
  try {
    const p = jwt.verify(String(token ?? ''), JWT_SECRET) as any;
    if (p?.kind !== 'email-verified' || p.purpose !== purpose || typeof p.email !== 'string' || !Number.isInteger(p.codeId)) throw new Error('kind');
    return { email: p.email, codeId: p.codeId };
  } catch {
    throw new AppError('이메일 인증 시간이 지났어요. 인증번호를 다시 받아 주세요.', 400);
  }
}

/** 맞힌 번호를 **한 번만** 쓴다 — 가입·재설정과 같은 트랜잭션 안에서 부를 것(실패하면 함께 되돌아간다) */
export async function consumeEmailCode(tx: Prisma.TransactionClient, codeId: number, email: string, purpose: EmailCodePurpose): Promise<void> {
  const used = await tx.emailCode.updateMany({
    where: { id: codeId, email, purpose, usedAt: null, verifiedAt: { gte: new Date(Date.now() - VERIFIED_TTL_MS) } },
    data: { usedAt: new Date() },
  });
  if (used.count !== 1) throw new AppError('이미 쓴 인증이에요. 인증번호를 다시 받아 주세요.', 400);
}

/** 비밀번호 규칙 — 8~72자(bcrypt 는 72바이트까지만 본다), 영문과 숫자를 함께. 프론트 `lib/galleryAuth.ts passwordProblem` 과 같아야 한다 */
export function passwordProblem(pw: string): string | null {
  if (pw.length < 8) return '비밀번호는 8자 이상이어야 해요.';
  if (Buffer.byteLength(pw, 'utf8') > 72) return '비밀번호가 너무 길어요(영문 기준 72자까지).';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return '비밀번호에 영문과 숫자를 함께 넣어 주세요.';
  return null;
}
