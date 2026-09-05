/**
 * 이미 올라간 이미지에 썸네일(t240 · t800)을 만들어 넣는다 — 1회성 백필.
 *
 * ## 왜
 * 썸네일 생성은 2026-08-11 업로드분부터 붙었다. 그 전에 올라간 것에는 썸네일이 없어
 * 화면이 **원본을 그대로** 받는다. 실측(2026-08-27, 작가A 작가 공개 홈페이지):
 *   작품 30장 · 평균 959KB · 합계 **28.1MB** — 표시 크기는 377px 인데 원본은 1456~1986px.
 *   t800 로 바꾸면 같은 페이지가 **4.3MB** 가 된다(화질 손실 없음, 아래 참고).
 * DB의 PortfolioImage 372장이 **전부** 썸네일 없는 상태였다.
 *
 * ## 무엇을 하나
 * 원본을 받아 t240·t800 을 만들어 **없는 것만** 올린다. 원본은 읽기만 하고 절대 건드리지 않는다.
 * 중간에 죽어도 다시 돌리면 이미 있는 것은 건너뛴다(멱등).
 *
 * ## ⚠️ 대상은 PortfolioImage 만이 아니다 (2026-09-05 확장)
 * 처음엔 `PortfolioImage` 만 돌았다. 그래서 2026-09-04 백필 후 실서버를 재 보니
 * **작품은 84/84 인데 갤러리·전시·공모 이미지는 0/5**, 아바타도 없었다.
 * `Thumb` 의 `THUMB_SIZES.list.backfilled` 를 켜려면 목록에 뜨는 **모든** 종류가 채워져 있어야 한다 —
 * 한 종류라도 비면 그 이미지마다 **404(약 27KB) 를 쏘고 나서 원본을 또 받아** 요청이 두 배가 된다
 * (CLAUDE.md 21b). 그래서 `SOURCES` 에 url 을 가진 모델을 전부 넣는다.
 * ⚠️ 새로 이미지를 들고 있는 모델을 만들면 **여기에도 추가할 것.** 빠뜨리면 그 종류만 조용히 느려진다.
 *
 * ⚠️⚠️ **컬럼 이름만 훑어 목록을 만들지 말 것** (2026-09-05, 같은 날 두 번 당했다).
 * `imageUrl`·`url` 로 grep 해서 13개를 넣었더니 이름이 다르거나 JSON 안에 든 다섯이 빠졌다 —
 * `Gallery.mainImage` · `Show.posterImage` · `ExhibitionSubmission.artworkList`(JSON `[{image}]`) ·
 * `Application.artworkImages`(JSON `[url]`) · `ChatMessage.attachmentUrl`.
 * 하필 `artworkList` 가 **운영페이지**(`<Thumb src={w.image}>`)의 그림이다 — 이미지 149건·96MB 라는
 * `Thumb` 을 만든 바로 그 화면인데 정작 백필에서 빠져 있었다.
 * 확인은 스키마가 아니라 **결과로** 한다: 실서버 이미지 주소에 `/t240/` 을 끼워 `curl -I` 가 200 인지 본다.
 *
 * ## 어디서 돌리나
 * R2 자격증명이 있어야 한다 → **Render 셸에서** 돌리는 게 맞다(로컬은 디스크 저장 모드라 R2 키가 없다).
 *   cd backend && npx tsx scripts/backfill-thumbs.ts            # 실제 실행
 *   cd backend && npx tsx scripts/backfill-thumbs.ts --dry-run  # 무엇을 할지만 출력
 *   cd backend && npx tsx scripts/backfill-thumbs.ts --limit 20 # 앞 20장만 (먼저 확인용)
 *
 * ⚠️ 원본 주소는 여러 개일 수 있다(R2_PUBLIC_URL 은 쉼표 목록, CLAUDE.md 17번).
 *    DB 에 옛 도메인이 남아 있어도 처리되도록 matchR2Base 로 판정한다.
 */
import 'dotenv/config';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import prisma from '../src/lib/prisma';
import { matchR2Base } from '../src/lib/r2Urls';
import { makeThumb, thumbKey, THUMB_SPECS } from '../src/lib/thumb';

const DRY = process.argv.includes('--dry-run');
const LIMIT = (() => {
  const i = process.argv.indexOf('--limit');
  return i >= 0 ? Number(process.argv[i + 1]) || 0 : 0;
})();

const R2_VARS = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME', 'R2_PUBLIC_URL'] as const;
const missing = R2_VARS.filter((k) => !process.env[k]);
if (missing.length) {
  console.error('R2 환경변수가 없습니다:', missing.join(', '));
  console.error('로컬은 디스크 저장 모드라 R2 키가 없습니다 — Render 셸에서 실행하세요.');
  process.exit(1);
}

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});
const BUCKET = process.env.R2_BUCKET_NAME!;

