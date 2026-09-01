// 캡션 조각별 실측 — estCaptionH 의 상수(20/28/23/24)가 실제와 얼마나 다른가.
// 추정을 고치려면 먼저 재야 한다. 글꼴 6종 전부에서.
import pw from '/home/jho4255/ArtLink/e2e/node_modules/playwright/index.js';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
const HERE = '/home/jho4255/ArtLink/scratchpad/pf';
const MIME = { '.html': 'text/html', '.mjs': 'text/javascript' };
const srv = createServer((q, s) => { const f = join(HERE, decodeURIComponent(q.url.split('?')[0]));
  try { s.writeHead(200, { 'content-type': MIME[extname(f)] || 'application/octet-stream' }); s.end(readFileSync(f)); }
  catch { s.writeHead(404); s.end(); } }).listen(0);
const b = await pw.chromium.launch();
const p = await b.newPage({ viewport: { width: 1700, height: 1200 } });
await p.goto(`http://localhost:${srv.address().port}/harness.html`, { waitUntil: 'networkidle' });
await p.waitForFunction(() => window.__pfReady === true);
await p.evaluate(() => document.fonts.ready);
await p.waitForTimeout(500);

const r = await p.evaluate(() => {
  const host = document.getElementById('host');
  const FONTS = {
    myeongjo: [`'Nanum Myeongjo','Apple SD Gothic Neo',Georgia,'Times New Roman',serif`, `'Pretendard Variable',Pretendard,system-ui,sans-serif`],
    gothic:   [`'Pretendard Variable',Pretendard,system-ui,sans-serif`, `'Pretendard Variable',Pretendard,system-ui,sans-serif`],
    noto:     [`'Noto Serif KR','Nanum Myeongjo',serif`, `'Noto Serif KR','Nanum Myeongjo',serif`],
    gowun:    [`'Gowun Batang','Nanum Myeongjo',serif`, `'Pretendard Variable',Pretendard,system-ui,sans-serif`],
    plex:     [`'IBM Plex Sans KR',Pretendard,sans-serif`, `'IBM Plex Sans KR',Pretendard,sans-serif`],
    nanum:    [`'Nanum Gothic',Pretendard,sans-serif`, `'Nanum Gothic',Pretendard,sans-serif`],
  };
  const out = [];
  for (const [key, [disp, body]] of Object.entries(FONTS)) {
    // 실제 captionHtml 구조 그대로 (제목 18px + 보조 13px, margin-top 18/5)
    host.innerHTML = `<div style="width:390px;font-family:${body}">
      <div id="cap" style="text-align:center;margin-top:18px">
        <div id="t1" style="font-size:18px;font-weight:400;font-family:${disp};letter-spacing:0.06em">달빛 아래</div>
        <div id="m1" style="margin-top:5px;font-size:13px">캔버스에 유채</div>
      </div>
      <div id="cap2" style="margin-top:18px">
        <div id="t2" style="font-size:18px;font-weight:400;font-family:${disp}">${'이름 없는 정원에서 보낸 아주 긴 여름날의 오후'}</div>
      </div>
      <div id="d1" style="font-size:12.5px;line-height:1.6;width:390px">${'가'.repeat(60)}</div>
    </div>`;
    const h = (id) => document.getElementById(id).getBoundingClientRect().height;
    out.push({ key,
      titleLine: +(h('t1')).toFixed(1),
      metaLine: +(h('m1')).toFixed(1),
      title2WrapTotal: +(h('t2')).toFixed(1),
      descLine: +(h('d1') / Math.round(h('d1') / 20)).toFixed(1),
      capBlock1t1m: +(h('cap')).toFixed(1),  // margin-top 18 은 포함 안 됨(bounding rect)
    });
  }
  return out;
});
console.log('글꼴      제목1줄  보조1줄  긴제목(랩)  설명1줄  캡션블록(1제목+1보조)');
for (const x of r) console.log(`${x.key.padEnd(9)} ${String(x.titleLine).padStart(6)} ${String(x.metaLine).padStart(8)} ` +
  `${String(x.title2WrapTotal).padStart(10)} ${String(x.descLine).padStart(8)} ${String(x.capBlock1t1m).padStart(12)}`);
console.log('\n현재 estCaptionH 상수: 기본 20 + 제목줄×28 + 보조줄×23 + (설명 21×2+10) + SAFETY 24');
console.log('실제 구조:            margin-top 18 + 제목줄×실측 + 보조줄×(5+실측) + 설명(8+20×2)');
await b.close(); srv.close();
