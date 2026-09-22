/**
 * 업로드 이미지 정규화 — PNG 사진은 JPEG q90 으로, 투명·애니메이션·다른 포맷은 그대로 (lib/imageNormalize.ts).
 * 실제 픽셀을 sharp 로 만들어 돌린다(jsdom 아님 — 백엔드 node 환경).
 */
import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { normalizeUploadImage, JPEG_QUALITY } from '../lib/imageNormalize';

/**
 * 사진처럼 **그라디언트 + 약한 노이즈**가 섞인 이미지. 순수 랜덤 노이즈는 JPEG 도 못 줄여서(원본보다 커진다) 사진을
 * 대신하지 못하고, 단색은 PNG 가 더 작아 변환이 안 일어난다. 실측: 320×240 PNG 216KB → JPEG q90 30KB.
 * alpha=true 면 알파 채널을 붙이되 전부 불투명(캡처 도구가 흔히 그렇게 저장한다).
 */
async function photoLikePng(w = 320, h = 240, alpha = false): Promise<Buffer> {
  const ch = alpha ? 4 : 3;
  const raw = Buffer.alloc(w * h * ch);
  let seed = 7;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < ch; c++) {
    const i = (y * w + x) * ch + c;
    if (ch === 4 && c === 3) { raw[i] = 255; continue; }
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const noise = (((seed >> 16) & 0xff) / 255 - 0.5) * 24;
    const base = c === 0 ? (x / w) * 255 : c === 1 ? (y / h) * 255 : ((x + y) / (w + h)) * 255;
    raw[i] = Math.max(0, Math.min(255, Math.round(base + noise)));
  }
  return sharp(raw, { raw: { width: w, height: h, channels: ch } }).png().toBuffer();
}

describe('normalizeUploadImage', () => {
  it('불투명 PNG 사진은 JPEG 로 바뀌고 확장자·MIME 도 함께 바뀐다', async () => {
    const png = await photoLikePng();
    const out = await normalizeUploadImage(png, '.png', 'image/png');
    expect(out.converted).toBe(true);
    expect(out.ext).toBe('.jpg');
    expect(out.mime).toBe('image/jpeg');
    expect(out.buf.length).toBeLessThan(png.length);
    const meta = await sharp(out.buf).metadata();
    expect(meta.format).toBe('jpeg');
    // 픽셀 크기는 그대로 — 배치 비율(imageDims)에 영향이 없어야 한다
    expect([meta.width, meta.height]).toEqual([320, 240]);
  });

  it('알파 채널이 있어도 전부 불투명이면 변환한다 (캡처 도구가 붙인 헛 알파)', async () => {
    const png = await photoLikePng(320, 240, true);
    expect((await sharp(png).metadata()).hasAlpha).toBe(true);
    const out = await normalizeUploadImage(png, '.png', 'image/png');
    expect(out.converted).toBe(true);
    expect(out.ext).toBe('.jpg');
  });

  it('실제 투명 픽셀이 있는 PNG 는 그대로 둔다 (JPEG 에 투명이 없다)', async () => {
    // 사진 같은 그림의 아래 절반을 투명하게 뚫는다 — 용량으로는 변환 대상인데 투명 때문에 남아야 한다
    const opaque = await photoLikePng(320, 240, true);
    const { data, info } = await sharp(opaque).raw().toBuffer({ resolveWithObject: true });
    for (let i = (info.width * info.height * 4) / 2 + 3; i < data.length; i += 4) data[i] = 0;
    const png = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
    const out = await normalizeUploadImage(png, '.png', 'image/png');
    expect(out.converted).toBe(false);
    expect(out.ext).toBe('.png');
    expect(out.buf).toBe(png);
  });

  it('JPEG · WebP · GIF 는 손대지 않는다 (다시 구우면 화질만 깎이고 GIF 는 애니메이션이 깨진다)', async () => {
    const jpg = await sharp(await photoLikePng()).jpeg().toBuffer();
    const webp = await sharp(await photoLikePng()).webp().toBuffer();
    const gif = await sharp(await photoLikePng()).gif().toBuffer();
    for (const [buf, ext, mime] of [[jpg, '.jpg', 'image/jpeg'], [webp, '.webp', 'image/webp'], [gif, '.gif', 'image/gif']] as const) {
      const out = await normalizeUploadImage(buf, ext, mime);
      expect(out.converted).toBe(false);
      expect(out.buf).toBe(buf);
      expect(out.ext).toBe(ext);
    }
  });

  it('JPEG 가 더 커지는 그림(작은 단색 — PNG 107B vs JPEG 322B)은 PNG 를 유지한다', async () => {
    const flat = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#ffffff' } }).png().toBuffer();
    const out = await normalizeUploadImage(flat, '.png', 'image/png');
    expect(out.converted).toBe(false);
    expect(out.ext).toBe('.png');
  });

  it('이미지가 아닌 바이트가 PNG 라고 들어와도 던지지 않고 원본을 돌려준다 (업로드는 막지 않는다)', async () => {
    const junk = Buffer.from('not an image at all');
    const out = await normalizeUploadImage(junk, '.png', 'image/png');
    expect(out.converted).toBe(false);
    expect(out.buf).toBe(junk);
  });

  it('품질은 90 — 눈으로 구분되지 않는 선 (실측 PSNR 36~43dB)', () => {
    expect(JPEG_QUALITY).toBe(90);
  });
});
