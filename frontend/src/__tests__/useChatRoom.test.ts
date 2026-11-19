/**
 * 대화방 상태 훅(`hooks/useChatRoom.ts`, 2026-11-19) — 폴링 커서·보내기 줄·실패 처리.
 *
 * ★ 커서(마지막으로 받은 id)는 **폴링만** 올린다. 처음 구현은 내가 보낸 말의 id 로 커서를 올려서,
 *   그 사이 상대가 보낸 말(id 가 더 작다)을 다음 `?after=` 가 건너뛰었다 — 둘이 동시에 말하면 상대 말이 영영 안 보인다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement, act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const get = vi.fn();
const post = vi.fn();
vi.mock('@/lib/axios', () => ({ default: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a) } }));

import { useChatRoom, CHAT_POLL_MS } from '@/hooks/useChatRoom';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ME = 7;
const OTHER = 8;
const msg = (id: number, senderId: number, content = `말 ${id}`) => ({
  id, chatId: 1, senderId, content, createdAt: new Date(2026, 10, 19, 12, 0, id).toISOString(),
  sender: { id: senderId, name: senderId === ME ? '나' : '상대', nickname: null, role: 'ARTIST' },
  attachmentUrl: null, attachmentType: null, attachmentName: null, attachmentSize: null, ref: null, read: null, unreadBy: null,
});
const detail = (messages: ReturnType<typeof msg>[], extra: Record<string, unknown> = {}) => ({
  id: 1, kind: 'DIRECT', title: null, exhibition: null, participants: [], muted: false, hidden: false,
  hasMore: false, readers: [], messages, ...extra,
});

type Room = ReturnType<typeof useChatRoom>;
let latest: Room;
function Probe() {
  const room = useChatRoom(1, ME);
  useEffect(() => { latest = room; });   // 그린 뒤에 꺼내 둔다(렌더 중에 바깥 변수를 쓰지 않는다)
  return null;
}

let root: Root;
let host: HTMLDivElement;
async function mount() {
  host = document.createElement('div');
  document.body.appendChild(host);
  const qc = new QueryClient();
  await act(async () => {
    root = createRoot(host);
    root.render(createElement(QueryClientProvider, { client: qc }, createElement(Probe)));
  });
}
const flush = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

beforeEach(() => {
  vi.useFakeTimers();
  get.mockReset(); post.mockReset();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe('useChatRoom — 폴링 커서', () => {
  it('★ 내가 보낸 뒤에도 커서를 내 말 id 로 건너뛰지 않는다 — 그 사이 상대가 보낸 말을 받는다', async () => {
    get.mockResolvedValueOnce({ data: detail([msg(1, OTHER), msg(2, OTHER)]) });       // 방 열기
    await mount();
    await flush();
    expect(get.mock.calls[0][1]).toEqual({ params: { limit: 150 } });
    expect(latest.messages.map((m) => m.id)).toEqual([1, 2]);

    // 내가 보낸다 — 서버는 5번을 준다(그 사이 상대의 4번이 먼저 들어가 있었다)
    post.mockResolvedValueOnce({ data: msg(5, ME, '안녕하세요') });
    act(() => latest.sendText('안녕하세요'));
    await flush();
    expect(latest.messages.map((m) => m.id)).toEqual([1, 2, 5]);
    expect(latest.pending).toEqual([]);

    // 다음 폴링 — after=2 여야 4번이 온다(5 로 건너뛰면 4번을 영영 못 받는다)
    get.mockResolvedValueOnce({ data: detail([msg(4, OTHER, '먼저 보낸 상대 말'), msg(5, ME, '안녕하세요')]) });
    await flush(CHAT_POLL_MS);
    expect(get.mock.calls[1][1]).toEqual({ params: { after: 2 } });
    expect(latest.messages.map((m) => m.id)).toEqual([1, 2, 4, 5]);

    // 그 다음 폴링은 받은 것 중 가장 큰 id 부터
    get.mockResolvedValueOnce({ data: detail([]) });
    await flush(CHAT_POLL_MS);
    expect(get.mock.calls[2][1]).toEqual({ params: { after: 5 } });
  });

  it('빈 응답은 커서를 0 으로 만들지 않는다(빈 방도 첫 말부터 이어 받는다)', async () => {
    get.mockResolvedValueOnce({ data: detail([]) });
    await mount();
    await flush();
    get.mockResolvedValueOnce({ data: detail([]) });
    await flush(CHAT_POLL_MS);
    // 첫 적재가 비었으면 커서는 0 — 다음 폴링은 after=0(전부)이고, 받은 뒤엔 그 id 부터
    expect(get.mock.calls[1][1]).toEqual({ params: { after: 0 } });
    get.mockResolvedValueOnce({ data: detail([msg(3, OTHER)]) });
    await flush(CHAT_POLL_MS);
    get.mockResolvedValueOnce({ data: detail([]) });
    await flush(CHAT_POLL_MS);
    expect(get.mock.calls[3][1]).toEqual({ params: { after: 3 } });
    expect(latest.messages.map((m) => m.id)).toEqual([3]);
  });
});

describe('useChatRoom — 보내기 줄', () => {
  it('실패하면 글이 남고 [다시 보내기]로 한 번만 간다', async () => {
    get.mockResolvedValueOnce({ data: detail([msg(1, OTHER)]) });
    await mount();
    await flush();
    post.mockRejectedValueOnce({ response: { status: 500, data: { error: '잠시 후 다시' } } });
    act(() => latest.sendText('끊겼을 때 쓴 말'));
    await flush();
    expect(latest.pending).toHaveLength(1);
    expect(latest.pending[0]).toMatchObject({ status: 'failed', content: '끊겼을 때 쓴 말', error: '잠시 후 다시' });

    post.mockResolvedValueOnce({ data: msg(2, ME, '끊겼을 때 쓴 말') });
    act(() => latest.retry(latest.pending[0].tempId));
    await flush();
    expect(post).toHaveBeenCalledTimes(2);
    expect(latest.pending).toEqual([]);
    expect(latest.messages.map((m) => m.content)).toEqual(['말 1', '끊겼을 때 쓴 말']);
  });

  it('여러 개를 연달아 보내도 순서대로 하나씩(겹쳐 보내지 않는다)', async () => {
    get.mockResolvedValueOnce({ data: detail([]) });
    await mount();
    await flush();
    let resolveFirst: (v: unknown) => void = () => {};
    post.mockImplementationOnce(() => new Promise((r) => { resolveFirst = r; }));
    post.mockResolvedValueOnce({ data: msg(11, ME, '둘째') });
    act(() => { latest.sendText('첫째'); latest.sendText('둘째'); });
    await flush();
    expect(post).toHaveBeenCalledTimes(1);                 // 첫째가 끝나기 전엔 둘째를 보내지 않는다
    await act(async () => { resolveFirst({ data: msg(10, ME, '첫째') }); });
    await flush();
    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls.map((c) => (c[1] as { content: string }).content)).toEqual(['첫째', '둘째']);
    expect(latest.messages.map((m) => m.id)).toEqual([10, 11]);
  });

  it('403(차단)이면 이 방은 보낼 수 없는 방이 된다 — 입력 줄 대신 이유 한 줄', async () => {
    get.mockResolvedValueOnce({ data: detail([msg(1, OTHER)], { canSend: true, blockReason: null }) });
    await mount();
    await flush();
    post.mockRejectedValueOnce({ response: { status: 403, data: { error: '메시지를 보낼 수 없는 상대예요.' } } });
    act(() => latest.sendText('막힌 뒤에 쓴 말'));
    await flush();
    expect(latest.meta).toMatchObject({ canSend: false, blockReason: 'unavailable' });
  });
});
