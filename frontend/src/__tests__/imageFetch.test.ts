/**
 * 이미지 획득 모듈 테스트 (운영페이지 ZIP/PDF 성능 사고 대응)
 *
 *  - 병렬 동시성 제한 / 순서 보존 / 진행률
 *  - R2 직접 → 프록시 폴백 → 1회 재시도
 *  - URL 캐시 공유(같은 이미지를 두 번 받지 않음)
 *  - 확장자 판정(원본 바이트를 그대로 ZIP에 넣기 위함)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

/** vi.stubGlobal('fetch', ...) 에 넘길 때 쓰는 최소 타입 (any 사용 회피) */
type FetchStub = (input: string) => Promise<Response>;
import { mapLimit, extOf, proxyUrl, fetchImage, prefetchImages, recoverFailed, releaseImageCache } from '@/lib/imageFetch';

const R2 = 'https://pub-abc.r2.dev/artlink/art1.jpg';

function imageResponse(type = 'image/jpeg', size = 10) {
  return {
    ok: true,
    headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? type : null) },
    blob: async () => new Blob([new Uint8Array(size)], { type }),
  } as unknown as Response;
}

describe('mapLimit — 동시성 제한 병렬', () => {
  it('동시 실행 수가 limit을 넘지 않는다', async () => {
    let running = 0;
    let peak = 0;
    await mapLimit(Array.from({ length: 20 }, (_, i) => i), 5, async (n) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise(r => setTimeout(r, 5));
      running -= 1;
      return n;
    });
    expect(peak).toBeLessThanOrEqual(5);
    expect(peak).toBeGreaterThan(1); // 실제로 병렬로 돌았는지
  });

  it('결과는 입력 순서를 유지한다 (완료 순서가 뒤섞여도)', async () => {
    const out = await mapLimit([30, 5, 20, 1], 4, async (ms) => {
      await new Promise(r => setTimeout(r, ms));
      return ms;
    });
    expect(out).toEqual([30, 5, 20, 1]);
  });

  it('진행률 콜백이 1..total 로 보고된다', async () => {
    const seen: number[] = [];
    await mapLimit([1, 2, 3, 4, 5], 2, async (n) => n, (done, total) => {
      expect(total).toBe(5);
      seen.push(done);
    });
    expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });

  it('빈 배열도 안전하다', async () => {
    expect(await mapLimit([], 5, async () => 1)).toEqual([]);
  });
});

describe('extOf — 원본 확장자 판정', () => {
  it('content-type 우선', () => {
    expect(extOf('image/png', 'https://x/a.jpg')).toBe('png');
    expect(extOf('image/jpeg; charset=binary', 'https://x/a')).toBe('jpg');
    expect(extOf('image/webp', 'https://x/a')).toBe('webp');
  });
  it('타입이 없으면 URL 꼬리', () => {
    expect(extOf('', 'https://x/a.PNG')).toBe('png');
    expect(extOf('', 'https://x/a.jpeg')).toBe('jpg');
  });
  it('둘 다 모르면 jpg', () => {
    expect(extOf('', 'https://x/a')).toBe('jpg');
    expect(extOf('application/octet-stream', 'https://x/a')).toBe('jpg');
  });
});

describe('proxyUrl', () => {
  it('원격 주소만 프록시로, 상대경로는 그대로', () => {
    expect(proxyUrl(R2)).toBe(`/api/upload/image-proxy?url=${encodeURIComponent(R2)}`);
    expect(proxyUrl('/uploads/a.png')).toBe('/uploads/a.png');
  });
});

