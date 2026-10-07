import nodemailer, { type Transporter } from 'nodemailer';
import { AppError } from '../middleware/errorHandler';

/**
 * 메일 보내기 (2026-10-08 — 갤러리 이메일 가입 인증번호 · 비밀번호 찾기).
 * 2026-07 에 옛 mailer(포트폴리오 자동 전송)를 지운 뒤 처음 다시 생긴 발송 경로다. 지금은 **인증번호 메일만** 보낸다(광고·알림 메일 없음).
 *
 * 환경 변수 — Render 에 넣는다. ⚠️ 앱 비밀번호는 저장소·문서·메모 어디에도 적지 말 것(로컬은 `backend/.env`, git 제외).
 *   SMTP_HOST      기본 smtp.gmail.com
 *   SMTP_PORT      기본 465 (465 = 처음부터 TLS, 587 = STARTTLS). ⚠️ Render 무료 요금제는 465·587 을 막는다 — 지금은 유료(Starter)라 열려 있다
 *   SMTP_USER      로그인 계정 (예: artlink.aws@gmail.com)
 *   SMTP_PASS      Google 앱 비밀번호 16자리(띄어쓰기는 빼고 쓴다 — 붙여 넣은 그대로여도 된다)
 *   MAIL_FROM      받는 사람에게 보일 이름·주소 (예: "ArtLink <artlink@artlink.cc>" — Gmail 의 '다른 주소에서 메일 보내기'에 등록된 주소여야
 *                  그대로 보인다. 등록 안 된 주소면 Gmail 이 로그인 계정 주소로 바꿔 보낸다). 없으면 "ArtLink <SMTP_USER>"
 *   MAIL_REPLY_TO  답장 받을 주소 (선택)
 *   MAIL_TRANSPORT=log  설정이 있어도 보내지 않고 서버 로그에만 남긴다
 *
 * 어디로 가는가:
 *   - 테스트(NODE_ENV=test): **절대 보내지 않는다** — 메모리 보관함(`devOutbox`)에만 쌓는다
 *   - 운영: SMTP 로 보낸다. 설정이 없으면 503 — 인증번호를 받을 길이 없는데 '보냈어요' 라고 하면 안 된다
 *   - 로컬: SMTP 설정이 있으면 보낸다. 단 **테스트용 가짜 주소**(아래 `isDevFakeAddress`)는 보내지 않고 로그 + 보관함으로 —
 *     E2E·시드가 쓰는 @artlink.com·@test.com 같은 주소는 남의 실제 도메인이라, 거기로 인증 메일이 나가면 발신 계정 평판이 깎인다.
 *     로그·보관함의 번호는 개발자 로그인과 같은 이중 차단(`GET /api/auth/dev-mails`)으로만 본다.
 */

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

const OUTBOX_MAX = 50;
/** 실제로 보내지 않은 메일 — 테스트와 로컬 확인용. 운영에서는 비워 둔다 */
const outbox: (OutgoingMail & { at: Date })[] = [];

const isProduction = () => process.env.NODE_ENV === 'production';
const isTest = () => process.env.NODE_ENV === 'test';

function smtpConfig() {
  const user = (process.env.SMTP_USER ?? '').trim();
  const pass = (process.env.SMTP_PASS ?? '').replace(/\s+/g, '');   // Google 앱 비밀번호는 4자리씩 띄어 보여 준다 — 그대로 붙여 넣어도 되게
  if (!user || !pass) return null;
  const port = Number(process.env.SMTP_PORT) || 465;
  return { host: (process.env.SMTP_HOST ?? '').trim() || 'smtp.gmail.com', port, user, pass };
}

/** SMTP 로 실제 발송할 수 있게 설정됐는가 */
export function mailConfigured(): boolean {
  return !!smtpConfig() && process.env.MAIL_TRANSPORT !== 'log';
}

/**
 * 로컬에서 보내지 않을 주소 — 예약된 도메인(RFC 2606·6761)과 이 저장소의 시드·테스트가 쓰는 도메인.
 * ⚠️ 운영에서는 보지 않는다(실제 회원 주소일 수 있다).
 */
