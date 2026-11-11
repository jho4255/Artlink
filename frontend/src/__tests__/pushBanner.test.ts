/**
 * 앱을 보고 있을 때 온 알림 — 카카오톡처럼 (2026-11-11, CLAUDE.md 규칙 79) · lib/pushBanner.ts
 * 그 화면을 보고 있으면 조용히, 아니면 위쪽 배너.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isOnTarget, pushBannerWanted, showPushBanner, dismissPushBanner, getPushBanner, __resetPushBanner } from '@/lib/pushBanner';
import { onPushReceived } from '@/lib/native';

const at = (url: string) => { const u = new URL(url, 'https://x.invalid'); return { pathname: u.pathname, search: u.search }; };
const SRC = join(__dirname, '..');

beforeEach(() => { __resetPushBanner(); window.history.replaceState(null, '', '/'); });

describe('isOnTarget — 그 화면을 보고 있나', () => {
  it('★ 대화: 그 방을 보고 있거나 대화 목록이면 조용히 · 다른 방이면 배너', () => {
    expect(isOnTarget('/messages?chat=10', at('/messages?chat=10'), 'CHAT_MESSAGE')).toBe(true);
    expect(isOnTarget('/messages?chat=10', at('/messages'), 'CHAT_MESSAGE')).toBe(true);
    expect(isOnTarget('/messages?chat=10', at('/messages?chat=11'), 'CHAT_MESSAGE')).toBe(false);
    expect(isOnTarget('/messages?chat=10', at('/mypage'), 'CHAT_MESSAGE')).toBe(false);
  });

  it('그 밖의 알림: 경로와 링크의 쿼리가 다 같아야 같은 화면', () => {
    expect(isOnTarget('/support?inquiry=5', at('/support?inquiry=5'), 'INQUIRY_REPLY')).toBe(true);
    expect(isOnTarget('/support?inquiry=5', at('/support'), 'INQUIRY_REPLY')).toBe(false);
    expect(isOnTarget('/feed/', at('/feed'), 'STORY_COMMENT')).toBe(true);
    expect(isOnTarget('/portfolio/3?tab=guestbook', at('/portfolio/3?tab=guestbook&x=1'), 'GUESTBOOK_NEW')).toBe(true);
  });

  it('pushBannerWanted — 링크가 없으면 홈으로 본다', () => {
    expect(pushBannerWanted({ type: 'APPROVAL_RESULT' }, at('/'))).toBe(false);
    expect(pushBannerWanted({ type: 'APPROVAL_RESULT', linkUrl: '/galleries/2' }, at('/'))).toBe(true);
  });
});

describe('배너 상태', () => {
  it('새 배너가 오면 바꿔 끼우고, 옛 배너의 닫기 예약은 새 배너를 지우지 않는다', () => {
    showPushBanner({ title: 'A', body: '첫째', data: {} });
    const first = getPushBanner()!.key;
    showPushBanner({ title: 'B', body: '둘째', data: {} });
    dismissPushBanner(first);
    expect(getPushBanner()?.body).toBe('둘째');
    dismissPushBanner();
    expect(getPushBanner()).toBeNull();
  });
});

describe('onPushReceived — 앱을 보고 있을 때 온 푸시', () => {
  it('★ 다른 화면이면 배너를 띄운다 · 그 방을 보고 있으면 띄우지 않는다', () => {
    window.history.replaceState(null, '', '/mypage');
    onPushReceived({ type: 'CHAT_MESSAGE', linkUrl: '/messages?chat=7' }, { title: 'ArtTalk', body: '○○님의 새 메시지: 안녕' });
    expect(getPushBanner()).toMatchObject({ title: 'ArtTalk', body: '○○님의 새 메시지: 안녕' });

    __resetPushBanner();
    window.history.replaceState(null, '', '/messages?chat=7');
    onPushReceived({ type: 'CHAT_MESSAGE', linkUrl: '/messages?chat=7' }, { title: 'ArtTalk', body: '안녕' });
    expect(getPushBanner()).toBeNull();
  });

  it('본문이 없으면(옛 호출) 배너 없이 숫자만 고친다', () => {
    window.history.replaceState(null, '', '/mypage');
    onPushReceived({ type: 'INQUIRY_REPLY', linkUrl: '/support?inquiry=1' });
    expect(getPushBanner()).toBeNull();
  });

  it('소스 — 리스너가 제목·본문을 넘기고, 배너는 Layout 에 한 번 · 채널은 진동을 켠다', () => {
    const native = readFileSync(join(SRC, 'lib/native.ts'), 'utf8');
    expect(native).toContain("onPushReceived(n.data, { title: n.title, body: n.body })");
    expect(native).toMatch(/createChannel\(\{[\s\S]*?vibration: true/);
    expect(readFileSync(join(SRC, 'components/layout/Layout.tsx'), 'utf8')).toContain('<PushBanner />');
  });
});
