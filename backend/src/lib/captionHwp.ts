/**
 * 작품 캡션 → HWP(한글) 생성 (서버 사이드, 리눅스 네이티브)
 *
 * 전략: 원본 .hwp 템플릿(이미 한글에서 열리는 정상 파일)을 베이스로, CFB 컨테이너 구조는
 * 유지하면서 BodyText/Section0(본문) 레코드 스트림만 재구성한다.
 *  - 페이지(표) 단위 복제/삭제로 **출품작 수에 맞춰 페이지 수를 적응형으로** 만든다.
 *  - 채우는 칸: 가변 길이 (PARA_TEXT 크기 + PARA_HEADER 글자수 갱신)
 *  - 빈 칸: 원본과 같은 글자 수의 공백으로 (급격한 길이 축소 시 한글이 문서를 거부함)
 * 압축 스트림은 유효 deflate 빈 블록으로 패딩해 정확한 길이로 만들고, Section0 섹터를
 * 제자리에서 덮어쓴다. 압축 결과가 기존 체인 용량을 넘으면 파일 끝에 섹터를 덧붙이고
 * FAT 체인을 연장한다. (cfb 라이브러리 미사용 — 부가 스트림이 끼면 한글이 거부)
 *
 * 템플릿(galleryM 캡션 양식): 한 페이지 = 표 1개(8행×3열=24칸), 총 4페이지=96칸.
 * 한 칸 = 제목/크기/재료/(년도+가격).
 *
 * ── 페이지 단위 복제 시 조정해야 하는 필드 (템플릿 4개 페이지 비교로 확인) ──
 *  1) 표 CTRL_HEADER offset 24 (UINT32): 개체 서수(0,1,2,3…) — 페이지마다 증가
 *  2) 표 CTRL_HEADER offset 36 (UINT32): 개체 instance id — 페이지마다 유일해야 함
 *  3) 최상위(level 0) PARA_HEADER 글자수 필드의 MSB(0x80000000): "마지막 문단" 표시.
 *     문서 전체에서 **마지막 페이지 문단 1개만** 설정 (셀 문단도 각 셀의 4번째만 설정 — 원본 유지)
 *  그 외(TABLE 38B, CTRL_DATA 120B, 셀 LIST_HEADER 등)는 페이지 간 동일해 그대로 복제한다.
 *
 * 개발자 가이드:
 *  - 페이지 수 계산: buildCaptionHwp() 의 pageCount = ceil(작품수 / cellsPerPage)
 *  - 페이지 복제 원본: 표만 든 "평범한" 페이지(구역 정의를 품은 1페이지는 항상 그대로 유지)
 *  - 용량 한계: FAT 여유 엔트리까지 (초과 시 명확한 에러) — CAPTION_MAX_WORKS 참고
 */
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

export interface CaptionWork { title?: string; size?: string; medium?: string; year?: string; price?: string }

const TEMPLATE_PATH = path.resolve(__dirname, '../../assets/caption-template.hwp');
const ENDOFCHAIN = 0xfffffffe;
const FREESECT = 0xffffffff;

/** 템플릿 한 페이지(표 1개)의 칸 수 — 8행×3열 */
export const CAPTION_CELLS_PER_PAGE = 24;
/** 안전 상한: 이보다 많으면 400으로 안내 (FAT 여유 섹터 기준 실측값보다 보수적) */
export const CAPTION_MAX_WORKS = 1200;

// ── 최소 CFB 파서 ──
interface Cfb { buf: Buffer; sectorSize: number; fat: number[]; firstDir: number; fatSectorLocs: number[] }

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
  const locs = fatSectorLocs.slice(0, numFatSectors || fatSectorLocs.length);
  const fat: number[] = [];
  for (const loc of locs) {
    const base = (loc + 1) * sectorSize;
    for (let i = 0; i < sectorSize / 4; i++) fat.push(buf.readUInt32LE(base + i * 4));
  }
  return { buf, sectorSize, fat, firstDir, fatSectorLocs: locs };
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

/** FAT 엔트리 값을 파일 버퍼에 기록 */
function writeFat(cfb: Cfb, entry: number, value: number): void {
  const perSector = cfb.sectorSize / 4;
  const loc = cfb.fatSectorLocs[Math.floor(entry / perSector)];
  if (loc === undefined) throw new Error(`caption: FAT 엔트리 ${entry}를 담을 FAT 섹터가 없습니다.`);
  cfb.buf.writeUInt32LE(value >>> 0, sectorOffset(cfb, loc) + (entry % perSector) * 4);
  cfb.fat[entry] = value >>> 0;
}

