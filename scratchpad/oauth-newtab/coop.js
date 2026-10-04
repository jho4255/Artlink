// sessionStorage 가 COOP(same-origin-allow-popups) 페이지 → 다른 출처 → 되돌아옴 사이에 살아남는가 (크롬·WebKit)
const http = require('http');
const { chromium, webkit } = require('/home/jho4255/ArtLink/e2e/node_modules/playwright');
const A = 47811, B = 47812;
const page = (body) => `<!doctype html><meta charset=utf-8><body>${body}</body>`;
const a = http.createServer((req, res) => {
  const h = { 'Content-Type': 'text/html', 'Cross-Origin-Opener-Policy': 'same-origin-allow-popups' };
  if (req.url.startsWith('/callback')) { res.writeHead(200, h); res.end(page(`<pre id=o></pre><script>document.getElementById('o').textContent = JSON.stringify({ s: sessionStorage.getItem('k'), l: localStorage.getItem('k') })</script>`)); return; }
  res.writeHead(200, h); res.end(page(`<script>sessionStorage.setItem('k','S'); localStorage.setItem('k','L'); location.href='http://127.0.0.1:${B}/authorize'</script>`));
}).listen(A);
const b = http.createServer((req, res) => { res.writeHead(302, { Location: `http://localhost:${A}/callback?code=x` }); res.end(); }).listen(B);
(async () => {
  for (const [name, bt, opts] of [['chromium', chromium, {}], ['webkit', webkit, { executablePath: process.env.HOME + '/.cache/wk-deps/run.sh' }]]) {
    const br = await bt.launch(opts);
    const p = await (await br.newContext()).newPage();
    await p.goto(`http://localhost:${A}/start`);
    await p.waitForURL(/callback/);
    await p.waitForSelector('#o:not(:empty)');
    console.log(name, await p.textContent('#o'));
    await br.close();
  }
  a.close(); b.close();
})().catch((e) => { console.error(e); process.exit(1); });
