/**
 * 안드로이드 앱 전용 분기 — lib/native.ts (2026-11-09, CLAUDE.md 규칙 79)
 * jsdom 에는 앱 브리지가 없다 — window.Capacitor 와 @capacitor/* 를 가짜로 꽂아 '앱 안'을 흉내 낸다.
 * 브라우저(가짜를 안 꽂은 상태)에서는 아무것도 바뀌지 않는다는 것도 함께 본다.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const m = vi.hoisted(() => ({
  writeFile: vi.fn<(o: { path: string; data: string }) => Promise<{ uri: string }>>(async () => ({ uri: 'file:///cache/x' })),
  appendFile: vi.fn<(o: { path: string; data: string }) => Promise<void>>(async () => {}),
  getUri: vi.fn<(o: unknown) => Promise<{ uri: string }>>(async () => ({ uri: 'file:///cache/exports/1/x.pdf' })),
  rmdir: vi.fn<(o: { path: string }) => Promise<void>>(async () => {}),
  readdir: vi.fn<(o: unknown) => Promise<{ files: { name: string }[] }>>(async () => ({ files: [] })),
  share: vi.fn<(o: unknown) => Promise<object>>(async () => ({})),
  info: vi.fn(async () => ({ versionName: '1.0', versionCode: 1, push: true })),
  checkPermissions: vi.fn(async () => ({ receive: 'prompt' })),
  requestPermissions: vi.fn(async () => ({ receive: 'granted' })),
  register: vi.fn(async () => {}),
  apiPut: vi.fn(async () => ({})),
  apiPatch: vi.fn(async () => ({})),
  toastError: vi.fn(),
}));
vi.mock('@capacitor/filesystem', () => ({
  Filesystem: { writeFile: m.writeFile, appendFile: m.appendFile, getUri: m.getUri, rmdir: m.rmdir, readdir: m.readdir },
  Directory: { Cache: 'CACHE' },
}));
vi.mock('@capacitor/share', () => ({ Share: { share: m.share } }));
// 진짜 Capacitor 플러그인처럼 **아무 속성이나 메서드로 답하는 Proxy** — 'then' 도 함수로 보인다(그대로 Promise 로 돌려주면 then 이 불린다)
vi.mock('@capacitor/core', () => ({
  registerPlugin: () => new Proxy({}, {
    get: (_t, prop) => (prop === 'info' ? m.info : () => Promise.reject(new Error(`"ArtLinkShell.${String(prop)}()" is not implemented on android`))),
  }),
}));
vi.mock('@capacitor/push-notifications', () => ({
  PushNotifications: { checkPermissions: m.checkPermissions, requestPermissions: m.requestPermissions, register: m.register },
}));
vi.mock('@/lib/axios', () => ({ default: { put: m.apiPut, patch: m.apiPatch } }));
vi.mock('react-hot-toast', () => ({ default: { error: m.toastError, success: vi.fn() } }));

import {
  isNativeApp, saveFile, shareLinkNative, handleBackButton, appPathFor, registerPush, forgetPushToken,
  openNotification, onPushReceived, safeFileName, cleanOldExports, SAVE_CHUNK_BYTES, EXPORT_KEEP_MS, PUSH_TOKEN_KEY, PUSH_ASKED_KEY,
  __resetNativeForTests,
} from '@/lib/native';
import { triggerDownload } from '@/lib/operationPdf';
import { queryClient } from '@/lib/queryClient';

const SRC = join(__dirname, '..');
const FRONT = join(SRC, '..');
const REPO = join(FRONT, '..');
const read = (p: string) => readFileSync(p, 'utf8');

function asNative(on: boolean) {
  const w = window as unknown as { Capacitor?: unknown };
  if (on) w.Capacitor = { isNativePlatform: () => true };
  else delete w.Capacitor;
}

// jsdom 의 Blob 에 arrayBuffer 가 없을 수 있다 — FileReader 로 메운다
if (!Blob.prototype.arrayBuffer) {
  Blob.prototype.arrayBuffer = function (this: Blob) {
    return new Promise<ArrayBuffer>((res) => { const r = new FileReader(); r.onload = () => res(r.result as ArrayBuffer); r.readAsArrayBuffer(this); });
  };
}

beforeEach(() => {
  __resetNativeForTests();
  Object.values(m).forEach((f) => f.mockClear());
  localStorage.clear();
  asNative(false);
});
afterEach(() => { asNative(false); vi.restoreAllMocks(); });

describe('브라우저에서는 아무것도 바뀌지 않는다', () => {
  it('isNativeApp=false · 공유는 false(부르는 쪽이 웹 공유로) · 로그아웃해도 토큰 요청 없음', async () => {
    expect(isNativeApp()).toBe(false);
    expect(await shareLinkNative('t', 'https://artlink.cc/@a')).toBe(false);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    localStorage.setItem(PUSH_TOKEN_KEY, 'tok');
    forgetPushToken();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(m.share).not.toHaveBeenCalled();
  });

  it('triggerDownload 는 예전처럼 <a download> 를 누른다(공유 창 아님)', () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    (URL as unknown as { createObjectURL: unknown }).createObjectURL ??= () => 'blob:x';
    (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL ??= () => {};
    triggerDownload(new Blob(['x']), 'a.pdf');
    expect(click).toHaveBeenCalledTimes(1);
    expect(m.writeFile).not.toHaveBeenCalled();
  });

  it('@capacitor/core 를 정적으로 부르지 않아 window.Capacitor 가 생기지 않는다(판정이 흔들리지 않게)', () => {
    expect((window as unknown as { Capacitor?: unknown }).Capacitor).toBeUndefined();
  });
});

describe('앱 안 — 파일 저장(공유 창)', () => {
  it('★ 큰 파일은 1MB 씩 나눠 쓰고, 이어 붙인 결과가 원본과 같다 → 공유 창에 그 파일', async () => {
    asNative(true);
    const bytes = new Uint8Array(SAVE_CHUNK_BYTES * 2 + 12345).map((_, i) => (i * 31) % 256);
    await saveFile(new Blob([bytes]), '포트폴리오/2026.pdf');
    expect(m.writeFile).toHaveBeenCalledTimes(1);
    expect(m.appendFile).toHaveBeenCalledTimes(2);
    const b64 = [m.writeFile.mock.calls[0][0].data, ...m.appendFile.mock.calls.map((c) => c[0].data)];
    const joined = b64.map((s) => atob(s)).join('');
    expect(joined.length).toBe(bytes.length);
    expect(joined.charCodeAt(SAVE_CHUNK_BYTES + 7)).toBe(bytes[SAVE_CHUNK_BYTES + 7]);
    expect(m.writeFile.mock.calls[0][0].path).toMatch(/^exports\/\d+\/포트폴리오_2026\.pdf$/);   // 경로 문자만 바뀌고 한글은 그대로
    expect(m.share).toHaveBeenCalledWith(expect.objectContaining({ files: ['file:///cache/exports/1/x.pdf'] }));
  });

  it('triggerDownload 도 앱에서는 공유 창으로 간다(모든 내려받기가 여기로 모인다)', async () => {
    asNative(true);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    triggerDownload(new Blob(['pdf']), '정산서.pdf');
    await vi.waitFor(() => expect(m.share).toHaveBeenCalled());
    expect(click).not.toHaveBeenCalled();
  });

  it('공유 창을 닫은 건 실패가 아니다 · 진짜 실패면 알린다', async () => {
    asNative(true);
    m.share.mockRejectedValueOnce(new Error('Share canceled'));
    await saveFile(new Blob(['x']), 'a.png');
    expect(m.toastError).not.toHaveBeenCalled();
    m.writeFile.mockRejectedValueOnce(new Error('disk full'));
    await saveFile(new Blob(['x']), 'a.png');
    expect(m.toastError).toHaveBeenCalledTimes(1);
  });

  it('링크 공유는 안드로이드 공유 창(WebView 에는 navigator.share 가 없다)', async () => {
    asNative(true);
    expect(await shareLinkNative('작가 — ArtLink', 'https://artlink.cc/@a')).toBe(true);
    expect(m.share).toHaveBeenCalledWith(expect.objectContaining({ title: '작가 — ArtLink', url: 'https://artlink.cc/@a' }));
  });

  it('★ 지난 파일 비우기는 한 시간 지난 것만 — 방금 공유 창으로 넘긴 파일을 새로고침이 지우지 않게', async () => {
    const now = 1_800_000_000_000;
    m.readdir.mockResolvedValueOnce({ files: [{ name: String(now - 60_000) }, { name: String(now - EXPORT_KEEP_MS - 1) }, { name: 'junk' }] });
    await cleanOldExports(now);
    expect(m.rmdir.mock.calls.map((c) => c[0].path)).toEqual([`exports/${now - EXPORT_KEEP_MS - 1}`, 'exports/junk']);
  });

  it('safeFileName — 경로·제어 문자만 바꾸고 비면 기본 이름', () => {
    expect(safeFileName('a/b\\c:d*?.pdf')).toBe('a_b_c_d_.pdf');
    expect(safeFileName('...')).toBe('artlink-file');
    expect(safeFileName('윤서진_빛의 결.png')).toBe('윤서진_빛의 결.png');
  });
});

describe('앱 안 — 뒤로가기', () => {
  it('★ 떠 있는 창이 있으면 그 창에 Esc 만 보내고 화면은 그대로', () => {
    const dlg = document.createElement('div');
    dlg.setAttribute('role', 'dialog');
    dlg.getClientRects = () => ({ length: 1 }) as unknown as DOMRectList;
    document.body.appendChild(dlg);
    const keys: string[] = [];
    const onKey = (e: KeyboardEvent) => keys.push(e.key);
    window.addEventListener('keydown', onKey);
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    const minimize = vi.fn();
    expect(handleBackButton(true, minimize)).toBe('dialog');
    expect(keys).toEqual(['Escape']);   // useEscapeKey 처럼 window 에서 듣는 창도 받는다
    expect(back).not.toHaveBeenCalled();
    window.removeEventListener('keydown', onKey);
    dlg.remove();
  });

  it('그려지지 않은 창(display:none 등)은 없는 것으로 친다 · 창이 없으면 이전 화면 · 첫 화면이면 앱을 내린다', () => {
    const hidden = document.createElement('div');
    hidden.setAttribute('aria-modal', 'true');
    hidden.getClientRects = () => ({ length: 0 }) as unknown as DOMRectList;
    document.body.appendChild(hidden);
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    const minimize = vi.fn();
    expect(handleBackButton(true, minimize)).toBe('back');
    expect(back).toHaveBeenCalledTimes(1);
    expect(handleBackButton(false, minimize)).toBe('minimize');
    expect(minimize).toHaveBeenCalledTimes(1);
    hidden.remove();
  });
});

describe('앱 안 — 링크·알림으로 열기', () => {
  it('appPathFor — 우리 화면 주소만 앱 안 경로로(파일·바깥은 null)', () => {
    expect(appPathFor('https://artlink.cc/exhibitions/5?apply=1#x')).toBe('/exhibitions/5?apply=1#x');
    expect(appPathFor('/support?inquiry=12')).toBe('/support?inquiry=12');
    expect(appPathFor('https://artlink.cc/uploads/a.pdf')).toBeNull();
    expect(appPathFor('https://instagram.com/x')).toBeNull();
    expect(appPathFor('javascript:alert(1)')).toBeNull();
  });

  it('알림을 누르면 읽음 처리(로그인했을 때) — 벨에서 누른 것과 같다', async () => {
    asNative(true);
    m.info.mockResolvedValueOnce({ versionName: '1', versionCode: 1, push: false });
    await registerPush(7);   // 로그인 상태로
    await openNotification({ notificationId: '42', linkUrl: '/support?inquiry=1' });
    expect(m.apiPatch).toHaveBeenCalledWith('/notifications/42/read');
  });

  it('앱을 보고 있을 때 온 알림은 벨 숫자·목록을 바로 고친다(대화면 대화 배지도)', () => {
    const inv = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();
    onPushReceived({ type: 'CHAT_MESSAGE' });
    const keys = inv.mock.calls.map((c) => JSON.stringify((c[0] as { queryKey: unknown }).queryKey));
    expect(keys).toEqual(['["notifications"]', '["unread-count"]', '["chat-unread"]', '["chats"]', '["chat"]']);   // 보고 있는 방도 곧바로(8초 폴링을 기다리지 않게)
  });
});

describe('앱 안 — 푸시 등록', () => {
  it('★ 앱 정보(ArtLinkShell)를 실제로 받아 온다 — 플러그인 Proxy 를 Promise 로 그대로 돌려주면 then() 이 불려 늘 실패한다', async () => {
    asNative(true);
    const { shellInfo } = await import('@/lib/native');
    await expect(shellInfo()).resolves.toEqual({ versionName: '1.0', versionCode: 1, push: true });
  });

  it('★ 이 앱에 Firebase 설정이 없으면(push=false) 아무것도 부르지 않는다 — 부르면 앱이 죽는다', async () => {
    asNative(true);
    m.info.mockResolvedValueOnce({ versionName: '1', versionCode: 1, push: false });
    expect(await registerPush(1)).toBe('no-push');
    expect(m.checkPermissions).not.toHaveBeenCalled();
    expect(m.register).not.toHaveBeenCalled();
  });

  it('★ 권한은 이 기기에서 처음 한 번만 묻는다 — 거절하면 다시 묻지 않는다', async () => {
    asNative(true);
    m.requestPermissions.mockResolvedValueOnce({ receive: 'denied' });
    expect(await registerPush(1)).toBe('denied');
    expect(m.requestPermissions).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(PUSH_ASKED_KEY)).toBe('1');
    expect(await registerPush(1)).toBe('denied');
    expect(m.requestPermissions).toHaveBeenCalledTimes(1);
    expect(m.register).not.toHaveBeenCalled();
  });

  it('허락하면 등록한다(토큰은 registration 이벤트로 온다)', async () => {
    asNative(true);
    expect(await registerPush(1)).toBe('registered');
    expect(m.register).toHaveBeenCalledTimes(1);
  });

  it('★ 로그아웃하면 이 기기 토큰을 인증 없이 지운다(만료로 자동 로그아웃돼도)', () => {
    asNative(true);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
    localStorage.setItem(PUSH_TOKEN_KEY, 'tok-123');
    forgetPushToken();
    expect(fetchSpy).toHaveBeenCalledWith('/api/push/tokens', expect.objectContaining({ method: 'DELETE', body: JSON.stringify({ token: 'tok-123' }), keepalive: true }));
    expect(localStorage.getItem(PUSH_TOKEN_KEY)).toBeNull();
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(JSON.stringify(init.headers)).not.toMatch(/Authorization/i);
  });
});

describe('소스 가드 — 설계가 조용히 무너지지 않게', () => {
  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      if (n === '__tests__' || n === 'node_modules') return [];
      return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
    });
  }

  it('★ @capacitor/* 를 부르는 곳은 lib/native.ts 하나 — 그리고 거기서도 동적 import 만', () => {
    const users = walk(SRC).filter((p) => /@capacitor\//.test(read(p))).map((p) => p.slice(SRC.length + 1));
    expect(users).toEqual(['lib/native.ts']);
    expect(read(join(SRC, 'lib/native.ts'))).not.toMatch(/^import[^\n]*from '@capacitor\//m);
  });

  it('★ JS 플러그인 버전 = 앱(mobile/)의 네이티브 플러그인 버전 — 어긋나면 사용자 폰에 없는 메서드를 부른다', () => {
    const web = JSON.parse(read(join(FRONT, 'package.json'))).dependencies as Record<string, string>;
    const app = JSON.parse(read(join(REPO, 'mobile/package.json'))).dependencies as Record<string, string>;
    const caps = Object.keys(web).filter((k) => k.startsWith('@capacitor/'));
    expect(caps.length).toBeGreaterThanOrEqual(5);
    for (const k of caps) expect(`${k}@${web[k]}`).toBe(`${k}@${app[k]}`);
  });

  it('붙이는 곳 — App 맨 위 · 로그아웃 · 모든 내려받기 · ArtLook 저장', () => {
    expect(read(join(SRC, 'App.tsx'))).toMatch(/useNativeBridge\(userId\)/);
    expect(read(join(SRC, 'stores/authStore.ts'))).toMatch(/forgetPushToken\(\)/);
    expect(read(join(SRC, 'lib/operationPdf.ts'))).toMatch(/if \(isNativeApp\(\)\) \{ void saveFile\(blob, filename\); return; \}/);
    expect(read(join(SRC, 'lib/portfolioFormats.ts'))).not.toMatch(/pptx\.writeFile\(/);   // pptxgenjs 가 스스로 <a download> 를 누른다
    const ui = read(join(FRONT, 'public/artlook/ui.js'));
    expect(ui).toMatch(/function nativeBridge\(\)/);
    // ⚠️ 앱 플러그인은 최상위 창에서 부른 것만 받는다 — iframe(마이페이지 [ArtLook] 탭)의 자기 브리지를 쓰면 눌러도 아무 일이 없다
    expect(ui).toMatch(/const c=window\.top && window\.top\.Capacitor;/);
    expect(ui).not.toMatch(/for\(const w of \[window, window\.parent\]\)/);
    expect(ui).toMatch(/IN_APP=\/[^\n]*ArtLinkApp/);
  });

  it('Esc 로 닫히는 창은 role="dialog" aria-modal 을 단다 — 앱의 뒤로가기가 그걸 보고 창만 닫는다(없으면 화면이 넘어간다)', () => {
    for (const f of ['components/shared/ImageLightbox.tsx', 'components/shared/ArtworkDetailModal.tsx', 'components/shared/InviteApplyModal.tsx']) {
      const src = read(join(SRC, f));
      expect(src, f).toMatch(/role="dialog"/);
      expect(src, f).toMatch(/aria-modal="true"/);
    }
    expect(read(join(SRC, 'components/shared/ArtworkDetailModal.tsx'))).toMatch(/useEscapeKey\(onClose\)/);   // InviteModal
  });

  it('★ 화면에 <a download> 를 새로 만들지 않는다 — 앱에서는 아무 일도 안 일어난다(triggerDownload 를 쓸 것)', () => {
    const offenders = walk(SRC)
      .filter((p) => !p.endsWith('lib/operationPdf.ts'))
      .filter((p) => /\.download\s*=/.test(read(p)))
      .map((p) => p.slice(SRC.length + 1));
    expect(offenders).toEqual([]);
  });

  it('알림 채널 id 가 세 곳에서 같다 — 웹(채널 만들기) · 서버(보내기) · 앱 매니페스트(기본 채널)', () => {
    const web = /PUSH_CHANNEL = '([^']+)'/.exec(read(join(SRC, 'lib/native.ts')))?.[1];
    const server = /PUSH_CHANNEL_ID = '([^']+)'/.exec(read(join(REPO, 'backend/src/lib/push.ts')))?.[1];
    const manifest = /default_notification_channel_id"\s*android:value="([^"]+)"/.exec(read(join(REPO, 'mobile/android/app/src/main/AndroidManifest.xml')))?.[1];
    expect(web).toBe('artlink');
    expect(server).toBe(web);
    expect(manifest).toBe(web);
  });

  it('★ 앱 설정 — allowNavigation 을 넓히지 않는다(그 주소는 앱의 네이티브 통로까지 받는다) · App Links 에 로그인·파일 경로를 넣지 않는다', () => {
    const cfg = read(join(REPO, 'mobile/capacitor.config.ts'));
    const nav = /allowNavigation:\s*\[([^\]]*)\]/.exec(cfg)?.[1] ?? '';
    expect(nav).not.toMatch(/\*/);
    const manifest = read(join(REPO, 'mobile/android/app/src/main/AndroidManifest.xml'));
    const prefixes = [...manifest.matchAll(/android:pathPrefix="([^"]+)"/g)].map((x) => x[1]);
    expect(prefixes.length).toBeGreaterThan(3);
    for (const p of prefixes) expect(p).not.toMatch(/^\/(auth|login|signup|uploads|api|terms|artlook)?$/);
  });

  it('★ 바깥 사이트의 HTTP 오류 페이지는 가리지 않는다 — 카카오 KOE 안내가 \'연결하지 못했어요\'로 덮였다(2026-11-11)', () => {
    const java = read(join(REPO, 'mobile/android/app/src/main/java/cc/artlink/app/ArtLinkShellPlugin.java'));
    expect(java).toMatch(/setWebViewClient\(new BridgeWebViewClient/);
    const fn = java.slice(java.indexOf('public void onReceivedHttpError'));
    expect(fn).toMatch(/isForMainFrame\(\) && !isAppHost\(request\.getUrl\(\)\)\) return;/);
    expect(fn.indexOf('return;')).toBeLessThan(fn.indexOf('super.onReceivedHttpError'));   // 우리 서버 오류(배포 중 502 등)는 그대로 오류 화면
  });

  it('★ intent:// 로 다른 앱을 열 때 권한 넘기기·첨부를 지우고, 기기 안 파일 주소는 열지 않는다(2026-11-11 보안 검토)', () => {
    const java = read(join(REPO, 'mobile/android/app/src/main/java/cc/artlink/app/ArtLinkShellPlugin.java'));
    const fn = java.slice(java.indexOf('private void openIntentUrl'));
    const launch = fn.indexOf('startActivity(intent)');
    for (const must of ['intent.setFlags(0)', 'intent.setClipData(null)', '"content".equals(dataScheme)', '"file".equals(dataScheme)']) {
      expect(fn.indexOf(must), must).toBeGreaterThan(0);
      expect(fn.indexOf(must), must).toBeLessThan(launch);
    }
  });

  it('개인정보처리방침에 적었다 — 앱 알림 기기 토큰(수집·보관)·알림 발송 위탁(Firebase)', () => {
    const src = read(join(SRC, 'pages/PrivacyPage.tsx'));
    expect(src).toContain('기기 알림 토큰');
    expect(src).toContain('앱 알림 기기 토큰: 로그아웃·회원 탈퇴 시');
    expect(src).toContain('Firebase Cloud Messaging');
  });

  it('브라우저 설치자에게 앱 전용 청크를 미리 받게 하지 않는다(빌드 설정)', () => {
    const vite = read(join(FRONT, 'vite.config.ts'));
    expect(vite).toMatch(/'\*\*\/capacitor-\*\.js'/);
    expect(vite).not.toMatch(/manualChunks[\s\S]{0,200}@capacitor/);   // 묶으면 __vitePreload 가 끌려가 모든 화면이 그 청크를 받는다
  });
});
