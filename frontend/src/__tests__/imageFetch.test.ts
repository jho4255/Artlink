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
import { mapLimit, extOf, proxyUrl, fetchImage, releaseImageCache } from '@/lib/imageFetch';

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

  it('프록시가 500이면 1회 더 재시도한다', async () => {
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
