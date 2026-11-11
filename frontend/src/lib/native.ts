import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { queryClient } from '@/lib/queryClient';
import { resolveSiteLink } from '@/lib/siteLink';
import { holdPopupsFor, notePopupHoldPath } from '@/lib/popupHold';
import { pushBannerWanted, showPushBanner } from '@/lib/pushBanner';

/**
 * 앱(안드로이드 껍데기 — 저장소 `mobile/`, Capacitor) 안에서만 다르게 하는 일 — **전부 여기 한 곳**(2026-11-09, CLAUDE.md 규칙 79).
 *
 * 앱은 artlink.cc 를 WebView 로 그대로 띄운다. 브라우저와 같은 코드가 돌고, 다른 점만 여기서 가른다:
 *  - 내려받기 — WebView 는 `<a download>` 를 무시한다(눌러도 아무 일 없음) → 파일로 써서 안드로이드 공유 창(저장·카톡·드라이브…)
 *  - 링크 공유 — WebView 에는 `navigator.share` 가 없다 → 안드로이드 공유 창
 *  - 뒤로가기 버튼 — 떠 있는 창이 있으면 그 창만(Esc 와 같은 길), 없으면 이전 화면, 첫 화면이면 앱을 내린다
 *  - 앱 링크(카카오톡에서 누른 artlink.cc 링크)·푸시 알림을 누르면 그 화면으로
 *  - 푸시 — 로그인하면 기기 토큰을 서버에 등록(PUT /push/tokens), 로그아웃하면 지운다(DELETE, 토큰이 곧 자격)
 *
 * ⚠️ 판정은 `isNativeApp()` 하나 — 앱의 브리지가 문서 시작 때 심는 `window.Capacitor.isNativePlatform()` 이다.
 *    `@capacitor/core` 를 정적으로 import 하면 브라우저에서도 `window.Capacitor`(platform 'web')가 생기니 그걸로 판정하지 말 것.
 * ⚠️ `@capacitor/*` 는 **앱일 때만 동적 import** — 브라우저 사용자 번들에 싣지 않는다. 화면 컴포넌트가 직접 import 하지 말 것
 *    (`__tests__/native.test.ts` 가 소스를 훑어 막는다). 버전은 `mobile/package.json` 과 같아야 한다(같은 테스트가 대조) —
 *    여기 JS 가 부르는 메서드를 사용자 폰의 네이티브 플러그인이 갖고 있어야 한다.
 * ⚠️ 웹은 계속 배포되지만 이미 설치된 앱의 네이티브 코드는 그대로다 — 새 네이티브 기능을 쓰려면 `shellInfo().versionCode` 로 가를 것.
 */

type CapacitorGlobal = { isNativePlatform?: () => boolean };

export function isNativeApp(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return !!(window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor?.isNativePlatform?.();
  } catch {
    return false;
  }
}

// ─── 앱 정보(네이티브 ArtLinkShell 플러그인 — mobile/android/…/ArtLinkShellPlugin.java) ───

export interface ShellInfo {
  versionName: string;
  versionCode: number;
  /** 이 앱에 Firebase 설정(google-services.json)이 들어 있는가 — false 면 푸시를 등록하지 않는다(부르면 앱이 죽는다) */
  push: boolean;
}

interface ArtLinkShellPlugin {
  info(): Promise<ShellInfo>;
}

let shellPromise: Promise<{ plugin: ArtLinkShellPlugin }> | null = null;
// registerPlugin 은 이름당 한 번만 — 두 번 부르면 Capacitor 가 경고하고 처음 것을 돌려준다.
// ⚠️ 플러그인(Proxy)을 Promise 로 **그대로** 돌려주지 말 것 — Proxy 는 아무 속성이나 메서드로 답해서 'then' 이 있는 것처럼 보이고,
//    Promise 가 그걸 부르면 네이티브에 then() 을 보내 "ArtLinkShell.then() is not implemented" 로 실패한다(2026-11-09 에뮬레이터에서 겪음).
//    객체로 한 번 감싼다.
const shell = () => (shellPromise ??= import('@capacitor/core').then(({ registerPlugin }) => ({ plugin: registerPlugin<ArtLinkShellPlugin>('ArtLinkShell') })));

let infoPromise: Promise<ShellInfo | null> | null = null;
export function shellInfo(): Promise<ShellInfo | null> {
  if (!isNativeApp()) return Promise.resolve(null);
  // 옛 앱(이 플러그인이 없는 판)이면 실패 — 아무 기능도 없는 것으로 친다
  return (infoPromise ??= shell().then((s) => s.plugin.info()).catch(() => null));
}

// ─── 파일 저장(공유 창) ───

