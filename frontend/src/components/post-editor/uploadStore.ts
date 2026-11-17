import { useSyncExternalStore } from 'react';
import api from '@/lib/axios';
import { compressImage } from '@/lib/utils';
import { POST_VIDEO_MAX_BYTES } from '@/lib/postDoc';

/**
 * 글쓰기 화면의 사진 올리기 줄 (2026-11-13) — 편집기 밖의 작은 저장소(useSyncExternalStore).
 *
 * - 사진 노드는 올리는 동안 `uploadId` 만 들고 있고(src 없음), 화면은 여기서 미리보기(blob)와 진행률을 읽는다.
 *   ⚠️ blob 주소를 문서에 넣지 않는다 — 저장·기기 보관에 실리면 새로고침 뒤 죽은 주소가 된다.
 * - **한 번에 2장씩**(서버는 3장까지 동시에 받고 30장 넘게 밀리면 503 — routes/upload.ts uploadSlot). 다 올리면 결과를 기억해 둔다
 *   (되돌리기·다시 실행으로 노드가 다시 나타나면 그 결과로 채운다).
 * - 503·인터넷 끊김은 2·5·15초 뒤 저절로 다시, 그래도 안 되면 '실패' — 사진 위에 [다시]·[지우기].
 * - HEIC·15MB 초과·사진 아님은 올리지 않고 바로 실패(이유를 적는다).
 * - 동영상(2026-11-13)도 같은 줄을 탄다 — 압축 없이 `/upload/post-video`(25MB, 서버 상한과 같다). 치수는 미리보기에서 잰 값을 싣는다.
 */
export type UploadStatus = 'queued' | 'uploading' | 'done' | 'error';
export type UploadKind = 'image' | 'video';
export interface UploadResult { url: string; width: number | null; height: number | null }
export interface UploadEntry {
  id: string;
  kind: UploadKind;
  status: UploadStatus;
  progress: number;
  previewUrl: string;
  /** 미리보기 비율(올리기 전 화면에서 잰 것) — 자리를 먼저 잡는다 */
  width: number | null;
  height: number | null;
  result?: UploadResult;
  error?: string;
  file: File;
  attempts: number;
}

const MAX_BYTES = 15 * 1024 * 1024;
const CONCURRENCY = 2;
const AUTO_RETRY_MS = [2000, 5000, 15000];

const entries = new Map<string, UploadEntry>();
const listeners = new Set<() => void>();
let version = 0;
let active = 0;
const queue: string[] = [];
/** 다 올라간 것을 알릴 곳(편집기가 노드를 채운다) */
const doneListeners = new Set<(e: UploadEntry) => void>();

function emit() {
  version += 1;
  listeners.forEach((fn) => { try { fn(); } catch { /* 화면 쪽 오류가 줄을 멈추지 않게 */ } });
}
function patch(id: string, p: Partial<UploadEntry>) {
  const cur = entries.get(id);
  if (!cur) return;
  entries.set(id, { ...cur, ...p });
  emit();
}

