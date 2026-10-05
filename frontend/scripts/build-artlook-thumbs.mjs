#!/usr/bin/env node
/**
 * ArtLook 칩 그림 굽기 — 액자 칩(frames/chips/<id>.webp)과 배경 썸네일(walls/thumbs/<파일>.jpg) (2026-10-04)
 *
 *   node frontend/scripts/build-artlook-thumbs.mjs          # 없는 것만
 *   node frontend/scripts/build-artlook-thumbs.mjs --all    # 전부 다시
 *
 * 왜: 예전엔 칩을 화면에서 그렸다. 액자 칩은 **액자 사진 8장(5.5MB)이 다 와야** 제 모양이 됐고(한 장 올 때마다 칩을 다시 굽고
 * 미리보기를 다시 그렸다), 배경 칩은 **벽 사진 원본**(장당 1.4~2.8MB, 21장)을 46px 칸에 그대로 썼다. 그래서 탭을 열면 41.5MB 를
 * 받았다(실제 작가 30점 기준). 이제 칩은 이 스크립트가 **같은 엔진으로** 미리 구운 작은 파일이고, 큰 사진은 고를 때만 받는다.
 *
 * 하는 일: frontend/public 을 잠깐 띄우고(작은 정적 서버) ArtLook 을 `?preload=all` 로 연 뒤, 페이지 안의 엔진
 * (buildFramedCore · dummyArt)으로 칩을 그려 받아 적는다. 액자 칩은 예전 화면의 칩과 같은 설정(살 7.5% · 매트 6%, 캔버스 랩은 0)을
 * 2배 해상도로. 배경은 가운데 정사각형을 192px 로. 그리고 scenes.json 의 각 장면에 `thumb` 를 적는다(글자 위치만 끼워 넣어 형식은 그대로).
 *
 * ⚠️ 액자를 더하거나 장면을 더하면 이걸 돌릴 것 — `frontend/src/__tests__/artlookScreen.test.ts` 가 파일이 다 있는지 본다.
 * ⚠️ Playwright 는 e2e/node_modules 의 것을 쓴다(프론트에는 깔려 있지 않다).
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(HERE, '../public');
const ART = path.join(PUBLIC, 'artlook');
const ALL = process.argv.includes('--all');
const require = createRequire(import.meta.url);
const { chromium } = require(path.resolve(HERE, '../../e2e/node_modules/playwright'));

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const f = path.join(PUBLIC, p);
  if (!f.startsWith(PUBLIC) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`${BASE}/artlook/index.html?preload=all`, { waitUntil: 'load' });

// 자산이 다 올 때까지(못 받은 것도 끝난 것으로 친다)
await page.waitForFunction(() => {
  if (typeof PHOTO_META_READY === 'undefined' || !PHOTO_META_READY) return false;
  const photos = Object.keys(PHOTO_META || {}).every((k) => PHOTO_STATE[k] === 'ready' || PHOTO_STATE[k] === 'failed');
  const mats = Object.values(MATS).every((m) => !m.texture || m.ready);
  const scenes = SCENES.length > 0 && SCENES.every((s) => s.loaded || s.failed);
  const walls = WALLS.every((w) => w.loaded || w.failed);
  return photos && mats && scenes && walls;
}, null, { timeout: 120000, polling: 250 });

const result = await page.evaluate(() => {
  const frames = FRAMES.map((f) => {
    // 예전 화면의 칩과 같은 설정을 2배 해상도로(72×88 → 144×176). 칩은 '그 액자가 무엇인가'를 보여 주는 자리라
    // 지금 고른 매트를 따르지 않는다 — 따르면 21개가 같은 모양이 되어 고를 단서가 사라진다.
    // ⚠️ 칩 크기 그대로 그리지 말 것 — 매트 종이 결·나뭇결은 **실제 결과물 크기**(액자가 수백 px)에 맞춰 만든 것이라,
    //    칩 크기에서 그리면 결이 줄지 않고 반짝이 무늬가 된다(처음 구운 판이 그랬다). 결과물 크기로 그린 뒤 두 번에 나눠 줄인다.
    const framed = buildFramedCore(dummyArt(368, 464), f,
      { frame: 0.075, matWidth: f.kind === 'canvas' ? 0 : 0.06, frameColor: '#46362a', matteColor: '#f2eee4', glass: false });
    const half = document.createElement('canvas');
    half.width = Math.round(framed.width / 2); half.height = Math.round(framed.height / 2);
    const hx = half.getContext('2d'); hx.imageSmoothingQuality = 'high';
    hx.drawImage(framed, 0, 0, half.width, half.height);
    const cv = document.createElement('canvas'); cv.width = 144; cv.height = 176;
    const x = cv.getContext('2d');
    const s = Math.min(132 / half.width, 164 / half.height);
    x.imageSmoothingQuality = 'high';
    x.drawImage(half, (144 - half.width * s) / 2, (176 - half.height * s) / 2, half.width * s, half.height * s);
    return { id: f.id, data: cv.toDataURL('image/webp', 0.9) };
  });
  const seen = new Set();
  const backs = [];
  for (const it of [...SCENES.map((s) => ({ src: s.src, img: s.img })), ...WALLS.map((w) => ({ src: w.src, img: w.img }))]) {
    if (seen.has(it.src) || !it.img || !it.img.naturalWidth) continue;
    seen.add(it.src);
    const N = 192, im = it.img, side = Math.min(im.naturalWidth, im.naturalHeight);
    const cv = document.createElement('canvas'); cv.width = N; cv.height = N;
    const x = cv.getContext('2d');
    x.imageSmoothingQuality = 'high';
    x.drawImage(im, (im.naturalWidth - side) / 2, (im.naturalHeight - side) / 2, side, side, 0, 0, N, N);
    backs.push({ src: it.src, data: cv.toDataURL('image/jpeg', 0.84) });
  }
  return { frames, backs };
});

const write = (file, dataUrl) => {
  if (!ALL && fs.existsSync(file)) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
  return true;
};
let made = 0;
for (const f of result.frames) if (write(path.join(ART, 'frames/chips', `${f.id}.webp`), f.data)) made++;
const thumbOf = (src) => { const i = src.lastIndexOf('/'); return `${src.slice(0, i)}/thumbs/${src.slice(i + 1)}`; };
for (const b of result.backs) if (write(path.join(ART, thumbOf(b.src)), b.data)) made++;

// scenes.json 에 thumb 를 적는다 — JSON 을 다시 쓰지 않고 "src" 줄 뒤에 끼워 넣어 형식(들여쓰기·숫자 표기)을 그대로 둔다
const scenesFile = path.join(ART, 'scenes/scenes.json');
let txt = fs.readFileSync(scenesFile, 'utf8');
let added = 0;
txt = txt.replace(/( *)"src": "([^"]+)",\n(?! *"thumb":)/g, (m, ind, src) => { added++; return `${m}${ind}"thumb": "${thumbOf(src)}",\n`; });
if (added) fs.writeFileSync(scenesFile, txt);

await browser.close();
server.close();
const kb = (dir) => fs.existsSync(dir) ? Math.round(fs.readdirSync(dir).reduce((s, f) => s + fs.statSync(path.join(dir, f)).size, 0) / 1024) : 0;
console.log(`칩 ${result.frames.length}개 · 배경 썸네일 ${result.backs.length}개 — 새로 쓴 파일 ${made}개, scenes.json thumb ${added}개 추가`);
console.log(`frames/chips ${kb(path.join(ART, 'frames/chips'))}KB · walls/thumbs ${kb(path.join(ART, 'walls/thumbs'))}KB`);
if (errors.length) { console.error('페이지 오류:', errors.join(' | ')); process.exitCode = 1; }