/** 파일 이름에서 경로·제어 문자만 뺀다(한글은 그대로 — 받는 쪽에 보이는 이름이다) */
export function safeFileName(name: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/^\.+/, '').trim();
  return cleaned.slice(0, 120) || 'artlink-file';
}

/** 공유 창을 닫은 것은 실패가 아니다(안드로이드는 '공유 취소'로 거절한다) */
export function isShareCancel(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return /cancel/i.test(msg);
}

/** 3 의 배수 바이트씩 잘라야 base64 조각을 이어 붙여도(앱이 조각마다 풀어 덧붙인다) 원본과 같다 */
export const SAVE_CHUNK_BYTES = 3 * 256 * 1024;

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}

const EXPORT_DIR = 'exports';

/**
 * 앱에서 만든 파일(PDF·ZIP·PPTX·한글 캡션·이미지)을 안드로이드 공유 창으로 넘긴다 — '파일에 저장'·카카오톡·드라이브를 사용자가 고른다.
 * 기기 캐시 폴더에 1MB 씩 나눠 쓴다(9MB PDF 를 한 번에 base64 로 넘기면 메모리를 두 배로 쓴다). 앱을 켤 때 지난 파일을 비운다.
 */
export async function saveFile(blob: Blob, fileName: string): Promise<void> {
  try {
    const [{ Filesystem, Directory }, { Share }] = await Promise.all([import('@capacitor/filesystem'), import('@capacitor/share')]);
    const path = `${EXPORT_DIR}/${Date.now()}/${safeFileName(fileName)}`;
    for (let off = 0; off === 0 || off < blob.size; off += SAVE_CHUNK_BYTES) {
      const data = await blobToBase64(blob.slice(off, off + SAVE_CHUNK_BYTES));
      if (off === 0) await Filesystem.writeFile({ path, data, directory: Directory.Cache, recursive: true });
      else await Filesystem.appendFile({ path, data, directory: Directory.Cache });
    }
    const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache });
    await Share.share({ title: fileName, files: [uri], dialogTitle: '저장하거나 보낼 곳을 고르세요' });
  } catch (err) {
    if (isShareCancel(err)) return;
    toast.error('파일을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.');
  }
}

/** 링크 공유 — 앱이면 안드로이드 공유 창을 열고 true. 앱이 아니면 false(부르는 쪽이 웹 공유·복사로) */
export async function shareLinkNative(title: string, url: string): Promise<boolean> {
  if (!isNativeApp()) return false;
  try {
    const { Share } = await import('@capacitor/share');
    await Share.share({ title, url, dialogTitle: '공유하기' });
  } catch (err) {
    if (!isShareCancel(err)) toast.error('공유하지 못했어요.');
  }
  return true;
}

// ─── 뒤로가기 ───

/** 지금 화면 위에 떠 있는 창(맨 위의 것) — 그려지지 않은(display:none 등) 것은 뺀다 */
export function topOpenDialog(root: ParentNode = document): HTMLElement | null {
  const open = Array.from(root.querySelectorAll<HTMLElement>('[role="dialog"], [aria-modal="true"]'))
    .filter((el) => el.getClientRects().length > 0);
  return open.length ? open[open.length - 1] : null;
}

/**
 * 안드로이드 뒤로가기 — ① 떠 있는 창이 있으면 그 창에 Esc 를 보낸다(창들이 이미 Esc 로 닫힌다: useEscapeKey·ConfirmDialog…)
 * ② 없으면 이전 화면 ③ 첫 화면이면 앱을 내린다(종료가 아니라 — 다시 열면 보던 화면 그대로).
 * ⚠️ 창이 있을 때는 화면을 넘기지 않는다 — Esc 를 안 듣는 창이면 아무 일도 없지만, 넘기면 창이 남은 채 뒤 화면이 바뀐다.
 */
export function handleBackButton(canGoBack: boolean, minimize: () => void): 'dialog' | 'back' | 'minimize' {
  const dialog = topOpenDialog();
  if (dialog) {
    const active = document.activeElement;
    const target = active instanceof HTMLElement && dialog.contains(active) ? active : dialog;
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true }));
    return 'dialog';
  }
  if (canGoBack) {
    window.history.back();
    return 'back';
  }
  minimize();
  return 'minimize';
}

// ─── 화면 이동(앱 링크·푸시) ───

let navigateTo: ((path: string) => void) | null = null;
const pendingPaths: string[] = [];

/** 앱 링크·푸시가 가리키는 주소를 앱 안 경로로 — 우리 화면이 아니면(파일·바깥 사이트) null */
export function appPathFor(raw: string | null | undefined): string | null {
  const link = resolveSiteLink(raw);
  return link?.kind === 'route' ? link.path : null;
}

function openPath(raw: string | null | undefined): void {
  const path = appPathFor(raw);
  if (!path) return;
  if (navigateTo) navigateTo(path);
  else pendingPaths.push(path); // 라우터가 아직 안 붙었다(앱을 링크·알림으로 막 켰을 때)
}