const DEV_FAKE_DOMAINS = new Set([
  'example.com', 'example.net', 'example.org',
  'artlink.com', 'test.com', 't.com', 'b.c', 'seoulmodern.com', 'busanart.kr',
]);
export function isDevFakeAddress(email: string): boolean {
  const domain = email.split('@')[1]?.toLowerCase() ?? '';
  if (!domain) return true;
  if (DEV_FAKE_DOMAINS.has(domain)) return true;
  return /\.(test|example|invalid|localhost|local)$/.test(domain);
}

let transporter: Transporter | null = null;
let transporterKey = '';
function getTransporter(cfg: NonNullable<ReturnType<typeof smtpConfig>>): Transporter {
  const key = `${cfg.host}:${cfg.port}:${cfg.user}:${cfg.pass}`;
  if (!transporter || transporterKey !== key) {
    transporter = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.port === 465,
      auth: { user: cfg.user, pass: cfg.pass },
      // 메일 서버가 느리면 가입 화면이 하염없이 돈다 — 오래 기다리지 않고 '다시 시도해 주세요' 로 끝낸다
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
    transporterKey = key;
  }
  return transporter;
}

function keep(mail: OutgoingMail) {
  if (isProduction()) return;
  outbox.push({ ...mail, at: new Date() });
  if (outbox.length > OUTBOX_MAX) outbox.splice(0, outbox.length - OUTBOX_MAX);
}

/** 보내지 않고 남긴 메일(최근 것부터). 운영에서는 늘 빈 배열 */
export function devOutbox(to?: string): (OutgoingMail & { at: Date })[] {
  const want = to?.trim().toLowerCase();
  return outbox.filter((m) => !want || m.to.toLowerCase() === want).slice().reverse();
}

/** 테스트용 — 보관함 비우기 */
export function clearDevOutbox() {
  outbox.length = 0;
}

export async function sendMail(mail: OutgoingMail): Promise<void> {
  if (isTest()) {
    keep(mail);
    return;
  }
  const cfg = mailConfigured() ? smtpConfig() : null;
  if (!cfg) {
    if (isProduction()) {
      console.error('[Mail] SMTP 설정이 없어 메일을 보내지 못했습니다 (SMTP_USER/SMTP_PASS 확인)');
      throw new AppError('지금은 인증 메일을 보낼 수 없어요. 잠시 후 다시 시도해 주세요.', 503);
    }
    keep(mail);
    console.log(`[Mail] (보내지 않음 — SMTP 설정 없음) to=${mail.to} subject=${mail.subject}\n${mail.text}`);
    return;
  }
  if (!isProduction() && isDevFakeAddress(mail.to)) {
    keep(mail);
    console.log(`[Mail] (보내지 않음 — 테스트용 주소) to=${mail.to} subject=${mail.subject}`);
    return;
  }
  const from = (process.env.MAIL_FROM ?? '').trim() || `ArtLink <${cfg.user}>`;
  const replyTo = (process.env.MAIL_REPLY_TO ?? '').trim() || undefined;
  try {
    await getTransporter(cfg).sendMail({ from, to: mail.to, replyTo, subject: mail.subject, text: mail.text, html: mail.html });
  } catch (e: any) {
    // 비밀번호·본문(인증번호)은 로그에 남기지 않는다 — 원인 판단에 필요한 코드만
    console.error('[Mail] 발송 실패', { to: mail.to, code: e?.code, responseCode: e?.responseCode, command: e?.command });
    throw new AppError('인증 메일을 보내지 못했어요. 잠시 후 다시 시도해 주세요.', 502);
  }
}

/** SMTP 로그인만 확인한다(메일은 보내지 않는다) — 로컬에서 설정을 맞췄는지 볼 때 */
export async function verifyMailLogin(): Promise<boolean> {
  const cfg = smtpConfig();
  if (!cfg) return false;
  await getTransporter(cfg).verify();
  return true;
}