describe('fetchImage — 직접 → 프록시 폴백 → 재시도 → 캐시', () => {
  beforeEach(() => {
    releaseImageCache();
    vi.restoreAllMocks();
  });

  it('R2 직접 성공 시 프록시를 쓰지 않는다', async () => {
    // 인자 타입을 명시해야 spy.mock.calls[0][0] 인덱싱이 타입체크를 통과한다(빌드는 tsc -b로 테스트도 검사)
    const spy = vi.fn(async (url: string) => imageResponse(url.endsWith('.png') ? 'image/png' : 'image/jpeg'));
    vi.stubGlobal('fetch', spy);
    const img = await fetchImage(R2);
    expect(img?.ext).toBe('jpg');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0][0])).toBe(R2);
  });

  it('직접 실패(CORS/네트워크) → 프록시로 폴백', async () => {
    const spy = vi.fn(async (u: string) => {
      if (u === R2) throw new TypeError('Failed to fetch');
      return imageResponse();
    });
    vi.stubGlobal('fetch', spy as unknown as FetchStub);
    const img = await fetchImage(R2);
    expect(img).toBeTruthy();
    expect(spy).toHaveBeenCalledTimes(2);
    expect(String(spy.mock.calls[1][0])).toContain('/api/upload/image-proxy');
  });

  it('프록시가 500이면 1회 더 재시도한다 (retryable)', async () => {
    let n = 0;
    const spy = vi.fn(async (u: string) => {
      n += 1;
      if (u === R2) throw new TypeError('cors');
      if (n === 2) return { ok: false, status: 500 } as Response; // 첫 프록시 실패
      return imageResponse();                                     // 재시도 성공
    });
    vi.stubGlobal('fetch', spy as unknown as FetchStub);
    const img = await fetchImage(R2);
    expect(img).toBeTruthy();
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('★ 404는 재시도하지 않는다 (다시 해도 같은 결과 — 시간만 낭비)', async () => {
    const spy = vi.fn(async () => ({ ok: false, status: 404 }) as Response);
    vi.stubGlobal('fetch', spy as unknown as FetchStub);
    expect(await fetchImage(R2)).toBeNull();
    // 직접 1회 + 프록시 1회 = 2회. 재시도 없음
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('★ 무응답으로 끊긴 경우는 재시도하지 않는다 — 같은 회선이라 결과가 같다', async () => {
    vi.useFakeTimers();
    try {
      // 응답이 영영 오지 않는 서버. abort 될 때만 reject 된다.
      const spy = vi.fn((_u: string, init?: { signal?: AbortSignal }) => new Promise<Response>((_res, rej) => {
        init?.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')), { once: true });
      }));
      vi.stubGlobal('fetch', spy as unknown as FetchStub);

      const p = fetchImage(R2);
      await vi.advanceTimersByTimeAsync(10_000); // 직접 시도 → 연결 타임아웃
      await vi.advanceTimersByTimeAsync(10_000); // 프록시 시도 → 연결 타임아웃
      expect(await p).toBeNull();
      // 직접 1 + 프록시 1 = 2회. 여기서 3회가 되면 '느림'에도 재시도한 것
      expect(spy).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('★ 느리지만 데이터가 흐르면 끝까지 받는다 (총 시간으로 자르지 않음)', async () => {
    // 청크를 250ms 간격으로 6번(=1.5초) 흘려보낸다. 총 시간 기준이면 짧은 타임아웃에 잘렸을 상황.
    const body = {
      getReader: () => {
        let i = 0;
        return {
          read: async () => {
            if (i >= 6) return { done: true, value: undefined };
            i += 1;
            await new Promise(r => setTimeout(r, 250));
            return { done: false, value: new Uint8Array(1000) };
          },
        };
      },
    };
    const spy = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? 'image/jpeg' : null) },
      body,
    }) as unknown as Response);
    vi.stubGlobal('fetch', spy as unknown as FetchStub);
    const img = await fetchImage(R2);
    expect(img, '느려도 데이터가 흐르면 성공해야 한다').toBeTruthy();
    expect(img!.blob.size).toBe(6000);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('모두 실패하면 예외 대신 null (호출부가 실패 목록으로 처리)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down'); }) as unknown as FetchStub);
    expect(await fetchImage(R2)).toBeNull();
  });

  it('★ 같은 URL을 여러 번 요청해도 네트워크는 1회 (ZIP/PDF 캐시 공유)', async () => {
    const spy = vi.fn(async (url: string) => imageResponse(url.endsWith('.png') ? 'image/png' : 'image/jpeg'));
    vi.stubGlobal('fetch', spy);
    const [a, b, c] = await Promise.all([fetchImage(R2), fetchImage(R2), fetchImage(R2)]);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('이미지가 아닌 응답은 거부한다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      headers: { get: () => 'text/html' },
      blob: async () => new Blob(['<html>'], { type: 'text/html' }),
    })) as unknown as FetchStub);
    expect(await fetchImage(R2)).toBeNull();
  });
});

