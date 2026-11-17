/**
 * 커뮤니티 글 **자동 저장** 상태 기계 (2026-11-13) — React 와 무관한 순수 로직(가짜 시계로 테스트한다, __tests__/postAutosave.test.ts).
 *
 * 규칙
 * - 고치면 `idleMs`(2초) 동안 손을 멈췄을 때 저장한다. 계속 치고 있어도 `maxWaitMs`(10초)마다는 저장한다.
 * - **한 번에 하나만** 보낸다. 보내는 사이에 또 고치면 끝난 뒤 최신 것 하나를 이어 보낸다(늦게 온 옛 응답이 새 내용을 덮지 않게).
 * - 실패(인터넷·서버 오류·요청 한도)는 5·10·30·60초 간격으로 계속 다시 시도한다 — 그동안 화면은 이 기기에 보관한다.
 * - 다른 곳에서 고쳤으면(409) **멈추고** 묻는다. 로그인이 풀렸으면(401) 멈추고 로그인을 청한다. 사람이 고른 뒤 `resume`.
 * - `flush()` — 지금 바로 저장하고 결과를 기다린다(등록 직전·나가기·Ctrl+S·화면이 가려질 때).
 */

export type AutosaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'retrying' | 'conflict' | 'auth';

export type SaveOutcome =
  | { ok: true }
  | { ok: false; kind: 'conflict' | 'auth' | 'retry' };

export interface AutosaveState {
  status: AutosaveStatus;
  /** 서버가 받았다고 답한 마지막 시각 */
  savedAt: number | null;
  /** 다시 시도하는 횟수(연속 실패) */
  failures: number;
}

export interface AutosaveOptions<P> {
  /** 서버에 보낸다 — 결과만 돌려준다(던지지 말 것, 던지면 retry 로 본다) */
  save: (payload: P, sig: string) => Promise<SaveOutcome>;
  onChange?: (s: AutosaveState) => void;
  idleMs?: number;
  maxWaitMs?: number;
  backoffMs?: number[];
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
}

export class AutosaveController<P> {
  private latestSig = '';
  private latestPayload: (() => P) | null = null;
  private savedSig: string;
  private inFlight: Promise<void> | null = null;
  private idleTimer: unknown = null;
  private maxTimer: unknown = null;
  private retryTimer: unknown = null;
  private paused = false;
  private disposed = false;
  state: AutosaveState = { status: 'idle', savedAt: null, failures: 0 };
  private readonly o: Required<Omit<AutosaveOptions<P>, 'onChange'>> & Pick<AutosaveOptions<P>, 'onChange'>;

  /** `initialSig` — 지금 서버에 있는 내용의 서명(열었을 때). 같으면 저장할 게 없다 */
  constructor(opts: AutosaveOptions<P>, initialSig = '') {
    this.o = {
      idleMs: 2000, maxWaitMs: 10_000, backoffMs: [5000, 10_000, 30_000, 60_000],
      now: () => Date.now(),
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      ...opts,
    };
    this.savedSig = initialSig;
    this.latestSig = initialSig;
  }

  private set(patch: Partial<AutosaveState>) {
    this.state = { ...this.state, ...patch };
    this.o.onChange?.(this.state);
  }

  /** 서버가 이미 가진 서명 — 불러오기·충돌 해결 뒤 */
  markSaved(sig: string, savedAt: number | null = this.o.now()): void {
    this.savedSig = sig;
    if (this.latestSig === sig || !this.latestPayload) {
      this.latestSig = sig;
      this.clearTimers();
      this.set({ status: 'saved', savedAt, failures: 0 });
    }
  }

  /** 서버에 있는 내용과 다른가 */
  get dirty(): boolean {
    return this.latestSig !== this.savedSig;
  }

