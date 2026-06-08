/**
 * 작품 캡션 → HWP(한글) 생성 (서버 사이드, 리눅스 네이티브)
 *
 * 전략: 원본 .hwp 템플릿(이미 한글에서 열리는 정상 파일)을 베이스로, CFB 컨테이너는
 * 그대로 두고 BodyText/Section0(본문) 안의 표 셀 텍스트만 교체한다.
 *  - 채우는 칸: 가변 길이 (PARA_TEXT 크기 + PARA_HEADER 글자수 갱신)
 *  - 빈 칸: 원본과 같은 글자 수의 공백으로 (급격한 길이 축소 시 한글이 문서를 거부함)
 * 압축 스트림은 유효 deflate 빈 블록으로 패딩해 정확한 길이로 만들고, Section0 섹터를
 * 제자리에서 덮어쓴 뒤 디렉터리의 스트림 크기만 갱신한다. (cfb 라이브러리 미사용 — 부가
 * 스트림이 끼면 한글이 거부)
 *
 * 양식(galleryM 캡션 양식)은 96칸(4표×24)이며, 한 칸 = 제목/크기/재료/(년도+가격).
 * 출품작 수만큼 채우고 나머지는 빈 칸으로 둔다. 최대 96작품 지원.
 */
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

export interface CaptionWork { title?: string; size?: string; medium?: string; year?: string; price?: string }

const TEMPLATE_PATH = path.resolve(__dirname, '../../assets/caption-template.hwp');
const ENDOFCHAIN = 0xfffffffe;
const FREESECT = 0xffffffff;

export const CAPTION_CELL_CAPACITY = 96;

// ── 최소 CFB 파서 ──
interface Cfb { buf: Buffer; sectorSize: number; fat: number[]; firstDir: number }

function parseCfb(buf: Buffer): Cfb {
  const sectorSize = 1 << buf.readUInt16LE(0x1e); // 보통 512
  const numFatSectors = buf.readUInt32LE(0x2c);
  const firstDir = buf.readUInt32LE(0x30);
  // DIFAT: 헤더 내 109개 + (필요 시) DIFAT 체인. 템플릿은 작아 109개로 충분.
  const fatSectorLocs: number[] = [];
  for (let i = 0; i < 109; i++) {
    const loc = buf.readUInt32LE(0x4c + i * 4);
    if (loc === FREESECT || loc === ENDOFCHAIN) break;
    fatSectorLocs.push(loc);
  }
  // DIFAT 체인 확장(큰 파일 대비)
  let difatSect = buf.readUInt32LE(0x44);
  const numDifat = buf.readUInt32LE(0x48);
  for (let n = 0; n < numDifat && difatSect !== ENDOFCHAIN && difatSect !== FREESECT; n++) {
    const base = (difatSect + 1) * sectorSize;
    const cnt = sectorSize / 4 - 1;
    for (let i = 0; i < cnt; i++) {
      const loc = buf.readUInt32LE(base + i * 4);
      if (loc !== FREESECT && loc !== ENDOFCHAIN) fatSectorLocs.push(loc);
    }
    difatSect = buf.readUInt32LE(base + cnt * 4);
  }
  // FAT 구성
  const fat: number[] = [];
  for (const loc of fatSectorLocs.slice(0, numFatSectors || fatSectorLocs.length)) {
    const base = (loc + 1) * sectorSize;
    for (let i = 0; i < sectorSize / 4; i++) fat.push(buf.readUInt32LE(base + i * 4));
  }
  return { buf, sectorSize, fat, firstDir };
}

function sectorOffset(cfb: Cfb, sector: number): number {
  return (sector + 1) * cfb.sectorSize;
}

function chainOf(cfb: Cfb, start: number): number[] {
  const out: number[] = [];
  let s = start;
  while (s !== ENDOFCHAIN && s !== FREESECT && s < cfb.fat.length) { out.push(s); s = cfb.fat[s]; }
  return out;
}