// ─── 푸시 ───

export const PUSH_TOKEN_KEY = 'artlink-push-token';
export const PUSH_ASKED_KEY = 'artlink-push-asked';
const PUSH_CHANNEL = 'artlink'; // 서버 lib/push.ts 의 channelId 와 같아야 한다(AndroidManifest 기본 채널도)

let currentUserId: number | null = null;

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

async function sendToken(token: string): Promise<void> {
  try { storage()?.setItem(PUSH_TOKEN_KEY, token); } catch { /* 저장소가 막혀도 등록은 한다 */ }
  if (currentUserId == null) return; // 로그아웃 뒤 늦게 온 토큰
  const { default: api } = await import('@/lib/axios');
  await api.put('/push/tokens', { token, platform: 'android' }).catch(() => {});
}

/**
 * 로그아웃할 때 이 기기 토큰을 서버에서 지운다(authStore.logout 이 부른다). 로그인이 만료돼 자동 로그아웃(401)될 때도 지워져야 하므로
 * 인증을 붙이지 않는다 — 토큰 값 자체가 자격이다(추측할 수 없는 긴 값). 페이지가 바뀌어도 보내지도록 keepalive.
 */
export function forgetPushToken(): void {
  currentUserId = null;
  if (!isNativeApp()) return;
  const token = storage()?.getItem(PUSH_TOKEN_KEY);
  if (!token) return;
  try { storage()?.removeItem(PUSH_TOKEN_KEY); } catch { /* noop */ }
  try {
    void fetch('/api/push/tokens', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
      keepalive: true,
    }).catch(() => {});
  } catch { /* noop */ }
}

/** 로그인한 뒤 한 번 — 권한은 이 기기에서 처음 한 번만 묻는다(거절하면 다시 묻지 않는다. 설정에서 켜면 다음 실행 때 등록) */
export async function registerPush(userId: number): Promise<'registered' | 'no-push' | 'denied'> {
  currentUserId = userId;
  const info = await shellInfo();
  if (!info?.push) return 'no-push';
  const { PushNotifications } = await import('@capacitor/push-notifications');
  let perm = await PushNotifications.checkPermissions();
  if (perm.receive !== 'granted' && !storage()?.getItem(PUSH_ASKED_KEY)) {
    try { storage()?.setItem(PUSH_ASKED_KEY, '1'); } catch { /* noop */ }
    perm = await PushNotifications.requestPermissions();
  }
  if (perm.receive !== 'granted') return 'denied';
  await PushNotifications.register(); // 토큰은 'registration' 이벤트로 온다 → sendToken
  return 'registered';
}

/** 알림을 눌렀다 — 벨에서 누른 것과 같다(읽음 처리 + 그 화면으로). Navbar handleNotifClick 과 같은 일 */
export async function openNotification(data: Record<string, unknown> | undefined): Promise<void> {
  const id = Number(data?.notificationId);
  if (Number.isInteger(id) && id > 0 && currentUserId != null) {
    const { default: api } = await import('@/lib/axios');
    void api.patch(`/notifications/${id}/read`).then(() => {
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
      void queryClient.invalidateQueries({ queryKey: ['unread-count'] });
    }).catch(() => {});
  }
  // 그 화면에 있는 동안은 소개·홈페이지 팝업을 띄우지 않는다 — 알림을 보러 온 사람이다(lib/popupHold.ts)
  const path = appPathFor(typeof data?.linkUrl === 'string' ? data.linkUrl : '/');
  if (path) holdPopupsFor(path);
  openPath(path);
}

/**
 * 앱을 보고 있는데 알림이 왔다 — 안드로이드는 이때 알림 서랍에 띄우지 않는다. 벨 숫자·목록을 바로 고치고,
 * 그 화면을 보고 있지 않으면 카카오톡처럼 위쪽 배너를 띄운다(lib/pushBanner.ts). 대화방을 보고 있으면 그 방을 바로 다시 받는다
 * (8초 폴링을 기다리지 않게).
 */
export function onPushReceived(data: Record<string, unknown> | undefined, notice?: { title?: string; body?: string }): void {
  void queryClient.invalidateQueries({ queryKey: ['notifications'] });
  void queryClient.invalidateQueries({ queryKey: ['unread-count'] });
  if (data?.type === 'CHAT_MESSAGE') {
    void queryClient.invalidateQueries({ queryKey: ['chat-unread'] });
    void queryClient.invalidateQueries({ queryKey: ['chats'] });
    void queryClient.invalidateQueries({ queryKey: ['chat'] });
  }
  const here = { pathname: window.location.pathname, search: window.location.search };
  if (notice?.body && pushBannerWanted(data, here)) {
    showPushBanner({ title: notice.title || 'ArtLink', body: notice.body, data: data ?? {} });
  }
}

