/**
 * 이미 올라간 **작품 사진(PortfolioImage)** 중 PNG 를 JPEG q90 으로 바꿔 넣는다 — 1회성 백필 (2026-09-22).
 *
 * ## 왜
 * 업로드 때 PNG → JPEG 변환은 2026-09-22 배포분부터다(`lib/imageNormalize.ts`). 그 전에 올라간 PNG 작품은
 * 라이트박스·ArtLook·포트폴리오 PDF 가 원본을 그대로 받는다 — 실측 한 장 1.95MB → 0.44MB(15%).
 * PDF 는 원본을 내장하고 예산이 9.4MB 라 PNG 5장이면 이미 사진을 줄이기 시작한다.
 *
 * ## 무엇을 하나
 * `PortfolioImage.url` 이 `.png` 인 행마다: 원본을 받아 → `normalizeUploadImage` 로 판정(투명·APNG 는 건너뜀) →
 * 바뀌면 **새 이름**의 `.jpg` 와 썸네일(t240·t800)을 올리고 → DB `url` 을 새 주소로 바꾼다.
 *
 * ⚠️⚠️ **옛 PNG 파일은 지우지 않는다.** 지원서(`Application.artworkImages`)와 제출자료(`ExhibitionSubmission.artworkList`)가
 *    지원 시점의 작품 주소를 **JSON 으로 복사해** 들고 있다. 옛 파일을 지우면 갤러리 운영페이지의 그 그림이 깨진다.
 *    저장 비용은 미미하다(R2 GB 당 월 0.015달러). 정리하려면 그 JSON 들을 다 훑어 참조가 없는 것만 지워야 한다 — 이 스크립트의 일이 아니다.
 * ⚠️ 대상은 PortfolioImage 만이다. 갤러리·전시·커뮤니티 사진은 목록에서 썸네일로만 보이므로 원본 포맷이 화면 속도에 영향이 없다.
 * ⚠️ 픽셀 크기는 바뀌지 않으므로 `width/height` 는 건드리지 않는다.
 * 멱등 — 바뀐 행은 `.jpg` 라 다시 돌리면 대상에서 빠진다. 중간에 죽어도 그대로 다시 돌리면 된다.
 *
 * ## 어디서
 * 실서버는 **Render 셸**(R2 키 필요). 로컬(디스크 모드)에서도 `/uploads/` 파일을 같은 규칙으로 바꾼다.
 *   cd backend && npx tsx scripts/convert-png-to-jpg.ts --dry-run   # 무엇이 얼마나 줄어드는지만 (먼저!)
 *   cd backend && npx tsx scripts/convert-png-to-jpg.ts --limit 20  # 앞 20장만
 *   cd backend && npx tsx scripts/convert-png-to-jpg.ts             # 전부
 */
import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import prisma from '../src/lib/prisma';
import { matchR2Base, r2CanonicalBase } from '../src/lib/r2Urls';
import { makeThumb, thumbKey, thumbDiskPath, THUMB_SPECS } from '../src/lib/thumb';
import { normalizeUploadImage } from '../src/lib/imageNormalize';

const DRY = process.argv.includes('--dry-run');
const LIMIT = (() => { const i = process.argv.indexOf('--limit'); return i >= 0 ? Number(process.argv[i + 1]) || 0 : 0; })();

const R2_VARS = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME', 'R2_PUBLIC_URL'] as const;
const useR2 = R2_VARS.every((k) => !!process.env[k]);
const s3 = useR2 ? new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY! },
}) : null;
const BUCKET = process.env.R2_BUCKET_NAME!;
const UPLOADS_DIR = path.join(__dirname, '../uploads');

const newName = () => `${Date.now()}-${Math.round(Math.random() * 1e9)}.jpg`;

