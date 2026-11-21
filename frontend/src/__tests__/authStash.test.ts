/**
 * 로그인이 풀려도 쓰던 입력을 남긴다 (2026-11-21, 공모 흐름 신뢰성 점검 O6 — lib/authStash).
 * 예전엔 로그인(7일)이 끝나 아무 요청이나 401 을 받으면 곧바로 로그아웃되고, 다시 로그인해 같은 화면으로 돌아와도
 * 쓰던 정산 금액·출품 자료·지원서가 사라져 있었다.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AUTH_STASH_TTL_MS, authStashKeys, clearAuthStashes, dropAuthStash, hasAuthStash, peekAuthStash,
  registerAuthStash, stashBeforeAuthLoss, stashKeys, takeAuthStash,
} from '@/lib/authStash';
import { useAuthStore } from '@/stores/authStore';

const SRC = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf-8');

beforeEach(() => { localStorage.clear(); vi.useRealTimers(); });

describe('남기고 꺼내기', () => {
  it('★ 로그아웃 직전에 등록된 화면의 저장 안 된 입력만 적는다 · 계정마다 따로 · 한 번 꺼내면 지운다', () => {
    const offA = registerAuthStash('settlement:7', () => ({ feeRate: '2.2' }));
    const offB = registerAuthStash('apply:9', () => null);   // 저장 안 된 게 없다
    stashBeforeAuthLoss(5);
    expect(hasAuthStash(5, 'settlement:7')).toBe(true);
    expect(hasAuthStash(5, 'apply:9')).toBe(false);
    expect(hasAuthStash(6, 'settlement:7')).toBe(false);   // 다른 계정에는 안 꺼내진다
    expect(peekAuthStash(5, 'settlement:7')).toEqual({ feeRate: '2.2' });
    expect(takeAuthStash(5, 'settlement:7')).toEqual({ feeRate: '2.2' });
    expect(takeAuthStash(5, 'settlement:7')).toBeNull();
    offA(); offB();
    stashBeforeAuthLoss(5);
    expect(localStorage.length).toBe(0);   // 떼어 낸 화면은 적지 않는다
  });

  it('계정을 모르면 적지 않는다 · 화면 하나가 던져도 다른 화면 것은 적는다', () => {
    const off1 = registerAuthStash('a', () => { throw new Error('x'); });
    const off2 = registerAuthStash('b', () => ({ v: 1 }));
    stashBeforeAuthLoss(null);
    expect(localStorage.length).toBe(0);
    expect(() => stashBeforeAuthLoss(3)).not.toThrow();
    expect(peekAuthStash(3, 'b')).toEqual({ v: 1 });
    off1(); off2();
  });

  it('3일 지나면 버린다 · 망가진 값은 지운다', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-21T00:00:00Z'));
    const off = registerAuthStash('k', () => ({ v: 1 }));
    stashBeforeAuthLoss(1);
    off();
    vi.setSystemTime(Date.now() + AUTH_STASH_TTL_MS + 1);
    expect(peekAuthStash(1, 'k')).toBeNull();
    expect(localStorage.length).toBe(0);
    localStorage.setItem('artlink-auth-stash:1:z', '{망가짐');
    expect(peekAuthStash(1, 'z')).toBeNull();
    expect(localStorage.getItem('artlink-auth-stash:1:z')).toBeNull();
  });

  it('갤러리 대신 입력 — 이 공모의 어느 작가 것이 남았는지 찾는다', () => {
    const offs = [
      registerAuthStash(stashKeys.submission(7, 11), () => ({ x: 1 })),
      registerAuthStash(stashKeys.submission(70, 12), () => ({ x: 1 })),   // 다른 공모(7 로 시작해도 아니다)
      registerAuthStash(stashKeys.settlement(7), () => ({ x: 1 })),
    ];
    stashBeforeAuthLoss(3);
    offs.forEach((f) => f());
    expect(authStashKeys(3, stashKeys.submissionPrefix(7))).toEqual(['submission:7:11']);
    dropAuthStash(3, 'submission:7:11');
    expect(authStashKeys(3, stashKeys.submissionPrefix(7))).toEqual([]);
  });

  it('★ 사람이 [로그아웃]을 누르면 전부 지우고, 로그인이 풀려 내보낼 때(expired)는 남긴다', () => {
    const off = registerAuthStash('k', () => ({ v: 1 }));
    useAuthStore.setState({ token: 't', user: { id: 4, role: 'GALLERY', name: 'g' } as never, isAuthenticated: true });
    stashBeforeAuthLoss(4);
    useAuthStore.getState().logout({ expired: true });
    expect(peekAuthStash(4, 'k')).toEqual({ v: 1 });
    useAuthStore.getState().logout();
    expect(peekAuthStash(4, 'k')).toBeNull();
    off();
    clearAuthStashes();
  });
});

describe('붙이는 곳 — 소스 가드', () => {
  it('★ 401 이면 로그아웃하기 전에 남긴다(인터셉터) · 다시 들어가는 길은 expired', () => {
    const ax = read('lib/axios.ts');
    const i = ax.indexOf('stashBeforeAuthLoss(');
    const j = ax.indexOf('logout({ expired: true })');
    expect(i).toBeGreaterThan(0);
    expect(j).toBeGreaterThan(i);
    expect(read('components/post-editor/PostEditor.tsx')).toContain('logout({ expired: true })');
    expect(read('stores/authStore.ts')).toMatch(/if \(opts\?\.expired !== true\) clearAuthStashes\(\)/);
  });

  it('★ 정산 · 출품 자료(작가 · 대신 입력) · 지원서가 남기고 되살린다', () => {
    const ctl = read('components/operation/settlementController.tsx');
    expect(ctl).toContain('useStashOnAuthLoss(enabled && !locked ? stashKeys.settlement(exhibitionId)');
    expect(ctl).toContain('takeAuthStash<SettlementStash>(userId, stashKeys.settlement(exhibitionId))');
    const op = read('pages/OperationPage.tsx');
    expect(op).toContain('stashKeys.submission(exhibitionId, targetUserId)');
    expect(op).toContain('useStashOnAuthLoss(confirmed ? null : stashKey');
    expect(op).toContain('takeAuthStash<SubmissionStash>(myUserId, stashKey)');
    expect(op).toContain('authStashKeys(myUserId, prefix)');   // 대신 입력하던 작가를 펼친 채로
    const ap = read('pages/ApplyPage.tsx');
    expect(ap).toContain('useStashOnAuthLoss(id ? stashKeys.apply(id)');
    expect(ap).toContain('peekAuthStash<ApplyStash>(user?.id, stashKeys.apply(id))');
    // 되살린 화면이 그 탭부터 열린다
    expect(read('components/workspace/ExhibitionWorkspace.tsx')).toContain('setView(stashView() ?? defaultView)');
    expect(read('components/workspace/ArtistExhibitionWorkspace.tsx')).toContain('hasAuthStash(user?.id, stashKeys.submission(id');
  });
});
