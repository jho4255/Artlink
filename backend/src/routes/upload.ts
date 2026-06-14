import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { authenticate } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const router = Router();

const useR2 = !!(process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY);

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

const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
    const mime = allowed.test(file.mimetype);
    if (ext && mime) return cb(null, true);
    cb(new AppError('이미지 파일만 업로드 가능합니다.', 400));
  },
});

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
  fileFilter: (_req, file, cb) => {
    const allowed = /pdf|doc|docx|hwp|hwpx|zip/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase().replace('.', ''));
    // 확장자 + 실제 파일형식(MIME) 둘 다 검사 → 확장자만 위장한 파일 차단
    const mimeOk = allowedFileMimes.has(file.mimetype);
    if (ext && mimeOk) return cb(null, true);
    cb(new AppError('허용된 파일 형식: PDF, DOC, DOCX, HWP, HWPX, ZIP', 400));
  },
});

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
    const upstream = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(10000) });
    if (upstream.status >= 300 && upstream.status < 400) throw new AppError('허용되지 않은 리다이렉트입니다.', 400);
    if (!upstream.ok) throw new AppError('이미지를 가져오지 못했습니다.', 502);
    const ct = upstream.headers.get('content-type') || '';
    if (!ct.startsWith('image/')) throw new AppError('이미지 파일이 아닙니다.', 400);
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.setHeader('Content-Type', ct);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.end(buf);
  } catch (err) { next(err); }
});

export default router;
