// `cap sync android` 다음에 돈다(npm run sync) — 2026-11-09
// ① 오류 화면(offline.html)의 [다시 시도]가 돌아갈 서버 주소를 채운다(그 화면은 앱 안의 https://localhost 에서 열려 '/'가 서버가 아니다)
// ② 실서버가 아닌 주소로 sync 했으면 크게 알린다 — 그대로 출시 빌드를 만들면 사용자 폰이 개발 주소를 연다
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const assets = join(root, 'android', 'app', 'src', 'main', 'assets');
const cfg = JSON.parse(readFileSync(join(assets, 'capacitor.config.json'), 'utf8'));
const url = cfg.server?.url;
if (!url) throw new Error('capacitor.config.json 에 server.url 이 없다');

const page = join(assets, 'public', 'offline.html');
writeFileSync(page, readFileSync(page, 'utf8').replaceAll('__APP_URL__', url));

if (url !== 'https://artlink.cc') {
  console.warn(`\n⚠️  이 빌드는 ${url} 을 연다(개발용). 출시 빌드 전에 ARTLINK_APP_URL 없이 'npm run sync' 를 다시 돌릴 것.\n`);
} else {
  console.log(`post-sync: server.url = ${url}`);
}