/** 공개 주소 → 버킷 키. 어느 도메인으로 저장돼 있든 뒤쪽 경로만 취한다. */
function keyOf(url: string): string | null {
  const base = matchR2Base(url);
  if (!base) return null;
  const key = url.slice(base.length).replace(/^\//, '').split(/[?#]/)[0];
  return key || null;
}

async function exists(key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

/**
 * 썸네일을 만들 이미지가 들어 있는 곳 전부.
 *
 * ⚠️ 한 주소가 여러 곳에 있을 수 있다(예: `Exhibition.imageUrl` 은 첫 `ExhibitionImage.url` 과 같은 값이다).
 *    아래에서 주소로 dedupe 하므로 겹쳐 적어도 두 번 처리되지 않는다 — 빠뜨리는 것보다 겹치는 게 낫다.
 * ⚠️ 첨부파일(`attachmentUrl`)·포트폴리오 파일(`portfolioFileUrl`)·외부 링크(`linkUrl`)는 **넣지 않는다**.
 *    PDF·HWP·ZIP 이라 썸네일을 만들 수 없고(makeThumb 가 null), 헛되이 원본만 내려받는다.
 */
/**
 * JSON 컬럼에 박힌 이미지 주소를 꺼낸다.
 * ⚠️ 옛 행에는 깨진 JSON·다른 모양이 섞여 있을 수 있다 — 하나가 실패해도 나머지는 돌아야 하므로 통째로 감싼다.
 */
function fromJson(raw: string | null, pick: (v: any) => unknown): string[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.map(pick).filter((u): u is string => typeof u === 'string' && u.length > 0);
  } catch {
    return [];
  }
}

// null 을 그대로 받는다 — nullable 컬럼(avatar·imageUrl)이 섞여 있고, 걸러내는 건 collectUrls 한 곳이다
const SOURCES: { label: string; load: () => Promise<(string | null)[]> }[] = [
  { label: 'PortfolioImage', load: () => prisma.portfolioImage.findMany({ select: { url: true } }).then(r => r.map(x => x.url)) },
  { label: 'GalleryImage', load: () => prisma.galleryImage.findMany({ select: { url: true } }).then(r => r.map(x => x.url)) },
  { label: 'Gallery.mainImage', load: () => prisma.gallery.findMany({ select: { mainImage: true } }).then(r => r.map(x => x.mainImage)) },
  { label: 'Show.posterImage', load: () => prisma.show.findMany({ select: { posterImage: true } }).then(r => r.map(x => x.posterImage)) },
  { label: 'ExhibitionImage', load: () => prisma.exhibitionImage.findMany({ select: { url: true } }).then(r => r.map(x => x.url)) },
  { label: 'Exhibition.imageUrl', load: () => prisma.exhibition.findMany({ select: { imageUrl: true } }).then(r => r.map(x => x.imageUrl)) },
  { label: 'ShowImage', load: () => prisma.showImage.findMany({ select: { url: true } }).then(r => r.map(x => x.url)) },
  { label: 'PromoPhoto', load: () => prisma.promoPhoto.findMany({ select: { url: true } }).then(r => r.map(x => x.url)) },
  { label: 'User.avatar', load: () => prisma.user.findMany({ select: { avatar: true } }).then(r => r.map(x => x.avatar)) },
  { label: 'Story.images', load: () => prisma.story.findMany({ select: { images: true } }).then(r => r.flatMap(x => x.images)) },
  { label: 'Post.images', load: () => prisma.post.findMany({ select: { images: true } }).then(r => r.flatMap(x => x.images)) },
  { label: 'Review.imageUrl', load: () => prisma.review.findMany({ select: { imageUrl: true } }).then(r => r.map(x => x.imageUrl)) },
  { label: 'HeroSlide', load: () => prisma.heroSlide.findMany({ select: { imageUrl: true } }).then(r => r.map(x => x.imageUrl)) },
  { label: 'AdBanner', load: () => prisma.adBanner.findMany({ select: { imageUrl: true } }).then(r => r.map(x => x.imageUrl)) },
  { label: 'Benefit', load: () => prisma.benefit.findMany({ select: { imageUrl: true } }).then(r => r.map(x => x.imageUrl)) },
  // ⚠️ JSON 안에 든 것 — 운영페이지가 `<Thumb src={w.image}>` 로 그리는 자리다.
  //    Thumb 을 만든 계기(이미지 149건·96MB)가 바로 이 화면인데 정작 백필에서 빠져 있었다(2026-09-05).
  {
    label: 'Submission.artworkList',
    load: () => prisma.exhibitionSubmission.findMany({ select: { artworkList: true } })
      .then(r => r.flatMap(x => fromJson(x.artworkList, (a) => a?.image))),
  },
  {
    label: 'Application.artworkImages',
    load: () => prisma.application.findMany({ select: { artworkImages: true } })
      .then(r => r.flatMap(x => fromJson(x.artworkImages, (a) => a))),
  },
  // 대화 첨부는 IMAGE 만 — VIDEO·FILE 은 썸네일을 만들 수 없다
  {
    label: 'ChatMessage(IMAGE)',
    load: () => prisma.chatMessage.findMany({ where: { attachmentType: 'IMAGE' }, select: { attachmentUrl: true } })
      .then(r => r.map(x => x.attachmentUrl)),
  },
];

/** 모든 출처에서 주소를 모아 **중복 없이** 돌려준다. 어느 출처에서 처음 나왔는지도 함께 센다. */
async function collectUrls(): Promise<string[]> {
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const src of SOURCES) {
    let rows: (string | null)[];
    try {
      rows = await src.load();
    } catch (e) {
      // 모델이 없는 옛 스키마에서도 나머지는 돌아야 한다
      console.warn(`  ${src.label}: 읽기 실패 — 건너뜁니다 (${(e as Error).message})`);
      continue;
    }
    let added = 0;
    for (const u of rows) {
      if (!u || seen.has(u)) continue;
      seen.add(u);
      urls.push(u);
      added++;
    }
    console.log(`  ${src.label.padEnd(26)} ${String(rows.filter(Boolean).length).padStart(5)}건 → 새 주소 ${added}`);
  }
  return urls;
}