// 디렉터리에서 이름으로 엔트리(절대 오프셋) 찾기
function findDirEntry(cfb: Cfb, name: string): { offset: number; startSector: number; size: number } | null {
  for (const ds of chainOf(cfb, cfb.firstDir)) {
    const base = sectorOffset(cfb, ds);
    for (let e = 0; e < cfb.sectorSize / 128; e++) {
      const eo = base + e * 128;
      const nameLen = cfb.buf.readUInt16LE(eo + 0x40);
      if (nameLen < 2) continue;
      const nm = cfb.buf.toString('utf16le', eo, eo + nameLen - 2);
      if (nm === name) {
        return { offset: eo, startSector: cfb.buf.readUInt32LE(eo + 0x74), size: cfb.buf.readUInt32LE(eo + 0x78) };
      }
    }
  }
  return null;
}

// ── HWP 레코드 ──
interface Rec { tag: number; level: number; bodyOff: number; size: number }

function parseRecords(dec: Buffer): Rec[] {
  const recs: Rec[] = [];
  let i = 0;
  while (i + 4 <= dec.length) {
    const h = dec.readUInt32LE(i);
    const tag = h & 0x3ff, level = (h >> 10) & 0x3ff;
    let size = (h >> 20) & 0xfff, hs = 4;
    if (size === 0xfff) { size = dec.readUInt32LE(i + 4); hs = 8; }
    recs.push({ tag, level, bodyOff: i + hs, size });
    i += hs + size;
  }
  return recs;
}

const TAG_PARA_HEADER = 66, TAG_PARA_TEXT = 67, TAG_LIST_HEADER = 72;

// 출품작 한 칸의 4줄(제목/크기/재료/년도+가격)
function fieldText(work: CaptionWork, f: number): string {
  if (f === 0) return (work.title || '').toString();
  if (f === 1) return (work.size || '').toString();
  if (f === 2) return (work.medium || '').toString();
  const y = (work.year || '').toString();
  const p = (work.price || '').toString();
  return p ? `${y}                  ${p}` : y;
}

// 본문(편집된 레코드 스트림) 생성
function buildBody(dec: Buffer, works: CaptionWork[]): Buffer {
  const recs = parseRecords(dec);
  // 셀(LIST_HEADER) 기준 그룹화: 각 셀 첫 4개 PARA_TEXT
  const cells: number[][] = [];
  let cur: number[] | null = null, lastHeader = -1;
  const headerOf = new Map<number, number>();
  for (let idx = 0; idx < recs.length; idx++) {
    const r = recs[idx];
    if (r.tag === TAG_PARA_HEADER) lastHeader = idx;
    if (r.tag === TAG_LIST_HEADER) { cur = []; cells.push(cur); }
    if (r.tag === TAG_PARA_TEXT && cur && cur.length < 4) { cur.push(idx); headerOf.set(idx, lastHeader); }
  }
  const valid = cells.filter(c => c.length === 4);

  const newBody = new Map<number, Buffer>();
  const newNChars = new Map<number, number>();
  valid.forEach((cell, k) => {
    cell.forEach((ti, f) => {
      const r = recs[ti];
      const body = dec.subarray(r.bodyOff, r.bodyOff + r.size);
      // 앞쪽 공백(0x20) / 뒤쪽 제어문자 보존, 가운데만 교체
      let lead = 0;
      while (lead + 2 <= body.length && body.readUInt16LE(lead) === 0x20) lead += 2;
      let tail = body.length;
      while (tail - 2 >= 0 && body.readUInt16LE(tail - 2) < 0x20) tail -= 2;
      if (k < works.length) {
        // 채움: 가변 길이
        const mid = Buffer.from(fieldText(works[k], f), 'utf16le');
        const nb = Buffer.concat([body.subarray(0, lead), mid, body.subarray(tail)]);
        newBody.set(ti, nb);
        const h = headerOf.get(ti);
        if (h !== undefined && h >= 0) newNChars.set(h, nb.length / 2);
      } else {
        // 빈 칸: 원본과 같은 글자 수의 공백 (길이 변화 없음 → 안전)
        const midCap = (tail - lead) / 2;
        const mid = Buffer.from(' '.repeat(midCap), 'utf16le');
        newBody.set(ti, Buffer.concat([body.subarray(0, lead), mid, body.subarray(tail)]));
      }
    });
  });

  const out: Buffer[] = [];
  for (let idx = 0; idx < recs.length; idx++) {
    const r = recs[idx];
    let body = newBody.get(idx) ?? dec.subarray(r.bodyOff, r.bodyOff + r.size);
    if (r.tag === TAG_PARA_HEADER && newNChars.has(idx)) {
      body = Buffer.from(body);
      const orig = body.readUInt32LE(0);
      body.writeUInt32LE(((orig & 0x80000000) | (newNChars.get(idx)! & 0x7fffffff)) >>> 0, 0);
    }
    const size = body.length;
    if (size >= 0xfff) {
      const hdr = Buffer.alloc(8);
      hdr.writeUInt32LE(((r.tag & 0x3ff) | ((r.level & 0x3ff) << 10) | (0xfff << 20)) >>> 0, 0);
      hdr.writeUInt32LE(size, 4); out.push(hdr, body);
    } else {
      const hdr = Buffer.alloc(4);
      hdr.writeUInt32LE(((r.tag & 0x3ff) | ((r.level & 0x3ff) << 10) | (size << 20)) >>> 0, 0);
      out.push(hdr, body);
    }
  }
  return Buffer.concat(out);
}

