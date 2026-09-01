/**
 * 썸네일 키 규칙 — 프론트 thumbUrl 과 반드시 같아야 한다.
 * 어긋나면 업로드는 되는데 화면은 전부 404 → 원본 폴백으로 조용히 되돌아가 효과가 0이 된다.
 */
import { describe, it, expect } from 'vitest';
import { thumbKey, makeThumb, THUMB_SIZE, THUMB_LIST, THUMB_GRID, THUMB_SPECS } from '../lib/thumb';

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

/**
 * 작품 격자용 t800 (2026-08-27) — 240px 는 목록칸용이라 작품 격자(표시 377~754px)에 쓰면 뭉개진다.
 */
describe('썸네일 두 종 (t240 · t800)', () => {
  it('업로드 때 만들 크기가 두 개다', () => {
    expect(THUMB_SPECS).toHaveLength(2);
    expect(THUMB_SPECS.map(s => s.dir)).toEqual(['t240', 't800']);
  });

  it('폴더명이 서로 다르다 — 섞이면 화질/용량이 뒤엉킨다', () => {
    expect(THUMB_LIST.dir).not.toBe(THUMB_GRID.dir);
    expect(THUMB_GRID.size).toBeGreaterThan(THUMB_LIST.size);
  });

  it('thumbKey 는 폴더를 골라 끼울 수 있다', () => {
    expect(thumbKey('artlink/1786400000000-1.jpg', THUMB_GRID.dir)).toBe('artlink/t800/1786400000000-1.jpg');
    // 인자를 안 주면 예전 그대로 t240 (기존 호출부 호환)
    expect(thumbKey('artlink/1786400000000-1.jpg')).toBe('artlink/t240/1786400000000-1.jpg');
    expect(THUMB_SIZE).toBe(THUMB_LIST.size);
  });

  it('★ t800 은 800px 을 넘지 않고, 원본보다 크게 늘리지 않는다', async () => {
    const sharp = (await import('sharp')).default;
    const big = await sharp({ create: { width: 1600, height: 1200, channels: 3, background: '#345' } }).jpeg().toBuffer();
    const out = await makeThumb(big, THUMB_GRID);
    const m = await sharp(out!).metadata();
    expect(Math.max(m.width!, m.height!)).toBe(THUMB_GRID.size);

    // 이미 작은 그림을 800으로 늘리면 뭉개지기만 하고 용량만 는다
    const small = await sharp({ create: { width: 300, height: 200, channels: 3, background: '#345' } }).jpeg().toBuffer();
    const out2 = await sharp((await makeThumb(small, THUMB_GRID))!).metadata();
    expect(Math.max(out2.width!, out2.height!)).toBe(300);
  });

  it('★ t800 이 t240 보다 크고, 원본보다는 작다 (백필의 근거)', async () => {
    const sharp = (await import('sharp')).default;
    // 실사에 가깝게 — 단색은 압축이 너무 잘 돼 크기 비교가 의미 없다
    const noise = await sharp({ create: { width: 1800, height: 1400, channels: 3, background: '#000', noise: { type: 'gaussian', mean: 128, sigma: 40 } } }).jpeg({ quality: 92 }).toBuffer();
    const t240 = (await makeThumb(noise, THUMB_LIST))!;
    const t800 = (await makeThumb(noise, THUMB_GRID))!;
    expect(t240.length).toBeLessThan(t800.length);
    expect(t800.length).toBeLessThan(noise.length);
  });

  it('망가진 파일은 두 크기 모두 null (업로드는 계속 성공해야 한다)', async () => {
    for (const spec of THUMB_SPECS) {
      expect(await makeThumb(Buffer.from('not an image'), spec)).toBeNull();
    }
  });
});