export function subscribeUploads(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
export function onUploadDone(fn: (e: UploadEntry) => void): () => void {
  doneListeners.add(fn);
  return () => { doneListeners.delete(fn); };
}
export function getUpload(id: string | null | undefined): UploadEntry | undefined {
  return id ? entries.get(id) : undefined;
}
/** 사진 노드가 자기 올리기 상태를 읽는다 */
export function useUpload(id: string | null | undefined): UploadEntry | undefined {
  useSyncExternalStore(subscribeUploads, () => version, () => version);
  return getUpload(id);
}
export function activeUploadCount(): number {
  let n = 0;
  entries.forEach((e) => { if (e.status === 'queued' || e.status === 'uploading') n++; });
  return n;
}
export function useActiveUploadCount(): number {
  useSyncExternalStore(subscribeUploads, () => version, () => version);
  return activeUploadCount();
}

function isHeic(f: File): boolean {
  return /image\/hei[cf]/i.test(f.type) || /\.hei[cf]$/i.test(f.name);
}

/** 고른 파일이 사진으로 올릴 수 있는가 — 안 되면 이유 */
export function fileProblem(f: File): string | null {
  if (isHeic(f)) return 'HEIC 사진은 올릴 수 없어요. JPG 로 바꿔 올려 주세요.';
  if (!/^image\/(jpeg|png|gif|webp)$/i.test(f.type) && !/\.(jpe?g|png|gif|webp)$/i.test(f.name)) return '사진 파일(JPG·PNG·GIF·WEBP)만 올릴 수 있어요.';
  return null;
}

/** 고른 파일이 동영상으로 올릴 수 있는가 — 형식은 서버(routes/upload.ts allowedVideoMimes)와 같다 */
export function videoProblem(f: File): string | null {
  if (!/^video\/(mp4|webm|ogg|quicktime)$/i.test(f.type) && !/\.(mp4|webm|ogg|mov|m4v)$/i.test(f.name)) return '동영상 파일(MP4·MOV·WEBM)만 올릴 수 있어요.';
  if (f.size > POST_VIDEO_MAX_BYTES) return `동영상은 ${Math.round(POST_VIDEO_MAX_BYTES / 1024 / 1024)}MB 까지 올릴 수 있어요. 휴대폰에서 짧게 잘라 올려 주세요.`;
  return null;
}
const problemOf = (kind: UploadKind, f: File) => (kind === 'video' ? videoProblem(f) : fileProblem(f));

/** 미리보기 비율 — 읽지 못하면 null(자리는 4:3 · 동영상은 16:9 으로) */
function measure(url: string, kind: UploadKind): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    if (kind === 'video') {
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.muted = true;
      v.onloadedmetadata = () => resolve(v.videoWidth ? { width: v.videoWidth, height: v.videoHeight } : null);
      v.onerror = () => resolve(null);
      v.src = url;
      return;
    }
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth ? { width: img.naturalWidth, height: img.naturalHeight } : null);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

let seq = 0;
/** 파일 하나를 줄에 세운다 — 바로 돌려받은 id 로 노드를 만든다 */
export function enqueueUpload(file: File, kind: UploadKind = 'image'): string {
  seq += 1;
  const id = `up-${Date.now().toString(36)}-${seq}`;
  const previewUrl = URL.createObjectURL(file);
  const problem = problemOf(kind, file);
  entries.set(id, { id, kind, status: problem ? 'error' : 'queued', progress: 0, previewUrl, width: null, height: null, error: problem ?? undefined, file, attempts: 0 });
  emit();
  void measure(previewUrl, kind).then((d) => { if (d) patch(id, d); });
  if (!problem) { queue.push(id); pump(); }
  return id;
}

export function retryUpload(id: string): void {
  const e = entries.get(id);
  if (!e || (e.status !== 'error')) return;
  if (problemOf(e.kind, e.file)) return;
  patch(id, { status: 'queued', progress: 0, error: undefined, attempts: 0 });
  queue.push(id);
  pump();
}

/** 노드를 지우면 줄에서도 뺀다(올리는 중이면 끝까지 가되 결과를 쓰지 않는다) */
export function forgetUpload(id: string): void {
  const i = queue.indexOf(id);
  if (i >= 0) queue.splice(i, 1);
  const e = entries.get(id);
  if (e && e.status !== 'uploading') {
    URL.revokeObjectURL(e.previewUrl);
    entries.delete(id);
    emit();
  }
}

/** 화면을 떠날 때 — 미리보기 주소를 돌려준다 */
export function resetUploads(): void {
  queue.length = 0;
  entries.forEach((e) => URL.revokeObjectURL(e.previewUrl));
  entries.clear();
  emit();
}

function pump() {
  while (active < CONCURRENCY && queue.length) {
    const id = queue.shift()!;
    const e = entries.get(id);
    if (!e || e.status !== 'queued') continue;
    active += 1;
    void send(id).finally(() => { active -= 1; pump(); });
  }
}

