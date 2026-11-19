#!/usr/bin/env node
/**
 * ArtLook 칩 그림 굽기 — 액자 모서리 칩(frames/corners/<id>.webp) · 추천 조합 칩(presets/<id>.webp) · 배경 썸네일(walls/thumbs/<파일>.jpg)
 * (2026-10-04, 2026-11-17 PLAN WP5·WP6 — 액자 칩을 '액자 전체'에서 '왼쪽 위 모서리 확대'로 바꿨다)
 *
 *   node frontend/scripts/build-artlook-thumbs.mjs          # 없는 것만
 *   node frontend/scripts/build-artlook-thumbs.mjs --all    # 전부 다시
 *
 * 왜: 예전엔 칩을 화면에서 그렸다. 액자 칩은 **액자 사진 8장(5.5MB)이 다 와야** 제 모양이 됐고(한 장 올 때마다 칩을 다시 굽고
 * 미리보기를 다시 그렸다), 배경 칩은 **벽 사진 원본**(장당 1.4~2.8MB, 21장)을 46px 칸에 그대로 썼다. 그래서 탭을 열면 41.5MB 를
 * 받았다(실제 작가 30점 기준). 이제 칩은 이 스크립트가 **같은 엔진으로** 미리 구운 작은 파일이고, 큰 사진은 고를 때만 받는다.
 *
 * 하는 일: frontend/public 을 잠깐 띄우고(작은 정적 서버) ArtLook 을 `?preload=all` 로 연 뒤, 페이지 안의 엔진(compose)으로 칩을 그려 받아 적는다.
 *  · 액자 모서리 칩: 흰 플라스터 벽 · 데모 그림 dawn-window · 매트 5%(캔버스 랩 0)로 걸어 조각 왼쪽 위 모서리 190px(1568 출력 기준)을 96px 로.
 *    재질 칩과 모양 칩(대표 액자의 것)이 같이 쓴다. 숨긴 액자(hidden)는 굽지 않는다.
 *  · 추천 조합 칩: ui.js 의 PRESETS(window.__artlookPresets)를 그대로 그려 1:1 결과물 전체를 224px 로.
 *  · 배경 썸네일: 가운데 정사각형을 192px 로. 그리고 scenes.json 의 각 장면에 `thumb` 를 적는다(글자 위치만 끼워 넣어 형식은 그대로).
 *
 * ⚠️ 액자·장면·추천 조합을 더하거나 그림자 같은 엔진 모양을 바꾸면 이걸 `--all` 로 돌릴 것 — `frontend/src/__tests__/artlookScreen.test.ts` 가 파일이 다 있는지 본다.
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

const result = await page.evaluate(async () => {
  // 큰 그림을 반씩 줄여 N 폭으로 — 한 번에 줄이면 매트 결·나뭇결이 반짝이 무늬가 된다(아래 frames 주석과 같은 이유)
  const shrink = (src, sx, sy, sw, sh, N) => {
    let c = document.createElement('canvas'); c.width = sw; c.height = sh;
    c.getContext('2d').drawImage(src, sx, sy, sw, sh, 0, 0, sw, sh);
    while (c.width / 2 >= N) {
      const d = document.createElement('canvas'); d.width = Math.round(c.width / 2); d.height = Math.round(c.height / 2);
      const x = d.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(c, 0, 0, d.width, d.height); c = d;
    }
    const o = document.createElement('canvas'); o.width = N; o.height = Math.round(N * sh / sw);
    const ox = o.getContext('2d'); ox.imageSmoothingQuality = 'high'; ox.drawImage(c, 0, 0, o.width, o.height);
    return o;
  };
  const art = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(capToCanvas(im)); im.onerror = rej; im.src = '/demo-art/dawn-window.jpg'; });
  /** 장면 합성 한 장 — 화면이 고르는 것과 같은 상태로(비율 1:1 · 조명 · 캡션 없음 · 자리 처음) */
  const shot = (frameId, sceneId, mat, matColor, light) => {
    state.img = art; selectedWork = null; state.mode = 'scene';
    state.frameIdx = FRAMES.findIndex((f) => f.id === frameId);
    state.sceneIdx = SCENES.findIndex((s) => s.id === sceneId);
    state.matWidth = mat; state.matteColor = matColor || '#f5f2ea'; state.matTexture = 'paper';
    state.light = light || 0; state.ratio = '1:1'; state.caption = false; state.group = null; state.circle = null; state.draft = false;
    SCENES[state.sceneIdx].adj = { dx: 0, dy: 0, s: 1 };
    const out = compose();
    return { out, piece: window.__artlook && window.__artlook.piece };
  };
  // ── 액자 모서리 칩(재질 칩 · 모양 칩) — 흰 플라스터 벽에 걸어 **왼쪽 위 모서리를 크게**. 살 폭·깊이·결이 한눈에 갈린다.
  //    조각 왼쪽 위에서 (−34, −34) · 190px 정사각(1568px 출력 기준, 다르면 비례)을 96px 로. 원형은 원의 왼쪽 위(225°) 둘레.
  //    숨긴 액자(hidden)는 화면에 없으므로 굽지 않는다.
  const corners = [];
  for (const f of FRAMES.filter((x) => !x.hidden)) {
    const { out, piece } = shot(f.id, 'white-plaster', f.kind === 'canvas' ? 0 : 0.05);
    if (!piece) continue;
    const k = out.width / 1568, S = Math.round(190 * k);
    let x0 = piece.x - 34 * k, y0 = piece.y - 34 * k;
    if (f.kind === 'round') {
      const r = piece.w / 2, cx = piece.x + r, cy = piece.y + piece.h / 2;
      x0 = cx - r * 0.7071 - 70 * k; y0 = cy - r * 0.7071 - 70 * k;
    }
    x0 = Math.max(0, Math.min(out.width - S, Math.round(x0))); y0 = Math.max(0, Math.min(out.height - S, Math.round(y0)));
    corners.push({ id: f.id, data: shrink(out, x0, y0, S, S, 96).toDataURL('image/webp', 0.86) });
  }
  // ── 추천 조합 칩 — ui.js 의 PRESETS 표 그대로(window.__artlookPresets). 데모 그림 · 1:1 결과물 전체를 224px 로.
  //    ⚠️ 화면에서 내 작품으로 그리지 않는다 — 배경 여덟 장과 액자 사진을 다 받게 된다(규칙 65 '고른 것만 받는다').
  const presets = [];
  for (const p of (window.__artlookPresets || [])) {
    if (!FRAMES.some((f) => f.id === p.frame) || !SCENES.some((s) => s.id === p.scene)) continue;
    const { out } = shot(p.frame, p.scene, p.mat, p.matColor, p.light);
    presets.push({ id: p.id, data: shrink(out, 0, 0, out.width, out.height, 224).toDataURL('image/webp', 0.82) });
  }
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
  return { corners, presets, backs };
});

const write = (file, dataUrl) => {
  if (!ALL && fs.existsSync(file)) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
  return true;
};
let made = 0;
for (const f of result.corners) if (write(path.join(ART, 'frames/corners', `${f.id}.webp`), f.data)) made++;
for (const p of result.presets) if (write(path.join(ART, 'presets', `${p.id}.webp`), p.data)) made++;
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
console.log(`모서리 칩 ${result.corners.length}개 · 추천 조합 칩 ${result.presets.length}개 · 배경 썸네일 ${result.backs.length}개 — 새로 쓴 파일 ${made}개, scenes.json thumb ${added}개 추가`);
console.log(`frames/corners ${kb(path.join(ART, 'frames/corners'))}KB · presets ${kb(path.join(ART, 'presets'))}KB · walls/thumbs ${kb(path.join(ART, 'walls/thumbs'))}KB`);
if (errors.length) { console.error('페이지 오류:', errors.join(' | ')); process.exitCode = 1; }