// ── HWP 레코드 ──
interface Rec { tag: number; level: number; bodyOff: number; size: number }
/** 재구성용 레코드 (body는 독립 Buffer) */
interface OutRec { tag: number; level: number; body: Buffer }

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

function serializeRecords(recs: OutRec[]): Buffer {
  const out: Buffer[] = [];
  for (const r of recs) {
    const size = r.body.length;
    if (size >= 0xfff) {
      const hdr = Buffer.alloc(8);
      hdr.writeUInt32LE(((r.tag & 0x3ff) | ((r.level & 0x3ff) << 10) | (0xfff << 20)) >>> 0, 0);
      hdr.writeUInt32LE(size, 4);
      out.push(hdr, r.body);
    } else {
      const hdr = Buffer.alloc(4);
      hdr.writeUInt32LE(((r.tag & 0x3ff) | ((r.level & 0x3ff) << 10) | (size << 20)) >>> 0, 0);
      out.push(hdr, r.body);
    }
  }
  return Buffer.concat(out);
}

const TAG_PARA_HEADER = 66, TAG_PARA_TEXT = 67, TAG_PARA_CHAR_SHAPE = 68, TAG_CTRL_HEADER = 71, TAG_LIST_HEADER = 72;
// 표 컨트롤 ID 'tbl ' — 스트림에는 리틀엔디안으로 ' lbt' 로 들어있다
const TBL_CTRL_ID = ' lbt';
// 표 CTRL_HEADER 내 조정 대상 오프셋
const CTRL_ORDINAL_OFF = 24;   // 개체 서수
const CTRL_INSTANCE_OFF = 36;  // instance id (유일해야 함)

// 출품작 한 칸의 4줄(제목/크기/재료/년도+가격)
function fieldText(work: CaptionWork, f: number): string {
  if (f === 0) return (work.title || '').toString();
  if (f === 1) return (work.size || '').toString();
  if (f === 2) return (work.medium || '').toString();
  const y = (work.year || '').toString();
  const p = (work.price || '').toString();
  return p ? `${y}                  ${p}` : y;
}

/** 템플릿의 페이지(표 1개) 단위 경계 — [시작, 끝) 레코드 인덱스 */
function findPageUnits(dec: Buffer, recs: Rec[]): { start: number; end: number }[] {
  const tableCtrl: number[] = [];
  for (let i = 0; i < recs.length; i++) {
    if (recs[i].tag === TAG_CTRL_HEADER && recs[i].size >= 4
      && dec.toString('latin1', recs[i].bodyOff, recs[i].bodyOff + 4) === TBL_CTRL_ID) {
      tableCtrl.push(i);
    }
  }
  // 표를 담은 문단의 시작(직전 level 0 PARA_HEADER)
  const starts: number[] = [];
  for (const ci of tableCtrl) {
    let j = ci;
    while (j >= 0 && !(recs[j].tag === TAG_PARA_HEADER && recs[j].level === 0)) j--;
    if (j >= 0 && !starts.includes(j)) starts.push(j);
  }
  starts.sort((a, b) => a - b);
  return starts.map((s, k) => ({ start: s, end: k + 1 < starts.length ? starts[k + 1] : recs.length }));
}

const toOut = (dec: Buffer, recs: Rec[], from: number, to: number): OutRec[] =>
  recs.slice(from, to).map(r => ({ tag: r.tag, level: r.level, body: Buffer.from(dec.subarray(r.bodyOff, r.bodyOff + r.size)) }));

/** PARA_TEXT의 앞쪽 공백(0x20) 글자 수 */
function leadSpaces(text: Buffer): number {
  let lead = 0;
  while (lead + 2 <= text.length && text.readUInt16LE(lead) === 0x20) lead += 2;
  return lead / 2;
}

/**
 * 복제 원본으로 쓸 페이지가 안전한지 검사.
 * 템플릿 3페이지 18번 셀처럼 "제목 필드의 CHAR_SHAPE 런 경계 ≠ 앞쪽 공백 수"인 칸이 있으면
 * 텍스트를 교체할 때 제목 앞부분이 다른 서체로 쪼개진다 → 그런 페이지는 복제 원본에서 제외.
 */
