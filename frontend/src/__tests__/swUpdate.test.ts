import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { controllerChangeReloader, entryScriptOf, isLatestBuild, reloadIfStale } from '@/lib/swUpdate';

// 서비스워커가 페이지를 넘겨받을 때의 새로고침 — 처음 설치는 업데이트가 아니다(2026-10-04: 첫 방문자 페이지가 7초쯤에 저절로 다시 불러와졌다)
describe('controllerChangeReloader', () => {
  it('처음 설치(관리자 없던 페이지)는 새로고침하지 않고, 그 뒤의 업데이트부터 한 번 새로고침한다', () => {
    const reload = vi.fn();
    const onChange = controllerChangeReloader(false, reload);
    onChange();   // 처음 설치된 워커가 넘겨받음
    expect(reload).not.toHaveBeenCalled();
    onChange();   // 이 탭을 열어 둔 채 새 배포
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('이미 워커가 있던 페이지는 바뀌면 바로 새로고침 — 되풀이해 와도 한 번만', () => {
    const reload = vi.fn();
    const onChange = controllerChangeReloader(true, reload);
    onChange(); onChange(); onChange();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('main.tsx 가 지금 관리자 유무를 넘겨 이 판정을 쓴다(무조건 새로고침으로 되돌리지 않게)', () => {
    const src = readFileSync(resolve(__dirname, '../main.tsx'), 'utf8');
    expect(src).toMatch(/controllerChangeReloader\(\s*!!navigator\.serviceWorker\.controller/);
    expect(src).not.toMatch(/addEventListener\('controllerchange',\s*\(\)\s*=>/);
  });
});

// 배포 뒤 다시 온 사람 — 첫 화면부터 새 판이면 새 워커가 넘겨받아도 새로고침하지 않는다(2026-10-12: 그 새로고침이 '홈페이지 완성' 팝업을 지웠다)
describe('reloadIfStale — 이미 최신 판이면 새로고침하지 않는다', () => {
  const html = (h: string) => `<!doctype html><head><script type="module" crossorigin src="/assets/index-${h}.js"></script></head>`;

  it('서버 index.html 의 첫 화면 묶음을 찾는다', () => {
    expect(entryScriptOf(html('AbC_12-x'))).toBe('/assets/index-AbC_12-x.js');
    expect(entryScriptOf('<html></html>')).toBeNull();
  });

  it('★ 같은 묶음이면 최신 — 새로고침 안 함 · 다르면(오래 열어 둔 옛 화면) 새로고침', async () => {
    expect(isLatestBuild(html('NEW'), ['https://artlink.cc/assets/index-NEW.js', 'https://cdn.example/x.js'])).toBe(true);
    expect(isLatestBuild(html('NEW'), ['https://artlink.cc/assets/index-OLD.js'])).toBe(false);
    const reload = vi.fn();
    await reloadIfStale(async () => html('NEW'), () => ['https://artlink.cc/assets/index-NEW.js'], reload);
    expect(reload).not.toHaveBeenCalled();
    await reloadIfStale(async () => html('NEW'), () => ['https://artlink.cc/assets/index-OLD.js'], reload);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('모르면(못 받음·묶음 이름 없음) 예전처럼 새로고침한다', async () => {
    const reload = vi.fn();
    await reloadIfStale(async () => { throw new Error('offline'); }, () => ['https://artlink.cc/assets/index-NEW.js'], reload);
    await reloadIfStale(async () => '<html></html>', () => ['https://artlink.cc/assets/index-NEW.js'], reload);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('main.tsx 가 넘겨받을 때 reloadIfStale 을 쓰고 · sw.js 가 \'/\' 를 미리 받아 둔 화면으로 돌리지 않는다', () => {
    const main = readFileSync(resolve(__dirname, '../main.tsx'), 'utf8');
    expect(main).toMatch(/controllerChangeReloader\(!!navigator\.serviceWorker\.controller, \(\) => \{\s*void reloadIfStale\(/);
    expect(main).toMatch(/fetch\('\/', \{ cache: 'no-store'/);
    const sw = readFileSync(resolve(__dirname, '../sw.js'), 'utf8');
    // 기본값이면 '/' 가 precache 의 index.html 로 먼저 잡혀 '페이지 이동은 네트워크' 가 첫 주소에서만 안 통했다(배포 뒤 18초 옛 화면)
    expect(sw).toMatch(/precacheAndRoute\(self\.__WB_MANIFEST \|\| \[\], \{ directoryIndex: null, cleanURLs: false \}\)/);
  });
});
