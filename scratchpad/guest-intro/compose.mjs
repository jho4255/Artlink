// capture.mjs 가 찍은 실제 화면을 팝업 네 칸(4:3) 모양으로 짜 맞춘다 → out/q-*.png (1200×900, make-assets.py 가 600×450 webp 로 줄인다)
//   node scratchpad/guest-intro/compose.mjs
// 짜 맞추는 건 배경·창 테두리·그림자뿐이다 — 안의 그림은 전부 실제 화면 그대로다(잘라 쓸 뿐).
import pw from '/home/jho4255/ArtLink/e2e/node_modules/playwright/index.js';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const OUT = '/home/jho4255/ArtLink/scratchpad/guest-intro/out';
const box = JSON.parse(readFileSync(`${OUT}/raw-apply.json`, 'utf8'));

// 잘라 두기(파이썬 PIL) — 지원서는 2배율 전체 화면에서 [머리~약력] · [작품 사진 첫 줄]
const crop = (src, dst, x, y, w, h) => execFileSync('python3', ['-c',
  `from PIL import Image; im=Image.open('${src}'); im.crop((${Math.round(x)},${Math.round(y)},${Math.round(x + w)},${Math.round(y + h)})).save('${dst}')`]);
const S = 2;
const colX = box.top.x - 24, colW = box.top.width + 48;
crop(`${OUT}/raw-apply.png`, `${OUT}/c-apply-top.png`, colX * S, (box.top.y - 14) * S, colW * S, (box.bio.y + box.bio.height + 28 - (box.top.y - 14)) * S);
crop(`${OUT}/raw-apply.png`, `${OUT}/c-apply-works.png`, (box.works.x - 20) * S, (box.works.y - 18) * S, (box.grid.width + 40) * S, (box.grid.y + (box.grid.height - 24) / 3 + 10 - (box.works.y - 18)) * S); // 첫 줄까지만(칸 사이 12px × 2)
crop(`${OUT}/artlook-d.png`, `${OUT}/c-artlook.png`, 0, 125, 1080, 810);
// 갤러리 — ArtLook(전시장 장면) · 공모 운영(머리~정산 단계) + 정산 합계 상자
crop(`${OUT}/artlook-g1.png`, `${OUT}/c-artlook-g.png`, 0, 135, 1080, 810);
const op = JSON.parse(readFileSync(`${OUT}/raw-op.json`, 'utf8'));
crop(`${OUT}/raw-op.png`, `${OUT}/c-op-top.png`, (op.head.x - 24) * S, (op.head.y - 14) * S, (op.head.width + 48) * S, 760 * S);
// 갤러리 — 전시 홍보(포스터) + 정보 상자(제목 ~ 위치)
const sh = JSON.parse(readFileSync(`${OUT}/raw-show.json`, 'utf8'));
// 포스터만 — 아래쪽 사진 띠(포스터 위에 겹쳐 나오는 전시 사진)가 걸리기 전까지(2026-10-18 '포스터 부분만 보이게')
crop(`${OUT}/raw-show.png`, `${OUT}/c-show-top.png`, (sh.poster.x - 216) * S, (sh.poster.y - 40) * S, (sh.poster.width + 432) * S, (sh.poster.height - 30) * S);
crop(`${OUT}/raw-show.png`, `${OUT}/c-show-info.png`, (sh.title.x - 16) * S, (sh.title.y - 16) * S, (1280 - 2 * (sh.title.x - 16)) * S, (sh.loc.y + sh.loc.height + 20 - (sh.title.y - 16)) * S);
crop(`${OUT}/raw-op.png`, `${OUT}/c-op-sum.png`, (op.sum.x - 8) * S, (op.sum.y - 8) * S, (op.sum.width + 16) * S, (op.sum.height + 16) * S);