describe('prefetchImages — 실패 URL 반환 (PDF 누락 안내용)', () => {
  beforeEach(() => { releaseImageCache(); vi.restoreAllMocks(); });

  it('받지 못한 URL만 돌려준다', async () => {
    const OK = 'https://pub-abc.r2.dev/artlink/ok.jpg';
    const BAD = 'https://pub-abc.r2.dev/artlink/bad.jpg';
    vi.stubGlobal('fetch', vi.fn(async (u: string) => {
      if (u.includes('bad')) return { ok: false, status: 404 } as Response;
      return imageResponse();
    }) as unknown as FetchStub);
    const failed = await prefetchImages([OK, BAD, OK]);
    expect(failed).toEqual([BAD]);
  });

  it('전부 성공하면 빈 배열', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => imageResponse()) as unknown as FetchStub);
    expect(await prefetchImages(['https://pub-abc.r2.dev/artlink/a.jpg'])).toEqual([]);
  });
});

/**
 * "하나 빠지면 어떡해" — 실패를 그냥 버리지 않고 되찾는 장치.
 * 핵심 전제: **실패는 캐시에 남기지 않는다.** 남기면 다시 받기를 눌러도 캐시가 즉시 null을
 * 돌려주며 네트워크를 아예 타지 않아, 재시도 기능 자체가 무력화된다.
 */
describe('실패 캐시 무효화 — 다시 받기가 진짜 다시 받게', () => {
  beforeEach(() => { releaseImageCache(); vi.restoreAllMocks(); });

  it('★ 한 번 실패한 URL도 다음 호출에서 다시 네트워크를 탄다', async () => {
    let calls = 0;
    const spy = vi.fn(async () => {
      calls += 1;
      if (calls <= 2) return { ok: false, status: 404 } as Response; // 1회차: 직접+프록시 모두 실패
      return imageResponse();                                        // 2회차: 성공
    });
    vi.stubGlobal('fetch', spy as unknown as FetchStub);

    expect(await fetchImage(R2), '1회차는 실패').toBeNull();
    expect(await fetchImage(R2), '2회차는 성공해야 한다 — 실패가 캐시되면 여기서 null이 나온다').toBeTruthy();
  });

  it('성공은 계속 캐시된다 (재시도가 성공분까지 다시 받지 않게)', async () => {
    const spy = vi.fn(async () => imageResponse());
    vi.stubGlobal('fetch', spy as unknown as FetchStub);
    await fetchImage(R2);
    await fetchImage(R2);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('recoverFailed — 배치 종료 후 자동 회수', () => {
  beforeEach(() => { releaseImageCache(); vi.restoreAllMocks(); });

  const A = 'https://pub-abc.r2.dev/artlink/recover-a.jpg';
  const B = 'https://pub-abc.r2.dev/artlink/recover-b.jpg';

  it('★ 배치 때 실패했던 이미지를 되찾는다', async () => {
    let phase = 'batch';
    vi.stubGlobal('fetch', vi.fn(async () => (
      phase === 'batch' ? ({ ok: false, status: 500 } as Response) : imageResponse()
    )) as unknown as FetchStub);

    const failed = await prefetchImages([A, B]);
    expect(failed).toEqual([A, B]);

    phase = 'recover'; // 배치가 끝나 동시성 경쟁이 사라진 상황
    const left = await recoverFailed(failed, undefined, { rounds: 1, backoffMs: [0] });
    expect(left, '회수 후에는 남는 게 없어야 한다').toEqual([]);
  });

  it('끝까지 안 되면 남은 목록을 돌려준다 (무한 재시도 금지)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 }) as Response) as unknown as FetchStub);
    const left = await recoverFailed([A, B], undefined, { rounds: 2, backoffMs: [0, 0] });
    expect(left.sort()).toEqual([A, B].sort());
  });

  it('★ 시간 예산을 넘기면 즉시 멈춘다 (무작정 기다리지 않게)', async () => {
    const spy = vi.fn(async () => ({ ok: false, status: 500 }) as Response);
    vi.stubGlobal('fetch', spy as unknown as FetchStub);
    const left = await recoverFailed([A], undefined, { rounds: 5, budgetMs: 0, backoffMs: [0] });
    expect(left).toEqual([A]);
    expect(spy, '예산이 0이면 한 번도 시도하지 않는다').not.toHaveBeenCalled();
  });

  it('라운드마다 진행률을 보고한다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 }) as Response) as unknown as FetchStub);
    const rounds: number[] = [];
    await recoverFailed([A, B], (_d, _t, round) => rounds.push(round), { rounds: 2, backoffMs: [0, 0] });
    expect(new Set(rounds)).toEqual(new Set([1, 2]));
  });

  it('빈 목록이면 아무것도 하지 않는다', async () => {
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy as unknown as FetchStub);
    expect(await recoverFailed([])).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });
});
