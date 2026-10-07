import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { authenticate, authorize } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { r2CanonicalBase, matchR2Base } from '../lib/r2Urls';
import { makeThumb, thumbKey, thumbDiskPath, THUMB_SPECS } from '../lib/thumb';
import { normalizeUploadImage } from '../lib/imageNormalize';
import { attachmentDisposition, cleanAttachmentName } from '../lib/exhibitionAttachments';

const router = Router();

/**
 * 업로드는 **동시에 3개까지만** 처리하고 나머지는 줄을 세운다(2026-10-03 점검 S8).
 * R2 모드는 multer 가 파일을 메모리에 담고 sharp 가 썸네일 두 장을 더 만든다 — 15MB 사진 여러 장이 한꺼번에 들어오면
 * Render Starter(램 512MB)가 버티지 못한다. 넘쳐도 실패시키지 않고 기다리게 한다(화면은 여러 장을 한 장씩 차례로 올린다).
 * 줄이 너무 길면(30) 503 — 그때는 정말 몰린 것이다. 기다리던 요청이 끊기면 줄에서 뺀다.
 * ⚠️ multer 보다 **앞**에 둘 것 — 뒤에 두면 본문을 이미 메모리에 다 읽은 뒤라 의미가 없다.
 */
const UPLOAD_CONCURRENCY = 3;
const UPLOAD_QUEUE_MAX = 30;
let uploadsActive = 0;
const uploadQueue: (() => void)[] = [];
function uploadSlot(req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) {
  const start = () => {
    uploadsActive++;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      uploadsActive--;
      uploadQueue.shift()?.();
    };
    res.on('finish', release);
    res.on('close', release);
    next();
  };
  if (uploadsActive < UPLOAD_CONCURRENCY) return start();
  if (uploadQueue.length >= UPLOAD_QUEUE_MAX) return next(new AppError('업로드가 몰리고 있어요. 잠시 후 다시 시도해 주세요.', 503));
  const waiting = () => { req.off('close', drop); start(); };
  const drop = () => { const i = uploadQueue.indexOf(waiting); if (i >= 0) uploadQueue.splice(i, 1); };
  req.on('close', drop);
  uploadQueue.push(waiting);
}

// R2 사용 조건: 5개 환경변수가 모두 있어야 함. 일부만 있으면 "undefined/..." URL 저장/500을 유발하므로 비활성화.
const R2_VARS = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME', 'R2_PUBLIC_URL'] as const;
const useR2 = R2_VARS.every((k) => !!process.env[k]);

// production에서 일부만 설정된 경우 명확히 경고 (조용한 오작동 방지)
const setR2Count = R2_VARS.filter((k) => !!process.env[k]).length;
if (process.env.NODE_ENV === 'production' && setR2Count > 0 && setR2Count < R2_VARS.length) {
  console.error(
    '[Upload] R2 환경변수가 일부만 설정되어 R2 업로드가 비활성화되고 디스크 저장으로 대체됩니다. 누락:',
    R2_VARS.filter((k) => !process.env[k]).join(', '),
  );
}

let s3: S3Client;
if (useR2) {
  s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });
}

const storage = useR2
  ? multer.memoryStorage()
  : multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, path.join(__dirname, '../../uploads')),
      filename: (_req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
      },
    });

// defParamCharset: 'utf8' — multer 기본 latin1 파싱으로 한글 파일명이 깨지는 문제 방지.
// (@types/multer 5.x Options에는 없어 인터섹션 타입으로 명시)
const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 },
  defParamCharset: 'utf8',
  fileFilter: (_req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
    const mime = allowed.test(file.mimetype);
    if (ext && mime) return cb(null, true);
    cb(new AppError('이미지 파일만 업로드 가능합니다.', 400));
  },
} as multer.Options & { defParamCharset: string });

async function uploadToR2(file: Express.Multer.File, folder = 'artlink'): Promise<string> {
  // PNG 사진은 JPEG q90 으로 바꿔 저장한다(투명·애니메이션은 그대로 — lib/imageNormalize.ts). 확장자·MIME 도 함께 바뀐다.
  const img = await normalizeUploadImage(file.buffer, path.extname(file.originalname), file.mimetype);
  const key = `${folder}/${Date.now()}-${Math.round(Math.random() * 1e9)}${img.ext}`;

  await s3.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME!,
    Key: key,
    Body: img.buf,
    ContentType: img.mime,
  }));

  // 썸네일 두 종(t240 목록용 · t800 작품 격자용)을 함께 올린다 (lib/thumb.ts 참고).
  // ⚠️ 실패해도 업로드는 성공으로 둔다. 사진이 올라가는 게 우선이고, 화면은 썸네일이 없으면 원본으로 되돌린다.
  for (const spec of THUMB_SPECS) {
    void makeThumb(img.buf, spec)
      .then((thumb) => thumb && s3.send(new PutObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME!,
        Key: thumbKey(key, spec.dir),
        Body: thumb,
        ContentType: 'image/jpeg',
      })))
      .catch((e) => console.error(`[Upload] ${spec.dir} 생성/업로드 실패(원본은 정상):`, key, e?.message));
  }

  // 여러 도메인이 설정돼 있으면 첫 번째가 정식 주소 (lib/r2Urls.ts 참고)
  return `${r2CanonicalBase()}/${key}`;
}

