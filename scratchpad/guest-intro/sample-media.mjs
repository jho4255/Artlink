// 샘플 갤러리 대표 사진·샘플 전시 포스터 — 로컬 업로드 폴더(backend/uploads/intro-sample/)에만 만든다(git·배포 제외).
//   node scratchpad/guest-intro/sample-media.mjs   (artlook-shot.mjs 의 c 렌더가 있어야 한다)
// 갤러리 사진은 우리 ArtLook 엔진 렌더(자체 제작 장면 + 데모 그림)에서 워터마크가 없는 위쪽만 쓴다. 포스터는 데모 그림 + 글자.
import pw from '/home/jho4255/ArtLink/e2e/node_modules/playwright/index.js';
import { mkdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const OUT = '/home/jho4255/ArtLink/scratchpad/guest-intro/out';
const DST = '/home/jho4255/ArtLink/backend/uploads/intro-sample';
mkdirSync(DST, { recursive: true });
// 갤러리 홈페이지는 대표 사진을 2.6:1 띠로 보여 준다 — 액자가 작게 걸린 공간 장면(artlook-shot.mjs c, 정사각)에서 액자가 다 들어오는 가로 띠를 자른다.
// (넓은 비율로 렌더하면 ArtLook 이 작품을 화면에 꽉 차게 키워 띠에서 액자가 잘린다.) 워터마크(오른쪽 아래)는 띠 밖이다
execFileSync('python3', ['-c', `from PIL import Image; im=Image.open('${OUT}/artlook-c.png').convert('RGB'); im.crop((0,300,1080,740)).save('${DST}/gallery-main.jpg', quality=90)`]);
const art = `data:image/jpeg;base64,${readFileSync('/home/jho4255/ArtLink/frontend/public/demo-art/long-summer.jpg').toString('base64')}`;
const b = await pw.chromium.launch();
const p = await b.newPage({ viewport: { width: 840, height: 1188 } });
await p.setContent(`<!doctype html><meta charset="utf-8"><body style="margin:0">
<div style="width:840px;height:1188px;background:#f3efe6;font-family:'Noto Serif KR','Nanum Myeongjo',serif;color:#1b1b1b;position:relative">
  <div style="position:absolute;left:70px;top:70px;font:600 22px/1 'Noto Sans KR',sans-serif;letter-spacing:.3em">YOON SEOJIN SOLO EXHIBITION</div>
  <img src="${art}" style="position:absolute;left:70px;top:140px;width:700px;height:560px;object-fit:contain">
  <div style="position:absolute;left:70px;top:760px;font-size:104px;font-weight:700;letter-spacing:-.02em">빛의 결</div>
  <div style="position:absolute;left:74px;top:900px;font:500 30px/1.5 'Noto Sans KR',sans-serif">윤서진 개인전</div>
  <div style="position:absolute;left:74px;bottom:70px;font:500 24px/1.6 'Noto Sans KR',sans-serif">아트링크 갤러리<br>11:00 – 19:00 · 월요일 휴관</div>
</div></body>`);
await p.waitForTimeout(300);
await p.screenshot({ path: `${DST}/show-poster.png` });
execFileSync('python3', ['-c', `from PIL import Image; Image.open('${DST}/show-poster.png').convert('RGB').save('${DST}/show-poster.jpg', quality=90)`]);
await b.close();
console.log('✓', DST);
