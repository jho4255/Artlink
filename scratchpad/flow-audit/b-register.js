// B. 갤러리가 폼으로 공모를 등록한다 — PC 한 건, 모바일 한 건
const L = require('./lib.js');
const zlib = require('zlib');
function png(w, h, rgb) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, 'ascii'), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.alloc(1 + w * 3); for (let x = 0; x < w; x++) { row[1 + x * 3] = (rgb[0] + x) % 256; row[2 + x * 3] = rgb[1]; row[3 + x * 3] = rgb[2]; }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(Array.from({ length: h }, () => row)))), chunk('IEND', Buffer.alloc(0))]);
}
module.exports.png = png;
if (require.main === module) (async () => {
  const browser = await L.chromium.launch();
  for (const screen of ['pc', 'mobile']) {
    const title = `점검 ${screen === 'pc' ? 'PC' : '모바일'} 공모 ${Date.now() % 100000}`;
    const { page, ctx } = await L.open(browser, 'gallery', screen);
    await page.goto('/exhibitions/new'); await page.waitForLoadState('networkidle');
    // 작성하던 공고 안내가 뜨면 새로 쓰기
    const fresh = page.getByRole('button', { name: '새로 쓰기' });
    if (await fresh.isVisible().catch(() => false)) await fresh.click();
    // 포스터
    const fileInput = page.locator('input[type=file]').first();
    await fileInput.setInputFiles([{ name: 'poster.png', mimeType: 'image/png', buffer: png(420, 594, [200, 80, 60]) }]);
    await page.waitForTimeout(1500);
    await page.selectOption('#ex-gallery', { index: 1 });
    await page.selectOption('#ex-type', 'GROUP');
    await page.fill('#ex-title', title);
    await page.fill('#ex-capacity', '2');
    await page.fill('#ex-desc', '점검용 공모입니다.\n둘째 줄 — 줄바꿈이 상세에 보이는지.\nhttps://example.com 링크 글자');
    await page.fill('#ex-start', '2026-10-03');
    await page.fill('#ex-deadline', '2026-10-10');
    await page.fill('#ex-submission', '2026-10-15');
    await page.fill('#ex-show-start', '2026-10-20');
    await page.fill('#ex-show-end', '2026-10-30');
    // 추가 질문 둘
    await page.getByRole('button', { name: /주관식 질문/ }).click();
    await page.getByRole('button', { name: /객관식 질문/ }).click();
    await page.waitForTimeout(300);
    await L.mark(page, 'B1-register-filled');
    // 질문 칸 채우기 — placeholder 를 모르니 보이는 text input 을 훑는다
    const qInputs = page.locator('input[type=text], input:not([type])').filter({ hasNot: page.locator('#ex-title') });
    const n = await qInputs.count();
    const ph = [];
    for (let i = 0; i < n; i++) ph.push(await qInputs.nth(i).getAttribute('placeholder'));
    console.log('  텍스트 입력 placeholder:', JSON.stringify(ph));
    await ctx.close();
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