// raw deflate + Z_SYNC_FLUSH (미종료 스트림) → 수동 빈 저장블록으로 길이 패딩 가능
function deflateRawSyncFlush(data: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const z = zlib.createDeflateRaw({ level: 9 });
    const parts: Buffer[] = [];
    z.on('data', d => parts.push(d));
    z.on('error', reject);
    z.write(data, () => {
      z.flush(zlib.constants.Z_SYNC_FLUSH, () => resolve(Buffer.concat(parts)));
    });
  });
}

const EMPTY_BLOCK = Buffer.from([0x00, 0x00, 0x00, 0xff, 0xff]);   // 비종료 빈 저장블록
const FINAL_BLOCK = Buffer.from([0x01, 0x00, 0x00, 0xff, 0xff]);   // 종료 빈 저장블록

/** 출품작 목록으로 캡션 HWP Buffer 생성 (최대 96작품) */
export async function buildCaptionHwp(works: CaptionWork[]): Promise<Buffer> {
  const raw = Buffer.from(fs.readFileSync(TEMPLATE_PATH)); // 가변 복사본
  const cfb = parseCfb(raw);
  const sec = findDirEntry(cfb, 'Section0');
  if (!sec) throw new Error('caption template: Section0 not found');
  const chain = chainOf(cfb, sec.startSector);
  const capacity = chain.length * cfb.sectorSize;

  // 본문 압축 해제 → 편집 → 재구성
  const compOrig = Buffer.alloc(sec.size);
  for (let n = 0; n < chain.length; n++) {
    cfb.buf.copy(compOrig, n * cfb.sectorSize, sectorOffset(cfb, chain[n]), sectorOffset(cfb, chain[n]) + cfb.sectorSize);
  }
  const dec = zlib.inflateRawSync(compOrig.subarray(0, sec.size));
  const newDec = buildBody(dec, works.slice(0, CAPTION_CELL_CAPACITY));

  // 재압축 + 유효 deflate 빈 블록 패딩(미니스트림 경계 4096 위, 체인 용량 이하, 정확 종료)
  const partial = await deflateRawSyncFlush(newDec); // 데이터 + sync flush, 바이트정렬, 미종료
  const TARGET = Math.min(Math.max(partial.length + FINAL_BLOCK.length, 4608), capacity);
  const padCount = Math.max(0, Math.floor((TARGET - partial.length - FINAL_BLOCK.length) / EMPTY_BLOCK.length));
  const comp = Buffer.concat([partial, ...Array(padCount).fill(EMPTY_BLOCK), FINAL_BLOCK]);
  if (comp.length > capacity) throw new Error(`caption: 압축 결과(${comp.length})가 템플릿 용량(${capacity}) 초과 — 출품작이 너무 많거나 깁니다.`);
  // 무결성 확인
  if (!zlib.inflateRawSync(comp).equals(newDec)) throw new Error('caption: 재압축 검증 실패');

  // 체인 섹터에 기록(나머지 0) + 디렉터리 스트림 크기 갱신
  const padded = Buffer.concat([comp, Buffer.alloc(capacity - comp.length)]);
  for (let n = 0; n < chain.length; n++) {
    padded.copy(cfb.buf, sectorOffset(cfb, chain[n]), n * cfb.sectorSize, (n + 1) * cfb.sectorSize);
  }
  cfb.buf.writeUInt32LE(comp.length, sec.offset + 0x78);
  cfb.buf.writeUInt32LE(0, sec.offset + 0x7c);
  return cfb.buf;
}