async function main() {
  console.log('출처별 수집');
  const all = await collectUrls();
  const images = (LIMIT ? all.slice(0, LIMIT) : all).map((url) => ({ url }));
  console.log(`\n대상 ${images.length}장 (중복 제거 후 전체 ${all.length})${DRY ? ' — dry-run, 아무것도 올리지 않습니다' : ''}\n`);

  const stat = { done: 0, skipped: 0, notR2: 0, fetchFail: 0, makeFail: 0, bytesIn: 0, bytesOut: 0 };

  for (const [i, img] of images.entries()) {
    const key = keyOf(img.url);
    if (!key) { stat.notR2++; continue; }

    // 필요한 것만 고른다 (이미 있으면 건너뛴다 → 다시 돌려도 안전)
    const todo = [];
    for (const spec of THUMB_SPECS) {
      const tk = thumbKey(key, spec.dir);
      if (!(await exists(tk))) todo.push({ spec, tk });
    }
    if (todo.length === 0) { stat.skipped++; continue; }

    let buf: Buffer;
    try {
      const r = await fetch(img.url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      buf = Buffer.from(await r.arrayBuffer());
    } catch (e) {
      stat.fetchFail++;
      console.warn(`  [${i + 1}] 원본 받기 실패 ${key}: ${(e as Error).message}`);
      continue;
    }
    stat.bytesIn += buf.length;

    for (const { spec, tk } of todo) {
      const thumb = await makeThumb(buf, spec);
      if (!thumb) { stat.makeFail++; console.warn(`  [${i + 1}] ${spec.dir} 생성 실패 ${key}`); continue; }
      stat.bytesOut += thumb.length;
      if (!DRY) {
        await s3.send(new PutObjectCommand({
          Bucket: BUCKET, Key: tk, Body: thumb, ContentType: 'image/jpeg',
        }));
      }
    }
    stat.done++;
    if ((i + 1) % 25 === 0) console.log(`  ...${i + 1}/${images.length}`);
  }

  const mb = (n: number) => (n / 1024 / 1024).toFixed(1) + 'MB';
  console.log('\n─ 결과 ─');
  console.log(`  처리 ${stat.done} · 이미 있음 ${stat.skipped} · R2 주소 아님 ${stat.notR2}`);
  if (stat.fetchFail) console.log(`  원본 받기 실패 ${stat.fetchFail}`);
  if (stat.makeFail) console.log(`  썸네일 생성 실패 ${stat.makeFail}`);
  console.log(`  읽은 원본 ${mb(stat.bytesIn)} → 만든 썸네일 ${mb(stat.bytesOut)}`);
  console.log(DRY ? '\n(dry-run 이라 업로드하지 않았습니다)' : '\n완료. 화면은 썸네일이 없으면 원본으로 되돌아가므로 실패분이 있어도 정상 동작합니다.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