/**
 * 디스크 저장 모드(로컬)의 PNG → JPEG 변환. multer 가 이미 `.png` 로 써 둔 뒤라 읽어서 다시 쓰고 원본을 지운다.
 * 바뀌면 `file.filename`·`path`·`mimetype` 을 새 값으로 고쳐 두므로, 뒤의 썸네일·응답 url 은 그대로 그걸 쓴다.
 * R2 모드와 **같은 함수**(normalizeUploadImage)를 타야 로컬에서 본 동작이 실서버와 같다.
 */
async function normalizeDiskFile(file: Express.Multer.File): Promise<void> {
  try {
    const fs = await import('fs/promises');
    const uploadsDir = path.join(__dirname, '../../uploads');
    const src = path.join(uploadsDir, file.filename);
    const img = await normalizeUploadImage(await fs.readFile(src), path.extname(file.filename), file.mimetype);
    if (!img.converted) return;
    const newName = file.filename.replace(/\.[^.]+$/, '') + img.ext;
    await fs.writeFile(path.join(uploadsDir, newName), img.buf);
    await fs.unlink(src).catch(() => { /* 새 파일이 우선 — 옛 파일이 남는 건 고아일 뿐이다 */ });
    file.filename = newName;
    file.path = path.join(uploadsDir, newName);
    file.mimetype = img.mime;
    file.size = img.buf.length;
  } catch (e) {
    console.error('[Upload] PNG→JPEG 변환 실패(원본 그대로 저장):', file.filename, (e as Error)?.message);
  }
}

// 디스크 저장 모드(로컬)에서도 같은 규칙으로 썸네일을 만들어 둔다 — 로컬에서 화면 동작이 실서버와 달라지지 않게.
async function writeDiskThumb(file: Express.Multer.File): Promise<void> {
  try {
    const fs = await import('fs/promises');
    const uploadsDir = path.join(__dirname, '../../uploads');
    const buf = await fs.readFile(path.join(uploadsDir, file.filename));
    for (const spec of THUMB_SPECS) {
      const thumb = await makeThumb(buf, spec);
      if (!thumb) continue;
      const out = thumbDiskPath(uploadsDir, file.filename, spec.dir);
      await fs.mkdir(path.dirname(out), { recursive: true });
      await fs.writeFile(out, thumb);
    }
  } catch (e) {
    console.error('[Upload] 디스크 썸네일 실패(원본은 정상):', file.filename, (e as Error)?.message);
  }
}

// 단일 이미지 업로드
router.post('/image', authenticate, uploadSlot, upload.single('image'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: '파일이 필요합니다.' });
    let url: string;
    if (useR2) url = await uploadToR2(req.file);
    else { await normalizeDiskFile(req.file); url = `/uploads/${req.file.filename}`; void writeDiskThumb(req.file); }
    res.json({ url });
  } catch (err) {
    next(err);
  }
});

// ⚠️ 여러 장 한 번에(`POST /images`, 10장 × 15MB 를 한 요청 메모리에) 는 2026-10-03 에 없앴다 — 화면은 쓰지 않았고(여러 장도 한 장씩 차례로 올린다),
//    로그인한 계정 몇 개의 동시 요청만으로 서버 메모리를 채울 수 있었다(점검 S8). 되살리지 말 것.

// 파일 업로드 (PDF/DOC/HWP/ZIP, 20MB)
// 허용 문서 MIME (HWP/ZIP는 브라우저마다 octet-stream으로 보내므로 포함)
const allowedFileMimes = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/haansofthwp',
  'application/x-hwp',
  'application/vnd.hancom.hwp',
  'application/vnd.hancom.hwpx',
  'application/zip',
  'application/x-zip-compressed',
  'application/octet-stream',
]);

