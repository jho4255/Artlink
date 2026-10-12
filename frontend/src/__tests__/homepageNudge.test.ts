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
  armHomepageNudge, armedHomepageNudgeUserId, disarmHomepageNudge, isHomepageNudgeSeenToday, isHomepageNudgeSnoozed, kstDay,
  markHomepageNudgeSeen, nudgePlace, snoozeHomepageNudge, subscribeHomepageNudge, NUDGE_SNOOZE_DAYS,
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

  it('닫기만 하고 그날 기록을 안 남겼으면(다른 탭 등) 다시 예약된다', () => {
    const s = new MemoryStorage(), l = new MemoryStorage();
    armHomepageNudge({ id: 7, role: 'ARTIST' }, NOW, s, l);
    disarmHomepageNudge(s);
    expect(armedHomepageNudgeUserId(s)).toBeNull();
    armHomepageNudge({ id: 7, role: 'ARTIST' }, NOW + 60_000, s, l);
    expect(armedHomepageNudgeUserId(s)).toBe(7);
  });

  it('★ 하루 첫 방문에 한 번 — 보여 준 날엔 로그인해도·앱을 다시 열어도 예약되지 않고, 다음 날(KST) 다시 된다', () => {
    const s = new MemoryStorage(), l = new MemoryStorage();
    armHomepageNudge({ id: 7, role: 'ARTIST' }, NOW, s, l);
    markHomepageNudgeSeen(7, NOW, l);
    disarmHomepageNudge(s);
    for (const later of [60_000, 5 * 60 * 60 * 1000]) {
      armHomepageNudge({ id: 7, role: 'ARTIST' }, NOW + later, s, l);
      expect(armedHomepageNudgeUserId(s)).toBeNull();
    }
    expect(isHomepageNudgeSeenToday(7, NOW + 60_000, l)).toBe(true);
    armHomepageNudge({ id: 7, role: 'ARTIST' }, NOW + DAY, s, l);
    expect(armedHomepageNudgeUserId(s)).toBe(7);
  });

  it('★ 이 탭에서 띄우고 답하지 않은 채 새로고침되면 — \'봤다\'가 적혀 있어도 다시 뜬다(옛 판이 뜨는 순간 적어 둔 경우)', () => {
    // 2026-10-12 이전 판: 뜨는 순간 '봤다'를 적고, 예약은 답할 때만 지웠다. 그 판이 먼저 뜨고 새 판으로 바뀌는 새로고침을 재현한다
    const s = new MemoryStorage(), l = new MemoryStorage();
    armHomepageNudge({ id: 7, role: 'ARTIST' }, NOW, s, l);   // 옛 판이 예약
    markHomepageNudgeSeen(7, NOW, l);                          // 옛 판이 뜨는 순간 '봤다'
    armHomepageNudge({ id: 7, role: 'ARTIST' }, NOW + 20_000, s, l);   // 새 판이 다시 열림
    expect(armedHomepageNudgeUserId(s)).toBe(7);
    // 옛 판에서 이미 답했다(예약을 지웠다) → 새 판은 다시 띄우지 않는다(두 번 뜨지 않는다)
    disarmHomepageNudge(s);
    armHomepageNudge({ id: 7, role: 'ARTIST' }, NOW + 40_000, s, l);
    expect(armedHomepageNudgeUserId(s)).toBeNull();
    // 7일 보지 않기는 예약이 남아 있어도 이긴다
    armHomepageNudge({ id: 8, role: 'ARTIST' }, NOW, s, l);
    snoozeHomepageNudge(8, NOW, s, l);
    s.setItem('artlink-homepage-nudge', '8');
    armHomepageNudge({ id: 8, role: 'ARTIST' }, NOW + 1000, s, l);
    expect(armedHomepageNudgeUserId(s)).toBeNull();
  });

  it('날짜는 KST 로 가른다 — UTC 15시(=KST 자정)가 경계, 기기 시간대와 무관', () => {
    expect(kstDay(Date.UTC(2026, 9, 10, 14, 59))).toBe('2026-10-10');
    expect(kstDay(Date.UTC(2026, 9, 10, 15, 0))).toBe('2026-10-11');
    const l = new MemoryStorage();
    markHomepageNudgeSeen(7, Date.UTC(2026, 9, 10, 14, 0), l);   // KST 23시에 봤다
    expect(isHomepageNudgeSeenToday(7, Date.UTC(2026, 9, 10, 14, 50), l)).toBe(true);
    expect(isHomepageNudgeSeenToday(7, Date.UTC(2026, 9, 10, 15, 10), l)).toBe(false);   // KST 자정이 지났다
  });

  it('본 날짜는 계정별이고, 지난 날짜는 버린다', () => {
    const s = new MemoryStorage(), l = new MemoryStorage();
    markHomepageNudgeSeen(7, NOW, l);
    armHomepageNudge({ id: 8, role: 'ARTIST' }, NOW, s, l);
    expect(armedHomepageNudgeUserId(s)).toBe(8);
    markHomepageNudgeSeen(8, NOW + DAY, l);
    expect(JSON.parse(l.getItem('artlink-homepage-nudge-seen')!)).toEqual({ 8: kstDay(NOW + DAY) });
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

  it('★ 하루 첫 방문 — 앱을 열 때(마운트 한 번)와 숨겼던 탭으로 돌아올 때 예약하고, 보여 주면 그날을 적는다', () => {
    const s = src('components/shared/HomepageNudge.tsx');
    // 마운트 한 번(의존성 없음) — 로그인된 사용자가 바뀔 때마다 걸면 LoginPage 가 잠깐 보내는 /mypage 에서 번쩍인다
    expect(s).toMatch(/armHomepageNudge\(useAuthStore\.getState\(\)\.user\)[\s\S]{0,400}addEventListener\('visibilitychange', onVisible\)[\s\S]{0,200}\}, \[\]\);/);
    // ⚠️⚠️ '오늘 봤다'는 사람이 답했을 때만 — 뜨는 순간 적으면 배포 뒤 새로고침이 팝업을 0.5초 만에 지워도 그날은 끝났다(2026-10-12 실서버 '초원')
    expect(s).not.toMatch(/if \(open && user\) markHomepageNudgeSeen/);
    expect(s).toMatch(/const dismiss = \(\) => \{\s*if \(user\) markHomepageNudgeSeen\(user\.id\);\s*disarmHomepageNudge\(\);/);
    expect(s).toMatch(/const go = \(href: string\) => \{ dismiss\(\); navigate\(href\); \}/);
    expect(s).toMatch(/if \(e\.key === 'Escape'\) dismiss\(\)/);
    // 다른 탭에서 답하면 이 탭의 팝업도 닫는다(탭 둘에 떠 있던 팝업이 한쪽에 남지 않게)
    expect(s).toMatch(/addEventListener\('storage', onStorage\)/);
    expect(s).toMatch(/isHomepageNudgeSeenToday\(u\.id\) \|\| isHomepageNudgeSnoozed\(u\.id\)\)\) disarmHomepageNudge\(\)/);
    // 닫는 길에서 기록 없이 예약만 지우는 곳이 남아 있지 않다(배경·[나중에]도 dismiss)
    expect(s).not.toMatch(/onClick=\{\(\) => disarmHomepageNudge\(\)\}/);
    // 편집 화면에 와 있거나 다 채웠으면 그날은 본 것으로 친다
    expect(s).toMatch(/if \(user\) markHomepageNudgeSeen\(user\.id\);\s*disarmHomepageNudge\(\);/);
  });

  it('★ 서비스워커는 고정 주소(/sw.js)로 등록한다 — 빌드마다 다른 주소면 배포 뒤 새로고침이 두 번 일어나 팝업을 지웠다', () => {
    const m = src('main.tsx');
    expect(m).toMatch(/navigator\.serviceWorker\.register\('\/sw\.js', \{ scope: '\/', updateViaCache: 'none' \}\)/);
    expect(m).not.toMatch(/register\(`\/sw\.js\?v=/);   // (주석은 옛 주소를 설명하느라 그 글자를 담고 있다)
    expect(m).not.toMatch(/\?v=\$\{__BUILD_ID__\}/);
    // 고정 주소가 안전한 건 서버가 sw.js 를 저장해 두지 말라고 보내기 때문이다(2026-07 Cloudflare 사고) — 그 규칙이 살아 있는지
    expect(readFileSync(join(__dirname, '..', '..', '..', 'backend', 'src', 'lib', 'staticCache.ts'), 'utf-8')).toMatch(/sw\.js/);
  });

  it('팝업은 체크리스트와 같은 판정(computeCompleteness)을 쓴다', () => {
    const s = src('components/shared/HomepageNudge.tsx');
    expect(s).toContain("from '@/lib/completeness'");
    expect(s).toContain('computeCompleteness(');
  });
});
