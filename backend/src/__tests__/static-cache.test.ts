/**
 * 프론트 dist 정적 파일 캐시 규칙 (`lib/staticCache.ts`) — 2026-10-04
 *
 * 예전엔 assets 가 아닌 고정 이름 파일까지 1년 immutable 이라, ArtLook 의 scene.js 가 Cloudflare 에 9/4 판으로
 * 30일째 굳어 있었다(원본은 9/16 판). 이름이 같은 파일은 고쳐 배포해도 사용자에게 가지 않는다.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { staticCacheControl, CACHE_IMMUTABLE, CACHE_NO_STORE, CACHE_REVALIDATE } from '../lib/staticCache';

describe('staticCacheControl — 경로별 Cache-Control', () => {
  it('해시 번들(assets/)만 1년 immutable', () => {
    expect(staticCacheControl('assets/index-Cgkk68Vl.js')).toBe(CACHE_IMMUTABLE);
    expect(staticCacheControl('assets/MyPage-BaKKBtN1.css')).toBe(CACHE_IMMUTABLE);
  });

  it('앱 셸은 어디에 있든 no-store — 하위 폴더의 index.html(ArtLook 화면)도', () => {
    for (const p of ['index.html', 'sw.js', 'registerSW.js', 'manifest.webmanifest', 'artlook/index.html']) {
      expect(staticCacheControl(p), p).toBe(CACHE_NO_STORE);
    }
  });

  it('그 밖의 고정 이름 파일은 no-cache — ArtLook 코드·목록·사진, 회사 정보, 아이콘', () => {
    for (const p of [
      'artlook/scene.js', 'artlook/ui.js', 'artlook/scenes/scenes.json', 'artlook/frames/photo/frames.json',
      'artlook/walls/wall03.jpg', 'artlook/frames/chips/oak.webp', 'terms/company-info.txt', 'icons/icon-192x192.png',
      'demo-art/dawn-window.jpg',
    ]) {
      expect(staticCacheControl(p), p).toBe(CACHE_REVALIDATE);
    }
  });

  it('assets 라는 이름만 같은 하위 폴더는 해시 번들이 아니다', () => {
    expect(staticCacheControl('artlook/assets/x.js')).toBe(CACHE_REVALIDATE);
  });

  it('윈도 경로·앞의 ./ 도 같은 답', () => {
    expect(staticCacheControl('.\\assets\\index-a.js'.replace(/\\/g, path.sep))).toBe(CACHE_IMMUTABLE);
    expect(staticCacheControl('./artlook/scene.js')).toBe(CACHE_REVALIDATE);
  });
});

describe('express.static 에 붙였을 때 — serve-static 이 먼저 적는 1년 헤더가 남지 않는다', () => {
  let dir: string;
  let app: express.Express;
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'static-cache-'));
    for (const [rel, body] of [['assets/index-abc.js', 'a'], ['artlook/scene.js', 'b'], ['artlook/index.html', '<p>c</p>'], ['index.html', '<p>d</p>']]) {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), body);
    }
    // index.ts 와 같은 설정
    app = express();
    app.use(express.static(dir, {
      index: false,
      cacheControl: false,
      setHeaders: (res, filePath) => { res.setHeader('Cache-Control', staticCacheControl(path.relative(dir, filePath))); },
    }));
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('경로마다 한 가지 헤더만', async () => {
    const r1 = await supertest(app).get('/assets/index-abc.js');
    expect(r1.headers['cache-control']).toBe(CACHE_IMMUTABLE);
    const r2 = await supertest(app).get('/artlook/scene.js?v=lx2abc');
    expect(r2.headers['cache-control']).toBe(CACHE_REVALIDATE);
    const r3 = await supertest(app).get('/artlook/index.html?embed=1');
    expect(r3.headers['cache-control']).toBe(CACHE_NO_STORE);
  });

  it('no-cache 파일은 ETag 로 304 를 준다 — 다시 받지 않고 확인만 한다', async () => {
    const first = await supertest(app).get('/artlook/scene.js');
    expect(first.headers.etag).toBeTruthy();
    const again = await supertest(app).get('/artlook/scene.js').set('If-None-Match', first.headers.etag);
    expect(again.status).toBe(304);
  });

  it('index.ts 가 이 함수와 cacheControl:false 를 쓴다(maxAge·immutable 을 되살리지 않는다)', () => {
    const src = fs.readFileSync(path.join(__dirname, '../index.ts'), 'utf8');
    const block = src.slice(src.indexOf('app.use(express.static(distPath'), src.indexOf('app.use(express.static(distPath') + 600);
    expect(block).toContain('cacheControl: false');
    expect(block).toContain('staticCacheControl(');
    expect(block).not.toMatch(/maxAge:\s*'1y'/);
    expect(block).not.toMatch(/immutable:\s*true/);
  });
});
