import { describe, it, expect } from 'vitest';
import { request } from './helpers';

// ArtLook 캔버스 PNG 저장용 동일출처 이미지 프록시 — SSRF 방지(화이트리스트) 검증
describe('Image proxy (/api/upload/image-proxy)', () => {
  it('url 파라미터 없으면 400', async () => {
    const r = await request.get('/api/upload/image-proxy');
    expect(r.status).toBe(400);
  });

  it('R2_PUBLIC_URL 접두사 밖의 URL은 차단 → 400 (SSRF 방지)', async () => {
    const r = await request.get('/api/upload/image-proxy').query({ url: 'http://example.com/evil.png' });
    expect(r.status).toBe(400);
  });

  it('내부 주소도 화이트리스트 밖이면 차단 → 400', async () => {
    const r = await request.get('/api/upload/image-proxy').query({ url: 'http://localhost:4000/api/health' });
    expect(r.status).toBe(400);
  });
});
