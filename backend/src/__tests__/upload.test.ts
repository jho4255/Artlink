import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { request, authToken, cleanDb, seedUsers } from './helpers';
import { deleteUploadedFile } from '../lib/storage';

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

/**
 * PNG → JPEG 변환이 **라우트에서** 실제로 일어나는지 (lib/imageNormalize.ts 단위 테스트와 별개).
 * 테스트 환경은 R2 키가 없어 디스크 모드다 — multer 가 `.png` 로 써 둔 파일을 라우트가 `.jpg` 로 갈아 쓰고 원본을 지우는지 본다.
 * R2 모드는 같은 normalizeUploadImage 를 타므로 여기서 본 확장자·MIME 규칙이 그대로 간다.
 */
describe('POST /api/upload/image — PNG 사진은 JPEG 로 저장', () => {
  const uploadsDir = path.join(__dirname, '../../uploads');
  const made: string[] = [];
  // authenticate 가 DB 의 사용자를 확인한다 — 앞 파일이 DB 를 비웠으면 401. 단독 실행에선 통과하고 전체 실행에서만 깨졌다(2026-09-22)
  beforeAll(async () => { await cleanDb(); await seedUsers(); });
  afterAll(async () => {
    // 테스트가 실제 uploads/ 에 파일을 남긴다 — 원본·썸네일까지 정리
    for (const name of made) await deleteUploadedFile(`/uploads/${name}`);
  });

  /** 사진 같은 그라디언트+노이즈(순수 노이즈는 JPEG 도 못 줄인다). alphaHole 이면 아래 절반이 투명 */
  async function photoPng(alphaHole = false): Promise<Buffer> {
    const w = 320, h = 240, ch = alphaHole ? 4 : 3;
    const raw = Buffer.alloc(w * h * ch);
    let seed = 11;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < ch; c++) {
      const i = (y * w + x) * ch + c;
      if (ch === 4 && c === 3) { raw[i] = y < h / 2 ? 255 : 0; continue; }
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const noise = (((seed >> 16) & 0xff) / 255 - 0.5) * 24;
      const base = c === 0 ? (x / w) * 255 : c === 1 ? (y / h) * 255 : ((x + y) / (w + h)) * 255;
      raw[i] = Math.max(0, Math.min(255, Math.round(base + noise)));
    }
    return sharp(raw, { raw: { width: w, height: h, channels: ch } }).png().toBuffer();
  }

  it('불투명 PNG → 응답 url 이 .jpg 이고 디스크에 JPEG 만 남는다 (.png 원본은 지워진다)', async () => {
    const r = await request.post('/api/upload/image')
      .set('Authorization', `Bearer ${authToken(1, 'ARTIST')}`)
      .attach('image', await photoPng(), { filename: 'work.png', contentType: 'image/png' });
    expect(r.status).toBe(200);
    const name = path.basename(r.body.url);
    made.push(name);                        // 단언보다 먼저 — 실패해도 파일은 지워져야 한다
    expect(r.body.url).toMatch(/^\/uploads\/[\d-]+\.jpg$/);
    const meta = await sharp(path.join(uploadsDir, name)).metadata();
    expect(meta.format).toBe('jpeg');
    expect(fs.existsSync(path.join(uploadsDir, name.replace(/\.jpg$/, '.png')))).toBe(false);
  });

  it('투명 픽셀이 있는 PNG 는 .png 그대로', async () => {
    const r = await request.post('/api/upload/image')
      .set('Authorization', `Bearer ${authToken(1, 'ARTIST')}`)
      .attach('image', await photoPng(true), { filename: 'logo.png', contentType: 'image/png' });
    expect(r.status).toBe(200);
    made.push(path.basename(r.body.url));
    expect(r.body.url).toMatch(/\.png$/);
  });

  it('다중 업로드(/images)도 같은 규칙', async () => {
    const r = await request.post('/api/upload/images')
      .set('Authorization', `Bearer ${authToken(1, 'ARTIST')}`)
      .attach('images', await photoPng(), { filename: 'a.png', contentType: 'image/png' })
      .attach('images', await photoPng(true), { filename: 'b.png', contentType: 'image/png' });
    expect(r.status).toBe(200);
    (r.body.urls ?? []).forEach((u: string) => made.push(path.basename(u)));
    expect(r.body.urls).toHaveLength(2);
    expect(r.body.urls[0]).toMatch(/\.jpg$/);
    expect(r.body.urls[1]).toMatch(/\.png$/);
  });
});