function pageCellsAligned(dec: Buffer, recs: Rec[], unit: { start: number; end: number }): boolean {
  for (let i = unit.start; i < unit.end; i++) {
    if (recs[i].tag !== TAG_LIST_HEADER) continue;
    // 셀의 첫 문단(제목) PARA_TEXT + 그 뒤 PARA_CHAR_SHAPE
    let t = -1;
    for (let j = i + 1; j < unit.end && recs[j].tag !== TAG_LIST_HEADER; j++) {
      if (recs[j].tag === TAG_PARA_TEXT) { t = j; break; }
    }
    if (t < 0) continue;
    let cs = -1;
    for (let j = t + 1; j < unit.end && recs[j].tag !== TAG_PARA_TEXT; j++) {
      if (recs[j].tag === TAG_PARA_CHAR_SHAPE) { cs = j; break; }
    }
    if (cs < 0 || recs[cs].size < 16) continue; // 런이 1개면 경계 문제 없음
    const secondRunStart = dec.readUInt32LE(recs[cs].bodyOff + 8);
    if (secondRunStart !== leadSpaces(dec.subarray(recs[t].bodyOff, recs[t].bodyOff + recs[t].size))) return false;
  }
  return true;
}

/**
 * 본문 재구성: 출품작 수에 맞춰 페이지(표)를 늘리거나 줄이고, 칸 텍스트를 채운다.
 * 1페이지(구역 정의 보유)는 항상 유지하고, 2페이지부터는 "표만 든 페이지"를 복제한다.
 */
