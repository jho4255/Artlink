/**
 * 작가 로그인 뒤 '홈페이지 완성' 팝업 — 언제 띄우는가 (2026-10-01)
 *
 * 화면(`HomepageNudge`)은 jsdom 에서 굳이 그리지 않는다. 판정을 순수 함수로 빼 두고 여기서 본다.
 * 실제로 뜨는지·닫히는지는 e2e `61-homepage-nudge.spec.ts`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  armHomepageNudge, armedHomepageNudgeUserId, disarmHomepageNudge, isHomepageNudgeSnoozed, nudgePlace,
  snoozeHomepageNudge, subscribeHomepageNudge, NUDGE_SNOOZE_DAYS,
} from '@/lib/homepageNudge';

class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
}
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 1);
const src = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf-8');

describe('팝업 예약 — 로그인한 작가에게만', () => {
  it('작가가 로그인하면 예약된다', () => {
    const s = new MemoryStorage(), l = new MemoryStorage();
    armHomepageNudge({ id: 7, role: 'ARTIST' }, NOW, s, l);
    expect(armedHomepageNudgeUserId(s)).toBe(7);
  });

  it('갤러리·일반·관리자는 예약되지 않는다 — 앞 계정의 예약도 지운다', () => {
    for (const role of ['GALLERY', 'VISITOR', 'ADMIN']) {
      const s = new MemoryStorage(), l = new MemoryStorage();
      armHomepageNudge({ id: 7, role: 'ARTIST' }, NOW, s, l);
      armHomepageNudge({ id: 8, role }, NOW, s, l);
      expect(armedHomepageNudgeUserId(s)).toBeNull();
    }
  });

  it('닫으면 다음 로그인까지 조용하고, 다시 로그인하면 또 예약된다', () => {
    const s = new MemoryStorage(), l = new MemoryStorage();
    armHomepageNudge({ id: 7, role: 'ARTIST' }, NOW, s, l);
    disarmHomepageNudge(s);
    expect(armedHomepageNudgeUserId(s)).toBeNull();
    armHomepageNudge({ id: 7, role: 'ARTIST' }, NOW + 60_000, s, l);
    expect(armedHomepageNudgeUserId(s)).toBe(7);
  });

  it('[7일 동안 보지 않기] — 그 기간엔 로그인해도 예약되지 않고, 지나면 다시 된다', () => {
    const s = new MemoryStorage(), l = new MemoryStorage();
    armHomepageNudge({ id: 7, role: 'ARTIST' }, NOW, s, l);
    snoozeHomepageNudge(7, NOW, s, l);
    expect(armedHomepageNudgeUserId(s)).toBeNull();
    expect(isHomepageNudgeSnoozed(7, NOW + 1, l)).toBe(true);

    armHomepageNudge({ id: 7, role: 'ARTIST' }, NOW + (NUDGE_SNOOZE_DAYS - 1) * DAY, s, l);
    expect(armedHomepageNudgeUserId(s)).toBeNull();

    armHomepageNudge({ id: 7, role: 'ARTIST' }, NOW + NUDGE_SNOOZE_DAYS * DAY + 1, s, l);
    expect(armedHomepageNudgeUserId(s)).toBe(7);
  });

  it('보지 않기는 계정별이다 — 같은 브라우저의 다른 작가는 그대로 뜬다', () => {
    const s = new MemoryStorage(), l = new MemoryStorage();
    snoozeHomepageNudge(7, NOW, s, l);
    armHomepageNudge({ id: 9, role: 'ARTIST' }, NOW + 1, s, l);
    expect(armedHomepageNudgeUserId(s)).toBe(9);
    // 나중에 9번이 눌러도 7번 기록은 남는다(아직 기간 안)
    snoozeHomepageNudge(9, NOW + 2, s, l);
    expect(isHomepageNudgeSnoozed(7, NOW + 3, l)).toBe(true);
    expect(isHomepageNudgeSnoozed(9, NOW + 3, l)).toBe(true);
  });

  it('저장소가 막혀 있거나 값이 깨져 있어도 던지지 않는다 — 팝업만 안 뜬다', () => {
    expect(() => armHomepageNudge({ id: 7, role: 'ARTIST' }, NOW, null, null)).not.toThrow();
    expect(armedHomepageNudgeUserId(null)).toBeNull();
    expect(() => snoozeHomepageNudge(7, NOW, null, null)).not.toThrow();

    const s = new MemoryStorage(), l = new MemoryStorage();
    s.setItem('artlink-homepage-nudge', 'abc');
    expect(armedHomepageNudgeUserId(s)).toBeNull();
    l.setItem('artlink-homepage-nudge-snooze', '[1,2');
    expect(isHomepageNudgeSnoozed(7, NOW, l)).toBe(false);
    armHomepageNudge({ id: 7, role: 'ARTIST' }, NOW, s, l);
    expect(armedHomepageNudgeUserId(s)).toBe(7);
  });

  it('예약이 바뀌면 화면에 알린다(useSyncExternalStore)', () => {
    const s = new MemoryStorage(), l = new MemoryStorage();
    let calls = 0;
    const off = subscribeHomepageNudge(() => { calls += 1; });
    armHomepageNudge({ id: 7, role: 'ARTIST' }, NOW, s, l);
    disarmHomepageNudge(s);
    expect(calls).toBe(2);
    off();
    armHomepageNudge({ id: 7, role: 'ARTIST' }, NOW, s, l);
    expect(calls).toBe(2);
  });
});

describe('nudgePlace — 하던 일을 끊지 않는다', () => {
  it('보통 화면에서는 띄운다', () => {
    for (const [p, q] of [['/', ''], ['/mypage', ''], ['/mypage', '?tab=applications'], ['/exhibitions', ''], ['/exhibitions/17', ''], ['/artists', ''], ['/@handle', '']] as const) {
      expect(nudgePlace(p, q), p + q).toBe('show');
    }
  });

  it('지원서·초대 코드 참여·로그인 화면에서는 기다린다', () => {
    expect(nudgePlace('/exhibitions/17/apply', '')).toBe('wait');
    expect(nudgePlace('/join/ABCD2345', '')).toBe('wait');
    expect(nudgePlace('/login', '')).toBe('wait');
    expect(nudgePlace('/auth/kakao/callback', '?code=x')).toBe('wait');
  });

  it('이미 홈페이지 편집 화면이면 띄우지 않고 끝낸다', () => {
    expect(nudgePlace('/mypage', '?tab=homepage-edit')).toBe('done');
    expect(nudgePlace('/mypage', '?tab=homepage-edit&x=1')).toBe('done');
    expect(nudgePlace('/mypage', '?tab=portfolio')).toBe('show');
  });
});

describe('연결 — 소스 대조', () => {
  it('로그인 경로 둘 다 갈 곳을 정한 뒤 팝업을 예약한다', () => {
    for (const f of ['pages/LoginPage.tsx', 'pages/AuthCallbackPage.tsx']) {
      const s = src(f);
      const resolve = s.indexOf('await resolvePostLoginPath(');
      const arm = s.indexOf('armHomepageNudge(data.user)');
      const nav = s.indexOf('navigate(path', arm);
      expect(resolve, `${f}: resolvePostLoginPath`).toBeGreaterThan(-1);
      expect(arm, `${f}: armHomepageNudge`).toBeGreaterThan(resolve);
      expect(nav, `${f}: navigate 는 예약 뒤`).toBeGreaterThan(arm);
    }
  });

  it('로그아웃하면 예약을 지우고, 팝업은 Layout 에 한 번 놓인다', () => {
    expect(src('stores/authStore.ts')).toMatch(/logout:[\s\S]{0,120}disarmHomepageNudge\(\)/);
    expect(src('components/layout/Layout.tsx').match(/<HomepageNudge \/>/g)).toHaveLength(1);
  });

  it('팝업은 체크리스트와 같은 판정(computeCompleteness)을 쓴다', () => {
    const s = src('components/shared/HomepageNudge.tsx');
    expect(s).toContain("from '@/lib/completeness'");
    expect(s).toContain('computeCompleteness(');
  });
});
