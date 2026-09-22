/**
 * 작품 사진의 실제 픽셀 크기를 읽는다 (2026-09-16).
 *
 * 왜 저장하는가 — 정렬 격자·PDF 배치·ArtLook 이 전부 **비율**을 먼저 알아야 한다. 지금까지는 화면이
 * 사진을 다 받은 뒤 `naturalWidth` 로 쟀는데, 그러면 첫 화면이 정사각으로 뜬 뒤 다시 줄이 바뀐다(튄다).
 * 업로드 때 한 번 재서 `PortfolioImage.width/height` 에 넣어 두면 화면이 처음부터 제 모양으로 뜬다.
 *
 * - `/uploads/...` 는 디스크에서, R2 공개 주소는 받아서 잰다(4초 상한 — 업로드 응답을 오래 붙잡지 않는다).
 * - EXIF 회전(orientation 5~8)이 있으면 가로·세로를 바꿔 준다 — 안 그러면 폰 세로 사진이 가로로 기록된다.
 * - 실패하면 null. **업로드를 막지 않는다** — 크기는 없어도 화면이 로드 후 재는 폴백이 있다.
 */
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { matchR2Base } from './r2Urls';

const UPLOADS_DIR = path.join(__dirname, '../../uploads');
const FETCH_TIMEOUT_MS = 4000;

export interface ImageDims { width: number; height: number }

async function loadBytes(url: string, timeoutMs: number): Promise<Buffer | null> {
  if (url.startsWith('/uploads/')) {
    const safe = path.basename(url.slice('/uploads/'.length));
    if (!safe) return null;
    return fs.promises.readFile(path.join(UPLOADS_DIR, safe)).catch(() => null);
  }
  if (matchR2Base(url)) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch(url, { signal: ctrl.signal });
      if (!r.ok) return null;
      return Buffer.from(await r.arrayBuffer());
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

/** 바이트에서 크기 — 테스트·백필이 직접 쓴다 */
export async function dimsFromBuffer(buf: Buffer): Promise<ImageDims | null> {
  try {
    const m = await sharp(buf).metadata();
    if (!m.width || !m.height) return null;
    const swap = (m.orientation ?? 1) >= 5;
    return swap ? { width: m.height, height: m.width } : { width: m.width, height: m.height };
  } catch {
    return null;
  }
}

/**
 * `timeoutMs` 기본 4초는 **업로드 응답용**이다. 백필처럼 응답을 기다리는 사람이 없는 자리에서는 넉넉히 줄 것 —
 * 2026-09-22 실서버 백필 451장 중 37장이 이 4초에 걸려 실패했다(R2 에서 600KB 한 장이 8초 걸리는 때가 있다. 파일은 전부 멀쩡했다).
 */
export async function readImageDims(url: string, timeoutMs: number = FETCH_TIMEOUT_MS): Promise<ImageDims | null> {
  const buf = await loadBytes(url, timeoutMs);
  return buf ? dimsFromBuffer(buf) : null;
}