/** 공유 창으로 넘긴 지 이만큼 지난 파일만 지운다 */
export const EXPORT_KEEP_MS = 60 * 60 * 1000;

/**
 * 지난번에 공유 창으로 넘긴 파일들(exports/<만든 시각>/…)을 비운다 — 페이지를 열 때마다.
 * ⚠️ 통째로 지우지 말 것: 페이지는 앱 시작 말고도 새로고침된다(새 버전 적용 등). 공유 창에서 카카오톡을 고르면 그 앱이 파일을
 *    **나중에** 읽어 가는데, 그사이 새로고침돼 지우면 보낸 파일이 비어 있다. 한 시간 지난 것만.
 */
export async function cleanOldExports(now: number = Date.now()): Promise<void> {
  try {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    const { files } = await Filesystem.readdir({ path: EXPORT_DIR, directory: Directory.Cache });
    for (const f of files) {
      const made = Number(f.name);
      if (!Number.isFinite(made) || now - made > EXPORT_KEEP_MS) {
        await Filesystem.rmdir({ path: `${EXPORT_DIR}/${f.name}`, directory: Directory.Cache, recursive: true }).catch(() => {});
      }
    }
  } catch { /* 폴더가 없다(처음) — 지울 게 없다 */ }
}

// ─── 시작 ───

let started = false;

async function start(): Promise<void> {
  const { App } = await import('@capacitor/app');
  import('@capacitor/splash-screen').then(({ SplashScreen }) => SplashScreen.hide()).catch(() => {});
  void cleanOldExports();

  await App.addListener('backButton', ({ canGoBack }) => {
    handleBackButton(canGoBack, () => { void App.minimizeApp(); });
  });
  // 앱을 링크로 켰을 때도 이 이벤트가 온다(네이티브가 보관했다가 리스너가 붙는 순간 전달) — getLaunchUrl 까지 쓰면 두 번 이동한다
  await App.addListener('appUrlOpen', ({ url }) => openPath(url));

  const info = await shellInfo();
  if (!info?.push) return;
  const { PushNotifications } = await import('@capacitor/push-notifications');
  await PushNotifications.createChannel({
    id: PUSH_CHANNEL,
    name: '아트링크 알림',
    description: '문의 답변·지원 결과·메시지 등 벨 알림',
    importance: 4,
    visibility: 1,
    // 카카오톡처럼 진동도 — ⚠️ 채널 설정은 한 번 만들어지면 앱이 못 바꾼다(안드로이드 규칙). 출시 뒤에 바꾸려면 채널 id 를 새로 써야 한다
    vibration: true,
  }).catch(() => {});
  await PushNotifications.addListener('registration', ({ value }) => { void sendToken(value); });
  await PushNotifications.addListener('pushNotificationReceived', (n) => onPushReceived(n.data, { title: n.title, body: n.body }));
  // 앱이 꺼져 있다 알림으로 켜진 경우도 이 이벤트다(보관됐다가 전달) — 리스너를 일찍 붙여야 한다
  await PushNotifications.addListener('pushNotificationActionPerformed', (a) => { void openNotification(a.notification?.data); });
}

/**
 * App.tsx 맨 위(라우터 안)에서 한 번. 브라우저에서는 아무것도 하지 않는다.
 * 리스너는 **페이지당 한 번만** 붙이고 떼지 않는다 — 개발 모드(StrictMode)가 effect 를 두 번 돌릴 때 붙였다 떼면,
 * 네이티브가 보관해 둔 첫 이벤트(링크·알림으로 켠 앱)가 떼어지는 쪽으로 가서 사라진다.
 */
export function useNativeBridge(userId: number | null): void {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  // 알림이 데려간 화면에 닿았는지·떠났는지(lib/popupHold.ts) — 웹에서는 hold 가 걸리지 않아 아무 일도 없다
  useEffect(() => { notePopupHoldPath(pathname); }, [pathname]);

  useEffect(() => {
    if (!isNativeApp()) return;
    navigateTo = (path) => navigate(path);
    while (pendingPaths.length) navigate(pendingPaths.shift()!);
    return () => { navigateTo = null; };
  }, [navigate]);

  useEffect(() => {
    if (!isNativeApp() || started) return;
    started = true;
    start().catch(() => {});
  }, []);

  useEffect(() => {
    if (!isNativeApp()) return;
    if (userId == null) { currentUserId = null; return; }
    registerPush(userId).catch(() => {});
  }, [userId]);
}

/** 테스트 전용 — 모듈 상태를 처음으로 */
export function __resetNativeForTests(): void {
  shellPromise = null;
  infoPromise = null;
  navigateTo = null;
  pendingPaths.length = 0;
  currentUserId = null;
  started = false;
}