function buildBody(dec: Buffer, works: CaptionWork[]): { body: Buffer; pageCount: number; cellCount: number } {
  const recs = parseRecords(dec);
  const units = findPageUnits(dec, recs);
  if (units.length < 2) throw new Error('caption template: 페이지(표) 단위를 찾을 수 없습니다.');

  const cellsIn = (u: { start: number; end: number }) =>
    recs.slice(u.start, u.end).filter(r => r.tag === TAG_LIST_HEADER).length;
  const cellsPerPage = cellsIn(units[0]);
  if (cellsPerPage < 1) throw new Error('caption template: 표 칸을 찾을 수 없습니다.');

  // 복제 원본: 구역 정의가 없는(=2페이지 이후) 페이지 중 모든 칸의 CHAR_SHAPE 경계가
  // 정렬된 페이지. (템플릿 3페이지는 18번 셀이 어긋나 있어 제외됨 — pageCellsAligned 주석 참고)
  const plain = units.slice(1);
  const alignedIdx = plain.findIndex(u => pageCellsAligned(dec, recs, u));
  const archetype = units[1 + Math.max(0, alignedIdx)];

  const pageCount = Math.max(1, Math.ceil(works.length / cellsPerPage));

  // 표 CTRL_HEADER의 서수/instance id 기준값 (복제분에 증가값 부여)
  const ctrlOf = (u: { start: number; end: number }) =>
    recs.slice(u.start, u.end).find(r => r.tag === TAG_CTRL_HEADER && r.size >= 4
      && dec.toString('latin1', r.bodyOff, r.bodyOff + 4) === TBL_CTRL_ID)!;
  const archCtrl = ctrlOf(archetype);
  const archOrdinal = dec.readUInt32LE(archCtrl.bodyOff + CTRL_ORDINAL_OFF);
  const archInstance = dec.readUInt32LE(archCtrl.bodyOff + CTRL_INSTANCE_OFF);

  // 페이지 조립: 1페이지 원본 + (pageCount-1) × 복제
  const out: OutRec[] = toOut(dec, recs, units[0].start, units[0].end);
  for (let p = 1; p < pageCount; p++) {
    const clone = toOut(dec, recs, archetype.start, archetype.end);
    // 복제 표의 서수/instance id를 유일하게 조정
    const ci = clone.findIndex(r => r.tag === TAG_CTRL_HEADER && r.body.length >= 4
      && r.body.toString('latin1', 0, 4) === TBL_CTRL_ID);
    if (ci >= 0) {
      const b = clone[ci].body;
      if (b.length >= CTRL_ORDINAL_OFF + 4) b.writeUInt32LE(p, CTRL_ORDINAL_OFF);
      if (b.length >= CTRL_INSTANCE_OFF + 4) {
        b.writeUInt32LE(((archInstance + (p - archOrdinal)) >>> 0), CTRL_INSTANCE_OFF);
      }
    }
    out.push(...clone);
  }

  // ── 칸 텍스트 채우기 (전 페이지 통틀어 순서대로) ──
  const cells: number[][] = [];
  let cur: number[] | null = null, lastHeader = -1;
  const headerOf = new Map<number, number>();
  const charShapeOf = new Map<number, number>();
  for (let idx = 0; idx < out.length; idx++) {
    const r = out[idx];
    if (r.tag === TAG_PARA_HEADER) lastHeader = idx;
    if (r.tag === TAG_LIST_HEADER) { cur = []; cells.push(cur); }
    if (r.tag === TAG_PARA_TEXT && cur && cur.length < 4) { cur.push(idx); headerOf.set(idx, lastHeader); }
    // 직전 PARA_TEXT의 서체 런 레코드 (텍스트 길이 변화 시 범위 밖 런 정리용)
    if (r.tag === TAG_PARA_CHAR_SHAPE) {
      for (let b = idx - 1; b > idx - 4 && b >= 0; b--) {
        if (out[b].tag === TAG_PARA_TEXT) { charShapeOf.set(b, idx); break; }
      }
    }
  }
  const valid = cells.filter(c => c.length === 4);

  valid.forEach((cell, k) => {
    cell.forEach((ti, f) => {
      const body = out[ti].body;
      // 앞쪽 공백(0x20) / 뒤쪽 제어문자 보존, 가운데만 교체
      let lead = 0;
      while (lead + 2 <= body.length && body.readUInt16LE(lead) === 0x20) lead += 2;
      let tail = body.length;
      while (tail - 2 >= 0 && body.readUInt16LE(tail - 2) < 0x20) tail -= 2;
      if (k < works.length) {
        // 채움: 가변 길이
        const mid = Buffer.from(fieldText(works[k], f), 'utf16le');
        const nb = Buffer.concat([body.subarray(0, lead), mid, body.subarray(tail)]);
        out[ti].body = nb;
        const h = headerOf.get(ti);
        if (h !== undefined && h >= 0) {
          const hb = out[h].body;
          const orig = hb.readUInt32LE(0);
          hb.writeUInt32LE((((orig & 0x80000000) | ((nb.length / 2) & 0x7fffffff)) >>> 0), 0);
        }
      } else {
        // 빈 칸: 원본과 같은 글자 수의 공백 (길이 변화 없음 → 안전)
        const midCap = (tail - lead) / 2;
        const mid = Buffer.from(' '.repeat(midCap), 'utf16le');
        out[ti].body = Buffer.concat([body.subarray(0, lead), mid, body.subarray(tail)]);
      }
      // 텍스트가 짧아져 글자 범위를 벗어난 서체 런은 제거 (첫 런은 항상 유지)
      const csIdx = charShapeOf.get(ti);
      if (csIdx !== undefined) {
        const chars = out[ti].body.length / 2;
        const cs = out[csIdx].body;
        const keep: Buffer[] = [];
        for (let k = 0; k + 8 <= cs.length; k += 8) {
          if (k === 0 || cs.readUInt32LE(k) < chars) keep.push(cs.subarray(k, k + 8));
        }
        if (keep.length * 8 !== cs.length) out[csIdx].body = Buffer.concat(keep);
      }
    });
  });

  // ── "마지막 문단" MSB 정리: 최상위(level 0) PARA_HEADER 중 마지막 1개만 설정 ──
  const topParas = out.map((r, i) => ({ r, i })).filter(({ r }) => r.tag === TAG_PARA_HEADER && r.level === 0);
  topParas.forEach(({ r }, n) => {
    const orig = r.body.readUInt32LE(0);
    const chars = orig & 0x7fffffff;
    const isLast = n === topParas.length - 1;
    r.body.writeUInt32LE(((isLast ? 0x80000000 : 0) | chars) >>> 0, 0);
  });

  return { body: serializeRecords(out), pageCount, cellCount: valid.length };
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

/**
 * 출품작 목록으로 캡션 HWP Buffer 생성.
 * 페이지 수는 작품 수에 맞춰 자동(1페이지=24칸). 최대 CAPTION_MAX_WORKS.
 */
export async function buildCaptionHwp(works: CaptionWork[]): Promise<Buffer> {
  if (works.length > CAPTION_MAX_WORKS) {
    throw new Error(`caption: 출품작이 너무 많습니다 (${works.length}점 / 최대 ${CAPTION_MAX_WORKS}점).`);
  }
  const raw = Buffer.from(fs.readFileSync(TEMPLATE_PATH)); // 가변 복사본
  const cfb = parseCfb(raw);
  const sec = findDirEntry(cfb, 'Section0');
  if (!sec) throw new Error('caption template: Section0 not found');
  let chain = chainOf(cfb, sec.startSector);

  // 본문 압축 해제 → 편집 → 재구성
  const compOrig = Buffer.alloc(chain.length * cfb.sectorSize);
  for (let n = 0; n < chain.length; n++) {
    cfb.buf.copy(compOrig, n * cfb.sectorSize, sectorOffset(cfb, chain[n]), sectorOffset(cfb, chain[n]) + cfb.sectorSize);
  }
  const dec = zlib.inflateRawSync(compOrig.subarray(0, sec.size));
  const built = buildBody(dec, works);

  // 재압축 + 유효 deflate 빈 블록 패딩(미니스트림 경계 4096 위, 정확 종료)
  const partial = await deflateRawSyncFlush(built.body); // 데이터 + sync flush, 바이트정렬, 미종료
  const minLen = partial.length + FINAL_BLOCK.length;
  const TARGET = Math.max(minLen, 4608); // 4096(미니스트림 경계) 초과 유지
  const padCount = Math.max(0, Math.floor((TARGET - minLen) / EMPTY_BLOCK.length));
  const comp = Buffer.concat([partial, ...Array(padCount).fill(EMPTY_BLOCK), FINAL_BLOCK]);
  // 무결성 확인
  if (!zlib.inflateRawSync(comp).equals(built.body)) throw new Error('caption: 재압축 검증 실패');

  // ── 필요 시 Section0 스트림 확장 (파일 끝에 섹터 추가 + FAT 체인 연장) ──
  let capacity = chain.length * cfb.sectorSize;
  if (comp.length > capacity) {
    const need = Math.ceil((comp.length - capacity) / cfb.sectorSize);
    const totalSectors = (cfb.buf.length - cfb.sectorSize) / cfb.sectorSize;
    if (!Number.isInteger(totalSectors)) throw new Error('caption: 템플릿 크기가 섹터 배수가 아닙니다.');
    if (totalSectors + need > cfb.fat.length) {
      throw new Error(`caption: 페이지가 많아 FAT 용량을 초과합니다 (필요 ${need}섹터, 여유 ${cfb.fat.length - totalSectors}섹터).`);
    }
    const newSectors: number[] = [];
    for (let i = 0; i < need; i++) {
      const s = totalSectors + i;
      if (cfb.fat[s] !== FREESECT) throw new Error(`caption: 섹터 ${s}가 비어있지 않습니다.`);
      newSectors.push(s);
    }
    // 파일 끝에 새 섹터 영역 확보(0으로 초기화)
    cfb.buf = Buffer.concat([cfb.buf, Buffer.alloc(need * cfb.sectorSize)]);
    // FAT 체인 연장: 기존 마지막 → 새 섹터들 → ENDOFCHAIN
    writeFat(cfb, chain[chain.length - 1], newSectors[0]);
    for (let i = 0; i < newSectors.length; i++) {
      writeFat(cfb, newSectors[i], i + 1 < newSectors.length ? newSectors[i + 1] : ENDOFCHAIN);
    }
    chain = chain.concat(newSectors);
    capacity = chain.length * cfb.sectorSize;
  }

  // 체인 섹터에 기록(나머지 0) + 디렉터리 스트림 크기 갱신
  const padded = Buffer.concat([comp, Buffer.alloc(capacity - comp.length)]);
  for (let n = 0; n < chain.length; n++) {
    padded.copy(cfb.buf, sectorOffset(cfb, chain[n]), n * cfb.sectorSize, (n + 1) * cfb.sectorSize);
  }
  cfb.buf.writeUInt32LE(comp.length, sec.offset + 0x78);
  cfb.buf.writeUInt32LE(0, sec.offset + 0x7c);
  return cfb.buf;
}

/** 출품작 수에 필요한 페이지 수 (라우트 안내/로그용) */
export function captionPageCount(workCount: number): number {
  return Math.max(1, Math.ceil(workCount / CAPTION_CELLS_PER_PAGE));
}