async function loadBytes(url: string): Promise<Buffer | null> {
  if (url.startsWith('/uploads/')) {
    const safe = path.basename(url.slice('/uploads/'.length));
    return safe ? fs.readFile(path.join(UPLOADS_DIR, safe)).catch(() => null) : null;
  }
  if (matchR2Base(url)) {
    const r = await fetch(url).catch(() => null);
    return r?.ok ? Buffer.from(await r.arrayBuffer()) : null;
  }
  return null;
}

/** 새 JPEG 와 썸네일을 올리고 새 공개 주소를 돌려준다. 원본 자리(R2 키 폴더 / uploads 디스크)를 따른다. */
async function store(url: string, buf: Buffer): Promise<string> {
  if (url.startsWith('/uploads/')) {
    const name = newName();
    await fs.writeFile(path.join(UPLOADS_DIR, name), buf);
    for (const spec of THUMB_SPECS) {
      const t = await makeThumb(buf, spec);
      if (!t) continue;
      const out = thumbDiskPath(UPLOADS_DIR, name, spec.dir);
      await fs.mkdir(path.dirname(out), { recursive: true });
      await fs.writeFile(out, t);
    }
    return `/uploads/${name}`;
  }
  if (!s3) throw new Error('R2 주소인데 R2 자격증명이 없다 — Render 셸에서 실행하세요.');
  const base = matchR2Base(url)!;
  const oldKey = url.slice(base.length).replace(/^\//, '').split(/[?#]/)[0];
  const dir = oldKey.includes('/') ? oldKey.slice(0, oldKey.lastIndexOf('/')) : 'artlink';
  const key = `${dir}/${newName()}`;
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: buf, ContentType: 'image/jpeg' }));
  for (const spec of THUMB_SPECS) {
    const t = await makeThumb(buf, spec);
    if (t) await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: thumbKey(key, spec.dir), Body: t, ContentType: 'image/jpeg' }));
  }
  return `${r2CanonicalBase()}/${key}`;
}

async function main() {
  const rows = await prisma.portfolioImage.findMany({
    where: { url: { endsWith: '.png', mode: 'insensitive' } },
    select: { id: true, url: true },
    orderBy: { id: 'asc' },
    ...(LIMIT ? { take: LIMIT } : {}),
  });
  console.log(`PNG 작품 ${rows.length}장${DRY ? ' — dry-run, 아무것도 바꾸지 않습니다' : ''} (${useR2 ? 'R2' : '디스크'} 모드)\n`);

  const stat = { converted: 0, kept: 0, fetchFail: 0, bytesIn: 0, bytesOut: 0 };
  for (const [i, row] of rows.entries()) {
    const buf = await loadBytes(row.url);
    if (!buf) { stat.fetchFail++; console.warn(`  [${i + 1}] 원본 받기 실패 #${row.id} ${row.url}`); continue; }
    const img = await normalizeUploadImage(buf, '.png', 'image/png');
    if (!img.converted) { stat.kept++; continue; }        // 투명·APNG·안 줄어드는 그림
    stat.converted++; stat.bytesIn += buf.length; stat.bytesOut += img.buf.length;
    if (DRY) continue;
    const url = await store(row.url, img.buf);
    await prisma.portfolioImage.update({ where: { id: row.id }, data: { url } });
    if ((i + 1) % 25 === 0) console.log(`  ...${i + 1}/${rows.length}`);
  }

  const mb = (n: number) => (n / 1024 / 1024).toFixed(1) + 'MB';
  console.log('\n─ 결과 ─');
  console.log(`  변환 ${stat.converted} · PNG 유지(투명 등) ${stat.kept} · 원본 받기 실패 ${stat.fetchFail}`);
  console.log(`  변환분 용량 ${mb(stat.bytesIn)} → ${mb(stat.bytesOut)}${stat.bytesIn ? ` (${Math.round(stat.bytesOut / stat.bytesIn * 100)}%)` : ''}`);
  console.log(DRY ? '\n(dry-run 이라 아무것도 올리지 않았습니다)' : '\n완료. 옛 PNG 파일은 지원서·제출자료가 참조할 수 있어 남겨 두었습니다.');
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
