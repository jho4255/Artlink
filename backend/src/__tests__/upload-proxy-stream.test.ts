/**
 * image-proxy 스트리밍 전환 회귀 테스트 (2026-08 성능 사고 대응)
 *
 * 예전엔 `arrayBuffer()`로 이미지 전체를 메모리에 담았다가 내보내서, 동시 요청이 몰리면
 * 인스턴스가 포화돼 10초 타임아웃 500이 다수 발생했다. 스트리밍으로 바꾸면서
 * **보안 검증(SSRF·리다이렉트·MIME)과 응답 헤더가 그대로인지** 확인한다.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { request } from './helpers';

const R2_BASE = 'https://pub-test-proxy.r2.dev';
const OK_URL = `${R2_BASE}/artlink/sample.jpg`;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

const realFetch = globalThis.fetch;

/** upstream 응답을 스트림 body로 흉내낸다(실제 R2 호출 없이 스트리밍 경로 검증) */
function streamResponse(body: Buffer, type: string, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': type, 'content-length': String(body.length) }),
    body: new ReadableStream({
      start(c) {
        c.enqueue(new Uint8Array(body.subarray(0, 4)));
        c.enqueue(new Uint8Array(body.subarray(4)));
        c.close();
      },
    }),
  } as unknown as Response;
}

beforeAll(() => {
  process.env.R2_PUBLIC_URL = R2_BASE;
});

afterAll(() => {
  globalThis.fetch = realFetch;
  delete process.env.R2_PUBLIC_URL;
});

describe('image-proxy 스트리밍', () => {
  it('업스트림 바이트를 그대로(무손실) 중계하고 보안 헤더를 유지한다', async () => {
    globalThis.fetch = vi.fn(async () => streamResponse(PNG, 'image/png')) as any;

    const r = await request.get('/api/upload/image-proxy').query({ url: OK_URL });
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('image/png');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['content-security-policy']).toContain("default-src 'none'");
    expect(r.headers['cache-control']).toBe('public, max-age=86400');
    expect(Buffer.from(r.body).equals(PNG), '바이트 무손실').toBe(true);
  });

  it('래스터 이미지가 아니면 차단한다 (svg 등 스크립트 실행 가능 타입)', async () => {
    globalThis.fetch = vi.fn(async () => streamResponse(Buffer.from('<svg/>'), 'image/svg+xml')) as any;
    const r = await request.get('/api/upload/image-proxy').query({ url: OK_URL });
    expect(r.status).toBe(400);
  });

  it('리다이렉트(3xx)는 내부주소 우회 위험이라 차단한다', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false, status: 302, headers: new Headers(), body: null,
    })) as any;
    const r = await request.get('/api/upload/image-proxy').query({ url: OK_URL });
    expect(r.status).toBe(400);
  });

  it('업스트림 실패는 502', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false, status: 404, headers: new Headers(), body: null,
    })) as any;
    const r = await request.get('/api/upload/image-proxy').query({ url: OK_URL });
    expect(r.status).toBe(502);
  });

  it('화이트리스트 밖 호스트는 여전히 400 (SSRF 방지 유지)', async () => {
    globalThis.fetch = vi.fn(async () => streamResponse(PNG, 'image/png')) as any;
    const r = await request.get('/api/upload/image-proxy').query({ url: 'https://evil.example.com/a.png' });
    expect(r.status).toBe(400);
  });
});

/**
 * 커스텀 도메인 전환(2026-08-04): DB의 기존 이미지 주소는 전부 옛 도메인이라
 * `R2_PUBLIC_URL`에 신·구를 함께 넣는다. 라우트에서도 둘 다 통과해야 폴백이 살아 있다.
 */
describe('image-proxy — 공개 주소가 여러 개일 때', () => {
  const NEW_BASE = 'https://img.test-artlink.cc';

  beforeAll(() => { process.env.R2_PUBLIC_URL = `${NEW_BASE},${R2_BASE}`; });
  afterAll(() => { process.env.R2_PUBLIC_URL = R2_BASE; }); // 위 afterAll이 최종 정리

  it('새 도메인 주소를 중계한다', async () => {
    globalThis.fetch = vi.fn(async () => streamResponse(PNG, 'image/png')) as any;
    const r = await request.get('/api/upload/image-proxy').query({ url: `${NEW_BASE}/artlink/new.png` });
    expect(r.status).toBe(200);
  });

  it('★ 옛 도메인 주소도 계속 중계한다 (기존 이미지가 죽지 않아야 한다)', async () => {
    globalThis.fetch = vi.fn(async () => streamResponse(PNG, 'image/png')) as any;
    const r = await request.get('/api/upload/image-proxy').query({ url: OK_URL });
    expect(r.status).toBe(200);
    expect(Buffer.from(r.body).equals(PNG)).toBe(true);
  });

  it('그래도 화이트리스트 밖은 400', async () => {
    globalThis.fetch = vi.fn(async () => streamResponse(PNG, 'image/png')) as any;
    const r = await request.get('/api/upload/image-proxy').query({ url: 'https://evil.example.com/a.png' });
    expect(r.status).toBe(400);
  });
});