const fileUpload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  defParamCharset: 'utf8', // 한글 파일명(originalname) mojibake 방지
  fileFilter: (_req, file, cb) => {
    const allowed = /pdf|doc|docx|hwp|hwpx|zip/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase().replace('.', ''));
    // 확장자 + 실제 파일형식(MIME) 둘 다 검사 → 확장자만 위장한 파일 차단
    const mimeOk = allowedFileMimes.has(file.mimetype);
    if (ext && mimeOk) return cb(null, true);
    cb(new AppError('허용된 파일 형식: PDF, DOC, DOCX, HWP, HWPX, ZIP', 400));
  },
} as multer.Options & { defParamCharset: string });

router.post('/file', authenticate, uploadSlot, fileUpload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: '파일이 필요합니다.' });
    const url = useR2
      ? await uploadToR2(req.file, 'artlink/files')
      : `/uploads/${req.file.filename}`;
    res.json({ url, originalName: req.file.originalname, size: req.file.size });
  } catch (err) {
    next(err);
  }
});

// ── 공모 첨부파일 (2026-10-08) ─────────────────────────────────────────────
// 모집 요강·지원서 양식·공간 도면 같은 파일. 문서·압축·이미지, 한 파일 20MB. 공고를 올리는 갤러리·관리자만 쓴다.
// ⚠️ 파일을 **받은 그대로** 저장한다 — 이미지라도 PNG→JPEG 변환·썸네일을 하지 않는다(내려받는 사람이 갤러리가 올린 바로 그 파일을 받아야 한다).
// ⚠️ R2 에는 원래 이름을 Content-Disposition 으로 함께 적는다 — R2 는 다른 출처라 화면의 <a download="이름"> 이 먹지 않는다
//    (lib/exhibitionAttachments.ts attachmentDisposition). 형식 목록은 프론트 `lib/attachments.ts` 와 같아야 한다.
const ATTACHMENT_EXTS = new Set(['pdf', 'hwp', 'hwpx', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'zip', 'jpg', 'jpeg', 'png']);
const attachmentMimes = new Set([
  ...allowedFileMimes,
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/x-zip',
  'image/jpeg',
  'image/png',
]);
/** 확장자로 정하는 저장 형식 — 브라우저가 한글·압축 파일을 octet-stream 으로 보내는 일이 흔하다 */
const ATTACHMENT_CONTENT_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  hwp: 'application/x-hwp',
  hwpx: 'application/hwp+zip',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  zip: 'application/zip',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
};

const attachmentUpload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  defParamCharset: 'utf8',
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
    // 확장자 + 실제 형식(MIME) 둘 다 — 확장자만 바꾼 실행 파일을 막는다
    if (ATTACHMENT_EXTS.has(ext) && attachmentMimes.has(file.mimetype)) return cb(null, true);
    cb(new AppError('첨부할 수 있는 파일: PDF·한글·워드·엑셀·파워포인트·ZIP·JPG·PNG', 400));
  },
} as multer.Options & { defParamCharset: string });