  /** 고칠 때마다 — 서명이 서버 것과 같으면 아무것도 안 한다 */
  changed(sig: string, payload: () => P): void {
    if (this.disposed) return;
    this.latestSig = sig;
    this.latestPayload = payload;
    if (sig === this.savedSig) {
      this.clearTimer('idle'); this.clearTimer('max');
      if (!this.inFlight && this.state.status !== 'conflict' && this.state.status !== 'auth') this.set({ status: 'saved' });
      return;
    }
    if (this.paused) return;
    if (this.state.status !== 'saving' && this.state.status !== 'retrying') this.set({ status: 'dirty' });
    this.clearTimer('idle');
    this.idleTimer = this.o.setTimer(() => { this.idleTimer = null; void this.run(); }, this.o.idleMs);
    if (!this.maxTimer) this.maxTimer = this.o.setTimer(() => { this.maxTimer = null; void this.run(); }, this.o.maxWaitMs);
  }

  private clearTimer(which: 'idle' | 'max' | 'retry') {
    const key = `${which}Timer` as 'idleTimer' | 'maxTimer' | 'retryTimer';
    if (this[key]) { this.o.clearTimer(this[key]); this[key] = null; }
  }
  private clearTimers() { this.clearTimer('idle'); this.clearTimer('max'); this.clearTimer('retry'); }

  private async run(): Promise<void> {
    if (this.disposed || this.paused) return;
    if (this.inFlight) return;   // 끝나면 최신 것을 이어 보낸다(아래 finally)
    if (!this.dirty || !this.latestPayload) return;
    this.clearTimers();
    const sig = this.latestSig;
    const payload = this.latestPayload();
    this.set({ status: 'saving' });
    this.inFlight = (async () => {
      let outcome: SaveOutcome;
      try { outcome = await this.o.save(payload, sig); } catch { outcome = { ok: false, kind: 'retry' }; }
      if (this.disposed) return;
      if (outcome.ok) {
        this.savedSig = sig;
        this.set({ status: this.latestSig === sig ? 'saved' : 'dirty', savedAt: this.o.now(), failures: 0 });
      } else if (outcome.kind === 'conflict' || outcome.kind === 'auth') {
        this.paused = true;
        this.set({ status: outcome.kind });
      } else {
        const failures = this.state.failures + 1;
        const wait = this.o.backoffMs[Math.min(failures - 1, this.o.backoffMs.length - 1)]!;
        this.set({ status: 'retrying', failures });
        this.retryTimer = this.o.setTimer(() => { this.retryTimer = null; void this.run(); }, wait);
      }
    })();
    try { await this.inFlight; } finally {
      this.inFlight = null;
      // 보내는 사이에 또 고쳤으면 이어서(실패해 다시 시도 대기 중이면 그 타이머가 맡는다)
      if (!this.disposed && !this.paused && this.dirty && !this.retryTimer && this.state.status === 'dirty') {
        this.idleTimer = this.o.setTimer(() => { this.idleTimer = null; void this.run(); }, Math.min(this.o.idleMs, 800));
      }
    }
  }

  /** 지금 저장하고 기다린다 — 서버가 최신 내용을 가졌으면 true */
  async flush(): Promise<boolean> {
    if (this.disposed) return !this.dirty;
    if (this.inFlight) await this.inFlight.catch(() => undefined);
    if (this.paused) return !this.dirty;
    if (this.dirty) {
      this.clearTimers();
      this.set({ failures: this.state.failures });
      await this.run();
      if (this.inFlight) await this.inFlight.catch(() => undefined);
    }
    return !this.dirty;
  }

  /** 충돌·로그인 문제를 사람이 정리한 뒤 다시 저장을 켠다 */
  resume(): void {
    this.paused = false;
    this.set({ status: this.dirty ? 'dirty' : 'saved', failures: 0 });
    if (this.dirty) void this.run();
  }

  /** 저장을 멈춘다(등록 중 — 등록이 작업본을 지우므로 그 뒤 저장이 되살리지 않게) */
  pause(): void {
    this.paused = true;
    this.clearTimers();
  }

  dispose(): void {
    this.disposed = true;
    this.clearTimers();
  }
}