const data = (f) => `data:image/png;base64,${readFileSync(`${OUT}/${f}`).toString('base64')}`;
const BG = '#efede8';
const shadow = 'box-shadow:0 2px 6px rgba(0,0,0,.08),0 18px 40px rgba(0,0,0,.14)';
const chrome = (url) => `<div style="height:44px;display:flex;align-items:center;gap:9px;padding:0 18px;background:#f7f7f5;border-bottom:1px solid #e6e4df">
  <span style="width:11px;height:11px;border-radius:50%;background:#e2e0db"></span><span style="width:11px;height:11px;border-radius:50%;background:#e2e0db"></span><span style="width:11px;height:11px;border-radius:50%;background:#e2e0db"></span>
  <span style="margin-left:14px;flex:1;max-width:520px;height:26px;border-radius:13px;background:#fff;border:1px solid #e6e4df;display:flex;align-items:center;padding:0 14px;font:500 15px/1 -apple-system,'Segoe UI',Roboto,'Noto Sans KR',sans-serif;color:#555">${url}</span></div>`;

const SCENES = {
  artlook: `<img src="${data('c-artlook.png')}" style="width:1200px;height:900px;object-fit:cover;display:block">`,
  portfolio: `<div style="width:1200px;height:900px;background:${BG};display:flex;align-items:center;justify-content:center;gap:34px">
    <img src="${data('raw-pf0-cover.png')}" style="height:740px;${shadow}">
    <img src="${data('raw-pf0-works.png')}" style="height:740px;${shadow}">
  </div>`,
  homepage: `<div style="width:1200px;height:900px;background:${BG};position:relative;overflow:hidden">
    <div style="position:absolute;left:70px;top:70px;width:1060px;border-radius:12px 12px 0 0;overflow:hidden;background:#fff;${shadow}">
      ${chrome('artlink.cc/@seojin.yoon')}
      <img src="${data('raw-home.png')}" style="width:1060px;display:block">
    </div></div>`,
  'gallery-artlook': `<img src="${data('c-artlook-g.png')}" style="width:1200px;height:900px;object-fit:cover;display:block">`,
  'gallery-ops': `<div style="width:1200px;height:900px;background:${BG};position:relative;overflow:hidden">
    <div style="position:absolute;left:70px;top:70px;width:900px;border-radius:12px 12px 0 0;overflow:hidden;background:#fff;${shadow}">
      ${chrome('artlink.cc/exhibitions/operation')}
      <img src="${data('c-op-top.png')}" style="width:900px;display:block">
    </div>
    <div style="position:absolute;right:56px;bottom:64px;width:700px;border-radius:12px;overflow:hidden;background:#fff;padding:10px;${shadow}">
      <img src="${data('c-op-sum.png')}" style="width:680px;display:block">
    </div></div>`,
  'gallery-home': `<div style="width:1200px;height:900px;background:${BG};position:relative;overflow:hidden">
    <div style="position:absolute;left:70px;top:70px;width:1060px;border-radius:12px 12px 0 0;overflow:hidden;background:#fff;${shadow}">
      ${chrome('artlink.cc/@artlink.gallery')}
      <img src="${data('raw-ghome.png')}" style="width:1060px;display:block">
    </div></div>`,
  'gallery-show': `<div style="width:1200px;height:900px;background:${BG};position:relative;overflow:hidden">
    <div style="position:absolute;left:70px;top:70px;width:1060px;border-radius:12px 12px 0 0;overflow:hidden;background:#fff;${shadow}">
      ${chrome('artlink.cc/shows')}
      <img src="${data('c-show-top.png')}" style="width:1060px;display:block">
    </div></div>`,
  apply: `<div style="width:1200px;height:900px;background:${BG};position:relative;overflow:hidden">
    <div style="position:absolute;left:70px;top:70px;width:900px;border-radius:12px 12px 0 0;overflow:hidden;background:#fff;${shadow}">
      ${chrome('artlink.cc/exhibitions/apply')}
      <img src="${data('c-apply-top.png')}" style="width:900px;display:block">
    </div>
    <div style="position:absolute;right:56px;bottom:56px;width:620px;border-radius:12px;overflow:hidden;background:#fff;${shadow}">
      <img src="${data('c-apply-works.png')}" style="width:620px;display:block">
    </div></div>`,
};

const b = await pw.chromium.launch();
const p = await b.newPage({ viewport: { width: 1200, height: 900 } });
for (const [k, html] of Object.entries(SCENES)) {
  await p.setContent(`<!doctype html><meta charset="utf-8"><body style="margin:0">${html}</body>`);
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${OUT}/q-${k}.png`, clip: { x: 0, y: 0, width: 1200, height: 900 } });
  console.log('✓', k);
}
await b.close();