async function uploadAttachmentToR2(file: Express.Multer.File, name: string): Promise<string> {
  const ext = path.extname(file.originalname).toLowerCase();
  const key = `artlink/attachments/${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
  await s3.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME!,
    Key: key,
    Body: file.buffer,
    ContentType: ATTACHMENT_CONTENT_TYPES[ext.replace('.', '')] ?? 'application/octet-stream',
    ContentDisposition: attachmentDisposition(name),
  }));
  return `${r2CanonicalBase()}/${key}`;
}

router.post('/attachment', authenticate, authorize('GALLERY', 'ADMIN'), uploadSlot, attachmentUpload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: '파일이 필요합니다.' });
    const name = cleanAttachmentName(req.file.originalname) || '첨부파일';
    const url = useR2 ? await uploadAttachmentToR2(req.file, name) : `/uploads/${req.file.filename}`;
    res.json({ url, originalName: name, size: req.file.size });
  } catch (err) {
    next(err);
  }
});

// 동영상 업로드 (대화 첨부용, 25MB) — 서버비를 고려해 이미지·파일보다 짧은 상한을 둔다.
// mp4/webm/ogg/quicktime(mov) 만. HEVC(.mov) 는 브라우저 재생이 들쭉날쭉하지만 다운로드는 되므로 허용.
export const CHAT_VIDEO_MAX_BYTES = 25 * 1024 * 1024;
const allowedVideoMimes = new Set([
  'video/mp4', 'video/webm', 'video/ogg', 'video/quicktime',
]);
const videoUpload = multer({
  storage,
  limits: { fileSize: CHAT_VIDEO_MAX_BYTES },
  defParamCharset: 'utf8',
  fileFilter: (_req, file, cb) => {
    const ext = /mp4|webm|ogg|mov|m4v/.test(path.extname(file.originalname).toLowerCase().replace('.', ''));
    const mimeOk = allowedVideoMimes.has(file.mimetype);
    if (ext && mimeOk) return cb(null, true);
    cb(new AppError('허용된 동영상 형식: MP4, WEBM, OGG, MOV (최대 25MB)', 400));
  },
} as multer.Options & { defParamCharset: string });

router.post('/video', authenticate, uploadSlot, videoUpload.single('video'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: '동영상 파일이 필요합니다.' });
    const url = useR2
      ? await uploadToR2(req.file, 'artlink/videos')
      : `/uploads/${req.file.filename}`;
    res.json({ url, originalName: req.file.originalname, size: req.file.size });
  } catch (err) {
    next(err);
  }
});

// ── 이미지 동일출처 프록시 (ArtLook 캔버스 PNG 저장용) ──
// R2 공개 이미지(외부 도메인)를 우리 도메인으로 중계 → 캔버스 taint 없이 toBlob 가능.
// SSRF 방지: 설정된 R2 공개 주소로 시작하는 URL만 허용. 공개 이미지라 인증 불필요.
// 도메인 전환기에는 신·구 주소가 함께 설정되므로 둘 다 허용한다(lib/r2Urls.ts).
router.get('/image-proxy', async (req, res, next) => {
  try {
    const url = String(req.query.url || '');
    if (!process.env.R2_PUBLIC_URL) throw new AppError('이미지 프록시가 설정되지 않았습니다.', 400);
    // 호스트네임 정확 일치 + 동일 프로토콜 + 경로 접두사까지 확인한다
    if (!matchR2Base(url)) {
      throw new AppError('허용되지 않은 이미지 주소입니다.', 400);
    }
    // redirect: 'manual' — 3xx 리다이렉트(내부주소로 우회) 차단
    // 타임아웃 20초: Render 인스턴스가 혼잡할 때 10초로는 정상 요청까지 500이 났다(2026-08 운영 로그).
    const upstream = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(20000) });
    if (upstream.status >= 300 && upstream.status < 400) throw new AppError('허용되지 않은 리다이렉트입니다.', 400);
    if (!upstream.ok) throw new AppError('이미지를 가져오지 못했습니다.', 502);
    // 래스터 이미지 타입만 허용 — image/svg+xml 등 스크립트 실행 가능 타입 차단(동일출처 XSS 방지)
    const lc = (upstream.headers.get('content-type') || '').toLowerCase();
    const SAFE = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];
    if (!SAFE.some((t) => lc.startsWith(t))) throw new AppError('지원하지 않는 이미지 형식입니다.', 400);
    res.setHeader('Content-Type', lc.split(';')[0]);
    res.setHeader('X-Content-Type-Options', 'nosniff');               // MIME 스니핑 차단
    res.setHeader('Content-Disposition', 'inline; filename="image"');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox"); // 만약 통과해도 스크립트 실행 불가
    // 캐시 기간은 **부르는 쪽이 정한다**.
    // ArtLook(`&immutable=1`)은 같은 사람이 하루에도 여러 번 들어와 매번 같은 작품을 다시 받는다 —
    // 기본 1일로는 사람당 하루 1회씩 재전송돼 Render 대역폭이 월 수백 GB로 뛴다(실측).
    // 업로드 키가 `타임스탬프-난수.jpg`라 **같은 주소에 다른 이미지가 덮이지 않으므로** 길게 잡아도 안전하다.
    // 기본값(1일)은 그대로 둔다 — PDF·ZIP 폴백 경로(lib/imageFetch.ts)의 동작을 바꾸지 않기 위해서다.
    res.setHeader('Cache-Control', req.query.immutable === '1'
      ? 'public, max-age=604800'
      : 'public, max-age=86400');
    const len = upstream.headers.get('content-length');
    if (len) res.setHeader('Content-Length', len);

    // 스트리밍으로 중계 — 예전엔 arrayBuffer()로 이미지 전체를 메모리에 담았다가 내보내서
    // 동시 요청이 몰리면 인스턴스 메모리/이벤트루프가 포화됐다(운영 로그에 10초 타임아웃 다수).
    if (!upstream.body) throw new AppError('이미지를 가져오지 못했습니다.', 502);
    const { Readable } = await import('stream');
    const nodeStream = Readable.fromWeb(upstream.body as any);
    nodeStream.on('error', () => { if (!res.headersSent) res.status(502).end(); else res.destroy(); });
    // 클라이언트가 중간에 끊으면 업스트림 읽기도 즉시 중단(소켓·메모리 회수)
    res.on('close', () => { if (!res.writableEnded) nodeStream.destroy(); });
    nodeStream.pipe(res);
  } catch (err) { next(err); }
});

export default router;
