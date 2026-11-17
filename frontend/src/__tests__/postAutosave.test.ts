/**
 * 커뮤니티 글 자동 저장 상태 기계(2026-11-13) — 가짜 시계로 '언제 보내고, 겹치지 않고, 실패하면 다시 보내는가'를 본다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AutosaveController, type SaveOutcome } from '@/lib/postAutosave';

type Call = { payload: string; sig: string };

function setup(outcomes: (SaveOutcome | 'hang' | 'throw')[] = []) {
  const calls: Call[] = [];
  const resolvers: ((o: SaveOutcome) => void)[] = [];
  const states: string[] = [];
  const save = vi.fn((payload: string, sig: string): Promise<SaveOutcome> => {
    calls.push({ payload, sig });
    const o = outcomes.shift() ?? { ok: true };
    if (o === 'throw') return Promise.reject(new Error('net'));
    if (o === 'hang') return new Promise((r) => resolvers.push(r));
    return Promise.resolve(o);
  });
  const c = new AutosaveController<string>({ save, onChange: (s) => states.push(s.status), idleMs: 2000, maxWaitMs: 10_000, backoffMs: [5000, 10_000] }, 'v0');
  return { c, save, calls, resolvers, states };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('언제 보내나', () => {
  it('손을 멈춘 지 2초 뒤에 한 번', async () => {
    const { c, calls } = setup();
    c.changed('v1', () => 'p1');
    c.changed('v2', () => 'p2');
    await vi.advanceTimersByTimeAsync(1999);
    expect(calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toEqual([{ payload: 'p2', sig: 'v2' }]);
    expect(c.state.status).toBe('saved');
  });

  it('계속 치고 있어도 10초마다는 보낸다', async () => {
    const { c, calls } = setup();
    for (let i = 1; i <= 12; i++) { c.changed(`v${i}`, () => `p${i}`); await vi.advanceTimersByTimeAsync(1000); }
    expect(calls.length).toBeGreaterThanOrEqual(1);
    expect(calls[0]!.sig).toBe('v10');
  });

  it('서버에 있는 것과 같아지면(되돌리기) 보내지 않는다', async () => {
    const { c, calls } = setup();
    c.changed('v1', () => 'p1');
    c.changed('v0', () => 'p0');
    await vi.advanceTimersByTimeAsync(12_000);
    expect(calls).toHaveLength(0);
    expect(c.dirty).toBe(false);
  });
});

describe('겹치지 않게', () => {
  it('★ 보내는 사이에 또 고치면 끝난 뒤 최신 것 하나만 이어 보낸다', async () => {
    const { c, calls, resolvers } = setup(['hang', { ok: true }]);
    c.changed('v1', () => 'p1');
    await vi.advanceTimersByTimeAsync(2000);
    expect(calls).toHaveLength(1);
    c.changed('v2', () => 'p2');
    c.changed('v3', () => 'p3');
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls).toHaveLength(1);   // 아직 첫 요청이 안 끝났다
    resolvers[0]!({ ok: true });
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls.map((x) => x.sig)).toEqual(['v1', 'v3']);
    expect(c.dirty).toBe(false);
  });
});

describe('실패·충돌·로그인', () => {
  it('★ 실패하면 5초·10초 뒤 다시 — 성공하면 실패 횟수가 비워진다', async () => {
    const { c, calls } = setup(['throw', { ok: false, kind: 'retry' }, { ok: true }]);
    c.changed('v1', () => 'p1');
    await vi.advanceTimersByTimeAsync(2000);
    expect(c.state).toMatchObject({ status: 'retrying', failures: 1 });
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls).toHaveLength(2);
    expect(c.state.failures).toBe(2);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls).toHaveLength(3);
    expect(c.state).toMatchObject({ status: 'saved', failures: 0 });
  });

  it('★ 충돌(409)이면 멈춘다 — 사람이 고르기 전에는 더 보내지 않는다', async () => {
    const { c, calls } = setup([{ ok: false, kind: 'conflict' }, { ok: true }]);
    c.changed('v1', () => 'p1');
    await vi.advanceTimersByTimeAsync(2000);
    expect(c.state.status).toBe('conflict');
    c.changed('v2', () => 'p2');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toHaveLength(1);
    c.resume();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls.map((x) => x.sig)).toEqual(['v1', 'v2']);
  });

  it('로그인이 풀리면(401) 멈추고 기다린다', async () => {
    const { c, calls } = setup([{ ok: false, kind: 'auth' }]);
    c.changed('v1', () => 'p1');
    await vi.advanceTimersByTimeAsync(2000);
    expect(c.state.status).toBe('auth');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toHaveLength(1);
  });
});

describe('지금 저장(flush)·멈춤', () => {
  it('flush 는 기다리지 않고 바로 보내고 결과를 알려 준다', async () => {
    const { c, calls } = setup();
    c.changed('v1', () => 'p1');
    const ok = c.flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(await ok).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it('flush 가 실패하면 false — 화면이 기기 보관을 남긴다', async () => {
    const { c } = setup(['throw']);
    c.changed('v1', () => 'p1');
    const ok = c.flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(await ok).toBe(false);
  });

  it('pause 뒤에는 보내지 않는다(등록 중 — 지운 작업본을 되살리지 않게)', async () => {
    const { c, calls } = setup();
    c.pause();
    c.changed('v1', () => 'p1');
    await vi.advanceTimersByTimeAsync(20_000);
    expect(calls).toHaveLength(0);
  });

  it('dispose 뒤에는 늦게 온 응답도 상태를 바꾸지 않는다', async () => {
    const { c, resolvers, states } = setup(['hang']);
    c.changed('v1', () => 'p1');
    await vi.advanceTimersByTimeAsync(2000);
    c.dispose();
    const before = states.length;
    resolvers[0]!({ ok: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(states.length).toBe(before);
  });
});
