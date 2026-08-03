import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { authenticate } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const router = Router();

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
  const ext = path.extname(file.originalname);
  const key = `${folder}/${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;

  await s3.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME!,
    Key: key,
    Body: file.buffer,
    ContentType: file.mimetype,
  }));

  return `${process.env.R2_PUBLIC_URL}/${key}`;
}

// 단일 이미지 업로드
router.post('/image', authenticate, upload.single('image'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: '파일이 필요합니다.' });
    const url = useR2
      ? await uploadToR2(req.file)
      : `/uploads/${req.file.filename}`;
    res.json({ url });
  } catch (err) {
    next(err);
  }
});

// 다중 이미지 업로드 (최대 10개)
router.post('/images', authenticate, upload.array('images', 10), async (req, res, next) => {
  try {
    const files = req.files as Express.Multer.File[];
    if (!files?.length) return res.status(400).json({ error: '파일이 필요합니다.' });
    const urls = useR2
      ? await Promise.all(files.map(f => uploadToR2(f)))
      : files.map(f => `/uploads/${f.filename}`);
    res.json({ urls });
  } catch (err) {
    next(err);
  }
});

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

router.post('/file', authenticate, fileUpload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: '파일이 필요합니다.' });
    const url = useR2
      ? await uploadToR2(req.file, 'artlink/files')
      : `/uploads/${req.file.filename}`;
    res.json({ url, originalName: req.file.originalname });
  } catch (err) {
    next(err);
  }
});

// ── 이미지 동일출처 프록시 (ArtLook 캔버스 PNG 저장용) ──
// R2 공개 이미지(외부 도메인)를 우리 도메인으로 중계 → 캔버스 taint 없이 toBlob 가능.
// SSRF 방지: R2_PUBLIC_URL 접두사로 시작하는 URL만 허용. 공개 이미지라 인증 불필요.
router.get('/image-proxy', async (req, res, next) => {
  try {
    const url = String(req.query.url || '');
    const base = process.env.R2_PUBLIC_URL || '';
    if (!base) throw new AppError('이미지 프록시가 설정되지 않았습니다.', 400);
    // SSRF 방지: 호스트네임을 R2 공개 도메인과 정확히 일치 비교 + 동일 프로토콜 + 경로 접두사
    let target: URL, allowed: URL;
    try { target = new URL(url); allowed = new URL(base); }
    catch { throw new AppError('허용되지 않은 이미지 주소입니다.', 400); }
    const host = (u: URL) => u.hostname.replace(/\.$/, '').toLowerCase();
    if (target.protocol !== allowed.protocol || host(target) !== host(allowed) || !url.startsWith(base + '/')) {
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
    res.setHeader('Cache-Control', 'public, max-age=86400');
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
