// og:image(1200×630) 생성 — 사이트 로고 스타일(Pretendard, Link 빨강)과 동일한 무드로 렌더
import { chromium } from 'playwright';

const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css">
<style>
  * { margin: 0; padding: 0; }
  body {
    width: 1200px; height: 630px;
    font-family: 'Pretendard Variable', Pretendard, sans-serif;
    background: #ffffff;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    position: relative; overflow: hidden;
  }
  .rule-top { position: absolute; top: 72px; left: 96px; right: 96px; height: 1px; background: #111; }
  .rule-bottom { position: absolute; bottom: 72px; left: 96px; right: 96px; height: 1px; background: #e5e7eb; }
  .logo { font-size: 128px; font-weight: 700; letter-spacing: -0.03em; color: #111827; }
  .logo .red { color: #dc3545; }
  .tagline { margin-top: 28px; font-size: 34px; color: #6b7280; letter-spacing: 0.02em; }
  .url { position: absolute; bottom: 88px; font-size: 24px; color: #9ca3af; letter-spacing: 0.06em; }
</style></head>
<body>
  <div class="rule-top"></div>
  <div class="logo">Art<span class="red">Link</span></div>
  <div class="tagline">갤러리와 아티스트를 잇다</div>
  <div class="url">artlink.cc</div>
  <div class="rule-bottom"></div>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(html, { waitUntil: 'networkidle' });
await page.waitForTimeout(500); // 폰트 적용 대기
await page.screenshot({ path: '../frontend/public/og-image.png' });
await browser.close();
console.log('og-image.png generated');