async function send(id: string): Promise<void> {
  const e = entries.get(id);
  if (!e) return;
  patch(id, { status: 'uploading', progress: 0.02, attempts: e.attempts + 1 });
  if (e.kind === 'video') return sendVideo(id, e);
  try {
    const file = await compressImage(e.file);
    if (file.size > MAX_BYTES) {
      patch(id, { status: 'error', error: '사진이 너무 커요(15MB 까지).' });
      return;
    }
    const form = new FormData();
    form.append('image', file);
    const { data } = await api.post<UploadResult>('/upload/post-image', form, {
      timeout: 120_000,
      skipAuthLogout: true,
      onUploadProgress: (p) => { if (p.total) patch(id, { progress: Math.min(0.97, p.loaded / p.total) }); },
    });
    patch(id, { status: 'done', progress: 1, result: { url: data.url, width: data.width ?? null, height: data.height ?? null } });
    const done = entries.get(id);
    if (done) doneListeners.forEach((fn) => { try { fn(done); } catch { /* 편집기 쪽 오류 */ } });
  } catch (err: unknown) {
    const res = (err as { response?: { status?: number; data?: { error?: string } } })?.response;
    const status = res?.status;
    const attempts = entries.get(id)?.attempts ?? 1;
    // 몰림(503)·끊김(응답 없음)·시간 초과는 저절로 다시
    if ((status === 503 || status === 429 || !res) && attempts <= AUTO_RETRY_MS.length) {
      patch(id, { status: 'queued', progress: 0 });
      setTimeout(() => { if (entries.get(id)?.status === 'queued') { queue.push(id); pump(); } }, AUTO_RETRY_MS[attempts - 1]);
      return;
    }
    const msg = status === 401 ? '로그인이 풀렸어요. 다시 로그인한 뒤 [다시]를 눌러 주세요.'
      : status === 413 ? '사진이 너무 커요(15MB 까지).'
      : res?.data?.error || '사진을 올리지 못했어요.';
    patch(id, { status: 'error', error: msg });
  }
}

/** 동영상 — 압축 없이 그대로. 치수는 미리보기에서 잰 값(서버는 영상을 열지 않는다) */
async function sendVideo(id: string, e: UploadEntry): Promise<void> {
  try {
    const form = new FormData();
    form.append('video', e.file);
    const { data } = await api.post<{ url: string }>('/upload/post-video', form, {
      timeout: 300_000,
      skipAuthLogout: true,
      onUploadProgress: (p) => { if (p.total) patch(id, { progress: Math.min(0.97, p.loaded / p.total) }); },
    });
    const cur = entries.get(id);
    patch(id, { status: 'done', progress: 1, result: { url: data.url, width: cur?.width ?? null, height: cur?.height ?? null } });
    const done = entries.get(id);
    if (done) doneListeners.forEach((fn) => { try { fn(done); } catch { /* 편집기 쪽 오류 */ } });
  } catch (err: unknown) {
    const res = (err as { response?: { status?: number; data?: { error?: string } } })?.response;
    const status = res?.status;
    const attempts = entries.get(id)?.attempts ?? 1;
    if ((status === 503 || status === 429 || !res) && attempts <= AUTO_RETRY_MS.length) {
      patch(id, { status: 'queued', progress: 0 });
      setTimeout(() => { if (entries.get(id)?.status === 'queued') { queue.push(id); pump(); } }, AUTO_RETRY_MS[attempts - 1]);
      return;
    }
    const msg = status === 401 ? '로그인이 풀렸어요. 다시 로그인한 뒤 [다시]를 눌러 주세요.'
      : status === 413 ? `동영상이 너무 커요(${Math.round(POST_VIDEO_MAX_BYTES / 1024 / 1024)}MB 까지).`
      : res?.data?.error || '동영상을 올리지 못했어요.';
    patch(id, { status: 'error', error: msg });
  }
}
