import logger from './logger';

type ApprovalKind = 'gallery' | 'exhibition' | 'show' | 'edit-request';

interface ApprovalNotificationInput {
  kind: ApprovalKind;
  title: string;
  targetId: number;
  requesterName?: string;
  requesterEmail?: string;
  galleryName?: string;
}

const kindLabels: Record<ApprovalKind, string> = {
  gallery: '갤러리 등록',
  exhibition: '공모 등록',
  show: '전시 등록',
  'edit-request': '수정 요청',
};

function appBaseUrl(): string {
  return (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/+$/, '');
}

async function sendTelegramMessage(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_APPROVAL_CHAT_ID;

  if (!token || !chatId) {
    logger.debug('Telegram', 'Approval notification skipped: Telegram env missing');
    return;
  }

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Telegram sendMessage failed: ${response.status} ${body.slice(0, 300)}`);
  }
}

export async function notifyApprovalRequest(input: ApprovalNotificationInput): Promise<void> {
  const lines = [
    '[ArtLink 승인요청]',
    `유형: ${kindLabels[input.kind]}`,
    `이름: ${input.title}`,
    `대상 ID: ${input.targetId}`,
  ];

  if (input.galleryName) lines.push(`갤러리: ${input.galleryName}`);
  if (input.requesterName || input.requesterEmail) {
    lines.push(`요청자: ${input.requesterName || 'Unknown'}${input.requesterEmail ? ` (${input.requesterEmail})` : ''}`);
  }
  lines.push(`확인: ${appBaseUrl()}/mypage`);

  try {
    await sendTelegramMessage(lines.join('\n'));
  } catch (error) {
    logger.warn('Telegram', 'Approval notification failed', {
      kind: input.kind,
      targetId: input.targetId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
