/**
 * 알림을 눌러 들어온 화면에서는 소개·홈페이지 팝업을 띄우지 않는다 — lib/popupHold.ts (2026-11-11, CLAUDE.md 규칙 79)
 * 계기: 에뮬레이터에서 앱이 꺼진 채 문의 답변 알림을 눌렀더니 그 문의 위로 'Welcome to ArtLink'(하루 첫 방문)가 떴다.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  holdPopupsFor, popupsHeldAt, notePopupHoldPath, subscribePopupHold, popupHoldVersion, ARRIVE_TIMEOUT_MS, __resetPopupHold,
} from '@/lib/popupHold';

const SRC = join(__dirname, '..');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');

function at(path: string) { window.history.replaceState(null, '', path); }

beforeEach(() => { __resetPopupHold(); at('/'); });
afterEach(() => { vi.useRealTimers(); __resetPopupHold(); });

describe('popupHold', () => {
  it('아무도 걸지 않으면(웹) 늘 false — 웹 동작은 그대로', () => {
    expect(popupsHeldAt('/')).toBe(false);
    notePopupHoldPath('/support');
    expect(popupsHeldAt('/support')).toBe(false);
  });

  it('★ 알림을 누른 순간부터 그 화면에 닿기 전까지는 어디서든 막는다(앱이 막 켜져 첫 화면에서 팝업 타이머가 돌던 중)', () => {
    holdPopupsFor('/support?inquiry=3');
    expect(popupsHeldAt('/')).toBe(true);
    notePopupHoldPath('/support');
    expect(popupsHeldAt('/support')).toBe(true);
  });

  it('★ 그 화면을 떠나면 풀린다 — 그때부터는 원래 규칙대로(하루 첫 방문 팝업이 다음 화면에서 뜬다)', () => {
    holdPopupsFor('/support?inquiry=3');
    notePopupHoldPath('/support');
    expect(popupsHeldAt('/')).toBe(false); // 판정은 상태를 바꾸지 않는다 — 렌더에서 불러도 된다
    notePopupHoldPath('/');
    expect(popupsHeldAt('/support')).toBe(false); // 다시 돌아와도 풀린 채
  });

  it('이미 그 화면이면 곧바로 닿은 것으로 친다(같은 주소로의 이동은 주소 변화가 없다)', () => {
    at('/support');
    holdPopupsFor('/support?inquiry=9');
    expect(popupsHeldAt('/support')).toBe(true);
    expect(popupsHeldAt('/')).toBe(false);
  });

  it('끝 슬래시·쿼리·해시는 같은 화면으로 본다', () => {
    holdPopupsFor('/messages/?chat=4#x');
    notePopupHoldPath('/messages');
    expect(popupsHeldAt('/messages/')).toBe(true);
  });

  it('끝내 닿지 못하면 ARRIVE_TIMEOUT_MS 뒤 풀린다(영영 막히지 않게)', () => {
    vi.useFakeTimers();
    holdPopupsFor('/support?inquiry=1');
    vi.advanceTimersByTime(ARRIVE_TIMEOUT_MS - 1);
    expect(popupsHeldAt('/')).toBe(true);
    vi.advanceTimersByTime(1);
    expect(popupsHeldAt('/')).toBe(false);
  });

  it('걸리고 풀릴 때 구독자에게 알리고 숫자가 오른다(useSyncExternalStore)', () => {
    const cb = vi.fn();
    const off = subscribePopupHold(cb);
    const v0 = popupHoldVersion();
    holdPopupsFor('/support');
    notePopupHoldPath('/support');
    notePopupHoldPath('/');
    expect(cb).toHaveBeenCalledTimes(3);
    expect(popupHoldVersion()).toBe(v0 + 3);
    off();
  });
});

describe('붙이는 곳 — 소스 가드', () => {
  it('알림을 누르면 이동하기 **전에** 건다', () => {
    const s = read('lib/native.ts');
    const fn = s.slice(s.indexOf('export async function openNotification'), s.indexOf('export function onPushReceived'));
    expect(fn.indexOf('holdPopupsFor(')).toBeGreaterThan(0);
    expect(fn.indexOf('holdPopupsFor(')).toBeLessThan(fn.indexOf('openPath('));
    expect(s).toMatch(/notePopupHoldPath\(pathname\)/);
  });

  it('소개 팝업·홈페이지 팝업 둘 다 판정을 본다(소개 팝업은 열기 직전에 지금 주소로 한 번 더)', () => {
    const intro = read('components/shared/GuestIntro.tsx');
    expect(intro).toMatch(/popupsHeldAt\(location\.pathname\)/);
    expect(intro).toMatch(/popupsHeldAt\(window\.location\.pathname\)/);
    expect(intro).toMatch(/const shown = open && !held/);
    const nudge = read('components/shared/HomepageNudge.tsx');
    expect(nudge).toMatch(/popupsHeldAt\(location\.pathname\)/);
    expect(nudge).toMatch(/settledAt === here && !held/);
  });

  it('★ 걸 때 \'봤다\'로 적지 않는다 — 두 팝업 모두 사람이 답할 때만 적는다', () => {
    const s = read('lib/popupHold.ts');
    expect(s).not.toMatch(/markMemberIntroDay|markIntroAnswered|markHomepageNudgeSeen|localStorage|sessionStorage/);
  });
});
