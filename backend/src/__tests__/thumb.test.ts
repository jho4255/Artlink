/**
 * 썸네일 키 규칙 — 프론트 thumbUrl 과 반드시 같아야 한다.
 * 어긋나면 업로드는 되는데 화면은 전부 404 → 원본 폴백으로 조용히 되돌아가 효과가 0이 된다.
 */
import { describe, it, expect } from 'vitest';
import { thumbKey, makeThumb, THUMB_SIZE } from '../lib/thumb';

describe('thumbKey', () => {
  it('파일명 앞에 t240/ 을 끼운다', () => {
    expect(thumbKey('artlink/1786400000000-1.jpg')).toBe('artlink/t240/1786400000000-1.jpg');
    expect(thumbKey('deep/path/a.png')).toBe('deep/path/t240/a.png');
  });

  it('디렉터리가 없어도 동작한다', () => {
    expect(thumbKey('a.jpg')).toBe('t240/a.jpg');
  });
});

describe('makeThumb', () => {
  it('가로·세로 모두 240 이하로 줄이고 비율을 지킨다', async () => {
    const sharp = (await import('sharp')).default;
    const src = await sharp({ create: { width: 2000, height: 1000, channels: 3, background: '#888' } })
      .jpeg().toBuffer();
    const out = await makeThumb(src);
    expect(out).not.toBeNull();
    const m = await sharp(out!).metadata();
    expect(Math.max(m.width!, m.height!)).toBeLessThanOrEqual(THUMB_SIZE);
    expect(m.width! / m.height!).toBeCloseTo(2, 1);   // 비율 보존
    expect(out!.length).toBeLessThan(src.length);     // 작아졌다
  });

  it('작은 이미지는 키우지 않는다', async () => {
    const sharp = (await import('sharp')).default;
    const src = await sharp({ create: { width: 100, height: 80, channels: 3, background: '#333' } }).jpeg().toBuffer();
    const m = await sharp((await makeThumb(src))!).metadata();
    expect(m.width).toBe(100);
    expect(m.height).toBe(80);
  });

  it('이미지가 아니면 null — 업로드를 막지 않는다', async () => {
    expect(await makeThumb(Buffer.from('not an image'))).toBeNull();
  });
});
