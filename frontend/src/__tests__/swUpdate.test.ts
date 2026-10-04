import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { controllerChangeReloader } from '@/lib/swUpdate';

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
